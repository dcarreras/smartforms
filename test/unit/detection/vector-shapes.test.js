import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfVectorShapes, calculateDocumentColumnBoundaries } from './module-loader.js';

describe('vector-shapes', () => {
    const OPS = {
        save: 1, restore: 2, transform: 3, moveTo: 13, lineTo: 14,
        rectangle: 19, stroke: 20, fill: 22, constructPath: 92
    };

    describe('extractPdfVectorShapes', () => {
        it('returns empty lists on null or empty operator list', async () => {
            const res = await extractPdfVectorShapes(null);
            assert.deepEqual(res.checkboxRects, []);
            assert.deepEqual(res.inputBoxRects, []);
            assert.deepEqual(res.allRects, []);
            assert.deepEqual(res.underlines, []);
        });

        it('extracts rectangle ops into checkboxRects, inputBoxRects, and allRects at boundaries', async () => {
            // PDF coordinates: (x, y, w, h). viewport conversion: y_vp = viewport.height - y - h (or similar)
            // Default viewport: { width: 612, height: 792 }
            const opList = {
                fnArray: [
                    OPS.rectangle, // 1. Standard checkbox (14x14)
                    OPS.rectangle, // 2. Standard input box (150x24)
                    OPS.rectangle, // 3. Sub-minimum rect (4x4) -> rejected from allRects
                    OPS.rectangle, // 4. Too wide rect (580x20) -> rejected (w > 555)
                    OPS.rectangle, // 5. Checkbox boundary minimum (6.5 x 6.5)
                    OPS.rectangle  // 6. Checkbox boundary maximum (32 x 30)
                ],
                argsArray: [
                    [50, 700, 14, 14],
                    [50, 600, 150, 24],
                    [50, 500, 4, 4],
                    [50, 400, 580, 20],
                    [50, 300, 7, 7],
                    [50, 200, 32, 30]
                ]
            };

            const res = await extractPdfVectorShapes(opList, { width: 612, height: 792 });

            // Checkbox 1: w=14, h=14
            assert.ok(res.checkboxRects.some(r => r.width === 14 && r.height === 14));
            // Input box 2: w=150, h=24
            assert.ok(res.inputBoxRects.some(r => r.width === 150 && r.height === 24));
            // 4x4 rect rejected from allRects
            assert.ok(!res.allRects.some(r => r.width === 4 && r.height === 4));
            // 580x20 rect rejected from allRects
            assert.ok(!res.allRects.some(r => r.width === 580));
            // Checkbox boundary min (7x7) and max (32x30)
            assert.ok(res.checkboxRects.some(r => r.width === 7 && r.height === 7));
            assert.ok(res.checkboxRects.some(r => r.width === 32 && r.height === 30));
        });

        it('extracts horizontal line strokes into underlines', async () => {
            const opList = {
                fnArray: [
                    OPS.moveTo,
                    OPS.lineTo,
                    OPS.stroke
                ],
                argsArray: [
                    [100, 500],
                    [300, 500],
                    []
                ]
            };

            const res = await extractPdfVectorShapes(opList, { width: 612, height: 792 });
            assert.ok(res.underlines.length >= 1);
            const u = res.underlines[0];
            assert.equal(u.width, 200);
            assert.equal(u.x, 100);
        });

        it('extracts closed polyline rectangle box into allRects', async () => {
            // A closed path forming a 100x20 rectangle
            const opList = {
                fnArray: [
                    OPS.moveTo,
                    OPS.lineTo,
                    OPS.lineTo,
                    OPS.lineTo,
                    OPS.lineTo,
                    OPS.stroke
                ],
                argsArray: [
                    [100, 400],
                    [200, 400],
                    [200, 420],
                    [100, 420],
                    [100, 400],
                    []
                ]
            };

            const res = await extractPdfVectorShapes(opList, { width: 612, height: 792 });
            assert.ok(res.allRects.some(r => r.width === 100 && r.height === 20));
        });
    });

    describe('calculateDocumentColumnBoundaries', () => {
        it('returns default margins and single column when rawBlocks is empty', () => {
            const res = calculateDocumentColumnBoundaries([], 612, 792);
            assert.deepEqual(res.margins, { left: 40, right: 572 });
            assert.equal(res.columns.length, 1);
            assert.equal(res.columns[0].x, 40);
            assert.equal(res.columns[0].width, 532);
        });

        it('detects two column boundaries and gutters from split text distribution', () => {
            // Left column text blocks: x from 50 to 220
            // Right column text blocks: x from 320 to 520
            // Gutter between 220 and 320 (width = 100)
            const rawBlocks = [
                { x: 50, y: 100, width: 170, height: 12 },
                { x: 50, y: 130, width: 170, height: 12 },
                { x: 50, y: 160, width: 170, height: 12 },
                { x: 320, y: 100, width: 200, height: 12 },
                { x: 320, y: 130, width: 200, height: 12 },
                { x: 320, y: 160, width: 200, height: 12 }
            ];

            const res = calculateDocumentColumnBoundaries(rawBlocks, 612, 792);
            assert.ok(res.gutters.length >= 1, 'Expected at least 1 gutter');
            assert.ok(res.columns.length >= 2, 'Expected 2 columns detected');
            assert.ok(res.gutters[0].x >= 220 && res.gutters[0].x <= 320);
        });
    });
});
