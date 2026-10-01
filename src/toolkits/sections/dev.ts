import { ToolSpec, ToolInputError, ToolResult, bool, num, str } from "../types";
import { CASES, Codec, IdKind, LineOp, decode, describeCron, detectCodec, encode, generateIds, inspectId, nextRuns, parseCron, slugify, textStats, transformLines, words } from "../engines/dev-utils";
import { diffLines, diffValues } from "../engines/data-inspect";
import { HashAlgorithm, JWT_ALGS, WebhookProvider, availableHashes, digest, hmac, isKeyMaterial, signJwt, toBytes, verifyJwtSignature, verifyWebhook, webhookHandler } from "../engines/web-auth";
import { REGEX_LIBRARY, RegexLang, regexCode, testRegex, validateRegex } from "../engines/dev-regex";
import { code, f, opts, table } from "./helpers";

const CODECS = opts(["base64", "Base64"], ["base64url", "Base64URL"], ["url-component", "URL component (query values)"], ["url", "Full URL"], ["html", "HTML entities"], ["hex", "Hex (UTF-8 bytes)"], ["unicode", "Unicode escapes (\\uXXXX)"], ["json-string", "JSON string literal"]);

const encodeTool: ToolSpec = {
  id: "dev.encode",
  command: "base64Encoder",
  title: "Encode / Decode",
  summary: "Base64, Base64URL, URL, HTML entities, hex, Unicode escapes and JSON strings, in both directions with auto-detect.",
  keywords: ["base64", "url encode", "percent encoding", "html entities", "escape", "unescape", "hex"],
  icon: "binary",
  aliases: [{ command: "urlEncoder", values: { codec: "url-component", direction: "auto" } }],
  live: true,
  fields: [
    f.area("input", "Input", { rows: 7, required: true, fromEditor: true, placeholder: "Text to encode, or encoded text to decode" }),
    f.select("direction", "Direction", opts(["auto", "Auto-detect"], ["encode", "Encode"], ["decode", "Decode"])),
    f.select("codec", "Format", CODECS)
  ],
  examples: [
    { label: "Decode a Base64 string", values: { input: "SGVsbG8sIERldlNuaXAgUHJvIOKckw==", direction: "decode", codec: "base64" } },
    { label: "Encode a query value", values: { input: "name=Ada Lovelace&role=admin/owner", direction: "encode", codec: "url-component" } },
    { label: "Escape HTML", values: { input: '<a href="/x?a=1&b=2">Tom & Jerry</a>', direction: "encode", codec: "html" } }
  ],
  run(values) {
    const input = str(values, "input");
    if (!input) throw new ToolInputError("Enter some text.");
    let codec = str(values, "codec", "base64") as Codec;
    let direction = str(values, "direction", "auto");
    const messages: NonNullable<ToolResult["messages"]> = [];
    if (direction === "auto") {
      const detected = detectCodec(input);
      if (detected) {
        try {
          decode(input, detected);
          codec = detected;
          direction = "decode";
          messages.push({ kind: "info", text: `Detected ${CODECS.find(c => c.value === detected)?.label}; decoded it. Choose "Encode" to encode instead.` });
        } catch { direction = "encode"; }
      } else direction = "encode";
    }
    const output = direction === "decode" ? decode(input, codec) : encode(input, codec);
    return {
      stats: [
        { label: "Direction", value: direction === "decode" ? "Decoded" : "Encoded" },
        { label: "Format", value: CODECS.find(c => c.value === codec)?.label ?? codec },
        { label: "Length", value: `${input.length} → ${output.length}` }
      ],
      messages,
      outputs: [code("Output", "text", output)]
    };
  }
};

const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const jwtTool: ToolSpec = {
  id: "dev.jwt",
  command: "jwtDecoder",
  title: "JWT Decoder & Signer",
  summary: "Decode a JSON Web Token locally (claims with readable dates, expiry, security warnings), verify its signature with a secret, PEM public key or JWK - or sign test tokens with HS/RS/PS/ES/EdDSA.",
  guide: "Everything happens on your machine; tokens and keys are never sent anywhere. HS* tokens verify with the shared secret; RS/PS/ES/EdDSA tokens verify with the issuer's public key (PEM, certificate or a JWK from its jwks.json). Signing is for local testing - never paste production private keys into tools.",
  keywords: ["jwt", "json web token", "bearer", "claims", "exp", "oauth", "id token", "decode token", "sign jwt", "verify jwt", "jwks", "rs256", "hs256"],
  icon: "key",
  live: true,
  examples: [
    { label: "Sample HS256 token (secret: your-256-bit-secret)", values: { mode: "decode", token: SAMPLE_JWT, secret: "your-256-bit-secret" } },
    { label: "Sign a test token (HS256)", values: { mode: "sign", alg: "HS256", payload: '{\n  "sub": "user_123",\n  "role": "admin",\n  "aud": "https://api.example.com"\n}', expiresIn: 60, secret: "dev-secret-at-least-32-bytes-long!!" } }
  ],
  fields: [
    f.select("mode", "Mode", opts(["decode", "Decode & verify"], ["sign", "Sign a test token"])),
    f.area("token", "Token", { rows: 5, required: true, fromEditor: true, placeholder: "eyJhbGciOi... (a leading \"Bearer \" is fine)", showIf: { field: "mode", equals: ["decode"] } }),
    f.select("alg", "Algorithm", JWT_ALGS.map(a => ({ value: a, label: a })), { showIf: { field: "mode", equals: ["sign"] } }),
    f.code("payload", "Payload (JSON)", "json", { rows: 7, default: '{\n  "sub": "user_123",\n  "name": "Ada Lovelace",\n  "role": "admin"\n}', showIf: { field: "mode", equals: ["sign"] } }),
    f.num("expiresIn", "Expires in (minutes, 0 = never)", 60, { min: 0, max: 5_256_000, showIf: { field: "mode", equals: ["sign"] } }),
    f.toggle("iat", "Add iat (issued at)", true, { showIf: { field: "mode", equals: ["sign"] } }),
    f.text("kid", "Key id (kid, optional)", { width: "narrow", showIf: { field: "mode", equals: ["sign"] } }),
    f.secret("secret", "Secret, PEM key or JWK", { placeholder: "HS*: shared secret · RS/ES/PS: public key to verify, private key to sign" })
  ],
  async run(values, ctx) {
    const now = (ctx.now?.() ?? new Date()).getTime();
    if (str(values, "mode", "decode") === "sign") {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(str(values, "payload") || "{}"); } catch (e) { throw new ToolInputError(`The payload is not valid JSON: ${(e as Error).message}`); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ToolInputError("The payload must be a JSON object.");
      const seconds = Math.floor(now / 1000);
      if (bool(values, "iat", true) && payload.iat === undefined) payload.iat = seconds;
      const minutes = num(values, "expiresIn", 60, { min: 0, integer: true, label: "Expires in" });
      if (minutes > 0 && payload.exp === undefined) payload.exp = seconds + minutes * 60;
      const alg = str(values, "alg", "HS256");
      const header: Record<string, unknown> = { alg, typ: "JWT", ...(str(values, "kid").trim() ? { kid: str(values, "kid").trim() } : {}) };
      const token = signJwt(header, payload, str(values, "secret"));
      return {
        stats: [{ label: "Algorithm", value: alg }, { label: "Expires", value: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : "never", tone: payload.exp ? "good" : "warn" }, { label: "Length", value: `${token.length} chars` }],
        messages: [{ kind: "info", text: "Test tokens only. Real tokens should come from your auth server with short expiry, audience (aud) and issuer (iss) claims." }],
        outputs: [code("Token", "text", token), code("Header", "json", JSON.stringify(header, null, 2)), code("Payload", "json", JSON.stringify(payload, null, 2)), code("Use it", "shell", `curl -H "Authorization: Bearer ${token}" https://api.example.com/me`)]
      };
    }
    const token = str(values, "token").trim().replace(/^Bearer\s+/i, "");
    if (!token) throw new ToolInputError("Paste a JWT.");
    const { inspectJwt } = await import("../../services/dev-operations");
    const r = inspectJwt(token);
    if (!r.valid || !r.header || !r.payload) throw new ToolInputError(r.error ?? "This is not a valid JWT.");
    const claims = Object.entries(r.payload).map(([k, v]) => {
      const isTime = ["exp", "iat", "nbf", "auth_time", "updated_at"].includes(k) && typeof v === "number";
      const detail = isTime ? `${new Date((v as number) * 1000).toISOString()} (${relative((v as number) * 1000 - now)})` : CLAIM_MEANINGS[k] ?? "";
      return [k, typeof v === "object" ? JSON.stringify(v) : String(v), detail];
    });
    const stats: NonNullable<ToolResult["stats"]> = [
      { label: "Algorithm", value: String(r.header.alg ?? "?"), tone: String(r.header.alg).toLowerCase() === "none" ? "bad" : "neutral" },
      { label: "Status", value: r.expired ? "expired" : r.expiresAt ? "not expired" : "no expiry", tone: r.expired ? "bad" : r.expiresAt ? "good" : "warn" }
    ];
    const messages: NonNullable<ToolResult["messages"]> = r.warnings.map(w => ({ kind: "warning" as const, text: w }));
    const secret = str(values, "secret");
    if (secret) {
      try {
        const v = verifyJwtSignature(token, secret);
        if (v.note) messages.unshift({ kind: v.ok ? "info" : "warning", text: v.note });
        else {
          stats.push({ label: "Signature", value: v.ok ? "valid" : "INVALID", tone: v.ok ? "good" : "bad" });
          messages.unshift(v.ok ? { kind: "success", text: `The signature matches this ${isKeyMaterial(secret) ? "key" : "secret"}.` } : { kind: "error", text: `The signature does not match this ${isKeyMaterial(secret) ? "key" : "secret"}: the token was altered or signed with a different key.` });
        }
      } catch (error) {
        if (error instanceof ToolInputError) messages.unshift({ kind: "error", text: error.message });
        else throw error;
      }
    } else {
      messages.push({ kind: "info", text: "The signature was not verified. Decoding a token does not prove it is genuine - add the secret or public key." });
    }
    return {
      stats,
      messages,
      outputs: [
        table("Claims", ["Claim", "Value", "Meaning"], claims),
        code("Header", "json", JSON.stringify(r.header, null, 2)),
        code("Payload", "json", JSON.stringify(r.payload, null, 2))
      ]
    };
  }
};

const CLAIM_MEANINGS: Record<string, string> = { iss: "Issuer", sub: "Subject (user id)", aud: "Audience - the API this token is for", jti: "Token id (for revocation / replay checks)", azp: "Authorized party (client id)", scope: "Granted scopes", scp: "Granted scopes", roles: "Roles", email: "Email", email_verified: "Email verified by the issuer", sid: "Session id", nonce: "Must match the nonce sent in the auth request", at_hash: "Access token hash (OIDC)", tid: "Tenant id (Entra ID)", client_id: "Client id" };

function relative(ms: number): string {
  const abs = Math.abs(ms);
  const unit = abs >= 86_400_000 ? [86_400_000, "day"] : abs >= 3_600_000 ? [3_600_000, "hour"] : abs >= 60_000 ? [60_000, "minute"] : [1000, "second"];
  const n = Math.round(abs / (unit[0] as number));
  return ms >= 0 ? `in ${n} ${unit[1]}${n === 1 ? "" : "s"}` : `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

const idTool: ToolSpec = {
  id: "dev.ids",
  command: "idGenerator",
  title: "UUID & ID Generator",
  summary: "Generate UUID v4/v7, ULID, Nano ID, MongoDB ObjectId, random hex or strong passwords in bulk; paste an ID to see when it was created.",
  guide: "UUID v7 and ULID start with a timestamp, so they sort by creation time and index well as database keys. Everything is generated locally with a cryptographic random source.",
  keywords: ["uuid", "guid", "ulid", "nanoid", "objectid", "mongodb id", "snowflake", "random", "password", "token", "secret"],
  icon: "fingerprint",
  fields: [
    f.select("kind", "Type", opts(["uuid4", "UUID v4 (random)"], ["uuid7", "UUID v7 (time-ordered)"], ["ulid", "ULID"], ["nanoid", "Nano ID"], ["objectid", "MongoDB ObjectId"], ["hex", "Random hex"], ["password", "Password"])),
    f.num("count", "How many", 5, { min: 1, max: 1000 }),
    f.num("length", "Length", 21, { min: 4, max: 256, showIf: { field: "kind", equals: ["nanoid", "hex", "password"] } }),
    f.toggle("uppercase", "Uppercase", false, { showIf: { field: "kind", equals: ["uuid4", "uuid7", "ulid", "objectid", "hex"] } }),
    f.toggle("symbols", "Include symbols", true, { showIf: { field: "kind", equals: ["password"] } }),
    f.text("inspect", "Inspect an ID (optional)", { placeholder: "Paste a UUID, ULID, ObjectId or snowflake to decode its timestamp" })
  ],
  run(values) {
    const inspect = str(values, "inspect").trim();
    const outputs: NonNullable<ToolResult["outputs"]> = [];
    const messages: NonNullable<ToolResult["messages"]> = [];
    if (inspect) {
      const rows = inspectId(inspect);
      if (rows) outputs.push(table("Inspected ID", ["Field", "Value"], rows));
      else messages.push({ kind: "warning", text: "That is not a UUID, ULID, MongoDB ObjectId or snowflake ID." });
    }
    const kind = str(values, "kind", "uuid4") as IdKind;
    const ids = generateIds(kind, num(values, "count", 5, { min: 1, max: 1000, integer: true, label: "How many" }), {
      length: num(values, "length", kind === "password" ? 20 : 21, { min: 4, max: 256, integer: true, label: "Length" }),
      uppercase: bool(values, "uppercase"),
      symbols: bool(values, "symbols", true)
    });
    if (kind === "password" && num(values, "length", 21) < 12) messages.push({ kind: "warning", text: "Passwords under 12 characters are weak; use 16 or more." });
    outputs.unshift(code(`${ids.length} generated`, "text", ids.join("\n")));
    return { messages, outputs };
  }
};

const diffTool: ToolSpec = {
  id: "dev.diff",
  command: "textDiff",
  title: "Diff Checker",
  summary: "Compare two texts line by line, or two JSON documents structurally (ignoring key order and formatting).",
  keywords: ["diff", "compare", "difference", "json diff", "text compare", "changes"],
  icon: "diff",
  live: true,
  examples: [{ label: "Text: two config versions", values: { mode: "text", left: "PORT=3000\nLOG_LEVEL=info\nCACHE_TTL=60\nFEATURE_X=false", right: "PORT=3000\nLOG_LEVEL=debug\nCACHE_TTL=60\nFEATURE_X=true\nFEATURE_Y=true" } }, { label: "JSON: API response before and after", values: { mode: "json", left: '{"id": 7, "name": "Ada", "roles": ["admin"], "plan": {"tier": "pro", "seats": 5}}', right: '{"id": 7, "name": "Ada L.", "roles": ["admin", "billing"], "plan": {"tier": "pro", "seats": "5"}, "active": true}' } }],
  fields: [
    f.select("mode", "Compare as", opts(["text", "Text (line by line)"], ["json", "JSON (structure)"])),
    f.code("left", "Original", "text", { rows: 10, required: true, fromEditor: true }),
    f.code("right", "Changed", "text", { rows: 10, required: true }),
    f.toggle("ignoreWhitespace", "Ignore whitespace", false, { showIf: { field: "mode", equals: ["text"] } }),
    f.toggle("ignoreArrayOrder", "Ignore array order", false, { showIf: { field: "mode", equals: ["json"] } }),
    f.text("arrayKey", "Match array items by key", { width: "narrow", placeholder: "id", showIf: { field: "mode", equals: ["json"] } })
  ],
  run(values) {
    const left = str(values, "left");
    const right = str(values, "right");
    if (!left && !right) throw new ToolInputError("Paste the two versions to compare.");
    if (str(values, "mode", "text") === "json") {
      const parse = (t: string, which: string) => { try { return JSON.parse(t); } catch (e) { throw new ToolInputError(`${which} is not valid JSON: ${(e as Error).message}`); } };
      const entries = diffValues(parse(left, "Original"), parse(right, "Changed"), { ignoreArrayOrder: bool(values, "ignoreArrayOrder"), arrayKey: str(values, "arrayKey").trim() || undefined });
      const show = (v: unknown) => v === undefined ? "" : JSON.stringify(v).slice(0, 200);
      const n = (k: string) => entries.filter(e => e.kind === k).length;
      return {
        stats: [{ label: "Added", value: String(n("added")), tone: n("added") ? "good" : "neutral" }, { label: "Removed", value: String(n("removed")), tone: n("removed") ? "bad" : "neutral" }, { label: "Changed", value: String(n("changed") + n("type")), tone: n("changed") + n("type") ? "warn" : "neutral" }],
        messages: entries.length ? entries.filter(e => e.kind === "type").map(e => ({ kind: "warning" as const, text: `${e.path}: type changed from ${typeof e.before} to ${typeof e.after} - a common source of client bugs.` })) : [{ kind: "success", text: "The documents are equivalent." }],
        outputs: entries.length ? [table("Differences", ["Change", "Path", "Before", "After"], entries.map(e => [e.kind, e.path, show(e.before), show(e.after)]))] : []
      };
    }
    const norm = (t: string) => bool(values, "ignoreWhitespace") ? t.split(/\r?\n/).map(l => l.trim().replace(/\s+/g, " ")).join("\n") : t;
    const d = diffLines(norm(left), norm(right));
    return {
      stats: [{ label: "Lines added", value: String(d.added), tone: d.added ? "good" : "neutral" }, { label: "Lines removed", value: String(d.removed), tone: d.removed ? "bad" : "neutral" }],
      messages: d.added || d.removed ? [] : [{ kind: "success", text: "The texts are identical." }],
      outputs: d.added || d.removed ? [code("Unified diff", "diff", d.text)] : []
    };
  }
};

const LINE_OPS = opts(["none", "No line operation"], ["sort-natural", "Sort (natural: a2 before a10)"], ["sort", "Sort A→Z"], ["sort-desc", "Sort Z→A"], ["unique", "Remove duplicate lines"], ["reverse", "Reverse order"], ["remove-empty", "Remove empty lines"], ["trim", "Trim each line"], ["shuffle", "Shuffle"], ["number", "Number lines"]);

const textTool: ToolSpec = {
  id: "dev.text",
  command: "caseConverter",
  title: "Case Converter & Text Tools",
  summary: "Convert between camelCase, snake_case, kebab-case and more; slugify; sort, dedupe and clean lines; count words and bytes.",
  keywords: ["case", "camel", "snake", "kebab", "pascal", "slug", "sort lines", "unique lines", "word count", "character count"],
  icon: "type",
  live: true,
  fields: [
    f.area("input", "Text", { rows: 8, required: true, fromEditor: true, default: "getUserProfile\nHTTP request_id\nlast-modified date" }),
    f.select("lines", "Line operation", LINE_OPS),
    f.toggle("perLine", "Convert case line by line", true)
  ],
  run(values) {
    const input = str(values, "input");
    if (!input) throw new ToolInputError("Enter some text.");
    const op = str(values, "lines", "none");
    const transformed = op === "none" ? input : transformLines(input, [op as LineOp]);
    const perLine = bool(values, "perLine", true);
    const lines = perLine ? transformed.split(/\r?\n/) : [transformed];
    const convert = (fn: (w: string[]) => string) => lines.map(l => fn(words(l))).join("\n");
    return {
      outputs: [
        ...(op !== "none" ? [code("Lines", "text", transformed)] : []),
        table("Cases", ["Case", "Result"], [...CASES.map(c => [c.label, convert(c.convert)]), ["slug", lines.map(slugify).join("\n")]]),
        table("Counts", ["Measure", "Value"], textStats(input))
      ]
    };
  }
};

const cronTool: ToolSpec = {
  id: "dev.cron",
  command: "cronHelper",
  title: "Cron Expression Helper",
  summary: "Explain a cron schedule in plain English and list its next run times, with notes for crontab, GitHub Actions and Kubernetes.",
  guide: "Five fields: minute (0-59), hour (0-23), day of month (1-31), month (1-12 or JAN-DEC), day of week (0-6 or SUN-SAT). * means every value, */n every n-th, a-b a range, a,b a list. When both day fields are set, a day matches either one.",
  keywords: ["cron", "crontab", "schedule", "cronjob", "github actions schedule", "every 5 minutes"],
  icon: "calendar",
  live: true,
  fields: [
    f.text("expression", "Expression", { required: true, default: "*/15 9-17 * * MON-FRI", placeholder: "*/5 * * * *" }),
    f.select("zone", "Time zone", opts(["utc", "UTC"], ["local", "This machine's time zone"])),
    f.num("count", "Next runs", 8, { min: 1, max: 50 })
  ],
  examples: [
    { label: "Every 5 minutes", values: { expression: "*/5 * * * *" } },
    { label: "Weekdays at 09:00", values: { expression: "0 9 * * 1-5" } },
    { label: "Nightly at 02:30", values: { expression: "30 2 * * *" } },
    { label: "First day of the month", values: { expression: "0 0 1 * *" } },
    { label: "Every Sunday at midnight", values: { expression: "0 0 * * 0" } },
    { label: "Every 6 hours", values: { expression: "0 */6 * * *" } }
  ],
  run(values, ctx) {
    const expression = str(values, "expression").trim();
    if (!expression) throw new ToolInputError("Enter a cron expression.");
    const schedule = parseCron(expression);
    const utc = str(values, "zone", "utc") === "utc";
    const runs = nextRuns(schedule, ctx.now?.() ?? new Date(), num(values, "count", 8, { min: 1, max: 50, integer: true, label: "Next runs" }), utc);
    const fmt = (d: Date) => utc
      ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC"
      : d.toLocaleString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const everyMinute = schedule.minute.values.size === 60;
    return {
      stats: [{ label: "Schedule", value: describeCron(schedule) }],
      messages: [
        ...(everyMinute ? [{ kind: "warning" as const, text: "This runs every minute in the matching hours - make sure that is intended." }] : []),
        ...(!runs.length ? [{ kind: "warning" as const, text: "This schedule never runs (for example 31 February)." }] : []),
        { kind: "info", text: "GitHub Actions schedules always run in UTC and may be delayed at busy times; Kubernetes CronJobs use the controller's zone unless you set spec.timeZone." }
      ],
      outputs: [
        table("Next runs", ["#", "Time"], runs.map((d, i) => [i + 1, fmt(d)])),
        code("crontab", "shell", `${schedule.expression} /path/to/command >> /var/log/job.log 2>&1`),
        code("GitHub Actions", "yaml", `on:\n  schedule:\n    - cron: "${schedule.expression}"  # always UTC\n  workflow_dispatch:`),
        code("Kubernetes CronJob", "yaml", `spec:\n  schedule: "${schedule.expression}"\n  timeZone: "Etc/UTC"\n  concurrencyPolicy: Forbid\n  startingDeadlineSeconds: 300`)
      ]
    };
  }
};

const hashTool: ToolSpec = {
  id: "dev.hash",
  command: "hashGenerator",
  title: "Hash, HMAC & Webhook Signatures",
  summary: "MD5, SHA-1, SHA-2 and SHA-3 hashes in hex and Base64; HMAC with any secret; and verify webhook signatures from GitHub, Stripe, Shopify, Slack or any HMAC-SHA256 sender.",
  guide: "Webhook signatures are computed over the exact raw request body. If yours never matches, the framework probably parsed and re-serialised the JSON (express.json(), NestJS body parser) - verify against the raw bytes. MD5 and SHA-1 are fine for checksums, never for passwords or signatures.",
  keywords: ["hash", "sha256", "sha1", "md5", "sha512", "sha3", "checksum", "hmac", "webhook", "signature", "x-hub-signature", "stripe-signature", "shopify hmac", "slack signature"],
  icon: "hash",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["hash", "Hash"], ["hmac", "HMAC"], ["webhook", "Verify a webhook signature"])),
    f.area("input", "Input", { rows: 5, required: true, fromEditor: true, default: "Hello, DevSnip Pro!", showIf: { field: "mode", equals: ["hash", "hmac"] } }),
    f.select("encoding", "Input is", opts(["utf8", "Text (UTF-8)"], ["hex", "Hex bytes"], ["base64", "Base64 bytes"]), { showIf: { field: "mode", equals: ["hash", "hmac"] } }),
    f.select("algorithm", "HMAC algorithm", opts(["sha256", "SHA-256"], ["sha1", "SHA-1"], ["sha384", "SHA-384"], ["sha512", "SHA-512"], ["md5", "MD5"]), { showIf: { field: "mode", equals: ["hmac"] } }),
    f.select("provider", "Sender", opts(["github", "GitHub (X-Hub-Signature-256)"], ["stripe", "Stripe (Stripe-Signature)"], ["shopify", "Shopify (X-Shopify-Hmac-Sha256)"], ["slack", "Slack (X-Slack-Signature)"], ["generic-hex", "Generic HMAC-SHA256, hex"], ["generic-base64", "Generic HMAC-SHA256, Base64"]), { showIf: { field: "mode", equals: ["webhook"] } }),
    f.code("payload", "Raw request body", "json", { rows: 6, default: '{"action":"opened","number":42}', showIf: { field: "mode", equals: ["webhook"] } }),
    f.text("signature", "Signature header value", { default: "sha256=5f1d1b8ab0d2b4b8c1f2c4e3a8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9", showIf: { field: "mode", equals: ["webhook"] } }),
    f.text("timestamp", "Timestamp header (Slack / Stripe)", { width: "narrow", showIf: { field: "provider", equals: ["slack", "stripe"] } }),
    f.secret("secret", "Secret", { showIf: { field: "mode", equals: ["hmac", "webhook"] } })
  ],
  run(values, ctx) {
    const mode = str(values, "mode", "hash");
    if (mode === "webhook") {
      const secret = str(values, "secret");
      if (!secret) throw new ToolInputError("Enter the webhook signing secret.");
      const provider = str(values, "provider", "github") as WebhookProvider;
      const r = verifyWebhook({ provider, payload: str(values, "payload"), secret, signature: str(values, "signature"), timestamp: str(values, "timestamp"), now: ctx.now?.() ?? new Date() });
      const messages: NonNullable<ToolResult["messages"]> = r.notes.map(t => ({ kind: "warning" as const, text: t }));
      if (r.match === true) messages.unshift({ kind: "success", text: "The signature is valid for this body and secret." });
      if (r.match === false) messages.unshift({ kind: "error", text: "The signature does NOT match. Check that you use the raw body (no re-serialised JSON, same whitespace and line endings) and the right secret for this endpoint." });
      if (/\n\s{2,}"/.test(str(values, "payload"))) messages.push({ kind: "info", text: "The body looks pretty-printed. Senders sign the compact body exactly as sent; copy it from the raw request log." });
      return {
        stats: [{ label: "Result", value: r.match === undefined ? "no signature given" : r.match ? "valid" : "INVALID", tone: r.match === undefined ? "neutral" : r.match ? "good" : "bad" }, { label: "Header", value: r.header }],
        messages,
        outputs: [code("Expected signature", "text", r.expected), table("How it is computed", ["Step", "Value"], [["Algorithm", "HMAC-SHA256"], ["Signed content", r.signedContent], ["Encoding", provider === "shopify" || provider === "generic-base64" ? "Base64" : "hex"]]), code("Express handler", "typescript", webhookHandler(provider))]
      };
    }
    const input = str(values, "input");
    if (!input) throw new ToolInputError("Enter some input.");
    const encoding = str(values, "encoding", "utf8") as "utf8" | "hex" | "base64";
    if (mode === "hmac") {
      const secret = str(values, "secret");
      if (!secret) throw new ToolInputError("Enter the HMAC secret.");
      const algorithm = str(values, "algorithm", "sha256") as HashAlgorithm;
      const mac = hmac(input, secret, algorithm, encoding);
      return { outputs: [table(`HMAC-${algorithm.toUpperCase()}`, ["Encoding", "Value"], [["hex", mac.toString("hex")], ["Base64", mac.toString("base64")], ["Base64URL", mac.toString("base64url")]]), code("Node.js", "javascript", `import crypto from "node:crypto";\n\nconst mac = crypto.createHmac(${JSON.stringify(algorithm)}, process.env.SECRET).update(body).digest("hex");\n// Compare with crypto.timingSafeEqual, never ===\n`)] };
    }
    const algs = availableHashes();
    const rows = algs.map(a => { const d = digest(input, a, encoding); return [a.toUpperCase(), d.toString("hex"), d.toString("base64")]; });
    return {
      stats: [{ label: "Input", value: `${toBytes(input, encoding).length} bytes` }, { label: "Algorithms", value: String(rows.length) }],
      messages: [{ kind: "info", text: "Passwords need a slow, salted hash (bcrypt, scrypt, Argon2id) - not any of these." }],
      outputs: [table("Hashes", ["Algorithm", "Hex", "Base64"], rows), code("Verify a downloaded file", "shell", "shasum -a 256 file.zip          # macOS / Linux\ncertutil -hashfile file.zip SHA256   # Windows")]
    };
  }
};

const TZ_DEFAULT = "UTC, America/New_York, Europe/London, Asia/Kolkata, Asia/Tokyo";

function parseInstant(input: string, now: Date): { date: Date; detected: string } {
  const t = input.trim();
  if (!t || /^now$/i.test(t)) return { date: now, detected: "now" };
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    const digits = t.replace(/^-/, "").split(".")[0].length;
    if (digits <= 11) return { date: new Date(n * 1000), detected: "Unix seconds" };
    if (digits <= 14) return { date: new Date(n), detected: "Unix milliseconds" };
    if (digits <= 17) return { date: new Date(n / 1000), detected: "Unix microseconds" };
    return { date: new Date(n / 1_000_000), detected: "Unix nanoseconds" };
  }
  const m = /^\/Date\((\d+)\)\/$/.exec(t);
  if (m) return { date: new Date(Number(m[1])), detected: ".NET JSON date" };
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(" ", "T") : t);
  if (!Number.isNaN(parsed)) return { date: new Date(parsed), detected: /Z|[+-]\d{2}:?\d{2}$|GMT|UTC/i.test(t) ? "date with time zone" : /^\d{4}-\d{2}-\d{2}$/.test(t) ? "date (UTC midnight)" : "date (this machine's time zone)" };
  throw new ToolInputError(`Cannot read "${t}". Use a Unix timestamp (s, ms, µs, ns), an ISO 8601 date, an HTTP date or "now".`);
}

function applyOffset(date: Date, offset: string): Date {
  const t = offset.trim();
  if (!t) return date;
  let ms = date.getTime();
  const re = /([+-])?\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|mo|y)\b/gi;
  let m: RegExpExecArray | null;
  let any = false;
  let sign = 1;
  while ((m = re.exec(t))) {
    any = true;
    if (m[1]) sign = m[1] === "-" ? -1 : 1;
    const n = Number(m[2]) * sign;
    const unit = m[3].toLowerCase();
    if (unit === "mo" || unit === "y") {
      const d = new Date(ms);
      d.setUTCMonth(d.getUTCMonth() + (unit === "y" ? n * 12 : n));
      ms = d.getTime();
    } else ms += n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as Record<string, number>)[unit];
  }
  if (!any) throw new ToolInputError("Offsets look like +1h 30m, -7d, +2w or +1mo.");
  return new Date(ms);
}

const timestampTool: ToolSpec = {
  id: "dev.timestamp",
  command: "timestampConverter",
  title: "Timestamp Converter",
  summary: "Convert Unix timestamps (seconds, ms, µs, ns - detected automatically) and dates in any format to ISO 8601, HTTP and SQL formats, several time zones and a relative time; add offsets like +7d; copy code for each language.",
  keywords: ["timestamp", "unix time", "epoch", "epoch converter", "iso 8601", "date", "time zone", "utc", "milliseconds", "date math"],
  icon: "clock",
  live: true,
  fields: [
    f.text("input", "Timestamp or date", { default: "now", placeholder: "1767225600, 1767225600000, 2026-01-01T00:00:00Z, now" }),
    f.text("offset", "Add / subtract (optional)", { width: "narrow", placeholder: "+1h 30m, -7d, +1mo" }),
    f.text("zones", "Time zones", { width: "wide", default: TZ_DEFAULT })
  ],
  examples: [
    { label: "Unix seconds", values: { input: "1767225600" } },
    { label: "Milliseconds (JavaScript Date.now())", values: { input: "1767225600123" } },
    { label: "Token expiry: now + 15 minutes", values: { input: "now", offset: "+15m" } },
    { label: "HTTP date", values: { input: "Wed, 21 Oct 2026 07:28:00 GMT" } }
  ],
  run(values, ctx) {
    const now = ctx.now?.() ?? new Date();
    const { date: base, detected } = parseInstant(str(values, "input", "now"), now);
    const date = applyOffset(base, str(values, "offset"));
    if (Number.isNaN(date.getTime())) throw new ToolInputError("That date is out of range.");
    const ms = date.getTime();
    const zones = str(values, "zones", TZ_DEFAULT).split(/[,\n]+/).map(z => z.trim()).filter(Boolean);
    const zoneRows = zones.map(zone => {
      try {
        const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" });
        return [zone, fmt.format(date)];
      } catch {
        return [zone, "unknown time zone (use IANA names like Europe/Berlin)"];
      }
    });
    const diff = ms - now.getTime();
    const sec = Math.floor(ms / 1000);
    return {
      stats: [{ label: "Detected", value: detected }, { label: "Relative", value: Math.abs(diff) < 1000 ? "now" : relative(diff) }, { label: "Day of week", value: date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) + " (UTC)" }],
      messages: sec > 2_147_483_647 ? [{ kind: "warning", text: "Beyond 2038-01-19: overflows signed 32-bit Unix time (old MySQL TIMESTAMP columns, some C libraries)." }] : [],
      outputs: [
        table("Formats", ["Format", "Value"], [["Unix seconds", String(sec)], ["Unix milliseconds", String(ms)], ["ISO 8601 (UTC)", date.toISOString()], ["RFC 7231 / HTTP date", date.toUTCString()], ["SQL DATETIME (UTC)", date.toISOString().replace("T", " ").slice(0, 19)], ["This machine", date.toString()], ["Week number (ISO)", String(isoWeek(date))]]),
        table("Time zones", ["Zone", "Local time"], zoneRows),
        code("Code", "text", `JavaScript   new Date(${ms})                         // ms!  Date.now() / 1000 for seconds\nPython       datetime.fromtimestamp(${sec}, tz=timezone.utc)\nDart         DateTime.fromMillisecondsSinceEpoch(${ms}, isUtc: true)\nKotlin       Instant.ofEpochSecond(${sec}L)\nSwift        Date(timeIntervalSince1970: ${sec})\nGo           time.Unix(${sec}, 0).UTC()\nPostgreSQL   SELECT to_timestamp(${sec});\nMySQL        SELECT FROM_UNIXTIME(${sec});\nShell        date -u -r ${sec}   # macOS   ·   date -u -d @${sec}   # Linux`)
      ]
    };
  }
};

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const REGEX_LANGS = opts(["javascript", "JavaScript / TypeScript"], ["python", "Python"], ["dart", "Dart / Flutter"], ["kotlin", "Kotlin / Android"], ["swift", "Swift / iOS"], ["java", "Java"], ["go", "Go"], ["php", "PHP"], ["csharp", "C#"]);

const regexTool: ToolSpec = {
  id: "dev.regex-library",
  command: "regexLibrary",
  title: "Regex Tester, Library & Code",
  summary: "Test any regular expression with matches and capture groups, or start from tested patterns (email, URL, UUID, semver, phone, dates, passwords…) - and copy ready-to-paste code for JavaScript, Python, Dart, Kotlin, Swift, Java, Go, PHP and C#.",
  guide: "Each language escapes and flags regexes differently; the generated code uses raw strings where the language has them so the pattern is copied verbatim. Go's RE2 engine has no lookarounds or backreferences - you get a warning when a pattern uses them.",
  keywords: ["regex", "regular expression", "email regex", "url regex", "uuid regex", "phone regex", "password regex", "pattern", "validation", "regexp"],
  icon: "regex",
  live: true,
  aliases: [{ command: "regexBuilder", values: { preset: "custom", perLine: false } }],
  fields: [
    f.select("preset", "Pattern", [{ value: "custom", label: "Custom pattern" }, ...REGEX_LIBRARY.map(r => ({ value: r.id, label: r.label }))], { default: "email", width: "wide" }),
    f.text("pattern", "Pattern", { default: "^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})$", showIf: { field: "preset", equals: ["custom"] } }),
    f.text("flags", "Flags", { width: "narrow", default: "", placeholder: "g i m s u", showIf: { field: "preset", equals: ["custom"] } }),
    f.area("samples", "Test input (one per line)", { rows: 5, fromEditor: true, placeholder: "Leave empty to use the pattern's examples" }),
    f.toggle("perLine", "Test each line separately", true),
    f.select("language", "Code for", REGEX_LANGS)
  ],
  run(values) {
    const preset = REGEX_LIBRARY.find(r => r.id === str(values, "preset", "email"));
    const pattern = preset ? preset.pattern : str(values, "pattern");
    const flags = preset ? preset.flags : str(values, "flags").replace(/\s/g, "");
    const re = validateRegex(pattern, flags);
    const samples = str(values, "samples") || preset?.samples || "";
    const perLine = bool(values, "perLine", true);
    const rows = samples ? testRegex(re, samples, perLine) : [];
    const lang = str(values, "language", "javascript") as RegexLang;
    const generated = regexCode(pattern, flags, lang);
    const messages: NonNullable<ToolResult["messages"]> = [];
    if (preset?.note) messages.push({ kind: "info", text: preset.note });
    if (generated.note) messages.push({ kind: "warning", text: generated.note });
    if (/(\([^)]*[+*][^)]*\))[+*]/.test(pattern)) messages.push({ kind: "warning", text: "Nested quantifiers like (a+)+ can backtrack catastrophically (ReDoS) on crafted input. Keep user-supplied input short or rewrite the pattern." });
    const matched = perLine ? rows.filter(r => r[2] === "✓").length : rows.length;
    return {
      stats: [{ label: "Pattern", value: `/${pattern.length > 40 ? pattern.slice(0, 40) + "…" : pattern}/${flags}` }, { label: perLine ? "Lines matching" : "Matches", value: perLine ? `${matched} of ${rows.length}` : String(matched), tone: matched ? "good" : "warn" }],
      messages,
      outputs: [
        ...(rows.length ? [perLine ? table("Results", ["Line", "Input", "Match", "Groups"], rows) : table("Matches", ["#", "Match", "Index", "Groups"], rows)] : []),
        code(REGEX_LANGS.find(o => o.value === lang)?.label ?? lang, lang === "csharp" ? "text" : lang, generated.code),
        code("Pattern", "text", pattern)
      ]
    };
  }
};

export const DEV_TOOLS: ToolSpec[] = [encodeTool, jwtTool, hashTool, idTool, timestampTool, cronTool, regexTool, diffTool, textTool];
