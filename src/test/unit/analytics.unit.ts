import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { AnalyticsClient, CapturedEvent, DeliveryResult, coerceProperty, sanitizeProperties, uuidv7 } from "../../analytics/client";
import { EVENT_CATALOG } from "../../analytics/events";
import { classifyInstall, featureCategory, initAnalytics, loadAnalyticsConfig, setAnalyticsClientForTests, shutdownAnalytics, track, trackCommand } from "../../analytics";
import { registerTrackedCommand, setCommandObserver } from "../../utils/command-registry";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

const MIN = 60_000;
const KEY = "phc_abcdefghijklmnopqrstuvwxyz0123456789";

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

function makeClient(options: { results?: DeliveryResult[]; flushAt?: number; maxQueue?: number } = {}) {
  let now = Date.parse("2026-09-29T10:00:00Z");
  const fake = fakeTransport(options.results);
  const invalid: string[] = [];
  const client = new AnalyticsClient({
    distinctId: "00000000-0000-4000-8000-000000000001",
    transport: fake.transport,
    commonProperties: { extension_version: "10.65.1", platform: "darwin" },
    now: () => now,
    flushAt: options.flushAt ?? 1000,
    maxQueue: options.maxQueue,
    onInvalid: message => invalid.push(message)
  });
  return { client, fake, invalid, advance: (ms: number) => { now += ms; } };
}

const names = (events: readonly CapturedEvent[]) => events.map(event => event.event);

suite("analytics privacy and validation", () => {
  test("free text, paths, URLs and emails are rejected by every string kind", () => {
    for (const value of ["/Users/alice/project/secret.ts", "C:\\Users\\bob", "https://internal.example.com/x", "alice@example.com", "a sentence with spaces", "", "x".repeat(65)]) {
      assert.strictEqual(coerceProperty("id", value), undefined, `id must reject ${JSON.stringify(value)}`);
    }
    assert.strictEqual(coerceProperty("id", "typescript"), "typescript");
    assert.strictEqual(coerceProperty("id", "install_command"), "install_command");
    assert.strictEqual(coerceProperty("version", "1.93.0-insider"), "1.93.0-insider");
    assert.strictEqual(coerceProperty("version", "latest build"), undefined);
    assert.strictEqual(coerceProperty("enum:success|error", "success"), "success");
    assert.strictEqual(coerceProperty("enum:success|error", "boom"), undefined);
    assert.deepStrictEqual(coerceProperty("id_list", ["python", "node", "node", "/etc/passwd"]), ["node", "python"]);
    assert.deepStrictEqual(coerceProperty("id_list", []), []);
  });

  test("numbers are finite, non-negative and rounded; booleans are real booleans", () => {
    assert.strictEqual(coerceProperty("count", 3.6), 4);
    assert.strictEqual(coerceProperty("count", -1), undefined);
    assert.strictEqual(coerceProperty("count", Number.NaN), undefined);
    assert.strictEqual(coerceProperty("count", "5"), undefined);
    assert.strictEqual(coerceProperty("ms", 12.4), 12);
    assert.strictEqual(coerceProperty("bool", "true"), undefined);
    assert.strictEqual(coerceProperty("bool", false), false);
  });

  test("properties that are not in the catalog are dropped, and the drop is reported", () => {
    const dropped: string[] = [];
    const clean = sanitizeProperties("snippet_created", {
      language: "typescript",
      line_count: 12,
      snippet_body: "const secret = 1;",
      file_path: "/home/me/a.ts"
    }, message => dropped.push(message));
    assert.deepStrictEqual(clean, { language: "typescript", line_count: 12 });
    assert.strictEqual(dropped.length, 2);
  });

  test("every catalogued property uses a known kind and every event is documented", () => {
    const docs = fs.readFileSync(path.resolve(__dirname, "../../../docs/ANALYTICS.md"), "utf8");
    for (const [event, spec] of Object.entries(EVENT_CATALOG)) {
      assert.ok(/^[a-z]+(_[a-z]+)+$/.test(event), `${event} must be snake_case object_verb`);
      assert.ok(docs.includes(`### \`${event}\``), `${event} is missing from docs/ANALYTICS.md`);
      for (const [property, field] of Object.entries(spec.properties as Record<string, { kind: string }>)) {
        assert.ok(/^[a-z]+(_[a-z]+)*$/.test(property), `${event}.${property} must be snake_case`);
        assert.ok(/^(id|id_list|version|count|ms|seconds|bool|enum:[a-z_]+(\|[a-z_]+)*)$/.test(field.kind), `${event}.${property} has an unknown kind ${field.kind}`);
        assert.ok(docs.includes(`\`${property}\``), `${event}.${property} is missing from docs/ANALYTICS.md`);
      }
    }
  });
});

suite("analytics client", () => {
  test("nothing is recorded while disabled", () => {
    const { client } = makeClient();
    client.track("feature_used", { feature: "jsonFormatter" });
    assert.strictEqual(client.pending().length, 0);
  });

  test("events carry the anonymous id, session, common properties and privacy flags", () => {
    const { client } = makeClient();
    client.setEnabled(true);
    client.track("feature_used", { feature: "jsonFormatter", category: "utilities", outcome: "success" });
    const [started, used] = client.pending();
    assert.deepStrictEqual(names(client.pending()), ["session_started", "feature_used"]);
    assert.strictEqual(started.properties.reason, "resumed");
    assert.strictEqual(used.properties.distinct_id, "00000000-0000-4000-8000-000000000001");
    assert.strictEqual(used.properties.$session_id, started.properties.$session_id);
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(used.properties.$session_id)), "session ids are UUIDv7");
    assert.strictEqual(used.properties.$process_person_profile, false);
    assert.strictEqual(used.properties.$geoip_disable, true);
    assert.strictEqual(used.properties.extension_version, "10.65.1");
    assert.strictEqual(used.properties.feature, "jsonFormatter");
    assert.strictEqual(used.timestamp, "2026-09-29T10:00:00.000Z");
    client.setEnabled(false);
  });

  test("an unknown event name is dropped, not sent", () => {
    const { client, invalid } = makeClient();
    client.setEnabled(true);
    client.track("user_email_seen" as any, {});
    assert.strictEqual(client.pending().length, 0);
    assert.strictEqual(invalid.length, 1);
    client.setEnabled(false);
  });

  test("a session ends after 30 idle minutes with duration and engaged time, and a new one starts", () => {
    const { client, advance } = makeClient();
    client.setEnabled(true);
    client.track("extension_activated", {});
    advance(1 * MIN); client.track("feature_used", { feature: "a" });
    advance(2 * MIN); client.track("feature_used", { feature: "b" });
    advance(10 * MIN); client.track("feature_used", { feature: "a" }); // gap > 5 min: not engaged time
    const firstSession = client.pending()[0].properties.$session_id;
    advance(31 * MIN);
    client.track("feature_used", { feature: "c" });

    const events = client.pending();
    assert.deepStrictEqual(names(events), ["session_started", "extension_activated", "feature_used", "feature_used", "feature_used", "session_ended", "session_started", "feature_used"]);
    assert.strictEqual(events[0].properties.reason, "activation");
    const ended = events[5].properties;
    assert.strictEqual(ended.reason, "idle");
    assert.strictEqual(ended.duration_s, 13 * 60);
    assert.strictEqual(ended.engaged_s, 3 * 60);
    assert.strictEqual(ended.interaction_count, 4);
    assert.strictEqual(ended.feature_count, 2);
    assert.strictEqual(ended.$session_id, firstSession, "session_ended belongs to the session it closes");
    assert.strictEqual(events[5].timestamp, new Date(Date.parse("2026-09-29T10:00:00Z") + 13 * MIN).toISOString(), "it is stamped at the last interaction, not when noticed");
    assert.notStrictEqual(events[7].properties.$session_id, firstSession);
    assert.strictEqual(events[6].properties.reason, "resumed");
    client.setEnabled(false);
  });

  test("events are batched and delivered when the batch size is reached", async () => {
    const { client, fake } = makeClient({ flushAt: 3 });
    client.setEnabled(true);
    client.track("feature_used", { feature: "a" });
    client.track("feature_used", { feature: "b" });
    await client.flush();
    assert.strictEqual(fake.batches.length, 1);
    assert.deepStrictEqual(names(fake.batches[0]), ["session_started", "feature_used", "feature_used"]);
    assert.strictEqual(client.pending().length, 0);
    client.setEnabled(false);
  });

  test("a failed delivery keeps the events and backs off; a rejected batch is dropped", async () => {
    const { client, fake, advance } = makeClient({ results: ["retry", "ok", "drop"] });
    client.setEnabled(true);
    client.track("feature_used", { feature: "a" });
    await client.flush();
    assert.strictEqual(client.pending().length, 2, "kept for retry");
    assert.strictEqual(client.consecutiveFailures(), 1);
    await client.flush();
    assert.strictEqual(fake.batches.length, 1, "no retry before the backoff expires");
    advance(31_000);
    await client.flush();
    assert.strictEqual(fake.batches.length, 2);
    assert.strictEqual(client.pending().length, 0);
    client.track("feature_used", { feature: "b" });
    await client.flush();
    assert.strictEqual(client.pending().length, 0, "a batch the server rejects is not retried forever");
    client.setEnabled(false);
  });

  test("the queue is bounded while offline", () => {
    const { client } = makeClient({ maxQueue: 10 });
    client.setEnabled(true);
    for (let i = 0; i < 50; i++) client.track("feature_used", { feature: `f${i}` });
    assert.strictEqual(client.pending().length, 10);
    assert.strictEqual(client.pending()[9].properties.feature, "f49", "the newest events are kept");
    client.setEnabled(false);
  });

  test("disabling discards everything not yet sent", () => {
    const { client } = makeClient();
    client.setEnabled(true);
    client.track("feature_used", { feature: "a" });
    client.setEnabled(false);
    assert.strictEqual(client.pending().length, 0);
  });

  test("shutdown ends the session and delivers what is queued", async () => {
    const { client, fake, advance } = makeClient();
    client.setEnabled(true);
    client.track("feature_used", { feature: "a" });
    advance(2 * MIN);
    client.track("feature_used", { feature: "a" });
    await client.shutdown(1000);
    const sent = fake.batches.flat();
    assert.deepStrictEqual(names(sent), ["session_started", "feature_used", "feature_used", "session_ended"]);
    assert.strictEqual(sent[3].properties.reason, "shutdown");
    assert.strictEqual(sent[3].properties.engaged_s, 120);
    client.setEnabled(false);
  });

  test("a throwing transport never escapes", async () => {
    const client = new AnalyticsClient({
      distinctId: "id",
      transport: { send: async () => { throw new Error("network down"); } },
      commonProperties: {}
    });
    client.setEnabled(true);
    client.track("feature_used", { feature: "a" });
    await client.flush();
    assert.strictEqual(client.pending().length, 2);
    client.setEnabled(false);
  });

  test("events that cannot be delivered at shutdown are kept for the next start, then restored once", async () => {
    const offline = makeClient({ results: ["retry", "retry", "retry"] });
    offline.client.setEnabled(true);
    offline.client.track("feature_used", { feature: "a" });
    await offline.client.shutdown(200);
    const left = offline.client.takePending();
    assert.deepStrictEqual(names(left), ["session_started", "feature_used", "session_ended"], "session_ended is not lost");
    assert.strictEqual(offline.client.pending().length, 0);
    assert.strictEqual(new Set(left.map(event => event.uuid)).size, 3, "every event has its own uuid for de-duplication");

    const next = makeClient();
    next.client.setEnabled(true);
    const persisted = JSON.parse(JSON.stringify(left));
    const foreign = { ...persisted[0], uuid: "x", properties: { ...persisted[0].properties, distinct_id: "someone-else" } };
    const bogus = { ...persisted[0], uuid: "y", event: "not_an_event" };
    assert.strictEqual(next.client.restore([...persisted, foreign, bogus, null, 42]), 3, "only this installation's catalogued events are restored");
    await next.client.flush();
    assert.deepStrictEqual(next.fake.batches[0].map(event => event.uuid), left.map(event => event.uuid), "original ids and timestamps are resent unchanged");
    assert.strictEqual(next.fake.batches[0][0].timestamp, left[0].timestamp);
    next.client.setEnabled(false);

    const disabled = makeClient();
    assert.strictEqual(disabled.client.restore(persisted), 0, "nothing is restored while analytics is off");
  });

  test("a session left open by a crash is closed as interrupted on the next start", () => {
    const first = makeClient();
    first.client.setEnabled(true);
    first.client.track("feature_used", { feature: "a" });
    first.advance(90_000);
    first.client.track("feature_used", { feature: "b" });
    const checkpoint = JSON.parse(JSON.stringify(first.client.snapshotState()));
    assert.ok(checkpoint.session, "the open session is part of the checkpoint");
    first.client.setEnabled(false); // the process "crashes" here: no session_ended was ever queued

    const next = makeClient();
    next.client.setEnabled(true);
    const result = next.client.recover(checkpoint);
    assert.deepStrictEqual(result, { events: 3, interrupted: true });
    const ended = next.client.pending().find(event => event.event === "session_ended")!;
    assert.strictEqual(ended.properties.reason, "interrupted");
    assert.strictEqual(ended.properties.$session_id, checkpoint.session.id, "it closes the old session, not a new one");
    assert.strictEqual(ended.properties.duration_s, 90);
    assert.strictEqual(ended.timestamp, new Date(checkpoint.session.lastInteraction).toISOString());
    next.client.setEnabled(false);
  });

  test("UUIDv7 ids embed their timestamp and sort by time", () => {
    const a = uuidv7(Date.parse("2026-01-01T00:00:00Z"));
    const b = uuidv7(Date.parse("2026-01-01T00:00:01Z"));
    assert.ok(a < b);
    assert.strictEqual(parseInt(a.replace(/-/g, "").slice(0, 12), 16), Date.parse("2026-01-01T00:00:00Z"));
  });
});

suite("analytics wiring", () => {
  test("every command reports its outcome and duration, and a throwing observer cannot break it", async () => {
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

  test("feature_used names the feature, its area, and whether it is the first use", () => {
    const { client } = makeClient();
    client.setEnabled(true);
    setAnalyticsClientForTests(client, new Set(["jsonFormatter"]));
    trackCommand("sayaib.hue-console.jsonFormatter", "success", 12);
    trackCommand("sayaib.hue-console.createCustomSnippet", "error", 5);
    trackCommand("sayaib.hue-console.createCustomSnippet", "success", 5);
    const used = client.pending().filter(event => event.event === "feature_used").map(event => event.properties);
    assert.deepStrictEqual(used.map(p => [p.feature, p.category, p.outcome, p.first_use]), [
      ["jsonFormatter", "utilities", "success", false],
      ["createCustomSnippet", "snippets", "error", true],
      ["createCustomSnippet", "snippets", "success", false]
    ]);
    setAnalyticsClientForTests(undefined);
    client.setEnabled(false);
  });

  test("every contributed command maps to a feature area", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const categories = new Set(["core", "snippets", "api", "ai", "rag", "data", "security", "devops", "utilities", "dependencies", "progress"]);
    const expect: Record<string, string> = {
      openGUI: "api", tokenCounter: "ai", ragHub: "rag", chunkingTester: "rag", securityAudit: "security", schemaViewer: "data",
      devopsGenerator: "devops", observabilityAnalyze: "devops", dependencyManager: "dependencies", milestoneTracker: "progress",
      regexBuilder: "utilities", showSnippets: "snippets", readmeManager: "core", listAndRemoveConsoleLogs: "core"
    };
    for (const entry of manifest.contributes.commands) {
      const feature = entry.command.replace("sayaib.hue-console.", "");
      const category = featureCategory(feature);
      assert.ok(categories.has(category), `${feature} -> ${category}`);
      if (expect[feature]) assert.strictEqual(category, expect[feature], feature);
    }
  });

  test("track() before initialisation, or with no key built in, does nothing and never throws", () => {
    setAnalyticsClientForTests(undefined);
    assert.doesNotThrow(() => track("feature_used", { feature: "a" }));
    assert.doesNotThrow(() => trackCommand("sayaib.hue-console.a", "success", 1));
  });

  test("new installs, updates and existing pre-analytics users are told apart", () => {
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: false }, "10.66.0"), { installType: "new", firstRun: true });
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: true, anonymousId: "id", lastVersion: "10.66.0" }, "10.66.0"), { installType: "returning", firstRun: false });
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: true, anonymousId: "id", lastVersion: "10.65.1" }, "10.66.0"), { installType: "updated", firstRun: false, previousVersion: "10.65.1" });
    // A user with points/snippets from before analytics existed is not a new install.
    assert.deepStrictEqual(classifyInstall({ hadDevSnipState: true }, "10.66.0"), { installType: "updated", firstRun: false, previousVersion: undefined });
  });

  test("builds are tagged with their environment so test data can be filtered out", () => {
    const withEnv = (environment?: string) => () => JSON.stringify({ posthogKey: KEY, ...(environment ? { environment } : {}) });
    assert.strictEqual(loadAnalyticsConfig("/x", {}, withEnv())?.environment, "production");
    assert.strictEqual(loadAnalyticsConfig("/x", {}, withEnv("test"))?.environment, "test");
    assert.strictEqual(loadAnalyticsConfig("/x", {}, withEnv("bogus"))?.environment, "production");
    assert.strictEqual(loadAnalyticsConfig("/x", { DEVSNIP_ANALYTICS_ENVIRONMENT: "staging" }, withEnv("test"))?.environment, "staging");
  });

  test("when the network is gone at shutdown, the checkpoint file carries the session end to the next start", async () => {
    const vscode = require("vscode");
    const os = require("os");
    const axios = require("axios");
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-analytics-"));
    const previous = process.env.DEVSNIP_POSTHOG_KEY;
    process.env.DEVSNIP_POSTHOG_KEY = KEY;
    const originalPost = axios.post;
    const sent: any[] = [];
    const context = { ...createExtensionContext(), extensionMode: vscode.ExtensionMode.Production, extension: { packageJSON: { version: "10.66.0" } }, globalStorageUri: { fsPath: storage } };
    try {
      axios.post = async () => { throw new Error("Canceled"); }; // what VS Code's proxy does while quitting
      initAnalytics(context, Date.now());
      track("feature_used", { feature: "jsonFormatter" });
      await shutdownAnalytics();
      const file = path.join(storage, "analytics-checkpoint.json");
      assert.ok(fs.existsSync(file), "undelivered events are saved locally");
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.deepStrictEqual(saved.pending.map((event: CapturedEvent) => event.event), ["session_started", "extension_activated", "feature_used", "session_ended"]);
      assert.strictEqual(saved.session, undefined, "the session was closed before saving");

      axios.post = async (_url: string, body: any) => { sent.push(body); return { status: 200 }; };
      initAnalytics(context, Date.now());
      await shutdownAnalytics();
      const events = sent.flatMap(body => body.batch.map((event: CapturedEvent) => event.event));
      assert.deepStrictEqual(events.slice(0, 4), ["session_started", "extension_activated", "feature_used", "session_ended"], "the previous run's events are delivered first");
      assert.strictEqual(sent[0].batch[1].properties.install_type, "new");
      assert.ok(events.includes("session_ended") && events.filter(e => e === "extension_activated").length === 2);
      assert.ok(!fs.existsSync(file), "the checkpoint is removed once delivered");
    } finally {
      axios.post = originalPost;
      if (previous === undefined) delete process.env.DEVSNIP_POSTHOG_KEY; else process.env.DEVSNIP_POSTHOG_KEY = previous;
      fs.rmSync(storage, { recursive: true, force: true });
    }
  });

  test("only a well-formed project key and an https host are accepted", () => {
    const file = (content?: string) => () => content;
    assert.deepStrictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: KEY, posthogHost: "https://eu.i.posthog.com/" }))), { key: KEY, host: "https://eu.i.posthog.com", environment: "production" });
    assert.deepStrictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: KEY }))), { key: KEY, host: "https://us.i.posthog.com", environment: "production" });
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file()), undefined, "no file: analytics off");
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file("{broken")), undefined);
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: "phx_personalkeypersonalkeypersonal" }))), undefined, "a personal key is refused");
    assert.strictEqual(loadAnalyticsConfig("/x", {}, file(JSON.stringify({ posthogKey: KEY, posthogHost: "http://insecure.example.com" }))), undefined);
    assert.deepStrictEqual(loadAnalyticsConfig("/x", { DEVSNIP_POSTHOG_KEY: KEY, DEVSNIP_POSTHOG_HOST: "https://ph.example.com" }, file()), { key: KEY, host: "https://ph.example.com", environment: "production" });
  });

  test("the extension sends nothing when running from source, when VS Code telemetry is not 'all', or when the setting is off", async () => {
    const vscode = require("vscode");
    const previous = process.env.DEVSNIP_POSTHOG_KEY;
    process.env.DEVSNIP_POSTHOG_KEY = KEY;
    const sent: unknown[] = [];
    const axios = require("axios");
    const originalPost = axios.post;
    axios.post = async (...args: unknown[]) => { sent.push(args); return { status: 200 }; };
    const production = () => ({ ...createExtensionContext(), extensionMode: vscode.ExtensionMode.Production, extension: { packageJSON: { version: "10.65.1" } } });
    const run = async (context: any, config: Record<string, unknown>, telemetryEnabled = true) => {
      vscode.workspace.configurationValues = config;
      vscode.env.isTelemetryEnabled = telemetryEnabled;
      sent.length = 0;
      initAnalytics(context, Date.now());
      track("feature_used", { feature: "jsonFormatter" });
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
      assert.strictEqual(body.batch[1].properties.install_type, "new");
      assert.strictEqual(body.batch[1].properties.environment, "production");
      assert.deepStrictEqual(body.batch.map((event: CapturedEvent) => event.event), ["session_started", "extension_activated", "feature_used", "session_ended"]);
    } finally {
      axios.post = originalPost;
      vscode.workspace.configurationValues = {};
      vscode.env.isTelemetryEnabled = true;
      if (previous === undefined) delete process.env.DEVSNIP_POSTHOG_KEY; else process.env.DEVSNIP_POSTHOG_KEY = previous;
    }
  });
});
