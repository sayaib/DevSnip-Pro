import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import axios from "axios";
import { AnalyticsClient, CapturedEvent, DeliveryResult, Transport } from "./client";
import { EventName, EventProperties } from "./events";

/**
 * DevSnip Pro's analytics entry point.
 *
 *   import { track } from "../analytics";
 *   track("snippet_created", { language: "typescript", line_count: 12 });
 *
 * `track()` is always safe to call: before initialisation, when analytics is
 * disabled, or when no PostHog key was built in, it does nothing.
 *
 * Nothing is sent unless ALL of these hold:
 *  - a PostHog project key was built into this package (see docs/ANALYTICS.md),
 *  - VS Code's `telemetry.telemetryLevel` is "all",
 *  - `devsnip.analytics.enabled` is true,
 *  - the extension is running as an installed extension (not F5 / tests).
 * All four are re-checked live when settings change.
 */

export { EventName, EventProperties } from "./events";

const COMMAND_PREFIX = "sayaib.hue-console.";
const ID_KEY = "devsnip.analytics.anonymousId";
const USED_KEY = "devsnip.analytics.usedFeatures";
const VERSION_KEY = "devsnip.analytics.lastVersion";
const CHECKPOINT_FILE = "analytics-checkpoint.json";
const CHECKPOINT_INTERVAL_MS = 15_000;
const ENVIRONMENTS = ["production", "staging", "test", "development"] as const;
export type AnalyticsEnvironment = typeof ENVIRONMENTS[number];
const CONFIG_FILE = "analytics.config.json";

let client: AnalyticsClient | undefined;
let checkpointPath: string | undefined;
let checkpointTimer: NodeJS.Timeout | undefined;
let checkpointRevision = -1;

/**
 * Writes undelivered events and the open session to a local file.
 *
 * Synchronous plain-fs on purpose: when VS Code quits it closes the extension
 * host's channels (network proxy, extension storage) before deactivate()
 * finishes, so neither a last-moment HTTP request nor a globalState write can
 * be relied on. A local file write always completes.
 */
function writeCheckpoint(target: AnalyticsClient, force = false): void {
  if (!checkpointPath || (!force && target.revision === checkpointRevision)) return;
  checkpointRevision = target.revision;
  try {
    const state = target.snapshotState();
    if (!state.pending.length && !state.session) {
      fs.rmSync(checkpointPath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    fs.writeFileSync(checkpointPath, JSON.stringify(state));
  } catch {
    /* best effort: analytics must never fail the extension */
  }
}

function readAndClearCheckpoint(): unknown {
  if (!checkpointPath) return undefined;
  try {
    const raw = fs.readFileSync(checkpointPath, "utf8");
    fs.rmSync(checkpointPath, { force: true });
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
let usedFeatures: Set<string> | undefined;
let persistUsed: (() => void) | undefined;

export function track<E extends EventName>(event: E, properties?: EventProperties<E>): void {
  client?.track(event, (properties ?? {}) as Record<string, unknown>);
}

export interface AnalyticsConfig {
  key: string;
  host: string;
  /** Sent with every event so test and pre-release data can be filtered out of production dashboards. */
  environment: AnalyticsEnvironment;
}

/**
 * What this installation looked like before activation touched any state.
 * Taken at the very start of activate(), because other modules write their
 * own state during activation and would make every user look like a returning one.
 */
export interface InstallSnapshot {
  hadDevSnipState: boolean;
  anonymousId?: string;
  lastVersion?: string;
}

export function snapshotInstall(context: vscode.ExtensionContext): InstallSnapshot {
  try {
    const keys = typeof context.globalState.keys === "function" ? context.globalState.keys() : [];
    return {
      hadDevSnipState: keys.length > 0,
      anonymousId: context.globalState.get<string>(ID_KEY),
      lastVersion: context.globalState.get<string>(VERSION_KEY)
    };
  } catch {
    return { hadDevSnipState: false };
  }
}

/** Classifies an activation for install / update reporting. */
export function classifyInstall(snapshot: InstallSnapshot, version: string): { installType: "new" | "updated" | "returning"; firstRun: boolean; previousVersion?: string } {
  if (!snapshot.hadDevSnipState && !snapshot.anonymousId) return { installType: "new", firstRun: true };
  if (snapshot.lastVersion === version) return { installType: "returning", firstRun: false };
  // Either a real version change, or an existing user's first run of a version with analytics.
  return { installType: "updated", firstRun: false, previousVersion: snapshot.lastVersion };
}

/**
 * Reads the PostHog project key and host. The key is written into
 * `analytics.config.json` at package time from the POSTHOG_PROJECT_API_KEY
 * environment variable, so it is never committed. Environment variables
 * override the file for local testing.
 */
export function loadAnalyticsConfig(
  extensionPath: string,
  env: NodeJS.ProcessEnv = process.env,
  readFile: (file: string) => string | undefined = file => {
    try { return fs.readFileSync(file, "utf8"); } catch { return undefined; }
  }
): AnalyticsConfig | undefined {
  let key = env.DEVSNIP_POSTHOG_KEY;
  let host = env.DEVSNIP_POSTHOG_HOST;
  let environment: string | undefined = env.DEVSNIP_ANALYTICS_ENVIRONMENT;
  if (!key) {
    const raw = readFile(path.join(extensionPath, CONFIG_FILE));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        key = typeof parsed.posthogKey === "string" ? parsed.posthogKey : undefined;
        host = host || (typeof parsed.posthogHost === "string" ? parsed.posthogHost : undefined);
        environment = environment || (typeof parsed.environment === "string" ? parsed.environment : undefined);
      } catch {
        return undefined;
      }
    }
  }
  // Only a PostHog *project* key (write-only ingestion) is accepted. A personal
  // API key (phx_...) can read data and must never ship in an extension.
  if (!key || !/^phc_[A-Za-z0-9]{20,80}$/.test(key)) return undefined;
  const base = (host || "https://us.i.posthog.com").replace(/\/+$/, "");
  try {
    const url = new URL(base);
    if (url.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  const env2 = (environment || "production") as AnalyticsEnvironment;
  return { key, host: base, environment: ENVIRONMENTS.includes(env2) ? env2 : "production" };
}

/** Sends batches to PostHog's /batch/ endpoint. */
export function createPostHogTransport(config: AnalyticsConfig, log?: (line: string) => void): Transport {
  return {
    async send(batch: CapturedEvent[]): Promise<DeliveryResult> {
      try {
        // sent_at lets PostHog correct event timestamps for a user's skewed clock.
        const response = await axios.post(`${config.host}/batch/`, { api_key: config.key, batch, sent_at: new Date().toISOString() }, {
          timeout: 10_000,
          headers: { "Content-Type": "application/json" },
          validateStatus: () => true,
          // Never follow a redirect with the payload to another host.
          maxRedirects: 0
        });
        if (response.status >= 200 && response.status < 300) return "ok";
        log?.(`PostHog answered HTTP ${response.status} for ${batch.length} event(s).`);
        return response.status === 429 || response.status >= 500 ? "retry" : "drop";
      } catch (error) {
        log?.(`Delivery failed (will retry): ${error instanceof Error ? error.message : String(error)}`);
        return "retry";
      }
    }
  };
}

/** Feature group for a command id, used to compare areas of the extension. */
export function featureCategory(feature: string): string {
  const name = feature.toLowerCase();
  if (/snippet/.test(name)) return "snippets";
  if (/dependencymanager/.test(name)) return "dependencies";
  if (/security|audit|endpoint/.test(name)) return "security";
  if (/^rag|chunking|embedding|contextwindow|semanticdedup|hybridsearch|hallucination/.test(name)) return "rag";
  if (/^aiml|^ml|prompt|token|llm|dataset|gpu|experiment|modelcard|jsonl|metrics|lrscheduler|inference|mdtable/.test(name)) return "ai";
  if (/bigdata|schema|spark|dataquality|partition|deltalake/.test(name)) return "data";
  if (/devops|mlops|observability/.test(name)) return "devops";
  if (/milestone|premium|resetfeature/.test(name)) return "progress";
  if (/opengui/.test(name)) return "api";
  if (/advancedtools|regex|json|hash|base64|color|url|timestamp|lorem|searchtools/.test(name)) return "utilities";
  return "core";
}

/** Called by the command registry for every DevSnip Pro command. */
export function trackCommand(commandId: string, outcome: "success" | "error", durationMs: number): void {
  if (!client?.isEnabled) return;
  const feature = commandId.startsWith(COMMAND_PREFIX) ? commandId.slice(COMMAND_PREFIX.length) : commandId;
  let firstUse = false;
  if (usedFeatures && !usedFeatures.has(feature)) {
    usedFeatures.add(feature);
    firstUse = true;
    persistUsed?.();
  }
  track("feature_used", { feature, category: featureCategory(feature), outcome, duration_ms: durationMs, first_use: firstUse });
}

function telemetryAllowed(): boolean {
  if (!vscode.env.isTelemetryEnabled) return false;
  // isTelemetryEnabled is also true for "error" and "crash"; usage data needs "all".
  const level = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all");
  return level === "all";
}

function extensionSettingEnabled(): boolean {
  return vscode.workspace.getConfiguration("devsnip.analytics").get<boolean>("enabled", true) !== false;
}

export function initAnalytics(context: vscode.ExtensionContext, activationStart: number, snapshot: InstallSnapshot = snapshotInstall(context)): void {
  try {
    const loaded = loadAnalyticsConfig(context.extensionPath);
    const devMode = context.extensionMode !== vscode.ExtensionMode.Production && process.env.DEVSNIP_ANALYTICS_IN_DEV !== "1";

    let channel: vscode.OutputChannel | undefined;
    const debugEnabled = () => vscode.workspace.getConfiguration("devsnip.analytics").get<boolean>("debug", false);
    const log = (line: string) => {
      if (!debugEnabled()) return;
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
    const config: AnalyticsConfig = context.extensionMode !== vscode.ExtensionMode.Production && loaded.environment === "production"
      ? { ...loaded, environment: "development" }
      : loaded;

    let distinctId = snapshot.anonymousId ?? context.globalState.get<string>(ID_KEY);
    if (!distinctId) {
      distinctId = randomUUID();
      void context.globalState.update(ID_KEY, distinctId);
    }
    usedFeatures = new Set(context.globalState.get<string[]>(USED_KEY, []).slice(0, 1000));
    let persistTimer: NodeJS.Timeout | undefined;
    persistUsed = () => {
      if (persistTimer) return;
      persistTimer = setTimeout(() => {
        persistTimer = undefined;
        void context.globalState.update(USED_KEY, [...(usedFeatures ?? [])]);
      }, 2000);
    };

    const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
    const install = classifyInstall(snapshot, version);
    void context.globalState.update(VERSION_KEY, version);
    client = new AnalyticsClient({
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
      checkpointTimer = setInterval(() => { if (owner.isEnabled) writeCheckpoint(owner); }, CHECKPOINT_INTERVAL_MS);
      checkpointTimer.unref?.();
    }
    if (devMode) log("Analytics is off while the extension runs from source or in tests (set DEVSNIP_ANALYTICS_IN_DEV=1 to test it).");

    context.subscriptions.push(
      vscode.env.onDidChangeTelemetryEnabled(apply),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("telemetry") || event.affectsConfiguration("devsnip.analytics")) apply();
      })
    );

    track("extension_activated", {
      first_run: install.firstRun,
      install_type: install.installType,
      activation_ms: Date.now() - activationStart,
      ui_kind: vscode.env.uiKind === vscode.UIKind.Web ? "web" : "desktop",
      remote: Boolean(vscode.env.remoteName),
      locale: vscode.env.language
    });
    if (install.installType === "updated") track("extension_updated", { previous_version: install.previousVersion });
    log(`Analytics started (environment: ${config.environment}, install: ${install.installType}, host: ${config.host}).`);
  } catch (error) {
    // Analytics must never stop the extension from loading.
    console.error("DevSnip Pro: analytics could not start.", error);
    client = undefined;
  }
}

export async function shutdownAnalytics(): Promise<void> {
  const current = client;
  client = undefined;
  if (checkpointTimer) clearInterval(checkpointTimer);
  checkpointTimer = undefined;
  if (!current?.isEnabled) return;
  // 1. Close the session and save everything locally first - this always succeeds.
  current.endSessionNow();
  writeCheckpoint(current, true);
  // 2. Then try to deliver. If VS Code tears the network down first, the
  //    checkpoint is sent on the next start instead.
  await current.shutdown(1000);
  writeCheckpoint(current, true);
}

/** Test hook: install a client directly. */
export function setAnalyticsClientForTests(next: AnalyticsClient | undefined, used?: Set<string>): void {
  client = next;
  usedFeatures = used;
  persistUsed = undefined;
}
