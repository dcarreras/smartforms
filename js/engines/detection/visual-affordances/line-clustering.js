// js/engines/detection/visual-affordances/line-clustering.js
// Scaffolding and line clustering with OCR artifact scrubbing (DullyPDF rules)

import { CHECKBOX_CHARS } from "./checkbox-glyphs.js";

// OCR Checkbox Artifact patterns (ported from DullyPDF extract_labels.py)
// Empty or checked boxes misread as 0), 6), oO, [ ], ( ), (0), etc.
export const OCR_CHECKBOX_ARTIFACT_RE = /^(?:[©0Oo6Dd]{1,2}[)=]+|[0Oo6Dd]{1,2}$|\[\s*[xXoO0✓✔•·]?\s*\]|\(\s*[xXoO0✓✔•·]?\s*\)|oO|Oo|©)$/;
export const OCR_PUNCT_DIVIDER_RE = /^[_|\-~#=–—\u2013\u2014─━│┃\s]{1,}$/;
export const OCR_LEADING_ARTIFACT_RE = /^(?:[©0Oo6Dd]{1,2}[)=]+|\[\s*[xXoO0✓✔•·\s]?\s*\]|\(\s*[xXoO0✓✔•·\s]?\s*\)|oO\s+|Oo\s+|6\s+|©\s*)\s*/;
export const OCR_BULLET_PREFIX_RE = /^[\s\u2022\u25B6\u25BA\u23E9\u25CF\u25AA\u25AB\uF038\uF0A7\uF0B7\uF06E\uF0A8\uF0FE\u27A4\u27A2\u279C\u2794\u2799\u2798\u2714\u2713\u2043\u2219\u25E6\u2023\-\*•>»=|_~#]+/;

/**
 * Checks if a standalone word token represents an OCR artifact rather than legitimate text.
 */
export function isOcrCheckboxArtifact(text) {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return true;
    return OCR_CHECKBOX_ARTIFACT_RE.test(trimmed) || (OCR_PUNCT_DIVIDER_RE.test(trimmed) && !/(?:\.\s*){3,}|_{3,}/.test(trimmed));
}

/**
 * Cleans OCR artifacts and bullet prefixes from a word or phrase token (DullyPDF extract_labels port).
 */
export function cleanOcrWordToken(text) {
    if (!text || typeof text !== "string") return "";
    let s = text.trim();
    let prev;
    do {
        prev = s;
        s = s.replace(OCR_BULLET_PREFIX_RE, "");
        s = s.replace(OCR_LEADING_ARTIFACT_RE, "");
        s = s.replace(/^\s*(?:\(?\d+[.)]\s*|[a-zA-Z][.)]\s+|[०-९]+[.)]\s*)/u, "");
        s = s.trim();
    } while (s !== prev && s.length > 0);
    return s;
}

export function clusterIntoLines(blocks) {
    if (!blocks || blocks.length === 0) return [];

    // Filter out pure OCR noise blocks before clustering into text lines
    const filteredBlocks = blocks.filter(b => {
        if (!b || typeof b.str !== "string") return false;
        const str = b.str.trim();
        if (!str) return false;
        // Preserve authentic visual checkbox symbols & bracket pairs
        if (CHECKBOX_CHARS.has(str) || /^\[\s*\]$|^\[$|^\]$|^\($|^\)$|^\(\s*\)$/.test(str)) {
            return true;
        }
        // Discard pure OCR noise checkbox artifacts (e.g. 0), 6), oO, etc.)
        if (/^(?:[©0Oo6Dd]{1,2}[)=]+|oO|Oo)$/.test(str)) {
            return false;
        }
        // Discard standalone pure divider noise (e.g. ===, ---, ~~~)
        if (/^[_|\-~#=–—\u2013\u2014─━│┃]{2,}$/.test(str) && !/(?:\.\s*){3,}|_{3,}/.test(str)) {
            return false;
        }
        return true;
    });

    const sorted = [...filteredBlocks].sort((a, b) => (Math.abs(a.y - b.y) <= 4 ? a.x - b.x : a.y - b.y));
    const lines = [];
    let currentLine = null;

    for (let b of sorted) {
        const fontH = Math.max(6, b.height || 12);

        if (!currentLine) {
            currentLine = { ...b, items: [b] };
        } else {
            const refFontH = Math.max(6, currentLine.height || fontH);
            const baselineTolerance = Math.max(6, refFontH * 0.5);
            const gapTolerance = Math.max(60, refFontH * 4);

            const sameBaseline = Math.abs(currentLine.y - b.y) <= baselineTolerance;
            const reasonableGap = b.x >= currentLine.x && (b.x - (currentLine.x + currentLine.width)) <= gapTolerance;

            if (sameBaseline && reasonableGap) {
                currentLine.str += " " + b.str;
                currentLine.width = (b.x + b.width) - currentLine.x;
                currentLine.height = Math.max(currentLine.height, b.height);
                currentLine.items.push(b);
            } else {
                lines.push(currentLine);
                currentLine = { ...b, items: [b] };
            }
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}
