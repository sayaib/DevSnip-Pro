"use strict";
/**
 * The contract every toolkit tool implements.
 *
 * A tool is declarative: metadata, input fields and a `run` function. The
 * workbench webview renders the form, the host runs the tool, and the result
 * is rendered with the same actions everywhere (copy, insert at cursor, save
 * to workspace). Tools never touch VS Code directly - anything they need from
 * the environment comes through `ToolContext`, so every tool is unit-testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtUsd = exports.fmtBytes = exports.fmtNumber = exports.required = exports.bool = exports.num = exports.str = exports.describe = exports.ToolInputError = void 0;
class ToolInputError extends Error {
}
exports.ToolInputError = ToolInputError;
function describe(tool) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { run, dynamicExamples, ...rest } = tool;
    return rest;
}
exports.describe = describe;
// ---------------------------------------------------------------------------
// Value helpers: read form values without the `parseInt(x) || default` bug,
// which turned a deliberate 0 into the default.
// ---------------------------------------------------------------------------
function str(values, key, fallback = "") {
    const value = values[key];
    return value === undefined || value === null ? fallback : String(value);
}
exports.str = str;
function num(values, key, fallback, bounds = {}) {
    const raw = values[key];
    if (raw === undefined || raw === null || String(raw).trim() === "")
        return fallback;
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[_,\s]/g, ""));
    const label = bounds.label ?? key;
    if (!Number.isFinite(value))
        throw new ToolInputError(`${label} must be a number.`);
    if (bounds.integer && !Number.isInteger(value))
        throw new ToolInputError(`${label} must be a whole number.`);
    if (bounds.min !== undefined && value < bounds.min)
        throw new ToolInputError(`${label} must be at least ${bounds.min}.`);
    if (bounds.max !== undefined && value > bounds.max)
        throw new ToolInputError(`${label} must be at most ${bounds.max}.`);
    return value;
}
exports.num = num;
function bool(values, key, fallback = false) {
    const value = values[key];
    if (typeof value === "boolean")
        return value;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return fallback;
}
exports.bool = bool;
function required(values, key, label) {
    const value = str(values, key).trim();
    if (!value)
        throw new ToolInputError(`${label} is required.`);
    return value;
}
exports.required = required;
function fmtNumber(value, digits = 0) {
    return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
exports.fmtNumber = fmtNumber;
function fmtBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
exports.fmtBytes = fmtBytes;
function fmtUsd(value) {
    if (value === 0)
        return "$0";
    if (value < 0.01)
        return `$${value.toFixed(5)}`;
    if (value < 100)
        return `$${value.toFixed(2)}`;
    return `$${Math.round(value).toLocaleString("en-US")}`;
}
exports.fmtUsd = fmtUsd;
//# sourceMappingURL=types.js.map