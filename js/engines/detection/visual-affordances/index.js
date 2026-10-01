// js/engines/detection/visual-affordances/index.js
// Text affordance detectors: checkboxes glyphs, bracket/paren pairs, colon prompts, tax line leaders, lattice stream tables

import { generateFieldId } from "../../../core/state.js";
import { isOverlapping } from "../../../utils/geometry.js";
import { isUniversalStaticText, resolveSemanticProps } from "../semantic-resolver.js";
import { calculateDocumentColumnBoundaries } from "../vector-shapes.js";
import { clusterIntoLines, cleanOcrWordToken, isOcrCheckboxArtifact } from "./line-clustering.js";
import { TABLE_COL_DEFS, matchColumnKeyword } from "../table-grid.js";
import { detectCheckboxGlyphs, CHECKBOX_CHARS } from "./checkbox-glyphs.js";
import { DEDUP_THRESHOLDS } from "../config.js";
import { detectColonPrompts } from "./colon-prompts.js";

export { detectCheckboxGlyphs, CHECKBOX_CHARS, detectColonPrompts, clusterIntoLines, cleanOcrWordToken, isOcrCheckboxArtifact };

// TODO(refactor-followup): Decompose detectVisualAffordances into glyph and colon-prompt submodules

/**
 * Detects financial, tax schedule, and line-item input affordances.
 * Matches dotted leaders (. . . . .) or line indicator tokens (1a, 1b, 2, 10b, etc.)
 * ending in empty right-aligned currency/numeric amount columns.
 */
export function detectTaxScheduleLineAffordances(rawBlocks, viewport, pageNum, usedNames, existingFields = []) {
    const fields = [];
    if (!rawBlocks || rawBlocks.length === 0) return fields;

    const pageWidth = viewport?.width || 612;
    const pageHeight = viewport?.height || 792;

    // Cluster into horizontal line rows (y tolerance 4pt)
    const lines = [];
    const sortedWords = [...rawBlocks].sort((a, b) => a.y - b.y);

    for (const w of sortedWords) {
        const yCenter = w.y + (w.height || 10) / 2;
        let matchedLine = null;
        for (const l of lines) {
            if (Math.abs(l.yCenter - yCenter) <= 4) {
                matchedLine = l;
                break;
            }
        }
        if (!matchedLine) {
            matchedLine = { yCenter, y: w.y, height: w.height || 12, items: [] };
            lines.push(matchedLine);
        }
        matchedLine.items.push(w);
    }

    const LINE_TOKEN_REGEX = /^(?:\d{1,2}[a-z]?|[a-z])$/i;

    for (const line of lines) {
        const rowItems = line.items.sort((a, b) => a.x - b.x);
        const rowStr = rowItems.map(it => it.str).join(" ");

        // Strict dotted leader check: at least 4 dots spaced out or 5 total periods
        const hasDots = /(?:\.\s*){4,}/.test(rowStr) || (rowStr.match(/\./g) || []).length >= 5;
        const hasSchedulePrompt = /\b(?:line|lines|add|subtract|total|amount|gross|income|tax|wages|deduction|interest|dividends|credit|payment|refund|penalty|balance|due)\b/i.test(rowStr);

        // A schedule line must have dotted leaders OR explicit schedule computation prompt keywords
        if (!hasDots && !hasSchedulePrompt) continue;

        // If no dotted leader is present, the row must be an explicit schedule line item,
        // NOT a continuous paragraph of instructional prose containing inline monetary examples.
        if (!hasDots) {
            if (/\b(?:for example|e\.g\.|such as|if your|see instructions|pub\.|publication)\b/i.test(rowStr)) continue;
            const lastItem = rowItems[rowItems.length - 1];
            if (lastItem && (lastItem.x + lastItem.width) > pageWidth * 0.88) continue;
        }

        for (let i = 0; i < rowItems.length; i++) {
            const item = rowItems[i];
            const token = item.str.trim();

            const isNumToken = /^\d{1,2}[a-z]?$/i.test(token);
            // Single letters (e.g. 'a', 'b', 'z') ONLY allowed if there is an explicit dotted leader in the line
            const isLetterSubline = /^[a-z]$/i.test(token) && hasDots;

            if (!isNumToken && !isLetterSubline) continue;

            // When no dotted leader is present, the token must be an anchored line indicator at the start of the row
            // (e.g. item 0 or 1, and x <= 160) OR immediately preceding the right-hand slot
            if (!hasDots) {
                const isAnchoredStart = (i <= 1 && item.x <= 160);
                const isAnchoredEnd = (i === rowItems.length - 1 && item.x >= 350);
                if (!isAnchoredStart && !isAnchoredEnd) continue;
            }

            const xEnd = item.x + item.width;
            const nextItem = i + 1 < rowItems.length ? rowItems[i + 1] : null;

            const slotX1 = xEnd + 3;
            // Standard right margin boundary is typically around 576pt (pageWidth - 36)
            const slotX2 = nextItem ? (nextItem.x - 3) : Math.min(576, pageWidth - 36);
            const slotWidth = slotX2 - slotX1;

            // Slot must have standard currency column width (48 to 135 pt)
            if (slotWidth >= 48 && slotWidth <= 135) {
                // Must either be near right margin or followed by an interior column
                if (slotX2 >= pageWidth * 0.75 || (nextItem && nextItem.x >= 280)) {
                    // Verify slot does not overlap existing text words
                    const wordsInSlot = rowItems.some(w => w.x >= slotX1 - 2 && (w.x + w.width) <= slotX2 + 2);
                    if (wordsInSlot) continue;

                    // Extract label text from words to the left of this token
                    const labelWords = rowItems.slice(0, i)
                        .filter(w => !/^[\.\s_—–\-]+$/.test(w.str))
                        .map(w => w.str)
                        .join(" ")
                        .trim();

                    if (!labelWords || isUniversalStaticText(labelWords)) continue;

                    const cleanLabel = (labelWords.length > 0 ? labelWords : `line_${token}`).slice(0, 32);
                    const sem = resolveSemanticProps(cleanLabel || `line_${token}`, "textField", usedNames);

                    const fieldY = Math.round(line.yCenter - 6);
                    const fieldH = Math.max(12, Math.round(line.height || 12));

                    const field = {
                        id: generateFieldId(),
                        type: "textField",
                        name: sem.name,
                        x: Math.round(slotX1),
                        y: fieldY,
                        width: Math.round(slotWidth),
                        height: fieldH,
                        page: pageNum,
                        borderStyle: "solid",
                        fillStyle: "white",
                        multiline: false,
                        autofill: "",
                        dataFormat: "currency",
                        tooltip: (labelText || sem.name).replace(/[:_—–-]+$/, '').trim(),
                        detectedBy: "tax_schedule_affordance",
                        confidence: 0.92
                    };

                    if (!isOverlapping(field, existingFields, DEDUP_THRESHOLDS.CROSS_STAGE) && !isOverlapping(field, fields, DEDUP_THRESHOLDS.CROSS_STAGE)) {
                        fields.push(field);
                    }
                }
            }
        }
    }

    return fields;
}

// ============================================================================
// 4. DETECTION PIPELINE
// ============================================================================
export function detectVisualAffordances(rawBlocks, viewport, pageNum, usedNames, existingFields = [], preRegisteredTableRegions = [], vectorShapes = null) {
    const fields = [...existingFields];
    const seedCount = existingFields.length;
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    const textLines = clusterIntoLines(rawBlocks);
    const docLayout = calculateDocumentColumnBoundaries(rawBlocks, pageWidth, pageHeight);

    // ------------------------------------------------------------------------
    // AFFORDANCE 1: Standalone & Labelled Checkboxes & Radios (with Fieldset Groups)
    // ------------------------------------------------------------------------
    detectCheckboxGlyphs(textLines, rawBlocks, pageNum, usedNames, fields);

    // ------------------------------------------------------------------------
    // AFFORDANCE 2: Key-Value Prompts with Colons (Label: _____)
    // ------------------------------------------------------------------------
    detectColonPrompts(textLines, rawBlocks, viewport, pageNum, usedNames, fields, docLayout, vectorShapes);

    // ------------------------------------------------------------------------
    // AFFORDANCE 3: (Disabled) Open Questions & Inquiries
    // ------------------------------------------------------------------------
    // Arbitrary questions ending in '?' in questionnaires, clinical forms, or
    // surveys are static text and must NOT synthesize phantom text fields.
    // Genuine open input areas require physical vector lines/underlines/boxes.

    // ------------------------------------------------------------------------
    // AFFORDANCE 4: Table Grid Line Items (Invoices, POs, Estimates, Orders)
    // ------------------------------------------------------------------------
    // Guards against detecting the SAME table more than once. Any other line
    // on the page that happens to contain 2+ column keywords (a repeated
    // label, stray text near the table, etc.) would otherwise spin up an
    // independent second "table" with its own guessed boundaries and its own
    // synthetic row spacing — producing stray fields that don't line up with
    // the real grid, floating inside or just past it.
    const processedTableRegions = [...preRegisteredTableRegions];
    const regionsOverlap = (a, b) => {
        const xOverlap = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
        const yOverlap = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
        return xOverlap > 0 && yOverlap > 0;
    };

    for (const line of textLines) {
        const text = line.str.toLowerCase();
        if (line.items.length < 2) continue;

        // Skip lines that are sentences, questions, or paragraphs
        if (/[?!;]/.test(line.str) || line.str.trim().endsWith(".")) continue;
        if (isUniversalStaticText(line.str)) continue;
        const words = line.str.trim().split(/\s+/);
        if (words.length > 8) continue;
        if (/^\s*\d+[\s.)]/.test(line.str)) continue;
        if (/^(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should|what|where|when|which|why|how|if|in|for|to|please)\b/i.test(line.str)) continue;

        const tableColDefs = TABLE_COL_DEFS;

        const matchedCols = [];
        for (const item of line.items) {
            const itemTrim = item.str.trim();
            // A column header must be a short phrase (<= 3 words, <= 25 chars)
            if (itemTrim.length > 25 || itemTrim.split(/\s+/).length > 3) continue;
            for (const col of tableColDefs) {
                if (col.regex.test(itemTrim) && !matchedCols.some(m => m.id === col.id)) {
                    matchedCols.push({ ...col, x: item.x, width: item.width, y: item.y, height: item.height });
                    break;
                }
            }
        }

        // A table header line has at least 2 distinct column keywords
        if (matchedCols.length >= 2 && !text.includes(":")) {
            matchedCols.sort((a, b) => a.x - b.x);

            // Skip this header if it falls inside a table region we've
            // already built fields for — this is very likely a stray
            // repeated label rather than a genuinely separate table.
            const candidateRegion = {
                xMin: matchedCols[0].x - 10,
                xMax: matchedCols[matchedCols.length - 1].x + 130,
                yMin: line.y - 5,
                yMax: line.y + 400 // generous: real table body extends well below the header
            };
            if (processedTableRegions.some(r => regionsOverlap(r, candidateRegion))) {
                continue;
            }

            const columns = [];
            for (let c = 0; c < matchedCols.length; c++) {
                const current = matchedCols[c];
                const next = matchedCols[c + 1];
                const colStartX = Math.max(10, current.x - 4);
                const colEndX = next ? Math.max(colStartX + 25, next.x - 6) : Math.min(pageWidth - 25, current.x + 120);
                columns.push({
                    id: current.id,
                    name: current.name,
                    x: colStartX,
                    width: Math.max(25, colEndX - colStartX)
                });
            }

            const tableTopY = line.y + line.height + 4;
            let tableBottomY = pageHeight - 40;

            for (const tb of rawBlocks) {
                if (tb.y > tableTopY + 15) {
                    if (/^(?:subtotal|total|balance|amount\s*due|tax|vat|gst|discount|notes|terms|payment|authorized|signature|thank\s*you|eforms)/i.test(tb.str) || (tb.str.includes(":") && !tb.str.includes("http"))) {
                        tableBottomY = Math.min(tableBottomY, tb.y - 6);
                    }
                }
            }

            const tableHeight = tableBottomY - tableTopY;
            if (tableHeight >= 30) {
                // Record the real bounds of this table now that we know
                // them, so any later header line that overlaps this region
                // gets skipped instead of spawning a competing table.
                processedTableRegions.push({
                    xMin: columns[0].x - 10,
                    xMax: columns[columns.length - 1].x + columns[columns.length - 1].width + 10,
                    yMin: tableTopY - 5,
                    yMax: tableBottomY + 5
                });
                // Find existing row indices or placeholder rows
                const rowMarkers = rawBlocks.filter(tb => {
                    return tb.y >= tableTopY && tb.y <= tableBottomY && (/^\d+$/.test(tb.str) || /^\$\s*0(?:\.00)?$/.test(tb.str) || tb.str === "[");
                });

                let rowYs = [];
                if (rowMarkers.length >= 2) {
                    const sortedY = rowMarkers.map(m => m.y).sort((a, b) => a - b);
                    for (const y of sortedY) {
                        if (!rowYs.some(ry => Math.abs(ry - y) <= 14)) {
                            rowYs.push(y);
                        }
                    }

                    // Filter out any row marker separated by a large gap from the previous table rows
                    if (rowYs.length >= 2) {
                        const cleanedRowYs = [rowYs[0]];
                        const deltas = [];
                        for (let i = 1; i < rowYs.length; i++) {
                            deltas.push(rowYs[i] - rowYs[i - 1]);
                        }
                        deltas.sort((a, b) => a - b);
                        const medianDelta = deltas[Math.floor(deltas.length / 2)] || 22;

                        for (let i = 1; i < rowYs.length; i++) {
                            const gap = rowYs[i] - cleanedRowYs[cleanedRowYs.length - 1];
                            if (gap <= Math.max(34, medianDelta * 1.6)) {
                                cleanedRowYs.push(rowYs[i]);
                            } else {
                                // Table body has ended; stop accepting rows from below
                                break;
                            }
                        }
                        rowYs = cleanedRowYs;
                    }
                }

                if (rowYs.length === 0) {
                    continue;
                }

                let cellHeight = 18;
                if (rowYs.length >= 2) {
                    const medianRowGap = (rowYs[rowYs.length - 1] - rowYs[0]) / (rowYs.length - 1);
                    cellHeight = Math.min(24, Math.max(15, Math.round(medianRowGap - 4)));
                }

                for (let rIdx = 0; rIdx < rowYs.length; rIdx++) {
                    const rowY = rowYs[rIdx];
                    const rowNum = rIdx + 1;

                    // Never place a field that bleeds past the bottom of the table
                    if (rowY + cellHeight > tableBottomY - 4) {
                        continue;
                    }

                    for (const col of columns) {
                        if (col.id === "item_no") continue;

                        const isCheckboxCol = (col.id === "taxable" || col.id === "receipt");
                        const cellType = isCheckboxCol ? "checkBox" : "textField";
                        const sem = resolveSemanticProps(`${col.name}_${rowNum}`, cellType, usedNames);

                        const cellWidth = isCheckboxCol ? 16 : col.width;
                        const cellX = isCheckboxCol ? Math.round(col.x + Math.max(0, (col.width - 16) / 2)) : col.x;
                        const currentCellH = isCheckboxCol ? 16 : cellHeight;

                        // Static text collision check: never place a field over existing static text
                        const textCollisions = rawBlocks.filter(tb => {
                            const overlapX = Math.max(0, Math.min(cellX + cellWidth, tb.x + tb.width) - Math.max(cellX, tb.x));
                            const overlapY = Math.max(0, Math.min(rowY + currentCellH, tb.y + tb.height) - Math.max(rowY, tb.y));
                            return overlapX > 2 && overlapY > 2;
                        });
                        if (textCollisions.some(tb => tb.str.replace(/[\s.,$]/g, "").length > 0)) {
                            continue;
                        }

                        const cellField = {
                            id: generateFieldId(),
                            type: cellType,
                            name: sem.name,
                            x: cellX,
                            y: rowY,
                            width: cellWidth,
                            height: cellHeight,
                            page: pageNum,
                            borderStyle: "solid",
                            fillStyle: "white",
                            multiline: false,
                            autofill: "",
                            dataFormat: (col.id === "amount" || col.id === "unit_price") ? "currency" : ((col.id === "qty") ? "number" : "text"),
                            tooltip: (col.headerText || col.id).replace(/[:_—–-]+$/, '').trim(),
                            detectedBy: `affordance4_table_col-${col.id}_row-${rowNum}`,
                            confidence: 0.68
                        };

                        if (!isOverlapping(cellField, fields, DEDUP_THRESHOLDS.WITHIN_STAGE)) {
                            fields.push(cellField);
                        }
                    }
                }
            }
        }
    }

    return fields.slice(seedCount);
}

/**
 * Uniform stage detection plugin contract for tax and financial schedule line affordances.
 * @param {Object} context Stage detection context
 * @returns {Array} Detected tax schedule fields
 */
export function detectTaxSchedules(context = {}) {
    const {
        rawBlocks = [],
        viewport = { width: 612, height: 792 },
        pageNum = 1,
        usedNames = new Set(),
        existingFields = [],
        widgetFields = [],
        pageFields = []
    } = context;
    return detectTaxScheduleLineAffordances(
        rawBlocks,
        viewport,
        pageNum,
        usedNames,
        [...existingFields, ...widgetFields, ...pageFields]
    );
}

/**
 * Uniform stage detection plugin contract for visual text affordances (checkbox glyphs, colon prompts).
 * @param {Object} context Stage detection context
 * @returns {Array} Detected visual affordance fields
 */
export function detect(context = {}) {
    const {
        rawBlocks = [],
        viewport = { width: 612, height: 792 },
        pageNum = 1,
        usedNames = new Set(),
        pageFields = [],
        widgetFields = [],
        seedFields = [...widgetFields, ...pageFields],
        latticeRegions = context.latticeRegions || context.sharedData?.latticeRegions || [],
        vectorShapes = context.vectorShapes || null
    } = context;
    return detectVisualAffordances(
        rawBlocks,
        viewport,
        pageNum,
        usedNames,
        seedFields,
        latticeRegions,
        vectorShapes
    );
}
