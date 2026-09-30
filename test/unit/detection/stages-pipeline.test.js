// test/unit/detection/stages-pipeline.test.js
// Tests for STAGES pipeline array and uniform detect(context) stage contracts

import './setup-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STAGES,
    detectFormFieldsFromDoc
} from './module-loader.js';
import * as acroformPassthrough from '../../../js/engines/detection/acroform-passthrough.js';
import * as vectorFields from '../../../js/engines/detection/vector-fields.js';
import * as tableGrid from '../../../js/engines/detection/table-grid.js';
import * as underlineFields from '../../../js/engines/detection/underline-fields.js';
import * as visualAffordances from '../../../js/engines/detection/visual-affordances/index.js';
import * as neuralBridge from '../../../js/engines/detection/neural-bridge.js';

test('Pipeline Stages: STAGES array defines all 5 core stages', () => {
    assert(Array.isArray(STAGES), 'STAGES must be an array');
    assert.equal(STAGES.length, 5);

    const stageNames = STAGES.map(s => s.name);
    assert.deepEqual(stageNames, [
        'vector_geometry',
        'lattice_tables',
        'boundary_underlines',
        'tax_schedules',
        'visual_affordances'
    ]);

    for (const stage of STAGES) {
        assert.equal(typeof stage.name, 'string');
        assert.equal(typeof stage.detect, 'function');
    }
});

test('Pipeline Stages: all stage modules export uniform detect(context) function', async () => {
    const modules = [
        { mod: acroformPassthrough, name: 'acroform-passthrough' },
        { mod: vectorFields, name: 'vector-fields' },
        { mod: tableGrid, name: 'table-grid' },
        { mod: underlineFields, name: 'underline-fields' },
        { mod: visualAffordances, name: 'visual-affordances' },
        { mod: neuralBridge, name: 'neural-bridge' }
    ];

    for (const { mod, name } of modules) {
        assert.equal(typeof mod.detect, 'function', `${name} must export a detect(context) function`);
        const result = mod.detect({});
        const resolved = (result instanceof Promise) ? await result : result;
        assert(Array.isArray(resolved), `${name}.detect({}) must return or resolve to an array`);
    }
});

test('Pipeline Stages: detectFormFieldsFromDoc executes STAGES and produces telemetry', async () => {
    const mockPage = {
        getAnnotations: async () => [],
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        getTextContent: async () => ({
            items: [
                { str: 'First Name:', x: 50, y: 700, width: 60, height: 12 }
            ]
        }),
        getViewport: () => ({ width: 612, height: 792 })
    };

    const mockPdfDoc = {
        numPages: 1,
        getPage: async () => mockPage
    };

    const result = await detectFormFieldsFromDoc(mockPdfDoc, {
        pageNumber: 1,
        enableOcr: false,
        useSidecar: false
    });

    assert(result.telemetry, 'Telemetry object must be returned');
    assert(result.telemetry.stagesAttempted.includes('vector_geometry'), 'vector_geometry stage must be attempted');
    assert(result.telemetry.stagesAttempted.includes('lattice_tables'), 'lattice_tables stage must be attempted');
    assert(result.telemetry.stagesAttempted.includes('tax_schedules'), 'tax_schedules stage must be attempted');
    assert(result.telemetry.stagesAttempted.includes('visual_affordances'), 'visual_affordances stage must be attempted');
    assert(result.telemetry.stagesSucceeded.includes('vector_geometry'), 'vector_geometry must succeed');
});
