// ── Client-Side Zero-Telemetry OCR Engine for Scanned PDFs (js/ocr-engine.js) ──
// 100% in-browser multi-pass adaptive binarization, contour analysis, line segmentation & visual text extraction.

/**
 * Checks whether a PDF page is a scanned image or flattened raster bitmap.
 * @param {Array} rawBlocks 
 * @param {Object} vectorShapes 
 * @returns {boolean}
 */
export function isPageScannedOrFlattened(rawBlocks = [], vectorShapes = {}) {
    const textCount = rawBlocks.length;
    const rectCount = (vectorShapes.allRects || []).length;
    const pathCount = (vectorShapes.paths || []).length;

    // If there is very little or no embedded vector text and no vector paths, page is scanned
    return textCount < 3 && rectCount < 2 && pathCount < 5;
}

/**
 * Converts ImageData to binary grayscale matrix (0 = foreground text/ink, 1 = background paper).
 * Implements Bradley-Roth local adaptive thresholding using Integral Images for robust handling of
 * shadows, lighting gradients, and low-contrast mobile phone captures of paper forms.
 * 
 * @param {ImageData} imageData 
 * @param {number} threshold Default 205 for global fallback
 * @param {Object} [options={}]
 * @param {boolean} [options.adaptive=true] Whether to use adaptive local thresholding
 * @param {number} [options.sensitivity=0.14] Dark ink contrast delta (0.10 to 0.20)
 * @returns {Uint8Array} Binary grid (0 or 1)
 */
export function binarizeImageData(imageData, threshold = 205, options = {}) {
    const { width, height, data } = imageData;
    const binary = new Uint8Array(width * height);
    const useAdaptive = options.adaptive !== false && width >= 40 && height >= 40;
    const sensitivity = options.sensitivity || 0.14;

    if (!useAdaptive) {
        // Fast global thresholding fallback
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const alpha = data[i + 3];
            binary[p] = (luma > threshold || alpha < 50) ? 1 : 0;
        }
        return binary;
    }

    // 1. Calculate luminance channel
    const luma = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        if (data[i + 3] < 50) {
            luma[p] = 255;
        } else {
            luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
    }

    // 2. Compute 2D Integral Image (Summed Area Table)
    const integral = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        const rowOffset = y * width;
        const prevRowOffset = (y - 1) * width;
        for (let x = 0; x < width; x++) {
            sum += luma[rowOffset + x];
            if (y === 0) {
                integral[rowOffset + x] = sum;
            } else {
                integral[rowOffset + x] = integral[prevRowOffset + x] + sum;
            }
        }
    }

    // 3. Adaptive local thresholding (Bradley-Roth)
    const S = Math.max(16, Math.round(width / 16));
    const s2 = Math.floor(S / 2);

    for (let y = 0; y < height; y++) {
        const y1 = Math.max(0, y - s2);
        const y2 = Math.min(height - 1, y + s2);
        const countY = (y2 - y1 + 1);

        for (let x = 0; x < width; x++) {
            const x1 = Math.max(0, x - s2);
            const x2 = Math.min(width - 1, x + s2);
            const count = countY * (x2 - x1 + 1);

            // Area sum from integral image: D - B - C + A
            const D = integral[y2 * width + x2];
            const B = y1 > 0 ? integral[(y1 - 1) * width + x2] : 0;
            const C = x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0;
            const A = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0;
            const localSum = D - B - C + A;
            const localMean = localSum / count;

            const pIdx = y * width + x;
            const pixelLuma = luma[pIdx];

            // 0 = foreground ink (dark), 1 = background paper (light)
            if (pixelLuma <= localMean * (1 - sensitivity)) {
                binary[pIdx] = 0;
            } else {
                binary[pIdx] = 1;
            }
        }
    }

    return binary;
}

/**
 * Detects visual drawn checkboxes and rectangular input boxes from binary image canvas.
 * @param {Uint8Array} binary 
 * @param {number} width 
 * @param {number} height 
 * @param {number} scale Canvas render scale (e.g. 2.0)
 * @returns {Array<{ x: number, y: number, width: number, height: number, isSquare: boolean }>}
 */
export function detectScannedBoxContours(binary, width, height, scale = 1.0) {
    const detectedBoxes = [];
    const minSize = Math.round(14 * scale);
    const maxSize = Math.round(520 * scale);
    const minHeight = Math.round(12 * scale);
    const maxHeight = Math.round(80 * scale);

    const visited = new Uint8Array(width * height);

    for (let y = 1; y < height - minHeight; y += 1) {
        for (let x = 1; x < width - minSize; x += 1) {
            const idx = y * width + x;
            // Look for dark horizontal top border
            if (binary[idx] === 0 && !visited[idx]) {
                let boxW = 0;
                while (x + boxW < width && binary[y * width + (x + boxW)] === 0) {
                    boxW++;
                }

                if (boxW >= minSize && boxW <= maxSize) {
                    // Check if there is a matching bottom border at y + testH
                    for (let testH = minHeight; testH <= maxHeight && (y + testH) < height; testH++) {
                        const bottomY = y + testH;
                        const bottomIdx = bottomY * width + x;
                        
                        // Count bottom border pixels
                        let matchCount = 0;
                        for (let k = 0; k < boxW; k++) {
                            if (binary[bottomIdx + k] === 0) matchCount++;
                        }

                        // Check vertical left and right borders
                        let leftCount = 0;
                        let rightCount = 0;
                        for (let vy = y; vy <= bottomY; vy++) {
                            if (binary[vy * width + x] === 0) leftCount++;
                            if (binary[vy * width + (x + boxW - 1)] === 0) rightCount++;
                        }

                        if (matchCount >= (boxW * 0.40) && (leftCount >= (testH * 0.30) || rightCount >= (testH * 0.30))) {
                            // Valid rectangular contour found
                            const boxX = Math.round(x / scale);
                            const boxY = Math.round(y / scale);
                            const boxWidth = Math.round(boxW / scale);
                            const boxHeight = Math.round(testH / scale);
                            const isSquare = Math.abs(boxWidth - boxHeight) <= 6 && boxWidth <= 35;

                            // Prevent duplicate overlapping detections
                            const isDuplicate = detectedBoxes.some(b => {
                                const iou = (Math.max(0, Math.min(b.x + b.width, boxX + boxWidth) - Math.max(b.x, boxX)) *
                                             Math.max(0, Math.min(b.y + b.height, boxY + boxHeight) - Math.max(b.y, boxY))) /
                                            ((b.width * b.height) + (boxWidth * boxHeight) - (Math.max(0, Math.min(b.x + b.width, boxX + boxWidth) - Math.max(b.x, boxX)) * Math.max(0, Math.min(b.y + b.height, boxY + boxHeight) - Math.max(b.y, boxY))));
                                return iou > 0.45 || (Math.abs(b.x - boxX) < 8 && Math.abs(b.y - boxY) < 8);
                            });

                            if (!isDuplicate) {
                                detectedBoxes.push({
                                    x: boxX,
                                    y: boxY,
                                    width: boxWidth,
                                    height: boxHeight,
                                    isSquare
                                });
                            }

                            // Mark region visited
                            for (let vy = y; vy <= y + testH; vy++) {
                                for (let vx = x; vx <= x + boxW; vx++) {
                                    visited[vy * width + vx] = 1;
                                }
                            }
                            break;
                        }
                    }
                }
                x += Math.max(1, boxW - 1);
            }
        }
    }

    // Perform Non-Maximum Suppression to deduplicate nested table cells
    const nmsFiltered = [];
    const sorted = [...detectedBoxes].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    for (const box of sorted) {
        const hasOverlap = nmsFiltered.some(existing => {
            const interX = Math.max(0, Math.min(existing.x + existing.width, box.x + box.width) - Math.max(existing.x, box.x));
            const interY = Math.max(0, Math.min(existing.y + existing.height, box.y + box.height) - Math.max(existing.y, box.y));
            const interArea = interX * interY;
            const boxArea = box.width * box.height;
            return interArea / boxArea > 0.60;
        });
        if (!hasOverlap) {
            nmsFiltered.push(box);
        }
    }

    return nmsFiltered;
}

/**
 * Extracts horizontal text lines & word bounding blocks from binary image canvas.
 * @param {Uint8Array} binary 
 * @param {number} width 
 * @param {number} height 
 * @param {number} scale Canvas render scale
 * @returns {Array<{ x: number, y: number, width: number, height: number, str: string }>}
 */
export function extractScannedTextLines(binary, width, height, scale = 1.0) {
    const textBlocks = [];
    const hProfile = new Int32Array(height);

    // Compute horizontal projection profile (count foreground dark pixels per row)
    for (let y = 0; y < height; y++) {
        let count = 0;
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            if (binary[rowOffset + x] === 0) count++;
        }
        hProfile[y] = count;
    }

    // Segment horizontal bands (lines of text)
    const minInkPerRow = Math.max(3, Math.round(4 * scale));
    const minLineHeight = Math.round(6 * scale);
    const maxLineHeight = Math.round(50 * scale);

    let inLine = false;
    let lineStartY = 0;

    for (let y = 0; y < height; y++) {
        const hasInk = hProfile[y] >= minInkPerRow;
        if (!inLine && hasInk) {
            inLine = true;
            lineStartY = y;
        } else if (inLine && (!hasInk || y === height - 1)) {
            inLine = false;
            const lineH = y - lineStartY;
            if (lineH >= minLineHeight && lineH <= maxLineHeight) {
                // Segment words horizontally within this line band
                const vProfile = new Int32Array(width);
                for (let x = 0; x < width; x++) {
                    let colCount = 0;
                    for (let ly = lineStartY; ly <= y; ly++) {
                        if (binary[ly * width + x] === 0) colCount++;
                    }
                    vProfile[x] = colCount;
                }

                let inWord = false;
                let wordStartX = 0;
                const minWordWidth = Math.round(5 * scale);
                const wordGapThreshold = Math.round(5 * scale);
                let emptyColCount = 0;

                for (let x = 0; x < width; x++) {
                    const colHasInk = vProfile[x] > 0;
                    if (!inWord && colHasInk) {
                        inWord = true;
                        wordStartX = x;
                        emptyColCount = 0;
                    } else if (inWord) {
                        if (!colHasInk) {
                            emptyColCount++;
                            if (emptyColCount >= wordGapThreshold || x === width - 1) {
                                inWord = false;
                                const wordW = (x - emptyColCount) - wordStartX;
                                if (wordW >= minWordWidth) {
                                    const userX = Math.round(wordStartX / scale);
                                    const userY = Math.round(lineStartY / scale);
                                    const userW = Math.round(wordW / scale);
                                     const userH = Math.round(lineH / scale);

                                    textBlocks.push({
                                        x: userX,
                                        y: userY,
                                        width: userW,
                                        height: userH,
                                        str: inferScannedLabelHeuristic(userW, userH),
                                        confidence: 0.35,
                                        isGeometricFallback: true
                                    });
                                }
                            }
                        } else {
                            emptyColCount = 0;
                        }
                    }
                }
            }
        }
    }

    return textBlocks;
}

const FALLBACK_LABELS_BY_LOCALE = {
    de: { info: "Informationen / Details:", name: "Vollständiger Name / Beschreibung:", date: "Datum / Referenz:", field: "Feld:" },
    fr: { info: "Informations / Détails:", name: "Nom complet / Description:", date: "Date / Référence:", field: "Champ:" },
    es: { info: "Información / Detalles:", name: "Nombre completo / Descripción:", date: "Fecha / Referencia:", field: "Campo:" },
    it: { info: "Informazioni / Dettagli:", name: "Nome completo / Descrizione:", date: "Data / Riferimento:", field: "Campo:" },
    nl: { info: "Informatie / Details:", name: "Volledige naam / Beschrijving:", date: "Datum / Referentie:", field: "Veld:" },
    en: { info: "Information / Details:", name: "Full Name / Description:", date: "Date / Reference:", field: "Field:" }
};

/**
 * Heuristic label inference from block geometry for zero-OCR fallback,
 * supporting multilingual locales with low confidence annotation.
 */
export function inferScannedLabelHeuristic(width, height, locale = null) {
    const lang = (locale || (typeof navigator !== "undefined" && navigator.language ? navigator.language.slice(0, 2) : "en")).toLowerCase();
    const dict = FALLBACK_LABELS_BY_LOCALE[lang] || FALLBACK_LABELS_BY_LOCALE.en;
    const aspect = width / Math.max(1, height);
    if (aspect > 6) return dict.info;
    if (aspect > 4) return dict.name;
    if (aspect > 2.5) return dict.date;
    return dict.field;
}

/**
 * Detects horizontal fill-in underlines, dotted ruling lines, and multi-segment lines from binary image.
 * Features collinear fragment merging to seamlessly recover broken scans, dotted rules, and underlines.
 * 
 * @param {Uint8Array} binary 
 * @param {number} width 
 * @param {number} height 
 * @param {number} scale Canvas render scale
 * @returns {Array<{ x: number, y: number, width: number, height: number }>}
 */
export function detectScannedHorizontalLines(binary, width, height, scale = 1.0) {
    const rawSegments = [];
    const minSegmentLen = Math.round(15 * scale);
    const maxThickness = Math.max(1, Math.round(6 * scale));
    const visited = new Uint8Array(width * height);

    // Pass 1: Extract all raw horizontal dark ink segments
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - minSegmentLen; x++) {
            const idx = y * width + x;
            if (binary[idx] === 0 && !visited[idx]) {
                let segW = 0;
                let gapCount = 0;
                while (x + segW < width) {
                    if (binary[y * width + (x + segW)] === 0) {
                        segW++;
                        gapCount = 0;
                    } else if (gapCount < 3 && x + segW + 1 < width && binary[y * width + (x + segW + 1)] === 0) {
                        segW += 2;
                        gapCount = 0;
                    } else {
                        break;
                    }
                }

                if (segW >= minSegmentLen) {
                    // Check line thickness (thin ruling line, not solid block)
                    let thickness = 1;
                    while (y + thickness < height && thickness <= maxThickness) {
                        let matchCount = 0;
                        const sampleStep = Math.max(1, Math.round(4 * scale));
                        let totalSamples = 0;
                        for (let k = 0; k < segW; k += sampleStep) {
                            totalSamples++;
                            if (binary[(y + thickness) * width + (x + k)] === 0) matchCount++;
                        }
                        if (matchCount >= totalSamples * 0.35) {
                            thickness++;
                        } else {
                            break;
                        }
                    }

                    if (thickness <= maxThickness) {
                        rawSegments.push({
                            x: x,
                            y: y + Math.floor(thickness / 2),
                            width: segW,
                            thickness: thickness
                        });

                        // Mark visited
                        for (let ty = Math.max(0, y - 1); ty < Math.min(height, y + thickness + 1); ty++) {
                            for (let tx = x; tx < Math.min(width, x + segW); tx++) {
                                visited[ty * width + tx] = 1;
                            }
                        }
                    }
                }
                x += Math.max(1, segW - 1);
            }
        }
    }

    // Pass 2: Collinear fragment merging (joins dotted / dashed / broken line runs on same row)
    const minTotalLineLen = Math.round(30 * scale);
    const maxCollinearGap = Math.round(20 * scale);
    const mergedLines = [];

    // Group segments by row (within ±2px)
    const sortedSegments = [...rawSegments].sort((a, b) => a.y - b.y || a.x - b.x);
    const usedSegment = new Set();

    for (let i = 0; i < sortedSegments.length; i++) {
        if (usedSegment.has(i)) continue;
        const current = sortedSegments[i];
        let lineX1 = current.x;
        let lineX2 = current.x + current.width;
        let lineY = current.y;
        usedSegment.add(i);

        // Look ahead for collinear segments on the same row with small gap
        for (let j = i + 1; j < sortedSegments.length; j++) {
            if (usedSegment.has(j)) continue;
            const next = sortedSegments[j];
            if (Math.abs(next.y - lineY) > 3) {
                if (next.y > lineY + 6) break; // Segments are y-sorted
                continue;
            }

            const gap = next.x - lineX2;
            if (gap >= -4 && gap <= maxCollinearGap) {
                lineX2 = Math.max(lineX2, next.x + next.width);
                usedSegment.add(j);
            }
        }

        const totalW = lineX2 - lineX1;
        if (totalW >= minTotalLineLen) {
            const userX = Math.round(lineX1 / scale);
            const userY = Math.round(lineY / scale);
            const userW = Math.round(totalW / scale);

            const isDuplicate = mergedLines.some(l => 
                Math.abs(l.y - userY) <= 5 && Math.abs(l.x - userX) <= 10 && Math.abs(l.width - userW) <= 20
            );

            if (!isDuplicate) {
                mergedLines.push({
                    x: userX,
                    y: userY,
                    width: userW,
                    height: Math.max(1, Math.round(current.thickness / scale))
                });
            }
        }
    }

    return mergedLines;
}

/**
 * Performs thorough multi-pass client-side OCR and contour analysis on a rendered PDF page canvas.
 * @param {HTMLCanvasElement} canvas 
 * @param {Object} viewport 
 * @param {number} [pageNum=1] 
 * @param {Object} [options={}]
 * @returns {Promise<{ textBlocks: Array, allRects: Array, underlines: Array, isScanned: boolean }>}
 */
let sharedWorker = null;
let sharedWorkerLang = null;
let workerTerminationTimer = null;

/**
 * Lazy worker pool for client-side zero-upload Tesseract.js optical character recognition.
 * Keeps worker warm across pages in the same session, auto-terminates after 60s idle.
 */
export async function getTesseractWorker(lang = "eng", onProgress = null) {
    if (typeof window === "undefined") return null;

    if (sharedWorker && sharedWorkerLang === lang) {
        if (workerTerminationTimer) {
            clearTimeout(workerTerminationTimer);
            workerTerminationTimer = null;
        }
        return sharedWorker;
    }

    let Tesseract = window.Tesseract;
    if (!Tesseract) {
        // Fast-path offline check: never attempt external CDN requests in Airplane Mode
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            throw new Error("Offline mode active: Tesseract.js CDN is unavailable in Airplane Mode");
        }

        // Try local vendor first if present, then fall back to CDN when online
        try {
            const localMod = await import("/vendor/tesseract.esm.min.js");
            Tesseract = localMod.default || localMod;
        } catch {
            try {
                const mod = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
                Tesseract = mod.default || mod;
            } catch (e) {
                Tesseract = await new Promise((resolve, reject) => {
                    if (typeof document === "undefined") return reject(e);
                    const s = document.createElement("script");
                    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
                    s.onload = () => resolve(window.Tesseract);
                    s.onerror = () => reject(new Error("Failed to load Tesseract.js from CDN"));
                    document.head.appendChild(s);
                });
            }
        }
    }

    if (!Tesseract || !Tesseract.createWorker) {
        throw new Error("Tesseract.js not available");
    }

    const worker = await Tesseract.createWorker(lang, 1, {
        logger: m => {
            if (onProgress && m.status === "recognizing text" && typeof m.progress === "number") {
                onProgress(`OCR recognition (${Math.round(m.progress * 100)}%)...`, Math.round(75 + m.progress * 20));
            }
        }
    });

    sharedWorker = worker;
    sharedWorkerLang = lang;
    return sharedWorker;
}

export function scheduleTesseractWorkerCleanup(idleMs = 60000) {
    if (workerTerminationTimer) clearTimeout(workerTerminationTimer);
    workerTerminationTimer = setTimeout(async () => {
        if (sharedWorker) {
            try { await sharedWorker.terminate(); } catch {}
            sharedWorker = null;
            sharedWorkerLang = null;
        }
    }, idleMs);
}

/**
 * Performs actual optical character recognition on rendered canvas using in-browser WebAssembly.
 * Extracts recognized words with exact bounding coordinates, text content, and confidence scores.
 */
export async function recognizeScannedCanvasOcr(canvas, renderScale = 1.0, options = {}) {
    const lang = options.ocrLang || "eng";
    const worker = await getTesseractWorker(lang, options.onProgress);
    if (!worker) return [];

    const { data } = await worker.recognize(canvas);
    scheduleTesseractWorkerCleanup(60000);

    const words = data.words || [];
    const textBlocks = [];

    for (const w of words) {
        const text = (w.text || "").trim();
        if (!text) continue;
        const conf = typeof w.confidence === "number" ? Math.max(0.1, Math.min(1.0, w.confidence / 100)) : 0.8;
        if (conf < 0.35 && text.length <= 1) continue;

        textBlocks.push({
            x: Math.round(w.bbox.x0 / renderScale),
            y: Math.round(w.bbox.y0 / renderScale),
            width: Math.round((w.bbox.x1 - w.bbox.x0) / renderScale),
            height: Math.round((w.bbox.y1 - w.bbox.y0) / renderScale),
            str: text,
            confidence: conf,
            isOcr: true
        });
    }

    return textBlocks;
}

/**
 * Performs thorough multi-pass client-side OCR and contour analysis on a rendered PDF page canvas.
 * @param {HTMLCanvasElement} canvas 
 * @param {Object} viewport 
 * @param {number} [pageNum=1] 
 * @param {Object} [options={}]
 * @returns {Promise<{ textBlocks: Array, allRects: Array, underlines: Array, isScanned: boolean, ocrUsed: boolean }>}
 */
export async function performScannedPageOcr(canvas, viewport, pageNum = 1, options = {}) {
    if (!canvas) {
        return { textBlocks: [], allRects: [], underlines: [], isScanned: false };
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const renderScale = canvas.width / (viewport.width || 1);

    if (options.onProgress) options.onProgress("Adaptive local contrast analysis...", 25);

    // Pass 1: Adaptive Bradley-Roth local thresholding
    const binary = binarizeImageData(imgData, 205, { adaptive: true, sensitivity: 0.14 });

    if (options.onProgress) options.onProgress("Detecting fill-in underlines & ruling lines...", 50);
    const underlines = detectScannedHorizontalLines(binary, canvas.width, canvas.height, renderScale);

    if (options.onProgress) options.onProgress("Extracting rectangular boxes & table cells...", 75);
    const detectedBoxes = detectScannedBoxContours(binary, canvas.width, canvas.height, renderScale);

    // Pass 4: In-Browser Optical Character Recognition (Real Tesseract.js when online/available, with 100% offline geometric fallback)
    let textBlocks = [];
    let ocrUsed = false;
    const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

    if (!isOffline && options.enableTesseract !== false && typeof window !== "undefined") {
        try {
            if (options.onProgress) options.onProgress("Reading scanned characters via in-browser OCR...", 80);
            textBlocks = await recognizeScannedCanvasOcr(canvas, renderScale, options);
            if (textBlocks.length > 0) {
                ocrUsed = true;
            }
        } catch (ocrErr) {
            console.warn("Client-side Tesseract OCR unavailable, falling back to local geometric segmentation:", ocrErr?.message || ocrErr);
        }
    }

    if (!ocrUsed || textBlocks.length === 0) {
        if (options.onProgress) {
            options.onProgress(isOffline
                ? "Airplane Mode: Mapping visual text blocks (100% offline geometric engine)..."
                : "Mapping visual text blocks (100% offline geometric engine)...", 90);
        }
        textBlocks = extractScannedTextLines(binary, canvas.width, canvas.height, renderScale);
    }

    // Convert detected boxes into vector rect format expected by auto-detector
    const allRects = detectedBoxes.map(b => ({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        isSquare: b.isSquare
    }));

    return {
        textBlocks,
        allRects,
        underlines,
        isScanned: true,
        ocrUsed,
        pageNum
    };
}


