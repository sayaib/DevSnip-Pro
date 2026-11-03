import { generateReact, REACT_TEMPLATES, ReactOptions } from "../engines/react-generator";
import { ToolSpec, ToolExample, ToolInputError, Values, bool, required, str } from "../types";
import { parseRange, parseVersion, satisfies } from "../engines/web-git";
import { code, f, opts } from "./helpers";

export const reactTool: ToolSpec = {
  id: "web.react", command: "reactGenerator", title: "React / Next.js Generator", icon: "layers",
  summary: "Generate React and Next.js components, routes, providers, API clients, tests or complete projects with configurable styling and dependencies.",
  guide: "Targets React 19 and Next.js 15/16. App Router pages are Server Components; interactive templates include client boundaries. Copy, open or save individual files, or export all files. Existing files are checked before saving. Library providers must be mounted in your application. Auth.js requires OAuth credentials; forms and actions require your persistence service. Project output includes install and test commands; generation never installs or runs code.",
  keywords: ["react component", "next.js page", "app router", "pages router", "server action", "custom hook", "context", "zustand", "redux", "tanstack query", "tailwind", "shadcn", "chakra", "material ui", "project scaffold", "jest", "vitest"],
  live: true, runLabel: "Generate files",
  actions: [{ id: "save-preset", label: "Save preset" }, { id: "clear-presets", label: "Clear saved presets" }, { id: "check-workspace", label: "Check workspace dependencies" }],
  dynamicExamples(context) { return context.storage?.get<ToolExample[]>("reactGenerator.presets", []) ?? []; },
  examples: [
    { label: "React + Tailwind starter", values: { kind: "project", framework: "react", name: "MyApp", styling: "tailwind", ui: "none", state: "none", rendering: "auto", lazy: false, memo: false } },
    { label: "Next.js App Router + Query", values: { kind: "project", framework: "next-app", name: "Dashboard", styling: "tailwind", state: "query", ui: "none", rendering: "auto", lazy: false, memo: false } },
    { label: "Pages Router API", values: { kind: "next-route", framework: "next-pages", name: "Users", route: "users/[id]", rendering: "auto", ui: "none" } },
    { label: "Accessible dialog", values: { kind: "modal", framework: "react", name: "DetailsDialog", styling: "none", rendering: "auto", ui: "none" } }
  ],
  fields: [
    f.select("kind", "Template", REACT_TEMPLATES.map(([value, label]) => ({ value, label })), { searchable: true }),
    f.select("framework", "Framework", opts(["next-app", "Next.js · App Router"], ["next-pages", "Next.js · Pages Router"], ["react", "React · Vite"])),
    f.select("nextVersion", "Next.js version", opts(["16", "16 · Proxy"], ["15", "15 · Middleware"]), { showIf: { field: "framework", equals: ["next-app", "next-pages"] } }),
    f.text("name", "Name", { width: "narrow", default: "UserCard", required: true, help: "PascalCase, camelCase or kebab-case; up to 80 characters." }),
    f.text("route", "Route", { default: "users/[id]", showIf: { field: "kind", equals: ["next-page", "next-route", "server-action", "layout"] }, help: "Supports nested routes, [id], [...slug], [[...slug]] and App Router route groups. Use / for the root." }),
    f.toggle("typescript", "TypeScript / TSX", true),
    f.select("styling", "Styling", opts(["css-module", "CSS module"], ["tailwind", "Tailwind CSS v4"], ["none", "None"])),
    f.select("ui", "UI library", opts(["none", "Native HTML"], ["mui", "Material UI v7"], ["shadcn", "Shadcn UI (CLI setup)"], ["chakra", "Chakra UI v3"]), { showIf: { field: "kind", equals: ["component", "layout", "form", "modal", "table", "dashboard", "navigation", "project"] } }),
    f.select("state", "State management", opts(["none", "None"], ["context", "Context API"], ["zustand", "Zustand"], ["redux", "Redux Toolkit"], ["query", "TanStack Query"]), { showIf: { field: "kind", equals: ["project"] } }),
    f.select("client", "HTTP client", opts(["fetch", "Fetch"], ["axios", "Axios"]), { showIf: { field: "kind", equals: ["api-client", "query", "project"] } }),
    f.select("rendering", "Rendering", opts(["auto", "Automatic client boundaries"], ["client", "Client Component"], ["server", "Server Component"]), { showIf: { field: "kind", equals: ["component", "layout", "form", "modal", "table", "dashboard", "navigation"] } }),
    f.select("naming", "Component filenames", opts(["pascal", "PascalCase"], ["kebab", "kebab-case"]), { showIf: { field: "kind", equals: ["component"] } }),
    f.toggle("sourceDirectory", "Use src directory", true, { showIf: { field: "kind", equals: ["project"] } }),
    f.toggle("lazy", "Lazy wrapper + Suspense", false, { showIf: { field: "kind", equals: ["component"] } }),
    f.toggle("memo", "Memoize default export", false, { showIf: { field: "kind", equals: ["component"] }, help: "Enable after profiling; props should be stable." }),
    f.toggle("tests", "Generate tests + configuration", true, { showIf: { field: "kind", equals: ["component", "hook", "form", "modal", "table", "dashboard", "navigation", "project"] } }),
    f.select("testRunner", "Test runner", opts(["vitest", "Vitest + Testing Library"], ["jest", "Jest + Testing Library"]), { showIf: { field: "tests", equals: [true] } }),
    f.toggle("story", "Storybook story", false, { showIf: { field: "kind", equals: ["component"] } })
  ],
  async run(values, context, action) {
    const options: ReactOptions = {
      kind: str(values, "kind", "component") as ReactOptions["kind"], name: required(values, "name", "Name"),
      typescript: bool(values, "typescript", true), styling: str(values, "styling", "css-module") as ReactOptions["styling"],
      tests: bool(values, "tests", true), story: bool(values, "story"), route: str(values, "route", ""),
      framework: str(values, "framework", "next-app") as ReactOptions["framework"], nextVersion: str(values, "nextVersion", "16") as ReactOptions["nextVersion"],
      ui: str(values, "ui", "none") as ReactOptions["ui"], state: str(values, "state", "none") as ReactOptions["state"],
      client: str(values, "client", "fetch") as ReactOptions["client"], rendering: str(values, "rendering", "auto") as ReactOptions["rendering"],
      naming: str(values, "naming", "pascal") as ReactOptions["naming"], sourceDirectory: bool(values, "sourceDirectory", true),
      lazy: bool(values, "lazy"), memo: bool(values, "memo"), testRunner: str(values, "testRunner", "vitest") as ReactOptions["testRunner"]
    };
    if (action === "clear-presets") {
      if (!context.storage) throw new ToolInputError("Preset storage is unavailable in this session.");
      await context.storage.set("reactGenerator.presets", []);
      return { messages: [{ kind: "success", text: "Saved presets cleared." }] };
    }
    const r = generateReact(options);
    if (action === "save-preset") {
      if (!context.storage) throw new ToolInputError("Preset storage is unavailable in this session.");
      const label = `Saved: ${options.name} · ${options.kind}`;
      const saved = context.storage.get<ToolExample[]>("reactGenerator.presets", []).filter(preset => preset.label !== label);
      await context.storage.set("reactGenerator.presets", [...saved, { label, values: { ...options } as Values }].slice(-20));
      r.steps.unshift("Preset saved. Select it from Presets to reuse these options (up to 20 saved presets).");
    }
    const diagnostics: Array<{ kind: "warning" | "info"; text: string }> = [];
    if (action === "check-workspace") {
      if (!context.workspace) throw new ToolInputError("Open a workspace to check its dependencies.");
      const source = await context.workspace.readFile("package.json");
      if (!source) throw new ToolInputError("No package.json found at the workspace root. Open the application folder in monorepos.");
      let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      try { manifest = JSON.parse(source); } catch { throw new ToolInputError("Workspace package.json is not valid JSON."); }
      if (!manifest || typeof manifest !== "object") throw new ToolInputError("Workspace package.json must contain an object.");
      const installed = { ...manifest.dependencies, ...manifest.devDependencies };
      const needed = { react: "^19.0.0", ...(options.framework !== "react" && options.kind !== "rn-screen" ? { next: `^${options.nextVersion}.0.0` } : {}), ...r.dependencies, ...r.devDependencies };
      for (const [name, expected] of Object.entries(needed)) {
        const actual = installed[name];
        if (!actual) diagnostics.push({ kind: "warning", text: `Missing dependency: ${name} (${expected}).` });
        else if (typeof actual === "string") {
          // Compare concrete lower bounds only; do not claim lockfile resolution from a manifest range.
          const lower = actual.match(/^[~^]?(\d+\.\d+\.\d+)$/)?.[1];
          try { if (lower && !satisfies(parseVersion(lower), parseRange(expected))) diagnostics.push({ kind: "warning", text: `${name}: declared ${actual}; generated output targets ${expected}. Check your resolved lockfile version.` }); } catch { /* Workspace protocols and prereleases require package-manager resolution. */ }
        }
      }
      diagnostics.push({ kind: "info", text: "Checked package.json declarations only. Verify resolved versions in your lockfile; no dependencies were installed or changed." });
    }
    const install = Object.entries(r.dependencies).map(([k, v]) => `'${k}@${v}'`);
    const dev = Object.entries(r.devDependencies).map(([k, v]) => `'${k}@${v}'`);
    return {
      stats: [{ label: "Files", value: String(r.files.length) }, { label: "Target", value: options.kind === "rn-screen" ? "React Native" : options.framework === "react" ? "React 19" : `Next.js ${options.nextVersion}` }],
      messages: [...diagnostics, ...r.steps.map(text => ({ kind: "info" as const, text }))],
      outputs: [{ kind: "files", title: "Generated files", files: r.files }, ...(options.kind !== "project" && (install.length || dev.length) ? [code("Install dependencies", "shell", [install.length ? `npm install ${install.join(" ")}` : "", dev.length ? `npm install -D ${dev.join(" ")}` : ""].filter(Boolean).join("\n"))] : [])]
    };
  }
};

