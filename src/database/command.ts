import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";

export const DATABASE_CLIENT_COMMAND = `${COMMAND_PREFIX}databaseClient`;

/**
 * Registers the Database Client command. The panel, its drivers and their
 * dependencies load on first use, so activation stays light.
 */
export function registerDatabaseClientCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerTrackedCommand(DATABASE_CLIENT_COMMAND, async () => {
    const { openDatabaseClient } = await import("./panel");
    openDatabaseClient(context);
  }));
}
