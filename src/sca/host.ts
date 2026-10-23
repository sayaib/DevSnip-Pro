import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildToolSettings, createRepository } from "../osv/maven/host";
import type { Gav } from "../osv/maven/resolver";
import type { OsvClient } from "../osv/client";
import { BomCache, findBomUpgrade, IsFixed, newBomCache } from "./bom";
import type { ScaProviders } from "./engine";
import { loadKev, KevStore } from "./providers/kev";
import { lookupNvd, NvdScore, NvdStore } from "./providers/nvd";
import { checkHealth, HealthStore, RegistryHealth } from "./providers/registry";

/**
 * The SCA Scanner's providers as the extension host runs them: HTTP with a
 * User-Agent, timeouts and retries; caches in global storage; settings under
 * `devsnip.sca`; and the optional NVD API key in VS Code's secret storage.
 *
 * What leaves the machine: package names and versions (registries), CVE ids
 * (NVD), and nothing for KEV (the whole catalog is downloaded and matched
 * locally). No file contents, paths or project names.
 */

export const NVD_KEY_SECRET = "devsnip.sca.nvdApiKey";

export interface ScaSettings {
  healthChecks: "direct" | "all" | "off";
  knownExploited: boolean;
  nvdEnrichment: boolean;
  remediationSearch: boolean;
}

export function scaSettings(): ScaSettings {
  const config = vscode.workspace.getConfiguration("devsnip.sca");
  const health = config.get<string>("healthChecks", "direct");
  return {
    healthChecks: health === "all" || health === "off" ? health : "direct",
    knownExploited: config.get<boolean>("knownExploited", true) !== false,
    nvdEnrichment: config.get<boolean>("nvdEnrichment", true) !== false,
    remediationSearch: config.get<boolean>("bomUpgradeSearch", true) !== false
  };
}

type FetchImpl = (url: string, init: unknown) => Promise<{ status: number; text(): Promise<string> }>;

/** GET with a timeout and up to three attempts on network errors and 5xx (429 is left to the caller's rate handling). */
export async function httpGet(url: string, headers: Record<string, string>, signal?: AbortSignal, timeoutMs = 20000): Promise<{ status: number; text: string }> {
  const fetchImpl = (globalThis as { fetch?: FetchImpl }).fetch;
  if (!fetchImpl) throw new Error("fetch is not available");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new Error("cancelled");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      const text = response.status === 200 ? await response.text() : "";
      if (response.status >= 500) lastError = new Error(`HTTP ${response.status}`);
      else return { status: response.status, text };
    } catch (error) {
      lastError = signal?.aborted ? new Error("cancelled") : error;
      if (signal?.aborted) break;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const asJson = (response: { status: number; text: string }) => ({ status: response.status, json: async () => JSON.parse(response.text) as unknown });

/** A small JSON map in global storage, loaded once and written back after each scan. */
class JsonStore<T> {
  private data?: Record<string, T>;
  private dirty = false;
  constructor(private readonly file: string | undefined, private readonly limit: number) {}
  private async load(): Promise<Record<string, T>> {
    if (this.data) return this.data;
    try { this.data = this.file ? JSON.parse(await fs.promises.readFile(this.file, "utf8")) as Record<string, T> : {}; } catch { this.data = {}; }
    if (!this.data || typeof this.data !== "object") this.data = {};
    return this.data;
  }
  async get(key: string): Promise<T | undefined> { return (await this.load())[key]; }
  async set(key: string, value: T): Promise<void> {
    const data = await this.load();
    delete data[key];
    data[key] = value;
    const keys = Object.keys(data);
    for (const old of keys.slice(0, Math.max(0, keys.length - this.limit))) delete data[old];
    this.dirty = true;
  }
  async save(): Promise<void> {
    if (!this.dirty || !this.file || !this.data) return;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(this.file, JSON.stringify(this.data), "utf8");
      this.dirty = false;
    } catch { /* caches are an optimisation */ }
  }
  clear(): void { this.data = {}; this.dirty = true; }
}

let stores: { dir?: string; nvd: JsonStore<{ at: number; score: NvdScore | null }>; health: JsonStore<{ at: number; health: RegistryHealth }> } | undefined;

function storesFor(context: vscode.ExtensionContext) {
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

function kevStore(context: vscode.ExtensionContext): KevStore | undefined {
  const dir = context.globalStorageUri?.fsPath;
  if (!dir) return undefined;
  const file = path.join(dir, "sca", "kev.json");
  return {
    async read() { try { return JSON.parse(await fs.promises.readFile(file, "utf8")) as { fetchedAt: number; data: unknown }; } catch { return undefined; } },
    async write(value) {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(value), "utf8");
    }
  };
}

export async function saveScaCaches(context: vscode.ExtensionContext): Promise<void> {
  const s = storesFor(context);
  await Promise.all([s.nvd.save(), s.health.save()]);
}

/** Clears the NVD, registry and KEV caches. */
export async function clearScaCaches(context: vscode.ExtensionContext): Promise<void> {
  const s = storesFor(context);
  s.nvd.clear();
  s.health.clear();
  await saveScaCaches(context);
  if (s.dir) await fs.promises.rm(path.join(s.dir, "kev.json"), { force: true }).catch(() => undefined);
}

export function userAgent(context: vscode.ExtensionContext): string {
  return `DevSnip-Pro/${String(context.extension?.packageJSON?.version ?? "dev")} (VS Code ${vscode.version}; SCA Scanner)`;
}

/** At most this many BOM versions are examined per scan, over every BOM search (each is one POM, or a few with a nested BOM). */
const MAX_BOM_LOADS = 150;

/**
 * "Is this version of the artifact free of its advisories?", answered by OSV
 * for the exact version, so a newer release branch (Tomcat 10.1 for a 9.0 fix)
 * is judged by its own ranges. Answers are cached for the scan.
 */
export function osvIsFixed(client: OsvClient): IsFixed {
  const answers = new Map<string, Promise<string[] | undefined>>();
  return async (target, version, signal) => {
    if (!target.ids?.length) return undefined;
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

/** The providers for one scan, from the current settings. `onLog` receives what each provider did; `client` verifies BOM candidates. */
export async function createScaProviders(context: vscode.ExtensionContext, onLog: (message: string) => void, client?: OsvClient): Promise<ScaProviders> {
  const settings = scaSettings();
  const ua = userAgent(context);
  const s = storesFor(context);
  const nvdStore: NvdStore = { get: key => s.nvd.get(key), set: (key, value) => s.nvd.set(key, value) };
  const healthStore: HealthStore = { get: key => s.health.get(key), set: (key, value) => s.health.set(key, value) };
  let apiKey: string | undefined;
  try { apiKey = (await context.secrets?.get(NVD_KEY_SECRET)) || undefined; } catch { apiKey = undefined; }
  const buildSettings = buildToolSettings();
  const bomSearch = () => {
    const { repository } = createRepository(context, buildSettings, onLog);
    const isFixed = client ? osvIsFixed(client) : undefined;
    const caches = new Map<string, BomCache>();
    const examined = () => [...caches.values()].reduce((n, c) => n + c.examined.size, 0);
    return async (bom: Gav, targets: Parameters<typeof findBomUpgrade>[2], signal?: AbortSignal) => {
      const key = `${bom.groupId}:${bom.artifactId}:${bom.version}`;
      const cache = caches.get(key) ?? newBomCache();
      caches.set(key, cache);
      const budget = Math.min(24, MAX_BOM_LOADS - examined());
      if (budget <= 0) return { error: `The search stopped after examining ${MAX_BOM_LOADS} BOM versions in this scan.` };
      const result = await findBomUpgrade(repository, bom, targets, { signal, isFixed, cache, maxLoads: budget });
      onLog(`Remediation: ${bom.artifactId} ${bom.version} for ${targets.map(t => `${t.artifactId} ≥ ${t.fixedIn}`).join(", ")} → ${"error" in result ? result.error : `${result.to} (${result.risk} risk, ${result.evaluated} new BOM versions examined)`}`);
      return result;
    };
  };
  return {
    healthScope: settings.healthChecks,
    kev: settings.knownExploited
      ? signal => loadKev(async (url, sig) => asJson(await httpGet(url, { "User-Agent": ua, Accept: "application/json" }, sig, 60000)), kevStore(context), { signal })
      : undefined,
    nvd: settings.nvdEnrichment
      ? (cves, signal) => {
        onLog(`NVD: looking up ${cves.length} CVE${cves.length === 1 ? "" : "s"} without an OSV severity${apiKey ? " (with your API key)" : ""}.`);
        return lookupNvd(cves, async (url, headers, sig) => asJson(await httpGet(url, { "User-Agent": ua, Accept: "application/json", ...headers }, sig)), nvdStore, { apiKey, signal });
      }
      : undefined,
    health: settings.healthChecks !== "off"
      ? (requests, signal) => {
        onLog(`Registries: checking ${requests.length} package${requests.length === 1 ? "" : "s"} (latest release, deprecation, yanks).`);
        return checkHealth(requests, (url, headers, sig) => httpGet(url, { "User-Agent": ua, ...headers }, sig), healthStore, { signal });
      }
      : undefined,
    // BOM versions and POMs come from the same repository (local ~/.m2 first, then Maven Central when allowed) as dependency resolution.
    bomUpgrade: settings.remediationSearch ? bomSearch() : undefined
  };
}
