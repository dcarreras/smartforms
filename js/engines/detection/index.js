// js/engines/detection/index.js
// Modular detection pipeline entry point and orchestrator

import { state } from "../../core/state.js";
import { saveHistory } from "../../core/storage-manager.js";
import { isOverlapping } from "../../utils/geometry.js";
import { DEDUP_THRESHOLDS } from "./config.js";
import { getExistingWidgetFields, importExistingAcroFormFields, detect as detectAcroformWidgets } from "./acroform-passthrough.js";
import { extractPdfVectorShapes, calculateDocumentColumnBoundaries } from "./vector-shapes.js";
import { clusterCombBoxes } from "./comb-fields.js";
import { clusterRadioGroups, MUTUAL_EXCLUSIVE_SETS } from "./radio-clustering.js";
import { rectContainsSignificantText, reconstructLinePhrase, detectVectorDrawnFields, detect as detectVectorFields } from "./vector-fields.js";
import { TABLE_COL_DEFS, matchColumnKeyword, reconstructTableGridBoxes, buildFieldsFromTableGrid, detectTableGridLines, detectLatticeTableFields, detect as detectLatticeTables } from "./table-grid.js";
import { detectUnderlineFields, detect as detectUnderlines } from "./underline-fields.js";
import { enrichNeuralFieldsWithText, detect as detectNeuralFields } from "./neural-bridge.js";
import { detectVisualAffordances, detectTaxScheduleLineAffordances, detectTaxSchedules, detect as detectVisualAffordancesStage } from "./visual-affordances/index.js";
import { clusterIntoLines } from "./visual-affordances/line-clustering.js";
import { resolveSemanticProps, isUniversalStaticText, GENERIC_PATTERNS, SEMANTIC_DIMENSIONS } from "./semantic-resolver.js";

// Re-export all pipeline symbols for external callers and backwards compatibility
export * from "./config.js";
export * from "./semantic-resolver.js";
export * from "./acroform-passthrough.js";
export * from "./vector-shapes.js";
export * from "./comb-fields.js";
export * from "./radio-clustering.js";
export * from "./vector-fields.js";
export * from "./table-grid.js";
export * from "./underline-fields.js";
export * from "./neural-bridge.js";
export * from "./visual-affordances/index.js";
export { clusterIntoLines } from "./visual-affordances/line-clustering.js";
export { isOverlapping } from "../../utils/geometry.js";

/**
 * Detection pipeline stages definition.
 * Each stage conforms to the uniform stage plugin contract:
 * - name: string (telemetry key)
 * - detect: (context: Object) => Promise<Array> | Array
 * - condition?: (context: Object) => boolean
 * - initial?: boolean (true for base geometry stage that seeds pageFields)
 */
export const STAGES = [
    {
        name: "vector_geometry",
        detect: detectVectorFields,
        initial: true
    },
    {
        name: "lattice_tables",
        detect: detectLatticeTables
    },
    {
        name: "boundary_underlines",
        condition: (context) => Boolean(context.boundaryLines && context.boundaryLines[0]),
        detect: detectUnderlines
    },
    {
        name: "tax_schedules",
        detect: detectTaxSchedules
    },
    {
        name: "visual_affordances",
        detect: detectVisualAffordancesStage
    }
];

export async function detectFormFieldsFromDoc(pdfDoc, options = {}) {
    if (!pdfDoc) return { fields: [], totalCount: 0, pages: [] };

    const totalPages = pdfDoc.numPages || options.totalPages || 1;
    const pagesToScan = options.pageNumber
        ? (Array.isArray(options.pageNumber) ? options.pageNumber : [options.pageNumber])
        : (options.scope === "all" ? Array.from({ length: totalPages }, (_, i) => i + 1) : [options.currentPageNum || 1]);

    const isHybridMode = options.mode === "hybrid" || options.mode === "deep" || options.useNeural === true;
    const existingFields = options.existingFields || [];
    const usedNames = new Set(existingFields.map(f => f.name));
    const allDetected = [];
    const pageSummaries = [];
    const pipelineTelemetry = {
        stagesAttempted: [],
        stagesSucceeded: [],
        stagesSkipped: [],
        stageErrors: {},
        countsByStage: {}
    };

    for (let pageNum of pagesToScan) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = (typeof page.getViewport === "function")
                ? page.getViewport({ scale: 1.0 })
                : { width: 612, height: 792 };

            // 1. Authoritative AcroForm passthrough — real widgets are trusted as-is
            const widgetFields = await getExistingWidgetFields(page, viewport, pageNum, usedNames);
            if (widgetFields.length > 0) {
                allDetected.push(...widgetFields);
                pageSummaries.push({
                    pageNumber: pageNum,
                    width: viewport.width,
                    height: viewport.height,
                    fields: widgetFields
                });
                continue;
            }
            const vectorShapes = await extractPdfVectorShapes(page, viewport);
            const boundaryLines = await detectTableGridLines(page);

            let rawBlocks = [];
            if (typeof page.getTextContent === "function") {
                const textContent = await page.getTextContent();
                rawBlocks = (textContent.items || []).map(item => {
                    const tx = item.transform ? item.transform[4] : (item.x || 0);
                    const ty = item.transform ? item.transform[5] : (item.y || 0);
                    const fontHeight = (item.transform && Math.abs(item.transform[3])) || item.height || 12;
                    return {
                        x: Math.round(tx),
                        y: Math.round((viewport.height || 792) - ty - fontHeight),
                        width: Math.round(item.width || 0),
                        height: Math.round(fontHeight),
                        str: (item.str || "").trim()
                    };
                }).filter(tb => tb.str.length > 0);
            }

            // 1.25 Scanned / Flattened PDF Client-Side OCR Fallback
            // Triggers when text is sparse (scanned) OR when interactive vector shapes (boxes, checkboxes, underlines) are absent
            const hasInteractiveVectorShapes = (vectorShapes.checkboxRects?.length || 0) > 0 ||
                (vectorShapes.inputBoxRects?.length || 0) > 0 ||
                (vectorShapes.underlines?.length || 0) > 0;
            const isTextSparse = rawBlocks.length < 5;
            const isVectorSparse = (vectorShapes.allRects?.length === 0 && (vectorShapes.paths?.length || 0) < 5);
            const isScannedDoc = isTextSparse || isVectorSparse;
            const needsVisualOrOcrScan = isScannedDoc || !hasInteractiveVectorShapes;

            if (needsVisualOrOcrScan && typeof document !== "undefined" && options.enableOcr !== false) {
                try {
                    pipelineTelemetry.stagesAttempted.push("ocr");
                    const { performScannedPageOcr } = await import("../ocr-engine.js");
                    let ocrCanvas = null;
                    const mainCanvas = document.getElementById("pdfCanvas");
                    
                    if (mainCanvas && mainCanvas.width > 0 && pageNum === (options.currentPageNum || 1)) {
                        ocrCanvas = mainCanvas;
                    } else {
                        ocrCanvas = document.createElement("canvas");
                        const ocrScale = 2.0;
                        const ocrViewport = page.getViewport({ scale: ocrScale });
                        ocrCanvas.width = ocrViewport.width;
                        ocrCanvas.height = ocrViewport.height;
                        const ocrCtx = ocrCanvas.getContext("2d", { willReadFrequently: true });
                        await page.render({ canvasContext: ocrCtx, viewport: ocrViewport }).promise;
                    }

                    const ocrResult = await performScannedPageOcr(ocrCanvas, viewport, pageNum, options);
                    if (ocrResult.textBlocks && ocrResult.textBlocks.length > 0) {
                        rawBlocks = [...rawBlocks, ...ocrResult.textBlocks];
                    }
                    if (ocrResult.allRects && ocrResult.allRects.length > 0) {
                        vectorShapes.allRects = [...(vectorShapes.allRects || []), ...ocrResult.allRects];
                    }
                    if (ocrResult.underlines && ocrResult.underlines.length > 0) {
                        vectorShapes.underlines = [...(vectorShapes.underlines || []), ...ocrResult.underlines];
                    }
                    pipelineTelemetry.stagesSucceeded.push("ocr");
                } catch (ocrErr) {
                    pipelineTelemetry.stageErrors["ocr"] = ocrErr.message;
                    console.warn("Client-side OCR scanning fallback:", ocrErr);
                }
            }

            let pageFields = [];
            const context = {
                page,
                viewport,
                pageNum,
                usedNames,
                existingFields,
                widgetFields,
                pageFields,
                rawBlocks,
                vectorShapes,
                boundaryLines,
                options,
                sharedData: {
                    latticeRegions: []
                }
            };

            for (const stage of STAGES) {
                if (stage.condition && !stage.condition(context)) {
                    continue;
                }
                pipelineTelemetry.stagesAttempted.push(stage.name);
                try {
                    const fields = await stage.detect(context);
                    let count = 0;
                    if (stage.initial) {
                        pageFields.push(...(fields || []));
                        count = fields ? fields.length : 0;
                    } else {
                        for (const f of (fields || [])) {
                            if (!isOverlapping(f, pageFields, DEDUP_THRESHOLDS.CROSS_STAGE)) {
                                pageFields.push(f);
                                count++;
                            }
                        }
                    }
                    pipelineTelemetry.countsByStage[stage.name] = (pipelineTelemetry.countsByStage[stage.name] || 0) + count;
                    pipelineTelemetry.stagesSucceeded.push(stage.name);
                } catch (stageErr) {
                    pipelineTelemetry.stageErrors[stage.name] = stageErr.message;
                    console.warn(`Detection stage '${stage.name}' failed:`, stageErr);
                }
            }

            // 2.5 Optional Local Python LayoutLMv3 Sidecar (http://127.0.0.1:8000)
            if (options.useSidecar !== false && typeof fetch !== "undefined") {
                pipelineTelemetry.stagesAttempted.push("layoutlmv3_sidecar");
                try {
                    const { isSidecarAvailable, detectFieldsViaSidecar } = await import("../sidecar-detector.js");
                    const sidecarStatus = await isSidecarAvailable();
                    if (sidecarStatus && sidecarStatus.available) {
                        const sidecarFields = await detectFieldsViaSidecar(page, viewport, rawBlocks, pageNum, usedNames);
                        let sidecarCount = 0;
                        for (const sf of sidecarFields) {
                            if (!isOverlapping(sf, pageFields, DEDUP_THRESHOLDS.CROSS_STAGE)) {
                                pageFields.push(sf);
                                sidecarCount++;
                            }
                        }
                        pipelineTelemetry.countsByStage["layoutlmv3_sidecar"] = sidecarCount;
                        pipelineTelemetry.stagesSucceeded.push("layoutlmv3_sidecar");
                    } else {
                        pipelineTelemetry.stagesSkipped.push("layoutlmv3_sidecar_offline");
                    }
                } catch (sidecarErr) {
                    pipelineTelemetry.stageErrors["layoutlmv3_sidecar"] = sidecarErr.message;
                }
            }

            // 3. Optional In-Browser ONNX Neural Vision Detector (Hybrid Mode)
            if (isHybridMode && typeof document !== "undefined") {
                pipelineTelemetry.stagesAttempted.push("onnx_neural");
                try {
                    const { detectNeuralFieldsOnCanvas, calculateBoxIoU } = await import("../onnx-detector.js");
                    const renderCanvas = document.createElement("canvas");
                    renderCanvas.width = viewport.width;
                    renderCanvas.height = viewport.height;
                    const renderCtx = renderCanvas.getContext("2d");
                    await page.render({ canvasContext: renderCtx, viewport }).promise;

                    const rawNeural = await detectNeuralFieldsOnCanvas(renderCanvas, pageNum, viewport);
                    const neuralFields = enrichNeuralFieldsWithText(rawNeural, rawBlocks, usedNames, pageNum);
                    let neuralCount = 0;
                    for (const nf of neuralFields) {
                        const matchingField = pageFields.find(pf => calculateBoxIoU(nf, pf) >= DEDUP_THRESHOLDS.CROSS_STAGE);
                        if (!matchingField) {
                            pageFields.push(nf);
                            neuralCount++;
                        } else {
                            // Agreement boosts confidence
                            matchingField.confidence = Math.min(0.99, Math.max(matchingField.confidence || 0.85, nf.confidence || 0.85) * 1.05);
                            // Preserve richer heuristic classifications (comb, dropdown, specific formats)
                            if (!matchingField.isComb && matchingField.type !== "dropdown" && matchingField.dataFormat === "text" && nf.type && nf.type !== "textField") {
                                matchingField.type = nf.type;
                            }
                        }
                    }
                    pipelineTelemetry.countsByStage["onnx_neural"] = neuralCount;
                    pipelineTelemetry.stagesSucceeded.push("onnx_neural");
                } catch (neuralErr) {
                    pipelineTelemetry.stageErrors["onnx_neural"] = neuralErr.message;
                    console.warn("Neural vision inference skipped:", neuralErr);
                }
            }
            allDetected.push(...pageFields);
            pageSummaries.push({
                pageNumber: pageNum,
                width: viewport.width,
                height: viewport.height,
                fields: pageFields
            });
        } catch(err) {
            console.error("Auto-detect error on page " + pageNum + ":", err);
        }
    }

    const finalUnique = [];
    for (let f of allDetected) {
        if (!isOverlapping(f, existingFields, DEDUP_THRESHOLDS.WITHIN_STAGE) &&
            !isOverlapping(f, finalUnique, DEDUP_THRESHOLDS.WITHIN_STAGE)) {
            finalUnique.push(f);
        }
    }

    return {
        fields: finalUnique,
        totalCount: finalUnique.length,
        pages: pageSummaries,
        telemetry: pipelineTelemetry
    };
}

/** Standalone alias for detectFormFieldsFromDoc */
export const detectFormFields = detectFormFieldsFromDoc;

/**
 * Formblatt UI Workflow wrapper — connects pure detection results into reactive application state.
 */
export async function autoDetectFields(scope = "current", options = {}) {
    if (!state.pdfDoc) {
        if (typeof alert === "function") alert("Please load a PDF document first.");
        return 0;
    }

    const pagesToScan = scope === "all"
        ? Array.from({ length: state.totalPages }, (_, i) => i + 1)
        : [state.currentPageNum];

    const preservedFields = state.fields.filter(f => {
        const pageIsScanned = pagesToScan.includes(f.page || 1);
        const isDetectorField = Boolean(f.detectedBy || f.sourcedFrom === "acroform");
        return !pageIsScanned || !isDetectorField;
    });

    const result = await detectFormFieldsFromDoc(state.pdfDoc, {
        ...options,
        pageNumber: pagesToScan,
        totalPages: state.totalPages,
        currentPageNum: state.currentPageNum,
        existingFields: preservedFields
    });

    if (result.fields.length > 0) {
        state.fields = [...preservedFields, ...result.fields];
        state.selectedFieldIds.clear();
        if (state.lastSelectedFieldId === null) {
            state.lastSelectedFieldId = state.fields.find(f => (f.page || 1) === state.currentPageNum)?.id
                || state.fields[0]?.id
                || null;
        }
        saveHistory();
    }

    return result.totalCount;
}
