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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vm = __importStar(require("vm"));
const child_process_1 = require("child_process");
const ts = __importStar(require("typescript"));
const yaml_1 = __importDefault(require("yaml"));
const registry_1 = require("../../toolkits/registry");
const commands_1 = require("../../toolkits/commands");
const types_1 = require("../../toolkits/types");
const runner_1 = require("../../toolkits/runner");
const dev_utils_1 = require("../../toolkits/engines/dev-utils");
const toon_1 = require("../../toolkits/engines/toon");
const analytics_1 = require("../../analytics");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributed = new Set(manifest.contributes.commands.map((c) => c.command));
const store = new Map();
const ctx = {
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: async (k, v) => { store.set(k, v); } },
    network: { isPortFree: async () => true },
    now: () => new Date("2026-09-29T10:00:00Z")
};
function defaults(tool) {
    return Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.id, f.default]));
}
/** Every combination worth running: defaults, each preset, and each option of each select. */
function variants(tool) {
    const base = defaults(tool);
    const out = [{ label: "defaults", values: base, mustSucceed: false }];
    for (const e of tool.examples ?? [])
        out.push({ label: `preset "${e.label}"`, values: { ...base, ...e.values }, mustSucceed: true });
    for (const f of tool.fields)
        if (f.kind === "select")
            for (const o of f.options ?? [])
                out.push({ label: `${f.id}=${o.value}`, values: { ...base, ...(tool.examples?.[0]?.values ?? {}), [f.id]: o.value }, mustSucceed: false });
    return out;
}
async function results() {
    const all = [];
    for (const tool of registry_1.ALL_TOOLS) {
        if (tool.network)
            continue;
        for (const v of variants(tool)) {
            try {
                all.push({ tool, label: v.label, result: await tool.run(v.values, ctx) });
            }
            catch (error) {
                if (error instanceof types_1.ToolInputError && !v.mustSucceed)
                    continue;
                throw new Error(`${tool.id} [${v.label}] failed: ${error instanceof Error ? error.stack : String(error)}`);
            }
        }
    }
    return all;
}
let cached;
const allResults = () => (cached ?? (cached = results()));
function python() {
    for (const candidate of ["python3", "/opt/homebrew/bin/python3", "/usr/bin/python3"]) {
        const r = (0, child_process_1.spawnSync)(candidate, ["--version"], { encoding: "utf8" });
        if (r.status === 0)
            return candidate;
    }
    return undefined;
}
(0, run_unit_tests_1.suite)("toolkit registry", () => {
    (0, run_unit_tests_1.test)("definitions are structurally valid", () => {
        assert.deepStrictEqual((0, registry_1.validateRegistry)(), []);
    });
    (0, run_unit_tests_1.test)("the command table matches the registry", () => {
        const expected = registry_1.ALL_TOOLS.flatMap(t => [
            { command: t.command, tool: t.id, section: t.section, title: t.title },
            ...(t.aliases ?? []).map(a => ({ command: a.command, tool: t.id, section: t.section, title: t.title, values: a.values }))
        ]);
        assert.deepStrictEqual(commands_1.TOOLKIT_COMMANDS, expected, "regenerate src/toolkits/commands.ts from the registry");
    });
    (0, run_unit_tests_1.test)("every toolkit command is contributed in package.json", () => {
        for (const c of commands_1.TOOLKIT_COMMANDS)
            assert.ok(contributed.has(`sayaib.hue-console.${c.command}`), `${c.command} missing from contributes.commands`);
    });
    (0, run_unit_tests_1.test)("replaced tools keep their command ids", () => {
        const ids = new Set(commands_1.TOOLKIT_COMMANDS.map(c => c.command));
        for (const id of ["jsonFormatter", "yamlJsonTool", "colorPalette", "modelComparison", "llmResponseFormatter", "schemaDiff", "hashGenerator", "timestampConverter", "regexBuilder", "tokenCounter", "promptTemplate", "llmApiTester", "gpuVram", "chunkingTester", "contextWindow", "ragEvalScores", "sparkSqlFormatter", "schemaViewer", "jsonlViewer", "base64Encoder", "urlEncoder", "jsonToToon", "observabilityAnalyze", "mlopsGenerator"]) {
            assert.ok(ids.has(id), `${id} no longer opens a tool`);
        }
    });
    (0, run_unit_tests_1.test)("every section has tools and a description, and every tool lives in exactly one section", () => {
        for (const s of registry_1.SECTIONS) {
            assert.ok(s.description.length > 20, s.id);
            assert.ok(s.entries.length > 0, s.id);
        }
        const homes = new Map();
        for (const s of registry_1.SECTIONS)
            for (const e of s.entries)
                homes.set(e.command, [...(homes.get(e.command) ?? []), s.title]);
        for (const [command, sections] of homes)
            assert.strictEqual(sections.length, 1, `${command} is in ${sections.join(" and ")}`);
        for (const t of registry_1.ALL_TOOLS)
            assert.ok(homes.has(t.command), `${t.id} has no home`);
    });
    (0, run_unit_tests_1.test)("sections are ordered with the daily tools first", () => {
        assert.deepStrictEqual(registry_1.SECTIONS.map(s => s.title), ["Backend & API", "Web & Frontend", "Mobile Development", "Code & Productivity", "Text & Formatters", "Encoders & Converters", "Database", "Testing & Debugging", "Git & Version Control", "DevOps & Cloud", "Security & Auth", "AI & ML", "Data & RAG"]);
        assert.strictEqual(registry_1.SECTIONS[0].entries[0].command, "openGUI");
    });
    (0, run_unit_tests_1.test)("analytics files toolkit tools under their section", () => {
        assert.strictEqual((0, analytics_1.featureCategory)("dockerfileHelper"), "devops");
        assert.strictEqual((0, analytics_1.featureCategory)("jwtDecoder"), "security");
        assert.strictEqual((0, analytics_1.featureCategory)("dataConverter"), "convert");
        assert.strictEqual((0, analytics_1.featureCategory)("ragPipeline"), "data");
        assert.strictEqual((0, analytics_1.featureCategory)("llmClientSetup"), "ai");
        // Aliases report under their tool's section.
        assert.strictEqual((0, analytics_1.featureCategory)("modelComparison"), "ai");
        assert.strictEqual((0, analytics_1.featureCategory)("yamlJsonTool"), "text");
    });
});
(0, run_unit_tests_1.suite)("toolkit tools", () => {
    (0, run_unit_tests_1.test)("every tool runs with its defaults, presets and every select option", async () => {
        const all = await allResults();
        assert.ok(all.length > 300, `only ${all.length} runs`);
    });
    (0, run_unit_tests_1.test)("results are well formed", async () => {
        for (const { tool, label, result } of await allResults()) {
            const where = `${tool.id} [${label}]`;
            for (const s of result.stats ?? [])
                assert.ok(typeof s.value === "string" && typeof s.label === "string", `${where}: stat must be strings`);
            for (const m of result.messages ?? [])
                assert.ok(["info", "success", "warning", "error"].includes(m.kind) && m.text.trim(), `${where}: bad message`);
            for (const o of result.outputs ?? []) {
                if (o.kind === "table")
                    for (const row of o.rows)
                        assert.strictEqual(row.length, o.columns.length, `${where}: table "${o.title}" row width`);
                if (o.kind === "files")
                    for (const f of o.files)
                        assert.ok((0, runner_1.safeRelativePath)(f.path), `${where}: unsafe path ${f.path}`);
                if (o.kind === "code" && o.fileName)
                    assert.ok((0, runner_1.safeRelativePath)(o.fileName), `${where}: unsafe file name ${o.fileName}`);
                if (o.kind === "chart")
                    for (const s of o.series)
                        assert.ok(s.points.every(p => p.every(Number.isFinite)), `${where}: chart has non-finite points`);
            }
        }
    });
    (0, run_unit_tests_1.test)("generated JSON, YAML, TypeScript and JavaScript parse", async () => {
        let checked = 0;
        for (const { tool, label, result } of await allResults()) {
            const blocks = (result.outputs ?? []).flatMap(o => o.kind === "code" ? [{ language: o.language, content: o.content, name: o.title }] : o.kind === "files" ? o.files.map(f => ({ language: f.language ?? "", content: f.content, name: f.path })) : []);
            for (const b of blocks) {
                const where = `${tool.id} [${label}] ${b.name}`;
                if (b.language === "json") {
                    assert.doesNotThrow(() => JSON.parse(b.content), where);
                    checked++;
                }
                if (b.language === "yaml" && !/\{\{/.test(b.content)) {
                    for (const doc of yaml_1.default.parseAllDocuments(b.content))
                        assert.deepStrictEqual(doc.errors.map(e => e.message), [], where);
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
    (0, run_unit_tests_1.test)("generated Python compiles", async () => {
        const py = python();
        if (!py) {
            console.log("    (skipped: no python3 on PATH)");
            return;
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-py-"));
        let n = 0;
        try {
            for (const { tool, label, result } of await allResults()) {
                for (const o of result.outputs ?? []) {
                    const blocks = o.kind === "code" && o.language === "python" ? [o.content] : o.kind === "files" ? o.files.filter(f => f.language === "python").map(f => f.content) : [];
                    for (const content of blocks) {
                        const file = path.join(dir, `f${n++}.py`);
                        fs.writeFileSync(file, content);
                        const compiled = (0, child_process_1.spawnSync)(py, ["-m", "py_compile", file], { encoding: "utf8" });
                        assert.strictEqual(compiled.status, 0, `${tool.id} [${label}]: ${compiled.stderr}`);
                    }
                }
            }
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        assert.ok(n > 20, `only ${n} Python blocks`);
    });
    (0, run_unit_tests_1.test)("the prompt builder saves and deletes templates", async () => {
        const tool = registry_1.ALL_TOOLS.find(t => t.id === "ai.prompt-builder");
        await tool.run({ user: "Review {{code}}", system: "", saveName: "Review" }, ctx, "save");
        assert.ok((await tool.dynamicExamples(ctx)).some(e => e.label === "Saved: Review"));
        await tool.run({ saveName: "Review" }, ctx, "delete");
        assert.ok(!(await tool.dynamicExamples(ctx)).some(e => e.label === "Saved: Review"));
    });
});
(0, run_unit_tests_1.suite)("toolkit runner", () => {
    (0, run_unit_tests_1.test)("only plain workspace-relative paths are writable", () => {
        assert.strictEqual((0, runner_1.safeRelativePath)("k8s/app.yaml"), "k8s/app.yaml");
        assert.strictEqual((0, runner_1.safeRelativePath)("./Dockerfile"), "Dockerfile");
        assert.strictEqual((0, runner_1.safeRelativePath)("a\\b.txt"), "a/b.txt");
        for (const bad of ["../x", "/etc/passwd", "C:/x", "a/../../b", "", "a//b"])
            assert.strictEqual((0, runner_1.safeRelativePath)(bad), undefined, bad);
    });
    (0, run_unit_tests_1.test)("input errors and crashes are reported, not thrown", async () => {
        const base = registry_1.ALL_TOOLS[0];
        const input = await (0, runner_1.runTool)({ ...base, run: () => { throw new types_1.ToolInputError("Enter text."); } }, {}, ctx);
        assert.deepStrictEqual([input.outcome, input.error], ["input_error", "Enter text."]);
        const original = console.error;
        console.error = () => undefined;
        try {
            const crash = await (0, runner_1.runTool)({ ...base, run: async () => { throw new TypeError("boom"); } }, {}, ctx);
            assert.strictEqual(crash.outcome, "error");
            assert.ok(crash.error?.includes("boom"));
        }
        finally {
            console.error = original;
        }
    });
    (0, run_unit_tests_1.test)("media/toolkit.js parses and acquires the VS Code API once", () => {
        const source = fs.readFileSync(path.join(ROOT, "media", "toolkit.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: "toolkit.js" }));
        assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
    });
});
(0, run_unit_tests_1.suite)("developer tool engines", () => {
    (0, run_unit_tests_1.test)("every codec round-trips Unicode text", () => {
        const text = "Héllo <b>&\"wörld\" ✓ 😀 a+b=c?/%";
        for (const codec of ["base64", "base64url", "url-component", "url", "html", "hex", "unicode", "json-string"]) {
            assert.strictEqual((0, dev_utils_1.decode)((0, dev_utils_1.encode)(text, codec), codec), text, codec);
        }
        assert.throws(() => (0, dev_utils_1.decode)("%E0%A4%A", "url-component"), types_1.ToolInputError);
        assert.throws(() => (0, dev_utils_1.decode)("/////w==", "base64"), /binary/);
    });
    (0, run_unit_tests_1.test)("IDs have the right shape and UUID v7 sorts by time", () => {
        const [v4] = (0, dev_utils_1.generateIds)("uuid4", 1, { length: 0, uppercase: false, symbols: false });
        assert.match(v4, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        const v7 = (0, dev_utils_1.generateIds)("uuid7", 2, { length: 0, uppercase: false, symbols: false });
        assert.match(v7[0], /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/);
        assert.match((0, dev_utils_1.generateIds)("ulid", 1, { length: 0, uppercase: false, symbols: false })[0], /^[0-9A-HJKMNP-TV-Z]{26}$/);
        const pw = (0, dev_utils_1.generateIds)("password", 50, { length: 16, uppercase: false, symbols: true });
        assert.ok(pw.every(p => p.length === 16 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)));
        assert.strictEqual(new Set(pw).size, 50);
    });
    (0, run_unit_tests_1.test)("case conversion splits acronyms and separators", () => {
        const w = (0, dev_utils_1.words)("getHTTPResponse_v2 userID");
        assert.deepStrictEqual(w, ["get", "HTTP", "Response", "v2", "user", "ID"]);
        assert.strictEqual(dev_utils_1.CASES.find(c => c.id === "snake").convert(w), "get_http_response_v2_user_id");
    });
    (0, run_unit_tests_1.test)("cron: descriptions and next runs", () => {
        const from = new Date("2026-09-29T10:07:00Z");
        const weekdays = (0, dev_utils_1.parseCron)("0 9 * * 1-5");
        assert.strictEqual((0, dev_utils_1.describeCron)(weekdays), "At 09:00, on Monday through Friday.");
        assert.deepStrictEqual((0, dev_utils_1.nextRuns)(weekdays, from, 3, true).map(d => d.toISOString()), ["2026-09-30T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "2026-10-02T09:00:00.000Z"]);
        // Both day fields set: either may match (Vixie cron semantics).
        assert.deepStrictEqual((0, dev_utils_1.nextRuns)((0, dev_utils_1.parseCron)("0 0 1 * 5"), from, 2, true).map(d => d.toISOString().slice(0, 10)), ["2026-10-01", "2026-10-02"]);
        assert.deepStrictEqual((0, dev_utils_1.nextRuns)((0, dev_utils_1.parseCron)("0 0 29 2 *"), from, 2, true).map(d => d.toISOString().slice(0, 10)), ["2028-02-29", "2032-02-29"]);
        assert.strictEqual((0, dev_utils_1.describeCron)((0, dev_utils_1.parseCron)("*/15 * * * *")), "Every 15 minutes.");
        for (const bad of ["* * * *", "61 * * * *", "0 0 * * * *", "5-1 * * * *"])
            assert.throws(() => (0, dev_utils_1.parseCron)(bad), types_1.ToolInputError, bad);
    });
    (0, run_unit_tests_1.test)("TOON: tables for uniform records, quoting only when needed", () => {
        const out = (0, toon_1.encodeToon)({ users: [{ id: 1, name: "Ada" }, { id: 2, name: "Bob, Jr." }], tags: ["a", "true", ""], n: null }, { delimiter: ",", indent: 2 });
        assert.strictEqual(out, 'users[2]{id,name}:\n  1,Ada\n  2,"Bob, Jr."\ntags[3]: a,"true",""\nn: null');
    });
    (0, run_unit_tests_1.test)("JWT decoder verifies HMAC signatures", async () => {
        const tool = registry_1.ALL_TOOLS.find(t => t.id === "dev.jwt");
        const token = tool.examples[0].values.token;
        const good = await tool.run({ token, secret: "your-256-bit-secret" }, ctx);
        assert.strictEqual(good.stats.find(s => s.label === "Signature").value, "valid");
        const bad = await tool.run({ token, secret: "wrong" }, ctx);
        assert.strictEqual(bad.stats.find(s => s.label === "Signature").value, "INVALID");
    });
});
(0, run_unit_tests_1.suite)("generated YAML", () => {
    (0, run_unit_tests_1.test)("never uses anchors or aliases", async () => {
        for (const { tool, label, result } of await allResults()) {
            for (const o of result.outputs ?? []) {
                const blocks = o.kind === "code" && o.language === "yaml" ? [o.content] : o.kind === "files" ? o.files.filter(f => f.language === "yaml").map(f => f.content) : [];
                for (const content of blocks)
                    assert.ok(!/(^|\s)[&*]a\d+\b/m.test(content), `${tool.id} [${label}] emits YAML anchors`);
            }
        }
    });
});
//# sourceMappingURL=toolkit.unit.js.map