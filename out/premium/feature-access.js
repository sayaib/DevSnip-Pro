"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureAccessService = exports.FeatureAccessError = void 0;
const feature_registry_1 = require("./feature-registry");
class FeatureAccessError extends Error {
    constructor(decision) {
        super(decision.message || "This feature is not available.");
        this.decision = decision;
        this.name = "FeatureAccessError";
    }
}
exports.FeatureAccessError = FeatureAccessError;
const USAGE_KEY = "devsnip.premium.dailyUsage";
function todayStamp(now = new Date()) {
    return [
        now.getFullYear(),
        `${now.getMonth() + 1}`.padStart(2, "0"),
        `${now.getDate()}`.padStart(2, "0")
    ].join("-");
}
class FeatureAccessService {
    constructor(context, entitlements, now = () => new Date()) {
        this.context = context;
        this.entitlements = entitlements;
        this.now = now;
        /** Serialises usage writes so parallel operations cannot lose a count. */
        this.usageQueue = Promise.resolve();
    }
    state() {
        return this.entitlements.current();
    }
    readUsage() {
        const stored = this.context.globalState.get(USAGE_KEY);
        const today = todayStamp(this.now());
        if (!stored || typeof stored !== "object" || stored.date !== today || !stored.counts) {
            return { date: today, counts: {} };
        }
        // Repair anything non-numeric rather than throwing on corrupted state.
        const counts = {};
        for (const [key, value] of Object.entries(stored.counts)) {
            const count = Number(value);
            if (Number.isFinite(count) && count > 0)
                counts[key] = Math.trunc(count);
        }
        return { date: today, counts };
    }
    usageFor(featureId) {
        return this.readUsage().counts[featureId] ?? 0;
    }
    /** Effective daily cap for the caller's current tier. */
    limitFor(featureId) {
        const limit = (0, feature_registry_1.getFeatureLimit)(featureId);
        if (!limit)
            return undefined;
        const max = this.state().isPremium ? limit.premiumLimit ?? "unlimited" : limit.freeLimit;
        if (max === undefined)
            return undefined;
        return { max, unit: limit.unit };
    }
    /**
     * Decides whether a feature may be used right now. Pure and synchronous, so
     * it can be used both to render the UI and to guard the operation.
     */
    check(featureId) {
        const feature = (0, feature_registry_1.getFeature)(featureId);
        if (!feature) {
            return {
                allowed: false,
                featureId,
                reason: "unknown-feature",
                message: `"${featureId}" is not a known DevSnip Pro feature.`
            };
        }
        if (!feature.enabled) {
            return {
                allowed: false,
                featureId,
                reason: "disabled",
                message: `${feature.name} is not available in this build.`
            };
        }
        const state = this.state();
        const pointCost = feature_registry_1.POINT_UNLOCKABLE[featureId];
        if (feature.tier === "premium" && !state.isPremium) {
            return {
                allowed: false,
                featureId,
                reason: "requires-premium",
                pointCost,
                message: pointCost
                    ? `${feature.name} is a Premium feature. Unlock it with DevSnip Pro Premium, or spend ${pointCost} points to run it once.`
                    : `${feature.name} is a Premium feature. ${state.status === "expired" ? "Your subscription has expired." : "Activate a licence to use it."}`
            };
        }
        const limit = this.limitFor(featureId);
        if (limit && limit.max !== "unlimited") {
            const used = this.usageFor(featureId);
            if (used >= limit.max) {
                return {
                    allowed: false,
                    featureId,
                    reason: "limit-reached",
                    limit: { used, max: limit.max, unit: limit.unit },
                    message: `You have used today's free allowance of ${limit.max} ${limit.unit}. It resets tomorrow, or Premium removes the limit.`
                };
            }
            return { allowed: true, featureId, limit: { used, max: limit.max, unit: limit.unit } };
        }
        return {
            allowed: true,
            featureId,
            limit: limit ? { used: this.usageFor(featureId), max: limit.max, unit: limit.unit } : undefined
        };
    }
    /** Throws unless the feature may run. Call this immediately before the work. */
    assertAccess(featureId) {
        const decision = this.check(featureId);
        if (!decision.allowed)
            throw new FeatureAccessError(decision);
        return decision;
    }
    /**
     * Records one use of a metered feature. Called only after the operation
     * succeeded, so a failed call does not consume a user's daily allowance.
     */
    async recordUsage(featureId) {
        if (!(0, feature_registry_1.getFeatureLimit)(featureId))
            return;
        const next = this.usageQueue.then(async () => {
            const usage = this.readUsage();
            usage.counts[featureId] = (usage.counts[featureId] ?? 0) + 1;
            await this.context.globalState.update(USAGE_KEY, usage);
        });
        this.usageQueue = next.catch(() => undefined);
        await next;
    }
    /**
     * Runs an operation behind the access boundary: checks entitlement, runs the
     * work, and only then counts the use.
     */
    async run(featureId, operation) {
        this.assertAccess(featureId);
        const result = await operation();
        await this.recordUsage(featureId);
        return result;
    }
    /** Clears today's counters. Used by the development tooling and tests. */
    async resetUsage() {
        await this.context.globalState.update(USAGE_KEY, { date: todayStamp(this.now()), counts: {} });
    }
    /**
     * A snapshot of every feature with its current access state, for rendering
     * the client's navigation. The webview never computes entitlement itself.
     */
    snapshot() {
        return {
            state: this.state(),
            features: feature_registry_1.DEVELOPER_FEATURES.map(feature => {
                const decision = this.check(feature.id);
                return { ...feature, locked: !decision.allowed, decision };
            })
        };
    }
}
exports.FeatureAccessService = FeatureAccessService;
//# sourceMappingURL=feature-access.js.map