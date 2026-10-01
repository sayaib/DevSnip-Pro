"use strict";
/**
 * Turns driver values into JSON the webview can show and send back.
 *
 * Binary data and oversized text are replaced by a tagged marker
 * (`{ __dbv: ... }`) so the grid can label them and the editor can refuse to
 * overwrite a value it never received in full.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.since = exports.encodeRow = exports.encodeValue = exports.MARKER = void 0;
const types_1 = require("./types");
exports.MARKER = "__dbv";
function isBinary(value) {
    return value instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(value));
}
function encodeValue(value, depth = 0) {
    if (value === null || value === undefined)
        return null;
    switch (typeof value) {
        case "string":
            return value.length > types_1.LIMITS.maxCellChars ? { [exports.MARKER]: "truncated", length: value.length, preview: value.slice(0, 2000) } : value;
        case "number":
            return Number.isFinite(value) ? value : String(value);
        case "boolean":
            return value;
        case "bigint":
            return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
        case "object":
            break;
        default:
            return String(value);
    }
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (isBinary(value)) {
        const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        return { [exports.MARKER]: "binary", size: bytes.length, hex: bytes.subarray(0, 32).toString("hex") };
    }
    if (depth > 20)
        return "[nested too deep]";
    if (Array.isArray(value))
        return value.map(item => encodeValue(item, depth + 1));
    const out = {};
    for (const [key, item] of Object.entries(value))
        out[key] = encodeValue(item, depth + 1);
    return out;
}
exports.encodeValue = encodeValue;
function encodeRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row))
        out[key] = encodeValue(value);
    return out;
}
exports.encodeRow = encodeRow;
/** Elapsed milliseconds since `start`, rounded for display. */
function since(start) {
    return Math.round(Date.now() - start);
}
exports.since = since;
//# sourceMappingURL=values.js.map