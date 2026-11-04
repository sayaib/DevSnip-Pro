import { ToolInputError } from "../types";
import { analyzeApiResponse } from "./api-response-analysis";
import { ApiEnvelope, ApiInspectOptions, parseApiTransport } from "./api-response-parser";
import { ApiField, apiFields, apiSecretHeader, apiSecretKey, parseApiJson, redactApiJson } from "./api-response-json";
export type { ApiInspectOptions, ApiDiagnostic } from "./api-response-parser";

export interface ApiResponseReport extends ApiEnvelope {
  body: unknown;
  isJson: boolean;
  bytes: number;
  insights: string[];
  fields: ApiField[];
  format: "json" | "ndjson" | "sse" | "xml" | "html" | "form" | "text" | "empty" | "binary";
  structured: boolean;
  truncatedFields: boolean;
  cache: Array<[string,string,string]>;
  rateLimits: Array<[string,string]>;
  links: Array<{ relation: string; url: string }>;
  cookies: Array<{ name: string; attributes: string; issues: string[] }>;
}

export function redactApiUrl(value: string): string {
  try {
    const absolute = /^[a-z][\w+.-]*:/i.test(value), url = new URL(value, "https://redaction.invalid");
    const pairs = [...url.searchParams];
    if (!pairs.some(([k]) => apiSecretKey(k)) && !url.username && !url.password) return value;
    url.username = ""; url.password = ""; url.search = "";
    for (const [k,v] of pairs) url.searchParams.append(k, apiSecretKey(k) ? "REDACTED" : v);
    return absolute ? url.toString() : url.pathname + url.search + url.hash;
  } catch { return "REDACTED"; }
}

/** A safely shareable capture; no raw headers/chain/HAR container remain attached. */
export function redactApiEnvelope(envelope: ApiEnvelope, format: ApiInspectOptions["format"] = "auto"): ApiEnvelope {
  const result: ApiEnvelope = { ...envelope, diagnostics: [...envelope.diagnostics], chain: envelope.chain.map(block => ({ ...block, headers: block.headers.map(([k,v]) => [k, v]) })), headers: envelope.headers.map(([k,v]) => [k,v]) };
  const redactHeader = ([name,value]: [string,string]): [string,string] => {
    if (/^set-cookie$/i.test(name)) { const eq = value.indexOf("="), semi = value.indexOf(";",eq); return [name, eq > 0 ? value.slice(0,eq + 1) + "REDACTED" + (semi >= 0 ? value.slice(semi) : "") : "REDACTED"]; }
    if (apiSecretHeader(name) || apiSecretKey(name)) return [name,"REDACTED"];
    if (/^(location|content-location)$/i.test(name)) return [name,redactApiUrl(value)];
    if (/^link$/i.test(name)) return [name,value.replace(/<([^>]+)>/g, (_,url: string) => `<${redactApiUrl(url)}>` )];
    return [name,value];
  };
  result.headers = result.headers.map(redactHeader);
  for (const block of result.chain) block.headers = block.headers.map(redactHeader);
  if (result.url) result.url = redactApiUrl(result.url);
  const scrub = (source: string) => { try { parseApiJson(source); return redactApiJson(source); } catch { return '"REDACTED"'; } };
  const ct = result.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? "";
  if (result.encoding === "base64") { result.bodyText = "REDACTED"; delete result.encoding; delete result.capturedBytes; }
  else if (format === "ndjson" || /ndjson|jsonl/i.test(ct)) result.bodyText = result.bodyText.split(/\r?\n/).map(line => line.trim() ? scrub(line) : line).join("\n");
  else if (format === "sse" || /text\/event-stream/i.test(ct)) result.bodyText = result.bodyText.replace(/^\uFEFF/,"").split(/\r?\n/).map(line => /^data:/.test(line) ? `data: ${scrub(line.slice(5).trimStart())}` : /^id:/.test(line) ? "id: REDACTED" : line.startsWith(":") ? ": REDACTED" : line).join("\n");
  else if (/x-www-form-urlencoded/i.test(ct)) result.bodyText = new URLSearchParams([...new URLSearchParams(result.bodyText)].map(([k,v]) => [k,apiSecretKey(k) ? "REDACTED" : v])).toString();
  else if (result.bodyText.trim()) result.bodyText = scrub(result.bodyText);
  return result;
}

export function inspectApiResponse(raw: string, options: ApiInspectOptions & { redact?: boolean } = {}): ApiResponseReport {
  if (options.format && !["auto","json","ndjson","sse","text"].includes(options.format)) throw new ToolInputError("Choose a supported body format.");
  let envelope = parseApiTransport(raw, options);
  if (options.redact) envelope = redactApiEnvelope(envelope, options.format);
  const r: ApiResponseReport = { ...envelope, body: envelope.bodyText, isJson: false, bytes: envelope.capturedBytes ?? Buffer.byteLength(envelope.bodyText), insights: [], fields: [], format: "text", structured: false, truncatedFields: false, cache: [], rateLimits: [], links: [], cookies: [] };
  const note = (severity: "info" | "warning" | "error", category: string, message: string) => r.diagnostics.push({ severity,category,message });
  const ct = r.headers.find(([k]) => /^content-type$/i.test(k))?.[1] ?? "";
  const format = options.format ?? "auto";
  const json = (source: string): unknown => { const parsed = parseApiJson(source); for (const text of parsed.notes) note("warning","JSON",text); return parsed.value; };
  if (r.encoding === "base64") r.format = "binary";
  else if (!r.bodyText.trim()) r.format = "empty";
  else if (format === "ndjson" || format === "auto" && /ndjson|jsonl/i.test(ct)) {
    const records: unknown[] = [], lines = r.bodyText.split(/\r?\n/); let invalid = 0;
    if (lines.length > 10000) throw new ToolInputError("NDJSON exceeds 10,000 lines.");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try { records.push(json(lines[i])); } catch (error) { if (error instanceof ToolInputError) throw error; invalid++; if (invalid <= 20) note("error","NDJSON",`Line ${i + 1} is not valid JSON.`); }
    }
    if (invalid > 20) note("error","NDJSON",`${invalid} invalid NDJSON records in total; only the first 20 are listed.`);
    r.body = records; r.structured = true; r.format = "ndjson";
    note("info","Streaming",`${records.length} valid NDJSON records were captured. This inspects a snapshot, not a live stream.`);
  } else if (format === "sse" || format === "auto" && /text\/event-stream/i.test(ct)) {
    const events: Array<{ event: string; id?: string; data: string; retry?: number }> = [];
    let data: string[] = [], event = "", id: string | undefined, retry: number | undefined;
    const lines = r.bodyText.replace(/^\uFEFF/,"").replace(/\r\n|\r/g,"\n").split("\n");
    if (lines.length > 10000) throw new ToolInputError("SSE exceeds 10,000 lines.");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line && i < lines.length - 1) {
        if (data.length) events.push({ event: event || "message", ...(id !== undefined ? {id} : {}), data: data.join("\n"), ...(retry !== undefined ? {retry} : {}) });
        data = []; event = ""; continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":"), field = colon < 0 ? line : line.slice(0,colon), value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      else if (field === "event") event = value;
      else if (field === "id" && !value.includes("\0")) id = value;
      else if (field === "retry" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) retry = Number(value);
    }
    if (data.length) note("info","Streaming","An unfinished SSE event was retained in the source but not dispatched: a blank line is required to complete an event.");
    r.body = events; r.structured = true; r.format = "sse";
    note("info","Streaming",`${events.length} complete server-sent events were captured. No connection is opened.`);
  } else if (format !== "text") {
    try { r.body = json(r.bodyText.replace(/^\uFEFF/,"")); r.isJson = true; r.structured = true; r.format = "json"; }
    catch (error) {
      if (error instanceof ToolInputError) throw error;
      if (format === "json" || /json/i.test(ct) || /^\s*[\[{]/.test(r.bodyText)) {
        const position = /position (\d+)/.exec(error instanceof Error ? error.message : "");
        const prefix = position ? r.bodyText.slice(0,Number(position[1])) : "";
        const where = position ? ` near line ${prefix.split("\n").length}, column ${(prefix.length - prefix.lastIndexOf("\n"))}` : "";
        note("error","JSON",`Invalid JSON${where}. The original body text is retained; check quoting, commas and truncation.`);
      }
      if (format === "auto") {
        if (/html/i.test(ct) || /^\s*<!doctype html|^\s*<html[\s>]/i.test(r.bodyText)) r.format = "html";
        else if (/xml/i.test(ct) || /^\s*<\?xml/.test(r.bodyText)) r.format = "xml";
        else if (/x-www-form-urlencoded/i.test(ct)) { r.format = "form"; r.body = [...new URLSearchParams(r.bodyText)]; r.structured = true; }
      }
    }
  }
  if (r.structured) {
    const fields = apiFields(r.body, options.maxFields ?? 200); r.fields = fields.fields; r.truncatedFields = fields.truncated;
    if (fields.truncated) note("info","Fields","Field exploration was truncated by field, path, depth or 50-item array sampling limits. The source body is retained.");
  }
  analyzeApiResponse(r, options.now ?? new Date());
  const unique = new Map(r.diagnostics.map(d => [`${d.severity}:${d.category}:${d.message}`, d]));
  const priority = {error:0,warning:1,info:2};
  r.diagnostics = [...unique.values()].sort((a,b) => priority[a.severity] - priority[b.severity]).slice(0,200); r.insights = r.diagnostics.map(d => d.message);
  return r;
}
