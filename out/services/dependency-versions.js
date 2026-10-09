"use strict";
/**
 * Version parsing, ordering and range matching for the three version schemes
 * the dependency manager reads: npm semver, Python PEP 440 and Maven.
 *
 * Kept dependency-free (no `semver` package, no VS Code) so it ships inside the
 * extension without growing its install size and is unit-testable on its own.
 * Each implementation covers what manifests actually contain; anything it cannot
 * interpret returns `undefined` so the caller reports "unknown" instead of a
 * confidently wrong verdict.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mavenMajor = exports.mavenFlavour = exports.isStableMaven = exports.compareMaven = exports.maxSatisfyingPep440 = exports.isValidPep440Specifier = exports.satisfiesPep440 = exports.comparePep440 = exports.isStablePep440 = exports.parsePep440 = exports.maxSatisfyingSemver = exports.satisfiesSemver = exports.parseSemverRange = exports.compareSemver = exports.isStableSemver = exports.parseSemver = void 0;
const SEMVER_PATTERN = /^\s*[v=]*\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;
function parseSemver(value) {
    if (typeof value !== "string")
        return undefined;
    const match = SEMVER_PATTERN.exec(value);
    if (!match)
        return undefined;
    const numbers = [match[1], match[2], match[3]].map(Number);
    if (numbers.some(n => !Number.isSafeInteger(n)))
        return undefined;
    return {
        major: numbers[0],
        minor: numbers[1],
        patch: numbers[2],
        prerelease: match[4] ? match[4].split(".").map(part => (/^\d+$/.test(part) ? Number(part) : part)) : []
    };
}
exports.parseSemver = parseSemver;
function isStableSemver(value) {
    const parsed = parseSemver(value);
    return Boolean(parsed && parsed.prerelease.length === 0);
}
exports.isStableSemver = isStableSemver;
function comparePrerelease(a, b) {
    // A release sorts above any of its pre-releases.
    if (!a.length && !b.length)
        return 0;
    if (!a.length)
        return 1;
    if (!b.length)
        return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === undefined)
            return -1;
        if (b[i] === undefined)
            return 1;
        if (a[i] === b[i])
            continue;
        const aNum = typeof a[i] === "number";
        const bNum = typeof b[i] === "number";
        if (aNum && !bNum)
            return -1;
        if (!aNum && bNum)
            return 1;
        return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}
function compareParsedSemver(a, b) {
    return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch) || comparePrerelease(a.prerelease, b.prerelease);
}
/** Orders two semver strings; unparseable values sort below parseable ones. */
function compareSemver(a, b) {
    const left = parseSemver(a);
    const right = parseSemver(b);
    if (!left && !right)
        return 0;
    if (!left)
        return -1;
    if (!right)
        return 1;
    return Math.sign(compareParsedSemver(left, right));
}
exports.compareSemver = compareSemver;
const PARTIAL_PATTERN = /^[v=]*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parsePartial(value) {
    if (value === "" || value === "*" || value === "x" || value === "X")
        return { prerelease: [] };
    const match = PARTIAL_PATTERN.exec(value);
    if (!match)
        return undefined;
    const part = (raw) => (raw === undefined || /^[xX*]$/.test(raw) ? undefined : Number(raw));
    const major = part(match[1]);
    const minor = major === undefined ? undefined : part(match[2]);
    const patch = minor === undefined ? undefined : part(match[3]);
    return {
        major, minor, patch,
        prerelease: patch !== undefined && match[4] ? match[4].split(".").map(p => (/^\d+$/.test(p) ? Number(p) : p)) : []
    };
}
function sv(major, minor, patch, prerelease = []) {
    return { major, minor, patch, prerelease };
}
/** The lowest possible version above everything in `major.minor.patch`, i.e. `x.y.z-0`. */
function floor(major, minor, patch) {
    return sv(major, minor, patch, [0]);
}
function desugar(token) {
    const match = /^(\^|~>?|>=|<=|>|<|=)?(.*)$/.exec(token);
    if (!match)
        return undefined;
    const op = match[1] || "";
    const partial = parsePartial(match[2]);
    if (!partial)
        return undefined;
    const { major, minor, patch, prerelease } = partial;
    const any = [{ op: ">=", version: sv(0, 0, 0) }];
    switch (op) {
        case "^": {
            if (major === undefined)
                return any;
            const lower = sv(major, minor ?? 0, patch ?? 0, prerelease);
            let upper;
            if (major > 0 || minor === undefined)
                upper = floor(major + 1, 0, 0);
            else if (minor > 0 || patch === undefined)
                upper = floor(0, minor + 1, 0);
            else
                upper = floor(0, 0, patch + 1);
            return [{ op: ">=", version: lower }, { op: "<", version: upper }];
        }
        case "~":
        case "~>": {
            if (major === undefined)
                return any;
            const lower = sv(major, minor ?? 0, patch ?? 0, prerelease);
            const upper = minor === undefined ? floor(major + 1, 0, 0) : floor(major, minor + 1, 0);
            return [{ op: ">=", version: lower }, { op: "<", version: upper }];
        }
        case "":
        case "=": {
            if (major === undefined)
                return any;
            if (minor === undefined)
                return [{ op: ">=", version: sv(major, 0, 0) }, { op: "<", version: floor(major + 1, 0, 0) }];
            if (patch === undefined)
                return [{ op: ">=", version: sv(major, minor, 0) }, { op: "<", version: floor(major, minor + 1, 0) }];
            return [{ op: "=", version: sv(major, minor, patch, prerelease) }];
        }
        case ">": {
            if (major === undefined)
                return [{ op: "<", version: sv(0, 0, 0) }]; // matches nothing
            if (minor === undefined)
                return [{ op: ">=", version: sv(major + 1, 0, 0) }];
            if (patch === undefined)
                return [{ op: ">=", version: sv(major, minor + 1, 0) }];
            return [{ op: ">", version: sv(major, minor, patch, prerelease) }];
        }
        case ">=": {
            if (major === undefined)
                return any;
            return [{ op: ">=", version: sv(major, minor ?? 0, patch ?? 0, prerelease) }];
        }
        case "<": {
            if (major === undefined)
                return [{ op: "<", version: sv(0, 0, 0) }];
            if (minor === undefined)
                return [{ op: "<", version: floor(major, 0, 0) }];
            if (patch === undefined)
                return [{ op: "<", version: floor(major, minor, 0) }];
            return [{ op: "<", version: sv(major, minor, patch, prerelease) }];
        }
        case "<=": {
            if (major === undefined)
                return any;
            if (minor === undefined)
                return [{ op: "<", version: floor(major + 1, 0, 0) }];
            if (patch === undefined)
                return [{ op: "<", version: floor(major, minor + 1, 0) }];
            return [{ op: "<=", version: sv(major, minor, patch, prerelease) }];
        }
        default:
            return undefined;
    }
}
/**
 * Parses an npm range into comparator sets (one per `||` alternative).
 * Returns `undefined` for anything that is not a registry range: tags such as
 * `latest`, git URLs, tarballs, `file:`, `link:`, `workspace:` and aliases.
 */
function parseSemverRange(range) {
    const text = range.trim();
    if (text.length > 256)
        return undefined;
    const sets = [];
    for (const alternative of text.split("||")) {
        let part = alternative.trim();
        const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(part);
        if (hyphen) {
            const lower = desugar(`>=${hyphen[1]}`);
            const upper = desugar(`<=${hyphen[2]}`);
            if (!lower || !upper)
                return undefined;
            sets.push([...lower, ...upper]);
            continue;
        }
        // `>= 1.2` is written with a space often enough to matter.
        part = part.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, "$1");
        const tokens = part.split(/\s+/).filter(Boolean);
        const comparators = [];
        for (const token of tokens.length ? tokens : ["*"]) {
            const desugared = desugar(token);
            if (!desugared)
                return undefined;
            comparators.push(...desugared);
        }
        sets.push(comparators);
    }
    return sets;
}
exports.parseSemverRange = parseSemverRange;
function testComparator(version, comparator) {
    const cmp = compareParsedSemver(version, comparator.version);
    switch (comparator.op) {
        case ">=": return cmp >= 0;
        case "<=": return cmp <= 0;
        case ">": return cmp > 0;
        case "<": return cmp < 0;
        case "=": return cmp === 0;
    }
}
/**
 * True when `version` satisfies `range`. A pre-release only matches when a
 * comparator in the same set names a pre-release of the same version, which is
 * npm's own rule (so `^1.0.0` never selects `2.0.0-beta`).
 */
function satisfiesSemver(version, range) {
    const parsed = parseSemver(version);
    const sets = parseSemverRange(range);
    if (!parsed || !sets)
        return false;
    return sets.some(set => {
        if (!set.every(comparator => testComparator(parsed, comparator)))
            return false;
        if (!parsed.prerelease.length)
            return true;
        return set.some(({ version: c }) => c.prerelease.length > 0 && c.major === parsed.major && c.minor === parsed.minor && c.patch === parsed.patch);
    });
}
exports.satisfiesSemver = satisfiesSemver;
/** Highest version in `versions` that satisfies `range` (npm's "wanted"). */
function maxSatisfyingSemver(versions, range, stableOnly = true) {
    let best;
    for (const version of versions) {
        if (stableOnly && !isStableSemver(version))
            continue;
        if (!satisfiesSemver(version, range))
            continue;
        if (!best || compareSemver(version, best) > 0)
            best = version;
    }
    return best;
}
exports.maxSatisfyingSemver = maxSatisfyingSemver;
const PEP440_PATTERN = /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d*))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i;
function parsePep440(value) {
    if (typeof value !== "string")
        return undefined;
    const match = PEP440_PATTERN.exec(value);
    if (!match)
        return undefined;
    const preLabel = match[3]?.toLowerCase();
    const preRank = preLabel === undefined ? undefined : preLabel === "a" || preLabel === "alpha" ? 0 : preLabel === "b" || preLabel === "beta" ? 1 : 2;
    const post = match[5] !== undefined ? Number(match[5]) : match[6] !== undefined ? Number(match[7] || 0) : undefined;
    return {
        epoch: Number(match[1] || 0),
        release: match[2].split(".").map(Number),
        pre: preRank === undefined ? undefined : [preRank, Number(match[4] || 0)],
        post,
        dev: match[8] !== undefined ? Number(match[9] || 0) : undefined,
        local: match[10]
    };
}
exports.parsePep440 = parsePep440;
function isStablePep440(value) {
    const parsed = parsePep440(value);
    return Boolean(parsed && !parsed.pre && parsed.dev === undefined);
}
exports.isStablePep440 = isStablePep440;
function compareRelease(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff)
            return diff;
    }
    return 0;
}
function compareParsedPep440(a, b, ignoreLocal = false) {
    const base = (a.epoch - b.epoch) || compareRelease(a.release, b.release);
    if (base)
        return base;
    // A dev release of a final version (1.0.dev1) sorts before its pre-releases.
    const preKey = (v) => v.pre ? v.pre : v.post === undefined && v.dev !== undefined ? [-1, 0] : [3, 0];
    const [ap, an] = preKey(a);
    const [bp, bn] = preKey(b);
    if (ap !== bp)
        return ap - bp;
    if (an !== bn)
        return an - bn;
    const postKey = (v) => (v.post === undefined ? -1 : v.post);
    if (postKey(a) !== postKey(b))
        return postKey(a) - postKey(b);
    const devKey = (v) => (v.dev === undefined ? Number.MAX_SAFE_INTEGER : v.dev);
    if (devKey(a) !== devKey(b))
        return devKey(a) - devKey(b);
    if (ignoreLocal)
        return 0;
    return (a.local || "").localeCompare(b.local || "");
}
function comparePep440(a, b) {
    const left = parsePep440(a);
    const right = parsePep440(b);
    if (!left && !right)
        return 0;
    if (!left)
        return -1;
    if (!right)
        return 1;
    return Math.sign(compareParsedPep440(left, right));
}
exports.comparePep440 = comparePep440;
function testPep440Clause(version, raw, clause) {
    const match = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(clause.trim());
    if (!match)
        return undefined;
    const [, op, target] = match;
    if (op === "===")
        return raw.trim() === target.trim();
    if ((op === "==" || op === "!=") && target.endsWith(".*")) {
        const prefix = parsePep440(target.slice(0, -2));
        if (!prefix)
            return undefined;
        const matches = version.epoch === prefix.epoch && prefix.release.every((n, i) => (version.release[i] ?? 0) === n);
        return op === "==" ? matches : !matches;
    }
    const wanted = parsePep440(target);
    if (!wanted)
        return undefined;
    const cmp = compareParsedPep440(version, wanted, !wanted.local);
    switch (op) {
        case "==": return cmp === 0;
        case "!=": return cmp !== 0;
        case ">=": return cmp >= 0;
        case "<=": return cmp <= 0;
        case ">": return cmp > 0;
        case "<": return cmp < 0;
        case "~=": {
            if (wanted.release.length < 2 || cmp < 0)
                return false;
            const prefix = wanted.release.slice(0, -1);
            return prefix.every((n, i) => (version.release[i] ?? 0) === n);
        }
    }
    return undefined;
}
/**
 * True when `version` satisfies a PEP 440 specifier set such as `>=1.2,<2`.
 * An empty specifier matches every version. Unparseable input returns false.
 */
function satisfiesPep440(version, specifier) {
    const parsed = parsePep440(version);
    if (!parsed)
        return false;
    const clauses = specifier.split(",").map(c => c.trim()).filter(Boolean);
    for (const clause of clauses) {
        const result = testPep440Clause(parsed, version, clause);
        if (result !== true)
            return false;
    }
    return true;
}
exports.satisfiesPep440 = satisfiesPep440;
function isValidPep440Specifier(specifier) {
    return specifier.split(",").map(c => c.trim()).filter(Boolean).every(clause => {
        const match = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(clause);
        if (!match)
            return false;
        const target = match[2].endsWith(".*") ? match[2].slice(0, -2) : match[2];
        return match[1] === "===" ? /^[\w.+!-]+$/.test(target) : Boolean(parsePep440(target));
    });
}
exports.isValidPep440Specifier = isValidPep440Specifier;
function maxSatisfyingPep440(versions, specifier, stableOnly = true) {
    let best;
    for (const version of versions) {
        if (stableOnly && !isStablePep440(version))
            continue;
        if (!satisfiesPep440(version, specifier))
            continue;
        if (!best || comparePep440(version, best) > 0)
            best = version;
    }
    return best;
}
exports.maxSatisfyingPep440 = maxSatisfyingPep440;
// ---------------------------------------------------------------------------
// Maven / Gradle
// ---------------------------------------------------------------------------
const MAVEN_QUALIFIER_RANK = {
    alpha: 1, a: 1, beta: 2, b: 2, milestone: 3, m: 3, rc: 4, cr: 4, snapshot: 5,
    "": 6, ga: 6, final: 6, release: 6, sp: 7
};
function mavenItems(version) {
    const items = [];
    for (const piece of version.toLowerCase().split(/[.-]/)) {
        // `1.0RC1` separates at digit/letter transitions.
        for (const token of piece.match(/\d+|[a-z]+/g) || []) {
            items.push(/^\d+$/.test(token) ? Number(token) : token);
        }
    }
    // Trailing zeros and release markers carry no ordering information.
    while (items.length > 1 && (items[items.length - 1] === 0 || MAVEN_QUALIFIER_RANK[String(items[items.length - 1])] === 6)) {
        items.pop();
    }
    return items;
}
function compareMavenItem(a, b) {
    if (a === undefined && b === undefined)
        return 0;
    if (a === undefined)
        return typeof b === "number" ? (b === 0 ? 0 : -1) : -compareMavenItem(b, undefined);
    if (b === undefined) {
        if (typeof a === "number")
            return a === 0 ? 0 : 1;
        const rank = MAVEN_QUALIFIER_RANK[a] ?? 6.5;
        return Math.sign(rank - 6);
    }
    if (typeof a === "number" && typeof b === "number")
        return Math.sign(a - b);
    // A number is newer than any qualifier at the same position (1.0.1 > 1.0-rc1).
    if (typeof a === "number")
        return 1;
    if (typeof b === "number")
        return -1;
    const ra = MAVEN_QUALIFIER_RANK[a] ?? 6.5;
    const rb = MAVEN_QUALIFIER_RANK[b] ?? 6.5;
    if (ra !== rb)
        return Math.sign(ra - rb);
    return a === b ? 0 : a < b ? -1 : 1;
}
function compareMaven(a, b) {
    const left = mavenItems(a);
    const right = mavenItems(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const cmp = compareMavenItem(left[i], right[i]);
        if (cmp)
            return cmp;
    }
    return 0;
}
exports.compareMaven = compareMaven;
const MAVEN_UNSTABLE = /(?:^|[.\-_\d])(alpha|beta|a|b|m|milestone|rc|cr|snapshot|preview|pre|ea|dev|incubating|nightly)(?:[.\-_]?\d*)(?=$|[.\-_])/i;
function isStableMaven(version) {
    return /^\d/.test(version) && !MAVEN_UNSTABLE.test(version);
}
exports.isStableMaven = isStableMaven;
/** A trailing flavour such as Guava's `-jre` / `-android`, kept when suggesting upgrades. */
function mavenFlavour(version) {
    const match = /[.-]([a-z][a-z0-9]*)$/i.exec(version);
    if (!match)
        return "";
    const token = match[1].toLowerCase();
    return MAVEN_QUALIFIER_RANK[token] === undefined ? token : "";
}
exports.mavenFlavour = mavenFlavour;
function mavenMajor(version) {
    const match = /^(\d+)/.exec(version);
    return match ? Number(match[1]) : undefined;
}
exports.mavenMajor = mavenMajor;
//# sourceMappingURL=dependency-versions.js.map