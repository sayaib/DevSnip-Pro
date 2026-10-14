"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadText = exports.loadSpreadsheet = void 0;
const csv_1 = require("./csv");
const xlsx_1 = require("./xlsx");
const types_1 = require("./types");
/** Opens a file's bytes as a CSV/TSV text or an .xlsx workbook. Pure: no vscode, no file system. */
function loadSpreadsheet(bytes, name, format, delimiter) {
    if (bytes.length > types_1.MAX_FILE_BYTES) {
        throw new types_1.SpreadsheetError(`This file is ${Math.round(bytes.length / 1024 / 1024)} MB; the viewer opens files up to ${types_1.MAX_FILE_BYTES / 1024 / 1024} MB.`, "Split it, or filter it down first.");
    }
    if (format === "xlsx") {
        const workbook = new xlsx_1.XlsxWorkbook(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        return {
            summary: { name, format, size: bytes.length, sheets: workbook.sheets },
            sheet: index => workbook.sheet(index),
            type: (index, row, col, text) => (0, xlsx_1.typeCellText)(text, row >= 0 || col >= 0 ? workbook.styleAt(index, row, col) : xlsx_1.GENERAL, workbook.is1904),
            structureLock: () => workbook.structureLock(),
            serialize: editor => ({ bytes: workbook.save(editor.edits()) })
        };
    }
    const { text, encoding } = (0, csv_1.decodeText)(bytes);
    return loadText(text, name, format, delimiter ?? (format === "tsv" ? "\t" : undefined), { size: bytes.length, encoding });
}
exports.loadSpreadsheet = loadSpreadsheet;
/** Parses CSV/TSV text, e.g. pasted into the viewer. */
function loadText(text, name, format = "csv", delimiter, extra = {}) {
    if (/^\s*PK\u0003\u0004/.test(text))
        throw new types_1.SpreadsheetError("This looks like an Excel workbook, not CSV text.", "Open the .xlsx file itself instead of pasting it.");
    if (text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    const { spans, ...sheet } = (0, csv_1.parseCsv)(text, { delimiter, spans: true });
    sheet.name = name.replace(/\.[^.]+$/, "") || "Sheet1";
    const { eol, trailing } = (0, csv_1.lineEndings)(text);
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
                if (!edits?.colOrigin && !dirtyRows.has(r) && origin >= 0 && spans && spans[origin * 2 + 1] !== undefined)
                    return text.slice(spans[origin * 2], spans[origin * 2 + 1]);
                // Edited and new rows get every column's separator, so the file stays rectangular.
                return (0, csv_1.csvLine)(row.length < sheet.columnCount ? [...row, ...Array(sheet.columnCount - row.length).fill("")] : row, sheet.delimiter);
            });
            const out = lines.join(eol) + (trailing && lines.length ? eol : "");
            const encoded = (0, csv_1.encodeText)(out, extra.encoding);
            return { bytes: encoded.bytes, note: extra.encoding && encoded.encoding !== extra.encoding ? `Saved as ${encoded.encoding}: the text has characters ${extra.encoding} can't hold.` : undefined };
        }
    };
}
exports.loadText = loadText;
//# sourceMappingURL=load.js.map