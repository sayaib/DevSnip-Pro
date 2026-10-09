"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_LABELS = exports.registerPremiumCommands = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
const feature_registry_1 = require("./feature-registry");
Object.defineProperty(exports, "CATEGORY_LABELS", { enumerable: true, get: function () { return feature_registry_1.CATEGORY_LABELS; } });
/**
 * Commands for the points-based premium system.
 *
 * Premium REST API Client tools are unlocked by spending DevSnip Pro points,
 * so the only thing to show here is the balance, what it can already afford,
 * and how to earn more. There is no licence to enter or manage.
 */
function registerPremiumCommands(context, access) {
    const status = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.premiumStatus", async () => {
        const balance = access.pointBalance();
        const premium = feature_registry_1.DEVELOPER_FEATURES.filter(feature => feature.tier === "premium");
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
            lines.push("", `Next to unlock: ${cheapest.name} (${feature_registry_1.CATEGORY_LABELS[cheapest.category]}) at ${cheapest.pointCost} points - ${short} more needed.`);
        }
        else if (premium.length) {
            lines.push("", "Every premium tool is currently affordable.");
        }
        lines.push("", "Points are earned by using DevSnip Pro: any tool run, creating snippets, running audits, AI tools, the daily bonus and milestones.");
        const choice = await vscode.window.showInformationMessage(lines.join("\n"), { modal: true }, "Open API Client", "Open Points Tracker");
        if (choice === "Open API Client")
            await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
        else if (choice === "Open Points Tracker")
            await vscode.commands.executeCommand("sayaib.hue-console.milestoneTracker");
    });
    context.subscriptions.push(status);
    // Development helper: clears today's per-feature usage counters so the daily
    // limits can be exercised repeatedly. Not registered in an installed build.
    if (context.extensionMode === vscode.ExtensionMode.Development ||
        context.extensionMode === vscode.ExtensionMode.Test) {
        context.subscriptions.push((0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.resetFeatureUsage", async () => {
            await access.resetUsage();
            vscode.window.showInformationMessage("DevSnip Pro: today's feature usage counters were reset.");
        }));
    }
}
exports.registerPremiumCommands = registerPremiumCommands;
//# sourceMappingURL=premium-commands.js.map