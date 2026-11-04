"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeApiResponse = void 0;
const web_http_1 = require("./web-http");
const statusHints = {
    201: "Created: inspect Location for the new resource.", 202: "Accepted: processing may still be pending; use the API's polling/status contract.",
    204: "No Content: do not attempt to parse an absent JSON body.", 206: "Partial Content: inspect Content-Range before treating this as a complete representation.",
    301: "Permanent redirect: inspect Location and client redirect policy.", 302: "Temporary redirect: inspect Location and client redirect policy.",
    304: "Not Modified: reuse a stored representation; this response has no content.", 307: "Temporary redirect preserving the request method.", 308: "Permanent redirect preserving the request method.",
    400: "Bad Request: inspect validation details in the response body.", 401: "Unauthorized: credentials are missing or invalid; inspect WWW-Authenticate.",
    403: "Forbidden: access is refused; inspect resource authorization and API policy.", 404: "Not Found: check path, resource identifier and API version.",
    405: "Method Not Allowed: inspect Allow for supported methods.", 409: "Conflict: refresh resource state before deciding whether to retry.",
    412: "Precondition Failed: inspect ETag/If-Match and refresh stale state.", 415: "Unsupported Media Type: check the request Content-Type.",
    422: "Unprocessable Content: inspect field validation errors.", 429: "Too Many Requests: honor Retry-After and the API's rate-limit policy.",
    500: "Internal Server Error: retry only when the request is safe to repeat.", 502: "Bad Gateway: an upstream response failed.",
    503: "Service Unavailable: inspect Retry-After; use bounded backoff for requests safe to repeat.", 504: "Gateway Timeout: an upstream operation timed out; it may still have completed."
};
function analyzeApiResponse(r, now = new Date()) {
    const values = (name) => r.headers.filter(([k]) => k.toLowerCase() === name).map(([, v]) => v);
    const get = (name) => values(name).join(", ");
    const note = (severity, category, message) => r.diagnostics.push({ severity, category, message });
    if (r.status)
        note(r.status >= 400 ? "warning" : "info", "Status", `${r.status}${r.statusText ? " " + r.statusText : ""}: ${statusHints[r.status] || (r.status < 200 ? "Informational response." : r.status < 300 ? "Successful HTTP status; inspect application-level errors too." : r.status < 400 ? "Redirect response." : "HTTP error response.")}`);
    if (r.chain.length > 1)
        note("info", "HTTP", `${r.chain.length} response header blocks were captured; inspection targets the final block.`);
    const contentType = get("content-type");
    if (r.isJson && contentType && !/(?:^|\+|\/)json(?:\s*;|$)/i.test(contentType))
        note("warning", "Content", "Content-Type does not advertise JSON, but the response body is JSON.");
    if (/\bcharset\s*=\s*"?(?!utf-?8\b|us-ascii\b)[\w-]+/i.test(contentType))
        note("info", "Content", "The declared charset is not UTF-8. Pasted Unicode text cannot verify the original wire encoding.");
    const noBody = r.requestMethod === "HEAD" || r.status !== undefined && (r.status < 200 || r.status === 204 || r.status === 205 || r.status === 304);
    if (noBody && r.bodyText.length)
        note("warning", "HTTP", "This response should not carry content for its status/request method, but captured body text is present.");
    const lengths = values("content-length").flatMap(v => v.split(",").map(s => s.trim()));
    if (lengths.some(v => !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))))
        note("error", "Framing", "Content-Length is invalid or exceeds the safe integer range.");
    if (lengths.length && r.status !== undefined && (r.status < 200 || r.status === 204))
        note("warning", "Framing", "Content-Length must not be sent on informational or 204 responses.");
    if (new Set(lengths).size > 1)
        note("error", "Framing", "Conflicting Content-Length values were captured. Do not rely on this message's framing.");
    if (lengths.length && get("transfer-encoding"))
        note("warning", "Framing", "Content-Length and Transfer-Encoding are both present; intermediaries may disagree on message framing.");
    if (lengths.length && !noBody && !get("content-encoding") && !get("transfer-encoding") && r.source !== "har" && /^\d+$/.test(lengths[0]) && Number(lengths[0]) !== r.bytes)
        note("warning", "Content", `Content-Length declares ${lengths[0]} bytes; the captured UTF-8 body is ${r.bytes} bytes. The capture may be partial, edited or decoded.`);
    if (get("content-encoding"))
        note("info", "Content", "Content-Encoding is present. Clients often decompress captures; displayed body bytes are not a measurement of compressed wire size.");
    if (get("transfer-encoding"))
        note("info", "Content", "Transfer-Encoding is present. Pasted content is not automatically dechunked or decompressed.");
    if (/gzip|br|deflate/i.test(get("content-encoding")) && !r.isJson && /json/i.test(contentType))
        note("info", "Content", "JSON parsing may require a decoded text capture; binary compression is not inferred from pasted characters.");
    for (const name of ["content-type", "location", "retry-after", "access-control-allow-origin"])
        if (values(name).length > 1)
            note("warning", "Headers", `Repeated ${name} fields may be ambiguous for clients. All captured values are retained.`);
    const retry = get("retry-after");
    if (retry) {
        if (/^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)))
            note("info", "Retry", `Retry-After requests a delay of ${retry} seconds. Retry only if the operation is safe to repeat.`);
        else {
            const httpDate = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/;
            const time = httpDate.test(retry) ? Date.parse(retry) : NaN;
            if (!Number.isFinite(time))
                note("warning", "Retry", "Retry-After is neither integer seconds nor a recognized HTTP date.");
            else
                note("info", "Retry", `Retry-After date: ${new Date(time).toISOString()} (${Math.max(0, Math.ceil((time - now.getTime()) / 1000))} seconds from the inspection clock).`);
        }
    }
    for (const name of ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit", "ratelimit-policy"]) {
        if (get(name))
            r.rateLimits.push([name, get(name)]);
    }
    if (r.rateLimits.length)
        note("info", "Rate limits", "Rate-limit fields are shown as declared. Reset values may be durations or timestamps; follow the API's documented convention.");
    const cache = get("cache-control");
    if (cache) {
        r.cache = (0, web_http_1.explainCacheControl)(cache).rows;
        for (const [directive, value] of r.cache)
            if (["max-age", "s-maxage", "stale-while-revalidate", "stale-if-error"].includes(directive) && !/^\d+(?: \(|$)/.test(value))
                note("warning", "Caching", `Cache-Control ${directive} must contain nonnegative integer seconds.`);
        if (/(?:^|,)\s*no-store\b/i.test(cache))
            note("info", "Caching", "no-store prohibits storing this response in HTTP caches.");
        else if (/(?:^|,)\s*no-cache\b/i.test(cache))
            note("info", "Caching", "no-cache permits storage but requires revalidation before reuse.");
        if (/(?:^|,)\s*public\b/i.test(cache) && /(?:^|,)\s*private\b/i.test(cache))
            note("warning", "Caching", "Cache-Control includes both public and private; review the intended cache policy.");
    }
    if (get("etag"))
        note("info", "Caching", "ETag supports conditional requests with If-None-Match; use If-Match for concurrency only as supported by the API.");
    if (get("last-modified"))
        note("info", "Caching", "Last-Modified can support conditional requests with If-Modified-Since.");
    if (get("access-control-allow-origin") === "*" && /^true$/i.test(get("access-control-allow-credentials")))
        note("warning", "CORS", "Wildcard Access-Control-Allow-Origin cannot authorize a credentialed browser response.");
    if (get("access-control-allow-origin") && get("access-control-allow-origin") !== "*" && !get("vary").split(",").some(v => v.trim().toLowerCase() === "origin"))
        note("info", "CORS", "If Access-Control-Allow-Origin varies per request, include Vary: Origin in cacheable responses.");
    if (r.status === 405 && !get("allow"))
        note("warning", "HTTP", "A 405 response should include an Allow header.");
    if (r.status === 401 && !get("www-authenticate"))
        note("warning", "HTTP", "A 401 response should include a WWW-Authenticate challenge.");
    if (r.status && [301, 302, 303, 307, 308].includes(r.status) && !get("location"))
        note("info", "HTTP", "No Location header was captured for this redirect.");
    const location = get("location");
    if (location)
        r.links.push({ relation: "location", url: location });
    // Match angle-bracket link targets and quoted/unquoted relation parameters; commas in URLs are retained.
    for (const value of values("link")) {
        if (r.links.length >= 100)
            break;
        if (value.length > 65536) {
            note("warning", "Pagination", "A Link field exceeds 64 KiB and was omitted from detailed link parsing.");
            continue;
        }
        const pattern = /<([^<>]{1,4096})>([^<]{0,4096})/g;
        let match;
        while ((match = pattern.exec(value))) {
            const relation = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(match[2]);
            for (const rel of (relation?.[1] || relation?.[2] || "related").split(/\s+/).filter(Boolean))
                r.links.push({ relation: rel, url: match[1] });
            if (r.links.length >= 100)
                break;
        }
    }
    if (r.links.length >= 100)
        note("info", "Pagination", "Link exploration is limited to 100 relationships; original header values are retained.");
    if (r.links.some(link => link.relation === "next"))
        note("info", "Pagination", "A next-page link is present in the Link header.");
    for (const value of values("set-cookie")) {
        if (value.length > 16384) {
            note("warning", "Cookies", "A Set-Cookie field exceeds 16 KiB and was omitted from detailed cookie parsing.");
            continue;
        }
        try {
            const cookie = (0, web_http_1.parseSetCookie)(value, now);
            r.cookies.push({ name: cookie.name, attributes: Object.entries(cookie.attributes).map(([k, v]) => `${k}${v === true ? "" : "=" + v}`).join("; "), issues: cookie.issues.map(i => i.message) });
            for (const issue of cookie.issues.filter(i => i.severity !== "info"))
                note(issue.severity, "Cookies", `${cookie.name}: ${issue.message}`);
        }
        catch {
            note("warning", "Cookies", "A Set-Cookie field could not be parsed. Cookies are retained as separate header entries.");
        }
    }
    const body = r.body;
    if (r.isJson && body && typeof body === "object" && !Array.isArray(body)) {
        const object = body;
        for (const [key, value] of Object.entries(object))
            if (Array.isArray(value))
                note("info", "Shape", `${JSON.stringify(key)} contains ${value.length} items.`);
        for (const container of [object, object.meta, object.pagination])
            if (container && typeof container === "object" && !Array.isArray(container)) {
                const keys = ["next", "next_cursor", "nextCursor", "cursor", "page", "total", "total_count", "has_more", "hasMore", "nextPageToken"].filter(k => Object.prototype.hasOwnProperty.call(container, k));
                if (keys.length)
                    note("info", "Pagination", `Pagination fields: ${keys.join(", ")}.`);
            }
        if (Array.isArray(object.errors) && object.errors.length && (Object.prototype.hasOwnProperty.call(object, "data") || /graphql/i.test(contentType)))
            note("warning", "GraphQL", "GraphQL-style errors are present; an HTTP success status does not mean the operation succeeded.");
        else if ((r.status === undefined || r.status >= 400) && ["error", "errors", "detail", "message"].some(k => Object.prototype.hasOwnProperty.call(object, k)))
            note("info", "Errors", "Structured error details are present in the body.");
        if (/application\/problem\+json/i.test(contentType)) {
            note("info", "Errors", "This is an RFC 9457 Problem Details response. Treat type as an identifier; detail/title are descriptive text.");
            if (Object.prototype.hasOwnProperty.call(object, "status") && (!Number.isInteger(object.status) || Number(object.status) < 100 || Number(object.status) > 599))
                note("warning", "Errors", "Problem Details status is not a valid HTTP status integer.");
            else if (typeof object.status === "number" && r.status !== undefined && object.status !== r.status)
                note("warning", "Errors", "Problem Details status differs from the actual HTTP status. The HTTP status takes precedence.");
        }
    }
    if (r.isJson && Array.isArray(body))
        note("info", "Shape", `Top-level array with ${body.length} items; field exploration samples at most 50 elements.`);
    const ids = r.headers.filter(([k]) => /^(x-request-id|request-id|x-correlation-id|traceparent|x-amzn-trace-id|cf-ray)$/i.test(k));
    if (ids.length)
        note("info", "Tracing", `Correlation metadata captured in ${ids.map(([k]) => k).join(", ")}. Include it when debugging with the API operator.`);
}
exports.analyzeApiResponse = analyzeApiResponse;
//# sourceMappingURL=api-response-analysis.js.map