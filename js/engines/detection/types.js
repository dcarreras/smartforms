// js/engines/detection/types.js
// Type definitions and JSDoc schemas for detection pipeline

/**
 * @typedef {Object} DetectionContext
 * @property {Array} rawBlocks
 * @property {Object} vectorShapes
 * @property {Object} viewport
 * @property {number} pageNum
 * @property {Set<string>} usedNames
 * @property {Array} existingFields
 * @property {Object} [config]
 */

/**
 * @typedef {Object} DetectedField
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} page
 * @property {string} [detectedBy]
 * @property {number} [confidence]
 */
export const STAGE_NAMES = Object.freeze({
    ACROFORM_PASSTHROUGH: "acroform_passthrough",
    VECTOR_SHAPES: "vector_shapes",
    VECTOR_FIELDS: "vector_fields",
    COMB_FIELDS: "comb_fields",
    RADIO_CLUSTERING: "radio_clustering",
    TABLE_GRID: "table_grid",
    UNDERLINE_FIELDS: "underline_fields",
    VISUAL_AFFORDANCES: "visual_affordances",
    NEURAL_BRIDGE: "neural_bridge"
});
