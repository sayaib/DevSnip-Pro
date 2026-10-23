import type { Finding, ManagedOrigin, OsvEcosystem, PackageManager, ScanResult, Severity } from "../osv/types";
import type { EditSpec } from "./edits";
import type { KevEntry } from "./providers/kev";
import type { NvdScore } from "./providers/nvd";
import type { OutdatedLevel } from "./providers/registry";

/**
 * The SCA Scanner's result. Plain data: it is sent to the webview and exported
 * as JSON and CSV. The vulnerability layer is the shared OSV engine's
 * ScanResult (`scan`); everything here adds to it without changing it.
 */

/** A detected project the user can choose to scan. */
export interface ScaProject {
  /** Workspace-relative directory ("" for the workspace root). */
  dir: string;
  name: string;
  ecosystems: OsvEcosystem[];
  managers: PackageManager[];
  files: string[];
  /** Spring Boot version, when the project uses its parent, BOM or Gradle plugin. */
  springBoot?: string;
  /** Maven modules or Gradle subprojects inside it. */
  modules: number;
}

/**
 * confirmed: OSV matched the exact resolved version.
 * potential: only a range or a build script read without Gradle was known.
 * informational: advisories that are notices rather than vulnerabilities (RustSec unmaintained/unsound).
 */
export type VulnerabilityClass = "confirmed" | "potential" | "informational";

export interface ScaVulnerability {
  key: string;
  class: VulnerabilityClass;
  finding: Finding;
  /** CVE ids among the id and aliases. */
  cves: string[];
  ghsas: string[];
  /** Severity after enrichment (NVD fills it in only when OSV had none). */
  severity: Severity;
  severitySource?: string;
  cvssScore?: number;
  cvssVector?: string;
  nvd?: NvdScore;
  /** CISA KEV entry: known to be exploited in the wild. */
  kev?: KevEntry;
  relation: "direct" | "transitive" | "unknown";
  /** Every dependency path that leads here (group:artifact:version chains), from the resolved tree. */
  paths: string[][];
  /** Real source locations only: files (and lines, when the parser found one). */
  locations: Array<{ file: string; line?: number }>;
  projects: string[];
  managedBy?: ManagedOrigin;
  devOnly: boolean;
}

export type HealthKind = "deprecated" | "yanked" | "abandoned" | "inactive" | "outdated";

export interface HealthFinding {
  key: string;
  /** risk for deprecated/yanked/abandoned/inactive; informational for outdated. Never a vulnerability. */
  class: "risk" | "informational";
  kind: HealthKind;
  packageKey: string;
  ecosystem: OsvEcosystem;
  packageName: string;
  installedVersion: string;
  latest?: string;
  level?: OutdatedLevel;
  message: string;
  page: string;
  relation: "direct" | "transitive" | "unknown";
  locations: Array<{ file: string; line?: number }>;
}

export type Risk = "low" | "medium" | "high" | "unknown";

export interface AdviceOption {
  id: string;
  title: string;
  detail: string;
  risk: Risk;
  /** A proposed manifest change the user can preview and apply. */
  edit?: EditSpec;
  /** One line describing the edit ("Set the property tomcat.version to 9.0.99 in pom.xml"). */
  editSummary?: string;
  /** Commands to run (copied or sent to a terminal after confirmation). */
  commands?: Array<{ command: string; cwd: string }>;
}

export interface ScaAdvice {
  packageKey: string;
  ecosystem: OsvEcosystem;
  packageName: string;
  installedVersion?: string;
  /** Lowest version fixing every finding with a fix, checked against OSV (from the shared engine). */
  target?: string;
  targetVerified?: "clean" | "vulnerable" | "unchecked";
  /** What decides the version: your manifest, a parent POM, a BOM, or another dependency. */
  controlledBy: string;
  options: AdviceOption[];
  notes: string[];
}

export interface ProviderStatus {
  id: "osv" | "kev" | "nvd" | "registries" | "maven" | "gradle";
  name: string;
  status: "ok" | "partial" | "stale" | "unavailable" | "skipped" | "off";
  message: string;
}

export interface ScaSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  /** Health findings plus informational advisories. */
  informational: number;
  /** Vulnerabilities listed in CISA's KEV catalog. */
  exploited: number;
  dependencies: number;
  vulnerableDependencies: number;
  direct: number;
  transitive: number;
  unknownRelation: number;
  unresolved: number;
  failed: number;
  outdated: number;
  maintenanceRisks: number;
}

/** What one scan did, stage by stage: for troubleshooting a missing finding or a slow or incomplete scan. No file contents or credentials. */
export interface ScaDiagnostics {
  status: "complete" | "incomplete" | "cancelled";
  /** Every cause of an incomplete result (scan and providers). */
  incompleteReasons: string[];
  projects: Array<{ dir: string; name: string; ecosystems: string[]; managers: string[]; manifests: number; springBoot?: string }>;
  files: { scanned: number; failed: string[]; unsupported: Array<{ path: string; format: string }>; leftOutAsBuildOutput: number };
  dependencies: { discovered: number; withVersion: number; rangeOnly: number; unresolved: number; outOfScope: number; failed: number; direct: number; transitive: number; relationUnknown: number };
  buildTools: Array<{ tool: string; project: string; method: string; dependencies: number; unresolved: number; problem?: string }>;
  advisories: { packagesChecked: number; packagesFromCache: number; references: number; unique: number; aliasesMerged: number; withdrawnDropped: number; outOfRangeDropped: number; findings: number; recordsFailed: number };
  /** OSV, NVD and registry errors (messages only). */
  errors: string[];
  /** Milliseconds per stage: discover, resolve, parse, inventory, query, records, verify, kev, nvd, registries, remediation, total. */
  timings: Record<string, number>;
}

export interface ScaResult {
  schemaVersion: 1;
  tool: string;
  toolVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** complete only when the dependency inventory and every provider the scan relies on are complete. */
  status: "complete" | "incomplete" | "cancelled";
  projects: ScaProject[];
  scan: ScanResult;
  vulnerabilities: ScaVulnerability[];
  health: HealthFinding[];
  advice: ScaAdvice[];
  providers: ProviderStatus[];
  summary: ScaSummary;
  limitations: string[];
  diagnostics: ScaDiagnostics;
}
