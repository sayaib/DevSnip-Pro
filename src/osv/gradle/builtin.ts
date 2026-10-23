import { parseProperties } from "../../services/dependency-manager";

/**
 * Reads a Gradle build script (Groovy or Kotlin DSL) into the equivalent of a
 * POM, so the Maven resolver can resolve it when Gradle itself cannot run:
 *
 *  - dependencies in string notation (`group:name[:version]`), with or without a version;
 *  - the Spring Boot plugin with Spring's dependency-management plugin (Boot's BOM is imported);
 *  - `dependencyManagement { imports { mavenBom "…" } }`;
 *  - `platform("…")` / `enforcedPlatform("…")` BOMs;
 *  - `ext` / `val` / gradle.properties values used as `${name}` or `$name`.
 *
 * What it cannot see (version catalog aliases, convention plugins, dynamic
 * code) is reported, and those dependencies stay unresolved; nothing is guessed.
 */

export interface GradleBuildModel {
  dependencies: Array<{ group: string; name: string; version?: string; scope: "compile" | "runtime" | "provided" | "test"; line: number }>;
  boms: Array<{ group: string; name: string; version: string }>;
  /** Dependencies written in a way this reader cannot resolve (unknown catalog aliases, project code). */
  unreadable: string[];
  springBootVersion?: string;
  /** Properties that override imported BOMs' version properties (Spring's dependency-management plugin). */
  properties: Record<string, string>;
}

function scopeOf(configuration: string): GradleBuildModel["dependencies"][number]["scope"] {
  if (/^test/i.test(configuration) || /^androidTest/i.test(configuration)) return "test";
  if (/compileOnly$/i.test(configuration)) return "provided";
  if (/runtimeOnly$|^runtime$/i.test(configuration)) return "runtime";
  return "compile";
}

/**
 * The default version catalog (`gradle/libs.versions.toml`), by the accessor a build script writes:
 * `commons-text` is `libs.commons.text`, plugins are `libs.plugins.…`, bundles `libs.bundles.…`.
 */
export interface VersionCatalog {
  libraries: Map<string, { group: string; name: string; version?: string }>;
  plugins: Map<string, { id: string; version?: string }>;
  bundles: Map<string, string[]>;
}

const accessor = (key: string) => key.replace(/[-_.]+/g, ".").toLowerCase();

export function readVersionCatalog(text: string): VersionCatalog {
  const catalog: VersionCatalog = { libraries: new Map(), plugins: new Map(), bundles: new Map() };
  const versions: Record<string, string> = {};
  let section = "";
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, "");
  const field = (value: string, name: string) => new RegExp(`(?:^|[\\s{,])${name.replace(".", "\\.")}\\s*=\\s*["']([^"']+)["']`).exec(value)?.[1];
  const versionOf = (value: string) => {
    const ref = field(value, "version.ref") ?? /version\s*=\s*\{[^}]*\bref\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
    if (ref) return versions[ref];
    return field(value, "version") ?? /version\s*=\s*\{[^}]*\b(?:strictly|require|prefer)\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
  };
  const lines = text.split(/\r?\n/);
  // Versions first: libraries may refer to versions declared below them.
  for (const pass of [0, 1]) {
    section = "";
    for (const raw of lines) {
      const line = raw.replace(/\s+#.*$/, "");
      const header = /^\s*\[([\w.-]+)\]\s*$/.exec(line);
      if (header) { section = header[1]; continue; }
      const entry = /^\s*([\w.-]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (!entry) continue;
      const [, key, value] = entry;
      if (pass === 0) { if (section === "versions" && /^["']/.test(value)) versions[key] = unquote(value); continue; }
      if (section === "libraries") {
        let group: string | undefined, name: string | undefined, version: string | undefined;
        if (/^["']/.test(value)) [group, name, version] = unquote(value).split(":");
        else {
          const module = field(value, "module");
          if (module) [group, name] = module.split(":"); else { group = field(value, "group"); name = field(value, "name"); }
          version = versionOf(value);
        }
        if (group && name) catalog.libraries.set(accessor(key), { group, name, ...(version ? { version } : {}) });
      } else if (section === "plugins") {
        const id = /^["']/.test(value) ? unquote(value).split(":")[0] : field(value, "id");
        const version = /^["']/.test(value) ? unquote(value).split(":")[1] : versionOf(value);
        if (id) catalog.plugins.set(accessor(key), { id, ...(version ? { version } : {}) });
      } else if (section === "bundles") {
        catalog.bundles.set(accessor(key), [...value.matchAll(/["']([\w.-]+)["']/g)].map(m => accessor(m[1])));
      }
    }
  }
  return catalog;
}

/** `alias(libs.plugins.spring.boot)` → the plugin it names, from the catalog. */
function catalogPlugins(text: string, catalog: VersionCatalog | undefined): Array<{ id: string; version?: string }> {
  if (!catalog) return [];
  return [...text.matchAll(/\balias\s*\(\s*libs\.plugins\.([\w.]+?)(?:\.get\(\))?\s*\)/g)].map(m => catalog.plugins.get(m[1].toLowerCase())).filter((p): p is { id: string; version?: string } => Boolean(p));
}

/** Build-wide facts a project's own script may rely on (plugin versions declared once in the root build). */
export interface BuildDefaults {
  springBootVersion?: string;
  /** The root applies Spring's dependency-management (or the Boot plugin) to every project. */
  managedEverywhere?: boolean;
  /** The build's default version catalog. */
  catalog?: VersionCatalog;
}

/** Plugin versions and plugins applied to all projects, from every script of the build. */
export function buildDefaults(scripts: string[], inherited: Record<string, string> = {}, catalog?: VersionCatalog): BuildDefaults {
  const defaults: BuildDefaults = catalog ? { catalog } : {};
  for (const text of scripts) {
    const version = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(text)?.[1]
      ?? /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"']+)["']/.exec(text)?.[1]
      ?? catalogPlugins(text, catalog).find(p => p.id === "org.springframework.boot")?.version;
    if (version && !defaults.springBootVersion) defaults.springBootVersion = version.replace(/\$\{?(\w+)\}?/g, (m, k: string) => inherited[k] ?? m);
    for (const block of text.matchAll(/\b(?:subprojects|allprojects)\s*\{([\s\S]*?)\n\}/g)) {
      if (/io\.spring\.dependency-management|org\.springframework\.boot/.test(block[1])) defaults.managedEverywhere = true;
    }
  }
  return defaults;
}

export function readGradleBuild(text: string, inherited: Record<string, string> = {}, defaults: BuildDefaults = {}): GradleBuildModel {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const properties: Record<string, string> = { ...inherited };
  for (const m of clean.matchAll(/(?:\b(?:def|val|var)\s+|\bext\.)(\w+)\s*=\s*["']([^"'$\s]+)["']/g)) properties[m[1]] = m[2];
  // Dotted names (tomcat.version) are how Spring Boot's BOM properties are overridden: set("…"), ext['…'], extra["…"], ext { set(…) }.
  for (const m of clean.matchAll(/\bset\(\s*["']([\w.-]+)["']\s*,\s*["']([^"'$\s]+)["']/g)) properties[m[1]] = m[2];
  for (const block of clean.matchAll(/\bext\s*\{([\s\S]*?)\}/g)) for (const m of block[1].matchAll(/(\w+)\s*=\s*["']([^"'$\s]+)["']/g)) properties[m[1]] = m[2];
  for (const m of clean.matchAll(/\b(?:extra|ext)\s*\[\s*["']([\w.-]+)["']\s*\]\s*=\s*["']([^"'$\s]+)["']/g)) properties[m[1]] = m[2];
  const expand = (value: string) => value.replace(/\$\{?(?:project\.|rootProject\.|ext\.)?([\w.]+)\}?/g, (match, key: string) => properties[key] ?? match);

  const model: GradleBuildModel = { dependencies: [], boms: [], unreadable: [], properties: {} };
  const catalog = defaults.catalog;
  // Plugins applied through catalog aliases (`alias(libs.plugins.spring.boot)`), unless only declared (`apply false`).
  const aliased = [...clean.matchAll(/\balias\s*\(\s*libs\.plugins\.([\w.]+?)(?:\.get\(\))?\s*\)(\s*apply\s*\(?\s*false)?/g)]
    .map(m => ({ plugin: catalog?.plugins.get(m[1].toLowerCase()), applied: !m[2] }))
    .filter((p): p is { plugin: { id: string; version?: string }; applied: boolean } => Boolean(p.plugin));
  const bootAlias = aliased.find(p => p.plugin.id === "org.springframework.boot");
  const boot = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(clean)?.[1]
    ?? /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"']+)["']/.exec(clean)?.[1]
    ?? bootAlias?.plugin.version;
  if (boot) model.springBootVersion = expand(boot);
  // A subproject usually applies the Boot plugin without a version; the root build declares it (`apply false`).
  const appliesBoot = /id\s*\(?\s*["']org\.springframework\.boot["']|apply\s*\(?\s*plugin\s*[:=]\s*["']org\.springframework\.boot["']/.test(clean) || Boolean(bootAlias?.applied);
  const usesBootBom = /SpringBootPlugin\.BOM_COORDINATES/.test(clean);
  if (!model.springBootVersion && (appliesBoot || defaults.managedEverywhere || usesBootBom)) model.springBootVersion = defaults.springBootVersion;
  const dependencyManagement = /io\.spring\.dependency-management/.test(clean) || aliased.some(p => p.applied && p.plugin.id === "io.spring.dependency-management") || Boolean(defaults.managedEverywhere);
  // Boot's BOM: imported by the Boot plugin with dependency management, or by `mavenBom(SpringBootPlugin.BOM_COORDINATES)`.
  if (model.springBootVersion && (((appliesBoot || defaults.managedEverywhere) && dependencyManagement) || usesBootBom)) {
    model.boms.push({ group: "org.springframework.boot", name: "spring-boot-dependencies", version: model.springBootVersion });
  }
  // Spring's dependency-management plugin lets project properties override the imported BOMs' version properties.
  if (dependencyManagement) model.properties = { ...properties };
  for (const m of clean.matchAll(/mavenBom\s*\(?\s*["']([^"':]+):([^"':]+):([^"']+)["']/g)) model.boms.push({ group: m[1], name: m[2], version: expand(m[3]) });
  for (const m of clean.matchAll(/(?:enforcedPlatform|platform)\s*\(\s*libs\.([\w.]+?)(?:\.get\(\))?\s*\)/g)) {
    const library = catalog?.libraries.get(m[1].toLowerCase());
    if (library?.version) model.boms.push({ group: library.group, name: library.name, version: expand(library.version) });
  }
  for (const m of clean.matchAll(/(?:enforcedPlatform|platform)\s*\(\s*["']([^"':]+):([^"':]+):([^"']+)["']\s*\)/g)) model.boms.push({ group: m[1], name: m[2], version: expand(m[3]) });

  // Every `configuration(...)` / `configuration '...'` declaration, wherever it sits (one per line or several on one line).
  const lineAt = (index: number) => clean.slice(0, index).split("\n").length;
  for (const m of clean.matchAll(/(?:^|[\s{;(])([a-zA-Z]*(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly|[Rr]untimeOnly|[Cc]ompile|[Rr]untime))\s*(\(\s*)?(platform\s*\(|enforcedPlatform\s*\(|project\s*\(|files\s*\(|fileTree\s*\(|libs\.[\w.]+|["'][^"'\n]*["']|group\s*[:=][^\n)]*)/g)) {
    const configuration = m[1];
    const target = m[3];
    if (/^(?:platform|enforcedPlatform|project|files|fileTree)\s*\(/.test(target)) continue; // BOMs above; projects and files are not packages
    if (target.startsWith("libs.")) {
      // Version catalog accessors: a library, or a bundle of libraries.
      const key = target.slice(5).replace(/\.get\(\)$/, "").toLowerCase();
      const bundle = key.startsWith("bundles.") ? catalog?.bundles.get(key.slice(8)) : undefined;
      const libraries = (bundle ?? [key]).map(k => catalog?.libraries.get(k));
      if (!libraries.length || libraries.some(l => !l)) { model.unreadable.push(`${configuration}(${target})`); continue; }
      for (const library of libraries) {
        model.dependencies.push({ group: library!.group, name: library!.name, ...(library!.version ? { version: expand(library!.version) } : {}), scope: scopeOf(configuration), line: lineAt(m.index! + m[0].indexOf(configuration)) });
      }
      continue;
    }
    const string = /^["']([^"':\s]+):([^"':\s]+)(?::([^"'\s@]+))?(?::[^"'\s]+)?(?:@\w+)?["']$/.exec(target);
    const map = /group\s*[:=]\s*["']([^"']+)["']\s*,\s*name\s*[:=]\s*["']([^"']+)["'](?:\s*,\s*version\s*[:=]\s*["']([^"']+)["'])?/.exec(target);
    const parts = string ?? map;
    if (!parts) continue;
    const version = parts[3] ? expand(parts[3]) : undefined;
    model.dependencies.push({ group: parts[1], name: parts[2], ...(version ? { version } : {}), scope: scopeOf(configuration), line: lineAt(m.index! + m[0].indexOf(configuration)) });
  }
  return model;
}

function xml(value: string): string {
  return value.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]!));
}

/** The build as a POM the Maven resolver can read (BOMs become imports, configurations become scopes). */
export function gradleBuildToPom(model: GradleBuildModel, coordinates: { group: string; name: string }): string {
  const dep = (g: string, a: string, v?: string, scope?: string, extra = "") =>
    `<dependency><groupId>${xml(g)}</groupId><artifactId>${xml(a)}</artifactId>${v ? `<version>${xml(v)}</version>` : ""}${extra}${scope && scope !== "compile" ? `<scope>${scope}</scope>` : ""}</dependency>`;
  const properties = Object.entries(model.properties ?? {}).filter(([key]) => /^[A-Za-z_][\w.-]*$/.test(key));
  return `<project><modelVersion>4.0.0</modelVersion><groupId>${xml(coordinates.group)}</groupId><artifactId>${xml(coordinates.name)}</artifactId><version>0</version>
${properties.length ? `<properties>${properties.map(([k, v]) => `<${k}>${xml(v)}</${k}>`).join("")}</properties>` : ""}
<dependencyManagement><dependencies>${model.boms.map(b => dep(b.group, b.name, b.version, "import", "<type>pom</type>")).join("")}</dependencies></dependencyManagement>
<dependencies>${model.dependencies.map(d => dep(d.group, d.name, d.version, d.scope)).join("")}</dependencies></project>`;
}

export function gradleProperties(texts: string[]): Record<string, string> {
  return Object.assign({}, ...texts.map(parseProperties));
}
