"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = exports.pct = exports.counts = exports.severityMessages = exports.f = exports.opts = exports.table = exports.text = exports.code = void 0;
/** Small builders that keep tool definitions short and consistent. */
const code = (title, language, content, fileName) => ({ kind: "code", title, language, content, ...(fileName ? { fileName } : {}) });
exports.code = code;
const text = (title, content) => ({ kind: "text", title, content });
exports.text = text;
const table = (title, columns, rows) => ({ kind: "table", title, columns, rows });
exports.table = table;
const opts = (...values) => values.map(v => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));
exports.opts = opts;
exports.f = {
    text: (id, label, extra = {}) => ({ id, label, kind: "text", ...extra }),
    area: (id, label, extra = {}) => ({ id, label, kind: "textarea", rows: 6, ...extra }),
    code: (id, label, language, extra = {}) => ({ id, label, kind: "code", language, rows: 10, ...extra }),
    num: (id, label, def, extra = {}) => ({ id, label, kind: "number", default: def, width: "narrow", ...extra }),
    select: (id, label, options, extra = {}) => ({ id, label, kind: "select", options, default: options[0]?.value, width: "narrow", ...extra }),
    toggle: (id, label, def, extra = {}) => ({ id, label, kind: "toggle", default: def, width: "narrow", ...extra }),
    secret: (id, label, extra = {}) => ({ id, label, kind: "secret", ...extra })
};
function severityMessages(items, okText) {
    if (!items.length)
        return [{ kind: "success", text: okText }];
    const order = { error: 0, warning: 1, info: 2 };
    return items.slice().sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0)).map(i => ({
        kind: i.severity,
        text: `${i.line ? `Line ${i.line}: ` : ""}${i.message}`
    }));
}
exports.severityMessages = severityMessages;
function counts(items) {
    const n = (s) => items.filter(i => i.severity === s).length;
    return [
        { label: "Errors", value: String(n("error")), tone: n("error") ? "bad" : "good" },
        { label: "Warnings", value: String(n("warning")), tone: n("warning") ? "warn" : "good" },
        { label: "Suggestions", value: String(n("info")), tone: "neutral" }
    ];
}
exports.counts = counts;
const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;
exports.pct = pct;
const list = (value) => value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
exports.list = list;
//# sourceMappingURL=helpers.js.map