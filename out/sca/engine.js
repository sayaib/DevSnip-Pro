"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyseScan = exports.SCA_TOOL = void 0;
const path = __importStar(require("path"));
const client_1 = require("../osv/client");
const dependency_versions_1 = require("../services/dependency-versions");
const types_1 = require("../osv/types");
const edits_1 = require("./edits");
const kev_1 = require("./providers/kev");
const registry_1 = require("./providers/registry");
exports.SCA_TOOL = "DevSnip Pro SCA Scanner";
const MAX_HEALTH_CHECKS = 1500;
const dirOf = (file) => { const d = path.posix.dirname(file); return d === "." ? "" : d; };
function relationOf(pkg) {
    return pkg?.direct === true ? "direct" : pkg?.direct === false ? "transitive" : "unknown";
}
function nvdSeverity(score) {
    switch (score.baseSeverity) {
        case "CRITICAL": return "critical";
        case "HIGH": return "high";
        case "MEDIUM": return "medium";
        case "LOW":
        case "NONE": return "low";
    }
    if (score.baseScore >= 9)
        return "critical";
    if (score.baseScore >= 7)
        return "high";
    if (score.baseScore >= 4)
        return "medium";
    return "low";
}
function locationsOf(occurrences) {
    const seen = new Set();
    const out = [];
    for (const o of occurrences) {
        const key = `${o.file}:${o.line ?? ""}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(o.line ? { file: o.file, line: o.line } : { file: o.file });
    }
    return out;
}
function pathsOf(occurrences) {
    const seen = new Set();
    const out = [];
    for (const o of occurrences) {
        if (!o.via?.length)
            continue;
        const key = o.via.join(">");
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push([...o.via]);
        if (out.length >= 10)
            break;
    }
    return out;
}
/* ------------------------------------------------------------------ *
 * Which file an edit belongs in
 * ------------------------------------------------------------------ */
/** The topmost workspace POM above `file` whose <parent> is not in the workspace (where Spring Boot's parent is declared). */
function externalParentPom(file, texts) {
    let current = file;
    for (let i = 0; i < 20; i++) {
        const text = texts.get(current);
        if (!text)
            return undefined;
        const parent = /<parent>([\s\S]*?)<\/parent>/.exec(text)?.[1];
        if (!parent)
            return undefined;
        const relative = /<relativePath>\s*([^<]*?)\s*<\/relativePath>/.exec(parent);
        const rel = relative ? relative[1] : "../pom.xml";
        if (rel === "")
            return current;
        let candidate = path.posix.normalize(path.posix.join(dirOf(current) || ".", rel));
        if (!candidate.endsWith(".xml"))
            candidate = `${candidate}/pom.xml`;
        candidate = candidate.replace(/^\.\//, "");
        const candidateText = texts.get(candidate);
        const artifact = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(parent)?.[1];
        if (!candidateText || !artifact || !new RegExp(`<artifactId>\\s*${artifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</artifactId>`).test(candidateText.replace(/<parent>[\s\S]*?<\/parent>/, "")))
            return current;
        current = candidate;
    }
    return undefined;
}
/** The workspace POM (the module or one of its parents) that imports `bom`. */
function pomImporting(file, bom, texts) {
    const [, artifact] = bom.split(":");
    const chain = [file];
    let current = file;
    for (let i = 0; i < 20; i++) {
        const parent = /<parent>([\s\S]*?)<\/parent>/.exec(texts.get(current) ?? "")?.[1];
        if (!parent)
            break;
        const rel = /<relativePath>\s*([^<]*?)\s*<\/relativePath>/.exec(parent)?.[1] ?? "../pom.xml";
        if (rel === "")
            break;
        let candidate = path.posix.normalize(path.posix.join(dirOf(current) || ".", rel));
        if (!candidate.endsWith(".xml"))
            candidate = `${candidate}/pom.xml`;
        candidate = candidate.replace(/^\.\//, "");
        if (!texts.has(candidate))
            break;
        chain.push(candidate);
        current = candidate;
    }
    return chain.find(f => {
        const management = /<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/.exec(texts.get(f) ?? "")?.[1] ?? "";
        return new RegExp(`<artifactId>\\s*${artifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</artifactId>`).test(management) && /<scope>\s*import\s*<\/scope>/.test(management);
    });
}
const majorOf = (version) => version.replace(/^v/i, "").split(/[.-]/)[0];
/** "g:a:v" → "g:a", "name@1.2.3" → "name" (path entries name a dependency at a version). */
function withoutVersion(entry) {
    if (/^[^:@]+:[^:]+:[^:]+$/.test(entry))
        return entry.split(":").slice(0, 2).join(":");
    const at = entry.lastIndexOf("@");
    return at > 0 ? entry.slice(0, at) : entry;
}
function manifestIn(dir, names, texts, mentions) {
    return [...texts.keys()].find(f => dirOf(f) === dir && names.test(path.posix.basename(f)) && (!mentions || (texts.get(f) ?? "").includes(mentions)));
}
/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */
async function analyseScan(scan, providers, options) {
    const progress = options.onProgress ?? (() => undefined);
    const packages = new Map(scan.packages.map(p => [p.key, p]));
    const providerStatus = [];
    const limitations = [...scan.limitations];
    providerStatus.push({
        id: "osv", name: "OSV.dev (includes the GitHub Advisory Database, PyPA, Go, RustSec)",
        status: scan.status === "complete" ? "ok" : scan.diagnostics.queriesFailed || scan.diagnostics.recordsFailed ? "partial" : "ok",
        message: `${scan.summary.analyzedPackages} of ${scan.summary.packages} dependencies checked; ${scan.diagnostics.uniqueAdvisoryIds} advisories matched.${scan.diagnostics.queriesFailed ? ` ${scan.diagnostics.queriesFailed} queries failed.` : ""}${scan.diagnostics.recordsFailed ? ` ${scan.diagnostics.recordsFailed} advisory records could not be loaded.` : ""}`
    });
    for (const build of scan.diagnostics.buildTools) {
        const id = build.tool === "Maven" ? "maven" : "gradle";
        if (providerStatus.some(p => p.id === id))
            continue;
        const runs = scan.diagnostics.buildTools.filter(b => b.tool === build.tool);
        providerStatus.push({
            id, name: build.tool,
            status: runs.every(b => b.method === "build-tool") ? "ok" : runs.some(b => b.detail) ? "partial" : "ok",
            message: runs.map(b => `${b.project}: ${b.method === "build-tool" ? `resolved by ${build.tool}` : build.tool === "Maven" ? "built-in Maven resolver" : "read from build scripts"}, ${b.dependencies} dependencies${b.unresolved ? `, ${b.unresolved} unresolved` : ""}${b.detail ? ` (${b.detail.split("\n")[0]})` : ""}`).join("; ")
        });
    }
    // ---- vulnerabilities ----
    const vulnerabilities = scan.findings.map((finding) => {
        const pkg = packages.get(finding.packageKey);
        const ids = [finding.id, ...finding.aliases];
        const occurrences = pkg?.occurrences ?? [];
        return {
            key: finding.key,
            class: finding.informational ? "informational" : finding.confidence,
            finding,
            cves: [...new Set(ids.filter(id => /^CVE-\d{4}-\d+$/i.test(id)).map(id => id.toUpperCase()))],
            ghsas: [...new Set(ids.filter(id => /^GHSA-/i.test(id)))],
            severity: finding.severity,
            ...(finding.severitySource ? { severitySource: finding.severitySource } : {}),
            ...(finding.cvssScore !== undefined ? { cvssScore: finding.cvssScore, cvssVector: finding.cvssVector } : {}),
            relation: relationOf(pkg),
            paths: pathsOf(occurrences),
            locations: locationsOf(occurrences),
            projects: [...new Set(occurrences.map(o => o.project))],
            ...(occurrences.find(o => o.managedBy)?.managedBy ? { managedBy: occurrences.find(o => o.managedBy).managedBy } : {}),
            devOnly: finding.devOnly
        };
    });
    // The providers are independent, so they run at the same time (NVD's rate-limit spacing alone can take a minute).
    const statusSlots = {};
    const timings = {};
    const PROVIDER_NAMES = { kev: "CISA Known Exploited Vulnerabilities", nvd: "National Vulnerability Database", registries: "Package registries", remediation: "Remediation search" };
    const timed = async (name, run) => {
        const started = Date.now();
        try {
            if (options.signal?.aborted && name !== "remediation") {
                statusSlots[name] = { id: name, name: PROVIDER_NAMES[name], status: "skipped", message: "Not run: the scan was cancelled." };
                return;
            }
            await run();
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (name !== "remediation")
                statusSlots[name] = { id: name, name: PROVIDER_NAMES[name], status: "unavailable", message: `Failed: ${reason}` };
            limitations.push(`${PROVIDER_NAMES[name]} failed (${reason}); its results are missing.`);
        }
        finally {
            timings[name] = Date.now() - started;
        }
    };
    const health = [];
    const kevTask = timed("kev", async () => {
        // ---- known exploited (CISA KEV) ----
        if (providers.kev && !options.signal?.aborted) {
            progress("Checking CISA's Known Exploited Vulnerabilities catalog", 0.92);
            const kev = await providers.kev(options.signal);
            for (const v of vulnerabilities) {
                const hit = (0, kev_1.kevFor)(kev.catalog, v.cves);
                if (hit)
                    v.kev = hit;
            }
            statusSlots.kev = ({ id: "kev", name: "CISA Known Exploited Vulnerabilities", status: kev.status === "ok" ? "ok" : kev.status === "stale" ? "stale" : "unavailable", message: `${kev.message}${kev.catalog ? ` ${vulnerabilities.filter(v => v.kev).length} finding${vulnerabilities.filter(v => v.kev).length === 1 ? "" : "s"} listed.` : ""}` });
            if (kev.status === "unavailable")
                limitations.push("Known exploitation could not be checked (the CISA KEV catalog was unavailable); no finding is marked as exploited.");
        }
        else {
            statusSlots.kev = ({ id: "kev", name: "CISA Known Exploited Vulnerabilities", status: "off", message: "Turned off (devsnip.sca.knownExploited)." });
        }
    });
    const nvdTask = timed("nvd", async () => {
        // ---- NVD scores where OSV had none ----
        const unscored = vulnerabilities.filter(v => v.severity === "unknown" && v.cves.length && v.finding.detailsAvailable);
        if (providers.nvd && unscored.length && !options.signal?.aborted) {
            progress(`Looking up ${unscored.length} CVSS score${unscored.length === 1 ? "" : "s"} in NVD`, 0.94);
            const batch = await providers.nvd(unscored.map(v => v.cves[0]), options.signal);
            let filled = 0;
            for (const v of unscored) {
                const score = batch.scores.get(v.cves[0]);
                if (!score)
                    continue;
                v.nvd = score;
                v.severity = nvdSeverity(score);
                v.cvssScore = score.baseScore;
                v.cvssVector = score.vector;
                v.severitySource = `NVD, CVSS ${score.version} base score ${score.baseScore.toFixed(1)} (${score.primary ? "NVD's own analysis" : `scored by ${score.source || "the CNA"}`}); OSV published no severity`;
                filled++;
            }
            statusSlots.nvd = ({
                id: "nvd", name: "National Vulnerability Database",
                status: batch.errors.length || batch.skipped.length ? "partial" : "ok",
                message: `${filled} of ${unscored.length} unscored advisories got an NVD score (${batch.looked} looked up, ${batch.fromCache} cached).${batch.skipped.length ? ` ${batch.skipped.length} skipped to stay within NVD's rate limit; add a free NVD API key for more.` : ""}${batch.errors.length ? ` ${batch.errors[0]}` : ""}`
            });
        }
        else {
            statusSlots.nvd = ({ id: "nvd", name: "National Vulnerability Database", status: providers.nvd ? "skipped" : "off", message: providers.nvd ? "Every advisory with a CVE already had a severity from OSV." : "Turned off (devsnip.sca.nvdEnrichment)." });
        }
    });
    const healthTask = timed("registries", async () => {
        // ---- registry health ----
        if (providers.health && providers.healthScope !== "off" && !options.signal?.aborted) {
            const eligible = scan.packages.filter(p => p.version && p.status !== "unanalyzed" && (providers.healthScope === "all" || p.direct === true));
            const requests = eligible.slice(0, MAX_HEALTH_CHECKS).map(p => ({ ecosystem: p.ecosystem, name: p.name, version: p.version }));
            progress(`Checking ${requests.length} package${requests.length === 1 ? "" : "s"} in their registries`, 0.95);
            const batch = await providers.health(requests, options.signal);
            for (const pkg of eligible.slice(0, MAX_HEALTH_CHECKS)) {
                const info = batch.results.get((0, registry_1.healthKey)({ ecosystem: pkg.ecosystem, name: pkg.name, version: pkg.version }));
                if (!info)
                    continue;
                const base = { packageKey: pkg.key, ecosystem: pkg.ecosystem, packageName: pkg.name, installedVersion: pkg.version, latest: info.latest, page: info.page, relation: relationOf(pkg), locations: locationsOf(pkg.occurrences) };
                if (info.deprecated)
                    health.push({ ...base, key: `${pkg.key}::deprecated`, class: "risk", kind: "deprecated", message: info.deprecated });
                if (info.yanked)
                    health.push({ ...base, key: `${pkg.key}::yanked`, class: "risk", kind: "yanked", message: info.yanked });
                if (info.abandoned)
                    health.push({ ...base, key: `${pkg.key}::abandoned`, class: "risk", kind: "abandoned", message: `The package is abandoned or discontinued${info.abandoned.replacement ? `; its maintainers suggest ${info.abandoned.replacement}` : ""}.` });
                if (info.inactive)
                    health.push({ ...base, key: `${pkg.key}::inactive`, class: "risk", kind: "inactive", message: "The project declares itself inactive (Development Status :: 7 - Inactive)." });
                const level = (0, registry_1.outdatedLevel)(pkg.ecosystem, pkg.version, info.latest);
                if (level)
                    health.push({ ...base, key: `${pkg.key}::outdated`, class: "informational", kind: "outdated", level, message: `${info.latest} is the latest stable release (${level} update available). Outdated is not vulnerable; see the Vulnerabilities tab for advisories.` });
            }
            statusSlots.registries = ({
                id: "registries", name: "Package registries (npm, PyPI, Maven Central, NuGet, crates.io, RubyGems, Packagist, Go proxy, pub.dev, Hex)",
                status: batch.errors.length ? "partial" : "ok",
                message: `${batch.checked + batch.fromCache} of ${requests.length} ${providers.healthScope === "direct" ? "direct " : ""}dependencies checked (${batch.fromCache} cached)${batch.unsupported ? `, ${batch.unsupported} in ecosystems without a supported registry` : ""}.${eligible.length > MAX_HEALTH_CHECKS ? ` Only the first ${MAX_HEALTH_CHECKS} were checked.` : ""}${batch.errors.length ? ` ${batch.errors.join(" ")}` : ""}`
            });
        }
        else {
            statusSlots.registries = ({ id: "registries", name: "Package registries", status: "off", message: "Dependency health checks are turned off (devsnip.sca.healthChecks)." });
        }
    });
    let advice = [];
    const adviceTask = timed("remediation", async () => {
        progress("Working out remediation", 0.97);
        advice = await buildAdvice(scan, vulnerabilities, providers, options);
    });
    await Promise.all([kevTask, nvdTask, healthTask, adviceTask]);
    for (const slot of ["kev", "nvd", "registries"])
        if (statusSlots[slot])
            providerStatus.push(statusSlots[slot]);
    // ---- summary ----
    const counted = vulnerabilities.filter(v => v.class !== "informational");
    const counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    for (const v of counted)
        counts[v.severity]++;
    const summary = {
        ...counts,
        informational: health.length + vulnerabilities.filter(v => v.class === "informational").length,
        exploited: vulnerabilities.filter(v => v.kev).length,
        dependencies: scan.summary.packages,
        vulnerableDependencies: new Set(counted.map(v => v.finding.packageKey)).size,
        direct: scan.packages.filter(p => p.direct === true).length,
        transitive: scan.packages.filter(p => p.direct === false).length,
        unknownRelation: scan.packages.filter(p => p.direct === undefined).length,
        unresolved: scan.summary.unresolvedPackages,
        failed: scan.summary.failedPackages,
        outdated: health.filter(h => h.kind === "outdated").length,
        maintenanceRisks: health.filter(h => h.class === "risk").length
    };
    vulnerabilities.sort((a, b) => (a.kev ? 0 : 1) - (b.kev ? 0 : 1) || types_1.SEVERITY_ORDER.indexOf(a.severity) - types_1.SEVERITY_ORDER.indexOf(b.severity) || (b.cvssScore ?? -1) - (a.cvssScore ?? -1) || a.finding.packageName.localeCompare(b.finding.packageName));
    if (summary.unknownRelation)
        limitations.push(`${summary.unknownRelation} dependenc${summary.unknownRelation === 1 ? "y's" : "ies'"} direct/transitive relation is not recorded by its lockfile format (for example Yarn 1 or Cargo); they are listed as "relation unknown".`);
    const finished = Date.now();
    const status = scan.status === "complete" && providerStatus.some(p => p.status === "unavailable") ? "incomplete" : scan.status;
    const incompleteReasons = [...(scan.incompleteReasons ?? []), ...providerStatus.filter(p => p.status === "unavailable").map(p => `${p.name} was unavailable`)];
    const d = scan.diagnostics;
    const diagnostics = {
        status,
        incompleteReasons,
        projects: options.projects.map(p => ({ dir: p.dir, name: p.name, ecosystems: p.ecosystems, managers: p.managers, manifests: p.files.length, ...(p.springBoot ? { springBoot: p.springBoot } : {}) })),
        files: { scanned: scan.files.length, failed: scan.files.filter(f => f.error).map(f => f.path), unsupported: scan.unsupportedFiles ?? [], leftOutAsBuildOutput: options.discovery?.leftOutAsBuildOutput ?? 0 },
        dependencies: {
            discovered: scan.packages.length,
            withVersion: scan.packages.filter(p => p.version).length,
            rangeOnly: scan.packages.filter(p => p.status === "potential" && !p.version).length,
            unresolved: scan.summary.unresolvedPackages,
            outOfScope: scan.summary.outOfScopePackages ?? 0,
            failed: scan.summary.failedPackages,
            direct: summary.direct, transitive: summary.transitive, relationUnknown: summary.unknownRelation
        },
        buildTools: d.buildTools.map(b => ({ tool: b.tool, project: b.project, method: b.method, dependencies: b.dependencies, unresolved: b.unresolved, ...(b.detail ? { problem: b.detail.split("\n")[0] } : {}) })),
        advisories: {
            packagesChecked: d.packagesQueried, packagesFromCache: d.packagesFromCache, references: d.advisoryReferences, unique: d.uniqueAdvisoryIds,
            aliasesMerged: d.aliasesMerged, withdrawnDropped: d.withdrawnDropped, outOfRangeDropped: d.outOfRangeDropped, findings: scan.findings.length, recordsFailed: d.recordsFailed
        },
        errors: [...scan.errors, ...providerStatus.filter(p => p.status === "partial" || p.status === "unavailable").map(p => `${p.name}: ${p.message}`)],
        timings: { ...(options.discovery ? { discover: options.discovery.durationMs } : {}), ...(d.timings ?? {}), ...timings, total: finished - options.startedAt }
    };
    return {
        schemaVersion: 1,
        tool: exports.SCA_TOOL,
        toolVersion: options.toolVersion,
        startedAt: new Date(options.startedAt).toISOString(),
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - options.startedAt,
        // A provider the user relies on (KEV) being unavailable makes the result incomplete, never silently "clean".
        status,
        projects: options.projects,
        scan,
        vulnerabilities,
        health,
        advice,
        providers: providerStatus,
        summary,
        limitations,
        diagnostics
    };
}
exports.analyseScan = analyseScan;
/* ------------------------------------------------------------------ *
 * Remediation advice
 * ------------------------------------------------------------------ */
function controlledBy(managed, relation, occurrence, via) {
    if (managed?.kind === "workspace")
        return `Managed in the <dependencyManagement> of ${managed.path ?? managed.source}${managed.property ? ` through \${${managed.property}}` : ""}.`;
    if (managed?.kind === "parent")
        return `Managed by the parent POM ${managed.source}${managed.property ? ` through the property ${managed.property}` : ""}.`;
    if (managed?.kind === "import")
        return `Managed by the imported BOM ${managed.bom ?? managed.source}${managed.property ? ` (property ${managed.property})` : ""}.`;
    if (relation === "direct")
        return `Declared directly in ${occurrence?.file ?? "your manifest"}.`;
    if (via?.length)
        return `Brought in by ${via[0]}${via.length > 1 ? ` (through ${via.length - 1} more)` : ""}.`;
    return "Recorded in the lockfile; which dependency brings it in is not recorded.";
}
async function buildAdvice(scan, vulnerabilities, providers, options) {
    const packages = new Map(scan.packages.map(p => [p.key, p]));
    const texts = options.texts;
    const out = [];
    const jobs = new Map();
    const queue = (coordinate, target, consumer) => {
        if (!providers.bomUpgrade)
            return;
        const [groupId, artifactId, version] = coordinate.split(":");
        if (!groupId || !artifactId || !version)
            return;
        const job = jobs.get(coordinate) ?? { gav: { groupId, artifactId, version }, entries: [] };
        job.entries.push({ target, consumer });
        jobs.set(coordinate, job);
    };
    const bomName = (bom) => (bom.groupId === "org.springframework.boot" ? "Spring Boot" : bom.artifactId);
    for (const remediation of scan.remediations) {
        const pkg = packages.get(remediation.packageKey);
        if (!pkg)
            continue;
        const vulns = vulnerabilities.filter(v => v.finding.packageKey === pkg.key && v.class !== "informational");
        if (!vulns.length)
            continue;
        const relation = relationOf(pkg);
        const occurrence = pkg.occurrences.find(o => o.direct === true) ?? pkg.occurrences[0];
        const managed = pkg.occurrences.find(o => o.managedBy)?.managedBy;
        const via = pkg.occurrences.find(o => o.via?.length)?.via;
        const target = remediation.targetVersion;
        const optionsList = [];
        const notes = [...remediation.guidance];
        const id = (suffix) => `${pkg.key}::${suffix}`;
        const project = occurrence?.project ?? "";
        if (target) {
            // Direct dependency: change the version where it is declared.
            if (relation === "direct" && !managed) {
                let edit;
                const name = pkg.name;
                if (pkg.ecosystem === "npm") {
                    const file = manifestIn(project, /^package\.json$/, texts, `"${name}"`);
                    if (file)
                        edit = { op: "npm-dependency", file, name, version: target };
                }
                else if (pkg.ecosystem === "PyPI") {
                    const file = pkg.occurrences.find(o => /requirements.*\.txt$|\.txt$/.test(o.file) && texts.has(o.file))?.file;
                    if (file)
                        edit = { op: "pip-requirement", file, name, version: target };
                }
                else if (pkg.ecosystem === "Maven" && occurrence && occurrence.file.endsWith("pom.xml")) {
                    const [g, a] = name.split(":");
                    edit = { op: "pom-version", file: occurrence.file, groupId: g, artifactId: a, version: target };
                }
                else if (pkg.ecosystem === "Maven" && occurrence && /build\.gradle(\.kts)?$/.test(occurrence.file)) {
                    const [g, a] = name.split(":");
                    edit = { op: "gradle-version", file: occurrence.file, groupId: g, artifactId: a, version: target };
                }
                else if (pkg.ecosystem === "NuGet") {
                    const file = manifestIn(project, /\.(cs|fs|vb)proj$/, texts, `"${name}"`);
                    if (file)
                        edit = { op: "csproj-version", file, id: name, version: target };
                }
                else if (pkg.ecosystem === "Packagist") {
                    const file = manifestIn(project, /^composer\.json$/, texts, `"${name}"`);
                    if (file)
                        edit = { op: "composer-require", file, name, version: target };
                }
                else if (pkg.ecosystem === "crates.io") {
                    const file = manifestIn(project, /^Cargo\.toml$/, texts);
                    if (file)
                        edit = { op: "cargo-version", file, name, version: target };
                }
                optionsList.push({
                    id: id("direct"), title: `Upgrade ${name} to ${target}`,
                    detail: `${name} is a direct dependency, so changing its version where it is declared fixes ${vulns.length === 1 ? "the advisory" : `all ${vulns.length} advisories that have a fix`}.${edit ? "" : " (Edit the manifest by hand: the declaration could not be located automatically.)"}`,
                    risk: "unknown",
                    ...(edit ? { edit } : {})
                });
            }
            // Transitive npm dependency: force the fixed version everywhere.
            if (relation !== "direct" && pkg.ecosystem === "npm" && occurrence) {
                const manager = occurrence.manager === "pnpm" ? "pnpm" : occurrence.manager === "yarn" || occurrence.manager === "yarn-berry" ? "yarn" : "npm";
                const file = manifestIn(project, /^package\.json$/, texts);
                optionsList.push({
                    id: id("override"), title: `Force ${pkg.name} ${target} with ${manager === "npm" ? "overrides" : manager === "yarn" ? "resolutions" : "pnpm.overrides"}`,
                    detail: `${pkg.name} comes in through ${via?.[0] ?? "another package"}. An override makes every copy use ${target}; if a dependency needs an older major version it can break, so run your tests. Upgrading the package that brings it in is the cleaner fix when a fixed release exists.`,
                    risk: "medium",
                    ...(file ? { edit: { op: "npm-override", file, manager, name: pkg.name, version: target } } : {})
                });
            }
            // Maven and Gradle: change what manages the version.
            if (managed && pkg.ecosystem === "Maven") {
                const [g, a] = pkg.name.split(":");
                const gradle = occurrence?.manager === "gradle";
                const rootPom = !gradle && occurrence ? externalParentPom(occurrence.file, texts) : undefined;
                const buildFile = gradle ? occurrence?.file : undefined;
                const fixed = target;
                const fixIds = vulns.filter(v => !v.finding.noFix).map(v => v.finding.id);
                // Imports inherited from a parent (spring-boot-dependencies' own imports) are interpolated in your build, so their properties can be overridden.
                const inheritedImport = managed.kind === "import" && managed.importedBy?.kind === "parent" && managed.bom === managed.directBom;
                if (managed.kind === "workspace" && managed.path && !gradle) {
                    optionsList.push({
                        id: id("managed"), title: `Change the managed version of ${a} to ${fixed}`,
                        detail: `Your own <dependencyManagement> in ${managed.path} sets ${a} to ${managed.version}.`,
                        risk: "unknown",
                        edit: managed.property && new RegExp(`<${managed.property.replace(/\./g, "\\.")}>`).test(texts.get(managed.path) ?? "")
                            ? { op: "pom-property", file: managed.path, property: managed.property, value: fixed }
                            : { op: "pom-managed", file: managed.path, groupId: g, artifactId: a, version: fixed }
                    });
                }
                if (managed.property && managed.kind !== "workspace" && (managed.kind === "parent" || gradle)) {
                    // The property the BOM reads for this artifact (tomcat.version).
                    const file = gradle ? buildFile : rootPom;
                    const owner = managed.kind === "parent" ? managed.source : managed.bom ?? managed.source;
                    const jump = majorOf(fixed) !== majorOf(managed.version);
                    optionsList.push({
                        id: id("property"), title: `Override ${managed.property} to ${fixed}`,
                        detail: `${owner} sets ${a} through the property ${managed.property}; ${gradle ? "Spring's dependency-management plugin" : "Maven"} lets your build override it. It is the smallest change, but ${owner.split(":")[1]} ${owner.split(":")[2] ?? ""} was not tested with ${a} ${fixed}; run your tests.${jump ? ` ${fixed} is a new major version of ${a}: expect breaking changes.` : ""}`,
                        risk: jump ? "high" : "medium",
                        ...(file ? { edit: gradle ? { op: "gradle-ext", file, property: managed.property, value: fixed } : { op: "pom-property", file, property: managed.property, value: fixed } } : {})
                    });
                }
                else if (managed.kind === "import" && managed.directBom && managed.directBomProperty && (gradle || inheritedImport)) {
                    // The property that selects a nested BOM (spring-framework.version picks spring-framework-bom): set it to a BOM release that fixes this.
                    const property = managed.directBomProperty;
                    const nested = managed.directBom;
                    const file = gradle ? buildFile : rootPom;
                    queue(nested, { groupId: g, artifactId: a, fixedIn: fixed, ids: fixIds }, result => {
                        if ("error" in result) {
                            notes.push(`Overriding ${property}: ${result.error}`);
                            return;
                        }
                        optionsList.splice(Math.min(1, optionsList.length), 0, {
                            id: id("bom-property"), title: `Override ${property} to ${result.to}`,
                            detail: `${nested.split(":")[1]} ${nested.split(":")[2]} manages ${a}, and its version comes from the property ${property}. ${result.bom.artifactId} ${result.to} manages ${result.managed.map(m => `${m.artifact.split(":")[1]} ${m.version}`).join(", ")}. Every artifact of that BOM moves together, which keeps them consistent. ${result.notes.join(" ")}`.trim(),
                            risk: result.risk === "low" ? "low" : result.risk,
                            ...(file ? { edit: gradle ? { op: "gradle-ext", file, property, value: result.to } : { op: "pom-property", file, property, value: result.to } } : {})
                        });
                    });
                }
                if (managed.kind === "import" && !gradle && !(inheritedImport && managed.directBomProperty)) {
                    const file = managed.importedBy?.kind === "workspace" && managed.importedBy.path ? managed.importedBy.path : rootPom ?? occurrence?.file;
                    optionsList.push({
                        id: id("pin"), title: `Pin ${a} ${fixed} in your <dependencyManagement>`,
                        detail: `The imported BOM ${managed.bom ?? managed.source} sets ${a} to ${managed.version}. An explicit entry in your own <dependencyManagement> wins over imported BOMs. Related artifacts from the same project stay at their old versions, so prefer upgrading the BOM when one fixes it.`,
                        risk: "medium",
                        ...(file ? { edit: { op: "pom-managed", file, groupId: g, artifactId: a, version: fixed } } : {})
                    });
                }
                // Upgrade what everything comes from: Spring Boot's parent (or another parent), or the BOM your build imports.
                const top = managed.kind === "parent" ? managed.source
                    : managed.kind === "import" ? (managed.importedBy?.kind === "parent" ? managed.importedBy.source : managed.bom ?? managed.source) : undefined;
                if (top) {
                    const viaParent = managed.kind === "parent" || managed.importedBy?.kind === "parent";
                    const via = managed.kind === "import" && managed.directBom && managed.directBom !== top ? managed.directBom.split(":").slice(0, 2).join(":") : undefined;
                    queue(top, { groupId: g, artifactId: a, fixedIn: fixed, ids: fixIds, ...(via ? { via } : {}) }, (result, all) => {
                        if ("error" in result) {
                            notes.push(`Upgrading ${top}: ${result.error}`);
                            return;
                        }
                        let edit;
                        if (gradle && result.bom.groupId === "org.springframework.boot") {
                            const file = [...texts.keys()].find(f => /build\.gradle(\.kts)?$/.test(f) && /org\.springframework\.boot["']\s*\)?\s*version/.test(texts.get(f) ?? ""));
                            if (file)
                                edit = { op: "gradle-plugin", file, pluginId: "org.springframework.boot", version: result.to };
                        }
                        else if (!gradle && viaParent && rootPom) {
                            const parent = /<parent>([\s\S]*?)<\/parent>/.exec(texts.get(rootPom) ?? "")?.[1] ?? "";
                            // spring-boot-starter-parent and spring-boot-dependencies share version numbers; other parents only when theirs match too.
                            const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                            if (new RegExp(`<groupId>\\s*${escape(result.bom.groupId)}\\s*</groupId>`).test(parent) && new RegExp(`<version>\\s*${escape(result.from)}\\s*</version>`).test(parent)) {
                                edit = { op: "pom-parent", file: rootPom, version: result.to };
                            }
                        }
                        else if (!gradle && occurrence) {
                            const file = managed.importedBy?.path ?? pomImporting(occurrence.file, top, texts);
                            if (file)
                                edit = { op: "pom-bom", file, groupId: result.bom.groupId, artifactId: result.bom.artifactId, version: result.to };
                        }
                        const together = all && !("error" in all) && all.to !== result.to
                            ? ` ${bomName(all.bom)} ${all.to} (${all.risk} risk) is the lowest release that fixes every vulnerable artifact it manages here (${all.managed.length}).`
                            : all && !("error" in all) && all.managed.length > 1 ? ` It also fixes the other ${all.managed.length - 1} vulnerable artifact${all.managed.length === 2 ? "" : "s"} it manages here.` : "";
                        optionsList.unshift({
                            id: id("bom"),
                            title: `Upgrade ${bomName(result.bom)} ${result.from} → ${result.to}`,
                            detail: `${result.bom.artifactId} ${result.to} manages ${result.managed.map(m => `${m.artifact.split(":")[1]} ${m.version}`).join(", ")}, verified against OSV. ${result.risk === "low" ? "It is a patch release of the line you use: the safest fix within your BOM." : result.risk === "medium" ? "It is a later minor release." : "It is a later major release."}${together} ${result.notes.join(" ")}`.trim(),
                            risk: result.risk,
                            ...(edit ? { edit } : {})
                        });
                    });
                }
            }
            // A transitive dependency nothing manages: name what brings it in.
            if (relation === "transitive" && !managed && via?.length) {
                notes.unshift(`${pkg.name} is brought in by ${via[0]}. A newer release of ${withoutVersion(via[0])} may depend on ${target} or later; upgrading it is usually the cleanest fix.`);
            }
        }
        if (remediation.commands.length) {
            optionsList.push({
                id: id("commands"), title: "Run the package manager",
                detail: "These commands change your lockfile; review the diff and run your tests afterwards.",
                risk: "unknown",
                commands: remediation.commands.map(c => ({ command: c.command, cwd: c.cwd }))
            });
        }
        if (!target && remediation.unfixed.length)
            notes.unshift(`No fixed version has been published for ${remediation.unfixed.join(", ")}. Check the advisories for workarounds, limit exposure of the affected feature, or replace the package.`);
        out.push({
            packageKey: pkg.key, ecosystem: pkg.ecosystem, packageName: pkg.name, installedVersion: pkg.version,
            ...(target ? { target, targetVerified: remediation.targetCheck?.status ?? "unchecked" } : {}),
            controlledBy: controlledBy(managed, relation, occurrence, via),
            options: optionsList,
            notes
        });
    }
    // BOMs are searched side by side, and so are the artifacts of one BOM once the shared search has loaded each release line.
    await (0, client_1.mapLimit)([...jobs], 3, async ([coordinate, job]) => {
        if (options.signal?.aborted || !providers.bomUpgrade)
            return;
        const ask = async (targets) => {
            try {
                return await providers.bomUpgrade(job.gav, targets, options.signal);
            }
            catch (error) {
                return { error: `${coordinate}: ${error instanceof Error ? error.message : String(error)}` };
            }
        };
        const distinct = job.entries.map(e => e.target).filter((t, i, list) => list.findIndex(o => o.groupId === t.groupId && o.artifactId === t.artifactId) === i);
        options.onProgress?.(`Finding the ${bomName(job.gav)} release${distinct.length === 1 ? "" : "s"} that fix ${distinct.length} managed dependenc${distinct.length === 1 ? "y" : "ies"}`, 0.98);
        // All together first: it loads each release line's newest BOM, which the single searches then reuse.
        const all = distinct.length > 1 ? await ask(distinct) : undefined;
        const answers = new Map();
        await (0, client_1.mapLimit)(distinct, 4, async (target) => {
            if (options.signal?.aborted)
                return;
            answers.set(`${target.groupId}:${target.artifactId}`, await ask([target]));
        });
        // Consumers run in entry order, so each card's options come out the same way every time.
        for (const entry of job.entries) {
            const answer = answers.get(`${entry.target.groupId}:${entry.target.artifactId}`);
            if (answer)
                entry.consumer(answer, all);
        }
    });
    // Artifacts that read one property (tomcat-embed-core and tomcat-embed-websocket read tomcat.version) get one value: the highest needed.
    const byProperty = new Map();
    for (const advice of out)
        for (const option of advice.options) {
            const edit = option.edit;
            if (edit?.op !== "pom-property" && edit?.op !== "gradle-ext")
                continue;
            const key = `${edit.file}|${edit.property}`;
            byProperty.set(key, [...(byProperty.get(key) ?? []), { option, advice }]);
        }
    for (const group of byProperty.values()) {
        const values = [...new Set(group.map(g => g.option.edit.value))];
        if (values.length < 2)
            continue;
        const highest = values.reduce((a, b) => ((0, dependency_versions_1.compareMaven)(a, b) >= 0 ? a : b));
        const names = [...new Set(group.map(g => g.advice.packageName.split(":").pop()))];
        // The shared value is as risky as the riskiest move any of them makes.
        const order = ["low", "medium", "unknown", "high"];
        const jumps = group.some(g => g.advice.installedVersion && majorOf(g.advice.installedVersion) !== majorOf(highest) && g.option.edit.value !== highest);
        const risk = group.map(g => g.option.risk).concat(jumps ? ["high"] : []).reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a));
        for (const { option, advice } of group) {
            const edit = option.edit;
            const raised = edit.value !== highest;
            edit.value = highest;
            option.title = `Override ${edit.property} to ${highest}`;
            option.risk = risk;
            option.detail += ` ${edit.property} also sets ${names.join(", ")}, so it gets the highest version any of them needs${raised && advice.installedVersion && majorOf(advice.installedVersion) !== majorOf(highest) ? `: a new major version for ${advice.packageName.split(":").pop()}, so expect breaking changes` : ""}.`;
        }
    }
    for (const item of out)
        for (const option of item.options)
            if (option.edit)
                option.editSummary = (0, edits_1.describeEdit)(option.edit);
    return out;
}
//# sourceMappingURL=engine.js.map