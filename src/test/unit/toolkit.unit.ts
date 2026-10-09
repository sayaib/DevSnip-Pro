import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vm from "vm";
import { SpawnSyncReturns, spawnSync } from "child_process";
import * as ts from "typescript";
import YAML from "yaml";
import { ALL_TOOLS, SECTIONS, validateRegistry } from "../../toolkits/registry";
import { TOOLKIT_COMMANDS } from "../../toolkits/commands";
import { ToolContext, ToolDefinition, ToolInputError, ToolResult, Values } from "../../toolkits/types";
import { runTool, safeRelativePath } from "../../toolkits/runner";
import { decode, describeCron, encode, generateIds, nextRuns, parseCron, words, CASES } from "../../toolkits/engines/dev-utils";
import { encodeToon } from "../../toolkits/engines/toon";
import { toolSection } from "../../analytics";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributed = new Set<string>(manifest.contributes.commands.map((c: { command: string }) => c.command));

const store = new Map<string, unknown>();
const ctx: ToolContext = {
  storage: { get: <T>(k: string, d: T) => (store.has(k) ? store.get(k) as T : d), set: async (k, v) => { store.set(k, v); } },
  network: { isPortFree: async () => true },
  now: () => new Date("2026-09-29T10:00:00Z")
};

function defaults(tool: ToolDefinition): Values {
  return Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.id, f.default!]));
}

/** Every combination worth running: defaults, each preset, and each option of each select. */
function variants(tool: ToolDefinition): Array<{ label: string; values: Values; mustSucceed: boolean }> {
  const base = defaults(tool);
  const out = [{ label: "defaults", values: base, mustSucceed: false }];
  for (const e of tool.examples ?? []) out.push({ label: `preset "${e.label}"`, values: { ...base, ...e.values }, mustSucceed: true });
  for (const f of tool.fields) if (f.kind === "select") for (const o of f.options ?? []) out.push({ label: `${f.id}=${o.value}`, values: { ...base, ...(tool.examples?.[0]?.values ?? {}), [f.id]: o.value }, mustSucceed: false });
  return out;
}

async function results(): Promise<Array<{ tool: ToolDefinition; label: string; result: ToolResult }>> {
  const all: Array<{ tool: ToolDefinition; label: string; result: ToolResult }> = [];
  for (const tool of ALL_TOOLS) {
    if (tool.network) continue;
    for (const v of variants(tool)) {
      try {
        all.push({ tool, label: v.label, result: await tool.run(v.values, ctx) });
      } catch (error) {
        if (error instanceof ToolInputError && !v.mustSucceed) continue;
        throw new Error(`${tool.id} [${v.label}] failed: ${error instanceof Error ? error.stack : String(error)}`);
      }
    }
  }
  return all;
}

let cached: Promise<Array<{ tool: ToolDefinition; label: string; result: ToolResult }>> | undefined;
const allResults = () => (cached ??= results());

function python(): string | undefined {
  for (const candidate of ["python3", "/opt/homebrew/bin/python3", "/usr/bin/python3"]) {
    const r = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return candidate;
  }
  return undefined;
}

suite("toolkit registry", () => {
  test("definitions are structurally valid", () => {
    assert.deepStrictEqual(validateRegistry(), []);
  });

  test("the command table matches the registry", () => {
    const expected = ALL_TOOLS.flatMap(t => [
      { command: t.command, tool: t.id, section: t.section, title: t.title },
      ...(t.aliases ?? []).map(a => ({ command: a.command, tool: t.id, section: t.section, title: t.title, values: a.values }))
    ]);
    assert.deepStrictEqual(TOOLKIT_COMMANDS, expected, "regenerate src/toolkits/commands.ts from the registry");
  });

  test("every toolkit command is contributed in package.json", () => {
    for (const c of TOOLKIT_COMMANDS) assert.ok(contributed.has(`sayaib.hue-console.${c.command}`), `${c.command} missing from contributes.commands`);
  });

  test("replaced tools keep their command ids", () => {
    const ids = new Set(TOOLKIT_COMMANDS.map(c => c.command));
    for (const id of ["jsonFormatter", "yamlJsonTool", "colorPalette", "modelComparison", "llmResponseFormatter", "schemaDiff", "hashGenerator", "timestampConverter", "regexBuilder", "tokenCounter", "promptTemplate", "llmApiTester", "gpuVram", "chunkingTester", "contextWindow", "ragEvalScores", "sparkSqlFormatter", "schemaViewer", "jsonlViewer", "base64Encoder", "urlEncoder", "jsonToToon", "observabilityAnalyze", "mlopsGenerator"]) {
      assert.ok(ids.has(id), `${id} no longer opens a tool`);
    }
  });

  test("every section has tools and a description, and every tool lives in exactly one section", () => {
    for (const s of SECTIONS) {
      assert.ok(s.description.length > 20, s.id);
      assert.ok(s.entries.length > 0, s.id);
    }
    const homes = new Map<string, string[]>();
    for (const s of SECTIONS) for (const e of s.entries) homes.set(e.command, [...(homes.get(e.command) ?? []), s.title]);
    for (const [command, sections] of homes) assert.strictEqual(sections.length, 1, `${command} is in ${sections.join(" and ")}`);
    for (const t of ALL_TOOLS) assert.ok(homes.has(t.command), `${t.id} has no home`);
  });

  test("sections are ordered with the daily tools first", () => {
    assert.deepStrictEqual(SECTIONS.map(s => s.title), ["Backend & API", "Web & Frontend", "Mobile Development", "Code & Productivity", "Text & Formatters", "Encoders & Converters", "Database", "Testing & Debugging", "Git & Version Control", "DevOps & Cloud", "Security & Auth", "AI & ML", "Data & RAG"]);
    assert.strictEqual(SECTIONS[0].entries[0].command, "openGUI");
  });

  test("analytics files toolkit tools under their section", () => {
    assert.strictEqual(toolSection("dockerfileHelper"), "devops");
    assert.strictEqual(toolSection("jwtDecoder"), "security");
    assert.strictEqual(toolSection("dataConverter"), "convert");
    assert.strictEqual(toolSection("ragPipeline"), "data");
    assert.strictEqual(toolSection("llmClientSetup"), "ai");
    // Aliases report under their tool's section.
    assert.strictEqual(toolSection("modelComparison"), "ai");
    assert.strictEqual(toolSection("yamlJsonTool"), "text");
  });
});

suite("toolkit tools", () => {
  test("every tool runs with its defaults, presets and every select option", async () => {
    const all = await allResults();
    assert.ok(all.length > 300, `only ${all.length} runs`);
  });

  test("results are well formed", async () => {
    for (const { tool, label, result } of await allResults()) {
      const where = `${tool.id} [${label}]`;
      for (const s of result.stats ?? []) assert.ok(typeof s.value === "string" && typeof s.label === "string", `${where}: stat must be strings`);
      for (const m of result.messages ?? []) assert.ok(["info", "success", "warning", "error"].includes(m.kind) && m.text.trim(), `${where}: bad message`);
      for (const o of result.outputs ?? []) {
        if (o.kind === "table") for (const row of o.rows) assert.strictEqual(row.length, o.columns.length, `${where}: table "${o.title}" row width`);
        if (o.kind === "files") for (const f of o.files) assert.ok(safeRelativePath(f.path), `${where}: unsafe path ${f.path}`);
        if (o.kind === "code" && o.fileName) assert.ok(safeRelativePath(o.fileName), `${where}: unsafe file name ${o.fileName}`);
        if (o.kind === "chart") for (const s of o.series) assert.ok(s.points.every(p => p.every(Number.isFinite)), `${where}: chart has non-finite points`);
      }
    }
  });

  test("generated JSON, YAML, TypeScript and JavaScript parse", async () => {
    let checked = 0;
    for (const { tool, label, result } of await allResults()) {
      const blocks = (result.outputs ?? []).flatMap(o => o.kind === "code" ? [{ language: o.language, content: o.content, name: o.title }] : o.kind === "files" ? o.files.map(f => ({ language: f.language ?? "", content: f.content, name: f.path })) : []);
      for (const b of blocks) {
        const where = `${tool.id} [${label}] ${b.name}`;
        if (b.language === "json") { assert.doesNotThrow(() => JSON.parse(b.content), where); checked++; }
        if (b.language === "yaml" && !/\{\{/.test(b.content)) {
          for (const doc of YAML.parseAllDocuments(b.content)) assert.deepStrictEqual(doc.errors.map(e => e.message), [], where);
          checked++;
        }
        if (b.language === "typescript" || b.language === "javascript" || b.language === "tsx" || b.language === "jsx") {
          const jsx = b.language === "tsx" || b.language === "jsx";
          // Bare JSX fragments (HTML → JSX without a component) are expressions, so wrap them to parse.
          const source = jsx && /^\s*</.test(b.content) ? `const view = (\n${b.content}\n);\nexport default view;\n` : b.content;
          const out = ts.transpileModule(source, { fileName: jsx ? "file.tsx" : "file.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, ...(jsx ? { jsx: ts.JsxEmit.Preserve } : {}), experimentalDecorators: true } });
          assert.deepStrictEqual((out.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], `${where}\n${source.slice(0, 400)}`);
          checked++;
        }
      }
    }
    assert.ok(checked > 100, `only ${checked} blocks checked`);
  });

  test("generated Python compiles", async () => {
    const py = python();
    if (!py) { console.log("    (skipped: no python3 on PATH)"); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-py-"));
    let n = 0;
    try {
      for (const { tool, label, result } of await allResults()) {
        for (const o of result.outputs ?? []) {
          const blocks = o.kind === "code" && o.language === "python" ? [o.content] : o.kind === "files" ? o.files.filter(f => f.language === "python").map(f => f.content) : [];
          for (const content of blocks) {
            const file = path.join(dir, `f${n++}.py`);
            fs.writeFileSync(file, content);
            const compiled: SpawnSyncReturns<string> = spawnSync(py, ["-m", "py_compile", file], { encoding: "utf8" });
            assert.strictEqual(compiled.status, 0, `${tool.id} [${label}]: ${compiled.stderr}`);
          }
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.ok(n > 20, `only ${n} Python blocks`);
  });

  test("the prompt builder saves and deletes templates", async () => {
    const tool = ALL_TOOLS.find(t => t.id === "ai.prompt-builder")!;
    await tool.run({ user: "Review {{code}}", system: "", saveName: "Review" }, ctx, "save");
    assert.ok((await tool.dynamicExamples!(ctx)).some(e => e.label === "Saved: Review"));
    await tool.run({ saveName: "Review" }, ctx, "delete");
    assert.ok(!(await tool.dynamicExamples!(ctx)).some(e => e.label === "Saved: Review"));
  });
});

suite("toolkit runner", () => {
  test("only plain workspace-relative paths are writable", () => {
    assert.strictEqual(safeRelativePath("k8s/app.yaml"), "k8s/app.yaml");
    assert.strictEqual(safeRelativePath("./Dockerfile"), "Dockerfile");
    assert.strictEqual(safeRelativePath("a\\b.txt"), "a/b.txt");
    for (const bad of ["../x", "/etc/passwd", "C:/x", "a/../../b", "", "a//b"]) assert.strictEqual(safeRelativePath(bad), undefined, bad);
  });

  test("input errors and crashes are reported, not thrown", async () => {
    const base = ALL_TOOLS[0];
    const input = await runTool({ ...base, run: () => { throw new ToolInputError("Enter text."); } }, {}, ctx);
    assert.deepStrictEqual([input.outcome, input.error], ["input_error", "Enter text."]);
    const original = console.error;
    console.error = () => undefined;
    try {
      const crash = await runTool({ ...base, run: async () => { throw new TypeError("boom"); } }, {}, ctx);
      assert.strictEqual(crash.outcome, "error");
      assert.ok(crash.error?.includes("boom"));
    } finally {
      console.error = original;
    }
  });

  test("media/toolkit.js parses and acquires the VS Code API once", () => {
    const source = fs.readFileSync(path.join(ROOT, "media", "toolkit.js"), "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: "toolkit.js" }));
    assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
  });
});

suite("developer tool engines", () => {
  test("every codec round-trips Unicode text", () => {
    const text = "Héllo <b>&\"wörld\" ✓ 😀 a+b=c?/%";
    for (const codec of ["base64", "base64url", "url-component", "url", "html", "hex", "unicode", "json-string"] as const) {
      assert.strictEqual(decode(encode(text, codec), codec), text, codec);
    }
    assert.throws(() => decode("%E0%A4%A", "url-component"), ToolInputError);
    assert.throws(() => decode("/////w==", "base64"), /binary/);
  });

  test("IDs have the right shape and UUID v7 sorts by time", () => {
    const [v4] = generateIds("uuid4", 1, { length: 0, uppercase: false, symbols: false });
    assert.match(v4, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const v7 = generateIds("uuid7", 2, { length: 0, uppercase: false, symbols: false });
    assert.match(v7[0], /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/);
    assert.match(generateIds("ulid", 1, { length: 0, uppercase: false, symbols: false })[0], /^[0-9A-HJKMNP-TV-Z]{26}$/);
    const pw = generateIds("password", 50, { length: 16, uppercase: false, symbols: true });
    assert.ok(pw.every(p => p.length === 16 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)));
    assert.strictEqual(new Set(pw).size, 50);
  });

  test("case conversion splits acronyms and separators", () => {
    const w = words("getHTTPResponse_v2 userID");
    assert.deepStrictEqual(w, ["get", "HTTP", "Response", "v2", "user", "ID"]);
    assert.strictEqual(CASES.find(c => c.id === "snake")!.convert(w), "get_http_response_v2_user_id");
  });

  test("cron: descriptions and next runs", () => {
    const from = new Date("2026-09-29T10:07:00Z");
    const weekdays = parseCron("0 9 * * 1-5");
    assert.strictEqual(describeCron(weekdays), "At 09:00, on Monday through Friday.");
    assert.deepStrictEqual(nextRuns(weekdays, from, 3, true).map(d => d.toISOString()), ["2026-09-30T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "2026-10-02T09:00:00.000Z"]);
    // Both day fields set: either may match (Vixie cron semantics).
    assert.deepStrictEqual(nextRuns(parseCron("0 0 1 * 5"), from, 2, true).map(d => d.toISOString().slice(0, 10)), ["2026-10-01", "2026-10-02"]);
    assert.deepStrictEqual(nextRuns(parseCron("0 0 29 2 *"), from, 2, true).map(d => d.toISOString().slice(0, 10)), ["2028-02-29", "2032-02-29"]);
    assert.strictEqual(describeCron(parseCron("*/15 * * * *")), "Every 15 minutes.");
    for (const bad of ["* * * *", "61 * * * *", "0 0 * * * *", "5-1 * * * *"]) assert.throws(() => parseCron(bad), ToolInputError, bad);
  });

  test("TOON: tables for uniform records, quoting only when needed", () => {
    const out = encodeToon({ users: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob, Jr." }], tags: ["a", "true", ""], n: null }, { delimiter: ",", indent: 2 });
    assert.strictEqual(out, 'users[2]{id,name}:\n  1,Ada\n  2,"Bob, Jr."\ntags[3]: a,"true",""\nn: null');
  });

  test("JWT decoder verifies HMAC signatures", async () => {
    const tool = ALL_TOOLS.find(t => t.id === "dev.jwt")!;
    const token = tool.examples![0].values.token;
    const good = await tool.run({ token, secret: "your-256-bit-secret" }, ctx);
    assert.strictEqual(good.stats!.find(s => s.label === "Signature")!.value, "valid");
    const bad = await tool.run({ token, secret: "wrong" }, ctx);
    assert.strictEqual(bad.stats!.find(s => s.label === "Signature")!.value, "INVALID");
  });
});

suite("generated YAML", () => {
  test("never uses anchors or aliases", async () => {
    for (const { tool, label, result } of await allResults()) {
      for (const o of result.outputs ?? []) {
        const blocks = o.kind === "code" && o.language === "yaml" ? [o.content] : o.kind === "files" ? o.files.filter(f => f.language === "yaml").map(f => f.content) : [];
        for (const content of blocks) assert.ok(!/(^|\s)[&*]a\d+\b/m.test(content), `${tool.id} [${label}] emits YAML anchors`);
      }
    }
  });
});
