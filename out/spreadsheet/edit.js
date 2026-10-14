"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeCell = exports.cellAt = exports.WorkbookEditor = exports.MAX_EDIT_CELLS = exports.LOCKED_MESSAGE = void 0;
const types_1 = require("./types");
exports.LOCKED_MESSAGE = "That cell is locked: its sheet is protected in Excel.";
const LOCKED_HINT = "Unprotect the sheet in Excel (Review → Unprotect Sheet) to change locked cells. Cells formatted as unlocked can still be edited here.";
/** Most cells one edit may change, so a paste or clear can't freeze the editor. */
exports.MAX_EDIT_CELLS = 200000;
/**
 * The editable state of an open file. Edits change the parsed sheets in
 * place, so the grid and the saved file always agree, and keep enough to
 * write the file back with everything that wasn't edited left as it was.
 */
class WorkbookEditor {
    constructor(host) {
        this.host = host;
        this.tracked = new Map();
    }
    /** The edited sheets, for saving. */
    edits() {
        return this.tracked;
    }
    track(index) {
        let edits = this.tracked.get(index);
        if (!edits) {
            const sheet = this.host.sheet(index);
            if (sheet.truncatedRows)
                throw new types_1.SpreadsheetError("This sheet is too large to edit here.", "Only part of it was loaded, and saving would drop the rest.");
            edits = { sheet, rowOrigin: null, colOrigin: null, dirty: new Set() };
            this.tracked.set(index, edits);
        }
        return edits;
    }
    /** Sets cells from typed text. Rows past the end are added. */
    set(index, inputs) {
        if (inputs.length > exports.MAX_EDIT_CELLS)
            throw new types_1.SpreadsheetError(`That changes ${inputs.length.toLocaleString()} cells; one edit can change up to ${exports.MAX_EDIT_CELLS.toLocaleString()}.`);
        const edits = this.track(index);
        const sheet = edits.sheet;
        const before = [];
        const after = [];
        const rowCount = sheet.rows.length;
        for (const { r, c, text } of inputs) {
            if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || c > 16383 || r > 1048575)
                throw new types_1.SpreadsheetError("That cell is outside the sheet.");
            // Protected sheets never move rows or columns, so these are the cells' positions in the file.
            if ((0, types_1.isCellLocked)(sheet, r, c))
                throw new types_1.SpreadsheetError(exports.LOCKED_MESSAGE, LOCKED_HINT);
            const key = `${r}:${c}`;
            // Until rows move, positions are the file's own, past the last row too.
            const origin = edits.rowOrigin ? (r < edits.rowOrigin.length ? edits.rowOrigin[r] : -1) : r;
            const originCol = edits.colOrigin ? edits.colOrigin[c] ?? -1 : c;
            const typed = this.host.type(index, origin, originCol, String(text));
            const current = cellAt(sheet, r, c);
            if (sameCell(current, typed))
                continue;
            before.push({ ...current, dirty: edits.dirty.has(key) });
            after.push({ r, c, ...typed });
        }
        if (!after.length)
            return undefined;
        const apply = (cells, dirty) => {
            cells.forEach((cell, i) => {
                writeCell(sheet, cell);
                if (edits.rowOrigin)
                    while (edits.rowOrigin.length < sheet.rows.length)
                        edits.rowOrigin.push(-1);
                const key = `${cell.r}:${cell.c}`;
                if (dirty(cell, i))
                    edits.dirty.add(key);
                else
                    edits.dirty.delete(key);
            });
            // Undoing an edit that added rows takes them away again.
            if (sheet.rows.length > rowCount)
                trimRows(sheet, rowCount, edits);
            return { kind: "cells", sheet: index, cells, columnCount: sheet.columnCount, rowCount: sheet.rows.length };
        };
        const redo = () => apply(after, () => true);
        const undo = () => apply(before.map(({ dirty: _d, ...cell }) => cell), (_c, i) => before[i].dirty);
        const patch = redo();
        const count = after.length;
        return { label: count === 1 ? "Edit cell" : `Edit ${count} cells`, patch, undo, redo };
    }
    /** Inserts empty rows. Adding them at the end moves nothing, so it works even where inserting can't. */
    insertRows(index, at, count) {
        const edits = this.track(index);
        const sheet = edits.sheet;
        if (!Number.isInteger(at) || at < 0 || at > sheet.rows.length || !Number.isInteger(count) || count < 1 || count > 10000)
            throw new types_1.SpreadsheetError("Rows can't be inserted there.");
        const atEnd = at === sheet.rows.length;
        if (!atEnd || sheet.protection)
            this.checkStructure(sheet);
        return this.structural(index, edits, count === 1 ? (atEnd ? "Add row" : "Insert row") : `Insert ${count} rows`, () => {
            const before = sheet.rows.length;
            sheet.rows.splice(at, 0, ...Array.from({ length: count }, () => []));
            if (atEnd && !edits.rowOrigin)
                return;
            edits.rowOrigin ?? (edits.rowOrigin = identity(before));
            edits.rowOrigin.splice(at, 0, ...Array(count).fill(-1));
            if (!atEnd)
                shiftKeys(sheet, edits, "row", at, count);
        });
    }
    deleteRows(index, rows) {
        const edits = this.track(index);
        const sheet = edits.sheet;
        this.checkStructure(sheet);
        const list = [...new Set(rows)].filter(r => Number.isInteger(r) && r >= 0 && r < sheet.rows.length).sort((a, b) => b - a);
        if (!list.length)
            throw new types_1.SpreadsheetError("Select the rows to delete.");
        return this.structural(index, edits, list.length === 1 ? "Delete row" : `Delete ${list.length} rows`, () => {
            edits.rowOrigin ?? (edits.rowOrigin = identity(sheet.rows.length));
            for (const r of list) {
                sheet.rows.splice(r, 1);
                edits.rowOrigin.splice(r, 1);
                dropKeys(sheet, edits, "row", r);
                shiftKeys(sheet, edits, "row", r + 1, -1);
            }
        });
    }
    /** Inserts empty columns; adding them after the last one works even where inserting can't. */
    insertColumns(index, at, count) {
        const edits = this.track(index);
        const sheet = edits.sheet;
        if (!Number.isInteger(at) || at < 0 || at > sheet.columnCount || !Number.isInteger(count) || count < 1 || sheet.columnCount + count > 16384)
            throw new types_1.SpreadsheetError("Columns can't be inserted there.");
        const atEnd = at === sheet.columnCount;
        if (!atEnd || sheet.protection)
            this.checkStructure(sheet);
        return this.structural(index, edits, count === 1 ? (atEnd ? "Add column" : "Insert column") : `Insert ${count} columns`, () => {
            if (atEnd && !edits.colOrigin) {
                sheet.columnCount += count;
                return;
            }
            edits.colOrigin ?? (edits.colOrigin = identity(sheet.columnCount));
            for (const row of sheet.rows)
                if (row.length > at)
                    row.splice(at, 0, ...Array(count).fill(null));
            edits.colOrigin.splice(at, 0, ...Array(count).fill(-1));
            sheet.columnCount += count;
            shiftKeys(sheet, edits, "col", at, count);
        });
    }
    deleteColumns(index, cols) {
        const edits = this.track(index);
        const sheet = edits.sheet;
        this.checkStructure(sheet);
        const list = [...new Set(cols)].filter(c => Number.isInteger(c) && c >= 0 && c < sheet.columnCount).sort((a, b) => b - a);
        if (!list.length)
            throw new types_1.SpreadsheetError("Select the columns to delete.");
        if (list.length >= sheet.columnCount)
            throw new types_1.SpreadsheetError("A sheet needs at least one column.");
        return this.structural(index, edits, list.length === 1 ? "Delete column" : `Delete ${list.length} columns`, () => {
            edits.colOrigin ?? (edits.colOrigin = identity(sheet.columnCount));
            for (const c of list) {
                for (const row of sheet.rows)
                    if (row.length > c)
                        row.splice(c, 1);
                edits.colOrigin.splice(c, 1);
                sheet.columnCount--;
                dropKeys(sheet, edits, "col", c);
                shiftKeys(sheet, edits, "col", c + 1, -1);
            }
        });
    }
    checkStructure(sheet) {
        if (sheet.protection)
            throw new types_1.SpreadsheetError("Rows and columns can't be added or deleted here: the sheet is protected in Excel.", LOCKED_HINT);
        const lock = this.host.structureLock();
        if (lock)
            throw new types_1.SpreadsheetError(`Rows and columns can't be inserted or deleted here: ${lock}.`, "Cell values can still be edited. Insert or delete rows in Excel, which updates every reference to them.");
    }
    /** Structural edits restore a snapshot on undo: moving rows touches too much to undo piece by piece. */
    structural(index, edits, label, change) {
        const before = snapshot(edits);
        change();
        const after = snapshot(edits);
        return {
            label,
            patch: { kind: "structure", sheet: index },
            undo: () => { restore(edits, before); return { kind: "structure", sheet: index }; },
            redo: () => { restore(edits, after); return { kind: "structure", sheet: index }; }
        };
    }
}
exports.WorkbookEditor = WorkbookEditor;
function cellAt(sheet, r, c) {
    const key = `${r}:${c}`;
    const v = sheet.rows[r]?.[c];
    const cell = { r, c, v: v === undefined ? null : v };
    if (sheet.formulas?.[key] !== undefined)
        cell.f = sheet.formulas[key];
    if (sheet.display?.[key] !== undefined)
        cell.d = sheet.display[key];
    return cell;
}
exports.cellAt = cellAt;
function sameCell(a, b) {
    const empty = (v) => v === null || v === "";
    return (a.v === b.v || (empty(a.v) && empty(b.v))) && (a.f ?? "") === (b.f ?? "") && (a.d ?? "") === (b.d ?? "");
}
/** Writes one cell into a sheet; the grid does the same with the patches it receives. */
function writeCell(sheet, cell) {
    const key = `${cell.r}:${cell.c}`;
    while (sheet.rows.length <= cell.r)
        sheet.rows.push([]);
    const row = sheet.rows[cell.r];
    if (cell.v !== null || cell.c < row.length) {
        while (row.length < cell.c)
            row.push(null);
        row[cell.c] = cell.v;
    }
    while (row.length && (row[row.length - 1] === null || row[row.length - 1] === undefined))
        row.pop();
    if (cell.f !== undefined)
        (sheet.formulas ?? (sheet.formulas = {}))[key] = cell.f;
    else if (sheet.formulas)
        delete sheet.formulas[key];
    if (cell.d !== undefined)
        (sheet.display ?? (sheet.display = {}))[key] = cell.d;
    else if (sheet.display)
        delete sheet.display[key];
    if (cell.c + 1 > sheet.columnCount && (cell.v !== null || cell.f !== undefined))
        sheet.columnCount = cell.c + 1;
}
exports.writeCell = writeCell;
/** Drops rows from `from` on when they are empty again (an undone edit past the end). */
function trimRows(sheet, from, edits) {
    while (sheet.rows.length > from && !sheet.rows[sheet.rows.length - 1].length) {
        sheet.rows.pop();
        if (edits.rowOrigin && edits.rowOrigin.length > sheet.rows.length)
            edits.rowOrigin.length = sheet.rows.length;
    }
}
function identity(n) {
    return Array.from({ length: n }, (_v, i) => i);
}
function rekey(key, axis, from, delta) {
    const [r, c] = key.split(":").map(Number);
    if (axis === "row")
        return r >= from ? `${r + delta}:${c}` : key;
    return c >= from ? `${r}:${c + delta}` : key;
}
function shiftKeys(sheet, edits, axis, from, delta) {
    const shiftMap = (map) => {
        if (!map)
            return map;
        const out = {};
        for (const key in map)
            out[rekey(key, axis, from, delta)] = map[key];
        return out;
    };
    sheet.formulas = shiftMap(sheet.formulas);
    sheet.display = shiftMap(sheet.display);
    // Cells that only moved stay clean: the writer finds them through rowOrigin and colOrigin.
    edits.dirty = new Set([...edits.dirty].map(key => rekey(key, axis, from, delta)));
}
function dropKeys(sheet, edits, axis, at) {
    const hit = (key) => Number(key.split(":")[axis === "row" ? 0 : 1]) === at;
    for (const map of [sheet.formulas, sheet.display])
        if (map)
            for (const key of Object.keys(map))
                if (hit(key))
                    delete map[key];
    for (const key of [...edits.dirty])
        if (hit(key))
            edits.dirty.delete(key);
}
function snapshot(edits) {
    const { sheet } = edits;
    return {
        rows: sheet.rows.map(row => row.slice()),
        display: sheet.display ? { ...sheet.display } : undefined,
        formulas: sheet.formulas ? { ...sheet.formulas } : undefined,
        columnCount: sheet.columnCount,
        rowOrigin: edits.rowOrigin ? edits.rowOrigin.slice() : null,
        colOrigin: edits.colOrigin ? edits.colOrigin.slice() : null,
        dirty: new Set(edits.dirty)
    };
}
function restore(edits, snap) {
    const { sheet } = edits;
    sheet.rows = snap.rows.map(row => row.slice());
    sheet.display = snap.display ? { ...snap.display } : undefined;
    sheet.formulas = snap.formulas ? { ...snap.formulas } : undefined;
    sheet.columnCount = snap.columnCount;
    edits.rowOrigin = snap.rowOrigin ? snap.rowOrigin.slice() : null;
    edits.colOrigin = snap.colOrigin ? snap.colOrigin.slice() : null;
    edits.dirty = new Set(snap.dirty);
}
//# sourceMappingURL=edit.js.map