// js/engines/detection/acroform-passthrough.js
// Existing AcroForm widget passthrough and state importer

import { state, generateFieldId } from "../../core/state.js";
import { isOverlapping } from "../../utils/geometry.js";
import { DEDUP_THRESHOLDS } from "./config.js";
import { resolveSemanticProps } from "./semantic-resolver.js";

export async function getExistingWidgetFields(page, viewport, pageNum, usedNames = new Set()) {
    let annotations;
    try {
        annotations = await page.getAnnotations({ intent: "display" });
    } catch (err) {
        console.warn("Failed to read annotations on page " + pageNum + ":", err);
        return [];
    }

    if (!Array.isArray(annotations)) return [];
    const widgets = annotations.filter(a => {
        return a.subtype === "Widget" && Array.isArray(a.rect) && a.rect.length === 4 &&
            (a.fieldName || a.alternativeText || a.id);
    });
    const fields = [];

    for (const w of widgets) {
        const [x0, y0, x1, y1] = w.rect;
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        const top = viewport.height - Math.max(y0, y1);
        const bottom = viewport.height - Math.min(y0, y1);

        const fieldFlags = w.fieldFlags || 0;
        const isRadio = (w.checkBox === false && w.radioButton === true) || (!!(fieldFlags & 32768));
        const isCheckbox = w.checkBox === true || (w.fieldType === "Btn" && !isRadio && !(fieldFlags & 65536));
        const isMultiline = !!(fieldFlags & 4096);

        let type = "textField";
        let options = undefined;
        let defaultValue = undefined;

        if (w.fieldType === "Btn") {
            type = isRadio ? "radioGroup" : "checkBox";
        } else if (w.fieldType === "Sig") {
            type = "signature";
        } else if (w.fieldType === "Ch") {
            type = "dropdown";
            options = Array.isArray(w.options)
                ? w.options.map(o => typeof o === "string" ? o : (o.displayValue || o.exportValue || ""))
                : ["Select...", "Option 1", "Option 2"];
            defaultValue = w.fieldValue || (options.length > 0 ? options[0] : "Select...");
        } else if (/\b(?:date|dob)\b/i.test((w.fieldName || "").replace(/_/g, " ")) || /\b(?:date|dob)\b/i.test((w.alternativeText || "").replace(/_/g, " "))) {
            type = "dateField";
        }

        const sourceName = w.fieldName || w.alternativeText || w.id || "field";
        const semanticNames = isRadio ? new Set() : usedNames;
        const sem = resolveSemanticProps(sourceName, type, semanticNames);
        const fieldName = isRadio
            ? sourceName
            : (usedNames.has(sourceName) ? sem.name : sourceName);
        if (!isRadio) usedNames.add(fieldName);

        const isComb = !!(fieldFlags & 16777216);
        const maxLen = w.maxLen || undefined;

        fields.push({
            id: generateFieldId(),
            type,
            // Keep the PDF field name when possible. This makes exported
            // fields stable and prevents native viewer autofill from losing
            // the original field identity.
            name: fieldName || sem.name,
            value: w.buttonValue || w.fieldValue || "",
            ...(type === "dropdown" ? { options, defaultValue } : {}),
            ...(isRadio ? {
                radioGroup: sourceName,
                exportValue: w.buttonValue || w.fieldValue || "",
                radioValue: w.buttonValue || w.fieldValue || "",
                defaultChecked: !!(w.fieldValue && w.fieldValue !== "Off")
            } : {}),
            ...(isCheckbox ? {
                defaultChecked: !!(w.fieldValue && w.fieldValue !== "Off")
            } : {}),
            ...(isComb ? {
                isComb: true,
                ...(maxLen ? { maxLength: maxLen } : {})
            } : {}),
            x: Math.max(0, Math.round(left)),
            y: Math.max(0, Math.round(top)),
            width: Math.max(10, Math.round(right - left)),
            height: Math.max(10, Math.round(bottom - top)),
            page: pageNum,
            borderStyle: "none",
            fillStyle: "transparent",
            borderWidth: 0,
            multiline: isMultiline || sem.multiline || false,
            autofill: sem.autofill || "",
            dataFormat: sem.dataFormat || "text",
            tooltip: w.alternativeText || (fieldName || sem.name || "field").replace(/_/g, " "),
            confidence: 1.0,
            detectedBy: "acroform",
            sourcedFrom: "acroform",
            sourceFieldName: sourceName
        });
    }

    return fields;
}

export async function importExistingAcroFormFields(scope = "all") {
    if (!state.pdfDoc) return 0;
    const pagesToScan = scope === "current"
        ? [state.currentPageNum]
        : Array.from({ length: state.totalPages }, (_, i) => i + 1);
    const imported = [];
    const usedNames = new Set(state.fields.map(field => field.name));

    for (const pageNum of pagesToScan) {
        const page = await state.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        imported.push(...await getExistingWidgetFields(page, viewport, pageNum, usedNames));
    }

    const existing = state.fields.filter(field => !pagesToScan.includes(field.page || 1));
    const current = state.fields.filter(field => pagesToScan.includes(field.page || 1));
    const merged = [...existing, ...current];
    for (const field of imported) {
        if (!isOverlapping(field, merged, DEDUP_THRESHOLDS.CROSS_STAGE)) merged.push(field);
    }
    state.fields = merged;
    return imported.length;
}

/**
 * Uniform stage detection plugin contract for existing AcroForm widgets.
 * @param {Object} context Stage detection context
 * @returns {Promise<Array>} Detected AcroForm widget fields
 */
export async function detect(context = {}) {
    const {
        page,
        viewport = { width: 612, height: 792 },
        pageNum = 1,
        usedNames = new Set()
    } = context;
    if (!page) return [];
    return await getExistingWidgetFields(page, viewport, pageNum, usedNames);
}
