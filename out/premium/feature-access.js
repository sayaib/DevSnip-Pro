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
    constructor(context, points, now = () => new Date()) {
        this.context = context;
        this.points = points;
        this.now = now;
        /** Serialises usage writes so parallel operations cannot lose a count. */
        this.usageQueue = Promise.resolve();
    }
    /** Current points balance. Never negative, never throws. */
    pointBalance() {
        try {
            const balance = this.points.balance();
            return Number.isFinite(balance) ? Math.max(0, Math.trunc(balance)) : 0;
        }
        catch (error) {
            console.error("DevSnip Pro: could not read the points balance.", error);
            return 0;
        }
    }
    /** What one run of this feature costs, in points. Free features cost nothing. */
    costFor(featureId) {
        return (0, feature_registry_1.pointCostFor)(featureId);
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
    /** Daily cap for this feature, when it has one. */
    limitFor(featureId) {
        const limit = (0, feature_registry_1.getFeatureLimit)(featureId);
        if (!limit)
            return undefined;
        const max = limit.freeLimit;
        if (max === undefined)
            return undefined;
        return { max, unit: limit.unit };
    }
    limitDecision(featureId) {
        const limit = this.limitFor(featureId);
        if (!limit || limit.max === "unlimited")
            return undefined;
        const used = this.usageFor(featureId);
        if (used < limit.max)
            return undefined;
        return {
            allowed: false,
            featureId,
            reason: "limit-reached",
            limit: { used, max: limit.max, unit: limit.unit },
            message: `You have used today's allowance of ${limit.max} ${limit.unit}. It resets tomorrow.`
        };
    }
    /**
     * Decides whether a feature may be used right now. Pure and synchronous, so
     * the same call renders the UI and guards the operation.
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
        const limitBlocked = this.limitDecision(featureId);
        if (limitBlocked)
            return limitBlocked;
        const limit = this.limitFor(featureId);
        const limitInfo = limit ? { used: this.usageFor(featureId), max: limit.max, unit: limit.unit } : undefined;
        if (feature.tier !== "premium") {
            return { allowed: true, featureId, limit: limitInfo };
        }
        const cost = (0, feature_registry_1.pointCostFor)(featureId);
        const balance = this.pointBalance();
        if (!cost) {
            // A premium feature with no price cannot be earned into. This is a
            // registry mistake rather than a state a user should ever reach.
            return {
                allowed: false,
                featureId,
                reason: "unpriced",
                pointBalance: balance,
                message: `${feature.name} has no points price set, so it cannot be unlocked. Please report this.`
            };
        }
        if (balance < cost) {
            return {
                allowed: false,
                featureId,
                reason: "insufficient-points",
                pointCost: cost,
                pointBalance: balance,
                pointsShort: cost - balance,
                message: `${feature.name} costs ${cost} points and you have ${balance}. Earn ${cost - balance} more by using DevSnip Pro tools, then run it again.`
            };
        }
        return { allowed: true, featureId, pointCost: cost, pointBalance: balance, limit: limitInfo };
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
     * Runs an operation behind the access boundary.
     *
     * The work happens first and the points are charged only once it has
     * succeeded, so a failed request never costs the user anything. The charge
     * itself is atomic: if the balance moved in between, the run is reported as
     * unaffordable rather than being given away.
     */
    async run(featureId, operation) {
        const decision = this.assertAccess(featureId);
        const result = await operation();
        const cost = decision.pointCost ?? 0;
        if (cost > 0) {
            const feature = (0, feature_registry_1.getFeature)(featureId);
            const name = feature?.name ?? featureId;
            const paid = await this.points.spend(cost, `API Client: ${name}`);
            if (!paid) {
                const balance = this.pointBalance();
                throw new FeatureAccessError({
                    allowed: false,
                    featureId,
                    reason: "insufficient-points",
                    pointCost: cost,
                    pointBalance: balance,
                    pointsShort: Math.max(0, cost - balance),
                    message: `${name} costs ${cost} points and your balance changed before it could be charged. Earn more points and try again.`
                });
            }
        }
        await this.recordUsage(featureId);
        return result;
    }
    /** Clears today's counters. Used by the development tooling and tests. */
    async resetUsage() {
        await this.context.globalState.update(USAGE_KEY, { date: todayStamp(this.now()), counts: {} });
    }
    /**
     * A snapshot of every feature with its current access state, for rendering
     * the client's navigation. The webview never computes access itself.
     */
    snapshot() {
        return {
            pointBalance: this.pointBalance(),
            features: feature_registry_1.DEVELOPER_FEATURES.map(feature => {
                const decision = this.check(feature.id);
                return { ...feature, locked: !decision.allowed, decision };
            })
        };
    }
}
exports.FeatureAccessService = FeatureAccessService;
//# sourceMappingURL=feature-access.js.map