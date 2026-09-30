import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectVisualAffordances,
    clusterIntoLines,
    detectCheckboxGlyphs,
    detectColonPrompts,
    cleanOcrWordToken,
    isOcrCheckboxArtifact
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

        it('scrubs OCR artifacts (0), [ ], 6, =) from extracted colon prompt labels', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 90, height: 12, str: '0) Full Name:' },
                { x: 150, y: 100, width: 120, height: 12, str: '________________' },
                { x: 50, y: 140, width: 90, height: 12, str: '[ ] Home Address:' },
                { x: 150, y: 140, width: 120, height: 12, str: '________________' },
                { x: 50, y: 180, width: 90, height: 12, str: '6 Phone Number:' },
                { x: 150, y: 180, width: 120, height: 12, str: '________________' },
                { x: 50, y: 220, width: 90, height: 12, str: '=Date of Birth:' },
                { x: 150, y: 220, width: 120, height: 12, str: '________________' }
            ];
            const textLines = clusterIntoLines(rawBlocks);
            const fields = [];
            detectColonPrompts(textLines, rawBlocks, viewport, 1, new Set(), fields, null, null);
            assert.equal(fields.length, 4);
            assert.equal(fields[0].name, 'full_name');
            assert.equal(fields[0].label, 'Full Name');
            assert.equal(fields[1].name, 'street_address');
            assert.equal(fields[1].label, 'Home Address');
            assert.equal(fields[2].name, 'phone');
            assert.equal(fields[2].label, 'Phone Number');
            assert.equal(fields[3].name, 'dob');
            assert.equal(fields[3].label, 'Date of Birth');
        });
    });

    describe('OCR Token Sanitization (DullyPDF rules)', () => {
        it('identifies standalone OCR checkbox and divider artifacts', () => {
            assert.equal(isOcrCheckboxArtifact('0)'), true);
            assert.equal(isOcrCheckboxArtifact('6)'), true);
            assert.equal(isOcrCheckboxArtifact('(0)'), true);
            assert.equal(isOcrCheckboxArtifact('oO'), true);
            assert.equal(isOcrCheckboxArtifact('[ ]'), true);
            assert.equal(isOcrCheckboxArtifact('==='), true);
            assert.equal(isOcrCheckboxArtifact('---'), true);

            // Real words must not be classified as artifacts
            assert.equal(isOcrCheckboxArtifact('Name'), false);
            assert.equal(isOcrCheckboxArtifact('Street'), false);
            assert.equal(isOcrCheckboxArtifact('Total'), false);
        });

        it('cleans leading OCR noise glyphs and bracketed prefixes from words', () => {
            assert.equal(cleanOcrWordToken('0) First Name'), 'First Name');
            assert.equal(cleanOcrWordToken('(0) Date of Birth'), 'Date of Birth');
            assert.equal(cleanOcrWordToken('[ ] Yes / No'), 'Yes / No');
            assert.equal(cleanOcrWordToken('6 Phone Number'), 'Phone Number');
            assert.equal(cleanOcrWordToken('6) Phone Number'), 'Phone Number');
            assert.equal(cleanOcrWordToken('=Past Condition'), 'Past Condition');
            assert.equal(cleanOcrWordToken('oO Marital Status'), 'Marital Status');
            assert.equal(cleanOcrWordToken('© Employer Name'), 'Employer Name');
            assert.equal(cleanOcrWordToken('• 1. City'), 'City');
        });

        it('filters pure OCR noise blocks from regular text lines in clusterIntoLines', () => {
            const rawBlocks = [
                { x: 50, y: 100, width: 12, height: 12, str: '0)' },
                { x: 68, y: 100, width: 35, height: 12, str: 'Address:' },
                { x: 50, y: 140, width: 15, height: 12, str: 'oO' },
                { x: 50, y: 180, width: 40, height: 12, str: '=====' }
            ];

            const lines = clusterIntoLines(rawBlocks);
            assert.equal(lines.length, 1);
            assert.equal(lines[0].str, 'Address:');
        });
    });
});

