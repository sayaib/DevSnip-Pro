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
exports.createScaProviders = exports.osvIsFixed = exports.userAgent = exports.clearScaCaches = exports.saveScaCaches = exports.httpGet = exports.scaSettings = exports.NVD_KEY_SECRET = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const host_1 = require("../osv/maven/host");
const bom_1 = require("./bom");
const kev_1 = require("./providers/kev");
const nvd_1 = require("./providers/nvd");
const registry_1 = require("./providers/registry");
/**
 * The SCA Scanner's providers as the extension host runs them: HTTP with a
 * User-Agent, timeouts and retries; caches in global storage; settings under
 * `devsnip.sca`; and the optional NVD API key in VS Code's secret storage.
 *
 * What leaves the machine: package names and versions (registries), CVE ids
 * (NVD), and nothing for KEV (the whole catalog is downloaded and matched
 * locally). No file contents, paths or project names.
 */
exports.NVD_KEY_SECRET = "devsnip.sca.nvdApiKey";
function scaSettings() {
    const config = vscode.workspace.getConfiguration("devsnip.sca");
    const health = config.get("healthChecks", "direct");
    return {
        healthChecks: health === "all" || health === "off" ? health : "direct",
        knownExploited: config.get("knownExploited", true) !== false,
        nvdEnrichment: config.get("nvdEnrichment", true) !== false,
        remediationSearch: config.get("bomUpgradeSearch", true) !== false
    };
}
exports.scaSettings = scaSettings;
/** GET with a timeout and up to three attempts on network errors and 5xx (429 is left to the caller's rate handling). */
async function httpGet(url, headers, signal, timeoutMs = 20000) {
    const fetchImpl = globalThis.fetch;
    if (!fetchImpl)
        throw new Error("fetch is not available");
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted)
            throw new Error("cancelled");
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, { headers, signal: controller.signal });
            const text = response.status === 200 ? await response.text() : "";
            if (response.status >= 500)
                lastError = new Error(`HTTP ${response.status}`);
            else
                return { status: response.status, text };
        }
        catch (error) {
            lastError = signal?.aborted ? new Error("cancelled") : error;
            if (signal?.aborted)
                break;
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        }
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
exports.httpGet = httpGet;
const asJson = (response) => ({ status: response.status, json: async () => JSON.parse(response.text) });
/** A small JSON map in global storage, loaded once and written back after each scan. */
class JsonStore {
    constructor(file, limit) {
        this.file = file;
        this.limit = limit;
        this.dirty = false;
    }
    async load() {
        if (this.data)
            return this.data;
        try {
            this.data = this.file ? JSON.parse(await fs.promises.readFile(this.file, "utf8")) : {};
        }
        catch {
            this.data = {};
        }
        if (!this.data || typeof this.data !== "object")
            this.data = {};
        return this.data;
    }
    async get(key) { return (await this.load())[key]; }
    async set(key, value) {
        const data = await this.load();
        delete data[key];
        data[key] = value;
        const keys = Object.keys(data);
        for (const old of keys.slice(0, Math.max(0, keys.length - this.limit)))
            delete data[old];
        this.dirty = true;
    }
    async save() {
        if (!this.dirty || !this.file || !this.data)
            return;
        try {
            await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
            await fs.promises.writeFile(this.file, JSON.stringify(this.data), "utf8");
            this.dirty = false;
        }
        catch { /* caches are an optimisation */ }
    }
    clear() { this.data = {}; this.dirty = true; }
}
let stores;
function storesFor(context) {
    const dir = context.globalStorageUri?.fsPath ? path.join(context.globalStorageUri.fsPath, "sca") : undefined;
    if (!stores || stores.dir !== dir) {
        stores = {
            dir,
            nvd: new JsonStore(dir && path.join(dir, "nvd.json"), 5000),
            health: new JsonStore(dir && path.join(dir, "registry-health.json"), 20000)
        };
    }
    return stores;
}
function kevStore(context) {
    const dir = context.globalStorageUri?.fsPath;
    if (!dir)
        return undefined;
    const file = path.join(dir, "sca", "kev.json");
    return {
        async read() { try {
            return JSON.parse(await fs.promises.readFile(file, "utf8"));
        }
        catch {
            return undefined;
        } },
        async write(value) {
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.writeFile(file, JSON.stringify(value), "utf8");
        }
    };
}
async function saveScaCaches(context) {
    const s = storesFor(context);
    await Promise.all([s.nvd.save(), s.health.save()]);
}
exports.saveScaCaches = saveScaCaches;
/** Clears the NVD, registry and KEV caches. */
async function clearScaCaches(context) {
    const s = storesFor(context);
    s.nvd.clear();
    s.health.clear();
    await saveScaCaches(context);
    if (s.dir)
        await fs.promises.rm(path.join(s.dir, "kev.json"), { force: true }).catch(() => undefined);
}
exports.clearScaCaches = clearScaCaches;
function userAgent(context) {
    return `DevSnip-Pro/${String(context.extension?.packageJSON?.version ?? "dev")} (VS Code ${vscode.version}; SCA Scanner)`;
}
exports.userAgent = userAgent;
/** At most this many BOM versions are examined per scan, over every BOM search (each is one POM, or a few with a nested BOM). */
const MAX_BOM_LOADS = 150;
/**
 * "Is this version of the artifact free of its advisories?", answered by OSV
 * for the exact version, so a newer release branch (Tomcat 10.1 for a 9.0 fix)
 * is judged by its own ranges. Answers are cached for the scan.
 */
function osvIsFixed(client) {
    const answers = new Map();
    return async (target, version, signal) => {
        if (!target.ids?.length)
            return undefined;
        const key = `${target.groupId}:${target.artifactId}@${version}`;
        let answer = answers.get(key);
        if (!answer) {
            answer = client.query({ package: { name: `${target.groupId}:${target.artifactId}`, ecosystem: "Maven" }, version }, signal)
                .then(refs => refs.map(r => r.id))
                .catch(() => undefined);
            answers.set(key, answer);
        }
        const ids = await answer;
        return ids ? !target.ids.some(id => ids.includes(id)) : undefined;
    };
}
exports.osvIsFixed = osvIsFixed;
/** The providers for one scan, from the current settings. `onLog` receives what each provider did; `client` verifies BOM candidates. */
async function createScaProviders(context, onLog, client) {
    const settings = scaSettings();
    const ua = userAgent(context);
    const s = storesFor(context);
    const nvdStore = { get: key => s.nvd.get(key), set: (key, value) => s.nvd.set(key, value) };
    const healthStore = { get: key => s.health.get(key), set: (key, value) => s.health.set(key, value) };
    let apiKey;
    try {
        apiKey = (await context.secrets?.get(exports.NVD_KEY_SECRET)) || undefined;
    }
    catch {
        apiKey = undefined;
    }
    const buildSettings = (0, host_1.buildToolSettings)();
    const bomSearch = () => {
        const { repository } = (0, host_1.createRepository)(context, buildSettings, onLog);
        const isFixed = client ? osvIsFixed(client) : undefined;
        const caches = new Map();
        const examined = () => [...caches.values()].reduce((n, c) => n + c.examined.size, 0);
        return async (bom, targets, signal) => {
            const key = `${bom.groupId}:${bom.artifactId}:${bom.version}`;
            const cache = caches.get(key) ?? (0, bom_1.newBomCache)();
            caches.set(key, cache);
            const budget = Math.min(24, MAX_BOM_LOADS - examined());
            if (budget <= 0)
                return { error: `The search stopped after examining ${MAX_BOM_LOADS} BOM versions in this scan.` };
            const result = await (0, bom_1.findBomUpgrade)(repository, bom, targets, { signal, isFixed, cache, maxLoads: budget });
            onLog(`Remediation: ${bom.artifactId} ${bom.version} for ${targets.map(t => `${t.artifactId} ≥ ${t.fixedIn}`).join(", ")} → ${"error" in result ? result.error : `${result.to} (${result.risk} risk, ${result.evaluated} new BOM versions examined)`}`);
            return result;
        };
    };
    return {
        healthScope: settings.healthChecks,
        kev: settings.knownExploited
            ? signal => (0, kev_1.loadKev)(async (url, sig) => asJson(await httpGet(url, { "User-Agent": ua, Accept: "application/json" }, sig, 60000)), kevStore(context), { signal })
            : undefined,
        nvd: settings.nvdEnrichment
            ? (cves, signal) => {
                onLog(`NVD: looking up ${cves.length} CVE${cves.length === 1 ? "" : "s"} without an OSV severity${apiKey ? " (with your API key)" : ""}.`);
                return (0, nvd_1.lookupNvd)(cves, async (url, headers, sig) => asJson(await httpGet(url, { "User-Agent": ua, Accept: "application/json", ...headers }, sig)), nvdStore, { apiKey, signal });
            }
            : undefined,
        health: settings.healthChecks !== "off"
            ? (requests, signal) => {
                onLog(`Registries: checking ${requests.length} package${requests.length === 1 ? "" : "s"} (latest release, deprecation, yanks).`);
                return (0, registry_1.checkHealth)(requests, (url, headers, sig) => httpGet(url, { "User-Agent": ua, ...headers }, sig), healthStore, { signal });
            }
            : undefined,
        // BOM versions and POMs come from the same repository (local ~/.m2 first, then Maven Central when allowed) as dependency resolution.
        bomUpgrade: settings.remediationSearch ? bomSearch() : undefined
    };
}
exports.createScaProviders = createScaProviders;
//# sourceMappingURL=host.js.map