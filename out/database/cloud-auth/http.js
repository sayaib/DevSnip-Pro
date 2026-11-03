"use strict";
/**
 * The one HTTP client of the cloud adapters (DynamoDB, Cosmos DB, Spanner,
 * Firestore, BigQuery). Built on node:http(s) rather than fetch so a local
 * emulator's self-signed certificate can be accepted when the user asks, and
 * so requests can be aborted when a query is cancelled.
 *
 * Network failures are left as Node errors (ECONNREFUSED...), which
 * friendlyError and the service's lost-connection check already understand;
 * HTTP error statuses become DbErrors with the API's own message.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectJson = exports.apiMessage = exports.httpRequest = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const types_1 = require("../types");
const MAX_BODY = 64 * 1024 * 1024;
function httpRequest(req) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(req.url);
        }
        catch {
            reject(new types_1.DbError("Invalid request URL."));
            return;
        }
        const lib = url.protocol === "https:" ? https : http;
        const body = req.body === undefined ? undefined : Buffer.from(req.body, "utf8");
        const headers = { "user-agent": "DevSnip-Pro", ...req.headers };
        if (body)
            headers["content-length"] = String(body.length);
        const request = lib.request(url, {
            method: req.method,
            headers,
            timeout: req.timeoutMs ?? types_1.LIMITS.queryTimeoutMs,
            signal: req.signal,
            ...(url.protocol === "https:" && req.insecure ? { rejectUnauthorized: false } : {})
        }, response => {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
                size += chunk.length;
                if (size > MAX_BODY) {
                    request.destroy(new types_1.DbError("The response is too large (over 64 MB).", "Narrow the query."));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => {
                const out = {};
                for (const [k, v] of Object.entries(response.headers))
                    if (v !== undefined)
                        out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
                resolve({ status: response.statusCode ?? 0, headers: out, text: Buffer.concat(chunks).toString("utf8") });
            });
            response.on("error", reject);
        });
        request.on("timeout", () => request.destroy(Object.assign(new Error("The request timed out."), { code: "ETIMEDOUT" })));
        request.on("error", reject);
        if (body)
            request.write(body);
        request.end();
    });
}
exports.httpRequest = httpRequest;
function parseJson(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** The API's own error message: Google ({error:{message}}), AWS ({message, __type}), Cosmos ({code, message}). */
function apiMessage(text) {
    const json = parseJson(text);
    if (!json)
        return { message: text.trim().slice(0, 500) };
    const google = json.error && typeof json.error === "object" ? json.error : undefined;
    if (google)
        return { message: String(google.message ?? google.status ?? "Request failed"), code: String(google.status ?? google.code ?? "") || undefined };
    if (typeof json.error === "string")
        return { message: String(json.error_description ?? json.error), code: json.error };
    const type = String(json.__type ?? "").split("#").pop();
    // Cosmos DB wraps the details in a JSON string inside "message".
    let message = String(json.message ?? json.Message ?? json.errorMessage ?? text).replace(/\r?\n?ActivityId:.*$/s, "").trim();
    const inner = /^Message: (\{.*\})/s.exec(message);
    if (inner) {
        const errors = parseJson(inner[1])?.Errors;
        if (Array.isArray(errors) && errors.length)
            message = errors.join(" ");
    }
    return { message: message.slice(0, 800), code: type || (json.code ? String(json.code) : undefined) };
}
exports.apiMessage = apiMessage;
const HINTS = {
    400: "The request was rejected. Check the query and the values.",
    401: "The credentials were rejected. Check the key or sign in again.",
    403: "The credentials work, but lack permission for this. Check the roles or IAM policy.",
    404: "It was not found. Check the project, account, instance or table name.",
    409: "It conflicts with existing data: an item with that key may already exist.",
    412: "It was changed by someone else meanwhile. Refresh and try again.",
    413: "The request is too large.",
    429: "The service is throttling requests. Wait a moment, or raise the provisioned throughput.",
    503: "The service is temporarily unavailable. Try again shortly."
};
/** Throws a DbError for an HTTP error response; returns the parsed JSON body otherwise. */
function expectJson(response, what) {
    if (response.status >= 200 && response.status < 300) {
        if (!response.text)
            return {};
        const json = parseJson(response.text);
        if (!json)
            throw new types_1.DbError(`${what}: the service sent a response that is not JSON.`, "Check the endpoint URL.");
        return json;
    }
    const { message, code } = apiMessage(response.text);
    const authFailed = response.status === 401 || /UnrecognizedClient|InvalidSignature|SignatureDoesNotMatch|ExpiredToken|InvalidClientTokenId|UNAUTHENTICATED|invalid_grant/i.test(`${code} ${message}`);
    throw new types_1.DbError(`${authFailed ? "Authentication failed" : what} (${response.status}${code ? ` ${code}` : ""}): ${message || "no details"}`, authFailed ? "Check the credentials; temporary credentials and tokens expire." : HINTS[response.status], authFailed ? "AUTH" : code);
}
exports.expectJson = expectJson;
//# sourceMappingURL=http.js.map