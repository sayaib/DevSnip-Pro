import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { FeatureAccessService } from "./feature-access";
import { CATEGORY_LABELS, DEVELOPER_FEATURES } from "./feature-registry";

/**
 * Commands for the points-based premium system.
 *
 * Premium REST API Client tools are unlocked by spending DevSnip Pro points,
 * so the only thing to show here is the balance, what it can already afford,
 * and how to earn more. There is no licence to enter or manage.
 */

export function registerPremiumCommands(
  context: vscode.ExtensionContext,
  access: FeatureAccessService
): void {
  const status = registerTrackedCommand("sayaib.hue-console.premiumStatus", async () => {
    const balance = access.pointBalance();
    const premium = DEVELOPER_FEATURES.filter(feature => feature.tier === "premium");
    const affordable = premium.filter(feature => access.check(feature.id).allowed);

    const cheapest = premium
      .filter(feature => (feature.pointCost ?? 0) > balance)
      .sort((a, b) => (a.pointCost ?? 0) - (b.pointCost ?? 0))[0];

    const lines = [
      `You have ${balance} DevSnip Pro point${balance === 1 ? "" : "s"}.`,
      "",
      `${affordable.length} of ${premium.length} premium REST API Client tools are unlocked at this balance.`
    ];

    if (cheapest) {
      const short = (cheapest.pointCost ?? 0) - balance;
      lines.push(
        "",
        `Next to unlock: ${cheapest.name} (${CATEGORY_LABELS[cheapest.category]}) at ${cheapest.pointCost} points - ${short} more needed.`
      );
    } else if (premium.length) {
      lines.push("", "Every premium tool is currently affordable.");
    }

    lines.push(
      "",
      "Points are earned by using DevSnip Pro: any tool run, creating snippets, running audits, AI tools, the daily bonus and milestones."
    );

    const choice = await vscode.window.showInformationMessage(
      lines.join("\n"),
      { modal: true },
      "Open API Client",
      "Open Points Tracker"
    );
    if (choice === "Open API Client") await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
    else if (choice === "Open Points Tracker") await vscode.commands.executeCommand("sayaib.hue-console.milestoneTracker");
  });

  context.subscriptions.push(status);

  // Development helper: clears today's per-feature usage counters so the daily
  // limits can be exercised repeatedly. Not registered in an installed build.
  if (
    context.extensionMode === vscode.ExtensionMode.Development ||
    context.extensionMode === vscode.ExtensionMode.Test
  ) {
    context.subscriptions.push(
      registerTrackedCommand("sayaib.hue-console.resetFeatureUsage", async () => {
        await access.resetUsage();
        vscode.window.showInformationMessage("DevSnip Pro: today's feature usage counters were reset.");
      })
    );
  }
}

export { CATEGORY_LABELS };
