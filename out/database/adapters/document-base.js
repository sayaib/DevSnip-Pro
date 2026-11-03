"use strict";
/**
 * What the cloud document stores (DynamoDB, Cosmos DB, Firestore) share:
 * the editor's whole-document JSON, field inference from a sample, and
 * console results. MongoDB keeps its own (Extended JSON, shell syntax).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitStatements = exports.documentsResult = exports.inferColumns = exports.categoryOfTypes = exports.parseJsonDocument = exports.DOCUMENT_FIELD = void 0;
const types_1 = require("../types");
const values_1 = require("../values");
const mongodb_1 = require("./mongodb");
Object.defineProperty(exports, "DOCUMENT_FIELD", { enumerable: true, get: function () { return mongodb_1.DOCUMENT_FIELD; } });
/** The document the editor sent, as strict JSON. */
function parseJsonDocument(values) {
    const input = values?.[mongodb_1.DOCUMENT_FIELD];
    if (!input || input.mode !== "value")
        throw new types_1.DbError("No document was sent.");
    let doc;
    try {
        doc = JSON.parse(String(input.value ?? ""));
    }
    catch (error) {
        throw new types_1.DbError(`The document is not valid JSON: ${error.message}`, "Use double-quoted keys and strings.");
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc))
        throw new types_1.DbError("A document must be a JSON object: { ... }.");
    return doc;
}
exports.parseJsonDocument = parseJsonDocument;
function categoryOfTypes(types) {
    const real = types.filter(t => t !== "null");
    if (!real.length)
        return "other";
    if (real.every(t => t === "number"))
        return "number";
    if (real.every(t => t === "boolean"))
        return "boolean";
    if (real.every(t => t === "timestamp"))
        return "date";
    if (real.every(t => t === "binary"))
        return "binary";
    if (real.every(t => t === "string"))
        return "text";
    return "json";
}
exports.categoryOfTypes = categoryOfTypes;
/**
 * Fields seen in a sample, keys first, then by how often they appear.
 * `typeOf` names a value's type in the store's own terms; its category comes from `kindOf`.
 */
function inferColumns(docs, keys, typeOf, kindOf = t => t) {
    const stats = new Map();
    for (const doc of docs) {
        for (const [field, value] of Object.entries(doc)) {
            const entry = stats.get(field) ?? { count: 0, types: new Set() };
            entry.count++;
            entry.types.add(typeOf(value));
            stats.set(field, entry);
        }
    }
    const keyNames = keys.map(k => k.name);
    const columns = keys.map(k => ({
        name: k.name, dataType: k.type, category: categoryOfTypes([kindOf(k.type)]), nullable: false, primaryKey: true, autoIncrement: false, editable: true, sortable: false, presence: 1
    }));
    for (const [name, s] of stats) {
        if (keyNames.includes(name))
            continue;
        const types = [...s.types];
        columns.push({
            name,
            dataType: types.join(" | "),
            category: categoryOfTypes(types.map(kindOf)),
            nullable: true,
            primaryKey: false,
            autoIncrement: false,
            editable: true,
            sortable: false,
            presence: docs.length ? s.count / docs.length : 0
        });
    }
    const head = columns.slice(0, keys.length);
    // Stable sort: ties keep the order fields appear in documents.
    return [...head, ...columns.slice(keys.length).sort((a, b) => (b.presence ?? 0) - (a.presence ?? 0))];
}
exports.inferColumns = inferColumns;
/** A console result listing documents, with the union of their fields as columns. */
function documentsResult(start, docs, truncated, message, affected) {
    const rows = docs.map(d => (d && typeof d === "object" && !Array.isArray(d) ? (0, values_1.encodeRow)(d) : { value: (0, values_1.encodeRow)({ v: d }).v }));
    const columns = [];
    for (const row of rows)
        for (const key of Object.keys(row))
            if (!columns.includes(key))
                columns.push(key);
    return { columns, rows, truncated, message, affected, elapsedMs: (0, values_1.since)(start) };
}
exports.documentsResult = documentsResult;
/** Splits console text on top-level semicolons, keeping quoted text intact. */
function splitStatements(text) {
    const out = [];
    let start = 0;
    let quote = "";
    for (let i = 0; i <= text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote)
                quote = text[i + 1] === quote ? (i++, quote) : "";
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
        }
        if (ch === "-" && text[i + 1] === "-") {
            while (i < text.length && text[i] !== "\n")
                i++;
            continue;
        }
        if (ch === ";" || i === text.length) {
            const piece = text.slice(start, i);
            const trimmed = piece.replace(/^(\s|--[^\n]*\n?)+/, "");
            if (trimmed.trim())
                out.push({ text: trimmed.trim(), offset: start + piece.length - trimmed.length });
            start = i + 1;
        }
    }
    return out;
}
exports.splitStatements = splitStatements;
//# sourceMappingURL=document-base.js.map