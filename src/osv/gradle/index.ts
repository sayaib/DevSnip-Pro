import * as path from "path";
import { MavenResolver, PomRepository } from "../maven/resolver";
import type { BuildToolProject, ResolutionOutcome } from "../maven/index";
import type { DependencyScope, ParsedDependency, ParsedFile } from "../types";
import { buildDefaults, gradleBuildToPom, gradleProperties, readGradleBuild } from "./builtin";
import type { GradleConfiguration, GradleRunResult } from "./cli";

/**
 * Turns the Gradle builds in a scan into resolved dependency lists, one per project.
 *
 * Per build (a settings.gradle and its projects, or a lone build.gradle):
 *  1. Gradle itself (an init-script task that lists resolved classpaths), when allowed: authoritative.
 *  2. Otherwise the build scripts are read and resolved with the Maven resolver
 *     using Gradle's conflict rule (highest version wins) and the BOMs the build
 *     imports (Spring Boot's plugin, mavenBom, platform). Those results are
 *     marked "declared": Gradle was not run, so they are potential findings.
 */

export interface GradleStrategy {
  /** Runs Gradle in the build's root directory (workspace-relative); omit to never run Gradle. */
  runCli?: (rootDir: string, signal?: AbortSignal) => Promise<GradleRunResult | { error: string }>;
  cliLabel?: string;
  repository: PomRepository;
  repositoryLabel: string;
  /** Workspace-relative directory for an absolute project directory Gradle reports. */
  relativeDir: (absolute: string) => string | undefined;
}

const BUILD_FILES = ["build.gradle", "build.gradle.kts"];
const SETTINGS_FILES = ["settings.gradle", "settings.gradle.kts"];
const dirOf = (file: string) => { const d = path.posix.dirname(file); return d === "." ? "" : d; };
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Projects a settings file includes, as directories relative to the build root (`include 'a', ':b:c'`). */
export function includedProjects(settings: string): string[] {
  const clean = settings.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const statement of clean.matchAll(/\binclude\s*\(?([^\n)]*)\)?/g)) {
    for (const name of statement[1].matchAll(/["']:?([^"']+)["']/g)) out.push(name[1].replace(/:/g, "/"));
  }
  // projectDir overrides: project(':x').projectDir = file('modules/x')
  for (const m of clean.matchAll(/project\s*\(\s*["']:?([^"']+)["']\s*\)\.projectDir\s*=\s*(?:file|new File)\s*\(\s*(?:rootDir\s*,\s*)?["']([^"']+)["']\s*\)/g)) {
    const index = out.indexOf(m[1].replace(/:/g, "/"));
    if (index >= 0) out[index] = m[2].replace(/^\.\//, "");
  }
  return out;
}

function scopeFor(configuration: string): DependencyScope {
  return /^test/i.test(configuration) ? "development" : "production";
}

/** Merges a project's classpaths: one entry per module version, production if any production classpath has it. */
function fromConfigurations(file: string, configurations: GradleConfiguration[], label: string): ParsedFile {
  const merged = new Map<string, ParsedDependency>();
  const unresolved = new Map<string, ParsedDependency>();
  for (const conf of configurations) {
    for (const node of conf.nodes) {
      const key = `${node.group}:${node.name}@${node.version}`;
      const scope = scopeFor(conf.configuration);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { name: `${node.group}:${node.name}`, version: node.version, resolution: "lockfile", scope, direct: node.depth === 1, via: node.via });
        continue;
      }
      if (scope === "production") existing.scope = "production";
      if (node.depth === 1) existing.direct = true;
      if ((existing.via?.length ?? 0) > node.via.length) existing.via = node.via;
    }
    for (const u of conf.unresolved) {
      const [group, name] = u.requested.split(":");
      if (!group || !name) continue;
      const key = `${group}:${name}`;
      if (!unresolved.has(key)) {
        unresolved.set(key, { name: key, resolution: "range", scope: scopeFor(conf.configuration), direct: u.depth === 1, via: u.via, registry: false, skip: "unresolved", note: `Gradle could not resolve it (${conf.configuration}): ${u.reason}`, ...(u.requested.split(":")[2] ? { spec: u.requested.split(":")[2] } : {}) });
      }
    }
  }
  return { path: file, ecosystem: "Maven", kind: "lockfile", manager: "gradle", dependencies: [...merged.values(), ...unresolved.values()], warnings: [], resolvedBy: `Gradle (${label}, resolved classpaths)` };
}

export async function resolveGradleProjects(
  files: Array<{ path: string; text?: string; context?: boolean }>,
  strategy: GradleStrategy,
  options: { signal?: AbortSignal; onLog?: (message: string) => void; onProgress?: (message: string) => void } = {}
): Promise<ResolutionOutcome> {
  const log = options.onLog ?? (() => undefined);
  const texts = new Map(files.filter(f => f.text !== undefined).map(f => [f.path, f.text as string]));
  const buildFiles = files.filter(f => !f.context && BUILD_FILES.includes(path.posix.basename(f.path)) && f.text !== undefined).map(f => f.path);
  const settingsDirs = files.filter(f => SETTINGS_FILES.includes(path.posix.basename(f.path))).map(f => dirOf(f.path));
  const out = new Map<string, ParsedFile>();
  const projects: BuildToolProject[] = [];

  // Each build file belongs to the nearest settings file above it (its build), or is a build on its own.
  const roots = new Map<string, string[]>();
  for (const file of buildFiles) {
    const dir = dirOf(file);
    const root = settingsDirs.filter(s => s === "" || dir === s || dir.startsWith(`${s}/`)).sort((a, b) => b.length - a.length)[0] ?? dir;
    roots.set(root, [...(roots.get(root) ?? []), file]);
  }

  for (const [root, members] of roots) {
    if (options.signal?.aborted) break;
    const pending = new Set(members);
    let detail: string | undefined;
    let method: BuildToolProject["method"] = "builtin";
    if (strategy.runCli) {
      options.onProgress?.(`Resolving the Gradle build ${root || "."} with ${strategy.cliLabel ?? "Gradle"}`);
      const started = Date.now();
      const run = await strategy.runCli(root, options.signal);
      if ("error" in run) detail = `${strategy.cliLabel ?? "Gradle"} could not run: ${run.error}`;
      else if (run.cancelled) detail = "Gradle was cancelled.";
      else {
        const byDir = new Map<string, GradleConfiguration[]>();
        for (const conf of run.configurations) {
          const rel = strategy.relativeDir(conf.dir);
          if (rel === undefined) continue;
          byDir.set(rel, [...(byDir.get(rel) ?? []), conf]);
        }
        for (const [dir, configurations] of byDir) {
          const file = members.find(m => dirOf(m) === dir) ?? join(dir, "build.gradle");
          out.set(file, fromConfigurations(file, configurations, strategy.cliLabel ?? "gradle"));
          pending.delete(file);
        }
        // A successful run that lists no classpath for a project (a root without the java plugin) means it has no dependencies.
        if (run.exitCode === 0 && !run.timedOut) {
          for (const file of [...pending]) {
            out.set(file, fromConfigurations(file, [], strategy.cliLabel ?? "gradle"));
            pending.delete(file);
          }
        }
        if (pending.size === 0) method = "build-tool";
        if (run.exitCode !== 0 || run.timedOut) {
          detail = `${strategy.cliLabel ?? "Gradle"} ${run.timedOut ? "timed out" : `exited with code ${run.exitCode}`}${pending.size ? `; ${pending.size} project${pending.size === 1 ? " was" : "s were"} read from build scripts instead` : ""}.${run.output ? `\n${run.output}` : ""}`;
        }
        log(`Gradle: ${byDir.size} project${byDir.size === 1 ? "" : "s"} resolved by Gradle for ${root || "."} in ${Date.now() - started} ms${run.exitCode ? ` (exit code ${run.exitCode})` : ""}`);
      }
      if (detail) log(`Gradle: ${detail}`);
    }

    if (pending.size) {
      // Build scripts as POMs: every project of this build, so project(':x') dependencies resolve too.
      const settingsText = SETTINGS_FILES.map(name => texts.get(join(root, name))).find(Boolean) ?? "";
      const projectDirs = new Map<string, string>([[":", root]]);
      for (const included of includedProjects(settingsText)) projectDirs.set(`:${included.replace(/\//g, ":")}`, join(root, included));
      const coordinate = (dir: string) => ({ group: "gradle-project", name: (dir.slice(root.length).replace(/^\//, "") || "root").replace(/\//g, ".") });
      const synthetic: Array<{ path: string; text: string }> = [];
      const unreadable = new Map<string, string[]>();
      const rootProps = gradleProperties([texts.get(join(root, "gradle.properties"))].filter((t): t is string => Boolean(t)));
      const defaults = buildDefaults([settingsText, ...members.map(m => texts.get(m) ?? "")], rootProps);
      for (const file of members) {
        const dir = dirOf(file);
        const props = gradleProperties([join(root, "gradle.properties"), join(dir, "gradle.properties")].map(p => texts.get(p)).filter((t): t is string => Boolean(t)));
        const model = readGradleBuild(texts.get(file) ?? "", props, defaults);
        // project(':lib') dependencies become dependencies on that project's POM.
        for (const m of (texts.get(file) ?? "").matchAll(/^\s*([a-zA-Z]*(?:[Ii]mplementation|[Aa]pi|[Rr]untimeOnly|[Cc]ompileOnly))\s*[( ]\s*project\s*\(\s*(?:path\s*:\s*)?["'](:[^"']*)["']\s*\)/gm)) {
          const target = projectDirs.get(m[2]) ?? join(root, m[2].replace(/^:/, "").replace(/:/g, "/"));
          const c = coordinate(target);
          model.dependencies.push({ group: c.group, name: c.name, version: "0", scope: /^test/i.test(m[1]) ? "test" : /compileOnly$/i.test(m[1]) ? "provided" : /runtimeOnly$/i.test(m[1]) ? "runtime" : "compile", line: 0 });
        }
        unreadable.set(file, model.unreadable);
        synthetic.push({ path: join(dir, "pom.xml"), text: gradleBuildToPom(model, coordinate(dir)) });
      }
      const resolver = new MavenResolver(synthetic, strategy.repository, options.signal);
      for (const file of members) {
        if (!pending.has(file) || options.signal?.aborted) continue;
        const resolution = await resolver.resolveModule(join(dirOf(file), "pom.xml"), { conflict: "highest" });
        const text = texts.get(file) ?? "";
        const lineOf = (artifact: string) => { const i = text.indexOf(`:${artifact}`); return i < 0 ? undefined : text.slice(0, i).split("\n").length; };
        const dependencies: ParsedDependency[] = [
          ...resolution.dependencies.filter(d => d.groupId !== "gradle-project").map(d => ({
            name: `${d.groupId}:${d.artifactId}`, version: d.version, resolution: "declared" as const,
            scope: d.scope === "test" ? "development" as const : "production" as const, direct: d.depth === 1,
            via: d.via.filter(v => !v.startsWith("gradle-project:")),
            note: "Resolved from the build script without running Gradle; Gradle may resolve differently. Allow build tools for exact results.",
            ...(d.depth === 1 ? { line: lineOf(d.artifactId) } : {})
          })),
          ...resolution.unresolved.map(u => ({
            name: `${u.groupId}:${u.artifactId}`, resolution: "range" as const, scope: "production" as const, direct: u.depth === 1, via: u.via,
            registry: false, skip: "unresolved" as const, note: u.reason, ...(u.declared ? { spec: u.declared } : {})
          }))
        ];
        const notes = [...resolution.problems, ...(unreadable.get(file) ?? []).slice(0, 5).map(line => `Not read (version catalog alias or code): ${line}`)];
        out.set(file, { path: file, ecosystem: "Maven", kind: "manifest", manager: "gradle", dependencies, warnings: notes.slice(0, 25), resolvedBy: `DevSnip Pro's Gradle reader (${strategy.repositoryLabel})` });
        log(`Gradle: ${file} read from the build script: ${dependencies.filter(d => d.version).length} dependencies, ${resolution.unresolved.length} unresolved`);
      }
    }
    const projectFiles = members.map(m => out.get(m)).filter((f): f is ParsedFile => Boolean(f));
    projects.push({
      tool: "Gradle",
      project: root ? `${root}/` : "./",
      method,
      modules: members.length,
      dependencies: new Set(projectFiles.flatMap(f => f.dependencies.filter(d => d.version).map(d => `${d.name}@${d.version}`))).size,
      unresolved: new Set(projectFiles.flatMap(f => f.dependencies.filter(d => d.skip === "unresolved").map(d => d.name))).size,
      ...(detail ? { detail } : {})
    });
  }
  return { files: out, projects };
}
