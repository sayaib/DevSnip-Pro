"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reactTool = void 0;
const react_generator_1 = require("../engines/react-generator");
const types_1 = require("../types");
const web_git_1 = require("../engines/web-git");
const helpers_1 = require("./helpers");
exports.reactTool = {
    id: "web.react", command: "reactGenerator", title: "React / Next.js Generator", icon: "layers",
    summary: "Generate React and Next.js components, routes, providers, API clients, tests or complete projects with configurable styling and dependencies.",
    guide: "Targets React 19 and Next.js 15/16. App Router pages are Server Components; interactive templates include client boundaries. Copy, open or save individual files, or export all files. Existing files are checked before saving. Library providers must be mounted in your application. Auth.js requires OAuth credentials; forms and actions require your persistence service. Project output includes install and test commands; generation never installs or runs code.",
    keywords: ["react component", "next.js page", "app router", "pages router", "server action", "custom hook", "context", "zustand", "redux", "tanstack query", "tailwind", "shadcn", "chakra", "material ui", "project scaffold", "jest", "vitest"],
    live: true, runLabel: "Generate files",
    actions: [{ id: "save-preset", label: "Save preset" }, { id: "clear-presets", label: "Clear saved presets" }, { id: "check-workspace", label: "Check workspace dependencies" }],
    dynamicExamples(context) { return context.storage?.get("reactGenerator.presets", []) ?? []; },
    examples: [
        { label: "React + Tailwind starter", values: { kind: "project", framework: "react", name: "MyApp", styling: "tailwind", ui: "none", state: "none", rendering: "auto", lazy: false, memo: false } },
        { label: "Next.js App Router + Query", values: { kind: "project", framework: "next-app", name: "Dashboard", styling: "tailwind", state: "query", ui: "none", rendering: "auto", lazy: false, memo: false } },
        { label: "Pages Router API", values: { kind: "next-route", framework: "next-pages", name: "Users", route: "users/[id]", rendering: "auto", ui: "none" } },
        { label: "Accessible dialog", values: { kind: "modal", framework: "react", name: "DetailsDialog", styling: "none", rendering: "auto", ui: "none" } }
    ],
    fields: [
        helpers_1.f.select("kind", "Template", react_generator_1.REACT_TEMPLATES.map(([value, label]) => ({ value, label })), { searchable: true }),
        helpers_1.f.select("framework", "Framework", (0, helpers_1.opts)(["next-app", "Next.js · App Router"], ["next-pages", "Next.js · Pages Router"], ["react", "React · Vite"])),
        helpers_1.f.select("nextVersion", "Next.js version", (0, helpers_1.opts)(["16", "16 · Proxy"], ["15", "15 · Middleware"]), { showIf: { field: "framework", equals: ["next-app", "next-pages"] } }),
        helpers_1.f.text("name", "Name", { width: "narrow", default: "UserCard", required: true, help: "PascalCase, camelCase or kebab-case; up to 80 characters." }),
        helpers_1.f.text("route", "Route", { default: "users/[id]", showIf: { field: "kind", equals: ["next-page", "next-route", "server-action", "layout"] }, help: "Supports nested routes, [id], [...slug], [[...slug]] and App Router route groups. Use / for the root." }),
        helpers_1.f.toggle("typescript", "TypeScript / TSX", true),
        helpers_1.f.select("styling", "Styling", (0, helpers_1.opts)(["css-module", "CSS module"], ["tailwind", "Tailwind CSS v4"], ["none", "None"])),
        helpers_1.f.select("ui", "UI library", (0, helpers_1.opts)(["none", "Native HTML"], ["mui", "Material UI v7"], ["shadcn", "Shadcn UI (CLI setup)"], ["chakra", "Chakra UI v3"]), { showIf: { field: "kind", equals: ["component", "layout", "form", "modal", "table", "dashboard", "navigation", "project"] } }),
        helpers_1.f.select("state", "State management", (0, helpers_1.opts)(["none", "None"], ["context", "Context API"], ["zustand", "Zustand"], ["redux", "Redux Toolkit"], ["query", "TanStack Query"]), { showIf: { field: "kind", equals: ["project"] } }),
        helpers_1.f.select("client", "HTTP client", (0, helpers_1.opts)(["fetch", "Fetch"], ["axios", "Axios"]), { showIf: { field: "kind", equals: ["api-client", "query", "project"] } }),
        helpers_1.f.select("rendering", "Rendering", (0, helpers_1.opts)(["auto", "Automatic client boundaries"], ["client", "Client Component"], ["server", "Server Component"]), { showIf: { field: "kind", equals: ["component", "layout", "form", "modal", "table", "dashboard", "navigation"] } }),
        helpers_1.f.select("naming", "Component filenames", (0, helpers_1.opts)(["pascal", "PascalCase"], ["kebab", "kebab-case"]), { showIf: { field: "kind", equals: ["component"] } }),
        helpers_1.f.toggle("sourceDirectory", "Use src directory", true, { showIf: { field: "kind", equals: ["project"] } }),
        helpers_1.f.toggle("lazy", "Lazy wrapper + Suspense", false, { showIf: { field: "kind", equals: ["component"] } }),
        helpers_1.f.toggle("memo", "Memoize default export", false, { showIf: { field: "kind", equals: ["component"] }, help: "Enable after profiling; props should be stable." }),
        helpers_1.f.toggle("tests", "Generate tests + configuration", true, { showIf: { field: "kind", equals: ["component", "hook", "form", "modal", "table", "dashboard", "navigation", "project"] } }),
        helpers_1.f.select("testRunner", "Test runner", (0, helpers_1.opts)(["vitest", "Vitest + Testing Library"], ["jest", "Jest + Testing Library"]), { showIf: { field: "tests", equals: [true] } }),
        helpers_1.f.toggle("story", "Storybook story", false, { showIf: { field: "kind", equals: ["component"] } })
    ],
    async run(values, context, action) {
        const options = {
            kind: (0, types_1.str)(values, "kind", "component"), name: (0, types_1.required)(values, "name", "Name"),
            typescript: (0, types_1.bool)(values, "typescript", true), styling: (0, types_1.str)(values, "styling", "css-module"),
            tests: (0, types_1.bool)(values, "tests", true), story: (0, types_1.bool)(values, "story"), route: (0, types_1.str)(values, "route", ""),
            framework: (0, types_1.str)(values, "framework", "next-app"), nextVersion: (0, types_1.str)(values, "nextVersion", "16"),
            ui: (0, types_1.str)(values, "ui", "none"), state: (0, types_1.str)(values, "state", "none"),
            client: (0, types_1.str)(values, "client", "fetch"), rendering: (0, types_1.str)(values, "rendering", "auto"),
            naming: (0, types_1.str)(values, "naming", "pascal"), sourceDirectory: (0, types_1.bool)(values, "sourceDirectory", true),
            lazy: (0, types_1.bool)(values, "lazy"), memo: (0, types_1.bool)(values, "memo"), testRunner: (0, types_1.str)(values, "testRunner", "vitest")
        };
        if (action === "clear-presets") {
            if (!context.storage)
                throw new types_1.ToolInputError("Preset storage is unavailable in this session.");
            await context.storage.set("reactGenerator.presets", []);
            return { messages: [{ kind: "success", text: "Saved presets cleared." }] };
        }
        const r = (0, react_generator_1.generateReact)(options);
        if (action === "save-preset") {
            if (!context.storage)
                throw new types_1.ToolInputError("Preset storage is unavailable in this session.");
            const label = `Saved: ${options.name} · ${options.kind}`;
            const saved = context.storage.get("reactGenerator.presets", []).filter(preset => preset.label !== label);
            await context.storage.set("reactGenerator.presets", [...saved, { label, values: { ...options } }].slice(-20));
            r.steps.unshift("Preset saved. Select it from Presets to reuse these options (up to 20 saved presets).");
        }
        const diagnostics = [];
        if (action === "check-workspace") {
            if (!context.workspace)
                throw new types_1.ToolInputError("Open a workspace to check its dependencies.");
            const source = await context.workspace.readFile("package.json");
            if (!source)
                throw new types_1.ToolInputError("No package.json found at the workspace root. Open the application folder in monorepos.");
            let manifest;
            try {
                manifest = JSON.parse(source);
            }
            catch {
                throw new types_1.ToolInputError("Workspace package.json is not valid JSON.");
            }
            if (!manifest || typeof manifest !== "object")
                throw new types_1.ToolInputError("Workspace package.json must contain an object.");
            const installed = { ...manifest.dependencies, ...manifest.devDependencies };
            const needed = { react: "^19.0.0", ...(options.framework !== "react" && options.kind !== "rn-screen" ? { next: `^${options.nextVersion}.0.0` } : {}), ...r.dependencies, ...r.devDependencies };
            for (const [name, expected] of Object.entries(needed)) {
                const actual = installed[name];
                if (!actual)
                    diagnostics.push({ kind: "warning", text: `Missing dependency: ${name} (${expected}).` });
                else if (typeof actual === "string") {
                    // Compare concrete lower bounds only; do not claim lockfile resolution from a manifest range.
                    const lower = actual.match(/^[~^]?(\d+\.\d+\.\d+)$/)?.[1];
                    try {
                        if (lower && !(0, web_git_1.satisfies)((0, web_git_1.parseVersion)(lower), (0, web_git_1.parseRange)(expected)))
                            diagnostics.push({ kind: "warning", text: `${name}: declared ${actual}; generated output targets ${expected}. Check your resolved lockfile version.` });
                    }
                    catch { /* Workspace protocols and prereleases require package-manager resolution. */ }
                }
            }
            diagnostics.push({ kind: "info", text: "Checked package.json declarations only. Verify resolved versions in your lockfile; no dependencies were installed or changed." });
        }
        const install = Object.entries(r.dependencies).map(([k, v]) => `'${k}@${v}'`);
        const dev = Object.entries(r.devDependencies).map(([k, v]) => `'${k}@${v}'`);
        return {
            stats: [{ label: "Files", value: String(r.files.length) }, { label: "Target", value: options.kind === "rn-screen" ? "React Native" : options.framework === "react" ? "React 19" : `Next.js ${options.nextVersion}` }],
            messages: [...diagnostics, ...r.steps.map(text => ({ kind: "info", text }))],
            outputs: [{ kind: "files", title: "Generated files", files: r.files }, ...(options.kind !== "project" && (install.length || dev.length) ? [(0, helpers_1.code)("Install dependencies", "shell", [install.length ? `npm install ${install.join(" ")}` : "", dev.length ? `npm install -D ${dev.join(" ")}` : ""].filter(Boolean).join("\n"))] : [])]
        };
    }
};
//# sourceMappingURL=react.js.map