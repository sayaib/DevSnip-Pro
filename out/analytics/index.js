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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAnalyticsClientForTests = exports.shutdownAnalytics = exports.initAnalytics = exports.trackCommand = exports.featureCategory = exports.createPostHogTransport = exports.loadAnalyticsConfig = exports.classifyInstall = exports.snapshotInstall = exports.track = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const axios_1 = __importDefault(require("axios"));
const client_1 = require("./client");
const COMMAND_PREFIX = "sayaib.hue-console.";
const ID_KEY = "devsnip.analytics.anonymousId";
const USED_KEY = "devsnip.analytics.usedFeatures";
const VERSION_KEY = "devsnip.analytics.lastVersion";
const CHECKPOINT_FILE = "analytics-checkpoint.json";
const CHECKPOINT_INTERVAL_MS = 15000;
const ENVIRONMENTS = ["production", "staging", "test", "development"];
const CONFIG_FILE = "analytics.config.json";
let client;
let checkpointPath;
let checkpointTimer;
let checkpointRevision = -1;
/**
 * Writes undelivered events and the open session to a local file.
 *
 * Synchronous plain-fs on purpose: when VS Code quits it closes the extension
 * host's channels (network proxy, extension storage) before deactivate()
 * finishes, so neither a last-moment HTTP request nor a globalState write can
 * be relied on. A local file write always completes.
 */
function writeCheckpoint(target, force = false) {
    if (!checkpointPath || (!force && target.revision === checkpointRevision))
        return;
    checkpointRevision = target.revision;
    try {
        const state = target.snapshotState();
        if (!state.pending.length && !state.session) {
            fs.rmSync(checkpointPath, { force: true });
            return;
        }
        fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
        fs.writeFileSync(checkpointPath, JSON.stringify(state));
    }
    catch {
        /* best effort: analytics must never fail the extension */
    }
}
function readAndClearCheckpoint() {
    if (!checkpointPath)
        return undefined;
    try {
        const raw = fs.readFileSync(checkpointPath, "utf8");
        fs.rmSync(checkpointPath, { force: true });
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
let usedFeatures;
let persistUsed;
function track(event, properties) {
    client?.track(event, (properties ?? {}));
}
exports.track = track;
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
/** Classifies an activation for install / update reporting. */
function classifyInstall(snapshot, version) {
    if (!snapshot.hadDevSnipState && !snapshot.anonymousId)
        return { installType: "new", firstRun: true };
    if (snapshot.lastVersion === version)
        return { installType: "returning", firstRun: false };
    // Either a real version change, or an existing user's first run of a version with analytics.
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
        const url = new URL(base);
        if (url.protocol !== "https:")
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
                // sent_at lets PostHog correct event timestamps for a user's skewed clock.
                const response = await axios_1.default.post(`${config.host}/batch/`, { api_key: config.key, batch, sent_at: new Date().toISOString() }, {
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
/** Feature group for a command id, used to compare areas of the extension. */
function featureCategory(feature) {
    const name = feature.toLowerCase();
    if (/snippet/.test(name))
        return "snippets";
    if (/dependencymanager/.test(name))
        return "dependencies";
    if (/security|audit|endpoint/.test(name))
        return "security";
    if (/^rag|chunking|embedding|contextwindow|semanticdedup|hybridsearch|hallucination/.test(name))
        return "rag";
    if (/^aiml|^ml|prompt|token|llm|dataset|gpu|experiment|modelcard|jsonl|metrics|lrscheduler|inference|mdtable/.test(name))
        return "ai";
    if (/bigdata|schema|spark|dataquality|partition|deltalake/.test(name))
        return "data";
    if (/devops|mlops|observability/.test(name))
        return "devops";
    if (/milestone|premium|resetfeature/.test(name))
        return "progress";
    if (/opengui/.test(name))
        return "api";
    if (/advancedtools|regex|json|hash|base64|color|url|timestamp|lorem|searchtools/.test(name))
        return "utilities";
    return "core";
}
exports.featureCategory = featureCategory;
/** Called by the command registry for every DevSnip Pro command. */
function trackCommand(commandId, outcome, durationMs) {
    if (!client?.isEnabled)
        return;
    const feature = commandId.startsWith(COMMAND_PREFIX) ? commandId.slice(COMMAND_PREFIX.length) : commandId;
    let firstUse = false;
    if (usedFeatures && !usedFeatures.has(feature)) {
        usedFeatures.add(feature);
        firstUse = true;
        persistUsed?.();
    }
    track("feature_used", { feature, category: featureCategory(feature), outcome, duration_ms: durationMs, first_use: firstUse });
}
exports.trackCommand = trackCommand;
function telemetryAllowed() {
    if (!vscode.env.isTelemetryEnabled)
        return false;
    // isTelemetryEnabled is also true for "error" and "crash"; usage data needs "all".
    const level = vscode.workspace.getConfiguration("telemetry").get("telemetryLevel", "all");
    return level === "all";
}
function extensionSettingEnabled() {
    return vscode.workspace.getConfiguration("devsnip.analytics").get("enabled", true) !== false;
}
function initAnalytics(context, activationStart, snapshot = snapshotInstall(context)) {
    try {
        const loaded = loadAnalyticsConfig(context.extensionPath);
        const devMode = context.extensionMode !== vscode.ExtensionMode.Production && process.env.DEVSNIP_ANALYTICS_IN_DEV !== "1";
        let channel;
        const debugEnabled = () => vscode.workspace.getConfiguration("devsnip.analytics").get("debug", false);
        const log = (line) => {
            if (!debugEnabled())
                return;
            if (!channel) {
                channel = vscode.window.createOutputChannel("DevSnip Pro: Analytics");
                context.subscriptions.push(channel);
            }
            channel.appendLine(`[${new Date().toISOString()}] ${line}`);
        };
        if (!loaded) {
            log("Analytics is inactive: no PostHog project key was built into this package.");
            return;
        }
        // A source build that opted in with DEVSNIP_ANALYTICS_IN_DEV is never counted as production.
        const config = context.extensionMode !== vscode.ExtensionMode.Production && loaded.environment === "production"
            ? { ...loaded, environment: "development" }
            : loaded;
        let distinctId = snapshot.anonymousId ?? context.globalState.get(ID_KEY);
        if (!distinctId) {
            distinctId = (0, crypto_1.randomUUID)();
            void context.globalState.update(ID_KEY, distinctId);
        }
        usedFeatures = new Set(context.globalState.get(USED_KEY, []).slice(0, 1000));
        let persistTimer;
        persistUsed = () => {
            if (persistTimer)
                return;
            persistTimer = setTimeout(() => {
                persistTimer = undefined;
                void context.globalState.update(USED_KEY, [...(usedFeatures ?? [])]);
            }, 2000);
        };
        const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
        const install = classifyInstall(snapshot, version);
        void context.globalState.update(VERSION_KEY, version);
        client = new client_1.AnalyticsClient({
            distinctId,
            transport: createPostHogTransport(config, log),
            commonProperties: {
                extension_version: version,
                vscode_version: vscode.version,
                platform: ["darwin", "win32", "linux"].includes(process.platform) ? process.platform : "other",
                arch: process.arch,
                environment: config.environment
            },
            onEvent: event => log(`${event.event} ${JSON.stringify(event.properties)}`),
            onInvalid: message => log(`Dropped: ${message}`)
        });
        const apply = () => {
            const enabled = !devMode && telemetryAllowed() && extensionSettingEnabled();
            if (client && client.isEnabled !== enabled) {
                client.setEnabled(enabled);
                log(enabled ? "Analytics enabled." : "Analytics disabled; nothing is recorded or sent.");
            }
        };
        apply();
        // Undelivered events and an unfinished session from the previous VS Code run.
        const storageDir = context.globalStorageUri?.fsPath;
        if (storageDir) {
            checkpointPath = path.join(storageDir, CHECKPOINT_FILE);
            const previous = readAndClearCheckpoint();
            if (previous !== undefined) {
                const recovered = client.recover(previous);
                if (recovered.events || recovered.interrupted) {
                    log(`Recovered from the previous VS Code run: ${recovered.events} undelivered event(s)${recovered.interrupted ? ", and closed a session that was interrupted" : ""}.`);
                }
            }
            const owner = client;
            checkpointTimer = setInterval(() => { if (owner.isEnabled)
                writeCheckpoint(owner); }, CHECKPOINT_INTERVAL_MS);
            checkpointTimer.unref?.();
        }
        if (devMode)
            log("Analytics is off while the extension runs from source or in tests (set DEVSNIP_ANALYTICS_IN_DEV=1 to test it).");
        context.subscriptions.push(vscode.env.onDidChangeTelemetryEnabled(apply), vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("telemetry") || event.affectsConfiguration("devsnip.analytics"))
                apply();
        }));
        track("extension_activated", {
            first_run: install.firstRun,
            install_type: install.installType,
            activation_ms: Date.now() - activationStart,
            ui_kind: vscode.env.uiKind === vscode.UIKind.Web ? "web" : "desktop",
            remote: Boolean(vscode.env.remoteName),
            locale: vscode.env.language
        });
        if (install.installType === "updated")
            track("extension_updated", { previous_version: install.previousVersion });
        log(`Analytics started (environment: ${config.environment}, install: ${install.installType}, host: ${config.host}).`);
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
    if (checkpointTimer)
        clearInterval(checkpointTimer);
    checkpointTimer = undefined;
    if (!current?.isEnabled)
        return;
    // 1. Close the session and save everything locally first - this always succeeds.
    current.endSessionNow();
    writeCheckpoint(current, true);
    // 2. Then try to deliver. If VS Code tears the network down first, the
    //    checkpoint is sent on the next start instead.
    await current.shutdown(1000);
    writeCheckpoint(current, true);
}
exports.shutdownAnalytics = shutdownAnalytics;
/** Test hook: install a client directly. */
function setAnalyticsClientForTests(next, used) {
    client = next;
    usedFeatures = used;
    persistUsed = undefined;
}
exports.setAnalyticsClientForTests = setAnalyticsClientForTests;
//# sourceMappingURL=index.js.map