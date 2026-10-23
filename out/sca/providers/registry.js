"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkHealth = exports.healthKey = exports.outdatedLevel = exports.parseRegistry = exports.registryUrl = exports.goProxyPath = void 0;
const versions_1 = require("../../osv/versions");
const client_1 = require("../../osv/client");
/** Go module paths are case-encoded in proxy URLs: "A" becomes "!a". */
function goProxyPath(module) {
    return module.replace(/[A-Z]/g, ch => `!${ch.toLowerCase()}`);
}
exports.goProxyPath = goProxyPath;
function npmPath(name) {
    return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}`.replace("%2F", "%2f") : encodeURIComponent(name);
}
/** The registry URL(s) to read for a package; undefined for ecosystems without a supported registry. */
function registryUrl(r) {
    const n = r.name;
    switch (r.ecosystem) {
        case "npm": return { url: `https://registry.npmjs.org/${npmPath(n)}`, headers: { Accept: "application/vnd.npm.install-v1+json" }, page: `https://www.npmjs.com/package/${n}` };
        case "PyPI": return { url: `https://pypi.org/pypi/${encodeURIComponent(n)}/json`, page: `https://pypi.org/project/${n}/` };
        case "crates.io": return { url: `https://crates.io/api/v1/crates/${encodeURIComponent(n)}`, page: `https://crates.io/crates/${n}` };
        case "RubyGems": return { url: `https://rubygems.org/api/v1/versions/${encodeURIComponent(n)}.json`, page: `https://rubygems.org/gems/${n}` };
        case "Packagist": return /^[\w.-]+\/[\w.-]+$/.test(n) ? { url: `https://repo.packagist.org/p2/${n.toLowerCase()}.json`, page: `https://packagist.org/packages/${n}` } : undefined;
        case "NuGet": return { url: `https://api.nuget.org/v3/registration5-gz-semver2/${encodeURIComponent(n.toLowerCase())}/index.json`, page: `https://www.nuget.org/packages/${n}` };
        case "Go": return { url: `https://proxy.golang.org/${goProxyPath(n)}/@latest`, page: `https://pkg.go.dev/${n}` };
        case "Pub": return { url: `https://pub.dev/api/packages/${encodeURIComponent(n)}`, page: `https://pub.dev/packages/${n}` };
        case "Hex": return { url: `https://hex.pm/api/packages/${encodeURIComponent(n)}`, page: `https://hex.pm/packages/${n}` };
        case "Maven": {
            const [g, a] = n.split(":");
            if (!g || !a || !/^[\w.-]+$/.test(g) || !/^[\w.-]+$/.test(a))
                return undefined;
            return { url: `https://repo.maven.apache.org/maven2/${g.replace(/\./g, "/")}/${a}/maven-metadata.xml`, page: `https://central.sonatype.com/artifact/${g}/${a}` };
        }
        default: return undefined;
    }
}
exports.registryUrl = registryUrl;
const isStable = (ecosystem, v) => {
    if (ecosystem === "PyPI")
        return !/(a|b|rc|dev|alpha|beta|pre|c)\d*$/i.test(v) && !/\.dev/i.test(v);
    if (ecosystem === "Maven")
        return !/(alpha|beta|milestone|rc|cr|snapshot|preview|-m\d|\.m\d|-ea|incubating)/i.test(v);
    return !/[-+](alpha|beta|rc|pre|dev|canary|next|nightly|snapshot|preview)/i.test(v) && !/-/.test(v.replace(/^v/, "").split("+")[0]);
};
function maxStable(ecosystem, versions) {
    const cmp = (0, versions_1.comparatorFor)(ecosystem);
    return versions.filter(v => isStable(ecosystem, v) && (0, versions_1.isComparable)(ecosystem, v)).reduce((best, v) => (!best || cmp(v, best) > 0 ? v : best), undefined);
}
/** Reads one registry response (JSON, or text for Maven metadata and Go module files). */
function parseRegistry(r, body, page) {
    const doc = (body && typeof body === "object" ? body : {}); // eslint-disable-line @typescript-eslint/no-explicit-any
    const health = { page };
    switch (r.ecosystem) {
        case "npm": {
            health.latest = typeof doc["dist-tags"]?.latest === "string" ? doc["dist-tags"].latest : undefined;
            const mine = doc.versions?.[r.version];
            if (typeof mine?.deprecated === "string" && mine.deprecated)
                health.deprecated = mine.deprecated;
            break;
        }
        case "PyPI": {
            health.latest = typeof doc.info?.version === "string" ? doc.info.version : undefined;
            const files = doc.releases?.[r.version];
            if (Array.isArray(files) && files.length && files.every((f) => f?.yanked)) {
                health.yanked = files.find((f) => f?.yanked_reason)?.yanked_reason || "Yanked on PyPI.";
            }
            if (Array.isArray(doc.info?.classifiers) && doc.info.classifiers.includes("Development Status :: 7 - Inactive"))
                health.inactive = true;
            break;
        }
        case "crates.io": {
            health.latest = doc.crate?.max_stable_version || doc.crate?.newest_version || undefined;
            const mine = Array.isArray(doc.versions) ? doc.versions.find((v) => v?.num === r.version) : undefined;
            if (mine?.yanked)
                health.yanked = "Yanked on crates.io.";
            break;
        }
        case "RubyGems": {
            const versions = Array.isArray(body) ? body : [];
            health.latest = versions.find(v => v && !v.prerelease && typeof v.number === "string")?.number;
            // rubygems.org stops listing a yanked version.
            if (versions.length && !versions.some(v => v?.number === r.version))
                health.yanked = "This version is no longer listed on rubygems.org (yanked).";
            break;
        }
        case "Packagist": {
            const entries = doc.packages?.[r.name.toLowerCase()];
            if (Array.isArray(entries) && entries.length) {
                health.latest = maxStable(r.ecosystem, entries.map((e) => String(e?.version ?? "").replace(/^v/, "")).filter(Boolean));
                const abandoned = entries[0]?.abandoned;
                if (abandoned)
                    health.abandoned = typeof abandoned === "string" ? { replacement: abandoned } : {};
            }
            break;
        }
        case "NuGet": {
            const items = (Array.isArray(doc.items) ? doc.items : []).flatMap((page) => (Array.isArray(page?.items) ? page.items : []));
            const entries = items.map((i) => i?.catalogEntry).filter(Boolean); // eslint-disable-line @typescript-eslint/no-explicit-any
            health.latest = maxStable(r.ecosystem, entries.filter(e => e.listed !== false).map(e => String(e.version)));
            const mine = entries.find(e => String(e.version).toLowerCase() === r.version.toLowerCase());
            const deprecation = mine?.deprecation;
            if (deprecation) {
                const reasons = Array.isArray(deprecation.reasons) ? deprecation.reasons.join(", ") : "";
                const alt = deprecation.alternatePackage?.id ? ` Use ${deprecation.alternatePackage.id} instead.` : "";
                health.deprecated = `${deprecation.message || `Deprecated on NuGet${reasons ? ` (${reasons})` : ""}.`}${alt}`;
            }
            if (mine && mine.listed === false)
                health.yanked = "Unlisted on nuget.org.";
            break;
        }
        case "Go": {
            if (typeof body === "string") {
                const deprecated = /^\s*\/\/\s*Deprecated:\s*(.+)$/m.exec(body);
                if (deprecated)
                    health.deprecated = deprecated[1].trim();
            }
            else if (typeof doc.Version === "string") {
                health.latest = doc.Version;
            }
            break;
        }
        case "Pub": {
            health.latest = typeof doc.latest?.version === "string" ? doc.latest.version : undefined;
            if (doc.isDiscontinued)
                health.abandoned = typeof doc.replacedBy === "string" ? { replacement: doc.replacedBy } : {};
            const mine = Array.isArray(doc.versions) ? doc.versions.find((v) => v?.version === r.version) : undefined;
            if (mine?.retracted)
                health.yanked = "Retracted on pub.dev.";
            break;
        }
        case "Hex": {
            health.latest = typeof doc.latest_stable_version === "string" ? doc.latest_stable_version : undefined;
            const retired = doc.retirements?.[r.version];
            if (retired)
                health.yanked = `Retired on hex.pm${retired.reason ? ` (${retired.reason})` : ""}${retired.message ? `: ${retired.message}` : "."}`;
            break;
        }
        case "Maven": {
            if (typeof body === "string") {
                const release = /<release>\s*([^<\s]+)\s*<\/release>/.exec(body)?.[1];
                const versions = [...body.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map(m => m[1]);
                health.latest = maxStable(r.ecosystem, release ? [release, ...versions] : versions);
            }
            break;
        }
    }
    return health;
}
exports.parseRegistry = parseRegistry;
/** How far behind the latest stable release the installed version is; undefined when it is not behind. */
function outdatedLevel(ecosystem, installed, latest) {
    if (!latest || !(0, versions_1.isComparable)(ecosystem, installed) || !(0, versions_1.isComparable)(ecosystem, latest))
        return undefined;
    if ((0, versions_1.comparatorFor)(ecosystem)(latest, installed) <= 0)
        return undefined;
    const parts = (v) => v.replace(/^v/, "").split(/[.+-]/).map(p => Number.parseInt(p, 10));
    const [a, b] = [parts(installed), parts(latest)];
    if ((a[0] ?? 0) !== (b[0] ?? 0))
        return "major";
    if ((a[1] ?? 0) !== (b[1] ?? 0))
        return "minor";
    return "patch";
}
exports.outdatedLevel = outdatedLevel;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const healthKey = (r) => `${r.ecosystem}|${r.name}|${r.version}`;
exports.healthKey = healthKey;
/** Reads each package's registry entry, a few at a time, with a cache. Failures are reported, not hidden. */
async function checkHealth(requests, fetchText, store, options = {}) {
    const now = options.now ?? Date.now;
    const batch = { results: new Map(), checked: 0, fromCache: 0, unsupported: 0, errors: [] };
    const failures = new Map();
    await (0, client_1.mapLimit)(requests, options.concurrency ?? 8, async (r) => {
        if (options.signal?.aborted)
            return;
        const target = registryUrl(r);
        if (!target) {
            batch.unsupported++;
            return;
        }
        const key = (0, exports.healthKey)(r);
        const cached = await store?.get(key).catch(() => undefined);
        if (cached && now() - cached.at < SIX_HOURS) {
            batch.results.set(key, cached.health);
            batch.fromCache++;
            return;
        }
        try {
            const response = await fetchText(target.url, target.headers ?? {}, options.signal);
            if (response.status === 404)
                return; // not on the public registry (private package): nothing to say
            if (response.status !== 200)
                throw new Error(`HTTP ${response.status}`);
            const body = r.ecosystem === "Maven" ? response.text : JSON.parse(response.text);
            // NuGet: large packages keep their registration pages out of the index; fetch the ones needed.
            if (r.ecosystem === "NuGet" && Array.isArray(body?.items)) {
                const pages = body.items;
                const cmp = (0, versions_1.comparatorFor)("NuGet");
                const wanted = pages.filter((p, i) => !p.items && (i === pages.length - 1 || (p.lower && p.upper && cmp(r.version, p.lower) >= 0 && cmp(r.version, p.upper) <= 0)));
                for (const page of wanted) {
                    if (!page["@id"])
                        continue;
                    const fetched = await fetchText(page["@id"], {}, options.signal);
                    if (fetched.status === 200)
                        page.items = JSON.parse(fetched.text).items ?? [];
                }
            }
            const health = parseRegistry(r, body, target.page);
            // Go: the latest version's go.mod carries the module's deprecation notice.
            if (r.ecosystem === "Go" && health.latest) {
                const mod = await fetchText(`https://proxy.golang.org/${goProxyPath(r.name)}/@v/${encodeURIComponent(health.latest)}.mod`, {}, options.signal).catch(() => undefined);
                if (mod?.status === 200)
                    Object.assign(health, { deprecated: parseRegistry(r, mod.text, target.page).deprecated });
            }
            batch.checked++;
            batch.results.set(key, health);
            await store?.set(key, { at: now(), health }).catch(() => undefined);
        }
        catch (error) {
            const host = new URL(target.url).host;
            const reason = `${host}: ${error instanceof Error ? error.message : String(error)}`;
            failures.set(reason, (failures.get(reason) ?? 0) + 1);
        }
    });
    for (const [reason, count] of failures)
        batch.errors.push(`${count} package${count === 1 ? "" : "s"} could not be checked (${reason})`);
    return batch;
}
exports.checkHealth = checkHealth;
//# sourceMappingURL=registry.js.map