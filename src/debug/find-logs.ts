/**
 * Finds debug output statements (console.log, print, System.out.println,
 * Console.WriteLine, debugPrint, …) and plans their removal so the code
 * around them keeps working: only statements that stand on their own lines
 * are removed, and a block a removal would leave empty gets `pass` (Python)
 * or `break` (a Swift or Dart switch case).
 */
import * as path from "path";
import {
  CODE, COMMENT, EXTENSIONS, Lexed, LogLanguage, SCRIPT_BLOCK_EXTENSIONS,
  bracketStacks, codeOfLine, indentOf, isBlankOrComment, lex, lineEndOffset, lineOf, matchingBracket, scriptBlocks
} from "./syntax";

export interface DebugStatement {
  language: LogLanguage;
  /** What was called, e.g. "console.log", "print", "System.out.println". */
  kind: string;
  /** 1-based line. */
  line: number;
  /** The exact source of the statement, including a trailing semicolon. */
  text: string;
  startOffset: number;
  endOffset: number;
  /** False when removing it could change what the surrounding code does. */
  removable: boolean;
  /** Why it has to be reviewed by hand, when it is not removable. */
  reason?: string;
}

const CALLS: Record<LogLanguage, string[]> = {
  javascript: [
    String.raw`console\s*\.\s*(?:log|debug|info|trace|dir|dirxml|table|count|countReset|time|timeEnd|timeLog|group|groupCollapsed|groupEnd)\s*\(`
  ],
  python: [String.raw`print\s*\(`, String.raw`pprint\s*(?:\.\s*pprint\s*)?\(`, String.raw`breakpoint\s*\(`, String.raw`i?pdb\s*\.\s*set_trace\s*\(`],
  java: [String.raw`System\s*\.\s*(?:out|err)\s*\.\s*(?:println|print|printf|format)\s*\(`, String.raw`Log\s*\.\s*[dv]\s*\(`],
  kotlin: [String.raw`println\s*\(`, String.raw`print\s*\(`, String.raw`System\s*\.\s*(?:out|err)\s*\.\s*(?:println|print|printf)\s*\(`, String.raw`Log\s*\.\s*[dv]\s*\(`],
  csharp: [
    // Insert Debug Log writes System.Console when the file has no "using System;".
    String.raw`(?:System\s*\.\s*)?Console\s*\.\s*(?:WriteLine|Write)\s*\(`,
    String.raw`(?:System\s*\.\s*Diagnostics\s*\.\s*)?Debug\s*\.\s*(?:WriteLine|Write|Print)\s*\(`,
    String.raw`(?:System\s*\.\s*Diagnostics\s*\.\s*)?Debugger\s*\.\s*Break\s*\(`
  ],
  dart: [String.raw`print\s*\(`, String.raw`debugPrint\s*\(`, String.raw`debugger\s*\(`],
  swift: [String.raw`(?:Swift\s*\.\s*)?print\s*\(`, String.raw`debugPrint\s*\(`, String.raw`dump\s*\(`, String.raw`NSLog\s*\(`]
};

const PATTERNS = Object.fromEntries(Object.entries(CALLS).map(([language, calls]) => {
  const extra = language === "javascript" ? [String.raw`debugger\b(?![ \t]*[(.:=\w$])`] : [];
  return [language, new RegExp([...calls, ...extra].join("|"), "g")];
})) as Record<LogLanguage, RegExp>;

/** Every debug statement in a source file, or [] for a file type that is not scanned. */
export function findDebugStatementsInFile(text: string, filePath: string): DebugStatement[] {
  const ext = path.extname(filePath).toLowerCase();
  const language = EXTENSIONS[ext];
  if (language) return findDebugStatements(text, language);
  if (!SCRIPT_BLOCK_EXTENSIONS.includes(ext)) return [];
  return scriptBlocks(text).flatMap(block => findDebugStatements(text, "javascript", block));
}

/**
 * A logger call Insert Debug Log wrote through the project's logger (logger.debug, log.debug, _logger.LogDebug):
 * recognised by its "[File.ext:line]" label, so real logging is never touched.
 */
const LABELLED_LOGGER = /(?:\b(?:this|self)\s*\.\s*)?\b[A-Za-z_]\w*\s*\.\s*(?:debug|LogDebug)\s*\(/g;
const LABEL = /^\s*(?:[f$@]|\$@|@\$)?["'`]\[[^\]\s"'`]+\.\w+:\d+\]/;

export function findDebugStatements(text: string, language: LogLanguage, range?: { start: number; end: number }): DebugStatement[] {
  const lexed = lex(text, language, range);
  const stacks = bracketStacks(lexed);
  const found: DebugStatement[] = [];
  for (const [source, labelled] of [[PATTERNS[language].source, false], [LABELLED_LOGGER.source, true]] as Array<[string, boolean]>) {
    if (labelled && language === "javascript") continue;
    found.push(...collect(text, lexed, stacks, language, new RegExp(source, "g"), labelled, range));
  }
  return found.sort((a, b) => a.startOffset - b.startOffset);
}

function collect(text: string, lexed: Lexed, stacks: ReturnType<typeof bracketStacks>, language: LogLanguage, pattern: RegExp, labelled: boolean, range?: { start: number; end: number }): DebugStatement[] {
  pattern.lastIndex = range?.start ?? 0;
  const found: DebugStatement[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index;
    if (range && start >= range.end) break;
    const before = text[start - 1];
    // A method of some other object (logger.print, foo?.print) or part of a longer name is not a debug call.
    if (lexed.mask[start] !== CODE || (before && /[\w$.]/.test(before)) || lexed.mask[start + match[0].length - 1] !== CODE) continue;
    if (labelled && !LABEL.test(text.slice(start + match[0].length, start + match[0].length + 200))) continue;
    let end: number;
    if (match[0].endsWith("(")) {
      const close = matchingBracket(lexed, start + match[0].length - 1);
      if (close < 0) continue;
      end = close + 1;
    } else {
      end = start + match[0].length;
    }
    if (text[end] === ";") end++;
    pattern.lastIndex = end;
    const kind = match[0].replace(/\s+/g, "").replace(/\($/, "");
    const statement: DebugStatement = { language, kind, line: lineOf(lexed, start) + 1, text: text.slice(start, end), startOffset: start, endOffset: end, removable: true };
    const reason = blockingReason(lexed, stacks, statement);
    if (reason) { statement.removable = false; statement.reason = reason; }
    found.push(statement);
  }
  return found;
}

/** Why removing this statement on its own could break or change the code; undefined when it is safe. */
function blockingReason(lexed: Lexed, stacks: ReturnType<typeof bracketStacks>, s: DebugStatement): string | undefined {
  const { text, mask } = lexed;
  const line = s.line - 1;
  const lineStart = lexed.lineStarts[line];
  if (text.slice(lineStart, s.startOffset).trim()) return "Shares its line with other code.";
  const endLine = lineOf(lexed, Math.max(s.startOffset, s.endOffset - 1));
  const lineEnd = lineEndOffset(lexed, endLine);
  for (let i = s.endOffset; i < lineEnd; i++) if (mask[i] !== COMMENT && !/\s/.test(text[i])) return "Shares its line with other code.";

  const open = line > 0 ? stacks[line - 1] : [];
  const top = open[open.length - 1];
  if (s.language === "python" ? open.length > 0 : top && top.ch !== "{") return "Is part of a larger expression.";

  let previous = line - 1;
  while (previous >= 0 && isBlankOrComment(lexed, previous)) previous--;
  if (previous < 0) return undefined;
  const code = codeOfLine(lexed, previous).trim();
  if (s.language === "python") return code.endsWith("\\") ? "Continues the line above." : undefined;
  if (/(?:^|[^\w$])(?:else|do)$/.test(code)) return "Is the body of an if/else or loop without braces.";
  if (code.endsWith(")") && bracelessHeader(lexed, previous)) return "Is the body of an if/else or loop without braces.";
  if (/(?:=>|->|=|\?|&&|\|\||[*,.(\[]|(?<!\+)\+|(?<!-)-)$/.test(code) || /(?:^|[^\w$])return$/.test(code)) return "Continues the expression on the line above.";
  if (code.endsWith(":") && !/^(?:case\b.*|default|@unknown\s+default|[A-Za-z_$][\w$]*)\s*:$/.test(code)) return "Continues the expression on the line above.";
  return undefined;
}

/** True when the line ends with the `)` of an if/for/while header that has no brace. */
function bracelessHeader(lexed: Lexed, line: number): boolean {
  const { text, mask } = lexed;
  let close = lineEndOffset(lexed, line) - 1;
  while (close >= 0 && (mask[close] !== CODE || /\s/.test(text[close]))) close--;
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (mask[i] !== CODE) continue;
    if (text[i] === ")") depth++;
    else if (text[i] === "(" && --depth === 0) {
      const head = text.slice(lexed.lineStarts[lineOf(lexed, i)], i).trim();
      return /(?:^|[^\w$])(?:if|for|foreach|while|using|lock|fixed)\s*$/.test(head);
    }
  }
  return false;
}

export interface TextEdit { start: number; end: number; text: string }

/**
 * The edits that remove these statements from `text`, in descending order
 * so they can be applied one after another. Statements that are not
 * removable, or whose text no longer matches, are skipped and returned in
 * `skipped`.
 */
export function planRemovals(text: string, statements: DebugStatement[]): { edits: TextEdit[]; skipped: DebugStatement[] } {
  const edits: TextEdit[] = [];
  const skipped: DebugStatement[] = [];
  let current = text;
  for (const s of [...statements].sort((a, b) => b.startOffset - a.startOffset)) {
    if (!s.removable || current.slice(s.startOffset, s.endOffset) !== s.text) { skipped.push(s); continue; }
    const lineStart = current.lastIndexOf("\n", s.startOffset - 1) + 1;
    const newline = current.indexOf("\n", s.endOffset);
    const end = newline < 0 ? current.length : newline + 1;
    const replacement = placeholderFor(current, s.language, lineStart, end, indentOf(current.slice(lineStart)));
    edits.push({ start: lineStart, end, text: replacement });
    current = current.slice(0, lineStart) + replacement + current.slice(end);
  }
  return { edits, skipped };
}

/** "pass" or "break" when deleting the lines would leave an empty Python block or switch case. */
function placeholderFor(text: string, language: LogLanguage, start: number, end: number, indent: string): string {
  if (language !== "python" && language !== "swift" && language !== "dart") return "";
  const comment = language === "python" ? "#" : "//";
  const isCode = (line: string) => line.trim() !== "" && !line.trim().startsWith(comment);
  const before = text.slice(0, start).split("\n");
  before.pop();
  let previous: string | undefined;
  while (before.length) { const candidate = before.pop()!; if (isCode(candidate)) { previous = candidate; break; } }
  const next = text.slice(end).split("\n").find(isCode);
  if (!previous || !previous.trimEnd().endsWith(":")) return "";
  const eol = text[end - 2] === "\r" ? "\r\n" : "\n";
  if (language === "python") {
    const opener = indentOf(previous).length;
    if (opener >= indent.length) return "";
    return next === undefined || indentOf(next).length <= opener ? `${indent}pass${eol}` : "";
  }
  if (!/^\s*(?:case\b.*|default|@unknown\s+default)\s*:\s*$/.test(previous)) return "";
  const nextTrimmed = next?.trim() ?? "";
  const caseEnds = !next || /^(?:case\b|default\b|@unknown\b|\})/.test(nextTrimmed);
  return caseEnds ? `${indent}${language === "dart" ? "break;" : "break"}${eol}` : "";
}

/** Applies planned edits (already in descending order) to a string. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let result = text;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
