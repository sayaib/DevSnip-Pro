/**
 * Client for the OSV.dev API (https://google.github.io/osv.dev/api/).
 *
 *  - POST /v1/querybatch: up to 1,000 queries per request (1,001 is rejected
 *    with HTTP 400); each result lists `{ id, modified }` and may carry a
 *    `next_page_token`, which is re-sent per query until no token comes back.
 *  - GET /v1/vulns/{id}: the full record.
 *
 * Only ecosystem, package name and version leave the machine. Requests time
 * out, are retried with exponential backoff and jitter on network errors,
 * timeouts, HTTP 429 and 5xx (honouring Retry-After), and stop at once when
 * the scan is cancelled. Nothing here depends on VS Code; `fetch` is injected
 * so tests drive every failure mode.
 */

export const OSV_API = "https://api.osv.dev";
export const MAX_BATCH = 1000;
/** Pages followed per query before giving up on it (OSV pages at about 1,000 advisories). */
export const MAX_PAGES = 50;
/** A failed batch is halved until it is this small, then queried one package at a time. */
const FALLBACK_SIZE = 50;

/** What OSV said about one query: its advisories, or why that query could not be completed. */
export type QueryOutcome = VulnRef[] | { error: string };

export interface OsvQuery {
  package: { name: string; ecosystem: string };
  version?: string;
}

export interface VulnRef { id: string; modified: string }

/** A full OSV record; only the fields the scanner reads are typed. */
export interface OsvRecord {
  id: string;
  modified: string;
  published?: string;
  withdrawn?: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  related?: string[];
  severity?: Array<{ type?: string; score?: string; source?: string }>;
  affected?: Array<{
    package?: { name?: string; ecosystem?: string; purl?: string };
    ranges?: Array<{ type: string; repo?: string; events: Array<Record<string, string>> }>;
    versions?: string[];
    ecosystem_specific?: Record<string, unknown>;
    database_specific?: Record<string, unknown>;
  }>;
  references?: Array<{ type?: string; url?: string }>;
  database_specific?: Record<string, unknown>;
}

export type OsvErrorKind = "network" | "timeout" | "rate-limit" | "http" | "invalid-response" | "cancelled";

export class OsvError extends Error {
  constructor(message: string, readonly kind: OsvErrorKind, readonly status?: number) {
    super(message);
    this.name = "OsvError";
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

export interface OsvClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt. */
  retries?: number;
  /** Concurrent HTTP requests. */
  concurrency?: number;
  userAgent?: string;
  /** For tests: replaces the backoff sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface OsvStats { requests: number; retries: number; batches: number; pages: number; fallbacks: number }

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function abortError(): OsvError {
  return new OsvError("The scan was cancelled.", "cancelled");
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Seconds or an HTTP date, as milliseconds from now; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Runs `tasks` with at most `limit` in flight; results keep their order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class OsvClient {
  readonly baseUrl: string;
  readonly stats: OsvStats = { requests: 0, retries: 0, batches: 0, pages: 0, fallbacks: 0 };
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  readonly concurrency: number;
  private readonly userAgent: string;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(options: OsvClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OSV_API).replace(/\/+$/, "");
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    const chosen = options.fetch ?? globalFetch;
    if (!chosen) throw new OsvError("This version of VS Code has no fetch API, so OSV cannot be reached.", "network");
    this.fetchImpl = chosen;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.retries = Math.max(0, options.retries ?? 3);
    this.concurrency = Math.max(1, options.concurrency ?? 8);
    this.userAgent = options.userAgent ?? "DevSnip-Pro-OSV-Scanner";
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /** One HTTP exchange with timeout, retries and backoff. Returns parsed JSON, or undefined for a 404. */
  private async request(method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      let failure: OsvError;
      let wait: number | undefined;
      try {
        this.stats.requests++;
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": this.userAgent },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal
        });
        const text = await response.text();
        if (response.ok) {
          try {
            return JSON.parse(text);
          } catch {
            throw new OsvError(`OSV returned a response that is not JSON (HTTP ${response.status}).`, "invalid-response", response.status);
          }
        }
        if (response.status === 404 && method === "GET") return undefined;
        const detail = (() => { try { return String((JSON.parse(text) as { message?: unknown }).message ?? ""); } catch { return ""; } })();
        if (response.status === 429) {
          failure = new OsvError("OSV is rate limiting requests (HTTP 429).", "rate-limit", 429);
          wait = retryAfterMs(response.headers.get("retry-after"));
        } else if (RETRYABLE_STATUS.has(response.status)) {
          failure = new OsvError(`OSV is unavailable (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`, "http", response.status);
          wait = retryAfterMs(response.headers.get("retry-after"));
        } else {
          throw new OsvError(`OSV rejected the request (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`, "http", response.status);
        }
      } catch (error) {
        if (error instanceof OsvError && (error.kind === "invalid-response" || (error.kind === "http" && !RETRYABLE_STATUS.has(error.status ?? 0)))) throw error;
        if (signal?.aborted) throw abortError();
        if (error instanceof OsvError) failure = error;
        else if (timedOut) failure = new OsvError(`OSV did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`, "timeout");
        else failure = new OsvError(`Could not reach ${this.baseUrl}: ${networkMessage(error)}`, "network");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (attempt >= this.retries) throw failure!;
      attempt++;
      this.stats.retries++;
      const backoff = Math.min(30000, 500 * 2 ** (attempt - 1)) * (0.75 + this.random() * 0.5);
      await this.sleep(Math.min(60000, Math.max(wait ?? 0, backoff)), signal);
    }
  }

  /**
   * One querybatch exchange (with its pagination). Returns one outcome per
   * query, in order: the advisories, or why that query could not be completed.
   * Throws when the request itself fails, so callers can fall back.
   */
  async queryBatch(queries: OsvQuery[], signal?: AbortSignal): Promise<QueryOutcome[]> {
    if (queries.length > MAX_BATCH) throw new OsvError(`At most ${MAX_BATCH} queries fit in one OSV batch.`, "invalid-response");
    const results: QueryOutcome[] = queries.map(() => []);
    let pending = queries.map((query, index) => ({ index, query, token: undefined as string | undefined }));
    for (let page = 0; pending.length && page < MAX_PAGES; page++) {
      if (page > 0) this.stats.pages += pending.length;
      const body = { queries: pending.map(p => (p.token ? { ...p.query, page_token: p.token } : p.query)) };
      const response = await this.request("POST", "/v1/querybatch", body, signal) as { results?: unknown };
      const list = response && Array.isArray(response.results) ? response.results : undefined;
      if (!list || list.length !== pending.length) {
        throw new OsvError(`OSV returned ${list ? list.length : "no"} results for ${pending.length} queries.`, "invalid-response");
      }
      const next: typeof pending = [];
      list.forEach((raw, position) => {
        const target = pending[position];
        const current = results[target.index];
        if (!Array.isArray(current)) return;
        if (!raw || typeof raw !== "object" || ("vulns" in raw && !Array.isArray((raw as { vulns: unknown }).vulns))) {
          results[target.index] = { error: "OSV returned a malformed result for this package." };
          return;
        }
        const entry = raw as { vulns?: unknown[]; next_page_token?: unknown };
        for (const vuln of entry.vulns ?? []) {
          if (!vuln || typeof vuln !== "object" || typeof (vuln as VulnRef).id !== "string") {
            results[target.index] = { error: "OSV returned an advisory without an id for this package." };
            return;
          }
          current.push({ id: (vuln as VulnRef).id, modified: String((vuln as VulnRef).modified ?? "") });
        }
        if (typeof entry.next_page_token === "string" && entry.next_page_token) next.push({ ...target, token: entry.next_page_token });
      });
      pending = next;
    }
    for (const left of pending) results[left.index] = { error: `OSV still had more results after ${MAX_PAGES} pages.` };
    return results;
  }

  /** POST /v1/query for one package, following `next_page_token` until it is gone. */
  async query(query: OsvQuery, signal?: AbortSignal): Promise<VulnRef[]> {
    const vulns: VulnRef[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) this.stats.pages++;
      const response = await this.request("POST", "/v1/query", token ? { ...query, page_token: token } : query, signal) as { vulns?: unknown; next_page_token?: unknown };
      if (!response || typeof response !== "object" || ("vulns" in response && !Array.isArray(response.vulns))) {
        throw new OsvError("OSV returned a malformed query response.", "invalid-response");
      }
      for (const vuln of (response.vulns as unknown[] | undefined) ?? []) {
        if (!vuln || typeof vuln !== "object" || typeof (vuln as VulnRef).id !== "string") throw new OsvError("OSV returned an advisory without an id.", "invalid-response");
        vulns.push({ id: (vuln as VulnRef).id, modified: String((vuln as VulnRef).modified ?? "") });
      }
      token = typeof response.next_page_token === "string" && response.next_page_token ? response.next_page_token : undefined;
      if (!token) return vulns;
    }
    throw new OsvError(`OSV still had more results after ${MAX_PAGES} pages.`, "invalid-response");
  }

  /**
   * Every query, in batches of up to 1,000. A batch that fails (after its
   * retries) is split in half and retried, and small groups fall back to one
   * /v1/query per package, so one bad package or a slow, overloaded batch
   * never loses the others. When OSV cannot be reached at all, every query
   * fails at once instead of trying each package.
   */
  async queryAll(queries: OsvQuery[], signal?: AbortSignal, onBatch?: (done: number, total: number) => void): Promise<QueryOutcome[]> {
    const results: QueryOutcome[] = new Array(queries.length);
    const chunks: number[][] = [];
    for (let i = 0; i < queries.length; i += MAX_BATCH) chunks.push(queries.slice(i, i + MAX_BATCH).map((_, k) => i + k));
    let done = 0;
    let unreachable: string | undefined;
    const runChunk = async (indexes: number[]): Promise<void> => {
      if (unreachable) { for (const i of indexes) results[i] = { error: unreachable }; return; }
      try {
        this.stats.batches++;
        const outcome = await this.queryBatch(indexes.map(i => queries[i]), signal);
        indexes.forEach((i, k) => { results[i] = outcome[k]; });
      } catch (error) {
        if (error instanceof OsvError && error.kind === "cancelled") throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof OsvError && error.kind === "network") {
          unreachable = message;
          for (const i of indexes) results[i] = { error: message };
          return;
        }
        if (indexes.length > FALLBACK_SIZE) {
          const half = Math.ceil(indexes.length / 2);
          await runChunk(indexes.slice(0, half));
          await runChunk(indexes.slice(half));
          return;
        }
        // Small enough: ask for each package on its own.
        await mapLimit(indexes, Math.min(4, this.concurrency), async i => {
          if (unreachable) { results[i] = { error: unreachable }; return; }
          this.stats.fallbacks++;
          try {
            results[i] = await this.query(queries[i], signal);
          } catch (single) {
            if (single instanceof OsvError && single.kind === "cancelled") throw single;
            results[i] = { error: single instanceof Error ? single.message : String(single) };
          }
        });
      }
    };
    await mapLimit(chunks, 2, async chunk => {
      await runChunk(chunk);
      done++;
      onBatch?.(done, chunks.length);
    });
    return results;
  }

  /** The full record, or undefined when OSV has no record with that id. */
  async getVulnerability(id: string, signal?: AbortSignal): Promise<OsvRecord | undefined> {
    const data = await this.request("GET", `/v1/vulns/${encodeURIComponent(id)}`, undefined, signal);
    if (data === undefined) return undefined;
    const record = sanitizeRecord(data);
    if (!record) throw new OsvError(`OSV returned an unreadable record for ${id}.`, "invalid-response");
    return record;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Keeps only the fields of an OSV record that match the schema
 * (https://ossf.github.io/osv-schema/), so a malformed record can never
 * crash the scan; the parts that are well-formed are still used.
 */
export function sanitizeRecord(raw: unknown): OsvRecord | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const events = (value: unknown) => list(value).filter(isObject).map(event => {
    const out: Record<string, string> = {};
    for (const key of ["introduced", "fixed", "last_affected", "limit"]) if (typeof event[key] === "string") out[key] = event[key] as string;
    return out;
  }).filter(event => Object.keys(event).length === 1);
  return {
    id: raw.id,
    modified: str(raw.modified) ?? "",
    ...(str(raw.published) ? { published: str(raw.published) } : {}),
    ...(str(raw.withdrawn) ? { withdrawn: str(raw.withdrawn) } : {}),
    ...(str(raw.summary) ? { summary: str(raw.summary) } : {}),
    ...(str(raw.details) ? { details: str(raw.details) } : {}),
    aliases: list(raw.aliases).filter((a): a is string => typeof a === "string"),
    related: list(raw.related).filter((a): a is string => typeof a === "string"),
    severity: list(raw.severity).filter(isObject).map(s => ({ type: str(s.type), score: str(s.score), source: str(s.source) })),
    affected: list(raw.affected).filter(isObject).map(a => ({
      ...(isObject(a.package) ? { package: { name: str(a.package.name), ecosystem: str(a.package.ecosystem), purl: str(a.package.purl) } } : {}),
      ranges: list(a.ranges).filter(isObject).map(r => ({ type: str(r.type) ?? "", ...(str(r.repo) ? { repo: str(r.repo) } : {}), events: events(r.events) })),
      versions: list(a.versions).filter((v): v is string => typeof v === "string"),
      ...(isObject(a.ecosystem_specific) ? { ecosystem_specific: a.ecosystem_specific } : {}),
      ...(isObject(a.database_specific) ? { database_specific: a.database_specific } : {})
    })),
    references: list(raw.references).filter(isObject).map(r => ({ type: str(r.type), url: str(r.url) })),
    ...(isObject(raw.database_specific) ? { database_specific: raw.database_specific } : {})
  };
}

/** A query OSV can answer: a known ecosystem, a plain package name and a plain version (no control characters). */
export function validateQuery(query: OsvQuery): string | undefined {
  const name = query.package.name;
  if (!name || name.length > 512 || /[\u0000-\u001f\u007f]/.test(name)) return "the package name is empty, too long or contains control characters";
  if (query.version !== undefined && (!query.version || query.version.length > 256 || /[\s\u0000-\u001f\u007f]/.test(query.version))) return "the version is empty, too long or contains spaces or control characters";
  return undefined;
}

function networkMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "the host name could not be resolved (are you offline?)";
  if (code === "ECONNREFUSED") return "the connection was refused";
  if (code === "ECONNRESET") return "the connection was reset";
  if (code && /CERT|SSL|TLS/.test(code)) return `a TLS error (${code}); a proxy may be intercepting HTTPS`;
  return cause?.message ? `${error.message} (${cause.message})` : error.message;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Records keyed by id. A record is reused only while its `modified` matches
 * what the latest query reported, so an advisory updated upstream is always
 * fetched again. Query answers (package → ids) are cached briefly in memory.
 */
export class OsvCache {
  private records = new Map<string, { modified: string; record: OsvRecord; used: number }>();
  private queries = new Map<string, { at: number; vulns: VulnRef[] }>();
  dirty = false;

  constructor(readonly maxRecords = 5000, readonly queryTtlMs = 10 * 60 * 1000, private readonly now: () => number = Date.now) {}

  getRecord(id: string, modified: string): OsvRecord | undefined {
    const hit = this.records.get(id);
    if (!hit || (modified && hit.modified !== modified)) return undefined;
    hit.used = this.now();
    return hit.record;
  }

  putRecord(record: OsvRecord): void {
    this.records.set(record.id, { modified: String(record.modified ?? ""), record, used: this.now() });
    this.dirty = true;
    if (this.records.size > this.maxRecords) {
      const oldest = [...this.records.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.records.size - this.maxRecords);
      for (const [id] of oldest) this.records.delete(id);
    }
  }

  getQuery(key: string): VulnRef[] | undefined {
    const hit = this.queries.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.queryTtlMs) { this.queries.delete(key); return undefined; }
    return hit.vulns;
  }

  putQuery(key: string, vulns: VulnRef[]): void {
    this.queries.set(key, { at: this.now(), vulns });
  }

  clear(): void {
    this.records.clear();
    this.queries.clear();
    this.dirty = true;
  }

  get size(): number { return this.records.size; }

  /** Serialisable form for persistence (records only; query answers are short-lived). */
  toJSON(): { version: 1; records: Array<{ modified: string; used: number; record: OsvRecord }> } {
    return { version: 1, records: [...this.records.values()] };
  }

  /** Restores a persisted cache; anything malformed is dropped. */
  load(data: unknown): void {
    const value = data as { version?: unknown; records?: unknown };
    if (!value || value.version !== 1 || !Array.isArray(value.records)) return;
    for (const entry of value.records as Array<{ modified?: unknown; used?: unknown; record?: OsvRecord }>) {
      const record = sanitizeRecord(entry?.record);
      if (!record) continue;
      this.records.set(record.id, { modified: String(entry.modified ?? record.modified ?? ""), record, used: Number(entry.used) || 0 });
    }
  }
}
