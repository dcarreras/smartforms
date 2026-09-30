// js/engines/detection/radio-clustering.js
// Checkbox group clustering into unified mutually-exclusive Radio Button Groups

import { isUniversalStaticText, resolveSemanticProps } from "./semantic-resolver.js";

// Mutually exclusive value tokens
export const MUTUAL_EXCLUSIVE_SETS = [
    new Set(["yes", "no"]),
    new Set(["yes", "no", "maybe"]),
    new Set(["yes", "maybe", "no"]),
    new Set(["yes", "no", "na"]),
    new Set(["yes", "no", "n_a"]),
    new Set(["male", "female"]),
    new Set(["male", "female", "other"]),
    new Set(["male", "female", "other", "prefer_not_to_say"]),
    new Set(["single", "married"]),
    new Set(["single", "married", "divorced", "widowed"]),
    new Set(["single", "married", "married_filing_jointly", "head_of_household"]),
    new Set(["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc", "other"]),
    new Set(["checking", "savings"]),
    new Set(["am", "pm"]),
    new Set(["morning", "afternoon", "evening", "weekend"]),
    new Set(["poor", "fair", "good", "excellent"]),
    new Set(["low", "medium", "high"]),
    new Set(["strongly_agree", "agree", "neutral", "disagree", "strongly_disagree"]),
    new Set(["full_time", "part_time"]),
    new Set(["cash", "check", "credit_card", "debit_card"])
];

/**
 * Cluster adjacent, mutually exclusive checkboxes into unified Radio Button Groups.
 */
export function clusterRadioGroups(fields, rawBlocks = [], usedNames = new Set()) {
    if (!Array.isArray(fields) || fields.length < 2) return fields;

    const checkBoxes = fields.filter(f => f.type === "checkBox" && !f.isComb);
    if (checkBoxes.length < 2) return fields;

    const consumed = new Set();
    const clusters = [];

    // 1. Group by Horizontal Baseline (y within 6pt, gap <= 180pt)
    const sortedByY = [...checkBoxes].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const cb of sortedByY) {
        if (consumed.has(cb)) continue;
        const row = [cb];
        for (const other of sortedByY) {
            if (other === cb || consumed.has(other) || other.page !== cb.page) continue;
            if (Math.abs(other.y - cb.y) <= 6) {
                const last = row[row.length - 1];
                const gap = other.x - (last.x + last.width);
                if (gap >= 6 && gap <= 70) {
                    row.push(other);
                }
            }
        }
        if (row.length >= 2) {
            row.forEach(b => consumed.add(b));
            clusters.push({ orientation: "horizontal", boxes: row });
        }
    }

    // 2. Group by Vertical Column (x within 6pt, vertical gap <= 32pt)
    const sortedByX = [...checkBoxes].filter(cb => !consumed.has(cb)).sort((a, b) => a.x - b.x || a.y - b.y);
    for (const cb of sortedByX) {
        if (consumed.has(cb)) continue;
        const col = [cb];
        for (const other of sortedByX) {
            if (other === cb || consumed.has(other) || other.page !== cb.page) continue;
            if (Math.abs(other.x - cb.x) <= 6) {
                const last = col[col.length - 1];
                const vGap = other.y - (last.y + last.height);
                if (vGap >= 4 && vGap <= 32) {
                    col.push(other);
                }
            }
        }
        if (col.length >= 2) {
            col.forEach(b => consumed.add(b));
            clusters.push({ orientation: "vertical", boxes: col });
        }
    }

    for (const cluster of clusters) {
        const boxes = cluster.boxes;
        const names = boxes.map(b => (b.name || "").toLowerCase().replace(/_\d+$/, ""));

        // Check if names match a known mutually exclusive set
        const matchesKnownSet = MUTUAL_EXCLUSIVE_SETS.some(set => {
            const overlap = names.filter(n => set.has(n));
            return overlap.length >= 2;
        });

        // Search for a group label
        const minX = Math.min(...boxes.map(b => b.x));
        const minY = Math.min(...boxes.map(b => b.y));
        const maxX = Math.max(...boxes.map(b => b.x + b.width));

        const leftGroupLabel = rawBlocks.find(tb => 
            tb.x + tb.width <= minX + 4 && (minX - (tb.x + tb.width)) <= 120 &&
            Math.abs(tb.y - minY) <= 14 && !/^[—–\-:\._\s]+$/.test(tb.str)
        );

        const topGroupLabel = !leftGroupLabel ? rawBlocks.find(tb =>
            tb.y + tb.height <= minY + 4 && (minY - (tb.y + tb.height)) <= 28 &&
            tb.x >= minX - 40 && tb.x <= maxX + 40 && !/^[—–\-:\._\s]+$/.test(tb.str)
        ) : null;

        const groupPrompt = leftGroupLabel || topGroupLabel;
        const promptText = groupPrompt ? groupPrompt.str.trim() : "";

        const isChoicePrompt = /status|gender|sex|type|class|classification|category|method|mode|option|choice|select|check|recommend|rating|satisfaction|preference|frequency|level|tier|pay|terms/i.test(promptText) ||
                               promptText.endsWith(":") || promptText.endsWith("?");

        const isHorizontalOptionCluster = (cluster.orientation === "horizontal" && boxes.length >= 2 && boxes.length <= 6);
        const hasMultiSelectInstruction = /\b(?:all\s+that\s+apply|check\s+all|select\s+all|multiple)\b/i.test(promptText);

        if (matchesKnownSet || isChoicePrompt || (isHorizontalOptionCluster && !hasMultiSelectInstruction)) {
            let baseGroupName = "";
            if (promptText && !isUniversalStaticText(promptText)) {
                baseGroupName = resolveSemanticProps(promptText, "radioGroup", new Set()).name;
            } else if (names.includes("yes") && names.includes("no")) {
                baseGroupName = "yes_no_choice";
            } else if (names.includes("male") && names.includes("female")) {
                baseGroupName = "gender";
            } else if (names.includes("single") && names.includes("married")) {
                baseGroupName = "marital_status";
            } else if (names.includes("individual") || names.includes("c_corp")) {
                baseGroupName = "tax_classification";
            } else if (names.includes("checking") || names.includes("savings")) {
                baseGroupName = "account_type";
            } else {
                baseGroupName = "radio_group";
            }

            let groupName = baseGroupName;
            let counter = 1;
            while (usedNames.has(groupName)) {
                counter++;
                groupName = `${baseGroupName}_${counter}`;
            }
            usedNames.add(groupName);

            boxes.forEach((box, idx) => {
                const optSlug = (box.name || `opt_${idx + 1}`).toLowerCase().replace(/_\d+$/, "");
                box.type = "radioGroup";
                box.radioGroup = groupName;
                box.groupId = groupName;
                box.exportValue = optSlug;
                box.value = box.value || optSlug;
            });
        }
    }

    return fields;
}
