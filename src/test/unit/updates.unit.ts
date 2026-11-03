import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  builtInPolicy,
  BUILT_IN_GRACE_MS,
  checkIntervalMs,
  compareSemver,
  DAY,
  engineSatisfied,
  FAILURE_BACKOFF_MS,
  fetchLatest,
  HOUR,
  isCheckDue,
  isNewer,
  markInstalled,
  markNotified,
  MARKETPLACE_FLAGS,
  normalizeState,
  parseMarketplaceResponse,
  parseOpenVsxResponse,
  present,
  recordCheck,
  retryAfterMs,
  skip,
  snooze,
  sourceForHost,
  UpdateState
} from "../../updates/core";
import { ACTIONS_COMMAND, CHECK_COMMAND, UpdateManager } from "../../updates/service";
import { createExtensionContext, registeredCommands, shownMessages, statusBarItems } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

const ID = "sayaib.hue-console";
const NOW = Date.UTC(2026, 10, 3, 12);
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));

/** A Marketplace `extensionquery` result shaped like the real one (trimmed). */
function marketplaceBody(versions: Array<{ version: string; engine?: string; preRelease?: boolean; targetPlatform?: string }>, id = ID): unknown {
  const [publisherName, extensionName] = id.split(".");
  return {
    results: [{
      extensions: [{
        publisher: { publisherName, displayName: "Sayaib Sarkar" },
        extensionName,
        versions: versions.map(v => ({
          version: v.version,
          flags: "validated",
          targetPlatform: v.targetPlatform,
          properties: [
            { key: "Microsoft.VisualStudio.Code.Engine", value: v.engine ?? "^1.93.0" },
            ...(v.preRelease ? [{ key: "Microsoft.VisualStudio.Code.PreRelease", value: "true" }] : [])
          ]
        }))
      }],
      resultMetadata: []
    }]
  };
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    }
  };
}

suite("update versions", () => {
  test("compares versions numerically, not as text", () => {
    assert.ok(isNewer("11.86.0", "11.85.0"));
    assert.ok(isNewer("11.85.10", "11.85.9"));
    assert.ok(isNewer("12.0.0", "11.99.99"));
    assert.ok(!isNewer("11.85.0", "11.85.0"));
    assert.ok(!isNewer("11.84.9", "11.85.0"));
    assert.strictEqual(compareSemver("v1.2.3", "1.2.3"), 0, "a leading v is allowed");
    assert.strictEqual(compareSemver("1.2.3+build.7", "1.2.3"), 0, "build metadata does not affect order");
  });

  test("orders pre-releases as the semver specification does", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.strictEqual(compareSemver(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
      assert.strictEqual(compareSemver(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`);
    }
  });

  test("anything that is not a version is never newer", () => {
    for (const bad of ["11.85", "latest", "", "1.2.3.4", "01x.2.3"]) {
      assert.strictEqual(compareSemver(bad, "1.0.0"), undefined, bad);
      assert.ok(!isNewer(bad, "1.0.0"), bad);
      assert.ok(!isNewer("1.0.0", bad), bad);
    }
  });

  test("checks engines.vscode ranges against the host version", () => {
    assert.ok(engineSatisfied("^1.93.0", "1.93.0"));
    assert.ok(engineSatisfied("^1.93.0", "1.105.1"));
    assert.ok(engineSatisfied("^1.93.0", "1.96.0-insider"), "an Insiders build counts as its release");
    assert.ok(!engineSatisfied("^1.99.0", "1.93.0"));
    assert.ok(!engineSatisfied("^1.93.0", "2.0.0"), "a caret range stays within its major version");
    assert.ok(engineSatisfied(">=1.93.0", "2.0.0"));
    assert.ok(engineSatisfied("^1.93.x", "1.93.4"));
    assert.ok(engineSatisfied("*", "1.0.0"));
    assert.ok(!engineSatisfied("~1.93.0 || banana", "1.93.0"), "an unreadable range is treated as incompatible");
    assert.ok(!engineSatisfied(undefined, "1.93.0"));
  });
});

suite("update responses", () => {
  test("finds the newest stable, compatible Marketplace version", () => {
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.86.0" }]), ID, "1.93.0"), "11.86.0");
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.85.0" }, { version: "11.86.0" }]), ID, "1.93.0"), "11.86.0");
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.86.0" }]), ID.toUpperCase(), "1.93.0"), "11.86.0", "ids compare case-insensitively");
  });

  test("ignores pre-releases, other platforms and versions this VS Code cannot run", () => {
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.87.0", preRelease: true }, { version: "11.86.0" }]), ID, "1.93.0"), "11.86.0");
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.87.0-beta.1" }]), ID, "1.93.0"), undefined);
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.87.0", targetPlatform: "win32-x64" }]), ID, "1.93.0"), undefined);
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.87.0", targetPlatform: "universal" }]), ID, "1.93.0"), "11.87.0");
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "11.87.0", engine: "^1.99.0" }]), ID, "1.93.0"), undefined);
  });

  test("an extension the response does not list has no update", () => {
    assert.strictEqual(parseMarketplaceResponse(marketplaceBody([{ version: "9.0.0" }], "someone.else"), ID, "1.93.0"), undefined);
    assert.strictEqual(parseMarketplaceResponse({ results: [{ extensions: [] }] }, ID, "1.93.0"), undefined);
  });

  test("malformed Marketplace responses throw, and garbage entries are skipped", () => {
    for (const body of [null, "html", {}, { results: "x" }]) {
      assert.throws(() => parseMarketplaceResponse(body, ID, "1.93.0"), /results/, JSON.stringify(body));
    }
    const noVersions = { results: [{ extensions: [{ publisher: { publisherName: "sayaib" }, extensionName: "hue-console" }] }] };
    assert.throws(() => parseMarketplaceResponse(noVersions, ID, "1.93.0"), /versions/);
    const garbage = marketplaceBody([{ version: "11.86.0" }]) as any;
    garbage.results[0].extensions[0].versions.unshift(null, { version: 12 }, { version: "not.a.version" }, { version: "99.0.0", properties: "x" });
    assert.strictEqual(parseMarketplaceResponse(garbage, ID, "1.93.0"), "11.86.0", "an entry without an engine property is not trusted");
  });

  test("reads Open VSX responses", () => {
    assert.strictEqual(parseOpenVsxResponse({ version: "11.86.0", engines: { vscode: "^1.93.0" } }, "1.93.0"), "11.86.0");
    assert.strictEqual(parseOpenVsxResponse({ version: "11.86.0", preRelease: true, engines: { vscode: "^1.93.0" } }, "1.93.0"), undefined);
    assert.strictEqual(parseOpenVsxResponse({ version: "11.86.0", engines: { vscode: "^1.99.0" } }, "1.93.0"), undefined);
    assert.strictEqual(parseOpenVsxResponse({ error: "Extension not found: sayaib.hue-console" }, "1.93.0"), undefined);
    assert.throws(() => parseOpenVsxResponse(null, "1.93.0"));
    assert.throws(() => parseOpenVsxResponse({ version: 3 }, "1.93.0"));
  });

  test("picks the gallery from the host", () => {
    assert.strictEqual(sourceForHost("Visual Studio Code"), "marketplace");
    assert.strictEqual(sourceForHost("Visual Studio Code - Insiders"), "marketplace");
    assert.strictEqual(sourceForHost("VSCodium"), "openvsx");
    assert.strictEqual(sourceForHost("Code - OSS"), "openvsx");
  });
});

suite("update check failures", () => {
  test("asks the Marketplace for the latest version only", async () => {
    let request: { url: string; init: any } | undefined;
    const result = await fetchLatest(ID, "marketplace", "1.93.0", async (url, init) => {
      request = { url, init };
      return response(200, marketplaceBody([{ version: "11.86.0" }]));
    });
    assert.deepStrictEqual(result, { ok: true, latest: { version: "11.86.0", source: "marketplace" } });
    assert.ok(request!.url.endsWith("/_apis/public/gallery/extensionquery"));
    assert.strictEqual(request!.init.method, "POST");
    const body = JSON.parse(request!.init.body);
    assert.strictEqual(body.flags, MARKETPLACE_FLAGS);
    assert.ok(body.flags & 0x200, "IncludeLatestVersionOnly keeps the response small");
    assert.deepStrictEqual(body.filters[0].criteria[0], { filterType: 7, value: ID });
  });

  test("network errors, HTTP errors and bad JSON become quiet failures", async () => {
    const cases: Array<[string, () => Promise<any>, RegExp]> = [
      ["offline", async () => { throw new TypeError("fetch failed"); }, /fetch failed/],
      ["server error", async () => response(500, {}), /HTTP 500/],
      ["bad JSON", async () => response(200, new SyntaxError("Unexpected token <")), /Unexpected token/],
      ["wrong shape", async () => response(200, { message: "hi" }), /no results/]
    ];
    for (const [name, fake, reason] of cases) {
      const result = await fetchLatest(ID, "marketplace", "1.93.0", fake);
      assert.strictEqual(result.ok, false, name);
      assert.match((result as { reason: string }).reason, reason, name);
    }
  });

  test("rate limits report Retry-After", async () => {
    const result = await fetchLatest(ID, "marketplace", "1.93.0", async () => response(429, {}, { "retry-after": "120" }));
    assert.deepStrictEqual(result, { ok: false, reason: "rate limited (HTTP 429)", retryAfterMs: 120_000 });
    assert.strictEqual(retryAfterMs(new Date(NOW + 60_000).toUTCString(), NOW), 60_000);
    assert.strictEqual(retryAfterMs("soon"), undefined);
  });

  test("a request that hangs is abandoned", async () => {
    const result = await fetchLatest(ID, "marketplace", "1.93.0", (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }), 20);
    assert.deepStrictEqual(result, { ok: false, reason: "timed out after 20 ms" });
  });

  test("Open VSX not listing the extension is not a failure", async () => {
    let url = "";
    const result = await fetchLatest(ID, "openvsx", "1.93.0", async u => { url = u; return response(404, { error: "Extension not found" }); });
    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(url, "https://open-vsx.org/api/sayaib/hue-console");
  });

  test("failures back off, honouring a longer Retry-After", () => {
    const failed = recordCheck({}, { ok: false, reason: "offline" }, NOW);
    assert.strictEqual(failed.retryAt, NOW + FAILURE_BACKOFF_MS);
    assert.ok(!isCheckDue(failed, NOW + FAILURE_BACKOFF_MS - 1, HOUR));
    assert.ok(isCheckDue(failed, NOW + FAILURE_BACKOFF_MS, HOUR));
    const limited = recordCheck({}, { ok: false, reason: "rate limited", retryAfterMs: 2 * DAY }, NOW);
    assert.strictEqual(limited.retryAt, NOW + 2 * DAY);
    const recovered = recordCheck(limited, { ok: true }, NOW + 2 * DAY);
    assert.strictEqual(recovered.retryAt, undefined);
  });

  test("a failed check keeps the release already found", () => {
    const found = recordCheck({}, { ok: true, latest: { version: "11.86.0", source: "marketplace" } }, NOW);
    const failed = recordCheck(found, { ok: false, reason: "offline" }, NOW + DAY);
    assert.strictEqual(failed.latest?.version, "11.86.0");
  });
});

suite("update state", () => {
  const found = (version = "11.86.0", at = NOW): UpdateState => recordCheck({}, { ok: true, latest: { version, source: "marketplace" } }, at);
  const show = (state: UpdateState, now = NOW, deferToBuiltIn = false) => present(state, "11.85.0", now, { deferToBuiltIn });

  test("checks at most once per interval", () => {
    assert.ok(isCheckDue({}, NOW, DAY), "never checked");
    const checked = recordCheck({}, { ok: true }, NOW);
    assert.ok(!isCheckDue(checked, NOW + 23 * HOUR, DAY));
    assert.ok(isCheckDue(checked, NOW + DAY, DAY));
    assert.ok(isCheckDue(checked, NOW - HOUR, DAY), "a clock that went backwards does not block checks");
  });

  test("a new version shows the indicator and one notification", () => {
    const state = found();
    assert.deepStrictEqual(show(state), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: true });
    assert.deepStrictEqual(show(markNotified(state, "11.86.0")), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: false });
    assert.deepStrictEqual(present(state, "11.86.0", NOW, { deferToBuiltIn: false }), { indicator: false, notify: false }, "nothing once installed");
    assert.deepStrictEqual(present(state, "11.87.0", NOW, { deferToBuiltIn: false }), { indicator: false, notify: false });
  });

  test("Remind Me Later hides the indicator until the delay ends, without a second notification", () => {
    const state = snooze(markNotified(found(), "11.86.0"), "11.86.0", NOW, 24 * HOUR);
    assert.strictEqual(show(state, NOW + 23 * HOUR).indicator, false);
    assert.deepStrictEqual(show(state, NOW + 24 * HOUR), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: false });
  });

  test("a snooze or skip applies to its version only", () => {
    const snoozed = snooze(found(), "11.86.0", NOW, DAY);
    const newer = recordCheck(snoozed, { ok: true, latest: { version: "11.87.0", source: "marketplace" } }, NOW + HOUR);
    assert.deepStrictEqual(show(newer, NOW + HOUR), { available: { version: "11.87.0", source: "marketplace" }, indicator: true, notify: true });

    const skipped = skip(markNotified(found(), "11.86.0"), "11.86.0");
    assert.strictEqual(show(skipped, NOW + 30 * DAY).indicator, false, "a skipped version never comes back");
    const after = recordCheck(skipped, { ok: true, latest: { version: "11.87.0", source: "marketplace" } }, NOW + DAY);
    assert.deepStrictEqual(show(after, NOW + DAY), { available: { version: "11.87.0", source: "marketplace" }, indicator: true, notify: true });
  });

  test("skipping clears a snooze", () => {
    const state = skip(snooze(found(), "11.86.0", NOW, DAY), "11.86.0");
    assert.strictEqual(state.snoozedUntil, undefined);
    assert.strictEqual(state.skippedVersion, "11.86.0");
  });

  test("with VS Code auto-update on, it waits a day and never notifies", () => {
    const state = found();
    assert.strictEqual(show(state, NOW + HOUR, true).indicator, false);
    assert.deepStrictEqual(show(state, NOW + BUILT_IN_GRACE_MS, true), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: false });
  });

  test("the same version found again keeps its first-seen time", () => {
    const first = found("11.86.0", NOW);
    const again = recordCheck(first, { ok: true, latest: { version: "11.86.0", source: "marketplace" } }, NOW + DAY);
    assert.strictEqual(again.latest?.foundAt, NOW);
    const none = recordCheck(again, { ok: true }, NOW + 2 * DAY);
    assert.strictEqual(none.latest, undefined, "a release that was withdrawn stops showing");
  });

  test("an installed update hides the indicator until the reload", () => {
    const state = markInstalled(found(), "11.86.0", "11.85.0", NOW);
    assert.strictEqual(show(state, NOW + HOUR).indicator, false);
    assert.strictEqual(show(state, NOW + 2 * DAY).indicator, true, "an install that never took effect shows again");
  });

  test("stored state is validated", () => {
    assert.deepStrictEqual(normalizeState(undefined), {
      lastCheckAt: undefined, retryAt: undefined, skippedVersion: undefined, snoozedVersion: undefined, snoozedUntil: undefined, notifiedVersion: undefined
    });
    const state = normalizeState({ lastCheckAt: "yesterday", skippedVersion: "nope", latest: { version: "11.86.0", source: "ftp" }, pendingReload: { version: "1" } });
    assert.strictEqual(state.lastCheckAt, undefined);
    assert.strictEqual(state.skippedVersion, undefined);
    assert.strictEqual(state.latest, undefined);
    assert.strictEqual(state.pendingReload, undefined);
    const kept = normalizeState(JSON.parse(JSON.stringify(markNotified(found(), "11.86.0"))));
    assert.deepStrictEqual(kept.latest, { version: "11.86.0", source: "marketplace", foundAt: NOW });
  });

  test("follows VS Code's own update settings", () => {
    assert.deepStrictEqual(builtInPolicy(true, true), { automaticChecks: true, deferToBuiltIn: true });
    assert.deepStrictEqual(builtInPolicy("onlyEnabledExtensions", true), { automaticChecks: true, deferToBuiltIn: true });
    assert.deepStrictEqual(builtInPolicy(false, true), { automaticChecks: true, deferToBuiltIn: false });
    assert.deepStrictEqual(builtInPolicy(true, false), { automaticChecks: false, deferToBuiltIn: false });
    assert.strictEqual(checkIntervalMs("daily"), DAY);
    assert.strictEqual(checkIntervalMs("weekly"), 7 * DAY);
    assert.strictEqual(checkIntervalMs("manual"), undefined);
    assert.strictEqual(checkIntervalMs("bogus"), DAY);
  });
});

suite("update manager", () => {
  // Other suites replace the shim's settings object, so it is looked up on every use.
  const settings = () => (vscode.workspace as any).configurationValues as Record<string, unknown>;

  function setup(versions = [{ version: "11.86.0" }]) {
    const context = createExtensionContext();
    context.extension = { packageJSON: { version: "11.85.0" } };
    context.extensionMode = vscode.ExtensionMode.Production;
    let now = NOW;
    let requests = 0;
    const manager = new UpdateManager(context, {
      fetch: async () => { requests++; return response(200, marketplaceBody(versions)); },
      now: () => now
    });
    settings()["extensions.autoUpdate"] = false;
    const item = () => statusBarItems[statusBarItems.length - 1];
    const notices = () => shownMessages.filter(m => /is available/.test(m.message)).length;
    return { context, manager, item, notices, requests: () => requests, advance: (ms: number) => { now += ms; } };
  }

  /** The notification is shown after its state is saved, a few ticks after render. */
  const settle = () => new Promise(resolve => setImmediate(resolve));

  function teardown(manager: UpdateManager) {
    manager.dispose();
    for (const key of Object.keys(settings())) if (key.startsWith("extensions.") || key.startsWith("devsnip.updates.")) delete settings()[key];
  }

  test("contributes its settings and a Desktop-only command", () => {
    const properties = manifest.contributes.configuration.properties;
    assert.strictEqual(properties["devsnip.updates.notifications"].default, true);
    assert.deepStrictEqual(properties["devsnip.updates.checkFrequency"].enum, ["daily", "weekly", "manual"]);
    assert.strictEqual(properties["devsnip.updates.remindLaterHours"].default, 24);
    const command = manifest.contributes.commands.find((c: { command: string }) => c.command === CHECK_COMMAND);
    assert.ok(command?.enablement.includes("!isWeb"), "the web build does not register it");
    assert.ok(!manifest.contributes.commands.some((c: { command: string }) => c.command === ACTIONS_COMMAND), "the actions command is internal");
    assert.ok(!manifest.activationEvents.includes("onStartupFinished"), "update checks never activate the extension on their own");
  });

  test("checks once a day, shows the indicator and notifies once", async () => {
    const { manager, item, notices, requests, advance } = setup();
    const before = shownMessages.length;
    try {
      await manager.tick();
      await settle();
      assert.strictEqual(requests(), 1);
      assert.strictEqual(item().visible, true);
      assert.match(item().text, /\$\(arrow-circle-up\)/);
      assert.strictEqual(notices(), 1);
      advance(HOUR);
      await manager.tick();
      await settle();
      assert.strictEqual(requests(), 1, "not due again for a day");
      assert.strictEqual(notices(), 1, "no second notification");
      advance(DAY);
      await manager.tick();
      await settle();
      assert.strictEqual(requests(), 2);
      assert.strictEqual(notices(), 1);
    } finally {
      shownMessages.splice(before);
      teardown(manager);
    }
  });

  test("Skip and Remind Me Later hide the indicator", async () => {
    const { manager, item, advance } = setup();
    const before = shownMessages.length;
    try {
      await manager.tick();
      await settle();
      await manager.run("later", { version: "11.86.0", source: "marketplace" });
      assert.strictEqual(item().visible, false);
      advance(25 * HOUR);
      await manager.tick();
      assert.strictEqual(item().visible, true, "back after the reminder delay");
      await manager.run("skip", { version: "11.86.0", source: "marketplace" });
      assert.strictEqual(item().visible, false);
    } finally {
      shownMessages.splice(before);
      teardown(manager);
    }
  });

  test("turning notifications off or VS Code auto-update on keeps it quiet", async () => {
    const off = setup();
    const before = shownMessages.length;
    try {
      settings()["devsnip.updates.notifications"] = false;
      await off.manager.tick();
      await settle();
      assert.strictEqual(off.requests(), 0, "no request at all");
      assert.strictEqual(off.notices(), 0);
    } finally {
      teardown(off.manager);
    }
    const auto = setup();
    try {
      settings()["extensions.autoUpdate"] = true;
      await auto.manager.tick();
      await settle();
      assert.strictEqual(auto.requests(), 1);
      assert.strictEqual(auto.notices(), 0, "VS Code reports and installs the update itself");
      assert.ok(!statusBarItems.some(i => i.visible), "no indicator during the grace period");
    } finally {
      shownMessages.splice(before);
      teardown(auto.manager);
    }
  });

  test("Update Now installs through VS Code and falls back to the extension page", async () => {
    const { manager, item, context } = setup();
    const before = shownMessages.length;
    const calls: unknown[][] = [];
    let installFails = false;
    const stubs = [
      vscode.commands.registerCommand("workbench.extensions.installExtension", async (...args: unknown[]) => {
        calls.push(["install", ...args]);
        if (installFails) throw new Error("Gallery is not configured");
      }),
      vscode.commands.registerCommand("extension.open", (...args: unknown[]) => { calls.push(["open", ...args]); })
    ];
    try {
      await manager.tick();
      await settle();
      await manager.run("update", { version: "11.86.0", source: "marketplace" });
      assert.deepStrictEqual(calls, [["install", ID]]);
      assert.strictEqual(item().visible, false, "hidden while the reload is pending");
      assert.ok(shownMessages.some(m => /11\.86\.0 is installed/.test(m.message)));
      assert.strictEqual(context.globalState.get("devsnip.updates").pendingReload.version, "11.86.0");

      installFails = true;
      calls.length = 0;
      await manager.run("update", { version: "11.86.0", source: "marketplace" });
      assert.deepStrictEqual(calls, [["install", ID], ["open", ID]]);

      calls.length = 0;
      await manager.run("changelog", { version: "11.86.0", source: "marketplace" });
      assert.deepStrictEqual(calls, [["open", ID, "changelog"]]);
    } finally {
      for (const stub of stubs) stub.dispose();
      shownMessages.splice(before);
      teardown(manager);
    }
  });

  test("disposing releases the commands", () => {
    const { manager } = setup();
    assert.ok(registeredCommands.has(CHECK_COMMAND));
    teardown(manager);
    assert.ok(!registeredCommands.has(CHECK_COMMAND));
  });
});
