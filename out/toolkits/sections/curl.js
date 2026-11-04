"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.curlTool = void 0;
const web_curl_1 = require("../engines/web-curl");
const curl_exports_1 = require("../engines/curl-exports");
const types_1 = require("../types");
const helpers_1 = require("./helpers");
const sample = `curl 'https://api.example.com/v1/orders?status=open' \\
  -X POST \\
  -H 'Authorization: Bearer YOUR_TOKEN' \\
  --json '{"customerId":"c_123","items":[{"sku":"A-1","qty":2}]}'`;
const storageKey = "curlConverter.presets.v1";
exports.curlTool = {
    id: "web.curl", command: "curlConverter", title: "cURL Converter", icon: "terminal", live: true,
    summary: "Convert cURL into browser/server clients, Python, Go, PHP, Java, C#, Dart, Kotlin, Swift, HTTPie or raw HTTP, with batch conversion and Postman/HAR exports.",
    guide: "Conversion runs locally and never sends requests, reads referenced files or executes shell commands. Select Bash, cmd or PowerShell for shell-specific quoting. Use --next, newlines or && between cURL requests in batch mode. Code preserves request body text and repeated parameters where supported. Unsupported combinations produce diagnostics. Browser headers, redirects and CORS differ from server clients. Secrets remain in generated code unless redaction is enabled. Saved presets are redacted; cURL input is excluded from persisted webview state. Exports include requests only; HAR response/timing fields are placeholders.",
    keywords: ["curl", "copy as curl", "fetch", "axios", "requests", "httpx", "http client", "okhttp", "urlsession", "dio", "csharp", "postman", "har", "batch", "powershell"],
    runLabel: "Convert request",
    fields: [
        helpers_1.f.code("curl", "cURL command", "shell", { rows: 9, required: true, fromEditor: true, sensitive: true, default: sample }),
        helpers_1.f.select("shell", "Shell dialect", (0, helpers_1.opts)(["auto", "Automatic · Bash / cmd"], ["bash", "Bash / zsh"], ["cmd", "Windows cmd"], ["powershell", "PowerShell (curl.exe)"])),
        helpers_1.f.select("target", "Convert to", web_curl_1.CURL_TARGETS.map(t => ({ value: t.id, label: t.label })), { searchable: true }),
        helpers_1.f.toggle("all", "Show every language", false),
        helpers_1.f.toggle("batch", "Convert multiple requests", false),
        helpers_1.f.toggle("redact", "Redact credentials and sensitive fields", false, { help: "Redacts known credential headers, URL parameters, JSON/form fields and raw bodies. Review application-specific secrets before sharing." }),
        helpers_1.f.toggle("cleanHeaders", "Remove browser metadata headers", false, { help: "Drops Sec-*, Priority, DNT and Upgrade-Insecure-Requests. Preserves application headers." }),
        helpers_1.f.select("response", "Fetch response", (0, helpers_1.opts)(["auto", "Detect JSON from response Content-Type"], ["json", "JSON"], ["text", "Text"], ["bytes", "Binary (ArrayBuffer)"]), { showIf: { field: "target", equals: ["fetch", "fetch-ts", "node-fetch"] } }),
        helpers_1.f.toggle("reusable", "Reusable Fetch function", false, { showIf: { field: "target", equals: ["fetch", "fetch-ts", "node-fetch"] } }),
        helpers_1.f.text("presetName", "Preset name (optional)", { placeholder: "My API request", help: "Used by Save redacted preset; up to 80 characters." }),
        helpers_1.f.select("export", "Request export", (0, helpers_1.opts)(["none", "Code + normalized cURL"], ["postman", "Postman collection v2.1"], ["har", "HAR v1.2"], ["both", "Postman + HAR"]))
    ],
    examples: [
        { label: "JSON POST", values: { curl: sample, batch: false } },
        { label: "Multipart upload with basic auth", values: { curl: "curl -u user:YOUR_PASSWORD -F 'file=@./report.pdf' -F 'title=Report' https://files.example.com/upload", target: "node-fetch", batch: false } },
        { label: "Form login with redirects", values: { curl: "curl -L https://example.com/login -d 'username=ada' -d 'password=YOUR_PASSWORD'", target: "python", batch: false } },
        { label: "Repeated query parameters", values: { curl: "curl -G https://api.example.com/search --data-urlencode 'q=coffee near me' -d 'tag=red&tag=blue' -H 'Accept: application/json'", target: "axios-node", batch: false } },
        { label: "Batch + Postman export", values: { curl: "curl https://api.example.com/users --next https://api.example.com/orders", batch: true, export: "postman", target: "python-httpx" } },
        { label: "Binary body file", values: { curl: "curl https://api.example.com/import --data-binary @./payload.bin", batch: false, target: "node-fetch" } }
    ],
    actions: [{ id: "save-preset", label: "Save redacted preset" }, { id: "clear-presets", label: "Clear saved presets" }],
    dynamicExamples(context) { return context.storage?.get(storageKey, []) ?? []; },
    async run(values, context, action) {
        if (action === "clear-presets") {
            if (!context.storage)
                throw new types_1.ToolInputError("Preset storage is unavailable.");
            await context.storage.set(storageKey, []);
            return { messages: [{ kind: "success", text: "Saved cURL presets cleared." }] };
        }
        const shell = (0, types_1.str)(values, "shell", "auto");
        const requests = (0, types_1.bool)(values, "batch") ? (0, web_curl_1.parseCurlCommands)((0, types_1.required)(values, "curl", "cURL command"), shell) : [(0, web_curl_1.parseCurl)((0, types_1.required)(values, "curl", "cURL command"), shell)];
        const target = (0, types_1.str)(values, "target", "fetch");
        if (!web_curl_1.CURL_TARGETS.some(t => t.id === target))
            throw new types_1.ToolInputError("Choose a supported conversion target.");
        const exportMode = (0, types_1.str)(values, "export", "none");
        if (!["none", "postman", "har", "both"].includes(exportMode))
            throw new types_1.ToolInputError("Choose a supported request export.");
        const effective = requests.map(r => (0, types_1.bool)(values, "redact") ? (0, curl_exports_1.redactCurl)(r) : r);
        if ((0, types_1.bool)(values, "cleanHeaders"))
            for (const r of effective)
                r.headers = r.headers.filter(([k]) => !/^(sec-|priority$|dnt$|upgrade-insecure-requests$)/i.test(k));
        const messages = [];
        const outputs = [];
        let outputSize = 0;
        const push = (output) => {
            outputSize += output.kind === "code" ? Buffer.byteLength(output.content) : 0;
            if (outputSize > 5 * 1024 * 1024)
                throw new types_1.ToolInputError("Generated output exceeds 5 MiB. Choose one target or a smaller batch.");
            outputs.push(output);
        };
        const targets = (0, types_1.bool)(values, "all") ? web_curl_1.CURL_TARGETS : web_curl_1.CURL_TARGETS.filter(t => t.id === target);
        effective.forEach((r, i) => {
            const prefix = effective.length > 1 ? `${i + 1}. ` : "";
            for (const text of (0, web_curl_1.curlWarnings)(r))
                messages.push({ kind: "warning", text: prefix + text });
            for (const t of targets) {
                try {
                    const isFetch = ["fetch", "fetch-ts", "node-fetch"].includes(t.id);
                    const options = isFetch ? { response: (0, types_1.str)(values, "response", "auto"), reusable: (0, types_1.bool)(values, "reusable") } : {};
                    const content = (0, web_curl_1.generateFromCurl)(r, t.id, options);
                    push((0, helpers_1.code)(prefix + t.label, t.language, content, effective.length > 1 || targets.length > 1 ? `requests/${i + 1}/${t.id}/${t.file}` : t.file));
                    for (const text of (0, web_curl_1.curlTargetWarnings)(r, t.id))
                        messages.push({ kind: "info", text: `${prefix}${t.label}: ${text}` });
                }
                catch (e) {
                    if (!(e instanceof types_1.ToolInputError) || outputSize > 5 * 1024 * 1024)
                        throw e;
                    messages.push({ kind: "warning", text: `${prefix}${t.label}: ${e.message}` });
                }
            }
            push((0, helpers_1.table)(prefix + "Request", ["Part", "Value"], [["Method", r.method], ["URL", (0, curl_exports_1.redactCurl)(r).url], ["Body", r.bodyFile ? "Local file reference" : r.bodyKind === "multipart" ? `${r.form.length} multipart fields` : `${r.bodyKind} · ${(0, types_1.fmtBytes)(Buffer.byteLength(r.body ?? ""))}`], ...r.headers.map(([k, v]) => ["Header: " + k, (0, curl_exports_1.isCurlSecretHeader)(k) ? "REDACTED" : v])]));
        });
        push((0, helpers_1.code)("Normalized cURL", "shell", effective.map(web_curl_1.toCurl).join("\n"), "requests.sh"));
        if ((exportMode === "postman" || exportMode === "both") && effective.some(r => r.form.some(f => f.filename)))
            messages.push({ kind: "warning", text: "Postman uses local file basenames for uploads. Review custom multipart filenames after import." });
        if (exportMode === "postman" || exportMode === "both")
            push((0, helpers_1.code)("Postman collection", "json", (0, curl_exports_1.curlPostman)(effective), "requests.postman_collection.json"));
        if (exportMode === "har" || exportMode === "both")
            push((0, helpers_1.code)("HAR requests · not executed", "json", (0, curl_exports_1.curlHar)(effective), "requests.har"));
        if (action === "save-preset") {
            if (!context.storage)
                throw new types_1.ToolInputError("Preset storage is unavailable.");
            const safe = requests.map(curl_exports_1.redactCurl);
            const presetName = (0, types_1.str)(values, "presetName").trim();
            if (presetName.length > 80)
                throw new types_1.ToolInputError("Preset names must be at most 80 characters.");
            const label = `Saved: ${presetName || `${safe[0].method} ${new URL(safe[0].url).host}${new URL(safe[0].url).pathname}`}${safe.length > 1 ? ` +${safe.length - 1}` : ""}`;
            const saved = context.storage.get(storageKey, []).filter(p => p.label !== label);
            const preset = { ...values, curl: safe.map(web_curl_1.toCurl).join("\n"), shell: "bash", batch: safe.length > 1 };
            await context.storage.set(storageKey, [...saved, { label, values: preset }].slice(-20));
            messages.unshift({ kind: "success", text: "Saved a redacted preset. Replace REDACTED values before running the request." });
        }
        return { stats: [{ label: "Requests", value: String(effective.length) }, { label: "Outputs", value: String(outputs.length) }], messages: [...new Map(messages.map(m => [m.text, m])).values()], outputs };
    }
};
//# sourceMappingURL=curl.js.map