import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichNeuralFieldsWithText } from './module-loader.js';

describe('neural-bridge', () => {
    describe('enrichNeuralFieldsWithText', () => {
        it('returns empty array when rawNeuralFields is empty or not an array', () => {
            assert.deepEqual(enrichNeuralFieldsWithText([], []), []);
            assert.deepEqual(enrichNeuralFieldsWithText(null, []), []);
        });

        it('binds neural bounding box to nearby text prompt and propagates confidence', () => {
            const rawNeuralFields = [
                { x: 100, y: 150, width: 200, height: 24, type: 'text', confidence: 0.92 }
            ];
            const rawBlocks = [
                { x: 30, y: 155, width: 60, height: 12, str: 'Last Name:' }
            ];

            const fields = enrichNeuralFieldsWithText(rawNeuralFields, rawBlocks, new Set(), 1);
            assert.equal(fields.length, 1);
            const f = fields[0];
            assert.equal(f.name, 'last_name');
            assert.equal(f.confidence, 0.92);
            assert.equal(f.detectedBy, 'neural_vision');
            assert.equal(f.x, 100);
            assert.equal(f.y, 150);
            assert.equal(f.width, 200);
            assert.equal(f.height, 24);
        });
    });
});
