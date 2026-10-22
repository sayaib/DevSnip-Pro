/**
 * Shared shapes of the OSV Vulnerability Scanner.
 *
 * Everything in this file is plain data: it crosses from the parsers to the
 * scan, from the scan to the webview, and into exported JSON reports, so it
 * must stay serialisable (no Maps, no class instances, no functions).
 */

/** OSV ecosystem names exactly as https://ossf.github.io/osv-schema/ spells them (requests are case-sensitive). */
export type OsvEcosystem =
  | "npm" | "PyPI" | "Maven" | "Go" | "crates.io" | "RubyGems" | "NuGet"
  | "Packagist" | "Pub" | "Hex" | "SwiftURL" | "CRAN";

export const SUPPORTED_ECOSYSTEMS: OsvEcosystem[] = [
  "npm", "PyPI", "Maven", "Go", "crates.io", "RubyGems", "NuGet", "Packagist", "Pub", "Hex", "SwiftURL", "CRAN"
];

export type Severity = "critical" | "high" | "medium" | "low" | "unknown";
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "unknown"];

export type DependencyScope = "production" | "development" | "optional" | "peer";

/** The tool that wrote (and can update) a dependency: decides the remediation commands. */
export type PackageManager =
  | "npm" | "yarn" | "yarn-berry" | "pnpm" | "bun"
  | "pip" | "pipenv" | "poetry" | "uv" | "pdm" | "conda"
  | "maven" | "gradle" | "go" | "cargo" | "bundler" | "nuget" | "composer" | "pub" | "mix" | "swiftpm" | "renv";

/**
 * How a dependency's version was learned.
 *  - lockfile: resolved by the package manager (exact, includes transitive dependencies)
 *  - pinned:   an exact version in a manifest that the package manager installs as written
 *  - declared: a version written in a manifest that the build tool may still change (Gradle conflict resolution)
 *  - range:    only a range or no version, so the installed version is not known
 */
export type Resolution = "lockfile" | "pinned" | "declared" | "range";

/** One dependency as a parser read it from one file. */
export interface ParsedDependency {
  /** Name as OSV expects it for the ecosystem (Maven `group:artifact`, NuGet keeps its casing). */
  name: string;
  /** Exact version, when the file states one reliably. */
  version?: string;
  /** Declared range or specifier, for manifest entries. */
  spec?: string;
  resolution: Resolution;
  scope: DependencyScope;
  /** True for a direct dependency, false for transitive, undefined when the file does not say. */
  direct?: boolean;
  /** 1-based line where the dependency appears, when it can be found. */
  line?: number;
  /** Why the version could not be used (git source, property that does not resolve, ...). */
  note?: string;
  /** False for entries that never come from the public registry (path, git, workspace members). */
  registry?: boolean;
  /** Why a registry: false entry is not checked: its version is unknown, or it comes from a source OSV does not cover. */
  skip?: SkipReason;
  /** Dependency path from the project's direct dependency down to this one's parent (group:artifact:version). */
  via?: string[];
}

/**
 * Why a package was not checked against OSV:
 *  - unresolved: its version could not be determined (makes the scan incomplete)
 *  - source:     git, path, private registry or another source OSV does not cover (outside the scan's scope)
 *  - failed:     OSV could not be queried for it (makes the scan incomplete)
 *  - cancelled:  the scan stopped before it was checked
 */
export type SkipReason = "unresolved" | "source" | "failed" | "cancelled";

export type FileKind = "lockfile" | "manifest";

/** The result of parsing one dependency file. */
export interface ParsedFile {
  /** Workspace-relative path with forward slashes. */
  path: string;
  ecosystem: OsvEcosystem;
  kind: FileKind;
  manager: PackageManager;
  dependencies: ParsedDependency[];
  warnings: string[];
  /** Set when the file could not be read at all; dependencies is then empty. */
  error?: string;
  /** How versions were resolved, when not read straight from the file (e.g. "Maven (./mvnw dependency:tree)"). */
  resolvedBy?: string;
  /**
   * For lockfiles that record their workspace: the project folders they cover, relative to the
   * lockfile's folder ("" for the root). Undefined when the format does not say.
   */
  members?: string[];
}

/** Where one dependency was found. */
export interface Occurrence {
  file: string;
  line?: number;
  /** Directory of the project the file belongs to ("" for the workspace root). */
  project: string;
  manager: PackageManager;
  scope: DependencyScope;
  direct?: boolean;
  spec?: string;
  resolution: Resolution;
  via?: string[];
}

export type PackageStatus = "vulnerable" | "potential" | "clean" | "unanalyzed";

/** A unique (ecosystem, name, version) in the workspace, with every place it was found. */
export interface PackageRecord {
  key: string;
  ecosystem: OsvEcosystem;
  name: string;
  /** Exact version, or undefined when only a range is known. */
  version?: string;
  resolution: Resolution;
  /** Declared ranges, for unresolved packages. */
  specs: string[];
  occurrences: Occurrence[];
  status: PackageStatus;
  /** Why the package could not be analysed, or what limits the result. */
  note?: string;
  /** Set when status is "unanalyzed". */
  skipReason?: SkipReason;
  /** Primary ids of the findings against this package. */
  findingIds: string[];
  direct?: boolean;
  /** True when every occurrence is a development-only dependency. */
  devOnly: boolean;
}

export interface Reference { type: string; url: string }

export type Confidence = "confirmed" | "potential";

/** One advisory (with its aliases merged) affecting one package. */
export interface Finding {
  /** Unique within a scan: `${packageKey}::${id}`. */
  key: string;
  id: string;
  /** Other identifiers of the same vulnerability (CVE, GHSA, PYSEC, GO, RUSTSEC, ...), sorted. */
  aliases: string[];
  packageKey: string;
  ecosystem: OsvEcosystem;
  packageName: string;
  installedVersion?: string;
  confidence: Confidence;
  /** Why a potential finding is not confirmed. */
  confidenceNote?: string;
  severity: Severity;
  /** Where the severity came from, e.g. "GitHub Advisory Database" or "CVSS 3.1 vector (NVD)". */
  severitySource?: string;
  /** Highest CVSS base score computed from a vector the advisory provides. */
  cvssScore?: number;
  cvssVector?: string;
  /** CVSS v4 vectors are shown but not scored (see severity.ts). */
  cvssV4Vector?: string;
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  /** Human-readable affected ranges for this package, e.g. ">= 4.0.0, < 4.17.21". */
  affectedRanges: string[];
  /** Every version the advisory says fixes it for this package, ascending. */
  fixedVersions: string[];
  /** The first fixed version above the installed one, when one exists. */
  fixedIn?: string;
  /** The advisory lists no fixed version for the installed version. */
  noFix: boolean;
  references: Reference[];
  /** https://osv.dev/vulnerability/<id> */
  osvUrl: string;
  /** False when the full record could not be fetched; only the id is known. */
  detailsAvailable: boolean;
  /** RustSec informational advisories (unmaintained, unsound, notice). */
  informational?: string;
  cwes: string[];
  devOnly: boolean;
}

export interface RemediationCommand {
  label: string;
  command: string;
  /** Workspace-relative directory the command runs in. */
  cwd: string;
}

export interface Remediation {
  packageKey: string;
  ecosystem: OsvEcosystem;
  packageName: string;
  installedVersion?: string;
  /** Lowest version that fixes every finding with a fix, when one exists. */
  targetVersion?: string;
  /** Result of asking OSV about the target version itself. */
  targetCheck?: { status: "clean" | "vulnerable" | "unchecked"; remaining: string[] };
  /** Findings with no fixed version at all. */
  unfixed: string[];
  commands: RemediationCommand[];
  guidance: string[];
}

export interface SeverityCounts { critical: number; high: number; medium: number; low: number; unknown: number }

export interface ScanSummary extends SeverityCounts {
  files: number;
  /** Unique packages discovered (ecosystem + name + version). */
  packages: number;
  /** Packages OSV answered for (vulnerable, potential or clean). */
  analyzedPackages: number;
  /** Packages whose version could not be determined. */
  unresolvedPackages: number;
  /** Packages from git, paths or private sources, which OSV does not cover. */
  outOfScopePackages: number;
  /** Packages OSV could not be queried for (or that the cancelled scan did not reach). */
  failedPackages: number;
  /** Distinct advisories, counting an advisory that affects several packages once. */
  uniqueVulnerabilities: number;
  vulnerablePackages: number;
  potentialPackages: number;
  cleanPackages: number;
  unanalyzedPackages: number;
  findings: number;
  confirmedFindings: number;
  potentialFindings: number;
  ecosystems: OsvEcosystem[];
}

/** Counters for each stage, so a missing finding can be traced to where it was lost. */
export interface ScanDiagnostics {
  filesRead: number;
  filesFailed: number;
  dependenciesParsed: number;
  packagesDiscovered: number;
  packagesQueried: number;
  packagesFromCache: number;
  queriesFailed: number;
  batches: number;
  pagesFollowed: number;
  fallbackQueries: number;
  advisoryReferences: number;
  uniqueAdvisoryIds: number;
  recordsFetched: number;
  recordsFromCache: number;
  recordsFailed: number;
  withdrawnDropped: number;
  outOfRangeDropped: number;
  aliasesMerged: number;
  findings: number;
  /** Maven reactors and Gradle builds: whether the build tool or DevSnip Pro resolved them. */
  buildTools: Array<{ tool: "Maven" | "Gradle"; project: string; method: "build-tool" | "builtin"; modules: number; dependencies: number; unresolved: number; detail?: string }>;
}

export type ScanStatus = "complete" | "incomplete" | "cancelled";

export interface ScanResult {
  schemaVersion: 1;
  /** complete: every discovered package in scope was resolved and checked; incomplete: some were not (see summary). */
  status: ScanStatus;
  diagnostics: ScanDiagnostics;
  tool: string;
  toolVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  workspace: { name: string; folders: string[] };
  source: "workspace" | "files";
  files: Array<Pick<ParsedFile, "path" | "ecosystem" | "kind" | "manager" | "warnings" | "error" | "resolvedBy"> & { packages: number }>;
  packages: PackageRecord[];
  findings: Finding[];
  remediations: Remediation[];
  summary: ScanSummary;
  /** Requests that failed after retries; their packages are listed as unanalyzed. */
  errors: string[];
  /** What this scan could not cover. */
  limitations: string[];
  partial: boolean;
  cancelled: boolean;
  api: { baseUrl: string; requests: number; cachedRecords: number; fetchedRecords: number };
}

/** Progress events the scan reports while it runs. */
export interface ScanProgress {
  phase: "discover" | "parse" | "query" | "details" | "verify" | "done";
  message: string;
  /** 0..1 across the whole scan. */
  fraction: number;
}
