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
exports.getUpdateManager = exports.UpdateManager = exports.ACTIONS_COMMAND = exports.CHECK_COMMAND = exports.EXTENSION_ID = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
const core_1 = require("./core");
/**
 * Update notifications: a daily background check against the Marketplace (or
 * Open VSX on other hosts), a status bar item while a newer version is
 * available, at most one notification per version, and a Quick Pick to
 * update, snooze, read the changelog or skip the version. Nothing installs
 * without the user's click.
 */
exports.EXTENSION_ID = "sayaib.hue-console";
exports.CHECK_COMMAND = `${command_registry_1.COMMAND_PREFIX}checkForUpdates`;
/** Run by the status bar item and notification; not in the Command Palette. */
exports.ACTIONS_COMMAND = `${command_registry_1.COMMAND_PREFIX}updateActions`;
const STATE_KEY = "devsnip.updates";
/** Whether a check is due is re-evaluated this often; the network is only used when it is. */
const TICK_MS = core_1.HOUR;
function log(message, error) {
    console.warn(`DevSnip Pro: ${message}`, ...(error === undefined ? [] : [error]));
}
class UpdateManager {
    constructor(context, deps) {
        this.context = context;
        this.deps = deps;
        this.disposables = [];
        this.installing = false;
        this.started = false;
        this.disposables.push((0, command_registry_1.registerTrackedCommand)(exports.CHECK_COMMAND, () => this.checkNow()), (0, command_registry_1.registerTrackedCommand)(exports.ACTIONS_COMMAND, () => this.showActions()));
    }
    /** Starts the background schedule. Safe to call more than once. */
    start() {
        if (this.started)
            return;
        this.started = true;
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (["devsnip.updates", "extensions.autoUpdate", "extensions.autoCheckUpdates"].some(key => event.affectsConfiguration(key)))
                void this.tick();
        }), 
        // An update installed from the Extensions view (or by VS Code) hides the indicator.
        vscode.extensions.onDidChange(() => this.render()));
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        void this.tick();
    }
    dispose() {
        if (this.timer)
            clearInterval(this.timer);
        this.item?.dispose();
        this.item = undefined;
        for (const disposable of this.disposables.splice(0))
            disposable.dispose();
    }
    get settings() {
        const config = vscode.workspace.getConfiguration("devsnip.updates");
        const extensions = vscode.workspace.getConfiguration("extensions");
        const hours = Number(config.get("remindLaterHours", 24));
        return {
            enabled: config.get("notifications", true) !== false,
            intervalMs: (0, core_1.checkIntervalMs)(config.get("checkFrequency", "daily")),
            remindLaterMs: (Number.isFinite(hours) ? Math.min(720, Math.max(1, hours)) : 24) * core_1.HOUR,
            ...(0, core_1.builtInPolicy)(extensions.get("autoUpdate", true), extensions.get("autoCheckUpdates", true))
        };
    }
    /** The installed version: the one on disk when an update was installed outside this window. */
    get installed() {
        const ours = vscode.extensions?.getExtension?.(exports.EXTENSION_ID)?.packageJSON?.version;
        return String(ours ?? this.context.extension?.packageJSON?.version ?? "0.0.0");
    }
    read() {
        return (0, core_1.normalizeState)(this.context.globalState.get(STATE_KEY));
    }
    async write(state) {
        await this.context.globalState.update(STATE_KEY, state);
    }
    /** Checks when one is due, then updates what is shown. Never throws. */
    async tick() {
        try {
            const settings = this.settings;
            const automatic = settings.enabled && settings.automaticChecks && settings.intervalMs !== undefined
                && this.context.extensionMode !== vscode.ExtensionMode.Test;
            if (automatic && (0, core_1.isCheckDue)(this.read(), this.deps.now(), settings.intervalMs))
                await this.check();
            this.render();
        }
        catch (error) {
            log("update check failed.", error);
        }
    }
    /** One request at a time; concurrent callers share it. */
    check() {
        if (!this.checking) {
            const source = (0, core_1.sourceForHost)(vscode.env.appName ?? "");
            this.checking = (0, core_1.fetchLatest)(exports.EXTENSION_ID, source, vscode.version, this.deps.fetch)
                .then(async (result) => {
                if (!result.ok)
                    log(`could not check ${source === "openvsx" ? "Open VSX" : "the Marketplace"} for updates (${result.reason}).`);
                await this.write((0, core_1.recordCheck)(this.read(), result, this.deps.now()));
                return result;
            })
                .finally(() => { this.checking = undefined; });
        }
        return this.checking;
    }
    /** Shows or hides the status bar item, and the one notification per version. */
    render() {
        const settings = this.settings;
        const view = (0, core_1.present)(this.read(), this.installed, this.deps.now(), { deferToBuiltIn: settings.deferToBuiltIn });
        if (!settings.enabled || !view.indicator || !view.available || this.installing) {
            this.item?.hide();
            return;
        }
        const release = view.available;
        const item = this.item ?? (this.item = vscode.window.createStatusBarItem("devsnip.update", vscode.StatusBarAlignment.Right, 100));
        item.name = "DevSnip Pro Update";
        item.text = "$(arrow-circle-up) DevSnip Pro";
        item.tooltip = `DevSnip Pro ${release.version} is available (installed: ${this.installed}). Click for update options.`;
        item.accessibilityInformation = { label: `DevSnip Pro ${release.version} is available. Update options.` };
        item.command = exports.ACTIONS_COMMAND;
        item.show();
        if (view.notify)
            void this.notify(release);
    }
    async notify(release) {
        // Recorded first, so another window or render never shows it a second time.
        await this.write((0, core_1.markNotified)(this.read(), release.version));
        const choice = await vscode.window.showInformationMessage(`DevSnip Pro ${release.version} is available. You have ${this.installed}.`, "Update Now", "View Changelog", "Remind Me Later");
        const action = { "Update Now": "update", "View Changelog": "changelog", "Remind Me Later": "later" };
        if (choice && action[choice])
            await this.run(action[choice], release);
    }
    /** The status bar item's Quick Pick. */
    async showActions() {
        const state = this.read();
        if (!state.latest || !(0, core_1.isNewer)(state.latest.version, this.installed)) {
            await this.checkNow();
            return;
        }
        const release = { version: state.latest.version, source: state.latest.source };
        const hours = Math.round(this.settings.remindLaterMs / core_1.HOUR);
        const items = [
            { action: "update", label: "$(cloud-download) Update Now", description: `Install ${release.version}` },
            { action: "later", label: "$(clock) Remind Me Later", description: `Hide for ${hours} hour${hours === 1 ? "" : "s"}` },
            { action: "changelog", label: "$(book) View Changelog", description: `What's new in ${release.version}` },
            { action: "skip", label: "$(circle-slash) Skip This Version", description: `No more reminders for ${release.version}` }
        ];
        const picked = await vscode.window.showQuickPick(items, {
            title: `DevSnip Pro ${release.version} is available (installed: ${this.installed})`,
            placeHolder: "Choose what to do with this update"
        });
        if (picked)
            await this.run(picked.action, release);
    }
    async run(action, release) {
        switch (action) {
            case "update":
                return this.install(release);
            case "later":
                await this.write((0, core_1.snooze)(this.read(), release.version, this.deps.now(), this.settings.remindLaterMs));
                return this.render();
            case "skip":
                await this.write((0, core_1.skip)(this.read(), release.version));
                return this.render();
            case "changelog":
                return this.openChangelog(release);
        }
    }
    /** Installs through VS Code, or opens the extension's page where that is not possible. */
    async install(release) {
        if (this.installing)
            return;
        this.installing = true;
        this.render();
        const from = this.installed;
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Updating DevSnip Pro to ${release.version}…` }, () => Promise.resolve(vscode.commands.executeCommand("workbench.extensions.installExtension", exports.EXTENSION_ID)));
            await this.write((0, core_1.markInstalled)(this.read(), release.version, from, this.deps.now()));
        }
        catch (error) {
            log("the update could not be installed directly; opening the extension page instead.", error);
            await this.openPage(release);
            return;
        }
        finally {
            this.installing = false;
            this.render();
        }
        const choice = await vscode.window.showInformationMessage(`DevSnip Pro ${release.version} is installed. Reload the window to start using it.`, "Reload Window");
        if (choice === "Reload Window")
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
    async openPage(release) {
        try {
            await vscode.commands.executeCommand("extension.open", exports.EXTENSION_ID);
        }
        catch {
            await vscode.env.openExternal(vscode.Uri.parse((0, core_1.extensionPageUrl)(exports.EXTENSION_ID, release.source)));
        }
    }
    /**
     * The new release's notes are not in the installed CHANGELOG.md yet, so the
     * extension page's Changelog tab (VS Code fetches the newer one) comes first.
     * After the update the sidebar's What's New card shows the highlights.
     */
    async openChangelog(release) {
        try {
            await vscode.commands.executeCommand("extension.open", exports.EXTENSION_ID, "changelog");
            return;
        }
        catch (error) {
            log("the extension page could not be opened.", error);
        }
        if (await vscode.env.openExternal(vscode.Uri.parse((0, core_1.changelogUrl)(exports.EXTENSION_ID, release.source))))
            return;
        await vscode.commands.executeCommand(`${command_registry_1.COMMAND_PREFIX}whatsNew`);
    }
    /** "Check for Updates": always asks the gallery, and reports the outcome. */
    async checkNow() {
        const result = await this.check();
        this.render();
        if (!result.ok) {
            void vscode.window.showWarningMessage(`DevSnip Pro could not check for updates (${result.reason}). Try again later.`);
            return;
        }
        if (result.latest && (0, core_1.isNewer)(result.latest.version, this.installed)) {
            void this.showActions();
            return;
        }
        void vscode.window.showInformationMessage(`DevSnip Pro ${this.installed} is the latest version.`);
    }
}
exports.UpdateManager = UpdateManager;
let manager;
/** The window's one manager; it registers the update commands when created. */
function getUpdateManager(context) {
    if (!manager) {
        const created = new UpdateManager(context, { fetch: (url, init) => fetch(url, init), now: Date.now });
        manager = created;
        context.subscriptions.push({ dispose: () => { created.dispose(); if (manager === created)
                manager = undefined; } });
    }
    return manager;
}
exports.getUpdateManager = getUpdateManager;
//# sourceMappingURL=service.js.map