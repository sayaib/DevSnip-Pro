import * as vscode from "vscode";
import {
  DEVELOPER_FEATURES,
  DeveloperFeature,
  POINT_UNLOCKABLE,
  getFeature,
  getFeatureLimit
} from "./feature-registry";
import { EntitlementStore, SubscriptionState } from "./entitlement";

/**
 * The one place that decides whether an operation may run.
 *
 * Every caller - webview message, command, or service - asks this service, and
 * the decision is made from the entitlement store plus the registry. Hiding a
 * button is presentation only; `assertAccess` is the actual boundary, and it is
 * called immediately before the work happens, not when the UI is drawn.
 */

export type DenialReason = "disabled" | "unknown-feature" | "requires-premium" | "limit-reached";

export interface AccessDecision {
  allowed: boolean;
  featureId: string;
  reason?: DenialReason;
  /** Message intended for the user. */
  message?: string;
  /** Present when a daily limit applies to the caller's tier. */
  limit?: { used: number; max: number | "unlimited"; unit: string };
  /** Points that would unlock this feature for a free user, when applicable. */
  pointCost?: number;
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
    private readonly entitlements: EntitlementStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  state(): SubscriptionState {
    return this.entitlements.current();
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

  /** Effective daily cap for the caller's current tier. */
  limitFor(featureId: string): { max: number | "unlimited"; unit: string } | undefined {
    const limit = getFeatureLimit(featureId);
    if (!limit) return undefined;
    const max = this.state().isPremium ? limit.premiumLimit ?? "unlimited" : limit.freeLimit;
    if (max === undefined) return undefined;
    return { max, unit: limit.unit };
  }

  /**
   * Decides whether a feature may be used right now. Pure and synchronous, so
   * it can be used both to render the UI and to guard the operation.
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

    const state = this.state();
    const pointCost = POINT_UNLOCKABLE[featureId];

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
   * Runs an operation behind the access boundary: checks entitlement, runs the
   * work, and only then counts the use.
   */
  async run<T>(featureId: string, operation: () => Promise<T>): Promise<T> {
    this.assertAccess(featureId);
    const result = await operation();
    await this.recordUsage(featureId);
    return result;
  }

  /** Clears today's counters. Used by the development tooling and tests. */
  async resetUsage(): Promise<void> {
    await this.context.globalState.update(USAGE_KEY, { date: todayStamp(this.now()), counts: {} });
  }

  /**
   * A snapshot of every feature with its current access state, for rendering
   * the client's navigation. The webview never computes entitlement itself.
   */
  snapshot(): {
    state: SubscriptionState;
    features: Array<DeveloperFeature & { locked: boolean; decision: AccessDecision }>;
  } {
    return {
      state: this.state(),
      features: DEVELOPER_FEATURES.map(feature => {
        const decision = this.check(feature.id);
        return { ...feature, locked: !decision.allowed, decision };
      })
    };
  }
}
