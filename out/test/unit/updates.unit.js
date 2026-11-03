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
const sidebar_1 = require("../../updates/sidebar");
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const core_1 = require("../../updates/core");
const service_1 = require("../../updates/service");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
const ID = "sayaib.hue-console";
const NOW = Date.UTC(2026, 10, 3, 12);
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
/** A Marketplace `extensionquery` result shaped like the real one (trimmed). */
function marketplaceBody(versions, id = ID) {
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
function response(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        json: async () => {
            if (body instanceof Error)
                throw body;
            return body;
        }
    };
}
(0, run_unit_tests_1.suite)("update versions", () => {
    (0, run_unit_tests_1.test)("compares versions numerically, not as text", () => {
        assert.ok((0, core_1.isNewer)("11.86.0", "11.85.0"));
        assert.ok((0, core_1.isNewer)("11.85.10", "11.85.9"));
        assert.ok((0, core_1.isNewer)("12.0.0", "11.99.99"));
        assert.ok(!(0, core_1.isNewer)("11.85.0", "11.85.0"));
        assert.ok(!(0, core_1.isNewer)("11.84.9", "11.85.0"));
        assert.strictEqual((0, core_1.compareSemver)("v1.2.3", "1.2.3"), 0, "a leading v is allowed");
        assert.strictEqual((0, core_1.compareSemver)("1.2.3+build.7", "1.2.3"), 0, "build metadata does not affect order");
    });
    (0, run_unit_tests_1.test)("orders pre-releases as the semver specification does", () => {
        const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
        for (let i = 0; i < ordered.length - 1; i++) {
            assert.strictEqual((0, core_1.compareSemver)(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
            assert.strictEqual((0, core_1.compareSemver)(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`);
        }
    });
    (0, run_unit_tests_1.test)("anything that is not a version is never newer", () => {
        for (const bad of ["11.85", "latest", "", "1.2.3.4", "01x.2.3"]) {
            assert.strictEqual((0, core_1.compareSemver)(bad, "1.0.0"), undefined, bad);
            assert.ok(!(0, core_1.isNewer)(bad, "1.0.0"), bad);
            assert.ok(!(0, core_1.isNewer)("1.0.0", bad), bad);
        }
    });
    (0, run_unit_tests_1.test)("checks engines.vscode ranges against the host version", () => {
        assert.ok((0, core_1.engineSatisfied)("^1.93.0", "1.93.0"));
        assert.ok((0, core_1.engineSatisfied)("^1.93.0", "1.105.1"));
        assert.ok((0, core_1.engineSatisfied)("^1.93.0", "1.96.0-insider"), "an Insiders build counts as its release");
        assert.ok(!(0, core_1.engineSatisfied)("^1.99.0", "1.93.0"));
        assert.ok(!(0, core_1.engineSatisfied)("^1.93.0", "2.0.0"), "a caret range stays within its major version");
        assert.ok((0, core_1.engineSatisfied)(">=1.93.0", "2.0.0"));
        assert.ok((0, core_1.engineSatisfied)("^1.93.x", "1.93.4"));
        assert.ok((0, core_1.engineSatisfied)("*", "1.0.0"));
        assert.ok(!(0, core_1.engineSatisfied)("~1.93.0 || banana", "1.93.0"), "an unreadable range is treated as incompatible");
        assert.ok(!(0, core_1.engineSatisfied)(undefined, "1.93.0"));
    });
});
(0, run_unit_tests_1.suite)("update responses", () => {
    (0, run_unit_tests_1.test)("finds the newest stable, compatible Marketplace version", () => {
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.86.0" }]), ID, "1.93.0"), "11.86.0");
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.85.0" }, { version: "11.86.0" }]), ID, "1.93.0"), "11.86.0");
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.86.0" }]), ID.toUpperCase(), "1.93.0"), "11.86.0", "ids compare case-insensitively");
    });
    (0, run_unit_tests_1.test)("ignores pre-releases, other platforms and versions this VS Code cannot run", () => {
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.87.0", preRelease: true }, { version: "11.86.0" }]), ID, "1.93.0"), "11.86.0");
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.87.0-beta.1" }]), ID, "1.93.0"), undefined);
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.87.0", targetPlatform: "win32-x64" }]), ID, "1.93.0"), undefined);
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.87.0", targetPlatform: "universal" }]), ID, "1.93.0"), "11.87.0");
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "11.87.0", engine: "^1.99.0" }]), ID, "1.93.0"), undefined);
    });
    (0, run_unit_tests_1.test)("an extension the response does not list has no update", () => {
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(marketplaceBody([{ version: "9.0.0" }], "someone.else"), ID, "1.93.0"), undefined);
        assert.strictEqual((0, core_1.parseMarketplaceResponse)({ results: [{ extensions: [] }] }, ID, "1.93.0"), undefined);
    });
    (0, run_unit_tests_1.test)("malformed Marketplace responses throw, and garbage entries are skipped", () => {
        for (const body of [null, "html", {}, { results: "x" }]) {
            assert.throws(() => (0, core_1.parseMarketplaceResponse)(body, ID, "1.93.0"), /results/, JSON.stringify(body));
        }
        const noVersions = { results: [{ extensions: [{ publisher: { publisherName: "sayaib" }, extensionName: "hue-console" }] }] };
        assert.throws(() => (0, core_1.parseMarketplaceResponse)(noVersions, ID, "1.93.0"), /versions/);
        const garbage = marketplaceBody([{ version: "11.86.0" }]);
        garbage.results[0].extensions[0].versions.unshift(null, { version: 12 }, { version: "not.a.version" }, { version: "99.0.0", properties: "x" });
        assert.strictEqual((0, core_1.parseMarketplaceResponse)(garbage, ID, "1.93.0"), "11.86.0", "an entry without an engine property is not trusted");
    });
    (0, run_unit_tests_1.test)("reads Open VSX responses", () => {
        assert.strictEqual((0, core_1.parseOpenVsxResponse)({ version: "11.86.0", engines: { vscode: "^1.93.0" } }, "1.93.0"), "11.86.0");
        assert.strictEqual((0, core_1.parseOpenVsxResponse)({ version: "11.86.0", preRelease: true, engines: { vscode: "^1.93.0" } }, "1.93.0"), undefined);
        assert.strictEqual((0, core_1.parseOpenVsxResponse)({ version: "11.86.0", engines: { vscode: "^1.99.0" } }, "1.93.0"), undefined);
        assert.strictEqual((0, core_1.parseOpenVsxResponse)({ error: "Extension not found: sayaib.hue-console" }, "1.93.0"), undefined);
        assert.throws(() => (0, core_1.parseOpenVsxResponse)(null, "1.93.0"));
        assert.throws(() => (0, core_1.parseOpenVsxResponse)({ version: 3 }, "1.93.0"));
    });
    (0, run_unit_tests_1.test)("picks the gallery from the host", () => {
        assert.strictEqual((0, core_1.sourceForHost)("Visual Studio Code"), "marketplace");
        assert.strictEqual((0, core_1.sourceForHost)("Visual Studio Code - Insiders"), "marketplace");
        assert.strictEqual((0, core_1.sourceForHost)("VSCodium"), "openvsx");
        assert.strictEqual((0, core_1.sourceForHost)("Code - OSS"), "openvsx");
    });
});
(0, run_unit_tests_1.suite)("update check failures", () => {
    (0, run_unit_tests_1.test)("asks the Marketplace for the latest version only", async () => {
        let request;
        const result = await (0, core_1.fetchLatest)(ID, "marketplace", "1.93.0", async (url, init) => {
            request = { url, init };
            return response(200, marketplaceBody([{ version: "11.86.0" }]));
        });
        assert.deepStrictEqual(result, { ok: true, latest: { version: "11.86.0", source: "marketplace" } });
        assert.ok(request.url.endsWith("/_apis/public/gallery/extensionquery"));
        assert.strictEqual(request.init.method, "POST");
        const body = JSON.parse(request.init.body);
        assert.strictEqual(body.flags, core_1.MARKETPLACE_FLAGS);
        assert.ok(body.flags & 0x200, "IncludeLatestVersionOnly keeps the response small");
        assert.deepStrictEqual(body.filters[0].criteria[0], { filterType: 7, value: ID });
    });
    (0, run_unit_tests_1.test)("network errors, HTTP errors and bad JSON become quiet failures", async () => {
        const cases = [
            ["offline", async () => { throw new TypeError("fetch failed"); }, /fetch failed/],
            ["server error", async () => response(500, {}), /HTTP 500/],
            ["bad JSON", async () => response(200, new SyntaxError("Unexpected token <")), /Unexpected token/],
            ["wrong shape", async () => response(200, { message: "hi" }), /no results/]
        ];
        for (const [name, fake, reason] of cases) {
            const result = await (0, core_1.fetchLatest)(ID, "marketplace", "1.93.0", fake);
            assert.strictEqual(result.ok, false, name);
            assert.match(result.reason, reason, name);
        }
    });
    (0, run_unit_tests_1.test)("rate limits report Retry-After", async () => {
        const result = await (0, core_1.fetchLatest)(ID, "marketplace", "1.93.0", async () => response(429, {}, { "retry-after": "120" }));
        assert.deepStrictEqual(result, { ok: false, reason: "rate limited (HTTP 429)", retryAfterMs: 120000 });
        assert.strictEqual((0, core_1.retryAfterMs)(new Date(NOW + 60000).toUTCString(), NOW), 60000);
        assert.strictEqual((0, core_1.retryAfterMs)("soon"), undefined);
    });
    (0, run_unit_tests_1.test)("a request that hangs is abandoned", async () => {
        const result = await (0, core_1.fetchLatest)(ID, "marketplace", "1.93.0", (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }), 20);
        assert.deepStrictEqual(result, { ok: false, reason: "timed out after 20 ms" });
    });
    (0, run_unit_tests_1.test)("Open VSX not listing the extension is not a failure", async () => {
        let url = "";
        const result = await (0, core_1.fetchLatest)(ID, "openvsx", "1.93.0", async (u) => { url = u; return response(404, { error: "Extension not found" }); });
        assert.deepStrictEqual(result, { ok: true });
        assert.strictEqual(url, "https://open-vsx.org/api/sayaib/hue-console");
    });
    (0, run_unit_tests_1.test)("failures back off, honouring a longer Retry-After", () => {
        const failed = (0, core_1.recordCheck)({}, { ok: false, reason: "offline" }, NOW);
        assert.strictEqual(failed.retryAt, NOW + core_1.FAILURE_BACKOFF_MS);
        assert.ok(!(0, core_1.isCheckDue)(failed, NOW + core_1.FAILURE_BACKOFF_MS - 1, core_1.HOUR));
        assert.ok((0, core_1.isCheckDue)(failed, NOW + core_1.FAILURE_BACKOFF_MS, core_1.HOUR));
        const limited = (0, core_1.recordCheck)({}, { ok: false, reason: "rate limited", retryAfterMs: 2 * core_1.DAY }, NOW);
        assert.strictEqual(limited.retryAt, NOW + 2 * core_1.DAY);
        const recovered = (0, core_1.recordCheck)(limited, { ok: true }, NOW + 2 * core_1.DAY);
        assert.strictEqual(recovered.retryAt, undefined);
    });
    (0, run_unit_tests_1.test)("a failed check keeps the release already found", () => {
        const found = (0, core_1.recordCheck)({}, { ok: true, latest: { version: "11.86.0", source: "marketplace" } }, NOW);
        const failed = (0, core_1.recordCheck)(found, { ok: false, reason: "offline" }, NOW + core_1.DAY);
        assert.strictEqual(failed.latest?.version, "11.86.0");
    });
});
(0, run_unit_tests_1.suite)("update state", () => {
    const found = (version = "11.86.0", at = NOW) => (0, core_1.recordCheck)({}, { ok: true, latest: { version, source: "marketplace" } }, at);
    const show = (state, now = NOW, deferToBuiltIn = false) => (0, core_1.present)(state, "11.85.0", now, { deferToBuiltIn });
    (0, run_unit_tests_1.test)("checks at most once per interval", () => {
        assert.ok((0, core_1.isCheckDue)({}, NOW, core_1.DAY), "never checked");
        const checked = (0, core_1.recordCheck)({}, { ok: true }, NOW);
        assert.ok(!(0, core_1.isCheckDue)(checked, NOW + 23 * core_1.HOUR, core_1.DAY));
        assert.ok((0, core_1.isCheckDue)(checked, NOW + core_1.DAY, core_1.DAY));
        assert.ok((0, core_1.isCheckDue)(checked, NOW - core_1.HOUR, core_1.DAY), "a clock that went backwards does not block checks");
    });
    (0, run_unit_tests_1.test)("a new version shows the indicator and one notification", () => {
        const state = found();
        assert.deepStrictEqual(show(state), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: true });
        assert.deepStrictEqual(show((0, core_1.markNotified)(state, "11.86.0")), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: false });
        assert.deepStrictEqual((0, core_1.present)(state, "11.86.0", NOW, { deferToBuiltIn: false }), { indicator: false, notify: false }, "nothing once installed");
        assert.deepStrictEqual((0, core_1.present)(state, "11.87.0", NOW, { deferToBuiltIn: false }), { indicator: false, notify: false });
    });
    (0, run_unit_tests_1.test)("Remind Me Later hides the indicator until the delay ends, without a second notification", () => {
        const state = (0, core_1.snooze)((0, core_1.markNotified)(found(), "11.86.0"), "11.86.0", NOW, 24 * core_1.HOUR);
        assert.strictEqual(show(state, NOW + 23 * core_1.HOUR).indicator, false);
        assert.deepStrictEqual(show(state, NOW + 24 * core_1.HOUR), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: false });
    });
    (0, run_unit_tests_1.test)("a snooze or skip applies to its version only", () => {
        const snoozed = (0, core_1.snooze)(found(), "11.86.0", NOW, core_1.DAY);
        const newer = (0, core_1.recordCheck)(snoozed, { ok: true, latest: { version: "11.87.0", source: "marketplace" } }, NOW + core_1.HOUR);
        assert.deepStrictEqual(show(newer, NOW + core_1.HOUR), { available: { version: "11.87.0", source: "marketplace" }, indicator: true, notify: true });
        const skipped = (0, core_1.skip)((0, core_1.markNotified)(found(), "11.86.0"), "11.86.0");
        assert.strictEqual(show(skipped, NOW + 30 * core_1.DAY).indicator, false, "a skipped version never comes back");
        const after = (0, core_1.recordCheck)(skipped, { ok: true, latest: { version: "11.87.0", source: "marketplace" } }, NOW + core_1.DAY);
        assert.deepStrictEqual(show(after, NOW + core_1.DAY), { available: { version: "11.87.0", source: "marketplace" }, indicator: true, notify: true });
    });
    (0, run_unit_tests_1.test)("skipping clears a snooze", () => {
        const state = (0, core_1.skip)((0, core_1.snooze)(found(), "11.86.0", NOW, core_1.DAY), "11.86.0");
        assert.strictEqual(state.snoozedUntil, undefined);
        assert.strictEqual(state.skippedVersion, "11.86.0");
    });
    (0, run_unit_tests_1.test)("with VS Code auto-update on, it waits a day and never notifies", () => {
        const state = found();
        assert.strictEqual(show(state, NOW + core_1.HOUR, true).indicator, false);
        assert.deepStrictEqual(show(state, NOW + core_1.BUILT_IN_GRACE_MS, true), { available: { version: "11.86.0", source: "marketplace" }, indicator: true, notify: false });
    });
    (0, run_unit_tests_1.test)("the same version found again keeps its first-seen time", () => {
        const first = found("11.86.0", NOW);
        const again = (0, core_1.recordCheck)(first, { ok: true, latest: { version: "11.86.0", source: "marketplace" } }, NOW + core_1.DAY);
        assert.strictEqual(again.latest?.foundAt, NOW);
        const none = (0, core_1.recordCheck)(again, { ok: true }, NOW + 2 * core_1.DAY);
        assert.strictEqual(none.latest, undefined, "a release that was withdrawn stops showing");
    });
    (0, run_unit_tests_1.test)("an installed update hides the indicator until the reload", () => {
        const state = (0, core_1.markInstalled)(found(), "11.86.0", "11.85.0", NOW);
        assert.strictEqual(show(state, NOW + core_1.HOUR).indicator, false);
        assert.strictEqual(show(state, NOW + 2 * core_1.DAY).indicator, true, "an install that never took effect shows again");
    });
    (0, run_unit_tests_1.test)("stored state is validated", () => {
        assert.deepStrictEqual((0, core_1.normalizeState)(undefined), {
            lastCheckAt: undefined, retryAt: undefined, skippedVersion: undefined, snoozedVersion: undefined, snoozedUntil: undefined, notifiedVersion: undefined
        });
        const state = (0, core_1.normalizeState)({ lastCheckAt: "yesterday", skippedVersion: "nope", latest: { version: "11.86.0", source: "ftp" }, pendingReload: { version: "1" } });
        assert.strictEqual(state.lastCheckAt, undefined);
        assert.strictEqual(state.skippedVersion, undefined);
        assert.strictEqual(state.latest, undefined);
        assert.strictEqual(state.pendingReload, undefined);
        const kept = (0, core_1.normalizeState)(JSON.parse(JSON.stringify((0, core_1.markNotified)(found(), "11.86.0"))));
        assert.deepStrictEqual(kept.latest, { version: "11.86.0", source: "marketplace", foundAt: NOW });
    });
    (0, run_unit_tests_1.test)("follows VS Code's own update settings", () => {
        assert.deepStrictEqual((0, core_1.builtInPolicy)(true, true), { automaticChecks: true, deferToBuiltIn: true });
        assert.deepStrictEqual((0, core_1.builtInPolicy)("onlyEnabledExtensions", true), { automaticChecks: true, deferToBuiltIn: true });
        assert.deepStrictEqual((0, core_1.builtInPolicy)(false, true), { automaticChecks: true, deferToBuiltIn: false });
        assert.deepStrictEqual((0, core_1.builtInPolicy)(true, false), { automaticChecks: false, deferToBuiltIn: false });
        assert.strictEqual((0, core_1.checkIntervalMs)("daily"), core_1.DAY);
        assert.strictEqual((0, core_1.checkIntervalMs)("weekly"), 7 * core_1.DAY);
        assert.strictEqual((0, core_1.checkIntervalMs)("manual"), undefined);
        assert.strictEqual((0, core_1.checkIntervalMs)("bogus"), core_1.DAY);
    });
});
(0, run_unit_tests_1.suite)("update manager", () => {
    // Other suites replace the shim's settings object, so it is looked up on every use.
    const settings = () => vscode.workspace.configurationValues;
    function setup(versions = [{ version: "11.86.0" }]) {
        const context = (0, vscode_stub_1.createExtensionContext)();
        context.extension = { packageJSON: { version: "11.85.0" } };
        context.extensionMode = vscode.ExtensionMode.Production;
        let now = NOW;
        let requests = 0;
        const manager = new service_1.UpdateManager(context, {
            fetch: async () => { requests++; return response(200, marketplaceBody(versions)); },
            now: () => now
        });
        settings()["extensions.autoUpdate"] = false;
        const item = () => vscode_stub_1.statusBarItems[vscode_stub_1.statusBarItems.length - 1];
        const notices = () => vscode_stub_1.shownMessages.filter(m => /is available/.test(m.message)).length;
        return { context, manager, item, notices, requests: () => requests, advance: (ms) => { now += ms; } };
    }
    /** The notification is shown after its state is saved, a few ticks after render. */
    const settle = () => new Promise(resolve => setImmediate(resolve));
    function teardown(manager) {
        manager.dispose();
        for (const key of Object.keys(settings()))
            if (key.startsWith("extensions.") || key.startsWith("devsnip.updates."))
                delete settings()[key];
    }
    (0, run_unit_tests_1.test)("contributes its settings and a Desktop-only command", () => {
        const properties = manifest.contributes.configuration.properties;
        assert.strictEqual(properties["devsnip.updates.notifications"].default, true);
        assert.deepStrictEqual(properties["devsnip.updates.checkFrequency"].enum, ["hourly", "daily", "weekly", "manual"]);
        assert.strictEqual(properties["devsnip.updates.remindLaterHours"].default, 24);
        const command = manifest.contributes.commands.find((c) => c.command === service_1.CHECK_COMMAND);
        assert.ok(command?.enablement.includes("!isWeb"), "the web build does not register it");
        assert.ok(!manifest.contributes.commands.some((c) => c.command === service_1.ACTIONS_COMMAND), "the actions command is internal");
        assert.ok(!manifest.activationEvents.includes("onStartupFinished"), "update checks never activate the extension on their own");
    });
    (0, run_unit_tests_1.test)("checks once a day, shows the indicator and notifies once", async () => {
        const { manager, item, notices, requests, advance } = setup();
        settings()["devsnip.updates.checkFrequency"] = "daily";
        const before = vscode_stub_1.shownMessages.length;
        try {
            await manager.tick();
            await settle();
            assert.strictEqual(requests(), 1);
            assert.strictEqual(item().visible, true);
            assert.match(item().text, /\$\(arrow-circle-up\)/);
            assert.strictEqual(notices(), 1);
            advance(core_1.HOUR);
            await manager.tick();
            await settle();
            assert.strictEqual(requests(), 1, "not due again for a day");
            assert.strictEqual(notices(), 1, "no second notification");
            advance(core_1.DAY);
            await manager.tick();
            await settle();
            assert.strictEqual(requests(), 2);
            assert.strictEqual(notices(), 1);
        }
        finally {
            vscode_stub_1.shownMessages.splice(before);
            teardown(manager);
        }
    });
    (0, run_unit_tests_1.test)("Skip and Remind Me Later hide the indicator", async () => {
        const { manager, item, advance } = setup();
        const before = vscode_stub_1.shownMessages.length;
        try {
            await manager.tick();
            await settle();
            await manager.run("later", { version: "11.86.0", source: "marketplace" });
            assert.strictEqual(item().visible, false);
            advance(25 * core_1.HOUR);
            await manager.tick();
            assert.strictEqual(item().visible, true, "back after the reminder delay");
            await manager.run("skip", { version: "11.86.0", source: "marketplace" });
            assert.strictEqual(item().visible, false);
        }
        finally {
            vscode_stub_1.shownMessages.splice(before);
            teardown(manager);
        }
    });
    (0, run_unit_tests_1.test)("turning notifications off or VS Code auto-update on keeps it quiet", async () => {
        const off = setup();
        const before = vscode_stub_1.shownMessages.length;
        try {
            settings()["devsnip.updates.notifications"] = false;
            await off.manager.tick();
            await settle();
            assert.strictEqual(off.requests(), 0, "no request at all");
            assert.strictEqual(off.notices(), 0);
        }
        finally {
            teardown(off.manager);
        }
        const auto = setup();
        try {
            settings()["extensions.autoUpdate"] = true;
            await auto.manager.tick();
            await settle();
            assert.strictEqual(auto.requests(), 1);
            assert.strictEqual(auto.notices(), 0, "VS Code reports and installs the update itself");
            assert.ok(!vscode_stub_1.statusBarItems.some(i => i.visible), "no indicator during the grace period");
            assert.strictEqual((0, sidebar_1.sidebarUpdate)()?.version, "11.86.0", "the sidebar shows the update immediately even with auto-update enabled");
        }
        finally {
            vscode_stub_1.shownMessages.splice(before);
            teardown(auto.manager);
        }
    });
    (0, run_unit_tests_1.test)("Update Now installs through VS Code and falls back to the extension page", async () => {
        const { manager, item, context } = setup();
        const before = vscode_stub_1.shownMessages.length;
        const calls = [];
        let installFails = false;
        const stubs = [
            vscode.commands.registerCommand("workbench.extensions.installExtension", async (...args) => {
                calls.push(["install", ...args]);
                if (installFails)
                    throw new Error("Gallery is not configured");
            }),
            vscode.commands.registerCommand("extension.open", (...args) => { calls.push(["open", ...args]); })
        ];
        try {
            await manager.tick();
            await settle();
            await manager.run("update", { version: "11.86.0", source: "marketplace" });
            assert.deepStrictEqual(calls, [["install", ID]]);
            assert.strictEqual(item().visible, false, "hidden while the reload is pending");
            assert.ok(vscode_stub_1.shownMessages.some(m => /11\.86\.0 is installed/.test(m.message)));
            assert.strictEqual(context.globalState.get("devsnip.updates").pendingReload.version, "11.86.0");
            installFails = true;
            calls.length = 0;
            await manager.run("update", { version: "11.86.0", source: "marketplace" });
            assert.deepStrictEqual(calls, [["install", ID], ["open", ID]]);
            calls.length = 0;
            await manager.run("changelog", { version: "11.86.0", source: "marketplace" });
            assert.deepStrictEqual(calls, [["open", ID, "changelog"]]);
        }
        finally {
            for (const stub of stubs)
                stub.dispose();
            vscode_stub_1.shownMessages.splice(before);
            teardown(manager);
        }
    });
    (0, run_unit_tests_1.test)("disposing releases the commands", () => {
        const { manager } = setup();
        assert.ok(vscode_stub_1.registeredCommands.has(service_1.CHECK_COMMAND));
        teardown(manager);
        assert.ok(!vscode_stub_1.registeredCommands.has(service_1.CHECK_COMMAND));
    });
});
//# sourceMappingURL=updates.unit.js.map