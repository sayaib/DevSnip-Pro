import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { EntitlementStore, SubscriptionState } from "./entitlement";
import { FeatureAccessService } from "./feature-access";
import { CATEGORY_LABELS, DEVELOPER_FEATURES } from "./feature-registry";

/**
 * User-facing commands for managing the subscription, plus the development
 * tier switcher.
 *
 * The switcher is registered only in a development or test host, so an
 * installed extension does not even expose a command that could be used to
 * bypass licensing.
 */

function describeStatus(state: SubscriptionState): string {
  switch (state.status) {
    case "active":
      return state.expiresAt
        ? `Premium - active until ${new Date(state.expiresAt).toLocaleDateString()}`
        : "Premium - active";
    case "expired":
      return "Premium - expired";
    case "invalid":
      return "Premium - licence rejected";
    case "offline-grace":
      return "Premium - active (cached, licence server unreachable)";
    case "offline-expired":
      return "Premium - cached licence too old to trust";
    case "development":
      return `Development override - acting as ${state.tier}`;
    default:
      return "Free";
  }
}

export function registerPremiumCommands(
  context: vscode.ExtensionContext,
  entitlements: EntitlementStore,
  access: FeatureAccessService
): void {
  const activate = registerTrackedCommand("sayaib.hue-console.activatePremium", async () => {
    const key = await vscode.window.showInputBox({
      title: "Activate DevSnip Pro Premium",
      prompt: "Paste your licence key. It is stored in VS Code secret storage, never in settings or a webview.",
      placeHolder: "DSP-PREMIUM-YYYYMMDD-XXXXXX",
      password: true,
      ignoreFocusOut: true,
      validateInput: value => (value.trim() ? null : "Enter a licence key")
    });
    if (key === undefined) return;

    const state = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "DevSnip Pro: verifying licence" },
      () => entitlements.activate(key)
    );

    if (state.isPremium) {
      vscode.window.showInformationMessage(`DevSnip Pro Premium activated. ${state.detail ?? ""}`.trim());
    } else {
      vscode.window.showErrorMessage(state.detail || "That licence key could not be activated.");
    }
  });

  const deactivate = registerTrackedCommand("sayaib.hue-console.deactivatePremium", async () => {
    if (!(await entitlements.hasStoredLicense())) {
      vscode.window.showInformationMessage("No DevSnip Pro licence is currently stored.");
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "Remove the stored DevSnip Pro licence from this machine?",
      { modal: true },
      "Remove licence"
    );
    if (choice !== "Remove licence") return;
    await entitlements.deactivate();
    vscode.window.showInformationMessage("Licence removed. Free features remain available.");
  });

  const status = registerTrackedCommand("sayaib.hue-console.premiumStatus", async () => {
    const state = await entitlements.refresh();
    const premiumCount = DEVELOPER_FEATURES.filter(feature => feature.tier === "premium").length;
    const freeCount = DEVELOPER_FEATURES.length - premiumCount;
    const unlocked = DEVELOPER_FEATURES.filter(feature => access.check(feature.id).allowed).length;

    const lines = [
      describeStatus(state),
      state.detail ?? "",
      "",
      `Features available to you: ${unlocked} of ${DEVELOPER_FEATURES.length} (${freeCount} free, ${premiumCount} premium).`
    ].filter(Boolean);

    const actions = state.isPremium ? ["Open API Client", "Remove Licence"] : ["Open API Client", "Activate Licence"];
    const choice = await vscode.window.showInformationMessage(lines.join("\n"), { modal: true }, ...actions);
    if (choice === "Open API Client") await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
    else if (choice === "Activate Licence") await vscode.commands.executeCommand("sayaib.hue-console.activatePremium");
    else if (choice === "Remove Licence") await vscode.commands.executeCommand("sayaib.hue-console.deactivatePremium");
  });

  context.subscriptions.push(activate, deactivate, status);

  // ---------------------------------------------------------- development

  if (!entitlements.developmentModeAvailable()) return;

  const devSwitch = registerTrackedCommand("sayaib.hue-console.setDevelopmentTier", async () => {
    const options = [
      { label: "Free", description: "Act as a free user", value: "free" as const },
      { label: "Premium", description: "Act as a premium subscriber", value: "premium" as const },
      { label: "Clear override", description: "Use the real licence state", value: undefined }
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: "Development: simulate a subscription tier",
      placeHolder: "Only available in an extension development host"
    });
    if (!picked) return;

    const state = await entitlements.setDevelopmentTier(picked.value);
    vscode.window.showInformationMessage(
      picked.value
        ? `Development override active: ${picked.value}. ${describeStatus(state)}`
        : `Development override cleared. ${describeStatus(state)}`
    );
  });

  const resetUsage = registerTrackedCommand("sayaib.hue-console.resetFeatureUsage", async () => {
    await access.resetUsage();
    vscode.window.showInformationMessage("DevSnip Pro: today's feature usage counters were reset.");
  });

  context.subscriptions.push(devSwitch, resetUsage);
}

/** Category labels, exported so the tree and the webview agree on wording. */
export { CATEGORY_LABELS };
