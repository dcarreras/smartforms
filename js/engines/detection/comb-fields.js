// js/engines/detection/comb-fields.js
// Segmented character box (comb) detection and clustering

export function clusterCombBoxes(rects) {
    if (!rects || rects.length < 2) return [];
    // Filter to small boxes suitable for character cells (width 8-36, height 10-36)
    const sorted = rects.filter(r => r.width >= 8 && r.width <= 36 && r.height >= 10 && r.height <= 36)
        .sort((a, b) => {
            const yDiff = a.y - b.y;
            if (Math.abs(yDiff) > 4) return yDiff;
            return a.x - b.x;
        });

    // Deduplicate candidate boxes that share essentially the same origin (multiple vector strokes for same box)
    const candidates = [];
    for (const cand of sorted) {
        const isDupe = candidates.some(d => Math.abs(d.x - cand.x) <= 6 && Math.abs(d.y - cand.y) <= 4);
        if (!isDupe) {
            candidates.push(cand);
        }
    }

    const clusters = [];
    const usedIndices = new Set();

    for (let i = 0; i < candidates.length; i++) {
        if (usedIndices.has(i)) continue;
        const currentCluster = [candidates[i]];
        let lastBox = candidates[i];

        for (let j = i + 1; j < candidates.length; j++) {
            if (usedIndices.has(j)) continue;
            const nextBox = candidates[j];
            if (Math.abs(nextBox.y - lastBox.y) > 4) break;
            if (Math.abs(nextBox.height - lastBox.height) > 4 || Math.abs(nextBox.width - lastBox.width) > 6) continue;
            const gap = nextBox.x - (lastBox.x + lastBox.width);
            
            // Character comb cells can be tall/narrow character slots (w/h < 0.85) or square cells (e.g. 14x14).
            // Allow up to 11.5pt gap between contiguous character slots (e.g. EIN or PIN spacing).
            // (Note: square clusters without comb keywords will be preserved as checkboxes in detectVectorDrawnFields).
            const isSquareOption = (lastBox.width / lastBox.height >= 0.85 && lastBox.width >= 10);
            const maxAllowedGap = isSquareOption ? 11.5 : 8.0;

            if (gap >= -2 && gap <= maxAllowedGap) {
                currentCluster.push(nextBox);
                usedIndices.add(j);
                lastBox = nextBox;
            }
        }

        if (currentCluster.length >= 3) {
            usedIndices.add(i);
            clusters.push(currentCluster);
        }
    }
    return clusters;
}
