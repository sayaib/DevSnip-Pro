"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformRows = exports.compileFilter = exports.markdownTable = exports.unflatten = exports.flatten = exports.jsonStats = exports.sortKeysDeep = exports.parseRecords = exports.parseJsonl = exports.parseJsonStrict = exports.collectColumns = exports.rowsToCsv = exports.csvToRows = exports.inferValue = exports.parseCsv = exports.detectDelimiter = void 0;
const types_1 = require("../types");
const llm_output_1 = require("./llm-output");
// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
    const candidates = [",", ";", "\t", "|"];
    let best = ",";
    let bestScore = -1;
    for (const delimiter of candidates) {
        const counts = sample.split("\n").filter(Boolean).map(line => countOutsideQuotes(line, delimiter));
        if (!counts.length || counts[0] === 0)
            continue;
        const consistent = counts.filter(c => c === counts[0]).length / counts.length;
        const score = counts[0] * consistent;
        if (score > bestScore) {
            best = delimiter;
            bestScore = score;
        }
    }
    return best;
}
exports.detectDelimiter = detectDelimiter;
function countOutsideQuotes(line, delimiter) {
    let count = 0;
    let quoted = false;
    for (const ch of line) {
        if (ch === "\"")
            quoted = !quoted;
        else if (ch === delimiter && !quoted)
            count++;
    }
    return count;
}
/** RFC 4180 parser: quoted fields, escaped quotes, embedded delimiters and line breaks. */
function parseCsv(text, delimiter = detectDelimiter(text)) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let i = 0;
    const input = text.replace(/^﻿/, "");
    while (i < input.length) {
        const ch = input[i];
        if (quoted) {
            if (ch === "\"") {
                if (input[i + 1] === "\"") {
                    cell += "\"";
                    i += 2;
                    continue;
                }
                quoted = false;
                i++;
                continue;
            }
            cell += ch;
            i++;
            continue;
        }
        if (ch === "\"" && cell === "") {
            quoted = true;
            i++;
            continue;
        }
        if (ch === delimiter) {
            row.push(cell);
            cell = "";
            i++;
            continue;
        }
        if (ch === "\n" || ch === "\r") {
            row.push(cell);
            if (row.length > 1 || row[0] !== "")
                rows.push(row);
            row = [];
            cell = "";
            i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
            continue;
        }
        cell += ch;
        i++;
    }
    if (quoted)
        throw new types_1.ToolInputError("The CSV has an unterminated quoted field.");
    row.push(cell);
    if (row.length > 1 || row[0] !== "")
        rows.push(row);
    return rows;
}
exports.parseCsv = parseCsv;
function inferValue(raw) {
    const value = raw.trim();
    if (value === "")
        return null;
    if (/^(true|false)$/i.test(value))
        return value.toLowerCase() === "true";
    if (/^null$/i.test(value))
        return null;
    // Keep leading-zero codes (ZIP codes, ids) and long digit strings as text.
    if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(value))
        return Number(value);
    return raw;
}
exports.inferValue = inferValue;
function csvToRows(text, options) {
    if (!text.trim())
        throw new types_1.ToolInputError("Paste CSV data first.");
    const delimiter = options.delimiter || detectDelimiter(text);
    const table = parseCsv(text, delimiter);
    if (!table.length)
        throw new types_1.ToolInputError("No rows found.");
    const width = Math.max(...table.map(r => r.length));
    let columns = options.header ? table[0].map((h, i) => h.trim() || `column_${i + 1}`) : Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    // Make duplicate headers unique.
    const seen = new Map();
    columns = columns.map(c => {
        const n = seen.get(c) ?? 0;
        seen.set(c, n + 1);
        return n ? `${c}_${n + 1}` : c;
    });
    while (columns.length < width)
        columns.push(`column_${columns.length + 1}`);
    const body = options.header ? table.slice(1) : table;
    const rows = body.map(cells => Object.fromEntries(columns.map((c, i) => [c, options.inferTypes ? inferValue(cells[i] ?? "") : (cells[i] ?? "")])));
    return { rows, columns, delimiter };
}
exports.csvToRows = csvToRows;
function csvCell(value, delimiter) {
    if (value === null || value === undefined)
        return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /["\r\n]/.test(text) || text.includes(delimiter) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}
function rowsToCsv(rows, delimiter = ",") {
    const columns = collectColumns(rows);
    return [columns.map(c => csvCell(c, delimiter)).join(delimiter), ...rows.map(r => columns.map(c => csvCell(r[c], delimiter)).join(delimiter))].join("\n") + "\n";
}
exports.rowsToCsv = rowsToCsv;
function collectColumns(rows) {
    const columns = [];
    const seen = new Set();
    for (const row of rows)
        for (const key of Object.keys(row))
            if (!seen.has(key)) {
                seen.add(key);
                columns.push(key);
            }
    return columns;
}
exports.collectColumns = collectColumns;
// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------
function parseJsonStrict(text, label = "JSON") {
    if (!text.trim())
        throw new types_1.ToolInputError(`Paste ${label} first.`);
    try {
        return JSON.parse(text);
    }
    catch (error) {
        const d = (0, llm_output_1.describeJsonError)(text, error);
        throw new types_1.ToolInputError(`${label} is invalid at line ${d.line}, column ${d.column}: ${d.message}\n${d.excerpt}`);
    }
}
exports.parseJsonStrict = parseJsonStrict;
function parseJsonl(text) {
    const rows = [];
    const errors = [];
    text.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim())
            return;
        try {
            rows.push(JSON.parse(line));
        }
        catch (error) {
            errors.push({ line: index + 1, message: (0, llm_output_1.describeJsonError)(line, error).message });
        }
    });
    return { rows, errors };
}
exports.parseJsonl = parseJsonl;
/** Accepts a JSON array, a single object, or JSON Lines. */
function parseRecords(text) {
    const trimmed = text.trim();
    if (!trimmed)
        throw new types_1.ToolInputError("Paste JSON or JSON Lines first.");
    if (trimmed.startsWith("[") || (trimmed.startsWith("{") && !/}\s*\n\s*{/.test(trimmed))) {
        const value = parseJsonStrict(trimmed);
        const list = Array.isArray(value) ? value : [value];
        return list.map(v => (v && typeof v === "object" && !Array.isArray(v) ? v : { value: v }));
    }
    const { rows, errors } = parseJsonl(trimmed);
    if (errors.length)
        throw new types_1.ToolInputError(`JSON Lines error on line ${errors[0].line}: ${errors[0].message}`);
    return rows.map(v => (v && typeof v === "object" && !Array.isArray(v) ? v : { value: v }));
}
exports.parseRecords = parseRecords;
function sortKeysDeep(value) {
    if (Array.isArray(value))
        return value.map(sortKeysDeep);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeysDeep(value[k])]));
    }
    return value;
}
exports.sortKeysDeep = sortKeysDeep;
function jsonStats(value) {
    const stats = { depth: 0, objects: 0, arrays: 0, keys: 0, values: 0 };
    const walk = (v, depth) => {
        stats.depth = Math.max(stats.depth, depth);
        if (Array.isArray(v)) {
            stats.arrays++;
            v.forEach(x => walk(x, depth + 1));
        }
        else if (v && typeof v === "object") {
            stats.objects++;
            for (const [, x] of Object.entries(v)) {
                stats.keys++;
                walk(x, depth + 1);
            }
        }
        else
            stats.values++;
    };
    walk(value, 0);
    return stats;
}
exports.jsonStats = jsonStats;
function flatten(value, prefix = "", out = {}) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value);
        if (!entries.length && prefix)
            out[prefix] = {};
        for (const [key, v] of entries)
            flatten(v, prefix ? `${prefix}.${key}` : key, out);
    }
    else if (Array.isArray(value) && value.some(v => v && typeof v === "object")) {
        if (!value.length && prefix)
            out[prefix] = [];
        value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    }
    else {
        out[prefix || "value"] = value;
    }
    return out;
}
exports.flatten = flatten;
function unflatten(row) {
    const out = {};
    for (const [path, value] of Object.entries(row)) {
        const parts = path.split(/\.|\[(\d+)\]/).filter(p => p !== undefined && p !== "");
        let cursor = out;
        parts.forEach((part, index) => {
            const last = index === parts.length - 1;
            const nextIsIndex = !last && /^\d+$/.test(parts[index + 1]);
            if (last)
                cursor[part] = value;
            else {
                if (cursor[part] === undefined)
                    cursor[part] = nextIsIndex ? [] : {};
                cursor = cursor[part];
            }
        });
    }
    return out;
}
exports.unflatten = unflatten;
function markdownTable(rows, align = "left") {
    const columns = collectColumns(rows);
    if (!columns.length)
        throw new types_1.ToolInputError("There is nothing to put in a table.");
    const cell = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
    const numeric = columns.map(c => rows.every(r => r[c] === null || r[c] === undefined || typeof r[c] === "number"));
    const rule = columns.map((_c, i) => (numeric[i] || align === "right" ? "---:" : align === "center" ? ":---:" : "---"));
    return [`| ${columns.map(cell).join(" | ")} |`, `| ${rule.join(" | ")} |`, ...rows.map(r => `| ${columns.map(c => cell(r[c])).join(" | ")} |`)].join("\n") + "\n";
}
exports.markdownTable = markdownTable;
// ---------------------------------------------------------------------------
// Transform pipeline
// ---------------------------------------------------------------------------
function readField(row, path) {
    if (path in row)
        return row[path];
    return path.split(".").reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), row);
}
function parseLiteral(raw) {
    const text = raw.trim();
    if (/^".*"$|^'.*'$/.test(text))
        return text.slice(1, -1);
    if (text === "null")
        return null;
    if (text === "true" || text === "false")
        return text === "true";
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? n : text;
}
function compileFilter(expression) {
    const clauses = expression.split(/\s+(and|or)\s+/i);
    const tests = [];
    const joins = [];
    clauses.forEach((clause, index) => {
        if (index % 2 === 1) {
            joins.push(clause.toLowerCase());
            return;
        }
        const match = /^\s*([\w.$-]+)\s*(==|!=|>=|<=|>|<|contains|startsWith|endsWith|exists|missing)\s*(.*)$/i.exec(clause);
        if (!match)
            throw new types_1.ToolInputError(`Could not read filter "${clause}". Examples: age >= 18, status == "active", name contains "ann", email exists`);
        const [, field, opRaw, rawValue] = match;
        const op = opRaw.toLowerCase();
        const expected = parseLiteral(rawValue);
        tests.push(row => {
            const actual = readField(row, field);
            switch (op) {
                case "==": return actual === expected || String(actual) === String(expected);
                case "!=": return !(actual === expected || String(actual) === String(expected));
                case ">": return Number(actual) > Number(expected);
                case "<": return Number(actual) < Number(expected);
                case ">=": return Number(actual) >= Number(expected);
                case "<=": return Number(actual) <= Number(expected);
                case "contains": return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
                case "startswith": return String(actual ?? "").startsWith(String(expected));
                case "endswith": return String(actual ?? "").endsWith(String(expected));
                case "exists": return actual !== undefined && actual !== null && actual !== "";
                case "missing": return actual === undefined || actual === null || actual === "";
                default: return false;
            }
        });
    });
    return row => {
        let result = tests[0](row);
        for (let i = 1; i < tests.length; i++)
            result = joins[i - 1] === "or" ? result || tests[i](row) : result && tests[i](row);
        return result;
    };
}
exports.compileFilter = compileFilter;
const list = (text) => (text || "").split(",").map(s => s.trim()).filter(Boolean);
function transformRows(input, steps) {
    let rows = input.slice();
    const log = [`${rows.length} input rows`];
    if (steps.flatten) {
        rows = rows.map(r => flatten(r));
        log.push("flattened nested objects");
    }
    if (steps.filter?.trim()) {
        const test = compileFilter(steps.filter);
        const before = rows.length;
        rows = rows.filter(test);
        log.push(`filter kept ${rows.length} of ${before}`);
    }
    if (steps.dedupeBy?.trim()) {
        const fields = list(steps.dedupeBy);
        const seen = new Set();
        const before = rows.length;
        rows = rows.filter(r => {
            const key = JSON.stringify(fields.map(f => readField(r, f)));
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        log.push(`removed ${before - rows.length} duplicates by ${fields.join(", ")}`);
    }
    if (steps.sortBy?.trim()) {
        const specs = list(steps.sortBy).map(s => {
            const [field, dir] = s.split(/\s+/);
            return { field, desc: /^desc$/i.test(dir || "") };
        });
        rows.sort((a, b) => {
            for (const { field, desc } of specs) {
                const x = readField(a, field);
                const y = readField(b, field);
                if (x === y)
                    continue;
                if (x === undefined || x === null)
                    return 1;
                if (y === undefined || y === null)
                    return -1;
                const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
                if (cmp)
                    return desc ? -cmp : cmp;
            }
            return 0;
        });
        log.push(`sorted by ${steps.sortBy}`);
    }
    if (steps.pick?.trim()) {
        const fields = list(steps.pick);
        rows = rows.map(r => Object.fromEntries(fields.map(f => [f, readField(r, f)])));
        log.push(`kept fields ${fields.join(", ")}`);
    }
    if (steps.omit?.trim()) {
        const fields = new Set(list(steps.omit));
        rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !fields.has(k))));
        log.push(`removed fields ${[...fields].join(", ")}`);
    }
    if (steps.rename?.trim()) {
        const pairs = list(steps.rename).map(p => {
            const [from, to] = p.split(/\s*(?::|->|=>)\s*/);
            if (!from || !to)
                throw new types_1.ToolInputError(`Rename "${p}" must look like old:new`);
            return [from, to];
        });
        rows = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [pairs.find(([from]) => from === k)?.[1] ?? k, v])));
        log.push(`renamed ${pairs.map(([a, b]) => `${a} → ${b}`).join(", ")}`);
    }
    if (steps.limit !== undefined && steps.limit > 0 && rows.length > steps.limit) {
        rows = rows.slice(0, steps.limit);
        log.push(`limited to ${steps.limit} rows`);
    }
    log.push(`${rows.length} output rows`);
    return { rows, log };
}
exports.transformRows = transformRows;
//# sourceMappingURL=data-convert.js.map