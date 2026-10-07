import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { COMMAND_PREFIX, isKnownCommand, registerLazyCommands, registerTrackedCommand } from "../../utils/command-registry";
import {
  activationSummary,
  dismissGuide,
  dismissWhatsNew,
  guideSteps,
  guideVisible,
  initActivation,
  noteCommand,
  noteThemeChosen,
  noteToolRun,
  reach,
  RELEASE_HIGHLIGHTS,
  whatsNew
} from "../../onboarding/activation";
import { DISCOVERIES, MILESTONES, getUserStats, milestoneProgress, recordDiscovery, setMilestoneContext } from "../../commands/milestoneTracker";
import { renderToolsSidebar } from "../../sidebar/tools-sidebar";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";
import * as vscode from "vscode";

const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = String(manifest.version);

function state(context: any): any {
  return context.globalState.get("devsnip.activation");
}

suite("lazy commands", () => {
  test("a placeholder loads the module once and replays the call with its arguments", async () => {
    const id = `${COMMAND_PREFIX}lazyTestReplay`;
    const subscriptions: { dispose(): unknown }[] = [];
    let loads = 0;
    const calls: unknown[][] = [];
    registerLazyCommands(subscriptions, [id], async () => {
      loads++;
      registerTrackedCommand(id, (...args: unknown[]) => { calls.push(args); return "real"; });
    });
    assert.ok(isKnownCommand(id), "lazy ids are known before they load, so webviews may run them");
    assert.strictEqual(loads, 0, "nothing loads during activation");
    assert.strictEqual(await vscode.commands.executeCommand(id, 1, "two"), "real");
    assert.strictEqual(await vscode.commands.executeCommand(id, 3), "real");
    assert.strictEqual(loads, 1);
    assert.deepStrictEqual(calls, [[1, "two"], [3]]);
    assert.ok(subscriptions.length >= 1, "placeholders are disposed with the extension");
  });

  test("a failed load puts the placeholders back so the next call retries", async () => {
    const id = `${COMMAND_PREFIX}lazyTestRetry`;
    let attempt = 0;
    registerLazyCommands([], [id], async () => {
      attempt++;
      if (attempt === 1) throw new Error("module failed to load");
      registerTrackedCommand(id, () => "loaded");
    });
    await assert.rejects(Promise.resolve(vscode.commands.executeCommand(id)), /module failed to load/);
    assert.strictEqual(await vscode.commands.executeCommand(id), "loaded");
    assert.strictEqual(attempt, 2);
  });
});

suite("activation and onboarding", () => {
  test("a new install sees the guide and no What's new card", async () => {
    const context = createExtensionContext();
    await initActivation(context, VERSION, { isNewInstall: true });
    assert.ok(guideVisible());
    assert.strictEqual(whatsNew(VERSION), null);
    assert.deepStrictEqual(guideSteps().map(step => step.id), ["first_api_request", "first_ai_tool", "first_security_scan", "first_database_connection", "theme_chosen"]);
    assert.ok(guideSteps().every(step => !step.done && step.command.startsWith(COMMAND_PREFIX)));
    assert.ok(state(context).reached.first_launch > 0);
  });

  test("every guide step and highlight opens a contributed command", () => {
    const contributed = new Set<string>(manifest.contributes.commands.map((c: { command: string }) => c.command));
    for (const step of guideSteps()) assert.ok(contributed.has(step.command), step.command);
    for (const release of RELEASE_HIGHLIGHTS) {
      for (const item of release.items) if (item.command) assert.ok(contributed.has(COMMAND_PREFIX + item.command), item.command);
    }
    assert.strictEqual(RELEASE_HIGHLIGHTS[0].version, VERSION, "the newest highlights belong to this version");
  });

  test("an existing user skips the guide and sees what changed since their version", async () => {
    const context = createExtensionContext();
    await initActivation(context, VERSION, { isNewInstall: false, previousVersion: "11.71.1" });
    assert.strictEqual(guideVisible(), false);
    const news = whatsNew(VERSION);
    assert.ok(news);
    const titles = news!.items.map(item => item.title).join(" | ");
    assert.ok(/themes/i.test(titles), "11.72.1 highlights are included");
    assert.ok(!/Database Client/.test(titles), "the version they already had is not repeated");
    await dismissWhatsNew(VERSION, false);
    assert.strictEqual(whatsNew(VERSION), null, "shown once");
  });

  test("a release with no highlights shows no What's New card", async () => {
    const empty = RELEASE_HIGHLIGHTS.find(release => release.items.length === 0);
    if (!empty) return;
    const index = RELEASE_HIGHLIGHTS.indexOf(empty);
    const previous = RELEASE_HIGHLIGHTS[index + 1];
    const context = createExtensionContext();
    await initActivation(context, empty.version, { isNewInstall: false, previousVersion: previous.version });
    assert.strictEqual(whatsNew(empty.version), null, `updating ${previous.version} -> ${empty.version} shows no card`);
  });

  test("an update between two versions records where it came from", async () => {
    const context = createExtensionContext({ "devsnip.activation": { installedAt: 1, reached: {}, activeDays: [], lastVersion: "11.72.1" } });
    await initActivation(context, VERSION, { isNewInstall: false });
    assert.strictEqual(state(context).updatedFrom, "11.72.1");
    assert.ok(whatsNew(VERSION)!.items.length > 0);
  });

  test("firsts are recorded once and steps tick off only on real actions", async () => {
    const context = createExtensionContext();
    const discovered: string[] = [];
    await initActivation(context, VERSION, { isNewInstall: true, recordDiscovery: async id => { discovered.push(id); } });
    noteCommand(`${COMMAND_PREFIX}milestoneTracker`);
    noteCommand("workbench.action.files.save");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(state(context).reached.first_tool, undefined, "navigation is not a tool");
    noteToolRun("ai", "error");
    noteToolRun("web", "success");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(state(context).reached.first_ai_tool, undefined, "a failed AI run or another section does not count");
    noteToolRun("ai", "success");
    await reach("first_api_request");
    await reach("first_api_request");
    const firstAt = state(context).reached.first_api_request;
    await reach("first_api_request");
    assert.strictEqual(state(context).reached.first_api_request, firstAt);
    assert.deepStrictEqual(discovered.sort(), ["ai_tool", "api_request"]);
    const done = guideSteps().filter(step => step.done).map(step => step.id);
    assert.deepStrictEqual(done.sort(), ["first_ai_tool", "first_api_request"]);
    assert.ok(activationSummary().reached.includes("first_launch"));
  });

  test("the guide hides when every step is done, or when dismissed", async () => {
    const context = createExtensionContext();
    await initActivation(context, VERSION, { isNewInstall: true });
    for (const id of ["first_api_request", "first_ai_tool", "first_security_scan", "first_database_connection"] as const) await reach(id);
    assert.ok(guideVisible());
    await noteThemeChosen();
    assert.strictEqual(guideVisible(), false);

    const other = createExtensionContext();
    await initActivation(other, VERSION, { isNewInstall: true });
    await dismissGuide();
    assert.strictEqual(guideVisible(), false);
  });

  test("corrupted state is repaired instead of throwing", async () => {
    const context = createExtensionContext({ "devsnip.activation": { installedAt: "x", reached: { first_tool: "yes", bogus: 5 }, activeDays: ["nope", "2026-01-02"] } });
    await initActivation(context, VERSION, { isNewInstall: false });
    const saved = state(context);
    assert.strictEqual(typeof saved.installedAt, "number");
    assert.strictEqual(saved.reached.first_tool, undefined);
    assert.strictEqual(saved.reached.bogus, undefined);
    assert.ok(saved.activeDays.includes("2026-01-02") && !saved.activeDays.includes("nope"));
  });
});

suite("feature explorer milestone", () => {
  test("five different discoveries complete it, repeats do not count", async () => {
    const context = createExtensionContext();
    setMilestoneContext(context);
    const milestone = MILESTONES.find(m => m.id === "feature_explorer")!;
    assert.ok(milestone);
    await recordDiscovery(context, "api_request");
    await recordDiscovery(context, "api_request");
    await recordDiscovery(context, "not_a_feature" as any);
    assert.deepStrictEqual(getUserStats(context).discovered, ["api_request"]);
    for (const discovery of DISCOVERIES.slice(1, 5)) await recordDiscovery(context, discovery);
    const stats = getUserStats(context);
    assert.strictEqual(milestoneProgress(stats, milestone.id), 5);
    assert.ok(stats.completedMilestones.includes("feature_explorer"));
  });
});

suite("sidebar onboarding cards", () => {
  test("guide and What's new data reach the page, with a mount point", () => {
    const html = renderToolsSidebar({
      cspSource: "vscode-webview://test",
      scriptUri: "vscode-webview://test/media/tools-sidebar.js",
      codiconsUri: "vscode-webview://test/codicon.css",
      status: { badge: "🥉", level: "Bronze", points: 0, lifetimePoints: 0, nextLevel: "Silver", toNext: 500, progress: 0 },
      expanded: [],
      onboarding: {
        guide: [{ id: "first_api_request", title: "Send an API request", description: "d", command: `${COMMAND_PREFIX}openGUI`, done: true }],
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

  test("the walkthrough is contributed with media that exists", () => {
    const walkthrough = manifest.contributes.walkthroughs.find((w: { id: string }) => w.id === "devsnip.getStarted");
    assert.ok(walkthrough);
    for (const step of walkthrough.steps) {
      assert.ok(step.media?.markdown, `${step.id} has media`);
      assert.ok(fs.existsSync(path.join(ROOT, step.media.markdown)), step.media.markdown);
    }
  });
});
