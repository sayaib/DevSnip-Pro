import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { findMavenExecutable, runDependencyTree } from "./cli";
import type { MavenStrategy } from "./index";
import type { GradleStrategy } from "../gradle/index";
import { findGradleExecutable, runGradleDependencies } from "../gradle/cli";
import { createPomRepository, MAVEN_CENTRAL, RepositoryOptions } from "./resolver";

/**
 * How build tools take part in a scan (settings under `devsnip.osvScanner`):
 *
 *  - buildToolResolution: "ask" (default) runs Maven / Gradle in a trusted
 *    workspace after the user allows it once for that workspace; "always"
 *    runs them in trusted workspaces without asking; "never" does not run them.
 *    Running a build tool loads the build's own code (Maven extensions, Gradle
 *    build scripts), so it never happens in an untrusted workspace.
 *  - downloadPoms: the built-in resolver may read POMs from Maven Central
 *    (only coordinates are requested). Off: local Maven repository only.
 *  - buildToolTimeoutSeconds: time limit for one Maven or Gradle run.
 */

export type BuildToolMode = "ask" | "always" | "never";
const CONSENT_KEY = "devsnip.osv.buildToolConsent";

export interface BuildToolSettings { mode: BuildToolMode; downloadPoms: boolean; timeoutMs: number }

export function buildToolSettings(): BuildToolSettings {
  const config = vscode.workspace.getConfiguration("devsnip.osvScanner");
  const mode = config.get<string>("buildToolResolution", "ask");
  return {
    mode: mode === "always" || mode === "never" ? mode : "ask",
    downloadPoms: config.get<boolean>("downloadPoms", true) !== false,
    timeoutMs: Math.min(3600, Math.max(30, Number(config.get<number>("buildToolTimeoutSeconds", 300)) || 300)) * 1000
  };
}

/**
 * Whether build tools may run for this scan: trusted workspace, setting, and
 * (in "ask" mode) one consent per workspace. `tools` names what would run, e.g. ["./mvnw", "./gradlew"].
 */
export function buildToolGate(context: vscode.ExtensionContext, onLog: (message: string) => void): (tools: string[]) => Promise<boolean> {
  let decision: Promise<boolean> | undefined;
  return tools => {
    decision ??= (async () => {
      const settings = buildToolSettings();
      if (settings.mode === "never") { onLog("Build tools: not run (devsnip.osvScanner.buildToolResolution is \"never\"); using the built-in resolver."); return false; }
      if (!vscode.workspace.isTrusted) { onLog("Build tools: not run because the workspace is not trusted (they would execute the build's own code); using the built-in resolver."); return false; }
      if (settings.mode === "always") return true;
      const stored = context.workspaceState.get<string>(CONSENT_KEY);
      if (stored === "allow") return true;
      if (stored === "deny") { onLog("Build tools: not allowed for this workspace; using the built-in resolver."); return false; }
      try {
        const choice = await vscode.window.showInformationMessage(
          `Resolve dependencies with ${tools.join(" and ")}?`,
          {
            modal: true,
            detail: `DevSnip Pro can run ${tools.join(" and ")} to list the exact dependency versions your build resolves, including transitive dependencies from Spring Boot starters and BOMs. Only dependency listing runs (Maven: dependency:tree; Gradle: a read-only task added by an init script); nothing is compiled, installed or changed. The build tool may download artifacts and runs your build's own code (Maven extensions, Gradle build scripts). Otherwise DevSnip Pro resolves the dependencies itself from your POMs or build files. Change this any time with the setting devsnip.osvScanner.buildToolResolution.`
          },
          "Allow",
          "Use Built-in Resolver"
        );
        if (choice === "Allow") { await context.workspaceState.update(CONSENT_KEY, "allow"); return true; }
        if (choice === "Use Built-in Resolver") { await context.workspaceState.update(CONSENT_KEY, "deny"); return false; }
      } catch { /* hosts without modal dialogs (tests): treated as not now */ }
      onLog("Build tools: not run (no consent for this workspace yet); using the built-in resolver.");
      return false;
    })();
    return decision;
  };
}

/** The local repository Maven uses: `<localRepository>` in ~/.m2/settings.xml, or ~/.m2/repository. */
export function localRepository(home = os.homedir()): string {
  try {
    const settings = fs.readFileSync(path.join(home, ".m2", "settings.xml"), "utf8");
    const configured = /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(settings.replace(/<!--[\s\S]*?-->/g, ""))?.[1];
    if (configured) return configured.replace(/\$\{user\.home\}/g, home).replace(/^~(?=[/\\])/, home);
  } catch { /* no settings.xml */ }
  return path.join(home, ".m2", "repository");
}

async function fetchText(url: string, signal?: AbortSignal): Promise<{ status: number; text: string }> {
  const fetchImpl = (globalThis as { fetch?: (url: string, init: unknown) => Promise<{ status: number; text(): Promise<string> }> }).fetch;
  if (!fetchImpl) throw new Error("fetch is not available");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new Error("cancelled");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(url, { headers: { "User-Agent": "DevSnip-Pro-OSV-Scanner" }, signal: controller.signal });
      const text = response.status === 200 ? await response.text() : "";
      if (response.status === 429 || response.status >= 500) { lastError = new Error(`HTTP ${response.status}`); }
      else return { status: response.status, text };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface StrategyRequest {
  context: vscode.ExtensionContext;
  /** Shared per scan, so one consent covers every build tool. */
  allowBuildTools: (tools: string[]) => Promise<boolean>;
  /** Workspace-relative POM path → file system path and workspace folder. */
  locations: Map<string, { fsPath: string; root: string }>;
  pomPaths: string[];
  onLog: (message: string) => void;
}

/** Downloaded release POMs never change, so they are kept in global storage. */
function diskCache(context: vscode.ExtensionContext): RepositoryOptions["cache"] {
  const base = context.globalStorageUri?.fsPath;
  if (!base) return undefined;
  const dir = path.join(base, "osv-maven-poms");
  return {
    async get(key) { try { return await fs.promises.readFile(path.join(dir, key), "utf8"); } catch { return undefined; } },
    async set(key, text) {
      try {
        await fs.promises.mkdir(path.dirname(path.join(dir, key)), { recursive: true });
        await fs.promises.writeFile(path.join(dir, key), text, "utf8");
      } catch { /* the cache is only an optimisation */ }
    }
  };
}

/** Removes downloaded POMs (the "Clear cached advisories" action and test resets). */
export async function clearPomCache(context: vscode.ExtensionContext): Promise<void> {
  const base = context.globalStorageUri?.fsPath;
  if (base) await fs.promises.rm(path.join(base, "osv-maven-poms"), { recursive: true, force: true }).catch(() => undefined);
}

/** POMs for the built-in resolver: the local Maven repository first, then (when allowed) Maven Central, cached. */
export function createRepository(context: vscode.ExtensionContext, settings: BuildToolSettings, onLog: (message: string) => void): { repository: MavenStrategy["repository"]; label: string } {
  const local = localRepository();
  const offline = !settings.downloadPoms;
  return {
    repository: createPomRepository({
      readLocal: async relative => { try { return await fs.promises.readFile(path.join(local, relative), "utf8"); } catch { return undefined; } },
      fetchText: offline ? undefined : fetchText,
      cache: offline ? undefined : diskCache(context),
      concurrency: 8,
      onFetch: (url, outcome) => { if (outcome !== "ok") onLog(`POM: ${url} → ${outcome}`); }
    }),
    label: offline ? `POMs from the local Maven repository ${local} only` : `POMs from the local Maven repository and ${MAVEN_CENTRAL.replace(/^https:\/\//, "")}`
  };
}

export async function createMavenStrategy(request: StrategyRequest): Promise<MavenStrategy> {
  const settings = buildToolSettings();
  const { repository, label } = createRepository(request.context, settings, request.onLog);
  const strategy: MavenStrategy = { repository, repositoryLabel: label };
  request.onLog(`Maven: build tools "${settings.mode}", POM downloads ${settings.downloadPoms ? "on" : "off"}.`);
  const first = request.pomPaths.map(p => request.locations.get(p)).find(Boolean);
  if (!first || settings.mode === "never") return strategy;
  const executable = findMavenExecutable(path.dirname(first.fsPath), first.root);
  if (!executable) {
    request.onLog("Maven: no Maven Wrapper (mvnw) or mvn on PATH; using the built-in resolver.");
    return strategy;
  }
  if (!(await request.allowBuildTools([executable.label]))) return strategy;
  strategy.cliLabel = executable.label;
  strategy.runCli = async (rootPom, signal) => {
    const location = request.locations.get(rootPom);
    if (!location) return { error: `${rootPom} is not on disk.` };
    const cwd = path.dirname(location.fsPath);
    // Each project uses its own wrapper when it has one.
    const own = findMavenExecutable(cwd, location.root) ?? executable;
    try {
      return await runDependencyTree(own, cwd, { timeoutMs: settings.timeoutMs, signal });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  return strategy;
}

export interface GradleRequest {
  context: vscode.ExtensionContext;
  allowBuildTools: (tools: string[]) => Promise<boolean>;
  locations: Map<string, { fsPath: string; root: string }>;
  buildFiles: string[];
  onLog: (message: string) => void;
}

/** Gradle: the init-script task when build tools may run, otherwise the build-script reader. */
export async function createGradleStrategy(request: GradleRequest): Promise<GradleStrategy> {
  const settings = buildToolSettings();
  const { repository, label } = createRepository(request.context, settings, request.onLog);
  // Workspace-relative directories for the absolute project directories Gradle reports.
  const dirs = new Map<string, string>();
  for (const [relative, location] of request.locations) {
    const dir = path.posix.dirname(relative);
    dirs.set(path.dirname(location.fsPath), dir === "." ? "" : dir);
  }
  const relativeDir = (absolute: string) => {
    const known = dirs.get(absolute);
    if (known !== undefined) return known;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolute));
    if (!folder) return undefined;
    const rel = vscode.workspace.asRelativePath(vscode.Uri.file(absolute), (vscode.workspace.workspaceFolders?.length ?? 0) > 1).replace(/\\/g, "/");
    return rel === absolute.replace(/\\/g, "/") ? "" : rel;
  };
  const strategy: GradleStrategy = { repository, repositoryLabel: label, relativeDir };
  const first = request.buildFiles.map(p => request.locations.get(p)).find(Boolean);
  if (!first || settings.mode === "never") return strategy;
  const executable = findGradleExecutable(path.dirname(first.fsPath), first.root);
  if (!executable) {
    request.onLog("Gradle: no Gradle Wrapper (gradlew) or gradle on PATH; reading build scripts instead.");
    return strategy;
  }
  if (!(await request.allowBuildTools([executable.label]))) return strategy;
  strategy.cliLabel = executable.label;
  strategy.runCli = async (rootDir, signal) => {
    const anchor = [...request.locations].find(([relative]) => (path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative)) === rootDir);
    if (!anchor) return { error: `${rootDir || "."} is not on disk.` };
    const cwd = path.dirname(anchor[1].fsPath);
    const own = findGradleExecutable(cwd, anchor[1].root) ?? executable;
    try {
      return await runGradleDependencies(own, cwd, { timeoutMs: settings.timeoutMs, signal });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
  return strategy;
}
