import { state, getFieldsForCurrentPage, getSelectedField, setSelectedField, setSelectedFields, duplicateSelectedFields, createGroupForSelected, ungroupSelected, sortFieldsByReadingOrder, evaluateCalculations, getRadioGroupName, getRadioGroupFields, selectRadioOption, toggleCheckboxField, getCheckboxGroupKey, getCheckboxGroupFields, getVerticallyAlignedColumnSiblings, fillFormulaDownColumn, pasteFormulaRecipeToFields } from "../core/state.js";
import { FIELD_TYPE_LABELS } from "../core/constants.js";
import { openSignatureModal } from "./signature-pad.js";
import { makeScrubbableAndScrollable, distributeSelectedFields, isPickingCalcField, updateCanvasPickModeUI } from "./properties-panel.js";
import { saveHistory } from "../core/storage-manager.js";
import { goToPage } from "../engines/pdf-engine.js";
import { toggleListFormat, addRowToTable, removeRowFromTable, addColumnToTable, removeColumnFromTable, deleteTable } from "../engines/text-engine.js";

export function getFieldCssFont(field) {
    let fam = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    let weight = "400";
    let style = "normal";
    let letterSpacing = "normal";

    const family = field?.fontFamily || "helvetica";
    if (family === "times") {
        fam = "'Times New Roman', Times, Georgia, serif";
    } else if (family === "courier") {
        fam = "'Courier New', Courier, monospace";
        letterSpacing = "0.5px";
    } else if (family === "helvetica-bold") {
        fam = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        weight = "700";
    } else if (family === "times-italic") {
        fam = "'Times New Roman', Times, Georgia, serif";
        style = "italic";
    } else if (family === "inter") {
        fam = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
        weight = "500";
    } else if (family === "carlito") {
        fam = "'Carlito', Calibri, sans-serif";
    } else if (family === "roboto-mono") {
        fam = "'Roboto Mono', monospace";
        letterSpacing = "0.2px";
    } else if (family === "ibm-plex-mono") {
        fam = "'IBM Plex Mono', monospace";
        letterSpacing = "0.3px";
    } else if (family === "caveat") {
        fam = "'Caveat', cursive";
        weight = "600";
    } else if (family === "cedarville") {
        fam = "'Cedarville Cursive', cursive";
    } else if (typeof family === "string" && (family.startsWith("device:") || family.startsWith("local:"))) {
        const rawName = family.replace(/^(device|local):/, "").trim();
        if (rawName === "system-ui") {
            fam = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
        } else if (/mono|code|consolas|courier|menlo|monaco/i.test(rawName)) {
            fam = `"${rawName}", Menlo, Monaco, Consolas, 'Courier New', monospace`;
            letterSpacing = "0.3px";
        } else if (/serif|georgia|palatino|garamond|times|didot|cambria/i.test(rawName)) {
            fam = `"${rawName}", Georgia, 'Times New Roman', serif`;
        } else if (/black|impact/i.test(rawName)) {
            fam = `"${rawName}", 'Arial Black', Impact, sans-serif`;
            weight = "800";
        } else {
            fam = `"${rawName}", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
        }
    } else if (family && family !== "helvetica") {
        fam = `"${family}", -apple-system, BlinkMacSystemFont, sans-serif`;
    }

    // Apply explicit field fontWeight & fontStyle overrides
    if (field?.fontWeight === "bold" || field?.fontWeight === "700" || field?.fontWeight >= 700) {
        weight = (weight === "800") ? "900" : "700";
    } else if (field?.fontWeight === "normal" || field?.fontWeight === "400") {
        weight = (weight === "800") ? "800" : "400";
    }
    if (field?.fontStyle === "italic") {
        style = "italic";
    } else if (field?.fontStyle === "normal") {
        style = "normal";
    }

    return { fam, weight, style, letterSpacing };
}

function getFillInputFontSize(field, fallback = 12) {
    const explicit = Number(field?.fontSize);
    if (Number.isFinite(explicit) && explicit >= 6) return explicit;
    return fallback;
}

export function getSafeImageSrc(src) {
    if (typeof src === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(src.trim())) {
        return src.trim();
    }
    return "";
}

export function formatFieldDisplayName(f) {
    if (!f) return "Field";
    const raw = f.name || FIELD_TYPE_LABELS[f.type] || "Text Field";
    return raw
        .replace(/_input$/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

export function renderOverlays(handlers) {
    const container = document.getElementById("overlayContainer");
    if (!container) return;
    container.innerHTML = "";

    const pageFields = sortFieldsByReadingOrder(getFieldsForCurrentPage());

    pageFields.forEach(f => {
        const div = document.createElement("div");
        const isSelected = state.selectedFieldIds.has(f.id);
        const isMultiSelected = isSelected && state.selectedFieldIds.size > 1;
        div.className = "field-overlay" + (isSelected ? (isMultiSelected ? " selected multi-selected" : " selected") : "");
        if (f.tableId) {
            div.classList.add("is-table-cell");
            if (f.tableRole === "header") div.classList.add("is-table-header");
        }
        div.id = `overlay_${f.id}`;
        div.style.left = f.x + "px";
        div.style.top = f.y + "px";
        div.style.width = f.width + "px";
        div.style.height = f.height + "px";

        // ── LIVE INTERACTIVE FILL & TEST MODE ────────────────────────────
        if (state.editorMode === "fill") {
            div.classList.add("fill-mode");

            if (f.type === "staticText") {
                const hasBorder = f.borderStyle && f.borderStyle !== "none";
                const hasFill = f.fillStyle && f.fillStyle !== "transparent";
                div.style.border = hasBorder ? `${f.borderWidth || 1}px solid ${f.borderColor || "#cbd5e1"}` : "none";
                div.style.background = hasFill ? f.fillStyle : "transparent";
                div.style.boxShadow = "none";
                div.style.display = "flex";
                div.style.alignItems = (f.height > (Number(f.fontSize) || 14) * 2.2) ? "flex-start" : "center";
                div.style.justifyContent = f.textAlignment === "center" ? "center" : (f.textAlignment === "right" ? "flex-end" : "flex-start");
                
                const span = document.createElement("span");
                const { fam, weight, style: fontStyle } = getFieldCssFont(f);
                const fontSize = Number(f.fontSize) || 14;
                span.style.cssText = `font-family: ${fam}; font-weight: ${weight}; font-style: ${fontStyle}; font-size: ${fontSize}px; color: ${f.color || "#1c1f26"}; width: 100%; text-align: ${f.textAlignment || 'left'}; line-height: 1.35; white-space: pre-wrap; word-break: break-word;`;
                span.textContent = f.defaultValue || f.label || f.value || "Sample Text";
                div.appendChild(span);
                container.appendChild(div);
                return;
            }

            const isChoice = (f.type === "checkBox" || f.type === "radioGroup" || f.type === "radio");
            if (isChoice) {
                div.style.border = "none";
                div.style.background = "transparent";
                div.style.boxShadow = "none";
                div.style.display = "flex";
                div.style.alignItems = "center";
                div.style.justifyContent = "center";
            } else {
                div.style.border = f.borderStyle === "none" ? "1.5px dashed #94A3B8" : "1.5px solid #94A3B8";
                div.style.borderRadius = "3px";
                div.style.background = "rgba(255, 255, 255, 0.98)";
                div.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.06), inset 0 0 0 1px rgba(148,163,184,0.18)";
            }

            if (f.type === "checkBox") {
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "fill-input-checkbox";
                cb.checked = !!f.defaultChecked;
                cb.style.cssText = "width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: #2563eb;";
                cb.addEventListener("change", () => {
                    toggleCheckboxField(f, cb.checked, state.fields);
                    saveHistory(true, "Toggle Checkbox");
                    renderOverlays(handlers);
                    if (handlers?.onUpdated) handlers.onUpdated(f);
                });
                div.appendChild(cb);
            } else if (f.type === "radioGroup" || f.type === "radio") {
                const grpName = getRadioGroupName(f);
                const groupSiblings = getRadioGroupFields(f, state.fields);
                const isMulti = groupSiblings.some(s => s.radioGroupMulti === true);

                const rb = document.createElement("input");
                rb.type = isMulti ? "checkbox" : "radio";
                if (!isMulti) rb.name = `rg_${grpName}`;
                rb.className = isMulti ? "fill-input-checkbox" : "fill-input-radio";
                rb.value = f.exportValue || f.radioValue || f.value || `option_${f.id}`;
                rb.checked = !!(f.defaultChecked || f.checked);
                rb.style.cssText = "width: 14px; height: 14px; margin: 0; cursor: pointer; accent-color: #2563eb;";
                rb.addEventListener("change", () => {
                    selectRadioOption(f, state.fields);
                    saveHistory(true, `Select ${rb.value}`);
                    if (handlers.onUpdated) handlers.onUpdated(f);
                    renderOverlays(handlers);
                });
                div.appendChild(rb);
            } else if (f.type === "dropdown") {
                const sel = document.createElement("select");
                sel.className = "fill-input-select";
                const dropdownFontSize = getFillInputFontSize(f, Math.min(12, Math.max(8, f.height - 4)));
                const { fam, weight, style: fontStyle } = getFieldCssFont(f);
                sel.style.cssText = `width: 100%; height: 100%; border: none; background: transparent; font-size: ${dropdownFontSize}px; font-family: ${fam}; font-weight: ${weight}; font-style: ${fontStyle}; padding: 0 4px; outline: none; cursor: pointer; color: #1c1f26; appearance: none; -webkit-appearance: none; text-align: ${f.textAlignment || 'left'};`;
                const opts = (f.options && f.options.length) ? f.options : ["Select..."];
                opts.forEach(opt => {
                    const optEl = document.createElement("option");
                    optEl.value = opt;
                    optEl.textContent = opt;
                    if (opt === (f.value || f.defaultValue)) optEl.selected = true;
                    sel.appendChild(optEl);
                });
                sel.addEventListener("change", () => {
                    f.value = sel.value;
                    f.defaultValue = sel.value;
                    saveHistory();
                });
                div.appendChild(sel);
            } else if (f.type === "signature") {
                const safeSig = getSafeImageSrc(f.signatureImage);
                if (safeSig) {
                    div.innerHTML = `
                        <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                            <img src="${safeSig}" alt="Signature preview" style="width:100%; height:100%; object-fit:contain; pointer-events:none;">
                            <button class="fill-clear-sig-btn" title="Clear signature" style="position:absolute; top:2px; right:2px; width:16px; height:16px; border-radius:50%; background:#ef4444; color:#fff; border:none; font-size:9px; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;">✕</button>
                        </div>
                    `;
                    div.querySelector(".fill-clear-sig-btn")?.addEventListener("click", e => {
                        e.stopPropagation();
                        f.signatureImage = null;
                        renderOverlays(handlers);
                        saveHistory();
                    });
                } else {
                    const signBtn = document.createElement("div");
                    signBtn.className = "fill-sign-prompt";
                    signBtn.style.cssText = "width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#2563eb; cursor:pointer; font-size:11px; font-weight:600; background:rgba(239,246,255,0.8);";
                    signBtn.innerHTML = `<span>Sign Here</span>`;
                    signBtn.addEventListener("click", e => {
                        e.stopPropagation();
                        openSignatureModal(f, () => {
                            renderOverlays(handlers);
                            saveHistory();
                        });
                    });
                    div.appendChild(signBtn);
                }
            } else if (f.type === "dateField" || f.dataFormat === "date") {
                const dateInput = document.createElement("input");
                dateInput.type = "date";
                dateInput.className = "fill-input-date";
                dateInput.value = f.value || f.defaultValue || "";
                const dateFontSize = getFillInputFontSize(f, Math.min(12, Math.max(8, f.height - 4)));
                const { fam, weight, style: fontStyle } = getFieldCssFont(f);
                dateInput.style.cssText = `width: 100%; height: 100%; border: none; background: transparent; font-size: ${dateFontSize}px; font-family: ${fam}; font-weight: ${weight}; font-style: ${fontStyle}; padding: 0 4px; outline: none; box-sizing: border-box; color: #1c1f26; text-align: ${f.textAlignment || 'left'};`;
                dateInput.addEventListener("input", () => {
                    f.value = dateInput.value;
                    f.defaultValue = dateInput.value;
                    evaluateCalculations();
                    saveHistory();
                });
                div.appendChild(dateInput);
            } else if (f.multiline) {
                const ta = document.createElement("textarea");
                ta.className = "fill-input-textarea";
                ta.value = f.value || f.defaultValue || "";
                ta.placeholder = f.placeholder || "";
                const textareaFontSize = getFillInputFontSize(f, Math.min(12, Math.max(10, f.height / 3)));
                const { fam, weight, style: fontStyle } = getFieldCssFont(f);
                ta.style.cssText = `width: 100%; height: 100%; border: none; background: transparent; font-size: ${textareaFontSize}px; font-family: ${fam}; font-weight: ${weight}; font-style: ${fontStyle}; padding: 4px; outline: none; resize: none; box-sizing: border-box; line-height: 1.3; color: #1c1f26; text-align: ${f.textAlignment || 'left'};`;
                ta.addEventListener("input", () => {
                    f.value = ta.value;
                    f.defaultValue = ta.value;
                    evaluateCalculations();
                    saveHistory();
                });
                div.appendChild(ta);
            } else {
                const inp = document.createElement("input");
                inp.type = f.dataFormat === "email" ? "email" : (f.dataFormat === "phone" ? "tel" : (f.dataFormat === "number" ? "number" : "text"));
                inp.className = "fill-input-text";
                inp.value = f.value || f.defaultValue || "";
                inp.placeholder = f.placeholder || "";
                const inputFontSize = getFillInputFontSize(f, Math.min(12, Math.max(8, f.height - 4)));
                const { fam, weight, style: fontStyle } = getFieldCssFont(f);
                const defaultAlign = (f.dataFormat === "currency" || f.dataFormat === "number" || (f.calculationType && f.calculationType !== "none")) ? "right" : "left";
                const resolvedAlign = f.textAlignment || defaultAlign;
                inp.style.cssText = `width: 100%; height: 100%; border: none; background: transparent; font-size: ${inputFontSize}px; font-family: ${fam}; font-weight: ${weight}; font-style: ${fontStyle}; padding: 0 5px; outline: none; box-sizing: border-box; text-align: ${resolvedAlign}; color: #1c1f26; appearance: none; -webkit-appearance: none;`;

                const isReadOnly = !!f.readOnly || (f.calculationType && f.calculationType !== "none");
                if (isReadOnly) {
                    inp.readOnly = true;
                    inp.style.cursor = "default";
                    inp.title = f.calculationType && f.calculationType !== "none" ? "Calculated formula field" : "Read-only field";
                }

                if (f.dataFormat === "currency") {
                    const sym = f.currencySymbol || "$";
                    const pos = f.currencyPosition || (sym === "€" ? "suffix" : "prefix");
                    const dec = f.currencyDecimals !== undefined ? Number(f.currencyDecimals) : 2;
                    inp.addEventListener("blur", () => {
                        let val = inp.value.trim().replace(/[^0-9.-]/g, "");
                        if (val && !isNaN(Number(val))) {
                            const formattedNum = Number(val).toFixed(dec);
                            inp.value = pos === "suffix" ? `${formattedNum} ${sym}` : `${sym}${formattedNum}`;
                            f.value = inp.value;
                            f.defaultValue = inp.value;
                            evaluateCalculations();
                        }
                    });
                }

                if (f.isComb && f.maxLength > 1) {
                    inp.maxLength = parseInt(f.maxLength);
                    const cellW = f.width / f.maxLength;
                    inp.style.letterSpacing = `${Math.max(2, (cellW - 8) * 0.5)}px`;
                    inp.style.fontFamily = "'IBM Plex Mono', 'Courier New', monospace";
                    inp.style.textAlign = "center";
                }

                inp.addEventListener("input", () => {
                    f.value = inp.value;
                    f.defaultValue = inp.value;
                    evaluateCalculations();
                    saveHistory();
                });
                div.appendChild(inp);
            }

            container.appendChild(div);
            return;
        }

        // Border & fill styles (Design Mode - WCAG 2.1 / 2.2 AA Compliant)
        if (f.type === "radioGroup") {
            div.style.borderRadius = "50%";
            if (isSelected) {
                if (isMultiSelected) {
                    div.style.border = "1px solid #93C5FD";
                    div.style.background = "rgba(239, 246, 255, 0.50)";
                    div.style.boxShadow = "none";
                } else {
                    div.style.border = "2px solid #1D4ED8";
                    div.style.background = "#EFF6FF";
                    div.style.boxShadow = "0 0 0 3px rgba(29, 78, 216, 0.20)";
                }
            } else {
                div.style.border = "1.5px solid #94A3B8";
                div.style.background = "#F8FAFC";
                div.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.04)";
            }
        } else if (f.type === "checkBox") {
            div.style.borderRadius = "3px";
            if (isSelected) {
                if (isMultiSelected) {
                    div.style.border = "1px solid #93C5FD";
                    div.style.background = "rgba(239, 246, 255, 0.50)";
                    div.style.boxShadow = "none";
                } else {
                    div.style.border = "2px solid #1D4ED8";
                    div.style.background = "#EFF6FF";
                    div.style.boxShadow = "0 0 0 3px rgba(29, 78, 216, 0.20)";
                }
            } else {
                div.style.border = "1.5px solid #94A3B8";
                div.style.background = "#F8FAFC";
                div.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.04)";
            }
        } else {
            div.style.borderRadius = "3px";
            if (isSelected) {
                if (isMultiSelected) {
                    div.style.border = "1px solid #93C5FD";
                    div.style.background = "rgba(239, 246, 255, 0.50)";
                    div.style.boxShadow = "none";
                } else {
                    div.style.border = "2px solid #1D4ED8";
                    div.style.background = "#EFF6FF";
                    div.style.boxShadow = "0 0 0 3px rgba(29, 78, 216, 0.22)";
                }
            } else {
                if (f.borderStyle === "none") {
                    div.style.border = "1.5px dashed #94A3B8";
                } else if (f.borderStyle === "thick") {
                    div.style.border = "2px solid #64748B";
                } else {
                    div.style.border = "1.5px solid #94A3B8";
                }

                if (f.fillStyle === "tint") {
                    div.style.background = "rgba(219, 234, 254, 0.50)";
                } else if (f.fillStyle === "yellow") {
                    div.style.background = "rgba(254, 249, 195, 0.45)";
                } else if (f.fillStyle === "transparent") {
                    div.style.background = "rgba(255, 255, 255, 0.05)";
                } else {
                    div.style.background = "#F8FAFC";
                }
                div.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.04)";
            }
        }

        // Alignment and typography
        if (f.textAlignment === "center") {
            div.style.justifyContent = "center";
        } else if (f.textAlignment === "right") {
            div.style.justifyContent = "flex-end";
        } else {
            div.style.justifyContent = "flex-start";
        }

        // Special render for signature fields
        if (f.type === "signature") {
            const safeSig = getSafeImageSrc(f.signatureImage);
            if (safeSig) {
                div.innerHTML = `
                    <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                        <img src="${safeSig}" alt="Signature preview" style="width:100%; height:100%; object-fit:contain; pointer-events:none;">
                    </div>
                `;
            } else {
                div.innerHTML = `
                    <div class="sig-prompt-badge" style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; color:#2563eb; cursor:pointer;">
                        <span style="font-size:10.5px; font-weight:600; font-family:'Inter', sans-serif; background:rgba(224,242,254,0.65); padding:2px 7px; border-radius:3px; border:1px dashed #60a5fa; box-shadow:0 1px 2px rgba(0,0,0,0.05);">Sign</span>
                    </div>
                `;
            }

            const triggerSign = e => {
                e.stopPropagation();
                openSignatureModal(f, () => {
                    renderOverlays(handlers);
                    if (handlers.onUpdated) handlers.onUpdated(f);
                });
            };

            div.addEventListener("dblclick", triggerSign);
            const badge = div.querySelector(".sig-prompt-badge");
            if (badge) badge.addEventListener("click", triggerSign);
        } else if (f.type === "checkBox") {
            if (f.defaultChecked) {
                if (f.checkboxMark === "x") {
                    div.innerHTML = `<svg class="animated-checkmark-svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5"></line><line x1="12.5" y1="3.5" x2="3.5" y2="12.5"></line></svg>`;
                } else {
                    div.innerHTML = `<svg class="animated-checkmark-svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8.5 6.5 12 13 4"></polyline></svg>`;
                }
            } else {
                div.innerHTML = "";
            }
        } else if (f.type === "radioGroup" || f.type === "radio") {
            div.innerHTML = f.defaultChecked ? `<div class="animated-radio-dot"></div>` : "";
        } else {
            const label = document.createElement("span");
            label.className = "overlay-label";
            label.style.width = "100%";
            const defaultLabelAlign = (f.dataFormat === "currency" || f.dataFormat === "number" || (f.calculationType && f.calculationType !== "none")) ? "right" : "left";
            label.style.textAlign = f.textAlignment || defaultLabelAlign;

            let { fam, weight, style, letterSpacing } = getFieldCssFont(f);

            label.style.fontFamily = fam;
            label.style.fontWeight = weight;
            label.style.fontStyle = style;
            label.style.letterSpacing = letterSpacing;
            const targetFontSize = (f.fontSize && f.fontSize >= 6) ? f.fontSize : 11;
            const responsiveSize = f.width < 80 ? Math.min(targetFontSize, 9.5) : Math.min(targetFontSize, Math.max(9, f.height - 6));
            label.style.fontSize = responsiveSize + "px";
            label.style.lineHeight = "1.2";
            label.style.boxSizing = "border-box";
            label.style.padding = f.width < 70 ? "0 3px" : "0 6px";
            label.style.whiteSpace = "nowrap";
            label.style.overflow = "hidden";
            label.style.textOverflow = "ellipsis";

            if (f.type === "staticText") {
                const textContent = f.defaultValue || f.label || f.value || "";
                label.textContent = textContent || "Click to type...";
                label.style.color = textContent ? (f.color || "#1c1f26") : "#94a3b8";
                label.style.fontStyle = textContent ? ((style === "italic") ? "italic" : "normal") : "italic";
                label.style.fontWeight = weight || "600";
                label.style.opacity = textContent ? "1.0" : "0.75";
                label.style.fontSize = `${Number(f.fontSize) || 14}px`;
                label.style.whiteSpace = "pre-wrap";
                label.style.wordBreak = "break-word";
                label.style.lineHeight = "1.35";
                label.style.textAlign = f.textAlignment || "left";
                label.style.width = "100%";

                div.style.alignItems = "flex-start";
                label.style.paddingTop = "2px";

                if (f.fillStyle && f.fillStyle !== "transparent") {
                    div.style.background = f.fillStyle;
                } else {
                    div.style.background = "transparent";
                }
                if (f.borderStyle && f.borderStyle !== "none") {
                    div.style.border = `${f.borderWidth || 1}px solid ${f.borderColor || "#cbd5e1"}`;
                } else {
                    div.style.border = "none";
                }
                div.style.boxShadow = "none";

                div.appendChild(label);
            } else if (f.type === "dropdown") {
                const displayText = f.value || f.defaultValue || (f.options && f.options.length ? f.options[0] : "Select...");
                label.textContent = displayText;
                label.style.color = (f.value || f.defaultValue) ? "#1c1f26" : "rgba(100, 116, 139, 0.7)";
                
                const arrow = document.createElement("span");
                arrow.style.cssText = "font-size:8.5px; color:#5b6270; margin-left:auto; padding-right:4px; flex-shrink:0; pointer-events:none; user-select:none;";
                arrow.textContent = "▼";
                div.style.display = "flex";
                div.style.alignItems = "center";
                div.style.justifyContent = "space-between";
                div.appendChild(label);
                div.appendChild(arrow);
            } else {
                const isRealVal = (f.value !== undefined && f.value !== "");
                const isFormatPlaceholder = f.defaultValue && /^(?:YYYY[-/]MM[-/]DD|MM[-/]DD[-/]YYYY|MM[-/]YY)$/i.test(f.defaultValue.trim());
                
                if (isRealVal) {
                    label.textContent = f.value;
                    label.style.color = "#1c1f26";
                    label.style.fontStyle = (style === "italic") ? "italic" : "normal";
                    label.style.fontWeight = weight || "500";
                    label.style.opacity = "1.0";
                } else if (f.defaultValue && !isFormatPlaceholder) {
                    label.textContent = f.defaultValue;
                    label.style.color = "#5b6270";
                    label.style.fontStyle = "italic";
                    label.style.fontWeight = "400";
                    label.style.opacity = "0.85";
                    label.title = "Default / Placeholder Value";
                } else {
                    // Do NOT show blocking text inside box; keep 100% see-through!
                    label.textContent = "";
                }
                div.appendChild(label);

                if (f.isComb && f.maxLength > 1) {
                    const combWrap = document.createElement("div");
                    combWrap.className = "comb-cell-container";
                    combWrap.style.cssText = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; pointer-events: none; z-index: 1;";
                    const cellCount = parseInt(f.maxLength) || 1;
                    for (let i = 0; i < cellCount; i++) {
                        const cell = document.createElement("div");
                        cell.className = "comb-cell";
                        cell.style.cssText = `flex: 1; height: 100%; border-right: ${i < cellCount - 1 ? '1px solid rgba(148, 163, 184, 0.45)' : 'none'}; box-sizing: border-box;`;
                        combWrap.appendChild(cell);
                    }
                    div.appendChild(combWrap);
                }
            }
        }

        if (f.hidden) {
            div.classList.add("is-hidden");
        }
        if (f.locked) {
            div.classList.add("is-locked");
            const lockBadge = document.createElement("span");
            lockBadge.className = "field-locked-badge";
            lockBadge.style.cssText = "position: absolute; top: -14px; right: 0; background: #fffbeb; border: 1px solid #fde68a; border-radius: 3px; padding: 1px 4px; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 60;";
            lockBadge.innerHTML = `<i data-lucide="lock" style="width: 10px; height: 10px; color: #d97706;"></i>`;
            div.appendChild(lockBadge);
        }

        // Surface low-confidence detection indicator (< 90% confidence) in design mode for review
        if (state.editorMode !== "fill" && typeof f.confidence === "number" && f.confidence < 0.90 && f.detectedBy !== "acroform" && f.sourcedFrom !== "acroform") {
            div.classList.add("low-confidence-field");
            const confBadge = document.createElement("span");
            confBadge.className = "field-confidence-badge";
            const pct = Math.round(f.confidence * 100);
            confBadge.title = `Review needed (${pct}% confidence). Please verify or adjust.`;
            confBadge.textContent = `⚠️ Review (${pct}%)`;
            div.appendChild(confBadge);
        }

        // Add non-blocking top-floating badge
        if (f.type !== "checkBox" && f.type !== "radioGroup") {
            const floatingBadge = document.createElement("span");
            floatingBadge.className = "field-floating-badge";
            floatingBadge.textContent = formatFieldDisplayName(f);
            div.appendChild(floatingBadge);
        }

        // 8 Interactive Corner & Edge Resize Handles on the Field Box Itself
        if (isSelected && !isMultiSelected && !f.locked) {
            const resizeHandles = [
                { dir: "nw", className: "handle-nw", title: "Resize Top-Left" },
                { dir: "n",  className: "handle-n",  title: "Resize Top" },
                { dir: "ne", className: "handle-ne", title: "Resize Top-Right" },
                { dir: "e",  className: "handle-e",  title: "Resize Right" },
                { dir: "se", className: "handle-se", title: "Resize Bottom-Right" },
                { dir: "s",  className: "handle-s",  title: "Resize Bottom" },
                { dir: "sw", className: "handle-sw", title: "Resize Bottom-Left" },
                { dir: "w",  className: "handle-w",  title: "Resize Left" }
            ];

            resizeHandles.forEach(h => {
                const handle = document.createElement("div");
                handle.className = `resize-handle ${h.className}`;
                handle.title = h.title;
                handle.addEventListener("mousedown", e => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (handlers.onResizeStart) handlers.onResizeStart(e, f, h.dir);
                });
                handle.addEventListener("pointerdown", e => {
                    if (e.pointerType !== "touch") return;
                    e.stopPropagation();
                    e.preventDefault();
                    if (handlers.onResizeStart) handlers.onResizeStart(e, f, h.dir);
                    if (handle.setPointerCapture) handle.setPointerCapture(e.pointerId);
                });
                div.appendChild(handle);
            });
        }

        // Accessibility & Keyboard Navigation
        div.tabIndex = 0;
        div.setAttribute("role", f.type === "checkBox" ? "checkbox" : (f.type === "radioGroup" ? "radio" : (f.type === "dropdown" ? "combobox" : "textbox")));
        div.setAttribute("aria-label", f.name || "Form field");
        if (f.type === "checkBox") {
            div.setAttribute("aria-checked", f.defaultChecked ? "true" : "false");
        }

        div.addEventListener("focus", () => {
            if (!state.selectedFieldIds.has(f.id)) {
                state.selectedFieldIds.clear();
                state.selectedFieldIds.add(f.id);
                renderOverlays(handlers);
                if (handlers.onSelect) handlers.onSelect(f);
            }
        });

        // Canvas ↔ Layer Hover Sync
        div.addEventListener("mouseenter", () => {
            const layerItem = document.querySelector(`.layer-item[data-field-id="${f.id}"]`);
            if (layerItem) layerItem.classList.add("canvas-hover-highlight");
        });
        div.addEventListener("mouseleave", () => {
            const layerItem = document.querySelector(`.layer-item[data-field-id="${f.id}"]`);
            if (layerItem) layerItem.classList.remove("canvas-hover-highlight");
        });

        div.addEventListener("dblclick", e => {
            e.stopPropagation();
            if (f.locked || f.hidden) return;
            if (f.type === "signature" && !f.signatureImage) {
                openSignatureModal(f, () => {
                    renderOverlays(handlers);
                    if (handlers.onUpdated) handlers.onUpdated(f);
                });
            } else {
                startInlineTextEdit(f.id, handlers);
            }
        });

        div.addEventListener("keydown", async e => {
            if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                const activeFields = sortFieldsByReadingOrder(state.fields.filter(item => !item.hidden && !item.locked));
                if (activeFields.length === 0) return;
                const currentIdx = activeFields.findIndex(item => item.id === f.id);
                const nextIdx = currentIdx === -1
                    ? 0
                    : (e.shiftKey ? (currentIdx - 1 + activeFields.length) % activeFields.length : (currentIdx + 1) % activeFields.length);
                const targetField = activeFields[nextIdx];
                if (targetField) {
                    if (targetField.page && targetField.page !== state.currentPageNum) {
                        await goToPage(targetField.page, () => {
                            setSelectedField(targetField.id);
                            if (handlers?.onSelect) handlers.onSelect(targetField);
                            renderOverlays(handlers);
                            const targetEl = document.getElementById(`overlay_${targetField.id}`);
                            if (targetEl) targetEl.focus();
                        });
                    } else {
                        setSelectedField(targetField.id);
                        if (handlers?.onSelect) handlers.onSelect(targetField);
                        renderOverlays(handlers);
                        const targetEl = document.getElementById(`overlay_${targetField.id}`);
                        if (targetEl) targetEl.focus();
                    }
                }
            } else if (e.key === "Enter" && !f.locked && !f.hidden) {
                e.preventDefault();
                if (f.type === "signature" && !f.signatureImage) {
                    openSignatureModal(f, () => {
                        renderOverlays(handlers);
                        if (handlers.onUpdated) handlers.onUpdated(f);
                    });
                } else {
                    startInlineTextEdit(f.id, handlers);
                }
            } else if (e.key === " ") {
                if (f.type === "checkBox") {
                    e.preventDefault();
                    toggleCheckboxField(f, undefined, state.fields);
                    saveHistory(true, "Toggle Checkbox");
                    renderOverlays(handlers);
                    if (handlers.onUpdated) handlers.onUpdated(f);
                } else if (f.type === "radioGroup" || f.type === "radio") {
                    e.preventDefault();
                    selectRadioOption(f, state.fields);
                    renderOverlays(handlers);
                    if (handlers.onUpdated) handlers.onUpdated(f);
                }
            }
        });

        div.addEventListener("mousedown", e => {
            if (handlers.onFieldMouseDown) handlers.onFieldMouseDown(e, f);
        });
        div.addEventListener("pointerdown", e => {
            if (e.pointerType !== "touch") return;
            if (handlers.onFieldMouseDown) handlers.onFieldMouseDown(e, f);
            if (div.setPointerCapture) div.setPointerCapture(e.pointerId);
        });

        container.appendChild(div);
    });

    // Multi-Selection Bounding Frame with unified Figma/Canva-style resize handles
    const selectedFieldsOnPage = pageFields.filter(f => state.selectedFieldIds.has(f.id));
    if (state.editorMode !== "fill" && selectedFieldsOnPage.length > 1) {
        const minX = Math.min(...selectedFieldsOnPage.map(f => f.x));
        const minY = Math.min(...selectedFieldsOnPage.map(f => f.y));
        const maxX = Math.max(...selectedFieldsOnPage.map(f => f.x + f.width));
        const maxY = Math.max(...selectedFieldsOnPage.map(f => f.y + f.height));

        const groupFrame = document.createElement("div");
        groupFrame.className = "multi-selection-bounding-frame";
        groupFrame.style.left = (minX - 3) + "px";
        groupFrame.style.top = (minY - 3) + "px";
        groupFrame.style.width = (maxX - minX + 6) + "px";
        groupFrame.style.height = (maxY - minY + 6) + "px";

        const handles = [
            { dir: "se", cursor: "se-resize", style: "bottom: -4px; right: -4px;" },
            { dir: "e", cursor: "ew-resize", style: "top: calc(50% - 3.75px); right: -4px;" },
            { dir: "s", cursor: "ns-resize", style: "bottom: -4px; left: calc(50% - 3.75px);" }
        ];

        handles.forEach(h => {
            const handleEl = document.createElement("div");
            handleEl.className = `group-resize-handle group-handle-${h.dir}`;
            handleEl.style.cssText = h.style;
            handleEl.title = `Drag to resize all selected fields (${h.dir === 'e' ? 'Width' : h.dir === 's' ? 'Height' : 'Width & Height'})`;
            handleEl.addEventListener("mousedown", e => {
                e.stopPropagation();
                if (handlers.onResizeStart) {
                    const anchorField = selectedFieldsOnPage.find(f => f.id === state.lastSelectedFieldId) || selectedFieldsOnPage[0];
                    handlers.onResizeStart(e, anchorField, h.dir);
                }
            });
            groupFrame.appendChild(handleEl);
        });

        container.appendChild(groupFrame);
    }

    // Contextual Floating Quick-Actions Bar (Chapter 11 - Sovereign Posture & Modeless Action)
    if (state.editorMode !== "fill" && selectedFieldsOnPage.length > 0) {
        renderContextualQuickBar(container, selectedFieldsOnPage, handlers);
    }
}

export function renderContextualQuickBar(container, selectedFieldsOnPage, handlers) {
    if (!container || !selectedFieldsOnPage || selectedFieldsOnPage.length === 0) return;

    const minX = Math.min(...selectedFieldsOnPage.map(f => f.x));
    const minY = Math.min(...selectedFieldsOnPage.map(f => f.y));
    const maxX = Math.max(...selectedFieldsOnPage.map(f => f.x + f.width));
    const maxY = Math.max(...selectedFieldsOnPage.map(f => f.y + f.height));

    const centerX = Math.round((minX + maxX) / 2);
    let topY = minY - 38;
    if (topY < 6) {
        topY = maxY + 10;
    }

    const bar = document.createElement("div");
    bar.className = "contextual-quick-bar";
    bar.id = "contextualQuickBar";
    bar.style.left = centerX + "px";
    bar.style.top = topY + "px";

    bar.addEventListener("mousedown", e => e.stopPropagation());
    bar.addEventListener("click", e => e.stopPropagation());

    const isMulti = selectedFieldsOnPage.length > 1;
    const primaryField = selectedFieldsOnPage[0];

    // 1. Duplicate Button [⌘D]
    const dupBtn = document.createElement("button");
    dupBtn.className = "quick-bar-btn";
    dupBtn.title = isMulti ? "Duplicate Selection (⌘D)" : "Duplicate (⌘D)";
    dupBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Duplicate</span>`;
    dupBtn.addEventListener("click", e => {
        e.stopPropagation();
        duplicateSelectedFields();
        saveHistory(true, "Duplicate Field");
        if (handlers?.onUpdated) handlers.onUpdated();
        else renderOverlays(handlers);
    });
    bar.appendChild(dupBtn);

    // 2. Delete Button [⌫]
    const delBtn = document.createElement("button");
    delBtn.className = "quick-bar-btn quick-bar-btn-danger";
    delBtn.title = "Delete (⌫)";
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;
    delBtn.addEventListener("click", e => {
        e.stopPropagation();
        if (handlers?.onDelete) {
            handlers.onDelete();
        } else {
            const idsToDelete = new Set(selectedFieldsOnPage.map(f => f.id));
            state.fields = state.fields.filter(f => !idsToDelete.has(f.id));
            state.selectedFieldIds.clear();
            state.selectedField = null;
            saveHistory(true, "Delete Field");
            if (handlers?.onUpdated) handlers.onUpdated();
            else renderOverlays(handlers);
        }
    });
    bar.appendChild(delBtn);

    // Divider
    const div1 = document.createElement("div");
    div1.className = "quick-bar-divider";
    bar.appendChild(div1);

    if (!isMulti) {
        // Single Field Specifics: Required Toggle & Lock Toggle
        const isTextCapable = primaryField.type === "staticText" || primaryField.type === "textField" || primaryField.type === "label" || primaryField.type === "dropdown" || primaryField.type === "dateField" || primaryField.type === "date";
        if (isTextCapable) {
            // Bold Toggle
            const isBold = primaryField.fontWeight === "bold" || primaryField.fontWeight === "700" || primaryField.fontWeight >= 700;
            const boldBtn = document.createElement("button");
            boldBtn.className = "quick-bar-btn" + (isBold ? " active" : "");
            boldBtn.title = isBold ? "Unbold (⌘B)" : "Bold (⌘B)";
            boldBtn.innerHTML = `<b style="font-size: 12px; font-weight: 800;">B</b>`;
            boldBtn.addEventListener("click", e => {
                e.stopPropagation();
                primaryField.fontWeight = isBold ? "normal" : "bold";
                saveHistory(true, isBold ? "Remove Bold" : "Apply Bold");
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(boldBtn);

            // Italic Toggle
            const isItalic = primaryField.fontStyle === "italic";
            const italicBtn = document.createElement("button");
            italicBtn.className = "quick-bar-btn" + (isItalic ? " active" : "");
            italicBtn.title = isItalic ? "Remove Italic (⌘I)" : "Italicize (⌘I)";
            italicBtn.innerHTML = `<i style="font-size: 12px; font-style: italic; font-weight: 700; font-family: Georgia, serif;">I</i>`;
            italicBtn.addEventListener("click", e => {
                e.stopPropagation();
                primaryField.fontStyle = isItalic ? "normal" : "italic";
                saveHistory(true, isItalic ? "Remove Italic" : "Apply Italic");
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(italicBtn);
        }

        if (primaryField.type === "staticText") {
            // Bullet List Toggle
            const bulletBtn = document.createElement("button");
            bulletBtn.className = "quick-bar-btn";
            bulletBtn.title = "Toggle Bullet List (•)";
            bulletBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="4" cy="6" r="2" fill="currentColor"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="4" cy="18" r="2" fill="currentColor"/><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/></svg><span>• List</span>`;
            bulletBtn.addEventListener("click", e => {
                e.stopPropagation();
                const cur = primaryField.defaultValue || primaryField.label || "";
                const formatted = toggleListFormat(cur, "bullet");
                primaryField.defaultValue = formatted;
                primaryField.label = formatted;
                saveHistory(true, "Toggle Bullet List");
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(bulletBtn);

            // Numbered List Toggle
            const numBtn = document.createElement("button");
            numBtn.className = "quick-bar-btn";
            numBtn.title = "Toggle Numbered List (1. 2. 3.)";
            numBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 6h1v4M4 10h2M4 14h2l-2 2h2M4 18h2"/><line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="17" x2="20" y2="17"/></svg><span>1. List</span>`;
            numBtn.addEventListener("click", e => {
                e.stopPropagation();
                const cur = primaryField.defaultValue || primaryField.label || "";
                const formatted = toggleListFormat(cur, "number");
                primaryField.defaultValue = formatted;
                primaryField.label = formatted;
                saveHistory(true, "Toggle Numbered List");
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(numBtn);

            // Text Alignment Cycle
            const align = primaryField.textAlignment || "left";
            const alignBtn = document.createElement("button");
            alignBtn.className = "quick-bar-btn";
            alignBtn.title = `Text Alignment: ${align.toUpperCase()} (Click to Cycle)`;
            alignBtn.innerHTML = align === "center"
                ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg><span>Center</span>`
                : (align === "right"
                    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="20" y2="18"/></svg><span>Right</span>`
                    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg><span>Left</span>`);
            alignBtn.addEventListener("click", e => {
                e.stopPropagation();
                const nextAlign = align === "left" ? "center" : (align === "center" ? "right" : "left");
                primaryField.textAlignment = nextAlign;
                saveHistory(true, `Align Text ${nextAlign}`);
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(alignBtn);
        } else {
            const reqBtn = document.createElement("button");
            reqBtn.className = "quick-bar-btn" + (primaryField.required ? " active" : "");
            reqBtn.title = "Toggle Required (*)";
            reqBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="req-icon"><path d="M12 6v12m5.2-9-10.4 6m0-6 10.4 6"/></svg><span>Required</span>`;
            reqBtn.addEventListener("click", e => {
                e.stopPropagation();
                primaryField.required = !primaryField.required;
                saveHistory(true, primaryField.required ? "Make Required" : "Make Optional");
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(reqBtn);
        }

        if (primaryField.type === "checkBox") {
            const isCross = primaryField.checkboxMark === "x";
            const markBtn = document.createElement("button");
            markBtn.className = "quick-bar-btn" + (isCross ? " active" : "");
            markBtn.title = isCross ? "Switch Checkbox to Tick (✓)" : "Switch Checkbox to Cross (✕)";
            markBtn.innerHTML = isCross
                ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span>Mark: ✕</span>`
                : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Mark: ✓</span>`;
            markBtn.addEventListener("click", e => {
                e.stopPropagation();
                primaryField.checkboxMark = isCross ? "check" : "x";
                saveHistory(true, `Switch Checkbox to ${primaryField.checkboxMark === "x" ? "Cross (X)" : "Tick (✓)"}`);
                if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                else renderOverlays(handlers);
            });
            bar.appendChild(markBtn);
        }

        // Table Grid specific row & col controls (+ Row, − Row, + Col, − Col, 🗑️ Table)
        if (primaryField.tableId) {
            const addRowBtn = document.createElement("button");
            addRowBtn.className = "quick-bar-btn quick-bar-btn-accent";
            addRowBtn.title = "Insert Row to Table Below";
            addRowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg><span>+ Row</span>`;
            addRowBtn.addEventListener("click", e => {
                e.stopPropagation();
                const newCells = addRowToTable(primaryField.tableId, state.fields || []);
                if (newCells.length > 0) {
                    state.fields.push(...newCells);
                    setSelectedFields(newCells.map(c => c.id));
                    saveHistory(true, "Add Table Row");
                    if (handlers?.onUpdated) handlers.onUpdated();
                    else renderOverlays(handlers);
                }
            });
            bar.appendChild(addRowBtn);

            const delRowBtn = document.createElement("button");
            delRowBtn.className = "quick-bar-btn quick-bar-btn-danger";
            delRowBtn.title = "Delete Row from Table";
            delRowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="15" x2="15" y2="15"/></svg><span>− Row</span>`;
            delRowBtn.addEventListener("click", e => {
                e.stopPropagation();
                const targetRow = primaryField.tableRole === "cell" ? primaryField.tableRow : undefined;
                const tableCells = (state.fields || []).filter(f => f.tableId === primaryField.tableId && f.tableRole === "cell");
                const rowToDelete = targetRow || Math.max(...tableCells.map(f => f.tableRow || 1));
                const { updatedFields } = removeRowFromTable(primaryField.tableId, rowToDelete, state.fields || []);
                state.fields = updatedFields;
                setSelectedField(null);
                saveHistory(true, "Delete Table Row");
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(delRowBtn);

            const addColBtn = document.createElement("button");
            addColBtn.className = "quick-bar-btn quick-bar-btn-accent";
            addColBtn.title = "Insert Column to Table Right";
            addColBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="12" y1="12" x2="18" y2="12"/><line x1="15" y1="9" x2="15" y2="15"/></svg><span>+ Col</span>`;
            addColBtn.addEventListener("click", e => {
                e.stopPropagation();
                const newCols = addColumnToTable(primaryField.tableId, state.fields || []);
                if (newCols.length > 0) {
                    state.fields.push(...newCols);
                    setSelectedFields(newCols.map(c => c.id));
                    saveHistory(true, "Add Table Column");
                    if (handlers?.onUpdated) handlers.onUpdated();
                    else renderOverlays(handlers);
                }
            });
            bar.appendChild(addColBtn);

            const delColBtn = document.createElement("button");
            delColBtn.className = "quick-bar-btn quick-bar-btn-danger";
            delColBtn.title = "Delete Column from Table";
            delColBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="12" y1="12" x2="18" y2="12"/></svg><span>− Col</span>`;
            delColBtn.addEventListener("click", e => {
                e.stopPropagation();
                const targetCol = primaryField.tableCol !== undefined ? primaryField.tableCol : 0;
                const { updatedFields } = removeColumnFromTable(primaryField.tableId, targetCol, state.fields || []);
                state.fields = updatedFields;
                setSelectedField(null);
                saveHistory(true, "Delete Table Column");
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(delColBtn);

            const delTableBtn = document.createElement("button");
            delTableBtn.className = "quick-bar-btn quick-bar-btn-danger";
            delTableBtn.title = "Delete Entire Table";
            delTableBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Delete Table</span>`;
            delTableBtn.addEventListener("click", e => {
                e.stopPropagation();
                const { updatedFields } = deleteTable(primaryField.tableId, state.fields || []);
                state.fields = updatedFields;
                setSelectedField(null);
                saveHistory(true, "Delete Table");
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(delTableBtn);
        }

        const lockBtn = document.createElement("button");
        lockBtn.className = "quick-bar-btn" + (primaryField.locked ? " active" : "");
        lockBtn.title = primaryField.locked ? "Unlock Field" : "Lock Field";
        lockBtn.innerHTML = primaryField.locked
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
        lockBtn.addEventListener("click", e => {
            e.stopPropagation();
            primaryField.locked = !primaryField.locked;
            saveHistory(true, primaryField.locked ? "Lock Field" : "Unlock Field");
            if (handlers?.onUpdated) handlers.onUpdated(primaryField);
            else renderOverlays(handlers);
        });
        bar.appendChild(lockBtn);

        // Fill Down Column quick action if field has formula and siblings exist below
        if (primaryField.calculationType && primaryField.calculationType !== "none") {
            const siblings = getVerticallyAlignedColumnSiblings(primaryField, state.fields || []);
            if (siblings.length > 0) {
                const fillDownBtn = document.createElement("button");
                fillDownBtn.className = "quick-bar-btn quick-bar-btn-accent";
                fillDownBtn.title = `Fill formula down column (${siblings.length} row${siblings.length > 1 ? "s" : ""})`;
                fillDownBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M4 21h16"/></svg><span>Fill Down (↓${siblings.length})</span>`;

                fillDownBtn.addEventListener("mouseenter", () => {
                    siblings.forEach(s => {
                        const ov = document.getElementById(`field-${s.id}`);
                        if (ov) ov.classList.add("calc-fill-down-preview");
                    });
                });
                fillDownBtn.addEventListener("mouseleave", () => {
                    document.querySelectorAll(".calc-fill-down-preview").forEach(el => el.classList.remove("calc-fill-down-preview"));
                });
                fillDownBtn.addEventListener("click", e => {
                    e.stopPropagation();
                    document.querySelectorAll(".calc-fill-down-preview").forEach(el => el.classList.remove("calc-fill-down-preview"));
                    fillFormulaDownColumn(primaryField, state.fields || []);
                    saveHistory(true, `Fill Formula Down Column (${siblings.length} rows)`);
                    if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                    else renderOverlays(handlers);
                });
                bar.appendChild(fillDownBtn);
            }
        } else if (state.formulaClipboard) {
            // Paste formula recipe quick button
            const pasteFormulaBtn = document.createElement("button");
            pasteFormulaBtn.className = "quick-bar-btn quick-bar-btn-accent";
            pasteFormulaBtn.title = "Paste copied formula recipe to this field";
            pasteFormulaBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg><span>Paste Formula</span>`;
            pasteFormulaBtn.addEventListener("click", e => {
                e.stopPropagation();
                const count = pasteFormulaRecipeToFields([primaryField], state.fields || []);
                if (count > 0) {
                    saveHistory(true, "Paste Formula Recipe");
                    if (handlers?.onUpdated) handlers.onUpdated(primaryField);
                    else renderOverlays(handlers);
                }
            });
            bar.appendChild(pasteFormulaBtn);
        }
    } else {
        // Multi-Select Specifics: Group/Ungroup & Distribute Spacing (for >= 3)
        const allSameGroup = selectedFieldsOnPage.every(f => f.groupId && f.groupId === selectedFieldsOnPage[0].groupId);
        const grpBtn = document.createElement("button");
        grpBtn.className = "quick-bar-btn" + (allSameGroup ? " active" : "");
        grpBtn.title = allSameGroup ? "Ungroup (⌘G)" : "Group (⌘G)";
        grpBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg><span>${allSameGroup ? "Ungroup" : "Group"}</span>`;
        grpBtn.addEventListener("click", e => {
            e.stopPropagation();
            if (allSameGroup) ungroupSelected();
            else createGroupForSelected();
            saveHistory(true, allSameGroup ? "Ungroup Fields" : "Group Fields");
            if (handlers?.onUpdated) handlers.onUpdated();
            else renderOverlays(handlers);
        });
        bar.appendChild(grpBtn);

        // Checkbox Specific Quick Action: Toggle Mark Style (Tick ✓ ⇄ Cross ✕)
        const checkboxFields = selectedFieldsOnPage.filter(f => f.type === "checkBox");
        if (checkboxFields.length > 0) {
            const allCross = checkboxFields.every(f => f.checkboxMark === "x");
            const markBtn = document.createElement("button");
            markBtn.className = "quick-bar-btn" + (allCross ? " active" : "");
            markBtn.title = allCross ? "Switch Checkboxes to Tick (✓)" : "Switch Checkboxes to Cross (✕)";
            markBtn.innerHTML = allCross
                ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span>Mark: ✕</span>`
                : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Mark: ✓</span>`;
            markBtn.addEventListener("click", e => {
                e.stopPropagation();
                const nextMark = allCross ? "check" : "x";
                checkboxFields.forEach(f => f.checkboxMark = nextMark);
                saveHistory(true, `Switch Checkboxes to ${nextMark === "x" ? "Cross (X)" : "Tick (✓)"}`);
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(markBtn);
        }

        // Multi-select Paste Formula Recipe if formula clipboard is active
        if (state.formulaClipboard) {
            const pasteFormulaBtn = document.createElement("button");
            pasteFormulaBtn.className = "quick-bar-btn quick-bar-btn-accent";
            pasteFormulaBtn.title = `Paste copied formula recipe to ${selectedFieldsOnPage.length} selected fields`;
            pasteFormulaBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg><span>Paste Formula (${selectedFieldsOnPage.length})</span>`;
            pasteFormulaBtn.addEventListener("click", e => {
                e.stopPropagation();
                const count = pasteFormulaRecipeToFields(selectedFieldsOnPage, state.fields || []);
                if (count > 0) {
                    saveHistory(true, `Paste Formula Recipe (${count} fields)`);
                    if (handlers?.onUpdated) handlers.onUpdated();
                    else renderOverlays(handlers);
                }
            });
            bar.appendChild(pasteFormulaBtn);
        }

        const tableField = selectedFieldsOnPage.find(f => f.tableId);
        if (tableField) {
            const addRowBtn = document.createElement("button");
            addRowBtn.className = "quick-bar-btn quick-bar-btn-accent";
            addRowBtn.title = "Insert Row to Table Below";
            addRowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg><span>+ Row</span>`;
            addRowBtn.addEventListener("click", e => {
                e.stopPropagation();
                const newCells = addRowToTable(tableField.tableId, state.fields || []);
                if (newCells.length > 0) {
                    state.fields.push(...newCells);
                    setSelectedFields(newCells.map(c => c.id));
                    saveHistory(true, "Add Table Row");
                    if (handlers?.onUpdated) handlers.onUpdated();
                    else renderOverlays(handlers);
                }
            });
            bar.appendChild(addRowBtn);

            const delRowBtn = document.createElement("button");
            delRowBtn.className = "quick-bar-btn quick-bar-btn-danger";
            delRowBtn.title = "Delete Row from Table";
            delRowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="15" x2="15" y2="15"/></svg><span>− Row</span>`;
            delRowBtn.addEventListener("click", e => {
                e.stopPropagation();
                const targetRow = tableField.tableRole === "cell" ? tableField.tableRow : undefined;
                const tableCells = (state.fields || []).filter(f => f.tableId === tableField.tableId && f.tableRole === "cell");
                const rowToDelete = targetRow || Math.max(...tableCells.map(f => f.tableRow || 1));
                const { updatedFields } = removeRowFromTable(tableField.tableId, rowToDelete, state.fields || []);
                state.fields = updatedFields;
                setSelectedField(null);
                saveHistory(true, "Delete Table Row");
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(delRowBtn);

            const addColBtn = document.createElement("button");
            addColBtn.className = "quick-bar-btn quick-bar-btn-accent";
            addColBtn.title = "Insert Column to Table Right";
            addColBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="12" y1="12" x2="18" y2="12"/><line x1="15" y1="9" x2="15" y2="15"/></svg><span>+ Col</span>`;
            addColBtn.addEventListener("click", e => {
                e.stopPropagation();
                const newCols = addColumnToTable(tableField.tableId, state.fields || []);
                if (newCols.length > 0) {
                    state.fields.push(...newCols);
                    setSelectedFields(newCols.map(c => c.id));
                    saveHistory(true, "Add Table Column");
                    if (handlers?.onUpdated) handlers.onUpdated();
                    else renderOverlays(handlers);
                }
            });
            bar.appendChild(addColBtn);

            const delColBtn = document.createElement("button");
            delColBtn.className = "quick-bar-btn quick-bar-btn-danger";
            delColBtn.title = "Delete Column from Table";
            delColBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="12" y1="12" x2="18" y2="12"/></svg><span>− Col</span>`;
            delColBtn.addEventListener("click", e => {
                e.stopPropagation();
                const targetCol = tableField.tableCol !== undefined ? tableField.tableCol : 0;
                const { updatedFields } = removeColumnFromTable(tableField.tableId, targetCol, state.fields || []);
                state.fields = updatedFields;
                setSelectedField(null);
                saveHistory(true, "Delete Table Column");
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(delColBtn);

            const delTableBtn = document.createElement("button");
            delTableBtn.className = "quick-bar-btn quick-bar-btn-danger";
            delTableBtn.title = "Delete Entire Table";
            delTableBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Delete Table</span>`;
            delTableBtn.addEventListener("click", e => {
                e.stopPropagation();
                const { updatedFields } = deleteTable(tableField.tableId, state.fields || []);
                state.fields = updatedFields;
                setSelectedField(null);
                saveHistory(true, "Delete Table");
                if (handlers?.onUpdated) handlers.onUpdated();
                else renderOverlays(handlers);
            });
            bar.appendChild(delTableBtn);
        }

        if (selectedFieldsOnPage.length >= 3) {
            const div2 = document.createElement("div");
            div2.className = "quick-bar-divider";
            bar.appendChild(div2);

            const distVBtn = document.createElement("button");
            distVBtn.className = "quick-bar-btn";
            distVBtn.title = "Distribute Vertical Gaps";
            distVBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="4" x="4" y="2" rx="1"/><rect width="16" height="4" x="4" y="10" rx="1"/><rect width="16" height="4" x="4" y="18" rx="1"/></svg><span>Distribute V</span>`;
            distVBtn.addEventListener("click", e => {
                e.stopPropagation();
                distributeSelectedFields("vertical", handlers?.onUpdated);
            });
            bar.appendChild(distVBtn);

            const distHBtn = document.createElement("button");
            distHBtn.className = "quick-bar-btn";
            distHBtn.title = "Distribute Horizontal Gaps";
            distHBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="4" height="16" x="2" y="4" rx="1"/><rect width="4" height="16" x="10" y="4" rx="1"/><rect width="4" height="16" x="18" y="4" rx="1"/></svg><span>Distribute H</span>`;
            distHBtn.addEventListener("click", e => {
                e.stopPropagation();
                distributeSelectedFields("horizontal", handlers?.onUpdated);
            });
            bar.appendChild(distHBtn);
        }
    }

    container.appendChild(bar);
    positionContextualQuickBar(bar, minX, maxX, minY, maxY);
}

function positionContextualQuickBar(bar, minX, maxX, minY, maxY) {
    if (!bar) return;
    const pageWidth = (state.pdfViewport && state.pdfViewport.width) ? state.pdfViewport.width : 595.28;
    const centerX = Math.round((minX + maxX) / 2);
    let topY = minY - 38;
    const isBelow = topY < 6;
    if (isBelow) {
        topY = maxY + 10;
    }
    if (bar.dataset) {
        bar.dataset.placement = isBelow ? "below" : "above";
    }

    const barWidth = bar.offsetWidth || 0;
    let finalX = centerX;
    if (barWidth > 0) {
        const halfWidth = barWidth / 2;
        const minCenter = halfWidth + 8;
        const maxCenter = Math.max(minCenter, pageWidth - halfWidth - 8);
        finalX = Math.min(Math.max(centerX, minCenter), maxCenter);
    }

    bar.style.left = Math.round(finalX) + "px";
    bar.style.top = Math.round(topY) + "px";
}

export function updateOverlayPositionsDirectly() {
    const pageFields = getFieldsForCurrentPage();
    
    state.selectedFieldIds.forEach(id => {
        const f = pageFields.find(item => item.id === id);
        if (f) {
            const overlayEl = document.getElementById(`overlay_${f.id}`);
            if (overlayEl) {
                overlayEl.style.left = f.x + "px";
                overlayEl.style.top = f.y + "px";
                overlayEl.style.width = f.width + "px";
                overlayEl.style.height = f.height + "px";
            }
        }
    });

    const selectedFieldsOnPage = pageFields.filter(f => state.selectedFieldIds.has(f.id));
    if (selectedFieldsOnPage.length > 0) {
        const minX = Math.min(...selectedFieldsOnPage.map(f => f.x));
        const minY = Math.min(...selectedFieldsOnPage.map(f => f.y));
        const maxX = Math.max(...selectedFieldsOnPage.map(f => f.x + f.width));
        const maxY = Math.max(...selectedFieldsOnPage.map(f => f.y + f.height));

        if (selectedFieldsOnPage.length > 1) {
            const frame = document.querySelector(".multi-selection-bounding-frame");
            if (frame) {
                frame.style.left = (minX - 3) + "px";
                frame.style.top = (minY - 3) + "px";
                frame.style.width = (maxX - minX + 6) + "px";
                frame.style.height = (maxY - minY + 6) + "px";
            }
        }

        const quickBar = document.getElementById("contextualQuickBar");
        if (quickBar) {
            positionContextualQuickBar(quickBar, minX, maxX, minY, maxY);
        }
    }

    if (isPickingCalcField && typeof updateCanvasPickModeUI === "function") {
        updateCanvasPickModeUI();
    }
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function plainTextToHtml(text) {
    if (!text) return "";
    const lines = String(text).split(/\r?\n/);
    let html = "";
    let inUl = false;
    let inOl = false;
    for (const line of lines) {
        const bulletMatch = line.match(/^([•·◦▪\-*])\s*(.*)$/);
        const numMatch = line.match(/^(\d+)[\.\)]\s*(.*)$/);
        if (bulletMatch) {
            if (inOl) { html += "</ol>"; inOl = false; }
            if (!inUl) { html += "<ul>"; inUl = true; }
            html += `<li>${escapeHtml(bulletMatch[2])}</li>`;
        } else if (numMatch) {
            if (inUl) { html += "</ul>"; inUl = false; }
            if (!inOl) { html += "<ol>"; inOl = true; }
            html += `<li>${escapeHtml(numMatch[2])}</li>`;
        } else {
            if (inUl) { html += "</ul>"; inUl = false; }
            if (inOl) { html += "</ol>"; inOl = false; }
            if (line.trim() === "") {
                html += "<div><br></div>";
            } else {
                html += `<div>${escapeHtml(line)}</div>`;
            }
        }
    }
    if (inUl) html += "</ul>";
    if (inOl) html += "</ol>";
    return html || escapeHtml(text);
}

function htmlToPlainText(element) {
    if (!element) return "";
    const lis = element.querySelectorAll ? element.querySelectorAll("li") : [];
    if (lis && lis.length > 0) {
        const lines = [];
        const processNode = (node) => {
            if (node.nodeType === 3) {
                const t = node.textContent;
                if (t && t.trim() && node.parentElement === element) lines.push(t.trim());
            } else if (node.nodeName === "LI") {
                const parent = node.parentElement;
                const isOrdered = parent && parent.nodeName === "OL";
                const index = Array.from(parent?.children || []).indexOf(node) + 1;
                const prefix = isOrdered ? `${index}. ` : "• ";
                lines.push(prefix + (node.textContent || "").trim());
            } else if (node.nodeName === "DIV" || node.nodeName === "P" || /^H[1-6]$/.test(node.nodeName)) {
                if (!node.querySelector("li")) {
                    const text = (node.textContent || "").trim();
                    if (text) lines.push(text);
                } else {
                    Array.from(node.childNodes).forEach(processNode);
                }
            } else if (node.childNodes && node.childNodes.length > 0) {
                Array.from(node.childNodes).forEach(processNode);
            }
        };
        Array.from(element.childNodes).forEach(processNode);
        if (lines.length > 0) return lines.join("\n");
    }

    if (typeof element.innerText === "string" && element.innerText.trim()) {
        return element.innerText.trim();
    }
    let html = element.innerHTML || "";
    html = html.replace(/<li[^>]*>(.*?)<\/li>/gi, "• $1\n");
    html = html.replace(/<br\s*[\/]?>/gi, "\n");
    html = html.replace(/<\/p>/gi, "\n");
    html = html.replace(/<\/div>/gi, "\n");
    html = html.replace(/<[^>]+>/g, "");
    return html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

export function startInlineTextEdit(fieldId, handlers = {}) {
    const field = state.fields.find(f => f.id === fieldId);
    if (!field || field.locked || field.hidden) return;

    if (field.type === "checkBox") {
        toggleCheckboxField(field, undefined, state.fields);
        saveHistory(true, "Toggle Checkbox");
        if (handlers?.onUpdated) handlers.onUpdated(field);
        renderOverlays(handlers);
        return;
    }

    if (field.type === "radioGroup" || field.type === "radio") {
        selectRadioOption(field, state.fields);
        saveHistory(true, "Select Radio Option");
        if (handlers?.onUpdated) handlers.onUpdated(field);
        renderOverlays(handlers);
        return;
    }

    if (field.type === "signature") {
        openSignatureModal(field, () => {
            saveHistory(true);
            if (handlers?.onUpdated) handlers.onUpdated(field);
            renderOverlays(handlers);
        });
        return;
    }

    const overlay = document.querySelector(`.field-overlay[data-id="${fieldId}"]`) || document.getElementById(`overlay_${fieldId}`);
    if (!overlay) return;

    const existing = overlay.querySelector(".inline-text-editor, .inline-field-input, .wp-editable");
    if (existing) {
        existing.focus();
        return;
    }

    overlay.classList.add("is-editing-text");
    const label = overlay.querySelector(".overlay-label");
    if (label) label.style.display = "none";

    const isStatic = field.type === "staticText";

    if (isStatic) {
        const { fam, weight, style: fontStyle } = getFieldCssFont(field);
        const fontSize = Number(field.fontSize) || 16;

        // ── Word Processor Container ─────────────────────────────────
        const wpContainer = document.createElement("div");
        wpContainer.className = "wp-editor-container";

        // ── Floating Format Toolbar ──────────────────────────────────
        const toolbar = document.createElement("div");
        toolbar.className = "wp-format-toolbar";
        if (field.y < 46) {
            toolbar.style.bottom = "auto";
            toolbar.style.top = "calc(100% + 6px)";
        }
        if (field.tableId) {
            toolbar.style.left = "50%";
            toolbar.style.transform = "translateX(-50%)";
        }
        toolbar.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); });

        // -- Heading / Paragraph Selector --
        const headingSelect = document.createElement("select");
        headingSelect.className = "wp-tb-select";
        headingSelect.title = "Text style";
        [
            { val: "p", label: "Paragraph" },
            { val: "h1", label: "Heading 1" },
            { val: "h2", label: "Heading 2" },
            { val: "h3", label: "Heading 3" },
        ].forEach(opt => {
            const o = document.createElement("option");
            o.value = opt.val;
            o.textContent = opt.label;
            headingSelect.appendChild(o);
        });
        // Set initial heading level based on field state
        if (field.fontSize >= 22 && field.fontWeight === "bold") headingSelect.value = "h1";
        else if (field.fontSize >= 16 && field.fontWeight === "bold") headingSelect.value = "h2";
        else if (field.fontSize >= 14 && (field.fontWeight === "bold" || field.fontWeight === "600")) headingSelect.value = "h3";
        else headingSelect.value = "p";

        headingSelect.addEventListener("change", () => {
            editable.focus();
            const tag = headingSelect.value;
            if (tag === "p") {
                document.execCommand("formatBlock", false, "p");
                field.fontSize = 14;
                field.fontWeight = "normal";
            } else if (tag === "h1") {
                document.execCommand("formatBlock", false, "h1");
                field.fontSize = 24;
                field.fontWeight = "bold";
            } else if (tag === "h2") {
                document.execCommand("formatBlock", false, "h2");
                field.fontSize = 18;
                field.fontWeight = "bold";
            } else if (tag === "h3") {
                document.execCommand("formatBlock", false, "h3");
                field.fontSize = 15;
                field.fontWeight = "600";
            }
            syncDimensions();
            syncFieldFromEditable();
        });
        toolbar.appendChild(headingSelect);

        // -- Divider --
        const div0 = document.createElement("div");
        div0.className = "wp-tb-divider";
        toolbar.appendChild(div0);

        // Helper: create toolbar button
        const makeBtn = (title, innerHTML, cmd, cmdArg) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "wp-tb-btn";
            btn.title = title;
            btn.innerHTML = innerHTML;
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                editable.focus();
                if (cmd) document.execCommand(cmd, false, cmdArg || null);
                updateToolbarState();
                syncFieldFromEditable();
            });
            return btn;
        };

        // -- Bold --
        const boldBtn = makeBtn("Bold (⌘B)", `<b style="font-size:13px;font-weight:800;">B</b>`, "bold");
        toolbar.appendChild(boldBtn);

        // -- Italic --
        const italicBtn = makeBtn("Italic (⌘I)", `<i style="font-size:13px;font-style:italic;font-family:Georgia,serif;font-weight:600;">I</i>`, "italic");
        toolbar.appendChild(italicBtn);

        // -- Underline --
        const underlineBtn = makeBtn("Underline (⌘U)", `<u style="font-size:13px;font-weight:600;">U</u>`, "underline");
        toolbar.appendChild(underlineBtn);

        // -- Strikethrough --
        const strikeBtn = makeBtn("Strikethrough", `<s style="font-size:13px;font-weight:500;">S</s>`, "strikethrough");
        toolbar.appendChild(strikeBtn);

        // -- Divider --
        const div1 = document.createElement("div");
        div1.className = "wp-tb-divider";
        toolbar.appendChild(div1);

        // -- Bullet List --
        const bulletBtn = makeBtn("Bullet List", `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="7" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="17" r="1.5" fill="currentColor"/><line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="17" x2="20" y2="17"/></svg>`, "insertUnorderedList");
        toolbar.appendChild(bulletBtn);

        // -- Numbered List --
        const numListBtn = makeBtn("Numbered List", `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="3" y="9" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="3" y="14.5" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="3" y="20" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">3</text><line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="17" x2="20" y2="17"/></svg>`, "insertOrderedList");
        toolbar.appendChild(numListBtn);

        // -- Divider --
        const div2 = document.createElement("div");
        div2.className = "wp-tb-divider";
        toolbar.appendChild(div2);

        // -- Alignment Cycle --
        const alignIcons = {
            left: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>`,
            center: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg>`,
            right: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="6" y1="18" x2="20" y2="18"/></svg>`,
        };
        let currentAlign = field.textAlignment || "left";
        const alignBtn = document.createElement("button");
        alignBtn.type = "button";
        alignBtn.className = "wp-tb-btn";
        alignBtn.title = `Align: ${currentAlign}`;
        alignBtn.innerHTML = alignIcons[currentAlign];
        alignBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            editable.focus();
            const cycle = { left: "center", center: "right", right: "left" };
            currentAlign = cycle[currentAlign] || "left";
            field.textAlignment = currentAlign;
            editable.style.textAlign = currentAlign;
            alignBtn.innerHTML = alignIcons[currentAlign];
            alignBtn.title = `Align: ${currentAlign}`;
            syncFieldFromEditable();
        });
        toolbar.appendChild(alignBtn);

        // -- Color Picker --
        const colorBtn = document.createElement("button");
        colorBtn.type = "button";
        colorBtn.className = "wp-tb-btn";
        colorBtn.title = "Text Color";
        colorBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16"/><path d="M6 16l6-12 6 12"/><path d="M8 12h8"/></svg>`;
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = field.color || "#1c1f26";
        colorInput.style.cssText = "position:absolute;opacity:0;width:0;height:0;pointer-events:none;";
        colorBtn.appendChild(colorInput);
        colorBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            colorInput.click();
        });
        colorInput.addEventListener("input", () => {
            editable.focus();
            document.execCommand("foreColor", false, colorInput.value);
            field.color = colorInput.value;
            syncFieldFromEditable();
        });
        toolbar.appendChild(colorBtn);

        wpContainer.appendChild(toolbar);

        // ── ContentEditable Area ─────────────────────────────────────
        const editable = document.createElement("div");
        editable.className = "wp-editable";
        editable.contentEditable = "true";
        editable.setAttribute("data-placeholder", "Type text, heading, or list...");
        editable.style.fontFamily = fam;
        editable.style.fontWeight = weight || "600";
        editable.style.fontStyle = fontStyle === "italic" ? "italic" : "normal";
        editable.style.fontSize = `${fontSize}px`;
        editable.style.textAlign = field.textAlignment || "left";
        editable.style.color = field.color || "#1c1f26";
        editable.style.lineHeight = "1.45";
        editable.spellcheck = true;

        // Convert existing plain text to HTML for the editable
        const existingText = field.defaultValue || field.label || "";
        if (existingText) {
            editable.innerHTML = plainTextToHtml(existingText);
        }

        wpContainer.appendChild(editable);

        // ── Dimension Syncing ────────────────────────────────────────
        const minH = Math.max(26, Math.round(fontSize * 1.5));
        const syncDimensions = () => {
            const contentH = Math.max(minH, editable.scrollHeight + 8);
            if (Math.abs(field.height - contentH) > 2) {
                field.height = contentH;
                overlay.style.height = `${contentH}px`;
            }
        };

        // ── Sync editable HTML → field model ─────────────────────────
        const syncFieldFromEditable = () => {
            const plainText = htmlToPlainText(editable);
            field.defaultValue = plainText;
            field.label = plainText;
            const propDef = document.getElementById("fieldDefaultValue");
            if (propDef && state.selectedFieldIds.has(field.id)) {
                propDef.value = plainText;
            }
            syncDimensions();
        };

        // ── Toolbar State Updater ────────────────────────────────────
        const updateToolbarState = () => {
            if (boldBtn && boldBtn.classList) {
                boldBtn.classList.toggle("active", document.queryCommandState("bold"));
            }
            if (italicBtn && italicBtn.classList) {
                italicBtn.classList.toggle("active", document.queryCommandState("italic"));
            }
            if (underlineBtn && underlineBtn.classList) {
                underlineBtn.classList.toggle("active", document.queryCommandState("underline"));
            }
            if (strikeBtn && strikeBtn.classList) {
                strikeBtn.classList.toggle("active", document.queryCommandState("strikethrough"));
            }
            if (bulletBtn && bulletBtn.classList) {
                bulletBtn.classList.toggle("active", document.queryCommandState("insertUnorderedList"));
            }
            if (numListBtn && numListBtn.classList) {
                numListBtn.classList.toggle("active", document.queryCommandState("insertOrderedList"));
            }
        };

        // ── Commit Edit ──────────────────────────────────────────────
        let committed = false;
        const commitEdit = (shouldSave = true) => {
            if (committed) return;
            committed = true;
            const plainText = htmlToPlainText(editable);

            // Discard empty text field
            if (!plainText.trim()) {
                const idx = state.fields.findIndex(f => f.id === field.id);
                if (idx !== -1) {
                    state.fields.splice(idx, 1);
                    state.selectedFieldIds.delete(field.id);
                }
                overlay.remove();
                if (shouldSave) saveHistory(true);
                if (handlers?.onUpdated) handlers.onUpdated(null);
                renderOverlays(handlers);
                return;
            }

            field.defaultValue = plainText;
            field.label = plainText;

            overlay.classList.remove("is-editing-text");
            wpContainer.remove();
            if (label) {
                label.style.display = "";
                label.textContent = plainText;
            }

            const propDef = document.getElementById("fieldDefaultValue");
            if (propDef && state.selectedFieldIds.has(field.id)) {
                propDef.value = plainText;
            }

            if (shouldSave) saveHistory(true);
            if (handlers?.onUpdated) handlers.onUpdated(field);
            renderOverlays(handlers);
        };

        // ── Event Listeners ──────────────────────────────────────────
        editable.addEventListener("input", (e) => {
            if (e.inputType === "insertText" && e.data === " ") {
                const sel = window.getSelection?.();
                if (sel && sel.anchorNode) {
                    const node = sel.anchorNode;
                    const text = node.textContent || "";
                    if (text === "# ") {
                        node.textContent = "";
                        document.execCommand("formatBlock", false, "h1");
                        field.fontSize = 24;
                        field.fontWeight = "bold";
                        if (headingSelect) headingSelect.value = "h1";
                    } else if (text === "## ") {
                        node.textContent = "";
                        document.execCommand("formatBlock", false, "h2");
                        field.fontSize = 18;
                        field.fontWeight = "bold";
                        if (headingSelect) headingSelect.value = "h2";
                    } else if (text === "### ") {
                        node.textContent = "";
                        document.execCommand("formatBlock", false, "h3");
                        field.fontSize = 15;
                        field.fontWeight = "600";
                        if (headingSelect) headingSelect.value = "h3";
                    } else if (text === "* " || text === "- ") {
                        node.textContent = "";
                        document.execCommand("insertUnorderedList", false, null);
                    } else if (/^\d+[\.\)]\s$/.test(text)) {
                        node.textContent = "";
                        document.execCommand("insertOrderedList", false, null);
                    }
                }
            }
            syncFieldFromEditable();
            updateToolbarState();
        });

        editable.addEventListener("keyup", () => {
            updateToolbarState();
        });

        editable.addEventListener("mouseup", () => {
            updateToolbarState();
        });

        editable.addEventListener("keydown", async (e) => {
            // Formatting shortcuts
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
                if (e.key === "b" || e.key === "B") {
                    e.preventDefault();
                    document.execCommand("bold", false, null);
                    updateToolbarState();
                    syncFieldFromEditable();
                    return;
                } else if (e.key === "i" || e.key === "I") {
                    e.preventDefault();
                    document.execCommand("italic", false, null);
                    updateToolbarState();
                    syncFieldFromEditable();
                    return;
                } else if (e.key === "u" || e.key === "U") {
                    e.preventDefault();
                    document.execCommand("underline", false, null);
                    updateToolbarState();
                    syncFieldFromEditable();
                    return;
                }
            }

            if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);

                if (field.tableId) {
                    const tableCells = (state.fields || [])
                        .filter(item => item.tableId === field.tableId && !item.hidden && !item.locked)
                        .sort((a, b) => (a.tableRow - b.tableRow) || (a.tableCol - b.tableCol));

                    const currentIdx = tableCells.findIndex(item => item.id === field.id);
                    if (e.shiftKey) {
                        if (currentIdx > 0) {
                            const prevField = tableCells[currentIdx - 1];
                            setSelectedField(prevField.id);
                            if (handlers?.onSelect) handlers.onSelect(prevField);
                            renderOverlays(handlers);
                            startInlineTextEdit(prevField.id, handlers);
                            return;
                        }
                    } else {
                        if (currentIdx !== -1 && currentIdx < tableCells.length - 1) {
                            const nextField = tableCells[currentIdx + 1];
                            setSelectedField(nextField.id);
                            if (handlers?.onSelect) handlers.onSelect(nextField);
                            renderOverlays(handlers);
                            startInlineTextEdit(nextField.id, handlers);
                            return;
                        } else if (currentIdx === tableCells.length - 1) {
                            const newCells = addRowToTable(field.tableId, state.fields || []);
                            if (newCells.length > 0) {
                                state.fields.push(...newCells);
                                saveHistory(true, "Add Table Row");
                                const firstNewCell = newCells[0];
                                setSelectedField(firstNewCell.id);
                                if (handlers?.onSelect) handlers.onSelect(firstNewCell);
                                renderOverlays(handlers);
                                startInlineTextEdit(firstNewCell.id, handlers);
                                return;
                            }
                        }
                    }
                }

                const activeFields = sortFieldsByReadingOrder(state.fields.filter(item => !item.hidden && !item.locked));
                if (activeFields.length > 0) {
                    const currentIdx = activeFields.findIndex(item => item.id === field.id);
                    const nextIdx = currentIdx === -1
                        ? 0
                        : (e.shiftKey ? (currentIdx - 1 + activeFields.length) % activeFields.length : (currentIdx + 1) % activeFields.length);
                    const targetField = activeFields[nextIdx];
                    if (targetField) {
                        if (targetField.page && targetField.page !== state.currentPageNum) {
                            await goToPage(targetField.page, () => {
                                setSelectedField(targetField.id);
                                if (handlers?.onSelect) handlers.onSelect(targetField);
                                renderOverlays(handlers);
                                startInlineTextEdit(targetField.id, handlers);
                            });
                        } else {
                            setSelectedField(targetField.id);
                            if (handlers?.onSelect) handlers.onSelect(targetField);
                            renderOverlays(handlers);
                            startInlineTextEdit(targetField.id, handlers);
                        }
                    }
                }
            } else if (field.tableId && e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                // Table Cell Enter: move to cell below
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);

                const tableCells = (state.fields || []).filter(item => item.tableId === field.tableId && !item.hidden && !item.locked);
                const nextRow = field.tableRole === "header" ? 1 : (field.tableRow || 0) + 1;
                const nextRowCell = tableCells.find(item => item.tableRow === nextRow && item.tableCol === field.tableCol);
                if (nextRowCell) {
                    setSelectedField(nextRowCell.id);
                    if (handlers?.onSelect) handlers.onSelect(nextRowCell);
                    renderOverlays(handlers);
                    startInlineTextEdit(nextRowCell.id, handlers);
                    return;
                } else if (field.tableRole === "cell") {
                    const newCells = addRowToTable(field.tableId, state.fields || []);
                    if (newCells.length > 0) {
                        state.fields.push(...newCells);
                        saveHistory(true, "Add Table Row");
                        const targetCell = newCells.find(c => c.tableCol === field.tableCol) || newCells[0];
                        setSelectedField(targetCell.id);
                        if (handlers?.onSelect) handlers.onSelect(targetCell);
                        renderOverlays(handlers);
                        startInlineTextEdit(targetCell.id, handlers);
                        return;
                    }
                }
                overlay.focus();
            } else if (field.tableId && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const tableCells = (state.fields || []).filter(item => item.tableId === field.tableId && !item.hidden && !item.locked);
                if (e.key === "ArrowDown") {
                    const targetRow = field.tableRole === "header" ? 1 : (field.tableRow || 0) + 1;
                    const nextRowCell = tableCells.find(item => item.tableRow === targetRow && item.tableCol === field.tableCol);
                    if (nextRowCell) {
                        e.preventDefault();
                        e.stopPropagation();
                        commitEdit(true);
                        setSelectedField(nextRowCell.id);
                        if (handlers?.onSelect) handlers.onSelect(nextRowCell);
                        renderOverlays(handlers);
                        startInlineTextEdit(nextRowCell.id, handlers);
                        return;
                    }
                } else if (e.key === "ArrowUp" && field.tableRole === "cell") {
                    const targetRow = (field.tableRow || 0) - 1;
                    const prevRowCell = tableCells.find(item => (targetRow === 0 ? item.tableRole === "header" : item.tableRow === targetRow) && item.tableCol === field.tableCol);
                    if (prevRowCell) {
                        e.preventDefault();
                        e.stopPropagation();
                        commitEdit(true);
                        setSelectedField(prevRowCell.id);
                        if (handlers?.onSelect) handlers.onSelect(prevRowCell);
                        renderOverlays(handlers);
                        startInlineTextEdit(prevRowCell.id, handlers);
                        return;
                    }
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);
                overlay.focus();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);
                overlay.focus();
            }
            e.stopPropagation();
        });

        editable.addEventListener("mousedown", e => e.stopPropagation());
        editable.addEventListener("pointerdown", e => e.stopPropagation());
        editable.addEventListener("click", e => e.stopPropagation());
        editable.addEventListener("dblclick", e => e.stopPropagation());

        editable.addEventListener("blur", (e) => {
            // Don't commit if focus moved to the toolbar
            const relatedTarget = e.relatedTarget;
            if (relatedTarget && wpContainer.contains(relatedTarget)) return;
            if (relatedTarget && toolbar.contains(relatedTarget)) return;
            // Small delay to allow toolbar button clicks to fire first
            setTimeout(() => {
                if (!editable.parentNode || committed) return;
                if (document.activeElement && wpContainer.contains(document.activeElement)) return;
                commitEdit(true);
            }, 120);
        });

        overlay.appendChild(wpContainer);
        syncDimensions();
        editable.focus?.();

        // Place cursor at end
        if (editable.childNodes.length > 0) {
            const sel = window.getSelection?.();
            if (sel) {
                sel.selectAllChildren(editable);
                sel.collapseToEnd();
            }
        }

        // Initial toolbar state
        setTimeout(updateToolbarState, 50);
    } else {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-field-input";
        
        let initialVal = "";
        let placeholderText = "";
        if (field.type === "dropdown") {
            initialVal = (field.options && field.options.length) ? field.options.join(", ") : (field.defaultValue || "");
            placeholderText = "Options separated by comma (e.g. Option 1, Option 2)";
        } else {
            initialVal = field.defaultValue || "";
            placeholderText = field.name ? `Default value (${field.name})...` : "Enter default value...";
        }

        input.value = initialVal;
        input.placeholder = placeholderText;

        const { fam, weight, style: fontStyle } = getFieldCssFont(field);
        const fontSize = Number(field.fontSize) || 12;
        input.style.fontFamily = fam;
        input.style.fontSize = `${fontSize}px`;
        input.style.fontWeight = weight || "500";
        input.style.fontStyle = (fontStyle === "italic") ? "italic" : "normal";
        input.style.color = "#1c1f26";

        let committed = false;
        const commitEdit = (shouldSave = true) => {
            if (committed) return;
            committed = true;
            const finalVal = input.value.trim();

            if (field.type === "dropdown") {
                if (finalVal) {
                    const items = finalVal.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
                    if (items.length > 0) {
                        field.options = items;
                        field.defaultValue = items[0];
                    } else {
                        field.defaultValue = finalVal;
                        field.options = [finalVal];
                    }
                } else {
                    field.defaultValue = "";
                }
            } else {
                field.defaultValue = finalVal;
                field.value = finalVal;
            }

            overlay.classList.remove("is-editing-text");
            input.remove();

            const propDef = document.getElementById("fieldDefaultValue");
            if (propDef && state.selectedFieldIds.has(field.id)) {
                propDef.value = field.defaultValue || "";
            }
            const propDropdownOpts = document.getElementById("dropdownOptions");
            if (propDropdownOpts && field.type === "dropdown" && state.selectedFieldIds.has(field.id)) {
                propDropdownOpts.value = (field.options || []).join("\n");
            }

            if (shouldSave) saveHistory(true);
            if (handlers?.onUpdated) handlers.onUpdated(field);
            renderOverlays(handlers);
        };

        input.addEventListener("keydown", async (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);

                if (field.tableId) {
                    const tableCells = (state.fields || [])
                        .filter(item => item.tableId === field.tableId && !item.hidden && !item.locked)
                        .sort((a, b) => (a.tableRow - b.tableRow) || (a.tableCol - b.tableCol));

                    const currentIdx = tableCells.findIndex(item => item.id === field.id);
                    if (e.shiftKey) {
                        if (currentIdx > 0) {
                            const prevField = tableCells[currentIdx - 1];
                            setSelectedField(prevField.id);
                            if (handlers?.onSelect) handlers.onSelect(prevField);
                            renderOverlays(handlers);
                            startInlineTextEdit(prevField.id, handlers);
                            return;
                        }
                    } else {
                        if (currentIdx !== -1 && currentIdx < tableCells.length - 1) {
                            const nextField = tableCells[currentIdx + 1];
                            setSelectedField(nextField.id);
                            if (handlers?.onSelect) handlers.onSelect(nextField);
                            renderOverlays(handlers);
                            startInlineTextEdit(nextField.id, handlers);
                            return;
                        } else if (currentIdx === tableCells.length - 1) {
                            // At the very end of table -> auto append new row!
                            const newCells = addRowToTable(field.tableId, state.fields || []);
                            if (newCells.length > 0) {
                                state.fields.push(...newCells);
                                saveHistory(true, "Add Table Row");
                                const firstNewCell = newCells[0];
                                setSelectedField(firstNewCell.id);
                                if (handlers?.onSelect) handlers.onSelect(firstNewCell);
                                renderOverlays(handlers);
                                startInlineTextEdit(firstNewCell.id, handlers);
                                return;
                            }
                        }
                    }
                }

                const activeFields = sortFieldsByReadingOrder(state.fields.filter(item => !item.hidden && !item.locked));
                if (activeFields.length > 0) {
                    const currentIdx = activeFields.findIndex(item => item.id === field.id);
                    const nextIdx = currentIdx === -1
                        ? 0
                        : (e.shiftKey ? (currentIdx - 1 + activeFields.length) % activeFields.length : (currentIdx + 1) % activeFields.length);
                    const targetField = activeFields[nextIdx];
                    if (targetField) {
                        if (targetField.page && targetField.page !== state.currentPageNum) {
                            await goToPage(targetField.page, () => {
                                setSelectedField(targetField.id);
                                if (handlers?.onSelect) handlers.onSelect(targetField);
                                renderOverlays(handlers);
                                startInlineTextEdit(targetField.id, handlers);
                            });
                        } else {
                            setSelectedField(targetField.id);
                            if (handlers?.onSelect) handlers.onSelect(targetField);
                            renderOverlays(handlers);
                            startInlineTextEdit(targetField.id, handlers);
                        }
                    }
                }
            } else if (e.key === "Enter" && field.tableId) {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);

                const tableCells = (state.fields || [])
                    .filter(item => item.tableId === field.tableId && !item.hidden && !item.locked);
                const nextRowCell = tableCells.find(item => item.tableRow === field.tableRow + 1 && item.tableCol === field.tableCol);
                if (nextRowCell) {
                    setSelectedField(nextRowCell.id);
                    if (handlers?.onSelect) handlers.onSelect(nextRowCell);
                    renderOverlays(handlers);
                    startInlineTextEdit(nextRowCell.id, handlers);
                    return;
                } else if (field.tableRole === "cell") {
                    const newCells = addRowToTable(field.tableId, state.fields || []);
                    if (newCells.length > 0) {
                        state.fields.push(...newCells);
                        saveHistory(true, "Add Table Row");
                        const targetCell = newCells.find(c => c.tableCol === field.tableCol) || newCells[0];
                        setSelectedField(targetCell.id);
                        if (handlers?.onSelect) handlers.onSelect(targetCell);
                        renderOverlays(handlers);
                        startInlineTextEdit(targetCell.id, handlers);
                        return;
                    }
                }
                overlay.focus();
            } else if (field.tableId && (e.key === "ArrowDown" || e.key === "ArrowUp") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const tableCells = (state.fields || []).filter(item => item.tableId === field.tableId && !item.hidden && !item.locked);
                if (e.key === "ArrowDown") {
                    const nextRowCell = tableCells.find(item => item.tableRow === (field.tableRow || 0) + 1 && item.tableCol === field.tableCol);
                    if (nextRowCell) {
                        e.preventDefault();
                        e.stopPropagation();
                        commitEdit(true);
                        setSelectedField(nextRowCell.id);
                        if (handlers?.onSelect) handlers.onSelect(nextRowCell);
                        renderOverlays(handlers);
                        startInlineTextEdit(nextRowCell.id, handlers);
                        return;
                    }
                } else if (e.key === "ArrowUp") {
                    const prevRow = (field.tableRow || 0) - 1;
                    const prevRowCell = tableCells.find(item => (prevRow === 0 ? item.tableRole === "header" : item.tableRow === prevRow) && item.tableCol === field.tableCol);
                    if (prevRowCell) {
                        e.preventDefault();
                        e.stopPropagation();
                        commitEdit(true);
                        setSelectedField(prevRowCell.id);
                        if (handlers?.onSelect) handlers.onSelect(prevRowCell);
                        renderOverlays(handlers);
                        startInlineTextEdit(prevRowCell.id, handlers);
                        return;
                    }
                }
            } else if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(true);
                overlay.focus();
            }
            e.stopPropagation();
        });

        input.addEventListener("mousedown", e => e.stopPropagation());
        input.addEventListener("pointerdown", e => e.stopPropagation());
        input.addEventListener("click", e => e.stopPropagation());
        input.addEventListener("dblclick", e => e.stopPropagation());

        input.addEventListener("blur", () => {
            commitEdit(true);
        });

        overlay.appendChild(input);
        input.focus?.();
        input.select?.();
    }
}
