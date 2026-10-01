import { ToolInputError } from "../types";

/**
 * CORS (config generation, a browser-accurate check of response headers,
 * and an explainer for console errors) and Content-Security-Policy /
 * security headers (build and analyse).
 */

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

export interface CorsOptions {
  origins: string[];
  methods: string[];
  headers: string[];
  exposeHeaders: string[];
  credentials: boolean;
  maxAge: number;
}

const js = JSON.stringify;

/** An origin pattern like https://*.example.com → RegExp source. */
function originRegex(pattern: string): string {
  return `^${pattern.replace(/[.+?^${}()|[\]\\/]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+")}$`;
}

export function corsConfigs(o: CorsOptions): Record<string, string> {
  const any = o.origins.includes("*");
  const wild = o.origins.filter(x => x.includes("*") && x !== "*");
  const exact = o.origins.filter(x => !x.includes("*"));
  const originList = `[${exact.map(x => js(x)).join(", ")}]`;
  const regexes = wild.map(w => `/${originRegex(w)}/`);
  const allowFn = any && !o.credentials
    ? `const isAllowedOrigin = (_origin: string) => true;`
    : `const ALLOWED_ORIGINS = ${originList};\n${regexes.length ? `const ALLOWED_PATTERNS = [${regexes.join(", ")}];\n` : ""}const isAllowedOrigin = (origin: string) =>\n  ALLOWED_ORIGINS.includes(origin)${regexes.length ? " || ALLOWED_PATTERNS.some(p => p.test(origin))" : ""};`;
  const methods = o.methods.join(",");
  const express = `import cors from "cors";\nimport express from "express";\n\n${allowFn}\n\nconst app = express();\napp.use(cors({\n  origin: (origin, callback) => {\n    // Requests without an Origin header (curl, mobile apps, server-to-server) are not CORS requests.\n    if (!origin || isAllowedOrigin(origin)) return callback(null, true);\n    callback(new Error(\`Origin \${origin} is not allowed by CORS\`));\n  },\n  methods: ${js(o.methods)},\n  allowedHeaders: ${js(o.headers)},\n${o.exposeHeaders.length ? `  exposedHeaders: ${js(o.exposeHeaders)},\n` : ""}  credentials: ${o.credentials},\n  maxAge: ${o.maxAge},\n}));\n`;
  const nest = `// main.ts\nimport { NestFactory } from "@nestjs/core";\nimport { AppModule } from "./app.module";\n\n${allowFn}\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.enableCors({\n    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {\n      if (!origin || isAllowedOrigin(origin)) return callback(null, true);\n      callback(new Error(\`Origin \${origin} is not allowed by CORS\`));\n    },\n    methods: ${js(o.methods)},\n    allowedHeaders: ${js(o.headers)},\n${o.exposeHeaders.length ? `    exposedHeaders: ${js(o.exposeHeaders)},\n` : ""}    credentials: ${o.credentials},\n    maxAge: ${o.maxAge},\n  });\n  await app.listen(process.env.PORT ?? 3000);\n}\nvoid bootstrap();\n`;
  const next = `// middleware.ts (project root) - CORS for /api routes in the Next.js App Router\nimport { NextRequest, NextResponse } from "next/server";\n\n${allowFn}\n\nconst CORS_HEADERS: Record<string, string> = {\n  "Access-Control-Allow-Methods": ${js(methods)},\n  "Access-Control-Allow-Headers": ${js(o.headers.join(","))},\n${o.exposeHeaders.length ? `  "Access-Control-Expose-Headers": ${js(o.exposeHeaders.join(","))},\n` : ""}${o.credentials ? `  "Access-Control-Allow-Credentials": "true",\n` : ""}  "Access-Control-Max-Age": ${js(String(o.maxAge))},\n};\n\nexport function middleware(request: NextRequest) {\n  const origin = request.headers.get("origin") ?? "";\n  const allowed = origin !== "" && isAllowedOrigin(origin);\n\n  if (request.method === "OPTIONS") {\n    // Preflight: answer directly with 204.\n    return new NextResponse(null, {\n      status: 204,\n      headers: allowed ? { ...CORS_HEADERS, "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {},\n    });\n  }\n\n  const response = NextResponse.next();\n  if (allowed) {\n    response.headers.set("Access-Control-Allow-Origin", origin);\n    response.headers.set("Vary", "Origin");\n    for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);\n  }\n  return response;\n}\n\nexport const config = { matcher: "/api/:path*" };\n`;
  const fastify = `import Fastify from "fastify";\nimport cors from "@fastify/cors";\n\n${allowFn}\n\nconst app = Fastify();\nawait app.register(cors, {\n  origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),\n  methods: ${js(o.methods)},\n  allowedHeaders: ${js(o.headers)},\n${o.exposeHeaders.length ? `  exposedHeaders: ${js(o.exposeHeaders)},\n` : ""}  credentials: ${o.credentials},\n  maxAge: ${o.maxAge},\n});\n`;
  const nginxOrigins = any && !o.credentials ? "" : [...exact.map(x => `    ${js(x)} $http_origin;`), ...wild.map(w => `    "~${originRegex(w)}" $http_origin;`)].join("\n");
  const nginx = `# http { } block\n${nginxOrigins ? `map $http_origin $cors_origin {\n    default "";\n${nginxOrigins}\n}\n\n` : ""}# server { } block\nlocation /api/ {\n    add_header Access-Control-Allow-Origin ${nginxOrigins ? "$cors_origin" : '"*"'} always;\n    add_header Vary Origin always;\n${o.credentials ? "    add_header Access-Control-Allow-Credentials true always;\n" : ""}${o.exposeHeaders.length ? `    add_header Access-Control-Expose-Headers "${o.exposeHeaders.join(", ")}" always;\n` : ""}\n    if ($request_method = OPTIONS) {\n        add_header Access-Control-Allow-Origin ${nginxOrigins ? "$cors_origin" : '"*"'} always;\n        add_header Vary Origin always;\n${o.credentials ? "        add_header Access-Control-Allow-Credentials true always;\n" : ""}        add_header Access-Control-Allow-Methods "${o.methods.join(", ")}" always;\n        add_header Access-Control-Allow-Headers "${o.headers.join(", ")}" always;\n        add_header Access-Control-Max-Age ${o.maxAge} always;\n        return 204;\n    }\n\n    proxy_pass http://127.0.0.1:3000;\n}\n`;
  const fastapi = `from fastapi import FastAPI\nfrom fastapi.middleware.cors import CORSMiddleware\n\napp = FastAPI()\napp.add_middleware(\n    CORSMiddleware,\n    allow_origins=${js(any && !o.credentials ? ["*"] : exact)},\n${wild.length ? `    allow_origin_regex=${js(wild.map(w => originRegex(w)).join("|"))},\n` : ""}    allow_methods=${js(o.methods)},\n    allow_headers=${js(o.headers)},\n${o.exposeHeaders.length ? `    expose_headers=${js(o.exposeHeaders)},\n` : ""}    allow_credentials=${o.credentials ? "True" : "False"},\n    max_age=${o.maxAge},\n)\n`;
  return { express, nest, next, fastify, nginx, fastapi };
}

export interface CorsCheck {
  origin: string;
  method: string;
  requestHeaders: string[];
  credentials: boolean;
  responseHeaders: string;
  preflightStatus?: number;
}

export interface CorsVerdict { preflightNeeded: boolean; passed: boolean; steps: Array<{ ok: boolean; text: string }> }

const SAFELISTED_HEADERS = new Set(["accept", "accept-language", "content-language", "content-type", "range"]);
const SIMPLE_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

/** Applies the browser's CORS algorithm to a set of response headers. */
export function checkCors(c: CorsCheck): CorsVerdict {
  const headers = new Map<string, string[]>();
  for (const line of c.responseHeaders.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0 || /^HTTP\//i.test(line)) continue;
    const k = line.slice(0, colon).trim().toLowerCase();
    headers.set(k, [...(headers.get(k) ?? []), line.slice(colon + 1).trim()]);
  }
  const get = (k: string) => headers.get(k);
  const steps: CorsVerdict["steps"] = [];
  const method = c.method.toUpperCase();
  const custom = c.requestHeaders.map(h => h.split(":")[0].trim().toLowerCase()).filter(Boolean);
  const contentType = c.requestHeaders.find(h => /^content-type\s*:/i.test(h))?.split(":")[1]?.trim().toLowerCase();
  const nonSimpleHeaders = custom.filter(h => !SAFELISTED_HEADERS.has(h) || (h === "content-type" && !(contentType && SIMPLE_TYPES.some(t => contentType.startsWith(t)))));
  const preflightNeeded = !["GET", "HEAD", "POST"].includes(method) || nonSimpleHeaders.length > 0;
  steps.push({ ok: true, text: preflightNeeded ? `A preflight OPTIONS request is sent first (${!["GET", "HEAD", "POST"].includes(method) ? `method ${method}` : `headers ${nonSimpleHeaders.join(", ")}`}).` : "This is a simple request: no preflight; the browser checks the actual response." });
  if (preflightNeeded && c.preflightStatus !== undefined) {
    const ok = c.preflightStatus >= 200 && c.preflightStatus < 300;
    steps.push({ ok, text: ok ? `Preflight status ${c.preflightStatus} is OK.` : `Preflight returned ${c.preflightStatus}; it must be 2xx (redirects are not followed). Make OPTIONS bypass auth and return 204.` });
  }
  const acao = get("access-control-allow-origin");
  if (!acao) steps.push({ ok: false, text: "No Access-Control-Allow-Origin header. The server (or a proxy/error page) did not add CORS headers to this response." });
  else if (acao.length > 1 || acao[0].includes(",")) steps.push({ ok: false, text: `Access-Control-Allow-Origin has multiple values (${acao.join(" | ")}). Send exactly one origin - often both the app and a proxy add it.` });
  else if (acao[0] === "*" && c.credentials) steps.push({ ok: false, text: "Access-Control-Allow-Origin is * but the request uses credentials (cookies / withCredentials / credentials: \"include\"). Echo the exact origin instead." });
  else if (acao[0] !== "*" && acao[0] !== c.origin) steps.push({ ok: false, text: `Access-Control-Allow-Origin is "${acao[0]}" but the page origin is "${c.origin}". They must match exactly (scheme, host and port; no trailing slash).` });
  else steps.push({ ok: true, text: `Access-Control-Allow-Origin "${acao[0]}" matches.` });
  if (acao && acao[0] !== "*" && !(get("vary") ?? []).some(v => /origin/i.test(v))) steps.push({ ok: true, text: "Tip: add Vary: Origin when the allowed origin depends on the request, or a CDN may serve one origin's response to another." });
  if (c.credentials) {
    const acac = get("access-control-allow-credentials")?.[0];
    steps.push(acac === "true" ? { ok: true, text: "Access-Control-Allow-Credentials: true is present." } : { ok: false, text: "Credentials mode requires Access-Control-Allow-Credentials: true (exactly lowercase \"true\")." });
  }
  if (preflightNeeded) {
    const allowMethods = (get("access-control-allow-methods") ?? []).join(",").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    const wildcard = allowMethods.includes("*") && !c.credentials;
    if (!["GET", "HEAD", "POST"].includes(method)) steps.push(wildcard || allowMethods.includes(method) ? { ok: true, text: `Method ${method} is allowed.` } : { ok: false, text: `Method ${method} is not in Access-Control-Allow-Methods (${allowMethods.join(", ") || "missing"}).` });
    const allowHeaders = (get("access-control-allow-headers") ?? []).join(",").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const hWild = allowHeaders.includes("*") && !c.credentials;
    const missing = nonSimpleHeaders.filter(h => !(hWild && h !== "authorization") && !allowHeaders.includes(h));
    if (nonSimpleHeaders.length) steps.push(missing.length ? { ok: false, text: `Request header${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not allowed by Access-Control-Allow-Headers (${allowHeaders.join(", ") || "missing"})${missing.includes("authorization") && hWild ? " - * never covers Authorization" : ""}.` } : { ok: true, text: `Headers ${nonSimpleHeaders.join(", ")} are allowed.` });
  }
  return { preflightNeeded, passed: steps.every(s => s.ok), steps };
}

const CORS_ERRORS: Array<{ re: RegExp; title: string; fix: string }> = [
  { re: /No 'Access-Control-Allow-Origin' header is present/i, title: "The response has no Access-Control-Allow-Origin header", fix: "Enable CORS on the server for this origin. If CORS is configured, the failing response is probably an error (401/404/500) produced before the CORS middleware runs, or a proxy/CDN page: register CORS first and check the Network tab's actual status." },
  { re: /must not be the wildcard '\*' when the request's credentials mode is 'include'/i, title: "Wildcard origin with credentials", fix: "With cookies or Authorization via credentials: \"include\" / withCredentials, return the exact request origin (and Vary: Origin) instead of *, plus Access-Control-Allow-Credentials: true." },
  { re: /Access-Control-Allow-Credentials.*(must be 'true'|is '')/i, title: "Credentials not allowed", fix: "Send Access-Control-Allow-Credentials: true, or stop sending credentials (remove withCredentials / credentials: \"include\")." },
  { re: /Response to preflight request doesn't pass access control check: It does not have HTTP ok status/i, title: "Preflight OPTIONS failed", fix: "The OPTIONS request got a non-2xx status. Usually auth middleware rejects it (OPTIONS has no Authorization header) or no route handles OPTIONS. Let OPTIONS through before auth and answer 204." },
  { re: /Redirect is not allowed for a preflight request/i, title: "Preflight was redirected", fix: "The OPTIONS request got a 301/302 (http→https, missing trailing slash, login redirect). Call the final URL directly." },
  { re: /Request header field (\S+) is not allowed by Access-Control-Allow-Headers/i, title: "A request header is not allowed", fix: "Add that header to Access-Control-Allow-Headers (allowedHeaders in the cors package). Note: * never covers Authorization." },
  { re: /Method (\S+) is not allowed by Access-Control-Allow-Methods/i, title: "The HTTP method is not allowed", fix: "Add the method to Access-Control-Allow-Methods (methods in the cors package)." },
  { re: /contains multiple values/i, title: "Duplicate Access-Control-Allow-Origin", fix: "Both the app and a proxy (nginx, API gateway, CDN) add the header. Configure CORS in exactly one place." },
  { re: /that is not equal to the supplied origin/i, title: "Origin mismatch", fix: "The allowed origin differs from the page origin. Match scheme, host and port exactly (http://localhost:3000 ≠ http://127.0.0.1:3000) and avoid trailing slashes." },
  { re: /(Private Network Access|more-private address space|address space)/i, title: "Private Network Access block", fix: "A public page is calling a private/local address. Serve both from the same network, use HTTPS, or answer the preflight with Access-Control-Allow-Private-Network: true." },
  { re: /CORS request did not succeed|net::ERR_FAILED|TypeError: Failed to fetch/i, title: "Network-level failure", fix: "The request never got a response (server down, DNS, TLS error, blocked mixed content, ad blocker). Check the Network tab; it may not be a CORS problem at all." },
  { re: /Cross-Origin Read Blocking|CORB|ERR_BLOCKED_BY_ORB|OpaqueResponseBlocking/i, title: "Opaque response blocked (CORB/ORB)", fix: "A no-cors request (or <img>/<script>) received JSON/HTML. Use a normal CORS fetch and correct Content-Type." },
  { re: /mixed content/i, title: "Mixed content", fix: "An https page cannot call an http API. Serve the API over https." }
];

export function explainCorsError(text: string): Array<{ title: string; fix: string }> {
  return CORS_ERRORS.filter(e => e.re.test(text)).map(({ title, fix }) => ({ title, fix }));
}

// ---------------------------------------------------------------------------
// Content-Security-Policy and security headers
// ---------------------------------------------------------------------------

export interface CspOptions {
  self: boolean;
  scripts: string[];
  styles: string[];
  images: string[];
  connect: string[];
  fonts: string[];
  frames: string[];
  nonce: boolean;
  inlineStyles: boolean;
  upgradeInsecure: boolean;
  reportUri?: string;
  frameAncestors: "none" | "self";
}

export function buildCsp(o: CspOptions): string {
  const self = "'self'";
  const d: Array<[string, string[]]> = [
    ["default-src", [self]],
    ["script-src", [self, ...(o.nonce ? ["'nonce-{NONCE}'", "'strict-dynamic'"] : []), ...o.scripts]],
    ["style-src", [self, ...(o.inlineStyles ? ["'unsafe-inline'"] : []), ...o.styles]],
    ["img-src", [self, "data:", "blob:", ...o.images]],
    ["font-src", [self, ...o.fonts]],
    ["connect-src", [self, ...o.connect]],
    ["frame-src", o.frames.length ? o.frames : ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", [self]],
    ["form-action", [self]],
    ["frame-ancestors", [o.frameAncestors === "none" ? "'none'" : self]]
  ];
  const parts = d.map(([k, v]) => `${k} ${[...new Set(v)].join(" ")}`);
  if (o.upgradeInsecure) parts.push("upgrade-insecure-requests");
  if (o.reportUri) parts.push(`report-uri ${o.reportUri}`);
  return parts.join("; ");
}

export function securityHeaderSet(csp: string, hsts: boolean): Array<[string, string]> {
  return [
    ["Content-Security-Policy", csp],
    ...(hsts ? [["Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"] as [string, string]] : []),
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["X-Frame-Options", "DENY"]
  ];
}

export function securityHeaderConfigs(headers: Array<[string, string]>): Record<string, string> {
  const hasNonce = headers.some(([, v]) => v.includes("{NONCE}"));
  const nginx = headers.map(([k, v]) => `add_header ${k} "${v.replace(/'nonce-\{NONCE\}' /, "")}" always;`).join("\n") + (hasNonce ? "\n# nginx cannot generate per-request nonces by itself; the nonce source was removed here." : "") + "\n";
  const next = `// next.config.js${hasNonce ? " - for nonces, set the CSP in middleware.ts instead (see the Next.js CSP guide)" : ""}\nconst securityHeaders = [\n${headers.map(([k, v]) => `  { key: ${js(k)}, value: ${js(v.replace(/'nonce-\{NONCE\}' 'strict-dynamic' ?/, ""))} },`).join("\n")}\n];\n\n/** @type {import("next").NextConfig} */\nconst nextConfig = {\n  async headers() {\n    return [{ source: "/:path*", headers: securityHeaders }];\n  },\n};\n\nmodule.exports = nextConfig;\n`;
  const csp = headers.find(([k]) => k === "Content-Security-Policy")?.[1] ?? "";
  const directives = Object.fromEntries(csp.split(";").map(s => s.trim()).filter(Boolean).map(s => {
    const [k, ...v] = s.split(/\s+/);
    return [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v.map(x => x.replace("'nonce-{NONCE}'", "NONCE_FN"))];
  }));
  const directiveLines = Object.entries(directives).map(([k, v]) => `      ${k}: [${(v as string[]).map(x => x === "NONCE_FN" ? "(_req, res) => `'nonce-${(res as express.Response).locals.cspNonce}'`" : js(x)).join(", ")}],`).join("\n");
  const express = `import crypto from "node:crypto";\nimport express from "express";\nimport helmet from "helmet";\n\nconst app = express();\n${hasNonce ? "app.use((_req, res, next) => {\n  res.locals.cspNonce = crypto.randomBytes(16).toString(\"base64\");\n  next();\n});\n" : ""}app.use(helmet({\n  contentSecurityPolicy: {\n    useDefaults: false,\n    directives: {\n${directiveLines}\n    },\n  },\n  strictTransportSecurity: ${headers.some(([k]) => k === "Strict-Transport-Security") ? "{ maxAge: 63072000, includeSubDomains: true, preload: true }" : "false"},\n  referrerPolicy: { policy: "strict-origin-when-cross-origin" },\n  crossOriginOpenerPolicy: { policy: "same-origin" },\n  frameguard: { action: "deny" },\n}));\n`.replace(/^import crypto from "node:crypto";\n/, hasNonce ? 'import crypto from "node:crypto";\n' : "");
  const vercel = JSON.stringify({ headers: [{ source: "/(.*)", headers: headers.map(([key, value]) => ({ key, value: value.replace(/'nonce-\{NONCE\}' 'strict-dynamic' ?/, "") })) }] }, null, 2);
  const netlify = `/*\n${headers.map(([k, v]) => `  ${k}: ${v.replace(/'nonce-\{NONCE\}' 'strict-dynamic' ?/, "")}`).join("\n")}\n`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/; frame-ancestors [^;]+/, "").replace(/; report-uri [^;]+/, "").replace(/"/g, "&quot;")}">\n<!-- frame-ancestors, report-uri and sandbox are ignored in a meta tag; send them as headers. -->`;
  return { nginx, next, express, vercel, netlify, meta };
}

export function analyzeCsp(policy: string): { rows: Array<[string, string]>; issues: Array<{ severity: "error" | "warning" | "info"; message: string }> } {
  const value = policy.replace(/^content-security-policy(-report-only)?:\s*/i, "").trim();
  if (!value) throw new ToolInputError("Paste a Content-Security-Policy value.");
  const map = new Map<string, string[]>();
  for (const part of value.split(";").map(s => s.trim()).filter(Boolean)) {
    const [k, ...v] = part.split(/\s+/);
    if (!map.has(k.toLowerCase())) map.set(k.toLowerCase(), v);
  }
  const issues: Array<{ severity: "error" | "warning" | "info"; message: string }> = [];
  const add = (severity: "error" | "warning" | "info", message: string) => issues.push({ severity, message });
  const effective = (d: string) => map.get(d) ?? map.get("default-src");
  const script = effective("script-src") ?? effective("script-src-elem");
  if (!map.has("default-src")) add("warning", "No default-src: any resource type you did not list is allowed from anywhere.");
  if (!script) add("error", "No script-src or default-src: scripts can load from anywhere.");
  else {
    const hasNonceOrHash = script.some(s => /^'(nonce|sha(256|384|512))-/.test(s));
    if (script.includes("'unsafe-inline'") && !hasNonceOrHash) add("error", "script-src allows 'unsafe-inline': injected <script> and event handlers run, so the CSP gives little XSS protection. Use nonces or hashes.");
    if (script.includes("'unsafe-inline'") && hasNonceOrHash) add("info", "'unsafe-inline' is ignored by browsers that support nonces/hashes; it is only a fallback for old browsers.");
    if (script.includes("'unsafe-eval'")) add("warning", "script-src allows 'unsafe-eval' (eval, new Function). Remove it unless a dependency really needs it.");
    if (script.some(s => s === "*" || s === "https:" || s === "http:")) add("error", `script-src allows ${script.filter(s => ["*", "https:", "http:"].includes(s)).join(" ")}: scripts from any host.`);
    if (script.includes("data:")) add("error", "script-src allows data: URLs, which can carry scripts.");
    if (script.some(s => /\*\.(googleapis|gstatic|cloudflare|jsdelivr|unpkg)\.|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/.test(s)) && !script.includes("'strict-dynamic'")) add("warning", "Allow-listing public CDNs lets attackers load any library hosted there (known CSP bypasses). Prefer nonces with 'strict-dynamic'.");
  }
  if (!map.has("object-src") && !(map.get("default-src") ?? []).includes("'none'")) add("warning", "Set object-src 'none' to block plugins (<object>/<embed>).");
  if (!map.has("base-uri")) add("warning", "Missing base-uri: an injected <base> tag can redirect relative script URLs. Use base-uri 'self' or 'none'.");
  if (!map.has("frame-ancestors")) add("warning", "Missing frame-ancestors: the page can be framed (clickjacking). Use frame-ancestors 'none' or 'self'.");
  if (!map.has("form-action")) add("info", "form-action is not restricted; forms could post to other origins.");
  if ((effective("style-src") ?? []).includes("'unsafe-inline'")) add("info", "style-src 'unsafe-inline' is common (CSS-in-JS) and lower risk than in script-src, but enables CSS-based data exfiltration.");
  if (map.has("report-uri") && !map.has("report-to")) add("info", "report-uri is deprecated in favour of report-to (keep both for compatibility).");
  if ((effective("connect-src") ?? []).includes("*")) add("warning", "connect-src * lets injected code send data anywhere.");
  for (const [k, v] of map) if (v.some(s => /^http:/.test(s))) add("warning", `${k} allows plain http: sources.`);
  const KNOWN = new Set(["default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src", "font-src", "connect-src", "media-src", "object-src", "frame-src", "child-src", "worker-src", "manifest-src", "base-uri", "form-action", "frame-ancestors", "upgrade-insecure-requests", "block-all-mixed-content", "report-uri", "report-to", "sandbox", "require-trusted-types-for", "trusted-types", "prefetch-src", "navigate-to", "fenced-frame-src"]);
  for (const k of map.keys()) if (!KNOWN.has(k)) add("warning", `Unknown directive "${k}" (typo?) - browsers ignore it.`);
  const rows: Array<[string, string]> = [...map].map(([k, v]) => [k, v.join(" ") || "(no value)"]);
  return { rows, issues };
}

const SECURITY_HEADERS: Array<{ name: string; check: (v: string | undefined) => { severity: "error" | "warning" | "info" | "ok"; message: string } }> = [
  { name: "strict-transport-security", check: v => !v ? { severity: "warning", message: "Strict-Transport-Security is missing (HTTPS sites should send it)." } : /max-age=(\d+)/.test(v) && Number(/max-age=(\d+)/.exec(v)![1]) < 15552000 ? { severity: "warning", message: "HSTS max-age is under 180 days." } : { severity: "ok", message: "HSTS is set." } },
  { name: "content-security-policy", check: v => !v ? { severity: "warning", message: "Content-Security-Policy is missing." } : { severity: "ok", message: "CSP is set (analysed below)." } },
  { name: "x-content-type-options", check: v => v?.toLowerCase() === "nosniff" ? { severity: "ok", message: "X-Content-Type-Options: nosniff." } : { severity: "warning", message: "X-Content-Type-Options: nosniff is missing." } },
  { name: "referrer-policy", check: v => !v ? { severity: "info", message: "Referrer-Policy is missing (browsers default to strict-origin-when-cross-origin)." } : /unsafe-url|no-referrer-when-downgrade/.test(v) ? { severity: "warning", message: `Referrer-Policy ${v} leaks full URLs to other sites.` } : { severity: "ok", message: `Referrer-Policy: ${v}.` } },
  { name: "x-frame-options", check: v => v ? { severity: "ok", message: `X-Frame-Options: ${v}.` } : { severity: "info", message: "X-Frame-Options is missing (fine if CSP frame-ancestors is set)." } },
  { name: "permissions-policy", check: v => v ? { severity: "ok", message: "Permissions-Policy is set." } : { severity: "info", message: "Permissions-Policy is missing; consider disabling camera, microphone, geolocation you do not use." } },
  { name: "x-powered-by", check: v => v ? { severity: "info", message: `X-Powered-By: ${v} reveals the stack (app.disable("x-powered-by") in Express, poweredByHeader: false in Next.js).` } : { severity: "ok", message: "No X-Powered-By header." } },
  { name: "server", check: v => v && /\d/.test(v) ? { severity: "info", message: `Server: ${v} reveals the exact version.` } : { severity: "ok", message: "Server header does not reveal a version." } }
];

export function auditHeaders(raw: string): { rows: Array<[string, string, string]>; csp?: string } {
  const headers = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0 && !/^HTTP\//i.test(line)) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  if (!headers.size) throw new ToolInputError("Paste response headers (Name: value, one per line), e.g. from curl -I or the browser's Network tab.");
  const rows = SECURITY_HEADERS.map(h => {
    const r = h.check(headers.get(h.name));
    return [h.name, r.severity === "ok" ? "✓" : r.severity, r.message] as [string, string, string];
  });
  return { rows, csp: headers.get("content-security-policy") };
}
