"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockSpecFromExample = exports.generateMock = exports.MOCK_TYPES = exports.parseMockSpec = exports.diffLines = exports.diffValues = exports.inspectApiResponse = exports.profileRows = void 0;
const types_1 = require("../types");
const data_convert_1 = require("./data-convert");
function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}
function profileRows(input) {
    if (!input.length)
        throw new types_1.ToolInputError("There are no rows to profile.");
    const rows = input.map(r => (0, data_convert_1.flatten)(r));
    const names = (0, data_convert_1.collectColumns)(rows);
    const notes = [];
    const columns = names.map(name => {
        const values = rows.map(r => r[name]);
        const present = values.filter(v => v !== null && v !== undefined && v !== "");
        const missing = values.length - present.length;
        const numeric = present.length > 0 && present.every(v => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)));
        const counts = new Map();
        for (const v of present)
            counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c]) => `${v.length > 24 ? v.slice(0, 24) + "…" : v} (${c})`).join(", ");
        const profile = { name, type: numeric ? "number" : present.every(v => typeof v === "boolean") && present.length ? "boolean" : present.length ? "text" : "empty", missing, distinct: counts.size, top };
        if (numeric) {
            const nums = present.map(Number).sort((a, b) => a - b);
            profile.min = nums[0];
            profile.max = nums[nums.length - 1];
            profile.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
            if (nums.length >= 8) {
                const q1 = quantile(nums, 0.25);
                const q3 = quantile(nums, 0.75);
                const iqr = q3 - q1;
                profile.outliers = nums.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).length;
                if (profile.outliers)
                    notes.push(`${name}: ${profile.outliers} outlier(s) outside 1.5×IQR [${(q1 - 1.5 * iqr).toFixed(2)}, ${(q3 + 1.5 * iqr).toFixed(2)}]`);
            }
        }
        else if (present.length) {
            const lengths = present.map(v => String(v).length);
            profile.min = Math.min(...lengths) + " chars";
            profile.max = Math.max(...lengths) + " chars";
        }
        if (missing)
            notes.push(`${name}: ${missing} missing (${((100 * missing) / values.length).toFixed(1)}%)`);
        if (counts.size === 1 && present.length > 1)
            notes.push(`${name}: constant value - probably not useful as a feature`);
        if (counts.size === present.length && present.length > 20 && !numeric)
            notes.push(`${name}: every value is unique - likely an identifier`);
        const mixed = new Set(present.map(v => typeof v));
        if (mixed.size > 1)
            notes.push(`${name}: mixed value types (${[...mixed].join(", ")})`);
        return profile;
    });
    const seen = new Set();
    let duplicateRows = 0;
    for (const r of rows) {
        const key = JSON.stringify(r);
        if (seen.has(key))
            duplicateRows++;
        seen.add(key);
    }
    if (duplicateRows)
        notes.unshift(`${duplicateRows} exact duplicate row(s)`);
    return { columns, duplicateRows, notes };
}
exports.profileRows = profileRows;
const STATUS_HINTS = {
    400: "Bad Request - the payload or parameters are invalid; read the error body for the field.",
    401: "Unauthorized - missing or invalid credentials.",
    403: "Forbidden - authenticated but not allowed (scope, role, IP allow-list).",
    404: "Not Found - wrong path, id, or API version.",
    409: "Conflict - the resource changed or already exists; retry with fresh state.",
    422: "Unprocessable - validation failed; the body usually lists the fields.",
    429: "Too Many Requests - back off; honour Retry-After.",
    500: "Server error - retry with backoff if the request is idempotent.",
    502: "Bad Gateway - an upstream failed; usually transient.",
    503: "Service Unavailable - overloaded or in maintenance; retry later.",
    504: "Gateway Timeout - the upstream took too long."
};
function inspectApiResponse(raw) {
    const text = raw.replace(/\r\n/g, "\n").trim();
    if (!text)
        throw new types_1.ToolInputError("Paste an API response (raw HTTP or just the body).");
    let status;
    let statusText;
    const headers = [];
    let bodyText = text;
    const statusLine = /^HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/m.exec(text.split("\n")[0]);
    if (statusLine) {
        status = Number(statusLine[1]);
        statusText = statusLine[2];
        const blank = text.indexOf("\n\n");
        const headerBlock = blank >= 0 ? text.slice(text.indexOf("\n") + 1, blank) : text.slice(text.indexOf("\n") + 1);
        for (const line of headerBlock.split("\n")) {
            const idx = line.indexOf(":");
            if (idx > 0)
                headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
        }
        bodyText = blank >= 0 ? text.slice(blank + 2) : "";
    }
    let body = bodyText;
    let isJson = false;
    try {
        if (bodyText.trim()) {
            body = JSON.parse(bodyText);
            isJson = true;
        }
    }
    catch {
        /* not JSON */
    }
    const header = (name) => headers.find(([k]) => k.toLowerCase() === name)?.[1];
    const insights = [];
    if (status)
        insights.push(`${status} ${statusText || ""}`.trim() + (STATUS_HINTS[status] ? ` - ${STATUS_HINTS[status]}` : status < 300 ? " - success" : ""));
    const contentType = header("content-type");
    if (contentType && isJson && !/json/i.test(contentType))
        insights.push(`Content-Type is "${contentType}" but the body is JSON - clients that trust the header will mis-parse it.`);
    const retryAfter = header("retry-after");
    if (retryAfter)
        insights.push(`Retry-After: ${retryAfter}`);
    const remaining = header("x-ratelimit-remaining") ?? header("ratelimit-remaining");
    if (remaining)
        insights.push(`Rate limit remaining: ${remaining}${header("x-ratelimit-limit") ? ` of ${header("x-ratelimit-limit")}` : ""}`);
    if (header("link")?.includes("rel=\"next\""))
        insights.push("Paginated via the Link header (rel=\"next\").");
    if (isJson && body && typeof body === "object") {
        const record = body;
        const pageKeys = ["next", "next_cursor", "nextCursor", "cursor", "page", "total", "total_count", "has_more", "hasMore", "nextPageToken"].filter(k => k in record || (record.meta && typeof record.meta === "object" && k in record.meta) || (record.pagination && typeof record.pagination === "object" && k in record.pagination));
        if (pageKeys.length)
            insights.push(`Pagination fields: ${pageKeys.join(", ")}`);
        const errorKey = ["error", "errors", "message", "detail", "title", "problem"].find(k => k in record);
        if (errorKey && (status === undefined || status >= 400))
            insights.push(`Error payload under "${errorKey}"${record.type && /problem/.test(String(contentType)) ? " (RFC 9457 problem details)" : ""}.`);
        const arrays = Object.entries(record).filter(([, v]) => Array.isArray(v));
        for (const [k, v] of arrays)
            insights.push(`"${k}" holds ${v.length} item(s).`);
        if (Array.isArray(body))
            insights.push(`Top-level array with ${body.length} item(s).`);
    }
    const fields = [];
    if (isJson) {
        const sample = Array.isArray(body) ? body[0] : body;
        const flat = (0, data_convert_1.flatten)(sample ?? {});
        for (const [path, value] of Object.entries(flat).slice(0, 200)) {
            fields.push({ path: Array.isArray(body) ? `[].${path}` : path, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, example: JSON.stringify(value)?.slice(0, 60) ?? "" });
        }
    }
    return { status, statusText, headers, body, bodyText, isJson, bytes: new TextEncoder().encode(bodyText).length, insights, fields };
}
exports.inspectApiResponse = inspectApiResponse;
function diffValues(left, right, options, path = "$", out = []) {
    const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
    const lt = typeOf(left);
    const rt = typeOf(right);
    if (lt !== rt) {
        out.push({ kind: "type", path, before: left, after: right });
        return out;
    }
    if (lt === "object") {
        const l = left;
        const r = right;
        for (const key of Object.keys(l)) {
            const child = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
            if (!(key in r))
                out.push({ kind: "removed", path: child, before: l[key] });
            else
                diffValues(l[key], r[key], options, child, out);
        }
        for (const key of Object.keys(r)) {
            if (!(key in l))
                out.push({ kind: "added", path: /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`, after: r[key] });
        }
        return out;
    }
    if (lt === "array") {
        const l = left;
        const r = right;
        const key = options.arrayKey;
        if (key && [...l, ...r].every(v => v && typeof v === "object" && key in v)) {
            const lm = new Map(l.map(v => [JSON.stringify(v[key]), v]));
            const rm = new Map(r.map(v => [JSON.stringify(v[key]), v]));
            for (const [k, v] of lm) {
                const child = `${path}[${key}=${k}]`;
                if (!rm.has(k))
                    out.push({ kind: "removed", path: child, before: v });
                else
                    diffValues(v, rm.get(k), options, child, out);
            }
            for (const [k, v] of rm)
                if (!lm.has(k))
                    out.push({ kind: "added", path: `${path}[${key}=${k}]`, after: v });
            return out;
        }
        if (options.ignoreArrayOrder) {
            const remaining = r.map(v => JSON.stringify(v));
            for (const v of l) {
                const idx = remaining.indexOf(JSON.stringify(v));
                if (idx >= 0)
                    remaining.splice(idx, 1);
                else
                    out.push({ kind: "removed", path: `${path}[]`, before: v });
            }
            for (const v of remaining)
                out.push({ kind: "added", path: `${path}[]`, after: JSON.parse(v) });
            return out;
        }
        const n = Math.max(l.length, r.length);
        for (let i = 0; i < n; i++) {
            if (i >= r.length)
                out.push({ kind: "removed", path: `${path}[${i}]`, before: l[i] });
            else if (i >= l.length)
                out.push({ kind: "added", path: `${path}[${i}]`, after: r[i] });
            else
                diffValues(l[i], r[i], options, `${path}[${i}]`, out);
        }
        return out;
    }
    if (left !== right)
        out.push({ kind: "changed", path, before: left, after: right });
    return out;
}
exports.diffValues = diffValues;
/** Line diff (LCS) rendered in unified style. */
function diffLines(left, right) {
    const a = left.replace(/\r\n/g, "\n").split("\n");
    const b = right.replace(/\r\n/g, "\n").split("\n");
    if (a.length * b.length > 4000000)
        throw new types_1.ToolInputError("The inputs are too large for a line diff here (over ~2,000 × 2,000 lines).");
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const lines = [];
    let i = 0, j = 0, added = 0, removed = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            lines.push(`  ${a[i]}`);
            i++;
            j++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1]) {
            lines.push(`- ${a[i++]}`);
            removed++;
        }
        else {
            lines.push(`+ ${b[j++]}`);
            added++;
        }
    }
    while (i < a.length) {
        lines.push(`- ${a[i++]}`);
        removed++;
    }
    while (j < b.length) {
        lines.push(`+ ${b[j++]}`);
        added++;
    }
    return { text: lines.join("\n"), added, removed };
}
exports.diffLines = diffLines;
// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const FIRST = ["Ava", "Liam", "Noah", "Emma", "Mia", "Lucas", "Sofia", "Arjun", "Yuki", "Chen", "Fatima", "Mateo", "Zoe", "Omar", "Leila", "Ivan", "Priya", "Kofi", "Hana", "Diego"];
const LAST = ["Smith", "Garcia", "Chen", "Patel", "Kim", "Müller", "Rossi", "Silva", "Nguyen", "Okafor", "Novak", "Tanaka", "Haddad", "Johansson", "Kowalski", "Dubois", "Ali", "Lopez", "Brown", "Singh"];
const COMPANIES = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay", "Soylent", "Tyrell"];
const CITIES = ["Berlin", "Lisbon", "Toronto", "Austin", "Singapore", "Nairobi", "Osaka", "Madrid", "Sydney", "Oslo"];
const COUNTRIES = ["DE", "PT", "CA", "US", "SG", "KE", "JP", "ES", "AU", "NO"];
const WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation".split(" ");
const STATUSES = ["active", "pending", "suspended", "closed"];
function parseMockSpec(spec) {
    const fields = spec.split(/\r?\n|,(?![^(]*\))/).map(s => s.trim()).filter(Boolean).map(line => {
        const match = /^([\w.-]+)\s*:\s*([a-z_]+)(?:\(([^)]*)\))?$/i.exec(line);
        if (!match)
            throw new types_1.ToolInputError(`Could not read "${line}". Use name: type or name: type(args), e.g. age: int(18, 90)`);
        return { name: match[1], type: match[2].toLowerCase(), args: match[3] ? match[3].split(/\s*[,|]\s*/).filter(Boolean) : [] };
    });
    if (!fields.length)
        throw new types_1.ToolInputError("Add at least one field.");
    const known = new Set(exports.MOCK_TYPES.map(t => t.type));
    for (const f of fields)
        if (!known.has(f.type))
            throw new types_1.ToolInputError(`Unknown type "${f.type}" for ${f.name}. Available: ${[...known].join(", ")}`);
    return fields;
}
exports.parseMockSpec = parseMockSpec;
exports.MOCK_TYPES = [
    { type: "id", example: "id: id" }, { type: "uuid", example: "uuid: uuid" }, { type: "int", example: "age: int(18, 90)" },
    { type: "float", example: "score: float(0, 1, 3)" }, { type: "price", example: "price: price(5, 500)" }, { type: "bool", example: "active: bool" },
    { type: "first_name", example: "first: first_name" }, { type: "last_name", example: "last: last_name" }, { type: "name", example: "name: name" },
    { type: "email", example: "email: email" }, { type: "phone", example: "phone: phone" }, { type: "company", example: "company: company" },
    { type: "city", example: "city: city" }, { type: "country", example: "country: country" }, { type: "url", example: "site: url" },
    { type: "ip", example: "ip: ip" }, { type: "date", example: "joined: date(2023-01-01, 2025-12-31)" }, { type: "datetime", example: "created_at: datetime" },
    { type: "word", example: "tag: word" }, { type: "sentence", example: "title: sentence" }, { type: "paragraph", example: "body: paragraph" },
    { type: "enum", example: "plan: enum(free|pro|team)" }, { type: "status", example: "status: status" }, { type: "color", example: "color: color" }
];
function generateMock(fields, count, seed) {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
    const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
    const rows = [];
    for (let i = 0; i < count; i++) {
        const row = {};
        const first = pick(FIRST);
        const last = pick(LAST);
        for (const f of fields) {
            const [a, b, c] = f.args;
            switch (f.type) {
                case "id":
                    row[f.name] = i + 1;
                    break;
                case "uuid":
                    row[f.name] = `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[int(0, 3)]}${hex(3)}-${hex(12)}`;
                    break;
                case "int":
                    row[f.name] = int(Number(a ?? 0), Number(b ?? 1000));
                    break;
                case "float": {
                    const min = Number(a ?? 0), max = Number(b ?? 1), d = Number(c ?? 2);
                    row[f.name] = Number((min + rand() * (max - min)).toFixed(d));
                    break;
                }
                case "price":
                    row[f.name] = Number((Number(a ?? 1) + rand() * (Number(b ?? 100) - Number(a ?? 1))).toFixed(2));
                    break;
                case "bool":
                    row[f.name] = rand() < Number(a ?? 0.5);
                    break;
                case "first_name":
                    row[f.name] = first;
                    break;
                case "last_name":
                    row[f.name] = last;
                    break;
                case "name":
                    row[f.name] = `${first} ${last}`;
                    break;
                case "email":
                    row[f.name] = `${first}.${last}${int(1, 99)}@example.com`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
                    break;
                case "phone":
                    row[f.name] = `+1-555-${String(int(100, 999))}-${String(int(1000, 9999))}`;
                    break;
                case "company":
                    row[f.name] = `${pick(COMPANIES)} ${pick(["Inc", "Ltd", "GmbH", "Labs", "Group"])}`;
                    break;
                case "city":
                    row[f.name] = pick(CITIES);
                    break;
                case "country":
                    row[f.name] = pick(COUNTRIES);
                    break;
                case "url":
                    row[f.name] = `https://${pick(COMPANIES).toLowerCase()}.example.com/${pick(WORDS)}`;
                    break;
                case "ip":
                    row[f.name] = `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`;
                    break;
                case "date":
                case "datetime": {
                    const from = Date.parse(a ?? "2023-01-01T00:00:00Z");
                    const to = Date.parse(b ?? "2025-12-31T23:59:59Z");
                    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
                        throw new types_1.ToolInputError(`${f.name}: dates must look like 2024-01-31 and the range must be increasing.`);
                    const d = new Date(from + rand() * (to - from));
                    row[f.name] = f.type === "date" ? d.toISOString().slice(0, 10) : d.toISOString().replace(/\.\d+Z$/, "Z");
                    break;
                }
                case "word":
                    row[f.name] = pick(WORDS);
                    break;
                case "sentence": {
                    const s = Array.from({ length: int(5, 11) }, () => pick(WORDS)).join(" ");
                    row[f.name] = s.charAt(0).toUpperCase() + s.slice(1) + ".";
                    break;
                }
                case "paragraph":
                    row[f.name] = Array.from({ length: int(3, 5) }, () => { const s = Array.from({ length: int(6, 12) }, () => pick(WORDS)).join(" "); return s.charAt(0).toUpperCase() + s.slice(1) + "."; }).join(" ");
                    break;
                case "enum":
                    if (!f.args.length)
                        throw new types_1.ToolInputError(`${f.name}: enum needs values, e.g. enum(free|pro)`);
                    row[f.name] = pick(f.args);
                    break;
                case "status":
                    row[f.name] = pick(STATUSES);
                    break;
                case "color":
                    row[f.name] = `#${hex(6)}`;
                    break;
            }
        }
        rows.push(row);
    }
    return rows;
}
exports.generateMock = generateMock;
/** Mock spec inferred from an example object: field names and value shapes guide the generator. */
function mockSpecFromExample(example) {
    return Object.entries(example).map(([key, value]) => {
        const k = key.toLowerCase();
        let type = "word";
        if (k === "id" || /_id$|Id$/.test(key))
            type = typeof value === "number" ? "id" : "uuid";
        else if (/email/.test(k))
            type = "email";
        else if (/phone/.test(k))
            type = "phone";
        else if (/first.?name/.test(k))
            type = "first_name";
        else if (/last.?name|surname/.test(k))
            type = "last_name";
        else if (/name/.test(k))
            type = "name";
        else if (/company|org/.test(k))
            type = "company";
        else if (/city/.test(k))
            type = "city";
        else if (/country/.test(k))
            type = "country";
        else if (/url|website|link/.test(k))
            type = "url";
        else if (/status/.test(k))
            type = "status";
        else if (typeof value === "boolean")
            type = "bool";
        else if (typeof value === "number")
            type = Number.isInteger(value) ? `int(0, ${Math.max(10, Math.abs(value) * 10)})` : "float(0, 100, 2)";
        else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
            type = "datetime";
        else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
            type = "date";
        else if (typeof value === "string" && value.split(" ").length > 6)
            type = "sentence";
        return `${key}: ${type}`;
    }).join("\n");
}
exports.mockSpecFromExample = mockSpecFromExample;
//# sourceMappingURL=data-inspect.js.map