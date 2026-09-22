import { readPath } from "./json-tools";

/**
 * A declarative assertion language for API tests.
 *
 * Deliberately data-driven rather than script-driven: a test "script" that ran
 * arbitrary JavaScript would mean evaluating code that arrives from a saved
 * collection, which is exactly the kind of dynamic execution the extension's
 * own security audit flags. Every check here is a comparison the runner
 * performs itself.
 */

export type AssertionTarget = "status" | "latency" | "header" | "body" | "json" | "size";

export type AssertionOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "matches"
  | "lessThan"
  | "greaterThan"
  | "exists"
  | "notExists"
  | "isArray"
  | "isObject"
  | "hasLength";

export interface AssertionRule {
  target: AssertionTarget;
  /** Header name for `header`, JSON path for `json`. */
  selector?: string;
  operator: AssertionOperator;
  /** Not required by `exists`, `notExists`, `isArray` or `isObject`. */
  expected?: string | number;
  /** Optional human label, otherwise one is generated. */
  label?: string;
}

export interface AssertionSubject {
  status: number;
  latencyMs: number;
  sizeBytes: number;
  headers: Record<string, unknown>;
  body: unknown;
  bodyText: string;
}

export interface AssertionResult {
  label: string;
  passed: boolean;
  actual: string;
  expected: string;
  detail?: string;
}

function describe(rule: AssertionRule): string {
  const subject = rule.selector ? `${rule.target}(${rule.selector})` : rule.target;
  const expectation = rule.expected === undefined ? "" : ` ${JSON.stringify(rule.expected)}`;
  return rule.label || `${subject} ${rule.operator}${expectation}`;
}

function stringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function resolve(rule: AssertionRule, subject: AssertionSubject): unknown {
  switch (rule.target) {
    case "status":
      return subject.status;
    case "latency":
      return subject.latencyMs;
    case "size":
      return subject.sizeBytes;
    case "header": {
      if (!rule.selector) return undefined;
      const wanted = rule.selector.toLowerCase();
      const match = Object.entries(subject.headers).find(([key]) => key.toLowerCase() === wanted);
      return match?.[1];
    }
    case "json":
      return rule.selector ? readPath(subject.body, rule.selector) : subject.body;
    case "body":
    default:
      return subject.bodyText;
  }
}

function compare(rule: AssertionRule, actual: unknown): { passed: boolean; detail?: string } {
  const expected = rule.expected;

  switch (rule.operator) {
    case "exists":
      return { passed: actual !== undefined && actual !== null };
    case "notExists":
      return { passed: actual === undefined || actual === null };
    case "isArray":
      return { passed: Array.isArray(actual) };
    case "isObject":
      return { passed: Boolean(actual) && typeof actual === "object" && !Array.isArray(actual) };
    case "hasLength": {
      const length = Array.isArray(actual) || typeof actual === "string" ? actual.length : undefined;
      if (length === undefined) return { passed: false, detail: "value has no length" };
      return { passed: length === Number(expected) };
    }
    case "equals":
      // Compare loosely across string/number so "200" matches 200 from a form.
      return { passed: String(actual) === String(expected) || JSON.stringify(actual) === JSON.stringify(expected) };
    case "notEquals":
      return { passed: String(actual) !== String(expected) && JSON.stringify(actual) !== JSON.stringify(expected) };
    case "contains":
      return { passed: stringify(actual).includes(String(expected)) };
    case "notContains":
      return { passed: !stringify(actual).includes(String(expected)) };
    case "matches": {
      try {
        return { passed: new RegExp(String(expected)).test(stringify(actual)) };
      } catch (error) {
        return { passed: false, detail: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    case "lessThan": {
      const left = Number(actual);
      const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return { passed: false, detail: "not a number" };
      return { passed: left < right };
    }
    case "greaterThan": {
      const left = Number(actual);
      const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return { passed: false, detail: "not a number" };
      return { passed: left > right };
    }
    default:
      return { passed: false, detail: `unknown operator "${rule.operator}"` };
  }
}

export interface AssertionReport {
  results: AssertionResult[];
  passed: number;
  failed: number;
  allPassed: boolean;
}

export function runAssertions(rules: AssertionRule[], subject: AssertionSubject): AssertionReport {
  const results = rules.map(rule => {
    const actual = resolve(rule, subject);
    const { passed, detail } = compare(rule, actual);
    return {
      label: describe(rule),
      passed,
      actual: stringify(actual).slice(0, 300),
      expected: rule.expected === undefined ? "-" : stringify(rule.expected),
      detail
    };
  });
  const passed = results.filter(result => result.passed).length;
  return { results, passed, failed: results.length - passed, allPassed: results.length > 0 && passed === results.length };
}

/** Validates rules coming from a webview or a saved collection. */
export function parseAssertionRules(input: unknown): AssertionRule[] {
  if (!Array.isArray(input)) return [];
  const targets: AssertionTarget[] = ["status", "latency", "header", "body", "json", "size"];
  const operators: AssertionOperator[] = [
    "equals", "notEquals", "contains", "notContains", "matches",
    "lessThan", "greaterThan", "exists", "notExists", "isArray", "isObject", "hasLength"
  ];
  const rules: AssertionRule[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const target = candidate.target as AssertionTarget;
    const operator = candidate.operator as AssertionOperator;
    if (!targets.includes(target) || !operators.includes(operator)) continue;
    rules.push({
      target,
      operator,
      selector: typeof candidate.selector === "string" ? candidate.selector : undefined,
      expected:
        typeof candidate.expected === "string" || typeof candidate.expected === "number"
          ? candidate.expected
          : undefined,
      label: typeof candidate.label === "string" ? candidate.label : undefined
    });
  }
  return rules;
}

/** Latency percentiles shared by the batch and benchmark tools. */
export function percentiles(samples: number[]): { p50: number; p90: number; p99: number; min: number; max: number; mean: number } {
  if (!samples.length) return { p50: 0, p90: 0, p99: 0, min: 0, max: 0, mean: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return {
    p50: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length)
  };
}
