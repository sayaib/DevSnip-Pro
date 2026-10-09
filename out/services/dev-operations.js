"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMockServer = exports.requestOAuthToken = exports.inspectJwt = exports.generateClientCode = exports.CODE_LANGUAGES = void 0;
const axios_1 = __importDefault(require("axios"));
const json_tools_1 = require("./json-tools");
exports.CODE_LANGUAGES = [
    { id: "javascript-fetch", label: "JavaScript (fetch)" },
    { id: "javascript-axios", label: "JavaScript (axios)" },
    { id: "python", label: "Python (requests)" },
    { id: "go", label: "Go (net/http)" },
    { id: "java", label: "Java (HttpClient)" },
    { id: "csharp", label: "C# (HttpClient)" }
];
function jsString(value) {
    return JSON.stringify(value);
}
/**
 * Generates a runnable client for the current request.
 *
 * Every interpolated value goes through a language-appropriate string literal
 * so a header or URL containing quotes produces valid code rather than a
 * broken snippet.
 */
function generateClientCode(request, language) {
    const method = (request.method || "GET").toUpperCase();
    const hasBody = Boolean(request.body && !["GET", "HEAD"].includes(method));
    const headerEntries = Object.entries(request.headers || {});
    switch (language) {
        case "javascript-fetch": {
            const headers = headerEntries.map(([key, value]) => `    ${jsString(key)}: ${jsString(value)}`).join(",\n");
            return [
                `const response = await fetch(${jsString(request.url)}, {`,
                `  method: ${jsString(method)},`,
                headers ? `  headers: {\n${headers}\n  },` : "",
                hasBody ? `  body: ${jsString(request.body)},` : "",
                `});`,
                ``,
                `if (!response.ok) {`,
                `  throw new Error(\`Request failed: \${response.status} \${response.statusText}\`);`,
                `}`,
                `const data = await response.json();`,
                `console.log(data);`
            ]
                .filter(Boolean)
                .join("\n");
        }
        case "javascript-axios": {
            const headers = headerEntries.map(([key, value]) => `    ${jsString(key)}: ${jsString(value)}`).join(",\n");
            return [
                `import axios from "axios";`,
                ``,
                `const response = await axios({`,
                `  method: ${jsString(method.toLowerCase())},`,
                `  url: ${jsString(request.url)},`,
                headers ? `  headers: {\n${headers}\n  },` : "",
                hasBody ? `  data: ${request.body},` : "",
                `  timeout: 30000,`,
                `});`,
                ``,
                `console.log(response.status, response.data);`
            ]
                .filter(Boolean)
                .join("\n");
        }
        case "python": {
            const headers = headerEntries.map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n");
            return [
                `import requests`,
                ``,
                `url = ${JSON.stringify(request.url)}`,
                headers ? `headers = {\n${headers}\n}` : `headers = {}`,
                hasBody ? `payload = ${request.body}` : "",
                ``,
                hasBody
                    ? `response = requests.request(${JSON.stringify(method)}, url, headers=headers, json=payload, timeout=30)`
                    : `response = requests.request(${JSON.stringify(method)}, url, headers=headers, timeout=30)`,
                `response.raise_for_status()`,
                `print(response.status_code, response.json())`
            ]
                .filter(Boolean)
                .join("\n");
        }
        case "go": {
            const headerLines = headerEntries
                .map(([key, value]) => `\treq.Header.Set(${JSON.stringify(key)}, ${JSON.stringify(value)})`)
                .join("\n");
            return [
                `package main`,
                ``,
                `import (`,
                `\t"fmt"`,
                `\t"io"`,
                hasBody ? `\t"strings"` : "",
                `\t"net/http"`,
                `\t"time"`,
                `)`,
                ``,
                `func main() {`,
                hasBody
                    ? `\tbody := strings.NewReader(${JSON.stringify(request.body)})\n\treq, err := http.NewRequest(${JSON.stringify(method)}, ${JSON.stringify(request.url)}, body)`
                    : `\treq, err := http.NewRequest(${JSON.stringify(method)}, ${JSON.stringify(request.url)}, nil)`,
                `\tif err != nil {`,
                `\t\tpanic(err)`,
                `\t}`,
                headerLines,
                ``,
                `\tclient := &http.Client{Timeout: 30 * time.Second}`,
                `\tresp, err := client.Do(req)`,
                `\tif err != nil {`,
                `\t\tpanic(err)`,
                `\t}`,
                `\tdefer resp.Body.Close()`,
                ``,
                `\tdata, _ := io.ReadAll(resp.Body)`,
                `\tfmt.Println(resp.StatusCode, string(data))`,
                `}`
            ]
                .filter(Boolean)
                .join("\n");
        }
        case "java": {
            const headerLines = headerEntries
                .map(([key, value]) => `    .header(${JSON.stringify(key)}, ${JSON.stringify(value)})`)
                .join("\n");
            return [
                `import java.net.URI;`,
                `import java.net.http.HttpClient;`,
                `import java.net.http.HttpRequest;`,
                `import java.net.http.HttpResponse;`,
                `import java.time.Duration;`,
                ``,
                `HttpClient client = HttpClient.newBuilder()`,
                `    .connectTimeout(Duration.ofSeconds(30))`,
                `    .build();`,
                ``,
                `HttpRequest request = HttpRequest.newBuilder()`,
                `    .uri(URI.create(${JSON.stringify(request.url)}))`,
                headerLines,
                hasBody
                    ? `    .method(${JSON.stringify(method)}, HttpRequest.BodyPublishers.ofString(${JSON.stringify(request.body)}))`
                    : `    .method(${JSON.stringify(method)}, HttpRequest.BodyPublishers.noBody())`,
                `    .build();`,
                ``,
                `HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`,
                `System.out.println(response.statusCode());`,
                `System.out.println(response.body());`
            ]
                .filter(Boolean)
                .join("\n");
        }
        case "csharp":
        default: {
            const headerLines = headerEntries
                .map(([key, value]) => `request.Headers.TryAddWithoutValidation(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
                .join("\n");
            return [
                `using System;`,
                `using System.Net.Http;`,
                `using System.Threading.Tasks;`,
                ``,
                `using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };`,
                `using var request = new HttpRequestMessage(new HttpMethod(${JSON.stringify(method)}), ${JSON.stringify(request.url)});`,
                headerLines,
                hasBody
                    ? `request.Content = new StringContent(${JSON.stringify(request.body)}, System.Text.Encoding.UTF8, "application/json");`
                    : "",
                ``,
                `var response = await client.SendAsync(request);`,
                `Console.WriteLine((int)response.StatusCode);`,
                `Console.WriteLine(await response.Content.ReadAsStringAsync());`
            ]
                .filter(Boolean)
                .join("\n");
        }
    }
}
exports.generateClientCode = generateClientCode;
function decodeSegment(segment) {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const normalised = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const json = Buffer.from(normalised, "base64").toString("utf8");
    return JSON.parse(json);
}
/**
 * Decodes a JWT locally.
 *
 * Decoding only: the signature is never verified here, because doing so would
 * require the signing secret, and the UI says as much so a decoded token is
 * not mistaken for a validated one.
 */
function inspectJwt(token) {
    const trimmed = token.trim().replace(/^Bearer\s+/i, "");
    const parts = trimmed.split(".");
    if (parts.length < 2) {
        return { valid: false, signaturePresent: false, warnings: [], error: "A JWT needs at least a header and a payload separated by dots." };
    }
    try {
        const header = decodeSegment(parts[0]);
        const payload = decodeSegment(parts[1]);
        const warnings = [];
        const now = Date.now();
        const algorithm = String(header.alg ?? "");
        if (algorithm.toLowerCase() === "none") {
            warnings.push("The algorithm is \"none\": this token is unsigned and must never be trusted.");
        }
        if (algorithm.startsWith("HS") && parts.length === 3) {
            warnings.push("HMAC (HS*) tokens are symmetric: anyone holding the secret can mint tokens.");
        }
        if (parts.length < 3 || !parts[2]) {
            warnings.push("No signature segment is present.");
        }
        const toIso = (value) => {
            const seconds = Number(value);
            return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
        };
        const expiresAt = toIso(payload.exp);
        const issuedAt = toIso(payload.iat);
        const notBefore = toIso(payload.nbf);
        const expired = expiresAt ? Date.parse(expiresAt) <= now : undefined;
        if (expired)
            warnings.push("This token has already expired.");
        if (!payload.exp)
            warnings.push("No exp claim: this token does not expire.");
        if (notBefore && Date.parse(notBefore) > now)
            warnings.push("The nbf claim is in the future; this token is not valid yet.");
        return {
            valid: true,
            header,
            payload,
            signaturePresent: parts.length === 3 && Boolean(parts[2]),
            issuedAt,
            expiresAt,
            notBefore,
            expired,
            warnings
        };
    }
    catch (error) {
        return {
            valid: false,
            signaturePresent: parts.length === 3,
            warnings: [],
            error: `Could not decode the token: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}
exports.inspectJwt = inspectJwt;
function maskToken(value) {
    const text = String(value ?? "");
    if (text.length <= 12)
        return "***";
    return `${text.slice(0, 6)}...${text.slice(-4)} (${text.length} chars)`;
}
/** Performs an OAuth 2.0 token request and returns the token plus a masked preview. */
async function requestOAuthToken(request) {
    if (!request.tokenUrl?.trim())
        return { ok: false, error: "Enter the token endpoint URL." };
    if (!request.clientId?.trim() && request.grant !== "refresh_token") {
        return { ok: false, error: "Enter the client id." };
    }
    const form = new URLSearchParams();
    form.set("grant_type", request.grant);
    if (request.scope)
        form.set("scope", request.scope);
    if (request.grant === "password") {
        if (!request.username || !request.password) {
            return { ok: false, error: "The password grant needs a username and a password." };
        }
        form.set("username", request.username);
        form.set("password", request.password);
    }
    if (request.grant === "refresh_token") {
        if (!request.refreshToken)
            return { ok: false, error: "Enter the refresh token." };
        form.set("refresh_token", request.refreshToken);
    }
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    if (request.useBasicAuth && request.clientId) {
        const credentials = Buffer.from(`${request.clientId}:${request.clientSecret ?? ""}`).toString("base64");
        headers.Authorization = `Basic ${credentials}`;
    }
    else {
        if (request.clientId)
            form.set("client_id", request.clientId);
        if (request.clientSecret)
            form.set("client_secret", request.clientSecret);
    }
    try {
        const response = await (0, axios_1.default)({
            method: "POST",
            url: request.tokenUrl,
            headers,
            data: form.toString(),
            timeout: request.timeoutMs ?? 30000,
            validateStatus: () => true
        });
        const data = response.data;
        if (response.status >= 400) {
            const detail = data?.error_description || data?.error || JSON.stringify(data ?? {}).slice(0, 300);
            return { ok: false, error: `HTTP ${response.status}: ${detail}` };
        }
        if (!data?.access_token) {
            return { ok: false, error: "The response did not contain an access_token." };
        }
        return {
            ok: true,
            accessToken: String(data.access_token),
            tokenType: data.token_type ? String(data.token_type) : "Bearer",
            expiresIn: Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : undefined,
            refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
            scope: data.scope ? String(data.scope) : undefined,
            safePreview: {
                ...data,
                access_token: maskToken(data.access_token),
                ...(data.refresh_token ? { refresh_token: maskToken(data.refresh_token) } : {}),
                ...(data.id_token ? { id_token: maskToken(data.id_token) } : {})
            }
        };
    }
    catch (error) {
        return { ok: false, error: error?.message ? String(error.message) : "The token request failed." };
    }
}
exports.requestOAuthToken = requestOAuthToken;
// -------------------------------------------------------- mock + SDK export
/** Express mock route plus an inferred JSON Schema contract. */
function generateMockServer(options) {
    let path = "/api/endpoint";
    try {
        path = new URL(options.url).pathname || path;
    }
    catch {
        /* keep the default path for an unparsable URL */
    }
    let sample = { status: "ok", timestamp: Date.now() };
    if (options.body) {
        try {
            sample = JSON.parse(options.body);
        }
        catch {
            sample = { raw: options.body };
        }
    }
    return [
        "// Express mock route",
        'const express = require("express");',
        "const app = express();",
        "app.use(express.json());",
        "",
        `app.all(${JSON.stringify(path)}, (req, res) => {`,
        `  console.log("[mock] ${options.method.toUpperCase()}", req.body);`,
        '  res.setHeader("X-Mocked-By", "DevSnip-Pro");',
        `  res.status(200).json(${JSON.stringify(sample, null, 2).split("\n").join("\n  ")});`,
        "});",
        "",
        "app.listen(3000, () => console.log(\"Mock server on http://localhost:3000\"));",
        "",
        "// Inferred JSON Schema contract",
        JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", ...(0, json_tools_1.inferSchema)(sample) }, null, 2)
    ].join("\n");
}
exports.generateMockServer = generateMockServer;
//# sourceMappingURL=dev-operations.js.map