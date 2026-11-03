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
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const react_generator_1 = require("../../toolkits/engines/react-generator");
const web_scaffold_1 = require("../../toolkits/engines/web-scaffold");
const react_1 = require("../../toolkits/sections/react");
const types_1 = require("../../toolkits/types");
const run_unit_tests_1 = require("./run-unit-tests");
const base = { kind: "component", name: "UserCard", typescript: true, styling: "css-module", tests: true, story: false, route: "users/[id]" };
function verify(options) {
    const r = (0, react_generator_1.generateReact)(options);
    const paths = new Set(r.files.map(f => f.path));
    assert.strictEqual(paths.size, r.files.length);
    for (const f of r.files) {
        assert.ok(!f.path.split("/").includes(".."), f.path);
        if (/\.(tsx?|jsx?|mjs|cjs)$/.test(f.path) && !f.path.endsWith(".d.ts")) {
            const result = ts.transpileModule(f.content, { fileName: f.path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } });
            assert.deepStrictEqual((result.diagnostics || []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], f.path);
            const imports = [...f.content.matchAll(/(?:from\s+|import\s*\(?)["'](\.[^"']+)["']/g)];
            for (const m of imports) {
                if (/\.css$/.test(m[1]))
                    continue;
                const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), m[1]));
                assert.ok(paths.has(resolved) || [".ts", ".tsx", ".js", ".jsx"].some(ext => paths.has(resolved + ext)), `${f.path}: missing ${m[1]}`);
            }
        }
        if (f.path.endsWith(".json"))
            JSON.parse(f.content);
    }
}
(0, run_unit_tests_1.suite)("React generator", () => {
    (0, run_unit_tests_1.test)("preserves the files-only public API and original templates", () => {
        for (const kind of ["component", "next-page", "next-route", "server-action", "hook", "context", "store", "rn-screen"]) {
            assert.ok((0, web_scaffold_1.reactScaffold)({ ...base, kind }).length, kind);
        }
    });
    (0, run_unit_tests_1.test)("validates route syntax, traversal, injection and catch-all placement", () => {
        for (const route of ["../secrets", "x//y", "x/`bad`", "x/${bad}", "x/\\y", "x/%2e%2e", "x/[id]/[id]", "x/[...slug]/edit", "[__proto__]", "[bad-name]", "x/[[slug]]"])
            assert.throws(() => (0, react_generator_1.validateReactRoute)(route), types_1.ToolInputError, route);
        for (const route of ["/", "users/[id]", "(admin)/users/[id]", "docs/[...slug]", "docs/[[...slug]]"])
            assert.strictEqual((0, react_generator_1.validateReactRoute)(route), route.replace(/^\/+|\/+$/g, ""));
    });
    (0, run_unit_tests_1.test)("rejects incompatible configurations and untrusted enum values", () => {
        for (const extra of [{ kind: "unknown" }, { framework: "react", kind: "next-page" }, { framework: "next-pages", kind: "server-action" }, { ui: "shadcn" }, { rendering: "server" }, { name: "123card" }, { name: "X".repeat(81) }, { framework: "next-pages", route: "(group)/users" }, { nextVersion: "12" }])
            assert.throws(() => (0, react_generator_1.generateReact)({ ...base, ...extra }), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("all templates produce syntactically valid TS and JS with resolved local imports", () => {
        for (const [kind] of react_generator_1.REACT_TEMPLATES)
            for (const typescript of [true, false]) {
                verify({ ...base, kind, typescript });
            }
    });
    (0, run_unit_tests_1.test)("project matrix covers routers, languages, state managers, source layouts and test runners", () => {
        for (const framework of ["react", "next-app", "next-pages"])
            for (const typescript of [true, false])
                for (const state of ["none", "context", "zustand", "redux", "query"])
                    for (const sourceDirectory of [true, false])
                        for (const testRunner of ["jest", "vitest"])
                            verify({ ...base, kind: "project", framework, typescript, state, sourceDirectory, testRunner });
    });
    (0, run_unit_tests_1.test)("UI providers, dependencies and component imports are generated together", () => {
        for (const ui of ["mui", "chakra", "shadcn"])
            for (const framework of ["react", "next-app", "next-pages"]) {
                verify({ ...base, ui, framework, styling: "tailwind", story: true, naming: "kebab", lazy: true, memo: true });
                const r = (0, react_generator_1.generateReact)({ ...base, ui, framework, styling: "tailwind" });
                assert.ok(r.files.some(f => f.path === "src/providers.tsx"));
                assert.ok(r.files[0].content.includes("<Button"));
                assert.ok(r.steps.some(s => s.includes("Providers")));
            }
    });
    (0, run_unit_tests_1.test)("dynamic pages await all params and type catch-all and optional segments", () => {
        const r = (0, react_generator_1.generateReact)({ ...base, kind: "next-page", route: "teams/[team]/docs/[[...slug]]" });
        const page = r.files[0].content;
        assert.ok(page.includes("team: string; slug?: string[]"));
        assert.ok(page.includes("await params"));
        assert.ok(!page.includes("API_URL"));
        assert.ok(!r.files[2].content.includes("error.message"));
    });
    (0, run_unit_tests_1.test)("root API paths and actions do not silently fall back to the component name", () => {
        const api = (0, react_generator_1.generateReact)({ ...base, kind: "next-route", route: "/" });
        assert.strictEqual(api.files[0].path, "app/api/route.ts");
        const action = (0, react_generator_1.generateReact)({ ...base, kind: "server-action", route: "/" });
        assert.strictEqual(action.files[0].path, "app/actions.ts");
        assert.ok(!action.files[0].content.includes('message: "Saved."'));
        assert.ok(action.files[0].content.includes("Connect an authorized persistence service"));
    });
    (0, run_unit_tests_1.test)("Pages Router Material UI projects include SSR cache and document wiring", () => {
        const r = (0, react_generator_1.generateReact)({ ...base, kind: "project", framework: "next-pages", ui: "mui" });
        assert.ok(r.files.find(f => f.path === "pages/_document.tsx").content.includes("documentGetInitialProps"));
        assert.ok(r.files.find(f => f.path === "pages/_app.tsx").content.includes("AppCacheProvider"));
        assert.ok(r.dependencies["@emotion/server"]);
        verify({ ...base, kind: "project", framework: "next-pages", ui: "mui", sourceDirectory: false });
    });
    (0, run_unit_tests_1.test)("selects version-appropriate middleware convention", () => {
        for (const nextVersion of ["15", "16"]) {
            const f = (0, react_generator_1.generateReact)({ ...base, kind: "middleware", nextVersion }).files[0];
            assert.strictEqual(f.path, nextVersion === "15" ? "middleware.ts" : "proxy.ts");
        }
    });
    (0, run_unit_tests_1.test)("fetch hook suppresses stale completion and clears state for null URLs", () => {
        const hook = (0, react_generator_1.generateReact)({ ...base, kind: "hook" }).files[0].content;
        assert.ok(hook.includes("if (!url) { setData(undefined); setError(undefined); setLoading(false); return; }"));
        assert.ok(hook.includes("if (!controller.signal.aborted) setData(value)"));
        assert.ok(hook.includes("return () => controller.abort()"));
    });
    (0, run_unit_tests_1.test)("Jest output uses Jest mocks and configured transforms", () => {
        const r = (0, react_generator_1.generateReact)({ ...base, testRunner: "jest" });
        const testFile = r.files.find(f => f.path.includes(".test."));
        assert.ok(testFile.content.includes("jest.fn()"));
        assert.ok(!testFile.content.includes("vitest"));
        assert.ok(r.files.find(f => f.path === "jest.config.cjs").content.includes("next/jest"));
    });
    (0, run_unit_tests_1.test)("saved presets are bounded, replace matching names and round-trip", async () => {
        let saved = [];
        const context = { storage: { get: (_key, fallback) => saved ?? fallback, set: async (_key, value) => { saved = value; } } };
        for (let i = 0; i < 22; i++)
            await react_1.reactTool.run({ name: `Card${i}` }, context, "save-preset");
        const presets = await react_1.reactTool.dynamicExamples(context);
        assert.strictEqual(presets.length, 20);
        await react_1.reactTool.run({ name: "Card21", typescript: false }, context, "save-preset");
        assert.strictEqual((await react_1.reactTool.dynamicExamples(context)).length, 20);
        assert.strictEqual((await react_1.reactTool.dynamicExamples(context))[19].values.typescript, false);
        await react_1.reactTool.run({ name: "Card" }, context, "clear-presets");
        assert.deepStrictEqual(await react_1.reactTool.dynamicExamples(context), []);
    });
    (0, run_unit_tests_1.test)("workspace checks report missing and incompatible dependencies without changing files", async () => {
        const context = { workspace: { name: "app", exists: async () => true, findFiles: async () => [], readFile: async () => JSON.stringify({ dependencies: { react: "^18.2.0", next: "^14.0.0" } }) } };
        const result = await react_1.reactTool.run({ name: "Card" }, context, "check-workspace");
        assert.ok(result.messages.some(m => m.text.includes("react: declared ^18")));
        assert.ok(result.messages.some(m => m.text.includes("Missing dependency")));
        await assert.rejects(async () => react_1.reactTool.run({ name: "Card" }, {}, "check-workspace"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("generation is deterministic and bounded across repeated runs", () => {
        const options = { ...base, kind: "project", state: "query" };
        assert.deepStrictEqual((0, react_generator_1.generateReact)(options), (0, react_generator_1.generateReact)(options));
        const r = (0, react_generator_1.generateReact)(options);
        assert.ok(r.files.length < 100);
        assert.ok(r.files.reduce((sum, f) => sum + f.content.length, 0) < 1000000);
        assert.ok(r.files.some(f => f.path === ".env.example"));
        assert.ok(!r.files.some(f => f.path === ".env.local"));
    });
});
//# sourceMappingURL=react-generator.unit.js.map