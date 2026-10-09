import { randomUUID } from "crypto";

/**
 * The analytics client: three events, de-duplicated, batched and delivered in
 * the background. It has no VS Code dependency (./index.ts wires it up), so it
 * is unit-tested with a fake clock and a fake transport.
 *
 * Events:
 *  - `extension_active`  at most once per local day, for unique and returning users
 *  - `tool_opened`       a tool's command ran (from any surface)
 *  - `tool_used`         a tool produced a result (a run, a request, a scan...)
 *
 * Plus PostHog's own `$identify`, once per user, to merge the id earlier
 * versions used into the current one (so nobody is counted twice).
 *
 * Every event carries only the anonymous id, the tool id and section where
 * relevant, the extension version and the build environment. Nothing typed,
 * opened or produced in a tool is ever part of an event.
 */

export type EventName = "extension_active" | "tool_opened" | "tool_used";

export interface CapturedEvent {
  /** Unique per event: PostHog de-duplicates on it, so a resent event is never counted twice. */
  uuid: string;
  /** `$identify` is PostHog's own event, sent once to merge an older id into this one (see `previousId`). */
  event: EventName | "$identify";
  timestamp: string;
  properties: Record<string, unknown>;
}

export type DeliveryResult = "ok" | "retry" | "drop";

export interface Transport {
  send(batch: CapturedEvent[]): Promise<DeliveryResult>;
}

export interface ClientOptions {
  /** Anonymous id: one per machine, so every profile and reinstall counts as the same user (see ./index.ts). */
  distinctId: string;
  /**
   * The id this user reported under before (earlier versions used one per VS Code profile).
   * It is merged into `distinctId` once, so PostHog counts both as one person, and
   * events saved under it are still accepted by `restore`.
   */
  previousId?: string;
  /** Called once the merge of `previousId` is queued, so it is not sent again. */
  onMerged?: (previousId: string) => void;
  transport: Transport;
  /** Added to every event: extension version and build environment. */
  commonProperties: Record<string, string>;
  /** Local day (YYYY-MM-DD) of the last `extension_active`, so restarts on the same day send nothing. */
  lastActiveDay?: string;
  /** Called when a new active day is recorded, so it can be persisted. */
  onActiveDay?: (day: string) => void;
  now?: () => number;
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueue?: number;
  /** A tool counts as used at most once per this window. */
  usedCooldownMs?: number;
  /** The same tool opened again within this window is one open (double clicks, chained commands). */
  openedDedupeMs?: number;
  /** Called with each accepted event, for the debug output channel. */
  onEvent?: (event: CapturedEvent) => void;
}

const TOOL_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SECTION_ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** Local calendar day, so "daily" matches the user's own day. */
export function localDay(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class AnalyticsClient {
  private queue: CapturedEvent[] = [];
  private enabled = false;
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | undefined;
  private failures = 0;
  private retryAt = 0;
  private lastActiveDay: string | undefined;
  private previousId: string | undefined;
  private readonly lastOpened = new Map<string, number>();
  private readonly lastUsed = new Map<string, number>();
  private readonly now: () => number;
  private readonly flushAt: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueue: number;
  private readonly usedCooldownMs: number;
  private readonly openedDedupeMs: number;

  constructor(private readonly options: ClientOptions) {
    this.now = options.now ?? Date.now;
    this.flushAt = options.flushAt ?? 20;
    this.flushIntervalMs = options.flushIntervalMs ?? 60_000;
    this.maxQueue = options.maxQueue ?? 200;
    this.usedCooldownMs = options.usedCooldownMs ?? 5 * 60_000;
    this.openedDedupeMs = options.openedDedupeMs ?? 2_000;
    this.lastActiveDay = options.lastActiveDay;
    this.previousId = options.previousId;
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
      this.mergePrevious();
      this.markActive();
    } else {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.queue = [];
    }
  }

  /** Merges the previous id into this one, once, before anything else is sent under the new id. */
  private mergePrevious(): void {
    const previous = this.previousId;
    if (!previous || previous === this.options.distinctId) return;
    this.previousId = undefined;
    this.options.onMerged?.(previous);
    this.enqueue("$identify", { $anon_distinct_id: previous });
  }

  /** Records today as an active day, once per local day. */
  markActive(): void {
    if (!this.enabled) return;
    const day = localDay(this.now());
    if (day === this.lastActiveDay) return;
    this.lastActiveDay = day;
    this.options.onActiveDay?.(day);
    this.enqueue("extension_active", {});
  }

  toolOpened(tool: string, section: string): void {
    this.toolEvent("tool_opened", tool, section, this.lastOpened, this.openedDedupeMs);
  }

  toolUsed(tool: string, section: string): void {
    this.toolEvent("tool_used", tool, section, this.lastUsed, this.usedCooldownMs);
  }

  private toolEvent(event: "tool_opened" | "tool_used", tool: string, section: string, seen: Map<string, number>, windowMs: number): void {
    if (!this.enabled || !TOOL_ID.test(tool)) return;
    const now = this.now();
    const last = seen.get(tool);
    if (last !== undefined && now - last < windowMs) return;
    seen.set(tool, now);
    // VS Code may stay open past midnight: the new day still counts as active.
    this.markActive();
    this.enqueue(event, { tool, section: SECTION_ID.test(section) ? section : "other" });
  }

  private enqueue(event: CapturedEvent["event"], properties: Record<string, unknown>): void {
    const now = this.now();
    const captured: CapturedEvent = {
      uuid: randomUUID(),
      event,
      timestamp: new Date(now).toISOString(),
      properties: {
        ...this.options.commonProperties,
        ...properties,
        distinct_id: this.options.distinctId,
        $lib: "devsnip-pro-vscode"
      }
    };
    this.queue.push(captured);
    // Bounded: if delivery keeps failing, the oldest events are dropped.
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
    this.options.onEvent?.(captured);
    if (this.queue.length >= this.flushAt) void this.flush();
  }

  /** Sends queued events in batches. Concurrent calls share one in-flight delivery. */
  flush(force = false): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.queue.length) return Promise.resolve();
    // After a failure, back off (1m, 2m, 4m ... 10m) instead of retrying every tick.
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
        }
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  /** Stops the timer and makes one bounded attempt to deliver what is queued. */
  async shutdown(timeoutMs = 1000): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.enabled) return;
    await Promise.race([this.flush(true), new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref?.())]);
  }

  /** Events not yet delivered, to keep across a VS Code restart. */
  pending(): readonly CapturedEvent[] {
    return this.queue;
  }

  /** Re-queues events saved by the previous VS Code run (only this user's, only known events). */
  restore(events: unknown, previousIds: readonly string[] = []): number {
    if (!this.enabled || !Array.isArray(events)) return 0;
    const known: CapturedEvent["event"][] = ["extension_active", "tool_opened", "tool_used", "$identify"];
    // Events saved under the previous id are still this user's: PostHog maps that id to the merged person.
    const ids = new Set([this.options.distinctId, ...previousIds]);
    const valid = events.filter((entry): entry is CapturedEvent =>
      !!entry && typeof entry === "object" &&
      typeof entry.uuid === "string" && typeof entry.timestamp === "string" &&
      known.includes(entry.event) &&
      !!entry.properties && typeof entry.properties === "object" &&
      ids.has(entry.properties.distinct_id)
    ).slice(-this.maxQueue);
    this.queue = [...valid, ...this.queue].slice(-this.maxQueue);
    return valid.length;
  }
}
