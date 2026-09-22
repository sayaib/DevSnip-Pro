"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.percentiles = exports.parseAssertionRules = exports.runAssertions = void 0;
const json_tools_1 = require("./json-tools");
function describe(rule) {
    const subject = rule.selector ? `${rule.target}(${rule.selector})` : rule.target;
    const expectation = rule.expected === undefined ? "" : ` ${JSON.stringify(rule.expected)}`;
    return rule.label || `${subject} ${rule.operator}${expectation}`;
}
function stringify(value) {
    if (value === undefined)
        return "undefined";
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
function resolve(rule, subject) {
    switch (rule.target) {
        case "status":
            return subject.status;
        case "latency":
            return subject.latencyMs;
        case "size":
            return subject.sizeBytes;
        case "header": {
            if (!rule.selector)
                return undefined;
            const wanted = rule.selector.toLowerCase();
            const match = Object.entries(subject.headers).find(([key]) => key.toLowerCase() === wanted);
            return match?.[1];
        }
        case "json":
            return rule.selector ? (0, json_tools_1.readPath)(subject.body, rule.selector) : subject.body;
        case "body":
        default:
            return subject.bodyText;
    }
}
function compare(rule, actual) {
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
            if (length === undefined)
                return { passed: false, detail: "value has no length" };
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
            }
            catch (error) {
                return { passed: false, detail: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        case "lessThan": {
            const left = Number(actual);
            const right = Number(expected);
            if (!Number.isFinite(left) || !Number.isFinite(right))
                return { passed: false, detail: "not a number" };
            return { passed: left < right };
        }
        case "greaterThan": {
            const left = Number(actual);
            const right = Number(expected);
            if (!Number.isFinite(left) || !Number.isFinite(right))
                return { passed: false, detail: "not a number" };
            return { passed: left > right };
        }
        default:
            return { passed: false, detail: `unknown operator "${rule.operator}"` };
    }
}
function runAssertions(rules, subject) {
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
exports.runAssertions = runAssertions;
/** Validates rules coming from a webview or a saved collection. */
function parseAssertionRules(input) {
    if (!Array.isArray(input))
        return [];
    const targets = ["status", "latency", "header", "body", "json", "size"];
    const operators = [
        "equals", "notEquals", "contains", "notContains", "matches",
        "lessThan", "greaterThan", "exists", "notExists", "isArray", "isObject", "hasLength"
    ];
    const rules = [];
    for (const entry of input) {
        if (!entry || typeof entry !== "object")
            continue;
        const candidate = entry;
        const target = candidate.target;
        const operator = candidate.operator;
        if (!targets.includes(target) || !operators.includes(operator))
            continue;
        rules.push({
            target,
            operator,
            selector: typeof candidate.selector === "string" ? candidate.selector : undefined,
            expected: typeof candidate.expected === "string" || typeof candidate.expected === "number"
                ? candidate.expected
                : undefined,
            label: typeof candidate.label === "string" ? candidate.label : undefined
        });
    }
    return rules;
}
exports.parseAssertionRules = parseAssertionRules;
/** Latency percentiles shared by the batch and benchmark tools. */
function percentiles(samples) {
    if (!samples.length)
        return { p50: 0, p90: 0, p99: 0, min: 0, max: 0, mean: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    return {
        p50: at(0.5),
        p90: at(0.9),
        p99: at(0.99),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length)
    };
}
exports.percentiles = percentiles;
//# sourceMappingURL=assertions.js.map