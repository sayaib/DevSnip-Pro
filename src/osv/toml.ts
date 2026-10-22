/**
 * A small TOML 1.0 reader for the dependency files the OSV scanner needs:
 * Cargo.lock, Cargo.toml, poetry.lock, uv.lock, pdm.lock, Pipfile and
 * pyproject.toml.
 *
 * It supports tables, arrays of tables, dotted and quoted keys, all four
 * string forms, numbers, booleans, date-times (kept as strings), arrays and
 * inline tables. Each top-level `[[array]]` element also records the line it
 * starts on, so findings can point at the right place in a lockfile.
 *
 * Errors throw `TomlError` with a line number; callers turn that into a
 * "could not be parsed" note for the file instead of guessing.
 */

export class TomlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
  }
}

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable { [key: string]: TomlValue }

/** Line on which each table (including array-of-table elements) started. */
export const LINE = Symbol("line");

type LinedTable = TomlTable & { [LINE]?: number };

export function parseToml(text: string): TomlTable {
  const root: LinedTable = Object.create(null);
  let current: LinedTable = root;
  let i = 0;
  let line = 1;
  const src = text.replace(/^﻿/, "");

  const fail = (message: string): never => { throw new TomlError(message, line); };
  const peek = () => src[i];
  const skipSpace = () => { while (src[i] === " " || src[i] === "\t") i++; };
  const skipComment = () => { if (src[i] === "#") while (i < src.length && src[i] !== "\n") i++; };
  const skipBlank = () => {
    // Whitespace, newlines and comments (inside arrays).
    for (;;) {
      skipSpace();
      skipComment();
      if (src[i] === "\r" && src[i + 1] === "\n") { i += 2; line++; continue; }
      if (src[i] === "\n") { i++; line++; continue; }
      return;
    }
  };
  const endOfLine = () => {
    skipSpace();
    skipComment();
    if (src[i] === "\r") i++;
    if (i < src.length && src[i] !== "\n") fail(`Unexpected "${src[i]}"`);
    if (src[i] === "\n") { i++; line++; }
  };

  const ESCAPES: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", "\"": "\"", "\\": "\\", e: "\u001b" };

  const basicString = (): string => {
    const multiline = src.startsWith("\"\"\"", i);
    i += multiline ? 3 : 1;
    if (multiline && src[i] === "\n") { i++; line++; } else if (multiline && src.startsWith("\r\n", i)) { i += 2; line++; }
    let out = "";
    for (;;) {
      if (i >= src.length) fail("Unterminated string");
      const ch = src[i];
      if (multiline && src.startsWith("\"\"\"", i)) {
        // Up to two quotes may sit right before the closing delimiter.
        let extra = 0;
        while (src[i + 3 + extra] === "\"" && extra < 2) extra++;
        out += "\"".repeat(extra);
        i += 3 + extra;
        return out;
      }
      if (!multiline && ch === "\"") { i++; return out; }
      if (ch === "\n") {
        if (!multiline) fail("Newline in a string");
        line++;
        out += ch;
        i++;
        continue;
      }
      if (ch === "\\") {
        const next = src[i + 1];
        if (multiline && (next === "\n" || next === "\r" || next === " " || next === "\t")) {
          // A line-ending backslash trims the newline and the indentation after it.
          let j = i + 1;
          while (src[j] === " " || src[j] === "\t") j++;
          if (src[j] === "\r") j++;
          if (src[j] === "\n") {
            i = j;
            while (i < src.length && /[\s]/.test(src[i])) { if (src[i] === "\n") line++; i++; }
            continue;
          }
        }
        if (next === "u" || next === "U") {
          const length = next === "u" ? 4 : 8;
          const hex = src.slice(i + 2, i + 2 + length);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== length) fail("Bad unicode escape");
          out += String.fromCodePoint(Number.parseInt(hex, 16));
          i += 2 + length;
          continue;
        }
        if (!(next in ESCAPES)) fail(`Bad escape "\\${next}"`);
        out += ESCAPES[next];
        i += 2;
        continue;
      }
      out += ch;
      i++;
    }
  };

  const literalString = (): string => {
    const multiline = src.startsWith("'''", i);
    i += multiline ? 3 : 1;
    if (multiline && src[i] === "\n") { i++; line++; } else if (multiline && src.startsWith("\r\n", i)) { i += 2; line++; }
    const close = multiline ? "'''" : "'";
    let end = src.indexOf(close, i);
    if (end < 0) fail("Unterminated string");
    if (multiline) while (src[end + 3] === "'" && end + 3 - i < src.length) end++;
    const value = src.slice(i, end);
    if (!multiline && value.includes("\n")) fail("Newline in a string");
    line += (value.match(/\n/g) || []).length;
    i = end + close.length;
    return value;
  };

  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      skipSpace();
      const ch = peek();
      if (ch === "\"") parts.push(basicString());
      else if (ch === "'") parts.push(literalString());
      else {
        const start = i;
        while (i < src.length && /[A-Za-z0-9_-]/.test(src[i])) i++;
        if (start === i) fail("Expected a key");
        parts.push(src.slice(start, i));
      }
      skipSpace();
      if (peek() !== ".") return parts;
      i++;
    }
  };

  const value = (): TomlValue => {
    skipSpace();
    const ch = peek();
    if (ch === "\"") return basicString();
    if (ch === "'") return literalString();
    if (ch === "[") {
      i++;
      const items: TomlValue[] = [];
      for (;;) {
        skipBlank();
        if (peek() === "]") { i++; return items; }
        items.push(value());
        skipBlank();
        if (peek() === ",") { i++; continue; }
        skipBlank();
        if (peek() === "]") { i++; return items; }
        fail("Expected , or ] in an array");
      }
    }
    if (ch === "{") {
      i++;
      const table: TomlTable = Object.create(null);
      skipSpace();
      if (peek() === "}") { i++; return table; }
      for (;;) {
        const path = key();
        if (peek() !== "=") fail("Expected = in an inline table");
        i++;
        assign(table, path, value());
        skipSpace();
        if (peek() === ",") { i++; continue; }
        if (peek() === "}") { i++; return table; }
        fail("Expected , or } in an inline table");
      }
    }
    // Bare scalars: booleans, numbers, dates. Read up to a delimiter.
    const start = i;
    while (i < src.length && !/[,\]}\n\r#]/.test(src[i])) i++;
    const raw = src.slice(start, i).trim();
    i = start + src.slice(start, i).trimEnd().length;
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^[+-]?(\d[\d_]*)(\.\d[\d_]*)?([eE][+-]?\d+)?$/.test(raw)) return Number(raw.replace(/_/g, ""));
    if (/^0x[0-9a-fA-F_]+$|^0o[0-7_]+$|^0b[01_]+$/.test(raw)) return Number(raw.replace(/_/g, ""));
    if (/^[+-]?(inf|nan)$/.test(raw)) return raw.includes("nan") ? Number.NaN : (raw.startsWith("-") ? -Infinity : Infinity);
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(raw)) return raw; // date-times stay strings
    return fail(`Unrecognised value "${raw}"`);
  };

  function assign(table: TomlTable, path: string[], v: TomlValue): void {
    let target = table;
    for (const part of path.slice(0, -1)) {
      const existing = target[part];
      if (existing === undefined) target = (target[part] = Object.create(null)) as TomlTable;
      else if (existing && typeof existing === "object" && !Array.isArray(existing)) target = existing;
      else fail(`Key "${part}" is not a table`);
    }
    const last = path[path.length - 1];
    if (last in target) fail(`Duplicate key "${path.join(".")}"`);
    target[last] = v;
  }

  const descend = (path: string[], forArray: boolean): LinedTable => {
    let target: TomlTable = root;
    path.forEach((part, index) => {
      const isLast = index === path.length - 1;
      let next = target[part];
      if (isLast && forArray) {
        if (next === undefined) next = target[part] = [];
        if (!Array.isArray(next)) fail(`"${path.join(".")}" is not an array of tables`);
        const element: LinedTable = Object.create(null);
        element[LINE] = line;
        (next as TomlValue[]).push(element);
        target = element;
        return;
      }
      if (next === undefined) next = target[part] = Object.create(null) as TomlTable;
      // A dotted header under an array of tables continues its last element.
      if (Array.isArray(next)) next = next[next.length - 1];
      if (!next || typeof next !== "object" || Array.isArray(next)) fail(`"${part}" is not a table`);
      target = next as TomlTable;
      if (isLast && (target as LinedTable)[LINE] === undefined) (target as LinedTable)[LINE] = line;
    });
    return target as LinedTable;
  };

  while (i < src.length) {
    skipSpace();
    const ch = peek();
    if (ch === "#" || ch === "\n" || ch === "\r" || ch === undefined) { endOfLine(); continue; }
    if (ch === "[") {
      const array = src[i + 1] === "[";
      i += array ? 2 : 1;
      const path = key();
      if (array ? !src.startsWith("]]", i) : src[i] !== "]") fail("Unterminated table header");
      i += array ? 2 : 1;
      current = descend(path, array);
      endOfLine();
      continue;
    }
    const path = key();
    if (peek() !== "=") fail("Expected =");
    i++;
    assign(current, path, value());
    endOfLine();
  }
  return root;
}

/** The line an array-of-tables element or table started on, if the reader recorded it. */
export function lineOf(table: unknown): number | undefined {
  return table && typeof table === "object" ? (table as LinedTable)[LINE] : undefined;
}

export function asTable(value: unknown): TomlTable | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as TomlTable : undefined;
}

export function asTables(value: unknown): TomlTable[] {
  return Array.isArray(value) ? value.filter((v): v is TomlTable => Boolean(asTable(v))) : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
