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

import * as http from "http";
import * as https from "https";
import { DbError, LIMITS } from "../types";

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Accept self-signed certificates (local emulators only). */
  insecure?: boolean;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

const MAX_BODY = 64 * 1024 * 1024;

export function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      reject(new DbError("Invalid request URL."));
      return;
    }
    const lib = url.protocol === "https:" ? https : http;
    const body = req.body === undefined ? undefined : Buffer.from(req.body, "utf8");
    const headers: Record<string, string> = { "user-agent": "DevSnip-Pro", ...req.headers };
    if (body) headers["content-length"] = String(body.length);
    const request = lib.request(url, {
      method: req.method,
      headers,
      timeout: req.timeoutMs ?? LIMITS.queryTimeoutMs,
      signal: req.signal,
      ...(url.protocol === "https:" && req.insecure ? { rejectUnauthorized: false } : {})
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) { request.destroy(new DbError("The response is too large (over 64 MB).", "Narrow the query.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(response.headers)) if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        resolve({ status: response.statusCode ?? 0, headers: out, text: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("The request timed out."), { code: "ETIMEDOUT" })));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function parseJson(text: string): Record<string, any> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The API's own error message: Google ({error:{message}}), AWS ({message, __type}), Cosmos ({code, message}). */
export function apiMessage(text: string): { message: string; code?: string } {
  const json = parseJson(text);
  if (!json) return { message: text.trim().slice(0, 500) };
  const google = json.error && typeof json.error === "object" ? json.error : undefined;
  if (google) return { message: String(google.message ?? google.status ?? "Request failed"), code: String(google.status ?? google.code ?? "") || undefined };
  if (typeof json.error === "string") return { message: String(json.error_description ?? json.error), code: json.error };
  const type = String(json.__type ?? "").split("#").pop();
  // Cosmos DB wraps the details in a JSON string inside "message".
  let message = String(json.message ?? json.Message ?? json.errorMessage ?? text).replace(/\r?\n?ActivityId:.*$/s, "").trim();
  const inner = /^Message: (\{.*\})/s.exec(message);
  if (inner) {
    const errors = parseJson(inner[1])?.Errors;
    if (Array.isArray(errors) && errors.length) message = errors.join(" ");
  }
  return { message: message.slice(0, 800), code: type || (json.code ? String(json.code) : undefined) };
}

const HINTS: Record<number, string> = {
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
export function expectJson<T = Record<string, any>>(response: HttpResponse, what: string): T {
  if (response.status >= 200 && response.status < 300) {
    if (!response.text) return {} as T;
    const json = parseJson(response.text);
    if (!json) throw new DbError(`${what}: the service sent a response that is not JSON.`, "Check the endpoint URL.");
    return json as T;
  }
  const { message, code } = apiMessage(response.text);
  const authFailed = response.status === 401 || /UnrecognizedClient|InvalidSignature|SignatureDoesNotMatch|ExpiredToken|InvalidClientTokenId|UNAUTHENTICATED|invalid_grant/i.test(`${code} ${message}`);
  throw new DbError(
    `${authFailed ? "Authentication failed" : what} (${response.status}${code ? ` ${code}` : ""}): ${message || "no details"}`,
    authFailed ? "Check the credentials; temporary credentials and tokens expire." : HINTS[response.status],
    authFailed ? "AUTH" : code
  );
}
