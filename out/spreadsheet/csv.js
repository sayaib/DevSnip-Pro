"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeText = exports.lineEndings = exports.toCsv = exports.csvLine = exports.parseCsv = exports.detectDelimiter = exports.decodeText = exports.DELIMITERS = void 0;
const types_1 = require("./types");
/** Separators the viewer detects, most common first. */
exports.DELIMITERS = [",", ";", "\t", "|"];
/**
 * Decodes a CSV file's bytes. UTF-8 (with or without a byte-order mark) and
 * UTF-16 (with a byte-order mark, or recognised by its zero bytes) are read as
 * such; anything that isn't valid UTF-8 is read as Windows-1252, which is what
 * Excel writes on most Windows machines. Binary files are refused rather than
 * shown as a grid of garbage.
 */
function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
        return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "UTF-16 LE" };
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
        return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "UTF-16 BE" };
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const body = bom ? bytes.subarray(3) : bytes;
    if (!bom) {
        const sniffed = sniffZeros(body);
        if (sniffed === "utf-16le")
            return { text: new TextDecoder("utf-16le").decode(body), encoding: UTF16LE_NO_BOM };
        if (sniffed === "utf-16be")
            return { text: new TextDecoder("utf-16be").decode(body), encoding: UTF16BE_NO_BOM };
        if (sniffed === "binary")
            throw new types_1.SpreadsheetError("This file isn't text, so it can't be read as CSV.", "It looks like a binary file. If it is a spreadsheet, open the .xlsx or .xls file itself.");
    }
    try {
        return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), encoding: bom ? "UTF-8 with BOM" : "UTF-8" };
    }
    catch {
        try {
            return { text: new TextDecoder("windows-1252").decode(body), encoding: "Windows-1252" };
        }
        catch {
            return { text: new TextDecoder("utf-8").decode(body), encoding: "UTF-8" };
        }
    }
}
exports.decodeText = decodeText;
const UTF16LE_NO_BOM = "UTF-16 LE without BOM";
const UTF16BE_NO_BOM = "UTF-16 BE without BOM";
/**
 * Text never contains zero bytes, except UTF-16, where every other byte of
 * Latin text is zero. Looks at the first 8 KB only.
 */
function sniffZeros(bytes) {
    const end = Math.min(bytes.length, 8192) & ~1;
    let even = 0;
    let odd = 0;
    for (let i = 0; i < end; i++)
        if (bytes[i] === 0) {
            if (i & 1)
                odd++;
            else
                even++;
        }
    if (bytes.length & 1 && bytes.length <= 8192 && bytes[bytes.length - 1] === 0)
        odd++;
    if (!even && !odd)
        return undefined;
    const pairs = end / 2;
    // Mostly-Latin UTF-16: one of the two bytes of most characters is zero, the other almost never.
    if (odd >= pairs * 0.3 && even <= pairs * 0.02)
        return "utf-16le";
    if (even >= pairs * 0.3 && odd <= pairs * 0.02)
        return "utf-16be";
    return "binary";
}
/**
 * Picks the separator that splits the first lines into the most consistent
 * number of fields, ignoring separators inside quotes.
 */
function detectDelimiter(text) {
    const sample = sampleLines(text, 30);
    if (!sample.length)
        return ",";
    let best = ",";
    let bestScore = 0;
    for (const delimiter of exports.DELIMITERS) {
        const counts = sample.map(line => countOutsideQuotes(line, delimiter));
        const first = counts[0];
        if (!first)
            continue;
        const consistent = counts.filter(c => c === first).length / counts.length;
        const score = consistent * 10 + Math.min(first, 50) / 50;
        if (score > bestScore) {
            bestScore = score;
            best = delimiter;
        }
    }
    return best;
}
exports.detectDelimiter = detectDelimiter;
function sampleLines(text, max) {
    const lines = [];
    let start = 0;
    let quoted = false;
    for (let i = 0; i < text.length && lines.length < max; i++) {
        const ch = text[i];
        if (ch === '"')
            quoted = !quoted;
        else if ((ch === "\n" || ch === "\r") && !quoted) {
            if (i > start)
                lines.push(text.slice(start, i));
            if (ch === "\r" && text[i + 1] === "\n")
                i++;
            start = i + 1;
        }
    }
    if (lines.length < max && start < text.length)
        lines.push(text.slice(start, Math.min(text.length, start + 100000)));
    return lines.filter(line => line.trim());
}
function countOutsideQuotes(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (const ch of line) {
        if (ch === '"')
            quoted = !quoted;
        else if (ch === delimiter && !quoted)
            count++;
    }
    return count;
}
/** Most unclosed quotes the parser repairs; past that the rest of the file is one cell, as in Excel. */
const MAX_QUOTE_REPAIRS = 50;
/**
 * Parses CSV/TSV text (RFC 4180): quoted fields may hold separators, quotes
 * written as "" and line breaks; lines may end in CRLF, LF or CR. Values stay
 * text, exactly as written, so leading zeros and codes survive. A trailing
 * empty line is not a row.
 *
 * Excel's "sep=;" first line names the separator and is not a row (it is
 * kept as preamble, so saving writes it back). A quote that opens a field but
 * is never closed would swallow the rest of the file into one cell; instead it
 * is read as a literal quote character, and issues says where, so nothing goes
 * missing silently.
 */
function parseCsv(text, options = {}) {
    if (text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    const sep = /^sep=([^\r\n])(\r\n|\n|\r|$)/i.exec(text);
    const begin = sep ? sep[0].length : 0;
    const delimiter = options.delimiter || (sep ? sep[1] : detectDelimiter(begin ? text.slice(begin) : text));
    // With spans, each row's [start, end) in the text, so unchanged rows can be written back byte for byte.
    const spans = options.spans ? [] : undefined;
    const issues = [];
    const literal = new Set();
    let rowStart = begin;
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    let quoteAt = -1;
    let cells = 0;
    let columnCount = 0;
    let truncatedRows = 0;
    const length = text.length;
    const endRow = (end) => {
        row.push(field);
        field = "";
        if (cells + row.length > types_1.MAX_CELLS)
            truncatedRows++;
        else {
            cells += row.length;
            if (row.length > columnCount)
                columnCount = row.length;
            rows.push(row);
            spans?.push(rowStart, end);
        }
        row = [];
    };
    let i = begin;
    for (;;) {
        for (; i < length; i++) {
            const ch = text[i];
            if (quoted) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i++;
                    }
                    else
                        quoted = false;
                }
                else {
                    // Copy the run up to the next quote in one go; quoted fields can be long.
                    const next = text.indexOf('"', i);
                    const end = next === -1 ? length : next;
                    field += text.slice(i, end);
                    i = end - 1;
                }
            }
            else if (ch === '"' && field === "" && !literal.has(i)) {
                quoted = true;
                quoteAt = i;
            }
            else if (ch === delimiter) {
                row.push(field);
                field = "";
            }
            else if (ch === "\n" || ch === "\r") {
                const end = i;
                if (ch === "\r" && text[i + 1] === "\n")
                    i++;
                endRow(end);
                rowStart = i + 1;
            }
            else {
                field += ch;
            }
        }
        if (!quoted)
            break;
        // Nothing after an unclosed quote ended a row, so the state is as it was when the quote opened: read on from there.
        const at = { row: rows.length + truncatedRows, line: lineOf(text, quoteAt) };
        if (literal.size >= MAX_QUOTE_REPAIRS) {
            issues.push({ ...at, message: "A quote opens a field here and is never closed, so the rest of the file was read into this cell." });
            break;
        }
        issues.push({ ...at, message: "A quote opens a field here and is never closed; it was kept as a literal \" character." });
        literal.add(quoteAt);
        quoted = false;
        field = "";
        i = quoteAt;
    }
    if (field !== "" || row.length || quoted)
        endRow(length);
    // Blank lines at the end of a file are not rows.
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
        rows.pop();
        spans?.splice(-2, 2);
    }
    return {
        name: "Sheet1", rows, columnCount, delimiter,
        ...(truncatedRows ? { truncatedRows } : {}),
        ...(spans ? { spans } : {}),
        ...(issues.length ? { issues } : {}),
        ...(sep ? { preamble: sep[0] } : {})
    };
}
exports.parseCsv = parseCsv;
function lineOf(text, at) {
    let line = 1;
    for (let i = 0; i < at; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 10 || (ch === 13 && text.charCodeAt(i + 1) !== 10))
            line++;
    }
    return line;
}
/** One row as CSV, quoting only the fields that need it. */
function csvLine(row, delimiter = ",") {
    return row.map(value => {
        const text = value === null || value === undefined ? "" : String(value);
        return text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(delimiter);
}
exports.csvLine = csvLine;
/** Writes rows as CSV. */
function toCsv(rows, delimiter = ",") {
    return rows.map(row => csvLine(row, delimiter)).join("\r\n") + (rows.length ? "\r\n" : "");
}
exports.toCsv = toCsv;
/** The line ending a text uses (its first one), and whether it ends with one. */
function lineEndings(text) {
    const at = text.search(/\r\n|\n|\r/);
    const eol = at === -1 ? "\n" : text[at] === "\r" && text[at + 1] === "\n" ? "\r\n" : text[at];
    return { eol, trailing: /[\r\n]$/.test(text) };
}
exports.lineEndings = lineEndings;
// Windows-1252 code points 0x80-0x9F that differ from Latin-1.
const CP1252_HIGH = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
    0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};
/** The bytes 0x80-0x9F that Windows-1252 maps to other characters. */
const CP1252_BYTES = new Set(Object.values(CP1252_HIGH));
/**
 * Encodes text in the encoding the file was read with (as named by
 * decodeText). Text Windows-1252 can't hold is written as UTF-8 with a
 * byte-order mark instead, and the result says so.
 */
function encodeText(text, encoding = "UTF-8") {
    if (encoding === "UTF-8 with BOM")
        return { bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]), encoding };
    if (encoding === "UTF-16 LE" || encoding === UTF16LE_NO_BOM) {
        const bom = encoding === UTF16LE_NO_BOM ? [] : [0xff, 0xfe];
        return { bytes: Buffer.concat([Buffer.from(bom), Buffer.from(text, "utf16le")]), encoding };
    }
    if (encoding === "UTF-16 BE" || encoding === UTF16BE_NO_BOM) {
        const le = Buffer.from(text, "utf16le");
        for (let i = 0; i + 1 < le.length; i += 2) {
            const b = le[i];
            le[i] = le[i + 1];
            le[i + 1] = b;
        }
        return { bytes: Buffer.concat([Buffer.from(encoding === UTF16BE_NO_BOM ? [] : [0xfe, 0xff]), le]), encoding };
    }
    if (encoding === "Windows-1252") {
        const out = Buffer.alloc(text.length);
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            const byte = code < 0x100 && (code < 0x80 || code > 0x9f || !CP1252_BYTES.has(code)) ? code : CP1252_HIGH[code];
            if (byte === undefined)
                return encodeText(text, "UTF-8 with BOM");
            out[i] = byte;
        }
        return { bytes: out, encoding };
    }
    return { bytes: Buffer.from(text, "utf8"), encoding: "UTF-8" };
}
exports.encodeText = encodeText;
//# sourceMappingURL=csv.js.map