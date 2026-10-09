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
exports.registerOnboardingCommands = exports.WALKTHROUGH_ID = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const analytics_1 = require("../analytics");
const command_registry_1 = require("../utils/command-registry");
exports.WALKTHROUGH_ID = "sayaib.hue-console#devsnip.getStarted";
/** "Get Started" opens the guided walkthrough; "What's New" opens the release notes. Neither opens on its own. */
function registerOnboardingCommands(context) {
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(`${command_registry_1.COMMAND_PREFIX}getStarted`, async () => {
        (0, analytics_1.track)("onboarding_action", { action: "walkthrough_opened" });
        await vscode.commands.executeCommand("workbench.action.openWalkthrough", exports.WALKTHROUGH_ID, false);
    }), (0, command_registry_1.registerTrackedCommand)(`${command_registry_1.COMMAND_PREFIX}whatsNew`, async () => {
        const changelog = vscode.Uri.file(path.join(context.extensionPath, "CHANGELOG.md"));
        await vscode.commands.executeCommand("markdown.showPreview", changelog);
    }));
}
exports.registerOnboardingCommands = registerOnboardingCommands;
//# sourceMappingURL=commands.js.map