import * as path from "path";
import { mavenFlavour } from "../services/dependency-versions";
import { mapLimit, OsvCache, OsvClient, OsvError, OsvQuery, OsvRecord, QueryOutcome, validateQuery, VulnRef } from "./client";
import type { MavenOutcome, ResolutionOutcome } from "./maven/index";
import { AUXILIARY_FILES, detectFileType, fileTypeById, matchName, parseDependencyFile, ParseContext, projectDirOf } from "./parsers";
import { remediationFor } from "./remediation";
import { resolveSeverity } from "./severity";
import {
  Confidence, Finding, Occurrence, OsvEcosystem, PackageRecord, ParsedDependency, ParsedFile, Reference, Remediation, ScanDiagnostics,
  ScanProgress, ScanResult, ScanSummary, SEVERITY_ORDER, Severity, SkipReason
} from "./types";
import {
  comparatorFor, Compare, declaredSpans, describeInterval, inInterval, Interval, intervalsOf, isComparable, maxVersion,
  sortVersions, Span, spanContains, spanOverlaps
} from "./versions";

/**
 * The OSV scan, start to finish, without VS Code:
 *
 *   files → parse (Maven projects resolved to their full dependency graph) →
 *   inventory (de-duplicated packages) → OSV querybatch (paginated, with
 *   per-package fallback) → advisory records (cached by `modified`) →
 *   findings (aliases merged, severity from the record) → remediation (fix
 *   verified against OSV).
 *
 * A failed request never ends the scan, and never turns into "no
 * vulnerabilities": its packages are reported as not analysed, with the
 * reason, and the scan is marked incomplete. Cancellation returns what was
 * finished so far. Every stage is counted in `diagnostics` and logged through
 * `onLog`, so a missing finding can be traced to where it was lost.
 */

export interface ScanFile {
  /** Workspace-relative path with forward slashes. */
  path: string;
  text?: string;
  /** Why the file could not be read (too large, permission, ...). */
  error?: string;
  /** Read for context only (a parent POM, central package versions): used to resolve, never scanned itself. */
  context?: boolean;
  /** Adapter id for a file whose name does not identify it (a requirements file included with -r). */
  hint?: string;
}

const typeOfScanFile = (f: ScanFile) => detectFileType(f.path) ?? (f.hint ? fileTypeById(f.hint) : undefined);

export interface ScanOptions {
  client: OsvClient;
  cache: OsvCache;
  workspace: { name: string; folders: string[] };
  source: "workspace" | "files";
  toolVersion: string;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
  /** Ignore cached query answers (records are still reused while their `modified` matches). */
  fresh?: boolean;
  /** Discovery notes, e.g. "stopped after 5,000 files". */
  limitations?: string[];
  /** Resolves Maven projects (pom.xml) to their full dependency graphs. Without it, pom.xml is read for declared dependencies only. */
  resolveMaven?: (poms: ScanFile[], signal?: AbortSignal) => Promise<MavenOutcome>;
  /** Resolves Gradle builds (build.gradle, with settings.gradle and gradle.properties as context). Without it, build scripts are read for declared dependencies only. */
  resolveGradle?: (files: ScanFile[], signal?: AbortSignal) => Promise<ResolutionOutcome>;
  /** Diagnostic log lines (no file contents, no credentials). */
  onLog?: (message: string) => void;
  /** Dependency files discovery recognised but cannot read (sbt, CocoaPods, Conan, …): reported, and the scan is incomplete. */
  unsupported?: Array<{ path: string; format: string }>;
}

export const TOOL_NAME = "DevSnip Pro OSV Vulnerability Scanner";
const DETAILS_LIMIT = 20000;

const yieldToHost = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function ancestorsOf(dir: string): string[] {
  const out: string[] = [];
  let current = dir;
  for (;;) {
    out.push(current);
    if (!current) break;
    const parent = path.posix.dirname(current);
    current = parent === "." || parent === current ? "" : parent;
  }
  return out;
}

function makeContext(files: ScanFile[]): ParseContext {
  const byPath = new Map(files.filter(f => f.text !== undefined).map(f => [f.path, f.text as string]));
  return {
    read: file => byPath.get(file),
    ancestors(name, dir) {
      const start = dir === "." ? "" : dir;
      return ancestorsOf(start).map(d => byPath.get(d ? `${d}/${name}` : name)).filter((t): t is string => t !== undefined);
    }
  };
}

/** Lockfile managers that also cover manifests in nested directories (workspaces / monorepos). */
function sameFamily(a: ParsedFile, b: ParsedFile): boolean {
  return a.ecosystem === b.ecosystem;
}

function primaryRank(id: string): number {
  if (id.startsWith("GHSA-")) return 0;
  if (/^(?:CVE|CAN)-/.test(id)) return 3;
  return 1;
}

function ecosystemBase(value: string | undefined): string {
  return (value ?? "").split(":")[0];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let node = x;
    while (this.parent.get(node) !== root) { const next = this.parent.get(node)!; this.parent.set(node, root); node = next; }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

interface WorkPackage extends PackageRecord {
  /** Name sent to OSV (NuGet ids are case-sensitive there). */
  queryName: string;
  refs?: VulnRef[];
}

interface Analysis {
  findings: Finding[];
  /** Advisories dropped because the declared range cannot reach them. */
  outOfRange: number;
  /** Advisories dropped because every record of them is withdrawn. */
  withdrawn: number;
  /** Advisory ids folded into another finding as aliases. */
  merged: number;
}

/** Why an unchecked dependency was skipped, when its parser did not say. */
function skipReasonOf(dep: ParsedDependency): SkipReason {
  if (dep.skip) return dep.skip;
  if (dep.version) return "source";
  return /git|path|URL|tarball|private|registry|source|branch|revision|Bioconductor|SDK|SNAPSHOT|alternative/i.test(dep.note ?? "") ? "source" : "unresolved";
}

export async function runScan(files: ScanFile[], options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const { client, cache, signal } = options;
  const progress = (phase: ScanProgress["phase"], message: string, fraction: number) => options.onProgress?.({ phase, message, fraction: Math.max(0, Math.min(1, fraction)) });
  const errors: string[] = [];
  const limitations: string[] = [...(options.limitations ?? [])];
  let cancelled = false;
  let partial = false;
  const isCancelled = () => Boolean(signal?.aborted);
  const fetched = { cached: 0, fetched: 0 };

  const log = (message: string) => options.onLog?.(message);
  const diagnostics: ScanDiagnostics = {
    filesRead: 0, filesFailed: 0, dependenciesParsed: 0, packagesDiscovered: 0, packagesQueried: 0, packagesFromCache: 0, queriesFailed: 0,
    batches: 0, pagesFollowed: 0, fallbackQueries: 0, advisoryReferences: 0, uniqueAdvisoryIds: 0, recordsFetched: 0, recordsFromCache: 0,
    recordsFailed: 0, withdrawnDropped: 0, outOfRangeDropped: 0, aliasesMerged: 0, findings: 0, buildTools: []
  };

  const timings: Record<string, number> = {};
  let stageStart = Date.now();
  const stage = (name: string) => { const now = Date.now(); timings[name] = (timings[name] ?? 0) + now - stageStart; stageStart = now; };
  // ---- parse -----------------------------------------------------------
  const context = makeContext(files);
  const parsed: ParsedFile[] = [];
  const scanFiles = files.filter(f => !f.context && !AUXILIARY_FILES.includes(path.posix.basename(f.path)) && typeOfScanFile(f));
  log(`Discovered ${scanFiles.length} dependency file${scanFiles.length === 1 ? "" : "s"}${files.length > scanFiles.length ? ` (plus ${files.length - scanFiles.length} context file${files.length - scanFiles.length === 1 ? "" : "s"})` : ""}.`);
  // Maven projects are resolved as a whole (parents, BOMs, modules, transitive dependencies).
  let maven: MavenOutcome | undefined;
  const poms = scanFiles.filter(f => detectFileType(f.path)?.id === "pom");
  // Context POMs (parents above a chosen file) take part in resolution but are not scanned.
  const contextPoms = files.filter(f => f.context && detectFileType(f.path)?.id === "pom");
  let gradle: ResolutionOutcome | undefined;
  const gradleBuilds = scanFiles.filter(f => detectFileType(f.path)?.id === "gradle");
  if (gradleBuilds.length && options.resolveGradle && !isCancelled()) {
    progress("parse", `Resolving ${gradleBuilds.length} Gradle project${gradleBuilds.length === 1 ? "" : "s"}…`, 0.07);
    const gradleContext = files.filter(f => ["settings.gradle", "settings.gradle.kts", "gradle.properties"].includes(path.posix.basename(f.path)) || f.path.endsWith("gradle/libs.versions.toml"));
    try {
      gradle = await options.resolveGradle([...gradleBuilds, ...gradleContext], signal);
      diagnostics.buildTools.push(...gradle.projects);
      for (const project of gradle.projects) if (project.detail) errors.push(`Gradle build ${project.project}: ${project.detail.split("\n")[0]}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Gradle dependencies could not be resolved (${message}); build scripts were read for declared dependencies only.`);
      log(`Gradle resolution failed: ${message}`);
    }
  }
  if (poms.length && options.resolveMaven && !isCancelled()) {
    progress("parse", `Resolving ${poms.length} Maven POM${poms.length === 1 ? "" : "s"}…`, 0.06);
    try {
      maven = await options.resolveMaven([...poms, ...contextPoms], signal);
      diagnostics.buildTools.push(...maven.projects);
      for (const project of maven.projects) {
        if (project.detail) errors.push(`Maven project ${project.project}: ${project.detail.split("\n")[0]}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Maven dependencies could not be resolved (${message}); pom.xml files were read for declared dependencies only.`);
      log(`Maven resolution failed: ${message}`);
    }
  }
  stage("resolve");
  for (let index = 0; index < scanFiles.length; index++) {
    if (isCancelled()) { cancelled = true; break; }
    const file = scanFiles[index];
    const type = typeOfScanFile(file)!;
    const resolved = maven?.files.get(file.path) ?? gradle?.files.get(file.path);
    if (resolved) {
      parsed.push(resolved);
    } else if (file.text === undefined) {
      parsed.push({ path: file.path, ecosystem: type.ecosystem, kind: type.kind, manager: type.manager, dependencies: [], warnings: [], error: file.error ?? "The file could not be read." });
    } else {
      const result = parseDependencyFile(file.path, file.text, context, file.hint);
      if (result) parsed.push(result);
    }
    if (index % 10 === 9) {
      progress("parse", `Reading dependency files (${index + 1}/${scanFiles.length})`, 0.05 + 0.1 * ((index + 1) / scanFiles.length));
      await yieldToHost();
    }
  }
  progress("parse", `Read ${parsed.length} dependency file${parsed.length === 1 ? "" : "s"}`, 0.15);
  diagnostics.filesFailed = parsed.filter(f => f.error).length;
  diagnostics.filesRead = parsed.length - diagnostics.filesFailed;
  diagnostics.dependenciesParsed = parsed.reduce((n, f) => n + f.dependencies.length, 0);
  for (const file of parsed) {
    log(`${file.path}: ${file.error ? `not read (${file.error})` : `${file.dependencies.length} dependencies (${file.ecosystem}, ${file.kind}${file.resolvedBy ? `, ${file.resolvedBy}` : ""})`}`);
  }

  // Yarn Berry is told apart from Yarn 1 by its lockfile.
  for (const file of parsed) {
    if (file.manager === "yarn" && files.find(f => f.path === file.path)?.text?.match(/^__metadata:/m)) file.manager = "yarn-berry";
  }

  stage("parse");
  // ---- inventory ---------------------------------------------------------
  const packages = new Map<string, WorkPackage>();
  const lockfiles = parsed.filter(f => f.kind === "lockfile" && !f.error);
  /** Names each lockfile resolves, for deciding which manifest entries it already covers. */
  const lockNames = new Map<ParsedFile, Set<string>>(lockfiles.map(f => [f, new Set(f.dependencies.map(d => matchName(f.ecosystem, d.name)))]));
  const projectOf = (file: ParsedFile) => {
    const type = detectFileType(file.path);
    return type ? projectDirOf(file.path, type) : path.posix.dirname(file.path);
  };
  const lockfilesByDir = new Map<string, ParsedFile[]>();
  for (const file of lockfiles) {
    const dir = projectOf(file);
    lockfilesByDir.set(dir, [...(lockfilesByDir.get(dir) ?? []), file]);
  }
  /** Lockfile occurrences, so manifests can mark them direct. */
  const lockOccurrences = new Map<string, Array<{ occurrence: Occurrence; file: ParsedFile }>>();

  const add = (file: ParsedFile, dep: ParsedFile["dependencies"][number]) => {
    const ecosystem = file.ecosystem;
    const normal = matchName(ecosystem, dep.name);
    const occurrence: Occurrence = {
      file: file.path, line: dep.line, project: projectOf(file), manager: file.manager, scope: dep.scope,
      direct: dep.direct, spec: dep.spec, resolution: dep.resolution, ...(dep.via?.length ? { via: dep.via } : {}),
      ...(dep.managedBy ? { managedBy: dep.managedBy } : {})
    };
    let key: string;
    let status: PackageRecord["status"] = "unanalyzed";
    let note = dep.note;
    if (dep.registry === false) {
      key = `${ecosystem}|${normal}|!${skipReasonOf(dep)}`;
    } else if (dep.version) {
      key = `${ecosystem}|${normal}|${dep.version}`;
      status = "clean"; // provisional: queried below
    } else {
      key = `${ecosystem}|${normal}|*`;
      status = "potential";
    }
    let pkg = packages.get(key);
    if (!pkg) {
      pkg = {
        key, ecosystem, name: dep.name, queryName: dep.name, version: dep.registry === false ? undefined : dep.version,
        resolution: dep.resolution, specs: [], occurrences: [], status, note, findingIds: [], devOnly: true,
        ...(dep.registry === false ? { skipReason: skipReasonOf(dep) } : {})
      };
      packages.set(key, pkg);
    }
    // A lockfile's spelling of a NuGet id is the package's own casing.
    if (file.kind === "lockfile" && pkg.resolution !== "lockfile") { pkg.queryName = dep.name; pkg.name = dep.name; pkg.resolution = dep.resolution; }
    if (dep.spec && !pkg.specs.includes(dep.spec)) pkg.specs.push(dep.spec);
    if (!pkg.note && note) pkg.note = note;
    pkg.occurrences.push(occurrence);
    if (file.kind === "lockfile") {
      const id = `${ecosystem}|${normal}`;
      lockOccurrences.set(id, [...(lockOccurrences.get(id) ?? []), { occurrence, file }]);
    }
  };

  for (const file of lockfiles) for (const dep of file.dependencies) add(file, dep);

  const manifests = parsed.filter(f => f.kind === "manifest" && !f.error);
  let conflicts = 0;
  /** Lockfiles whose own project manifest was read: what that manifest does not declare is transitive. */
  const ownedLocks = new Set<ParsedFile>();
  const isUnder = (root: string, dir: string) => root === "" || dir === root || dir.startsWith(`${root}/`);
  let localSkipped = 0;
  for (const file of manifests) {
    const dir = projectOf(file);
    // A version catalog only declares versions; once the Gradle build that uses it is resolved, its entries are already there at the versions Gradle picked.
    if (detectFileType(file.path)?.id === "gradle-catalog" && parsed.some(build => build.manager === "gradle" && build.resolvedBy && !build.error && build !== file && isUnder(dir, projectOf(build)))) {
      log(`${file.path}: covered by the resolved Gradle build, so its declared versions are not scanned separately.`);
      continue;
    }
    // A lockfile covers a manifest in its own folder, or in a folder below that it records as a workspace
    // member. Formats that do not record members (Yarn 1, Cargo, ...) cover the folders below by name.
    const covering = ancestorsOf(dir).flatMap(d => (lockfilesByDir.get(d) ?? []).filter(lock => {
      if (!sameFamily(lock, file)) return false;
      if (!lock.members || d === dir) return true;
      const relative = path.posix.relative(d || ".", dir || ".");
      return lock.members.includes(relative);
    }));
    for (const lock of covering) if (projectOf(lock) === dir) ownedLocks.add(lock);
    // The workspace's own packages (npm/pnpm links, workspace members): local code, never a registry package.
    const local = new Set(covering.flatMap(lock => (lock.localPackages ?? []).map(n => matchName(file.ecosystem, n))));
    if (file.ecosystem === "npm") {
      const root = covering.length ? projectOf(covering[0])
        : ancestorsOf(dir).filter(d => manifests.some(m => m.ecosystem === "npm" && projectOf(m) === d)).pop() ?? dir;
      for (const m of manifests) if (m !== file && m.ecosystem === "npm" && m.selfName && isUnder(root, projectOf(m))) local.add(matchName("npm", m.selfName));
    }
    for (const dep of file.dependencies) {
      const normal = matchName(file.ecosystem, dep.name);
      const coveredBy = covering.filter(lock => lockNames.get(lock)!.has(normal));
      if (!coveredBy.length && local.has(normal)) {
        localSkipped++;
        log(`${file.path}: ${dep.name} is a package of this workspace, so it is not looked up in the registry.`);
        continue;
      }
      if (coveredBy.length) {
        // The lockfile already has the exact version; the manifest only tells us it is direct.
        // Precedence: the lockfile wins (it is what gets installed); a manifest range it does not satisfy is reported.
        const spans = dep.spec && file.ecosystem !== "Maven" ? declaredSpans(file.ecosystem, dep.spec) : undefined;
        if (spans) {
          // A lockfile may hold several copies (nested transitive ones); it conflicts only when none satisfies the range.
          const locked = coveredBy.flatMap(lock => lock.dependencies.filter(d => matchName(lock.ecosystem, d.name) === normal && d.version).map(d => ({ lock, version: d.version! })));
          const cmp = comparatorFor(file.ecosystem);
          const comparable = locked.filter(l => isComparable(file.ecosystem, l.version));
          if (comparable.length && comparable.length === locked.length && !comparable.some(l => spans.some(span => spanContains(span, l.version, cmp)))) {
            conflicts++;
            const message = `${dep.name}: ${file.path} asks for "${dep.spec}", but ${locked[0].lock.path} has ${[...new Set(locked.map(l => l.version))].join(", ")}. The lockfile version is scanned (it is what gets installed); reinstall to bring the lockfile in sync.`;
            if (!file.warnings.includes(message)) file.warnings.push(message);
          }
        }
        for (const { occurrence, file: lock } of lockOccurrences.get(`${file.ecosystem}|${normal}`) ?? []) {
          if (!coveredBy.includes(lock)) continue;
          if (occurrence.direct === undefined || (occurrence.direct === false && projectOf(lock) === dir)) occurrence.direct = true;
          if (dep.scope === "development" && occurrence.scope === "production" && occurrence.direct) occurrence.scope = "development";
          if (dep.spec && !occurrence.spec) occurrence.spec = dep.spec;
        }
        continue;
      }
      add(file, dep);
    }
  }

  // A lockfile entry its own project's manifest does not declare is a transitive dependency.
  for (const list of lockOccurrences.values()) {
    for (const { occurrence, file } of list) if (occurrence.direct === undefined && ownedLocks.has(file)) occurrence.direct = false;
  }
  if (localSkipped) log(`Inventory: ${localSkipped} reference${localSkipped === 1 ? "" : "s"} to the workspace's own packages left out.`);
  const all = [...packages.values()];
  for (const pkg of all) {
    pkg.devOnly = pkg.occurrences.every(o => o.scope === "development");
    const directs = pkg.occurrences.map(o => o.direct);
    pkg.direct = directs.includes(true) ? true : directs.every(d => d === false) ? false : undefined;
  }
  progress("query", `Found ${all.length} unique package${all.length === 1 ? "" : "s"}`, 0.2);
  diagnostics.packagesDiscovered = all.length;
  log(`Inventory: ${all.length} unique packages (${all.filter(p => p.status !== "unanalyzed").length} to query, ${all.filter(p => p.skipReason === "unresolved").length} with unknown versions, ${all.filter(p => p.skipReason === "source").length} from sources OSV does not cover).`);

  stage("inventory");
  // ---- query OSV ---------------------------------------------------------
  // A coordinate OSV cannot take (control characters, an empty version) is reported, not sent.
  for (const pkg of all) {
    if (pkg.status === "unanalyzed") continue;
    const invalid = validateQuery({ package: { name: pkg.queryName, ecosystem: pkg.ecosystem }, ...(pkg.status === "potential" ? {} : { version: pkg.version }) });
    if (invalid) { pkg.status = "unanalyzed"; pkg.skipReason = "unresolved"; pkg.note = `Not sent to OSV: ${invalid}.`; }
  }
  const queryable = all.filter(p => p.status !== "unanalyzed");
  const queryKey = (p: WorkPackage) => `${p.ecosystem}|${p.queryName}|${p.status === "potential" ? "*" : p.version}`;
  const toAsk: WorkPackage[] = [];
  for (const pkg of queryable) {
    const hit = options.fresh ? undefined : cache.getQuery(queryKey(pkg));
    if (hit) pkg.refs = hit; else toAsk.push(pkg);
  }
  diagnostics.packagesFromCache = queryable.length - toAsk.length;
  const failures = new Map<string, number>();
  if (toAsk.length && !isCancelled()) {
    const queries: OsvQuery[] = toAsk.map(p => ({
      package: { name: p.queryName, ecosystem: p.ecosystem },
      ...(p.status === "potential" ? {} : { version: p.version })
    }));
    const before = { ...client.stats };
    let outcomes: QueryOutcome[] = [];
    try {
      outcomes = await client.queryAll(queries, signal, (done, total) =>
        progress("query", `Checking packages with OSV (${done}/${total} batch${total === 1 ? "" : "es"})`, 0.2 + 0.35 * (done / Math.max(1, total))));
    } catch (error) {
      if (!(error instanceof OsvError && error.kind === "cancelled")) throw error;
      cancelled = true;
    }
    toAsk.forEach((pkg, index) => {
      const outcome = outcomes[index];
      if (outcome === undefined) return;
      if (Array.isArray(outcome)) {
        pkg.refs = outcome;
        cache.putQuery(queryKey(pkg), outcome);
        return;
      }
      partial = true;
      diagnostics.queriesFailed++;
      failures.set(outcome.error, (failures.get(outcome.error) ?? 0) + 1);
      pkg.status = "unanalyzed";
      pkg.skipReason = "failed";
      pkg.note = `OSV could not be queried: ${outcome.error}`;
    });
    diagnostics.batches = client.stats.batches - before.batches;
    diagnostics.pagesFollowed = client.stats.pages - before.pages;
    diagnostics.fallbackQueries = client.stats.fallbacks - before.fallbacks;
  }
  for (const [message, count] of failures) errors.push(`${count} package${count === 1 ? "" : "s"} could not be checked: ${message}`);
  diagnostics.packagesQueried = queryable.filter(p => p.refs).length;
  log(`OSV: ${diagnostics.packagesQueried}/${queryable.length} packages answered (${diagnostics.packagesFromCache} from the 10-minute cache), ${diagnostics.batches} batch request${diagnostics.batches === 1 ? "" : "s"}, ${diagnostics.pagesFollowed} extra page${diagnostics.pagesFollowed === 1 ? "" : "s"}, ${diagnostics.fallbackQueries} single-package fallback${diagnostics.fallbackQueries === 1 ? "" : "s"}, ${diagnostics.queriesFailed} failed.`);
  for (const [message, count] of failures) log(`OSV: ${count} failed: ${message}`);
  if (isCancelled()) cancelled = true;
  for (const pkg of queryable) {
    if (!pkg.refs && pkg.status !== "unanalyzed") { pkg.status = "unanalyzed"; pkg.skipReason = "cancelled"; pkg.note = "The scan was cancelled before this package was checked."; }
  }

  stage("query");
  // ---- advisory records ----------------------------------------------------
  const records = new Map<string, OsvRecord>();
  const missing = new Map<string, string>();
  const loadRecords = async (refs: VulnRef[], phase: "details" | "verify", base: number, span: number) => {
    const wanted = new Map<string, string>();
    for (const ref of refs) if (!records.has(ref.id) && !missing.has(ref.id)) wanted.set(ref.id, ref.modified);
    const toFetch: string[] = [];
    for (const [id, modified] of wanted) {
      const hit = cache.getRecord(id, modified);
      if (hit) { records.set(id, hit); fetched.cached++; } else toFetch.push(id);
    }
    let done = 0;
    await mapLimit(toFetch, client.concurrency, async id => {
      if (isCancelled()) return;
      try {
        const record = await client.getVulnerability(id, signal);
        if (record) { records.set(id, record); cache.putRecord(record); fetched.fetched++; }
        else missing.set(id, "OSV no longer has this record.");
      } catch (error) {
        if (error instanceof OsvError && error.kind === "cancelled") { cancelled = true; return; }
        partial = true;
        missing.set(id, error instanceof Error ? error.message : String(error));
      } finally {
        done++;
        if (done % 5 === 0 || done === toFetch.length) progress(phase, `Fetching advisory details (${done}/${toFetch.length})`, base + span * (done / Math.max(1, toFetch.length)));
      }
    });
  };
  const allRefs = queryable.flatMap(p => p.refs ?? []);
  diagnostics.advisoryReferences = allRefs.length;
  diagnostics.uniqueAdvisoryIds = new Set(allRefs.map(r => r.id)).size;
  if (!cancelled) await loadRecords(allRefs, "details", 0.55, 0.3);
  // A record with no severity (PYSEC and GO often have none) borrows it from an alias that has one:
  // aliases are the same vulnerability by definition. Only GHSA and CVE aliases are fetched.
  if (!cancelled) {
    const borrowed: VulnRef[] = [];
    for (const record of records.values()) {
      if (hasSeverity(record)) continue;
      const aliases = record.aliases ?? [];
      if (aliases.some(alias => { const known = records.get(alias); return known && hasSeverity(known); })) continue;
      for (const alias of aliases) {
        if (/^(?:GHSA|CVE)-/.test(alias) && !records.has(alias) && !borrowed.some(b => b.id === alias)) borrowed.push({ id: alias, modified: "" });
      }
    }
    if (borrowed.length) {
      const before = new Set(missing.keys());
      await loadRecords(borrowed.slice(0, 200), "details", 0.85, 0.03);
      // An alias that could not be fetched only means no borrowed severity; it is not a scan error.
      for (const ref of borrowed) if (!before.has(ref.id)) missing.delete(ref.id);
    }
  }
  const failedDetails = [...missing.entries()].filter(([, reason]) => reason !== "OSV no longer has this record.");
  diagnostics.recordsFetched = fetched.fetched;
  diagnostics.recordsFromCache = fetched.cached;
  diagnostics.recordsFailed = failedDetails.length;
  log(`Advisories: ${diagnostics.advisoryReferences} references to ${diagnostics.uniqueAdvisoryIds} ids; ${fetched.fetched} records fetched, ${fetched.cached} from cache, ${failedDetails.length} failed${[...missing.values()].filter(r => r === "OSV no longer has this record.").length ? `, ${[...missing.values()].filter(r => r === "OSV no longer has this record.").length} no longer in OSV` : ""}.`);
  for (const [id, reason] of failedDetails.slice(0, 10)) log(`Advisories: ${id} could not be fetched: ${reason}`);
  if (failedDetails.length) errors.push(`Details for ${failedDetails.length} advisor${failedDetails.length === 1 ? "y" : "ies"} could not be fetched (${failedDetails[0][1]}); they are listed by id with unknown severity.`);

  // ---- findings -----------------------------------------------------------
  const findings: Finding[] = [];
  let outOfRangeTotal = 0;
  let v4Only = false;
  for (const pkg of queryable) {
    if (!pkg.refs) continue;
    const analysis = analysePackage(pkg, pkg.refs, records, missing);
    outOfRangeTotal += analysis.outOfRange;
    diagnostics.withdrawnDropped += analysis.withdrawn;
    diagnostics.aliasesMerged += analysis.merged;
    for (const finding of analysis.findings) {
      if (finding.severity === "unknown" && finding.cvssV4Vector) v4Only = true;
      findings.push(finding);
      pkg.findingIds.push(finding.id);
    }
    if (pkg.status === "potential") {
      if (!analysis.findings.length) {
        pkg.status = "clean";
        pkg.note = analysis.outOfRange
          ? `Version not locked. ${analysis.outOfRange} known advisor${analysis.outOfRange === 1 ? "y affects" : "ies affect"} versions outside the declared range ${pkg.specs.join(" / ") || "(none)"}, so none can apply.`
          : pkg.note ?? "Version not locked. No advisory in OSV can affect the declared range.";
      }
    } else {
      pkg.status = analysis.findings.some(f => f.confidence === "confirmed") ? "vulnerable" : analysis.findings.length ? "potential" : "clean";
    }
  }

  stage("records");
  // ---- remediation, with the fix version checked against OSV ----------------
  const remediations: Remediation[] = [];
  const byPackage = new Map<string, Finding[]>();
  for (const finding of findings) byPackage.set(finding.packageKey, [...(byPackage.get(finding.packageKey) ?? []), finding]);
  const targets = new Map<string, string>();
  for (const [key, list] of byPackage) {
    const pkg = packages.get(key)!;
    const cmp = comparatorFor(pkg.ecosystem);
    const target = maxVersion(list.map(f => f.fixedIn).filter((v): v is string => Boolean(v)), cmp);
    if (target) targets.set(key, target);
  }
  const verdicts = new Map<string, { status: "clean" | "vulnerable" | "unchecked"; remaining: string[] }>();
  if (!cancelled && targets.size) {
    progress("verify", "Checking that the suggested versions are themselves clean", 0.88);
    // Up to three rounds: a fix can still be affected by another advisory with a later fix.
    let pending = [...targets.keys()];
    for (let round = 0; round < 3 && pending.length && !isCancelled(); round++) {
      const checks = pending.map(key => ({ key, target: targets.get(key)!, pkg: packages.get(key)! }));
      let answers: Array<VulnRef[] | undefined> = [];
      try {
        const outcomes = await client.queryAll(checks.map(c => ({ package: { name: c.pkg.queryName, ecosystem: c.pkg.ecosystem }, version: c.target })), signal);
        answers = outcomes.map(o => (Array.isArray(o) ? o : undefined));
      } catch (error) {
        if (!(error instanceof OsvError && error.kind === "cancelled")) throw error;
        cancelled = true;
        break;
      }
      const remainingRefs = answers.flatMap(a => a ?? []);
      await loadRecords(remainingRefs, "verify", 0.9, 0.05);
      const raised: string[] = [];
      checks.forEach((check, index) => {
        const refs = answers[index];
        if (!refs) { verdicts.set(check.key, { status: "unchecked", remaining: [] }); return; }
        if (!refs.length) { verdicts.set(check.key, { status: "clean", remaining: [] }); return; }
        const probe: WorkPackage = { ...check.pkg, version: check.target, status: "clean", findingIds: [] };
        const after = analysePackage(probe, refs, records, missing).findings;
        verdicts.set(check.key, { status: "vulnerable", remaining: after.map(f => f.id) });
        const next = maxVersion(after.map(f => f.fixedIn).filter((v): v is string => Boolean(v)), comparatorFor(check.pkg.ecosystem));
        if (next && comparatorFor(check.pkg.ecosystem)(next, check.target) > 0) { targets.set(check.key, next); raised.push(check.key); }
      });
      pending = raised;
    }
  }
  for (const [key, list] of byPackage) {
    const pkg = packages.get(key)!;
    const target = targets.get(key);
    const unfixed = list.filter(f => f.noFix).map(f => f.id);
    const unknown = list.filter(f => !f.fixedIn && !f.noFix);
    const plan = remediationFor(pkg.ecosystem, pkg.queryName, target, pkg.occurrences);
    const guidance = [...plan.guidance];
    if (pkg.status === "potential" && target) guidance.unshift(`Make sure the installed version is ${target} or later, then commit a lockfile so future scans can confirm it.`);
    if (unfixed.length) {
      guidance.push(unfixed.length === list.length
        ? `No fixed version of ${pkg.name} has been published for ${unfixed.join(", ")}. Read the advisory for workarounds, limit exposure of the affected feature, or replace the package.`
        : `${unfixed.join(", ")} ${unfixed.length === 1 ? "has" : "have"} no published fix yet; upgrading still resolves the others.`);
    }
    if (unknown.some(f => !f.detailsAvailable)) guidance.push(`Details for ${unknown.filter(f => !f.detailsAvailable).map(f => f.id).join(", ")} could not be loaded, so their fixed versions are unknown. Scan again, or open the OSV record.`);
    if (unknown.some(f => f.detailsAvailable)) guidance.push(`Check ${unknown.filter(f => f.detailsAvailable).map(f => f.id).join(", ")} for the version that fixes it: the advisory's version data could not be compared with ${pkg.version ?? "the declared range"}.`);
    const verdict = target ? verdicts.get(key) ?? { status: "unchecked" as const, remaining: [] } : undefined;
    if (verdict?.status === "vulnerable") guidance.push(`OSV still lists ${verdict.remaining.join(", ")} for ${pkg.name} ${target}; check those advisories before upgrading.`);
    remediations.push({
      packageKey: key, ecosystem: pkg.ecosystem, packageName: pkg.name, installedVersion: pkg.version,
      ...(target ? { targetVersion: target, targetCheck: verdict } : {}), unfixed, commands: plan.commands, guidance
    });
  }

  stage("verify");
  diagnostics.timings = timings;
  // ---- result -------------------------------------------------------------
  const unresolved = all.filter(p => p.resolution === "range" && p.occurrences.every(o => o.resolution === "range")).length;
  const declared = all.filter(p => p.resolution === "declared").length;
  limitations.push("Only vulnerabilities published in OSV.dev at scan time are reported. OSV matches published package versions, so vendored, copied or patched code and private packages are not covered.");
  if (unresolved) limitations.push(`${unresolved} dependenc${unresolved === 1 ? "y has" : "ies have"} no lockfile entry, so only a version range is known. Findings for them are marked Potential; commit a lockfile to confirm them.`);
  if (declared) limitations.push(`${declared} Gradle dependenc${declared === 1 ? "y is" : "ies are"} read from build scripts. Gradle can resolve newer versions through conflict resolution; enable dependency locking for exact results.`);
  if (parsed.some(f => f.ecosystem === "Go")) limitations.push("Go standard library and toolchain vulnerabilities are not checked (go.mod's go line is a minimum, not your toolchain). Use govulncheck for call-graph-aware Go results.");
  if (parsed.some(f => f.ecosystem === "Maven" && f.kind === "manifest" && !f.error && detectFileType(f.path)?.id === "pom")) limitations.push("Some pom.xml files were read for declared dependencies only (Maven resolution failed for them; see Scan notes), so their transitive dependencies are not checked. Scan again, or allow build tools (devsnip.osvScanner.buildToolResolution), to resolve the full dependency tree.");
  if (conflicts) limitations.push(`${conflicts} lockfile entr${conflicts === 1 ? "y does" : "ies do"} not satisfy the range in the manifest next to it (an out-of-date lockfile). The lockfile versions were scanned, because they are what gets installed; the Files tab lists each conflict.`);
  const builtinMaven = diagnostics.buildTools.filter(m => m.tool === "Maven" && m.method === "builtin").length;
  if (builtinMaven) limitations.push(`${builtinMaven} Maven project${builtinMaven === 1 ? " was" : "s were"} resolved by DevSnip Pro's resolver, which follows Maven's rules (parents, BOMs, dependency management, nearest wins, scopes, exclusions) but does not activate profiles by JDK, OS or property. Allow build tools (devsnip.osvScanner.buildToolResolution) for Maven's own result.`);
  const builtinGradle = diagnostics.buildTools.filter(m => m.tool === "Gradle" && m.method === "builtin").length;
  if (builtinGradle) limitations.push(`${builtinGradle} Gradle build${builtinGradle === 1 ? " was" : "s were"} read from build scripts without running Gradle (Spring Boot's BOM, mavenBom and platform imports, highest-version-wins conflicts). Version catalog aliases and plugin-added dependencies cannot be read this way, and findings are marked Potential. Allow build tools, or commit Gradle lockfiles, for exact results.`);
  const unresolvedCount = all.filter(p => p.skipReason === "unresolved").length;
  if (unresolvedCount) limitations.push(`${unresolvedCount} dependenc${unresolvedCount === 1 ? "y's version" : "ies' versions"} could not be determined, so ${unresolvedCount === 1 ? "it was" : "they were"} not checked. The Packages tab lists each with the reason.`);
  if (v4Only) limitations.push("Some advisories publish only a CVSS v4 vector. The vector is shown, but no score is computed for it, so their severity is Unknown.");
  if (outOfRangeTotal) limitations.push(`${outOfRangeTotal} advisor${outOfRangeTotal === 1 ? "y was" : "ies were"} left out because the declared version ranges exclude every affected version.`);
  const unreadable = parsed.filter(f => f.error);
  if (unreadable.length) limitations.push(`${unreadable.length} file${unreadable.length === 1 ? "" : "s"} could not be read: ${unreadable.slice(0, 5).map(f => f.path).join(", ")}${unreadable.length > 5 ? ", …" : ""}.`);
  const unsupported = options.unsupported ?? [];
  diagnostics.filesUnsupported = unsupported.length;
  if (unsupported.length) {
    const formats = [...new Set(unsupported.map(u => u.format))];
    limitations.push(`${unsupported.length} dependency file${unsupported.length === 1 ? " is" : "s are"} in a format the scanner cannot read (${formats.join(", ")}): ${unsupported.slice(0, 5).map(u => u.path).join(", ")}${unsupported.length > 5 ? ", …" : ""}. Their dependencies were not checked.`);
    log(`Unsupported dependency files: ${unsupported.map(u => `${u.path} (${u.format})`).join(", ")}`);
  }
  if (cancelled) limitations.push("The scan was cancelled, so these results are incomplete.");

  findings.sort(compareFindings);
  const packageList: PackageRecord[] = all.map(({ refs: _refs, queryName: _q, ...rest }) => rest).sort((a, b) =>
    statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name) || (a.version ?? "").localeCompare(b.version ?? ""));
  const summary = summarize(parsed, packageList, findings);
  diagnostics.findings = findings.length;
  diagnostics.outOfRangeDropped = outOfRangeTotal;
  // Every cause of an incomplete scan is named, so "Scan incomplete" is never a mystery.
  const incompleteReasons: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (summary.unresolvedPackages) incompleteReasons.push(`${plural(summary.unresolvedPackages, "dependency's version", "dependencies' versions")} could not be determined`);
  if (summary.failedPackages) incompleteReasons.push(`${plural(summary.failedPackages, "dependency", "dependencies")} could not be checked with OSV`);
  if (diagnostics.recordsFailed) incompleteReasons.push(`${plural(diagnostics.recordsFailed, "advisory record", "advisory records")} could not be loaded`);
  if (diagnostics.filesFailed) incompleteReasons.push(`${plural(diagnostics.filesFailed, "dependency file", "dependency files")} could not be read (${unreadable.slice(0, 3).map(f => f.path).join(", ")}${unreadable.length > 3 ? ", …" : ""})`);
  if (unsupported.length) incompleteReasons.push(`${plural(unsupported.length, "dependency file is", "dependency files are")} in an unsupported format`);
  if (partial && !incompleteReasons.length) incompleteReasons.push("some OSV requests failed");
  const status: ScanResult["status"] = cancelled ? "cancelled" : incompleteReasons.length ? "incomplete" : "complete";
  if (cancelled) incompleteReasons.unshift("the scan was cancelled");
  log(`Findings: ${findings.length} (${summary.uniqueVulnerabilities} unique advisories) after merging ${diagnostics.aliasesMerged} alias id${diagnostics.aliasesMerged === 1 ? "" : "s"}, dropping ${diagnostics.withdrawnDropped} withdrawn and ${outOfRangeTotal} out of the declared range. Critical ${summary.critical}, high ${summary.high}, medium ${summary.medium}, low ${summary.low}, unknown ${summary.unknown}.`);
  log(`Packages: ${summary.packages} discovered, ${summary.analyzedPackages} analysed, ${summary.unresolvedPackages} unresolved, ${summary.outOfScopePackages} out of scope, ${summary.failedPackages} failed. Scan ${status}.`);
  progress("done", status === "complete" ? "Scan complete" : status === "cancelled" ? "Scan cancelled" : "Scan finished with gaps", 1);
  return {
    schemaVersion: 1,
    status,
    incompleteReasons,
    ...(unsupported.length ? { unsupportedFiles: unsupported } : {}),
    diagnostics,
    tool: TOOL_NAME,
    toolVersion: options.toolVersion,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    workspace: options.workspace,
    source: options.source,
    files: parsed.map(f => ({ path: f.path, ecosystem: f.ecosystem, kind: f.kind, manager: f.manager, warnings: f.warnings, ...(f.error ? { error: f.error } : {}), ...(f.resolvedBy ? { resolvedBy: f.resolvedBy } : {}), packages: new Set(f.dependencies.map(d => `${d.name}@${d.version ?? ""}`)).size })),
    packages: packageList,
    findings,
    remediations,
    summary,
    errors,
    limitations,
    partial: partial || cancelled,
    cancelled,
    api: { baseUrl: client.baseUrl, requests: client.stats.requests, cachedRecords: fetched.cached, fetchedRecords: fetched.fetched }
  };
}

function hasSeverity(record: OsvRecord): boolean {
  return Boolean(record.database_specific?.severity) || (record.severity ?? []).some(entry => entry.type === "CVSS_V3" || entry.type === "CVSS_V2");
}

function statusRank(status: PackageRecord["status"]): number {
  return ["vulnerable", "potential", "unanalyzed", "clean"].indexOf(status);
}

export function compareFindings(a: Finding, b: Finding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || (b.cvssScore ?? -1) - (a.cvssScore ?? -1)
    || (a.confidence === b.confidence ? 0 : a.confidence === "confirmed" ? -1 : 1)
    || a.packageName.localeCompare(b.packageName)
    || a.id.localeCompare(b.id);
}

function summarize(files: ParsedFile[], packages: PackageRecord[], findings: Finding[]): ScanSummary {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const finding of findings) counts[finding.severity]++;
  const unanalyzed = packages.filter(p => p.status === "unanalyzed");
  return {
    ...counts,
    files: files.length,
    packages: packages.length,
    analyzedPackages: packages.length - unanalyzed.length,
    unresolvedPackages: unanalyzed.filter(p => p.skipReason === "unresolved").length,
    outOfScopePackages: unanalyzed.filter(p => p.skipReason === "source" || p.skipReason === undefined).length,
    failedPackages: unanalyzed.filter(p => p.skipReason === "failed" || p.skipReason === "cancelled").length,
    uniqueVulnerabilities: new Set(findings.map(f => f.id)).size,
    vulnerablePackages: packages.filter(p => p.status === "vulnerable").length,
    potentialPackages: packages.filter(p => p.status === "potential").length,
    cleanPackages: packages.filter(p => p.status === "clean").length,
    unanalyzedPackages: packages.filter(p => p.status === "unanalyzed").length,
    findings: findings.length,
    confirmedFindings: findings.filter(f => f.confidence === "confirmed").length,
    potentialFindings: findings.filter(f => f.confidence === "potential").length,
    ecosystems: [...new Set(packages.map(p => p.ecosystem))].sort()
  };
}

// ---------------------------------------------------------------------------
// One package's advisories
// ---------------------------------------------------------------------------

type Affected = NonNullable<OsvRecord["affected"]>[number];

function matchingAffected(record: OsvRecord, ecosystem: OsvEcosystem, name: string): Affected[] {
  const wanted = matchName(ecosystem, name);
  return (record.affected ?? []).filter(a => ecosystemBase(a.package?.ecosystem) === ecosystem && matchName(ecosystem, a.package?.name ?? "") === wanted);
}

function intervalsFor(affected: Affected[], cmp: Compare): Interval[] {
  return affected.flatMap(a => (a.ranges ?? []).filter(r => r.type !== "GIT").flatMap(r => intervalsOf(r as never, cmp)));
}

function isOpenEnded(interval: Interval): boolean {
  return interval.fixed === undefined && interval.lastAffected === undefined && interval.limit === undefined;
}

/** Can a version allowed by `span` be affected? (Lower-unbounded spans only count advisories that reach the top of the range.) */
function relevantToSpan(span: Span, intervals: Interval[], versions: string[], cmp: Compare, comparable: (v: string) => boolean): boolean {
  if (!intervals.length && !versions.length) return true;
  if (intervals.some(iv => {
    if (!spanOverlaps(span, iv, cmp, comparable)) return false;
    if (span.lower) return true;
    // No lower bound: the package manager installs the newest allowed version, so
    // only advisories still open there (or fixed above the range's top) matter.
    if (isOpenEnded(iv)) return true;
    if (!span.upper) return false;
    if (iv.lastAffected !== undefined) return true; // cannot tell where the top of the range sits; stay conservative
    const end = (iv.fixed ?? iv.limit)!;
    if (!comparable(end) || !comparable(span.upper.version)) return true;
    const c = cmp(end, span.upper.version);
    // `< 2.0` with a fix in 2.0 leaves 1.x affected; `<= 2.0` needs the fix above 2.0.
    return span.upper.inclusive ? c > 0 : c >= 0;
  })) return true;
  return span.lower !== undefined && versions.some(v => comparable(v) && spanContains(span, v, cmp));
}

export function analysePackage(pkg: Pick<PackageRecord, "key" | "ecosystem" | "name" | "version" | "status" | "resolution" | "specs" | "devOnly">, refs: VulnRef[], records: Map<string, OsvRecord>, missing: Map<string, string>): Analysis {
  const cmp = comparatorFor(pkg.ecosystem);
  const comparable = (v: string) => isComparable(pkg.ecosystem, v);
  const potential = pkg.status === "potential";
  const ids = [...new Set(refs.map(r => r.id))];
  const groups = new UnionFind();
  for (const id of ids) {
    groups.find(id);
    for (const alias of records.get(id)?.aliases ?? []) if (ids.includes(alias)) groups.union(id, alias);
    // Aliases are symmetric, but records do not always list each other: also join through a shared alias (a CVE).
    for (const alias of records.get(id)?.aliases ?? []) groups.union(id, `alias:${alias}`);
  }
  const byGroup = new Map<string, string[]>();
  for (const id of ids) {
    const root = groups.find(id);
    byGroup.set(root, [...(byGroup.get(root) ?? []), id]);
  }
  const spans = potential ? (pkg.specs.length ? pkg.specs.map(spec => declaredSpans(pkg.ecosystem, spec)) : [[{}]]) : [];
  const findings: Finding[] = [];
  let outOfRange = 0;
  let withdrawn = 0;
  let merged = 0;
  for (const members of byGroup.values()) {
    const recs = members.map(id => records.get(id)).filter((r): r is OsvRecord => Boolean(r));
    const live = recs.filter(r => !r.withdrawn);
    // Dropped only when every id has a record and all of them are withdrawn; a missing record keeps the finding.
    if (recs.length === members.length && !live.length) { withdrawn++; continue; }
    merged += members.length - 1;
    const affected = live.flatMap(r => matchingAffected(r, pkg.ecosystem, pkg.name));
    const intervals = intervalsFor(affected, cmp);
    const versions = affected.flatMap(a => a.versions ?? []);

    let relevant: Interval[] = intervals;
    if (potential && live.length) {
      const known = spans.filter((s): s is Span[] => Boolean(s));
      const unknownRange = spans.some(s => !s);
      if (!unknownRange && known.length) {
        const keep = known.some(list => list.some(span => relevantToSpan(span, intervals, versions, cmp, comparable)));
        if (!keep) { outOfRange++; continue; }
        relevant = intervals.filter(iv => known.some(list => list.some(span => relevantToSpan(span, [iv], [], cmp, comparable))));
        if (!relevant.length) relevant = intervals;
      }
    }

    const fixedVersions = sortVersions(intervals.map(iv => iv.fixed).filter((v): v is string => Boolean(v)), cmp);
    let fixedIn: string | undefined;
    let noFix = false;
    if (!live.length || !affected.length) {
      // Without the record, or when the advisory does not list this package under this name,
      // nothing is known about fixes: "unknown", never "no fix".
    } else if (!potential && pkg.version) {
      const containing = intervals.filter(iv => inInterval(pkg.version!, iv, cmp, comparable) === true);
      if (containing.length) {
        const fixes = containing.map(iv => iv.fixed);
        if (fixes.some(f => f === undefined)) noFix = true;
        else fixedIn = maxVersion(fixes as string[], cmp);
      } else if (comparable(pkg.version)) {
        // OSV says it is affected (perhaps through an enumerated version list): the next fix above it applies.
        fixedIn = fixedVersions.find(v => comparable(v) && cmp(v, pkg.version!) > 0);
        noFix = !fixedIn;
      } else {
        noFix = fixedVersions.length === 0;
      }
    } else {
      const fixes = relevant.map(iv => iv.fixed);
      if (relevant.some(isOpenEnded) || (relevant.length && fixes.every(f => f === undefined))) noFix = true;
      fixedIn = noFix ? undefined : maxVersion(fixes.filter((v): v is string => Boolean(v)), cmp);
    }

    // Maven artifacts published in flavours (Guava's -jre / -android) are fixed in the flavour you use.
    if (fixedIn && pkg.ecosystem === "Maven" && pkg.version) fixedIn = alignFlavour(pkg.version, fixedIn);

    const primary = [...members].sort((a, b) => primaryRank(a) - primaryRank(b) || a.localeCompare(b))[0];
    const lead = live.find(r => r.id === primary) ?? live.find(r => r.id.startsWith("GHSA-")) ?? live.find(r => r.summary) ?? live[0];
    let severity = resolveSeverity(live, r => matchingAffected(r as OsvRecord, pkg.ecosystem, pkg.name));
    if (severity.severity === "unknown" && live.length) {
      const aliasRecords = [...new Set(live.flatMap(r => r.aliases ?? []))].filter(id => !members.includes(id))
        .map(id => records.get(id)).filter((r): r is OsvRecord => Boolean(r) && !r!.withdrawn);
      if (aliasRecords.length) {
        const borrowed = resolveSeverity([...live, ...aliasRecords], r => matchingAffected(r as OsvRecord, pkg.ecosystem, pkg.name));
        if (borrowed.severity !== "unknown") severity = { ...borrowed, source: `${borrowed.source}, an alias of this advisory` };
      }
    }
    const aliasSet = new Set<string>([...members, ...live.flatMap(r => r.aliases ?? [])]);
    aliasSet.delete(primary);
    const references: Reference[] = [];
    const seenUrls = new Set<string>();
    for (const record of live) {
      for (const ref of record.references ?? []) {
        if (!ref.url || !/^https?:\/\//i.test(ref.url) || seenUrls.has(ref.url)) continue;
        seenUrls.add(ref.url);
        references.push({ type: String(ref.type ?? "WEB"), url: ref.url });
      }
    }
    const published = live.map(r => r.published).filter((v): v is string => Boolean(v)).sort()[0];
    const modified = live.map(r => r.modified).filter(Boolean).sort().slice(-1)[0];
    const cwes = [...new Set(live.flatMap(r => {
      const value = r.database_specific?.cwe_ids;
      return Array.isArray(value) ? value.map(String) : [];
    }))];
    const informational = live.map(r => r.database_specific?.informational ?? affected.find(a => a.database_specific?.informational)?.database_specific?.informational)
      .find(v => typeof v === "string" && v) as string | undefined;
    const confidence: Confidence = potential || pkg.resolution === "declared" ? "potential" : "confirmed";
    const details = lead?.details && lead.details.length > DETAILS_LIMIT ? `${lead.details.slice(0, DETAILS_LIMIT)}…` : lead?.details;
    findings.push({
      key: `${pkg.key}::${primary}`,
      id: primary,
      aliases: [...aliasSet].sort((a, b) => primaryRank(b) - primaryRank(a) || a.localeCompare(b)),
      packageKey: pkg.key,
      ecosystem: pkg.ecosystem,
      packageName: pkg.name,
      ...(pkg.version ? { installedVersion: pkg.version } : {}),
      confidence,
      ...(confidence === "potential" ? {
        confidenceNote: pkg.resolution === "declared"
          ? `Version ${pkg.version} is declared in a build script; the resolved version may differ.`
          : `Only the range ${pkg.specs.map(s => `"${s}"`).join(" / ") || "(any version)"} is known, and it allows affected versions. Lock dependencies to confirm.`
      } : {}),
      severity: severity.severity,
      ...(severity.source ? { severitySource: severity.source } : {}),
      ...(severity.cvssScore !== undefined ? { cvssScore: severity.cvssScore, cvssVector: severity.cvssVector } : {}),
      ...(severity.cvssV4Vector ? { cvssV4Vector: severity.cvssV4Vector } : {}),
      ...(lead?.summary ? { summary: lead.summary } : {}),
      ...(details ? { details } : {}),
      ...(published ? { published } : {}),
      ...(modified ? { modified } : {}),
      affectedRanges: [...new Set((relevant.length ? relevant : intervals).map(describeInterval))]
        .concat(!intervals.length && versions.length ? [`${versions.length} specific version${versions.length === 1 ? "" : "s"} listed`] : [])
        .concat(live.length && !affected.length ? [`OSV matched this version, but the advisory does not list ${pkg.name} by this name, so its ranges are not shown`] : []),
      fixedVersions,
      ...(fixedIn ? { fixedIn } : {}),
      // "No fix" only when the advisory's data for this package says so; missing data is "unknown".
      noFix: !fixedIn && noFix,
      references,
      osvUrl: `https://osv.dev/vulnerability/${encodeURIComponent(primary)}`,
      detailsAvailable: live.length > 0,
      ...(informational ? { informational } : {}),
      cwes,
      devOnly: pkg.devOnly,
      ...(!live.length && members.some(id => missing.has(id)) ? { summary: `Details could not be loaded: ${missing.get(members.find(id => missing.has(id))!)}` } : {})
    });
  }
  return { findings, outOfRange, withdrawn, merged };
}

/** `32.0.0-android` for a `30.1-jre` user becomes `32.0.0-jre`: the same release in the flavour they use. */
export function alignFlavour(installed: string, fixed: string): string {
  const mine = mavenFlavour(installed);
  const theirs = mavenFlavour(fixed);
  // Letters only (jre, android): Jetty's ".v20220622" build stamps are part of the version, not a flavour.
  if (!/^[a-z]+$/.test(mine) || !/^[a-z]+$/.test(theirs) || mine === theirs) return fixed;
  return `${fixed.slice(0, fixed.length - theirs.length)}${mine}`;
}
