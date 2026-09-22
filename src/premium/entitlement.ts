import * as vscode from "vscode";

/**
 * Subscription state and its storage.
 *
 * Design constraints this file exists to satisfy:
 *
 * - No payment provider is referenced. A licence is validated through a
 *   `LicenseVerifier`, which a real backend can implement later without any
 *   change to callers.
 * - The licence key is a credential, so it lives in VS Code SecretStorage,
 *   never in global state and never in a webview.
 * - Verification must not require the network on every check. A successful
 *   verification is cached with a grace period so the extension keeps working
 *   offline, and the server is not polled on every feature call.
 */

export type SubscriptionTier = "free" | "premium";

export interface SubscriptionState {
  tier: SubscriptionTier;
  isPremium: boolean;
  /** ISO timestamp; absent for a perpetual or free entitlement. */
  expiresAt?: string;
  /** Why the state is what it is, for display and for diagnostics. */
  status: EntitlementStatus;
  /** Set when the state came from cache because verification was unreachable. */
  offline?: boolean;
  /** Human-readable detail for the UI. Never contains the licence key. */
  detail?: string;
  /** Present only in development-mode overrides. */
  source: "none" | "license" | "cache" | "development";
}

export type EntitlementStatus =
  | "free"
  | "active"
  | "expired"
  | "invalid"
  | "offline-grace"
  | "offline-expired"
  | "development";

export interface LicenseVerification {
  valid: boolean;
  /** ISO timestamp the entitlement runs until. */
  expiresAt?: string;
  /** Reason the licence was rejected; shown to the user. */
  reason?: string;
}

/**
 * Pluggable licence check. A production build supplies one that calls a
 * licensing service; the extension itself stays provider-agnostic.
 *
 * Implementations must throw on a network failure rather than returning
 * `valid: false`, so a connectivity problem is never mistaken for an invalid
 * licence and never silently revokes a paying user's access.
 */
export interface LicenseVerifier {
  verify(licenseKey: string): Promise<LicenseVerification>;
}

interface CachedEntitlement {
  /** Fingerprint of the key the cache belongs to, never the key itself. */
  keyFingerprint: string;
  valid: boolean;
  expiresAt?: string;
  verifiedAt: number;
  reason?: string;
}

const SECRET_KEY = "devsnip.premium.licenseKey";
const CACHE_KEY = "devsnip.premium.entitlementCache";
const DEV_OVERRIDE_KEY = "devsnip.premium.developmentTier";

/** How long a cached verification is trusted before the server is asked again. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a cached verification keeps working while the server is unreachable. */
export const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export const FREE_STATE: SubscriptionState = Object.freeze({
  tier: "free",
  isPremium: false,
  status: "free",
  source: "none",
  detail: "No licence activated. All free features are available."
});

/** Stable, non-reversible fingerprint so a cache entry can be tied to a key. */
function fingerprint(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function isExpired(expiresAt: string | undefined, now: number): boolean {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= now;
}

export class EntitlementStore {
  private state: SubscriptionState = FREE_STATE;
  private readonly changeEmitter = new vscode.EventEmitter<SubscriptionState>();
  private inFlight: Promise<SubscriptionState> | undefined;

  /** Fires whenever the effective entitlement changes. */
  readonly onDidChange: vscode.Event<SubscriptionState> = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly verifier: LicenseVerifier,
    private readonly now: () => number = () => Date.now()
  ) {}

  dispose(): void {
    this.changeEmitter.dispose();
  }

  /** The last resolved state. Synchronous, so access checks never block. */
  current(): SubscriptionState {
    return this.state;
  }

  private setState(next: SubscriptionState): SubscriptionState {
    const changed =
      this.state.tier !== next.tier ||
      this.state.status !== next.status ||
      this.state.expiresAt !== next.expiresAt ||
      this.state.offline !== next.offline;
    this.state = next;
    if (changed) this.changeEmitter.fire(next);
    return next;
  }

  private readCache(): CachedEntitlement | undefined {
    try {
      return this.context.globalState.get<CachedEntitlement>(CACHE_KEY);
    } catch {
      return undefined;
    }
  }

  private async writeCache(entry: CachedEntitlement | undefined): Promise<void> {
    try {
      await this.context.globalState.update(CACHE_KEY, entry);
    } catch (error) {
      console.error("DevSnip Pro: could not cache entitlement.", error);
    }
  }

  /**
   * Resolves the entitlement, refreshing from the verifier only when the cache
   * is stale. Concurrent calls share one verification.
   */
  async refresh(options: { force?: boolean } = {}): Promise<SubscriptionState> {
    if (this.inFlight && !options.force) return this.inFlight;
    this.inFlight = this.resolve(options.force === true).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async resolve(force: boolean): Promise<SubscriptionState> {
    const now = this.now();

    // A development override wins, but only in a development host.
    const override = this.readDevelopmentOverride();
    if (override) {
      return this.setState({
        tier: override,
        isPremium: override === "premium",
        status: "development",
        source: "development",
        detail: `Development mode: acting as a ${override} user. This override is unavailable in an installed extension.`
      });
    }

    let licenseKey: string | undefined;
    try {
      licenseKey = await this.context.secrets.get(SECRET_KEY);
    } catch (error) {
      console.error("DevSnip Pro: secret storage unavailable.", error);
    }

    if (!licenseKey) {
      await this.writeCache(undefined);
      return this.setState(FREE_STATE);
    }

    const keyFingerprint = fingerprint(licenseKey);
    const cache = this.readCache();
    const cacheMatches = cache?.keyFingerprint === keyFingerprint;
    const cacheAge = cacheMatches ? now - cache.verifiedAt : Number.POSITIVE_INFINITY;

    // A fresh, valid cache answers without touching the network.
    if (!force && cacheMatches && cache && cacheAge < VERIFICATION_TTL_MS) {
      return this.setState(this.fromCache(cache, now, false));
    }

    try {
      const result = await this.verifier.verify(licenseKey);
      const entry: CachedEntitlement = {
        keyFingerprint,
        valid: result.valid,
        expiresAt: result.expiresAt,
        verifiedAt: now,
        reason: result.reason
      };
      await this.writeCache(entry);

      if (!result.valid) {
        return this.setState({
          tier: "free",
          isPremium: false,
          status: "invalid",
          source: "license",
          detail: result.reason || "This licence key was rejected. Free features remain available."
        });
      }
      if (isExpired(result.expiresAt, now)) {
        return this.setState({
          tier: "free",
          isPremium: false,
          status: "expired",
          expiresAt: result.expiresAt,
          source: "license",
          detail: "Your subscription has expired. Renew it to restore Premium features."
        });
      }
      return this.setState({
        tier: "premium",
        isPremium: true,
        status: "active",
        expiresAt: result.expiresAt,
        source: "license",
        detail: result.expiresAt
          ? `Premium active until ${new Date(result.expiresAt).toLocaleDateString()}.`
          : "Premium active."
      });
    } catch (error) {
      // The verifier could not be reached. Fall back to the cache rather than
      // revoking access from a paying user who happens to be offline.
      if (cacheMatches && cache?.valid && cacheAge < OFFLINE_GRACE_MS && !isExpired(cache.expiresAt, now)) {
        return this.setState(this.fromCache(cache, now, true));
      }
      return this.setState({
        tier: "free",
        isPremium: false,
        status: cacheMatches && cache?.valid ? "offline-expired" : "offline-grace",
        source: "cache",
        offline: true,
        detail:
          cacheMatches && cache?.valid
            ? "Your licence could not be re-checked within the offline grace period. Reconnect to restore Premium."
            : "Licence verification is unavailable right now. Free features continue to work."
      });
    }
  }

  private fromCache(cache: CachedEntitlement, now: number, offline: boolean): SubscriptionState {
    if (!cache.valid) {
      return {
        tier: "free",
        isPremium: false,
        status: "invalid",
        source: "cache",
        offline,
        detail: cache.reason || "This licence key was rejected."
      };
    }
    if (isExpired(cache.expiresAt, now)) {
      return {
        tier: "free",
        isPremium: false,
        status: "expired",
        expiresAt: cache.expiresAt,
        source: "cache",
        offline,
        detail: "Your subscription has expired. Renew it to restore Premium features."
      };
    }
    return {
      tier: "premium",
      isPremium: true,
      status: offline ? "offline-grace" : "active",
      expiresAt: cache.expiresAt,
      source: "cache",
      offline,
      detail: offline
        ? "Premium active from a cached licence check; the licence server is currently unreachable."
        : "Premium active."
    };
  }

  /** Stores a licence key in secret storage and verifies it immediately. */
  async activate(licenseKey: string): Promise<SubscriptionState> {
    const trimmed = licenseKey.trim();
    if (!trimmed) {
      return this.setState({ ...FREE_STATE, status: "invalid", detail: "Enter a licence key." });
    }
    await this.context.secrets.store(SECRET_KEY, trimmed);
    await this.writeCache(undefined);
    return this.refresh({ force: true });
  }

  /** Removes the stored licence and every cached entitlement. */
  async deactivate(): Promise<SubscriptionState> {
    try {
      await this.context.secrets.delete(SECRET_KEY);
    } catch (error) {
      console.error("DevSnip Pro: could not clear the stored licence.", error);
    }
    await this.writeCache(undefined);
    return this.setState(FREE_STATE);
  }

  async hasStoredLicense(): Promise<boolean> {
    try {
      return Boolean(await this.context.secrets.get(SECRET_KEY));
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ development

  /**
   * Tier override for local testing.
   *
   * It is read only when the extension is running in a development or test
   * host. An installed extension ignores a stored override entirely, so this
   * can never be used to bypass licensing in production.
   */
  private readDevelopmentOverride(): SubscriptionTier | undefined {
    if (!this.developmentModeAvailable()) return undefined;
    const stored = this.context.globalState.get<string>(DEV_OVERRIDE_KEY);
    return stored === "free" || stored === "premium" ? stored : undefined;
  }

  developmentModeAvailable(): boolean {
    return (
      this.context.extensionMode === vscode.ExtensionMode.Development ||
      this.context.extensionMode === vscode.ExtensionMode.Test
    );
  }

  async setDevelopmentTier(tier: SubscriptionTier | undefined): Promise<SubscriptionState> {
    if (!this.developmentModeAvailable()) {
      throw new Error("The development tier override is only available in an extension development host.");
    }
    await this.context.globalState.update(DEV_OVERRIDE_KEY, tier);
    return this.refresh({ force: true });
  }

  developmentTier(): SubscriptionTier | undefined {
    return this.readDevelopmentOverride();
  }
}

/**
 * Default verifier used until a licensing backend is connected.
 *
 * It validates offline-signed keys of the form `DSP-<tier>-<expiryYYYYMMDD>-<checksum>`.
 * This keeps the extension shippable and fully testable without a server, and
 * it is a drop-in replacement point: swap this for an HTTP verifier and nothing
 * else changes.
 */
export class OfflineLicenseVerifier implements LicenseVerifier {
  async verify(licenseKey: string): Promise<LicenseVerification> {
    const match = /^DSP-(PREMIUM)-(\d{8})-([A-Z0-9]{6})$/i.exec(licenseKey.trim());
    if (!match) {
      return { valid: false, reason: "That licence key is not in a recognised format." };
    }
    const [, , expiry, checksum] = match;
    const expected = OfflineLicenseVerifier.checksumFor(`DSP-PREMIUM-${expiry}`);
    if (checksum.toUpperCase() !== expected) {
      return { valid: false, reason: "That licence key failed its integrity check." };
    }
    const year = Number(expiry.slice(0, 4));
    const month = Number(expiry.slice(4, 6));
    const day = Number(expiry.slice(6, 8));
    const expiresAt = new Date(Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString();
    return { valid: true, expiresAt };
  }

  /** Deterministic six-character checksum. Not a security boundary on its own. */
  static checksumFor(payload: string): string {
    let hash = 2166136261;
    for (let index = 0; index < payload.length; index++) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  }

  /** Helper used by tests and by the development tooling to mint a valid key. */
  static issue(expiresAt: Date): string {
    const stamp = [
      expiresAt.getUTCFullYear(),
      `${expiresAt.getUTCMonth() + 1}`.padStart(2, "0"),
      `${expiresAt.getUTCDate()}`.padStart(2, "0")
    ].join("");
    return `DSP-PREMIUM-${stamp}-${OfflineLicenseVerifier.checksumFor(`DSP-PREMIUM-${stamp}`)}`;
  }
}
