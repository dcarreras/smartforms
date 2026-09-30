// js/engines/detection/vector-shapes.js
// Vector shape extraction from PDF operator lists and column boundary computation

/**
 * Compute 2D horizontal & vertical projection profiles to detect page margins, column boundaries, and gutters.
 */
export function calculateDocumentColumnBoundaries(rawBlocks, pageWidth, pageHeight) {
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
        return { margins: { left: 40, right: pageWidth - 40 }, columns: [{ x: 40, width: pageWidth - 80, right: pageWidth - 40 }] };
    }

    const sortedLefts = rawBlocks.map(b => b.x).filter(x => x > 15 && x < pageWidth * 0.4).sort((a, b) => a - b);
    const sortedRights = rawBlocks.map(b => b.x + b.width).filter(x => x > pageWidth * 0.6 && x < pageWidth - 15).sort((a, b) => a - b);

    const marginLeft = sortedLefts.length > 0 ? sortedLefts[Math.floor(sortedLefts.length * 0.1)] : 40;
    const marginRight = sortedRights.length > 0 ? sortedRights[Math.floor(sortedRights.length * 0.9)] : pageWidth - 40;

    const binSize = 10;
    const numBins = Math.ceil(pageWidth / binSize);
    const occupancy = new Uint16Array(numBins);

    for (const b of rawBlocks) {
        const startBin = Math.max(0, Math.floor(b.x / binSize));
        const endBin = Math.min(numBins - 1, Math.floor((b.x + b.width) / binSize));
        for (let bin = startBin; bin <= endBin; bin++) {
            occupancy[bin]++;
        }
    }

    const gutters = [];
    let inGutter = false;
    let gutterStart = 0;

    const searchStartBin = Math.floor(marginLeft / binSize) + 2;
    const searchEndBin = Math.floor(marginRight / binSize) - 2;

    for (let bin = searchStartBin; bin <= searchEndBin; bin++) {
        const isLowOccupancy = occupancy[bin] <= 1;
        if (isLowOccupancy && !inGutter) {
            inGutter = true;
            gutterStart = bin * binSize;
        } else if (!isLowOccupancy && inGutter) {
            inGutter = false;
            const gutterEnd = bin * binSize;
            if (gutterEnd - gutterStart >= 20) {
                gutters.push({ x: gutterStart, width: gutterEnd - gutterStart });
            }
        }
    }

    const columns = [];
    let curX = marginLeft;
    for (const g of gutters) {
        if (g.x - curX >= 100) {
            columns.push({ x: curX, width: g.x - curX, right: g.x });
            curX = g.x + g.width;
        }
    }
    if (marginRight - curX >= 100) {
        columns.push({ x: curX, width: marginRight - curX, right: marginRight });
    }

    if (columns.length === 0) {
        columns.push({ x: marginLeft, width: Math.max(100, marginRight - marginLeft), right: marginRight });
    }

    return {
        margins: { left: marginLeft, right: marginRight },
        columns,
        gutters
    };
}

export async function extractPdfVectorShapes(pageOrOpList, viewport = { width: 612, height: 792 }) {
    const result = {
        checkboxRects: [],
        inputBoxRects: [],
        allRects: [],
        underlines: []
    };
    if (!pageOrOpList) return result;

    const hLines = [];
    const vLines = [];

    let operatorList;
    if (pageOrOpList.fnArray && pageOrOpList.argsArray) {
        operatorList = pageOrOpList;
    } else if (typeof pageOrOpList.getOperatorList === "function") {
        try {
            operatorList = await pageOrOpList.getOperatorList();
        } catch (err) {
            return result;
        }
    } else {
        return result;
    }

    const OPS = (typeof pdfjsLib !== "undefined" && pdfjsLib.OPS) ? pdfjsLib.OPS : {
        save: 1, restore: 2, transform: 3, moveTo: 13, lineTo: 14, curveTo: 15,
        curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19, stroke: 20,
        closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, closeFillStroke: 26,
        constructPath: 92
    };

    const stack = [];
    let matrix = [1, 0, 0, 1, 0, 0];
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
        const vp = (viewport && typeof viewport.convertToViewportPoint === "function")
            ? viewport.convertToViewportPoint(...pdfPoint)
            : [pdfPoint[0], (viewport?.height || 792) - pdfPoint[1]];
        return { x: Math.round(vp[0]), y: Math.round(vp[1]) };
    };

    let current = null;
    let pathStart = null;
    let currentPolyline = [];

    const addRectCandidate = (minX, minY, w, h) => {
        if (w >= 6 && w <= 555 && h >= 6 && h <= 120) {
            result.allRects.push({ x: minX, y: minY, width: w, height: h });
        }
        if (w >= 6.5 && w <= 32 && h >= 6.5 && h <= 30 && (w / h >= 0.5 && w / h <= 2.2)) {
            result.checkboxRects.push({ x: minX, y: minY, width: w, height: h });
        } else if (h >= 8 && h <= 85 && w >= 15 && w <= 555) {
            result.inputBoxRects.push({ x: minX, y: minY, width: w, height: h });
        }
    };

    const checkClosedPolylineBox = (poly) => {
        if (!poly || poly.length < 4 || poly.length > 20) return;
        const xs = poly.map(p => p.x);
        const ys = poly.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const w = maxX - minX;
        const h = maxY - minY;
        if (w >= 8 && h >= 8) {
            // Check that points align near the boundary box (allowing rounded corner arcs up to 8px offset)
            const maxTolerance = (poly.length > 6) ? 8 : 4;
            const isNearBox = poly.every(p => 
                (Math.abs(p.x - minX) <= maxTolerance || Math.abs(p.x - maxX) <= maxTolerance) ||
                (Math.abs(p.y - minY) <= maxTolerance || Math.abs(p.y - maxY) <= maxTolerance)
            );
            if (isNearBox) {
                addRectCandidate(minX, minY, w, h);
            }
        }
    };

    for (let i = 0; i < (operatorList.fnArray || []).length; i++) {
        const fn = operatorList.fnArray[i];
        const args = operatorList.argsArray[i] || [];

        if (fn === OPS.save) {
            stack.push([...matrix]);
        } else if (fn === OPS.restore) {
            matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
        } else if (fn === OPS.transform) {
            matrix = multiply(matrix, args);
        } else if (fn === OPS.rectangle) {
            const p1 = point(args[0], args[1]);
            const p2 = point(args[0] + args[2], args[1] + args[3]);
            const minX = Math.min(p1.x, p2.x);
            const minY = Math.min(p1.y, p2.y);
            const w = Math.abs(p1.x - p2.x);
            const h = Math.abs(p1.y - p2.y);
            addRectCandidate(minX, minY, w, h);
        } else if (fn === OPS.moveTo) {
            current = point(args[0], args[1]);
            pathStart = current;
            currentPolyline = [current];
        } else if (fn === OPS.lineTo) {
            const next = point(args[0], args[1]);
            if (current) {
                currentPolyline.push(next);
                const dx = Math.abs(next.x - current.x);
                const dy = Math.abs(next.y - current.y);
                if (dy <= 3 && dx >= 40) {
                    hLines.push({
                        x1: Math.min(current.x, next.x),
                        x2: Math.max(current.x, next.x),
                        y: Math.round((current.y + next.y) / 2)
                    });
                } else if (dx <= 3 && dy >= 20) {
                    vLines.push({
                        x: Math.round((current.x + next.x) / 2),
                        y1: Math.min(current.y, next.y),
                        y2: Math.max(current.y, next.y)
                    });
                }
            }
            current = next;
        } else if (fn === OPS.closePath) {
            if (pathStart && current) {
                currentPolyline.push(pathStart);
                checkClosedPolylineBox(currentPolyline);
            }
            current = pathStart;
            currentPolyline = [];
        } else if (fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.closeFillStroke) {
            if (currentPolyline.length >= 4) {
                checkClosedPolylineBox(currentPolyline);
            }
            currentPolyline = [];
        } else if (fn === OPS.constructPath) {
            const subOps = args[0] || [];
            const subArgs = args[1] || [];
            let argIndex = 0;
            let subCurrent = null;
            let subStart = null;
            let subPolyline = [];

            for (const subOp of subOps) {
                if (subOp === OPS.moveTo) {
                    subCurrent = point(subArgs[argIndex], subArgs[argIndex + 1]);
                    subStart = subCurrent;
                    subPolyline = [subCurrent];
                    argIndex += 2;
                } else if (subOp === OPS.lineTo) {
                    const next = point(subArgs[argIndex], subArgs[argIndex + 1]);
                    if (subCurrent) {
                        subPolyline.push(next);
                        const dx = Math.abs(next.x - subCurrent.x);
                        const dy = Math.abs(next.y - subCurrent.y);
                        if (dy <= 3 && dx >= 40) {
                            hLines.push({
                                x1: Math.min(subCurrent.x, next.x),
                                x2: Math.max(subCurrent.x, next.x),
                                y: Math.round((subCurrent.y + next.y) / 2)
                            });
                        } else if (dx <= 3 && dy >= 20) {
                            vLines.push({
                                x: Math.round((subCurrent.x + next.x) / 2),
                                y1: Math.min(subCurrent.y, next.y),
                                y2: Math.max(subCurrent.y, next.y)
                            });
                        }
                    }
                    subCurrent = next;
                    argIndex += 2;
                } else if (subOp === OPS.rectangle) {
                    const p1 = point(subArgs[argIndex], subArgs[argIndex + 1]);
                    const p2 = point(subArgs[argIndex] + subArgs[argIndex + 2], subArgs[argIndex + 1] + subArgs[argIndex + 3]);
                    const minX = Math.min(p1.x, p2.x);
                    const minY = Math.min(p1.y, p2.y);
                    const w = Math.abs(p1.x - p2.x);
                    const h = Math.abs(p1.y - p2.y);
                    addRectCandidate(minX, minY, w, h);
                    argIndex += 4;
                } else if (subOp === OPS.closePath) {
                    if (subStart && subCurrent) {
                        subPolyline.push(subStart);
                        checkClosedPolylineBox(subPolyline);
                    }
                    subCurrent = subStart;
                    subPolyline = [];
                } else if (subOp === OPS.curveTo || subOp === OPS.curveTo2 || subOp === OPS.curveTo3) {
                    const step = subOp === OPS.curveTo ? 6 : 4;
                    const destX = subArgs[argIndex + step - 2];
                    const destY = subArgs[argIndex + step - 1];
                    const next = point(destX, destY);
                    if (subCurrent) {
                        subPolyline.push(next);
                    }
                    subCurrent = next;
                    argIndex += step;
                }
            }
            if (subPolyline.length >= 4) {
                checkClosedPolylineBox(subPolyline);
            }
        }
    }

    // Connect vertical and horizontal lines that form closed input boxes
    for (const h1 of hLines) {
        for (const h2 of hLines) {
            if (h1 === h2) continue;
            const dy = Math.abs(h1.y - h2.y);
            if (dy < 10 || dy > 60) continue;
            const overlapStart = Math.max(h1.x1, h2.x1);
            const overlapEnd = Math.min(h1.x2, h2.x2);
            const overlapW = overlapEnd - overlapStart;
            if (overlapW < 30) continue;

            const leftV = vLines.some(v => Math.abs(v.x - overlapStart) <= 4 &&
                v.y1 <= Math.min(h1.y, h2.y) + 3 && v.y2 >= Math.max(h1.y, h2.y) - 3);
            const rightV = vLines.some(v => Math.abs(v.x - overlapEnd) <= 4 &&
                v.y1 <= Math.min(h1.y, h2.y) + 3 && v.y2 >= Math.max(h1.y, h2.y) - 3);

            if (leftV && rightV) {
                addRectCandidate(overlapStart, Math.min(h1.y, h2.y), overlapW, dy);
            }
        }
    }

    // Deduplicate candidate rects
    const dedupe = (rects) => {
        const unique = [];
        for (const r of rects) {
            const exists = unique.some(u => 
                Math.abs(u.x - r.x) <= 3 && Math.abs(u.y - r.y) <= 3 &&
                Math.abs(u.width - r.width) <= 4 && Math.abs(u.height - r.height) <= 4
            );
            if (!exists) unique.push(r);
        }
        return unique;
    };

    result.checkboxRects = dedupe(result.checkboxRects);
    result.inputBoxRects = dedupe(result.inputBoxRects);
    result.allRects = dedupe(result.allRects);
    result.underlines = hLines.map(l => ({ x: l.x1, y: l.y, width: l.x2 - l.x1, height: 2 }));

    return result;
}
