import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clusterCombBoxes } from './module-loader.js';

describe('comb-fields', () => {
    describe('clusterCombBoxes', () => {
        it('returns empty array when rects is empty or has fewer than 2 elements', () => {
            assert.deepEqual(clusterCombBoxes([]), []);
            assert.deepEqual(clusterCombBoxes([{ x: 10, y: 10, width: 15, height: 20 }]), []);
        });

        it('clusters a series of contiguous character cells (e.g. 9-box SSN or 10-box Phone)', () => {
            // 9 contiguous character boxes of width 14, height 18 with 2pt gap
            const rects = [];
            for (let i = 0; i < 9; i++) {
                rects.push({
                    x: 100 + i * 16, // width 14 + gap 2 = 16
                    y: 200,
                    width: 14,
                    height: 18
                });
            }

            const clusters = clusterCombBoxes(rects);
            assert.equal(clusters.length, 1);
            assert.equal(clusters[0].length, 9);
            assert.equal(clusters[0][0].x, 100);
            assert.equal(clusters[0][8].x, 100 + 8 * 16);
        });

        it('requires at least 3 contiguous cells to form a comb cluster', () => {
            // Only 2 adjacent boxes
            const rects = [
                { x: 100, y: 200, width: 14, height: 18 },
                { x: 116, y: 200, width: 14, height: 18 }
            ];

            const clusters = clusterCombBoxes(rects);
            assert.equal(clusters.length, 0, 'Clusters with fewer than 3 boxes must not be formed');
        });

        it('does not cluster boxes across significant vertical displacement (yDiff > 4)', () => {
            const rects = [
                { x: 100, y: 200, width: 14, height: 18 },
                { x: 116, y: 200, width: 14, height: 18 },
                { x: 132, y: 208, width: 14, height: 18 } // yDiff = 8 > 4
            ];

            const clusters = clusterCombBoxes(rects);
            assert.equal(clusters.length, 0);
        });

        it('filters out boxes outside the character-cell size bounds (w: 8..36, h: 10..36)', () => {
            const rects = [
                { x: 100, y: 200, width: 6, height: 18 },  // too narrow (w < 8)
                { x: 116, y: 200, width: 40, height: 18 }, // too wide (w > 36)
                { x: 160, y: 200, width: 14, height: 8 },  // too short (h < 10)
                { x: 180, y: 200, width: 14, height: 42 }  // too tall (h > 36)
            ];

            const clusters = clusterCombBoxes(rects);
            assert.equal(clusters.length, 0);
        });

        it('handles near-boundary gaps: allows up to 11.5pt gap for square options and 8pt for tall slots', () => {
            // Square cells: 14x14 (ratio 1.0 >= 0.85). Gap 10 <= 11.5
            const squareRects = [
                { x: 100, y: 300, width: 14, height: 14 },
                { x: 124, y: 300, width: 14, height: 14 }, // gap = 10
                { x: 148, y: 300, width: 14, height: 14 }  // gap = 10
            ];
            const sqClusters = clusterCombBoxes(squareRects);
            assert.equal(sqClusters.length, 1);

            // Tall slots: 10x20 (ratio 0.5 < 0.85). Gap 10 > 8.0 (should NOT cluster)
            const tallRects = [
                { x: 100, y: 400, width: 10, height: 20 },
                { x: 120, y: 400, width: 10, height: 20 }, // gap = 10 > 8
                { x: 140, y: 400, width: 10, height: 20 }
            ];
            const tallClusters = clusterCombBoxes(tallRects);
            assert.equal(tallClusters.length, 0);
        });
    });
});
