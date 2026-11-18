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
const ts = __importStar(require("typescript"));
const vm = __importStar(require("vm"));
const child_process_1 = require("child_process");
const web_curl_1 = require("../../toolkits/engines/web-curl");
const curl_exports_1 = require("../../toolkits/engines/curl-exports");
const curl_1 = require("../../toolkits/sections/curl");
const types_1 = require("../../toolkits/types");
const run_unit_tests_1 = require("./run-unit-tests");
const parse = web_curl_1.parseCurl;
async function runFetch(command, response, options = {}) {
    const source = (0, web_curl_1.generateFromCurl)(parse(command), "node-fetch", options);
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText.replace(/export \{\};?\s*$/, "");
    let url = "", init = {}, logged;
    await vm.runInNewContext(`(async () => { ${compiled} })()`, { fetch: async (u, opts) => { url = u; init = opts; return response; }, console: { log: (value) => { logged = value; } }, AbortSignal, FormData, Blob, Error });
    return { url, options: init, logged };
}
(0, run_unit_tests_1.suite)("cURL converter: parser", () => {
    (0, run_unit_tests_1.test)("consumes flag-looking arguments without reinterpreting their contents", () => {
        assert.strictEqual(parse("curl https://example.com --data-raw --json").body, "--json");
        assert.strictEqual(parse("curl https://example.com --data-raw '--max-time=5'").timeoutSeconds, undefined);
        assert.strictEqual(parse("curl https://example.com -d '--next'").body, "--next");
        assert.strictEqual(parse("curl -sSLXPOST -H'X-Value: -sSL' https://example.com -d '-v'").method, "POST");
        assert.strictEqual(parse("curl --url=https://example.com --request=PATCH --data-raw=-sSL").body, "-sSL");
    });
    (0, run_unit_tests_1.test)("correctly distinguishes GET query parameters and bodies and strips URL fragments", () => {
        const r = parse("curl -G 'https://example.com/search?a=1#fragment' -d 'tag=red' -d 'tag=blue' --url-query 'q=a b'");
        assert.strictEqual(r.method, "GET");
        assert.strictEqual(r.body, undefined);
        assert.strictEqual(r.url, "https://example.com/search?a=1&q=a%20b&tag=red&tag=blue");
        assert.strictEqual(parse("curl -G -X POST https://example.com -d x=1").method, "POST");
    });
    (0, run_unit_tests_1.test)("retains multiline and empty inline payloads and scalar JSON", () => {
        const r = parse("curl https://example.com --data-raw 'line one\nline two'");
        assert.strictEqual(r.body, "line one\nline two");
        assert.strictEqual(parse("curl https://example.com -d ''").method, "POST");
        for (const value of ["null", "false", "1", '"hello"'])
            assert.strictEqual(parse(`curl https://example.com --json '${value}'`).bodyKind, "json");
    });
    (0, run_unit_tests_1.test)("handles explicit shell dialects and quoted escaping without executing expansion", () => {
        assert.deepStrictEqual((0, web_curl_1.tokenizeShell)('curl.exe "https://example.com" --data-binary "@C:\\data\\payload.bin"', "cmd").slice(-1), ["@C:\\data\\payload.bin"]);
        assert.strictEqual(parse('curl.exe https://example.com --data-raw "a`nb"', "powershell").body, "a\nb");
        assert.strictEqual(parse("curl.exe https://example.com --data-raw 'can''t'", "powershell").body, "can't");
        assert.strictEqual(parse("curl https://example.com --data-raw $'can\\'t\\nstop'", "bash").body, "can't\nstop");
        assert.strictEqual(parse("curl 'https://example.com/$TOKEN' --data-raw '$(touch /tmp/test)'", "bash").body, "$(touch /tmp/test)");
    });
    (0, run_unit_tests_1.test)("decodes browser Copy as cURL cmd caret envelopes and command batches", () => {
        const command = String.raw `curl ^"https://example.com/search?q=a^&q=b^" -H ^"X-Note: a b^" --data-raw ^"^{^\^"n^\^":1^}^"`;
        const r = parse(command);
        assert.strictEqual(r.url, "https://example.com/search?q=a&q=b");
        assert.strictEqual(r.body, '{"n":1}');
        assert.deepStrictEqual(r.headers[0], ["X-Note", "a b"]);
        assert.strictEqual((0, web_curl_1.parseCurlCommands)(command + " &\r\ncurl https://example.org", "cmd").length, 2);
    });
    (0, run_unit_tests_1.test)("parses separate commands and --next transfers with isolated options", () => {
        const requests = (0, web_curl_1.parseCurlCommands)("curl -X POST https://example.com/a -d one --next https://example.com/b\ncurl -I https://example.com/c && curl https://example.com/d");
        assert.deepStrictEqual(requests.map(r => r.method), ["POST", "GET", "HEAD", "GET"]);
        assert.strictEqual(requests[1].body, undefined);
        assert.throws(() => parse("curl https://example.com --next https://example.org"), types_1.ToolInputError);
        assert.throws(() => (0, web_curl_1.parseCurlCommands)("curl https://example.com; echo secret"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("rejects invalid methods, headers, protocols, timeouts, shell operations and resource limits", () => {
        for (const command of ["echo curl https://example.com", "curl file:///etc/passwd", "curl https://example.com -X 'BAD METHOD'", "curl https://example.com -H 'X-Test: a\nb'", "curl https://example.com -m NaN", "curl https://example.com -m -1", "curl https://example.com -m 999999999", "curl https://example.com | cat", "curl https://example.com > response.txt", "curl https://example.com https://example.org", "curl https://example.com --data-binary @-", "curl https://example.com -d x -F y=z", "curl https://example.com -H @headers.txt"])
            assert.throws(() => parse(command), types_1.ToolInputError, command);
        assert.throws(() => parse("curl " + "a".repeat(256 * 1024)), types_1.ToolInputError);
        assert.throws(() => (0, web_curl_1.parseCurlCommands)(Array(51).fill("curl https://example.com").join("\n")), types_1.ToolInputError);
        assert.strictEqual(parse("curl https://example.com -m 0").timeoutSeconds, 0);
        assert.strictEqual(parse("curl https://example.com -m 0.5").timeoutSeconds, 0.5);
    });
    (0, run_unit_tests_1.test)("retains multipart metadata and literal semicolons and @ prefixes", () => {
        const r = parse("curl https://example.com -F 'file=@x.pdf;type=application/pdf;filename=report.pdf' --form-string 'note=@literal;value'");
        assert.deepStrictEqual(r.form[0], { name: "file", value: "x.pdf", file: true, contentType: "application/pdf", filename: "report.pdf" });
        assert.strictEqual(r.form[1].value, "@literal;value");
        assert.deepStrictEqual(parse((0, web_curl_1.toCurl)(r)).form, r.form);
    });
    (0, run_unit_tests_1.test)("preserves repeated --json concatenation and explicit empty/suppressed headers", () => {
        assert.strictEqual(parse("curl https://example.com --json '{\"n\":' --json '1}'").body, '{"n":1}');
        const r = parse("curl https://example.com -H 'Content-Type:' -H 'X-Empty;' -d x");
        assert.ok(!r.headers.some(([k]) => k === "Content-Type"));
        const back = parse((0, web_curl_1.toCurl)(r));
        assert.deepStrictEqual(back.headers, r.headers);
        assert.deepStrictEqual(back.suppressedHeaders, r.suppressedHeaders);
    });
    (0, run_unit_tests_1.test)("appends upload filenames when cURL uses directory URLs", () => {
        const r = parse("curl -T './report one.pdf' https://example.com/uploads/");
        assert.strictEqual(r.method, "PUT");
        assert.strictEqual(r.url, "https://example.com/uploads/report%20one.pdf");
        assert.strictEqual(r.bodyFile, "./report one.pdf");
    });
    (0, run_unit_tests_1.test)("moves URL credentials into basic auth and validates malformed encoding", () => {
        const r = parse("curl 'https://a:p%3Ass@example.com/path'");
        assert.deepStrictEqual(r.basicAuth, { user: "a", password: "p:ss" });
        assert.ok(!r.url.includes("p%3A"));
        assert.throws(() => parse("curl 'https://a:p%ZZ@example.com'"), types_1.ToolInputError);
    });
});
(0, run_unit_tests_1.suite)("cURL converter: generated clients", () => {
    (0, run_unit_tests_1.test)("all JS/TS targets parse across request body kinds", () => {
        const samples = ["curl https://example.com", "curl https://example.com --json '{\"__proto__\":{\"safe\":true},\"n\":9007199254740993}'", "curl 'https://example.com?a=1&a=2' -d 'a=1&a=2'", "curl https://example.com -F f=@x -F f=@y", "curl https://example.com --data-binary @body.bin"];
        for (const command of samples)
            for (const target of ["fetch", "fetch-ts", "node-fetch", "axios", "axios-node"]) {
                let source;
                try {
                    source = (0, web_curl_1.generateFromCurl)(parse(command), target);
                }
                catch (e) {
                    assert.ok(e instanceof types_1.ToolInputError);
                    continue;
                }
                const r = ts.transpileModule(source, { fileName: target === "fetch" || target === "axios" ? "request.js" : "request.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
                assert.deepStrictEqual((r.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], target + command);
            }
    });
    (0, run_unit_tests_1.test)("generated Fetch preserves exact body bytes, repeated headers, redirects and query keys", async () => {
        const body = '{ "n": 9007199254740993, "__proto__": {"safe": true} }';
        const result = await runFetch(`curl 'https://example.com?a=1&a=2' -H 'X-Tag: one' -H 'X-Tag: two' --json '${body}'`, new Response("ok", { headers: { "Content-Type": "text/plain" } }));
        assert.strictEqual(result.url, "https://example.com?a=1&a=2");
        assert.strictEqual(result.options.body, body);
        assert.strictEqual(result.options.redirect, "manual");
        assert.strictEqual(Array.from(result.options.headers).filter(([k]) => k === "X-Tag").length, 2);
        assert.strictEqual(result.logged, "ok");
    });
    (0, run_unit_tests_1.test)("generated Fetch handles empty responses and response media types", async () => {
        assert.strictEqual((await runFetch("curl https://example.com", new Response(null, { status: 204 }))).logged, "");
        const json = await runFetch("curl https://example.com", new Response('{"ok":true}', { headers: { "Content-Type": "application/problem+json" } }));
        assert.strictEqual(json.logged.ok, true);
        const bytes = await runFetch("curl https://example.com", new Response("abc"), { response: "bytes" });
        assert.strictEqual(bytes.logged.byteLength, 3);
        await assert.rejects(() => runFetch("curl https://example.com", new Response("secret", { status: 500 })), /HTTP 500/);
    });
    (0, run_unit_tests_1.test)("rejects lossy target combinations instead of emitting broken requests", () => {
        assert.throws(() => (0, web_curl_1.generateFromCurl)(parse("curl -X GET https://example.com -d x"), "fetch"), types_1.ToolInputError);
        assert.throws(() => (0, web_curl_1.generateFromCurl)(parse("curl https://example.com -F f=@x"), "java"), types_1.ToolInputError);
        assert.throws(() => (0, web_curl_1.generateFromCurl)(parse("curl https://example.com"), "unknown"), types_1.ToolInputError);
        assert.throws(() => (0, web_curl_1.generateFromCurl)(parse("curl https://example.com -F f=x -F f=y"), "php"), types_1.ToolInputError);
        assert.ok((0, web_curl_1.curlTargetWarnings)(parse("curl https://example.com -H 'Cookie: a=b'"), "fetch").some(w => w.includes("Browsers control")));
    });
    (0, run_unit_tests_1.test)("Python output parses for both libraries, file bodies and multipart lists", () => {
        const python = (0, child_process_1.spawnSync)("python3", ["--version"]);
        if (python.status !== 0)
            return;
        for (const command of ["curl https://example.com", "curl https://example.com --json '{\"a\":true}'", "curl https://example.com -F a=one -F a=two -F file=@x.pdf", "curl https://example.com --data-binary @file.bin"])
            for (const target of ["python", "python-httpx"]) {
                const generated = (0, web_curl_1.generateFromCurl)(parse(command), target);
                const check = (0, child_process_1.spawnSync)("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: generated, encoding: "utf8" });
                assert.strictEqual(check.status, 0, generated + check.stderr);
            }
    });
    (0, run_unit_tests_1.test)("normalized cURL preserves body bytes, proxy, timeouts and literal form values", () => {
        const r = parse("curl -L -k 'https://example.com?q=1&q=2' --json '{ \"a\": 1 }' --max-time 0 --connect-timeout 0.5 -x http://localhost:8080");
        const back = parse((0, web_curl_1.toCurl)(r));
        for (const key of ["body", "method", "url", "timeoutSeconds", "connectTimeoutSeconds", "proxy", "followRedirects", "insecure"])
            assert.deepStrictEqual(back[key], r[key]);
    });
});
(0, run_unit_tests_1.suite)("cURL converter: exports and workbench", () => {
    (0, run_unit_tests_1.test)("redaction removes secrets from nested JSON, repeated query keys, auth and headers without mutating input", () => {
        const r = parse("curl -u user:SECRET 'https://example.com?token=SECRET&token=SECRET&safe=1' -H 'Authorization: Bearer SECRET' --json '{\"password\":\"SECRET\",\"nested\":[{\"api_key\":\"SECRET\"}]}'");
        const safe = (0, curl_exports_1.redactCurl)(r);
        assert.ok(!JSON.stringify(safe).includes("SECRET"));
        assert.ok(r.body.includes("SECRET"));
        assert.strictEqual(new URL(safe.url).searchParams.getAll("token").length, 2);
    });
    (0, run_unit_tests_1.test)("JSON redaction preserves non-secret large integers and nested value boundaries", () => {
        const r = parse(`curl https://example.com --json '{"n":9007199254740993,"token":{"value":"secret"},"safe":[1,2],"password":"x"}'`);
        const safe = (0, curl_exports_1.redactCurl)(r);
        assert.ok(safe.body.includes('9007199254740993'));
        const json = JSON.parse(safe.body);
        assert.strictEqual(json.token, "REDACTED");
        assert.deepStrictEqual(json.safe, [1, 2]);
    });
    (0, run_unit_tests_1.test)("Postman and HAR exports preserve repeated request fields and do not invent responses", () => {
        const r = parse("curl 'https://example.com?a=1&a=2' -H 'X-T: a' -H 'X-T: b' -F f=one -F f=two");
        const postman = JSON.parse((0, curl_exports_1.curlPostman)([r]));
        assert.strictEqual(postman.item[0].request.body.formdata.length, 2);
        assert.strictEqual(postman.item[0].request.header.length, 2);
        const har = JSON.parse((0, curl_exports_1.curlHar)([r]));
        assert.strictEqual(har.log.entries[0].request.queryString.length, 2);
        assert.strictEqual(har.log.entries[0].response.status, 0);
    });
    (0, run_unit_tests_1.test)("batch conversion emits unique target filenames and diagnostics for unsupported targets", async () => {
        const result = await curl_1.curlTool.run({ curl: "curl https://example.com -F f=@x --next https://example.com/b", batch: true, all: true, export: "both" }, {});
        const files = result.outputs.filter(o => o.kind === "code");
        assert.strictEqual(new Set(files.map(o => o.kind === "code" ? o.fileName : "")).size, files.length);
        assert.ok(result.messages.some(m => m.text.includes("multipart generation is unsupported")));
        assert.ok(files.some(f => f.title.includes("Postman")));
    });
    (0, run_unit_tests_1.test)("saved presets redact secrets and never store the original command", async () => {
        let saved = [];
        const context = { storage: { get: (_key, fallback) => saved ?? fallback, set: async (_key, value) => { saved = value; } } };
        await curl_1.curlTool.run({ curl: "curl https://example.com -H 'Authorization: Bearer TOPSECRET'" }, context, "save-preset");
        assert.ok(!JSON.stringify(saved).includes("TOPSECRET"));
        assert.strictEqual((await curl_1.curlTool.dynamicExamples(context)).length, 1);
        await curl_1.curlTool.run({}, context, "clear-presets");
        assert.deepStrictEqual(saved, []);
        assert.ok(curl_1.curlTool.fields.find(f => f.id === "curl").sensitive);
    });
    (0, run_unit_tests_1.test)("every original client target remains available", () => {
        for (const id of ["fetch", "axios", "node-fetch", "python", "go", "php", "java", "dart-http", "dart-dio", "kotlin-okhttp", "swift", "http", "httpie"])
            assert.ok(web_curl_1.CURL_TARGETS.some(t => t.id === id));
    });
});
(0, run_unit_tests_1.suite)("cURL converter: real-world commands (11.89)", () => {
    (0, run_unit_tests_1.test)("value-taking transport, TLS and output options never become a second URL", () => {
        for (const option of ["--noproxy '*'", "--cert-type PEM", "--keepalive-time 60", "--unix-socket /var/run/docker.sock", "--proto =https", "--variable a=b", "--connect-to a:443:b:443", "--dns-servers 1.1.1.1", "--expect100-timeout 2", "--max-filesize 100", "--happy-eyeballs-timeout-ms 100", "--proxy-header 'X: y'", "--trace-ascii -", "--stderr -", "-E client.pem", "-U user:pass", "--tlsv1.2 --http2"]) {
            const r = parse(`curl ${option} https://api.example.com/users`);
            assert.strictEqual(r.url, "https://api.example.com/users", option);
            assert.strictEqual(r.method, "GET", option);
        }
        assert.ok(parse("curl -sSE client.pem https://api.example.com").url.endsWith("api.example.com"));
    });
    (0, run_unit_tests_1.test)("-d @file converts as a body file with a newline-stripping warning; stdin stays unsupported", () => {
        const r = parse("curl -d @body.json -H 'Content-Type: application/json' https://api.example.com/items");
        assert.strictEqual(r.bodyFile, "body.json");
        assert.strictEqual(r.method, "POST");
        assert.ok(r.warnings.some(w => w.includes("removes carriage returns")));
        assert.ok((0, web_curl_1.generateFromCurl)(r, "python").includes('open("body.json", "rb")'));
        assert.throws(() => parse("curl -d @- https://api.example.com"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("digest, NTLM and Negotiate generate challenge-response clients or explain the limitation", () => {
        const r = parse("curl --digest -u admin:pw https://device.example.com/status");
        assert.strictEqual(r.authScheme, "digest");
        const python = (0, web_curl_1.generateFromCurl)(r, "python");
        assert.ok(python.includes("from requests.auth import HTTPDigestAuth") && python.includes('auth=HTTPDigestAuth("admin", "pw")'));
        assert.ok((0, web_curl_1.generateFromCurl)(r, "python-httpx").includes('auth=httpx.DigestAuth("admin", "pw")'));
        const csharp = (0, web_curl_1.generateFromCurl)(r, "csharp");
        assert.ok(csharp.includes('Credentials = new System.Net.NetworkCredential("admin", "pw")') && !csharp.includes('"Basic"'));
        assert.ok((0, web_curl_1.generateFromCurl)(r, "httpie").includes("--auth-type=digest --auth admin:pw"));
        for (const target of ["fetch", "go", "java", "swift", "http"])
            assert.throws(() => (0, web_curl_1.generateFromCurl)(r, target), /Digest authentication is not generated/);
        assert.ok((0, web_curl_1.toCurl)(r).includes("--digest -u admin:pw"));
        assert.strictEqual(parse((0, web_curl_1.toCurl)(r)).authScheme, "digest");
        assert.strictEqual(JSON.parse((0, curl_exports_1.curlPostman)([r])).item[0].request.auth.type, "digest");
        assert.ok(!JSON.parse((0, curl_exports_1.curlHar)([r])).log.entries[0].request.headers.some((h) => h.name === "Authorization"));
        const ntlm = parse("curl --ntlm -u 'DOMAIN\\user:pw' https://intranet.example.com");
        assert.ok((0, web_curl_1.generateFromCurl)(ntlm, "csharp").includes("NetworkCredential"));
        assert.throws(() => (0, web_curl_1.generateFromCurl)(ntlm, "python"), /NTLM/);
        // An explicit Authorization header wins, as in curl, so every target stays available.
        assert.doesNotThrow(() => (0, web_curl_1.generateFromCurl)(parse("curl --digest -u a:b -H 'Authorization: Bearer t' https://x.example.com"), "go"));
        assert.ok((0, web_curl_1.generateFromCurl)(parse("curl --basic -u a:b https://x.example.com"), "go").includes("SetBasicAuth"));
    });
    (0, run_unit_tests_1.test)("--aws-sigv4 is kept in normalized cURL and explained for code targets", () => {
        const r = parse("curl --aws-sigv4 'aws:amz:us-east-1:execute-api' -u AKID:SECRET https://abc.execute-api.us-east-1.amazonaws.com/prod");
        assert.strictEqual(r.awsSigv4, "aws:amz:us-east-1:execute-api");
        assert.throws(() => (0, web_curl_1.generateFromCurl)(r, "python"), /AWS Signature V4/);
        assert.ok((0, web_curl_1.toCurl)(r).includes("--aws-sigv4 aws:amz:us-east-1:execute-api"));
        assert.throws(() => parse("curl --aws-sigv4 aws:amz:us-east-1:s3 https://s3.example.com"), /ACCESS_KEY/);
    });
    (0, run_unit_tests_1.test)("Windows cmd reads backslash-escaped quotes the way curl.exe does", () => {
        const r = parse('curl -X POST https://api.example.com -H "Content-Type: application/json" -d "{\\"name\\":\\"Ada\\"}"', "cmd");
        assert.strictEqual(r.body, '{"name":"Ada"}');
        assert.strictEqual(r.bodyKind, "json");
        assert.deepStrictEqual((0, web_curl_1.tokenizeShell)('curl -d "a\\\\\\"b" x', "cmd").slice(-2), ['a\\"b', "x"]);
        // Backslashes not followed by a quote stay literal; a doubled backslash before the closing quote becomes one.
        assert.deepStrictEqual((0, web_curl_1.tokenizeShell)('curl -d "C:\\dir\\\\" x', "cmd").slice(-2), ["C:\\dir\\", "x"]);
        const ps = parse("curl.exe -d '{\\\"a\\\":1}' -H 'Content-Type: application/json' https://x.example.com", "powershell");
        assert.strictEqual(ps.bodyKind, "raw");
        assert.ok(ps.warnings.some(w => w.includes("backslash-escaped quotes")));
    });
    (0, run_unit_tests_1.test)("comments are skipped without breaking continued commands, fragments or batches", () => {
        const r = parse("curl https://api.example.com/users \\\n  # the auth header\n  -H 'Authorization: Bearer t' # trailing note\n");
        assert.deepStrictEqual(r.headers, [["Authorization", "Bearer t"]]);
        assert.deepStrictEqual(parse("curl -H 'X-Id: #1' https://x.example.com/a#frag").headers, [["X-Id", "#1"]]);
        assert.deepStrictEqual((0, web_curl_1.parseCurlCommands)("# list users\ncurl https://a.example.com\n# don't forget orders\ncurl https://b.example.com").map(x => x.url), ["https://a.example.com", "https://b.example.com"]);
        // The shared tokenizer keeps # for other callers (docker run conversion).
        assert.deepStrictEqual((0, web_curl_1.tokenizeShell)("docker run img echo #tag"), ["docker", "run", "img", "echo", "#tag"]);
    });
    (0, run_unit_tests_1.test)("cookies, URL spaces, empty passwords and other programs get accurate handling", () => {
        assert.deepStrictEqual(parse("curl -b a=1 -b 'b=2;' https://x.example.com").headers, [["Cookie", "a=1; b=2"]]);
        const spaced = parse("curl 'https://x.example.com/a b?q=x y'");
        assert.strictEqual(spaced.url, "https://x.example.com/a%20b?q=x%20y");
        assert.ok(spaced.warnings.some(w => w.includes("percent-encoded")));
        assert.ok(parse("curl -u admin https://x.example.com").warnings.some(w => w.includes("no password")));
        assert.throws(() => parse("wget https://x.example.com"), /looks like a wget command/);
        assert.throws(() => parse("curl -H 'Accept: */*'"), /has no URL/);
    });
    (0, run_unit_tests_1.test)("invalid JSON bodies report a location, never the body text", () => {
        const r = parse("curl -H 'Content-Type: application/json' -d '{\"token\":\"SECRET\",\n \"b\": }' https://x.example.com");
        assert.strictEqual(r.bodyKind, "raw");
        const warning = r.warnings.join(" ");
        assert.ok(warning.includes("line 2, column 7"), warning);
        assert.ok(!warning.includes("SECRET"));
    });
    (0, run_unit_tests_1.test)("tool output leads with the request summary and groups the form", async () => {
        const result = await curl_1.curlTool.run({ curl: "curl -X PATCH https://api.example.com/v1/users/1 --json '{\"a\":1}'", target: "fetch", shell: "auto", export: "none" }, {});
        assert.deepStrictEqual(result.stats.slice(0, 3).map(s => s.value), ["PATCH api.example.com", "json", "2"]);
        assert.ok(curl_1.curlTool.fields.filter(f => f.group).length >= 3);
        for (const example of curl_1.curlTool.examples)
            await curl_1.curlTool.run({ shell: "auto", target: "fetch", export: "none", ...example.values }, {});
    });
});
//# sourceMappingURL=curl-converter.unit.js.map