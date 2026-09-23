import * as vscode from "vscode";
import {
  DEVELOPER_FEATURES,
  DeveloperFeature,
  getFeature,
  getFeatureLimit,
  pointCostFor
} from "./feature-registry";

/**
 * The one place that decides whether a REST API Client feature may run.
 *
 * Premium features are unlocked with DevSnip Pro points, which the user earns
 * by using the extension. There is no licence key and no subscription: the
 * points balance is the entitlement. Every caller - webview message, command or
 * service - asks this service, and the check happens in the extension host
 * immediately before the work, never by hiding a control.
 */

export type DenialReason = "disabled" | "unknown-feature" | "unpriced" | "limit-reached" | "insufficient-points";

/**
 * The points balance premium features are charged against.
 *
 * Injected rather than imported so this service stays independent of the
 * milestone tracker and can be tested with a simple in-memory ledger.
 */
export interface PointsLedger {
  balance(): number;
  /** Deducts the cost. Returns false when the balance is too low. */
  spend(amount: number, reason: string): Promise<boolean>;
  refund(amount: number, reason: string): Promise<void>;
}

export interface AccessDecision {
  allowed: boolean;
  featureId: string;
  reason?: DenialReason;
  /** Message intended for the user. */
  message?: string;
  /** Present when a daily limit applies to this feature. */
  limit?: { used: number; max: number | "unlimited"; unit: string };
  /** Points charged per run, when this is a premium feature. */
  pointCost?: number;
  /** The balance at the time of the decision. */
  pointBalance?: number;
  /** How many more points are needed, when the balance is short. */
  pointsShort?: number;
}

export class FeatureAccessError extends Error {
  constructor(readonly decision: AccessDecision) {
    super(decision.message || "This feature is not available.");
    this.name = "FeatureAccessError";
  }
}

interface UsageRecord {
  date: string;
  counts: { [featureId: string]: number };
}

const USAGE_KEY = "devsnip.premium.dailyUsage";

function todayStamp(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    `${now.getMonth() + 1}`.padStart(2, "0"),
    `${now.getDate()}`.padStart(2, "0")
  ].join("-");
}

export class FeatureAccessService {
  /** Serialises usage writes so parallel operations cannot lose a count. */
  private usageQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly points: PointsLedger,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Current points balance. Never negative, never throws. */
  pointBalance(): number {
    try {
      const balance = this.points.balance();
      return Number.isFinite(balance) ? Math.max(0, Math.trunc(balance)) : 0;
    } catch (error) {
      console.error("DevSnip Pro: could not read the points balance.", error);
      return 0;
    }
  }

  /** What one run of this feature costs, in points. Free features cost nothing. */
  costFor(featureId: string): number {
    return pointCostFor(featureId);
  }

  private readUsage(): UsageRecord {
    const stored = this.context.globalState.get<UsageRecord>(USAGE_KEY);
    const today = todayStamp(this.now());
    if (!stored || typeof stored !== "object" || stored.date !== today || !stored.counts) {
      return { date: today, counts: {} };
    }
    // Repair anything non-numeric rather than throwing on corrupted state.
    const counts: { [featureId: string]: number } = {};
    for (const [key, value] of Object.entries(stored.counts)) {
      const count = Number(value);
      if (Number.isFinite(count) && count > 0) counts[key] = Math.trunc(count);
    }
    return { date: today, counts };
  }

  usageFor(featureId: string): number {
    return this.readUsage().counts[featureId] ?? 0;
  }

  /** Daily cap for this feature, when it has one. */
  limitFor(featureId: string): { max: number | "unlimited"; unit: string } | undefined {
    const limit = getFeatureLimit(featureId);
    if (!limit) return undefined;
    const max = limit.freeLimit;
    if (max === undefined) return undefined;
    return { max, unit: limit.unit };
  }

  private limitDecision(featureId: string): AccessDecision | undefined {
    const limit = this.limitFor(featureId);
    if (!limit || limit.max === "unlimited") return undefined;
    const used = this.usageFor(featureId);
    if (used < limit.max) return undefined;
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
  check(featureId: string): AccessDecision {
    const feature = getFeature(featureId);
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
    if (limitBlocked) return limitBlocked;

    const limit = this.limitFor(featureId);
    const limitInfo = limit ? { used: this.usageFor(featureId), max: limit.max, unit: limit.unit } : undefined;

    if (feature.tier !== "premium") {
      return { allowed: true, featureId, limit: limitInfo };
    }

    const cost = pointCostFor(featureId);
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
  assertAccess(featureId: string): AccessDecision {
    const decision = this.check(featureId);
    if (!decision.allowed) throw new FeatureAccessError(decision);
    return decision;
  }

  /**
   * Records one use of a metered feature. Called only after the operation
   * succeeded, so a failed call does not consume a user's daily allowance.
   */
  async recordUsage(featureId: string): Promise<void> {
    if (!getFeatureLimit(featureId)) return;
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
  async run<T>(featureId: string, operation: () => Promise<T>): Promise<T> {
    const decision = this.assertAccess(featureId);
    const result = await operation();

    const cost = decision.pointCost ?? 0;
    if (cost > 0) {
      const feature = getFeature(featureId);
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
  async resetUsage(): Promise<void> {
    await this.context.globalState.update(USAGE_KEY, { date: todayStamp(this.now()), counts: {} });
  }

  /**
   * A snapshot of every feature with its current access state, for rendering
   * the client's navigation. The webview never computes access itself.
   */
  snapshot(): {
    pointBalance: number;
    features: Array<DeveloperFeature & { locked: boolean; decision: AccessDecision }>;
  } {
    return {
      pointBalance: this.pointBalance(),
      features: DEVELOPER_FEATURES.map(feature => {
        const decision = this.check(feature.id);
        return { ...feature, locked: !decision.allowed, decision };
      })
    };
  }
}
