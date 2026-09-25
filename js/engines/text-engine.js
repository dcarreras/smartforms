// ── Formblatt Document Authoring: Text, Lists & Table Engine ──────────────
// Pure native ES Module: Zero dependencies, 100% in-browser, ISO 32000 compliant

import { generateFieldId } from "../core/state.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. TYPOGRAPHY & TEXT STYLES SPECIFICATION
// ─────────────────────────────────────────────────────────────────────────────

export const TEXT_STYLES = {
    title: {
        fontSize: 22,
        fontWeight: "bold",
        fontStyle: "normal",
        lineHeight: 1.2,
        color: "#0f172a",
        label: "Document Title",
        defaultWidth: 380,
        defaultHeight: 38
    },
    h1: {
        fontSize: 16,
        fontWeight: "bold",
        fontStyle: "normal",
        lineHeight: 1.25,
        color: "#0f172a",
        label: "Heading 1",
        defaultWidth: 320,
        defaultHeight: 32
    },
    h2: {
        fontSize: 13,
        fontWeight: "bold",
        fontStyle: "normal",
        lineHeight: 1.3,
        color: "#1e293b",
        label: "Heading 2",
        defaultWidth: 260,
        defaultHeight: 26
    },
    h3: {
        fontSize: 11.5,
        fontWeight: "600",
        fontStyle: "normal",
        lineHeight: 1.35,
        color: "#334155",
        label: "Heading 3",
        defaultWidth: 220,
        defaultHeight: 24
    },
    paragraph: {
        fontSize: 10.5,
        fontWeight: "normal",
        fontStyle: "normal",
        lineHeight: 1.45,
        color: "#0f172a",
        label: "Paragraph Text",
        defaultWidth: 340,
        defaultHeight: 52
    },
    bulletList: {
        fontSize: 10.5,
        fontWeight: "normal",
        fontStyle: "normal",
        lineHeight: 1.45,
        color: "#0f172a",
        prefix: "• ",
        label: "• List Item 1\n• List Item 2\n• List Item 3",
        defaultWidth: 300,
        defaultHeight: 64
    },
    numberList: {
        fontSize: 10.5,
        fontWeight: "normal",
        fontStyle: "normal",
        lineHeight: 1.45,
        color: "#0f172a",
        prefix: "1. ",
        label: "1. Step One\n2. Step Two\n3. Step Three",
        defaultWidth: 300,
        defaultHeight: 64
    },
    callout: {
        fontSize: 10,
        fontWeight: "500",
        fontStyle: "normal",
        lineHeight: 1.4,
        color: "#1e3a8a",
        label: "Important Notice: Please verify all information before signing.",
        defaultWidth: 380,
        defaultHeight: 44,
        fillStyle: "#eff6ff",
        borderColor: "#bfdbfe",
        borderStyle: "solid",
        borderWidth: 1
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. LIST PARSING & FORMATTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const BULLET_PREFIX_REGEX = /^([•·◦▪\-*]|\d+[\.\)]|\[[ xX]?\])\s+/;

/**
 * Checks if a single line of text has a bullet, numbered, or task list prefix.
 */
export function isListLine(line) {
    if (!line) return false;
    return BULLET_PREFIX_REGEX.test(line.trim());
}

/**
 * Parses raw multi-line text into structured items with detected marker, prefix, and clean text.
 */
export function parseListItems(text) {
    if (!text) return [];
    const lines = String(text).split(/\r?\n/);
    return lines.map((line, idx) => {
        const trimmed = line.trim();
        const match = trimmed.match(BULLET_PREFIX_REGEX);
        if (match) {
            const prefix = match[1];
            const content = trimmed.slice(match[0].length);
            let type = "bullet";
            if (/^\d+[\.\)]$/.test(prefix)) type = "number";
            else if (/^\[[ xX]?\]$/.test(prefix)) type = "task";
            return {
                index: idx,
                raw: line,
                prefix,
                content,
                type,
                checked: /^\[[xX]\]$/.test(prefix)
            };
        }
        return {
            index: idx,
            raw: line,
            prefix: "",
            content: trimmed,
            type: "text",
            checked: false
        };
    });
}

/**
 * Formats plain lines of text into a specific list type ("bullet", "number", or "task").
 */
export function formatAsList(text, listType = "bullet") {
    if (!text) return "";
    const lines = String(text).split(/\r?\n/);
    let counter = 1;

    return lines.map(line => {
        const clean = line.replace(BULLET_PREFIX_REGEX, "").trim();
        if (!clean) return "";
        if (listType === "number") {
            const prefix = `${counter++}. `;
            return prefix + clean;
        } else if (listType === "task") {
            return `[ ] ${clean}`;
        }
        return `• ${clean}`;
    }).join("\n");
}

/**
 * Toggles a list format on existing text (e.g. clicking Bullet button).
 * If the text is already of that list type, strips the list markers back to plain text.
 */
export function toggleListFormat(text, targetType = "bullet") {
    const items = parseListItems(text);
    if (items.length === 0) return "";
    const allAlreadyTarget = items.every(it => !it.content || it.type === targetType);

    if (allAlreadyTarget) {
        // Strip prefixes back to plain text
        return items.map(it => it.content).join("\n");
    }
    return formatAsList(text, targetType);
}

/**
 * Calculates wrapped lines of text within a given bounding width (in points/pixels).
 * Uses standard font character width estimations if no Canvas context is available.
 */
export function calculateWrappedLines(text, maxWidth, fontSize = 11, fontFamily = "helvetica") {
    if (!text) return [];
    const avgCharWidth = fontSize * 0.52; // average character aspect ratio for standard sans-serif
    const maxCharsPerLine = Math.max(10, Math.floor(maxWidth / avgCharWidth));

    const paragraphs = String(text).split(/\r?\n/);
    const resultLines = [];

    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
            resultLines.push("");
            continue;
        }

        const match = paragraph.match(BULLET_PREFIX_REGEX);
        const prefix = match ? match[0] : "";
        const body = match ? paragraph.slice(match[0].length) : paragraph;
        const words = body.split(/\s+/);

        let currentLine = prefix;
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (testLine.length > maxCharsPerLine && currentLine.trim() !== prefix.trim()) {
                resultLines.push(currentLine.trimEnd());
                // Hanging indent for subsequent lines in a bulleted item
                const indent = prefix ? "   " : "";
                currentLine = `${indent}${word}`;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            resultLines.push(currentLine.trimEnd());
        }
    }

    return resultLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TABLE & GRID FORM BUILDER ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export const TABLE_PRESETS = {
    invoice: {
        id: "invoice",
        title: "Commercial Invoice Breakdown",
        rowHeight: 22,
        headerHeight: 24,
        columns: [
            { id: "item_desc", label: "Item Description", width: 230, type: "textField", placeholder: "Item / Service Name" },
            { id: "qty", label: "Qty", width: 55, type: "textField", dataFormat: "integer", placeholder: "1" },
            { id: "unit_price", label: "Unit Price", width: 75, type: "textField", dataFormat: "currency", placeholder: "$0.00" },
            { id: "total_amount", label: "Amount", width: 90, type: "textField", dataFormat: "currency", placeholder: "$0.00" }
        ],
        defaultRowCount: 3
    },
    timesheet: {
        id: "timesheet",
        title: "Weekly Timesheet & Shift Log",
        rowHeight: 22,
        headerHeight: 24,
        columns: [
            { id: "day", label: "Day", width: 85, type: "staticText", defaultValue: "Monday" },
            { id: "start_time", label: "Start Time", width: 85, type: "textField", dataFormat: "time", placeholder: "09:00 AM" },
            { id: "end_time", label: "End Time", width: 85, type: "textField", dataFormat: "time", placeholder: "05:00 PM" },
            { id: "break_mins", label: "Break (Min)", width: 75, type: "textField", dataFormat: "integer", placeholder: "30" },
            { id: "total_hours", label: "Total Hrs", width: 80, type: "textField", dataFormat: "number", placeholder: "7.5" }
        ],
        defaultRowCount: 5,
        rowLabels: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    },
    signoff: {
        id: "signoff",
        title: "Authorization & Sign-off Matrix",
        rowHeight: 36,
        headerHeight: 24,
        columns: [
            { id: "role", label: "Role / Department", width: 120, type: "staticText", defaultValue: "Approver" },
            { id: "signer_name", label: "Authorized Name", width: 140, type: "textField", placeholder: "Print Full Name" },
            { id: "sign_date", label: "Date", width: 85, type: "dateField", placeholder: "YYYY-MM-DD" },
            { id: "signature", label: "Signature", width: 110, type: "signature" }
        ],
        defaultRowCount: 3,
        rowLabels: ["Department Head", "Compliance Officer", "Final Approver"]
    },
    checklist: {
        id: "checklist",
        title: "Inspection / Quality Checklist",
        rowHeight: 22,
        headerHeight: 24,
        columns: [
            { id: "task_desc", label: "Requirement / Condition", width: 240, type: "staticText", defaultValue: "Item Verification" },
            { id: "pass", label: "Pass", width: 45, type: "checkBox" },
            { id: "fail", label: "Fail", width: 45, type: "checkBox" },
            { id: "na", label: "N/A", width: 45, type: "checkBox" },
            { id: "notes", label: "Notes / Action Item", width: 105, type: "textField", placeholder: "Comments" }
        ],
        defaultRowCount: 4,
        rowLabels: ["Structural Integrity", "Electrical / Power", "Safety Compliance", "Final Cleanliness"]
    },
    custom: {
        id: "custom",
        title: "Custom Data Grid",
        rowHeight: 22,
        headerHeight: 24,
        columns: [
            { id: "col_1", label: "Column 1", width: 140, type: "textField" },
            { id: "col_2", label: "Column 2", width: 140, type: "textField" },
            { id: "col_3", label: "Column 3", width: 140, type: "textField" }
        ],
        defaultRowCount: 3
    }
};

/**
 * Creates a complete structured table of form fields and header text elements.
 * 
 * @param {string|object} presetOrConfig - Preset key ("invoice", "timesheet", "signoff", "checklist", "custom") or custom config
 * @param {number} startX - Left origin on the canvas in points/pixels
 * @param {number} startY - Top origin on the canvas in points/pixels
 * @param {object} options - Optional page number, row count, theme color
 * @returns {Array<object>} Array of field objects representing the complete table grid
 */
export function createTableGrid(presetOrConfig, startX = 40, startY = 100, options = {}) {
    const pageNum = options.pageNum || 1;
    const tableId = `tbl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let config;
    if (typeof presetOrConfig === "string") {
        config = TABLE_PRESETS[presetOrConfig] || TABLE_PRESETS.custom;
    } else if (presetOrConfig && typeof presetOrConfig === "object") {
        if (presetOrConfig.cols && !presetOrConfig.columns) {
            const numCols = Math.max(1, Math.min(12, Number(presetOrConfig.cols) || 3));
            const numRows = Math.max(1, Math.min(30, Number(presetOrConfig.rows) || 3));
            const availableWidth = options.totalWidth || 450;
            const colWidth = Math.round(availableWidth / numCols);
            const generatedCols = [];
            for (let i = 0; i < numCols; i++) {
                generatedCols.push({
                    id: `col_${i + 1}`,
                    label: `Header ${i + 1}`,
                    width: colWidth,
                    type: "textField"
                });
            }
            config = {
                id: "custom",
                title: `${numCols}×${numRows} Table`,
                rowHeight: 22,
                headerHeight: 24,
                columns: generatedCols,
                defaultRowCount: numRows
            };
        } else {
            config = presetOrConfig;
        }
    } else {
        config = TABLE_PRESETS.custom;
    }

    const columns = config.columns || [];
    const rowCount = options.rowCount || config.defaultRowCount || 3;
    const headerHeight = config.headerHeight || 24;
    const rowHeight = config.rowHeight || 22;
    const rowLabels = config.rowLabels || [];

    const totalWidth = columns.reduce((acc, col) => acc + (col.width || 100), 0);
    const totalHeight = headerHeight + (rowCount * rowHeight);

    const tableFields = [];

    // 1. Build Header Row (Static Text / Badges)
    let currentX = startX;
    columns.forEach((col, colIdx) => {
        const colWidth = col.width || 100;
        const headerField = {
            id: generateFieldId(),
            type: "staticText",
            name: `${tableId}_hdr_${col.id || colIdx}`,
            label: col.label || `Col ${colIdx + 1}`,
            defaultValue: col.label || `Col ${colIdx + 1}`,
            x: Math.round(currentX),
            y: Math.round(startY),
            width: Math.round(colWidth),
            height: Math.round(headerHeight),
            page: pageNum,
            fontSize: 10,
            fontWeight: "bold",
            color: "#0f172a",
            textAlignment: col.type === "checkBox" || col.type === "radio" ? "center" : (col.dataFormat === "currency" || col.dataFormat === "number" ? "right" : "left"),
            borderStyle: "solid",
            borderColor: "#cbd5e1",
            borderWidth: 1,
            fillStyle: "#f1f5f9",
            tableId,
            tableRole: "header",
            tableRow: 0,
            tableCol: colIdx
        };
        tableFields.push(headerField);
        currentX += colWidth;
    });

    // 2. Build Data Rows (Inputs, Checkboxes, Signatures)
    for (let r = 0; r < rowCount; r++) {
        const rowY = startY + headerHeight + (r * rowHeight);
        currentX = startX;

        columns.forEach((col, c) => {
            const colWidth = col.width || 100;
            const fieldId = generateFieldId();
            const fieldType = col.type || "textField";
            const rowLabel = rowLabels[r];

            // Alternate row shading (subtle zebra)
            const rowBg = (r % 2 === 1) ? "#f8fafc" : "#ffffff";

            let fieldObj = {
                id: fieldId,
                type: fieldType,
                name: `${tableId}_r${r + 1}_${col.id || c}`,
                x: Math.round(currentX),
                y: Math.round(rowY),
                width: Math.round(colWidth),
                height: Math.round(rowHeight),
                page: pageNum,
                borderStyle: "solid",
                borderColor: "#e2e8f0",
                borderWidth: 1,
                fillStyle: rowBg,
                fontSize: 10,
                tableId,
                tableRole: "cell",
                tableRow: r + 1,
                tableCol: c
            };

            if (fieldType === "staticText") {
                fieldObj.defaultValue = (c === 0 && rowLabel) ? rowLabel : (col.defaultValue || "");
                fieldObj.label = fieldObj.defaultValue;
                fieldObj.fontWeight = "500";
                fieldObj.color = "#334155";
            } else if (fieldType === "checkBox") {
                fieldObj.value = "Yes";
                // Center the checkbox in the cell
                const boxSize = 13;
                fieldObj.width = Math.round(colWidth);
                fieldObj.height = Math.round(rowHeight);
                fieldObj.checkboxSize = boxSize;
            } else if (fieldType === "signature") {
                fieldObj.height = Math.max(rowHeight, 32);
            } else {
                fieldObj.autofill = col.autofill || "";
                fieldObj.dataFormat = col.dataFormat || "text";
                fieldObj.placeholder = col.placeholder || "";
                if (col.dataFormat === "currency" || col.dataFormat === "number") {
                    fieldObj.textAlignment = "right";
                }
            }

            tableFields.push(fieldObj);
            currentX += colWidth;
        });
    }

    return {
        tableId,
        fields: tableFields,
        bounds: {
            x: startX,
            y: startY,
            width: totalWidth,
            height: totalHeight
        },
        rowCount,
        colCount: columns.length
    };
}

/**
 * Appends a new data row to an existing table on the canvas.
 */
export function addRowToTable(tableId, allFields) {
    const tableCells = allFields.filter(f => f.tableId === tableId && f.tableRole === "cell");
    if (tableCells.length === 0) return [];

    const maxRow = Math.max(...tableCells.map(f => f.tableRow || 1));
    const lastRowCells = tableCells.filter(f => f.tableRow === maxRow).sort((a, b) => a.tableCol - b.tableCol);
    if (lastRowCells.length === 0) return [];

    const rowHeight = lastRowCells[0].height || 22;
    const newRowY = lastRowCells[0].y + rowHeight;
    const newRowIndex = maxRow + 1;

    const newCells = lastRowCells.map((templateCell, c) => {
        return {
            ...templateCell,
            id: generateFieldId(),
            name: `${tableId}_r${newRowIndex}_c${c}`,
            y: Math.round(newRowY),
            tableRow: newRowIndex,
            value: "",
            defaultValue: templateCell.type === "staticText" ? `Row ${newRowIndex}` : "",
            label: templateCell.type === "staticText" ? `Row ${newRowIndex}` : "",
            fillStyle: (newRowIndex % 2 === 0) ? "#f8fafc" : "#ffffff"
        };
    });

    return newCells;
}

/**
 * Deletes the specified row from a table and shifts subsequent rows upward.
 */
export function removeRowFromTable(tableId, rowIndex, allFields) {
    const tableCells = allFields.filter(f => f.tableId === tableId);
    const rowToDelete = tableCells.filter(f => f.tableRole === "cell" && f.tableRow === rowIndex);
    if (rowToDelete.length === 0) return { updatedFields: allFields, removedIds: [] };

    const removedIds = new Set(rowToDelete.map(f => f.id));
    const rowHeight = rowToDelete[0].height || 22;

    const updatedFields = allFields
        .filter(f => !removedIds.has(f.id))
        .map(f => {
            if (f.tableId === tableId && f.tableRole === "cell" && f.tableRow > rowIndex) {
                return {
                    ...f,
                    y: Math.round(f.y - rowHeight),
                    tableRow: f.tableRow - 1
                };
            }
            return f;
        });

    return { updatedFields, removedIds: Array.from(removedIds) };
}

/**
 * Appends a new column to an existing table on the canvas.
 * 
 * @param {string} tableId - Target table ID
 * @param {Array<object>} allFields - Current fields list
 * @param {number|null} targetCol - Target col index (defaults to rightmost column)
 * @returns {Array<object>} Newly created column cells
 */
export function addColumnToTable(tableId, allFields, targetCol = null) {
    const tableFields = allFields.filter(f => f.tableId === tableId);
    if (tableFields.length === 0) return [];

    const headerFields = tableFields.filter(f => f.tableRole === "header").sort((a, b) => a.tableCol - b.tableCol);
    if (headerFields.length === 0) return [];

    const maxCol = Math.max(...headerFields.map(f => f.tableCol || 0));
    const insertCol = targetCol !== null ? targetCol : maxCol + 1;
    const refCol = headerFields[headerFields.length - 1];
    const colWidth = refCol.width || 100;
    const newX = refCol.x + colWidth;

    const newCells = [];
    const pageNum = refCol.page || 1;

    // Header cell
    const newHeader = {
        id: generateFieldId(),
        type: "staticText",
        name: `${tableId}_hdr_${insertCol}`,
        label: `Header ${insertCol + 1}`,
        defaultValue: `Header ${insertCol + 1}`,
        x: Math.round(newX),
        y: Math.round(refCol.y),
        width: Math.round(colWidth),
        height: Math.round(refCol.height || 24),
        page: pageNum,
        fontSize: refCol.fontSize || 10,
        fontWeight: "bold",
        color: "#0f172a",
        textAlignment: "left",
        borderStyle: "solid",
        borderColor: "#cbd5e1",
        borderWidth: 1,
        fillStyle: "#f1f5f9",
        tableId,
        tableRole: "header",
        tableRow: 0,
        tableCol: insertCol
    };
    newCells.push(newHeader);

    // Data row cells
    const cellRows = {};
    tableFields.filter(f => f.tableRole === "cell").forEach(cell => {
        if (!cellRows[cell.tableRow]) cellRows[cell.tableRow] = [];
        cellRows[cell.tableRow].push(cell);
    });

    Object.keys(cellRows).forEach(rowStr => {
        const rowNum = parseInt(rowStr, 10);
        const rowCells = cellRows[rowNum];
        const templateCell = rowCells[rowCells.length - 1] || rowCells[0];
        const cellY = templateCell.y;
        const cellH = templateCell.height || 22;

        const newCell = {
            id: generateFieldId(),
            type: "textField",
            name: `${tableId}_r${rowNum}_c${insertCol}`,
            x: Math.round(newX),
            y: Math.round(cellY),
            width: Math.round(colWidth),
            height: Math.round(cellH),
            page: pageNum,
            borderStyle: "solid",
            borderColor: "#e2e8f0",
            borderWidth: 1,
            fillStyle: (rowNum % 2 === 0) ? "#f8fafc" : "#ffffff",
            fontSize: 10,
            tableId,
            tableRole: "cell",
            tableRow: rowNum,
            tableCol: insertCol,
            value: "",
            defaultValue: ""
        };
        newCells.push(newCell);
    });

    return newCells;
}

/**
 * Deletes the specified column from a table and shifts subsequent columns left.
 * 
 * @param {string} tableId - Target table ID
 * @param {number} colIndex - Column index to delete
 * @param {Array<object>} allFields - Current fields list
 * @returns {{ updatedFields: Array<object>, removedIds: Array<string> }}
 */
export function removeColumnFromTable(tableId, colIndex, allFields) {
    const tableFields = allFields.filter(f => f.tableId === tableId);
    const colToDelete = tableFields.filter(f => f.tableCol === colIndex);
    const totalCols = new Set(tableFields.map(f => f.tableCol)).size;

    // Do not delete if only 1 column remains
    if (colToDelete.length === 0 || totalCols <= 1) {
        return { updatedFields: allFields, removedIds: [] };
    }

    const removedIds = new Set(colToDelete.map(f => f.id));
    const colWidth = colToDelete[0].width || 100;

    const updatedFields = allFields
        .filter(f => !removedIds.has(f.id))
        .map(f => {
            if (f.tableId === tableId && f.tableCol > colIndex) {
                return {
                    ...f,
                    x: Math.round(f.x - colWidth),
                    tableCol: f.tableCol - 1
                };
            }
            return f;
        });

    return { updatedFields, removedIds: Array.from(removedIds) };
}

/**
 * Deletes all cells associated with a table.
 * 
 * @param {string} tableId - Target table ID
 * @param {Array<object>} allFields - Current fields list
 * @returns {{ updatedFields: Array<object>, removedIds: Array<string> }}
 */
export function deleteTable(tableId, allFields) {
    const removedIds = allFields.filter(f => f.tableId === tableId).map(f => f.id);
    const updatedFields = allFields.filter(f => f.tableId !== tableId);
    return { updatedFields, removedIds };
}

