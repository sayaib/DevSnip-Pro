"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeCellText = exports.dirOf = exports.relsPathOf = exports.decodeXml = exports.attr = exports.formatNumber = exports.formatDate = exports.classifyFormat = exports.numberFormatById = exports.GENERAL = exports.XlsxWorkbook = void 0;
const zip_1 = require("./zip");
const xlsx_write_1 = require("./xlsx-write");
const types_1 = require("./types");
/**
 * Reads .xlsx and .xlsm workbooks (Office Open XML), the format Excel,
 * LibreOffice, Numbers and Google Sheets export. Cells come back with the
 * values Excel last calculated, formatted roughly the way Excel shows them:
 * dates as ISO dates, percentages, fixed decimals and currency symbols.
 * Formulas are kept alongside so the viewer can show them; nothing is
 * recalculated and no macro ever runs.
 */
class XlsxWorkbook {
    constructor(data) {
        this.cache = new Map();
        this.layouts = new Map();
        if (data.length >= 4 && data.readUInt32BE(0) === 0xd0cf11e0) {
            throw new types_1.SpreadsheetError("This is an old-style .xls workbook or a password-protected one.", "Save it from Excel or LibreOffice as an Excel Workbook (.xlsx) without a password, or as CSV, and open that.");
        }
        if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) {
            throw new types_1.SpreadsheetError("This file isn't an .xlsx workbook.", "If it is text with separators, rename it to .csv and open it again.");
        }
        this.zip = new zip_1.ZipReader(data);
        const workbookPath = this.workbookPath = this.findWorkbook();
        const workbook = stripPrefixes(this.zip.text(workbookPath) ?? "");
        const rels = relationships(this.zip.text(relsPathOf(workbookPath)) ?? "", dirOf(workbookPath));
        this.date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbook);
        this.sheets = [];
        this.targets = [];
        for (const match of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
            const attrs = match[1];
            const target = rels.get(attr(attrs, "r:id") ?? attr(attrs, "id") ?? "");
            // Chart sheets and dialog sheets have no cells.
            if (!target || !/worksheets?\//i.test(target) || !this.zip.has(target))
                continue;
            const state = attr(attrs, "state");
            this.sheets.push({ name: decodeXml(attr(attrs, "name") ?? `Sheet${this.sheets.length + 1}`), hidden: state === "hidden" || state === "veryHidden" });
            this.targets.push(target);
        }
        if (!this.sheets.length)
            throw new types_1.SpreadsheetError("This workbook has no worksheets with cells.", "Chart sheets aren't shown; add a worksheet, or export the data as CSV.");
    }
    /** Parses one worksheet the first time it is asked for. */
    sheet(index) {
        const cached = this.cache.get(index);
        if (cached)
            return cached;
        const info = this.sheets[index];
        if (!info)
            throw new types_1.SpreadsheetError("That sheet doesn't exist.");
        this.sharedStrings ?? (this.sharedStrings = readSharedStrings(this.zip));
        this.styles ?? (this.styles = readStyles(this.zip));
        const xml = stripPrefixes(this.zip.text(this.targets[index]) ?? "");
        const sheet = parseWorksheet(xml, info.name, this.sharedStrings, this.styles, this.date1904);
        this.cache.set(index, sheet);
        return sheet;
    }
    /**
     * The style id a cell has, by its position in the file as it was opened:
     * its own, else its row's (rows with customFormat), else its column's, else
     * the default. An empty cell typed into gets this style, as in Excel, so it
     * keeps its column's number format and protection. -1 skips an axis (a new
     * row or column).
     */
    styleIdAt(index, row, col) {
        let layout = this.layouts.get(index);
        if (!layout) {
            layout = readStyleLayout(stripPrefixes(this.zip.text(this.targets[index]) ?? ""));
            this.layouts.set(index, layout);
        }
        if (row >= 0 && col >= 0) {
            const own = layout.cells.get(`${row}:${col}`);
            if (own !== undefined)
                return own;
        }
        if (row >= 0 && layout.rows.has(row))
            return layout.rows.get(row);
        if (col >= 0)
            for (const [first, last, style] of layout.cols)
                if (col >= first && col <= last)
                    return style;
        return 0;
    }
    /** The number format of a cell, by its position in the file as it was opened. */
    styleAt(index, row, col) {
        this.styles ?? (this.styles = readStyles(this.zip));
        return this.styles[this.styleIdAt(index, row, col)] ?? exports.GENERAL;
    }
    get is1904() {
        return this.date1904;
    }
    /**
     * Why rows and columns can't be inserted or deleted, or undefined when they
     * can. Formulas, merged ranges, tables, charts and the like refer to cells
     * by address; moving cells under them would silently break them, so only
     * plain data workbooks can be restructured. Cell values can always be edited.
     */
    structureLock() {
        if (this.locks === undefined) {
            this.locks = null;
            const names = this.zip.names();
            const workbook = this.zip.text(this.workbookPath) ?? "";
            if (/<(?:\w+:)?definedName\b/.test(workbook))
                this.locks = "the workbook has named ranges";
            else if (names.some(n => /(^|\/)(charts|pivotTables|pivotCache|tables)\//i.test(n)))
                this.locks = "the workbook has charts, tables or pivot tables";
            else {
                for (const target of this.targets) {
                    const xml = this.zip.text(target) ?? "";
                    if (/<(?:\w+:)?f[\s>/]/.test(xml)) {
                        this.locks = "the workbook has formulas";
                        break;
                    }
                    if (/<(?:\w+:)?(mergeCell|conditionalFormatting|dataValidation|hyperlink|autoFilter)\b/.test(xml)) {
                        this.locks = "a sheet has merged cells, conditional formatting, validation, links or filters";
                        break;
                    }
                }
            }
        }
        return this.locks ?? undefined;
    }
    /** The workbook with edited sheets rewritten and every other part copied unchanged. */
    save(edits) {
        const sheets = [...edits].map(([index, sheetEdits]) => ({
            path: this.targets[index],
            edits: sheetEdits,
            styleAt: (row, col) => this.styleAt(index, row, col),
            styleIdAt: (row, col) => this.styleIdAt(index, row, col)
        }));
        return (0, xlsx_write_1.rewriteWorkbook)(this.zip, this.workbookPath, sheets, this.date1904);
    }
    findWorkbook() {
        const root = relationships(this.zip.text("_rels/.rels") ?? "", "");
        for (const [, target] of root)
            if (/workbook[^/]*\.xml$/i.test(target) && this.zip.has(target))
                return target;
        if (this.zip.has("xl/workbook.xml"))
            return "xl/workbook.xml";
        throw new types_1.SpreadsheetError("This file is a ZIP archive but not an Excel workbook.", "Word (.docx) and PowerPoint (.pptx) files can't be shown as sheets.");
    }
}
exports.XlsxWorkbook = XlsxWorkbook;
function readStyleLayout(xml) {
    const layout = { cells: new Map(), rows: new Map(), cols: [] };
    for (const col of xml.matchAll(/<col\b([^>]*?)\/?>/g)) {
        const style = attr(col[1], "style");
        if (style !== undefined)
            layout.cols.push([Number(attr(col[1], "min")) - 1, Number(attr(col[1], "max")) - 1, Number(style)]);
    }
    let rowIndex = -1;
    for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const r = Number(attr(rowMatch[1], "r"));
        rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
        if (/^(1|true)$/.test(attr(rowMatch[1], "customFormat") ?? ""))
            layout.rows.set(rowIndex, Number(attr(rowMatch[1], "s") ?? 0));
        let colIndex = -1;
        for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>)/g)) {
            const ref = (0, types_1.parseCellRef)(attr(cell[1], "r") ?? "");
            colIndex = ref ? ref.col : colIndex + 1;
            const style = attr(cell[1], "s");
            if (style !== undefined)
                layout.cells.set(`${rowIndex}:${colIndex}`, Number(style));
        }
    }
    return layout;
}
function parseWorksheet(xml, name, shared, styles, date1904) {
    const rows = [];
    const display = {};
    const formulas = {};
    let columnCount = 0;
    let cells = 0;
    let truncatedRows = 0;
    let rowIndex = -1;
    const dataStart = xml.indexOf("<sheetData");
    const dataEnd = xml.lastIndexOf("</sheetData>");
    const body = dataStart === -1 ? "" : xml.slice(dataStart, dataEnd === -1 ? xml.length : dataEnd);
    const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (let rowMatch = rowPattern.exec(body); rowMatch; rowMatch = rowPattern.exec(body)) {
        const r = Number(attr(rowMatch[1], "r"));
        rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
        const content = rowMatch[2];
        if (!content)
            continue;
        if (truncatedRows) {
            truncatedRows++;
            continue;
        }
        const row = [];
        let colIndex = -1;
        cellPattern.lastIndex = 0;
        for (let cell = cellPattern.exec(content); cell; cell = cellPattern.exec(content)) {
            const attrs = cell[1];
            const ref = (0, types_1.parseCellRef)(attr(attrs, "r") ?? "");
            colIndex = ref ? ref.col : colIndex + 1;
            const inner = cell[2];
            if (!inner)
                continue;
            const key = `${rowIndex}:${colIndex}`;
            const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1];
            if (formula)
                formulas[key] = decodeXml(formula);
            const type = attr(attrs, "t") ?? "n";
            const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
            let value = null;
            if (type === "s")
                value = raw === undefined ? null : shared[Number(raw)] ?? "";
            else if (type === "inlineStr")
                value = richText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
            else if (raw === undefined)
                value = null;
            else if (type === "b")
                value = raw.trim() === "1" || raw.trim() === "true";
            else if (type === "str" || type === "e")
                value = decodeXml(raw);
            else if (type === "d")
                value = raw.trim().replace(/T00:00:00(?:\.0+)?Z?$/, "").replace("T", " ").replace(/Z$/, "");
            else {
                const number = Number(raw);
                if (!Number.isFinite(number))
                    value = decodeXml(raw);
                else {
                    const style = styles[Number(attr(attrs, "s") ?? 0)] ?? exports.GENERAL;
                    if (style.kind === "date")
                        value = formatDate(number, style.format, date1904);
                    else {
                        value = Number(number.toPrecision(15));
                        if (style.kind === "number") {
                            const shown = formatNumber(value, style.format);
                            if (shown !== String(value))
                                display[key] = shown;
                        }
                    }
                }
            }
            if (type === "e")
                display[key] = String(value);
            // A formula Excel hasn't calculated yet has no value, but the cell still exists.
            if ((value === null || value === "") && !formula)
                continue;
            while (row.length < colIndex)
                row.push(null);
            row[colIndex] = value;
        }
        if (!row.length)
            continue;
        if (cells + row.length > types_1.MAX_CELLS) {
            truncatedRows = 1;
            continue;
        }
        cells += row.length;
        while (rows.length < rowIndex)
            rows.push([]);
        rows[rowIndex] = row;
        if (row.length > columnCount)
            columnCount = row.length;
    }
    const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map(m => m[1]);
    const protection = readProtection(xml, body, styles);
    const sheet = { name, rows, columnCount };
    if (Object.keys(display).length)
        sheet.display = display;
    if (Object.keys(formulas).length)
        sheet.formulas = formulas;
    if (merges.length)
        sheet.merges = merges;
    if (truncatedRows)
        sheet.truncatedRows = truncatedRows;
    if (protection)
        sheet.protection = protection;
    return sheet;
}
/** Which cells are locked, when the sheet is protected in Excel (<sheetProtection sheet="1">). */
function readProtection(xml, body, styles) {
    const tag = /<sheetProtection\b([^>]*)\/?>/.exec(xml);
    if (!tag || !/^(1|true)$/.test(attr(tag[1], "sheet") ?? ""))
        return undefined;
    const lockedOf = (style) => (styles[Number(style ?? 0)] ?? exports.GENERAL).locked !== false;
    const protection = { cells: {}, rows: {}, cols: [], fallback: lockedOf("0") };
    for (const col of xml.matchAll(/<col\b([^>]*?)\/?>/g)) {
        const style = attr(col[1], "style");
        if (style !== undefined)
            protection.cols.push([Number(attr(col[1], "min")) - 1, Number(attr(col[1], "max")) - 1, lockedOf(style)]);
    }
    let rowIndex = -1;
    for (const row of body.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const r = Number(attr(row[1], "r"));
        rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
        if (/^(1|true)$/.test(attr(row[1], "customFormat") ?? ""))
            protection.rows[rowIndex] = lockedOf(attr(row[1], "s"));
        let colIndex = -1;
        for (const cell of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>)/g)) {
            const ref = (0, types_1.parseCellRef)(attr(cell[1], "r") ?? "");
            colIndex = ref ? ref.col : colIndex + 1;
            const style = attr(cell[1], "s");
            if (style !== undefined)
                protection.cells[`${rowIndex}:${colIndex}`] = lockedOf(style);
        }
    }
    return protection;
}
// ------------------------------------------------------------------ shared strings and styles
function readSharedStrings(zip) {
    const path = zip.names().find(n => /(^|\/)sharedStrings\.xml$/i.test(n));
    const xml = path ? stripPrefixes(zip.text(path) ?? "") : "";
    const strings = [];
    for (const match of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g))
        strings.push(richText(match[1] ?? ""));
    return strings;
}
/** The text of a string item: plain <t>, or the runs of rich text, without phonetic hints. */
function richText(xml) {
    let text = "";
    for (const match of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g))
        text += match[1] ?? "";
    return decodeXml(text);
}
const BUILT_IN_FORMATS = {
    0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
    14: "yyyy-mm-dd", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy-mm-dd h:mm",
    37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
    45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@"
};
exports.GENERAL = { format: "General", kind: "general" };
/** The format code of a built-in number format id (the same in .xlsx and .xls). */
function numberFormatById(id) {
    // Ids 27-36 and 50-58 are locale-specific (CJK) date formats.
    return BUILT_IN_FORMATS[id] ?? ((id >= 27 && id <= 36) || (id >= 50 && id <= 58) ? "yyyy-mm-dd" : "General");
}
exports.numberFormatById = numberFormatById;
function readStyles(zip) {
    const path = zip.names().find(n => /(^|\/)styles\.xml$/i.test(n));
    const xml = path ? stripPrefixes(zip.text(path) ?? "") : "";
    const custom = new Map();
    for (const match of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
        const id = Number(attr(match[1], "numFmtId"));
        const code = attr(match[1], "formatCode");
        if (Number.isInteger(id) && code !== undefined)
            custom.set(id, decodeXml(code));
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
    return [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map(match => {
        const id = Number(attr(match[1], "numFmtId") ?? 0);
        const locked = !/<protection\b[^>]*\blocked="(?:0|false)"/.test(match[2] ?? "");
        const format = custom.get(id) ?? numberFormatById(id);
        return { format, kind: classifyFormat(format), locked };
    });
}
/** Removes quoted literals, escapes, colours and conditions so only the format's placeholders remain. */
function formatSkeleton(format) {
    return format.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, "").replace(/[_*]./g, "");
}
function classifyFormat(format) {
    if (!format || /^general$/i.test(format.trim()))
        return "general";
    const first = formatSkeleton(format.split(";")[0]);
    if (first.trim() === "@")
        return "text";
    if (/[dmyhs]/i.test(first.replace(/E[+-]/gi, "")))
        return "date";
    return /[0#?]/.test(first) ? "number" : "general";
}
exports.classifyFormat = classifyFormat;
/** A spreadsheet serial number as an ISO-like date, date-time, time or duration. */
function formatDate(serial, format, date1904 = false) {
    const skeleton = formatSkeleton(format.split(";")[0]).toLowerCase();
    const hasDate = /[dy]/.test(skeleton) || /m{3,}/.test(skeleton) || (/m/.test(skeleton) && !/[hs]/.test(skeleton));
    const hasTime = /[hs]/.test(skeleton);
    const seconds = /s/.test(skeleton);
    // [h]:mm durations can run past 24 hours.
    if (/\[h+\]/.test(skeleton)) {
        const total = Math.round(serial * 86400);
        const sign = total < 0 ? "-" : "";
        const abs = Math.abs(total);
        return `${sign}${Math.floor(abs / 3600)}:${pad(Math.floor(abs / 60) % 60)}${seconds ? `:${pad(abs % 60)}` : ""}`;
    }
    const date = serialToDate(serial, date1904);
    if (!date)
        return String(serial);
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${seconds ? `:${pad(date.getUTCSeconds())}` : ""}`;
    if (hasDate && hasTime)
        return `${day} ${time}`;
    if (hasTime)
        return time;
    return day;
}
exports.formatDate = formatDate;
function serialToDate(serial, date1904) {
    if (!Number.isFinite(serial) || serial < 0 || serial > 2958466)
        return undefined;
    // Excel counts 1900-02-29, a day that never existed; serials after it are one day ahead.
    let days = date1904 ? serial + 1462 : serial;
    if (!date1904 && serial < 60)
        days += 1;
    const ms = Math.round((days - 25569) * 86400) * 1000;
    return new Date(ms);
}
/** A number shown the way a number format (0.00, #,##0, 0%, €#,##0.00, 0.0E+00…) shows it. */
function formatNumber(value, format) {
    const sections = format.split(";");
    let section = sections[0];
    let number = value;
    let sign = "";
    if (value < 0) {
        if (sections.length > 1 && sections[1].trim()) {
            section = sections[1];
            number = -value;
        }
        else {
            number = -value;
            sign = "-";
        }
    }
    else if (value === 0 && sections.length > 2 && sections[2].trim()) {
        section = sections[2];
    }
    // Currency like [$€-407] keeps its symbol; colours and conditions go.
    section = section.replace(/\[\$([^\]-]*)[^\]]*\]/g, (_m, symbol) => `"${symbol}"`).replace(/\[[^\]]*\]/g, "");
    // Find where the digit placeholders start and end, outside quoted text and escapes.
    let first = -1;
    let last = -1;
    let pattern = "";
    for (let i = 0; i < section.length; i++) {
        const ch = section[i];
        if (ch === '"') {
            const close = section.indexOf('"', i + 1);
            i = close === -1 ? section.length : close;
            continue;
        }
        if (ch === "\\" || ch === "_" || ch === "*") {
            i++;
            continue;
        }
        const exponent = (ch === "E" || ch === "e") && /[+-]/.test(section[i + 1] ?? "") && first !== -1;
        if (/[0#?]/.test(ch) || (first !== -1 && /[.,]/.test(ch)) || exponent) {
            if (first === -1)
                first = i;
            last = exponent ? i + 1 : i;
            pattern += exponent ? `E${section[i + 1]}` : ch;
            if (exponent)
                i++;
        }
        else if (first === -1 && ch === ".") {
            first = i;
            last = i;
            pattern += ch;
        }
    }
    if (first === -1)
        return literal(section) || String(value);
    const prefix = literal(section.slice(0, first));
    const suffix = literal(section.slice(last + 1));
    const percent = section.replace(/"[^"]*"/g, "").includes("%");
    if (percent)
        number *= 100;
    const fraction = /\.([0#?]*)/.exec(pattern.replace(/E.*$/, ""))?.[1] ?? "";
    const decimals = fraction.length;
    const minDecimals = /^0*/.exec(fraction)[0].length;
    let text;
    if (/E[+-]/.test(pattern)) {
        text = number.toExponential(decimals).replace(/e([+-])(\d)$/, "e$10$2").toUpperCase();
    }
    else {
        // Commas right before the decimal point (or the end) scale by 1,000 each.
        const scale = /(,+)$/.exec(pattern.replace(/\..*$/, ""));
        if (scale)
            number /= Math.pow(1000, scale[1].length);
        text = number.toFixed(decimals);
        if (decimals > minDecimals) {
            const [int, frac] = text.split(".");
            const kept = frac.replace(/0+$/, "").padEnd(minDecimals, "0");
            text = kept ? `${int}.${kept}` : int;
        }
        // "00000" pads 7 to 00007.
        const minInt = (/^[^.]*/.exec(pattern.replace(/,/g, ""))[0].match(/0/g) ?? []).length;
        if (minInt > 1) {
            const [int, frac] = text.split(".");
            text = int.padStart(minInt, "0") + (frac !== undefined ? `.${frac}` : "");
        }
        if (/[0#?],+[0#?]/.test(pattern)) {
            const [int, frac] = text.split(".");
            text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? `.${frac}` : "");
        }
        // "#.00" shows 0.5 as ".50".
        if (/^0\./.test(text) && !/0/.test(pattern.replace(/\..*$/, "")))
            text = text.slice(1);
    }
    return `${sign}${prefix}${text}${suffix}`.trim();
}
exports.formatNumber = formatNumber;
/** The literal text of a format fragment: quoted strings, escaped characters and plain symbols. */
function literal(fragment) {
    let out = "";
    for (let i = 0; i < fragment.length; i++) {
        const ch = fragment[i];
        if (ch === '"') {
            const close = fragment.indexOf('"', i + 1);
            out += fragment.slice(i + 1, close === -1 ? fragment.length : close);
            i = close === -1 ? fragment.length : close;
        }
        else if (ch === "\\")
            out += fragment[++i] ?? "";
        else if (ch === "_" || ch === "*") {
            i++;
            if (ch === "_")
                out += " ";
        }
        else if (ch === "@")
            continue;
        else
            out += ch;
    }
    return out.replace(/\s+$/, m => (m.length > 1 ? " " : m));
}
// ------------------------------------------------------------------ XML helpers
function pad(n) {
    return n < 10 ? `0${n}` : String(n);
}
/** Drops element namespace prefixes (<x:row> → <row>), which some generators write. */
function stripPrefixes(xml) {
    return /<\/?[A-Za-z_][\w.-]*:(?:row|c|sheet|si|t|v|f|numFmt|xf|cellXfs|sheetData|workbookPr|mergeCell|is|r)\b/.test(xml)
        ? xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, "<$1")
        : xml;
}
function attr(attrs, name) {
    const match = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
    return match ? match[1] ?? match[2] : undefined;
}
exports.attr = attr;
function decodeXml(text) {
    if (!/[&_]/.test(text))
        return text;
    return text
        .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&(#x[0-9A-Fa-f]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, entity) => {
        if (entity[0] === "#") {
            const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        }
        return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[entity];
    });
}
exports.decodeXml = decodeXml;
function relsPathOf(part) {
    const dir = dirOf(part);
    return `${dir ? `${dir}/` : ""}_rels/${part.slice(dir ? dir.length + 1 : 0)}.rels`;
}
exports.relsPathOf = relsPathOf;
function dirOf(part) {
    const slash = part.lastIndexOf("/");
    return slash === -1 ? "" : part.slice(0, slash);
}
exports.dirOf = dirOf;
/** Relationship id → part path, resolved against the owning part's folder. */
function relationships(xml, baseDir) {
    const map = new Map();
    for (const match of stripPrefixes(xml).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        const id = attr(match[1], "Id");
        const target = attr(match[1], "Target");
        if (!id || !target || attr(match[1], "TargetMode") === "External")
            continue;
        map.set(id, resolvePart(baseDir, decodeXml(target)));
    }
    return map;
}
function resolvePart(baseDir, target) {
    const parts = (target.startsWith("/") ? target.slice(1) : baseDir ? `${baseDir}/${target}` : target).split("/");
    const out = [];
    for (const part of parts) {
        if (part === "..")
            out.pop();
        else if (part && part !== ".")
            out.push(part);
    }
    return out.join("/");
}
// ------------------------------------------------------------------ typed input
const NUMBER_INPUT = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
/**
 * What text typed into a cell becomes, the way Excel reads it: "=…" is a
 * formula, numbers (with thousands separators or a % sign) become numbers,
 * TRUE/FALSE become booleans, and anything else stays text. A cell formatted
 * as text keeps exactly what was typed. Dates stay ISO text in a date cell
 * and are written as date serials when the file is saved.
 */
function typeCellText(text, style, date1904 = false) {
    if (text === "")
        return { v: null };
    if (style.kind === "text")
        return { v: text };
    if (text.length > 1 && text[0] === "=")
        return { v: null, f: text.slice(1) };
    const trimmed = text.trim();
    if (/^(true|false)$/i.test(trimmed))
        return { v: /^true$/i.test(trimmed) };
    let number;
    if (/\d/.test(trimmed) && NUMBER_INPUT.test(trimmed))
        number = Number(trimmed.replace(/,/g, ""));
    else if (/\d/.test(trimmed) && /%$/.test(trimmed) && NUMBER_INPUT.test(trimmed.slice(0, -1).trim()))
        number = Number(trimmed.slice(0, -1).replace(/,/g, "")) / 100;
    if (number !== undefined && Number.isFinite(number)) {
        const value = Number(number.toPrecision(15));
        if (style.kind === "date")
            return { v: formatDate(value, style.format, date1904) };
        if (style.kind === "number") {
            const shown = formatNumber(value, style.format);
            return shown !== String(value) ? { v: value, d: shown } : { v: value };
        }
        return { v: value };
    }
    return { v: text };
}
exports.typeCellText = typeCellText;
//# sourceMappingURL=xlsx.js.map