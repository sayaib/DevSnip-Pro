"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vm = __importStar(require("vm"));
const zlib = __importStar(require("zlib"));
const csv_1 = require("../../spreadsheet/csv");
const load_1 = require("../../spreadsheet/load");
const page_1 = require("../../spreadsheet/page");
const xlsx_1 = require("../../spreadsheet/xlsx");
const edit_1 = require("../../spreadsheet/edit");
const xlsx_write_1 = require("../../spreadsheet/xlsx-write");
const zip_1 = require("../../spreadsheet/zip");
const csv_2 = require("../../spreadsheet/csv");
const types_1 = require("../../spreadsheet/types");
const layout_1 = require("../../toolkits/layout");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "../../..");
/** Writes a ZIP archive; entries named with a trailing "!" are stored, the rest deflated. */
function zip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [rawName, content] of Object.entries(files)) {
        const stored = rawName.endsWith("!");
        const name = Buffer.from(stored ? rawName.slice(0, -1) : rawName);
        const data = Buffer.from(content, "utf8");
        const body = stored ? data : zlib.deflateRawSync(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(stored ? 0 : 8, 10);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, body);
        centrals.push(central, name);
        offset += 30 + name.length + body.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function workbook(extra = {}) {
    return zip({
        "[Content_Types].xml": "<Types/>",
        "_rels/.rels": '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": `<workbook ${NS}><workbookPr/><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Chart" sheetId="3" r:id="rId9"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="ws"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml" Type="ws"/><Relationship Id="rId9" Target="chartsheets/sheet1.xml" Type="cs"/><Relationship Id="rId3" Target="sharedStrings.xml" Type="ss"/></Relationships>',
        "xl/sharedStrings.xml!": `<sst ${NS}><si><t>Name</t></si><si><t>Amount</t></si><si><r><t>Ri</t></r><r><rPr><b/></rPr><t xml:space="preserve">ch </t></r><rPh><t>ignored</t></rPh></si><si><t>Line_x000D_
two &lt;ok&gt;</t></si></sst>`,
        "xl/styles.xml": `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>`,
        "xl/worksheets/sheet1.xml": `<worksheet ${NS}><dimension ref="A1:D4"/><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Inline</t></is></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>1234.5</v></c><c r="C2" s="1"><v>45356</v></c><c r="D2" t="b"><v>1</v></c></row>
      <row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" s="3"><f>B2/1000</f><v>1.2345</v></c><c r="C4" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="D4" s="0"/></row>
    </sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
        "xl/worksheets/sheet2.xml": `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row><x:c t="str"><x:v>no refs</x:v></x:c><x:c><x:v>0.30000000000000004</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
        "xl/chartsheets/sheet1.xml": "<chartsheet/>",
        ...extra
    });
}
(0, run_unit_tests_1.suite)("spreadsheet: CSV", () => {
    (0, run_unit_tests_1.test)("parses quotes, escaped quotes, separators and line breaks inside fields", () => {
        const sheet = (0, csv_1.parseCsv)('id,name,note\r\n1,"Smith, Jane","said ""hi"""\n2,Bob,"two\nlines"\r3,,\n');
        assert.deepStrictEqual(sheet.rows, [["id", "name", "note"], ["1", "Smith, Jane", 'said "hi"'], ["2", "Bob", "two\nlines"], ["3", "", ""]]);
        assert.strictEqual(sheet.columnCount, 3);
        assert.strictEqual(sheet.delimiter, ",");
    });
    (0, run_unit_tests_1.test)("keeps values as written: leading zeros, codes and ragged rows", () => {
        const sheet = (0, csv_1.parseCsv)("zip,code\n02134,007\nshort\n");
        assert.deepStrictEqual(sheet.rows, [["zip", "code"], ["02134", "007"], ["short"]]);
    });
    (0, run_unit_tests_1.test)("detects comma, semicolon, tab and pipe, ignoring separators in quotes", () => {
        assert.strictEqual((0, csv_1.detectDelimiter)("a;b;c\n1;2;3\n"), ";");
        assert.strictEqual((0, csv_1.detectDelimiter)("a\tb\n1\t2"), "\t");
        assert.strictEqual((0, csv_1.detectDelimiter)("a|b\n1|2"), "|");
        assert.strictEqual((0, csv_1.detectDelimiter)('"x;y;z",b\n"1;2;3",c'), ",");
        assert.strictEqual((0, csv_1.detectDelimiter)("single column\nonly"), ",");
        assert.deepStrictEqual((0, csv_1.parseCsv)("a,b;c\n", { delimiter: ";" }).rows, [["a,b", "c"]]);
    });
    (0, run_unit_tests_1.test)("drops trailing blank lines and a byte-order mark", () => {
        assert.deepStrictEqual((0, csv_1.parseCsv)("﻿a,b\n1,2\n\n\n").rows, [["a", "b"], ["1", "2"]]);
        assert.deepStrictEqual((0, csv_1.parseCsv)("").rows, []);
    });
    (0, run_unit_tests_1.test)("decodes UTF-8, UTF-16 and falls back to Windows-1252", () => {
        assert.deepStrictEqual((0, csv_1.decodeText)(Buffer.from("﻿café", "utf8")), { text: "café", encoding: "UTF-8 with BOM" });
        assert.deepStrictEqual((0, csv_1.decodeText)(Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00])), { text: "a,", encoding: "UTF-16 LE" });
        assert.deepStrictEqual((0, csv_1.decodeText)(Buffer.from([0x63, 0x61, 0x66, 0xe9])), { text: "café", encoding: "Windows-1252" });
    });
    (0, run_unit_tests_1.test)("writes CSV back, quoting only what needs it", () => {
        assert.strictEqual((0, csv_1.toCsv)([["a", "b,c", null], [1, 'q"t', " s"]]), 'a,"b,c",\r\n1,"q""t"," s"\r\n');
        assert.deepStrictEqual((0, csv_1.parseCsv)((0, csv_1.toCsv)([["x\ny", '"', ""]])).rows, [["x\ny", '"', ""]]);
    });
    (0, run_unit_tests_1.test)("pasted text and .tsv files load as one sheet", () => {
        const pasted = (0, load_1.loadText)("a\tb\n1\t2", "Pasted data");
        assert.strictEqual(pasted.summary.delimiter, "\t");
        assert.deepStrictEqual(pasted.sheet(0).rows, [["a", "b"], ["1", "2"]]);
        const tsv = (0, load_1.loadSpreadsheet)(Buffer.from("a,b\tc"), "x.tsv", "tsv");
        assert.deepStrictEqual(tsv.sheet(0).rows, [["a,b", "c"]], "a .tsv splits on tabs, not commas");
        assert.throws(() => (0, load_1.loadText)("PK\u0003\u0004binary", "x"), types_1.SpreadsheetError);
    });
});
(0, run_unit_tests_1.suite)("spreadsheet: Excel workbooks", () => {
    (0, run_unit_tests_1.test)("reads sheet names, hidden sheets and skips chart sheets", () => {
        const book = new xlsx_1.XlsxWorkbook(workbook());
        assert.deepStrictEqual(book.sheets, [{ name: "Data & more", hidden: false }, { name: "Secret", hidden: true }]);
    });
    (0, run_unit_tests_1.test)("reads shared, rich and inline strings, numbers, dates, booleans, formulas and errors", () => {
        const sheet = new xlsx_1.XlsxWorkbook(workbook()).sheet(0);
        assert.deepStrictEqual(sheet.rows, [
            ["Name", "Amount", null, "Inline"],
            ["Rich ", 1234.5, "2024-03-05", true],
            [],
            ["Line\r\ntwo <ok>", 1.2345, "#DIV/0!"]
        ]);
        assert.strictEqual(sheet.columnCount, 4);
        assert.deepStrictEqual(sheet.display, { "1:1": "$1,234.50", "3:1": "123.45%", "3:2": "#DIV/0!" });
        assert.deepStrictEqual(sheet.formulas, { "3:1": "B2/1000", "3:2": "1/0" });
        assert.deepStrictEqual(sheet.merges, ["A1:B1"]);
    });
    (0, run_unit_tests_1.test)("handles namespace prefixes, cells without references and float noise", () => {
        const sheet = new xlsx_1.XlsxWorkbook(workbook()).sheet(1);
        assert.deepStrictEqual(sheet.rows, [["no refs", 0.3]]);
    });
    (0, run_unit_tests_1.test)("refuses old .xls, encrypted and non-workbook files with a clear message", () => {
        const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
        assert.throws(() => new xlsx_1.XlsxWorkbook(ole), (e) => e instanceof types_1.SpreadsheetError && /\.xls/.test(e.message));
        assert.throws(() => new xlsx_1.XlsxWorkbook(Buffer.from("name,age\n")), types_1.SpreadsheetError);
        assert.throws(() => new xlsx_1.XlsxWorkbook(zip({ "word/document.xml": "<w/>" })), (e) => e instanceof types_1.SpreadsheetError && /not an Excel workbook/.test(e.message));
        assert.throws(() => new xlsx_1.XlsxWorkbook(workbook().subarray(0, 200)), types_1.SpreadsheetError);
    });
    (0, run_unit_tests_1.test)("number formats show the way Excel shows them", () => {
        const cases = [
            [1234.567, "0.00", "1234.57"], [1234.567, "#,##0.00", "1,234.57"], [0.1234, "0.0%", "12.3%"], [12345678, "0.00E+00", "1.23E+07"],
            [-5, "0;(0)", "(5)"], [0, '0;-0;"zero"', "zero"], [3.5, '0.0# "kg"', "3.5 kg"], [1234.5, "[$€-407]#,##0.00", "€1,234.50"],
            [-1234.5, "#,##0.00 [$EUR]", "-1,234.50 EUR"], [7, "00000", "00007"], [1500000, '#,##0,,"M"', "2M"], [0.5, "#.00", ".50"],
            [1234.5, "_($* #,##0.00_)", "$1,234.50"]
        ];
        for (const [value, format, expected] of cases)
            assert.strictEqual((0, xlsx_1.formatNumber)(value, format), expected, `${value} as ${format}`);
        assert.strictEqual((0, xlsx_1.classifyFormat)("General"), "general");
        assert.strictEqual((0, xlsx_1.classifyFormat)("[Red]0.00"), "number");
        assert.strictEqual((0, xlsx_1.classifyFormat)("dd/mm/yyyy"), "date");
        assert.strictEqual((0, xlsx_1.classifyFormat)("mm:ss"), "date");
        assert.strictEqual((0, xlsx_1.classifyFormat)("@"), "text");
        assert.strictEqual((0, xlsx_1.classifyFormat)('0.00 "days"'), "number", "a quoted literal's letters are not date parts");
    });
    (0, run_unit_tests_1.test)("date serials become ISO dates, times and durations, in both date systems", () => {
        assert.strictEqual((0, xlsx_1.formatDate)(45356, "yyyy-mm-dd"), "2024-03-05");
        assert.strictEqual((0, xlsx_1.formatDate)(45356.6041666667, "dd/mm/yyyy hh:mm"), "2024-03-05 14:30");
        assert.strictEqual((0, xlsx_1.formatDate)(0.378553, "hh:mm:ss"), "09:05:07");
        assert.strictEqual((0, xlsx_1.formatDate)(1.5, "[h]:mm:ss"), "36:00:00");
        assert.strictEqual((0, xlsx_1.formatDate)(61, "d-mmm-yy"), "1900-03-01", "after Excel's phantom 29 February 1900");
        assert.strictEqual((0, xlsx_1.formatDate)(1, "yyyy-mm-dd"), "1900-01-01");
        assert.strictEqual((0, xlsx_1.formatDate)(0, "yyyy-mm-dd", true), "1904-01-01");
    });
    (0, run_unit_tests_1.test)("cell references and column names round-trip", () => {
        assert.strictEqual((0, types_1.columnName)(0), "A");
        assert.strictEqual((0, types_1.columnName)(25), "Z");
        assert.strictEqual((0, types_1.columnName)(26), "AA");
        assert.strictEqual((0, types_1.columnName)(16383), "XFD");
        assert.strictEqual((0, types_1.columnIndex)("XFD"), 16383);
        assert.deepStrictEqual((0, types_1.parseCellRef)("$B$12"), { row: 11, col: 1 });
        assert.strictEqual((0, types_1.parseCellRef)("12B"), undefined);
        assert.strictEqual((0, types_1.formatOf)("Report.XLSX"), "xlsx");
        assert.strictEqual((0, types_1.formatOf)("data.tab"), "tsv");
        assert.strictEqual((0, types_1.formatOf)("old.xls"), undefined);
    });
});
function editorFor(bytes, name) {
    const loaded = (0, load_1.loadSpreadsheet)(bytes, name, (0, types_1.formatOf)(name));
    const editor = new edit_1.WorkbookEditor({ sheet: i => loaded.sheet(i), type: loaded.type, structureLock: () => loaded.structureLock() });
    return { loaded, editor, save: () => loaded.serialize(editor) };
}
(0, run_unit_tests_1.suite)("spreadsheet: editing CSV", () => {
    const source = 'id,name,note\r\n1,"Smith, Jane",  spaced  \r\n2,Bob,"said ""hi"""\r\n3,Cy,\r\n';
    (0, run_unit_tests_1.test)("edits rewrite only the rows they touch; everything else is saved byte for byte", () => {
        const { loaded, editor, save } = editorFor(Buffer.from(source), "people.csv");
        loaded.sheet(0);
        editor.set(0, [{ r: 2, c: 1, text: "Robert, Jr." }]);
        assert.strictEqual(save().bytes.toString(), 'id,name,note\r\n1,"Smith, Jane",  spaced  \r\n2,"Robert, Jr.","said ""hi"""\r\n3,Cy,\r\n');
    });
    (0, run_unit_tests_1.test)("undo and redo restore cells, and an undone file saves exactly as it was", () => {
        const { loaded, editor, save } = editorFor(Buffer.from(source), "people.csv");
        loaded.sheet(0);
        const edit = editor.set(0, [{ r: 1, c: 2, text: "x" }, { r: 5, c: 0, text: "new" }]);
        assert.strictEqual(edit.label, "Edit 2 cells");
        assert.deepStrictEqual(loaded.sheet(0).rows[5], ["new"]);
        const undone = edit.undo();
        assert.strictEqual(undone.kind, "cells");
        assert.strictEqual(loaded.sheet(0).rows.length, 4, "rows the edit added are taken away again");
        assert.strictEqual(save().bytes.toString(), source);
        edit.redo();
        assert.strictEqual(loaded.sheet(0).rows[1][2], "x");
        assert.strictEqual(editor.set(0, [{ r: 1, c: 2, text: "x" }]), undefined, "typing the same value is not an edit");
    });
    (0, run_unit_tests_1.test)("rows and columns can be inserted and deleted, and new rows keep every separator", () => {
        const { loaded, editor, save } = editorFor(Buffer.from(source), "people.csv");
        loaded.sheet(0);
        editor.insertRows(0, 1, 1);
        editor.set(0, [{ r: 1, c: 0, text: "0" }]);
        editor.deleteRows(0, [3]);
        assert.strictEqual(save().bytes.toString(), 'id,name,note\r\n0,,\r\n1,"Smith, Jane",  spaced  \r\n3,Cy,\r\n');
        const cols = editor.insertColumns(0, 1, 1);
        editor.set(0, [{ r: 0, c: 1, text: "email" }]);
        assert.deepStrictEqual(loaded.sheet(0).rows[0], ["id", "email", "name", "note"]);
        editor.deleteColumns(0, [3]);
        assert.strictEqual(save().bytes.toString(), "id,email,name\r\n0,,\r\n1,,\"Smith, Jane\"\r\n3,,Cy\r\n");
        cols.undo();
        assert.deepStrictEqual(loaded.sheet(0).rows[0], ["id", "name", "note"], "undo restores the snapshot");
        assert.throws(() => editor.deleteColumns(0, [0, 1, 2]), types_1.SpreadsheetError, "a sheet keeps one column");
    });
    (0, run_unit_tests_1.test)("keeps the encoding, byte-order mark and line endings it was read with", () => {
        const latin = Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x0a]);
        const csv = editorFor(latin, "w.csv");
        csv.loaded.sheet(0);
        csv.editor.set(0, [{ r: 1, c: 0, text: "crème €5" }]);
        assert.deepStrictEqual([...csv.save().bytes], [0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x63, 0x72, 0xe8, 0x6d, 0x65, 0x20, 0x80, 0x35, 0x0a]);
        csv.editor.set(0, [{ r: 1, c: 0, text: "日本" }]);
        const fallback = csv.save();
        assert.ok(fallback.note && /UTF-8/.test(fallback.note), "characters Windows-1252 can't hold switch to UTF-8, and say so");
        assert.deepStrictEqual([...fallback.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
        const bom = editorFor(Buffer.from("\ufeffa;b\n1;2", "utf8"), "x.csv");
        bom.loaded.sheet(0);
        bom.editor.set(0, [{ r: 1, c: 1, text: "3" }]);
        assert.strictEqual(bom.save().bytes.toString("utf8"), "\ufeffa;b\n1;3", "no trailing newline is added where there was none");
        assert.deepStrictEqual((0, csv_2.lineEndings)("a\rb\r"), { eol: "\r", trailing: true });
        assert.deepStrictEqual([...(0, csv_2.encodeText)("é", "UTF-16 BE").bytes], [0xfe, 0xff, 0x00, 0xe9]);
    });
    (0, run_unit_tests_1.test)("pasted data and partly loaded files refuse edits", () => {
        const big = editorFor(Buffer.from("a\n1"), "x.csv");
        big.loaded.sheet(0).truncatedRows = 5;
        assert.throws(() => big.editor.set(0, [{ r: 0, c: 0, text: "b" }]), /too large to edit/);
    });
});
(0, run_unit_tests_1.suite)("spreadsheet: editing Excel workbooks", () => {
    (0, run_unit_tests_1.test)("typed text becomes numbers, percentages, booleans, formulas or text, the way Excel reads it", () => {
        const general = { format: "General", kind: "general" };
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("1,234.5", general), { v: 1234.5 });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("12.5%", general), { v: 0.125 });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("true", general), { v: true });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("=SUM(A1:A3)", general), { v: null, f: "SUM(A1:A3)" });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("007", { format: "@", kind: "text" }), { v: "007" }, "text cells keep what was typed");
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("2.5", { format: "0.00%", kind: "number" }), { v: 2.5, d: "250.00%" });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("45356", { format: "yyyy-mm-dd", kind: "date" }), { v: "2024-03-05" });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("hello 42", general), { v: "hello 42" });
        assert.deepStrictEqual((0, xlsx_1.typeCellText)("", general), { v: null });
    });
    (0, run_unit_tests_1.test)("saving rewrites edited cells, keeps untouched ones (shared strings, styles, formulas) and every other part", () => {
        const original = workbook({
            "xl/calcChain.xml": '<calcChain><c r="B4" i="1"/></calcChain>',
            "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="ws"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml" Type="ws"/><Relationship Id="rId9" Target="chartsheets/sheet1.xml" Type="cs"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
            "[Content_Types].xml": '<Types><Override PartName="/xl/calcChain.xml" ContentType="x"/><Override PartName="/xl/workbook.xml" ContentType="y"/></Types>'
        });
        const { loaded, editor, save } = editorFor(original, "book.xlsx");
        loaded.sheet(0);
        editor.set(0, [
            { r: 1, c: 1, text: "99.5" },
            { r: 1, c: 2, text: "2025-01-31" },
            { r: 3, c: 1, text: "=B2*3" },
            { r: 5, c: 0, text: "a & <b>" }
        ]);
        const saved = save().bytes;
        const zip = new zip_1.ZipReader(saved);
        const sheetXml = zip.text("xl/worksheets/sheet1.xml");
        assert.ok(sheetXml.includes('<c r="A1" t="s"><v>0</v></c>'), "an untouched shared-string cell is copied as it was");
        assert.ok(sheetXml.includes('<c r="B2" s="2"><v>99.5</v></c>'), "an edited cell keeps its style");
        assert.ok(sheetXml.includes('<c r="C2" s="1"><v>45688</v></c>'), "a date typed into a date cell is saved as a date serial");
        assert.ok(sheetXml.includes('<c r="B4" s="3"><f>B2*3</f></c>'));
        assert.ok(sheetXml.includes('<c r="A6" t="inlineStr"><is><t xml:space="preserve">a &amp; &lt;b&gt;</t></is></c>'));
        assert.ok(sheetXml.includes('<dimension ref="A1:D6"/>'));
        assert.ok(sheetXml.includes('<mergeCell ref="A1:B1"/>'), "the rest of the sheet is untouched");
        assert.ok(!zip.has("xl/calcChain.xml"), "the stale calculation chain is dropped");
        assert.ok(!zip.text("xl/_rels/workbook.xml.rels").includes("calcChain"));
        assert.ok(!zip.text("[Content_Types].xml").includes("calcChain"));
        assert.ok(/<calcPr fullCalcOnLoad="1"\/><\/workbook>/.test(zip.text("xl/workbook.xml")), "Excel recalculates on open");
        assert.deepStrictEqual(zip.read("xl/sharedStrings.xml"), new zip_1.ZipReader(original).read("xl/sharedStrings.xml"), "other parts are copied byte for byte");
        const reread = new xlsx_1.XlsxWorkbook(saved).sheet(0);
        assert.deepStrictEqual(reread.rows[1], ["Rich ", 99.5, "2025-01-31", true]);
        assert.deepStrictEqual(reread.rows[5], ["a & <b>"]);
        assert.strictEqual(reread.formulas?.["3:1"], "B2*3");
    });
    (0, run_unit_tests_1.test)("rows and columns can't move under formulas, but can be added at the end", () => {
        const { loaded, editor, save } = editorFor(workbook(), "book.xlsx");
        loaded.sheet(0);
        assert.throws(() => editor.insertRows(0, 1, 1), /formulas/);
        assert.throws(() => editor.deleteColumns(0, [0]), /formulas/);
        editor.insertRows(0, loaded.sheet(0).rows.length, 1);
        editor.set(0, [{ r: 4, c: 0, text: "appended" }]);
        assert.deepStrictEqual(new xlsx_1.XlsxWorkbook(save().bytes).sheet(0).rows[4], ["appended"]);
    });
    (0, run_unit_tests_1.test)("plain data workbooks can insert and delete rows and columns, moving cells with their styles", () => {
        const plain = zip({
            "_rels/.rels": '<Relationships><Relationship Id="r1" Target="xl/workbook.xml" Type="officeDocument"/></Relationships>',
            "xl/workbook.xml": `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
            "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="ws"/></Relationships>',
            "xl/styles.xml": `<styleSheet ${NS}><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
            "xl/worksheets/sheet1.xml": `<worksheet ${NS}><sheetData><row r="1" ht="30" customHeight="1"><c r="A1" t="inlineStr"><is><t>h1</t></is></c><c r="B1" t="inlineStr"><is><t>h2</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" s="1"><v>45356</v></c></row><row r="3"><c r="A3"><v>2</v></c></row></sheetData></worksheet>`
        });
        const { loaded, editor, save } = editorFor(plain, "plain.xlsx");
        loaded.sheet(0);
        assert.strictEqual(loaded.structureLock(), undefined);
        editor.insertRows(0, 1, 1);
        editor.insertColumns(0, 0, 1);
        editor.deleteRows(0, [3]);
        const xml = new zip_1.ZipReader(save().bytes).text("xl/worksheets/sheet1.xml");
        assert.ok(xml.includes('<row r="1" ht="30" customHeight="1"><c r="B1" t="inlineStr"><is><t>h1</t></is></c>'), "row attributes stay, cells move right");
        assert.ok(xml.includes('<row r="3"><c r="B3"><v>1</v></c><c r="C3" s="1"><v>45356</v></c></row>'), "moved cells keep their style and value");
        assert.ok(!xml.includes("<v>2</v>"), "the deleted row is gone");
    });
    (0, run_unit_tests_1.test)("a protected sheet locks cells the way Excel does, and only unlocked cells can be edited", () => {
        const book = zip({
            "_rels/.rels": '<Relationships><Relationship Id="r1" Target="xl/workbook.xml" Type="officeDocument"/></Relationships>',
            "xl/workbook.xml": `<workbook ${NS}><sheets><sheet name="P" sheetId="1" r:id="rId1"/><sheet name="Open" sheetId="2" r:id="rId2"/></sheets></workbook>`,
            "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="ws"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="ws"/></Relationships>',
            "xl/styles.xml": `<styleSheet ${NS}><cellXfs><xf numFmtId="0"/><xf numFmtId="0" applyProtection="1"><protection locked="0"/></xf></cellXfs></styleSheet>`,
            "xl/worksheets/sheet1.xml": `<worksheet ${NS}><cols><col min="4" max="4" style="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>fixed</t></is></c><c r="B1" s="1"><v>1</v></c></row><row r="2" s="1" customFormat="1"><c r="A2" s="0"><v>2</v></c></row></sheetData><sheetProtection sheet="1" objects="1"/></worksheet>`,
            "xl/worksheets/sheet2.xml": `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="0"/></worksheet>`
        });
        const { loaded, editor, save } = editorFor(book, "p.xlsx");
        const sheet = loaded.sheet(0);
        assert.strictEqual((0, types_1.isCellLocked)(sheet, 0, 0), true, "cells are locked by default");
        assert.strictEqual((0, types_1.isCellLocked)(sheet, 0, 1), false, "a cell formatted as unlocked");
        assert.strictEqual((0, types_1.isCellLocked)(sheet, 1, 0), true, "a cell's own style beats its row's");
        assert.strictEqual((0, types_1.isCellLocked)(sheet, 1, 2), false, "an empty cell takes its row's style");
        assert.strictEqual((0, types_1.isCellLocked)(sheet, 5, 3), false, "then its column's");
        assert.strictEqual((0, types_1.isCellLocked)(sheet, 5, 2), true, "then the default style's");
        assert.strictEqual(loaded.sheet(1).protection, undefined, 'sheet="0" is not protected');
        assert.throws(() => editor.set(0, [{ r: 0, c: 0, text: "x" }]), /locked/);
        assert.throws(() => editor.set(0, [{ r: 0, c: 1, text: "2" }, { r: 0, c: 0, text: "x" }]), /locked/, "a paste touching a locked cell changes nothing");
        assert.strictEqual(sheet.rows[0][1], 1);
        assert.throws(() => editor.insertRows(0, sheet.rows.length, 1), /protected/, "not even rows at the end");
        editor.set(0, [{ r: 0, c: 1, text: "5" }, { r: 4, c: 3, text: "note" }]);
        const xml = new zip_1.ZipReader(save().bytes).text("xl/worksheets/sheet1.xml");
        assert.ok(xml.includes('<c r="B1" s="1"><v>5</v></c>'), "an unlocked cell keeps its unlocked style");
        assert.ok(xml.includes('<c r="D5" s="1" t="inlineStr">'), "a new cell takes its column's (unlocked) style, so Excel keeps it editable");
        assert.ok(xml.includes('<sheetProtection sheet="1" objects="1"/>'), "the protection stays");
    });
    (0, run_unit_tests_1.test)("XML escapes, date serials and checksums", () => {
        assert.strictEqual((0, xlsx_write_1.escapeXml)('a<b>&"c" _x0041_ \u0001'), "a&lt;b&gt;&amp;&quot;c&quot; _x005F_x0041_ ");
        assert.strictEqual((0, xlsx_write_1.isoToSerial)("2024-03-05"), 45356);
        assert.strictEqual((0, xlsx_write_1.isoToSerial)("1900-01-01"), 1);
        assert.strictEqual((0, xlsx_write_1.isoToSerial)("12:00"), 0.5);
        assert.strictEqual((0, xlsx_write_1.isoToSerial)("2024-02-30"), undefined);
        assert.strictEqual((0, xlsx_write_1.isoToSerial)("1904-01-02", true), 1);
        assert.strictEqual((0, zip_1.crc32)(Buffer.from("123456789")), 0xcbf43926);
    });
});
(0, run_unit_tests_1.suite)("spreadsheet: page and wiring", () => {
    (0, run_unit_tests_1.test)("renders a CSP-locked shell whose script parses and never builds markup from strings", () => {
        const html = (0, page_1.renderSpreadsheetPage)({ cspSource: "vscode-resource:", scriptUri: "vscode-resource:/media/spreadsheet-viewer.js", codiconsUri: "vscode-resource:/codicon.css", platform: "darwin" });
        const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
        assert.ok(nonce, "scripts need a nonce");
        assert.ok(html.includes(`<script nonce="${nonce}" src=`));
        assert.ok(!/ on[a-z]+="/i.test(html), "no inline event handlers");
        const source = fs.readFileSync(path.join(ROOT, "media", "spreadsheet-viewer.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: "spreadsheet-viewer.js" }));
        assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function/.test(source));
    });
    (0, run_unit_tests_1.test)("the viewer has its own section, commands and custom editors", () => {
        const section = layout_1.NAV.find(s => s.id === "spreadsheets");
        assert.ok(section, "Spreadsheets section");
        assert.deepStrictEqual(section.entries.map(e => e.command), ["csvViewer", "excelViewer"]);
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        const commands = new Set(manifest.contributes.commands.map((c) => c.command));
        for (const id of ["csvViewer", "excelViewer", "openInSpreadsheetViewer"])
            assert.ok(commands.has(`sayaib.hue-console.${id}`), id);
        const editors = manifest.contributes.customEditors;
        const excel = editors.find(e => e.viewType === "devsnip.spreadsheetViewer");
        const csv = editors.find(e => e.viewType === "devsnip.csvViewer");
        assert.strictEqual(excel.priority, "default", "Excel files have no text editor, so they open in the viewer");
        assert.strictEqual(csv.priority, "option", "CSV files keep opening as text unless asked");
        assert.deepStrictEqual(csv.selector.map(s => s.filenamePattern), ["*.csv", "*.tsv", "*.tab"]);
        const command = fs.readFileSync(path.join(ROOT, "src", "spreadsheet", "command.ts"), "utf8");
        for (const editor of editors)
            assert.ok(command.includes(`"${editor.viewType}"`), `${editor.viewType} is registered`);
        for (const icon of ["spreadsheet-light.svg", "spreadsheet-dark.svg"])
            assert.ok(fs.existsSync(path.join(ROOT, "media", icon)), icon);
    });
});
//# sourceMappingURL=spreadsheet.unit.js.map