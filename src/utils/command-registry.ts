import * as vscode from "vscode";

/** Namespace shared by every command this extension contributes. */
export const COMMAND_PREFIX = "sayaib.hue-console.";

const registeredCommands = new Set<string>();
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
  registeredCommands.add(commandId);
  return vscode.commands.registerCommand(commandId, (...args: any[]) => {
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
 * Each id gets a light placeholder until one of them runs. The placeholders
 * are then disposed, `load()` imports the real module and registers the real
 * commands (through registerTrackedCommand), and the original call is replayed
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
  let placeholders: vscode.Disposable[] = [];
  const install = () => {
    placeholders = commandIds.map(id => {
      registeredCommands.add(id);
      return vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        if (!loading) {
          loading = (async () => {
            // The real commands take over these ids, so the placeholders must go first.
            placeholders.forEach(placeholder => placeholder.dispose());
            try {
              await load();
            } catch (error) {
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
