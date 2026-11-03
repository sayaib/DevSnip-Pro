/**
 * Google Cloud OAuth access tokens, without the Google SDKs.
 *
 * Sources, per the connection's `auth` option:
 * - service-account: a key file pasted into the form (kept in SecretStorage);
 * - key-file: a key file on disk (?keyfile=/path/key.json);
 * - adc: Application Default Credentials - GOOGLE_APPLICATION_CREDENTIALS,
 *   then the file `gcloud auth application-default login` writes, then
 *   `gcloud auth print-access-token`;
 * - emulator: no token at all.
 */

import { createSign } from "crypto";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ConnectionSpec } from "../connection-string";
import { DbError } from "../types";
import { expectJson, httpRequest } from "./http";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

interface Token {
  value: string;
  expiresAt: number;
}

interface KeyFile {
  type?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
  project_id?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  quota_project_id?: string;
}

/** What the form may show about a pasted key: never the key itself. */
export interface CredentialSummary {
  type: string;
  clientEmail?: string;
  projectId?: string;
}

/** Checks a pasted key file and returns its public parts. Throws a DbError with what is wrong. */
export function inspectCredentials(text: string): CredentialSummary {
  let json: KeyFile;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DbError("The service account key is not valid JSON.", "Paste the whole .json file you downloaded from IAM → Service accounts → Keys.");
  }
  if (!json || typeof json !== "object") throw new DbError("The service account key is not a JSON object.");
  if (json.type === "service_account") {
    if (!json.client_email || !json.private_key || !/BEGIN (RSA )?PRIVATE KEY/.test(json.private_key)) throw new DbError("The service account key is missing client_email or private_key.", "Download a new JSON key; P12 keys are not supported.");
    return { type: "service_account", clientEmail: json.client_email, projectId: json.project_id };
  }
  if (json.type === "authorized_user") {
    if (!json.refresh_token || !json.client_id) throw new DbError("The user credentials are missing refresh_token or client_id.");
    return { type: "authorized_user", projectId: json.quota_project_id };
  }
  throw new DbError(`Credentials of type "${String(json.type ?? "unknown").slice(0, 40)}" are not supported.`, "Use a service account key (type service_account), or gcloud user credentials.");
}

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function adcFile(env: NodeJS.ProcessEnv): string | undefined {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return env.GOOGLE_APPLICATION_CREDENTIALS;
  const file = process.platform === "win32"
    ? path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "gcloud", "application_default_credentials.json")
    : path.join(env.CLOUDSDK_CONFIG || path.join(os.homedir(), ".config", "gcloud"), "application_default_credentials.json");
  return fs.existsSync(file) ? file : undefined;
}

function readKeyFile(file: string): string {
  const resolved = file.replace(/^~(?=$|[\\/])/, os.homedir());
  try {
    return fs.readFileSync(resolved, "utf8");
  } catch {
    throw new DbError(`The key file could not be read: ${file}`, "Check the path, or paste the key instead.");
  }
}

function gcloudToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.platform === "win32" ? "gcloud.cmd" : "gcloud", ["auth", "print-access-token"], { timeout: 30_000, windowsHide: true, shell: process.platform === "win32" }, (error, stdout) => {
      const token = String(stdout ?? "").trim();
      if (error || !token) reject(new DbError("No Google Cloud credentials were found.", "Run gcloud auth application-default login, or choose a service account key."));
      else resolve(token);
    });
  });
}

/** Makes and caches access tokens for one connection. */
export class GoogleAuth {
  private token?: Token;
  private pending?: Promise<Token>;
  private keyText?: string;
  /** Project the credentials belong to, used when the user's quota project must be named. */
  quotaProject?: string;

  constructor(private readonly spec: ConnectionSpec, private readonly env: NodeJS.ProcessEnv = process.env) {}

  get emulator(): boolean {
    return this.spec.options.auth === "emulator";
  }

  /** Headers that authenticate a request (none for an emulator). */
  async headers(): Promise<Record<string, string>> {
    if (this.emulator) return this.spec.kind === "firestore" ? { authorization: "Bearer owner" } : {};
    const token = await this.accessToken();
    return { authorization: `Bearer ${token}`, ...(this.quotaProject ? { "x-goog-user-project": this.quotaProject } : {}) };
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) return this.token.value;
    // Concurrent requests share one token request.
    this.pending ??= this.fetchToken().finally(() => { this.pending = undefined; });
    this.token = await this.pending;
    return this.token.value;
  }

  /** The key text in use, so its secrets can be redacted from errors. */
  get credentialsText(): string | undefined {
    return this.keyText;
  }

  private keySource(): string | undefined {
    const auth = this.spec.options.auth || "adc";
    if (auth === "service-account") {
      if (!this.spec.credentials) throw new DbError("The service account key is missing.", "Edit the connection and paste the key again.");
      return this.spec.credentials;
    }
    if (auth === "key-file") return readKeyFile(this.spec.options.keyfile ?? "");
    const file = adcFile(this.env);
    return file ? readKeyFile(file) : undefined;
  }

  private async fetchToken(): Promise<Token> {
    const text = this.keySource();
    if (!text) return { value: await gcloudToken(), expiresAt: Date.now() + 30 * 60_000 };
    this.keyText = text;
    inspectCredentials(text);
    const key = JSON.parse(text) as KeyFile;
    let body: string;
    if (key.type === "authorized_user") {
      this.quotaProject = key.quota_project_id || undefined;
      body = new URLSearchParams({ grant_type: "refresh_token", client_id: key.client_id ?? "", client_secret: key.client_secret ?? "", refresh_token: key.refresh_token ?? "" }).toString();
    } else {
      const now = Math.floor(Date.now() / 1000);
      const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = base64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: key.token_uri || TOKEN_URL, iat: now, exp: now + 3600 }));
      let signature: string;
      try {
        signature = base64url(createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key ?? ""));
      } catch {
        throw new DbError("The service account's private key could not be read.", "Download a new JSON key for the service account.");
      }
      body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }).toString();
    }
    const response = await httpRequest({ method: "POST", url: key.token_uri || TOKEN_URL, headers: { "content-type": "application/x-www-form-urlencoded" }, body, timeoutMs: 20_000 });
    const json = expectJson<{ access_token?: string; expires_in?: number }>(response, "Signing in to Google Cloud");
    if (!json.access_token) throw new DbError("Google Cloud did not return an access token.");
    return { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  }
}

/** Authenticated JSON calls to one Google Cloud REST API (or its emulator). */
export class GoogleApi {
  readonly auth: GoogleAuth;

  /** `base` is the API root without a trailing slash, e.g. https://spanner.googleapis.com/v1. */
  constructor(private readonly spec: ConnectionSpec, readonly base: string) {
    this.auth = new GoogleAuth(spec);
  }

  async call<T = Record<string, any>>(method: string, path: string, what: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await httpRequest({
      method,
      url: `${this.base}/${path.replace(/^\//, "")}`,
      headers: { ...(await this.auth.headers()), accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      insecure: /^(true|1|yes)$/i.test(this.spec.options.insecure ?? ""),
      signal
    });
    return expectJson<T>(response, what);
  }
}
