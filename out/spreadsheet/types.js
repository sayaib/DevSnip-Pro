"use strict";
/** Shared shapes of the CSV & Excel viewer. Nothing here imports vscode. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatOf = exports.parseCellRef = exports.columnIndex = exports.columnName = exports.MAX_FILE_BYTES = exports.MAX_CELLS = exports.SpreadsheetError = exports.isCellLocked = void 0;
/** Whether a cell can't be edited because its sheet is protected in Excel. */
function isCellLocked(sheet, row, col) {
    const p = sheet.protection;
    if (!p)
        return false;
    const own = p.cells[`${row}:${col}`];
    if (own !== undefined)
        return own;
    if (p.rows[row] !== undefined)
        return p.rows[row];
    for (const [first, last, locked] of p.cols)
        if (col >= first && col <= last)
            return locked;
    return p.fallback;
}
exports.isCellLocked = isCellLocked;
class SpreadsheetError extends Error {
    constructor(message, hint) {
        super(message);
        this.hint = hint;
        this.name = "SpreadsheetError";
    }
}
exports.SpreadsheetError = SpreadsheetError;
/** Cells loaded per sheet before the rest are left out, so a huge file can't freeze the editor. */
exports.MAX_CELLS = 3000000;
/** Files above this size are refused before they are read. */
exports.MAX_FILE_BYTES = 150 * 1024 * 1024;
/** 0 → "A", 25 → "Z", 26 → "AA". */
function columnName(index) {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
}
exports.columnName = columnName;
/** "A" → 0, "AA" → 26; -1 for anything that isn't a column name. */
function columnIndex(name) {
    if (!/^[A-Za-z]{1,3}$/.test(name))
        return -1;
    let index = 0;
    for (const ch of name.toUpperCase())
        index = index * 26 + (ch.charCodeAt(0) - 64);
    return index - 1;
}
exports.columnIndex = columnIndex;
/** "B12" → { row: 11, col: 1 }. */
function parseCellRef(ref) {
    const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
    if (!match)
        return undefined;
    const row = Number(match[2]) - 1;
    const col = columnIndex(match[1]);
    return row >= 0 && col >= 0 ? { row, col } : undefined;
}
exports.parseCellRef = parseCellRef;
/** Which reader a file name needs, or undefined for files the viewer can't open. */
function formatOf(fileName) {
    const ext = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase();
    if (ext === "csv")
        return "csv";
    if (ext === "tsv" || ext === "tab")
        return "tsv";
    if (ext === "xlsx" || ext === "xlsm")
        return "xlsx";
    return undefined;
}
exports.formatOf = formatOf;
//# sourceMappingURL=types.js.map