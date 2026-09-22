import * as assert from "assert";
import {
  EntitlementStore,
  LicenseVerification,
  LicenseVerifier,
  OfflineLicenseVerifier,
  OFFLINE_GRACE_MS,
  VERIFICATION_TTL_MS
} from "../../premium/entitlement";
import { FeatureAccessError, FeatureAccessService } from "../../premium/feature-access";
import {
  CATEGORY_GROUPS,
  DEVELOPER_FEATURES,
  FEATURE_LIMITS,
  POINT_UNLOCKABLE,
  allFeatureIds,
  getFeature
} from "../../premium/feature-registry";
import { CollectionStore } from "../../services/collections";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

/** Verifier whose behaviour each test controls. */
class StubVerifier implements LicenseVerifier {
  calls = 0;
  constructor(private behaviour: () => Promise<LicenseVerification>) {}
  setBehaviour(behaviour: () => Promise<LicenseVerification>): void {
    this.behaviour = behaviour;
  }
  async verify(): Promise<LicenseVerification> {
    this.calls++;
    return this.behaviour();
  }
}

/** Context with a working SecretStorage, which the real stub omits. */
function premiumContext(extensionMode = 3 /* Test */): any {
  const context = createExtensionContext();
  const secrets = new Map<string, string>();
  context.secrets = {
    get: async (key: string) => secrets.get(key),
    store: async (key: string, value: string) => void secrets.set(key, value),
    delete: async (key: string) => void secrets.delete(key)
  };
  context.extensionMode = extensionMode;
  return context;
}

function futureIso(days = 30): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

async function premiumSetup(options: { expiresAt?: string } = {}) {
  const context = premiumContext();
  const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: options.expiresAt ?? futureIso() }));
  const store = new EntitlementStore(context, verifier);
  await store.activate("DSP-PREMIUM-20991231-ABCDEF");
  const access = new FeatureAccessService(context, store);
  return { context, verifier, store, access };
}

async function freeSetup() {
  const context = premiumContext();
  const verifier = new StubVerifier(async () => ({ valid: false, reason: "no licence" }));
  const store = new EntitlementStore(context, verifier);
  await store.refresh();
  const access = new FeatureAccessService(context, store);
  return { context, verifier, store, access };
}

suite("feature registry", () => {
  test("feature ids are unique", () => {
    const ids = allFeatureIds();
    assert.strictEqual(new Set(ids).size, ids.length, "a feature id is defined twice");
  });

  test("every feature has a description, category and group", () => {
    for (const feature of DEVELOPER_FEATURES) {
      assert.ok(feature.description.trim().length > 20, `${feature.id} needs a real description`);
      assert.ok(["free", "premium"].includes(feature.tier), `${feature.id} has an invalid tier`);
      assert.ok(
        CATEGORY_GROUPS[feature.category].includes(feature.group),
        `${feature.id} is in group ${feature.group}, which is not listed under ${feature.category}`
      );
    }
  });

  test("both categories offer free features, so neither tier is empty", () => {
    for (const category of Object.keys(CATEGORY_GROUPS) as Array<keyof typeof CATEGORY_GROUPS>) {
      const free = DEVELOPER_FEATURES.filter(f => f.category === category && f.tier === "free");
      assert.ok(free.length >= 3, `${category} needs a usable free tier, found ${free.length} features`);
    }
  });

  test("limits and point unlocks only reference real features", () => {
    for (const limit of FEATURE_LIMITS) {
      assert.ok(getFeature(limit.featureId), `limit references unknown feature ${limit.featureId}`);
    }
    for (const id of Object.keys(POINT_UNLOCKABLE)) {
      const feature = getFeature(id);
      assert.ok(feature, `point unlock references unknown feature ${id}`);
      assert.strictEqual(feature!.tier, "premium", `${id} is point-unlockable but not premium`);
    }
  });
});

suite("entitlement store", () => {
  test("a fresh install is free", async () => {
    const { store } = await freeSetup();
    const state = store.current();
    assert.strictEqual(state.tier, "free");
    assert.strictEqual(state.isPremium, false);
    assert.strictEqual(state.status, "free");
  });

  test("a valid licence grants premium", async () => {
    const { store } = await premiumSetup();
    assert.strictEqual(store.current().isPremium, true);
    assert.strictEqual(store.current().status, "active");
  });

  test("an expired licence falls back to free", async () => {
    const context = premiumContext();
    const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: new Date(Date.now() - 86400000).toISOString() }));
    const store = new EntitlementStore(context, verifier);
    await store.activate("DSP-PREMIUM-20200101-ABCDEF");
    assert.strictEqual(store.current().isPremium, false);
    assert.strictEqual(store.current().status, "expired");
  });

  test("an invalid licence falls back to free with a reason", async () => {
    const context = premiumContext();
    const verifier = new StubVerifier(async () => ({ valid: false, reason: "revoked" }));
    const store = new EntitlementStore(context, verifier);
    await store.activate("DSP-PREMIUM-20991231-ABCDEF");
    assert.strictEqual(store.current().isPremium, false);
    assert.strictEqual(store.current().status, "invalid");
    assert.match(store.current().detail ?? "", /revoked/);
  });

  test("a cached verification is reused instead of re-checking every time", async () => {
    const { verifier, store } = await premiumSetup();
    const afterActivation = verifier.calls;
    await store.refresh();
    await store.refresh();
    assert.strictEqual(verifier.calls, afterActivation, "the licence server must not be polled on every check");
  });

  test("premium survives the licence server being unreachable", async () => {
    const { verifier, store } = await premiumSetup();
    verifier.setBehaviour(async () => {
      throw new Error("ENOTFOUND licence.example.com");
    });
    const state = await store.refresh({ force: true });
    assert.strictEqual(state.isPremium, true, "an offline check must not revoke a paying user");
    assert.strictEqual(state.offline, true);
    assert.strictEqual(state.status, "offline-grace");
  });

  test("an offline cache older than the grace period stops granting premium", async () => {
    const context = premiumContext();
    let now = Date.now();
    const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: futureIso(400) }));
    const store = new EntitlementStore(context, verifier, () => now);
    await store.activate("DSP-PREMIUM-20991231-ABCDEF");
    assert.strictEqual(store.current().isPremium, true);

    verifier.setBehaviour(async () => {
      throw new Error("offline");
    });
    now += OFFLINE_GRACE_MS + 1000;
    const state = await store.refresh({ force: true });
    assert.strictEqual(state.isPremium, false, "the grace period must eventually end");
    assert.strictEqual(state.offline, true);
  });

  test("the cache is re-checked once the TTL passes", async () => {
    const context = premiumContext();
    let now = Date.now();
    const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: futureIso(400) }));
    const store = new EntitlementStore(context, verifier, () => now);
    await store.activate("DSP-PREMIUM-20991231-ABCDEF");
    const afterActivation = verifier.calls;

    await store.refresh();
    assert.strictEqual(verifier.calls, afterActivation, "still inside the TTL");

    now += VERIFICATION_TTL_MS + 1000;
    await store.refresh();
    assert.strictEqual(verifier.calls, afterActivation + 1, "the licence should be re-checked after the TTL");
  });

  test("deactivation clears the licence and the cache", async () => {
    const { store } = await premiumSetup();
    await store.deactivate();
    assert.strictEqual(store.current().isPremium, false);
    assert.strictEqual(await store.hasStoredLicense(), false);
  });

  test("the licence key is never exposed in the state object", async () => {
    const { store } = await premiumSetup();
    const serialised = JSON.stringify(store.current());
    assert.ok(!serialised.includes("DSP-PREMIUM-20991231-ABCDEF"), "the key must not leak into state");
  });

  test("state changes are announced once", async () => {
    const { store, verifier } = await premiumSetup();
    let events = 0;
    store.onDidChange(() => events++);
    await store.refresh({ force: true });
    assert.strictEqual(events, 0, "an unchanged state should not fire");
    verifier.setBehaviour(async () => ({ valid: false, reason: "revoked" }));
    await store.refresh({ force: true });
    assert.strictEqual(events, 1, "a real change should fire exactly once");
  });

  test("the offline verifier accepts its own keys and rejects tampering", async () => {
    const verifier = new OfflineLicenseVerifier();
    const key = OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30));
    const good = await verifier.verify(key);
    assert.strictEqual(good.valid, true);

    const tampered = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
    assert.strictEqual((await verifier.verify(tampered)).valid, false);
    assert.strictEqual((await verifier.verify("not-a-key")).valid, false);
  });
});

suite("development mode", () => {
  test("the override works in a development host", async () => {
    const { store } = await freeSetup();
    assert.strictEqual(store.developmentModeAvailable(), true);
    const state = await store.setDevelopmentTier("premium");
    assert.strictEqual(state.isPremium, true);
    assert.strictEqual(state.status, "development");
  });

  test("the override is refused and ignored in an installed extension", async () => {
    const devContext = premiumContext(3);
    const devStore = new EntitlementStore(devContext, new StubVerifier(async () => ({ valid: false })));
    await devStore.setDevelopmentTier("premium");
    assert.strictEqual(devStore.current().isPremium, true);

    // Same stored state, but now running as a normal installed extension.
    const installedContext = premiumContext(1 /* Production */);
    installedContext.globalState = devContext.globalState;
    const installedStore = new EntitlementStore(installedContext, new StubVerifier(async () => ({ valid: false })));
    await installedStore.refresh();

    assert.strictEqual(installedStore.developmentModeAvailable(), false);
    assert.strictEqual(installedStore.current().isPremium, false, "a stored override must never grant premium in production");
    await assert.rejects(() => installedStore.setDevelopmentTier("premium"), /development host/);
  });

  test("clearing the override restores the real licence state", async () => {
    const { store } = await premiumSetup();
    await store.setDevelopmentTier("free");
    assert.strictEqual(store.current().isPremium, false);
    await store.setDevelopmentTier(undefined);
    assert.strictEqual(store.current().isPremium, true);
  });
});

suite("feature access", () => {
  test("a free user can use every free feature", async () => {
    const { access } = await freeSetup();
    for (const feature of DEVELOPER_FEATURES.filter(f => f.tier === "free")) {
      const decision = access.check(feature.id);
      assert.strictEqual(decision.allowed, true, `${feature.id} should be free: ${decision.message}`);
    }
  });

  test("a free user is blocked from every premium feature", async () => {
    const { access } = await freeSetup();
    for (const feature of DEVELOPER_FEATURES.filter(f => f.tier === "premium")) {
      const decision = access.check(feature.id);
      assert.strictEqual(decision.allowed, false, `${feature.id} must require premium`);
      assert.strictEqual(decision.reason, "requires-premium");
      assert.ok(decision.message, `${feature.id} should explain why it is locked`);
    }
  });

  test("a premium user can use everything", async () => {
    const { access } = await premiumSetup();
    for (const feature of DEVELOPER_FEATURES) {
      assert.strictEqual(access.check(feature.id).allowed, true, `${feature.id} should be unlocked for premium`);
    }
  });

  test("an unknown feature id is denied rather than allowed by default", async () => {
    const { access } = await freeSetup();
    const decision = access.check("totally-made-up");
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.reason, "unknown-feature");
  });

  test("assertAccess throws a typed error carrying the decision", async () => {
    const { access } = await freeSetup();
    try {
      access.assertAccess("llm-compare");
      assert.fail("expected a FeatureAccessError");
    } catch (error) {
      assert.ok(error instanceof FeatureAccessError);
      assert.strictEqual((error as FeatureAccessError).decision.reason, "requires-premium");
    }
  });

  test("run() refuses to execute the operation when access is denied", async () => {
    const { access } = await freeSetup();
    let executed = false;
    await assert.rejects(
      () => access.run("rag-pipeline-test", async () => { executed = true; return 1; }),
      FeatureAccessError
    );
    assert.strictEqual(executed, false, "the operation must never run for a denied feature");
  });

  test("expired premium is treated as free at the operation layer", async () => {
    const context = premiumContext();
    const verifier = new StubVerifier(async () => ({ valid: true, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const store = new EntitlementStore(context, verifier);
    await store.activate("DSP-PREMIUM-20200101-ABCDEF");
    const access = new FeatureAccessService(context, store);

    let executed = false;
    await assert.rejects(() => access.run("llm-compare", async () => { executed = true; return 1; }), FeatureAccessError);
    assert.strictEqual(executed, false);
    assert.strictEqual(access.check("llm-request").allowed, true, "free features stay available after expiry");
  });

  test("daily limits are enforced and only count successful runs", async () => {
    const { access } = await freeSetup();
    const limit = access.limitFor("llm-request");
    assert.ok(limit && limit.max !== "unlimited", "llm-request should be limited on the free tier");
    const max = limit!.max as number;

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
    await assert.rejects(() => access.run("llm-request", async () => "ok"), FeatureAccessError);
  });

  test("premium removes the daily limit", async () => {
    const { access } = await premiumSetup();
    assert.strictEqual(access.limitFor("llm-request")?.max, "unlimited");
    for (let index = 0; index < 40; index++) {
      await access.run("llm-request", async () => "ok");
    }
    assert.strictEqual(access.check("llm-request").allowed, true);
  });

  test("concurrent metered runs all get counted", async () => {
    const { access } = await premiumSetup();
    await Promise.all(Array.from({ length: 10 }, () => access.run("llm-request", async () => "ok")));
    assert.strictEqual(access.usageFor("llm-request"), 10);
  });

  test("corrupted usage state does not break access checks", async () => {
    const { context, access } = await freeSetup();
    await context.globalState.update("devsnip.premium.dailyUsage", { date: "nonsense", counts: "not an object" });
    assert.strictEqual(access.usageFor("llm-request"), 0);
    assert.strictEqual(access.check("llm-request").allowed, true);
  });

  test("the snapshot the webview renders matches the real decisions", async () => {
    const { access } = await freeSetup();
    const snapshot = access.snapshot();
    assert.strictEqual(snapshot.features.length, DEVELOPER_FEATURES.length);
    for (const feature of snapshot.features) {
      assert.strictEqual(feature.locked, !access.check(feature.id).allowed, `${feature.id} snapshot disagrees with the live check`);
    }
    assert.strictEqual(snapshot.state.isPremium, false);
  });
});

suite("collections and limits", () => {
  test("the free tier caps saved requests at the registry limit", async () => {
    const { context, access } = await freeSetup();
    const collections = new CollectionStore(context, access);
    const max = access.limitFor("collections-basic")!.max as number;

    for (let index = 0; index < max; index++) {
      await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
    }
    assert.strictEqual(collections.list().length, max);
    await assert.rejects(
      () => collections.save({ name: "One too many", url: "https://example.com/extra" }),
      /free tier stores up to/
    );
  });

  test("updating an existing request is allowed at the cap", async () => {
    const { context, access } = await freeSetup();
    const collections = new CollectionStore(context, access);
    const max = access.limitFor("collections-basic")!.max as number;

    const ids: string[] = [];
    for (let index = 0; index < max; index++) {
      const { saved } = await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
      ids.push(saved.id);
    }
    const updated = await collections.save({ id: ids[0], name: "Renamed", url: "https://example.com/0" });
    assert.strictEqual(updated.saved.name, "Renamed");
    assert.strictEqual(collections.list().length, max, "an update must not grow the collection");
  });

  test("premium storage is unlimited", async () => {
    const { context, access } = await premiumSetup();
    const collections = new CollectionStore(context, access);
    for (let index = 0; index < 40; index++) {
      await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
    }
    assert.strictEqual(collections.list().length, 40);
  });

  test("imported entries are sanitised and malformed ones are skipped", async () => {
    const { context, access } = await premiumSetup();
    const collections = new CollectionStore(context, access);
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

  test("export round-trips through import", async () => {
    const { context, access } = await premiumSetup();
    const collections = new CollectionStore(context, access);
    await collections.save({ name: "Alpha", url: "https://example.com/a" });
    const exported = collections.export();
    assert.strictEqual(exported.kind, "devsnip-collection");

    const { context: other, access: otherAccess } = await premiumSetup();
    const target = new CollectionStore(other, otherAccess);
    const result = await target.import(exported);
    assert.strictEqual(result.imported, 1);
    assert.strictEqual(target.list()[0].name, "Alpha");
  });
});
