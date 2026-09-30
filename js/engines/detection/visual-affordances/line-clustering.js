// js/engines/detection/visual-affordances/line-clustering.js
// Scaffolding stub for line clustering

export function clusterIntoLines(blocks) {
    if (!blocks || blocks.length === 0) return [];
    const sorted = [...blocks].sort((a, b) => (Math.abs(a.y - b.y) <= 4 ? a.x - b.x : a.y - b.y));
    const lines = [];
    let currentLine = null;

    for (let b of sorted) {
        const fontH = Math.max(6, b.height || 12);

        if (!currentLine) {
            currentLine = { ...b, items: [b] };
        } else {
            const refFontH = Math.max(6, currentLine.height || fontH);
            const baselineTolerance = Math.max(6, refFontH * 0.5);
            const gapTolerance = Math.max(60, refFontH * 4);

            const sameBaseline = Math.abs(currentLine.y - b.y) <= baselineTolerance;
            const reasonableGap = b.x >= currentLine.x && (b.x - (currentLine.x + currentLine.width)) <= gapTolerance;

            if (sameBaseline && reasonableGap) {
                currentLine.str += " " + b.str;
                currentLine.width = (b.x + b.width) - currentLine.x;
                currentLine.height = Math.max(currentLine.height, b.height);
                currentLine.items.push(b);
            } else {
                lines.push(currentLine);
                currentLine = { ...b, items: [b] };
            }
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}
