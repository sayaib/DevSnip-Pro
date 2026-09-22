import * as assert from "assert";
import { findConsoleLogs } from "../../commands/listAndRemoveConsoleLogsCommand";
import { analyzeFileImports } from "../../commands/removeUnusedImportsCommand";
import { suite, test } from "./run-unit-tests";

suite("console.log scanner", () => {
  test("finds a plain call with its offsets", () => {
    const source = 'const a = 1;\nconsole.log("hello");\nconst b = 2;\n';
    const logs = findConsoleLogs(source, "/tmp/a.ts");
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].lineNumber, 2);
    assert.strictEqual(source.slice(logs[0].startOffset, logs[0].endOffset), 'console.log("hello");');
  });

  test("ignores commented-out and quoted occurrences", () => {
    const source = [
      '// console.log("commented");',
      '/* console.log("block"); */',
      'const text = "console.log(\\"quoted\\")";',
      "const tpl = `console.log('in template')`;"
    ].join("\n");
    assert.deepStrictEqual(findConsoleLogs(source, "/tmp/b.ts"), []);
  });

  test("handles nested parentheses and multi-line calls", () => {
    const source = 'console.log(JSON.stringify({ a: (1 + 2) }),\n  "second arg");\nnext();';
    const logs = findConsoleLogs(source, "/tmp/c.ts");
    assert.strictEqual(logs.length, 1);
    assert.ok(logs[0].text.endsWith('"second arg");'));
  });

  test("does not match similarly named identifiers", () => {
    const source = "myconsole.log(1);\nconsole.logger(2);\nconsole.warn(3);";
    assert.deepStrictEqual(findConsoleLogs(source, "/tmp/d.ts"), []);
  });

  test("offsets stay correct for several calls in one file", () => {
    const source = 'console.log(1);\nfoo();\nconsole.log(2);\n';
    const logs = findConsoleLogs(source, "/tmp/e.ts");
    assert.strictEqual(logs.length, 2);
    for (const log of logs) {
      assert.strictEqual(source.slice(log.startOffset, log.endOffset), log.text);
    }
  });
});

suite("unused import analysis", () => {
  test("reports an import whose symbols are never referenced", () => {
    const source = 'import { unusedThing } from "./x";\nconst value = 1;\n';
    const found = analyzeFileImports(source, "/tmp/a.ts");
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual(found[0].importedSymbols, ["unusedThing"]);
  });

  test("keeps imports that are used", () => {
    const source = 'import { usedThing } from "./x";\nusedThing();\n';
    assert.deepStrictEqual(analyzeFileImports(source, "/tmp/b.ts"), []);
  });

  test("a symbol mentioned only in a comment or string still counts as unused", () => {
    const source = 'import { ghost } from "./x";\n// ghost is documented here\nconst note = "ghost";\n';
    assert.strictEqual(analyzeFileImports(source, "/tmp/c.ts").length, 1);
  });

  test("handles default, namespace and aliased imports", () => {
    const used = 'import Thing from "./x";\nimport * as ns from "./y";\nimport { a as b } from "./z";\nThing(); ns.go(); b();\n';
    assert.deepStrictEqual(analyzeFileImports(used, "/tmp/d.ts"), []);

    const unused = 'import Thing from "./x";\nimport * as ns from "./y";\n';
    assert.strictEqual(analyzeFileImports(unused, "/tmp/e.ts").length, 2);
  });

  test("does not treat a partial name match as usage", () => {
    const source = 'import { user } from "./x";\nconst username = 1;\nconsole.log(username);\n';
    assert.strictEqual(analyzeFileImports(source, "/tmp/f.ts").length, 1);
  });

  test("analyses Python imports", () => {
    assert.strictEqual(analyzeFileImports("import os\nprint(1)\n", "/tmp/g.py").length, 1);
    assert.strictEqual(analyzeFileImports("import os\nprint(os.getcwd())\n", "/tmp/h.py").length, 0);
    assert.strictEqual(analyzeFileImports("from a import thing as t\nt()\n", "/tmp/i.py").length, 0);
  });

  test("analyses Java imports", () => {
    assert.strictEqual(analyzeFileImports("import java.util.List;\nclass A {}\n", "/tmp/A.java").length, 1);
    assert.strictEqual(analyzeFileImports("import java.util.List;\nclass A { List<String> x; }\n", "/tmp/B.java").length, 0);
    assert.strictEqual(analyzeFileImports("import java.util.*;\nclass A {}\n", "/tmp/C.java").length, 0, "wildcard imports are not analysable");
  });

  test("ignores files in unsupported languages", () => {
    assert.deepStrictEqual(analyzeFileImports('import x from "y";', "/tmp/j.txt"), []);
  });
});
