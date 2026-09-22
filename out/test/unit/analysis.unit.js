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
const listAndRemoveConsoleLogsCommand_1 = require("../../commands/listAndRemoveConsoleLogsCommand");
const removeUnusedImportsCommand_1 = require("../../commands/removeUnusedImportsCommand");
const run_unit_tests_1 = require("./run-unit-tests");
(0, run_unit_tests_1.suite)("console.log scanner", () => {
    (0, run_unit_tests_1.test)("finds a plain call with its offsets", () => {
        const source = 'const a = 1;\nconsole.log("hello");\nconst b = 2;\n';
        const logs = (0, listAndRemoveConsoleLogsCommand_1.findConsoleLogs)(source, "/tmp/a.ts");
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].lineNumber, 2);
        assert.strictEqual(source.slice(logs[0].startOffset, logs[0].endOffset), 'console.log("hello");');
    });
    (0, run_unit_tests_1.test)("ignores commented-out and quoted occurrences", () => {
        const source = [
            '// console.log("commented");',
            '/* console.log("block"); */',
            'const text = "console.log(\\"quoted\\")";',
            "const tpl = `console.log('in template')`;"
        ].join("\n");
        assert.deepStrictEqual((0, listAndRemoveConsoleLogsCommand_1.findConsoleLogs)(source, "/tmp/b.ts"), []);
    });
    (0, run_unit_tests_1.test)("handles nested parentheses and multi-line calls", () => {
        const source = 'console.log(JSON.stringify({ a: (1 + 2) }),\n  "second arg");\nnext();';
        const logs = (0, listAndRemoveConsoleLogsCommand_1.findConsoleLogs)(source, "/tmp/c.ts");
        assert.strictEqual(logs.length, 1);
        assert.ok(logs[0].text.endsWith('"second arg");'));
    });
    (0, run_unit_tests_1.test)("does not match similarly named identifiers", () => {
        const source = "myconsole.log(1);\nconsole.logger(2);\nconsole.warn(3);";
        assert.deepStrictEqual((0, listAndRemoveConsoleLogsCommand_1.findConsoleLogs)(source, "/tmp/d.ts"), []);
    });
    (0, run_unit_tests_1.test)("offsets stay correct for several calls in one file", () => {
        const source = 'console.log(1);\nfoo();\nconsole.log(2);\n';
        const logs = (0, listAndRemoveConsoleLogsCommand_1.findConsoleLogs)(source, "/tmp/e.ts");
        assert.strictEqual(logs.length, 2);
        for (const log of logs) {
            assert.strictEqual(source.slice(log.startOffset, log.endOffset), log.text);
        }
    });
});
(0, run_unit_tests_1.suite)("unused import analysis", () => {
    (0, run_unit_tests_1.test)("reports an import whose symbols are never referenced", () => {
        const source = 'import { unusedThing } from "./x";\nconst value = 1;\n';
        const found = (0, removeUnusedImportsCommand_1.analyzeFileImports)(source, "/tmp/a.ts");
        assert.strictEqual(found.length, 1);
        assert.deepStrictEqual(found[0].importedSymbols, ["unusedThing"]);
    });
    (0, run_unit_tests_1.test)("keeps imports that are used", () => {
        const source = 'import { usedThing } from "./x";\nusedThing();\n';
        assert.deepStrictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)(source, "/tmp/b.ts"), []);
    });
    (0, run_unit_tests_1.test)("a symbol mentioned only in a comment or string still counts as unused", () => {
        const source = 'import { ghost } from "./x";\n// ghost is documented here\nconst note = "ghost";\n';
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)(source, "/tmp/c.ts").length, 1);
    });
    (0, run_unit_tests_1.test)("handles default, namespace and aliased imports", () => {
        const used = 'import Thing from "./x";\nimport * as ns from "./y";\nimport { a as b } from "./z";\nThing(); ns.go(); b();\n';
        assert.deepStrictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)(used, "/tmp/d.ts"), []);
        const unused = 'import Thing from "./x";\nimport * as ns from "./y";\n';
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)(unused, "/tmp/e.ts").length, 2);
    });
    (0, run_unit_tests_1.test)("does not treat a partial name match as usage", () => {
        const source = 'import { user } from "./x";\nconst username = 1;\nconsole.log(username);\n';
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)(source, "/tmp/f.ts").length, 1);
    });
    (0, run_unit_tests_1.test)("analyses Python imports", () => {
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)("import os\nprint(1)\n", "/tmp/g.py").length, 1);
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)("import os\nprint(os.getcwd())\n", "/tmp/h.py").length, 0);
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)("from a import thing as t\nt()\n", "/tmp/i.py").length, 0);
    });
    (0, run_unit_tests_1.test)("analyses Java imports", () => {
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)("import java.util.List;\nclass A {}\n", "/tmp/A.java").length, 1);
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)("import java.util.List;\nclass A { List<String> x; }\n", "/tmp/B.java").length, 0);
        assert.strictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)("import java.util.*;\nclass A {}\n", "/tmp/C.java").length, 0, "wildcard imports are not analysable");
    });
    (0, run_unit_tests_1.test)("ignores files in unsupported languages", () => {
        assert.deepStrictEqual((0, removeUnusedImportsCommand_1.analyzeFileImports)('import x from "y";', "/tmp/j.txt"), []);
    });
});
//# sourceMappingURL=analysis.unit.js.map