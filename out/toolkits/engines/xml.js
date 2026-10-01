"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minifyXml = exports.formatXml = exports.tokenizeXml = void 0;
const types_1 = require("../types");
function lineAt(text, index) {
    let n = 1;
    for (let i = 0; i < index; i++)
        if (text.charCodeAt(i) === 10)
            n++;
    return n;
}
function tokenizeXml(text) {
    const tokens = [];
    const issues = [];
    let i = 0;
    const until = (end, from) => { const j = text.indexOf(end, from); return j < 0 ? -1 : j + end.length; };
    while (i < text.length) {
        const line = lineAt(text, i);
        if (text.startsWith("<!--", i)) {
            const j = until("-->", i + 4);
            if (j < 0) {
                issues.push({ severity: "error", message: "Unclosed comment (<!-- without -->).", line });
                break;
            }
            tokens.push({ kind: "comment", raw: text.slice(i, j), line });
            i = j;
            continue;
        }
        if (text.startsWith("<![CDATA[", i)) {
            const j = until("]]>", i);
            if (j < 0) {
                issues.push({ severity: "error", message: "Unclosed CDATA section.", line });
                break;
            }
            tokens.push({ kind: "cdata", raw: text.slice(i, j), line });
            i = j;
            continue;
        }
        if (text.startsWith("<?", i)) {
            const j = until("?>", i);
            if (j < 0) {
                issues.push({ severity: "error", message: "Unclosed processing instruction (<? without ?>).", line });
                break;
            }
            tokens.push({ kind: "decl", raw: text.slice(i, j), line });
            i = j;
            continue;
        }
        if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) {
            let depth = 0, j = i;
            for (; j < text.length; j++) {
                if (text[j] === "[")
                    depth++;
                else if (text[j] === "]")
                    depth--;
                else if (text[j] === ">" && depth <= 0)
                    break;
            }
            tokens.push({ kind: "doctype", raw: text.slice(i, j + 1), line });
            i = j + 1;
            continue;
        }
        if (text[i] === "<") {
            // Find the end of the tag, skipping ">" inside quoted attribute values.
            let j = i + 1, quote = "";
            for (; j < text.length; j++) {
                const c = text[j];
                if (quote) {
                    if (c === quote)
                        quote = "";
                    continue;
                }
                if (c === '"' || c === "'")
                    quote = c;
                else if (c === ">")
                    break;
                else if (c === "<") {
                    issues.push({ severity: "error", message: "\"<\" inside a tag: a tag is missing its closing \">\".", line: lineAt(text, j) });
                    break;
                }
            }
            if (j >= text.length) {
                issues.push({ severity: "error", message: "A tag is never closed with \">\".", line });
                break;
            }
            const inner = text.slice(i + 1, j);
            if (text[j] === "<") {
                i = j;
                continue;
            }
            if (inner.startsWith("/")) {
                const name = inner.slice(1).trim();
                if (!/^[A-Za-z_][\w.:-]*$/.test(name))
                    issues.push({ severity: "error", message: `Invalid closing tag </${name}>.`, line });
                tokens.push({ kind: "close", name, line });
            }
            else {
                const self = inner.endsWith("/");
                const body = self ? inner.slice(0, -1) : inner;
                const m = /^([A-Za-z_][\w.:-]*)([\s\S]*)$/.exec(body);
                if (!m)
                    issues.push({ severity: "error", message: `Invalid tag <${body.slice(0, 30)}>.`, line });
                else {
                    const attrs = m[2].trim().replace(/\s+/g, " ").replace(/\s*=\s*/g, "=");
                    const unquoted = /(^|\s)[\w.:-]+=(?!["'])/.exec(attrs);
                    if (unquoted)
                        issues.push({ severity: "error", message: `Attribute values must be quoted in <${m[1]}>.`, line });
                    const names = [...attrs.matchAll(/(?:^|\s)([\w.:-]+)=/g)].map(x => x[1]);
                    const dup = names.find((n, k) => names.indexOf(n) !== k);
                    if (dup)
                        issues.push({ severity: "error", message: `Duplicate attribute "${dup}" in <${m[1]}>.`, line });
                    tokens.push({ kind: self ? "self" : "open", name: m[1], attrs, line });
                }
            }
            i = j + 1;
            continue;
        }
        const next = text.indexOf("<", i);
        const end = next < 0 ? text.length : next;
        const raw = text.slice(i, end);
        if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(raw))
            issues.push({ severity: "error", message: "Unescaped \"&\" in text; write &amp;.", line });
        tokens.push({ kind: "text", raw, line });
        i = end;
    }
    // Nesting
    const stack = [];
    let roots = 0;
    for (const t of tokens) {
        if (t.kind === "open") {
            if (!stack.length)
                roots++;
            stack.push({ name: t.name, line: t.line });
        }
        else if (t.kind === "self") {
            if (!stack.length)
                roots++;
        }
        else if (t.kind === "close") {
            const top = stack.pop();
            if (!top)
                issues.push({ severity: "error", message: `Closing tag </${t.name}> has no matching opening tag.`, line: t.line });
            else if (top.name !== t.name)
                issues.push({ severity: "error", message: `</${t.name}> closes <${top.name}> (opened on line ${top.line}).`, line: t.line });
        }
        else if (t.kind === "text" && !stack.length && t.raw.trim())
            issues.push({ severity: "error", message: "Text outside the root element.", line: t.line });
    }
    for (const open of stack)
        issues.push({ severity: "error", message: `<${open.name}> is never closed.`, line: open.line });
    if (roots > 1)
        issues.push({ severity: "error", message: `An XML document has exactly one root element; found ${roots}.` });
    if (roots === 0 && !issues.length)
        issues.push({ severity: "error", message: "No elements found - is this XML?" });
    return { tokens, issues };
}
exports.tokenizeXml = tokenizeXml;
function formatXml(text, indentUnit) {
    const { tokens, issues } = tokenizeXml(text);
    const errors = issues.filter(i => i.severity === "error");
    if (errors.length)
        throw new types_1.ToolInputError(`Fix the XML first: ${errors[0].message}${errors[0].line ? ` (line ${errors[0].line})` : ""}`);
    const out = [];
    let depth = 0;
    const pad = () => indentUnit.repeat(depth);
    for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        switch (t.kind) {
            case "text": {
                const v = t.raw.trim().replace(/\s+/g, " ");
                if (v)
                    out.push(pad() + v);
                break;
            }
            case "open": {
                const tag = `<${t.name}${t.attrs ? " " + t.attrs : ""}>`;
                // <a>short text</a> stays on one line.
                const next = tokens[k + 1], after = tokens[k + 2];
                if (next?.kind === "text" && after?.kind === "close" && after.name === t.name && !next.raw.includes("\n") && next.raw.trim().length <= 80) {
                    out.push(`${pad()}${tag}${next.raw.trim()}</${t.name}>`);
                    k += 2;
                }
                else if (next?.kind === "close" && next.name === t.name) {
                    out.push(`${pad()}${tag}</${t.name}>`);
                    k += 1;
                }
                else {
                    out.push(pad() + tag);
                    depth++;
                }
                break;
            }
            case "close":
                depth = Math.max(0, depth - 1);
                out.push(`${pad()}</${t.name}>`);
                break;
            case "self":
                out.push(`${pad()}<${t.name}${t.attrs ? " " + t.attrs : ""} />`);
                break;
            default: out.push(pad() + t.raw.trim());
        }
    }
    return out.join("\n") + "\n";
}
exports.formatXml = formatXml;
function minifyXml(text, keepComments) {
    const { tokens, issues } = tokenizeXml(text);
    const errors = issues.filter(i => i.severity === "error");
    if (errors.length)
        throw new types_1.ToolInputError(`Fix the XML first: ${errors[0].message}${errors[0].line ? ` (line ${errors[0].line})` : ""}`);
    return tokens.map(t => {
        switch (t.kind) {
            case "text": return t.raw.trim() ? t.raw.replace(/\s+/g, " ").trim() : "";
            case "open": return `<${t.name}${t.attrs ? " " + t.attrs : ""}>`;
            case "self": return `<${t.name}${t.attrs ? " " + t.attrs : ""}/>`;
            case "close": return `</${t.name}>`;
            case "comment": return keepComments ? t.raw : "";
            default: return t.raw;
        }
    }).join("");
}
exports.minifyXml = minifyXml;
//# sourceMappingURL=xml.js.map