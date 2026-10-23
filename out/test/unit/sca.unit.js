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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const run_unit_tests_1 = require("./run-unit-tests");
const parsers_1 = require("../../osv/parsers");
const scan_1 = require("../../osv/scan");
const bom_1 = require("../../sca/bom");
const edits_1 = require("../../sca/edits");
const engine_1 = require("../../sca/engine");
const page_1 = require("../../sca/page");
const projects_1 = require("../../sca/projects");
const kev_1 = require("../../sca/providers/kev");
const nvd_1 = require("../../sca/providers/nvd");
const registry_1 = require("../../sca/providers/registry");
const report_1 = require("../../sca/report");
const osv_maven_unit_1 = require("./osv-maven.unit");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Model = require(path.resolve(__dirname, "../../../media/sca-model.js"));
/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */
/** springRepository() plus later Spring Boot and Spring Framework releases, with their maven-metadata. */
function bootReleases() {
    const fixture = (0, osv_maven_unit_1.springRepository)();
    const base = fixture.poms.get(`${osv_maven_unit_1.BOOT}:spring-boot-dependencies:2.6.6`);
    const release = (version, props) => {
        fixture.poms.set(`${osv_maven_unit_1.BOOT}:spring-boot-dependencies:${version}`, base
            .replace(/2\.6\.6/g, version)
            .replace("<tomcat.version>9.0.60</tomcat.version>", `<tomcat.version>${props.tomcat}</tomcat.version>`)
            .replace("<spring-framework.version>5.3.18</spring-framework.version>", `<spring-framework.version>${props.framework}</spring-framework.version>`)
            .replace("<snakeyaml.version>1.29</snakeyaml.version>", `<snakeyaml.version>${props.snakeyaml}</snakeyaml.version>`));
    };
    release("2.6.7", { tomcat: "9.0.62", framework: "5.3.19", snakeyaml: "1.29" });
    release("2.6.8", { tomcat: "9.0.63", framework: "5.3.20", snakeyaml: "1.29" });
    release("2.7.0", { tomcat: "9.0.63", framework: "5.3.20", snakeyaml: "1.30" });
    release("2.7.5", { tomcat: "9.0.69", framework: "5.3.23", snakeyaml: "1.33" });
    release("3.0.0", { tomcat: "10.1.1", framework: "6.0.2", snakeyaml: "1.33" });
    for (const v of ["5.3.19", "5.3.20", "5.3.23", "6.0.2"]) {
        fixture.poms.set(`${osv_maven_unit_1.SPRING}:spring-framework-bom:${v}`, (0, osv_maven_unit_1.pom)({ g: osv_maven_unit_1.SPRING, a: "spring-framework-bom", v, packaging: "pom", managed: ["spring-core", "spring-web", "spring-webmvc", "spring-jcl", "spring-test"].map(a => ({ g: osv_maven_unit_1.SPRING, a, v })) }));
    }
    fixture.metadata.set(`${osv_maven_unit_1.BOOT}:spring-boot-dependencies`, ["2.6.5", "2.6.6", "2.6.7", "2.6.8", "2.7.0-M1", "2.7.0-RC1", "2.7.0", "2.7.5", "3.0.0-SNAPSHOT", "3.0.0"]);
    fixture.metadata.set(`${osv_maven_unit_1.SPRING}:spring-framework-bom`, ["5.3.18", "5.3.19", "5.3.20", "5.3.23", "6.0.0-M1", "6.0.2"]);
    return fixture;
}
const KEV_DOC = {
    catalogVersion: "2026.10.20",
    vulnerabilities: [
        { cveID: "CVE-2022-22965", vendorProject: "VMware", product: "Spring Framework", vulnerabilityName: "Spring Framework JDK 9+ Remote Code Execution", dateAdded: "2022-04-04", dueDate: "2022-04-25", requiredAction: "Apply updates per vendor instructions.", knownRansomwareCampaignUse: "Unknown" },
        { cveID: "CVE-2021-44228", vendorProject: "Apache", product: "Log4j2", vulnerabilityName: "Log4Shell", dateAdded: "2021-12-10", knownRansomwareCampaignUse: "Known" },
        { cveID: "not-a-cve" }
    ]
};
function nvdDoc(cveId, metrics) {
    return { resultsPerPage: 1, vulnerabilities: [{ cve: { id: cveId, metrics } }] };
}
const primary31 = (score, severity) => ({ source: "nvd@nist.gov", type: "Primary", cvssData: { version: "3.1", baseScore: score, baseSeverity: severity, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" } });
function memoryStore() {
    const data = new Map();
    return { data, get: async (key) => data.get(key), set: async (key, value) => { data.set(key, value); } };
}
/** The advisories of osv-maven's suite, with a CVE on the H2 advisory so NVD can score it. */
const SCA_ADVISORIES = osv_maven_unit_1.ADVISORIES.map(a => a.record.id === "OSV-h2-0000-0004" ? { ...a, record: { ...a.record, aliases: ["CVE-2022-23221"] } } : a);
async function springScan(advisories = SCA_ADVISORIES) {
    const { repository } = (0, osv_maven_unit_1.fixtureRepository)(bootReleases());
    const files = (0, osv_maven_unit_1.springWorkspace)();
    const scan = await (0, scan_1.runScan)(files, (0, osv_maven_unit_1.scanOptions)((0, osv_maven_unit_1.fakeOsv)(advisories).fetch, { repository, repositoryLabel: "fixture" }));
    return { scan, files, repository };
}
function providers(repository, extra = {}) {
    const calls = { kev: 0, nvd: 0, health: 0, bom: 0 };
    const kevCatalog = (0, kev_1.parseKevCatalog)(KEV_DOC, Date.now());
    return {
        calls,
        healthScope: "direct",
        kev: async () => { calls.kev++; return { catalog: kevCatalog, status: "ok", message: "CISA KEV catalog (fixture)." }; },
        nvd: async (cves) => {
            calls.nvd++;
            const scores = new Map();
            for (const id of cves)
                if (id === "CVE-2022-23221")
                    scores.set(id, { cveId: id, baseScore: 9.8, baseSeverity: "CRITICAL", vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", version: "3.1", source: "nvd@nist.gov", primary: true });
            return { scores, looked: cves.length, fromCache: 0, skipped: [], errors: [] };
        },
        health: async (requests) => {
            calls.health++;
            const results = new Map();
            for (const r of requests) {
                const key = `${r.ecosystem}|${r.name}|${r.version}`;
                if (r.name === "com.h2database:h2")
                    results.set(key, { latest: "2.2.224", page: "https://central.sonatype.com/artifact/com.h2database/h2" });
                if (r.name === "org.apache.commons:commons-text")
                    results.set(key, { latest: "1.9", deprecated: "Relocated; use commons-text 1.10.0+.", page: "https://central.sonatype.com/artifact/org.apache.commons/commons-text" });
            }
            return { results, checked: requests.length, fromCache: 0, unsupported: 0, errors: [] };
        },
        bomUpgrade: (bom, targets, signal) => { calls.bom++; return (0, bom_1.findBomUpgrade)(repository, bom, targets, { signal }); },
        ...extra
    };
}
async function analysedSpring(extra = {}, advisories = SCA_ADVISORIES) {
    const { scan, files, repository } = await springScan(advisories);
    const p = providers(repository, extra);
    const result = await (0, engine_1.analyseScan)(scan, p, {
        projects: (0, projects_1.detectProjects)(files, "shop"),
        texts: new Map(files.map(f => [f.path, f.text])),
        toolVersion: "test",
        startedAt: Date.now()
    });
    return { result, calls: p.calls, files };
}
/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("sca: CISA KEV", () => {
    (0, run_unit_tests_1.test)("parses the published schema, drops malformed rows, rejects other documents", () => {
        const catalog = (0, kev_1.parseKevCatalog)(KEV_DOC, 1);
        assert.strictEqual(catalog.version, "2026.10.20");
        assert.deepStrictEqual([...catalog.entries.keys()], ["CVE-2022-22965", "CVE-2021-44228"]);
        assert.strictEqual((0, kev_1.parseKevCatalog)({ vulnerabilities: "x" }), undefined);
        assert.strictEqual((0, kev_1.parseKevCatalog)({ vulnerabilities: [] }), undefined, "an empty catalog is not trusted");
        assert.strictEqual((0, kev_1.parseKevCatalog)("<html>"), undefined);
        assert.strictEqual((0, kev_1.kevFor)(catalog, ["GHSA-x", "cve-2021-44228"])?.vulnerabilityName, "Log4Shell", "matches any alias, any case");
        assert.strictEqual((0, kev_1.kevFor)(undefined, ["CVE-2021-44228"]), undefined);
    });
    (0, run_unit_tests_1.test)("uses a fresh cache, refreshes a stale one, and falls back to it when offline", async () => {
        let stored;
        const store = { read: async () => stored, write: async (v) => { stored = v; } };
        let fetches = 0;
        const online = async () => { fetches++; return { status: 200, json: async () => KEV_DOC }; };
        const offline = async () => { fetches++; throw new Error("getaddrinfo ENOTFOUND www.cisa.gov"); };
        const first = await (0, kev_1.loadKev)(online, store, { now: 1000 });
        assert.deepStrictEqual([first.status, fetches, first.catalog?.entries.size], ["ok", 1, 2]);
        const cached = await (0, kev_1.loadKev)(online, store, { now: 1000 + 60000 });
        assert.deepStrictEqual([cached.status, fetches], ["ok", 1], "under a day old: no download");
        const stale = await (0, kev_1.loadKev)(offline, store, { now: 1000 + 2 * 86400000 });
        assert.strictEqual(stale.status, "stale");
        assert.match(stale.message, /could not be refreshed .*ENOTFOUND/);
        assert.ok(stale.catalog, "the last good copy is still used");
        const none = await (0, kev_1.loadKev)(offline, undefined, {});
        assert.deepStrictEqual([none.status, none.catalog], ["unavailable", undefined]);
        const junk = await (0, kev_1.loadKev)(async () => ({ status: 200, json: async () => ({ hello: 1 }) }), undefined, {});
        assert.match(junk.message, /does not match the catalog schema/);
        const http = await (0, kev_1.loadKev)(async () => ({ status: 503, json: async () => ({}) }), undefined, {});
        assert.match(http.message, /HTTP 503/);
    });
});
(0, run_unit_tests_1.suite)("sca: NVD", () => {
    (0, run_unit_tests_1.test)("prefers NVD's primary CVSS 3.x, then a CNA's 3.x, then 4.0, then 2.0", () => {
        const secondary = { source: "security@vendor", type: "Secondary", cvssData: { baseScore: 7.5, baseSeverity: "HIGH", vectorString: "CVSS:3.1/x" } };
        const v2 = { source: "nvd@nist.gov", type: "Primary", baseSeverity: "MEDIUM", cvssData: { baseScore: 5, vectorString: "AV:N/AC:L/Au:N/C:P/I:N/A:N" } };
        assert.strictEqual((0, nvd_1.parseNvdResponse)(nvdDoc("CVE-1-1", { cvssMetricV31: [secondary, primary31(9.8, "CRITICAL")], cvssMetricV2: [v2] }), "CVE-1-1")?.baseScore, 9.8);
        const cna = (0, nvd_1.parseNvdResponse)(nvdDoc("CVE-1-1", { cvssMetricV31: [secondary], cvssMetricV2: [v2] }), "CVE-1-1");
        assert.deepStrictEqual([cna.baseScore, cna.primary, cna.source], [7.5, false, "security@vendor"]);
        const old = (0, nvd_1.parseNvdResponse)(nvdDoc("CVE-1-1", { cvssMetricV2: [v2] }), "CVE-1-1");
        assert.deepStrictEqual([old.version, old.baseSeverity], ["2.0", "MEDIUM"]);
        assert.strictEqual((0, nvd_1.parseNvdResponse)(nvdDoc("CVE-1-1", { cvssMetricV31: [{ cvssData: { baseScore: 42 } }] }), "CVE-1-1"), undefined, "out-of-range scores are rejected");
        assert.strictEqual((0, nvd_1.parseNvdResponse)(nvdDoc("CVE-9-9", { cvssMetricV31: [primary31(9.8, "CRITICAL")] }), "CVE-1-1"), undefined, "only the CVE asked for");
        assert.strictEqual((0, nvd_1.parseNvdResponse)({}, "CVE-1-1"), undefined);
    });
    (0, run_unit_tests_1.test)("spaces requests for the public rate limit, caches answers, caps lookups and stops when rate limited", async () => {
        const sleeps = [];
        const urls = [];
        const store = memoryStore();
        const fetchJson = async (url, headers) => {
            urls.push(url + (headers.apiKey ? " [key]" : ""));
            const id = decodeURIComponent(url.split("cveId=")[1]);
            return { status: 200, json: async () => (id === "CVE-2020-0003" ? { vulnerabilities: [] } : nvdDoc(id, { cvssMetricV31: [primary31(7.2, "HIGH")] })) };
        };
        const ids = ["CVE-2020-0001", "cve-2020-0002", "CVE-2020-0001", "CVE-2020-0003", "nonsense"];
        const batch = await (0, nvd_1.lookupNvd)(ids, fetchJson, store, { sleep: async (ms) => { sleeps.push(ms); }, now: () => 1 });
        assert.deepStrictEqual([batch.looked, batch.scores.size, batch.fromCache], [3, 2, 0], "deduplicated, normalised, invalid ids dropped");
        assert.deepStrictEqual(sleeps, [6500, 6500], "5 requests per 30 s without a key");
        assert.ok(urls.every(u => u.startsWith("https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-")), "only CVE ids are sent");
        const again = await (0, nvd_1.lookupNvd)(["CVE-2020-0001", "CVE-2020-0003"], fetchJson, store, { sleep: async () => undefined, now: () => 2 });
        assert.deepStrictEqual([again.looked, again.fromCache, again.scores.size], [0, 2, 1], "answers, including 'no score', are cached");
        const keyed = [];
        await (0, nvd_1.lookupNvd)(["CVE-2021-0001", "CVE-2021-0002"], fetchJson, undefined, { apiKey: "k".repeat(36), sleep: async (ms) => { keyed.push(ms); } });
        assert.deepStrictEqual(keyed, [700]);
        assert.ok(urls[urls.length - 1].endsWith("[key]"), "the key goes in the apiKey header");
        const capped = await (0, nvd_1.lookupNvd)(Array.from({ length: 15 }, (_, i) => `CVE-2022-${1000 + i}`), fetchJson, undefined, { sleep: async () => undefined });
        assert.deepStrictEqual([capped.looked, capped.skipped.length], [12, 3], "at most 12 lookups per scan without a key");
        let calls = 0;
        const limited = await (0, nvd_1.lookupNvd)(["CVE-2023-0001", "CVE-2023-0002", "CVE-2023-0003"], async () => { calls++; return { status: 403, json: async () => ({}) }; }, undefined, { sleep: async () => undefined });
        assert.deepStrictEqual([calls, limited.skipped.length], [1, 3], "a rate-limit answer stops further requests");
        assert.match(limited.errors[0], /rate limit/);
        const controller = new AbortController();
        controller.abort();
        const cancelled = await (0, nvd_1.lookupNvd)(["CVE-2024-0001"], fetchJson, undefined, { signal: controller.signal });
        assert.strictEqual(cancelled.looked, 0);
    });
});
(0, run_unit_tests_1.suite)("sca: registry health", () => {
    const r = (ecosystem, name, version) => ({ ecosystem: ecosystem, name, version });
    (0, run_unit_tests_1.test)("URLs send only the package name, escaped per registry", () => {
        assert.strictEqual((0, registry_1.registryUrl)(r("npm", "@types/node", "1.0.0")).url, "https://registry.npmjs.org/@types%2fnode");
        assert.strictEqual((0, registry_1.registryUrl)(r("Go", "github.com/Azure/go-autorest", "v1")).url, "https://proxy.golang.org/github.com/!azure/go-autorest/@latest");
        assert.strictEqual((0, registry_1.goProxyPath)("github.com/BurntSushi/toml"), "github.com/!burnt!sushi/toml");
        assert.strictEqual((0, registry_1.registryUrl)(r("Maven", "org.yaml:snakeyaml", "1.29")).url, "https://repo.maven.apache.org/maven2/org/yaml/snakeyaml/maven-metadata.xml");
        assert.strictEqual((0, registry_1.registryUrl)(r("Maven", "bad name:x", "1")), undefined);
        assert.strictEqual((0, registry_1.registryUrl)(r("Packagist", "not-a-vendor-package", "1")), undefined);
        assert.strictEqual((0, registry_1.registryUrl)(r("SwiftURL", "x", "1")), undefined, "no registry: unsupported, not guessed");
    });
    (0, run_unit_tests_1.test)("reads latest, deprecated, yanked, abandoned and inactive from each registry's format", () => {
        const npm = (0, registry_1.parseRegistry)(r("npm", "request", "2.88.2"), { "dist-tags": { latest: "2.88.2" }, versions: { "2.88.2": { deprecated: "request has been deprecated" } } }, "p");
        assert.deepStrictEqual([npm.latest, npm.deprecated], ["2.88.2", "request has been deprecated"]);
        const pypi = (0, registry_1.parseRegistry)(r("PyPI", "x", "1.0"), { info: { version: "2.0", classifiers: ["Development Status :: 7 - Inactive"] }, releases: { "1.0": [{ yanked: true, yanked_reason: "broken wheel" }, { yanked: true }] } }, "p");
        assert.deepStrictEqual([pypi.latest, pypi.yanked, pypi.inactive], ["2.0", "broken wheel", true]);
        assert.strictEqual((0, registry_1.parseRegistry)(r("PyPI", "x", "1.0"), { info: { version: "2" }, releases: { "1.0": [{ yanked: true }, { yanked: false }] } }, "p").yanked, undefined, "yanked only when every file is");
        const crate = (0, registry_1.parseRegistry)(r("crates.io", "x", "0.1.0"), { crate: { max_stable_version: "0.3.1" }, versions: [{ num: "0.1.0", yanked: true }] }, "p");
        assert.deepStrictEqual([crate.latest, Boolean(crate.yanked)], ["0.3.1", true]);
        const gem = (0, registry_1.parseRegistry)(r("RubyGems", "x", "1.0.1"), [{ number: "2.0.0.rc1", prerelease: true }, { number: "1.9.0", prerelease: false }, { number: "1.0.0" }], "p");
        assert.deepStrictEqual([gem.latest, Boolean(gem.yanked)], ["1.9.0", true], "a version rubygems.org no longer lists was yanked");
        const composer = (0, registry_1.parseRegistry)(r("Packagist", "Swiftmailer/Swiftmailer", "6.0.0"), { packages: { "swiftmailer/swiftmailer": [{ version: "v6.3.0", abandoned: "symfony/mailer" }, { version: "v6.2.0" }, { version: "v7.0.0-beta1" }] } }, "p");
        assert.deepStrictEqual([composer.latest, composer.abandoned], ["6.3.0", { replacement: "symfony/mailer" }]);
        const nuget = (0, registry_1.parseRegistry)(r("NuGet", "Old.Pkg", "1.0.0"), { items: [{ items: [
                        { catalogEntry: { version: "1.0.0", listed: false, deprecation: { reasons: ["Legacy"], alternatePackage: { id: "New.Pkg" } } } },
                        { catalogEntry: { version: "2.0.0", listed: true } }, { catalogEntry: { version: "3.0.0-preview1" } }
                    ] }] }, "p");
        assert.deepStrictEqual([nuget.latest, nuget.deprecated, nuget.yanked], ["2.0.0", "Deprecated on NuGet (Legacy). Use New.Pkg instead.", "Unlisted on nuget.org."]);
        assert.strictEqual((0, registry_1.parseRegistry)(r("Go", "m", "v1"), { Version: "v1.5.0" }, "p").latest, "v1.5.0");
        assert.strictEqual((0, registry_1.parseRegistry)(r("Go", "m", "v1"), "module m\n\n// Deprecated: use m/v2 instead.\ngo 1.20\n", "p").deprecated, "use m/v2 instead.");
        const pub = (0, registry_1.parseRegistry)(r("Pub", "x", "1.0.0"), { latest: { version: "1.2.0" }, isDiscontinued: true, replacedBy: "y", versions: [{ version: "1.0.0", retracted: true }] }, "p");
        assert.deepStrictEqual([pub.latest, pub.abandoned, Boolean(pub.yanked)], ["1.2.0", { replacement: "y" }, true]);
        const hex = (0, registry_1.parseRegistry)(r("Hex", "x", "0.1.0"), { latest_stable_version: "0.2.0", retirements: { "0.1.0": { reason: "security", message: "CVE fix in 0.1.1" } } }, "p");
        assert.strictEqual(hex.yanked, "Retired on hex.pm (security): CVE fix in 0.1.1");
        const maven = (0, registry_1.parseRegistry)(r("Maven", "g:a", "1.0"), "<metadata><versioning><release>2.0.0</release><versions><version>1.0</version><version>2.0.0</version><version>3.0.0-M1</version><version>2.1.0-RC1</version></versions></versioning></metadata>", "p");
        assert.strictEqual(maven.latest, "2.0.0", "milestones and release candidates are not 'latest stable'");
    });
    (0, run_unit_tests_1.test)("outdated level is ecosystem-aware and never invents a gap", () => {
        assert.strictEqual((0, registry_1.outdatedLevel)("npm", "1.2.3", "2.0.0"), "major");
        assert.strictEqual((0, registry_1.outdatedLevel)("npm", "1.2.3", "1.3.0"), "minor");
        assert.strictEqual((0, registry_1.outdatedLevel)("Maven", "9.0.60", "9.0.69"), "patch");
        assert.strictEqual((0, registry_1.outdatedLevel)("npm", "2.0.0", "1.9.9"), undefined, "newer than latest (prerelease or private build)");
        assert.strictEqual((0, registry_1.outdatedLevel)("npm", "1.0.0", undefined), undefined);
        assert.strictEqual((0, registry_1.outdatedLevel)("PyPI", "1.0", "1.0.0"), undefined, "PEP 440 equal versions");
        assert.strictEqual((0, registry_1.outdatedLevel)("Go", "v1.2.0", "v1.10.0"), "minor");
    });
    (0, run_unit_tests_1.test)("checks concurrently with a cache; private packages are silent, failures are aggregated per host", async () => {
        const seen = [];
        const replies = {
            "https://registry.npmjs.org/left-pad": { status: 200, text: JSON.stringify({ "dist-tags": { latest: "1.3.0" }, versions: { "1.1.0": { deprecated: "use String.prototype.padStart()" } } }) },
            "https://registry.npmjs.org/@acme%2finternal": { status: 404, text: "" },
            "https://proxy.golang.org/example.com/old/@latest": { status: 200, text: JSON.stringify({ Version: "v1.4.0" }) },
            "https://proxy.golang.org/example.com/old/@v/v1.4.0.mod": { status: 200, text: "module example.com/old\n// Deprecated: moved to example.com/new\n" },
            "https://api.nuget.org/v3/registration5-gz-semver2/big.pkg/index.json": { status: 200, text: JSON.stringify({ items: [{ "@id": "https://api.nuget.org/page/1.json", lower: "1.0.0", upper: "1.9.9" }, { "@id": "https://api.nuget.org/page/2.json", lower: "2.0.0", upper: "2.1.0" }] }) },
            "https://api.nuget.org/page/1.json": { status: 200, text: JSON.stringify({ items: [{ catalogEntry: { version: "1.2.0", deprecation: { message: "Use Big.Pkg 2" } } }] }) },
            "https://api.nuget.org/page/2.json": { status: 200, text: JSON.stringify({ items: [{ catalogEntry: { version: "2.1.0" } }] }) }
        };
        const fetchText = async (url, headers) => {
            seen.push(url);
            if (url.includes("npmjs.org"))
                assert.strictEqual(headers.Accept, "application/vnd.npm.install-v1+json", "the abbreviated npm document");
            if (url.includes("pypi.org"))
                return { status: 502, text: "" };
            return replies[url] ?? { status: 404, text: "" };
        };
        const store = memoryStore();
        const requests = [r("npm", "left-pad", "1.1.0"), r("npm", "@acme/internal", "1.0.0"), r("Go", "example.com/old", "v1.0.0"), r("NuGet", "Big.Pkg", "1.2.0"),
            r("PyPI", "a", "1"), r("PyPI", "b", "1"), r("SwiftURL", "x", "1")];
        const batch = await (0, registry_1.checkHealth)(requests, fetchText, store, { now: () => 1 });
        assert.strictEqual(batch.results.get("npm|left-pad|1.1.0")?.deprecated, "use String.prototype.padStart()");
        assert.ok(!batch.results.has("npm|@acme/internal|1.0.0"), "not on the public registry: nothing is said about it");
        assert.strictEqual(batch.results.get("Go|example.com/old|v1.0.0")?.deprecated, "moved to example.com/new");
        assert.deepStrictEqual([batch.results.get("NuGet|Big.Pkg|1.2.0")?.deprecated, batch.results.get("NuGet|Big.Pkg|1.2.0")?.latest], ["Use Big.Pkg 2", "2.1.0"], "external registration pages are fetched");
        assert.deepStrictEqual(batch.errors, ["2 packages could not be checked (pypi.org: HTTP 502)"]);
        assert.strictEqual(batch.unsupported, 1);
        const before = seen.length;
        const again = await (0, registry_1.checkHealth)(requests.slice(0, 1), fetchText, store, { now: () => 2 });
        assert.deepStrictEqual([again.fromCache, seen.length], [1, before], "six-hour cache");
    });
});
/* ------------------------------------------------------------------ *
 * Edits
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("sca: remediation edits", () => {
    const apply = (spec, text) => { const out = (0, edits_1.applyEdit)(spec, text); assert.ok("text" in out, "error" in out ? out.error : ""); return out.text; };
    const refuse = (spec, text, pattern) => { const out = (0, edits_1.applyEdit)(spec, text); assert.ok("error" in out); assert.match(out.error, pattern); };
    const rootPom = `<?xml version="1.0"?>
<project>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.6.6</version>
        <relativePath/>
    </parent>
    <groupId>com.example</groupId>
    <artifactId>shop</artifactId>
    <version>1.0.0</version>
    <properties>
        <java.version>11</java.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.yaml</groupId>
            <artifactId>snakeyaml</artifactId>
            <version>\${snakeyaml.version}</version>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <version>1.4.200</version>
        </dependency>
    </dependencies>
</project>
`;
    (0, run_unit_tests_1.test)("Maven: property, parent, version, managed entry and BOM edits change only what they must", () => {
        const withProperty = apply({ op: "pom-property", file: "pom.xml", property: "tomcat.version", value: "9.0.69" }, rootPom);
        assert.ok(withProperty.includes("        <java.version>11</java.version>\n        <tomcat.version>9.0.69</tomcat.version>\n    </properties>"), "added with the file's indentation");
        assert.strictEqual(apply({ op: "pom-property", file: "pom.xml", property: "tomcat.version", value: "9.0.70" }, withProperty).split("tomcat.version").length - 1, 2, "an existing property is updated, not duplicated");
        const noProperties = rootPom.replace(/\s*<properties>[\s\S]*?<\/properties>/, "");
        assert.match(apply({ op: "pom-property", file: "pom.xml", property: "x.version", value: "1" }, noProperties), /<\/parent>\n    <properties>\n        <x\.version>1<\/x\.version>\n    <\/properties>/);
        const parent = apply({ op: "pom-parent", file: "pom.xml", version: "2.7.5" }, rootPom);
        assert.ok(parent.includes("<artifactId>spring-boot-starter-parent</artifactId>\n        <version>2.7.5</version>"));
        assert.ok(parent.includes("<version>1.0.0</version>"), "the project's own version is untouched");
        assert.ok(apply({ op: "pom-version", file: "pom.xml", groupId: "com.h2database", artifactId: "h2", version: "2.2.224" }, rootPom).includes("<version>2.2.224</version>"));
        const viaProperty = apply({ op: "pom-version", file: "pom.xml", groupId: "org.yaml", artifactId: "snakeyaml", version: "1.33" }, rootPom.replace("<java.version>11</java.version>", "<java.version>11</java.version>\n        <snakeyaml.version>1.29</snakeyaml.version>"));
        assert.ok(viaProperty.includes("<snakeyaml.version>1.33</snakeyaml.version>") && viaProperty.includes("<version>${snakeyaml.version}</version>"), "a property-driven version changes the property");
        refuse({ op: "pom-version", file: "pom.xml", groupId: "org.yaml", artifactId: "snakeyaml", version: "1.33" }, rootPom, /not defined in this file/);
        refuse({ op: "pom-version", file: "pom.xml", groupId: "x", artifactId: "y", version: "1" }, rootPom, /not declared/);
        const managed = apply({ op: "pom-managed", file: "pom.xml", groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", version: "9.0.69" }, rootPom);
        assert.match(managed, /<dependencyManagement>\n        <dependencies>\n            <dependency>\n                <groupId>org\.apache\.tomcat\.embed<\/groupId>[\s\S]*<version>9\.0\.69<\/version>\n            <\/dependency>\n        <\/dependencies>\n    <\/dependencyManagement>\n    <dependencies>/);
        const managedTwice = apply({ op: "pom-managed", file: "pom.xml", groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", version: "9.0.70" }, managed);
        assert.strictEqual(managedTwice.split("tomcat-embed-core").length - 1, 1, "an existing managed entry is updated");
        const bomPom = `<project><properties><spring-boot.version>2.6.6</spring-boot.version></properties><dependencyManagement><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>\${spring-boot.version}</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement></project>`;
        assert.ok(apply({ op: "pom-bom", file: "pom.xml", groupId: osv_maven_unit_1.BOOT, artifactId: "spring-boot-dependencies", version: "2.7.5" }, bomPom).includes("<spring-boot.version>2.7.5</spring-boot.version>"));
        refuse({ op: "pom-bom", file: "pom.xml", groupId: "x", artifactId: "y", version: "1" }, bomPom, /not imported/);
        refuse({ op: "pom-parent", file: "pom.xml", version: "1" }, "<project/>", /no <parent>/);
    });
    (0, run_unit_tests_1.test)("Gradle, npm, pip, NuGet, Composer and Cargo edits keep the file's own style", () => {
        const gradle = `plugins {\n    id 'org.springframework.boot' version '2.6.6'\n    id 'java'\n}\n\ndependencies {\n    implementation 'com.h2database:h2:1.4.200'\n    implementation "org.yaml:snakeyaml:$snakeVersion"\n}\n`;
        assert.ok(apply({ op: "gradle-plugin", file: "build.gradle", pluginId: "org.springframework.boot", version: "2.7.5" }, gradle).includes("id 'org.springframework.boot' version '2.7.5'"));
        assert.ok(apply({ op: "gradle-version", file: "build.gradle", groupId: "com.h2database", artifactId: "h2", version: "2.2.224" }, gradle).includes("'com.h2database:h2:2.2.224'"));
        refuse({ op: "gradle-version", file: "build.gradle", groupId: "org.yaml", artifactId: "snakeyaml", version: "1.33" }, gradle, /comes from \$snakeVersion/);
        const ext = apply({ op: "gradle-ext", file: "build.gradle", property: "tomcat.version", value: "9.0.69" }, gradle);
        assert.ok(ext.startsWith("plugins {") && ext.includes("}\n\next['tomcat.version'] = '9.0.69'\n"), "after the plugins block");
        assert.strictEqual(apply({ op: "gradle-ext", file: "build.gradle", property: "tomcat.version", value: "9.0.70" }, ext).split("tomcat.version").length - 1, 1);
        const kts = apply({ op: "gradle-ext", file: "build.gradle.kts", property: "tomcat.version", value: "9.0.69" }, `plugins {\n    id("org.springframework.boot") version "2.6.6"\n}\n`);
        assert.ok(kts.includes(`extra["tomcat.version"] = "9.0.69"`));
        assert.ok(apply({ op: "gradle-plugin", file: "build.gradle.kts", pluginId: "org.springframework.boot", version: "2.7.5" }, kts).includes(`id("org.springframework.boot") version "2.7.5"`));
        const pkg = `{\n  "name": "web",\n  "dependencies": {\n    "lodash": "^4.17.15"\n  },\n  "devDependencies": {\n    "local": "file:../local"\n  }\n}\n`;
        assert.ok(apply({ op: "npm-dependency", file: "package.json", name: "lodash", version: "4.17.21" }, pkg).includes(`"lodash": "^4.17.21"`), "the range operator is kept");
        refuse({ op: "npm-dependency", file: "package.json", name: "local", version: "1.0.0" }, pkg, /not installed from the registry/);
        refuse({ op: "npm-dependency", file: "package.json", name: "minimist", version: "1.2.6" }, pkg, /not a direct dependency/);
        assert.deepStrictEqual(JSON.parse(apply({ op: "npm-override", file: "package.json", manager: "npm", name: "minimist", version: "1.2.6" }, pkg)).overrides, { minimist: "1.2.6" });
        assert.deepStrictEqual(JSON.parse(apply({ op: "npm-override", file: "package.json", manager: "yarn", name: "minimist", version: "1.2.6" }, pkg)).resolutions, { minimist: "1.2.6" });
        assert.deepStrictEqual(JSON.parse(apply({ op: "npm-override", file: "package.json", manager: "pnpm", name: "minimist", version: "1.2.6" }, pkg)).pnpm, { overrides: { minimist: "1.2.6" } });
        assert.ok(apply({ op: "npm-override", file: "package.json", manager: "npm", name: "minimist", version: "1.2.6" }, pkg).endsWith("}\n"));
        const reqs = "Django==3.2.0  # web\nrequests>=2.0,<3\nPyYAML[libyaml]==5.3\n";
        assert.strictEqual(apply({ op: "pip-requirement", file: "requirements.txt", name: "django", version: "3.2.25" }, reqs), "Django==3.2.25  # web\nrequests>=2.0,<3\nPyYAML[libyaml]==5.3\n");
        assert.ok(apply({ op: "pip-requirement", file: "requirements.txt", name: "pyyaml", version: "5.4" }, reqs).includes("PyYAML[libyaml]==5.4"));
        assert.ok(apply({ op: "pip-requirement", file: "requirements.txt", name: "requests", version: "2.31.0" }, reqs).includes("requests>=2.31.0\n"));
        assert.ok(apply({ op: "csproj-version", file: "a.csproj", id: "Newtonsoft.Json", version: "13.0.1" }, `<PackageReference Include="Newtonsoft.Json" Version="12.0.1" />`).includes(`Version="13.0.1"`));
        refuse({ op: "csproj-version", file: "a.csproj", id: "X", version: "1" }, `<PackageReference Include="X" />`, /Directory\.Packages\.props/);
        assert.ok(apply({ op: "composer-require", file: "composer.json", name: "guzzlehttp/guzzle", version: "7.4.5" }, `{"require":{"guzzlehttp/guzzle":"^7.0"}}`).includes(`"guzzlehttp/guzzle":"^7.4.5"`));
        assert.ok(apply({ op: "cargo-version", file: "Cargo.toml", name: "tokio", version: "1.38.2" }, `[dependencies]\ntokio = { version = "1.20", features = ["full"] }\n`).includes(`version = "1.38.2"`));
        assert.ok(apply({ op: "cargo-version", file: "Cargo.toml", name: "regex", version: "1.5.5" }, `[dependencies]\nregex = "=1.5.4"\n`).includes(`regex = "=1.5.5"`));
    });
    (0, run_unit_tests_1.test)("unsafe values are refused and every edit has a description", () => {
        refuse({ op: "pom-property", file: "pom.xml", property: "x", value: "1</x><evil>" }, "<project><properties></properties></project>", /not safe/);
        refuse({ op: "npm-dependency", file: "package.json", name: "a\"b", version: "1" }, "{}", /not safe/);
        refuse({ op: "npm-dependency", file: "package.json", name: "a", version: "1" }, "{not json", /not valid JSON/);
        const specs = [
            { op: "npm-dependency", file: "f", name: "n", version: "1" }, { op: "npm-override", file: "f", manager: "yarn", name: "n", version: "1" },
            { op: "pip-requirement", file: "f", name: "n", version: "1" }, { op: "pom-version", file: "f", groupId: "g", artifactId: "a", version: "1" },
            { op: "pom-property", file: "f", property: "p", value: "1" }, { op: "pom-managed", file: "f", groupId: "g", artifactId: "a", version: "1" },
            { op: "pom-parent", file: "f", version: "1" }, { op: "pom-bom", file: "f", groupId: "g", artifactId: "a", version: "1" },
            { op: "gradle-version", file: "f", groupId: "g", artifactId: "a", version: "1" }, { op: "gradle-ext", file: "f", property: "p", value: "1" },
            { op: "gradle-plugin", file: "f", pluginId: "p", version: "1" }, { op: "csproj-version", file: "f", id: "i", version: "1" },
            { op: "composer-require", file: "f", name: "n", version: "1" }, { op: "cargo-version", file: "f", name: "n", version: "1" }
        ];
        for (const spec of specs)
            assert.ok((0, edits_1.describeEdit)(spec).includes(" f"), spec.op);
    });
});
/* ------------------------------------------------------------------ *
 * BOM upgrades and projects
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("sca: BOM-aware upgrades", () => {
    (0, run_unit_tests_1.test)("finds the lowest stable release in the nearest line whose BOM manages every fix", async () => {
        const { repository, requests } = (0, osv_maven_unit_1.fixtureRepository)(bootReleases());
        const bom = { groupId: osv_maven_unit_1.BOOT, artifactId: "spring-boot-dependencies", version: "2.6.6" };
        const patch = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "9.0.62" }, { groupId: osv_maven_unit_1.SPRING, artifactId: "spring-core", fixedIn: "5.3.19" }]);
        assert.ok(!("error" in patch));
        assert.deepStrictEqual([patch.to, patch.risk], ["2.6.7", "low"], "a patch release of the same line");
        assert.deepStrictEqual(patch.managed, [{ artifact: "org.apache.tomcat.embed:tomcat-embed-core", version: "9.0.62" }, { artifact: `${osv_maven_unit_1.SPRING}:spring-core`, version: "5.3.19" }], "read from the real BOM, through its nested spring-framework-bom import");
        const minor = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "9.0.69" }]);
        assert.ok(!("error" in minor));
        assert.deepStrictEqual([minor.to, minor.risk], ["2.7.5", "medium"], "skips milestones and release candidates");
        assert.ok(minor.notes.some(n => /release notes from 2\.6\.6 to 2\.7\.5/.test(n)));
        const major = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "10.0.0" }]);
        assert.ok(!("error" in major));
        assert.deepStrictEqual([major.to, major.risk], ["3.0.0", "high"]);
        assert.ok(major.notes.some(n => /Java 17/.test(n) && /jakarta/.test(n)), "the Spring Boot 3 migration is called out");
        const crossBranch = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "9.0.70" }]);
        assert.match(crossBranch.error, /No published/, "Tomcat 10.1.1 is not assumed fixed just because it sorts after 9.0.70");
        const asked = [];
        const verified = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "9.0.70", ids: ["GHSA-x"] }], { isFixed: async (_t, version) => { asked.push(version); return version === "10.1.1"; } });
        assert.ok(!("error" in verified) && verified.to === "3.0.0", "OSV's answer for the exact version decides");
        assert.ok(asked.includes("10.1.1"));
        const shared = (0, bom_1.newBomCache)();
        await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "9.0.62" }], { cache: shared });
        const loadsAfterFirst = shared.loads;
        await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: osv_maven_unit_1.SPRING, artifactId: "spring-core", fixedIn: "5.3.19" }], { cache: shared });
        assert.strictEqual(shared.loads, loadsAfterFirst, "a second search reuses the BOM versions already loaded");
        const none = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "11.0.0" }]);
        assert.match(none.error, /No published spring-boot-dependencies release manages fixed versions/);
        const budget = await (0, bom_1.findBomUpgrade)(repository, bom, [{ groupId: "org.apache.tomcat.embed", artifactId: "tomcat-embed-core", fixedIn: "11.0.0" }], { maxLoads: 1 });
        assert.match(budget.error, /within 1 BOM versions checked/);
        assert.ok(requests.some(u => u.endsWith("spring-boot-dependencies/maven-metadata.xml")));
        const offline = await (0, bom_1.findBomUpgrade)((0, osv_maven_unit_1.fixtureRepository)(bootReleases(), { failRemote: true }).repository, bom, [{ groupId: "a", artifactId: "b", fixedIn: "1" }]);
        assert.match(offline.error, /could not be read/);
    });
});
(0, run_unit_tests_1.suite)("sca: projects", () => {
    const files = () => [
        ...(0, osv_maven_unit_1.springWorkspace)(),
        { path: "web/package.json", text: JSON.stringify({ name: "storefront", dependencies: { lodash: "^4.17.15" } }) },
        { path: "web/package-lock.json", text: JSON.stringify({ name: "storefront", lockfileVersion: 3, packages: { "": { dependencies: { lodash: "^4.17.15" } }, "node_modules/lodash": { version: "4.17.15" } } }) },
        { path: "web/packages/ui/package.json", text: JSON.stringify({ name: "ui", dependencies: { react: "18.2.0" } }) },
        { path: "billing/settings.gradle", text: "rootProject.name = 'billing'\ninclude 'api'\n" },
        { path: "billing/build.gradle", text: "plugins { id 'org.springframework.boot' version '3.1.5' }\n" },
        { path: "billing/api/build.gradle", text: "dependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }\n" },
        { path: "tools/requirements.txt", text: "requests==2.25.0\n" }
    ];
    (0, run_unit_tests_1.test)("groups a Maven reactor, a Gradle build and an npm workspace into one project each, with Spring Boot detected", () => {
        const projects = (0, projects_1.detectProjects)(files(), "repo");
        assert.deepStrictEqual(projects.map(p => [p.dir, p.name, p.ecosystems.join(","), p.springBoot ?? "", p.modules]), [
            ["", "shop", "Maven", "2.6.6", 3],
            ["billing", "billing", "Maven", "3.1.5", 2],
            ["tools", "tools", "PyPI", "", 0],
            ["web", "storefront", "npm", "", 0]
        ]);
        const keys = (0, projects_1.projectKeyOf)(files());
        assert.strictEqual(keys.get("app/pom.xml"), "", "a module belongs to its reactor");
        assert.strictEqual(keys.get("web/packages/ui/package.json"), "web", "a workspace package belongs to the folder of its lockfile");
        assert.strictEqual(keys.get("billing/api/build.gradle"), "billing");
    });
    (0, run_unit_tests_1.test)("selecting projects keeps their files and every parent POM as unscanned context", () => {
        const chosen = (0, projects_1.filesForProjects)(files(), ["web"]);
        assert.deepStrictEqual(chosen.filter(f => !f.context).map(f => f.path).sort(), ["web/package-lock.json", "web/package.json", "web/packages/ui/package.json"]);
        assert.ok(chosen.filter(f => f.context).every(f => f.path.endsWith("pom.xml")), "POMs outside the selection stay as context only");
        assert.deepStrictEqual((0, projects_1.filesForProjects)(files(), [""]).filter(f => !f.context).map(f => f.path).sort(), ["app/pom.xml", "common/pom.xml", "pom.xml"]);
    });
    (0, run_unit_tests_1.test)("Spring Boot versions come from the starter parent, a BOM import with a property, or the Gradle plugin", () => {
        const texts = new Map([
            ["a/pom.xml", "<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>2.7.18</version></parent></project>"],
            ["b/pom.xml", "<project><properties><boot.v>3.2.0</boot.v></properties><dependencyManagement><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>${boot.v}</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement></project>"],
            ["c/build.gradle.kts", `plugins { id("org.springframework.boot") version "3.3.1" }`],
            ["d/pom.xml", "<project><parent><artifactId>spring-boot-starter-parent</artifactId><version>${revision}</version></parent></project>"]
        ]);
        assert.strictEqual((0, projects_1.springBootVersion)(["a/pom.xml"], texts), "2.7.18");
        assert.strictEqual((0, projects_1.springBootVersion)(["b/pom.xml"], texts), "3.2.0");
        assert.strictEqual((0, projects_1.springBootVersion)(["c/build.gradle.kts"], texts), "3.3.1");
        assert.strictEqual((0, projects_1.springBootVersion)(["d/pom.xml"], texts), undefined, "an unresolved expression is not reported as a version");
    });
});
/* ------------------------------------------------------------------ *
 * The SCA engine on a Spring Boot project
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("sca: Spring Boot analysis end to end (mocked OSV, KEV, NVD, registries, Maven repository)", () => {
    (0, run_unit_tests_1.test)("the shared engine's findings are kept exactly, enriched with KEV and NVD, and classified", async () => {
        const { scan } = await springScan();
        const { result, calls } = await analysedSpring();
        assert.strictEqual(result.scan.findings.length, scan.findings.length);
        assert.deepStrictEqual(result.vulnerabilities.map(v => v.key).sort(), scan.findings.map(f => f.key).sort(), "no finding added or dropped by the SCA layer");
        assert.strictEqual(result.status, "complete");
        const exploited = result.vulnerabilities.filter(v => v.kev).map(v => v.finding.packageName).sort();
        assert.deepStrictEqual(exploited, [`${osv_maven_unit_1.SPRING}:spring-core`, `${osv_maven_unit_1.SPRING}:spring-webmvc`], "Spring4Shell (CVE-2022-22965) is in the KEV catalog");
        assert.strictEqual(result.vulnerabilities[0].kev?.cveId, "CVE-2022-22965", "known exploited first");
        const h2 = result.vulnerabilities.find(v => v.finding.packageName === "com.h2database:h2");
        assert.deepStrictEqual([h2.severity, h2.cvssScore, h2.finding.severity], ["critical", 9.8, "unknown"], "NVD fills in a missing severity; the OSV finding is untouched");
        assert.match(h2.severitySource, /NVD, CVSS 3\.1 base score 9\.8 \(NVD's own analysis\); OSV published no severity/);
        const tomcat = result.vulnerabilities.find(v => v.finding.id === "GHSA-tom1-0000-0001");
        assert.deepStrictEqual([tomcat.relation, tomcat.cves, tomcat.ghsas, tomcat.class], ["transitive", ["CVE-2022-0001"], ["GHSA-tom1-0000-0001"], "confirmed"]);
        assert.deepStrictEqual(tomcat.paths[0], [`${osv_maven_unit_1.BOOT}:spring-boot-starter-web:2.6.6`, `${osv_maven_unit_1.BOOT}:spring-boot-starter-tomcat:2.6.6`], "the real path from the resolved tree, from the direct dependency down");
        assert.deepStrictEqual(tomcat.locations, [{ file: "app/pom.xml" }], "a transitive dependency has no line of its own: none is invented");
        assert.strictEqual(tomcat.managedBy?.property, "tomcat.version");
        assert.strictEqual(calls.nvd, 1, "only unscored CVEs go to NVD");
        const s = result.summary;
        assert.strictEqual(s.critical + s.high + s.medium + s.low + s.unknown, result.vulnerabilities.filter(v => v.class !== "informational").length);
        assert.deepStrictEqual([s.exploited, s.vulnerableDependencies, s.dependencies], [2, 5, scan.summary.packages]);
        assert.strictEqual(s.direct + s.transitive + s.unknownRelation, s.dependencies);
        assert.deepStrictEqual(result.providers.map(p => [p.id, p.status]), [["osv", "ok"], ["maven", "ok"], ["kev", "ok"], ["nvd", "ok"], ["registries", "ok"]]);
    });
    (0, run_unit_tests_1.test)("health findings are separate from vulnerabilities, and outdated is only informational", async () => {
        const { result } = await analysedSpring();
        const kinds = result.health.map(h => `${h.packageName.split(":")[1]}:${h.kind}:${h.class}`).sort();
        assert.deepStrictEqual(kinds, ["commons-text:deprecated:risk", "h2:outdated:informational"]);
        const outdated = result.health.find(h => h.kind === "outdated");
        assert.deepStrictEqual([outdated.level, outdated.latest], ["major", "2.2.224"]);
        assert.ok(!result.vulnerabilities.some(v => v.finding.packageName.endsWith("commons-text")), "deprecated is never reported as vulnerable");
        assert.deepStrictEqual([result.summary.outdated, result.summary.maintenanceRisks, result.summary.informational], [1, 1, 2]);
    });
    (0, run_unit_tests_1.test)("remediation follows what controls each version: the Boot parent, its property, or a nested BOM", async () => {
        const { result, calls } = await analysedSpring();
        const advice = (name) => result.advice.find(a => a.packageName.endsWith(`:${name}`));
        const tomcat = advice("tomcat-embed-core");
        assert.strictEqual(tomcat.target, "9.0.69", "lowest version fixing both Tomcat advisories");
        assert.match(tomcat.controlledBy, /parent POM org\.springframework\.boot:spring-boot-dependencies:2\.6\.6 through the property tomcat\.version/);
        assert.deepStrictEqual(tomcat.options.map(o => [o.id.split("::").pop(), o.risk, o.edit?.op, o.edit?.file]), [
            ["bom", "medium", "pom-parent", "pom.xml"],
            ["property", "medium", "pom-property", "pom.xml"]
        ]);
        assert.strictEqual(tomcat.options[0].title, "Upgrade Spring Boot 2.6.6 → 2.7.5", "the lowest Boot release whose Tomcat is fixed");
        assert.match(tomcat.options[0].detail, /also fixes the other 3 vulnerable artifacts/);
        assert.deepStrictEqual(tomcat.options[1].edit, { op: "pom-property", file: "pom.xml", property: "tomcat.version", value: "9.0.69" });
        assert.match(tomcat.options[1].editSummary, /Set the property tomcat\.version to 9\.0\.69 in pom\.xml/);
        const core = advice("spring-core");
        assert.deepStrictEqual(core.options.map(o => o.id.split("::").pop()), ["bom", "bom-property"], "no lone pin that would split Spring Framework versions");
        assert.deepStrictEqual([core.options[0].title, core.options[0].risk], ["Upgrade Spring Boot 2.6.6 → 2.6.7", "low"], "each package gets its own lowest fixing release");
        assert.match(core.options[0].detail, /Spring Boot 2\.7\.5 \(medium risk\) is the lowest release that fixes every vulnerable artifact it manages here \(4\)/);
        assert.deepStrictEqual(core.options[1].edit, { op: "pom-property", file: "pom.xml", property: "spring-framework.version", value: "5.3.19" });
        assert.strictEqual(core.options[1].risk, "low");
        const yaml = advice("snakeyaml");
        assert.strictEqual(yaml.options.find(o => o.id.endsWith("::property"))?.edit?.file, "pom.xml", "the module's reactor root, where the Boot parent is declared");
        const h2 = advice("h2");
        assert.strictEqual(h2.target, undefined);
        assert.ok(h2.notes.some(n => /No fixed version has been published/.test(n)));
        assert.strictEqual(calls.bom, 8, "per BOM: all its vulnerable artifacts together, then each one (spring-boot-dependencies 1 + 4, spring-framework-bom 1 + 2)");
        // Every proposed edit applies cleanly to the workspace files.
        const texts = new Map((0, osv_maven_unit_1.springWorkspace)().map(f => [f.path, f.text]));
        for (const option of result.advice.flatMap(a => a.options)) {
            if (!option.edit)
                continue;
            const out = (0, edits_1.applyEdit)(option.edit, texts.get(option.edit.file));
            assert.ok("text" in out, `${option.id}: ${"error" in out ? out.error : ""}`);
        }
    });
    (0, run_unit_tests_1.test)("artifacts sharing a property get one value, at the risk of the biggest move", async () => {
        // A Spring MVC advisory fixed only in 6.0.2: overriding spring-framework.version must take every Spring artifact to 6.
        const major = { record: { id: "GHSA-mvc6-0000-0006", modified: "1", summary: "Fixed only in Spring 6", database_specific: { severity: "HIGH" }, affected: [(0, osv_maven_unit_1.range)("org.springframework:spring-webmvc", "0", "6.0.2")] }, hits: [{ name: "org.springframework:spring-webmvc", versions: ["5.3.18"] }] };
        const { result } = await analysedSpring({}, [...SCA_ADVISORIES, major]);
        const options = result.advice.filter(a => /spring-(core|webmvc)$/.test(a.packageName)).map(a => a.options.find(o => o.id.endsWith("::bom-property")));
        assert.deepStrictEqual(options.map(o => [o.edit.value, o.risk]), [["6.0.2", "high"], ["6.0.2", "high"]]);
        assert.ok(options.some(o => /new major version for spring-core/.test(o.detail)));
        const core = result.advice.find(a => a.packageName.endsWith(":spring-core"));
        assert.strictEqual(core.options[0].title, "Upgrade Spring Boot 2.6.6 → 2.6.7", "the Boot upgrade for spring-core alone is still the low-risk patch");
    });
    (0, run_unit_tests_1.test)("an unavailable provider makes the result incomplete instead of silently clean", async () => {
        const { result } = await analysedSpring({ kev: async () => ({ status: "unavailable", message: "The CISA KEV catalog could not be downloaded (offline)." }) });
        assert.strictEqual(result.status, "incomplete");
        assert.ok(result.limitations.some(l => /Known exploitation could not be checked/.test(l)));
        assert.ok(!result.vulnerabilities.some(v => v.kev));
        const off = await analysedSpring({ kev: undefined, nvd: undefined, health: undefined, healthScope: "off", bomUpgrade: undefined });
        assert.strictEqual(off.result.status, "complete", "providers turned off by settings do not degrade the result");
        assert.deepStrictEqual(off.result.providers.filter(p => ["kev", "nvd", "registries"].includes(p.id)).map(p => p.status), ["off", "off", "off"]);
        const h2 = off.result.vulnerabilities.find(v => v.finding.packageName === "com.h2database:h2");
        assert.strictEqual(h2.severity, "unknown", "no score is invented without NVD");
        assert.ok(off.result.advice.every(a => a.options.every(o => !o.id.endsWith("::bom"))), "no BOM upgrade without the search");
    });
    (0, run_unit_tests_1.test)("a failing advisory query or a cancelled scan carries through as incomplete or cancelled", async () => {
        const { repository } = (0, osv_maven_unit_1.fixtureRepository)(bootReleases());
        const scan = await (0, scan_1.runScan)((0, osv_maven_unit_1.springWorkspace)(), (0, osv_maven_unit_1.scanOptions)((0, osv_maven_unit_1.fakeOsv)(SCA_ADVISORIES, { failBatchesWith: "org.yaml:snakeyaml" }).fetch, { repository, repositoryLabel: "fixture" }));
        const result = await (0, engine_1.analyseScan)(scan, providers(repository), { projects: [], texts: new Map(), toolVersion: "t", startedAt: Date.now() });
        assert.strictEqual(scan.status === "complete" ? "complete" : "incomplete", result.status);
        const controller = new AbortController();
        controller.abort();
        const cancelledScan = await (0, scan_1.runScan)((0, osv_maven_unit_1.springWorkspace)(), (0, osv_maven_unit_1.scanOptions)((0, osv_maven_unit_1.fakeOsv)(SCA_ADVISORIES).fetch, { repository, repositoryLabel: "fixture" }, { signal: controller.signal }));
        const p = providers(repository);
        const cancelled = await (0, engine_1.analyseScan)(cancelledScan, p, { projects: [], texts: new Map(), toolVersion: "t", startedAt: Date.now(), signal: controller.signal });
        assert.strictEqual(cancelled.status, "cancelled");
        assert.deepStrictEqual([p.calls.kev, p.calls.nvd, p.calls.health, p.calls.bom], [0, 0, 0, 0], "nothing more is requested after cancellation");
    });
    (0, run_unit_tests_1.test)("npm: a direct dependency gets a version edit, a transitive one an override", async () => {
        const files = [
            { path: "package.json", text: JSON.stringify({ name: "web", dependencies: { lodash: "^4.17.15", mkdirp: "0.5.1" } }, null, 2) + "\n" },
            { path: "package-lock.json", text: JSON.stringify({ name: "web", lockfileVersion: 3, packages: {
                        "": { dependencies: { lodash: "^4.17.15", mkdirp: "0.5.1" } },
                        "node_modules/lodash": { version: "4.17.15" },
                        "node_modules/mkdirp": { version: "0.5.1", dependencies: { minimist: "0.0.8" } },
                        "node_modules/minimist": { version: "0.0.8" }
                    } }) }
        ];
        const advisories = [
            { record: { id: "GHSA-p6mc-m468-83gw", modified: "1", aliases: ["CVE-2020-8203"], database_specific: { severity: "HIGH" }, affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.19" }] }] }] }, hits: [{ name: "lodash", versions: ["4.17.15"] }] },
            { record: { id: "GHSA-xvch-5gv4-984h", modified: "1", aliases: ["CVE-2021-44906"], database_specific: { severity: "CRITICAL" }, affected: [{ package: { name: "minimist", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.2.4" }] }] }] }, hits: [{ name: "minimist", versions: ["0.0.8"] }] }
        ];
        const { repository } = (0, osv_maven_unit_1.fixtureRepository)();
        const scan = await (0, scan_1.runScan)(files, (0, osv_maven_unit_1.scanOptions)((0, osv_maven_unit_1.fakeOsv)(advisories).fetch, { repository, repositoryLabel: "fixture" }));
        const result = await (0, engine_1.analyseScan)(scan, { healthScope: "off" }, { projects: (0, projects_1.detectProjects)(files), texts: new Map(files.map(f => [f.path, f.text])), toolVersion: "t", startedAt: Date.now() });
        const lodash = result.advice.find(a => a.packageName === "lodash");
        assert.deepStrictEqual(lodash.options[0].edit, { op: "npm-dependency", file: "package.json", name: "lodash", version: "4.17.19" });
        const minimist = result.advice.find(a => a.packageName === "minimist");
        assert.deepStrictEqual(minimist.options.find(o => o.edit)?.edit, { op: "npm-override", file: "package.json", manager: "npm", name: "minimist", version: "0.2.4" });
        assert.match(minimist.controlledBy, /Brought in by mkdirp/);
        assert.ok(minimist.options.some(o => o.commands?.length), "the package manager's own command is offered too");
        for (const option of result.advice.flatMap(a => a.options))
            if (option.edit)
                assert.ok("text" in (0, edits_1.applyEdit)(option.edit, files[0].text), option.id);
    });
});
(0, run_unit_tests_1.suite)("sca: npm dependency paths", () => {
    (0, run_unit_tests_1.test)("paths follow Node's resolution: nested node_modules first, then ancestors, through workspace links", () => {
        const lock = {
            name: "mono", lockfileVersion: 3,
            packages: {
                "": { workspaces: ["packages/*"], dependencies: { express: "^4.17.0" } },
                "packages/ui": { name: "ui", dependencies: { "react-scripts": "5.0.0" } },
                "node_modules/ui": { resolved: "packages/ui", link: true },
                "node_modules/express": { version: "4.17.1", dependencies: { qs: "6.7.0", "body-parser": "1.19.0" } },
                "node_modules/body-parser": { version: "1.19.0", dependencies: { qs: "6.7.0" } },
                "node_modules/qs": { version: "6.7.0" },
                "node_modules/react-scripts": { version: "5.0.0", dependencies: { "loader-utils": "^1.0.0" } },
                "node_modules/react-scripts/node_modules/loader-utils": { version: "1.4.0", dependencies: { json5: "^1.0.1" } },
                "node_modules/loader-utils": { version: "2.0.0" },
                "node_modules/json5": { version: "1.0.1" },
                "node_modules/orphan": { version: "1.0.0" }
            }
        };
        const parsed = (0, parsers_1.parseDependencyFile)("package-lock.json", JSON.stringify(lock, null, 2));
        const via = (name, version) => parsed.dependencies.find(d => d.name === name && d.version === version)?.via;
        assert.strictEqual(via("express", "4.17.1"), undefined, "a direct dependency has no path above it");
        assert.deepStrictEqual(via("qs", "6.7.0"), ["express@4.17.1"], "the shortest path");
        assert.deepStrictEqual(via("loader-utils", "1.4.0"), ["react-scripts@5.0.0"], "the nested copy belongs to react-scripts");
        assert.deepStrictEqual(via("json5", "1.0.1"), ["react-scripts@5.0.0", "loader-utils@1.4.0"], "resolved upwards from the nested copy");
        assert.strictEqual(via("loader-utils", "2.0.0"), undefined, "nothing depends on the hoisted copy: no path is invented");
        assert.strictEqual(via("orphan", "1.0.0"), undefined);
        assert.ok(parsed.dependencies.every(d => !("installPath" in d)), "internal bookkeeping does not leak into results");
    });
});
/* ------------------------------------------------------------------ *
 * Webview model, exports and page
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("sca: webview model, CSV export and page", () => {
    (0, run_unit_tests_1.test)("filters by severity, ecosystem, relation, class, KEV, scope, project and text (package, CVE, GHSA)", async () => {
        const { result } = await analysedSpring();
        const list = result.vulnerabilities;
        const f = (filters) => Model.filterVulnerabilities(list, filters).map((v) => v.finding.id);
        assert.strictEqual(f({}).length, list.length);
        assert.deepStrictEqual(f({ kev: true }).sort(), ["GHSA-sp4s-0000-0003", "GHSA-sp4s-0000-0003"]);
        assert.deepStrictEqual(f({ q: "cve-2022-0001" }), ["GHSA-tom1-0000-0001"], "CVE search, any case");
        assert.deepStrictEqual(f({ q: "GHSA-snak" }), ["GHSA-snak-0000-0005"]);
        assert.deepStrictEqual(f({ q: "tomcat smuggling" }), ["GHSA-tom1-0000-0001"], "every term must match");
        assert.deepStrictEqual(f({ sev: ["medium"] }), ["GHSA-snak-0000-0005"]);
        assert.ok(f({ relation: "direct" }).includes("OSV-h2-0000-0004") && !f({ relation: "direct" }).includes("GHSA-tom1-0000-0001"));
        assert.deepStrictEqual(f({ eco: "npm" }), []);
        assert.deepStrictEqual(f({ cls: "potential" }), []);
        assert.deepStrictEqual(f({ dev: "development" }), []);
        assert.strictEqual(f({ project: "nope" }).length, 0);
    });
    (0, run_unit_tests_1.test)("sorts and groups deterministically, and counts like the summary cards", async () => {
        const { result } = await analysedSpring();
        const bySev = Model.sortVulnerabilities(result.vulnerabilities, "severity");
        assert.ok(bySev[0].kev && bySev[1].kev, "exploited first");
        const byCvss = Model.sortVulnerabilities(result.vulnerabilities, "cvss");
        for (let i = 1; i < byCvss.length; i++)
            assert.ok((byCvss[i - 1].cvssScore ?? -1) >= (byCvss[i].cvssScore ?? -1));
        const byPkg = Model.sortVulnerabilities(result.vulnerabilities, "package").map((v) => v.finding.packageName);
        assert.deepStrictEqual(byPkg, [...byPkg].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
        assert.notStrictEqual(Model.sortVulnerabilities(result.vulnerabilities, "severity"), result.vulnerabilities, "a copy, never the host's array");
        const groups = Model.groupVulnerabilities(bySev, "severity");
        assert.deepStrictEqual(groups.map((g) => g.key), ["critical", "high", "medium"]);
        assert.strictEqual(Model.groupVulnerabilities(bySev, "package").length, result.summary.vulnerableDependencies);
        const counts = Model.countBySeverity(result.vulnerabilities);
        for (const sev of ["critical", "high", "medium", "low", "unknown"])
            assert.strictEqual(counts[sev], result.summary[sev], sev);
        assert.strictEqual(counts.exploited, result.summary.exploited);
        assert.deepStrictEqual(Model.facets(result).ecosystems, ["Maven"]);
        const deps = Model.filterPackages(result.scan.packages, { status: "vulnerable" });
        assert.strictEqual(deps.length, result.summary.vulnerableDependencies);
        assert.strictEqual(Model.filterPackages(result.scan.packages, { relation: "transitive" }).length, result.summary.transitive);
        const health = Model.filterHealth(result.health, { kind: "risks" });
        assert.deepStrictEqual(health.map((h) => h.kind), ["deprecated"]);
        assert.strictEqual(Model.pathLabel(["a", "b"], "c"), "a > b > c");
    });
    (0, run_unit_tests_1.test)("CSV has one row per vulnerability and health finding, with spreadsheet formulas neutralised", async () => {
        const { result } = await analysedSpring();
        const csv = (0, report_1.scaCsv)(result);
        const lines = csv.trim().split("\r\n");
        assert.strictEqual(lines[0], report_1.CSV_COLUMNS.join(","));
        assert.strictEqual(lines.length, 1 + result.vulnerabilities.length + result.health.length);
        assert.ok(lines.some(l => l.startsWith("vulnerability,critical,confirmed,") && l.includes("yes (added 2022-04-04)")));
        assert.ok(lines.some(l => l.startsWith("health:outdated,informational,informational")));
        assert.strictEqual((0, report_1.csvCell)("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert.strictEqual((0, report_1.csvCell)("+1"), "'+1");
        assert.strictEqual((0, report_1.csvCell)("a,b"), "\"a,b\"");
        assert.strictEqual((0, report_1.csvCell)(undefined), "");
    });
    (0, run_unit_tests_1.test)("the page has a strict CSP, loads the model before the UI, and the UI never parses HTML", () => {
        const html = (0, page_1.renderScaPage)({ cspSource: "vscode-resource:", modelUri: "vscode-resource:/media/sca-model.js", scriptUri: "vscode-resource:/media/sca-scanner.js", codiconsUri: "c.css" });
        assert.match(html, /default-src 'none'/);
        assert.ok(html.indexOf("sca-model.js") < html.indexOf("sca-scanner.js"));
        assert.ok(!/ on\w+=/.test(html), "no inline handlers");
        const script = fs.readFileSync(path.resolve(__dirname, "../../../media/sca-scanner.js"), "utf8");
        assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(script));
        const posted = new Set([...script.matchAll(/post\(\{ type: "(\w+)"/g)].map(m => m[1]));
        const handled = new Set([...fs.readFileSync(path.resolve(__dirname, "../../../src/sca/panel.ts"), "utf8").matchAll(/case "(\w+)":/g)].map(m => m[1]));
        for (const type of posted)
            assert.ok(handled.has(type), `the host handles "${type}"`);
    });
});
//# sourceMappingURL=sca.unit.js.map