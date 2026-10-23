import * as vscode from "vscode";
import { OsvCache, OsvClient } from "./client";
import { resolveGradleProjects } from "./gradle/index";
import { buildToolGate, createGradleStrategy, createMavenStrategy } from "./maven/host";
import { resolveMavenProjects } from "./maven/index";
import { detectFileType } from "./parsers";
import { runScan } from "./scan";
import type { ScanProgress, ScanResult } from "./types";
import type { Discovery } from "./workspace";

/**
 * The one vulnerability engine, as the extension host runs it: the advisory
 * cache, the log channel, Maven and Gradle resolution behind the build-tool
 * gate, and runScan. The OSV Vulnerability Scanner and the SCA Scanner both
 * scan through here, so they always agree on dependencies and advisories.
 */

const CACHE_FILE = "osv-cache.json";
let cache: OsvCache | undefined;
let cacheLoad: Promise<OsvCache> | undefined;
let logChannel: vscode.LogOutputChannel | undefined;

/** "DevSnip Pro: OSV Scanner" in the Output panel: what each scan found, queried and dropped, stage by stage. */
export function scanLog(): vscode.LogOutputChannel {
  logChannel ??= vscode.window.createOutputChannel("DevSnip Pro: OSV Scanner", { log: true });
  return logChannel;
}

export function toolVersion(context: vscode.ExtensionContext): string {
  return String(context.extension?.packageJSON?.version ?? "dev");
}

export async function loadCache(context: vscode.ExtensionContext): Promise<OsvCache> {
  if (cache) return cache;
  cacheLoad ??= (async () => {
    const fresh = new OsvCache(2000);
    try {
      if (context.globalStorageUri) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE));
        fresh.load(JSON.parse(Buffer.from(bytes).toString("utf8")));
      }
    } catch { /* first run, or an unreadable cache: start empty */ }
    cache = fresh;
    return fresh;
  })();
  return cacheLoad;
}

export async function saveCache(context: vscode.ExtensionContext): Promise<void> {
  if (!cache?.dirty || !context.globalStorageUri) return;
  try {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE), Buffer.from(JSON.stringify(cache.toJSON()), "utf8"));
    cache.dirty = false;
  } catch (error) {
    console.warn("DevSnip Pro: could not save the OSV cache.", error);
  }
}

/** Clears the in-memory advisory cache (tests and the "Clear cached advisories" action). */
export function clearMemoryCache(): void {
  cache?.clear();
}

export interface EngineScanRequest {
  context: vscode.ExtensionContext;
  discovery: Discovery;
  label: string;
  workspace: { name: string; folders: string[] };
  source: ScanResult["source"];
  signal: AbortSignal;
  fresh?: boolean;
  /** Who is scanning, for the log ("OSV scan", "SCA scan"). */
  title: string;
  onProgress: (progress: ScanProgress) => void;
}

/** Runs one scan through the shared engine. */
export async function runEngineScan(request: EngineScanRequest): Promise<{ result: ScanResult; client: OsvClient }> {
  const { context, discovery } = request;
  const files = discovery.files;
  const store = await loadCache(context);
  const client = new OsvClient({ userAgent: `DevSnip-Pro/${toolVersion(context)} (VS Code ${vscode.version}; ${request.title})` });
  const log = scanLog();
  log.info(`---- ${request.title} of ${request.label} (DevSnip Pro ${toolVersion(context)}) ----`);
  const pomPaths = files.filter(f => detectFileType(f.path)?.id === "pom").map(f => f.path);
  const allowBuildTools = buildToolGate(context, message => log.info(message));
  const result = await runScan(files, {
    onLog: message => log.info(message),
    resolveMaven: async (poms, signal) => {
      const strategy = await createMavenStrategy({ context, allowBuildTools, locations: discovery.locations, pomPaths, onLog: message => log.info(message) });
      return resolveMavenProjects(poms, strategy, { signal, onLog: message => log.info(message), onProgress: message => request.onProgress({ phase: "parse", message, fraction: 0.08 }) });
    },
    resolveGradle: async (gradleFiles, signal) => {
      const buildFiles = gradleFiles.filter(f => !f.context && /build\.gradle(\.kts)?$/.test(f.path)).map(f => f.path);
      const strategy = await createGradleStrategy({ context, allowBuildTools, locations: discovery.locations, buildFiles, onLog: message => log.info(message) });
      return resolveGradleProjects(gradleFiles, strategy, { signal, onLog: message => log.info(message), onProgress: message => request.onProgress({ phase: "parse", message, fraction: 0.09 }) });
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
