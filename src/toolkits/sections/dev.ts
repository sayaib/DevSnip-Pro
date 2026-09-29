import { createHmac, timingSafeEqual } from "crypto";
import { SectionInfo, ToolDefinition, ToolInputError, ToolResult, bool, num, str } from "../types";
import { CASES, Codec, IdKind, LineOp, decode, describeCron, detectCodec, encode, generateIds, inspectId, nextRuns, parseCron, slugify, textStats, transformLines, words } from "../engines/dev-utils";
import { diffLines, diffValues } from "../engines/data-inspect";
import { code, f, opts, table } from "./helpers";

export const DEV_SECTION: SectionInfo = {
  id: "dev",
  title: "Developer Tools",
  icon: "terminal",
  description: "Everyday utilities: encoding, tokens, IDs, diffs, text and schedules.",
  categories: ["Encode & inspect", "Generate", "Compare & transform"]
};

const CODECS = opts(["base64", "Base64"], ["base64url", "Base64URL"], ["url-component", "URL component (query values)"], ["url", "Full URL"], ["html", "HTML entities"], ["hex", "Hex (UTF-8 bytes)"], ["unicode", "Unicode escapes (\\uXXXX)"], ["json-string", "JSON string literal"]);

const encodeTool: ToolDefinition = {
  id: "dev.encode",
  command: "base64Encoder",
  section: "dev",
  category: "Encode & inspect",
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

function b64urlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const jwtTool: ToolDefinition = {
  id: "dev.jwt",
  command: "jwtDecoder",
  section: "dev",
  category: "Encode & inspect",
  title: "JWT Decoder",
  summary: "Decode a JSON Web Token locally: header, claims with readable dates, expiry and security warnings; optionally verify an HMAC signature.",
  guide: "Decoding happens on your machine; the token is never sent anywhere. Only HS256/HS384/HS512 signatures can be verified here (they need the shared secret). RS/ES/PS tokens need the issuer's public key.",
  keywords: ["jwt", "json web token", "bearer", "claims", "exp", "oauth", "id token", "decode token"],
  icon: "key",
  live: true,
  examples: [{ label: "Sample HS256 token (secret: your-256-bit-secret)", values: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", secret: "your-256-bit-secret" } }],
  fields: [
    f.area("token", "Token", { rows: 5, required: true, fromEditor: true, placeholder: "eyJhbGciOi... (a leading \"Bearer \" is fine)" }),
    f.secret("secret", "HMAC secret (optional)", { placeholder: "Verify HS256/HS384/HS512 signature" })
  ],
  async run(values, ctx) {
    const token = str(values, "token").trim().replace(/^Bearer\s+/i, "");
    if (!token) throw new ToolInputError("Paste a JWT.");
    const { inspectJwt } = await import("../../services/dev-operations");
    const r = inspectJwt(token);
    if (!r.valid || !r.header || !r.payload) throw new ToolInputError(r.error ?? "This is not a valid JWT.");
    const now = (ctx.now?.() ?? new Date()).getTime();
    const claims = Object.entries(r.payload).map(([k, v]) => {
      const isTime = ["exp", "iat", "nbf", "auth_time", "updated_at"].includes(k) && typeof v === "number";
      const detail = isTime ? `${new Date((v as number) * 1000).toISOString()} (${relative((v as number) * 1000 - now)})` : "";
      return [k, typeof v === "object" ? JSON.stringify(v) : String(v), detail];
    });
    const stats: NonNullable<ToolResult["stats"]> = [
      { label: "Algorithm", value: String(r.header.alg ?? "?"), tone: String(r.header.alg).toLowerCase() === "none" ? "bad" : "neutral" },
      { label: "Status", value: r.expired ? "expired" : r.expiresAt ? "not expired" : "no expiry", tone: r.expired ? "bad" : r.expiresAt ? "good" : "warn" }
    ];
    const messages: NonNullable<ToolResult["messages"]> = r.warnings.map(w => ({ kind: "warning" as const, text: w }));
    const secret = str(values, "secret");
    const alg = String(r.header.alg ?? "");
    if (secret) {
      const parts = token.split(".");
      const hash = ({ HS256: "sha256", HS384: "sha384", HS512: "sha512" } as Record<string, string>)[alg];
      if (!hash) messages.push({ kind: "info", text: `${alg} signatures need a public key, not a shared secret; they cannot be verified here.` });
      else if (parts.length < 3 || !parts[2]) messages.push({ kind: "error", text: "The token has no signature part." });
      else {
        const expected = createHmac(hash, secret).update(`${parts[0]}.${parts[1]}`).digest();
        const actual = b64urlDecode(parts[2]);
        const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
        stats.push({ label: "Signature", value: ok ? "valid" : "INVALID", tone: ok ? "good" : "bad" });
        messages.unshift(ok ? { kind: "success", text: "The signature matches this secret." } : { kind: "error", text: "The signature does not match this secret: the token was altered or signed with a different key." });
      }
    } else {
      messages.push({ kind: "info", text: "The signature was not verified. Decoding a token does not prove it is genuine." });
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

function relative(ms: number): string {
  const abs = Math.abs(ms);
  const unit = abs >= 86_400_000 ? [86_400_000, "day"] : abs >= 3_600_000 ? [3_600_000, "hour"] : abs >= 60_000 ? [60_000, "minute"] : [1000, "second"];
  const n = Math.round(abs / (unit[0] as number));
  return ms >= 0 ? `in ${n} ${unit[1]}${n === 1 ? "" : "s"}` : `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

const idTool: ToolDefinition = {
  id: "dev.ids",
  command: "idGenerator",
  section: "dev",
  category: "Generate",
  title: "UUID & ID Generator",
  summary: "Generate UUID v4/v7, ULID, Nano ID, random hex or strong passwords in bulk; paste an ID to see when it was created.",
  guide: "UUID v7 and ULID start with a timestamp, so they sort by creation time and index well as database keys. Everything is generated locally with a cryptographic random source.",
  keywords: ["uuid", "guid", "ulid", "nanoid", "random", "password", "token", "secret"],
  icon: "fingerprint",
  fields: [
    f.select("kind", "Type", opts(["uuid4", "UUID v4 (random)"], ["uuid7", "UUID v7 (time-ordered)"], ["ulid", "ULID"], ["nanoid", "Nano ID"], ["hex", "Random hex"], ["password", "Password"])),
    f.num("count", "How many", 5, { min: 1, max: 1000 }),
    f.num("length", "Length", 21, { min: 4, max: 256, showIf: { field: "kind", equals: ["nanoid", "hex", "password"] } }),
    f.toggle("uppercase", "Uppercase", false, { showIf: { field: "kind", equals: ["uuid4", "uuid7", "ulid", "hex"] } }),
    f.toggle("symbols", "Include symbols", true, { showIf: { field: "kind", equals: ["password"] } }),
    f.text("inspect", "Inspect an ID (optional)", { placeholder: "Paste a UUID or ULID to decode its timestamp" })
  ],
  run(values) {
    const inspect = str(values, "inspect").trim();
    const outputs: NonNullable<ToolResult["outputs"]> = [];
    const messages: NonNullable<ToolResult["messages"]> = [];
    if (inspect) {
      const rows = inspectId(inspect);
      if (rows) outputs.push(table("Inspected ID", ["Field", "Value"], rows));
      else messages.push({ kind: "warning", text: "That is not a UUID or ULID." });
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

const diffTool: ToolDefinition = {
  id: "dev.diff",
  command: "textDiff",
  section: "dev",
  category: "Compare & transform",
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

const textTool: ToolDefinition = {
  id: "dev.text",
  command: "caseConverter",
  section: "dev",
  category: "Compare & transform",
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

const cronTool: ToolDefinition = {
  id: "dev.cron",
  command: "cronHelper",
  section: "dev",
  category: "Generate",
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

export const DEV_TOOLS: ToolDefinition[] = [encodeTool, jwtTool, idTool, cronTool, diffTool, textTool];
