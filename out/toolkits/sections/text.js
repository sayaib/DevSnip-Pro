"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEXT_TOOLS = void 0;
const types_1 = require("../types");
const devops_utils_1 = require("../engines/devops-utils");
const xml_1 = require("../engines/xml");
const helpers_1 = require("./helpers");
/** Tools whose home is Text & Formatters and that no other module defines. */
const SAMPLE = '{"service":"orders","version":"1.4.2","replicas":3,"ports":[8080,9090],"env":{"LOG_LEVEL":"info","FEATURE_X":false},"owners":["ada@example.com"]}';
function detect(text) {
    const t = text.trim();
    if (t.startsWith("<"))
        return "xml";
    return (0, devops_utils_1.detectFormat)(t);
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
    return value;
}
const formatter = {
    id: "text.format",
    command: "jsonFormatter",
    title: "JSON / YAML / XML Formatter",
    summary: "Format, minify and validate JSON, YAML and XML with line numbers; catch YAML's surprises (no → false, 3.10 → 3.1, 22:22 → 1342); sort keys; convert JSON ↔ YAML.",
    guide: "The format is detected automatically. Validation runs on every change: JSON reports the exact line and column (and trailing commas, comments or single quotes), YAML flags duplicate keys, tabs and YAML 1.1 type surprises that Kubernetes, Compose and Ansible still apply, and XML is checked for well-formedness.",
    keywords: ["json formatter", "prettify", "beautify", "minify", "validate json", "yaml", "yml", "xml", "json to yaml", "yaml to json", "lint", "duplicate keys", "sort keys"],
    icon: "braces",
    live: true,
    aliases: [{ command: "yamlJsonTool", values: { format: "auto", action: "validate" } }],
    fields: [
        helpers_1.f.code("input", "Input", "json", { rows: 14, required: true, fromEditor: true, default: SAMPLE }),
        helpers_1.f.select("format", "Format", (0, helpers_1.opts)(["auto", "Detect"], ["json", "JSON"], ["yaml", "YAML"], ["xml", "XML"])),
        helpers_1.f.select("action", "Action", (0, helpers_1.opts)(["format", "Format"], ["minify", "Minify"], ["validate", "Validate only"], ["to-yaml", "Convert to YAML"], ["to-json", "Convert to JSON"])),
        helpers_1.f.select("indent", "Indent", (0, helpers_1.opts)(["2", "2 spaces"], ["4", "4 spaces"], ["tab", "Tab"])),
        helpers_1.f.toggle("sort", "Sort keys", false, { showIf: { field: "action", equals: ["format", "minify", "to-yaml", "to-json"] } })
    ],
    examples: [
        { label: "Minify JSON", values: { input: '{\n  "a": 1,\n  "list": [1, 2, 3]\n}', action: "minify" } },
        { label: "Validate a Compose file (YAML gotchas)", values: { input: "services:\n  web:\n    image: nginx:1.27\n    ports:\n      - 22:22\n    environment:\n      DEBUG: no\n      PYTHON_VERSION: 3.10\n", action: "validate" } },
        { label: "Docker Compose YAML → JSON", values: { input: "services:\n  db:\n    image: postgres:16\n    ports:\n      - \"5432:5432\"\n", action: "to-json" } },
        { label: "Format XML", values: { input: '<?xml version="1.0"?><project><name>app</name><deps><dep id="a" version="1.0"/><dep id="b"/></deps><!-- build --></project>', action: "format" } },
        { label: "Broken JSON (trailing comma)", values: { input: '{\n  "name": "app",\n  "tags": ["a", "b",],\n}', action: "validate" } }
    ],
    run(values) {
        const input = (0, types_1.str)(values, "input");
        if (!input.trim())
            throw new types_1.ToolInputError("Paste JSON, YAML or XML.");
        const chosen = (0, types_1.str)(values, "format", "auto");
        const format = chosen === "auto" ? detect(input) : chosen;
        const action = (0, types_1.str)(values, "action", "format");
        const indentChoice = (0, types_1.str)(values, "indent", "2");
        const indent = indentChoice === "tab" ? "\t" : " ".repeat(Number(indentChoice));
        const sorted = (0, types_1.bool)(values, "sort");
        const outputs = [];
        if (format === "xml") {
            const { issues } = (0, xml_1.tokenizeXml)(input);
            const messages = (0, helpers_1.severityMessages)(issues, "Well-formed XML.");
            const ok = !issues.some(i => i.severity === "error");
            if (ok && action === "format")
                outputs.push((0, helpers_1.code)("Formatted", "xml", (0, xml_1.formatXml)(input, indent)));
            if (ok && action === "minify")
                outputs.push((0, helpers_1.code)("Minified", "xml", (0, xml_1.minifyXml)(input, false)));
            if (action === "to-json" || action === "to-yaml")
                messages.push({ kind: "info", text: "XML has no single JSON/YAML mapping (attributes, mixed content, repeated elements); convert it with a library such as fast-xml-parser so the rules are explicit." });
            return { stats: [{ label: "Format", value: "XML" }, ...((0, helpers_1.counts)(issues) ?? [])], messages, outputs };
        }
        const r = (0, devops_utils_1.validateStructured)(input, format);
        const issues = r.issues;
        const ok = !issues.some(i => i.severity === "error");
        const messages = (0, helpers_1.severityMessages)(issues, `Valid ${r.format.toUpperCase()}${r.format === "yaml" && r.documents > 1 ? ` (${r.documents} documents)` : ""}.`);
        if (ok && action !== "validate") {
            const value = sorted ? sortKeys(r.value) : r.value;
            const target = action === "to-yaml" ? "yaml" : action === "to-json" ? "json" : r.format;
            if (action === "minify") {
                outputs.push(target === "json" ? (0, helpers_1.code)("Minified", "json", JSON.stringify(value)) : (0, helpers_1.code)("Minified (flow style)", "yaml", JSON.stringify(value)));
                if (target === "yaml")
                    messages.push({ kind: "info", text: "JSON is valid YAML, so the most compact YAML is single-line flow style." });
            }
            else if (target === "json") {
                outputs.push((0, helpers_1.code)(r.format === "json" ? "Formatted" : "JSON", "json", JSON.stringify(value, null, indent) + "\n"));
            }
            else {
                const yamlIndent = indent === "\t" ? 2 : indent.length;
                outputs.push((0, helpers_1.code)(r.format === "yaml" ? "Formatted" : "YAML", "yaml", sorted || r.format !== "yaml" ? (0, devops_utils_1.convertStructured)(JSON.stringify(value), "yaml", yamlIndent) : (0, devops_utils_1.convertStructured)(input, "yaml", yamlIndent)));
                if (indent === "\t")
                    messages.push({ kind: "info", text: "YAML does not allow tabs; 2 spaces were used." });
            }
        }
        const bytes = Buffer.byteLength(input);
        return {
            stats: [{ label: "Format", value: r.format.toUpperCase() }, ...((0, helpers_1.counts)(issues) ?? []), { label: "Size", value: `${bytes.toLocaleString("en-US")} B` }],
            messages,
            outputs
        };
    }
};
exports.TEXT_TOOLS = [formatter];
//# sourceMappingURL=text.js.map