import * as assert from "assert";
import { suite, test } from "./run-unit-tests";
import {
  HttpObservation,
  ProbeEvidence,
  analyzeApiSecurity,
  analyzeAuth,
  analyzeCookies,
  analyzeCors,
  analyzeCsp,
  analyzeDisclosure,
  analyzeEndpoint,
  analyzeHsts,
  analyzeInjection,
  analyzeRateLimit,
  analyzeSecurityHeaders,
  analyzeTransport,
  decodeJwt,
  normalizeHeaders,
  parseCsp,
  parseHsts,
  parseSetCookie,
  setCookieList,
  summarize
} from "../../services/security-analysis";
import {
  analyzeWorkspacePosture,
  isCommentLine,
  looksLikeSecretValue,
  redactLine,
  scanCloudText,
  scanSourceText,
  shannonEntropy
} from "../../services/security-static";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function observation(partial: Partial<HttpObservation> = {}): HttpObservation {
  return {
    url: "https://example.test/api",
    method: "GET",
    status: 200,
    headers: {},
    setCookies: [],
    bodySample: "",
    bodyBytes: 0,
    elapsedMs: 12,
    ...partial
  };
}

function evidence(partial: Partial<ProbeEvidence> = {}): ProbeEvidence {
  return {
    url: "https://example.test/api",
    primary: observation(),
    probeOrigin: "https://devsnip-cors-probe.example",
    sentCredentials: false,
    ...partial
  };
}

function find<T extends { id: string }>(checks: T[], id: string): T | undefined {
  return checks.find(check => check.id === id);
}

/* ------------------------------------------------------------------ *
 * Parsers
 * ------------------------------------------------------------------ */

suite("security header parsing", () => {
  test("normalizes header names and flattens array values", () => {
    const headers = normalizeHeaders({ "Content-Type": "text/html", "X-Multi": ["a", "b"], Empty: undefined });
    assert.strictEqual(headers["content-type"], "text/html");
    assert.strictEqual(headers["x-multi"], "a, b");
    assert.ok(!("empty" in headers));
  });

  test("keeps set-cookie as a list", () => {
    assert.deepStrictEqual(setCookieList({ "Set-Cookie": ["a=1", "b=2"] }), ["a=1", "b=2"]);
    assert.deepStrictEqual(setCookieList({ "set-cookie": "a=1" }), ["a=1"]);
    assert.deepStrictEqual(setCookieList({ other: "x" }), []);
  });

  test("parses an HSTS policy including a quoted max-age", () => {
    const policy = parseHsts('max-age="31536000"; includeSubDomains; preload');
    assert.strictEqual(policy.maxAge, 31536000);
    assert.ok(policy.includeSubDomains);
    assert.ok(policy.preload);
  });

  test("reports an HSTS header with no max-age as present but incomplete", () => {
    const policy = parseHsts("includeSubDomains");
    assert.ok(policy.present);
    assert.strictEqual(policy.maxAge, undefined);
  });

  test("parses CSP directives and ignores a repeated directive", () => {
    const directives = parseCsp("default-src 'self'; script-src 'nonce-abc'; script-src *");
    assert.deepStrictEqual(directives["default-src"], ["'self'"]);
    assert.deepStrictEqual(directives["script-src"], ["'nonce-abc'"]);
  });

  test("parses a Set-Cookie and never keeps the value", () => {
    const cookie = parseSetCookie("sid=super-secret-value; Path=/; Secure; HttpOnly; SameSite=Lax");
    assert.ok(cookie);
    assert.strictEqual(cookie!.name, "sid");
    assert.ok(cookie!.secure && cookie!.httpOnly);
    assert.strictEqual(cookie!.sameSite, "lax");
    assert.ok(!cookie!.raw.includes("super-secret-value"), "the cookie value must not be retained");
  });

  test("decodes a JWT header without verifying it", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "1", exp: 4102444800 })).toString("base64url");
    const decoded = decodeJwt(`${header}.${payload}.`);
    assert.ok(decoded);
    assert.strictEqual(decoded!.alg, "none");
    assert.strictEqual(decoded!.exp, 4102444800);
    assert.ok(decoded!.claims.includes("sub"));
  });
});

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

suite("transport checks", () => {
  test("plain HTTP on a public host is critical", () => {
    const checks = analyzeTransport(evidence({ url: "http://public.test/api", primary: observation({ url: "http://public.test/api" }) }));
    const scheme = find(checks, "transport.scheme")!;
    assert.strictEqual(scheme.status, "fail");
    assert.strictEqual(scheme.severity, "critical");
    assert.ok(scheme.remediation);
  });

  test("plain HTTP on localhost is informational, not a failure", () => {
    const checks = analyzeTransport(evidence({ url: "http://localhost:3000/api", primary: observation({ url: "http://localhost:3000/api" }) }));
    assert.strictEqual(find(checks, "transport.scheme")!.status, "info");
  });

  test("a refused plain-HTTP port passes the downgrade check", () => {
    const checks = analyzeTransport(evidence({
      plainHttp: observation({ url: "http://example.test/api", status: 0, error: "connect ECONNREFUSED", errorCode: "ECONNREFUSED" })
    }));
    assert.strictEqual(find(checks, "transport.redirect")!.status, "pass");
  });

  test("HTTP served without a redirect is a high finding", () => {
    const checks = analyzeTransport(evidence({ plainHttp: observation({ url: "http://example.test/api", status: 200 }) }));
    const redirect = find(checks, "transport.redirect")!;
    assert.strictEqual(redirect.status, "fail");
    assert.strictEqual(redirect.severity, "high");
  });

  test("an expired certificate is critical and a near-expiry one is a warning", () => {
    const expired = analyzeTransport(evidence({ tls: { authorized: true, daysUntilExpiry: -3, validTo: "Jan 1 00:00:00 2020 GMT" } }));
    assert.strictEqual(find(expired, "transport.cert.expiry")!.severity, "critical");

    const soon = analyzeTransport(evidence({ tls: { authorized: true, daysUntilExpiry: 20 } }));
    const check = find(soon, "transport.cert.expiry")!;
    assert.strictEqual(check.status, "warn");
    assert.strictEqual(check.severity, "medium");
  });

  test("a hostname mismatch is reported distinctly from an untrusted chain", () => {
    const checks = analyzeTransport(evidence({
      tls: { authorized: false, authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID" }
    }));
    assert.ok(/hostname/i.test(find(checks, "transport.cert.trust")!.title));
  });

  test("a deprecated TLS version fails", () => {
    const checks = analyzeTransport(evidence({ tls: { authorized: true, protocol: "TLSv1.1" } }));
    assert.strictEqual(find(checks, "transport.protocol")!.status, "fail");
    const modern = analyzeTransport(evidence({ tls: { authorized: true, protocol: "TLSv1.3" } }));
    assert.strictEqual(find(modern, "transport.protocol")!.status, "pass");
  });
});

/* ------------------------------------------------------------------ *
 * HSTS
 * ------------------------------------------------------------------ */

suite("HSTS checks", () => {
  test("is skipped, not failed, on a plain-HTTP endpoint", () => {
    const checks = analyzeHsts(evidence({ url: "http://example.test/", primary: observation({ url: "http://example.test/" }) }));
    assert.strictEqual(checks[0].status, "skipped");
    assert.strictEqual(checks[0].severity, "none");
  });

  test("a missing header on HTTPS is a high failure", () => {
    const checks = analyzeHsts(evidence());
    assert.strictEqual(checks[0].status, "fail");
    assert.strictEqual(checks[0].severity, "high");
  });

  test("max-age=0 is reported as a disabled policy", () => {
    const checks = analyzeHsts(evidence({ primary: observation({ headers: { "strict-transport-security": "max-age=0" } }) }));
    assert.strictEqual(find(checks, "hsts.maxage")!.status, "fail");
  });

  test("a short max-age warns and a one-year policy passes", () => {
    const short = analyzeHsts(evidence({ primary: observation({ headers: { "strict-transport-security": "max-age=600" } }) }));
    assert.strictEqual(find(short, "hsts.maxage")!.status, "warn");

    const full = analyzeHsts(evidence({
      primary: observation({ headers: { "strict-transport-security": "max-age=31536000; includeSubDomains; preload" } })
    }));
    assert.strictEqual(find(full, "hsts.maxage")!.status, "pass");
    assert.strictEqual(find(full, "hsts.subdomains")!.status, "pass");
    assert.strictEqual(find(full, "hsts.preload")!.status, "pass");
  });

  test("preload without the required directives is flagged as ineligible", () => {
    const checks = analyzeHsts(evidence({
      primary: observation({ headers: { "strict-transport-security": "max-age=86400; preload" } })
    }));
    assert.strictEqual(find(checks, "hsts.preload")!.status, "warn");
  });
});

/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */

suite("security header checks", () => {
  const html = { "content-type": "text/html; charset=utf-8" };

  test("missing nosniff fails and a valid one passes", () => {
    assert.strictEqual(find(analyzeSecurityHeaders(evidence()), "headers.nosniff")!.status, "fail");
    const ok = analyzeSecurityHeaders(evidence({ primary: observation({ headers: { "x-content-type-options": "nosniff" } }) }));
    assert.strictEqual(find(ok, "headers.nosniff")!.status, "pass");
  });

  test("an invalid nosniff value is not treated as protection", () => {
    const checks = analyzeSecurityHeaders(evidence({ primary: observation({ headers: { "x-content-type-options": "NOSNIFFF" } }) }));
    assert.strictEqual(find(checks, "headers.nosniff")!.status, "fail");
  });

  test("CSP frame-ancestors satisfies the clickjacking check", () => {
    const checks = analyzeSecurityHeaders(evidence({
      primary: observation({ headers: { ...html, "content-security-policy": "default-src 'self'; frame-ancestors 'none'" } })
    }));
    assert.strictEqual(find(checks, "headers.clickjacking")!.status, "pass");
  });

  test("frame-ancestors * does not count as protection", () => {
    const checks = analyzeSecurityHeaders(evidence({
      primary: observation({ headers: { ...html, "content-security-policy": "frame-ancestors *" } })
    }));
    assert.strictEqual(find(checks, "headers.clickjacking")!.status, "fail");
  });

  test("a JSON response is graded more gently than an HTML one for framing", () => {
    const json = analyzeSecurityHeaders(evidence({ primary: observation({ headers: { "content-type": "application/json" } }) }));
    assert.strictEqual(find(json, "headers.clickjacking")!.severity, "low");
    const page = analyzeSecurityHeaders(evidence({ primary: observation({ headers: html }) }));
    assert.strictEqual(find(page, "headers.clickjacking")!.severity, "medium");
  });

  test("only a versioned banner is reported", () => {
    const bare = analyzeSecurityHeaders(evidence({ primary: observation({ headers: { server: "nginx" } }) }));
    assert.strictEqual(find(bare, "headers.banner")!.status, "info");
    const versioned = analyzeSecurityHeaders(evidence({ primary: observation({ headers: { server: "nginx/1.18.0" } }) }));
    assert.strictEqual(find(versioned, "headers.banner")!.status, "warn");
    const none = analyzeSecurityHeaders(evidence());
    assert.strictEqual(find(none, "headers.banner")!.status, "pass");
  });
});

/* ------------------------------------------------------------------ *
 * CSP
 * ------------------------------------------------------------------ */

suite("CSP checks", () => {
  const htmlHeaders = (csp?: string) => ({
    "content-type": "text/html",
    ...(csp ? { "content-security-policy": csp } : {})
  });

  test("a missing CSP on an HTML page is a high failure", () => {
    const checks = analyzeCsp(evidence({ primary: observation({ headers: htmlHeaders() }) }));
    assert.strictEqual(checks[0].status, "fail");
    assert.strictEqual(checks[0].severity, "high");
  });

  test("report-only is reported as not enforcing", () => {
    const checks = analyzeCsp(evidence({
      primary: observation({ headers: { "content-type": "text/html", "content-security-policy-report-only": "default-src 'self'" } })
    }));
    assert.strictEqual(find(checks, "csp.present")!.status, "warn");
  });

  test("'unsafe-inline' fails, but not when a nonce neutralises it", () => {
    const unsafe = analyzeCsp(evidence({ primary: observation({ headers: htmlHeaders("script-src 'self' 'unsafe-inline'") }) }));
    assert.strictEqual(find(unsafe, "csp.unsafe-inline")!.status, "fail");

    const nonce = analyzeCsp(evidence({ primary: observation({ headers: htmlHeaders("script-src 'self' 'unsafe-inline' 'nonce-abc123'") }) }));
    assert.strictEqual(find(nonce, "csp.unsafe-inline")!.status, "pass");
  });

  test("a wildcard script source fails and base-uri is checked separately", () => {
    const checks = analyzeCsp(evidence({ primary: observation({ headers: htmlHeaders("default-src 'self'; script-src *") }) }));
    assert.strictEqual(find(checks, "csp.wildcard-script")!.status, "fail");
    assert.strictEqual(find(checks, "csp.base-uri")!.status, "warn");
  });

  test("script-src falls back to default-src", () => {
    const checks = analyzeCsp(evidence({ primary: observation({ headers: htmlHeaders("default-src 'self' 'unsafe-inline'") }) }));
    assert.strictEqual(find(checks, "csp.unsafe-inline")!.status, "fail");
  });

  test("a strict policy passes the inline and object checks", () => {
    const checks = analyzeCsp(evidence({
      primary: observation({ headers: htmlHeaders("default-src 'self'; script-src 'nonce-x' 'strict-dynamic'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'") })
    }));
    assert.strictEqual(find(checks, "csp.unsafe-inline")!.status, "pass");
    assert.strictEqual(find(checks, "csp.object-src")!.status, "pass");
    assert.strictEqual(find(checks, "csp.base-uri")!.status, "pass");
  });
});

/* ------------------------------------------------------------------ *
 * CORS
 * ------------------------------------------------------------------ */

suite("CORS checks", () => {
  const origin = "https://devsnip-cors-probe.example";

  test("no CORS headers is a pass, not a gap", () => {
    const checks = analyzeCors(evidence({ corsSimple: observation() }));
    assert.strictEqual(find(checks, "cors.origin")!.status, "pass");
  });

  test("reflecting an arbitrary origin with credentials is critical", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({
        headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" }
      })
    }));
    const check = find(checks, "cors.origin")!;
    assert.strictEqual(check.status, "fail");
    assert.strictEqual(check.severity, "critical");
  });

  test("reflection without credentials is a medium warning", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({ headers: { "access-control-allow-origin": origin, vary: "Origin" } })
    }));
    const check = find(checks, "cors.origin")!;
    assert.strictEqual(check.status, "warn");
    assert.strictEqual(check.severity, "medium");
  });

  test("wildcard with credentials is reported as the invalid combination it is", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({ headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" } })
    }));
    assert.strictEqual(find(checks, "cors.origin")!.severity, "high");
  });

  test("the null origin is a high failure", () => {
    const checks = analyzeCors(evidence({ corsSimple: observation({ headers: { "access-control-allow-origin": "null" } }) }));
    assert.strictEqual(find(checks, "cors.origin")!.severity, "high");
  });

  test("a reflected origin without Vary is flagged for cache poisoning", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({ headers: { "access-control-allow-origin": origin } })
    }));
    assert.strictEqual(find(checks, "cors.vary")!.status, "warn");
  });

  test("a fixed allow-list origin passes", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({ headers: { "access-control-allow-origin": "https://app.example.test", vary: "Origin" } })
    }));
    assert.strictEqual(find(checks, "cors.origin")!.status, "pass");
    assert.strictEqual(find(checks, "cors.vary")!.status, "pass");
  });

  test("a wildcard origin without credentials does not fail the method check", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({ headers: { "access-control-allow-origin": "*" } }),
      corsPreflight: observation({
        method: "OPTIONS", status: 204,
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE" }
      })
    }));
    const methods = find(checks, "cors.methods")!;
    assert.strictEqual(methods.status, "info");
    assert.strictEqual(methods.severity, "none");
  });

  test("a reflected origin with write methods is a real failure", () => {
    const checks = analyzeCors(evidence({
      corsSimple: observation({ headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } }),
      corsPreflight: observation({
        method: "OPTIONS", status: 204,
        headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,DELETE" }
      })
    }));
    const methods = find(checks, "cors.methods")!;
    assert.strictEqual(methods.status, "fail");
    assert.strictEqual(methods.severity, "high");
  });

  test("the probes are skipped rather than guessed when they did not run", () => {
    const checks = analyzeCors(evidence());
    assert.strictEqual(checks[0].status, "skipped");
  });
});

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

suite("cookie checks", () => {
  test("no cookies is informational", () => {
    assert.strictEqual(analyzeCookies(evidence())[0].status, "info");
  });

  test("a session cookie without Secure or HttpOnly is high severity", () => {
    const checks = analyzeCookies(evidence({ primary: observation({ setCookies: ["sessionid=abc123def456; Path=/"] }) }));
    const secure = checks.find(check => check.id.endsWith(".secure"))!;
    const httpOnly = checks.find(check => check.id.endsWith(".httponly"))!;
    assert.strictEqual(secure.status, "fail");
    assert.strictEqual(secure.severity, "high");
    assert.strictEqual(httpOnly.severity, "high");
  });

  test("a fully-flagged cookie passes every flag check", () => {
    const checks = analyzeCookies(evidence({
      primary: observation({ setCookies: ["sid=abc123def456; Path=/; Secure; HttpOnly; SameSite=Lax"] })
    }));
    assert.ok(checks.filter(check => check.status === "pass").length >= 3);
    assert.strictEqual(checks.filter(check => check.status === "fail").length, 0);
  });

  test("SameSite=None without Secure is reported as a dropped cookie", () => {
    const checks = analyzeCookies(evidence({
      primary: observation({ setCookies: ["tracker=abcdef123456; SameSite=None"] })
    }));
    const sameSite = checks.find(check => check.id.endsWith(".samesite"))!;
    assert.strictEqual(sameSite.status, "fail");
    assert.strictEqual(sameSite.severity, "high");
  });

  test("__Host- prefix violations are detected", () => {
    const checks = analyzeCookies(evidence({
      primary: observation({ setCookies: ["__Host-sid=abc123def456; Path=/app; Domain=example.test; Secure; HttpOnly"] })
    }));
    const prefix = checks.find(check => check.id.endsWith(".prefix"))!;
    assert.strictEqual(prefix.status, "fail");
  });

  test("a cookie being cleared is not graded on its flags", () => {
    const checks = analyzeCookies(evidence({
      primary: observation({ setCookies: ["sid=; Max-Age=0; Path=/"] })
    }));
    assert.strictEqual(checks.length, 1);
    assert.strictEqual(checks[0].status, "info");
  });

  test("a non-session cookie without HttpOnly is only a low warning", () => {
    const checks = analyzeCookies(evidence({
      primary: observation({ setCookies: ["theme=dark-mode-v2; Path=/; Secure; SameSite=Lax"] })
    }));
    const httpOnly = checks.find(check => check.id.endsWith(".httponly"))!;
    assert.strictEqual(httpOnly.severity, "low");
  });
});

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

suite("authentication and authorization checks", () => {
  test("a token in the query string is a high finding", () => {
    const checks = analyzeAuth(evidence({ url: "https://example.test/api?access_token=abcdef123456" }));
    const check = find(checks, "auth.credentials-in-url")!;
    assert.strictEqual(check.status, "fail");
    assert.strictEqual(check.severity, "high");
  });

  test("Basic auth over plain HTTP is critical", () => {
    const checks = analyzeAuth(evidence({
      url: "http://example.test/api",
      primary: observation({ url: "http://example.test/api", status: 401, headers: { "www-authenticate": 'Basic realm="api"' } })
    }));
    assert.strictEqual(find(checks, "auth.basic-over-http")!.severity, "critical");
  });

  test("authorization enforcement is skipped when no credential was sent", () => {
    assert.strictEqual(find(analyzeAuth(evidence()), "auth.enforcement")!.status, "skipped");
  });

  test("an identical response without the credential is critical", () => {
    const checks = analyzeAuth(evidence({
      sentCredentials: true,
      primary: observation({ status: 200, bodyBytes: 4096 }),
      unauthenticated: observation({ status: 200, bodyBytes: 4096 })
    }));
    const check = find(checks, "auth.enforcement")!;
    assert.strictEqual(check.status, "fail");
    assert.strictEqual(check.severity, "critical");
  });

  test("a 401 without the credential passes", () => {
    const checks = analyzeAuth(evidence({
      sentCredentials: true,
      primary: observation({ status: 200, bodyBytes: 4096 }),
      unauthenticated: observation({ status: 401, bodyBytes: 30 })
    }));
    assert.strictEqual(find(checks, "auth.enforcement")!.status, "pass");
  });

  test("a JWT with alg none in the response is critical", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "1", exp: 4102444800 })).toString("base64url");
    const checks = analyzeAuth(evidence({
      primary: observation({ bodySample: `{"token":"${header}.${payload}.signature"}`, bodyBytes: 200 })
    }));
    assert.ok(checks.some(check => check.id.startsWith("auth.jwt.alg") && check.severity === "critical"));
  });

  test("an authenticated response without no-store warns about caching", () => {
    const checks = analyzeAuth(evidence({ sentCredentials: true, unauthenticated: observation({ status: 401 }) }));
    assert.strictEqual(find(checks, "auth.cache")!.status, "warn");
  });
});

/* ------------------------------------------------------------------ *
 * API, disclosure, rate limiting, injection
 * ------------------------------------------------------------------ */

suite("API and disclosure checks", () => {
  test("JSON served as text/html is reported", () => {
    const checks = analyzeApiSecurity(evidence({
      primary: observation({ headers: { "content-type": "text/html" }, bodySample: '{"ok":true}', bodyBytes: 11 })
    }));
    assert.strictEqual(find(checks, "api.content-type")!.status, "fail");
  });

  test("an enabled TRACE method is reported and a rejected one passes", () => {
    const on = analyzeApiSecurity(evidence({
      trace: observation({ method: "TRACE", status: 200, headers: { "content-type": "message/http" }, bodySample: "TRACE /api HTTP/1.1" })
    }));
    assert.strictEqual(find(on, "api.trace")!.status, "fail");
    const off = analyzeApiSecurity(evidence({ trace: observation({ method: "TRACE", status: 405 }) }));
    assert.strictEqual(find(off, "api.trace")!.status, "pass");
  });

  test("active mixed content on an HTTPS page is high", () => {
    const checks = analyzeApiSecurity(evidence({
      primary: observation({
        headers: { "content-type": "text/html" },
        bodySample: '<html><body><script src="http://cdn.example.test/a.js"></script></body></html>',
        bodyBytes: 80
      })
    }));
    assert.strictEqual(find(checks, "api.mixed-content")!.severity, "high");
  });

  test("an AWS key in the body is a critical disclosure", () => {
    const checks = analyzeDisclosure(evidence({
      primary: observation({ bodySample: '{"key":"AKIA4KPQ7RZT2XW9BVLM"}', bodyBytes: 30 })
    }));
    const leak = checks.find(check => check.id.startsWith("disclosure.secret."))!;
    assert.strictEqual(leak.severity, "critical");
    assert.ok(!leak.evidence!.includes("AKIA4KPQ7RZT2XW9BVLM"), "the credential must be masked in the evidence");
  });

  test("a clean body passes the credential check", () => {
    const checks = analyzeDisclosure(evidence({ primary: observation({ bodySample: '{"ok":true}', bodyBytes: 11 }) }));
    assert.strictEqual(find(checks, "disclosure.secret")!.status, "pass");
  });

  test("a stack trace and a SQL error are both reported", () => {
    const checks = analyzeDisclosure(evidence({
      primary: observation({
        bodySample: "Traceback (most recent call last):\n  File x\nYou have an error in your SQL syntax near 'x'",
        bodyBytes: 120
      })
    }));
    assert.ok(find(checks, "disclosure.stacktrace"));
    assert.strictEqual(find(checks, "disclosure.sqlerror")!.severity, "high");
  });

  test("SVG path data is not mistaken for an internal IP address", () => {
    const checks = analyzeDisclosure(evidence({
      primary: observation({
        headers: { "content-type": "text/html" },
        bodySample: '<svg><path d="M255-10.646C23.5 6.188 7.435 10.669.606.225 1.19-.18"/></svg>',
        bodyBytes: 80
      })
    }));
    assert.strictEqual(find(checks, "disclosure.internal-host"), undefined);
  });

  test("a real private address is reported", () => {
    const checks = analyzeDisclosure(evidence({
      primary: observation({ bodySample: '{"upstream":"10.0.12.34:8080"}', bodyBytes: 30 })
    }));
    assert.strictEqual(find(checks, "disclosure.internal-host")!.status, "warn");
  });

  test("an unconfirmed well-known path is not reported as exposed", () => {
    const checks = analyzeDisclosure(evidence({
      primary: observation({ bodySample: "{}", bodyBytes: 2 }),
      exposedPaths: [{
        path: "/.env", url: "https://example.test/.env", confirmed: false, signature: "environment-file syntax",
        observation: observation({ status: 200, bodySample: "<html>app shell</html>", bodyBytes: 22 })
      }]
    }));
    assert.strictEqual(find(checks, "disclosure.wellknown")!.status, "pass");
  });

  test("a confirmed .env is critical", () => {
    const checks = analyzeDisclosure(evidence({
      exposedPaths: [{
        path: "/.env", url: "https://example.test/.env", confirmed: true, signature: "environment-file syntax",
        observation: observation({ status: 200, bodySample: "DB_PASSWORD=x", bodyBytes: 13 })
      }]
    }));
    assert.strictEqual(checks.find(check => check.id.includes("disclosure.path."))!.severity, "critical");
  });
});

suite("rate limiting and injection checks", () => {
  test("rate-limit headers pass and their absence is only a low warning", () => {
    const withHeaders = analyzeRateLimit(evidence({ primary: observation({ headers: { "ratelimit-limit": "100" } }) }));
    assert.strictEqual(find(withHeaders, "ratelimit.headers")!.status, "pass");
    const without = analyzeRateLimit(evidence());
    assert.strictEqual(find(without, "ratelimit.headers")!.severity, "low");
  });

  test("a burst that was throttled passes and one that was not warns", () => {
    const limited = analyzeRateLimit(evidence({ burst: { requests: 10, statuses: [200, 429], limited: 1, elapsedMs: 300 } }));
    assert.strictEqual(find(limited, "ratelimit.burst")!.status, "pass");
    const open = analyzeRateLimit(evidence({ burst: { requests: 10, statuses: [200], limited: 0, elapsedMs: 300 } }));
    assert.strictEqual(find(open, "ratelimit.burst")!.severity, "medium");
  });

  test("unencoded reflection into HTML is a high finding", () => {
    const marker = 'dsq123<>"\'';
    const checks = analyzeInjection(evidence({
      reflection: {
        marker,
        observation: observation({ headers: { "content-type": "text/html" }, bodySample: `<p>${marker}</p>`, bodyBytes: 40 })
      }
    }));
    const check = find(checks, "injection.reflection")!;
    assert.strictEqual(check.status, "fail");
    assert.strictEqual(check.severity, "high");
  });

  test("encoded reflection passes", () => {
    const marker = 'dsq123<>"\'';
    const checks = analyzeInjection(evidence({
      reflection: {
        marker,
        observation: observation({ headers: { "content-type": "text/html" }, bodySample: "<p>dsq123&lt;&gt;&quot;&#39;</p>", bodyBytes: 40 })
      }
    }));
    assert.strictEqual(find(checks, "injection.reflection")!.status, "pass");
  });

  test("input that is not reflected at all passes", () => {
    const checks = analyzeInjection(evidence({
      reflection: { marker: 'dsqabc<>"\'', observation: observation({ bodySample: "{}", bodyBytes: 2 }) }
    }));
    assert.strictEqual(find(checks, "injection.reflection")!.status, "pass");
  });
});

/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */

suite("endpoint report", () => {
  test("an unreachable endpoint reports the failure instead of inventing findings", () => {
    const checks = analyzeEndpoint(evidence({
      primary: observation({ status: 0, error: "getaddrinfo ENOTFOUND nope.invalid", errorCode: "ENOTFOUND" })
    }));
    assert.strictEqual(checks.length, 1);
    assert.strictEqual(checks[0].status, "skipped");
    assert.ok(/could not be reached/i.test(checks[0].title));
  });

  test("every check id in a report is unique", () => {
    const checks = analyzeEndpoint(evidence({
      primary: observation({
        headers: { "content-type": "text/html" },
        setCookies: ["a=abcdefgh1234", "a=abcdefgh1234"],
        bodySample: "<html></html>",
        bodyBytes: 13
      })
    }));
    const ids = checks.map(check => check.id);
    assert.strictEqual(new Set(ids).size, ids.length, "duplicate check ids: " + ids.join(", "));
  });

  test("every non-pass check carries evidence or a remediation", () => {
    const checks = analyzeEndpoint(evidence({ primary: observation({ headers: { "content-type": "text/html" } }) }));
    for (const check of checks) {
      if (check.status !== "fail" && check.status !== "warn") continue;
      assert.ok(check.remediation, `${check.id} has no remediation`);
      assert.ok(check.detail.length > 30, `${check.id} has no useful detail`);
    }
  });

  test("passes and informational checks never carry a severity weight", () => {
    const checks = analyzeEndpoint(evidence({
      primary: observation({ headers: { "x-content-type-options": "nosniff", "content-type": "application/json" } })
    }));
    for (const check of checks) {
      if (check.status === "pass" || check.status === "info" || check.status === "skipped") {
        assert.strictEqual(check.severity, "none", `${check.id} should not be weighted`);
      }
    }
  });

  test("the summary grades a critical finding as F regardless of score", () => {
    const summary = summarize([
      { id: "a", title: "a", category: "transport", status: "fail", severity: "critical", detail: "x" },
      ...Array.from({ length: 40 }, (_unused, index) => ({
        id: `p${index}`, title: "p", category: "headers" as const, status: "pass" as const, severity: "none" as const, detail: "x"
      }))
    ]);
    assert.strictEqual(summary.grade, "F");
    assert.strictEqual(summary.critical, 1);
    assert.strictEqual(summary.passed, 40);
  });

  test("an all-pass report scores A+", () => {
    const summary = summarize([
      { id: "a", title: "a", category: "headers", status: "pass", severity: "none", detail: "x" },
      { id: "b", title: "b", category: "headers", status: "pass", severity: "none", detail: "x" }
    ]);
    assert.strictEqual(summary.score, 100);
    assert.strictEqual(summary.grade, "A+");
  });
});

/* ------------------------------------------------------------------ *
 * Static analysis
 * ------------------------------------------------------------------ */

suite("static secret filtering", () => {
  test("entropy separates a real key from filler", () => {
    assert.ok(shannonEntropy("aaaaaaaaaaaa") < 1);
    assert.ok(shannonEntropy("sk-live-9f8a7b6c5d4e3f2a1b0c") > 3);
  });

  test("environment references and placeholders are not treated as secrets", () => {
    for (const value of [
      "process.env.API_KEY", "${DB_PASSWORD}", "<your-api-key>", "{{ secrets.TOKEN }}",
      "changeme", "xxxxxxxxxx", "os.environ['SECRET']", "REPLACE_ME", "password", "", "   "
    ]) {
      assert.ok(!looksLikeSecretValue(value), `"${value}" must not be reported as a secret`);
    }
  });

  test("a high-entropy literal is treated as a secret", () => {
    assert.ok(looksLikeSecretValue('"sk-live-9f8a7b6c5d4e3f2a1b0c"'));
    assert.ok(looksLikeSecretValue("'A7f!k29Lqz03Xm1p'"));
  });

  test("comment lines are recognised across syntaxes", () => {
    for (const line of ["// note", "# note", " * note", "/* note", "<!-- note", "-- note"]) {
      assert.ok(isCommentLine(line), `"${line}" should be a comment`);
    }
    assert.ok(!isCommentLine("const a = 1;"));
  });

  test("redaction masks the value but keeps the shape", () => {
    const masked = redactLine('const key = "AKIA4KPQ7RZT2XW9BVLM";');
    assert.ok(!masked.includes("AKIA4KPQ7RZT2XW9BVLM"));
    assert.ok(masked.includes("•"));
    assert.ok(masked.includes("const key"));
  });
});

suite("source rules", () => {
  test("a format-matched credential is reported as critical", () => {
    const findings = scanSourceText("app.js", 'const awsKey = "AKIA4KPQ7RZT2XW9BVLM";');
    const aws = findings.find(finding => finding.rule === "aws-access-key");
    assert.ok(aws, "the AWS rule did not fire");
    assert.strictEqual(aws!.severity, "critical");
    assert.ok(!aws!.evidence.includes("AKIA4KPQ7RZT2XW9BVLM"));
  });

  test("a documented vendor example key is not reported as a leak", () => {
    assert.deepStrictEqual(
      scanSourceText("README.md", 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')
        .filter(finding => finding.rule === "aws-access-key"),
      []
    );
    const checks = analyzeDisclosure(evidence({
      primary: observation({ bodySample: '{"key":"AKIAIOSFODNN7EXAMPLE"}', bodyBytes: 30 })
    }));
    assert.strictEqual(find(checks, "disclosure.secret")!.status, "pass");
  });

  test("a value referenced from a variable is not a hard-coded credential", () => {
    const findings = scanSourceText("api.ts", [
      "  const resolvedPassword = decrypt(stored);",
      "  auth = { username: resolvedUser, password: resolvedPassword };",
      "  return { apiKey: options.apiKey, clientSecret: options.clientSecret };",
      "  auth?: { username: string; password: string };",
      "  result.password = index > -1 ? credential.slice(index + 1) : '';"
    ].join("\n"));
    assert.deepStrictEqual(findings.filter(finding => finding.rule === "generic-secret"), []);
  });

  test("an unquoted value in an env file is still a credential", () => {
    const findings = scanSourceText(".env", "DB_PASSWORD=T9xqL2mZr8wK4p");
    assert.ok(findings.some(finding => finding.rule === "generic-secret"));
  });

  test("a constant string assigned to innerHTML is not an injection sink", () => {
    assert.deepStrictEqual(
      scanSourceText("ui.ts", "output.innerHTML = '<div class=\"empty\">Enter a pattern</div>';")
        .filter(finding => finding.rule === "dom-xss-sink"),
      []
    );
    assert.ok(scanSourceText("ui.ts", "output.innerHTML = '<div>' + name + '</div>';")
      .some(finding => finding.rule === "dom-xss-sink"));
  });

  test("the English word \"select\" in a UI string is not SQL", () => {
    assert.deepStrictEqual(
      scanSourceText("ui.ts", 'const row = `<td aria-label="Select log in ${file} at line ${line}">`;')
        .filter(finding => finding.rule === "sql-string-concat"),
      []
    );
  });

  test("a cookie flag disabled outside cookie context is not reported", () => {
    assert.deepStrictEqual(
      scanSourceText("model.ts", "  const cookie = { name, secure: false, httpOnly: false };")
        .filter(finding => finding.rule === "insecure-cookie-config").length > 0,
      true
    );
    assert.deepStrictEqual(
      scanSourceText("model.ts", "  const options = { secure: false };")
        .filter(finding => finding.rule === "insecure-cookie-config"),
      []
    );
  });

  test("prose ending in a bare scheme is not a plain-HTTP endpoint", () => {
    assert.deepStrictEqual(
      scanSourceText("a.ts", 'const note = `${count} references use http://. Fix them.`;')
        .filter(finding => finding.rule === "insecure-http"),
      []
    );
  });

  test("an environment reference does not produce a secret finding", () => {
    const findings = scanSourceText("config.ts", [
      "const apiKey = process.env.API_KEY;",
      'const password = "";',
      "const token = config.token;",
      'const secret = "<your-secret-here>";'
    ].join("\n"));
    assert.deepStrictEqual(findings.filter(finding => finding.rule === "generic-secret"), []);
  });

  test("a hard-coded credential is reported", () => {
    const findings = scanSourceText("config.ts", 'const apiKey = "sk-live-9f8a7b6c5d4e3f2a1b0c";');
    assert.ok(findings.some(finding => finding.rule === "generic-secret"));
  });

  test("eval fires but a method named eval does not", () => {
    assert.ok(scanSourceText("a.js", "eval(userInput);").some(finding => finding.rule === "unsafe-eval"));
    assert.ok(!scanSourceText("a.py", "model.eval()").some(finding => finding.rule === "unsafe-eval"));
    assert.ok(!scanSourceText("a.js", "const x = evaluate(input);").some(finding => finding.rule === "unsafe-eval"));
  });

  test("XML namespaces and licence URLs do not trigger the plain-HTTP rule", () => {
    const noise = scanSourceText("pom.xml", [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      '<url>http://www.apache.org/licenses/LICENSE-2.0</url>',
      'const local = "http://localhost:3000";'
    ].join("\n"));
    assert.deepStrictEqual(noise.filter(finding => finding.rule === "insecure-http"), []);
    assert.ok(scanSourceText("a.js", 'fetch("http://tracker.example.com/collect");')
      .some(finding => finding.rule === "insecure-http"));
  });

  test("SQL string concatenation and disabled TLS verification are caught", () => {
    assert.ok(scanSourceText("db.ts", "const q = `SELECT * FROM users WHERE id = ${id}`;")
      .some(finding => finding.rule === "sql-string-concat"));
    assert.ok(scanSourceText("http.ts", "const agent = new https.Agent({ rejectUnauthorized: false });")
      .some(finding => finding.rule === "tls-verification-disabled"));
    assert.ok(scanSourceText("client.py", "requests.get(url, verify=False)")
      .some(finding => finding.rule === "tls-verification-disabled"));
  });

  test("DOM XSS sinks are caught but clearing innerHTML is not", () => {
    assert.ok(scanSourceText("ui.ts", "node.innerHTML = userInput;").some(finding => finding.rule === "dom-xss-sink"));
    assert.ok(!scanSourceText("ui.ts", 'node.innerHTML = "";').some(finding => finding.rule === "dom-xss-sink"));
  });

  test("workflow rules only apply inside .github/workflows", () => {
    const line = "  - uses: some-org/some-action@v1";
    assert.ok(scanSourceText(".github/workflows/ci.yml", line).some(finding => finding.rule === "unpinned-ci-action"));
    assert.ok(!scanSourceText("docs/example.yml", line).some(finding => finding.rule === "unpinned-ci-action"));
    assert.ok(!scanSourceText(".github/workflows/ci.yml", "  - uses: some-org/some-action@" + "a".repeat(40))
      .some(finding => finding.rule === "unpinned-ci-action"));
  });

  test("workflow script injection is caught", () => {
    assert.ok(scanSourceText(".github/workflows/ci.yml", '        run: echo "${{ github.event.pull_request.title }}"')
      .some(finding => finding.rule === "ci-script-injection"));
  });

  test("every finding carries a line, a remediation and a masked evidence line", () => {
    const findings = scanSourceText("app.js", [
      'const awsKey = "AKIA4KPQ7RZT2XW9BVLM";',
      "eval(userInput);",
      'const db = "postgres://admin:hunter2@db.internal:5432/app";'
    ].join("\n"));
    assert.ok(findings.length >= 3);
    for (const finding of findings) {
      assert.ok(finding.line >= 1, `${finding.rule} has no line`);
      assert.ok(finding.remediation.length > 20, `${finding.rule} has no remediation`);
      assert.ok(finding.title.length > 3, `${finding.rule} has no title`);
      assert.ok(["critical", "high", "medium", "low"].includes(finding.severity));
    }
  });

  test("scanning the same text twice is stable", () => {
    const text = 'const apiKey = "sk-live-9f8a7b6c5d4e3f2a1b0c";\neval(x);';
    assert.strictEqual(scanSourceText("a.js", text).length, scanSourceText("a.js", text).length);
  });
});

suite("cloud rules", () => {
  test("Terraform and Kubernetes risks are detected", () => {
    const terraform = scanCloudText("infra.tf", [
      'resource "aws_security_group_rule" "open" {',
      '  cidr_blocks = ["0.0.0.0/0"]',
      "}",
      '  acl = "public-read"',
      "  server_side_encryption = false",
      "  publicly_accessible = true"
    ].join("\n"));
    const rules = new Set(terraform.map(finding => finding.rule));
    for (const expected of ["public-network-ingress", "public-cloud-storage", "unencrypted-storage", "public-database"]) {
      assert.ok(rules.has(expected), `${expected} did not fire; got ${[...rules].join(", ")}`);
    }
  });

  test("container risks are detected", () => {
    const manifest = scanCloudText("deploy.yaml", [
      "spec:",
      "  hostNetwork: true",
      "  containers:",
      "    - image: nginx:latest",
      "      securityContext:",
      "        privileged: true",
      "        runAsNonRoot: false"
    ].join("\n"));
    const rules = new Set(manifest.map(finding => finding.rule));
    for (const expected of ["host-networking", "latest-container-tag", "privileged-container", "container-runs-as-root"]) {
      assert.ok(rules.has(expected), `${expected} did not fire; got ${[...rules].join(", ")}`);
    }
  });

  test("a secret reference is not reported as an embedded credential", () => {
    const findings = scanCloudText("deploy.yaml", [
      "        - name: DB_PASSWORD",
      "          valueFrom:",
      "            secretKeyRef: { name: db, key: password }",
      "      token: ${{ secrets.GITHUB_TOKEN }}"
    ].join("\n"));
    assert.deepStrictEqual(findings.filter(finding => finding.rule === "cloud-secret-value"), []);
  });

  test("an embedded credential in a manifest is critical", () => {
    const findings = scanCloudText("compose.yml", '      POSTGRES_PASSWORD: "T9x!qL2mZr8w"');
    const secret = findings.find(finding => finding.rule === "cloud-secret-value");
    assert.ok(secret, "the embedded-credential rule did not fire");
    assert.strictEqual(secret!.severity, "critical");
  });

  test("an egress rule to the internet is not flagged as open ingress", () => {
    const findings = scanCloudText("infra.tf", '  egress_cidr_blocks = ["0.0.0.0/0"]');
    assert.deepStrictEqual(findings.filter(finding => finding.rule === "public-network-ingress"), []);
  });
});

suite("workspace posture checks", () => {
  const manifest = (extra: Record<string, unknown> = {}) => JSON.stringify({
    name: "demo", version: "1.0.0", dependencies: { axios: "^1.8.3" }, engines: { node: ">=20" }, ...extra
  });

  test("a missing lockfile fails and a present one passes", () => {
    const without = analyzeWorkspacePosture(new Map([["package.json", manifest()]]));
    assert.strictEqual(find(without, "deps.lockfile")!.status, "fail");

    const with_ = analyzeWorkspacePosture(new Map([["package.json", manifest()], ["package-lock.json", "{}"]]));
    assert.strictEqual(find(with_, "deps.lockfile")!.status, "pass");
  });

  test("an unbounded version range is reported", () => {
    const checks = analyzeWorkspacePosture(new Map([["package.json", manifest({ dependencies: { lodash: "*" } })]]));
    assert.strictEqual(find(checks, "deps.floating")!.status, "warn");
  });

  test("an abandoned package is named with the reason", () => {
    const checks = analyzeWorkspacePosture(new Map([["package.json", manifest({ dependencies: { request: "^2.88.0" } })]]));
    const check = find(checks, "deps.discouraged")!;
    assert.strictEqual(check.status, "warn");
    assert.ok(check.detail.includes("request"));
  });

  test("a registry token in .npmrc is critical", () => {
    const checks = analyzeWorkspacePosture(new Map([
      ["package.json", manifest()],
      [".npmrc", "//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789"]
    ]));
    assert.strictEqual(find(checks, "config.npmrc-token")!.severity, "critical");
  });

  test("a templated .npmrc token is not reported", () => {
    const checks = analyzeWorkspacePosture(new Map([
      ["package.json", manifest()],
      [".npmrc", "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"]
    ]));
    assert.strictEqual(find(checks, "config.npmrc-token"), undefined);
  });

  test("an unignored .env file is a high failure", () => {
    const missing = analyzeWorkspacePosture(new Map([["package.json", manifest()], [".env", "A=1"], [".gitignore", "node_modules\n"]]));
    const check = find(missing, "config.env-ignored")!;
    assert.strictEqual(check.status, "fail");
    assert.strictEqual(check.severity, "high");

    const ignored = analyzeWorkspacePosture(new Map([["package.json", manifest()], [".env", "A=1"], [".gitignore", "node_modules\n.env\n"]]));
    assert.strictEqual(find(ignored, "config.env-ignored")!.status, "pass");
  });

  test("a .env.example alone does not trigger the env check", () => {
    const checks = analyzeWorkspacePosture(new Map([["package.json", manifest()], [".env.example", "A="]]));
    assert.strictEqual(find(checks, "config.env-ignored"), undefined);
  });

  test("CI scanning and token permissions are graded from the workflows", () => {
    const bare = analyzeWorkspacePosture(new Map([
      ["package.json", manifest()],
      [".github/workflows/ci.yml", "on: push\njobs:\n  build:\n    steps:\n      - run: npm test\n"]
    ]));
    assert.strictEqual(find(bare, "config.ci-scanning")!.status, "warn");
    assert.strictEqual(find(bare, "config.ci-permissions")!.status, "warn");

    const hardened = analyzeWorkspacePosture(new Map([
      ["package.json", manifest()],
      [".github/workflows/ci.yml", "on: push\npermissions:\n  contents: read\njobs:\n  scan:\n    steps:\n      - uses: github/codeql-action/analyze@v3\n"]
    ]));
    assert.strictEqual(find(hardened, "config.ci-scanning")!.status, "pass");
    assert.strictEqual(find(hardened, "config.ci-permissions")!.status, "pass");
  });

  test("an npm script that pipes a download into a shell is a high failure", () => {
    const checks = analyzeWorkspacePosture(new Map([
      ["package.json", manifest({ scripts: { setup: "curl -sL https://example.test/i.sh | sh" } })]
    ]));
    assert.strictEqual(find(checks, "deps.dangerous-script")!.severity, "high");
  });

  test("unpinned Python requirements are reported and pinned ones pass", () => {
    const loose = analyzeWorkspacePosture(new Map([["requirements.txt", "flask\nrequests\n"]]));
    assert.strictEqual(find(loose, "deps.pip-unpinned")!.status, "warn");
    const pinned = analyzeWorkspacePosture(new Map([["requirements.txt", "flask==3.0.0\nrequests==2.32.3\n"]]));
    assert.strictEqual(find(pinned, "deps.pip-unpinned")!.status, "pass");
  });

  test("a malformed manifest is reported rather than crashing the scan", () => {
    const checks = analyzeWorkspacePosture(new Map([["package.json", "{ not json"]]));
    assert.strictEqual(find(checks, "deps.manifest-parse")!.status, "warn");
  });
});
