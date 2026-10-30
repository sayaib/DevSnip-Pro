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
exports.submitFeedback = exports.FEEDBACK_FORM = void 0;
const vscode = __importStar(require("vscode"));
const client_1 = require("./client");
const CONFIG_FILE = "feedback.config.json";
/** What the page needs to draw the form, so the options and limits live in one place. */
exports.FEEDBACK_FORM = { categories: client_1.FEEDBACK_CATEGORIES, limits: client_1.FEEDBACK_LIMITS };
async function readConfigFile(uri) {
    try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    }
    catch (error) {
        // Browser hosts can serve extension files over https with no file system behind them.
        if (vscode.env.uiKind !== vscode.UIKind.Web)
            throw error;
        const response = await fetch(uri.toString(true));
        return response.ok ? response.text() : undefined;
    }
}
async function loadConfig(context) {
    try {
        return (0, client_1.parseFeedbackConfig)(await readConfigFile(vscode.Uri.joinPath(context.extensionUri, CONFIG_FILE)));
    }
    catch {
        return undefined;
    }
}
function platformName() {
    if (vscode.env.uiKind === vscode.UIKind.Web)
        return "web";
    return typeof process !== "undefined" ? process.platform : "unknown";
}
async function submitFeedback(context, raw) {
    const checked = (0, client_1.validateFeedback)(raw);
    if (!checked.ok)
        return checked;
    const config = await loadConfig(context);
    if (!config)
        return { ok: false, message: "Feedback is not available in this build. Please open an issue on GitHub instead." };
    const outcome = await (0, client_1.sendFeedback)(config, checked.form, {
        extensionVersion: String(context.extension.packageJSON.version ?? ""),
        vscodeVersion: vscode.version,
        platform: platformName()
    });
    if (outcome === "ok")
        return { ok: true, message: "Thanks! We received your message and will get back to you shortly." };
    return {
        ok: false,
        message: outcome === "network"
            ? "Could not reach the server. Check your connection and try again."
            : "The server did not accept this. Please try again later."
    };
}
exports.submitFeedback = submitFeedback;
//# sourceMappingURL=index.js.map