"use strict";
/**
 * Minimal, dependency-free Markdown to HTML renderer.
 *
 * The README preview previously loaded `marked` from a public CDN and pushed
 * the result through innerHTML. That needed network access, and any HTML in a
 * README executed inside the webview. Rendering here instead keeps the preview
 * offline and safe: every piece of source text is HTML-escaped first, so the
 * only tags in the output are the ones this function emits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMarkdown = void 0;
const CODE_PLACEHOLDER_PREFIX = "%%devsnipcode";
const CODE_PLACEHOLDER_SUFFIX = "%%";
function escape(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
/** Only http(s), mailto and relative links survive; javascript: and data: URLs are dropped. */
function safeUrl(url) {
    const trimmed = url.trim();
    if (!trimmed)
        return undefined;
    if (/^(https?:|mailto:)/i.test(trimmed))
        return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed))
        return undefined;
    return trimmed;
}
/** Inline formatting: code, images, links, bold, italic, strikethrough. */
function renderInline(text) {
    const codeSpans = [];
    // Protect code spans first so their contents are never treated as markup.
    let working = escape(text).replace(/`([^`]+)`/g, (_match, code) => {
        codeSpans.push(`<code>${code}</code>`);
        return `${CODE_PLACEHOLDER_PREFIX}${codeSpans.length - 1}${CODE_PLACEHOLDER_SUFFIX}`;
    });
    working = working.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, alt, url) => {
        const safe = safeUrl(url);
        return safe ? `<img src="${safe}" alt="${alt}">` : match;
    });
    working = working.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, label, url) => {
        const safe = safeUrl(url);
        return safe ? `<a href="${safe}">${label}</a>` : match;
    });
    working = working
        .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
        .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    const placeholder = new RegExp(`${CODE_PLACEHOLDER_PREFIX}(\\d+)${CODE_PLACEHOLDER_SUFFIX}`, "g");
    return working.replace(placeholder, (_match, index) => codeSpans[Number(index)] ?? "");
}
function renderTable(rows) {
    const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
    const header = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    const head = `<thead><tr>${header.map(cell => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`;
    const rest = body.length
        ? `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
        : "";
    return `<table>${head}${rest}</table>`;
}
function renderMarkdown(markdown) {
    const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let index = 0;
    const isTableSeparator = (line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
    while (index < lines.length) {
        const line = lines[index];
        // Fenced code block
        const fence = line.match(/^\s*```+\s*([\w+#-]*)\s*$/);
        if (fence) {
            const language = fence[1];
            const body = [];
            index++;
            while (index < lines.length && !/^\s*```+\s*$/.test(lines[index])) {
                body.push(lines[index]);
                index++;
            }
            index++;
            const languageClass = language ? ` class="language-${escape(language)}"` : "";
            html.push(`<pre><code${languageClass}>${escape(body.join("\n"))}</code></pre>`);
            continue;
        }
        if (!line.trim()) {
            index++;
            continue;
        }
        if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
            html.push("<hr>");
            index++;
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
            index++;
            continue;
        }
        if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
            const rows = [];
            while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
                rows.push(lines[index]);
                index++;
            }
            html.push(renderTable(rows));
            continue;
        }
        if (/^\s*>/.test(line)) {
            const quote = [];
            while (index < lines.length && /^\s*>/.test(lines[index])) {
                quote.push(lines[index].replace(/^\s*>\s?/, ""));
                index++;
            }
            html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
            continue;
        }
        const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
        const orderedMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (bulletMatch || orderedMatch) {
            const ordered = Boolean(orderedMatch);
            const items = [];
            while (index < lines.length) {
                const current = lines[index];
                const item = ordered ? current.match(/^\s*\d+[.)]\s+(.*)$/) : current.match(/^\s*[-*+]\s+(.*)$/);
                if (!item)
                    break;
                const task = item[1].match(/^\[([ xX])\]\s+(.*)$/);
                items.push(task
                    ? `<li class="task"><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}> ${renderInline(task[2])}</li>`
                    : `<li>${renderInline(item[1])}</li>`);
                index++;
            }
            html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
            continue;
        }
        const paragraph = [];
        while (index < lines.length && lines[index].trim() && !/^\s*(#{1,6}\s|```|>|[-*+]\s|\d+[.)]\s)/.test(lines[index])) {
            paragraph.push(lines[index].trim());
            index++;
        }
        html.push(`<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    }
    return html.join("\n");
}
exports.renderMarkdown = renderMarkdown;
//# sourceMappingURL=markdown.js.map