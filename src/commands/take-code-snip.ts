import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// Cache for HTML template to avoid repeated file reads
let cachedTemplate: string | null = null;

const VIEW_TYPE = "devsnip pro";
const WEB_VIEW_TITLE = "DevSnip Pro Code Snapshot";

let panel: vscode.WebviewPanel | undefined;

const init = (context: vscode.ExtensionContext) => {
  const activeTextEditor = vscode.window.activeTextEditor;
  if (activeTextEditor) {
    // Check if panel is already created, if not, create a new panel
    if (!panel) {
      panel = createPanel(context);
      // Dispose panel and clean up when closed
      panel.onDidDispose(() => {
        panel = undefined;
        vscode.window.showInformationMessage("Bye !!");
      });
    }
    // If there is text selected, update the panel
    if (hasTextSelected(activeTextEditor.selection)) {
      update(panel);
    }
  } else {
    //@desc Handle no text selection
    vscode.window.showErrorMessage(
      "Go to your code editor then run this feature, no code selected"
    );
  }
};

const createPanel = (context: vscode.ExtensionContext): vscode.WebviewPanel => {
  const htmlTemplatePath = path.resolve(
    context.extensionPath,
    "webview/index.html"
  );

  // Create a new webview panel
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    WEB_VIEW_TITLE,
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(context.extensionPath)],
    }
  );
  const iconPath = path.resolve(context.extensionPath, "logo.png");
  panel.iconPath = vscode.Uri.file(iconPath);

  // Load HTML template into the webview panel
  panel.webview.html = getTemplate(htmlTemplatePath, panel);

  // Handle messages received from the webview
  panel.webview.onDidReceiveMessage((message) => {
    if (message.type === "updateCode") {
      update(panel);
    }
  });

  return panel;
};

const getTemplate = (
  htmlTemplatePath: string,
  panel: vscode.WebviewPanel
): string => {
  // Use cached template if available
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(htmlTemplatePath, "utf-8");
  }
  
  // Replace placeholders in the HTML template with actual values
  return cachedTemplate
    .replace(/%CSP_SOURCE%/gu, panel.webview.cspSource)
    .replace(/(src|href)="([^"]*)"/gu, (_, match, src) => {
      let assetsPath = panel.webview.asWebviewUri(
        vscode.Uri.file(path.resolve(htmlTemplatePath, "..", src))
      );
      return `${match}="${assetsPath}"`;
    });
};

const update = (panel: vscode.WebviewPanel): void => {
  vscode.commands.executeCommand("editor.action.clipboardCopyAction");

  // Send a message to the webview to trigger the code update
  panel.webview.postMessage({
    type: "updateCode",
  });
};

const hasTextSelected = (selection: vscode.Selection | undefined): boolean =>
  !!selection && !selection.isEmpty;

export const codeSnapShot = (context: vscode.ExtensionContext) => {
  // Register the extension command to capture devsnip pro
  const disposable = vscode.commands.registerCommand(
    "sayaib.hue-console.captureCode", 
    () => init(context)
  );
  
  context.subscriptions.push(disposable);
  return disposable;
};
