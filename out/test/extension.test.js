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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const EXTENSION_ID = "sayaib.hue-console";
function readManifest() {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} was not found`);
    return JSON.parse(fs.readFileSync(path.join(extension.extensionPath, "package.json"), "utf8"));
}
suite("Extension activation", () => {
    let extension;
    suiteSetup(async () => {
        const found = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(found, `extension ${EXTENSION_ID} was not found`);
        extension = found;
        await extension.activate();
    });
    test("activates without throwing", () => {
        assert.strictEqual(extension.isActive, true);
    });
    test("every contributed command is actually registered", async () => {
        const manifest = readManifest();
        const registered = new Set(await vscode.commands.getCommands(true));
        const missing = manifest.contributes.commands
            .map(entry => entry.command)
            .filter(command => !registered.has(command));
        assert.deepStrictEqual(missing, [], `these contributed commands were never registered: ${missing.join(", ")}`);
    });
    test("contributed command ids are unique and namespaced", () => {
        const commands = readManifest().contributes.commands.map(entry => entry.command);
        assert.strictEqual(new Set(commands).size, commands.length, "duplicate command ids in package.json");
        for (const command of commands) {
            assert.ok(command.startsWith("sayaib.hue-console."), `${command} is outside the extension namespace`);
        }
    });
    test("every contributed command has a title", () => {
        for (const entry of readManifest().contributes.commands) {
            assert.ok(entry.title && entry.title.trim().length > 0, `${entry.command} has no title`);
        }
    });
    test("every contributed snippet file exists and holds valid JSON", () => {
        const manifest = readManifest();
        for (const snippet of manifest.contributes.snippets) {
            const filePath = path.join(extension.extensionPath, snippet.path.replace(/^\.\//, ""));
            assert.ok(fs.existsSync(filePath), `${snippet.path} is contributed but missing from the package`);
            assert.doesNotThrow(() => JSON.parse(fs.readFileSync(filePath, "utf8")), `${snippet.path} is not valid JSON`);
        }
    });
    test("the compiled entry point exists", () => {
        const manifest = readManifest();
        assert.ok(fs.existsSync(path.join(extension.extensionPath, manifest.main)), `${manifest.main} is missing`);
    });
    test("every contributed setting is readable with its declared default", () => {
        const properties = readManifest().contributes.configuration?.properties ?? {};
        assert.ok(Object.keys(properties).length > 0, "no settings are contributed");
        for (const [key, schema] of Object.entries(properties)) {
            const [section, ...rest] = key.split(".");
            const value = vscode.workspace.getConfiguration(section).get(rest.join("."));
            assert.notStrictEqual(value, undefined, `${key} is declared but not readable`);
            assert.strictEqual(typeof value, schema.type === "number" ? "number" : schema.type, `${key} has the wrong type`);
        }
    });
    test("every menu entry points at a real command or submenu", () => {
        const manifest = readManifest();
        const commands = new Set(manifest.contributes.commands.map(entry => entry.command));
        const submenus = new Set((manifest.contributes.submenus ?? []).map(entry => entry.id));
        for (const [location, entries] of Object.entries(manifest.contributes.menus ?? {})) {
            for (const entry of entries) {
                if (entry.command) {
                    assert.ok(commands.has(entry.command), `${location} references unknown command ${entry.command}`);
                }
                else if (entry.submenu) {
                    assert.ok(submenus.has(entry.submenu), `${location} references unknown submenu ${entry.submenu}`);
                }
                else {
                    assert.fail(`${location} has an entry with neither a command nor a submenu`);
                }
            }
        }
    });
    test("the tool tree view is contributed", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes("sayaib.hue-console.searchTools"), "the tool search command backs the tree view header");
    });
});
suite("Command execution", () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    });
    teardown(async () => {
        // Close anything a command opened so the next test starts clean.
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
    test("webview tools open without throwing", async () => {
        const webviewCommands = [
            "sayaib.hue-console.advancedToolsHub",
            "sayaib.hue-console.aiMlHub",
            "sayaib.hue-console.bigDataHub",
            "sayaib.hue-console.ragHub",
            "sayaib.hue-console.openGUI",
            "sayaib.hue-console.jsonFormatter",
            "sayaib.hue-console.regexBuilder",
            "sayaib.hue-console.hashGenerator",
            "sayaib.hue-console.base64Encoder",
            "sayaib.hue-console.urlEncoder",
            "sayaib.hue-console.timestampConverter",
            "sayaib.hue-console.jsonToToon",
            "sayaib.hue-console.colorPalette",
            "sayaib.hue-console.loremGenerator",
            "sayaib.hue-console.tokenCounter",
            "sayaib.hue-console.promptTemplate",
            "sayaib.hue-console.mlCodeGen",
            "sayaib.hue-console.llmApiTester",
            "sayaib.hue-console.datasetSplit",
            "sayaib.hue-console.gpuVram",
            "sayaib.hue-console.experimentLogger",
            "sayaib.hue-console.modelCard",
            "sayaib.hue-console.jsonlViewer",
            "sayaib.hue-console.mdTableGen",
            "sayaib.hue-console.datasetProfiler",
            "sayaib.hue-console.metricsCalculator",
            "sayaib.hue-console.promptPlayground",
            "sayaib.hue-console.lrScheduler",
            "sayaib.hue-console.inferenceEstimator",
            "sayaib.hue-console.schemaViewer",
            "sayaib.hue-console.sparkSqlFormatter",
            "sayaib.hue-console.dataQualityChecker",
            "sayaib.hue-console.schemaDiff",
            "sayaib.hue-console.partitionCalc",
            "sayaib.hue-console.deltaLakeAnalyzer",
            "sayaib.hue-console.sparkCostEstimator",
            "sayaib.hue-console.chunkingTester",
            "sayaib.hue-console.embeddingCost",
            "sayaib.hue-console.contextWindow",
            "sayaib.hue-console.semanticDedup",
            "sayaib.hue-console.ragEvalScores",
            "sayaib.hue-console.hybridSearchRrf",
            "sayaib.hue-console.ragHallucinationAnalyzer",
            "sayaib.hue-console.milestoneTracker",
            "sayaib.hue-console.showSnippets"
        ];
        const failures = [];
        for (const command of webviewCommands) {
            try {
                await vscode.commands.executeCommand(command);
            }
            catch (error) {
                failures.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        assert.deepStrictEqual(failures, [], `these tools failed to open:\n${failures.join("\n")}`);
    });
    test("running a tool twice reuses its panel instead of stacking panels", async () => {
        const label = "Base64 Encoder/Decoder";
        const countTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.label === label).length;
        await vscode.commands.executeCommand("sayaib.hue-console.base64Encoder");
        // Tab bookkeeping is asynchronous, so wait for the first panel to appear.
        for (let attempt = 0; attempt < 40 && countTabs() === 0; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.strictEqual(countTabs(), 1, "the first run should open exactly one panel");
        await vscode.commands.executeCommand("sayaib.hue-console.base64Encoder");
        // Give a stray second panel time to appear before asserting it did not.
        for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            assert.strictEqual(countTabs(), 1, "a second run must reveal the open panel, not create another");
        }
    });
    test("workspace tools complete without throwing", async () => {
        // Confirmation prompts are refused by the test host, so these also verify
        // that a prompt which cannot be shown is handled instead of escaping.
        const workspaceCommands = [
            "sayaib.hue-console.securityAudit",
            "sayaib.hue-console.cloudSecurityAudit",
            "sayaib.hue-console.devopsGenerator",
            "sayaib.hue-console.mlopsGenerator",
            "sayaib.hue-console.observabilityStarter",
            "sayaib.hue-console.readmeManager",
            "sayaib.hue-console.removeUnusedImports"
        ];
        for (const command of workspaceCommands) {
            await assert.doesNotReject(() => Promise.resolve(vscode.commands.executeCommand(command)), `${command} threw instead of reporting its result`);
        }
    });
    test("commands that need an editor selection do not throw without one", async () => {
        for (const command of ["sayaib.hue-console.createCustomSnippet", "sayaib.hue-console.observabilityAnalyze"]) {
            await assert.doesNotReject(() => Promise.resolve(vscode.commands.executeCommand(command)), `${command} threw with no active editor`);
        }
    });
});
//# sourceMappingURL=extension.test.js.map