import * as vscode from "vscode";
import { COMMAND_PREFIX, registerLazyCommands } from "../utils/command-registry";

/** The check starts this long after activation, so it never competes with startup. */
const STARTUP_DELAY_MS = 30_000;
const UPDATE_COMMANDS = ["checkForUpdates", "updateActions"].map(id => COMMAND_PREFIX + id);

/**
 * Desktop only: registers the update commands lazily and starts the
 * background check after startup. Nothing here imports the update module
 * until it runs, so activation does not load it.
 */
export function registerUpdateNotifications(context: vscode.ExtensionContext): void {
  const load = async () => (await import("./service")).getUpdateManager(context);
  registerLazyCommands(context.subscriptions, UPDATE_COMMANDS, async () => { await load(); });
  const timer = setTimeout(() => {
    load().then(manager => manager.start(), error => console.error("DevSnip Pro: update notifications could not start.", error));
  }, context.extensionMode === vscode.ExtensionMode.Development && process.env.DEVSNIP_PREVIEW_UPDATE === "1" ? 0 : STARTUP_DELAY_MS);
  context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}
