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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const tools_sidebar_1 = require("../sidebar/tools-sidebar");
const hubCommands_1 = require("../commands/hubCommands");
const runner_1 = require("../toolkits/runner");
const commands_1 = require("../onboarding/commands");
const activation_1 = require("../onboarding/activation");
const milestoneTracker_1 = require("../commands/milestoneTracker");
const service_1 = require("../theme/service");
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const toolSearch_1 = require("../commands/toolSearch");
/** Browser activation never imports the Desktop activation graph or its drivers. */
async function activate(context) {
    (0, webview_ui_1.setToolPanelLogo)(context.extensionUri);
    await vscode.commands.executeCommand("setContext", "devsnip.webHost", true);
    (0, milestoneTracker_1.setMilestoneContext)(context);
    (0, service_1.setThemeAccess)({
        lock: id => (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), id),
        unlock: async (id) => {
            const lock = (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), id);
            return !lock || (await (0, milestoneTracker_1.buyReward)(context, lock.rewardId)) === "ok";
        },
        grant: id => (0, milestoneTracker_1.grantKeptTheme)(context, id)
    });
    (0, service_1.initThemes)(context);
    const sidebar = new tools_sidebar_1.ToolsSidebarProvider(context);
    (0, milestoneTracker_1.setTreeRefreshCallback)(() => sidebar.refresh());
    (0, command_registry_1.setUsageRecorder)(command => {
        void (0, milestoneTracker_1.autoRecordToolUsage)(command);
        sidebar.recordUsage(command);
        (0, activation_1.noteCommand)(command);
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(tools_sidebar_1.TOOLS_VIEW_ID, sidebar));
    (0, runner_1.registerToolkitCommands)(context);
    (0, hubCommands_1.registerHubCommands)(context);
    (0, service_1.registerThemeCommand)(context);
    (0, milestoneTracker_1.registerMilestoneTrackerCommand)(context);
    (0, commands_1.registerOnboardingCommands)(context);
    (0, command_registry_1.registerLazyCommands)(context.subscriptions, ["insertDebugLog", "removeDebugLogsInFile"].map(c => command_registry_1.COMMAND_PREFIX + c), async () => {
        (await Promise.resolve().then(() => __importStar(require("../debug/commands")))).registerDebugLogCommands(context);
    });
    (0, toolSearch_1.registerUniversalToolSearch)(context);
    const version = String(context.extension.packageJSON.version);
    const previous = context.globalState.get("devsnip.web.lastVersion");
    await (0, activation_1.initActivation)(context, version, { isNewInstall: !previous && !context.globalState.keys().some(k => k.startsWith("devsnip.activation")), previousVersion: previous, recordDiscovery: id => (0, milestoneTracker_1.recordDiscovery)(context, id) });
    await context.globalState.update("devsnip.web.lastVersion", version);
}
exports.activate = activate;
function deactivate() { (0, webview_ui_1.disposeAllToolPanels)(); }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map