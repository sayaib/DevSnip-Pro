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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOpenCodeIntegrationCommand = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const path_1 = require("path");
const os = __importStar(require("os"));
const execAsync = util.promisify(child_process_1.exec);
/** Official OpenCode distribution: npm package `opencode-ai` exposing the `opencode` binary. */
const OPENCODE_NPM_PACKAGE = "opencode-ai";
const OPENCODE_BIN = "opencode";
function registerOpenCodeIntegrationCommand(context) {
    const command = vscode.commands.registerCommand("sayaib.hue-console.openCodeIntegration", () => __awaiter(this, void 0, void 0, function* () {
        const panel = vscode.window.createWebviewPanel("openCodeIntegrationHub", "OpenCode Integration Hub", vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)]
        });
        panel.iconPath = vscode.Uri.file((0, path_1.join)(context.extensionPath, "logo.png"));
        const platform = os.platform(); // 'darwin' | 'win32' | 'linux'
        const npmCmd = platform === "win32" ? "npm.cmd" : "npm";
        const pathEnv = platform === "win32"
            ? process.env.PATH
            : `${process.env.PATH || ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
        const getWorkspacePath = () => {
            const folders = vscode.workspace.workspaceFolders;
            return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
        };
        /** Run a shell command with a timeout. Returns trimmed stdout, or null on any failure. Never hangs. */
        const tryCmd = (cmd, timeoutMs) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout } = yield execAsync(cmd, {
                    env: Object.assign(Object.assign({}, process.env), { PATH: pathEnv }),
                    timeout: timeoutMs,
                    windowsHide: true
                });
                return stdout.trim();
            }
            catch (_a) {
                return null;
            }
        });
        const runSystemChecks = () => __awaiter(this, void 0, void 0, function* () {
            // 1. Node.js detection (all platforms).
            const nodeVersion = yield tryCmd("node -v", 5000);
            const nodeInstalled = nodeVersion !== null && nodeVersion.length > 0;
            // 2. OpenCode detection. The ONLY trustworthy signal is that the
            // `opencode` binary actually executes. An npm listing alone (or a dead
            // file on PATH) means a partial/broken install and must NOT report as
            // installed - otherwise the hub shows green for an unusable setup.
            let openCodeInstalled = false;
            let openCodeVersion = "";
            let openCodeBroken = false;
            const versionOut = yield tryCmd(`${OPENCODE_BIN} --version`, 5000);
            if (versionOut !== null && versionOut.length > 0) {
                openCodeInstalled = true;
                openCodeVersion = versionOut.split("\n")[0];
            }
            else {
                const binLookup = platform === "win32"
                    ? yield tryCmd(`where ${OPENCODE_BIN}`, 5000)
                    : yield tryCmd(`command -v ${OPENCODE_BIN}`, 5000);
                if (binLookup !== null && binLookup.length > 0) {
                    // A file named `opencode` is on PATH but does not run: broken install.
                    openCodeBroken = true;
                }
                else {
                    const npmList = yield tryCmd(`${npmCmd} list -g ${OPENCODE_NPM_PACKAGE} --depth=0`, 8000);
                    if (npmList !== null && npmList.toLowerCase().includes(`${OPENCODE_NPM_PACKAGE}@`)) {
                        // npm still lists the package but no working binary exists:
                        // stale/partial install (e.g. failed postinstall). Not usable.
                        openCodeBroken = true;
                    }
                }
            }
            return {
                platform,
                nodeInstalled,
                nodeVersion: nodeVersion || "",
                openCodeInstalled,
                openCodeVersion,
                openCodeBroken,
                workspacePath: getWorkspacePath()
            };
        });
        // Single render (same pattern as the REST API Client): the script binds
        // listeners once by element id, and later updates arrive via postMessage.
        panel.webview.html = getOpenCodeHubHtml(yield runSystemChecks());
        panel.webview.onDidReceiveMessage((message) => __awaiter(this, void 0, void 0, function* () {
            switch (message.command) {
                case "refresh": {
                    panel.webview.postMessage({ command: "hubLoading", message: "Running system environment diagnostics..." });
                    const status = yield runSystemChecks();
                    panel.webview.postMessage(Object.assign({ command: "hubStatus" }, status));
                    break;
                }
                case "download-node": {
                    vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/"));
                    break;
                }
                case "install-opencode": {
                    // Never run sudo through exec (no TTY would hang waiting for a
                    // password). Run plain npm non-interactively; on failure fall back
                    // to a visible terminal where the user can approve elevation.
                    panel.webview.postMessage({ command: "hubLoading", message: "Installing OpenCode via npm (opencode-ai)... This can take a minute." });
                    const preCheck = yield runSystemChecks();
                    if (preCheck.openCodeBroken) {
                        // Clear the stale/partial install first so the reinstall is clean.
                        yield tryCmd(`${npmCmd} rm -g ${OPENCODE_NPM_PACKAGE}`, 60000);
                    }
                    const out = yield tryCmd(`${npmCmd} install -g ${OPENCODE_NPM_PACKAGE}`, 180000);
                    const status = yield runSystemChecks();
                    if (out !== null && status.openCodeInstalled) {
                        vscode.window.showInformationMessage("OpenCode installed and verified successfully!");
                        panel.webview.postMessage(Object.assign(Object.assign({ command: "hubStatus" }, status), { ok: true, message: "OpenCode installed and verified (`opencode --version` runs). You can now launch it." }));
                    }
                    else {
                        const terminal = vscode.window.createTerminal({ name: "Install OpenCode" });
                        terminal.show();
                        terminal.sendText(`${npmCmd} install -g ${OPENCODE_NPM_PACKAGE}`);
                        vscode.window.showWarningMessage("Automated npm install did not produce a working `opencode` binary (often a permissions issue). Run the command in the opened terminal, then press Recheck System.");
                        panel.webview.postMessage(Object.assign(Object.assign({ command: "hubStatus" }, status), { ok: false, message: "Install finished but `opencode` still does not run. A terminal was opened with the install command - run it there (use sudo on macOS/Linux if needed), then press Recheck System." }));
                    }
                    break;
                }
                case "launch-opencode": {
                    const check = yield runSystemChecks();
                    if (!check.openCodeInstalled) {
                        panel.webview.postMessage(Object.assign(Object.assign({ command: "hubStatus" }, check), { ok: false, message: "OpenCode is not detected on this machine yet. Install it first, then launch." }));
                        break;
                    }
                    const wsPath = getWorkspacePath();
                    const terminal = vscode.window.createTerminal({ name: "OpenCode", cwd: wsPath });
                    terminal.show();
                    // Wait until the shell is fully initialized before running the
                    // command. On Windows, PowerShell may first show an
                    // execution-policy prompt for VS Code's shell integration script;
                    // text sent too early would land in that prompt instead of running.
                    const launched = yield executeWhenShellReady(terminal, OPENCODE_BIN, 15000);
                    if (launched) {
                        vscode.window.showInformationMessage(wsPath ? `Launched OpenCode in workspace: ${wsPath}` : "Launched OpenCode.");
                    }
                    else {
                        terminal.sendText(OPENCODE_BIN);
                        const status = yield runSystemChecks();
                        panel.webview.postMessage(Object.assign(Object.assign({ command: "hubStatus" }, status), { ok: false, message: platform === "win32"
                                ? "Windows PowerShell showed a script security prompt, so the automatic launch may not have run. Answer the prompt in the terminal, or use one of the options in the notification."
                                : "The terminal shell was not ready, so the launch command was typed but may not have executed. Press Enter in the terminal if needed, then try again." }));
                        if (platform === "win32") {
                            const action = yield vscode.window.showWarningMessage("PowerShell blocked the automatic OpenCode launch with a script security prompt.", "Launch in Command Prompt", "Copy PowerShell Fix");
                            if (action === "Launch in Command Prompt") {
                                // cmd.exe has no execution-policy prompts, so this just works.
                                const cmdTerminal = vscode.window.createTerminal({ name: "OpenCode", cwd: wsPath, shellPath: "cmd.exe" });
                                cmdTerminal.show();
                                cmdTerminal.sendText(OPENCODE_BIN);
                            }
                            else if (action === "Copy PowerShell Fix") {
                                yield vscode.env.clipboard.writeText("Set-ExecutionPolicy -Scope CurrentUser RemoteSigned");
                                vscode.window.showInformationMessage("Fix copied: paste and run it in PowerShell, restart the terminal, then launch OpenCode again.");
                            }
                        }
                    }
                    break;
                }
            }
        }), null, context.subscriptions);
        context.subscriptions.push(panel);
    }));
    context.subscriptions.push(command);
}
exports.registerOpenCodeIntegrationCommand = registerOpenCodeIntegrationCommand;
/**
 * Run a command in a terminal only after its shell is fully initialized
 * (shell integration ready). Resolves false on timeout so the caller can
 * fall back to typing the command and showing guidance.
 */
function executeWhenShellReady(terminal, commandLine, timeoutMs) {
    return new Promise((resolve) => {
        if (terminal.shellIntegration) {
            terminal.shellIntegration.executeCommand(commandLine);
            resolve(true);
            return;
        }
        const timer = setTimeout(() => {
            listener.dispose();
            resolve(false);
        }, timeoutMs);
        const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
            if (e.terminal === terminal && terminal.shellIntegration) {
                clearTimeout(timer);
                listener.dispose();
                terminal.shellIntegration.executeCommand(commandLine);
                resolve(true);
            }
        });
    });
}
function getNonce() {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function getOpenCodeHubHtml(state) {
    const nonce = getNonce();
    const nodeSectionDisplay = state.nodeInstalled ? "none" : "";
    const installSectionDisplay = state.nodeInstalled && !state.openCodeInstalled ? "" : "none";
    const readySectionDisplay = state.nodeInstalled && state.openCodeInstalled ? "" : "none";
    const nodeBadgeClass = state.nodeInstalled ? "badge success" : "badge error";
    const nodeBadgeText = state.nodeInstalled ? `Installed (${state.nodeVersion})` : "Not Detected";
    const openCodeBadgeClass = state.openCodeInstalled ? "badge success" : "badge error";
    const openCodeBadgeText = state.openCodeInstalled ? `Installed (${state.openCodeVersion || "Active"})` : "Not Detected";
    let installSteps = "";
    if (state.platform === "win32") {
        installSteps = `
        <div class="step-item"><strong>Option A (npm, all platforms):</strong> <code>npm install -g opencode-ai</code></div>
        <div class="step-item"><strong>Option B (Chocolatey):</strong> <code>choco install opencode</code></div>
        <div class="step-item"><strong>Option C (Scoop):</strong> <code>scoop install opencode</code></div>
        <div class="step-item">Tip: for the best experience on Windows, use OpenCode inside WSL.</div>`;
    }
    else if (state.platform === "darwin") {
        installSteps = `
        <div class="step-item"><strong>Option A (npm, all platforms):</strong> <code>npm install -g opencode-ai</code></div>
        <div class="step-item"><strong>Option B (Homebrew):</strong> <code>brew install anomalyco/tap/opencode</code></div>
        <div class="step-item"><strong>Option C (install script):</strong> <code>curl -fsSL https://opencode.ai/install | bash</code></div>`;
    }
    else {
        installSteps = `
        <div class="step-item"><strong>Option A (npm, all platforms):</strong> <code>npm install -g opencode-ai</code></div>
        <div class="step-item"><strong>Option B (Homebrew on Linux):</strong> <code>brew install anomalyco/tap/opencode</code></div>
        <div class="step-item"><strong>Option C (install script):</strong> <code>curl -fsSL https://opencode.ai/install | bash</code></div>
        <div class="step-item"><strong>Option D (Arch):</strong> <code>sudo pacman -S opencode</code></div>`;
    }
    let nodeSteps = "";
    if (state.platform === "win32") {
        nodeSteps = `<div class="step-item"><strong>Windows:</strong> download the LTS installer from <a href="https://nodejs.org/">nodejs.org</a> or run <code>winget install OpenJS.NodeJS.LTS</code></div>`;
    }
    else if (state.platform === "darwin") {
        nodeSteps = `<div class="step-item"><strong>macOS:</strong> run <code>brew install node</code> or download the LTS installer from <a href="https://nodejs.org/">nodejs.org</a></div>`;
    }
    else {
        nodeSteps = `<div class="step-item"><strong>Linux:</strong> run <code>sudo apt install nodejs npm</code> (Debian/Ubuntu) or use NodeSource / nvm</div>`;
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>OpenCode Integration Hub</title>
  <style>
    :root { --bg: #0d1117; --card-bg: #161b22; --border: #30363d; --fg: #e6edf3; --fg-muted: #8b949e; --accent: #58a6ff; --success-bg: rgba(35,134,54,0.15); --error-bg: rgba(218,54,51,0.15); --warning-bg: rgba(187,128,9,0.15); --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; --mono: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace; }
    body { font-family: var(--font); background: var(--bg); color: var(--fg); margin: 0; padding: 32px; line-height: 1.5; }
    .header { margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    .header h1 { margin: 0 0 6px 0; font-size: 24px; color: var(--accent); }
    .header p { margin: 0; color: var(--fg-muted); font-size: 13px; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .status-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
    .status-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); margin-bottom: 8px; }
    .status-value { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
    .status-desc { font-size: 12px; color: var(--fg-muted); }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge.success { background: var(--success-bg); color: #3fb950; border: 1px solid rgba(63,185,80,0.4); }
    .badge.error { background: var(--error-bg); color: #f85149; border: 1px solid rgba(248,81,73,0.4); }
    .alert { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin-top: 16px; }
    .alert.error { border-color: rgba(248,81,73,0.4); background: var(--error-bg); }
    .alert.warning { border-color: rgba(187,128,9,0.4); background: var(--warning-bg); }
    .alert.success-box { border-color: rgba(63,185,80,0.4); background: var(--success-bg); }
    .alert h3 { margin-top: 0; margin-bottom: 12px; font-size: 18px; }
    .step-list { margin: 12px 0; display: flex; flex-direction: column; gap: 8px; }
    .step-item { font-size: 13px; }
    code { background: rgba(110,118,129,0.3); padding: 2px 6px; border-radius: 4px; font-family: var(--mono); font-size: 12px; }
    pre { background: var(--bg); border: 1px solid var(--border); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0; }
    pre code { background: transparent; padding: 0; }
    .workspace-card { background: var(--bg); border: 1px solid var(--border); padding: 12px 16px; border-radius: 6px; margin: 14px 0; font-size: 13px; }
    .btn-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { background: #21262d; color: var(--fg); border: 1px solid var(--border); padding: 10px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: #30363d; }
    .btn.primary { background: #238636; color: #fff; border-color: rgba(240,246,252,0.1); }
    .btn.primary:hover { background: #2ea043; }
    .btn.launch-btn { font-size: 15px; padding: 12px 24px; }
    .banner { border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; display: none; }
    .banner.ok { display: block; background: var(--success-bg); border: 1px solid rgba(63,185,80,0.4); }
    .banner.fail { display: block; background: var(--error-bg); border: 1px solid rgba(248,81,73,0.4); }
    .broken-note { background: var(--error-bg); border: 1px solid rgba(248,81,73,0.4); border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 13px; }
    .loading-container { text-align: center; padding: 60px 20px; display: none; }
    .spinner { width: 40px; height: 40px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="header">
    <h1>OpenCode Integration Hub</h1>
    <p>Cross-platform environment diagnostics and workspace integration for Windows, macOS, and Linux.</p>
  </div>

  <div id="actionBanner" class="banner"></div>

  <div id="loadingOverlay" class="loading-container">
    <div class="spinner"></div>
    <p id="loadingText">Working...</p>
  </div>

  <div id="mainContent">
    <div class="status-grid">
      <div class="status-card">
        <div class="status-title">Node.js Runtime (${escapeHtml(state.platform)})</div>
        <div class="status-value"><span id="nodeBadge" class="${nodeBadgeClass}">${escapeHtml(nodeBadgeText)}</span></div>
        <div class="status-desc">Cross-platform JavaScript environment.</div>
      </div>
      <div class="status-card">
        <div class="status-title">OpenCode CLI</div>
        <div class="status-value"><span id="openCodeBadge" class="${openCodeBadgeClass}">${escapeHtml(openCodeBadgeText)}</span></div>
        <div class="status-desc">AI coding agent platform.</div>
      </div>
    </div>

    <div id="sectionNodeMissing" class="alert error" style="display:${nodeSectionDisplay};">
      <h3>Node.js is Missing (${escapeHtml(state.platform)})</h3>
      <p>Node.js is required to install and run OpenCode on every operating system.</p>
      <div class="step-list">${nodeSteps}</div>
      <div class="btn-row" style="margin-top: 16px;">
        <button id="btnDownloadNode" class="btn primary">Download Node.js Installer</button>
        <button id="btnRecheckNode" class="btn secondary">Recheck System</button>
      </div>
    </div>

    <div id="sectionInstall" class="alert warning" style="display:${installSectionDisplay};">
      <h3>OpenCode is Not Installed</h3>
      <div id="brokenNotice" class="broken-note" style="display:${state.openCodeBroken ? "" : "none"};">Partial or broken installation detected: npm lists the package but the <code>opencode</code> command does not run. Press the repair button below to remove and reinstall it cleanly.</div>
      <p>Node.js (${escapeHtml(state.nodeVersion)}) is detected on <strong>${escapeHtml(state.platform)}</strong>, but the OpenCode CLI is not installed.</p>
      <p>Click below to install OpenCode instantly via npm (package <code>opencode-ai</code>):</p>
      <pre><code>npm install -g opencode-ai</code></pre>
      <div class="step-list">${installSteps}</div>
      <div class="btn-row" style="margin-top: 16px;">
        <button id="btnInstallOpenCode" class="btn primary">${state.openCodeBroken ? "Repair OpenCode Now" : "Install OpenCode Now"}</button>
        <button id="btnRecheckInstall" class="btn secondary">Recheck System</button>
      </div>
    </div>

    <div id="sectionReady" class="alert success-box" style="display:${readySectionDisplay};">
      <h3>System Ready (${escapeHtml(state.platform)})</h3>
      <p>Node.js (${escapeHtml(state.nodeVersion)}) and OpenCode are fully installed and configured.</p>
      <div class="workspace-card">
        <strong>Active Workspace / Folder:</strong>
        <code id="workspacePath">${escapeHtml(state.workspacePath || "No workspace folder open (will launch in user home/default)")}</code>
      </div>
      <div class="btn-row" style="margin-top: 20px;">
        <button id="btnLaunchOpenCode" class="btn primary launch-btn">Launch OpenCode in Terminal</button>
        <button id="btnRecheckReady" class="btn secondary">Recheck System</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function showSection(id) {
      var sections = ['sectionNodeMissing', 'sectionInstall', 'sectionReady'];
      for (var i = 0; i < sections.length; i++) {
        var el = document.getElementById(sections[i]);
        if (el) el.style.display = (sections[i] === id) ? '' : 'none';
      }
    }

    function setBadge(id, installed, text) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.className = 'badge ' + (installed ? 'success' : 'error');
    }

    function showLoading(message) {
      var overlay = document.getElementById('loadingOverlay');
      var txt = document.getElementById('loadingText');
      var main = document.getElementById('mainContent');
      if (txt) txt.textContent = message || 'Working...';
      if (overlay) overlay.style.display = 'block';
      if (main) main.style.display = 'none';
    }

    function showBanner(ok, message) {
      var banner = document.getElementById('actionBanner');
      if (!banner) return;
      if (!message) { banner.style.display = 'none'; banner.className = 'banner'; return; }
      banner.textContent = message;
      banner.className = 'banner ' + (ok ? 'ok' : 'fail');
    }

    function renderStatus(msg) {
      var overlay = document.getElementById('loadingOverlay');
      var main = document.getElementById('mainContent');
      if (overlay) overlay.style.display = 'none';
      if (main) main.style.display = '';
      setBadge('nodeBadge', msg.nodeInstalled, msg.nodeInstalled ? ('Installed (' + msg.nodeVersion + ')') : 'Not Detected');
      setBadge('openCodeBadge', msg.openCodeInstalled, msg.openCodeInstalled ? ('Installed (' + (msg.openCodeVersion || 'Active') + ')') : 'Not Detected');
      var ws = document.getElementById('workspacePath');
      if (ws) ws.textContent = msg.workspacePath || 'No workspace folder open (will launch in user home/default)';
      var broken = document.getElementById('brokenNotice');
      if (broken) broken.style.display = msg.openCodeBroken ? '' : 'none';
      var installBtn = document.getElementById('btnInstallOpenCode');
      if (installBtn) installBtn.textContent = msg.openCodeBroken ? 'Repair OpenCode Now' : 'Install OpenCode Now';
      if (!msg.nodeInstalled) showSection('sectionNodeMissing');
      else if (!msg.openCodeInstalled) showSection('sectionInstall');
      else showSection('sectionReady');
    }

    document.getElementById('btnDownloadNode').addEventListener('click', () => vscode.postMessage({ command: 'download-node' }));
    document.getElementById('btnInstallOpenCode').addEventListener('click', () => vscode.postMessage({ command: 'install-opencode' }));
    document.getElementById('btnLaunchOpenCode').addEventListener('click', () => vscode.postMessage({ command: 'launch-opencode' }));
    document.getElementById('btnRecheckNode').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
    document.getElementById('btnRecheckInstall').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
    document.getElementById('btnRecheckReady').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.command) return;
      if (msg.command === 'hubLoading') showLoading(msg.message);
      else if (msg.command === 'hubStatus') { showBanner(msg.ok, msg.message); renderStatus(msg); }
    });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=openCodeIntegration.js.map