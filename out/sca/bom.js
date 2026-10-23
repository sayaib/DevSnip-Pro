"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gavString = exports.findBomUpgrade = exports.newBomCache = void 0;
const dependency_versions_1 = require("../services/dependency-versions");
const resolver_1 = require("../osv/maven/resolver");
Object.defineProperty(exports, "gavString", { enumerable: true, get: function () { return resolver_1.gavString; } });
const newBomCache = () => ({ managed: new Map(), loads: 0, examined: new Set() });
exports.newBomCache = newBomCache;
const major = (v) => v.split(/[.-]/)[0];
const comparedFix = (version, fixedIn) => (0, dependency_versions_1.compareMaven)(version, fixedIn) >= 0 && major(version) === major(fixedIn);
const UNSTABLE = /(?:[-.](?:M|RC|CR|SNAPSHOT|BUILD-SNAPSHOT|alpha|beta)\d*)$|-SNAPSHOT/i;
function line(version) {
    const [major, minor] = version.split(/[.-]/);
    return `${major}.${minor ?? "0"}`;
}
/** Lowest BOM version (above `bom.version`) that manages every target at or above its fix. */
async function findBomUpgrade(repository, bom, targets, options = {}) {
    if (!targets.length)
        return { error: "Nothing to fix through this BOM." };
    if (!repository.versions)
        return { error: "Published BOM versions cannot be listed." };
    const shared = options.cache ?? (0, exports.newBomCache)();
    shared.listed ?? (shared.listed = repository.versions(bom.groupId, bom.artifactId, ["https://repo.maven.apache.org/maven2"], options.signal));
    const listed = await shared.listed;
    if (!Array.isArray(listed)) {
        if (!options.signal?.aborted)
            shared.listed = undefined;
        return { error: `The published versions of ${bom.groupId}:${bom.artifactId} could not be read (${listed.error}).` };
    }
    const candidates = [...new Set(listed)].filter(v => !UNSTABLE.test(v) && (0, dependency_versions_1.compareMaven)(v, bom.version) > 0).sort(dependency_versions_1.compareMaven);
    if (!candidates.length)
        return { error: `No newer stable ${bom.artifactId} release exists than ${bom.version}.` };
    // The budget counts BOM versions examined across every search sharing the cache; examined versions are free.
    const maxLoads = options.maxLoads ?? 24;
    const startLoads = shared.loads;
    shared.resolver ?? (shared.resolver = new resolver_1.MavenResolver([], repository, options.signal));
    const resolver = shared.resolver;
    let outOfBudget = false;
    const managedVersion = async (version, t) => {
        const key = `${version}|${t.groupId}:${t.artifactId}`;
        if (shared.managed.has(key))
            return shared.managed.get(key);
        if (!shared.examined.has(version)) {
            if (shared.loads - startLoads >= maxLoads || options.signal?.aborted) {
                outOfBudget = true;
                return undefined;
            }
            shared.loads++;
            shared.examined.add(version);
        }
        const [vg, va] = t.via?.split(":") ?? [];
        const found = await resolver.managedVersion({ groupId: bom.groupId, artifactId: bom.artifactId, version }, t.groupId, t.artifactId, vg && va ? { groupId: vg, artifactId: va } : undefined).catch(() => undefined);
        if (options.signal?.aborted)
            return undefined;
        shared.managed.set(key, found ?? null);
        return found ?? null;
    };
    const fixes = async (version) => {
        for (const t of targets) {
            const v = await managedVersion(version, t);
            if (v === undefined)
                return undefined;
            if (v === null)
                return false;
            // On the fixed release's own major line the comparison is exact for these advisories; across lines OSV decides.
            const verdict = major(v) === major(t.fixedIn) ? (0, dependency_versions_1.compareMaven)(v, t.fixedIn) >= 0 : options.isFixed ? await options.isFixed(t, v, options.signal) : undefined;
            if (!(verdict ?? comparedFix(v, t.fixedIn)))
                return false;
        }
        return true;
    };
    // Lines in order: the current minor line, then later lines.
    const lines = new Map();
    for (const v of candidates)
        lines.set(line(v), [...(lines.get(line(v)) ?? []), v]);
    for (const [name, versions] of lines) {
        const newest = versions[versions.length - 1];
        const ok = await fixes(newest);
        if (ok === undefined)
            break; // out of budget or unreadable: stop rather than guess
        if (!ok)
            continue;
        // Managed versions only move forward within a line, so the lowest fixing release is found by bisection.
        let lo = 0, hi = versions.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            const result = await fixes(versions[mid]);
            if (result === undefined) {
                lo = hi;
                break;
            }
            if (result)
                hi = mid;
            else
                lo = mid + 1;
        }
        const to = versions[hi];
        const sameLine = name === line(bom.version);
        const sameMajor = name.split(".")[0] === bom.version.split(".")[0];
        const notes = [];
        if (bom.groupId === "org.springframework.boot" && Number(bom.version.split(".")[0]) < 3 && Number(to.split(".")[0]) >= 3) {
            notes.push("Spring Boot 3 requires Java 17 or later and moves from Java EE (javax.*) to Jakarta EE (jakarta.*) packages; plan it as a migration.");
        }
        if (!sameLine)
            notes.push(`Read the ${bom.artifactId} release notes from ${bom.version} to ${to}: a ${sameMajor ? "minor" : "major"} upgrade can change behaviour and other managed versions.`);
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
exports.findBomUpgrade = findBomUpgrade;
//# sourceMappingURL=bom.js.map