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
exports.setAnalyticsClientForTests = exports.shutdownAnalytics = exports.initAnalytics = exports.trackToolUsed = exports.trackCommand = exports.toolSection = exports.analyticsId = exports.createPostHogTransport = exports.loadAnalyticsConfig = exports.classifyInstall = exports.snapshotInstall = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const client_1 = require("./client");
const commands_1 = require("../toolkits/commands");
const layout_1 = require("../toolkits/layout");
/**
 * DevSnip Pro's analytics: anonymous tool usage, sent to PostHog.
 *
 * Three events only (see ./client.ts and docs/ANALYTICS.md):
 *  - `extension_active` once per day, for unique, returning and per-country users
 *  - `tool_opened` when a tool's command runs (wired through the command registry)
 *  - `tool_used` when a tool produces a result (`trackToolUsed` at a few call sites)
 *
 * Nothing is sent unless ALL of these hold:
 *  - a PostHog project key was built into this package (see docs/ANALYTICS.md),
 *  - VS Code's `telemetry.telemetryLevel` is "all",
 *  - `devsnip.analytics.enabled` is true,
 *  - the extension is running as an installed extension (not F5 / tests).
 * They are re-checked live when settings change. Every function here is safe
 * to call at any time and never throws.
 */
const COMMAND_PREFIX = "sayaib.hue-console.";
/**
 * The random per-profile id earlier versions reported under. Still created and
 * kept: onboarding uses it, it is the fallback when VS Code has no machine id,
 * and it is merged once into the per-machine id (see analyticsId).
 */
const ID_KEY = "devsnip.analytics.anonymousId";
/** The previous id already merged into the per-machine id, so the merge is sent once. */
const MERGED_KEY = "devsnip.analytics.mergedId";
const VERSION_KEY = "devsnip.analytics.lastVersion";
const ACTIVE_DAY_KEY = "devsnip.analytics.lastActiveDay";
/** Undelivered events from the previous run (see shutdownAnalytics). */
const PENDING_FILE = "analytics-pending.json";
/** Left behind by earlier versions; removed on start. */
const OLD_FILES = ["analytics-checkpoint.json"];
const OLD_KEYS = ["devsnip.analytics.usedFeatures"];
const ENVIRONMENTS = ["production", "staging", "test", "development"];
const CONFIG_FILE = "analytics.config.json";
let client;
let pendingPath;
function snapshotInstall(context) {
    try {
        const keys = typeof context.globalState.keys === "function" ? context.globalState.keys() : [];
        return {
            hadDevSnipState: keys.length > 0,
            anonymousId: context.globalState.get(ID_KEY),
            lastVersion: context.globalState.get(VERSION_KEY)
        };
    }
    catch {
        return { hadDevSnipState: false };
    }
}
exports.snapshotInstall = snapshotInstall;
/** Classifies an activation as a new install, an update or a returning user (for onboarding). */
function classifyInstall(snapshot, version) {
    if (!snapshot.hadDevSnipState && !snapshot.anonymousId)
        return { installType: "new", firstRun: true };
    if (snapshot.lastVersion === version)
        return { installType: "returning", firstRun: false };
    return { installType: "updated", firstRun: false, previousVersion: snapshot.lastVersion };
}
exports.classifyInstall = classifyInstall;
/**
 * Reads the PostHog project key and host. The key is written into
 * `analytics.config.json` at package time from the POSTHOG_PROJECT_API_KEY
 * environment variable, so it is never committed. Environment variables
 * override the file for local testing.
 */
function loadAnalyticsConfig(extensionPath, env = process.env, readFile = file => {
    try {
        return fs.readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    }
}) {
    let key = env.DEVSNIP_POSTHOG_KEY;
    let host = env.DEVSNIP_POSTHOG_HOST;
    let environment = env.DEVSNIP_ANALYTICS_ENVIRONMENT;
    if (!key) {
        const raw = readFile(path.join(extensionPath, CONFIG_FILE));
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                key = typeof parsed.posthogKey === "string" ? parsed.posthogKey : undefined;
                host = host || (typeof parsed.posthogHost === "string" ? parsed.posthogHost : undefined);
                environment = environment || (typeof parsed.environment === "string" ? parsed.environment : undefined);
            }
            catch {
                return undefined;
            }
        }
    }
    // Only a PostHog *project* key (write-only ingestion) is accepted. A personal
    // API key (phx_...) can read data and must never ship in an extension.
    if (!key || !/^phc_[A-Za-z0-9]{20,80}$/.test(key))
        return undefined;
    const base = (host || "https://us.i.posthog.com").replace(/\/+$/, "");
    try {
        if (new URL(base).protocol !== "https:")
            return undefined;
    }
    catch {
        return undefined;
    }
    const env2 = (environment || "production");
    return { key, host: base, environment: ENVIRONMENTS.includes(env2) ? env2 : "production" };
}
exports.loadAnalyticsConfig = loadAnalyticsConfig;
/** Sends batches to PostHog's /batch/ endpoint. */
function createPostHogTransport(config, log) {
    return {
        async send(batch) {
            try {
                // Loaded on first delivery (in the background), not during activation.
                const { default: axios } = await Promise.resolve().then(() => __importStar(require("axios")));
                // sent_at lets PostHog correct event timestamps for a user's skewed clock.
                const response = await axios.post(`${config.host}/batch/`, { api_key: config.key, batch, sent_at: new Date().toISOString() }, {
                    timeout: 10000,
                    headers: { "Content-Type": "application/json" },
                    validateStatus: () => true,
                    // Never follow a redirect with the payload to another host.
                    maxRedirects: 0
                });
                if (response.status >= 200 && response.status < 300)
                    return "ok";
                log?.(`PostHog answered HTTP ${response.status} for ${batch.length} event(s).`);
                return response.status === 429 || response.status >= 500 ? "retry" : "drop";
            }
            catch (error) {
                log?.(`Delivery failed (will retry): ${error instanceof Error ? error.message : String(error)}`);
                return "retry";
            }
        }
    };
}
exports.createPostHogTransport = createPostHogTransport;
/**
 * One anonymous id per machine, so a user is counted once however many VS Code
 * profiles, user-data folders or reinstalls they have (a random id per profile
 * made one person look like several users). Derived from VS Code's own
 * anonymous machine id with a DevSnip-specific salt, so it cannot be matched
 * with VS Code's or any other extension's telemetry. Undefined when VS Code has
 * no machine id (some web and test hosts).
 */
function analyticsId(machineId) {
    if (!machineId || !/^[0-9a-f-]{32,}$/i.test(machineId))
        return undefined;
    const hex = (0, crypto_1.createHash)("sha256").update(`devsnip-pro-analytics:${machineId.toLowerCase()}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
exports.analyticsId = analyticsId;
/** Commands that are aliases of a toolkit tool report under that tool's section. */
const TOOLKIT_SECTION = new Map(commands_1.TOOLKIT_COMMANDS.map(c => [c.command, c.section]));
function bare(commandId) {
    return commandId.startsWith(COMMAND_PREFIX) ? commandId.slice(COMMAND_PREFIX.length) : commandId;
}
/**
 * The navigation section a tool lives in (layout.ts), so analytics and the
 * sidebar always agree. Undefined for commands that are not tools (hubs,
 * search, Milestones & Points, settings...), which are never reported.
 */
function toolSection(commandId) {
    const tool = bare(commandId);
    return (0, layout_1.findEntry)(tool)?.section.id ?? TOOLKIT_SECTION.get(tool);
}
exports.toolSection = toolSection;
/** Called by the command registry for every DevSnip Pro command: reports tools that opened successfully. */
function trackCommand(commandId, outcome) {
    if (!client?.isEnabled || outcome !== "success")
        return;
    const section = toolSection(commandId);
    if (section)
        client.toolOpened(bare(commandId), section);
}
exports.trackCommand = trackCommand;
/** Reports that a tool produced a result. At most once per tool every few minutes. */
function trackToolUsed(commandId) {
    if (!client?.isEnabled)
        return;
    const section = toolSection(commandId);
    if (section)
        client.toolUsed(bare(commandId), section);
}
exports.trackToolUsed = trackToolUsed;
function telemetryAllowed() {
    if (!vscode.env.isTelemetryEnabled)
        return false;
    // isTelemetryEnabled is also true for "error" and "crash"; usage data needs "all".
    return vscode.workspace.getConfiguration("telemetry").get("telemetryLevel", "all") === "all";
}
function extensionSettingEnabled() {
    return vscode.workspace.getConfiguration("devsnip.analytics").get("enabled", true) !== false;
}
function readPending() {
    if (!pendingPath)
        return undefined;
    try {
        const raw = fs.readFileSync(pendingPath, "utf8");
        fs.rmSync(pendingPath, { force: true });
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
/**
 * Saves undelivered events to a local file. Synchronous plain-fs on purpose:
 * when VS Code quits it closes the network and extension storage before
 * deactivate() finishes, but a local file write always completes.
 */
function writePending(target) {
    if (!pendingPath)
        return;
    try {
        const pending = target.pending();
        if (!pending.length) {
            fs.rmSync(pendingPath, { force: true });
            return;
        }
        fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
        fs.writeFileSync(pendingPath, JSON.stringify(pending));
    }
    catch {
        /* best effort: analytics must never fail the extension */
    }
}
function initAnalytics(context, snapshot = snapshotInstall(context)) {
    try {
        const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
        // Onboarding compares against this on the next start, with or without analytics.
        void context.globalState.update(VERSION_KEY, version);
        for (const key of OLD_KEYS)
            if (context.globalState.get(key) !== undefined)
                void context.globalState.update(key, undefined);
        const loaded = loadAnalyticsConfig(context.extensionPath);
        const devMode = context.extensionMode !== vscode.ExtensionMode.Production && process.env.DEVSNIP_ANALYTICS_IN_DEV !== "1";
        let channel;
        const log = (line) => {
            if (!vscode.workspace.getConfiguration("devsnip.analytics").get("debug", false))
                return;
            if (!channel) {
                channel = vscode.window.createOutputChannel("DevSnip Pro: Analytics");
                context.subscriptions.push(channel);
            }
            channel.appendLine(`[${new Date().toISOString()}] ${line}`);
        };
        const storageDir = context.globalStorageUri?.fsPath;
        pendingPath = storageDir ? path.join(storageDir, PENDING_FILE) : undefined;
        if (storageDir) {
            for (const file of OLD_FILES) {
                try {
                    fs.rmSync(path.join(storageDir, file), { force: true });
                }
                catch { /* ignore */ }
            }
        }
        if (!loaded) {
            log("Analytics is inactive: no PostHog project key was built into this package.");
            return;
        }
        // A source build that opted in with DEVSNIP_ANALYTICS_IN_DEV is never counted as production.
        const config = context.extensionMode !== vscode.ExtensionMode.Production && loaded.environment === "production"
            ? { ...loaded, environment: "development" }
            : loaded;
        // An id that existed before this run may already have been sent, so it is merged; a new one never was.
        const storedId = snapshot.anonymousId ?? context.globalState.get(ID_KEY);
        const profileId = storedId ?? (0, crypto_1.randomUUID)();
        if (!storedId)
            void context.globalState.update(ID_KEY, profileId);
        const distinctId = analyticsId(vscode.env.machineId) ?? profileId;
        const previousId = storedId && storedId !== distinctId && context.globalState.get(MERGED_KEY) !== storedId ? storedId : undefined;
        client = new client_1.AnalyticsClient({
            distinctId,
            previousId,
            onMerged: merged => void context.globalState.update(MERGED_KEY, merged),
            transport: createPostHogTransport(config, log),
            commonProperties: { extension_version: version, environment: config.environment },
            lastActiveDay: context.globalState.get(ACTIVE_DAY_KEY),
            onActiveDay: day => void context.globalState.update(ACTIVE_DAY_KEY, day),
            onEvent: event => log(`${event.event} ${JSON.stringify(event.properties)}`)
        });
        const owner = client;
        const apply = () => {
            const enabled = !devMode && telemetryAllowed() && extensionSettingEnabled();
            if (owner.isEnabled === enabled)
                return;
            if (enabled) {
                owner.setEnabled(true);
                const restored = owner.restore(readPending(), [profileId]);
                if (restored)
                    log(`Re-sending ${restored} event(s) saved by the previous VS Code run.`);
                log("Analytics enabled.");
            }
            else {
                owner.setEnabled(false);
                // Turning analytics off also forgets anything saved for later.
                if (pendingPath) {
                    try {
                        fs.rmSync(pendingPath, { force: true });
                    }
                    catch { /* ignore */ }
                }
                log("Analytics disabled; nothing is recorded or sent.");
            }
        };
        apply();
        if (devMode)
            log("Analytics is off while the extension runs from source or in tests (set DEVSNIP_ANALYTICS_IN_DEV=1 to test it).");
        context.subscriptions.push(vscode.env.onDidChangeTelemetryEnabled(apply), vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("telemetry") || event.affectsConfiguration("devsnip.analytics"))
                apply();
        }));
        log(`Analytics started (environment: ${config.environment}, host: ${config.host}).`);
    }
    catch (error) {
        // Analytics must never stop the extension from loading.
        console.error("DevSnip Pro: analytics could not start.", error);
        client = undefined;
    }
}
exports.initAnalytics = initAnalytics;
async function shutdownAnalytics() {
    const current = client;
    client = undefined;
    if (!current?.isEnabled)
        return;
    // Save first (always succeeds), then try to deliver; whatever is still queued is sent on the next start.
    writePending(current);
    await current.shutdown(1000);
    writePending(current);
}
exports.shutdownAnalytics = shutdownAnalytics;
/** Test hook: install a client directly. */
function setAnalyticsClientForTests(next) {
    client = next;
}
exports.setAnalyticsClientForTests = setAnalyticsClientForTests;
//# sourceMappingURL=index.js.map