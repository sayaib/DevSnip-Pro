import * as vscode from "vscode";
import { injectTheme, themeMessage, ThemeSurface } from "./inject";
import { findTheme, swatches, SYSTEM_THEME_ID, THEMES, validThemeId } from "./themes";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import { noteThemeChosen } from "../onboarding/activation";
import { track } from "../analytics";

/**
 * The selected DevSnip Pro appearance theme.
 *
 * Every webview sets its HTML through `setWebviewHtml`, which applies the
 * current theme and remembers the webview. Choosing a theme stores it in
 * globalState (local to this machine, so it survives restarts) and pushes it
 * to every open webview at once.
 */

const THEME_KEY = "devsnip.appearance.theme";
/** Set once the theme in use when themes became paid has been handed over for free. */
const KEPT_KEY = "devsnip.appearance.keptThemeGranted";
export const CHOOSE_THEME_COMMAND = `${COMMAND_PREFIX}chooseTheme`;

let context: vscode.ExtensionContext | undefined;
let current = SYSTEM_THEME_ID;
const webviews = new Map<vscode.Webview, ThemeSurface>();
const changed = new vscode.EventEmitter<string>();

/** Fires with the new theme id after a change has been stored and broadcast. */
export const onDidChangeTheme = changed.event;

/** Why a theme can't be used yet. */
export interface ThemeLockInfo {
  /** "Reach Gold" / "Complete Weekly Warrior"; absent when points are the only way. */
  hint?: string;
  /** Points to unlock it now; absent when it can only be earned. */
  cost?: number;
  balance: number;
}

/**
 * Tells the picker which themes are still locked, buys them with points, and
 * grants one for free. Installed at activation. Without it every theme is open.
 */
export interface ThemeAccess {
  lock(themeId: string): ThemeLockInfo | undefined;
  unlock(themeId: string): Promise<boolean>;
  grant?(themeId: string): Promise<void>;
}

/** "150 pts" / "Reach Gold or 500 pts". */
export function lockText(lock: ThemeLockInfo): string {
  const price = lock.cost !== undefined ? `${lock.cost.toLocaleString("en-US")} pts` : "";
  return lock.hint ? (price ? `${lock.hint} or ${price}` : lock.hint) : price || "Locked";
}

let access: ThemeAccess | undefined;

export function setThemeAccess(provider: ThemeAccess | undefined): void {
  access = provider;
}

function lockOf(id: string): ThemeLockInfo | undefined {
  try {
    return access?.lock(id);
  } catch {
    return undefined;
  }
}

export function initThemes(ctx: vscode.ExtensionContext): void {
  context = ctx;
  current = validThemeId(ctx.globalState.get(THEME_KEY));
  if (access && !ctx.globalState.get(KEPT_KEY)) {
    // Themes became paid in this version. Whoever already chose one keeps it free, once.
    void ctx.globalState.update(KEPT_KEY, true);
    if (current !== SYSTEM_THEME_ID && lockOf(current) && access.grant) {
      void access.grant(current).catch(error => console.error("DevSnip Pro: could not keep the current theme.", error));
      ctx.subscriptions.push(changed);
      return;
    }
  }
  // A theme stored before progress was reset is locked again.
  if (lockOf(current)) current = SYSTEM_THEME_ID;
  ctx.subscriptions.push(changed);
}

export function currentThemeId(): string {
  return current;
}

/** Sets a webview's HTML with the current theme applied, and keeps it in sync with later changes. */
export function setWebviewHtml(webview: vscode.Webview, html: string, surface: ThemeSurface = "panel"): void {
  webviews.set(webview, surface);
  webview.html = injectTheme(html, current, surface);
}

function broadcast(): void {
  const previewing = Boolean(lockedPreview);
  for (const [webview, surface] of [...webviews]) {
    try {
      // `lockedPreview` lets a page say the theme is only being tried; the theme runtime ignores it.
      void Promise.resolve(webview.postMessage({ ...themeMessage(current, surface), lockedPreview: previewing })).then(
        delivered => { if (delivered === false) webviews.delete(webview); },
        () => webviews.delete(webview)
      );
    } catch {
      // Disposed since it was registered.
      webviews.delete(webview);
    }
  }
}

/**
 * `preview` is used while browsing the command-palette picker: it applies the
 * theme without storing it or counting as a choice, so a locked theme can be
 * looked at but never kept.
 */
export async function setTheme(id: string, options: { preview?: boolean } = {}): Promise<void> {
  const next = validThemeId(id);
  if (next !== id) throw new Error(`Unknown theme "${id}".`);
  if (!options.preview && lockOf(next)) throw new Error(`The ${findTheme(next)?.label ?? next} theme is locked.`);
  // Choosing a theme for real ends a locked-theme preview: it was unlocked, or another theme was picked.
  if (!options.preview && lockedPreview) stopPreview(lockedPreview.themeId === next ? "unlocked" : "replaced");
  current = next;
  if (!options.preview) await context?.globalState.update(THEME_KEY, next);
  broadcast();
  changed.fire(next);
  if (!options.preview) void noteThemeChosen();
}

export interface ThemeChoice {
  id: string;
  label: string;
  /** Shorter label for the picker grid. */
  shortLabel?: string;
  description: string;
  kind: "system" | "dark" | "light" | "hc";
  swatches: string[];
  /** Colours for the picker's miniature preview; absent for System Default. */
  preview?: { bg: string; sidebar: string; surface: string; fg: string; muted: string; accent: string; accent2: string };
  /** A reward theme not unlocked yet, and how to unlock it. */
  locked?: boolean;
  lockHint?: string;
}

/** Theme choices for the sidebar picker, System Default first. */
export function themeChoices(): ThemeChoice[] {
  return [
    { id: SYSTEM_THEME_ID, label: "System Default", shortLabel: "System", description: "Follows your VS Code color theme, light or dark.", kind: "system", swatches: [] },
    ...THEMES.map(theme => {
      const p = theme.palette;
      const lock = lockOf(theme.id);
      return {
        ...(lock ? { locked: true, lockHint: lockText(lock) } : {}),
        id: theme.id,
        label: theme.label,
        description: theme.description,
        kind: p.kind,
        swatches: swatches(theme),
        preview: { bg: p.bg, sidebar: p.sidebar, surface: p.surface2, fg: p.fg, muted: p.muted, accent: p.accent, accent2: p.ansi.magenta }
      };
    })
  ];
}

/**
 * Applies a theme the user picked. A locked reward theme instead explains how
 * to earn it and offers to unlock it with points. Returns true when applied.
 */
export async function chooseThemeOrUnlock(id: string): Promise<boolean> {
  const lock = lockOf(id);
  if (!lock) {
    await setTheme(id);
    return true;
  }
  const label = findTheme(id)?.label ?? id;
  const cost = lock.cost?.toLocaleString("en-US");
  const balance = lock.balance.toLocaleString("en-US");
  const buy = lock.cost !== undefined && lock.balance >= lock.cost ? `Unlock for ${cost} pts` : undefined;
  const message = lock.hint
    ? `🔒 ${label} is locked. ${lock.hint} to unlock it${cost ? `, or unlock it now for ${cost} points (you have ${balance})` : ""}.`
    : `🔒 ${label} unlocks with points: ${cost} points (you have ${balance}).`;
  const previewLabel = `Preview ${LOCKED_PREVIEW_SECONDS}s`;
  const choice = await vscode.window.showInformationMessage(message, ...(buy ? [buy, previewLabel] : [previewLabel, "How to earn"]));
  if (buy && choice === buy && access && await access.unlock(id)) {
    await setTheme(id);
    return true;
  }
  if (choice === previewLabel) await previewLockedTheme(id);
  if (choice === "How to earn") await vscode.commands.executeCommand(`${COMMAND_PREFIX}milestoneTracker`);
  return false;
}

/* ------------------------------------------------------------------ locked-theme preview */

/** How long a locked theme can be tried before DevSnip Pro switches back. */
export const LOCKED_PREVIEW_SECONDS = 30;
const PREVIEW_MENU_COMMAND = `${COMMAND_PREFIX}themePreviewMenu`;

type PreviewOutcome = "unlocked" | "ended" | "expired" | "replaced";

interface LockedPreview {
  themeId: string;
  /** The stored theme to go back to. */
  saved: string;
  endsAt: number;
  timer: ReturnType<typeof setTimeout>;
  ticker: ReturnType<typeof setInterval>;
  status?: vscode.StatusBarItem;
}

let lockedPreview: LockedPreview | undefined;
const previewChanged = new vscode.EventEmitter<string | null>();

/** Fires with the theme being tried, or null when a preview ends. */
export const onDidChangeLockedPreview = previewChanged.event;

/** The locked theme being tried right now, if any. */
export function lockedPreviewTheme(): string | null {
  return lockedPreview?.themeId ?? null;
}

/** The theme the user actually chose, ignoring any preview. */
function savedThemeId(): string {
  const stored = validThemeId(context?.globalState.get(THEME_KEY));
  return lockOf(stored) ? SYSTEM_THEME_ID : stored;
}

function secondsLeft(session: LockedPreview): number {
  return Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
}

function updatePreviewStatus(session: LockedPreview): void {
  if (!session.status) return;
  const label = findTheme(session.themeId)?.label ?? session.themeId;
  session.status.text = `$(eye) ${label} preview · ${secondsLeft(session)}s`;
}

/** Ends the session without touching the theme. */
function stopPreview(outcome: PreviewOutcome): LockedPreview | undefined {
  const session = lockedPreview;
  if (!session) return undefined;
  lockedPreview = undefined;
  clearTimeout(session.timer);
  clearInterval(session.ticker);
  session.status?.dispose();
  track("theme_preview", { theme: session.themeId, outcome });
  previewChanged.fire(null);
  return session;
}

/** Offers to unlock the theme being previewed with points. Returns true when it was unlocked and kept. */
async function unlockPreviewed(themeId: string): Promise<boolean> {
  if (!access || !(await access.unlock(themeId))) return false;
  await setTheme(themeId);
  return true;
}

function unlockButton(themeId: string): string | undefined {
  const lock = lockOf(themeId);
  return lock?.cost !== undefined && lock.balance >= lock.cost ? `Unlock for ${lock.cost.toLocaleString("en-US")} pts` : undefined;
}

/**
 * Tries a locked theme on every DevSnip Pro panel for a short while, then
 * switches back to the theme the user chose. Nothing is stored, so a reload
 * also ends it. An unlocked theme is simply applied.
 */
export async function previewLockedTheme(id: string, seconds: number = LOCKED_PREVIEW_SECONDS): Promise<boolean> {
  if (!findTheme(id)) return false;
  if (!lockOf(id)) {
    await setTheme(id);
    return true;
  }
  // Starting another preview keeps the original theme to return to.
  const saved = lockedPreview?.saved ?? savedThemeId();
  stopPreview("replaced");

  const session: LockedPreview = {
    themeId: id,
    saved,
    endsAt: Date.now() + seconds * 1000,
    timer: setTimeout(() => {
      endLockedPreview("expired").catch(error => console.error("DevSnip Pro: could not end the theme preview.", error));
    }, seconds * 1000),
    ticker: setInterval(() => updatePreviewStatus(session), 1000)
  };
  // Never keep VS Code (or a test run) alive just for a preview.
  (session.timer as { unref?: () => void }).unref?.();
  (session.ticker as { unref?: () => void }).unref?.();
  try {
    session.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    session.status.tooltip = "Previewing a locked DevSnip Pro theme. Click to unlock it or end the preview.";
    session.status.command = PREVIEW_MENU_COMMAND;
    session.status.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    session.status.show();
  } catch {
    session.status = undefined;
  }
  lockedPreview = session;
  updatePreviewStatus(session);
  await setTheme(id, { preview: true });
  track("theme_preview", { theme: id, outcome: "started" });
  previewChanged.fire(id);

  const label = findTheme(id)?.label ?? id;
  const lock = lockOf(id);
  const buy = unlockButton(id);
  const price = lock?.cost !== undefined ? ` It costs ${lock.cost.toLocaleString("en-US")} points; you have ${lock.balance.toLocaleString("en-US")}.` : "";
  void vscode.window.showInformationMessage(
    `👁 Previewing ${label} on every DevSnip Pro panel for ${seconds} seconds.${price}`,
    ...(buy ? [buy, "End preview"] : ["End preview"])
  ).then(async choice => {
    if (lockedPreview !== session) return;
    if (buy && choice === buy) await unlockPreviewed(id);
    else if (choice === "End preview") await endLockedPreview("ended");
  }).then(undefined, error => console.error("DevSnip Pro: theme preview action failed.", error));
  return true;
}

/** Ends a locked-theme preview and switches back to the theme the user chose. */
export async function endLockedPreview(outcome: "ended" | "expired" = "ended"): Promise<void> {
  const session = stopPreview(outcome);
  if (!session) return;
  await setTheme(session.saved, { preview: true });
  if (outcome !== "expired") return;
  const label = findTheme(session.themeId)?.label ?? session.themeId;
  const buy = unlockButton(session.themeId);
  const choice = await vscode.window.showInformationMessage(
    `${label} preview ended.${buy ? " Unlock it to keep it." : " Earn points by using DevSnip Pro tools to unlock it."}`,
    ...(buy ? [buy] : ["How to earn"])
  );
  if (buy && choice === buy) await unlockPreviewed(session.themeId);
  else if (choice === "How to earn") await vscode.commands.executeCommand(`${COMMAND_PREFIX}milestoneTracker`);
}

/** The status bar item's menu while a preview runs. */
async function showPreviewMenu(): Promise<void> {
  const session = lockedPreview;
  if (!session) return;
  const label = findTheme(session.themeId)?.label ?? session.themeId;
  const lock = lockOf(session.themeId);
  const buy = unlockButton(session.themeId);
  const items: Array<vscode.QuickPickItem & { action: "unlock" | "end" | "earn" | "keep" }> = [];
  if (buy) items.push({ label: `$(unlock) ${buy}`, description: `Keep ${label} on every panel`, action: "unlock" });
  else if (lock?.cost !== undefined) items.push({ label: `$(star) How to earn points`, description: `${label} costs ${lock.cost.toLocaleString("en-US")} pts; you have ${lock.balance.toLocaleString("en-US")}`, action: "earn" });
  items.push({ label: "$(close) End preview", description: "Switch back now", action: "end" });
  items.push({ label: "$(eye) Keep previewing", description: `${secondsLeft(session)} seconds left`, action: "keep" });
  const picked = await vscode.window.showQuickPick(items, { title: `${label} preview` });
  if (!picked || lockedPreview !== session) return;
  if (picked.action === "unlock") await unlockPreviewed(session.themeId);
  else if (picked.action === "end") await endLockedPreview("ended");
  else if (picked.action === "earn") await vscode.commands.executeCommand(`${COMMAND_PREFIX}milestoneTracker`);
}

export function registerThemeCommand(ctx: vscode.ExtensionContext): void {
  // Internal: opened from the preview's status bar item, so not in the Command Palette and earns no points.
  ctx.subscriptions.push(vscode.commands.registerCommand(PREVIEW_MENU_COMMAND, showPreviewMenu));
  ctx.subscriptions.push({ dispose: () => { stopPreview("ended"); } });
  ctx.subscriptions.push(registerTrackedCommand(CHOOSE_THEME_COMMAND, async () => {
    // The picker previews as you browse; start it from the theme you actually chose.
    if (lockedPreview) await endLockedPreview("ended");
    const before = current;
    const items = themeChoices().map(choice => ({
      label: `${choice.id === current ? "$(check) " : choice.locked ? "$(lock) " : "$(blank) "}${choice.label}`,
      description: choice.locked ? `Locked · ${choice.lockHint}` : choice.id === SYSTEM_THEME_ID ? "VS Code theme" : findTheme(choice.id)?.palette.kind === "light" ? "Light" : findTheme(choice.id)?.palette.kind === "hc" ? "High contrast" : "Dark",
      detail: choice.description,
      id: choice.id,
      locked: Boolean(choice.locked)
    }));
    const picker = vscode.window.createQuickPick<(typeof items)[number]>();
    picker.title = "DevSnip Pro Theme";
    picker.placeholder = "Choose how DevSnip Pro looks. Use the arrow keys to preview, locked themes too.";
    picker.items = items;
    picker.activeItems = items.filter(item => item.id === current);
    let accepted = false;
    // Previewing while browsing makes the choice visual, as VS Code's own theme picker does.
    picker.onDidChangeActive(active => { if (active[0] && active[0].id !== current) void setTheme(active[0].id, { preview: true }); });
    let lockedPick: string | undefined;
    picker.onDidAccept(() => {
      const picked = picker.activeItems[0];
      // A locked reward theme was only previewed: revert, then explain how to unlock it.
      if (picked?.locked) lockedPick = picked.id;
      else if (picked) {
        // Previews are not stored, so the choice is saved here.
        accepted = true;
        void setTheme(picked.id);
      }
      picker.hide();
    });
    picker.onDidHide(() => {
      const revert = !accepted && current !== before ? setTheme(before, { preview: true }) : Promise.resolve();
      picker.dispose();
      if (lockedPick) {
        const id = lockedPick;
        void revert
          .then(() => chooseThemeOrUnlock(id))
          .then(applied => { if (applied) void noteThemeChosen(); })
          .catch(error => console.error("DevSnip Pro: could not apply that theme.", error));
      }
    });
    picker.show();
  }));
}
