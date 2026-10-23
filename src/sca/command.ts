import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";

/** The SCA dashboard: opens with the last result and the detected projects. */
export const SCA_SCANNER_COMMAND = `${COMMAND_PREFIX}scaScanner`;
/** Opens the dashboard and scans every project in the workspace. */
export const SCA_SCAN_WORKSPACE_COMMAND = `${COMMAND_PREFIX}scaScanWorkspace`;
export const SCA_COMMANDS = [SCA_SCANNER_COMMAND, SCA_SCAN_WORKSPACE_COMMAND];

/** Registers the SCA Scanner's commands; the scanner loads on first use. */
export function registerScaScannerCommands(context: vscode.ExtensionContext): void {
  const panel = () => import("./panel");
  context.subscriptions.push(
    registerTrackedCommand(SCA_SCANNER_COMMAND, async () => (await panel()).openScaScanner(context)),
    registerTrackedCommand(SCA_SCAN_WORKSPACE_COMMAND, async () => (await panel()).openScaScanner(context, { run: true }))
  );
}
