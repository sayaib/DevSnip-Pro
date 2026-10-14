import { CellValue, columnName, MAX_CELLS, SheetData, SheetInfo, SpreadsheetError } from "./types";
import { CellStyle, classifyFormat, formatDate, formatNumber, GENERAL, numberFormatById } from "./xlsx";

/**
 * Reads legacy Excel 97-2003 workbooks (.xls, BIFF8), read-only.
 *
 * An .xls file is a Compound File (an OLE "file system in a file") whose
 * Workbook stream holds BIFF records: the workbook globals (sheet list,
 * shared strings, number formats) followed by one block of cell records per
 * worksheet. Cells come back like the .xlsx reader's: numbers, text,
 * booleans, errors, and dates as ISO text, with Excel's number formats
 * applied for display. Formulas show their last calculated value; the
 * formula text itself isn't decoded, and macros never run.
 */

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** Whether bytes start like an OLE compound file (.xls, .doc, and password-protected .xlsx). */
export function isCompoundFile(data: Uint8Array): boolean {
  return data.length >= 512 && CFB_MAGIC.every((b, i) => data[i] === b);
}

function damaged(): SpreadsheetError {
  return new SpreadsheetError("This .xls workbook is damaged and can't be read.", "Open it in Excel or LibreOffice and save it again, as .xlsx if you can.");
}

/** The streams of a compound file, read by name. */
export class CompoundFile {
  private readonly sectorSize: number;
  private readonly fat: Uint32Array;
  private readonly streams = new Map<string, { start: number; size: number }>();
  private readonly miniFat: Uint32Array;
  private readonly miniStream: Buffer;
  private readonly cutoff: number;

  constructor(private readonly data: Buffer) {
    if (!isCompoundFile(data)) throw damaged();
    const shift = data.readUInt16LE(0x1e);
    if (shift !== 9 && shift !== 12) throw damaged();
    this.sectorSize = 1 << shift;
    const perSector = this.sectorSize / 4;
    const fatCount = data.readUInt32LE(0x2c);
    const firstDir = data.readUInt32LE(0x30);
    this.cutoff = data.readUInt32LE(0x38) || 4096;
    const firstMiniFat = data.readUInt32LE(0x3c);
    const miniFatCount = data.readUInt32LE(0x40);
    let difatSector = data.readUInt32LE(0x44);
    const sectorCount = Math.ceil(data.length / this.sectorSize);
    if (fatCount > sectorCount) throw damaged();

    // Sectors holding the allocation table: 109 listed in the header, the rest in a chain of DIFAT sectors.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(data.readUInt32LE(0x4c + i * 4));
    for (let guard = 0; fatSectors.length < fatCount && difatSector < ENDOFCHAIN; guard++) {
      if (guard > sectorCount) throw damaged();
      const at = this.offset(difatSector);
      for (let i = 0; i < perSector - 1 && fatSectors.length < fatCount; i++) fatSectors.push(data.readUInt32LE(at + i * 4));
      difatSector = data.readUInt32LE(at + (perSector - 1) * 4);
    }
    this.fat = new Uint32Array(fatSectors.length * perSector);
    fatSectors.forEach((sector, n) => {
      const at = this.offset(sector);
      for (let i = 0; i < perSector; i++) this.fat[n * perSector + i] = data.readUInt32LE(at + i * 4);
    });

    const dir = this.chain(firstDir, -1);
    let root: { start: number; size: number } | undefined;
    for (let at = 0; at + 128 <= dir.length; at += 128) {
      const type = dir[at + 66];
      if (type !== 1 && type !== 2 && type !== 5) continue;
      const nameLength = Math.min(64, dir.readUInt16LE(at + 64));
      const name = dir.toString("utf16le", at, at + Math.max(0, nameLength - 2));
      const entry = { start: dir.readUInt32LE(at + 116), size: dir.readUInt32LE(at + 120) };
      if (type === 5) root = entry;
      else if (type === 2 && !this.streams.has(name.toLowerCase())) this.streams.set(name.toLowerCase(), entry);
    }
    this.miniStream = root && root.size ? this.chain(root.start, root.size) : Buffer.alloc(0);
    const miniFatBytes = miniFatCount ? this.chain(firstMiniFat, miniFatCount * this.sectorSize) : Buffer.alloc(0);
    this.miniFat = new Uint32Array(miniFatBytes.length / 4);
    for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = miniFatBytes.readUInt32LE(i * 4);
  }

  has(name: string): boolean {
    return this.streams.has(name.toLowerCase());
  }

  read(name: string): Buffer | undefined {
    const entry = this.streams.get(name.toLowerCase());
    if (!entry) return undefined;
    if (entry.size < this.cutoff) {
      // Small streams live in the mini stream, in 64-byte sectors with their own table.
      const parts: Buffer[] = [];
      let total = 0;
      for (let sector = entry.start, guard = 0; sector < ENDOFCHAIN && total < entry.size; guard++) {
        if (guard > this.miniFat.length || sector >= this.miniFat.length) throw damaged();
        parts.push(this.miniStream.subarray(sector * 64, sector * 64 + 64));
        total += 64;
        sector = this.miniFat[sector];
      }
      return Buffer.concat(parts).subarray(0, entry.size);
    }
    return this.chain(entry.start, entry.size);
  }

  private offset(sector: number): number {
    const at = (sector + 1) * this.sectorSize;
    if (sector >= ENDOFCHAIN || at + this.sectorSize > this.data.length + this.sectorSize) throw damaged();
    return at;
  }

  /** The bytes of a sector chain; size -1 reads the whole chain. */
  private chain(start: number, size: number): Buffer {
    const parts: Buffer[] = [];
    let total = 0;
    for (let sector = start, guard = 0; sector !== ENDOFCHAIN && sector !== FREESECT && (size < 0 || total < size); guard++) {
      if (guard > this.fat.length || sector >= this.fat.length) throw damaged();
      const at = this.offset(sector);
      parts.push(this.data.subarray(at, Math.min(this.data.length, at + this.sectorSize)));
      total += this.sectorSize;
      sector = this.fat[sector];
    }
    const out = Buffer.concat(parts);
    if (size >= 0 && out.length < size) throw damaged();
    return size < 0 ? out : out.subarray(0, size);
  }
}

// ------------------------------------------------------------------ BIFF records

const BOF = 0x0809;
const EOF = 0x000a;
const CONTINUE = 0x003c;
const FILEPASS = 0x002f;
const DATEMODE = 0x0022;
const FORMAT = 0x041e;
const XF = 0x00e0;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const RSTRING = 0x00d6;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const BOOLERR = 0x0205;
const FORMULA = 0x0006;
const STRING = 0x0207;
const MERGECELLS = 0x00e5;
// Records that may sit between a FORMULA and the STRING record holding its text result.
const SHRFMLA = 0x04bc;
const ARRAY = 0x0221;
const TABLE = 0x0236;

const ERRORS: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A", 0x2b: "#GETTING_DATA" };

interface Record_ {
  type: number;
  data: Buffer;
  /** The CONTINUE records that follow it, for records whose content runs on. */
  more: Buffer[];
}

/** Reads records from a position in the Workbook stream, gathering CONTINUE records with the one they extend. */
function* records(stream: Buffer, from: number): Generator<Record_> {
  let at = from;
  while (at + 4 <= stream.length) {
    const type = stream.readUInt16LE(at);
    const length = stream.readUInt16LE(at + 2);
    if (at + 4 + length > stream.length) throw damaged();
    const record: Record_ = { type, data: stream.subarray(at + 4, at + 4 + length), more: [] };
    at += 4 + length;
    while (at + 4 <= stream.length && stream.readUInt16LE(at) === CONTINUE) {
      const n = stream.readUInt16LE(at + 2);
      record.more.push(stream.subarray(at + 4, Math.min(stream.length, at + 4 + n)));
      at += 4 + n;
    }
    yield record;
  }
}

/**
 * Reads across a record and its CONTINUE records. Text that runs into the
 * next record starts there with a fresh flags byte saying whether its
 * characters are one byte or two.
 */
class Segments {
  private i = 0;
  private pos = 0;

  constructor(private readonly segs: Buffer[], start = 0) {
    this.pos = start;
  }

  private settle(): Buffer {
    while (this.i < this.segs.length && this.pos >= this.segs[this.i].length) { this.pos -= this.segs[this.i].length; this.i++; }
    if (this.i >= this.segs.length) throw damaged();
    return this.segs[this.i];
  }

  u8(): number {
    const seg = this.settle();
    return seg[this.pos++];
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(n: number): void {
    this.pos += n;
  }

  get done(): boolean {
    while (this.i < this.segs.length && this.pos >= this.segs[this.i].length) { this.pos -= this.segs[this.i].length; this.i++; }
    return this.i >= this.segs.length;
  }

  /** cch characters, starting with one- or two-byte characters as wide says. */
  chars(cch: number, wide: boolean): string {
    let out = "";
    let left = cch;
    while (left > 0) {
      const seg = this.segs[this.i];
      if (!seg) throw damaged();
      if (this.pos >= seg.length) {
        this.i++;
        this.pos = 0;
        const next = this.segs[this.i];
        if (!next || !next.length) throw damaged();
        wide = (next[0] & 1) === 1;
        this.pos = 1;
        continue;
      }
      const available = wide ? (seg.length - this.pos) >> 1 : seg.length - this.pos;
      const take = Math.min(left, available);
      if (take <= 0) { this.pos = seg.length; continue; }
      out += wide ? seg.toString("utf16le", this.pos, this.pos + take * 2) : seg.toString("latin1", this.pos, this.pos + take);
      this.pos += wide ? take * 2 : take;
      left -= take;
    }
    return out;
  }

  /** An XLUnicodeString (16-bit length) or ShortXLUnicodeString (8-bit length). */
  string(shortLength = false): string {
    const cch = shortLength ? this.u8() : this.u16();
    const flags = this.u8();
    return this.chars(cch, (flags & 1) === 1);
  }
}

/** A string at the start of a cell record's data, after its 6-byte row/column/style header. */
function cellString(record: Record_, at: number): string {
  return new Segments([record.data, ...record.more], at).string();
}

function readSst(record: Record_): string[] {
  const reader = new Segments([record.data, ...record.more]);
  reader.skip(4);
  const unique = reader.u32();
  const strings: string[] = [];
  for (let n = 0; n < unique && !reader.done; n++) {
    const cch = reader.u16();
    const flags = reader.u8();
    const runs = flags & 0x08 ? reader.u16() : 0;
    const ext = flags & 0x04 ? reader.u32() : 0;
    strings.push(reader.chars(cch, (flags & 1) === 1));
    // Formatting runs and phonetic data aren't shown.
    reader.skip(runs * 4 + ext);
  }
  return strings;
}

/** An RK number: a 30-bit integer or the top of a double, optionally divided by 100. */
function rkValue(rk: number): number {
  let value: number;
  if (rk & 2) value = rk >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    value = b.readDoubleLE(0);
  }
  return rk & 1 ? value / 100 : value;
}

interface SheetEntry {
  info: SheetInfo;
  offset: number;
}

export class XlsWorkbook {
  readonly sheets: SheetInfo[] = [];
  private readonly entries: SheetEntry[] = [];
  private readonly stream: Buffer;
  private readonly strings: string[] = [];
  private readonly styles: CellStyle[] = [];
  private readonly date1904: boolean = false;
  private readonly cache = new Map<number, SheetData>();
  /** Per sheet, "row:col" → number format, for cells whose format isn't General. */
  private readonly formats = new Map<number, Map<string, string>>();

  constructor(data: Buffer) {
    const file = new CompoundFile(data);
    if (file.has("EncryptionInfo") || file.has("EncryptedPackage")) {
      throw new SpreadsheetError("This workbook is password-protected.", "Open it in Excel, remove the password (File → Info → Protect Workbook), save it, and open it again.");
    }
    const stream = file.read("Workbook");
    if (!stream) {
      if (file.has("Book")) throw new SpreadsheetError("This is an Excel 5.0/95 workbook, which is too old to read here.", "Open it in Excel or LibreOffice and save it as an Excel Workbook (.xlsx).");
      throw new SpreadsheetError("This file isn't an Excel workbook.", "It is a compound document (Word, PowerPoint or another Office file) without a workbook inside.");
    }
    this.stream = stream;
    if (stream.length < 8 || stream.readUInt16LE(0) !== BOF) throw damaged();
    const version = stream.readUInt16LE(4);
    if (version !== 0x0600) throw new SpreadsheetError("This workbook is in an Excel format from before Excel 97, which is too old to read here.", "Open it in Excel or LibreOffice and save it as an Excel Workbook (.xlsx).");

    const custom = new Map<number, string>();
    const xfs: Array<{ format: number; locked: boolean }> = [];
    let date1904 = false;
    for (const record of records(stream, 0)) {
      const d = record.data;
      if (record.type === EOF) break;
      switch (record.type) {
        case FILEPASS:
          throw new SpreadsheetError("This workbook is password-protected.", "Open it in Excel, remove the password, save it, and open it again.");
        case DATEMODE:
          date1904 = d.length >= 2 && d.readUInt16LE(0) === 1;
          break;
        case FORMAT:
          if (d.length >= 5) custom.set(d.readUInt16LE(0), new Segments([d, ...record.more], 2).string());
          break;
        case XF:
          if (d.length >= 6) xfs.push({ format: d.readUInt16LE(2), locked: (d.readUInt16LE(4) & 1) === 1 });
          break;
        case BOUNDSHEET: {
          if (d.length < 8) break;
          const state = d[4] & 3;
          const kind = d[5];
          const name = new Segments([d], 6).string(true);
          // Chart sheets, macro sheets and VBA modules have no cells to show.
          if (kind !== 0) break;
          this.entries.push({ info: { name: name || `Sheet${this.entries.length + 1}`, hidden: state !== 0 }, offset: d.readUInt32LE(0) });
          break;
        }
        case SST:
          this.strings = readSst(record);
          break;
      }
    }
    this.date1904 = date1904;
    this.styles = xfs.map(xf => {
      const format = custom.get(xf.format) ?? numberFormatById(xf.format);
      return { format, kind: classifyFormat(format), locked: xf.locked };
    });
    this.sheets = this.entries.map(e => e.info);
    if (!this.sheets.length) throw new SpreadsheetError("This workbook has no worksheets with cells.", "Chart sheets aren't shown; add a worksheet, or export the data as CSV.");
  }

  get is1904(): boolean {
    return this.date1904;
  }

  /** The number format of a cell that isn't General, for exports that keep formats. */
  formatAt(index: number, row: number, col: number): string | undefined {
    this.sheet(index);
    return this.formats.get(index)?.get(`${row}:${col}`);
  }

  sheet(index: number): SheetData {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const entry = this.entries[index];
    if (!entry) throw new SpreadsheetError("That sheet doesn't exist.");
    if (entry.offset + 8 > this.stream.length || this.stream.readUInt16LE(entry.offset) !== BOF) throw damaged();

    const rows: CellValue[][] = [];
    const display: Record<string, string> = {};
    const formats = new Map<string, string>();
    const merges: string[] = [];
    let cells = 0;
    let columnCount = 0;
    let truncatedRows = 0;
    const dropped = new Set<number>();
    // A formula whose result is text gets it from the STRING record right after it.
    let pendingString: { row: number; col: number } | undefined;

    const put = (row: number, col: number, value: CellValue, xf: number) => {
      if (value === null || value === "") return;
      if (!rows[row]) {
        if (dropped.has(row)) return;
        if (cells >= MAX_CELLS) { dropped.add(row); truncatedRows++; return; }
        rows[row] = [];
      }
      const style = this.styles[xf] ?? GENERAL;
      const key = `${row}:${col}`;
      if (typeof value === "number") {
        if (style.kind !== "general" && style.kind !== "text") formats.set(key, style.format);
        if (style.kind === "date") value = formatDate(value, style.format, this.date1904);
        else {
          value = Number(value.toPrecision(15));
          if (style.kind === "number") {
            const shown = formatNumber(value, style.format);
            if (shown !== String(value)) display[key] = shown;
          }
        }
      }
      const cellsRow = rows[row];
      while (cellsRow.length < col) cellsRow.push(null);
      if (cellsRow[col] === undefined || cellsRow[col] === null) cells++;
      cellsRow[col] = value;
      if (col + 1 > columnCount) columnCount = col + 1;
    };

    // Charts embedded in the sheet are substreams of their own (BOF … EOF) inside it.
    let depth = 0;
    for (const record of records(this.stream, entry.offset + 4 + this.stream.readUInt16LE(entry.offset + 2))) {
      const d = record.data;
      if (record.type === BOF) { depth++; continue; }
      if (record.type === EOF) { if (depth === 0) break; depth--; continue; }
      if (depth > 0) continue;
      if (record.type === STRING) {
        if (pendingString) put(pendingString.row, pendingString.col, new Segments([d, ...record.more]).string(), 0);
        pendingString = undefined;
        continue;
      }
      if (record.type !== SHRFMLA && record.type !== ARRAY && record.type !== TABLE) pendingString = undefined;
      if (d.length < 6 && record.type !== MERGECELLS) continue;
      switch (record.type) {
        case LABELSST:
          if (d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), this.strings[d.readUInt32LE(6)] ?? "", d.readUInt16LE(4));
          break;
        case LABEL:
        case RSTRING:
          put(d.readUInt16LE(0), d.readUInt16LE(2), cellString(record, 6), d.readUInt16LE(4));
          break;
        case NUMBER:
          if (d.length >= 14) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6), d.readUInt16LE(4));
          break;
        case RK:
          if (d.length >= 10) put(d.readUInt16LE(0), d.readUInt16LE(2), rkValue(d.readUInt32LE(6)), d.readUInt16LE(4));
          break;
        case MULRK: {
          const row = d.readUInt16LE(0);
          const first = d.readUInt16LE(2);
          const count = Math.floor((d.length - 6) / 6);
          for (let i = 0; i < count; i++) put(row, first + i, rkValue(d.readUInt32LE(4 + i * 6 + 2)), d.readUInt16LE(4 + i * 6));
          break;
        }
        case BOOLERR:
          if (d.length >= 8) {
            const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
            if (d[7]) {
              const error = ERRORS[d[6]] ?? "#VALUE!";
              put(row, col, error, 0);
              display[`${row}:${col}`] = error;
            } else put(row, col, d[6] !== 0, d.readUInt16LE(4));
          }
          break;
        case FORMULA: {
          if (d.length < 14) break;
          const row = d.readUInt16LE(0), col = d.readUInt16LE(2), xf = d.readUInt16LE(4);
          if (d.readUInt16LE(12) !== 0xffff) put(row, col, d.readDoubleLE(6), xf);
          else if (d[6] === 0) pendingString = { row, col };
          else if (d[6] === 1) put(row, col, d[8] !== 0, xf);
          else if (d[6] === 2) {
            const error = ERRORS[d[8]] ?? "#VALUE!";
            put(row, col, error, 0);
            display[`${row}:${col}`] = error;
          }
          break;
        }
        case MERGECELLS: {
          const count = d.length >= 2 ? d.readUInt16LE(0) : 0;
          for (let i = 0; i < count && 2 + i * 8 + 8 <= d.length; i++) {
            const at = 2 + i * 8;
            const ref = (r: number, c: number) => `${columnName(c)}${r + 1}`;
            merges.push(`${ref(d.readUInt16LE(at), d.readUInt16LE(at + 4))}:${ref(d.readUInt16LE(at + 2), d.readUInt16LE(at + 6))}`);
          }
          break;
        }
      }
    }

    for (let r = 0; r < rows.length; r++) if (!rows[r]) rows[r] = [];
    const sheet: SheetData = { name: entry.info.name, rows, columnCount };
    if (Object.keys(display).length) sheet.display = display;
    if (merges.length) sheet.merges = merges;
    if (truncatedRows) sheet.truncatedRows = truncatedRows;
    this.cache.set(index, sheet);
    this.formats.set(index, formats);
    return sheet;
  }
}
