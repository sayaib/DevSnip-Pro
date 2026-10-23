import { compareMaven } from "../services/dependency-versions";
import { Gav, gavString, MavenResolver, PomRepository } from "../osv/maven/resolver";

/**
 * "Which version of the BOM that controls this dependency fixes it?"
 *
 * A Spring Boot application rarely chooses Tomcat's, Jackson's or Netty's
 * version itself: spring-boot-dependencies does. The safest fix is usually the
 * lowest Spring Boot release whose BOM manages fixed versions of every
 * vulnerable artifact it controls. This searches the BOM's published versions
 * (maven-metadata.xml), loading each candidate BOM for real, in order of risk:
 * patch releases of the current minor line first, then later minor lines,
 * then later major versions.
 */

export interface BomTarget {
  groupId: string;
  artifactId: string;
  /** The BOM inside this one that manages it (jackson-bom inside spring-boot-dependencies), "group:artifact". */
  via?: string;
  /** Lowest version that fixes the advisories (from the shared engine; OSV-verified). */
  fixedIn: string;
  /** Advisory ids to check a candidate version against. */
  ids?: string[];
}

/**
 * Whether `version` of the target is free of its advisories. The host asks OSV
 * (exact for every release branch); undefined falls back to the comparison
 * below. Without it, a version counts as fixed only on the fixed release's own
 * major line: Tomcat 10.1.1 is not "fixed" because it sorts after 9.0.62.
 */
export type IsFixed = (target: BomTarget, version: string, signal?: AbortSignal) => Promise<boolean | undefined>;

/** What the searches for one BOM in a scan share: its published versions, a resolver (and its POM cache), and answers. */
export interface BomCache {
  /** The published versions, requested once even when several searches start together. */
  listed?: Promise<string[] | { error: string }>;
  resolver?: MavenResolver;
  /** "version|group:artifact" → managed version (null: not managed there). */
  managed: Map<string, string | null>;
  /** BOM versions examined (each costs a POM or a few). */
  loads: number;
  examined: Set<string>;
}
export const newBomCache = (): BomCache => ({ managed: new Map(), loads: 0, examined: new Set() });

const major = (v: string) => v.split(/[.-]/)[0];
const comparedFix = (version: string, fixedIn: string) => compareMaven(version, fixedIn) >= 0 && major(version) === major(fixedIn);

export interface BomUpgrade {
  bom: { groupId: string; artifactId: string };
  from: string;
  to: string;
  /** low: a patch release of the same line; medium: a later minor; high: a later major. */
  risk: "low" | "medium" | "high";
  /** What the BOM manages at `to`, per target. */
  managed: Array<{ artifact: string; version: string }>;
  notes: string[];
  /** BOM versions loaded to decide. */
  evaluated: number;
}

const UNSTABLE = /(?:[-.](?:M|RC|CR|SNAPSHOT|BUILD-SNAPSHOT|alpha|beta)\d*)$|-SNAPSHOT/i;

function line(version: string): string {
  const [major, minor] = version.split(/[.-]/);
  return `${major}.${minor ?? "0"}`;
}

/** Lowest BOM version (above `bom.version`) that manages every target at or above its fix. */
export async function findBomUpgrade(repository: PomRepository, bom: Gav, targets: BomTarget[], options: { signal?: AbortSignal; maxLoads?: number; isFixed?: IsFixed; cache?: BomCache } = {}): Promise<BomUpgrade | { error: string }> {
  if (!targets.length) return { error: "Nothing to fix through this BOM." };
  if (!repository.versions) return { error: "Published BOM versions cannot be listed." };
  const shared = options.cache ?? newBomCache();
  shared.listed ??= repository.versions(bom.groupId, bom.artifactId, ["https://repo.maven.apache.org/maven2"], options.signal);
  const listed = await shared.listed;
  if (!Array.isArray(listed)) { if (!options.signal?.aborted) shared.listed = undefined; return { error: `The published versions of ${bom.groupId}:${bom.artifactId} could not be read (${listed.error}).` }; }
  const candidates = [...new Set(listed)].filter(v => !UNSTABLE.test(v) && compareMaven(v, bom.version) > 0).sort(compareMaven);
  if (!candidates.length) return { error: `No newer stable ${bom.artifactId} release exists than ${bom.version}.` };

  // The budget counts BOM versions examined across every search sharing the cache; examined versions are free.
  const maxLoads = options.maxLoads ?? 24;
  const startLoads = shared.loads;
  shared.resolver ??= new MavenResolver([], repository, options.signal);
  const resolver = shared.resolver;
  let outOfBudget = false;
  const managedVersion = async (version: string, t: BomTarget): Promise<string | undefined | null> => {
    const key = `${version}|${t.groupId}:${t.artifactId}`;
    if (shared.managed.has(key)) return shared.managed.get(key);
    if (!shared.examined.has(version)) {
      if (shared.loads - startLoads >= maxLoads || options.signal?.aborted) { outOfBudget = true; return undefined; }
      shared.loads++;
      shared.examined.add(version);
    }
    const [vg, va] = t.via?.split(":") ?? [];
    const found = await resolver.managedVersion({ groupId: bom.groupId, artifactId: bom.artifactId, version }, t.groupId, t.artifactId, vg && va ? { groupId: vg, artifactId: va } : undefined).catch(() => undefined);
    if (options.signal?.aborted) return undefined;
    shared.managed.set(key, found ?? null);
    return found ?? null;
  };
  const fixes = async (version: string): Promise<boolean | undefined> => {
    for (const t of targets) {
      const v = await managedVersion(version, t);
      if (v === undefined) return undefined;
      if (v === null) return false;
      // On the fixed release's own major line the comparison is exact for these advisories; across lines OSV decides.
      const verdict = major(v) === major(t.fixedIn) ? compareMaven(v, t.fixedIn) >= 0 : options.isFixed ? await options.isFixed(t, v, options.signal) : undefined;
      if (!(verdict ?? comparedFix(v, t.fixedIn))) return false;
    }
    return true;
  };

  // Lines in order: the current minor line, then later lines.
  const lines = new Map<string, string[]>();
  for (const v of candidates) lines.set(line(v), [...(lines.get(line(v)) ?? []), v]);
  for (const [name, versions] of lines) {
    const newest = versions[versions.length - 1];
    const ok = await fixes(newest);
    if (ok === undefined) break; // out of budget or unreadable: stop rather than guess
    if (!ok) continue;
    // Managed versions only move forward within a line, so the lowest fixing release is found by bisection.
    let lo = 0, hi = versions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const result = await fixes(versions[mid]);
      if (result === undefined) { lo = hi; break; }
      if (result) hi = mid; else lo = mid + 1;
    }
    const to = versions[hi];
    const sameLine = name === line(bom.version);
    const sameMajor = name.split(".")[0] === bom.version.split(".")[0];
    const notes: string[] = [];
    if (bom.groupId === "org.springframework.boot" && Number(bom.version.split(".")[0]) < 3 && Number(to.split(".")[0]) >= 3) {
      notes.push("Spring Boot 3 requires Java 17 or later and moves from Java EE (javax.*) to Jakarta EE (jakarta.*) packages; plan it as a migration.");
    }
    if (!sameLine) notes.push(`Read the ${bom.artifactId} release notes from ${bom.version} to ${to}: a ${sameMajor ? "minor" : "major"} upgrade can change behaviour and other managed versions.`);
    return {
      bom: { groupId: bom.groupId, artifactId: bom.artifactId },
      from: bom.version,
      to,
      risk: sameLine ? "low" : sameMajor ? "medium" : "high",
      managed: targets.map(t => ({ artifact: `${t.groupId}:${t.artifactId}`, version: shared.managed.get(`${to}|${t.groupId}:${t.artifactId}`) ?? "?" })),
      notes,
      evaluated: shared.loads - startLoads
    };
  }
  return { error: outOfBudget ? `No ${bom.artifactId} release fixing all of them was found within ${maxLoads} BOM versions checked.` : `No published ${bom.artifactId} release manages fixed versions of all of them yet; override the managed versions instead.` };
}

export { gavString };
