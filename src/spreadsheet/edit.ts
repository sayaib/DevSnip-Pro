import { CellValue, isCellLocked, SheetData, SpreadsheetError } from "./types";
import type { SheetEdits } from "./xlsx-write";

/** A cell as the editor changed it; d and f are the display text and formula, when there are any. */
export interface CellPatch {
  r: number;
  c: number;
  v: CellValue;
  f?: string;
  d?: string;
}

/** What the grid has to redo after an edit: patch a few cells, or reload the sheet after rows or columns moved. */
export type Patch =
  | { kind: "cells"; sheet: number; cells: CellPatch[]; columnCount: number; rowCount: number }
  | { kind: "structure"; sheet: number };

/** One step on the undo stack. Each call applies it and returns what the grid must update. */
export interface Edit {
  label: string;
  /** What the first application changed. */
  patch: Patch;
  undo(): Patch;
  redo(): Patch;
}

/** Turns typed text into a cell value, for a cell at a position in the file as opened (-1 for new cells). */
export type CellTyper = (sheet: number, row: number, col: number, text: string) => { v: CellValue; f?: string; d?: string };

export interface EditHost {
  sheet(index: number): SheetData;
  type: CellTyper;
  /** Why rows and columns can't be inserted or deleted, if they can't. */
  structureLock(): string | undefined;
}

interface Snapshot {
  rows: CellValue[][];
  display?: Record<string, string>;
  formulas?: Record<string, string>;
  columnCount: number;
  rowOrigin: number[] | null;
  colOrigin: number[] | null;
  dirty: Set<string>;
}

export const LOCKED_MESSAGE = "That cell is locked: its sheet is protected in Excel.";
const LOCKED_HINT = "Unprotect the sheet in Excel (Review → Unprotect Sheet) to change locked cells. Cells formatted as unlocked can still be edited here.";

/** Most cells one edit may change, so a paste or clear can't freeze the editor. */
export const MAX_EDIT_CELLS = 200_000;

/**
 * The editable state of an open file. Edits change the parsed sheets in
 * place, so the grid and the saved file always agree, and keep enough to
 * write the file back with everything that wasn't edited left as it was.
 */
export class WorkbookEditor {
  private readonly tracked = new Map<number, SheetEdits>();

  constructor(private readonly host: EditHost) {}

  /** The edited sheets, for saving. */
  edits(): Map<number, SheetEdits> {
    return this.tracked;
  }

  private track(index: number): SheetEdits {
    let edits = this.tracked.get(index);
    if (!edits) {
      const sheet = this.host.sheet(index);
      if (sheet.truncatedRows) throw new SpreadsheetError("This sheet is too large to edit here.", "Only part of it was loaded, and saving would drop the rest.");
      edits = { sheet, rowOrigin: null, colOrigin: null, dirty: new Set() };
      this.tracked.set(index, edits);
    }
    return edits;
  }

  /** Sets cells from typed text. Rows past the end are added. */
  set(index: number, inputs: Array<{ r: number; c: number; text: string }>): Edit | undefined {
    if (inputs.length > MAX_EDIT_CELLS) throw new SpreadsheetError(`That changes ${inputs.length.toLocaleString()} cells; one edit can change up to ${MAX_EDIT_CELLS.toLocaleString()}.`);
    const edits = this.track(index);
    const sheet = edits.sheet;
    const before: Array<CellPatch & { dirty: boolean }> = [];
    const after: CellPatch[] = [];
    const rowCount = sheet.rows.length;
    for (const { r, c, text } of inputs) {
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || c > 16383 || r > 1048575) throw new SpreadsheetError("That cell is outside the sheet.");
      // Protected sheets never move rows or columns, so these are the cells' positions in the file.
      if (isCellLocked(sheet, r, c)) throw new SpreadsheetError(LOCKED_MESSAGE, LOCKED_HINT);
      const key = `${r}:${c}`;
      // Until rows move, positions are the file's own, past the last row too.
      const origin = edits.rowOrigin ? (r < edits.rowOrigin.length ? edits.rowOrigin[r] : -1) : r;
      const originCol = edits.colOrigin ? edits.colOrigin[c] ?? -1 : c;
      const typed = this.host.type(index, origin, originCol, String(text));
      const current = cellAt(sheet, r, c);
      if (sameCell(current, typed)) continue;
      before.push({ ...current, dirty: edits.dirty.has(key) });
      after.push({ r, c, ...typed });
    }
    if (!after.length) return undefined;
    const apply = (cells: CellPatch[], dirty: (cell: CellPatch, i: number) => boolean): Patch => {
      cells.forEach((cell, i) => {
        writeCell(sheet, cell);
        if (edits.rowOrigin) while (edits.rowOrigin.length < sheet.rows.length) edits.rowOrigin.push(-1);
        const key = `${cell.r}:${cell.c}`;
        if (dirty(cell, i)) edits.dirty.add(key); else edits.dirty.delete(key);
      });
      // Undoing an edit that added rows takes them away again.
      if (sheet.rows.length > rowCount) trimRows(sheet, rowCount, edits);
      return { kind: "cells", sheet: index, cells, columnCount: sheet.columnCount, rowCount: sheet.rows.length };
    };
    const redo = () => apply(after, () => true);
    const undo = () => apply(before.map(({ dirty: _d, ...cell }) => cell), (_c, i) => before[i].dirty);
    const patch = redo();
    const count = after.length;
    return { label: count === 1 ? "Edit cell" : `Edit ${count} cells`, patch, undo, redo };
  }

  /** Inserts empty rows. Adding them at the end moves nothing, so it works even where inserting can't. */
  insertRows(index: number, at: number, count: number): Edit {
    const edits = this.track(index);
    const sheet = edits.sheet;
    if (!Number.isInteger(at) || at < 0 || at > sheet.rows.length || !Number.isInteger(count) || count < 1 || count > 10000) throw new SpreadsheetError("Rows can't be inserted there.");
    const atEnd = at === sheet.rows.length;
    if (!atEnd || sheet.protection) this.checkStructure(sheet);
    return this.structural(index, edits, count === 1 ? (atEnd ? "Add row" : "Insert row") : `Insert ${count} rows`, () => {
      const before = sheet.rows.length;
      sheet.rows.splice(at, 0, ...Array.from({ length: count }, () => [] as CellValue[]));
      if (atEnd && !edits.rowOrigin) return;
      edits.rowOrigin ??= identity(before);
      edits.rowOrigin.splice(at, 0, ...Array(count).fill(-1));
      if (!atEnd) shiftKeys(sheet, edits, "row", at, count);
    });
  }

  deleteRows(index: number, rows: number[]): Edit {
    const edits = this.track(index);
    const sheet = edits.sheet;
    this.checkStructure(sheet);
    const list = [...new Set(rows)].filter(r => Number.isInteger(r) && r >= 0 && r < sheet.rows.length).sort((a, b) => b - a);
    if (!list.length) throw new SpreadsheetError("Select the rows to delete.");
    return this.structural(index, edits, list.length === 1 ? "Delete row" : `Delete ${list.length} rows`, () => {
      edits.rowOrigin ??= identity(sheet.rows.length);
      for (const r of list) {
        sheet.rows.splice(r, 1);
        edits.rowOrigin.splice(r, 1);
        dropKeys(sheet, edits, "row", r);
        shiftKeys(sheet, edits, "row", r + 1, -1);
      }
    });
  }

  /** Inserts empty columns; adding them after the last one works even where inserting can't. */
  insertColumns(index: number, at: number, count: number): Edit {
    const edits = this.track(index);
    const sheet = edits.sheet;
    if (!Number.isInteger(at) || at < 0 || at > sheet.columnCount || !Number.isInteger(count) || count < 1 || sheet.columnCount + count > 16384) throw new SpreadsheetError("Columns can't be inserted there.");
    const atEnd = at === sheet.columnCount;
    if (!atEnd || sheet.protection) this.checkStructure(sheet);
    return this.structural(index, edits, count === 1 ? (atEnd ? "Add column" : "Insert column") : `Insert ${count} columns`, () => {
      if (atEnd && !edits.colOrigin) { sheet.columnCount += count; return; }
      edits.colOrigin ??= identity(sheet.columnCount);
      for (const row of sheet.rows) if (row.length > at) row.splice(at, 0, ...Array(count).fill(null));
      edits.colOrigin.splice(at, 0, ...Array(count).fill(-1));
      sheet.columnCount += count;
      shiftKeys(sheet, edits, "col", at, count);
    });
  }

  deleteColumns(index: number, cols: number[]): Edit {
    const edits = this.track(index);
    const sheet = edits.sheet;
    this.checkStructure(sheet);
    const list = [...new Set(cols)].filter(c => Number.isInteger(c) && c >= 0 && c < sheet.columnCount).sort((a, b) => b - a);
    if (!list.length) throw new SpreadsheetError("Select the columns to delete.");
    if (list.length >= sheet.columnCount) throw new SpreadsheetError("A sheet needs at least one column.");
    return this.structural(index, edits, list.length === 1 ? "Delete column" : `Delete ${list.length} columns`, () => {
      edits.colOrigin ??= identity(sheet.columnCount);
      for (const c of list) {
        for (const row of sheet.rows) if (row.length > c) row.splice(c, 1);
        edits.colOrigin.splice(c, 1);
        sheet.columnCount--;
        dropKeys(sheet, edits, "col", c);
        shiftKeys(sheet, edits, "col", c + 1, -1);
      }
    });
  }

  private checkStructure(sheet: SheetData): void {
    if (sheet.protection) throw new SpreadsheetError("Rows and columns can't be added or deleted here: the sheet is protected in Excel.", LOCKED_HINT);
    const lock = this.host.structureLock();
    if (lock) throw new SpreadsheetError(`Rows and columns can't be inserted or deleted here: ${lock}.`, "Cell values can still be edited. Insert or delete rows in Excel, which updates every reference to them.");
  }

  /** Structural edits restore a snapshot on undo: moving rows touches too much to undo piece by piece. */
  private structural(index: number, edits: SheetEdits, label: string, change: () => void): Edit {
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

export function cellAt(sheet: SheetData, r: number, c: number): CellPatch {
  const key = `${r}:${c}`;
  const v = sheet.rows[r]?.[c];
  const cell: CellPatch = { r, c, v: v === undefined ? null : v };
  if (sheet.formulas?.[key] !== undefined) cell.f = sheet.formulas[key];
  if (sheet.display?.[key] !== undefined) cell.d = sheet.display[key];
  return cell;
}

function sameCell(a: CellPatch, b: { v: CellValue; f?: string; d?: string }): boolean {
  const empty = (v: CellValue) => v === null || v === "";
  return (a.v === b.v || (empty(a.v) && empty(b.v))) && (a.f ?? "") === (b.f ?? "") && (a.d ?? "") === (b.d ?? "");
}

/** Writes one cell into a sheet; the grid does the same with the patches it receives. */
export function writeCell(sheet: SheetData, cell: CellPatch): void {
  const key = `${cell.r}:${cell.c}`;
  while (sheet.rows.length <= cell.r) sheet.rows.push([]);
  const row = sheet.rows[cell.r];
  if (cell.v !== null || cell.c < row.length) {
    while (row.length < cell.c) row.push(null);
    row[cell.c] = cell.v;
  }
  while (row.length && (row[row.length - 1] === null || row[row.length - 1] === undefined)) row.pop();
  if (cell.f !== undefined) (sheet.formulas ??= {})[key] = cell.f; else if (sheet.formulas) delete sheet.formulas[key];
  if (cell.d !== undefined) (sheet.display ??= {})[key] = cell.d; else if (sheet.display) delete sheet.display[key];
  if (cell.c + 1 > sheet.columnCount && (cell.v !== null || cell.f !== undefined)) sheet.columnCount = cell.c + 1;
}

/** Drops rows from `from` on when they are empty again (an undone edit past the end). */
function trimRows(sheet: SheetData, from: number, edits: SheetEdits): void {
  while (sheet.rows.length > from && !sheet.rows[sheet.rows.length - 1].length) {
    sheet.rows.pop();
    if (edits.rowOrigin && edits.rowOrigin.length > sheet.rows.length) edits.rowOrigin.length = sheet.rows.length;
  }
}

function identity(n: number): number[] {
  return Array.from({ length: n }, (_v, i) => i);
}

function rekey(key: string, axis: "row" | "col", from: number, delta: number): string {
  const [r, c] = key.split(":").map(Number);
  if (axis === "row") return r >= from ? `${r + delta}:${c}` : key;
  return c >= from ? `${r}:${c + delta}` : key;
}

function shiftKeys(sheet: SheetData, edits: SheetEdits, axis: "row" | "col", from: number, delta: number): void {
  const shiftMap = (map?: Record<string, string>) => {
    if (!map) return map;
    const out: Record<string, string> = {};
    for (const key in map) out[rekey(key, axis, from, delta)] = map[key];
    return out;
  };
  sheet.formulas = shiftMap(sheet.formulas);
  sheet.display = shiftMap(sheet.display);
  // Cells that only moved stay clean: the writer finds them through rowOrigin and colOrigin.
  edits.dirty = new Set([...edits.dirty].map(key => rekey(key, axis, from, delta)));
}

function dropKeys(sheet: SheetData, edits: SheetEdits, axis: "row" | "col", at: number): void {
  const hit = (key: string) => Number(key.split(":")[axis === "row" ? 0 : 1]) === at;
  for (const map of [sheet.formulas, sheet.display]) if (map) for (const key of Object.keys(map)) if (hit(key)) delete map[key];
  for (const key of [...edits.dirty]) if (hit(key)) edits.dirty.delete(key);
}

function snapshot(edits: SheetEdits): Snapshot {
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

function restore(edits: SheetEdits, snap: Snapshot): void {
  const { sheet } = edits;
  sheet.rows = snap.rows.map(row => row.slice());
  sheet.display = snap.display ? { ...snap.display } : undefined;
  sheet.formulas = snap.formulas ? { ...snap.formulas } : undefined;
  sheet.columnCount = snap.columnCount;
  edits.rowOrigin = snap.rowOrigin ? snap.rowOrigin.slice() : null;
  edits.colOrigin = snap.colOrigin ? snap.colOrigin.slice() : null;
  edits.dirty = new Set(snap.dirty);
}
