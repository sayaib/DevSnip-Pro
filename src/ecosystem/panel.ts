import * as vscode from "vscode";
import { openToolPanel } from "../utils/webview-ui";
import { setWebviewHtml } from "../theme/service";
import { renderEcosystemPage } from "./page";
import { resolveFocus } from "./products";

const VIEW_TYPE = "devsnip.ecosystem";

/**
 * The logo the page shows, relative to the extension root. It lives in media/
 * because webview resource roots must be folders: VS Code matches a resource
 * against `root + "/"`, so a root naming the file itself never matches.
 */
export const ECOSYSTEM_LOGO = ["media", "devsnip-logo.png"] as const;

/** Opens the ecosystem page, or brings the open one forward with the new focus. */
export function openEcosystem(context: vscode.ExtensionContext, focus?: unknown): void {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
  const logo = vscode.Uri.joinPath(context.extensionUri, ...ECOSYSTEM_LOGO);
  // The page has no script of its own (VS Code opens its store links in the browser);
  // scripts stay enabled only for the theme runtime that setWebviewHtml adds.
  const { panel, created } = openToolPanel(VIEW_TYPE, "DevSnip Pro Ecosystem", { enableScripts: true, localResourceRoots: [mediaRoot, codiconsRoot] });
  const product = resolveFocus(focus);
  // A reused panel keeps its page unless a new suggestion should lead it.
  if (!created && !product) return;
  const webview = panel.webview;
  setWebviewHtml(webview, renderEcosystemPage({
    cspSource: webview.cspSource,
    codiconsUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
    logoUri: webview.asWebviewUri(logo).toString(),
    focus: product,
    platform: typeof process !== "undefined" ? process.platform : undefined
  }));
}
