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
exports.registerThemeCommand = exports.themeChoices = exports.setTheme = exports.setWebviewHtml = exports.currentThemeId = exports.initThemes = exports.onDidChangeTheme = exports.CHOOSE_THEME_COMMAND = void 0;
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
exports.CHOOSE_THEME_COMMAND = `${command_registry_1.COMMAND_PREFIX}chooseTheme`;
let context;
let current = themes_1.SYSTEM_THEME_ID;
const webviews = new Map();
const changed = new vscode.EventEmitter();
/** Fires with the new theme id after a change has been stored and broadcast. */
exports.onDidChangeTheme = changed.event;
function initThemes(ctx) {
    context = ctx;
    current = (0, themes_1.validThemeId)(ctx.globalState.get(THEME_KEY));
    ctx.subscriptions.push(changed);
}
exports.initThemes = initThemes;
function currentThemeId() {
    return current;
}
exports.currentThemeId = currentThemeId;
/** Sets a webview's HTML with the current theme applied, and keeps it in sync with later changes. */
function setWebviewHtml(webview, html, surface = "panel") {
    webviews.set(webview, surface);
    webview.html = (0, inject_1.injectTheme)(html, current, surface);
}
exports.setWebviewHtml = setWebviewHtml;
function broadcast() {
    for (const [webview, surface] of [...webviews]) {
        try {
            void Promise.resolve(webview.postMessage((0, inject_1.themeMessage)(current, surface))).then(delivered => { if (delivered === false)
                webviews.delete(webview); }, () => webviews.delete(webview));
        }
        catch {
            // Disposed since it was registered.
            webviews.delete(webview);
        }
    }
}
/** `preview` is used while browsing the command-palette picker: it applies the theme without counting as a choice. */
async function setTheme(id, options = {}) {
    const next = (0, themes_1.validThemeId)(id);
    if (next !== id)
        throw new Error(`Unknown theme "${id}".`);
    current = next;
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
            return {
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
function registerThemeCommand(ctx) {
    ctx.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.CHOOSE_THEME_COMMAND, async () => {
        const before = current;
        const items = themeChoices().map(choice => ({
            label: `${choice.id === current ? "$(check) " : "$(blank) "}${choice.label}`,
            description: choice.id === themes_1.SYSTEM_THEME_ID ? "VS Code theme" : (0, themes_1.findTheme)(choice.id)?.palette.kind === "light" ? "Light" : (0, themes_1.findTheme)(choice.id)?.palette.kind === "hc" ? "High contrast" : "Dark",
            detail: choice.description,
            id: choice.id
        }));
        const picker = vscode.window.createQuickPick();
        picker.title = "DevSnip Pro Theme";
        picker.placeholder = "Choose how DevSnip Pro looks. Use the arrow keys to preview.";
        picker.items = items;
        picker.activeItems = items.filter(item => item.id === current);
        let accepted = false;
        // Previewing while browsing makes the choice visual, as VS Code's own theme picker does.
        picker.onDidChangeActive(active => { if (active[0] && active[0].id !== current)
            void setTheme(active[0].id, { preview: true }); });
        picker.onDidAccept(() => { accepted = true; void (0, activation_1.noteThemeChosen)(); picker.hide(); });
        picker.onDidHide(() => {
            if (!accepted && current !== before)
                void setTheme(before, { preview: true });
            picker.dispose();
        });
        picker.show();
    }));
}
exports.registerThemeCommand = registerThemeCommand;
//# sourceMappingURL=service.js.map