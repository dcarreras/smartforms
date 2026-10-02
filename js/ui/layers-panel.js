// ── Left Layers Panel Manager (js/ui/layers-panel.js) ───────────
import { 
    state, 
    setSelectedField, 
    createGroupForSelected, 
    ungroupSelected, 
    ungroupGroup, 
    toggleGroupCollapsed, 
    selectGroup, 
    deleteGroupAndFields,
    cleanupEmptyGroups
} from "../core/state.js";
import { goToPage } from "../engines/pdf-engine.js";
import { saveHistory } from "../core/storage-manager.js";
import { formatFieldDisplayName } from "./overlay-manager.js";

const escapeHtml = (str) => String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const FIELD_TYPE_STYLES = {
    textField: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><rect x="3" y="6" width="18" height="12" rx="3"></rect></svg>`,
        label: "Text Field"
    },
    signature: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><path d="m3 21 3.5-1 12-12-2.5-2.5-12 12L3 21z"></path><path d="m14 8 2.5 2.5"></path></svg>`,
        label: "Signature"
    },
    dropdown: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m8 10 4 4 4-4"></path></svg>`,
        label: "Dropdown"
    },
    checkBox: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="4"></rect><path d="m9 12 2 2 4-4"></path></svg>`,
        label: "Checkbox"
    },
    radioGroup: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3" fill="#2f5bea"></circle></svg>`,
        label: "Radio Group"
    },
    radio: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3" fill="#2f5bea"></circle></svg>`,
        label: "Radio"
    },
    dateField: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="3"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>`,
        label: "Date Field"
    },
    numberField: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2f5bea" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M8 9h8M8 15h8"></path></svg>`,
        label: "Number Field"
    },
    staticText: {
        symbol: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#5b6270" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"></path></svg>`,
        label: "Static Text"
    }
};

let currentDraggedFieldIds = [];

export function renderLayers(onSelect, onRerender) {
    const list = document.getElementById("layersList");
    if (!list) return;
    list.innerHTML = "";

    cleanupEmptyGroups();

    if (state.fields.length === 0) {
        list.innerHTML = '<p class="empty-msg" style="padding: 16px; color: #94a3b8; font-size: 12px; text-align: center;">No fields added yet.</p>';
        return;
    }

    const groups = state.groups || [];
    const groupedFieldIds = new Set();

    // ── 1. Render Group Sections ──────────────────────────────────────
    groups.forEach(g => {
        const groupFields = state.fields.filter(f => f.groupId === g.id);
        if (groupFields.length === 0) return;

        groupFields.forEach(f => groupedFieldIds.add(f.id));

        const isGroupAllSelected = groupFields.length > 0 && groupFields.every(f => state.selectedFieldIds.has(f.id));
        const groupContainer = document.createElement("div");
        groupContainer.className = "layer-group";
        groupContainer.dataset.groupId = g.id;

        const header = document.createElement("div");
        header.className = "layer-group-header" + (isGroupAllSelected ? " selected" : "");

        const isCollapsed = !!g.collapsed;
        header.innerHTML = `
            <button type="button" class="group-toggle-btn" title="${isCollapsed ? 'Expand Group' : 'Collapse Group'}" style="flex-shrink: 0;">
                <i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-down'}" style="width: 13px; height: 13px;"></i>
            </button>
            <i data-lucide="${isCollapsed ? 'folder' : 'folder-open'}" class="group-folder-icon" style="width: 14px; height: 14px; color: #2563eb; flex-shrink: 0;"></i>
            <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden;">
                <span class="group-name" title="${escapeHtml(g.name || 'Group')} (Double-click to rename)" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; cursor: pointer;">${escapeHtml(g.name || 'Group')}</span>
                <button type="button" class="layer-rename-btn" title="Rename Group" style="flex-shrink: 0;">
                    <i data-lucide="pencil" style="width: 11px; height: 11px;"></i>
                </button>
            </div>
            <span style="font-size: 10px; color: #5b6270; background: #e2e8f0; padding: 1px 6px; border-radius: 9999px; font-weight: 600; flex-shrink: 0;">${groupFields.length}</span>
            <button type="button" class="group-action-btn" title="Ungroup (Release fields)" style="margin-left: 2px; flex-shrink: 0;">
                <i data-lucide="folder-minus" style="width: 12px; height: 12px;"></i>
            </button>
            <button type="button" class="group-action-btn danger" title="Delete Group & Fields" style="flex-shrink: 0;">
                <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
        `;

        // Toggle Collapse on chevron
        header.querySelector(".group-toggle-btn")?.addEventListener("click", e => {
            e.stopPropagation();
            toggleGroupCollapsed(g.id);
            renderLayers(onSelect, onRerender);
        });

        // Select all fields in group on header click
        header.addEventListener("click", e => {
            if (e.target.closest("button") || e.target.closest("input")) return;
            selectGroup(g.id);
            updateLayerSelectionDOM();
            if (onSelect) onSelect(groupFields[0]);
        });

        // ── Drag over group header: Drop to add to group ──────────────
        // A depth counter avoids flicker: native dragenter/dragleave fire
        // when the cursor crosses onto/off of child elements (icons, the
        // rename button, the name span) inside the header, not just when
        // truly leaving it — a plain dragover/dragleave toggle strobes the
        // highlight on/off as the cursor moves across those children.
        let groupDragDepth = 0;
        header.addEventListener("dragenter", e => {
            e.preventDefault();
            groupDragDepth++;
            header.classList.add("drag-over-group");
        });

        header.addEventListener("dragover", e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        });

        header.addEventListener("dragleave", () => {
            groupDragDepth = Math.max(0, groupDragDepth - 1);
            if (groupDragDepth === 0) header.classList.remove("drag-over-group");
        });

        header.addEventListener("drop", e => {
            e.preventDefault();
            e.stopPropagation();
            groupDragDepth = 0;
            header.classList.remove("drag-over-group");

            if (currentDraggedFieldIds.length > 0) {
                currentDraggedFieldIds.forEach(id => {
                    const fld = state.fields.find(f => f.id === id);
                    if (fld) fld.groupId = g.id;
                });
                g.collapsed = false;
                saveHistory();
                renderLayers(onSelect, onRerender);
                if (onRerender) onRerender();
            }
        });

        // Ungroup button click
        header.querySelector(".group-action-btn[title*='Ungroup']")?.addEventListener("click", e => {
            e.stopPropagation();
            ungroupGroup(g.id);
            saveHistory();
            renderLayers(onSelect, onRerender);
            if (onRerender) onRerender();
        });

        // Delete group click
        header.querySelector(".group-action-btn.danger")?.addEventListener("click", e => {
            e.stopPropagation();
            if (confirm(`Delete group "${g.name}" and all its ${groupFields.length} fields?`)) {
                deleteGroupAndFields(g.id);
                saveHistory();
                renderLayers(onSelect, onRerender);
                if (onRerender) onRerender();
            }
        });

        // In-place Rename for Group
        const startGroupRename = () => {
            const nameSpan = header.querySelector(".group-name");
            if (!nameSpan || header.querySelector(".inline-rename-input")) return;

            header.classList.add("is-renaming");
            const input = document.createElement("input");
            input.type = "text";
            input.className = "inline-rename-input";
            input.value = g.name || "Group";
            
            input.addEventListener("click", ev => ev.stopPropagation());
            input.addEventListener("dblclick", ev => ev.stopPropagation());
            input.addEventListener("mousedown", ev => ev.stopPropagation());

            nameSpan.replaceWith(input);
            input.focus();
            input.select();

            let finished = false;
            const finishRename = () => {
                if (finished) return;
                finished = true;
                header.classList.remove("is-renaming");
                const newName = input.value.trim();
                if (newName) g.name = newName;
                saveHistory();
                renderLayers(onSelect, onRerender);
            };

            input.addEventListener("blur", finishRename);
            input.addEventListener("keydown", ev => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    finishRename();
                }
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    finished = true;
                    header.classList.remove("is-renaming");
                    renderLayers(onSelect, onRerender);
                }
            });
        };

        header.querySelector(".group-name")?.addEventListener("dblclick", e => {
            e.stopPropagation();
            startGroupRename();
        });

        header.querySelector(".layer-rename-btn")?.addEventListener("click", e => {
            e.stopPropagation();
            startGroupRename();
        });

        groupContainer.appendChild(header);

        // Render fields inside group if not collapsed
        if (!isCollapsed) {
            const itemsContainer = document.createElement("div");
            itemsContainer.className = "layer-group-items";

            groupFields.forEach(f => {
                const item = createFieldLayerItem(f, onSelect, onRerender);
                itemsContainer.appendChild(item);
            });

            groupContainer.appendChild(itemsContainer);
        }

        list.appendChild(groupContainer);
    });

    // ── 2. Render Ungrouped Fields ────────────────────────────────────
    const ungroupedFields = state.fields.filter(f => !groupedFieldIds.has(f.id));
    if (ungroupedFields.length > 0) {
        if (groups.length > 0) {
            const ungrHeader = document.createElement("div");
            ungrHeader.style.cssText = "padding: 8px 12px 4px; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;";
            ungrHeader.textContent = "Ungrouped Fields";
            list.appendChild(ungrHeader);
        }

        ungroupedFields.forEach(f => {
            const item = createFieldLayerItem(f, onSelect, onRerender);
            list.appendChild(item);
        });
    }

    // ── 3. Drop Zone to Remove From Group ─────────────────────────────
    if (groupedFieldIds.size > 0) {
        const dropzone = document.createElement("div");
        dropzone.className = "layer-ungroup-dropzone";
        dropzone.innerHTML = `
            <i data-lucide="folder-minus" style="width: 12px; height: 12px;"></i>
            <span>Drag here to remove from group</span>
        `;

        dropzone.addEventListener("dragover", e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            dropzone.classList.add("drag-over-ungroup");
        });

        dropzone.addEventListener("dragleave", () => {
            dropzone.classList.remove("drag-over-ungroup");
        });

        dropzone.addEventListener("drop", e => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove("drag-over-ungroup");

            if (currentDraggedFieldIds.length > 0) {
                currentDraggedFieldIds.forEach(id => {
                    const fld = state.fields.find(f => f.id === id);
                    if (fld) delete fld.groupId;
                });
                cleanupEmptyGroups();
                saveHistory();
                renderLayers(onSelect, onRerender);
                if (onRerender) onRerender();
            }
        });

        list.appendChild(dropzone);
    }

    if (typeof lucide !== "undefined") lucide.createIcons();
    applyLayerSearchFilter();
}

export function applyLayerSearchFilter() {
    if (typeof document === "undefined") return;
    const input = document.getElementById("layerSearchInput");
    const query = input ? (input.value || "").trim().toLowerCase() : "";
    const items = document.querySelectorAll("#layersList .layer-item");
    items.forEach(item => {
        const nameEl = item.querySelector(".layer-name");
        const text = (nameEl ? nameEl.textContent : "").toLowerCase();
        if (!query || text.includes(query)) {
            item.style.display = "flex";
        } else {
            item.style.display = "none";
        }
    });
}

function createFieldLayerItem(f, onSelect, onRerender) {
    const isSelected = state.selectedFieldIds.has(f.id);
    const item = document.createElement("div");
    item.className = "layer-item" + (isSelected ? " selected" : "") + (f.locked ? " is-locked" : "") + (f.hidden ? " is-hidden" : "");
    item.dataset.fieldId = f.id;
    item.draggable = true;

    const style = FIELD_TYPE_STYLES[f.type] || FIELD_TYPE_STYLES.textField;
    const globalIdx = state.fields.findIndex(item => item.id === f.id) + 1;

    const eyeIconSvg = f.hidden
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" x2="22" y1="2" y2="22"></line></svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

    const lockIconSvg = f.locked
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><circle cx="12" cy="16" r="1"></circle><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><circle cx="12" cy="16" r="1"></circle><path d="M8 11V7a4 4 0 0 1 8 0"></path></svg>`;

    item.innerHTML = `
        <span class="layer-grip-handle" title="Drag to reorder" style="display: none;"><i data-lucide="grip-vertical" style="width: 12px; height: 12px;"></i></span>
        <span class="layer-index" style="display: none;">${globalIdx}</span>
        <span class="layer-type-tag" title="${escapeHtml(style.label)}">${style.symbol}</span>
        <div style="flex: 1; min-width: 0; display: flex; align-items: center; overflow: hidden;">
            <span class="layer-name" title="${escapeHtml(f.name || style.label)} (Double-click to rename)" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: ${isSelected ? '600' : '400'}; color: #1c1f26; cursor: pointer;">${escapeHtml(formatFieldDisplayName(f))}</span>
            <button type="button" class="layer-rename-btn" title="Rename Field" style="display: none;">
                <i data-lucide="pencil" style="width: 11px; height: 11px;"></i>
            </button>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
            <button type="button" class="layer-action-btn layer-vis-btn" title="${f.hidden ? 'Show on canvas' : 'Hide from canvas'}" style="color: ${isSelected ? '#2f5bea' : (f.hidden ? '#ef4444' : '#9ca3af')};">
                ${eyeIconSvg}
            </button>
            <button type="button" class="layer-action-btn layer-lock-btn" title="${f.locked ? 'Unlock field' : 'Lock field'}" style="color: ${isSelected ? '#2f5bea' : (f.locked ? '#d97706' : '#9ca3af')}; display: ${isSelected || f.locked ? 'inline-flex' : 'none'};">
                ${lockIconSvg}
            </button>
        </div>
    `;

    // Layer ↔ Canvas Hover Sync
    item.addEventListener("mouseenter", () => {
        const overlay = document.querySelector(`.field-overlay[data-id="${f.id}"]`);
        if (overlay) overlay.classList.add("layer-hover-highlight");
    });
    item.addEventListener("mouseleave", () => {
        const overlay = document.querySelector(`.field-overlay[data-id="${f.id}"]`);
        if (overlay) overlay.classList.remove("layer-hover-highlight");
    });

    item.querySelector(".layer-vis-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        f.hidden = !f.hidden;
        saveHistory();
        renderLayers(onSelect, onRerender);
        if (onRerender) onRerender();
    });

    item.querySelector(".layer-lock-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        f.locked = !f.locked;
        saveHistory();
        renderLayers(onSelect, onRerender);
        if (onRerender) onRerender();
    });

    if (isSelected && state.selectedFieldIds.size === 1) {
        setTimeout(() => {
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 10);
    }

    // ── Drag & Drop Handlers for Layer Item ────────────────────────────
    item.addEventListener("dragstart", e => {
        if (state.selectedFieldIds.has(f.id)) {
            currentDraggedFieldIds = Array.from(state.selectedFieldIds);
        } else {
            currentDraggedFieldIds = [f.id];
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify(currentDraggedFieldIds));
        setTimeout(() => item.classList.add("is-dragging"), 0);
    });

    item.addEventListener("dragend", () => {
        item.classList.remove("is-dragging");
        itemDragDepth = 0;
        currentDraggedFieldIds = [];
        document.querySelectorAll(".drag-over-group, .drag-over-ungroup, .drag-over-item").forEach(el => {
            el.classList.remove("drag-over-group", "drag-over-ungroup", "drag-over-item");
        });
    });

    let itemDragDepth = 0;
    item.addEventListener("dragenter", e => {
        e.preventDefault();
        itemDragDepth++;
        item.classList.add("drag-over-item");
    });

    item.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    });

    item.addEventListener("dragleave", () => {
        itemDragDepth = Math.max(0, itemDragDepth - 1);
        if (itemDragDepth === 0) item.classList.remove("drag-over-item");
    });

    item.addEventListener("drop", e => {
        e.preventDefault();
        e.stopPropagation();
        itemDragDepth = 0;
        item.classList.remove("drag-over-item");

        if (currentDraggedFieldIds.length > 0 && !currentDraggedFieldIds.includes(f.id)) {
            // Assign same groupId as target item (or remove if target is ungrouped)
            currentDraggedFieldIds.forEach(id => {
                const fld = state.fields.find(item => item.id === id);
                if (fld) {
                    if (f.groupId) fld.groupId = f.groupId;
                    else delete fld.groupId;
                }
            });

            // Reorder dragged items to sit right before target item
            const targetIdx = state.fields.findIndex(item => item.id === f.id);
            const draggedObjs = state.fields.filter(item => currentDraggedFieldIds.includes(item.id));
            state.fields = state.fields.filter(item => !currentDraggedFieldIds.includes(item.id));
            const newTargetIdx = state.fields.findIndex(item => item.id === f.id);
            state.fields.splice(newTargetIdx, 0, ...draggedObjs);

            cleanupEmptyGroups();
            saveHistory();
            renderLayers(onSelect, onRerender);
            if (onRerender) onRerender();
        }
    });

    item.addEventListener("click", async e => {
        if (e.target.closest("button") || e.target.closest("input")) return;
        e.stopPropagation();
        if (f.page && f.page !== state.currentPageNum) {
            await goToPage(f.page, onRerender);
        }

        const allItems = Array.from(document.querySelectorAll("#layersList .layer-item"));
        const allIds = allItems.map(el => el.dataset.fieldId);
        const currentIdStr = String(f.id);

        if (e.shiftKey) {
            // ── Range Selection with Shift + Click ──
            const anchorIdStr = state.lastSelectedFieldId !== null ? String(state.lastSelectedFieldId) : null;
            let fromIdx = anchorIdStr !== null ? allIds.indexOf(anchorIdStr) : -1;
            let toIdx = allIds.indexOf(currentIdStr);

            if (fromIdx !== -1 && toIdx !== -1) {
                const start = Math.min(fromIdx, toIdx);
                const end = Math.max(fromIdx, toIdx);
                const rangeIds = allIds.slice(start, end + 1);

                if (!e.ctrlKey && !e.metaKey) {
                    state.selectedFieldIds.clear();
                }
                rangeIds.forEach(idStr => {
                    const matchF = state.fields.find(fld => String(fld.id) === String(idStr));
                    if (matchF) state.selectedFieldIds.add(matchF.id);
                });
                state.lastSelectedFieldId = f.id;
            } else {
                state.selectedFieldIds.add(f.id);
                state.lastSelectedFieldId = f.id;
            }
        } else if (e.ctrlKey || e.metaKey) {
            // ── Toggle Individual Selection with Ctrl/Cmd + Click ──
            if (state.selectedFieldIds.has(f.id)) {
                state.selectedFieldIds.delete(f.id);
                if (state.lastSelectedFieldId === f.id) {
                    state.lastSelectedFieldId = Array.from(state.selectedFieldIds)[0] || null;
                }
            } else {
                state.selectedFieldIds.add(f.id);
                state.lastSelectedFieldId = f.id;
            }
        } else {
            // ── Standard Single Selection ──
            setSelectedField(f.id);
        }

        updateLayerSelectionDOM();
        if (onSelect) onSelect(f);
    });

    // In-place Rename for Field
    const startFieldRename = () => {
        const nameSpan = item.querySelector(".layer-name");
        if (!nameSpan || item.querySelector(".inline-rename-input")) return;

        item.classList.add("is-renaming");
        const currentName = f.name || style.label;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-rename-input";
        input.value = currentName;

        input.addEventListener("click", ev => ev.stopPropagation());
        input.addEventListener("dblclick", ev => ev.stopPropagation());
        input.addEventListener("mousedown", ev => ev.stopPropagation());

        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const finishRename = () => {
            if (finished) return;
            finished = true;
            item.classList.remove("is-renaming");
            const newName = input.value.trim();
            if (newName) f.name = newName;
            saveHistory();
            renderLayers(onSelect, onRerender);
            if (onRerender) onRerender();
        };

        input.addEventListener("blur", finishRename);
        input.addEventListener("keydown", ev => {
            if (ev.key === "Enter") {
                ev.preventDefault();
                finishRename();
            }
            if (ev.key === "Escape") {
                ev.preventDefault();
                finished = true;
                item.classList.remove("is-renaming");
                renderLayers(onSelect, onRerender);
            }
        });
    };

    item.querySelector(".layer-name")?.addEventListener("dblclick", e => {
        e.stopPropagation();
        startFieldRename();
    });

    item.querySelector(".layer-rename-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        startFieldRename();
    });

    return item;
}

export function updateLayerSelectionDOM() {
    const list = document.getElementById("layersList");
    if (!list) return;

    list.querySelectorAll(".layer-item").forEach(item => {
        const rawId = item.dataset.fieldId;
        const numId = Number(rawId);
        const floatId = parseFloat(rawId);
        const isSelected = state.selectedFieldIds.has(rawId) || state.selectedFieldIds.has(numId) || state.selectedFieldIds.has(floatId);
        item.classList.toggle("selected", isSelected);
        
        const f = state.fields.find(fld => String(fld.id) === String(rawId));
        if (f) {
            const tag = item.querySelector(".layer-type-tag");
            if (tag) {
                tag.style.color = isSelected ? "#2563eb" : "#94a3b8";
            }
            const idxEl = item.querySelector(".layer-index");
            if (idxEl) {
                idxEl.style.color = isSelected ? "#2563eb" : "#94a3b8";
                idxEl.style.fontWeight = isSelected ? "600" : "400";
            }
            const nameEl = item.querySelector(".layer-name");
            if (nameEl) {
                nameEl.style.fontWeight = isSelected ? "600" : "500";
            }
        }

        if (isSelected && state.selectedFieldIds.size === 1) {
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    });

    list.querySelectorAll(".layer-group").forEach(grpEl => {
        const gid = grpEl.dataset.groupId;
        const groupFields = state.fields.filter(f => f.groupId === gid);
        const isGroupAllSelected = groupFields.length > 0 && groupFields.every(f => 
            state.selectedFieldIds.has(f.id) || state.selectedFieldIds.has(String(f.id)) || state.selectedFieldIds.has(Number(f.id))
        );
        const header = grpEl.querySelector(".layer-group-header");
        if (header) {
            header.classList.toggle("selected", isGroupAllSelected);
            const icon = header.querySelector(".group-folder-icon");
            if (icon) icon.style.color = "#2563eb";
        }
    });
}

// ── Pages View Rendering & Tab Management ────────────────────────
export function renderPagesList(onPageSelect) {
    if (typeof document === "undefined") return;
    const list = document.getElementById("pagesList");
    if (!list) return;
    list.innerHTML = "";

    const totalPages = Math.max(1, state.totalPages || 1);
    for (let p = 1; p <= totalPages; p++) {
        const pageNum = p;
        const pageFields = (state.fields || []).filter(f => f.page === pageNum);
        const isCurrent = pageNum === state.currentPageNum;

        const item = document.createElement("div");
        item.className = "page-tree-item" + (isCurrent ? " selected" : "");
        item.dataset.page = pageNum;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("aria-label", `Page ${pageNum}, ${pageFields.length} field${pageFields.length === 1 ? '' : 's'}`);

        item.innerHTML = `
            <i data-lucide="file-text" class="page-tree-icon" style="width: 14px; height: 14px; flex-shrink: 0; color: ${isCurrent ? '#2563eb' : '#5b6270'};"></i>
            <span class="page-tree-name" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: ${isCurrent ? '600' : '500'}; color: #1c1f26;">Page ${pageNum}</span>
            <span class="page-tree-badge" title="${pageFields.length} fields on page ${pageNum}" style="font-size: 10px; color: ${isCurrent ? '#1c1f26' : '#5b6270'}; background: ${isCurrent ? '#ffffff' : '#f1f5f9'}; padding: 1px 6px; border-radius: 9999px; font-weight: 600; flex-shrink: 0;">${pageFields.length}</span>
        `;

        item.addEventListener("click", () => {
            if (state.currentPageNum !== pageNum) {
                if (onPageSelect) {
                    onPageSelect(pageNum);
                } else {
                    goToPage(pageNum);
                }
            }
        });

        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                item.click();
            }
        });

        list.appendChild(item);
    }

    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }
}

export function updatePagesListSelectionDOM() {
    if (typeof document === "undefined") return;
    const list = document.getElementById("pagesList");
    if (!list) return;
    list.querySelectorAll(".page-tree-item").forEach(item => {
        const pageNum = parseInt(item.dataset.page, 10);
        const isCurrent = pageNum === state.currentPageNum;
        item.classList.toggle("selected", isCurrent);
        const icon = item.querySelector(".page-tree-icon");
        if (icon) icon.style.color = isCurrent ? "#2563eb" : "#5b6270";
        const name = item.querySelector(".page-tree-name");
        if (name) name.style.fontWeight = isCurrent ? "600" : "500";
        const badge = item.querySelector(".page-tree-badge");
        if (badge) {
            badge.style.background = isCurrent ? "#ffffff" : "#f1f5f9";
            badge.style.color = isCurrent ? "#1c1f26" : "#5b6270";
        }
    });
}

export function initLeftPanelTabs(onPageSelect, onRerender) {
    if (typeof document === "undefined") return;
    const tabPages = document.getElementById("leftTabPages");
    const tabLayers = document.getElementById("leftTabLayers");
    const pagesSection = document.getElementById("pagesPanelSection");
    const layersSection = document.getElementById("layersPanelSection");
    const addPageBtn = document.getElementById("addPageLeftBtn");

    const switchTab = (tab) => {
        if (tab === "pages") {
            tabPages?.classList.add("active");
            tabPages?.setAttribute("aria-selected", "true");
            tabLayers?.classList.remove("active");
            tabLayers?.setAttribute("aria-selected", "false");
            if (pagesSection) pagesSection.style.display = "flex";
            if (layersSection) layersSection.style.display = "none";
            renderPagesList(onPageSelect);
        } else {
            tabLayers?.classList.add("active");
            tabLayers?.setAttribute("aria-selected", "true");
            tabPages?.classList.remove("active");
            tabPages?.setAttribute("aria-selected", "false");
            if (layersSection) layersSection.style.display = "flex";
            if (pagesSection) pagesSection.style.display = "none";
            if (onRerender) onRerender();
        }
    };

    tabPages?.addEventListener("click", () => switchTab("pages"));
    tabLayers?.addEventListener("click", () => switchTab("layers"));

    addPageBtn?.addEventListener("click", async () => {
        await handleAddBlankPage(onPageSelect, onRerender);
    });

    const searchInput = document.getElementById("layerSearchInput");
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = "true";
        searchInput.addEventListener("input", () => {
            applyLayerSearchFilter();
        });
    }
}

async function handleAddBlankPage(onPageSelect, onRerender) {
    try {
        const pdfLib = typeof window !== "undefined" ? (window.PDFLib || globalThis.PDFLib) : null;
        const pdfjs = typeof window !== "undefined" ? (window.pdfjsLib || globalThis.pdfjsLib) : null;

        if (!pdfLib || !pdfjs) {
            const { showToast } = await import("../utils/toast.js");
            showToast("PDF engine is initializing, please try again in a moment.", "info");
            return;
        }

        let doc;
        if (state.originalPdfBytes) {
            doc = await pdfLib.PDFDocument.load(state.originalPdfBytes);
        } else {
            doc = await pdfLib.PDFDocument.create();
        }

        let width = 595.28;
        let height = 841.89;
        const existingPages = doc.getPages();
        if (existingPages.length > 0) {
            const lastPage = existingPages[existingPages.length - 1];
            const size = lastPage.getSize();
            width = size.width;
            height = size.height;
        }

        doc.addPage([width, height]);
        const newBytes = await doc.save();
        state.originalPdfBytes = newBytes;

        const loadingTask = pdfjs.getDocument({ data: newBytes.slice() });
        state.pdfDoc = await loadingTask.promise;
        state.totalPages = state.pdfDoc.numPages;

        saveHistory(true, "Add Blank Page");

        const newPageNum = state.totalPages;
        await goToPage(newPageNum, () => {
            renderPagesList(onPageSelect);
            if (onRerender) onRerender();
        });

        const { showToast } = await import("../utils/toast.js");
        showToast(`Page ${newPageNum} added`, "success");
    } catch (err) {
        console.error("Failed to add blank page:", err);
        const { showToast } = await import("../utils/toast.js");
        showToast("Could not add blank page to this document", "error");
    }
}
