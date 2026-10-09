import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { AnalyticsClient, CapturedEvent, DeliveryResult, Transport } from "./client";
import { TOOLKIT_COMMANDS } from "../toolkits/commands";
import { findEntry } from "../toolkits/layout";

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
const ENVIRONMENTS = ["production", "staging", "test", "development"] as const;
export type AnalyticsEnvironment = typeof ENVIRONMENTS[number];
const CONFIG_FILE = "analytics.config.json";

let client: AnalyticsClient | undefined;
let pendingPath: string | undefined;

export interface AnalyticsConfig {
  key: string;
  host: string;
  /** Sent with every event so test and pre-release data can be filtered out of production dashboards. */
  environment: AnalyticsEnvironment;
}

/**
 * What this installation looked like before activation touched any state.
 * Taken at the very start of activate(), because other modules write their
 * own state during activation and would make every user look like a returning
 * one. Used locally by onboarding; nothing here is sent.
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

/** Classifies an activation as a new install, an update or a returning user (for onboarding). */
export function classifyInstall(snapshot: InstallSnapshot, version: string): { installType: "new" | "updated" | "returning"; firstRun: boolean; previousVersion?: string } {
  if (!snapshot.hadDevSnipState && !snapshot.anonymousId) return { installType: "new", firstRun: true };
  if (snapshot.lastVersion === version) return { installType: "returning", firstRun: false };
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
    if (new URL(base).protocol !== "https:") return undefined;
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
        // Loaded on first delivery (in the background), not during activation.
        const { default: axios } = await import("axios");
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

/**
 * One anonymous id per machine, so a user is counted once however many VS Code
 * profiles, user-data folders or reinstalls they have (a random id per profile
 * made one person look like several users). Derived from VS Code's own
 * anonymous machine id with a DevSnip-specific salt, so it cannot be matched
 * with VS Code's or any other extension's telemetry. Undefined when VS Code has
 * no machine id (some web and test hosts).
 */
export function analyticsId(machineId: string | undefined): string | undefined {
  if (!machineId || !/^[0-9a-f-]{32,}$/i.test(machineId)) return undefined;
  const hex = createHash("sha256").update(`devsnip-pro-analytics:${machineId.toLowerCase()}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Commands that are aliases of a toolkit tool report under that tool's section. */
const TOOLKIT_SECTION = new Map(TOOLKIT_COMMANDS.map(c => [c.command, c.section]));

function bare(commandId: string): string {
  return commandId.startsWith(COMMAND_PREFIX) ? commandId.slice(COMMAND_PREFIX.length) : commandId;
}

/**
 * The navigation section a tool lives in (layout.ts), so analytics and the
 * sidebar always agree. Undefined for commands that are not tools (hubs,
 * search, Milestones & Points, settings...), which are never reported.
 */
export function toolSection(commandId: string): string | undefined {
  const tool = bare(commandId);
  return findEntry(tool)?.section.id ?? TOOLKIT_SECTION.get(tool);
}

/** Called by the command registry for every DevSnip Pro command: reports tools that opened successfully. */
export function trackCommand(commandId: string, outcome: "success" | "error"): void {
  if (!client?.isEnabled || outcome !== "success") return;
  const section = toolSection(commandId);
  if (section) client.toolOpened(bare(commandId), section);
}

/** Reports that a tool produced a result. At most once per tool every few minutes. */
export function trackToolUsed(commandId: string): void {
  if (!client?.isEnabled) return;
  const section = toolSection(commandId);
  if (section) client.toolUsed(bare(commandId), section);
}

function telemetryAllowed(): boolean {
  if (!vscode.env.isTelemetryEnabled) return false;
  // isTelemetryEnabled is also true for "error" and "crash"; usage data needs "all".
  return vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all") === "all";
}

function extensionSettingEnabled(): boolean {
  return vscode.workspace.getConfiguration("devsnip.analytics").get<boolean>("enabled", true) !== false;
}

function readPending(): unknown {
  if (!pendingPath) return undefined;
  try {
    const raw = fs.readFileSync(pendingPath, "utf8");
    fs.rmSync(pendingPath, { force: true });
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Saves undelivered events to a local file. Synchronous plain-fs on purpose:
 * when VS Code quits it closes the network and extension storage before
 * deactivate() finishes, but a local file write always completes.
 */
function writePending(target: AnalyticsClient): void {
  if (!pendingPath) return;
  try {
    const pending = target.pending();
    if (!pending.length) {
      fs.rmSync(pendingPath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
    fs.writeFileSync(pendingPath, JSON.stringify(pending));
  } catch {
    /* best effort: analytics must never fail the extension */
  }
}

export function initAnalytics(context: vscode.ExtensionContext, snapshot: InstallSnapshot = snapshotInstall(context)): void {
  try {
    const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
    // Onboarding compares against this on the next start, with or without analytics.
    void context.globalState.update(VERSION_KEY, version);
    for (const key of OLD_KEYS) if (context.globalState.get(key) !== undefined) void context.globalState.update(key, undefined);

    const loaded = loadAnalyticsConfig(context.extensionPath);
    const devMode = context.extensionMode !== vscode.ExtensionMode.Production && process.env.DEVSNIP_ANALYTICS_IN_DEV !== "1";

    let channel: vscode.OutputChannel | undefined;
    const log = (line: string) => {
      if (!vscode.workspace.getConfiguration("devsnip.analytics").get<boolean>("debug", false)) return;
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
        try { fs.rmSync(path.join(storageDir, file), { force: true }); } catch { /* ignore */ }
      }
    }

    if (!loaded) {
      log("Analytics is inactive: no PostHog project key was built into this package.");
      return;
    }
    // A source build that opted in with DEVSNIP_ANALYTICS_IN_DEV is never counted as production.
    const config: AnalyticsConfig = context.extensionMode !== vscode.ExtensionMode.Production && loaded.environment === "production"
      ? { ...loaded, environment: "development" }
      : loaded;

    // An id that existed before this run may already have been sent, so it is merged; a new one never was.
    const storedId = snapshot.anonymousId ?? context.globalState.get<string>(ID_KEY);
    const profileId = storedId ?? randomUUID();
    if (!storedId) void context.globalState.update(ID_KEY, profileId);
    const distinctId = analyticsId(vscode.env.machineId) ?? profileId;
    const previousId = storedId && storedId !== distinctId && context.globalState.get<string>(MERGED_KEY) !== storedId ? storedId : undefined;

    client = new AnalyticsClient({
      distinctId,
      previousId,
      onMerged: merged => void context.globalState.update(MERGED_KEY, merged),
      transport: createPostHogTransport(config, log),
      commonProperties: { extension_version: version, environment: config.environment },
      lastActiveDay: context.globalState.get<string>(ACTIVE_DAY_KEY),
      onActiveDay: day => void context.globalState.update(ACTIVE_DAY_KEY, day),
      onEvent: event => log(`${event.event} ${JSON.stringify(event.properties)}`)
    });

    const owner = client;
    const apply = () => {
      const enabled = !devMode && telemetryAllowed() && extensionSettingEnabled();
      if (owner.isEnabled === enabled) return;
      if (enabled) {
        owner.setEnabled(true);
        const restored = owner.restore(readPending(), [profileId]);
        if (restored) log(`Re-sending ${restored} event(s) saved by the previous VS Code run.`);
        log("Analytics enabled.");
      } else {
        owner.setEnabled(false);
        // Turning analytics off also forgets anything saved for later.
        if (pendingPath) {
          try { fs.rmSync(pendingPath, { force: true }); } catch { /* ignore */ }
        }
        log("Analytics disabled; nothing is recorded or sent.");
      }
    };
    apply();
    if (devMode) log("Analytics is off while the extension runs from source or in tests (set DEVSNIP_ANALYTICS_IN_DEV=1 to test it).");

    context.subscriptions.push(
      vscode.env.onDidChangeTelemetryEnabled(apply),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("telemetry") || event.affectsConfiguration("devsnip.analytics")) apply();
      })
    );
    log(`Analytics started (environment: ${config.environment}, host: ${config.host}).`);
  } catch (error) {
    // Analytics must never stop the extension from loading.
    console.error("DevSnip Pro: analytics could not start.", error);
    client = undefined;
  }
}

export async function shutdownAnalytics(): Promise<void> {
  const current = client;
  client = undefined;
  if (!current?.isEnabled) return;
  // Save first (always succeeds), then try to deliver; whatever is still queued is sent on the next start.
  writePending(current);
  await current.shutdown(1000);
  writePending(current);
}

/** Test hook: install a client directly. */
export function setAnalyticsClientForTests(next: AnalyticsClient | undefined): void {
  client = next;
}
