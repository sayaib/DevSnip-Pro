import YAML from "yaml";
import { ToolInputError } from "../types";
import { recordShape, toJsonSchema } from "./data-types";

/**
 * OpenAPI (3.x and Swagger 2.0) and GraphQL helpers: list and lint
 * endpoints, generate TypeScript types and a typed fetch client, example
 * requests, OpenAPI from samples, and GraphQL formatting / SDL types.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export function parseSpec(text: string): Obj {
  const t = text.trim();
  if (!t) throw new ToolInputError("Paste an OpenAPI / Swagger document (JSON or YAML).");
  let doc: unknown;
  try {
    doc = t.startsWith("{") ? JSON.parse(t) : YAML.parse(t, { maxAliasCount: 1000 });
  } catch (error) {
    throw new ToolInputError(`The document does not parse: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  if (!isObj(doc)) throw new ToolInputError("The document must be an object.");
  if (!doc.openapi && !doc.swagger) throw new ToolInputError("No \"openapi\" or \"swagger\" version field - is this an OpenAPI document?");
  return doc;
}

export function specSchemas(doc: Obj): Obj {
  return (isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : isObj(doc.definitions) ? doc.definitions : {}) as Obj;
}

function resolveRef(doc: Obj, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const part of ref.slice(2).split("/").map(p => p.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!isObj(node)) return undefined;
    node = node[part];
  }
  return node;
}

const deref = (doc: Obj, v: unknown): Obj => (isObj(v) && typeof v.$ref === "string" ? (isObj(resolveRef(doc, v.$ref)) ? resolveRef(doc, v.$ref) as Obj : {}) : isObj(v) ? v : {});

export interface Operation {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  params: Array<{ name: string; in: string; required: boolean; schema: Obj }>;
  body?: { contentType: string; schema: Obj; required: boolean };
  responses: Array<{ status: string; schema?: Obj; description: string }>;
  secured: boolean;
  deprecated: boolean;
}

function operationName(method: string, path: string): string {
  const words = path.split("/").filter(Boolean).map(seg => seg.startsWith("{") ? `By ${seg.slice(1, -1)}` : seg);
  const camel = words.join(" ").replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""));
  return method + camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function operations(doc: Obj): Operation[] {
  const out: Operation[] = [];
  const paths = isObj(doc.paths) ? doc.paths : {};
  const swagger2 = !!doc.swagger;
  const globalSecurity = Array.isArray(doc.security) && doc.security.length > 0;
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = deref(doc, rawItem);
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      if (!isObj(item[method])) continue;
      const op = item[method] as Obj;
      const params: Operation["params"] = [];
      let body: Operation["body"];
      for (const rawParam of [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const p = deref(doc, rawParam);
        if (swagger2 && p.in === "body") { body = { contentType: "application/json", schema: deref(doc, p.schema).$ref ? deref(doc, p.schema) : (isObj(p.schema) ? p.schema : {}), required: !!p.required }; continue; }
        if (swagger2 && p.in === "formData") continue;
        const existing = params.findIndex(x => x.name === p.name && x.in === p.in);
        const entry = { name: String(p.name), in: String(p.in), required: !!p.required || p.in === "path", schema: isObj(p.schema) ? p.schema : swagger2 ? { type: p.type, items: p.items, enum: p.enum, format: p.format } as Obj : {} };
        if (existing >= 0) params[existing] = entry; else params.push(entry);
      }
      if (isObj(op.requestBody)) {
        const rb = deref(doc, op.requestBody);
        const content = isObj(rb.content) ? rb.content : {};
        const type = Object.keys(content).find(k => /json/.test(k)) ?? Object.keys(content)[0];
        if (type) body = { contentType: type, schema: isObj((content[type] as Obj)?.schema) ? (content[type] as Obj).schema as Obj : {}, required: !!rb.required };
      }
      const responses: Operation["responses"] = [];
      for (const [status, rawRes] of Object.entries(isObj(op.responses) ? op.responses : {})) {
        const r = deref(doc, rawRes);
        let schema: Obj | undefined;
        if (swagger2 && isObj(r.schema)) schema = r.schema;
        if (isObj(r.content)) {
          const type = Object.keys(r.content).find(k => /json/.test(k)) ?? Object.keys(r.content)[0];
          const s = type ? (r.content[type] as Obj)?.schema : undefined;
          if (isObj(s)) schema = s;
        }
        responses.push({ status, schema, description: String(r.description ?? "") });
      }
      out.push({
        method: method.toUpperCase(),
        path,
        operationId: typeof op.operationId === "string" ? op.operationId : "",
        summary: String(op.summary ?? op.description ?? "").split("\n")[0],
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
        params,
        body,
        responses,
        secured: Array.isArray(op.security) ? op.security.length > 0 : globalSecurity,
        deprecated: op.deprecated === true
      });
    }
  }
  return out;
}

export function lintSpec(doc: Obj, ops: Operation[]): Array<{ severity: "error" | "warning" | "info"; message: string }> {
  const issues: Array<{ severity: "error" | "warning" | "info"; message: string }> = [];
  const add = (severity: "error" | "warning" | "info", message: string) => issues.push({ severity, message });
  const info = isObj(doc.info) ? doc.info : {};
  if (!info.title) add("error", "info.title is required.");
  if (!info.version) add("error", "info.version is required.");
  if (doc.swagger) add("info", "This is Swagger 2.0. Most tooling now targets OpenAPI 3.x; convert with swagger2openapi or the Swagger Editor.");
  if (doc.openapi && !(Array.isArray(doc.servers) && doc.servers.length)) add("warning", "No servers: clients and docs default to \"/\".");
  const ids = new Map<string, number>();
  for (const op of ops) {
    const where = `${op.method} ${op.path}`;
    if (!op.operationId) add("warning", `${where}: no operationId (code generators invent names like ${operationName(op.method.toLowerCase(), op.path)}).`);
    else ids.set(op.operationId, (ids.get(op.operationId) ?? 0) + 1);
    const declared = new Set(op.params.filter(p => p.in === "path").map(p => p.name));
    for (const m of op.path.matchAll(/\{([^}]+)\}/g)) if (!declared.has(m[1])) add("error", `${where}: path parameter {${m[1]}} is not declared.`);
    for (const name of declared) if (!op.path.includes(`{${name}}`)) add("error", `${where}: declares path parameter "${name}" that is not in the path.`);
    if (!op.responses.length) add("error", `${where}: no responses.`);
    else if (!op.responses.some(r => /^2|default/.test(r.status))) add("warning", `${where}: no success (2xx) response.`);
    if (["GET", "HEAD", "DELETE"].includes(op.method) && op.body) add("warning", `${where}: a request body on ${op.method} is ignored by many clients and proxies.`);
    if (op.method === "POST" && !op.body && !op.params.length) add("info", `${where}: POST without a body or parameters.`);
  }
  for (const [id, n] of ids) if (n > 1) add("error", `operationId "${id}" is used ${n} times; it must be unique.`);
  const text = JSON.stringify(doc);
  for (const m of new Set([...text.matchAll(/"\$ref":"([^"]+)"/g)].map(x => x[1]))) if (m.startsWith("#/") && resolveRef(doc, m) === undefined) add("error", `Unresolved $ref ${m}.`);
  const schemes = isObj(doc.components) && isObj(doc.components.securitySchemes) ? Object.keys(doc.components.securitySchemes) : isObj(doc.securityDefinitions) ? Object.keys(doc.securityDefinitions) : [];
  if (!schemes.length) add("info", "No security schemes defined; document how clients authenticate.");
  return issues;
}

// ---- JSON Schema → TypeScript ------------------------------------------

const ident = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
export const typeName = (s: string) => {
  const n = s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, c => c.toUpperCase());
  return /^\d/.test(n) ? `T${n}` : n || "Unnamed";
};

export function schemaToTs(schema: unknown, indent = ""): string {
  if (!isObj(schema)) return "unknown";
  if (typeof schema.$ref === "string") return typeName(schema.$ref.split("/").pop()!);
  const nullable = schema.nullable === true;
  const wrap = (t: string) => (nullable ? `${t} | null` : t);
  if (Array.isArray(schema.enum)) return wrap(schema.enum.map(v => JSON.stringify(v)).join(" | "));
  if ("const" in schema) return JSON.stringify(schema.const);
  for (const key of ["oneOf", "anyOf"]) if (Array.isArray(schema[key])) return wrap((schema[key] as unknown[]).map(s => schemaToTs(s, indent)).join(" | "));
  if (Array.isArray(schema.allOf)) return wrap((schema.allOf as unknown[]).map(s => schemaToTs(s, indent)).join(" & "));
  const type = schema.type;
  if (Array.isArray(type)) return type.map(t => schemaToTs({ ...schema, type: t }, indent)).join(" | ");
  switch (type) {
    case "string": return wrap(schema.format === "binary" ? "Blob" : "string");
    case "integer": case "number": return wrap("number");
    case "boolean": return wrap("boolean");
    case "null": return "null";
    case "array": {
      const inner = schemaToTs(schema.items, indent);
      return wrap(/[|&]/.test(inner) ? `Array<${inner}>` : `${inner}[]`);
    }
  }
  if (type === "object" || isObj(schema.properties) || schema.additionalProperties) {
    const props = isObj(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    const lines = Object.entries(props).map(([k, v]) => {
      const doc = isObj(v) && typeof v.description === "string" ? `${indent}  /** ${v.description.replace(/\*\//g, "*\\/").split("\n")[0]} */\n` : "";
      return `${doc}${indent}  ${ident(k)}${required.has(k) ? "" : "?"}: ${schemaToTs(v, indent + "  ")};`;
    });
    if (schema.additionalProperties && !Object.keys(props).length) return wrap(`Record<string, ${schema.additionalProperties === true ? "unknown" : schemaToTs(schema.additionalProperties, indent)}>`);
    if (schema.additionalProperties) lines.push(`${indent}  [key: string]: unknown;`);
    return wrap(lines.length ? `{\n${lines.join("\n")}\n${indent}}` : "Record<string, unknown>");
  }
  return "unknown";
}

export function specTypes(doc: Obj): string {
  const schemas = specSchemas(doc);
  const blocks = Object.entries(schemas).map(([name, s]) => {
    const ts = schemaToTs(s);
    const desc = isObj(s) && typeof s.description === "string" ? `/** ${s.description.split("\n")[0].replace(/\*\//g, "")} */\n` : "";
    return ts.startsWith("{") ? `${desc}export interface ${typeName(name)} ${ts}` : `${desc}export type ${typeName(name)} = ${ts};`;
  });
  if (!blocks.length) throw new ToolInputError("The document has no components.schemas (or definitions) to convert.");
  return blocks.join("\n\n") + "\n";
}

export function specClient(doc: Obj, ops: Operation[]): string {
  const servers = Array.isArray(doc.servers) && isObj(doc.servers[0]) ? String(doc.servers[0].url) : doc.host ? `https://${doc.host}${doc.basePath ?? ""}` : "";
  const fns = ops.map(op => {
    const name = op.operationId ? op.operationId.replace(/[^A-Za-z0-9_$]/g, "_") : operationName(op.method.toLowerCase(), op.path);
    const pathParams = op.params.filter(p => p.in === "path");
    const query = op.params.filter(p => p.in === "query");
    const args: string[] = pathParams.map(p => `${p.name.replace(/[^A-Za-z0-9_$]/g, "_")}: ${schemaToTs(p.schema)}`);
    if (query.length) args.push(`query${query.every(q => !q.required) ? "?" : ""}: { ${query.map(q => `${ident(q.name)}${q.required ? "" : "?"}: ${schemaToTs(q.schema)}`).join("; ")} }`);
    if (op.body) args.push(`body${op.body.required ? "" : "?"}: ${schemaToTs(op.body.schema)}`);
    args.push("init?: RequestInit");
    const ok = op.responses.find(r => /^2/.test(r.status)) ?? op.responses.find(r => r.status === "default");
    const ret = ok?.schema ? schemaToTs(ok.schema, "  ") : ok && ok.status === "204" ? "void" : "unknown";
    const urlPath = op.path.replace(/\{([^}]+)\}/g, (_, p: string) => `\${encodeURIComponent(String(${p.replace(/[^A-Za-z0-9_$]/g, "_")}))}`);
    const comment = `/** ${op.method} ${op.path}${op.summary ? ` - ${op.summary.replace(/\*\//g, "")}` : ""}${op.deprecated ? " (deprecated)" : ""} */`;
    return `${comment}\nexport function ${name}(${args.join(", ")}): Promise<${ret}> {\n  return request<${ret}>(${JSON.stringify(op.method)}, \`${urlPath}\`${query.length ? ", query" : ", undefined"}${op.body ? ", body" : ", undefined"}, init);\n}`;
  });
  return `${specTypesSafe(doc)}// ---- Client -------------------------------------------------------------\n\nexport const BASE_URL = ${JSON.stringify(servers)};\n\nexport class ApiError extends Error {\n  constructor(public status: number, public body: unknown) {\n    super(\`HTTP \${status}\`);\n  }\n}\n\nasync function request<T>(method: string, path: string, query?: Record<string, unknown>, body?: unknown, init?: RequestInit): Promise<T> {\n  const url = new URL(BASE_URL + path, typeof window === "undefined" ? "http://localhost" : window.location.origin);\n  for (const [key, value] of Object.entries(query ?? {})) {\n    if (value === undefined || value === null) continue;\n    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));\n  }\n  const response = await fetch(url, {\n    ...init,\n    method,\n    headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },\n    body: body !== undefined ? JSON.stringify(body) : undefined,\n  });\n  const text = await response.text();\n  const data = text ? (response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) : undefined;\n  if (!response.ok) throw new ApiError(response.status, data);\n  return data as T;\n}\n\n${fns.join("\n\n")}\n`;
}

function specTypesSafe(doc: Obj): string {
  try { return specTypes(doc) + "\n"; } catch { return ""; }
}

export function exampleFromSchema(doc: Obj, schema: unknown, depth = 0): unknown {
  if (depth > 6 || !isObj(schema)) return null;
  if (typeof schema.$ref === "string") return exampleFromSchema(doc, resolveRef(doc, schema.$ref), depth + 1);
  if ("example" in schema) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const key of ["oneOf", "anyOf"]) if (Array.isArray(schema[key])) return exampleFromSchema(doc, (schema[key] as unknown[])[0], depth + 1);
  if (Array.isArray(schema.allOf)) return Object.assign({}, ...(schema.allOf as unknown[]).map(s => exampleFromSchema(doc, s, depth + 1)).filter(isObj));
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== "null") : schema.type;
  switch (type) {
    case "string": return ({ "date-time": "2026-01-15T09:30:00Z", date: "2026-01-15", email: "user@example.com", uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6", uri: "https://example.com", url: "https://example.com", binary: "<file>" } as Record<string, string>)[String(schema.format)] ?? "string";
    case "integer": return 0;
    case "number": return 0.0;
    case "boolean": return true;
    case "array": return [exampleFromSchema(doc, schema.items, depth + 1)];
  }
  if (isObj(schema.properties)) return Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, exampleFromSchema(doc, v, depth + 1)]));
  return {};
}

export function curlExamples(doc: Obj, ops: Operation[]): string {
  const servers = Array.isArray(doc.servers) && isObj(doc.servers[0]) ? String(doc.servers[0].url) : doc.host ? `https://${doc.host}${doc.basePath ?? ""}` : "https://api.example.com";
  const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return ops.map(op => {
    const path = op.path.replace(/\{([^}]+)\}/g, (_, p: string) => `{${p}}`);
    const q = op.params.filter(p => p.in === "query" && p.required).map(p => `${p.name}=${encodeURIComponent(String(exampleFromSchema(doc, p.schema) ?? ""))}`);
    const headerParams = op.params.filter(p => p.in === "header");
    const lines = [`# ${op.method} ${op.path}${op.summary ? ` - ${op.summary}` : ""}`, `curl -X ${op.method} ${shq(`${servers}${path}${q.length ? `?${q.join("&")}` : ""}`)}`];
    lines.push(`  -H 'Accept: application/json'`);
    if (op.secured) lines.push(`  -H "Authorization: Bearer $TOKEN"`);
    for (const h of headerParams) lines.push(`  -H ${shq(`${h.name}: ${String(exampleFromSchema(doc, h.schema) ?? "")}`)}`);
    if (op.body) lines.push(`  -H ${shq(`Content-Type: ${op.body.contentType}`)}`, `  --data-raw ${shq(JSON.stringify(exampleFromSchema(doc, op.body.schema), null, 2))}`);
    return lines.join(" \\\n");
  }).join("\n\n") + "\n";
}

export function openApiFromSample(method: string, path: string, requestJson: string, responseJson: string, status: string, title: string): string {
  const parse = (t: string, what: string) => { try { return JSON.parse(t); } catch (e) { throw new ToolInputError(`${what} is not valid JSON: ${(e as Error).message}`); } };
  const clean = (s: Record<string, unknown>) => { const { $schema, title: _t, ...rest } = s; void $schema; void _t; return rest; };
  const pathParams = [...path.matchAll(/\{([^}]+)\}|:(\w+)/g)].map(m => m[1] ?? m[2]);
  const normPath = path.replace(/:(\w+)/g, "{$1}");
  const op: Obj = {
    operationId: operationName(method.toLowerCase(), normPath),
    summary: `${method.toUpperCase()} ${normPath}`,
    ...(pathParams.length ? { parameters: pathParams.map(p => ({ name: p, in: "path", required: true, schema: { type: /id$/i.test(p) ? "string" : "string" } })) } : {}),
    ...(requestJson.trim() ? { requestBody: { required: true, content: { "application/json": { schema: clean(toJsonSchema(recordShape(parse(requestJson, "The request")), "Request")), example: parse(requestJson, "The request") } } } } : {}),
    responses: {
      [status || "200"]: { description: "Success", ...(responseJson.trim() ? { content: { "application/json": { schema: clean(toJsonSchema(Array.isArray(parse(responseJson, "The response")) ? recordShape(parse(responseJson, "The response")) : recordShape(parse(responseJson, "The response")), "Response")), example: parse(responseJson, "The response") } } } : {}) }
    }
  };
  if (responseJson.trim() && Array.isArray(parse(responseJson, "The response"))) {
    const content = ((op.responses as Obj)[status || "200"] as Obj).content as Obj;
    const json = content["application/json"] as Obj;
    json.schema = { type: "array", items: json.schema };
  }
  const doc = { openapi: "3.1.0", info: { title: title || "API", version: "1.0.0" }, servers: [{ url: "https://api.example.com" }], paths: { [normPath]: { [method.toLowerCase()]: op } } };
  return YAML.stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

type GqlToken = { kind: "punct" | "name" | "string" | "number" | "comment" | "spread" | "var"; value: string };

export function tokenizeGraphql(src: string): GqlToken[] {
  const tokens: GqlToken[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[\s,﻿]/.test(ch)) { i++; continue; }
    if (ch === "#") { const end = src.indexOf("\n", i); const stop = end < 0 ? src.length : end; tokens.push({ kind: "comment", value: src.slice(i, stop).trimEnd() }); i = stop; continue; }
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      if (end < 0) throw new ToolInputError("Unterminated block string (\"\"\").");
      tokens.push({ kind: "string", value: src.slice(i, end + 3) }); i = end + 3; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') { if (src[j] === "\\") j++; if (src[j] === "\n") throw new ToolInputError("Unterminated string."); j++; }
      if (j >= src.length) throw new ToolInputError("Unterminated string.");
      tokens.push({ kind: "string", value: src.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (src.startsWith("...", i)) { tokens.push({ kind: "spread", value: "..." }); i += 3; continue; }
    if ("{}()[]:=@!|&".includes(ch)) { tokens.push({ kind: "punct", value: ch }); i++; continue; }
    if (ch === "$") { const m = /^\$[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i)); if (!m) throw new ToolInputError(`Invalid variable at position ${i}.`); tokens.push({ kind: "var", value: m[0] }); i += m[0].length; continue; }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i));
    if (name) { tokens.push({ kind: "name", value: name[0] }); i += name[0].length; continue; }
    const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (number) { tokens.push({ kind: "number", value: number[0] }); i += number[0].length; continue; }
    throw new ToolInputError(`Unexpected character "${ch}" at position ${i}.`);
  }
  let depth = 0;
  for (const t of tokens) {
    if (t.kind !== "punct") continue;
    if ("{([".includes(t.value)) depth++;
    if ("})]".includes(t.value)) depth--;
    if (depth < 0) throw new ToolInputError(`Unbalanced "${t.value}".`);
  }
  if (depth !== 0) throw new ToolInputError("Unbalanced braces or brackets - a { ( or [ is never closed.");
  return tokens;
}

export function formatGraphql(src: string): string {
  const tokens = tokenizeGraphql(src);
  const stack: Array<"sel" | "args" | "obj" | "list"> = [];
  let out = "";
  let indent = 0;
  const inline = () => stack.includes("args");
  const newline = () => { out = out.trimEnd() + "\n" + "  ".repeat(indent); };
  const atLineStart = () => /(^|\n) *$/.test(out);
  const put = (s: string, spaceBefore: boolean) => {
    if (spaceBefore && out && !atLineStart() && !/[\s([]$/.test(out) && !out.endsWith("@") && !out.endsWith("...")) out += " ";
    out += s;
  };
  const valueEnd = (t: GqlToken | undefined) => !!t && ((t.kind === "name" && t.value !== "on") || t.kind === "number" || t.kind === "string" || t.kind === "var" || (t.kind === "punct" && (t.value === ")" || t.value === "]" || t.value === "!" || t.value === "}")));
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const prev = tokens.slice(0, k).reverse().find(x => x.kind !== "comment");
    const next = tokens[k + 1];
    if (t.kind === "comment") { if (out && !atLineStart()) out += " "; out += t.value; newline(); continue; }
    if (!inline()) {
      if (t.kind === "punct" && t.value === "{") { put("{", true); stack.push("sel"); indent++; newline(); continue; }
      if (t.kind === "punct" && t.value === "}") {
        stack.pop(); indent = Math.max(0, indent - 1); newline(); out += "}";
        if (next && !(next.kind === "punct" && next.value === "}")) { newline(); if (indent === 0) out += "\n"; }
        continue;
      }
      if (t.kind === "punct" && t.value === "(") { put("(", false); stack.push("args"); continue; }
      if (indent > 0 && (t.kind === "name" || t.kind === "spread" || t.kind === "string") && prev && valueEnd(prev) && !(prev.kind === "punct" && prev.value === "}")) newline();
      put(t.value, !(t.kind === "punct" && [":", "!", "]", ")"].includes(t.value)) && !(prev?.kind === "punct" && prev.value === "@"));
      continue;
    }
    const ctx = stack[stack.length - 1];
    if (t.kind === "punct") {
      switch (t.value) {
        case "(": put("(", false); stack.push("args"); continue;
        case ")": stack.pop(); out = out.trimEnd().replace(/,$/, "") + ")"; continue;
        case "{": if (ctx === "list" && valueEnd(prev) && prev?.value !== "[") out = out.trimEnd() + ","; put("{", true); stack.push("obj"); continue;
        case "}": stack.pop(); out = out.trimEnd() + " }"; continue;
        case "[": if (ctx === "list" && valueEnd(prev)) out = out.trimEnd() + ","; put("[", true); stack.push("list"); continue;
        case "]": stack.pop(); out = out.trimEnd() + "]"; continue;
        case ":": out = out.trimEnd() + ":"; continue;
        case "!": out = out.trimEnd() + "!"; continue;
        default: put(t.value, true); continue;
      }
    }
    if ((ctx === "args" || ctx === "obj") && (t.kind === "name" || t.kind === "var") && next?.value === ":" && prev && !(prev.kind === "punct" && (prev.value === "(" || prev.value === "{"))) out = out.trimEnd() + ",";
    else if (ctx === "list" && prev && valueEnd(prev) && !(prev.kind === "punct" && prev.value === "[")) out = out.trimEnd() + ",";
    put(t.value, !(prev?.kind === "punct" && prev.value === "@"));
  }
  return out.trim().replace(/\n{3,}/g, "\n\n") + "\n";
}

export function minifyGraphql(src: string): string {
  const tokens = tokenizeGraphql(src).filter(t => t.kind !== "comment");
  let out = "";
  for (const t of tokens) {
    const word = t.kind !== "punct" && t.kind !== "spread";
    if (word && /[_0-9A-Za-z"$]$/.test(out)) out += " ";
    out += t.value;
  }
  return out;
}

export interface GqlOperation { type: string; name: string; variables: Array<{ name: string; type: string; defaultValue?: string }> }

export function graphqlOperations(src: string): { operations: GqlOperation[]; fragments: string[] } {
  const tokens = tokenizeGraphql(src).filter(t => t.kind !== "comment");
  const operations: GqlOperation[] = [];
  const fragments: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "punct" && t.value === "{") { if (depth === 0 && (i === 0 || tokens[i - 1].value === "}")) operations.push({ type: "query", name: "", variables: [] }); depth++; continue; }
    if (t.kind === "punct" && t.value === "}") { depth--; continue; }
    if (depth !== 0 || t.kind !== "name") continue;
    if (t.value === "fragment") { fragments.push(tokens[i + 1]?.value ?? "?"); continue; }
    if (!["query", "mutation", "subscription"].includes(t.value)) continue;
    const op: GqlOperation = { type: t.value, name: tokens[i + 1]?.kind === "name" ? tokens[i + 1].value : "", variables: [] };
    let j = i + 1 + (op.name ? 1 : 0);
    if (tokens[j]?.value === "(") {
      j++;
      while (j < tokens.length && tokens[j].value !== ")") {
        if (tokens[j].kind === "var") {
          const name = tokens[j].value.slice(1);
          j += 2; // $name :
          let type = "";
          while (j < tokens.length && !(tokens[j].kind === "var") && tokens[j].value !== ")" && tokens[j].value !== "=" && tokens[j].value !== "@") { type += tokens[j].value; j++; }
          let defaultValue: string | undefined;
          if (tokens[j]?.value === "=") { j++; defaultValue = tokens[j]?.value; j++; }
          op.variables.push({ name, type, defaultValue });
        } else j++;
      }
    }
    operations.push(op);
    i = j;
  }
  return { operations, fragments };
}

export function sampleForGqlType(type: string): unknown {
  const nonNull = type.endsWith("!");
  const base = type.replace(/!$/, "");
  if (base.startsWith("[")) return [];
  const value = ({ Int: 0, Float: 0, String: "", Boolean: false, ID: "" } as Record<string, unknown>)[base];
  return value !== undefined ? value : nonNull ? {} : null;
}

const GQL_SCALARS: Record<string, string> = { ID: "string", String: "string", Int: "number", Float: "number", Boolean: "boolean" };

/** SDL → TypeScript types (types, inputs, interfaces, enums, unions, scalars). */
export function sdlToTypeScript(sdl: string): string {
  const tokens = tokenizeGraphql(sdl).filter(t => t.kind !== "comment");
  const out: string[] = [];
  const scalars: string[] = [];
  let i = 0;
  const skipDirectives = () => {
    while (tokens[i]?.value === "@") {
      i += 2;
      if (tokens[i]?.value === "(") { let d = 0; do { if (tokens[i].value === "(") d++; if (tokens[i].value === ")") d--; i++; } while (d > 0 && i < tokens.length); }
    }
  };
  const readType = (): string => {
    if (tokens[i]?.value === "[") {
      i++;
      const inner = readType();
      i++; // ]
      let t = `Array<${inner}>`;
      if (tokens[i]?.value === "!") i++; else t = `${t} | null`;
      return t;
    }
    const name = tokens[i++].value;
    let t = GQL_SCALARS[name] ?? name;
    if (tokens[i]?.value === "!") i++; else t = `${t} | null`;
    return t;
  };
  let description = "";
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "string") { description = t.value.replace(/^"""|"""$|^"|"$/g, "").trim().split("\n")[0]; i++; continue; }
    const doc = description ? `/** ${description.replace(/\*\//g, "")} */\n` : "";
    description = "";
    if (t.value === "extend") { i++; continue; }
    if (t.value === "schema" || t.value === "directive") {
      while (i < tokens.length && tokens[i].value !== "{" && !(t.value === "directive" && tokens[i].value === "on")) i++;
      if (tokens[i]?.value === "{") { while (tokens[i] && tokens[i].value !== "}") i++; i++; }
      else { i++; while (tokens[i] && (tokens[i].value === "|" || (tokens[i].kind === "name" && /^[A-Z_]+$/.test(tokens[i].value)))) i++; }
      continue;
    }
    if (t.value === "scalar") { const name = tokens[i + 1].value; i += 2; skipDirectives(); scalars.push(name); out.push(`${doc}export type ${name} = unknown; // custom scalar - narrow this type`); continue; }
    if (t.value === "enum") {
      const name = tokens[i + 1].value; i += 2; skipDirectives();
      const values: string[] = [];
      if (tokens[i]?.value === "{") { i++; while (tokens[i] && tokens[i].value !== "}") { if (tokens[i].kind === "string") { i++; continue; } values.push(tokens[i].value); i++; skipDirectives(); } i++; }
      out.push(`${doc}export type ${name} = ${values.map(v => JSON.stringify(v)).join(" | ") || "never"};`);
      continue;
    }
    if (t.value === "union") {
      const name = tokens[i + 1].value; i += 2; skipDirectives();
      if (tokens[i]?.value === "=") i++;
      const members: string[] = [];
      while (tokens[i] && (tokens[i].value === "|" || (tokens[i].kind === "name" && !["type", "input", "enum", "union", "scalar", "interface", "extend", "schema", "directive"].includes(tokens[i].value)))) { if (tokens[i].value !== "|") members.push(tokens[i].value); i++; }
      out.push(`${doc}export type ${name} = ${members.join(" | ") || "never"};`);
      continue;
    }
    if (["type", "input", "interface"].includes(t.value)) {
      const name = tokens[i + 1].value; i += 2;
      const parents: string[] = [];
      if (tokens[i]?.value === "implements") { i++; while (tokens[i] && tokens[i].value !== "{" && tokens[i].value !== "@") { if (tokens[i].kind === "name") parents.push(tokens[i].value); i++; } }
      skipDirectives();
      const fields: string[] = [];
      if (tokens[i]?.value === "{") {
        i++;
        let fieldDoc = "";
        while (tokens[i] && tokens[i].value !== "}") {
          if (tokens[i].kind === "string") { fieldDoc = tokens[i].value.replace(/^"""|"""$|^"|"$/g, "").trim().split("\n")[0]; i++; continue; }
          const field = tokens[i++].value;
          let args = "";
          if (tokens[i]?.value === "(") { let d = 0; const start = i; do { if (tokens[i].value === "(") d++; if (tokens[i].value === ")") d--; i++; } while (d > 0 && i < tokens.length); args = tokens.slice(start + 1, i - 1).filter(x => x.kind === "name" && tokens[tokens.indexOf(x) + 1]?.value === ":").map(x => x.value).join(", "); }
          i++; // :
          const type = readType();
          if (tokens[i]?.value === "=") i += 2;
          skipDirectives();
          const optional = t.value === "input" && type.endsWith("| null");
          fields.push(`${fieldDoc ? `  /** ${fieldDoc.replace(/\*\//g, "")} */\n` : ""}  ${field}${optional ? "?" : ""}: ${type};${args ? ` // args: ${args}` : ""}`);
          fieldDoc = "";
        }
        i++;
      }
      const ext = parents.length ? ` extends ${parents.join(", ")}` : "";
      out.push(`${doc}export interface ${name}${ext} {\n${t.value === "type" ? `  __typename?: ${JSON.stringify(name)};\n` : ""}${fields.join("\n")}\n}`);
      continue;
    }
    i++;
  }
  if (!out.length) throw new ToolInputError("No type, input, enum, interface, union or scalar definitions found.");
  return out.join("\n\n") + "\n";
}
