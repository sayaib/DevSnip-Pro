"use strict";
/**
 * JSON utilities shared by the client: path extraction, structural diffing and
 * JSON Schema validation.
 *
 * All of it is implemented here rather than pulled from a dependency because
 * the extension ships its runtime dependencies inside the VSIX, and because a
 * schema validator that compiles expressions (as several popular ones do) is
 * not something to run over untrusted model output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJson = exports.inferSchema = exports.validateSchema = exports.diffJson = exports.leafPaths = exports.readPath = void 0;
/**
 * Reads a value with a dotted path: `data.items[0].name`.
 * Supports `*` to map across an array, e.g. `items[*].id`.
 */
function readPath(value, path) {
    const trimmed = path.trim().replace(/^\$\.?/, "");
    if (!trimmed)
        return value;
    const segments = trimmed
        .replace(/\[(\d+|\*)\]/g, ".$1")
        .split(".")
        .filter(Boolean);
    let current = value;
    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (current === null || current === undefined)
            return undefined;
        if (segment === "*") {
            if (!Array.isArray(current))
                return undefined;
            const rest = segments.slice(index + 1).join(".");
            return current.map(entry => (rest ? readPath(entry, rest) : entry));
        }
        if (Array.isArray(current)) {
            const position = Number(segment);
            if (!Number.isInteger(position))
                return undefined;
            current = current[position < 0 ? current.length + position : position];
            continue;
        }
        if (typeof current !== "object")
            return undefined;
        current = current[segment];
    }
    return current;
}
exports.readPath = readPath;
/** Every leaf path in a value, used for diffing and for path suggestions. */
function leafPaths(value, prefix = "", out = new Map()) {
    if (value === null || typeof value !== "object") {
        out.set(prefix || "$", value);
        return out;
    }
    if (Array.isArray(value)) {
        if (!value.length)
            out.set(prefix || "$", "[]");
        value.forEach((entry, index) => leafPaths(entry, `${prefix}[${index}]`, out));
        return out;
    }
    const keys = Object.keys(value);
    if (!keys.length)
        out.set(prefix || "$", "{}");
    for (const key of keys) {
        leafPaths(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
}
exports.leafPaths = leafPaths;
/** Structural comparison of two JSON values. */
function diffJson(left, right) {
    const leftLeaves = leafPaths(left);
    const rightLeaves = leafPaths(right);
    const differences = [];
    for (const [path, leftValue] of leftLeaves) {
        if (!rightLeaves.has(path)) {
            differences.push({ path, kind: "removed", left: leftValue });
            continue;
        }
        const rightValue = rightLeaves.get(path);
        if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
            differences.push({ path, kind: "changed", left: leftValue, right: rightValue });
        }
    }
    for (const [path, rightValue] of rightLeaves) {
        if (!leftLeaves.has(path))
            differences.push({ path, kind: "added", right: rightValue });
    }
    return differences.sort((a, b) => a.path.localeCompare(b.path));
}
exports.diffJson = diffJson;
/**
 * Validates a value against a practical subset of JSON Schema: type, required,
 * properties, items, enum, const, numeric bounds, string length and pattern,
 * array bounds, and additionalProperties.
 */
function validateSchema(value, schema, path = "$") {
    if (!schema || typeof schema !== "object")
        return [];
    const rules = schema;
    const violations = [];
    const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (rules.type) {
        const expected = Array.isArray(rules.type) ? rules.type : [rules.type];
        const matches = expected.some(type => type === "integer" ? Number.isInteger(value) : type === actualType);
        if (!matches) {
            violations.push({ path, message: `expected ${expected.join(" or ")} but found ${actualType}` });
            // The type is wrong, so the keyword checks below would be noise.
            return violations;
        }
    }
    if (rules.enum && Array.isArray(rules.enum)) {
        const allowed = rules.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value));
        if (!allowed)
            violations.push({ path, message: `value is not one of ${JSON.stringify(rules.enum)}` });
    }
    if ("const" in rules && JSON.stringify(rules.const) !== JSON.stringify(value)) {
        violations.push({ path, message: `value must equal ${JSON.stringify(rules.const)}` });
    }
    if (typeof value === "number") {
        if (typeof rules.minimum === "number" && value < rules.minimum) {
            violations.push({ path, message: `must be >= ${rules.minimum}` });
        }
        if (typeof rules.maximum === "number" && value > rules.maximum) {
            violations.push({ path, message: `must be <= ${rules.maximum}` });
        }
    }
    if (typeof value === "string") {
        if (typeof rules.minLength === "number" && value.length < rules.minLength) {
            violations.push({ path, message: `must be at least ${rules.minLength} characters` });
        }
        if (typeof rules.maxLength === "number" && value.length > rules.maxLength) {
            violations.push({ path, message: `must be at most ${rules.maxLength} characters` });
        }
        if (typeof rules.pattern === "string") {
            try {
                if (!new RegExp(rules.pattern).test(value)) {
                    violations.push({ path, message: `must match ${rules.pattern}` });
                }
            }
            catch {
                violations.push({ path, message: `schema pattern ${rules.pattern} is not a valid regular expression` });
            }
        }
    }
    if (Array.isArray(value)) {
        if (typeof rules.minItems === "number" && value.length < rules.minItems) {
            violations.push({ path, message: `must have at least ${rules.minItems} items` });
        }
        if (typeof rules.maxItems === "number" && value.length > rules.maxItems) {
            violations.push({ path, message: `must have at most ${rules.maxItems} items` });
        }
        if (rules.items) {
            value.forEach((entry, index) => {
                violations.push(...validateSchema(entry, rules.items, `${path}[${index}]`));
            });
        }
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value;
        if (Array.isArray(rules.required)) {
            for (const key of rules.required) {
                if (!(key in record))
                    violations.push({ path: `${path}.${key}`, message: "is required but missing" });
            }
        }
        if (rules.properties && typeof rules.properties === "object") {
            for (const [key, childSchema] of Object.entries(rules.properties)) {
                if (key in record) {
                    violations.push(...validateSchema(record[key], childSchema, `${path}.${key}`));
                }
            }
            if (rules.additionalProperties === false) {
                const declared = new Set(Object.keys(rules.properties));
                for (const key of Object.keys(record)) {
                    if (!declared.has(key))
                        violations.push({ path: `${path}.${key}`, message: "is not allowed by the schema" });
                }
            }
        }
    }
    return violations;
}
exports.validateSchema = validateSchema;
/** Infers a JSON Schema from an example value, for the mock/contract tools. */
function inferSchema(value) {
    if (value === null)
        return { type: "null" };
    if (Array.isArray(value)) {
        return { type: "array", items: value.length ? inferSchema(value[0]) : {} };
    }
    if (typeof value === "object") {
        const properties = {};
        for (const [key, entry] of Object.entries(value)) {
            properties[key] = inferSchema(entry);
        }
        return { type: "object", properties, required: Object.keys(properties) };
    }
    if (typeof value === "number")
        return { type: Number.isInteger(value) ? "integer" : "number" };
    return { type: typeof value };
}
exports.inferSchema = inferSchema;
/** Extracts the first JSON value embedded in text, tolerating fenced code blocks. */
function extractJson(text) {
    const trimmed = text.trim();
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    try {
        return { value: JSON.parse(candidate), ok: true };
    }
    catch (error) {
        // Fall back to the outermost braces or brackets.
        const start = candidate.search(/[[{]/);
        const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
        if (start >= 0 && end > start) {
            try {
                return { value: JSON.parse(candidate.slice(start, end + 1)), ok: true };
            }
            catch {
                /* fall through to the error below */
            }
        }
        return { value: undefined, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
exports.extractJson = extractJson;
//# sourceMappingURL=json-tools.js.map