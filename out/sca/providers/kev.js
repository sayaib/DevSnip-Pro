"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.kevFor = exports.loadKev = exports.parseKevCatalog = exports.KEV_CATALOG_PAGE = exports.KEV_URL = void 0;
exports.KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
exports.KEV_CATALOG_PAGE = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog";
const DAY = 24 * 60 * 60 * 1000;
/** Reads the catalog JSON; anything that does not look like the published schema is rejected. */
function parseKevCatalog(data, fetchedAt = Date.now()) {
    const doc = data;
    if (!doc || !Array.isArray(doc.vulnerabilities))
        return undefined;
    const entries = new Map();
    for (const raw of doc.vulnerabilities) {
        const cveId = typeof raw?.cveID === "string" ? raw.cveID.trim().toUpperCase() : "";
        if (!/^CVE-\d{4}-\d{4,}$/.test(cveId))
            continue;
        const text = (key) => (typeof raw[key] === "string" ? raw[key] : undefined);
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
    if (!entries.size)
        return undefined;
    return { version: typeof doc.catalogVersion === "string" ? doc.catalogVersion : "", fetchedAt, entries };
}
exports.parseKevCatalog = parseKevCatalog;
/** The catalog: cached copy when under a day old, otherwise a fresh download (falling back to the cached copy). */
async function loadKev(fetchJson, store, options = {}) {
    const now = options.now ?? Date.now();
    const cached = await store?.read().catch(() => undefined);
    const cachedCatalog = cached ? parseKevCatalog(cached.data, cached.fetchedAt) : undefined;
    if (cachedCatalog && now - cachedCatalog.fetchedAt < (options.maxAgeMs ?? DAY)) {
        return { catalog: cachedCatalog, status: "ok", message: `CISA KEV catalog ${cachedCatalog.version} (${cachedCatalog.entries.size} CVEs, cached).` };
    }
    try {
        const response = await fetchJson(exports.KEV_URL, options.signal);
        if (response.status !== 200)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const catalog = parseKevCatalog(data, now);
        if (!catalog)
            throw new Error("the response does not match the catalog schema");
        await store?.write({ fetchedAt: now, data }).catch(() => undefined);
        return { catalog, status: "ok", message: `CISA KEV catalog ${catalog.version} (${catalog.entries.size} CVEs).` };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (cachedCatalog)
            return { catalog: cachedCatalog, status: "stale", message: `The CISA KEV catalog could not be refreshed (${reason}); using the copy from ${new Date(cachedCatalog.fetchedAt).toISOString().slice(0, 10)}.` };
        return { status: "unavailable", message: `The CISA KEV catalog could not be downloaded (${reason}), so known exploitation is not shown.` };
    }
}
exports.loadKev = loadKev;
/** KEV entries for a finding's CVE ids (its id and aliases). */
function kevFor(catalog, ids) {
    if (!catalog)
        return undefined;
    for (const id of ids) {
        const hit = catalog.entries.get(id.toUpperCase());
        if (hit)
            return hit;
    }
    return undefined;
}
exports.kevFor = kevFor;
//# sourceMappingURL=kev.js.map