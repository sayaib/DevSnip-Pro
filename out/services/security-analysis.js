"use strict";
/**
 * The security verdict engine.
 *
 * Every function here is pure: it takes evidence that was already collected
 * (headers, a body sample, a TLS handshake summary) and returns verdicts. No
 * network, no filesystem, no `vscode` import - which is what lets the whole
 * rule set be unit-tested in a plain Node process.
 *
 * Two rules hold throughout:
 *
 *  1. A check only reports what the evidence actually shows. When the evidence
 *     needed for a check was not collected, the check is `skipped` with the
 *     reason - it is never quietly reported as a pass.
 *  2. Every non-pass verdict carries the observed value it was based on and a
 *     concrete remediation, so a result is always actionable and auditable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeEndpoint = exports.analyzeInjection = exports.buildReflectionMarker = exports.analyzeRateLimit = exports.analyzeApiSecurity = exports.analyzeDisclosure = exports.isDocumentedExampleCredential = exports.SECRET_PATTERNS = exports.analyzeAuth = exports.decodeJwt = exports.analyzeCors = exports.analyzeCookies = exports.parseSetCookie = exports.analyzeCsp = exports.parseCsp = exports.analyzeSecurityHeaders = exports.analyzeHsts = exports.parseHsts = exports.analyzeTransport = exports.sortChecks = exports.summarize = exports.SEVERITY_ORDER = exports.setCookieList = exports.normalizeHeaders = exports.CATEGORY_LABELS = void 0;
exports.CATEGORY_LABELS = {
    transport: "HTTPS & TLS",
    headers: "Security Headers",
    csp: "Content Security Policy",
    cors: "CORS Configuration",
    cookies: "Cookie Security",
    auth: "Authentication & Authorization",
    api: "API Security",
    disclosure: "Sensitive Information Exposure",
    vulnerability: "Common Vulnerabilities",
    "rate-limit": "Rate Limiting & Abuse Protection",
    injection: "Input Validation & Injection",
    dependencies: "Dependencies",
    configuration: "Security Configuration"
};
/** Lower-cases every header name and flattens the values axios hands back. */
function normalizeHeaders(raw) {
    const out = {};
    if (!raw || typeof raw !== "object")
        return out;
    for (const [key, value] of Object.entries(raw)) {
        if (value === undefined || value === null)
            continue;
        const name = String(key).toLowerCase().trim();
        if (!name)
            continue;
        out[name] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    return out;
}
exports.normalizeHeaders = normalizeHeaders;
/** Set-Cookie is the one header that must stay a list. */
function setCookieList(raw) {
    if (!raw || typeof raw !== "object")
        return [];
    for (const [key, value] of Object.entries(raw)) {
        if (String(key).toLowerCase() !== "set-cookie")
            continue;
        if (Array.isArray(value))
            return value.map(entry => String(entry)).filter(Boolean);
        if (typeof value === "string" && value.trim())
            return [value];
    }
    return [];
}
exports.setCookieList = setCookieList;
function truncate(value, max = 220) {
    const collapsed = String(value).replace(/\s+/g, " ").trim();
    return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
function make(id, category, title, status, severity, detail, extra = {}) {
    return {
        id,
        title,
        category,
        status,
        // A pass or an informational note never carries a severity weight.
        severity: status === "pass" || status === "info" || status === "skipped" ? "none" : severity,
        detail,
        ...(extra.evidence ? { evidence: truncate(extra.evidence, 400) } : {}),
        ...(extra.remediation ? { remediation: extra.remediation } : {}),
        ...(extra.reference ? { reference: extra.reference } : {}),
        ...(extra.target ? { target: extra.target } : {})
    };
}
/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */
const SEVERITY_WEIGHT = {
    critical: 25,
    high: 12,
    medium: 5,
    low: 1.5,
    none: 0
};
exports.SEVERITY_ORDER = ["critical", "high", "medium", "low", "none"];
/** Aggregates a run into counts, a 0-100 score and a letter grade. */
function summarize(checks) {
    const summary = {
        total: checks.length,
        passed: 0, warnings: 0, failed: 0, info: 0, skipped: 0,
        critical: 0, high: 0, medium: 0, low: 0,
        score: 0, grade: "N/A"
    };
    let penalty = 0;
    let graded = 0;
    for (const check of checks) {
        if (check.status === "pass") {
            summary.passed++;
            graded++;
        }
        else if (check.status === "warn") {
            summary.warnings++;
            graded++;
        }
        else if (check.status === "fail") {
            summary.failed++;
            graded++;
        }
        else if (check.status === "info") {
            summary.info++;
        }
        else {
            summary.skipped++;
        }
        if (check.status === "warn" || check.status === "fail") {
            if (check.severity === "critical")
                summary.critical++;
            else if (check.severity === "high")
                summary.high++;
            else if (check.severity === "medium")
                summary.medium++;
            else if (check.severity === "low")
                summary.low++;
            penalty += SEVERITY_WEIGHT[check.severity];
        }
    }
    if (!graded) {
        summary.score = 0;
        summary.grade = "N/A";
        return summary;
    }
    summary.score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    summary.grade =
        summary.critical > 0 ? "F"
            : summary.score >= 95 ? "A+"
                : summary.score >= 85 ? "A"
                    : summary.score >= 70 ? "B"
                        : summary.score >= 55 ? "C"
                            : summary.score >= 35 ? "D"
                                : "F";
    return summary;
}
exports.summarize = summarize;
/** Orders a result list the way it should be read: worst first, passes last. */
function sortChecks(checks) {
    const statusRank = { fail: 0, warn: 1, info: 2, skipped: 3, pass: 4 };
    return [...checks].sort((a, b) => {
        if (statusRank[a.status] !== statusRank[b.status])
            return statusRank[a.status] - statusRank[b.status];
        const severityDelta = exports.SEVERITY_ORDER.indexOf(a.severity) - exports.SEVERITY_ORDER.indexOf(b.severity);
        if (severityDelta !== 0)
            return severityDelta;
        return a.title.localeCompare(b.title);
    });
}
exports.sortChecks = sortChecks;
const OWASP = {
    headers: "OWASP Secure Headers Project",
    a01: "OWASP Top 10 A01: Broken Access Control",
    a02: "OWASP Top 10 A02: Cryptographic Failures",
    a03: "OWASP Top 10 A03: Injection",
    a04: "OWASP Top 10 A04: Insecure Design",
    a05: "OWASP Top 10 A05: Security Misconfiguration",
    a06: "OWASP Top 10 A06: Vulnerable and Outdated Components",
    a07: "OWASP Top 10 A07: Identification and Authentication Failures",
    a09: "OWASP Top 10 A09: Security Logging and Monitoring Failures",
    api4: "OWASP API Top 10 API4: Unrestricted Resource Consumption",
    api7: "OWASP API Top 10 API7: Server Side Request Forgery / Misconfiguration",
    api8: "OWASP API Top 10 API8: Security Misconfiguration"
};
function isHttps(url) {
    return /^https:/i.test(url.trim());
}
function hostOf(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return "";
    }
}
/** True for a response that actually carries a document a browser renders. */
function isHtmlResponse(headers, body) {
    const type = (headers["content-type"] || "").toLowerCase();
    if (type.includes("text/html") || type.includes("application/xhtml"))
        return true;
    if (type)
        return false;
    return /<html[\s>]|<!doctype html/i.test(body.slice(0, 2000));
}
/* ------------------------------------------------------------------ *
 * HTTPS / TLS
 * ------------------------------------------------------------------ */
function analyzeTransport(evidence) {
    const checks = [];
    const { url, tls, plainHttp } = evidence;
    const secure = isHttps(url);
    const host = hostOf(url);
    const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(host);
    if (secure) {
        checks.push(make("transport.scheme", "transport", "Endpoint is served over HTTPS", "pass", "none", "The scanned URL uses https, so the request and response are encrypted in transit.", { target: url, reference: OWASP.a02 }));
    }
    else if (local) {
        checks.push(make("transport.scheme", "transport", "Endpoint uses plain HTTP (local host)", "info", "none", "The target is a loopback address, where plain HTTP does not expose traffic to the network. Production hosts still need TLS.", { target: url, reference: OWASP.a02 }));
    }
    else {
        checks.push(make("transport.scheme", "transport", "Endpoint is served over plain HTTP", "fail", "critical", "Traffic to this endpoint is unencrypted. Anyone on the network path can read and modify requests, responses, cookies and credentials.", {
            target: url,
            evidence: url,
            remediation: "Serve the endpoint over HTTPS with a valid certificate and redirect every HTTP request to the HTTPS equivalent with a 301.",
            reference: OWASP.a02
        }));
    }
    // HTTP -> HTTPS redirect, only meaningful for a public HTTPS host.
    if (!secure || local) {
        checks.push(make("transport.redirect", "transport", "HTTP to HTTPS redirect", "skipped", "none", local ? "Not checked for a loopback address." : "Not checked: the scanned URL is already plain HTTP.", { target: url }));
    }
    else if (!plainHttp) {
        checks.push(make("transport.redirect", "transport", "HTTP to HTTPS redirect", "skipped", "none", "The plain-HTTP probe did not run, so the redirect could not be confirmed.", { target: url }));
    }
    else if (plainHttp.error) {
        const refused = /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ENOTFOUND|ECONNRESET/i.test(plainHttp.errorCode || plainHttp.error);
        checks.push(make("transport.redirect", "transport", "Plain HTTP port is closed", refused ? "pass" : "info", "none", refused
            ? "The host does not answer on plain HTTP, so there is no unencrypted entry point to downgrade to."
            : `The plain-HTTP probe could not complete: ${plainHttp.error}`, { target: `http://${host}`, evidence: plainHttp.error }));
    }
    else if (plainHttp.status >= 300 && plainHttp.status < 400) {
        const location = plainHttp.headers["location"] || "";
        const toHttps = /^https:/i.test(location) || (location.startsWith("//") && false);
        checks.push(make("transport.redirect", "transport", toHttps ? "HTTP redirects to HTTPS" : "HTTP redirects, but not to HTTPS", toHttps ? "pass" : "fail", toHttps ? "none" : "high", toHttps
            ? `Plain HTTP answers ${plainHttp.status} and sends the client to the HTTPS URL.`
            : `Plain HTTP answers ${plainHttp.status} but the Location header does not point at an https URL, so the downgrade is not closed.`, {
            target: `http://${host}`,
            evidence: `HTTP ${plainHttp.status} · Location: ${location || "(absent)"}`,
            ...(toHttps ? {} : { remediation: "Redirect every plain-HTTP request to the same path on https with a 301 before any application handler runs." }),
            reference: OWASP.a02
        }));
    }
    else if (plainHttp.status > 0) {
        checks.push(make("transport.redirect", "transport", "Plain HTTP is served without redirecting", "fail", "high", `The host answered HTTP ${plainHttp.status} over plain HTTP instead of redirecting to HTTPS. A client that starts on http:// stays unencrypted.`, {
            target: `http://${host}`,
            evidence: `HTTP ${plainHttp.status} with no redirect`,
            remediation: "Return a 301 to the https URL for every plain-HTTP request, then enable HSTS so browsers stop trying http at all.",
            reference: OWASP.a02
        }));
    }
    // Certificate and protocol.
    if (!secure) {
        checks.push(make("transport.tls", "transport", "TLS certificate and protocol", "skipped", "none", "Not checked: the endpoint is not served over HTTPS.", { target: url }));
        return checks;
    }
    if (!tls || tls.error) {
        checks.push(make("transport.tls", "transport", "TLS certificate and protocol", "skipped", "none", `The TLS handshake summary is unavailable${tls?.error ? `: ${tls.error}` : "."}`, { target: url, evidence: tls?.error }));
        return checks;
    }
    if (!tls.authorized && tls.authorizationError) {
        const code = tls.authorizationError;
        const hostnameMismatch = /ALTNAME/i.test(code);
        checks.push(make("transport.cert.trust", "transport", hostnameMismatch ? "Certificate does not match the hostname" : "Certificate chain is not trusted", "fail", "critical", hostnameMismatch
            ? "The certificate presented is not valid for this hostname, so browsers will block the connection and any client that continues is not authenticating the server."
            : `The certificate chain failed validation (${code}). Clients cannot verify they are talking to the real server, which makes the connection vulnerable to interception.`, {
            target: url,
            evidence: code,
            remediation: hostnameMismatch
                ? "Issue a certificate whose subject alternative names cover this hostname, or serve the host from a certificate that already lists it."
                : "Install the complete certificate chain (leaf plus intermediates) from a publicly trusted CA, and renew it before expiry.",
            reference: OWASP.a02
        }));
    }
    else {
        checks.push(make("transport.cert.trust", "transport", "Certificate chain is trusted", "pass", "none", `The certificate validated against the system trust store${tls.issuer ? ` (issuer: ${tls.issuer})` : ""}.`, { target: url, evidence: tls.subject }));
    }
    if (typeof tls.daysUntilExpiry === "number") {
        const days = tls.daysUntilExpiry;
        const status = days < 0 ? "fail" : days < 15 ? "fail" : days < 30 ? "warn" : "pass";
        const severity = days < 0 ? "critical" : days < 15 ? "high" : days < 30 ? "medium" : "none";
        checks.push(make("transport.cert.expiry", "transport", days < 0 ? "Certificate has expired" : days < 30 ? "Certificate expires soon" : "Certificate validity is healthy", status, severity, days < 0
            ? `The certificate expired ${Math.abs(days)} day(s) ago. Clients are already being shown a security warning.`
            : `The certificate expires in ${days} day(s)${days < 30 ? ", which is inside the window where a renewal failure becomes an outage." : "."}`, {
            target: url,
            evidence: tls.validTo ? `Not after: ${tls.validTo}` : undefined,
            ...(days < 30 ? { remediation: "Renew the certificate now and automate renewal (ACME/certbot or your platform's managed certificate) with alerting at 30 days." } : {}),
            reference: OWASP.a02
        }));
    }
    if (tls.protocol) {
        const weak = /TLSv1(\.[01])?$/i.test(tls.protocol) || /SSLv[23]/i.test(tls.protocol);
        checks.push(make("transport.protocol", "transport", weak ? "Weak TLS protocol version negotiated" : "Modern TLS protocol version negotiated", weak ? "fail" : "pass", weak ? "high" : "none", weak
            ? `The handshake negotiated ${tls.protocol}, which is deprecated, no longer receives security fixes, and is rejected by current browsers.`
            : `The handshake negotiated ${tls.protocol}.`, {
            target: url,
            evidence: `${tls.protocol}${tls.cipher ? ` · ${tls.cipher}` : ""}`,
            ...(weak ? { remediation: "Disable TLS 1.0/1.1 and SSL entirely; require TLS 1.2 as a minimum and prefer TLS 1.3." } : {}),
            reference: OWASP.a02
        }));
    }
    if (tls.cipher && /RC4|3DES|DES-|NULL|EXPORT|MD5/i.test(tls.cipher)) {
        checks.push(make("transport.cipher", "transport", "Weak cipher suite negotiated", "fail", "high", `The connection negotiated ${tls.cipher}, which uses a broken or deprecated primitive.`, {
            target: url,
            evidence: tls.cipher,
            remediation: "Restrict the cipher list to modern AEAD suites (AES-GCM or ChaCha20-Poly1305) with forward secrecy.",
            reference: OWASP.a02
        }));
    }
    // Key strength is only comparable within a key type: a 256-bit ECDSA key is
    // stronger than a 2048-bit RSA one, so a single numeric floor would report
    // every modern EC certificate as weak.
    if (typeof tls.keyBits === "number" && tls.keyBits > 0) {
        const elliptic = !!tls.keyCurve;
        const minimum = elliptic ? 224 : 2048;
        if (tls.keyBits < minimum) {
            checks.push(make("transport.keysize", "transport", "Certificate key is below the modern minimum", "fail", "high", elliptic
                ? `The certificate uses a ${tls.keyBits}-bit ${tls.keyCurve} key, below the 224-bit minimum for elliptic-curve certificates.`
                : `The certificate uses a ${tls.keyBits}-bit RSA key, below the 2048-bit minimum required by current CA/Browser Forum rules.`, {
                target: url,
                evidence: `${tls.keyBits}-bit ${elliptic ? tls.keyCurve : "RSA"} key`,
                remediation: "Re-issue the certificate with a 2048-bit (or larger) RSA key, or an ECDSA P-256 key.",
                reference: OWASP.a02
            }));
        }
        else {
            checks.push(make("transport.keysize", "transport", "Certificate key strength is adequate", "pass", "none", `The certificate uses a ${tls.keyBits}-bit ${elliptic ? `${tls.keyCurve} elliptic-curve` : "RSA"} key.`, { target: url, evidence: `${tls.keyBits}-bit ${elliptic ? tls.keyCurve : "RSA"} key` }));
        }
    }
    return checks;
}
exports.analyzeTransport = analyzeTransport;
/** Parses Strict-Transport-Security per RFC 6797 section 6.1. */
function parseHsts(value) {
    if (!value || !value.trim())
        return { present: false, includeSubDomains: false, preload: false };
    const raw = value.trim();
    const directives = raw.split(";").map(part => part.trim()).filter(Boolean);
    const policy = { present: true, includeSubDomains: false, preload: false, raw };
    for (const directive of directives) {
        const [name, ...rest] = directive.split("=");
        const key = name.trim().toLowerCase();
        if (key === "max-age") {
            // The value may be quoted; RFC 6797 allows a quoted-string.
            const parsed = Number(rest.join("=").trim().replace(/^"|"$/g, ""));
            if (Number.isFinite(parsed) && parsed >= 0)
                policy.maxAge = parsed;
        }
        else if (key === "includesubdomains") {
            policy.includeSubDomains = true;
        }
        else if (key === "preload") {
            policy.preload = true;
        }
    }
    return policy;
}
exports.parseHsts = parseHsts;
const ONE_YEAR = 31536000;
const SIX_MONTHS = 15768000;
function analyzeHsts(evidence) {
    const { url, primary } = evidence;
    const header = primary.headers["strict-transport-security"];
    const policy = parseHsts(header);
    const host = hostOf(url);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
    if (!isHttps(url)) {
        return [make("hsts.present", "transport", "HTTP Strict Transport Security", "skipped", "none", "Browsers ignore Strict-Transport-Security on a plain-HTTP response, so the header cannot be assessed until the endpoint is served over HTTPS.", { target: url, reference: "RFC 6797" })];
    }
    if (!policy.present) {
        return [make("hsts.present", "transport", "Strict-Transport-Security header is missing", local ? "warn" : "fail", local ? "low" : "high", "Without HSTS a browser will still try plain HTTP for the first request of a session, which leaves a window for an SSL-stripping downgrade on a hostile network.", {
                target: url,
                evidence: "Strict-Transport-Security: (absent)",
                remediation: "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` on every HTTPS response, after confirming every subdomain can serve HTTPS.",
                reference: "RFC 6797 · " + OWASP.a02
            })];
    }
    const checks = [];
    const maxAge = policy.maxAge ?? 0;
    if (policy.maxAge === undefined) {
        checks.push(make("hsts.maxage", "transport", "HSTS is present but has no max-age", "fail", "high", "A Strict-Transport-Security header without a max-age directive is invalid and is ignored entirely by browsers.", {
            target: url, evidence: policy.raw,
            remediation: "Add `max-age=31536000` to the header.",
            reference: "RFC 6797"
        }));
    }
    else if (maxAge === 0) {
        checks.push(make("hsts.maxage", "transport", "HSTS is explicitly disabled (max-age=0)", "fail", "high", "max-age=0 tells browsers to forget the HSTS policy for this host, which removes the downgrade protection entirely.", {
            target: url, evidence: policy.raw,
            remediation: "Set `max-age=31536000` once you are confident every subdomain serves HTTPS correctly.",
            reference: "RFC 6797"
        }));
    }
    else if (maxAge < SIX_MONTHS) {
        checks.push(make("hsts.maxage", "transport", "HSTS max-age is short", "warn", "medium", `max-age is ${maxAge} seconds (about ${Math.round(maxAge / 86400)} days). A short window means a client that has not visited recently is unprotected again.`, {
            target: url, evidence: policy.raw,
            remediation: "Raise max-age to at least 15768000 (six months); 31536000 (one year) is the usual target.",
            reference: "RFC 6797"
        }));
    }
    else if (maxAge < ONE_YEAR) {
        checks.push(make("hsts.maxage", "transport", "HSTS max-age is below the one-year target", "warn", "low", `max-age is ${maxAge} seconds (about ${Math.round(maxAge / 86400)} days). One year is the value required for preload-list eligibility.`, {
            target: url, evidence: policy.raw,
            remediation: "Raise max-age to 31536000.",
            reference: "RFC 6797"
        }));
    }
    else {
        checks.push(make("hsts.maxage", "transport", "HSTS max-age meets the one-year target", "pass", "none", `max-age is ${maxAge} seconds (about ${Math.round(maxAge / 86400)} days).`, { target: url, evidence: policy.raw, reference: "RFC 6797" }));
    }
    checks.push(policy.includeSubDomains
        ? make("hsts.subdomains", "transport", "HSTS covers subdomains", "pass", "none", "includeSubDomains is set, so the policy protects every subdomain of this host.", { target: url, evidence: policy.raw })
        : make("hsts.subdomains", "transport", "HSTS does not cover subdomains", "warn", "low", "Without includeSubDomains, a subdomain served over plain HTTP can still be used to set or read cookies scoped to the parent domain.", {
            target: url, evidence: policy.raw,
            remediation: "Add `includeSubDomains` once every subdomain serves HTTPS, including internal and staging names.",
            reference: "RFC 6797"
        }));
    if (policy.preload && (maxAge < ONE_YEAR || !policy.includeSubDomains)) {
        checks.push(make("hsts.preload", "transport", "HSTS preload directive is not actually eligible", "warn", "low", "The preload directive is present, but the policy does not meet the preload-list requirements (max-age of at least one year plus includeSubDomains), so submission would be rejected.", {
            target: url, evidence: policy.raw,
            remediation: "Set `max-age=31536000; includeSubDomains; preload`, then submit the domain at hstspreload.org.",
            reference: "hstspreload.org"
        }));
    }
    else if (policy.preload) {
        checks.push(make("hsts.preload", "transport", "HSTS is preload-eligible", "pass", "none", "The policy meets the requirements for the browser preload list.", { target: url, evidence: policy.raw }));
    }
    else {
        checks.push(make("hsts.preload", "transport", "HSTS preload is not requested", "info", "none", "The preload directive is absent. Preloading removes the first-visit gap entirely, but it is hard to reverse, so it is a deliberate choice rather than a default.", { target: url, evidence: policy.raw, reference: "hstspreload.org" }));
    }
    return checks;
}
exports.analyzeHsts = analyzeHsts;
/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */
function analyzeSecurityHeaders(evidence) {
    const { url, primary } = evidence;
    const headers = primary.headers;
    const checks = [];
    const html = isHtmlResponse(headers, primary.bodySample);
    const csp = headers["content-security-policy"] || "";
    // X-Content-Type-Options
    const nosniff = (headers["x-content-type-options"] || "").toLowerCase().trim();
    checks.push(nosniff === "nosniff"
        ? make("headers.nosniff", "headers", "X-Content-Type-Options is set to nosniff", "pass", "none", "Browsers will not second-guess the declared Content-Type, which closes MIME-confusion attacks.", { target: url, evidence: `X-Content-Type-Options: ${nosniff}` })
        : make("headers.nosniff", "headers", nosniff ? "X-Content-Type-Options has an invalid value" : "X-Content-Type-Options header is missing", "fail", "medium", nosniff
            ? `The only valid value is \`nosniff\`; \`${nosniff}\` is ignored, so MIME sniffing stays enabled.`
            : "Without this header a browser may sniff a response and execute it as a different type than declared - for example running an uploaded file as script.", {
            target: url,
            evidence: nosniff ? `X-Content-Type-Options: ${nosniff}` : "X-Content-Type-Options: (absent)",
            remediation: "Send `X-Content-Type-Options: nosniff` on every response.",
            reference: OWASP.headers
        }));
    // Clickjacking: X-Frame-Options or CSP frame-ancestors
    const xfo = (headers["x-frame-options"] || "").toUpperCase().trim();
    const frameAncestors = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(csp);
    const ancestorsValue = frameAncestors ? frameAncestors[1].trim() : "";
    const ancestorsRestrictive = !!ancestorsValue && !/(^|\s)\*(\s|$)/.test(ancestorsValue);
    if (ancestorsRestrictive) {
        checks.push(make("headers.clickjacking", "headers", "Framing is restricted by CSP frame-ancestors", "pass", "none", `frame-ancestors is set to \`${ancestorsValue}\`, which is the modern, standards-track way to block clickjacking.`, { target: url, evidence: `Content-Security-Policy: frame-ancestors ${ancestorsValue}` }));
    }
    else if (xfo === "DENY" || xfo === "SAMEORIGIN") {
        checks.push(make("headers.clickjacking", "headers", "Framing is restricted by X-Frame-Options", "pass", "none", `X-Frame-Options is \`${xfo}\`. Adding CSP \`frame-ancestors\` as well is worth doing, since X-Frame-Options is the legacy mechanism.`, { target: url, evidence: `X-Frame-Options: ${xfo}` }));
    }
    else if (xfo.startsWith("ALLOW-FROM")) {
        checks.push(make("headers.clickjacking", "headers", "X-Frame-Options uses the obsolete ALLOW-FROM form", "fail", "medium", "No current browser supports ALLOW-FROM, so this page is effectively framable by anyone.", {
            target: url, evidence: `X-Frame-Options: ${xfo}`,
            remediation: "Replace it with `Content-Security-Policy: frame-ancestors https://the-allowed-origin`.",
            reference: OWASP.headers
        }));
    }
    else if (ancestorsValue) {
        checks.push(make("headers.clickjacking", "headers", "CSP frame-ancestors allows any origin", "fail", "medium", `frame-ancestors is \`${ancestorsValue}\`, which permits any site to embed this page in a frame and overlay it (clickjacking).`, {
            target: url, evidence: `Content-Security-Policy: frame-ancestors ${ancestorsValue}`,
            remediation: "Set `frame-ancestors 'none'` for pages that are never framed, or list the exact origins allowed to frame them.",
            reference: OWASP.headers
        }));
    }
    else {
        // A JSON API is not framable in a way that matters, so the severity differs.
        const severity = html ? "medium" : "low";
        checks.push(make("headers.clickjacking", "headers", "No clickjacking protection", html ? "fail" : "warn", severity, html
            ? "Neither X-Frame-Options nor CSP frame-ancestors is present, so any site can embed this page in an invisible frame and trick users into clicking through it."
            : "Neither X-Frame-Options nor CSP frame-ancestors is present. The response is not HTML, so the risk is lower, but the header costs nothing to add.", {
            target: url,
            evidence: "X-Frame-Options: (absent) · frame-ancestors: (absent)",
            remediation: "Send `Content-Security-Policy: frame-ancestors 'none'` (and `X-Frame-Options: DENY` for older browsers) unless the page is deliberately embeddable.",
            reference: OWASP.headers
        }));
    }
    // Referrer-Policy
    const referrer = (headers["referrer-policy"] || "").toLowerCase().trim();
    const leakyReferrer = ["unsafe-url", "no-referrer-when-downgrade", "origin-when-cross-origin", ""].includes(referrer);
    if (!referrer) {
        checks.push(make("headers.referrer", "headers", "Referrer-Policy header is missing", "warn", "low", "Without an explicit policy the browser default applies, and full URLs - including any identifier in the path or query - can be sent to third-party sites.", {
            target: url, evidence: "Referrer-Policy: (absent)",
            remediation: "Send `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` for sensitive pages).",
            reference: OWASP.headers
        }));
    }
    else if (referrer === "unsafe-url") {
        checks.push(make("headers.referrer", "headers", "Referrer-Policy is unsafe-url", "fail", "medium", "unsafe-url sends the full URL, including the path and query string, to every destination - including plain-HTTP ones. Identifiers or tokens in a URL leak to third parties.", {
            target: url, evidence: `Referrer-Policy: ${referrer}`,
            remediation: "Use `strict-origin-when-cross-origin`.",
            reference: OWASP.headers
        }));
    }
    else if (leakyReferrer) {
        checks.push(make("headers.referrer", "headers", "Referrer-Policy is weaker than recommended", "warn", "low", `\`${referrer}\` still sends the full URL to same-scheme cross-origin destinations.`, {
            target: url, evidence: `Referrer-Policy: ${referrer}`,
            remediation: "Use `strict-origin-when-cross-origin`.",
            reference: OWASP.headers
        }));
    }
    else {
        checks.push(make("headers.referrer", "headers", "Referrer-Policy is set", "pass", "none", `The policy is \`${referrer}\`, which limits what is leaked in the Referer header.`, { target: url, evidence: `Referrer-Policy: ${referrer}` }));
    }
    // Permissions-Policy
    const permissions = headers["permissions-policy"] || headers["feature-policy"] || "";
    if (html) {
        checks.push(permissions
            ? make("headers.permissions", "headers", "Permissions-Policy is set", "pass", "none", "The page restricts which powerful browser features it and its frames may use.", { target: url, evidence: truncate(permissions, 180) })
            : make("headers.permissions", "headers", "Permissions-Policy header is missing", "warn", "low", "Without it, any embedded frame inherits access to camera, microphone, geolocation and other powerful APIs by default.", {
                target: url, evidence: "Permissions-Policy: (absent)",
                remediation: "Send a deny-by-default policy such as `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`.",
                reference: OWASP.headers
            }));
    }
    // X-XSS-Protection: the modern guidance is to disable it.
    const xss = (headers["x-xss-protection"] || "").trim();
    if (xss && !/^0\b/.test(xss)) {
        checks.push(make("headers.xxssprotection", "headers", "X-XSS-Protection enables a retired, unsafe filter", "warn", "low", "The legacy auditor this header enables was removed from every current browser, and in the browsers that kept it, it introduced its own vulnerabilities. Current guidance is to disable it explicitly.", {
            target: url, evidence: `X-XSS-Protection: ${xss}`,
            remediation: "Send `X-XSS-Protection: 0` and rely on a Content-Security-Policy instead.",
            reference: OWASP.headers
        }));
    }
    // Cross-origin isolation family - informational, since they break some integrations.
    const coop = headers["cross-origin-opener-policy"];
    const corp = headers["cross-origin-resource-policy"];
    if (html) {
        checks.push(coop
            ? make("headers.coop", "headers", "Cross-Origin-Opener-Policy is set", "pass", "none", `\`${coop}\` isolates this page's browsing context group from cross-origin openers.`, { target: url, evidence: `Cross-Origin-Opener-Policy: ${coop}` })
            : make("headers.coop", "headers", "Cross-Origin-Opener-Policy header is missing", "warn", "low", "Without COOP, a cross-origin page that opens this one keeps a window reference to it, which is the basis of several cross-window attacks.", {
                target: url, evidence: "Cross-Origin-Opener-Policy: (absent)",
                remediation: "Send `Cross-Origin-Opener-Policy: same-origin` unless the page relies on cross-origin window messaging.",
                reference: OWASP.headers
            }));
    }
    if (corp) {
        checks.push(make("headers.corp", "headers", "Cross-Origin-Resource-Policy is set", "pass", "none", `\`${corp}\` controls which origins may embed this response as a subresource.`, { target: url, evidence: `Cross-Origin-Resource-Policy: ${corp}` }));
    }
    // Server banner / technology disclosure. Only a version string is a finding.
    const banners = [];
    for (const name of ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator", "x-drupal-cache", "x-runtime"]) {
        const value = headers[name];
        if (value)
            banners.push([name, value]);
    }
    const versioned = banners.filter(([, value]) => /\d+\.\d+/.test(value));
    if (versioned.length) {
        checks.push(make("headers.banner", "headers", "Response headers disclose software versions", "warn", "low", "Exact version strings let an attacker match the host against public advisories without probing it first. It is not a vulnerability by itself, but it removes a step for them.", {
            target: url,
            evidence: versioned.map(([name, value]) => `${name}: ${value}`).join(" · "),
            remediation: "Remove or blank these headers at the proxy or framework level (`server_tokens off` in nginx, `expose_php = Off`, `app.disable('x-powered-by')`).",
            reference: OWASP.a05
        }));
    }
    else if (banners.length) {
        checks.push(make("headers.banner", "headers", "Server banner is present but carries no version", "info", "none", "The server identifies its product but not its version, which is the usual, acceptable middle ground.", { target: url, evidence: banners.map(([name, value]) => `${name}: ${value}`).join(" · ") }));
    }
    else {
        checks.push(make("headers.banner", "headers", "No software version is disclosed in headers", "pass", "none", "No Server, X-Powered-By or framework version header was returned.", { target: url }));
    }
    return checks;
}
exports.analyzeSecurityHeaders = analyzeSecurityHeaders;
/** Splits a CSP header into a directive -> source-list map. */
function parseCsp(value) {
    const directives = {};
    if (!value || !value.trim())
        return directives;
    for (const part of value.split(";")) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length)
            continue;
        const name = tokens[0].toLowerCase();
        // A repeated directive is ignored by browsers after the first occurrence.
        if (directives[name])
            continue;
        directives[name] = tokens.slice(1);
    }
    return directives;
}
exports.parseCsp = parseCsp;
/** The effective source list for a directive, falling back to default-src. */
function effective(directives, name) {
    if (directives[name])
        return directives[name];
    const fetchDirectives = new Set([
        "script-src", "style-src", "img-src", "connect-src", "font-src", "media-src",
        "object-src", "frame-src", "child-src", "worker-src", "manifest-src", "prefetch-src"
    ]);
    if (fetchDirectives.has(name) && directives["default-src"])
        return directives["default-src"];
    return undefined;
}
const WILDCARD_SOURCES = new Set(["*", "http:", "https:", "data:", "blob:", "filesystem:"]);
function analyzeCsp(evidence) {
    const { url, primary } = evidence;
    const headers = primary.headers;
    const enforced = headers["content-security-policy"] || "";
    const reportOnly = headers["content-security-policy-report-only"] || "";
    const html = isHtmlResponse(headers, primary.bodySample);
    const checks = [];
    if (!enforced && !reportOnly) {
        // Only HTML documents execute script, so a missing CSP is graded by type.
        return [make("csp.present", "csp", "No Content-Security-Policy", html ? "fail" : "warn", html ? "high" : "low", html
                ? "The page ships no CSP, so any injected script, inline handler or third-party include runs with full privileges. CSP is the main defence-in-depth control against cross-site scripting."
                : "No CSP is sent. For a non-HTML response the practical impact is small, but a minimal policy still limits what a mis-typed response could do.", {
                target: url,
                evidence: "Content-Security-Policy: (absent)",
                remediation: html
                    ? "Start with `Content-Security-Policy-Report-Only: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`, collect reports, then enforce it. Use per-response nonces for the inline scripts you cannot remove."
                    : "Send `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` for API responses.",
                reference: OWASP.a05
            })];
    }
    const active = enforced || reportOnly;
    const directives = parseCsp(active);
    if (!enforced && reportOnly) {
        checks.push(make("csp.present", "csp", "CSP is report-only and does not block anything", "warn", "medium", "Only Content-Security-Policy-Report-Only is sent. Violations are reported but nothing is actually prevented, so the policy provides no protection yet.", {
            target: url, evidence: truncate(reportOnly, 300),
            remediation: "Once the report stream is clean, send the same policy in the enforcing `Content-Security-Policy` header.",
            reference: OWASP.a05
        }));
    }
    else {
        checks.push(make("csp.present", "csp", "Content-Security-Policy is enforced", "pass", "none", `A policy with ${Object.keys(directives).length} directive(s) is sent in enforcing mode.`, { target: url, evidence: truncate(enforced, 300) }));
    }
    const label = enforced ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
    const scriptSrc = effective(directives, "script-src");
    // default-src / script-src coverage
    if (!directives["default-src"] && !directives["script-src"]) {
        checks.push(make("csp.scriptsrc", "csp", "CSP restricts neither default-src nor script-src", "fail", "high", "With no default-src and no script-src, script loading is unrestricted and the policy gives no XSS protection at all.", {
            target: url, evidence: `${label}: ${truncate(active, 200)}`,
            remediation: "Add `default-src 'self'` as a baseline and tighten `script-src` from there.",
            reference: OWASP.a05
        }));
    }
    else if (scriptSrc) {
        const hasNonce = scriptSrc.some(source => /^'nonce-/i.test(source));
        const hasHash = scriptSrc.some(source => /^'sha(256|384|512)-/i.test(source));
        const strictDynamic = scriptSrc.some(source => /^'strict-dynamic'$/i.test(source));
        const unsafeInline = scriptSrc.some(source => /^'unsafe-inline'$/i.test(source));
        const unsafeEval = scriptSrc.some(source => /^'unsafe-eval'$/i.test(source));
        const wildcards = scriptSrc.filter(source => WILDCARD_SOURCES.has(source.toLowerCase()) || /^\*\./.test(source));
        if (unsafeInline && !(hasNonce || hasHash)) {
            checks.push(make("csp.unsafe-inline", "csp", "script-src allows 'unsafe-inline'", "fail", "high", "'unsafe-inline' permits any inline <script> block or event-handler attribute to run, which is exactly what a reflected or stored XSS injects. The policy does not stop XSS while it is present.", {
                target: url, evidence: `script-src ${scriptSrc.join(" ")}`,
                remediation: "Remove 'unsafe-inline' and allow the inline scripts you need with a per-response nonce (`'nonce-<random>'`) or a hash. Browsers that support nonces ignore 'unsafe-inline' when one is present, so a nonce can be added first as a transition.",
                reference: OWASP.a03
            }));
        }
        else if (unsafeInline && (hasNonce || hasHash)) {
            checks.push(make("csp.unsafe-inline", "csp", "'unsafe-inline' is present but neutralised by a nonce or hash", "pass", "none", "Browsers that understand nonces and hashes ignore 'unsafe-inline', so it only acts as a fallback for very old clients.", { target: url, evidence: `script-src ${scriptSrc.join(" ")}` }));
        }
        else {
            checks.push(make("csp.unsafe-inline", "csp", "script-src does not allow inline script", "pass", "none", "Inline scripts and inline event handlers are blocked, which is the control that actually stops most XSS payloads.", { target: url, evidence: `script-src ${scriptSrc.join(" ")}` }));
        }
        if (unsafeEval) {
            checks.push(make("csp.unsafe-eval", "csp", "script-src allows 'unsafe-eval'", "warn", "medium", "'unsafe-eval' re-enables `eval`, `new Function` and string timers, which turns any injected data that reaches one of those sinks into executable code.", {
                target: url, evidence: `script-src ${scriptSrc.join(" ")}`,
                remediation: "Remove 'unsafe-eval'. Replace runtime template compilation with a build step, and `eval`-based JSON parsing with `JSON.parse`.",
                reference: OWASP.a03
            }));
        }
        if (wildcards.length && !strictDynamic) {
            checks.push(make("csp.wildcard-script", "csp", "script-src allows a wildcard source", "fail", "high", `\`${wildcards.join(" ")}\` lets script load from any host matching that pattern. An attacker who can host a file on any such origin can load code into the page.`, {
                target: url, evidence: `script-src ${scriptSrc.join(" ")}`,
                remediation: "List the exact origins your scripts come from, or move to a nonce-based policy with 'strict-dynamic'.",
                reference: OWASP.a05
            }));
        }
        if (strictDynamic && (hasNonce || hasHash)) {
            checks.push(make("csp.strict-dynamic", "csp", "script-src uses 'strict-dynamic' with a nonce or hash", "pass", "none", "Host allow-lists are ignored in favour of nonce/hash propagation, which is the recommended modern policy shape and is resistant to allow-list bypasses.", { target: url, evidence: `script-src ${scriptSrc.join(" ")}` }));
        }
    }
    // object-src
    const objectSrc = effective(directives, "object-src");
    if (!objectSrc) {
        checks.push(make("csp.object-src", "csp", "CSP does not restrict object-src", "warn", "medium", "Plugin content (<object>, <embed>) is unrestricted. Legacy plugin types are a well-known way to bypass a script-src policy.", {
            target: url, evidence: `${label}: ${truncate(active, 200)}`,
            remediation: "Add `object-src 'none'`.",
            reference: OWASP.a05
        }));
    }
    else if (objectSrc.length === 1 && /^'none'$/i.test(objectSrc[0])) {
        checks.push(make("csp.object-src", "csp", "object-src is 'none'", "pass", "none", "Plugin content cannot be loaded, closing a common policy bypass.", { target: url, evidence: `object-src ${objectSrc.join(" ")}` }));
    }
    // base-uri
    if (!directives["base-uri"]) {
        // With `default-src 'none'` there is no script or subresource for an
        // injected <base> to redirect, so the same gap carries far less weight.
        const lockedDown = (directives["default-src"] || []).some(source => /^'none'$/i.test(source));
        checks.push(make("csp.base-uri", "csp", "CSP does not restrict base-uri", "warn", lockedDown ? "low" : "medium", "Without base-uri, an injected <base> tag can re-point every relative script and form URL on the page at an attacker's host. default-src does not cover this directive.", {
            target: url, evidence: `${label}: ${truncate(active, 200)}`,
            remediation: "Add `base-uri 'self'` (or `'none'`).",
            reference: OWASP.a05
        }));
    }
    else {
        checks.push(make("csp.base-uri", "csp", "base-uri is restricted", "pass", "none", `\`base-uri ${directives["base-uri"].join(" ")}\` prevents an injected <base> tag from re-pointing relative URLs.`, { target: url, evidence: `base-uri ${directives["base-uri"].join(" ")}` }));
    }
    // form-action
    if (html && !directives["form-action"]) {
        checks.push(make("csp.form-action", "csp", "CSP does not restrict form-action", "warn", "low", "An injected or rewritten form can post to any origin. form-action is not covered by default-src.", {
            target: url, evidence: `${label}: ${truncate(active, 200)}`,
            remediation: "Add `form-action 'self'`.",
            reference: OWASP.a05
        }));
    }
    // upgrade-insecure-requests on an HTTPS page
    if (isHttps(url) && html && !directives["upgrade-insecure-requests"] && !directives["block-all-mixed-content"]) {
        checks.push(make("csp.upgrade", "csp", "CSP does not upgrade insecure subresource requests", "info", "none", "`upgrade-insecure-requests` rewrites any leftover http:// subresource URL to https before the request is made, which is a cheap safety net during a migration.", { target: url, reference: OWASP.a02 }));
    }
    // Reporting
    if (!directives["report-uri"] && !directives["report-to"]) {
        checks.push(make("csp.reporting", "csp", "CSP violations are not reported anywhere", "info", "none", "Neither report-uri nor report-to is set, so violations - including real attacks - are silently dropped instead of being recorded.", {
            target: url,
            remediation: "Add a `report-to` group (with `report-uri` as the legacy fallback) pointing at a collector you monitor.",
            reference: OWASP.a09
        }));
    }
    return checks;
}
exports.analyzeCsp = analyzeCsp;
/** Parses one Set-Cookie header. The value itself is deliberately discarded. */
function parseSetCookie(header) {
    const parts = header.split(";");
    const first = parts[0] || "";
    const equals = first.indexOf("=");
    if (equals <= 0)
        return undefined;
    const cookie = {
        name: first.slice(0, equals).trim(),
        valueLength: first.slice(equals + 1).trim().length,
        secure: false,
        httpOnly: false,
        // The value is redacted here so it can never reach a report or a log.
        raw: `${first.slice(0, equals).trim()}=<redacted>; ${parts.slice(1).map(p => p.trim()).join("; ")}`.replace(/;\s*$/, "")
    };
    for (const attribute of parts.slice(1)) {
        const [rawName, ...rest] = attribute.split("=");
        const name = rawName.trim().toLowerCase();
        const value = rest.join("=").trim();
        if (name === "secure")
            cookie.secure = true;
        else if (name === "httponly")
            cookie.httpOnly = true;
        else if (name === "samesite")
            cookie.sameSite = value.toLowerCase();
        else if (name === "domain")
            cookie.domain = value;
        else if (name === "path")
            cookie.path = value;
        else if (name === "max-age") {
            const parsed = Number(value);
            if (Number.isFinite(parsed))
                cookie.maxAge = parsed;
        }
        else if (name === "expires")
            cookie.expires = value;
    }
    return cookie;
}
exports.parseSetCookie = parseSetCookie;
const SESSION_COOKIE_HINT = /(sess|sid|auth|token|jwt|login|remember|csrf|xsrf|identity|account|user)/i;
function analyzeCookies(evidence) {
    const { url, primary } = evidence;
    const raw = primary.setCookies;
    const secureScheme = isHttps(url);
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(hostOf(url));
    if (!raw.length) {
        return [make("cookies.none", "cookies", "No cookies are set by this response", "info", "none", "The response sent no Set-Cookie header, so there are no cookie flags to assess. Re-run against a login or session endpoint to check the cookies that matter.", { target: url })];
    }
    const checks = [];
    const cookies = raw.map(parseSetCookie).filter((cookie) => !!cookie);
    if (!cookies.length) {
        return [make("cookies.parse", "cookies", "Set-Cookie header could not be parsed", "warn", "low", "A Set-Cookie header was returned but did not contain a parseable `name=value` pair, which usually means the header is malformed and will be dropped by the browser.", { target: url, evidence: truncate(raw.join(" | "), 200), remediation: "Emit cookies through your framework's cookie API rather than writing the header by hand." })];
    }
    const isDeletion = (cookie) => cookie.valueLength === 0 && (cookie.maxAge === 0 || /1970|Thu, 01 Jan 1970/i.test(cookie.expires || ""));
    for (const cookie of cookies) {
        const id = cookie.name.replace(/[^A-Za-z0-9_-]/g, "_").toLowerCase();
        const sessionLike = SESSION_COOKIE_HINT.test(cookie.name);
        const target = `Set-Cookie: ${cookie.name}`;
        // A cookie being cleared carries no value, so its flags do not matter.
        if (isDeletion(cookie)) {
            checks.push(make(`cookies.${id}.deletion`, "cookies", `Cookie "${cookie.name}" is being cleared`, "info", "none", "This Set-Cookie deletes the cookie rather than setting one, so its attributes carry no risk.", { target, evidence: cookie.raw }));
            continue;
        }
        // Secure
        if (secureScheme) {
            checks.push(cookie.secure
                ? make(`cookies.${id}.secure`, "cookies", `Cookie "${cookie.name}" has the Secure flag`, "pass", "none", "The browser will only send this cookie over HTTPS.", { target, evidence: cookie.raw })
                : make(`cookies.${id}.secure`, "cookies", `Cookie "${cookie.name}" is missing the Secure flag`, "fail", sessionLike ? "high" : "medium", `Without Secure, the browser also sends this cookie over plain HTTP. A single http:// request to the domain - an image, a typo, a forced navigation - leaks it in clear text.${sessionLike ? " The name suggests it carries a session or credential." : ""}`, {
                    target, evidence: cookie.raw,
                    remediation: "Add the `Secure` attribute to every cookie set over HTTPS.",
                    reference: OWASP.a02
                }));
        }
        else if (loopback) {
            checks.push(make(`cookies.${id}.secure`, "cookies", `Cookie "${cookie.name}" is set over plain HTTP (local host)`, "warn", "low", "The cookie travels in clear text, which does not expose it to the network on a loopback address. The same response served from a real host would need HTTPS and the Secure flag.", {
                target, evidence: cookie.raw,
                remediation: "Make sure the production configuration sets `Secure` on this cookie and serves it over HTTPS.",
                reference: OWASP.a02
            }));
        }
        else {
            checks.push(make(`cookies.${id}.secure`, "cookies", `Cookie "${cookie.name}" is set over plain HTTP`, "fail", "high", "The cookie is transmitted in clear text because the endpoint itself is not using TLS. The Secure flag cannot help until the endpoint is HTTPS.", {
                target, evidence: cookie.raw,
                remediation: "Serve the endpoint over HTTPS and set `Secure` on the cookie.",
                reference: OWASP.a02
            }));
        }
        // HttpOnly
        checks.push(cookie.httpOnly
            ? make(`cookies.${id}.httponly`, "cookies", `Cookie "${cookie.name}" has the HttpOnly flag`, "pass", "none", "Page JavaScript cannot read this cookie, so an XSS payload cannot exfiltrate it directly.", { target, evidence: cookie.raw })
            : make(`cookies.${id}.httponly`, "cookies", `Cookie "${cookie.name}" is readable by JavaScript`, sessionLike ? "fail" : "warn", sessionLike ? "high" : "low", sessionLike
                ? "HttpOnly is not set, so any injected script can read this cookie with `document.cookie` and send it elsewhere. The name suggests it carries a session or credential."
                : "HttpOnly is not set. That is correct if the front end genuinely needs to read this cookie (a CSRF token or a UI preference), and a problem if it does not.", {
                target, evidence: cookie.raw,
                remediation: sessionLike
                    ? "Add `HttpOnly` to session and authentication cookies."
                    : "Add `HttpOnly` unless client-side JavaScript has to read this specific cookie.",
                reference: OWASP.a07
            }));
        // SameSite
        const sameSite = (cookie.sameSite || "").toLowerCase();
        if (sameSite === "none" && !cookie.secure) {
            checks.push(make(`cookies.${id}.samesite`, "cookies", `Cookie "${cookie.name}" uses SameSite=None without Secure`, "fail", "high", "Browsers reject a SameSite=None cookie that is not also marked Secure, so this cookie is dropped entirely - which usually shows up as a broken session rather than as an error.", {
                target, evidence: cookie.raw,
                remediation: "Add `Secure` alongside `SameSite=None`, or use `SameSite=Lax` if the cookie is not needed cross-site.",
                reference: OWASP.a05
            }));
        }
        else if (sameSite === "none") {
            checks.push(make(`cookies.${id}.samesite`, "cookies", `Cookie "${cookie.name}" is sent on cross-site requests`, "warn", sessionLike ? "medium" : "low", "SameSite=None means the cookie travels with requests initiated by other sites, which is what CSRF depends on. It is the right setting for a deliberate cross-site integration and the wrong one for a session cookie.", {
                target, evidence: cookie.raw,
                remediation: "Use `SameSite=Lax` unless the cookie is genuinely required cross-site; if it is, pair it with a CSRF token or origin check on every state-changing request.",
                reference: OWASP.a01
            }));
        }
        else if (!sameSite) {
            checks.push(make(`cookies.${id}.samesite`, "cookies", `Cookie "${cookie.name}" has no explicit SameSite`, "warn", "low", "No SameSite attribute is set. Current browsers default to Lax, but the default is not uniform across browsers and versions, so relying on it leaves the CSRF posture undefined.", {
                target, evidence: cookie.raw,
                remediation: "Set `SameSite=Lax` explicitly (or `Strict` for high-value cookies).",
                reference: OWASP.a01
            }));
        }
        else if (sameSite === "strict" || sameSite === "lax") {
            checks.push(make(`cookies.${id}.samesite`, "cookies", `Cookie "${cookie.name}" sets SameSite=${cookie.sameSite}`, "pass", "none", "The cookie is not sent on cross-site requests, which removes the main CSRF vector for it.", { target, evidence: cookie.raw }));
        }
        else {
            checks.push(make(`cookies.${id}.samesite`, "cookies", `Cookie "${cookie.name}" has an unrecognised SameSite value`, "warn", "low", `\`SameSite=${cookie.sameSite}\` is not one of Strict, Lax or None. Browsers fall back to their default and the intended behaviour is not applied.`, { target, evidence: cookie.raw, remediation: "Use exactly `Strict`, `Lax` or `None`." }));
        }
        // Cookie prefixes
        if (/^__Host-/i.test(cookie.name)) {
            const valid = cookie.secure && !cookie.domain && cookie.path === "/";
            checks.push(valid
                ? make(`cookies.${id}.prefix`, "cookies", `Cookie "${cookie.name}" satisfies the __Host- prefix rules`, "pass", "none", "The prefix is honoured, so the cookie cannot be set or overwritten by a subdomain.", { target, evidence: cookie.raw })
                : make(`cookies.${id}.prefix`, "cookies", `Cookie "${cookie.name}" violates the __Host- prefix rules`, "fail", "medium", "A __Host- cookie must be Secure, have Path=/ and carry no Domain attribute. Browsers reject the cookie outright when any of those is wrong.", {
                    target, evidence: cookie.raw,
                    remediation: "Set `Secure; Path=/` and remove the `Domain` attribute, or drop the prefix.",
                    reference: "RFC 6265bis"
                }));
        }
        else if (/^__Secure-/i.test(cookie.name) && !cookie.secure) {
            checks.push(make(`cookies.${id}.prefix`, "cookies", `Cookie "${cookie.name}" violates the __Secure- prefix rules`, "fail", "medium", "A __Secure- cookie must carry the Secure attribute; browsers reject it otherwise.", { target, evidence: cookie.raw, remediation: "Add `Secure`, or drop the prefix.", reference: "RFC 6265bis" }));
        }
        // Domain scope
        if (cookie.domain) {
            const host = hostOf(url).replace(/:\d+$/, "");
            const domain = cookie.domain.replace(/^\./, "").toLowerCase();
            const labels = domain.split(".").filter(Boolean);
            const broader = host.toLowerCase() !== domain;
            // A two-label domain on a host with more labels is a site-wide scope.
            if (broader && labels.length >= 2 && sessionLike) {
                checks.push(make(`cookies.${id}.domain`, "cookies", `Cookie "${cookie.name}" is scoped to a parent domain`, "warn", "medium", `Domain=${cookie.domain} shares this cookie with every host under that domain. Any subdomain - including one you do not control, or one taken over after a dangling DNS record - can read it.`, {
                    target, evidence: cookie.raw,
                    remediation: "Drop the Domain attribute so the cookie is host-only, unless it genuinely has to be shared across subdomains.",
                    reference: OWASP.a01
                }));
            }
        }
        // Lifetime
        if (sessionLike && typeof cookie.maxAge === "number" && cookie.maxAge > ONE_YEAR) {
            checks.push(make(`cookies.${id}.lifetime`, "cookies", `Cookie "${cookie.name}" has a very long lifetime`, "warn", "low", `Max-Age is ${cookie.maxAge} seconds (about ${Math.round(cookie.maxAge / 86400)} days). A stolen session cookie stays valid for that whole period unless it is revoked server-side.`, {
                target, evidence: cookie.raw,
                remediation: "Shorten the cookie lifetime and rotate the session identifier on privilege change; keep long-lived sessions revocable server-side.",
                reference: OWASP.a07
            }));
        }
    }
    return checks;
}
exports.analyzeCookies = analyzeCookies;
/* ------------------------------------------------------------------ *
 * CORS
 * ------------------------------------------------------------------ */
function analyzeCors(evidence) {
    const { url, corsSimple, corsPreflight, probeOrigin } = evidence;
    if (!corsSimple && !corsPreflight) {
        return [make("cors.probe", "cors", "CORS configuration", "skipped", "none", "The cross-origin probes did not run, so the CORS policy could not be assessed.", { target: url })];
    }
    const checks = [];
    const simpleHeaders = corsSimple?.headers || {};
    const preflightHeaders = corsPreflight?.headers || {};
    // A browser reads CORS headers from whichever response it received, so both
    // are considered and the more permissive answer is the one that matters.
    const allowOrigin = (simpleHeaders["access-control-allow-origin"] || preflightHeaders["access-control-allow-origin"] || "").trim();
    const allowCredentials = /^true$/i.test((simpleHeaders["access-control-allow-credentials"] || preflightHeaders["access-control-allow-credentials"] || "").trim());
    const allowMethods = (preflightHeaders["access-control-allow-methods"] || simpleHeaders["access-control-allow-methods"] || "").trim();
    const allowHeaders = (preflightHeaders["access-control-allow-headers"] || simpleHeaders["access-control-allow-headers"] || "").trim();
    const exposeHeaders = (simpleHeaders["access-control-expose-headers"] || preflightHeaders["access-control-expose-headers"] || "").trim();
    const vary = (simpleHeaders["vary"] || preflightHeaders["vary"] || "").toLowerCase();
    const maxAge = (preflightHeaders["access-control-max-age"] || "").trim();
    const reflected = !!allowOrigin && allowOrigin.toLowerCase() === probeOrigin.toLowerCase();
    const wildcard = allowOrigin === "*";
    const nullOrigin = allowOrigin.toLowerCase() === "null";
    const evidenceLine = [
        `Origin: ${probeOrigin}`,
        `Access-Control-Allow-Origin: ${allowOrigin || "(absent)"}`,
        `Access-Control-Allow-Credentials: ${allowCredentials ? "true" : "(absent)"}`
    ].join(" · ");
    if (!allowOrigin) {
        checks.push(make("cors.origin", "cors", "No cross-origin access is granted", "pass", "none", `The endpoint returned no Access-Control-Allow-Origin for a foreign Origin (${probeOrigin}), so a browser blocks other sites from reading its responses.`, { target: url, evidence: evidenceLine }));
    }
    else if (reflected && allowCredentials) {
        checks.push(make("cors.origin", "cors", "CORS reflects any origin and allows credentials", "fail", "critical", `The endpoint echoed the arbitrary origin \`${probeOrigin}\` back in Access-Control-Allow-Origin and set Access-Control-Allow-Credentials: true. Any website a logged-in user visits can read this endpoint's authenticated responses with their cookies attached - a full cross-origin data-theft path.`, {
            target: url, evidence: evidenceLine,
            remediation: "Validate the Origin header against an explicit allow-list and echo it only on a match; never reflect it unconditionally. If the endpoint is public, use `Access-Control-Allow-Origin: *` and drop credentials.",
            reference: OWASP.a05
        }));
    }
    else if (reflected) {
        checks.push(make("cors.origin", "cors", "CORS reflects any origin", "warn", "medium", `The endpoint echoed the arbitrary origin \`${probeOrigin}\`. Credentials are not allowed, so cookies are not attached, but any site can still read responses that depend only on the caller's IP or network position (internal services, IP-allow-listed APIs).`, {
            target: url, evidence: evidenceLine,
            remediation: "Echo the Origin only when it matches an allow-list. If the data is genuinely public, send a literal `*` instead of reflecting.",
            reference: OWASP.a05
        }));
    }
    else if (wildcard && allowCredentials) {
        checks.push(make("cors.origin", "cors", "CORS sends a wildcard origin together with credentials", "fail", "high", "Access-Control-Allow-Origin is `*` while Access-Control-Allow-Credentials is true. Browsers reject this combination outright, so credentialed cross-origin calls fail - and the intent behind it (sharing authenticated data broadly) would be unsafe if it did work.", {
            target: url, evidence: evidenceLine,
            remediation: "Decide which one you need: drop the credentials header for a genuinely public endpoint, or replace `*` with an allow-listed origin for an authenticated one.",
            reference: OWASP.a05
        }));
    }
    else if (wildcard) {
        checks.push(make("cors.origin", "cors", "CORS allows any origin", "warn", "low", "Access-Control-Allow-Origin is `*`. That is correct for a public, unauthenticated endpoint; it is a data leak for anything that varies by user, session or network location.", {
            target: url, evidence: evidenceLine,
            remediation: "Confirm this endpoint returns nothing user-specific. If it does, replace `*` with an allow-list.",
            reference: OWASP.a05
        }));
    }
    else if (nullOrigin) {
        checks.push(make("cors.origin", "cors", "CORS allows the null origin", "fail", "high", "`Access-Control-Allow-Origin: null` trusts requests from sandboxed iframes, `data:` URLs and local files - all of which an attacker can create. It is effectively a wildcard that is easy to reach.", {
            target: url, evidence: evidenceLine,
            remediation: "Remove `null` from the allowed origins entirely.",
            reference: OWASP.a05
        }));
    }
    else {
        checks.push(make("cors.origin", "cors", "CORS uses a fixed allow-list origin", "pass", "none", `The endpoint returned \`${allowOrigin}\` for the foreign origin \`${probeOrigin}\`, so it is not reflecting arbitrary origins.`, { target: url, evidence: evidenceLine }));
    }
    // Vary: Origin - required whenever the ACAO value depends on the request.
    if (allowOrigin && !wildcard) {
        checks.push(vary.includes("origin")
            ? make("cors.vary", "cors", "Vary: Origin is set", "pass", "none", "The response tells caches that it differs per origin, so a shared cache cannot hand one site's CORS response to another.", { target: url, evidence: `Vary: ${vary}` })
            : make("cors.vary", "cors", "Origin-dependent response without Vary: Origin", "warn", "medium", "Access-Control-Allow-Origin varies by request but the response does not declare `Vary: Origin`. A shared cache (CDN or proxy) can store the response for one origin and serve it to another, which both breaks the policy and enables cache poisoning.", {
                target: url, evidence: `Access-Control-Allow-Origin: ${allowOrigin} · Vary: ${vary || "(absent)"}`,
                remediation: "Add `Vary: Origin` to every response that computes Access-Control-Allow-Origin from the request.",
                reference: OWASP.a05
            }));
    }
    // Allowed methods
    if (allowMethods) {
        const methods = allowMethods.split(",").map(m => m.trim().toUpperCase()).filter(Boolean);
        const mutating = methods.filter(m => ["PUT", "DELETE", "PATCH", "POST"].includes(m));
        const wildcardMethods = methods.includes("*");
        const unrestrictedOrigin = reflected || nullOrigin || (wildcard && allowCredentials);
        if (unrestrictedOrigin && (mutating.length || wildcardMethods)) {
            checks.push(make("cors.methods", "cors", "State-changing methods are exposed cross-origin", "fail", allowCredentials ? "high" : "medium", `The preflight allows ${wildcardMethods ? "every method (*)" : mutating.join(", ")} from an origin that is not restricted to an allow-list${allowCredentials ? " and credentials are permitted" : ""}. Another site can drive write operations against this endpoint as the signed-in user.`, {
                target: url, evidence: `Access-Control-Allow-Methods: ${allowMethods} · Access-Control-Allow-Origin: ${allowOrigin}`,
                remediation: "Restrict the allowed origins first, then list only the methods an approved origin actually needs.",
                reference: OWASP.a01
            }));
        }
        else if (wildcard && (mutating.length || wildcardMethods)) {
            // `*` without credentials means the cross-origin caller is anonymous, so
            // exposing a write method is a design decision rather than a bypass.
            checks.push(make("cors.methods", "cors", "Write methods are reachable cross-origin, but only anonymously", "info", "none", `The preflight allows ${wildcardMethods ? "every method (*)" : mutating.join(", ")} from any origin, with credentials disabled. A cross-origin caller is therefore unauthenticated, so this only matters if the endpoint accepts writes without a credential.`, { target: url, evidence: `Access-Control-Allow-Methods: ${allowMethods} · Access-Control-Allow-Origin: *`, reference: OWASP.a01 }));
        }
        else {
            checks.push(make("cors.methods", "cors", "Preflight method list is scoped", "pass", "none", `Allowed methods: ${allowMethods}.`, { target: url, evidence: `Access-Control-Allow-Methods: ${allowMethods}` }));
        }
    }
    // Allowed headers
    if (allowHeaders === "*" && allowCredentials) {
        checks.push(make("cors.headers", "cors", "Preflight allows any request header with credentials", "fail", "high", "`Access-Control-Allow-Headers: *` combined with credentials lets a cross-origin caller attach arbitrary headers, including ones your authorization logic reads.", {
            target: url, evidence: `Access-Control-Allow-Headers: * · Access-Control-Allow-Credentials: true`,
            remediation: "List the exact headers the integration needs (for example `Content-Type, Authorization`).",
            reference: OWASP.a05
        }));
    }
    else if (allowHeaders) {
        checks.push(make("cors.headers", "cors", "Preflight header list is explicit", "pass", "none", `Allowed request headers: ${allowHeaders}.`, { target: url, evidence: `Access-Control-Allow-Headers: ${allowHeaders}` }));
    }
    if (exposeHeaders === "*" || /authorization|set-cookie/i.test(exposeHeaders)) {
        checks.push(make("cors.expose", "cors", "Sensitive response headers are exposed cross-origin", "warn", "medium", `Access-Control-Expose-Headers is \`${exposeHeaders}\`, which makes headers that normally stay hidden readable by cross-origin script.`, {
            target: url, evidence: `Access-Control-Expose-Headers: ${exposeHeaders}`,
            remediation: "Expose only the specific non-sensitive headers a client needs, such as pagination or rate-limit headers.",
            reference: OWASP.a05
        }));
    }
    const maxAgeSeconds = Number(maxAge);
    if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 86400) {
        checks.push(make("cors.maxage", "cors", "Preflight cache lifetime is very long", "info", "none", `Access-Control-Max-Age is ${maxAgeSeconds} seconds, so a browser will not re-check the policy for that long after a change. Browsers cap this value anyway (Chrome at 7200s, Firefox at 86400s).`, { target: url, evidence: `Access-Control-Max-Age: ${maxAge}` }));
    }
    return checks;
}
exports.analyzeCors = analyzeCors;
/** Decodes the header and payload of a JWS compact token. No signature check. */
function decodeJwt(token) {
    const parts = token.split(".");
    if (parts.length < 2)
        return undefined;
    const decode = (segment) => {
        try {
            const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
            const json = Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64").toString("utf8");
            const parsed = JSON.parse(json);
            return parsed && typeof parsed === "object" ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    };
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (!header)
        return undefined;
    return {
        alg: typeof header.alg === "string" ? header.alg : undefined,
        typ: typeof header.typ === "string" ? header.typ : undefined,
        exp: typeof payload?.exp === "number" ? payload.exp : undefined,
        iat: typeof payload?.iat === "number" ? payload.iat : undefined,
        claims: payload ? Object.keys(payload) : [],
        valid: true
    };
}
exports.decodeJwt = decodeJwt;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{0,}/g;
/** Tokens carried in a URL instead of a header. */
const TOKEN_QUERY_KEYS = /[?&](access_token|api_key|apikey|auth_token|token|session|sig|signature|password|secret)=([^&#\s]{6,})/i;
function analyzeAuth(evidence) {
    const { url, primary, unauthenticated, sentCredentials } = evidence;
    const headers = primary.headers;
    const checks = [];
    // Credentials in the URL.
    const inUrl = TOKEN_QUERY_KEYS.exec(url);
    const basicInUrl = /^https?:\/\/[^/@\s]+:[^/@\s]+@/i.test(url);
    if (inUrl || basicInUrl) {
        checks.push(make("auth.credentials-in-url", "auth", "Credentials are carried in the URL", "fail", "high", "A secret in the query string or userinfo section is written to server access logs, proxy logs and browser history, and is sent in the Referer header when the page links out. Headers are the only safe place for it.", {
            target: url,
            evidence: basicInUrl ? "URL contains basic-auth userinfo (user:password@host)" : `Query parameter "${inUrl[1]}" carries a secret value`,
            remediation: "Move the credential into an `Authorization` header, and rotate any value that has already been sent this way.",
            reference: OWASP.a07
        }));
    }
    else {
        checks.push(make("auth.credentials-in-url", "auth", "No credentials in the request URL", "pass", "none", "The URL carries no token, key or password in its query string or userinfo section.", { target: url }));
    }
    // WWW-Authenticate
    const challenge = headers["www-authenticate"] || "";
    if (challenge) {
        const basic = /^\s*basic/i.test(challenge);
        if (basic && !isHttps(url)) {
            checks.push(make("auth.basic-over-http", "auth", "HTTP Basic authentication over an unencrypted connection", "fail", "critical", "The server asks for Basic credentials on a plain-HTTP endpoint. Basic sends the username and password base64-encoded, which is reversible - anyone on the network path reads them directly.", {
                target: url, evidence: `WWW-Authenticate: ${truncate(challenge, 120)}`,
                remediation: "Serve the endpoint over HTTPS before requesting any credential, and treat every password used over the HTTP endpoint as compromised.",
                reference: OWASP.a02
            }));
        }
        else {
            checks.push(make("auth.challenge", "auth", `Authentication challenge: ${challenge.split(/[\s,]/)[0]}`, "info", "none", `The endpoint requires authentication and advertises it with \`${truncate(challenge, 120)}\`.`, { target: url, evidence: `WWW-Authenticate: ${truncate(challenge, 160)}` }));
        }
    }
    // Authorization enforcement: does removing the credential change anything?
    if (!sentCredentials) {
        checks.push(make("auth.enforcement", "auth", "Authorization enforcement", "skipped", "none", "No credential was configured for this request, so there is nothing to strip and compare. Add an Authorization header or a session cookie to test whether the endpoint actually enforces it.", { target: url }));
    }
    else if (!unauthenticated) {
        checks.push(make("auth.enforcement", "auth", "Authorization enforcement", "skipped", "none", "The credential-stripped probe did not run.", { target: url }));
    }
    else if (unauthenticated.error) {
        checks.push(make("auth.enforcement", "auth", "Authorization enforcement", "skipped", "none", `The credential-stripped probe failed: ${unauthenticated.error}`, { target: url, evidence: unauthenticated.error }));
    }
    else {
        const blocked = [401, 403].includes(unauthenticated.status);
        const sameStatus = unauthenticated.status === primary.status;
        const similarSize = primary.bodyBytes > 0 &&
            Math.abs(unauthenticated.bodyBytes - primary.bodyBytes) <= Math.max(32, primary.bodyBytes * 0.1);
        if (blocked) {
            checks.push(make("auth.enforcement", "auth", "The endpoint rejects unauthenticated requests", "pass", "none", `Stripping the credential changed the response from ${primary.status} to ${unauthenticated.status}, so access control is being applied.`, { target: url, evidence: `with credential: ${primary.status} · without: ${unauthenticated.status}`, reference: OWASP.a01 }));
        }
        else if (unauthenticated.status >= 200 && unauthenticated.status < 300 && sameStatus && similarSize) {
            checks.push(make("auth.enforcement", "auth", "The endpoint returns the same data without a credential", "fail", "critical", `The request was repeated with every credential removed and the endpoint still answered ${unauthenticated.status} with a response of the same size (${unauthenticated.bodyBytes} vs ${primary.bodyBytes} bytes). The authorization check is either missing or not reached - this is broken access control.`, {
                target: url,
                evidence: `with credential: ${primary.status} / ${primary.bodyBytes}B · without: ${unauthenticated.status} / ${unauthenticated.bodyBytes}B`,
                remediation: "Enforce authorization in the request pipeline, before the handler, and deny by default. Add a regression test that calls this route with no credential and asserts 401.",
                reference: OWASP.a01
            }));
        }
        else if (unauthenticated.status >= 200 && unauthenticated.status < 300) {
            checks.push(make("auth.enforcement", "auth", "The endpoint answers without a credential", "warn", "medium", `Without the credential the endpoint still answered ${unauthenticated.status}, though the response differs in size (${unauthenticated.bodyBytes} vs ${primary.bodyBytes} bytes). That is expected for an endpoint with a public and an authenticated view, and a finding if the route is meant to be protected.`, {
                target: url,
                evidence: `with credential: ${primary.status} / ${primary.bodyBytes}B · without: ${unauthenticated.status} / ${unauthenticated.bodyBytes}B`,
                remediation: "Confirm the unauthenticated response contains no user-specific data. If the route is private, reject the request with 401 instead.",
                reference: OWASP.a01
            }));
        }
        else {
            checks.push(make("auth.enforcement", "auth", "Unauthenticated request was not served", "pass", "none", `Without the credential the endpoint answered ${unauthenticated.status}.`, { target: url, evidence: `with credential: ${primary.status} · without: ${unauthenticated.status}` }));
        }
    }
    // JWT hygiene, for any token visible in the response or the auth headers.
    const tokenSources = [primary.bodySample, headers["authorization"] || "", primary.setCookies.join(" ")].join("\n");
    const tokens = Array.from(new Set((tokenSources.match(JWT_PATTERN) || []).slice(0, 5)));
    for (const token of tokens) {
        const decoded = decodeJwt(token);
        if (!decoded)
            continue;
        const alg = (decoded.alg || "").toLowerCase();
        const idSuffix = token.slice(0, 8);
        if (alg === "none") {
            checks.push(make(`auth.jwt.alg.${idSuffix}`, "auth", "JWT uses the \"none\" algorithm", "fail", "critical", "A token with `alg: none` carries no signature. Any client can mint one with whatever claims it likes, which defeats the authentication entirely.", {
                target: url, evidence: `JWT header alg: none · claims: ${decoded.claims.join(", ") || "(none)"}`,
                remediation: "Reject `none` explicitly and pin the accepted algorithm list on the verifying side (for example `algorithms: ['RS256']`).",
                reference: OWASP.a07
            }));
        }
        else if (alg && !/^(hs|rs|es|ps)(256|384|512)$/.test(alg)) {
            checks.push(make(`auth.jwt.alg.${idSuffix}`, "auth", `JWT uses an unusual algorithm (${decoded.alg})`, "warn", "medium", "The token's algorithm is not one of the standard HS/RS/ES/PS families, which is worth confirming against what the verifier actually accepts.", { target: url, evidence: `JWT header alg: ${decoded.alg}`, reference: OWASP.a07 }));
        }
        if (decoded.exp === undefined) {
            checks.push(make(`auth.jwt.exp.${idSuffix}`, "auth", "JWT has no expiry claim", "warn", "high", "The token carries no `exp`, so it stays valid forever once issued. A leaked token can never be aged out without rotating the signing key.", {
                target: url, evidence: `JWT claims: ${decoded.claims.join(", ") || "(none)"}`,
                remediation: "Issue tokens with a short `exp` and use a refresh token for longer sessions.",
                reference: OWASP.a07
            }));
        }
        else if (decoded.exp * 1000 < Date.now()) {
            checks.push(make(`auth.jwt.exp.${idSuffix}`, "auth", "JWT in the response is already expired", "info", "none", `The token's \`exp\` is ${new Date(decoded.exp * 1000).toISOString()}, in the past. That is only a problem if the server still accepts it.`, { target: url }));
        }
        else if (decoded.iat && decoded.exp - decoded.iat > 60 * 60 * 24 * 30) {
            checks.push(make(`auth.jwt.exp.${idSuffix}`, "auth", "JWT lifetime is very long", "warn", "medium", `The token is valid for about ${Math.round((decoded.exp - decoded.iat) / 86400)} days. Stateless tokens cannot be revoked, so a long lifetime is also a long exposure window.`, {
                target: url, evidence: `iat ${decoded.iat} → exp ${decoded.exp}`,
                remediation: "Shorten the access-token lifetime to minutes and rely on refresh tokens, which can be revoked.",
                reference: OWASP.a07
            }));
        }
    }
    // Cache-Control on an authenticated response.
    if (sentCredentials) {
        const cache = (headers["cache-control"] || "").toLowerCase();
        const safe = /no-store/.test(cache) || (/private/.test(cache) && /no-cache/.test(cache));
        checks.push(safe
            ? make("auth.cache", "auth", "Authenticated response is not cacheable", "pass", "none", `Cache-Control is \`${headers["cache-control"]}\`, so the response is not stored by shared caches or written to disk.`, { target: url, evidence: `Cache-Control: ${headers["cache-control"]}` })
            : make("auth.cache", "auth", "Authenticated response may be cached", "warn", "medium", `The request carried a credential but the response's Cache-Control is \`${headers["cache-control"] || "(absent)"}\`. A shared proxy or the browser disk cache can retain per-user data and serve or expose it later.`, {
                target: url, evidence: `Cache-Control: ${headers["cache-control"] || "(absent)"}`,
                remediation: "Send `Cache-Control: no-store` on every authenticated response.",
                reference: OWASP.a01
            }));
    }
    return checks;
}
exports.analyzeAuth = analyzeAuth;
/**
 * Credential shapes with a distinctive prefix or structure.
 *
 * Every entry here matches a *format*, not a keyword, which is what keeps the
 * false-positive rate near zero: `AKIA...` is an AWS key id and nothing else.
 * Keyword-based heuristics live separately, in the static scanner, where they
 * can be filtered against placeholder and environment-reference forms.
 */
exports.SECRET_PATTERNS = [
    { id: "private-key", label: "Private key material", severity: "critical", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/, remediation: "Remove the key, rotate it immediately, and load it at runtime from a secret manager or the platform key store." },
    { id: "aws-access-key", label: "AWS access key id", severity: "critical", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/, remediation: "Deactivate and delete the key in IAM, then use an instance role, IRSA or a workload identity instead of a long-lived key." },
    { id: "aws-secret-key", label: "AWS secret access key", severity: "critical", pattern: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i, remediation: "Rotate the secret key immediately and switch to short-lived credentials." },
    { id: "github-token", label: "GitHub token", severity: "critical", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/, remediation: "Revoke the token on GitHub, then use a fine-grained token or GitHub Actions OIDC with the least scope that works." },
    { id: "github-app-token", label: "GitHub App installation token", severity: "critical", pattern: /\bghs_[A-Za-z0-9]{36,255}\b/, remediation: "Revoke the installation token and let the App mint a fresh short-lived one per run." },
    { id: "slack-token", label: "Slack token", severity: "high", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, remediation: "Revoke the token in the Slack app configuration and re-issue it with narrower scopes." },
    { id: "google-api-key", label: "Google API key", severity: "high", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, remediation: "Regenerate the key in the Google Cloud console and add an application/API restriction to it." },
    { id: "stripe-key", label: "Stripe secret key", severity: "critical", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/, remediation: "Roll the key in the Stripe dashboard; a live key must be treated as compromised the moment it is exposed." },
    { id: "openai-key", label: "OpenAI API key", severity: "critical", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/, remediation: "Revoke the key in the provider dashboard and move it into an environment variable or secret store." },
    { id: "anthropic-key", label: "Anthropic API key", severity: "critical", pattern: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/, remediation: "Revoke the key in the Anthropic console and load it from an environment variable instead." },
    { id: "npm-token", label: "npm access token", severity: "high", pattern: /\bnpm_[A-Za-z0-9]{36}\b/, remediation: "Revoke the token with `npm token revoke` and use a granular automation token in CI." },
    { id: "sendgrid-key", label: "SendGrid API key", severity: "high", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/, remediation: "Delete the key in SendGrid and issue a replacement with restricted access." },
    { id: "twilio-key", label: "Twilio account SID/key", severity: "high", pattern: /\b(?:AC|SK)[0-9a-fA-F]{32}\b/, remediation: "Rotate the Twilio credential and store it in a secret manager." },
    { id: "database-url", label: "Database connection string with credentials", severity: "high", pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|amqp|clickhouse):\/\/[^\s"'<>]*:[^\s"'<>@]+@[^\s"'<>]+/i, remediation: "Move the connection string to a secret manager, rotate the password, and require TLS on the database connection." },
    { id: "jwt-token", label: "JSON Web Token", severity: "medium", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, remediation: "Confirm the token is not a live session credential. If it is, treat it as leaked, revoke the session and shorten token lifetimes." },
    { id: "azure-storage-key", label: "Azure storage account key", severity: "critical", pattern: /\bAccountKey\s*=\s*[A-Za-z0-9+/=]{60,}/i, remediation: "Regenerate the storage account key and switch clients to a SAS token or managed identity." },
    { id: "basic-auth-url", label: "Credentials embedded in a URL", severity: "high", pattern: /\bhttps?:\/\/[A-Za-z0-9._%-]+:[^\s"'<>@/]{4,}@[A-Za-z0-9.-]+/, remediation: "Move the credential into an Authorization header and rotate the exposed value." }
];
/**
 * Fixed placeholder credentials that vendor documentation uses.
 *
 * These strings appear in AWS's own guides, in tutorials copied from them and
 * in test fixtures everywhere. Reporting one as a leaked credential is a false
 * positive by construction, so they are excluded from every credential rule.
 */
const DOCUMENTED_EXAMPLE_CREDENTIAL = /\bAKIAIOSFODNN7EXAMPLE\b|\bASIAIOSFODNN7EXAMPLE\b|EXAMPLEKEY\b|\bwJalrXUtnFEMI\/K7MDENG/;
function isDocumentedExampleCredential(text) {
    return DOCUMENTED_EXAMPLE_CREDENTIAL.test(text);
}
exports.isDocumentedExampleCredential = isDocumentedExampleCredential;
const STACK_TRACE_SIGNATURES = [
    ["Java / JVM", /\bat\s+(?:java|javax|jakarta|org\.springframework|com\.sun)\.[\w.$]+\([\w.]+:\d+\)/],
    ["Python", /Traceback \(most recent call last\):/],
    ["PHP", /(?:Fatal error|Warning|Notice):.*?\bin\b.*?\bon line\b\s*\d+|Stack trace:\s*#0/i],
    ["ASP.NET / CLR", /\bSystem\.(?:NullReference|InvalidOperation|Argument\w*|IO\.\w+)Exception\b/],
    ["Node.js", /\bat\s+[\w.<>[\]$ ]+\s+\((?:\/|[A-Za-z]:\\)[^\s)]*node_modules[^\s)]*:\d+:\d+\)/],
    ["Ruby", /\.rb:\d+:in\s+[`'][^']+'/],
    ["Go", /goroutine \d+ \[[^\]]+\]:\s|\bpanic:\s.+\n\s*\n?goroutine/]
];
const SQL_ERROR_SIGNATURES = [
    ["MySQL", /You have an error in your SQL syntax|\bmysqli?_\w+\(\)|Unknown column '[^']+' in 'field list'/i],
    ["PostgreSQL", /\bPG::\w+Error\b|\bpsycopg2\.\w+Error\b|\bERROR:\s+syntax error at or near\b/i],
    ["Microsoft SQL Server", /\bUnclosed quotation mark after the character string\b|\bIncorrect syntax near\b/i],
    ["Oracle", /\bORA-\d{5}\b|\bquoted string not properly terminated\b/i],
    ["SQLite", /\bsqlite3?\.(?:Operational|Programming|Integrity)Error\b|\bSQLITE_ERROR\b/],
    ["Generic ODBC/JDBC", /\bSQLSTATE\[\w+\]|\bjava\.sql\.SQL\w*Exception\b/]
];
/**
 * RFC 1918 addresses, with real octet bounds.
 *
 * The bounds and the surrounding lookarounds matter: a loose `\d{1,3}` pattern
 * matches SVG path data like `10.669.606.225`, which is the kind of confident,
 * wrong finding that makes a scanner useless.
 */
const INTERNAL_HOST = /(?<![\d.])(?:10\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d))(?![\d.])/;
const FILESYSTEM_PATH = /(?:\/(?:home|Users|var\/www|opt|srv|root)\/[\w.-]+(?:\/[\w.-]+){1,}|[A-Za-z]:\\(?:Users|inetpub|wwwroot)\\[\w.-]+(?:\\[\w.-]+){1,})/;
function analyzeDisclosure(evidence) {
    const { url, primary } = evidence;
    const body = primary.bodySample || "";
    const headers = primary.headers;
    const checks = [];
    const headerText = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join("\n");
    const haystack = `${headerText}\n${body}`;
    // Credential material in the response.
    const found = [];
    for (const pattern of exports.SECRET_PATTERNS) {
        // A JWT in an auth response is expected, so it is reported by the auth
        // checks instead of being double-counted as an accidental leak here.
        if (pattern.id === "jwt-token")
            continue;
        const match = pattern.pattern.exec(haystack);
        if (match && !isDocumentedExampleCredential(match[0]))
            found.push({ pattern, sample: match[0] });
    }
    if (found.length) {
        for (const { pattern, sample } of found) {
            checks.push(make(`disclosure.secret.${pattern.id}`, "disclosure", `${pattern.label} appears in the response`, "fail", pattern.severity, `The response body or headers contain a value matching the format of a ${pattern.label.toLowerCase()}. Anything a client can fetch is effectively public.`, {
                target: url,
                evidence: `${pattern.label}: ${sample.slice(0, 6)}${"•".repeat(Math.min(18, Math.max(0, sample.length - 6)))}`,
                remediation: pattern.remediation,
                reference: OWASP.a02
            }));
        }
    }
    else {
        checks.push(make("disclosure.secret", "disclosure", "No credential material in the response", "pass", "none", "The response body and headers were matched against known credential formats (cloud keys, provider tokens, private keys, connection strings) with no hit.", { target: url }));
    }
    // Stack traces.
    const trace = STACK_TRACE_SIGNATURES.find(([, pattern]) => pattern.test(body));
    if (trace) {
        checks.push(make("disclosure.stacktrace", "disclosure", "Response contains a server stack trace", "fail", "medium", `The body includes a ${trace[0]} stack trace. Traces name internal classes, file paths, library versions and line numbers, which hands an attacker a map of the application.`, {
            target: url,
            evidence: truncate((body.match(trace[1]) || [""])[0], 180),
            remediation: "Return a generic error body with a correlation id in production and log the trace server-side only. Turn framework debug mode off.",
            reference: OWASP.a05
        }));
    }
    // SQL errors - these point at an injection surface as well as a leak.
    const sqlError = SQL_ERROR_SIGNATURES.find(([, pattern]) => pattern.test(body));
    if (sqlError) {
        checks.push(make("disclosure.sqlerror", "disclosure", "Response contains a database error message", "fail", "high", `The body includes a ${sqlError[0]} error. A raw database error reaching the client both leaks schema detail and is the classic signal that unvalidated input reaches a query.`, {
            target: url,
            evidence: truncate((body.match(sqlError[1]) || [""])[0], 180),
            remediation: "Catch database errors and return a generic message. Then check the query that produced it uses parameter binding rather than string concatenation.",
            reference: OWASP.a03
        }));
    }
    // Directory listing.
    if (/<title>\s*Index of \/|<h1>\s*Index of \/|Directory listing for \//i.test(body)) {
        checks.push(make("disclosure.dirlisting", "disclosure", "Directory listing is enabled", "fail", "medium", "The server returned an auto-generated file index instead of a document, so the full contents of the directory are browsable.", {
            target: url,
            evidence: truncate((body.match(/<title>[^<]*Index of \/[^<]*<\/title>/i) || ["Index of /"])[0], 120),
            remediation: "Disable auto-indexing (`autoindex off` in nginx, `Options -Indexes` in Apache) and serve an explicit index file.",
            reference: OWASP.a05
        }));
    }
    // Internal addresses and filesystem paths.
    const internal = INTERNAL_HOST.exec(body);
    if (internal) {
        checks.push(make("disclosure.internal-host", "disclosure", "Response exposes an internal network address", "warn", "low", `The body contains the private address ${internal[0]}, which describes internal network layout that an attacker would otherwise have to guess.`, {
            target: url, evidence: internal[0],
            remediation: "Strip internal hostnames and addresses from error payloads and API responses.",
            reference: OWASP.a05
        }));
    }
    const fsPath = FILESYSTEM_PATH.exec(body);
    if (fsPath) {
        checks.push(make("disclosure.path", "disclosure", "Response exposes a server filesystem path", "warn", "low", `The body contains the path \`${fsPath[0]}\`, which reveals the deployment layout and often the account the service runs as.`, {
            target: url, evidence: fsPath[0],
            remediation: "Return errors without absolute paths; map them to a generic message and log the detail server-side.",
            reference: OWASP.a05
        }));
    }
    // Source maps shipped to production.
    if (/\/\/[#@]\s*sourceMappingURL=(?!data:)/.test(body)) {
        checks.push(make("disclosure.sourcemap", "disclosure", "Response references a source map", "warn", "low", "A `sourceMappingURL` comment points at a map file. If the map is actually served, the original, unminified source - including comments and internal names - is downloadable.", {
            target: url,
            evidence: truncate((body.match(/\/\/[#@]\s*sourceMappingURL=\S+/) || [""])[0], 140),
            remediation: "Stop publishing source maps to production, or upload them to your error tracker and block them at the edge.",
            reference: OWASP.a05
        }));
    }
    // Debug headers.
    const debugHeaders = Object.keys(headers).filter(name => /^x-(debug|trace|sql|query|dev|test)\b/.test(name));
    if (debugHeaders.length) {
        checks.push(make("disclosure.debug-headers", "disclosure", "Debug headers are present on the response", "warn", "medium", `The response carries ${debugHeaders.join(", ")}. Debug instrumentation left on in production usually exposes queries, timings or internal identifiers.`, {
            target: url,
            evidence: debugHeaders.map(name => `${name}: ${truncate(headers[name], 60)}`).join(" · "),
            remediation: "Gate debug headers behind a non-production environment flag.",
            reference: OWASP.a05
        }));
    }
    // A published vulnerability-disclosure policy.
    if (evidence.securityTxt) {
        const txt = evidence.securityTxt;
        const valid = !txt.error && txt.status === 200 && /^\s*Contact\s*:/im.test(txt.bodySample);
        checks.push(valid
            ? make("disclosure.securitytxt", "configuration", "A security.txt disclosure policy is published", "pass", "none", "`/.well-known/security.txt` is served with a Contact field, so a researcher who finds a problem has a documented way to report it.", { target: txt.url, evidence: truncate(txt.bodySample.split(/\r?\n/).filter(Boolean).slice(0, 3).join(" · "), 180), reference: "RFC 9116" })
            : make("disclosure.securitytxt", "configuration", "No security.txt disclosure policy", "info", "none", "`/.well-known/security.txt` is not published. It is not a vulnerability, but without it a researcher who finds one has no documented route to report it.", {
                target: txt.url,
                remediation: "Publish `/.well-known/security.txt` with at least a `Contact:` and an `Expires:` field (RFC 9116).",
                reference: "RFC 9116"
            }));
    }
    // Exposed well-known paths (only when the content signature confirmed it).
    if (evidence.exposedPaths?.length) {
        const confirmed = evidence.exposedPaths.filter(entry => entry.confirmed);
        if (confirmed.length) {
            for (const entry of confirmed) {
                checks.push(make(`disclosure.path.${entry.path.replace(/[^\w]+/g, "-")}`, "disclosure", `Sensitive path is publicly readable: ${entry.path}`, "fail", /\.env|\.git|config|credential|backup|\.sql/i.test(entry.path) ? "critical" : "medium", `\`${entry.path}\` returned ${entry.observation.status} with content matching ${entry.signature}, so the file is genuinely being served rather than swallowed by a catch-all route.`, {
                    target: entry.url,
                    evidence: `HTTP ${entry.observation.status} · ${entry.observation.bodyBytes} bytes · matched ${entry.signature}`,
                    remediation: "Block the path at the web server or CDN, remove the file from the deployment artifact, and rotate every credential it contained.",
                    reference: OWASP.a05
                }));
            }
        }
        else {
            checks.push(make("disclosure.wellknown", "disclosure", "No sensitive well-known path is exposed", "pass", "none", `${evidence.exposedPaths.length} well-known sensitive path(s) were requested (.env, .git, config and backup files, debug endpoints). None returned content matching its signature.`, { target: url }));
        }
    }
    return checks;
}
exports.analyzeDisclosure = analyzeDisclosure;
/* ------------------------------------------------------------------ *
 * API security & common vulnerabilities
 * ------------------------------------------------------------------ */
function analyzeApiSecurity(evidence) {
    const { url, primary, trace } = evidence;
    const headers = primary.headers;
    const checks = [];
    const contentType = (headers["content-type"] || "").toLowerCase();
    const body = primary.bodySample || "";
    // Content-Type correctness.
    if (!contentType) {
        if (primary.bodyBytes > 0) {
            checks.push(make("api.content-type", "api", "Response has a body but no Content-Type", "warn", "medium", "Without a declared Content-Type the browser guesses, and a guess can turn data into an executable document. This is the case `nosniff` alone cannot fix.", {
                target: url, evidence: "Content-Type: (absent)",
                remediation: "Always set an explicit Content-Type with a charset, for example `application/json` or `text/html; charset=utf-8`.",
                reference: OWASP.a05
            }));
        }
    }
    else {
        const looksJson = /^\s*[[{]/.test(body.trim());
        if (looksJson && contentType.includes("text/html")) {
            checks.push(make("api.content-type", "api", "JSON payload is served as text/html", "fail", "medium", "The body parses as JSON but is labelled `text/html`. A browser renders it as a document, which turns any attacker-controlled string in the payload into stored XSS.", {
                target: url, evidence: `Content-Type: ${headers["content-type"]}`,
                remediation: "Return `application/json` for JSON payloads and keep `X-Content-Type-Options: nosniff` on.",
                reference: OWASP.a03
            }));
        }
        else if (contentType.startsWith("text/") && !contentType.includes("charset")) {
            checks.push(make("api.content-type", "api", "Textual response declares no charset", "warn", "low", "A text response without an explicit charset is decoded by a browser heuristic; UTF-7 style confusion attacks rely on exactly that.", {
                target: url, evidence: `Content-Type: ${headers["content-type"]}`,
                remediation: "Append `; charset=utf-8` to the Content-Type.",
                reference: OWASP.a05
            }));
        }
        else {
            checks.push(make("api.content-type", "api", "Content-Type is declared correctly", "pass", "none", `The response declares \`${headers["content-type"]}\` and the body matches it.`, { target: url, evidence: `Content-Type: ${headers["content-type"]}` }));
        }
    }
    // TRACE / cross-site tracing.
    if (trace && !trace.error) {
        const echoed = trace.status === 200 && /TRACE\s+\/|message\/http/i.test(`${trace.headers["content-type"] || ""}\n${trace.bodySample}`);
        checks.push(echoed
            ? make("api.trace", "api", "The TRACE method is enabled", "fail", "medium", "TRACE echoes the request back, including headers the client cannot normally read. It is the basis of cross-site tracing and has no legitimate production use.", {
                target: url, evidence: `TRACE → HTTP ${trace.status}`,
                remediation: "Disable TRACE at the web server (`TraceEnable Off` in Apache; nginx does not implement it, so check any proxy in front).",
                reference: OWASP.a05
            })
            : make("api.trace", "api", "The TRACE method is not enabled", "pass", "none", `A TRACE request returned ${trace.status} without echoing the request.`, { target: url, evidence: `TRACE → HTTP ${trace.status}` }));
    }
    // Allowed methods advertised by the preflight/OPTIONS response.
    const allow = primary.headers["allow"] || evidence.corsPreflight?.headers["allow"] || "";
    if (allow) {
        const methods = allow.split(",").map(m => m.trim().toUpperCase()).filter(Boolean);
        const risky = methods.filter(m => ["TRACE", "TRACK", "CONNECT", "PROPFIND", "PUT", "DELETE"].includes(m));
        checks.push(risky.length
            ? make("api.methods", "api", "The resource advertises unusual HTTP methods", "warn", "medium", `The Allow header lists ${risky.join(", ")}. Confirm every one of those is intentional and authorized; WebDAV and TRACE methods are frequently enabled by default and never used.`, {
                target: url, evidence: `Allow: ${allow}`,
                remediation: "Restrict the method set to what the route implements and reject the rest with 405.",
                reference: OWASP.a05
            })
            : make("api.methods", "api", "Advertised HTTP methods are ordinary", "pass", "none", `Allow: ${allow}`, { target: url, evidence: `Allow: ${allow}` }));
    }
    // Verbose framework error pages.
    if (primary.status >= 500 && primary.bodyBytes > 500 && /(exception|stack|traceback|error at line|debug)/i.test(body)) {
        checks.push(make("api.verbose-error", "api", "Server error returns a verbose body", "warn", "medium", `The endpoint answered ${primary.status} with a ${primary.bodyBytes}-byte body containing error detail. Production errors should be terse.`, {
            target: url, evidence: truncate(body, 180),
            remediation: "Return a generic error payload with a correlation id; keep the detail in server logs.",
            reference: OWASP.a05
        }));
    }
    // GraphQL introspection, when the endpoint looks like one.
    if (/graphql/i.test(url) && /"__schema"|"types"\s*:\s*\[|__typename/.test(body)) {
        checks.push(make("api.graphql-introspection", "api", "GraphQL introspection appears to be enabled", "warn", "medium", "The response exposes schema metadata. Introspection hands an attacker the full type graph, including fields and mutations that are not used by your own client.", {
            target: url, evidence: truncate((body.match(/"__schema"[\s\S]{0,80}/) || ["__schema"])[0], 140),
            remediation: "Disable introspection in production, or gate it behind an authenticated role.",
            reference: OWASP.api8
        }));
    }
    // Mixed content, which only applies to a page that is itself HTTPS.
    if (isHttps(url) && isHtmlResponse(headers, body)) {
        const mixed = body.match(/(?:src|href)\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1)[^"']+/gi) || [];
        const active = mixed.filter(entry => /^src/i.test(entry));
        if (active.length) {
            checks.push(make("api.mixed-content", "api", "HTTPS page loads active content over plain HTTP", "fail", "high", `${active.length} subresource(s) are referenced with an http:// URL. Browsers block active mixed content, and where it is not blocked it lets a network attacker replace the script entirely.`, {
                target: url, evidence: truncate(active.slice(0, 3).join(" · "), 220),
                remediation: "Serve every subresource over https, or add `upgrade-insecure-requests` to the CSP while the URLs are being fixed.",
                reference: OWASP.a02
            }));
        }
        else if (mixed.length) {
            checks.push(make("api.mixed-content", "api", "HTTPS page references plain-HTTP URLs", "warn", "low", `${mixed.length} passive reference(s) use http://. Browsers usually block or upgrade these, but they should not be in the markup.`, {
                target: url, evidence: truncate(mixed.slice(0, 3).join(" · "), 220),
                remediation: "Rewrite the URLs to https or make them protocol-relative to your own origin.",
                reference: OWASP.a02
            }));
        }
        else {
            checks.push(make("api.mixed-content", "api", "No mixed content in the document", "pass", "none", "Every subresource URL in the returned HTML uses https or a relative path.", { target: url }));
        }
    }
    // Markup hygiene, which applies to any HTML document regardless of scheme.
    if (isHtmlResponse(headers, body)) {
        // target="_blank" without rel=noopener.
        const blanks = body.match(/<a\b[^>]*target\s*=\s*["']?_blank["']?[^>]*>/gi) || [];
        const unsafeBlanks = blanks.filter(tag => !/rel\s*=\s*["'][^"']*noopener/i.test(tag));
        if (unsafeBlanks.length) {
            checks.push(make("api.reverse-tabnabbing", "api", "Links open a new tab without rel=\"noopener\"", "warn", "low", `${unsafeBlanks.length} link(s) use target="_blank" without rel="noopener". The opened page gets a \`window.opener\` reference it can use to navigate the original tab to a phishing page.`, {
                target: url, evidence: truncate(unsafeBlanks[0], 160),
                remediation: "Add `rel=\"noopener noreferrer\"` to every external `target=\"_blank\"` link. Modern browsers imply noopener, but older ones do not.",
                reference: OWASP.a05
            }));
        }
        // Subresource integrity on third-party scripts.
        const externalScripts = body.match(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi) || [];
        const thirdParty = externalScripts.filter(tag => {
            const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || "";
            return hostOf(src) && hostOf(src) !== hostOf(url);
        });
        const withoutSri = thirdParty.filter(tag => !/\bintegrity\s*=/i.test(tag));
        if (withoutSri.length) {
            checks.push(make("api.sri", "api", "Third-party scripts load without subresource integrity", "warn", "medium", `${withoutSri.length} of ${thirdParty.length} cross-origin script tag(s) carry no \`integrity\` attribute. If that CDN or vendor is compromised, the modified script runs with full access to this page.`, {
                target: url, evidence: truncate(withoutSri[0], 180),
                remediation: "Add `integrity=\"sha384-...\" crossorigin=\"anonymous\"` to pinned third-party scripts, or self-host them.",
                reference: OWASP.a06
            }));
        }
        else if (thirdParty.length) {
            checks.push(make("api.sri", "api", "Third-party scripts use subresource integrity", "pass", "none", `All ${thirdParty.length} cross-origin script tag(s) carry an integrity hash.`, { target: url }));
        }
    }
    return checks;
}
exports.analyzeApiSecurity = analyzeApiSecurity;
/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */
const RATE_LIMIT_HEADERS = [
    "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "ratelimit-policy",
    "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
    "x-rate-limit-limit", "retry-after"
];
function analyzeRateLimit(evidence) {
    const { url, primary, burst } = evidence;
    const checks = [];
    const present = RATE_LIMIT_HEADERS.filter(name => primary.headers[name] !== undefined);
    if (present.length) {
        checks.push(make("ratelimit.headers", "rate-limit", "The endpoint advertises a rate-limit policy", "pass", "none", `The response carries ${present.join(", ")}, so clients can see and respect the quota.`, {
            target: url,
            evidence: present.map(name => `${name}: ${primary.headers[name]}`).join(" · "),
            reference: OWASP.api4
        }));
    }
    else {
        checks.push(make("ratelimit.headers", "rate-limit", "No rate-limit headers on the response", "warn", "low", "The response does not expose a quota. A limiter can still be in place at the edge, so this is a signal rather than a verdict - the burst probe below tests the behaviour itself.", {
            target: url, evidence: "RateLimit-* / X-RateLimit-* / Retry-After: (absent)",
            remediation: "Return `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (RFC 9239 draft) so clients can back off before they are blocked.",
            reference: OWASP.api4
        }));
    }
    if (!burst) {
        checks.push(make("ratelimit.burst", "rate-limit", "Rate-limit behaviour", "skipped", "none", "The burst probe was not run. Enable it in the scan options to send a short series of requests and observe whether the endpoint throttles them.", { target: url }));
        return checks;
    }
    const rate = burst.elapsedMs > 0 ? Math.round((burst.requests / burst.elapsedMs) * 1000) : 0;
    if (burst.limited > 0) {
        checks.push(make("ratelimit.burst", "rate-limit", "The endpoint throttles a request burst", "pass", "none", `${burst.limited} of ${burst.requests} rapid requests were answered with 429 or 503, so abuse protection is active.`, {
            target: url,
            evidence: `${burst.requests} requests in ${burst.elapsedMs}ms (~${rate}/s) · ${burst.limited} throttled`,
            reference: OWASP.api4
        }));
    }
    else {
        checks.push(make("ratelimit.burst", "rate-limit", "No throttling observed during a request burst", "warn", "medium", `${burst.requests} requests were sent in ${burst.elapsedMs}ms (about ${rate} per second) and none was rejected. A burst this small does not prove there is no limiter, but it does show none applies at this rate - enough for credential stuffing or scraping on an authentication or search endpoint.`, {
            target: url,
            evidence: `${burst.requests} requests, statuses: ${Array.from(new Set(burst.statuses)).join(", ")} · 0 throttled`,
            remediation: "Apply a per-identity and per-IP limit at the edge or in middleware, tighter on authentication, password-reset and search routes, and answer with 429 plus Retry-After.",
            reference: OWASP.api4
        }));
    }
    return checks;
}
exports.analyzeRateLimit = analyzeRateLimit;
/* ------------------------------------------------------------------ *
 * Input validation & injection signals
 * ------------------------------------------------------------------ */
/**
 * The marker used by the reflection probe.
 *
 * It contains the characters that matter for HTML and attribute contexts but
 * forms no tag and no executable payload, so the probe is observational: it
 * shows whether output is encoded, without attempting an exploit.
 */
function buildReflectionMarker() {
    const random = Math.random().toString(36).slice(2, 8);
    return `dsq${random}<>"'`;
}
exports.buildReflectionMarker = buildReflectionMarker;
function analyzeInjection(evidence) {
    const { url, reflection, primary } = evidence;
    const checks = [];
    // A database error in the ordinary response is an injection-surface signal.
    const sqlSignal = SQL_ERROR_SIGNATURES.find(([, pattern]) => pattern.test(primary.bodySample || ""));
    if (sqlSignal) {
        checks.push(make("injection.sql-signal", "injection", "A raw database error reached the client", "fail", "high", `The endpoint returned a ${sqlSignal[0]} error verbatim. That means a query failed and the error was not handled - the same path that lets unvalidated input reach the query in the first place.`, {
            target: url,
            evidence: truncate((primary.bodySample.match(sqlSignal[1]) || [""])[0], 180),
            remediation: "Use parameterised queries or an ORM binding for every value that comes from a request, and return a generic error to the client.",
            reference: OWASP.a03
        }));
    }
    if (!reflection) {
        checks.push(make("injection.reflection", "injection", "Reflected-input handling", "skipped", "none", "The reflection probe was not run. Enable active checks to send a harmless marker string and observe whether the response encodes it.", { target: url }));
        return checks;
    }
    const observation = reflection.observation;
    if (observation.error) {
        checks.push(make("injection.reflection", "injection", "Reflected-input handling", "skipped", "none", `The reflection probe failed: ${observation.error}`, { target: url, evidence: observation.error }));
        return checks;
    }
    const body = observation.bodySample || "";
    const marker = reflection.marker;
    const base = marker.replace(/[<>"']/g, "");
    const html = isHtmlResponse(observation.headers, body);
    if (!body.includes(base)) {
        checks.push(make("injection.reflection", "injection", "Input is not reflected in the response", "pass", "none", "A marker string was sent as a query parameter and does not appear in the response body, so this endpoint has no reflected-output surface on that parameter.", { target: observation.url, evidence: `marker "${base}" not found in ${observation.bodyBytes} bytes` }));
        return checks;
    }
    const raw = body.includes(marker);
    const encoded = body.includes(base) && !raw;
    if (raw && html) {
        checks.push(make("injection.reflection", "injection", "Input is reflected into HTML without encoding", "fail", "high", "The marker string was echoed back into an HTML response with its `<`, `>`, `\"` and `'` characters intact. Unencoded reflection into a document is the precondition for reflected cross-site scripting.", {
            target: observation.url,
            evidence: truncate(body.slice(Math.max(0, body.indexOf(marker) - 60), body.indexOf(marker) + marker.length + 60), 220),
            remediation: "Contextually encode every value interpolated into a response (HTML-escape for text, attribute-escape inside attributes, JSON-encode inside script blocks) and keep a CSP without 'unsafe-inline' as the second layer.",
            reference: OWASP.a03
        }));
    }
    else if (raw && !html) {
        checks.push(make("injection.reflection", "injection", "Input is reflected verbatim in a non-HTML response", "warn", "low", `The marker was echoed back unchanged in a \`${observation.headers["content-type"] || "unknown"}\` response. A browser does not render it, so this is not directly exploitable, but it shows the value is passed through without validation.`, {
            target: observation.url,
            evidence: truncate(body.slice(Math.max(0, body.indexOf(marker) - 40), body.indexOf(marker) + marker.length + 40), 200),
            remediation: "Validate the parameter against an expected shape and make sure the same value is encoded wherever it is rendered.",
            reference: OWASP.a03
        }));
    }
    else if (encoded) {
        checks.push(make("injection.reflection", "injection", "Reflected input is encoded correctly", "pass", "none", "The marker appears in the response, but its HTML metacharacters were encoded, which is exactly the expected behaviour.", { target: observation.url, evidence: `marker reflected with "<>\\"'" encoded` }));
    }
    return checks;
}
exports.analyzeInjection = analyzeInjection;
/** Runs every endpoint analyzer over collected evidence. */
function analyzeEndpoint(evidence) {
    const analyzers = [
        analyzeTransport,
        analyzeHsts,
        analyzeSecurityHeaders,
        analyzeCsp,
        analyzeCors,
        analyzeCookies,
        analyzeAuth,
        analyzeApiSecurity,
        analyzeDisclosure,
        analyzeRateLimit,
        analyzeInjection
    ];
    // A request that never completed produces no evidence. Reporting "header
    // missing" for a host that was never reached would be a false result, so the
    // scan says what actually happened instead.
    if (evidence.primary.error || evidence.primary.status === 0) {
        return [make("engine.unreachable", "configuration", "The endpoint could not be reached", "skipped", "none", `No response was received, so no check could be evaluated: ${evidence.primary.error || "the connection produced no status"}. Confirm the URL, that the host is reachable from this machine, and that no proxy or firewall is blocking it.`, {
                target: evidence.url,
                evidence: `${evidence.primary.method} ${evidence.url} → ${evidence.primary.errorCode || "no response"}`,
                remediation: "Check the hostname and port, then retry. For an endpoint behind a VPN or a corporate proxy, run the scan from a network that can reach it."
            })];
    }
    const checks = [];
    const seen = new Set();
    for (const analyzer of analyzers) {
        let produced = [];
        try {
            produced = analyzer(evidence);
        }
        catch (error) {
            // A rule that throws must not take the whole report down with it.
            produced = [make(`engine.${analyzer.name}`, "configuration", `The ${analyzer.name} rule set failed to run`, "skipped", "none", `This group of checks was skipped because it raised an error: ${error instanceof Error ? error.message : String(error)}`, { target: evidence.url })];
        }
        for (const check of produced) {
            // Ids must stay unique so the UI can key, filter and suppress by id.
            let id = check.id;
            let suffix = 2;
            while (seen.has(id))
                id = `${check.id}#${suffix++}`;
            seen.add(id);
            checks.push(id === check.id ? check : { ...check, id });
        }
    }
    return checks;
}
exports.analyzeEndpoint = analyzeEndpoint;
//# sourceMappingURL=security-analysis.js.map