"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsClient = exports.localDay = void 0;
const crypto_1 = require("crypto");
const TOOL_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SECTION_ID = /^[a-z][a-z0-9_-]{0,31}$/;
/** Local calendar day, so "daily" matches the user's own day. */
function localDay(time) {
    const date = new Date(time);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
exports.localDay = localDay;
class AnalyticsClient {
    constructor(options) {
        this.options = options;
        this.queue = [];
        this.enabled = false;
        this.failures = 0;
        this.retryAt = 0;
        this.lastOpened = new Map();
        this.lastUsed = new Map();
        this.now = options.now ?? Date.now;
        this.flushAt = options.flushAt ?? 20;
        this.flushIntervalMs = options.flushIntervalMs ?? 60000;
        this.maxQueue = options.maxQueue ?? 200;
        this.usedCooldownMs = options.usedCooldownMs ?? 5 * 60000;
        this.openedDedupeMs = options.openedDedupeMs ?? 2000;
        this.lastActiveDay = options.lastActiveDay;
        this.previousId = options.previousId;
    }
    get isEnabled() {
        return this.enabled;
    }
    /** Nothing is recorded while disabled; disabling also discards anything not yet sent. */
    setEnabled(enabled) {
        if (enabled === this.enabled)
            return;
        this.enabled = enabled;
        if (enabled) {
            this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
            this.timer.unref?.();
            this.mergePrevious();
            this.markActive();
        }
        else {
            if (this.timer)
                clearInterval(this.timer);
            this.timer = undefined;
            this.queue = [];
        }
    }
    /** Merges the previous id into this one, once, before anything else is sent under the new id. */
    mergePrevious() {
        const previous = this.previousId;
        if (!previous || previous === this.options.distinctId)
            return;
        this.previousId = undefined;
        this.options.onMerged?.(previous);
        this.enqueue("$identify", { $anon_distinct_id: previous });
    }
    /** Records today as an active day, once per local day. */
    markActive() {
        if (!this.enabled)
            return;
        const day = localDay(this.now());
        if (day === this.lastActiveDay)
            return;
        this.lastActiveDay = day;
        this.options.onActiveDay?.(day);
        this.enqueue("extension_active", {});
    }
    toolOpened(tool, section) {
        this.toolEvent("tool_opened", tool, section, this.lastOpened, this.openedDedupeMs);
    }
    toolUsed(tool, section) {
        this.toolEvent("tool_used", tool, section, this.lastUsed, this.usedCooldownMs);
    }
    toolEvent(event, tool, section, seen, windowMs) {
        if (!this.enabled || !TOOL_ID.test(tool))
            return;
        const now = this.now();
        const last = seen.get(tool);
        if (last !== undefined && now - last < windowMs)
            return;
        seen.set(tool, now);
        // VS Code may stay open past midnight: the new day still counts as active.
        this.markActive();
        this.enqueue(event, { tool, section: SECTION_ID.test(section) ? section : "other" });
    }
    enqueue(event, properties) {
        const now = this.now();
        const captured = {
            uuid: (0, crypto_1.randomUUID)(),
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
        if (this.queue.length > this.maxQueue)
            this.queue.splice(0, this.queue.length - this.maxQueue);
        this.options.onEvent?.(captured);
        if (this.queue.length >= this.flushAt)
            void this.flush();
    }
    /** Sends queued events in batches. Concurrent calls share one in-flight delivery. */
    flush(force = false) {
        if (this.flushing)
            return this.flushing;
        if (!this.queue.length)
            return Promise.resolve();
        // After a failure, back off (1m, 2m, 4m ... 10m) instead of retrying every tick.
        if (!force && this.now() < this.retryAt)
            return Promise.resolve();
        this.flushing = (async () => {
            try {
                while (this.queue.length) {
                    const batch = this.queue.slice(0, 100);
                    let result;
                    try {
                        result = await this.options.transport.send(batch);
                    }
                    catch {
                        result = "retry";
                    }
                    if (result === "retry") {
                        this.failures++;
                        this.retryAt = this.now() + Math.min(this.flushIntervalMs * 2 ** (this.failures - 1), 10 * 60000);
                        break; // keep the batch for the next attempt
                    }
                    this.failures = 0;
                    this.retryAt = 0;
                    this.queue.splice(0, batch.length); // "ok", or "drop" for a batch the server rejected
                }
            }
            finally {
                this.flushing = undefined;
            }
        })();
        return this.flushing;
    }
    /** Stops the timer and makes one bounded attempt to deliver what is queued. */
    async shutdown(timeoutMs = 1000) {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
        if (!this.enabled)
            return;
        await Promise.race([this.flush(true), new Promise(resolve => setTimeout(resolve, timeoutMs).unref?.())]);
    }
    /** Events not yet delivered, to keep across a VS Code restart. */
    pending() {
        return this.queue;
    }
    /** Re-queues events saved by the previous VS Code run (only this user's, only known events). */
    restore(events, previousIds = []) {
        if (!this.enabled || !Array.isArray(events))
            return 0;
        const known = ["extension_active", "tool_opened", "tool_used", "$identify"];
        // Events saved under the previous id are still this user's: PostHog maps that id to the merged person.
        const ids = new Set([this.options.distinctId, ...previousIds]);
        const valid = events.filter((entry) => !!entry && typeof entry === "object" &&
            typeof entry.uuid === "string" && typeof entry.timestamp === "string" &&
            known.includes(entry.event) &&
            !!entry.properties && typeof entry.properties === "object" &&
            ids.has(entry.properties.distinct_id)).slice(-this.maxQueue);
        this.queue = [...valid, ...this.queue].slice(-this.maxQueue);
        return valid.length;
    }
}
exports.AnalyticsClient = AnalyticsClient;
//# sourceMappingURL=client.js.map