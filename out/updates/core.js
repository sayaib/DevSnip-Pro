"use strict";
/**
 * Update detection logic with no VS Code dependency: version comparison,
 * gallery response parsing, the check schedule and the snooze/skip state.
 * The VS Code side (status bar, Quick Pick, install) lives in service.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkIntervalMs = exports.builtInPolicy = exports.present = exports.markInstalled = exports.markNotified = exports.skip = exports.snooze = exports.recordCheck = exports.isCheckDue = exports.normalizeState = exports.fetchLatest = exports.retryAfterMs = exports.changelogUrl = exports.extensionPageUrl = exports.sourceForHost = exports.parseOpenVsxResponse = exports.parseMarketplaceResponse = exports.marketplaceQuery = exports.MARKETPLACE_FLAGS = exports.engineSatisfied = exports.isNewer = exports.compareSemver = exports.parseSemver = exports.BUILT_IN_GRACE_MS = exports.FAILURE_BACKOFF_MS = exports.DAY = exports.HOUR = void 0;
exports.HOUR = 60 * 60 * 1000;
exports.DAY = 24 * exports.HOUR;
/** A failed check is retried after this, so an offline machine is not polled. */
exports.FAILURE_BACKOFF_MS = 6 * exports.HOUR;
/** With VS Code auto-update on, the indicator waits this long for VS Code to install the update itself. */
exports.BUILT_IN_GRACE_MS = exports.DAY;
/** A finished install hides the indicator until a reload, but not forever. */
const PENDING_RELOAD_MS = exports.DAY;
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseSemver(value) {
    if (typeof value !== "string")
        return undefined;
    const match = SEMVER.exec(value.trim());
    if (!match)
        return undefined;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ? match[4].split(".") : [] };
}
exports.parseSemver = parseSemver;
function comparePre(a, b) {
    // A release outranks its own pre-releases.
    if (!a.length || !b.length)
        return (b.length ? 1 : 0) - (a.length ? 1 : 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined)
            return -1;
        if (b[i] === undefined)
            return 1;
        const na = /^\d+$/.test(a[i]) ? Number(a[i]) : NaN;
        const nb = /^\d+$/.test(b[i]) ? Number(b[i]) : NaN;
        if (!isNaN(na) && !isNaN(nb)) {
            if (na !== nb)
                return na - nb;
        }
        else if (!isNaN(na) || !isNaN(nb)) {
            // Numeric identifiers sort before alphanumeric ones.
            return isNaN(na) ? 1 : -1;
        }
        else if (a[i] !== b[i]) {
            return a[i] < b[i] ? -1 : 1;
        }
    }
    return 0;
}
/** Semver order: negative when a < b. Undefined when either is not a version. */
function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb)
        return undefined;
    return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch || Math.sign(comparePre(pa.pre, pb.pre));
}
exports.compareSemver = compareSemver;
function isNewer(candidate, installed) {
    return (compareSemver(candidate, installed) ?? 0) > 0;
}
exports.isNewer = isNewer;
/**
 * Whether a host version satisfies an `engines.vscode` range as VS Code
 * writes them (`^1.93.0`, `>=1.93.0`, `*`). Anything else counts as
 * incompatible, so an unreadable range never leads to a failing install.
 */
function engineSatisfied(engine, hostVersion) {
    if (typeof engine !== "string")
        return false;
    const range = engine.trim();
    if (range === "*")
        return true;
    const match = /^(\^|>=)?\s*(\d+)\.(\d+|x)\.(\d+|x)$/.exec(range);
    const host = parseSemver(hostVersion.replace(/-.*$/, ""));
    if (!match || !host)
        return false;
    const min = `${match[2]}.${match[3] === "x" ? 0 : match[3]}.${match[4] === "x" ? 0 : match[4]}`;
    if ((compareSemver(`${host.major}.${host.minor}.${host.patch}`, min) ?? -1) < 0)
        return false;
    return match[1] !== "^" || Number(match[2]) === 0 || host.major === Number(match[2]);
}
exports.engineSatisfied = engineSatisfied;
// ---------------------------------------------------------------------------
// Gallery responses
/** IncludeVersions | IncludeVersionProperties | IncludeLatestVersionOnly: one small version entry. */
exports.MARKETPLACE_FLAGS = 0x1 | 0x10 | 0x200;
function marketplaceQuery(extensionId) {
    return {
        filters: [{
                criteria: [{ filterType: 7, value: extensionId }, { filterType: 8, value: "Microsoft.VisualStudio.Code" }],
                pageNumber: 1,
                pageSize: 1,
                sortBy: 0,
                sortOrder: 0
            }],
        flags: exports.MARKETPLACE_FLAGS
    };
}
exports.marketplaceQuery = marketplaceQuery;
function property(version, key) {
    const properties = Array.isArray(version.properties) ? version.properties : [];
    const entry = properties.find(p => p && typeof p === "object" && p.key === key);
    return entry?.value;
}
const UNIVERSAL = new Set([undefined, null, "", "universal", "web"]);
/**
 * The newest stable version in an `extensionquery` response that this host
 * can run. `undefined` when the extension or such a version is not listed;
 * throws when the response is not shaped like a gallery result.
 */
function parseMarketplaceResponse(body, extensionId, hostVersion) {
    const results = body?.results;
    if (!Array.isArray(results))
        throw new Error("Marketplace response has no results");
    const id = extensionId.toLowerCase();
    const extension = results
        .flatMap(result => Array.isArray(result?.extensions) ? result.extensions : [])
        .find((entry) => `${entry?.publisher?.publisherName}.${entry?.extensionName}`.toLowerCase() === id);
    if (!extension)
        return undefined;
    if (!Array.isArray(extension.versions))
        throw new Error("Marketplace response has no versions");
    let best;
    for (const entry of extension.versions) {
        if (!entry || typeof entry !== "object" || !parseSemver(entry.version))
            continue;
        const version = entry.version;
        if (parseSemver(version).pre.length || property(entry, "Microsoft.VisualStudio.Code.PreRelease") === "true")
            continue;
        if (!UNIVERSAL.has(entry.targetPlatform))
            continue;
        if (!engineSatisfied(property(entry, "Microsoft.VisualStudio.Code.Engine"), hostVersion))
            continue;
        if (!best || isNewer(version, best))
            best = version;
    }
    return best;
}
exports.parseMarketplaceResponse = parseMarketplaceResponse;
/** The latest version in an Open VSX `/api/{namespace}/{name}` response, when this host can run it. */
function parseOpenVsxResponse(body, hostVersion) {
    if (!body || typeof body !== "object")
        throw new Error("Open VSX response is not an object");
    const entry = body;
    if (typeof entry.error === "string")
        return undefined;
    if (!parseSemver(entry.version))
        throw new Error("Open VSX response has no version");
    const version = entry.version;
    if (entry.preRelease === true || parseSemver(version).pre.length)
        return undefined;
    if (!engineSatisfied(entry.engines?.vscode, hostVersion))
        return undefined;
    return version;
}
exports.parseOpenVsxResponse = parseOpenVsxResponse;
/** Hosts other than Microsoft's VS Code (VSCodium, Code - OSS, Theia and the like) install from Open VSX. */
function sourceForHost(appName) {
    return /^Visual Studio Code/i.test(appName) ? "marketplace" : "openvsx";
}
exports.sourceForHost = sourceForHost;
function extensionPageUrl(extensionId, source) {
    if (source === "openvsx")
        return `https://open-vsx.org/extension/${extensionId.replace(".", "/")}`;
    return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(extensionId)}`;
}
exports.extensionPageUrl = extensionPageUrl;
function changelogUrl(extensionId, source) {
    if (source === "openvsx")
        return `${extensionPageUrl(extensionId, source)}/changes`;
    return `https://marketplace.visualstudio.com/items/${encodeURIComponent(extensionId)}/changelog`;
}
exports.changelogUrl = changelogUrl;
/** Seconds or an HTTP date, as Retry-After allows. */
function retryAfterMs(header, now = Date.now()) {
    if (!header)
        return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    const at = Date.parse(header);
    return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}
exports.retryAfterMs = retryAfterMs;
/** Asks the gallery for the newest version. Never throws: every failure becomes `{ ok: false }`. */
async function fetchLatest(extensionId, source, hostVersion, fetchImpl, timeoutMs = 10000) {
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
        if (source === "openvsx" && response.status === 404)
            return { ok: true };
        if (!response.ok)
            return { ok: false, reason: `HTTP ${response.status}` };
        const body = await response.json();
        const version = source === "marketplace" ? parseMarketplaceResponse(body, extensionId, hostVersion) : parseOpenVsxResponse(body, hostVersion);
        return { ok: true, latest: version ? { version, source } : undefined };
    }
    catch (error) {
        const aborted = error?.name === "AbortError";
        return { ok: false, reason: aborted ? `timed out after ${timeoutMs} ms` : error instanceof Error ? error.message : String(error) };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
exports.fetchLatest = fetchLatest;
// ---------------------------------------------------------------------------
// Schedule and state
function normalizeState(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const ver = (v) => parseSemver(v) ? v : undefined;
    const state = {
        lastCheckAt: num(value.lastCheckAt),
        retryAt: num(value.retryAt),
        skippedVersion: ver(value.skippedVersion),
        snoozedVersion: ver(value.snoozedVersion),
        snoozedUntil: num(value.snoozedUntil),
        notifiedVersion: ver(value.notifiedVersion)
    };
    const latest = value.latest;
    if (latest && ver(latest.version) && (latest.source === "marketplace" || latest.source === "openvsx")) {
        state.latest = { version: latest.version, source: latest.source, foundAt: num(latest.foundAt) ?? Date.now() };
    }
    const pending = value.pendingReload;
    if (pending && ver(pending.version) && typeof pending.from === "string" && num(pending.at) !== undefined) {
        state.pendingReload = { version: pending.version, from: pending.from, at: pending.at };
    }
    return state;
}
exports.normalizeState = normalizeState;
function isCheckDue(state, now, intervalMs) {
    if (state.retryAt !== undefined && now < state.retryAt)
        return false;
    return state.lastCheckAt === undefined || now - state.lastCheckAt >= intervalMs || now < state.lastCheckAt;
}
exports.isCheckDue = isCheckDue;
function recordCheck(state, result, now) {
    if (!result.ok) {
        return { ...state, lastCheckAt: now, retryAt: now + Math.max(exports.FAILURE_BACKOFF_MS, result.retryAfterMs ?? 0) };
    }
    const next = { ...state, lastCheckAt: now, retryAt: undefined };
    if (!result.latest) {
        next.latest = undefined;
    }
    else if (state.latest?.version !== result.latest.version || state.latest.source !== result.latest.source) {
        next.latest = { ...result.latest, foundAt: now };
    }
    return next;
}
exports.recordCheck = recordCheck;
function snooze(state, version, now, delayMs) {
    return { ...state, snoozedVersion: version, snoozedUntil: now + delayMs };
}
exports.snooze = snooze;
function skip(state, version) {
    return { ...state, skippedVersion: version, snoozedVersion: undefined, snoozedUntil: undefined };
}
exports.skip = skip;
function markNotified(state, version) {
    return { ...state, notifiedVersion: version };
}
exports.markNotified = markNotified;
function markInstalled(state, version, from, now) {
    return { ...state, pendingReload: { version, from, at: now } };
}
exports.markInstalled = markInstalled;
/** What to show for this state. Pure, so every snooze/skip/defer rule is testable. */
function present(state, installed, now, options) {
    const latest = state.latest;
    if (!latest || !isNewer(latest.version, installed))
        return { indicator: false, notify: false };
    const available = { version: latest.version, source: latest.source };
    const skipped = state.skippedVersion === latest.version;
    const snoozed = state.snoozedVersion === latest.version && (state.snoozedUntil ?? 0) > now;
    const pending = state.pendingReload;
    const awaitingReload = !!pending && pending.version === latest.version && pending.from === installed && now - pending.at < PENDING_RELOAD_MS;
    const deferred = options.deferToBuiltIn && now - latest.foundAt < exports.BUILT_IN_GRACE_MS;
    const indicator = !skipped && !snoozed && !awaitingReload && !deferred;
    // VS Code reports updates itself when it manages them, so only the quiet indicator is added then.
    const notify = indicator && !options.deferToBuiltIn && state.notifiedVersion !== latest.version;
    return { available, indicator, notify };
}
exports.present = present;
/**
 * VS Code's `extensions.autoUpdate` is `true`, `"onlyEnabledExtensions"`,
 * `"onlySelectedExtensions"` or `false`; `extensions.autoCheckUpdates` is a boolean.
 */
function builtInPolicy(autoUpdate, autoCheckUpdates) {
    if (autoCheckUpdates === false)
        return { automaticChecks: false, deferToBuiltIn: false };
    const updates = autoUpdate === true || autoUpdate === "onlyEnabledExtensions" || autoUpdate === "onlySelectedExtensions";
    return { automaticChecks: true, deferToBuiltIn: updates };
}
exports.builtInPolicy = builtInPolicy;
function checkIntervalMs(frequency) {
    if (frequency === "manual")
        return undefined;
    return frequency === "hourly" ? exports.HOUR : frequency === "weekly" ? 7 * exports.DAY : exports.DAY;
}
exports.checkIntervalMs = checkIntervalMs;
//# sourceMappingURL=core.js.map