/**
 * Finds where JSON text stops being valid, with a short reason.
 *
 * V8's JSON.parse messages do not always include a position (for example
 * `Unexpected token '}', ..."b": } is not valid JSON`), so tools that report
 * invalid JSON scan the text themselves. The scanner is iterative: deeply
 * nested input cannot overflow the stack, and it runs in one linear pass.
 */
export interface JsonErrorLocation {
  /** UTF-16 offset of the problem. */
  offset: number;
  /** 1-based line and column. */
  line: number;
  column: number;
  reason: string;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function locateJsonError(source: string): JsonErrorLocation | undefined {
  const n = source.length;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: Array<"object" | "array"> = [];
  let state: "value" | "key" | "after" = "value";
  const describe = (at: number) => at >= n ? "end of input" : source[at] === "'" ? "' (JSON strings need double quotes)" : `'${source[at]}'`;
  const fail = (reason: string, at = i): JsonErrorLocation => {
    const before = source.slice(0, at), lineStart = before.lastIndexOf("\n") + 1;
    return { offset: at, line: before.split("\n").length, column: at - lineStart + 1, reason };
  };
  const ws = () => { while (i < n && (source[i] === " " || source[i] === "\t" || source[i] === "\n" || source[i] === "\r")) i++; };
  const string = (): JsonErrorLocation | undefined => {
    const start = i++;
    while (i < n) {
      const c = source.charCodeAt(i);
      if (c === 34) { i++; return undefined; }
      if (c === 92) {
        const escape = source[i + 1];
        if (escape === "u") { if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6))) return fail("invalid \\u escape in string"); i += 6; continue; }
        if (!escape || !'"\\/bfnrt'.includes(escape)) return fail(`invalid escape \\${escape ?? ""} in string`);
        i += 2; continue;
      }
      if (c < 0x20) return fail(c === 10 ? "line break inside a string (escape it as \\n)" : "unescaped control character in string");
      i++;
    }
    return fail("unterminated string", start);
  };
  for (;;) {
    ws();
    if (state === "value") {
      if (i >= n) return fail(stack.length ? "unexpected end of input (the JSON is truncated)" : "empty input");
      const c = source[i];
      if (c === "{" || c === "[") {
        i++; ws();
        if (source[i] === (c === "{" ? "}" : "]")) { i++; state = "after"; continue; }
        stack.push(c === "{" ? "object" : "array"); state = c === "{" ? "key" : "value"; continue;
      }
      if (c === '"') { const problem = string(); if (problem) return problem; state = "after"; continue; }
      NUMBER.lastIndex = i;
      if (NUMBER.test(source)) { i = NUMBER.lastIndex; state = "after"; continue; }
      const literal = /^(?:true|false|null)/.exec(source.slice(i, i + 5));
      if (literal) { i += literal[0].length; state = "after"; continue; }
      return fail(c === "]" || c === "}" ? `unexpected ${describe(i)}: a value is missing` : `unexpected ${describe(i)}`);
    }
    if (state === "key") {
      if (source[i] !== '"') return fail(i >= n ? "unexpected end of input (the JSON is truncated)" : source[i] === "}" ? "trailing comma before '}'" : `expected a double-quoted property name, found ${describe(i)}`);
      const problem = string(); if (problem) return problem;
      ws();
      if (source[i] !== ":") return fail(`expected ':' after the property name, found ${describe(i)}`);
      i++; state = "value"; continue;
    }
    const top = stack[stack.length - 1];
    if (!top) return i < n ? fail(`unexpected ${describe(i)} after the JSON value`) : undefined;
    const close = top === "object" ? "}" : "]";
    if (i >= n) return fail(`unexpected end of input: missing '${close}' (the JSON is truncated)`);
    if (source[i] === ",") {
      i++; ws();
      if (top === "array" && source[i] === "]") return fail("trailing comma before ']'");
      state = top === "object" ? "key" : "value"; continue;
    }
    if (source[i] === close) { i++; stack.pop(); continue; }
    return fail(`expected ',' or '${close}', found ${describe(i)}`);
  }
}

/** "line 2, column 7: unexpected '}'" (or a generic hint when the text is valid). */
export function describeJsonError(source: string): string {
  const location = locateJsonError(source);
  return location ? `line ${location.line}, column ${location.column}: ${location.reason}` : "check quoting, commas and truncation";
}
