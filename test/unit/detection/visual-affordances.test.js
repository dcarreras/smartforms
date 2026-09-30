import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectVisualAffordances,
    clusterIntoLines,
    detectCheckboxGlyphs,
    detectColonPrompts
} from './module-loader.js';

describe('visual-affordances', () => {
    const viewport = { width: 612, height: 792 };

    describe('detectVisualAffordances', () => {
        it('detects checkbox glyphs across standard CHECKBOX_CHARS (☐, ☑, etc.)', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 12, height: 12, str: '☐' },
                { x: 68, y: 100, width: 30, height: 12, str: 'Option' }
            ];

            const fields = detectVisualAffordances(rawBlocks, viewport, 1, new Set());
            assert.ok(fields.some(f => f.type === 'checkBox'));
            const cb = fields.find(f => f.type === 'checkBox');
            assert.equal(cb.x, 50);
            assert.equal(cb.y, 100);
            assert.equal(cb.type, 'checkBox');
        });

        it('detects bracket pairs [ ] as checkboxes', () => {
            const rawBlocks = [
                { x: 50, y: 150, width: 6, height: 12, str: '[' },
                { x: 58, y: 150, width: 6, height: 12, str: ']' },
                { x: 70, y: 150, width: 50, height: 12, str: 'Agree' }
            ];

            const fields = detectVisualAffordances(rawBlocks, viewport, 1, new Set());
            assert.ok(fields.some(f => f.type === 'checkBox'));
        });

        it('detects paren pairs ( ) or circle glyphs ○ as radio groups', () => {
            const rawBlocks = [
                { x: 50, y: 200, width: 6, height: 12, str: '(' },
                { x: 58, y: 200, width: 6, height: 12, str: ')' },
                { x: 70, y: 200, width: 40, height: 12, str: 'Male' }
            ];

            const fields = detectVisualAffordances(rawBlocks, viewport, 1, new Set());
            assert.ok(fields.some(f => f.type === 'radioGroup'));
        });

        it('excludes date-format placeholders like [ YYYY - MM - DD ]', () => {
            const rawBlocks = [
                { x: 50, y: 250, width: 150, height: 12, str: '[ YYYY - MM - DD ]' }
            ];

            const fields = detectVisualAffordances(rawBlocks, viewport, 1, new Set());
            // Must NOT detect bracket date placeholder as a form checkbox
            assert.equal(fields.filter(f => f.type === 'checkBox').length, 0);
        });

        it('detects colon-prompt affordances like "Full Name: ____________"', () => {
            const rawBlocks = [
                { x: 50, y: 300, width: 65, height: 12, str: 'Full Name:' },
                { x: 120, y: 300, width: 150, height: 12, str: '________________________' }
            ];

            const fields = detectVisualAffordances(rawBlocks, viewport, 1, new Set());
            assert.ok(fields.some(f => f.type === 'textField'));
            const tf = fields.find(f => f.type === 'textField');
            assert.equal(tf.name, 'full_name');
            assert.ok(tf.width >= 80);
        });
    });

    describe('clusterIntoLines', () => {
        it('clusters word blocks on the same baseline into unified lines', () => {
            const blocks = [
                { x: 50, y: 100, width: 30, height: 12, str: 'First' },
                { x: 85, y: 101, width: 35, height: 12, str: 'Name:' },
                { x: 50, y: 150, width: 40, height: 12, str: 'Street' },
                { x: 95, y: 149, width: 50, height: 12, str: 'Address:' }
            ];

            const lines = clusterIntoLines(blocks);
            assert.equal(lines.length, 2);
            assert.equal(lines[0].str, 'First Name:');
            assert.equal(lines[1].str, 'Street Address:');
        });

        it('returns empty array when given empty input', () => {
            assert.deepEqual(clusterIntoLines([]), []);
        });
    });

    describe('detectCheckboxGlyphs', () => {
        it('detects checkbox glyphs directly from textLines', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 12, height: 12, str: '☐' },
                { x: 68, y: 100, width: 30, height: 12, str: 'Option' }
            ];
            const textLines = clusterIntoLines(rawBlocks);
            const fields = [];
            detectCheckboxGlyphs(textLines, rawBlocks, 1, new Set(), fields);
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'checkBox');
            assert.equal(fields[0].value, 'Option');
        });
    });

    describe('detectColonPrompts', () => {
        it('detects colon prompt directly from textLines', () => {
            const rawBlocks = [
                { x: 50, y: 300, width: 65, height: 12, str: 'Full Name:' },
                { x: 120, y: 300, width: 150, height: 12, str: '________________________' }
            ];
            const textLines = clusterIntoLines(rawBlocks);
            const fields = [];
            detectColonPrompts(textLines, rawBlocks, viewport, 1, new Set(), fields, null, null);
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'textField');
            assert.equal(fields[0].name, 'full_name');
        });

        it('strips bullet glyphs and numbered prefixes from prompts', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 90, height: 12, str: '⏩ नाम, थर:' },
                { x: 150, y: 100, width: 120, height: 12, str: '................' },
                { x: 50, y: 140, width: 90, height: 12, str: '1. Street Address:' },
                { x: 150, y: 140, width: 120, height: 12, str: '________________' }
            ];
            const textLines = clusterIntoLines(rawBlocks);
            const fields = [];
            detectColonPrompts(textLines, rawBlocks, viewport, 1, new Set(), fields, null, null);
            assert.equal(fields.length, 2);
            assert.equal(fields[0].name, 'last_name');
            assert.equal(fields[1].name, 'street_address');
        });

        it('detects sub-captioned dotted signature lines in unboxed forms', () => {
            const rawBlocks = [
                { x: 350, y: 500, width: 150, height: 12, str: '....................................' },
                { x: 360, y: 520, width: 120, height: 12, str: '(प्रशासकीय अधिकृत)' }
            ];
            const textLines = clusterIntoLines(rawBlocks);
            const fields = [];
            detectColonPrompts(textLines, rawBlocks, viewport, 1, new Set(), fields, null, null);
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'signature');
            assert.equal(fields[0].label, 'प्रशासकीय अधिकृत');
            assert.ok(fields[0].hasPlaceholder);
        });
    });
});
