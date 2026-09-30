import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    reconstructTableGridBoxes,
    buildFieldsFromTableGrid,
    matchColumnKeyword,
    TABLE_COL_DEFS
} from './module-loader.js';

describe('table-grid', () => {
    describe('matchColumnKeyword', () => {
        it('matches standard table column keywords across multiple locales', () => {
            assert.equal(matchColumnKeyword('Description')?.id, 'description');
            assert.equal(matchColumnKeyword('Item')?.id, 'item_no');
            assert.equal(matchColumnKeyword('Quantity')?.id, 'qty');
            assert.equal(matchColumnKeyword('Unit Price')?.id, 'unit_price');
            assert.equal(matchColumnKeyword('Amount')?.id, 'amount');
            assert.equal(matchColumnKeyword('Date')?.id, 'date');
            assert.equal(matchColumnKeyword('Taxable')?.id, 'taxable');

            // German
            assert.equal(matchColumnKeyword('Menge')?.id, 'qty');
            assert.equal(matchColumnKeyword('Einzelpreis')?.id, 'unit_price');
            assert.equal(matchColumnKeyword('Gesamt')?.id, 'amount');

            // French
            assert.equal(matchColumnKeyword('Quantité')?.id, 'qty');
            assert.equal(matchColumnKeyword('Prix unitaire')?.id, 'unit_price');

            // Spanish
            assert.equal(matchColumnKeyword('Cantidad')?.id, 'qty');
            assert.equal(matchColumnKeyword('Precio unitario')?.id, 'unit_price');
        });

        it('returns null for unrecognized column text', () => {
            assert.equal(matchColumnKeyword('Unrelated Header Xyz'), null);
        });
    });

    describe('reconstructTableGridBoxes', () => {
        it('reconstructs table cell boxes from consistent horizontal ruling lines', () => {
            const hLines = [
                { x1: 50, x2: 350, y: 100 },
                { x1: 50, x2: 350, y: 125 },
                { x1: 50, x2: 350, y: 150 },
                { x1: 50, x2: 350, y: 175 }
            ];
            const vLines = [
                { x: 50, y1: 100, y2: 175 },
                { x: 150, y1: 100, y2: 175 },
                { x: 250, y1: 100, y2: 175 },
                { x: 350, y1: 100, y2: 175 }
            ];

            const cells = reconstructTableGridBoxes(hLines, vLines);
            assert.ok(cells.length > 0, 'Expected reconstructed table cells');
            assert.ok(cells.some(c => c.y === 100 && c.height === 25));
        });

        it('returns empty array when fewer than 2 horizontal lines are provided', () => {
            assert.deepEqual(reconstructTableGridBoxes([]), []);
            assert.deepEqual(reconstructTableGridBoxes([{ x1: 50, x2: 350, y: 100 }]), []);
        });
    });

    describe('buildFieldsFromTableGrid', () => {
        it('builds input fields from detected ruling-line grid and header text', () => {
            const grid = {
                rowsY: [100, 125, 150, 175],
                colsX: [50, 150, 250, 350]
            };
            const rawBlocks = [
                { x: 55, y: 105, width: 80, height: 12, str: 'Item Description' },
                { x: 155, y: 105, width: 50, height: 12, str: 'Quantity' },
                { x: 255, y: 105, width: 50, height: 12, str: 'Unit Price' }
            ];

            const res = buildFieldsFromTableGrid(grid, rawBlocks, 1, new Set());
            assert.equal(res.fields.length, 6, 'Expected 2 rows x 3 columns = 6 fields');

            const row1Fields = res.fields.slice(0, 3);
            assert.equal(row1Fields[0].name, 'item_description');
            assert.equal(row1Fields[1].name, 'quantity');
            assert.equal(row1Fields[2].name, 'amount');

            // Sibling row should have suffixed names
            const row2Fields = res.fields.slice(3, 6);
            assert.equal(row2Fields[0].name, 'item_description_2');
            assert.equal(row2Fields[1].name, 'quantity_2');
            assert.equal(row2Fields[2].name, 'amount_2');
        });

        it('returns empty fields and null region when grid has fewer than 3 rows or cols', () => {
            const smallGrid = { rowsY: [100, 125], colsX: [50, 150] };
            const res = buildFieldsFromTableGrid(smallGrid, [], 1, new Set());
            assert.deepEqual(res.fields, []);
            assert.equal(res.region, null);
        });
    });
});
