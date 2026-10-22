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
exports.registerOsvScannerCommands = exports.OSV_COMMANDS = exports.OSV_SCAN_FILE_COMMAND = exports.OSV_SCAN_WORKSPACE_COMMAND = exports.OSV_SCANNER_COMMAND = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
/** The dashboard: opens with the last result, or ready to scan. */
exports.OSV_SCANNER_COMMAND = `${command_registry_1.COMMAND_PREFIX}osvScanner`;
/** Opens the dashboard and scans the workspace straight away. */
exports.OSV_SCAN_WORKSPACE_COMMAND = `${command_registry_1.COMMAND_PREFIX}osvScanWorkspace`;
/** Explorer / editor entry: scans the chosen dependency file(s), or the project folder(s). */
exports.OSV_SCAN_FILE_COMMAND = `${command_registry_1.COMMAND_PREFIX}osvScanFile`;
exports.OSV_COMMANDS = [exports.OSV_SCANNER_COMMAND, exports.OSV_SCAN_WORKSPACE_COMMAND, exports.OSV_SCAN_FILE_COMMAND];
/**
 * Registers the OSV Vulnerability Scanner's commands. The scanner itself
 * (parsers, client, page) loads on first use, so activation stays light.
 */
function registerOsvScannerCommands(context) {
    const panel = () => Promise.resolve().then(() => __importStar(require("./panel")));
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.OSV_SCANNER_COMMAND, async () => (await panel()).openOsvScanner(context)), (0, command_registry_1.registerTrackedCommand)(exports.OSV_SCAN_WORKSPACE_COMMAND, async () => (await panel()).openOsvScanner(context, { run: true })), (0, command_registry_1.registerTrackedCommand)(exports.OSV_SCAN_FILE_COMMAND, async (target, selection) => {
        // The explorer passes the clicked file and, with a multi-selection, every selected file.
        const fromSelection = Array.isArray(selection) ? selection.filter((u) => u instanceof vscode.Uri) : [];
        const files = fromSelection.length ? fromSelection
            : target instanceof vscode.Uri ? [target]
                : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
        await (await panel()).openOsvScanner(context, files.length ? { files } : {});
    }));
}
exports.registerOsvScannerCommands = registerOsvScannerCommands;
//# sourceMappingURL=command.js.map