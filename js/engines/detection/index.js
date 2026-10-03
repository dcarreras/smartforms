// js/engines/detection/index.js
// Modular detection pipeline entry point and orchestrator

import { state } from "../../core/state.js";
import { saveHistory } from "../../core/storage-manager.js";
import { isOverlapping } from "../../utils/geometry.js";
import { DEDUP_THRESHOLDS, CONFIDENCE } from "./config.js";
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
import { resolveSemanticProps, isUniversalStaticText, GENERIC_PATTERNS, SEMANTIC_DIMENSIONS, computeFieldConfidence } from "./semantic-resolver.js";

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
export { clusterIntoLines, cleanOcrWordToken, isOcrCheckboxArtifact } from "./visual-affordances/line-clustering.js";
export { isOverlapping } from "../../utils/geometry.js";

/**
 * Stage quality priorities for Non-Maximum Suppression (NMS).
 * High-confidence authoritative and geometric stages outrank text/affordance guesses in the same location.
 */
export const STAGE_PRIORITIES = {
    acroform: 100,
    lattice_tables: 80,
    table_grid: 80,
    vector_geometry: 70,
    vector_fields: 70,
    boundary_underlines: 60,
    underline_fields: 60,
    onnx_neural: 65,
    layoutlmv3_sidecar: 65,
    tax_schedules: 50,
    visual_affordances: 40,
    colon_prompts: 35,
    checkbox_glyphs: 35
};

const ocrPageCache = new Map();

export function clearOcrCache() {
    ocrPageCache.clear();
}

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
    if (!pdfDoc) return { fields: [], totalCount: 0, autoAccepted: 0, reviewCount: 0, pages: [] };

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
            // In partially fillable forms, keep widgets as authoritative and continue detection
            // for remaining drawn boxes/underlines, letting NMS drop overlaps.
            const widgetFields = await getExistingWidgetFields(page, viewport, pageNum, usedNames);
            for (const wf of widgetFields) {
                wf.confidence = 1.0;
                wf.detectedBy = "acroform";
                wf.sourcedFrom = "acroform";
            }
            const pageExistingFields = [...existingFields, ...widgetFields];

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
            // Triggers when text is sparse (< 5), when explicit options.forceOcr is set,
            // or when a flattened bitmap has 0 interactive vector shapes and all text consists of noise fragments
            const isTextSparse = rawBlocks.length < 5;
            const hasInteractiveVectorShapes = (vectorShapes.checkboxRects?.length || 0) > 0 ||
                (vectorShapes.inputBoxRects?.length || 0) > 0 ||
                (vectorShapes.underlines?.length || 0) > 0;
            const isNoisyTextOnly = !hasInteractiveVectorShapes && rawBlocks.length > 0 &&
                rawBlocks.every(tb => (tb.str || "").trim().length <= 3 || /^\d+$/.test((tb.str || "").trim()));
            const isScannedDoc = isTextSparse || isNoisyTextOnly || options.forceOcr === true;

            if (isScannedDoc && typeof document !== "undefined" && options.enableOcr !== false) {
                try {
                    pipelineTelemetry.stagesAttempted.push("ocr");
                    const { performScannedPageOcr } = await import("../ocr-engine.js");
                    const docFingerprint = pdfDoc.fingerprint || (pdfDoc.loadingTask && pdfDoc.loadingTask.docId) || "doc";
                    const ocrLang = options.ocrLang || options.lang || "eng";
                    const cacheKey = `${docFingerprint}_p${pageNum}_${ocrLang}`;

                    let ocrResult = null;
                    if (ocrPageCache.has(cacheKey)) {
                        ocrResult = ocrPageCache.get(cacheKey);
                    } else {
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

                        ocrResult = await performScannedPageOcr(ocrCanvas, viewport, pageNum, {
                            ...options,
                            ocrLang
                        });
                        ocrPageCache.set(cacheKey, ocrResult);
                    }

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

            const rawPageCandidates = [...widgetFields];
            const context = {
                page,
                viewport,
                pageNum,
                usedNames,
                existingFields: pageExistingFields,
                widgetFields,
                pageFields: rawPageCandidates,
                rawBlocks,
                vectorShapes,
                boundaryLines,
                hasInteractiveVectorShapes,
                options,
                sharedData: {
                    latticeRegions: []
                }
            };

            // 2. Local Python FFDNet-L Vision Sidecar (Priority Engine on http://127.0.0.1:8000)
            let sidecarRan = false;
            if (options.useSidecar !== false && typeof fetch !== "undefined") {
                pipelineTelemetry.stagesAttempted.push("layoutlmv3_sidecar");
                try {
                    const { isSidecarAvailable, detectFieldsViaSidecar } = await import("../sidecar-detector.js");
                    const sidecarStatus = await isSidecarAvailable();
                    if (sidecarStatus && sidecarStatus.available) {
                        const sidecarFields = await detectFieldsViaSidecar(page, viewport, rawBlocks, pageNum, usedNames);
                        for (const sf of sidecarFields) {
                            sf.detectedBy = "ffdnet-l";
                        }
                        rawPageCandidates.push(...sidecarFields);
                        pipelineTelemetry.countsByStage["ffdnet-l"] = sidecarFields.length;
                        pipelineTelemetry.stagesSucceeded.push("layoutlmv3_sidecar");
                        if (sidecarFields.length > 0) {
                            sidecarRan = true;
                            console.log(`[Detection] FFDNet-L detected ${sidecarFields.length} fields. Heuristics blocked for pure vision test.`);
                        }
                    } else {
                        pipelineTelemetry.stagesSkipped.push("layoutlmv3_sidecar_offline");
                    }
                } catch (sidecarErr) {
                    pipelineTelemetry.stageErrors["layoutlmv3_sidecar"] = sidecarErr.message;
                }
            }

            // 2.5 Heuristic Detection Stages (Blocked in browser runtime to test pure FFDNet-L vision model)
            const isNodeTestEnv = typeof process !== "undefined" && Boolean(process?.versions?.node) && (typeof window === "undefined" || !globalThis.window);
            const shouldRunHeuristics = isNodeTestEnv ? !options.disableHeuristics : Boolean(options.enableHeuristics);
            if (shouldRunHeuristics) {
                for (const stage of STAGES) {
                    if (stage.condition && !stage.condition(context)) {
                        continue;
                    }
                    pipelineTelemetry.stagesAttempted.push(stage.name);
                    try {
                        const fields = await stage.detect(context);
                        const validFields = (fields || []).map(f => {
                            if (!f.detectedBy) f.detectedBy = stage.name;
                            return f;
                        });
                        rawPageCandidates.push(...validFields);
                        pipelineTelemetry.countsByStage[stage.name] = (pipelineTelemetry.countsByStage[stage.name] || 0) + validFields.length;
                        pipelineTelemetry.stagesSucceeded.push(stage.name);
                    } catch (stageErr) {
                        pipelineTelemetry.stageErrors[stage.name] = stageErr.message;
                        console.warn(`Detection stage '${stage.name}' failed:`, stageErr);
                    }
                }
            } else {
                pipelineTelemetry.stagesSkipped.push("heuristics_blocked");
                console.log("[Detection] Heuristic detection pipeline is BLOCKED. Running FFDNet-L vision model only.");
            }

            // 3. Optional In-Browser ONNX Neural Vision Detector (Hybrid Mode — only if sidecar did not run)
            if (isHybridMode && !sidecarRan && typeof document !== "undefined") {
                pipelineTelemetry.stagesAttempted.push("onnx_neural");
                try {
                    const { detectNeuralFieldsOnCanvas } = await import("../onnx-detector.js");
                    const renderCanvas = document.createElement("canvas");
                    renderCanvas.width = viewport.width;
                    renderCanvas.height = viewport.height;
                    const renderCtx = renderCanvas.getContext("2d");
                    await page.render({ canvasContext: renderCtx, viewport }).promise;

                    const rawNeural = await detectNeuralFieldsOnCanvas(renderCanvas, pageNum, viewport);
                    const neuralFields = enrichNeuralFieldsWithText(rawNeural, rawBlocks, usedNames, pageNum);
                    for (const nf of neuralFields) {
                        nf.detectedBy = "onnx_neural";
                    }
                    rawPageCandidates.push(...neuralFields);
                    pipelineTelemetry.countsByStage["onnx_neural"] = neuralFields.length;
                    pipelineTelemetry.stagesSucceeded.push("onnx_neural");
                } catch (neuralErr) {
                    pipelineTelemetry.stageErrors["onnx_neural"] = neuralErr.message;
                    console.warn("Neural vision inference skipped:", neuralErr);
                }
            }

            // 4. Quality-Dependent Non-Maximum Suppression (NMS)
            for (const c of rawPageCandidates) {
                const stagePri = STAGE_PRIORITIES[c.detectedBy] || (c.sourcedFrom === "acroform" ? 100 : 50);
                const conf = typeof c.confidence === "number" ? c.confidence : CONFIDENCE.BASELINE;
                c._sortScore = (conf * 1000) + stagePri;
            }

            // Sort candidates descending by confidence & stage priority
            rawPageCandidates.sort((a, b) => b._sortScore - a._sortScore);

            const pageAccepted = [];
            for (const c of rawPageCandidates) {
                // Drop candidate if it overlaps with an existing preserved field
                if (c.detectedBy !== "acroform" && isOverlapping(c, existingFields, DEDUP_THRESHOLDS.WITHIN_STAGE)) {
                    continue;
                }

                // Check overlap against higher-scoring accepted fields
                let overlappingAccepted = null;
                for (const acc of pageAccepted) {
                    if (isOverlapping(c, [acc], DEDUP_THRESHOLDS.CROSS_STAGE)) {
                        overlappingAccepted = acc;
                        break;
                    }
                }

                if (overlappingAccepted) {
                    // Suppressed by higher-scoring candidate.
                    // If from a distinct stage, record multi-stage agreement and preserve richer attributes
                    if (c.detectedBy !== overlappingAccepted.detectedBy) {
                        overlappingAccepted.stageAgreementCount = (overlappingAccepted.stageAgreementCount || 1) + 1;
                        if (!overlappingAccepted.stagesAgreed) {
                            overlappingAccepted.stagesAgreed = [overlappingAccepted.detectedBy];
                        }
                        if (!overlappingAccepted.stagesAgreed.includes(c.detectedBy)) {
                            overlappingAccepted.stagesAgreed.push(c.detectedBy);
                        }
                        if (!overlappingAccepted.label && c.label) overlappingAccepted.label = c.label;
                        if (!overlappingAccepted.tooltip && c.tooltip) overlappingAccepted.tooltip = c.tooltip;
                        if (c.isComb && !overlappingAccepted.isComb) {
                            overlappingAccepted.isComb = true;
                            overlappingAccepted.maxLength = c.maxLength;
                        }
                        if (c.dataFormat && c.dataFormat !== "text" && overlappingAccepted.dataFormat === "text") {
                            overlappingAccepted.dataFormat = c.dataFormat;
                        }
                    }
                } else {
                    pageAccepted.push(c);
                }
            }

            // Compute dynamic confidence score based on real signals
            for (const f of pageAccepted) {
                f.confidence = computeFieldConfidence(f, pageAccepted, f.stageAgreementCount || 1);
                delete f._sortScore;
            }

            allDetected.push(...pageAccepted);
            pageSummaries.push({
                pageNumber: pageNum,
                width: viewport.width,
                height: viewport.height,
                fields: pageAccepted
            });
        } catch(err) {
            console.error("Auto-detect error on page " + pageNum + ":", err);
        }
    }

    const finalUnique = [];
    allDetected.sort((a, b) => {
        const scoreB = (b.confidence || 0.5) * 1000 + (STAGE_PRIORITIES[b.detectedBy] || 50);
        const scoreA = (a.confidence || 0.5) * 1000 + (STAGE_PRIORITIES[a.detectedBy] || 50);
        return scoreB - scoreA;
    });

    for (let f of allDetected) {
        if (!isOverlapping(f, existingFields, DEDUP_THRESHOLDS.WITHIN_STAGE) &&
            !isOverlapping(f, finalUnique, DEDUP_THRESHOLDS.WITHIN_STAGE)) {
            finalUnique.push(f);
        }
    }

    const autoAccepted = finalUnique.filter(f => (f.confidence || 0) >= CONFIDENCE.ACCEPT).length;
    const reviewCount = finalUnique.filter(f => (f.confidence || 0) < CONFIDENCE.ACCEPT).length;

    let returnedFields = finalUnique;
    if (typeof options.minConfidence === "number" && options.minConfidence > 0) {
        returnedFields = finalUnique.filter(f => (f.confidence || 0) >= options.minConfidence || f.sourcedFrom === "acroform");
    }

    return {
        fields: returnedFields,
        totalCount: returnedFields.length,
        autoAccepted,
        reviewCount,
        omittedCount: finalUnique.length - returnedFields.length,
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

    const minConfidence = typeof options.minConfidence === "number" ? options.minConfidence : CONFIDENCE.ACCEPT;

    const result = await detectFormFieldsFromDoc(state.pdfDoc, {
        disableHeuristics: true,
        ...options,
        minConfidence,
        pageNumber: pagesToScan,
        totalPages: state.totalPages,
        currentPageNum: state.currentPageNum,
        existingFields: preservedFields
    });

    // Add fields with confidence >= minConfidence, or any field detected by FFDNet / authoritative AcroForms
    const acceptedFields = result.fields.filter(f => 
        (f.confidence || 0) >= minConfidence || 
        f.detectedBy === "ffdnet-l" || 
        f.sourcedFrom === "acroform" ||
        options.includeLowConfidence
    );

    if (acceptedFields.length > 0) {
        state.fields = [...preservedFields, ...acceptedFields];
        state.selectedFieldIds.clear();
        if (state.lastSelectedFieldId === null) {
            state.lastSelectedFieldId = state.fields.find(f => (f.page || 1) === state.currentPageNum)?.id
                || state.fields[0]?.id
                || null;
        }
        saveHistory();
    }

    const omittedCount = result.omittedCount !== undefined ? result.omittedCount : (result.reviewCount || 0);

    const returnObj = {
        totalCount: acceptedFields.length,
        autoAccepted: acceptedFields.length,
        reviewCount: omittedCount,
        omittedCount,
        fields: acceptedFields,
        telemetry: result.telemetry,
        valueOf() { return this.totalCount; },
        [Symbol.toPrimitive](hint) { return hint === "string" ? String(this.totalCount) : this.totalCount; }
    };

    return returnObj;
}
