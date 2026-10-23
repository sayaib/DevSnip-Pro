import * as path from "path";
import { compareMaven } from "../../services/dependency-versions";
import { spansFromInterval, spanContains } from "../versions";
import { parsePomXml, PomDependency, PomError, PomExclusion, RawPom } from "./pom";
import type { ManagedOrigin } from "../types";
export type { ManagedOrigin } from "../types";

/**
 * A Maven dependency resolver, for when the Maven CLI is not available or not allowed.
 *
 * It follows Maven 3's documented rules:
 *  - effective model: parent inheritance (workspace `relativePath` first, then
 *    repositories), properties interpolated in the child's context (so a
 *    property override in your POM changes a version managed by the Spring
 *    Boot parent, as it does in Maven), active-by-default profiles;
 *  - dependency management: explicit entries (child before parents) win over
 *    imported BOMs, and imports are applied in declaration order;
 *  - the graph: nearest definition wins (ties: first declared), the root's
 *    dependency management overrides transitive versions and scopes, test and
 *    provided dependencies are not transitive, optional dependencies of
 *    dependencies are left out, exclusions accumulate down the path, scope
 *    transitions follow Maven's table, and a narrower scope is widened when
 *    another path needs it, and relocations are followed.
 *
 * Anything it cannot decide (a POM it cannot find, an undefined property, a
 * version range) is reported as unresolved with the reason instead of guessed.
 */

export interface Gav { groupId: string; artifactId: string; version: string }

export const gavString = (g: Gav) => `${g.groupId}:${g.artifactId}:${g.version}`;

export type PomLookup = { text: string; origin: string } | { error: string };

/** Finds POMs that are not in the workspace (local repository, remote repositories). */
export interface PomRepository {
  fetch(gav: Gav, repositories: string[], signal?: AbortSignal): Promise<PomLookup>;
  /** Published versions of an artifact (maven-metadata.xml), for resolving version ranges. */
  versions?(groupId: string, artifactId: string, repositories: string[], signal?: AbortSignal): Promise<string[] | { error: string }>;
}

/**
 * Where a managed version comes from, so remediation can name what actually controls it.
 *  - workspace: dependencyManagement in a POM of this workspace (edit it there);
 *  - parent:    an external parent POM, such as spring-boot-starter-parent (override its property, or upgrade the parent);
 *  - import:    an imported BOM (Maven: pin it in your own dependencyManagement, or upgrade the BOM;
 *               Gradle with Spring's dependency-management plugin can override the BOM's property).
 */
type Managed = PomDependency & { origin?: Omit<ManagedOrigin, "version"> };

export interface ResolvedDependency {
  groupId: string;
  artifactId: string;
  version: string;
  classifier?: string;
  type: string;
  scope: string;
  optional: boolean;
  depth: number;
  /** Coordinates (group:artifact:version) from the module's direct dependency down to this one's parent. */
  via: string[];
  /** Another module of this workspace (not queried: it is your own code). */
  internal: boolean;
  /** Set when the version comes from dependency management (a parent, a BOM, or your own POM). */
  managed?: ManagedOrigin;
}

export interface UnresolvedDependency {
  groupId: string;
  artifactId: string;
  depth: number;
  via: string[];
  reason: string;
  /** The declared version text, when there was one (a range, an undefined property). */
  declared?: string;
}

export interface ModuleResolution {
  /** Workspace path of the module's pom.xml. */
  path: string;
  gav: Gav;
  packaging: string;
  dependencies: ResolvedDependency[];
  unresolved: UnresolvedDependency[];
  problems: string[];
}

export const MAVEN_CENTRAL = "https://repo.maven.apache.org/maven2";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

interface Model {
  id: string;
  path?: string;
  raw: RawPom;
  gav: Gav;
  packaging: string;
  properties: Record<string, string>;
  /** Uninterpolated, child first: interpolation happens in the context of the model being built. */
  dependencies: PomDependency[];
  explicitManaged: Managed[];
  imports: PomDependency[];
  repositories: string[];
  problems: string[];
  relocation?: RawPom["relocation"];
  /** Gradle (Spring's dependency-management plugin): properties that override imported BOMs' own properties. */
  overrides?: Record<string, string>;
}

interface Effective {
  model: Model;
  dependencies: PomDependency[];
  managed: Map<string, Managed>;
}

const managementKey = (d: { groupId: string; artifactId: string; type?: string; classifier?: string }) =>
  `${d.groupId}:${d.artifactId}:${d.type ?? "jar"}:${d.classifier ?? ""}`;
const conflictKey = (d: { groupId: string; artifactId: string; classifier?: string }) => `${d.groupId}:${d.artifactId}:${d.classifier ?? ""}`;
const hasExpression = (value: string | undefined) => value !== undefined && value.includes("${");

export function interpolate(value: string, properties: Record<string, string>, depth = 0): string {
  if (!value.includes("${") || depth > 12) return value;
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
    const resolved = properties[key];
    return resolved === undefined ? match : interpolate(resolved, properties, depth + 1);
  });
}

/** A version Maven would treat as a range (resolved from repository metadata, which is not read here). */
export function isVersionRange(version: string): boolean {
  return /^[[(]/.test(version.trim()) || /,/.test(version);
}

const SCOPE_RANK: Record<string, number> = { compile: 4, runtime: 3, provided: 2, system: 2, test: 1 };

/** Maven's scope of a transitive dependency, or undefined when it is not transitive. */
export function transitiveScope(parent: string, child: string): string | undefined {
  if (child === "test" || child === "provided" || child === "system" || child === "import") return undefined;
  switch (parent) {
    case "compile": return child === "runtime" ? "runtime" : "compile";
    case "runtime": return "runtime";
    case "provided": return "provided";
    case "test": return "test";
    default: return undefined;
  }
}

function excluded(dep: { groupId: string; artifactId: string }, exclusions: PomExclusion[]): boolean {
  return exclusions.some(ex => (ex.groupId === "*" || ex.groupId === dep.groupId) && (ex.artifactId === "*" || ex.artifactId === dep.artifactId));
}

export class MavenResolver {
  private readonly workspace = new Map<string, RawPom>();
  private readonly workspaceErrors = new Map<string, string>();
  private readonly workspaceByGav = new Map<string, string>();
  private readonly models = new Map<string, Promise<Model | { error: string }>>();
  private readonly effectives = new Map<string, Promise<Effective>>();
  private readonly repositories = new Set<string>([MAVEN_CENTRAL]);
  readonly stats = { pomsFromWorkspace: 0, pomsFetched: 0, pomsMissing: 0 };

  /**
   * `importOverrides` gives Gradle semantics: a project's properties override the same-named properties of the
   * BOMs it imports (and of the BOMs those import), as Spring's dependency-management plugin does. Maven never does this.
   */
  constructor(workspacePoms: Array<{ path: string; text: string }>, private readonly repository: PomRepository, private readonly signal?: AbortSignal, private readonly options: { importOverrides?: boolean } = {}) {
    for (const pom of workspacePoms) {
      try {
        this.workspace.set(pom.path, parsePomXml(pom.text));
      } catch (error) {
        this.workspaceErrors.set(pom.path, error instanceof Error ? error.message : String(error));
      }
    }
    for (const [file, raw] of this.workspace) {
      const gav = this.rawGav(raw, file);
      if (gav) this.workspaceByGav.set(gavString(gav), file);
    }
  }

  /** Workspace POMs that could not be read, with the reason. */
  get invalid(): Map<string, string> { return this.workspaceErrors; }

  /** Workspace modules that are not a `<module>` of another workspace POM: the reactor roots. */
  reactorRoots(): string[] {
    const children = new Set<string>();
    for (const [file, raw] of this.workspace) {
      const dir = path.posix.dirname(file);
      for (const module of [...raw.modules, ...raw.profiles.flatMap(p => p.modules)]) {
        const target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, module));
        children.add(target.endsWith(".xml") ? target : `${target}/pom.xml`.replace(/^\.\//, ""));
      }
    }
    return [...this.workspace.keys()].filter(file => !children.has(file));
  }

  /** Every module of the reactor rooted at `root` (including the root). */
  reactorModules(root: string): string[] {
    const out: string[] = [];
    const visit = (file: string) => {
      if (out.includes(file) || !this.workspace.has(file)) return;
      out.push(file);
      const raw = this.workspace.get(file)!;
      const dir = path.posix.dirname(file);
      for (const module of [...raw.modules, ...raw.profiles.filter(p => p.activeByDefault).flatMap(p => p.modules)]) {
        const target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, module));
        visit(target.endsWith(".xml") ? target : `${target}/pom.xml`);
      }
    };
    visit(root);
    return out;
  }

  /** The workspace parent a POM's `<parent>` points at through `relativePath`, if it is there. */
  private workspaceParent(file: string, raw: RawPom): string | undefined {
    const p = raw.parent;
    if (!p || p.relativePath === "") return undefined;
    const dir = path.posix.dirname(file);
    let candidate = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, p.relativePath ?? "../pom.xml"));
    if (!candidate.endsWith(".xml")) candidate = `${candidate}/pom.xml`;
    candidate = candidate.replace(/^\.\//, "");
    const local = this.workspace.get(candidate);
    return local && local.artifactId === p.artifactId && (local.groupId ?? local.parent?.groupId) === p.groupId ? candidate : undefined;
  }

  /** Properties along the workspace parent chain (CI-friendly `${revision}` lives in the root POM). */
  private workspaceProperties(file: string, seen: string[] = []): Record<string, string> {
    const raw = this.workspace.get(file);
    if (!raw || seen.includes(file)) return {};
    const parent = this.workspaceParent(file, raw);
    return { ...(parent ? this.workspaceProperties(parent, [...seen, file]) : {}), ...raw.properties };
  }

  /** Coordinates of a workspace POM, inheriting groupId/version from its parent element. */
  private rawGav(raw: RawPom, file?: string): Gav | undefined {
    const groupId = raw.groupId ?? raw.parent?.groupId;
    const version = raw.version ?? raw.parent?.version;
    if (!groupId || !version) return undefined;
    const props = file ? this.workspaceProperties(file) : { ...raw.properties };
    return { groupId: interpolate(groupId, props), artifactId: raw.artifactId, version: interpolate(version, props) };
  }

  workspaceGav(file: string): Gav | undefined {
    const raw = this.workspace.get(file);
    return raw ? this.rawGav(raw, file) : undefined;
  }

  private async loadModel(source: { path: string } | { gav: Gav }, chain: string[]): Promise<Model | { error: string }> {
    const id = "path" in source ? `ws:${source.path}` : gavString(source.gav);
    if (chain.includes(id)) return { error: `Parent cycle: ${[...chain, id].join(" → ")}` };
    let promise = this.models.get(id);
    if (!promise) {
      promise = this.buildModel(source, id, chain);
      this.models.set(id, promise);
    }
    return promise;
  }

  private async rawFor(source: { path: string } | { gav: Gav }): Promise<{ raw: RawPom; path?: string } | { error: string }> {
    if ("path" in source) {
      const raw = this.workspace.get(source.path);
      if (raw) { this.stats.pomsFromWorkspace++; return { raw, path: source.path }; }
      return { error: this.workspaceErrors.get(source.path) ?? `${source.path} is not in the workspace.` };
    }
    const local = this.workspaceByGav.get(gavString(source.gav));
    if (local) { this.stats.pomsFromWorkspace++; return { raw: this.workspace.get(local)!, path: local }; }
    const found = await this.repository.fetch(source.gav, [...this.repositories], this.signal);
    if ("error" in found) { this.stats.pomsMissing++; return found; }
    this.stats.pomsFetched++;
    try {
      return { raw: parsePomXml(found.text) };
    } catch (error) {
      return { error: `The POM of ${gavString(source.gav)} from ${found.origin} could not be read: ${error instanceof PomError ? error.message : String(error)}` };
    }
  }

  private async buildModel(source: { path: string } | { gav: Gav }, id: string, chain: string[]): Promise<Model | { error: string }> {
    const loaded = await this.rawFor(source);
    if ("error" in loaded) return loaded;
    const { raw } = loaded;
    const problems: string[] = [];
    let parent: Model | undefined;
    if (raw.parent) {
      const p = raw.parent;
      const parentVersion = interpolate(p.version, loaded.path ? this.workspaceProperties(loaded.path) : raw.properties);
      let parentSource: { path: string } | { gav: Gav } | undefined;
      const workspaceParent = loaded.path ? this.workspaceParent(loaded.path, raw) : undefined;
      if (workspaceParent) parentSource = { path: workspaceParent };
      parentSource ??= { gav: { groupId: p.groupId, artifactId: p.artifactId, version: parentVersion } };
      if ("gav" in parentSource && hasExpression(parentVersion)) {
        problems.push(`The parent version ${p.version} uses a property that is not defined where Maven reads it.`);
      } else {
        const loadedParent = await this.loadModel(parentSource, [...chain, id]);
        if ("error" in loadedParent) problems.push(`Parent POM ${p.groupId}:${p.artifactId}:${parentVersion} could not be loaded: ${loadedParent.error}`);
        else parent = loadedParent;
      }
    }
    const active = raw.profiles.filter(profile => profile.activeByDefault);
    const groupId = raw.groupId ?? raw.parent?.groupId ?? "";
    const version = raw.version ?? raw.parent?.version ?? "";
    const properties: Record<string, string> = { ...(parent?.properties ?? {}) };
    for (const profile of active) Object.assign(properties, profile.properties);
    Object.assign(properties, raw.properties);
    const gav: Gav = { groupId: interpolate(groupId, properties), artifactId: raw.artifactId, version: interpolate(version, properties) };
    const builtins: Record<string, string> = {
      "project.groupId": gav.groupId, "project.artifactId": gav.artifactId, "project.version": gav.version, "project.packaging": raw.packaging,
      "pom.groupId": gav.groupId, "pom.artifactId": gav.artifactId, "pom.version": gav.version,
      groupId: gav.groupId, artifactId: gav.artifactId, version: gav.version
    };
    if (raw.parent) {
      Object.assign(builtins, {
        "project.parent.groupId": raw.parent.groupId, "project.parent.artifactId": raw.parent.artifactId,
        "project.parent.version": interpolate(raw.parent.version, properties), "parent.version": interpolate(raw.parent.version, properties)
      });
    }
    Object.assign(properties, builtins);
    // Only user-settable properties: ${project.version} and other built-ins cannot be overridden by a build.
    const property = (version: string | undefined) => {
      const name = /^\$\{([^}]+)\}$/.exec(version?.trim() ?? "")?.[1];
      return name && !/^(?:project|pom|parent|env|settings|session)\.|^(?:version|groupId|artifactId|basedir)$/.test(name) ? name : undefined;
    };
    const ownManaged: Managed[] = [...raw.managed, ...active.flatMap(p => p.managed)].map(d => ({
      ...d,
      origin: { kind: loaded.path ? "workspace" as const : "parent" as const, source: gavString(gav), ...(loaded.path ? { path: loaded.path } : {}), ...(property(d.version) ? { property: property(d.version) } : {}) }
    }));
    const isImport = (d: PomDependency) => d.scope === "import" && d.type === "pom";
    for (const repo of raw.repositories) if (/^https:\/\//i.test(repo)) this.repositories.add(repo.replace(/\/+$/, ""));
    return {
      id, path: loaded.path, raw, gav, packaging: raw.packaging, properties,
      dependencies: [...raw.dependencies, ...active.flatMap(p => p.dependencies), ...(parent?.dependencies ?? [])],
      explicitManaged: [...ownManaged.filter(d => !isImport(d)), ...(parent?.explicitManaged ?? [])],
      imports: [...ownManaged.filter(isImport), ...(parent?.imports ?? [])],
      repositories: [...raw.repositories, ...(parent?.repositories ?? [])],
      problems: [...problems, ...(parent?.problems ?? [])],
      relocation: raw.relocation
    };
  }

  private interpolated(dep: PomDependency, properties: Record<string, string>): PomDependency {
    return {
      ...dep,
      groupId: interpolate(dep.groupId, properties),
      artifactId: interpolate(dep.artifactId, properties),
      version: dep.version === undefined ? undefined : interpolate(dep.version, properties),
      type: interpolate(dep.type, properties),
      classifier: dep.classifier === undefined ? undefined : interpolate(dep.classifier, properties),
      scope: dep.scope === undefined ? undefined : interpolate(dep.scope, properties)
    };
  }

  private effective(model: Model, chain: string[] = []): Promise<Effective> {
    let promise = this.effectives.get(model.id);
    if (!promise) {
      promise = this.buildEffective(model, chain);
      this.effectives.set(model.id, promise);
    }
    return promise;
  }

  /** The BOM as the importing model sees it: with Gradle-style property overrides applied (a distinct model id, so it is cached apart). */
  private overridden(bom: Model, importer: Model): Model {
    if (!this.options.importOverrides) return bom;
    const source = importer.overrides ?? importer.raw.properties ?? {};
    const entries = Object.entries(source);
    if (!entries.length) return bom;
    const applied = entries.filter(([key, value]) => key in bom.properties && bom.properties[key] !== value);
    return {
      ...bom,
      // The override set is part of the id: nested BOMs see the same overrides, and results are cached per set.
      id: `${bom.id}#${entries.map(([k, v]) => `${k}=${v}`).sort().join("&")}`,
      properties: { ...bom.properties, ...Object.fromEntries(applied) },
      overrides: { ...source }
    };
  }

  private async buildEffective(model: Model, chain: string[]): Promise<Effective> {
    const managed = new Map<string, Managed>();
    for (const dep of model.explicitManaged) {
      const d = this.interpolated(dep, model.properties);
      const key = managementKey(d);
      if (!managed.has(key)) managed.set(key, d);
    }
    // Imported BOMs: fetched together, applied in declaration order, never overriding explicit entries.
    const imports = model.imports.map(dep => this.interpolated(dep, model.properties));
    const boms = await Promise.all(imports.map(async imp => {
      if (!imp.version || hasExpression(imp.version)) return { error: `The BOM ${imp.groupId}:${imp.artifactId} has an unresolved version (${imp.version ?? "none"}).` };
      const gav = { groupId: imp.groupId, artifactId: imp.artifactId, version: imp.version };
      if (chain.includes(gavString(gav))) return { error: `BOM import cycle at ${gavString(gav)}` };
      const bomModel = await this.loadModel({ gav }, []);
      if ("error" in bomModel) return { error: `BOM ${gavString(gav)} could not be loaded: ${bomModel.error}` };
      return { effective: await this.effective(this.overridden(bomModel, model), [...chain, model.id, gavString(gav)]), gav };
    }));
    for (const bom of boms) {
      if ("error" in bom) { if (!model.problems.includes(bom.error!)) model.problems.push(bom.error!); continue; }
      for (const [key, entry] of bom.effective!.managed) {
        if (managed.has(key)) continue;
        // Seen from this model, everything a BOM brings is "import", named after the BOM imported here.
        const declared = imports[boms.indexOf(bom)] as Managed;
        const via = declared.origin && declared.origin.kind !== "import"
          ? { kind: declared.origin.kind, source: declared.origin.source, ...(declared.origin.path ? { path: declared.origin.path } : {}), ...(declared.origin.property ? { property: declared.origin.property } : {}) }
          : undefined;
        const nested = entry.origin?.kind === "import";
        managed.set(key, {
          ...entry,
          origin: {
            ...(entry.origin ?? { source: gavString(bom.gav!) }),
            kind: "import",
            bom: gavString(bom.gav!),
            ...(via ? { importedBy: via } : {}),
            // The innermost BOM keeps its own name and the property its import reads.
            ...(nested ? {} : { directBom: gavString(bom.gav!), ...(via?.property ? { directBomProperty: via.property } : {}) })
          }
        });
      }
    }
    const seen = new Set<string>();
    const dependencies: PomDependency[] = [];
    for (const raw of model.dependencies) {
      const d = this.interpolated(raw, model.properties);
      const key = managementKey(d);
      if (seen.has(key)) continue; // the child's declaration wins over an inherited one
      seen.add(key);
      const m = managed.get(key);
      dependencies.push({
        ...d,
        version: d.version ?? m?.version,
        scope: d.scope ?? m?.scope,
        exclusions: [...d.exclusions, ...(m?.exclusions ?? [])]
      });
    }
    return { model, dependencies, managed };
  }

  /** The effective model of a published artifact, following relocations. */
  private async artifact(gav: Gav): Promise<{ effective: Effective; gav: Gav } | { error: string }> {
    let current = gav;
    for (let hop = 0; hop < 4; hop++) {
      const model = await this.loadModel({ gav: current }, []);
      if ("error" in model) return model;
      const relocation = model.relocation;
      if (relocation && (relocation.groupId || relocation.artifactId || relocation.version)) {
        const next = { groupId: relocation.groupId ?? current.groupId, artifactId: relocation.artifactId ?? current.artifactId, version: relocation.version ?? current.version };
        if (gavString(next) === gavString(current)) break;
        current = next;
        continue;
      }
      return { effective: await this.effective(model), gav: current };
    }
    return { error: `Too many relocations from ${gavString(gav)}.` };
  }

  /** Maven's choice for a version range: the highest published version inside it. */
  private async highestInRange(groupId: string, artifactId: string, range: string): Promise<{ version: string } | { error: string }> {
    const spans = spansFromInterval(range);
    if (!spans) return { error: "the range could not be read." };
    if (!this.repository.versions) return { error: "repository metadata is not available to pick a version." };
    const versions = await this.repository.versions(groupId, artifactId, [...this.repositories], this.signal);
    if (!Array.isArray(versions)) return { error: `its published versions could not be read (${versions.error})` };
    const matching = versions.filter(v => !/-SNAPSHOT$/i.test(v) && spans.some(span => spanContains(span, v, compareMaven)));
    if (!matching.length) return { error: "no published version is inside it." };
    return { version: matching.reduce((best, v) => (compareMaven(v, best) > 0 ? v : best)) };
  }

  /**
   * The version a published BOM (or parent) manages for one artifact, loading
   * only what is needed: the BOM with its parents, then, when the artifact is
   * not managed there directly, the imported BOM named by `via` (or each import
   * in order). A full effective model would load every nested BOM, which is
   * dozens of POMs for spring-boot-dependencies.
   */
  async managedVersion(bom: Gav, groupId: string, artifactId: string, via?: { groupId: string; artifactId: string }, depth = 0): Promise<string | undefined> {
    if (depth > 4) return undefined;
    const model = await this.loadModel({ gav: bom }, []);
    if ("error" in model) return undefined;
    for (const entry of model.explicitManaged) {
      const d = this.interpolated(entry, model.properties);
      if (d.groupId === groupId && d.artifactId === artifactId && d.version && !hasExpression(d.version)) return d.version;
    }
    const imports = model.imports.map(dep => this.interpolated(dep, model.properties)).filter(d => d.version && !hasExpression(d.version));
    const ordered = via ? [...imports.filter(d => d.groupId === via.groupId && d.artifactId === via.artifactId), ...imports.filter(d => !(d.groupId === via.groupId && d.artifactId === via.artifactId))] : imports;
    for (const imp of ordered) {
      const found = await this.managedVersion({ groupId: imp.groupId, artifactId: imp.artifactId, version: imp.version! }, groupId, artifactId, undefined, depth + 1);
      if (found) return found;
      if (via) break; // the BOM that managed it before does not any more: do not load every other import to look for it
    }
    return undefined;
  }

  /**
   * Where each version managed for a workspace module comes from, keyed "group:artifact".
   * Used to explain what controls a vulnerable version (Spring Boot's BOM, a property, your own POM).
   */
  async managementOf(file: string): Promise<Map<string, ManagedOrigin>> {
    const out = new Map<string, ManagedOrigin>();
    const model = await this.loadModel({ path: file }, []);
    if ("error" in model) return out;
    const root = await this.effective(model);
    for (const entry of root.managed.values()) {
      const key = `${entry.groupId}:${entry.artifactId}`;
      if (!entry.version || hasExpression(entry.version) || out.has(key) || !entry.origin) continue;
      out.set(key, { ...entry.origin, version: entry.version });
    }
    return out;
  }

  /**
   * Resolves the dependency graph of one workspace module.
   * conflict "nearest" is Maven's rule; "highest" is Gradle's (the highest
   * requested version wins), applied until no request is higher than its
   * selection. Versions the root's dependency management sets are enforced
   * either way (Maven's dependencyManagement, Spring's dependency-management plugin).
   */
  async resolveModule(file: string, options: { conflict?: "nearest" | "highest" } = {}): Promise<ModuleResolution> {
    if (options.conflict !== "highest") return (await this.resolveGraph(file, new Map())).resolution;
    const forced = new Map<string, string>();
    for (let round = 0; round < 10; round++) {
      const { resolution, requested, managed } = await this.resolveGraph(file, forced);
      let raised = false;
      for (const [key, versions] of requested) {
        if (managed.has(key)) continue;
        const highest = versions.reduce((best, v) => (compareMaven(v, best) > 0 ? v : best));
        const selected = forced.get(key) ?? resolution.dependencies.find(d => conflictKey(d) === key)?.version;
        if (selected && compareMaven(highest, selected) > 0) { forced.set(key, highest); raised = true; }
      }
      if (!raised) return resolution;
    }
    return (await this.resolveGraph(file, forced)).resolution;
  }

  private async resolveGraph(file: string, forced: Map<string, string>): Promise<{ resolution: ModuleResolution; requested: Map<string, string[]>; managed: Set<string> }> {
    const requested = new Map<string, string[]>();
    const managedKeys = new Set<string>();
    const model = await this.loadModel({ path: file }, []);
    if ("error" in model) {
      return { resolution: { path: file, gav: { groupId: "", artifactId: "", version: "" }, packaging: "jar", dependencies: [], unresolved: [], problems: [model.error] }, requested, managed: managedKeys };
    }
    const root = await this.effective(model);
    const internal = new Set([...this.workspaceByGav.keys()].map(key => key.split(":").slice(0, 2).join(":")));
    const resolved = new Map<string, ResolvedDependency>();
    const unresolved: UnresolvedDependency[] = [];
    /** `parentKey` and `declared` let a transitive scope follow its parent's scope at the moment it is resolved. */
    type Item = { dep: PomDependency; depth: number; via: string[]; exclusions: PomExclusion[]; scope: string; parentKey?: string; declared?: string };
    let level: Item[] = root.dependencies
      .filter(d => d.scope !== "import")
      .map(d => ({ dep: d, depth: 1, via: [], exclusions: d.exclusions, scope: d.scope ?? "compile" }));
    const problems = [...model.problems];
    /** Edges from a resolved node to the nodes it brought in, with the scope each was declared with. */
    const edges = new Map<string, Array<{ key: string; declared: string }>>();
    const widen = (key: string, scope: string) => {
      const node = resolved.get(key);
      if (!node || (SCOPE_RANK[scope] ?? 0) <= (SCOPE_RANK[node.scope] ?? 0)) return;
      node.scope = scope;
      for (const edge of edges.get(key) ?? []) {
        const childScope = transitiveScope(scope, edge.declared);
        if (childScope) widen(edge.key, childScope);
      }
    };
    for (let depth = 1; level.length && depth <= 60; depth++) {
      if (this.signal?.aborted) break;
      const winners: Array<Item & { node: ResolvedDependency }> = [];
      for (const item of level) {
        const dep = item.dep;
        const key = conflictKey(dep);
        let version = dep.version;
        let scope = item.scope;
        if (item.parentKey) {
          const parent = resolved.get(item.parentKey);
          const current = parent ? transitiveScope(parent.scope, item.declared ?? "compile") : undefined;
          if (current && (SCOPE_RANK[current] ?? 0) > (SCOPE_RANK[scope] ?? 0)) scope = current;
        }
        if (depth > 1) {
          // The root's dependency management overrides transitive versions and scopes.
          const managed = root.managed.get(managementKey(dep));
          if (managed?.version) { version = managed.version; managedKeys.add(key); }
          if (managed?.scope && managed.scope !== "import") scope = managed.scope;
        } else if (!dep.version && root.managed.get(managementKey(dep))?.version) {
          managedKeys.add(key);
        }
        if (version && !hasExpression(version) && !isVersionRange(version)) requested.set(key, [...(requested.get(key) ?? []), version]);
        if (forced.has(key) && !managedKeys.has(key)) version = forced.get(key);
        const existing = resolved.get(key);
        if (existing) {
          // Nearest wins; a later path only widens the scope (Maven's scope update), down through its dependencies.
          widen(key, scope);
          continue;
        }
        if (unresolved.some(u => u.groupId === dep.groupId && u.artifactId === dep.artifactId)) continue;
        if (!version) {
          unresolved.push({ groupId: dep.groupId, artifactId: dep.artifactId, depth, via: item.via, reason: depth === 1 ? "No version is declared or managed for it (by this POM, its parents or imported BOMs)." : "Its version is not declared or managed anywhere Maven would look." });
          continue;
        }
        if (hasExpression(version)) {
          unresolved.push({ groupId: dep.groupId, artifactId: dep.artifactId, depth, via: item.via, declared: version, reason: `Its version ${version} uses a property that is not defined.` });
          continue;
        }
        if (isVersionRange(version)) {
          const picked = await this.highestInRange(dep.groupId, dep.artifactId, version);
          if ("error" in picked) {
            unresolved.push({ groupId: dep.groupId, artifactId: dep.artifactId, depth, via: item.via, declared: version, reason: `Its version is the range ${version}, and ${picked.error}` });
            continue;
          }
          problems.push(`${dep.groupId}:${dep.artifactId} ${version} resolves to ${picked.version}, the highest published version in the range.`);
          version = picked.version;
        }
        const managedEntry = managedKeys.has(key) ? root.managed.get(managementKey(dep)) : undefined;
        const node: ResolvedDependency = {
          groupId: dep.groupId, artifactId: dep.artifactId, version, classifier: dep.classifier, type: dep.type,
          scope, optional: dep.optional, depth, via: item.via,
          internal: internal.has(`${dep.groupId}:${dep.artifactId}`),
          ...(managedEntry?.origin && managedEntry.version === version ? { managed: { ...managedEntry.origin, version } } : {})
        };
        resolved.set(key, node);
        winners.push({ ...item, node });
      }
      // Load every winner's POM at once (the repository limits concurrency), then expand in order.
      const loaded = await Promise.all(winners.map(w =>
        w.node.scope === "system" ? Promise.resolve(undefined) : this.artifact({ groupId: w.node.groupId, artifactId: w.node.artifactId, version: w.node.version })));
      const next: Item[] = [];
      winners.forEach((winner, index) => {
        const found = loaded[index];
        if (!found) return;
        if ("error" in found) {
          problems.push(`The transitive dependencies of ${gavString(winner.node)} are unknown: ${found.error}`);
          return;
        }
        const relocated = found.gav;
        if (gavString(relocated) !== gavString(winner.node)) {
          problems.push(`${gavString(winner.node)} is relocated to ${gavString(relocated)}.`);
          winner.node.groupId = relocated.groupId;
          winner.node.artifactId = relocated.artifactId;
          winner.node.version = relocated.version;
        }
        const via = [...winner.via, gavString(winner.node)];
        for (const child of found.effective.dependencies) {
          if (child.optional) continue;
          if (excluded(child, winner.exclusions)) continue;
          const scope = transitiveScope(winner.node.scope, child.scope ?? "compile");
          if (!scope) continue;
          const parentKey = conflictKey(winner.dep);
          next.push({ dep: child, depth: depth + 1, via, exclusions: [...winner.exclusions, ...child.exclusions], scope, parentKey, declared: child.scope ?? "compile" });
          edges.set(parentKey, [...(edges.get(parentKey) ?? []), { key: conflictKey(child), declared: child.scope ?? "compile" }]);
        }
      });
      level = next;
    }
    return {
      resolution: {
        path: file, gav: model.gav, packaging: model.packaging,
        dependencies: [...resolved.values()],
        unresolved,
        problems: [...new Set(problems)]
      },
      requested,
      managed: managedKeys
    };
  }
}

/* ------------------------------------------------------------------ *
 * Repository access
 * ------------------------------------------------------------------ */

export interface RepositoryOptions {
  /** Reads a file from the local Maven repository (relative path inside it), or undefined. */
  readLocal?: (relative: string) => Promise<string | undefined>;
  /** HTTP GET; undefined disables remote repositories. */
  fetchText?: (url: string, signal?: AbortSignal) => Promise<{ status: number; text: string }>;
  /** Cache for downloaded release POMs (they never change once published). */
  cache?: { get(key: string): Promise<string | undefined>; set(key: string, text: string): Promise<void> };
  concurrency?: number;
  onFetch?: (url: string, outcome: "ok" | "missing" | "error") => void;
}

export function pomPath(gav: Gav): string {
  return `${gav.groupId.replace(/\./g, "/")}/${gav.artifactId}/${gav.version}/${gav.artifactId}-${gav.version}.pom`;
}

const SAFE_COORDINATE = /^[A-Za-z0-9_.\-]+$/;

/** Local repository first, then each remote repository, with de-duplicated in-flight requests and bounded concurrency. */
export function createPomRepository(options: RepositoryOptions): PomRepository {
  const inFlight = new Map<string, Promise<PomLookup>>();
  const limit = Math.max(1, options.concurrency ?? 8);
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => new Promise<void>(resolve => { if (active < limit) { active++; resolve(); } else waiting.push(() => { active++; resolve(); }); });
  const release = () => { active--; waiting.shift()?.(); };

  const lookup = async (gav: Gav, repositories: string[], signal?: AbortSignal): Promise<PomLookup> => {
    if (![gav.groupId, gav.artifactId, gav.version].every(part => SAFE_COORDINATE.test(part))) {
      return { error: `${gavString(gav)} is not a valid Maven coordinate.` };
    }
    const relative = pomPath(gav);
    const local = await options.readLocal?.(relative);
    if (local !== undefined) return { text: local, origin: "the local Maven repository" };
    const cached = await options.cache?.get(relative);
    if (cached !== undefined) return { text: cached, origin: "the POM cache" };
    if (!options.fetchText) return { error: "It is not in the local Maven repository, and downloading POMs is turned off." };
    const errors: string[] = [];
    for (const repo of repositories) {
      if (signal?.aborted) return { error: "Cancelled." };
      const url = `${repo.replace(/\/+$/, "")}/${relative}`;
      await acquire();
      try {
        const response = await options.fetchText(url, signal);
        if (response.status === 200) {
          options.onFetch?.(url, "ok");
          if (!/-SNAPSHOT$/i.test(gav.version)) await options.cache?.set(relative, response.text);
          return { text: response.text, origin: repo };
        }
        options.onFetch?.(url, response.status === 404 ? "missing" : "error");
        if (response.status !== 404) errors.push(`${repo} answered HTTP ${response.status}`);
      } catch (error) {
        options.onFetch?.(url, "error");
        errors.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        release();
      }
    }
    return { error: errors.length ? `It could not be downloaded (${errors.join("; ")}).` : "It is not in the local Maven repository or in any configured repository (private artifact?)." };
  };

  const metadata = async (groupId: string, artifactId: string, repositories: string[], signal?: AbortSignal): Promise<string[] | { error: string }> => {
    if (![groupId, artifactId].every(part => SAFE_COORDINATE.test(part))) return { error: "not a valid coordinate" };
    const dir = `${groupId.replace(/\./g, "/")}/${artifactId}`;
    const versions = new Set<string>();
    const collect = (xml: string) => { for (const m of xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)) versions.add(m[1]); };
    for (const name of ["maven-metadata-central.xml", "maven-metadata.xml"]) {
      const local = await options.readLocal?.(`${dir}/${name}`);
      if (local) collect(local);
    }
    if (options.fetchText) {
      for (const repo of repositories) {
        if (signal?.aborted) break;
        await acquire();
        try {
          const response = await options.fetchText(`${repo.replace(/\/+$/, "")}/${dir}/maven-metadata.xml`, signal);
          if (response.status === 200) collect(response.text);
        } catch { /* try the next repository */ } finally {
          release();
        }
      }
    }
    return versions.size ? [...versions] : { error: "no maven-metadata.xml was found" };
  };

  return {
    versions: metadata,
    fetch(gav, repositories, signal) {
      const key = gavString(gav);
      let promise = inFlight.get(key);
      if (!promise) {
        promise = lookup(gav, repositories, signal);
        inFlight.set(key, promise);
      }
      return promise;
    }
  };
}
