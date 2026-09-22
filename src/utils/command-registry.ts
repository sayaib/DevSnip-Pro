import * as vscode from "vscode";

/** Namespace shared by every command this extension contributes. */
export const COMMAND_PREFIX = "sayaib.hue-console.";

const registeredCommands = new Set<string>();
let usageRecorder: ((commandId: string) => void) | undefined;

/**
 * Installs the gamification hook. Kept as an injected callback so the command
 * registry does not depend on the milestone tracker (and vice versa).
 */
export function setUsageRecorder(recorder: (commandId: string) => void): void {
  usageRecorder = recorder;
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
    return handler(...args);
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
