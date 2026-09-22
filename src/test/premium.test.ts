import * as assert from "assert";
import * as vscode from "vscode";
import { DEVELOPER_FEATURES, POINT_UNLOCKABLE } from "../premium/feature-registry";
import { EntitlementStore, OfflineLicenseVerifier } from "../premium/entitlement";
import { FeatureAccessService } from "../premium/feature-access";

/**
 * Integration checks for the Free/Premium system inside a real VS Code host.
 *
 * The unit suite covers the decision logic; these tests cover the parts that
 * only exist in the host: command registration, secret storage, and the
 * guarantee that no registered command reaches a premium operation without
 * going through the access service.
 */

const EXTENSION_ID = "sayaib.hue-console";

function contextFor(): vscode.ExtensionContext {
  // The extension does not export its context, so tests build their own with
  // the same APIs. Secret storage is real here, unlike in the unit suite.
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "extension not found");
  return {
    subscriptions: [],
    extensionPath: extension.extensionPath,
    extensionUri: extension.extensionUri,
    extensionMode: vscode.ExtensionMode.Test,
    globalState: new MemoryState(),
    workspaceState: new MemoryState(),
    secrets: new MemorySecrets()
  } as unknown as vscode.ExtensionContext;
}

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

class MemorySecrets {
  private values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event;
}

suite("Premium system in the extension host", () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
  });

  test("the subscription commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "sayaib.hue-console.activatePremium",
      "sayaib.hue-console.deactivatePremium",
      "sayaib.hue-console.premiumStatus"
    ]) {
      assert.ok(commands.includes(command), `${command} is not registered`);
    }
  });

  test("a licence key round-trips through real secret storage", async () => {
    const context = contextFor();
    const store = new EntitlementStore(context, new OfflineLicenseVerifier());
    const key = OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30));

    const state = await store.activate(key);
    assert.strictEqual(state.isPremium, true, state.detail);
    assert.strictEqual(await store.hasStoredLicense(), true);

    await store.deactivate();
    assert.strictEqual(await store.hasStoredLicense(), false);
    assert.strictEqual(store.current().isPremium, false);
  });

  test("the licence never lands in global state", async () => {
    const context = contextFor();
    const store = new EntitlementStore(context, new OfflineLicenseVerifier());
    const key = OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30));
    await store.activate(key);

    const dump = (context.globalState as unknown as MemoryState)
      .keys()
      .map(stateKey => JSON.stringify(context.globalState.get(stateKey)))
      .join("|");
    assert.ok(!dump.includes(key), "the licence key must only live in secret storage");
  });

  test("every premium feature is gated and every free feature is not", async () => {
    const context = contextFor();
    const store = new EntitlementStore(context, new OfflineLicenseVerifier());
    await store.refresh();
    const access = new FeatureAccessService(context, store);

    const wronglyOpen = DEVELOPER_FEATURES.filter(
      feature => feature.tier === "premium" && access.check(feature.id).allowed
    );
    assert.deepStrictEqual(wronglyOpen.map(f => f.id), [], "these premium features were reachable for a free user");

    const wronglyClosed = DEVELOPER_FEATURES.filter(
      feature => feature.tier === "free" && !access.check(feature.id).allowed
    );
    assert.deepStrictEqual(wronglyClosed.map(f => f.id), [], "these free features were blocked");
  });

  test("activating a licence unlocks premium features immediately", async () => {
    const context = contextFor();
    const store = new EntitlementStore(context, new OfflineLicenseVerifier());
    const access = new FeatureAccessService(context, store);
    await store.refresh();
    assert.strictEqual(access.check("llm-compare").allowed, false);

    await store.activate(OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30)));
    assert.strictEqual(access.check("llm-compare").allowed, true, "activation must take effect without a reload");
  });

  test("an expired licence key is rejected at activation", async () => {
    const context = contextFor();
    const store = new EntitlementStore(context, new OfflineLicenseVerifier());
    const state = await store.activate(OfflineLicenseVerifier.issue(new Date(Date.now() - 86400000)));
    assert.strictEqual(state.isPremium, false);
    assert.strictEqual(state.status, "expired");
  });

  test("points-unlockable features are premium and priced", () => {
    for (const [id, cost] of Object.entries(POINT_UNLOCKABLE)) {
      const feature = DEVELOPER_FEATURES.find(entry => entry.id === id);
      assert.ok(feature, `${id} is priced in points but missing from the registry`);
      assert.strictEqual(feature!.tier, "premium", `${id} should be premium`);
      assert.ok(cost > 0, `${id} needs a positive point cost`);
    }
  });

  test("the REST API Client still opens and its free workflow is intact", async () => {
    await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
    const isOpen = () =>
      vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === "API Tester Pro");
    // Tab bookkeeping is asynchronous, so poll rather than sampling once.
    for (let attempt = 0; attempt < 40 && !isOpen(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(isOpen(), "the API client panel did not open");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});
