// js/engines/detection/vector-fields.js
// Vector-drawn field detection (checkboxes, inputs, comb character slots, table rows)

import { generateFieldId } from "../../core/state.js";
import { isOverlapping } from "../../utils/geometry.js";
import { isUniversalStaticText, resolveSemanticProps } from "./semantic-resolver.js";
import { clusterCombBoxes } from "./comb-fields.js";
import { clusterRadioGroups } from "./radio-clustering.js";

// TODO(refactor-followup): Decompose detectVectorDrawnFields into smaller modular classification stages

// meaning it is a label container, line badge, table header, or pre-filled cell — not a blank input.
export function rectContainsSignificantText(rect, textBlocks) {
    if (!textBlocks || textBlocks.length === 0) return false;
    const pad = 3; // small padding tolerance
    const rRight = rect.x + rect.width;
    const rBottom = rect.y + rect.height;

    // Find all text blocks that fall inside, start inside, or significantly overlap the rectangle
    const innerBlocks = textBlocks.filter(tb => {
        // Ignore text blocks starting in the far right margin of wide boxes (encroachment from adjacent columns/prompts)
        if (rect.width >= 70 && tb.x >= rect.x + rect.width * 0.75) {
            return false;
        }

        const tbRight = tb.x + tb.width;
        const tbBottom = tb.y + tb.height;
        const cx = tb.x + tb.width / 2;
        const cy = tb.y + tb.height / 2;

        // 1. Center of text block is inside rect
        const centerInside = cx >= rect.x - pad && cx <= rRight + pad &&
                             cy >= rect.y - pad && cy <= rBottom + pad;
        if (centerInside) return true;

        // 2. Text block starts inside rect (handles multi-word blocks like "Part I Taxpayer...")
        const startsInside = tb.x >= rect.x - pad && tb.x <= rect.x + Math.max(12, rect.width * 0.7) &&
                             tb.y >= rect.y - pad && (tb.y + Math.min(tb.height, 4)) <= rBottom + pad;
        if (startsInside) return true;

        // 3. Significant physical intersection
        const interX = Math.max(0, Math.min(rRight, tbRight) - Math.max(rect.x, tb.x));
        const interY = Math.max(0, Math.min(rBottom, tbBottom) - Math.max(rect.y, tb.y));
        const interArea = interX * interY;
        const tbArea = tb.width * tb.height;
        if (tbArea > 0 && interArea / tbArea >= 0.5) return true;

        return false;
    });

    if (innerBlocks.length === 0) return false;

    const allText = innerBlocks.map(tb => (tb.str || "").trim()).filter(Boolean).join(" ");
    if (!allText) return false;

    // Is it a genuine checked checkbox? (e.g. pre-filled "X", "✓" in a small checkbox)
    const isSmallBox = rect.width <= 24 && rect.height <= 24;
    if (isSmallBox && /^[xX✓✔☑■●•]$/.test(allText.trim())) {
        return false; // Valid checked checkbox!
    }

    // Allow comb formatting separator masks (e.g. "/" in mm/dd/yy or "-" in phone/zip/ssn)
    if (/^[\/\-\—\–\.\s]+$/.test(allText)) {
        return false;
    }

    // Allow currency prefix symbols inside input boxes (e.g. "$", "€", "£", "¥")
    if (/^[$\u20AC\u00A3\u00A5\s]+$/.test(allText)) {
        return false;
    }

    // A: Line number badges: e.g. "1", "1a", "2b", "10", "12a", "Line 1", "1.", "(a)", "b"
    if (/^(?:line\s*)?\(?\d{1,3}[a-z]?\)?[\.\:\)]?$/i.test(allText) || innerBlocks.some(tb => /^(?:line\s*)?\(?\d{1,3}[a-z]?\)?[\.\:\)]?$/i.test((tb.str || "").trim()))) {
        return true; // Line number badge! Suppress!
    }
    if (rect.width <= 36 && rect.height <= 24 && (/^[a-z][\.\)]?$/i.test(allText) || innerBlocks.some(tb => /^[a-z][\.\)]?$/i.test((tb.str || "").trim())))) {
        return true; // Alphabetical line badge! Suppress!
    }

    // B: Section / Part / Table / Step badges: e.g. "Part I", "Section A", "Schedule 1", "Step 1"
    if (/\b(?:part|section|sec|schedule|step|table|item|box)\b/i.test(allText)) {
        return true; // Section badge! Suppress!
    }

    // Top-anchored internal prompt labels in government/IRS form boxes with clear fillable height below
    if (rect.height >= 18 && rect.width >= 50) {
        const maxTextBottom = Math.max(...innerBlocks.map(tb => tb.y + tb.height));
        const spaceBelow = (rect.y + rect.height) - maxTextBottom;
        if (spaceBelow >= 9 && maxTextBottom <= rect.y + rect.height * 0.65) {
            return false;
        }
    }

    // Small boxes (checkboxes, radio glyphs <= 24x24) are form toggles, not static label containers
    if (isSmallBox) {
        return false;
    }

    // C: Static label / heading words inside rect (>2 chars or multiple blocks)
    if (innerBlocks.length >= 2 || allText.length >= 3) {
        return true;
    }

    // D: Single short token (1-2 chars) inside non-small box
    if (allText.length <= 2) {
        return true;
    }

    return false;
}

export function reconstructLinePhrase(closestWord, rawBlocks, direction = "left") {
    if (!closestWord || !Array.isArray(rawBlocks) || rawBlocks.length === 0) return closestWord?.str || "";
    const lineWords = rawBlocks.filter(tb => 
        Math.abs(tb.y - closestWord.y) <= 4 &&
        !/^[—–\-:\._\s]+$/.test(tb.str)
    );
    if (lineWords.length <= 1) return closestWord.str;

    if (direction === "left") {
        const sorted = lineWords
            .filter(w => w.x <= closestWord.x + 2)
            .sort((a, b) => b.x - a.x);
        const phraseWords = [closestWord];
        let currLeft = closestWord.x;
        for (let i = 1; i < sorted.length; i++) {
            const w = sorted[i];
            const gap = currLeft - (w.x + w.width);
            if (gap >= -3 && gap <= 16) {
                phraseWords.unshift(w);
                currLeft = w.x;
            } else {
                break;
            }
        }
        return phraseWords.map(w => w.str).join(" ").trim();
    } else if (direction === "right") {
        const sorted = lineWords
            .filter(w => w.x >= closestWord.x - 2)
            .sort((a, b) => a.x - b.x);
        const phraseWords = [closestWord];
        let currRight = closestWord.x + closestWord.width;
        for (let i = 1; i < sorted.length; i++) {
            const w = sorted[i];
            const gap = w.x - currRight;
            if (gap >= -3 && gap <= 16) {
                phraseWords.push(w);
                currRight = w.x + w.width;
            } else {
                break;
            }
        }
        return phraseWords.map(w => w.str).join(" ").trim();
    }
    return closestWord.str;
}

/**
 * Classifies whether a vector rectangle is eligible to be considered an input field.
 * Filters out divider bars, section headers, title frames, column spacers, and static text containers.
 */
export function classifyRectAsField(box, rawBlocks = [], checkboxRects = []) {
    if (!box) return { valid: false, reason: "null_box" };
    if (box.height > 70 || box.width > 555) return { valid: false, reason: "bounds_exceeded" };
    // Skip horizontal divider bars and shaded section separators
    if (box.height <= 14 && box.width >= 240) return { valid: false, reason: "divider_bar" };
    // Skip top header banners and form title boxes (e.g. wide title frames spanning across header)
    if (box.y < 70 && box.width >= 120 && box.height <= 35) return { valid: false, reason: "header_banner" };
    // Skip narrow column spacers (e.g. 21.6 pt spacers between columns)
    if (box.width <= 25) return { valid: false, reason: "column_spacer" };
    // Skip wide section-header/label bands: thin rows spanning ≥350pt that contain any text
    if (box.height <= 22 && box.width >= 350) {
        const hasHeaderText = rawBlocks.some(tb =>
            tb.x >= box.x - 4 && tb.x <= box.x + box.width + 4 &&
            tb.y >= box.y - 4 && tb.y <= box.y + box.height + 4
        );
        if (hasHeaderText) return { valid: false, reason: "section_header_band" };
    }
    // Skip multi-cell composite boxes that contain 2 or more checkboxes inside
    const innerCbs = checkboxRects.filter(cb => 
        cb.x >= box.x - 2 && cb.x + cb.width <= box.x + box.width + 2 &&
        cb.y >= box.y - 2 && cb.y + cb.height <= box.y + box.height + 2
    );
    if (innerCbs.length >= 2) return { valid: false, reason: "composite_checkbox_box" };

    // Check if there are inner text blocks (e.g. pre-filled values or dropdown glyphs)
    const innerBlocks = rawBlocks.filter(tb => {
        const overlapX = Math.max(0, Math.min(box.x + box.width, tb.x + tb.width) - Math.max(box.x, tb.x));
        const overlapY = Math.max(0, Math.min(box.y + box.height, tb.y + tb.height) - Math.max(box.y, tb.y));
        return (overlapX > 2 && overlapY > 2);
    });
    const hasDropdownGlyph = innerBlocks.some(tb => 
        tb.x >= (box.x + box.width - 25) &&
        /^[vV▼▾▽↓·\u25BC\u25BE\u25BD\u2193\uF074\uF073]$/.test(tb.str.trim())
    );

    return {
        valid: true,
        innerBlocks,
        hasDropdownGlyph
    };
}

/**
 * Locates the nearest associated label prompt (left, top, in-box, or column inheritance) for an input box.
 */
export function attachNearestLabel(box, rawBlocks = [], checkboxRects = [], fields = [], pageNum = 1) {
    const maxLeftReach = box.width <= 85 ? 90 : 200;
    const leftLabel = rawBlocks
        .filter(tb => {
            if (tb.x + tb.width > box.x + 8 || (box.x - (tb.x + tb.width)) > maxLeftReach) return false;
            const vOverlap = Math.max(0, Math.min(box.y + box.height, tb.y + tb.height) - Math.max(box.y, tb.y));
            if (vOverlap < 2) return false;
            if (/^[—–\-:\._\s]+$/.test(tb.str)) return false;
            // Do not steal labels that belong directly to an adjacent checkbox
            if (checkboxRects.some(cb => Math.abs(cb.y - tb.y) <= 8 && tb.x >= cb.x && (tb.x - (cb.x + cb.width)) <= 25)) return false;
            return true;
        })
        .sort((a, b) => (b.x + b.width) - (a.x + a.width))[0];

    const topLabel = !leftLabel ? rawBlocks
        .filter(tb => tb.y + tb.height <= box.y + 6 && (box.y - (tb.y + tb.height)) <= 45 &&
                      (tb.x >= box.x - 60 && tb.x <= box.x + box.width + 60))
        .sort((a, b) => {
            const aOverlap = Math.max(0, Math.min(box.x + box.width, a.x + a.width) - Math.max(box.x, a.x));
            const bOverlap = Math.max(0, Math.min(box.x + box.width, b.x + b.width) - Math.max(box.x, b.x));
            if ((aOverlap > 0) !== (bOverlap > 0)) return bOverlap - aOverlap;

            const aDistX = aOverlap > 0 ? 0 : Math.min(Math.abs(a.x - box.x), Math.abs(a.x + a.width - (box.x + box.width)));
            const bDistX = bOverlap > 0 ? 0 : Math.min(Math.abs(b.x - box.x), Math.abs(b.x + b.width - (box.x + box.width)));
            if (Math.abs(aDistX - bDistX) > 2) return aDistX - bDistX;

            const aDistY = Math.abs(box.y - (a.y + a.height));
            const bDistY = Math.abs(box.y - (b.y + b.height));
            return aDistY - bDistY;
        })[0] : null;

    const rightLabel = (!leftLabel && !topLabel) ? rawBlocks
        .filter(tb => tb.x >= box.x + box.width - 4 && (tb.x - (box.x + box.width)) <= 180 &&
                      Math.abs(tb.y - box.y) <= 18)
        .sort((a, b) => (a.x - (box.x + box.width)) - (b.x - (box.x + box.width)))[0] : null;

    const extCandidate = leftLabel || topLabel;
    const extStr = (extCandidate?.str || "").trim();
    const isPureNumberOrMetric = /^\$?\d+(?:[\.,]\d+)*%?$/.test(extStr);
    const hasSubstantivePromptWords = /[a-zA-Z]{2,}/.test(extStr);
    const hasExternalPrompt = Boolean(extCandidate && hasSubstantivePromptWords && !isPureNumberOrMetric && !isUniversalStaticText(extStr));

    let labelText = "";
    let inheritedCol = null;
    let adjustedBoxY = box.y;
    let adjustedBoxHeight = box.height;

    // Check for in-box top prompt label (common in IRS and government tax forms)
    const inBoxLabels = rawBlocks.filter(tb => 
        tb.x >= box.x - 2 && tb.x + tb.width <= box.x + box.width + 4 &&
        tb.y >= box.y - 2 && tb.y + tb.height <= box.y + box.height * 0.65
    );
    let hasInBoxTopLabel = false;
    if (inBoxLabels.length > 0 && box.height >= 18) {
        const maxTextBottom = Math.max(...inBoxLabels.map(tb => tb.y + tb.height));
        if ((box.y + box.height) - maxTextBottom >= 9) {
            labelText = inBoxLabels.map(tb => tb.str).join(" ").replace(/^(?:\([a-z0-9]+\)|\d+[a-z]?[\.\:]?)\s*/i, "").trim();
            adjustedBoxY = Math.round(maxTextBottom + 1);
            adjustedBoxHeight = Math.round((box.y + box.height) - adjustedBoxY);
            hasInBoxTopLabel = true;
        }
    }

    if (leftLabel && !hasInBoxTopLabel) {
        labelText = reconstructLinePhrase(leftLabel, rawBlocks, "left");
    } else if (topLabel && !hasInBoxTopLabel) {
        labelText = reconstructLinePhrase(topLabel, rawBlocks, "right");
        if (labelText.length < topLabel.str.length) labelText = topLabel.str;
    } else if (rightLabel && !hasInBoxTopLabel) {
        labelText = reconstructLinePhrase(rightLabel, rawBlocks, "right");
    } else if (!hasInBoxTopLabel) {
        // Check column inheritance for table grid rows (stacked boxes in same column)
        const upperColField = fields
            .filter(f => {
                if (f.page !== pageNum) return false;
                const fLeft = f.originalBox?.x ?? f.x;
                const fWidth = f.originalBox?.width ?? f.width;
                const fTop = f.originalBox?.y ?? f.y;
                const fHeight = f.originalBox?.height ?? f.height;
                const fBottom = fTop + fHeight;

                const hOverlap = Math.max(0, Math.min(box.x + box.width, fLeft + fWidth) - Math.max(box.x, fLeft));
                if (hOverlap < Math.min(box.width, fWidth) * 0.6) return false;
                return box.y > fTop && (box.y - fBottom) <= 35 && (box.y - fBottom) >= -2;
            })
            .sort((a, b) => {
                const aBottom = (a.originalBox?.y ?? a.y) + (a.originalBox?.height ?? a.height);
                const bBottom = (b.originalBox?.y ?? b.y) + (b.originalBox?.height ?? b.height);
                return (box.y - bBottom) - (box.y - aBottom);
            })[0];
        if (upperColField) {
            inheritedCol = upperColField;
            labelText = upperColField.columnLabel || upperColField.name;
        }
    }

    return {
        labelText,
        inheritedCol,
        adjustedBoxY,
        adjustedBoxHeight,
        hasInBoxTopLabel,
        hasExternalPrompt,
        extCandidate
    };
}

/**
 * Resolves form field type, dimensions, formatting, and prefilled state based on shape geometry, label text, and context.
 */
export function resolveFieldTypeFromShape(box, labelText, options = {}) {
    const {
        sem,
        inheritedCol = null,
        hasDropdownGlyph = false,
        rawBlocks = [],
        adjustedBoxY = box.y,
        adjustedBoxHeight = box.height,
        hasExternalPrompt = false,
        innerBlocks = [],
        pageNum = 1
    } = options;

    const isSig = sem.type === "signature" || /\b(?:e[-_]?)?sign(?:ature|ed|ing)?\b|sign\s*here|authorized\s*signature|employee\s*signature|applicant\s*signature|taxpayer\s*signature|sign\s*below|handtekening|unterschrift|firma/i.test(labelText);
    const isDate = sem.type === "dateField" || /date/i.test(labelText);
    const isQuestionOrCheckbox = sem.type === "checkBox" || /\?$/.test(labelText) || /\b(sick\??|absent\??|yes\??|no\??)\b/i.test(labelText);
    let type = isSig ? "signature" : (isDate ? "dateField" : (isQuestionOrCheckbox || inheritedCol?.type === "checkBox" ? "checkBox" : (inheritedCol?.type || sem.type)));
    if (hasDropdownGlyph || /^(?:country|state|language|gender|status|choice|select|dropdown)/i.test(labelText) || /dropdown|listbox|choice/i.test(labelText)) {
        type = "dropdown";
    }

    // Currency symbol proximity ($ € £ ¥ directly left of box or inside left edge)
    const hasCurrencySymbol = rawBlocks.some(tb => 
        /^[$\u20AC\u00A3\u00A5]$/.test(tb.str.trim()) &&
        ((tb.x + tb.width <= box.x + 4 && (box.x - (tb.x + tb.width)) <= 20 && Math.abs(tb.y - box.y) <= 12) ||
         (tb.x >= box.x - 2 && tb.x <= box.x + 18 && tb.y >= box.y - 2 && tb.y <= box.y + box.height + 2))
    );
    const dataFormat = hasCurrencySymbol ? "currency" : (inheritedCol?.dataFormat || sem.dataFormat || "text");

    let fx = box.x;
    let fy = adjustedBoxY;
    let fw = box.width;
    let fh = adjustedBoxHeight;
    if (type === "checkBox" && box.width > 24) {
        fw = 15;
        fh = 15;
        fx = Math.round(box.x + (box.width - fw) / 2);
        fy = Math.round(box.y + (box.height - fh) / 2);
    }

    const dayMatch = rawBlocks.find(tb => 
        tb.y + tb.height <= box.y && (box.y - (tb.y + tb.height)) <= 85 &&
        /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(tb.str.trim())
    );
    let fieldName = sem.name;
    if (dayMatch) {
        const prefix = dayMatch.str.trim().slice(0, 3).toLowerCase() + "_";
        if (!fieldName.startsWith(prefix)) {
            fieldName = prefix + fieldName;
        }
    }

    let prefilledVal = "";
    if (hasExternalPrompt && innerBlocks.length > 0) {
        prefilledVal = innerBlocks.map(tb => tb.str || "").join(" ").replace(/[vV▼▾▽↓·\u25BC\u25BE\u25BD\u2193\uF074\uF073]$/, "").trim();
    }

    return {
        id: generateFieldId(),
        type,
        name: fieldName,
        value: prefilledVal,
        x: fx,
        y: fy,
        width: fw,
        height: fh,
        page: pageNum,
        borderStyle: "solid",
        fillStyle: "white",
        multiline: type !== "checkBox" && type !== "radioGroup" && (box.height >= 36 || sem.multiline || Boolean(inheritedCol?.multiline)),
        autofill: sem.autofill || "",
        dataFormat,
        columnLabel: labelText,
        tooltip: (labelText || fieldName).replace(/[:_—–-]+$/, '').trim(),
        originalBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        detectedBy: inheritedCol ? "vector_drawn_table_grid_row" : "vector_drawn_input_box",
        confidence: 0.98
    };
}

export function detectVectorDrawnFields(vectorShapes, rawBlocks, pageNum, usedNames, existingFields = [], options = {}) {
    const fields = [];
    if (!vectorShapes) return fields;
    const { checkboxRects = [], inputBoxRects = [], allRects = [] } = vectorShapes;

    const consumedRects = new Set();
    const candidateRects = allRects.length > 0 ? allRects : [...checkboxRects, ...inputBoxRects.filter(b => b.width <= 40)];

    // 1. Detect Comb / Segmented Character Fields (SSN, Date, TIN, Account #)
    const combClusters = clusterCombBoxes(candidateRects);
    for (const cluster of combClusters) {
        const minX = Math.min(...cluster.map(b => b.x));
        const minY = Math.min(...cluster.map(b => b.y));
        const maxX = Math.max(...cluster.map(b => b.x + b.width));
        const maxY = Math.max(...cluster.map(b => b.y + b.height));
        const combWidth = maxX - minX;
        const combHeight = maxY - minY;
        const maxLen = cluster.length;

        // Find label directly to the left or directly above
        const leftLabel = rawBlocks
            .filter(tb => tb.x + tb.width <= minX + 8 && (minX - (tb.x + tb.width)) <= 220 &&
                          Math.abs(tb.y - minY) <= 16 && !/^[—–\-:\._\s]+$/.test(tb.str))
            .sort((a, b) => (b.x + b.width) - (a.x + a.width))[0];

        const topLabel = !leftLabel ? rawBlocks
            .filter(tb => tb.y + tb.height <= minY + 4 && (minY - (tb.y + tb.height)) <= 28 &&
                          (tb.x >= minX - 30 && tb.x <= maxX + 30) && !/^[—–\-:\._\s\/]+$/.test(tb.str))
            .sort((a, b) => (minY - (b.y + b.height)) - (minY - (a.y + a.height)))[0] : null;

        const matchedLabel = leftLabel || topLabel;
        if (!matchedLabel || isUniversalStaticText(matchedLabel.str)) {
            // Comb fields must have an associated prompt or be in the body of the form
            if (minY < 95 || cluster[0].width < 8) {
                continue;
            }
        }
        const labelText = (matchedLabel && !isUniversalStaticText(matchedLabel.str)) ? matchedLabel.str : "comb_field";

        const isCombKeyword = /\b(ssn|social\s*sec|tin|ein|tax\s*id|routing|account|pin|zip|postal|date|birth|dob|id\b|ref(?:erence)?|number|no\.|no\b|num|code|case|member|policy|claim|invoice|order|ticket|serial|tracking|confirm|applic|regist|patient|employee|student|vendor|permit|license|licence)\b/i.test(labelText);
        const isSquareCell = (cluster[0].width / cluster[0].height >= 0.85 && cluster[0].width >= 13);
        // Square cell clusters (e.g. 18x18 checkboxes) must have explicit comb keywords to be treated as combs.
        // Otherwise, they are checkbox grids (e.g. OSHA 300 outcome columns) and should remain individual checkboxes.
        if (isSquareCell && !isCombKeyword) {
            continue;
        }

        // Skip if the entire comb box contains significant static text or column headers
        if (rectContainsSignificantText({ x: minX, y: minY, width: combWidth, height: combHeight }, rawBlocks)) {
            continue;
        }

        const sem = resolveSemanticProps(labelText, "textField", usedNames);

        let dataFormat = sem.dataFormat || "text";
        if (/ssn|social\s*sec/i.test(labelText)) dataFormat = "ssn";
        else if (/date|dob|birth/i.test(labelText)) dataFormat = "date";
        else if (/tin|ein|tax\s*id/i.test(labelText)) dataFormat = "tin";
        else if (/zip|postal/i.test(labelText)) dataFormat = "zip";
        else if (/routing/i.test(labelText)) dataFormat = "routingNumber";
        else if (/account/i.test(labelText)) dataFormat = "accountNumber";

        const field = {
            id: generateFieldId(),
            type: "textField",
            name: sem.name,
            x: minX,
            y: minY,
            width: combWidth,
            height: combHeight,
            page: pageNum,
            borderStyle: "solid",
            fillStyle: "white",
            multiline: false,
            autofill: sem.autofill || "",
            dataFormat: dataFormat,
            isComb: true,
            maxLength: maxLen,
            tooltip: (labelText || sem.name).replace(/[:_—–-]+$/, '').trim(),
            detectedBy: "vector_drawn_comb",
            confidence: 0.98
        };

        if (!isOverlapping(field, existingFields, 0.35) && !isOverlapping(field, fields, 0.35)) {
            fields.push(field);
            cluster.forEach(box => consumedRects.add(box));
        }
    }

    // 2. Match Vector Checkbox Squares (excluding consumed comb boxes)
    for (const cbox of checkboxRects) {
        if (consumedRects.has(cbox)) continue;
        // Skip boxes that already contain label text inside (table header cells, etc.)
        if (rectContainsSignificantText(cbox, rawBlocks)) continue;

        // Find text label directly to the right
        const rightLabel = rawBlocks
            .filter(tb => tb.x >= cbox.x + cbox.width - 2 && (tb.x - (cbox.x + cbox.width)) <= 180 &&
                          Math.abs(tb.y - cbox.y) <= 14)
            .sort((a, b) => a.x - b.x)[0];

        // Find text label directly to the left if none to the right (must be in close proximity <= 45 pt)
        const leftLabel = !rightLabel ? rawBlocks
            .filter(tb => tb.x + tb.width <= cbox.x + 2 && (cbox.x - (tb.x + tb.width)) <= 45 &&
                          Math.abs(tb.y - cbox.y) <= 14 && !/^[—–\-:\._\s]+$/.test(tb.str))
            .sort((a, b) => (b.x + b.width) - (a.x + a.width))[0] : null;

        // Find column/option label directly above if none to right or left
        const topLabel = (!rightLabel && !leftLabel) ? rawBlocks
            .filter(tb => tb.y + tb.height <= cbox.y && (cbox.y - (tb.y + tb.height)) <= 45 &&
                          Math.abs((tb.x + tb.width / 2) - (cbox.x + cbox.width / 2)) <= 25 &&
                          !/^[—–\-:\._\s]+$/.test(tb.str))
            .sort((a, b) => (cbox.y - (a.y + a.height)) - (cbox.y - (b.y + b.height)))[0] : null;

        const matchedLabel = rightLabel || leftLabel || topLabel;
        // Skip checkboxes labelled with universal static text (section headings, instructions, disclaimers).
        // However, allow single-word sentence starters like "I", "We", "The" that begin a certify/agree phrase
        // (these appear as single words because our word-by-word text block extraction splits them).
        if (matchedLabel && isUniversalStaticText(matchedLabel.str)) {
            // Exception: single pronoun/article that starts a right-side certify/agree sentence
            const isSentenceStarter = /^(i|we|the|by|this|he|she|they)$/i.test(matchedLabel.str.trim())
                && rightLabel != null
                && rawBlocks.some(tb => tb.x > cbox.x + cbox.width + 2 && tb.x <= cbox.x + cbox.width + 200
                    && Math.abs(tb.y - cbox.y) <= 14
                    && /^(certify|agree|acknowledge|confirm|authorize|consent|declare|verify|attest|accept|understand|permit|authorize)$/i.test(tb.str.trim()));
            if (!isSentenceStarter) continue;
        }
        // Suppress unlabelled checkboxes in the top header/seal area or far page margins
        const pageW = vectorShapes?.viewport?.width || 612;
        if (!matchedLabel && (cbox.y < 80 || cbox.x <= 20 || (pageW <= 612 && cbox.x >= 545))) {
            continue;
        }

        const label = matchedLabel?.str || "";
        const sem = resolveSemanticProps(label || "checkbox", "checkBox", usedNames);
        const field = {
            id: generateFieldId(),
            type: "checkBox",
            name: sem.name,
            value: label || "Yes",
            x: cbox.x,
            y: cbox.y,
            width: cbox.width,
            height: cbox.height,
            page: pageNum,
            borderStyle: "solid",
            fillStyle: "white",
            multiline: false,
            autofill: "",
            dataFormat: "text",
            tooltip: (label || sem.label || sem.name).replace(/[:_—–-]+$/, '').trim(),
            detectedBy: "vector_drawn_checkbox",
            confidence: 0.98
        };
        if (!isOverlapping(field, existingFields, 0.35) && !isOverlapping(field, fields, 0.35)) {
            fields.push(field);
        }
    }


    // 3. Match Vector Input Rectangles (excluding consumed comb boxes)
    const sortedInputBoxes = [...inputBoxRects].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const box of sortedInputBoxes) {
        if (consumedRects.has(box)) continue;

        const classification = classifyRectAsField(box, rawBlocks, checkboxRects);
        if (!classification.valid) continue;
        const { innerBlocks, hasDropdownGlyph } = classification;

        const labelInfo = attachNearestLabel(box, rawBlocks, checkboxRects, fields, pageNum);
        let { labelText, inheritedCol, adjustedBoxY, adjustedBoxHeight, hasExternalPrompt } = labelInfo;

        // Skip boxes that contain significant static text, UNLESS it has a clear external prompt (pre-filled field) or dropdown glyph
        if (rectContainsSignificantText(box, rawBlocks)) {
            if (!hasExternalPrompt && !hasDropdownGlyph) {
                continue;
            }
            // Furthermore, if it has significant text, it cannot have multi-token explanatory or paragraph text inside
            const innerText = innerBlocks.map(tb => (tb.str || "").trim()).filter(Boolean).join(" ");
            if (innerText.length > 40 || innerBlocks.length >= 8) {
                continue;
            }
        }

        // If matched label is universal static text (e.g. section title, instructions, OMB), this is a static container, not an input!
        if (labelText && isUniversalStaticText(labelText)) {
            continue;
        }
        if (!labelText) {
            // Unlabelled vector boxes in calculation columns or banner areas are skipped
            if (box.y < 95 || box.width <= 85 || (box.width >= 200 && box.height <= 30) || box.width > 560 || box.height > 65 || (box.width > 555 && box.height > 40)) {
                continue;
            }
            labelText = "field";
        }

        const sem = resolveSemanticProps(labelText, "textField", usedNames);
        const field = resolveFieldTypeFromShape(box, labelText, {
            sem,
            inheritedCol,
            hasDropdownGlyph,
            rawBlocks,
            adjustedBoxY,
            adjustedBoxHeight,
            hasExternalPrompt,
            innerBlocks,
            pageNum
        });

        if (!isOverlapping(field, existingFields, 0.35) && !isOverlapping(field, fields, 0.35)) {
            fields.push(field);
        }
    }

    // 4. Match Vector Underlines (e.g. from scanned docs or vector path underlines)
    const underlineLines = vectorShapes.underlines || [];
    for (const u of underlineLines) {
        if (u.width < 25) continue;
        const uX = u.x;
        const uY = u.y;
        const uW = u.width;
        const uH = 18;
        const fieldY = Math.max(0, uY - 16);

        // Skip underline if text rests directly on or intersects the underline baseline (e.g. hyperlinks or underlined prose)
        // Exception: Currency symbols ($ € £ ¥) resting on or at the left end of the underline indicate a currency entry slot, not prose
        const textOnLine = rawBlocks.filter(tb => 
            tb.x >= uX - 6 && (tb.x + tb.width) <= uX + uW + 6 &&
            Math.abs((tb.y + tb.height) - uY) <= 3 &&
            !/^[$\u20AC\u00A3\u00A5—–\-:\._\s]+$/.test(tb.str.trim())
        );
        if (textOnLine.length > 0) continue;

        // Currency symbol proximity ($ € £ ¥ directly left of underline or resting on left edge)
        const currencyToken = rawBlocks.find(tb => 
            /^[$\u20AC\u00A3\u00A5]$/.test(tb.str.trim()) &&
            ((tb.x + tb.width <= uX + 4 && (uX - (tb.x + tb.width)) <= 20 && Math.abs(tb.y - uY) <= 12) ||
             (tb.x >= uX - 4 && tb.x <= uX + 16 && Math.abs((tb.y + tb.height) - uY) <= 5))
        );
        let startX = uX;
        let lineW = uW;
        if (currencyToken && currencyToken.x >= uX - 4 && currencyToken.x <= uX + 16) {
            startX = currencyToken.x + currencyToken.width + 2;
            lineW = Math.max(20, (uX + uW) - startX);
        }

        // Skip underline if near text matches a URL
        const isUrl = rawBlocks.some(tb => 
            Math.abs(tb.y - uY) <= 12 && 
            Math.max(0, Math.min(uX + uW, tb.x + tb.width) - Math.max(uX, tb.x)) > 0 &&
            /https?:\/\/|www\.|\.gov|\.org|\.com|\.html|\.pdf/i.test(tb.str)
        );
        if (isUrl) continue;

        // Skip underlines that are the top or bottom border stroke of a known inputBoxRect or checkboxRect.
        // These are rectangle edges, not standalone fill-in underlines.
        const isRectEdge = [...(vectorShapes.inputBoxRects || []), ...(vectorShapes.checkboxRects || [])].some(box => {
            // Same x-span (within 8pt) and y is near top or bottom of the box
            const xMatch = Math.abs(uX - box.x) <= 8 && Math.abs((uX + uW) - (box.x + box.width)) <= 8;
            if (!xMatch) return false;
            const nearTop    = Math.abs(uY - box.y) <= 4;
            const nearBottom = Math.abs(uY - (box.y + box.height)) <= 4;
            return nearTop || nearBottom;
        });
        if (isRectEdge) continue;


        // 1. Search for prompt words directly above the underline
        const wordsAbove = rawBlocks.filter(tb => 
            tb.x >= uX - 8 && (tb.x + tb.width) <= uX + uW + 12 &&
            tb.y >= uY - 28 && (tb.y + tb.height) <= uY + 1 &&
            !/^[—–\-:\._\s$]+$/.test(tb.str)
        );

        let topLabelText = "";
        if (wordsAbove.length > 0) {
            topLabelText = wordsAbove
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map(w => w.str)
                .join(" ");
            topLabelText = topLabelText.replace(/^\(?[a-z0-9]{1,3}\)?[\.\:]?\s*/i, "").trim();
        }

        // 2. Search for close left-label on same baseline
        const leftLabel = rawBlocks
            .filter(tb => tb.x + tb.width <= startX + 8 && (startX - (tb.x + tb.width)) <= 80 &&
                          Math.abs(tb.y - (uY - 12)) <= 14 && !/^[—–\-:\._\s$]+$/.test(tb.str))
            .sort((a, b) => {
                const aDistY = Math.abs(a.y - (uY - 12));
                const bDistY = Math.abs(b.y - (uY - 12));
                if (Math.abs(aDistY - bDistY) > 3) return aDistY - bDistY;
                return (b.x + b.width) - (a.x + a.width);
            })[0];

        // 3. Search for prompt words directly below the underline (e.g. signature or date sub-captions)
        const wordsBelow = (!topLabelText && !leftLabel) ? rawBlocks.filter(tb => 
            tb.x >= uX - 8 && (tb.x + tb.width) <= uX + uW + 12 &&
            tb.y >= uY - 1 && (tb.y + tb.height) <= uY + 24 &&
            !/^[—–\-:\._\s$]+$/.test(tb.str)
        ) : [];
        let belowLabelText = "";
        if (wordsBelow.length > 0) {
            belowLabelText = wordsBelow
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map(w => w.str)
                .join(" ");
            belowLabelText = belowLabelText.replace(/^\(?[a-z0-9]{1,3}\)?[\.\:]?\s*/i, "").trim();
        }

        let labelText = "";
        let inheritedCol = null;

        if (topLabelText && !isUniversalStaticText(topLabelText)) {
            labelText = topLabelText;
        } else if (leftLabel) {
            labelText = reconstructLinePhrase(leftLabel, rawBlocks, "left");
        } else if (belowLabelText && !isUniversalStaticText(belowLabelText)) {
            labelText = belowLabelText;
        } else if (topLabelText) {
            labelText = topLabelText;
        } else if (belowLabelText) {
            labelText = belowLabelText;
        } else {
            // Check column inheritance for table grid rows (stacked underlines in same column)
            const upperColField = fields
                .filter(f => f.page === pageNum && Math.abs(f.x - startX) <= 6 && Math.abs(f.width - lineW) <= 8 &&
                             uY > f.y && (uY - (f.y + f.height)) <= 35 && (uY - (f.y + f.height)) >= -2)
                .sort((a, b) => (uY - (b.y + b.height)) - (uY - (a.y + a.height)))[0];
            if (upperColField) {
                inheritedCol = upperColField;
                labelText = upperColField.columnLabel || upperColField.name;
            }
        }

        if (labelText && isUniversalStaticText(labelText)) {
            continue;
        }
        if (!labelText) {
            labelText = "field";
        }
        const sem = resolveSemanticProps(labelText, "textField", usedNames);
        const isSig = sem.type === "signature" || /\b(?:e[-_]?)?sign(?:ature|ed|ing)?\b|sign\s*here|sign\s*below|authorized\s*signature|employee\s*signature|applicant\s*signature|taxpayer\s*signature|handtekening|unterschrift|firma/i.test(labelText);
        const isDate = sem.type === "dateField" || /date/i.test(labelText);
        const isQuestionOrCheckbox = sem.type === "checkBox" || /\?$/.test(labelText) || /\b(sick\??|absent\??|yes\??|no\??)\b/i.test(labelText);
        const type = isSig ? "signature" : (isDate ? "dateField" : (isQuestionOrCheckbox || inheritedCol?.type === "checkBox" ? "checkBox" : (inheritedCol?.type || sem.type)));
        
        const hasCurrencySymbol = Boolean(currencyToken);
        const dataFormat = hasCurrencySymbol ? "currency" : (inheritedCol?.dataFormat || sem.dataFormat || "text");

        let fw = Math.round(lineW);
        let fh = isSig ? 32 : 12;
        let fx = Math.round(startX);
        let fy = Math.round(Math.max(0, uY - fh));

        if (type === "signature") {
            fw = Math.max(fw, 120);
            fh = Math.max(fh, 30);
            fy = Math.round(Math.max(0, uY - fh));
        } else if (type === "checkBox" && uW > 24) {
            fw = 15;
            fh = 15;
            fx = Math.round(uX + (uW - fw) / 2);
            fy = Math.round(uY - fh);
        }

        const dayMatch = rawBlocks.find(tb => 
            tb.y + tb.height <= uY && (uY - (tb.y + tb.height)) <= 85 &&
            /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(tb.str.trim())
        );
        let fieldName = sem.name;
        if (dayMatch) {
            const prefix = dayMatch.str.trim().slice(0, 3).toLowerCase() + "_";
            if (!fieldName.startsWith(prefix)) {
                fieldName = prefix + fieldName;
            }
        }

        const field = {
            id: generateFieldId(),
            type: type,
            name: fieldName,
            x: fx,
            y: fy,
            width: fw,
            height: fh,
            page: pageNum,
            borderStyle: "none",
            fillStyle: "transparent",
            multiline: type !== "checkBox" && (sem.multiline || Boolean(inheritedCol?.multiline) || false),
            autofill: sem.autofill || "",
            dataFormat: dataFormat,
            columnLabel: labelText,
            tooltip: (labelText || fieldName).replace(/[:_—–-]+$/, '').trim(),
            detectedBy: inheritedCol ? "vector_drawn_table_grid_row" : "vector_drawn_underline",
            confidence: topLabelText ? 0.94 : (leftLabel ? 0.91 : (belowLabelText ? 0.88 : 0.82))
        };

        if (!isOverlapping(field, existingFields, 0.35) && !isOverlapping(field, fields, 0.35)) {
            fields.push(field);
        }
    }

    if (options && options.clusterRadios) {
        clusterRadioGroups(fields, rawBlocks, usedNames);
    }
    return fields;
}
