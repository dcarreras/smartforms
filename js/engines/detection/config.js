// js/engines/detection/config.js
// Centralized configuration and threshold constants for the modular detection pipeline

import { DEDUP_THRESHOLDS, SEMANTIC_DIMENSIONS } from "../auto-detector.js";

export { DEDUP_THRESHOLDS, SEMANTIC_DIMENSIONS };

export const OVERLAP = Object.freeze({
    EXACT_OR_SIMILAR: 0.15,
    UNDERLINE_CANDIDATE: 0.20,
    CROSS_STAGE: 0.25,
    TABLE_CELL: 0.30,
    WITHIN_STAGE: 0.35,
    COLON_PROMPT: 0.45,
    CONTAINER: 0.50
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
