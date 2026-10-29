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
const lazyPlaceholders = new Map();
const trackedRegistrations = new Map();
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
    lazyPlaceholders.get(commandId)?.dispose();
    const registration = vscode.commands.registerCommand(commandId, (...args) => {
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
    registeredCommands.add(commandId);
    const disposable = new vscode.Disposable(() => {
        registration.dispose();
        if (trackedRegistrations.get(commandId) === disposable) {
            trackedRegistrations.delete(commandId);
            registeredCommands.delete(commandId);
        }
    });
    trackedRegistrations.set(commandId, disposable);
    return disposable;
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
 * Each id gets a light placeholder while `load()` imports the real module.
 * registerTrackedCommand replaces each placeholder when its handler is ready.
 * Calls during loading share the pending load, and the original call is replayed
 * with its arguments. Usage points and analytics are recorded once, by the
 * real command. This keeps large modules - the REST client with axios, the
 * security analysers - out of extension activation.
 */
function registerLazyCommands(subscriptions, commandIds, load) {
    let loading;
    let disposed = false;
    const placeholders = new Map();
    const install = () => {
        for (const id of commandIds) {
            const registration = vscode.commands.registerCommand(id, async (...args) => {
                if (!loading) {
                    // Defer load until loading is assigned, including when load throws synchronously.
                    loading = Promise.resolve().then(load).then(() => {
                        if (disposed) {
                            for (const command of commandIds)
                                trackedRegistrations.get(command)?.dispose();
                            throw new Error("DevSnip Pro commands were disposed while loading.");
                        }
                        for (const command of commandIds) {
                            if (!trackedRegistrations.has(command))
                                throw new Error(`Command did not load: ${command}`);
                        }
                    }).catch(error => {
                        // Roll back a partially registered group before reinstalling its placeholders.
                        for (const command of commandIds)
                            trackedRegistrations.get(command)?.dispose();
                        for (const placeholder of [...placeholders.values()])
                            placeholder.dispose();
                        loading = undefined;
                        if (!disposed)
                            install();
                        throw error;
                    });
                }
                await loading;
                return vscode.commands.executeCommand(id, ...args);
            });
            const placeholder = new vscode.Disposable(() => {
                registration.dispose();
                placeholders.delete(id);
                if (lazyPlaceholders.get(id) === placeholder) {
                    lazyPlaceholders.delete(id);
                    registeredCommands.delete(id);
                }
            });
            placeholders.set(id, placeholder);
            lazyPlaceholders.set(id, placeholder);
            registeredCommands.add(id);
        }
    };
    subscriptions.push(new vscode.Disposable(() => {
        disposed = true;
        for (const placeholder of [...placeholders.values()])
            placeholder.dispose();
        for (const id of commandIds)
            trackedRegistrations.get(id)?.dispose();
    }));
    install();
}
exports.registerLazyCommands = registerLazyCommands;
//# sourceMappingURL=command-registry.js.map