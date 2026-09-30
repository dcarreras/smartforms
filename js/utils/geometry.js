// js/utils/geometry.js
// Geometric utilities and IoU overlap calculation

import { DEDUP_THRESHOLDS } from "../engines/auto-detector.js";

/**
 * Checks if a candidate field significantly overlaps any existing field in the list.
 */
export function isOverlapping(field, list, threshold = DEDUP_THRESHOLDS.WITHIN_STAGE) {
    return list.some(existing => {
        if (field.id && existing.id && field.id === existing.id) return false;
        if ((existing.page || 1) !== (field.page || 1)) return false;

        const xOverlap = Math.max(0, Math.min(field.x + field.width, existing.x + existing.width) - Math.max(field.x, existing.x));
        const yOverlap = Math.max(0, Math.min(field.y + field.height, existing.y + existing.height) - Math.max(field.y, existing.y));
        const overlapArea = xOverlap * yOverlap;
        if (overlapArea <= 0) return false;

        const fieldArea = field.width * field.height;
        const existingArea = existing.width * existing.height;
        const minArea = Math.min(fieldArea, existingArea);
        const unionArea = fieldArea + existingArea - overlapArea;
        const iou = unionArea > 0 ? overlapArea / unionArea : 0;
        const centerDistance = Math.hypot(
            (field.x + field.width / 2) - (existing.x + existing.width / 2),
            (field.y + field.height / 2) - (existing.y + existing.height / 2)
        );
        const similarSize = field.width / existing.width > 0.65 &&
            field.width / existing.width < 1.5 &&
            field.height / existing.height > 0.65 &&
            field.height / existing.height < 1.5;

        const areaRatio = Math.max(fieldArea, existingArea) / minArea;
        const effectiveRatio = areaRatio > 3 ? (overlapArea / fieldArea) : (overlapArea / minArea);

        return minArea > 0 && (
            effectiveRatio > threshold ||
            (iou >= 0.15 && similarSize) ||
            (centerDistance <= 6 && similarSize)
        );
    });
}
