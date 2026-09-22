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
 * User-facing commands for managing the subscription, plus the development
 * tier switcher.
 *
 * The switcher is registered only in a development or test host, so an
 * installed extension does not even expose a command that could be used to
 * bypass licensing.
 */
function describeStatus(state) {
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
function registerPremiumCommands(context, entitlements, access) {
    const activate = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.activatePremium", async () => {
        const key = await vscode.window.showInputBox({
            title: "Activate DevSnip Pro Premium",
            prompt: "Paste your licence key. It is stored in VS Code secret storage, never in settings or a webview.",
            placeHolder: "DSP-PREMIUM-YYYYMMDD-XXXXXX",
            password: true,
            ignoreFocusOut: true,
            validateInput: value => (value.trim() ? null : "Enter a licence key")
        });
        if (key === undefined)
            return;
        const state = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DevSnip Pro: verifying licence" }, () => entitlements.activate(key));
        if (state.isPremium) {
            vscode.window.showInformationMessage(`DevSnip Pro Premium activated. ${state.detail ?? ""}`.trim());
        }
        else {
            vscode.window.showErrorMessage(state.detail || "That licence key could not be activated.");
        }
    });
    const deactivate = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.deactivatePremium", async () => {
        if (!(await entitlements.hasStoredLicense())) {
            vscode.window.showInformationMessage("No DevSnip Pro licence is currently stored.");
            return;
        }
        const choice = await vscode.window.showWarningMessage("Remove the stored DevSnip Pro licence from this machine?", { modal: true }, "Remove licence");
        if (choice !== "Remove licence")
            return;
        await entitlements.deactivate();
        vscode.window.showInformationMessage("Licence removed. Free features remain available.");
    });
    const status = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.premiumStatus", async () => {
        const state = await entitlements.refresh();
        const premiumCount = feature_registry_1.DEVELOPER_FEATURES.filter(feature => feature.tier === "premium").length;
        const freeCount = feature_registry_1.DEVELOPER_FEATURES.length - premiumCount;
        const unlocked = feature_registry_1.DEVELOPER_FEATURES.filter(feature => access.check(feature.id).allowed).length;
        const lines = [
            describeStatus(state),
            state.detail ?? "",
            "",
            `Features available to you: ${unlocked} of ${feature_registry_1.DEVELOPER_FEATURES.length} (${freeCount} free, ${premiumCount} premium).`
        ].filter(Boolean);
        const actions = state.isPremium ? ["Open API Client", "Remove Licence"] : ["Open API Client", "Activate Licence"];
        const choice = await vscode.window.showInformationMessage(lines.join("\n"), { modal: true }, ...actions);
        if (choice === "Open API Client")
            await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
        else if (choice === "Activate Licence")
            await vscode.commands.executeCommand("sayaib.hue-console.activatePremium");
        else if (choice === "Remove Licence")
            await vscode.commands.executeCommand("sayaib.hue-console.deactivatePremium");
    });
    context.subscriptions.push(activate, deactivate, status);
    // ---------------------------------------------------------- development
    if (!entitlements.developmentModeAvailable())
        return;
    const devSwitch = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.setDevelopmentTier", async () => {
        const options = [
            { label: "Free", description: "Act as a free user", value: "free" },
            { label: "Premium", description: "Act as a premium subscriber", value: "premium" },
            { label: "Clear override", description: "Use the real licence state", value: undefined }
        ];
        const picked = await vscode.window.showQuickPick(options, {
            title: "Development: simulate a subscription tier",
            placeHolder: "Only available in an extension development host"
        });
        if (!picked)
            return;
        const state = await entitlements.setDevelopmentTier(picked.value);
        vscode.window.showInformationMessage(picked.value
            ? `Development override active: ${picked.value}. ${describeStatus(state)}`
            : `Development override cleared. ${describeStatus(state)}`);
    });
    const resetUsage = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.resetFeatureUsage", async () => {
        await access.resetUsage();
        vscode.window.showInformationMessage("DevSnip Pro: today's feature usage counters were reset.");
    });
    context.subscriptions.push(devSwitch, resetUsage);
}
exports.registerPremiumCommands = registerPremiumCommands;
//# sourceMappingURL=premium-commands.js.map