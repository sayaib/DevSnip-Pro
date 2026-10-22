import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";

/** The dashboard: opens with the last result, or ready to scan. */
export const OSV_SCANNER_COMMAND = `${COMMAND_PREFIX}osvScanner`;
/** Opens the dashboard and scans the workspace straight away. */
export const OSV_SCAN_WORKSPACE_COMMAND = `${COMMAND_PREFIX}osvScanWorkspace`;
/** Explorer / editor entry: scans the chosen dependency file(s), or the project folder(s). */
export const OSV_SCAN_FILE_COMMAND = `${COMMAND_PREFIX}osvScanFile`;
export const OSV_COMMANDS = [OSV_SCANNER_COMMAND, OSV_SCAN_WORKSPACE_COMMAND, OSV_SCAN_FILE_COMMAND];

/**
 * Registers the OSV Vulnerability Scanner's commands. The scanner itself
 * (parsers, client, page) loads on first use, so activation stays light.
 */
export function registerOsvScannerCommands(context: vscode.ExtensionContext): void {
  const panel = () => import("./panel");
  context.subscriptions.push(
    registerTrackedCommand(OSV_SCANNER_COMMAND, async () => (await panel()).openOsvScanner(context)),
    registerTrackedCommand(OSV_SCAN_WORKSPACE_COMMAND, async () => (await panel()).openOsvScanner(context, { run: true })),
    registerTrackedCommand(OSV_SCAN_FILE_COMMAND, async (target?: unknown, selection?: unknown) => {
      // The explorer passes the clicked file and, with a multi-selection, every selected file.
      const fromSelection = Array.isArray(selection) ? selection.filter((u): u is vscode.Uri => u instanceof vscode.Uri) : [];
      const files = fromSelection.length ? fromSelection
        : target instanceof vscode.Uri ? [target]
          : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
      await (await panel()).openOsvScanner(context, files.length ? { files } : {});
    })
  );
}
