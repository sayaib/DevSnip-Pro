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
exports.openThemeStudio = void 0;
const vscode = __importStar(require("vscode"));
const webview_ui_1 = require("../utils/webview-ui");
const service_1 = require("./service");
const studio_page_1 = require("./studio-page");
const themes_1 = require("./themes");
const VIEW_TYPE = "devsnip.themeStudio";
function studioState() {
    return {
        current: (0, service_1.currentThemeId)(),
        effective: (0, service_1.effectiveThemeId)(),
        vscodeKind: (0, service_1.vscodeThemeKind)(),
        choices: (0, service_1.themeChoices)(),
        custom: (0, service_1.currentCustomization)(),
        sync: (0, service_1.currentThemeSync)() ?? null,
        previewing: (0, service_1.lockedPreviewTheme)(),
        previewSeconds: service_1.LOCKED_PREVIEW_SECONDS
    };
}
/** Opens Theme Studio, or brings the open one to the front. */
function openThemeStudio(context) {
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
    const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
    const { panel, created } = (0, webview_ui_1.openToolPanel)(VIEW_TYPE, "Theme Studio", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
    if (!created)
        return;
    const webview = panel.webview;
    (0, service_1.setWebviewHtml)(webview, (0, studio_page_1.renderThemeStudio)({
        cspSource: webview.cspSource,
        scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "theme-studio.js")).toString(),
        codiconsUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
        state: studioState()
    }));
    const push = () => (0, webview_ui_1.safePostMessage)(panel, { type: "studio:state", state: studioState() });
    const subscriptions = [
        (0, service_1.onDidChangeTheme)(push),
        (0, service_1.onDidChangeAppearance)(push),
        (0, service_1.onDidChangeLockedPreview)(push),
        webview.onDidReceiveMessage(async (message) => {
            try {
                await handle(message);
            }
            catch (error) {
                void vscode.window.showErrorMessage(`Theme Studio: ${error instanceof Error ? error.message : String(error)}`);
                push();
            }
        })
    ];
    panel.onDidDispose(() => subscriptions.forEach(s => s.dispose()));
}
exports.openThemeStudio = openThemeStudio;
async function handle(message) {
    const ids = new Set((0, service_1.themeChoices)().map(choice => choice.id));
    switch (message?.type) {
        case "setTheme":
            // A locked theme explains how to unlock it (with a preview) instead; nothing is stored unless it is unlocked.
            if (typeof message.id === "string" && ids.has(message.id))
                await (0, service_1.chooseThemeOrUnlock)(message.id);
            return;
        case "custom":
            await (0, service_1.setCustomization)(message.value, { instant: message.instant === true });
            return;
        case "sync":
            await (0, service_1.setThemeSync)(message.value ?? null);
            // Pairing only applies under VS Code Adaptive, so turning it on switches to it.
            if (message.value && (0, service_1.currentThemeId)() !== themes_1.SYSTEM_THEME_ID)
                await (0, service_1.setTheme)(themes_1.SYSTEM_THEME_ID);
            return;
        case "reset":
            await (0, service_1.setCustomization)({});
            return;
    }
}
//# sourceMappingURL=studio.js.map