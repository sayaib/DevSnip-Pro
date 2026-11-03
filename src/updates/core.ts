/**
 * Update detection logic with no VS Code dependency: version comparison,
 * gallery response parsing, the check schedule and the snooze/skip state.
 * The VS Code side (status bar, Quick Pick, install) lives in service.ts.
 */

export type UpdateSource = "marketplace" | "openvsx";

export interface Release {
  version: string;
  source: UpdateSource;
}

export interface UpdateState {
  /** When the last check finished, successfully or not. */
  lastCheckAt?: number;
  /** No automatic check before this (failure or rate-limit backoff). */
  retryAt?: number;
  /** The newest compatible stable release seen, and when it was first seen. */
  latest?: Release & { foundAt: number };
  skippedVersion?: string;
  snoozedVersion?: string;
  snoozedUntil?: number;
  /** The version whose one notification was already shown. */
  notifiedVersion?: string;
  /** An install that finished and is waiting for a reload. */
  pendingReload?: { version: string; from: string; at: number };
}

export type CheckResult =
  | { ok: true; latest?: Release }
  | { ok: false; reason: string; retryAfterMs?: number };

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** A failed check is retried after this, so an offline machine is not polled. */
export const FAILURE_BACKOFF_MS = 6 * HOUR;
/** With VS Code auto-update on, the indicator waits this long for VS Code to install the update itself. */
export const BUILT_IN_GRACE_MS = DAY;
/** A finished install hides the indicator until a reload, but not forever. */
const PENDING_RELOAD_MS = DAY;

// ---------------------------------------------------------------------------
// Semver

interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value: unknown): Semver | undefined {
  if (typeof value !== "string") return undefined;
  const match = SEMVER.exec(value.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ? match[4].split(".") : [] };
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks its own pre-releases.
  if (!a.length || !b.length) return (b.length ? 1 : 0) - (a.length ? 1 : 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const na = /^\d+$/.test(a[i]) ? Number(a[i]) : NaN;
    const nb = /^\d+$/.test(b[i]) ? Number(b[i]) : NaN;
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (!isNaN(na) || !isNaN(nb)) {
      // Numeric identifiers sort before alphanumeric ones.
      return isNaN(na) ? 1 : -1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Semver order: negative when a < b. Undefined when either is not a version. */
export function compareSemver(a: string, b: string): number | undefined {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return undefined;
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch || Math.sign(comparePre(pa.pre, pb.pre));
}

export function isNewer(candidate: string, installed: string): boolean {
  return (compareSemver(candidate, installed) ?? 0) > 0;
}

/**
 * Whether a host version satisfies an `engines.vscode` range as VS Code
 * writes them (`^1.93.0`, `>=1.93.0`, `*`). Anything else counts as
 * incompatible, so an unreadable range never leads to a failing install.
 */
export function engineSatisfied(engine: unknown, hostVersion: string): boolean {
  if (typeof engine !== "string") return false;
  const range = engine.trim();
  if (range === "*") return true;
  const match = /^(\^|>=)?\s*(\d+)\.(\d+|x)\.(\d+|x)$/.exec(range);
  const host = parseSemver(hostVersion.replace(/-.*$/, ""));
  if (!match || !host) return false;
  const min = `${match[2]}.${match[3] === "x" ? 0 : match[3]}.${match[4] === "x" ? 0 : match[4]}`;
  if ((compareSemver(`${host.major}.${host.minor}.${host.patch}`, min) ?? -1) < 0) return false;
  return match[1] !== "^" || Number(match[2]) === 0 || host.major === Number(match[2]);
}

// ---------------------------------------------------------------------------
// Gallery responses

/** IncludeVersions | IncludeVersionProperties | IncludeLatestVersionOnly: one small version entry. */
export const MARKETPLACE_FLAGS = 0x1 | 0x10 | 0x200;

export function marketplaceQuery(extensionId: string): unknown {
  return {
    filters: [{
      criteria: [{ filterType: 7, value: extensionId }, { filterType: 8, value: "Microsoft.VisualStudio.Code" }],
      pageNumber: 1,
      pageSize: 1,
      sortBy: 0,
      sortOrder: 0
    }],
    flags: MARKETPLACE_FLAGS
  };
}

function property(version: Record<string, unknown>, key: string): unknown {
  const properties = Array.isArray(version.properties) ? version.properties : [];
  const entry = properties.find(p => p && typeof p === "object" && (p as { key?: unknown }).key === key) as { value?: unknown } | undefined;
  return entry?.value;
}

const UNIVERSAL = new Set([undefined, null, "", "universal", "web"]);

/**
 * The newest stable version in an `extensionquery` response that this host
 * can run. `undefined` when the extension or such a version is not listed;
 * throws when the response is not shaped like a gallery result.
 */
export function parseMarketplaceResponse(body: unknown, extensionId: string, hostVersion: string): string | undefined {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error("Marketplace response has no results");
  const id = extensionId.toLowerCase();
  const extension = results
    .flatMap(result => Array.isArray(result?.extensions) ? result.extensions : [])
    .find((entry: any) => `${entry?.publisher?.publisherName}.${entry?.extensionName}`.toLowerCase() === id);
  if (!extension) return undefined;
  if (!Array.isArray(extension.versions)) throw new Error("Marketplace response has no versions");
  let best: string | undefined;
  for (const entry of extension.versions as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== "object" || !parseSemver(entry.version)) continue;
    const version = entry.version as string;
    if (parseSemver(version)!.pre.length || property(entry, "Microsoft.VisualStudio.Code.PreRelease") === "true") continue;
    if (!UNIVERSAL.has(entry.targetPlatform as string)) continue;
    if (!engineSatisfied(property(entry, "Microsoft.VisualStudio.Code.Engine"), hostVersion)) continue;
    if (!best || isNewer(version, best)) best = version;
  }
  return best;
}

/** The latest version in an Open VSX `/api/{namespace}/{name}` response, when this host can run it. */
export function parseOpenVsxResponse(body: unknown, hostVersion: string): string | undefined {
  if (!body || typeof body !== "object") throw new Error("Open VSX response is not an object");
  const entry = body as { version?: unknown; preRelease?: unknown; engines?: { vscode?: unknown }; error?: unknown };
  if (typeof entry.error === "string") return undefined;
  if (!parseSemver(entry.version)) throw new Error("Open VSX response has no version");
  const version = entry.version as string;
  if (entry.preRelease === true || parseSemver(version)!.pre.length) return undefined;
  if (!engineSatisfied(entry.engines?.vscode, hostVersion)) return undefined;
  return version;
}

/** Hosts other than Microsoft's VS Code (VSCodium, Code - OSS, Theia and the like) install from Open VSX. */
export function sourceForHost(appName: string): UpdateSource {
  return /^Visual Studio Code/i.test(appName) ? "marketplace" : "openvsx";
}

export function extensionPageUrl(extensionId: string, source: UpdateSource): string {
  if (source === "openvsx") return `https://open-vsx.org/extension/${extensionId.replace(".", "/")}`;
  return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(extensionId)}`;
}

export function changelogUrl(extensionId: string, source: UpdateSource): string {
  if (source === "openvsx") return `${extensionPageUrl(extensionId, source)}/changes`;
  return `https://marketplace.visualstudio.com/items/${encodeURIComponent(extensionId)}/changelog`;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/** Seconds or an HTTP date, as Retry-After allows. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** Asks the gallery for the newest version. Never throws: every failure becomes `{ ok: false }`. */
export async function fetchLatest(
  extensionId: string,
  source: UpdateSource,
  hostVersion: string,
  fetchImpl: FetchLike,
  timeoutMs = 10_000
): Promise<CheckResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = source === "marketplace"
      ? await fetchImpl("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json;api-version=3.0-preview.1" },
        body: JSON.stringify(marketplaceQuery(extensionId)),
        signal: controller?.signal
      })
      : await fetchImpl(`https://open-vsx.org/api/${extensionId.split(".").map(encodeURIComponent).join("/")}`, {
        headers: { Accept: "application/json" },
        signal: controller?.signal
      });
    if (response.status === 429 || response.status === 503) {
      return { ok: false, reason: `rate limited (HTTP ${response.status})`, retryAfterMs: retryAfterMs(response.headers.get("retry-after")) };
    }
    // Open VSX answers 404 for an extension it does not list: nothing to offer, not a failure.
    if (source === "openvsx" && response.status === 404) return { ok: true };
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = await response.json();
    const version = source === "marketplace" ? parseMarketplaceResponse(body, extensionId, hostVersion) : parseOpenVsxResponse(body, hostVersion);
    return { ok: true, latest: version ? { version, source } : undefined };
  } catch (error) {
    const aborted = (error as { name?: string })?.name === "AbortError";
    return { ok: false, reason: aborted ? `timed out after ${timeoutMs} ms` : error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Schedule and state

export function normalizeState(raw: unknown): UpdateState {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const ver = (v: unknown) => parseSemver(v) ? v as string : undefined;
  const state: UpdateState = {
    lastCheckAt: num(value.lastCheckAt),
    retryAt: num(value.retryAt),
    skippedVersion: ver(value.skippedVersion),
    snoozedVersion: ver(value.snoozedVersion),
    snoozedUntil: num(value.snoozedUntil),
    notifiedVersion: ver(value.notifiedVersion)
  };
  const latest = value.latest as Record<string, unknown> | undefined;
  if (latest && ver(latest.version) && (latest.source === "marketplace" || latest.source === "openvsx")) {
    state.latest = { version: latest.version as string, source: latest.source, foundAt: num(latest.foundAt) ?? Date.now() };
  }
  const pending = value.pendingReload as Record<string, unknown> | undefined;
  if (pending && ver(pending.version) && typeof pending.from === "string" && num(pending.at) !== undefined) {
    state.pendingReload = { version: pending.version as string, from: pending.from, at: pending.at as number };
  }
  return state;
}

export function isCheckDue(state: UpdateState, now: number, intervalMs: number): boolean {
  if (state.retryAt !== undefined && now < state.retryAt) return false;
  return state.lastCheckAt === undefined || now - state.lastCheckAt >= intervalMs || now < state.lastCheckAt;
}

export function recordCheck(state: UpdateState, result: CheckResult, now: number): UpdateState {
  if (!result.ok) {
    return { ...state, lastCheckAt: now, retryAt: now + Math.max(FAILURE_BACKOFF_MS, result.retryAfterMs ?? 0) };
  }
  const next: UpdateState = { ...state, lastCheckAt: now, retryAt: undefined };
  if (!result.latest) {
    next.latest = undefined;
  } else if (state.latest?.version !== result.latest.version || state.latest.source !== result.latest.source) {
    next.latest = { ...result.latest, foundAt: now };
  }
  return next;
}

export function snooze(state: UpdateState, version: string, now: number, delayMs: number): UpdateState {
  return { ...state, snoozedVersion: version, snoozedUntil: now + delayMs };
}

export function skip(state: UpdateState, version: string): UpdateState {
  return { ...state, skippedVersion: version, snoozedVersion: undefined, snoozedUntil: undefined };
}

export function markNotified(state: UpdateState, version: string): UpdateState {
  return { ...state, notifiedVersion: version };
}

export function markInstalled(state: UpdateState, version: string, from: string, now: number): UpdateState {
  return { ...state, pendingReload: { version, from, at: now } };
}

export interface PresentationOptions {
  /** VS Code's own auto-update is expected to install this update. */
  deferToBuiltIn: boolean;
}

export interface Presentation {
  /** The release the user can update to, whatever is hiding it. */
  available?: Release;
  /** Show the status bar item. */
  indicator: boolean;
  /** Show the single notification for this version. */
  notify: boolean;
}

/** What to show for this state. Pure, so every snooze/skip/defer rule is testable. */
export function present(state: UpdateState, installed: string, now: number, options: PresentationOptions): Presentation {
  const latest = state.latest;
  if (!latest || !isNewer(latest.version, installed)) return { indicator: false, notify: false };
  const available: Release = { version: latest.version, source: latest.source };
  const skipped = state.skippedVersion === latest.version;
  const snoozed = state.snoozedVersion === latest.version && (state.snoozedUntil ?? 0) > now;
  const pending = state.pendingReload;
  const awaitingReload = !!pending && pending.version === latest.version && pending.from === installed && now - pending.at < PENDING_RELOAD_MS;
  const deferred = options.deferToBuiltIn && now - latest.foundAt < BUILT_IN_GRACE_MS;
  const indicator = !skipped && !snoozed && !awaitingReload && !deferred;
  // VS Code reports updates itself when it manages them, so only the quiet indicator is added then.
  const notify = indicator && !options.deferToBuiltIn && state.notifiedVersion !== latest.version;
  return { available, indicator, notify };
}

/**
 * VS Code's `extensions.autoUpdate` is `true`, `"onlyEnabledExtensions"`,
 * `"onlySelectedExtensions"` or `false`; `extensions.autoCheckUpdates` is a boolean.
 */
export function builtInPolicy(autoUpdate: unknown, autoCheckUpdates: unknown): { automaticChecks: boolean; deferToBuiltIn: boolean } {
  if (autoCheckUpdates === false) return { automaticChecks: false, deferToBuiltIn: false };
  const updates = autoUpdate === true || autoUpdate === "onlyEnabledExtensions" || autoUpdate === "onlySelectedExtensions";
  return { automaticChecks: true, deferToBuiltIn: updates };
}

export function checkIntervalMs(frequency: unknown): number | undefined {
  if (frequency === "manual") return undefined;
  return frequency === "weekly" ? 7 * DAY : DAY;
}
