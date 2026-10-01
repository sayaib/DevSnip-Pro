import { ToolInputError } from "../types";

/**
 * URL and query strings, cookies and Cache-Control: the HTTP details that
 * cause most "works in Postman, not in the app" bugs.
 */

// ---------------------------------------------------------------------------
// URLs and query strings
// ---------------------------------------------------------------------------

export interface UrlReport {
  parts: Array<[string, string]>;
  params: Array<[string, string, string]>;
  warnings: string[];
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

export function parseUrlReport(input: string): UrlReport {
  const raw = input.trim();
  if (!raw) throw new ToolInputError("Enter a URL.");
  let url: URL;
  try { url = new URL(raw); } catch {
    try { url = new URL(`https://${raw}`); } catch { throw new ToolInputError(`"${raw}" is not a valid URL.`); }
  }
  const warnings: string[] = [];
  const isDb = /^(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|rediss|amqps?|sqlserver|mssql):$/.test(url.protocol);
  const parts: Array<[string, string]> = [
    ["Protocol", url.protocol.replace(/:$/, "")],
    ...(url.username ? [["Username", safeDecode(url.username)] as [string, string]] : []),
    ...(url.password ? [["Password", "•".repeat(Math.min(8, url.password.length)) + " (hidden)"] as [string, string]] : []),
    ["Host", url.hostname],
    ["Port", url.port || `${defaultPort(url.protocol) ?? "-"} (default)`],
    ["Path", safeDecode(url.pathname)],
    ["Query", url.search],
    ["Fragment", url.hash],
    ["Origin", url.origin === "null" ? "-" : url.origin]
  ];
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length) parts.push(["Path segments", segments.map(safeDecode).join("  ›  ")]);
  // URLSearchParams decodes + as a space, which is right for form-encoded queries.
  const rawQuery = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1).split("#")[0] : "";
  const params: Array<[string, string, string]> = rawQuery.split("&").filter(Boolean).map(pair => {
    const eq = pair.indexOf("=");
    const k = eq < 0 ? pair : pair.slice(0, eq);
    const v = eq < 0 ? "" : pair.slice(eq + 1);
    return [safeDecode(k), safeDecode(v), v];
  });
  if (url.password && !isDb) warnings.push("The URL contains a password. Browsers strip credentials from URLs and they end up in logs; send them in an Authorization header.");
  if (url.password && isDb && /[@:/?#[\]%]/.test(safeDecode(url.password)) && !/%[0-9A-F]{2}/i.test(url.password)) warnings.push("Special characters in a database password must be percent-encoded (e.g. @ → %40).");
  if (url.protocol === "http:" && !/^(localhost|127\.|10\.0\.2\.2|0\.0\.0\.0|\[::1\])/.test(url.hostname)) warnings.push("http:// is not encrypted. Mobile apps block it by default (Android cleartext policy, iOS ATS).");
  if (/%25[0-9A-F]{2}/i.test(raw)) warnings.push("The URL contains %25xx sequences: it was probably encoded twice.");
  if (/\s/.test(raw)) warnings.push("The URL contains spaces; encode them as %20 (or + inside a form-encoded query).");
  const dupes = params.map(p => p[0]).filter((k, i, a) => a.indexOf(k) !== i);
  if (dupes.length) warnings.push(`Repeated parameters: ${[...new Set(dupes)].join(", ")}. Frameworks read these differently (first value, last value or an array).`);
  for (const [k, v] of params) {
    if (/^(token|access_token|api_key|apikey|key|secret|password|client_secret|sig|signature)$/i.test(k) && v) warnings.push(`"${k}" in the query string ends up in server logs, browser history and Referer headers; prefer a header.`);
  }
  if (raw.length > 2000) warnings.push(`The URL is ${raw.length} characters; some proxies and browsers reject URLs over ~2,000-8,000 characters.`);
  if (url.hostname !== url.hostname.toLowerCase() || /xn--/.test(url.hostname)) warnings.push(`Host as sent: ${url.hostname} (internationalised names are sent in punycode).`);
  return { parts, params, warnings };
}

function defaultPort(protocol: string): number | undefined {
  return ({ "http:": 80, "https:": 443, "ws:": 80, "wss:": 443, "ftp:": 21, "postgres:": 5432, "postgresql:": 5432, "mysql:": 3306, "mongodb:": 27017, "redis:": 6379, "rediss:": 6380, "amqp:": 5672, "amqps:": 5671 } as Record<string, number>)[protocol];
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Builds a URL from a base and "key=value" lines (raw values, encoded here). Lines starting with "-" remove a parameter. */
export function buildUrl(base: string, lines: string): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new ToolInputError(`"${base}" is not a valid base URL (include https://).`); }
  const existing: Array<[string, string]> = [...url.searchParams];
  let result = existing;
  for (const line of lines.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))) {
    if (line.startsWith("-")) { const key = line.slice(1).trim(); result = result.filter(([k]) => k !== key); continue; }
    const eq = line.indexOf("=");
    const colon = line.indexOf(":");
    const at = eq >= 0 ? eq : colon;
    if (at <= 0) throw new ToolInputError(`"${line}" should be key=value.`);
    result.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
  }
  const query = result.map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  return `${url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin}${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/** Query string → nested object, the way qs / Express / Rails / PHP read brackets. */
export function queryToObject(query: string): Record<string, unknown> {
  const q = query.trim().replace(/^.*?\?/, "").replace(/#.*$/, "");
  const root: Record<string, unknown> = {};
  for (const pair of q.split("&").filter(Boolean)) {
    const eq = pair.indexOf("=");
    const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? "" : safeDecode(pair.slice(eq + 1));
    const path = key.replace(/\]/g, "").split("[");
    let node: Record<string, unknown> | unknown[] = root;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const last = i === path.length - 1;
      const nextIsArray = !last && (path[i + 1] === "" || /^\d+$/.test(path[i + 1]));
      if (Array.isArray(node)) {
        const idx = seg === "" ? node.length : Number(seg);
        if (last) node[idx] = value;
        else { node[idx] = node[idx] ?? (nextIsArray ? [] : {}); node = node[idx] as Record<string, unknown>; }
      } else {
        if (last) {
          if (seg in node) node[seg] = Array.isArray(node[seg]) ? [...(node[seg] as unknown[]), value] : [node[seg], value];
          else node[seg] = value;
        } else {
          if (typeof node[seg] !== "object" || node[seg] === null) node[seg] = nextIsArray ? [] : {};
          node = node[seg] as Record<string, unknown>;
        }
      }
    }
  }
  return root;
}

export type ArrayFormat = "brackets" | "indices" | "repeat" | "comma";

export function objectToQuery(value: unknown, format: ArrayFormat): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolInputError("Enter a JSON object, e.g. {\"page\": 2, \"tags\": [\"a\", \"b\"]}.");
  const out: string[] = [];
  const walk = (v: unknown, prefix: string) => {
    if (v === null || v === undefined) { out.push(`${enc(prefix)}=`); return; }
    if (Array.isArray(v)) {
      if (format === "comma" && v.every(x => typeof x !== "object")) { out.push(`${enc(prefix)}=${v.map(x => enc(String(x))).join(",")}`); return; }
      v.forEach((item, i) => walk(item, format === "repeat" ? prefix : format === "indices" || typeof item === "object" ? `${prefix}[${i}]` : `${prefix}[]`));
      return;
    }
    if (typeof v === "object") { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, prefix ? `${prefix}[${k}]` : k); return; }
    out.push(`${enc(prefix)}=${enc(String(v))}`);
  };
  walk(value, "");
  return out.join("&").replace(/%5B/g, "[").replace(/%5D/g, "]");
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export interface ParsedCookie {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
  issues: Array<{ severity: "error" | "warning" | "info"; message: string }>;
}

export function parseSetCookie(line: string, now = new Date()): ParsedCookie {
  const text = line.trim().replace(/^set-cookie:\s*/i, "");
  const [first, ...rest] = text.split(";");
  const eq = first.indexOf("=");
  if (eq <= 0) throw new ToolInputError(`"${first.trim()}" is not name=value.`);
  const cookie: ParsedCookie = { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim(), attributes: {}, issues: [] };
  for (const part of rest) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    const key = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
    cookie.attributes[key] = i < 0 ? true : p.slice(i + 1).trim();
  }
  const a = cookie.attributes;
  const issue = (severity: "error" | "warning" | "info", message: string) => cookie.issues.push({ severity, message });
  const sameSite = typeof a.samesite === "string" ? a.samesite.toLowerCase() : undefined;
  const sessionLike = /sess|sid|auth|token|jwt|refresh|login|remember/i.test(cookie.name);
  if (sameSite === "none" && !a.secure) issue("error", "SameSite=None without Secure is rejected by every modern browser.");
  if (!a.secure) issue(sessionLike ? "error" : "warning", "Missing Secure: the cookie is sent over plain http and can be intercepted.");
  if (!a.httponly && sessionLike) issue("error", "Missing HttpOnly on what looks like a session/auth cookie: any XSS can read it with document.cookie.");
  if (!a.samesite) issue("info", "No SameSite: browsers default to Lax (sent on top-level navigations, not on cross-site fetch/iframe requests).");
  if (sameSite === "none") issue("info", "SameSite=None sends the cookie on cross-site requests; add CSRF protection, and expect third-party cookie blocking (Safari, Firefox, Chrome with restrictions).");
  if (sameSite && !["strict", "lax", "none"].includes(sameSite)) issue("error", `SameSite=${a.samesite} is not a valid value (Strict, Lax or None).`);
  if (cookie.name.startsWith("__Host-") && (!a.secure || a.domain || a.path !== "/")) issue("error", "__Host- cookies must have Secure, Path=/ and no Domain, or the browser drops them.");
  if (cookie.name.startsWith("__Secure-") && !a.secure) issue("error", "__Secure- cookies must have Secure.");
  if (a.partitioned && !a.secure) issue("error", "Partitioned (CHIPS) cookies must be Secure.");
  if (typeof a.domain === "string" && a.domain.startsWith(".")) issue("info", "A leading dot in Domain is ignored; the cookie is shared with all subdomains either way.");
  if (typeof a.expires === "string") {
    const t = Date.parse(a.expires);
    if (Number.isNaN(t)) issue("error", `Expires "${a.expires}" is not a valid HTTP date (e.g. Wed, 21 Oct 2026 07:28:00 GMT).`);
    else if (t < now.getTime() && !a["max-age"]) issue("info", "Expires is in the past: this Set-Cookie deletes the cookie.");
  }
  if (typeof a["max-age"] === "string") {
    const n = Number(a["max-age"]);
    if (!Number.isInteger(n)) issue("error", `Max-Age "${a["max-age"]}" must be a whole number of seconds.`);
    else if (n <= 0) issue("info", "Max-Age <= 0 deletes the cookie.");
    else if (n > 400 * 86400) issue("warning", "Chrome caps cookie lifetime at 400 days.");
    if (a.expires) issue("info", "Both Max-Age and Expires are set; Max-Age wins.");
  }
  if (!a.expires && !a["max-age"]) issue("info", "No Expires/Max-Age: a session cookie, removed when the browser session ends (mobile browsers may keep it much longer).");
  const size = cookie.name.length + cookie.value.length;
  if (size > 4096) issue("error", `Name + value is ${size} bytes; browsers drop cookies over 4,096 bytes.`);
  if (/[\s",;\\]/.test(cookie.value.replace(/^"|"$/g, ""))) issue("warning", "The value contains spaces, quotes, commas, semicolons or backslashes; encode it (encodeURIComponent).");
  if (!a.path) issue("info", "No Path: the default is the directory of the request URL, which surprises people; set Path=/ explicitly.");
  return cookie;
}

export function parseCookieHeader(header: string): Array<[string, string]> {
  return header.replace(/^cookie:\s*/i, "").split(";").map(s => s.trim()).filter(Boolean).map(pair => {
    const eq = pair.indexOf("=");
    return eq < 0 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
  });
}

export interface CookieOptions {
  name: string;
  value: string;
  maxAgeSeconds?: number;
  path: string;
  domain?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Lax" | "Strict" | "None";
  partitioned: boolean;
}

export function buildCookie(o: CookieOptions): Record<string, string> {
  const parts = [`${o.name}=${encodeURIComponent(o.value)}`];
  if (o.maxAgeSeconds !== undefined) parts.push(`Max-Age=${o.maxAgeSeconds}`);
  if (o.domain) parts.push(`Domain=${o.domain}`);
  parts.push(`Path=${o.path || "/"}`);
  if (o.secure) parts.push("Secure");
  if (o.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${o.sameSite}`);
  if (o.partitioned) parts.push("Partitioned");
  const js = JSON.stringify;
  const opt = (pairs: Array<[string, unknown]>, indent: string) => pairs.filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => `${indent}${k}: ${typeof v === "string" ? js(v) : v},`).join("\n");
  const express = opt([["httpOnly", o.httpOnly], ["secure", o.secure], ["sameSite", o.sameSite.toLowerCase()], ["path", o.path || "/"], ["domain", o.domain], ["maxAge", o.maxAgeSeconds !== undefined ? o.maxAgeSeconds * 1000 : undefined], ["partitioned", o.partitioned]], "  ");
  const next = opt([["httpOnly", o.httpOnly], ["secure", o.secure], ["sameSite", o.sameSite.toLowerCase()], ["path", o.path || "/"], ["domain", o.domain], ["maxAge", o.maxAgeSeconds], ["partitioned", o.partitioned]], "  ");
  return {
    header: `Set-Cookie: ${parts.join("; ")}`,
    express: `// Express (maxAge is in milliseconds here)\nres.cookie(${js(o.name)}, ${js(o.value)}, {\n${express}\n});`,
    next: `// Next.js App Router: route handler or server action\nimport { cookies } from "next/headers";\n\nexport async function setSessionCookie() {\n  const store = await cookies();\n  store.set(${js(o.name)}, ${js(o.value)}, {\n${next.replace(/^ {2}/gm, "    ")}\n  });\n}\n`,
    browser: o.httpOnly ? "// HttpOnly cookies cannot be set or read from JavaScript - set this one from the server." : `document.cookie = ${js(parts.filter(p => p !== "HttpOnly").join("; "))};`
  };
}

// ---------------------------------------------------------------------------
// Cache-Control
// ---------------------------------------------------------------------------

const DIRECTIVES: Record<string, string> = {
  "public": "Any cache (browser, CDN, proxy) may store the response, even for authenticated requests.",
  "private": "Only the browser may store it; CDNs and shared proxies must not.",
  "no-cache": "May be stored, but must be revalidated with the server (ETag / Last-Modified) before every use. It does NOT mean \"don't cache\".",
  "no-store": "Must not be stored anywhere. Use for sensitive data.",
  "max-age": "Fresh for this many seconds in any cache.",
  "s-maxage": "Freshness for shared caches (CDN/proxy) only; overrides max-age there.",
  "must-revalidate": "Once stale, must not be used without a successful revalidation (no serving stale on errors).",
  "proxy-revalidate": "Like must-revalidate, for shared caches only.",
  "immutable": "The response will never change while fresh: the browser skips revalidation even on reload. Only for versioned (hashed) URLs.",
  "stale-while-revalidate": "After it goes stale, may be served for this many seconds while a fresh copy is fetched in the background.",
  "stale-if-error": "May be served stale for this many seconds if the origin errors (5xx) or is unreachable.",
  "no-transform": "Intermediaries must not modify the body (e.g. recompress images).",
  "must-understand": "Store only if the cache understands the status code's caching rules."
};

export function explainCacheControl(header: string): { rows: Array<[string, string, string]>; warnings: string[] } {
  const value = header.replace(/^cache-control:\s*/i, "").trim();
  if (!value) throw new ToolInputError("Paste a Cache-Control value, e.g. public, max-age=31536000, immutable.");
  const directives = new Map<string, string | true>();
  for (const part of value.split(",").map(s => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    directives.set((eq < 0 ? part : part.slice(0, eq)).toLowerCase(), eq < 0 ? true : part.slice(eq + 1).replace(/"/g, ""));
  }
  const human = (secs: number) => secs >= 86400 ? `${+(secs / 86400).toFixed(1)} days` : secs >= 3600 ? `${+(secs / 3600).toFixed(1)} hours` : secs >= 60 ? `${+(secs / 60).toFixed(1)} minutes` : `${secs} seconds`;
  const rows: Array<[string, string, string]> = [...directives].map(([k, v]) => {
    const n = typeof v === "string" ? Number(v) : NaN;
    return [k, v === true ? "" : `${v}${Number.isFinite(n) ? ` (${human(n)})` : ""}`, DIRECTIVES[k] ?? "Unknown directive - caches ignore it."];
  });
  const warnings: string[] = [];
  const has = (k: string) => directives.has(k);
  if (has("no-store") && directives.size > 1) warnings.push("no-store overrides every other directive here; the rest are ignored.");
  if (has("public") && has("private")) warnings.push("public and private contradict each other.");
  if (has("immutable") && Number(directives.get("max-age") ?? 0) < 86400) warnings.push("immutable only makes sense with a long max-age on hashed/versioned URLs (e.g. max-age=31536000).");
  if (has("no-cache") && has("max-age")) warnings.push("no-cache forces revalidation, so max-age has little effect.");
  if (!has("max-age") && !has("s-maxage") && !has("no-store") && !has("no-cache")) warnings.push("No max-age: caches fall back to heuristic freshness (often 10% of the time since Last-Modified). Be explicit.");
  if (Number(directives.get("max-age") ?? 0) > 31536000) warnings.push("max-age above one year (31536000) is clamped by most caches.");
  if (has("public") && !has("s-maxage") && Number(directives.get("max-age") ?? 0) > 3600) warnings.push("Long public caching on HTML or API responses means users keep stale content after a deploy; use it for hashed assets only.");
  return { rows, warnings };
}

export type AssetKind = "hashed" | "html" | "api-private" | "api-public" | "images" | "fonts" | "service-worker" | "sensitive";

export const CACHE_PRESETS: Record<AssetKind, { label: string; value: string; why: string; match: string; nextSource: string }> = {
  "hashed": { label: "Hashed JS/CSS bundles (app.3f9a1c.js)", value: "public, max-age=31536000, immutable", why: "The file name changes on every build, so the content at a URL never changes: cache forever.", match: "\\.(js|css|mjs)$", nextSource: "/_next/static/:path*" },
  "html": { label: "HTML pages / SPA index.html", value: "no-cache", why: "Always revalidate so users get new deploys immediately; unchanged pages still return a cheap 304.", match: "\\.html$", nextSource: "/:path*" },
  "api-private": { label: "API: per-user data", value: "private, no-cache", why: "Only the user's browser may keep it, and it must check with the server before reuse.", match: "^/api/", nextSource: "/api/:path*" },
  "api-public": { label: "API: public, shared data", value: "public, max-age=60, s-maxage=300, stale-while-revalidate=600", why: "Browsers keep it a minute, the CDN five, and stale copies are served while refreshing.", match: "^/api/public/", nextSource: "/api/public/:path*" },
  "images": { label: "Images without hashes", value: "public, max-age=86400, stale-while-revalidate=604800", why: "A day fresh, then served stale for a week while revalidating.", match: "\\.(png|jpe?g|gif|webp|avif|svg|ico)$", nextSource: "/images/:path*" },
  "fonts": { label: "Web fonts", value: "public, max-age=31536000, immutable", why: "Fonts rarely change; version the URL when they do.", match: "\\.(woff2?|ttf|otf)$", nextSource: "/fonts/:path*" },
  "service-worker": { label: "service-worker.js / sw.js", value: "no-cache, max-age=0", why: "A cached service worker delays every future update; always revalidate it.", match: "/(service-worker|sw)\\.js$", nextSource: "/sw.js" },
  "sensitive": { label: "Sensitive responses (account, payment)", value: "no-store", why: "Never written to disk or shared caches.", match: "^/(account|billing)/", nextSource: "/account/:path*" }
};

export function cacheConfigs(kinds: AssetKind[]): Record<string, string> {
  const presets = kinds.map(k => ({ kind: k, ...CACHE_PRESETS[k] }));
  const nginx = presets.map(p => `# ${p.label}\nlocation ~* ${p.match} {\n    add_header Cache-Control "${p.value}" always;\n}`).join("\n\n");
  const express = `import express from "express";\nimport path from "node:path";\n\nconst app = express();\n\n// Long-lived, hashed assets\napp.use("/assets", express.static(path.join(process.cwd(), "dist/assets"), { immutable: true, maxAge: "1y" }));\n\n// Everything else: decide per response\napp.use((req, res, next) => {\n${presets.map(p => `  if (/${p.match.replace(/\//g, "\\/")}/.test(req.path)) res.setHeader("Cache-Control", ${JSON.stringify(p.value)});`).join("\n  else ")}\n  next();\n});\n`;
  const next = `// next.config.js - Next.js already sets immutable caching for /_next/static.\n/** @type {import("next").NextConfig} */\nconst nextConfig = {\n  async headers() {\n    return [\n${presets.filter(p => p.kind !== "hashed").map(p => `      { source: ${JSON.stringify(p.nextSource)}, headers: [{ key: "Cache-Control", value: ${JSON.stringify(p.value)} }] },`).join("\n")}\n    ];\n  },\n};\n\nmodule.exports = nextConfig;\n`;
  const vercel = JSON.stringify({ headers: presets.map(p => ({ source: p.nextSource, headers: [{ key: "Cache-Control", value: p.value }] })) }, null, 2);
  const netlify = presets.map(p => `${p.nextSource.replace(/:path\*/, "*")}\n  Cache-Control: ${p.value}`).join("\n\n") + "\n";
  return { nginx, express, next, vercel, netlify };
}
