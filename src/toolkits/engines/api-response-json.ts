import { ToolInputError } from "../types";

export const API_MAX_INPUT = 2 * 1024 * 1024;
export const API_MAX_DEPTH = 64;
export const API_MAX_NODES = 50000;
export const API_MAX_FIELDS = 1000;
export const apiSecretKey = (key: string): boolean => /(?:password|passwd|secret|token|api[-_]?key|authorization|session|credential)/i.test(key);
export const apiSecretHeader = (name: string): boolean => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i.test(name);
export const pointerKey = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");
export const valueType = (value: unknown): string => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export function checkApiSize(input: string): void {
  if (input.length > API_MAX_INPUT || Buffer.byteLength(input) > API_MAX_INPUT) throw new ToolInputError("Response input exceeds 2 MiB. Inspect a smaller response or HAR excerpt.");
}

/** Validate then inspect bounded JSON source for precision and duplicate-key diagnostics. */
export function parseApiJson(source: string): { value: unknown; notes: string[] } {
  checkApiSize(source);
  const value = JSON.parse(source);
  let depth = 0, nodes = 0, unsafeNumber = false, duplicate = false;
  const objects: Array<Set<string> | undefined> = [];
  const tokens = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\[\]{}:,]|true|false|null/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    const token = match[0];
    if (++nodes > API_MAX_NODES) throw new ToolInputError("JSON exceeds the 50,000-token inspection limit.");
    if (token === "{" || token === "[") {
      if (++depth > API_MAX_DEPTH) throw new ToolInputError("JSON nesting exceeds 64 levels.");
      objects.push(token === "{" ? new Set() : undefined);
    } else if (token === "}" || token === "]") { depth--; objects.pop(); }
    else if (token.startsWith('"')) {
      let next = tokens.lastIndex;
      while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] === ":" && objects[objects.length - 1]) {
        const key = JSON.parse(token), keys = objects[objects.length - 1]!;
        if (keys.has(key)) duplicate = true;
        keys.add(key);
      }
    } else if (/^-?\d/.test(token)) {
      const n = Number(token);
      if (!Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n)) unsafeNumber = true;
    }
  }
  const notes: string[] = [];
  if (unsafeNumber) notes.push("JSON contains numbers outside JavaScript's safe numeric range. Source text is retained; parsed values, comparisons and inferred types may lose precision. Prefer string IDs for large integers.");
  if (duplicate) notes.push("JSON contains duplicate object keys. Parsed views keep the last value; the source body retains all keys.");
  return { value, notes };
}

/** Pretty-print without parsing numbers or discarding duplicate keys. */
export function formatApiJson(source: string, compact = false): string {
  let result = "", quoted = false, escaped = false, depth = 0;
  const newline = () => { if (!compact) result += "\n" + "  ".repeat(Math.max(0, depth)); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) { result += c; if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; result += c; }
    else if (/\s/.test(c)) continue;
    else if (c === "{" || c === "[") {
      result += c; depth++;
      let next = i + 1; while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] !== "}" && source[next] !== "]") newline();
    } else if (c === "}" || c === "]") {
      depth--; let previous = i - 1; while (previous >= 0 && /\s/.test(source[previous])) previous--;
      if (source[previous] !== "{" && source[previous] !== "[") newline(); result += c;
    } else if (c === ",") { result += c; newline(); }
    else if (c === ":") result += compact ? ":" : ": ";
    else result += c;
  }
  return result;
}

export function apiJsonPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  if (!pointer.startsWith("/")) throw new ToolInputError("Use a JSON Pointer beginning with / (for example /data/0/id); leave empty for the whole body.");
  let result = value;
  for (const raw of pointer.slice(1).split("/")) {
    if (/~(?![01])/.test(raw)) throw new ToolInputError("Invalid JSON Pointer escape. Use ~0 for ~ and ~1 for /.");
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(result) && !/^(0|[1-9]\d*)$/.test(key)) throw new ToolInputError("Array JSON Pointer segments must be nonnegative integer indices.");
    if (!result || typeof result !== "object" || !Object.prototype.hasOwnProperty.call(result, key)) throw new ToolInputError(`JSON Pointer does not exist: ${pointer}`);
    result = (result as Record<string, unknown>)[key];
  }
  return result;
}

/** Source-range redaction retains non-secret JSON whitespace, duplicate keys and large integers. */
export function redactApiJson(source: string): string {
  const strings = /"(?:\\.|[^"\\])*"/g;
  let result = "", offset = 0, match: RegExpExecArray | null;
  while ((match = strings.exec(source))) {
    let colon = strings.lastIndex;
    while (colon < source.length && /\s/.test(source[colon])) colon++;
    if (source[colon] !== ":" || !apiSecretKey(JSON.parse(match[0]))) continue;
    let start = colon + 1; while (start < source.length && /\s/.test(source[start])) start++;
    let end = start, depth = 0, quoted = false;
    for (; end < source.length; end++) {
      const c = source[end];
      if (quoted) { if (c === "\\") end++; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") { if (!depth) break; depth--; }
      else if (!depth && (c === "," || /\s/.test(c))) break;
    }
    result += source.slice(offset, start) + '"REDACTED"'; offset = end; strings.lastIndex = end;
  }
  return result + source.slice(offset);
}

export interface ApiField { path: string; pointer: string; type: string; example: string; sampled?: boolean }
export function apiFields(value: unknown, maxFields = 200): { fields: ApiField[]; truncated: boolean } {
  if (!Number.isInteger(maxFields) || maxFields < 1 || maxFields > API_MAX_FIELDS) throw new ToolInputError("Field limit must be between 1 and 1000.");
  const fields: ApiField[] = [];
  const stack = [{ value, path: "$", pointer: "", depth: 0 }];
  let visited = 0, truncated = false;
  while (stack.length) {
    if (fields.length >= maxFields || ++visited > API_MAX_NODES) { truncated = true; break; }
    const node = stack.pop()!, type = valueType(node.value);
    const example = type === "object" ? `{${Object.keys(node.value as object).length} fields}` : type === "array" ? `[${(node.value as unknown[]).length} items]` : JSON.stringify(node.value)?.slice(0, 120) ?? "";
    fields.push({ path: node.path, pointer: node.pointer, type, example });
    if (node.depth >= API_MAX_DEPTH) { truncated = true; continue; }
    const entries: Array<[string,unknown]> = Array.isArray(node.value) ? node.value.slice(0, 50).map((v,i) => [String(i),v]) : node.value && typeof node.value === "object" ? Object.entries(node.value).slice(0, API_MAX_FIELDS) : [];
    if (Array.isArray(node.value) && node.value.length > 50 || type === "object" && Object.keys(node.value as object).length > API_MAX_FIELDS) truncated = true;
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, child] = entries[i];
      if (key.length > 512 || node.pointer.length + key.length > 2048) { truncated = true; continue; }
      stack.push({ value: child, path: Array.isArray(node.value) ? `${node.path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${node.path}.${key}` : `${node.path}[${JSON.stringify(key)}]`, pointer: `${node.pointer}/${pointerKey(key)}`, depth: node.depth + 1 });
    }
  }
  return { fields, truncated };
}
