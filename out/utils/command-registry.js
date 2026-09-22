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
exports.knownCommands = exports.isKnownCommand = exports.registerTrackedCommand = exports.setUsageRecorder = exports.COMMAND_PREFIX = void 0;
const vscode = __importStar(require("vscode"));
/** Namespace shared by every command this extension contributes. */
exports.COMMAND_PREFIX = "sayaib.hue-console.";
const registeredCommands = new Set();
let usageRecorder;
/**
 * Installs the gamification hook. Kept as an injected callback so the command
 * registry does not depend on the milestone tracker (and vice versa).
 */
function setUsageRecorder(recorder) {
    usageRecorder = recorder;
}
exports.setUsageRecorder = setUsageRecorder;
/**
 * Registers a DevSnip Pro command and records a single tool-usage event per
 * invocation. Every command must go through here: it is the one place that
 * awards points, so a command can never be counted twice or missed.
 */
function registerTrackedCommand(commandId, handler) {
    registeredCommands.add(commandId);
    return vscode.commands.registerCommand(commandId, (...args) => {
        if (usageRecorder && commandId !== `${exports.COMMAND_PREFIX}milestoneTracker`) {
            usageRecorder(commandId);
        }
        return handler(...args);
    });
}
exports.registerTrackedCommand = registerTrackedCommand;
/** True when the id belongs to a command this extension actually registered. */
function isKnownCommand(commandId) {
    return typeof commandId === "string" && registeredCommands.has(commandId);
}
exports.isKnownCommand = isKnownCommand;
/** Snapshot of every registered command id (used by tests and diagnostics). */
function knownCommands() {
    return [...registeredCommands].sort();
}
exports.knownCommands = knownCommands;
//# sourceMappingURL=command-registry.js.map