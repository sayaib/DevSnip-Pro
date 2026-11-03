import { publishSidebarUpdate } from "./sidebar";
import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import {
  builtInPolicy,
  changelogUrl,
  checkIntervalMs,
  CheckResult,
  extensionPageUrl,
  fetchLatest,
  HOUR,
  isCheckDue,
  isNewer,
  markInstalled,
  markNotified,
  normalizeState,
  present,
  recordCheck,
  Release,
  skip,
  snooze,
  sourceForHost,
  UpdateState
} from "./core";

/**
 * Update notifications: a daily background check against the Marketplace (or
 * Open VSX on other hosts), a status bar item while a newer version is
 * available, at most one notification per version, and a Quick Pick to
 * update, snooze, read the changelog or skip the version. Nothing installs
 * without the user's click.
 */

export const EXTENSION_ID = "sayaib.hue-console";
export const CHECK_COMMAND = `${COMMAND_PREFIX}checkForUpdates`;
/** Run by the status bar item and notification; not in the Command Palette. */
export const ACTIONS_COMMAND = `${COMMAND_PREFIX}updateActions`;
const STATE_KEY = "devsnip.updates";
/** Whether a check is due is re-evaluated this often; the network is only used when it is. */
const TICK_MS = HOUR;

type Action = "update" | "later" | "changelog" | "skip";

export interface UpdateDeps {
  fetch: Parameters<typeof fetchLatest>[3];
  now: () => number;
}

function log(message: string, error?: unknown): void {
  console.warn(`DevSnip Pro: ${message}`, ...(error === undefined ? [] : [error]));
}

export class UpdateManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private item: vscode.StatusBarItem | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking: Promise<CheckResult> | undefined;
  private installing = false;
  private started = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly deps: UpdateDeps) {
    this.disposables.push(
      registerTrackedCommand(CHECK_COMMAND, () => this.checkNow()),
      registerTrackedCommand(ACTIONS_COMMAND, () => this.showActions())
    );
  }

  /** Starts the background schedule. Safe to call more than once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (["devsnip.updates", "extensions.autoUpdate", "extensions.autoCheckUpdates"].some(key => event.affectsConfiguration(key))) void this.tick();
      }),
      // An update installed from the Extensions view (or by VS Code) hides the indicator.
      vscode.extensions.onDidChange(() => this.render())
    );
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.render();
    void this.tick(true);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item?.dispose();
    this.item = undefined;
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private get settings() {
    const config = vscode.workspace.getConfiguration("devsnip.updates");
    const extensions = vscode.workspace.getConfiguration("extensions");
    const hours = Number(config.get<number>("remindLaterHours", 24));
    return {
      enabled: config.get<boolean>("notifications", true) !== false,
      intervalMs: checkIntervalMs(config.get<string>("checkFrequency", "hourly")),
      remindLaterMs: (Number.isFinite(hours) ? Math.min(720, Math.max(1, hours)) : 24) * HOUR,
      ...builtInPolicy(extensions.get("autoUpdate", true), extensions.get("autoCheckUpdates", true))
    };
  }

  /** The installed version: the one on disk when an update was installed outside this window. */
  private get installed(): string {
    const ours = vscode.extensions?.getExtension?.(EXTENSION_ID)?.packageJSON?.version;
    return String(ours ?? this.context.extension?.packageJSON?.version ?? "0.0.0");
  }

  private read(): UpdateState {
    return normalizeState(this.context.globalState.get(STATE_KEY));
  }

  private async write(state: UpdateState): Promise<void> {
    await this.context.globalState.update(STATE_KEY, state);
  }

  /** Checks when one is due, then updates what is shown. Never throws. */
  async tick(startup = false): Promise<void> {
    try {
      const settings = this.settings;
      const automatic = settings.enabled && settings.automaticChecks && settings.intervalMs !== undefined
        && this.context.extensionMode !== vscode.ExtensionMode.Test;
      if (automatic && isCheckDue(this.read(), this.deps.now(), startup ? 0 : settings.intervalMs!)) await this.check();
      this.render();
    } catch (error) {
      log("update check failed.", error);
    }
  }

  /** One request at a time; concurrent callers share it. */
  private check(): Promise<CheckResult> {
    if (!this.checking) {
      const source = sourceForHost(vscode.env.appName ?? "");
      this.checking = fetchLatest(EXTENSION_ID, source, vscode.version, this.deps.fetch)
        .then(async result => {
          if (!result.ok) log(`could not check ${source === "openvsx" ? "Open VSX" : "the Marketplace"} for updates (${result.reason}).`);
          await this.write(recordCheck(this.read(), result, this.deps.now()));
          return result;
        })
        .finally(() => { this.checking = undefined; });
    }
    return this.checking;
  }

  /** Shows or hides the status bar item, and the one notification per version. */
  render(): void {
    const settings = this.settings;
    const sidebar = present(this.read(), this.installed, this.deps.now(), { deferToBuiltIn: false });
    const preview = this.context.extensionMode === vscode.ExtensionMode.Development
      && process.env.DEVSNIP_PREVIEW_UPDATE === "1";
    publishSidebarUpdate(preview ? { version: this.installed, preview: true }
      : settings.enabled && sidebar.indicator && !this.installing ? sidebar.available : undefined);
    const view = present(this.read(), this.installed, this.deps.now(), { deferToBuiltIn: settings.deferToBuiltIn });
    if (!settings.enabled || !view.indicator || !view.available || this.installing) {
      this.item?.hide();
      return;
    }
    const release = view.available;
    const item = this.item ??= vscode.window.createStatusBarItem("devsnip.update", vscode.StatusBarAlignment.Right, 100);
    item.name = "DevSnip Pro Update";
    item.text = "$(arrow-circle-up) DevSnip Pro";
    item.tooltip = `DevSnip Pro ${release.version} is available (installed: ${this.installed}). Click for update options.`;
    item.accessibilityInformation = { label: `DevSnip Pro ${release.version} is available. Update options.` };
    item.command = ACTIONS_COMMAND;
    item.show();
    if (view.notify) void this.notify(release);
  }

  private async notify(release: Release): Promise<void> {
    // Recorded first, so another window or render never shows it a second time.
    await this.write(markNotified(this.read(), release.version));
    const choice = await vscode.window.showInformationMessage(
      `DevSnip Pro ${release.version} is available. You have ${this.installed}.`,
      "Update Now", "View Changelog", "Remind Me Later"
    );
    const action: Record<string, Action> = { "Update Now": "update", "View Changelog": "changelog", "Remind Me Later": "later" };
    if (choice && action[choice]) await this.run(action[choice], release);
  }

  /** The status bar item's Quick Pick. */
  async showActions(): Promise<void> {
    const state = this.read();
    if (!state.latest || !isNewer(state.latest.version, this.installed)) {
      await this.checkNow();
      return;
    }
    const release: Release = { version: state.latest.version, source: state.latest.source };
    const hours = Math.round(this.settings.remindLaterMs / HOUR);
    const items: Array<vscode.QuickPickItem & { action: Action }> = [
      { action: "update", label: "$(cloud-download) Update Now", description: `Install ${release.version}` },
      { action: "later", label: "$(clock) Remind Me Later", description: `Hide for ${hours} hour${hours === 1 ? "" : "s"}` },
      { action: "changelog", label: "$(book) View Changelog", description: `What's new in ${release.version}` },
      { action: "skip", label: "$(circle-slash) Skip This Version", description: `No more reminders for ${release.version}` }
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `DevSnip Pro ${release.version} is available (installed: ${this.installed})`,
      placeHolder: "Choose what to do with this update"
    });
    if (picked) await this.run(picked.action, release);
  }

  async run(action: Action, release: Release): Promise<void> {
    switch (action) {
      case "update":
        return this.install(release);
      case "later":
        await this.write(snooze(this.read(), release.version, this.deps.now(), this.settings.remindLaterMs));
        return this.render();
      case "skip":
        await this.write(skip(this.read(), release.version));
        return this.render();
      case "changelog":
        return this.openChangelog(release);
    }
  }

  /** Installs through VS Code, or opens the extension's page where that is not possible. */
  private async install(release: Release): Promise<void> {
    if (this.installing) return;
    this.installing = true;
    this.render();
    const from = this.installed;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Updating DevSnip Pro to ${release.version}…` },
        () => Promise.resolve(vscode.commands.executeCommand("workbench.extensions.installExtension", EXTENSION_ID))
      );
      await this.write(markInstalled(this.read(), release.version, from, this.deps.now()));
    } catch (error) {
      log("the update could not be installed directly; opening the extension page instead.", error);
      await this.openPage(release);
      return;
    } finally {
      this.installing = false;
      this.render();
    }
    const choice = await vscode.window.showInformationMessage(
      `DevSnip Pro ${release.version} is installed. Reload the window to start using it.`,
      "Reload Window"
    );
    if (choice === "Reload Window") await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }

  private async openPage(release: Release): Promise<void> {
    try {
      await vscode.commands.executeCommand("extension.open", EXTENSION_ID);
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(extensionPageUrl(EXTENSION_ID, release.source)));
    }
  }

  /**
   * The new release's notes are not in the installed CHANGELOG.md yet, so the
   * extension page's Changelog tab (VS Code fetches the newer one) comes first.
   * After the update the sidebar's What's New card shows the highlights.
   */
  private async openChangelog(release: Release): Promise<void> {
    try {
      await vscode.commands.executeCommand("extension.open", EXTENSION_ID, "changelog");
      return;
    } catch (error) {
      log("the extension page could not be opened.", error);
    }
    if (await vscode.env.openExternal(vscode.Uri.parse(changelogUrl(EXTENSION_ID, release.source)))) return;
    await vscode.commands.executeCommand(`${COMMAND_PREFIX}whatsNew`);
  }

  /** "Check for Updates": always asks the gallery, and reports the outcome. */
  async checkNow(): Promise<void> {
    const result = await this.check();
    this.render();
    if (!result.ok) {
      void vscode.window.showWarningMessage(`DevSnip Pro could not check for updates (${result.reason}). Try again later.`);
      return;
    }
    if (result.latest && isNewer(result.latest.version, this.installed)) {
      void this.showActions();
      return;
    }
    void vscode.window.showInformationMessage(`DevSnip Pro ${this.installed} is the latest version.`);
  }
}

let manager: UpdateManager | undefined;

/** The window's one manager; it registers the update commands when created. */
export function getUpdateManager(context: vscode.ExtensionContext): UpdateManager {
  if (!manager) {
    const created = new UpdateManager(context, { fetch: (url, init) => fetch(url, init), now: Date.now });
    manager = created;
    context.subscriptions.push({ dispose: () => { created.dispose(); if (manager === created) manager = undefined; } });
  }
  return manager;
}
