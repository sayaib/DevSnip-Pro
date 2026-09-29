"use strict";
/**
 * JSON → TOON (Token-Oriented Object Notation) encoder.
 *
 * TOON keeps JSON's data model but drops most punctuation: objects are
 * indented `key: value` lines, arrays declare their length (`tags[3]: a,b,c`),
 * and arrays of uniform objects become a table with the field names stated
 * once (`users[2]{id,name}:` followed by one row per object). That table form
 * is where the token savings come from, so LLM prompts carrying lists of
 * records shrink by 30-60%.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeToon = exports.quoteString = void 0;
const isPrimitive = (v) => v === null || ["boolean", "number", "string"].includes(typeof v);
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function formatNumber(n) {
    if (!Number.isFinite(n))
        return "null";
    if (Object.is(n, -0))
        return "0";
    return String(n);
}
/** Quotes a string only when it would otherwise be ambiguous. */
function quoteString(value, delimiter) {
    const needs = value === "" ||
        value !== value.trim() ||
        /^(true|false|null)$/.test(value) ||
        /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value) ||
        /^0\d/.test(value) ||
        /[:"\\[\]{}\n\r\t]/.test(value) ||
        value.includes(delimiter) ||
        value.startsWith("-") ||
        value.startsWith("#");
    if (!needs)
        return value;
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}
exports.quoteString = quoteString;
function formatKey(key) {
    return /^[A-Za-z_][\w.]*$/.test(key) ? key : `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function primitive(v, d) {
    if (v === null)
        return "null";
    if (typeof v === "boolean")
        return String(v);
    if (typeof v === "number")
        return formatNumber(v);
    return quoteString(v, d);
}
/** Header marker for the delimiter: nothing for comma, the character otherwise. */
const marker = (d) => (d === "," ? "" : d);
/** Arrays of objects with the same keys and only primitive values → table. */
function tableFields(arr) {
    if (!arr.length || !arr.every(isObject))
        return undefined;
    const keys = Object.keys(arr[0]);
    if (!keys.length)
        return undefined;
    for (const item of arr) {
        const k = Object.keys(item);
        if (k.length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(item, key) && isPrimitive(item[key])))
            return undefined;
    }
    return keys;
}
function encodeToon(value, options) {
    const d = options.delimiter;
    const unit = " ".repeat(options.indent);
    const lines = [];
    const emitArray = (label, arr, depth) => {
        const pad = unit.repeat(depth);
        const n = arr.length;
        if (!n) {
            lines.push(`${pad}${label}[0]:`);
            return;
        }
        if (arr.every(isPrimitive)) {
            lines.push(`${pad}${label}[${n}${marker(d)}]: ${arr.map(v => primitive(v, d)).join(d)}`);
            return;
        }
        const fields = tableFields(arr);
        if (fields) {
            lines.push(`${pad}${label}[${n}${marker(d)}]{${fields.map(formatKey).join(d)}}:`);
            for (const row of arr)
                lines.push(`${pad}${unit}${fields.map(f => primitive(row[f], d)).join(d)}`);
            return;
        }
        lines.push(`${pad}${label}[${n}${marker(d)}]:`);
        for (const item of arr)
            emitListItem(item, depth + 1);
    };
    const emitListItem = (item, depth) => {
        const pad = unit.repeat(depth);
        if (isPrimitive(item)) {
            lines.push(`${pad}- ${primitive(item, d)}`);
            return;
        }
        if (Array.isArray(item)) {
            if (item.every(isPrimitive)) {
                lines.push(`${pad}- [${item.length}${marker(d)}]: ${item.map(v => primitive(v, d)).join(d)}`);
                return;
            }
            lines.push(`${pad}- [${item.length}${marker(d)}]:`);
            for (const inner of item)
                emitListItem(inner, depth + 1);
            return;
        }
        const entries = Object.entries(item);
        if (!entries.length) {
            lines.push(`${pad}-`);
            return;
        }
        // First field shares the "- " line; the rest line up under it.
        const start = lines.length;
        emitEntries(entries, depth + 1);
        lines[start] = `${pad}- ${lines[start].slice(pad.length + unit.length)}`;
    };
    const emitEntries = (entries, depth) => {
        const pad = unit.repeat(depth);
        for (const [key, v] of entries) {
            const k = formatKey(key);
            if (Array.isArray(v))
                emitArray(k, v, depth);
            else if (isObject(v)) {
                lines.push(`${pad}${k}:`);
                emitEntries(Object.entries(v), depth + 1);
            }
            else
                lines.push(`${pad}${k}: ${primitive(v, d)}`);
        }
    };
    const root = value;
    if (Array.isArray(root))
        emitArray("", root, 0);
    else if (isObject(root))
        emitEntries(Object.entries(root), 0);
    else
        lines.push(primitive(root, d));
    return lines.join("\n");
}
exports.encodeToon = encodeToon;
//# sourceMappingURL=toon.js.map