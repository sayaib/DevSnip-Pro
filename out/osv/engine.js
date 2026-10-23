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
exports.runEngineScan = exports.clearMemoryCache = exports.saveCache = exports.loadCache = exports.toolVersion = exports.scanLog = void 0;
const vscode = __importStar(require("vscode"));
const client_1 = require("./client");
const index_1 = require("./gradle/index");
const host_1 = require("./maven/host");
const index_2 = require("./maven/index");
const parsers_1 = require("./parsers");
const scan_1 = require("./scan");
/**
 * The one vulnerability engine, as the extension host runs it: the advisory
 * cache, the log channel, Maven and Gradle resolution behind the build-tool
 * gate, and runScan. The OSV Vulnerability Scanner and the SCA Scanner both
 * scan through here, so they always agree on dependencies and advisories.
 */
const CACHE_FILE = "osv-cache.json";
let cache;
let cacheLoad;
let logChannel;
/** "DevSnip Pro: OSV Scanner" in the Output panel: what each scan found, queried and dropped, stage by stage. */
function scanLog() {
    logChannel ?? (logChannel = vscode.window.createOutputChannel("DevSnip Pro: OSV Scanner", { log: true }));
    return logChannel;
}
exports.scanLog = scanLog;
function toolVersion(context) {
    return String(context.extension?.packageJSON?.version ?? "dev");
}
exports.toolVersion = toolVersion;
async function loadCache(context) {
    if (cache)
        return cache;
    cacheLoad ?? (cacheLoad = (async () => {
        const fresh = new client_1.OsvCache(2000);
        try {
            if (context.globalStorageUri) {
                const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE));
                fresh.load(JSON.parse(Buffer.from(bytes).toString("utf8")));
            }
        }
        catch { /* first run, or an unreadable cache: start empty */ }
        cache = fresh;
        return fresh;
    })());
    return cacheLoad;
}
exports.loadCache = loadCache;
async function saveCache(context) {
    if (!cache?.dirty || !context.globalStorageUri)
        return;
    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE), Buffer.from(JSON.stringify(cache.toJSON()), "utf8"));
        cache.dirty = false;
    }
    catch (error) {
        console.warn("DevSnip Pro: could not save the OSV cache.", error);
    }
}
exports.saveCache = saveCache;
/** Clears the in-memory advisory cache (tests and the "Clear cached advisories" action). */
function clearMemoryCache() {
    cache?.clear();
}
exports.clearMemoryCache = clearMemoryCache;
/** Runs one scan through the shared engine. */
async function runEngineScan(request) {
    const { context, discovery } = request;
    const files = discovery.files;
    const store = await loadCache(context);
    const client = new client_1.OsvClient({ userAgent: `DevSnip-Pro/${toolVersion(context)} (VS Code ${vscode.version}; ${request.title})` });
    const log = scanLog();
    log.info(`---- ${request.title} of ${request.label} (DevSnip Pro ${toolVersion(context)}) ----`);
    const pomPaths = files.filter(f => (0, parsers_1.detectFileType)(f.path)?.id === "pom").map(f => f.path);
    const allowBuildTools = (0, host_1.buildToolGate)(context, message => log.info(message));
    const result = await (0, scan_1.runScan)(files, {
        onLog: message => log.info(message),
        resolveMaven: async (poms, signal) => {
            const strategy = await (0, host_1.createMavenStrategy)({ context, allowBuildTools, locations: discovery.locations, pomPaths, onLog: message => log.info(message) });
            return (0, index_2.resolveMavenProjects)(poms, strategy, { signal, onLog: message => log.info(message), onProgress: message => request.onProgress({ phase: "parse", message, fraction: 0.08 }) });
        },
        resolveGradle: async (gradleFiles, signal) => {
            const buildFiles = gradleFiles.filter(f => !f.context && /build\.gradle(\.kts)?$/.test(f.path)).map(f => f.path);
            const strategy = await (0, host_1.createGradleStrategy)({ context, allowBuildTools, locations: discovery.locations, buildFiles, onLog: message => log.info(message) });
            return (0, index_1.resolveGradleProjects)(gradleFiles, strategy, { signal, onLog: message => log.info(message), onProgress: message => request.onProgress({ phase: "parse", message, fraction: 0.09 }) });
        },
        client, cache: store, signal: request.signal, fresh: request.fresh, toolVersion: toolVersion(context),
        workspace: request.workspace,
        source: request.source,
        limitations: discovery.limitations,
        unsupported: discovery.unsupported,
        onProgress: request.onProgress
    });
    void saveCache(context);
    return { result, client };
}
exports.runEngineScan = runEngineScan;
//# sourceMappingURL=engine.js.map