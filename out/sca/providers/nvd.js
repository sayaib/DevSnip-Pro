"use strict";
/**
 * The National Vulnerability Database (NVD CVE API 2.0), used only to fill in
 * a CVSS score where OSV published none for a CVE.
 *
 * NVD's public limit is 5 requests per rolling 30 seconds (50 with a free API
 * key, kept in VS Code's secret storage). Lookups are spaced to stay inside it,
 * capped per scan, and cached for a week. Only CVE ids are sent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupNvd = exports.parseNvdResponse = exports.NVD_API = void 0;
exports.NVD_API = "https://services.nvd.nist.gov/rest/json/cves/2.0";
/** The best score in an NVD response: NVD's primary CVSS 3.x, then a secondary 3.x, then 4.0, then 2.0. */
function parseNvdResponse(data, cveId) {
    const vulns = data?.vulnerabilities;
    const cve = Array.isArray(vulns) ? vulns.find(v => v?.cve?.id?.toUpperCase() === cveId.toUpperCase())?.cve : undefined;
    if (!cve?.metrics)
        return undefined;
    const candidates = [];
    const read = (key, version) => {
        const list = cve.metrics[key];
        if (!Array.isArray(list))
            return;
        for (const metric of list) {
            const data = metric?.cvssData;
            const score = Number(data?.baseScore);
            if (!data || !Number.isFinite(score) || score < 0 || score > 10)
                continue;
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
    const rank = (s) => (s.version.startsWith("3") ? (s.primary ? 0 : 1) : s.version === "4.0" ? 2 : 3);
    return candidates.sort((a, b) => rank(a) - rank(b))[0];
}
exports.parseNvdResponse = parseNvdResponse;
const WEEK = 7 * 24 * 60 * 60 * 1000;
/** Looks up CVSS scores for CVEs, spacing requests inside NVD's rate limit. */
async function lookupNvd(cveIds, fetchJson, store, options = {}) {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("cancelled")); }, { once: true });
    }));
    // 5 per 30 s without a key, 50 per 30 s with one; a little slack for clock drift.
    const spacing = options.apiKey ? 700 : 6500;
    const batch = { scores: new Map(), looked: 0, fromCache: 0, skipped: [], errors: [] };
    const unique = [...new Set(cveIds.map(id => id.toUpperCase()).filter(id => /^CVE-\d{4}-\d{4,}$/.test(id)))];
    const max = options.maxLookups ?? (options.apiKey ? 60 : 12);
    let first = true;
    let limited = false;
    for (const cveId of unique) {
        if (options.signal?.aborted)
            break;
        const cached = await store?.get(cveId).catch(() => undefined);
        if (cached && now() - cached.at < WEEK) {
            batch.fromCache++;
            if (cached.score)
                batch.scores.set(cveId, cached.score);
            continue;
        }
        if (batch.looked >= max || limited) {
            batch.skipped.push(cveId);
            continue;
        }
        if (!first)
            await sleep(spacing, options.signal).catch(() => undefined);
        first = false;
        if (options.signal?.aborted)
            break;
        batch.looked++;
        try {
            const response = await fetchJson(`${exports.NVD_API}?cveId=${encodeURIComponent(cveId)}`, options.apiKey ? { apiKey: options.apiKey } : {}, options.signal);
            // Rate limited: stop for this scan instead of hammering NVD; the rest are reported as skipped.
            if (response.status === 403 || response.status === 429) {
                limited = true;
                batch.errors.push(`NVD rate limit reached (HTTP ${response.status})`);
                batch.skipped.push(cveId);
                continue;
            }
            if (response.status !== 200) {
                batch.errors.push(`NVD answered HTTP ${response.status} for ${cveId}`);
                continue;
            }
            const score = parseNvdResponse(await response.json(), cveId);
            await store?.set(cveId, { at: now(), score: score ?? null }).catch(() => undefined);
            if (score)
                batch.scores.set(cveId, score);
        }
        catch (error) {
            batch.errors.push(`${cveId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return batch;
}
exports.lookupNvd = lookupNvd;
//# sourceMappingURL=nvd.js.map