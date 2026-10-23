/**
 * The National Vulnerability Database (NVD CVE API 2.0), used only to fill in
 * a CVSS score where OSV published none for a CVE.
 *
 * NVD's public limit is 5 requests per rolling 30 seconds (50 with a free API
 * key, kept in VS Code's secret storage). Lookups are spaced to stay inside it,
 * capped per scan, and cached for a week. Only CVE ids are sent.
 */

export const NVD_API = "https://services.nvd.nist.gov/rest/json/cves/2.0";

export interface NvdScore {
  cveId: string;
  baseScore: number;
  baseSeverity: string;
  vector: string;
  version: "3.1" | "3.0" | "2.0" | "4.0";
  /** "nvd@nist.gov" (NVD's own analysis) or the CNA that scored it. */
  source: string;
  primary: boolean;
}

/** The best score in an NVD response: NVD's primary CVSS 3.x, then a secondary 3.x, then 4.0, then 2.0. */
export function parseNvdResponse(data: unknown, cveId: string): NvdScore | undefined {
  const vulns = (data as { vulnerabilities?: Array<{ cve?: { id?: string; metrics?: Record<string, unknown> } }> })?.vulnerabilities;
  const cve = Array.isArray(vulns) ? vulns.find(v => v?.cve?.id?.toUpperCase() === cveId.toUpperCase())?.cve : undefined;
  if (!cve?.metrics) return undefined;
  const candidates: NvdScore[] = [];
  const read = (key: string, version: NvdScore["version"]) => {
    const list = cve.metrics![key];
    if (!Array.isArray(list)) return;
    for (const metric of list as Array<Record<string, unknown>>) {
      const data = metric?.cvssData as Record<string, unknown> | undefined;
      const score = Number(data?.baseScore);
      if (!data || !Number.isFinite(score) || score < 0 || score > 10) continue;
      const severity = typeof data.baseSeverity === "string" ? data.baseSeverity : typeof metric.baseSeverity === "string" ? metric.baseSeverity : "";
      candidates.push({
        cveId: cve.id ?? cveId, baseScore: score, baseSeverity: severity.toUpperCase(), vector: typeof data.vectorString === "string" ? data.vectorString : "",
        version, source: typeof metric.source === "string" ? metric.source : "", primary: metric.type === "Primary"
      });
    }
  };
  read("cvssMetricV31", "3.1");
  read("cvssMetricV30", "3.0");
  read("cvssMetricV40", "4.0");
  read("cvssMetricV2", "2.0");
  const rank = (s: NvdScore) => (s.version.startsWith("3") ? (s.primary ? 0 : 1) : s.version === "4.0" ? 2 : 3);
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}

export interface NvdStore {
  get(cveId: string): Promise<{ at: number; score: NvdScore | null } | undefined>;
  set(cveId: string, value: { at: number; score: NvdScore | null }): Promise<void>;
}

export type FetchJsonWithHeaders = (url: string, headers: Record<string, string>, signal?: AbortSignal) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface NvdOptions {
  apiKey?: string;
  /** At most this many network lookups per scan (cached answers do not count). */
  maxLookups?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

export interface NvdBatch {
  scores: Map<string, NvdScore>;
  looked: number;
  fromCache: number;
  skipped: string[];
  errors: string[];
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Looks up CVSS scores for CVEs, spacing requests inside NVD's rate limit. */
export async function lookupNvd(cveIds: string[], fetchJson: FetchJsonWithHeaders, store: NvdStore | undefined, options: NvdOptions = {}): Promise<NvdBatch> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("cancelled")); }, { once: true });
  }));
  // 5 per 30 s without a key, 50 per 30 s with one; a little slack for clock drift.
  const spacing = options.apiKey ? 700 : 6500;
  const batch: NvdBatch = { scores: new Map(), looked: 0, fromCache: 0, skipped: [], errors: [] };
  const unique = [...new Set(cveIds.map(id => id.toUpperCase()).filter(id => /^CVE-\d{4}-\d{4,}$/.test(id)))];
  const max = options.maxLookups ?? (options.apiKey ? 60 : 12);
  let first = true;
  let limited = false;
  for (const cveId of unique) {
    if (options.signal?.aborted) break;
    const cached = await store?.get(cveId).catch(() => undefined);
    if (cached && now() - cached.at < WEEK) {
      batch.fromCache++;
      if (cached.score) batch.scores.set(cveId, cached.score);
      continue;
    }
    if (batch.looked >= max || limited) { batch.skipped.push(cveId); continue; }
    if (!first) await sleep(spacing, options.signal).catch(() => undefined);
    first = false;
    if (options.signal?.aborted) break;
    batch.looked++;
    try {
      const response = await fetchJson(`${NVD_API}?cveId=${encodeURIComponent(cveId)}`, options.apiKey ? { apiKey: options.apiKey } : {}, options.signal);
      // Rate limited: stop for this scan instead of hammering NVD; the rest are reported as skipped.
      if (response.status === 403 || response.status === 429) { limited = true; batch.errors.push(`NVD rate limit reached (HTTP ${response.status})`); batch.skipped.push(cveId); continue; }
      if (response.status !== 200) { batch.errors.push(`NVD answered HTTP ${response.status} for ${cveId}`); continue; }
      const score = parseNvdResponse(await response.json(), cveId);
      await store?.set(cveId, { at: now(), score: score ?? null }).catch(() => undefined);
      if (score) batch.scores.set(cveId, score);
    } catch (error) {
      batch.errors.push(`${cveId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return batch;
}
