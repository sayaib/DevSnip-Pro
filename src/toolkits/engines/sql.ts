import { ToolInputError } from "../types";
import { Row, collectColumns } from "./data-convert";

/**
 * SQL tooling built on a real tokenizer, so string literals, quoted
 * identifiers and comments are never altered by formatting.
 */

export type TokenType = "string" | "identifier" | "comment" | "number" | "word" | "operator" | "punct" | "space";

export interface Token { type: TokenType; value: string; offset: number }

/** A problem with the SQL the user pasted, so tools report it as an input error with its position. */
export class SqlSyntaxError extends ToolInputError {
  constructor(message: string, public offset: number) {
    super(`${message} (at character ${offset + 1}).`);
  }
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const start = i;
    const ch = sql[i];
    if (/\s/.test(ch)) {
      while (i < n && /\s/.test(sql[i])) i++;
      tokens.push({ type: "space", value: sql.slice(start, i), offset: start });
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      tokens.push({ type: "comment", value: sql.slice(start, i), offset: start });
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new SqlSyntaxError("Unterminated /* comment", start);
      i = end + 2;
      tokens.push({ type: "comment", value: sql.slice(start, i), offset: start });
      continue;
    }
    if (ch === "'" || ch === "\"" || ch === "`") {
      i++;
      while (i < n) {
        if (sql[i] === "\\" && ch !== "\"" && i + 1 < n) { i += 2; continue; }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) { i += 2; continue; } // doubled quote escape
          break;
        }
        i++;
      }
      if (i >= n) throw new SqlSyntaxError(`Unterminated ${ch === "'" ? "string literal" : "quoted identifier"}`, start);
      i++;
      tokens.push({ type: ch === "'" ? "string" : "identifier", value: sql.slice(start, i), offset: start });
      continue;
    }
    // "[name]" is a SQL Server identifier; "text[]" / "arr[1]" (directly after a word) is array syntax.
    if (ch === "[" && !/[\w\])"]/.test(sql[i - 1] ?? "")) {
      const end = sql.indexOf("]", i);
      if (end < 0) throw new SqlSyntaxError("Unterminated [identifier]", start);
      i = end + 1;
      tokens.push({ type: "identifier", value: sql.slice(start, i), offset: start });
      continue;
    }
    if (ch === "$") {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end < 0) throw new SqlSyntaxError("Unterminated dollar-quoted string", start);
        i = end + tag[0].length;
        tokens.push({ type: "string", value: sql.slice(start, i), offset: start });
        continue;
      }
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(sql[i + 1] ?? ""))) {
      while (i < n && /[\d.eE]/.test(sql[i])) {
        if (/[eE]/.test(sql[i]) && /[+-]/.test(sql[i + 1] ?? "")) i++;
        i++;
      }
      tokens.push({ type: "number", value: sql.slice(start, i), offset: start });
      continue;
    }
    // "::" is PostgreSQL's cast operator; a single ":" before a letter is a bind parameter (:name).
    const isBind = ch === ":" && sql[i + 1] !== ":" && sql[i - 1] !== ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "");
    if (/[A-Za-z_@#]/.test(ch) || isBind) {
      i++;
      while (i < n && /[\w$#]/.test(sql[i])) i++;
      tokens.push({ type: "word", value: sql.slice(start, i), offset: start });
      continue;
    }
    const op = /^(<>|<=|>=|!=|::|\|\||->>|->|=>|[-+*/%<>=!~^&|])/.exec(sql.slice(i));
    if (op) {
      i += op[0].length;
      tokens.push({ type: "operator", value: op[0], offset: start });
      continue;
    }
    i++;
    tokens.push({ type: "punct", value: ch, offset: start });
  }
  return tokens;
}

const KEYWORDS = new Set(("select from where and or not in is null like ilike between exists as on join inner left right full outer cross natural using group by order having limit offset fetch first next rows only " +
  "union all intersect except distinct case when then else end with recursive insert into values update set delete create table view index drop alter add column primary key foreign references " +
  "default unique check constraint if returning asc desc nulls over partition window lateral true false cast coalesce count sum avg min max interval explain analyze materialized temporary temp " +
  "merge matched truncate grant revoke begin commit rollback transaction replace qualify pivot unpivot").split(" "));

const FUNCTIONS = new Set(["count", "sum", "avg", "min", "max", "coalesce", "cast", "replace", "left", "right", "if"]);

const CLAUSES = new Set(["select", "from", "where", "group by", "order by", "having", "limit", "offset", "union", "union all", "intersect", "except", "values", "set", "returning", "window", "qualify", "insert into", "update", "delete from", "with", "on conflict"]);
const JOINS = /^(left|right|full|inner|cross|natural)?\s*(outer\s+)?join$/;

export interface FormatOptions { keywordCase: "upper" | "lower" | "preserve"; indent: string }

/** Formats SQL by re-emitting tokens with layout rules; literals, identifiers and comments are copied verbatim. */
export function formatSql(sql: string, options: FormatOptions): string {
  const tokens = tokenize(sql).filter(t => t.type !== "space" || /\n\s*\n/.test(t.value));
  const word = (t: Token) => (t.type === "word" ? t.value.toLowerCase() : "");
  const kw = (t: Token) => {
    if (t.type !== "word" || !KEYWORDS.has(t.value.toLowerCase())) return t.value;
    return options.keywordCase === "upper" ? t.value.toUpperCase() : options.keywordCase === "lower" ? t.value.toLowerCase() : t.value;
  };
  let out = "";
  let depth = 0;
  const clauseDepthStack: number[] = [];
  let lineStart = true;
  let prev: Token | undefined;
  let afterLineComment = false;
  const newline = (extra = 0) => {
    out = out.replace(/[ \t]+$/, "");
    out += "\n" + options.indent.repeat(Math.max(0, depth + extra));
    lineStart = true;
  };
  const emit = (text: string, token?: Token) => {
    const glue = lineStart || !out || /[\s(.[]$/.test(out) || /::$/.test(out) || /^[),;.\]]/.test(text) || text === "::" || (text === "[" && !/\s$/.test(out)) ||
      // Function calls: no space between the name and "(" (but keep it after keywords like IN, AS, VALUES).
      (text === "(" && prev !== undefined && (prev.type === "identifier" || (prev.type === "word" && (!KEYWORDS.has(prev.value.toLowerCase()) || FUNCTIONS.has(prev.value.toLowerCase())))));
    if (!glue) out += " ";
    out += text;
    lineStart = false;
    afterLineComment = false;
    if (token) prev = token;
  };
  let inSelectList = false;
  let caseDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "space") { newline(); continue; } // preserve blank lines between statements
    const w = word(t);
    const next = tokens[i + 1];
    const pair = next && next.type === "word" ? `${w} ${next.value.toLowerCase()}` : "";
    if (t.type === "comment") {
      if (t.value.startsWith("--")) { emit(t.value, t); newline(); afterLineComment = true; } else emit(t.value, t);
      continue;
    }
    if (t.value === ";") {
      // Never pull ";" onto a line that ends with a -- comment: it would become part of the comment.
      if (!afterLineComment) out = out.replace(/\s+$/, "");
      else out = out.replace(/[ \t]+$/, "");
      out += ";";
      afterLineComment = false;
      depth = 0;
      inSelectList = false;
      out += "\n";
      lineStart = true;
      continue;
    }
    if (t.value === "(") {
      const isSubquery = next && ["select", "with"].includes(word(next));
      emit("(", t);
      depth++;
      clauseDepthStack.push(isSubquery ? 1 : 0);
      if (isSubquery) newline();
      continue;
    }
    if (t.value === ")") {
      const wasSubquery = clauseDepthStack.pop();
      depth = Math.max(0, depth - 1);
      if (wasSubquery) newline();
      out = out.replace(/ $/, "");
      out += ")";
      lineStart = false;
      prev = t;
      continue;
    }
    if (w === "case") caseDepth++;
    if (w === "end" && caseDepth) caseDepth--;
    const clause = CLAUSES.has(pair) ? pair : CLAUSES.has(w) ? w : "";
    const joinPhrase = (() => {
      let j = i;
      const words: string[] = [];
      while (j < tokens.length && tokens[j].type === "word" && words.length < 3) {
        words.push(tokens[j].value.toLowerCase());
        if (tokens[j].value.toLowerCase() === "join") break;
        j++;
      }
      return JOINS.test(words.join(" ")) ? words.length : 0;
    })();
    if (clause && caseDepth === 0) {
      if (out.trim() && !lineStart) newline();
      const parts = clause.split(" ").length;
      emit(tokens.slice(i, i + parts).map(kw).join(" "), tokens[i + parts - 1]);
      i += parts - 1;
      inSelectList = clause === "select";
      if (["select", "group by", "order by", "set", "values"].includes(clause)) newline(1);
      continue;
    }
    if (joinPhrase && caseDepth === 0) {
      newline();
      emit(tokens.slice(i, i + joinPhrase).map(kw).join(" "), tokens[i + joinPhrase - 1]);
      i += joinPhrase - 1;
      continue;
    }
    if ((w === "and" || w === "or") && caseDepth === 0 && clauseDepthStack[clauseDepthStack.length - 1] !== 0) {
      newline(1);
      emit(kw(t), t);
      continue;
    }
    if ((w === "on") && caseDepth === 0) {
      newline(1);
      emit(kw(t), t);
      continue;
    }
    if (t.value === "," && (inSelectList || depth === 0) && caseDepth === 0 && clauseDepthStack[clauseDepthStack.length - 1] !== 0) {
      out = out.replace(/ $/, "");
      out += ",";
      prev = t;
      newline(1);
      continue;
    }
    if (w === "distinct" && inSelectList) { out = out.replace(/\n\s*$/, ""); lineStart = false; emit(kw(t), t); newline(1); continue; }
    emit(t.type === "word" ? kw(t) : t.value, t);
  }
  return out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export interface SqlFinding { severity: "error" | "warning" | "info"; message: string; line?: number }

function lineOf(sql: string, offset: number): number {
  return sql.slice(0, offset).split("\n").length;
}

export function lintSql(sql: string): { findings: SqlFinding[]; statements: number } {
  const findings: SqlFinding[] = [];
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (error) {
    if (error instanceof SqlSyntaxError) return { findings: [{ severity: "error", message: error.message, line: lineOf(sql, error.offset) }], statements: 0 };
    throw error;
  }
  const code = tokens.filter(t => t.type !== "space" && t.type !== "comment");
  // Parentheses.
  const stack: Token[] = [];
  for (const t of code) {
    if (t.value === "(") stack.push(t);
    if (t.value === ")") {
      if (!stack.pop()) findings.push({ severity: "error", message: "Unmatched closing parenthesis", line: lineOf(sql, t.offset) });
    }
  }
  for (const open of stack) findings.push({ severity: "error", message: "Unclosed parenthesis", line: lineOf(sql, open.offset) });

  // Split into statements.
  const statements: Token[][] = [[]];
  for (const t of code) {
    if (t.value === ";") statements.push([]);
    else statements[statements.length - 1].push(t);
  }
  const real = statements.filter(s => s.length);
  for (const stmt of real) {
    const words = stmt.map(t => (t.type === "word" ? t.value.toLowerCase() : t.value));
    const first = words[0];
    const at = (t: Token) => lineOf(sql, t.offset);
    if ((first === "update" || first === "delete") && !words.includes("where")) {
      findings.push({ severity: "warning", message: `${first.toUpperCase()} without WHERE affects every row`, line: at(stmt[0]) });
    }
    stmt.forEach((t, i) => {
      const w = words[i];
      if ((w === "=" || w === "!=" || w === "<>") && words[i + 1] === "null") {
        findings.push({ severity: "error", message: `"${t.value} NULL" is never true; use IS ${w === "=" ? "" : "NOT "}NULL`, line: at(t) });
      }
      if (w === "," && ["from", "where", "group", "order", ")"].includes(words[i + 1])) {
        findings.push({ severity: "error", message: `Trailing comma before ${stmt[i + 1].value.toUpperCase()}`, line: at(t) });
      }
      if (w === "select" && words[i + 1] === "*" && first !== "insert") {
        findings.push({ severity: "info", message: "SELECT * - list the columns you need so schema changes do not break callers and less data is read", line: at(t) });
      }
      if (w === "join") {
        const prev = words[i - 1];
        if (prev !== "cross" && prev !== "natural") {
          let depth = 0;
          let hasCondition = false;
          for (let j = i + 1; j < words.length; j++) {
            if (words[j] === "(") depth++;
            if (words[j] === ")") depth--;
            if (depth < 0) break;
            if (depth === 0 && (words[j] === "on" || words[j] === "using")) { hasCondition = true; break; }
            if (depth === 0 && (words[j] === "join" || words[j] === "where" || words[j] === "group" || words[j] === "order" || words[j] === "limit")) break;
          }
          if (!hasCondition) findings.push({ severity: "error", message: "JOIN without ON or USING (use CROSS JOIN if a cartesian product is intended)", line: at(t) });
        }
      }
      if (w === "from") {
        // FROM a, b without join condition: implicit cross join.
        let j = i + 1;
        let depth = 0;
        let commas = 0;
        while (j < words.length && !(depth === 0 && ["where", "group", "order", "limit", "join", "left", "right", "inner", "full", "union", "having"].includes(words[j]))) {
          if (words[j] === "(") depth++;
          if (words[j] === ")") { if (depth === 0) break; depth--; }
          if (words[j] === "," && depth === 0) commas++;
          j++;
        }
        if (commas && !words.slice(j).includes("where")) findings.push({ severity: "warning", message: "Comma-separated tables without a WHERE condition produce a cartesian product", line: at(t) });
      }
      if (w === "not" && words[i + 1] === "in" && words[i + 2] === "(" && words[i + 3] === "select") {
        findings.push({ severity: "info", message: "NOT IN (subquery) returns no rows if the subquery yields a NULL; NOT EXISTS is safer", line: at(t) });
      }
    });
    if (first === "select" && words.includes("order") && !words.includes("limit") && !words.includes("top") && !words.includes("fetch")) {
      // Harmless; no finding.
    }
  }
  return { findings, statements: real.length };
}

// ---------------------------------------------------------------------------
// SQL from data
// ---------------------------------------------------------------------------

export type Dialect = "postgres" | "mysql" | "sqlite" | "sqlserver" | "spark";

function quoteIdent(name: string, dialect: Dialect): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name) && !KEYWORDS.has(name)) return name;
  if (dialect === "mysql" || dialect === "spark") return "`" + name.replace(/`/g, "``") + "`";
  if (dialect === "sqlserver") return `[${name.replace(/]/g, "]]")}]`;
  return `"${name.replace(/"/g, "\"\"")}"`;
}

type ColumnType = "boolean" | "integer" | "bigint" | "decimal" | "date" | "timestamp" | "json" | "text";

function columnType(values: unknown[]): { type: ColumnType; maxLength: number; nullable: boolean } {
  const present = values.filter(v => v !== null && v !== undefined && v !== "");
  const nullable = present.length < values.length;
  const maxLength = Math.max(0, ...present.map(v => String(typeof v === "object" ? JSON.stringify(v) : v).length));
  if (!present.length) return { type: "text", maxLength, nullable: true };
  if (present.every(v => typeof v === "boolean")) return { type: "boolean", maxLength, nullable };
  if (present.every(v => typeof v === "number" && Number.isInteger(v))) {
    return { type: present.every(v => Math.abs(v as number) < 2 ** 31) ? "integer" : "bigint", maxLength, nullable };
  }
  if (present.every(v => typeof v === "number")) return { type: "decimal", maxLength, nullable };
  if (present.every(v => typeof v === "object")) return { type: "json", maxLength, nullable };
  if (present.every(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return { type: "date", maxLength, nullable };
  if (present.every(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v))) return { type: "timestamp", maxLength, nullable };
  return { type: "text", maxLength, nullable };
}

function sqlType(t: ReturnType<typeof columnType>, dialect: Dialect): string {
  const varchar = (n: number) => {
    const size = n <= 50 ? 64 : n <= 200 ? 255 : 0;
    if (!size) return dialect === "sqlserver" ? "NVARCHAR(MAX)" : dialect === "spark" ? "STRING" : "TEXT";
    return dialect === "sqlserver" ? `NVARCHAR(${size})` : dialect === "spark" ? "STRING" : dialect === "sqlite" ? "TEXT" : `VARCHAR(${size})`;
  };
  switch (t.type) {
    case "boolean": return dialect === "sqlserver" ? "BIT" : dialect === "sqlite" ? "INTEGER" : "BOOLEAN";
    case "integer": return dialect === "spark" ? "INT" : "INTEGER";
    case "bigint": return "BIGINT";
    case "decimal": return dialect === "sqlite" ? "REAL" : dialect === "spark" ? "DOUBLE" : "NUMERIC(18, 6)";
    case "date": return "DATE";
    case "timestamp": return dialect === "postgres" ? "TIMESTAMPTZ" : dialect === "sqlserver" ? "DATETIME2" : dialect === "sqlite" ? "TEXT" : "TIMESTAMP";
    case "json": return dialect === "postgres" ? "JSONB" : dialect === "mysql" ? "JSON" : dialect === "spark" ? "STRING" : "TEXT";
    default: return varchar(t.maxLength);
  }
}

function literal(value: unknown, dialect: Dialect): string {
  if (value === null || value === undefined || value === "") return "NULL";
  if (typeof value === "boolean") return dialect === "sqlserver" || dialect === "sqlite" ? (value ? "1" : "0") : value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = text.replace(/'/g, "''");
  return dialect === "sqlserver" ? `N'${escaped}'` : dialect === "mysql" ? `'${escaped.replace(/\\/g, "\\\\")}'` : `'${escaped}'`;
}

export function sqlFromRows(rows: Row[], table: string, dialect: Dialect, options: { createTable: boolean; inserts: boolean; batchSize: number }): string {
  if (!rows.length) throw new ToolInputError("There are no rows to convert.");
  const columns = collectColumns(rows);
  const t = quoteIdent(table.trim() || "my_table", dialect);
  const parts: string[] = [];
  if (options.createTable) {
    const idColumn = columns.find(c => /^id$/i.test(c));
    const defs = columns.map(c => {
      const info = columnType(rows.map(r => r[c]));
      const pk = c === idColumn && !info.nullable && new Set(rows.map(r => r[c])).size === rows.length;
      return `  ${quoteIdent(c, dialect)} ${sqlType(info, dialect)}${pk ? " PRIMARY KEY" : info.nullable || dialect === "spark" ? "" : " NOT NULL"}`;
    });
    parts.push(`CREATE TABLE ${dialect === "sqlserver" ? "" : "IF NOT EXISTS "}${t} (\n${defs.join(",\n")}\n)${dialect === "spark" ? " USING DELTA" : ""};`);
  }
  if (options.inserts) {
    const cols = columns.map(c => quoteIdent(c, dialect)).join(", ");
    const batch = Math.max(1, Math.min(options.batchSize, dialect === "sqlserver" ? 1000 : 5000));
    for (let i = 0; i < rows.length; i += batch) {
      const values = rows.slice(i, i + batch).map(r => `  (${columns.map(c => literal(r[c], dialect)).join(", ")})`);
      parts.push(`INSERT INTO ${t} (${cols}) VALUES\n${values.join(",\n")};`);
    }
  }
  return parts.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Query helper: parameterised CRUD, upsert and pagination for one table
// ---------------------------------------------------------------------------

export type ParamStyle = "positional" | "named";

export interface QueryHelperOptions {
  table: string;
  columns: string[];
  key: string;
  dialect: Dialect;
  paramStyle: ParamStyle;
}

/** Placeholders the driver for each dialect understands (never string-concatenated values). */
function placeholders(dialect: Dialect, style: ParamStyle) {
  let n = 0;
  return (name: string) => {
    n++;
    if (style === "named") return dialect === "sqlserver" ? `@${name}` : `:${name}`;
    if (dialect === "postgres") return `$${n}`;
    if (dialect === "sqlserver") return `@p${n}`;
    return "?";
  };
}

export function queryHelper(o: QueryHelperOptions): Array<{ title: string; sql: string }> {
  const columns = [...new Set(o.columns.map(c => c.trim()).filter(Boolean))];
  if (!o.table.trim()) throw new ToolInputError("Enter a table name.");
  if (!columns.length) throw new ToolInputError("List at least one column.");
  for (const c of columns) if (!/^[A-Za-z_][\w$]*$/.test(c)) throw new ToolInputError(`"${c}" is not a plain column name.`);
  const key = o.key.trim() || columns[0];
  if (!columns.includes(key)) columns.unshift(key);
  const d = o.dialect;
  const t = o.table.trim().split(".").map(part => quoteIdent(part, d)).join(".");
  const q = (c: string) => quoteIdent(c, d);
  const others = columns.filter(c => c !== key);
  const list = columns.map(q).join(", ");
  const out: Array<{ title: string; sql: string }> = [];
  let p = placeholders(d, o.paramStyle);
  out.push({ title: "Select by key", sql: `SELECT ${list}\nFROM ${t}\nWHERE ${q(key)} = ${p(key)};` });
  p = placeholders(d, o.paramStyle);
  const limit = d === "sqlserver"
    ? `ORDER BY ${q(key)}\nOFFSET ${p("offset")} ROWS FETCH NEXT ${p("limit")} ROWS ONLY;`
    : `ORDER BY ${q(key)}\nLIMIT ${p("limit")} OFFSET ${p("offset")};`;
  out.push({ title: "Page through rows (offset)", sql: `SELECT ${list}\nFROM ${t}\n${limit}` });
  p = placeholders(d, o.paramStyle);
  out.push({
    title: "Keyset pagination (fast on large tables)",
    sql: d === "sqlserver"
      ? `SELECT TOP (${p("limit")}) ${list}\nFROM ${t}\nWHERE ${q(key)} > ${p("after")}\nORDER BY ${q(key)};`
      : `SELECT ${list}\nFROM ${t}\nWHERE ${q(key)} > ${p("after")}\nORDER BY ${q(key)}\nLIMIT ${p("limit")};`
  });
  p = placeholders(d, o.paramStyle);
  const insertValues = columns.map(c => p(c)).join(", ");
  out.push({ title: "Insert", sql: `INSERT INTO ${t} (${list})\nVALUES (${insertValues})${d === "postgres" || d === "sqlite" ? `\nRETURNING ${q(key)}` : ""};` });
  if (others.length) {
    p = placeholders(d, o.paramStyle);
    const sets = others.map(c => `  ${q(c)} = ${p(c)}`).join(",\n");
    out.push({ title: "Update by key", sql: `UPDATE ${t}\nSET\n${sets}\nWHERE ${q(key)} = ${p(key)};` });
    p = placeholders(d, o.paramStyle);
    const values = columns.map(c => p(c)).join(", ");
    let upsert: string;
    switch (d) {
      case "postgres":
      case "sqlite":
        upsert = `INSERT INTO ${t} (${list})\nVALUES (${values})\nON CONFLICT (${q(key)}) DO UPDATE SET\n${others.map(c => `  ${q(c)} = excluded.${q(c)}`).join(",\n")};`;
        break;
      case "mysql":
        upsert = `INSERT INTO ${t} (${list})\nVALUES (${values}) AS new\nON DUPLICATE KEY UPDATE\n${others.map(c => `  ${q(c)} = new.${q(c)}`).join(",\n")};`;
        break;
      case "sqlserver":
        upsert = `MERGE ${t} WITH (HOLDLOCK) AS target\nUSING (SELECT ${columns.map(c => `${p(c)} AS ${q(c)}`).join(", ")}) AS source\n  ON target.${q(key)} = source.${q(key)}\nWHEN MATCHED THEN UPDATE SET\n${others.map(c => `  ${q(c)} = source.${q(c)}`).join(",\n")}\nWHEN NOT MATCHED THEN\n  INSERT (${list}) VALUES (${columns.map(c => `source.${q(c)}`).join(", ")});`;
        break;
      default:
        upsert = `MERGE INTO ${t} AS target\nUSING updates AS source\n  ON target.${q(key)} = source.${q(key)}\nWHEN MATCHED THEN UPDATE SET *\nWHEN NOT MATCHED THEN INSERT *;`;
    }
    out.push({ title: d === "spark" ? "Upsert (Delta MERGE from an `updates` view)" : "Upsert (insert or update)", sql: upsert });
  }
  p = placeholders(d, o.paramStyle);
  out.push({ title: "Delete by key", sql: `DELETE FROM ${t}\nWHERE ${q(key)} = ${p(key)};` });
  p = placeholders(d, o.paramStyle);
  out.push({ title: "Exists check", sql: d === "sqlserver" ? `SELECT CASE WHEN EXISTS (SELECT 1 FROM ${t} WHERE ${q(key)} = ${p(key)}) THEN 1 ELSE 0 END;` : `SELECT EXISTS (SELECT 1 FROM ${t} WHERE ${q(key)} = ${p(key)});` });
  return out;
}

/** Column names from a CREATE TABLE statement, for filling the query helper. */
export function columnsFromCreateTable(sql: string): { table: string; columns: string[]; key?: string } | undefined {
  const m = /create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(([\s\S]*)\)/i.exec(sql);
  if (!m) return undefined;
  const clean = (s: string) => s.replace(/["`\[\]]/g, "");
  const body = m[2];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; } else current += ch;
  }
  parts.push(current);
  const columns: string[] = [];
  let key: string | undefined;
  for (const part of parts.map(s => s.trim()).filter(Boolean)) {
    const pk = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]+)\)/i.exec(part);
    if (pk) { key = clean(pk[1].split(",")[0].trim()); continue; }
    if (/^(constraint|unique|foreign|check|index|key)\b/i.test(part)) continue;
    const name = /^([\w"`\[\]]+)/.exec(part)?.[1];
    if (!name) continue;
    columns.push(clean(name));
    if (/primary\s+key/i.test(part)) key = clean(name);
  }
  return { table: clean(m[1]), columns, key };
}
