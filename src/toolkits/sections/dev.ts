import { GeneratedFile, Output, ToolSpec, ToolInputError, ToolResult, Values, bool, num, str } from "../types";
import { CASES, Codec, IdKind, LineOp, decode, describeCron, detectCodec, encode, generateIds, inspectId, nextRuns, parseCron, slugify, textStats, transformLines, words } from "../engines/dev-utils";
import { diffLines, diffValues } from "../engines/data-inspect";
import { REGEX_LIBRARY, RegexLang, regexCode, testRegex, validateRegex } from "../engines/dev-regex";
import { DetectedProject, KIND_LABELS, PackageManager, ProjectKind, detectProjects } from "../engines/project-detect";
import { EXTENSION_NAMES, mergeExtensions, mergeLaunch, mergeTasks, setupFor } from "../engines/dev-debug";
import { findUnusedDependencies } from "../engines/dev-unused-deps";
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

function relative(ms: number): string {
  const abs = Math.abs(ms);
  const unit = abs >= 86_400_000 ? [86_400_000, "day"] : abs >= 3_600_000 ? [3_600_000, "hour"] : abs >= 60_000 ? [60_000, "minute"] : [1000, "second"];
  const n = Math.round(abs / (unit[0] as number));
  return ms >= 0 ? `in ${n} ${unit[1]}${n === 1 ? "" : "s"}` : `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

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

const DEBUG_STACKS: ProjectKind[] = ["node", "nextjs", "vite", "angular", "nestjs", "react-native", "expo", "fastapi", "django", "flask", "python", "spring-boot", "java", "aspnet", "dotnet", "flutter", "dart"];
const NODE_STACKS = ["node", "nextjs", "vite", "angular", "nestjs", "react-native", "expo"];
const WEB_PORTS: Partial<Record<ProjectKind, number>> = { nextjs: 3000, vite: 5173, angular: 4200, nestjs: 3000, node: 3000, fastapi: 8000, django: 8000, flask: 5000, "spring-boot": 8080, aspnet: 5000 };

const debugConfigTool: ToolSpec = {
  id: "dev.debug-config",
  command: "debugConfigGenerator",
  title: "Run & Debug Configurations",
  summary: "Detect the projects in your workspace and get .vscode/launch.json, tasks.json and recommended extensions for debugging them, plus their run, test and build commands.",
  guide: "Detect from workspace reads package.json, pyproject.toml / requirements.txt / manage.py, pom.xml / build.gradle, *.csproj and pubspec.yaml at the root and up to two folders down. Configurations use each language's official debugger: js-debug for Node, Next.js and Chrome, debugpy for Python, the Java debugger for Spring Boot, coreclr for .NET, Dart-Code for Flutter and React Native Tools for React Native and Expo. An existing launch.json is kept: only configurations with new names are added.",
  keywords: ["launch.json", "debug", "debugger", "tasks.json", "breakpoint", "attach", "debugpy", "spring boot debug", "coreclr", "asp.net core", "flutter debug", "next.js debug", "react native debug", "run configuration"],
  icon: "target",
  actions: [{ id: "detect", label: "Detect from workspace" }],
  fields: [
    f.select("stack", "Project type", DEBUG_STACKS.map(kind => ({ value: kind, label: KIND_LABELS[kind] }))),
    f.text("folder", "Folder", { width: "narrow", placeholder: "(workspace root)", help: "Sub-folder of the project, e.g. backend or apps/web." }),
    f.num("port", "Port", 3000, { min: 1, max: 65535, showIf: { field: "stack", equals: ["nextjs", "vite", "angular", "fastapi", "flask", "aspnet"] } }),
    f.select("packageManager", "Package manager", opts("npm", "pnpm", "yarn", "bun"), { showIf: { field: "stack", equals: NODE_STACKS } }),
    f.select("testRunner", "Tests", opts(["none", "None"], ["vitest", "Vitest"], ["jest", "Jest"]), { showIf: { field: "stack", equals: NODE_STACKS } }),
    f.text("entry", "Entry file", { width: "narrow", default: "src/index.js", showIf: { field: "stack", equals: ["node", "python", "dart"] } }),
    f.text("appModule", "App", { width: "narrow", default: "main:app", help: "FastAPI: module:variable. Flask: the app file.", showIf: { field: "stack", equals: ["fastapi", "flask"] } }),
    f.toggle("pytest", "pytest", true, { showIf: { field: "stack", equals: ["fastapi", "django", "flask", "python"] } }),
    f.text("mainClass", "Main class", { width: "narrow", default: "com.example.demo.DemoApplication", showIf: { field: "stack", equals: ["spring-boot", "java"] } }),
    f.select("buildTool", "Build tool", opts(["maven", "Maven (./mvnw)"], ["gradle", "Gradle (./gradlew)"]), { showIf: { field: "stack", equals: ["spring-boot", "java"] } }),
    f.text("projectName", "Project name", { width: "narrow", default: "demo", help: "Maven artifactId or Gradle rootProject.name; .NET: the .csproj name.", showIf: { field: "stack", equals: ["spring-boot", "java", "aspnet", "dotnet"] } }),
    f.text("targetFramework", "Target framework", { width: "narrow", default: "net8.0", showIf: { field: "stack", equals: ["aspnet", "dotnet"] } })
  ],
  examples: [
    { label: "Spring Boot (Maven)", values: { stack: "spring-boot", mainClass: "com.example.orders.OrdersApplication", projectName: "orders", buildTool: "maven" } },
    { label: "ASP.NET Core Web API in api/", values: { stack: "aspnet", folder: "api", projectName: "Shop.Api", targetFramework: "net8.0", port: 5080 } },
    { label: "FastAPI with pytest", values: { stack: "fastapi", appModule: "app.main:app", port: 8000, pytest: true } }
  ],
  async run(values, ctx, action) {
    let projects: DetectedProject[];
    let setValues: Values | undefined;
    if (action === "detect") {
      if (!ctx.workspace) throw new ToolInputError("Open a folder to detect its projects, or choose the project type yourself.");
      projects = await detectProjects(ctx.workspace);
      if (!projects.length) throw new ToolInputError("No supported project was found (looked for package.json, pyproject.toml, requirements.txt, manage.py, pom.xml, build.gradle, *.csproj and pubspec.yaml up to two folders deep). Choose the project type yourself.");
      setValues = formValues(projects.find(p => DEBUG_STACKS.includes(p.kind) && !p.isTest) ?? projects[0]);
    } else {
      projects = [projectFromForm(values)];
    }
    const setups = projects.map(p => setupFor(p, projects.length > 1));
    const configurations = setups.flatMap(s => s.configurations);
    const tasks = setups.flatMap(s => s.tasks);
    const extensions = setups.flatMap(s => s.extensions);
    const read = (file: string) => ctx.workspace?.readFile(file) ?? Promise.resolve(undefined);
    const messages: NonNullable<ToolResult["messages"]> = [];
    const files: GeneratedFile[] = [];
    if (configurations.length) {
      const launch = mergeLaunch(await read(".vscode/launch.json"), configurations);
      files.push({ path: ".vscode/launch.json", language: "json", content: launch.content });
      if (launch.kept) messages.push({ kind: "info", text: `Your launch.json keeps its ${launch.kept} configuration${launch.kept === 1 ? "" : "s"}; ${launch.added.length} new one${launch.added.length === 1 ? " is" : "s are"} added.` });
      if (launch.warning) messages.push({ kind: "warning", text: launch.warning });
    }
    if (tasks.length) {
      const merged = mergeTasks(await read(".vscode/tasks.json"), tasks);
      files.push({ path: ".vscode/tasks.json", language: "json", content: merged.content });
      if (merged.warning) messages.push({ kind: "warning", text: merged.warning });
    }
    if (extensions.length) {
      const merged = mergeExtensions(await read(".vscode/extensions.json"), extensions);
      files.push({ path: ".vscode/extensions.json", language: "json", content: merged.content });
      if (merged.added.length) messages.push({ kind: "info", text: `Debugging needs: ${merged.added.map(id => EXTENSION_NAMES[id] ?? id).join(", ")}. VS Code offers to install them from extensions.json.` });
    }
    for (const note of setups.flatMap(s => s.notes)) messages.push({ kind: "info", text: note });
    const commands = projects.flatMap((p, i) => setups[i].commands.map(([what, command]) => [p.dir || "(root)", KIND_LABELS[p.kind], what, command]));
    const outputs: Output[] = [];
    if (files.length) outputs.push({ kind: "files", title: "VS Code files", files });
    if (action === "detect") outputs.push(table("Detected projects", ["Folder", "Type", "Language", "Found from"], projects.map(p => [p.dir || "(root)", p.framework, p.language, p.evidence.join("; ")])));
    if (commands.length) outputs.push(table("Run, test and build", ["Folder", "Project", "Task", "Command"], commands));
    return {
      setValues,
      stats: [{ label: "Projects", value: String(projects.length) }, { label: "Configurations", value: String(configurations.length) }, ...(tasks.length ? [{ label: "Tasks", value: String(tasks.length) }] : [])],
      messages,
      outputs
    };
  }
};

function projectFromForm(values: Values): DetectedProject {
  const kind = str(values, "stack", "node") as ProjectKind;
  if (!DEBUG_STACKS.includes(kind)) throw new ToolInputError("Choose a project type.");
  const dir = str(values, "folder").trim().replace(/^\.?\/+|\/+$/g, "");
  if (dir.split("/").includes("..")) throw new ToolInputError("The folder must be inside the workspace.");
  const name = str(values, "projectName").trim() || dir.split("/").pop() || "app";
  const runner = str(values, "testRunner", "none");
  const python = ["fastapi", "django", "flask", "python"].includes(kind);
  const entry = str(values, "entry").trim();
  return {
    kind, dir, name, language: KIND_LABELS[kind], framework: KIND_LABELS[kind], evidence: [],
    packageManager: str(values, "packageManager", "npm") as PackageManager,
    scripts: NODE_STACKS.includes(kind) ? { dev: "dev", start: "start", ...(runner !== "none" ? { test: runner } : {}) } : undefined,
    testRunner: NODE_STACKS.includes(kind) ? (runner === "none" ? undefined : runner) : python ? (bool(values, "pytest", true) ? "pytest" : undefined) : undefined,
    port: num(values, "port", WEB_PORTS[kind] ?? 3000, { min: 1, max: 65535, integer: true, label: "Port" }),
    entry: kind === "django" ? "manage.py" : kind === "flutter" ? "lib/main.dart" : entry || undefined,
    tsRunner: /\.[cm]?ts$/.test(entry) ? "tsx" : undefined,
    appModule: str(values, "appModule").trim() || (kind === "flask" ? "app.py" : "main:app"),
    mainClass: str(values, "mainClass").trim() || undefined,
    buildTool: str(values, "buildTool", "maven") as "maven" | "gradle",
    wrapper: true,
    csproj: `${name}.csproj`, assemblyName: name, targetFramework: str(values, "targetFramework").trim() || "net8.0"
  };
}

function formValues(p: DetectedProject): Values {
  const v: Values = { stack: p.kind, folder: p.dir };
  if (p.port) v.port = p.port;
  if (p.packageManager) v.packageManager = p.packageManager;
  if (NODE_STACKS.includes(p.kind)) v.testRunner = p.testRunner === "vitest" || p.testRunner === "jest" ? p.testRunner : "none";
  if (p.entry) v.entry = p.entry;
  if (p.appModule) v.appModule = p.appModule;
  if (p.mainClass) v.mainClass = p.mainClass;
  if (p.buildTool) v.buildTool = p.buildTool;
  if (p.kind === "spring-boot" || p.kind === "java" || p.kind === "aspnet" || p.kind === "dotnet") v.projectName = p.kind.startsWith("spring") || p.kind === "java" ? p.name : p.assemblyName ?? p.name;
  if (p.targetFramework) v.targetFramework = p.targetFramework;
  if (p.testRunner === "pytest") v.pytest = true;
  return v;
}

const ECOSYSTEM_LABELS = { npm: "npm", python: "Python", pub: "Dart / Flutter" } as const;

const unusedDepsTool: ToolSpec = {
  id: "dev.unused-deps",
  command: "unusedDependencies",
  title: "Unused Dependencies",
  summary: "Find npm, Python and Dart/Flutter packages your manifests declare but no code, script or config file uses, with the command that removes them.",
  guide: "Reads every package.json, requirements*.txt, pyproject.toml and pubspec.yaml up to three folders down, then the project's source files. npm: a package counts as used when code imports or requires it, a script runs one of its executables, or a config file names it (eslint/babel/prettier plugins by their short names too). Python: when one of its modules is imported, or settings and config name it (Django INSTALLED_APPS, database URLs, Procfile). Dart: when a file imports package:name/. Servers, CLIs, linters, code generators and database drivers that work without an import are never listed. Nothing is removed for you: review the list, then run the command.",
  keywords: ["unused dependencies", "depcheck", "remove dependency", "npm uninstall", "redundant packages", "pip", "requirements.txt", "pubspec", "flutter pub remove", "bundle size", "cleanup"],
  icon: "scissors",
  fields: [
    f.text("folder", "Folder", { width: "narrow", placeholder: "(whole workspace)", help: "Limit the scan to a sub-folder, e.g. apps/web." }),
    f.toggle("includeDev", "Include dev dependencies", true)
  ],
  async run(values, ctx) {
    if (!ctx.workspace) throw new ToolInputError("Open a folder first: this tool reads the workspace's manifests and source files.");
    const folder = str(values, "folder").trim();
    if (folder.split("/").includes("..")) throw new ToolInputError("The folder must be inside the workspace.");
    const scans = await findUnusedDependencies(ctx.workspace, { folder, includeDev: bool(values, "includeDev", true) });
    if (!scans.length) throw new ToolInputError("No package.json, requirements*.txt, pyproject.toml or pubspec.yaml with dependencies was found" + (folder ? ` under ${folder}.` : "."));
    const unused = scans.flatMap(scan => scan.unused.map(u => [scan.dir || "(root)", ECOSYSTEM_LABELS[scan.ecosystem], u.name, u.section, u.reason]));
    const commands = scans.filter(scan => scan.removeCommand).map(scan => `${scan.dir ? `cd ${scan.dir} && ` : ""}${scan.removeCommand}`);
    const messages: NonNullable<ToolResult["messages"]> = scans.flatMap(scan => scan.notes.map(text => ({ kind: "info" as const, text: `${scan.dir || "(root)"}: ${text}` })));
    messages.unshift(unused.length
      ? { kind: "warning", text: "Review before removing: a package can also be loaded dynamically (a computed import or require), by a framework plugin, or from a file outside these folders. Run your build and tests after removing." }
      : { kind: "success", text: "Every declared dependency is used." });
    const outputs: Output[] = [];
    if (unused.length) outputs.push(table("Possibly unused", ["Folder", "Ecosystem", "Package", "Declared in", "Why"], unused));
    if (commands.length) outputs.push(code("Remove them", "shellscript", commands.join("\n")));
    outputs.push(table("Projects scanned", ["Folder", "Ecosystem", "Manifest", "Dependencies", "Source files", "Possibly unused"], scans.map(scan => [scan.dir || "(root)", ECOSYSTEM_LABELS[scan.ecosystem], scan.manifest, scan.checked, scan.sourceFiles, scan.unused.length])));
    return {
      stats: [
        { label: "Projects", value: String(scans.length) },
        { label: "Dependencies checked", value: String(scans.reduce((sum, scan) => sum + scan.checked, 0)) },
        { label: "Possibly unused", value: String(unused.length), tone: unused.length ? "warn" : "good" }
      ],
      messages,
      outputs
    };
  }
};

export const DEV_TOOLS: ToolSpec[] = [encodeTool, idTool, timestampTool, cronTool, regexTool, diffTool, textTool, debugConfigTool, unusedDepsTool];
