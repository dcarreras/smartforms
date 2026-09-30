import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOverlapping, DEDUP_THRESHOLDS } from './module-loader.js';

describe('geometry', () => {
    describe('isOverlapping', () => {
        it('detects identical overlapping boxes as true', () => {
            const b1 = { x: 100, y: 100, width: 120, height: 24, page: 1 };
            const b2 = { x: 100, y: 100, width: 120, height: 24, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.35), true);
        });

        it('returns false for completely non-overlapping boxes', () => {
            const b1 = { x: 10, y: 10, width: 50, height: 20, page: 1 };
            const b2 = { x: 100, y: 100, width: 50, height: 20, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.20), false);
        });

        it('ignores comparison against itself when field IDs match', () => {
            const b1 = { id: 'field_abc', x: 50, y: 50, width: 100, height: 20, page: 1 };
            const b2 = { id: 'field_abc', x: 50, y: 50, width: 100, height: 20, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.25), false);
        });

        it('returns false when fields are on different pages', () => {
            const b1 = { x: 50, y: 50, width: 100, height: 20, page: 1 };
            const b2 = { x: 50, y: 50, width: 100, height: 20, page: 2 };
            assert.equal(isOverlapping(b1, [b2], 0.20), false);
        });

        it('evaluates overlap at threshold 0.20 (underline deduplication)', () => {
            // b1: (0, 0, 100, 20), b2: (75, 0, 100, 40) [similarSize false: 20/40=0.5]
            // Overlap: 25 * 20 = 500. minArea = 2000. effectiveRatio = 500 / 2000 = 0.25
            const b1 = { x: 0, y: 0, width: 100, height: 20, page: 1 };
            const b2 = { x: 75, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.20), true);

            // b3: (85, 0, 100, 40) -> Overlap: 15 * 20 = 300, effectiveRatio = 300 / 2000 = 0.15 <= 0.20
            const b3 = { x: 85, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b3], 0.20), false);
        });

        it('evaluates overlap at threshold 0.25 (DEDUP_THRESHOLDS.CROSS_STAGE)', () => {
            // b1: (0, 0, 100, 20), b2: (70, 0, 100, 40) -> overlap: 30 * 20 = 600, ratio = 600/2000 = 0.30 > 0.25
            const b1 = { x: 0, y: 0, width: 100, height: 20, page: 1 };
            const b2 = { x: 70, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b2], DEDUP_THRESHOLDS.CROSS_STAGE), true);

            // b3: (78, 0, 100, 40) -> overlap: 22 * 20 = 440, ratio = 440/2000 = 0.22 <= 0.25
            const b3 = { x: 78, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b3], DEDUP_THRESHOLDS.CROSS_STAGE), false);
        });

        it('evaluates overlap at threshold 0.35 (DEDUP_THRESHOLDS.WITHIN_STAGE)', () => {
            // b1: (0, 0, 100, 20), b2: (60, 0, 100, 40) -> overlap: 40 * 20 = 800, ratio = 800/2000 = 0.40 > 0.35
            const b1 = { x: 0, y: 0, width: 100, height: 20, page: 1 };
            const b2 = { x: 60, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b2], DEDUP_THRESHOLDS.WITHIN_STAGE), true);

            // b3: (70, 0, 100, 40) -> ratio = 600/2000 = 0.30 <= 0.35
            const b3 = { x: 70, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b3], DEDUP_THRESHOLDS.WITHIN_STAGE), false);
        });

        it('evaluates overlap at threshold 0.45 (colon prompt affordance deduplication)', () => {
            // b1: (0, 0, 100, 20), b2: (50, 0, 100, 40) -> overlap: 50 * 20 = 1000, ratio = 1000/2000 = 0.50 > 0.45
            const b1 = { x: 0, y: 0, width: 100, height: 20, page: 1 };
            const b2 = { x: 50, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.45), true);

            // b3: (60, 0, 100, 40) -> ratio = 800/2000 = 0.40 <= 0.45
            const b3 = { x: 60, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b3], 0.45), false);
        });

        it('evaluates overlap at threshold 0.50 (container overlap)', () => {
            // b1: (0, 0, 100, 20), b2: (40, 0, 100, 40) -> ratio = 60 * 20 / 2000 = 0.60 > 0.50 => true
            const b1 = { x: 0, y: 0, width: 100, height: 20, page: 1 };
            const b2 = { x: 40, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.50), true);

            // b3: (55, 0, 100, 40) -> ratio = 45 * 20 / 2000 = 0.45 <= 0.50 => false
            const b3 = { x: 55, y: 0, width: 100, height: 40, page: 1 };
            assert.equal(isOverlapping(b1, [b3], 0.50), false);
        });

        it('matches similar size boxes when iou >= 0.15', () => {
            // b1: (0, 0, 100, 20), b2: (70, 0, 100, 20)
            // similarSize = true, iou = 600 / 3400 = 0.176 >= 0.15
            const b1 = { x: 0, y: 0, width: 100, height: 20, page: 1 };
            const b2 = { x: 70, y: 0, width: 100, height: 20, page: 1 };
            assert.equal(isOverlapping(b1, [b2], 0.90), true);
        });

        it('matches fields with center distance <= 6 and similar dimensions', () => {
            // Center distance <= 6pt with similar size (w/h ratios within 0.65..1.5)
            const b1 = { x: 100, y: 100, width: 60, height: 20, page: 1 };
            const b2 = { x: 103, y: 102, width: 62, height: 21, page: 1 };
            // centerDistance = hypot(3, 2) = 3.6 <= 6
            assert.equal(isOverlapping(b1, [b2], 0.90), true);
        });
    });
});
