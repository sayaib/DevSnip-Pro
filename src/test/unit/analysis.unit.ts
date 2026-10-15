import * as assert from "assert";
import { analyzeFileImports } from "../../commands/removeUnusedImportsCommand";
import { suite, test } from "./run-unit-tests";

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

  test("never removes Python imports that change compilation or are re-exported", () => {
    assert.deepStrictEqual(analyzeFileImports("from __future__ import annotations\nx = 1\n", "/tmp/m.py"), []);
    assert.deepStrictEqual(analyzeFileImports("from .models import User\n", "/tmp/pkg/__init__.py"), [], "__init__.py re-exports its imports");
    assert.deepStrictEqual(analyzeFileImports("from .models import User\n__all__ = ['User']\n", "/tmp/pkg/api.py"), [], "names in __all__ are exported");
    assert.deepStrictEqual(analyzeFileImports("from .models import User, Order\n__all__ = ['User']\n", "/tmp/pkg/api2.py"), [], "only all-unused statements are listed; Order alone is not enough");
    assert.strictEqual(analyzeFileImports("from .models import User, Order\n__all__ = ['Other']\n", "/tmp/pkg/api3.py").length, 1);
  });

  test("names used in interpolations are used", () => {
    assert.deepStrictEqual(analyzeFileImports('import { format } from "./f";\nconst s = `at ${format(d)}`;\n', "/tmp/t.ts"), []);
    assert.deepStrictEqual(analyzeFileImports("import os\nprint(f\"{os.sep}\")\n", "/tmp/f.py"), []);
    assert.deepStrictEqual(analyzeFileImports("import a.b.Thing\nval s = \"${Thing.x} and $other\"\n", "/tmp/K.kt"), []);
  });

  test("a URL string is not taken for a comment", () => {
    assert.deepStrictEqual(analyzeFileImports('import { headers } from "./h";\nfetch("http://api.example.com", { headers });\n', "/tmp/u.ts"), []);
  });

  test("keeps React when the file has JSX (classic runtime)", () => {
    assert.deepStrictEqual(analyzeFileImports('import React from "react";\nexport const A = () => <div />;\n', "/tmp/A.tsx"), []);
    assert.strictEqual(analyzeFileImports('import React from "react";\nexport const n = 1;\n', "/tmp/B.ts").length, 1);
  });

  test("handles multi-line named imports as one statement", () => {
    const source = 'import {\n  alpha,\n  beta,\n} from "./x";\nimport {\n  gamma,\n} from "./y";\nalpha();\n';
    const found = analyzeFileImports(source, "/tmp/m.ts");
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual([found[0].lineNumber, found[0].endLineNumber, found[0].importedSymbols], [5, 7, ["gamma"]]);
  });

  test("analyses Kotlin imports, keeping implicit operator imports", () => {
    assert.strictEqual(analyzeFileImports("import java.time.Instant\nfun main() {}\n", "/tmp/A.kt").length, 1);
    assert.deepStrictEqual(analyzeFileImports("import androidx.compose.runtime.getValue\nimport androidx.compose.runtime.remember\nval x by remember { 1 }\n", "/tmp/B.kt"), []);
    assert.deepStrictEqual(analyzeFileImports("import a.b.Long as L\nval x: L = 1\n", "/tmp/C.kt"), []);
    assert.deepStrictEqual(analyzeFileImports("import kotlinx.coroutines.*\n", "/tmp/D.kt"), [], "wildcards are not analysable");
  });
});
