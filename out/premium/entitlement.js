"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineLicenseVerifier = exports.EntitlementStore = exports.FREE_STATE = exports.OFFLINE_GRACE_MS = exports.VERIFICATION_TTL_MS = void 0;
const vscode = __importStar(require("vscode"));
const SECRET_KEY = "devsnip.premium.licenseKey";
const CACHE_KEY = "devsnip.premium.entitlementCache";
const DEV_OVERRIDE_KEY = "devsnip.premium.developmentTier";
/** How long a cached verification is trusted before the server is asked again. */
exports.VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a cached verification keeps working while the server is unreachable. */
exports.OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
exports.FREE_STATE = Object.freeze({
    tier: "free",
    isPremium: false,
    status: "free",
    source: "none",
    detail: "No licence activated. All free features are available."
});
/** Stable, non-reversible fingerprint so a cache entry can be tied to a key. */
function fingerprint(value) {
    let hash = 5381;
    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16);
}
function isExpired(expiresAt, now) {
    if (!expiresAt)
        return false;
    const time = Date.parse(expiresAt);
    return Number.isFinite(time) && time <= now;
}
class EntitlementStore {
    constructor(context, verifier, now = () => Date.now()) {
        this.context = context;
        this.verifier = verifier;
        this.now = now;
        this.state = exports.FREE_STATE;
        this.changeEmitter = new vscode.EventEmitter();
        /** Fires whenever the effective entitlement changes. */
        this.onDidChange = this.changeEmitter.event;
    }
    dispose() {
        this.changeEmitter.dispose();
    }
    /** The last resolved state. Synchronous, so access checks never block. */
    current() {
        return this.state;
    }
    setState(next) {
        const changed = this.state.tier !== next.tier ||
            this.state.status !== next.status ||
            this.state.expiresAt !== next.expiresAt ||
            this.state.offline !== next.offline;
        this.state = next;
        if (changed)
            this.changeEmitter.fire(next);
        return next;
    }
    readCache() {
        try {
            return this.context.globalState.get(CACHE_KEY);
        }
        catch {
            return undefined;
        }
    }
    async writeCache(entry) {
        try {
            await this.context.globalState.update(CACHE_KEY, entry);
        }
        catch (error) {
            console.error("DevSnip Pro: could not cache entitlement.", error);
        }
    }
    /**
     * Resolves the entitlement, refreshing from the verifier only when the cache
     * is stale. Concurrent calls share one verification.
     */
    async refresh(options = {}) {
        if (this.inFlight && !options.force)
            return this.inFlight;
        this.inFlight = this.resolve(options.force === true).finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }
    async resolve(force) {
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
        let licenseKey;
        try {
            licenseKey = await this.context.secrets.get(SECRET_KEY);
        }
        catch (error) {
            console.error("DevSnip Pro: secret storage unavailable.", error);
        }
        if (!licenseKey) {
            await this.writeCache(undefined);
            return this.setState(exports.FREE_STATE);
        }
        const keyFingerprint = fingerprint(licenseKey);
        const cache = this.readCache();
        const cacheMatches = cache?.keyFingerprint === keyFingerprint;
        const cacheAge = cacheMatches ? now - cache.verifiedAt : Number.POSITIVE_INFINITY;
        // A fresh, valid cache answers without touching the network.
        if (!force && cacheMatches && cache && cacheAge < exports.VERIFICATION_TTL_MS) {
            return this.setState(this.fromCache(cache, now, false));
        }
        try {
            const result = await this.verifier.verify(licenseKey);
            const entry = {
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
        }
        catch (error) {
            // The verifier could not be reached. Fall back to the cache rather than
            // revoking access from a paying user who happens to be offline.
            if (cacheMatches && cache?.valid && cacheAge < exports.OFFLINE_GRACE_MS && !isExpired(cache.expiresAt, now)) {
                return this.setState(this.fromCache(cache, now, true));
            }
            return this.setState({
                tier: "free",
                isPremium: false,
                status: cacheMatches && cache?.valid ? "offline-expired" : "offline-grace",
                source: "cache",
                offline: true,
                detail: cacheMatches && cache?.valid
                    ? "Your licence could not be re-checked within the offline grace period. Reconnect to restore Premium."
                    : "Licence verification is unavailable right now. Free features continue to work."
            });
        }
    }
    fromCache(cache, now, offline) {
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
    async activate(licenseKey) {
        const trimmed = licenseKey.trim();
        if (!trimmed) {
            return this.setState({ ...exports.FREE_STATE, status: "invalid", detail: "Enter a licence key." });
        }
        await this.context.secrets.store(SECRET_KEY, trimmed);
        await this.writeCache(undefined);
        return this.refresh({ force: true });
    }
    /** Removes the stored licence and every cached entitlement. */
    async deactivate() {
        try {
            await this.context.secrets.delete(SECRET_KEY);
        }
        catch (error) {
            console.error("DevSnip Pro: could not clear the stored licence.", error);
        }
        await this.writeCache(undefined);
        return this.setState(exports.FREE_STATE);
    }
    async hasStoredLicense() {
        try {
            return Boolean(await this.context.secrets.get(SECRET_KEY));
        }
        catch {
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
    readDevelopmentOverride() {
        if (!this.developmentModeAvailable())
            return undefined;
        const stored = this.context.globalState.get(DEV_OVERRIDE_KEY);
        return stored === "free" || stored === "premium" ? stored : undefined;
    }
    developmentModeAvailable() {
        return (this.context.extensionMode === vscode.ExtensionMode.Development ||
            this.context.extensionMode === vscode.ExtensionMode.Test);
    }
    async setDevelopmentTier(tier) {
        if (!this.developmentModeAvailable()) {
            throw new Error("The development tier override is only available in an extension development host.");
        }
        await this.context.globalState.update(DEV_OVERRIDE_KEY, tier);
        return this.refresh({ force: true });
    }
    developmentTier() {
        return this.readDevelopmentOverride();
    }
}
exports.EntitlementStore = EntitlementStore;
/**
 * Default verifier used until a licensing backend is connected.
 *
 * It validates offline-signed keys of the form `DSP-<tier>-<expiryYYYYMMDD>-<checksum>`.
 * This keeps the extension shippable and fully testable without a server, and
 * it is a drop-in replacement point: swap this for an HTTP verifier and nothing
 * else changes.
 */
class OfflineLicenseVerifier {
    async verify(licenseKey) {
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
    static checksumFor(payload) {
        let hash = 2166136261;
        for (let index = 0; index < payload.length; index++) {
            hash ^= payload.charCodeAt(index);
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
    }
    /** Helper used by tests and by the development tooling to mint a valid key. */
    static issue(expiresAt) {
        const stamp = [
            expiresAt.getUTCFullYear(),
            `${expiresAt.getUTCMonth() + 1}`.padStart(2, "0"),
            `${expiresAt.getUTCDate()}`.padStart(2, "0")
        ].join("");
        return `DSP-PREMIUM-${stamp}-${OfflineLicenseVerifier.checksumFor(`DSP-PREMIUM-${stamp}`)}`;
    }
}
exports.OfflineLicenseVerifier = OfflineLicenseVerifier;
//# sourceMappingURL=entitlement.js.map