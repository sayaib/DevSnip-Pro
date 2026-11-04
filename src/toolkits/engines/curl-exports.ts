import type { CurlRequest } from "./web-curl";

const secretHeader = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i;
const secretKey = /(?:password|passwd|secret|token|api[-_]?key|authorization|session|credential)/i;
export const isCurlSecretHeader = (name: string): boolean => secretHeader.test(name);

/** Replace sensitive JSON values by source range, retaining non-secret numbers and body formatting. */
function redactJson(source: string): string {
  const strings = /"(?:\\.|[^"\\])*"/g;
  let out = "", offset = 0, match: RegExpExecArray | null;
  while ((match = strings.exec(source))) {
    let colon = strings.lastIndex;
    while (/\s/.test(source[colon] ?? "") && colon < source.length) colon++;
    if (source[colon] !== ":" || !secretKey.test(JSON.parse(match[0]))) continue;
    let start = colon + 1;
    while (/\s/.test(source[start] ?? "") && start < source.length) start++;
    let end = start, depth = 0, quoted = false;
    for (; end < source.length; end++) {
      const c = source[end];
      if (quoted) { if (c === "\\") end++; else if (c === '"') quoted = false; continue; }
      if (c === '"') { quoted = true; continue; }
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") { if (!depth) break; depth--; }
      else if (!depth && (c === "," || /\s/.test(c))) break;
    }
    out += source.slice(offset, start) + '"REDACTED"'; offset = end; strings.lastIndex = end;
  }
  return out + source.slice(offset);
}

/** Deep clone without modifying the parsed request. Redacts nested JSON, forms, auth and URL secrets. */
export function redactCurl(request: CurlRequest): CurlRequest {
  const r: CurlRequest = JSON.parse(JSON.stringify(request));
  r.headers = r.headers.map(([k, v]) => [k, secretHeader.test(k) ? "REDACTED" : v]);
  if (r.basicAuth) r.basicAuth = { user: "REDACTED", password: "REDACTED" };
  const url = new URL(r.url);
  const pairs = [...url.searchParams];
  if (pairs.some(([k]) => secretKey.test(k))) { url.search = ""; for (const [k, v] of pairs) url.searchParams.append(k, secretKey.test(k) ? "REDACTED" : v); r.url = url.toString(); }
  if (r.proxy) { try { const proxy = new URL(r.proxy); if (proxy.username || proxy.password) { proxy.username = "REDACTED"; proxy.password = "REDACTED"; r.proxy = proxy.toString(); } } catch { r.proxy = "REDACTED"; } }
  if (r.bodyKind === "json" && r.body !== undefined) {
    r.body = redactJson(r.body);
  } else if (r.bodyKind === "form" && r.body !== undefined) {
    const pairs = [...new URLSearchParams(r.body)];
    if (pairs.some(([k]) => secretKey.test(k))) r.body = new URLSearchParams(pairs.map(([k,v]) => [k, secretKey.test(k) ? "REDACTED" : v])).toString();
  } else if (r.body !== undefined) r.body = "REDACTED";
  r.form = r.form.map(f => ({ ...f, value: secretKey.test(f.name) ? "REDACTED" : f.value }));
  r.ignored = r.ignored.map(flag => flag.split(" ")[0]);
  return r;
}

/** Importable Postman v2.1 collection. Original body bytes and repeated fields remain intact. */
export function curlPostman(requests: CurlRequest[]): string {
  return JSON.stringify({ info: { name: "Converted cURL requests", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: requests.map((r, i) => ({ name: `${i + 1}. ${r.method} ${new URL(r.url).pathname}`, request: {
    method: r.method, header: r.headers.map(([key, value]) => ({ key, value })), url: r.url,
    ...(r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k)) ? { auth: { type: "basic", basic: [{ key: "username", value: r.basicAuth.user, type: "string" }, { key: "password", value: r.basicAuth.password, type: "string" }] } } : {}),
    ...(r.bodyFile ? { body: { mode: "file", file: { src: r.bodyFile } } } : r.body !== undefined ? { body: { mode: "raw", raw: r.body, ...(r.bodyKind === "json" ? { options: { raw: { language: "json" } } } : {}) } } : r.form.length ? { body: { mode: "formdata", formdata: r.form.map(f => ({ key: f.name, type: f.file ? "file" : "text", ...(f.file ? { src: f.value } : { value: f.value }), ...(f.contentType ? { contentType: f.contentType } : {}) })) } } : {})
  } })) }, null, 2) + "\n";
}

/** HAR is an interchange preview: response/timing fields are placeholders, no request is sent. */
export function curlHar(requests: CurlRequest[]): string {
  return JSON.stringify({ log: { version: "1.2", creator: { name: "DevSnip Pro", version: "1.0" }, entries: requests.map(r => ({ startedDateTime: "1970-01-01T00:00:00.000Z", time: 0, request: {
    method: r.method, url: r.url, httpVersion: "HTTP/1.1", cookies: [], headers: [...r.headers, ...(r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k)) ? [["Authorization", "Basic " + Buffer.from(`${r.basicAuth.user}:${r.basicAuth.password}`).toString("base64")]] : [])].map(([name,value]) => ({ name,value })), queryString: [...new URL(r.url).searchParams].map(([name,value]) => ({ name,value })), headersSize: -1, bodySize: r.body !== undefined ? Buffer.byteLength(r.body) : -1,
    ...(r.body !== undefined ? { postData: { mimeType: r.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? "application/octet-stream", text: r.body } } : r.form.length ? { postData: { mimeType: "multipart/form-data", params: r.form.map(f => ({ name: f.name, value: f.file ? "" : f.value, ...(f.file ? { fileName: f.filename || f.value } : {}), ...(f.contentType ? { contentType: f.contentType } : {}) })) } } : {}), ...(r.bodyFile ? { comment: "Body file reference (contents not loaded): " + r.bodyFile } : {})
  }, response: { status: 0, statusText: "Not executed", httpVersion: "HTTP/1.1", cookies: [], headers: [], content: { size: 0, mimeType: "application/octet-stream" }, redirectURL: "", headersSize: -1, bodySize: -1 }, cache: {}, timings: { send: 0, wait: 0, receive: 0 } })) } }, null, 2) + "\n";
}
