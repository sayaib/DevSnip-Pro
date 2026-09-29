import { FieldOption, FieldSpec, Output, ToolResult } from "../types";

/** Small builders that keep tool definitions short and consistent. */

export const code = (title: string, language: string, content: string, fileName?: string): Output => ({ kind: "code", title, language, content, ...(fileName ? { fileName } : {}) });
export const text = (title: string, content: string): Output => ({ kind: "text", title, content });
export const table = (title: string, columns: string[], rows: Array<Array<string | number>>): Output => ({ kind: "table", title, columns, rows });

export const opts = (...values: Array<string | [string, string]>): FieldOption[] =>
  values.map(v => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));

type Extra = Partial<Omit<FieldSpec, "id" | "label" | "kind">>;
export const f = {
  text: (id: string, label: string, extra: Extra = {}): FieldSpec => ({ id, label, kind: "text", ...extra }),
  area: (id: string, label: string, extra: Extra = {}): FieldSpec => ({ id, label, kind: "textarea", rows: 6, ...extra }),
  code: (id: string, label: string, language: string, extra: Extra = {}): FieldSpec => ({ id, label, kind: "code", language, rows: 10, ...extra }),
  num: (id: string, label: string, def: number, extra: Extra = {}): FieldSpec => ({ id, label, kind: "number", default: def, width: "narrow", ...extra }),
  select: (id: string, label: string, options: FieldOption[], extra: Extra = {}): FieldSpec => ({ id, label, kind: "select", options, default: options[0]?.value, width: "narrow", ...extra }),
  toggle: (id: string, label: string, def: boolean, extra: Extra = {}): FieldSpec => ({ id, label, kind: "toggle", default: def, width: "narrow", ...extra }),
  secret: (id: string, label: string, extra: Extra = {}): FieldSpec => ({ id, label, kind: "secret", ...extra })
};

export function severityMessages(items: Array<{ severity: "error" | "warning" | "info"; message: string; line?: number }>, okText: string): NonNullable<ToolResult["messages"]> {
  if (!items.length) return [{ kind: "success", text: okText }];
  const order = { error: 0, warning: 1, info: 2 };
  return items.slice().sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0)).map(i => ({
    kind: i.severity,
    text: `${i.line ? `Line ${i.line}: ` : ""}${i.message}`
  }));
}

export function counts(items: Array<{ severity: string }>): ToolResult["stats"] {
  const n = (s: string) => items.filter(i => i.severity === s).length;
  return [
    { label: "Errors", value: String(n("error")), tone: n("error") ? "bad" : "good" },
    { label: "Warnings", value: String(n("warning")), tone: n("warning") ? "warn" : "good" },
    { label: "Suggestions", value: String(n("info")), tone: "neutral" }
  ];
}

export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
export const list = (value: string) => value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
