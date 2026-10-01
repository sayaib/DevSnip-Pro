import { ToolInputError } from "../types";

/**
 * cURL → code. The parser understands what browsers' "Copy as cURL" and API
 * docs produce (bash and cmd quoting, line continuations, combined short
 * flags, --data variants, -F, -u, -b, -G, --json); generators emit idiomatic
 * code for the HTTP client of each stack, web and mobile.
 */

export interface CurlRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  /** json: body is valid JSON; form: urlencoded; multipart: see `form`; raw: anything else. */
  bodyKind: "none" | "json" | "form" | "multipart" | "raw";
  form: Array<{ name: string; value: string; file: boolean }>;
  basicAuth?: { user: string; password: string };
  insecure: boolean;
  followRedirects: boolean;
  compressed: boolean;
  timeoutSeconds?: number;
  proxy?: string;
  ignored: string[];
}

/** Splits a shell command line the way bash would (plus Windows cmd ^ continuations). */
export function tokenizeShell(input: string): string[] {
  const text = input
    .replace(/\\\r?\n/g, " ")       // bash continuation
    .replace(/\^\r?\n/g, " ")       // cmd continuation
    .replace(/`\r?\n/g, " ")        // PowerShell continuation
    .replace(/\r?\n/g, " ");
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (inToken) { tokens.push(current); current = ""; inToken = false; }
      i++;
      continue;
    }
    inToken = true;
    if (ch === "'" ) {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new ToolInputError("Unclosed single quote in the command.");
      current += text.slice(i + 1, end);
      i = end + 1;
    } else if (ch === "$" && text[i + 1] === "'") {
      // ANSI-C quoting: $'...\n...'
      let j = i + 2;
      let out = "";
      while (j < text.length && text[j] !== "'") {
        if (text[j] === "\\" && j + 1 < text.length) {
          const n = text[j + 1];
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0" };
          if (n === "x" && /^[0-9a-fA-F]{2}$/.test(text.slice(j + 2, j + 4))) { out += String.fromCharCode(parseInt(text.slice(j + 2, j + 4), 16)); j += 4; continue; }
          if (n === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(j + 2, j + 6))) { out += String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16)); j += 6; continue; }
          out += map[n] ?? n;
          j += 2;
        } else out += text[j++];
      }
      if (j >= text.length) throw new ToolInputError("Unclosed $'...' quote in the command.");
      current += out;
      i = j + 1;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && /["\\$`]/.test(text[j + 1] ?? "")) { current += text[j + 1]; j += 2; }
        else if (text[j] === "^" && text[j + 1] === '"') { current += '"'; j += 2; } // cmd escaping
        else current += text[j++];
      }
      if (j >= text.length) throw new ToolInputError("Unclosed double quote in the command.");
      i = j + 1;
    } else if (ch === "\\" && i + 1 < text.length) {
      current += text[i + 1];
      i += 2;
    } else if (ch === "^" && i + 1 < text.length && /[\^&|<>"]/.test(text[i + 1])) {
      current += text[i + 1]; // cmd escape
      i += 2;
    } else {
      current += ch;
      i++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

const WITH_VALUE = new Set(["-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode", "--json", "-F", "--form", "--form-string", "-u", "--user", "-b", "--cookie", "-A", "--user-agent", "-e", "--referer", "--url", "-m", "--max-time", "--connect-timeout", "-x", "--proxy", "-o", "--output", "-w", "--write-out", "--retry", "-c", "--cookie-jar", "--cacert", "--cert", "--key", "-T", "--upload-file", "--resolve", "--limit-rate", "-r", "--range", "-z", "--time-cond", "--oauth2-bearer", "-K", "--config", "--max-redirs", "--interface", "-y", "--speed-time", "-Y", "--speed-limit", "-D", "--dump-header"]);
const SHORT_WITH_VALUE = new Set(["X", "H", "d", "F", "u", "b", "A", "e", "m", "x", "o", "w", "c", "T", "r", "z", "K", "y", "Y", "D"]);

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

const hasHeader = (headers: Array<[string, string]>, name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

export function parseCurl(command: string): CurlRequest {
  const tokens = tokenizeShell(command.trim());
  if (!tokens.length) throw new ToolInputError("Paste a cURL command.");
  const start = tokens.findIndex(t => /(^|[\\/])curl(\.exe)?$/i.test(t));
  if (start < 0) throw new ToolInputError("This does not look like a cURL command: it should start with curl.");
  const r: CurlRequest = { method: "", url: "", headers: [], bodyKind: "none", form: [], insecure: false, followRedirects: false, compressed: false, ignored: [] };
  const data: string[] = [];
  let getMode = false;
  let head = false;
  let jsonFlag = false;
  const args = tokens.slice(start + 1);
  const expanded: string[] = [];
  // Expand combined short flags (-sSL, -XPOST, -H'x: y').
  for (const arg of args) {
    if (/^-[A-Za-z]{2,}/.test(arg) && !arg.startsWith("--")) {
      const letters = arg.slice(1);
      let consumed = false;
      for (let i = 0; i < letters.length; i++) {
        const l = letters[i];
        if (SHORT_WITH_VALUE.has(l)) {
          expanded.push(`-${l}`);
          if (i + 1 < letters.length) expanded.push(letters.slice(i + 1));
          consumed = true;
          break;
        }
        expanded.push(`-${l}`);
      }
      if (!consumed) continue;
    } else if (/^--[a-z-]+=/.test(arg)) {
      const eq = arg.indexOf("=");
      expanded.push(arg.slice(0, eq), arg.slice(eq + 1));
    } else expanded.push(arg);
  }
  for (let i = 0; i < expanded.length; i++) {
    const flag = expanded[i];
    const next = () => {
      if (i + 1 >= expanded.length) throw new ToolInputError(`${flag} needs a value.`);
      return expanded[++i];
    };
    if (!flag.startsWith("-") || flag === "-") {
      if (!r.url) r.url = flag;
      else r.ignored.push(flag);
      continue;
    }
    switch (flag) {
      case "-X": case "--request": r.method = next().toUpperCase(); break;
      case "-H": case "--header": {
        const h = next();
        const colon = h.indexOf(":");
        if (colon > 0) {
          const value = h.slice(colon + 1).trim();
          if (value || !h.endsWith(";")) r.headers.push([h.slice(0, colon).trim(), value]);
        } else if (h.endsWith(";")) r.headers.push([h.slice(0, -1).trim(), ""]);
        break;
      }
      case "-d": case "--data": case "--data-ascii": data.push(next().replace(/[\r\n]/g, "")); break;
      case "--data-raw": case "--data-binary": data.push(next()); break;
      case "--data-urlencode": {
        const v = next();
        const eq = v.indexOf("=");
        data.push(eq < 0 ? encodeURIComponent(v) : eq === 0 ? encodeURIComponent(v.slice(1)) : `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`);
        break;
      }
      case "--json": data.push(next()); jsonFlag = true; break;
      case "-F": case "--form": case "--form-string": {
        const v = next();
        const eq = v.indexOf("=");
        if (eq < 0) throw new ToolInputError(`-F expects name=value, got "${v}".`);
        const value = v.slice(eq + 1);
        const file = flag !== "--form-string" && value.startsWith("@");
        r.form.push({ name: v.slice(0, eq), value: file ? value.slice(1).split(";")[0] : value.split(";type=")[0], file });
        break;
      }
      case "-u": case "--user": {
        const v = next();
        const colon = v.indexOf(":");
        r.basicAuth = colon < 0 ? { user: v, password: "" } : { user: v.slice(0, colon), password: v.slice(colon + 1) };
        break;
      }
      case "--oauth2-bearer": r.headers.push(["Authorization", `Bearer ${next()}`]); break;
      case "-b": case "--cookie": {
        const v = next();
        if (v.includes("=")) r.headers.push(["Cookie", v]);
        else r.ignored.push(`${flag} ${v} (cookie file)`);
        break;
      }
      case "-A": case "--user-agent": r.headers.push(["User-Agent", next()]); break;
      case "-e": case "--referer": r.headers.push(["Referer", next()]); break;
      case "--url": r.url = next(); break;
      case "-G": case "--get": getMode = true; break;
      case "-I": case "--head": head = true; break;
      case "-L": case "--location": r.followRedirects = true; break;
      case "-k": case "--insecure": r.insecure = true; break;
      case "--compressed": r.compressed = true; break;
      case "-m": case "--max-time": r.timeoutSeconds = Number(next()) || undefined; break;
      case "-x": case "--proxy": r.proxy = next(); break;
      default:
        if (WITH_VALUE.has(flag)) r.ignored.push(`${flag} ${next()}`);
        else if (!["-s", "--silent", "-S", "--show-error", "-v", "--verbose", "-i", "--include", "-f", "--fail", "--fail-with-body", "-#", "--progress-bar", "-N", "--no-buffer", "--http1.1", "--http2", "--http2-prior-knowledge", "--globoff", "-g", "-n", "--netrc", "-O", "--remote-name", "-J", "--remote-header-name"].includes(flag)) r.ignored.push(flag);
    }
  }
  if (!r.url) throw new ToolInputError("The command has no URL.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(r.url)) r.url = `http://${r.url}`;
  try { new URL(r.url); } catch { throw new ToolInputError(`"${r.url}" is not a valid URL.`); }

  if (data.length && getMode) {
    const u = new URL(r.url);
    r.url = `${r.url}${u.search ? "&" : "?"}${data.join("&")}`;
  } else if (data.length) {
    r.body = data.join("&");
    if (jsonFlag) {
      if (!hasHeader(r.headers, "Content-Type")) r.headers.push(["Content-Type", "application/json"]);
      if (!hasHeader(r.headers, "Accept")) r.headers.push(["Accept", "application/json"]);
    }
    const type = (r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "").toLowerCase();
    if (type.includes("json") || (!type && looksLikeJson(r.body))) r.bodyKind = looksLikeJson(r.body) ? "json" : "raw";
    else if (!type || type.includes("x-www-form-urlencoded")) r.bodyKind = "form";
    else r.bodyKind = "raw";
    if (!type && r.bodyKind === "form") r.headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
    if (!type && r.bodyKind === "json") r.headers.push(["Content-Type", "application/json"]);
  } else if (r.form.length) {
    r.bodyKind = "multipart";
    // The client sets the multipart boundary itself; a copied header would break it.
    r.headers = r.headers.filter(([k, v]) => !(k.toLowerCase() === "content-type" && /multipart/i.test(v)));
  }
  if (!r.method) r.method = head ? "HEAD" : (r.body !== undefined || r.form.length) ? "POST" : "GET";
  return r;
}

// ---------------------------------------------------------------------------
// String literals per language
// ---------------------------------------------------------------------------

const js = (s: string) => JSON.stringify(s);
const py = (s: string) => JSON.stringify(s); // JSON escapes are valid Python escapes
const dart = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}'`;
const kotlin = (s: string) => JSON.stringify(s).replace(/\$/g, "\\$");
const swift = (s: string) => JSON.stringify(s).replace(/\\u([0-9a-fA-F]{4})/g, "\\u{$1}").replace(/\\\//g, "/");
const goStr = (s: string) => JSON.stringify(s);
const java = (s: string) => JSON.stringify(s);
const php = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** JSON value → Python literal. */
function pyLiteral(value: unknown, indent = 0): string {
  const pad = "    ".repeat(indent + 1);
  const end = "    ".repeat(indent);
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return py(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map(v => pad + pyLiteral(v, indent + 1)).join(",\n")},\n${end}]` : "[]";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${pad}${py(k)}: ${pyLiteral(v, indent + 1)}`).join(",\n")},\n${end}}` : "{}";
}

/** JSON value → Dart literal (maps and lists). */
function dartLiteral(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent + 1);
  const end = "  ".repeat(indent);
  if (value === null || typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return dart(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map(v => pad + dartLiteral(v, indent + 1)).join(",\n")},\n${end}]` : "[]";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${pad}${dart(k)}: ${dartLiteral(v, indent + 1)}`).join(",\n")},\n${end}}` : "<String, dynamic>{}";
}

function indentJson(body: string, spaces: number): string {
  return JSON.stringify(JSON.parse(body), null, 2).split("\n").map((l, i) => (i ? " ".repeat(spaces) + l : l)).join("\n");
}

function formPairs(body: string): Array<[string, string]> {
  return body.split("&").filter(Boolean).map(p => {
    const eq = p.indexOf("=");
    const dec = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    return eq < 0 ? [dec(p), ""] : [dec(p.slice(0, eq)), dec(p.slice(eq + 1))];
  });
}

/** Headers without the ones each client sets itself. */
function plainHeaders(r: CurlRequest, drop: string[] = []): Array<[string, string]> {
  const skip = new Set(["content-length", "host", ...drop.map(d => d.toLowerCase())]);
  return r.headers.filter(([k]) => !skip.has(k.toLowerCase()));
}

function basicHeader(r: CurlRequest): Array<[string, string]> {
  return r.basicAuth ? [["Authorization", `Basic ${Buffer.from(`${r.basicAuth.user}:${r.basicAuth.password}`).toString("base64")}`]] : [];
}

export type CurlTarget = "fetch" | "axios" | "node-fetch" | "python" | "go" | "php" | "java" | "dart-http" | "dart-dio" | "kotlin-okhttp" | "swift" | "http" | "httpie";

export const CURL_TARGETS: Array<{ id: CurlTarget; label: string; language: string; file: string }> = [
  { id: "fetch", label: "JavaScript fetch (browser, React, React Native)", language: "javascript", file: "request.js" },
  { id: "axios", label: "Axios", language: "javascript", file: "request.js" },
  { id: "node-fetch", label: "Node.js 18+ (fetch, TypeScript)", language: "typescript", file: "request.ts" },
  { id: "python", label: "Python requests", language: "python", file: "request.py" },
  { id: "go", label: "Go net/http", language: "go", file: "main.go" },
  { id: "php", label: "PHP (curl)", language: "php", file: "request.php" },
  { id: "java", label: "Java HttpClient", language: "java", file: "Request.java" },
  { id: "dart-http", label: "Dart / Flutter (http)", language: "dart", file: "request.dart" },
  { id: "dart-dio", label: "Dart / Flutter (dio)", language: "dart", file: "request.dart" },
  { id: "kotlin-okhttp", label: "Kotlin / Android (OkHttp)", language: "kotlin", file: "Request.kt" },
  { id: "swift", label: "Swift / iOS (URLSession)", language: "swift", file: "Request.swift" },
  { id: "http", label: "Raw HTTP request", language: "http", file: "request.http" },
  { id: "httpie", label: "HTTPie", language: "shell", file: "request.sh" }
];

export function generateFromCurl(r: CurlRequest, target: CurlTarget): string {
  switch (target) {
    case "fetch": return toFetch(r, false);
    case "node-fetch": return toFetch(r, true);
    case "axios": return toAxios(r);
    case "python": return toPython(r);
    case "go": return toGo(r);
    case "php": return toPhp(r);
    case "java": return toJava(r);
    case "dart-http": return toDartHttp(r);
    case "dart-dio": return toDio(r);
    case "kotlin-okhttp": return toOkHttp(r);
    case "swift": return toSwift(r);
    case "http": return toRawHttp(r);
    case "httpie": return toHttpie(r);
  }
}

function toFetch(r: CurlRequest, node: boolean): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []), ...basicHeader(r)];
  const lines: string[] = [];
  if (r.bodyKind === "multipart") {
    lines.push("const form = new FormData();");
    for (const f of r.form) {
      lines.push(f.file
        ? node ? `form.append(${js(f.name)}, await openAsBlob(${js(f.value)}), ${js(f.value.split(/[\\/]/).pop() ?? f.value)});` : `form.append(${js(f.name)}, fileInput.files[0]); // ${f.value}`
        : `form.append(${js(f.name)}, ${js(f.value)});`);
    }
    lines.push("");
  }
  const opts: string[] = [`  method: ${js(r.method)},`];
  if (headers.length) opts.push(`  headers: {\n${headers.map(([k, v]) => `    ${js(k)}: ${js(v)},`).join("\n")}\n  },`);
  if (r.bodyKind === "json") opts.push(`  body: JSON.stringify(${indentJson(r.body!, 2)}),`);
  else if (r.bodyKind === "form") opts.push(`  body: new URLSearchParams({\n${formPairs(r.body!).map(([k, v]) => `    ${js(k)}: ${js(v)},`).join("\n")}\n  }),`);
  else if (r.bodyKind === "raw") opts.push(`  body: ${js(r.body!)},`);
  else if (r.bodyKind === "multipart") opts.push("  body: form,");
  if (r.timeoutSeconds) opts.push(`  signal: AbortSignal.timeout(${r.timeoutSeconds * 1000}),`);
  const head = node ? `${r.bodyKind === "multipart" && r.form.some(f => f.file) ? 'import { openAsBlob } from "node:fs";\n\n' : ""}` : "";
  lines.push(`const response = await fetch(${js(r.url)}, {\n${opts.join("\n")}\n});`);
  lines.push("");
  lines.push("if (!response.ok) {");
  lines.push("  throw new Error(`HTTP ${response.status}: ${await response.text()}`);");
  lines.push("}");
  lines.push(`const data = await response.${expectsJson(r) ? "json" : "text"}();`);
  lines.push("console.log(data);");
  return `${head}${lines.join("\n")}\n${node ? "\nexport {};\n" : ""}`;
}

function expectsJson(r: CurlRequest): boolean {
  const accept = r.headers.find(([k]) => k.toLowerCase() === "accept")?.[1] ?? "";
  return /json/i.test(accept) || r.bodyKind === "json" || /\/api\/|\.json(\?|$)|graphql/i.test(r.url) || !accept;
}

function toAxios(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : [])];
  const lines = ['import axios from "axios";', ""];
  if (r.bodyKind === "multipart") {
    lines.push("const form = new FormData();");
    for (const f of r.form) lines.push(f.file ? `form.append(${js(f.name)}, file); // ${f.value}` : `form.append(${js(f.name)}, ${js(f.value)});`);
    lines.push("");
  }
  const u = new URL(r.url);
  const params = [...u.searchParams];
  const base = params.length ? `${u.origin}${u.pathname}` : r.url;
  const opts: string[] = [`  method: ${js(r.method.toLowerCase())},`, `  url: ${js(base)},`];
  if (params.length) opts.push(`  params: {\n${params.map(([k, v]) => `    ${js(k)}: ${js(v)},`).join("\n")}\n  },`);
  if (headers.length) opts.push(`  headers: {\n${headers.map(([k, v]) => `    ${js(k)}: ${js(v)},`).join("\n")}\n  },`);
  if (r.basicAuth) opts.push(`  auth: { username: ${js(r.basicAuth.user)}, password: ${js(r.basicAuth.password)} },`);
  if (r.bodyKind === "json") opts.push(`  data: ${indentJson(r.body!, 2)},`);
  else if (r.bodyKind === "form") opts.push(`  data: new URLSearchParams({\n${formPairs(r.body!).map(([k, v]) => `    ${js(k)}: ${js(v)},`).join("\n")}\n  }),`);
  else if (r.bodyKind === "raw") opts.push(`  data: ${js(r.body!)},`);
  else if (r.bodyKind === "multipart") opts.push("  data: form,");
  if (r.timeoutSeconds) opts.push(`  timeout: ${r.timeoutSeconds * 1000},`);
  if (!r.followRedirects) opts.push("  maxRedirects: 0, // curl without -L does not follow redirects; remove to follow them");
  if (r.bodyKind === "multipart" && r.form.some(f => f.file)) lines.splice(2, 0, 'const file = document.querySelector("input[type=file]").files[0];', "");
  lines.push(`const { data, status } = await axios.request({\n${opts.join("\n")}\n});`);
  lines.push("console.log(status, data);");
  return lines.join("\n") + "\n";
}

function toPython(r: CurlRequest): string {
  const headers = plainHeaders(r, r.bodyKind === "json" || r.bodyKind === "multipart" ? ["content-type"] : []);
  const lines = ["import requests", ""];
  const args: string[] = [`    ${py(r.url)},`];
  if (headers.length) { lines.push(`headers = {\n${headers.map(([k, v]) => `    ${py(k)}: ${py(v)},`).join("\n")}\n}`); args.push("    headers=headers,"); }
  if (r.bodyKind === "json") { lines.push(`payload = ${pyLiteral(JSON.parse(r.body!))}`); args.push("    json=payload,"); }
  else if (r.bodyKind === "form") { lines.push(`data = {\n${formPairs(r.body!).map(([k, v]) => `    ${py(k)}: ${py(v)},`).join("\n")}\n}`); args.push("    data=data,"); }
  else if (r.bodyKind === "raw") { lines.push(`data = ${py(r.body!)}`); args.push("    data=data.encode(\"utf-8\"),"); }
  else if (r.bodyKind === "multipart") {
    const files = r.form.filter(f => f.file);
    const fields = r.form.filter(f => !f.file);
    if (fields.length) { lines.push(`data = {\n${fields.map(f => `    ${py(f.name)}: ${py(f.value)},`).join("\n")}\n}`); args.push("    data=data,"); }
    if (files.length) { lines.push(`files = {\n${files.map(f => `    ${py(f.name)}: open(${py(f.value)}, "rb"),`).join("\n")}\n}`); args.push("    files=files,"); }
  }
  if (r.basicAuth) args.push(`    auth=(${py(r.basicAuth.user)}, ${py(r.basicAuth.password)}),`);
  args.push(`    timeout=${r.timeoutSeconds ?? 30},`);
  if (r.insecure) args.push("    verify=False,  # curl -k: TLS verification disabled - development only");
  if (!r.followRedirects && r.method === "GET") args.push("    allow_redirects=False,");
  if (lines.length > 2) lines.push("");
  lines.push(`response = requests.request(\n    ${py(r.method)},\n${args.join("\n")}\n)`);
  lines.push("response.raise_for_status()");
  lines.push(expectsJson(r) ? "print(response.json())" : "print(response.text)");
  return lines.join("\n") + "\n";
}

function toGo(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : [])];
  const imports = new Set(["fmt", "io", "net/http", "log"]);
  const body: string[] = [];
  let reader = "nil";
  if (r.bodyKind === "json" || r.bodyKind === "raw" || r.bodyKind === "form") {
    imports.add("strings");
    const content = r.bodyKind === "json" ? JSON.stringify(JSON.parse(r.body!), null, "\t") : r.body!;
    body.push(`\tbody := strings.NewReader(${content.includes("`") ? goStr(content) : "`" + content + "`"})`);
    reader = "body";
  } else if (r.bodyKind === "multipart") {
    imports.add("bytes"); imports.add("mime/multipart");
    if (r.form.some(f => f.file)) { imports.add("os"); imports.add("path/filepath"); }
    body.push("\tvar buf bytes.Buffer", "\tw := multipart.NewWriter(&buf)");
    for (const f of r.form) {
      if (f.file) body.push(`\tif file, err := os.Open(${goStr(f.value)}); err == nil {`, `\t\tpart, _ := w.CreateFormFile(${goStr(f.name)}, filepath.Base(${goStr(f.value)}))`, "\t\tio.Copy(part, file)", "\t\tfile.Close()", "\t} else {", "\t\tlog.Fatal(err)", "\t}");
      else body.push(`\tw.WriteField(${goStr(f.name)}, ${goStr(f.value)})`);
    }
    body.push("\tw.Close()");
    reader = "&buf";
  }
  const lines = [...body, `\treq, err := http.NewRequest(${goStr(r.method)}, ${goStr(r.url)}, ${reader})`, "\tif err != nil {", "\t\tlog.Fatal(err)", "\t}"];
  for (const [k, v] of headers) lines.push(`\treq.Header.Set(${goStr(k)}, ${goStr(v)})`);
  if (r.bodyKind === "multipart") lines.push("\treq.Header.Set(\"Content-Type\", w.FormDataContentType())");
  if (r.basicAuth) lines.push(`\treq.SetBasicAuth(${goStr(r.basicAuth.user)}, ${goStr(r.basicAuth.password)})`);
  if (r.timeoutSeconds) imports.add("time");
  const client = r.timeoutSeconds ? `&http.Client{Timeout: ${r.timeoutSeconds} * time.Second}` : "&http.Client{}";
  lines.push(`\tclient := ${client}`, "\tresp, err := client.Do(req)", "\tif err != nil {", "\t\tlog.Fatal(err)", "\t}", "\tdefer resp.Body.Close()", "\tdata, err := io.ReadAll(resp.Body)", "\tif err != nil {", "\t\tlog.Fatal(err)", "\t}", "\tfmt.Println(resp.Status)", "\tfmt.Println(string(data))");
  return `package main\n\nimport (\n${[...imports].sort().map(i => `\t"${i}"`).join("\n")}\n)\n\nfunc main() {\n${lines.join("\n")}\n}\n`;
}

function toPhp(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : [])];
  const lines = ["<?php", "", `$ch = curl_init(${php(r.url)});`, "curl_setopt_array($ch, ["];
  lines.push("    CURLOPT_RETURNTRANSFER => true,");
  lines.push(`    CURLOPT_CUSTOMREQUEST => ${php(r.method)},`);
  if (headers.length) lines.push(`    CURLOPT_HTTPHEADER => [\n${headers.map(([k, v]) => `        ${php(`${k}: ${v}`)},`).join("\n")}\n    ],`);
  if (r.bodyKind === "multipart") lines.push(`    CURLOPT_POSTFIELDS => [\n${r.form.map(f => `        ${php(f.name)} => ${f.file ? `new CURLFile(${php(f.value)})` : php(f.value)},`).join("\n")}\n    ],`);
  else if (r.body !== undefined) lines.push(`    CURLOPT_POSTFIELDS => ${php(r.body)},`);
  if (r.basicAuth) lines.push(`    CURLOPT_USERPWD => ${php(`${r.basicAuth.user}:${r.basicAuth.password}`)},`);
  if (r.followRedirects) lines.push("    CURLOPT_FOLLOWLOCATION => true,");
  if (r.timeoutSeconds) lines.push(`    CURLOPT_TIMEOUT => ${r.timeoutSeconds},`);
  if (r.compressed) lines.push("    CURLOPT_ENCODING => '',");
  lines.push("]);", "$response = curl_exec($ch);", "if ($response === false) {", "    throw new RuntimeException(curl_error($ch));", "}", "$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);", "curl_close($ch);", "echo $status, PHP_EOL, $response;");
  return lines.join("\n") + "\n";
}

function toJava(r: CurlRequest): string {
  const headers = [...plainHeaders(r), ...basicHeader(r)];
  const publisher = r.bodyKind === "multipart"
    ? "HttpRequest.BodyPublishers.noBody() /* multipart: use a library such as OkHttp or Apache HttpClient */"
    : r.body !== undefined ? `HttpRequest.BodyPublishers.ofString(${java(r.bodyKind === "json" ? JSON.stringify(JSON.parse(r.body)) : r.body)})` : "HttpRequest.BodyPublishers.noBody()";
  const lines = [
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "import java.time.Duration;",
    "",
    "public class Request {",
    "    public static void main(String[] args) throws Exception {",
    "        HttpClient client = HttpClient.newBuilder()",
    `            .followRedirects(HttpClient.Redirect.${r.followRedirects ? "NORMAL" : "NEVER"})`,
    `            .connectTimeout(Duration.ofSeconds(${r.timeoutSeconds ?? 30}))`,
    "            .build();",
    "        HttpRequest request = HttpRequest.newBuilder()",
    `            .uri(URI.create(${java(r.url)}))`,
    ...headers.map(([k, v]) => `            .header(${java(k)}, ${java(v)})`),
    `            .method(${java(r.method)}, ${publisher})`,
    "            .build();",
    "        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());",
    "        System.out.println(response.statusCode());",
    "        System.out.println(response.body());",
    "    }",
    "}"
  ];
  return lines.join("\n") + "\n";
}

function toDartHttp(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []), ...basicHeader(r)];
  const headerMap = headers.length ? `{\n${headers.map(([k, v]) => `    ${dart(k)}: ${dart(v)},`).join("\n")}\n  }` : "<String, String>{}";
  const imports = new Set(["import 'package:http/http.dart' as http;"]);
  const lines: string[] = [];
  if (r.bodyKind === "multipart") {
    lines.push(`  final request = http.MultipartRequest(${dart(r.method)}, Uri.parse(${dart(r.url)}));`);
    lines.push(`  request.headers.addAll(${headerMap});`);
    for (const f of r.form) lines.push(f.file ? `  request.files.add(await http.MultipartFile.fromPath(${dart(f.name)}, ${dart(f.value)}));` : `  request.fields[${dart(f.name)}] = ${dart(f.value)};`);
    lines.push("  final response = await http.Response.fromStream(await request.send());");
  } else {
    lines.push(`  final uri = Uri.parse(${dart(r.url)});`);
    lines.push(`  final headers = ${headerMap};`);
    let body = "";
    if (r.bodyKind === "json") { imports.add("import 'dart:convert';"); lines.push(`  final body = jsonEncode(${dartLiteral(JSON.parse(r.body!), 1)});`); body = ", body: body"; }
    else if (r.bodyKind === "form") { lines.push(`  final body = {\n${formPairs(r.body!).map(([k, v]) => `    ${dart(k)}: ${dart(v)},`).join("\n")}\n  };`); body = ", body: body"; }
    else if (r.bodyKind === "raw") { lines.push(`  final body = ${dart(r.body!)};`); body = ", body: body"; }
    const simple = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(r.method);
    if (simple) {
      const m = r.method.toLowerCase();
      lines.push(`  final response = await http.${m}(uri, headers: headers${m === "get" || m === "head" ? "" : body})${r.timeoutSeconds ? `.timeout(const Duration(seconds: ${r.timeoutSeconds}))` : ""};`);
    } else {
      lines.push(`  final request = http.Request(${dart(r.method)}, uri)..headers.addAll(headers);`);
      if (body) lines.push("  request.body = body is String ? body : jsonEncode(body);");
      lines.push("  final response = await http.Response.fromStream(await request.send());");
    }
  }
  lines.push("  if (response.statusCode >= 400) {", "    throw Exception('HTTP ${response.statusCode}: ${response.body}');", "  }", "  print(response.body);");
  return `${[...imports].sort().join("\n")}\n\nFuture<void> main() async {\n${lines.join("\n")}\n}\n`;
}

function toDio(r: CurlRequest): string {
  const headers = [...plainHeaders(r, ["content-type"]), ...basicHeader(r)];
  const contentType = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
  const lines = ["import 'package:dio/dio.dart';", "", "Future<void> main() async {", "  final dio = Dio(BaseOptions(", `    connectTimeout: const Duration(seconds: ${r.timeoutSeconds ?? 30}),`, `    receiveTimeout: const Duration(seconds: ${r.timeoutSeconds ?? 30}),`, "  ));"];
  let data = "";
  if (r.bodyKind === "json") { lines.push(`  final data = ${dartLiteral(JSON.parse(r.body!), 1)};`); data = "\n    data: data,"; }
  else if (r.bodyKind === "form") { lines.push(`  final data = {\n${formPairs(r.body!).map(([k, v]) => `    ${dart(k)}: ${dart(v)},`).join("\n")}\n  };`); data = "\n    data: data,"; }
  else if (r.bodyKind === "raw") { lines.push(`  final data = ${dart(r.body!)};`); data = "\n    data: data,"; }
  else if (r.bodyKind === "multipart") {
    lines.push(`  final data = FormData.fromMap({\n${r.form.map(f => `    ${dart(f.name)}: ${f.file ? `await MultipartFile.fromFile(${dart(f.value)})` : dart(f.value)},`).join("\n")}\n  });`);
    data = "\n    data: data,";
  }
  const ct = r.bodyKind === "form" ? "\n      contentType: Headers.formUrlEncodedContentType," : contentType && r.bodyKind !== "multipart" ? `\n      contentType: ${dart(contentType)},` : "";
  lines.push(`  final response = await dio.request(\n    ${dart(r.url)},${data}\n    options: Options(\n      method: ${dart(r.method)},${headers.length ? `\n      headers: {\n${headers.map(([k, v]) => `        ${dart(k)}: ${dart(v)},`).join("\n")}\n      },` : ""}${ct}${r.followRedirects ? "" : "\n      followRedirects: false,"}\n    ),\n  );`);
  lines.push("  print(response.data);", "}");
  return lines.join("\n") + "\n";
}

function toOkHttp(r: CurlRequest): string {
  const headers = [...plainHeaders(r, ["content-type"]), ...basicHeader(r)];
  const contentType = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? (r.bodyKind === "json" ? "application/json" : "text/plain");
  const imports = new Set(["okhttp3.OkHttpClient", "okhttp3.Request"]);
  const lines: string[] = [];
  let body = "null";
  if (r.bodyKind === "json" || r.bodyKind === "raw" || r.bodyKind === "form") {
    imports.add("okhttp3.MediaType.Companion.toMediaType"); imports.add("okhttp3.RequestBody.Companion.toRequestBody");
    const content = r.bodyKind === "json" ? JSON.stringify(JSON.parse(r.body!)) : r.body!;
    lines.push(`    val body = ${kotlin(content)}.toRequestBody(${kotlin(contentType)}.toMediaType())`);
    body = "body";
  } else if (r.bodyKind === "multipart") {
    imports.add("okhttp3.MultipartBody"); imports.add("okhttp3.RequestBody.Companion.asRequestBody"); imports.add("java.io.File");
    lines.push("    val body = MultipartBody.Builder()", "        .setType(MultipartBody.FORM)");
    for (const f of r.form) lines.push(f.file ? `        .addFormDataPart(${kotlin(f.name)}, File(${kotlin(f.value)}).name, File(${kotlin(f.value)}).asRequestBody())` : `        .addFormDataPart(${kotlin(f.name)}, ${kotlin(f.value)})`);
    lines.push("        .build()");
    body = "body";
  }
  if (r.timeoutSeconds) imports.add("java.util.concurrent.TimeUnit");
  const client = ["    val client = OkHttpClient.Builder()", ...(r.timeoutSeconds ? [`        .callTimeout(${r.timeoutSeconds}L, TimeUnit.SECONDS)`] : []), `        .followRedirects(${r.followRedirects})`, "        .build()"];
  const request = ["    val request = Request.Builder()", `        .url(${kotlin(r.url)})`, ...headers.map(([k, v]) => `        .addHeader(${kotlin(k)}, ${kotlin(v)})`), `        .method(${kotlin(r.method)}, ${body})`, "        .build()"];
  return `${[...imports].sort().map(i => `import ${i}`).join("\n")}\n\n// Run off the main thread on Android (coroutine with Dispatchers.IO, or client.newCall(request).enqueue).\nfun main() {\n${[...client, ...lines, ...request].join("\n")}\n    client.newCall(request).execute().use { response ->\n        if (!response.isSuccessful) error("HTTP \${response.code}: \${response.body?.string()}")\n        println(response.body?.string())\n    }\n}\n`;
}

function toSwift(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []), ...basicHeader(r)];
  const lines = ["import Foundation", "", `var request = URLRequest(url: URL(string: ${swift(r.url)})!)`, `request.httpMethod = ${swift(r.method)}`];
  if (r.timeoutSeconds) lines.push(`request.timeoutInterval = ${r.timeoutSeconds}`);
  for (const [k, v] of headers) lines.push(`request.setValue(${swift(v)}, forHTTPHeaderField: ${swift(k)})`);
  if (r.bodyKind === "json") lines.push(`request.httpBody = #"""\n${JSON.stringify(JSON.parse(r.body!), null, 2)}\n"""#.data(using: .utf8)`);
  else if (r.bodyKind === "form" || r.bodyKind === "raw") lines.push(`request.httpBody = ${swift(r.body!)}.data(using: .utf8)`);
  else if (r.bodyKind === "multipart") {
    lines.push("", "let boundary = \"Boundary-\\(UUID().uuidString)\"", "request.setValue(\"multipart/form-data; boundary=\\(boundary)\", forHTTPHeaderField: \"Content-Type\")", "var body = Data()");
    for (const f of r.form) {
      if (f.file) lines.push(`let fileURL = URL(fileURLWithPath: ${swift(f.value)})`, "body.append(\"--\\(boundary)\\r\\n\".data(using: .utf8)!)", `body.append("Content-Disposition: form-data; name=\\"${f.name.replace(/"/g, "")}\\"; filename=\\"\\(fileURL.lastPathComponent)\\"\\r\\n\\r\\n".data(using: .utf8)!)`, "body.append(try! Data(contentsOf: fileURL))", "body.append(\"\\r\\n\".data(using: .utf8)!)");
      else lines.push("body.append(\"--\\(boundary)\\r\\n\".data(using: .utf8)!)", `body.append("Content-Disposition: form-data; name=\\"${f.name.replace(/"/g, "")}\\"\\r\\n\\r\\n".data(using: .utf8)!)`, `body.append(${swift(f.value + "\r\n")}.data(using: .utf8)!)`);
    }
    lines.push("body.append(\"--\\(boundary)--\\r\\n\".data(using: .utf8)!)", "request.httpBody = body");
  }
  lines.push("", "let (data, response) = try await URLSession.shared.data(for: request)", "guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {", "    throw URLError(.badServerResponse)", "}", "print(String(decoding: data, as: UTF8.self))");
  return lines.join("\n") + "\n";
}

function toRawHttp(r: CurlRequest): string {
  const u = new URL(r.url);
  const lines = [`${r.method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, ...plainHeaders(r).map(([k, v]) => `${k}: ${v}`), ...basicHeader(r).map(([k, v]) => `${k}: ${v}`)];
  if (r.bodyKind === "multipart") lines.push("Content-Type: multipart/form-data; boundary=----devsnip");
  let body = "";
  if (r.bodyKind === "json") body = JSON.stringify(JSON.parse(r.body!), null, 2);
  else if (r.body !== undefined) body = r.body;
  else if (r.bodyKind === "multipart") body = r.form.map(f => `------devsnip\r\nContent-Disposition: form-data; name="${f.name}"${f.file ? `; filename="${f.value.split(/[\\/]/).pop()}"` : ""}\r\n\r\n${f.file ? `< ${f.value}` : f.value}`).join("\r\n") + "\r\n------devsnip--";
  return `${lines.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

function shq(s: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

function toHttpie(r: CurlRequest): string {
  const parts = ["http"];
  if (r.bodyKind === "form" || r.bodyKind === "multipart") parts.push(r.bodyKind === "multipart" ? "--multipart" : "--form");
  if (r.followRedirects) parts.push("--follow");
  if (r.insecure) parts.push("--verify=no");
  if (r.timeoutSeconds) parts.push(`--timeout=${r.timeoutSeconds}`);
  if (r.basicAuth) parts.push(`--auth ${shq(`${r.basicAuth.user}:${r.basicAuth.password}`)}`);
  parts.push(r.method, shq(r.url));
  for (const [k, v] of plainHeaders(r, r.bodyKind === "json" ? ["content-type"] : [])) parts.push(shq(`${k}:${v}`));
  if (r.bodyKind === "form") for (const [k, v] of formPairs(r.body!)) parts.push(shq(`${k}=${v}`));
  if (r.bodyKind === "multipart") for (const f of r.form) parts.push(shq(f.file ? `${f.name}@${f.value}` : `${f.name}=${f.value}`));
  const prefix = r.bodyKind === "json" ? `echo ${shq(JSON.stringify(JSON.parse(r.body!)))} | ` : r.bodyKind === "raw" ? `printf %s ${shq(r.body!)} | ` : "";
  return `${prefix}${parts.join(" ")}\n`;
}

/** Back to a clean, canonical cURL command (one option per line). */
export function toCurl(r: CurlRequest): string {
  const parts = [`curl${r.followRedirects ? " -L" : ""}${r.insecure ? " -k" : ""}${r.compressed ? " --compressed" : ""} -X ${r.method} ${shq(r.url)}`];
  for (const [k, v] of r.headers) parts.push(`-H ${shq(`${k}: ${v}`)}`);
  if (r.basicAuth) parts.push(`-u ${shq(`${r.basicAuth.user}:${r.basicAuth.password}`)}`);
  if (r.bodyKind === "json") parts.push(`--data-raw ${shq(JSON.stringify(JSON.parse(r.body!)))}`);
  else if (r.body !== undefined) parts.push(`--data-raw ${shq(r.body)}`);
  for (const f of r.form) parts.push(`-F ${shq(`${f.name}=${f.file ? "@" : ""}${f.value}`)}`);
  if (r.timeoutSeconds) parts.push(`--max-time ${r.timeoutSeconds}`);
  return parts.join(" \\\n  ") + "\n";
}

/** Notes worth knowing before running the converted request. */
export function curlWarnings(r: CurlRequest): string[] {
  const out: string[] = [];
  const auth = r.headers.find(([k]) => /^(authorization|x-api-key|api-key|x-auth-token)$/i.test(k));
  if (auth || r.basicAuth) out.push("The request carries credentials. Move them to environment variables or secure storage before committing the code.");
  if (r.headers.some(([k]) => k.toLowerCase() === "cookie")) out.push("A Cookie header was copied from the browser; session cookies expire, so replace it with a real login flow in code.");
  if (r.insecure) out.push("curl -k disables TLS certificate checks. The generated code keeps verification on (except Python, where it is marked); fix the certificate instead.");
  if (r.proxy) out.push(`The request used a proxy (${r.proxy}); configure it in the client if you still need it.`);
  if (r.url.startsWith("http://") && !/\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.|10\.)/.test(r.url)) out.push("Plain http:// is blocked by default on Android 9+ and by App Transport Security on iOS; use https.");
  const browserNoise = r.headers.filter(([k]) => /^(sec-|priority$|upgrade-insecure-requests$|dnt$|pragma$)/i.test(k));
  if (browserNoise.length) out.push(`Browser-only headers can usually be dropped: ${browserNoise.map(([k]) => k).join(", ")}.`);
  if (r.ignored.length) out.push(`Ignored options: ${r.ignored.join(", ")}.`);
  return out;
}
