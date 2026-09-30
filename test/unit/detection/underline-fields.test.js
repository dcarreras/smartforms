import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectUnderlineFields } from './module-loader.js';

describe('underline-fields', () => {
    describe('detectUnderlineFields', () => {
        it('detects an underline field given a horizontal rule and nearby label', () => {
            const grid = {
                horizontalLines: [
                    { start: 200, end: 500, offset: 400 } // x = 100, width = 150, y = 200
                ],
                verticalLines: []
            };
            const rawBlocks = [
                { x: 30, y: 190, width: 60, height: 10, str: 'Signature' }
            ];

            const fields = detectUnderlineFields(grid, rawBlocks, 1, new Set());
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'signature');
            assert.equal(fields[0].x, 100);
            assert.equal(fields[0].width, 150);
            assert.equal(fields[0].detectedBy, 'boundary_underline');
        });

        it('detects a text field for standard labels (e.g. Full Name)', () => {
            const grid = {
                horizontalLines: [
                    { start: 200, end: 500, offset: 400 }
                ],
                verticalLines: []
            };
            const rawBlocks = [
                { x: 30, y: 190, width: 60, height: 10, str: 'Full Name' }
            ];

            const fields = detectUnderlineFields(grid, rawBlocks, 1, new Set());
            assert.equal(fields.length, 1);
            assert.equal(fields[0].type, 'textField');
            assert.equal(fields[0].name, 'full_name');
        });

        it('ignores lines with width < 40 pt', () => {
            const grid = {
                horizontalLines: [
                    { start: 200, end: 260, offset: 400 } // width = 30 < 40
                ],
                verticalLines: []
            };
            const rawBlocks = [
                { x: 30, y: 190, width: 60, height: 10, str: 'Full Name' }
            ];

            const fields = detectUnderlineFields(grid, rawBlocks, 1, new Set());
            assert.equal(fields.length, 0);
        });

        it('ignores lines that have 3 or more vertical line intersections (table rulings)', () => {
            const grid = {
                horizontalLines: [
                    { start: 200, end: 600, offset: 400 } // x = 100..300
                ],
                verticalLines: [
                    { offset: 220 }, // vx = 110
                    { offset: 300 }, // vx = 150
                    { offset: 380 }  // vx = 190
                ]
            };
            const rawBlocks = [
                { x: 30, y: 190, width: 60, height: 10, str: 'Full Name' }
            ];

            const fields = detectUnderlineFields(grid, rawBlocks, 1, new Set());
            assert.equal(fields.length, 0);
        });
    });
});
