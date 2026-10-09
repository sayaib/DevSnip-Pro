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
exports.registerThemeCommand = exports.endLockedPreview = exports.previewLockedTheme = exports.lockedPreviewTheme = exports.onDidChangeLockedPreview = exports.LOCKED_PREVIEW_SECONDS = exports.chooseThemeOrUnlock = exports.themeChoices = exports.setTheme = exports.setWebviewHtml = exports.trackedWebviewCount = exports.currentThemeId = exports.initThemes = exports.setThemeAccess = exports.lockText = exports.onDidChangeTheme = exports.CHOOSE_THEME_COMMAND = void 0;
const vscode = __importStar(require("vscode"));
const inject_1 = require("./inject");
const themes_1 = require("./themes");
const command_registry_1 = require("../utils/command-registry");
const activation_1 = require("../onboarding/activation");
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
exports.CHOOSE_THEME_COMMAND = `${command_registry_1.COMMAND_PREFIX}chooseTheme`;
let context;
let current = themes_1.SYSTEM_THEME_ID;
const webviews = new Map();
const changed = new vscode.EventEmitter();
/** Fires with the new theme id after a change has been stored and broadcast. */
exports.onDidChangeTheme = changed.event;
/** "150 pts" / "Reach Gold or 500 pts". */
function lockText(lock) {
    const price = lock.cost !== undefined ? `${lock.cost.toLocaleString("en-US")} pts` : "";
    return lock.hint ? (price ? `${lock.hint} or ${price}` : lock.hint) : price || "Locked";
}
exports.lockText = lockText;
let access;
function setThemeAccess(provider) {
    access = provider;
}
exports.setThemeAccess = setThemeAccess;
function lockOf(id) {
    try {
        return access?.lock(id);
    }
    catch {
        return undefined;
    }
}
function initThemes(ctx) {
    context = ctx;
    current = (0, themes_1.validThemeId)(ctx.globalState.get(THEME_KEY));
    if (access && !ctx.globalState.get(KEPT_KEY)) {
        // Themes became paid in this version. Whoever already chose one keeps it free, once.
        void ctx.globalState.update(KEPT_KEY, true);
        if (current !== themes_1.SYSTEM_THEME_ID && lockOf(current) && access.grant) {
            void access.grant(current).catch(error => console.error("DevSnip Pro: could not keep the current theme.", error));
            ctx.subscriptions.push(changed);
            return;
        }
    }
    // A theme stored before progress was reset is locked again.
    if (lockOf(current))
        current = themes_1.SYSTEM_THEME_ID;
    ctx.subscriptions.push(changed);
}
exports.initThemes = initThemes;
function currentThemeId() {
    return current;
}
exports.currentThemeId = currentThemeId;
/**
 * Forgets webviews whose panel has closed. VS Code throws when a disposed
 * webview's properties are read; without this, every panel ever opened (and
 * its whole page HTML) stayed in memory until the next theme change.
 */
function pruneDisposedWebviews() {
    for (const webview of [...webviews.keys()]) {
        try {
            void webview.options;
        }
        catch {
            webviews.delete(webview);
        }
    }
}
/** Number of webviews kept in sync with the theme (open pages only). Exposed for tests. */
function trackedWebviewCount() {
    return webviews.size;
}
exports.trackedWebviewCount = trackedWebviewCount;
/** Sets a webview's HTML with the current theme applied, and keeps it in sync with later changes. */
function setWebviewHtml(webview, html, surface = "panel") {
    pruneDisposedWebviews();
    webviews.set(webview, surface);
    webview.html = (0, inject_1.injectTheme)(html, current, surface);
}
exports.setWebviewHtml = setWebviewHtml;
function broadcast() {
    const previewing = Boolean(lockedPreview);
    for (const [webview, surface] of [...webviews]) {
        try {
            // `lockedPreview` lets a page say the theme is only being tried; the theme runtime ignores it.
            void Promise.resolve(webview.postMessage({ ...(0, inject_1.themeMessage)(current, surface), lockedPreview: previewing })).then(delivered => { if (delivered === false)
                webviews.delete(webview); }, () => webviews.delete(webview));
        }
        catch {
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
async function setTheme(id, options = {}) {
    const next = (0, themes_1.validThemeId)(id);
    if (next !== id)
        throw new Error(`Unknown theme "${id}".`);
    if (!options.preview && lockOf(next))
        throw new Error(`The ${(0, themes_1.findTheme)(next)?.label ?? next} theme is locked.`);
    // Choosing a theme for real ends a locked-theme preview: it was unlocked, or another theme was picked.
    if (!options.preview && lockedPreview)
        stopPreview(lockedPreview.themeId === next ? "unlocked" : "replaced");
    current = next;
    if (!options.preview)
        await context?.globalState.update(THEME_KEY, next);
    broadcast();
    changed.fire(next);
    if (!options.preview)
        void (0, activation_1.noteThemeChosen)();
}
exports.setTheme = setTheme;
/** Theme choices for the sidebar picker, System Default first. */
function themeChoices() {
    return [
        { id: themes_1.SYSTEM_THEME_ID, label: "System Default", shortLabel: "System", description: "Follows your VS Code color theme, light or dark.", kind: "system", swatches: [] },
        ...themes_1.THEMES.map(theme => {
            const p = theme.palette;
            const lock = lockOf(theme.id);
            return {
                ...(lock ? { locked: true, lockHint: lockText(lock) } : {}),
                id: theme.id,
                label: theme.label,
                description: theme.description,
                kind: p.kind,
                swatches: (0, themes_1.swatches)(theme),
                preview: { bg: p.bg, sidebar: p.sidebar, surface: p.surface2, fg: p.fg, muted: p.muted, accent: p.accent, accent2: p.ansi.magenta }
            };
        })
    ];
}
exports.themeChoices = themeChoices;
/**
 * Applies a theme the user picked. A locked reward theme instead explains how
 * to earn it and offers to unlock it with points. Returns true when applied.
 */
async function chooseThemeOrUnlock(id) {
    const lock = lockOf(id);
    if (!lock) {
        await setTheme(id);
        return true;
    }
    const label = (0, themes_1.findTheme)(id)?.label ?? id;
    const cost = lock.cost?.toLocaleString("en-US");
    const balance = lock.balance.toLocaleString("en-US");
    const buy = lock.cost !== undefined && lock.balance >= lock.cost ? `Unlock for ${cost} pts` : undefined;
    const message = lock.hint
        ? `🔒 ${label} is locked. ${lock.hint} to unlock it${cost ? `, or unlock it now for ${cost} points (you have ${balance})` : ""}.`
        : `🔒 ${label} unlocks with points: ${cost} points (you have ${balance}).`;
    const previewLabel = `Preview ${exports.LOCKED_PREVIEW_SECONDS}s`;
    const choice = await vscode.window.showInformationMessage(message, ...(buy ? [buy, previewLabel] : [previewLabel, "How to earn"]));
    if (buy && choice === buy && access && await access.unlock(id)) {
        await setTheme(id);
        return true;
    }
    if (choice === previewLabel)
        await previewLockedTheme(id);
    if (choice === "How to earn")
        await vscode.commands.executeCommand(`${command_registry_1.COMMAND_PREFIX}milestoneTracker`);
    return false;
}
exports.chooseThemeOrUnlock = chooseThemeOrUnlock;
/* ------------------------------------------------------------------ locked-theme preview */
/** How long a locked theme can be tried before DevSnip Pro switches back. */
exports.LOCKED_PREVIEW_SECONDS = 30;
const PREVIEW_MENU_COMMAND = `${command_registry_1.COMMAND_PREFIX}themePreviewMenu`;
let lockedPreview;
const previewChanged = new vscode.EventEmitter();
/** Fires with the theme being tried, or null when a preview ends. */
exports.onDidChangeLockedPreview = previewChanged.event;
/** The locked theme being tried right now, if any. */
function lockedPreviewTheme() {
    return lockedPreview?.themeId ?? null;
}
exports.lockedPreviewTheme = lockedPreviewTheme;
/** The theme the user actually chose, ignoring any preview. */
function savedThemeId() {
    const stored = (0, themes_1.validThemeId)(context?.globalState.get(THEME_KEY));
    return lockOf(stored) ? themes_1.SYSTEM_THEME_ID : stored;
}
function secondsLeft(session) {
    return Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
}
function updatePreviewStatus(session) {
    if (!session.status)
        return;
    const label = (0, themes_1.findTheme)(session.themeId)?.label ?? session.themeId;
    session.status.text = `$(eye) ${label} preview · ${secondsLeft(session)}s`;
}
/** Ends the session without touching the theme. */
function stopPreview(_outcome) {
    const session = lockedPreview;
    if (!session)
        return undefined;
    lockedPreview = undefined;
    clearTimeout(session.timer);
    clearInterval(session.ticker);
    session.status?.dispose();
    previewChanged.fire(null);
    return session;
}
/** Offers to unlock the theme being previewed with points. Returns true when it was unlocked and kept. */
async function unlockPreviewed(themeId) {
    if (!access || !(await access.unlock(themeId)))
        return false;
    await setTheme(themeId);
    return true;
}
function unlockButton(themeId) {
    const lock = lockOf(themeId);
    return lock?.cost !== undefined && lock.balance >= lock.cost ? `Unlock for ${lock.cost.toLocaleString("en-US")} pts` : undefined;
}
/**
 * Tries a locked theme on every DevSnip Pro panel for a short while, then
 * switches back to the theme the user chose. Nothing is stored, so a reload
 * also ends it. An unlocked theme is simply applied.
 */
async function previewLockedTheme(id, seconds = exports.LOCKED_PREVIEW_SECONDS) {
    if (!(0, themes_1.findTheme)(id))
        return false;
    if (!lockOf(id)) {
        await setTheme(id);
        return true;
    }
    // Starting another preview keeps the original theme to return to.
    const saved = lockedPreview?.saved ?? savedThemeId();
    stopPreview("replaced");
    const session = {
        themeId: id,
        saved,
        endsAt: Date.now() + seconds * 1000,
        timer: setTimeout(() => {
            endLockedPreview("expired").catch(error => console.error("DevSnip Pro: could not end the theme preview.", error));
        }, seconds * 1000),
        ticker: setInterval(() => updatePreviewStatus(session), 1000)
    };
    // Never keep VS Code (or a test run) alive just for a preview.
    session.timer.unref?.();
    session.ticker.unref?.();
    try {
        session.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
        session.status.tooltip = "Previewing a locked DevSnip Pro theme. Click to unlock it or end the preview.";
        session.status.command = PREVIEW_MENU_COMMAND;
        session.status.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        session.status.show();
    }
    catch {
        session.status = undefined;
    }
    lockedPreview = session;
    updatePreviewStatus(session);
    await setTheme(id, { preview: true });
    previewChanged.fire(id);
    const label = (0, themes_1.findTheme)(id)?.label ?? id;
    const lock = lockOf(id);
    const buy = unlockButton(id);
    const price = lock?.cost !== undefined ? ` It costs ${lock.cost.toLocaleString("en-US")} points; you have ${lock.balance.toLocaleString("en-US")}.` : "";
    void vscode.window.showInformationMessage(`👁 Previewing ${label} on every DevSnip Pro panel for ${seconds} seconds.${price}`, ...(buy ? [buy, "End preview"] : ["End preview"])).then(async (choice) => {
        if (lockedPreview !== session)
            return;
        if (buy && choice === buy)
            await unlockPreviewed(id);
        else if (choice === "End preview")
            await endLockedPreview("ended");
    }).then(undefined, error => console.error("DevSnip Pro: theme preview action failed.", error));
    return true;
}
exports.previewLockedTheme = previewLockedTheme;
/** Ends a locked-theme preview and switches back to the theme the user chose. */
async function endLockedPreview(outcome = "ended") {
    const session = stopPreview(outcome);
    if (!session)
        return;
    await setTheme(session.saved, { preview: true });
    if (outcome !== "expired")
        return;
    const label = (0, themes_1.findTheme)(session.themeId)?.label ?? session.themeId;
    const buy = unlockButton(session.themeId);
    const choice = await vscode.window.showInformationMessage(`${label} preview ended.${buy ? " Unlock it to keep it." : " Earn points by using DevSnip Pro tools to unlock it."}`, ...(buy ? [buy] : ["How to earn"]));
    if (buy && choice === buy)
        await unlockPreviewed(session.themeId);
    else if (choice === "How to earn")
        await vscode.commands.executeCommand(`${command_registry_1.COMMAND_PREFIX}milestoneTracker`);
}
exports.endLockedPreview = endLockedPreview;
/** The status bar item's menu while a preview runs. */
async function showPreviewMenu() {
    const session = lockedPreview;
    if (!session)
        return;
    const label = (0, themes_1.findTheme)(session.themeId)?.label ?? session.themeId;
    const lock = lockOf(session.themeId);
    const buy = unlockButton(session.themeId);
    const items = [];
    if (buy)
        items.push({ label: `$(unlock) ${buy}`, description: `Keep ${label} on every panel`, action: "unlock" });
    else if (lock?.cost !== undefined)
        items.push({ label: `$(star) How to earn points`, description: `${label} costs ${lock.cost.toLocaleString("en-US")} pts; you have ${lock.balance.toLocaleString("en-US")}`, action: "earn" });
    items.push({ label: "$(close) End preview", description: "Switch back now", action: "end" });
    items.push({ label: "$(eye) Keep previewing", description: `${secondsLeft(session)} seconds left`, action: "keep" });
    const picked = await vscode.window.showQuickPick(items, { title: `${label} preview` });
    if (!picked || lockedPreview !== session)
        return;
    if (picked.action === "unlock")
        await unlockPreviewed(session.themeId);
    else if (picked.action === "end")
        await endLockedPreview("ended");
    else if (picked.action === "earn")
        await vscode.commands.executeCommand(`${command_registry_1.COMMAND_PREFIX}milestoneTracker`);
}
function registerThemeCommand(ctx) {
    // Internal: opened from the preview's status bar item, so not in the Command Palette and earns no points.
    ctx.subscriptions.push(vscode.commands.registerCommand(PREVIEW_MENU_COMMAND, showPreviewMenu));
    ctx.subscriptions.push({ dispose: () => { stopPreview("ended"); } });
    ctx.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.CHOOSE_THEME_COMMAND, async () => {
        // The picker previews as you browse; start it from the theme you actually chose.
        if (lockedPreview)
            await endLockedPreview("ended");
        const before = current;
        const items = themeChoices().map(choice => ({
            label: `${choice.id === current ? "$(check) " : choice.locked ? "$(lock) " : "$(blank) "}${choice.label}`,
            description: choice.locked ? `Locked · ${choice.lockHint}` : choice.id === themes_1.SYSTEM_THEME_ID ? "VS Code theme" : (0, themes_1.findTheme)(choice.id)?.palette.kind === "light" ? "Light" : (0, themes_1.findTheme)(choice.id)?.palette.kind === "hc" ? "High contrast" : "Dark",
            detail: choice.description,
            id: choice.id,
            locked: Boolean(choice.locked)
        }));
        const picker = vscode.window.createQuickPick();
        picker.title = "DevSnip Pro Theme";
        picker.placeholder = "Choose how DevSnip Pro looks. Use the arrow keys to preview, locked themes too.";
        picker.items = items;
        picker.activeItems = items.filter(item => item.id === current);
        let accepted = false;
        // Previewing while browsing makes the choice visual, as VS Code's own theme picker does.
        picker.onDidChangeActive(active => { if (active[0] && active[0].id !== current)
            void setTheme(active[0].id, { preview: true }); });
        let lockedPick;
        picker.onDidAccept(() => {
            const picked = picker.activeItems[0];
            // A locked reward theme was only previewed: revert, then explain how to unlock it.
            if (picked?.locked)
                lockedPick = picked.id;
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
                    .then(applied => { if (applied)
                    void (0, activation_1.noteThemeChosen)(); })
                    .catch(error => console.error("DevSnip Pro: could not apply that theme.", error));
            }
        });
        picker.show();
    }));
}
exports.registerThemeCommand = registerThemeCommand;
//# sourceMappingURL=service.js.map