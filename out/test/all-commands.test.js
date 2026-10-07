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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
/**
 * Runs every contributed command in a real VS Code and checks that it neither
 * throws, nor shows an error, nor leaves an unhandled promise rejection, and
 * that webview tools actually open a panel. Commands that wait for a choice
 * (quick picks, input boxes) are dismissed after a moment rather than awaited.
 */
const EXTENSION_ID = "sayaib.hue-console";
/** Commands whose job is a quick pick, a notification or a terminal rather than a panel. */
const NO_PANEL = new Set([
    "searchTools", "chooseTheme", "premiumStatus", "createCustomSnippet", "observabilityAnalyze",
    "securityAudit", "cloudSecurityAudit", "removeUnusedImports", "listAndRemoveConsoleLogs", "readmeManager",
    "getStarted", "whatsNew", "resetFeatureUsage", "dependencyManager", "endpointSecurityScan", "dependencyAudit"
]);
/** Guidance a command rightly shows when run with no editor or selection, as it is here. */
const EXPECTED_GUIDANCE = {
    createCustomSnippet: /Open a file and select the code/
};
function contributedCommands() {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const manifest = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, "package.json"), "utf8"));
    return manifest.contributes.commands.map((entry) => entry.command);
}
const webviewTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview);
async function settle(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}
suite("Every command, end to end", function () {
    this.timeout(10 * 60 * 1000);
    const errors = [];
    const rejections = [];
    const window = vscode.window;
    let originalShowError;
    const onRejection = (reason) => rejections.push(reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason));
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
        originalShowError = window.showErrorMessage;
        window.showErrorMessage = (...args) => {
            errors.push(String(args[0]));
            return Promise.resolve(undefined);
        };
        process.on("unhandledRejection", onRejection);
    });
    suiteTeardown(async () => {
        window.showErrorMessage = originalShowError;
        process.off("unhandledRejection", onRejection);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
    test("every command runs without an error, and webview tools open a panel", async () => {
        const registered = new Set(await vscode.commands.getCommands(true));
        const problems = [];
        let ran = 0;
        for (const command of contributedCommands()) {
            const short = command.replace(`${EXTENSION_ID}.`, "");
            if (!registered.has(command))
                continue; // development-only commands
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            const errorsBefore = errors.length;
            const rejectionsBefore = rejections.length;
            const outcome = await Promise.race([
                Promise.resolve(vscode.commands.executeCommand(command)).then(() => "done", (error) => `threw: ${error instanceof Error ? error.message : String(error)}`),
                settle(4000).then(() => "waiting for input")
            ]);
            await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
            // Panels and their first message round trip.
            for (let i = 0; i < 20 && !NO_PANEL.has(short) && webviewTabs().length === 0; i++)
                await settle(100);
            await settle(300);
            ran++;
            // The test host refuses modal dialogs; a command that reached one behaved correctly.
            if (outcome.startsWith("threw") && !/DialogService: refused to show dialog in tests/.test(outcome))
                problems.push(`${short}: ${outcome}`);
            const shown = errors.slice(errorsBefore).filter(message => !(EXPECTED_GUIDANCE[short] ?? /^$/).test(message));
            if (shown.length)
                problems.push(`${short}: showed an error: ${shown.join(" | ")}`);
            if (rejections.length > rejectionsBefore)
                problems.push(`${short}: unhandled rejection: ${rejections.slice(rejectionsBefore).join(" | ").slice(0, 400)}`);
            if (!NO_PANEL.has(short) && webviewTabs().length === 0)
                problems.push(`${short}: no panel opened (${outcome})`);
        }
        assert.ok(ran > 120, `only ${ran} commands ran`);
        assert.deepStrictEqual(problems, [], problems.join("\n"));
    });
    test("opening and closing every panel twice does not leak memory", async () => {
        const panels = contributedCommands().filter(command => !NO_PANEL.has(command.replace(`${EXTENSION_ID}.`, "")));
        const cycle = async () => {
            for (const command of panels) {
                await Promise.race([Promise.resolve(vscode.commands.executeCommand(command)).catch(() => undefined), settle(2000)]);
            }
            await settle(500);
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            await settle(1000);
        };
        // A real collection before each reading, so the numbers measure what is retained, not garbage.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("v8").setFlagsFromString("--expose-gc");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const gc = require("vm").runInNewContext("gc");
        const heap = async () => {
            for (let i = 0; i < 3; i++) {
                gc();
                await settle(200);
            }
            return process.memoryUsage().heapUsed;
        };
        await cycle();
        const readings = [await heap()];
        for (let i = 0; i < 4; i++) {
            await cycle();
            readings.push(await heap());
        }
        const mb = (bytes) => (bytes / 1048576).toFixed(1);
        console.log(`      retained heap after each open/close cycle: ${readings.map(mb).join(" → ")} MB`);
        // A leak keeps every closed panel's page alive: several MB per cycle, every cycle.
        const perCycleMb = (readings[readings.length - 1] - readings[0]) / (readings.length - 1) / 1048576;
        assert.ok(perCycleMb < 2, `the extension host retains ${perCycleMb.toFixed(1)} MB more after every open/close cycle`);
        assert.strictEqual(webviewTabs().length, 0, "every panel closed");
        // Closed panels must not stay registered with the theme service (they held their whole page HTML).
        const theme = await Promise.resolve().then(() => __importStar(require("../theme/service")));
        await vscode.commands.executeCommand(`${EXTENSION_ID}.jsonFormatter`);
        await settle(500);
        assert.ok(theme.trackedWebviewCount() <= 3, `the theme service still tracks ${theme.trackedWebviewCount()} webviews after every panel closed`);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
});
//# sourceMappingURL=all-commands.test.js.map