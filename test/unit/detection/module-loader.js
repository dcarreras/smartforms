// test/unit/detection/module-loader.js
// Loads untouched auto-detector.js for Phase 0 characterization tests.
// In Phase 2, this loader delegates to the new modular detection files.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..');

// Node polyfills for state.js imports
if (typeof globalThis.localStorage === "undefined") {
    globalThis.localStorage = {
        _data: {},
        getItem(k) { return this._data[k] ?? null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; },
        clear() { this._data = {}; }
    };
}

// Read auto-detector.js source code
const autoDetectorPath = path.join(ROOT, 'js/engines/auto-detector.js');
const sourceCode = fs.readFileSync(autoDetectorPath, 'utf8');

// Helper to extract function body by name using regex
function extractFunctionCode(code, fnName) {
    const regex = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\([\\s\\S]*?\\n\\}`);
    const match = code.match(regex);
    if (!match) throw new Error(`Function ${fnName} not found in auto-detector.js`);
    return match[0].replace(/^export\s+/, '');
}

// 1. Direct ES module imports from auto-detector.js for all exported symbols
export const autoDetectorModule = await import(autoDetectorPath);

export const {
    DEDUP_THRESHOLDS,
    GENERIC_PATTERNS,
    SEMANTIC_DIMENSIONS,
    calculateDocumentColumnBoundaries,
    resolveSemanticProps,
    getExistingWidgetFields,
    importExistingAcroFormFields,
    enrichNeuralFieldsWithText,
    detectFormFieldsFromDoc,
    detectFormFields,
    autoDetectFields,
    reconstructTableGridBoxes,
    extractPdfVectorShapes,
    clusterCombBoxes,
    clusterRadioGroups,
    rectContainsSignificantText,
    detectVectorDrawnFields,
    detectUnderlineFields,
    detectTaxScheduleLineAffordances,
    detectVisualAffordances
} = autoDetectorModule;

// 2. Extracted internal unexported helpers for characterization tests in Phase 0
export const isUniversalStaticText = new Function(
    extractFunctionCode(sourceCode, 'isUniversalStaticText') + '\nreturn isUniversalStaticText;'
)();

export const isOverlapping = new Function(
    'DEDUP_THRESHOLDS',
    extractFunctionCode(sourceCode, 'isOverlapping') + '\nreturn isOverlapping;'
)(DEDUP_THRESHOLDS);

export const reconstructLinePhrase = new Function(
    extractFunctionCode(sourceCode, 'reconstructLinePhrase') + '\nreturn reconstructLinePhrase;'
)();

// Extract TABLE_COL_DEFS and matchColumnKeyword
const tableColDefsMatch = sourceCode.match(/const TABLE_COL_DEFS = \[[\s\S]*?\n\];/);
export const TABLE_COL_DEFS = new Function(tableColDefsMatch[0] + '\nreturn TABLE_COL_DEFS;')();

export const matchColumnKeyword = new Function(
    tableColDefsMatch[0] + '\n' +
    extractFunctionCode(sourceCode, 'matchColumnKeyword') + '\nreturn matchColumnKeyword;'
)();

const { generateFieldId } = await import('../../../js/core/state.js');

export const buildFieldsFromTableGrid = new Function(
    'GENERIC_PATTERNS',
    'generateFieldId',
    tableColDefsMatch[0] + '\n' +
    extractFunctionCode(sourceCode, 'matchColumnKeyword') + '\n' +
    extractFunctionCode(sourceCode, 'resolveSemanticProps') + '\n' +
    extractFunctionCode(sourceCode, 'buildFieldsFromTableGrid') + '\n' +
    'return buildFieldsFromTableGrid;'
)(GENERIC_PATTERNS, generateFieldId);

export const clusterIntoLines = new Function(
    extractFunctionCode(sourceCode, 'clusterIntoLines') + '\nreturn clusterIntoLines;'
)();
