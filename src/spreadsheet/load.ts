import { csvLine, decodeText, encodeText, lineEndings, parseCsv } from "./csv";
import { GENERAL, typeCellText, XlsxWorkbook } from "./xlsx";
import type { CellTyper, WorkbookEditor } from "./edit";
import { MAX_FILE_BYTES, SheetData, SheetFormat, SheetInfo, SpreadsheetError } from "./types";

/** What the grid is told about an opened file before it asks for a sheet. */
export interface FileSummary {
  name: string;
  format: SheetFormat;
  size: number;
  sheets: SheetInfo[];
  /** CSV/TSV only. */
  delimiter?: string;
  encoding?: string;
}

export interface LoadedSpreadsheet {
  summary: FileSummary;
  sheet(index: number): SheetData;
  /** What typed text becomes in a cell (by its position in the file as opened). */
  type: CellTyper;
  /** Why rows and columns can't be inserted or deleted, if they can't. */
  structureLock(): string | undefined;
  /** The file's bytes with the editor's changes; note says if the encoding had to change. */
  serialize(editor: WorkbookEditor): { bytes: Buffer; note?: string };
}

/** Opens a file's bytes as a CSV/TSV text or an .xlsx workbook. Pure: no vscode, no file system. */
export function loadSpreadsheet(bytes: Uint8Array, name: string, format: SheetFormat, delimiter?: string): LoadedSpreadsheet {
  if (bytes.length > MAX_FILE_BYTES) {
    throw new SpreadsheetError(`This file is ${Math.round(bytes.length / 1024 / 1024)} MB; the viewer opens files up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`, "Split it, or filter it down first.");
  }
  if (format === "xlsx") {
    const workbook = new XlsxWorkbook(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return {
      summary: { name, format, size: bytes.length, sheets: workbook.sheets },
      sheet: index => workbook.sheet(index),
      type: (index, row, col, text) => typeCellText(text, row >= 0 || col >= 0 ? workbook.styleAt(index, row, col) : GENERAL, workbook.is1904),
      structureLock: () => workbook.structureLock(),
      serialize: editor => ({ bytes: workbook.save(editor.edits()) })
    };
  }
  const { text, encoding } = decodeText(bytes);
  return loadText(text, name, format, delimiter ?? (format === "tsv" ? "\t" : undefined), { size: bytes.length, encoding });
}

/** Parses CSV/TSV text, e.g. pasted into the viewer. */
export function loadText(text: string, name: string, format: SheetFormat = "csv", delimiter?: string, extra: { size?: number; encoding?: string } = {}): LoadedSpreadsheet {
  if (/^\s*PK\u0003\u0004/.test(text)) throw new SpreadsheetError("This looks like an Excel workbook, not CSV text.", "Open the .xlsx file itself instead of pasting it.");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const { spans, ...sheet } = parseCsv(text, { delimiter, spans: true });
  sheet.name = name.replace(/\.[^.]+$/, "") || "Sheet1";
  const { eol, trailing } = lineEndings(text);
  return {
    summary: { name, format, size: extra.size ?? text.length, sheets: [{ name: sheet.name, hidden: false }], delimiter: sheet.delimiter, encoding: extra.encoding },
    sheet: () => sheet,
    type: (_index, _row, _col, value) => ({ v: value }),
    structureLock: () => undefined,
    serialize: editor => {
      const edits = editor.edits().get(0);
      const dirtyRows = new Set([...edits?.dirty ?? []].map(key => Number(key.split(":")[0])));
      // Rows nobody touched are written exactly as they were read: quoting, spacing and all.
      const lines = sheet.rows.map((row, r) => {
        const origin = edits?.rowOrigin ? edits.rowOrigin[r] : r;
        if (!edits?.colOrigin && !dirtyRows.has(r) && origin >= 0 && spans && spans[origin * 2 + 1] !== undefined) return text.slice(spans[origin * 2], spans[origin * 2 + 1]);
        // Edited and new rows get every column's separator, so the file stays rectangular.
        return csvLine(row.length < sheet.columnCount ? [...row, ...Array(sheet.columnCount - row.length).fill("")] : row, sheet.delimiter);
      });
      const out = lines.join(eol) + (trailing && lines.length ? eol : "");
      const encoded = encodeText(out, extra.encoding);
      return { bytes: encoded.bytes, note: extra.encoding && encoded.encoding !== extra.encoding ? `Saved as ${encoded.encoding}: the text has characters ${extra.encoding} can't hold.` : undefined };
    }
  };
}
