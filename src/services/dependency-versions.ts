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

// ---------------------------------------------------------------------------
// npm semver
// ---------------------------------------------------------------------------

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

const SEMVER_PATTERN = /^\s*[v=]*\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

export function parseSemver(value: string | undefined): SemVer | undefined {
  if (typeof value !== "string") return undefined;
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return undefined;
  const numbers = [match[1], match[2], match[3]].map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n))) return undefined;
  return {
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    prerelease: match[4] ? match[4].split(".").map(part => (/^\d+$/.test(part) ? Number(part) : part)) : []
  };
}

export function isStableSemver(value: string): boolean {
  const parsed = parseSemver(value);
  return Boolean(parsed && parsed.prerelease.length === 0);
}

function comparePrerelease(a: Array<string | number>, b: Array<string | number>): number {
  // A release sorts above any of its pre-releases.
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const aNum = typeof a[i] === "number";
    const bNum = typeof b[i] === "number";
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function compareParsedSemver(a: SemVer, b: SemVer): number {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch) || comparePrerelease(a.prerelease, b.prerelease);
}

/** Orders two semver strings; unparseable values sort below parseable ones. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return Math.sign(compareParsedSemver(left, right));
}

type Operator = ">=" | "<=" | ">" | "<" | "=";
interface Comparator { op: Operator; version: SemVer }

/** A partial version such as `1`, `1.2`, `1.x` or `*`. */
interface Partial { major?: number; minor?: number; patch?: number; prerelease: Array<string | number> }

const PARTIAL_PATTERN = /^[v=]*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parsePartial(value: string): Partial | undefined {
  if (value === "" || value === "*" || value === "x" || value === "X") return { prerelease: [] };
  const match = PARTIAL_PATTERN.exec(value);
  if (!match) return undefined;
  const part = (raw: string | undefined) => (raw === undefined || /^[xX*]$/.test(raw) ? undefined : Number(raw));
  const major = part(match[1]);
  const minor = major === undefined ? undefined : part(match[2]);
  const patch = minor === undefined ? undefined : part(match[3]);
  return {
    major, minor, patch,
    prerelease: patch !== undefined && match[4] ? match[4].split(".").map(p => (/^\d+$/.test(p) ? Number(p) : p)) : []
  };
}

function sv(major: number, minor: number, patch: number, prerelease: Array<string | number> = []): SemVer {
  return { major, minor, patch, prerelease };
}

/** The lowest possible version above everything in `major.minor.patch`, i.e. `x.y.z-0`. */
function floor(major: number, minor: number, patch: number): SemVer {
  return sv(major, minor, patch, [0]);
}

function desugar(token: string): Comparator[] | undefined {
  const match = /^(\^|~>?|>=|<=|>|<|=)?(.*)$/.exec(token);
  if (!match) return undefined;
  const op = match[1] || "";
  const partial = parsePartial(match[2]);
  if (!partial) return undefined;
  const { major, minor, patch, prerelease } = partial;
  const any: Comparator[] = [{ op: ">=", version: sv(0, 0, 0) }];

  switch (op) {
    case "^": {
      if (major === undefined) return any;
      const lower = sv(major, minor ?? 0, patch ?? 0, prerelease);
      let upper: SemVer;
      if (major > 0 || minor === undefined) upper = floor(major + 1, 0, 0);
      else if (minor > 0 || patch === undefined) upper = floor(0, minor + 1, 0);
      else upper = floor(0, 0, patch + 1);
      return [{ op: ">=", version: lower }, { op: "<", version: upper }];
    }
    case "~":
    case "~>": {
      if (major === undefined) return any;
      const lower = sv(major, minor ?? 0, patch ?? 0, prerelease);
      const upper = minor === undefined ? floor(major + 1, 0, 0) : floor(major, minor + 1, 0);
      return [{ op: ">=", version: lower }, { op: "<", version: upper }];
    }
    case "":
    case "=": {
      if (major === undefined) return any;
      if (minor === undefined) return [{ op: ">=", version: sv(major, 0, 0) }, { op: "<", version: floor(major + 1, 0, 0) }];
      if (patch === undefined) return [{ op: ">=", version: sv(major, minor, 0) }, { op: "<", version: floor(major, minor + 1, 0) }];
      return [{ op: "=", version: sv(major, minor, patch, prerelease) }];
    }
    case ">": {
      if (major === undefined) return [{ op: "<", version: sv(0, 0, 0) }]; // matches nothing
      if (minor === undefined) return [{ op: ">=", version: sv(major + 1, 0, 0) }];
      if (patch === undefined) return [{ op: ">=", version: sv(major, minor + 1, 0) }];
      return [{ op: ">", version: sv(major, minor, patch, prerelease) }];
    }
    case ">=": {
      if (major === undefined) return any;
      return [{ op: ">=", version: sv(major, minor ?? 0, patch ?? 0, prerelease) }];
    }
    case "<": {
      if (major === undefined) return [{ op: "<", version: sv(0, 0, 0) }];
      if (minor === undefined) return [{ op: "<", version: floor(major, 0, 0) }];
      if (patch === undefined) return [{ op: "<", version: floor(major, minor, 0) }];
      return [{ op: "<", version: sv(major, minor, patch, prerelease) }];
    }
    case "<=": {
      if (major === undefined) return any;
      if (minor === undefined) return [{ op: "<", version: floor(major + 1, 0, 0) }];
      if (patch === undefined) return [{ op: "<", version: floor(major, minor + 1, 0) }];
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
export function parseSemverRange(range: string): Comparator[][] | undefined {
  const text = range.trim();
  if (text.length > 256) return undefined;
  const sets: Comparator[][] = [];
  for (const alternative of text.split("||")) {
    let part = alternative.trim();
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(part);
    if (hyphen) {
      const lower = desugar(`>=${hyphen[1]}`);
      const upper = desugar(`<=${hyphen[2]}`);
      if (!lower || !upper) return undefined;
      sets.push([...lower, ...upper]);
      continue;
    }
    // `>= 1.2` is written with a space often enough to matter.
    part = part.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, "$1");
    const tokens = part.split(/\s+/).filter(Boolean);
    const comparators: Comparator[] = [];
    for (const token of tokens.length ? tokens : ["*"]) {
      const desugared = desugar(token);
      if (!desugared) return undefined;
      comparators.push(...desugared);
    }
    sets.push(comparators);
  }
  return sets;
}

function testComparator(version: SemVer, comparator: Comparator): boolean {
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
export function satisfiesSemver(version: string, range: string): boolean {
  const parsed = parseSemver(version);
  const sets = parseSemverRange(range);
  if (!parsed || !sets) return false;
  return sets.some(set => {
    if (!set.every(comparator => testComparator(parsed, comparator))) return false;
    if (!parsed.prerelease.length) return true;
    return set.some(({ version: c }) =>
      c.prerelease.length > 0 && c.major === parsed.major && c.minor === parsed.minor && c.patch === parsed.patch);
  });
}

/** Highest version in `versions` that satisfies `range` (npm's "wanted"). */
export function maxSatisfyingSemver(versions: string[], range: string, stableOnly = true): string | undefined {
  let best: string | undefined;
  for (const version of versions) {
    if (stableOnly && !isStableSemver(version)) continue;
    if (!satisfiesSemver(version, range)) continue;
    if (!best || compareSemver(version, best) > 0) best = version;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Python PEP 440
// ---------------------------------------------------------------------------

export interface Pep440 {
  epoch: number;
  release: number[];
  pre?: [number, number];
  post?: number;
  dev?: number;
  local?: string;
}

const PEP440_PATTERN = /^\s*v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d*))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i;

export function parsePep440(value: string | undefined): Pep440 | undefined {
  if (typeof value !== "string") return undefined;
  const match = PEP440_PATTERN.exec(value);
  if (!match) return undefined;
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

export function isStablePep440(value: string): boolean {
  const parsed = parsePep440(value);
  return Boolean(parsed && !parsed.pre && parsed.dev === undefined);
}

function compareRelease(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function compareParsedPep440(a: Pep440, b: Pep440, ignoreLocal = false): number {
  const base = (a.epoch - b.epoch) || compareRelease(a.release, b.release);
  if (base) return base;
  // A dev release of a final version (1.0.dev1) sorts before its pre-releases.
  const preKey = (v: Pep440): [number, number] =>
    v.pre ? v.pre : v.post === undefined && v.dev !== undefined ? [-1, 0] : [3, 0];
  const [ap, an] = preKey(a);
  const [bp, bn] = preKey(b);
  if (ap !== bp) return ap - bp;
  if (an !== bn) return an - bn;
  const postKey = (v: Pep440) => (v.post === undefined ? -1 : v.post);
  if (postKey(a) !== postKey(b)) return postKey(a) - postKey(b);
  const devKey = (v: Pep440) => (v.dev === undefined ? Number.MAX_SAFE_INTEGER : v.dev);
  if (devKey(a) !== devKey(b)) return devKey(a) - devKey(b);
  if (ignoreLocal) return 0;
  return (a.local || "").localeCompare(b.local || "");
}

export function comparePep440(a: string, b: string): number {
  const left = parsePep440(a);
  const right = parsePep440(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return Math.sign(compareParsedPep440(left, right));
}

function testPep440Clause(version: Pep440, raw: string, clause: string): boolean | undefined {
  const match = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(clause.trim());
  if (!match) return undefined;
  const [, op, target] = match;
  if (op === "===") return raw.trim() === target.trim();
  if ((op === "==" || op === "!=") && target.endsWith(".*")) {
    const prefix = parsePep440(target.slice(0, -2));
    if (!prefix) return undefined;
    const matches = version.epoch === prefix.epoch && prefix.release.every((n, i) => (version.release[i] ?? 0) === n);
    return op === "==" ? matches : !matches;
  }
  const wanted = parsePep440(target);
  if (!wanted) return undefined;
  const cmp = compareParsedPep440(version, wanted, !wanted.local);
  switch (op) {
    case "==": return cmp === 0;
    case "!=": return cmp !== 0;
    case ">=": return cmp >= 0;
    case "<=": return cmp <= 0;
    case ">": return cmp > 0;
    case "<": return cmp < 0;
    case "~=": {
      if (wanted.release.length < 2 || cmp < 0) return false;
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
export function satisfiesPep440(version: string, specifier: string): boolean {
  const parsed = parsePep440(version);
  if (!parsed) return false;
  const clauses = specifier.split(",").map(c => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const result = testPep440Clause(parsed, version, clause);
    if (result !== true) return false;
  }
  return true;
}

export function isValidPep440Specifier(specifier: string): boolean {
  return specifier.split(",").map(c => c.trim()).filter(Boolean).every(clause => {
    const match = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(clause);
    if (!match) return false;
    const target = match[2].endsWith(".*") ? match[2].slice(0, -2) : match[2];
    return match[1] === "===" ? /^[\w.+!-]+$/.test(target) : Boolean(parsePep440(target));
  });
}

export function maxSatisfyingPep440(versions: string[], specifier: string, stableOnly = true): string | undefined {
  let best: string | undefined;
  for (const version of versions) {
    if (stableOnly && !isStablePep440(version)) continue;
    if (!satisfiesPep440(version, specifier)) continue;
    if (!best || comparePep440(version, best) > 0) best = version;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Maven / Gradle
// ---------------------------------------------------------------------------

const MAVEN_QUALIFIER_RANK: Record<string, number> = {
  alpha: 1, a: 1, beta: 2, b: 2, milestone: 3, m: 3, rc: 4, cr: 4, snapshot: 5,
  "": 6, ga: 6, final: 6, release: 6, sp: 7
};

type MavenItem = number | string;

function mavenItems(version: string): MavenItem[] {
  const items: MavenItem[] = [];
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

function compareMavenItem(a: MavenItem | undefined, b: MavenItem | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return typeof b === "number" ? (b === 0 ? 0 : -1) : -compareMavenItem(b, undefined);
  if (b === undefined) {
    if (typeof a === "number") return a === 0 ? 0 : 1;
    const rank = MAVEN_QUALIFIER_RANK[a] ?? 6.5;
    return Math.sign(rank - 6);
  }
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  // A number is newer than any qualifier at the same position (1.0.1 > 1.0-rc1).
  if (typeof a === "number") return 1;
  if (typeof b === "number") return -1;
  const ra = MAVEN_QUALIFIER_RANK[a] ?? 6.5;
  const rb = MAVEN_QUALIFIER_RANK[b] ?? 6.5;
  if (ra !== rb) return Math.sign(ra - rb);
  return a === b ? 0 : a < b ? -1 : 1;
}

export function compareMaven(a: string, b: string): number {
  const left = mavenItems(a);
  const right = mavenItems(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const cmp = compareMavenItem(left[i], right[i]);
    if (cmp) return cmp;
  }
  return 0;
}

const MAVEN_UNSTABLE = /(?:^|[.\-_\d])(alpha|beta|a|b|m|milestone|rc|cr|snapshot|preview|pre|ea|dev|incubating|nightly)(?:[.\-_]?\d*)(?=$|[.\-_])/i;

export function isStableMaven(version: string): boolean {
  return /^\d/.test(version) && !MAVEN_UNSTABLE.test(version);
}

/** A trailing flavour such as Guava's `-jre` / `-android`, kept when suggesting upgrades. */
export function mavenFlavour(version: string): string {
  const match = /[.-]([a-z][a-z0-9]*)$/i.exec(version);
  if (!match) return "";
  const token = match[1].toLowerCase();
  return MAVEN_QUALIFIER_RANK[token] === undefined ? token : "";
}

export function mavenMajor(version: string): number | undefined {
  const match = /^(\d+)/.exec(version);
  return match ? Number(match[1]) : undefined;
}
