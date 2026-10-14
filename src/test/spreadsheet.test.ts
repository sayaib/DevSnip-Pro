import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createEditorProvider, SpreadsheetDocument } from "../spreadsheet/viewer";

const EXTENSION_ID = "sayaib.hue-console";

/** The smallest .xlsx Excel and the viewer accept: stored (uncompressed) ZIP entries. */
function tinyWorkbook(): Buffer {
  const files: Record<string, string> = {
    "_rels/.rels": '<Relationships><Relationship Id="r1" Target="xl/workbook.xml" Type="officeDocument"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="Only" sheetId="1" r:id="r1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>',
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>'
  };
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(n.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(entry, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

function activeViewType(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.viewType : undefined;
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

suite("CSV & Excel Viewer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-sheets-"));
  const csv = vscode.Uri.file(path.join(dir, "people.csv"));
  const xlsx = vscode.Uri.file(path.join(dir, "book.xlsx"));

  suiteSetup(async () => {
    fs.writeFileSync(csv.fsPath, "name,age\nAda,36\n");
    fs.writeFileSync(xlsx.fsPath, tinyWorkbook());
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  teardown(() => vscode.commands.executeCommand("workbench.action.closeAllEditors"));
  suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("an Excel workbook opens in the viewer by default", async () => {
    await vscode.commands.executeCommand("vscode.open", xlsx);
    await waitFor(() => activeViewType() === "devsnip.spreadsheetViewer");
  });

  test("the Explorer and title-bar command opens a CSV in the CSV viewer", async () => {
    await vscode.commands.executeCommand("sayaib.hue-console.openInSpreadsheetViewer", csv);
    await waitFor(() => activeViewType() === "devsnip.csvViewer");
  });

  test("a CSV still opens as text by default, and the CSV command opens the active one", async () => {
    await vscode.window.showTextDocument(csv);
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText);
    await vscode.commands.executeCommand("sayaib.hue-console.csvViewer");
    await waitFor(() => activeViewType() === "devsnip.csvViewer");
  });

  test("without a file, the Excel command shows the viewer's start page", async () => {
    await vscode.commands.executeCommand("sayaib.hue-console.excelViewer");
    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input instanceof vscode.TabInputWebview && input.viewType.endsWith("devsnip.spreadsheetWelcome");
    });
  });

  test("an edited CSV is dirty, saves through VS Code's file system, undoes, reverts and backs up", async () => {
    fs.writeFileSync(csv.fsPath, "name,age\nAda,36\n");
    const events = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
    const fired: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    events.event(e => fired.push(e));
    const provider = createEditorProvider({} as never, events);
    const doc = (await provider.openCustomDocument(csv, { backupId: undefined, untitledDocumentData: undefined }, new vscode.CancellationTokenSource().token)) as SpreadsheetDocument;
    assert.strictEqual(doc.summary().editable, true);
    doc.loaded.sheet(0);
    doc.push(doc.editor.set(0, [{ r: 1, c: 1, text: "37" }, { r: 2, c: 0, text: "Linus" }])!);
    assert.strictEqual(doc.dirty, true);
    assert.strictEqual(fired.length, 1, "the edit is on VS Code's undo stack");

    const backup = await provider.backupCustomDocument(doc, { destination: vscode.Uri.file(path.join(dir, "backup.bin")) }, new vscode.CancellationTokenSource().token);
    const restored = (await provider.openCustomDocument(csv, { backupId: backup.id, untitledDocumentData: undefined }, new vscode.CancellationTokenSource().token)) as SpreadsheetDocument;
    assert.deepStrictEqual(restored.loaded.sheet(0).rows, [["name", "age"], ["Ada", "37"], ["Linus", ""]], "hot exit restores the unsaved edits");
    assert.strictEqual(restored.dirty, true);
    restored.dispose();

    await provider.saveCustomDocument(doc, new vscode.CancellationTokenSource().token);
    assert.strictEqual(fs.readFileSync(csv.fsPath, "utf8"), "name,age\nAda,37\nLinus,\n");
    assert.strictEqual(doc.dirty, false);

    await fired[0].undo();
    assert.strictEqual(doc.dirty, true, "undoing past the save point is dirty again");
    assert.deepStrictEqual(doc.loaded.sheet(0).rows, [["name", "age"], ["Ada", "36"]]);
    await provider.revertCustomDocument(doc, new vscode.CancellationTokenSource().token);
    assert.deepStrictEqual(doc.loaded.sheet(0).rows, [["name", "age"], ["Ada", "37"], ["Linus", ""]], "revert reloads the saved file");
    assert.strictEqual(doc.dirty, false);
    await backup.delete();
    doc.dispose();
  });

  test("an edited workbook saves as a valid .xlsx the viewer reads back", async () => {
    const events = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
    const provider = createEditorProvider({} as never, events);
    const token = new vscode.CancellationTokenSource().token;
    const doc = (await provider.openCustomDocument(xlsx, { backupId: undefined, untitledDocumentData: undefined }, token)) as SpreadsheetDocument;
    doc.loaded.sheet(0);
    doc.push(doc.editor.set(0, [{ r: 0, c: 0, text: "changed" }, { r: 1, c: 1, text: "42" }])!);
    await provider.saveCustomDocument(doc, token);
    doc.dispose();
    const again = (await provider.openCustomDocument(xlsx, { backupId: undefined, untitledDocumentData: undefined }, token)) as SpreadsheetDocument;
    assert.deepStrictEqual(again.loaded.sheet(0).rows, [["changed"], [null, 42]]);
    again.dispose();
  });

  test("a column added with its name is one undo step, saves through VS Code, and keeps the separator", async () => {
    fs.writeFileSync(csv.fsPath, "name;age\nAda;36\n");
    const events = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
    const fired: vscode.CustomDocumentEditEvent<vscode.CustomDocument>[] = [];
    events.event(e => fired.push(e));
    const provider = createEditorProvider({} as never, events);
    const token = new vscode.CancellationTokenSource().token;
    const doc = (await provider.openCustomDocument(csv, { backupId: undefined, untitledDocumentData: undefined }, token)) as SpreadsheetDocument;
    doc.loaded.sheet(0);
    doc.push(doc.editor.insertColumns(0, 2, 1, ["email"]));
    doc.push(doc.editor.set(0, [{ r: 0, c: 1, text: "years" }])!);
    assert.strictEqual(fired.length, 2, "adding and naming is one step; renaming is another");
    await provider.saveCustomDocument(doc, token);
    assert.strictEqual(fs.readFileSync(csv.fsPath, "utf8"), "name;years;email\nAda;36;\n");
    await fired[1].undo();
    await fired[0].undo();
    await provider.saveCustomDocument(doc, token);
    assert.strictEqual(fs.readFileSync(csv.fsPath, "utf8"), "name;age\nAda;36\n", "undoing both restores the file exactly");
    doc.dispose();

    fs.writeFileSync(xlsx.fsPath, tinyWorkbook());
    const book = (await provider.openCustomDocument(xlsx, { backupId: undefined, untitledDocumentData: undefined }, token)) as SpreadsheetDocument;
    book.loaded.sheet(0);
    book.push(book.editor.insertColumns(0, 1, 1, ["notes"]));
    await provider.saveCustomDocument(book, token);
    book.dispose();
    const again = (await provider.openCustomDocument(xlsx, { backupId: undefined, untitledDocumentData: undefined }, token)) as SpreadsheetDocument;
    assert.deepStrictEqual(again.loaded.sheet(0).rows, [["hello", "notes"]]);
    again.dispose();
  });
});
