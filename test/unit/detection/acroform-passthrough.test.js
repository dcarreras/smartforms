import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getExistingWidgetFields, importExistingAcroFormFields } from './module-loader.js';
import { state } from '../../../js/core/state.js';

describe('acroform-passthrough', () => {
    const viewport = {
        height: 792,
        convertToViewportPoint: (x, y) => [x, 792 - y]
    };

    describe('getExistingWidgetFields', () => {
        it('extracts widget annotations into native field specifications', async () => {
            const mockPage = {
                getAnnotations: async () => [
                    {
                        subtype: 'Widget',
                        fieldName: 'first_name',
                        fieldType: 'Tx',
                        rect: [100, 700, 250, 724],
                        fieldValue: 'John'
                    },
                    {
                        subtype: 'Widget',
                        fieldName: 'terms_agreed',
                        fieldType: 'Btn',
                        checkBox: true,
                        rect: [50, 650, 64, 664],
                        fieldValue: 'Yes'
                    }
                ]
            };

            const fields = await getExistingWidgetFields(mockPage, viewport, 1, new Set());
            assert.equal(fields.length, 2);

            const textField = fields.find(f => f.name === 'first_name');
            assert.ok(textField);
            assert.equal(textField.type, 'textField');
            assert.equal(textField.width, 150);
            assert.equal(textField.height, 24);
            assert.equal(textField.confidence, 1.0);

            const checkField = fields.find(f => f.name === 'terms_agreed');
            assert.ok(checkField);
            assert.equal(checkField.type, 'checkBox');
            assert.equal(checkField.width, 14);
            assert.equal(checkField.height, 14);
        });

        it('gracefully returns empty array if page.getAnnotations throws error', async () => {
            const errorPage = {
                getAnnotations: async () => { throw new Error('Corrupt page dictionary'); }
            };
            const fields = await getExistingWidgetFields(errorPage, viewport, 1, new Set());
            assert.deepEqual(fields, []);
        });
    });

    describe('importExistingAcroFormFields', () => {
        it('returns 0 if state.pdfDoc is null', async () => {
            state.pdfDoc = null;
            const count = await importExistingAcroFormFields();
            assert.equal(count, 0);
        });
    });
});
