import { state, getSelectedField, setSelectedField, setSelectedFields, duplicateSelectedFields, createGroupForSelected, ungroupSelected, getRadioGroupName, getRadioGroupFields, selectRadioOption, setRadioGroupMode, toggleCheckboxField, getCheckboxGroupKey, getCheckboxGroupFields, generateFieldId, getVerticallyAlignedColumnSiblings, fillFormulaDownColumn, copyFormulaRecipe, pasteFormulaRecipeToFields, evaluateCalculations, getSampleValueForField } from "../core/state.js";
import { saveHistory } from "../core/storage-manager.js";
import { openSignatureModal } from "./signature-pad.js";
import { toggleListFormat, addRowToTable, removeRowFromTable, addColumnToTable, removeColumnFromTable, deleteTable } from "../engines/text-engine.js";
import { detectInstalledFonts, populateDetectedFontsInSelect, loadCustomFontFile } from "../utils/font-detector.js";
import { Toast } from "../utils/toast.js";

function safeQuerySelectorAll(selector) {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return [];
    return document.querySelectorAll(selector);
}

function updateQuickSizeButtons(size, btnClass = "quick-size-btn") {
    const s = size ? parseInt(size) : null;
    safeQuerySelectorAll(`.${btnClass}`).forEach(btn => {
        const btnSize = parseInt(btn.dataset.size);
        btn.classList.toggle("active", s !== null && btnSize === s);
    });
}

export function makeScrubbableAndScrollable(inputEl, labelEl = null, { min = 1, max = 2000, step = 1, onUpdate } = {}) {
    if (!inputEl) return;

    if (!labelEl) {
        labelEl = inputEl.closest(".prop-field")?.querySelector("label") || inputEl.closest(".form-group")?.querySelector("label") || inputEl.previousElementSibling;
    }

    // 1. Mouse Wheel in Number Input: ONLY active when the input is explicitly focused
    // When unfocused, wheel events pass through cleanly to scroll the inspector sidebar without mutating values.
    inputEl.addEventListener("wheel", e => {
        if (document.activeElement !== inputEl) return;
        e.preventDefault();
        const currentVal = parseFloat(inputEl.value) || min;
        const multiplier = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const dir = e.deltaY < 0 ? 1 : -1;
        const newVal = Math.max(min, Math.min(max, Math.round((currentVal + dir * step * multiplier) * 10) / 10));
        inputEl.value = newVal;
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        if (onUpdate) onUpdate(newVal);
    }, { passive: false });

    // 2. Click & Drag Scrubbing on Label
    if (labelEl) {
        labelEl.classList.add("scrubbable");
        labelEl.title = "Click & drag left/right to scrub value (Shift: 10x, Alt: 0.1x)";

        labelEl.addEventListener("mousedown", e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startVal = parseFloat(inputEl.value) || 0;
            document.body.classList.add("is-scrubbing");

            const labelText = labelEl.textContent.replace(/[↔\s\(px\)pt]/gi, "").trim() || "Value";
            let hud = document.getElementById("vernierHud");
            if (!hud) {
                hud = document.createElement("div");
                hud.id = "vernierHud";
                hud.className = "vernier-hud";
                document.body.appendChild(hud);
            }

            let hasMoved = false;

            const onMouseMove = ev => {
                const deltaX = ev.clientX - startX;
                if (Math.abs(deltaX) > 1) hasMoved = true;
                const multiplier = ev.shiftKey ? 10 : (ev.altKey ? 0.1 : 1);
                const rawVal = startVal + deltaX * (step * 0.5) * multiplier;
                const newVal = Math.max(min, Math.min(max, Math.round(rawVal)));
                inputEl.value = newVal;
                inputEl.dispatchEvent(new Event("input", { bubbles: true }));
                if (onUpdate) onUpdate(newVal);

                const delta = newVal - startVal;
                const deltaSign = delta > 0 ? `+${delta}` : `${delta}`;
                hud.innerHTML = `<span class="vernier-axis">${labelText}:</span> <span class="vernier-val">${newVal}</span> ${delta !== 0 ? `<span class="vernier-delta">(Δ${deltaSign})</span>` : ""}`;
                hud.style.left = `${ev.clientX + 14}px`;
                hud.style.top = `${ev.clientY - 28}px`;
                hud.classList.add("visible");
            };

            const onMouseUp = () => {
                document.body.classList.remove("is-scrubbing");
                if (hud) hud.classList.remove("visible");
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
                if (hasMoved) {
                    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
                }
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        });
    }
}

export function sanitizePdfFieldName(name) {
    if (!name || typeof name !== "string") return "field_1";
    let sanitized = name
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!sanitized) return "field_1";
    if (/^\d/.test(sanitized)) {
        sanitized = `f_${sanitized}`;
    }
    return sanitized;
}

export function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function updateFormulaLivePreview(field) {
    if (typeof document === "undefined") return;
    const previewCard = document.getElementById("calcPreviewCard");
    const previewStatus = document.getElementById("calcPreviewStatus");
    const previewExpr = document.getElementById("calcPreviewExpr");
    const previewVal = document.getElementById("calcPreviewVal");
    if (!previewCard || !previewStatus || !previewExpr || !previewVal) return;

    if (!field || !field.calculationType || field.calculationType === "none") {
        previewCard.style.display = "none";
        return;
    }

    previewCard.style.display = "flex";

    const getSampleVal = (name) => {
        const found = (state.fields || []).find(f => f.name === name || f.id === name);
        if (found) {
            const raw = found.value !== undefined && found.value !== "" ? found.value : found.defaultValue;
            const num = parseFloat(String(raw || "").replace(/[^0-9.-]/g, ""));
            if (!isNaN(num) && num !== 0) return num;
        }
        return 10;
    };

    let evaluatedVal = 0;
    let expressionString = "";
    let isValid = true;
    let errorMessage = "";

    const targets = Array.isArray(field.calculationFields)
        ? field.calculationFields
        : (field.calculationFields ? String(field.calculationFields).split(",").map(s => s.trim()).filter(Boolean) : []);

    if (field.calculationType === "sum") {
        if (targets.length === 0) {
            expressionString = "No fields selected";
            evaluatedVal = 0;
        } else {
            const sampleVals = targets.map(t => getSampleVal(t));
            expressionString = sampleVals.join(" + ");
            evaluatedVal = sampleVals.reduce((a, b) => a + b, 0);
        }
    } else if (field.calculationType === "prod") {
        if (targets.length === 0) {
            expressionString = "No fields selected";
            evaluatedVal = 0;
        } else {
            const sampleVals = targets.map(t => getSampleVal(t));
            expressionString = sampleVals.join(" × ");
            evaluatedVal = sampleVals.reduce((a, b) => a * b, 1);
        }
    } else if (field.calculationType === "tax") {
        const baseName = field.calculationTaxBaseField || targets[0] || "subtotal";
        const rate = parseFloat(field.calculationTaxRate !== undefined ? field.calculationTaxRate : 10);
        const baseVal = getSampleVal(baseName);
        expressionString = `${baseVal} × ${rate}%`;
        evaluatedVal = baseVal * (rate / 100);
    } else if (field.calculationType === "discount") {
        const baseName = field.calculationDiscountBaseField || targets[0] || "subtotal";
        const rate = parseFloat(field.calculationDiscountRate !== undefined ? field.calculationDiscountRate : 10);
        const baseVal = getSampleVal(baseName);
        expressionString = `${baseVal} × ${rate}%`;
        evaluatedVal = baseVal * (rate / 100);
    } else if (field.calculationType === "custom" && field.calculationFormula) {
        const rawFormula = field.calculationFormula.trim();
        if (!rawFormula) {
            expressionString = "Empty formula";
            evaluatedVal = 0;
        } else {
            const tokens = rawFormula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
            const reserved = new Set(["Math", "Number", "parseInt", "parseFloat", "min", "max", "round", "abs", "floor", "ceil", "SUM", "PROD", "true", "false", "null", "undefined"]);
            let substitutedExpr = rawFormula;
            tokens.forEach(tok => {
                if (!reserved.has(tok)) {
                    const sample = getSampleVal(tok);
                    substitutedExpr = substitutedExpr.replace(new RegExp(`\\b${tok}\\b`, "g"), `${sample}`);
                }
            });
            expressionString = substitutedExpr;
            try {
                if (/^[0-9+\-*/().\s]+$/.test(substitutedExpr)) {
                    evaluatedVal = Function(`"use strict"; return (${substitutedExpr})`)();
                    if (!Number.isFinite(evaluatedVal)) {
                        isValid = false;
                        errorMessage = "Division by zero or invalid";
                    }
                } else {
                    isValid = false;
                    errorMessage = "Incomplete expression";
                }
            } catch (err) {
                isValid = false;
                errorMessage = "Incomplete expression";
            }
        }
    } else if (field.calculationType === "custom") {
        expressionString = "Type or insert formula";
        evaluatedVal = 0;
    }

    if (isValid) {
        previewStatus.className = "calc-preview-status status-valid";
        previewStatus.textContent = "✓ Valid";
        previewExpr.textContent = expressionString;
        previewVal.textContent = (Number.isFinite(evaluatedVal) && !Number.isInteger(evaluatedVal)) ? Number(evaluatedVal).toFixed(2) : String(evaluatedVal);
        previewVal.style.display = "inline";
    } else {
        previewStatus.className = "calc-preview-status status-error";
        previewStatus.textContent = `⚠️ ${errorMessage || "Incomplete"}`;
        previewExpr.textContent = expressionString;
        previewVal.style.display = "none";
    }
}

let panelOnFieldUpdated = null;
let lastHandledPickTime = 0;
export let isPickingCalcField = false;

export function syncFieldChange(updater, immediate = false, actionName = null) {
    const field = getSelectedField();
    if (!field) return;
    updater(field);
    try { evaluateCalculations(); } catch(e) {}
    saveHistory(immediate, actionName);
    if (panelOnFieldUpdated) panelOnFieldUpdated(field);
}

export const updateCalcVisibility = (calcType) => {
    const calcFieldsGroup = document.getElementById("calcFieldsGroup");
    const calcTaxGroup = document.getElementById("calcTaxGroup");
    const calcDiscountGroup = document.getElementById("calcDiscountGroup");
    const calcFormulaGroup = document.getElementById("calcFormulaGroup");
    const calcOperatorsGroup = document.getElementById("calcOperatorsGroup");
    const calcFieldChipsGroup = document.getElementById("calcFieldChipsGroup");
    const calcPreviewCard = document.getElementById("calcPreviewCard");
    const calcActionsGroup = document.getElementById("calcActionsGroup");

    if (calcFieldsGroup) calcFieldsGroup.style.display = (calcType === "sum" || calcType === "prod") ? "block" : "none";
    if (calcTaxGroup) calcTaxGroup.style.display = (calcType === "tax") ? "flex" : "none";
    if (calcDiscountGroup) calcDiscountGroup.style.display = (calcType === "discount") ? "flex" : "none";
    if (calcFormulaGroup) calcFormulaGroup.style.display = (calcType === "custom") ? "block" : "none";
    if (calcOperatorsGroup) calcOperatorsGroup.style.display = (calcType === "custom") ? "flex" : "none";
    if (calcFieldChipsGroup) calcFieldChipsGroup.style.display = (calcType !== "none") ? "flex" : "none";
    if (calcPreviewCard) calcPreviewCard.style.display = (calcType !== "none") ? "flex" : "none";
    if (calcActionsGroup) calcActionsGroup.style.display = (calcType !== "none") ? "flex" : "none";
};

export function updateCalcActionsGroup(field) {
    if (typeof document === "undefined") return;
    const calcActionsGroup = document.getElementById("calcActionsGroup");
    const fillDownBtn = document.getElementById("calcFillDownBtn");
    const fillDownBtnText = document.getElementById("calcFillDownBtnText");
    const copyBtn = document.getElementById("calcCopyFormulaBtn");
    const pasteBtn = document.getElementById("calcPasteFormulaBtn");
    if (!calcActionsGroup) return;

    const hasCalc = field && field.calculationType && field.calculationType !== "none";
    calcActionsGroup.style.display = hasCalc ? "flex" : "none";
    if (!hasCalc) return;

    const siblings = getVerticallyAlignedColumnSiblings(field, state.fields || []);
    if (fillDownBtn && fillDownBtnText) {
        if (siblings.length > 0) {
            fillDownBtn.disabled = false;
            fillDownBtnText.textContent = `Fill Down Column (↓ ${siblings.length} ${siblings.length === 1 ? "row" : "rows"})`;
            fillDownBtn.title = `Apply this calculation recipe down to ${siblings.length} vertically aligned row(s) below`;
        } else {
            fillDownBtn.disabled = true;
            fillDownBtnText.textContent = "Fill Down Column (↓ 0 rows)";
            fillDownBtn.title = "No vertically aligned fields found directly below this field in the column";
        }
    }

    if (copyBtn) {
        copyBtn.disabled = false;
    }
    if (pasteBtn) {
        pasteBtn.disabled = !state.formulaClipboard;
    }
}

export const populateBaseFieldOptions = (currentField) => {
    if (!currentField) return;
    const calcTaxBaseField = document.getElementById("calcTaxBaseField");
    const calcDiscountBaseField = document.getElementById("calcDiscountBaseField");
    const otherFields = (state.fields || []).filter(f => f.id !== currentField.id && (f.type === "textField" || f.type === "number" || !f.type));
    const buildOptionsHtml = (selectedVal) => {
        if (otherFields.length === 0) return '<option value="">(No other fields on page)</option>';
        return otherFields.map(f => {
            const name = f.name || f.id;
            const isSel = (selectedVal === name || selectedVal === f.id);
            return `<option value="${escapeHtml(name)}" ${isSel ? "selected" : ""}>${escapeHtml(name)}</option>`;
        }).join("");
    };

    if (calcTaxBaseField) {
        calcTaxBaseField.innerHTML = buildOptionsHtml(currentField.calculationTaxBaseField || otherFields[0]?.name || otherFields[0]?.id || "");
    }
    if (calcDiscountBaseField) {
        calcDiscountBaseField.innerHTML = buildOptionsHtml(currentField.calculationDiscountBaseField || otherFields[0]?.name || otherFields[0]?.id || "");
    }
};

export const renderFormulaFieldChips = (currentField) => {
    const tray = document.getElementById("calcFieldChipsTray");
    const countEl = document.getElementById("calcAvailableFieldsCount");
    if (!tray || !currentField) return;

    tray.innerHTML = "";
    const otherFields = (state.fields || []).filter(f => f.id !== currentField.id && (f.type === "textField" || f.type === "number" || !f.type));
    if (countEl) countEl.textContent = `${otherFields.length} field${otherFields.length === 1 ? "" : "s"}`;

    const currentTargets = Array.isArray(currentField.calculationFields)
        ? currentField.calculationFields
        : (currentField.calculationFields ? String(currentField.calculationFields).split(",").map(s => s.trim()).filter(Boolean) : []);

    otherFields.forEach(f => {
        const fieldName = f.name || f.id;
        const isSelected = currentTargets.includes(fieldName);

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `calc-chip-btn ${isSelected ? "selected" : ""}`;
        chip.innerHTML = `<span class="chip-plus">${isSelected ? "✓" : "+"}</span><span>${escapeHtml(fieldName)}</span>`;
        chip.title = `Insert ${fieldName}`;

        chip.addEventListener("click", e => {
            e.preventDefault();
            handleFieldChipClicked(fieldName);
        });

        tray.appendChild(chip);
    });
};

export const handleFieldChipClicked = (fieldName) => {
    const field = getSelectedField();
    if (!field) return;

    // If calculation type is not set or none, auto-switch to sum so target fields work immediately
    if (!field.calculationType || field.calculationType === "none") {
        field.calculationType = "sum";
        const fieldCalcType = document.getElementById("fieldCalcType");
        if (fieldCalcType) fieldCalcType.value = "sum";
        updateCalcVisibility("sum");
        if (!field.textAlignment || field.textAlignment === "left") {
            field.textAlignment = "right";
            const alignSel = document.getElementById("textAlignment");
            if (alignSel) alignSel.value = "right";
        }
    }

    const fieldCalcTargetFields = document.getElementById("fieldCalcTargetFields");
    const calcTaxBaseField = document.getElementById("calcTaxBaseField");
    const calcDiscountBaseField = document.getElementById("calcDiscountBaseField");

    if (field.calculationType === "sum" || field.calculationType === "prod") {
        let targets = Array.isArray(field.calculationFields)
            ? [...field.calculationFields]
            : (field.calculationFields ? String(field.calculationFields).split(",").map(s => s.trim()).filter(Boolean) : []);
        
        if (targets.includes(fieldName)) {
            targets = targets.filter(t => t !== fieldName);
        } else {
            targets.push(fieldName);
        }
        field.calculationFields = targets;
        if (fieldCalcTargetFields) fieldCalcTargetFields.value = targets.join(", ");
        syncFieldChange(f => f.calculationFields = targets, true, "Update Target Fields");
        renderFormulaFieldChips(field);
        updateFormulaLivePreview(field);
    } else if (field.calculationType === "tax") {
        field.calculationTaxBaseField = fieldName;
        if (calcTaxBaseField) calcTaxBaseField.value = fieldName;
        syncFieldChange(f => f.calculationTaxBaseField = fieldName, true, "Set Base Tax Field");
        renderFormulaFieldChips(field);
        updateFormulaLivePreview(field);
    } else if (field.calculationType === "discount") {
        field.calculationDiscountBaseField = fieldName;
        if (calcDiscountBaseField) calcDiscountBaseField.value = fieldName;
        syncFieldChange(f => f.calculationDiscountBaseField = fieldName, true, "Set Base Discount Field");
        renderFormulaFieldChips(field);
        updateFormulaLivePreview(field);
    } else {
        // Custom Formula
        insertTokenIntoFormula(fieldName);
    }
};

export const insertTokenIntoFormula = (token) => {
    const input = document.getElementById("fieldCalcFormula");
    if (!input) return;
    const start = input.selectionStart !== null ? input.selectionStart : input.value.length;
    const end = input.selectionEnd !== null ? input.selectionEnd : input.value.length;
    const before = input.value.substring(0, start);
    const after = input.value.substring(end);

    const needLeadingSpace = before.length > 0 && !/[\s(+\-*/]$/.test(before) && !/^\s/.test(token);
    const needTrailingSpace = after.length > 0 && !/^[\s)+\-*/]/.test(after) && !/\s$/.test(token);

    const insertion = `${needLeadingSpace ? " " : ""}${token}${needTrailingSpace ? " " : ""}`;
    input.value = before + insertion + after;
    const newPos = start + insertion.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();

    syncFieldChange(f => {
        f.calculationFormula = input.value;
    }, true, "Insert Formula Token");
    updateFormulaLivePreview(getSelectedField());
};

function renderPickerHud(currentField, pickedNames) {
    if (typeof document === "undefined") return;
    const editorScreen = document.getElementById("appEditorScreen");
    const isEditorActive = Boolean(
        document.body?.classList?.contains?.("editor-active") ||
        (editorScreen && editorScreen.style.display !== "none") ||
        (!editorScreen && typeof window === "undefined")
    );
    if (!isEditorActive) {
        const existingHud = document.getElementById("calcPickerHud");
        if (existingHud) existingHud.style.display = "none";
        return;
    }

    let hud = document.getElementById("calcPickerHud");
    if (!hud) {
        hud = document.createElement("div");
        hud.id = "calcPickerHud";
        hud.className = "calc-picker-hud";
        if (editorScreen) {
            editorScreen.appendChild(hud);
        } else {
            document.body?.appendChild?.(hud);
        }
    }
    hud.style.display = "flex";

    const targetName = currentField ? (currentField.name || currentField.id || "Field") : "Field";
    const pickedCount = pickedNames ? pickedNames.size : 0;
    const cType = currentField ? (currentField.calculationType || "sum") : "sum";
    const typeLabel = cType === "sum" ? "Sum Total" : cType === "prod" ? "Product" : cType === "tax" ? "Tax" : cType === "discount" ? "Discount" : "Formula";
    const typeIcon = cType === "sum" ? "∑" : cType === "prod" ? "×" : cType === "tax" ? "%" : cType === "discount" ? "−%" : "ƒx";

    let exprText = "";
    if (cType === "sum") {
        exprText = pickedCount > 0 ? Array.from(pickedNames).join(" + ") : "";
    } else if (cType === "prod") {
        exprText = pickedCount > 0 ? Array.from(pickedNames).join(" × ") : "";
    } else if (cType === "tax") {
        exprText = currentField.calculationTaxBaseField ? `${currentField.calculationTaxRate || 10}% of ${currentField.calculationTaxBaseField}` : "";
    } else if (cType === "discount") {
        exprText = currentField.calculationDiscountBaseField ? `-${currentField.calculationDiscountRate || 10}% of ${currentField.calculationDiscountBaseField}` : "";
    } else {
        exprText = currentField.calculationFormula || "";
    }

    const pickedSummary = pickedCount === 0 && !exprText
        ? `<span class="calc-hud-empty">Click numbers on the form to include</span>`
        : `
            <span class="calc-hud-count">${pickedCount} selected:</span>
            <code class="calc-hud-mono calc-hud-expr-text" title="${escapeHtml(exprText || Array.from(pickedNames).join(', '))}">${escapeHtml(exprText || Array.from(pickedNames).join(', '))}</code>
        `;

    hud.innerHTML = `
        <div class="calc-hud-left">
            <div class="calc-hud-mode">
                <span class="calc-hud-mode-icon" aria-hidden="true">${typeIcon}</span>
                <span>${escapeHtml(typeLabel)}</span>
            </div>
            <span class="calc-hud-divider" aria-hidden="true"></span>
            <div class="calc-hud-target">
                <span class="calc-hud-target-label">Target:</span>
                <code class="calc-hud-mono">${escapeHtml(targetName)}</code>
            </div>
            <span class="calc-hud-divider" aria-hidden="true"></span>
            <div class="calc-hud-selection">
                ${pickedSummary}
            </div>
        </div>
        <div class="calc-hud-actions">
            ${pickedCount > 0 ? `<button type="button" class="calc-hud-btn-clear" id="calcPickerClearBtn">Clear</button>` : ""}
            <button type="button" class="calc-hud-btn-done" id="calcPickerDoneBtn">Done <kbd class="calc-hud-kbd">Esc</kbd></button>
        </div>
    `;

    document.getElementById("calcPickerDoneBtn")?.addEventListener("click", () => setCanvasPickMode(false));
    document.getElementById("calcPickerClearBtn")?.addEventListener("click", () => {
        if (!currentField) return;
        if (currentField.calculationType === "sum" || currentField.calculationType === "prod") {
            currentField.calculationFields = [];
            const input = document.getElementById("fieldCalcTargetFields");
            if (input) input.value = "";
        } else if (currentField.calculationType === "tax") {
            currentField.calculationTaxBaseField = "";
            const sel = document.getElementById("calcTaxBaseField");
            if (sel) sel.value = "";
        } else if (currentField.calculationType === "discount") {
            currentField.calculationDiscountBaseField = "";
            const sel = document.getElementById("calcDiscountBaseField");
            if (sel) sel.value = "";
        } else if (currentField.calculationType === "custom") {
            currentField.calculationFormula = "";
            const input = document.getElementById("fieldCalcFormula");
            if (input) input.value = "";
        }
        syncFieldChange(f => {
            f.calculationFields = currentField.calculationFields;
            f.calculationTaxBaseField = currentField.calculationTaxBaseField;
            f.calculationDiscountBaseField = currentField.calculationDiscountBaseField;
            f.calculationFormula = currentField.calculationFormula;
        }, true, "Clear Calculation Fields");
        renderFormulaFieldChips(currentField);
        updateFormulaLivePreview(currentField);
        updateCanvasPickModeUI();
    });
}

export function isFieldCalculable(f) {
    if (!f) return false;
    // Explicit non-calculable types
    if (f.type === "signature" || f.type === "staticText" || f.type === "checkBox" || f.type === "radioGroup") {
        return false;
    }
    // Dropdowns are categorical text options unless explicitly numeric
    if (f.type === "dropdown" && (!f.dataFormat || f.dataFormat === "text")) {
        return false;
    }
    // Date fields are not arithmetic inputs
    if (f.type === "dateField" || f.dataFormat === "date") {
        return false;
    }
    // Multiline text boxes (notes, terms, bank instructions)
    if (f.multiline) {
        return false;
    }
    // Explicit number types or formats
    if (f.type === "number" || f.dataFormat === "number" || f.dataFormat === "currency" || f.dataFormat === "percent") {
        return true;
    }
    // Already has an active calculation recipe
    if (f.calculationType && f.calculationType !== "none") {
        return true;
    }
    // Value check: if the value or default value is a parseable number (e.g. "40", "150.00", "$6,000.00")
    const rawVal = String(f.value ?? f.defaultValue ?? "").trim().replace(/^[\$€£¥\s]+/, "").replace(/,/g, "");
    if (rawVal !== "" && !isNaN(Number(rawVal)) && isFinite(Number(rawVal))) {
        return true;
    }
    // Semantic name check for common math/numeric terms in form fields
    const nameLower = (f.name || "").toLowerCase();
    if (/(qty|quantity|amount|price|total|subtotal|tax|discount|fee|cost|rate|hours|hrs|units|balance|sum|calc|num|count)/i.test(nameLower)) {
        return true;
    }
    // If it has typical text keywords, treat as non-calculable
    if (/desc|note|comment|address|name|email|phone|street|city|zip|state|company|vendor|client|buyer|seller|title|terms|bank|routing/i.test(nameLower)) {
        return false;
    }
    // Short blank fields could be empty numeric table cells
    return (f.width === undefined || (f.width < 140 && (f.height === undefined || f.height < 36)));
}

export function updateCanvasPickModeUI() {
    if (typeof document === "undefined") return;
    const overlays = safeQuerySelectorAll(".field-overlay");
    if (!isPickingCalcField) {
        overlays.forEach(el => {
            el.classList.remove("calc-target-result-field", "calc-field-picked", "calc-field-candidate", "calc-non-calculable");
            el.querySelectorAll(".calc-corner-badge, .calc-hover-tooltip, .calc-pick-pill").forEach(p => p.remove());
        });
        const hud = document.getElementById("calcPickerHud");
        if (hud) hud.style.display = "none";
        return;
    }

    const currentField = getSelectedField();
    if (!currentField) return;

    // Determine currently picked field names
    const pickedNames = new Set();
    const cType = currentField.calculationType || "sum";
    if (cType === "sum" || cType === "prod") {
        const targets = Array.isArray(currentField.calculationFields)
            ? currentField.calculationFields
            : (currentField.calculationFields ? String(currentField.calculationFields).split(",").map(s => s.trim()).filter(Boolean) : []);
        targets.forEach(t => pickedNames.add(t));
    } else if (cType === "tax" && currentField.calculationTaxBaseField) {
        pickedNames.add(currentField.calculationTaxBaseField);
    } else if (cType === "discount" && currentField.calculationDiscountBaseField) {
        pickedNames.add(currentField.calculationDiscountBaseField);
    } else if (cType === "custom" && currentField.calculationFormula) {
        (state.fields || []).forEach(f => {
            const name = f.name || f.id;
            if (name && currentField.calculationFormula.includes(name)) {
                pickedNames.add(name);
            }
        });
    }

    overlays.forEach(el => {
        el.classList.remove("calc-target-result-field", "calc-field-picked", "calc-field-candidate", "calc-non-calculable");
        el.querySelectorAll(".calc-corner-badge, .calc-hover-tooltip, .calc-pick-pill").forEach(p => p.remove());

        const fieldId = el.id?.replace(/^overlay_/, "") || el.dataset?.id;
        const f = (state.fields || []).find(field => String(field.id) === String(fieldId));
        if (!f) return;

        const fieldName = f.name || f.id;
        const valStr = f.value ? ` <span class="tip-val">(${escapeHtml(String(f.value))})</span>` : "";

        if (f.id === currentField.id) {
            el.classList.add("calc-target-result-field");
            const badge = document.createElement("span");
            badge.className = "calc-corner-badge badge-target";
            badge.innerHTML = `⚡`;
            badge.title = `Result Field: ${fieldName}`;
            el.appendChild(badge);

            const tip = document.createElement("span");
            tip.className = "calc-hover-tooltip tip-target";
            tip.innerHTML = `⚡ Result: <strong>${escapeHtml(fieldName)}</strong>`;
            el.appendChild(tip);
        } else if (pickedNames.has(fieldName)) {
            el.classList.add("calc-field-picked");
            const badge = document.createElement("span");
            badge.className = "calc-corner-badge badge-picked";
            badge.innerHTML = `✓`;
            badge.title = `Included in formula: ${fieldName}`;
            el.appendChild(badge);

            const tip = document.createElement("span");
            tip.className = "calc-hover-tooltip tip-picked";
            tip.innerHTML = `✓ <strong>${escapeHtml(fieldName)}</strong>${valStr} <span class="tip-action">• Click to remove</span>`;
            el.appendChild(tip);
        } else if (!isFieldCalculable(f)) {
            el.classList.add("calc-non-calculable");
        } else {
            el.classList.add("calc-field-candidate");
            const tip = document.createElement("span");
            tip.className = "calc-hover-tooltip tip-candidate";
            tip.innerHTML = `+ <strong>${escapeHtml(fieldName)}</strong>${valStr} <span class="tip-action">• Click to add</span>`;
            el.appendChild(tip);
        }
    });

    renderPickerHud(currentField, pickedNames);
}

export const setCanvasPickMode = (active) => {
    isPickingCalcField = !!active;
    if (typeof document !== "undefined") {
        document.body.classList.toggle("is-picking-calc-field", isPickingCalcField);
        const calcPickFromCanvasBtn = document.getElementById("calcPickFromCanvasBtn");
        const calcFormulaCanvasPickBtn = document.getElementById("calcFormulaCanvasPickBtn");
        calcPickFromCanvasBtn?.classList.toggle("active", isPickingCalcField);
        calcFormulaCanvasPickBtn?.classList.toggle("active", isPickingCalcField);
        updateCanvasPickModeUI();
    }
};

export const handleCanvasFieldPick = e => {
    if (!isPickingCalcField) return;
    const fieldEl = e.target.closest(".field-overlay");
    if (!fieldEl) return;

    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();

    const now = Date.now();
    if (now - lastHandledPickTime < 180) return;
    lastHandledPickTime = now;

    const fieldId = fieldEl.id?.replace(/^overlay_/, "") || fieldEl.dataset?.id;
    const targetField = (state.fields || []).find(f => String(f.id) === String(fieldId));
    const currentField = getSelectedField();

    if (targetField && currentField && targetField.id === currentField.id) {
        // Prevent selecting the formula field itself to avoid circular dependency
        return;
    }

    if (targetField && targetField.type !== "signature" && targetField.type !== "staticText") {
        handleFieldChipClicked(targetField.name || targetField.id);
        updateCanvasPickModeUI();
        fieldEl.classList.remove("just-picked-flash");
        void fieldEl.offsetWidth;
        fieldEl.classList.add("just-picked-flash");
        setTimeout(() => fieldEl.classList.remove("just-picked-flash"), 400);
    }
};

if (typeof window !== "undefined") {
    window.addEventListener("mousedown", handleCanvasFieldPick, true);
    window.addEventListener("pointerdown", handleCanvasFieldPick, true);
    window.addEventListener("click", handleCanvasFieldPick, true);
    window.addEventListener("keydown", e => {
        if (e.key === "Escape" && isPickingCalcField) {
            setCanvasPickMode(false);
        }
    });
}

export function initPropertiesPanel(onFieldUpdated, onFieldDeleted) {
    panelOnFieldUpdated = onFieldUpdated;
    const syncChange = syncFieldChange;

    const fieldNameInput = document.getElementById("fieldName");
    const fieldDefaultVal = document.getElementById("fieldDefaultValue");
    const fieldPlaceholderInput = document.getElementById("fieldPlaceholder");
    const fieldRequired = document.getElementById("fieldRequired");
    const fieldReadOnly = document.getElementById("fieldReadOnly");
    const fieldMultiline = document.getElementById("fieldMultiline");
    const fieldMaxLength = document.getElementById("fieldMaxLength");
    const fieldTooltip = document.getElementById("fieldTooltip");
    const autofillType = document.getElementById("autofillType");
    const fieldFontFamily = document.getElementById("fieldFontFamily");
    const fontSizeInput = document.getElementById("fontSize");
    const textAlignmentSelect = document.getElementById("textAlignment");
    const borderStyleSelect = document.getElementById("fieldBorderStyle") || document.getElementById("borderStyleSelect");
    const fillStyleSelect = document.getElementById("fieldFillStyle") || document.getElementById("fillStyleSelect");
    const posXInput = document.getElementById("posX");
    const posYInput = document.getElementById("posY");
    const widthInput = document.getElementById("width");
    const heightInput = document.getElementById("height");
    const dropdownOptions = document.getElementById("dropdownOptions");
    const fieldDefaultChecked = document.getElementById("fieldDefaultChecked");
    const fieldCheckboxMark = document.getElementById("fieldCheckboxMark");

    // Auto-detect installed system fonts across macOS, Windows, Linux via canvas metrics
    try {
        const detected = detectInstalledFonts();
        if (detected && detected.length > 0 && fieldFontFamily) {
            populateDetectedFontsInSelect(fieldFontFamily, detected);
        }
    } catch (e) {
        console.warn("Could not auto-detect system fonts:", e);
    }

    const fieldTypeSelect = document.getElementById("fieldType");
    fieldTypeSelect?.addEventListener("change", e => {
        const newType = e.target.value;
        const field = getSelectedField();
        if (!field) return;

        field.type = newType;
        if (newType === "signature") {
            field.height = Math.max(field.height, 36);
        } else if (newType === "checkBox" || newType === "radioGroup") {
            if (field.width > 60 || field.height > 60) {
                field.width = 20;
                field.height = 20;
            }
        } else if (newType === "dropdown" && (!field.options || field.options.length === 0)) {
            field.options = ["Option 1", "Option 2", "Option 3"];
        } else if (newType === "staticText") {
            if (!field.defaultValue && !field.label) field.defaultValue = "Heading / Label";
            if (!field.fontSize) field.fontSize = 16;
            field.height = Math.max(field.height, 28);
        }

        saveHistory(true, `Change Field Type to ${newType}`);
        populateProperties(field);
        if (onFieldUpdated) onFieldUpdated(field);
    });

    // ── Data Format & Currency Event Handlers ──
    const fieldDataFormatSelect = document.getElementById("fieldDataFormat");
    const currencySettingsGroup = document.getElementById("currencySettingsGroup");
    const fieldCurrencySymbolSelect = document.getElementById("fieldCurrencySymbol");
    const customCurrencySymbolRow = document.getElementById("customCurrencySymbolRow");
    const fieldCustomCurrencySymbolInput = document.getElementById("fieldCustomCurrencySymbol");
    const fieldCurrencyPositionSelect = document.getElementById("fieldCurrencyPosition");
    const fieldCurrencyDecimalsSelect = document.getElementById("fieldCurrencyDecimals");

    fieldDataFormatSelect?.addEventListener("change", e => {
        const newFormat = e.target.value;
        const field = getSelectedField();
        if (!field) return;

        field.dataFormat = newFormat;
        if (newFormat === "currency") {
            field.currencySymbol = field.currencySymbol || "$";
            field.currencyPosition = field.currencyPosition || (field.currencySymbol === "€" ? "suffix" : "prefix");
            field.currencyDecimals = field.currencyDecimals !== undefined ? field.currencyDecimals : 2;
            if (!field.textAlignment || field.textAlignment === "left") {
                field.textAlignment = "right";
                const ta = document.getElementById("textAlignment");
                if (ta) ta.value = "right";
            }
            if (currencySettingsGroup) currencySettingsGroup.style.display = "block";
        } else {
            if (currencySettingsGroup) currencySettingsGroup.style.display = "none";
            if (newFormat === "number" && (!field.textAlignment || field.textAlignment === "left")) {
                field.textAlignment = "right";
                const ta = document.getElementById("textAlignment");
                if (ta) ta.value = "right";
            }
        }

        saveHistory(true, `Change Data Format to ${newFormat}`);
        populateProperties(field);
        if (onFieldUpdated) onFieldUpdated(field);
    });

    fieldCurrencySymbolSelect?.addEventListener("change", e => {
        const val = e.target.value;
        const field = getSelectedField();
        if (!field) return;

        if (val === "custom") {
            if (customCurrencySymbolRow) customCurrencySymbolRow.style.display = "block";
            if (fieldCustomCurrencySymbolInput) {
                fieldCustomCurrencySymbolInput.value = field.customCurrencySymbol || "";
                fieldCustomCurrencySymbolInput.focus();
            }
        } else {
            if (customCurrencySymbolRow) customCurrencySymbolRow.style.display = "none";
            field.currencySymbol = val;
            if (val === "€" && (!field.currencyPosition || field.currencyPosition === "prefix")) {
                field.currencyPosition = "suffix";
                if (fieldCurrencyPositionSelect) fieldCurrencyPositionSelect.value = "suffix";
            }
            saveHistory(true, `Set Currency Symbol to ${val}`);
            populateProperties(field);
            if (onFieldUpdated) onFieldUpdated(field);
        }
    });

    fieldCustomCurrencySymbolInput?.addEventListener("input", e => {
        const val = e.target.value.trim();
        const field = getSelectedField();
        if (!field) return;
        field.currencySymbol = val || "$";
        field.customCurrencySymbol = val;
        if (onFieldUpdated) onFieldUpdated(field);
    });

    fieldCustomCurrencySymbolInput?.addEventListener("change", e => {
        const val = e.target.value.trim();
        const field = getSelectedField();
        if (!field) return;
        field.currencySymbol = val || "$";
        field.customCurrencySymbol = val;
        saveHistory(true, `Set Custom Currency Symbol to ${val}`);
        if (onFieldUpdated) onFieldUpdated(field);
    });

    fieldCurrencyPositionSelect?.addEventListener("change", e => {
        const val = e.target.value;
        const field = getSelectedField();
        if (!field) return;
        field.currencyPosition = val;
        saveHistory(true, `Set Currency Position to ${val}`);
        populateProperties(field);
        if (onFieldUpdated) onFieldUpdated(field);
    });

    fieldCurrencyDecimalsSelect?.addEventListener("change", e => {
        const val = parseInt(e.target.value);
        const field = getSelectedField();
        if (!field) return;
        field.currencyDecimals = isNaN(val) ? 2 : val;
        saveHistory(true, `Set Currency Decimals to ${val}`);
        populateProperties(field);
        if (onFieldUpdated) onFieldUpdated(field);
    });

    const fieldAutofill = document.getElementById("fieldAutofill");
    fieldAutofill?.addEventListener("change", e => syncChange(f => f.autofill = e.target.value, true, "Set Autofill Token"));

    const updateHeaderFieldName = (val) => {
        const badge = document.getElementById("propFieldTypeBadge");
        if (badge) {
            const displayName = val.trim() || state.selectedField?.autofill || (state.selectedField?.type === "staticText" ? "Heading Text" : state.selectedField?.id) || "Field";
            badge.textContent = displayName;
            badge.title = val.trim();
        }
    };

    fieldNameInput?.addEventListener("input", e => {
        syncChange(f => f.name = e.target.value, false);
        updateHeaderFieldName(e.target.value);
    });
    fieldNameInput?.addEventListener("change", e => {
        const clean = sanitizePdfFieldName(e.target.value);
        e.target.value = clean;
        syncChange(f => f.name = clean, true, "Rename Field");
        updateHeaderFieldName(clean);
    });
    fieldDefaultVal?.addEventListener("input", e => syncChange(f => {
        f.defaultValue = e.target.value;
        f.value = e.target.value;
        if (f.type === "staticText" || f.type === "label") {
            f.label = e.target.value;
        }
    }, false));
    fieldDefaultVal?.addEventListener("change", e => syncChange(f => {
        f.defaultValue = e.target.value;
        f.value = e.target.value;
        if (f.type === "staticText" || f.type === "label") {
            f.label = e.target.value;
        }
    }, true, "Set Default Value"));
    fieldPlaceholderInput?.addEventListener("input", e => syncChange(f => f.placeholder = e.target.value, false));
    fieldPlaceholderInput?.addEventListener("change", e => syncChange(f => f.placeholder = e.target.value, true, "Set Placeholder"));
    fieldFontFamily?.addEventListener("change", async e => {
        const val = e.target.value;
        if (typeof window !== "undefined" && typeof val === "string" && (val.startsWith("local:") || val.startsWith("custom:"))) {
            const fam = val.replace(/^(local|custom):/, "");
            const fontData = window._localFontDataMap?.get(fam);
            if (fontData && typeof fontData.blob === "function") {
                try {
                    const blob = await fontData.blob();
                    const bytes = await blob.arrayBuffer();
                    if (!window._localFontBytesCache) window._localFontBytesCache = new Map();
                    window._localFontBytesCache.set(fam, new Uint8Array(bytes));
                } catch (err) {
                    console.warn("Could not load local font bytes:", err);
                }
            }
        }
        syncChange(f => f.fontFamily = e.target.value, true, "Change Font Family");
    });

    const btnLoadDeviceFonts = document.getElementById("btnLoadDeviceFonts");
    btnLoadDeviceFonts?.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (typeof window !== "undefined" && typeof window.queryLocalFonts === "function") {
            try {
                btnLoadDeviceFonts.disabled = true;
                btnLoadDeviceFonts.innerHTML = `<span>Scanning device fonts...</span>`;

                const fonts = await window.queryLocalFonts();
                if (!window._localFontDataMap) window._localFontDataMap = new Map();
                fonts.forEach(f => {
                    if (f && f.family) window._localFontDataMap.set(f.family, f);
                });
                const uniqueFamilies = Array.from(new Set(fonts.map(f => f.family))).sort();

                if (uniqueFamilies.length > 0 && fieldFontFamily) {
                    let localGroup = document.getElementById("localInstalledFontsGroup");
                    if (!localGroup) {
                        localGroup = document.createElement("optgroup");
                        localGroup.id = "localInstalledFontsGroup";
                        localGroup.label = `Installed on Device (${uniqueFamilies.length})`;
                        fieldFontFamily.appendChild(localGroup);
                    } else {
                        localGroup.innerHTML = "";
                    }

                    uniqueFamilies.forEach(fam => {
                        const opt = document.createElement("option");
                        opt.value = `local:${fam}`;
                        opt.textContent = fam;
                        localGroup.appendChild(opt);
                    });

                    btnLoadDeviceFonts.innerHTML = `<span>✓ ${uniqueFamilies.length} Device Fonts Loaded</span>`;
                    setTimeout(() => {
                        btnLoadDeviceFonts.disabled = false;
                        btnLoadDeviceFonts.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Scan System</span>`;
                    }, 3000);
                } else {
                    btnLoadDeviceFonts.disabled = false;
                    btnLoadDeviceFonts.innerHTML = `<span>No extra fonts found</span>`;
                    setTimeout(() => {
                        btnLoadDeviceFonts.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Scan System</span>`;
                    }, 2500);
                }
            } catch (err) {
                btnLoadDeviceFonts.disabled = false;
                btnLoadDeviceFonts.innerHTML = `<span>Permission denied</span>`;
                setTimeout(() => {
                    btnLoadDeviceFonts.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Scan System</span>`;
                }, 2500);
            }
        } else {
            // Safari / Firefox fallback: Run our canvas detector and explain
            const detected = detectInstalledFonts();
            if (detected.length > 0 && fieldFontFamily) {
                populateDetectedFontsInSelect(fieldFontFamily, detected);
            }
            btnLoadDeviceFonts.innerHTML = `<span>✓ ${detected.length} Detected</span>`;
            if (Toast && typeof Toast.show === "function") {
                Toast.show(`Detected ${detected.length} system fonts! Safari & Firefox block direct disk access — use "+ Add Font" to drop any .ttf / .otf file.`, "info", 5000);
            }
            setTimeout(() => {
                btnLoadDeviceFonts.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Scan System</span>`;
            }, 3000);
        }
    });

    // Custom Font Upload Button & File Input
    const btnUploadCustomFont = document.getElementById("btnUploadCustomFont");
    const customFontFileInput = document.getElementById("customFontFileInput");

    btnUploadCustomFont?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        customFontFileInput?.click();
    });

    customFontFileInput?.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            btnUploadCustomFont.disabled = true;
            btnUploadCustomFont.innerHTML = `<span>Loading...</span>`;
            const fam = await loadCustomFontFile(file, fieldFontFamily);
            syncChange(f => f.fontFamily = `custom:${fam}`, true, `Use Custom Font ${fam}`);
            btnUploadCustomFont.disabled = false;
            btnUploadCustomFont.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>✓ ${fam}</span>`;
            if (Toast && typeof Toast.show === "function") {
                Toast.show(`Loaded font "${fam}"! Embedded and ready for PDF export.`, "success");
            }
            setTimeout(() => {
                btnUploadCustomFont.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>+ Add Font</span>`;
            }, 3000);
        } catch (err) {
            console.error("Font upload error:", err);
            btnUploadCustomFont.disabled = false;
            btnUploadCustomFont.innerHTML = `<span>Error</span>`;
            if (Toast && typeof Toast.show === "function") {
                Toast.show("Could not load font file. Please provide a valid .ttf, .otf, or .woff file.", "error");
            }
            setTimeout(() => {
                btnUploadCustomFont.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>+ Add Font</span>`;
            }, 2500);
        } finally {
            customFontFileInput.value = "";
        }
    });
    
    fontSizeInput?.addEventListener("input", e => {
        const raw = e.target.value.trim();
        const val = raw === "" ? null : parseInt(raw);
        updateQuickSizeButtons(val, "quick-size-btn");
        if (val === null || (val >= 6 && val <= 120)) {
            syncChange(f => f.fontSize = val, false);
        }
    });
    fontSizeInput?.addEventListener("change", e => {
        const raw = e.target.value.trim();
        const val = raw === "" ? null : parseInt(raw);
        if (val === null || (val >= 6 && val <= 120)) {
            syncChange(f => f.fontSize = val, true, "Set Font Size");
        }
    });

    if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
        document.querySelectorAll(".quick-size-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const size = parseInt(btn.dataset.size);
                if (fontSizeInput) fontSizeInput.value = size;
                updateQuickSizeButtons(size, "quick-size-btn");
                syncChange(f => f.fontSize = size, true, `Set Font Size to ${size}pt`);
            });
        });
    }

    // Rich Text Quick Presets
    document.getElementById("textFmtTitle")?.addEventListener("click", () => {
        syncChange(f => {
            f.fontSize = 22;
            f.fontWeight = "bold";
            f.height = Math.max(f.height, 36);
        }, true, "Format as Title");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });
    document.getElementById("textFmtH1")?.addEventListener("click", () => {
        syncChange(f => {
            f.fontSize = 18;
            f.fontWeight = "bold";
            f.height = Math.max(f.height, 30);
        }, true, "Format as H1");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });
    document.getElementById("textFmtH2")?.addEventListener("click", () => {
        syncChange(f => {
            f.fontSize = 14;
            f.fontWeight = "bold";
            f.height = Math.max(f.height, 24);
        }, true, "Format as H2");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });
    document.getElementById("textFmtBody")?.addEventListener("click", () => {
        syncChange(f => {
            f.fontSize = 11;
            f.fontWeight = "normal";
        }, true, "Format as Body");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });
    document.getElementById("textFmtBullets")?.addEventListener("click", () => {
        syncChange(f => {
            const formatted = toggleListFormat(f.defaultValue || f.label || "", "bullet");
            f.defaultValue = formatted;
            f.label = formatted;
            const lines = formatted.split("\n");
            f.height = Math.max(f.height, lines.length * 20);
            f.width = Math.max(f.width, 240);
        }, true, "Toggle Bullet List");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });
    document.getElementById("textFmtNumbers")?.addEventListener("click", () => {
        syncChange(f => {
            const formatted = toggleListFormat(f.defaultValue || f.label || "", "number");
            f.defaultValue = formatted;
            f.label = formatted;
            const lines = formatted.split("\n");
            f.height = Math.max(f.height, lines.length * 20);
            f.width = Math.max(f.width, 240);
        }, true, "Toggle Numbered List");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });

    // Font Weight and Font Style Controls
    const fontStyleSelect = document.getElementById("fontStyleSelect");
    fontStyleSelect?.addEventListener("change", e => {
        const val = e.target.value;
        syncChange(f => {
            if (val === "bold-italic") {
                f.fontWeight = "bold";
                f.fontStyle = "italic";
            } else if (val === "bold") {
                f.fontWeight = "bold";
                f.fontStyle = "normal";
            } else if (val === "italic") {
                f.fontWeight = "normal";
                f.fontStyle = "italic";
            } else {
                f.fontWeight = "normal";
                f.fontStyle = "normal";
            }
        }, true, `Set Font Style to ${val}`);
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });

    const btnToggleBold = document.getElementById("btnToggleBold");
    btnToggleBold?.addEventListener("click", () => {
        const active = getSelectedField();
        const willBeBold = active?.fontWeight !== "bold" && active?.fontWeight !== "700" && active?.fontWeight !== 700;
        syncChange(f => {
            f.fontWeight = willBeBold ? "bold" : "normal";
        }, true, willBeBold ? "Apply Bold Font Weight" : "Remove Bold Font Weight");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });

    const btnToggleItalic = document.getElementById("btnToggleItalic");
    btnToggleItalic?.addEventListener("click", () => {
        const active = getSelectedField();
        const willBeItalic = active?.fontStyle !== "italic";
        syncChange(f => {
            f.fontStyle = willBeItalic ? "italic" : "normal";
        }, true, willBeItalic ? "Apply Italic Font Style" : "Remove Italic Font Style");
        const activeField = getSelectedField();
        if (activeField) populateProperties(activeField);
    });

    // Table Grid Controls
    document.getElementById("tableAddRowBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field?.tableId) {
            const newCells = addRowToTable(field.tableId, state.fields || []);
            if (newCells.length > 0) {
                state.fields.push(...newCells);
                setSelectedFields(newCells.map(c => c.id));
                saveHistory(true, "Add Table Row");
                if (panelOnFieldUpdated) panelOnFieldUpdated();
            }
        }
    });
    document.getElementById("tableDeleteRowBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field?.tableId) {
            const targetRow = field.tableRole === "cell" ? field.tableRow : undefined;
            const tableCells = (state.fields || []).filter(f => f.tableId === field.tableId && f.tableRole === "cell");
            const rowToDelete = targetRow || Math.max(...tableCells.map(f => f.tableRow || 1));
            const { updatedFields } = removeRowFromTable(field.tableId, rowToDelete, state.fields || []);
            state.fields = updatedFields;
            setSelectedField(null);
            saveHistory(true, "Delete Table Row");
            if (panelOnFieldUpdated) panelOnFieldUpdated();
        }
    });
    document.getElementById("tableAddColBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field?.tableId) {
            const newCols = addColumnToTable(field.tableId, state.fields || []);
            if (newCols.length > 0) {
                state.fields.push(...newCols);
                setSelectedFields(newCols.map(c => c.id));
                saveHistory(true, "Add Table Column");
                if (panelOnFieldUpdated) panelOnFieldUpdated();
            }
        }
    });
    document.getElementById("tableDeleteColBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field?.tableId) {
            const targetCol = field.tableCol !== undefined ? field.tableCol : 0;
            const { updatedFields } = removeColumnFromTable(field.tableId, targetCol, state.fields || []);
            state.fields = updatedFields;
            setSelectedField(null);
            saveHistory(true, "Delete Table Column");
            if (panelOnFieldUpdated) panelOnFieldUpdated();
        }
    });
    document.getElementById("tableSelectAllBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field?.tableId) {
            const allInTable = (state.fields || []).filter(f => f.tableId === field.tableId);
            setSelectedFields(allInTable.map(f => f.id));
            if (panelOnFieldUpdated) panelOnFieldUpdated();
        }
    });
    document.getElementById("tableDeleteTableBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field?.tableId) {
            const { updatedFields } = deleteTable(field.tableId, state.fields || []);
            state.fields = updatedFields;
            setSelectedField(null);
            saveHistory(true, "Delete Table");
            if (panelOnFieldUpdated) panelOnFieldUpdated();
        }
    });

    textAlignmentSelect?.addEventListener("change", e => syncChange(f => f.textAlignment = e.target.value, true, "Change Text Alignment"));
    borderStyleSelect?.addEventListener("change", e => syncChange(f => f.borderStyle = e.target.value, true, "Change Border Style"));
    fillStyleSelect?.addEventListener("change", e => syncChange(f => f.fillStyle = e.target.value, true, "Change Fill Style"));
    
    posXInput?.addEventListener("input", e => syncChange(f => f.x = parseFloat(e.target.value) || 0, false));
    posXInput?.addEventListener("change", e => syncChange(f => f.x = parseFloat(e.target.value) || 0, true, "Position X"));
    posYInput?.addEventListener("input", e => syncChange(f => f.y = parseFloat(e.target.value) || 0, false));
    posYInput?.addEventListener("change", e => syncChange(f => f.y = parseFloat(e.target.value) || 0, true, "Position Y"));

    widthInput?.addEventListener("input", e => syncChange(f => f.width = Math.max(16, parseInt(e.target.value) || f.width), false));
    widthInput?.addEventListener("change", e => syncChange(f => f.width = Math.max(16, parseInt(e.target.value) || f.width), true, "Set Width"));
    heightInput?.addEventListener("input", e => syncChange(f => f.height = Math.max(16, parseInt(e.target.value) || f.height), false));
    heightInput?.addEventListener("change", e => syncChange(f => f.height = Math.max(16, parseInt(e.target.value) || f.height), true, "Set Height"));
    fieldRequired?.addEventListener("change", e => syncChange(f => f.required = e.target.checked, true, "Toggle Required"));
    fieldReadOnly?.addEventListener("change", e => syncChange(f => f.readOnly = e.target.checked, true, "Toggle Read Only"));
    fieldMultiline?.addEventListener("change", e => syncChange(f => f.multiline = e.target.checked, true, "Toggle Multiline"));
    
    const fieldIsComb = document.getElementById("fieldIsComb");
    fieldIsComb?.addEventListener("change", e => {
        syncChange(f => {
            f.isComb = e.target.checked;
            if (f.isComb && (!f.maxLength || f.maxLength < 1)) {
                f.maxLength = 10;
                if (fieldMaxLength) fieldMaxLength.value = 10;
            }
        }, true, "Toggle Comb Characters");
    });

    fieldMaxLength?.addEventListener("input", e => syncChange(f => f.maxLength = parseInt(e.target.value) || null, false));
    fieldMaxLength?.addEventListener("change", e => syncChange(f => f.maxLength = parseInt(e.target.value) || null, true, "Set Max Length"));
    fieldTooltip?.addEventListener("input", e => syncChange(f => f.tooltip = e.target.value, false));
    fieldTooltip?.addEventListener("change", e => syncChange(f => f.tooltip = e.target.value, true, "Set Tooltip"));
    autofillType?.addEventListener("change", e => syncChange(f => f.autofill = e.target.value, true, "Set Autofill"));
    fieldDefaultChecked?.addEventListener("change", e => {
        const field = getSelectedField();
        if (field && (field.type === "radioGroup" || field.type === "radio")) {
            if (e.target.checked) {
                selectRadioOption(field, state.fields);
            } else {
                field.defaultChecked = false;
                field.checked = false;
            }
            saveHistory(true, "Toggle Radio Choice");
            populateProperties(field);
            if (panelOnFieldUpdated) panelOnFieldUpdated(field);
            return;
        }
        if (field && field.type === "checkBox") {
            toggleCheckboxField(field, e.target.checked, state.fields);
            saveHistory(true, "Toggle Checked");
            populateProperties(field);
            if (panelOnFieldUpdated) panelOnFieldUpdated(field);
            return;
        }
        syncChange(f => f.defaultChecked = e.target.checked, true, "Toggle Checked");
    });
    fieldCheckboxMark?.addEventListener("change", e => syncChange(f => f.checkboxMark = e.target.value, true, "Set Checkbox Style"));

    // ── Radio Group & Choice Relation Listeners ───────────────────────────
    const fieldRadioGroup = document.getElementById("fieldRadioGroup");
    fieldRadioGroup?.addEventListener("input", e => {
        const clean = sanitizePdfFieldName(e.target.value);
        syncChange(f => {
            f.radioGroup = clean;
            f.name = clean;
        }, false);
    });
    fieldRadioGroup?.addEventListener("change", e => {
        const clean = sanitizePdfFieldName(e.target.value) || "radio_group_1";
        e.target.value = clean;
        syncChange(f => {
            f.radioGroup = clean;
            f.name = clean;
        }, true, "Change Radio Group");
        populateProperties(getSelectedField());
    });

    const fieldRadioExportValue = document.getElementById("fieldRadioExportValue");
    fieldRadioExportValue?.addEventListener("input", e => {
        syncChange(f => {
            f.exportValue = e.target.value;
            f.radioValue = e.target.value;
            f.value = e.target.value;
        }, false);
    });
    fieldRadioExportValue?.addEventListener("change", e => {
        const val = e.target.value.trim() || `Option_${getSelectedField()?.id || 1}`;
        e.target.value = val;
        syncChange(f => {
            f.exportValue = val;
            f.radioValue = val;
            f.value = val;
        }, true, "Change Choice Value");
        populateProperties(getSelectedField());
    });

    const radioGroupSelectMode = document.getElementById("radioGroupSelectMode");
    radioGroupSelectMode?.addEventListener("change", e => {
        const field = getSelectedField();
        if (!field || (field.type !== "radioGroup" && field.type !== "radio")) return;
        setRadioGroupMode(field, e.target.value, state.fields);
        saveHistory(true, `Set Selection Mode: ${e.target.value}`);
        populateProperties(field);
        if (panelOnFieldUpdated) panelOnFieldUpdated(field);
    });

    const addRadioChoiceOptionBtn = document.getElementById("addRadioChoiceOptionBtn");
    addRadioChoiceOptionBtn?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field || (field.type !== "radioGroup" && field.type !== "radio")) return;
        const groupName = getRadioGroupName(field);
        const siblings = getRadioGroupFields(field, state.fields);
        const nextIndex = siblings.length + 1;

        const lastSibling = siblings[siblings.length - 1] || field;
        const newX = lastSibling.x;
        const newY = Math.min((document.getElementById("canvasContainer")?.offsetHeight || 800) - 20, lastSibling.y + lastSibling.height + 14);

        const newChoice = {
            id: generateFieldId(),
            type: "radioGroup",
            radioGroup: groupName,
            name: groupName,
            exportValue: `Option ${nextIndex}`,
            radioValue: `Option ${nextIndex}`,
            value: `Option ${nextIndex}`,
            defaultChecked: false,
            checked: false,
            x: newX,
            y: newY,
            width: field.width || 14,
            height: field.height || 14,
            page: field.page || state.currentPageNum,
            borderStyle: field.borderStyle || "solid",
            fillStyle: field.fillStyle || "white"
        };

        state.fields.push(newChoice);
        setSelectedField(newChoice.id);
        saveHistory(true, `Add Choice to ${groupName}`);
        populateProperties(newChoice);
        if (panelOnFieldUpdated) panelOnFieldUpdated(newChoice);
    });

    // ── Visual Formula & Calculation Builder Listeners ───────────────────────
    const fieldCalcType = document.getElementById("fieldCalcType");
    const fieldCalcTargetFields = document.getElementById("fieldCalcTargetFields");
    const fieldCalcFormula = document.getElementById("fieldCalcFormula");
    const calcTaxBaseField = document.getElementById("calcTaxBaseField");
    const calcTaxRateInput = document.getElementById("calcTaxRateInput");
    const calcDiscountBaseField = document.getElementById("calcDiscountBaseField");
    const calcDiscountRateInput = document.getElementById("calcDiscountRateInput");
    const calcPickFromCanvasBtn = document.getElementById("calcPickFromCanvasBtn");
    const calcFormulaCanvasPickBtn = document.getElementById("calcFormulaCanvasPickBtn");

    calcPickFromCanvasBtn?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field && (!field.calculationType || field.calculationType === "none")) {
            field.calculationType = "sum";
            if (fieldCalcType) fieldCalcType.value = "sum";
            updateCalcVisibility("sum");
            populateBaseFieldOptions(field);
            renderFormulaFieldChips(field);
        }
        setCanvasPickMode(!isPickingCalcField);
    });

    calcFormulaCanvasPickBtn?.addEventListener("click", () => {
        const field = getSelectedField();
        if (field && (!field.calculationType || field.calculationType === "none")) {
            field.calculationType = "custom";
            if (fieldCalcType) fieldCalcType.value = "custom";
            updateCalcVisibility("custom");
            populateBaseFieldOptions(field);
            renderFormulaFieldChips(field);
        }
        setCanvasPickMode(!isPickingCalcField);
    });

    fieldCalcType?.addEventListener("change", e => {
        const val = e.target.value;
        updateCalcVisibility(val);
        const field = getSelectedField();
        if (field) {
            field.calculationType = val;
            if (val === "tax") {
                if (field.calculationTaxRate === undefined) field.calculationTaxRate = 10;
                if (!field.calculationTaxBaseField) {
                    const other = (state.fields || []).find(f => f.id !== field.id);
                    if (other) field.calculationTaxBaseField = other.name || other.id;
                }
            } else if (val === "discount") {
                if (field.calculationDiscountRate === undefined) field.calculationDiscountRate = 10;
                if (!field.calculationDiscountBaseField) {
                    const other = (state.fields || []).find(f => f.id !== field.id);
                    if (other) field.calculationDiscountBaseField = other.name || other.id;
                }
            }
            if (val !== "none" && (!field.textAlignment || field.textAlignment === "left")) {
                field.textAlignment = "right";
                const alignSel = document.getElementById("textAlignment");
                if (alignSel) alignSel.value = "right";
            }
            populateBaseFieldOptions(field);
            renderFormulaFieldChips(field);
            updateFormulaLivePreview(field);
            syncChange(f => {
                f.calculationType = val;
                if (field.textAlignment) f.textAlignment = field.textAlignment;
                if (field.calculationTaxRate !== undefined) f.calculationTaxRate = field.calculationTaxRate;
                if (field.calculationTaxBaseField) f.calculationTaxBaseField = field.calculationTaxBaseField;
                if (field.calculationDiscountRate !== undefined) f.calculationDiscountRate = field.calculationDiscountRate;
                if (field.calculationDiscountBaseField) f.calculationDiscountBaseField = field.calculationDiscountBaseField;
            }, true, "Change Calculation Type");
        }
    });

    fieldCalcTargetFields?.addEventListener("input", e => {
        syncChange(f => {
            f.calculationFields = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
            renderFormulaFieldChips(f);
            updateFormulaLivePreview(f);
        }, false);
    });
    fieldCalcTargetFields?.addEventListener("change", e => {
        syncChange(f => {
            f.calculationFields = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
            renderFormulaFieldChips(f);
            updateFormulaLivePreview(f);
        }, true, "Set Calculation Fields");
    });

    calcTaxBaseField?.addEventListener("change", e => {
        syncChange(f => {
            f.calculationTaxBaseField = e.target.value;
            updateFormulaLivePreview(f);
        }, true, "Set Tax Base Field");
    });
    calcTaxRateInput?.addEventListener("input", e => {
        syncChange(f => {
            f.calculationTaxRate = parseFloat(e.target.value) || 0;
            updateFormulaLivePreview(f);
        }, false);
    });
    calcTaxRateInput?.addEventListener("change", e => {
        syncChange(f => {
            f.calculationTaxRate = parseFloat(e.target.value) || 0;
            updateFormulaLivePreview(f);
        }, true, "Set Tax Rate");
    });

    calcDiscountBaseField?.addEventListener("change", e => {
        syncChange(f => {
            f.calculationDiscountBaseField = e.target.value;
            updateFormulaLivePreview(f);
        }, true, "Set Discount Base Field");
    });
    calcDiscountRateInput?.addEventListener("input", e => {
        syncChange(f => {
            f.calculationDiscountRate = parseFloat(e.target.value) || 0;
            updateFormulaLivePreview(f);
        }, false);
    });
    calcDiscountRateInput?.addEventListener("change", e => {
        syncChange(f => {
            f.calculationDiscountRate = parseFloat(e.target.value) || 0;
            updateFormulaLivePreview(f);
        }, true, "Set Discount Rate");
    });

    fieldCalcFormula?.addEventListener("input", e => {
        syncChange(f => {
            f.calculationFormula = e.target.value;
            updateFormulaLivePreview(f);
        }, false);
    });
    fieldCalcFormula?.addEventListener("change", e => {
        syncChange(f => {
            f.calculationFormula = e.target.value;
            updateFormulaLivePreview(f);
        }, true, "Set Calculation Formula");
    });

    // Operator Buttons
    safeQuerySelectorAll(".calc-op-btn[data-op]").forEach(btn => {
        btn.addEventListener("click", () => {
            const op = btn.dataset.op;
            if (op) insertTokenIntoFormula(op);
        });
    });

    document.getElementById("calcOpBackspace")?.addEventListener("click", () => {
        if (!fieldCalcFormula) return;
        const input = fieldCalcFormula;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        if (start !== end) {
            input.value = input.value.substring(0, start) + input.value.substring(end);
            input.setSelectionRange(start, start);
        } else if (start > 0) {
            input.value = input.value.substring(0, start - 1) + input.value.substring(start);
            input.setSelectionRange(start - 1, start - 1);
        }
        input.focus();
        syncChange(f => f.calculationFormula = input.value, true, "Backspace Formula");
        updateFormulaLivePreview(getSelectedField());
    });

    document.getElementById("calcOpClear")?.addEventListener("click", () => {
        if (!fieldCalcFormula) return;
        fieldCalcFormula.value = "";
        fieldCalcFormula.focus();
        syncChange(f => f.calculationFormula = "", true, "Clear Formula");
        updateFormulaLivePreview(getSelectedField());
    });

    // Fill Down Column Actions
    const calcFillDownBtn = document.getElementById("calcFillDownBtn");
    calcFillDownBtn?.addEventListener("mouseenter", () => {
        const field = getSelectedField();
        if (!field) return;
        const siblings = getVerticallyAlignedColumnSiblings(field, state.fields || []);
        siblings.forEach(s => {
            const ov = document.getElementById(`field-${s.id}`);
            if (ov) ov.classList.add("calc-fill-down-preview");
        });
    });
    calcFillDownBtn?.addEventListener("mouseleave", () => {
        safeQuerySelectorAll(".calc-fill-down-preview").forEach(el => el.classList.remove("calc-fill-down-preview"));
    });
    calcFillDownBtn?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field) return;
        safeQuerySelectorAll(".calc-fill-down-preview").forEach(el => el.classList.remove("calc-fill-down-preview"));
        const siblings = fillFormulaDownColumn(field, state.fields || []);
        if (siblings.length > 0) {
            saveHistory(true, `Fill Formula Down Column (${siblings.length} rows)`);
            if (panelOnFieldUpdated) panelOnFieldUpdated(field);
            populateProperties(field);
        }
    });

    // Copy Formula Recipe
    const calcCopyFormulaBtn = document.getElementById("calcCopyFormulaBtn");
    calcCopyFormulaBtn?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field) return;
        const clip = copyFormulaRecipe(field);
        if (clip) {
            calcCopyFormulaBtn.classList.add("copied-flash");
            const span = calcCopyFormulaBtn.querySelector("span");
            const originalText = span ? span.textContent : "Copy Formula";
            if (span) span.textContent = "Copied!";
            setTimeout(() => {
                calcCopyFormulaBtn.classList.remove("copied-flash");
                if (span) span.textContent = originalText;
            }, 1200);
            const pasteBtn = document.getElementById("calcPasteFormulaBtn");
            if (pasteBtn) pasteBtn.disabled = false;
        }
    });

    // Paste Formula Recipe
    const calcPasteFormulaBtn = document.getElementById("calcPasteFormulaBtn");
    calcPasteFormulaBtn?.addEventListener("click", () => {
        const field = getSelectedField();
        const targetFields = state.selectedFieldIds && state.selectedFieldIds.size > 0
            ? (state.fields || []).filter(f => state.selectedFieldIds.has(f.id))
            : (field ? [field] : []);
        const count = pasteFormulaRecipeToFields(targetFields, state.fields || []);
        if (count > 0) {
            saveHistory(true, `Paste Formula Recipe (${count} fields)`);
            if (panelOnFieldUpdated) panelOnFieldUpdated(field);
            if (field) populateProperties(field);
        }
    });

    // Enable Scrubbing and Scrolling on Number Inputs
    makeScrubbableAndScrollable(posXInput, null, { min: -2000, max: 5000, step: 1 });
    makeScrubbableAndScrollable(posYInput, null, { min: -2000, max: 5000, step: 1 });
    makeScrubbableAndScrollable(widthInput, null, { min: 16, max: 2000, step: 1 });
    makeScrubbableAndScrollable(heightInput, null, { min: 16, max: 1000, step: 1 });
    makeScrubbableAndScrollable(fontSizeInput, null, { min: 6, max: 120, step: 1 });
    makeScrubbableAndScrollable(fieldMaxLength, null, { min: 1, max: 5000, step: 1 });

    // Ensure scrolling the inspector sidebar naturally unfocuses inputs to prevent accidental value mutation
    safeQuerySelectorAll(".prop-panel-body").forEach(panel => {
        panel.addEventListener("scroll", () => {
            if (document.activeElement && document.activeElement.tagName === "INPUT" && panel.contains(document.activeElement)) {
                document.activeElement.blur();
            }
        }, { passive: true });
    });

    const PRESET_OPTIONS = {
        "yes-no": ["Yes", "No"],
        "titles": ["Mr.", "Ms.", "Mrs.", "Dr.", "Prof."],
        "employment": ["Full-Time", "Part-Time", "Contract", "Freelance", "Internship"],
        "priority": ["Low", "Medium", "High", "Critical / Urgent"],
        "months": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
        "ratings": ["1 - Poor", "2 - Fair", "3 - Good", "4 - Very Good", "5 - Excellent"]
    };

    let selectedDropdownChoiceIndex = null;
    let isDropdownBulkEditMode = false;

    function updateDropdownCount(opts) {
        const countEl = document.getElementById("dropdownOptionsCount");
        if (countEl) {
            const count = opts ? opts.length : 0;
            countEl.textContent = `${count} ${count === 1 ? "item" : "items"}`;
        }
    }

    function renderDropdownChoiceList(field) {
        const listEl = document.getElementById("dropdownChoicesList");
        if (!listEl) return;
        const opts = (field && field.options) || [];
        updateDropdownCount(opts);

        if (selectedDropdownChoiceIndex !== null && (selectedDropdownChoiceIndex < 0 || selectedDropdownChoiceIndex >= opts.length)) {
            selectedDropdownChoiceIndex = opts.length > 0 ? Math.max(0, opts.length - 1) : null;
        }

        if (opts.length === 0) {
            listEl.innerHTML = '<div class="dd-choice-empty">No choices added yet. Type above &amp; press Enter.</div>';
        } else {
            listEl.innerHTML = opts.map((opt, idx) => {
                const isSel = idx === selectedDropdownChoiceIndex;
                const isDef = field.defaultValue === opt;
                return `
                    <div class="dd-choice-item ${isSel ? "selected" : ""}" data-idx="${idx}" title="Click to select, double-click to set default">
                        <span class="dd-choice-idx">${idx + 1}</span>
                        <span class="dd-choice-text">${escapeHtml(opt)}</span>
                        ${isDef ? '<span class="dd-choice-default-tag" title="Default Selected Option">Default</span>' : ""}
                        <button type="button" class="dd-choice-del-btn" data-del-idx="${idx}" title="Delete &quot;${escapeHtml(opt)}&quot;" aria-label="Delete option ${escapeHtml(opt)}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                `;
            }).join("");
        }

        const upBtn = document.getElementById("ddMoveUpBtn");
        const downBtn = document.getElementById("ddMoveDownBtn");
        const delBtn = document.getElementById("ddDeleteSelectedBtn");
        if (upBtn) upBtn.disabled = (selectedDropdownChoiceIndex === null || selectedDropdownChoiceIndex <= 0);
        if (downBtn) downBtn.disabled = (selectedDropdownChoiceIndex === null || selectedDropdownChoiceIndex >= opts.length - 1);
        if (delBtn) delBtn.disabled = (selectedDropdownChoiceIndex === null || opts.length === 0);

        if (dropdownOptions) {
            dropdownOptions.value = opts.join("\n");
        }

        if (typeof lucide !== "undefined") lucide.createIcons();
    }

    function addDropdownChoiceFromInput() {
        const input = document.getElementById("newDropdownItemInput");
        if (!input) return;
        const val = input.value.trim();
        if (!val) return;
        const field = getSelectedField();
        if (!field || field.type !== "dropdown") return;
        if (!field.options) field.options = [];
        field.options.push(val);
        if (!field.defaultValue) {
            field.defaultValue = val;
            setVal("fieldDefaultValue", val);
        }
        selectedDropdownChoiceIndex = field.options.length - 1;
        input.value = "";
        renderDropdownChoiceList(field);
        saveHistory();
        if (onFieldUpdated) onFieldUpdated(field);
    }

    document.getElementById("addDropdownItemBtn")?.addEventListener("click", addDropdownChoiceFromInput);
    document.getElementById("newDropdownItemInput")?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            addDropdownChoiceFromInput();
        }
    });

    document.getElementById("dropdownChoicesList")?.addEventListener("click", e => {
        const delBtn = e.target.closest("[data-del-idx]");
        const field = getSelectedField();
        if (!field || field.type !== "dropdown" || !field.options) return;

        if (delBtn) {
            e.stopPropagation();
            const delIdx = parseInt(delBtn.dataset.delIdx, 10);
            if (!isNaN(delIdx) && delIdx >= 0 && delIdx < field.options.length) {
                const deletedVal = field.options[delIdx];
                field.options.splice(delIdx, 1);
                if (field.defaultValue === deletedVal) {
                    field.defaultValue = field.options[0] || "";
                    setVal("fieldDefaultValue", field.defaultValue);
                }
                if (selectedDropdownChoiceIndex !== null) {
                    if (selectedDropdownChoiceIndex === delIdx) {
                        selectedDropdownChoiceIndex = field.options.length > 0 ? Math.min(delIdx, field.options.length - 1) : null;
                    } else if (selectedDropdownChoiceIndex > delIdx) {
                        selectedDropdownChoiceIndex--;
                    }
                }
                renderDropdownChoiceList(field);
                saveHistory();
                if (onFieldUpdated) onFieldUpdated(field);
            }
            return;
        }

        const item = e.target.closest(".dd-choice-item");
        if (item) {
            const idx = parseInt(item.dataset.idx, 10);
            if (!isNaN(idx)) {
                selectedDropdownChoiceIndex = idx;
                renderDropdownChoiceList(field);
            }
        }
    });

    document.getElementById("dropdownChoicesList")?.addEventListener("dblclick", e => {
        const item = e.target.closest(".dd-choice-item");
        const field = getSelectedField();
        if (!item || !field || field.type !== "dropdown" || !field.options) return;
        const idx = parseInt(item.dataset.idx, 10);
        if (!isNaN(idx) && field.options[idx]) {
            field.defaultValue = field.options[idx];
            setVal("fieldDefaultValue", field.defaultValue);
            selectedDropdownChoiceIndex = idx;
            renderDropdownChoiceList(field);
            saveHistory();
            if (onFieldUpdated) onFieldUpdated(field);
        }
    });

    document.getElementById("ddMoveUpBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field || field.type !== "dropdown" || !field.options) return;
        if (selectedDropdownChoiceIndex !== null && selectedDropdownChoiceIndex > 0) {
            const temp = field.options[selectedDropdownChoiceIndex];
            field.options[selectedDropdownChoiceIndex] = field.options[selectedDropdownChoiceIndex - 1];
            field.options[selectedDropdownChoiceIndex - 1] = temp;
            selectedDropdownChoiceIndex--;
            renderDropdownChoiceList(field);
            saveHistory();
            if (onFieldUpdated) onFieldUpdated(field);
        }
    });

    document.getElementById("ddMoveDownBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field || field.type !== "dropdown" || !field.options) return;
        if (selectedDropdownChoiceIndex !== null && selectedDropdownChoiceIndex < field.options.length - 1) {
            const temp = field.options[selectedDropdownChoiceIndex];
            field.options[selectedDropdownChoiceIndex] = field.options[selectedDropdownChoiceIndex + 1];
            field.options[selectedDropdownChoiceIndex + 1] = temp;
            selectedDropdownChoiceIndex++;
            renderDropdownChoiceList(field);
            saveHistory();
            if (onFieldUpdated) onFieldUpdated(field);
        }
    });

    document.getElementById("ddDeleteSelectedBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field || field.type !== "dropdown" || !field.options) return;
        if (selectedDropdownChoiceIndex !== null && selectedDropdownChoiceIndex >= 0 && selectedDropdownChoiceIndex < field.options.length) {
            const deletedVal = field.options[selectedDropdownChoiceIndex];
            field.options.splice(selectedDropdownChoiceIndex, 1);
            if (field.defaultValue === deletedVal) {
                field.defaultValue = field.options[0] || "";
                setVal("fieldDefaultValue", field.defaultValue);
            }
            selectedDropdownChoiceIndex = field.options.length > 0 ? Math.min(selectedDropdownChoiceIndex, field.options.length - 1) : null;
            renderDropdownChoiceList(field);
            saveHistory();
            if (onFieldUpdated) onFieldUpdated(field);
        }
    });

    document.getElementById("toggleDropdownViewModeBtn")?.addEventListener("click", () => {
        isDropdownBulkEditMode = !isDropdownBulkEditMode;
        const choicesContainer = document.getElementById("dropdownChoicesContainer");
        const addRow = document.getElementById("dropdownAddRow");
        const bulkContainer = document.getElementById("dropdownBulkEditContainer");
        const toggleBtn = document.getElementById("toggleDropdownViewModeBtn");

        if (choicesContainer) choicesContainer.style.display = isDropdownBulkEditMode ? "none" : "flex";
        if (addRow) addRow.style.display = isDropdownBulkEditMode ? "none" : "flex";
        if (bulkContainer) bulkContainer.style.display = isDropdownBulkEditMode ? "block" : "none";
        if (toggleBtn) {
            toggleBtn.classList.toggle("active", isDropdownBulkEditMode);
            toggleBtn.title = isDropdownBulkEditMode ? "Switch to interactive choice list" : "Switch to bulk text editor";
        }

        const field = getSelectedField();
        if (field && field.type === "dropdown") {
            if (!isDropdownBulkEditMode && dropdownOptions) {
                field.options = dropdownOptions.value.split("\n").map(s => s.trim()).filter(Boolean);
                renderDropdownChoiceList(field);
            }
        }
    });

    dropdownOptions?.addEventListener("input", e => {
        syncChange(f => {
            f.options = e.target.value.split("\n").map(s => s.trim()).filter(Boolean);
            updateDropdownCount(f.options);
            if (!isDropdownBulkEditMode) {
                renderDropdownChoiceList(f);
            }
        });
    });

    safeQuerySelectorAll(".preset-pill-btn[data-preset]").forEach(btn => {
        btn.addEventListener("click", () => {
            const presetKey = btn.dataset.preset;
            const presetList = PRESET_OPTIONS[presetKey];
            if (!presetList) return;
            const field = getSelectedField();
            if (!field || field.type !== "dropdown") return;
            field.options = [...presetList];
            if (!field.defaultValue || !presetList.includes(field.defaultValue)) {
                field.defaultValue = presetList[0];
            }
            if (dropdownOptions) dropdownOptions.value = presetList.join("\n");
            setVal("fieldDefaultValue", field.defaultValue);
            selectedDropdownChoiceIndex = 0;
            renderDropdownChoiceList(field);
            saveHistory();
            if (onFieldUpdated) onFieldUpdated(field);
        });
    });

    // Signature Action Buttons in properties panel
    document.getElementById("propOpenSignatureBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field || field.type !== "signature") return;
        openSignatureModal(field, () => {
            saveHistory();
            if (onFieldUpdated) onFieldUpdated(field);
        });
    });

    document.getElementById("propClearSignatureBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field || field.type !== "signature") return;
        field.signatureImage = null;
        saveHistory();
        if (onFieldUpdated) onFieldUpdated(field);
    });

    // Duplicate single field
    document.getElementById("duplicateFieldBtn")?.addEventListener("click", () => {
        const dups = duplicateSelectedFields();
        if (dups.length > 0) {
            saveHistory();
            if (onFieldUpdated) onFieldUpdated();
        }
    });

    // Delete single field with poof animation
    document.getElementById("deleteFieldBtn")?.addEventListener("click", async () => {
        const field = getSelectedField();
        if (!field) return;
        const overlay = typeof document !== "undefined" && typeof document.querySelector === "function" ? document.querySelector(`.field-overlay[data-id="${field.id}"]`) : null;
        if (overlay) overlay.classList.add("field-deleting");
        await new Promise(res => setTimeout(res, 120));
        state.fields = state.fields.filter(f => f.id !== field.id);
        setSelectedField(null);
        saveHistory();
        if (onFieldDeleted) onFieldDeleted();
    });

    // Initialize Collapsible Accordions in Properties Panel
    safeQuerySelectorAll(".prop-accordion-header, .prop-section-heading").forEach(header => {
        header.addEventListener("click", () => {
            const acc = header.closest(".prop-accordion, .prop-group");
            if (acc) {
                acc.classList.toggle("collapsed");
                const chevron = header.querySelector(".prop-chevron");
                if (chevron) {
                    chevron.style.transform = acc.classList.contains("collapsed") ? "rotate(-90deg)" : "rotate(0deg)";
                }
            }
        });
    });

    // Multi-select Batch Styling and Alignment Tools
    initMultiSelectTools(onFieldUpdated);

    // Fill Mode Filling Tools in Properties
    initFillToolsEvents(onFieldUpdated);
}

// Lightweight width/height-only sync, used during live drag/resize on the
// canvas (fires at mousemove frequency). Unlike populateProperties(), this
// touches only the two inputs that can actually change mid-drag/resize —
// position (x/y) isn't shown in this panel at all, and everything else
// (badges, signature buttons, typography, dropdown options, checkboxes)
// is unaffected by moving or resizing a field, so re-syncing it on every
// mousemove was pure wasted reflow.
export function syncDimensionInputsLive(field) {
    if (!field) return;
    const widthInput = document.getElementById("width");
    const heightInput = document.getElementById("height");
    if (widthInput && document.activeElement !== widthInput) widthInput.value = field.width || "";
    if (heightInput && document.activeElement !== heightInput) heightInput.value = field.height || "";
}

function getFieldTypeSubtitle(type) {
    const map = {
        textField: "Text field",
        text: "Text field",
        dateField: "Date picker",
        date: "Date picker",
        dropdown: "Dropdown select",
        checkBox: "Checkbox",
        checkbox: "Checkbox",
        radio: "Radio button",
        radioGroup: "Radio group",
        signature: "Signature line",
        numberField: "Number field",
        number: "Number field",
        staticText: "Static text",
        label: "Static text"
    };
    return map[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : "Field");
}

function getFieldTypeIconSvg(type) {
    if (type === "checkBox" || type === "checkbox") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="m9 12 2 2 4-4"></path></svg>';
    }
    if (type === "radio" || type === "radioGroup") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3" fill="currentColor"></circle></svg>';
    }
    if (type === "dropdown") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="m8 10 4 4 4-4"></path></svg>';
    }
    if (type === "dateField" || type === "date") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>';
    }
    if (type === "signature") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 21 3.5-1 12-12-2.5-2.5-12 12L3 21z"></path><path d="m14 8 2.5 2.5"></path></svg>';
    }
    if (type === "numberField" || type === "number") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M8 9h8M8 15h8"></path></svg>';
    }
    if (type === "staticText" || type === "label") {
        return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7V4h16v3M9 20h6M12 4v16"></path></svg>';
    }
    return '<svg class="ico-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="18" height="10" rx="2"></rect><path d="M7 12h4"></path></svg>';
}

export function populateProperties(field) {
    const fallbackField = field || (state.selectedFieldIds.size === 0 ? getSelectedField() : null);

    if (state.editorMode === "fill") {
        renderFillPanel();
        if (!fallbackField && state.selectedFieldIds.size === 0) {
            const inspectorSection = document.getElementById("inspectorPanelSection");
            const fillSection = document.getElementById("fillPanelSection");
            if (inspectorSection) inspectorSection.style.display = "none";
            if (fillSection) fillSection.style.display = "flex";
            return;
        }
        const inspectorSection = document.getElementById("inspectorPanelSection");
        const fillSection = document.getElementById("fillPanelSection");
        const tabInspector = document.getElementById("rightTabInspector");
        const tabFill = document.getElementById("rightTabFill");
        if (inspectorSection && fillSection) {
            inspectorSection.style.display = "flex";
            fillSection.style.display = "none";
            tabInspector?.classList.add("active");
            tabInspector?.setAttribute("aria-selected", "true");
            tabFill?.classList.remove("active");
            tabFill?.setAttribute("aria-selected", "false");
        }
    }

    const emptyPanel = document.getElementById("rightPanelEmpty");
    const singleProps = document.getElementById("fieldProps");
    const multiProps = document.getElementById("multiSelectProps");
    const countBadge = document.getElementById("multiSelectedCountBadge");

    if (state.selectedFieldIds.size > 1) {
        if (emptyPanel) emptyPanel.style.display = "none";
        if (singleProps) singleProps.style.display = "none";
        if (multiProps) {
            multiProps.style.display = "flex";
            if (countBadge) countBadge.textContent = `${state.selectedFieldIds.size} Selected`;
            
            const selectedFields = state.fields.filter(f => state.selectedFieldIds.has(f.id));
            const multiReq = document.getElementById("multiFieldRequired");
            if (multiReq) {
                multiReq.checked = selectedFields.length > 0 && selectedFields.every(f => f.required);
            }

            const multiReadOnly = document.getElementById("multiFieldReadOnly");
            if (multiReadOnly) {
                multiReadOnly.checked = selectedFields.length > 0 && selectedFields.every(f => f.readOnly);
            }

            // Sync text alignment
            const alignInput = document.getElementById("multiTextAlignment");
            if (alignInput && document.activeElement !== alignInput) {
                const commonAlign = selectedFields[0]?.textAlignment;
                const allSameAlign = selectedFields.every(f => f.textAlignment === commonAlign);
                alignInput.value = (allSameAlign && commonAlign) ? commonAlign : "";
                alignInput.classList.toggle("is-mixed", !allSameAlign || !commonAlign);
            }

            // Sync font family input if not actively focused
            const ffInput = document.getElementById("multiFontFamily");
            if (ffInput && document.activeElement !== ffInput) {
                const commonFam = selectedFields[0]?.fontFamily;
                const allSameFam = selectedFields.every(f => f.fontFamily === commonFam);
                ffInput.value = (allSameFam && commonFam) ? commonFam : "";
                ffInput.classList.toggle("is-mixed", !allSameFam || !commonFam);
            }

            // Sync font size input if not actively focused by user
            const fsInput = document.getElementById("multiFontSize");
            if (fsInput && document.activeElement !== fsInput) {
                const firstSize = selectedFields[0]?.fontSize;
                const allHaveSameExplicitSize = selectedFields.every(f => f.fontSize === firstSize);
                if (allHaveSameExplicitSize && firstSize) {
                    fsInput.value = firstSize;
                    fsInput.classList.remove("is-mixed");
                    updateQuickSizeButtons(firstSize, "multi-quick-size-btn");
                } else {
                    fsInput.value = "";
                    fsInput.classList.add("is-mixed");
                    updateQuickSizeButtons(null, "multi-quick-size-btn");
                }
            }

            // Sync font style/weight in multi-selection panel
            const multiStyleInput = document.getElementById("multiFontStyleSelect");
            const multiBtnB = document.getElementById("multiBtnToggleBold");
            const multiBtnI = document.getElementById("multiBtnToggleItalic");
            if (multiStyleInput && document.activeElement !== multiStyleInput) {
                const textFields = selectedFields.filter(f => f.type === "textField" || f.type === "staticText" || f.type === "label" || f.type === "dropdown" || f.type === "dateField" || f.type === "date" || f.type === "number");
                if (textFields.length > 0) {
                    const allBold = textFields.every(f => f.fontWeight === "bold" || f.fontWeight === "700" || f.fontWeight >= 700 || f.fontFamily === "helvetica-bold");
                    const noneBold = textFields.every(f => f.fontWeight !== "bold" && f.fontWeight !== "700" && f.fontWeight !== 700 && f.fontFamily !== "helvetica-bold");
                    const allItalic = textFields.every(f => f.fontStyle === "italic" || f.fontFamily === "times-italic");
                    const noneItalic = textFields.every(f => f.fontStyle !== "italic" && f.fontFamily !== "times-italic");

                    if (multiBtnB && multiBtnB.classList) multiBtnB.classList.toggle("active", allBold);
                    if (multiBtnI && multiBtnI.classList) multiBtnI.classList.toggle("active", allItalic);

                    if (allBold && allItalic) {
                        multiStyleInput.value = "bold-italic";
                        multiStyleInput.classList.remove("is-mixed");
                    } else if (allBold && noneItalic) {
                        multiStyleInput.value = "bold";
                        multiStyleInput.classList.remove("is-mixed");
                    } else if (noneBold && allItalic) {
                        multiStyleInput.value = "italic";
                        multiStyleInput.classList.remove("is-mixed");
                    } else if (noneBold && noneItalic) {
                        multiStyleInput.value = "regular";
                        multiStyleInput.classList.remove("is-mixed");
                    } else {
                        multiStyleInput.value = "";
                        multiStyleInput.classList.add("is-mixed");
                    }
                } else {
                    if (multiBtnB && multiBtnB.classList) multiBtnB.classList.remove("active");
                    if (multiBtnI && multiBtnI.classList) multiBtnI.classList.remove("active");
                    multiStyleInput.value = "";
                    multiStyleInput.classList.remove("is-mixed");
                }
            }

            // Sync width and height inputs if not actively focused
            const wInput = document.getElementById("multiFieldWidth");
            if (wInput && document.activeElement !== wInput) {
                const firstW = selectedFields[0]?.width;
                const allSameW = selectedFields.every(f => f.width === firstW);
                if (allSameW && firstW) {
                    wInput.value = firstW;
                    wInput.classList.remove("is-mixed");
                } else {
                    wInput.value = "";
                    wInput.classList.add("is-mixed");
                }
            }

            const hInput = document.getElementById("multiFieldHeight");
            if (hInput && document.activeElement !== hInput) {
                const firstH = selectedFields[0]?.height;
                const allSameH = selectedFields.every(f => f.height === firstH);
                if (allSameH && firstH) {
                    hInput.value = firstH;
                    hInput.classList.remove("is-mixed");
                } else {
                    hInput.value = "";
                    hInput.classList.add("is-mixed");
                }
            }

            // Sync default value input if not actively focused
            const defInput = document.getElementById("multiDefaultValue");
            if (defInput && document.activeElement !== defInput) {
                const commonVal = selectedFields[0]?.defaultValue;
                const allSameVal = selectedFields.every(f => f.defaultValue === commonVal);
                if (allSameVal && commonVal) {
                    defInput.value = commonVal;
                    defInput.classList.remove("is-mixed");
                } else {
                    defInput.value = "";
                    defInput.classList.toggle("is-mixed", selectedFields.some(f => f.defaultValue));
                }
            }

            // Sync border select
            const borderInput = document.getElementById("multiBorderStyle");
            if (borderInput && document.activeElement !== borderInput) {
                const commonBorder = selectedFields[0]?.borderStyle;
                const allSameBorder = selectedFields.every(f => f.borderStyle === commonBorder);
                borderInput.value = (allSameBorder && commonBorder) ? commonBorder : "";
                borderInput.classList.toggle("is-mixed", !allSameBorder || !commonBorder);
            }

            // Sync fill select
            const fillInput = document.getElementById("multiFillStyle");
            if (fillInput && document.activeElement !== fillInput) {
                const commonFill = selectedFields[0]?.fillStyle;
                const allSameFill = selectedFields.every(f => f.fillStyle === commonFill);
                fillInput.value = (allSameFill && commonFill) ? commonFill : "";
                fillInput.classList.toggle("is-mixed", !allSameFill || !commonFill);
            }

            // Sync Checkbox specific options if selection contains checkboxes
            const multiCheckboxGroup = document.getElementById("multiCheckboxGroup");
            const checkboxFields = selectedFields.filter(f => f.type === "checkBox");
            if (multiCheckboxGroup) {
                multiCheckboxGroup.style.display = checkboxFields.length > 0 ? "flex" : "none";
                if (checkboxFields.length > 0) {
                    const markInput = document.getElementById("multiCheckboxMark");
                    if (markInput && document.activeElement !== markInput) {
                        const firstMark = checkboxFields[0]?.checkboxMark || "check";
                        const allSameMark = checkboxFields.every(f => (f.checkboxMark || "check") === firstMark);
                        markInput.value = allSameMark ? firstMark : "";
                        markInput.classList.toggle("is-mixed", !allSameMark);
                    }

                    const multiDefChecked = document.getElementById("multiFieldDefaultChecked");
                    if (multiDefChecked) {
                        const allChecked = checkboxFields.every(f => !!f.defaultChecked);
                        const allUnchecked = checkboxFields.every(f => !f.defaultChecked);
                        multiDefChecked.checked = allChecked;
                        multiDefChecked.indeterminate = (!allChecked && !allUnchecked);
                    }
                }
            }
        }
        if (typeof lucide !== "undefined") lucide.createIcons();
        return;
    }

    if (!fallbackField) {
        if (emptyPanel) emptyPanel.style.display = "flex";
        if (singleProps) singleProps.style.display = "none";
        if (multiProps) multiProps.style.display = "none";

        const clearText = id => {
            const el = document.getElementById(id);
            if (el && document.activeElement !== el) el.value = "";
        };
        const clearChecked = id => {
            const el = document.getElementById(id);
            if (el) el.checked = false;
        };

        [
            "fieldType", "fieldName", "fieldDefaultValue", "fieldPlaceholder", "fieldFontFamily", "fontSize",
            "textAlignment", "fontStyleSelect", "multiFontStyleSelect", "fieldTooltip", "autofillType", "fieldAutofill",
            "fieldBorderStyle", "borderStyleSelect", "fieldFillStyle", "fillStyleSelect",
            "posX", "posY", "width", "height", "dropdownOptions",
            "fieldDataFormat", "fieldCurrencySymbol", "fieldCustomCurrencySymbol", "fieldCurrencyPosition", "fieldCurrencyDecimals"
        ].forEach(clearText);

        const curGrp = document.getElementById("currencySettingsGroup");
        if (curGrp) curGrp.style.display = "none";
        const customCurRow = document.getElementById("customCurrencySymbolRow");
        if (customCurRow) customCurRow.style.display = "none";

        const accTable = document.getElementById("accTableGrid");
        if (accTable) accTable.style.display = "none";
        const accRadio = document.getElementById("accRadioGroup");
        if (accRadio) accRadio.style.display = "none";
        const accDrop = document.getElementById("accDropdownChoices");
        if (accDrop) accDrop.style.display = "none";
        const accSig = document.getElementById("accSignature");
        if (accSig) accSig.style.display = "none";
        const richGrp = document.getElementById("richTextToolsGroup");
        if (richGrp) richGrp.style.display = "none";

        [
            "fieldRequired", "fieldReadOnly", "fieldMultiline", "fieldDefaultChecked"
        ].forEach(clearChecked);

        safeQuerySelectorAll(".quick-size-btn").forEach(btn => btn.classList.remove("active"));
        safeQuerySelectorAll(".multi-quick-size-btn").forEach(btn => btn.classList.remove("active"));
        safeQuerySelectorAll(".btn-font-format").forEach(btn => btn.classList.remove("active"));
        const confBadge = document.getElementById("propFieldConfidenceBadge");
        if (confBadge) confBadge.style.display = "none";
        return;
    }

    if (emptyPanel) emptyPanel.style.display = "none";
    if (multiProps) multiProps.style.display = "none";
    if (singleProps) singleProps.style.display = "flex";

    const badge = document.getElementById("propFieldTypeBadge");
    const fieldDisplayName = (fallbackField.name && fallbackField.name.trim())
        ? fallbackField.name.trim()
        : (fallbackField.autofill || fallbackField.id || "Field");
    if (badge) {
        badge.textContent = fieldDisplayName;
        badge.title = fallbackField.name || fieldDisplayName;
    }

    const headerTitle = document.getElementById("propFieldHeaderTitle");
    if (headerTitle) {
        headerTitle.textContent = fieldDisplayName;
        headerTitle.title = fieldDisplayName;
    }

    const headerSubtitle = document.getElementById("propFieldHeaderSubtitle");
    if (headerSubtitle) {
        headerSubtitle.textContent = getFieldTypeSubtitle(fallbackField.type);
    }

    const headerIcon = document.getElementById("propFieldHeaderIcon");
    if (headerIcon) {
        headerIcon.innerHTML = getFieldTypeIconSvg(fallbackField.type);
    }

    const confEl = document.getElementById("propFieldConfidenceBadge");
    if (confEl) {
        confEl.style.display = "none";
    }

    const setVal = (id, val) => { 
        const el = document.getElementById(id); 
        if (el && document.activeElement !== el) el.value = val || ""; 
    };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setVal("fieldType", fallbackField.type);
    setVal("fieldName", (fallbackField.type === "radioGroup" || fallbackField.type === "radio") ? getRadioGroupName(fallbackField) : (fallbackField.name || ""));
    setVal("fieldDefaultValue", fallbackField.defaultValue || (fallbackField.type === "staticText" || fallbackField.type === "label" ? fallbackField.label : "") || "");
    setVal("fieldPlaceholder", fallbackField.placeholder || "");
    const targetFont = fallbackField.fontFamily || "helvetica";
    const fontSelectEl = document.getElementById("fieldFontFamily");
    if (fontSelectEl && fontSelectEl.options) {
        let hasOpt = false;
        for (let i = 0; i < fontSelectEl.options.length; i++) {
            if (fontSelectEl.options[i].value === targetFont) {
                hasOpt = true;
                break;
            }
        }
        if (!hasOpt && targetFont && typeof document !== "undefined" && typeof document.createElement === "function") {
            const opt = document.createElement("option");
            opt.value = targetFont;
            const cleanName = targetFont.replace(/^(device|local):/, "");
            opt.textContent = `${cleanName} (Device Font)`;
            if (typeof fontSelectEl.appendChild === "function") {
                fontSelectEl.appendChild(opt);
            }
        }
    }
    setVal("fieldFontFamily", targetFont);
    setVal("fontSize", fallbackField.fontSize || "");
    
    const activeSize = (fallbackField.fontSize && fallbackField.fontSize >= 6) ? fallbackField.fontSize : 11;
    updateQuickSizeButtons(activeSize, "quick-size-btn");

    const isBold = fallbackField.fontWeight === "bold" || fallbackField.fontWeight === "700" || fallbackField.fontWeight >= 700 || fallbackField.fontFamily === "helvetica-bold";
    const isItalic = fallbackField.fontStyle === "italic" || fallbackField.fontFamily === "times-italic";
    let styleVal = "regular";
    if (isBold && isItalic) styleVal = "bold-italic";
    else if (isBold) styleVal = "bold";
    else if (isItalic) styleVal = "italic";
    setVal("fontStyleSelect", styleVal);

    const btnB = document.getElementById("btnToggleBold");
    if (btnB && btnB.classList) btnB.classList.toggle("active", !!isBold);
    const btnI = document.getElementById("btnToggleItalic");
    if (btnI && btnI.classList) btnI.classList.toggle("active", !!isItalic);

    setVal("textAlignment", fallbackField.textAlignment || "left");
    setVal("fieldTooltip", fallbackField.tooltip || "");
    setVal("autofillType", fallbackField.autofill || "");
    setVal("fieldAutofill", fallbackField.autofill || "");
    setVal("fieldBorderStyle", fallbackField.borderStyle || "solid");
    setVal("borderStyleSelect", fallbackField.borderStyle || "solid");
    setVal("fieldFillStyle", fallbackField.fillStyle || "white");
    setVal("fillStyleSelect", fallbackField.fillStyle || "white");
    setVal("posX", Math.round(fallbackField.x ?? 0));
    setVal("posY", Math.round(fallbackField.y ?? 0));
    setVal("width", fallbackField.width || "");
    setVal("height", fallbackField.height || "");
    setChecked("fieldRequired", fallbackField.required);
    setChecked("fieldReadOnly", fallbackField.readOnly);
    setChecked("fieldMultiline", fallbackField.multiline);
    setChecked("fieldIsComb", fallbackField.isComb);
    setVal("fieldMaxLength", fallbackField.maxLength || "");
    setChecked("fieldDefaultChecked", Boolean(fallbackField.defaultChecked || fallbackField.checked));
    setVal("fieldCheckboxMark", fallbackField.checkboxMark || "check");

    // Data Format & Currency Properties
    setVal("fieldDataFormat", fallbackField.dataFormat || (fallbackField.type === "number" ? "number" : "text"));
    const fieldFormatGroup = document.getElementById("fieldFormatGroup");
    if (fieldFormatGroup) {
        fieldFormatGroup.style.display = (fallbackField.type === "textField" || fallbackField.type === "number") ? "block" : "none";
    }

    const currencySettingsGroup = document.getElementById("currencySettingsGroup");
    const customCurrencySymbolRow = document.getElementById("customCurrencySymbolRow");
    if (fallbackField.dataFormat === "currency") {
        if (currencySettingsGroup) currencySettingsGroup.style.display = "block";
        const sym = fallbackField.currencySymbol || "$";
        const known = ["$", "€", "£", "¥", "₹", "CHF", "kr", "R$"];
        if (known.includes(sym)) {
            setVal("fieldCurrencySymbol", sym);
            if (customCurrencySymbolRow) customCurrencySymbolRow.style.display = "none";
        } else {
            setVal("fieldCurrencySymbol", "custom");
            setVal("fieldCustomCurrencySymbol", sym);
            if (customCurrencySymbolRow) customCurrencySymbolRow.style.display = "block";
        }
        setVal("fieldCurrencyPosition", fallbackField.currencyPosition || (sym === "€" ? "suffix" : "prefix"));
        setVal("fieldCurrencyDecimals", String(fallbackField.currencyDecimals !== undefined ? fallbackField.currencyDecimals : 2));
    } else {
        if (currencySettingsGroup) currencySettingsGroup.style.display = "none";
        if (customCurrencySymbolRow) customCurrencySymbolRow.style.display = "none";
    }

    // Calculation properties
    setVal("fieldCalcType", fallbackField.calculationType || "none");
    setVal("fieldCalcTargetFields", Array.isArray(fallbackField.calculationFields) ? fallbackField.calculationFields.join(", ") : (fallbackField.calculationFields || ""));
    setVal("fieldCalcFormula", fallbackField.calculationFormula || "");
    setVal("calcTaxRateInput", fallbackField.calculationTaxRate !== undefined ? fallbackField.calculationTaxRate : 10);
    setVal("calcDiscountRateInput", fallbackField.calculationDiscountRate !== undefined ? fallbackField.calculationDiscountRate : 10);

    // Calculation drawer and groups visibility
    const accCalculation = document.getElementById("accCalculation");
    const calcFieldsGroup = document.getElementById("calcFieldsGroup");
    const calcTaxGroup = document.getElementById("calcTaxGroup");
    const calcDiscountGroup = document.getElementById("calcDiscountGroup");
    const calcFormulaGroup = document.getElementById("calcFormulaGroup");
    const calcOperatorsGroup = document.getElementById("calcOperatorsGroup");
    const calcFieldChipsGroup = document.getElementById("calcFieldChipsGroup");
    const calcPreviewCard = document.getElementById("calcPreviewCard");
    const calcType = fallbackField.calculationType || "none";

    if (accCalculation) {
        accCalculation.style.display = (fallbackField.type === "textField" || fallbackField.type === "number") ? "block" : "none";
    }
    if (calcFieldsGroup) {
        calcFieldsGroup.style.display = (calcType === "sum" || calcType === "prod") ? "block" : "none";
    }
    if (calcTaxGroup) {
        calcTaxGroup.style.display = (calcType === "tax") ? "flex" : "none";
    }
    if (calcDiscountGroup) {
        calcDiscountGroup.style.display = (calcType === "discount") ? "flex" : "none";
    }
    if (calcFormulaGroup) {
        calcFormulaGroup.style.display = (calcType === "custom") ? "block" : "none";
    }
    if (calcOperatorsGroup) {
        calcOperatorsGroup.style.display = (calcType === "custom") ? "flex" : "none";
    }
    if (calcFieldChipsGroup) {
        calcFieldChipsGroup.style.display = (calcType !== "none") ? "flex" : "none";
    }
    if (calcPreviewCard) {
        calcPreviewCard.style.display = (calcType !== "none") ? "flex" : "none";
    }

    // Populate base field selectors, dynamic chips, and live preview
    populateBaseFieldOptions(fallbackField);
    renderFormulaFieldChips(fallbackField);
    updateFormulaLivePreview(fallbackField);
    updateCalcActionsGroup(fallbackField);

    // Signature controls visibility
    const accSignature = document.getElementById("accSignature");
    const sigGroup = document.getElementById("signatureActionsGroup");
    const propClearSig = document.getElementById("propClearSignatureBtn");
    const propOpenSigSpan = document.querySelector("#propOpenSignatureBtn span");
    if (accSignature) {
        accSignature.style.display = fallbackField.type === "signature" ? "block" : "none";
    }
    if (sigGroup) {
        sigGroup.style.display = fallbackField.type === "signature" ? "block" : "none";
        if (fallbackField.type === "signature") {
            if (propClearSig) propClearSig.style.display = fallbackField.signatureImage ? "block" : "none";
            if (propOpenSigSpan) propOpenSigSpan.textContent = fallbackField.signatureImage ? "Redraw / Retype Signature" : "Pre-sign Document";
        }
    }

    // ── Field-Type Specific Visibility in General & Inspector ──
    const isTextLike = (fallbackField.type === "textField" || fallbackField.type === "number" || fallbackField.type === "dateField");
    const isStatic = (fallbackField.type === "staticText" || fallbackField.type === "label");
    const isCheck = (fallbackField.type === "checkBox");
    const isRadio = (fallbackField.type === "radioGroup" || fallbackField.type === "radio");
    const isSig = (fallbackField.type === "signature");
    const isDrop = (fallbackField.type === "dropdown");

    // 1. Field Name Group (hidden for static text which is an un-named layout element)
    const fieldNameGroup = document.getElementById("fieldNameGroup");
    if (fieldNameGroup) {
        fieldNameGroup.style.display = isStatic ? "none" : "block";
    }

    // 2. Placeholder & Default Value in General
    const defValGroup = document.getElementById("defaultValueGroup");
    const placeholderContainer = document.getElementById("fieldPlaceholderContainer");
    const defaultValueGrid = document.getElementById("defaultValueGrid");
    const defValLabel = document.querySelector('label[for="fieldDefaultValue"]');
    const defValInput = document.getElementById("fieldDefaultValue");

    if (defValGroup) {
        if (isCheck || isRadio || isSig) {
            // Checkboxes, radios, and signatures have no textual placeholder or default string
            defValGroup.style.display = "none";
        } else if (isStatic) {
            // Static text: full-width text content editor, hide placeholder
            defValGroup.style.display = "block";
            if (placeholderContainer) placeholderContainer.style.display = "none";
            if (defaultValueGrid) defaultValueGrid.style.gridTemplateColumns = "1fr";
            if (defValLabel) defValLabel.textContent = "Text Content";
            if (defValInput) defValInput.placeholder = "Enter heading or label text...";
        } else if (isDrop) {
            // Dropdown: show default selected choice, full width, hide placeholder
            defValGroup.style.display = "block";
            if (placeholderContainer) placeholderContainer.style.display = "none";
            if (defaultValueGrid) defaultValueGrid.style.gridTemplateColumns = "1fr";
            if (defValLabel) defValLabel.textContent = "Default Selected Choice";
            if (defValInput) defValInput.placeholder = "Pre-selected choice";
        } else {
            // Text, Number, Date: show both Placeholder and Default value
            defValGroup.style.display = "block";
            if (placeholderContainer) placeholderContainer.style.display = "block";
            if (defaultValueGrid) defaultValueGrid.style.gridTemplateColumns = "1fr 1fr";
            if (defValLabel) defValLabel.textContent = "Default value";
            if (defValInput) defValInput.placeholder = "Pre-filled";
        }
    }

    // 3. Rich Text & Table Controls
    const richTextGroup = document.getElementById("richTextToolsGroup");
    if (richTextGroup) {
        richTextGroup.style.display = isStatic ? "block" : "none";
    }

    const accTableGrid = document.getElementById("accTableGrid");
    const tableGroup = document.getElementById("tableGridControlsGroup");
    const isTable = Boolean(fallbackField.tableId);
    if (accTableGrid) {
        accTableGrid.style.display = isTable ? "block" : "none";
    }
    if (tableGroup) {
        tableGroup.style.display = isTable ? "grid" : "none";
        if (isTable) {
            const locBadge = document.getElementById("tableCellLocationBadge");
            if (locBadge) {
                if (fallbackField.tableRole === "header") {
                    locBadge.textContent = `Header Col ${(fallbackField.tableCol || 0) + 1}`;
                } else {
                    locBadge.textContent = `Row ${fallbackField.tableRow || 1}, Col ${(fallbackField.tableCol || 0) + 1}`;
                }
            }
        }
    }

    // 4. Radio & Dropdown
    const accRadioGroup = document.getElementById("accRadioGroup");
    const radioSettingsGroup = document.getElementById("radioGroupSettingsGroup");
    if (accRadioGroup) {
        accRadioGroup.style.display = isRadio ? "block" : "none";
    }
    if (radioSettingsGroup) {
        radioSettingsGroup.style.display = isRadio ? "block" : "none";
        if (isRadio) {
            const grpName = getRadioGroupName(fallbackField);
            setVal("fieldRadioGroup", grpName);
            setVal("fieldRadioExportValue", fallbackField.exportValue || fallbackField.radioValue || fallbackField.value || "");
            const choiceCount = document.getElementById("radioGroupChoiceCount");
            const siblings = getRadioGroupFields(fallbackField, state.fields);
            if (choiceCount) choiceCount.textContent = `${siblings.length} choice${siblings.length !== 1 ? "s" : ""}`;
            const isMulti = siblings.some(s => s.radioGroupMulti === true);
            setVal("radioGroupSelectMode", isMulti ? "multi" : "single");

            // Populate interactive sibling choices list
            const radioPillsList = document.getElementById("radioSiblingChoicesList");
            if (radioPillsList) {
                radioPillsList.innerHTML = siblings.map(s => {
                    const isCurrent = s.id === fallbackField.id;
                    const val = s.exportValue || s.radioValue || s.value || s.name || "Choice";
                    return `<button type="button" class="radio-choice-pill ${isCurrent ? 'active' : ''}" data-field-id="${s.id}" title="${isCurrent ? 'Current selection' : 'Select ' + escapeHtml(val)}">
                        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isCurrent ? '#2f5bea' : '#8a909c'};"></span>
                        <span>${escapeHtml(val)}</span>
                    </button>`;
                }).join("");

                radioPillsList.querySelectorAll(".radio-choice-pill").forEach(pill => {
                    pill.addEventListener("click", () => {
                        const fId = pill.dataset.fieldId;
                        if (fId && fId !== fallbackField.id) {
                            setSelectedField(fId);
                            const target = state.fields.find(f => f.id === fId);
                            if (target) {
                                populateProperties(target);
                                if (panelOnFieldUpdated) panelOnFieldUpdated(target);
                            }
                        }
                    });
                });
            }
        }
    }

    const accDropdownChoices = document.getElementById("accDropdownChoices");
    const ddGroup = document.getElementById("dropdownOptionsGroup");
    if (accDropdownChoices) {
        accDropdownChoices.style.display = isDrop ? "block" : "none";
    }
    if (ddGroup) {
        ddGroup.style.display = isDrop ? "block" : "none";
        if (isDrop) {
            renderDropdownChoiceList(fallbackField);
        }
    }

    // 5. Behavior Section & Chips
    const accBehavior = document.getElementById("accBehavior");
    if (accBehavior) {
        accBehavior.style.display = isStatic ? "none" : "block";
    }

    const multilineGroup = document.getElementById("multilineGroup");
    if (multilineGroup) {
        multilineGroup.style.display = (fallbackField.type === "textField") ? "flex" : "none";
    }

    const combGroup = document.getElementById("combGroup");
    if (combGroup) {
        combGroup.style.display = (fallbackField.type === "textField" || fallbackField.type === "dateField" || fallbackField.type === "number") ? "flex" : "none";
    }

    const checkGroup = document.getElementById("defaultCheckedGroup");
    if (checkGroup) {
        checkGroup.style.display = (isCheck || isRadio) ? "flex" : "none";
    }

    const checkboxMarkGroup = document.getElementById("checkboxMarkGroup");
    if (checkboxMarkGroup) {
        checkboxMarkGroup.style.display = isCheck ? "flex" : "none";
    }

    // 6. Typography Accordion
    const accTypography = document.getElementById("accTypography");
    if (accTypography) {
        accTypography.style.display = (fallbackField.type === "textField" || fallbackField.type === "dropdown" || fallbackField.type === "dateField" || fallbackField.type === "staticText" || fallbackField.type === "label") ? "block" : "none";
    }

    // 7. Advanced Options (Autofill, Tooltip, Max Length)
    const autofillRoleGroup = document.getElementById("autofillRoleGroup");
    if (autofillRoleGroup) {
        autofillRoleGroup.style.display = isTextLike ? "block" : "none";
    }

    const maxLengthGroup = document.getElementById("maxLengthGroup");
    if (maxLengthGroup) {
        maxLengthGroup.style.display = isTextLike ? "block" : "none";
    }

    const accValidation = document.getElementById("accValidation");
    if (accValidation) {
        accValidation.style.display = isStatic ? "none" : "block";
    }

    populateFillTools(fallbackField);

    if (typeof lucide !== "undefined") lucide.createIcons();
}

function initMultiSelectTools(onUpdated) {
    const getSelected = () => state.fields.filter(f => state.selectedFieldIds.has(f.id));
    const batchUpdate = (mutator, immediate = false) => {
        const sel = getSelected();
        if (sel.length === 0) return;
        sel.forEach(mutator);
        saveHistory(immediate);
        if (onUpdated) onUpdated();
    };

    // ── Batch Field Type Conversion ──────────────────────────────────
    const convertBatchType = (newType) => {
        if (!newType) return;
        const sel = getSelected();
        if (sel.length === 0) return;

        sel.forEach(f => {
            f.type = newType;
            if (newType === "signature") {
                f.height = Math.max(f.height, 44);
                f.width = Math.max(f.width, 140);
            } else if (newType === "checkBox" || newType === "radioGroup") {
                f.width = 16;
                f.height = 16;
            } else if (newType === "dateField") {
                if (!f.defaultValue) f.defaultValue = "YYYY-MM-DD";
                f.height = Math.max(f.height, 22);
            } else if (newType === "textField") {
                f.height = Math.max(f.height, 22);
                if (f.defaultValue === "YYYY-MM-DD") f.defaultValue = "";
            } else if (newType === "staticText") {
                if (!f.defaultValue) f.defaultValue = "Heading / Label";
                if (!f.fontSize) f.fontSize = 16;
                f.height = Math.max(f.height, 28);
            } else if (newType === "dropdown") {
                if (!f.options || f.options.length === 0) {
                    f.options = ["Option 1", "Option 2", "Option 3"];
                }
            }
        });

        saveHistory(true);
        if (onUpdated) onUpdated();
    };

    const multiTypeSelect = document.getElementById("multiFieldType");
    if (multiTypeSelect) {
        multiTypeSelect.addEventListener("change", e => {
            convertBatchType(e.target.value);
            e.target.value = "";
        });
    }

    safeQuerySelectorAll(".multi-type-quick-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetType = btn.dataset.type;
            if (targetType) convertBatchType(targetType);
        });
    });

    // ── Field Dimensions & Sizing (Batch Sizing) ─────────────────────
    const multiWInput = document.getElementById("multiFieldWidth");
    if (multiWInput) {
        multiWInput.addEventListener("input", e => {
            multiWInput.classList.remove("is-mixed");
            const raw = e.target.value.trim();
            const val = raw === "" ? null : parseInt(raw);
            if (val !== null && val >= 16 && val <= 2000) {
                batchUpdate(f => f.width = val, false);
            }
        });
        multiWInput.addEventListener("change", e => {
            const raw = e.target.value.trim();
            const val = raw === "" ? null : parseInt(raw);
            if (val !== null && val >= 16 && val <= 2000) {
                batchUpdate(f => f.width = val, true);
            }
        });
        makeScrubbableAndScrollable(multiWInput, null, { min: 16, max: 2000, step: 2 });
    }

    const multiHInput = document.getElementById("multiFieldHeight");
    if (multiHInput) {
        multiHInput.addEventListener("input", e => {
            multiHInput.classList.remove("is-mixed");
            const raw = e.target.value.trim();
            const val = raw === "" ? null : parseInt(raw);
            if (val !== null && val >= 16 && val <= 1000) {
                batchUpdate(f => f.height = val, false);
            }
        });
        multiHInput.addEventListener("change", e => {
            const raw = e.target.value.trim();
            const val = raw === "" ? null : parseInt(raw);
            if (val !== null && val >= 16 && val <= 1000) {
                batchUpdate(f => f.height = val, true);
            }
        });
        makeScrubbableAndScrollable(multiHInput, null, { min: 16, max: 1000, step: 1 });
    }

    // Match Width (Equalize Width)
    document.getElementById("multiMatchWidthBtn")?.addEventListener("click", () => {
        const sel = getSelected();
        if (sel.length < 2) return;
        const primary = (state.lastSelectedFieldId && sel.find(f => f.id === state.lastSelectedFieldId)) || sel[0];
        if (!primary) return;
        const targetW = primary.width;
        if (multiWInput) {
            multiWInput.value = targetW;
            multiWInput.classList.remove("is-mixed");
        }
        batchUpdate(f => f.width = targetW);
    });

    // Match Height (Equalize Height)
    document.getElementById("multiMatchHeightBtn")?.addEventListener("click", () => {
        const sel = getSelected();
        if (sel.length < 2) return;
        const primary = (state.lastSelectedFieldId && sel.find(f => f.id === state.lastSelectedFieldId)) || sel[0];
        if (!primary) return;
        const targetH = primary.height;
        if (multiHInput) {
            multiHInput.value = targetH;
            multiHInput.classList.remove("is-mixed");
        }
        batchUpdate(f => f.height = targetH);
    });

    // Match Both (Equalize Width & Height)
    document.getElementById("multiMatchBothBtn")?.addEventListener("click", () => {
        const sel = getSelected();
        if (sel.length < 2) return;
        const primary = (state.lastSelectedFieldId && sel.find(f => f.id === state.lastSelectedFieldId)) || sel[0];
        if (!primary) return;
        const targetW = primary.width;
        const targetH = primary.height;
        if (multiWInput) {
            multiWInput.value = targetW;
            multiWInput.classList.remove("is-mixed");
        }
        if (multiHInput) {
            multiHInput.value = targetH;
            multiHInput.classList.remove("is-mixed");
        }
        batchUpdate(f => {
            f.width = targetW;
            f.height = targetH;
        });
    });

    // Preset Height Buttons
    safeQuerySelectorAll(".multi-quick-height-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const h = parseInt(btn.dataset.height);
            if (multiHInput) multiHInput.value = h;
            batchUpdate(f => f.height = h);
        });
    });

    // ── Batch Border & Fill Style Dropdowns ───────────────────────────
    const multiBorderInput = document.getElementById("multiBorderStyle");
    multiBorderInput?.addEventListener("change", e => {
        multiBorderInput.classList.remove("is-mixed");
        const val = e.target.value;
        if (val) {
            batchUpdate(f => f.borderStyle = val, true);
        }
    });

    const multiFillInput = document.getElementById("multiFillStyle");
    multiFillInput?.addEventListener("change", e => {
        multiFillInput.classList.remove("is-mixed");
        const val = e.target.value;
        if (val) {
            batchUpdate(f => f.fillStyle = val, true);
        }
    });

    // ── Batch Text, Typography & Alignment ───────────────────────────
    document.getElementById("multiDefaultValue")?.addEventListener("input", e => {
        e.target.classList.remove("is-mixed");
        const val = e.target.value;
        batchUpdate(f => {
            f.defaultValue = val;
            if (f.type === "staticText" || f.type === "label") {
                f.label = val;
            }
        });
    });

    const isTextCapableField = f => (f.type === "textField" || f.type === "staticText" || f.type === "label" || f.type === "dropdown" || f.type === "dateField" || f.type === "date" || f.type === "number");

    document.getElementById("multiFontFamily")?.addEventListener("change", e => {
        e.target.classList.remove("is-mixed");
        const val = e.target.value;
        if (val) {
            batchUpdate(f => {
                if (isTextCapableField(f)) {
                    f.fontFamily = val;
                }
            });
        }
    });

    document.getElementById("multiFontSize")?.addEventListener("input", e => {
        e.target.classList.remove("is-mixed");
        const raw = e.target.value.trim();
        const val = raw === "" ? null : parseInt(raw);
        updateQuickSizeButtons(val, "multi-quick-size-btn");
        if (val === null || (val >= 6 && val <= 120)) {
            batchUpdate(f => {
                if (isTextCapableField(f)) {
                    f.fontSize = val;
                }
            });
        }
    });

    const multiFsInput = document.getElementById("multiFontSize");
    if (multiFsInput) {
        makeScrubbableAndScrollable(multiFsInput, null, { min: 6, max: 120, step: 1 });
    }

    safeQuerySelectorAll(".multi-quick-size-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const size = parseInt(btn.dataset.size);
            const fsInput = document.getElementById("multiFontSize");
            if (fsInput) {
                fsInput.value = size;
                fsInput.classList.remove("is-mixed");
            }
            updateQuickSizeButtons(size, "multi-quick-size-btn");
            batchUpdate(f => {
                if (isTextCapableField(f)) {
                    f.fontSize = size;
                }
            });
        });
    });

    document.getElementById("multiTextAlignment")?.addEventListener("change", e => {
        e.target.classList.remove("is-mixed");
        const val = e.target.value;
        if (val) {
            batchUpdate(f => {
                if (isTextCapableField(f)) {
                    f.textAlignment = val;
                }
            });
        }
    });

    document.getElementById("multiFontStyleSelect")?.addEventListener("change", e => {
        e.target.classList.remove("is-mixed");
        const val = e.target.value;
        if (val) {
            batchUpdate(f => {
                if (isTextCapableField(f)) {
                    if (val === "bold-italic") {
                        f.fontWeight = "bold";
                        f.fontStyle = "italic";
                    } else if (val === "bold") {
                        f.fontWeight = "bold";
                        f.fontStyle = "normal";
                    } else if (val === "italic") {
                        f.fontWeight = "normal";
                        f.fontStyle = "italic";
                    } else {
                        f.fontWeight = "normal";
                        f.fontStyle = "normal";
                    }
                }
            });
        }
    });

    document.getElementById("multiBtnToggleBold")?.addEventListener("click", () => {
        const textFields = selectedFields.filter(isTextCapableField);
        const anyNonBold = textFields.some(f => f.fontWeight !== "bold" && f.fontWeight !== "700" && f.fontWeight !== 700 && f.fontFamily !== "helvetica-bold");
        batchUpdate(f => {
            if (isTextCapableField(f)) {
                f.fontWeight = anyNonBold ? "bold" : "normal";
            }
        });
    });

    document.getElementById("multiBtnToggleItalic")?.addEventListener("click", () => {
        const textFields = selectedFields.filter(isTextCapableField);
        const anyNonItalic = textFields.some(f => f.fontStyle !== "italic" && f.fontFamily !== "times-italic");
        batchUpdate(f => {
            if (isTextCapableField(f)) {
                f.fontStyle = anyNonItalic ? "italic" : "normal";
            }
        });
    });

    // ── Batch Required Toggle ────────────────────────────────────────
    document.getElementById("multiFieldRequired")?.addEventListener("change", e => {
        const req = e.target.checked;
        batchUpdate(f => f.required = req);
    });

    // ── Batch Read-Only Toggle ───────────────────────────────────────
    document.getElementById("multiFieldReadOnly")?.addEventListener("change", e => {
        const ro = e.target.checked;
        batchUpdate(f => f.readOnly = ro);
    });

    // ── Batch Checkbox Options (Mark Style & Checked State) ──────────
    const multiMarkSelect = document.getElementById("multiCheckboxMark");
    multiMarkSelect?.addEventListener("change", e => {
        multiMarkSelect.classList.remove("is-mixed");
        const val = e.target.value;
        if (val) {
            batchUpdate(f => {
                if (f.type === "checkBox") f.checkboxMark = val;
            }, true);
        }
    });

    safeQuerySelectorAll(".multi-mark-quick-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const mark = btn.dataset.mark;
            if (mark) {
                if (multiMarkSelect) {
                    multiMarkSelect.value = mark;
                    multiMarkSelect.classList.remove("is-mixed");
                }
                batchUpdate(f => {
                    if (f.type === "checkBox") f.checkboxMark = mark;
                }, true);
            }
        });
    });

    document.getElementById("multiFieldDefaultChecked")?.addEventListener("change", e => {
        const chk = e.target.checked;
        batchUpdate(f => {
            if (f.type === "checkBox" || f.type === "radioGroup") f.defaultChecked = chk;
        }, true);
    });

    // ── Alignment Tools ──────────────────────────────────────────────
    document.getElementById("alignLeftBtn")?.addEventListener("click", () => alignSelectedFields("left", onUpdated));
    document.getElementById("alignCenterBtn")?.addEventListener("click", () => alignSelectedFields("center", onUpdated));
    document.getElementById("alignRightBtn")?.addEventListener("click", () => alignSelectedFields("right", onUpdated));
    document.getElementById("alignTopBtn")?.addEventListener("click", () => alignSelectedFields("top", onUpdated));
    document.getElementById("alignMiddleBtn")?.addEventListener("click", () => alignSelectedFields("middle", onUpdated));
    document.getElementById("alignBottomBtn")?.addEventListener("click", () => alignSelectedFields("bottom", onUpdated));

    // ── Spacing Distribution Tools (Even Spacing) ────────────────────
    document.getElementById("distributeVerticalBtn")?.addEventListener("click", () => distributeSelectedFields("vertical", onUpdated));
    document.getElementById("distributeHorizontalBtn")?.addEventListener("click", () => distributeSelectedFields("horizontal", onUpdated));

    // ── Duplicate All Selected ───────────────────────────────────────
    document.getElementById("multiDuplicateBtn")?.addEventListener("click", () => {
        const dups = duplicateSelectedFields();
        if (dups.length > 0) {
            saveHistory();
            if (onUpdated) onUpdated();
        }
    });

    // ── Group Selected Fields ─────────────────────────────────────────
    document.getElementById("multiGroupBtn")?.addEventListener("click", () => {
        const grp = createGroupForSelected();
        if (grp) {
            saveHistory();
            if (onUpdated) onUpdated();
        }
    });

    // ── Ungroup Selected Fields ───────────────────────────────────────
    document.getElementById("multiUngroupBtn")?.addEventListener("click", () => {
        ungroupSelected();
        saveHistory();
        if (onUpdated) onUpdated();
    });

    // ── Delete All Selected ──────────────────────────────────────────
    document.getElementById("deleteMultiBtn")?.addEventListener("click", () => {
        state.fields = state.fields.filter(f => !state.selectedFieldIds.has(f.id));
        state.selectedFieldIds.clear();
        state.selectedFieldId = null;
        saveHistory();
        if (onUpdated) onUpdated();
    });
}

export function alignSelectedFields(direction, onUpdated) {
    const sel = state.fields.filter(f => state.selectedFieldIds.has(f.id));
    if (sel.length < 2) return;
    if (direction === "left") {
        const minX = Math.min(...sel.map(f => f.x));
        sel.forEach(f => f.x = minX);
    } else if (direction === "center") {
        const avgCenter = sel.reduce((sum, f) => sum + (f.x + f.width / 2), 0) / sel.length;
        sel.forEach(f => f.x = Math.round(avgCenter - f.width / 2));
    } else if (direction === "right") {
        const maxRight = Math.max(...sel.map(f => f.x + f.width));
        sel.forEach(f => f.x = maxRight - f.width);
    } else if (direction === "top") {
        const minY = Math.min(...sel.map(f => f.y));
        sel.forEach(f => f.y = minY);
    } else if (direction === "middle") {
        const avgMiddle = sel.reduce((sum, f) => sum + (f.y + f.height / 2), 0) / sel.length;
        sel.forEach(f => f.y = Math.round(avgMiddle - f.height / 2));
    } else if (direction === "bottom") {
        const maxBottom = Math.max(...sel.map(f => f.y + f.height));
        sel.forEach(f => f.y = maxBottom - f.height);
    }
    saveHistory();
    if (onUpdated) onUpdated();
}

export function distributeSelectedFields(axis, onUpdated) {
    const sel = state.fields.filter(f => state.selectedFieldIds.has(f.id));
    if (sel.length < 3) return;
    if (axis === "vertical") {
        sel.sort((a, b) => a.y - b.y);
        const first = sel[0];
        const last = sel[sel.length - 1];
        const totalSpan = (last.y + last.height) - first.y;
        const totalItemsHeight = sel.reduce((sum, f) => sum + f.height, 0);
        const totalGap = totalSpan - totalItemsHeight;
        const gap = totalGap / (sel.length - 1);
        
        let currentY = first.y;
        for (let i = 0; i < sel.length; i++) {
            if (i > 0) {
                currentY += sel[i - 1].height + gap;
                sel[i].y = Math.round(currentY);
            }
        }
    } else if (axis === "horizontal") {
        sel.sort((a, b) => a.x - b.x);
        const first = sel[0];
        const last = sel[sel.length - 1];
        const totalSpan = (last.x + last.width) - first.x;
        const totalItemsWidth = sel.reduce((sum, f) => sum + f.width, 0);
        const totalGap = totalSpan - totalItemsWidth;
        const gap = totalGap / (sel.length - 1);
        
        let currentX = first.x;
        for (let i = 0; i < sel.length; i++) {
            if (i > 0) {
                currentX += sel[i - 1].width + gap;
                sel[i].x = Math.round(currentX);
            }
        }
    }
    saveHistory();
    if (onUpdated) onUpdated();
}

// ── Fill Mode Filling Tools in Properties Panel ────────────────────
export function populateFillTools(field) {
    if (!field || typeof document === "undefined") return;
    const accFill = document.getElementById("accFillTools");
    if (!accFill) return;

    const isFillMode = (state.editorMode === "fill") || (typeof document !== "undefined" && document.body?.classList.contains("mode-fill"));
    if (!isFillMode || field.type === "staticText" || field.type === "label") {
        accFill.style.display = "none";
        return;
    }
    accFill.style.display = "block";

    // In fill mode, ensure accFillTools is expanded
    accFill.classList.remove("collapsed");
    const chevron = accFill.querySelector(".prop-chevron");
    if (chevron) chevron.style.transform = "rotate(0deg)";

    const textRow = document.getElementById("propFillTextInputRow");
    const textareaRow = document.getElementById("propFillTextareaRow");
    const dateRow = document.getElementById("propFillDateRow");
    const checkboxRow = document.getElementById("propFillCheckboxRow");
    const radioRow = document.getElementById("propFillRadioRow");
    const dropdownRow = document.getElementById("propFillDropdownRow");
    const sigRow = document.getElementById("propFillSignatureRow");

    const textInput = document.getElementById("propFillValueInput");
    const textareaInput = document.getElementById("propFillValueTextarea");
    const dateInput = document.getElementById("propFillValueDate");
    const checkboxToggle = document.getElementById("propFillCheckboxToggle");
    const checkboxStatus = document.getElementById("propFillCheckboxStatus");
    const radioOptionsList = document.getElementById("propFillRadioOptionsList");
    const dropdownSelect = document.getElementById("propFillDropdownSelect");

    if (textRow) textRow.style.display = "none";
    if (textareaRow) textareaRow.style.display = "none";
    if (dateRow) dateRow.style.display = "none";
    if (checkboxRow) checkboxRow.style.display = "none";
    if (radioRow) radioRow.style.display = "none";
    if (dropdownRow) dropdownRow.style.display = "none";
    if (sigRow) sigRow.style.display = "none";

    const currentVal = field.value !== undefined && field.value !== null ? field.value : (field.defaultValue || "");

    if (field.type === "checkBox") {
        if (checkboxRow) checkboxRow.style.display = "flex";
        const isChecked = !!field.value || !!field.defaultChecked;
        if (checkboxToggle) checkboxToggle.checked = isChecked;
        if (checkboxStatus) {
            checkboxStatus.textContent = isChecked ? "Checked (✓)" : "Unchecked";
            checkboxStatus.style.color = isChecked ? "#16a34a" : "#5b6270";
        }
    } else if (field.type === "radioGroup" || field.type === "radio") {
        if (radioRow) radioRow.style.display = "flex";
        if (radioOptionsList) {
            radioOptionsList.innerHTML = "";
            const options = Array.isArray(field.options) && field.options.length > 0 
                ? field.options 
                : [{ label: "Choice 1", value: "choice_1" }, { label: "Choice 2", value: "choice_2" }];
            options.forEach(opt => {
                const optVal = typeof opt === "object" ? (opt.value || opt.label) : opt;
                const optLabel = typeof opt === "object" ? (opt.label || opt.value) : opt;
                const isSelected = String(currentVal) === String(optVal);

                const pill = document.createElement("div");
                pill.className = "prop-fill-radio-pill" + (isSelected ? " selected" : "");
                pill.innerHTML = `
                    <input type="radio" name="prop_fill_radio_group" value="${escapeHtml(optVal)}" ${isSelected ? 'checked' : ''} style="margin: 0; accent-color: #2f5bea; pointer-events: none;">
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(optLabel)}</span>
                `;
                pill.addEventListener("click", () => {
                    field.value = optVal;
                    if (typeof selectRadioOption === "function") {
                        try { selectRadioOption(field, optVal); } catch(e) {}
                    }
                    saveHistory(true);
                    if (panelOnFieldUpdated) panelOnFieldUpdated(field);
                    populateFillTools(field);
                    renderFillPanel();
                });
                radioOptionsList.appendChild(pill);
            });
        }
    } else if (field.type === "dropdown") {
        if (dropdownRow) dropdownRow.style.display = "block";
        if (dropdownSelect) {
            dropdownSelect.innerHTML = "";
            const opts = Array.isArray(field.options) && field.options.length > 0 ? field.options : ["Option 1", "Option 2"];
            const placeholderOpt = document.createElement("option");
            placeholderOpt.value = "";
            placeholderOpt.textContent = "— Select an option —";
            dropdownSelect.appendChild(placeholderOpt);

            opts.forEach(opt => {
                const optEl = document.createElement("option");
                optEl.value = opt;
                optEl.textContent = opt;
                if (String(opt) === String(currentVal)) {
                    optEl.selected = true;
                }
                dropdownSelect.appendChild(optEl);
            });
        }
    } else if (field.type === "signature") {
        if (sigRow) sigRow.style.display = "flex";
        const sigImg = document.getElementById("propFillSigImg");
        const emptyPrompt = document.getElementById("propFillSigEmptyPrompt");
        if (field.signatureImage) {
            if (sigImg) {
                sigImg.src = field.signatureImage;
                sigImg.style.display = "block";
            }
            if (emptyPrompt) emptyPrompt.style.display = "none";
        } else {
            if (sigImg) {
                sigImg.src = "";
                sigImg.style.display = "none";
            }
            if (emptyPrompt) emptyPrompt.style.display = "block";
        }
    } else if (field.type === "dateField" || field.dataFormat === "date") {
        if (dateRow) dateRow.style.display = "flex";
        if (dateInput && document.activeElement !== dateInput) {
            dateInput.value = currentVal;
        }
    } else if (field.multiline) {
        if (textareaRow) textareaRow.style.display = "block";
        if (textareaInput && document.activeElement !== textareaInput) {
            textareaInput.value = currentVal;
        }
    } else {
        if (textRow) textRow.style.display = "flex";
        if (textInput && document.activeElement !== textInput) {
            textInput.value = currentVal;
        }
    }

    // Calculation Result Card
    const calcCard = document.getElementById("propFillCalcCard");
    const calcFormulaText = document.getElementById("propFillCalcFormulaText");
    const calcResultVal = document.getElementById("propFillCalcResultVal");
    if (calcCard) {
        if (field.calcRecipe && field.calcRecipe.type && field.calcRecipe.type !== "none") {
            calcCard.style.display = "block";
            if (calcFormulaText) {
                calcFormulaText.textContent = `fx ${field.calcRecipe.type}: [${(field.calcRecipe.fields || []).join(", ")}]`;
            }
            if (calcResultVal) {
                calcResultVal.textContent = String(field.value || field.defaultValue || "$0.00");
            }
        } else {
            calcCard.style.display = "none";
        }
    }

    // Validation & Requirement Status
    let isFilled = false;
    if (field.type === "checkBox") {
        isFilled = !!field.value || !!field.defaultChecked;
    } else if (field.type === "signature") {
        isFilled = !!field.signatureImage || !!field.value;
    } else {
        isFilled = String(currentVal).trim().length > 0;
    }

    const isReq = !!field.required;
    const badge = document.getElementById("propFillStatusBadge");
    const valDot = document.getElementById("propFillValidationDot");
    const valText = document.getElementById("propFillValidationText");
    const reqBadge = document.getElementById("propFillReqBadge");

    if (badge) {
        badge.className = "prop-meta-badge " + (isFilled ? "fill-status-filled" : (isReq ? "fill-status-required-missing" : "fill-status-empty"));
        badge.textContent = isFilled ? "Filled ✓" : (isReq ? "Required ⚠️" : "Empty");
    }

    if (valDot) {
        valDot.style.background = isFilled ? "#16a34a" : (isReq ? "#dc2626" : "#94a3b8");
    }

    if (valText) {
        if (isFilled) {
            valText.textContent = isReq ? "Required — validly filled ✓" : "Filled with value ✓";
            valText.style.color = "#15803d";
        } else if (isReq) {
            valText.textContent = "Required field — not yet filled";
            valText.style.color = "#dc2626";
        } else {
            valText.textContent = "Optional field (empty)";
            valText.style.color = "#5b6270";
        }
    }

    if (reqBadge) {
        reqBadge.style.display = isReq ? "inline-block" : "none";
        reqBadge.style.background = isFilled ? "#dcfce7" : "#fee2e2";
        reqBadge.style.color = isFilled ? "#15803d" : "#dc2626";
    }

    // Step Navigation (Prev / Next Field Counter)
    const interactiveFields = (state.fields || []).filter(f => f.type !== "staticText" && f.type !== "label" && !f.hidden);
    const currentIndex = interactiveFields.findIndex(f => f.id === field.id);
    const counterEl = document.getElementById("propFillNavCounter");
    const prevBtn = document.getElementById("propFillPrevBtn");
    const nextBtn = document.getElementById("propFillNextBtn");

    if (counterEl) {
        counterEl.textContent = currentIndex >= 0 ? `Field ${currentIndex + 1} of ${interactiveFields.length}` : `${interactiveFields.length} Fields`;
    }
    if (prevBtn) {
        prevBtn.disabled = currentIndex <= 0;
        prevBtn.style.opacity = currentIndex <= 0 ? "0.4" : "1";
    }
    if (nextBtn) {
        nextBtn.disabled = currentIndex < 0 || currentIndex >= interactiveFields.length - 1;
        nextBtn.style.opacity = (currentIndex < 0 || currentIndex >= interactiveFields.length - 1) ? "0.4" : "1";
    }
}

export function initFillToolsEvents(onFieldUpdated) {
    if (typeof document === "undefined") return;

    const commitVal = (val) => {
        const field = getSelectedField();
        if (!field) return;
        field.value = val;
        try { evaluateCalculations(); } catch(e) {}
        saveHistory(true);
        if (onFieldUpdated) onFieldUpdated(field);
        populateFillTools(field);
        renderFillPanel();
    };

    const textInput = document.getElementById("propFillValueInput");
    textInput?.addEventListener("input", (e) => commitVal(e.target.value));

    const textareaInput = document.getElementById("propFillValueTextarea");
    textareaInput?.addEventListener("input", (e) => commitVal(e.target.value));

    const dateInput = document.getElementById("propFillValueDate");
    dateInput?.addEventListener("input", (e) => commitVal(e.target.value));

    document.getElementById("propFillTodayBtn")?.addEventListener("click", () => {
        const todayStr = new Date().toISOString().split("T")[0];
        if (dateInput) dateInput.value = todayStr;
        commitVal(todayStr);
    });

    const checkboxToggle = document.getElementById("propFillCheckboxToggle");
    checkboxToggle?.addEventListener("change", (e) => {
        const field = getSelectedField();
        if (!field) return;
        field.value = e.target.checked;
        field.defaultChecked = e.target.checked;
        try { evaluateCalculations(); } catch(e) {}
        saveHistory(true);
        if (onFieldUpdated) onFieldUpdated(field);
        populateFillTools(field);
        renderFillPanel();
    });

    const dropdownSelect = document.getElementById("propFillDropdownSelect");
    dropdownSelect?.addEventListener("change", (e) => commitVal(e.target.value));

    document.getElementById("propFillSignBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field) return;
        openSignatureModal(field, () => {
            field.value = "Signed";
            saveHistory(true);
            if (onFieldUpdated) onFieldUpdated(field);
            populateFillTools(field);
            renderFillPanel();
        });
    });

    document.getElementById("propFillClearSigBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field) return;
        field.signatureImage = null;
        field.value = "";
        saveHistory(true);
        if (onFieldUpdated) onFieldUpdated(field);
        populateFillTools(field);
        renderFillPanel();
    });

    document.getElementById("propFillSampleBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field) return;
        const sampleVal = getSampleValueForField(field);
        if (field.type === "checkBox") {
            field.value = true;
            field.defaultChecked = true;
        } else if (field.type === "signature") {
            field.value = "Signed";
        } else {
            field.value = sampleVal;
        }
        try { evaluateCalculations(); } catch(e) {}
        saveHistory(true);
        if (onFieldUpdated) onFieldUpdated(field);
        populateFillTools(field);
        renderFillPanel();
    });

    document.getElementById("propFillClearBtn")?.addEventListener("click", () => {
        const field = getSelectedField();
        if (!field) return;
        field.value = "";
        if (field.type === "checkBox") field.defaultChecked = false;
        if (field.type === "signature") field.signatureImage = null;
        try { evaluateCalculations(); } catch(e) {}
        saveHistory(true);
        if (onFieldUpdated) onFieldUpdated(field);
        populateFillTools(field);
        renderFillPanel();
    });

    const navigateField = async (direction) => {
        const field = getSelectedField();
        const interactiveFields = (state.fields || []).filter(f => f.type !== "staticText" && f.type !== "label" && !f.hidden);
        if (interactiveFields.length === 0) return;
        const curIdx = interactiveFields.findIndex(f => f.id === field?.id);
        const nextIdx = direction === "next" 
            ? Math.min(interactiveFields.length - 1, (curIdx >= 0 ? curIdx + 1 : 0))
            : Math.max(0, (curIdx >= 0 ? curIdx - 1 : 0));
        
        const targetField = interactiveFields[nextIdx];
        if (!targetField) return;

        state.selectedFieldIds = new Set([targetField.id]);
        if (targetField.page && targetField.page !== state.currentPageNum) {
            const { goToPage } = await import("../engines/pdf-engine.js");
            await goToPage(targetField.page, () => {
                focusFieldOnCanvas(targetField.id);
            });
        } else {
            focusFieldOnCanvas(targetField.id);
        }
    };

    document.getElementById("propFillPrevBtn")?.addEventListener("click", () => navigateField("prev"));
    document.getElementById("propFillNextBtn")?.addEventListener("click", () => navigateField("next"));
}

// ── Right Inspector Segmented Tabs & Fill Panel Management ────────
export function initRightPanelTabs(onModeChange, onRerender) {
    if (typeof document === "undefined") return;
    const tabInspector = document.getElementById("rightTabInspector");
    const tabFill = document.getElementById("rightTabFill");
    const inspectorSection = document.getElementById("inspectorPanelSection");
    const fillSection = document.getElementById("fillPanelSection");

    const switchTab = (tab) => {
        if (tab === "fill") {
            tabFill?.classList.add("active");
            tabFill?.setAttribute("aria-selected", "true");
            tabInspector?.classList.remove("active");
            tabInspector?.setAttribute("aria-selected", "false");
            if (inspectorSection) inspectorSection.style.display = "none";
            if (fillSection) fillSection.style.display = "flex";
            if (onModeChange) onModeChange("fill");
            renderFillPanel();
        } else {
            tabInspector?.classList.add("active");
            tabInspector?.setAttribute("aria-selected", "true");
            tabFill?.classList.remove("active");
            tabFill?.setAttribute("aria-selected", "false");
            if (inspectorSection) inspectorSection.style.display = "flex";
            if (fillSection) fillSection.style.display = "none";
            if (onModeChange) onModeChange("design");
            populateProperties(getSelectedField());
        }
        if (onRerender) onRerender();
    };

    tabInspector?.addEventListener("click", () => switchTab("inspector"));
    tabFill?.addEventListener("click", () => switchTab("fill"));
}

let currentFillFilter = "all";

export function initFillFilterEvents() {
    if (typeof document === "undefined") return;
    const filterAll = document.getElementById("fillFilterAll");
    const filterEmpty = document.getElementById("fillFilterEmpty");
    const filterRequired = document.getElementById("fillFilterRequired");

    const setFilter = (filterKey) => {
        currentFillFilter = filterKey;
        [filterAll, filterEmpty, filterRequired].forEach(btn => {
            if (!btn) return;
            const isActive = btn.dataset.filter === filterKey;
            btn.classList.toggle("active", isActive);
        });
        renderFillPanel();
    };

    filterAll?.addEventListener("click", () => setFilter("all"));
    filterEmpty?.addEventListener("click", () => setFilter("empty"));
    filterRequired?.addEventListener("click", () => setFilter("required"));
}

export function renderFillPanel() {
    if (typeof document === "undefined") return;
    const fillSection = document.getElementById("fillPanelSection");
    if (!fillSection) return;

    const fields = state.fields || [];
    const interactiveFields = fields.filter(f => f.type !== "staticText" && f.type !== "label");
    const totalCount = interactiveFields.length;

    let filledCount = 0;
    let requiredCount = 0;
    let requiredFilledCount = 0;

    const isFieldFilled = (f) => {
        if (f.type === "checkBox") {
            return !!f.defaultChecked || !!f.value;
        } else if (f.type === "signature") {
            return !!f.signatureImage || !!f.value;
        } else {
            const val = f.value !== undefined && f.value !== null ? String(f.value).trim() : (f.defaultValue !== undefined && f.defaultValue !== null ? String(f.defaultValue).trim() : "");
            return val.length > 0;
        }
    };

    interactiveFields.forEach(f => {
        const isRequired = !!f.required;
        if (isRequired) requiredCount++;

        const filled = isFieldFilled(f);
        if (filled) {
            filledCount++;
            if (isRequired) requiredFilledCount++;
        }
    });

    const percent = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;
    const reqRemaining = requiredCount - requiredFilledCount;
    const isAllComplete = (totalCount > 0 && filledCount === totalCount && reqRemaining === 0);

    // ── 1. Top Bar Progress Group ──
    const toolbarProgress = document.getElementById("fillToolbarProgress");
    const toolbarBar = document.getElementById("fillToolbarProgressBar");
    const toolbarText = document.getElementById("fillToolbarProgressText");

    if (toolbarBar) {
        toolbarBar.style.width = `${percent}%`;
        toolbarBar.style.background = isAllComplete ? "#10b981" : "#2563eb";
    }
    if (toolbarText) {
        toolbarText.textContent = `${filledCount} of ${totalCount}`;
    }

    // ── 2. Inspector Metrics & Progress Bar ──
    const percentEl = document.getElementById("fillProgressPercent");
    const barEl = document.getElementById("fillProgressBar");
    const countEl = document.getElementById("fillFieldsCountText");
    const reqEl = document.getElementById("fillRequiredStatusText");
    const reqBadge = document.getElementById("fillRequirementsBadge");

    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) {
        barEl.style.width = `${percent}%`;
        barEl.style.background = isAllComplete ? "#10b981" : "#2563eb";
    }
    if (countEl) countEl.textContent = `${filledCount} of ${totalCount} filled`;
    if (reqEl) {
        if (requiredCount === 0) {
            reqEl.textContent = "0 required missing";
            reqEl.style.color = "#5b6270";
        } else if (reqRemaining === 0) {
            reqEl.textContent = "0 required missing";
            reqEl.style.color = "#059669";
        } else {
            reqEl.textContent = `${reqRemaining} required missing`;
            reqEl.style.color = "#dc2626";
        }
    }
    if (reqBadge) reqBadge.textContent = `${totalCount} Fields`;

    // ── 3. Status Banner Card ──
    const statusBanner = document.getElementById("fillStatusBanner");
    const statusIcon = document.getElementById("fillStatusIcon");
    const statusTitle = document.getElementById("fillStatusTitle");
    const statusSubtitle = document.getElementById("fillStatusSubtitle");

    if (statusBanner && statusIcon && statusTitle && statusSubtitle) {
        if (totalCount === 0) {
            statusBanner.className = "fill-status-card ready";
            statusBanner.style.background = "#f8fafc";
            statusBanner.style.borderColor = "#e2e8f0";
            statusIcon.style.background = "#94a3b8";
            statusIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
            statusTitle.textContent = "No interactive fields.";
            statusSubtitle.textContent = "Add fields in Design mode to begin.";
            statusTitle.style.color = "#475569";
            statusSubtitle.style.color = "#64748b";
        } else if (isAllComplete) {
            statusBanner.className = "fill-status-card ready";
            statusBanner.style.background = "#ecfdf5";
            statusBanner.style.borderColor = "#a7f3d0";
            statusIcon.style.background = "#10b981";
            statusIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            statusTitle.textContent = `All ${totalCount} fields complete.`;
            statusSubtitle.textContent = "Ready to download.";
            statusTitle.style.color = "#065f46";
            statusSubtitle.style.color = "#047857";
        } else if (reqRemaining > 0) {
            statusBanner.className = "fill-status-card incomplete";
            statusBanner.style.background = "#fffbeb";
            statusBanner.style.borderColor = "#fde68a";
            statusIcon.style.background = "#f59e0b";
            statusIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
            statusTitle.textContent = `${reqRemaining} required field${reqRemaining === 1 ? '' : 's'} missing.`;
            statusSubtitle.textContent = "Fill all required fields to complete.";
            statusTitle.style.color = "#92400e";
            statusSubtitle.style.color = "#b45309";
        } else {
            statusBanner.className = "fill-status-card ready";
            statusBanner.style.background = "#eff6ff";
            statusBanner.style.borderColor = "#bfdbfe";
            statusIcon.style.background = "#3b82f6";
            statusIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            statusTitle.textContent = "Required fields complete.";
            statusSubtitle.textContent = `${totalCount - filledCount} optional field${(totalCount - filledCount) === 1 ? '' : 's'} remaining.`;
            statusTitle.style.color = "#1e40af";
            statusSubtitle.style.color = "#2563eb";
        }
    }

    // ── 4. Filter Chips Count Updates ──
    const filterAll = document.getElementById("fillFilterAll");
    const filterEmpty = document.getElementById("fillFilterEmpty");
    const filterRequired = document.getElementById("fillFilterRequired");

    if (filterAll) filterAll.textContent = `All ${totalCount}`;
    if (filterEmpty) filterEmpty.textContent = `Empty ${totalCount - filledCount}`;
    if (filterRequired) filterRequired.textContent = `Required ${requiredCount}`;

    // ── 5. Page Grouping Header ──
    const curPage = state.currentPageNum || 1;
    const pageFields = interactiveFields.filter(f => (f.page || 1) === curPage);
    const groupingHeader = document.getElementById("fillPageGroupingHeader");
    if (groupingHeader) {
        groupingHeader.textContent = `PAGE ${curPage} · ${pageFields.length} FIELD${pageFields.length === 1 ? '' : 'S'}`;
    }

    // ── 6. Filter & Render Field Checklist ──
    let displayedFields = interactiveFields;
    if (currentFillFilter === "empty") {
        displayedFields = interactiveFields.filter(f => !isFieldFilled(f));
    } else if (currentFillFilter === "required") {
        displayedFields = interactiveFields.filter(f => !!f.required);
    }

    const listEl = document.getElementById("fillRequirementsList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (displayedFields.length === 0) {
        const emptyLabels = {
            all: "No interactive fields added to this document yet.",
            empty: "No empty fields remaining — everything is filled! 🎉",
            required: "No required fields defined in this document."
        };
        listEl.innerHTML = `<p class="empty-msg" style="padding: 14px; color: #94a3b8; font-size: 12px; text-align: center;">${emptyLabels[currentFillFilter] || 'No fields match the current filter.'}</p>`;
        return;
    }

    displayedFields.forEach((f, idx) => {
        const filled = isFieldFilled(f);
        let displayVal = "";
        if (f.type === "checkBox") {
            displayVal = filled ? "Checked (✓)" : "Unchecked";
        } else if (f.type === "signature") {
            displayVal = filled ? "Signed" : "Unsigned";
        } else {
            const val = f.value !== undefined && f.value !== null ? String(f.value).trim() : (f.defaultValue !== undefined && f.defaultValue !== null ? String(f.defaultValue).trim() : "");
            displayVal = filled ? val : "Empty";
        }

        const isReq = !!f.required;
        const isSelected = state.selectedFieldIds && (state.selectedFieldIds.has(f.id) || state.selectedFieldIds.has(String(f.id)));

        const item = document.createElement("div");
        item.className = "fill-req-item" + (filled ? " filled" : "") + (isReq && !filled ? " missing-required" : "") + (isSelected ? " selected" : "");

        const dotClass = filled 
            ? "fill-status-dot filled" 
            : (isReq ? "fill-status-dot missing-required" : "fill-status-dot empty");

        const reqBadgeHtml = isReq ? '<span style="font-size: 9.5px; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; padding: 0 4px; border-radius: 4px; font-weight: 700; flex-shrink: 0;">REQ</span>' : '';

        item.innerHTML = `
            <div class="${dotClass}" title="${filled ? 'Filled' : (isReq ? 'Required Missing' : 'Empty')}"></div>
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span style="font-weight: 600; font-size: 12px; color: #1c1f26; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(f.name || `Field ${idx + 1}`)}</span>
                    ${reqBadgeHtml}
                </div>
                <span style="font-size: 11px; color: ${filled ? '#4a505c' : '#94a3b8'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayVal)}</span>
            </div>
            <span style="font-size: 10px; color: #5b6270; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; flex-shrink: 0; font-weight: 600;">P${f.page || 1}</span>
        `;

        item.addEventListener("click", async () => {
            if (f.page && f.page !== state.currentPageNum) {
                const { goToPage } = await import("../engines/pdf-engine.js");
                await goToPage(f.page, () => {
                    focusFieldOnCanvas(f.id);
                });
            } else {
                focusFieldOnCanvas(f.id);
            }
        });

        listEl.appendChild(item);
    });

    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }
}

function focusFieldOnCanvas(fieldId) {
    if (typeof document === "undefined") return;
    const f = (state.fields || []).find(item => item.id === fieldId);
    if (f) {
        state.selectedFieldIds = new Set([fieldId]);
    }
    const overlay = document.querySelector(`.field-overlay[data-field-id="${fieldId}"]`);
    if (overlay) {
        overlay.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        const input = overlay.querySelector("input, textarea, select");
        if (input) {
            input.focus();
        }
    }
    if (f) {
        populateProperties(f);
        // In Fill Mode, maintain the Fill tab and refresh the list highlight instead of switching back to Inspector
        if (state.editorMode !== "fill") {
            const inspectorSection = document.getElementById("inspectorPanelSection");
            const fillSection = document.getElementById("fillPanelSection");
            const tabInspector = document.getElementById("rightTabInspector");
            const tabFill = document.getElementById("rightTabFill");
            if (inspectorSection && fillSection) {
                inspectorSection.style.display = "flex";
                fillSection.style.display = "none";
                tabInspector?.classList.add("active");
                tabInspector?.setAttribute("aria-selected", "true");
                tabFill?.classList.remove("active");
                tabFill?.setAttribute("aria-selected", "false");
            }
        } else {
            renderFillPanel();
        }
    }
}

