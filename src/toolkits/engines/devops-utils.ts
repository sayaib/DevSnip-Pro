import YAML from "yaml";
import { ToolContext, ToolInputError } from "../types";

/**
 * Everyday utilities: .env files, YAML/JSON validation and conversion,
 * networking (ports, CIDR, URLs) and log analysis/formatting.
 */

// ---------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------

export interface EnvEntry { key: string; value: string; line: number; quoted: boolean }
export interface EnvIssue { severity: "error" | "warning" | "info"; line: number; message: string }

const SECRET_KEY = /(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|ACCESS_KEY|CLIENT_SECRET|DSN|WEBHOOK)/i;
const SECRET_VALUE = /^(sk-[A-Za-z0-9_-]{20,}|sk-ant-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|eyJ[\w-]+\.[\w-]+\.[\w-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const PLACEHOLDER = /^(|change-?me|changeme|xxx+|your[-_].*|<.*>|\.\.\.|todo|replace[-_]?me|example|placeholder)$/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function parseEnv(text: string): { entries: EnvEntry[]; issues: EnvIssue[] } {
  const entries: EnvEntry[] = [];
  const issues: EnvIssue[] = [];
  const seen = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    raw = raw.replace(/^\s*export\s+/, "");
    const eq = raw.indexOf("=");
    if (eq < 0) { issues.push({ severity: "error", line: lineNo, message: `"${raw.trim().slice(0, 40)}" has no "=" - expected KEY=value.` }); continue; }
    const rawKey = raw.slice(0, eq);
    const key = rawKey.trim();
    if (rawKey !== key || /^\s/.test(raw.slice(eq + 1)) && raw.slice(eq + 1).trim()) issues.push({ severity: "warning", line: lineNo, message: `${key}: spaces around "=" are not supported by every loader (docker --env-file keeps them).` });
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) issues.push({ severity: "error", line: lineNo, message: `"${key}" is not a valid variable name (letters, digits, underscore; not starting with a digit).` });
    else if (key !== key.toUpperCase()) issues.push({ severity: "info", line: lineNo, message: `${key}: environment variables are conventionally UPPER_SNAKE_CASE.` });
    let value = raw.slice(eq + 1).trim();
    let quoted = false;
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      quoted = true;
      let end = value.indexOf(quote, 1);
      // Multi-line quoted values (e.g. private keys) continue on the following lines.
      // A following KEY= line means the quote was simply never closed (unless this is a PEM block).
      while (end < 0 && quote === '"' && i + 1 < lines.length && (value.startsWith('"-----BEGIN') || !/^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(lines[i + 1]))) {
        i++;
        value += "\n" + lines[i];
        end = value.indexOf(quote, 1);
      }
      if (end < 0) {
        issues.push({ severity: "error", line: lineNo, message: `${key}: the quoted value is never closed.` });
        // Keep only the first line so the rest of the file still parses.
        i = lineNo - 1;
        value = raw.slice(eq + 1).trim().slice(1);
      }
      else {
        const rest = value.slice(end + 1).trim();
        if (rest && !rest.startsWith("#")) issues.push({ severity: "warning", line: lineNo, message: `${key}: text after the closing quote is ignored ("${rest.slice(0, 20)}").` });
        value = value.slice(1, end);
      }
    } else {
      const comment = value.search(/\s#/);
      if (comment >= 0) value = value.slice(0, comment).trim();
      if (/\s/.test(value)) issues.push({ severity: "warning", line: lineNo, message: `${key}: the value contains spaces; wrap it in double quotes.` });
    }
    if (seen.has(key)) issues.push({ severity: "warning", line: lineNo, message: `${key} is defined again (first on line ${seen.get(key)}); the later value usually wins.` });
    seen.set(key, lineNo);
    entries.push({ key, value, line: lineNo, quoted });
  }
  return { entries, issues };
}

export function checkEnv(text: string, example?: string): { entries: EnvEntry[]; issues: EnvIssue[]; missing: string[]; extra: string[]; empty: string[] } {
  const { entries, issues } = parseEnv(text);
  const empty = entries.filter(e => e.value === "").map(e => e.key);
  for (const e of entries) {
    if (isSecretKey(e.key) && PLACEHOLDER.test(e.value) && e.value !== "") issues.push({ severity: "warning", line: e.line, message: `${e.key} still has the placeholder "${e.value}".` });
    if (/^(true|false)$/i.test(e.value) && e.value !== e.value.toLowerCase()) issues.push({ severity: "info", line: e.line, message: `${e.key}: boolean "${e.value}" - most parsers only accept lower case.` });
    if (/_URL$|_URI$|_ENDPOINT$/.test(e.key) && e.value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(e.value) && !e.value.includes("${")) issues.push({ severity: "warning", line: e.line, message: `${e.key} does not look like a URL (missing scheme://).` });
    if (/PORT$/.test(e.key) && e.value && !(/^\d+$/.test(e.value) && Number(e.value) > 0 && Number(e.value) < 65536)) issues.push({ severity: "error", line: e.line, message: `${e.key}="${e.value}" is not a valid port.` });
  }
  let missing: string[] = [];
  let extra: string[] = [];
  if (example !== undefined) {
    const expected = new Set(parseEnv(example).entries.map(e => e.key));
    const actual = new Set(entries.map(e => e.key));
    missing = [...expected].filter(k => !actual.has(k));
    extra = [...actual].filter(k => !expected.has(k));
  }
  return { entries, issues, missing, extra, empty };
}

/** A shareable .env.example: secret values removed, structure and comments kept. */
export function envExample(text: string): string {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  const { entries } = parseEnv(text);
  const byLine = new Map(entries.map(e => [e.line, e]));
  let skipUntil = -1;
  lines.forEach((line, index) => {
    if (index <= skipUntil) return;
    const entry = byLine.get(index + 1);
    if (!entry) { out.push(line); return; }
    const extraLines = entry.value.split("\n").length - 1;
    skipUntil = index + extraLines;
    const secret = isSecretKey(entry.key) || SECRET_VALUE.test(entry.value) || extraLines > 0 || looksRandom(entry.value);
    let value = secret ? "" : entry.value.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/, "//$1:CHANGE_ME@");
    if (value && (/\s|#/.test(value) || entry.quoted)) value = JSON.stringify(value);
    out.push(`${entry.key}=${value}`);
  });
  return out.join("\n").replace(/\n*$/, "\n");
}

/** Long strings mixing letters and digits with no separators are probably keys or tokens. */
function looksRandom(value: string): boolean {
  if (value.length < 20 || /[\s/:.@]/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter(r => r.test(value)).length;
  return classes >= 2 && new Set(value).size >= Math.min(16, value.length / 2);
}

export interface EnvUsage { key: string; files: string[] }

/** Finds env vars read by the code (process.env, os.environ, getenv, import.meta.env, System.getenv). */
export async function scanEnvUsage(ctx: ToolContext): Promise<EnvUsage[]> {
  const ws = ctx.workspace;
  if (!ws) throw new ToolInputError("Open a workspace folder to scan the code for environment variables.");
  const files = await ws.findFiles("**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,kt,rb,php,rs,cs}", 3000);
  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/g,
    /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
    /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
    /os\.environ(?:\.get)?\s*[[(]\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
    /os\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
    /os\.Getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    /ENV\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
    /(?:getenv|env)\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
    /Environment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g
  ];
  const IGNORE = new Set(["NODE_ENV", "HOME", "PATH", "PWD", "CI", "USER", "SHELL", "TMPDIR", "TEMP", "TMP"]);
  const usage = new Map<string, Set<string>>();
  for (const file of files) {
    if (/(^|\/)(node_modules|\.venv|venv|dist|build|out|vendor|target|\.git)\//.test(file)) continue;
    const text = await ws.readFile(file);
    if (!text || text.length > 1_000_000) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text))) {
        if (IGNORE.has(m[1])) continue;
        if (!usage.has(m[1])) usage.set(m[1], new Set());
        usage.get(m[1])!.add(file);
      }
    }
  }
  return [...usage.entries()].map(([key, set]) => ({ key, files: [...set].sort() })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Typed, validated config loaders generated from a .env.example. */
export function envSchema(text: string, target: "zod" | "pydantic"): string {
  const { entries } = parseEnv(text);
  if (!entries.length) throw new ToolInputError("No KEY=value lines found.");
  const kind = (e: EnvEntry) => /PORT$/.test(e.key) || /^\d+$/.test(e.value) ? "int" : /^(true|false)$/i.test(e.value) ? "bool" : /_URL$|_URI$/.test(e.key) ? "url" : "string";
  if (target === "zod") {
    const fields = entries.map(e => {
      const k = kind(e);
      let schema = k === "int" ? "z.coerce.number().int()" : k === "bool" ? 'z.enum(["true", "false"]).transform(v => v === "true")' : k === "url" ? "z.string().url()" : "z.string()";
      if (k === "int" && /PORT$/.test(e.key)) schema += ".min(1).max(65535)";
      if (k === "string" && isSecretKey(e.key)) schema += ".min(1)";
      const hasDefault = e.value !== "" && !isSecretKey(e.key);
      if (hasDefault) schema += `.default(${k === "int" ? Number(e.value) : JSON.stringify(k === "bool" ? e.value.toLowerCase() : e.value)})`;
      return `  ${e.key}: ${schema},`;
    });
    return `import { z } from "zod";

const EnvSchema = z.object({
${fields.join("\n")}
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at startup with every problem listed, instead of crashing later.
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(\`  \${issue.path.join(".")}: \${issue.message}\`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof EnvSchema>;
`;
  }
  const fields = entries.map(e => {
    const k = kind(e);
    const type = k === "int" ? "int" : k === "bool" ? "bool" : k === "url" ? "AnyUrl" : isSecretKey(e.key) ? "SecretStr" : "str";
    const name = e.key.toLowerCase();
    const hasDefault = e.value !== "" && !isSecretKey(e.key);
    const def = hasDefault ? ` = ${k === "int" ? Number(e.value) : k === "bool" ? (e.value.toLowerCase() === "true" ? "True" : "False") : JSON.stringify(e.value)}` : "";
    return `    ${name}: ${type}${def}`;
  });
  return `# pip install pydantic-settings
from pydantic import AnyUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Loaded from the environment (and .env). Invalid values fail at startup."""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

${fields.join("\n")}


settings = Settings()
`;
}

// ---------------------------------------------------------------------------
// YAML / JSON
// ---------------------------------------------------------------------------

export interface StructuredIssue { severity: "error" | "warning" | "info"; message: string; line?: number }

export function detectFormat(text: string): "json" | "yaml" {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { JSON.parse(t); return "json"; } catch { /* could be YAML flow style; fall through */ }
    return /^\s*[[{]/.test(t) && !/^\s*[\w-]+\s*:/m.test(t) ? "json" : "yaml";
  }
  return "yaml";
}

function jsonErrorLine(text: string, error: Error): number | undefined {
  const pos = /position (\d+)/.exec(error.message)?.[1];
  const line = /line (\d+)/.exec(error.message)?.[1];
  if (line) return Number(line);
  if (pos) return text.slice(0, Number(pos)).split("\n").length;
  return undefined;
}

export function validateStructured(text: string, format: "auto" | "json" | "yaml"): { format: "json" | "yaml"; value: unknown; issues: StructuredIssue[]; documents: number } {
  if (!text.trim()) throw new ToolInputError("Paste some YAML or JSON.");
  const fmt = format === "auto" ? detectFormat(text) : format;
  const issues: StructuredIssue[] = [];
  if (fmt === "json") {
    try {
      const value = JSON.parse(text);
      const dupes = duplicateJsonKeys(text);
      for (const d of dupes) issues.push({ severity: "warning", message: `Duplicate key "${d.key}" - JSON.parse keeps the last one.`, line: d.line });
      return { format: fmt, value, issues, documents: 1 };
    } catch (error) {
      const e = error as Error;
      const hint = /,\s*[}\]]/.test(text) ? " (trailing commas are not allowed in JSON)" : /'/.test(text) && !/"/.test(text) ? " (JSON needs double quotes)" : /\/\/|\/\*/.test(text) ? " (comments are not allowed in JSON)" : "";
      issues.push({ severity: "error", message: e.message + hint, line: jsonErrorLine(text, e) });
      return { format: fmt, value: undefined, issues, documents: 0 };
    }
  }
  if (/^\t+/m.test(text)) {
    const line = text.split("\n").findIndex(l => /^\t/.test(l)) + 1;
    issues.push({ severity: "error", message: "Tabs cannot be used for indentation in YAML; use spaces.", line });
  }
  const docs = YAML.parseAllDocuments(text, { uniqueKeys: true });
  const list = Array.isArray(docs) ? docs : [docs];
  for (const doc of list) {
    for (const e of doc.errors) issues.push({ severity: "error", message: e.message.split("\n")[0].replace(/:$/, ""), line: e.linePos?.[0]?.line });
    for (const w of doc.warnings) issues.push({ severity: "warning", message: w.message.split("\n")[0].replace(/:$/, ""), line: w.linePos?.[0]?.line });
  }
  // YAML 1.1 surprises that still bite in Kubernetes, Compose and Ansible (their parsers use 1.1 rules).
  text.split(/\r?\n/).forEach((line, index) => {
    const m = /^\s*(?:-\s+)?([\w.-]+)\s*:\s+([^#\s][^#]*?)\s*(?:#.*)?$/.exec(line);
    if (!m) return;
    const v = m[2];
    if (/^(yes|no|on|off|y|n)$/i.test(v)) issues.push({ severity: "warning", line: index + 1, message: `${m[1]}: ${v} is a boolean in YAML 1.1 (Kubernetes, Compose, Ansible). Quote it if you mean the string "${v}".` });
    else if (/^\d+\.\d*0$/.test(v) && /version|python|node|go|java/i.test(m[1])) issues.push({ severity: "warning", line: index + 1, message: `${m[1]}: ${v} is parsed as a number (${Number(v)}). Quote it: "${v}".` });
    else if (/^0\d+$/.test(v)) issues.push({ severity: "info", line: index + 1, message: `${m[1]}: ${v} may be read as an octal number. Quote it if it is a code or ID.` });
    else if (/^[0-5]?\d:[0-5]\d$/.test(v)) issues.push({ severity: "warning", line: index + 1, message: `${m[1]}: ${v} is a base-60 number in YAML 1.1 (e.g. port mapping 22:22 becomes 1342). Quote it.` });
  });
  text.split(/\r?\n/).forEach((line, index) => {
    const m = /^\s*-\s+([0-5]?\d:[0-5]\d)\s*(?:#.*)?$/.exec(line);
    if (m) issues.push({ severity: "warning", line: index + 1, message: `${m[1]} is a base-60 number in YAML 1.1 (Compose reads "22:22" as 1342). Quote it: "${m[1]}".` });
  });
  const valid = !issues.some(i => i.severity === "error");
  const values = valid ? list.map(d => d.toJS()) : [];
  return { format: fmt, value: values.length === 1 ? values[0] : values, issues, documents: list.length };
}

function duplicateJsonKeys(text: string): Array<{ key: string; line: number }> {
  // Walk the text tracking object scopes; cheap and good enough for config files.
  const out: Array<{ key: string; line: number }> = [];
  const stack: Array<Set<string> | null> = [];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    else if (ch === "{") stack.push(new Set());
    else if (ch === "[") stack.push(null);
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === "\\") j++; j++; }
      const key = text.slice(i + 1, j);
      let k = j + 1;
      while (/\s/.test(text[k] ?? "")) k++;
      const scope = stack[stack.length - 1];
      if (text[k] === ":" && scope) {
        if (scope.has(key)) out.push({ key, line });
        scope.add(key);
      }
      i = j;
    }
  }
  return out;
}

export function convertStructured(text: string, to: "json" | "yaml", indent = 2): string {
  const parsed = validateStructured(text, "auto");
  const errors = parsed.issues.filter(i => i.severity === "error");
  if (errors.length) throw new ToolInputError(`Fix the input first: ${errors[0].message}${errors[0].line ? ` (line ${errors[0].line})` : ""}`);
  if (to === "json") return JSON.stringify(parsed.value, null, indent) + "\n";
  if (parsed.documents > 1 && Array.isArray(parsed.value)) return (parsed.value as unknown[]).map(v => YAML.stringify(v, { indent, lineWidth: 0, aliasDuplicateObjects: false })).join("---\n");
  return YAML.stringify(parsed.value, { indent, lineWidth: 0, aliasDuplicateObjects: false });
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export const WELL_KNOWN_PORTS: Record<number, string> = {
  22: "SSH", 25: "SMTP", 53: "DNS", 80: "HTTP", 443: "HTTPS", 1025: "Mailpit SMTP", 1433: "SQL Server", 1521: "Oracle",
  2181: "ZooKeeper", 2375: "Docker API (plain)", 2376: "Docker API (TLS)", 3000: "Node / Next.js / Grafana", 3306: "MySQL",
  4200: "Angular", 4317: "OTLP gRPC", 4318: "OTLP HTTP", 5000: "Flask / macOS AirPlay", 5173: "Vite", 5432: "PostgreSQL", 5601: "Kibana",
  5672: "RabbitMQ", 6333: "Qdrant", 6379: "Redis", 6443: "Kubernetes API", 8000: "Django / FastAPI", 8025: "Mailpit UI",
  8080: "HTTP alt / Tomcat", 8081: "HTTP alt", 8443: "HTTPS alt", 8888: "Jupyter", 9000: "MinIO / PHP-FPM", 9001: "MinIO console", 9090: "Prometheus",
  9092: "Kafka", 9200: "Elasticsearch", 9300: "Elasticsearch transport", 11434: "Ollama", 15672: "RabbitMQ UI", 19530: "Milvus", 27017: "MongoDB"
};

export interface CidrInfo {
  cidr: string; network: string; broadcast: string; netmask: string; wildcard: string;
  firstHost: string; lastHost: string; totalAddresses: number; usableHosts: number; private: boolean;
}

function ipToInt(ip: string): number {
  const parts = ip.trim().split(".");
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) throw new ToolInputError(`"${ip}" is not a valid IPv4 address.`);
  return parts.reduce((acc, p) => acc * 256 + Number(p), 0);
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map(shift => Math.floor(n / 2 ** shift) % 256).join(".");
}

export function cidrInfo(input: string): CidrInfo {
  const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(input);
  if (!m) throw new ToolInputError("Use CIDR notation, e.g. 10.0.0.0/16.");
  const prefix = Number(m[2]);
  if (prefix > 32) throw new ToolInputError("The prefix must be between 0 and 32.");
  const ip = ipToInt(m[1]);
  const size = 2 ** (32 - prefix);
  const network = Math.floor(ip / size) * size;
  const broadcast = network + size - 1;
  const mask = 2 ** 32 - size;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const inRange = (base: string, bits: number) => { const s = 2 ** (32 - bits); return Math.floor(network / s) * s === ipToInt(base); };
  return {
    cidr: `${intToIp(network)}/${prefix}`, network: intToIp(network), broadcast: intToIp(broadcast),
    netmask: intToIp(mask), wildcard: intToIp(size - 1), firstHost: intToIp(first), lastHost: intToIp(last),
    totalAddresses: size, usableHosts: prefix >= 31 ? size : Math.max(size - 2, 0),
    private: inRange("10.0.0.0", 8) || inRange("172.16.0.0", 12) || inRange("192.168.0.0", 16) || inRange("100.64.0.0", 10)
  };
}

export function splitCidr(input: string, newPrefix: number, limit = 256): string[] {
  const info = cidrInfo(input);
  const prefix = Number(info.cidr.split("/")[1]);
  if (newPrefix < prefix || newPrefix > 32) throw new ToolInputError(`The new prefix must be between ${prefix} and 32.`);
  const count = 2 ** (newPrefix - prefix);
  const size = 2 ** (32 - newPrefix);
  const start = ipToInt(info.network);
  const out: string[] = [];
  for (let i = 0; i < Math.min(count, limit); i++) out.push(`${intToIp(start + i * size)}/${newPrefix}`);
  return out;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const info = cidrInfo(cidr);
  const n = ipToInt(ip);
  return n >= ipToInt(info.network) && n <= ipToInt(info.broadcast);
}

export function cidrOverlap(a: string, b: string): boolean {
  const x = cidrInfo(a);
  const y = cidrInfo(b);
  return ipToInt(x.network) <= ipToInt(y.broadcast) && ipToInt(y.network) <= ipToInt(x.broadcast);
}

export function parsePorts(input: string): number[] {
  const out = new Set<number>();
  for (const part of input.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (b < a || b - a > 1000) throw new ToolInputError(`Range ${part} is invalid or larger than 1000 ports.`);
      for (let p = a; p <= b; p++) out.add(p);
    } else if (/^\d+$/.test(part)) out.add(Number(part));
    else throw new ToolInputError(`"${part}" is not a port or a range like 3000-3010.`);
  }
  for (const p of out) if (p < 1 || p > 65535) throw new ToolInputError(`Port ${p} is outside 1-65535.`);
  return [...out];
}

export function parseUrlParts(input: string): Array<[string, string]> {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ToolInputError("Not a valid absolute URL (include the scheme, e.g. https://)."); }
  const rows: Array<[string, string]> = [
    ["Scheme", url.protocol.replace(":", "")],
    ["Host", url.hostname],
    ["Port", url.port || `${defaultPort(url.protocol) ?? ""} (default)`],
    ["Path", decodeURIComponent(url.pathname)],
  ];
  if (url.origin !== "null") rows.push(["Origin", url.origin]);
  if (url.username) rows.push(["Username", decodeURIComponent(url.username)]);
  if (url.password) rows.push(["Password", "•••• (present in the URL - avoid committing it)"]);
  for (const [k, v] of url.searchParams) rows.push([`Query: ${k}`, v]);
  if (url.hash) rows.push(["Fragment", decodeURIComponent(url.hash.slice(1))]);
  return rows;
}

function defaultPort(protocol: string): number | undefined {
  return ({ "http:": 80, "https:": 443, "ws:": 80, "wss:": 443, "ftp:": 21, "postgres:": 5432, "postgresql:": 5432, "mysql:": 3306, "redis:": 6379, "rediss:": 6380, "mongodb:": 27017, "amqp:": 5672 } as Record<string, number>)[protocol];
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "unknown";
export interface LogRecord { line: number; raw: string; level: Level; time?: string; message: string; fields: Record<string, unknown>; json: boolean }

const LEVEL_ALIASES: Record<string, Level> = {
  fatal: "fatal", critical: "fatal", crit: "fatal", panic: "fatal", emerg: "fatal", alert: "fatal",
  error: "error", err: "error", severe: "error",
  warn: "warn", warning: "warn",
  info: "info", notice: "info", information: "info",
  debug: "debug", fine: "debug",
  trace: "trace", finer: "trace", finest: "trace", verbose: "trace"
};
const PINO_LEVELS: Record<number, Level> = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal" };

function levelOf(value: unknown): Level | undefined {
  if (typeof value === "number") return PINO_LEVELS[value];
  if (typeof value === "string") return LEVEL_ALIASES[value.toLowerCase()];
  return undefined;
}

export function parseLog(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    // Stack-trace continuation lines belong to the previous record.
    if (records.length && /^(\s+at\s|\s+File "|\s+\.\.\.|Caused by:|\tat\s|\s{4,}\S)/.test(raw)) {
      const prev = records[records.length - 1];
      prev.raw += "\n" + raw;
      prev.fields.stack = ((prev.fields.stack as string | undefined) ?? "") + raw.trim() + "\n";
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const level = levelOf(obj.level ?? obj.severity ?? obj.lvl ?? obj.levelname ?? obj["log.level"]) ?? "unknown";
        const time = obj.time ?? obj.timestamp ?? obj["@timestamp"] ?? obj.ts ?? obj.date;
        const message = String(obj.msg ?? obj.message ?? obj.event ?? "");
        const fields = { ...obj };
        for (const k of ["level", "severity", "lvl", "levelname", "log.level", "time", "timestamp", "@timestamp", "ts", "date", "msg", "message", "event"]) delete fields[k];
        records.push({ line: i + 1, raw, level, time: time === undefined ? undefined : typeof time === "number" ? new Date(time > 1e12 ? time : time * 1000).toISOString() : String(time), message, fields, json: true });
        continue;
      } catch { /* not JSON */ }
    }
    const time = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(raw)?.[1]
      ?? /(\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})/.exec(raw)?.[1];
    const levelMatch = /\b(FATAL|CRITICAL|CRIT|PANIC|ERROR|ERR|SEVERE|WARN|WARNING|INFO|NOTICE|DEBUG|TRACE|VERBOSE)\b/i.exec(raw)
      ?? /\[(E|W|I|D)\]/.exec(raw);
    let level: Level = levelMatch ? (levelMatch[1].length === 1 ? ({ E: "error", W: "warn", I: "info", D: "debug" } as Record<string, Level>)[levelMatch[1]] : LEVEL_ALIASES[levelMatch[1].toLowerCase()]) : "unknown";
    // Access logs: derive level from the status code.
    const access = /"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ([^ "]+)[^"]*" (\d{3}) /.exec(raw);
    const fields: Record<string, unknown> = {};
    if (access) {
      const status = Number(access[3]);
      fields.method = access[1]; fields.path = access[2]; fields.status = status;
      if (level === "unknown") level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    } else if (level === "unknown" && /\b(exception|traceback|unhandled|failed|failure)\b/i.test(raw)) level = "error";
    let message = raw;
    if (time) message = message.replace(time, "");
    if (levelMatch) message = message.replace(levelMatch[0], "");
    message = message.replace(/\[\s*\]/g, "").replace(/^[\s|:-]+/, "").replace(/\s{2,}/g, " ").trim();
    records.push({ line: i + 1, raw, level, time, message, fields, json: false });
  }
  return records;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

function toEpoch(time: string): number {
  const access = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(time);
  if (access) return Date.parse(`${access[3]}-${MONTHS[access[2]] ?? "01"}-${access[1]}T${access[4]}${access[5]}:${access[6]}`);
  // Times without a zone are read as UTC so mixed sources sort consistently.
  const iso = time.replace(" ", "T").replace(",", ".");
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z");
}

/** Collapses ids, numbers, hashes and quoted values so similar messages group together. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "<ip>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<str>")
    .replace(/\b\d+(\.\d+)?(ms|s|kb|mb|b)?\b/gi, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export interface LogAnalysis {
  total: number;
  levels: Record<Level, number>;
  json: number;
  timestamped: number;
  first?: string;
  last?: string;
  topErrors: Array<{ pattern: string; count: number; example: string; firstLine: number }>;
  statuses: Record<string, number>;
  slowest: Array<{ line: number; ms: number; message: string }>;
  recommendations: string[];
}

export function analyzeLogs(text: string): LogAnalysis {
  const records = parseLog(text);
  if (!records.length) throw new ToolInputError("No log lines found.");
  const levels: Record<Level, number> = { fatal: 0, error: 0, warn: 0, info: 0, debug: 0, trace: 0, unknown: 0 };
  const groups = new Map<string, { count: number; example: string; firstLine: number }>();
  const statuses: Record<string, number> = {};
  const durations: Array<{ line: number; ms: number; message: string }> = [];
  let json = 0;
  let timestamped = 0;
  const times: string[] = [];
  for (const r of records) {
    levels[r.level]++;
    if (r.json) json++;
    if (r.time) { timestamped++; times.push(r.time); }
    if (r.level === "error" || r.level === "fatal") {
      const key = normalizeMessage(r.message || r.raw);
      const g = groups.get(key) ?? { count: 0, example: (r.message || r.raw).slice(0, 300), firstLine: r.line };
      g.count++;
      groups.set(key, g);
    }
    const status = r.fields.status ?? r.fields.statusCode ?? (r.fields.res as any)?.statusCode;
    if (typeof status === "number") statuses[`${Math.floor(status / 100)}xx`] = (statuses[`${Math.floor(status / 100)}xx`] ?? 0) + 1;
    const d = r.fields.durationMs ?? r.fields.duration_ms ?? r.fields.responseTime ?? r.fields.latencyMs ?? r.fields.elapsed_ms;
    const inline = /\b(?:took|duration|in|latency|elapsed)[=: ]+(\d+(?:\.\d+)?)\s?ms\b/i.exec(r.message)?.[1];
    const ms = typeof d === "number" ? d : inline ? Number(inline) : undefined;
    if (ms !== undefined) durations.push({ line: r.line, ms, message: (r.message || r.raw).slice(0, 120) });
  }
  const sortedTimes = times.map(t => ({ t, ms: toEpoch(t) })).filter(x => !Number.isNaN(x.ms)).sort((a, b) => a.ms - b.ms).map(x => x.t);
  const recommendations: string[] = [];
  if (json < records.length / 2) recommendations.push("Emit structured JSON logs (one object per line) so they can be filtered and aggregated reliably.");
  if (levels.unknown > records.length * 0.2) recommendations.push(`${levels.unknown} lines have no detectable level - always include level (info/warn/error).`);
  if (timestamped < records.length * 0.8) recommendations.push("Add an ISO-8601 UTC timestamp to every line.");
  if (levels.error + levels.fatal > 0 && !records.some(r => r.fields.requestId || r.fields.traceId || r.fields.trace_id || r.fields.request_id)) recommendations.push("Include a requestId/traceId on errors so they can be correlated with requests.");
  if (records.some(r => /(password|secret|authorization|bearer\s+[\w.-]{10,}|api[_-]?key)["'=: ]+\S{6,}/i.test(r.raw))) recommendations.push("Possible secrets or credentials appear in the logs - redact them at the logger.");
  if (levels.debug + levels.trace > records.length * 0.5) recommendations.push("Over half the lines are debug/trace; use info as the production default.");
  return {
    total: records.length, levels, json, timestamped,
    first: sortedTimes[0], last: sortedTimes[sortedTimes.length - 1],
    topErrors: [...groups.entries()].map(([pattern, g]) => ({ pattern, ...g })).sort((a, b) => b.count - a.count).slice(0, 10),
    statuses,
    slowest: durations.sort((a, b) => b.ms - a.ms).slice(0, 5),
    recommendations
  };
}

export function formatLogs(text: string, options: { minLevel: Level | "all"; search: string; showFields: boolean }): { text: string; shown: number; total: number } {
  const order: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];
  const records = parseLog(text);
  const min = options.minLevel === "all" ? -1 : order.indexOf(options.minLevel);
  const needle = options.search.trim().toLowerCase();
  const shown = records.filter(r => (min < 0 || (r.level !== "unknown" && order.indexOf(r.level) >= min)) && (!needle || r.raw.toLowerCase().includes(needle)));
  const out = shown.map(r => {
    if (!r.json) return r.raw;
    const fields = { ...r.fields };
    const stack = fields.stack ?? (fields.err as any)?.stack ?? (fields.error as any)?.stack;
    delete fields.stack;
    const extras = options.showFields ? Object.entries(fields).filter(([, v]) => v !== undefined && typeof v !== "object").map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`).join(" ") : "";
    const nested = options.showFields ? Object.entries(fields).filter(([, v]) => v && typeof v === "object").map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join("\n") : "";
    return [`${r.time ?? ""} ${r.level.toUpperCase().padEnd(5)} ${r.message}${extras ? "  " + extras : ""}`.trim(), nested, typeof stack === "string" ? stack.replace(/^/gm, "    ").trimEnd() : ""].filter(Boolean).join("\n");
  });
  return { text: out.join("\n"), shown: shown.length, total: records.length };
}
