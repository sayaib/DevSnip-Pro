import { randomBytes, randomUUID } from "crypto";
import { ToolInputError } from "../types";

/**
 * Everyday developer utilities: encoding, identifiers, text/case helpers and
 * cron expressions. Pure functions; randomness comes from node:crypto.
 */

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

export type Codec = "base64" | "base64url" | "url-component" | "url" | "html" | "hex" | "unicode" | "json-string";

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", euro: "€" };

export function encode(text: string, codec: Codec): string {
  switch (codec) {
    case "base64": return Buffer.from(text, "utf8").toString("base64");
    case "base64url": return Buffer.from(text, "utf8").toString("base64url");
    case "url-component": return encodeURIComponent(text);
    case "url": return encodeURI(text);
    case "html": return text.replace(/[&<>"']/g, c => HTML_ENTITIES[c]);
    case "hex": return Buffer.from(text, "utf8").toString("hex");
    case "unicode": return [...text].map(ch => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80) return ch;
      return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, "0")}`;
    }).join("");
    case "json-string": return JSON.stringify(text);
  }
}

export function decode(text: string, codec: Codec): string {
  const input = text.trim();
  switch (codec) {
    case "base64":
    case "base64url": {
      const clean = input.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new ToolInputError("This is not Base64: only A-Z, a-z, 0-9, +, /, - and _ are allowed (with up to two = at the end).");
      const buffer = Buffer.from(clean.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const decoded = buffer.toString("utf8");
      if (decoded.includes("�")) throw new ToolInputError(`The Base64 decodes to ${buffer.length} bytes of binary data, not UTF-8 text. Hex: ${buffer.subarray(0, 48).toString("hex")}${buffer.length > 48 ? "…" : ""}`);
      return decoded;
    }
    case "url-component":
    case "url":
      try { return codec === "url" ? decodeURI(input) : decodeURIComponent(input.replace(/\+/g, " ")); } catch { throw new ToolInputError("Malformed percent-encoding: every % must be followed by two hex digits."); }
    case "html":
      return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
        if (entity[0] === "#") {
          const cp = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
          return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
        }
        return NAMED[entity.toLowerCase()] ?? whole;
      });
    case "hex": {
      const clean = input.replace(/^0x/i, "").replace(/[\s:]/g, "");
      if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new ToolInputError("Hex input needs an even number of 0-9 / a-f digits.");
      return Buffer.from(clean, "hex").toString("utf8");
    }
    case "unicode":
      return text.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_w, a, b, c) => String.fromCodePoint(parseInt(a || b || c, 16)));
    case "json-string": {
      const t = input.startsWith('"') ? input : JSON.stringify(input).replace(/\\\\/g, "\\");
      try { const v = JSON.parse(t); if (typeof v !== "string") throw new Error(); return v; } catch { throw new ToolInputError("Not a valid JSON string literal (it must be wrapped in double quotes with escaped content)."); }
    }
  }
}

/** Guesses how a string is encoded, most specific first. */
export function detectCodec(text: string): Codec | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return "json-string";
  if (/%[0-9a-f]{2}/i.test(t) && !/\s/.test(t)) return "url-component";
  if (/&(#x?[0-9a-f]+|[a-z]+);/i.test(t)) return "html";
  if (/\\u[0-9a-f]{4}|\\u\{/i.test(t)) return "unicode";
  if (/^(0x)?([0-9a-f]{2})+$/i.test(t) && t.length >= 8 && !/^[0-9]+$/.test(t)) return "hex";
  if (t.length >= 8 && /^[A-Za-z0-9+/]+={0,2}$/.test(t) && t.length % 4 === 0) return "base64";
  if (t.length >= 8 && /^[A-Za-z0-9_-]+$/.test(t) && /[_-]/.test(t)) return "base64url";
  return undefined;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const NANO_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export type IdKind = "uuid4" | "uuid7" | "ulid" | "nanoid" | "objectid" | "hex" | "password";

export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & BigInt(0xff));
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ulid(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const random = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[random[i] % 32];
  return time + rand;
}

function randomString(alphabet: string, length: number): string {
  // Rejection sampling: no modulo bias for alphabets that do not divide 256.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function generateIds(kind: IdKind, count: number, options: { length: number; uppercase: boolean; symbols: boolean }): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let id: string;
    switch (kind) {
      case "uuid4": id = randomUUID(); break;
      case "uuid7": id = uuidv7(Date.now()); break;
      case "ulid": id = ulid(Date.now()); break;
      case "nanoid": id = randomString(NANO_ALPHABET, options.length); break;
      case "hex": id = randomBytes(Math.ceil(options.length / 2)).toString("hex").slice(0, options.length); break;
      case "objectid": {
        // MongoDB ObjectId: 4-byte seconds timestamp, 5 random bytes, 3-byte counter.
        const time = Buffer.alloc(4);
        time.writeUInt32BE(Math.floor(Date.now() / 1000));
        id = Buffer.concat([time, randomBytes(5), Buffer.from([(i >> 16) & 255, (i >> 8) & 255, i & 255])]).toString("hex");
        break;
      }
      case "password": {
        const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", ...(options.symbols ? ["!@#$%^&*()-_=+[]{}"] : [])];
        const all = sets.join("");
        // One character from every set, then shuffle, so every class is present.
        const chars = [...sets.map(s => randomString(s, 1)), ...randomString(all, Math.max(0, options.length - sets.length))];
        for (let j = chars.length - 1; j > 0; j--) { const k = randomBytes(1)[0] % (j + 1); [chars[j], chars[k]] = [chars[k], chars[j]]; }
        id = chars.join("").slice(0, options.length);
        break;
      }
    }
    out.push(options.uppercase && kind !== "password" && kind !== "nanoid" ? id.toUpperCase() : id);
  }
  return out;
}

/** Decodes the timestamp embedded in a UUID v7, UUID v1 or ULID. */
export function inspectId(value: string): Array<[string, string]> | undefined {
  const v = value.trim();
  const uuid = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f])([0-9a-f]{3})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(v);
  if (uuid) {
    const version = parseInt(uuid[3], 16);
    const rows: Array<[string, string]> = [["Type", `UUID version ${version}`]];
    if (version === 7) rows.push(["Created", new Date(parseInt(uuid[1] + uuid[2], 16)).toISOString()]);
    if (version === 1) {
      const ts = (BigInt("0x" + uuid[4] + uuid[2] + uuid[1]) - BigInt("122192928000000000")) / BigInt(10000);
      rows.push(["Created", new Date(Number(ts)).toISOString()]);
    }
    return rows;
  }
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(v)) {
    const ms = [...v.slice(0, 10).toUpperCase()].reduce((acc, ch) => acc * 32 + CROCKFORD.indexOf(ch), 0);
    return [["Type", "ULID"], ["Created", new Date(ms).toISOString()]];
  }
  if (/^[0-9a-f]{24}$/i.test(v)) {
    const seconds = parseInt(v.slice(0, 8), 16);
    return [["Type", "MongoDB ObjectId"], ["Created", new Date(seconds * 1000).toISOString()], ["Random", v.slice(8, 18)], ["Counter", String(parseInt(v.slice(18), 16))]];
  }
  if (/^\d{17,19}$/.test(v)) {
    // Twitter/X and Discord snowflakes: milliseconds since their epochs in the top 42 bits.
    const n = BigInt(v);
    const ms = Number(n >> BigInt(22));
    return [["Type", "Snowflake ID"], ["Created (X/Twitter epoch)", new Date(ms + 1288834974657).toISOString()], ["Created (Discord epoch)", new Date(ms + 1420070400000).toISOString()]];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Text & case
// ---------------------------------------------------------------------------

/** Splits identifiers and phrases into words: "getHTTPResponse_v2" → get, HTTP, Response, v2. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9À-ɏ]+/)
    .filter(Boolean);
}

export const CASES: Array<{ id: string; label: string; convert: (w: string[]) => string }> = [
  { id: "camel", label: "camelCase", convert: w => w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join("") },
  { id: "pascal", label: "PascalCase", convert: w => w.map(cap).join("") },
  { id: "snake", label: "snake_case", convert: w => w.map(x => x.toLowerCase()).join("_") },
  { id: "constant", label: "CONSTANT_CASE", convert: w => w.map(x => x.toUpperCase()).join("_") },
  { id: "kebab", label: "kebab-case", convert: w => w.map(x => x.toLowerCase()).join("-") },
  { id: "dot", label: "dot.case", convert: w => w.map(x => x.toLowerCase()).join(".") },
  { id: "title", label: "Title Case", convert: w => w.map(cap).join(" ") },
  { id: "sentence", label: "Sentence case", convert: w => w.map((x, i) => (i ? x.toLowerCase() : cap(x))).join(" ") },
  { id: "lower", label: "lower case", convert: w => w.map(x => x.toLowerCase()).join(" ") },
  { id: "upper", label: "UPPER CASE", convert: w => w.map(x => x.toUpperCase()).join(" ") }
];

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function slugify(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type LineOp = "sort" | "sort-desc" | "sort-natural" | "unique" | "reverse" | "trim" | "remove-empty" | "shuffle" | "number";

export function transformLines(text: string, ops: LineOp[]): string {
  let lines = text.replace(/\r\n/g, "\n").split("\n");
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const op of ops) {
    switch (op) {
      case "trim": lines = lines.map(l => l.trim()); break;
      case "remove-empty": lines = lines.filter(l => l.trim()); break;
      case "unique": lines = [...new Set(lines)]; break;
      case "sort": lines = lines.slice().sort(); break;
      case "sort-desc": lines = lines.slice().sort().reverse(); break;
      case "sort-natural": lines = lines.slice().sort(collator.compare); break;
      case "reverse": lines = lines.slice().reverse(); break;
      case "shuffle": for (let i = lines.length - 1; i > 0; i--) { const j = randomBytes(4).readUInt32BE(0) % (i + 1); [lines[i], lines[j]] = [lines[j], lines[i]]; } break;
      case "number": { const width = String(lines.length).length; lines = lines.map((l, i) => `${String(i + 1).padStart(width, " ")}  ${l}`); break; }
    }
  }
  return lines.join("\n");
}

export function textStats(text: string): Array<[string, string]> {
  const lines = text ? text.split(/\r?\n/) : [];
  const wordCount = (text.match(/\S+/g) || []).length;
  const bytes = Buffer.byteLength(text, "utf8");
  return [
    ["Characters", String([...text].length)],
    ["Characters (no spaces)", String([...text.replace(/\s/g, "")].length)],
    ["Words", String(wordCount)],
    ["Lines", String(lines.length)],
    ["Non-empty lines", String(lines.filter(l => l.trim()).length)],
    ["UTF-8 bytes", String(bytes)],
    ["Reading time", `${Math.max(1, Math.round(wordCount / 230))} min`]
  ];
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *"
};

interface CronField { values: Set<number>; any: boolean; raw: string }
export interface CronSchedule { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField; expression: string }

function parseField(raw: string, min: number, max: number, name: string, names?: string[]): CronField {
  const values = new Set<number>();
  const any = raw === "*" || raw === "?";
  for (const part of raw.split(",")) {
    const m = /^(\*|\?|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new ToolInputError(`Cannot read "${part}" in the ${name} field.`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new ToolInputError(`The step in "${part}" must be at least 1.`);
    const toNum = (token: string): number => {
      const upper = token.toUpperCase();
      const idx = names ? names.indexOf(upper) : -1;
      const n = idx >= 0 ? idx + (name === "month" ? 1 : 0) : Number(token);
      if (!Number.isInteger(n)) throw new ToolInputError(`"${token}" is not valid in the ${name} field.`);
      const value = name === "day of week" && n === 7 ? 0 : n;
      if (value < min || value > max) throw new ToolInputError(`${token} is outside ${min}-${max} in the ${name} field.`);
      return value;
    };
    let from: number;
    let to: number;
    if (m[1] === "*" || m[1] === "?") { from = min; to = max; }
    else if (m[1].includes("-")) {
      const [a, b] = m[1].split("-");
      from = toNum(a);
      to = name === "day of week" && b === "7" ? 6 : toNum(b);
      if (to < from) throw new ToolInputError(`Range "${m[1]}" in the ${name} field runs backwards.`);
    } else { from = toNum(m[1]); to = m[2] ? max : from; }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { values, any, raw };
}

export function parseCron(expression: string): CronSchedule {
  const trimmed = expression.trim();
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  if (trimmed.toLowerCase() === "@reboot") throw new ToolInputError("@reboot runs once at startup; it has no schedule to explain.");
  const parts = expanded.split(/\s+/);
  if (parts.length === 6) throw new ToolInputError("This has 6 fields. Standard cron (crontab, Kubernetes CronJob, GitHub Actions) uses 5: minute hour day-of-month month day-of-week. Drop the seconds field, or the year field if it is Quartz syntax.");
  if (parts.length !== 5) throw new ToolInputError(`Expected 5 fields (minute hour day-of-month month day-of-week), found ${parts.length}.`);
  return {
    minute: parseField(parts[0], 0, 59, "minute"),
    hour: parseField(parts[1], 0, 23, "hour"),
    dom: parseField(parts[2], 1, 31, "day of month"),
    month: parseField(parts[3], 1, 12, "month", MONTH_NAMES),
    dow: parseField(parts[4], 0, 6, "day of week", DAY_NAMES),
    expression: expanded
  };
}

function dayMatches(s: CronSchedule, date: { dom: number; month: number; dow: number }): boolean {
  if (!s.month.values.has(date.month)) return false;
  // Vixie cron: when both day fields are restricted, a day matches either one.
  if (!s.dom.any && !s.dow.any) return s.dom.values.has(date.dom) || s.dow.values.has(date.dow);
  return s.dom.values.has(date.dom) && s.dow.values.has(date.dow);
}

/** Next run times after `from`, in UTC or the local zone of the process. */
export function nextRuns(s: CronSchedule, from: Date, count: number, utc: boolean): Date[] {
  const out: Date[] = [];
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  d.setTime(d.getTime() + 60_000);
  const get = (unit: "min" | "hour" | "dom" | "month" | "dow") => {
    switch (unit) {
      case "min": return utc ? d.getUTCMinutes() : d.getMinutes();
      case "hour": return utc ? d.getUTCHours() : d.getHours();
      case "dom": return utc ? d.getUTCDate() : d.getDate();
      case "month": return (utc ? d.getUTCMonth() : d.getMonth()) + 1;
      case "dow": return utc ? d.getUTCDay() : d.getDay();
    }
  };
  // Jump by days / hours / minutes; a 10-year horizon covers several Feb 29s.
  const limit = from.getTime() + 10 * 366 * 86_400_000;
  while (out.length < count && d.getTime() < limit) {
    if (!dayMatches(s, { dom: get("dom"), month: get("month"), dow: get("dow") })) {
      if (utc) d.setUTCHours(24, 0, 0, 0); else d.setHours(24, 0, 0, 0);
      continue;
    }
    if (!s.hour.values.has(get("hour"))) {
      if (utc) d.setUTCMinutes(60, 0, 0); else d.setMinutes(60, 0, 0);
      continue;
    }
    if (!s.minute.values.has(get("min"))) { d.setTime(d.getTime() + 60_000); continue; }
    out.push(new Date(d.getTime()));
    d.setTime(d.getTime() + 60_000);
  }
  return out;
}

function listText(values: number[], label: (n: number) => string): string {
  // Runs of three or more consecutive values read better as a range.
  const items: string[] = [];
  for (let i = 0; i < values.length;) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    if (j - i >= 2) { items.push(`${label(values[i])} through ${label(values[j])}`); i = j + 1; }
    else { items.push(label(values[i])); i++; }
  }
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function stepOf(field: CronField): number | undefined {
  return /^\*\/(\d+)$/.exec(field.raw)?.[1] ? Number(/^\*\/(\d+)$/.exec(field.raw)![1]) : undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function describeCron(s: CronSchedule): string {
  const minutes = [...s.minute.values].sort((a, b) => a - b);
  const hours = [...s.hour.values].sort((a, b) => a - b);
  let time: string;
  if (s.minute.any && s.hour.any) time = "Every minute";
  else if (stepOf(s.minute) && s.hour.any) time = `Every ${stepOf(s.minute)} minutes`;
  else if (s.hour.any) time = `At minute ${listText(minutes, String)} of every hour`;
  else if (stepOf(s.minute) && hours.every((h, i) => !i || h === hours[i - 1] + 1)) time = `Every ${stepOf(s.minute)} minutes from ${pad(hours[0])}:00 through ${pad(hours[hours.length - 1])}:59`;
  else if (s.minute.any) time = `Every minute during ${listText(hours, h => `${pad(h)}:00-${pad(h)}:59`)}`;
  else if (stepOf(s.hour) && minutes.length === 1) time = `At minute ${minutes[0]} past every ${stepOf(s.hour)} hours`;
  else if (minutes.length * hours.length <= 6) time = `At ${listText(hours.flatMap(h => minutes.map(m => h * 60 + m)), t => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`)}`;
  else if (minutes.length === 1 && hours.length > 2 && hours.every((h, i) => !i || h === hours[i - 1] + 1)) time = `${minutes[0] ? `At minute ${minutes[0]} of` : "At the start of"} every hour from ${pad(hours[0])}:00 through ${pad(hours[hours.length - 1])}:00`;
  else if (minutes.length * hours.length <= 12) time = `At ${listText(hours.flatMap(h => minutes.map(m => h * 60 + m)), t => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`).replace(/ through /g, ", ")}`;
  else time = `At minute ${listText(minutes, String)} past hour ${listText(hours, String)}`;
  const parts = [time];
  const domText = s.dom.any ? "" : `on day ${listText([...s.dom.values].sort((a, b) => a - b), String)} of the month`;
  const dowText = s.dow.any ? "" : `on ${listText([...s.dow.values].sort((a, b) => a - b), d => DAY_LABELS[d])}`;
  if (domText && dowText) parts.push(`${domText} or ${dowText}`);
  else if (domText || dowText) parts.push(domText || dowText);
  if (!s.month.any) parts.push(`in ${listText([...s.month.values].sort((a, b) => a - b), m => MONTH_LABELS[m - 1])}`);
  return parts.join(", ") + ".";
}
