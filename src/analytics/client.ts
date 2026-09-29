import { randomBytes } from "crypto";
import { EVENT_CATALOG, EventName, NON_INTERACTION_EVENTS, PropertyKind } from "./events";

/**
 * The analytics client: validation, sessions, batching and delivery.
 *
 * It has no VS Code dependency (the extension wires it up in ./index.ts), so
 * everything here is unit-tested with a fake clock and a fake transport.
 *
 * Performance: `track()` is synchronous and only validates and appends to an
 * in-memory queue. Network work happens in the background, in batches, off
 * the command path, and a failure never surfaces to the user.
 */

export interface CapturedEvent {
  /** Unique per event: PostHog de-duplicates on it, so a resent event is never counted twice. */
  uuid: string;
  event: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

export type DeliveryResult = "ok" | "retry" | "drop";

export interface Transport {
  send(batch: CapturedEvent[]): Promise<DeliveryResult>;
}

export interface ClientOptions {
  /** Random, per-installation id. Never derived from the machine or the user. */
  distinctId: string;
  transport: Transport;
  /** Added to every event (extension version, VS Code version, platform...). */
  commonProperties: Record<string, string | number | boolean>;
  now?: () => number;
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueue?: number;
  sessionIdleMs?: number;
  engagedGapMs?: number;
  /** Called with each accepted event, for the debug output channel. */
  onEvent?: (event: CapturedEvent) => void;
  /** Called when a property is rejected, so a bad call site is visible in development. */
  onInvalid?: (message: string) => void;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,31}$/;

/** Returns the value if it is valid for `kind`, else undefined. */
export function coerceProperty(kind: PropertyKind, value: unknown): unknown {
  switch (kind) {
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "count":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1e9) : undefined;
    case "ms":
    case "seconds":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
    case "id":
      return typeof value === "string" && ID.test(value) ? value : undefined;
    case "version":
      return typeof value === "string" && VERSION.test(value) ? value : undefined;
    case "id_list": {
      if (!Array.isArray(value)) return undefined;
      if (!value.length) return [];
      const ids = [...new Set(value.filter((entry): entry is string => typeof entry === "string" && ID.test(entry)))].slice(0, 12);
      return ids.length ? ids.sort() : undefined;
    }
    default: {
      const allowed = kind.slice("enum:".length).split("|");
      return typeof value === "string" && allowed.includes(value) ? value : undefined;
    }
  }
}

/** Keeps only catalogued properties with valid values. */
export function sanitizeProperties(event: EventName, properties: Record<string, unknown>, onInvalid?: (message: string) => void): Record<string, unknown> {
  const spec = EVENT_CATALOG[event].properties as Record<string, { kind: PropertyKind }>;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    const field = spec[key];
    if (!field) {
      onInvalid?.(`${event}: property "${key}" is not in the event catalog and was dropped.`);
      continue;
    }
    const coerced = coerceProperty(field.kind, value);
    if (coerced === undefined) {
      onInvalid?.(`${event}: property "${key}" is not a valid ${field.kind} and was dropped.`);
      continue;
    }
    clean[key] = coerced;
  }
  return clean;
}

/**
 * UUIDv7 (time-ordered). PostHog requires `$session_id` values to be UUIDv7
 * to build its sessions table (session duration, pages per session...).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Math.max(0, Math.floor(now)));
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(0xff));
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface Session {
  id: string;
  startedAt: number;
  lastInteraction: number;
  engagedMs: number;
  interactions: number;
  features: Set<string>;
}

/** What survives a VS Code restart: undelivered events and the session that was open. */
export interface PersistedState {
  pending: CapturedEvent[];
  session?: { id: string; startedAt: number; lastInteraction: number; engagedMs: number; interactions: number; features: string[] };
}

export class AnalyticsClient {
  private queue: CapturedEvent[] = [];
  private enabled = false;
  private session: Session | undefined;
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | undefined;
  private failures = 0;
  private retryAt = 0;
  private revisionCounter = 0;
  private readonly now: () => number;
  private readonly flushAt: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueue: number;
  private readonly sessionIdleMs: number;
  private readonly engagedGapMs: number;

  constructor(private readonly options: ClientOptions) {
    this.now = options.now ?? Date.now;
    this.flushAt = options.flushAt ?? 20;
    this.flushIntervalMs = options.flushIntervalMs ?? 30_000;
    this.maxQueue = options.maxQueue ?? 500;
    this.sessionIdleMs = options.sessionIdleMs ?? 30 * 60_000;
    this.engagedGapMs = options.engagedGapMs ?? 5 * 60_000;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Nothing is recorded while disabled; disabling also discards anything not yet sent. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
      this.timer.unref?.();
    } else {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.queue = [];
      this.session = undefined;
    }
  }

  track(event: EventName, properties: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    try {
      if (!Object.prototype.hasOwnProperty.call(EVENT_CATALOG, event)) {
        this.options.onInvalid?.(`"${event}" is not in the event catalog and was dropped.`);
        return;
      }
      const now = this.now();
      if (!NON_INTERACTION_EVENTS.has(event)) this.touchSession(now, event === "extension_activated" ? "activation" : "resumed", properties);
      this.enqueue(event, sanitizeProperties(event, properties, this.options.onInvalid), now);
    } catch (error) {
      // Analytics must never break a feature.
      this.options.onInvalid?.(`tracking ${event} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private touchSession(now: number, reason: "activation" | "resumed", properties: Record<string, unknown>): void {
    const session = this.session;
    if (session && now - session.lastInteraction > this.sessionIdleMs) {
      this.endSession("idle", session.lastInteraction);
    }
    if (!this.session) {
      this.session = { id: uuidv7(now), startedAt: now, lastInteraction: now, engagedMs: 0, interactions: 0, features: new Set() };
      this.enqueue("session_started", { reason }, now);
    }
    const current = this.session!;
    const gap = now - current.lastInteraction;
    if (current.interactions > 0 && gap <= this.engagedGapMs) current.engagedMs += gap;
    current.lastInteraction = now;
    current.interactions++;
    if (typeof properties.feature === "string") current.features.add(properties.feature);
  }

  private endSession(reason: "idle" | "shutdown", at: number): void {
    const session = this.session;
    if (!session) return;
    this.enqueue("session_ended", {
      reason,
      duration_s: (session.lastInteraction - session.startedAt) / 1000,
      engaged_s: session.engagedMs / 1000,
      interaction_count: session.interactions,
      feature_count: session.features.size
    }, at);
    this.session = undefined;
  }

  private enqueue(event: EventName, properties: Record<string, unknown>, at: number, sessionId = this.session?.id): void {
    this.revisionCounter++;
    const captured: CapturedEvent = {
      uuid: uuidv7(at),
      event,
      timestamp: new Date(at).toISOString(),
      properties: {
        ...this.options.commonProperties,
        ...properties,
        distinct_id: this.options.distinctId,
        ...(sessionId ? { $session_id: sessionId } : {}),
        // Anonymous events: no person profile, no GeoIP enrichment.
        $process_person_profile: false,
        $geoip_disable: true,
        $lib: "devsnip-pro-vscode"
      }
    };
    this.queue.push(captured);
    // Bounded: if delivery keeps failing, the oldest events are dropped.
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    this.options.onEvent?.(captured);
    if (this.queue.length >= this.flushAt) void this.flush();
  }

  /** Sends queued events. Concurrent calls share one in-flight delivery. */
  flush(force = false): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.queue.length) return Promise.resolve();
    // After a failure, back off exponentially (30s, 1m, 2m ... 10m) instead of retrying every tick.
    if (!force && this.now() < this.retryAt) return Promise.resolve();
    this.flushing = (async () => {
      try {
        while (this.queue.length) {
          const batch = this.queue.slice(0, 100);
          let result: DeliveryResult;
          try {
            result = await this.options.transport.send(batch);
          } catch {
            result = "retry";
          }
          if (result === "retry") {
            this.failures++;
            this.retryAt = this.now() + Math.min(this.flushIntervalMs * 2 ** (this.failures - 1), 10 * 60_000);
            break; // keep the batch for the next attempt
          }
          this.failures = 0;
          this.retryAt = 0;
          this.queue.splice(0, batch.length); // "ok", or "drop" for a batch the server rejected
          this.revisionCounter++;
        }
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  /** Ends the session and makes one bounded attempt to deliver what is queued. */
  async shutdown(timeoutMs = 2000): Promise<void> {
    if (!this.enabled) return;
    this.endSession("shutdown", this.session?.lastInteraction ?? this.now());
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.race([this.flush(true), new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref?.())]);
  }

  /** Changes whenever the queue or session changes, so a checkpoint is only written when needed. */
  get revision(): number {
    return this.revisionCounter;
  }

  /** Ends the session now (for shutdown) without waiting for delivery. */
  endSessionNow(): void {
    if (!this.enabled) return;
    this.endSession("shutdown", this.session?.lastInteraction ?? this.now());
  }

  /** Undelivered events plus the open session, for the checkpoint file. */
  snapshotState(): PersistedState {
    const session = this.session;
    return {
      pending: this.queue.slice(),
      ...(session ? { session: { id: session.id, startedAt: session.startedAt, lastInteraction: session.lastInteraction, engagedMs: session.engagedMs, interactions: session.interactions, features: [...session.features] } } : {})
    };
  }

  /**
   * Applies a checkpoint from the previous VS Code run: re-queues undelivered
   * events, and closes a session that never ended (a crash or force-quit) as
   * "interrupted", stamped at its last interaction.
   */
  recover(state: unknown): { events: number; interrupted: boolean } {
    if (!this.enabled || !state || typeof state !== "object") return { events: 0, interrupted: false };
    const { pending, session } = state as Partial<PersistedState>;
    const events = this.restore(pending ?? []);
    let interrupted = false;
    if (session && typeof session.id === "string" && [session.startedAt, session.lastInteraction, session.engagedMs, session.interactions].every(n => typeof n === "number" && Number.isFinite(n))) {
      this.enqueue("session_ended", {
        reason: "interrupted",
        duration_s: (session.lastInteraction - session.startedAt) / 1000,
        engaged_s: session.engagedMs / 1000,
        interaction_count: session.interactions,
        feature_count: Array.isArray(session.features) ? session.features.length : 0
      }, session.lastInteraction, session.id);
      interrupted = true;
    }
    return { events, interrupted };
  }

  /**
   * Removes and returns everything not yet delivered. Used at shutdown: VS Code
   * tears down networking while the extension host exits, so undelivered
   * events are persisted and sent on the next start instead of being lost.
   */
  takePending(): CapturedEvent[] {
    const pending = this.queue;
    this.queue = [];
    return pending;
  }

  /** Re-queues events persisted by a previous session (only ones for this installation). */
  restore(events: unknown): number {
    if (!this.enabled || !Array.isArray(events)) return 0;
    const valid = events.filter((entry): entry is CapturedEvent =>
      !!entry && typeof entry === "object" &&
      typeof entry.uuid === "string" && typeof entry.timestamp === "string" &&
      typeof entry.event === "string" && Object.prototype.hasOwnProperty.call(EVENT_CATALOG, entry.event) &&
      !!entry.properties && typeof entry.properties === "object" &&
      entry.properties.distinct_id === this.options.distinctId
    ).slice(-this.maxQueue);
    this.queue = [...valid, ...this.queue].slice(-this.maxQueue);
    if (valid.length) this.revisionCounter++;
    return valid.length;
  }

  /** For tests and the debug view. */
  pending(): readonly CapturedEvent[] {
    return this.queue;
  }

  consecutiveFailures(): number {
    return this.failures;
  }
}
