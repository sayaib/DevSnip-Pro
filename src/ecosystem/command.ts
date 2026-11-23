import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import { findProduct } from "./products";

export const ECOSYSTEM_COMMAND = `${COMMAND_PREFIX}ecosystem`;

/**
 * Registers "Explore DevSnip Pro Ecosystem". Nothing runs at activation; the
 * page loads on first use.
 *
 * The command takes an optional focus: a product id ("studio") or a tool
 * section id ("database"), which puts the matching app first.
 */
export function registerEcosystemCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerTrackedCommand(ECOSYSTEM_COMMAND, async (focus?: unknown) => {
      (await import("./panel")).openEcosystem(context, focus);
    })
  );
}

/** Opens one DevSnip Pro app's official page. Only ids from the product list are accepted. */
export async function openProductPage(id: unknown): Promise<boolean> {
  const product = findProduct(id);
  if (!product) return false;
  return vscode.env.openExternal(vscode.Uri.parse(product.url, true));
}
