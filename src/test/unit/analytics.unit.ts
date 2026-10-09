import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { AnalyticsClient, CapturedEvent, DeliveryResult, localDay } from "../../analytics/client";
import { analyticsId, classifyInstall, initAnalytics, loadAnalyticsConfig, setAnalyticsClientForTests, shutdownAnalytics, toolSection, trackCommand, trackToolUsed } from "../../analytics";
import { registerTrackedCommand, setCommandObserver } from "../../utils/command-registry";
import { createExtensionContext } from "./vscode-stub";
import { NAV } from "../../toolkits/layout";
import { TOOLKIT_COMMANDS } from "../../toolkits/commands";
import { suite, test } from "./run-unit-tests";

const MIN = 60_000;
const KEY = "phc_abcdefghijklmnopqrstuvwxyz0123456789";
const ID = "00000000-0000-4000-8000-000000000001";

function fakeTransport(results: DeliveryResult[] = []) {
  const batches: CapturedEvent[][] = [];
  return {
    batches,
    transport: {
      async send(batch: CapturedEvent[]): Promise<DeliveryResult> {
        batches.push(batch.slice());
        return results.length ? results.shift()! : "ok";
      }
    }
  };
}

function makeClient(options: { results?: DeliveryResult[]; flushAt?: number; maxQueue?: number; lastActiveDay?: string; start?: string; previousId?: string; onMerged?: (id: string) => void } = {}) {
  let now = Date.parse(options.start ?? "2026-09-29T10:00:00");
  const fake = fakeTransport(options.results);
  const days: string[] = [];
  const client = new AnalyticsClient({
    distinctId: ID,
    transport: fake.transport,
    commonProperties: { extension_version: "11.76.3", environment: "production" },
    lastActiveDay: options.lastActiveDay,
    previousId: options.previousId,
    onMerged: options.onMerged,
    onActiveDay: day => days.push(day),
    now: () => now,
    flushAt: options.flushAt ?? 1000,
    maxQueue: options.maxQueue
  });
  return { client, fake, days, advance: (ms: number) => { now += ms; } };
}

const names = (events: readonly CapturedEvent[]) => events.map(event => event.event);

suite("analytics client", () => {
  test("nothing is recorded while disabled", () => {
    const { client } = makeClient();
    client.toolOpened("jsonFormatter", "text");
    client.toolUsed("jsonFormatter", "text");
    client.markActive();
    assert.strictEqual(client.pending().length, 0);
  });

  test("events carry only the anonymous id, the tool, its section, the version and the environment", () => {
    const { client } = makeClient({ lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    client.toolOpened("jsonFormatter", "text");
    client.toolUsed("jsonFormatter", "text");
    const [opened, used] = client.pending();
    assert.deepStrictEqual(names(client.pending()), ["tool_opened", "tool_used"]);
    assert.deepStrictEqual(opened.properties, {
      extension_version: "11.76.3", environment: "production", tool: "jsonFormatter", section: "text", distinct_id: ID, $lib: "devsnip-pro-vscode"
    });
    // Geography comes from PostHog's own GeoIP lookup, so it must not be switched off.
    assert.ok(!("$geoip_disable" in opened.properties));
    assert.ok(!("$process_person_profile" in opened.properties), "persons are kept so unique and returning users can be counted");
    assert.notStrictEqual(opened.uuid, used.uuid);
    assert.strictEqual(opened.timestamp, new Date(Date.parse("2026-09-29T10:00:00")).toISOString());
  });

  test("tool ids that could carry text, paths or URLs are refused; odd sections are reported as other", () => {
    const { client } = makeClient({ lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    for (const bad of ["", "/Users/me/secret.txt", "https://example.com/x", "a b", "x".repeat(65), "1abc"]) client.toolOpened(bad, "text");
    assert.strictEqual(client.pending().length, 0);
    client.toolOpened("jsonFormatter", "Not A Section");
    assert.strictEqual(client.pending()[0].properties.section, "other");
  });

  test("extension_active is sent once per local day, across restarts and past midnight", () => {
    const first = makeClient();
    first.client.setEnabled(true);
    first.client.markActive();
    first.client.toolOpened("jsonFormatter", "text");
    assert.deepStrictEqual(names(first.client.pending()), ["extension_active", "tool_opened"]);
    assert.deepStrictEqual(first.days, ["2026-09-29"]);

    // A restart later the same day sends nothing new.
    const again = makeClient({ lastActiveDay: "2026-09-29", start: "2026-09-29T18:00:00" });
    again.client.setEnabled(true);
    assert.strictEqual(again.client.pending().length, 0);

    // VS Code left open past midnight: the next tool event also marks the new day.
    again.advance(7 * 60 * MIN);
    again.client.toolOpened("jwtDecoder", "security");
    assert.deepStrictEqual(names(again.client.pending()), ["extension_active", "tool_opened"]);
    assert.deepStrictEqual(again.days, ["2026-09-30"]);
    assert.strictEqual(localDay(Date.parse("2026-09-30T01:00:00")), "2026-09-30");
  });

  test("the same tool opened twice in a moment counts once; used counts once per five minutes per tool", () => {
    const { client, advance } = makeClient({ lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    client.toolOpened("jsonFormatter", "text");
    advance(500);
    client.toolOpened("jsonFormatter", "text"); // a double click or a command that re-runs itself
    advance(3000);
    client.toolOpened("jsonFormatter", "text"); // opened again on purpose
    assert.strictEqual(client.pending().filter(e => e.event === "tool_opened").length, 2);

    for (let i = 0; i < 30; i++) { client.toolUsed("regexTester", "text"); advance(5000); } // live results on every keystroke
    client.toolUsed("jwtDecoder", "security");
    assert.deepStrictEqual(client.pending().filter(e => e.event === "tool_used").map(e => e.properties.tool), ["regexTester", "jwtDecoder"]);
    advance(5 * MIN);
    client.toolUsed("regexTester", "text");
    assert.strictEqual(client.pending().filter(e => e.event === "tool_used").length, 3);
  });

  test("events are batched and delivered when the batch size is reached", async () => {
    const { client, fake } = makeClient({ flushAt: 3, lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    client.toolOpened("a1", "text");
    client.toolOpened("a2", "text");
    assert.strictEqual(fake.batches.length, 0);
    client.toolOpened("a3", "text");
    await client.flush();
    assert.strictEqual(fake.batches.length, 1);
    assert.strictEqual(fake.batches[0].length, 3);
    assert.strictEqual(client.pending().length, 0);
  });

  test("a failed delivery keeps the events and backs off; a rejected batch is dropped", async () => {
    const { client, fake, advance } = makeClient({ results: ["retry", "ok"], lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    client.toolOpened("a1", "text");
    await client.flush();
    assert.strictEqual(client.pending().length, 1, "kept for a retry");
    await client.flush();
    assert.strictEqual(fake.batches.length, 1, "no retry before the back-off ends");
    advance(MIN + 1);
    await client.flush();
    assert.strictEqual(client.pending().length, 0);

    const rejected = makeClient({ results: ["drop"], lastActiveDay: "2026-09-29" });
    rejected.client.setEnabled(true);
    rejected.client.toolOpened("a1", "text");
    await rejected.client.flush();
    assert.strictEqual(rejected.client.pending().length, 0);
  });

  test("the queue is bounded while offline, disabling discards it, and a throwing transport never escapes", async () => {
    const { client } = makeClient({ maxQueue: 5, lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    for (let i = 0; i < 12; i++) client.toolOpened(`tool${i}`, "text");
    assert.deepStrictEqual(client.pending().map(e => e.properties.tool), ["tool7", "tool8", "tool9", "tool10", "tool11"]);
    client.setEnabled(false);
    assert.strictEqual(client.pending().length, 0);

    const broken = new AnalyticsClient({ distinctId: ID, commonProperties: {}, lastActiveDay: localDay(Date.now()), transport: { send: async () => { throw new Error("offline"); } } });
    broken.setEnabled(true);
    broken.toolOpened("a1", "text");
    await assert.doesNotReject(() => broken.flush());
    assert.strictEqual(broken.pending().length, 1);
    broken.setEnabled(false);
  });

  test("saved events are restored once, and only this installation's known events", () => {
    const { client } = makeClient({ lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    const good = { uuid: "u1", event: "tool_used", timestamp: "2026-09-28T10:00:00.000Z", properties: { distinct_id: ID, tool: "jsonFormatter" } };
    const restored = client.restore([
      good,
      { ...good, uuid: "u2", properties: { distinct_id: "someone-else" } },
      { ...good, uuid: "u3", event: "feature_used" },
      "junk", null
    ]);
    assert.strictEqual(restored, 1);
    assert.deepStrictEqual(client.pending().map(e => e.uuid), ["u1"]);
    assert.strictEqual(client.restore("not a list"), 0);
  });

  test("an older id is merged into the current one once, before anything else, and its saved events are still accepted", () => {
    const merged: string[] = [];
    const { client, advance } = makeClient({ previousId: "old-profile-id", onMerged: id => merged.push(id) });
    client.setEnabled(true);
    client.setEnabled(false);
    client.setEnabled(true);
    advance(24 * 60 * MIN);
    client.toolOpened("jsonFormatter", "text");
    const [identify] = client.pending().filter(event => event.event === "$identify");
    assert.deepStrictEqual(merged, ["old-profile-id"]);
    assert.strictEqual(identify, undefined, "already sent before the client was disabled; never sent twice");

    const fresh = makeClient({ previousId: "old-profile-id" });
    fresh.client.setEnabled(true);
    assert.deepStrictEqual(names(fresh.client.pending()), ["$identify", "extension_active"]);
    assert.strictEqual(fresh.client.pending()[0].properties.$anon_distinct_id, "old-profile-id");
    assert.strictEqual(fresh.client.pending()[0].properties.distinct_id, ID);
    const saved = { uuid: "u1", event: "tool_used", timestamp: "2026-09-28T10:00:00.000Z", properties: { distinct_id: "old-profile-id", tool: "jsonFormatter" } };
    assert.strictEqual(fresh.client.restore([saved], ["old-profile-id"]), 1);

    const same = makeClient({ previousId: ID });
    same.client.setEnabled(true);
    assert.deepStrictEqual(names(same.client.pending()), ["extension_active"], "nothing to merge when the ids are the same");
  });
});

suite("analytics wiring", () => {
  test("every command reports its outcome, and a throwing observer cannot break it", async () => {
    const seen: string[] = [];
    setCommandObserver((id, outcome) => seen.push(`${id}:${outcome}`));
    const vscode = require("vscode");
    registerTrackedCommand("sayaib.hue-console.analyticsOk", () => 42);
    registerTrackedCommand("sayaib.hue-console.analyticsAsync", async () => "done");
    registerTrackedCommand("sayaib.hue-console.analyticsFails", async () => { throw new Error("boom"); });
    assert.strictEqual(await vscode.commands.executeCommand("sayaib.hue-console.analyticsOk"), 42);
    assert.strictEqual(await vscode.commands.executeCommand("sayaib.hue-console.analyticsAsync"), "done");
    await assert.rejects(() => vscode.commands.executeCommand("sayaib.hue-console.analyticsFails"), /boom/);
    assert.deepStrictEqual(seen, [
      "sayaib.hue-console.analyticsOk:success",
      "sayaib.hue-console.analyticsAsync:success",
      "sayaib.hue-console.analyticsFails:error"
    ]);
    setCommandObserver(() => { throw new Error("observer bug"); });
    assert.strictEqual(await vscode.commands.executeCommand("sayaib.hue-console.analyticsOk"), 42);
    setCommandObserver(undefined);
  });

  test("only tools that opened successfully are reported; hubs, search and progress pages are not tools", () => {
    const { client } = makeClient({ lastActiveDay: "2026-09-29" });
    client.setEnabled(true);
    setAnalyticsClientForTests(client);
    trackCommand("sayaib.hue-console.jsonFormatter", "success");
    trackCommand("sayaib.hue-console.createCustomSnippet", "error");
    for (const notATool of ["milestoneTracker", "searchTools", "advancedToolsHub", "ragHub", "getStarted", "chooseTheme"]) trackCommand(`sayaib.hue-console.${notATool}`, "success");
    trackToolUsed("openGUI");
    trackToolUsed("milestoneTracker");
    assert.deepStrictEqual(client.pending().map(e => [e.event, e.properties.tool, e.properties.section]), [
      ["tool_opened", "jsonFormatter", "text"],
      ["tool_used", "openGUI", "api"]
    ]);
    setAnalyticsClientForTests(undefined);
    client.setEnabled(false);
  });

  test("every tool in the sidebar and every toolkit command has a section, and so do the tool_used call sites", () => {
    const sections = new Set<string>(NAV.map(s => s.id));
    for (const section of NAV) for (const entry of section.entries) assert.ok(sections.has(toolSection(entry.command) ?? ""), entry.command);
    for (const command of TOOLKIT_COMMANDS) assert.ok(sections.has(toolSection(command.command) ?? ""), command.command);
    const callSites = ["openGUI", "databaseClient", "endpointSecurityScan", "securityAudit", "cloudSecurityAudit", "dependencyAudit", "dependencyManager", "createCustomSnippet", "readmeManager", "openCodeIntegration"];
    for (const tool of callSites) assert.ok(toolSection(tool), `${tool} is not a tool, so trackToolUsed would ignore it`);
    assert.strictEqual(toolSection("sayaib.hue-console.openGUI"), "api", "prefixed ids work too");
  });

  test("tracking before initialisation, or with no key built in, does nothing and never throws", () => {
    setAnalyticsClientForTests(undefined);
    assert.doesNotThrow(() => trackCommand("sayaib.hue-console.jsonFormatter", "success"));
    assert.doesNotThrow(() => trackToolUsed("jsonFormatter"));
  });

  test("new installs, updates and existing users are told apart (for onboarding)", () => {
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: false }, "10.66.0"), { installType: "new", firstRun: true });
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: true, anonymousId: "id", lastVersion: "10.66.0" }, "10.66.0"), { installType: "returning", firstRun: false });
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: true, anonymousId: "id", lastVersion: "10.65.1" }, "10.66.0"), { installType: "updated", firstRun: false, previousVersion: "10.65.1" });
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: true }, "10.66.0"), { installType: "updated", firstRun: false, previousVersion: undefined });
  });

  test("only a well-formed project key and an https host are accepted, and builds carry their environment", () => {
    const file = (content?: string) => () => content;
    assert.deepStrictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: KEY, posthogHost: "https://eu.i.posthog.com/" }))), { key: KEY, host: "https://eu.i.posthog.com", environment: "production" });
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file()), undefined, "no file: analytics off");
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file("{broken")), undefined);
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: "phx_personalkeypersonalkeypersonal" }))), undefined, "a personal key is refused");
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: KEY, posthogHost: "http://insecure.example.com" }))), undefined);
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: KEY, environment: "test" })))?.environment, "test");
    assert.strictEqual(loadAnalyticsConfig("/x", { DEVSNIP_ANALYTICS_ENVIRONMENT: "staging" }, file(JSON.stringify({ posthogKey: KEY })))?.environment, "staging");
  });

  test("the anonymous id survives restarts, and events that could not be sent at shutdown go out on the next start", async () => {
    const vscode = require("vscode");
    const os = require("os");
    const axios = require("axios");
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-analytics-"));
    fs.writeFileSync(path.join(storage, "analytics-checkpoint.json"), "{}"); // left by an older version
    const previous = process.env.DEVSNIP_POSTHOG_KEY;
    process.env.DEVSNIP_POSTHOG_KEY = KEY;
    const originalPost = axios.post;
    const sent: any[] = [];
    const context = {
      ...createExtensionContext({ "devsnip.analytics.anonymousId": ID, "devsnip.analytics.usedFeatures": ["x"] }),
      extensionMode: vscode.ExtensionMode.Production, extension: { packageJSON: { version: "11.76.3" } }, globalStorageUri: { fsPath: storage }
    };
    try {
      axios.post = async () => { throw new Error("Canceled"); }; // what VS Code's proxy does while quitting
      initAnalytics(context);
      trackCommand("sayaib.hue-console.jsonFormatter", "success");
      await shutdownAnalytics();
      const file = path.join(storage, "analytics-pending.json");
      assert.deepStrictEqual(names(JSON.parse(fs.readFileSync(file, "utf8"))), ["extension_active", "tool_opened"], "undelivered events are saved locally");
      assert.ok(!fs.existsSync(path.join(storage, "analytics-checkpoint.json")), "the old checkpoint file is cleaned up");
      assert.strictEqual(context.globalState.get("devsnip.analytics.usedFeatures"), undefined, "old state is cleaned up");

      axios.post = async (_url: string, body: any) => { sent.push(body); return { status: 200 }; };
      initAnalytics(context);
      await shutdownAnalytics();
      const events: CapturedEvent[] = sent.flatMap(body => body.batch);
      assert.deepStrictEqual(names(events), ["extension_active", "tool_opened"], "the saved events, and no second extension_active the same day");
      assert.ok(events.every(event => event.properties.distinct_id === ID), "an existing user keeps their id, so they are not counted as new");
      assert.ok(!fs.existsSync(file), "nothing is left once delivered");
    } finally {
      axios.post = originalPost;
      if (previous === undefined) delete process.env.DEVSNIP_POSTHOG_KEY; else process.env.DEVSNIP_POSTHOG_KEY = previous;
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });

  test("one id per machine: every profile and reinstall is the same user, and the old per-profile id is merged once", async () => {
    const vscode = require("vscode");
    const axios = require("axios");
    const previous = process.env.DEVSNIP_POSTHOG_KEY;
    process.env.DEVSNIP_POSTHOG_KEY = KEY;
    const originalPost = axios.post;
    const sent: CapturedEvent[] = [];
    axios.post = async (_url: string, body: any) => { sent.push(...body.batch); return { status: 200 }; };
    const MACHINE = "a".repeat(64);
    const production = (state: Record<string, unknown> = {}) => ({ ...createExtensionContext(state), extensionMode: vscode.ExtensionMode.Production, extension: { packageJSON: { version: "11.76.5" } } });
    const run = async (context: any) => {
      sent.length = 0;
      initAnalytics(context);
      await shutdownAnalytics();
      return sent.slice();
    };
    try {
      vscode.env.machineId = MACHINE;
      const userId = analyticsId(MACHINE)!;
      assert.match(userId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.ok(!userId.replace(/-/g, "").startsWith(MACHINE.slice(0, 8)) && !MACHINE.includes(userId.replace(/-/g, "")), "VS Code's machine id itself is never sent");
      assert.strictEqual(analyticsId(MACHINE.toUpperCase()), userId);
      assert.strictEqual(analyticsId("someValue.machineId"), undefined);
      assert.strictEqual(analyticsId(undefined), undefined);

      const profileA = production({ "devsnip.analytics.anonymousId": ID });
      const first = await run(profileA);
      assert.deepStrictEqual(names(first), ["$identify", "extension_active"]);
      assert.ok(first.every(event => event.properties.distinct_id === userId));
      assert.strictEqual(first[0].properties.$anon_distinct_id, ID, "the id earlier versions sent is merged into the machine id");
      await profileA.globalState.update("devsnip.analytics.lastActiveDay", undefined);
      assert.deepStrictEqual(names(await run(profileA)), ["extension_active"], "the merge is sent once");

      const profileB = production({ "devsnip.analytics.anonymousId": "00000000-0000-4000-8000-000000000002" });
      const second = await run(profileB);
      assert.ok(second.every(event => event.properties.distinct_id === userId), "another profile on the same machine is the same user");
      assert.strictEqual(second[0].properties.$anon_distinct_id, "00000000-0000-4000-8000-000000000002");

      const fresh = production();
      assert.deepStrictEqual(names(await run(fresh)), ["extension_active"], "a new install has no earlier id to merge");
      assert.ok(fresh.globalState.get("devsnip.analytics.anonymousId"), "the local id is still created for onboarding");

      vscode.env.machineId = undefined;
      const noMachine = production({ "devsnip.analytics.anonymousId": ID });
      const fallback = await run(noMachine);
      assert.deepStrictEqual(names(fallback), ["extension_active"]);
      assert.strictEqual(fallback[0].properties.distinct_id, ID, "without a machine id the stored id is used, unchanged");
    } finally {
      vscode.env.machineId = undefined;
      axios.post = originalPost;
      if (previous === undefined) delete process.env.DEVSNIP_POSTHOG_KEY; else process.env.DEVSNIP_POSTHOG_KEY = previous;
    }
  });

  test("the extension sends nothing when running from source, when VS Code telemetry is not 'all', or when the setting is off", async () => {
    const vscode = require("vscode");
    const previous = process.env.DEVSNIP_POSTHOG_KEY;
    process.env.DEVSNIP_POSTHOG_KEY = KEY;
    const sent: unknown[] = [];
    const axios = require("axios");
    const originalPost = axios.post;
    axios.post = async (...args: unknown[]) => { sent.push(args); return { status: 200 }; };
    const production = () => ({ ...createExtensionContext(), extensionMode: vscode.ExtensionMode.Production, extension: { packageJSON: { version: "11.76.3" } } });
    const run = async (context: any, config: Record<string, unknown>, telemetryEnabled = true) => {
      vscode.workspace.configurationValues = config;
      vscode.env.isTelemetryEnabled = telemetryEnabled;
      sent.length = 0;
      initAnalytics(context);
      trackCommand("sayaib.hue-console.jsonFormatter", "success");
      await shutdownAnalytics();
      return sent.length;
    };
    try {
      assert.strictEqual(await run({ ...production(), extensionMode: vscode.ExtensionMode.Development }, {}), 0, "F5 / source builds never send");
      assert.strictEqual(await run(production(), { "telemetry.telemetryLevel": "error" }), 0, "telemetry level error");
      assert.strictEqual(await run(production(), {}, false), 0, "VS Code telemetry off");
      assert.strictEqual(await run(production(), { "devsnip.analytics.enabled": false }), 0, "extension setting off");
      assert.strictEqual(await run(production(), {}), 1, "all conditions met: one batch is sent");
      const [url, body] = sent[0] as [string, any];
      assert.strictEqual(url, "https://us.i.posthog.com/batch/");
      assert.strictEqual(body.api_key, KEY);
      assert.ok(!Number.isNaN(Date.parse(body.sent_at)), "sent_at lets PostHog correct clock skew");
      assert.deepStrictEqual(names(body.batch), ["extension_active", "tool_opened"]);
      assert.strictEqual(body.batch[1].properties.environment, "production");
    } finally {
      axios.post = originalPost;
      vscode.workspace.configurationValues = {};
      vscode.env.isTelemetryEnabled = true;
      if (previous === undefined) delete process.env.DEVSNIP_POSTHOG_KEY; else process.env.DEVSNIP_POSTHOG_KEY = previous;
    }
  });
});
