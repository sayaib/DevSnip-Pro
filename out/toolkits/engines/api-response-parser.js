"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseApiTransport = void 0;
const types_1 = require("../types");
const api_response_json_1 = require("./api-response-json");
const statusPattern = /^HTTP\/(1\.[01]|2(?:\.0)?|3(?:\.0)?)\s+([1-5]\d{2})(?:[ \t]+([^\r\n]*))?$/;
const headerName = /^[!#$%&'*+.^_`|~\w-]+$/;
function parseApiTransport(raw, options = {}) {
    (0, api_response_json_1.checkApiSize)(raw);
    if (!raw.trim())
        throw new types_1.ToolInputError("Paste an API response (raw HTTP, HAR or a response body).");
    const mode = options.mode ?? "auto";
    if (!["auto", "http", "body", "har"].includes(mode))
        throw new types_1.ToolInputError("Choose a supported response input format.");
    if (options.requestMethod && !/^[A-Za-z]+$/.test(options.requestMethod))
        throw new types_1.ToolInputError("Request method must contain letters only.");
    const diagnostics = [];
    const result = { source: "body", bodyText: raw, headers: [], chain: [], diagnostics, requestMethod: options.requestMethod?.toUpperCase() };
    if (mode === "body")
        return result;
    const trimmed = raw.trimStart().replace(/^\uFEFF/, "");
    if (mode === "har" || mode === "auto" && trimmed.startsWith("{")) {
        let value;
        try {
            value = (0, api_response_json_1.parseApiJson)(trimmed).value;
        }
        catch (error) {
            if (mode === "har")
                throw new types_1.ToolInputError(error instanceof types_1.ToolInputError ? error.message : "Invalid HAR JSON. Check quoting, commas and truncation.");
        }
        if (mode === "har" || value?.log?.version === "1.2" && Array.isArray(value.log.entries)) {
            const entries = value?.log?.entries;
            if (!Array.isArray(entries) || !entries.length)
                throw new types_1.ToolInputError("HAR must contain a nonempty log.entries array.");
            const index = options.harIndex ?? 0;
            if (!Number.isInteger(index) || index < 0 || index >= entries.length)
                throw new types_1.ToolInputError(`HAR entry index must be between 0 and ${entries.length - 1}.`);
            const entry = entries[index], response = entry?.response, content = response?.content;
            if (!response || !Array.isArray(response.headers))
                throw new types_1.ToolInputError("The selected HAR entry has no response/headers array.");
            if (response.headers.length > 1000)
                throw new types_1.ToolInputError("Response exceeds 1,000 headers.");
            result.source = "har";
            result.harEntries = entries.length;
            result.status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined;
            if (!result.status)
                diagnostics.push({ severity: "warning", category: "HAR", message: "The HAR entry has no completed HTTP status (possibly blocked, failed or not executed)." });
            result.statusText = typeof response.statusText === "string" ? response.statusText : "";
            if (/[\x00-\x1f\x7f]/.test(result.statusText ?? ""))
                throw new types_1.ToolInputError("HAR status text contains control characters.");
            const protocol = typeof response.httpVersion === "string" ? response.httpVersion.replace(/^HTTP\//, "").replace(/^h([23])$/, "$1") : "";
            result.protocol = /^(1\.[01]|[23](?:\.0)?)$/.test(protocol) ? protocol : undefined;
            result.headers = response.headers.map((h) => {
                if (!h || typeof h.name !== "string" || typeof h.value !== "string" || !headerName.test(h.name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(h.value))
                    throw new types_1.ToolInputError("Invalid header in HAR response.");
                return [h.name, h.value];
            });
            if (!result.headers.some(([k]) => /^content-type$/i.test(k)) && typeof content?.mimeType === "string" && !/[\x00-\x1f\x7f]/.test(content.mimeType))
                result.headers.push(["Content-Type", content.mimeType]);
            result.bodyText = typeof content?.text === "string" ? content.text : "";
            if (content?.text === undefined)
                diagnostics.push({ severity: "info", category: "HAR", message: "This HAR entry omits response content. Body size and content checks apply only to captured text." });
            if (content?.encoding === "base64") {
                if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.bodyText))
                    throw new types_1.ToolInputError("Invalid base64 HAR response content.");
                const bytes = Buffer.from(result.bodyText, "base64");
                result.capturedBytes = bytes.length;
                try {
                    result.bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                }
                catch {
                    result.encoding = "base64";
                    diagnostics.push({ severity: "info", category: "HAR", message: "Binary HAR content is shown as base64; it is not rendered or executed." });
                }
            }
            else if (content?.encoding)
                diagnostics.push({ severity: "warning", category: "HAR", message: "Unknown HAR content encoding; text is retained without decoding." });
            result.requestMethod = options.requestMethod?.toUpperCase() || (typeof entry.request?.method === "string" ? entry.request.method.toUpperCase() : undefined);
            result.url = typeof entry.request?.url === "string" ? entry.request.url : undefined;
            result.durationMs = typeof entry.time === "number" && Number.isFinite(entry.time) && entry.time >= 0 ? entry.time : undefined;
            result.chain = [{ status: result.status, statusText: result.statusText, protocol: result.protocol, headers: result.headers }];
            return result;
        }
    }
    if (mode === "auto" && !/^HTTP\//.test(trimmed))
        return result;
    let offset = raw.length - raw.trimStart().length;
    if (raw[offset] === "\uFEFF")
        offset++;
    const line = (start) => { const end = raw.indexOf("\n", start), next = end < 0 ? raw.length : end + 1; return { value: raw.slice(start, end < 0 ? raw.length : end).replace(/\r$/, ""), next }; };
    result.source = "http";
    for (let blockIndex = 0; blockIndex < 50; blockIndex++) {
        const first = line(offset), match = statusPattern.exec(first.value);
        if (match && /[\x00-\x08\x0a-\x1f\x7f]/.test(first.value))
            throw new types_1.ToolInputError("HTTP status text contains control characters.");
        if (!match && (blockIndex > 0 || /^HTTP\//.test(first.value)))
            throw new types_1.ToolInputError("Invalid HTTP status line. Use HTTP/1.1 200 OK, HTTP/2 200 or HTTP/3 200.");
        const block = { headers: [] };
        if (match) {
            block.protocol = match[1];
            block.status = Number(match[2]);
            block.statusText = match[3] ?? "";
            offset = first.next;
        }
        else if (mode !== "http")
            return result;
        let ended = false;
        while (offset < raw.length) {
            const current = line(offset);
            if (!current.value) {
                offset = current.next;
                ended = true;
                break;
            }
            if (/^[ \t]/.test(current.value) && block.headers.length && !/[\x00-\x08\x0a-\x1f\x7f]/.test(current.value)) {
                block.headers[block.headers.length - 1][1] += " " + current.value.trim();
                diagnostics.push({ severity: "warning", category: "Headers", message: "Obsolete folded header lines were unfolded. Modern HTTP senders should use one line per header." });
            }
            else {
                const colon = current.value.indexOf(":"), name = current.value.slice(0, colon);
                if (colon < 1 || !headerName.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(current.value)) {
                    diagnostics.push({ severity: "error", category: "Headers", message: "A malformed header or missing header/body separator was found. Remaining text is retained as the body." });
                    break;
                }
                block.headers.push([name, current.value.slice(colon + 1).trim()]);
                if (block.headers.length > 1000)
                    throw new types_1.ToolInputError("Response exceeds 1,000 headers.");
            }
            offset = current.next;
        }
        result.chain.push(block);
        Object.assign(result, block);
        const mayContinue = block.status !== 101 && (block.status !== undefined && block.status < 200 || block.status !== undefined && block.status >= 300 && block.status < 400 || /connection established/i.test(block.statusText ?? ""));
        if (ended && mayContinue && statusPattern.test(line(offset).value))
            continue;
        result.bodyText = raw.slice(offset);
        if (!ended && !result.bodyText && block.headers.length)
            diagnostics.push({ severity: "info", category: "Headers", message: "Header-only capture: no blank header/body separator was supplied." });
        if (block.status && block.status < 200 && block.status !== 101)
            diagnostics.push({ severity: "warning", category: "HTTP", message: "Only an informational response was captured; the final response is missing." });
        return result;
    }
    throw new types_1.ToolInputError("Response chain exceeds 50 HTTP header blocks.");
}
exports.parseApiTransport = parseApiTransport;
//# sourceMappingURL=api-response-parser.js.map