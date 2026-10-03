// js/engines/detection/neural-bridge.js
// Neural vision bounding box text binding and hybrid enrichment

import { generateFieldId } from "../../core/state.js";
import { resolveSemanticProps } from "./semantic-resolver.js";
import { CONFIDENCE } from "./config.js";

export function enrichNeuralFieldsWithText(rawNeuralFields, rawBlocks, usedNames = new Set(), pageNum = 1) {
    if (!Array.isArray(rawNeuralFields) || rawNeuralFields.length === 0) return [];
    const enriched = [];

    for (const nf of rawNeuralFields) {
        // Find nearest text label to the left or above within a reasonable bounding radius
        let closestBlock = null;
        let minDistance = Infinity;

        for (const tb of rawBlocks) {
            // Label is to the left of the field on approximately the same horizontal baseline
            const isLeft = tb.x + tb.width <= nf.x + 10 && (nf.x - (tb.x + tb.width)) <= 180;
            // Label is to the right of the field (common for checkboxes and radio buttons)
            const isRight = tb.x >= nf.x + nf.width - 6 && (tb.x - (nf.x + nf.width)) <= 200;
            const isSameRow = Math.abs((tb.y + tb.height / 2) - (nf.y + nf.height / 2)) <= Math.max(16, tb.height);

            // Label is directly above the field
            const isAbove = tb.y + tb.height <= nf.y + 4 && (nf.y - (tb.y + tb.height)) <= 30;
            const isColumnAligned = tb.x <= nf.x + nf.width && tb.x + tb.width >= nf.x - 20;

            if ((isLeft && isSameRow) || (isRight && isSameRow) || (isAbove && isColumnAligned)) {
                const dist = isLeft
                    ? (nf.x - (tb.x + tb.width))
                    : isRight
                        ? (tb.x - (nf.x + nf.width))
                        : ((nf.y - (tb.y + tb.height)) * 1.5);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestBlock = tb;
                }
            }
        }

        const rawLabel = closestBlock ? closestBlock.str : "";
        const sem = resolveSemanticProps(rawLabel, nf.type, usedNames);

        enriched.push({
            id: nf.id || generateFieldId(),
            type: nf.type || sem.type,
            name: sem.name,
            x: nf.x,
            y: nf.y,
            width: nf.width,
            height: nf.height,
            page: pageNum,
            borderStyle: nf.borderStyle || "none",
            fillStyle: nf.fillStyle || "transparent",
            borderWidth: nf.borderWidth || 0,
            multiline: sem.multiline || false,
            autofill: sem.autofill || "",
            dataFormat: sem.dataFormat || "text",
            tooltip: (sem.label || nf.label || sem.name || "field").replace(/[:_—–-]+$/, '').trim(),
            detectedBy: "neural_vision",
            confidence: nf.confidence || CONFIDENCE.NEURAL_DEFAULT
        });
    }

    return enriched;
}

/**
 * Uniform stage detection plugin contract for enriching neural bounding boxes with text.
 * @param {Object} context Stage detection context
 * @returns {Array} Enriched neural fields
 */
export function detect(context = {}) {
    const {
        rawNeural = context.rawNeuralFields || [],
        rawBlocks = [],
        usedNames = new Set(),
        pageNum = 1
    } = context;
    return enrichNeuralFieldsWithText(rawNeural, rawBlocks, usedNames, pageNum);
}
