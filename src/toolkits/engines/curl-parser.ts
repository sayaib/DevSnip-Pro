import { ToolInputError } from "../types";
import type { CurlRequest } from "./web-curl";
import { tokenizeShell, readCmdEnvelope } from "./curl-shell";

export const CURL_MAX_INPUT = 256 * 1024;
export const CURL_MAX_REQUESTS = 50;
export type CurlShell = "auto" | "bash" | "cmd" | "powershell";
const takesValue = new Set(["X", "H", "d", "F", "u", "b", "A", "e", "m", "x", "o", "w", "c", "T", "r", "z", "K", "y", "Y", "D"]);
const ignoredValues = new Set(["--output", "-o", "--write-out", "-w", "--cookie-jar", "-c", "--retry", "--retry-delay", "--retry-max-time", "--cacert", "--cert", "--key", "--resolve", "--limit-rate", "--range", "-r", "--time-cond", "-z", "--config", "-K", "--max-redirs", "--interface", "--speed-time", "-y", "--speed-limit", "-Y", "--dump-header", "-D", "--request-target", "--proxy-user", "--user-agent", "--referer"]);
const cosmetic = new Set(["-s", "--silent", "-S", "--show-error", "-v", "--verbose", "-i", "--include", "-f", "--fail", "--fail-with-body", "-#", "--progress-bar", "-N", "--no-buffer", "-O", "--remote-name", "-J", "--remote-header-name", "--globoff", "-g"]);
const has = (r: CurlRequest, name: string) => r.headers.some(([key]) => key.toLowerCase() === name.toLowerCase()) || !!r.suppressedHeaders?.some(key => key.toLowerCase() === name.toLowerCase());
const numeric = (value: string, flag: string) => {
  const n = Number(value);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(n) || n < 0 || n > 2147483) throw new ToolInputError(`${flag} must be a nonnegative number up to 2147483 seconds.`);
  return n;
};

/** Commands are parsed as data. No shell expansion, file access or execution. */
export function parseCurl(command: string, shell: CurlShell = "auto"): CurlRequest {
  const requests = parseCurlCommands(command, shell);
  if (requests.length !== 1) throw new ToolInputError("This contains multiple requests. Enable batch conversion or use one cURL command.");
  return requests[0];
}

export function parseCurlCommands(command: string, shell: CurlShell = "auto"): CurlRequest[] {
  if (command.length > CURL_MAX_INPUT || Buffer.byteLength(command) > CURL_MAX_INPUT) throw new ToolInputError("cURL input exceeds 256 KiB. Split the batch into smaller requests.");
  if (!["auto", "bash", "cmd", "powershell"].includes(shell)) throw new ToolInputError("Unsupported shell dialect.");
  const chunks = splitCommands(command, shell);
  const result: CurlRequest[] = [];
  for (const chunk of chunks) {
    const tokens = tokenizeShell(chunk, shell);
    if (!tokens.length) continue;
    if (tokens[0] === "$") tokens.shift();
    if (!/(^|[\\/])curl(\.exe)?$/i.test(tokens.shift() ?? "")) throw new ToolInputError("Every command must start with curl or curl.exe. Shell pipelines and other programs are not supported.");
    if (tokens.length > 20000) throw new ToolInputError("Too many cURL arguments.");
    // --next only separates transfers when it is an option, never when consumed as a value.
    let segment: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "--next" || token === "-:") { result.push(parseTokens(segment)); if (result.length >= CURL_MAX_REQUESTS) throw new ToolInputError("Convert at most 50 requests per batch."); segment = []; continue; }
      segment.push(token);
      if (optionNeedsValue(token) && i + 1 < tokens.length) segment.push(tokens[++i]);
    }
    result.push(parseTokens(segment));
    if (result.length > CURL_MAX_REQUESTS) throw new ToolInputError("Convert at most 50 requests per batch.");
  }
  if (!result.length) throw new ToolInputError("Paste a cURL command.");
  return result;
}

function optionNeedsValue(token: string): boolean {
  return /^(?:--(?:request|header|data|data-raw|data-binary|data-ascii|data-urlencode|json|form|form-string|user|cookie|url|url-query|max-time|connect-timeout|proxy|oauth2-bearer|upload-file)|-[XHdFubAemxTrzwcoKDyY])$/.test(token) || ignoredValues.has(token) || /^-[sSvkLiGf]*[XHdFubAemxTrzwcoKDyY]$/.test(token);
}

/** Split only outside quoting; continued lines and newlines inside data are retained. */
function splitCommands(input: string, shell: CurlShell): string[] {
  const chunks: string[] = [];
  let quote = "", start = 0, ansi = false, cmdStyle = shell === "cmd";
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!quote && c === "^" && input[i + 1] === '"' && (shell === "cmd" || shell === "auto")) { cmdStyle = true; i = readCmdEnvelope(input, i).end - 1; continue; }
    if (c === "\\" && (quote !== "'" || ansi) && shell !== "cmd" && shell !== "powershell" || c === "^" && quote !== "'" && (shell === "cmd" || shell === "auto") || c === "`" && quote !== "'" && (shell === "powershell" || shell === "auto")) { i++; if (input[i] === "\r" && input[i + 1] === "\n") i++; continue; }
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') { quote = c; ansi = c === "'" && input[i - 1] === "$"; continue; }
    if (c === "|" || c === ">" || c === "<" || c === "&" && input[i + 1] !== "&" && !cmdStyle) throw new ToolInputError("Quote shell metacharacters in URLs/data. Pipes, background commands and redirection are not supported.");
    const separator = c === ";" || c === "\n" || c === "&" && (input[i + 1] === "&" || cmdStyle);
    if (separator) { const chunk = input.slice(start, i).trim(); if (chunk) chunks.push(chunk); if (c === "&" && input[i + 1] === "&") i++; start = i + 1; }
  }
  if (input.slice(start).trim()) chunks.push(input.slice(start).trim());
  return chunks;
}

function parseTokens(args: string[]): CurlRequest {
  const r: CurlRequest = { method: "", url: "", headers: [], bodyKind: "none", form: [], insecure: false, followRedirects: false, compressed: false, ignored: [] };
  const data: string[] = [], query: string[] = [], separators: string[] = [];
  const addData = (v: string, concatenate = false) => { if (data.length) separators.push(concatenate ? "" : "&"); data.push(v); };
  const joinedData = () => data.map((part,i) => (i ? separators[i - 1] : "") + part).join("");
  let get = false, head = false, json = false, endOptions = false, upload = false;
  const setUrl = (url: string) => {
    if (r.url) throw new ToolInputError("Multiple URLs in one transfer are ambiguous. Separate requests with --next or separate cURL commands.");
    r.url = url;
  };
  for (let i = 0; i < args.length; i++) {
    let flag = args[i], attached: string | undefined;
    if (flag === "--" && !endOptions) { endOptions = true; continue; }
    if (endOptions || !flag.startsWith("-")) { setUrl(flag); continue; }
    if (flag.startsWith("--") && flag.includes("=")) { const eq = flag.indexOf("="); attached = flag.slice(eq + 1); flag = flag.slice(0, eq); }
    else if (/^-[^-].+/.test(flag)) {
      const chars = flag.slice(1);
      let found = false;
      for (let j = 0; j < chars.length; j++) {
        if (takesValue.has(chars[j])) {
          flag = `-${chars[j]}`; attached = j + 1 < chars.length ? chars.slice(j + 1) : undefined; found = true; break;
        }
        switch (chars[j]) { case "G": get = true; break; case "I": head = true; break; case "L": r.followRedirects = true; break; case "k": r.insecure = true; break; default: if (!cosmetic.has(`-${chars[j]}`)) r.ignored.push(`-${chars[j]}`); }
      }
      if (!found) continue;
    }
    const value = () => {
      if (attached !== undefined) { const v = attached; attached = undefined; return v; }
      if (++i >= args.length) throw new ToolInputError(`${flag} needs a value.`);
      return args[i];
    };
    const payload = (v: string, isFile: boolean, concatenate = false) => {
      if (isFile && v.startsWith("@")) {
        if (data.length || r.bodyFile) throw new ToolInputError("Mixed file and inline request bodies require manual composition.");
        if (v === "@-") throw new ToolInputError("Standard input bodies cannot be converted. Paste the body inline.");
        r.bodyFile = v.slice(1);
      } else { if (r.bodyFile) throw new ToolInputError("Mixed file and inline request bodies require manual composition."); addData(v, concatenate); }
    };
    const encoded = (v: string) => {
      const eq = v.indexOf("=");
      if (eq < 0 && v.includes("@")) throw new ToolInputError("File-based URL encoding requires inline file contents. Use name=value.");
      return eq < 0 ? encodeURIComponent(v) : eq === 0 ? encodeURIComponent(v.slice(1)) : `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`;
    };
    switch (flag) {
      case "-X": case "--request": r.method = value().toUpperCase(); break;
      case "--url": setUrl(value()); break;
      case "-H": case "--header": {
        const h = value();
        if (h.startsWith("@")) throw new ToolInputError("Header files are not loaded. Paste each header with -H 'Name: value'.");
        const colon = h.indexOf(":"), semi = h.endsWith(";");
        if (colon < 1 && !semi) throw new ToolInputError("Headers must use Name: value.");
        const name = (colon > 0 ? h.slice(0, colon) : h.slice(0, -1)).trim();
        const v = colon > 0 ? h.slice(colon + 1).trim() : "";
        if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(v)) throw new ToolInputError("Invalid HTTP header name or value.");
        // cURL -H 'Name:' suppresses that header; -H 'Name;' sends an empty header.
        if (colon > 0 && !v) { r.headers = r.headers.filter(([k]) => k.toLowerCase() !== name.toLowerCase()); (r.suppressedHeaders ??= []).push(name); }
        else { r.suppressedHeaders = r.suppressedHeaders?.filter(k => k.toLowerCase() !== name.toLowerCase()); r.headers.push([name, v]); }
        break;
      }
      case "-d": case "--data": case "--data-ascii": { const v = value(); if (v.startsWith("@")) throw new ToolInputError("--data @file strips newlines. Use --data-binary @file or paste the contents inline."); payload(v, false); break; }
      case "--data-raw": payload(value(), false); break;
      case "--data-binary": payload(value(), true); break;
      case "--json": payload(value(), true, true); json = true; break;
      case "--data-urlencode": addData(encoded(value())); break;
      case "--url-query": { const v = value(); query.push(v.startsWith("+") ? v.slice(1) : encoded(v)); break; }
      case "-T": case "--upload-file": if (r.bodyFile || data.length) throw new ToolInputError("Only one request body file is supported."); r.bodyFile = value(); upload = true; if (r.bodyFile === "-") throw new ToolInputError("Standard input upload requires file contents."); break;
      case "-F": case "--form": case "--form-string": {
        const v = value(), eq = v.indexOf("=");
        if (eq < 1) throw new ToolInputError("Multipart fields must use name=value.");
        const name = v.slice(0, eq), raw = v.slice(eq + 1), literal = flag === "--form-string";
        if (/[\r\n\0"\\]/.test(name)) throw new ToolInputError("Multipart field names cannot contain quotes, backslashes or control characters.");
        if (!literal && raw.startsWith("<")) throw new ToolInputError("Text fields read from files need inline contents (--form-string name=value).");
        const parts = literal ? [raw] : raw.split(";");
        const file = !literal && parts[0].startsWith("@");
        if (file && (parts[0].includes(",") || parts[0] === "@-")) throw new ToolInputError("Use one explicit file per -F option; stdin and multi-file form syntax are unsupported.");
        const field: CurlRequest["form"][number] = { name, value: file ? parts[0].slice(1) : parts[0], file };
        for (const param of parts.slice(1)) { const m = /^(type|filename)=(.+)$/.exec(param); if (!m) throw new ToolInputError("Unsupported multipart modifier; use ;type= or ;filename=."); if (/[\r\n\0"\\]/.test(m[2])) throw new ToolInputError("Invalid multipart metadata."); if (m[1] === "type") field.contentType = m[2]; else field.filename = m[2]; }
        if (field.filename && !file) throw new ToolInputError("Custom filenames require a file upload field.");
        if (field.contentType && !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(field.contentType)) throw new ToolInputError("Invalid multipart MIME type.");
        r.form.push(field); break;
      }
      case "-u": case "--user": { const v = value(), colon = v.indexOf(":"); r.basicAuth = { user: colon < 0 ? v : v.slice(0, colon), password: colon < 0 ? "" : v.slice(colon + 1) }; break; }
      case "--oauth2-bearer": r.headers.push(["Authorization", `Bearer ${value()}`]); break;
      case "-b": case "--cookie": { const v = value(); if (v.includes("=")) r.headers.push(["Cookie", v]); else r.ignored.push("cookie file (not loaded)"); break; }
      case "-A": case "--user-agent": r.headers.push(["User-Agent", value()]); break;
      case "-e": case "--referer": r.headers.push(["Referer", value()]); break;
      case "-G": case "--get": get = true; break;
      case "-I": case "--head": head = true; break;
      case "-L": case "--location": r.followRedirects = true; break;
      case "--no-location": r.followRedirects = false; break;
      case "-k": case "--insecure": r.insecure = true; break;
      case "--no-insecure": r.insecure = false; break;
      case "--compressed": r.compressed = true; break;
      case "-m": case "--max-time": r.timeoutSeconds = numeric(value(), flag); break;
      case "--connect-timeout": r.connectTimeoutSeconds = numeric(value(), flag); break;
      case "-x": case "--proxy": r.proxy = value(); break;
      default: if (ignoredValues.has(flag)) r.ignored.push(`${flag} (not converted)`), value(); else if (!cosmetic.has(flag)) r.ignored.push(flag);
    }
  }
  if (/[\r\n\0]/.test(r.url)) throw new ToolInputError("URLs cannot contain control characters.");
  if (!r.url) throw new ToolInputError("The command has no URL.");
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(r.url)) r.url = `http://${r.url}`;
  let url: URL;
  try { url = new URL(r.url); } catch { throw new ToolInputError("Invalid request URL."); }
  if (!["https:", "http:"].includes(url.protocol)) throw new ToolInputError("Only HTTP and HTTPS requests can be converted.");
  if (url.username || url.password) { if (!r.basicAuth) { try { r.basicAuth = { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }; } catch { throw new ToolInputError("Invalid percent encoding in URL credentials."); } } url.username = ""; url.password = ""; r.url = url.toString(); }
  if (upload && r.bodyFile && url.pathname.endsWith("/")) { url.pathname += encodeURIComponent(r.bodyFile.split(/[\\/]/).pop()!); r.url = url.toString(); }
  if (url.hash) { r.url = r.url.split("#")[0]; }
  if (r.bodyFile === "") throw new ToolInputError("Body file path cannot be empty.");
  if (r.form.length && (data.length || r.bodyFile) || r.bodyFile && data.length) throw new ToolInputError("Multipart, file and inline request bodies cannot be mixed.");
  if (get && r.bodyFile) throw new ToolInputError("GET query data read from a file must be supplied inline.");
  if (get && data.length) query.push(joinedData());
  if (query.length) { const separator = r.url.includes("?") ? (/[?&]$/.test(r.url) ? "" : "&") : "?"; r.url += separator + query.join("&"); }
  if (json) { if (!has(r, "Content-Type")) r.headers.push(["Content-Type", "application/json"]); if (!has(r, "Accept")) r.headers.push(["Accept", "application/json"]); }
  if (data.length && !get) {
    r.body = joinedData();
    const type = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "application/x-www-form-urlencoded";
    if (!has(r, "Content-Type")) r.headers.push(["Content-Type", type]);
    if (/json/i.test(type)) { try { JSON.parse(r.body); r.bodyKind = "json"; } catch { r.bodyKind = "raw"; r.warnings = ["The declared JSON body is invalid JSON and is preserved as raw text."]; } }
    else r.bodyKind = /x-www-form-urlencoded/i.test(type) ? "form" : "raw";
  } else if (r.bodyFile) { r.bodyKind = "raw"; if (!upload && !has(r, "Content-Type")) r.headers.push(["Content-Type", "application/x-www-form-urlencoded"]); }
  else if (r.form.length) { r.bodyKind = "multipart"; r.headers = r.headers.filter(([k]) => k.toLowerCase() !== "content-type"); }
  if (!r.method) r.method = head ? "HEAD" : get ? "GET" : upload ? "PUT" : (r.body !== undefined || r.form.length || r.bodyFile) ? "POST" : "GET";
  if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(r.method)) throw new ToolInputError("Invalid HTTP method.");
  for (const [name, v] of r.headers) if (/[\x00-\x08\x0a-\x1f\x7f]/.test(name + v)) throw new ToolInputError("Headers cannot contain control characters.");
  return r;
}
