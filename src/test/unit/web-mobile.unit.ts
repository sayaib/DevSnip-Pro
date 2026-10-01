import * as assert from "assert";
import { createHmac, generateKeyPairSync } from "crypto";
import * as ts from "typescript";
import YAML from "yaml";
import { ALL_TOOLS } from "../../toolkits/registry";
import { ToolContext, ToolInputError } from "../../toolkits/types";
import { generateFromCurl, parseCurl, tokenizeShell } from "../../toolkits/engines/web-curl";
import { buildUrl, objectToQuery, parseSetCookie, parseUrlReport, queryToObject, explainCacheControl } from "../../toolkits/engines/web-http";
import { analyzeCsp, checkCors, explainCorsError } from "../../toolkits/engines/web-security";
import { pkcePair, signJwt, verifyJwtSignature, verifyWebhook, normalizePem } from "../../toolkits/engines/web-auth";
import { formatGraphql, graphqlOperations, lintSpec, minifyGraphql, operations, parseSpec, sdlToTypeScript, specClient } from "../../toolkits/engines/web-apispec";
import { fluidClamp, htmlToJsx } from "../../toolkits/engines/web-frontend";
import { buildConnectionUrl, parseConnectionUrl, parseFields, sqlToMongo } from "../../toolkits/engines/web-scaffold";
import { bump, compareVersions, formatVersion, parseRange, parseVersion, satisfies, commitMessage } from "../../toolkits/engines/web-git";
import { deepLinkFiles, normalizeFingerprint, parseColor, colorFormats, contrastRatio, pathMatches } from "../../toolkits/engines/mobile-config";
import { checkAndroidToolchain, convertFingerprint, detectVersions, explainBuildLog, parseCertificates } from "../../toolkits/engines/mobile-build";
import { dockerRunToCompose } from "../../toolkits/engines/devops-docker";
import { regexCode } from "../../toolkits/engines/dev-regex";
import { recordShape, toDart, toKotlin, toSwift } from "../../toolkits/engines/data-types";
import { SAMPLE_CERT } from "../../toolkits/sections/mobile";
import { suite, test } from "./run-unit-tests";

const ctx: ToolContext = { now: () => new Date("2026-10-01T10:00:00Z"), storage: { get: <T>(_k: string, d: T) => d, set: async () => undefined } };
const tool = (id: string) => ALL_TOOLS.find(t => t.id === id)!;

function transpiles(source: string, tsx = false): string[] {
  const out = ts.transpileModule(source, { fileName: tsx ? "x.tsx" : "x.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, ...(tsx ? { jsx: ts.JsxEmit.Preserve } : {}) } });
  return (out.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

suite("web: cURL converter", () => {
  test("tokenizes bash, ANSI-C and cmd quoting with continuations", () => {
    assert.deepStrictEqual(tokenizeShell("curl -H 'A: b' \\\n  --data $'x\\ny' \"q\\\"s\""), ["curl", "-H", "A: b", "--data", "x\ny", 'q"s']);
    assert.deepStrictEqual(tokenizeShell('curl "https://x.io" ^\n -H "A: ^"b^""'), ["curl", "https://x.io", "-H", 'A: "b"']);
  });

  test("understands combined flags, -G, --data-urlencode, --json and multipart", () => {
    const r = parseCurl("curl -sSLX PUT https://api.example.com/x --json '{\"a\":1}'");
    assert.strictEqual(r.method, "PUT");
    assert.strictEqual(r.followRedirects, true);
    assert.strictEqual(r.bodyKind, "json");
    assert.ok(r.headers.some(([k, v]) => k === "Content-Type" && v === "application/json"));
    const g = parseCurl("curl -G https://a.io/s --data-urlencode 'q=a b&c' -d n=2");
    assert.strictEqual(g.method, "GET");
    assert.strictEqual(g.url, "https://a.io/s?q=a%20b%26c&n=2");
    const m = parseCurl("curl https://a.io/up -F file=@./a.png -F name=x -H 'Content-Type: multipart/form-data; boundary=zz'");
    assert.strictEqual(m.bodyKind, "multipart");
    assert.deepStrictEqual(m.form, [{ name: "file", value: "./a.png", file: true }, { name: "name", value: "x", file: false }]);
    assert.ok(!m.headers.some(([k]) => k.toLowerCase() === "content-type"), "the copied boundary header is dropped");
    assert.throws(() => parseCurl("wget https://x"), ToolInputError);
  });

  test("generated JavaScript and TypeScript compile for every body kind", () => {
    for (const cmd of ["curl https://a.io", "curl -X POST https://a.io -d 'a=1&b=2'", "curl https://a.io --json '{\"x\":[1,{\"y\":null}]}'", "curl https://a.io -F f=@x.png -u u:p", "curl -X DELETE https://a.io --data-raw 'raw text' -m 5"]) {
      const r = parseCurl(cmd);
      for (const target of ["fetch", "axios", "node-fetch"] as const) assert.deepStrictEqual(transpiles(generateFromCurl(r, target)), [], `${target}: ${cmd}`);
    }
  });

  test("escapes $ for Dart and Kotlin string templates", () => {
    const r = parseCurl("curl https://a.io --data-raw '{\"price\":\"$5\"}' -H 'Content-Type: application/json'");
    assert.ok(generateFromCurl(r, "dart-http").includes("'\\$5'"));
    assert.ok(generateFromCurl(r, "kotlin-okhttp").includes("\\$5"));
  });
});

suite("web: URLs, cookies, caching, CORS, CSP", () => {
  test("URL report decodes params and flags leaked tokens and double encoding", () => {
    const r = parseUrlReport("https://a.io/p?q=caf%C3%A9+latte&access_token=x&u=%252F");
    assert.deepStrictEqual(r.params[0].slice(0, 2), ["q", "café latte"]);
    assert.ok(r.warnings.some(w => w.includes("access_token")));
    assert.ok(r.warnings.some(w => w.includes("encoded twice")));
  });

  test("query strings round-trip through nested JSON", () => {
    const obj = queryToObject("filter[status]=active&filter[age][gte]=18&tags[]=a&tags[]=b");
    assert.deepStrictEqual(obj, { filter: { status: "active", age: { gte: "18" } }, tags: ["a", "b"] });
    assert.strictEqual(objectToQuery({ a: { b: 1 }, t: ["x", "y"] }, "brackets"), "a[b]=1&t[]=x&t[]=y");
    assert.strictEqual(objectToQuery({ t: ["x", "y"] }, "comma"), "t=x,y");
    assert.strictEqual(buildUrl("https://a.io/s?x=1", "q=a b&c\n-x"), "https://a.io/s?q=a%20b%26c");
  });

  test("cookies: browsers' silent rejections are errors", () => {
    const c = parseSetCookie("Set-Cookie: session=1; SameSite=None; Path=/", new Date());
    assert.ok(c.issues.some(i => i.severity === "error" && /SameSite=None without Secure/.test(i.message)));
    assert.ok(c.issues.some(i => i.severity === "error" && /HttpOnly/.test(i.message)));
    const host = parseSetCookie("__Host-x=1; Secure; Path=/app", new Date());
    assert.ok(host.issues.some(i => /__Host-/.test(i.message)));
  });

  test("Cache-Control explanations catch contradictions", () => {
    const r = explainCacheControl("public, private, max-age=60, immutable");
    assert.ok(r.warnings.some(w => /contradict/.test(w)));
    assert.ok(r.warnings.some(w => /immutable/.test(w)));
  });

  test("CORS check mirrors the browser", () => {
    const wildcard = checkCors({ origin: "http://localhost:3000", method: "PUT", requestHeaders: ["Authorization"], credentials: true, responseHeaders: "Access-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: GET", preflightStatus: 204 });
    assert.strictEqual(wildcard.preflightNeeded, true);
    assert.strictEqual(wildcard.passed, false);
    const ok = checkCors({ origin: "https://app.io", method: "GET", requestHeaders: [], credentials: false, responseHeaders: "Access-Control-Allow-Origin: https://app.io" });
    assert.strictEqual(ok.passed, true);
    assert.strictEqual(ok.preflightNeeded, false);
    assert.ok(explainCorsError("Response to preflight request doesn't pass access control check: It does not have HTTP ok status.").length);
  });

  test("CSP analysis flags unsafe-inline scripts and missing directives", () => {
    const r = analyzeCsp("default-src 'self'; script-src 'self' 'unsafe-inline'");
    assert.ok(r.issues.some(i => i.severity === "error" && /unsafe-inline/.test(i.message)));
    assert.ok(r.issues.some(i => /frame-ancestors/.test(i.message)));
  });
});

suite("web: auth", () => {
  test("PKCE matches the RFC 7636 test vector", () => {
    assert.strictEqual(pkcePair("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    assert.throws(() => pkcePair("short"), ToolInputError);
  });

  test("JWT signing round-trips for HMAC, RSA, PSS, ECDSA and EdDSA", () => {
    const payload = { sub: "u1" };
    const hs = signJwt({ alg: "HS256", typ: "JWT" }, payload, "a-very-long-development-secret-123");
    assert.strictEqual(verifyJwtSignature(hs, "a-very-long-development-secret-123").ok, true);
    assert.strictEqual(verifyJwtSignature(hs, "wrong-secret-wrong-secret-wrong!!").ok, false);
    assert.throws(() => signJwt({ alg: "HS256" }, payload, "short"), ToolInputError);
    const pairs: Array<[string, ReturnType<typeof generateKeyPairSync>]> = [
      ["RS256", generateKeyPairSync("rsa", { modulusLength: 2048 })],
      ["PS256", generateKeyPairSync("rsa", { modulusLength: 2048 })],
      ["ES256", generateKeyPairSync("ec", { namedCurve: "prime256v1" })],
      ["EdDSA", generateKeyPairSync("ed25519")]
    ];
    for (const [alg, { privateKey, publicKey }] of pairs) {
      const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
      // Pasting a PEM into a single-line box loses the line breaks; it must still work.
      const token = signJwt({ alg, typ: "JWT" }, payload, priv.replace(/\n/g, " "));
      assert.strictEqual(verifyJwtSignature(token, pub).ok, true, alg);
      assert.strictEqual(verifyJwtSignature(token, JSON.stringify(publicKey.export({ format: "jwk" }))).ok, true, `${alg} via JWK`);
      if (alg === "ES256") assert.strictEqual(Buffer.from(token.split(".")[2], "base64url").length, 64, "ES256 signatures are raw r||s");
    }
    assert.ok(normalizePem("-----BEGIN PUBLIC KEY----- AAAA BBBB -----END PUBLIC KEY-----").includes("\nAAAABBBB\n"));
  });

  test("webhook signatures for GitHub, Stripe and Slack", () => {
    const body = '{"a":1}';
    const gh = `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`;
    assert.strictEqual(verifyWebhook({ provider: "github", payload: body, secret: "s", signature: gh, now: new Date() }).match, true);
    assert.strictEqual(verifyWebhook({ provider: "github", payload: body + " ", secret: "s", signature: gh, now: new Date() }).match, false);
    const t = "1759312800";
    const v1 = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
    const stripe = verifyWebhook({ provider: "stripe", payload: body, secret: "whsec_x", signature: `t=${t},v1=${v1}`, now: new Date(Number(t) * 1000) });
    assert.strictEqual(stripe.match, true);
    assert.deepStrictEqual(stripe.notes, []);
    const slack = `v0=${createHmac("sha256", "k").update(`v0:${t}:${body}`).digest("hex")}`;
    assert.strictEqual(verifyWebhook({ provider: "slack", payload: body, secret: "k", signature: slack, timestamp: t, now: new Date(Number(t) * 1000) }).match, true);
  });

  test("the JWT tool signs and then verifies its own token", async () => {
    const jwt = tool("dev.jwt");
    const signed = await jwt.run({ mode: "sign", alg: "HS256", payload: '{"sub":"1"}', expiresIn: 5, iat: true, secret: "a-very-long-development-secret-123" }, ctx);
    const token = (signed.outputs![0] as { content: string }).content;
    const decoded = await jwt.run({ mode: "decode", token, secret: "a-very-long-development-secret-123" }, ctx);
    assert.strictEqual(decoded.stats!.find(s => s.label === "Signature")!.value, "valid");
  });
});

suite("web: API specs and GraphQL", () => {
  test("OpenAPI: operations, lint and a client that compiles", () => {
    const doc = parseSpec(tool("web.openapi").fields.find(f => f.id === "spec")!.default as string);
    const ops = operations(doc);
    assert.deepStrictEqual(ops.map(o => `${o.method} ${o.path}`), ["GET /orders", "POST /orders", "GET /orders/{orderId}"]);
    assert.deepStrictEqual(lintSpec(doc, ops).filter(i => i.severity === "error"), []);
    assert.deepStrictEqual(transpiles(specClient(doc, ops)), []);
    const broken = parseSpec("openapi: 3.0.0\ninfo: { title: x, version: '1' }\npaths:\n  /a/{id}:\n    get:\n      responses: { '200': { description: ok } }");
    assert.ok(lintSpec(broken, operations(broken)).some(i => /\{id\} is not declared/.test(i.message)));
  });

  test("GraphQL: formatting is stable and minifying keeps tokens apart", () => {
    const q = "query Q($id: ID!, $n: Int = 5) { user(id: $id) { id ...F posts(first: $n, where: {a: 1, b: [1, 2]}) { title } } } fragment F on User { name }";
    const once = formatGraphql(q);
    assert.strictEqual(formatGraphql(once), once, "formatting twice changes nothing");
    assert.strictEqual(minifyGraphql(once), minifyGraphql(q));
    assert.ok(once.includes("posts(first: $n, where: { a: 1, b: [1, 2] }) {"), once);
    const ops = graphqlOperations(q);
    assert.deepStrictEqual(ops.operations[0].variables.map(v => `${v.name}:${v.type}`), ["id:ID!", "n:Int"]);
    assert.deepStrictEqual(ops.fragments, ["F"]);
    assert.throws(() => formatGraphql("{ a { b }"), ToolInputError);
  });

  test("GraphQL SDL becomes TypeScript that compiles", () => {
    const sdl = tool("web.graphql").fields.find(f => f.id === "sdl")!.default as string;
    const out = sdlToTypeScript(sdl);
    assert.ok(out.includes('export type Role = "ADMIN" | "EDITOR" | "VIEWER";'));
    assert.ok(out.includes("export type SearchResult = User | Post;"));
    assert.deepStrictEqual(transpiles(out), []);
  });
});

suite("web: frontend and backend generators", () => {
  test("HTML → JSX converts attributes, styles, void tags and text braces", () => {
    const r = htmlToJsx('<div class="a" style="margin-top: 4px; -webkit-line-clamp: 2" onclick="go()"><label for="x">{x} > y</label><input value="v" tabindex="2"><br><!-- c --><svg stroke-width="2"><path fill-rule="evenodd"/></svg></div>', { wrap: "component", name: "card", typescript: true });
    for (const s of ['className="a"', "style={{ marginTop: \"4px\", WebkitLineClamp: 2 }}", "htmlFor=\"x\"", "defaultValue=\"v\"", "tabIndex={2}", "<br />", "{/* c */}", "strokeWidth=\"2\"", "fillRule=\"evenodd\"", 'onClick={() => { go(); }}', '{"{"}x{"}"} {">"} y']) assert.ok(r.code.includes(s), `missing ${s} in\n${r.code}`);
    assert.deepStrictEqual(transpiles(r.code, true), []);
  });

  test("fluid clamp() hits the requested sizes at both viewports", () => {
    const { slope, intercept } = fluidClamp(16, 24, 400, 1200, 16);
    assert.ok(Math.abs(intercept + slope * 400 - 16) < 1e-9);
    assert.ok(Math.abs(intercept + slope * 1200 - 24) < 1e-9);
  });

  test("every API scaffold variant compiles", async () => {
    const scaffold = tool("web.api-scaffold");
    for (const framework of ["express", "nestjs", "next", "fastify"]) {
      for (const db of ["prisma", "mongoose", "memory"]) {
        const r = await scaffold.run({ resource: "blogPost", framework, db, fields: "title: string!\nbody: text\nviews: int\nstatus: enum(draft|live)!\ntags: string[]\npublishedAt: date" }, ctx);
        const files = (r.outputs![0] as { files: Array<{ path: string; content: string; language?: string }> }).files;
        for (const f of files.filter(x => x.language === "typescript")) {
          const out = ts.transpileModule(f.content, { fileName: "x.ts", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
          assert.deepStrictEqual((out.diagnostics ?? []).map(d => String(d.messageText)), [], `${framework}/${db} ${f.path}`);
        }
      }
    }
    assert.throws(() => parseFields("price number?? weird"), ToolInputError);
  });

  test("connection strings encode special characters and survive a round trip", () => {
    const parsed = parseConnectionUrl("postgresql://app:p@ss/w#rd@db.example.com:5432/orders?sslmode=require");
    assert.strictEqual(parsed.password, "p@ss/w#rd");
    assert.strictEqual(parsed.host, "db.example.com");
    const url = buildConnectionUrl(parsed);
    assert.strictEqual(url, "postgresql://app:p%40ss%2Fw%23rd@db.example.com:5432/orders?sslmode=require");
    assert.deepStrictEqual({ ...parseConnectionUrl(url), options: [] }, { ...parsed, options: [] });
    assert.strictEqual(buildConnectionUrl({ kind: "redis", host: "cache", port: 6379, user: "", password: "", database: "0", ssl: true, options: [] }), "rediss://cache:6379/0");
  });

  test("SQL → MongoDB handles filters, sorting, paging and grouping", () => {
    const find = sqlToMongo("SELECT a, b FROM users WHERE x >= 1 AND y IN ('p','q') AND z IS NOT NULL ORDER BY c DESC LIMIT 10 OFFSET 20");
    assert.ok(find.shell.includes('x: { $gte: 1 }') && find.shell.includes('y: { $in: ["p", "q"] }') && find.shell.includes("z: { $ne: null }"), find.shell);
    assert.ok(find.shell.endsWith(".sort({ c: -1 }).skip(20).limit(10)"), find.shell);
    const agg = sqlToMongo("SELECT country, COUNT(*) AS n FROM users GROUP BY country HAVING COUNT(*) > 3");
    assert.ok(agg.aggregate && agg.shell.includes("$group") && agg.shell.includes("n: { $gt: 3 }"), agg.shell);
    assert.throws(() => sqlToMongo("SELECT * FROM a JOIN b ON a.id = b.a"), /lookup/);
  });
});

suite("web: git and versions", () => {
  test("semver ranges follow npm semantics", () => {
    const allowed = (range: string, v: string) => satisfies(parseVersion(v), parseRange(range));
    assert.ok(allowed("^1.2.3", "1.9.9") && !allowed("^1.2.3", "2.0.0") && !allowed("^1.2.3", "1.3.0-beta.1"));
    assert.ok(allowed("^0.2.3", "0.2.9") && !allowed("^0.2.3", "0.3.0"));
    assert.ok(allowed("~1.2", "1.2.7") && !allowed("~1.2", "1.3.0"));
    assert.ok(allowed("1.2.3 - 2.3", "2.3.9") && !allowed("1.2.3 - 2.3", "2.4.0"));
    assert.ok(allowed("^1.2.3-beta.2", "1.2.3-beta.4") && !allowed("^1.2.3-beta.2", "1.2.4-beta.1"));
    assert.ok(allowed(">=1.0.0 <2 || 3.x", "3.4.0"));
    const sorted = ["1.0.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-rc.1", "0.9.9"].map(parseVersion).sort(compareVersions).map(formatVersion);
    assert.deepStrictEqual(sorted, ["0.9.9", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-rc.1", "1.0.0"]);
    assert.strictEqual(formatVersion(bump(parseVersion("1.2.3-rc.1"), "prerelease", "rc")), "1.2.3-rc.2");
    assert.strictEqual(formatVersion(bump(parseVersion("2.0.0-rc.1"), "major", "rc")), "2.0.0");
  });

  test("commit messages follow Conventional Commits", () => {
    const r = commitMessage({ type: "feat", scope: "Auth", subject: "add reset", body: "", breaking: "tokens expire", issues: "12" });
    assert.strictEqual(r.message, "feat(auth)!: add reset\n\nBREAKING CHANGE: tokens expire\nCloses #12");
    assert.strictEqual(r.branch, "feature/12-add-reset");
  });
});

suite("mobile tools", () => {
  test("deep link files are valid and path matching works", () => {
    const r = deepLinkFiles({ domain: "https://example.com/", scheme: "ex", androidPackage: "com.ex.app", fingerprints: ["146de983c5730650d8eeb9952f34fc6416a08342e61dbea88a0496b23fcf44e5"], teamId: "ABCDE12345", bundleId: "com.ex.app", paths: ["/p/*", "/invite/:code", "!/p/secret"], framework: "flutter" });
    const aasa = JSON.parse(r.files.find(f => f.path.endsWith("apple-app-site-association"))!.content);
    assert.deepStrictEqual(aasa.applinks.details[0].components, [{ "/": "/p/*" }, { "/": "/invite/*" }, { "/": "/p/secret", exclude: true }]);
    const links = JSON.parse(r.files.find(f => f.path.endsWith("assetlinks.json"))!.content);
    assert.strictEqual(links[0].target.sha256_cert_fingerprints[0].split(":").length, 32);
    assert.ok(pathMatches("/invite/:code", "/invite/abc") && pathMatches("/p/*", "/p") && !pathMatches("/p/*", "/q/1"));
    assert.strictEqual(normalizeFingerprint("sha1-is-too-short"), undefined);
  });

  test("colours: 8-digit hex follows the chosen convention", () => {
    const css = parseColor("#11223380", "css");
    const argb = parseColor("#80112233", "argb");
    assert.deepStrictEqual([css.r, css.g, css.b, Math.round(css.a * 255)], [17, 34, 51, 128]);
    assert.deepStrictEqual([argb.r, argb.g, argb.b, Math.round(argb.a * 255)], [17, 34, 51, 128]);
    const flutter = parseColor("Color(0xFF1E88E5)", "css");
    assert.ok(colorFormats(flutter).some(([k, v]) => k === "Jetpack Compose" && v === "Color(0xFF1E88E5)"));
    assert.strictEqual(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }).toFixed(1), "21.0");
  });

  test("fingerprints convert between hex and Base64 (Facebook key hash)", () => {
    const r = convertFingerprint("5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25");
    assert.strictEqual(r.algorithm, "SHA-1");
    assert.strictEqual(r.base64, Buffer.from("5E8F16062EA3CD2C4A0D547876BAA6F38CABF625", "hex").toString("base64"));
    assert.strictEqual(convertFingerprint(r.base64).colonHex, "5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25");
  });

  test("certificates: fingerprints and the SPKI pin match openssl", () => {
    const [cert] = parseCertificates(SAMPLE_CERT, new Date("2026-10-01T12:00:00Z"));
    assert.strictEqual(cert.spkiPin, "PpLA3IfMfpb9sKnohQQ7mFONSq1G8xtWYzIiBS9oZPs=");
    assert.ok(cert.sans.includes("DNS:*.example.com"));
    assert.strictEqual(cert.selfSigned, true);
  });

  test("build errors are recognised with their line numbers", () => {
    const found = explainBuildLog("line one\n> Unsupported class file major version 65\nerror Unable to resolve module react-native-svg from App.tsx\nERESOLVE unable to resolve dependency tree");
    assert.deepStrictEqual(found.map(f => [f.error.id, f.lineNo]), [["class-version", 2], ["metro-resolve", 3], ["eresolve", 4]]);
  });

  test("toolchain check reads Gradle files and catches mismatches", () => {
    const v = detectVersions('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip\nid "com.android.application" version "8.7.3" apply false\nid("org.jetbrains.kotlin.android") version "2.0.21"\ncompileSdk = 35\nminSdk = 24\ntargetSdk = 34');
    assert.deepStrictEqual(v, { gradle: "8.4", agp: "8.7.3", kotlin: "2.0.21", compileSdk: 35, targetSdk: 34, minSdk: 24 });
    const checks = checkAndroidToolchain({ ...v, runtimeJdk: 21 });
    assert.ok(checks.some(c => c.severity === "error" && /Gradle 8.4 is too old/.test(c.text)));
    assert.ok(checks.some(c => c.severity === "error" && /JDK 21/.test(c.text)));
    assert.ok(checks.some(c => c.severity === "error" && /targetSdk 34/.test(c.text)));
  });

  test("mobile CI workflows are valid YAML for every stack", async () => {
    const ci = tool("mobile.ci");
    for (const stack of ["flutter", "react-native", "expo", "android", "ios"]) {
      const r = await ci.run({ stack, branch: "main", tests: true, release: true, deploy: true, node: "22", java: "17", flutter: "3.35.x", scheme: "App", packageManager: "pnpm" }, ctx);
      const wf = (r.outputs![0] as { files: Array<{ path: string; content: string }> }).files[0];
      const doc = YAML.parse(wf.content);
      assert.ok(doc.jobs && Object.keys(doc.jobs).length >= 2, stack);
    }
  });

  test("JSON → Dart, Kotlin and Swift models", () => {
    const shape = recordShape([{ id: 1, created_at: "2026-01-01T00:00:00Z", tags: ["a"], owner: { name: "x" } }, { id: 2, created_at: "2026-01-01T00:00:00Z", tags: [], owner: { name: "y" }, note: "n" }]);
    const dart = toDart(shape, "Item", "manual");
    assert.ok(dart.includes("createdAt: DateTime.parse(json['created_at'] as String),") && dart.includes("final String? note;") && dart.includes("owner.toJson()"), dart);
    const kotlin = toKotlin(shape, "Item", "kotlinx", "");
    assert.ok(kotlin.includes('@SerialName("created_at") val createdAt: String') && kotlin.includes("val note: String? = null"), kotlin);
    const swift = toSwift(shape, "Item", false);
    assert.ok(swift.includes("let createdAt: Date") && swift.includes('case createdAt = "created_at"') && swift.includes("let note: String?"), swift);
  });
});

suite("dev and devops additions", () => {
  test("docker run → compose", () => {
    const r = dockerRunToCompose("docker run -d --name api -p 8080:80 -e A=1 -v data:/d --restart always nginx:1.27 nginx -g 'daemon off;'");
    const doc = YAML.parse(r.yaml);
    assert.deepStrictEqual(doc.services.api.ports, ["8080:80"]);
    assert.deepStrictEqual(doc.services.api.command, ["nginx", "-g", "daemon off;"]);
    assert.ok("data" in doc.volumes);
    assert.ok(r.yaml.includes('"8080:80"'), "ports are quoted");
  });

  test("regex code warns where a language cannot run the pattern", () => {
    assert.ok(regexCode("^(?=.*\\d).{8,}$", "", "go").note);
    assert.strictEqual(regexCode("^\\d+$", "", "go").note, undefined);
    assert.ok(regexCode("^(?<y>\\d{4})$", "", "python").code.includes("(?P<y>"));
    assert.ok(regexCode("a$b", "i", "kotlin").code.includes("${'$'}b"));
  });

  test("timestamps detect seconds, milliseconds and offsets", async () => {
    const t = tool("dev.timestamp");
    const s = await t.run({ input: "1767225600", zones: "UTC" }, ctx);
    assert.strictEqual(s.stats![0].value, "Unix seconds");
    const ms = await t.run({ input: "1767225600000", offset: "+1d", zones: "UTC" }, ctx);
    const rows = (ms.outputs![0] as { rows: string[][] }).rows;
    assert.strictEqual(rows.find(r => r[0] === "ISO 8601 (UTC)")![1], "2026-01-02T00:00:00.000Z");
  });

  test("hashes match known digests", async () => {
    const r = await tool("dev.hash").run({ mode: "hash", input: "abc", encoding: "utf8" }, ctx);
    const rows = (r.outputs![0] as { rows: string[][] }).rows;
    assert.strictEqual(rows.find(x => x[0] === "SHA256")![1], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.strictEqual(rows.find(x => x[0] === "MD5")![1], "900150983cd24fb0d6963f7d28e17f72");
  });
});

suite("merged tools", () => {
  test("the formatter handles JSON, YAML and XML", async () => {
    const fmt = tool("text.format");
    const bad = await fmt.run({ input: '{\n  "a": 1,\n  "b": [1,],\n}', format: "auto", action: "validate" }, ctx);
    assert.ok(bad.messages!.some(m => m.kind === "error" && /^Line 3:/.test(m.text)), JSON.stringify(bad.messages));
    const min = await fmt.run({ input: '{ "b": 2, "a": { "d": 1, "c": 2 } }', action: "minify", sort: true }, ctx);
    assert.strictEqual((min.outputs![0] as { content: string }).content, '{"a":{"c":2,"d":1},"b":2}');
    const yaml = await fmt.run({ input: "ports:\n  - 22:22\ndebug: no\n", action: "to-json" }, ctx);
    assert.ok(yaml.messages!.some(m => /base-60/.test(m.text)) && yaml.messages!.some(m => /boolean/.test(m.text)));
    const xml = await fmt.run({ input: '<?xml version="1.0"?><a x="1"><b>hi</b><c/><!-- n --></a>', action: "format", indent: "2" }, ctx);
    assert.strictEqual((xml.outputs![0] as { content: string }).content, '<?xml version="1.0"?>\n<a x="1">\n  <b>hi</b>\n  <c />\n  <!-- n -->\n</a>\n');
    const broken = await fmt.run({ input: "<a><b></a>", action: "format" }, ctx);
    assert.ok(broken.messages!.some(m => m.kind === "error" && /closes <b>/.test(m.text)));
    assert.deepStrictEqual(broken.outputs, []);
  });

  test("combined tools keep each mode's fields, presets and aliases working", async () => {
    const t = tool("ai.token-cost");
    assert.strictEqual(t.fields[0].id, "mode");
    // Both original tools had a "provider" field: the clash is resolved by prefixing.
    const providers = t.fields.filter(f => /provider$/.test(f.id)).map(f => f.id);
    assert.deepStrictEqual(providers, ["cost_provider", "compare_provider"]);
    assert.ok(t.aliases!.some(a => a.command === "modelComparison" && a.values.mode === "compare"));
    const compare = await t.run({ mode: "compare", compare_provider: "all", sort: "price" }, ctx);
    assert.ok(compare.outputs!.length > 0);
    const schemas = tool("data.schema");
    assert.ok(schemas.aliases!.some(a => a.command === "schemaDiff"));
    assert.ok(tool("ai.json-output").aliases!.some(a => a.command === "llmResponseFormatter"));
    assert.ok(tool("mobile.colors").aliases!.some(a => a.command === "colorPalette"));
    assert.ok(tool("text.format").aliases!.some(a => a.command === "yamlJsonTool"));
  });
});
