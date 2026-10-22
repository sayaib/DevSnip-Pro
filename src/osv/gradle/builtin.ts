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
  /** Dependencies written in a way this reader cannot resolve (catalog aliases, project code). */
  unreadable: string[];
  springBootVersion?: string;
}

function scopeOf(configuration: string): GradleBuildModel["dependencies"][number]["scope"] {
  if (/^test/i.test(configuration) || /^androidTest/i.test(configuration)) return "test";
  if (/compileOnly$/i.test(configuration)) return "provided";
  if (/runtimeOnly$|^runtime$/i.test(configuration)) return "runtime";
  return "compile";
}

/** Build-wide facts a project's own script may rely on (plugin versions declared once in the root build). */
export interface BuildDefaults {
  springBootVersion?: string;
  /** The root applies Spring's dependency-management (or the Boot plugin) to every project. */
  managedEverywhere?: boolean;
}

/** Plugin versions and plugins applied to all projects, from every script of the build. */
export function buildDefaults(scripts: string[], inherited: Record<string, string> = {}): BuildDefaults {
  const defaults: BuildDefaults = {};
  for (const text of scripts) {
    const version = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(text)?.[1]
      ?? /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"']+)["']/.exec(text)?.[1];
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
  for (const m of clean.matchAll(/(?:\b(?:def|val|var)\s+|\bext\.|\bset\(\s*["'])(\w+)["']?\s*[=,]\s*["']([^"'$\s]+)["']/g)) properties[m[1]] = m[2];
  for (const block of clean.matchAll(/\bext\s*\{([\s\S]*?)\}/g)) for (const m of block[1].matchAll(/(\w+)\s*=\s*["']([^"'$\s]+)["']/g)) properties[m[1]] = m[2];
  for (const m of clean.matchAll(/extra\[\s*"(\w+)"\s*\]\s*=\s*"([^"$\s]+)"/g)) properties[m[1]] = m[2];
  const expand = (value: string) => value.replace(/\$\{?(?:project\.|rootProject\.|ext\.)?([\w.]+)\}?/g, (match, key: string) => properties[key] ?? match);

  const model: GradleBuildModel = { dependencies: [], boms: [], unreadable: [] };
  const boot = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(clean)
    ?? /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"']+)["']/.exec(clean);
  if (boot) model.springBootVersion = expand(boot[1]);
  // A subproject usually applies the Boot plugin without a version; the root build declares it (`apply false`).
  const appliesBoot = /id\s*\(?\s*["']org\.springframework\.boot["']|apply\s*\(?\s*plugin\s*[:=]\s*["']org\.springframework\.boot["']/.test(clean);
  if (!model.springBootVersion && (appliesBoot || defaults.managedEverywhere)) model.springBootVersion = defaults.springBootVersion;
  const dependencyManagement = /io\.spring\.dependency-management/.test(clean) || Boolean(defaults.managedEverywhere);
  if (model.springBootVersion && (appliesBoot || defaults.managedEverywhere) && (dependencyManagement || /SpringBootPlugin\.BOM_COORDINATES/.test(clean))) {
    model.boms.push({ group: "org.springframework.boot", name: "spring-boot-dependencies", version: model.springBootVersion });
  }
  for (const m of clean.matchAll(/mavenBom\s*\(?\s*["']([^"':]+):([^"':]+):([^"']+)["']/g)) model.boms.push({ group: m[1], name: m[2], version: expand(m[3]) });
  for (const m of clean.matchAll(/(?:enforcedPlatform|platform)\s*\(\s*["']([^"':]+):([^"':]+):([^"']+)["']\s*\)/g)) model.boms.push({ group: m[1], name: m[2], version: expand(m[3]) });

  // Every `configuration(...)` / `configuration '...'` declaration, wherever it sits (one per line or several on one line).
  const lineAt = (index: number) => clean.slice(0, index).split("\n").length;
  for (const m of clean.matchAll(/(?:^|[\s{;(])([a-zA-Z]*(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly|[Rr]untimeOnly|[Cc]ompile|[Rr]untime))\s*(\(\s*)?(platform\s*\(|enforcedPlatform\s*\(|project\s*\(|files\s*\(|fileTree\s*\(|libs\.[\w.]+|["'][^"'\n]*["']|group\s*[:=][^\n)]*)/g)) {
    const configuration = m[1];
    const target = m[3];
    if (/^(?:platform|enforcedPlatform|project|files|fileTree)\s*\(/.test(target)) continue; // BOMs above; projects and files are not packages
    if (target.startsWith("libs.")) { model.unreadable.push(`${configuration}(${target})`); continue; }
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
  return `<project><modelVersion>4.0.0</modelVersion><groupId>${xml(coordinates.group)}</groupId><artifactId>${xml(coordinates.name)}</artifactId><version>0</version>
<dependencyManagement><dependencies>${model.boms.map(b => dep(b.group, b.name, b.version, "import", "<type>pom</type>")).join("")}</dependencies></dependencyManagement>
<dependencies>${model.dependencies.map(d => dep(d.group, d.name, d.version, d.scope)).join("")}</dependencies></project>`;
}

export function gradleProperties(texts: string[]): Record<string, string> {
  return Object.assign({}, ...texts.map(parseProperties));
}
