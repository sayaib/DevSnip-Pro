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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const snippet_utils_1 = require("../../utils/snippet-utils");
const run_unit_tests_1 = require("./run-unit-tests");
const SNIPPET = { log: { prefix: "log", body: ["console.log($1);"], description: "Log" } };
function sandbox() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-snippets-"));
    const extension = path.join(root, "extensions", "sayaib.hue-console-11.75.1");
    const live = path.join(extension, "custom");
    fs.mkdirSync(live, { recursive: true });
    for (const language of ["javascript", "python"])
        fs.writeFileSync(path.join(live, `custom_${language}.json`), "{}");
    return { root, extension, live, backup: path.join(root, "globalStorage", "snippets") };
}
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
(0, run_unit_tests_1.suite)("snippets survive updates", () => {
    (0, run_unit_tests_1.test)("every save is mirrored to the backup folder", async () => {
        const box = sandbox();
        (0, snippet_utils_1.setSnippetBackupFolder)(box.backup);
        try {
            await (0, snippet_utils_1.saveSnippets)(path.join(box.live, "custom_javascript.json"), SNIPPET);
            assert.deepStrictEqual(read(path.join(box.backup, "custom_javascript.json")), SNIPPET);
        }
        finally {
            (0, snippet_utils_1.setSnippetBackupFolder)(undefined);
            fs.rmSync(box.root, { recursive: true, force: true });
        }
    });
    (0, run_unit_tests_1.test)("an update's empty snippet file is restored from the backup", async () => {
        const box = sandbox();
        try {
            fs.mkdirSync(box.backup, { recursive: true });
            fs.writeFileSync(path.join(box.backup, "custom_javascript.json"), JSON.stringify(SNIPPET));
            assert.strictEqual(await (0, snippet_utils_1.syncSnippetBackups)(box.live, box.backup, box.extension), 1);
            assert.deepStrictEqual(read(path.join(box.live, "custom_javascript.json")), SNIPPET);
            assert.deepStrictEqual(read(path.join(box.live, "custom_python.json")), {}, "other languages are untouched");
            assert.strictEqual(await (0, snippet_utils_1.syncSnippetBackups)(box.live, box.backup, box.extension), 0, "nothing to restore the second time");
        }
        finally {
            fs.rmSync(box.root, { recursive: true, force: true });
        }
    });
    (0, run_unit_tests_1.test)("the extension's own file wins, so edits and deletions are kept", async () => {
        const box = sandbox();
        try {
            fs.mkdirSync(box.backup, { recursive: true });
            fs.writeFileSync(path.join(box.backup, "custom_javascript.json"), JSON.stringify({ ...SNIPPET, old: { prefix: "old", body: ["x"], description: "" } }));
            fs.writeFileSync(path.join(box.live, "custom_javascript.json"), JSON.stringify(SNIPPET));
            assert.strictEqual(await (0, snippet_utils_1.syncSnippetBackups)(box.live, box.backup, box.extension), 0);
            assert.deepStrictEqual(read(path.join(box.backup, "custom_javascript.json")), SNIPPET, "the backup follows the live file");
        }
        finally {
            fs.rmSync(box.root, { recursive: true, force: true });
        }
    });
    (0, run_unit_tests_1.test)("the first run recovers snippets from the previous installed version", async () => {
        const box = sandbox();
        try {
            const old = path.join(box.root, "extensions", "sayaib.hue-console-11.74.3", "custom");
            const older = path.join(box.root, "extensions", "sayaib.hue-console-11.9.1", "custom");
            fs.mkdirSync(old, { recursive: true });
            fs.mkdirSync(older, { recursive: true });
            fs.writeFileSync(path.join(old, "custom_python.json"), JSON.stringify(SNIPPET));
            fs.writeFileSync(path.join(older, "custom_python.json"), JSON.stringify({ stale: { prefix: "s", body: ["s"], description: "" } }));
            fs.mkdirSync(path.join(box.root, "extensions", "someone.else-99.0.0", "custom"), { recursive: true });
            assert.strictEqual(await (0, snippet_utils_1.syncSnippetBackups)(box.live, box.backup, box.extension), 1);
            assert.deepStrictEqual(read(path.join(box.live, "custom_python.json")), SNIPPET, "the newest older version is used");
            assert.deepStrictEqual(read(path.join(box.backup, "custom_python.json")), SNIPPET);
        }
        finally {
            fs.rmSync(box.root, { recursive: true, force: true });
        }
    });
    (0, run_unit_tests_1.test)("a broken snippet file is left alone", async () => {
        const box = sandbox();
        try {
            fs.writeFileSync(path.join(box.live, "custom_javascript.json"), "{ not json");
            fs.mkdirSync(box.backup, { recursive: true });
            fs.writeFileSync(path.join(box.backup, "custom_javascript.json"), JSON.stringify(SNIPPET));
            assert.strictEqual(await (0, snippet_utils_1.syncSnippetBackups)(box.live, box.backup, box.extension), 0);
            assert.strictEqual(fs.readFileSync(path.join(box.live, "custom_javascript.json"), "utf8"), "{ not json");
        }
        finally {
            fs.rmSync(box.root, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=snippets.unit.js.map