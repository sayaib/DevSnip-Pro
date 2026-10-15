import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Insert Debug Log, Remove Debug Logs in This File and Framework Snippets,
 * driven through their commands in a real editor.
 */

const EXTENSION_ID = "sayaib.hue-console";
const command = (id: string) => vscode.commands.executeCommand(`${EXTENSION_ID}.${id}`);

async function openFile(name: string, content: string): Promise<vscode.TextEditor> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-debug-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
}

suite("Debug logs and framework snippets in the editor", function () {
  this.timeout(60000);
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals: Record<string, unknown> = {};
  const stub = (name: string, value: unknown) => { originals[name] ??= window[name]; window[name] = value; };

  suiteSetup(async () => { await vscode.extensions.getExtension(EXTENSION_ID)!.activate(); });
  teardown(async () => {
    for (const [name, value] of Object.entries(originals)) window[name] = value;
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("Insert Debug Log logs the word under the cursor after its statement, per language", async () => {
    const cases: Array<[string, string, number, number, string]> = [
      ["app.ts", "function total(items: number[]) {\n  const sum = items.reduce((a, b) => a + b, 0);\n  return sum;\n}\n", 1, 9, '  console.log("[app.ts:2] sum:", sum);'],
      ["svc.py", "import logging\nlogger = logging.getLogger(__name__)\n\ndef f(user):\n    name = user.name\n    return name\n", 4, 5, '    logger.debug("[svc.py:5] name=%r", name)'],
      ["Orders.cs", "public class Orders\n{\n    public int Count(int[] ids)\n    {\n        var count = ids.Length;\n        return count;\n    }\n}\n", 4, 13, '        System.Console.WriteLine($"[Orders.cs:5] count={count}");']
    ];
    for (const [file, text, line, column, expected] of cases) {
      const editor = await openFile(file, text);
      editor.selection = new vscode.Selection(line, column, line, column);
      await command("insertDebugLog");
      const lines = editor.document.getText().split(/\r?\n/);
      assert.strictEqual(lines[line + 1], expected, `${file}:\n${editor.document.getText()}`);
    }
  });

  test("Remove Debug Logs in This File removes standalone statements after confirming", async () => {
    const editor = await openFile("clean.js", "function f(a) {\n  console.log(a);\n  const b = a + 1; console.log(b);\n  return b;\n}\n");
    stub("showInformationMessage", async (message: string, ...items: unknown[]) => (items.includes("Remove") ? "Remove" : undefined));
    await command("removeDebugLogsInFile");
    // The statement that shares a line with other code is left for review.
    assert.strictEqual(editor.document.getText(), "function f(a) {\n  const b = a + 1; console.log(b);\n  return b;\n}\n");
  });

  test("Framework Snippets inserts the chosen snippet for the file's language", async () => {
    const editor = await openFile("ItemsController.java", "");
    let offered: string[] = [];
    stub("showQuickPick", async (items: Array<{ description?: string }>) => {
      offered = items.map(item => item.description ?? "");
      return items.find(item => item.description === "ds-logger");
    });
    await command("frameworkSnippets");
    assert.ok(offered.includes("ds-rest-controller") && offered.includes("ds-webmvctest"), offered.join(", "));
    assert.strictEqual(editor.document.getText().trim(), "private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ItemsController.class);");
  });

  test("bundled snippets are contributed for each supported language", () => {
    const manifest = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON as { contributes: { snippets: Array<{ language: string; path: string }> } };
    const languages = manifest.contributes.snippets.filter(entry => entry.path.startsWith("./snippets/")).map(entry => entry.language);
    assert.deepStrictEqual([...new Set(languages)].sort(), ["csharp", "dart", "java", "python", "swift", "typescript", "typescriptreact"]);
  });
});
