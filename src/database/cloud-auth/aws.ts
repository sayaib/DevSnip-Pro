/**
 * AWS Signature Version 4 and credential resolution, without the AWS SDK.
 *
 * Credentials come, in this order, from the connection (access key and
 * secret), the environment (AWS_ACCESS_KEY_ID...), or a profile in
 * ~/.aws/credentials and ~/.aws/config. Profiles that use SSO, role
 * assumption or credential_process are resolved the way the AWS CLI does:
 * through credential_process, or `aws configure export-credentials`.
 */

import { createHash, createHmac } from "crypto";
import { execFile, exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ConnectionSpec } from "../connection-string";
import { DbError } from "../types";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Epoch milliseconds, for temporary credentials. */
  expiresAt?: number;
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding, as SigV4 wants it. */
function uriEncode(text: string, keepSlash = false): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(keepSlash ? /%2F/g : /$^/, "/");
}

export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface SignInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  date?: Date;
}

/** Returns the headers to send: the input headers plus host, x-amz-date, the token and Authorization. */
export function signRequest(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const date = input.date ?? new Date();
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = String(v);
  headers.host = url.host;
  headers["x-amz-date"] = stamp;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(n => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [input.method.toUpperCase(), uriEncode(decodeURIComponent(url.pathname || "/"), true) || "/", canonicalQuery(url.searchParams), canonicalHeaders, signedHeaders, sha256(input.body)].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = hmac(signingKey(input.credentials.secretAccessKey, day, input.region, input.service), toSign).toString("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/**
 * An RDS / Aurora IAM authentication token: a presigned "connect" URL
 * (without the scheme) that the database accepts as the password for 15 minutes.
 */
export function rdsAuthToken(input: { host: string; port: number; user: string; region: string; credentials: AwsCredentials; date?: Date }): string {
  const date = input.date ?? new Date();
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.region}/rds-db/aws4_request`;
  const params = new URLSearchParams({
    Action: "connect",
    DBUser: input.user,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": "900",
    "X-Amz-SignedHeaders": "host"
  });
  if (input.credentials.sessionToken) params.set("X-Amz-Security-Token", input.credentials.sessionToken);
  const host = `${input.host}:${input.port}`;
  const canonical = ["GET", "/", canonicalQuery(params), `host:${host}\n`, "host", sha256("")].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signature = hmac(signingKey(input.credentials.secretAccessKey, day, input.region, "rds-db"), toSign).toString("hex");
  return `${host}/?${canonicalQuery(params)}&X-Amz-Signature=${signature}`;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** Parses an INI file of [section] blocks into lower-cased keys. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const head = /^\[\s*(.+?)\s*\]$/.exec(line);
    if (head) { section = out[head[1]] = out[head[1]] ?? {}; continue; }
    const eq = line.indexOf("=");
    if (section && eq > 0) section[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return out;
}

function readIni(file: string): Record<string, Record<string, string>> {
  try {
    return parseIni(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const home = (p: string) => p.replace(/^~(?=$|[\\/])/, os.homedir());

/** The merged settings of a profile from ~/.aws/credentials and ~/.aws/config. */
export function profileSettings(name: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const credentials = readIni(home(env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), ".aws", "credentials")));
  const config = readIni(home(env.AWS_CONFIG_FILE || path.join(os.homedir(), ".aws", "config")));
  return { ...(config[name === "default" ? "default" : `profile ${name}`] ?? config[name] ?? {}), ...(credentials[name] ?? {}) };
}

function processCredentials(output: string, source: string): AwsCredentials {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(output);
  } catch {
    throw new DbError(`${source} did not print credentials as JSON.`);
  }
  if (typeof json.AccessKeyId !== "string" || typeof json.SecretAccessKey !== "string") throw new DbError(`${source} did not return an AccessKeyId and SecretAccessKey.`);
  const expires = typeof json.Expiration === "string" ? Date.parse(json.Expiration) : NaN;
  return { accessKeyId: json.AccessKeyId, secretAccessKey: json.SecretAccessKey, sessionToken: typeof json.SessionToken === "string" ? json.SessionToken : undefined, expiresAt: Number.isNaN(expires) ? undefined : expires };
}

function run(command: string, args: string[] | undefined, what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, stdout: string, stderr: string) => {
      if (!error) { resolve(stdout); return; }
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      reject(new DbError(
        missing ? `${what} failed: the AWS CLI was not found.` : `${what} failed: ${String(stderr || error.message).trim().split("\n").pop()?.slice(0, 300)}`,
        missing ? "Install the AWS CLI v2, or use an access key." : "Check the profile, and sign in again with aws sso login if it uses SSO."
      ));
    };
    if (args) execFile(command, args, { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 }, done);
    // credential_process is a command line, run through the shell as the AWS SDKs do.
    else exec(command, { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 }, done);
  });
}

const cache = new Map<string, AwsCredentials>();

/** Credentials for a DynamoDB connection or an IAM token, per the spec's `auth` option. */
export async function resolveAwsCredentials(spec: ConnectionSpec, env: NodeJS.ProcessEnv = process.env): Promise<AwsCredentials> {
  const auth = spec.options.auth || (spec.user ? "access-key" : "env");
  if (auth === "access-key" || (spec.user && spec.password)) {
    return { accessKeyId: spec.user ?? "", secretAccessKey: spec.password ?? "", sessionToken: spec.options.sessiontoken || undefined };
  }
  // DynamoDB Local accepts any key.
  if (auth === "emulator") return { accessKeyId: "local", secretAccessKey: "local" };
  if (auth === "env" && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN || undefined };
  }
  const name = spec.options.profile || env.AWS_PROFILE || "default";
  const cached = cache.get(name);
  if (cached && (!cached.expiresAt || cached.expiresAt - Date.now() > 120_000)) return cached;
  const settings = profileSettings(name, env);
  let credentials: AwsCredentials;
  if (settings.aws_access_key_id && settings.aws_secret_access_key) {
    credentials = { accessKeyId: settings.aws_access_key_id, secretAccessKey: settings.aws_secret_access_key, sessionToken: settings.aws_session_token || undefined };
  } else if (settings.credential_process) {
    credentials = processCredentials(await run(settings.credential_process, undefined, `The credential_process of profile "${name}"`), "credential_process");
  } else if (Object.keys(settings).length) {
    // SSO, role_arn and the rest: the AWS CLI resolves them.
    credentials = processCredentials(await run(process.platform === "win32" ? "aws.exe" : "aws", ["configure", "export-credentials", "--profile", name, "--format", "process"], `Reading profile "${name}"`), "aws configure export-credentials");
  } else {
    throw new DbError(
      auth === "profile" ? `The AWS profile "${name}" was not found in ~/.aws/credentials or ~/.aws/config.` : "No AWS credentials were found.",
      "Enter an access key, name a profile from ~/.aws, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
    );
  }
  cache.set(name, credentials);
  return credentials;
}

/** The region of a profile in ~/.aws/config, when the connection does not name one. */
export function profileRegion(profile: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return profileSettings(profile || env.AWS_PROFILE || "default", env).region || env.AWS_REGION || env.AWS_DEFAULT_REGION;
}
