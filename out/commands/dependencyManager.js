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
exports.getDependencyManagerHtml = exports.registerDependencyManagerCommand = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const axios_1 = __importDefault(require("axios"));
const command_registry_1 = require("../utils/command-registry");
const analytics_1 = require("../analytics");
const webview_ui_1 = require("../utils/webview-ui");
const dependency_manager_1 = require("../services/dependency-manager");
const COMMAND_ID = "sayaib.hue-console.dependencyManager";
const OUTPUT_NAME = "DevSnip Pro: Dependencies";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_REGISTRY_LOOKUPS = 500;
const REGISTRY_CONCURRENCY = 6;
const REGISTRY_TTL_MS = 15 * 60 * 1000;
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const SKIP_GLOB = "**/{node_modules,.git,dist,out,coverage,.next,.nuxt,.venv,venv,__pycache__,vendor,target,.gradle,.terraform,.vscode-test,Pods,site-packages,bower_components}/**";
const MANIFEST_GLOBS = [
    "**/package.json", "**/requirements*.txt", "**/requirements/*.txt", "**/pyproject.toml", "**/pom.xml",
    "**/build.gradle", "**/build.gradle.kts", "**/gradle/libs.versions.toml", "**/gradle.properties"
];
const MARKER_GLOB = "**/{package-lock.json,npm-shrinkwrap.json,yarn.lock,pnpm-lock.yaml,.yarnrc.yml,mvnw,mvnw.cmd,gradlew,gradlew.bat}";
// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
/**
 * PATH used for detection and installs. A VS Code window started from the
 * macOS Dock or a Linux desktop entry inherits a minimal PATH, so the usual
 * install locations are appended or a working toolchain looks missing.
 */
function buildSearchPath(platform) {
    const current = process.env.PATH || process.env.Path || "";
    const home = os.homedir();
    const extra = platform === "win32"
        ? [
            process.env.APPDATA && path.join(process.env.APPDATA, "npm"),
            process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "pnpm"),
            process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs"),
            process.env.USERPROFILE && path.join(process.env.USERPROFILE, "scoop", "shims"),
            process.env.ChocolateyInstall && path.join(process.env.ChocolateyInstall, "bin")
        ]
        : [
            "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/snap/bin",
            path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), path.join(home, ".yarn", "bin"),
            path.join(home, ".volta", "bin"), path.join(home, ".bun", "bin"), path.join(home, "Library", "pnpm"),
            path.join(home, ".local", "share", "pnpm"), path.join(home, ".sdkman", "candidates", "maven", "current", "bin"),
            path.join(home, ".sdkman", "candidates", "gradle", "current", "bin")
        ];
    const separator = platform === "win32" ? ";" : ":";
    return [current, ...extra.filter((entry) => Boolean(entry))].filter(Boolean).join(separator);
}
function isExecutableFile(file) {
    try {
        if (!fs.statSync(file).isFile())
            return false;
        if (process.platform === "win32")
            return true;
        fs.accessSync(file, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function fileExists(file) {
    try {
        return fs.statSync(file).isFile();
    }
    catch {
        return false;
    }
}
function workspaceRoots() {
    return (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
}
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function childEnv(platform, searchPath) {
    return {
        ...(0, dependency_manager_1.withSearchPath)(process.env, searchPath, platform),
        // Nothing the panel runs may wait on a prompt the user cannot see.
        PIP_NO_INPUT: "1",
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
        GIT_TERMINAL_PROMPT: "0",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        npm_config_color: "false",
        npm_config_progress: "false",
        npm_config_update_notifier: "false"
    };
}
/** Stops a process and everything it started (npm spawns node, which spawns install scripts). */
function killTree(child, platform) {
    if (child.pid === undefined || child.exitCode !== null)
        return;
    const pid = child.pid;
    try {
        if (platform === "win32") {
            (0, child_process_1.spawn)("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        }
        else {
            process.kill(-pid, "SIGTERM");
            setTimeout(() => {
                try {
                    process.kill(-pid, "SIGKILL");
                }
                catch { /* already gone */ }
            }, 5000);
        }
    }
    catch {
        try {
            child.kill();
        }
        catch { /* already gone */ }
    }
}
function runProcess(file, args, platform, searchPath, options) {
    return new Promise(resolve => {
        let plan;
        try {
            plan = (0, dependency_manager_1.planSpawn)(file, args, platform, process.env.ComSpec || "cmd.exe");
        }
        catch (error) {
            resolve({ code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error), timedOut: false, cancelled: false });
            return;
        }
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let settled = false;
        let child;
        try {
            child = (0, child_process_1.spawn)(plan.file, plan.args, {
                cwd: options.cwd,
                env: childEnv(platform, searchPath),
                windowsHide: true,
                windowsVerbatimArguments: plan.windowsVerbatimArguments,
                // Its own process group on POSIX, so cancelling stops the whole tree.
                detached: platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"],
                shell: false
            });
        }
        catch (error) {
            const failure = error;
            resolve({ code: null, stdout: "", stderr: failure.message, errorCode: failure.code, timedOut: false, cancelled: false });
            return;
        }
        options.onStart?.(child);
        const cap = (text) => (text.length > 2000000 ? text.slice(-2000000) : text);
        child.stdout?.on("data", (chunk) => {
            const text = chunk.toString("utf8").replace(ANSI, "");
            stdout = cap(stdout + text);
            options.onOutput?.(text);
        });
        child.stderr?.on("data", (chunk) => {
            const text = chunk.toString("utf8").replace(ANSI, "");
            stderr = cap(stderr + text);
            options.onOutput?.(text);
        });
        const timer = setTimeout(() => {
            timedOut = true;
            killTree(child, platform);
        }, options.timeoutMs);
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve({ code: null, stdout, stderr, timedOut, cancelled: Boolean(options.isCancelled?.()), ...result });
        };
        child.on("error", (error) => finish({ errorCode: error.code, stderr: stderr || error.message }));
        child.on("close", code => finish({ code }));
    });
}
class ToolResolver {
    constructor(platform, searchPath) {
        this.platform = platform;
        this.searchPath = searchPath;
        this.cache = new Map();
    }
    resolve(project) {
        const perProject = project.tool === "python" || project.tool === "mvnw" || project.tool === "gradlew";
        const key = perProject ? `${project.tool}|${project.dir}` : project.tool;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.lookup(project).catch((error) => ({
                id: project.tool, found: false, prefixArgs: [], display: project.tool,
                hint: `Detection failed: ${error instanceof Error ? error.message : String(error)}`
            }));
            this.cache.set(key, pending);
        }
        return pending;
    }
    onPath(name) {
        return (0, dependency_manager_1.resolveExecutable)(name, this.searchPath, this.platform, isExecutableFile, workspaceRoots(), process.env.PATHEXT || undefined);
    }
    /** First output line matching `pick`, or undefined when the command failed. */
    async probe(file, args, cwd, pick = /\S/, timeoutMs = 15000) {
        const result = await runProcess(file, args, this.platform, this.searchPath, { cwd, timeoutMs });
        if (result.code !== 0)
            return undefined;
        const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(entry => entry.trim()).find(entry => pick.test(entry));
        return line ? line.slice(0, 160) : undefined;
    }
    async lookup(project) {
        const tool = project.tool;
        if (tool === "mvnw" || tool === "gradlew") {
            // Wrappers are not run during a scan: the first run downloads a whole
            // Maven/Gradle distribution, which a scan must never trigger.
            const wrapper = project.wrapperPath;
            const display = (0, dependency_manager_1.wrapperDisplay)(project, this.platform);
            if (!fileExists(wrapper))
                return { id: tool, found: false, prefixArgs: [], display, hint: (0, dependency_manager_1.toolInstallHint)(tool, this.platform) };
            if (this.platform !== "win32" && !isExecutableFile(wrapper)) {
                // A wrapper committed without its executable bit still runs through sh.
                return { id: tool, found: true, file: "/bin/sh", prefixArgs: [wrapper], display, location: wrapper, version: "project wrapper" };
            }
            return { id: tool, found: true, file: wrapper, prefixArgs: [], display, location: wrapper, version: "project wrapper" };
        }
        if (tool === "python")
            return this.lookupPython(project);
        const file = this.onPath(tool);
        if (!file)
            return { id: tool, found: false, prefixArgs: [], display: tool, hint: (0, dependency_manager_1.toolInstallHint)(tool, this.platform) };
        const version = tool === "mvn"
            ? await this.probe(file, ["-v"], project.dir, /^Apache Maven/i, 30000)
            : tool === "gradle"
                ? await this.probe(file, ["--version"], project.dir, /^Gradle\s/i, 60000)
                : await this.probe(file, ["--version"], project.dir);
        if (!version) {
            return { id: tool, found: false, prefixArgs: [], display: tool, location: file, hint: `\`${file}\` exists but did not run. ${(0, dependency_manager_1.toolInstallHint)(tool, this.platform)}` };
        }
        const cleaned = version.replace(/^(Apache Maven|Gradle)\s+/i, "").replace(/\s*\(.*\)\s*$/, "");
        return { id: tool, found: true, file, prefixArgs: [], display: tool, version: cleaned || version, location: file };
    }
    async lookupPython(project) {
        const candidates = [];
        const configured = vscode.workspace.getConfiguration("python", vscode.Uri.file(project.dir)).get("defaultInterpreterPath");
        if (configured && path.isAbsolute(configured))
            candidates.push({ file: configured, display: configured });
        const roots = [project.dir, ...workspaceRoots().filter(root => (0, dependency_manager_1.isInside)(project.dir, root))];
        for (const root of roots) {
            for (const name of [".venv", "venv", "env"]) {
                const file = (0, dependency_manager_1.venvInterpreter)(path.join(root, name), this.platform);
                const relative = path.relative(project.dir, file);
                const display = relative.startsWith("..") ? file : this.platform === "win32" ? relative : `./${relative.replace(/\\/g, "/")}`;
                candidates.push({ file, display });
            }
        }
        if (process.env.VIRTUAL_ENV)
            candidates.push({ file: (0, dependency_manager_1.venvInterpreter)(process.env.VIRTUAL_ENV, this.platform), display: "python" });
        for (const name of this.platform === "win32" ? ["python"] : ["python3", "python"]) {
            const file = this.onPath(name);
            // The Microsoft Store alias opens the Store instead of running Python.
            if (file && !/WindowsApps/i.test(file))
                candidates.push({ file, display: name });
        }
        const tried = new Set();
        for (const candidate of candidates) {
            if (tried.has(candidate.file) || !isExecutableFile(candidate.file))
                continue;
            tried.add(candidate.file);
            const python = await this.probe(candidate.file, ["--version"], project.dir, /^Python\s/i);
            if (!python)
                continue;
            const isVenv = fileExists(path.join(path.dirname(path.dirname(candidate.file)), "pyvenv.cfg"));
            const pip = await this.probe(candidate.file, ["-m", "pip", "--version"], project.dir, /^pip\s/i, 30000);
            if (!pip) {
                return {
                    id: "python", found: false, prefixArgs: [], display: candidate.display, location: candidate.file, isVenv,
                    hint: `${python} was found at ${candidate.file}, but pip is not available for it. Run \`${candidate.display} -m ensurepip --upgrade\`, then Rescan.`
                };
            }
            const pipVersion = /^pip\s+(\S+)/i.exec(pip)?.[1];
            return {
                id: "python", found: true, file: candidate.file, prefixArgs: [], display: candidate.display, location: candidate.file, isVenv,
                version: `${python}${pipVersion ? `, pip ${pipVersion}` : ""}${isVenv ? " (virtual environment)" : ""}`
            };
        }
        return { id: "python", found: false, prefixArgs: [], display: this.platform === "win32" ? "python" : "python3", hint: (0, dependency_manager_1.toolInstallHint)("python", this.platform) };
    }
}
// ---------------------------------------------------------------------------
// Registry lookups
// ---------------------------------------------------------------------------
const registryCache = new Map();
function describeNetworkError(error, host) {
    if (axios_1.default.isAxiosError(error)) {
        const code = error.code || "";
        if (/ECONNABORTED|ETIMEDOUT/.test(code))
            return `${host} did not answer in time. Check your connection or proxy.`;
        if (/ENOTFOUND|EAI_AGAIN/.test(code))
            return `${host} could not be resolved. You may be offline, or behind a proxy that needs HTTPS_PROXY set.`;
        if (/CERT|SELF_SIGNED|UNABLE_TO/.test(code))
            return `${host}'s certificate was not trusted (a proxy may be re-signing traffic). Set NODE_EXTRA_CA_CERTS to your organisation's CA.`;
        return `${host} could not be reached (${code || error.message}).`;
    }
    return `${host} could not be reached: ${error instanceof Error ? error.message : String(error)}`;
}
async function fetchRegistryInfo(ecosystem, name) {
    const key = `${ecosystem}:${name}`;
    const cached = registryCache.get(key);
    if (cached && Date.now() - cached.at < REGISTRY_TTL_MS)
        return cached.info;
    const common = { timeout: 20000, maxContentLength: 80 * 1024 * 1024, validateStatus: () => true };
    const userAgent = "DevSnip-Pro-VSCode";
    let info;
    try {
        if (ecosystem === "node") {
            const response = await axios_1.default.get((0, dependency_manager_1.npmRegistryUrl)(name), {
                ...common,
                headers: { "User-Agent": userAgent, Accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" }
            });
            info = response.status === 404
                ? { versions: [], error: "Not found on registry.npmjs.org. A private package needs its own registry, which this check does not query." }
                : response.status >= 400 ? { versions: [], error: `registry.npmjs.org answered HTTP ${response.status}.` } : (0, dependency_manager_1.parseNpmPackument)(response.data);
        }
        else if (ecosystem === "python") {
            const response = await axios_1.default.get((0, dependency_manager_1.pypiUrl)(name), { ...common, headers: { "User-Agent": userAgent, Accept: "application/json" } });
            info = response.status === 404
                ? { versions: [], error: "Not found on pypi.org. A package from a private index is not checked." }
                : response.status >= 400 ? { versions: [], error: `pypi.org answered HTTP ${response.status}.` } : (0, dependency_manager_1.parsePypiDocument)(response.data);
        }
        else {
            info = { versions: [], error: "Not found on Maven Central or Google's Maven repository. Artifacts from other repositories are not checked." };
            for (const url of (0, dependency_manager_1.mavenMetadataUrls)(name)) {
                const response = await axios_1.default.get(url, { ...common, headers: { "User-Agent": userAgent }, responseType: "text", transformResponse: [(data) => data] });
                if (response.status === 200 && typeof response.data === "string") {
                    info = (0, dependency_manager_1.parseMavenMetadata)(response.data);
                    break;
                }
                if (response.status !== 404)
                    info = { versions: [], error: `${new URL(url).host} answered HTTP ${response.status}.` };
            }
        }
    }
    catch (error) {
        const host = ecosystem === "node" ? "registry.npmjs.org" : ecosystem === "python" ? "pypi.org" : "Maven Central";
        // Failures are not cached, so the next scan tries again.
        return { versions: [], error: describeNetworkError(error, host) };
    }
    registryCache.set(key, { at: Date.now(), info });
    return info;
}
async function mapLimit(items, limit, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            await worker(items[index]);
        }
    });
    await Promise.all(runners);
}
// ---------------------------------------------------------------------------
// Installed versions
// ---------------------------------------------------------------------------
async function readInstalledNodeVersion(project, name, stopAt) {
    for (const candidate of (0, dependency_manager_1.nodeModuleManifestCandidates)(project.dir, name, stopAt)) {
        try {
            const manifest = JSON.parse(await fs.promises.readFile(candidate, "utf8"));
            if (manifest && typeof manifest.version === "string")
                return manifest.version;
        }
        catch {
            /* not installed at this level */
        }
    }
    return undefined;
}
async function directoryHasArtifacts(dir) {
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        // Gradle stores each file in a hash-named subdirectory; Maven stores them flat.
        return entries.some(entry => entry.isDirectory() || /\.(pom|jar|aar|module|klib)$/i.test(entry.name));
    }
    catch {
        return false;
    }
}
let mavenRepositoryPath;
function mavenRepository() {
    if (!mavenRepositoryPath) {
        const home = os.homedir();
        let settings;
        try {
            settings = fs.readFileSync(path.join(home, ".m2", "settings.xml"), "utf8");
        }
        catch {
            settings = undefined;
        }
        mavenRepositoryPath = (0, dependency_manager_1.mavenLocalRepository)(settings, home);
    }
    return mavenRepositoryPath;
}
function gradleHome() {
    return process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle");
}
async function readManifest(uri) {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_MANIFEST_BYTES)
            return undefined;
        return Buffer.from(bytes).toString("utf8");
    }
    catch {
        return undefined;
    }
}
async function collectProjectFiles() {
    const byRoot = new Map();
    const roots = workspaceRoots();
    for (const root of roots)
        byRoot.set(root, []);
    const place = (file) => {
        // The innermost folder wins when workspace folders are nested.
        const root = roots.filter(candidate => (0, dependency_manager_1.isInside)(file.path, candidate)).sort((a, b) => b.length - a.length)[0];
        if (root)
            byRoot.get(root).push(file);
    };
    const seen = new Set();
    for (const glob of MANIFEST_GLOBS) {
        for (const uri of await vscode.workspace.findFiles(glob, SKIP_GLOB, 2000)) {
            if (seen.has(uri.fsPath))
                continue;
            seen.add(uri.fsPath);
            const text = await readManifest(uri);
            if (text !== undefined)
                place({ path: uri.fsPath, text });
        }
    }
    for (const uri of await vscode.workspace.findFiles(MARKER_GLOB, SKIP_GLOB, 4000)) {
        if (seen.has(uri.fsPath))
            continue;
        seen.add(uri.fsPath);
        place({ path: uri.fsPath });
    }
    return byRoot;
}
function commandLine(state, spec) {
    return (0, dependency_manager_1.formatCommandLine)(spec, process.platform, state.tool.display || state.project.tool);
}
function needsInstall(dep) {
    return dep.dependency.registry && !dep.installedUnknown && (dep.verdict.status === "missing" || dep.verdict.status === "mismatch");
}
/** What the table shows: a known local verdict wins over "checking". */
function shownStatus(dep) {
    if (dep.installedUnknown || needsInstall(dep) || !dep.dependency.registry)
        return dep.verdict.status;
    return dep.pending ? "checking" : dep.verdict.status;
}
function manualHint(state, dep) {
    if (state.project.ecosystem !== "gradle" || dep.pending)
        return "";
    const target = dep.verdict.status === "outdated" ? dep.verdict.compatible : dep.verdict.status === "major" ? dep.verdict.latest : undefined;
    if (!target)
        return "";
    return `Edit ${dep.dependency.source}: ${(0, dependency_manager_1.gradleEditHint)(dep.dependency, target)}`;
}
function projectView(state) {
    const { project } = state;
    const counts = { total: state.dependencies.length, "up-to-date": 0, outdated: 0, major: 0, missing: 0, mismatch: 0, unknown: 0, checking: 0 };
    for (const dep of state.dependencies)
        counts[shownStatus(dep)]++;
    const missing = state.dependencies.filter(needsInstall);
    const outdated = state.dependencies.filter(dep => dep.verdict.status === "outdated" && dep.dependency.scope !== "peer");
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1 ? path.basename(state.root) : "";
    const relDir = path.relative(state.root, project.dir).replace(/\\/g, "/") || ".";
    const updateSpec = (0, dependency_manager_1.projectUpdateCommand)(project, outdated.map(dep => dep.dependency));
    const warnings = [...project.warnings];
    if (state.installedError)
        warnings.push(state.installedError);
    if (project.ecosystem === "python" && state.tool.found && !state.tool.isVenv) {
        warnings.push("The selected Python is not a virtual environment, so installs go into that interpreter for every project that uses it. Consider `python3 -m venv .venv`.");
    }
    return {
        id: project.id,
        folder,
        relDir,
        ecosystem: project.ecosystem,
        manager: project.manager === "yarn" && project.yarnBerry ? "yarn (berry)" : project.manager,
        detectedBy: project.detectedBy,
        manifests: project.manifests,
        warnings,
        tool: {
            name: state.tool.display,
            found: state.tool.found,
            version: state.tool.version || "",
            location: state.tool.location || "",
            hint: state.tool.hint || ""
        },
        counts,
        installLines: (0, dependency_manager_1.projectInstallCommand)(project, missing.map(dep => dep.dependency)).map(spec => commandLine(state, spec)),
        updateLine: updateSpec ? commandLine(state, updateSpec) : "",
        canInstall: state.tool.found && missing.length > 0,
        canUpdate: state.tool.found && outdated.length > 0 && (project.ecosystem === "node" || project.ecosystem === "python"),
        manualUpdates: project.ecosystem === "maven" || project.ecosystem === "gradle",
        dependencies: [...state.dependencies]
            .map(dep => ({ dep, status: shownStatus(dep) }))
            .sort((a, b) => (dependency_manager_1.STATUS_ORDER[a.status] ?? 4.5) - (dependency_manager_1.STATUS_ORDER[b.status] ?? 4.5)
            || a.dep.dependency.displayName.localeCompare(b.dep.dependency.displayName))
            .map(({ dep, status }) => ({
            id: dep.id,
            name: dep.dependency.displayName,
            scope: dep.dependency.scope,
            spec: dep.dependency.spec,
            source: dep.dependency.source,
            installed: dep.verdict.installed || "",
            compatible: dep.verdict.compatible || "",
            latest: dep.verdict.latest || "",
            latestPending: dep.pending,
            status,
            detail: status === "checking" ? "Checking the registry..." : dep.installedUnknown || dep.verdict.detail,
            commands: dep.options.map((option) => ({
                kind: option.kind,
                label: option.label,
                line: commandLine(state, option.spec),
                runnable: option.runnable && state.tool.found && !dep.installedUnknown && (option.kind === "install" || !dep.pending),
                note: option.note
            })),
            manual: manualHint(state, dep)
        }))
    };
}
class DependencyPanel {
    constructor(panel, output) {
        this.panel = panel;
        this.output = output;
        this.platform = process.platform;
        this.searchPath = buildSearchPath(this.platform);
        this.projects = [];
        this.scanToken = 0;
        this.busy = false;
        this.cancelRequested = false;
        this.disposed = false;
        this.disposables = [];
        this.disposables.push(panel.webview.onDidReceiveMessage(message => void this.onMessage(message)), vscode.workspace.onDidSaveTextDocument(document => {
            const base = path.basename(document.uri.fsPath);
            if (/^(package\.json|requirements.*\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|libs\.versions\.toml)$/.test(base))
                this.scheduleRescan();
        }));
        panel.onDidDispose(() => this.dispose());
    }
    post(message) {
        if (!this.disposed)
            (0, webview_ui_1.safePostMessage)(this.panel, message);
    }
    dispose() {
        this.disposed = true;
        this.scanToken++;
        if (this.activeChild) {
            this.cancelRequested = true;
            killTree(this.activeChild, this.platform);
        }
        if (this.rescanTimer)
            clearTimeout(this.rescanTimer);
        this.disposables.forEach(disposable => disposable.dispose());
    }
    scheduleRescan() {
        if (this.busy)
            return;
        if (this.rescanTimer)
            clearTimeout(this.rescanTimer);
        this.rescanTimer = setTimeout(() => void this.scan(false), 800);
    }
    publish(phase) {
        this.post({
            type: "projects",
            phase,
            projects: this.projects.map(projectView),
            trusted: vscode.workspace.isTrusted !== false,
            busy: this.busy
        });
    }
    async scan(refresh) {
        const token = ++this.scanToken;
        const scanStarted = Date.now();
        if (refresh)
            registryCache.clear();
        this.post({ type: "scanning", message: "Detecting projects and package managers..." });
        try {
            if (!vscode.workspace.workspaceFolders?.length) {
                this.projects = [];
                this.post({ type: "empty", message: "Open a folder or workspace to detect its dependencies." });
                return;
            }
            const byRoot = await collectProjectFiles();
            if (token !== this.scanToken)
                return;
            const resolver = new ToolResolver(this.platform, this.searchPath);
            const states = [];
            let counter = 0;
            for (const [root, files] of byRoot) {
                for (const project of (0, dependency_manager_1.detectProjects)(files, root, this.platform)) {
                    project.id = `p${counter++}`;
                    states.push({ project, root, tool: { id: project.tool, found: false, prefixArgs: [], display: project.tool }, dependencies: [] });
                }
            }
            if (!states.length) {
                this.projects = [];
                this.post({ type: "empty", message: "No package.json, requirements*.txt, pyproject.toml, pom.xml or build.gradle was found in this workspace." });
                return;
            }
            this.post({ type: "scanning", message: `Found ${states.length} project${states.length === 1 ? "" : "s"}. Checking tools and installed versions...` });
            await Promise.all(states.map(async (state) => {
                state.tool = await resolver.resolve(state.project);
                await this.readInstalled(state);
            }));
            if (token !== this.scanToken)
                return;
            this.projects = states;
            this.publish("local");
            // Latest versions come from the network, so they fill in afterwards.
            const lookups = states.flatMap(state => state.dependencies.filter(dep => dep.pending).map(dep => ({ state, dep })));
            let lastPublish = Date.now();
            await mapLimit(lookups.slice(0, MAX_REGISTRY_LOOKUPS), REGISTRY_CONCURRENCY, async ({ state, dep }) => {
                if (token !== this.scanToken)
                    return;
                const info = await fetchRegistryInfo(state.project.ecosystem, dep.dependency.name);
                this.applyVerdict(state, dep, info);
                if (Date.now() - lastPublish > 700 && token === this.scanToken) {
                    lastPublish = Date.now();
                    this.publish("local");
                }
            });
            for (const { state, dep } of lookups.slice(MAX_REGISTRY_LOOKUPS)) {
                this.applyVerdict(state, dep, { versions: [], error: `Only the first ${MAX_REGISTRY_LOOKUPS} dependencies are checked against a registry per scan.` });
            }
            if (token !== this.scanToken)
                return;
            this.publish("done");
            const deps = states.flatMap(state => state.dependencies);
            (0, analytics_1.track)("dependency_scan_completed", {
                project_count: states.length,
                dependency_count: deps.length,
                ecosystems: [...new Set(states.map(state => state.project.ecosystem))],
                managers: [...new Set(states.map(state => state.project.manager))],
                missing_count: deps.filter(dep => dep.verdict.status === "missing" || dep.verdict.status === "mismatch").length,
                outdated_count: deps.filter(dep => dep.verdict.status === "outdated").length,
                major_count: deps.filter(dep => dep.verdict.status === "major").length,
                duration_ms: Date.now() - scanStarted
            });
        }
        catch (error) {
            if (token === this.scanToken) {
                this.post({ type: "error", message: `Dependency scan failed: ${error instanceof Error ? error.message : String(error)}` });
            }
        }
    }
    applyVerdict(state, dep, info) {
        const verdict = (0, dependency_manager_1.evaluateDependency)(state.project.ecosystem, dep.dependency, dep.verdict.installed, info);
        dep.verdict = dep.installedUnknown ? { ...verdict, status: "unknown", detail: dep.installedUnknown } : verdict;
        dep.options = (0, dependency_manager_1.dependencyCommands)(state.project, dep.dependency, verdict);
        dep.pending = false;
    }
    async readInstalled(state) {
        const { project } = state;
        let pythonInstalled;
        let pythonUnknown;
        if (project.ecosystem === "python") {
            if (state.tool.found && state.tool.file) {
                const result = await runProcess(state.tool.file, [...state.tool.prefixArgs, "-m", "pip", "list", "--format=json", "--disable-pip-version-check"], this.platform, this.searchPath, { cwd: project.dir, timeoutMs: 60000 });
                if (result.code === 0) {
                    pythonInstalled = (0, dependency_manager_1.parsePipList)(result.stdout);
                }
                else {
                    pythonUnknown = "Installed versions could not be read because `pip list` failed.";
                    state.installedError = `${pythonUnknown} ${(0, dependency_manager_1.explainFailure)({ tool: "python", output: `${result.stdout}\n${result.stderr}`, exitCode: result.code, errorCode: result.errorCode, timedOut: result.timedOut, platform: this.platform })}`;
                }
            }
            else {
                pythonUnknown = "No Python interpreter with pip was found, so installed versions cannot be read.";
            }
        }
        state.dependencies = await Promise.all(project.dependencies.map(async (dependency, index) => {
            let installed;
            if (project.ecosystem === "node") {
                installed = await readInstalledNodeVersion(project, dependency.name, state.root);
            }
            else if (project.ecosystem === "python") {
                installed = pythonInstalled?.get(dependency.name);
            }
            else if (dependency.registry && dependency.spec) {
                const dir = project.ecosystem === "maven"
                    ? (0, dependency_manager_1.mavenArtifactDir)(mavenRepository(), dependency.name, dependency.spec)
                    : (0, dependency_manager_1.gradleArtifactDir)(gradleHome(), dependency.name, dependency.spec);
                installed = (await directoryHasArtifacts(dir)) ? dependency.spec : undefined;
            }
            const verdict = (0, dependency_manager_1.evaluateDependency)(project.ecosystem, dependency, installed, undefined);
            const dep = {
                id: `${project.id}:d${index}`,
                dependency,
                verdict: pythonUnknown ? { ...verdict, status: "unknown", detail: pythonUnknown } : verdict,
                options: [],
                pending: dependency.registry,
                installedUnknown: pythonUnknown
            };
            // Missing packages can be installed before the registry answers.
            if (needsInstall(dep))
                dep.options = (0, dependency_manager_1.dependencyCommands)(project, dependency, verdict);
            return dep;
        }));
    }
    // -------------------------------------------------------------------------
    // Messages
    // -------------------------------------------------------------------------
    async onMessage(message) {
        if (!message || typeof message.type !== "string")
            return;
        switch (message.type) {
            case "ready":
            case "rescan":
                if (this.busy)
                    return;
                await this.scan(message.type === "rescan" && message.refresh === true);
                return;
            case "copy":
                if (typeof message.text === "string" && message.text.length > 0 && message.text.length <= 8000) {
                    await vscode.env.clipboard.writeText(message.text);
                    (0, analytics_1.track)("content_copied", { feature: "dependencyManager", kind: typeof message.kind === "string" ? message.kind : "command" });
                    this.post({ type: "toast", message: "Copied to the clipboard.", kind: "success" });
                }
                return;
            case "showLog":
                this.output().show(true);
                return;
            case "openManifest":
                await this.openManifest(message.projectId, message.file);
                return;
            case "cancel":
                if (this.busy && this.activeChild) {
                    this.cancelRequested = true;
                    killTree(this.activeChild, this.platform);
                }
                return;
            case "run":
                await this.runDependency(String(message.depId || ""), message.kind);
                return;
            case "installMissing":
                await this.runBulk("install", typeof message.projectId === "string" ? message.projectId : undefined, false);
                return;
            case "updateOutdated":
                await this.runBulk("update", typeof message.projectId === "string" ? message.projectId : undefined, message.includeProduction === true);
                return;
        }
    }
    async openManifest(projectId, file) {
        const state = this.projects.find(entry => entry.project.id === projectId);
        if (!state || typeof file !== "string" || !state.project.manifests.includes(file))
            return;
        const target = path.resolve(state.project.dir, file);
        if (!(0, dependency_manager_1.isInside)(target, state.root))
            return;
        await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: true });
    }
    findDependency(depId) {
        for (const state of this.projects) {
            const dep = state.dependencies.find(entry => entry.id === depId);
            if (dep)
                return { state, dep };
        }
        return undefined;
    }
    async runDependency(depId, kind) {
        const found = this.findDependency(depId);
        if (!found || typeof kind !== "string")
            return;
        const option = found.dep.options.find(entry => entry.kind === kind);
        if (!option || !option.runnable || found.dep.installedUnknown) {
            this.post({ type: "toast", message: "That command is copy-only for this dependency.", kind: "error" });
            return;
        }
        const verb = kind === "install" ? "Install" : kind === "update" ? "Update" : "Upgrade";
        const { dependency } = found.dep;
        await this.runJob(`${verb} ${dependency.displayName}`, [{ state: found.state, spec: option.spec, title: option.label }], {
            action: kind === "install" ? "install" : kind === "update" ? "update" : "upgrade",
            touchesManifest: kind === "upgrade" ? [`${dependency.source} (the ${dependency.scope} dependency ${dependency.displayName})`] : [],
            skipped: []
        });
    }
    async runBulk(action, projectId, includeProduction) {
        const targets = this.projects.filter(state => !projectId || state.project.id === projectId);
        const steps = [];
        const skipped = [];
        for (const state of targets) {
            const label = path.relative(state.root, state.project.dir).replace(/\\/g, "/") || path.basename(state.project.dir);
            if (action === "install") {
                const missing = state.dependencies.filter(needsInstall);
                if (!missing.length)
                    continue;
                if (!state.tool.found) {
                    skipped.push(`${label}: ${state.project.tool} is not available.`);
                    continue;
                }
                for (const spec of (0, dependency_manager_1.projectInstallCommand)(state.project, missing.map(dep => dep.dependency))) {
                    steps.push({ state, spec, title: `Install missing dependencies in ${label}` });
                }
            }
            else {
                const outdated = state.dependencies.filter(dep => dep.verdict.status === "outdated" && dep.dependency.scope !== "peer");
                if (!outdated.length)
                    continue;
                if (state.project.ecosystem === "maven" || state.project.ecosystem === "gradle") {
                    skipped.push(`${label}: ${state.project.manager} updates edit the build file, so use the per-dependency commands.`);
                    continue;
                }
                const eligible = outdated.filter(dep => includeProduction || dep.dependency.scope !== "production");
                const held = outdated.length - eligible.length;
                if (held)
                    skipped.push(`${label}: ${held} production dependenc${held === 1 ? "y was" : "ies were"} left unchanged (tick "Include production dependencies" to update them).`);
                if (!eligible.length)
                    continue;
                if (!state.tool.found) {
                    skipped.push(`${label}: ${state.project.tool} is not available.`);
                    continue;
                }
                const spec = (0, dependency_manager_1.projectUpdateCommand)(state.project, eligible.map(dep => dep.dependency));
                if (spec)
                    steps.push({ state, spec, title: `Update ${eligible.length} outdated dependenc${eligible.length === 1 ? "y" : "ies"} in ${label}` });
            }
        }
        if (!steps.length) {
            const nothing = action === "install" ? "Nothing to install: every declared dependency is present." : "Nothing to update within the declared ranges.";
            this.post({ type: "banner", kind: skipped.length ? "error" : "success", message: skipped.length ? `${nothing}\n${skipped.join("\n")}` : nothing });
            return;
        }
        await this.runJob(action === "install" ? "Install missing dependencies" : "Update outdated dependencies", steps, { action: action === "install" ? "install_missing" : "update_outdated", touchesManifest: [], skipped });
    }
    /**
     * The single path every install or update takes. It refuses to run in an
     * untrusted workspace, re-validates each command, confirms the exact
     * command lines with the user in a native modal, then runs them one at a
     * time with no shell, a timeout, and cancellation.
     */
    async runJob(title, steps, context) {
        let runStarted = 0;
        const report = (outcome) => (0, analytics_1.track)("dependency_job_finished", {
            action: context.action,
            outcome,
            ecosystems: [...new Set(steps.map(step => step.state.project.ecosystem))],
            step_count: steps.length,
            duration_ms: runStarted ? Date.now() - runStarted : 0
        });
        if (this.busy) {
            this.post({ type: "toast", message: "Another install is still running.", kind: "error" });
            return;
        }
        if (vscode.workspace.isTrusted === false) {
            this.post({ type: "job", state: "error", title, message: "This workspace is not trusted. Installs run the project's install scripts, so they are only allowed in a trusted workspace (Workspaces: Manage Workspace Trust)." });
            report("blocked");
            return;
        }
        const lines = [];
        for (const step of steps) {
            const check = (0, dependency_manager_1.validateCommandSpec)(step.spec);
            if (!check.ok) {
                this.post({ type: "job", state: "error", title, message: `Blocked by a safety check: ${check.reason}` });
                report("blocked");
                return;
            }
            if (!step.state.tool.found || !step.state.tool.file) {
                this.post({ type: "job", state: "error", title, message: `${step.state.project.tool} is not available. ${step.state.tool.hint || (0, dependency_manager_1.toolInstallHint)(step.state.project.tool, this.platform)}` });
                report("blocked");
                return;
            }
            if (!workspaceRoots().some(root => (0, dependency_manager_1.isInside)(step.state.project.dir, root))) {
                this.post({ type: "job", state: "error", title, message: "Blocked by a safety check: the project directory is outside the open workspace." });
                report("blocked");
                return;
            }
            lines.push(`In ${step.state.project.dir}:\n${commandLine(step.state, step.spec)}`);
        }
        const notes = [];
        if (context.touchesManifest.length)
            notes.push(`This changes ${context.touchesManifest.join(", ")}.`);
        else
            notes.push("No manifest is edited; lockfiles and installed packages may change.");
        if (steps.some(step => step.state.project.ecosystem === "node"))
            notes.push("npm, yarn and pnpm run each package's install scripts.");
        if (steps.some(step => step.state.tool.id === "mvnw" || step.state.tool.id === "gradlew"))
            notes.push("The project's own wrapper script runs and may download a Maven/Gradle distribution.");
        const python = steps.find(step => step.state.project.ecosystem === "python");
        if (python)
            notes.push(`Target Python: ${python.state.tool.location}${python.state.tool.isVenv ? " (virtual environment)" : " - not a virtual environment"}.`);
        if (context.skipped.length)
            notes.push(`Skipped:\n${context.skipped.join("\n")}`);
        let confirmed = false;
        try {
            const choice = await vscode.window.showWarningMessage(`${title}?`, { modal: true, detail: `${lines.join("\n\n")}\n\n${notes.join("\n")}` }, "Run");
            confirmed = choice === "Run";
        }
        catch {
            // A host that cannot show the dialog must never be read as approval.
            confirmed = false;
        }
        if (!confirmed) {
            this.post({ type: "toast", message: "Cancelled; nothing was run.", kind: "error" });
            report("declined");
            return;
        }
        runStarted = Date.now();
        this.busy = true;
        this.cancelRequested = false;
        this.post({ type: "busy", busy: true });
        const output = this.output();
        output.appendLine("");
        output.appendLine(`=== ${title} - ${new Date().toLocaleString()} ===`);
        let failure;
        let completed = 0;
        try {
            for (const [index, step] of steps.entries()) {
                const line = commandLine(step.state, step.spec);
                this.post({ type: "job", state: "running", title, step: index + 1, steps: steps.length, stepTitle: step.title, command: line });
                output.appendLine(`> ${line}   (in ${step.state.project.dir})`);
                let buffer = "";
                let flushTimer;
                const flush = () => {
                    flushTimer = undefined;
                    if (buffer)
                        this.post({ type: "log", text: buffer });
                    buffer = "";
                };
                const tool = step.state.tool;
                const result = await runProcess(tool.file, [...tool.prefixArgs, ...step.spec.args], this.platform, this.searchPath, {
                    cwd: step.state.project.dir,
                    timeoutMs: JOB_TIMEOUT_MS,
                    onStart: child => { this.activeChild = child; },
                    isCancelled: () => this.cancelRequested,
                    onOutput: text => {
                        output.append(text);
                        buffer += text;
                        if (!flushTimer)
                            flushTimer = setTimeout(flush, 150);
                    }
                });
                if (flushTimer)
                    clearTimeout(flushTimer);
                flush();
                this.activeChild = undefined;
                if (result.code !== 0 || result.cancelled || result.timedOut) {
                    failure = (0, dependency_manager_1.explainFailure)({
                        tool: step.state.project.tool,
                        output: `${result.stdout}\n${result.stderr}`,
                        exitCode: result.code,
                        errorCode: result.errorCode,
                        timedOut: result.timedOut,
                        cancelled: result.cancelled,
                        timeoutMinutes: JOB_TIMEOUT_MS / 60000,
                        platform: this.platform
                    });
                    output.appendLine(`\n[failed] ${failure}`);
                    break;
                }
                completed++;
                output.appendLine("\n[done]");
            }
        }
        finally {
            this.busy = false;
            this.activeChild = undefined;
        }
        if (failure) {
            const partial = completed ? `\n\n${completed} of ${steps.length} steps finished before the failure.` : "";
            this.post({ type: "job", state: this.cancelRequested ? "cancelled" : "error", title, message: `${failure}${partial}` });
            report(this.cancelRequested ? "cancelled" : "error");
        }
        else {
            report("success");
            this.post({ type: "job", state: "success", title, message: `Finished successfully (${steps.length} step${steps.length === 1 ? "" : "s"}). Versions below are rechecked.` });
        }
        this.post({ type: "busy", busy: false });
        if (!this.disposed)
            await this.scan(false);
    }
}
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function registerDependencyManagerCommand(context) {
    let channel;
    const output = () => {
        if (!channel) {
            channel = vscode.window.createOutputChannel(OUTPUT_NAME);
            context.subscriptions.push(channel);
        }
        return channel;
    };
    const command = (0, command_registry_1.registerTrackedCommand)(COMMAND_ID, () => {
        const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
        const { panel, created } = (0, webview_ui_1.openToolPanel)("dependencyManager", "Dependencies & Installation", {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [mediaRoot]
        });
        if (!created)
            return;
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "media", "dependency-manager.js")));
        panel.webview.html = getDependencyManagerHtml(panel.webview.cspSource, String(scriptUri));
        // The controller lives as long as the panel. The scan starts when the page
        // reports ready, because a message posted before that is dropped.
        void new DependencyPanel(panel, output);
    });
    context.subscriptions.push(command);
}
exports.registerDependencyManagerCommand = registerDependencyManagerCommand;
function getDependencyManagerHtml(cspSource, scriptSrc) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dependencies &amp; Installation</title>
    <style>
        ${webview_ui_1.UTILITY_CSS}
        .tool-header { flex-wrap: wrap; }
        .tool-header .spacer { flex: 1; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
        .toolbar .search { flex: 1 1 220px; min-width: 0; }
        .toolbar select { min-width: 150px; }
        .check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-1); cursor: pointer; margin: 0; font-weight: 500; }
        .btn[disabled] { opacity: .45; cursor: not-allowed; transform: none; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; margin: 4px 0 16px; }
        .stat { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 10px 14px; cursor: pointer; text-align: left; color: var(--fg-0); font: inherit; }
        .stat:hover, .stat.active { border-color: var(--border-focus); }
        .stat .num { display: block; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .stat .lbl { display: block; font-size: 11px; color: var(--fg-1); text-transform: uppercase; letter-spacing: .4px; }
        .stat.ok .num { color: var(--success); } .stat.warn .num { color: var(--warning); } .stat.bad .num { color: var(--error); } .stat.major .num { color: #b180d7; }
        .banner { border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 14px; font-size: 13px; border: 1px solid var(--border); background: var(--bg-1); white-space: pre-wrap; display: flex; gap: 10px; align-items: flex-start; }
        .banner .text { flex: 1; }
        .banner.error { border-color: var(--error); background: var(--error-bg); }
        .banner.success { border-color: var(--success); background: var(--success-bg); }
        .job { position: relative; background: var(--bg-1); border: 1px solid var(--border-focus); border-radius: var(--radius-md); padding: 14px; margin-bottom: 16px; box-shadow: var(--shadow); }
        /* Only a running job stays in view; a finished one must not cover the list. */
        .job.running { position: sticky; top: 58px; z-index: 40; }
        .job.success { border-color: var(--success); } .job.error, .job.cancelled { border-color: var(--error); }
        .job-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .job-title { font-weight: 700; font-size: 13px; flex: 1; min-width: 180px; }
        .job-cmd { font-family: var(--mono); font-size: 12px; color: var(--fg-1); margin-top: 6px; overflow-wrap: anywhere; }
        .job-msg { margin-top: 8px; font-size: 12.5px; white-space: pre-wrap; line-height: 1.55; }
        .job-log { margin-top: 10px; max-height: 180px; overflow: auto; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-family: var(--mono); font-size: 11.5px; white-space: pre-wrap; word-break: break-all; color: var(--fg-1); }
        .progress { height: 3px; background: var(--bg-3); border-radius: 2px; overflow: hidden; margin-top: 10px; }
        .progress::after { content: ""; display: block; height: 100%; width: 35%; background: var(--accent); animation: slide 1.2s ease-in-out infinite; }
        @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        .spinner { width: 14px; height: 14px; border: 2px solid var(--fg-2); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; flex: none; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .progress::after { animation: none; width: 100%; opacity: .6; } .spinner { animation: none; } }
        .project { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 16px; overflow: hidden; }
        .project-head { padding: 14px 16px; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-start; border-bottom: 1px solid var(--border); }
        .project-id { flex: 1 1 280px; min-width: 0; }
        .project-name { font-weight: 700; font-size: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; word-break: break-all; }
        .project-meta { font-size: 12px; color: var(--fg-1); margin-top: 5px; line-height: 1.6; }
        .link { color: var(--vscode-textLink-foreground); cursor: pointer; background: none; border: none; padding: 0; font: inherit; }
        .link:hover { text-decoration: underline; }
        .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--bg-3); color: var(--fg-1); white-space: nowrap; }
        .chip.eco { color: var(--accent-fg); background: var(--accent); }
        .chip.ok { color: var(--success); background: var(--success-bg); }
        .chip.bad { color: var(--error); background: var(--error-bg); }
        .project-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .notice { padding: 10px 16px; font-size: 12px; border-bottom: 1px solid var(--border); background: rgba(255,152,0,.08); color: var(--fg-0); line-height: 1.5; }
        .notice.bad { background: var(--error-bg); }
        .notice-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
        code { font-family: var(--mono); font-size: 11.5px; background: var(--bg-3); padding: 1px 4px; border-radius: 3px; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { text-align: left; font-size: 11px; font-weight: 700; color: var(--fg-1); text-transform: uppercase; letter-spacing: .4px; padding: 8px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        td { padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
        tbody tr:last-child td { border-bottom: none; }
        tr.dep:hover td { background: var(--bg-2); }
        .pkg { font-family: var(--mono); font-weight: 600; word-break: break-all; }
        .scope { font-size: 10.5px; color: var(--fg-1); margin-top: 2px; }
        .ver { font-family: var(--mono); white-space: nowrap; }
        .muted { color: var(--fg-2); }
        .newer { color: var(--warning); font-weight: 600; }
        .status { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 10px; white-space: nowrap; }
        .status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
        .s-up-to-date { color: var(--success); background: var(--success-bg); }
        .s-outdated { color: var(--warning); background: rgba(255,152,0,.14); }
        .s-major { color: #b180d7; background: rgba(177,128,215,.14); }
        .s-missing, .s-mismatch { color: var(--error); background: var(--error-bg); }
        .s-unknown, .s-checking { color: var(--fg-1); background: var(--bg-3); }
        .detail { font-size: 11.5px; color: var(--fg-1); margin-top: 5px; max-width: 380px; line-height: 1.45; }
        .row-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
        .cmds > td { background: var(--bg-2); padding: 10px 14px; }
        .cmd { display: grid; grid-template-columns: minmax(120px, 200px) 1fr auto auto; gap: 4px 8px; align-items: center; padding: 6px 0; }
        .cmd + .cmd { border-top: 1px dashed var(--border); }
        .cmd-label { font-size: 11.5px; font-weight: 600; color: var(--fg-1); }
        .cmd-line { font-family: var(--mono); font-size: 12px; background: var(--bg-3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 8px; overflow-wrap: anywhere; }
        .cmd-note { grid-column: 2 / -1; font-size: 11px; color: var(--fg-1); }
        .empty { text-align: center; padding: 40px 16px; color: var(--fg-1); font-size: 13px; }
        .loading { display: flex; gap: 10px; align-items: center; justify-content: center; padding: 30px; color: var(--fg-1); font-size: 13px; }
        .hidden { display: none !important; }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        @media (max-width: 820px) {
            .tool-header { padding: 12px 16px; }
            .tool-body { padding: 14px 16px; }
            .job.running { position: relative; top: 0; }
            thead { display: none; }
            table, tbody, tr, td { display: block; width: 100%; }
            tr.dep { padding: 10px 12px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
            tr.dep td { border: none; padding: 0; }
            tr.dep td[data-label]::before { content: attr(data-label); display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: var(--fg-2); font-weight: 700; }
            tr.dep td.c-name, tr.dep td.c-status, tr.dep td.c-actions { grid-column: 1 / -1; }
            .row-actions { justify-content: flex-start; }
            .cmd { grid-template-columns: 1fr auto auto; }
            .cmd-label, .cmd-note { grid-column: 1 / -1; }
            .toolbar .btn, .toolbar select { flex: 1 1 auto; }
            .detail { max-width: none; }
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Dependencies &amp; Installation</h1>
        <span class="subtitle" id="subtitle">Detect, check, install and update project dependencies</span>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" id="showLog" type="button">Output log</button>
    </div>
    <div class="tool-body">
        <div class="toolbar" role="toolbar" aria-label="Dependency actions">
            <button class="btn" id="rescan" type="button" title="Re-read manifests and query the registries again">Rescan</button>
            <button class="btn btn-secondary" id="installAll" type="button" disabled>Install all missing</button>
            <button class="btn btn-secondary" id="updateAll" type="button" disabled>Update all outdated</button>
            <label class="check" title="Bulk updates change development dependencies only unless this is ticked"><input type="checkbox" id="includeProd"> Include production dependencies in bulk updates</label>
        </div>
        <div class="toolbar">
            <label class="sr-only" for="search">Filter dependencies</label>
            <input type="text" id="search" class="search" placeholder="Filter by package name...">
            <label class="sr-only" for="statusFilter">Status filter</label>
            <select id="statusFilter">
                <option value="all">All statuses</option>
                <option value="attention">Needs attention</option>
                <option value="missing">Missing or mismatched</option>
                <option value="outdated">Update available</option>
                <option value="major">Newer major / outside range</option>
                <option value="up-to-date">Up to date</option>
                <option value="unknown">Unknown</option>
            </select>
            <label class="sr-only" for="scopeFilter">Scope filter</label>
            <select id="scopeFilter">
                <option value="all">All scopes</option>
                <option value="production">Production</option>
                <option value="development">Development</option>
                <option value="optional">Optional</option>
                <option value="peer">Peer</option>
            </select>
        </div>
        <div id="banner" class="banner hidden" role="status"></div>
        <div id="job" class="job hidden" aria-live="polite"></div>
        <div id="stats" class="stats hidden"></div>
        <div id="projects"><div class="loading"><span class="spinner"></span><span>Detecting projects...</span></div></div>
    </div>
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}
exports.getDependencyManagerHtml = getDependencyManagerHtml;
//# sourceMappingURL=dependencyManager.js.map