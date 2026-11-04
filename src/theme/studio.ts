import * as vscode from "vscode";
import { openToolPanel, safePostMessage } from "../utils/webview-ui";
import {
  chooseThemeOrUnlock, currentCustomization, currentThemeId, currentThemeSync, effectiveThemeId, LOCKED_PREVIEW_SECONDS,
  lockedPreviewTheme, onDidChangeAppearance, onDidChangeLockedPreview, onDidChangeTheme, setCustomization, setTheme,
  setThemeSync, setWebviewHtml, themeChoices, vscodeThemeKind
} from "./service";
import { renderThemeStudio, StudioState } from "./studio-page";
import { SYSTEM_THEME_ID } from "./themes";

const VIEW_TYPE = "devsnip.themeStudio";

function studioState(): StudioState {
  return {
    current: currentThemeId(),
    effective: effectiveThemeId(),
    vscodeKind: vscodeThemeKind(),
    choices: themeChoices(),
    custom: currentCustomization(),
    sync: currentThemeSync() ?? null,
    previewing: lockedPreviewTheme(),
    previewSeconds: LOCKED_PREVIEW_SECONDS
  };
}

/** Opens Theme Studio, or brings the open one to the front. */
export function openThemeStudio(context: vscode.ExtensionContext): void {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
  const { panel, created } = openToolPanel(VIEW_TYPE, "Theme Studio", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
  if (!created) return;

  const webview = panel.webview;
  setWebviewHtml(webview, renderThemeStudio({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "theme-studio.js")).toString(),
    codiconsUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
    state: studioState()
  }));

  const push = () => safePostMessage(panel, { type: "studio:state", state: studioState() });
  const subscriptions: vscode.Disposable[] = [
    onDidChangeTheme(push),
    onDidChangeAppearance(push),
    onDidChangeLockedPreview(push),
    webview.onDidReceiveMessage(async message => {
      try {
        await handle(message);
      } catch (error) {
        void vscode.window.showErrorMessage(`Theme Studio: ${error instanceof Error ? error.message : String(error)}`);
        push();
      }
    })
  ];
  panel.onDidDispose(() => subscriptions.forEach(s => s.dispose()));
}

async function handle(message: any): Promise<void> {
  const ids = new Set(themeChoices().map(choice => choice.id));
  switch (message?.type) {
    case "setTheme":
      // A locked theme explains how to unlock it (with a preview) instead; nothing is stored unless it is unlocked.
      if (typeof message.id === "string" && ids.has(message.id)) await chooseThemeOrUnlock(message.id);
      return;
    case "custom":
      await setCustomization(message.value, { instant: message.instant === true });
      return;
    case "sync":
      await setThemeSync(message.value ?? null);
      // Pairing only applies under VS Code Adaptive, so turning it on switches to it.
      if (message.value && currentThemeId() !== SYSTEM_THEME_ID) await setTheme(SYSTEM_THEME_ID);
      return;
    case "reset":
      await setCustomization({});
      return;
  }
}
