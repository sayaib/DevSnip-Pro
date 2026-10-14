import { writeZip, ZipReader, RawEntry } from "./zip";
import { attr, CellStyle, dirOf, relsPathOf } from "./xlsx";
import { CellValue, columnName, parseCellRef, SheetData } from "./types";

/** What changed in one worksheet, as tracked by the editor (see edit.ts). */
export interface SheetEdits {
  /** The sheet as it is now. */
  sheet: SheetData;
  /** Current row → row in the file as opened (-1 for a new row); null while no row was inserted or deleted. */
  rowOrigin: number[] | null;
  /** Current column → column in the file as opened; null while no column was inserted or deleted. */
  colOrigin: number[] | null;
  /** "row:col" (current positions) of cells whose value was edited. */
  dirty: Set<string>;
}

interface OriginalCell {
  attrs: string;
  full: string;
}

interface OriginalRow {
  attrs: string;
  cells: Map<number, OriginalCell>;
}

/**
 * Rewrites a workbook package with edited worksheets.
 *
 * Only each edited sheet's <sheetData> (and <dimension>) is regenerated, and
 * inside it every cell that wasn't edited is copied as it was, so styles,
 * shared strings, formulas and cached values survive. Edited text is written
 * as inline strings, which leaves the shared-string table untouched. Every
 * other part (styles, other sheets, charts, macros) is copied byte for byte.
 * The calculation chain is dropped and a full recalculation requested, so
 * Excel recomputes formulas that depend on edited cells when it opens the file.
 */
export function rewriteWorkbook(zip: ZipReader, workbookPath: string, sheets: Array<{ path: string; edits: SheetEdits; styleAt: (row: number, col: number) => CellStyle; styleIdAt: (row: number, col: number) => number }>, date1904: boolean): Buffer {
  const replaced = new Map<string, string>();
  let hasFormulas = false;
  for (const { path, edits, styleAt, styleIdAt } of sheets) {
    const xml = zip.text(path) ?? "";
    replaced.set(path, rewriteSheet(xml, edits, styleAt, styleIdAt, date1904));
    if (/<(?:\w+:)?f[\s>/]/.test(xml) || Object.keys(edits.sheet.formulas ?? {}).length) hasFormulas = true;
  }

  // The calculation chain lists formula cells by address; a stale one makes Excel "repair" the file.
  const relsPath = relsPathOf(workbookPath);
  const rels = zip.text(relsPath) ?? "";
  const chain = /<(?:\w+:)?Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/.exec(rels);
  const drop = new Set<string>();
  if (chain) {
    const target = attr(chain[0].replace(/^<[^\s]+/, ""), "Target") ?? "calcChain.xml";
    const chainPath = target.startsWith("/") ? target.slice(1) : `${dirOf(workbookPath) ? `${dirOf(workbookPath)}/` : ""}${target}`;
    drop.add(chainPath);
    replaced.set(relsPath, rels.replace(chain[0], ""));
    const types = zip.text("[Content_Types].xml");
    if (types) replaced.set("[Content_Types].xml", types.replace(new RegExp(`<(?:\\w+:)?Override\\b[^>]*PartName="/${escapeRegExp(chainPath)}"[^>]*/>`), ""));
    hasFormulas = true;
  }
  if (hasFormulas) replaced.set(workbookPath, requestFullCalc(zip.text(workbookPath) ?? ""));

  const entries: Array<RawEntry | { name: string; content: Buffer }> = [];
  for (const name of zip.names()) {
    if (drop.has(name)) continue;
    const content = replaced.get(name);
    entries.push(content !== undefined ? { name, content: Buffer.from(content, "utf8") } : zip.raw(name)!);
  }
  return writeZip(entries);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Adds fullCalcOnLoad="1" to <calcPr>, creating it where the schema expects it. */
function requestFullCalc(workbook: string): string {
  const calc = /<((?:\w+:)?)calcPr\b([^>]*?)(\/?)>/.exec(workbook);
  if (calc) {
    const attrs = /\sfullCalcOnLoad="[^"]*"/.test(calc[2]) ? calc[2].replace(/\sfullCalcOnLoad="[^"]*"/, ' fullCalcOnLoad="1"') : `${calc[2]} fullCalcOnLoad="1"`;
    return workbook.replace(calc[0], `<${calc[1]}calcPr${attrs}${calc[3]}>`);
  }
  const prefix = /<(\w+:)?workbook\b/.exec(workbook)?.[1] ?? "";
  // calcPr comes before these elements in CT_Workbook; inserting it after them is invalid.
  const after = new RegExp(`<${escapeRegExp(prefix)}(oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\\b|</${escapeRegExp(prefix)}workbook>`).exec(workbook);
  if (!after) return workbook;
  return `${workbook.slice(0, after.index)}<${prefix}calcPr fullCalcOnLoad="1"/>${workbook.slice(after.index)}`;
}

function rewriteSheet(xml: string, edits: SheetEdits, styleAt: (row: number, col: number) => CellStyle, styleIdAt: (row: number, col: number) => number, date1904: boolean): string {
  const prefix = /<(\w+:)?sheetData\b/.exec(xml)?.[1] ?? "";
  const p = escapeRegExp(prefix);
  const original = readOriginalRows(xml, p);
  const { sheet, rowOrigin, colOrigin, dirty } = edits;
  const maxOriginalRow = original.size ? Math.max(...original.keys()) : -1;
  let maxOriginalCol = -1;
  for (const row of original.values()) for (const col of row.cells.keys()) if (col > maxOriginalCol) maxOriginalCol = col;
  // Without an origin map, positions are unchanged, so cells beyond the data (styled but empty) are kept too.
  const rowCount = rowOrigin ? rowOrigin.length : Math.max(sheet.rows.length, maxOriginalRow + 1);
  const colCount = colOrigin ? colOrigin.length : Math.max(sheet.columnCount, maxOriginalCol + 1);

  let out = "";
  let lastRow = -1;
  let lastCol = -1;
  for (let r = 0; r < rowCount; r++) {
    const o = rowOrigin ? rowOrigin[r] : r;
    const origRow = o >= 0 ? original.get(o) : undefined;
    const values = sheet.rows[r] ?? [];
    let cells = "";
    for (let c = 0; c < Math.max(colCount, values.length); c++) {
      const oc = colOrigin ? colOrigin[c] ?? -1 : c;
      const origCell = origRow && oc >= 0 ? origRow.cells.get(oc) : undefined;
      const ref = `${columnName(c)}${r + 1}`;
      const key = `${r}:${c}`;
      let cell = "";
      if (origCell && !dirty.has(key)) {
        cell = setRef(origCell.full, ref);
      } else {
        // A cell that didn't exist takes its row's or column's style, as Excel does when you type into it.
        const style = origCell ? attr(origCell.attrs, "s") : o >= 0 || oc >= 0 ? String(styleIdAt(o, oc)) : undefined;
        const kind = o >= 0 || oc >= 0 ? styleAt(o, oc) : undefined;
        cell = writeCell(prefix, ref, style, values[c] ?? null, sheet.formulas?.[key], kind, date1904);
      }
      if (cell) {
        cells += cell;
        if (c > lastCol) lastCol = c;
      }
    }
    const rowAttrs = origRow ? origRow.attrs.replace(/\s(?:r|spans)="[^"]*"/g, "") : "";
    if (cells || rowAttrs.trim()) {
      out += cells ? `<${prefix}row r="${r + 1}"${rowAttrs}>${cells}</${prefix}row>` : `<${prefix}row r="${r + 1}"${rowAttrs}/>`;
      lastRow = r;
    }
  }

  const sheetData = `<${prefix}sheetData>${out}</${prefix}sheetData>`;
  const dataPattern = new RegExp(`<${p}sheetData\\b[^>]*?(?:/>|>[\\s\\S]*?</${p}sheetData>)`);
  let result = dataPattern.test(xml) ? xml.replace(dataPattern, () => sheetData) : xml;
  const dimension = lastRow >= 0 && lastCol >= 0 ? `A1:${columnName(lastCol)}${lastRow + 1}` : "A1";
  result = result.replace(new RegExp(`(<${p}dimension\\b[^>]*\\bref=")[^"]*(")`), (_m, a: string, b: string) => `${a}${dimension}${b}`);
  return result;
}

function readOriginalRows(xml: string, p: string): Map<number, OriginalRow> {
  const rows = new Map<number, OriginalRow>();
  const start = xml.search(new RegExp(`<${p}sheetData\\b`));
  if (start === -1) return rows;
  const body = xml.slice(start);
  const rowPattern = new RegExp(`<${p}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${p}row>)`, "g");
  const cellPattern = new RegExp(`<${p}c\\b([^>]*?)(?:/>|>[\\s\\S]*?</${p}c>)`, "g");
  let rowIndex = -1;
  for (const rowMatch of body.matchAll(rowPattern)) {
    const r = Number(attr(rowMatch[1], "r"));
    rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
    const cells = new Map<number, OriginalCell>();
    let colIndex = -1;
    for (const cell of (rowMatch[2] ?? "").matchAll(cellPattern)) {
      const ref = parseCellRef(attr(cell[1], "r") ?? "");
      colIndex = ref ? ref.col : colIndex + 1;
      cells.set(colIndex, { attrs: cell[1], full: cell[0] });
    }
    rows.set(rowIndex, { attrs: rowMatch[1], cells });
  }
  return rows;
}

/** The cell's XML with its r attribute set to ref (added when the cell had none). */
function setRef(full: string, ref: string): string {
  return /^<[^\s>/]+[^>]*\sr="/.test(full)
    ? full.replace(/^(<[^\s>/]+[^>]*?\sr=")[^"]*(")/, (_m, a: string, b: string) => `${a}${ref}${b}`)
    : full.replace(/^(<[^\s>/]+)/, `$1 r="${ref}"`);
}

/** One cell's XML for a value typed in the editor; "" when the cell has neither value nor style. */
export function writeCell(prefix: string, ref: string, style: string | undefined, value: CellValue, formula: string | undefined, kind: CellStyle | undefined, date1904: boolean): string {
  const s = style && style !== "0" ? ` s="${style}"` : "";
  const f = formula ? `<${prefix}f>${escapeXml(formula)}</${prefix}f>` : "";
  const v = (text: string) => `<${prefix}v>${text}</${prefix}v>`;
  if (value === null || value === "") {
    if (f) return `<${prefix}c r="${ref}"${s}>${f}</${prefix}c>`;
    return s ? `<${prefix}c r="${ref}"${s}/>` : "";
  }
  if (typeof value === "number") return `<${prefix}c r="${ref}"${s}>${f}${v(String(value))}</${prefix}c>`;
  if (typeof value === "boolean") return `<${prefix}c r="${ref}"${s} t="b">${f}${v(value ? "1" : "0")}</${prefix}c>`;
  if (kind?.kind === "date") {
    const serial = isoToSerial(value, date1904);
    if (serial !== undefined) return `<${prefix}c r="${ref}"${s}>${f}${v(String(serial))}</${prefix}c>`;
  }
  if (f) return `<${prefix}c r="${ref}"${s} t="str">${f}${v(escapeXml(value))}</${prefix}c>`;
  return `<${prefix}c r="${ref}"${s} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${escapeXml(value)}</${prefix}t></${prefix}is></${prefix}c>`;
}

/** "2024-03-05", "2024-03-05 14:30[:00]" or "14:30[:00]" as a spreadsheet serial number. */
export function isoToSerial(text: string, date1904 = false): number | undefined {
  const m = /^(?:(\d{4})-(\d{2})-(\d{2}))?(?:(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!m || (!m[1] && !m[4])) return undefined;
  const time = m[4] ? (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0)) / 86400 : 0;
  if (!m[1]) return round(time);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms) || new Date(ms).getUTCDate() !== Number(m[3])) return undefined;
  let days = ms / 86400000 + 25569;
  if (date1904) days -= 1462;
  // The reader adds Excel's phantom 29 February 1900 back for early serials; undo that here.
  else if (days < 61) days -= 1;
  return days < 0 ? undefined : round(days + time);
}

function round(n: number): number {
  return Number(n.toPrecision(15));
}

export function escapeXml(text: string): string {
  return text
    // Characters XML 1.0 can't hold at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    // A literal "_x0041_" would be read back as "A" unless its underscore is escaped.
    .replace(/_x([0-9A-Fa-f]{4})_/g, "_x005F_x$1_")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n?|\n/g, "\n");
}
