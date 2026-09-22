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
exports.registerOpenCodeIntegrationCommand = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const execFileAsync = util.promisify(child_process_1.execFile);
/** Official OpenCode distribution: npm package `opencode-ai` exposing the `opencode` binary. */
const OPENCODE_NPM_PACKAGE = "opencode-ai";
const OPENCODE_BIN = "opencode";
/**
 * Builds the PATH used for detection. A VS Code window launched from the macOS
 * Dock or a Linux desktop entry inherits a minimal PATH, so the common install
 * locations for Node, npm and OpenCode have to be added explicitly or a working
 * install is reported as missing.
 */
function buildSearchPath(platform) {
    const current = process.env.PATH || "";
    if (platform === "win32") {
        const extra = [
            process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : undefined,
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "opencode") : undefined,
            process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".opencode", "bin") : undefined,
            process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "scoop", "shims") : undefined
        ].filter((entry) => Boolean(entry));
        return [current, ...extra].filter(Boolean).join(path.delimiter);
    }
    const home = os.homedir();
    const extra = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/snap/bin",
        path.join(home, ".opencode", "bin"),
        path.join(home, ".local", "bin"),
        path.join(home, ".bun", "bin"),
        path.join(home, ".npm-global", "bin")
    ];
    return [current, ...extra].filter(Boolean).join(path.delimiter);
}
/**
 * Runs an executable with an argument array (never a shell string) so no value
 * can be interpreted as a shell command, and always with a timeout so a hung
 * child process cannot freeze the hub.
 */
async function runCommand(file, args, timeoutMs, searchPath, platform) {
    try {
        const { stdout, stderr } = await execFileAsync(file, args, {
            env: { ...process.env, PATH: searchPath },
            timeout: timeoutMs,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
            // .cmd/.bat shims on Windows are not executables and need the shell.
            shell: platform === "win32"
        });
        return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    }
    catch (error) {
        const failure = error;
        const reason = failure.killed
            ? `\`${file}\` timed out after ${Math.round(timeoutMs / 1000)}s.`
            : failure.code === "ENOENT"
                ? `\`${file}\` was not found on PATH.`
                : (failure.stderr || failure.message || "").trim() || `\`${file}\` failed.`;
        return { ok: false, stdout: (failure.stdout || "").trim(), stderr: (failure.stderr || "").trim(), reason };
    }
}
function getWorkspacePath() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}
/**
 * Detects the environment on any platform.
 *
 * OpenCode counts as installed only when `opencode --version` actually runs:
 * an npm listing or a dead file on PATH means a partial install, which is
 * reported as broken rather than green.
 */
async function runSystemChecks(platform, searchPath) {
    const npmBin = platform === "win32" ? "npm.cmd" : "npm";
    const [node, npm, version] = await Promise.all([
        runCommand("node", ["-v"], 5000, searchPath, platform),
        runCommand(npmBin, ["-v"], 8000, searchPath, platform),
        runCommand(OPENCODE_BIN, ["--version"], 8000, searchPath, platform)
    ]);
    let openCodeInstalled = false;
    let openCodeVersion = "";
    let openCodeBroken = false;
    if (version.ok && version.stdout.length > 0) {
        openCodeInstalled = true;
        openCodeVersion = version.stdout.split("\n")[0].trim();
    }
    else {
        // `command -v` is a shell builtin, not an executable, so POSIX uses
        // `which` (present on macOS and every mainstream Linux distribution).
        const lookup = platform === "win32"
            ? await runCommand("where", [OPENCODE_BIN], 5000, searchPath, platform)
            : await runCommand("which", [OPENCODE_BIN], 5000, searchPath, platform);
        if (lookup.ok && lookup.stdout.length > 0) {
            // A file named `opencode` exists on PATH but does not run.
            openCodeBroken = true;
        }
        else if (npm.ok) {
            const listed = await runCommand(npmBin, ["list", "-g", OPENCODE_NPM_PACKAGE, "--depth=0"], 15000, searchPath, platform);
            if (listed.stdout.toLowerCase().includes(`${OPENCODE_NPM_PACKAGE}@`)) {
                // npm still lists the package but no working binary exists.
                openCodeBroken = true;
            }
        }
    }
    return {
        platform,
        nodeInstalled: node.ok && node.stdout.length > 0,
        nodeVersion: node.stdout,
        npmInstalled: npm.ok && npm.stdout.length > 0,
        openCodeInstalled,
        openCodeVersion,
        openCodeBroken,
        workspacePath: getWorkspacePath()
    };
}
/**
 * Runs a command in a terminal once its shell is ready.
 *
 * `shellIntegration` only exists on VS Code 1.93+, so the API is feature-checked
 * before use; older hosts fall back to typing the command.
 */
function executeWhenShellReady(terminal, commandLine, timeoutMs) {
    const onDidChange = vscode.window.onDidChangeTerminalShellIntegration;
    if (typeof onDidChange !== "function")
        return Promise.resolve(false);
    return new Promise(resolve => {
        if (terminal.shellIntegration) {
            terminal.shellIntegration.executeCommand(commandLine);
            resolve(true);
            return;
        }
        const timer = setTimeout(() => {
            listener.dispose();
            resolve(false);
        }, timeoutMs);
        const listener = onDidChange(event => {
            if (event.terminal === terminal && terminal.shellIntegration) {
                clearTimeout(timer);
                listener.dispose();
                terminal.shellIntegration.executeCommand(commandLine);
                resolve(true);
            }
        });
    });
}
function registerOpenCodeIntegrationCommand(context) {
    let activePanel;
    const command = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.openCodeIntegration", () => {
        if (activePanel) {
            activePanel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel("openCodeIntegrationHub", "OpenCode Integration Hub", vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)]
        });
        activePanel = panel;
        panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, "logo.png"));
        const platform = os.platform();
        const searchPath = buildSearchPath(platform);
        const npmBin = platform === "win32" ? "npm.cmd" : "npm";
        let disposed = false;
        let busy = false;
        const post = (message) => {
            if (disposed)
                return;
            (0, webview_ui_1.safePostMessage)(panel, message);
        };
        // Render immediately with a loading state: detection spawns child processes
        // and can take several seconds, and a blank panel looks like a broken tool.
        panel.webview.html = getOpenCodeHubHtml(platform);
        post({ command: "hubLoading", message: "Checking Node.js, npm and OpenCode on this machine..." });
        const refresh = async (banner) => {
            const status = await runSystemChecks(platform, searchPath);
            post({ command: "hubStatus", ...status, ...(banner ?? {}) });
            return status;
        };
        void refresh().catch(error => {
            post({
                command: "hubStatus",
                platform,
                nodeInstalled: false,
                nodeVersion: "",
                npmInstalled: false,
                openCodeInstalled: false,
                openCodeVersion: "",
                openCodeBroken: false,
                workspacePath: getWorkspacePath(),
                ok: false,
                message: `Environment check failed: ${error instanceof Error ? error.message : String(error)}`
            });
        });
        const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.command !== "string")
                return;
            // Detection and installs spawn processes; ignore repeat clicks while one runs.
            if (busy && message.command !== "download-node")
                return;
            busy = true;
            try {
                switch (message.command) {
                    case "refresh": {
                        post({ command: "hubLoading", message: "Running system environment diagnostics..." });
                        await refresh();
                        break;
                    }
                    case "download-node": {
                        await vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/"));
                        break;
                    }
                    case "install-opencode": {
                        const preCheck = await runSystemChecks(platform, searchPath);
                        if (!preCheck.npmInstalled) {
                            post({
                                command: "hubStatus",
                                ...preCheck,
                                ok: false,
                                message: "npm was not found on PATH, so OpenCode cannot be installed automatically. Install Node.js (which includes npm) and press Recheck System."
                            });
                            break;
                        }
                        post({ command: "hubLoading", message: `Installing OpenCode (npm i -g ${OPENCODE_NPM_PACKAGE})... this can take a minute.` });
                        if (preCheck.openCodeBroken) {
                            // Clear the stale/partial install so the reinstall starts clean.
                            await runCommand(npmBin, ["rm", "-g", OPENCODE_NPM_PACKAGE], 120000, searchPath, platform);
                        }
                        // sudo is never run here: without a TTY it would block forever
                        // waiting for a password. A failure falls back to a real terminal.
                        const install = await runCommand(npmBin, ["install", "-g", OPENCODE_NPM_PACKAGE], 300000, searchPath, platform);
                        const status = await runSystemChecks(platform, searchPath);
                        if (install.ok && status.openCodeInstalled) {
                            vscode.window.showInformationMessage("OpenCode installed and verified successfully.");
                            post({
                                command: "hubStatus",
                                ...status,
                                ok: true,
                                message: `OpenCode ${status.openCodeVersion} is installed and verified. You can launch it now.`
                            });
                            break;
                        }
                        const terminal = vscode.window.createTerminal({ name: "Install OpenCode" });
                        terminal.show();
                        terminal.sendText(`${npmBin} install -g ${OPENCODE_NPM_PACKAGE}`, false);
                        const detail = install.reason ? ` Reason: ${install.reason}` : "";
                        vscode.window.showWarningMessage("The automatic npm install did not produce a working `opencode` command (usually a permissions issue). A terminal was opened with the command ready to run.");
                        post({
                            command: "hubStatus",
                            ...status,
                            ok: false,
                            message: `OpenCode still does not run after the install attempt.${detail} A terminal was opened with the install command - run it there (with sudo on macOS/Linux if your npm prefix needs it), then press Recheck System.`
                        });
                        break;
                    }
                    case "launch-opencode": {
                        const status = await runSystemChecks(platform, searchPath);
                        if (!status.openCodeInstalled) {
                            post({
                                command: "hubStatus",
                                ...status,
                                ok: false,
                                message: "OpenCode is not detected on this machine yet. Install it first, then launch."
                            });
                            break;
                        }
                        const workspacePath = getWorkspacePath();
                        const terminal = vscode.window.createTerminal({ name: "OpenCode", cwd: workspacePath });
                        terminal.show();
                        // Wait for shell initialisation before sending the command. On
                        // Windows, PowerShell may first show an execution-policy prompt and
                        // text sent too early would answer that prompt instead of running.
                        const launched = await executeWhenShellReady(terminal, OPENCODE_BIN, 15000);
                        if (launched) {
                            post({
                                command: "hubStatus",
                                ...status,
                                ok: true,
                                message: workspacePath
                                    ? `OpenCode launched in ${workspacePath}.`
                                    : "OpenCode launched. No workspace folder is open, so it started in your home directory."
                            });
                            break;
                        }
                        terminal.sendText(OPENCODE_BIN);
                        post({
                            command: "hubStatus",
                            ...status,
                            ok: false,
                            message: platform === "win32"
                                ? "PowerShell may have blocked the automatic launch with a script security prompt. Answer the prompt in the terminal, or use one of the options in the notification."
                                : "The terminal shell was not ready, so the command was typed into it. Press Enter in the terminal if OpenCode did not start."
                        });
                        if (platform === "win32") {
                            const action = await vscode.window.showWarningMessage("PowerShell may have blocked the automatic OpenCode launch with a script security prompt.", "Launch in Command Prompt", "Copy PowerShell Fix");
                            if (action === "Launch in Command Prompt") {
                                // cmd.exe has no execution-policy prompt, so this just works.
                                const cmdTerminal = vscode.window.createTerminal({ name: "OpenCode", cwd: workspacePath, shellPath: "cmd.exe" });
                                cmdTerminal.show();
                                cmdTerminal.sendText(OPENCODE_BIN);
                            }
                            else if (action === "Copy PowerShell Fix") {
                                await vscode.env.clipboard.writeText("Set-ExecutionPolicy -Scope CurrentUser RemoteSigned");
                                vscode.window.showInformationMessage("Fix copied. Paste and run it in PowerShell, restart the terminal, then launch OpenCode again.");
                            }
                        }
                        break;
                    }
                }
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                post({ command: "hubStatus", ...(await runSystemChecks(platform, searchPath)), ok: false, message: `That action failed: ${detail}` });
                vscode.window.showErrorMessage(`OpenCode Integration: ${detail}`);
            }
            finally {
                busy = false;
            }
        });
        panel.onDidDispose(() => {
            disposed = true;
            messageSubscription.dispose();
            if (activePanel === panel)
                activePanel = undefined;
        });
    });
    context.subscriptions.push(command);
}
exports.registerOpenCodeIntegrationCommand = registerOpenCodeIntegrationCommand;
function installStepsFor(platform) {
    if (platform === "win32") {
        return `
        <div class="step-item"><strong>Option A (npm, all platforms):</strong> <code>npm install -g opencode-ai</code></div>
        <div class="step-item"><strong>Option B (Chocolatey):</strong> <code>choco install opencode</code></div>
        <div class="step-item"><strong>Option C (Scoop):</strong> <code>scoop install opencode</code></div>
        <div class="step-item">Tip: on Windows, OpenCode also runs well inside WSL.</div>`;
    }
    if (platform === "darwin") {
        return `
        <div class="step-item"><strong>Option A (npm, all platforms):</strong> <code>npm install -g opencode-ai</code></div>
        <div class="step-item"><strong>Option B (Homebrew):</strong> <code>brew install anomalyco/tap/opencode</code></div>
        <div class="step-item"><strong>Option C (install script):</strong> <code>curl -fsSL https://opencode.ai/install | bash</code></div>`;
    }
    return `
        <div class="step-item"><strong>Option A (npm, all platforms):</strong> <code>npm install -g opencode-ai</code></div>
        <div class="step-item"><strong>Option B (Homebrew on Linux):</strong> <code>brew install anomalyco/tap/opencode</code></div>
        <div class="step-item"><strong>Option C (install script):</strong> <code>curl -fsSL https://opencode.ai/install | bash</code></div>
        <div class="step-item"><strong>Option D (Arch):</strong> <code>sudo pacman -S opencode</code></div>`;
}
function nodeStepsFor(platform) {
    if (platform === "win32") {
        return `<div class="step-item"><strong>Windows:</strong> install the LTS build from nodejs.org, or run <code>winget install OpenJS.NodeJS.LTS</code></div>`;
    }
    if (platform === "darwin") {
        return `<div class="step-item"><strong>macOS:</strong> run <code>brew install node</code>, or install the LTS build from nodejs.org</div>`;
    }
    return `<div class="step-item"><strong>Linux:</strong> run <code>sudo apt install nodejs npm</code> (Debian/Ubuntu), or use NodeSource / nvm</div>`;
}
function platformLabel(platform) {
    if (platform === "win32")
        return "Windows";
    if (platform === "darwin")
        return "macOS";
    if (platform === "linux")
        return "Linux";
    return platform;
}
/**
 * The page renders once with a loading state and is then driven entirely by
 * postMessage, so the panel is visible immediately while detection runs.
 */
function getOpenCodeHubHtml(platform) {
    const nonce = (0, webview_ui_1.getNonce)();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>OpenCode Integration Hub</title>
  <style>
    ${webview_ui_1.THEME_TOKENS}
    * { box-sizing: border-box; }
    body { font-family: var(--font); background: var(--bg); color: var(--text); margin: 0; padding: clamp(18px, 4vw, 32px); line-height: 1.5; font-size: 13px; }
    .header { margin-bottom: 24px; border-bottom: 1px solid var(--line); padding-bottom: 16px; }
    .header h1 { margin: 0 0 6px 0; font-size: 22px; color: var(--accent); }
    .header p { margin: 0; color: var(--muted); font-size: 13px; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .status-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
    .status-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
    .status-value { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .status-desc { font-size: 12px; color: var(--muted); }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); }
    .badge.success { color: var(--success); border-color: var(--success); }
    .badge.error { color: var(--danger); border-color: var(--danger); }
    .badge.pending { color: var(--muted); }
    .alert { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 22px; margin-top: 16px; }
    .alert.error { border-color: var(--danger); }
    .alert.warning { border-color: var(--warning); }
    .alert.success-box { border-color: var(--success); }
    .alert h3 { margin-top: 0; margin-bottom: 12px; font-size: 17px; }
    .step-list { margin: 12px 0; display: flex; flex-direction: column; gap: 8px; }
    .step-item { font-size: 13px; }
    code { background: var(--panel-2); padding: 2px 6px; border-radius: 4px; font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
    pre { background: var(--panel-2); border: 1px solid var(--line); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 12px 0; }
    pre code { background: transparent; padding: 0; }
    .workspace-card { background: var(--panel-2); border: 1px solid var(--line); padding: 12px 16px; border-radius: 6px; margin: 14px 0; font-size: 13px; overflow-wrap: anywhere; }
    .btn-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); padding: 9px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn:hover { border-color: var(--focus); }
    .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .btn.primary { background: var(--accent-strong); color: var(--accent-fg); border-color: transparent; }
    .btn[disabled] { opacity: 0.55; cursor: progress; }
    .banner { border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; display: none; border: 1px solid var(--line); }
    .banner.ok { display: block; border-color: var(--success); }
    .banner.fail { display: block; border-color: var(--danger); }
    .broken-note { border: 1px solid var(--danger); border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 13px; }
    .loading-container { text-align: center; padding: 48px 20px; }
    .spinner { width: 34px; height: 34px; border: 3px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>OpenCode Integration Hub</h1>
    <p>Environment diagnostics and workspace integration for Windows, macOS and Linux. Detected platform: <strong>${(0, webview_ui_1.escapeHtml)(platformLabel(platform))}</strong>.</p>
  </div>

  <div id="actionBanner" class="banner" role="status"></div>

  <div id="loadingOverlay" class="loading-container">
    <div class="spinner"></div>
    <p id="loadingText">Checking your environment...</p>
  </div>

  <div id="mainContent" hidden>
    <div class="status-grid">
      <div class="status-card">
        <div class="status-title">Node.js runtime</div>
        <div class="status-value"><span id="nodeBadge" class="badge pending">Checking...</span></div>
        <div class="status-desc">Required to install and run OpenCode.</div>
      </div>
      <div class="status-card">
        <div class="status-title">OpenCode CLI</div>
        <div class="status-value"><span id="openCodeBadge" class="badge pending">Checking...</span></div>
        <div class="status-desc">AI coding agent platform.</div>
      </div>
    </div>

    <div id="sectionNodeMissing" class="alert error" hidden>
      <h3>Node.js was not detected</h3>
      <p>Node.js is required to install and run OpenCode on every operating system.</p>
      <div class="step-list">${nodeStepsFor(platform)}</div>
      <div class="btn-row" style="margin-top: 16px;">
        <button id="btnDownloadNode" class="btn primary" type="button">Open nodejs.org</button>
        <button id="btnRecheckNode" class="btn" type="button">Recheck system</button>
      </div>
    </div>

    <div id="sectionInstall" class="alert warning" hidden>
      <h3 id="installHeading">OpenCode is not installed</h3>
      <div id="brokenNotice" class="broken-note" hidden>Partial or broken installation detected: the package is present but the <code>opencode</code> command does not run. Use the repair button to remove and reinstall it cleanly.</div>
      <p>Node.js <span id="nodeVersionText"></span> is available, but the OpenCode CLI is not usable yet.</p>
      <pre><code>npm install -g opencode-ai</code></pre>
      <div class="step-list">${installStepsFor(platform)}</div>
      <div class="btn-row" style="margin-top: 16px;">
        <button id="btnInstallOpenCode" class="btn primary" type="button">Install OpenCode now</button>
        <button id="btnRecheckInstall" class="btn" type="button">Recheck system</button>
      </div>
    </div>

    <div id="sectionReady" class="alert success-box" hidden>
      <h3>System ready</h3>
      <p>Node.js <span id="readyNodeVersion"></span> and OpenCode <span id="readyOpenCodeVersion"></span> are installed and verified.</p>
      <div class="workspace-card">
        <strong>Active workspace folder:</strong>
        <code id="workspacePath">-</code>
      </div>
      <div class="btn-row" style="margin-top: 18px;">
        <button id="btnLaunchOpenCode" class="btn primary" type="button">Launch OpenCode in terminal</button>
        <button id="btnRecheckReady" class="btn" type="button">Recheck system</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const SECTIONS = ['sectionNodeMissing', 'sectionInstall', 'sectionReady'];

      function byId(id) { return document.getElementById(id); }

      function showSection(id) {
        SECTIONS.forEach(function (section) {
          const el = byId(section);
          if (el) el.hidden = section !== id;
        });
      }

      function setBadge(id, installed, text) {
        const el = byId(id);
        if (!el) return;
        el.textContent = text;
        el.className = 'badge ' + (installed ? 'success' : 'error');
      }

      function setBusy(isBusy) {
        document.querySelectorAll('.btn').forEach(function (button) { button.disabled = isBusy; });
      }

      function showLoading(message) {
        setBusy(true);
        const overlay = byId('loadingOverlay');
        const text = byId('loadingText');
        const main = byId('mainContent');
        if (text) text.textContent = message || 'Working...';
        if (overlay) overlay.hidden = false;
        if (main) main.hidden = true;
      }

      function showBanner(ok, message) {
        const banner = byId('actionBanner');
        if (!banner) return;
        if (!message) { banner.className = 'banner'; banner.textContent = ''; return; }
        banner.textContent = message;
        banner.className = 'banner ' + (ok ? 'ok' : 'fail');
      }

      function renderStatus(msg) {
        setBusy(false);
        const overlay = byId('loadingOverlay');
        const main = byId('mainContent');
        if (overlay) overlay.hidden = true;
        if (main) main.hidden = false;

        setBadge('nodeBadge', msg.nodeInstalled, msg.nodeInstalled ? ('Installed ' + (msg.nodeVersion || '')) : 'Not detected');
        setBadge('openCodeBadge', msg.openCodeInstalled, msg.openCodeInstalled
          ? ('Installed ' + (msg.openCodeVersion || ''))
          : (msg.openCodeBroken ? 'Broken install' : 'Not detected'));

        const workspace = byId('workspacePath');
        if (workspace) workspace.textContent = msg.workspacePath || 'No folder open - OpenCode will start in your home directory';
        const nodeVersionText = byId('nodeVersionText');
        if (nodeVersionText) nodeVersionText.textContent = msg.nodeVersion || '';
        const readyNode = byId('readyNodeVersion');
        if (readyNode) readyNode.textContent = msg.nodeVersion || '';
        const readyOpenCode = byId('readyOpenCodeVersion');
        if (readyOpenCode) readyOpenCode.textContent = msg.openCodeVersion || '';

        const broken = byId('brokenNotice');
        if (broken) broken.hidden = !msg.openCodeBroken;
        const installButton = byId('btnInstallOpenCode');
        if (installButton) installButton.textContent = msg.openCodeBroken ? 'Repair OpenCode now' : 'Install OpenCode now';
        const installHeading = byId('installHeading');
        if (installHeading) installHeading.textContent = msg.openCodeBroken ? 'OpenCode needs repairing' : 'OpenCode is not installed';

        if (!msg.nodeInstalled) showSection('sectionNodeMissing');
        else if (!msg.openCodeInstalled) showSection('sectionInstall');
        else showSection('sectionReady');
      }

      function send(command) { return function () { vscode.postMessage({ command: command }); }; }

      byId('btnDownloadNode').addEventListener('click', send('download-node'));
      byId('btnInstallOpenCode').addEventListener('click', send('install-opencode'));
      byId('btnLaunchOpenCode').addEventListener('click', send('launch-opencode'));
      byId('btnRecheckNode').addEventListener('click', send('refresh'));
      byId('btnRecheckInstall').addEventListener('click', send('refresh'));
      byId('btnRecheckReady').addEventListener('click', send('refresh'));

      window.addEventListener('message', function (event) {
        const msg = event.data;
        if (!msg || !msg.command) return;
        if (msg.command === 'hubLoading') { showBanner(false, ''); showLoading(msg.message); }
        else if (msg.command === 'hubStatus') { showBanner(msg.ok, msg.message); renderStatus(msg); }
      });
    })();
  </script>
</body>
</html>`;
}
//# sourceMappingURL=openCodeIntegration.js.map