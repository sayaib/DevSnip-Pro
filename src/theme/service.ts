import * as vscode from "vscode";
import { injectTheme, themeMessage, ThemeSurface } from "./inject";
import { findTheme, swatches, SYSTEM_THEME_ID, THEMES, validThemeId } from "./themes";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import { noteThemeChosen } from "../onboarding/activation";

/**
 * The selected DevSnip Pro appearance theme.
 *
 * Every webview sets its HTML through `setWebviewHtml`, which applies the
 * current theme and remembers the webview. Choosing a theme stores it in
 * globalState (local to this machine, so it survives restarts) and pushes it
 * to every open webview at once.
 */

const THEME_KEY = "devsnip.appearance.theme";
export const CHOOSE_THEME_COMMAND = `${COMMAND_PREFIX}chooseTheme`;

let context: vscode.ExtensionContext | undefined;
let current = SYSTEM_THEME_ID;
const webviews = new Map<vscode.Webview, ThemeSurface>();
const changed = new vscode.EventEmitter<string>();

/** Fires with the new theme id after a change has been stored and broadcast. */
export const onDidChangeTheme = changed.event;

export function initThemes(ctx: vscode.ExtensionContext): void {
  context = ctx;
  current = validThemeId(ctx.globalState.get(THEME_KEY));
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
  for (const [webview, surface] of [...webviews]) {
    try {
      void Promise.resolve(webview.postMessage(themeMessage(current, surface))).then(
        delivered => { if (delivered === false) webviews.delete(webview); },
        () => webviews.delete(webview)
      );
    } catch {
      // Disposed since it was registered.
      webviews.delete(webview);
    }
  }
}

/** `preview` is used while browsing the command-palette picker: it applies the theme without counting as a choice. */
export async function setTheme(id: string, options: { preview?: boolean } = {}): Promise<void> {
  const next = validThemeId(id);
  if (next !== id) throw new Error(`Unknown theme "${id}".`);
  current = next;
  await context?.globalState.update(THEME_KEY, next);
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
}

/** Theme choices for the sidebar picker, System Default first. */
export function themeChoices(): ThemeChoice[] {
  return [
    { id: SYSTEM_THEME_ID, label: "System Default", shortLabel: "System", description: "Follows your VS Code color theme, light or dark.", kind: "system", swatches: [] },
    ...THEMES.map(theme => {
      const p = theme.palette;
      return {
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

export function registerThemeCommand(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(registerTrackedCommand(CHOOSE_THEME_COMMAND, async () => {
    const before = current;
    const items = themeChoices().map(choice => ({
      label: `${choice.id === current ? "$(check) " : "$(blank) "}${choice.label}`,
      description: choice.id === SYSTEM_THEME_ID ? "VS Code theme" : findTheme(choice.id)?.palette.kind === "light" ? "Light" : findTheme(choice.id)?.palette.kind === "hc" ? "High contrast" : "Dark",
      detail: choice.description,
      id: choice.id
    }));
    const picker = vscode.window.createQuickPick<(typeof items)[number]>();
    picker.title = "DevSnip Pro Theme";
    picker.placeholder = "Choose how DevSnip Pro looks. Use the arrow keys to preview.";
    picker.items = items;
    picker.activeItems = items.filter(item => item.id === current);
    let accepted = false;
    // Previewing while browsing makes the choice visual, as VS Code's own theme picker does.
    picker.onDidChangeActive(active => { if (active[0] && active[0].id !== current) void setTheme(active[0].id, { preview: true }); });
    picker.onDidAccept(() => { accepted = true; void noteThemeChosen(); picker.hide(); });
    picker.onDidHide(() => {
      if (!accepted && current !== before) void setTheme(before, { preview: true });
      picker.dispose();
    });
    picker.show();
  }));
}
