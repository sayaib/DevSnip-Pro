import * as assert from "assert";
import { applyEdits, findDebugStatements, findDebugStatementsInFile, planRemovals } from "../../debug/find-logs";
import { InsertRequest, expressionAt, planDebugLog } from "../../debug/insert-log";
import { CODE, LogLanguage, STRING, lex } from "../../debug/syntax";
import { suite, test } from "./run-unit-tests";

const kinds = (text: string, language: LogLanguage) => findDebugStatements(text, language).map(s => s.kind);
const clean = (text: string, language: LogLanguage) => applyEdits(text, planRemovals(text, findDebugStatements(text, language)).edits);
const codeAt = (text: string, language: LogLanguage, needle: string) => lex(text, language).mask[text.indexOf(needle)] === CODE;

/** Inserts the planned log into `text`, with the cursor on the first `needle` (or the nth). */
function insert(languageId: string, text: string, needle: string, extra: Partial<InsertRequest> = {}, nth = 0): string {
  const lines = text.split("\n");
  let line = -1, column = -1, seen = 0;
  for (let i = 0; i < lines.length && line < 0; i++) {
    const at = new RegExp(`(?<![\\w$])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`).exec(lines[i]);
    if (at && seen++ === nth) { line = i; column = at.index; }
  }
  assert.ok(line >= 0, `${needle} not found`);
  const plan = planDebugLog({ languageId, text, line, column, expression: needle, fileName: "file", indentUnit: "    ", ...extra });
  assert.ok(plan, "no plan");
  lines.splice(plan.line, 0, plan.text);
  return lines.join("\n");
}

suite("debug logs: lexing", () => {
  test("strings with interpolation holes that contain quotes", () => {
    const js = 'const a = `x ${obj["k"]} y`; console.log(1);';
    assert.ok(codeAt(js, "javascript", "console"));
    const kt = 'val s = "a ${m["k"]} b"; println(1)';
    assert.ok(codeAt(kt, "kotlin", "println"));
    const swift = 'let s = "a \\(d["k"]!) b"; print(1)';
    assert.ok(codeAt(swift, "swift", "print(1)"));
    const cs = 'var s = $"a {d["k"]} b"; Console.WriteLine(1);';
    assert.ok(codeAt(cs, "csharp", "Console"));
    const dart = "final s = 'a ${m['k']} b'; print(1);";
    assert.ok(codeAt(dart, "dart", "print(1)"));
  });

  test("raw, verbatim and triple-quoted strings", () => {
    assert.ok(!codeAt('let s = #"print("x")"#\n', "swift", "print"));
    assert.ok(!codeAt('var s = @"a ""print(1)"" b";', "csharp", "print"));
    assert.ok(!codeAt('var s = """\n  Console.WriteLine(1);\n  """;', "csharp", "Console"));
    assert.ok(!codeAt('s = """\nprint(1)\n"""\n', "python", "print"));
    assert.ok(codeAt("final s = r'\\'; print(1);", "dart", "print"), "a raw Dart string has no escapes, so it ends at the first quote");
    assert.ok(!codeAt('String s = """\n  System.out.println(1);\n  """;', "java", "System"));
  });

  test("comments, including nested block comments", () => {
    assert.ok(!codeAt("/* a /* b */ println(1) */ val x = 1", "kotlin", "println"));
    assert.ok(codeAt("/* a /* b */ console.log(1) */", "javascript", "console"), "JavaScript block comments do not nest");
    assert.ok(!codeAt("# print(1)\n", "python", "print"));
  });

  test("regex literals and JSX text", () => {
    const js = "const re = /['\"]/g; console.log(re);";
    assert.ok(codeAt(js, "javascript", "console"));
    const jsx = "const a = <p>Don't stop</p>;\nconsole.log(a);";
    assert.ok(codeAt(jsx, "javascript", "console"));
    assert.strictEqual(lex("a / b / c", "javascript").mask.indexOf(STRING), -1, "division is not a regex");
  });
});

suite("debug logs: finding", () => {
  test("finds each language's debug calls", () => {
    assert.deepStrictEqual(kinds("console.log(1);\nconsole.debug(2);\nconsole.table(t);\ndebugger;\nconsole.error(e);\nconsole.warn(w);\n", "javascript"), ["console.log", "console.debug", "console.table", "debugger"]);
    assert.deepStrictEqual(kinds("print(x)\npprint(y)\npprint.pprint(z)\nbreakpoint()\nimport pdb; pdb.set_trace()\nlogger.info(x)\n", "python"), ["print", "pprint", "pprint.pprint", "breakpoint", "pdb.set_trace"]);
    assert.deepStrictEqual(kinds("System.out.println(a);\nSystem.err.printf(\"%s\", b);\nLog.d(TAG, c);\nLog.e(TAG, d);\nlog.debug(e);\n", "java"), ["System.out.println", "System.err.printf", "Log.d"]);
    assert.deepStrictEqual(kinds("println(a)\nprint(b)\nLog.v(TAG, c)\nlogger.info(d)\n", "kotlin"), ["println", "print", "Log.v"]);
    assert.deepStrictEqual(kinds("Console.WriteLine(a);\nDebug.WriteLine(b);\nSystem.Diagnostics.Debug.Print(c);\nDebugger.Break();\n_logger.LogInformation(d);\n", "csharp"), ["Console.WriteLine", "Debug.WriteLine", "System.Diagnostics.Debug.Print", "Debugger.Break"]);
    assert.deepStrictEqual(kinds("print(a);\ndebugPrint(b);\nlog(c);\n", "dart"), ["print", "debugPrint"]);
    assert.deepStrictEqual(kinds("print(a)\ndebugPrint(b)\ndump(c)\nNSLog(@\"x\")\nlogger.debug(\"d\")\n", "swift"), ["print", "debugPrint", "dump", "NSLog"]);
  });

  test("ignores methods and longer names that merely contain a debug call", () => {
    assert.deepStrictEqual(kinds("printer.print(x)\nreprint(y)\ndef print_all(): pass\n", "python"), []);
    assert.deepStrictEqual(kinds("myconsole.log(1);\nconsole.logger(2);\nthis.console.log(3);\n", "javascript"), []);
    assert.deepStrictEqual(kinds("view?.print(x)\nfun print(x: Int) {}\n", "kotlin").length, 1, "a declaration's name is found but cannot be removed");
    assert.strictEqual(findDebugStatements("fun print(x: Int) {}\n", "kotlin")[0].removable, false);
  });

  test("only standalone statements can be removed, with a reason for the rest", () => {
    const source = [
      "function f(x) {",
      "  if (x) console.log(x);",
      "  items.forEach(i => console.log(i));",
      "  if (y)",
      "    console.log(y);",
      "  const v = cond ?",
      "    console.log(1) : 2;",
      "  console.log(\"alone\"); // trailing comment",
      "  console.log(",
      "    \"multi\",",
      "    x,",
      "  );",
      "}"
    ].join("\n");
    const found = findDebugStatements(source, "javascript").map(s => [s.line, s.removable]);
    assert.deepStrictEqual(found, [[2, false], [3, false], [5, false], [7, false], [8, true], [9, true]]);
    assert.strictEqual(clean(source, "javascript"), ["function f(x) {", "  if (x) console.log(x);", "  items.forEach(i => console.log(i));", "  if (y)", "    console.log(y);", "  const v = cond ?", "    console.log(1) : 2;", "}"].join("\n"));
  });

  test("ignores debug calls in comments and strings, in every language", () => {
    assert.deepStrictEqual(kinds('// console.log(1)\n/* console.log(2) */\nconst s = "console.log(3)";\n', "javascript"), []);
    assert.deepStrictEqual(kinds('# print(1)\ns = "print(2)"\nt = """\nprint(3)\n"""\n', "python"), []);
    assert.deepStrictEqual(kinds('// Console.WriteLine(1);\nvar s = "Console.WriteLine(2);";\n', "csharp"), []);
  });

  test("scans <script> blocks of HTML, Vue and Svelte files only", () => {
    const vue = "<template><p>console.log(1) don't</p></template>\n<script setup>\nconsole.log(2);\n</script>\n<script type=\"application/json\">{\"console.log\": 3}</script>";
    const found = findDebugStatementsInFile(vue, "/x/App.vue");
    assert.deepStrictEqual(found.map(s => [s.line, s.text]), [[3, "console.log(2);"]]);
    assert.deepStrictEqual(findDebugStatementsInFile("print(1)", "/x/notes.txt"), []);
  });
});

suite("debug logs: removing", () => {
  test("Python blocks left empty get pass", () => {
    const source = "def f(x):\n    print(x)\n\nif x:\n    print(1)\n    # note\n    print(2)\nelse:\n    y = 1\n    print(y)\n";
    assert.strictEqual(clean(source, "python"), "def f(x):\n    pass\n\nif x:\n    pass\n    # note\nelse:\n    y = 1\n");
  });

  test("Swift and Dart switch cases left empty get break", () => {
    const swift = "switch x {\ncase 1:\n    print(\"one\")\ncase 2:\n    print(\"two\")\n    go()\ndefault:\n    print(\"d\")\n}\n";
    assert.strictEqual(clean(swift, "swift"), "switch x {\ncase 1:\n    break\ncase 2:\n    go()\ndefault:\n    break\n}\n");
    const dart = "switch (x) {\n  case 1:\n    print('one');\n  case 2:\n    go();\n}\n";
    assert.strictEqual(clean(dart, "dart"), "switch (x) {\n  case 1:\n    break;\n  case 2:\n    go();\n}\n");
  });

  test("brace languages keep their structure", () => {
    const java = "class A {\n  void f() {\n    System.out.println(\"a\");\n  }\n  void g() {\n    for (int i = 0; i < 3; i++)\n      System.out.println(i);\n  }\n}\n";
    const found = findDebugStatements(java, "java");
    assert.deepStrictEqual(found.map(s => s.removable), [true, false]);
    assert.strictEqual(clean(java, "java"), "class A {\n  void f() {\n  }\n  void g() {\n    for (int i = 0; i < 3; i++)\n      System.out.println(i);\n  }\n}\n");
    const cs = "if (ok)\n{\n    Console.WriteLine(\"ok\");\n}\nelse\n    Console.WriteLine(\"no\");\n";
    assert.deepStrictEqual(findDebugStatements(cs, "csharp").map(s => s.removable), [true, false]);
  });

  test("keeps CRLF line endings and skips statements that changed", () => {
    const source = "a();\r\nconsole.log(1);\r\nb();\r\n";
    assert.strictEqual(clean(source, "javascript"), "a();\r\nb();\r\n");
    const found = findDebugStatements(source, "javascript");
    const changed = source.replace("console.log(1)", "console.log(2)");
    const plan = planRemovals(changed, found);
    assert.deepStrictEqual([plan.edits.length, plan.skipped.length], [0, 1]);
  });
});

suite("debug logs: inserting", () => {
  test("picks the expression under the cursor, including member chains", () => {
    assert.deepStrictEqual(expressionAt("  return user?.profile.name;", 18), { text: "user?.profile.name", start: 9 });
    assert.deepStrictEqual(expressionAt("val x = order!!.total", 12), { text: "order!!.total", start: 8 });
    assert.strictEqual(expressionAt("   ", 1), undefined);
  });

  test("JavaScript: after the whole statement, matching the file's quotes and semicolons", () => {
    assert.strictEqual(insert("typescript", "const total = items\n  .map(x => x.price)\n  .reduce((a, b) => a + b, 0);\nnext();", "total"),
      'const total = items\n  .map(x => x.price)\n  .reduce((a, b) => a + b, 0);\nconsole.log("[file:1] total:", total);\nnext();');
    assert.strictEqual(insert("javascript", "const user = await find(\n  id,\n)\nsend(user)\nreturn user", "id"),
      "const user = await find(\n  id,\n)\nconsole.log('[file:2] id:', id)\nsend(user)\nreturn user".replace("'[file:2] id:'", '"[file:2] id:"'));
    assert.strictEqual(insert("javascript", "const a = 'x';\nconst b = 'y';\nconst c = 'z';\nuse(c);", "c"), "const a = 'x';\nconst b = 'y';\nconst c = 'z';\nconsole.log('[file:3] c:', c);\nuse(c);");
  });

  test("JavaScript: parameters are logged at the top of the body; return values before the return", () => {
    assert.strictEqual(insert("typescript", "function f(user: User): string {\n  return user.name;\n}", "user"), 'function f(user: User): string {\n  console.log("[file:1] user:", user);\n  return user.name;\n}');
    assert.strictEqual(insert("typescript", "items.forEach((item) => {\n  use(item);\n});", "item"), 'items.forEach((item) => {\n  console.log("[file:1] item:", item);\n  use(item);\n});');
    assert.strictEqual(insert("typescript", "function f() {\n  const x = 1;\n  return x;\n}", "x", {}, 1), 'function f() {\n  const x = 1;\n  console.log("[file:3] x:", x);\n  return x;\n}');
    assert.strictEqual(insert("javascript", "const config = {\n  a: 1,\n  user: getUser(),\n};\nrun();", "user"), 'const config = {\n  a: 1,\n  user: getUser(),\n};\nconsole.log("[file:3] user:", user);\nrun();');
    assert.strictEqual(insert("javascript", "app.get('/', (req, res) => {\n  res.send('ok');\n});", "app"), "app.get('/', (req, res) => {\n  res.send('ok');\n});\nconsole.log('[file:1] app:', app);");
  });

  test("an assigned variable is logged after its statement, never inside an object literal or its own body", () => {
    assert.strictEqual(insert("typescript", "const result = await race(async () => hook({\n  request,\n}));\nreturn result;", "result"),
      'const result = await race(async () => hook({\n  request,\n}));\nconsole.log("[file:1] result:", result);\nreturn result;');
    assert.strictEqual(insert("typescript", "const handler = (req: Req) => {\n  return req.url;\n};\nuse(handler);", "handler"),
      'const handler = (req: Req) => {\n  return req.url;\n};\nconsole.log("[file:1] handler:", handler);\nuse(handler);');
  });

  test("a function assigned to a variable is logged after its body, not in a nested call", () => {
    const source = "const withProgress = (stream: S): S => {\n  let n = 0;\n  return stream.pipe(new T({\n    transform(chunk) {},\n  }));\n};\nnext();";
    assert.ok(insert("typescript", source, "withProgress").endsWith('};\nconsole.log("[file:1] withProgress:", withProgress);\nnext();'));
  });

  test("never inserts inside a multi-line string or between a decorator and its target", () => {
    assert.strictEqual(insert("python", 'msg = """\\\nline one\nline two\n"""\nuse(msg)', "msg"), 'msg = """\\\nline one\nline two\n"""\nprint(f"[file:1] {msg=}")\nuse(msg)');
    assert.ok(insert("javascript", "const html = `\n  <p>${x}</p>\n`;\nrender(html);", "html").includes('`;\nconsole.log("[file:1] html:", html);'));
    const decorated = '@click.option(\n    "--cert",\n    type=Cert(),\n)\ndef run(cert):\n    pass\n';
    assert.strictEqual(planDebugLog({ languageId: "python", text: decorated, line: 2, column: 4, expression: "type", fileName: "cli.py", indentUnit: "    " }), undefined);
    assert.strictEqual(planDebugLog({ languageId: "java", text: '@GetMapping("/x")\nUser get() {}', line: 0, column: 1, expression: "GetMapping", fileName: "A.java", indentUnit: "    " }), undefined);
  });

  test("declines a parameter of a function whose body is not a block", () => {
    const py = "def locate(\n    module_name: str,\n) -> App: ...\n";
    assert.strictEqual(planDebugLog({ languageId: "python", text: py, line: 1, column: 4, expression: "module_name", fileName: "a.py", indentUnit: "    " }), undefined);
    assert.strictEqual(planDebugLog({ languageId: "kotlin", text: "fun twice(x: Int) = x * 2\n", line: 0, column: 10, expression: "x", fileName: "A.kt", indentUnit: "    " }), undefined);
    assert.ok(insert("kotlin", "fun twice(x: Int): Int {\n    return x * 2\n}", "x").includes('fun twice(x: Int): Int {\n    println("[file:1] x=${x}")'));
  });

  test("declines class-level fields and top-level declarations where statements are not allowed", () => {
    const plan = (languageId: string, text: string, line: number, expression: string, fileName = "f") =>
      planDebugLog({ languageId, text, line, column: text.split("\n")[line].indexOf(expression), expression, fileName, indentUnit: "  " });
    assert.strictEqual(plan("dart", "class A {\n  final _items = <int>[];\n}", 1, "_items"), undefined);
    assert.strictEqual(plan("java", "class A\n{\n  private int count = 0;\n}", 2, "count"), undefined);
    assert.strictEqual(plan("typescript", "export class Store {\n  items = new Map();\n}", 1, "items"), undefined);
    assert.strictEqual(plan("kotlin", "class A(val name: String) {\n}", 0, "name"), undefined);
    assert.strictEqual(plan("kotlin", "val greeting = \"hi\"\n", 0, "greeting"), undefined);
    assert.strictEqual(plan("swift", "let config = load()\n", 0, "config", "Config.swift"), undefined);
    assert.ok(plan("swift", "let config = load()\n", 0, "config", "main.swift"));
    assert.ok(plan("csharp", "var app = builder.Build();\napp.Run();\n", 0, "app"), "C# top-level statements");
    assert.ok(plan("typescript", "const port = 3000;\nlisten(port);", 0, "port"), "JavaScript module scope");
    assert.ok(plan("javascript", "class A {\n  run() {\n    const x = 1;\n  }\n}", 2, "x"), "a method body inside a class is fine");
    assert.ok(plan("python", "class A:\n    x = 1\n", 1, "x"), "Python class bodies run statements");
    assert.ok(insert("java", "class A {\n  void f(int n) {\n  }\n}", "n", { indentUnit: "  " }).includes('  void f(int n) {\n    System.out.println("[file:2] n=" + n);'), "a method parameter is logged in the method body");
  });

  test("does nothing for a name inside a comment or string", () => {
    const text = "// const user = load();\nconst s = 'user';\n";
    assert.strictEqual(planDebugLog({ languageId: "javascript", text, line: 0, column: 9, expression: "user", fileName: "a.js", indentUnit: "  " }), undefined);
    assert.strictEqual(planDebugLog({ languageId: "javascript", text, line: 1, column: 11, expression: "user", fileName: "a.js", indentUnit: "  " }), undefined);
  });

  test("Python: f-string or the module's logger, inside block headers", () => {
    assert.strictEqual(insert("python", "def f(items):\n    for item in items:\n        use(item)\n", "item"), 'def f(items):\n    for item in items:\n        print(f"[file:2] {item=}")\n        use(item)\n');
    assert.strictEqual(insert("python", "import logging\nlogger = logging.getLogger(__name__)\n\ndef f(user):\n    return user\n", "user"), 'import logging\nlogger = logging.getLogger(__name__)\n\ndef f(user):\n    logger.debug("[file:4] user=%r", user)\n    return user\n');
    assert.strictEqual(insert("python", 'data = load()\nnext()', "data", { expression: 'data["k"]' }).split("\n")[1], "print(f'[file:1] {data[\"k\"]=}')");
  });

  test("a binding in an if / while header is logged inside its block; a guard binding after the guard", () => {
    const swift = "func f(url: URL) {\n    if ok,\n       var components = URLComponents(url: url) {\n        use(components)\n    } else {\n        other()\n    }\n}";
    assert.strictEqual(insert("swift", swift, "components").split("\n")[3], '        print("[file:3] components =", String(describing: components))');
    assert.strictEqual(insert("swift", "func f() {\n    if let user = load() {\n        show(user)\n    }\n}", "user").split("\n")[2], '        print("[file:2] user =", String(describing: user))');
    assert.strictEqual(insert("swift", "func f() {\n    while let item = next() {\n        use(item)\n    }\n}", "item").split("\n")[2], '        print("[file:2] item =", String(describing: item))');
    assert.strictEqual(insert("swift", "func f() {\n    guard let user = load() else {\n        return\n    }\n    show(user)\n}", "user").split("\n")[4], '    print("[file:2] user =", String(describing: user))');
    const cs = "class C\n{\n    void M()\n    {\n        if (cache.TryGetValue(key, out var hit))\n        {\n            Use(hit);\n        }\n    }\n}";
    assert.strictEqual(insert("csharp", cs, "hit").split("\n")[6], '            System.Console.WriteLine($"[file:5] hit={hit}");');
    const pattern = "class C {\n    void M(object o) {\n        if (o is Order order) {\n            Ship(order);\n        }\n    }\n}";
    assert.strictEqual(insert("csharp", pattern, "order").split("\n")[3], '            System.Console.WriteLine($"[file:3] order={order}");');
  });

  test("Allman braces: header variables are logged inside the block, never between the header and its brace", () => {
    const loop = "class C\n{\n    void M(int count)\n    {\n        foreach (var item in items)\n        {\n            Use(item);\n        }\n        try\n        {\n            Run();\n        }\n        catch (Exception ex)\n        {\n            Log(ex);\n        }\n        var done = true;\n    }\n}";
    assert.strictEqual(insert("csharp", loop, "item").split("\n")[6], '            System.Console.WriteLine($"[file:5] item={item}");');
    assert.strictEqual(insert("csharp", loop, "count").split("\n")[4], '        System.Console.WriteLine($"[file:3] count={count}");');
    assert.strictEqual(insert("csharp", loop, "ex").split("\n")[14], '            System.Console.WriteLine($"[file:13] ex={ex}");');
    assert.strictEqual(insert("csharp", loop, "items").split("\n")[6], '            System.Console.WriteLine($"[file:5] items={items}");', "as with a brace on the same line, a header value is logged at the top of the block");
    assert.strictEqual(planDebugLog({ languageId: "csharp", text: "class C\n{\n    bool TryParse(string s, out int value)\n    {\n        value = 0;\n        return true;\n    }\n}", line: 2, column: 36, expression: "value", fileName: "file", indentUnit: "    " }), undefined, "an out parameter is unassigned at the top of the method");
    const qualified = "class C\n{\n    void M()\n    {\n        System.Console.WriteLine($\"x\");\n        Console.Write(1);\n    }\n}";
    assert.deepStrictEqual(findDebugStatements(qualified, "csharp").map(s => [s.kind, s.removable]), [["System.Console.WriteLine", true], ["Console.Write", true]]);
    const logged = 'class C\n{\n    void M(int id)\n    {\n        _logger.LogDebug("[Orders.cs:3] id={Id}", id);\n        _logger.LogDebug("Loaded {Id}", id);\n        this.log.debug("[A.java:9] x={}", x);\n    }\n}';
    assert.deepStrictEqual(findDebugStatements(logged, "csharp").map(s => s.kind), ["_logger.LogDebug", "this.log.debug"], "only logger calls carrying Insert Debug Log's label are found");
    assert.deepStrictEqual(findDebugStatements('logger = logging.getLogger(__name__)\nlogger.debug("[svc.py:4] n=%r", n)\nlogger.debug("ready")\nlogger.debug(f"[svc.py:6] {n=}")\n', "python").map(s => s.line), [2, 4]);
    assert.strictEqual(planDebugLog({ languageId: "csharp", text: "class C\n{\n    void M(string s)\n    {\n        if (int.TryParse(s, out var _))\n        {\n        }\n    }\n}", line: 4, column: 36, expression: "_", fileName: "file", indentUnit: "    " }), undefined, "a discard is not a value");
    const braceless = "class C\n{\n    void M(string[] names)\n    {\n        foreach (var name in names)\n            if (name.Length > 0)\n                Use(name);\n        Done();\n    }\n}";
    assert.strictEqual(planDebugLog({ languageId: "csharp", text: braceless, line: 4, column: 21, expression: "name", fileName: "file", indentUnit: "    " }), undefined, "a loop variable of a brace-less loop has nowhere to go");
    assert.strictEqual(insert("csharp", braceless, "names", {}, 1).split("\n")[4], '        System.Console.WriteLine($"[file:5] names={names}");', "a header value of a brace-less loop is logged before it");
    assert.strictEqual(insert("javascript", "function f(xs) {\n  for (const x of xs)\n    use(x);\n}", "xs", {}, 1).split("\n")[2], '  for (const x of xs)');
    assert.strictEqual(insert("java", "class C {\n  void m(int x) {\n    if (x > 1)\n      run();\n  }\n}", "x", {}, 1).split("\n")[2], '    System.out.println("[file:3] x=" + x);', "a condition value of a brace-less if is logged before it");
    assert.strictEqual(planDebugLog({ languageId: "kotlin", text: "fun f(price: IntArray) {\n    var best = 0\n    for (j in 0 until 3) best = maxOf(best,\n        price[j])\n}", line: 2, column: 9, expression: "j", fileName: "file", indentUnit: "    " }), undefined, "a loop variable whose body has no braces");
    assert.strictEqual(planDebugLog({ languageId: "kotlin", text: "fun area(side: Double) =\n    when {\n        side > 0 -> side * side\n        else -> 0.0\n    }", line: 0, column: 9, expression: "side", fileName: "file", indentUnit: "    " }), undefined, "a parameter of an expression-bodied function");
    assert.ok(insert("kotlin", "fun area(side: Double): Double {\n    return side * side\n}", "side").includes('    println("[file:1] side=${side}")\n    return'));
    const lambda = "class C\n{\n    List<int> M(int[] xs)\n    {\n        var items = xs.Select(x =>\n        {\n            return x * 2;\n        }).ToList();\n        return items;\n    }\n}";
    assert.strictEqual(insert("csharp", lambda, "items").split("\n")[8], '        System.Console.WriteLine($"[file:5] items={items}");', "an assigned variable whose value is a multi-line lambda is logged after the statement");
    const initializer = "class C\n{\n    object M()\n    {\n        var options = new JsonSerializerOptions\n        {\n            WriteIndented = true\n        };\n        return options;\n    }\n}";
    assert.strictEqual(insert("csharp", initializer, "options").split("\n")[8], '        System.Console.WriteLine($"[file:5] options={options}");', "an object initializer on its own line is not a block");
    assert.ok(insert("swift", "func didConnect(protocol: String?) {\n    run()\n}", "protocol").includes("String(describing: `protocol`)"));
    for (const [lang, code] of [["kotlin", "fun f() {\n    var temp : Comparable<Int>\n    temp = 1\n}"], ["java", "class C {\n  void m() {\n    int temp;\n    temp = 1;\n  }\n}"], ["swift", "func f() {\n    let temp: Int\n    temp = 1\n}"]]) {
      const line = code.split("\n").findIndex(l => /temp\s*[:;]|int temp/.test(l));
      assert.strictEqual(planDebugLog({ languageId: lang, text: code, line, column: code.split("\n")[line].indexOf("temp"), expression: "temp", fileName: "file", indentUnit: "    " }), undefined, `${lang}: a declaration without a value`);
    }
    assert.ok(insert("kotlin", "fun f() {\n    var temp: Int = 1\n    use(temp)\n}", "temp").includes('    println("[file:2] temp=${temp}")\n    use'));
    const usings = "class C\n{\n    async Task<string> M(Stream data)\n    {\n        using (var memStream = new MemoryStream())\n        {\n            var bytes = memStream.ToArray();\n            return Convert.ToBase64String(bytes);\n        }\n    }\n}";
    assert.strictEqual(insert("csharp", usings, "bytes").split("\n")[7], '            System.Console.WriteLine($"[file:7] bytes={bytes}");', "a using block is a block, even after new X()");
    const closure = "func validate() {\n    let validator: () -> Void = { [unowned self] in\n        let result = run()\n        report(result)\n    }\n}";
    assert.strictEqual(insert("swift", closure, "result").split("\n")[3], '        print("[file:3] result =", String(describing: result))', "a Swift closure assigned with = is a body, not a literal");
    assert.strictEqual(planDebugLog({ languageId: "swift", text: "func around<T>(_ closure: () throws -> T) rethrows -> T {\n    return try closure()\n}", line: 0, column: 17, expression: "closure", fileName: "file", indentUnit: "    " }), undefined, "a non-escaping closure parameter");
    assert.ok(insert("swift", "func later(_ work: @escaping () -> Void) {\n    queue.async(execute: work)\n}", "work").includes("String(describing: work)"));
    const cookies = "func f() {\n    if\n        let storage = config.storage,\n        let cookies = storage.cookies(for: url), !cookies.isEmpty {\n        use(cookies)\n    }\n}";
    assert.strictEqual(insert("swift", cookies, "cookies").split("\n")[4], '        print("[file:4] cookies =", String(describing: cookies))', "an if with its conditions on the lines below");
    const ifExpression = "func f() {\n    let pair = state.write { s in\n        if let credential = s.credential {\n            (credential, s.version)\n        } else {\n            nil\n        }\n    }\n}";
    assert.strictEqual(planDebugLog({ languageId: "swift", text: ifExpression, line: 2, column: 15, expression: "credential", fileName: "file", indentUnit: "    " }), undefined, "a Swift if-expression's branch must stay a single expression");
    assert.ok(insert("swift", "func f() {\n    if let user = load() {\n        show(user)\n    } else {\n        hide()\n    }\n}", "user").includes('        print("[file:2] user ='), "an if statement with an else is still a statement");
    assert.strictEqual(insert("swift", "func f() {\n    for send in sends {\n        go(send)\n    }\n}", "send").split("\n")[2], '        print("[file:2] send =", String(describing: send))', "a Swift for-in variable is logged inside the loop");
    assert.strictEqual(planDebugLog({ languageId: "swift", text: "func make(_ value: Int) -> Box {\n    Box(value)\n}", line: 0, column: 12, expression: "value", fileName: "file", indentUnit: "    " }), undefined, "a Swift function whose body is an implicit return");
    assert.ok(insert("swift", "func make(_ value: Int) -> Box {\n    return Box(value)\n}", "value").includes('    print("[file:1] value =", String(describing: value))\n    return'));
    const closureIf = "let isOffline: (_ error: Error) -> Bool = { error in\n    if let e = error as? URLError {\n        e.code == .notConnectedToInternet\n    } else {\n        false\n    }\n}";
    assert.strictEqual(planDebugLog({ languageId: "swift", text: closureIf, line: 0, column: 44, expression: "error", fileName: "main.swift", indentUnit: "    " }), undefined, "a closure whose body is an if-expression");
    const elseIf = "let isOffline: (Error) -> Bool = { error in\n    if let af = error as? AFError {\n        check(af)\n    } else if let url = error as? URLError {\n        codes.contains(url.code)\n    } else {\n        false\n    }\n}";
    assert.strictEqual(planDebugLog({ languageId: "swift", text: elseIf, line: 3, column: 18, expression: "url", fileName: "main.swift", indentUnit: "    " }), undefined, "a binding in an else-if branch of an if-expression");
    assert.ok(insert("swift", "func f(_ x: Int) -> Int {\n    if x > 0 {\n        return 1\n    }\n    return 0\n}", "x").includes('    print("[file:1] x ='), "an if statement with returns is a statement");
    const combine = "import Combine\nextension Publisher {\n    func log() {\n        let n = 1\n        use(n)\n    }\n}";
    const combineLogged = insert("swift", combine, "n");
    assert.ok(combineLogged.includes('Swift.print("[file:4] n =", String(describing: n))'), "Combine's print operator is not called by mistake");
    assert.deepStrictEqual(findDebugStatements(combineLogged, "swift").map(s => s.kind), ["Swift.print"]);
    assert.strictEqual(planDebugLog({ languageId: "swift", text: 'func describe(_ code: Int) -> String {\n    """\n    [Status]: \\(code)\n    """\n}', line: 0, column: 16, expression: "code", fileName: "file", indentUnit: "    " }), undefined, "a body that is one multi-line string");
    const adapter = "func adapter(for request: Request) -> Adapter? {\n    if let a = request.interceptor, let b = interceptor {\n        Interceptor(adapters: [b, a])\n    } else {\n        request.interceptor ?? interceptor\n    }\n}";
    assert.strictEqual(planDebugLog({ languageId: "swift", text: adapter, line: 1, column: 11, expression: "a", fileName: "file", indentUnit: "    " }), undefined, "the if-expression a function returns");
    const ifElse = "class C\n{\n    void M(int n)\n    {\n        var x = n * 2;\n        if (x > 1)\n        {\n            A();\n        }\n        else\n        {\n            B();\n        }\n    }\n}";
    assert.strictEqual(insert("csharp", ifElse, "x", {}, 1).split("\n")[7], '            System.Console.WriteLine($"[file:6] x={x}");');
    assert.strictEqual(insert("csharp", ifElse, "x").split("\n")[5], '        System.Console.WriteLine($"[file:5] x={x}");');
  });

  test("Java and Spring Boot: SLF4J or Lombok's log when present", () => {
    const spring = "@Slf4j\n@RestController\nclass C {\n  User get(Long id) {\n    User user = repo.find(id);\n    return user;\n  }\n}";
    assert.ok(insert("java", spring, "user").includes('    log.debug("[file:5] user={}", user);\n    return user;'));
    const field = "class C {\n  private static final Logger LOG = LoggerFactory.getLogger(C.class);\n  void f(int n) {\n    int x = n * 2;\n  }\n}";
    assert.ok(insert("java", field, "x").includes('    LOG.debug("[file:4] x={}", x);'));
    const qualified = "class C {\n  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(C.class);\n  void f(int n) {\n    int x = n * 2;\n  }\n}";
    assert.ok(insert("java", qualified, "x").includes('    log.debug("[file:4] x={}", x);'), "the ds-logger snippet's fully-qualified field is found");
    assert.ok(insert("java", "class C {\n  void f(int a, int b) {\n    int s = a + b;\n  }\n}", "s", { expression: "a + b" }).includes('System.out.println("[file:3] a + b=" + (a + b));'));
  });

  test("C# and ASP.NET Core: ILogger with a message template, else Console", () => {
    const api = "public class OrdersController(ILogger<OrdersController> logger) : ControllerBase\n{\n    public IActionResult Get(int id)\n    {\n        var order = _db.Find(id);\n        return Ok(order);\n    }\n}";
    assert.ok(insert("csharp", api, "order").includes('        logger.LogDebug("[file:5] order={Order}", order);\n        return Ok(order);'));
    const field = "class S {\n    private readonly ILogger<S> _logger;\n    void M() {\n        var total = 1;\n    }\n}";
    assert.ok(insert("csharp", field, "total").includes('_logger.LogDebug("[file:4] total={Total}", total);'));
    assert.ok(insert("csharp", "using System;\nclass P {\n    static void Main() {\n        var n = 1;\n    }\n}", "n").includes('Console.WriteLine($"[file:4] n={n}");'));
    assert.ok(insert("csharp", "class P {\n    void M() {\n        var n = a ? 1 : 2;\n    }\n}", "n", { expression: "a ? 1 : 2" }).includes('System.Console.WriteLine($"[file:3] a ? 1 : 2={(a ? 1 : 2)}");'));
  });

  test("Kotlin, Dart and Swift", () => {
    const kt = "import android.util.Log\nclass A {\n    fun f(items: List<Int>) {\n        items.forEach { item ->\n            use(item)\n        }\n    }\n}";
    assert.ok(insert("kotlin", kt, "item").includes('        items.forEach { item ->\n            Log.d("file", "[file:4] item=${item}")'));
    assert.ok(insert("kotlin", "fun f(price: Double) {\n    val total = price * 2\n}", "total").includes('    println("[file:2] total=${total}")'));
    assert.ok(insert("dart", "import 'package:flutter/material.dart';\nvoid f(String name) {\n  final user = load(name);\n}", "user", { indentUnit: "  " }).includes("  debugPrint('[file:3] user=${user}');"));
    assert.ok(insert("dart", "void main() {\n  var n = 1;\n}", "n", { indentUnit: "  " }).includes("  print('[file:2] n=${n}');"));
    assert.ok(insert("swift", "func f(user: User) {\n    let name = user.name\n}", "name").includes('    print("[file:2] name =", String(describing: name))'));
    assert.ok(insert("swift", "import os\nlet logger = Logger(subsystem: \"app\", category: \"ui\")\nfunc f() {\n    let n = 1\n}", "n").includes('logger.debug("[file:4] n=\\(String(describing: n))")'));
  });

  test("returns nothing for unsupported languages or multi-line selections", () => {
    assert.strictEqual(planDebugLog({ languageId: "ruby", text: "x = 1", line: 0, column: 0, expression: "x", fileName: "a.rb", indentUnit: "  " }), undefined);
    assert.strictEqual(planDebugLog({ languageId: "javascript", text: "a\nb", line: 0, column: 0, expression: "a\nb", fileName: "a.js", indentUnit: "  " }), undefined);
  });
});
