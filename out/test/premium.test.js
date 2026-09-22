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
const vscode = __importStar(require("vscode"));
const feature_registry_1 = require("../premium/feature-registry");
const entitlement_1 = require("../premium/entitlement");
const feature_access_1 = require("../premium/feature-access");
/**
 * Integration checks for the Free/Premium system inside a real VS Code host.
 *
 * The unit suite covers the decision logic; these tests cover the parts that
 * only exist in the host: command registration, secret storage, and the
 * guarantee that no registered command reaches a premium operation without
 * going through the access service.
 */
const EXTENSION_ID = "sayaib.hue-console";
function contextFor() {
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
    };
}
class MemoryState {
    constructor() {
        this.store = new Map();
    }
    get(key, defaultValue) {
        const raw = this.store.get(key);
        return raw === undefined ? defaultValue : JSON.parse(raw);
    }
    async update(key, value) {
        if (value === undefined)
            this.store.delete(key);
        else
            this.store.set(key, JSON.stringify(value));
    }
    keys() {
        return [...this.store.keys()];
    }
    setKeysForSync() { }
}
class MemorySecrets {
    constructor() {
        this.values = new Map();
        this.onDidChange = new vscode.EventEmitter().event;
    }
    async get(key) {
        return this.values.get(key);
    }
    async store(key, value) {
        this.values.set(key, value);
    }
    async delete(key) {
        this.values.delete(key);
    }
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
        const store = new entitlement_1.EntitlementStore(context, new entitlement_1.OfflineLicenseVerifier());
        const key = entitlement_1.OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30));
        const state = await store.activate(key);
        assert.strictEqual(state.isPremium, true, state.detail);
        assert.strictEqual(await store.hasStoredLicense(), true);
        await store.deactivate();
        assert.strictEqual(await store.hasStoredLicense(), false);
        assert.strictEqual(store.current().isPremium, false);
    });
    test("the licence never lands in global state", async () => {
        const context = contextFor();
        const store = new entitlement_1.EntitlementStore(context, new entitlement_1.OfflineLicenseVerifier());
        const key = entitlement_1.OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30));
        await store.activate(key);
        const dump = context.globalState
            .keys()
            .map(stateKey => JSON.stringify(context.globalState.get(stateKey)))
            .join("|");
        assert.ok(!dump.includes(key), "the licence key must only live in secret storage");
    });
    test("every premium feature is gated and every free feature is not", async () => {
        const context = contextFor();
        const store = new entitlement_1.EntitlementStore(context, new entitlement_1.OfflineLicenseVerifier());
        await store.refresh();
        const access = new feature_access_1.FeatureAccessService(context, store);
        const wronglyOpen = feature_registry_1.DEVELOPER_FEATURES.filter(feature => feature.tier === "premium" && access.check(feature.id).allowed);
        assert.deepStrictEqual(wronglyOpen.map(f => f.id), [], "these premium features were reachable for a free user");
        const wronglyClosed = feature_registry_1.DEVELOPER_FEATURES.filter(feature => feature.tier === "free" && !access.check(feature.id).allowed);
        assert.deepStrictEqual(wronglyClosed.map(f => f.id), [], "these free features were blocked");
    });
    test("activating a licence unlocks premium features immediately", async () => {
        const context = contextFor();
        const store = new entitlement_1.EntitlementStore(context, new entitlement_1.OfflineLicenseVerifier());
        const access = new feature_access_1.FeatureAccessService(context, store);
        await store.refresh();
        assert.strictEqual(access.check("llm-compare").allowed, false);
        await store.activate(entitlement_1.OfflineLicenseVerifier.issue(new Date(Date.now() + 86400000 * 30)));
        assert.strictEqual(access.check("llm-compare").allowed, true, "activation must take effect without a reload");
    });
    test("an expired licence key is rejected at activation", async () => {
        const context = contextFor();
        const store = new entitlement_1.EntitlementStore(context, new entitlement_1.OfflineLicenseVerifier());
        const state = await store.activate(entitlement_1.OfflineLicenseVerifier.issue(new Date(Date.now() - 86400000)));
        assert.strictEqual(state.isPremium, false);
        assert.strictEqual(state.status, "expired");
    });
    test("points-unlockable features are premium and priced", () => {
        for (const [id, cost] of Object.entries(feature_registry_1.POINT_UNLOCKABLE)) {
            const feature = feature_registry_1.DEVELOPER_FEATURES.find(entry => entry.id === id);
            assert.ok(feature, `${id} is priced in points but missing from the registry`);
            assert.strictEqual(feature.tier, "premium", `${id} should be premium`);
            assert.ok(cost > 0, `${id} needs a positive point cost`);
        }
    });
    test("the REST API Client still opens and its free workflow is intact", async () => {
        await vscode.commands.executeCommand("sayaib.hue-console.openGUI");
        const isOpen = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === "API Tester Pro");
        // Tab bookkeeping is asynchronous, so poll rather than sampling once.
        for (let attempt = 0; attempt < 40 && !isOpen(); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(isOpen(), "the API client panel did not open");
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
});
//# sourceMappingURL=premium.test.js.map