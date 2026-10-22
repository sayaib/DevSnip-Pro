"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortVersions = exports.maxVersion = exports.spanContains = exports.spanOverlaps = exports.declaredSpans = exports.spansFromInterval = exports.describeInterval = exports.inInterval = exports.intervalsOf = exports.isComparable = exports.comparatorFor = exports.compareGeneric = exports.compareRubyGems = void 0;
const dependency_versions_1 = require("../services/dependency-versions");
const dependency_manager_1 = require("../services/dependency-manager");
/** "0" is OSV's "before every version" marker. */
const ZERO = "0";
function stripV(value) {
    return value.replace(/^v(?=\d)/, "");
}
/** Semver with OSV's leniency: Go's leading "v", and "+incompatible" build metadata. */
function compareSemverLoose(a, b) {
    return (0, dependency_versions_1.compareSemver)(stripV(a), stripV(b));
}
/**
 * RubyGems' Gem::Version order: segments split on ".", and a segment with a
 * letter makes the version a pre-release that sorts below the release.
 */
function compareRubyGems(a, b) {
    const split = (value) => value.trim().replace(/-/g, ".pre.").split(".").flatMap(part => part.match(/\d+|[a-zA-Z]+/g) ?? []);
    const x = split(a), y = split(b);
    const length = Math.max(x.length, y.length);
    for (let i = 0; i < length; i++) {
        const p = x[i], q = y[i];
        if (p === q)
            continue;
        if (p === undefined)
            return /^\d/.test(q) ? (Number(q) === 0 ? 0 : -1) : 1;
        if (q === undefined)
            return /^\d/.test(p) ? (Number(p) === 0 ? 0 : 1) : -1;
        const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
        if (pn && qn) {
            if (Number(p) !== Number(q))
                return Number(p) < Number(q) ? -1 : 1;
            continue;
        }
        if (pn !== qn)
            return pn ? 1 : -1; // a letter segment is a pre-release
        return p < q ? -1 : 1;
    }
    return 0;
}
exports.compareRubyGems = compareRubyGems;
const COMPOSER_STABILITY = { dev: 0, alpha: 1, a: 1, beta: 2, b: 2, rc: 3, stable: 4, patch: 5, pl: 5, p: 5 };
/**
 * A generic dotted-number order with a trailing stability label, used for
 * Packagist (Composer) and CRAN. Numbers compare numerically, a label below
 * a release unless it is a patch level.
 */
function compareGeneric(a, b) {
    const split = (value) => {
        const clean = stripV(value.trim().toLowerCase());
        const match = /^([\d.\-_]*\d)?[.\-_]?([a-z]+)?[.\-_]?(\d+)?/.exec(clean);
        const numbers = (match?.[1] ?? "").split(/[.\-_]/).filter(Boolean).map(Number);
        const label = match?.[2];
        return { numbers, stability: label ? (COMPOSER_STABILITY[label] ?? 4) : 4, labelNumber: Number(match?.[3] ?? 0) };
    };
    const x = split(a), y = split(b);
    for (let i = 0; i < Math.max(x.numbers.length, y.numbers.length); i++) {
        const diff = (x.numbers[i] ?? 0) - (y.numbers[i] ?? 0);
        if (diff)
            return Math.sign(diff);
    }
    if (x.stability !== y.stability)
        return Math.sign(x.stability - y.stability);
    return Math.sign(x.labelNumber - y.labelNumber);
}
exports.compareGeneric = compareGeneric;
/** The comparator OSV's ECOSYSTEM ranges use for each ecosystem. */
function comparatorFor(ecosystem) {
    switch (ecosystem) {
        case "npm":
        case "crates.io":
        case "Go":
        case "Hex":
        case "Pub":
        case "SwiftURL": return compareSemverLoose;
        case "PyPI": return dependency_versions_1.comparePep440;
        case "Maven": return dependency_versions_1.compareMaven;
        case "NuGet": return dependency_manager_1.compareNuget;
        case "RubyGems": return compareRubyGems;
        case "Packagist":
        case "CRAN": return compareGeneric;
    }
}
exports.comparatorFor = comparatorFor;
/** True when the comparator can read `version` (so a comparison means something). */
function isComparable(ecosystem, version) {
    switch (ecosystem) {
        case "npm":
        case "crates.io":
        case "Go":
        case "Hex":
        case "Pub":
        case "SwiftURL": return Boolean((0, dependency_versions_1.parseSemver)(stripV(version)));
        case "PyPI": return Boolean((0, dependency_versions_1.parsePep440)(version));
        default: return /^v?\d/.test(version.trim());
    }
}
exports.isComparable = isComparable;
/** Lower `cmp` that treats OSV's "0" as below everything. */
function compareWithZero(cmp, a, b) {
    if (a === b)
        return 0;
    if (a === ZERO)
        return -1;
    if (b === ZERO)
        return 1;
    return cmp(a, b);
}
/**
 * Turns a range's events into intervals, in the order OSV's evaluation
 * algorithm walks them (sorted by version, "0" first). GIT ranges carry
 * commit hashes, not versions, and are skipped by callers.
 */
function intervalsOf(range, cmp) {
    const keyed = (range.events || [])
        .map(event => {
        const version = event.introduced ?? event.fixed ?? event.last_affected ?? event.limit;
        return typeof version === "string" ? { event, version } : undefined;
    })
        .filter((entry) => Boolean(entry));
    // Stable sort keeps "introduced" before "fixed" at the same version.
    const sorted = keyed.map((entry, index) => ({ ...entry, index }))
        .sort((a, b) => compareWithZero(cmp, a.version, b.version) || a.index - b.index);
    const intervals = [];
    let open;
    for (const { event } of sorted) {
        if (event.introduced !== undefined) {
            if (!open)
                open = { introduced: event.introduced };
        }
        else if (open) {
            if (event.fixed !== undefined)
                open.fixed = event.fixed;
            else if (event.last_affected !== undefined)
                open.lastAffected = event.last_affected;
            else if (event.limit !== undefined && event.limit !== "*")
                open.limit = event.limit;
            intervals.push(open);
            open = undefined;
        }
    }
    if (open)
        intervals.push(open);
    return intervals;
}
exports.intervalsOf = intervalsOf;
/** Whether `version` lies in the interval; undefined when the versions cannot be compared. */
function inInterval(version, interval, cmp, comparable) {
    const bounds = [interval.introduced, interval.fixed, interval.lastAffected, interval.limit].filter((v) => Boolean(v) && v !== ZERO);
    if (!comparable(version) || bounds.some(bound => !comparable(bound)))
        return undefined;
    if (compareWithZero(cmp, version, interval.introduced) < 0)
        return false;
    if (interval.fixed !== undefined)
        return cmp(version, interval.fixed) < 0;
    if (interval.lastAffected !== undefined)
        return cmp(version, interval.lastAffected) <= 0;
    if (interval.limit !== undefined)
        return cmp(version, interval.limit) < 0;
    return true;
}
exports.inInterval = inInterval;
/** ">= 4.0.0, < 4.17.21" for display. */
function describeInterval(interval) {
    const parts = [];
    if (interval.introduced !== ZERO)
        parts.push(`>= ${interval.introduced}`);
    if (interval.fixed !== undefined)
        parts.push(`< ${interval.fixed}`);
    else if (interval.lastAffected !== undefined)
        parts.push(`<= ${interval.lastAffected}`);
    else if (interval.limit !== undefined)
        parts.push(`< ${interval.limit}`);
    const open = interval.fixed === undefined && interval.lastAffected === undefined && interval.limit === undefined;
    return (parts.length ? parts.join(", ") : "all versions") + (open ? " (no fix released)" : "");
}
exports.describeInterval = describeInterval;
function semverString(v) {
    return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join(".")}` : ""}`;
}
function spansFromSemverRange(range) {
    const sets = (0, dependency_versions_1.parseSemverRange)(range);
    if (!sets)
        return undefined;
    return sets.map(set => {
        const span = {};
        for (const { op, version } of set) {
            const text = semverString(version);
            if (op === "=") {
                span.lower = { version: text, inclusive: true };
                span.upper = { version: text, inclusive: true };
                continue;
            }
            if (op === ">=" || op === ">") {
                const candidate = { version: text, inclusive: op === ">=" };
                if (!span.lower || (0, dependency_versions_1.compareSemver)(text, span.lower.version) > 0)
                    span.lower = candidate;
            }
            else {
                const candidate = { version: text, inclusive: op === "<=" };
                if (!span.upper || (0, dependency_versions_1.compareSemver)(text, span.upper.version) < 0)
                    span.upper = candidate;
            }
        }
        // `>= 0.0.0` is the same as no lower bound.
        if (span.lower?.version === "0.0.0" && span.lower.inclusive)
            delete span.lower;
        return span;
    });
}
function bumpRelease(parts, index) {
    const next = parts.slice(0, index + 1);
    next[index] = (next[index] ?? 0) + 1;
    return next.join(".");
}
/** PEP 440 specifiers (`>=1.2,<2`, `~=1.4.2`, `==1.2.*`) as one span; `!=` clauses are ignored (they only narrow it). */
function spanFromPep440(spec) {
    const span = {};
    const raise = (version, inclusive) => { if (!span.lower || (0, dependency_versions_1.comparePep440)(version, span.lower.version) > 0)
        span.lower = { version, inclusive }; };
    const cap = (version, inclusive) => { if (!span.upper || (0, dependency_versions_1.comparePep440)(version, span.upper.version) < 0)
        span.upper = { version, inclusive }; };
    for (const clause of spec.split(",").map(c => c.trim()).filter(Boolean)) {
        const match = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(clause);
        if (!match)
            return undefined;
        const [, op, target] = match;
        if (op === "!=")
            continue;
        if (target.endsWith(".*")) {
            const base = target.slice(0, -2);
            const release = (0, dependency_versions_1.parsePep440)(base)?.release;
            if (!release || op !== "==")
                return undefined;
            raise(base, true);
            cap(bumpRelease(release, release.length - 1), false);
            continue;
        }
        if (!(0, dependency_versions_1.parsePep440)(target))
            return undefined;
        switch (op) {
            case "==":
            case "===":
                raise(target, true);
                cap(target, true);
                break;
            case ">=":
                raise(target, true);
                break;
            case ">":
                raise(target, false);
                break;
            case "<=":
                cap(target, true);
                break;
            case "<":
                cap(target, false);
                break;
            case "~=": {
                const release = (0, dependency_versions_1.parsePep440)(target).release;
                if (release.length < 2)
                    return undefined;
                raise(target, true);
                cap(bumpRelease(release, release.length - 2), false);
                break;
            }
        }
    }
    return [span];
}
function padSemver(version) {
    const parts = version.split(".");
    while (parts.length < 3)
        parts.push("0");
    return parts.join(".");
}
function padSpan(span) {
    return {
        ...(span.lower ? { lower: { ...span.lower, version: padSemver(span.lower.version) } } : {}),
        ...(span.upper ? { upper: { ...span.upper, version: padSemver(span.upper.version) } } : {})
    };
}
/** RubyGems requirements: `~> 1.2`, `>= 1.0, < 2`, `= 1.2.3`. */
function spanFromGem(spec) {
    const span = {};
    for (const clause of spec.split(",").map(c => c.trim()).filter(Boolean)) {
        const match = /^(~>|>=|<=|!=|=|>|<)?\s*(\d[\w.]*)$/.exec(clause);
        if (!match)
            return undefined;
        const op = match[1] || "=", version = match[2];
        if (op === "!=")
            continue;
        if (op === "~>") {
            const parts = version.split(".").map(part => Number.parseInt(part, 10) || 0);
            span.lower = { version, inclusive: true };
            span.upper = { version: parts.length > 1 ? bumpRelease(parts, parts.length - 2) : String(parts[0] + 1), inclusive: false };
        }
        else if (op === "=") {
            span.lower = { version, inclusive: true };
            span.upper = { version, inclusive: true };
        }
        else if (op === ">=" || op === ">")
            span.lower = { version, inclusive: op === ">=" };
        else
            span.upper = { version, inclusive: op === "<=" };
    }
    return [span];
}
/** Maven and NuGet interval notation: `[1.0,2.0)`, `[1.0,)`, `(,1.0]`, `[1.2.3]`, or several joined by commas. */
function spansFromInterval(spec) {
    const text = spec.replace(/\s+/g, "");
    const spans = [];
    const pattern = /([[(])([^,\])]*)(?:,([^\])]*))?([\])])/g;
    let match;
    let consumed = 0;
    while ((match = pattern.exec(text)) !== null) {
        const [, open, low, high, close] = match;
        if (high === undefined) {
            if (open !== "[" || close !== "]" || !low)
                return undefined;
            spans.push({ lower: { version: low, inclusive: true }, upper: { version: low, inclusive: true } });
        }
        else {
            spans.push({
                ...(low ? { lower: { version: low, inclusive: open === "[" } } : {}),
                ...(high ? { upper: { version: high, inclusive: close === "]" } } : {})
            });
        }
        consumed += match[0].length;
    }
    const separators = text.length - consumed;
    return spans.length && separators <= spans.length - 1 ? spans : undefined;
}
exports.spansFromInterval = spansFromInterval;
/**
 * The spans of versions a declared requirement allows, or undefined when the
 * requirement cannot be interpreted (callers then treat every version as possible).
 */
function declaredSpans(ecosystem, spec) {
    const text = (spec ?? "").trim();
    if (!text || text === "*" || text === "any" || /^latest$/i.test(text))
        return [{}];
    switch (ecosystem) {
        case "SwiftURL": return spansFromSemverRange(text);
        case "npm":
        case "Pub":
        case "Hex": {
            // Elixir's `~> 1.2` means >= 1.2.0 and < 2.0.0, like RubyGems; pad to semver so it compares.
            if (ecosystem === "Hex" && text.startsWith("~>"))
                return spanFromGem(text)?.map(padSpan);
            return spansFromSemverRange(text.replace(/\s+and\s+/gi, " "));
        }
        case "crates.io": {
            // Cargo: a bare version means a caret requirement; clauses are comma-separated.
            const normalised = text.split(",").map(part => part.trim()).map(part => (/^\d/.test(part) ? `^${part}` : part)).join(" ");
            return spansFromSemverRange(normalised);
        }
        case "PyPI": return spanFromPep440(text.replace(/\s+/g, ""));
        case "RubyGems": return spanFromGem(text);
        case "Maven":
        case "NuGet": return spansFromInterval(text);
        case "Packagist": {
            const caret = /^\^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text);
            if (caret) {
                const lower = [caret[1], caret[2] ?? "0", caret[3] ?? "0"].join(".");
                const major = Number(caret[1]);
                return [{ lower: { version: lower, inclusive: true }, upper: { version: major > 0 ? `${major + 1}.0.0` : `0.${Number(caret[2] ?? 0) + 1}.0`, inclusive: false } }];
            }
            if (/^v?\d+(\.\d+)*$/.test(text))
                return [{ lower: { version: text, inclusive: true }, upper: { version: text, inclusive: true } }];
            return undefined;
        }
        default: return undefined;
    }
}
exports.declaredSpans = declaredSpans;
/**
 * Whether a declared span can contain a version inside an affected interval.
 * Unknown comparisons answer true: a potential finding is only dropped when
 * the versions prove the range cannot reach it.
 */
function spanOverlaps(span, interval, cmp, comparable) {
    const versions = [span.lower?.version, span.upper?.version, interval.fixed, interval.lastAffected, interval.limit,
        interval.introduced === ZERO ? undefined : interval.introduced].filter((v) => Boolean(v));
    if (versions.some(v => !comparable(v)))
        return true;
    // The interval's end must be above the span's lower bound.
    if (span.lower) {
        const end = interval.fixed ?? interval.limit;
        if (end !== undefined) {
            const c = cmp(end, span.lower.version);
            if (c <= 0)
                return false; // everything affected is below the lowest allowed version
        }
        else if (interval.lastAffected !== undefined) {
            const c = cmp(interval.lastAffected, span.lower.version);
            if (c < 0 || (c === 0 && !span.lower.inclusive))
                return false;
        }
    }
    // The interval's start must be below the span's upper bound.
    if (span.upper && interval.introduced !== ZERO) {
        const c = cmp(interval.introduced, span.upper.version);
        if (c > 0 || (c === 0 && !span.upper.inclusive))
            return false;
    }
    return true;
}
exports.spanOverlaps = spanOverlaps;
/** Whether a concrete version lies inside a declared span. */
function spanContains(span, version, cmp) {
    if (span.lower) {
        const c = cmp(version, span.lower.version);
        if (c < 0 || (c === 0 && !span.lower.inclusive))
            return false;
    }
    if (span.upper) {
        const c = cmp(version, span.upper.version);
        if (c > 0 || (c === 0 && !span.upper.inclusive))
            return false;
    }
    return true;
}
exports.spanContains = spanContains;
/** Highest of `versions` by `cmp`. */
function maxVersion(versions, cmp) {
    return versions.reduce((best, v) => (best === undefined || cmp(v, best) > 0 ? v : best), undefined);
}
exports.maxVersion = maxVersion;
/** Unique versions, ascending. */
function sortVersions(versions, cmp) {
    return [...new Set(versions)].sort((a, b) => compareWithZero(cmp, a, b));
}
exports.sortVersions = sortVersions;
//# sourceMappingURL=versions.js.map