import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { saveSnippets, setSnippetBackupFolder, syncSnippetBackups } from "../../utils/snippet-utils";
import { suite, test } from "./run-unit-tests";

const SNIPPET = { log: { prefix: "log", body: ["console.log($1);"], description: "Log" } };

function sandbox(): { root: string; extension: string; live: string; backup: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-snippets-"));
  const extension = path.join(root, "extensions", "sayaib.hue-console-11.75.1");
  const live = path.join(extension, "custom");
  fs.mkdirSync(live, { recursive: true });
  for (const language of ["javascript", "python"]) fs.writeFileSync(path.join(live, `custom_${language}.json`), "{}");
  return { root, extension, live, backup: path.join(root, "globalStorage", "snippets") };
}

const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

suite("snippets survive updates", () => {
  test("every save is mirrored to the backup folder", async () => {
    const box = sandbox();
    setSnippetBackupFolder(box.backup);
    try {
      await saveSnippets(path.join(box.live, "custom_javascript.json"), SNIPPET);
      assert.deepStrictEqual(read(path.join(box.backup, "custom_javascript.json")), SNIPPET);
    } finally {
      setSnippetBackupFolder(undefined);
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test("an update's empty snippet file is restored from the backup", async () => {
    const box = sandbox();
    try {
      fs.mkdirSync(box.backup, { recursive: true });
      fs.writeFileSync(path.join(box.backup, "custom_javascript.json"), JSON.stringify(SNIPPET));
      assert.strictEqual(await syncSnippetBackups(box.live, box.backup, box.extension), 1);
      assert.deepStrictEqual(read(path.join(box.live, "custom_javascript.json")), SNIPPET);
      assert.deepStrictEqual(read(path.join(box.live, "custom_python.json")), {}, "other languages are untouched");
      assert.strictEqual(await syncSnippetBackups(box.live, box.backup, box.extension), 0, "nothing to restore the second time");
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test("the extension's own file wins, so edits and deletions are kept", async () => {
    const box = sandbox();
    try {
      fs.mkdirSync(box.backup, { recursive: true });
      fs.writeFileSync(path.join(box.backup, "custom_javascript.json"), JSON.stringify({ ...SNIPPET, old: { prefix: "old", body: ["x"], description: "" } }));
      fs.writeFileSync(path.join(box.live, "custom_javascript.json"), JSON.stringify(SNIPPET));
      assert.strictEqual(await syncSnippetBackups(box.live, box.backup, box.extension), 0);
      assert.deepStrictEqual(read(path.join(box.backup, "custom_javascript.json")), SNIPPET, "the backup follows the live file");
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test("the first run recovers snippets from the previous installed version", async () => {
    const box = sandbox();
    try {
      const old = path.join(box.root, "extensions", "sayaib.hue-console-11.74.3", "custom");
      const older = path.join(box.root, "extensions", "sayaib.hue-console-11.9.1", "custom");
      fs.mkdirSync(old, { recursive: true });
      fs.mkdirSync(older, { recursive: true });
      fs.writeFileSync(path.join(old, "custom_python.json"), JSON.stringify(SNIPPET));
      fs.writeFileSync(path.join(older, "custom_python.json"), JSON.stringify({ stale: { prefix: "s", body: ["s"], description: "" } }));
      fs.mkdirSync(path.join(box.root, "extensions", "someone.else-99.0.0", "custom"), { recursive: true });
      assert.strictEqual(await syncSnippetBackups(box.live, box.backup, box.extension), 1);
      assert.deepStrictEqual(read(path.join(box.live, "custom_python.json")), SNIPPET, "the newest older version is used");
      assert.deepStrictEqual(read(path.join(box.backup, "custom_python.json")), SNIPPET);
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });

  test("a broken snippet file is left alone", async () => {
    const box = sandbox();
    try {
      fs.writeFileSync(path.join(box.live, "custom_javascript.json"), "{ not json");
      fs.mkdirSync(box.backup, { recursive: true });
      fs.writeFileSync(path.join(box.backup, "custom_javascript.json"), JSON.stringify(SNIPPET));
      assert.strictEqual(await syncSnippetBackups(box.live, box.backup, box.extension), 0);
      assert.strictEqual(fs.readFileSync(path.join(box.live, "custom_javascript.json"), "utf8"), "{ not json");
    } finally {
      fs.rmSync(box.root, { recursive: true, force: true });
    }
  });
});

suite("bundled framework snippets", () => {
  const root = path.resolve(__dirname, "../../..");
  const manifest = read(path.join(root, "package.json")) as { contributes: { snippets: Array<{ language: string; path: string }> } };
  const bundled = manifest.contributes.snippets.filter(entry => entry.path.startsWith("./snippets/"));

  test("every bundled file is contributed, parses and uses the ds- prefix", () => {
    const files = fs.readdirSync(path.join(root, "snippets")).filter(file => file.endsWith(".json"));
    assert.deepStrictEqual([...new Set(bundled.map(entry => path.basename(entry.path)))].sort(), files.sort());
    for (const entry of bundled) {
      const snippets = Object.values(read(path.join(root, entry.path))) as Array<{ prefix: string; body: string[]; description: string }>;
      assert.ok(snippets.length > 0, entry.path);
      for (const snippet of snippets) {
        assert.match(snippet.prefix, /^ds-[a-z0-9-]+$/, `${entry.path}: ${snippet.prefix}`);
        assert.ok(Array.isArray(snippet.body) && snippet.body.length && snippet.description, `${entry.path}: ${snippet.prefix}`);
      }
    }
  });

  test("a prefix means one snippet per language", () => {
    const byLanguage = new Map<string, string[]>();
    for (const entry of bundled) {
      const prefixes = (Object.values(read(path.join(root, entry.path))) as Array<{ prefix: string }>).map(snippet => snippet.prefix);
      byLanguage.set(entry.language, [...(byLanguage.get(entry.language) ?? []), ...prefixes]);
    }
    for (const [language, prefixes] of byLanguage) assert.strictEqual(new Set(prefixes).size, prefixes.length, language);
  });

  test("bodies expand correctly when the defaults are accepted", () => {
    for (const file of new Set(bundled.map(entry => entry.path))) {
      for (const snippet of Object.values(read(path.join(root, file))) as Array<{ prefix: string; body: string[] }>) {
        const body = snippet.body.join("\n");
        // Placeholder transforms only run after tabbing through, so accepting defaults would leave e.g. "getname".
        assert.doesNotMatch(body, /\$\{\d+\/[^}]*\//, `${file}: ${snippet.prefix} uses a transform`);
        // A literal ${…} (JS template, Dart or Kotlin interpolation) must be escaped or VS Code reads it as a variable.
        for (const match of body.matchAll(/(\\)?\$\{([^0-9}][^}:]*)/g)) {
          if (!match[1]) assert.match(match[2], /^TM_/, `${file}: ${snippet.prefix} has an unescaped \${${match[2]}`);
        }
      }
    }
  });
});
