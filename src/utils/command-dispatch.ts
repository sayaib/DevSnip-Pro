import * as vscode from "vscode";
import { isKnownCommand } from "./command-registry";

let commandQueue: Promise<void> = Promise.resolve();

/**
 * Serialises extension commands triggered by rapid webview clicks.
 *
 * The command id arrives from a webview, so it is validated against the set of
 * commands this extension registered before it is executed - a webview must
 * never be able to invoke an arbitrary VS Code command. Usage points are
 * awarded by the command registration wrapper, not here, so a tool opened from
 * a hub is counted exactly once.
 */
export function executeQueuedCommand(command: unknown): Promise<void> {
  if (!isKnownCommand(command)) {
    console.warn(`DevSnip Pro: ignored unknown command request "${String(command)}".`);
    return Promise.resolve();
  }
  const next = commandQueue.then(async () => {
    try {
      await vscode.commands.executeCommand(command);
    } catch (error) {
      vscode.window.showErrorMessage(
        `DevSnip Pro could not open that tool: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
  commandQueue = next.catch(() => undefined);
  return next;
}
