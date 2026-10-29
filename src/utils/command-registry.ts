import * as vscode from "vscode";

/** Namespace shared by every command this extension contributes. */
export const COMMAND_PREFIX = "sayaib.hue-console.";

const registeredCommands = new Set<string>();
const lazyPlaceholders = new Map<string, vscode.Disposable>();
const trackedRegistrations = new Map<string, vscode.Disposable>();
let usageRecorder: ((commandId: string) => void) | undefined;
let commandObserver: ((commandId: string, outcome: "success" | "error", durationMs: number) => void) | undefined;

/**
 * Installs the gamification hook. Kept as an injected callback so the command
 * registry does not depend on the milestone tracker (and vice versa).
 */
export function setUsageRecorder(recorder: (commandId: string) => void): void {
  usageRecorder = recorder;
}

/**
 * Installs the analytics hook: told how every command ended and how long it
 * took. Injected (like the usage recorder) so the registry has no dependency
 * on analytics, and an observer that throws can never break a command.
 */
export function setCommandObserver(observer: typeof commandObserver): void {
  commandObserver = observer;
}

function notify(commandId: string, outcome: "success" | "error", started: number): void {
  if (!commandObserver) return;
  try {
    commandObserver(commandId, outcome, Date.now() - started);
  } catch {
    /* observers must never affect the command */
  }
}

/**
 * Registers a DevSnip Pro command and records a single tool-usage event per
 * invocation. Every command must go through here: it is the one place that
 * awards points, so a command can never be counted twice or missed.
 */
export function registerTrackedCommand(
  commandId: string,
  handler: (...args: any[]) => any
): vscode.Disposable {
  lazyPlaceholders.get(commandId)?.dispose();
  const registration = vscode.commands.registerCommand(commandId, (...args: any[]) => {
    if (usageRecorder && commandId !== `${COMMAND_PREFIX}milestoneTracker`) {
      usageRecorder(commandId);
    }
    const started = Date.now();
    let result: unknown;
    try {
      result = handler(...args);
    } catch (error) {
      notify(commandId, "error", started);
      throw error;
    }
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      return Promise.resolve(result).then(
        value => { notify(commandId, "success", started); return value; },
        error => { notify(commandId, "error", started); throw error; }
      );
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

/** True when the id belongs to a command this extension actually registered. */
export function isKnownCommand(commandId: unknown): commandId is string {
  return typeof commandId === "string" && registeredCommands.has(commandId);
}

/** Snapshot of every registered command id (used by tests and diagnostics). */
export function knownCommands(): string[] {
  return [...registeredCommands].sort();
}

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
export function registerLazyCommands(
  subscriptions: { dispose(): unknown }[],
  commandIds: string[],
  load: () => Promise<void>
): void {
  let loading: Promise<void> | undefined;
  let disposed = false;
  const placeholders = new Map<string, vscode.Disposable>();
  const install = () => {
    for (const id of commandIds) {
      const registration = vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        if (!loading) {
          // Defer load until loading is assigned, including when load throws synchronously.
          loading = Promise.resolve().then(load).then(() => {
            if (disposed) {
              for (const command of commandIds) trackedRegistrations.get(command)?.dispose();
              throw new Error("DevSnip Pro commands were disposed while loading.");
            }
            for (const command of commandIds) {
              if (!trackedRegistrations.has(command)) throw new Error(`Command did not load: ${command}`);
            }
          }).catch(error => {
            // Roll back a partially registered group before reinstalling its placeholders.
            for (const command of commandIds) trackedRegistrations.get(command)?.dispose();
            for (const placeholder of [...placeholders.values()]) placeholder.dispose();
            loading = undefined;
            if (!disposed) install();
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
    for (const placeholder of [...placeholders.values()]) placeholder.dispose();
    for (const id of commandIds) trackedRegistrations.get(id)?.dispose();
  }));
  install();
}
