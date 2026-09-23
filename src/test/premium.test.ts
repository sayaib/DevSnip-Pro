import * as assert from "assert";
import * as vscode from "vscode";
import { DEVELOPER_FEATURES, POINT_UNLOCKABLE, pointCostFor } from "../premium/feature-registry";
import { FeatureAccessService } from "../premium/feature-access";

/**
 * Integration checks for the points-based premium system inside a real VS Code
 * host: command registration, the balance gate, and the guarantee that no
 * premium operation is reachable without going through the access service.
 *
 * There is no licence key in this product, so nothing here tests one.
 */

const EXTENSION_ID = "sayaib.hue-console";

class MemoryState {
  private store = new Map<string, string>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    const raw = this.store.get(key);
    return raw === undefined ? defaultValue : (JSON.parse(raw) as T);
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, JSON.stringify(value));
  }
  keys(): readonly string[] {
    return [...this.store.keys()];
  }
  setKeysForSync(): void { /* not needed in tests */ }
}

function contextFor(): vscode.ExtensionContext {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension not found");
  return {
    subscriptions: [],
    extensionPath: extension.extensionPath,
    extensionUri: extension.extensionUri,
    extensionMode: vscode.ExtensionMode.Test,
    globalState: new MemoryState(),
    workspaceState: new MemoryState()
  } as unknown as vscode.ExtensionContext;
}

/** In-memory points ledger with the same contract as the milestone tracker. */
function ledgerWith(points: number) {
  let balance = points;
  return {
    balance: () => balance,
    spend: async (amount: number) => {
      if (balance < amount) return false;
      balance -= amount;
      return true;
    },
    refund: async (amount: number) => { balance += amount; }
  };
}

suite("Points-based premium system in the extension host", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  test("the points status command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("sayaib.hue-console.premiumStatus"), "the status command is missing");
  });

  test("no licence commands remain registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const removed of [
      "sayaib.hue-console.activatePremium",
      "sayaib.hue-console.deactivatePremium",
      "sayaib.hue-console.setDevelopmentTier"
    ]) {
      assert.ok(!commands.includes(removed), `${removed} should have been removed with the licence system`);
    }
  });

  test("the manifest contributes no licence command or setting", () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const manifest = JSON.stringify(extension?.packageJSON ?? {});
    assert.ok(!/licen[cs]e/i.test(manifest.replace(/"license":\s*"[^"]*"/i, "")),
      "the manifest still mentions a licence outside its own SPDX field");
  });

  test("a zero balance blocks every premium feature and no free one", () => {
    const access = new FeatureAccessService(contextFor(), ledgerWith(0));

    const wronglyOpen = DEVELOPER_FEATURES.filter(f => f.tier === "premium" && access.check(f.id).allowed);
    assert.deepStrictEqual(wronglyOpen.map(f => f.id), [], "these premium features were reachable with no points");

    const wronglyClosed = DEVELOPER_FEATURES.filter(f => f.tier === "free" && !access.check(f.id).allowed);
    assert.deepStrictEqual(wronglyClosed.map(f => f.id), [], "these free features were blocked");
  });

  test("earning points unlocks features without a reload", () => {
    const ledger = ledgerWith(0);
    const access = new FeatureAccessService(contextFor(), ledger);
    const cost = pointCostFor("llm-compare");

    assert.strictEqual(access.check("llm-compare").allowed, false);
    void ledger.refund(cost);
    assert.strictEqual(access.check("llm-compare").allowed, true, "a new balance must take effect immediately");
  });

  test("running a premium feature deducts exactly its price", async () => {
    const ledger = ledgerWith(100);
    const access = new FeatureAccessService(contextFor(), ledger);
    const cost = pointCostFor("assertions");

    await access.run("assertions", async () => "ok");
    assert.strictEqual(ledger.balance(), 100 - cost);
  });

  test("a failed run leaves the balance untouched", async () => {
    const ledger = ledgerWith(100);
    const access = new FeatureAccessService(contextFor(), ledger);

    await assert.rejects(() => access.run("assertions", async () => { throw new Error("boom"); }), /boom/);
    assert.strictEqual(ledger.balance(), 100, "a failed run must not cost points");
  });

  test("the balance can never be driven negative", async () => {
    const cost = pointCostFor("llm-benchmark");
    const ledger = ledgerWith(cost);
    const access = new FeatureAccessService(contextFor(), ledger);

    await access.run("llm-benchmark", async () => "ok");
    assert.strictEqual(ledger.balance(), 0);

    await assert.rejects(() => access.run("llm-benchmark", async () => "ok"));
    assert.ok(ledger.balance() >= 0, "the balance went negative");
  });

  test("every premium feature is priced so none is unreachable", () => {
    const unpriced = DEVELOPER_FEATURES.filter(f => f.tier === "premium" && !f.pointCost);
    assert.deepStrictEqual(unpriced.map(f => f.id), [], "these premium features have no price");
    for (const [id, cost] of Object.entries(POINT_UNLOCKABLE)) {
      assert.ok(cost > 0, `${id} needs a positive price`);
    }
  });

  test("the REST API Client opens and its free workflow is intact", async () => {
    await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
    const isOpen = () =>
      vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === "API Tester Pro");
    for (let attempt = 0; attempt < 40 && !isOpen(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(isOpen(), "the API client panel did not open");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});
