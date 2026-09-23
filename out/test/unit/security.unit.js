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
const run_unit_tests_1 = require("./run-unit-tests");
const security_analysis_1 = require("../../services/security-analysis");
const security_static_1 = require("../../services/security-static");
/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function observation(partial = {}) {
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
function evidence(partial = {}) {
    return {
        url: "https://example.test/api",
        primary: observation(),
        probeOrigin: "https://devsnip-cors-probe.example",
        sentCredentials: false,
        ...partial
    };
}
function find(checks, id) {
    return checks.find(check => check.id === id);
}
/* ------------------------------------------------------------------ *
 * Parsers
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("security header parsing", () => {
    (0, run_unit_tests_1.test)("normalizes header names and flattens array values", () => {
        const headers = (0, security_analysis_1.normalizeHeaders)({ "Content-Type": "text/html", "X-Multi": ["a", "b"], Empty: undefined });
        assert.strictEqual(headers["content-type"], "text/html");
        assert.strictEqual(headers["x-multi"], "a, b");
        assert.ok(!("empty" in headers));
    });
    (0, run_unit_tests_1.test)("keeps set-cookie as a list", () => {
        assert.deepStrictEqual((0, security_analysis_1.setCookieList)({ "Set-Cookie": ["a=1", "b=2"] }), ["a=1", "b=2"]);
        assert.deepStrictEqual((0, security_analysis_1.setCookieList)({ "set-cookie": "a=1" }), ["a=1"]);
        assert.deepStrictEqual((0, security_analysis_1.setCookieList)({ other: "x" }), []);
    });
    (0, run_unit_tests_1.test)("parses an HSTS policy including a quoted max-age", () => {
        const policy = (0, security_analysis_1.parseHsts)('max-age="31536000"; includeSubDomains; preload');
        assert.strictEqual(policy.maxAge, 31536000);
        assert.ok(policy.includeSubDomains);
        assert.ok(policy.preload);
    });
    (0, run_unit_tests_1.test)("reports an HSTS header with no max-age as present but incomplete", () => {
        const policy = (0, security_analysis_1.parseHsts)("includeSubDomains");
        assert.ok(policy.present);
        assert.strictEqual(policy.maxAge, undefined);
    });
    (0, run_unit_tests_1.test)("parses CSP directives and ignores a repeated directive", () => {
        const directives = (0, security_analysis_1.parseCsp)("default-src 'self'; script-src 'nonce-abc'; script-src *");
        assert.deepStrictEqual(directives["default-src"], ["'self'"]);
        assert.deepStrictEqual(directives["script-src"], ["'nonce-abc'"]);
    });
    (0, run_unit_tests_1.test)("parses a Set-Cookie and never keeps the value", () => {
        const cookie = (0, security_analysis_1.parseSetCookie)("sid=super-secret-value; Path=/; Secure; HttpOnly; SameSite=Lax");
        assert.ok(cookie);
        assert.strictEqual(cookie.name, "sid");
        assert.ok(cookie.secure && cookie.httpOnly);
        assert.strictEqual(cookie.sameSite, "lax");
        assert.ok(!cookie.raw.includes("super-secret-value"), "the cookie value must not be retained");
    });
    (0, run_unit_tests_1.test)("decodes a JWT header without verifying it", () => {
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ sub: "1", exp: 4102444800 })).toString("base64url");
        const decoded = (0, security_analysis_1.decodeJwt)(`${header}.${payload}.`);
        assert.ok(decoded);
        assert.strictEqual(decoded.alg, "none");
        assert.strictEqual(decoded.exp, 4102444800);
        assert.ok(decoded.claims.includes("sub"));
    });
});
/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("transport checks", () => {
    (0, run_unit_tests_1.test)("plain HTTP on a public host is critical", () => {
        const checks = (0, security_analysis_1.analyzeTransport)(evidence({ url: "http://public.test/api", primary: observation({ url: "http://public.test/api" }) }));
        const scheme = find(checks, "transport.scheme");
        assert.strictEqual(scheme.status, "fail");
        assert.strictEqual(scheme.severity, "critical");
        assert.ok(scheme.remediation);
    });
    (0, run_unit_tests_1.test)("plain HTTP on localhost is informational, not a failure", () => {
        const checks = (0, security_analysis_1.analyzeTransport)(evidence({ url: "http://localhost:3000/api", primary: observation({ url: "http://localhost:3000/api" }) }));
        assert.strictEqual(find(checks, "transport.scheme").status, "info");
    });
    (0, run_unit_tests_1.test)("a refused plain-HTTP port passes the downgrade check", () => {
        const checks = (0, security_analysis_1.analyzeTransport)(evidence({
            plainHttp: observation({ url: "http://example.test/api", status: 0, error: "connect ECONNREFUSED", errorCode: "ECONNREFUSED" })
        }));
        assert.strictEqual(find(checks, "transport.redirect").status, "pass");
    });
    (0, run_unit_tests_1.test)("HTTP served without a redirect is a high finding", () => {
        const checks = (0, security_analysis_1.analyzeTransport)(evidence({ plainHttp: observation({ url: "http://example.test/api", status: 200 }) }));
        const redirect = find(checks, "transport.redirect");
        assert.strictEqual(redirect.status, "fail");
        assert.strictEqual(redirect.severity, "high");
    });
    (0, run_unit_tests_1.test)("an expired certificate is critical and a near-expiry one is a warning", () => {
        const expired = (0, security_analysis_1.analyzeTransport)(evidence({ tls: { authorized: true, daysUntilExpiry: -3, validTo: "Jan 1 00:00:00 2020 GMT" } }));
        assert.strictEqual(find(expired, "transport.cert.expiry").severity, "critical");
        const soon = (0, security_analysis_1.analyzeTransport)(evidence({ tls: { authorized: true, daysUntilExpiry: 20 } }));
        const check = find(soon, "transport.cert.expiry");
        assert.strictEqual(check.status, "warn");
        assert.strictEqual(check.severity, "medium");
    });
    (0, run_unit_tests_1.test)("a hostname mismatch is reported distinctly from an untrusted chain", () => {
        const checks = (0, security_analysis_1.analyzeTransport)(evidence({
            tls: { authorized: false, authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID" }
        }));
        assert.ok(/hostname/i.test(find(checks, "transport.cert.trust").title));
    });
    (0, run_unit_tests_1.test)("a deprecated TLS version fails", () => {
        const checks = (0, security_analysis_1.analyzeTransport)(evidence({ tls: { authorized: true, protocol: "TLSv1.1" } }));
        assert.strictEqual(find(checks, "transport.protocol").status, "fail");
        const modern = (0, security_analysis_1.analyzeTransport)(evidence({ tls: { authorized: true, protocol: "TLSv1.3" } }));
        assert.strictEqual(find(modern, "transport.protocol").status, "pass");
    });
});
/* ------------------------------------------------------------------ *
 * HSTS
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("HSTS checks", () => {
    (0, run_unit_tests_1.test)("is skipped, not failed, on a plain-HTTP endpoint", () => {
        const checks = (0, security_analysis_1.analyzeHsts)(evidence({ url: "http://example.test/", primary: observation({ url: "http://example.test/" }) }));
        assert.strictEqual(checks[0].status, "skipped");
        assert.strictEqual(checks[0].severity, "none");
    });
    (0, run_unit_tests_1.test)("a missing header on HTTPS is a high failure", () => {
        const checks = (0, security_analysis_1.analyzeHsts)(evidence());
        assert.strictEqual(checks[0].status, "fail");
        assert.strictEqual(checks[0].severity, "high");
    });
    (0, run_unit_tests_1.test)("max-age=0 is reported as a disabled policy", () => {
        const checks = (0, security_analysis_1.analyzeHsts)(evidence({ primary: observation({ headers: { "strict-transport-security": "max-age=0" } }) }));
        assert.strictEqual(find(checks, "hsts.maxage").status, "fail");
    });
    (0, run_unit_tests_1.test)("a short max-age warns and a one-year policy passes", () => {
        const short = (0, security_analysis_1.analyzeHsts)(evidence({ primary: observation({ headers: { "strict-transport-security": "max-age=600" } }) }));
        assert.strictEqual(find(short, "hsts.maxage").status, "warn");
        const full = (0, security_analysis_1.analyzeHsts)(evidence({
            primary: observation({ headers: { "strict-transport-security": "max-age=31536000; includeSubDomains; preload" } })
        }));
        assert.strictEqual(find(full, "hsts.maxage").status, "pass");
        assert.strictEqual(find(full, "hsts.subdomains").status, "pass");
        assert.strictEqual(find(full, "hsts.preload").status, "pass");
    });
    (0, run_unit_tests_1.test)("preload without the required directives is flagged as ineligible", () => {
        const checks = (0, security_analysis_1.analyzeHsts)(evidence({
            primary: observation({ headers: { "strict-transport-security": "max-age=86400; preload" } })
        }));
        assert.strictEqual(find(checks, "hsts.preload").status, "warn");
    });
});
/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("security header checks", () => {
    const html = { "content-type": "text/html; charset=utf-8" };
    (0, run_unit_tests_1.test)("missing nosniff fails and a valid one passes", () => {
        assert.strictEqual(find((0, security_analysis_1.analyzeSecurityHeaders)(evidence()), "headers.nosniff").status, "fail");
        const ok = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({ primary: observation({ headers: { "x-content-type-options": "nosniff" } }) }));
        assert.strictEqual(find(ok, "headers.nosniff").status, "pass");
    });
    (0, run_unit_tests_1.test)("an invalid nosniff value is not treated as protection", () => {
        const checks = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({ primary: observation({ headers: { "x-content-type-options": "NOSNIFFF" } }) }));
        assert.strictEqual(find(checks, "headers.nosniff").status, "fail");
    });
    (0, run_unit_tests_1.test)("CSP frame-ancestors satisfies the clickjacking check", () => {
        const checks = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({
            primary: observation({ headers: { ...html, "content-security-policy": "default-src 'self'; frame-ancestors 'none'" } })
        }));
        assert.strictEqual(find(checks, "headers.clickjacking").status, "pass");
    });
    (0, run_unit_tests_1.test)("frame-ancestors * does not count as protection", () => {
        const checks = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({
            primary: observation({ headers: { ...html, "content-security-policy": "frame-ancestors *" } })
        }));
        assert.strictEqual(find(checks, "headers.clickjacking").status, "fail");
    });
    (0, run_unit_tests_1.test)("a JSON response is graded more gently than an HTML one for framing", () => {
        const json = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({ primary: observation({ headers: { "content-type": "application/json" } }) }));
        assert.strictEqual(find(json, "headers.clickjacking").severity, "low");
        const page = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({ primary: observation({ headers: html }) }));
        assert.strictEqual(find(page, "headers.clickjacking").severity, "medium");
    });
    (0, run_unit_tests_1.test)("only a versioned banner is reported", () => {
        const bare = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({ primary: observation({ headers: { server: "nginx" } }) }));
        assert.strictEqual(find(bare, "headers.banner").status, "info");
        const versioned = (0, security_analysis_1.analyzeSecurityHeaders)(evidence({ primary: observation({ headers: { server: "nginx/1.18.0" } }) }));
        assert.strictEqual(find(versioned, "headers.banner").status, "warn");
        const none = (0, security_analysis_1.analyzeSecurityHeaders)(evidence());
        assert.strictEqual(find(none, "headers.banner").status, "pass");
    });
});
/* ------------------------------------------------------------------ *
 * CSP
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("CSP checks", () => {
    const htmlHeaders = (csp) => ({
        "content-type": "text/html",
        ...(csp ? { "content-security-policy": csp } : {})
    });
    (0, run_unit_tests_1.test)("a missing CSP on an HTML page is a high failure", () => {
        const checks = (0, security_analysis_1.analyzeCsp)(evidence({ primary: observation({ headers: htmlHeaders() }) }));
        assert.strictEqual(checks[0].status, "fail");
        assert.strictEqual(checks[0].severity, "high");
    });
    (0, run_unit_tests_1.test)("report-only is reported as not enforcing", () => {
        const checks = (0, security_analysis_1.analyzeCsp)(evidence({
            primary: observation({ headers: { "content-type": "text/html", "content-security-policy-report-only": "default-src 'self'" } })
        }));
        assert.strictEqual(find(checks, "csp.present").status, "warn");
    });
    (0, run_unit_tests_1.test)("'unsafe-inline' fails, but not when a nonce neutralises it", () => {
        const unsafe = (0, security_analysis_1.analyzeCsp)(evidence({ primary: observation({ headers: htmlHeaders("script-src 'self' 'unsafe-inline'") }) }));
        assert.strictEqual(find(unsafe, "csp.unsafe-inline").status, "fail");
        const nonce = (0, security_analysis_1.analyzeCsp)(evidence({ primary: observation({ headers: htmlHeaders("script-src 'self' 'unsafe-inline' 'nonce-abc123'") }) }));
        assert.strictEqual(find(nonce, "csp.unsafe-inline").status, "pass");
    });
    (0, run_unit_tests_1.test)("a wildcard script source fails and base-uri is checked separately", () => {
        const checks = (0, security_analysis_1.analyzeCsp)(evidence({ primary: observation({ headers: htmlHeaders("default-src 'self'; script-src *") }) }));
        assert.strictEqual(find(checks, "csp.wildcard-script").status, "fail");
        assert.strictEqual(find(checks, "csp.base-uri").status, "warn");
    });
    (0, run_unit_tests_1.test)("script-src falls back to default-src", () => {
        const checks = (0, security_analysis_1.analyzeCsp)(evidence({ primary: observation({ headers: htmlHeaders("default-src 'self' 'unsafe-inline'") }) }));
        assert.strictEqual(find(checks, "csp.unsafe-inline").status, "fail");
    });
    (0, run_unit_tests_1.test)("a strict policy passes the inline and object checks", () => {
        const checks = (0, security_analysis_1.analyzeCsp)(evidence({
            primary: observation({ headers: htmlHeaders("default-src 'self'; script-src 'nonce-x' 'strict-dynamic'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'") })
        }));
        assert.strictEqual(find(checks, "csp.unsafe-inline").status, "pass");
        assert.strictEqual(find(checks, "csp.object-src").status, "pass");
        assert.strictEqual(find(checks, "csp.base-uri").status, "pass");
    });
});
/* ------------------------------------------------------------------ *
 * CORS
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("CORS checks", () => {
    const origin = "https://devsnip-cors-probe.example";
    (0, run_unit_tests_1.test)("no CORS headers is a pass, not a gap", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({ corsSimple: observation() }));
        assert.strictEqual(find(checks, "cors.origin").status, "pass");
    });
    (0, run_unit_tests_1.test)("reflecting an arbitrary origin with credentials is critical", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({
                headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" }
            })
        }));
        const check = find(checks, "cors.origin");
        assert.strictEqual(check.status, "fail");
        assert.strictEqual(check.severity, "critical");
    });
    (0, run_unit_tests_1.test)("reflection without credentials is a medium warning", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({ headers: { "access-control-allow-origin": origin, vary: "Origin" } })
        }));
        const check = find(checks, "cors.origin");
        assert.strictEqual(check.status, "warn");
        assert.strictEqual(check.severity, "medium");
    });
    (0, run_unit_tests_1.test)("wildcard with credentials is reported as the invalid combination it is", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({ headers: { "access-control-allow-origin": "*", "access-control-allow-credentials": "true" } })
        }));
        assert.strictEqual(find(checks, "cors.origin").severity, "high");
    });
    (0, run_unit_tests_1.test)("the null origin is a high failure", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({ corsSimple: observation({ headers: { "access-control-allow-origin": "null" } }) }));
        assert.strictEqual(find(checks, "cors.origin").severity, "high");
    });
    (0, run_unit_tests_1.test)("a reflected origin without Vary is flagged for cache poisoning", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({ headers: { "access-control-allow-origin": origin } })
        }));
        assert.strictEqual(find(checks, "cors.vary").status, "warn");
    });
    (0, run_unit_tests_1.test)("a fixed allow-list origin passes", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({ headers: { "access-control-allow-origin": "https://app.example.test", vary: "Origin" } })
        }));
        assert.strictEqual(find(checks, "cors.origin").status, "pass");
        assert.strictEqual(find(checks, "cors.vary").status, "pass");
    });
    (0, run_unit_tests_1.test)("a wildcard origin without credentials does not fail the method check", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({ headers: { "access-control-allow-origin": "*" } }),
            corsPreflight: observation({
                method: "OPTIONS", status: 204,
                headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,DELETE" }
            })
        }));
        const methods = find(checks, "cors.methods");
        assert.strictEqual(methods.status, "info");
        assert.strictEqual(methods.severity, "none");
    });
    (0, run_unit_tests_1.test)("a reflected origin with write methods is a real failure", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence({
            corsSimple: observation({ headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } }),
            corsPreflight: observation({
                method: "OPTIONS", status: 204,
                headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,DELETE" }
            })
        }));
        const methods = find(checks, "cors.methods");
        assert.strictEqual(methods.status, "fail");
        assert.strictEqual(methods.severity, "high");
    });
    (0, run_unit_tests_1.test)("the probes are skipped rather than guessed when they did not run", () => {
        const checks = (0, security_analysis_1.analyzeCors)(evidence());
        assert.strictEqual(checks[0].status, "skipped");
    });
});
/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("cookie checks", () => {
    (0, run_unit_tests_1.test)("no cookies is informational", () => {
        assert.strictEqual((0, security_analysis_1.analyzeCookies)(evidence())[0].status, "info");
    });
    (0, run_unit_tests_1.test)("a session cookie without Secure or HttpOnly is high severity", () => {
        const checks = (0, security_analysis_1.analyzeCookies)(evidence({ primary: observation({ setCookies: ["sessionid=abc123def456; Path=/"] }) }));
        const secure = checks.find(check => check.id.endsWith(".secure"));
        const httpOnly = checks.find(check => check.id.endsWith(".httponly"));
        assert.strictEqual(secure.status, "fail");
        assert.strictEqual(secure.severity, "high");
        assert.strictEqual(httpOnly.severity, "high");
    });
    (0, run_unit_tests_1.test)("a fully-flagged cookie passes every flag check", () => {
        const checks = (0, security_analysis_1.analyzeCookies)(evidence({
            primary: observation({ setCookies: ["sid=abc123def456; Path=/; Secure; HttpOnly; SameSite=Lax"] })
        }));
        assert.ok(checks.filter(check => check.status === "pass").length >= 3);
        assert.strictEqual(checks.filter(check => check.status === "fail").length, 0);
    });
    (0, run_unit_tests_1.test)("SameSite=None without Secure is reported as a dropped cookie", () => {
        const checks = (0, security_analysis_1.analyzeCookies)(evidence({
            primary: observation({ setCookies: ["tracker=abcdef123456; SameSite=None"] })
        }));
        const sameSite = checks.find(check => check.id.endsWith(".samesite"));
        assert.strictEqual(sameSite.status, "fail");
        assert.strictEqual(sameSite.severity, "high");
    });
    (0, run_unit_tests_1.test)("__Host- prefix violations are detected", () => {
        const checks = (0, security_analysis_1.analyzeCookies)(evidence({
            primary: observation({ setCookies: ["__Host-sid=abc123def456; Path=/app; Domain=example.test; Secure; HttpOnly"] })
        }));
        const prefix = checks.find(check => check.id.endsWith(".prefix"));
        assert.strictEqual(prefix.status, "fail");
    });
    (0, run_unit_tests_1.test)("a cookie being cleared is not graded on its flags", () => {
        const checks = (0, security_analysis_1.analyzeCookies)(evidence({
            primary: observation({ setCookies: ["sid=; Max-Age=0; Path=/"] })
        }));
        assert.strictEqual(checks.length, 1);
        assert.strictEqual(checks[0].status, "info");
    });
    (0, run_unit_tests_1.test)("a non-session cookie without HttpOnly is only a low warning", () => {
        const checks = (0, security_analysis_1.analyzeCookies)(evidence({
            primary: observation({ setCookies: ["theme=dark-mode-v2; Path=/; Secure; SameSite=Lax"] })
        }));
        const httpOnly = checks.find(check => check.id.endsWith(".httponly"));
        assert.strictEqual(httpOnly.severity, "low");
    });
});
/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("authentication and authorization checks", () => {
    (0, run_unit_tests_1.test)("a token in the query string is a high finding", () => {
        const checks = (0, security_analysis_1.analyzeAuth)(evidence({ url: "https://example.test/api?access_token=abcdef123456" }));
        const check = find(checks, "auth.credentials-in-url");
        assert.strictEqual(check.status, "fail");
        assert.strictEqual(check.severity, "high");
    });
    (0, run_unit_tests_1.test)("Basic auth over plain HTTP is critical", () => {
        const checks = (0, security_analysis_1.analyzeAuth)(evidence({
            url: "http://example.test/api",
            primary: observation({ url: "http://example.test/api", status: 401, headers: { "www-authenticate": 'Basic realm="api"' } })
        }));
        assert.strictEqual(find(checks, "auth.basic-over-http").severity, "critical");
    });
    (0, run_unit_tests_1.test)("authorization enforcement is skipped when no credential was sent", () => {
        assert.strictEqual(find((0, security_analysis_1.analyzeAuth)(evidence()), "auth.enforcement").status, "skipped");
    });
    (0, run_unit_tests_1.test)("an identical response without the credential is critical", () => {
        const checks = (0, security_analysis_1.analyzeAuth)(evidence({
            sentCredentials: true,
            primary: observation({ status: 200, bodyBytes: 4096 }),
            unauthenticated: observation({ status: 200, bodyBytes: 4096 })
        }));
        const check = find(checks, "auth.enforcement");
        assert.strictEqual(check.status, "fail");
        assert.strictEqual(check.severity, "critical");
    });
    (0, run_unit_tests_1.test)("a 401 without the credential passes", () => {
        const checks = (0, security_analysis_1.analyzeAuth)(evidence({
            sentCredentials: true,
            primary: observation({ status: 200, bodyBytes: 4096 }),
            unauthenticated: observation({ status: 401, bodyBytes: 30 })
        }));
        assert.strictEqual(find(checks, "auth.enforcement").status, "pass");
    });
    (0, run_unit_tests_1.test)("a JWT with alg none in the response is critical", () => {
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ sub: "1", exp: 4102444800 })).toString("base64url");
        const checks = (0, security_analysis_1.analyzeAuth)(evidence({
            primary: observation({ bodySample: `{"token":"${header}.${payload}.signature"}`, bodyBytes: 200 })
        }));
        assert.ok(checks.some(check => check.id.startsWith("auth.jwt.alg") && check.severity === "critical"));
    });
    (0, run_unit_tests_1.test)("an authenticated response without no-store warns about caching", () => {
        const checks = (0, security_analysis_1.analyzeAuth)(evidence({ sentCredentials: true, unauthenticated: observation({ status: 401 }) }));
        assert.strictEqual(find(checks, "auth.cache").status, "warn");
    });
});
/* ------------------------------------------------------------------ *
 * API, disclosure, rate limiting, injection
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("API and disclosure checks", () => {
    (0, run_unit_tests_1.test)("JSON served as text/html is reported", () => {
        const checks = (0, security_analysis_1.analyzeApiSecurity)(evidence({
            primary: observation({ headers: { "content-type": "text/html" }, bodySample: '{"ok":true}', bodyBytes: 11 })
        }));
        assert.strictEqual(find(checks, "api.content-type").status, "fail");
    });
    (0, run_unit_tests_1.test)("an enabled TRACE method is reported and a rejected one passes", () => {
        const on = (0, security_analysis_1.analyzeApiSecurity)(evidence({
            trace: observation({ method: "TRACE", status: 200, headers: { "content-type": "message/http" }, bodySample: "TRACE /api HTTP/1.1" })
        }));
        assert.strictEqual(find(on, "api.trace").status, "fail");
        const off = (0, security_analysis_1.analyzeApiSecurity)(evidence({ trace: observation({ method: "TRACE", status: 405 }) }));
        assert.strictEqual(find(off, "api.trace").status, "pass");
    });
    (0, run_unit_tests_1.test)("active mixed content on an HTTPS page is high", () => {
        const checks = (0, security_analysis_1.analyzeApiSecurity)(evidence({
            primary: observation({
                headers: { "content-type": "text/html" },
                bodySample: '<html><body><script src="http://cdn.example.test/a.js"></script></body></html>',
                bodyBytes: 80
            })
        }));
        assert.strictEqual(find(checks, "api.mixed-content").severity, "high");
    });
    (0, run_unit_tests_1.test)("an AWS key in the body is a critical disclosure", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            primary: observation({ bodySample: '{"key":"AKIA4KPQ7RZT2XW9BVLM"}', bodyBytes: 30 })
        }));
        const leak = checks.find(check => check.id.startsWith("disclosure.secret."));
        assert.strictEqual(leak.severity, "critical");
        assert.ok(!leak.evidence.includes("AKIA4KPQ7RZT2XW9BVLM"), "the credential must be masked in the evidence");
    });
    (0, run_unit_tests_1.test)("a clean body passes the credential check", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({ primary: observation({ bodySample: '{"ok":true}', bodyBytes: 11 }) }));
        assert.strictEqual(find(checks, "disclosure.secret").status, "pass");
    });
    (0, run_unit_tests_1.test)("a stack trace and a SQL error are both reported", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            primary: observation({
                bodySample: "Traceback (most recent call last):\n  File x\nYou have an error in your SQL syntax near 'x'",
                bodyBytes: 120
            })
        }));
        assert.ok(find(checks, "disclosure.stacktrace"));
        assert.strictEqual(find(checks, "disclosure.sqlerror").severity, "high");
    });
    (0, run_unit_tests_1.test)("SVG path data is not mistaken for an internal IP address", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            primary: observation({
                headers: { "content-type": "text/html" },
                bodySample: '<svg><path d="M255-10.646C23.5 6.188 7.435 10.669.606.225 1.19-.18"/></svg>',
                bodyBytes: 80
            })
        }));
        assert.strictEqual(find(checks, "disclosure.internal-host"), undefined);
    });
    (0, run_unit_tests_1.test)("a real private address is reported", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            primary: observation({ bodySample: '{"upstream":"10.0.12.34:8080"}', bodyBytes: 30 })
        }));
        assert.strictEqual(find(checks, "disclosure.internal-host").status, "warn");
    });
    (0, run_unit_tests_1.test)("an unconfirmed well-known path is not reported as exposed", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            primary: observation({ bodySample: "{}", bodyBytes: 2 }),
            exposedPaths: [{
                    path: "/.env", url: "https://example.test/.env", confirmed: false, signature: "environment-file syntax",
                    observation: observation({ status: 200, bodySample: "<html>app shell</html>", bodyBytes: 22 })
                }]
        }));
        assert.strictEqual(find(checks, "disclosure.wellknown").status, "pass");
    });
    (0, run_unit_tests_1.test)("a confirmed .env is critical", () => {
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            exposedPaths: [{
                    path: "/.env", url: "https://example.test/.env", confirmed: true, signature: "environment-file syntax",
                    observation: observation({ status: 200, bodySample: "DB_PASSWORD=x", bodyBytes: 13 })
                }]
        }));
        assert.strictEqual(checks.find(check => check.id.includes("disclosure.path.")).severity, "critical");
    });
});
(0, run_unit_tests_1.suite)("rate limiting and injection checks", () => {
    (0, run_unit_tests_1.test)("rate-limit headers pass and their absence is only a low warning", () => {
        const withHeaders = (0, security_analysis_1.analyzeRateLimit)(evidence({ primary: observation({ headers: { "ratelimit-limit": "100" } }) }));
        assert.strictEqual(find(withHeaders, "ratelimit.headers").status, "pass");
        const without = (0, security_analysis_1.analyzeRateLimit)(evidence());
        assert.strictEqual(find(without, "ratelimit.headers").severity, "low");
    });
    (0, run_unit_tests_1.test)("a burst that was throttled passes and one that was not warns", () => {
        const limited = (0, security_analysis_1.analyzeRateLimit)(evidence({ burst: { requests: 10, statuses: [200, 429], limited: 1, elapsedMs: 300 } }));
        assert.strictEqual(find(limited, "ratelimit.burst").status, "pass");
        const open = (0, security_analysis_1.analyzeRateLimit)(evidence({ burst: { requests: 10, statuses: [200], limited: 0, elapsedMs: 300 } }));
        assert.strictEqual(find(open, "ratelimit.burst").severity, "medium");
    });
    (0, run_unit_tests_1.test)("unencoded reflection into HTML is a high finding", () => {
        const marker = 'dsq123<>"\'';
        const checks = (0, security_analysis_1.analyzeInjection)(evidence({
            reflection: {
                marker,
                observation: observation({ headers: { "content-type": "text/html" }, bodySample: `<p>${marker}</p>`, bodyBytes: 40 })
            }
        }));
        const check = find(checks, "injection.reflection");
        assert.strictEqual(check.status, "fail");
        assert.strictEqual(check.severity, "high");
    });
    (0, run_unit_tests_1.test)("encoded reflection passes", () => {
        const marker = 'dsq123<>"\'';
        const checks = (0, security_analysis_1.analyzeInjection)(evidence({
            reflection: {
                marker,
                observation: observation({ headers: { "content-type": "text/html" }, bodySample: "<p>dsq123&lt;&gt;&quot;&#39;</p>", bodyBytes: 40 })
            }
        }));
        assert.strictEqual(find(checks, "injection.reflection").status, "pass");
    });
    (0, run_unit_tests_1.test)("input that is not reflected at all passes", () => {
        const checks = (0, security_analysis_1.analyzeInjection)(evidence({
            reflection: { marker: 'dsqabc<>"\'', observation: observation({ bodySample: "{}", bodyBytes: 2 }) }
        }));
        assert.strictEqual(find(checks, "injection.reflection").status, "pass");
    });
});
/* ------------------------------------------------------------------ *
 * Aggregation
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("endpoint report", () => {
    (0, run_unit_tests_1.test)("an unreachable endpoint reports the failure instead of inventing findings", () => {
        const checks = (0, security_analysis_1.analyzeEndpoint)(evidence({
            primary: observation({ status: 0, error: "getaddrinfo ENOTFOUND nope.invalid", errorCode: "ENOTFOUND" })
        }));
        assert.strictEqual(checks.length, 1);
        assert.strictEqual(checks[0].status, "skipped");
        assert.ok(/could not be reached/i.test(checks[0].title));
    });
    (0, run_unit_tests_1.test)("every check id in a report is unique", () => {
        const checks = (0, security_analysis_1.analyzeEndpoint)(evidence({
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
    (0, run_unit_tests_1.test)("every non-pass check carries evidence or a remediation", () => {
        const checks = (0, security_analysis_1.analyzeEndpoint)(evidence({ primary: observation({ headers: { "content-type": "text/html" } }) }));
        for (const check of checks) {
            if (check.status !== "fail" && check.status !== "warn")
                continue;
            assert.ok(check.remediation, `${check.id} has no remediation`);
            assert.ok(check.detail.length > 30, `${check.id} has no useful detail`);
        }
    });
    (0, run_unit_tests_1.test)("passes and informational checks never carry a severity weight", () => {
        const checks = (0, security_analysis_1.analyzeEndpoint)(evidence({
            primary: observation({ headers: { "x-content-type-options": "nosniff", "content-type": "application/json" } })
        }));
        for (const check of checks) {
            if (check.status === "pass" || check.status === "info" || check.status === "skipped") {
                assert.strictEqual(check.severity, "none", `${check.id} should not be weighted`);
            }
        }
    });
    (0, run_unit_tests_1.test)("the summary grades a critical finding as F regardless of score", () => {
        const summary = (0, security_analysis_1.summarize)([
            { id: "a", title: "a", category: "transport", status: "fail", severity: "critical", detail: "x" },
            ...Array.from({ length: 40 }, (_unused, index) => ({
                id: `p${index}`, title: "p", category: "headers", status: "pass", severity: "none", detail: "x"
            }))
        ]);
        assert.strictEqual(summary.grade, "F");
        assert.strictEqual(summary.critical, 1);
        assert.strictEqual(summary.passed, 40);
    });
    (0, run_unit_tests_1.test)("an all-pass report scores A+", () => {
        const summary = (0, security_analysis_1.summarize)([
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
(0, run_unit_tests_1.suite)("static secret filtering", () => {
    (0, run_unit_tests_1.test)("entropy separates a real key from filler", () => {
        assert.ok((0, security_static_1.shannonEntropy)("aaaaaaaaaaaa") < 1);
        assert.ok((0, security_static_1.shannonEntropy)("sk-live-9f8a7b6c5d4e3f2a1b0c") > 3);
    });
    (0, run_unit_tests_1.test)("environment references and placeholders are not treated as secrets", () => {
        for (const value of [
            "process.env.API_KEY", "${DB_PASSWORD}", "<your-api-key>", "{{ secrets.TOKEN }}",
            "changeme", "xxxxxxxxxx", "os.environ['SECRET']", "REPLACE_ME", "password", "", "   "
        ]) {
            assert.ok(!(0, security_static_1.looksLikeSecretValue)(value), `"${value}" must not be reported as a secret`);
        }
    });
    (0, run_unit_tests_1.test)("a high-entropy literal is treated as a secret", () => {
        assert.ok((0, security_static_1.looksLikeSecretValue)('"sk-live-9f8a7b6c5d4e3f2a1b0c"'));
        assert.ok((0, security_static_1.looksLikeSecretValue)("'A7f!k29Lqz03Xm1p'"));
    });
    (0, run_unit_tests_1.test)("comment lines are recognised across syntaxes", () => {
        for (const line of ["// note", "# note", " * note", "/* note", "<!-- note", "-- note"]) {
            assert.ok((0, security_static_1.isCommentLine)(line), `"${line}" should be a comment`);
        }
        assert.ok(!(0, security_static_1.isCommentLine)("const a = 1;"));
    });
    (0, run_unit_tests_1.test)("redaction masks the value but keeps the shape", () => {
        const masked = (0, security_static_1.redactLine)('const key = "AKIA4KPQ7RZT2XW9BVLM";');
        assert.ok(!masked.includes("AKIA4KPQ7RZT2XW9BVLM"));
        assert.ok(masked.includes("•"));
        assert.ok(masked.includes("const key"));
    });
});
(0, run_unit_tests_1.suite)("source rules", () => {
    (0, run_unit_tests_1.test)("a format-matched credential is reported as critical", () => {
        const findings = (0, security_static_1.scanSourceText)("app.js", 'const awsKey = "AKIA4KPQ7RZT2XW9BVLM";');
        const aws = findings.find(finding => finding.rule === "aws-access-key");
        assert.ok(aws, "the AWS rule did not fire");
        assert.strictEqual(aws.severity, "critical");
        assert.ok(!aws.evidence.includes("AKIA4KPQ7RZT2XW9BVLM"));
    });
    (0, run_unit_tests_1.test)("a documented vendor example key is not reported as a leak", () => {
        assert.deepStrictEqual((0, security_static_1.scanSourceText)("README.md", 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')
            .filter(finding => finding.rule === "aws-access-key"), []);
        const checks = (0, security_analysis_1.analyzeDisclosure)(evidence({
            primary: observation({ bodySample: '{"key":"AKIAIOSFODNN7EXAMPLE"}', bodyBytes: 30 })
        }));
        assert.strictEqual(find(checks, "disclosure.secret").status, "pass");
    });
    (0, run_unit_tests_1.test)("a value referenced from a variable is not a hard-coded credential", () => {
        const findings = (0, security_static_1.scanSourceText)("api.ts", [
            "  const resolvedPassword = decrypt(stored);",
            "  auth = { username: resolvedUser, password: resolvedPassword };",
            "  return { apiKey: options.apiKey, clientSecret: options.clientSecret };",
            "  auth?: { username: string; password: string };",
            "  result.password = index > -1 ? credential.slice(index + 1) : '';"
        ].join("\n"));
        assert.deepStrictEqual(findings.filter(finding => finding.rule === "generic-secret"), []);
    });
    (0, run_unit_tests_1.test)("an unquoted value in an env file is still a credential", () => {
        const findings = (0, security_static_1.scanSourceText)(".env", "DB_PASSWORD=T9xqL2mZr8wK4p");
        assert.ok(findings.some(finding => finding.rule === "generic-secret"));
    });
    (0, run_unit_tests_1.test)("a constant string assigned to innerHTML is not an injection sink", () => {
        assert.deepStrictEqual((0, security_static_1.scanSourceText)("ui.ts", "output.innerHTML = '<div class=\"empty\">Enter a pattern</div>';")
            .filter(finding => finding.rule === "dom-xss-sink"), []);
        assert.ok((0, security_static_1.scanSourceText)("ui.ts", "output.innerHTML = '<div>' + name + '</div>';")
            .some(finding => finding.rule === "dom-xss-sink"));
    });
    (0, run_unit_tests_1.test)("the English word \"select\" in a UI string is not SQL", () => {
        assert.deepStrictEqual((0, security_static_1.scanSourceText)("ui.ts", 'const row = `<td aria-label="Select log in ${file} at line ${line}">`;')
            .filter(finding => finding.rule === "sql-string-concat"), []);
    });
    (0, run_unit_tests_1.test)("a cookie flag disabled outside cookie context is not reported", () => {
        assert.deepStrictEqual((0, security_static_1.scanSourceText)("model.ts", "  const cookie = { name, secure: false, httpOnly: false };")
            .filter(finding => finding.rule === "insecure-cookie-config").length > 0, true);
        assert.deepStrictEqual((0, security_static_1.scanSourceText)("model.ts", "  const options = { secure: false };")
            .filter(finding => finding.rule === "insecure-cookie-config"), []);
    });
    (0, run_unit_tests_1.test)("prose ending in a bare scheme is not a plain-HTTP endpoint", () => {
        assert.deepStrictEqual((0, security_static_1.scanSourceText)("a.ts", 'const note = `${count} references use http://. Fix them.`;')
            .filter(finding => finding.rule === "insecure-http"), []);
    });
    (0, run_unit_tests_1.test)("an environment reference does not produce a secret finding", () => {
        const findings = (0, security_static_1.scanSourceText)("config.ts", [
            "const apiKey = process.env.API_KEY;",
            'const password = "";',
            "const token = config.token;",
            'const secret = "<your-secret-here>";'
        ].join("\n"));
        assert.deepStrictEqual(findings.filter(finding => finding.rule === "generic-secret"), []);
    });
    (0, run_unit_tests_1.test)("a hard-coded credential is reported", () => {
        const findings = (0, security_static_1.scanSourceText)("config.ts", 'const apiKey = "sk-live-9f8a7b6c5d4e3f2a1b0c";');
        assert.ok(findings.some(finding => finding.rule === "generic-secret"));
    });
    (0, run_unit_tests_1.test)("eval fires but a method named eval does not", () => {
        assert.ok((0, security_static_1.scanSourceText)("a.js", "eval(userInput);").some(finding => finding.rule === "unsafe-eval"));
        assert.ok(!(0, security_static_1.scanSourceText)("a.py", "model.eval()").some(finding => finding.rule === "unsafe-eval"));
        assert.ok(!(0, security_static_1.scanSourceText)("a.js", "const x = evaluate(input);").some(finding => finding.rule === "unsafe-eval"));
    });
    (0, run_unit_tests_1.test)("XML namespaces and licence URLs do not trigger the plain-HTTP rule", () => {
        const noise = (0, security_static_1.scanSourceText)("pom.xml", [
            '<project xmlns="http://maven.apache.org/POM/4.0.0">',
            '<url>http://www.apache.org/licenses/LICENSE-2.0</url>',
            'const local = "http://localhost:3000";'
        ].join("\n"));
        assert.deepStrictEqual(noise.filter(finding => finding.rule === "insecure-http"), []);
        assert.ok((0, security_static_1.scanSourceText)("a.js", 'fetch("http://tracker.example.com/collect");')
            .some(finding => finding.rule === "insecure-http"));
    });
    (0, run_unit_tests_1.test)("SQL string concatenation and disabled TLS verification are caught", () => {
        assert.ok((0, security_static_1.scanSourceText)("db.ts", "const q = `SELECT * FROM users WHERE id = ${id}`;")
            .some(finding => finding.rule === "sql-string-concat"));
        assert.ok((0, security_static_1.scanSourceText)("http.ts", "const agent = new https.Agent({ rejectUnauthorized: false });")
            .some(finding => finding.rule === "tls-verification-disabled"));
        assert.ok((0, security_static_1.scanSourceText)("client.py", "requests.get(url, verify=False)")
            .some(finding => finding.rule === "tls-verification-disabled"));
    });
    (0, run_unit_tests_1.test)("DOM XSS sinks are caught but clearing innerHTML is not", () => {
        assert.ok((0, security_static_1.scanSourceText)("ui.ts", "node.innerHTML = userInput;").some(finding => finding.rule === "dom-xss-sink"));
        assert.ok(!(0, security_static_1.scanSourceText)("ui.ts", 'node.innerHTML = "";').some(finding => finding.rule === "dom-xss-sink"));
    });
    (0, run_unit_tests_1.test)("workflow rules only apply inside .github/workflows", () => {
        const line = "  - uses: some-org/some-action@v1";
        assert.ok((0, security_static_1.scanSourceText)(".github/workflows/ci.yml", line).some(finding => finding.rule === "unpinned-ci-action"));
        assert.ok(!(0, security_static_1.scanSourceText)("docs/example.yml", line).some(finding => finding.rule === "unpinned-ci-action"));
        assert.ok(!(0, security_static_1.scanSourceText)(".github/workflows/ci.yml", "  - uses: some-org/some-action@" + "a".repeat(40))
            .some(finding => finding.rule === "unpinned-ci-action"));
    });
    (0, run_unit_tests_1.test)("workflow script injection is caught", () => {
        assert.ok((0, security_static_1.scanSourceText)(".github/workflows/ci.yml", '        run: echo "${{ github.event.pull_request.title }}"')
            .some(finding => finding.rule === "ci-script-injection"));
    });
    (0, run_unit_tests_1.test)("every finding carries a line, a remediation and a masked evidence line", () => {
        const findings = (0, security_static_1.scanSourceText)("app.js", [
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
    (0, run_unit_tests_1.test)("scanning the same text twice is stable", () => {
        const text = 'const apiKey = "sk-live-9f8a7b6c5d4e3f2a1b0c";\neval(x);';
        assert.strictEqual((0, security_static_1.scanSourceText)("a.js", text).length, (0, security_static_1.scanSourceText)("a.js", text).length);
    });
});
(0, run_unit_tests_1.suite)("cloud rules", () => {
    (0, run_unit_tests_1.test)("Terraform and Kubernetes risks are detected", () => {
        const terraform = (0, security_static_1.scanCloudText)("infra.tf", [
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
    (0, run_unit_tests_1.test)("container risks are detected", () => {
        const manifest = (0, security_static_1.scanCloudText)("deploy.yaml", [
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
    (0, run_unit_tests_1.test)("a secret reference is not reported as an embedded credential", () => {
        const findings = (0, security_static_1.scanCloudText)("deploy.yaml", [
            "        - name: DB_PASSWORD",
            "          valueFrom:",
            "            secretKeyRef: { name: db, key: password }",
            "      token: ${{ secrets.GITHUB_TOKEN }}"
        ].join("\n"));
        assert.deepStrictEqual(findings.filter(finding => finding.rule === "cloud-secret-value"), []);
    });
    (0, run_unit_tests_1.test)("an embedded credential in a manifest is critical", () => {
        const findings = (0, security_static_1.scanCloudText)("compose.yml", '      POSTGRES_PASSWORD: "T9x!qL2mZr8w"');
        const secret = findings.find(finding => finding.rule === "cloud-secret-value");
        assert.ok(secret, "the embedded-credential rule did not fire");
        assert.strictEqual(secret.severity, "critical");
    });
    (0, run_unit_tests_1.test)("an egress rule to the internet is not flagged as open ingress", () => {
        const findings = (0, security_static_1.scanCloudText)("infra.tf", '  egress_cidr_blocks = ["0.0.0.0/0"]');
        assert.deepStrictEqual(findings.filter(finding => finding.rule === "public-network-ingress"), []);
    });
});
(0, run_unit_tests_1.suite)("workspace posture checks", () => {
    const manifest = (extra = {}) => JSON.stringify({
        name: "demo", version: "1.0.0", dependencies: { axios: "^1.8.3" }, engines: { node: ">=20" }, ...extra
    });
    (0, run_unit_tests_1.test)("a missing lockfile fails and a present one passes", () => {
        const without = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest()]]));
        assert.strictEqual(find(without, "deps.lockfile").status, "fail");
        const with_ = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest()], ["package-lock.json", "{}"]]));
        assert.strictEqual(find(with_, "deps.lockfile").status, "pass");
    });
    (0, run_unit_tests_1.test)("an unbounded version range is reported", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest({ dependencies: { lodash: "*" } })]]));
        assert.strictEqual(find(checks, "deps.floating").status, "warn");
    });
    (0, run_unit_tests_1.test)("an abandoned package is named with the reason", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest({ dependencies: { request: "^2.88.0" } })]]));
        const check = find(checks, "deps.discouraged");
        assert.strictEqual(check.status, "warn");
        assert.ok(check.detail.includes("request"));
    });
    (0, run_unit_tests_1.test)("a registry token in .npmrc is critical", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([
            ["package.json", manifest()],
            [".npmrc", "//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789"]
        ]));
        assert.strictEqual(find(checks, "config.npmrc-token").severity, "critical");
    });
    (0, run_unit_tests_1.test)("a templated .npmrc token is not reported", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([
            ["package.json", manifest()],
            [".npmrc", "//registry.npmjs.org/:_authToken=${NPM_TOKEN}"]
        ]));
        assert.strictEqual(find(checks, "config.npmrc-token"), undefined);
    });
    (0, run_unit_tests_1.test)("an unignored .env file is a high failure", () => {
        const missing = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest()], [".env", "A=1"], [".gitignore", "node_modules\n"]]));
        const check = find(missing, "config.env-ignored");
        assert.strictEqual(check.status, "fail");
        assert.strictEqual(check.severity, "high");
        const ignored = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest()], [".env", "A=1"], [".gitignore", "node_modules\n.env\n"]]));
        assert.strictEqual(find(ignored, "config.env-ignored").status, "pass");
    });
    (0, run_unit_tests_1.test)("a .env.example alone does not trigger the env check", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", manifest()], [".env.example", "A="]]));
        assert.strictEqual(find(checks, "config.env-ignored"), undefined);
    });
    (0, run_unit_tests_1.test)("CI scanning and token permissions are graded from the workflows", () => {
        const bare = (0, security_static_1.analyzeWorkspacePosture)(new Map([
            ["package.json", manifest()],
            [".github/workflows/ci.yml", "on: push\njobs:\n  build:\n    steps:\n      - run: npm test\n"]
        ]));
        assert.strictEqual(find(bare, "config.ci-scanning").status, "warn");
        assert.strictEqual(find(bare, "config.ci-permissions").status, "warn");
        const hardened = (0, security_static_1.analyzeWorkspacePosture)(new Map([
            ["package.json", manifest()],
            [".github/workflows/ci.yml", "on: push\npermissions:\n  contents: read\njobs:\n  scan:\n    steps:\n      - uses: github/codeql-action/analyze@v3\n"]
        ]));
        assert.strictEqual(find(hardened, "config.ci-scanning").status, "pass");
        assert.strictEqual(find(hardened, "config.ci-permissions").status, "pass");
    });
    (0, run_unit_tests_1.test)("an npm script that pipes a download into a shell is a high failure", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([
            ["package.json", manifest({ scripts: { setup: "curl -sL https://example.test/i.sh | sh" } })]
        ]));
        assert.strictEqual(find(checks, "deps.dangerous-script").severity, "high");
    });
    (0, run_unit_tests_1.test)("unpinned Python requirements are reported and pinned ones pass", () => {
        const loose = (0, security_static_1.analyzeWorkspacePosture)(new Map([["requirements.txt", "flask\nrequests\n"]]));
        assert.strictEqual(find(loose, "deps.pip-unpinned").status, "warn");
        const pinned = (0, security_static_1.analyzeWorkspacePosture)(new Map([["requirements.txt", "flask==3.0.0\nrequests==2.32.3\n"]]));
        assert.strictEqual(find(pinned, "deps.pip-unpinned").status, "pass");
    });
    (0, run_unit_tests_1.test)("a malformed manifest is reported rather than crashing the scan", () => {
        const checks = (0, security_static_1.analyzeWorkspacePosture)(new Map([["package.json", "{ not json"]]));
        assert.strictEqual(find(checks, "deps.manifest-parse").status, "warn");
    });
});
//# sourceMappingURL=security.unit.js.map