/**
 * Working with what LLMs return: pulling JSON out of chatty responses,
 * repairing the usual mistakes, and tidying markdown answers.
 */

export interface JsonRepairResult {
  ok: boolean;
  value?: unknown;
  /** The JSON text that was finally parsed (after repairs). */
  text: string;
  fixes: string[];
  error?: { message: string; line: number; column: number; excerpt: string };
}

/** Line/column (1-based) of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Turns a JSON.parse error into a located, readable error. */
export function describeJsonError(text: string, error: unknown): { message: string; line: number; column: number; excerpt: string } {
  const message = error instanceof Error ? error.message : String(error);
  let offset = -1;
  const position = /position (\d+)/i.exec(message);
  if (position) offset = Number(position[1]);
  const lc = /line (\d+) column (\d+)/i.exec(message);
  let line: number;
  let column: number;
  if (lc) {
    line = Number(lc[1]);
    column = Number(lc[2]);
  } else if (offset >= 0) {
    ({ line, column } = lineColumn(text, offset));
  } else {
    ({ line, column } = lineColumn(text, text.length));
  }
  const sourceLine = text.split("\n")[line - 1] ?? "";
  const excerpt = `${sourceLine}\n${" ".repeat(Math.max(0, column - 1))}^`;
  return { message: message.replace(/^JSON\.parse: /, "").replace(/ in JSON at position \d+.*$/, ""), line, column, excerpt };
}

/**
 * Finds the first complete JSON object/array in text, scanning with string
 * awareness so braces inside strings (or in prose after the JSON) do not
 * confuse it.
 */
export function findJsonSpan(text: string): { start: number; end: number } | undefined {
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const stack: string[] = [];
  let inString: string | undefined;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = undefined;
      continue;
    }
    if (ch === "\"" || ch === "'") inString = ch;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return { start, end: text.length };
      if (!stack.length) return { start, end: i + 1 };
    }
  }
  return { start, end: text.length };
}

/**
 * Normalises JSON-like text (JSON5-ish / Python-ish) into strict JSON with a
 * single tokenizer pass, recording what it changed.
 */
function normalise(source: string, fixes: Set<string>): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    // Strings: re-emit double-quoted; convert single-quoted.
    if (ch === "\"" || ch === "'" || ch === "“" || ch === "”") {
      const close = ch === "'" ? "'" : ch === "\"" ? "\"" : "”";
      if (ch !== "\"") fixes.add(ch === "'" ? "Converted single-quoted strings to double quotes" : "Replaced curly quotes with straight quotes");
      let value = "";
      i++;
      while (i < n && source[i] !== close && !(close === "”" && source[i] === "“")) {
        if (source[i] === "\\" && i + 1 < n) {
          if (source[i + 1] === "'") value += "'";
          else value += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === "\"" && close !== "\"") { value += "\\\""; i++; continue; }
        if (source[i] === "\n") { value += "\\n"; fixes.add("Escaped raw line breaks inside strings"); i++; continue; }
        if (source[i] === "\t") { value += "\\t"; i++; continue; }
        value += source[i++];
      }
      i++;
      out += `"${value}"`;
      continue;
    }
    // Comments.
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i++;
      fixes.add("Removed comments");
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const endComment = source.indexOf("*/", i + 2);
      i = endComment < 0 ? n : endComment + 2;
      fixes.add("Removed comments");
      continue;
    }
    // Trailing commas.
    if (ch === ",") {
      // Look past whitespace and comments: `True, // note\n}` is still a trailing comma.
      let j = i + 1;
      for (;;) {
        while (j < n && /\s/.test(source[j])) j++;
        if (source[j] === "/" && source[j + 1] === "/") { while (j < n && source[j] !== "\n") j++; continue; }
        if (source[j] === "/" && source[j + 1] === "*") { const e = source.indexOf("*/", j + 2); j = e < 0 ? n : e + 2; continue; }
        break;
      }
      if (source[j] === "}" || source[j] === "]") {
        fixes.add("Removed trailing commas");
        i++;
        continue;
      }
    }
    // Bare words: keys, Python/JS literals.
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$-]/.test(source[j])) j++;
      const word = source.slice(i, j);
      let k = j;
      while (k < n && /[ \t]/.test(source[k])) k++;
      if (source[k] === ":") {
        out += `"${word}"`;
        fixes.add("Quoted unquoted keys");
      } else if (word === "True" || word === "False") {
        out += word.toLowerCase();
        fixes.add("Converted Python True/False to true/false");
      } else if (word === "None" || word === "undefined" || word === "NaN") {
        out += "null";
        fixes.add(`Replaced ${word} with null`);
      } else {
        out += word;
      }
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function repairJson(input: string): JsonRepairResult {
  const fixes = new Set<string>();
  let text = input.replace(/^﻿/, "").trim();
  if (!text) return { ok: false, text: "", fixes: [], error: { message: "The input is empty.", line: 1, column: 1, excerpt: "" } };

  const fence = /```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/.exec(text);
  if (fence) {
    text = fence[1].trim();
    fixes.add("Extracted the fenced code block");
  }
  try {
    return { ok: true, value: JSON.parse(text), text, fixes: [...fixes] };
  } catch {
    /* try harder below */
  }
  const span = findJsonSpan(text);
  if (span && (span.start > 0 || span.end < text.length)) {
    const before = text.slice(0, span.start).trim();
    const after = text.slice(span.end).trim();
    text = text.slice(span.start, span.end);
    if (before || after) fixes.add("Removed text around the JSON");
  }
  let candidate = text;
  try {
    return { ok: true, value: JSON.parse(candidate), text: candidate, fixes: [...fixes] };
  } catch {
    candidate = normalise(text, fixes);
  }
  try {
    return { ok: true, value: JSON.parse(candidate), text: candidate, fixes: [...fixes] };
  } catch (error) {
    // Truncated output (hit max_tokens): close what is open so the prefix can be inspected.
    const closed = closeTruncated(candidate);
    if (closed !== candidate) {
      try {
        const value = JSON.parse(closed);
        fixes.add("Closed a truncated JSON document (the response was probably cut off by max_tokens)");
        return { ok: true, value, text: closed, fixes: [...fixes] };
      } catch {
        /* report the original error */
      }
    }
    return { ok: false, text: candidate, fixes: [...fixes], error: describeJsonError(candidate, error) };
  }
}

function closeTruncated(text: string): string {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (!stack.length && !inString) return text;
  let out = text.replace(/,\s*$/, "");
  if (inString) out += "\"";
  out = out.replace(/,\s*"[^"]*"\s*$/, "").replace(/:\s*$/, ": null");
  return out + stack.reverse().join("");
}

// ---------------------------------------------------------------------------
// Response formatting
// ---------------------------------------------------------------------------

export interface CodeBlock {
  language: string;
  content: string;
  lines: number;
}

export interface FormattedResponse {
  reasoningRemoved: number;
  markdown: string;
  plainText: string;
  codeBlocks: CodeBlock[];
  jsonBlocks: number;
}

export function formatResponse(raw: string, options: { stripReasoning: boolean; prettyJson: boolean }): FormattedResponse {
  let text = raw.replace(/\r\n/g, "\n");
  let reasoningRemoved = 0;
  if (options.stripReasoning) {
    text = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>\s*/gi, () => {
      reasoningRemoved++;
      return "";
    });
  }
  const codeBlocks: CodeBlock[] = [];
  let jsonBlocks = 0;
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_whole, info: string, body: string) => {
    let language = (info.trim().split(/\s+/)[0] || "").toLowerCase();
    let content = body.replace(/\n$/, "");
    if (!language && /^\s*[[{]/.test(content)) language = "json";
    if (options.prettyJson && language === "json") {
      try {
        content = JSON.stringify(JSON.parse(content), null, 2);
        jsonBlocks++;
      } catch {
        /* leave invalid JSON untouched */
      }
    }
    codeBlocks.push({ language: language || "text", content, lines: content.split("\n").length });
    return "```" + (language || "") + "\n" + content + "\n```";
  });
  // Normalise excessive blank lines and trailing spaces.
  text = text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { reasoningRemoved, markdown: text, plainText: markdownToPlain(text), codeBlocks, jsonBlocks };
}

/** Markdown to readable plain text (for tickets, emails, chat apps). */
export function markdownToPlain(markdown: string): string {
  const blocks: string[] = [];
  const withoutCode = markdown.replace(/```[^\n]*\n([\s\S]*?)```/g, (_w, body: string) => {
    blocks.push(body.replace(/\n$/, ""));
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const plain = withoutCode
    .replace(/^#{1,6}\s+(.*)$/gm, (_w, title: string) => title.toUpperCase())
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/^---+$/gm, "");
  return plain.replace(/\u0000(\d+)\u0000/g, (_w, index: string) => blocks[Number(index)]).replace(/\n{3,}/g, "\n\n").trim();
}
