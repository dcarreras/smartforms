import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectVectorDrawnFields,
    rectContainsSignificantText,
    reconstructLinePhrase,
    classifyRectAsField,
    attachNearestLabel,
    resolveFieldTypeFromShape
} from './module-loader.js';

describe('vector-fields', () => {
    describe('detectVectorDrawnFields', () => {
        it('returns empty array when vectorShapes is null or empty', () => {
            assert.deepEqual(detectVectorDrawnFields(null, [], 1, new Set()), []);
            assert.deepEqual(detectVectorDrawnFields({}, [], 1, new Set()), []);
        });

        it('detects and classifies a checkbox from a small square vector rect', () => {
            const vectorShapes = {
                checkboxRects: [{ x: 50, y: 100, width: 14, height: 14 }],
                inputBoxRects: [],
                allRects: [{ x: 50, y: 100, width: 14, height: 14 }]
            };
            const rawBlocks = [
                { x: 70, y: 102, width: 60, height: 10, str: 'Subscribe to newsletter' }
            ];

            const fields = detectVectorDrawnFields(vectorShapes, rawBlocks, 1, new Set());
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'checkBox');
            assert.equal(fields[0].x, 50);
            assert.equal(fields[0].y, 100);
            assert.equal(fields[0].width, 14);
            assert.equal(fields[0].height, 14);
        });

        it('detects and classifies a text input box with nearby prompt label', () => {
            const vectorShapes = {
                checkboxRects: [],
                inputBoxRects: [{ x: 120, y: 150, width: 200, height: 24 }],
                allRects: [{ x: 120, y: 150, width: 200, height: 24 }]
            };
            const rawBlocks = [
                { x: 50, y: 156, width: 60, height: 12, str: 'First Name' }
            ];

            const fields = detectVectorDrawnFields(vectorShapes, rawBlocks, 1, new Set());
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'textField');
            assert.equal(fields[0].name, 'first_name');
            assert.equal(fields[0].x, 120);
            assert.equal(fields[0].y, 150);
            assert.equal(fields[0].width, 200);
            assert.equal(fields[0].height, 24);
        });

        it('detects comb character cells and clusters them into a single comb textField with isComb: true', () => {
            const allRects = [];
            for (let i = 0; i < 9; i++) {
                allRects.push({ x: 150 + i * 16, y: 250, width: 14, height: 20 });
            }
            const vectorShapes = {
                checkboxRects: [],
                inputBoxRects: [],
                allRects
            };
            const rawBlocks = [
                { x: 50, y: 254, width: 80, height: 12, str: 'Social Security Number' }
            ];

            const fields = detectVectorDrawnFields(vectorShapes, rawBlocks, 1, new Set());
            assert.ok(fields.some(f => f.isComb === true));
            const comb = fields.find(f => f.isComb === true);
            assert.equal(comb.maxLength, 9);
            assert.equal(comb.type, 'textField');
            assert.equal(comb.name, 'ssn');
        });
    });

    describe('rectContainsSignificantText', () => {
        it('returns false for an empty rect containing no text blocks', () => {
            const rect = { x: 100, y: 100, width: 200, height: 24 };
            assert.equal(rectContainsSignificantText(rect, []), false);
            assert.equal(rectContainsSignificantText(rect, [{ x: 500, y: 500, width: 50, height: 12, str: 'Far' }]), false);
        });

        it('returns false for checked checkbox containing an "X" or checkmark', () => {
            const rect = { x: 50, y: 50, width: 14, height: 14 };
            const textBlocks = [{ x: 52, y: 52, width: 10, height: 10, str: 'X' }];
            assert.equal(rectContainsSignificantText(rect, textBlocks), false);

            const checkmark = [{ x: 52, y: 52, width: 10, height: 10, str: '✓' }];
            assert.equal(rectContainsSignificantText(rect, checkmark), false);
        });

        it('returns true (suppressing field) for line number badges like "1a", "2b", "Line 1", "a."', () => {
            const rect = { x: 20, y: 100, width: 20, height: 16 };
            assert.equal(rectContainsSignificantText(rect, [{ x: 22, y: 102, width: 12, height: 10, str: '1a' }]), true);
            assert.equal(rectContainsSignificantText(rect, [{ x: 22, y: 102, width: 12, height: 10, str: 'Line 1' }]), true);
            assert.equal(rectContainsSignificantText(rect, [{ x: 22, y: 102, width: 10, height: 10, str: 'a.' }]), true);
        });

        it('returns true (suppressing field) for section or step badges like "Part I"', () => {
            const rect = { x: 50, y: 50, width: 150, height: 24 };
            const textBlocks = [{ x: 60, y: 55, width: 80, height: 14, str: 'Part I Taxpayer' }];
            assert.equal(rectContainsSignificantText(rect, textBlocks), true);
        });

        it('returns false for top-anchored IRS internal prompts with ample fillable space below', () => {
            // Box height = 36, prompt occupies top 10pt (maxTextBottom = y + 10 = 110, box bottom = 136)
            // spaceBelow = 136 - 110 = 26 >= 9. maxTextBottom <= 100 + 36 * 0.65 = 123.4
            const rect = { x: 50, y: 100, width: 200, height: 36 };
            const textBlocks = [{ x: 54, y: 102, width: 70, height: 8, str: 'First name and initial' }];
            assert.equal(rectContainsSignificantText(rect, textBlocks), false);
        });
    });

    describe('reconstructLinePhrase', () => {
        it('reconstructs left-to-right phrase from contiguous words on the left', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 30, height: 12, str: 'First' },
                { x: 84, y: 100, width: 35, height: 12, str: 'Name' } // closestWord
            ];
            const phrase = reconstructLinePhrase(rawBlocks[1], rawBlocks, 'left');
            assert.equal(phrase, 'First Name');
        });

        it('reconstructs phrase to the right', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 30, height: 12, str: 'I' }, // closestWord
                { x: 84, y: 100, width: 45, height: 12, str: 'Agree' }
            ];
            const phrase = reconstructLinePhrase(rawBlocks[0], rawBlocks, 'right');
            assert.equal(phrase, 'I Agree');
        });
    });

    describe('classifyRectAsField', () => {
        it('rejects boxes exceeding bounds or matching divider bars', () => {
            assert.equal(classifyRectAsField(null).valid, false);
            assert.equal(classifyRectAsField({ x: 10, y: 10, width: 600, height: 20 }).valid, false);
            assert.equal(classifyRectAsField({ x: 10, y: 10, width: 300, height: 12 }).valid, false);
            assert.equal(classifyRectAsField({ x: 10, y: 20, width: 150, height: 30 }).valid, false); // header banner
            assert.equal(classifyRectAsField({ x: 10, y: 100, width: 20, height: 30 }).valid, false); // narrow spacer
        });

        it('identifies dropdown glyphs inside rectangle', () => {
            const box = { x: 100, y: 100, width: 150, height: 24 };
            const rawBlocks = [
                { x: 235, y: 104, width: 10, height: 10, str: '▼' }
            ];
            const res = classifyRectAsField(box, rawBlocks);
            assert.equal(res.valid, true);
            assert.equal(res.hasDropdownGlyph, true);
        });
    });

    describe('attachNearestLabel', () => {
        it('locates label directly to the left', () => {
            const box = { x: 120, y: 150, width: 200, height: 24 };
            const rawBlocks = [
                { x: 50, y: 156, width: 60, height: 12, str: 'Email' }
            ];
            const res = attachNearestLabel(box, rawBlocks);
            assert.equal(res.labelText, 'Email');
        });

        it('detects in-box top prompt labels in government boxes', () => {
            const box = { x: 50, y: 100, width: 200, height: 36 };
            const rawBlocks = [
                { x: 52, y: 102, width: 70, height: 8, str: 'Full Name' }
            ];
            const res = attachNearestLabel(box, rawBlocks);
            assert.equal(res.hasInBoxTopLabel, true);
            assert.equal(res.labelText, 'Full Name');
            assert.ok(res.adjustedBoxY > box.y);
            assert.ok(res.adjustedBoxHeight < box.height);
        });
    });

    describe('resolveFieldTypeFromShape', () => {
        it('resolves signature field from signature label', () => {
            const box = { x: 50, y: 100, width: 200, height: 40 };
            const sem = { name: 'signature', type: 'signature', autofill: '', dataFormat: 'text' };
            const field = resolveFieldTypeFromShape(box, 'Sign Here', { sem });
            assert.equal(field.type, 'signature');
        });

        it('detects currency dataFormat when currency symbol is prepended', () => {
            const box = { x: 70, y: 100, width: 100, height: 24 };
            const sem = { name: 'amount', type: 'textField', autofill: '', dataFormat: 'text' };
            const rawBlocks = [{ x: 50, y: 106, width: 10, height: 12, str: '$' }];
            const field = resolveFieldTypeFromShape(box, 'Total', { sem, rawBlocks });
            assert.equal(field.dataFormat, 'currency');
        });
    });
});
