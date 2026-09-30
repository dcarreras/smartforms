// js/engines/detection/table-grid.js
// Table grid reconstruction, column keyword matching, and lattice cell field generation

import { generateFieldId } from "../../core/state.js";
import { resolveSemanticProps } from "./semantic-resolver.js";

export const TABLE_COL_DEFS = [
    { regex: /^(?:item\s*(?:#|no|num)?|pos\.?|position|art[íi]culo|artikel|art\.|क्र\.?\s*सं\.?)$/i, id: "item_no", name: "item" },
    { regex: /^(?:sku|part\s*#|code|artikelnr|r[eé]f[eé]rence|c[óo]digo|codice|c[óo]d)$/i, id: "sku", name: "sku" },
    { regex: /description|particulars|details|goods|services|purpose|attendees|beschreibung|bezeichnung|d[eé]signation|descripci[óo]n|descrizione|descri[çc][ãa]o|omschrijving|विवरण|सामानको\s*विवरण/i, id: "description", name: "description" },
    { regex: /^(?:qty|quantity|units|hours|miles|count|menge|anzahl|quantit[ée]|cantidad|quantit[àa]|quantidade|aantal|परिमाण|संख्या)$/i, id: "qty", name: "quantity" },
    { regex: /unit\s*price|price|rate|unit\s*cost|fee|charge|einzelpreis|preis|prix\s*unitaire|prix|precio\s*unitario|precio|prezzo\s*unitario|pre[çc]o\s*unit[áa]rio|eenheidsprijs|prijs|दर|प्रति\s*इकाई/i, id: "unit_price", name: "price" },
    { regex: /^(?:taxable|steuerpflichtig|imposable|imponible|tribut[áa]vel|belastbaar)$/i, id: "taxable", name: "taxable" },
    { regex: /^(?:amount|total|line\s*total|ext\s*price|gesamt|betrag|montant|total|importe|totale|valor|totaal|रकम|जम्मा)$/i, id: "amount", name: "amount" },
    { regex: /category|expense\s*type|kategorie|cat[eé]gorie|categor[íi]a|categoria|वर्गीकरण/i, id: "category", name: "category" },
    { regex: /merchant|vendor|payee|supplier|h[äa]ndler|liefrant|fournisseur|proveedor|fornitore|fornecedor|leverancier|विक्रेता/i, id: "merchant", name: "merchant" },
    { regex: /receipt|quittung|re[çc]u|recibo|ricevuta|रसिद/i, id: "receipt", name: "receipt" },
    { regex: /^(?:date|datum|fecha|data|मिति)$/i, id: "date", name: "date" },
    { regex: /school|institution|college|schule|universit[äa]t|[eé]cole|universit[eé]|escuela|universidad|scuola|escola|school|विद्यालय|क्याम्पस/i, id: "school", name: "school" },
    { regex: /degree|major|diploma|abschluss|dipl[oô]me|t[íi]tulo|laurea|diploma|डिग्री|उपाधि/i, id: "degree", name: "degree" },
    { regex: /graduated|graduation|year|jahr|ann[eé]e|a[ñn]o|anno|ano|jaar|साल|वर्ष/i, id: "year", name: "year" },
    { regex: /gpa|honors|grade|note|calificaci[óo]n|voto|nota|cijfier|श्रेणी|अंक/i, id: "gpa", name: "gpa" },
    { regex: /employer|company|arbeitgeber|firma|employeur|soci[eé]t[eé]|empleador|datore|empregador|werkgever|रोजगारदाता/i, id: "employer", name: "employer" },
    { regex: /position|job\s*title|role|position|funktion|poste|cargo|puesto|ruolo|functie|पद/i, id: "job_title", name: "job_title" },
    { regex: /medication|drug|medicine|medikament|m[eé]dicament|medicamento|medicinale|geneesmiddel|औषधि/i, id: "medication", name: "medication" },
    { regex: /dosage|frequency|dosierung|posologie|dosis|dosaggio|dosering|मात्रा/i, id: "dosage", name: "dosage" },
    { regex: /physician|doctor|arzt|m[eé]decin|m[eé]dico|dottore|arts|डाक्टर|चिकित्सक/i, id: "physician", name: "physician" }
];

export function matchColumnKeyword(text) {
    for (const col of TABLE_COL_DEFS) {
        if (col.regex.test(text)) return col;
    }
    return null;
}

export function reconstructTableGridBoxes(hLines, vLines = []) {
    if (!hLines || hLines.length < 2) return [];

    const cells = [];
    const yMap = new Map();
    hLines.forEach(l => {
        const roundedY = Math.round(l.y);
        let matchY = null;
        for (const existingY of yMap.keys()) {
            if (Math.abs(existingY - roundedY) <= 2) {
                matchY = existingY;
                break;
            }
        }
        if (matchY === null) {
            yMap.set(roundedY, [l]);
        } else {
            yMap.get(matchY).push(l);
        }
    });

    const uniqueYs = Array.from(yMap.keys()).sort((a, b) => a - b);

    for (let i = 0; i < uniqueYs.length - 1; i++) {
        const yTop = uniqueYs[i];
        const yBottom = uniqueYs[i + 1];
        const h = yBottom - yTop;
        if (h < 8 || h > 75) continue;

        const topH = yMap.get(yTop) || [];
        const botH = yMap.get(yBottom) || [];

        // Only generate cells for rows that are part of a genuine table grid.
        // A real table grid has ≥2 additional rows at a similar x-span and similar row height.
        // This prevents isolated section-header hLine pairs from producing phantom input cells.
        const rowH = h;
        const consistentRows = uniqueYs.filter((y, idx) => {
            if (y === yTop) return false;
            const nextY = uniqueYs[idx + 1];
            if (nextY === undefined) return false;
            const candidateH = nextY - y;
            if (candidateH < 8 || candidateH > 75) return false;
            // Height within 30% of current row
            if (Math.abs(candidateH - rowH) > rowH * 0.4) return false;
            // x-span must match within 12pt on each side for at least one line pair
            const cTopH = yMap.get(y) || [];
            const cBotH = yMap.get(nextY) || [];
            return topH.some(tl =>
                cTopH.some(cl => Math.abs(cl.x1 - tl.x1) <= 14 && Math.abs(cl.x2 - tl.x2) <= 14) ||
                cBotH.some(cl => Math.abs(cl.x1 - tl.x1) <= 14 && Math.abs(cl.x2 - tl.x2) <= 14)
            );
        });
        if (consistentRows.length < 1) continue;

        for (const tLine of topH) {
            for (const bLine of botH) {
                const x1 = Math.max(tLine.x1, bLine.x1);
                const x2 = Math.min(tLine.x2, bLine.x2);
                if (x2 - x1 < 25) continue;

                // Find vertical divider lines spanning between yTop and yBottom
                const dividers = [x1];
                if (vLines && vLines.length > 0) {
                    for (const vl of vLines) {
                        if (vl.y1 <= yTop + 4 && vl.y2 >= yBottom - 4) {
                            if (vl.x >= x1 + 10 && vl.x <= x2 - 10) {
                                dividers.push(Math.round(vl.x));
                            }
                        }
                    }
                }
                dividers.push(x2);
                const sortedDividers = Array.from(new Set(dividers)).sort((a, b) => a - b);

                for (let d = 0; d < sortedDividers.length - 1; d++) {
                    const cellLeft = sortedDividers[d];
                    const cellRight = sortedDividers[d + 1];
                    const w = cellRight - cellLeft;
                    if (w >= 15 && w <= 555) {
                        cells.push({
                            x: Math.round(cellLeft),
                            y: Math.round(yTop),
                            width: Math.round(w),
                            height: Math.round(h)
                        });
                    }
                }
            }
        }
    }

    // Deduplicate any cells that share essentially the same bounding box
    const uniqueCells = [];
    for (const c of cells) {
        if (!uniqueCells.some(u => Math.abs(u.x - c.x) <= 3 && Math.abs(u.y - c.y) <= 3 && Math.abs(u.width - c.width) <= 4 && Math.abs(u.height - c.height) <= 4)) {
            uniqueCells.push(c);
        }
    }

    return uniqueCells;
}

export async function detectTableGridLines(page) {
    const RENDER_SCALE = 2; // enough resolution for thin ruling lines, cheap to scan
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    let canvas, ctx;
    try {
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        ctx = canvas.getContext("2d", { willReadFrequently: true });
        await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (err) {
        console.error("Table-grid render failed, falling back to text-based table detection:", err);
        return [];
    }

    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
        console.error("Could not read rendered pixels for table detection:", err);
        return [];
    }

    const { data, width, height } = imageData;
    const DARK_THRESHOLD = 200; // luminance below this counts as "ink"
    const isDark = (x, y) => {
        const idx = (y * width + x) * 4;
        const luminance = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        return luminance < DARK_THRESHOLD;
    };

    // A real ruling line produces one very long contiguous run of dark
    // pixels along its row/column. Scattered text produces many short runs
    // instead, so a length threshold cleanly separates the two.
    const MIN_LINE_RUN = 120 * RENDER_SCALE;
    const MIN_BOUNDARY_RUN = 40 * RENDER_SCALE;

    const rowBestRun = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
        let run = 0, best = 0;
        for (let x = 0; x < width; x++) {
            if (isDark(x, y)) { run++; if (run > best) best = run; }
            else run = 0;
        }
        rowBestRun[y] = best;
    }

    const colBestRun = new Array(width).fill(0);
    for (let x = 0; x < width; x++) {
        let run = 0, best = 0;
        for (let y = 0; y < height; y++) {
            if (isDark(x, y)) { run++; if (run > best) best = run; }
            else run = 0;
        }
        colBestRun[x] = best;
    }

    function findLineSegments(minRun, horizontal) {
        const segments = [];
        const limit = horizontal ? height : width;
        for (let offset = 0; offset < limit; offset++) {
            let bestStart = -1, bestEnd = -1, runStart = -1;
            const span = horizontal ? width : height;
            for (let cursor = 0; cursor <= span; cursor++) {
                const dark = cursor < span && (horizontal ? isDark(cursor, offset) : isDark(offset, cursor));
                if (dark && runStart < 0) runStart = cursor;
                if ((!dark || cursor === span) && runStart >= 0) {
                    if (cursor - runStart > bestEnd - bestStart) {
                        bestStart = runStart;
                        bestEnd = cursor;
                    }
                    runStart = -1;
                }
            }
            if (bestEnd - bestStart >= minRun) {
                segments.push({ offset, start: bestStart, end: bestEnd });
            }
        }

        const merged = [];
        for (const segment of segments) {
            const previous = merged[merged.length - 1];
            if (previous &&
                segment.offset - previous.offset <= 3 &&
                segment.start <= previous.end + 6 &&
                segment.end >= previous.start - 6) {
                previous.offset = Math.round((previous.offset + segment.offset) / 2);
                previous.start = Math.min(previous.start, segment.start);
                previous.end = Math.max(previous.end, segment.end);
            } else {
                merged.push({ ...segment });
            }
        }
        return merged;
    }

    async function getVectorBoundaryLines(page, scale = 2) {
        const result = { horizontal: [], vertical: [] };
        if (!page.getOperatorList || typeof pdfjsLib === "undefined" || !pdfjsLib.OPS) return result;

        let operatorList;
        try {
            operatorList = await page.getOperatorList();
        } catch (err) {
            console.warn("Could not read PDF drawing operators:", err);
            return result;
        }

        const OPS = pdfjsLib.OPS;
        const stack = [];
        let matrix = [1, 0, 0, 1, 0, 0];
        let pathStart = null;
        let current = null;
        const multiply = (left, right) => [
            left[0] * right[0] + left[2] * right[1],
            left[1] * right[0] + left[3] * right[1],
            left[0] * right[2] + left[2] * right[3],
            left[1] * right[2] + left[3] * right[3],
            left[0] * right[4] + left[2] * right[5] + left[4],
            left[1] * right[4] + left[3] * right[5] + left[5]
        ];
        const point = (x, y) => {
            const pdfPoint = [
                matrix[0] * x + matrix[2] * y + matrix[4],
                matrix[1] * x + matrix[3] * y + matrix[5]
            ];
            const viewportPoint = page.getViewport({ scale }).convertToViewportPoint(...pdfPoint);
            return { x: viewportPoint[0], y: viewportPoint[1] };
        };
        const addSegment = (a, b) => {
            if (!a || !b) return;
            const dx = Math.abs(a.x - b.x);
            const dy = Math.abs(a.y - b.y);
            if (dx >= 80 && dy <= 3) result.horizontal.push({ offset: Math.round((a.y + b.y) / 2), start: Math.round(Math.min(a.x, b.x)), end: Math.round(Math.max(a.x, b.x)) });
            if (dy >= 80 && dx <= 3) result.vertical.push({ offset: Math.round((a.x + b.x) / 2), start: Math.round(Math.min(a.y, b.y)), end: Math.round(Math.max(a.y, b.y)) });
        };

        for (let i = 0; i < operatorList.fnArray.length; i++) {
            const fn = operatorList.fnArray[i];
            const args = operatorList.argsArray[i] || [];
            if (fn === OPS.save) stack.push(matrix);
            else if (fn === OPS.restore) matrix = stack.pop() || matrix;
            else if (fn === OPS.transform) matrix = multiply(matrix, args);
            else if (fn === OPS.moveTo) {
                current = point(args[0], args[1]);
                pathStart = current;
            } else if (fn === OPS.lineTo) {
                const next = point(args[0], args[1]);
                addSegment(current, next);
                current = next;
            } else if (fn === OPS.rectangle) {
                const [x, y, w, h] = args;
                const p1 = point(x, y), p2 = point(x + w, y);
                const p3 = point(x + w, y + h), p4 = point(x, y + h);
                addSegment(p1, p2);
                addSegment(p2, p3);
                addSegment(p3, p4);
                addSegment(p4, p1);
                current = p1;
                pathStart = p1;
            } else if (fn === OPS.closePath && current && pathStart) {
                addSegment(current, pathStart);
                current = pathStart;
            }
        }
        return result;
    }

    const horizontalLines = findLineSegments(MIN_BOUNDARY_RUN, true);
    const verticalLines = findLineSegments(MIN_BOUNDARY_RUN, false);
    const vectorLines = await getVectorBoundaryLines(page, RENDER_SCALE);
    if (vectorLines?.horizontal?.length) {
        for (const l of vectorLines.horizontal) horizontalLines.push(l);
    }
    if (vectorLines?.vertical?.length) {
        for (const l of vectorLines.vertical) verticalLines.push(l);
    }

    function mergeAdjacent(candidates, maxGap = 3) {
        const merged = [];
        let clusterStart = null, clusterEnd = null;
        for (const c of candidates) {
            if (clusterStart === null) {
                clusterStart = clusterEnd = c;
            } else if (c - clusterEnd <= maxGap) {
                clusterEnd = c;
            } else {
                merged.push(Math.round((clusterStart + clusterEnd) / 2));
                clusterStart = clusterEnd = c;
            }
        }
        if (clusterStart !== null) merged.push(Math.round((clusterStart + clusterEnd) / 2));
        return merged;
    }

    const hCandidates = [];
    for (let y = 0; y < height; y++) if (rowBestRun[y] >= MIN_LINE_RUN) hCandidates.push(y);
    const vCandidates = [];
    for (let x = 0; x < width; x++) if (colBestRun[x] >= MIN_LINE_RUN) vCandidates.push(x);

    const hLinesPx = mergeAdjacent(hCandidates);
    const vLinesPx = mergeAdjacent(vCandidates);

    // Need at least 2 rows (3 horizontal boundaries) and 2 columns (3
    // vertical boundaries) to call this a real table grid rather than a
    // stray horizontal rule under a title or a single vertical divider.
    if (hLinesPx.length < 3 || vLinesPx.length < 3) {
        return [{ rowsY: [], colsX: [], horizontalLines, verticalLines }];
    }

    // Convert back from render-pixel space to the same viewport-scale-1.0,
    // top-left-origin coordinate space that rawBlocks and fields already use.
    const rowsY = hLinesPx.map(y => y / RENDER_SCALE).sort((a, b) => a - b);
    const colsX = vLinesPx.map(x => x / RENDER_SCALE).sort((a, b) => a - b);

    return [{ rowsY, colsX, horizontalLines, verticalLines }];
}

// Builds fields directly from a detected ruling-line grid: the header row's
// text (row 0) names each column, and every EMPTY cell in the data rows
// below it becomes a field sized exactly to that cell — no guessed spacing,
// no guessed width, because the grid lines already give us the true bounds.
export function buildFieldsFromTableGrid(grid, rawBlocks, pageNum, usedNames) {
    const { rowsY, colsX } = grid;
    if (rowsY.length < 3 || colsX.length < 3) return { fields: [], region: null };

    const CELL_PAD = 2;
    const numCols = colsX.length - 1;
    const numRows = rowsY.length - 1;

    // Check robust bounding-box overlap so no static text is covered
    const textInCell = (x0, y0, x1, y1) => rawBlocks.filter(tb => {
        const overlapX = Math.max(0, Math.min(x1, tb.x + tb.width) - Math.max(x0, tb.x));
        const overlapY = Math.max(0, Math.min(y1, tb.y + tb.height) - Math.max(y0, tb.y));
        return (overlapX > 2 && overlapY > 2);
    });

    // Calculate row heights to find the median table row height
    const allRowHeights = [];
    for (let r = 0; r < numRows; r++) {
        const h = rowsY[r + 1] - rowsY[r];
        if (h >= 10 && h <= 80) allRowHeights.push(h);
    }
    allRowHeights.sort((a, b) => a - b);
    const medianRowH = allRowHeights.length > 0 
        ? allRowHeights[Math.floor(allRowHeights.length / 2)]
        : 22;

    // Header row = row 0. Name each column from its header cell's text,
    // matched against the shared keyword vocabulary, falling back to the
    // header's own text (sanitized) so untranslated vocabulary still works.
    const columns = [];
    for (let c = 0; c < numCols; c++) {
        const x0 = colsX[c], x1 = colsX[c + 1];
        const y0 = rowsY[0], y1 = rowsY[1];
        const headerText = textInCell(x0, y0, x1, y1).sort((a, b) => a.x - b.x).map(tb => tb.str).join(" ").trim();
        const known = headerText ? matchColumnKeyword(headerText) : null;
        const cleanName = headerText.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `col_${c + 1}`;
        columns.push({
            id: known ? known.id : cleanName,
            name: known ? known.name : (headerText || `Column ${c + 1}`),
            x0, x1
        });
    }

    const fields = [];
    for (let r = 1; r < numRows; r++) { // skip header row (r=0)
        const y0 = rowsY[r], y1 = rowsY[r + 1];
        const cellH = y1 - y0;

        // GUARD 1: Table row height sanity check
        // If a row is significantly taller than the median row height of the table (e.g. 117px gap vs 20px rows),
        // it is an inter-section layout gap between the table and notes/footer, NOT a table data row!
        if (cellH > Math.max(38, medianRowH * 2.0)) {
            continue;
        }

        for (const col of columns) {
            const x0 = col.x0, x1 = col.x1;
            const cellW = x1 - x0;
            if (cellW < 12 || cellH < 10) continue; // too small to be a usable field

            // GUARD 2: Don't overwrite a cell that has static text (like $ symbol, BALANCE DUE, Tax, etc.)
            const existingText = textInCell(x0, y0, x1, y1);
            if (existingText.some(tb => tb.str.replace(/[\s.,$]/g, "").length > 0)) continue;

            const isCheckboxCol = /^(?:taxable|receipt)$/i.test(col.id) || /^(?:taxable|receipt)$/i.test(col.name);
            const sem = resolveSemanticProps(col.name, isCheckboxCol ? "checkBox" : "textField", usedNames);

            const field = isCheckboxCol ? {
                id: generateFieldId(),
                type: "checkBox",
                name: sem.name,
                x: Math.round(x0 + cellW / 2 - 8),
                y: Math.round(y0 + cellH / 2 - 8),
                width: 16,
                height: 16,
                page: pageNum,
                borderStyle: "solid",
                fillStyle: "white",
                multiline: false,
                autofill: "",
                dataFormat: "text",
                tooltip: (col.headerText || col.id).replace(/[:_—–-]+$/, '').trim(),
                detectedBy: `affordance4b_lattice_col-${col.id}_row-${r}`,
                confidence: 0.93
            } : {
                id: generateFieldId(),
                type: "textField",
                name: sem.name,
                x: Math.round(x0 + CELL_PAD),
                y: Math.round(y0 + CELL_PAD),
                width: Math.round(cellW - CELL_PAD * 2),
                height: Math.round(cellH - CELL_PAD * 2),
                page: pageNum,
                borderStyle: "solid",
                fillStyle: "white",
                multiline: false,
                autofill: sem.autofill || "",
                dataFormat: (col.id === "amount" || col.id === "unit_price") ? "currency" : ((col.id === "qty") ? "number" : "text"),
                tooltip: (col.headerText || col.id).replace(/[:_—–-]+$/, '').trim(),
                detectedBy: `affordance4b_lattice_col-${col.id}_row-${r}`,
                confidence: 0.93
            };
            fields.push(field);
        }
    }

    const region = {
        xMin: colsX[0] - 5,
        xMax: colsX[colsX.length - 1] + 5,
        yMin: rowsY[0] - 5,
        yMax: rowsY[rowsY.length - 1] + 5
    };

    return { fields, region };
}

export async function detectLatticeTableFields(page, rawBlocks, pageNum, usedNames, detectedGrids = null) {
    let grids;
    try {
        grids = detectedGrids || await detectTableGridLines(page);
    } catch (err) {
        console.error("Lattice table detection failed, falling back to text-based table detection:", err);
        return { fields: [], regions: [] };
    }

    const allFields = [];
    const regions = [];
    for (const grid of grids) {
        if (!grid.rowsY?.length || !grid.colsX?.length) continue;
        const { fields, region } = buildFieldsFromTableGrid(grid, rawBlocks, pageNum, usedNames);
        if (fields.length > 0 && region) {
            allFields.push(...fields);
            regions.push(region);
        }
    }
    return { fields: allFields, regions };
}

/**
 * Uniform stage detection plugin contract for lattice table grids.
 * @param {Object} context Stage detection context
 * @returns {Promise<Array>} Detected table cell fields
 */
export async function detect(context = {}) {
    const {
        page,
        rawBlocks = [],
        pageNum = 1,
        usedNames = new Set(),
        boundaryLines = null,
        detectedGrids = boundaryLines
    } = context;
    if (!page) return [];
    const result = await detectLatticeTableFields(page, rawBlocks, pageNum, usedNames, detectedGrids);
    if (context.sharedData) {
        context.sharedData.latticeRegions = result.regions || [];
    }
    return result.fields || [];
}
