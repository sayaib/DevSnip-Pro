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
exports.openEcosystem = exports.ECOSYSTEM_LOGO = void 0;
const vscode = __importStar(require("vscode"));
const webview_ui_1 = require("../utils/webview-ui");
const service_1 = require("../theme/service");
const page_1 = require("./page");
const products_1 = require("./products");
const VIEW_TYPE = "devsnip.ecosystem";
/**
 * The logo the page shows, relative to the extension root. It lives in media/
 * because webview resource roots must be folders: VS Code matches a resource
 * against `root + "/"`, so a root naming the file itself never matches.
 */
exports.ECOSYSTEM_LOGO = ["media", "devsnip-logo.png"];
/** Opens the ecosystem page, or brings the open one forward with the new focus. */
function openEcosystem(context, focus) {
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
    const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
    const logo = vscode.Uri.joinPath(context.extensionUri, ...exports.ECOSYSTEM_LOGO);
    // The page has no script of its own (VS Code opens its store links in the browser);
    // scripts stay enabled only for the theme runtime that setWebviewHtml adds.
    const { panel, created } = (0, webview_ui_1.openToolPanel)(VIEW_TYPE, "DevSnip Pro Ecosystem", { enableScripts: true, localResourceRoots: [mediaRoot, codiconsRoot] });
    const product = (0, products_1.resolveFocus)(focus);
    // A reused panel keeps its page unless a new suggestion should lead it.
    if (!created && !product)
        return;
    const webview = panel.webview;
    (0, service_1.setWebviewHtml)(webview, (0, page_1.renderEcosystemPage)({
        cspSource: webview.cspSource,
        codiconsUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
        logoUri: webview.asWebviewUri(logo).toString(),
        focus: product,
        platform: typeof process !== "undefined" ? process.platform : undefined
    }));
}
exports.openEcosystem = openEcosystem;
//# sourceMappingURL=panel.js.map