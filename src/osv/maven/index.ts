import type { ManagedOrigin, ParsedDependency, ParsedFile, DependencyScope } from "../types";
import type { MavenRunResult } from "./cli";
import { gavString, MavenResolver, ModuleResolution, PomRepository } from "./resolver";
import type { ModuleTree } from "./tree";

/**
 * Turns the Maven projects in a scan into resolved dependency lists, one per
 * module, with transitive dependencies and their real versions.
 *
 * Per reactor (a root POM and its `<modules>`):
 *  1. Maven itself (`mvn dependency:tree`), when the caller allows it: authoritative.
 *  2. Otherwise, or for modules Maven did not report, the built-in resolver
 *     (workspace POMs, then the local repository, then remote repositories).
 * Dependencies whose version cannot be determined are listed with the reason
 * and counted as unresolved; nothing gets a guessed version.
 */

export interface MavenStrategy {
  /** Runs `mvn dependency:tree` in the directory of `rootPom` (workspace-relative); omit to never run Maven. */
  runCli?: (rootPom: string, signal?: AbortSignal) => Promise<MavenRunResult | { error: string }>;
  /** "./mvnw" or "mvn", for messages. */
  cliLabel?: string;
  repository: PomRepository;
  /** Where the built-in resolver reads POMs from, for messages. */
  repositoryLabel: string;
}

/** How one build (a Maven reactor or a Gradle build) was resolved. */
export interface BuildToolProject {
  tool: "Maven" | "Gradle";
  project: string;
  /** build-tool: Maven or Gradle produced the tree; builtin: DevSnip Pro resolved it. */
  method: "build-tool" | "builtin";
  modules: number;
  dependencies: number;
  unresolved: number;
  detail?: string;
}

export interface ResolutionOutcome {
  /** A resolved file per module or project, keyed by its pom.xml / build.gradle path. */
  files: Map<string, ParsedFile>;
  projects: BuildToolProject[];
}
/** @deprecated name kept for readability in Maven code. */
export type MavenOutcome = ResolutionOutcome;

function scopeOf(scope: string, optional: boolean): DependencyScope {
  if (scope === "test") return "development";
  return optional ? "optional" : "production";
}

function lineFinder(text: string | undefined): (artifactId: string) => number | undefined {
  if (!text) return () => undefined;
  return artifactId => {
    const index = text.indexOf(`<artifactId>${artifactId}</artifactId>`);
    return index < 0 ? undefined : text.slice(0, index).split("\n").length;
  };
}

function fromTree(file: string, tree: ModuleTree, internal: Set<string>, text: string | undefined, label: string, management = new Map<string, ManagedOrigin>()): ParsedFile {
  const line = lineFinder(text);
  const dependencies: ParsedDependency[] = tree.nodes
    .filter(node => !internal.has(`${node.groupId}:${node.artifactId}`))
    .map(node => ({
      name: `${node.groupId}:${node.artifactId}`,
      version: node.version,
      resolution: "lockfile" as const,
      scope: scopeOf(node.scope, node.optional),
      direct: node.depth === 1,
      via: node.via,
      ...(management.get(`${node.groupId}:${node.artifactId}`)?.version === node.version ? { managedBy: management.get(`${node.groupId}:${node.artifactId}`) } : {}),
      ...(node.depth === 1 ? { line: line(node.artifactId) } : {}),
      ...(node.classifier ? { note: `Classifier ${node.classifier}.` } : {})
    }));
  return { path: file, ecosystem: "Maven", kind: "lockfile", manager: "maven", dependencies, warnings: [], resolvedBy: `Maven (${label} dependency:tree)` };
}

function fromResolution(resolution: ModuleResolution, text: string | undefined, label: string): ParsedFile {
  const line = lineFinder(text);
  const dependencies: ParsedDependency[] = [
    ...resolution.dependencies.filter(d => !d.internal).map(d => ({
      name: `${d.groupId}:${d.artifactId}`,
      version: d.version,
      resolution: "lockfile" as const,
      scope: scopeOf(d.scope, d.optional),
      direct: d.depth === 1,
      via: d.via,
      ...(d.managed ? { managedBy: d.managed } : {}),
      ...(d.depth === 1 ? { line: line(d.artifactId) } : {})
    })),
    ...resolution.unresolved.map(u => ({
      name: `${u.groupId}:${u.artifactId}`,
      resolution: "range" as const,
      scope: "production" as const,
      direct: u.depth === 1,
      via: u.via,
      registry: false,
      skip: "unresolved" as const,
      note: u.reason,
      ...(u.declared ? { spec: u.declared } : {}),
      ...(u.depth === 1 ? { line: line(u.artifactId) } : {})
    }))
  ];
  return {
    path: resolution.path, ecosystem: "Maven", kind: "lockfile", manager: "maven", dependencies,
    warnings: resolution.problems.slice(0, 25),
    resolvedBy: `DevSnip Pro's Maven resolver (${label})`
  };
}

export async function resolveMavenProjects(
  poms: Array<{ path: string; text?: string; context?: boolean }>,
  strategy: MavenStrategy,
  options: { signal?: AbortSignal; onLog?: (message: string) => void; onProgress?: (message: string) => void } = {}
): Promise<MavenOutcome> {
  const log = options.onLog ?? (() => undefined);
  const texts = new Map(poms.filter(p => p.text !== undefined).map(p => [p.path, p.text as string]));
  const resolver = new MavenResolver([...texts].map(([path, text]) => ({ path, text })), strategy.repository, options.signal);
  for (const [file, reason] of resolver.invalid) log(`Maven: ${file} is not a readable POM: ${reason}`);
  const files = new Map<string, ParsedFile>();
  const projects: BuildToolProject[] = [];
  const internal = new Set<string>();
  for (const file of texts.keys()) {
    const gav = resolver.workspaceGav(file);
    if (gav) internal.add(`${gav.groupId}:${gav.artifactId}`);
  }

  // POMs marked as context (a parent above a chosen file) are resolved through, never reported.
  const targets = new Set(poms.filter(p => !p.context && p.text !== undefined).map(p => p.path));
  for (const root of resolver.reactorRoots()) {
    if (options.signal?.aborted) break;
    const modules = resolver.reactorModules(root).filter(module => targets.has(module));
    if (!modules.length) continue;
    const pending = new Set(modules);
    let detail: string | undefined;
    let method: BuildToolProject["method"] = "builtin";
    if (strategy.runCli) {
      options.onProgress?.(`Resolving ${root} with ${strategy.cliLabel ?? "Maven"}`);
      log(`Maven: running ${strategy.cliLabel ?? "mvn"} dependency:tree for ${root} (${modules.length} module${modules.length === 1 ? "" : "s"})`);
      const started = Date.now();
      const run = await strategy.runCli(root, options.signal);
      if ("error" in run) {
        detail = `${strategy.cliLabel ?? "Maven"} could not run: ${run.error}`;
      } else if (run.cancelled) {
        detail = "Maven was cancelled.";
      } else {
        for (const module of modules) {
          const gav = resolver.workspaceGav(module);
          const tree = gav && run.trees.find(t => t.groupId === gav.groupId && t.artifactId === gav.artifactId);
          if (!tree) continue;
          // What manages each version (Spring Boot's BOM, a property, your POM), from the POMs; best effort.
          const management = await resolver.managementOf(module).catch(() => new Map<string, ManagedOrigin>());
          files.set(module, fromTree(module, tree, internal, texts.get(module), strategy.cliLabel ?? "mvn", management));
          pending.delete(module);
        }
        if (pending.size === 0) method = "build-tool";
        if (run.exitCode !== 0 || run.timedOut) {
          detail = `${strategy.cliLabel ?? "Maven"} ${run.timedOut ? "timed out" : `exited with code ${run.exitCode}`}${pending.size ? `; ${pending.size} module${pending.size === 1 ? " was" : "s were"} resolved by the built-in resolver instead` : ""}.${run.output ? `\n${run.output}` : ""}`;
        }
        log(`Maven: ${modules.length - pending.size}/${modules.length} module trees from Maven in ${Date.now() - started} ms${run.exitCode ? ` (exit code ${run.exitCode})` : ""}`);
      }
      if (detail) log(`Maven: ${detail}`);
    }
    if (pending.size) {
      options.onProgress?.(`Resolving ${root} with the built-in Maven resolver`);
      for (const module of modules) {
        if (!pending.has(module) || options.signal?.aborted) continue;
        const started = Date.now();
        const resolution = await resolver.resolveModule(module);
        files.set(module, fromResolution(resolution, texts.get(module), strategy.repositoryLabel));
        log(`Maven: ${module} (${gavString(resolution.gav)}) resolved by the built-in resolver: ${resolution.dependencies.filter(d => !d.internal).length} dependencies, ${resolution.unresolved.length} unresolved, ${resolution.problems.length} notes, ${Date.now() - started} ms`);
        for (const problem of resolution.problems.slice(0, 10)) log(`Maven:   ${problem}`);
      }
    }
    const moduleFiles = modules.map(m => files.get(m)).filter((f): f is ParsedFile => Boolean(f));
    projects.push({
      tool: "Maven",
      project: root,
      method,
      modules: modules.length,
      dependencies: new Set(moduleFiles.flatMap(f => f.dependencies.filter(d => d.version).map(d => `${d.name}@${d.version}`))).size,
      unresolved: new Set(moduleFiles.flatMap(f => f.dependencies.filter(d => d.skip === "unresolved").map(d => d.name))).size,
      ...(detail ? { detail } : {})
    });
  }
  // A POM that is not valid XML cannot be resolved or read: report it as unreadable, never as "0 dependencies".
  for (const [file, reason] of resolver.invalid) {
    if (!targets.has(file) || files.has(file)) continue;
    files.set(file, { path: file, ecosystem: "Maven", kind: "manifest", manager: "maven", dependencies: [], warnings: [], error: `Not a readable POM: ${reason}` });
  }
  log(`Maven: POMs from the workspace ${resolver.stats.pomsFromWorkspace}, from repositories ${resolver.stats.pomsFetched}, not found ${resolver.stats.pomsMissing}`);
  return { files, projects };
}
