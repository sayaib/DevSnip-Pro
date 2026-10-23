/**
 * CISA's Known Exploited Vulnerabilities catalog
 * (https://www.cisa.gov/known-exploited-vulnerabilities-catalog).
 *
 * The whole catalog (about 1,800 CVEs, ~2 MB) is downloaded and matched
 * locally, so no package or CVE from the project is sent anywhere. It is
 * cached for a day; when it cannot be fetched, the last good copy is used and
 * the provider says so, and with no copy at all the provider reports itself
 * unavailable (findings are never marked "not exploited" by default).
 */

export const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const KEV_CATALOG_PAGE = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
const DAY = 24 * 60 * 60 * 1000;

export interface KevEntry {
  cveId: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  dueDate?: string;
  requiredAction?: string;
  /** "Known" when CISA knows it is used in ransomware campaigns, otherwise "Unknown". */
  knownRansomwareCampaignUse?: string;
}

export interface KevCatalog {
  version: string;
  fetchedAt: number;
  entries: Map<string, KevEntry>;
}

/** Reads the catalog JSON; anything that does not look like the published schema is rejected. */
export function parseKevCatalog(data: unknown, fetchedAt = Date.now()): KevCatalog | undefined {
  const doc = data as { catalogVersion?: unknown; vulnerabilities?: unknown };
  if (!doc || !Array.isArray(doc.vulnerabilities)) return undefined;
  const entries = new Map<string, KevEntry>();
  for (const raw of doc.vulnerabilities as Array<Record<string, unknown>>) {
    const cveId = typeof raw?.cveID === "string" ? raw.cveID.trim().toUpperCase() : "";
    if (!/^CVE-\d{4}-\d{4,}$/.test(cveId)) continue;
    const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);
    entries.set(cveId, {
      cveId,
      vendorProject: text("vendorProject") ?? "",
      product: text("product") ?? "",
      vulnerabilityName: text("vulnerabilityName") ?? "",
      dateAdded: text("dateAdded") ?? "",
      ...(text("dueDate") ? { dueDate: text("dueDate") } : {}),
      ...(text("requiredAction") ? { requiredAction: text("requiredAction") } : {}),
      ...(text("knownRansomwareCampaignUse") ? { knownRansomwareCampaignUse: text("knownRansomwareCampaignUse") } : {})
    });
  }
  if (!entries.size) return undefined;
  return { version: typeof doc.catalogVersion === "string" ? doc.catalogVersion : "", fetchedAt, entries };
}

export interface KevStore {
  read(): Promise<{ fetchedAt: number; data: unknown } | undefined>;
  write(value: { fetchedAt: number; data: unknown }): Promise<void>;
}

export type FetchJson = (url: string, signal?: AbortSignal) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface KevLoad {
  catalog?: KevCatalog;
  status: "ok" | "stale" | "unavailable";
  message: string;
}

/** The catalog: cached copy when under a day old, otherwise a fresh download (falling back to the cached copy). */
export async function loadKev(fetchJson: FetchJson, store: KevStore | undefined, options: { now?: number; signal?: AbortSignal; maxAgeMs?: number } = {}): Promise<KevLoad> {
  const now = options.now ?? Date.now();
  const cached = await store?.read().catch(() => undefined);
  const cachedCatalog = cached ? parseKevCatalog(cached.data, cached.fetchedAt) : undefined;
  if (cachedCatalog && now - cachedCatalog.fetchedAt < (options.maxAgeMs ?? DAY)) {
    return { catalog: cachedCatalog, status: "ok", message: `CISA KEV catalog ${cachedCatalog.version} (${cachedCatalog.entries.size} CVEs, cached).` };
  }
  try {
    const response = await fetchJson(KEV_URL, options.signal);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const catalog = parseKevCatalog(data, now);
    if (!catalog) throw new Error("the response does not match the catalog schema");
    await store?.write({ fetchedAt: now, data }).catch(() => undefined);
    return { catalog, status: "ok", message: `CISA KEV catalog ${catalog.version} (${catalog.entries.size} CVEs).` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (cachedCatalog) return { catalog: cachedCatalog, status: "stale", message: `The CISA KEV catalog could not be refreshed (${reason}); using the copy from ${new Date(cachedCatalog.fetchedAt).toISOString().slice(0, 10)}.` };
    return { status: "unavailable", message: `The CISA KEV catalog could not be downloaded (${reason}), so known exploitation is not shown.` };
  }
}

/** KEV entries for a finding's CVE ids (its id and aliases). */
export function kevFor(catalog: KevCatalog | undefined, ids: string[]): KevEntry | undefined {
  if (!catalog) return undefined;
  for (const id of ids) {
    const hit = catalog.entries.get(id.toUpperCase());
    if (hit) return hit;
  }
  return undefined;
}
