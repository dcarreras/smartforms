// js/engines/detection/visual-affordances/checkbox-glyphs.js
// Checkbox and radio glyph affordance detection

import { generateFieldId } from "../../../core/state.js";
import { isOverlapping } from "../../../utils/geometry.js";
import { isUniversalStaticText, resolveSemanticProps } from "../semantic-resolver.js";
import { DEDUP_THRESHOLDS } from "../config.js";

export const CHECKBOX_CHARS = new Set([
    "☐", "□", "▣", "■", "◻", "◼", "◽", "◾", "⬜", "⬛",
    "☑", "✓", "✔", "☒", "✗", "✘",
    "○", "●", "◯", "◎", "◦", "⬤", "⭕", "⭘", "⭙",
    "", "\uF063", "\uF0A8", "\uF0A9", "\uF0FE", "\uF06F", "\uF071", "\uF073", "\uF074", "\uF0A3", "\uF0B7"
]);

export const CHECKBOX_REGEX = /(\[\s*\]|\(\s*\)|[☐□▣■◻◼◽◾⬜⬛☑✓✔☒✗✘○●◯◎◦⬤⭕⭘⭙\uF063\uF0A8\uF0A9\uF0FE\uF06F\uF071\uF073\uF074\uF0A3\uF0B7])/gu;

export function detectCheckboxGlyphs(textLines, rawBlocks, pageNum, usedNames, fields) {
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

            if (!isOverlapping(newField, fields, DEDUP_THRESHOLDS.COLON_PROMPT)) {
                fields.push(newField);
            }
        }
    }
}
