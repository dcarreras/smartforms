// js/engines/detection/underline-fields.js
// Underline and baseline fill-in affordance detection

import { generateFieldId } from "../../core/state.js";
import { isOverlapping } from "../../utils/geometry.js";
import { isUniversalStaticText, resolveSemanticProps } from "./semantic-resolver.js";

export function detectUnderlineFields(grid, rawBlocks, pageNum, usedNames, existingFields = []) {
    const fields = [];
    const horizontalLines = grid?.horizontalLines || [];
    const verticalLines = grid?.verticalLines || [];

    for (const line of horizontalLines) {
        const x = line.start / 2;
        const width = (line.end - line.start) / 2;
        const y = line.offset / 2;
        if (width < 40) continue;

        // Table borders have several vertical intersections. A lone rule is
        // more likely to be an underline or a single blank form boundary.
        const intersections = verticalLines.filter(v => {
            const vx = v.offset / 2;
            return vx >= x - 3 && vx <= x + width + 3;
        }).length;
        if (intersections >= 3) continue;

        const pairedBoundary = horizontalLines.find(other =>
            other.offset > line.offset &&
            other.offset - line.offset >= 24 &&
            other.offset - line.offset <= 120 &&
            Math.abs(other.start - line.start) <= 8 &&
            Math.abs(other.end - line.end) <= 8
        );
        const endpointIntersections = verticalLines.filter(v => {
            const vx = v.offset / 2;
            return Math.abs(vx - x) <= 3 || Math.abs(vx - (x + width)) <= 3;
        }).length;
        if (pairedBoundary && endpointIntersections >= 2) {
            // A closed rectangle is one field, not two underline fields.
            if (line.offset > pairedBoundary.offset) continue;
        }

        const isBox = Boolean(pairedBoundary && endpointIntersections >= 2 && (pairedBoundary.offset - line.offset) / 2 <= 65);
        const fieldHeight = isBox
            ? Math.round((pairedBoundary.offset - line.offset) / 2)
            : 22;
        const candidate = {
            x: Math.max(0, Math.round(x)),
            y: Math.max(0, Math.round(isBox ? y : y - 22)),
            width: Math.round(width),
            height: Math.min(65, Math.max(16, fieldHeight)),
            page: pageNum
        };
        if (candidate.width < 40 || isOverlapping(candidate, existingFields, 0.2) ||
            isOverlapping(candidate, fields, 0.5)) continue;

        const nearbyLabel = rawBlocks
            .filter(tb => tb.y + tb.height <= y + 3 && tb.y + tb.height >= y - 45 &&
                tb.x + tb.width <= x + 12 && x - (tb.x + tb.width) <= 180)
            .sort((a, b) => (y - (a.y + a.height)) - (y - (b.y + b.height)))[0];
        const label = nearbyLabel?.str || "";

        // GUARD: Reject giant container boxes spanning multiple lines or sections
        if (candidate.height > 50 && !/comments|notes|remarks|explanation|feedback|description|allergies|medications|signature/i.test(label)) {
            continue;
        }

        // A standalone decorative rule has no form affordance. Require a
        // nearby, non-banner label unless the pixels clearly form a closed box.
        if (!isBox && (!label || isUniversalStaticText(label))) continue;
        const sem = resolveSemanticProps(label || "field", "textField", usedNames);
        const isSig = /signature|sign\s*here/i.test(label);
        fields.push({
            id: generateFieldId(),
            type: isSig ? "signature" : "textField",
            name: sem.name,
            x: candidate.x,
            y: candidate.y,
            width: candidate.width,
            height: candidate.height,
            page: pageNum,
            borderStyle: "solid",
            fillStyle: "white",
            multiline: false,
            autofill: sem.autofill || "",
            dataFormat: sem.dataFormat || "text",
            tooltip: (label || sem.name).replace(/[:_—–-]+$/, '').trim(),
            detectedBy: "boundary_underline",
            confidence: isSig ? 0.94 : (isBox ? 0.88 : 0.82)
        });
    }
    return fields;
}
