import * as vscode from "vscode";

let commandQueue: Promise<void> = Promise.resolve();

/** Serialize extension commands triggered by rapid webview clicks. */
export function executeQueuedCommand(command: string): Promise<void> {
  const next = commandQueue.then(async () => {
    await vscode.commands.executeCommand(command);
  });
  commandQueue = next.catch(() => undefined);
  return next;
}
