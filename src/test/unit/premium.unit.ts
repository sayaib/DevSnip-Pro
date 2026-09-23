import * as assert from "assert";
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


/** In-memory stand-in for the milestone tracker's points balance. */
function createLedger(initial = 0) {
  let points = initial;
  return {
    balance: () => points,
    spend: async (amount: number) => {
      if (points < amount) return false;
      points -= amount;
      return true;
    },
    refund: async (amount: number) => { points += amount; },
    set: (value: number) => { points = value; }
  };
}

/** A client with the given points balance. Premium is unlocked by spending them. */
async function setupWithPoints(points = 0) {
  const context = premiumContext();
  const ledger = createLedger(points);
  const access = new FeatureAccessService(context, ledger);
  return { context, access, ledger };
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



suite("feature access", () => {
  test("a free user can use every free feature", async () => {
    const { access } = await setupWithPoints(0);
    for (const feature of DEVELOPER_FEATURES.filter(f => f.tier === "free")) {
      const decision = access.check(feature.id);
      assert.strictEqual(decision.allowed, true, `${feature.id} should be free: ${decision.message}`);
    }
  });

  test("a user with no points is blocked from every premium feature", async () => {
    const { access } = await setupWithPoints(0);
    for (const feature of DEVELOPER_FEATURES.filter(f => f.tier === "premium")) {
      const decision = access.check(feature.id);
      assert.strictEqual(decision.allowed, false, `${feature.id} must be gated`);
      assert.strictEqual(decision.reason, "insufficient-points", `${feature.id} should be gated on points`);
      assert.ok(decision.pointCost && decision.pointCost > 0, `${feature.id} needs a points price`);
      assert.ok(decision.message?.includes("Earn"), `${feature.id} should say how to proceed`);
    }
  });

  test("points unlock premium features", async () => {
    const { access, ledger } = await setupWithPoints(1000);
    for (const feature of DEVELOPER_FEATURES.filter(f => f.tier === "premium")) {
      const decision = access.check(feature.id);
      assert.strictEqual(decision.allowed, true, `${feature.id} should be affordable: ${decision.message}`);
      assert.strictEqual(decision.pointCost, feature.pointCost);
    }
    assert.strictEqual(ledger.balance(), 1000, "checking access must not spend anything");
  });

  test("a successful run deducts exactly the feature's price", async () => {
    const { access, ledger } = await setupWithPoints(100);
    const cost = getFeature("llm-compare")!.pointCost!;
    await access.run("llm-compare", async () => "done");
    assert.strictEqual(ledger.balance(), 100 - cost);
  });

  test("a failed run costs nothing", async () => {
    const { access, ledger } = await setupWithPoints(100);
    await assert.rejects(() => access.run("llm-compare", async () => { throw new Error("upstream failed"); }), /upstream failed/);
    assert.strictEqual(ledger.balance(), 100, "points must only be charged for work that succeeded");
  });

  test("running down the balance closes access again", async () => {
    const cost = getFeature("assertions")!.pointCost!;
    const { access, ledger } = await setupWithPoints(cost);
    assert.strictEqual(access.check("assertions").allowed, true);

    await access.run("assertions", async () => "ok");
    assert.strictEqual(ledger.balance(), 0);

    const after = access.check("assertions");
    assert.strictEqual(after.allowed, false);
    assert.strictEqual(after.reason, "insufficient-points");
    assert.strictEqual(after.pointsShort, cost);
  });

  test("free features never cost points", async () => {
    const { access, ledger } = await setupWithPoints(50);
    assert.strictEqual(access.costFor("llm-request"), 0, "a free feature has no price");
    await access.run("llm-request", async () => "done");
    assert.strictEqual(ledger.balance(), 50, "running a free feature leaves the balance alone");
  });

  test("every premium feature carries a price so none is unreachable", () => {
    const unpriced = DEVELOPER_FEATURES.filter(f => f.tier === "premium" && !f.pointCost);
    assert.deepStrictEqual(unpriced.map(f => f.id), [], "these premium features cannot be earned into");
  });

  test("a large balance unlocks everything", async () => {
    const { access } = await setupWithPoints(10000);
    for (const feature of DEVELOPER_FEATURES) {
      assert.strictEqual(access.check(feature.id).allowed, true, `${feature.id} should be affordable`);
    }
  });

  test("an unknown feature id is denied rather than allowed by default", async () => {
    const { access } = await setupWithPoints(0);
    const decision = access.check("totally-made-up");
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.reason, "unknown-feature");
  });

  test("assertAccess throws a typed error carrying the decision", async () => {
    const { access } = await setupWithPoints(0);
    try {
      access.assertAccess("llm-compare");
      assert.fail("expected a FeatureAccessError");
    } catch (error) {
      assert.ok(error instanceof FeatureAccessError);
      const decision = (error as FeatureAccessError).decision;
      assert.strictEqual(decision.reason, "insufficient-points");
      assert.ok(decision.pointCost && decision.pointsShort);
    }
  });

  test("run() refuses to execute the operation when access is denied", async () => {
    const { access } = await setupWithPoints(0);
    let executed = false;
    await assert.rejects(
      () => access.run("rag-pipeline-test", async () => { executed = true; return 1; }),
      FeatureAccessError
    );
    assert.strictEqual(executed, false, "the operation must never run for a denied feature");
  });

  test("spending everything blocks premium but leaves free features working", async () => {
    const { access } = await setupWithPoints(0);

    let executed = false;
    await assert.rejects(() => access.run("llm-compare", async () => { executed = true; return 1; }), FeatureAccessError);
    assert.strictEqual(executed, false);
    assert.strictEqual(access.check("llm-request").allowed, true, "free features never depend on the balance");
  });

  test("a negative or nonsense balance is treated as zero, never as credit", async () => {
    const context = premiumContext();
    for (const broken of [-500, NaN, Infinity]) {
      const access = new FeatureAccessService(context, {
        balance: () => broken,
        spend: async () => false,
        refund: async () => undefined
      });
      assert.strictEqual(access.pointBalance(), 0, `${broken} should read as a zero balance`);
      assert.strictEqual(access.check("llm-compare").allowed, false, `${broken} must not unlock anything`);
    }
  });

  test("a ledger that throws does not break access checks", async () => {
    const context = premiumContext();
    const access = new FeatureAccessService(context, {
      balance: () => { throw new Error("storage unavailable"); },
      spend: async () => false,
      refund: async () => undefined
    });
    assert.strictEqual(access.pointBalance(), 0);
    assert.strictEqual(access.check("llm-request").allowed, true, "free features survive a broken ledger");
    assert.strictEqual(access.check("llm-compare").allowed, false);
  });

  test("daily limits are enforced and only count successful runs", async () => {
    const { access } = await setupWithPoints(0);
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

  test("the daily cap applies regardless of balance", async () => {
    const { access } = await setupWithPoints(10000);
    const max = access.limitFor("llm-request")!.max as number;
    for (let index = 0; index < max; index++) {
      await access.run("llm-request", async () => "ok");
    }
    const decision = access.check("llm-request");
    assert.strictEqual(decision.allowed, false, "a large balance must not bypass the daily cap");
    assert.strictEqual(decision.reason, "limit-reached");
  });

  test("concurrent metered runs all get counted", async () => {
    const { access } = await setupWithPoints(0);
    await Promise.all(Array.from({ length: 10 }, () => access.run("llm-request", async () => "ok")));
    assert.strictEqual(access.usageFor("llm-request"), 10);
  });

  test("corrupted usage state does not break access checks", async () => {
    const { context, access } = await setupWithPoints(0);
    await context.globalState.update("devsnip.premium.dailyUsage", { date: "nonsense", counts: "not an object" });
    assert.strictEqual(access.usageFor("llm-request"), 0);
    assert.strictEqual(access.check("llm-request").allowed, true);
  });

  test("the snapshot the webview renders matches the real decisions", async () => {
    const { access } = await setupWithPoints(0);
    const snapshot = access.snapshot();
    assert.strictEqual(snapshot.features.length, DEVELOPER_FEATURES.length);
    for (const feature of snapshot.features) {
      assert.strictEqual(feature.locked, !access.check(feature.id).allowed, `${feature.id} snapshot disagrees with the live check`);
    }
    assert.strictEqual(snapshot.pointBalance, 0);
  });
});

suite("collections and limits", () => {
  test("saving requests is unlimited and updates replace in place", async () => {
    const { context, access } = await setupWithPoints(0);
    const collections = new CollectionStore(context, access);

    const ids: string[] = [];
    for (let index = 0; index < 40; index++) {
      const { saved } = await collections.save({ name: `Request ${index}`, url: `https://example.com/${index}` });
      ids.push(saved.id);
    }
    assert.strictEqual(collections.list().length, 40, "saving a request must never be capped");

    const updated = await collections.save({ id: ids[0], name: "Renamed", url: "https://example.com/0" });
    assert.strictEqual(updated.saved.name, "Renamed");
    assert.strictEqual(collections.list().length, 40, "an update must not grow the collection");
  });

  test("imported entries are sanitised and malformed ones are skipped", async () => {
    const { context, access } = await setupWithPoints(0);
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
    const { context, access } = await setupWithPoints(0);
    const collections = new CollectionStore(context, access);
    await collections.save({ name: "Alpha", url: "https://example.com/a" });
    const exported = collections.export();
    assert.strictEqual(exported.kind, "devsnip-collection");

    const { context: other, access: otherAccess } = await setupWithPoints(0);
    const target = new CollectionStore(other, otherAccess);
    const result = await target.import(exported);
    assert.strictEqual(result.imported, 1);
    assert.strictEqual(target.list()[0].name, "Alpha");
  });
});
