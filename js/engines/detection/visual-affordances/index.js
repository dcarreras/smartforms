// js/engines/detection/visual-affordances/index.js
// Text affordance detectors: checkboxes glyphs, bracket/paren pairs, colon prompts, tax line leaders, lattice stream tables

import { generateFieldId } from "../../../core/state.js";
import { isOverlapping } from "../../../utils/geometry.js";
import { isUniversalStaticText, resolveSemanticProps } from "../semantic-resolver.js";
import { calculateDocumentColumnBoundaries } from "../vector-shapes.js";
import { clusterIntoLines } from "./line-clustering.js";
import { TABLE_COL_DEFS, matchColumnKeyword } from "../table-grid.js";

// TODO(refactor-followup): Decompose detectVisualAffordances into glyph and colon-prompt submodules

/**
 * Detects financial, tax schedule, and line-item input affordances.
 * Matches dotted leaders (. . . . .) or line indicator tokens (1a, 1b, 2, 10b, etc.)
 * ending in empty right-aligned currency/numeric amount columns.
 */
export function detectTaxScheduleLineAffordances(rawBlocks, viewport, pageNum, usedNames, existingFields = []) {
    const fields = [];
    if (!rawBlocks || rawBlocks.length === 0) return fields;

    const pageWidth = viewport?.width || 612;
    const pageHeight = viewport?.height || 792;

    // Cluster into horizontal line rows (y tolerance 4pt)
    const lines = [];
    const sortedWords = [...rawBlocks].sort((a, b) => a.y - b.y);

    for (const w of sortedWords) {
        const yCenter = w.y + (w.height || 10) / 2;
        let matchedLine = null;
        for (const l of lines) {
            if (Math.abs(l.yCenter - yCenter) <= 4) {
                matchedLine = l;
                break;
            }
        }
        if (!matchedLine) {
            matchedLine = { yCenter, y: w.y, height: w.height || 12, items: [] };
            lines.push(matchedLine);
        }
        matchedLine.items.push(w);
    }

    const LINE_TOKEN_REGEX = /^(?:\d{1,2}[a-z]?|[a-z])$/i;

    for (const line of lines) {
        const rowItems = line.items.sort((a, b) => a.x - b.x);
        const rowStr = rowItems.map(it => it.str).join(" ");

        // Strict dotted leader check: at least 4 dots spaced out or 5 total periods
        const hasDots = /(?:\.\s*){4,}/.test(rowStr) || (rowStr.match(/\./g) || []).length >= 5;
        const hasSchedulePrompt = /\b(?:line|lines|add|subtract|total|amount|gross|income|tax|wages|deduction|interest|dividends|credit|payment|refund|penalty|balance|due)\b/i.test(rowStr);

        // A schedule line must have dotted leaders OR explicit schedule computation prompt keywords
        if (!hasDots && !hasSchedulePrompt) continue;

        // If no dotted leader is present, the row must be an explicit schedule line item,
        // NOT a continuous paragraph of instructional prose containing inline monetary examples.
        if (!hasDots) {
            if (/\b(?:for example|e\.g\.|such as|if your|see instructions|pub\.|publication)\b/i.test(rowStr)) continue;
            const lastItem = rowItems[rowItems.length - 1];
            if (lastItem && (lastItem.x + lastItem.width) > pageWidth * 0.88) continue;
        }

        for (let i = 0; i < rowItems.length; i++) {
            const item = rowItems[i];
            const token = item.str.trim();

            const isNumToken = /^\d{1,2}[a-z]?$/i.test(token);
            // Single letters (e.g. 'a', 'b', 'z') ONLY allowed if there is an explicit dotted leader in the line
            const isLetterSubline = /^[a-z]$/i.test(token) && hasDots;

            if (!isNumToken && !isLetterSubline) continue;

            // When no dotted leader is present, the token must be an anchored line indicator at the start of the row
            // (e.g. item 0 or 1, and x <= 160) OR immediately preceding the right-hand slot
            if (!hasDots) {
                const isAnchoredStart = (i <= 1 && item.x <= 160);
                const isAnchoredEnd = (i === rowItems.length - 1 && item.x >= 350);
                if (!isAnchoredStart && !isAnchoredEnd) continue;
            }

            const xEnd = item.x + item.width;
            const nextItem = i + 1 < rowItems.length ? rowItems[i + 1] : null;

            const slotX1 = xEnd + 3;
            // Standard right margin boundary is typically around 576pt (pageWidth - 36)
            const slotX2 = nextItem ? (nextItem.x - 3) : Math.min(576, pageWidth - 36);
            const slotWidth = slotX2 - slotX1;

            // Slot must have standard currency column width (48 to 135 pt)
            if (slotWidth >= 48 && slotWidth <= 135) {
                // Must either be near right margin or followed by an interior column
                if (slotX2 >= pageWidth * 0.75 || (nextItem && nextItem.x >= 280)) {
                    // Verify slot does not overlap existing text words
                    const wordsInSlot = rowItems.some(w => w.x >= slotX1 - 2 && (w.x + w.width) <= slotX2 + 2);
                    if (wordsInSlot) continue;

                    // Extract label text from words to the left of this token
                    const labelWords = rowItems.slice(0, i)
                        .filter(w => !/^[\.\s_—–\-]+$/.test(w.str))
                        .map(w => w.str)
                        .join(" ")
                        .trim();

                    if (!labelWords || isUniversalStaticText(labelWords)) continue;

                    const cleanLabel = (labelWords.length > 0 ? labelWords : `line_${token}`).slice(0, 32);
                    const sem = resolveSemanticProps(cleanLabel || `line_${token}`, "textField", usedNames);

                    const fieldY = Math.round(line.yCenter - 6);
                    const fieldH = Math.max(12, Math.round(line.height || 12));

                    const field = {
                        id: generateFieldId(),
                        type: "textField",
                        name: sem.name,
                        x: Math.round(slotX1),
                        y: fieldY,
                        width: Math.round(slotWidth),
                        height: fieldH,
                        page: pageNum,
                        borderStyle: "solid",
                        fillStyle: "white",
                        multiline: false,
                        autofill: "",
                        dataFormat: "currency",
                        tooltip: (labelText || sem.name).replace(/[:_—–-]+$/, '').trim(),
                        detectedBy: "tax_schedule_affordance",
                        confidence: 0.92
                    };

                    if (!isOverlapping(field, existingFields, 0.25) && !isOverlapping(field, fields, 0.25)) {
                        fields.push(field);
                    }
                }
            }
        }
    }

    return fields;
}

// ============================================================================
// 4. DETECTION PIPELINE
// ============================================================================
export function detectVisualAffordances(rawBlocks, viewport, pageNum, usedNames, existingFields = [], preRegisteredTableRegions = [], vectorShapes = null) {
    const fields = [...existingFields];
    const seedCount = existingFields.length;
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    const textLines = clusterIntoLines(rawBlocks);
    const docLayout = calculateDocumentColumnBoundaries(rawBlocks, pageWidth, pageHeight);

    // ------------------------------------------------------------------------
    // AFFORDANCE 1: Standalone & Labelled Checkboxes & Radios (with Fieldset Groups)
    // ------------------------------------------------------------------------
    const CHECKBOX_CHARS = new Set([
        "☐", "□", "▣", "■", "◻", "◼", "◽", "◾", "⬜", "⬛",
        "☑", "✓", "✔", "☒", "✗", "✘",
        "○", "●", "◯", "◎", "◦", "⬤", "⭕", "⭘", "⭙",
        "", "\uF063", "\uF0A8", "\uF0A9", "\uF0FE", "\uF06F", "\uF071", "\uF073", "\uF074", "\uF0A3", "\uF0B7"
    ]);
    const CHECKBOX_REGEX = /(\[\s*\]|\(\s*\)|[☐□▣■◻◼◽◾⬜⬛☑✓✔☒✗✘○●◯◎◦⬤⭕⭘⭙\uF063\uF0A8\uF0A9\uF0FE\uF06F\uF071\uF073\uF074\uF0A3\uF0B7])/gu;

    for (const line of textLines) {
        // Skip date format placeholder brackets like [ YYYY - MM - DD ]
        if (/\[\s*(?:yyyy|mm|dd)[^\]]*\]/i.test(line.str)) {
            continue;
        }

        // Detect group prompt / legend if line starts with "Prompt:" before choices
        let linePrompt = "";
        const colonIdx = line.str.indexOf(":");
        if (colonIdx !== -1) {
            const beforeColon = line.str.slice(0, colonIdx).trim();
            if (beforeColon.length < 45 && !isUniversalStaticText(beforeColon)) {
                linePrompt = beforeColon;
            }
        }

        let wIdx = 0;
        while (wIdx < line.items.length) {
            const item = line.items[wIdx];
            const str = item.str.trim();

            const isDiscreteSymbol = CHECKBOX_CHARS.has(str);
            const isBracketPair = (str === "[" && wIdx + 1 < line.items.length && line.items[wIdx + 1].str === "]") || /^\[\s*\]$/.test(str);
            const isParenPair = (str === "(" && wIdx + 1 < line.items.length && line.items[wIdx + 1].str === ")") || /^\(\s*\)$/.test(str);

            const isOpen = isDiscreteSymbol || isBracketPair || isParenPair;
            if (isOpen) {
                const markerX = item.x;
                const markerY = item.y;
                const markerType = (str === "(" || str === "○" || str === "●" || str === "◯" || str === "◎" || isParenPair) ? "radioGroup" : "checkBox";

                // Advance index past closing bracket/paren if separate item
                if (wIdx + 1 < line.items.length && (line.items[wIdx + 1].str === ")" || line.items[wIdx + 1].str === "]")) {
                    wIdx++;
                }

                let optLabel = "";
                if (wIdx + 1 < line.items.length && !CHECKBOX_CHARS.has(line.items[wIdx + 1].str) && !["(", "["].includes(line.items[wIdx + 1].str)) {
                    optLabel = line.items[wIdx + 1].str;
                    if (wIdx + 2 < line.items.length && !CHECKBOX_CHARS.has(line.items[wIdx + 2].str) && !["(", "[", ":"].includes(line.items[wIdx + 2].str)) {
                        optLabel += " " + line.items[wIdx + 2].str;
                    }
                } else {
                    optLabel = "option";
                }

                pushCheckboxOrRadioField(markerType, optLabel, markerX, markerY, "affordance1_checkbox_radio");
            } else if (str.length > 2) {
                // Embedded matches inside single text span
                const embeddedMatches = [...item.str.matchAll(CHECKBOX_REGEX)];
                for (const m of embeddedMatches) {
                    const markerStr = m[0];
                    const markerType = /^(\(|[○●◯◎◦⬤⭕⭘⭙])/.test(markerStr) ? "radioGroup" : "checkBox";
                    const charFrac = item.str.length > 0 ? (m.index / item.str.length) : 0;
                    const markerX = Math.round(item.x + charFrac * item.width);
                    const markerY = item.y;

                    let optLabel = item.str.slice(m.index + markerStr.length).trim();
                    optLabel = optLabel.split(/\s+/).slice(0, 4).join(" ");
                    if (!optLabel && wIdx + 1 < line.items.length) {
                        optLabel = line.items[wIdx + 1].str;
                    }
                    if (!optLabel) optLabel = "option";

                    pushCheckboxOrRadioField(markerType, optLabel, markerX, markerY, "affordance1_checkbox_radio_embedded");
                }
            }
            wIdx++;
        }

        function pushCheckboxOrRadioField(markerType, optLabel, markerX, markerY, detectedBy) {
            if (isUniversalStaticText(optLabel)) return;
            const isRadio = markerType === "radioGroup";
            const effectiveLabel = linePrompt ? (isRadio ? linePrompt : `${linePrompt} ${optLabel}`) : optLabel;
            const sem = resolveSemanticProps(effectiveLabel, isRadio ? "radioGroup" : "checkBox", isRadio ? new Set() : usedNames);

            const newField = {
                id: generateFieldId(),
                type: isRadio ? "radioGroup" : "checkBox",
                name: sem.name,
                value: optLabel,
                ...(isRadio ? {
                    radioGroup: linePrompt || sem.name || "radio_group_1",
                    exportValue: optLabel,
                    radioValue: optLabel
                } : {}),
                x: Math.max(10, markerX),
                y: Math.max(10, markerY),
                width: 15,
                height: 15,
                page: pageNum,
                borderStyle: "solid",
                fillStyle: "white",
                multiline: false,
                autofill: "",
                dataFormat: "text",
                tooltip: (effectiveLabel || optLabel).replace(/[:_—–-]+$/, '').trim(),
                detectedBy: detectedBy,
                confidence: 0.70
            };

            if (!isOverlapping(newField, fields, 0.45)) {
                fields.push(newField);
            }
        }
    }

    // ------------------------------------------------------------------------
    // AFFORDANCE 2: Key-Value Prompts with Colons (Label: _____)
    // ------------------------------------------------------------------------
    for (const line of textLines) {
        const text = line.str.trim();
        if (/^[_\-=\*#•·—–─━│┃┌┐└┘├┤┬┴┼░▒▓█\s]+$/.test(text) || (text.includes("?") && !text.includes(":"))) continue;

        const promptMatches = [
            ...text.matchAll(/([\p{L}\p{N}][\p{L}\p{N}\s/()[\]'’"«»*.,#$&°º-]*?)(?:[:ः]|(?=\s*_{2,}))/gu)
        ].filter(m => m[1].trim().length >= 2)
         .sort((a, b) => a.index - b.index);

        for (let i = 0; i < promptMatches.length; i++) {
            const m = promptMatches[i];
            const cleanLabel = m[1].trim();
            if (isUniversalStaticText(cleanLabel)) continue;

            // Skip questions, instructional clauses, and long phrases before colons
            const textAfterColon = text.slice(m.index + m[0].length).trim();
            const hasExplicitPlaceholder = /_{2,}|[\.]{3,}/.test(textAfterColon);
            const labelWithoutParentheticals = cleanLabel.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
            const maxLabelLen = hasExplicitPlaceholder ? 65 : 40;
            const maxLabelWords = hasExplicitPlaceholder ? 9 : 5;
            if (cleanLabel.includes("?") || labelWithoutParentheticals.length > maxLabelLen || labelWithoutParentheticals.split(/\s+/).length > maxLabelWords) continue;
            if (/^(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should|may|what|where|when|which|why|how|if|please|note|notice|caution|warning|section|part|step|item|for|to|include|includes|including|such|case|report|submit|provide)\b/i.test(cleanLabel)) continue;
            if (/\b(?:include\s+the\s+following|includes?|including|as\s+follows|such\s+as|case\s+if|for\s+example|select\s+one|check\s+only\s+one|choose\s+one)\b/i.test(cleanLabel)) continue;
            if (/^\s*\d+[\s.)]/.test(cleanLabel)) continue;

            // 1. Skip if choices (checkboxes/radios) immediately follow
            if (CHECKBOX_REGEX.test(textAfterColon)) {
                CHECKBOX_REGEX.lastIndex = 0;
                if (/^(?:\[\s*\]|\(\s*\)|[☐□▣■◻◼◽◾⬜⬛☑✓✔☒✗✘○●◯◎◦⬤⭕⭘⭙\uF063\uF0A8\uF0A9\uF0FE\uF06F\uF071\uF073\uF074\uF0A3\uF0B7])/.test(textAfterColon)) {
                    continue;
                }
            }
            if (/select\s*all|select\s*one|bitte\s*ausw[äa]hlen|veuillez\s*s[eé]lectionner|seleccione/i.test(cleanLabel)) continue;

            // 2. Skip if this is already-filled static text (e.g. "REF: FRM-7745", "REVISION: 2.4", "STATUS: BLANK")
            const nextPromptInLine = textAfterColon.search(/[\p{L}\p{N}\s/()[\]'’"«»*.,#$&_°º-]+?[:ः]/u);
            const valueChunk = nextPromptInLine !== -1 ? textAfterColon.slice(0, nextPromptInLine).trim() : textAfterColon;
            const isBlankPlaceholder = /^[\s_.\-…·\u2026\u2022]*$/.test(valueChunk);
            const isAlreadyFilledStatic = valueChunk.length > 0 && !isBlankPlaceholder;
            if (isAlreadyFilledStatic) continue;

            const preSem = resolveSemanticProps(cleanLabel);
            const isSig = preSem.type === "signature";
            const isDate = preSem.type === "dateField";
            const isMulti = preSem.multiline;

            // Find physical right edge of THIS specific prompt
            const matchEnd = m.index + m[0].length;
            let charOffset = 0;
            let promptEndX = line.x + line.width;
            for (const it of line.items) {
                const itStart = charOffset;
                const itEnd = charOffset + it.str.length;
                if (matchEnd - 1 >= itStart && matchEnd - 1 <= itEnd) {
                    promptEndX = it.x + it.width;
                    break;
                }
                charOffset += it.str.length + 1;
            }

            const placeholderItem = line.items.find(it => /_{2,}|[\.]{3,}/.test(it.str) && it.x >= promptEndX - 10);
            const targetX = Math.round(placeholderItem && placeholderItem.x >= promptEndX + 2 ? placeholderItem.x : promptEndX + 6);
            let targetY = Math.max(0, Math.round(line.y - (isSig ? 6 : 2)));
            let targetH = isSig ? 38 : (isMulti ? 50 : 20);

            // Strict horizontal collision avoidance: clamp available width against enclosing column and text blocks
            let maxAllowedX = pageWidth - 25;
            if (docLayout && Array.isArray(docLayout.columns)) {
                const currentColumn = docLayout.columns.find(col => targetX >= col.x - 15 && targetX < col.right + 15);
                if (currentColumn && currentColumn.right > targetX + 30) {
                    maxAllowedX = Math.min(maxAllowedX, currentColumn.right - 4);
                }
            }
            for (const tb of rawBlocks) {
                if (/^[_.\s]+$/.test(tb.str)) continue;
                if (tb.x > targetX + 2) {
                    const sameLine = Math.abs(tb.y - line.y) <= Math.max(4, (line.height || 10) * 0.5);
                    if (sameLine) {
                        maxAllowedX = Math.min(maxAllowedX, tb.x);
                    }
                }
            }

            // Skip choice group headers with checkboxes below
            const hasCheckboxesBelow = rawBlocks.some(tb => {
                const isBelow = tb.y > line.y && (tb.y - line.y) <= 22;
                const isAligned = tb.x >= promptEndX - 15 && tb.x < maxAllowedX;
                const isBox = /^[(\[]|[☐□▣■◻◼◽◾⬜⬛☑✓✔☒✗✘○●◯◎◦⬤⭕⭘⭙\uF063\uF0A8\uF0A9\uF0FE\uF06F\uF071\uF073\uF074\uF0A3\uF0B7]/.test(tb.str);
                return isBelow && isAligned && isBox;
            });
            if (hasCheckboxesBelow) continue;

            const availableW = maxAllowedX - targetX - 8;
            if (availableW < 24) {
                // Insufficient space before next column / text; avoid label collision
                continue;
            }

            const sem = resolveSemanticProps(cleanLabel, isSig ? "signature" : (isDate ? "dateField" : "textField"), usedNames);
            const fieldType = isSig ? "signature" : (isDate ? "dateField" : sem.type);
            const fieldName = sem.name;
            const isSingleOnLine = (maxAllowedX >= pageWidth - 45);

            let preferredW = isSig
                ? Math.min(SEMANTIC_DIMENSIONS.signature.width, availableW)
                : (isDate
                    ? Math.min(SEMANTIC_DIMENSIONS.dateField.width, availableW)
                    : (isSingleOnLine ? Math.min(260, availableW) : Math.min(180, availableW)));

            if (fieldName.includes("zip") || fieldName.includes("postal")) {
                preferredW = Math.min(SEMANTIC_DIMENSIONS.zip.width, availableW);
            } else if (fieldName.includes("state")) {
                preferredW = Math.min(SEMANTIC_DIMENSIONS.state.width, availableW);
            } else if (fieldName.includes("phone") || fieldName.includes("tel")) {
                preferredW = Math.min(SEMANTIC_DIMENSIONS.phone.width, availableW);
            } else if (fieldName.includes("ssn") || fieldName.includes("tax_id")) {
                preferredW = Math.min(SEMANTIC_DIMENSIONS.ssn.width, availableW);
            }

            // Check if an explicit vector underline is present next to or under this prompt
            // (excluding horizontal strokes that are top/bottom edges of drawn rectangles)
            const matchingUnderline = (vectorShapes?.underlines || []).find(u => {
                if (Math.abs(u.y - (line.y + line.height)) > 14) return false;
                if (u.x < promptEndX - 15 || (u.x - promptEndX) > 50) return false;
                const isRectEdge = [...(vectorShapes?.inputBoxRects || []), ...(vectorShapes?.checkboxRects || [])].some(box => {
                    const xMatch = Math.abs(u.x - box.x) <= 8 && Math.abs((u.x + u.width) - (box.x + box.width)) <= 8;
                    if (!xMatch) return false;
                    return Math.abs(u.y - box.y) <= 4 || Math.abs(u.y - (box.y + box.height)) <= 4;
                });
                return !isRectEdge;
            });

            const hasTextPlaceholder = /_{2,}|[\.]{3,}/.test(valueChunk) || Boolean(placeholderItem);

            // In forms where explicit vector inputs or underlines exist, ignore arbitrary text colons in paragraphs/instructions
            // UNLESS there is an explicit visual placeholder (underscores or dots) written by the author
            const hasExplicitVectorElements = (vectorShapes?.inputBoxRects?.length || 0) > 0 || (vectorShapes?.underlines?.length || 0) > 0;
            if (hasExplicitVectorElements && !matchingUnderline && !hasTextPlaceholder) {
                continue;
            }

            // On pages without underlines or placeholders, ONLY recognize standard form semantic keys (name, date, ssn, email, phone, etc.)
            // to suppress section headings and prose titles like "Purpose of Package:", "Exception:", "Important:", "Worksheet:"
            if (!matchingUnderline && !hasTextPlaceholder) {
                const isRecognizedFormKey = /^(?:name|first\s*name|last\s*name|full\s*name|address|street|city|state|zip|postal|phone|telephone|mobile|fax|email|e-mail|date|dob|birth|ssn|ein|tin|tax\s*id|title|signature|sign|amount|total|subtotal|quantity|qty|price|rate|company|employer|organization)$/i.test(cleanLabel.replace(/[:_.\s-]+$/, ""));
                if (!isRecognizedFormKey) {
                    continue;
                }
            }

            if (matchingUnderline) {
                preferredW = matchingUnderline.width;
            } else if (placeholderItem) {
                preferredW = Math.max(45, placeholderItem.width);
            }

            const targetW = Math.max(30, Math.min(preferredW, availableW));

            // Strict vertical collision avoidance: clamp targetH against text blocks below in same column
            let maxAllowedY = pageHeight - 25;
            for (const tb of rawBlocks) {
                if (tb.y > targetY + 4) {
                    const hOverlap = Math.max(0, Math.min(targetX + targetW, tb.x + tb.width) - Math.max(targetX, tb.x));
                    if (hOverlap > 6) {
                        maxAllowedY = Math.min(maxAllowedY, tb.y);
                    }
                }
            }

            // Column-aware next line check: only consider lines that share horizontal column overlap
            let nextLineY = null;
            for (const otherLine of textLines) {
                const lineLeft = Math.min(line.x, targetX);
                const lineRight = Math.max(line.x + line.width, targetX + targetW);
                const hOverlap = Math.max(0, Math.min(lineRight, otherLine.x + otherLine.width) - Math.max(lineLeft, otherLine.x));
                if (hOverlap > 6 && otherLine.y > line.y + 2 && (nextLineY === null || otherLine.y < nextLineY)) {
                    nextLineY = otherLine.y;
                }
            }
            if (nextLineY !== null) {
                maxAllowedY = Math.min(maxAllowedY, nextLineY - 2);
            }
            targetH = Math.max(10, Math.min(targetH, Math.max(10, maxAllowedY - targetY - 1)));

            const newField = {
                id: generateFieldId(),
                type: fieldType,
                name: fieldName,
                x: Math.max(10, targetX),
                y: targetY,
                width: Math.round(targetW),
                height: Math.round(targetH),
                page: pageNum,
                borderStyle: "solid",
                fillStyle: "white",
                multiline: isMulti || sem.multiline || false,
                autofill: sem.autofill || "",
                dataFormat: isDate ? "date" : (sem.dataFormat || "text"),
                tooltip: (cleanLabel || fieldName).replace(/[:_—–-]+$/, '').trim(),
                detectedBy: "affordance2_colon_prompt",
                confidence: 0.65
            };

            if (!isOverlapping(newField, fields, 0.20)) {
                fields.push(newField);
            }
        }
    }

    // ------------------------------------------------------------------------
    // AFFORDANCE 3: (Disabled) Open Questions & Inquiries
    // ------------------------------------------------------------------------
    // Arbitrary questions ending in '?' in questionnaires, clinical forms, or
    // surveys are static text and must NOT synthesize phantom text fields.
    // Genuine open input areas require physical vector lines/underlines/boxes.

    // ------------------------------------------------------------------------
    // AFFORDANCE 4: Table Grid Line Items (Invoices, POs, Estimates, Orders)
    // ------------------------------------------------------------------------
    // Guards against detecting the SAME table more than once. Any other line
    // on the page that happens to contain 2+ column keywords (a repeated
    // label, stray text near the table, etc.) would otherwise spin up an
    // independent second "table" with its own guessed boundaries and its own
    // synthetic row spacing — producing stray fields that don't line up with
    // the real grid, floating inside or just past it.
    const processedTableRegions = [...preRegisteredTableRegions];
    const regionsOverlap = (a, b) => {
        const xOverlap = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
        const yOverlap = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
        return xOverlap > 0 && yOverlap > 0;
    };

    for (const line of textLines) {
        const text = line.str.toLowerCase();
        if (line.items.length < 2) continue;

        // Skip lines that are sentences, questions, or paragraphs
        if (/[?!;]/.test(line.str) || line.str.trim().endsWith(".")) continue;
        if (isUniversalStaticText(line.str)) continue;
        const words = line.str.trim().split(/\s+/);
        if (words.length > 8) continue;
        if (/^\s*\d+[\s.)]/.test(line.str)) continue;
        if (/^(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should|what|where|when|which|why|how|if|in|for|to|please)\b/i.test(line.str)) continue;

        const tableColDefs = TABLE_COL_DEFS;

        const matchedCols = [];
        for (const item of line.items) {
            const itemTrim = item.str.trim();
            // A column header must be a short phrase (<= 3 words, <= 25 chars)
            if (itemTrim.length > 25 || itemTrim.split(/\s+/).length > 3) continue;
            for (const col of tableColDefs) {
                if (col.regex.test(itemTrim) && !matchedCols.some(m => m.id === col.id)) {
                    matchedCols.push({ ...col, x: item.x, width: item.width, y: item.y, height: item.height });
                    break;
                }
            }
        }

        // A table header line has at least 2 distinct column keywords
        if (matchedCols.length >= 2 && !text.includes(":")) {
            matchedCols.sort((a, b) => a.x - b.x);

            // Skip this header if it falls inside a table region we've
            // already built fields for — this is very likely a stray
            // repeated label rather than a genuinely separate table.
            const candidateRegion = {
                xMin: matchedCols[0].x - 10,
                xMax: matchedCols[matchedCols.length - 1].x + 130,
                yMin: line.y - 5,
                yMax: line.y + 400 // generous: real table body extends well below the header
            };
            if (processedTableRegions.some(r => regionsOverlap(r, candidateRegion))) {
                continue;
            }

            const columns = [];
            for (let c = 0; c < matchedCols.length; c++) {
                const current = matchedCols[c];
                const next = matchedCols[c + 1];
                const colStartX = Math.max(10, current.x - 4);
                const colEndX = next ? Math.max(colStartX + 25, next.x - 6) : Math.min(pageWidth - 25, current.x + 120);
                columns.push({
                    id: current.id,
                    name: current.name,
                    x: colStartX,
                    width: Math.max(25, colEndX - colStartX)
                });
            }

            const tableTopY = line.y + line.height + 4;
            let tableBottomY = pageHeight - 40;

            for (const tb of rawBlocks) {
                if (tb.y > tableTopY + 15) {
                    if (/^(?:subtotal|total|balance|amount\s*due|tax|vat|gst|discount|notes|terms|payment|authorized|signature|thank\s*you|eforms)/i.test(tb.str) || (tb.str.includes(":") && !tb.str.includes("http"))) {
                        tableBottomY = Math.min(tableBottomY, tb.y - 6);
                    }
                }
            }

            const tableHeight = tableBottomY - tableTopY;
            if (tableHeight >= 30) {
                // Record the real bounds of this table now that we know
                // them, so any later header line that overlaps this region
                // gets skipped instead of spawning a competing table.
                processedTableRegions.push({
                    xMin: columns[0].x - 10,
                    xMax: columns[columns.length - 1].x + columns[columns.length - 1].width + 10,
                    yMin: tableTopY - 5,
                    yMax: tableBottomY + 5
                });
                // Find existing row indices or placeholder rows
                const rowMarkers = rawBlocks.filter(tb => {
                    return tb.y >= tableTopY && tb.y <= tableBottomY && (/^\d+$/.test(tb.str) || /^\$\s*0(?:\.00)?$/.test(tb.str) || tb.str === "[");
                });

                let rowYs = [];
                if (rowMarkers.length >= 2) {
                    const sortedY = rowMarkers.map(m => m.y).sort((a, b) => a - b);
                    for (const y of sortedY) {
                        if (!rowYs.some(ry => Math.abs(ry - y) <= 14)) {
                            rowYs.push(y);
                        }
                    }

                    // Filter out any row marker separated by a large gap from the previous table rows
                    if (rowYs.length >= 2) {
                        const cleanedRowYs = [rowYs[0]];
                        const deltas = [];
                        for (let i = 1; i < rowYs.length; i++) {
                            deltas.push(rowYs[i] - rowYs[i - 1]);
                        }
                        deltas.sort((a, b) => a - b);
                        const medianDelta = deltas[Math.floor(deltas.length / 2)] || 22;

                        for (let i = 1; i < rowYs.length; i++) {
                            const gap = rowYs[i] - cleanedRowYs[cleanedRowYs.length - 1];
                            if (gap <= Math.max(34, medianDelta * 1.6)) {
                                cleanedRowYs.push(rowYs[i]);
                            } else {
                                // Table body has ended; stop accepting rows from below
                                break;
                            }
                        }
                        rowYs = cleanedRowYs;
                    }
                }

                if (rowYs.length === 0) {
                    continue;
                }

                let cellHeight = 18;
                if (rowYs.length >= 2) {
                    const medianRowGap = (rowYs[rowYs.length - 1] - rowYs[0]) / (rowYs.length - 1);
                    cellHeight = Math.min(24, Math.max(15, Math.round(medianRowGap - 4)));
                }

                for (let rIdx = 0; rIdx < rowYs.length; rIdx++) {
                    const rowY = rowYs[rIdx];
                    const rowNum = rIdx + 1;

                    // Never place a field that bleeds past the bottom of the table
                    if (rowY + cellHeight > tableBottomY - 4) {
                        continue;
                    }

                    for (const col of columns) {
                        if (col.id === "item_no") continue;

                        const isCheckboxCol = (col.id === "taxable" || col.id === "receipt");
                        const cellType = isCheckboxCol ? "checkBox" : "textField";
                        const sem = resolveSemanticProps(`${col.name}_${rowNum}`, cellType, usedNames);

                        const cellWidth = isCheckboxCol ? 16 : col.width;
                        const cellX = isCheckboxCol ? Math.round(col.x + Math.max(0, (col.width - 16) / 2)) : col.x;
                        const currentCellH = isCheckboxCol ? 16 : cellHeight;

                        // Static text collision check: never place a field over existing static text
                        const textCollisions = rawBlocks.filter(tb => {
                            const overlapX = Math.max(0, Math.min(cellX + cellWidth, tb.x + tb.width) - Math.max(cellX, tb.x));
                            const overlapY = Math.max(0, Math.min(rowY + currentCellH, tb.y + tb.height) - Math.max(rowY, tb.y));
                            return overlapX > 2 && overlapY > 2;
                        });
                        if (textCollisions.some(tb => tb.str.replace(/[\s.,$]/g, "").length > 0)) {
                            continue;
                        }

                        const cellField = {
                            id: generateFieldId(),
                            type: cellType,
                            name: sem.name,
                            x: cellX,
                            y: rowY,
                            width: cellWidth,
                            height: cellHeight,
                            page: pageNum,
                            borderStyle: "solid",
                            fillStyle: "white",
                            multiline: false,
                            autofill: "",
                            dataFormat: (col.id === "amount" || col.id === "unit_price") ? "currency" : ((col.id === "qty") ? "number" : "text"),
                            tooltip: (col.headerText || col.id).replace(/[:_—–-]+$/, '').trim(),
                            detectedBy: `affordance4_table_col-${col.id}_row-${rowNum}`,
                            confidence: 0.68
                        };

                        if (!isOverlapping(cellField, fields, 0.35)) {
                            fields.push(cellField);
                        }
                    }
                }
            }
        }
    }

    return fields.slice(seedCount);
}
