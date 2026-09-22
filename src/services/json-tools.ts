/**
 * JSON utilities shared by the client: path extraction, structural diffing and
 * JSON Schema validation.
 *
 * All of it is implemented here rather than pulled from a dependency because
 * the extension ships its runtime dependencies inside the VSIX, and because a
 * schema validator that compiles expressions (as several popular ones do) is
 * not something to run over untrusted model output.
 */

/**
 * Reads a value with a dotted path: `data.items[0].name`.
 * Supports `*` to map across an array, e.g. `items[*].id`.
 */
export function readPath(value: unknown, path: string): unknown {
  const trimmed = path.trim().replace(/^\$\.?/, "");
  if (!trimmed) return value;

  const segments = trimmed
    .replace(/\[(\d+|\*)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current: unknown = value;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (current === null || current === undefined) return undefined;

    if (segment === "*") {
      if (!Array.isArray(current)) return undefined;
      const rest = segments.slice(index + 1).join(".");
      return current.map(entry => (rest ? readPath(entry, rest) : entry));
    }
    if (Array.isArray(current)) {
      const position = Number(segment);
      if (!Number.isInteger(position)) return undefined;
      current = current[position < 0 ? current.length + position : position];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Every leaf path in a value, used for diffing and for path suggestions. */
export function leafPaths(value: unknown, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value === null || typeof value !== "object") {
    out.set(prefix || "$", value);
    return out;
  }
  if (Array.isArray(value)) {
    if (!value.length) out.set(prefix || "$", "[]");
    value.forEach((entry, index) => leafPaths(entry, `${prefix}[${index}]`, out));
    return out;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (!keys.length) out.set(prefix || "$", "{}");
  for (const key of keys) {
    leafPaths((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

export interface JsonDifference {
  path: string;
  kind: "added" | "removed" | "changed";
  left?: unknown;
  right?: unknown;
}

/** Structural comparison of two JSON values. */
export function diffJson(left: unknown, right: unknown): JsonDifference[] {
  const leftLeaves = leafPaths(left);
  const rightLeaves = leafPaths(right);
  const differences: JsonDifference[] = [];

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
    if (!leftLeaves.has(path)) differences.push({ path, kind: "added", right: rightValue });
  }
  return differences.sort((a, b) => a.path.localeCompare(b.path));
}

export interface SchemaViolation {
  path: string;
  message: string;
}

/**
 * Validates a value against a practical subset of JSON Schema: type, required,
 * properties, items, enum, const, numeric bounds, string length and pattern,
 * array bounds, and additionalProperties.
 */
export function validateSchema(value: unknown, schema: unknown, path = "$"): SchemaViolation[] {
  if (!schema || typeof schema !== "object") return [];
  const rules = schema as Record<string, any>;
  const violations: SchemaViolation[] = [];

  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

  if (rules.type) {
    const expected: string[] = Array.isArray(rules.type) ? rules.type : [rules.type];
    const matches = expected.some(type =>
      type === "integer" ? Number.isInteger(value) : type === actualType
    );
    if (!matches) {
      violations.push({ path, message: `expected ${expected.join(" or ")} but found ${actualType}` });
      // The type is wrong, so the keyword checks below would be noise.
      return violations;
    }
  }

  if (rules.enum && Array.isArray(rules.enum)) {
    const allowed = rules.enum.some((entry: unknown) => JSON.stringify(entry) === JSON.stringify(value));
    if (!allowed) violations.push({ path, message: `value is not one of ${JSON.stringify(rules.enum)}` });
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
      } catch {
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
    const record = value as Record<string, unknown>;
    if (Array.isArray(rules.required)) {
      for (const key of rules.required) {
        if (!(key in record)) violations.push({ path: `${path}.${key}`, message: "is required but missing" });
      }
    }
    if (rules.properties && typeof rules.properties === "object") {
      for (const [key, childSchema] of Object.entries(rules.properties as Record<string, unknown>)) {
        if (key in record) {
          violations.push(...validateSchema(record[key], childSchema, `${path}.${key}`));
        }
      }
      if (rules.additionalProperties === false) {
        const declared = new Set(Object.keys(rules.properties as Record<string, unknown>));
        for (const key of Object.keys(record)) {
          if (!declared.has(key)) violations.push({ path: `${path}.${key}`, message: "is not allowed by the schema" });
        }
      }
    }
  }

  return violations;
}

/** Infers a JSON Schema from an example value, for the mock/contract tools. */
export function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return { type: "array", items: value.length ? inferSchema(value[0]) : {} };
  }
  if (typeof value === "object") {
    const properties: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = inferSchema(entry);
    }
    return { type: "object", properties, required: Object.keys(properties) };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  return { type: typeof value };
}

/** Extracts the first JSON value embedded in text, tolerating fenced code blocks. */
export function extractJson(text: string): { value: unknown; ok: boolean; error?: string } {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return { value: JSON.parse(candidate), ok: true };
  } catch (error) {
    // Fall back to the outermost braces or brackets.
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return { value: JSON.parse(candidate.slice(start, end + 1)), ok: true };
      } catch {
        /* fall through to the error below */
      }
    }
    return { value: undefined, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
