"use strict";
/**
 * Just enough lexing to tell code from comments and string literals in the
 * languages DevSnip Pro inserts and cleans debug logs for. The result is a
 * mask over the text, so the scanners above it can use plain string search
 * and still ignore a `print(` inside a comment or a quoted "console.log(".
 *
 * Pure and dependency-free: no VS Code, so it is unit-tested directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bracketStacks = exports.matchingBracket = exports.indentOf = exports.isBlankOrComment = exports.codeOfLine = exports.lineEndOffset = exports.lineOf = exports.scriptBlocks = exports.lex = exports.STRING = exports.COMMENT = exports.CODE = exports.LANGUAGE_LABELS = exports.SCRIPT_BLOCK_EXTENSIONS = exports.EXTENSIONS = exports.LANGUAGE_IDS = void 0;
/** VS Code language ids → the syntax family used for them. */
exports.LANGUAGE_IDS = {
    javascript: "javascript",
    typescript: "javascript",
    javascriptreact: "javascript",
    typescriptreact: "javascript",
    python: "python",
    java: "java",
    kotlin: "kotlin",
    csharp: "csharp",
    dart: "dart",
    swift: "swift"
};
/** File extensions → syntax family, for workspace scans. */
exports.EXTENSIONS = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "javascript", ".tsx": "javascript", ".mts": "javascript", ".cts": "javascript",
    ".py": "python",
    ".java": "java",
    ".kt": "kotlin", ".kts": "kotlin",
    ".cs": "csharp",
    ".dart": "dart",
    ".swift": "swift"
};
/** Files whose JavaScript lives in <script> blocks; only those blocks are scanned. */
exports.SCRIPT_BLOCK_EXTENSIONS = [".html", ".htm", ".vue", ".svelte", ".php"];
exports.LANGUAGE_LABELS = {
    javascript: "JavaScript / TypeScript",
    python: "Python",
    java: "Java",
    kotlin: "Kotlin",
    csharp: "C#",
    dart: "Dart / Flutter",
    swift: "Swift"
};
exports.CODE = 0;
exports.COMMENT = 1;
exports.STRING = 2;
const IDENT = /[\w$]/;
const isIdent = (ch) => !!ch && IDENT.test(ch);
const NESTED_COMMENTS = new Set(["kotlin", "swift", "dart"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);
function lex(text, language, range) {
    const mask = new Uint8Array(text.length);
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++)
        if (text.charCodeAt(i) === 10)
            lineStarts.push(i + 1);
    const start = range?.start ?? 0;
    const end = range?.end ?? text.length;
    // Outside an embedded <script> range everything counts as non-code.
    if (start > 0)
        mask.fill(exports.COMMENT, 0, start);
    if (end < text.length)
        mask.fill(exports.COMMENT, end);
    new Lexer(text, language, mask, end).code(start, undefined);
    return { text, mask, lineStarts };
}
exports.lex = lex;
class Lexer {
    constructor(t, lang, mask, end) {
        this.t = t;
        this.lang = lang;
        this.mask = mask;
        this.end = end;
    }
    /**
     * Scans code from `i` until `close` is found at depth zero (for string
     * interpolation holes) or the end. Returns the offset just after `close`.
     */
    code(i, close) {
        const { t, lang } = this;
        let depth = 0;
        while (i < this.end) {
            const ch = t[i];
            if (close) {
                if (ch === "{" || ch === "(")
                    depth++;
                else if ((ch === "}" || ch === ")") && depth-- === 0) {
                    if (ch === close)
                        return i + 1;
                    depth = 0;
                }
            }
            if (lang === "python") {
                if (ch === "#") {
                    i = this.fill(i, this.lineEnd(i), exports.COMMENT);
                    continue;
                }
            }
            else if (ch === "/" && t[i + 1] === "/") {
                i = this.fill(i, this.lineEnd(i), exports.COMMENT);
                continue;
            }
            else if (ch === "/" && t[i + 1] === "*") {
                i = this.blockComment(i);
                continue;
            }
            const str = this.stringAt(i);
            if (str !== undefined) {
                i = str;
                continue;
            }
            if (lang === "javascript" && ch === "/" && this.regexAllowed(i)) {
                const regexEnd = this.regexEnd(i);
                if (regexEnd > 0) {
                    i = this.fill(i, regexEnd, exports.STRING);
                    continue;
                }
            }
            i++;
        }
        return i;
    }
    fill(from, to, kind) {
        this.mask.fill(kind, from, Math.min(to, this.end));
        return to;
    }
    lineEnd(i) {
        const nl = this.t.indexOf("\n", i);
        return nl < 0 || nl > this.end ? this.end : nl;
    }
    blockComment(start) {
        const { t } = this;
        const nests = NESTED_COMMENTS.has(this.lang);
        let depth = 0;
        for (let i = start; i < this.end; i++) {
            if (t[i] === "/" && t[i + 1] === "*" && (nests || depth === 0)) {
                depth++;
                i++;
                continue;
            }
            if (t[i] === "*" && t[i + 1] === "/") {
                i++;
                if (--depth === 0)
                    return this.fill(start, i + 1, exports.COMMENT);
            }
        }
        return this.fill(start, this.end, exports.COMMENT);
    }
    /** If a string literal starts at `i`, marks it and returns its end. */
    stringAt(i) {
        const { t, lang } = this;
        const ch = t[i];
        switch (lang) {
            case "javascript":
                if (ch !== "'" && ch !== '"' && ch !== "`")
                    return undefined;
                // `Don't` in JSX text is not a string: a quote never directly follows an identifier
                // character in JavaScript. (A backtick can: tagged templates like html`…`.)
                if (ch !== "`" && isIdent(t[i - 1]))
                    return undefined;
                return ch === "`" ? this.quoted(i, 1, { escapes: true, interp: "${" }) : this.quoted(i, 1, { escapes: true, singleLine: true });
            case "python": {
                if (ch !== "'" && ch !== '"')
                    return undefined;
                const triple = t.startsWith(ch.repeat(3), i);
                return this.quoted(i, triple ? 3 : 1, { escapes: true, singleLine: !triple });
            }
            case "java":
                if (t.startsWith('"""', i))
                    return this.quoted(i, 3, { escapes: true });
                return ch === '"' || ch === "'" ? this.quoted(i, 1, { escapes: true, singleLine: true }) : undefined;
            case "kotlin":
                if (t.startsWith('"""', i))
                    return this.quoted(i, 3, { escapes: false, interp: "${" });
                if (ch === '"')
                    return this.quoted(i, 1, { escapes: true, singleLine: true, interp: "${" });
                return ch === "'" ? this.quoted(i, 1, { escapes: true, singleLine: true }) : undefined;
            case "dart": {
                const raw = ch === "r" && (t[i + 1] === "'" || t[i + 1] === '"') && !isIdent(t[i - 1]);
                const q = raw ? i + 1 : i;
                if (t[q] !== "'" && t[q] !== '"')
                    return undefined;
                const triple = t.startsWith(t[q].repeat(3), q);
                return this.quoted(i, triple ? 3 : 1, { escapes: !raw, singleLine: !triple, interp: raw ? undefined : "${", offset: q - i });
            }
            case "swift": {
                if (ch === "#") {
                    let hashes = 0;
                    while (t[i + hashes] === "#")
                        hashes++;
                    if (t[i + hashes] !== '"')
                        return undefined;
                    const triple = t.startsWith('"""', i + hashes);
                    const closer = (triple ? '"""' : '"') + "#".repeat(hashes);
                    const close = t.indexOf(closer, i + hashes + (triple ? 3 : 1));
                    return this.fill(i, close < 0 ? this.end : close + closer.length, exports.STRING);
                }
                if (t.startsWith('"""', i))
                    return this.quoted(i, 3, { escapes: true, interp: "\\(" });
                return ch === '"' ? this.quoted(i, 1, { escapes: true, singleLine: true, interp: "\\(" }) : undefined;
            }
            case "csharp":
                return this.csharpString(i);
        }
    }
    csharpString(i) {
        const { t } = this;
        let j = i;
        let interpolated = false, verbatim = false;
        while (t[j] === "$" || t[j] === "@") {
            if (t[j] === "$")
                interpolated = true;
            else
                verbatim = true;
            j++;
        }
        if (t[j] === "'" && j === i)
            return this.quoted(i, 1, { escapes: true, singleLine: true });
        if (t[j] !== '"')
            return undefined;
        if (j > i && isIdent(t[i - 1]))
            return undefined;
        if (t.startsWith('"""', j)) {
            // Raw string literal (C# 11): closed by the same run of quotes.
            let run = 0;
            while (t[j + run] === '"')
                run++;
            const close = t.indexOf('"'.repeat(run), j + run);
            return this.fill(i, close < 0 ? this.end : close + run, exports.STRING);
        }
        if (verbatim) {
            for (let k = j + 1; k < this.end; k++) {
                if (t[k] === '"') {
                    if (t[k + 1] === '"') {
                        k++;
                        continue;
                    }
                    return this.fill(i, k + 1, exports.STRING);
                }
                if (interpolated && t[k] === "{") {
                    if (t[k + 1] === "{") {
                        k++;
                        continue;
                    }
                    this.mask.fill(exports.STRING, i, k + 1);
                    k = this.hole(k + 1, "}") - 1;
                }
            }
            return this.fill(i, this.end, exports.STRING);
        }
        return this.quoted(i, 1, { escapes: true, singleLine: true, interp: interpolated ? "{" : undefined, offset: j - i });
    }
    /**
     * Marks a quoted literal starting at `start` (whose quote run of `size`
     * characters begins at `start + offset`) and returns the offset after it.
     */
    quoted(start, size, o) {
        const { t } = this;
        const open = start + (o.offset ?? 0);
        const quote = t.slice(open, open + size);
        let k = open + size;
        let segment = start;
        while (k < this.end) {
            const ch = t[k];
            if (o.interp && t.startsWith(o.interp, k) && !(o.interp === "{" && t[k + 1] === "{")) {
                this.mask.fill(exports.STRING, segment, k + o.interp.length);
                k = this.hole(k + o.interp.length, o.interp === "\\(" ? ")" : "}");
                segment = k;
                continue;
            }
            if (o.interp === "{" && ch === "{") {
                k += 2;
                continue;
            }
            if (o.escapes && ch === "\\") {
                k += 2;
                continue;
            }
            if (o.singleLine && ch === "\n")
                return this.fill(segment, k, exports.STRING);
            if (t.startsWith(quote, k)) {
                // Kotlin and Swift raw/multi-line strings may end with extra quotes ("""" closes after the first).
                let after = k + size;
                if (size === 3)
                    while (t[after] === quote[0])
                        after++;
                return this.fill(segment, after, exports.STRING);
            }
            k++;
        }
        return this.fill(segment, this.end, exports.STRING);
    }
    /** An interpolation hole is code (it may hold nested strings); it is masked as string. */
    hole(from, close) {
        const after = this.code(from, close);
        this.mask.fill(exports.STRING, from, Math.min(after, this.end));
        return after;
    }
    regexAllowed(i) {
        const { t } = this;
        if (t[i + 1] === "/" || t[i + 1] === "*")
            return false;
        let p = i - 1;
        while (p >= 0 && (t[p] === " " || t[p] === "\t"))
            p--;
        if (p < 0 || t[p] === "\n")
            return true;
        if ("(,=:[!&|?{};+-*%~^".includes(t[p]))
            return true;
        if (isIdent(t[p])) {
            let w = p;
            while (w > 0 && isIdent(t[w - 1]))
                w--;
            return REGEX_KEYWORDS.has(t.slice(w, p + 1));
        }
        return false;
    }
    /** End of a regex literal at `i`, or -1 when the line has no closing slash (so it was division). */
    regexEnd(i) {
        const { t } = this;
        let inClass = false;
        for (let k = i + 1; k < this.end; k++) {
            const ch = t[k];
            if (ch === "\n")
                return -1;
            if (ch === "\\") {
                k++;
                continue;
            }
            if (ch === "[")
                inClass = true;
            else if (ch === "]")
                inClass = false;
            else if (ch === "/" && !inClass) {
                let after = k + 1;
                while (/[a-z]/i.test(t[after] ?? ""))
                    after++;
                return after;
            }
        }
        return -1;
    }
}
/** Ranges of JavaScript inside <script> blocks (skipping JSON, templates and other types). */
function scriptBlocks(text) {
    const blocks = [];
    const open = /<script\b([^>]*)>/gi;
    let match;
    while ((match = open.exec(text))) {
        const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(match[1])?.[1]?.toLowerCase();
        const start = match.index + match[0].length;
        const close = text.toLowerCase().indexOf("</script", start);
        const end = close < 0 ? text.length : close;
        if (!type || type === "module" || type.includes("javascript") || type.includes("typescript"))
            blocks.push({ start, end });
        open.lastIndex = end;
    }
    return blocks;
}
exports.scriptBlocks = scriptBlocks;
/** 0-based line of an offset. */
function lineOf(lexed, offset) {
    const starts = lexed.lineStarts;
    let low = 0, high = starts.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (starts[mid] <= offset)
            low = mid + 1;
        else
            high = mid - 1;
    }
    return high;
}
exports.lineOf = lineOf;
function lineEndOffset(lexed, line) {
    const next = lexed.lineStarts[line + 1];
    if (next === undefined)
        return lexed.text.length;
    return lexed.text[next - 2] === "\r" ? next - 2 : next - 1;
}
exports.lineEndOffset = lineEndOffset;
/** The line's code with comments and strings left in place, but trailing comments trimmed off. */
function codeOfLine(lexed, line) {
    const start = lexed.lineStarts[line];
    let end = lineEndOffset(lexed, line);
    while (end > start && (lexed.mask[end - 1] === exports.COMMENT || /\s/.test(lexed.text[end - 1])))
        end--;
    return lexed.text.slice(start, end);
}
exports.codeOfLine = codeOfLine;
/** True when the line holds only whitespace and comments. */
function isBlankOrComment(lexed, line) {
    const start = lexed.lineStarts[line];
    const end = lineEndOffset(lexed, line);
    for (let i = start; i < end; i++)
        if (lexed.mask[i] !== exports.COMMENT && !/\s/.test(lexed.text[i]))
            return false;
    return true;
}
exports.isBlankOrComment = isBlankOrComment;
function indentOf(text) {
    return /^[ \t]*/.exec(text)[0];
}
exports.indentOf = indentOf;
/** Offset of the bracket closing the one at `open`, counting code only; -1 if it never closes. */
function matchingBracket(lexed, open) {
    const pairs = { "(": ")", "[": "]", "{": "}" };
    const stack = [];
    for (let i = open; i < lexed.text.length; i++) {
        if (lexed.mask[i] !== exports.CODE)
            continue;
        const ch = lexed.text[i];
        if (pairs[ch])
            stack.push(pairs[ch]);
        else if (ch === ")" || ch === "]" || ch === "}") {
            if (stack.pop() !== ch)
                return -1;
            if (!stack.length)
                return i;
        }
    }
    return -1;
}
exports.matchingBracket = matchingBracket;
/** The brackets still open at the end of each line (code only). */
function bracketStacks(lexed) {
    const result = [];
    const stack = [];
    let line = 0;
    const { text, mask, lineStarts } = lexed;
    for (let i = 0; i <= text.length; i++) {
        if (i === text.length || (line + 1 < lineStarts.length && i === lineStarts[line + 1])) {
            result.push(stack.slice());
            line++;
            if (i === text.length)
                break;
        }
        if (mask[i] !== exports.CODE)
            continue;
        const ch = text[i];
        if (ch === "(" || ch === "[" || ch === "{")
            stack.push({ ch, offset: i });
        else if (ch === ")" || ch === "]" || ch === "}")
            stack.pop();
    }
    while (result.length < lineStarts.length)
        result.push(stack.slice());
    return result;
}
exports.bracketStacks = bracketStacks;
//# sourceMappingURL=syntax.js.map