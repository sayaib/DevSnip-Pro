/**
 * What the cloud document stores (DynamoDB, Cosmos DB, Firestore) share:
 * the editor's whole-document JSON, field inference from a sample, and
 * console results. MongoDB keeps its own (Extended JSON, shell syntax).
 */

import { CellInput, ColumnInfo, DbError, QueryResult, Row, ValueCategory } from "../types";
import { encodeRow, since } from "../values";
import { DOCUMENT_FIELD } from "./mongodb";

export { DOCUMENT_FIELD };

/** The document the editor sent, as strict JSON. */
export function parseJsonDocument(values: Record<string, CellInput>): Record<string, unknown> {
  const input = values?.[DOCUMENT_FIELD];
  if (!input || input.mode !== "value") throw new DbError("No document was sent.");
  let doc: unknown;
  try {
    doc = JSON.parse(String(input.value ?? ""));
  } catch (error) {
    throw new DbError(`The document is not valid JSON: ${(error as Error).message}`, "Use double-quoted keys and strings.");
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new DbError("A document must be a JSON object: { ... }.");
  return doc as Record<string, unknown>;
}

export function categoryOfTypes(types: string[]): ValueCategory {
  const real = types.filter(t => t !== "null");
  if (!real.length) return "other";
  if (real.every(t => t === "number")) return "number";
  if (real.every(t => t === "boolean")) return "boolean";
  if (real.every(t => t === "timestamp")) return "date";
  if (real.every(t => t === "binary")) return "binary";
  if (real.every(t => t === "string")) return "text";
  return "json";
}

/**
 * Fields seen in a sample, keys first, then by how often they appear.
 * `typeOf` names a value's type in the store's own terms; its category comes from `kindOf`.
 */
export function inferColumns(docs: Row[], keys: Array<{ name: string; type: string }>, typeOf: (value: unknown) => string, kindOf: (type: string) => string = t => t): ColumnInfo[] {
  const stats = new Map<string, { count: number; types: Set<string> }>();
  for (const doc of docs) {
    for (const [field, value] of Object.entries(doc)) {
      const entry = stats.get(field) ?? { count: 0, types: new Set<string>() };
      entry.count++;
      entry.types.add(typeOf(value));
      stats.set(field, entry);
    }
  }
  const keyNames = keys.map(k => k.name);
  const columns: ColumnInfo[] = keys.map(k => ({
    name: k.name, dataType: k.type, category: categoryOfTypes([kindOf(k.type)]), nullable: false, primaryKey: true, autoIncrement: false, editable: true, sortable: false, presence: 1
  }));
  for (const [name, s] of stats) {
    if (keyNames.includes(name)) continue;
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

/** A console result listing documents, with the union of their fields as columns. */
export function documentsResult(start: number, docs: Row[], truncated: boolean, message?: string, affected?: number): QueryResult {
  const rows = docs.map(d => (d && typeof d === "object" && !Array.isArray(d) ? encodeRow(d) : { value: encodeRow({ v: d }).v }));
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  return { columns, rows, truncated, message, affected, elapsedMs: since(start) };
}

/** Splits console text on top-level semicolons, keeping quoted text intact. */
export function splitStatements(text: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  let start = 0;
  let quote = "";
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = text[i + 1] === quote ? (i++, quote) : "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "-" && text[i + 1] === "-") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (ch === ";" || i === text.length) {
      const piece = text.slice(start, i);
      const trimmed = piece.replace(/^(\s|--[^\n]*\n?)+/, "");
      if (trimmed.trim()) out.push({ text: trimmed.trim(), offset: start + piece.length - trimmed.length });
      start = i + 1;
    }
  }
  return out;
}
