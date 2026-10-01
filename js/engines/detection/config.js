// js/engines/detection/config.js
// Centralized configuration and threshold constants for the modular detection pipeline

import { SEMANTIC_DIMENSIONS } from "./semantic-resolver.js";

export { SEMANTIC_DIMENSIONS };

export const DEDUP_THRESHOLDS = Object.freeze({
    EXACT_OR_SIMILAR: 0.15,
    UNDERLINE_CANDIDATE: 0.20,
    CROSS_STAGE: 0.25,
    TABLE_CELL: 0.30,
    WITHIN_STAGE: 0.35,
    COLON_PROMPT: 0.45,
    CONTAINER: 0.50
});

// Named confidence scores used across detection stages.
// All stage modules must import from here; inline numeric literals are not permitted.
export const CONFIDENCE = Object.freeze({
    ACCEPT: 0.90,            // minimum to auto-accept without user review
    BASELINE: 0.65,          // default when context evidence is absent
    NEURAL_DEFAULT: 0.85,    // neural bridge when model produces no score
    NO_LABEL: 0.82,          // field with no nearby label text; also table/grid base
    UNDERLINE_BASE: 0.74,    // underline-detected field base
    NEURAL_BASE: 0.68,       // ONNX / sidecar stage base
    AFFORDANCE_BASE: 0.60,   // visual-affordance / colon-prompt stage base
    PARTIAL_LABEL: 0.88,     // below-labeled or underline-detected box
    MID_LABEL: 0.91,         // left-labeled field
    HIGH_LABEL: 0.94,        // top-labeled or signature-typed field
    VECTOR_DRAWN: 0.98       // directly confirmed vector-drawn box
});

export const COMB = Object.freeze({
    MIN_CELL_WIDTH: 8,
    MAX_CELL_WIDTH: 36,
    MIN_CELL_HEIGHT: 10,
    MAX_CELL_HEIGHT: 36,
    MAX_GAP_STANDARD: 8.0,
    MAX_GAP_SQUARE: 11.5,
    MIN_CLUSTER_LENGTH: 3
});

export const RADIO_CLUSTER = Object.freeze({
    MAX_Y_DELTA: 6,
    MIN_X_GAP: 6,
    MAX_X_GAP: 70,
    MAX_X_DELTA: 6,
    MIN_Y_GAP: 4,
    MAX_Y_GAP: 32
});

export const SCAN_TRIGGER = Object.freeze({
    MIN_TEXT_BLOCKS: 3,
    MIN_RECTS: 2,
    MIN_PATHS: 5
});
