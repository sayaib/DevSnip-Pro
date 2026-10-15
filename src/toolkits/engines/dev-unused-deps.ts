/**
 * Finds declared dependencies that nothing in the project uses: npm packages
 * never imported, required or referenced by a script or config file, Python
 * requirements whose modules are never imported or named, and pub packages
 * never imported as package:name/. Results are candidates for review, never
 * removed automatically: plugins, CLIs and drivers can be used without an
 * import, so each rule below errs towards "used".
 */
import type { ToolContext } from "../types";
import { DeclaredDependency, isDevRequirementsFile, normalizePipName, parsePackageJson, parsePyproject, parseRequirements } from "../../services/dependency-manager";

type Workspace = NonNullable<ToolContext["workspace"]>;

export type DependencyEcosystem = "npm" | "python" | "pub";

export interface UnusedDependency {
  name: string;
  /** dependencies, devDependencies, dev_dependencies, requirements-dev.txt… */
  section: string;
  reason: string;
}

export interface ProjectScan {
  ecosystem: DependencyEcosystem;
  /** Workspace-relative folder ("" for the root). */
  dir: string;
  manifest: string;
  checked: number;
  sourceFiles: number;
  unused: UnusedDependency[];
  /** Shell command that removes every unused dependency, run in `dir`. */
  removeCommand?: string;
  notes: string[];
}

const MAX_SOURCE_FILES = 5000;
const SKIP = /(?:^|\/)(?:node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|\.venv|venv|env|__pycache__|site-packages|\.dart_tool|\.pub-cache|Pods|ios\/Pods|android\/\.gradle|\.turbo|\.cache)\//;
const join = (dir: string, file: string) => (dir ? `${dir}/${file}` : file);
const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const SHALLOW = (pattern: string) => `{${pattern},*/${pattern},*/*/${pattern},*/*/*/${pattern}}`;

export async function findUnusedDependencies(ws: Workspace, options: { folder?: string; includeDev?: boolean } = {}): Promise<ProjectScan[]> {
  const prefix = (options.folder ?? "").replace(/^\.?\/+|\/+$/g, "");
  const inFolder = (file: string) => !prefix || file === prefix || file.startsWith(prefix + "/");
  const manifests = async (pattern: string) => (await ws.findFiles(SHALLOW(pattern), 200)).filter(file => !SKIP.test(file) && inFolder(file)).sort();
  const scans: ProjectScan[] = [];
  const includeDev = options.includeDev !== false;

  for (const file of await manifests("package.json")) {
    const scan = await scanNpm(ws, file, includeDev);
    if (scan) scans.push(scan);
  }
  const pythonDirs = new Set((await manifests("{pyproject.toml,requirements*.txt}")).map(dirOf));
  for (const dir of [...pythonDirs].sort()) {
    const scan = await scanPython(ws, dir, includeDev);
    if (scan) scans.push(scan);
  }
  for (const file of await manifests("pubspec.yaml")) {
    const scan = await scanPub(ws, file, includeDev);
    if (scan) scans.push(scan);
  }
  return scans;
}

/** Files under `dir` matching `glob`, minus nested projects' dependencies and build output. */
async function sourcesUnder(ws: Workspace, dir: string, glob: string): Promise<string[]> {
  const files = await ws.findFiles(dir ? `${dir}/**/${glob}` : `**/${glob}`, MAX_SOURCE_FILES);
  return files.filter(file => !SKIP.test(file));
}

async function readAll(ws: Workspace, files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < files.length; i += 50) {
    const batch = await Promise.all(files.slice(i, i + 50).map(file => ws.readFile(file)));
    for (const text of batch) if (text !== undefined) out.push(text);
  }
  return out;
}

/** True when `word` appears as a whole token (letters, digits, _ - . @ / are word characters). */
function mentions(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w@./-])${escaped}(?=$|[^\\w-])`, "m").test(text);
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

/** True when `command` is run: at the start of a command, after && ; | or through npx / pnpm exec / yarn / bunx. */
function invokes(text: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?:^|[;&|(\`"']\\s*|\\b(?:npx|pnpx|bunx|exec|dlx|yarn|pnpm|run|cross-env(?:\\s+\\w+=\\S+)*)\\s+(?:--?\\S+\\s+)*)${escaped}(?=$|[\\s;&|)\`"'])`, "m").test(text);
}

const NODE_SOURCES = "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,mdx}";
const NODE_CONFIGS = "{*.config.*,.*rc,.*rc.*,*.json,.babelrc,.npmrc,.env*,Dockerfile,Procfile,Makefile,*.yml,*.yaml,*.css,*.scss,*.sass,*.less,*.html}";

/** Bare module specifiers: import/export from, import(), require(), require.resolve(), jest/vi.mock(), triple-slash types. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire(?:\.resolve)?\s*\(\s*|\b(?:jest|vi)\.(?:mock|requireActual|importActual)\s*\(\s*|\/\/\/\s*<reference\s+types\s*=\s*|@import\s+(?:url\()?\s*)["'`]([^"'`\s]+)["'`]/g;

export function packageOfSpecifier(specifier: string): string | undefined {
  if (/^(?:\.|\/|[a-z]+:|#|~\/|@\/)/i.test(specifier)) return undefined; // relative, absolute, node:, virtual:, subpath imports, aliases
  const clean = specifier.replace(/^~/, "").replace(/\?.*$/, "");
  const parts = clean.split("/");
  if (clean.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0] || undefined;
}

export function importedPackages(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(SPECIFIER)) {
    const name = packageOfSpecifier(match[1]);
    if (name) found.add(name);
  }
  return found;
}

/** Names a config file may use instead of the package name (eslint-plugin-react → "react", @babel/preset-env → "@babel/env"). */
function configAliases(name: string): string[] {
  const aliases = [name];
  const plugin = /^(?:(@[^/]+)\/)?(eslint-plugin|eslint-config|prettier-plugin|babel-plugin|babel-preset|stylelint-config|stylelint-plugin|postcss|remark|rehype)(?:-(.+))?$/.exec(name);
  if (plugin) {
    const [, scope, kind, rest] = plugin;
    if (scope && !rest) aliases.push(scope);
    if (rest) aliases.push(scope ? `${scope}/${rest}` : rest);
    if (kind.startsWith("eslint")) aliases.push(`plugin:${rest ?? scope}`);
  }
  const babel = /^@babel\/(preset|plugin)-(.+)$/.exec(name);
  if (babel) aliases.push(`@babel/${babel[2]}`, babel[2]);
  return aliases;
}

/** Packages a framework or tool loads by name, without any import in the project's code. */
const NPM_IMPLICIT: Array<{ when: (deps: Set<string>, files: { ts: boolean; scss: boolean; less: boolean }) => boolean; names: string[] }> = [
  { when: deps => deps.has("next"), names: ["react", "react-dom", "next", "sharp", "eslint-config-next", "@next/eslint-plugin-next"] },
  { when: deps => deps.has("react-native") || deps.has("expo"), names: ["react", "react-native", "expo", "react-native-reanimated", "react-native-gesture-handler", "react-native-screens", "react-native-safe-area-context", "@babel/core", "metro-react-native-babel-preset", "@react-native/babel-preset", "@react-native/metro-config", "@react-native-community/cli"] },
  { when: deps => deps.has("react") && deps.has("react-dom"), names: ["react"] },
  { when: (_, f) => f.ts, names: ["typescript", "tslib", "@types/node"] },
  { when: (_, f) => f.scss, names: ["sass", "sass-embedded", "node-sass"] },
  { when: (_, f) => f.less, names: ["less"] },
  { when: deps => deps.has("tailwindcss"), names: ["tailwindcss", "postcss", "autoprefixer", "@tailwindcss/postcss"] },
  { when: deps => deps.has("@angular/core"), names: ["zone.js", "@angular/compiler", "@angular/platform-browser", "@angular/platform-browser-dynamic", "@angular-devkit/build-angular", "@angular/build", "@angular/cli", "@angular/compiler-cli", "rxjs", "tslib"] },
  { when: deps => deps.has("vue"), names: ["@vue/compiler-sfc", "vue-tsc"] },
  { when: deps => deps.has("@nestjs/core"), names: ["reflect-metadata", "rxjs", "@nestjs/platform-express", "@nestjs/cli", "@nestjs/schematics"] },
  { when: deps => deps.has("prisma") || deps.has("@prisma/client"), names: ["prisma", "@prisma/client"] },
  { when: deps => deps.has("husky"), names: ["husky", "lint-staged"] }
];

async function scanNpm(ws: Workspace, manifest: string, includeDev: boolean): Promise<ProjectScan | undefined> {
  const text = await ws.readFile(manifest);
  if (text === undefined) return undefined;
  const parsed = parsePackageJson(text, manifest);
  if (parsed.error) return { ecosystem: "npm", dir: dirOf(manifest), manifest, checked: 0, sourceFiles: 0, unused: [], notes: [parsed.error] };
  const dir = dirOf(manifest);
  const declared = parsed.dependencies.filter(dep => dep.scope !== "peer" && (includeDev || dep.scope !== "development"));
  if (!declared.length) return undefined;

  const nested = (await ws.findFiles(dir ? `${dir}/*/**/package.json` : "*/**/package.json", 200)).filter(file => !SKIP.test(file)).map(dirOf);
  const own = (file: string) => !nested.some(sub => file.startsWith(sub + "/"));
  const sourceFiles = (await sourcesUnder(ws, dir, NODE_SOURCES)).filter(own);
  const configFiles = [...(await ws.findFiles(join(dir, NODE_CONFIGS), 200)), ...(await sourcesUnder(ws, dir, "{.storybook,.husky,.github,config,scripts}/*"))].filter(file => !SKIP.test(file) && file !== manifest && !/(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(file));
  const sources = await readAll(ws, sourceFiles);
  const configText = (await readAll(ws, configFiles)).join("\n");

  // package.json itself, without the dependency lists, carries scripts and tool config (jest, eslintConfig, prettier…).
  const manifestJson = JSON.parse(text) as Record<string, unknown>;
  const rest = { ...manifestJson };
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "name", "version", "description", "overrides", "resolutions", "pnpm"]) delete rest[key];
  const manifestText = JSON.stringify(rest);
  const scripts = Object.values((manifestJson.scripts ?? {}) as Record<string, string>).join("\n");

  const imported = new Set<string>();
  for (const source of sources) importedPackages(source).forEach(name => imported.add(name));
  // A string that is exactly a package name is how frameworks load packages by name: view engines ('hbs'), knex clients ('pg').
  const quoted = new Set<string>();
  for (const source of sources) for (const match of source.matchAll(/["'`](@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)["'`]/g)) quoted.add(match[1]);
  for (const name of importedPackages(configText)) imported.add(name);

  const names = new Set(parsed.dependencies.map(dep => dep.name));
  const kinds = { ts: sourceFiles.some(file => /\.(?:ts|tsx|mts|cts)$/.test(file)) || (await ws.exists(join(dir, "tsconfig.json"))), scss: configFiles.concat(sourceFiles).some(f => /\.s[ac]ss$/.test(f)) || sources.some(s => /lang=["']s[ac]ss/.test(s)), less: configFiles.some(f => f.endsWith(".less")) };
  const implicit = new Set(NPM_IMPLICIT.filter(rule => rule.when(names, kinds)).flatMap(rule => rule.names));

  // A package installed to satisfy another dependency's peer requirement is used by that dependency.
  const peers = new Set<string>();
  for (const dep of parsed.dependencies) {
    const installed = await ws.readFile(join(dir, `node_modules/${dep.name}/package.json`));
    if (!installed) continue;
    try { Object.keys((JSON.parse(installed) as { peerDependencies?: Record<string, string> }).peerDependencies ?? {}).forEach(name => peers.add(name)); } catch { /* skip unreadable manifests */ }
  }

  const used = (name: string) => imported.has(name) || implicit.has(name) || peers.has(name) || quoted.has(name);
  const unused: UnusedDependency[] = [];
  for (const dep of declared) {
    if (used(dep.name)) continue;
    // @types/x is used when x is, or when x is a Node built-in or test global (node, jest, mocha…) or listed in tsconfig "types".
    const typesOf = /^@types\/(?:([^_]+)__)?(.+)$/.exec(dep.name);
    if (typesOf) {
      const target = typesOf[1] ? `@${typesOf[1]}/${typesOf[2]}` : typesOf[2];
      if (used(target) || ["node", "jest", "mocha", "jasmine", "bun", "web", "chrome", "vscode"].includes(target) || mentions(configText + manifestText, target)) continue;
      unused.push({ name: dep.name, section: sectionOf(dep), reason: names.has(target) ? `Types for ${target}, which no code uses either.` : `No code imports ${target}, and ${target} is not a dependency.` });
      continue;
    }
    if (configAliases(dep.name).some(alias => mentions(configText, alias) || mentions(manifestText, alias))) continue;
    const bins = await binNames(ws, dir, dep.name);
    if (bins.some(bin => invokes(scripts, bin) || invokes(configText, bin))) continue;
    unused.push({ name: dep.name, section: sectionOf(dep), reason: `Not imported or required in ${sourceFiles.length} source file${sourceFiles.length === 1 ? "" : "s"}, and not named in a script or config file.` });
  }
  const pm = await packageManager(ws, dir, parsed.packageManager);
  const notes = sourceFiles.length >= MAX_SOURCE_FILES ? [`Only the first ${MAX_SOURCE_FILES} source files were read.`] : [];
  return {
    ecosystem: "npm", dir, manifest, checked: declared.length, sourceFiles: sourceFiles.length, unused, notes,
    removeCommand: unused.length ? `${pm} ${pm === "npm" ? "uninstall" : "remove"} ${unused.map(u => u.name).join(" ")}` : undefined
  };
}

function sectionOf(dep: DeclaredDependency): string {
  return dep.scope === "development" ? "devDependencies" : dep.scope === "optional" ? "optionalDependencies" : "dependencies";
}

/** The executables a package installs (from node_modules when installed), else its name. */
async function binNames(ws: Workspace, dir: string, name: string): Promise<string[]> {
  const names = [name, name.split("/").pop() ?? name];
  const text = await ws.readFile(join(dir, `node_modules/${name}/package.json`));
  if (text) {
    try {
      const bin = (JSON.parse(text) as { bin?: string | Record<string, string> }).bin;
      if (typeof bin === "object" && bin) names.push(...Object.keys(bin));
    } catch { /* unreadable manifest: fall back to the name */ }
  }
  return names;
}

async function packageManager(ws: Workspace, dir: string, declared?: string): Promise<string> {
  const fromField = declared?.split("@")[0];
  if (fromField && ["npm", "pnpm", "yarn", "bun"].includes(fromField)) return fromField;
  for (let current = dir; ; current = dirOf(current)) {
    if (await ws.exists(join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await ws.exists(join(current, "yarn.lock"))) return "yarn";
    if ((await ws.exists(join(current, "bun.lockb"))) || (await ws.exists(join(current, "bun.lock")))) return "bun";
    if (await ws.exists(join(current, "package-lock.json"))) return "npm";
    if (!current) return "npm";
  }
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** Distributions whose import name differs from their (normalised) name. */
const PY_MODULES: Record<string, string[]> = {
  beautifulsoup4: ["bs4"], pillow: ["PIL"], pyyaml: ["yaml"], "python-dotenv": ["dotenv"], "scikit-learn": ["sklearn"],
  "opencv-python": ["cv2"], "opencv-python-headless": ["cv2"], "opencv-contrib-python": ["cv2"], "psycopg2-binary": ["psycopg2"],
  "psycopg-binary": ["psycopg"], "python-jose": ["jose"], pyjwt: ["jwt"], "python-multipart": ["multipart", "python_multipart"],
  protobuf: ["google.protobuf", "google"], "python-dateutil": ["dateutil"], mysqlclient: ["MySQLdb"], djangorestframework: ["rest_framework"],
  "django-cors-headers": ["corsheaders"], pycryptodome: ["Crypto"], pycryptodomex: ["Cryptodome"], "typing-extensions": ["typing_extensions"],
  attrs: ["attr", "attrs"], "google-api-python-client": ["googleapiclient"], "msgpack-python": ["msgpack"], pyzmq: ["zmq"],
  "python-magic": ["magic"], pyserial: ["serial"], "pywin32": ["win32api", "win32con", "pywintypes"], "ruamel.yaml": ["ruamel"],
  "email-validator": ["email_validator"], "faiss-cpu": ["faiss"], "faiss-gpu": ["faiss"], tensorflow: ["tensorflow", "tf"],
  "sentence-transformers": ["sentence_transformers"], "pydantic-settings": ["pydantic_settings"], "python-socketio": ["socketio"],
  "python-slugify": ["slugify"], "discord.py": ["discord"], "websocket-client": ["websocket"], "llama-index": ["llama_index"]
};

/** Used through a CLI, a server, a URL scheme or another package, never imported directly. */
const PY_IMPLICIT = new Set([
  "uvicorn", "gunicorn", "hypercorn", "daphne", "waitress", "celery", "flower", "pytest", "pytest-cov", "pytest-asyncio", "pytest-mock", "pytest-django",
  "pytest-xdist", "coverage", "black", "ruff", "flake8", "mypy", "isort", "pylint", "pre-commit", "tox", "nox", "pip-tools", "setuptools", "wheel",
  "build", "twine", "hatchling", "poetry-core", "ipykernel", "jupyter", "jupyterlab", "notebook", "alembic", "whitenoise", "django-debug-toolbar",
  "python-multipart", "email-validator", "httptools", "uvloop", "watchfiles", "websockets", "bcrypt", "argon2-cffi", "cryptography",
  "psycopg2", "psycopg2-binary", "psycopg", "psycopg-binary", "asyncpg", "aiosqlite", "pymysql", "mysqlclient", "aiomysql", "oracledb", "cx-oracle", "pyodbc"
]);

async function scanPython(ws: Workspace, dir: string, includeDev: boolean): Promise<ProjectScan | undefined> {
  const manifestFiles = (await ws.findFiles(join(dir, "{pyproject.toml,requirements*.txt,requirements/*.txt}"), 50)).sort();
  const declared = new Map<string, { dep: DeclaredDependency; source: string }>();
  const notes: string[] = [];
  for (const file of manifestFiles) {
    const text = await ws.readFile(file);
    if (text === undefined) continue;
    const base = file.slice(dir ? dir.length + 1 : 0);
    let deps: DeclaredDependency[] = [];
    if (base === "pyproject.toml") {
      const parsed = parsePyproject(text);
      deps = parsed.dependencies;
      if (parsed.poetryOnly) deps = poetryDependencies(text);
    } else {
      deps = parseRequirements(text, base, isDevRequirementsFile(base) ? "development" : "production");
      const direct = directRequirements(text);
      if (direct) deps = deps.filter(dep => direct.has(normalizePipName(dep.name)));
      else if (deps.length >= 15 && deps.every(dep => /^==[^,*]+$/.test(dep.spec))) {
        notes.push(`${base} pins all ${deps.length} packages exactly, like pip freeze output, so it also lists packages that other packages need. It was not checked; check the file that declares your direct dependencies (requirements.in or pyproject.toml).`);
        deps = [];
      }
    }
    for (const dep of deps) if (!declared.has(dep.name) && (includeDev || dep.scope !== "development")) declared.set(dep.name, { dep, source: base });
  }
  if (!declared.size) return notes.length ? { ecosystem: "python", dir, manifest: manifestFiles.map(file => file.slice(dir ? dir.length + 1 : 0)).join(", "), checked: 0, sourceFiles: 0, unused: [], notes } : undefined;
  const sourceFiles = await sourcesUnder(ws, dir, "*.py");
  const sources = await readAll(ws, sourceFiles);
  const configFiles = [
    ...(await ws.findFiles(join(dir, "{*.ini,*.cfg,*.toml,*.yml,*.yaml,*.env,.env*,Procfile,Dockerfile,Makefile,*.sh,*.json}"), 100)),
    ...(await sourcesUnder(ws, dir, "{.github/workflows/*.yml,.github/workflows/*.yaml,docs/Makefile,docs/*.toml,scripts/*.sh}"))
  ].filter(file => !SKIP.test(file) && !/(?:^|\/)(?:requirements[^/]*\.txt|uv\.lock|poetry\.lock|Pipfile\.lock)$/.test(file));
  // pyproject.toml lists every dependency by name; only its other tables ([tool.tox] commands, [tool.*] config) count.
  const configText = (await Promise.all(configFiles.map(async file => {
    const text = (await ws.readFile(file)) ?? "";
    return file.endsWith("pyproject.toml") ? withoutDependencyTables(text) : text;
  }))).join("\n");

  const modules = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/^[ \t]*(?:from[ \t]+([A-Za-z_][\w.]*)[ \t]+import|import[ \t]+([^\n#;]+))/gm)) {
      if (match[1]) modules.add(match[1]);
      else for (const part of match[2].split(",")) { const name = part.trim().split(/\s+as\s+/)[0].trim(); if (name) modules.add(name); }
    }
  }
  const topLevel = new Set([...modules].map(name => name.split(".")[0]));
  const allText = sources.join("\n") + "\n" + configText;

  const unused: UnusedDependency[] = [];
  const hosts = [...PY_IMPLICIT, ...declared.keys(), "sphinx", "mkdocs", "jupyter", "ipython", "hatch", "pdm", "poetry"];
  for (const { dep, source } of declared.values()) {
    if (PY_IMPLICIT.has(dep.name) || dep.name.startsWith("types-")) continue;
    // Plugins name themselves after their host: pytest-cov, flake8-bugbear, tox-uv, pre-commit-uv, mkdocs-material.
    if (hosts.some(host => host !== dep.name && dep.name.startsWith(host + "-"))) continue;
    const candidates = PY_MODULES[dep.name] ?? [];
    const normalised = dep.name.replace(/-/g, "_");
    // Namespace packages: sphinxcontrib-log-cabinet is sphinxcontrib.log_cabinet, google-cloud-storage is google.cloud.storage.
    const namespaced = [dep.name.replace("-", ".").replace(/-/g, "_"), dep.name.replace(/-/g, ".")];
    const names = [...candidates, normalised, normalised.replace(/^python_|^py_/, ""), dep.displayName.replace(/-/g, "_"), ...namespaced];
    const dotted = dep.name.replace(/-/g, ".");
    if (names.some(name => topLevel.has(name) || modules.has(name)) || modules.has(dotted) || [...modules].some(m => m.startsWith(dotted + "."))) continue;
    // Django INSTALLED_APPS, SQLAlchemy URLs ("postgresql+asyncpg"), CLI calls in a Procfile or Dockerfile.
    if (names.some(name => mentions(allText, name)) || mentions(configText, dep.name) || mentions(configText, dep.displayName)) continue;
    unused.push({ name: dep.displayName, section: source, reason: `No module of it is imported in ${sourceFiles.length} Python file${sourceFiles.length === 1 ? "" : "s"}, and it is not named in settings or config.` });
  }
  const tool = (await ws.exists(join(dir, "uv.lock"))) ? "uv" : (await ws.exists(join(dir, "poetry.lock"))) ? "poetry" : "pip";
  const list = unused.map(u => u.name).join(" ");
  const removeCommand = !unused.length ? undefined
    : tool === "uv" ? `uv remove ${list}` : tool === "poetry" ? `poetry remove ${list}` : `python -m pip uninstall ${list}`;
  if (tool === "pip" && unused.length) notes.push(`pip uninstall only changes the environment: also delete the lines from ${[...new Set(unused.map(u => u.section))].join(", ")}.`);
  return { ecosystem: "python", dir, manifest: manifestFiles.map(file => file.slice(dir ? dir.length + 1 : 0)).join(", "), checked: declared.size, sourceFiles: sourceFiles.length, unused, removeCommand, notes };
}

/**
 * For pip-compile / uv pip compile output: the packages the input declared
 * ("# via -r requirements.in", "# via pkg (pyproject.toml)"), leaving out
 * those only another package needs. Undefined when the file has no annotations.
 */
export function directRequirements(text: string): Set<string> | undefined {
  if (!/^\s*#\s+via\b/m.test(text)) return undefined;
  const direct = new Set<string>();
  let current: string | undefined;
  let via: string[] = [];
  const flush = () => {
    if (current && (!via.length || via.some(target => /(?:^-[rc]\s|\(|\.in$|\.txt$|\.toml|setup\.(?:py|cfg))/.test(target)))) direct.add(current);
  };
  for (const line of text.split(/\r?\n/)) {
    const requirement = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:==|>=|<=|~=|!=|@|;|$)/.exec(line);
    if (requirement) { flush(); current = normalizePipName(requirement[1]); via = []; continue; }
    const comment = /^\s+#\s+(?:via\s+)?(.+?)\s*$/.exec(line);
    if (current && comment && comment[1] !== "via") via.push(comment[1]);
  }
  flush();
  return direct;
}

/** pyproject.toml without the tables and arrays that list dependencies. */
function withoutDependencyTables(text: string): string {
  const out: string[] = [];
  let skipTable = false, skipArray = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) skipTable = /^(?:project\.optional-dependencies|dependency-groups|tool\.poetry\.(?:group\.[^.]+\.|dev-)?dependencies|build-system)$/.test(header[1]);
    if (skipTable) continue;
    if (skipArray) { if (/^\s*\]/.test(line)) skipArray = false; continue; }
    if (/^\s*dependencies\s*=\s*\[/.test(line)) { skipArray = !/\]\s*$/.test(line); continue; }
    out.push(line);
  }
  return out.join("\n");
}

/** [tool.poetry.dependencies] and [tool.poetry.group.*.dependencies] names (python itself excluded). */
function poetryDependencies(text: string): DeclaredDependency[] {
  const deps: DeclaredDependency[] = [];
  let scope: DeclaredDependency["scope"] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      scope = header[1] === "tool.poetry.dependencies" ? "production" : /^tool\.poetry\.(?:group\.[^.]+\.|dev-)dependencies$/.test(header[1]) ? "development" : undefined;
      continue;
    }
    const entry = scope && /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
    if (entry && entry[1].toLowerCase() !== "python") deps.push({ name: normalizePipName(entry[1]), displayName: entry[1], spec: "", scope: scope!, source: "pyproject.toml", registry: true });
  }
  return deps;
}

// ---------------------------------------------------------------------------
// pub (Dart / Flutter)
// ---------------------------------------------------------------------------

/** Dev tools and assets packages that work without an import. */
const PUB_IMPLICIT = new Set(["build_runner", "flutter_lints", "lints", "very_good_analysis", "pedantic", "flutter_launcher_icons", "flutter_native_splash", "json_serializable", "freezed", "retrofit_generator", "hive_generator", "build_verify", "dependency_validator", "flutter_driver", "integration_test", "melos"]);

export function pubDependencies(pubspec: string): Array<{ name: string; section: "dependencies" | "dev_dependencies"; sdk: boolean }> {
  const out: Array<{ name: string; section: "dependencies" | "dev_dependencies"; sdk: boolean }> = [];
  let section: "dependencies" | "dev_dependencies" | undefined;
  let current: { name: string; section: "dependencies" | "dev_dependencies"; sdk: boolean } | undefined;
  for (const raw of pubspec.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z_][\w]*)\s*:/.exec(line);
    if (top) { section = top[1] === "dependencies" || top[1] === "dev_dependencies" ? top[1] : undefined; current = undefined; continue; }
    if (!section) continue;
    const entry = /^ {2}([A-Za-z_][\w]*)\s*:/.exec(line);
    if (entry) { current = { name: entry[1], section, sdk: false }; out.push(current); continue; }
    if (current && /^\s{4,}sdk\s*:/.test(line)) current.sdk = true;
  }
  return out;
}

async function scanPub(ws: Workspace, manifest: string, includeDev: boolean): Promise<ProjectScan | undefined> {
  const text = await ws.readFile(manifest);
  if (text === undefined) return undefined;
  const dir = dirOf(manifest);
  const declared = pubDependencies(text).filter(dep => !dep.sdk && (includeDev || dep.section === "dependencies"));
  if (!declared.length) return undefined;
  const sourceFiles = await sourcesUnder(ws, dir, "*.dart");
  const sources = (await readAll(ws, sourceFiles)).join("\n");
  const configText = (await readAll(ws, (await ws.findFiles(join(dir, "{analysis_options.yaml,build.yaml,*.yaml,dart_test.yaml}"), 50)).filter(file => file !== manifest))).join("\n");
  // Top-level pubspec keys (flutter_launcher_icons:, flutter_native_splash:) configure tools by name.
  const topKeys = new Set([...text.matchAll(/^([A-Za-z_]\w*)\s*:/gm)].map(m => m[1]));
  const unused: UnusedDependency[] = [];
  for (const dep of declared) {
    if (sources.includes(`package:${dep.name}/`) || configText.includes(`package:${dep.name}/`) || topKeys.has(dep.name) || PUB_IMPLICIT.has(dep.name) || dep.name.endsWith("_generator") || dep.name.endsWith("_lints")) continue;
    if (dep.name === "cupertino_icons") {
      if (sources.includes("CupertinoIcons.")) continue;
      unused.push({ name: dep.name, section: dep.section, reason: "Only needed for CupertinoIcons, which no file uses (new Flutter projects include it by default)." });
      continue;
    }
    unused.push({ name: dep.name, section: dep.section, reason: `No file imports package:${dep.name}/ (${sourceFiles.length} Dart file${sourceFiles.length === 1 ? "" : "s"} checked).` });
  }
  const flutter = /^\s{2}flutter\s*:\s*\n\s{4}sdk\s*:\s*flutter/m.test(text);
  return {
    ecosystem: "pub", dir, manifest, checked: declared.length, sourceFiles: sourceFiles.length, unused, notes: [],
    removeCommand: unused.length ? `${flutter ? "flutter" : "dart"} pub remove ${unused.map(u => u.name).join(" ")}` : undefined
  };
}
