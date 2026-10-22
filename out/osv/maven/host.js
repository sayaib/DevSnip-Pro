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
exports.createGradleStrategy = exports.createMavenStrategy = exports.createRepository = exports.clearPomCache = exports.localRepository = exports.buildToolGate = exports.buildToolSettings = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const cli_1 = require("./cli");
const cli_2 = require("../gradle/cli");
const resolver_1 = require("./resolver");
const CONSENT_KEY = "devsnip.osv.buildToolConsent";
function buildToolSettings() {
    const config = vscode.workspace.getConfiguration("devsnip.osvScanner");
    const mode = config.get("buildToolResolution", "ask");
    return {
        mode: mode === "always" || mode === "never" ? mode : "ask",
        downloadPoms: config.get("downloadPoms", true) !== false,
        timeoutMs: Math.min(3600, Math.max(30, Number(config.get("buildToolTimeoutSeconds", 300)) || 300)) * 1000
    };
}
exports.buildToolSettings = buildToolSettings;
/**
 * Whether build tools may run for this scan: trusted workspace, setting, and
 * (in "ask" mode) one consent per workspace. `tools` names what would run, e.g. ["./mvnw", "./gradlew"].
 */
function buildToolGate(context, onLog) {
    let decision;
    return tools => {
        decision ?? (decision = (async () => {
            const settings = buildToolSettings();
            if (settings.mode === "never") {
                onLog("Build tools: not run (devsnip.osvScanner.buildToolResolution is \"never\"); using the built-in resolver.");
                return false;
            }
            if (!vscode.workspace.isTrusted) {
                onLog("Build tools: not run because the workspace is not trusted (they would execute the build's own code); using the built-in resolver.");
                return false;
            }
            if (settings.mode === "always")
                return true;
            const stored = context.workspaceState.get(CONSENT_KEY);
            if (stored === "allow")
                return true;
            if (stored === "deny") {
                onLog("Build tools: not allowed for this workspace; using the built-in resolver.");
                return false;
            }
            try {
                const choice = await vscode.window.showInformationMessage(`Resolve dependencies with ${tools.join(" and ")}?`, {
                    modal: true,
                    detail: `DevSnip Pro can run ${tools.join(" and ")} to list the exact dependency versions your build resolves, including transitive dependencies from Spring Boot starters and BOMs. Only dependency listing runs (Maven: dependency:tree; Gradle: a read-only task added by an init script); nothing is compiled, installed or changed. The build tool may download artifacts and runs your build's own code (Maven extensions, Gradle build scripts). Otherwise DevSnip Pro resolves the dependencies itself from your POMs or build files. Change this any time with the setting devsnip.osvScanner.buildToolResolution.`
                }, "Allow", "Use Built-in Resolver");
                if (choice === "Allow") {
                    await context.workspaceState.update(CONSENT_KEY, "allow");
                    return true;
                }
                if (choice === "Use Built-in Resolver") {
                    await context.workspaceState.update(CONSENT_KEY, "deny");
                    return false;
                }
            }
            catch { /* hosts without modal dialogs (tests): treated as not now */ }
            onLog("Build tools: not run (no consent for this workspace yet); using the built-in resolver.");
            return false;
        })());
        return decision;
    };
}
exports.buildToolGate = buildToolGate;
/** The local repository Maven uses: `<localRepository>` in ~/.m2/settings.xml, or ~/.m2/repository. */
function localRepository(home = os.homedir()) {
    try {
        const settings = fs.readFileSync(path.join(home, ".m2", "settings.xml"), "utf8");
        const configured = /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(settings.replace(/<!--[\s\S]*?-->/g, ""))?.[1];
        if (configured)
            return configured.replace(/\$\{user\.home\}/g, home).replace(/^~(?=[/\\])/, home);
    }
    catch { /* no settings.xml */ }
    return path.join(home, ".m2", "repository");
}
exports.localRepository = localRepository;
async function fetchText(url, signal) {
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
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetchImpl(url, { headers: { "User-Agent": "DevSnip-Pro-OSV-Scanner" }, signal: controller.signal });
            const text = response.status === 200 ? await response.text() : "";
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`HTTP ${response.status}`);
            }
            else
                return { status: response.status, text };
        }
        catch (error) {
            lastError = error;
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        }
        await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
/** Downloaded release POMs never change, so they are kept in global storage. */
function diskCache(context) {
    const base = context.globalStorageUri?.fsPath;
    if (!base)
        return undefined;
    const dir = path.join(base, "osv-maven-poms");
    return {
        async get(key) { try {
            return await fs.promises.readFile(path.join(dir, key), "utf8");
        }
        catch {
            return undefined;
        } },
        async set(key, text) {
            try {
                await fs.promises.mkdir(path.dirname(path.join(dir, key)), { recursive: true });
                await fs.promises.writeFile(path.join(dir, key), text, "utf8");
            }
            catch { /* the cache is only an optimisation */ }
        }
    };
}
/** Removes downloaded POMs (the "Clear cached advisories" action and test resets). */
async function clearPomCache(context) {
    const base = context.globalStorageUri?.fsPath;
    if (base)
        await fs.promises.rm(path.join(base, "osv-maven-poms"), { recursive: true, force: true }).catch(() => undefined);
}
exports.clearPomCache = clearPomCache;
/** POMs for the built-in resolver: the local Maven repository first, then (when allowed) Maven Central, cached. */
function createRepository(context, settings, onLog) {
    const local = localRepository();
    const offline = !settings.downloadPoms;
    return {
        repository: (0, resolver_1.createPomRepository)({
            readLocal: async (relative) => { try {
                return await fs.promises.readFile(path.join(local, relative), "utf8");
            }
            catch {
                return undefined;
            } },
            fetchText: offline ? undefined : fetchText,
            cache: offline ? undefined : diskCache(context),
            concurrency: 8,
            onFetch: (url, outcome) => { if (outcome !== "ok")
                onLog(`POM: ${url} → ${outcome}`); }
        }),
        label: offline ? `POMs from the local Maven repository ${local} only` : `POMs from the local Maven repository and ${resolver_1.MAVEN_CENTRAL.replace(/^https:\/\//, "")}`
    };
}
exports.createRepository = createRepository;
async function createMavenStrategy(request) {
    const settings = buildToolSettings();
    const { repository, label } = createRepository(request.context, settings, request.onLog);
    const strategy = { repository, repositoryLabel: label };
    request.onLog(`Maven: build tools "${settings.mode}", POM downloads ${settings.downloadPoms ? "on" : "off"}.`);
    const first = request.pomPaths.map(p => request.locations.get(p)).find(Boolean);
    if (!first || settings.mode === "never")
        return strategy;
    const executable = (0, cli_1.findMavenExecutable)(path.dirname(first.fsPath), first.root);
    if (!executable) {
        request.onLog("Maven: no Maven Wrapper (mvnw) or mvn on PATH; using the built-in resolver.");
        return strategy;
    }
    if (!(await request.allowBuildTools([executable.label])))
        return strategy;
    strategy.cliLabel = executable.label;
    strategy.runCli = async (rootPom, signal) => {
        const location = request.locations.get(rootPom);
        if (!location)
            return { error: `${rootPom} is not on disk.` };
        const cwd = path.dirname(location.fsPath);
        // Each project uses its own wrapper when it has one.
        const own = (0, cli_1.findMavenExecutable)(cwd, location.root) ?? executable;
        try {
            return await (0, cli_1.runDependencyTree)(own, cwd, { timeoutMs: settings.timeoutMs, signal });
        }
        catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
    };
    return strategy;
}
exports.createMavenStrategy = createMavenStrategy;
/** Gradle: the init-script task when build tools may run, otherwise the build-script reader. */
async function createGradleStrategy(request) {
    const settings = buildToolSettings();
    const { repository, label } = createRepository(request.context, settings, request.onLog);
    // Workspace-relative directories for the absolute project directories Gradle reports.
    const dirs = new Map();
    for (const [relative, location] of request.locations) {
        const dir = path.posix.dirname(relative);
        dirs.set(path.dirname(location.fsPath), dir === "." ? "" : dir);
    }
    const relativeDir = (absolute) => {
        const known = dirs.get(absolute);
        if (known !== undefined)
            return known;
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absolute));
        if (!folder)
            return undefined;
        const rel = vscode.workspace.asRelativePath(vscode.Uri.file(absolute), (vscode.workspace.workspaceFolders?.length ?? 0) > 1).replace(/\\/g, "/");
        return rel === absolute.replace(/\\/g, "/") ? "" : rel;
    };
    const strategy = { repository, repositoryLabel: label, relativeDir };
    const first = request.buildFiles.map(p => request.locations.get(p)).find(Boolean);
    if (!first || settings.mode === "never")
        return strategy;
    const executable = (0, cli_2.findGradleExecutable)(path.dirname(first.fsPath), first.root);
    if (!executable) {
        request.onLog("Gradle: no Gradle Wrapper (gradlew) or gradle on PATH; reading build scripts instead.");
        return strategy;
    }
    if (!(await request.allowBuildTools([executable.label])))
        return strategy;
    strategy.cliLabel = executable.label;
    strategy.runCli = async (rootDir, signal) => {
        const anchor = [...request.locations].find(([relative]) => (path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative)) === rootDir);
        if (!anchor)
            return { error: `${rootDir || "."} is not on disk.` };
        const cwd = path.dirname(anchor[1].fsPath);
        const own = (0, cli_2.findGradleExecutable)(cwd, anchor[1].root) ?? executable;
        try {
            return await (0, cli_2.runGradleDependencies)(own, cwd, { timeoutMs: settings.timeoutMs, signal });
        }
        catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
        }
    };
    return strategy;
}
exports.createGradleStrategy = createGradleStrategy;
//# sourceMappingURL=host.js.map