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
const entitlement_1 = require("../../premium/entitlement");
const feature_access_1 = require("../../premium/feature-access");
const feature_registry_1 = require("../../premium/feature-registry");
const collections_1 = require("../../services/collections");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
/** Verifier whose behaviour each test controls. */
class StubVerifier {
    constructor(behaviour) {
        this.behaviour = behaviour;
        this.calls = 0;
    }
    setBehaviour(behaviour) {
        this.behaviour = behaviour;
    }
    async verify() {
        this.calls++;
        return this.behaviour();
    }
}
/** Context with a working SecretStorage, which the real stub omits. */
function premiumContext(extensionMode = 3 /* Test */) {
    const context = (0, vscode_stub_1.createExtensionContext)();
    const secrets = new Map();
    context.secrets = {
        get: async (key) => secrets.get(key),
        store: async (key, value) => void secrets.set(key, value),
        delete: async (key) => void secrets.delete(key)
    };
    context.extensionMode = extensionMode;
    return context;
}
function futureIso(days = 30) {
    return new Date(Date.now() + days * 86400000).toISOString();
}
async function premiumSetup(options = {}) {
    const context = premiumContext();
    const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: options.expiresAt ?? futureIso() }));
    const store = new entitlement_1.EntitlementStore(context, verifier);
    await store.activate("DSP-PREMIUM-20991231-ABCDEF");
    const access = new feature_access_1.FeatureAccessService(context, store);
    return { context, verifier, store, access };
}
async function freeSetup() {
    const context = premiumContext();
    const verifier = new StubVerifier(async () => ({ valid: false, reason: "no licence" }));
    const store = new entitlement_1.EntitlementStore(context, verifier);
    await store.refresh();
    const access = new feature_access_1.FeatureAccessService(context, store);
    return { context, verifier, store, access };
}
(0, run_unit_tests_1.suite)("feature registry", () => {
    (0, run_unit_tests_1.test)("feature ids are unique", () => {
        const ids = (0, feature_registry_1.allFeatureIds)();
        assert.strictEqual(new Set(ids).size, ids.length, "a feature id is defined twice");
    });
    (0, run_unit_tests_1.test)("every feature has a description, category and group", () => {
        for (const feature of feature_registry_1.DEVELOPER_FEATURES) {
            assert.ok(feature.description.trim().length > 20, `${feature.id} needs a real description`);
            assert.ok(["free", "premium"].includes(feature.tier), `${feature.id} has an invalid tier`);
            assert.ok(feature_registry_1.CATEGORY_GROUPS[feature.category].includes(feature.group), `${feature.id} is in group ${feature.group}, which is not listed under ${feature.category}`);
        }
    });
    (0, run_unit_tests_1.test)("both categories offer free features, so neither tier is empty", () => {
        for (const category of Object.keys(feature_registry_1.CATEGORY_GROUPS)) {
            const free = feature_registry_1.DEVELOPER_FEATURES.filter(f => f.category === category && f.tier === "free");
            assert.ok(free.length >= 3, `${category} needs a usable free tier, found ${free.length} features`);
        }
    });
    (0, run_unit_tests_1.test)("limits and point unlocks only reference real features", () => {
        for (const limit of feature_registry_1.FEATURE_LIMITS) {
            assert.ok((0, feature_registry_1.getFeature)(limit.featureId), `limit references unknown feature ${limit.featureId}`);
        }
        for (const id of Object.keys(feature_registry_1.POINT_UNLOCKABLE)) {
            const feature = (0, feature_registry_1.getFeature)(id);
            assert.ok(feature, `point unlock references unknown feature ${id}`);
            assert.strictEqual(feature.tier, "premium", `${id} is point-unlockable but not premium`);
        }
    });
});
(0, run_unit_tests_1.suite)("entitlement store", () => {
    (0, run_unit_tests_1.test)("a fresh install is free", async () => {
        const { store } = await freeSetup();
        const state = store.current();
        assert.strictEqual(state.tier, "free");
        assert.strictEqual(state.isPremium, false);
        assert.strictEqual(state.status, "free");
    });
    (0, run_unit_tests_1.test)("a valid licence grants premium", async () => {
        const { store } = await premiumSetup();
        assert.strictEqual(store.current().isPremium, true);
        assert.strictEqual(store.current().status, "active");
    });
    (0, run_unit_tests_1.test)("an expired licence falls back to free", async () => {
        const context = premiumContext();
        const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: new Date(Date.now() - 86400000).toISOString() }));
        const store = new entitlement_1.EntitlementStore(context, verifier);
        await store.activate("DSP-PREMIUM-20200101-ABCDEF");
        assert.strictEqual(store.current().isPremium, false);
        assert.strictEqual(store.current().status, "expired");
    });
    (0, run_unit_tests_1.test)("an invalid licence falls back to free with a reason", async () => {
        const context = premiumContext();
        const verifier = new StubVerifier(async () => ({ valid: false, reason: "revoked" }));
        const store = new entitlement_1.EntitlementStore(context, verifier);
        await store.activate("DSP-PREMIUM-20991231-ABCDEF");
        assert.strictEqual(store.current().isPremium, false);
        assert.strictEqual(store.current().status, "invalid");
        assert.match(store.current().detail ?? "", /revoked/);
    });
    (0, run_unit_tests_1.test)("a cached verification is reused instead of re-checking every time", async () => {
        const { verifier, store } = await premiumSetup();
        const afterActivation = verifier.calls;
        await store.refresh();
        await store.refresh();
        assert.strictEqual(verifier.calls, afterActivation, "the licence server must not be polled on every check");
    });
    (0, run_unit_tests_1.test)("premium survives the licence server being unreachable", async () => {
        const { verifier, store } = await premiumSetup();
        verifier.setBehaviour(async () => {
            throw new Error("ENOTFOUND licence.example.com");
        });
        const state = await store.refresh({ force: true });
        assert.strictEqual(state.isPremium, true, "an offline check must not revoke a paying user");
        assert.strictEqual(state.offline, true);
        assert.strictEqual(state.status, "offline-grace");
    });
    (0, run_unit_tests_1.test)("an offline cache older than the grace period stops granting premium", async () => {
        const context = premiumContext();
        let now = Date.now();
        const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: futureIso(400) }));
        const store = new entitlement_1.EntitlementStore(context, verifier, () => now);
        await store.activate("DSP-PREMIUM-20991231-ABCDEF");
        assert.strictEqual(store.current().isPremium, true);
        verifier.setBehaviour(async () => {
            throw new Error("offline");
        });
        now += entitlement_1.OFFLINE_GRACE_MS + 1000;
        const state = await store.refresh({ force: true });
        assert.strictEqual(state.isPremium, false, "the grace period must eventually end");
        assert.strictEqual(state.offline, true);
    });
    (0, run_unit_tests_1.test)("the cache is re-checked once the TTL passes", async () => {
        const context = premiumContext();
        let now = Date.now();
        const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: futureIso(400) }));
        const store = new entitlement_1.EntitlementStore(context, verifier, () => now);
        await store.activate("DSP-PREMIUM-20991231-ABCDEF");
        const afterActivation = verifier.calls;
        await store.refresh();
        assert.strictEqual(verifier.calls, afterActivation, "still inside the TTL");
        now += entitlement_1.VERIFICATION_TTL_MS + 1000;
        await store.refresh();
        assert.strictEqual(verifier.calls, afterActivation + 1, "the licence should be re-checked after the TTL");
    });
    (0, run_unit_tests_1.test)("deactivation clears the licence and the cache", async () => {
        const { store } = await premiumSetup();
        await store.deactivate();
        assert.strictEqual(store.current().isPremium, false);
        assert.strictEqual(await store.hasStoredLicense(), false);
    });
    (0, run_unit_tests_1.test)("the licence key is never exposed in the state object", async () => {
        const { store } = await premiumSetup();
        const serialised = JSON.stringify(store.current());
        assert.ok(!serialised.includes("DSP-PREMIUM-20991231-ABCDEF"), "the key must not leak into state");
    });
    (0, run_unit_tests_1.test)("state changes are announced once", async () => {
        const { store, verifier } = await premiumSetup();
        let events = 0;
        store.onDidChange(() => events++);
        await store.refresh({ force: true });
        assert.strictEqual(events, 0, "an unchanged state should not fire");
        verifier.setBehaviour(async () => ({ valid: false, reason: "revoked" }));
        await store.refresh({ force: true });
        assert.strictEqual(events, 1, "a real change should fire exactly once");
    });
    (0, run_unit_tests_1.test)("the offline verifier accepts its own keys and rejects tampering", async () => {
        const verifier = new entitlement_1.OfflineLicenseVerifier();
        const key = entitlement_1.OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30));
        const good = await verifier.verify(key);
        assert.strictEqual(good.valid, true);
        const tampered = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
        assert.strictEqual((await verifier.verify(tampered)).valid, false);
        assert.strictEqual((await verifier.verify("not-a-key")).valid, false);
    });
});
(0, run_unit_tests_1.suite)("development mode", () => {
    (0, run_unit_tests_1.test)("the override works in a development host", async () => {
        const { store } = await freeSetup();
        assert.strictEqual(store.developmentModeAvailable(), true);
        const state = await store.setDevelopmentTier("premium");
        assert.strictEqual(state.isPremium, true);
        assert.strictEqual(state.status, "development");
    });
    (0, run_unit_tests_1.test)("the override is refused and ignored in an installed extension", async () => {
        const devContext = premiumContext(3);
        const devStore = new entitlement_1.EntitlementStore(devContext, new StubVerifier(async () => ({ valid: false })));
        await devStore.setDevelopmentTier("premium");
        assert.strictEqual(devStore.current().isPremium, true);
        // Same stored state, but now running as a normal installed extension.
        const installedContext = premiumContext(1 /* Production */);
        installedContext.globalState = devContext.globalState;
        const installedStore = new entitlement_1.EntitlementStore(installedContext, new StubVerifier(async () => ({ valid: false })));
        await installedStore.refresh();
        assert.strictEqual(installedStore.developmentModeAvailable(), false);
        assert.strictEqual(installedStore.current().isPremium, false, "a stored override must never grant premium in production");
        await assert.rejects(() => installedStore.setDevelopmentTier("premium"), /development host/);
    });
    (0, run_unit_tests_1.test)("clearing the override restores the real licence state", async () => {
        const { store } = await premiumSetup();
        await store.setDevelopmentTier("free");
        assert.strictEqual(store.current().isPremium, false);
        await store.setDevelopmentTier(undefined);
        assert.strictEqual(store.current().isPremium, true);
    });
});
(0, run_unit_tests_1.suite)("feature access", () => {
    (0, run_unit_tests_1.test)("a free user can use every free feature", async () => {
        const { access } = await freeSetup();
        for (const feature of feature_registry_1.DEVELOPER_FEATURES.filter(f => f.tier === "free")) {
            const decision = access.check(feature.id);
            assert.strictEqual(decision.allowed, true, `${feature.id} should be free: ${decision.message}`);
        }
    });
    (0, run_unit_tests_1.test)("a free user is blocked from every premium feature", async () => {
        const { access } = await freeSetup();
        for (const feature of feature_registry_1.DEVELOPER_FEATURES.filter(f => f.tier === "premium")) {
            const decision = access.check(feature.id);
            assert.strictEqual(decision.allowed, false, `${feature.id} must require premium`);
            assert.strictEqual(decision.reason, "requires-premium");
            assert.ok(decision.message, `${feature.id} should explain why it is locked`);
        }
    });
    (0, run_unit_tests_1.test)("a premium user can use everything", async () => {
        const { access } = await premiumSetup();
        for (const feature of feature_registry_1.DEVELOPER_FEATURES) {
            assert.strictEqual(access.check(feature.id).allowed, true, `${feature.id} should be unlocked for premium`);
        }
    });
    (0, run_unit_tests_1.test)("an unknown feature id is denied rather than allowed by default", async () => {
        const { access } = await freeSetup();
        const decision = access.check("totally-made-up");
        assert.strictEqual(decision.allowed, false);
        assert.strictEqual(decision.reason, "unknown-feature");
    });
    (0, run_unit_tests_1.test)("assertAccess throws a typed error carrying the decision", async () => {
        const { access } = await freeSetup();
        try {
            access.assertAccess("llm-compare");
            assert.fail("expected a FeatureAccessError");
        }
        catch (error) {
            assert.ok(error instanceof feature_access_1.FeatureAccessError);
            assert.strictEqual(error.decision.reason, "requires-premium");
        }
    });
    (0, run_unit_tests_1.test)("run() refuses to execute the operation when access is denied", async () => {
        const { access } = await freeSetup();
        let executed = false;
        await assert.rejects(() => access.run("rag-pipeline-test", async () => { executed = true; return 1; }), feature_access_1.FeatureAccessError);
        assert.strictEqual(executed, false, "the operation must never run for a denied feature");
    });
    (0, run_unit_tests_1.test)("expired premium is treated as free at the operation layer", async () => {
        const context = premiumContext();
        const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: new Date(Date.now() - 1000).toISOString() }));
        const store = new entitlement_1.EntitlementStore(context, verifier);
        await store.activate("DSP-PREMIUM-20200101-ABCDEF");
        const access = new feature_access_1.FeatureAccessService(context, store);
        let executed = false;
        await assert.rejects(() => access.run("llm-compare", async () => { executed = true; return 1; }), feature_access_1.FeatureAccessError);
        assert.strictEqual(executed, false);
        assert.strictEqual(access.check("llm-request").allowed, true, "free features stay available after expiry");
    });
    (0, run_unit_tests_1.test)("daily limits are enforced and only count successful runs", async () => {
        const { access } = await freeSetup();
        const limit = access.limitFor("llm-request");
        assert.ok(limit && limit.max !== "unlimited", "llm-request should be limited on the free tier");
        const max = limit.max;
        // A failure must not consume the allowance.
        await assert.rejects(() => access.run("llm-request", async () => { throw new Error("network down"); }), /network down/);
        assert.strictEqual(access.usageFor("llm-request"), 0);
        for (let index = 0; index < max; index++) {
            await access.run("llm-request", async () => "ok");
        }
        assert.strictEqual(access.usageFor("llm-request"), max);
        const decision = access.check("llm-request");
        assert.strictEqual(decision.allowed, false);
        assert.strictEqual(decision.reason, "limit-reached");
        await assert.rejects(() => access.run("llm-request", async () => "ok"), feature_access_1.FeatureAccessError);
    });
    (0, run_unit_tests_1.test)("premium removes the daily limit", async () => {
        const { access } = await premiumSetup();
        assert.strictEqual(access.limitFor("llm-request")?.max, "unlimited");
        for (let index = 0; index < 40; index++) {
            await access.run("llm-request", async () => "ok");
        }
        assert.strictEqual(access.check("llm-request").allowed, true);
    });
    (0, run_unit_tests_1.test)("concurrent metered runs all get counted", async () => {
        const { access } = await premiumSetup();
        await Promise.all(Array.from({ length: 10 }, () => access.run("llm-request", async () => "ok")));
        assert.strictEqual(access.usageFor("llm-request"), 10);
    });
    (0, run_unit_tests_1.test)("corrupted usage state does not break access checks", async () => {
        const { context, access } = await freeSetup();
        await context.globalState.update("devsnip.premium.dailyUsage", { date: "nonsense", counts: "not an object" });
        assert.strictEqual(access.usageFor("llm-request"), 0);
        assert.strictEqual(access.check("llm-request").allowed, true);
    });
    (0, run_unit_tests_1.test)("the snapshot the webview renders matches the real decisions", async () => {
        const { access } = await freeSetup();
        const snapshot = access.snapshot();
        assert.strictEqual(snapshot.features.length, feature_registry_1.DEVELOPER_FEATURES.length);
        for (const feature of snapshot.features) {
            assert.strictEqual(feature.locked, !access.check(feature.id).allowed, `${feature.id} snapshot disagrees with the live check`);
        }
        assert.strictEqual(snapshot.state.isPremium, false);
    });
});
(0, run_unit_tests_1.suite)("collections and limits", () => {
    (0, run_unit_tests_1.test)("the free tier caps saved requests at the registry limit", async () => {
        const { context, access } = await freeSetup();
        const collections = new collections_1.CollectionStore(context, access);
        const max = access.limitFor("collections-basic").max;
        for (let index = 0; index < max; index++) {
            await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
        }
        assert.strictEqual(collections.list().length, max);
        await assert.rejects(() => collections.save({ name: "One too many", url: "https://example.com/extra" }), /free tier stores up to/);
    });
    (0, run_unit_tests_1.test)("updating an existing request is allowed at the cap", async () => {
        const { context, access } = await freeSetup();
        const collections = new collections_1.CollectionStore(context, access);
        const max = access.limitFor("collections-basic").max;
        const ids = [];
        for (let index = 0; index < max; index++) {
            const { saved } = await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
            ids.push(saved.id);
        }
        const updated = await collections.save({ id: ids[0], name: "Renamed", url: "https://example.com/0" });
        assert.strictEqual(updated.saved.name, "Renamed");
        assert.strictEqual(collections.list().length, max, "an update must not grow the collection");
    });
    (0, run_unit_tests_1.test)("premium storage is unlimited", async () => {
        const { context, access } = await premiumSetup();
        const collections = new collections_1.CollectionStore(context, access);
        for (let index = 0; index < 40; index++) {
            await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
        }
        assert.strictEqual(collections.list().length, 40);
    });
    (0, run_unit_tests_1.test)("imported entries are sanitised and malformed ones are skipped", async () => {
        const { context, access } = await premiumSetup();
        const collections = new collections_1.CollectionStore(context, access);
        const result = await collections.import({
            kind: "devsnip-collection",
            version: 1,
            requests: [
                { name: "Good", url: "https://example.com", method: "post", headers: { a: "1", bad: 2 } },
                { name: "No URL" },
                "not an object"
            ]
        });
        assert.strictEqual(result.imported, 1);
        assert.strictEqual(result.skipped, 2);
        const saved = collections.list()[0];
        assert.strictEqual(saved.method, "POST");
        assert.deepStrictEqual(saved.headers, { a: "1" }, "non-string header values are dropped");
    });
    (0, run_unit_tests_1.test)("export round-trips through import", async () => {
        const { context, access } = await premiumSetup();
        const collections = new collections_1.CollectionStore(context, access);
        await collections.save({ name: "Alpha", url: "https://example.com/a" });
        const exported = collections.export();
        assert.strictEqual(exported.kind, "devsnip-collection");
        const { context: other, access: otherAccess } = await premiumSetup();
        const target = new collections_1.CollectionStore(other, otherAccess);
        const result = await target.import(exported);
        assert.strictEqual(result.imported, 1);
        assert.strictEqual(target.list()[0].name, "Alpha");
    });
});
//# sourceMappingURL=premium.unit.js.map