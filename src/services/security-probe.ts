import axios, { AxiosRequestConfig } from "axios";
import * as https from "https";
import * as tls from "tls";
import { URL } from "url";
import {
  HttpObservation,
  ProbeEvidence,
  SecurityReport,
  TlsObservation,
  analyzeEndpoint,
  buildReflectionMarker,
  sortChecks,
  summarize
} from "./security-analysis";

/**
 * Evidence collection for the endpoint scanner.
 *
 * This is the only part of the security feature that touches the network, and
 * it is deliberately conservative:
 *
 *  - Every probe is a read. Nothing here writes, deletes or attempts an
 *    exploit; the "active" probes send a harmless marker string and request
 *    well-known paths, which is what a browser or a crawler already does.
 *  - Certificate verification is disabled for the HTTP probes on purpose, so a
 *    host with a broken certificate can still be scanned. The certificate is
 *    then judged separately, from the TLS handshake summary, rather than the
 *    scan failing with a connection error and reporting nothing.
 *  - Every probe is individually fault-tolerant: a failure is recorded on that
 *    observation and the scan continues.
 */

/** Cap on the body text kept per probe. Enough to analyse, bounded in memory. */
const MAX_BODY_BYTES = 512 * 1024;
/**
 * Cap on what is accepted off the wire before the sample is taken.
 *
 * This has to be well above the analysis sample: capping the transfer at the
 * sample size made axios abort with "maxContentLength exceeded" on any page
 * larger than 512 KB, which turned an ordinary large homepage into a scan that
 * reported nothing at all.
 */
const MAX_TRANSFER_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT = 15000;
const USER_AGENT = "DevSnip-Pro-Security-Scanner";

export interface ProbeOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /**
   * Sends a marker string as a query parameter and requests well-known
   * sensitive paths. Still read-only, but it generates requests the target did
   * not ask for, so it is opt-in.
   */
  activeChecks?: boolean;
  /** Number of rapid requests for the rate-limit probe. 0 disables it. */
  burstRequests?: number;
  /** Reports progress so the UI can show which probe is running. */
  onProgress?: (step: string, index: number, total: number) => void;
  /** Aborts the remaining probes when it returns true. */
  isCancelled?: () => boolean;
}

/** Header names that carry a credential and are stripped for the auth probe. */
const CREDENTIAL_HEADERS = new Set([
  "authorization", "cookie", "x-api-key", "x-auth-token", "api-key", "apikey",
  "x-access-token", "x-session-token", "proxy-authorization", "x-csrf-token", "x-xsrf-token"
]);

export function hasCredentials(headers: Record<string, string>, url: string): boolean {
  for (const name of Object.keys(headers)) {
    if (CREDENTIAL_HEADERS.has(name.toLowerCase()) && String(headers[name]).trim()) return true;
  }
  return /[?&](access_token|api_key|apikey|auth_token|token|session)=/i.test(url);
}

function stripCredentials(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

function lowerHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function setCookiesFrom(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (String(key).toLowerCase() !== "set-cookie") continue;
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value];
  }
  return [];
}

function bodyToText(data: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  try { return JSON.stringify(data); } catch { return String(data); }
}

/** The one place a request is actually sent. Never throws. */
export async function probeRequest(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
}): Promise<HttpObservation> {
  const method = (options.method || "GET").toUpperCase();
  const started = Date.now();
  const config: AxiosRequestConfig = {
    url: options.url,
    method: method as AxiosRequestConfig["method"],
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT,
    // Every status is data for the scan, including 4xx and 5xx.
    validateStatus: () => true,
    maxRedirects: options.followRedirects === false ? 0 : 3,
    // Response headers are the subject of the scan, so they must not be
    // reinterpreted; the body is read as text and sampled.
    responseType: "text",
    transformResponse: [(value: unknown) => value],
    maxContentLength: MAX_TRANSFER_BYTES,
    maxBodyLength: MAX_TRANSFER_BYTES,
    decompress: true,
    headers: { "User-Agent": USER_AGENT, "Accept": "*/*", ...(options.headers || {}) },
    // A broken certificate is a finding, not a reason to abandon the scan.
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    ...(options.body && method !== "GET" && method !== "HEAD" ? { data: options.body } : {})
  };

  try {
    const response = await axios(config);
    const text = bodyToText(response.data);
    return {
      url: options.url,
      method,
      status: response.status,
      statusText: response.statusText,
      headers: lowerHeaders(response.headers),
      setCookies: setCookiesFrom(response.headers),
      bodySample: text.slice(0, MAX_BODY_BYTES),
      bodyBytes: Buffer.byteLength(text, "utf8"),
      elapsedMs: Date.now() - started
    };
  } catch (error: any) {
    // A redirect with maxRedirects: 0 surfaces as an error in some axios
    // versions while still carrying the response - that response is the point.
    if (error?.response) {
      const text = bodyToText(error.response.data);
      return {
        url: options.url,
        method,
        status: error.response.status,
        statusText: error.response.statusText,
        headers: lowerHeaders(error.response.headers),
        setCookies: setCookiesFrom(error.response.headers),
        bodySample: text.slice(0, MAX_BODY_BYTES),
        bodyBytes: Buffer.byteLength(text, "utf8"),
        elapsedMs: Date.now() - started
      };
    }
    return {
      url: options.url,
      method,
      status: 0,
      headers: {},
      setCookies: [],
      bodySample: "",
      bodyBytes: 0,
      elapsedMs: Date.now() - started,
      error: error?.message ? String(error.message) : String(error),
      errorCode: error?.code ? String(error.code) : undefined
    };
  }
}

/** Reads the certificate and negotiated parameters without sending a request. */
export async function probeTls(target: string, timeoutMs = DEFAULT_TIMEOUT): Promise<TlsObservation> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return { authorized: false, error: "The URL could not be parsed." };
  }
  if (parsed.protocol !== "https:") return { authorized: false, error: "The endpoint is not HTTPS." };

  const port = Number(parsed.port) || 443;
  return new Promise<TlsObservation>(resolve => {
    let settled = false;
    const finish = (value: TlsObservation) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already closed */ }
      resolve(value);
    };

    const socket = tls.connect({
      host: parsed.hostname,
      port,
      servername: parsed.hostname,
      // Verification still runs; the result is read from `authorized` rather
      // than thrown, so an invalid certificate is reported instead of fatal.
      rejectUnauthorized: false,
      timeout: timeoutMs
    });

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      const validTo = certificate?.valid_to;
      const expiry = validTo ? Date.parse(validTo) : NaN;
      const cipher = socket.getCipher();
      finish({
        protocol: socket.getProtocol() || undefined,
        cipher: cipher ? `${cipher.name}` : undefined,
        authorized: socket.authorized,
        authorizationError: socket.authorized ? undefined : String(socket.authorizationError || "unknown validation error"),
        subject: certificate?.subject?.CN ? String(certificate.subject.CN) : undefined,
        issuer: certificate?.issuer?.O ? String(certificate.issuer.O) : (certificate?.issuer?.CN ? String(certificate.issuer.CN) : undefined),
        validFrom: certificate?.valid_from,
        validTo,
        daysUntilExpiry: Number.isFinite(expiry) ? Math.floor((expiry - Date.now()) / 86400000) : undefined,
        subjectAltNames: certificate?.subjectaltname,
        keyBits: typeof certificate?.bits === "number" ? certificate.bits : undefined,
        keyCurve: certificate?.nistCurve || (certificate as { asn1Curve?: string } | undefined)?.asn1Curve
      });
    });
    socket.once("timeout", () => finish({ authorized: false, error: `The TLS handshake timed out after ${timeoutMs}ms.` }));
    socket.once("error", (error: Error) => finish({ authorized: false, error: error.message }));
  });
}

/**
 * Well-known paths that should never be publicly readable.
 *
 * Each carries a content signature. A status code alone is not enough: single
 * page applications answer 200 with their shell for every unknown path, which
 * is the single biggest source of false positives in scanners like this. A
 * path is only reported when the body actually looks like the file.
 */
export const SENSITIVE_PATHS: Array<{ path: string; signature: string; test: (body: string, contentType: string) => boolean }> = [
  {
    path: "/.env", signature: "environment-file syntax",
    test: (body, type) => !type.includes("html") && /^\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*\S/m.test(body) && !/<html/i.test(body)
  },
  {
    path: "/.git/HEAD", signature: "a git ref pointer",
    test: body => /^\s*ref:\s+refs\/(heads|tags)\//m.test(body)
  },
  {
    path: "/.git/config", signature: "git config sections",
    test: body => /\[core\]/.test(body) && /repositoryformatversion/i.test(body)
  },
  {
    path: "/.npmrc", signature: "npm registry credentials",
    test: body => /_authToken\s*=|_auth\s*=|\/\/[^\s]+:_password/i.test(body)
  },
  {
    path: "/.aws/credentials", signature: "an AWS shared-credentials file",
    test: body => /aws_access_key_id\s*=/i.test(body)
  },
  {
    path: "/config.json", signature: "a JSON config containing credential keys",
    test: (body, type) => type.includes("json") && /"(?:password|secret|apiKey|api_key|token|connectionString)"\s*:/i.test(body)
  },
  {
    path: "/wp-config.php.bak", signature: "WordPress database constants",
    test: body => /DB_PASSWORD|DB_NAME/.test(body)
  },
  {
    path: "/phpinfo.php", signature: "a phpinfo() dump",
    test: body => /phpinfo\(\)|PHP Version\s*<\/td>/i.test(body)
  },
  {
    path: "/server-status", signature: "the Apache status page",
    test: body => /Apache Server Status/i.test(body)
  },
  {
    path: "/actuator/env", signature: "a Spring Boot environment dump",
    test: (body, type) => type.includes("json") && /"propertySources"|"activeProfiles"/.test(body)
  },
  {
    path: "/actuator/heapdump", signature: "a JVM heap dump",
    test: (body, type) => type.includes("octet-stream") || /^\u0004JAVA PROFILE/.test(body)
  },
  {
    path: "/.DS_Store", signature: "a macOS directory index",
    test: body => body.startsWith("\u0000\u0000\u0001Bud1") || /Bud1/.test(body.slice(0, 32))
  },
  {
    path: "/debug/pprof/", signature: "Go pprof debug endpoints",
    test: body => /\/debug\/pprof\/(goroutine|heap|profile)/.test(body)
  },
  {
    path: "/.svn/entries", signature: "a Subversion working-copy index",
    test: body => /^\s*\d+\s*$/m.test(body.slice(0, 20)) && /dir\b/.test(body.slice(0, 200))
  }
];

/** Read-only discovery endpoints: useful to know about, not a vulnerability. */
export const DISCOVERY_PATHS: Array<{ path: string; signature: string; test: (body: string, contentType: string) => boolean }> = [
  {
    path: "/swagger.json", signature: "an OpenAPI document",
    test: (body, type) => type.includes("json") && /"(?:swagger|openapi)"\s*:/.test(body)
  },
  {
    path: "/openapi.json", signature: "an OpenAPI document",
    test: (body, type) => type.includes("json") && /"(?:swagger|openapi)"\s*:/.test(body)
  }
];

function withPath(base: string, pathname: string): string {
  const url = new URL(base);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function withProbeParam(base: string, marker: string): string {
  const url = new URL(base);
  url.searchParams.set("devsnipProbe", marker);
  return url.toString();
}

/**
 * Runs the probe plan and returns everything the analyzers need.
 *
 * The plan is ordered cheapest-first so a cancelled scan still produces a
 * useful partial report, and every step is wrapped so one failure never
 * aborts the rest.
 */
export async function collectEvidence(options: ProbeOptions): Promise<{ evidence: ProbeEvidence; notes: string[] }> {
  const notes: string[] = [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const headers = { ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  const probeOrigin = "https://devsnip-cors-probe.example";

  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error("Enter a full URL, including the scheme - for example https://api.example.com/v1/users.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http and https URLs can be scanned (received "${parsed.protocol}").`);
  }

  const steps: Array<{ label: string; run: () => Promise<void> }> = [];
  const evidence: Partial<ProbeEvidence> & { url: string; probeOrigin: string; sentCredentials: boolean } = {
    url: options.url,
    probeOrigin,
    sentCredentials: hasCredentials(headers, options.url)
  };

  steps.push({
    label: "Sending the primary request",
    run: async () => {
      evidence.primary = await probeRequest({ url: options.url, method, headers, body: options.body, timeoutMs });
    }
  });

  steps.push({
    label: "Reading the TLS handshake",
    run: async () => {
      if (parsed.protocol !== "https:") return;
      evidence.tls = await probeTls(options.url, timeoutMs);
    }
  });

  steps.push({
    label: "Checking the plain-HTTP entry point",
    run: async () => {
      if (parsed.protocol !== "https:") return;
      const plain = new URL(options.url);
      plain.protocol = "http:";
      // The default HTTPS port does not carry over to HTTP.
      if (plain.port === "443") plain.port = "";
      evidence.plainHttp = await probeRequest({
        url: plain.toString(), method: "GET", headers: stripCredentials(headers), timeoutMs, followRedirects: false
      });
    }
  });

  steps.push({
    label: "Testing the CORS policy",
    run: async () => {
      evidence.corsSimple = await probeRequest({
        url: options.url, method: "GET", timeoutMs,
        headers: { ...headers, Origin: probeOrigin }
      });
      evidence.corsPreflight = await probeRequest({
        url: options.url, method: "OPTIONS", timeoutMs,
        headers: {
          ...stripCredentials(headers),
          Origin: probeOrigin,
          "Access-Control-Request-Method": method === "GET" ? "POST" : method,
          "Access-Control-Request-Headers": "authorization,content-type"
        }
      });
    }
  });

  if (evidence.sentCredentials) {
    steps.push({
      label: "Re-sending the request without credentials",
      run: async () => {
        evidence.unauthenticated = await probeRequest({
          url: options.url, method, headers: stripCredentials(headers), body: options.body, timeoutMs
        });
      }
    });
  }

  steps.push({
    label: "Checking the TRACE method",
    run: async () => {
      evidence.trace = await probeRequest({ url: options.url, method: "TRACE", timeoutMs, headers: stripCredentials(headers) });
    }
  });

  if (options.activeChecks) {
    steps.push({
      label: "Testing how reflected input is encoded",
      run: async () => {
        const marker = buildReflectionMarker();
        const observation = await probeRequest({
          url: withProbeParam(options.url, marker), method: "GET", headers, timeoutMs
        });
        evidence.reflection = { marker, observation };
      }
    });

    steps.push({
      label: "Requesting well-known sensitive paths",
      run: async () => {
        const results: NonNullable<ProbeEvidence["exposedPaths"]> = [];
        const all = [...SENSITIVE_PATHS, ...DISCOVERY_PATHS];
        for (const entry of all) {
          if (options.isCancelled?.()) break;
          const target = withPath(options.url, entry.path);
          const observation = await probeRequest({
            url: target, method: "GET", timeoutMs: Math.min(timeoutMs, 8000), headers: stripCredentials(headers)
          });
          const contentType = (observation.headers["content-type"] || "").toLowerCase();
          const confirmed = !observation.error &&
            observation.status >= 200 && observation.status < 300 &&
            observation.bodyBytes > 0 &&
            entry.test(observation.bodySample, contentType);
          results.push({ path: entry.path, url: target, observation, confirmed, signature: entry.signature });
        }
        evidence.exposedPaths = results;
      }
    });

    steps.push({
      label: "Looking for a security.txt policy",
      run: async () => {
        evidence.securityTxt = await probeRequest({
          url: withPath(options.url, "/.well-known/security.txt"), method: "GET", timeoutMs: Math.min(timeoutMs, 8000)
        });
      }
    });
  }

  const burstCount = Math.max(0, Math.min(options.burstRequests ?? 0, 25));
  if (burstCount > 0) {
    steps.push({
      label: `Sending a ${burstCount}-request burst`,
      run: async () => {
        const started = Date.now();
        // Concurrent, because a limiter that only triggers on rate has to see
        // the requests overlap. 25 is the hard cap, so this stays a probe.
        const responses = await Promise.all(
          Array.from({ length: burstCount }, () =>
            probeRequest({ url: options.url, method, headers, body: options.body, timeoutMs }))
        );
        const statuses = responses.map(response => response.status);
        evidence.burst = {
          requests: burstCount,
          statuses,
          limited: statuses.filter(status => status === 429 || status === 503).length,
          elapsedMs: Date.now() - started
        };
      }
    });
  }

  for (let index = 0; index < steps.length; index++) {
    if (options.isCancelled?.()) {
      notes.push(`The scan was cancelled after ${index} of ${steps.length} probes.`);
      break;
    }
    options.onProgress?.(steps[index].label, index + 1, steps.length);
    try {
      await steps[index].run();
    } catch (error) {
      notes.push(`${steps[index].label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!evidence.primary) {
    throw new Error("The endpoint could not be reached, so there was nothing to analyse.");
  }
  if (evidence.primary.error) {
    notes.push(`The primary request failed: ${evidence.primary.error}`);
  }

  return { evidence: evidence as ProbeEvidence, notes };
}

/** Collects evidence and turns it into a finished report. */
export async function runEndpointScan(options: ProbeOptions): Promise<SecurityReport> {
  const startedAt = new Date();
  const started = Date.now();
  const { evidence, notes } = await collectEvidence(options);
  const checks = sortChecks(analyzeEndpoint(evidence));
  return {
    target: options.url,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - started,
    checks,
    summary: summarize(checks),
    notes
  };
}
