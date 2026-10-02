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
exports.registerLazyCommands = exports.knownCommands = exports.isKnownCommand = exports.registerTrackedCommand = exports.setCommandObserver = exports.setUsageRecorder = exports.COMMAND_PREFIX = void 0;
const vscode = __importStar(require("vscode"));
/** Namespace shared by every command this extension contributes. */
exports.COMMAND_PREFIX = "sayaib.hue-console.";
const registeredCommands = new Set();
let usageRecorder;
let commandObserver;
/**
 * Installs the gamification hook. Kept as an injected callback so the command
 * registry does not depend on the milestone tracker (and vice versa).
 */
function setUsageRecorder(recorder) {
    usageRecorder = recorder;
}
exports.setUsageRecorder = setUsageRecorder;
/**
 * Installs the analytics hook: told how every command ended and how long it
 * took. Injected (like the usage recorder) so the registry has no dependency
 * on analytics, and an observer that throws can never break a command.
 */
function setCommandObserver(observer) {
    commandObserver = observer;
}
exports.setCommandObserver = setCommandObserver;
function notify(commandId, outcome, started) {
    if (!commandObserver)
        return;
    try {
        commandObserver(commandId, outcome, Date.now() - started);
    }
    catch {
        /* observers must never affect the command */
    }
}
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
        const started = Date.now();
        let result;
        try {
            result = handler(...args);
        }
        catch (error) {
            notify(commandId, "error", started);
            throw error;
        }
        if (result && typeof result.then === "function") {
            return Promise.resolve(result).then(value => { notify(commandId, "success", started); return value; }, error => { notify(commandId, "error", started); throw error; });
        }
        notify(commandId, "success", started);
        return result;
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
/**
 * Registers commands whose implementation is loaded on first use.
 *
 * Each id gets a light placeholder until one of them runs. The placeholders
 * are then disposed, `load()` imports the real module and registers the real
 * commands (through registerTrackedCommand), and the original call is replayed
 * with its arguments. Usage points and analytics are recorded once, by the
 * real command. This keeps large modules - the REST client with axios, the
 * security analysers - out of extension activation.
 */
function registerLazyCommands(subscriptions, commandIds, load) {
    let loading;
    let placeholders = [];
    const install = () => {
        placeholders = commandIds.map(id => {
            registeredCommands.add(id);
            return vscode.commands.registerCommand(id, async (...args) => {
                if (!loading) {
                    loading = (async () => {
                        // The real commands take over these ids, so the placeholders must go first.
                        placeholders.forEach(placeholder => placeholder.dispose());
                        try {
                            await load();
                        }
                        catch (error) {
                            // Put the placeholders back so the next call retries instead of finding no command.
                            loading = undefined;
                            install();
                            throw error;
                        }
                    })();
                }
                await loading;
                return vscode.commands.executeCommand(id, ...args);
            });
        });
        subscriptions.push(...placeholders);
    };
    install();
}
exports.registerLazyCommands = registerLazyCommands;
//# sourceMappingURL=command-registry.js.map