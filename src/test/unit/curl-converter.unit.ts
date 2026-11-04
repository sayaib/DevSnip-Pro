import * as assert from "assert";
import * as ts from "typescript";
import * as vm from "vm";
import { spawnSync } from "child_process";
import { CURL_TARGETS, curlTargetWarnings, generateFromCurl, parseCurl, parseCurlCommands, toCurl, tokenizeShell } from "../../toolkits/engines/web-curl";
import { curlHar, curlPostman, redactCurl } from "../../toolkits/engines/curl-exports";
import { curlTool } from "../../toolkits/sections/curl";
import { ToolContext, ToolInputError } from "../../toolkits/types";
import { suite, test } from "./run-unit-tests";

const parse = parseCurl;
async function runFetch(command: string, response: Response, options = {}): Promise<{ url: string; options: RequestInit; logged: unknown }> {
  const source = generateFromCurl(parse(command), "node-fetch", options);
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText.replace(/export \{\};?\s*$/, "");
  let url = "", init: RequestInit = {}, logged: unknown;
  await vm.runInNewContext(`(async () => { ${compiled} })()`, { fetch: async (u: string, opts: RequestInit) => { url = u; init = opts; return response; }, console: { log: (value: unknown) => { logged = value; } }, AbortSignal, FormData, Blob, Error });
  return { url, options: init, logged };
}

suite("cURL converter: parser", () => {
  test("consumes flag-looking arguments without reinterpreting their contents", () => {
    assert.strictEqual(parse("curl https://example.com --data-raw --json").body, "--json");
    assert.strictEqual(parse("curl https://example.com --data-raw '--max-time=5'").timeoutSeconds, undefined);
    assert.strictEqual(parse("curl https://example.com -d '--next'").body, "--next");
    assert.strictEqual(parse("curl -sSLXPOST -H'X-Value: -sSL' https://example.com -d '-v'").method, "POST");
    assert.strictEqual(parse("curl --url=https://example.com --request=PATCH --data-raw=-sSL").body, "-sSL");
  });
  test("correctly distinguishes GET query parameters and bodies and strips URL fragments", () => {
    const r = parse("curl -G 'https://example.com/search?a=1#fragment' -d 'tag=red' -d 'tag=blue' --url-query 'q=a b'");
    assert.strictEqual(r.method, "GET");
    assert.strictEqual(r.body, undefined);
    assert.strictEqual(r.url, "https://example.com/search?a=1&q=a%20b&tag=red&tag=blue");
    assert.strictEqual(parse("curl -G -X POST https://example.com -d x=1").method, "POST");
  });
  test("retains multiline and empty inline payloads and scalar JSON", () => {
    const r = parse("curl https://example.com --data-raw 'line one\nline two'");
    assert.strictEqual(r.body, "line one\nline two");
    assert.strictEqual(parse("curl https://example.com -d ''").method, "POST");
    for (const value of ["null", "false", "1", '"hello"']) assert.strictEqual(parse(`curl https://example.com --json '${value}'`).bodyKind, "json");
  });
  test("handles explicit shell dialects and quoted escaping without executing expansion", () => {
    assert.deepStrictEqual(tokenizeShell('curl.exe "https://example.com" --data-binary "@C:\\data\\payload.bin"', "cmd").slice(-1), ["@C:\\data\\payload.bin"]);
    assert.strictEqual(parse('curl.exe https://example.com --data-raw "a`nb"', "powershell").body, "a\nb");
    assert.strictEqual(parse("curl.exe https://example.com --data-raw 'can''t'", "powershell").body, "can't");
    assert.strictEqual(parse("curl https://example.com --data-raw $'can\\'t\\nstop'", "bash").body, "can't\nstop");
    assert.strictEqual(parse("curl 'https://example.com/$TOKEN' --data-raw '$(touch /tmp/test)'", "bash").body, "$(touch /tmp/test)");
  });
  test("decodes browser Copy as cURL cmd caret envelopes and command batches", () => {
    const command = String.raw`curl ^"https://example.com/search?q=a^&q=b^" -H ^"X-Note: a b^" --data-raw ^"^{^\^"n^\^":1^}^"`;
    const r = parse(command);
    assert.strictEqual(r.url, "https://example.com/search?q=a&q=b");
    assert.strictEqual(r.body, '{"n":1}');
    assert.deepStrictEqual(r.headers[0], ["X-Note", "a b"]);
    assert.strictEqual(parseCurlCommands(command + " &\r\ncurl https://example.org", "cmd").length, 2);
  });
  test("parses separate commands and --next transfers with isolated options", () => {
    const requests = parseCurlCommands("curl -X POST https://example.com/a -d one --next https://example.com/b\ncurl -I https://example.com/c && curl https://example.com/d");
    assert.deepStrictEqual(requests.map(r => r.method), ["POST", "GET", "HEAD", "GET"]);
    assert.strictEqual(requests[1].body, undefined);
    assert.throws(() => parse("curl https://example.com --next https://example.org"), ToolInputError);
    assert.throws(() => parseCurlCommands("curl https://example.com; echo secret"), ToolInputError);
  });
  test("rejects invalid methods, headers, protocols, timeouts, shell operations and resource limits", () => {
    for (const command of ["echo curl https://example.com", "curl file:///etc/passwd", "curl https://example.com -X 'BAD METHOD'", "curl https://example.com -H 'X-Test: a\nb'", "curl https://example.com -m NaN", "curl https://example.com -m -1", "curl https://example.com -m 999999999", "curl https://example.com | cat", "curl https://example.com > response.txt", "curl https://example.com https://example.org", "curl https://example.com --data-binary @-", "curl https://example.com -d @file", "curl https://example.com -d x -F y=z", "curl https://example.com -H @headers.txt"]) assert.throws(() => parse(command), ToolInputError, command);
    assert.throws(() => parse("curl " + "a".repeat(256 * 1024)), ToolInputError);
    assert.throws(() => parseCurlCommands(Array(51).fill("curl https://example.com").join("\n")), ToolInputError);
    assert.strictEqual(parse("curl https://example.com -m 0").timeoutSeconds, 0);
    assert.strictEqual(parse("curl https://example.com -m 0.5").timeoutSeconds, 0.5);
  });
  test("retains multipart metadata and literal semicolons and @ prefixes", () => {
    const r = parse("curl https://example.com -F 'file=@x.pdf;type=application/pdf;filename=report.pdf' --form-string 'note=@literal;value'");
    assert.deepStrictEqual(r.form[0], { name: "file", value: "x.pdf", file: true, contentType: "application/pdf", filename: "report.pdf" });
    assert.strictEqual(r.form[1].value, "@literal;value");
    assert.deepStrictEqual(parse(toCurl(r)).form, r.form);
  });
  test("preserves repeated --json concatenation and explicit empty/suppressed headers", () => {
    assert.strictEqual(parse("curl https://example.com --json '{\"n\":' --json '1}'").body, '{"n":1}');
    const r = parse("curl https://example.com -H 'Content-Type:' -H 'X-Empty;' -d x");
    assert.ok(!r.headers.some(([k]) => k === "Content-Type"));
    const back = parse(toCurl(r));
    assert.deepStrictEqual(back.headers, r.headers);
    assert.deepStrictEqual(back.suppressedHeaders, r.suppressedHeaders);
  });
  test("appends upload filenames when cURL uses directory URLs", () => {
    const r = parse("curl -T './report one.pdf' https://example.com/uploads/");
    assert.strictEqual(r.method, "PUT");
    assert.strictEqual(r.url, "https://example.com/uploads/report%20one.pdf");
    assert.strictEqual(r.bodyFile, "./report one.pdf");
  });
  test("moves URL credentials into basic auth and validates malformed encoding", () => {
    const r = parse("curl 'https://a:p%3Ass@example.com/path'");
    assert.deepStrictEqual(r.basicAuth, { user: "a", password: "p:ss" });
    assert.ok(!r.url.includes("p%3A"));
    assert.throws(() => parse("curl 'https://a:p%ZZ@example.com'"), ToolInputError);
  });
});

suite("cURL converter: generated clients", () => {
  test("all JS/TS targets parse across request body kinds", () => {
    const samples = ["curl https://example.com", "curl https://example.com --json '{\"__proto__\":{\"safe\":true},\"n\":9007199254740993}'", "curl 'https://example.com?a=1&a=2' -d 'a=1&a=2'", "curl https://example.com -F f=@x -F f=@y", "curl https://example.com --data-binary @body.bin"];
    for (const command of samples) for (const target of ["fetch", "fetch-ts", "node-fetch", "axios", "axios-node"] as const) {
      let source: string;
      try { source = generateFromCurl(parse(command), target); } catch (e) { assert.ok(e instanceof ToolInputError); continue; }
      const r = ts.transpileModule(source, { fileName: target === "fetch" || target === "axios" ? "request.js" : "request.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
      assert.deepStrictEqual((r.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], target + command);
    }
  });
  test("generated Fetch preserves exact body bytes, repeated headers, redirects and query keys", async () => {
    const body = '{ "n": 9007199254740993, "__proto__": {"safe": true} }';
    const result = await runFetch(`curl 'https://example.com?a=1&a=2' -H 'X-Tag: one' -H 'X-Tag: two' --json '${body}'`, new Response("ok", { headers: { "Content-Type": "text/plain" } }));
    assert.strictEqual(result.url, "https://example.com?a=1&a=2");
    assert.strictEqual(result.options.body, body);
    assert.strictEqual(result.options.redirect, "manual");
    assert.strictEqual(Array.from(result.options.headers as string[][]).filter(([k]) => k === "X-Tag").length, 2);
    assert.strictEqual(result.logged, "ok");
  });
  test("generated Fetch handles empty responses and response media types", async () => {
    assert.strictEqual((await runFetch("curl https://example.com", new Response(null, { status: 204 }))).logged, "");
    const json = await runFetch("curl https://example.com", new Response('{"ok":true}', { headers: { "Content-Type": "application/problem+json" } }));
    assert.strictEqual((json.logged as { ok: boolean }).ok, true);
    const bytes = await runFetch("curl https://example.com", new Response("abc"), { response: "bytes" });
    assert.strictEqual((bytes.logged as ArrayBuffer).byteLength, 3);
    await assert.rejects(() => runFetch("curl https://example.com", new Response("secret", { status: 500 })), /HTTP 500/);
  });
  test("rejects lossy target combinations instead of emitting broken requests", () => {
    assert.throws(() => generateFromCurl(parse("curl -X GET https://example.com -d x"), "fetch"), ToolInputError);
    assert.throws(() => generateFromCurl(parse("curl https://example.com -F f=@x"), "java"), ToolInputError);
    assert.throws(() => generateFromCurl(parse("curl https://example.com"), "unknown" as never), ToolInputError);
    assert.throws(() => generateFromCurl(parse("curl https://example.com -F f=x -F f=y"), "php"), ToolInputError);
    assert.ok(curlTargetWarnings(parse("curl https://example.com -H 'Cookie: a=b'"), "fetch").some(w => w.includes("Browsers control")));
  });
  test("Python output parses for both libraries, file bodies and multipart lists", () => {
    const python = spawnSync("python3", ["--version"]);
    if (python.status !== 0) return;
    for (const command of ["curl https://example.com", "curl https://example.com --json '{\"a\":true}'", "curl https://example.com -F a=one -F a=two -F file=@x.pdf", "curl https://example.com --data-binary @file.bin"]) for (const target of ["python", "python-httpx"] as const) {
      const generated = generateFromCurl(parse(command), target);
      const check = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: generated, encoding: "utf8" });
      assert.strictEqual(check.status, 0, generated + check.stderr);
    }
  });
  test("normalized cURL preserves body bytes, proxy, timeouts and literal form values", () => {
    const r = parse("curl -L -k 'https://example.com?q=1&q=2' --json '{ \"a\": 1 }' --max-time 0 --connect-timeout 0.5 -x http://localhost:8080");
    const back = parse(toCurl(r));
    for (const key of ["body", "method", "url", "timeoutSeconds", "connectTimeoutSeconds", "proxy", "followRedirects", "insecure"] as const) assert.deepStrictEqual(back[key], r[key]);
  });
});

suite("cURL converter: exports and workbench", () => {
  test("redaction removes secrets from nested JSON, repeated query keys, auth and headers without mutating input", () => {
    const r = parse("curl -u user:SECRET 'https://example.com?token=SECRET&token=SECRET&safe=1' -H 'Authorization: Bearer SECRET' --json '{\"password\":\"SECRET\",\"nested\":[{\"api_key\":\"SECRET\"}]}'");
    const safe = redactCurl(r);
    assert.ok(!JSON.stringify(safe).includes("SECRET"));
    assert.ok(r.body!.includes("SECRET"));
    assert.strictEqual(new URL(safe.url).searchParams.getAll("token").length, 2);
  });
  test("JSON redaction preserves non-secret large integers and nested value boundaries", () => {
    const r = parse(`curl https://example.com --json '{"n":9007199254740993,"token":{"value":"secret"},"safe":[1,2],"password":"x"}'`);
    const safe = redactCurl(r);
    assert.ok(safe.body!.includes('9007199254740993'));
    const json = JSON.parse(safe.body!);
    assert.strictEqual(json.token, "REDACTED");
    assert.deepStrictEqual(json.safe, [1,2]);
  });
  test("Postman and HAR exports preserve repeated request fields and do not invent responses", () => {
    const r = parse("curl 'https://example.com?a=1&a=2' -H 'X-T: a' -H 'X-T: b' -F f=one -F f=two");
    const postman = JSON.parse(curlPostman([r]));
    assert.strictEqual(postman.item[0].request.body.formdata.length, 2);
    assert.strictEqual(postman.item[0].request.header.length, 2);
    const har = JSON.parse(curlHar([r]));
    assert.strictEqual(har.log.entries[0].request.queryString.length, 2);
    assert.strictEqual(har.log.entries[0].response.status, 0);
  });
  test("batch conversion emits unique target filenames and diagnostics for unsupported targets", async () => {
    const result = await curlTool.run({ curl: "curl https://example.com -F f=@x --next https://example.com/b", batch: true, all: true, export: "both" }, {});
    const files = result.outputs!.filter(o => o.kind === "code");
    assert.strictEqual(new Set(files.map(o => o.kind === "code" ? o.fileName : "")).size, files.length);
    assert.ok(result.messages!.some(m => m.text.includes("multipart generation is unsupported")));
    assert.ok(files.some(f => f.title.includes("Postman")));
  });
  test("saved presets redact secrets and never store the original command", async () => {
    let saved: unknown = [];
    const context: ToolContext = { storage: { get: <T>(_key: string, fallback: T) => saved as T ?? fallback, set: async (_key, value) => { saved = value; } } };
    await curlTool.run({ curl: "curl https://example.com -H 'Authorization: Bearer TOPSECRET'" }, context, "save-preset");
    assert.ok(!JSON.stringify(saved).includes("TOPSECRET"));
    assert.strictEqual((await curlTool.dynamicExamples!(context)).length, 1);
    await curlTool.run({}, context, "clear-presets");
    assert.deepStrictEqual(saved, []);
    assert.ok(curlTool.fields.find(f => f.id === "curl")!.sensitive);
  });
  test("every original client target remains available", () => {
    for (const id of ["fetch", "axios", "node-fetch", "python", "go", "php", "java", "dart-http", "dart-dio", "kotlin-okhttp", "swift", "http", "httpie"]) assert.ok(CURL_TARGETS.some(t => t.id === id));
  });
});
