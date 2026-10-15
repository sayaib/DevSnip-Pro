/**
 * Plans a language-appropriate debug log for an expression: which line it
 * goes on, how it is indented, and which logging call the file already uses
 * (SLF4J or Lombok in Spring Boot, ILogger in ASP.NET Core, the logging
 * module in Python, debugPrint in Flutter, android.util.Log, os.Logger).
 */
import { CODE, LANGUAGE_IDS, STRING, Lexed, LogLanguage, codeOfLine, indentOf, isBlankOrComment, lex, lineEndOffset, lineOf, matchingBracket } from "./syntax";

export interface InsertRequest {
  /** VS Code language id of the document. */
  languageId: string;
  text: string;
  /** 0-based line and column of the expression. */
  line: number;
  column: number;
  expression: string;
  fileName: string;
  /** One level of indentation in this editor ("  ", "    " or "\t"). */
  indentUnit: string;
}

export interface InsertPlan {
  /** 0-based line the log is inserted before (may equal the line count, to append). */
  line: number;
  /** The log line, indented, without a line break. */
  text: string;
  /** Which logging call was chosen, for the status message. */
  via: string;
}

export function isSupportedLanguage(languageId: string): boolean {
  return languageId in LANGUAGE_IDS;
}

const MEMBER_CHAIN = /[A-Za-z_$][\w$]*(?:(?:\?\.|!!\.|!\.|\.)[A-Za-z_$][\w$]*)*/g;

/** The identifier or member chain (user.profile?.name) under the cursor. */
export function expressionAt(lineText: string, column: number): { text: string; start: number } | undefined {
  for (const match of lineText.matchAll(MEMBER_CHAIN)) {
    const start = match.index ?? 0;
    if (column >= start && column <= start + match[0].length) return { text: match[0], start };
  }
  return undefined;
}

export function planDebugLog(request: InsertRequest): InsertPlan | undefined {
  const language = LANGUAGE_IDS[request.languageId];
  const expression = request.expression.trim();
  if (!language || !expression || /[\r\n]/.test(expression)) return undefined;
  // `_` is a discard in C#, Java, Kotlin, Swift and Dart (out var _, let _ = …), not a value; in JS and Python it is a name.
  if (expression === "_" && language !== "javascript" && language !== "python") return undefined;
  const lexed = lex(request.text, language);
  // A name in a comment or a string is not something the program can log.
  const at = (lexed.lineStarts[request.line] ?? 0) + request.column;
  if (at < lexed.text.length && lexed.mask[at] !== CODE) return undefined;
  const lines = lineDepths(lexed);
  const topLevelOk = language === "javascript" || language === "python" || (language === "swift" && request.fileName === "main.swift");
  const placement = place(lexed, lines, language, Math.min(request.line, lexed.lineStarts.length - 1), request.column, expression, request.indentUnit, topLevelOk);
  if (!placement) return undefined;
  const label = `${request.fileName}:${request.line + 1}`;
  const statement = logStatement(language, request, escapeKeyword(language, expression), label);
  return { line: placement.line, text: placement.indent + statement.code, via: statement.via };
}

interface LineDepth {
  /** Brackets open at the end of the line, innermost last. */
  end: Array<{ ch: string; offset: number }>;
  /** The fewest brackets open at any point on the line. */
  min: number;
}

function lineDepths(lexed: Lexed): LineDepth[] {
  const { text, mask, lineStarts } = lexed;
  const out: LineDepth[] = [];
  const stack: Array<{ ch: string; offset: number }> = [];
  for (let line = 0; line < lineStarts.length; line++) {
    let min = stack.length;
    const end = lineEndOffset(lexed, line);
    for (let i = lineStarts[line]; i < end; i++) {
      if (mask[i] !== CODE) continue;
      const ch = text[i];
      if (ch === "(" || ch === "[" || ch === "{") stack.push({ ch, offset: i });
      else if (ch === ")" || ch === "]" || ch === "}") { stack.pop(); min = Math.min(min, stack.length); }
    }
    out.push({ end: stack.slice(), min });
  }
  return out;
}

/** Text before a name a loop or catch header declares: "for (", "foreach (var ", "for (String ", "catch (". */
const BOUND_IN_LOOP = /\(\s*(?:(?:var|let|val|const|final|[\w.<>,[\]?]+)\s+)?$/;
/** Text before a name a condition declares: "if let ", "while var ", "out var ", "is Order ". */
const BOUND_IN_CONDITION = /(?:\b(?:var|let|val|const|final)|\bout\s+[\w.<>,[\]?]+|\bis\s+[\w.<>,[\]?]+)\s+$/;
const CONTINUES_NEXT = /(?:[=+\-*/%&|^<>?:,.(\[]|=>|->|&&|\|\||\?\?)$/;
/** True when a line's last token carries the expression on: an operator, comma or open bracket, but not a generic's closing `>`. */
function continuesNext(code: string): boolean {
  if (!CONTINUES_NEXT.test(code)) return false;
  if (code.endsWith(">") && !/(?:->|=>|>>)$/.test(code)) {
    const angles = code.replace(/->|=>|>=|<=/g, "");
    if ((angles.match(/</g) ?? []).length === (angles.match(/>/g) ?? []).length) return false; // Comparable<T>, List<int>
  }
  return true;
}
const CONTINUES_PREVIOUS = /^(?:\?\.|\.|\)|\]|\+|-|\*|\/|&&|\|\||\?\?|\?|:|=>|,)/;

function place(lexed: Lexed, lines: LineDepth[], language: LogLanguage, cursorLine: number, column: number, expression: string, unit: string, topLevelOk: boolean): { line: number; indent: string } | undefined {
  const count = lexed.lineStarts.length;
  const lineText = (k: number) => lexed.text.slice(lexed.lineStarts[k], lineEndOffset(lexed, k));
  const codeAt = (k: number) => codeOfLine(lexed, k).trim();
  const nextCode = (k: number) => { let n = k + 1; while (n < count && isBlankOrComment(lexed, n)) n++; return n < count ? n : -1; };
  const startDepth = (k: number) => (k > 0 ? lines[k - 1].end.length : 0);
  const pythonic = language === "python";

  // Walk up to the first line of the statement the cursor is in.
  let start = cursorLine;
  for (let guard = 0; guard < 200; guard++) {
    const open = start > 0 ? lines[start - 1].end : [];
    const top = open[open.length - 1];
    if (top && (pythonic || top.ch !== "{" || isLiteralBrace(lexed, top.offset, language))) { start = lineOf(lexed, top.offset); continue; }
    let previous = start - 1;
    while (previous >= 0 && isBlankOrComment(lexed, previous)) previous--;
    if (previous < 0) break;
    const previousCode = codeAt(previous);
    const continues = pythonic
      ? previousCode.endsWith("\\")
      : (continuesNext(previousCode) && !/^(?:case\b.*|default)\s*:$/.test(previousCode)) || CONTINUES_PREVIOUS.test(codeAt(start))
        // Swift: if / guard / while alone on a line, with its conditions below.
        || /^(?:\}\s*)?(?:else\s+)?(?:if|while|guard)$/.test(previousCode);
    if (!continues || previousCode.endsWith("{") || previousCode.endsWith(";") || previousCode.endsWith("}")) break;
    start = previous;
  }
  // Nothing can run between a decorator or annotation and what it decorates.
  if (codeAt(start).startsWith("@")) return undefined;
  // Statements may not stand in a class body (fields live there) or, in most languages, at the top level of a file.
  // (Checked only where the log would go at this statement's level; a method's own body is always fine.)
  let blockedHere = false;
  if (!pythonic) {
    const enclosing = (start > 0 ? lines[start - 1].end : []).filter(b => b.ch === "{").pop();
    blockedHere = enclosing ? isTypeBody(lexed, enclosing.offset) : !topLevelOk && !(language === "csharp" && !/\b(?:class|record|struct|interface|namespace)\s+\w/.test(lexed.text));
  }
  const baseIndent = indentOf(lineText(start));
  // A parameter of a function whose body is not a block (def f(x): ..., fun f(x) = x * 2) has nowhere to be logged.
  const declaration = /^(?:export\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|override\s+|async\s+)*(?:def|fun|func|function)\b/.test(codeAt(start));
  const parameterOfDeclaration = declaration && parenDepthBetween(lexed, lexed.lineStarts[start], lexed.lineStarts[cursorLine] + column) > 0;
  // A line whose break is inside a multi-line string (""", text block, template literal) continues.
  const inString = (k: number) => k + 1 < count && lexed.mask[lineEndOffset(lexed, k)] === STRING;
  const base = Math.min(startDepth(start), lines[start].min);
  // if let x = …, while let x = …, if (TryGet(k, out var x)), if (o is Order x): the binding exists only inside the block.
  // (guard let x = … keeps it in scope after the guard, so that stays an ordinary statement.)
  const beforeCursor = lexed.text.slice(lexed.lineStarts[cursorLine], lexed.lineStarts[cursorLine] + column);
  // A variable the header itself declares: for (x in xs), foreach (var x in xs), catch (e: E), if let x = ….
  const headerKeyword = /^(?:\}\s*)?(?:else\s+)?(for|foreach|while|if|catch)\b/.exec(codeAt(start))?.[1];
  const headerBinding = !pythonic && !!headerKeyword && (BOUND_IN_CONDITION.test(beforeCursor) || (/^(?:for|foreach|catch)$/.test(headerKeyword) && (BOUND_IN_LOOP.test(beforeCursor) || /\bfor\s+(?:case\s+(?:let|var)\s+)?$/.test(beforeCursor))));
  const conditionalBinding = !pythonic && /^(?:\}\s*)?(?:else\s+)?(?:if|while)\b/.test(codeAt(start))
    && /(?:\b(?:let|var|val|final)|\bout\s+(?:var|[\w.<>,[\]?]+)|\bis\s+[\w.<>,[\]?]+)\s+$/.test(beforeCursor);

  // A return or throw ends the block: log before it.
  if (/^(?:return|throw|raise|yield)\b/.test(codeAt(start))) return blockedHere ? undefined : { line: start, indent: baseIndent };

  // The next code line is a lone "{" that opens this line's block (not an object literal).
  const opensBlockBelow = (k: number) => {
    const next = nextCode(k);
    if (next < 0 || /[;{}]$/.test(codeAt(k)) || !codeAt(next).startsWith("{")) return false;
    return !isLiteralBrace(lexed, lexed.lineStarts[next] + lineText(next).indexOf("{"), language);
  };

  // The if whose first block opens at `brace` is used as a value: it follows =, return or opens a closure alone,
  // has an else, and every branch is a single line.
  const isIfExpression = (brace: number) => {
    // From "} else if let x = … {", go back to the chain's first if.
    let chainStart = start;
    let open = brace;
    for (let guard = 0; guard < 50 && codeAt(chainStart).startsWith("}"); guard++) {
      let depth = 0, p = lexed.lineStarts[chainStart] + lineText(chainStart).indexOf("}");
      for (; p >= 0; p--) {
        if (lexed.mask[p] !== CODE) continue;
        if (lexed.text[p] === "}") depth++;
        else if (lexed.text[p] === "{" && --depth === 0) break;
      }
      if (p < 0) return false;
      chainStart = lineOf(lexed, p);
      open = p;
    }
    let previous = chainStart - 1;
    while (previous >= 0 && isBlankOrComment(lexed, previous)) previous--;
    const before = previous >= 0 ? codeAt(previous) : "";
    const assigned = /(?:[^=!<>]=|\breturn)$/.test(before);
    if (!assigned && !/(?:\bin|\{)$/.test(before)) return false;
    let single = true, hasElse = false, valueBranch = false, lastClose = -1;
    const firstOpen = open;
    for (let guard = 0; guard < 50 && open >= 0; guard++) {
      const close = matchingBracket(lexed, open);
      if (close < 0) return false;
      lastClose = close;
      const bodyLines = Array.from({ length: Math.max(0, lineOf(lexed, close) - lineOf(lexed, open) - 1) }, (_, i) => lineOf(lexed, open) + 1 + i).filter(k => !isBlankOrComment(lexed, k));
      if (bodyLines.length > 1) single = false;
      // A branch that is a bare value (nil, a tuple, a literal, a name) rather than a call or statement.
      if (bodyLines.length === 1 && /^(?:\(|\[|"|nil\b|null\b|true\b|false\b|\d|\.[a-z]|[A-Za-z_][\w.]*$)/.test(codeAt(bodyLines[0]))) valueBranch = true;
      const after = lexed.text.slice(close + 1).match(/^\s*else\b\s*(?:if\b[^{]*)?\{/);
      if (!after) break;
      hasElse = true;
      open = close + 1 + after[0].length - 1;
    }
    if (!hasElse || !single) return false;
    if (assigned || valueBranch) return true;
    // The chain is the only statement of a function or closure that returns a value, and nothing in it returns.
    const enclosing = (chainStart > 0 ? lines[chainStart - 1].end : []).filter(b => b.ch === "{").pop();
    if (!enclosing || /\breturn\b/.test(lexed.text.slice(firstOpen, lastClose))) return false;
    const enclosingClose = matchingBracket(lexed, enclosing.offset);
    const onlyCode = (from: number, to: number) => { for (let i = from; i < to; i++) if (lexed.mask[i] === CODE && !/\s/.test(lexed.text[i])) return false; return true; };
    if (enclosingClose < 0 || !onlyCode(lastClose + 1, enclosingClose)) return false;
    const headerStart = lexed.lineStarts[Math.max(0, lineOf(lexed, enclosing.offset) - 5)];
    const header = lexed.text.slice(headerStart, enclosing.offset).split("}").pop() ?? "";
    return returnsValue(header);
  };

  const inside = (k: number) => {
    const next = nextCode(k);
    const nextIndent = next >= 0 ? indentOf(lineText(next)) : "";
    return { line: k + 1, indent: next >= 0 && nextIndent.length > baseIndent.length ? nextIndent : baseIndent + unit };
  };

  let end = start;
  // Only the first block the statement opens can take parameters; braces nested in its body cannot.
  let firstBlock = true;
  for (let k = start; k < count; k++) {
    end = k;
    const depth = lines[k].end;
    if (pythonic) {
      if (depth.length <= base) {
        if (codeAt(k).endsWith(":")) return inside(k);
        if (parameterOfDeclaration) return undefined;
        const last = lexed.lineStarts[k] + codeOfLine(lexed, k).length - 1;
        if ((lexed.text[last] === "\\" && lexed.mask[last] === CODE) || inString(k)) continue;
        break;
      }
      continue;
    }
    const top = depth[depth.length - 1];
    if (firstBlock && top && top.ch === "{" && lineOf(lexed, top.offset) === k) {
      firstBlock = false;
      // class C(ILogger logger) { / class A(val x: Int) {: constructor parameters cannot be logged in a class body.
      if (isTypeBody(lexed, top.offset) && lexed.lineStarts[cursorLine] + column < top.offset) return undefined;
      // fun area(side: Double) =\n    when {: the brace belongs to the expression body, not to the function.
      if (parameterOfDeclaration && /\)\s*(?::\s*[^={]+)?=(?![=>])/.test(Array.from({ length: k - start + 1 }, (_, i) => codeAt(start + i)).join(" ").slice(0, top.offset - lexed.lineStarts[start] + 1 + k - start))) return undefined;
      // Swift 5.9 / Kotlin if-expressions (… = if let x = y { x } else { z }): a statement in a branch would end the expression.
      if (conditionalBinding && (language === "swift" || language === "kotlin") && isIfExpression(top.offset)) return undefined;
      if (conditionalBinding || headerBinding || isParameter(lexed, cursorLine, column, expression, top.offset, language)) {
        // A Swift closure parameter that is not @escaping cannot be passed to String(describing:).
        if (language === "swift" && /^\s*:\s*(?:@(?!escaping)\w+\s+)*\((?!\s*\()/.test(lexed.text.slice(lexed.lineStarts[cursorLine] + column + expression.length, top.offset))) return undefined;
        // func f() -> T { expression }: Swift returns a lone expression implicitly; a log line before it would drop the return.
        if (language === "swift" && !conditionalBinding && !headerBinding && returnsValue(lexed.text.slice(lexed.lineStarts[start], top.offset))) {
          const close = matchingBracket(lexed, top.offset);
          const body = close < 0 ? [] : Array.from({ length: Math.max(0, lineOf(lexed, close) - k - 1) }, (_, i) => k + 1 + i).filter(n => !isBlankOrComment(lexed, n));
          // One statement, even across lines: every later line is inside its brackets, continues it or closes them.
          const bodyDepth = lines[k].end.length;
          const oneStatement = body.length > 0 && body.slice(1).every(n => startDepth(n) > bodyDepth || inString(n - 1) || CONTINUES_PREVIOUS.test(codeAt(n)) || /^[)\]}]/.test(codeAt(n)));
          const first = body.length ? codeAt(body[0]) : "";
          // An if / switch with no return in it is an if-expression: the value of the function or closure.
          const expressionStatement = /^(?:if|switch)\b/.test(first) ? !/\breturn\b/.test(lexed.text.slice(top.offset, close)) : !/^(?:return|let|var|guard|for|while|throw|defer|do|repeat|_\s*=)\b/.test(first);
          if (oneStatement && expressionStatement) return undefined;
        }
        // A C# out parameter has no value until the method assigns it.
        if (!conditionalBinding && !headerBinding && language === "csharp" && /\bout\s+[\w.<>,[\]?]+\s+$/.test(beforeCursor)) return undefined;
        return inside(k);
      }
    }
    // A header that continues on the next line (if a,\n   let b = c {) or whose block opens on the next line
    // (Allman style, usual in C#: foreach (var x in xs)\n{) has not reached its block yet.
    const header = codeAt(k);
    const continuesHeader = (continuesNext(header) && !/^(?:case\b.*|default)\s*:$/.test(header)) || opensBlockBelow(k) || /^(?:\}\s*)?(?:else\s+)?(?:if|while|guard)$/.test(header);
    if (depth.length <= base && !(firstBlock && continuesHeader)) break;
  }

  // Method chains and operators that continue on the next line belong to the same statement.
  if (!pythonic) {
    for (let guard = 0; guard < 200; guard++) {
      const next = nextCode(end);
      if (next < 0) break;
      const joins = CONTINUES_PREVIOUS.test(codeAt(next)) || (continuesNext(codeAt(end)) && !codeAt(end).endsWith(":")) || /^(?:else|catch|finally)\b/.test(codeAt(next)) || /^while\b.*\)\s*;?$/.test(codeAt(next)) && codeAt(end).endsWith("}")
        // A block or an initializer that opens on the next line (Allman style) continues the statement.
        || (codeAt(next).startsWith("{") && !/[;{}]$/.test(codeAt(end)));
      if (!joins) break;
      end = next;
      while (end + 1 < count && lines[end].end.length > base) end++;
    }
  }
  while (inString(end)) end++;
  if (parameterOfDeclaration || blockedHere) return undefined;
  // for (j in 0 until i) best = max(best, j): the loop variable lives only in a body without braces.
  if (headerBinding && firstBlock) return undefined;
  // var temp: Comparable<T> / int count; / lateinit var view: View: declared without a value, so there is nothing to log yet.
  const statementCode = Array.from({ length: end - start + 1 }, (_, i) => codeAt(start + i)).join(" ");
  const name = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!/[^=!<>]=(?![=>])/.test(statementCode) && new RegExp(`^(?:(?:private|public|protected|internal|final|static|readonly|lateinit|const)\\s+)*(?:var|val|let|[\\w.<>[\\],?]+)\\s+${name}\\s*(?::\\s*[^=;]+)?;?$`).test(statementCode)) return undefined;
  // foreach (var p in ps)\n    Use(p);: a line after the header would become the loop's body. A variable the header
  // declares has nowhere to be logged without adding braces; anything else is logged before the statement.
  if (!pythonic && bracelessBody(lexed, end) && !opensBlockBelow(end)) {
    if (headerBinding) return undefined;
    return { line: start, indent: baseIndent };
  }
  return { line: end + 1, indent: baseIndent };
}

/** True when the line ends an if / for / foreach / while / using / lock header, else or do, whose body has no braces. */
function bracelessBody(lexed: Lexed, line: number): boolean {
  const code = codeOfLine(lexed, line).trim();
  if (/(?:^|[^\w$])(?:else|do)$/.test(code)) return true;
  if (!code.endsWith(")")) return false;
  const { text, mask } = lexed;
  let depth = 0;
  for (let i = lexed.lineStarts[line] + codeOfLine(lexed, line).lastIndexOf(")"); i >= 0; i--) {
    if (mask[i] !== CODE) continue;
    if (text[i] === ")") depth++;
    else if (text[i] === "(" && --depth === 0) {
      const head = text.slice(lexed.lineStarts[lineOf(lexed, i)], i).trim();
      return /(?:^|[^\w$])(?:if|for|foreach|while|using|lock|fixed)\s*$/.test(head);
    }
  }
  return false;
}

/** True when the brace opens a class, interface, struct, enum, record, object, extension or namespace body. */
function isTypeBody(lexed: Lexed, brace: number): boolean {
  const lineStart = lexed.lineStarts[lineOf(lexed, brace)];
  let header = lexed.text.slice(lineStart, brace);
  // The header may be on the line above (Allman style: "class A\n{").
  if (!header.trim() && lineOf(lexed, brace) > 0) header = codeOfLine(lexed, lineOf(lexed, brace) - 1);
  // C# and Java methods may return `object`: object Get() { is a method, not a Kotlin object declaration.
  if (/(?:^|[^\w$.])object\s+[\w$]+\s*(?:<[^>]*>\s*)?\(/.test(header)) return false;
  return /(?:^|[^\w$.])(?:class|interface|struct|enum|record|object|extension|protocol|mixin|namespace|trait)\b(?![\w$]*\s*[(:=])/.test(header) && !/=>|->|\bnew\b/.test(header);
}

/** How many parentheses opened after `from` are still open at `to` (code only). */
function parenDepthBetween(lexed: Lexed, from: number, to: number): number {
  let depth = 0;
  for (let i = from; i < to && i < lexed.text.length; i++) {
    if (lexed.mask[i] !== CODE) continue;
    if (lexed.text[i] === "(") depth++;
    else if (lexed.text[i] === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** True when the expression is a parameter of the block opened at `brace`: function, loop, catch or lambda. */
function isParameter(lexed: Lexed, line: number, column: number, expression: string, brace: number, language: LogLanguage): boolean {
  const at = lexed.lineStarts[line] + column;
  if (lineOf(lexed, brace) !== line) {
    // var items = xs.Select(x =>\n{ … }) or var ctx = Ctx(\n  retain: { info in …: the expression is being assigned.
    if (/^\s*(?::[^=\n]*)?=(?![=>])/.test(lexed.text.slice(at + expression.length, brace))) return false;
    // The expression sits on an earlier line of a multi-line signature.
    return at < brace;
  }
  if (isLiteralBrace(lexed, brace, language)) return false; // hook({ … }): an object literal, not a body
  if (at > brace) return true; // { item -> … } or { item in … }
  const between = lexed.text.slice(at + expression.length, brace);
  // const handler = (req) => {: the expression is being assigned, so it exists only after the statement.
  if (/^\s*(?::[^=]*)?=(?![=>])/.test(between)) return false;
  // app.get(…, (req, res) => {: the expression is the function being called, not a parameter.
  if (/^\s*[(.]/.test(between)) return false;
  return /\)|=>|->/.test(between);
}

/**
 * An object, array or initializer literal rather than a block: `= {`, `({`, `, {`, `: {`, `return {`.
 * In Swift and Kotlin a brace is always code (a closure or a lambda): their collection literals use [ ].
 */
function isLiteralBrace(lexed: Lexed, brace: number, language: LogLanguage): boolean {
  if (language === "swift" || language === "kotlin") return false;
  const { text, mask } = lexed;
  let p = brace - 1;
  while (p >= 0 && /\s/.test(text[p])) p--;
  if (p < 0) return false;
  if ("=(,:[?".includes(text[p]) && text.slice(p - 1, p + 1) !== "=>") return true;
  // C# object and collection initializers: new Options\n{, new List<int>()\n{, new[]\n{, new()\n{ — but not
  // the block of using (var s = new MemoryStream())\n{, whose ")" closes the using header.
  let q = p;
  if (text[q] === ")") {
    let depth = 0;
    for (; q >= 0; q--) {
      if (mask[q] !== CODE) continue;
      if (text[q] === ")") depth++;
      else if (text[q] === "(" && --depth === 0) break;
    }
    q--;
  }
  if (/\bnew\s*(?:[\w.]+\s*(?:<[^;{}()]*>)?\s*)?(?:\[\s*\]\s*)?$/.test(text.slice(Math.max(0, q - 200), q + 1))) return true;
  return /(?:^|[^\w$])return$/.test(text.slice(Math.max(0, p - 6), p + 1));
}

interface Statement { code: string; via: string }

function logStatement(language: LogLanguage, request: InsertRequest, expression: string, label: string): Statement {
  const text = request.text;
  switch (language) {
    case "javascript": {
      const quote = prefersSingleQuotes(text) ? "'" : '"';
      const semi = usesSemicolons(text) ? ";" : "";
      return { code: `console.log(${quoted(`[${label}] ${expression}:`, quote)}, ${expression})${semi}`, via: "console.log" };
    }
    case "python": {
      const logger = /^([A-Za-z_]\w*)\s*=\s*logging\.getLogger\(/m.exec(text)?.[1];
      if (logger) return { code: `${logger}.debug(${quoted(`[${label}] ${expression}=%r`.replace(/%(?!r$)/g, "%%"), '"')}, ${expression})`, via: `${logger}.debug` };
      const outer = expression.includes('"') ? "'" : '"';
      if (!/[\\\n]/.test(expression) && !expression.includes(outer) && !/[!:{}]/.test(expression)) {
        return { code: `print(f${outer}[${label.replace(/[{}]/g, m => m + m)}] {${expression}=}${outer})`, via: "print" };
      }
      return { code: `print(${quoted(`[${label}] ${expression} =`, '"')}, repr(${expression}))`, via: "print" };
    }
    case "java": {
      const logger = javaLogger(text);
      if (logger) return { code: `${logger}.debug(${quoted(`[${label}] ${expression}={}`, '"')}, ${expression});`, via: `${logger}.debug` };
      if (/^import\s+android\.util\.Log\s*;/m.test(text)) return { code: `Log.d(${androidTag(text, request.fileName)}, ${quoted(`[${label}] ${expression}=`, '"')} + ${wrap(expression)});`, via: "Log.d" };
      return { code: `System.out.println(${quoted(`[${label}] ${expression}=`, '"')} + ${wrap(expression)});`, via: "System.out.println" };
    }
    case "kotlin": {
      const slf4j = /\b(?:val|var)\s+(\w+)\s*(?::\s*Logger\s*)?=\s*LoggerFactory\.getLogger/.exec(text)?.[1];
      const template = (prefix: string) => `"${escapeKotlin(prefix)}\${${expression}}"`;
      if (slf4j) return { code: `${slf4j}.debug(${quoted(`[${label}] ${expression}={}`, '"').replace(/\$/g, "\\$")}, ${expression})`, via: `${slf4j}.debug` };
      if (/^import\s+android\.util\.Log\s*$/m.test(text)) return { code: `Log.d(${androidTag(text, request.fileName)}, ${template(`[${label}] ${expression}=`)})`, via: "Log.d" };
      return { code: `println(${template(`[${label}] ${expression}=`)})`, via: "println" };
    }
    case "csharp": {
      const logger = csharpLogger(text);
      if (logger) {
        const hole = (expression.split(/[^\w]+/).filter(Boolean).pop() ?? "value").replace(/^\w/, c => c.toUpperCase());
        const message = `[${label}] ${expression}=`.replace(/[{}]/g, m => m + m) + `{${hole}}`;
        return { code: `${logger}.LogDebug(${quoted(message, '"')}, ${expression});`, via: `${logger}.LogDebug` };
      }
      const console = /^\s*using\s+System\s*;/m.test(text) ? "Console" : "System.Console";
      const prefix = `[${label}] ${expression}=`.replace(/[{}]/g, m => m + m);
      const hole = /[?:]/.test(expression) ? `(${expression})` : expression;
      return { code: `${console}.WriteLine($${quoted(prefix, '"').slice(0, -1)}{${hole}}");`, via: `${console}.WriteLine` };
    }
    case "dart": {
      const fn = /^import\s+['"]package:flutter\//m.test(text) ? "debugPrint" : "print";
      return { code: `${fn}('${escapeDart(`[${label}] ${expression}=`)}\${${expression}}');`, via: fn };
    }
    case "swift": {
      const logger = /^import\s+os\b/m.test(text) ? /\b(?:let|var)\s+(\w+)\s*=\s*Logger\s*\(/.exec(text)?.[1] : undefined;
      if (logger) return { code: `${logger}.debug("${escapeSwift(`[${label}] ${expression}=`)}\\(String(describing: ${expression}))")`, via: `${logger}.debug` };
      // Combine publishers (and any type with its own print method) shadow the global print inside their code.
      const fn = /^import\s+Combine\b/m.test(text) || /\bfunc\s+print\s*\(/.test(text) ? "Swift.print" : "print";
      return { code: `${fn}(${quoted(`[${label}] ${expression} =`, '"')}, String(describing: ${expression}))`, via: fn };
    }
  }
}

/** A Swift function header (up to its body's brace) declares a return type other than Void: "-> T" outside any parentheses. */
function returnsValue(header: string): boolean {
  let flat = header;
  for (let previous = ""; previous !== flat;) { previous = flat; flat = flat.replace(/\([^()]*\)/g, "()"); }
  return /->\s*(?!Void\b|\(\)\s*(?:where\b|$))\S/.test(flat);
}

const SWIFT_KEYWORDS = new Set(["associatedtype", "class", "deinit", "enum", "extension", "fileprivate", "func", "import", "init", "inout", "internal", "let", "open", "operator", "private", "protocol", "public", "rethrows", "static", "struct", "subscript", "typealias", "var", "break", "case", "continue", "default", "defer", "do", "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return", "switch", "where", "while", "as", "catch", "is", "throw", "throws", "try"]);
const KOTLIN_KEYWORDS = new Set(["as", "break", "class", "continue", "do", "else", "for", "fun", "if", "in", "interface", "is", "object", "package", "return", "throw", "try", "typealias", "typeof", "val", "var", "when", "while"]);

/** A parameter named after a keyword (Swift's `protocol`, Kotlin's `object`) is written in backticks. */
function escapeKeyword(language: LogLanguage, expression: string): string {
  if (language === "swift" && SWIFT_KEYWORDS.has(expression)) return `\`${expression}\``;
  if (language === "kotlin" && KOTLIN_KEYWORDS.has(expression)) return `\`${expression}\``;
  return expression;
}

function quoted(value: string, quote: string): string {
  return quote + value.replace(/\\/g, "\\\\").split(quote).join("\\" + quote) + quote;
}
const escapeKotlin = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
const escapeDart = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");
const escapeSwift = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const wrap = (expression: string) => (/^[\w$.()[\]]+$/.test(expression) ? expression : `(${expression})`);

function javaLogger(text: string): string | undefined {
  if (/^\s*@(?:Slf4j|Log4j2|XSlf4j)\b/m.test(text)) return "log";
  return /\b(?:org\.slf4j\.|org\.apache\.logging\.log4j\.)?Logger\s+(\w+)\s*=\s*(?:org\.slf4j\.|org\.apache\.logging\.log4j\.)?(?:LoggerFactory|LogManager)\s*\.\s*getLogger/.exec(text)?.[1];
}

function csharpLogger(text: string): string | undefined {
  const field = /\bILogger(?:<[^>]+>)?\s+(\w+)\s*[;=]/.exec(text)?.[1];
  if (field) return field;
  // A primary constructor parameter is in scope for the whole class.
  return /\b(?:class|record|struct)\s+\w+(?:<[^>]+>)?\s*\([^)]*\bILogger(?:<[^>]+>)?\s+(\w+)/.exec(text)?.[1];
}

function androidTag(text: string, fileName: string): string {
  if (/\b(?:static\s+final\s+String|const\s+val|val)\s+TAG\b/.test(text)) return "TAG";
  return `"${fileName.replace(/\.\w+$/, "").slice(0, 23)}"`;
}

function prefersSingleQuotes(text: string): boolean {
  const single = (text.match(/(?:^|[\s(,=:[{])'[^'\n]*'/g) ?? []).length;
  const double = (text.match(/(?:^|[\s(,=:[{])"[^"\n]*"/g) ?? []).length;
  return single > double;
}

function usesSemicolons(text: string): boolean {
  const lines = text.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("//") && !line.startsWith("*") && !/[{}(,[]$/.test(line));
  if (lines.length < 3) return true;
  return lines.filter(line => line.endsWith(";")).length * 2 >= lines.length;
}
