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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const crypto_1 = require("crypto");
const ts = __importStar(require("typescript"));
const yaml_1 = __importDefault(require("yaml"));
const registry_1 = require("../../toolkits/registry");
const types_1 = require("../../toolkits/types");
const web_curl_1 = require("../../toolkits/engines/web-curl");
const web_http_1 = require("../../toolkits/engines/web-http");
const web_security_1 = require("../../toolkits/engines/web-security");
const web_auth_1 = require("../../toolkits/engines/web-auth");
const web_apispec_1 = require("../../toolkits/engines/web-apispec");
const web_frontend_1 = require("../../toolkits/engines/web-frontend");
const web_scaffold_1 = require("../../toolkits/engines/web-scaffold");
const web_git_1 = require("../../toolkits/engines/web-git");
const mobile_config_1 = require("../../toolkits/engines/mobile-config");
const mobile_build_1 = require("../../toolkits/engines/mobile-build");
const devops_docker_1 = require("../../toolkits/engines/devops-docker");
const dev_regex_1 = require("../../toolkits/engines/dev-regex");
const data_types_1 = require("../../toolkits/engines/data-types");
const mobile_1 = require("../../toolkits/sections/mobile");
const run_unit_tests_1 = require("./run-unit-tests");
const ctx = { now: () => new Date("2026-10-01T10:00:00Z"), storage: { get: (_k, d) => d, set: async () => undefined } };
const tool = (id) => registry_1.ALL_TOOLS.find(t => t.id === id);
function transpiles(source, tsx = false) {
    const out = ts.transpileModule(source, { fileName: tsx ? "x.tsx" : "x.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, ...(tsx ? { jsx: ts.JsxEmit.Preserve } : {}) } });
    return (out.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
(0, run_unit_tests_1.suite)("web: cURL converter", () => {
    (0, run_unit_tests_1.test)("tokenizes bash, ANSI-C and cmd quoting with continuations", () => {
        assert.deepStrictEqual((0, web_curl_1.tokenizeShell)("curl -H 'A: b' \\\n  --data $'x\\ny' \"q\\\"s\""), ["curl", "-H", "A: b", "--data", "x\ny", 'q"s']);
        assert.deepStrictEqual((0, web_curl_1.tokenizeShell)('curl "https://x.io" ^\n -H "A: ^"b^""'), ["curl", "https://x.io", "-H", 'A: "b"']);
    });
    (0, run_unit_tests_1.test)("understands combined flags, -G, --data-urlencode, --json and multipart", () => {
        const r = (0, web_curl_1.parseCurl)("curl -sSLX PUT https://api.example.com/x --json '{\"a\":1}'");
        assert.strictEqual(r.method, "PUT");
        assert.strictEqual(r.followRedirects, true);
        assert.strictEqual(r.bodyKind, "json");
        assert.ok(r.headers.some(([k, v]) => k === "Content-Type" && v === "application/json"));
        const g = (0, web_curl_1.parseCurl)("curl -G https://a.io/s --data-urlencode 'q=a b&c' -d n=2");
        assert.strictEqual(g.method, "GET");
        assert.strictEqual(g.url, "https://a.io/s?q=a%20b%26c&n=2");
        const m = (0, web_curl_1.parseCurl)("curl https://a.io/up -F file=@./a.png -F name=x -H 'Content-Type: multipart/form-data; boundary=zz'");
        assert.strictEqual(m.bodyKind, "multipart");
        assert.deepStrictEqual(m.form, [{ name: "file", value: "./a.png", file: true }, { name: "name", value: "x", file: false }]);
        assert.ok(!m.headers.some(([k]) => k.toLowerCase() === "content-type"), "the copied boundary header is dropped");
        assert.throws(() => (0, web_curl_1.parseCurl)("wget https://x"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("generated JavaScript and TypeScript compile for every body kind", () => {
        for (const cmd of ["curl https://a.io", "curl -X POST https://a.io -d 'a=1&b=2'", "curl https://a.io --json '{\"x\":[1,{\"y\":null}]}'", "curl https://a.io -F f=@x.png -u u:p", "curl -X DELETE https://a.io --data-raw 'raw text' -m 5"]) {
            const r = (0, web_curl_1.parseCurl)(cmd);
            for (const target of ["fetch", "axios", "node-fetch"])
                assert.deepStrictEqual(transpiles((0, web_curl_1.generateFromCurl)(r, target)), [], `${target}: ${cmd}`);
        }
    });
    (0, run_unit_tests_1.test)("escapes $ for Dart and Kotlin string templates", () => {
        const r = (0, web_curl_1.parseCurl)("curl https://a.io --data-raw '{\"price\":\"$5\"}' -H 'Content-Type: application/json'");
        assert.ok((0, web_curl_1.generateFromCurl)(r, "dart-http").includes("'\\$5'"));
        assert.ok((0, web_curl_1.generateFromCurl)(r, "kotlin-okhttp").includes("\\$5"));
    });
});
(0, run_unit_tests_1.suite)("web: URLs, cookies, caching, CORS, CSP", () => {
    (0, run_unit_tests_1.test)("URL report decodes params and flags leaked tokens and double encoding", () => {
        const r = (0, web_http_1.parseUrlReport)("https://a.io/p?q=caf%C3%A9+latte&access_token=x&u=%252F");
        assert.deepStrictEqual(r.params[0].slice(0, 2), ["q", "café latte"]);
        assert.ok(r.warnings.some(w => w.includes("access_token")));
        assert.ok(r.warnings.some(w => w.includes("encoded twice")));
    });
    (0, run_unit_tests_1.test)("query strings round-trip through nested JSON", () => {
        const obj = (0, web_http_1.queryToObject)("filter[status]=active&filter[age][gte]=18&tags[]=a&tags[]=b");
        assert.deepStrictEqual(obj, { filter: { status: "active", age: { gte: "18" } }, tags: ["a", "b"] });
        assert.strictEqual((0, web_http_1.objectToQuery)({ a: { b: 1 }, t: ["x", "y"] }, "brackets"), "a[b]=1&t[]=x&t[]=y");
        assert.strictEqual((0, web_http_1.objectToQuery)({ t: ["x", "y"] }, "comma"), "t=x,y");
        assert.strictEqual((0, web_http_1.buildUrl)("https://a.io/s?x=1", "q=a b&c\n-x"), "https://a.io/s?q=a%20b%26c");
    });
    (0, run_unit_tests_1.test)("cookies: browsers' silent rejections are errors", () => {
        const c = (0, web_http_1.parseSetCookie)("Set-Cookie: session=1; SameSite=None; Path=/", new Date());
        assert.ok(c.issues.some(i => i.severity === "error" && /SameSite=None without Secure/.test(i.message)));
        assert.ok(c.issues.some(i => i.severity === "error" && /HttpOnly/.test(i.message)));
        const host = (0, web_http_1.parseSetCookie)("__Host-x=1; Secure; Path=/app", new Date());
        assert.ok(host.issues.some(i => /__Host-/.test(i.message)));
    });
    (0, run_unit_tests_1.test)("Cache-Control explanations catch contradictions", () => {
        const r = (0, web_http_1.explainCacheControl)("public, private, max-age=60, immutable");
        assert.ok(r.warnings.some(w => /contradict/.test(w)));
        assert.ok(r.warnings.some(w => /immutable/.test(w)));
    });
    (0, run_unit_tests_1.test)("CORS check mirrors the browser", () => {
        const wildcard = (0, web_security_1.checkCors)({ origin: "http://localhost:3000", method: "PUT", requestHeaders: ["Authorization"], credentials: true, responseHeaders: "Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: GET", preflightStatus: 204 });
        assert.strictEqual(wildcard.preflightNeeded, true);
        assert.strictEqual(wildcard.passed, false);
        const ok = (0, web_security_1.checkCors)({ origin: "https://app.io", method: "GET", requestHeaders: [], credentials: false, responseHeaders: "Access-Control-Allow-Origin: https://app.io" });
        assert.strictEqual(ok.passed, true);
        assert.strictEqual(ok.preflightNeeded, false);
        assert.ok((0, web_security_1.explainCorsError)("Response to preflight request doesn't pass access control check: It does not have HTTP ok status.").length);
    });
    (0, run_unit_tests_1.test)("CSP analysis flags unsafe-inline scripts and missing directives", () => {
        const r = (0, web_security_1.analyzeCsp)("default-src 'self'; script-src 'self' 'unsafe-inline'");
        assert.ok(r.issues.some(i => i.severity === "error" && /unsafe-inline/.test(i.message)));
        assert.ok(r.issues.some(i => /frame-ancestors/.test(i.message)));
    });
});
(0, run_unit_tests_1.suite)("web: auth", () => {
    (0, run_unit_tests_1.test)("PKCE matches the RFC 7636 test vector", () => {
        assert.strictEqual((0, web_auth_1.pkcePair)("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert.throws(() => (0, web_auth_1.pkcePair)("short"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("JWT signing round-trips for HMAC, RSA, PSS, ECDSA and EdDSA", () => {
        const payload = { sub: "u1" };
        const hs = (0, web_auth_1.signJwt)({ alg: "HS256", typ: "JWT" }, payload, "a-very-long-development-secret-123");
        assert.strictEqual((0, web_auth_1.verifyJwtSignature)(hs, "a-very-long-development-secret-123").ok, true);
        assert.strictEqual((0, web_auth_1.verifyJwtSignature)(hs, "wrong-secret-wrong-secret-wrong!!").ok, false);
        assert.throws(() => (0, web_auth_1.signJwt)({ alg: "HS256" }, payload, "short"), types_1.ToolInputError);
        const pairs = [
            ["RS256", (0, crypto_1.generateKeyPairSync)("rsa", { modulusLength: 2048 })],
            ["PS256", (0, crypto_1.generateKeyPairSync)("rsa", { modulusLength: 2048 })],
            ["ES256", (0, crypto_1.generateKeyPairSync)("ec", { namedCurve: "prime256v1" })],
            ["EdDSA", (0, crypto_1.generateKeyPairSync)("ed25519")]
        ];
        for (const [alg, { privateKey, publicKey }] of pairs) {
            const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
            const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
            // Pasting a PEM into a single-line box loses the line breaks; it must still work.
            const token = (0, web_auth_1.signJwt)({ alg, typ: "JWT" }, payload, priv.replace(/\n/g, " "));
            assert.strictEqual((0, web_auth_1.verifyJwtSignature)(token, pub).ok, true, alg);
            assert.strictEqual((0, web_auth_1.verifyJwtSignature)(token, JSON.stringify(publicKey.export({ format: "jwk" }))).ok, true, `${alg} via JWK`);
            if (alg === "ES256")
                assert.strictEqual(Buffer.from(token.split(".")[2], "base64url").length, 64, "ES256 signatures are raw r||s");
        }
        assert.ok((0, web_auth_1.normalizePem)("-----BEGIN PUBLIC KEY----- AAAA BBBB -----END PUBLIC KEY-----").includes("\nAAAABBBB\n"));
    });
    (0, run_unit_tests_1.test)("webhook signatures for GitHub, Stripe and Slack", () => {
        const body = '{"a":1}';
        const gh = `sha256=${(0, crypto_1.createHmac)("sha256", "s").update(body).digest("hex")}`;
        assert.strictEqual((0, web_auth_1.verifyWebhook)({ provider: "github", payload: body, secret: "s", signature: gh, now: new Date() }).match, true);
        assert.strictEqual((0, web_auth_1.verifyWebhook)({ provider: "github", payload: body + " ", secret: "s", signature: gh, now: new Date() }).match, false);
        const t = "1759312800";
        const v1 = (0, crypto_1.createHmac)("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
        const stripe = (0, web_auth_1.verifyWebhook)({ provider: "stripe", payload: body, secret: "whsec_x", signature: `t=${t},v1=${v1}`, now: new Date(Number(t) * 1000) });
        assert.strictEqual(stripe.match, true);
        assert.deepStrictEqual(stripe.notes, []);
        const slack = `v0=${(0, crypto_1.createHmac)("sha256", "k").update(`v0:${t}:${body}`).digest("hex")}`;
        assert.strictEqual((0, web_auth_1.verifyWebhook)({ provider: "slack", payload: body, secret: "k", signature: slack, timestamp: t, now: new Date(Number(t) * 1000) }).match, true);
    });
    (0, run_unit_tests_1.test)("the JWT tool signs and then verifies its own token", async () => {
        const jwt = tool("dev.jwt");
        const signed = await jwt.run({ mode: "sign", alg: "HS256", payload: '{"sub":"1"}', expiresIn: 5, iat: true, secret: "a-very-long-development-secret-123" }, ctx);
        const token = signed.outputs[0].content;
        const decoded = await jwt.run({ mode: "decode", token, secret: "a-very-long-development-secret-123" }, ctx);
        assert.strictEqual(decoded.stats.find(s => s.label === "Signature").value, "valid");
    });
});
(0, run_unit_tests_1.suite)("web: API specs and GraphQL", () => {
    (0, run_unit_tests_1.test)("OpenAPI: operations, lint and a client that compiles", () => {
        const doc = (0, web_apispec_1.parseSpec)(tool("web.openapi").fields.find(f => f.id === "spec").default);
        const ops = (0, web_apispec_1.operations)(doc);
        assert.deepStrictEqual(ops.map(o => `${o.method} ${o.path}`), ["GET /orders", "POST /orders", "GET /orders/{orderId}"]);
        assert.deepStrictEqual((0, web_apispec_1.lintSpec)(doc, ops).filter(i => i.severity === "error"), []);
        assert.deepStrictEqual(transpiles((0, web_apispec_1.specClient)(doc, ops)), []);
        const broken = (0, web_apispec_1.parseSpec)("openapi: 3.0.0\ninfo: { title: x, version: '1' }\npaths:\n  /a/{id}:\n    get:\n      responses: { '200': { description: ok } }");
        assert.ok((0, web_apispec_1.lintSpec)(broken, (0, web_apispec_1.operations)(broken)).some(i => /\{id\} is not declared/.test(i.message)));
    });
    (0, run_unit_tests_1.test)("GraphQL: formatting is stable and minifying keeps tokens apart", () => {
        const q = "query Q($id: ID!, $n: Int = 5) { user(id: $id) { id ...F posts(first: $n, where: {a: 1, b: [1, 2]}) { title } } } fragment F on User { name }";
        const once = (0, web_apispec_1.formatGraphql)(q);
        assert.strictEqual((0, web_apispec_1.formatGraphql)(once), once, "formatting twice changes nothing");
        assert.strictEqual((0, web_apispec_1.minifyGraphql)(once), (0, web_apispec_1.minifyGraphql)(q));
        assert.ok(once.includes("posts(first: $n, where: { a: 1, b: [1, 2] }) {"), once);
        const ops = (0, web_apispec_1.graphqlOperations)(q);
        assert.deepStrictEqual(ops.operations[0].variables.map(v => `${v.name}:${v.type}`), ["id:ID!", "n:Int"]);
        assert.deepStrictEqual(ops.fragments, ["F"]);
        assert.throws(() => (0, web_apispec_1.formatGraphql)("{ a { b }"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("GraphQL SDL becomes TypeScript that compiles", () => {
        const sdl = tool("web.graphql").fields.find(f => f.id === "sdl").default;
        const out = (0, web_apispec_1.sdlToTypeScript)(sdl);
        assert.ok(out.includes('export type Role = "ADMIN" | "EDITOR" | "VIEWER";'));
        assert.ok(out.includes("export type SearchResult = User | Post;"));
        assert.deepStrictEqual(transpiles(out), []);
    });
});
(0, run_unit_tests_1.suite)("web: frontend and backend generators", () => {
    (0, run_unit_tests_1.test)("HTML → JSX converts attributes, styles, void tags and text braces", () => {
        const r = (0, web_frontend_1.htmlToJsx)('<div class="a" style="margin-top: 4px; -webkit-line-clamp: 2" onclick="go()"><label for="x">{x} > y</label><input value="v" tabindex="2"><br><!-- c --><svg stroke-width="2"><path fill-rule="evenodd"/></svg></div>', { wrap: "component", name: "card", typescript: true });
        for (const s of ['className="a"', "style={{ marginTop: \"4px\", WebkitLineClamp: 2 }}", "htmlFor=\"x\"", "defaultValue=\"v\"", "tabIndex={2}", "<br />", "{/* c */}", "strokeWidth=\"2\"", "fillRule=\"evenodd\"", 'onClick={() => { go(); }}', '{"{"}x{"}"} {">"} y'])
            assert.ok(r.code.includes(s), `missing ${s} in\n${r.code}`);
        assert.deepStrictEqual(transpiles(r.code, true), []);
    });
    (0, run_unit_tests_1.test)("fluid clamp() hits the requested sizes at both viewports", () => {
        const { slope, intercept } = (0, web_frontend_1.fluidClamp)(16, 24, 400, 1200, 16);
        assert.ok(Math.abs(intercept + slope * 400 - 16) < 1e-9);
        assert.ok(Math.abs(intercept + slope * 1200 - 24) < 1e-9);
    });
    (0, run_unit_tests_1.test)("every API scaffold variant compiles", async () => {
        const scaffold = tool("web.api-scaffold");
        for (const framework of ["express", "nestjs", "next", "fastify"]) {
            for (const db of ["prisma", "mongoose", "memory"]) {
                const r = await scaffold.run({ resource: "blogPost", framework, db, fields: "title: string!\nbody: text\nviews: int\nstatus: enum(draft|live)!\ntags: string[]\npublishedAt: date" }, ctx);
                const files = r.outputs[0].files;
                for (const f of files.filter(x => x.language === "typescript")) {
                    const out = ts.transpileModule(f.content, { fileName: "x.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
                    assert.deepStrictEqual((out.diagnostics ?? []).map(d => String(d.messageText)), [], `${framework}/${db} ${f.path}`);
                }
            }
        }
        assert.throws(() => (0, web_scaffold_1.parseFields)("price number?? weird"), types_1.ToolInputError);
    });
    (0, run_unit_tests_1.test)("connection strings encode special characters and survive a round trip", () => {
        const parsed = (0, web_scaffold_1.parseConnectionUrl)("postgresql://app:p@ss/w#rd@db.example.com:5432/orders?sslmode=require");
        assert.strictEqual(parsed.password, "p@ss/w#rd");
        assert.strictEqual(parsed.host, "db.example.com");
        const url = (0, web_scaffold_1.buildConnectionUrl)(parsed);
        assert.strictEqual(url, "postgresql://app:p%40ss%2Fw%23rd@db.example.com:5432/orders?sslmode=require");
        assert.deepStrictEqual({ ...(0, web_scaffold_1.parseConnectionUrl)(url), options: [] }, { ...parsed, options: [] });
        assert.strictEqual((0, web_scaffold_1.buildConnectionUrl)({ kind: "redis", host: "cache", port: 6379, user: "", password: "", database: "0", ssl: true, options: [] }), "rediss://cache:6379/0");
    });
    (0, run_unit_tests_1.test)("SQL → MongoDB handles filters, sorting, paging and grouping", () => {
        const find = (0, web_scaffold_1.sqlToMongo)("SELECT a, b FROM users WHERE x >= 1 AND y IN ('p','q') AND z IS NOT NULL ORDER BY c DESC LIMIT 10 OFFSET 20");
        assert.ok(find.shell.includes('x: { $gte: 1 }') && find.shell.includes('y: { $in: ["p", "q"] }') && find.shell.includes("z: { $ne: null }"), find.shell);
        assert.ok(find.shell.endsWith(".sort({ c: -1 }).skip(20).limit(10)"), find.shell);
        const agg = (0, web_scaffold_1.sqlToMongo)("SELECT country, COUNT(*) AS n FROM users GROUP BY country HAVING COUNT(*) > 3");
        assert.ok(agg.aggregate && agg.shell.includes("$group") && agg.shell.includes("n: { $gt: 3 }"), agg.shell);
        assert.throws(() => (0, web_scaffold_1.sqlToMongo)("SELECT * FROM a JOIN b ON a.id = b.a"), /lookup/);
    });
});
(0, run_unit_tests_1.suite)("web: git and versions", () => {
    (0, run_unit_tests_1.test)("semver ranges follow npm semantics", () => {
        const allowed = (range, v) => (0, web_git_1.satisfies)((0, web_git_1.parseVersion)(v), (0, web_git_1.parseRange)(range));
        assert.ok(allowed("^1.2.3", "1.9.9") && !allowed("^1.2.3", "2.0.0") && !allowed("^1.2.3", "1.3.0-beta.1"));
        assert.ok(allowed("^0.2.3", "0.2.9") && !allowed("^0.2.3", "0.3.0"));
        assert.ok(allowed("~1.2", "1.2.7") && !allowed("~1.2", "1.3.0"));
        assert.ok(allowed("1.2.3 - 2.3", "2.3.9") && !allowed("1.2.3 - 2.3", "2.4.0"));
        assert.ok(allowed("^1.2.3-beta.2", "1.2.3-beta.4") && !allowed("^1.2.3-beta.2", "1.2.4-beta.1"));
        assert.ok(allowed(">=1.0.0 <2 || 3.x", "3.4.0"));
        const sorted = ["1.0.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-rc.1", "0.9.9"].map(web_git_1.parseVersion).sort(web_git_1.compareVersions).map(web_git_1.formatVersion);
        assert.deepStrictEqual(sorted, ["0.9.9", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-rc.1", "1.0.0"]);
        assert.strictEqual((0, web_git_1.formatVersion)((0, web_git_1.bump)((0, web_git_1.parseVersion)("1.2.3-rc.1"), "prerelease", "rc")), "1.2.3-rc.2");
        assert.strictEqual((0, web_git_1.formatVersion)((0, web_git_1.bump)((0, web_git_1.parseVersion)("2.0.0-rc.1"), "major", "rc")), "2.0.0");
    });
    (0, run_unit_tests_1.test)("commit messages follow Conventional Commits", () => {
        const r = (0, web_git_1.commitMessage)({ type: "feat", scope: "Auth", subject: "add reset", body: "", breaking: "tokens expire", issues: "12" });
        assert.strictEqual(r.message, "feat(auth)!: add reset\n\nBREAKING CHANGE: tokens expire\nCloses #12");
        assert.strictEqual(r.branch, "feature/12-add-reset");
    });
});
(0, run_unit_tests_1.suite)("mobile tools", () => {
    (0, run_unit_tests_1.test)("deep link files are valid and path matching works", () => {
        const r = (0, mobile_config_1.deepLinkFiles)({ domain: "https://example.com/", scheme: "ex", androidPackage: "com.ex.app", fingerprints: ["146de983c5730650d8eeb9952f34fc6416a08342e61dbea88a0496b23fcf44e5"], teamId: "ABCDE12345", bundleId: "com.ex.app", paths: ["/p/*", "/invite/:code", "!/p/secret"], framework: "flutter" });
        const aasa = JSON.parse(r.files.find(f => f.path.endsWith("apple-app-site-association")).content);
        assert.deepStrictEqual(aasa.applinks.details[0].components, [{ "/": "/p/*" }, { "/": "/invite/*" }, { "/": "/p/secret", exclude: true }]);
        const links = JSON.parse(r.files.find(f => f.path.endsWith("assetlinks.json")).content);
        assert.strictEqual(links[0].target.sha256_cert_fingerprints[0].split(":").length, 32);
        assert.ok((0, mobile_config_1.pathMatches)("/invite/:code", "/invite/abc") && (0, mobile_config_1.pathMatches)("/p/*", "/p") && !(0, mobile_config_1.pathMatches)("/p/*", "/q/1"));
        assert.strictEqual((0, mobile_config_1.normalizeFingerprint)("sha1-is-too-short"), undefined);
    });
    (0, run_unit_tests_1.test)("colours: 8-digit hex follows the chosen convention", () => {
        const css = (0, mobile_config_1.parseColor)("#11223380", "css");
        const argb = (0, mobile_config_1.parseColor)("#80112233", "argb");
        assert.deepStrictEqual([css.r, css.g, css.b, Math.round(css.a * 255)], [17, 34, 51, 128]);
        assert.deepStrictEqual([argb.r, argb.g, argb.b, Math.round(argb.a * 255)], [17, 34, 51, 128]);
        const flutter = (0, mobile_config_1.parseColor)("Color(0xFF1E88E5)", "css");
        assert.ok((0, mobile_config_1.colorFormats)(flutter).some(([k, v]) => k === "Jetpack Compose" && v === "Color(0xFF1E88E5)"));
        assert.strictEqual((0, mobile_config_1.contrastRatio)({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }).toFixed(1), "21.0");
    });
    (0, run_unit_tests_1.test)("fingerprints convert between hex and Base64 (Facebook key hash)", () => {
        const r = (0, mobile_build_1.convertFingerprint)("5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25");
        assert.strictEqual(r.algorithm, "SHA-1");
        assert.strictEqual(r.base64, Buffer.from("5E8F16062EA3CD2C4A0D547876BAA6F38CABF625", "hex").toString("base64"));
        assert.strictEqual((0, mobile_build_1.convertFingerprint)(r.base64).colonHex, "5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25");
    });
    (0, run_unit_tests_1.test)("certificates: fingerprints and the SPKI pin match openssl", () => {
        const [cert] = (0, mobile_build_1.parseCertificates)(mobile_1.SAMPLE_CERT, new Date("2026-10-01T12:00:00Z"));
        assert.strictEqual(cert.spkiPin, "PpLA3IfMfpb9sKnohQQ7mFONSq1G8xtWYzIiBS9oZPs=");
        assert.ok(cert.sans.includes("DNS:*.example.com"));
        assert.strictEqual(cert.selfSigned, true);
    });
    (0, run_unit_tests_1.test)("build errors are recognised with their line numbers", () => {
        const found = (0, mobile_build_1.explainBuildLog)("line one\n> Unsupported class file major version 65\nerror Unable to resolve module react-native-svg from App.tsx\nERESOLVE unable to resolve dependency tree");
        assert.deepStrictEqual(found.map(f => [f.error.id, f.lineNo]), [["class-version", 2], ["metro-resolve", 3], ["eresolve", 4]]);
    });
    (0, run_unit_tests_1.test)("toolchain check reads Gradle files and catches mismatches", () => {
        const v = (0, mobile_build_1.detectVersions)('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip\nid "com.android.application" version "8.7.3" apply false\nid("org.jetbrains.kotlin.android") version "2.0.21"\ncompileSdk = 35\nminSdk = 24\ntargetSdk = 34');
        assert.deepStrictEqual(v, { gradle: "8.4", agp: "8.7.3", kotlin: "2.0.21", compileSdk: 35, targetSdk: 34, minSdk: 24 });
        const checks = (0, mobile_build_1.checkAndroidToolchain)({ ...v, runtimeJdk: 21 });
        assert.ok(checks.some(c => c.severity === "error" && /Gradle 8.4 is too old/.test(c.text)));
        assert.ok(checks.some(c => c.severity === "error" && /JDK 21/.test(c.text)));
        assert.ok(checks.some(c => c.severity === "error" && /targetSdk 34/.test(c.text)));
    });
    (0, run_unit_tests_1.test)("mobile CI workflows are valid YAML for every stack", async () => {
        const ci = tool("mobile.ci");
        for (const stack of ["flutter", "react-native", "expo", "android", "ios"]) {
            const r = await ci.run({ stack, branch: "main", tests: true, release: true, deploy: true, node: "22", java: "17", flutter: "3.35.x", scheme: "App", packageManager: "pnpm" }, ctx);
            const wf = r.outputs[0].files[0];
            const doc = yaml_1.default.parse(wf.content);
            assert.ok(doc.jobs && Object.keys(doc.jobs).length >= 2, stack);
        }
    });
    (0, run_unit_tests_1.test)("JSON → Dart, Kotlin and Swift models", () => {
        const shape = (0, data_types_1.recordShape)([{ id: 1, created_at: "2026-01-01T00:00:00Z", tags: ["a"], owner: { name: "x" } }, { id: 2, created_at: "2026-01-01T00:00:00Z", tags: [], owner: { name: "y" }, note: "n" }]);
        const dart = (0, data_types_1.toDart)(shape, "Item", "manual");
        assert.ok(dart.includes("createdAt: DateTime.parse(json['created_at'] as String),") && dart.includes("final String? note;") && dart.includes("owner.toJson()"), dart);
        const kotlin = (0, data_types_1.toKotlin)(shape, "Item", "kotlinx", "");
        assert.ok(kotlin.includes('@SerialName("created_at") val createdAt: String') && kotlin.includes("val note: String? = null"), kotlin);
        const swift = (0, data_types_1.toSwift)(shape, "Item", false);
        assert.ok(swift.includes("let createdAt: Date") && swift.includes('case createdAt = "created_at"') && swift.includes("let note: String?"), swift);
    });
});
(0, run_unit_tests_1.suite)("dev and devops additions", () => {
    (0, run_unit_tests_1.test)("docker run → compose", () => {
        const r = (0, devops_docker_1.dockerRunToCompose)("docker run -d --name api -p 8080:80 -e A=1 -v data:/d --restart always nginx:1.27 nginx -g 'daemon off;'");
        const doc = yaml_1.default.parse(r.yaml);
        assert.deepStrictEqual(doc.services.api.ports, ["8080:80"]);
        assert.deepStrictEqual(doc.services.api.command, ["nginx", "-g", "daemon off;"]);
        assert.ok("data" in doc.volumes);
        assert.ok(r.yaml.includes('"8080:80"'), "ports are quoted");
    });
    (0, run_unit_tests_1.test)("regex code warns where a language cannot run the pattern", () => {
        assert.ok((0, dev_regex_1.regexCode)("^(?=.*\\d).{8,}$", "", "go").note);
        assert.strictEqual((0, dev_regex_1.regexCode)("^\\d+$", "", "go").note, undefined);
        assert.ok((0, dev_regex_1.regexCode)("^(?<y>\\d{4})$", "", "python").code.includes("(?P<y>"));
        assert.ok((0, dev_regex_1.regexCode)("a$b", "i", "kotlin").code.includes("${'$'}b"));
    });
    (0, run_unit_tests_1.test)("timestamps detect seconds, milliseconds and offsets", async () => {
        const t = tool("dev.timestamp");
        const s = await t.run({ input: "1767225600", zones: "UTC" }, ctx);
        assert.strictEqual(s.stats[0].value, "Unix seconds");
        const ms = await t.run({ input: "1767225600000", offset: "+1d", zones: "UTC" }, ctx);
        const rows = ms.outputs[0].rows;
        assert.strictEqual(rows.find(r => r[0] === "ISO 8601 (UTC)")[1], "2026-01-02T00:00:00.000Z");
    });
    (0, run_unit_tests_1.test)("hashes match known digests", async () => {
        const r = await tool("dev.hash").run({ mode: "hash", input: "abc", encoding: "utf8" }, ctx);
        const rows = r.outputs[0].rows;
        assert.strictEqual(rows.find(x => x[0] === "SHA256")[1], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert.strictEqual(rows.find(x => x[0] === "MD5")[1], "900150983cd24fb0d6963f7d28e17f72");
    });
});
(0, run_unit_tests_1.suite)("merged tools", () => {
    (0, run_unit_tests_1.test)("the formatter handles JSON, YAML and XML", async () => {
        const fmt = tool("text.format");
        const bad = await fmt.run({ input: '{\n  "a": 1,\n  "b": [1,],\n}', format: "auto", action: "validate" }, ctx);
        assert.ok(bad.messages.some(m => m.kind === "error" && /^Line 3:/.test(m.text)), JSON.stringify(bad.messages));
        const min = await fmt.run({ input: '{ "b": 2, "a": { "d": 1, "c": 2 } }', action: "minify", sort: true }, ctx);
        assert.strictEqual(min.outputs[0].content, '{"a":{"c":2,"d":1},"b":2}');
        const yaml = await fmt.run({ input: "ports:\n  - 22:22\ndebug: no\n", action: "to-json" }, ctx);
        assert.ok(yaml.messages.some(m => /base-60/.test(m.text)) && yaml.messages.some(m => /boolean/.test(m.text)));
        const xml = await fmt.run({ input: '<?xml version="1.0"?><a x="1"><b>hi</b><c/><!-- n --></a>', action: "format", indent: "2" }, ctx);
        assert.strictEqual(xml.outputs[0].content, '<?xml version="1.0"?>\n<a x="1">\n  <b>hi</b>\n  <c />\n  <!-- n -->\n</a>\n');
        const broken = await fmt.run({ input: "<a><b></a>", action: "format" }, ctx);
        assert.ok(broken.messages.some(m => m.kind === "error" && /closes <b>/.test(m.text)));
        assert.deepStrictEqual(broken.outputs, []);
    });
    (0, run_unit_tests_1.test)("combined tools keep each mode's fields, presets and aliases working", async () => {
        const t = tool("ai.token-cost");
        assert.strictEqual(t.fields[0].id, "mode");
        // Both original tools had a "provider" field: the clash is resolved by prefixing.
        const providers = t.fields.filter(f => /provider$/.test(f.id)).map(f => f.id);
        assert.deepStrictEqual(providers, ["cost_provider", "compare_provider"]);
        assert.ok(t.aliases.some(a => a.command === "modelComparison" && a.values.mode === "compare"));
        const compare = await t.run({ mode: "compare", compare_provider: "all", sort: "price" }, ctx);
        assert.ok(compare.outputs.length > 0);
        const schemas = tool("data.schema");
        assert.ok(schemas.aliases.some(a => a.command === "schemaDiff"));
        assert.ok(tool("ai.json-output").aliases.some(a => a.command === "llmResponseFormatter"));
        assert.ok(tool("mobile.colors").aliases.some(a => a.command === "colorPalette"));
        assert.ok(tool("text.format").aliases.some(a => a.command === "yamlJsonTool"));
    });
});
//# sourceMappingURL=web-mobile.unit.js.map