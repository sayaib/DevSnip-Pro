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
const command_registry_1 = require("../../utils/command-registry");
const activation_1 = require("../../onboarding/activation");
const milestoneTracker_1 = require("../../commands/milestoneTracker");
const tools_sidebar_1 = require("../../sidebar/tools-sidebar");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
const vscode = __importStar(require("vscode"));
const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = String(manifest.version);
function state(context) {
    return context.globalState.get("devsnip.activation");
}
(0, run_unit_tests_1.suite)("lazy commands", () => {
    (0, run_unit_tests_1.test)("a placeholder loads the module once and replays the call with its arguments", async () => {
        const id = `${command_registry_1.COMMAND_PREFIX}lazyTestReplay`;
        const subscriptions = [];
        let loads = 0;
        const calls = [];
        (0, command_registry_1.registerLazyCommands)(subscriptions, [id], async () => {
            loads++;
            (0, command_registry_1.registerTrackedCommand)(id, (...args) => { calls.push(args); return "real"; });
        });
        assert.ok((0, command_registry_1.isKnownCommand)(id), "lazy ids are known before they load, so webviews may run them");
        assert.strictEqual(loads, 0, "nothing loads during activation");
        assert.strictEqual(await vscode.commands.executeCommand(id, 1, "two"), "real");
        assert.strictEqual(await vscode.commands.executeCommand(id, 3), "real");
        assert.strictEqual(loads, 1);
        assert.deepStrictEqual(calls, [[1, "two"], [3]]);
        assert.ok(subscriptions.length >= 1, "placeholders are disposed with the extension");
    });
    (0, run_unit_tests_1.test)("a failed load puts the placeholders back so the next call retries", async () => {
        const id = `${command_registry_1.COMMAND_PREFIX}lazyTestRetry`;
        let attempt = 0;
        (0, command_registry_1.registerLazyCommands)([], [id], async () => {
            attempt++;
            if (attempt === 1)
                throw new Error("module failed to load");
            (0, command_registry_1.registerTrackedCommand)(id, () => "loaded");
        });
        await assert.rejects(Promise.resolve(vscode.commands.executeCommand(id)), /module failed to load/);
        assert.strictEqual(await vscode.commands.executeCommand(id), "loaded");
        assert.strictEqual(attempt, 2);
    });
});
(0, run_unit_tests_1.suite)("activation and onboarding", () => {
    (0, run_unit_tests_1.test)("a new install sees the guide and no What's new card", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)();
        await (0, activation_1.initActivation)(context, VERSION, { isNewInstall: true });
        assert.ok((0, activation_1.guideVisible)());
        assert.strictEqual((0, activation_1.whatsNew)(VERSION), null);
        assert.deepStrictEqual((0, activation_1.guideSteps)().map(step => step.id), ["first_api_request", "first_ai_tool", "first_security_scan", "first_database_connection", "theme_chosen"]);
        assert.ok((0, activation_1.guideSteps)().every(step => !step.done && step.command.startsWith(command_registry_1.COMMAND_PREFIX)));
        assert.ok(state(context).reached.first_launch > 0);
    });
    (0, run_unit_tests_1.test)("every guide step and highlight opens a contributed command", () => {
        const contributed = new Set(manifest.contributes.commands.map((c) => c.command));
        for (const step of (0, activation_1.guideSteps)())
            assert.ok(contributed.has(step.command), step.command);
        for (const release of activation_1.RELEASE_HIGHLIGHTS) {
            for (const item of release.items)
                if (item.command)
                    assert.ok(contributed.has(command_registry_1.COMMAND_PREFIX + item.command), item.command);
        }
        assert.strictEqual(activation_1.RELEASE_HIGHLIGHTS[0].version, VERSION, "the newest highlights belong to this version");
    });
    (0, run_unit_tests_1.test)("an existing user skips the guide and sees what changed since their version", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)();
        await (0, activation_1.initActivation)(context, VERSION, { isNewInstall: false, previousVersion: "11.71.1" });
        assert.strictEqual((0, activation_1.guideVisible)(), false);
        const news = (0, activation_1.whatsNew)(VERSION);
        assert.ok(news);
        const titles = news.items.map(item => item.title).join(" | ");
        assert.ok(/themes/i.test(titles), "11.72.1 highlights are included");
        assert.ok(!/Database Client/.test(titles), "the version they already had is not repeated");
        await (0, activation_1.dismissWhatsNew)(VERSION, false);
        assert.strictEqual((0, activation_1.whatsNew)(VERSION), null, "shown once");
    });
    (0, run_unit_tests_1.test)("an update between two versions records where it came from", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)({ "devsnip.activation": { installedAt: 1, reached: {}, activeDays: [], lastVersion: "11.72.1" } });
        await (0, activation_1.initActivation)(context, VERSION, { isNewInstall: false });
        assert.strictEqual(state(context).updatedFrom, "11.72.1");
        assert.ok((0, activation_1.whatsNew)(VERSION).items.length > 0);
    });
    (0, run_unit_tests_1.test)("firsts are recorded once and steps tick off only on real actions", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)();
        const discovered = [];
        await (0, activation_1.initActivation)(context, VERSION, { isNewInstall: true, recordDiscovery: async (id) => { discovered.push(id); } });
        (0, activation_1.noteCommand)(`${command_registry_1.COMMAND_PREFIX}milestoneTracker`);
        (0, activation_1.noteCommand)("workbench.action.files.save");
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(state(context).reached.first_tool, undefined, "navigation is not a tool");
        (0, activation_1.noteToolRun)("ai", "error");
        (0, activation_1.noteToolRun)("web", "success");
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(state(context).reached.first_ai_tool, undefined, "a failed AI run or another section does not count");
        (0, activation_1.noteToolRun)("ai", "success");
        await (0, activation_1.reach)("first_api_request");
        await (0, activation_1.reach)("first_api_request");
        const firstAt = state(context).reached.first_api_request;
        await (0, activation_1.reach)("first_api_request");
        assert.strictEqual(state(context).reached.first_api_request, firstAt);
        assert.deepStrictEqual(discovered.sort(), ["ai_tool", "api_request"]);
        const done = (0, activation_1.guideSteps)().filter(step => step.done).map(step => step.id);
        assert.deepStrictEqual(done.sort(), ["first_ai_tool", "first_api_request"]);
        assert.ok((0, activation_1.activationSummary)().reached.includes("first_launch"));
    });
    (0, run_unit_tests_1.test)("the guide hides when every step is done, or when dismissed", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)();
        await (0, activation_1.initActivation)(context, VERSION, { isNewInstall: true });
        for (const id of ["first_api_request", "first_ai_tool", "first_security_scan", "first_database_connection"])
            await (0, activation_1.reach)(id);
        assert.ok((0, activation_1.guideVisible)());
        await (0, activation_1.noteThemeChosen)();
        assert.strictEqual((0, activation_1.guideVisible)(), false);
        const other = (0, vscode_stub_1.createExtensionContext)();
        await (0, activation_1.initActivation)(other, VERSION, { isNewInstall: true });
        await (0, activation_1.dismissGuide)();
        assert.strictEqual((0, activation_1.guideVisible)(), false);
    });
    (0, run_unit_tests_1.test)("corrupted state is repaired instead of throwing", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)({ "devsnip.activation": { installedAt: "x", reached: { first_tool: "yes", bogus: 5 }, activeDays: ["nope", "2026-01-02"] } });
        await (0, activation_1.initActivation)(context, VERSION, { isNewInstall: false });
        const saved = state(context);
        assert.strictEqual(typeof saved.installedAt, "number");
        assert.strictEqual(saved.reached.first_tool, undefined);
        assert.strictEqual(saved.reached.bogus, undefined);
        assert.ok(saved.activeDays.includes("2026-01-02") && !saved.activeDays.includes("nope"));
    });
});
(0, run_unit_tests_1.suite)("feature explorer milestone", () => {
    (0, run_unit_tests_1.test)("five different discoveries complete it, repeats do not count", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)();
        (0, milestoneTracker_1.setMilestoneContext)(context);
        const milestone = milestoneTracker_1.MILESTONES.find(m => m.id === "feature_explorer");
        assert.ok(milestone);
        await (0, milestoneTracker_1.recordDiscovery)(context, "api_request");
        await (0, milestoneTracker_1.recordDiscovery)(context, "api_request");
        await (0, milestoneTracker_1.recordDiscovery)(context, "not_a_feature");
        assert.deepStrictEqual((0, milestoneTracker_1.getUserStats)(context).discovered, ["api_request"]);
        for (const discovery of milestoneTracker_1.DISCOVERIES.slice(1, 5))
            await (0, milestoneTracker_1.recordDiscovery)(context, discovery);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual((0, milestoneTracker_1.milestoneProgress)(stats, milestone.id), 5);
        assert.ok(stats.completedMilestones.includes("feature_explorer"));
    });
});
(0, run_unit_tests_1.suite)("sidebar onboarding cards", () => {
    (0, run_unit_tests_1.test)("guide and What's new data reach the page, with a mount point", () => {
        const html = (0, tools_sidebar_1.renderToolsSidebar)({
            cspSource: "vscode-webview://test",
            scriptUri: "vscode-webview://test/media/tools-sidebar.js",
            codiconsUri: "vscode-webview://test/codicon.css",
            status: { badge: "🥉", level: "Bronze", points: 0, lifetimePoints: 0, nextLevel: "Silver", toNext: 500, progress: 0 },
            expanded: [],
            onboarding: {
                guide: [{ id: "first_api_request", title: "Send an API request", description: "d", command: `${command_registry_1.COMMAND_PREFIX}openGUI`, done: true }],
                whatsNew: { version: VERSION, items: [{ title: "</script><b>x</b>" }] }
            }
        });
        assert.ok(html.includes('<div id="onboarding"></div>'));
        assert.ok(!html.includes("</script><b>x</b>"), "card text cannot break out of the data block");
        const json = /<script type="application\/json" id="sidebar-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
        const data = JSON.parse(json);
        assert.strictEqual(data.onboarding.guide[0].done, true);
        assert.strictEqual(data.onboarding.whatsNew.items[0].title, "</script><b>x</b>");
    });
    (0, run_unit_tests_1.test)("the walkthrough is contributed with media that exists", () => {
        const walkthrough = manifest.contributes.walkthroughs.find((w) => w.id === "devsnip.getStarted");
        assert.ok(walkthrough);
        for (const step of walkthrough.steps) {
            assert.ok(step.media?.markdown, `${step.id} has media`);
            assert.ok(fs.existsSync(path.join(ROOT, step.media.markdown)), step.media.markdown);
        }
    });
});
//# sourceMappingURL=onboarding.unit.js.map