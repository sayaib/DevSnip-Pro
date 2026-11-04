"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiAssertions = exports.apiReportMarkdown = exports.apiReportJson = exports.normalizedApiResponse = exports.inferApiTypes = exports.compareApiResponses = void 0;
const types_1 = require("../types");
const data_types_1 = require("./data-types");
const api_response_json_1 = require("./api-response-json");
const preview = (value) => { const type = (0, api_response_json_1.valueType)(value); return type === "object" ? "{object}" : type === "array" ? `[${value.length} items]` : JSON.stringify(value)?.slice(0, 160) ?? "(absent)"; };
function compareApiResponses(before, after, ignoreHeaders = ["date", "age", "server-timing"]) {
    if (ignoreHeaders.length > 50 || ignoreHeaders.some(h => !/^[!#$%&'*+.^_`|~\w-]+$/.test(h)))
        throw new types_1.ToolInputError("Ignore headers must be valid header names (at most 50).");
    const changes = [];
    let truncated = false;
    const add = (change) => { if (changes.length < 500)
        changes.push(change);
    else
        truncated = true; };
    if (before.status !== after.status)
        add({ kind: "changed", path: "status", before: String(before.status ?? "unknown"), after: String(after.status ?? "unknown") });
    const ignored = new Set(ignoreHeaders.map(h => h.toLowerCase()));
    const group = (r) => { const map = new Map(); for (const [k, v] of r.headers) {
        const key = k.toLowerCase();
        if (!ignored.has(key))
            map.set(key, [...(map.get(key) ?? []), v]);
    } return map; };
    const left = group(before), right = group(after);
    for (const key of new Set([...left.keys(), ...right.keys()])) {
        const a = left.get(key), b = right.get(key);
        if (JSON.stringify(a) !== JSON.stringify(b))
            add({ kind: a === undefined ? "added" : b === undefined ? "removed" : "changed", path: `headers/${(0, api_response_json_1.pointerKey)(key)}`, before: a?.join(" | ").slice(0, 200) ?? "(absent)", after: b?.join(" | ").slice(0, 200) ?? "(absent)" });
    }
    if (before.structured && after.structured) {
        const stack = [{ a: before.body, b: after.body, pointer: "body" }];
        let count = 0, bodyChanged = false;
        while (stack.length) {
            if (++count > 50000 || changes.length >= 500) {
                truncated = true;
                break;
            }
            const { a, b, pointer } = stack.pop(), type = (0, api_response_json_1.valueType)(a);
            if (type !== (0, api_response_json_1.valueType)(b)) {
                bodyChanged = true;
                add({ kind: "type", path: pointer, before: preview(a), after: preview(b) });
            }
            else if (a && typeof a === "object" && b && typeof b === "object") {
                const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
                for (const key of keys) {
                    const hasA = Object.prototype.hasOwnProperty.call(a, key), hasB = Object.prototype.hasOwnProperty.call(b, key), av = a[key], bv = b[key];
                    if (key.length > 512 || pointer.length + key.length > 2048) {
                        truncated = true;
                        continue;
                    }
                    const path = `${pointer}/${(0, api_response_json_1.pointerKey)(key)}`;
                    if (!hasA || !hasB) {
                        bodyChanged = true;
                        add({ kind: hasA ? "removed" : "added", path, before: hasA ? preview(av) : "(absent)", after: hasB ? preview(bv) : "(absent)" });
                    }
                    else
                        stack.push({ a: av, b: bv, pointer: path });
                }
            }
            else if (!Object.is(a, b)) {
                bodyChanged = true;
                add({ kind: "changed", path: pointer, before: preview(a), after: preview(b) });
            }
        }
        if (!bodyChanged && before.bodyText !== after.bodyText && [...before.diagnostics, ...after.diagnostics].some(d => /safe numeric|duplicate object keys/.test(d.message)))
            add({ kind: "changed", path: "body source", before: "Source text differs", after: "Parsed comparison is inconclusive because of numeric precision or duplicate JSON keys." });
    }
    else if (before.bodyText !== after.bodyText)
        add({ kind: "changed", path: "body source", before: before.bodyText.slice(0, 200), after: after.bodyText.slice(0, 200) });
    return { changes, truncated };
}
exports.compareApiResponses = compareApiResponses;
/** Sampling is explicit: this is an example-derived shape, not proof of the API contract. */
function inferApiTypes(report, name = "ApiResponse", pointer = "") {
    if (!report.structured)
        throw new types_1.ToolInputError("Type inference needs a structured JSON, NDJSON, SSE or form body.");
    if (!/^[A-Z][A-Za-z0-9_]{0,79}$/.test(name) || ["Object", "String", "Number", "Boolean", "Array", "Date", "Promise", "Record", "Function"].includes(name))
        throw new types_1.ToolInputError("Use a unique PascalCase type name up to 80 characters (ApiResponse).");
    let nodes = 0, sampled = false;
    const sample = (value, depth = 0) => {
        if (++nodes > 3000 || depth > 16) {
            sampled = true;
            throw new types_1.ToolInputError("Type inference exceeds its 3,000-node/16-level limit. Select a smaller subtree with JSON Pointer.");
        }
        if (Array.isArray(value)) {
            if (value.length > 50)
                sampled = true;
            return value.slice(0, 50).map(v => sample(v, depth + 1));
        }
        if (value && typeof value === "object") {
            const entries = Object.entries(value);
            if (entries.length > 200)
                throw new types_1.ToolInputError("Type inference exceeds 200 object properties. Select a smaller subtree.");
            return Object.fromEntries(entries.map(([k, v]) => [k, sample(v, depth + 1)]));
        }
        return value;
    };
    const shape = (0, data_types_1.shapeOf)(sample((0, api_response_json_1.apiJsonPointer)(report.body, pointer)));
    const type = (s, depth = 0) => {
        switch (s.kind) {
            case "integer":
            case "number": return "number";
            case "string":
            case "boolean":
            case "null": return s.kind;
            case "unknown": return "unknown";
            case "array": return `Array<${type(s.item, depth + 1)}>`;
            case "union": return s.options.map(o => type(o, depth)).join(" | ");
            case "object": return `{\n${[...s.fields].map(([key, f]) => `${"  ".repeat(depth + 1)}${JSON.stringify(key)}${f.count < s.samples ? "?" : ""}: ${type(f.shape, depth + 1)};`).join("\n")}\n${"  ".repeat(depth)}}`;
        }
    };
    // Reuse shared inference/schema generation; preserve dangerous property names safely in the shared engine.
    const schema = (0, data_types_1.toJsonSchema)(shape, name);
    const pending = [schema];
    while (pending.length) {
        const value = pending.pop();
        if (value && typeof value === "object") {
            if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "additionalProperties") && value.type === "object")
                delete value.additionalProperties;
            pending.push(...Object.values(value));
        }
    }
    return { typescript: `// Inferred from captured examples${sampled ? " (arrays sampled to 50 items)" : ""}; verify against the API contract.\nexport type ${name} = ${type(shape)};\n`, schema: JSON.stringify(schema, null, 2) + "\n", sampled };
}
exports.inferApiTypes = inferApiTypes;
function normalizedApiResponse(report) {
    const body = report.bodyText;
    // Reconstructed text is decoded capture content; remove stale wire framing/encoding metadata.
    const headers = report.headers.filter(([k]) => !/^(content-length|transfer-encoding|content-encoding)$/i.test(k));
    if (!report.status)
        return body;
    return `HTTP/${report.protocol || "1.1"} ${report.status}${report.statusText ? " " + report.statusText : ""}\r\n${headers.map(([k, v]) => `${k}: ${v}\r\n`).join("")}\r\n${body}`;
}
exports.normalizedApiResponse = normalizedApiResponse;
function apiReportJson(report) {
    return JSON.stringify({ source: report.source, status: report.status, statusText: report.statusText, protocol: report.protocol, headers: report.headers, format: report.format, capturedBodyBytes: report.bytes, bodyText: report.bodyText, diagnostics: report.diagnostics, fields: report.fields, fieldsTruncated: report.truncatedFields, links: report.links, cookies: report.cookies, cache: report.cache, rateLimits: report.rateLimits, chain: report.chain, ...(report.url ? { url: report.url } : {}), ...(report.durationMs !== undefined ? { durationMs: report.durationMs } : {}) }, null, 2) + "\n";
}
exports.apiReportJson = apiReportJson;
function apiReportMarkdown(report) {
    const cell = (text) => text.replace(/[\\`*_{}\[\]()<>!]/g, "\\$&").replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
    const snippet = report.bodyText.slice(0, 16000);
    const fence = "`".repeat(Math.max(3, ...(snippet.match(/`+/g) ?? []).map(v => v.length + 1)));
    return `# API Response Inspection\n\nStatus: ${report.status ?? "unknown"} · Format: ${report.format} · Captured body: ${report.bytes} bytes\n\n## Findings\n\n${report.diagnostics.map(d => `- ${d.severity.toUpperCase()} · ${cell(d.category)}: ${cell(d.message)}`).join("\n") || "No additional findings."}\n\n## Headers\n\n| Header | Value |\n| --- | --- |\n${report.headers.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`).join("\n")}\n\n## Body${report.bodyText.length > snippet.length ? " (first 16,000 characters)" : ""}\n\n${fence}${report.isJson ? "json" : "text"}\n${snippet}\n${fence}\n`;
}
exports.apiReportMarkdown = apiReportMarkdown;
function apiAssertions(report, runner) {
    if (!["vitest", "jest"].includes(runner))
        throw new types_1.ToolInputError("Unsupported test runner.");
    return `import { expect } from "${runner === "jest" ? "@jest/globals" : "vitest"}";\n\n// Call with a Response from your application's test harness. No requests are sent here.\nexport async function assertApiResponse(response: Response) {\n${report.status !== undefined ? `  expect(response.status).toBe(${report.status});\n` : ""}${report.headers.some(([k]) => /^content-type$/i.test(k)) ? `  expect(response.headers.get("content-type")).toBe(${JSON.stringify(report.headers.find(([k]) => /^content-type$/i.test(k))[1])});\n` : ""}  const text = await response.text();\n${report.isJson ? `  const body: unknown = JSON.parse(text);\n  expect(${Array.isArray(report.body) ? "Array.isArray(body)" : "typeof body"}).toBe(${JSON.stringify(Array.isArray(report.body) ? true : typeof report.body)});\n${report.body === null ? "  expect(body).toBeNull();\n" : ""}` : report.format === "empty" ? '  expect(text).toBe("");\n' : '  expect(typeof text).toBe("string");\n'}  // Add domain assertions from the documented API contract.\n}\n`;
}
exports.apiAssertions = apiAssertions;
//# sourceMappingURL=api-response-tools.js.map