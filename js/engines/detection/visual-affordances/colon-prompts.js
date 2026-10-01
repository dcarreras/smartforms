// js/engines/detection/visual-affordances/colon-prompts.js
// Key-Value prompts with colons (Label: _____)

import { generateFieldId } from "../../../core/state.js";
import { isOverlapping } from "../../../utils/geometry.js";
import { isUniversalStaticText, resolveSemanticProps, SEMANTIC_DIMENSIONS } from "../semantic-resolver.js";
import { CHECKBOX_REGEX } from "./checkbox-glyphs.js";
import { cleanOcrWordToken, isOcrCheckboxArtifact } from "./line-clustering.js";

export function detectColonPrompts(textLines, rawBlocks, viewport, pageNum, usedNames, fields, docLayout, vectorShapes) {
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    for (const line of textLines) {
        const text = line.str.trim();
        if (/^[_\-=\*#•·—–─━│┃┌┐└┘├┤┬┴┼░▒▓█\s]+$/.test(text) && !/(?:\.\s*){4,}|_{4,}/.test(text)) continue;
        if (isOcrCheckboxArtifact(text)) continue;
        if (text.includes("?") && !text.includes(":") && !text.includes("ः") && !text.includes("：")) continue;

        // ── Sub-affordance A: Standalone typed dotted/underscore line with sub-caption directly below (e.g. signature leader) ──
        const isStandaloneRule = /^[_\s.\-…·\u2026]{4,}$/.test(text) && (text.match(/[._…]/g) || []).length >= 4;
        if (isStandaloneRule && line.width >= 40) {
            const subCaptionLine = textLines.find(other => 
                other !== line &&
                other.y > line.y &&
                (other.y - line.y) <= 30 &&
                Math.abs(other.x - line.x) <= 50
            );
            if (subCaptionLine) {
                const subText = subCaptionLine.str.replace(/[()]/g, '').trim();
                if (subText.length >= 2 && !isUniversalStaticText(subText)) {
                    const subSem = resolveSemanticProps(subText);
                    const isSigOrDate = subSem.type === "signature" || subSem.type === "dateField" || subSem.id === "job_title";
                    if (isSigOrDate) {
                        const fieldType = subSem.type === "dateField" ? "dateField" : "signature";
                        const targetW = Math.max(60, Math.min(line.width, fieldType === "signature" ? 200 : 120));
                        const targetH = fieldType === "signature" ? 36 : 22;
                        const targetY = Math.max(0, Math.round(line.y - (fieldType === "signature" ? 28 : 18)));
                        const sigField = {
                            id: generateFieldId(),
                            type: fieldType,
                            name: subSem.name || (fieldType === "signature" ? "signature" : "date"),
                            x: Math.max(10, Math.round(line.x)),
                            y: targetY,
                            width: Math.round(targetW),
                            height: targetH,
                            page: pageNum,
                            borderStyle: "solid",
                            fillStyle: "white",
                            multiline: false,
                            autofill: subSem.autofill || "",
                            dataFormat: fieldType === "dateField" ? "date" : "text",
                            label: subText,
                            labelX: line.x,
                            hasPlaceholder: true,
                            tooltip: subText,
                            detectedBy: "affordance2_colon_prompt",
                            confidence: 0.85
                        };
                        if (!isOverlapping(sigField, fields, 0.20)) {
                            fields.push(sigField);
                        }
                        continue;
                    }
                }
            }
        }

        const promptMatches = [
            ...text.matchAll(/([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s/()[\]'’"«»*.,#$&°º-]*?)(?:[:ः：]|(?=\s*_{2,})|(?=\s*(?:\.\s*){5,}))/gu)
        ].filter(m => m[1].trim().length >= 2)
         .sort((a, b) => a.index - b.index);

        for (let i = 0; i < promptMatches.length; i++) {
            const m = promptMatches[i];
            const cleanLabelRaw = m[1].trim();
            const cleanLabel = cleanOcrWordToken(cleanLabelRaw);
            if (cleanLabel.length < 2) continue;
            if (isUniversalStaticText(cleanLabel)) continue;

            let fullCleanLabel = cleanLabel;
            if (m.index === 0) {
                const lineIdx = textLines.indexOf(line);
                if (lineIdx > 0) {
                    const prevLine = textLines[lineIdx - 1];
                    const vDist = line.y - (prevLine.y + (prevLine.height || 12));
                    const hAlign = Math.abs(prevLine.x - line.x);
                    const prevStr = prevLine.str.trim();
                    if (vDist >= -2 && vDist <= 8 && hAlign <= 18 &&
                        !/[:\?\.!]$/.test(prevStr) &&
                        !isUniversalStaticText(prevStr) &&
                        prevStr.split(/\s+/).length <= 6 &&
                        !prevLine.items?.some(it => /^[(\[]|[☐□▣■◻◼◽◾⬜⬛☑✓✔☒✗✘○●◯◎◦⬤⭕⭘⭙]/.test(it.str))) {
                        fullCleanLabel = `${prevStr} ${cleanLabel}`;
                    }
                }
            }

            // Skip questions, instructional clauses, and long phrases before colons
            const textAfterColon = text.slice(m.index + m[0].length).trim();
            const hasExplicitPlaceholder = /_{2,}|(?:\.\s*){5,}|[\.]{5,}|…{2,}/.test(textAfterColon);
            const labelWithoutParentheticals = fullCleanLabel.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
            const isStandardFormPrompt = /(?:address|name|identification|social\s*security|telephone|residence|applicant|employer|physician|contact|insurance)/i.test(fullCleanLabel);
            const maxLabelLen = (hasExplicitPlaceholder || isStandardFormPrompt) ? 80 : 40;
            const maxLabelWords = (hasExplicitPlaceholder || isStandardFormPrompt) ? 12 : 5;
            if (cleanLabel.includes("?") || labelWithoutParentheticals.length > maxLabelLen || labelWithoutParentheticals.split(/\s+/).length > maxLabelWords) continue;
            if (/^(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should|may|what|where|when|which|why|how|if|please|note|notice|caution|warning|section|part|step|item|for|to|include|includes|including|such|case|report|submit|provide)\b/i.test(cleanLabel)) continue;
            if (/\b(?:include\s+the\s+following|includes?|including|as\s+follows|such\s+as|case\s+if|for\s+example|select\s+one|check\s+only\s+one|choose\s+one)\b/i.test(cleanLabel)) continue;

            // 1. Skip if choices (checkboxes/radios) immediately follow
            if (CHECKBOX_REGEX.test(textAfterColon)) {
                CHECKBOX_REGEX.lastIndex = 0;
                if (/^(?:\[\s*\]|\(\s*\)|[☐□▣■◻◼◽◾⬜⬛☑✓✔☒✗✘○●◯◎◦⬤⭕⭘⭙\uF063\uF0A8\uF0A9\uF0FE\uF06F\uF071\uF073\uF074\uF0A3\uF0B7])/.test(textAfterColon)) {
                    continue;
                }
            }
            if (/select\s*all|select\s*one|bitte\s*ausw[äa]hlen|veuillez\s*s[eé]lectionner|seleccione/i.test(cleanLabel)) continue;

            // 2. Skip if this is already-filled static text (e.g. "REF: FRM-7745", "REVISION: 2.4", "STATUS: BLANK")
            const nextPromptInLine = textAfterColon.search(/[\p{L}\p{M}\p{N}\s/()[\]'’"«»*.,#$&_°º-]+?[:ः：]/u);
            const valueChunk = nextPromptInLine !== -1 ? textAfterColon.slice(0, nextPromptInLine).trim() : textAfterColon;
            const isBlankPlaceholder = /^[\s_.\-…·\u2026\u2022]*$/.test(valueChunk);
            const isAlreadyFilledStatic = valueChunk.length > 0 && !isBlankPlaceholder;
            if (isAlreadyFilledStatic) continue;

            const preSem = resolveSemanticProps(fullCleanLabel);
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

            const placeholderItem = line.items.find(it => /_{2,}|(?:\.\s*){4,}|[\.]{4,}|…{2,}/.test(it.str) && it.x >= promptEndX - 10);
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

            const sem = resolveSemanticProps(fullCleanLabel, isSig ? "signature" : (isDate ? "dateField" : "textField"), usedNames);
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

            const hasTextPlaceholder = /_{2,}|(?:\.\s*){4,}|[\.]{4,}|…{2,}/.test(valueChunk) || Boolean(placeholderItem);

            // In forms where explicit vector inputs or underlines exist, ignore arbitrary text colons in paragraphs/instructions
            // UNLESS there is an explicit visual placeholder (underscores or dots) written by the author
            const hasExplicitVectorElements = (vectorShapes?.inputBoxRects?.length || 0) > 0 || (vectorShapes?.underlines?.length || 0) > 0;
            if (hasExplicitVectorElements && !matchingUnderline && !hasTextPlaceholder) {
                continue;
            }

            // On pages without underlines or placeholders, ONLY recognize standard form semantic keys (multilingual)
            // to suppress section headings and prose titles like "Purpose of Package:", "Exception:", "Important:", "Worksheet:"
            if (!matchingUnderline && !hasTextPlaceholder) {
                const isRecognizedFormKey = Boolean(
                    (preSem.dataFormat && preSem.dataFormat !== "text") ||
                    preSem.autofill ||
                    (preSem.name && !/^(?:field|input|box|text)_\d+$/i.test(preSem.name) && preSem.name !== "field" && preSem.name !== "input") ||
                    /^(?:name|first\s*name|last\s*name|full\s*name|address|street|city|state|zip|postal|phone|telephone|mobile|fax|email|e-mail|date|dob|birth|ssn|ein|tin|tax\s*id|title|signature|sign|amount|total|subtotal|quantity|qty|price|rate|company|employer|organization)$/i.test(fullCleanLabel.replace(/[:_.\s-]+$/, ""))
                );
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
                label: fullCleanLabel,
                labelX: line.x,
                hasPlaceholder: Boolean(hasTextPlaceholder || matchingUnderline),
                tooltip: (fullCleanLabel || fieldName).replace(/[:_—–-]+$/, '').trim(),
                detectedBy: "affordance2_colon_prompt",
                confidence: 0.65
            };

            if (!isOverlapping(newField, fields, 0.20)) {
                fields.push(newField);
            }
        }
    }
}
