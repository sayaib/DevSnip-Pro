/** Shared shapes of the CSV & Excel viewer. Nothing here imports vscode. */

/** A cell as the grid receives it. Dates and times arrive as ISO-like strings. */
export type CellValue = string | number | boolean | null;

export type SheetFormat = "csv" | "tsv" | "xlsx";

export interface SheetData {
  name: string;
  rows: CellValue[][];
  /** Widest row, in cells. */
  columnCount: number;
  /** "row:col" → text shown in place of the raw value (number formats, errors). */
  display?: Record<string, string>;
  /** "row:col" → formula, without the leading "=". */
  formulas?: Record<string, string>;
  /** Merged ranges such as "A1:C1". The value lives in the top-left cell. */
  merges?: string[];
  /** Rows dropped because the workbook was over the cell limit. */
  truncatedRows?: number;
  /** Set when the sheet is protected in Excel: which cells are locked (see isCellLocked). */
  protection?: SheetProtection;
}

/**
 * Locked cells of a protected sheet. Excel locks every cell unless its style
 * says otherwise; a cell without its own style takes its row's, then its
 * column's, then the default style's.
 */
export interface SheetProtection {
  /** "row:col" → locked, for cells with their own style. */
  cells: Record<string, boolean>;
  /** Row → locked, for rows with their own style. */
  rows: Record<number, boolean>;
  /** [first column, last column, locked], 0-based, for columns with their own style. */
  cols: Array<[number, number, boolean]>;
  /** Locked state of the default style. */
  fallback: boolean;
}

/** Whether a cell can't be edited because its sheet is protected in Excel. */
export function isCellLocked(sheet: SheetData, row: number, col: number): boolean {
  const p = sheet.protection;
  if (!p) return false;
  const own = p.cells[`${row}:${col}`];
  if (own !== undefined) return own;
  if (p.rows[row] !== undefined) return p.rows[row];
  for (const [first, last, locked] of p.cols) if (col >= first && col <= last) return locked;
  return p.fallback;
}

export interface SheetInfo {
  name: string;
  hidden: boolean;
}

export interface CsvOptions {
  /** Field separator; detected when omitted. */
  delimiter?: string;
}

export class SpreadsheetError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

/** Cells loaded per sheet before the rest are left out, so a huge file can't freeze the editor. */
export const MAX_CELLS = 3_000_000;
/** Files above this size are refused before they are read. */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** "A" → 0, "AA" → 26; -1 for anything that isn't a column name. */
export function columnIndex(name: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(name)) return -1;
  let index = 0;
  for (const ch of name.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** "B12" → { row: 11, col: 1 }. */
export function parseCellRef(ref: string): { row: number; col: number } | undefined {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
  if (!match) return undefined;
  const row = Number(match[2]) - 1;
  const col = columnIndex(match[1]);
  return row >= 0 && col >= 0 ? { row, col } : undefined;
}

/** Which reader a file name needs, or undefined for files the viewer can't open. */
export function formatOf(fileName: string): SheetFormat | undefined {
  const ext = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (ext === "csv") return "csv";
  if (ext === "tsv" || ext === "tab") return "tsv";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  return undefined;
}
