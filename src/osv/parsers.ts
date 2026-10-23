import * as path from "path";
import { parse as parseYaml } from "yaml";
import {
  DeclaredDependency, isDevRequirementsFile, normalizePipName, parseCentralPackageVersions, parseCsproj,
  parseGradle, parsePackageJson, parsePep508, parsePom, parseProperties, parsePubspec, parseRequirements,
  parseVersionCatalog
} from "../services/dependency-manager";
import { parseXml } from "../toolkits/engines/xml-parse";
import { comparatorFor, declaredSpans, spanContains } from "./versions";
import { asString, asTable, asTables, lineOf, parseToml, TomlTable } from "./toml";
import type { DependencyScope, FileKind, OsvEcosystem, PackageManager, ParsedDependency, ParsedFile } from "./types";

/**
 * Readers for every dependency file the OSV scanner understands.
 *
 * Each parser turns one file's text into `ParsedDependency` entries and never
 * guesses: a version is only reported when the file states it reliably, a
 * lockfile's exact version is preferred over a manifest's range, and anything
 * from git, a path or a private source is reported with a note instead of
 * being matched against the public registry. Nothing here touches VS Code,
 * the file system or the network.
 */

export interface FileType {
  id: string;
  ecosystem: OsvEcosystem;
  kind: FileKind;
  manager: PackageManager;
}

/** Files read for context (versions, properties) but not scanned on their own. */
export const AUXILIARY_FILES = ["Directory.Packages.props", "gradle.properties", "settings.gradle", "settings.gradle.kts"];

/** Glob of every file the scanner reads, for `findFiles`. */
export const DEPENDENCY_FILE_GLOB = "**/{" + [
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
  "requirements*.txt", "*-requirements.txt", "*_requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock", "uv.lock", "pdm.lock", "pyproject.toml",
  "conda-lock.yml", "conda-lock.yaml", "*.conda-lock.yml", "environment.yml", "environment.yaml",
  "pom.xml", "build.gradle", "build.gradle.kts", "gradle.lockfile", "libs.versions.toml", "*.versions.toml", "*.lockfile",
  "go.mod", "Cargo.lock", "Cargo.toml", "Gemfile", "Gemfile.lock", "gems.rb", "gems.locked",
  "packages.lock.json", "project.assets.json", "*.csproj", "*.fsproj", "*.vbproj", "packages.config",
  "composer.json", "composer.lock", "pubspec.yaml", "pubspec.lock", "mix.lock", "Package.resolved", "Package.swift", "renv.lock",
  ...AUXILIARY_FILES
].join(",") + "}";

/** What the scanner reads, per ecosystem, for the empty state and the docs. */
export const SUPPORTED_FILE_NAMES: Array<{ ecosystem: OsvEcosystem; files: string[] }> = [
  { ecosystem: "npm", files: ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "package.json"] },
  { ecosystem: "PyPI", files: ["poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock", "conda-lock.yml (pip packages)", "requirements*.txt (and -r includes)", "pyproject.toml", "Pipfile", "environment.yml (pip section)"] },
  { ecosystem: "Maven", files: ["pom.xml (resolved with Maven or the built-in resolver)", "build.gradle(.kts) (resolved with Gradle when allowed)", "gradle.lockfile", "libs.versions.toml"] },
  { ecosystem: "Go", files: ["go.mod"] },
  { ecosystem: "crates.io", files: ["Cargo.lock", "Cargo.toml"] },
  { ecosystem: "RubyGems", files: ["Gemfile.lock", "gems.locked", "Gemfile"] },
  { ecosystem: "NuGet", files: ["packages.lock.json", "obj/project.assets.json", "*.csproj / *.fsproj / *.vbproj", "packages.config"] },
  { ecosystem: "Packagist", files: ["composer.lock", "composer.json"] },
  { ecosystem: "Pub", files: ["pubspec.lock", "pubspec.yaml"] },
  { ecosystem: "Hex", files: ["mix.lock"] },
  { ecosystem: "SwiftURL", files: ["Package.resolved", "Package.swift"] },
  { ecosystem: "CRAN", files: ["renv.lock"] }
];

/** Recognises a dependency file by its path; undefined for anything else. */
export function detectFileType(filePath: string): FileType | undefined {
  const posix = filePath.replace(/\\/g, "/");
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  const parent = path.posix.basename(path.posix.dirname(posix));
  const adapter = FILE_ADAPTERS.find(a => a.matches(base, base.toLowerCase(), parent));
  return adapter ? typeOf(adapter) : undefined;
}

/** The type for an adapter id, for files recognised by content rather than name (a `-r` include). */
export function fileTypeById(id: string): FileType | undefined {
  const adapter = FILE_ADAPTERS.find(a => a.id === id);
  return adapter ? typeOf(adapter) : undefined;
}

function typeOf(adapter: FileAdapter): FileType {
  return { id: adapter.id, ecosystem: adapter.ecosystem, kind: adapter.kind, manager: adapter.manager };
}

/**
 * The directory a file's project lives in: where its commands run and which
 * manifests it shares a lockfile with. Most files sit in the project root;
 * these do not.
 */
export function projectDirOf(filePath: string, type: FileType): string {
  const dir = path.posix.dirname(filePath.replace(/\\/g, "/"));
  const up = (d: string, n: number) => { let out = d; for (let i = 0; i < n; i++) out = path.posix.dirname(out); return out; };
  let result = dir;
  if (type.id === "nuget-assets") result = up(dir, 1);
  else if (type.id === "gradle-catalog" && path.posix.basename(dir) === "gradle") result = up(dir, 1);
  else if (type.id === "gradle-lock" && path.posix.basename(dir) === "dependency-locks") result = up(dir, 2);
  else if (type.id === "swift-resolved") {
    // Xcode keeps it under *.xcodeproj/project.xcworkspace/xcshareddata/swiftpm or *.xcworkspace/xcshareddata/swiftpm.
    const marker = /\/?[^/]+\.xc(?:odeproj|workspace)\/.*$/.exec(dir);
    if (marker) result = dir.slice(0, marker.index);
  }
  return result === "." ? "" : result;
}

/** Text of related files near the one being parsed (central package versions, parent POMs, Gradle properties). */
export interface ParseContext {
  /** Texts of files with `name` in `dir` and its ancestors, nearest first. */
  ancestors(name: string, dir: string): string[];
  /** Text of another scanned or context file by its path (pip constraint files), when it was read. */
  read?(file: string): string | undefined;
}

const NO_CONTEXT: ParseContext = { ancestors: () => [] };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Maps byte offsets to 1-based line numbers without rescanning the text. */
class Lines {
  private readonly starts: number[] = [0];
  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  at(offset: number): number {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }
  /** Line of the first occurrence of any needle, or undefined. */
  find(...needles: string[]): number | undefined {
    for (const needle of needles) {
      const index = this.text.indexOf(needle);
      if (index >= 0) return this.at(index);
    }
    return undefined;
  }
  /** Line of the first match of a regular expression. */
  match(pattern: RegExp): number | undefined {
    const found = pattern.exec(this.text);
    return found ? this.at(found.index) : undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function result(file: string, type: FileType, dependencies: ParsedDependency[], warnings: string[] = [], error?: string): ParsedFile {
  return { path: file, ecosystem: type.ecosystem, kind: type.kind, manager: type.manager, dependencies, warnings, ...(error ? { error } : {}) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON with comments and trailing commas (bun.lock), read without evaluating anything. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i += 2; continue; }
      if (ch === "\"") inString = false;
      i++;
      continue;
    }
    if (ch === "\"") { inString = true; out += ch; i++; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") { i++; continue; }
    }
    out += ch;
    i++;
  }
  return JSON.parse(out);
}

const SEMVER_EXACT = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// npm, Yarn, pnpm, Bun
// ---------------------------------------------------------------------------

function npmScope(entry: { dev?: boolean; optional?: boolean; devOptional?: boolean; peer?: boolean }): DependencyScope {
  if (entry.dev) return "development";
  if (entry.peer) return "peer";
  if (entry.optional || entry.devOptional) return "optional";
  return "production";
}

function nonRegistryResolved(resolved: unknown): boolean {
  return typeof resolved === "string" && !/^https?:\/\//i.test(resolved);
}

function parseNpmLock(file: string, text: string, type: FileType): ParsedFile {
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  const warnings: string[] = [];
  const packages = asRecord(json.packages);
  if (packages) {
    // lockfileVersion 2 and 3: a flat map of install paths.
    const root = asRecord(packages[""]) ?? {};
    const direct = new Set<string>();
    const collectDirect = (entry: Record<string, unknown>) => {
      for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        for (const name of Object.keys(asRecord(entry[key]) ?? {})) direct.add(name);
      }
    };
    collectDirect(root);
    const members = [""];
    for (const [installPath, raw] of Object.entries(packages)) {
      const entry = asRecord(raw);
      if (!entry || installPath === "") continue;
      const marker = installPath.lastIndexOf("node_modules/");
      if (marker < 0) { collectDirect(entry); members.push(installPath.replace(/\/+$/, "")); continue; } // a workspace member's own folder
    }
    for (const [installPath, raw] of Object.entries(packages)) {
      const entry = asRecord(raw);
      if (!entry || installPath === "") continue;
      const marker = installPath.lastIndexOf("node_modules/");
      if (marker < 0 || entry.link === true) continue; // workspace folders and their symlinks
      const name = typeof entry.name === "string" ? entry.name : installPath.slice(marker + "node_modules/".length);
      const version = typeof entry.version === "string" ? entry.version : undefined;
      const topLevel = !installPath.slice(0, marker).includes("node_modules/");
      const line = lines.find(`"${installPath}": {`);
      const base = { name, scope: npmScope(entry as never), direct: topLevel && direct.has(name) ? true : topLevel ? undefined : false, line, installPath };
      if (entry.inBundle === true && !version) continue;
      if (!version) {
        deps.push({ ...base, resolution: "lockfile", registry: false, note: "The lockfile records no version for this package." });
      } else if (nonRegistryResolved(entry.resolved)) {
        deps.push({ ...base, version, resolution: "lockfile", registry: false, note: `Installed from ${String(entry.resolved).split(/[#?]/)[0]}, not the npm registry, so registry advisories may not apply.` });
      } else {
        deps.push({ ...base, version, resolution: "lockfile" });
      }
    }
    // Dependency paths: walk the lockfile's edges from the root and workspace members the way Node resolves
    // them (nearest node_modules first, then each ancestor), keeping the shortest path to every install.
    const edgesOf = (entry: Record<string, unknown> | undefined) =>
      ["dependencies", "optionalDependencies", "peerDependencies"].flatMap(key => Object.keys(asRecord(entry?.[key]) ?? {}));
    const resolveFrom = (from: string, name: string): string | undefined => {
      let base = from;
      for (let hops = 0; hops < 64; hops++) {
        const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
        const found = asRecord(packages[candidate]);
        if (found) return found.link === true && typeof found.resolved === "string" ? found.resolved : candidate;
        if (!base) return undefined;
        const marker = base.lastIndexOf("node_modules/");
        base = marker < 0 ? "" : base.slice(0, marker).replace(/\/+$/, "");
      }
      return undefined;
    };
    const parentOf = new Map<string, string>();
    const queue = [...members];
    const seen = new Set(members);
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i];
      for (const name of edgesOf(asRecord(packages[from]))) {
        const to = resolveFrom(from, name);
        if (!to || seen.has(to)) continue;
        seen.add(to);
        parentOf.set(to, from);
        queue.push(to);
      }
    }
    const label = (installPath: string) => {
      const entry = asRecord(packages[installPath]) ?? {};
      const marker = installPath.lastIndexOf("node_modules/");
      const name = typeof entry.name === "string" ? entry.name : installPath.slice(marker + "node_modules/".length);
      return typeof entry.version === "string" ? `${name}@${entry.version}` : name;
    };
    const memberSet = new Set(members);
    const viaFor = (installPath: string): string[] | undefined => {
      const chain: string[] = [];
      let at = parentOf.get(installPath);
      while (at !== undefined && !memberSet.has(at) && chain.length < 16) { chain.unshift(label(at)); at = parentOf.get(at); }
      return chain.length ? chain : undefined;
    };
    for (const dep of deps) {
      const installPath = (dep as ParsedDependency & { installPath?: string }).installPath;
      if (installPath === undefined) continue;
      const via = viaFor(installPath);
      if (via) dep.via = via;
      delete (dep as ParsedDependency & { installPath?: string }).installPath;
    }
    // Linked packages (workspace members, file: dependencies) are this workspace's own code.
    const localPackages = Object.entries(packages)
      .filter(([installPath, raw]) => installPath.includes("node_modules/") && asRecord(raw)?.link === true)
      .map(([installPath]) => installPath.slice(installPath.lastIndexOf("node_modules/") + "node_modules/".length));
    for (const member of members) { const own = asRecord(packages[member])?.name; if (member && typeof own === "string") localPackages.push(own); }
    return { ...result(file, type, deps, warnings), members, localPackages: [...new Set(localPackages)] };
  }
  const legacy = asRecord(json.dependencies);
  if (legacy) {
    // lockfileVersion 1: nested `dependencies`; it does not record which are direct.
    const walk = (tree: Record<string, unknown>, depth: number) => {
      for (const [name, raw] of Object.entries(tree)) {
        const entry = asRecord(raw);
        if (!entry) continue;
        const version = typeof entry.version === "string" ? entry.version : undefined;
        const line = lines.match(new RegExp(`"${escapeRegExp(name)}": \\{\\s*\\n\\s*"version": "${escapeRegExp(version ?? "")}"`));
        const base = { name, scope: npmScope(entry as never), direct: depth > 0 ? false : undefined, line };
        if (!version || /^(?:file|link|git\+|github:|https?:)/.test(version) || version.includes("/")) {
          deps.push({ ...base, resolution: "lockfile", registry: false, note: "Installed from git, a URL or a local path, so registry advisories may not apply." });
        } else if (nonRegistryResolved(entry.resolved)) {
          deps.push({ ...base, version, resolution: "lockfile", registry: false, note: "Installed from outside the npm registry, so registry advisories may not apply." });
        } else {
          deps.push({ ...base, version, resolution: "lockfile" });
        }
        const nested = asRecord(entry.dependencies);
        if (nested) walk(nested, depth + 1);
      }
    };
    walk(legacy, 0);
    return result(file, type, deps, warnings);
  }
  return result(file, type, [], ["The lockfile lists no packages."]);
}

/** `name@range` (with a scoped name) → name. */
function npmNameOf(descriptor: string): string {
  const at = descriptor.indexOf("@", descriptor.startsWith("@") ? 1 : 0);
  return at < 0 ? descriptor : descriptor.slice(0, at);
}

function parseYarnLock(file: string, text: string, type: FileType): ParsedFile {
  const berry = /^__metadata:/m.test(text);
  const lines = text.split(/\r?\n/);
  const deps: ParsedDependency[] = [];
  const seen = new Set<string>();
  let header: { descriptors: string[]; line: number } | undefined;
  const members = new Set<string>([""]);
  let version: string | undefined;
  let resolution: string | undefined;
  let resolved: string | undefined;

  const flush = () => {
    if (!header) return;
    const first = header.descriptors[0];
    let name = npmNameOf(first);
    let range = first.slice(name.length + 1);
    let registry = true;
    let note: string | undefined;
    if (berry) {
      if (resolution) {
        name = npmNameOf(resolution);
        const protocol = resolution.slice(name.length + 1);
        if (protocol.startsWith("patch:")) {
          // `lodash@patch:lodash@npm%3A4.17.21#...` patches a registry package; advisories for it still apply.
          note = "A local patch is applied to this package; check whether it addresses the advisory.";
        } else if (!protocol.startsWith("npm:")) {
          registry = false;
          note = `Resolved through "${protocol.split(":")[0]}:", not the npm registry.`;
        }
      }
      const workspace = /@workspace:(.+)$/.exec(resolution ?? first);
      if (workspace) members.add(workspace[1] === "." ? "" : workspace[1].replace(/^\.\//, ""));
      if (/@(?:workspace|portal|link):/.test(first) && !resolution?.includes("@npm:")) { header = undefined; version = resolution = resolved = undefined; return; }
    } else {
      // Yarn 1 aliases look like `alias@npm:real@^1.0.0`.
      const alias = /^npm:(.+)$/.exec(range);
      if (alias) { name = npmNameOf(alias[1]); range = alias[1].slice(name.length + 1); }
      // A private registry mirror still serves registry packages; git hosts and local files do not.
      if (/^(?:file|link|git|git\+\w+|github|gitlab|bitbucket|https?):|\//.test(range) || (resolved && (!/^https?:\/\//.test(resolved) || /^https?:\/\/(?:codeload\.)?github\.com\//.test(resolved)))) {
        registry = false;
        note = "Installed from git, a URL or a local path, so registry advisories may not apply.";
      }
    }
    if (version) {
      const key = `${name}@${version}`;
      if (!seen.has(key)) {
        seen.add(key);
        deps.push({ name, version, resolution: "lockfile", scope: "production", line: header.line, ...(registry ? {} : { registry: false }), ...(note ? { note } : {}) });
      }
    }
    header = undefined;
    version = resolution = resolved = undefined;
  };

  lines.forEach((raw, index) => {
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    if (!/^\s/.test(raw)) {
      flush();
      if (raw.startsWith("__metadata")) return;
      const descriptors = raw.replace(/:\s*$/, "").split(/,\s*/).map(part => part.trim().replace(/^"|"$/g, ""));
      header = { descriptors, line: index + 1 };
      return;
    }
    if (!header) return;
    const field = /^\s{2}(\w+):?\s+"?([^"]*)"?\s*$/.exec(raw);
    if (!field) return;
    if (field[1] === "version") version = field[2];
    else if (field[1] === "resolution") resolution = field[2];
    else if (field[1] === "resolved") resolved = field[2];
  });
  flush();
  // Yarn 1 does not record its workspaces; Berry does.
  return berry ? { ...result(file, type, deps), members: [...members] } : result(file, type, deps);
}

/** pnpm package keys across lockfile versions 5 to 9: `/name/1.0.0_peer`, `/name@1.0.0(peer)`, `name@1.0.0`. */
export function parsePnpmKey(key: string): { name: string; version: string } | undefined {
  const k = key.replace(/^\//, "").replace(/\(.*$/, ""); // v6+ peer suffix
  // v6 and v9: name@version. The name is unscoped (no "/") or scoped (exactly one "/").
  const at = k.indexOf("@", k.startsWith("@") ? 1 : 0);
  if (at > 0) {
    const name = k.slice(0, at);
    const version = k.slice(at + 1);
    const slashes = name.split("/").length - 1;
    if (version && (name.startsWith("@") ? slashes === 1 : slashes === 0)) return { name, version };
  }
  // v5: name/version_peerhash (peers are encoded with "+", never "/").
  const slash = k.lastIndexOf("/");
  if (slash <= 0) return undefined;
  const name = k.slice(0, slash);
  const version = k.slice(slash + 1).replace(/_.*$/, "");
  return name && version ? { name, version } : undefined;
}

function parsePnpmLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try {
    doc = asRecord(parseYaml(text, { maxAliasCount: -1 })) ?? {};
  } catch (error) {
    return result(file, type, [], [], `Not valid YAML: ${errorText(error)}`);
  }
  const lines = new Lines(text);
  const directScope = new Map<string, DependencyScope>();
  const collect = (section: Record<string, unknown> | undefined) => {
    if (!section) return;
    for (const [key, scope] of [["dependencies", "production"], ["devDependencies", "development"], ["optionalDependencies", "optional"]] as Array<[string, DependencyScope]>) {
      for (const name of Object.keys(asRecord(section[key]) ?? {})) if (!directScope.has(name) || scope === "production") directScope.set(name, scope);
    }
  };
  collect(doc);
  for (const importer of Object.values(asRecord(doc.importers) ?? {})) collect(asRecord(importer));
  const importers = Object.keys(asRecord(doc.importers) ?? {});
  const members = importers.length ? importers.map(k => (k === "." ? "" : k.replace(/^\.\//, ""))) : [""];
  const deps: ParsedDependency[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(asRecord(doc.packages) ?? {})) {
    const entry = asRecord(raw) ?? {};
    const parsed = parsePnpmKey(key);
    const line = lines.find(`\n  ${key}:`, `\n  '${key}':`, `\n  "${key}":`);
    const resolutionInfo = asRecord(entry.resolution) ?? {};
    const name = typeof entry.name === "string" ? entry.name : parsed?.name;
    const version = typeof entry.version === "string" ? entry.version : parsed?.version;
    if (!name) continue;
    const dev = entry.dev === true ? "development" : entry.optional === true ? "optional" : undefined;
    const scope = dev ?? directScope.get(name) ?? "production";
    const direct = directScope.has(name) ? undefined : false;
    if (!version || !SEMVER_EXACT.test(version) || resolutionInfo.tarball !== undefined && !/registry/.test(String(resolutionInfo.tarball)) || resolutionInfo.type === "git" || resolutionInfo.type === "directory" || /^(?:file|link):/.test(key)) {
      deps.push({ name, resolution: "lockfile", scope, direct, line, registry: false, note: "Installed from git, a tarball URL or a local path, so registry advisories may not apply." });
      continue;
    }
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    deps.push({ name, version, resolution: "lockfile", scope, direct, line });
  }
  // Importer dependencies on `link:` versions are workspace packages.
  const localPackages: string[] = [];
  for (const importer of Object.values(asRecord(doc.importers) ?? {})) {
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, raw] of Object.entries(asRecord(asRecord(importer)?.[key]) ?? {})) {
        const version = typeof raw === "string" ? raw : asRecord(raw)?.version;
        if (typeof version === "string" && /^(?:link|workspace|file):/.test(version)) localPackages.push(name);
      }
    }
  }
  return { ...result(file, type, deps), members, ...(localPackages.length ? { localPackages: [...new Set(localPackages)] } : {}) };
}

function parseBunLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(parseJsonc(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const direct = new Map<string, DependencyScope>();
  for (const workspace of Object.values(asRecord(doc.workspaces) ?? {})) {
    const ws = asRecord(workspace) ?? {};
    for (const [key, scope] of [["dependencies", "production"], ["devDependencies", "development"], ["optionalDependencies", "optional"], ["peerDependencies", "peer"]] as Array<[string, DependencyScope]>) {
      for (const name of Object.keys(asRecord(ws[key]) ?? {})) if (!direct.has(name)) direct.set(name, scope);
    }
  }
  const members = Object.keys(asRecord(doc.workspaces) ?? { "": {} });
  const deps: ParsedDependency[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(asRecord(doc.packages) ?? {})) {
    if (!Array.isArray(raw) || typeof raw[0] !== "string") continue;
    const descriptor = raw[0];
    const name = npmNameOf(descriptor);
    const version = descriptor.slice(name.length + 1);
    const line = lines.find(`"${key}": [`);
    const scope = direct.get(name) ?? "production";
    if (!SEMVER_EXACT.test(version)) {
      if (/^workspace:/.test(version)) continue;
      deps.push({ name, resolution: "lockfile", scope, line, registry: false, note: `Resolved as "${version}", not a registry version.` });
      continue;
    }
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    deps.push({ name, version, resolution: "lockfile", scope, line });
  }
  return { ...result(file, type, deps), members };
}

function fromDeclared(declared: DeclaredDependency[], lines: Lines, exact: (spec: string) => string | undefined, nameOf: (d: DeclaredDependency) => string = d => d.name,
  lineNeedle: (d: DeclaredDependency) => RegExp = d => new RegExp(`["']?${escapeRegExp(d.displayName)}["']?\\s*[:=]`, "i")): ParsedDependency[] {
  return declared.map(d => {
    const line = lines.match(lineNeedle(d));
    const base = { name: nameOf(d), spec: d.spec, scope: d.scope, direct: true, line };
    if (!d.registry) return { ...base, resolution: "range" as const, registry: false, note: d.note };
    const version = exact(d.spec);
    return version ? { ...base, version, resolution: "pinned" as const } : { ...base, resolution: "range" as const, ...(d.note ? { note: d.note } : {}) };
  });
}

function parseNpmManifest(file: string, text: string, type: FileType): ParsedFile {
  const parsed = parsePackageJson(text, file);
  if (parsed.error) return result(file, type, [], [], parsed.error);
  const lines = new Lines(text);
  // An alias is checked as the registry package it installs (OSV knows lodash, not "old-lodash").
  const declared = parsed.dependencies.map(d => (d.alias ? { ...d, name: d.alias.name, spec: d.alias.spec, registry: true, note: undefined } : d));
  const deps = fromDeclared(declared, lines, spec => {
    const exact = spec.replace(/^=/, "").trim();
    return SEMVER_EXACT.test(exact) ? exact.replace(/^v/, "") : undefined;
  }, d => d.name, d => new RegExp(`"${escapeRegExp(d.displayName)}"\\s*:`));
  return { ...result(file, type, deps), ...(parsed.name ? { selfName: parsed.name } : {}) };
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** A single `==`/`===` clause pins an exact version (wildcards do not). */
function exactPep440(spec: string): string | undefined {
  const match = /^===?([^,*;\s]+)$/.exec(spec.replace(/\s+/g, ""));
  return match ? match[1] : undefined;
}

function pythonLine(lines: Lines, display: string): RegExp {
  const flexible = display.split(/[-_.]+/).map(escapeRegExp).join("[-_.]+");
  // A lookbehind, so the match starts at the name itself and the line number is the name's line.
  return new RegExp(`(?<![\\w.-])${flexible}(?=\\s*[\\[<>=!~;@"',\\s\\]]|$)`, "im");
}

function parseRequirementsFile(file: string, text: string, type: FileType, context: ParseContext = NO_CONTEXT): ParsedFile {
  const scope: DependencyScope = isDevRequirementsFile(file) ? "development" : "production";
  const declared = parseRequirements(text, file, scope);
  const lines = new Lines(text);
  const warnings: string[] = [];
  if (/^\s*(?:-r|--requirement)[\s=]+\S+/m.test(text)) warnings.push("Includes other requirement files (-r); each is scanned as well when it is in the workspace.");
  if (/^\s*-e\s+/m.test(text)) warnings.push("Editable (-e) installs are local or VCS sources and are not checked.");
  const deps = fromDeclared(declared, lines, exactPep440, d => d.name, d => pythonLine(lines, d.displayName));
  // pip -c constraint files pin the versions of what this file installs: a range with an exact constraint is that version.
  const pins = new Map<string, { version: string; from: string }>();
  for (const match of text.matchAll(/^\s*(?:-c|--constraint)(?:\s+|=)(\S+)/gm)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    const constraints = context.read?.(target);
    if (constraints === undefined) { warnings.push(`The constraints file ${match[1]} is not in the workspace, so the versions it pins are not known.`); continue; }
    for (const c of parseRequirements(constraints, target, scope)) {
      const exact = c.registry ? exactPep440(c.spec) : undefined;
      if (exact) pins.set(c.name, { version: exact, from: target });
    }
  }
  for (const dep of deps) {
    const pin = dep.version || dep.registry === false ? undefined : pins.get(normalizePipName(dep.name));
    if (!pin) continue;
    const spans = declaredSpans("PyPI", dep.spec);
    if (spans && !spans.some(span => spanContains(span, pin.version, comparatorFor("PyPI")))) {
      warnings.push(`${dep.name}: ${pin.from} pins ${pin.version}, which "${dep.spec}" does not allow; pip would refuse to install it.`);
      continue;
    }
    dep.version = pin.version;
    dep.resolution = "pinned";
    dep.note = `Pinned to ${pin.version} by ${pin.from}.`;
  }
  return result(file, type, deps, warnings);
}

function parsePipfileLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const [section, scope] of [["default", "production"], ["develop", "development"]] as Array<[string, DependencyScope]>) {
    for (const [name, raw] of Object.entries(asRecord(doc[section]) ?? {})) {
      const entry = asRecord(raw) ?? {};
      const line = lines.find(`"${name}": {`);
      const version = typeof entry.version === "string" ? exactPep440(entry.version) : undefined;
      if (entry.git || entry.path || entry.file || entry.editable) {
        deps.push({ name: normalizePipName(name), resolution: "lockfile", scope, line, registry: false, note: "Installed from git, a URL or a local path, so PyPI advisories may not apply." });
      } else if (!version) {
        deps.push({ name: normalizePipName(name), resolution: "lockfile", scope, line, registry: false, note: "The lockfile records no exact version for this package." });
      } else {
        deps.push({ name: normalizePipName(name), version, resolution: "lockfile", scope, line });
      }
    }
  }
  return result(file, type, deps);
}

/** poetry.lock, uv.lock and pdm.lock all list `[[package]]` tables with name and version. */
function parsePythonTomlLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: TomlTable;
  try { doc = parseToml(text); } catch (error) { return result(file, type, [], [], `Not valid TOML: ${errorText(error)}`); }
  const deps: ParsedDependency[] = [];
  for (const pkg of asTables(doc.package)) {
    const name = asString(pkg.name);
    const version = asString(pkg.version);
    if (!name) continue;
    const line = lineOf(pkg);
    const source = asTable(pkg.source);
    // Poetry < 1.5 marks dev packages with category; PDM lists groups.
    const groups = Array.isArray(pkg.groups) ? pkg.groups.map(String) : [];
    // PDM names the production group "default", Poetry 2 names it "main".
    const scope: DependencyScope = pkg.category === "dev" || (groups.length > 0 && !groups.includes("default") && !groups.includes("main")) ? "development" : pkg.optional === true ? "optional" : "production";
    let note: string | undefined;
    if (type.id === "uv-lock" && source) {
      if (source.editable !== undefined || source.virtual !== undefined) continue; // the project itself or a workspace member
      if (source.registry === undefined) note = "Installed from git, a URL or a local path, so PyPI advisories may not apply.";
    } else if (type.id === "poetry-lock" && source) {
      const kind = asString(source.type);
      if (kind && kind !== "legacy") note = `Installed from a ${kind} source, so PyPI advisories may not apply.`;
    } else if (type.id === "pdm-lock" && (pkg.git !== undefined || pkg.path !== undefined || pkg.url !== undefined || pkg.editable === true)) {
      note = "Installed from git, a URL or a local path, so PyPI advisories may not apply.";
    }
    if (!version || note) {
      deps.push({ name: normalizePipName(name), resolution: "lockfile", scope, line, registry: false, note: note ?? "The lockfile records no version for this package." });
      continue;
    }
    deps.push({ name: normalizePipName(name), version, resolution: "lockfile", scope, line });
  }
  return result(file, type, deps);
}

/** Poetry's caret and tilde requirements as PEP 440 specifiers, so their ranges can be compared. */
export function poetryToPep440(spec: string): string {
  return spec.split(",").map(part => part.trim()).filter(Boolean).map(part => {
    const caret = /^\^\s*(\d+(?:\.\d+)*)$/.exec(part);
    if (caret) {
      const nums = caret[1].split(".").map(Number);
      const index = nums.findIndex(n => n !== 0);
      const bumpAt = index < 0 ? nums.length - 1 : Math.min(index, nums.length - 1);
      const upper = nums.slice(0, bumpAt + 1);
      upper[bumpAt] += 1;
      return `>=${caret[1]},<${upper.join(".")}`;
    }
    const tilde = /^~\s*(\d+(?:\.\d+)*)$/.exec(part);
    if (tilde) {
      const nums = tilde[1].split(".").map(Number);
      const upper = nums.length > 1 ? [nums[0], nums[1] + 1] : [nums[0] + 1];
      return `>=${tilde[1]},<${upper.join(".")}`;
    }
    if (/^\d/.test(part)) return part.includes("*") ? `==${part}` : `==${part}`;
    if (part === "*") return "";
    return part.replace(/\s+/g, "");
  }).filter(Boolean).join(",");
}

function poetryDeps(table: TomlTable | undefined, scope: DependencyScope, file: string, lines: Lines): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  for (const [rawName, value] of Object.entries(table ?? {})) {
    if (rawName.toLowerCase() === "python") continue;
    const line = lines.match(pythonLine(lines, rawName));
    const entry = asTable(value);
    const spec = typeof value === "string" ? value : asString(entry?.version);
    const name = normalizePipName(rawName);
    if (entry && (entry.git !== undefined || entry.path !== undefined || entry.url !== undefined)) {
      deps.push({ name, resolution: "range", scope, direct: true, line, registry: false, note: "Installed from git, a URL or a local path, so PyPI advisories may not apply." });
      continue;
    }
    const pep = poetryToPep440(spec ?? "*");
    const version = exactPep440(pep);
    deps.push(version
      ? { name, version, spec, resolution: "pinned", scope: entry?.optional === true ? "optional" : scope, direct: true, line }
      : { name, spec: pep || "*", resolution: "range", scope: entry?.optional === true ? "optional" : scope, direct: true, line });
    void file;
  }
  return deps;
}

function parsePyprojectFile(file: string, text: string, type: FileType): ParsedFile {
  let doc: TomlTable;
  try { doc = parseToml(text); } catch (error) { return result(file, type, [], [], `Not valid TOML: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  const pep508 = (values: unknown, scope: DependencyScope) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      if (typeof value !== "string") continue;
      const requirement = parsePep508(value);
      if (!requirement) continue;
      const line = lines.match(pythonLine(lines, requirement.name));
      const name = normalizePipName(requirement.name);
      if (requirement.direct) { deps.push({ name, resolution: "range", scope, direct: true, line, registry: false, note: "Installed from a direct URL, so PyPI advisories may not apply." }); continue; }
      const version = exactPep440(requirement.spec);
      deps.push(version ? { name, version, spec: requirement.spec, resolution: "pinned", scope, direct: true, line } : { name, spec: requirement.spec || "*", resolution: "range", scope, direct: true, line });
    }
  };
  const project = asTable(doc.project);
  pep508(project?.dependencies, "production");
  for (const [group, values] of Object.entries(asTable(project?.["optional-dependencies"]) ?? {})) {
    pep508(values, /^(dev|test|tests|lint|docs?|typing)$/i.test(group) ? "development" : "optional");
  }
  for (const values of Object.values(asTable(doc["dependency-groups"]) ?? {})) pep508(values, "development");
  const tool = asTable(doc.tool);
  pep508(asTable(tool?.uv)?.["dev-dependencies"], "development");
  for (const values of Object.values(asTable(asTable(tool?.pdm)?.["dev-dependencies"]) ?? {})) pep508(values, "development");
  const poetry = asTable(tool?.poetry);
  if (poetry) {
    deps.push(...poetryDeps(asTable(poetry.dependencies), "production", file, lines));
    deps.push(...poetryDeps(asTable(poetry["dev-dependencies"]), "development", file, lines));
    for (const group of Object.values(asTable(poetry.group) ?? {})) deps.push(...poetryDeps(asTable(asTable(group)?.dependencies), "development", file, lines));
  }
  // The same package may be listed by PEP 621 and Poetry; keep the first.
  const seen = new Set<string>();
  return result(file, type, deps.filter(d => (seen.has(`${d.name}|${d.scope}`) ? false : (seen.add(`${d.name}|${d.scope}`), true))));
}

function parsePipfile(file: string, text: string, type: FileType): ParsedFile {
  let doc: TomlTable;
  try { doc = parseToml(text); } catch (error) { return result(file, type, [], [], `Not valid TOML: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const [section, scope] of [["packages", "production"], ["dev-packages", "development"]] as Array<[string, DependencyScope]>) {
    for (const [rawName, value] of Object.entries(asTable(doc[section]) ?? {})) {
      const entry = asTable(value);
      const name = normalizePipName(rawName);
      const line = lines.match(pythonLine(lines, rawName));
      if (entry && (entry.git !== undefined || entry.path !== undefined || entry.file !== undefined)) {
        deps.push({ name, resolution: "range", scope, direct: true, line, registry: false, note: "Installed from git, a URL or a local path, so PyPI advisories may not apply." });
        continue;
      }
      const spec = (typeof value === "string" ? value : asString(entry?.version)) ?? "*";
      const version = exactPep440(spec);
      deps.push(version ? { name, version, spec, resolution: "pinned", scope, direct: true, line } : { name, spec: spec === "*" ? "*" : spec.replace(/\s+/g, ""), resolution: "range", scope, direct: true, line });
    }
  }
  return result(file, type, deps);
}

/**
 * conda-lock.yml: `package:` lists every package per platform with `manager: conda` or `manager: pip`.
 * pip packages are PyPI packages; conda packages come from conda channels, which OSV has no ecosystem for.
 */
function parseCondaLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(parseYaml(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid YAML: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  const seen = new Set<string>();
  let conda = 0;
  for (const raw of Array.isArray(doc.package) ? doc.package : []) {
    const entry = asRecord(raw) ?? {};
    const name = typeof entry.name === "string" ? entry.name : undefined;
    const version = entry.version !== undefined ? String(entry.version) : undefined;
    if (!name || !version) continue;
    const manager = String(entry.manager ?? "conda");
    const key = `${manager}|${name}|${version}`;
    if (seen.has(key)) continue; // the same package locked for several platforms
    seen.add(key);
    const line = lines.find(`name: ${name}\n`, `- name: ${name}`);
    const scope: DependencyScope = entry.category === "dev" ? "development" : "production";
    if (manager === "pip") deps.push({ name: normalizePipName(name), version, resolution: "lockfile", scope, line });
    else { conda++; deps.push({ name, resolution: "lockfile", scope, line, registry: false, skip: "source", note: "A conda package. OSV has no conda ecosystem, so conda channel packages are not checked." }); }
  }
  return result(file, type, deps, conda ? [`${conda} conda package${conda === 1 ? " is" : "s are"} outside OSV's coverage; only pip packages in the lock are checked.`] : []);
}

/** environment.yml: the `pip:` section is PyPI requirements; conda entries are reported as out of scope. */
function parseCondaEnvironment(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(parseYaml(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid YAML: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const raw of Array.isArray(doc.dependencies) ? doc.dependencies : []) {
    if (typeof raw === "string") {
      const name = raw.trim().split(/[=<>!\s[]/)[0];
      if (!name || name === "pip" || name === "python") continue;
      deps.push({ name, resolution: "range", spec: raw.trim(), scope: "production", direct: true, line: lines.find(raw), registry: false, skip: "source", note: "A conda package. OSV has no conda ecosystem, so conda channel packages are not checked." });
      continue;
    }
    const pip = asRecord(raw)?.pip;
    if (!Array.isArray(pip)) continue;
    const declared = parseRequirements(pip.filter(v => typeof v === "string").join("\n"), file, "production");
    deps.push(...fromDeclared(declared, lines, exactPep440, d => d.name, d => pythonLine(lines, d.displayName)));
  }
  return result(file, type, deps);
}

// ---------------------------------------------------------------------------
// Maven and Gradle
// ---------------------------------------------------------------------------

/** `<properties>` of a POM plus its own and its parent's version. */
function pomProperties(text: string): Record<string, string> {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "");
  const properties: Record<string, string> = {};
  const block = /<properties>([\s\S]*?)<\/properties>/.exec(clean);
  if (block) for (const match of block[1].matchAll(/<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g)) properties[match[1]] = match[2];
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(clean);
  const parentVersion = parent ? /<version>\s*([^<]*?)\s*<\/version>/.exec(parent[1])?.[1] : undefined;
  if (parentVersion) properties["project.parent.version"] = parentVersion;
  return properties;
}

function isMavenDynamic(version: string): boolean {
  return /[[\](),]/.test(version) || /^latest\.|^LATEST$|^RELEASE$/i.test(version);
}

function parsePomFile(file: string, text: string, type: FileType, context: ParseContext): ParsedFile {
  if (!/<project[\s>]/.test(text)) return result(file, type, [], [], "Not a Maven POM (no <project> element).");
  // Malformed XML is reported, never read as "no dependencies".
  try { parseXml(text); } catch (error) { return result(file, type, [], [], `Not a readable POM: ${errorText(error)}`); }
  const declared = parsePom(text, file);
  const lines = new Lines(text);
  // Properties a child POM uses are often defined in a parent POM higher up the tree.
  const inherited: Record<string, string> = {};
  const dir = path.posix.dirname(file);
  const parentDir = dir === "." ? undefined : path.posix.dirname(dir);
  const parents = parentDir === undefined ? [] : context.ancestors("pom.xml", parentDir === "." ? "" : parentDir);
  for (const parentText of [...parents].reverse()) Object.assign(inherited, pomProperties(parentText));
  Object.assign(inherited, pomProperties(text));
  const deps: ParsedDependency[] = declared.map(d => {
    const artifact = d.name.split(":")[1] ?? d.name;
    const line = lines.find(`<artifactId>${artifact}</artifactId>`);
    let spec = d.spec;
    if (!spec && d.versionRef && inherited[d.versionRef] && !inherited[d.versionRef].includes("${")) spec = inherited[d.versionRef];
    const base = { name: d.name, scope: d.scope, direct: true, line };
    if (!spec) {
      return { ...base, resolution: "range" as const, registry: false, note: d.versionRef
        ? `The version comes from \${${d.versionRef}}, which is not defined in this POM or a parent POM in the workspace.`
        : "No version is declared here; it is managed by a parent POM or BOM outside the workspace." };
    }
    if (/SNAPSHOT$/i.test(spec)) return { ...base, spec, resolution: "range" as const, registry: false, note: "SNAPSHOT versions are not published releases, so OSV has no data for them." };
    if (isMavenDynamic(spec)) return { ...base, spec, resolution: "range" as const };
    return { ...base, version: spec, spec, resolution: "pinned" as const };
  });
  return result(file, type, deps);
}

function gradleDeclared(file: string, declared: DeclaredDependency[], lines: Lines, type: FileType): ParsedFile {
  const deps: ParsedDependency[] = declared.map(d => {
    const line = lines.find(d.name);
    const base = { name: d.name, scope: d.scope, direct: true, line };
    if (!d.spec) {
      return { ...base, resolution: "range" as const, registry: false, note: d.versionRef
        ? `The version comes from ${d.versionRef}, which could not be resolved from this project's files.`
        : "No version is declared here; it comes from a platform, BOM or plugin." };
    }
    if (/[+[\](),]|^latest\./i.test(d.spec)) return { ...base, spec: d.spec.replace(/\+$/, ".+"), resolution: "range" as const, note: "Dynamic or range version: Gradle resolves it at build time." };
    if (/SNAPSHOT$/i.test(d.spec)) return { ...base, spec: d.spec, resolution: "range" as const, registry: false, note: "SNAPSHOT versions are not published releases, so OSV has no data for them." };
    return { ...base, version: d.spec, spec: d.spec, resolution: "declared" as const,
      note: "Declared in the build script. Gradle may resolve a newer version through conflict resolution; enable dependency locking (gradle.lockfile) to scan what is actually used." };
  });
  return result(file, type, deps);
}

function parseGradleFile(file: string, text: string, type: FileType, context: ParseContext): ParsedFile {
  const inherited: Record<string, string> = {};
  const dir = path.posix.dirname(file);
  for (const props of [...context.ancestors("gradle.properties", dir === "." ? "" : dir)].reverse()) Object.assign(inherited, parseProperties(props));
  return gradleDeclared(file, parseGradle(text, file, inherited), new Lines(text), type);
}

function parseVersionCatalogFile(file: string, text: string, type: FileType): ParsedFile {
  return gradleDeclared(file, parseVersionCatalog(text, file), new Lines(text), type);
}

function parseGradleLock(file: string, text: string, type: FileType): ParsedFile {
  const deps: ParsedDependency[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("empty=")) return;
    const match = /^([^:\s]+):([^:\s]+):([^=\s]+)(?:=(.*))?$/.exec(line);
    if (!match) return;
    const configurations = (match[4] ?? "").split(",").filter(Boolean);
    const testOnly = configurations.length > 0 && configurations.every(c => /test/i.test(c));
    deps.push({ name: `${match[1]}:${match[2]}`, version: match[3], resolution: "lockfile", scope: testOnly ? "development" : "production", line: index + 1 });
  });
  return result(file, type, deps);
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

function parseGoMod(file: string, text: string, type: FileType): ParsedFile {
  const deps: ParsedDependency[] = [];
  const warnings: string[] = [];
  const replaces = new Map<string, { from?: string; to: string; version?: string; line: number }>();
  const requires: Array<{ name: string; version: string; indirect: boolean; line: number }> = [];
  let goVersion: string | undefined;
  type Block = "require" | "replace" | "exclude" | "retract" | "other";
  let block: Block | undefined;
  const handle = (verb: string, rest: string, line: number) => {
    const body = rest.replace(/\/\/.*$/, "").trim();
    const indirect = /\/\/\s*indirect\b/.test(rest);
    if (verb === "require") {
      const match = /^(\S+)\s+(\S+)$/.exec(body);
      if (match) requires.push({ name: match[1].replace(/^"|"$/g, ""), version: match[2], indirect, line });
    } else if (verb === "replace") {
      const match = /^(\S+)(?:\s+(\S+))?\s*=>\s*(\S+)(?:\s+(\S+))?$/.exec(body);
      if (match) replaces.set(match[1], { from: match[2], to: match[3], version: match[4], line });
    }
  };
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;
    if (block) {
      if (line.startsWith(")")) { block = undefined; return; }
      if (line && !line.startsWith("//") && block !== "other") handle(block, line, number);
      return;
    }
    const go = /^go\s+(\d+\.\d+)/.exec(line);
    if (go) goVersion = go[1];
    const opener = /^(require|replace|exclude|retract|tool|godebug|ignore)\s*\(\s*$/.exec(line);
    if (opener) { block = (["require", "replace", "exclude", "retract"].includes(opener[1]) ? opener[1] : "other") as Block; return; }
    const single = /^(require|replace)\s+(.+)$/.exec(line);
    if (single) handle(single[1], single[2], number);
  });
  for (const req of requires) {
    const replacement = replaces.get(req.name);
    const applies = replacement && (!replacement.from || replacement.from === req.version);
    if (applies && replacement) {
      if (!replacement.version || /^\.{0,2}\//.test(replacement.to)) {
        deps.push({ name: req.name, resolution: "lockfile", scope: "production", direct: !req.indirect, line: replacement.line, registry: false, note: `Replaced by the local directory ${replacement.to}, so module advisories may not apply.` });
        continue;
      }
      deps.push({ name: replacement.to, version: replacement.version, resolution: "lockfile", scope: "production", direct: !req.indirect, line: replacement.line, note: `Replaces ${req.name} ${req.version}.` });
      continue;
    }
    deps.push({ name: req.name, version: req.version, resolution: "lockfile", scope: "production", direct: !req.indirect, line: req.line });
  }
  if (goVersion && Number(goVersion.split(".")[1]) < 17) {
    warnings.push(`go ${goVersion}: before Go 1.17, go.mod does not list every module in the build, so some indirect dependencies may be missing. Run \`go mod tidy -go=1.17\` to record them.`);
  }
  return result(file, type, deps, warnings);
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

function parseCargoLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: TomlTable;
  try { doc = parseToml(text); } catch (error) { return result(file, type, [], [], `Not valid TOML: ${errorText(error)}`); }
  const deps: ParsedDependency[] = [];
  const localPackages: string[] = [];
  for (const pkg of asTables(doc.package)) {
    const name = asString(pkg.name);
    const version = asString(pkg.version);
    const source = asString(pkg.source);
    if (!name) continue;
    const line = lineOf(pkg);
    if (!source) { localPackages.push(name); continue; } // a member of this workspace (or a path crate)
    if (!/^(?:registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index|sparse\+https:\/\/index\.crates\.io\/?)$/.test(source)) {
      deps.push({ name, resolution: "lockfile", scope: "production", line, registry: false,
        note: source.startsWith("git+") ? "Built from a git repository, so crates.io advisories may not apply." : "Comes from an alternative registry, so crates.io advisories may not apply." });
      continue;
    }
    if (!version) continue;
    deps.push({ name, version, resolution: "lockfile", scope: "production", line });
  }
  return { ...result(file, type, deps), ...(localPackages.length ? { localPackages } : {}) };
}

function parseCargoToml(file: string, text: string, type: FileType): ParsedFile {
  let doc: TomlTable;
  try { doc = parseToml(text); } catch (error) { return result(file, type, [], [], `Not valid TOML: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  const read = (table: TomlTable | undefined, scope: DependencyScope) => {
    for (const [key, value] of Object.entries(table ?? {})) {
      const entry = asTable(value);
      const name = asString(entry?.package) ?? key;
      const line = lines.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m"));
      if (entry && (entry.path !== undefined || entry.git !== undefined || entry.registry !== undefined)) {
        deps.push({ name, resolution: "range", scope, direct: true, line, registry: false, note: "Comes from a path, git or another registry, so crates.io advisories may not apply." });
        continue;
      }
      if (entry?.workspace === true) {
        deps.push({ name, resolution: "range", scope, direct: true, line, registry: false, note: "Inherits its version from the workspace's [workspace.dependencies]." });
        continue;
      }
      const spec = typeof value === "string" ? value : asString(entry?.version);
      if (!spec) continue;
      const exact = /^=\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(spec.trim());
      deps.push(exact ? { name, version: exact[1], spec, resolution: "pinned", scope, direct: true, line } : { name, spec, resolution: "range", scope, direct: true, line });
    }
  };
  read(asTable(doc.dependencies), "production");
  read(asTable(doc["dev-dependencies"]), "development");
  read(asTable(doc["build-dependencies"]), "development");
  read(asTable(asTable(doc.workspace)?.dependencies), "production");
  for (const target of Object.values(asTable(doc.target) ?? {})) {
    read(asTable(asTable(target)?.dependencies), "production");
    read(asTable(asTable(target)?.["dev-dependencies"]), "development");
  }
  return result(file, type, deps);
}

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

function parseGemfileLock(file: string, text: string, type: FileType): ParsedFile {
  const deps: ParsedDependency[] = [];
  const direct = new Set<string>();
  let section = "";
  let inSpecs = false;
  let remote = "";
  const pending: Array<{ name: string; version: string; line: number; section: string; remote: string }> = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (/^\S/.test(raw)) { section = raw.trim(); inSpecs = false; remote = ""; return; }
    const remoteMatch = /^ {2}remote: (.+)$/.exec(raw);
    if (remoteMatch) { remote = remoteMatch[1].trim(); return; }
    if (/^ {2}specs:\s*$/.test(raw)) { inSpecs = true; return; }
    if (section === "DEPENDENCIES") {
      const dep = /^ {2}([^\s!(]+)/.exec(raw);
      if (dep) direct.add(dep[1]);
      return;
    }
    if (!inSpecs) return;
    const spec = /^ {4}([^\s(]+) \(([^)]+)\)\s*$/.exec(raw);
    if (spec) pending.push({ name: spec[1], version: spec[2], line: index + 1, section, remote });
  });
  const seen = new Set<string>();
  for (const entry of pending) {
    // A platform-specific gem is listed as `nokogiri (1.15.4-x86_64-linux)`.
    const version = entry.version.split("-")[0];
    const key = `${entry.name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = { name: entry.name, scope: "production" as const, direct: direct.has(entry.name) ? true : false, line: entry.line };
    if (entry.section !== "GEM") {
      deps.push({ ...base, resolution: "lockfile", registry: false, note: `Comes from a ${entry.section === "GIT" ? "git repository" : entry.section === "PATH" ? "local path" : entry.section.toLowerCase()} source, so RubyGems advisories may not apply.` });
      continue;
    }
    deps.push({ ...base, version, resolution: "lockfile" });
  }
  return result(file, type, deps);
}

function parseGemfile(file: string, text: string, type: FileType): ParsedFile {
  const deps: ParsedDependency[] = [];
  const groups: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    const groupOpen = /^group\s+(.+?)\s+do\b/.exec(line);
    if (groupOpen) { groups.push(groupOpen[1]); return; }
    if (/^(?:platforms?|source|install_if)\b.*\bdo\b/.test(line)) { groups.push(""); return; }
    if (/^end\b/.test(line) && groups.length) { groups.pop(); return; }
    const gem = /^gem\s+["']([^"']+)["']\s*(.*)$/.exec(line);
    if (!gem) return;
    const name = gem[1];
    const args = gem[2];
    const constraints = [...args.matchAll(/(?:^|,)\s*["']([^"']+)["']/g)].map(m => m[1]).filter(c => /^[~<>=!]*\s*\d/.test(c));
    const inline = /\bgroups?:\s*(\[[^\]]*\]|:\w+)/.exec(args)?.[1] ?? "";
    const groupText = [...groups, inline].join(" ");
    const scope: DependencyScope = /:(?:development|test)\b/.test(groupText) ? "development" : "production";
    const base = { name, scope, direct: true, line: index + 1 };
    if (/\b(?:git|github|path):/.test(args)) { deps.push({ ...base, resolution: "range", registry: false, note: "Comes from git or a local path, so RubyGems advisories may not apply." }); return; }
    const spec = constraints.join(", ");
    const exact = constraints.length === 1 ? /^=?\s*(\d[\w.]*)$/.exec(constraints[0]) : null;
    deps.push(exact ? { ...base, version: exact[1], spec, resolution: "pinned" } : { ...base, spec: spec || "*", resolution: "range" });
  });
  return result(file, type, deps);
}

// ---------------------------------------------------------------------------
// .NET
// ---------------------------------------------------------------------------

function parseNugetLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  const seen = new Set<string>();
  for (const framework of Object.values(asRecord(doc.dependencies) ?? {})) {
    for (const [name, raw] of Object.entries(asRecord(framework) ?? {})) {
      const entry = asRecord(raw) ?? {};
      if (entry.type === "Project") continue;
      const version = typeof entry.resolved === "string" ? entry.resolved : undefined;
      if (!version) continue;
      const key = `${name.toLowerCase()}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push({ name, version, resolution: "lockfile", scope: "production", direct: entry.type === "Direct", line: lines.find(`"${name}": {`) });
    }
  }
  return result(file, type, deps);
}

function parseNugetAssets(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const direct = new Set<string>();
  for (const framework of Object.values(asRecord(asRecord(doc.project)?.frameworks) ?? {})) {
    for (const name of Object.keys(asRecord(asRecord(framework)?.dependencies) ?? {})) direct.add(name.toLowerCase());
  }
  const deps: ParsedDependency[] = [];
  for (const [key, raw] of Object.entries(asRecord(doc.libraries) ?? {})) {
    const entry = asRecord(raw) ?? {};
    const slash = key.lastIndexOf("/");
    if (slash <= 0 || entry.type !== "package") continue;
    const name = key.slice(0, slash);
    deps.push({ name, version: key.slice(slash + 1), resolution: "lockfile", scope: "production", direct: direct.has(name.toLowerCase()), line: lines.find(`"${key}": {`) });
  }
  return result(file, type, deps, ["obj/project.assets.json is written by `dotnet restore`; restore again after changing package versions so it stays current."]);
}

function nugetExact(spec: string): string | undefined {
  const bracket = /^\[\s*([^,\]\s]+)\s*\]$/.exec(spec);
  if (bracket) return bracket[1];
  // NuGet installs the lowest version a bare `1.2.3` allows: that version.
  return /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?$/.test(spec) ? spec : undefined;
}

function parseCsprojFile(file: string, text: string, type: FileType, context: ParseContext): ParsedFile {
  const dir = path.posix.dirname(file);
  const centralText = context.ancestors("Directory.Packages.props", dir === "." ? "" : dir)[0];
  const declared = parseCsproj(text, file, centralText ? parseCentralPackageVersions(centralText) : {});
  const lines = new Lines(text);
  const deps: ParsedDependency[] = declared.map(d => {
    const line = lines.find(`Include="${d.displayName}"`);
    const base = { name: d.displayName, scope: d.scope, direct: true, line };
    if (!d.spec || d.spec.includes("$(")) return { ...base, resolution: "range" as const, registry: false, note: d.note };
    const version = nugetExact(d.spec);
    return version ? { ...base, version, spec: d.spec, resolution: "pinned" as const } : { ...base, spec: d.spec, resolution: "range" as const, note: d.note };
  });
  return result(file, type, deps);
}

function parsePackagesConfig(file: string, text: string, type: FileType): ParsedFile {
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const match of text.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<package\b([^>]*)\/?>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(match[1])?.[1];
    const id = attr("id");
    const version = attr("version");
    if (!id || !version) continue;
    deps.push({ name: id, version, resolution: "pinned", scope: attr("developmentDependency") === "true" ? "development" : "production", direct: true, line: lines.find(`id="${id}"`) });
  }
  return result(file, type, deps);
}

// ---------------------------------------------------------------------------
// PHP, Dart, Elixir, Swift, R
// ---------------------------------------------------------------------------

function parseComposerLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const [section, scope] of [["packages", "production"], ["packages-dev", "development"]] as Array<[string, DependencyScope]>) {
    const list = Array.isArray(doc[section]) ? doc[section] as unknown[] : [];
    for (const raw of list) {
      const entry = asRecord(raw) ?? {};
      const name = typeof entry.name === "string" ? entry.name : undefined;
      const version = typeof entry.version === "string" ? entry.version : undefined;
      if (!name) continue;
      const line = lines.find(`"name": "${name}"`);
      const source = asRecord(entry.dist) ?? asRecord(entry.source);
      if (!version || !/^v?\d/.test(version)) {
        deps.push({ name, resolution: "lockfile", scope, line, registry: false, note: `Locked to "${version ?? "?"}", a development branch rather than a release, so advisories cannot be matched.` });
      } else if (source && source.type === "path") {
        deps.push({ name, resolution: "lockfile", scope, line, registry: false, note: "Installed from a local path, so Packagist advisories may not apply." });
      } else {
        deps.push({ name, version: version.replace(/^v(?=\d)/, ""), resolution: "lockfile", scope, line });
      }
    }
  }
  return result(file, type, deps);
}

function parseComposerJson(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const [section, scope] of [["require", "production"], ["require-dev", "development"]] as Array<[string, DependencyScope]>) {
    for (const [name, raw] of Object.entries(asRecord(doc[section]) ?? {})) {
      if (!name.includes("/") || typeof raw !== "string") continue; // php, ext-*, lib-* are platform packages
      const spec = raw.trim();
      const line = lines.find(`"${name}"`);
      const exact = /^v?(\d+(?:\.\d+){1,3})$/.exec(spec);
      deps.push(exact ? { name, version: exact[1], spec, resolution: "pinned", scope, direct: true, line } : { name, spec, resolution: "range", scope, direct: true, line });
    }
  }
  return result(file, type, deps);
}

function parsePubLockFile(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(parseYaml(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid YAML: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const [name, raw] of Object.entries(asRecord(doc.packages) ?? {})) {
    const entry = asRecord(raw) ?? {};
    const dependency = String(entry.dependency ?? "");
    const scope: DependencyScope = /dev/.test(dependency) ? "development" : "production";
    const line = lines.find(`\n  ${name}:`);
    const base = { name, scope, direct: dependency.startsWith("direct"), line };
    const version = entry.version !== undefined ? String(entry.version) : undefined;
    if (entry.source === "sdk") continue;
    const description = asRecord(entry.description);
    const url = typeof description?.url === "string" ? description.url : "";
    if (entry.source !== "hosted" || (url && !/^https:\/\/pub\.(?:dev|dartlang\.org)\/?$/.test(url))) {
      deps.push({ ...base, resolution: "lockfile", registry: false, note: entry.source === "hosted" ? "Hosted on a private pub server, so pub.dev advisories may not apply." : `Comes from a ${String(entry.source)} source, so pub.dev advisories may not apply.` });
      continue;
    }
    if (!version) continue;
    deps.push({ ...base, version, resolution: "lockfile" });
  }
  return result(file, type, deps);
}

function parsePubspecFile(file: string, text: string, type: FileType): ParsedFile {
  const parsed = parsePubspec(text, file);
  if (parsed.error) return result(file, type, [], [], parsed.error);
  const lines = new Lines(text);
  const deps = fromDeclared(parsed.dependencies.filter(d => d.note === undefined || !/SDK/.test(d.note)), lines,
    spec => (SEMVER_EXACT.test(spec) ? spec : undefined), d => d.name, d => new RegExp(`^\\s+${escapeRegExp(d.name)}\\s*:`, "m"));
  return result(file, type, deps);
}

function parseMixLock(file: string, text: string, type: FileType): ParsedFile {
  const deps: ParsedDependency[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const hex = /^\s*"([^"]+)":\s*\{:hex,\s*:"?([\w-]+)"?,\s*"([^"]+)"/.exec(raw);
    if (hex) { deps.push({ name: hex[2], version: hex[3], resolution: "lockfile", scope: "production", line: index + 1 }); return; }
    const other = /^\s*"([^"]+)":\s*\{:(git|path)\b/.exec(raw);
    if (other) deps.push({ name: other[1], resolution: "lockfile", scope: "production", line: index + 1, registry: false, note: `Comes from ${other[2]}, so Hex advisories may not apply.` });
  });
  return result(file, type, deps);
}

/** A git URL as OSV's SwiftURL names it: `github.com/apple/swift-nio`. */
export function swiftUrlName(location: string): string {
  let value = location.trim();
  const scp = /^[\w.-]+@([^:]+):(.+)$/.exec(value);
  if (scp) value = `${scp[1]}/${scp[2]}`;
  return value.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
}

function parsePackageResolved(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const pins = Array.isArray(doc.pins) ? doc.pins : Array.isArray(asRecord(doc.object)?.pins) ? asRecord(doc.object)!.pins as unknown[] : [];
  const deps: ParsedDependency[] = [];
  for (const raw of pins) {
    const pin = asRecord(raw) ?? {};
    const location = typeof pin.location === "string" ? pin.location : typeof pin.repositoryURL === "string" ? pin.repositoryURL : undefined;
    if (!location) continue;
    const state = asRecord(pin.state) ?? {};
    const name = swiftUrlName(location);
    const line = lines.find(`"${location}"`);
    const version = typeof state.version === "string" ? state.version : undefined;
    if (pin.kind === "localSourceControl" || pin.kind === "fileSystem") continue;
    if (!version) {
      deps.push({ name, resolution: "lockfile", scope: "production", line, registry: false, note: `Pinned to a ${state.branch ? `branch (${String(state.branch)})` : "revision"}, not a release, so advisories cannot be matched.` });
      continue;
    }
    deps.push({ name, version, resolution: "lockfile", scope: "production", line });
  }
  return result(file, type, deps);
}

/** A SwiftPM requirement as an npm-style range (SwiftURL versions are semver): from/upToNextMajor/Minor, exact, a..<b, a...b. */
export function swiftRequirement(args: string): { spec?: string; exact?: string } | undefined {
  const v = (s: string) => s.replace(/^"|"$/g, "");
  const bump = (version: string, part: 0 | 1) => {
    const [major, minor] = version.split(".").map(n => Number.parseInt(n, 10) || 0);
    return part === 0 ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;
  };
  let m = /\bexact\s*:\s*("[^"]+")/.exec(args) ?? /\.exact\(\s*("[^"]+")\s*\)/.exec(args);
  if (m) return { exact: v(m[1]) };
  m = /\.upToNextMinor\s*\(\s*from\s*:\s*("[^"]+")\s*\)/.exec(args);
  if (m) return { spec: `>=${v(m[1])} <${bump(v(m[1]), 1)}` };
  m = /(?:\.upToNextMajor\s*\(\s*)?from\s*:\s*("[^"]+")/.exec(args);
  if (m) return { spec: `>=${v(m[1])} <${bump(v(m[1]), 0)}` };
  m = /("[^"]+")\s*\.\.<\s*("[^"]+")/.exec(args);
  if (m) return { spec: `>=${v(m[1])} <${v(m[2])}` };
  m = /("[^"]+")\s*\.\.\.\s*("[^"]+")/.exec(args);
  if (m) return { spec: `>=${v(m[1])} <=${v(m[2])}` };
  return undefined;
}

/** Package.swift: `.package(url:..., from:/exact:/range)` dependencies. Branch, revision and path dependencies are not releases. */
function parsePackageSwift(file: string, text: string, type: FileType): ParsedFile {
  // Line comments, but not the "//" of a URL.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const match of clean.matchAll(/\.package\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const args = match[1];
    const url = /\burl\s*:\s*"([^"]+)"/.exec(args)?.[1];
    if (!url) continue; // .package(path: ...) is local code
    const name = swiftUrlName(url);
    const line = lines.find(url);
    if (/\b(?:branch|revision)\s*:/.test(args)) {
      deps.push({ name, resolution: "range", scope: "production", direct: true, line, registry: false, skip: "source", note: "Pinned to a branch or revision, not a release, so advisories cannot be matched." });
      continue;
    }
    const requirement = swiftRequirement(args);
    if (requirement?.exact) deps.push({ name, version: requirement.exact, spec: requirement.exact, resolution: "pinned", scope: "production", direct: true, line });
    else if (requirement?.spec) deps.push({ name, spec: requirement.spec, resolution: "range", scope: "production", direct: true, line });
    else deps.push({ name, resolution: "range", scope: "production", direct: true, line, registry: false, skip: "unresolved", note: "The version requirement could not be read." });
  }
  return result(file, type, deps);
}

function parseRenvLock(file: string, text: string, type: FileType): ParsedFile {
  let doc: Record<string, unknown>;
  try { doc = asRecord(JSON.parse(text)) ?? {}; } catch (error) { return result(file, type, [], [], `Not valid JSON: ${errorText(error)}`); }
  const lines = new Lines(text);
  const deps: ParsedDependency[] = [];
  for (const [key, raw] of Object.entries(asRecord(doc.Packages) ?? {})) {
    const entry = asRecord(raw) ?? {};
    const name = typeof entry.Package === "string" ? entry.Package : key;
    const version = typeof entry.Version === "string" ? entry.Version : undefined;
    const line = lines.find(`"${key}": {`);
    const source = String(entry.Source ?? "");
    const repository = String(entry.Repository ?? "");
    if (source !== "Repository" || /bioc/i.test(repository)) {
      deps.push({ name, resolution: "lockfile", scope: "production", line, registry: false, note: /bioc/i.test(source + repository) ? "A Bioconductor package; this scanner checks CRAN advisories only." : `Installed from ${source || "an unknown source"}, so CRAN advisories may not apply.` });
      continue;
    }
    if (!version) continue;
    deps.push({ name, version, resolution: "lockfile", scope: "production", line });
  }
  return result(file, type, deps);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// ---------------------------------------------------------------------------
// Adapters: one entry per file format. Adding an ecosystem is adding an entry
// (and its parser); each parser is a pure function, testable on its own.
// ---------------------------------------------------------------------------

export interface FileAdapter extends FileType {
  /** Whether a file is this format, from its name (and its folder's name). */
  matches(base: string, lowerBase: string, parentDir: string): boolean;
  parse(file: string, text: string, type: FileType, context: ParseContext): ParsedFile;
}

const named = (...names: string[]) => (base: string) => names.includes(base);
const adapter = (id: string, ecosystem: OsvEcosystem, kind: FileKind, manager: PackageManager, matches: FileAdapter["matches"], parse: FileAdapter["parse"]): FileAdapter =>
  ({ id, ecosystem, kind, manager, matches, parse });

export const FILE_ADAPTERS: FileAdapter[] = [
  adapter("npm-lock", "npm", "lockfile", "npm", named("package-lock.json", "npm-shrinkwrap.json"), parseNpmLock),
  adapter("yarn-lock", "npm", "lockfile", "yarn", named("yarn.lock"), parseYarnLock),
  adapter("pnpm-lock", "npm", "lockfile", "pnpm", named("pnpm-lock.yaml"), parsePnpmLock),
  adapter("bun-lock", "npm", "lockfile", "bun", named("bun.lock"), parseBunLock),
  adapter("bun-lockb", "npm", "lockfile", "bun", named("bun.lockb"), (file, _text, type) => result(file, type, [], [], "bun.lockb is a binary lockfile. Run `bun install --save-text-lockfile` (Bun 1.1.39+) to write bun.lock, which can be scanned.")),
  adapter("package-json", "npm", "manifest", "npm", named("package.json"), parseNpmManifest),
  adapter("pipfile-lock", "PyPI", "lockfile", "pipenv", named("Pipfile.lock"), parsePipfileLock),
  adapter("pipfile", "PyPI", "manifest", "pipenv", named("Pipfile"), parsePipfile),
  adapter("poetry-lock", "PyPI", "lockfile", "poetry", named("poetry.lock"), parsePythonTomlLock),
  adapter("uv-lock", "PyPI", "lockfile", "uv", named("uv.lock"), parsePythonTomlLock),
  adapter("pdm-lock", "PyPI", "lockfile", "pdm", named("pdm.lock"), parsePythonTomlLock),
  adapter("conda-lock", "PyPI", "lockfile", "conda", (base, lower) => lower === "conda-lock.yml" || lower === "conda-lock.yaml" || /\.conda-lock\.ya?ml$/.test(lower), parseCondaLock),
  adapter("conda-env", "PyPI", "manifest", "conda", (_base, lower) => lower === "environment.yml" || lower === "environment.yaml", parseCondaEnvironment),
  adapter("pyproject", "PyPI", "manifest", "pip", named("pyproject.toml"), parsePyprojectFile),
  adapter("requirements", "PyPI", "manifest", "pip", (_base, lower, parent) => /^requirements.*\.txt$/.test(lower) || /[-_]requirements\.txt$/.test(lower) || (parent === "requirements" && lower.endsWith(".txt")), parseRequirementsFile),
  adapter("pom", "Maven", "manifest", "maven", named("pom.xml"), parsePomFile),
  adapter("gradle", "Maven", "manifest", "gradle", named("build.gradle", "build.gradle.kts"), parseGradleFile),
  adapter("gradle-lock", "Maven", "lockfile", "gradle", (base, lower, parent) => base === "gradle.lockfile" || (lower.endsWith(".lockfile") && parent === "dependency-locks"), parseGradleLock),
  adapter("gradle-catalog", "Maven", "manifest", "gradle", (_base, lower) => lower === "libs.versions.toml" || /\.versions\.toml$/.test(lower), parseVersionCatalogFile),
  adapter("go-mod", "Go", "lockfile", "go", named("go.mod"), parseGoMod),
  adapter("cargo-lock", "crates.io", "lockfile", "cargo", named("Cargo.lock"), parseCargoLock),
  adapter("cargo-toml", "crates.io", "manifest", "cargo", named("Cargo.toml"), parseCargoToml),
  adapter("gemfile-lock", "RubyGems", "lockfile", "bundler", named("Gemfile.lock", "gems.locked"), parseGemfileLock),
  adapter("gemfile", "RubyGems", "manifest", "bundler", named("Gemfile", "gems.rb"), parseGemfile),
  adapter("nuget-lock", "NuGet", "lockfile", "nuget", named("packages.lock.json"), parseNugetLock),
  adapter("nuget-assets", "NuGet", "lockfile", "nuget", (base, _lower, parent) => base === "project.assets.json" && parent === "obj", parseNugetAssets),
  adapter("csproj", "NuGet", "manifest", "nuget", (_base, lower) => /\.(cs|fs|vb)proj$/.test(lower), parseCsprojFile),
  adapter("nuget-config", "NuGet", "manifest", "nuget", named("packages.config"), parsePackagesConfig),
  adapter("composer-lock", "Packagist", "lockfile", "composer", named("composer.lock"), parseComposerLock),
  adapter("composer-json", "Packagist", "manifest", "composer", named("composer.json"), parseComposerJson),
  adapter("pub-lock", "Pub", "lockfile", "pub", named("pubspec.lock"), parsePubLockFile),
  adapter("pubspec", "Pub", "manifest", "pub", named("pubspec.yaml"), parsePubspecFile),
  adapter("mix-lock", "Hex", "lockfile", "mix", named("mix.lock"), parseMixLock),
  adapter("swift-resolved", "SwiftURL", "lockfile", "swiftpm", named("Package.resolved"), parsePackageResolved),
  adapter("swift-package", "SwiftURL", "manifest", "swiftpm", named("Package.swift"), parsePackageSwift),
  adapter("renv-lock", "CRAN", "lockfile", "renv", named("renv.lock"), parseRenvLock)
];

/**
 * Parses one dependency file. Unreadable files come back with `error` set and
 * no dependencies; the scan reports them instead of failing. `typeId` parses a
 * file whose name does not say what it is (a requirements file included with -r).
 */
export function parseDependencyFile(file: string, text: string, context: ParseContext = NO_CONTEXT, typeId?: string): ParsedFile | undefined {
  const type = typeId ? fileTypeById(typeId) : detectFileType(file);
  if (!type) return undefined;
  const entry = FILE_ADAPTERS.find(a => a.id === type.id)!;
  try {
    return entry.parse(file, text, type, context);
  } catch (error) {
    return result(file, type, [], [], `Could not be read: ${errorText(error)}`);
  }
}

/** Normalised package name for matching: PyPI per PEP 503, npm/Maven/Go as written, others case-insensitive where the ecosystem is. */
export function matchName(ecosystem: OsvEcosystem, name: string): string {
  switch (ecosystem) {
    case "PyPI": return normalizePipName(name);
    case "NuGet": case "Packagist": case "RubyGems": case "Hex": case "Pub": case "SwiftURL": return name.toLowerCase();
    default: return name;
  }
}
