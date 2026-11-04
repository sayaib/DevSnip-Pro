"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiFields = exports.redactApiJson = exports.apiJsonPointer = exports.formatApiJson = exports.parseApiJson = exports.checkApiSize = exports.valueType = exports.pointerKey = exports.apiSecretHeader = exports.apiSecretKey = exports.API_MAX_FIELDS = exports.API_MAX_NODES = exports.API_MAX_DEPTH = exports.API_MAX_INPUT = void 0;
const types_1 = require("../types");
exports.API_MAX_INPUT = 2 * 1024 * 1024;
exports.API_MAX_DEPTH = 64;
exports.API_MAX_NODES = 50000;
exports.API_MAX_FIELDS = 1000;
const apiSecretKey = (key) => /(?:password|passwd|secret|token|api[-_]?key|authorization|session|credential)/i.test(key);
exports.apiSecretKey = apiSecretKey;
const apiSecretHeader = (name) => /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i.test(name);
exports.apiSecretHeader = apiSecretHeader;
const pointerKey = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");
exports.pointerKey = pointerKey;
const valueType = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
exports.valueType = valueType;
function checkApiSize(input) {
    if (input.length > exports.API_MAX_INPUT || Buffer.byteLength(input) > exports.API_MAX_INPUT)
        throw new types_1.ToolInputError("Response input exceeds 2 MiB. Inspect a smaller response or HAR excerpt.");
}
exports.checkApiSize = checkApiSize;
/** Validate then inspect bounded JSON source for precision and duplicate-key diagnostics. */
function parseApiJson(source) {
    checkApiSize(source);
    const value = JSON.parse(source);
    let depth = 0, nodes = 0, unsafeNumber = false, duplicate = false;
    const objects = [];
    const tokens = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\[\]{}:,]|true|false|null/g;
    let match;
    while ((match = tokens.exec(source))) {
        const token = match[0];
        if (++nodes > exports.API_MAX_NODES)
            throw new types_1.ToolInputError("JSON exceeds the 50,000-token inspection limit.");
        if (token === "{" || token === "[") {
            if (++depth > exports.API_MAX_DEPTH)
                throw new types_1.ToolInputError("JSON nesting exceeds 64 levels.");
            objects.push(token === "{" ? new Set() : undefined);
        }
        else if (token === "}" || token === "]") {
            depth--;
            objects.pop();
        }
        else if (token.startsWith('"')) {
            let next = tokens.lastIndex;
            while (next < source.length && /\s/.test(source[next]))
                next++;
            if (source[next] === ":" && objects[objects.length - 1]) {
                const key = JSON.parse(token), keys = objects[objects.length - 1];
                if (keys.has(key))
                    duplicate = true;
                keys.add(key);
            }
        }
        else if (/^-?\d/.test(token)) {
            const n = Number(token);
            if (!Number.isFinite(n) || Number.isInteger(n) && !Number.isSafeInteger(n))
                unsafeNumber = true;
        }
    }
    const notes = [];
    if (unsafeNumber)
        notes.push("JSON contains numbers outside JavaScript's safe numeric range. Source text is retained; parsed values, comparisons and inferred types may lose precision. Prefer string IDs for large integers.");
    if (duplicate)
        notes.push("JSON contains duplicate object keys. Parsed views keep the last value; the source body retains all keys.");
    return { value, notes };
}
exports.parseApiJson = parseApiJson;
/** Pretty-print without parsing numbers or discarding duplicate keys. */
function formatApiJson(source, compact = false) {
    let result = "", quoted = false, escaped = false, depth = 0;
    const newline = () => { if (!compact)
        result += "\n" + "  ".repeat(Math.max(0, depth)); };
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
            result += c;
            if (escaped)
                escaped = false;
            else if (c === "\\")
                escaped = true;
            else if (c === '"')
                quoted = false;
            continue;
        }
        if (c === '"') {
            quoted = true;
            result += c;
        }
        else if (/\s/.test(c))
            continue;
        else if (c === "{" || c === "[") {
            result += c;
            depth++;
            let next = i + 1;
            while (next < source.length && /\s/.test(source[next]))
                next++;
            if (source[next] !== "}" && source[next] !== "]")
                newline();
        }
        else if (c === "}" || c === "]") {
            depth--;
            let previous = i - 1;
            while (previous >= 0 && /\s/.test(source[previous]))
                previous--;
            if (source[previous] !== "{" && source[previous] !== "[")
                newline();
            result += c;
        }
        else if (c === ",") {
            result += c;
            newline();
        }
        else if (c === ":")
            result += compact ? ":" : ": ";
        else
            result += c;
    }
    return result;
}
exports.formatApiJson = formatApiJson;
function apiJsonPointer(value, pointer) {
    if (!pointer)
        return value;
    if (!pointer.startsWith("/"))
        throw new types_1.ToolInputError("Use a JSON Pointer beginning with / (for example /data/0/id); leave empty for the whole body.");
    let result = value;
    for (const raw of pointer.slice(1).split("/")) {
        if (/~(?![01])/.test(raw))
            throw new types_1.ToolInputError("Invalid JSON Pointer escape. Use ~0 for ~ and ~1 for /.");
        const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        if (Array.isArray(result) && !/^(0|[1-9]\d*)$/.test(key))
            throw new types_1.ToolInputError("Array JSON Pointer segments must be nonnegative integer indices.");
        if (!result || typeof result !== "object" || !Object.prototype.hasOwnProperty.call(result, key))
            throw new types_1.ToolInputError(`JSON Pointer does not exist: ${pointer}`);
        result = result[key];
    }
    return result;
}
exports.apiJsonPointer = apiJsonPointer;
/** Source-range redaction retains non-secret JSON whitespace, duplicate keys and large integers. */
function redactApiJson(source) {
    const strings = /"(?:\\.|[^"\\])*"/g;
    let result = "", offset = 0, match;
    while ((match = strings.exec(source))) {
        let colon = strings.lastIndex;
        while (colon < source.length && /\s/.test(source[colon]))
            colon++;
        if (source[colon] !== ":" || !(0, exports.apiSecretKey)(JSON.parse(match[0])))
            continue;
        let start = colon + 1;
        while (start < source.length && /\s/.test(source[start]))
            start++;
        let end = start, depth = 0, quoted = false;
        for (; end < source.length; end++) {
            const c = source[end];
            if (quoted) {
                if (c === "\\")
                    end++;
                else if (c === '"')
                    quoted = false;
                continue;
            }
            if (c === '"')
                quoted = true;
            else if (c === "[" || c === "{")
                depth++;
            else if (c === "]" || c === "}") {
                if (!depth)
                    break;
                depth--;
            }
            else if (!depth && (c === "," || /\s/.test(c)))
                break;
        }
        result += source.slice(offset, start) + '"REDACTED"';
        offset = end;
        strings.lastIndex = end;
    }
    return result + source.slice(offset);
}
exports.redactApiJson = redactApiJson;
function apiFields(value, maxFields = 200) {
    if (!Number.isInteger(maxFields) || maxFields < 1 || maxFields > exports.API_MAX_FIELDS)
        throw new types_1.ToolInputError("Field limit must be between 1 and 1000.");
    const fields = [];
    const stack = [{ value, path: "$", pointer: "", depth: 0 }];
    let visited = 0, truncated = false;
    while (stack.length) {
        if (fields.length >= maxFields || ++visited > exports.API_MAX_NODES) {
            truncated = true;
            break;
        }
        const node = stack.pop(), type = (0, exports.valueType)(node.value);
        const example = type === "object" ? `{${Object.keys(node.value).length} fields}` : type === "array" ? `[${node.value.length} items]` : JSON.stringify(node.value)?.slice(0, 120) ?? "";
        fields.push({ path: node.path, pointer: node.pointer, type, example });
        if (node.depth >= exports.API_MAX_DEPTH) {
            truncated = true;
            continue;
        }
        const entries = Array.isArray(node.value) ? node.value.slice(0, 50).map((v, i) => [String(i), v]) : node.value && typeof node.value === "object" ? Object.entries(node.value).slice(0, exports.API_MAX_FIELDS) : [];
        if (Array.isArray(node.value) && node.value.length > 50 || type === "object" && Object.keys(node.value).length > exports.API_MAX_FIELDS)
            truncated = true;
        for (let i = entries.length - 1; i >= 0; i--) {
            const [key, child] = entries[i];
            if (key.length > 512 || node.pointer.length + key.length > 2048) {
                truncated = true;
                continue;
            }
            stack.push({ value: child, path: Array.isArray(node.value) ? `${node.path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${node.path}.${key}` : `${node.path}[${JSON.stringify(key)}]`, pointer: `${node.pointer}/${(0, exports.pointerKey)(key)}`, depth: node.depth + 1 });
        }
    }
    return { fields, truncated };
}
exports.apiFields = apiFields;
//# sourceMappingURL=api-response-json.js.map