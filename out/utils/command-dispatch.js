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
exports.executeQueuedCommand = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("./command-registry");
let commandQueue = Promise.resolve();
/**
 * Serialises extension commands triggered by rapid webview clicks.
 *
 * The command id arrives from a webview, so it is validated against the set of
 * commands this extension registered before it is executed - a webview must
 * never be able to invoke an arbitrary VS Code command. Usage points are
 * awarded by the command registration wrapper, not here, so a tool opened from
 * a hub is counted exactly once.
 */
function executeQueuedCommand(command) {
    if (!(0, command_registry_1.isKnownCommand)(command)) {
        console.warn(`DevSnip Pro: ignored unknown command request "${String(command)}".`);
        return Promise.resolve();
    }
    const next = commandQueue.then(async () => {
        try {
            await vscode.commands.executeCommand(command);
        }
        catch (error) {
            vscode.window.showErrorMessage(`DevSnip Pro could not open that tool: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    commandQueue = next.catch(() => undefined);
    return next;
}
exports.executeQueuedCommand = executeQueuedCommand;
//# sourceMappingURL=command-dispatch.js.map