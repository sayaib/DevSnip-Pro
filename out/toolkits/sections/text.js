"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEXT_TOOLS = exports.codeFrame = void 0;
const types_1 = require("../types");
const devops_utils_1 = require("../engines/devops-utils");
const xml_1 = require("../engines/xml");
const xml_parse_1 = require("../engines/xml-parse");
const xml_json_1 = require("../engines/xml-json");
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
            if (ok && (action === "to-json" || action === "to-yaml")) {
                try {
                    const converted = (0, xml_json_1.xmlToJson)(input);
                    outputs.push(action === "to-json"
                        ? (0, helpers_1.code)("JSON", "json", (0, xml_json_1.stringify)(converted.value, indent) + "\n")
                        : (0, helpers_1.code)("YAML", "yaml", (0, devops_utils_1.convertStructured)(JSON.stringify(converted.value), "yaml", indent === "\t" ? 2 : indent.length)));
                    messages.push({ kind: "info", text: "Converted with the compact mapping (\"@\" attributes, \"#text\", repeated elements as arrays). The XML → JSON Converter has more options, a lossless mapping and file conversion." });
                }
                catch (error) {
                    if (!(error instanceof xml_parse_1.XmlSyntaxError))
                        throw error;
                    messages.push({ kind: "error", text: `Line ${error.line}, column ${error.column}: ${error.message}` });
                }
            }
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
// ---------------------------------------------------------------- XML → JSON
const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Product catalog export -->
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/" updated="2026-10-14">
  <book id="bk101" inStock="true">
    <dc:title>XML &amp; JSON in Practice</dc:title>
    <author>Gambardella, Matthew</author>
    <price currency="USD">44.95</price>
    <tags>
      <tag>xml</tag>
      <tag>json</tag>
    </tags>
    <description><![CDATA[Covers <element> mapping & edge cases.]]></description>
    <discontinued/>
  </book>
  <book id="bk102" inStock="false">
    <dc:title>Midnight Rain</dc:title>
    <author>Ralls, Kim</author>
    <price currency="EUR">5.95</price>
  </book>
</catalog>
`;
/** Files larger than this are refused, so a mistaken pick can't exhaust memory. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** The preview of a converted file shows this much; the saved file has everything. */
const PREVIEW_CHARS = 200000;
const XML_EXTENSIONS = ["xml", "xsd", "xsl", "xslt", "wsdl", "svg", "rss", "atom", "kml", "gpx", "plist", "config", "csproj", "vbproj", "props", "targets", "resx", "xaml", "xlf", "xliff", "pom", "nuspec", "storyboard", "xib", "graphml", "musicxml", "tei", "dita", "opf", "ncx", "fo"];
function convertOptions(values) {
    const mapping = (0, types_1.str)(values, "mapping", "compact") === "lossless" ? "lossless" : "compact";
    const prefix = (0, types_1.str)(values, "attributePrefix", "@");
    return {
        ...xml_json_1.DEFAULT_OPTIONS,
        mapping,
        attributePrefix: ["@", "-", "$"].includes(prefix) ? prefix : "@",
        alwaysArray: (0, types_1.bool)(values, "alwaysArray", false),
        coerce: (0, types_1.bool)(values, "coerce", false),
        trim: (0, types_1.bool)(values, "trim", true),
        comments: (0, types_1.bool)(values, "comments", true),
        cdataKey: (0, types_1.bool)(values, "cdataKey", false),
        prolog: (0, types_1.bool)(values, "prolog", true),
        stripPrefixes: (0, types_1.bool)(values, "stripPrefixes", false)
    };
}
/** The lines around an error, with a caret under the column. */
function codeFrame(text, line, column) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const first = Math.max(1, line - 2);
    const last = Math.min(lines.length, line + 1);
    const width = String(last).length;
    const out = [];
    for (let n = first; n <= last; n++) {
        const content = lines[n - 1] ?? "";
        const shown = content.length > 160 ? (column > 120 && n === line ? "…" + content.slice(column - 100, column + 60) : content.slice(0, 160) + "…") : content;
        out.push(`${n === line ? ">" : " "} ${String(n).padStart(width)} | ${shown}`);
        if (n === line) {
            const offset = content.length > 160 && column > 120 ? 101 : column - 1;
            // Keep tabs so the caret lines up with the text above it.
            const lead = shown.slice(0, offset).replace(/[^\t]/g, " ");
            out.push(`  ${" ".repeat(width)} | ${lead}^`);
        }
    }
    return out.join("\n");
}
exports.codeFrame = codeFrame;
function syntaxErrorResult(error, source, extra = []) {
    return {
        stats: [{ label: "XML", value: "Not well-formed", tone: "bad" }, { label: "Error at", value: `line ${error.line}, col ${error.column}`, tone: "bad" }, ...(extra ?? [])],
        messages: [
            { kind: "error", text: `Line ${error.line}, column ${error.column}: ${error.message}` },
            ...(error.hint ? [{ kind: "info", text: error.hint }] : [])
        ],
        outputs: [(0, helpers_1.code)("Where", "text", codeFrame(source, error.line, error.column))]
    };
}
async function convertFile(context, values) {
    if (!context.files)
        throw new types_1.ToolInputError("Converting files needs VS Code's file dialogs, which aren't available here.");
    const picked = await context.files.pick({ title: "Choose an XML file to convert", filters: { "XML files": XML_EXTENSIONS, "All files": ["*"] }, maxBytes: MAX_FILE_BYTES });
    if (!picked)
        return { messages: [{ kind: "info", text: "No file chosen." }] };
    const { text, encoding } = (0, xml_parse_1.decodeXmlBytes)(picked.bytes);
    const started = Date.now();
    let result;
    try {
        result = (0, xml_json_1.convertParsed)((0, xml_parse_1.parseXml)(text), convertOptions(values));
    }
    catch (error) {
        if (!(error instanceof xml_parse_1.XmlSyntaxError))
            throw error;
        const failed = syntaxErrorResult(error, text, [{ label: "File", value: picked.name }]);
        failed.messages.unshift({ kind: "error", text: `${picked.name} isn't well-formed XML, so nothing was converted.` });
        return failed;
    }
    const json = (0, xml_json_1.stringify)(result.value, jsonIndent(values)) + "\n";
    const ms = Date.now() - started;
    const saved = await context.files.save(json, { suggestedName: picked.name.replace(/\.[^.]+$/, "") + ".json", near: picked.path });
    const messages = [
        saved ? { kind: "success", text: `Converted ${picked.name} and saved ${saved}.` } : { kind: "warning", text: `Converted ${picked.name}, but it wasn't saved. Run Convert a file… again to choose where to save it.` },
        ...result.notes.map(note => ({ kind: "info", text: note })),
        ...result.warnings.map(w => ({ kind: "warning", text: `Line ${w.line}: ${w.message}` }))
    ];
    const preview = json.length > PREVIEW_CHARS ? json.slice(0, PREVIEW_CHARS) : json;
    if (json.length > PREVIEW_CHARS)
        messages.push({ kind: "info", text: `The preview shows the first ${PREVIEW_CHARS.toLocaleString("en-US")} of ${json.length.toLocaleString("en-US")} characters; the saved file has all of it.` });
    return {
        stats: [
            { label: "File", value: picked.name },
            { label: "Encoding", value: encoding },
            { label: "Elements", value: result.stats.elements.toLocaleString("en-US") },
            { label: "XML", value: (0, types_1.fmtBytes)(picked.bytes.length) },
            { label: "JSON", value: (0, types_1.fmtBytes)(Buffer.byteLength(json)) },
            { label: "Time", value: `${ms.toLocaleString("en-US")} ms` }
        ],
        messages,
        outputs: [(0, helpers_1.code)(json.length > PREVIEW_CHARS ? "JSON preview" : "JSON", "json", preview, picked.name.replace(/\.[^.]+$/, "") + ".json")]
    };
}
function jsonIndent(values) {
    if ((0, types_1.str)(values, "output", "pretty") === "minified")
        return "";
    const indent = (0, types_1.str)(values, "indent", "2");
    return indent === "tab" ? "\t" : " ".repeat(Number(indent) || 2);
}
const compactOnly = { showIf: { field: "mapping", equals: ["compact"] } };
const xmlToJsonTool = {
    id: "text.xml-json",
    command: "xmlToJson",
    title: "XML → JSON Converter",
    summary: "Validate XML and convert it to JSON: attributes, namespaces, repeated elements, CDATA, comments and mixed content, as compact JSON or a lossless node tree.",
    guide: "Compact JSON is what most code wants: an element with only text becomes a string; otherwise an object of \"@attribute\" keys, child elements (repeated ones become arrays) and \"#text\". Empty elements become \"\". Lossless keeps every node in order - text around child elements, comments, CDATA and namespace URIs - so the XML can be rebuilt exactly. Values stay text unless you turn on numbers and booleans, which converts only values that print back identically (so \"007\" and \"1.50\" stay text). The XML is checked strictly (well-formedness and namespaces) and the first problem is shown with its line, column and the fix. Entities from a DOCTYPE are expanded; external DTDs are never fetched. For large files use Convert a file…, which writes the JSON straight to disk.",
    keywords: ["xml to json", "xml2json", "convert xml", "xml parser", "xml validator", "soap", "rss", "svg", "namespaces", "cdata", "attributes", "json"],
    icon: "braces",
    live: true,
    actions: [{ id: "file", label: "Convert a file…" }],
    fields: [
        helpers_1.f.code("input", "XML", "xml", { rows: 14, required: true, fromEditor: true, default: XML_SAMPLE }),
        helpers_1.f.select("mapping", "Mapping", (0, helpers_1.opts)(["compact", "Compact JSON"], ["lossless", "Lossless (ordered nodes)"])),
        helpers_1.f.select("output", "Output", (0, helpers_1.opts)(["pretty", "Formatted"], ["minified", "Minified"])),
        helpers_1.f.select("indent", "Indent", (0, helpers_1.opts)(["2", "2 spaces"], ["4", "4 spaces"], ["tab", "Tab"]), { showIf: { field: "output", equals: ["pretty"] } }),
        helpers_1.f.select("attributePrefix", "Attribute prefix", (0, helpers_1.opts)(["@", "@name"], ["-", "-name"], ["$", "$name"]), compactOnly),
        helpers_1.f.toggle("trim", "Trim whitespace", true, { help: "Drop indentation; never inside CDATA or xml:space=\"preserve\"." }),
        helpers_1.f.toggle("alwaysArray", "Always use arrays", false, { ...compactOnly, help: "Every child element in an array, even when it occurs once." }),
        helpers_1.f.toggle("coerce", "Numbers & booleans", false, { ...compactOnly, help: "Only values that print back identically." }),
        helpers_1.f.toggle("comments", "Keep comments", true, compactOnly),
        helpers_1.f.toggle("cdataKey", "CDATA as \"#cdata\"", false, { ...compactOnly, help: "Otherwise merged into the text." }),
        helpers_1.f.toggle("prolog", "Keep declaration & doctype", true, compactOnly),
        helpers_1.f.toggle("stripPrefixes", "Remove namespace prefixes", false, compactOnly)
    ],
    examples: [
        { label: "SOAP envelope (namespaces)", values: { input: '<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="https://example.com/stock">\n  <soap:Header/>\n  <soap:Body>\n    <m:GetStockPriceResponse>\n      <m:Price>34.5</m:Price>\n      <m:Currency>USD</m:Currency>\n    </m:GetStockPriceResponse>\n  </soap:Body>\n</soap:Envelope>\n', mapping: "compact", coerce: true } },
        { label: "RSS feed", values: { input: '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>DevSnip News</title>\n    <link>https://example.com/</link>\n    <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>\n    <item>\n      <title>Release 11.78</title>\n      <description><![CDATA[<p>CSV &amp; Excel viewer</p>]]></description>\n      <pubDate>Wed, 14 Oct 2026 09:00:00 GMT</pubDate>\n      <guid isPermaLink="false">11.78</guid>\n    </item>\n    <item>\n      <title>Release 11.77</title>\n      <pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate>\n    </item>\n  </channel>\n</rss>\n' } },
        { label: "Maven pom.xml", values: { input: '<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.example</groupId>\n  <artifactId>app</artifactId>\n  <version>1.0.0</version>\n  <dependencies>\n    <dependency>\n      <groupId>junit</groupId>\n      <artifactId>junit</artifactId>\n      <version>4.13.2</version>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n</project>\n', alwaysArray: true } },
        { label: "Mixed content (lossless)", values: { input: '<p xml:lang="en">Click <a href="/start">here</a> to <em>begin</em>.<!-- cta --></p>', mapping: "lossless" } },
        { label: "Android layout (attributes)", values: { input: '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:orientation="vertical">\n  <TextView android:id="@+id/title" android:text="Hello &amp; welcome"/>\n  <Button android:id="@+id/ok" android:text="OK"/>\n</LinearLayout>\n' } },
        { label: "Broken XML (see the error)", values: { input: '<order id="42">\n  <item sku="A1">Widget\n  <item sku="B2">Gadget</item>\n  <note>Tom & Jerry</note>\n</order>\n' } }
    ],
    async run(values, context, action) {
        if (action === "file")
            return convertFile(context, values);
        const input = (0, types_1.str)(values, "input");
        if (!input.trim())
            throw new types_1.ToolInputError("Paste XML, use the active editor, or press Convert a file… for large files.");
        const options = convertOptions(values);
        const started = Date.now();
        let result;
        try {
            result = (0, xml_json_1.convertParsed)((0, xml_parse_1.parseXml)(input), options);
        }
        catch (error) {
            if (error instanceof xml_parse_1.XmlSyntaxError)
                return syntaxErrorResult(error, input);
            throw error;
        }
        const json = (0, xml_json_1.stringify)(result.value, jsonIndent(values)) + "\n";
        const ms = Date.now() - started;
        const st = result.stats;
        const parts = [`${st.elements.toLocaleString("en-US")} element${st.elements === 1 ? "" : "s"}`, `${st.attributes.toLocaleString("en-US")} attribute${st.attributes === 1 ? "" : "s"}`];
        const count = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
        if (st.namespaces)
            parts.push(count(st.namespaces, "namespace declaration"));
        if (st.cdata)
            parts.push(count(st.cdata, "CDATA section"));
        if (st.comments)
            parts.push(count(st.comments, "comment"));
        return {
            stats: [
                { label: "XML", value: "Well-formed", tone: "good" },
                { label: "Elements", value: st.elements.toLocaleString("en-US") },
                { label: "Depth", value: String(st.maxDepth) },
                { label: "XML size", value: (0, types_1.fmtBytes)(Buffer.byteLength(input)) },
                { label: "JSON size", value: (0, types_1.fmtBytes)(Buffer.byteLength(json)) },
                { label: "Time", value: `${ms.toLocaleString("en-US")} ms` }
            ],
            messages: [
                { kind: "success", text: `Well-formed XML: ${parts.join(", ")}.` },
                ...result.notes.map(note => ({ kind: "info", text: note })),
                ...result.warnings.map(w => ({ kind: "warning", text: `Line ${w.line}: ${w.message}` }))
            ],
            outputs: [(0, helpers_1.code)("JSON", "json", json, "converted.json")]
        };
    }
};
exports.TEXT_TOOLS = [formatter, xmlToJsonTool];
//# sourceMappingURL=text.js.map