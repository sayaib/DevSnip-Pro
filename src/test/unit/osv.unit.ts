import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { suite, test } from "./run-unit-tests";
import { FetchLike, mapLimit, MAX_BATCH, OsvCache, OsvClient, OsvError, OsvRecord, retryAfterMs, sanitizeRecord, validateQuery } from "../../osv/client";
import { requirementIncludes } from "../../osv/workspace";
import { detectFileType, fileTypeById, FILE_ADAPTERS, parseDependencyFile, parsePnpmKey, poetryToPep440, projectDirOf, swiftRequirement, swiftUrlName, DEPENDENCY_FILE_GLOB } from "../../osv/parsers";
import { isSafeToken, remediationFor } from "../../osv/remediation";
import { reportHtml, reportJson } from "../../osv/report";
import { runScan, ScanFile } from "../../osv/scan";
import { cvss2BaseScore, cvss3BaseScore, labelSeverity, ratingV3, resolveSeverity, roundUp } from "../../osv/severity";
import { parseToml, TomlError, lineOf } from "../../osv/toml";
import type { Occurrence, ParsedDependency, ScanResult } from "../../osv/types";
import {
  compareGeneric, compareRubyGems, comparatorFor, declaredSpans, describeInterval, inInterval, intervalsOf, isComparable, spanOverlaps, spansFromInterval
} from "../../osv/versions";
import { renderOsvPage } from "../../osv/page";
import { NAV } from "../../toolkits/layout";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function deps(file: string, text: string): ParsedDependency[] {
  const parsed = parseDependencyFile(file, text);
  assert.ok(parsed, `${file} is recognised`);
  assert.strictEqual(parsed!.error, undefined, `${file} parses: ${parsed!.error}`);
  return parsed!.dependencies;
}

function byName(list: ParsedDependency[], name: string): ParsedDependency {
  const found = list.find(d => d.name === name);
  assert.ok(found, `${name} is listed (got ${list.map(d => d.name).join(", ")})`);
  return found!;
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | Error | "hang";

/** A fake fetch: each call takes the next scripted reply for its path, or a default. */
function scriptedFetch(script: Record<string, Reply[]>, fallback?: (url: string, body: any) => Reply): { fetch: FetchLike; calls: Array<{ url: string; body: any }> } {
  const calls: Array<{ url: string; body: any }> = [];
  const fetch: FetchLike = (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const key = Object.keys(script).find(k => url.endsWith(k));
    const reply = key && script[key].length ? script[key].shift()! : fallback ? fallback(url, body) : { status: 500, body: {} };
    if (reply === "hang") {
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null },
      text: async () => (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body))
    });
  };
  return { fetch, calls };
}

const noSleep = async (_ms: number, signal?: AbortSignal) => { if (signal?.aborted) throw new OsvError("cancelled", "cancelled"); };

/**
 * A small OSV database: answers querybatch the way api.osv.dev does (by package,
 * and by version when one is given) using each record's ranges or version list.
 */
class FakeOsv {
  readonly records = new Map<string, OsvRecord>();
  requests = 0;
  batches: number[] = [];
  failBatches = 0;
  /** Batches for which this returns true always fail (HTTP 503). */
  failWhen?: (queries: Array<{ package: { name: string } }>) => boolean;
  /** Single /v1/query requests for which this returns true fail (HTTP 503). */
  failQuery?: (name: string) => boolean;
  singleQueries = 0;
  /** Splits each answer into pages of this many advisories (exercising page tokens). */
  pageSize = Infinity;
  failVulns = new Set<string>();
  /** Versions OSV considers affected, per "ecosystem|name". */
  private affected = new Map<string, Array<{ id: string; versions?: string[]; all?: boolean }>>();

  add(record: OsvRecord, matches: Array<{ ecosystem: string; name: string; versions?: string[] }>): this {
    this.records.set(record.id, record);
    for (const m of matches) {
      const key = `${m.ecosystem}|${m.ecosystem === "PyPI" ? m.name.toLowerCase() : m.name}`;
      this.affected.set(key, [...(this.affected.get(key) ?? []), { id: record.id, versions: m.versions, all: !m.versions }]);
    }
    return this;
  }

  fetch: FetchLike = async (url, init) => {
    this.requests++;
    const respond = (status: number, body: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    const answer = (q: any) => {
      const key = `${q.package.ecosystem}|${q.package.ecosystem === "PyPI" ? q.package.name.toLowerCase() : q.package.name}`;
      const hits = (this.affected.get(key) ?? []).filter(e => q.version === undefined || e.all || e.versions!.includes(q.version));
      const start = q.page_token ? Number(q.page_token) : 0;
      const page = hits.slice(start, start + this.pageSize);
      const next = start + this.pageSize < hits.length ? String(start + this.pageSize) : undefined;
      return { ...(page.length ? { vulns: page.map(h => ({ id: h.id, modified: this.records.get(h.id)!.modified })) } : {}), ...(next ? { next_page_token: next } : {}) };
    };
    if (url.endsWith("/v1/querybatch")) {
      const { queries } = JSON.parse(init.body!);
      this.batches.push(queries.length);
      if (this.failBatches > 0) { this.failBatches--; return respond(503, { message: "unavailable" }); }
      if (this.failWhen?.(queries)) return respond(503, { message: "unavailable" });
      if (queries.length > MAX_BATCH) return respond(400, { message: "too many" });
      return respond(200, { results: queries.map(answer) });
    }
    if (url.endsWith("/v1/query")) {
      this.singleQueries++;
      const q = JSON.parse(init.body!);
      if (this.failQuery?.(q.package.name)) return respond(503, { message: "unavailable" });
      return respond(200, answer(q));
    }
    const match = /\/v1\/vulns\/(.+)$/.exec(url);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (this.failVulns.has(id)) return respond(500, { message: "boom" });
      const record = this.records.get(id);
      return record ? respond(200, record) : respond(404, { code: 5, message: "Vulnerability not found" });
    }
    return respond(404, {});
  };
}

function client(fake: FakeOsv): OsvClient {
  return new OsvClient({ fetch: fake.fetch, sleep: noSleep, retries: 1, random: () => 0.5 });
}

function scan(files: ScanFile[], fake: FakeOsv, extra: Partial<Parameters<typeof runScan>[1]> = {}): Promise<ScanResult> {
  return runScan(files, { client: client(fake), cache: new OsvCache(), workspace: { name: "fixture", folders: ["fixture"] }, source: "workspace", toolVersion: "test", ...extra });
}

const LODASH_REDOS: OsvRecord = {
  id: "GHSA-29mw-wpgm-hmr9", modified: "2025-09-29T21:12:31Z", published: "2022-01-06T20:30:46Z",
  summary: "Regular Expression Denial of Service (ReDoS) in lodash", details: "lodash prior to 4.17.21 is vulnerable to ReDoS.",
  aliases: ["CVE-2020-28500"],
  database_specific: { severity: "MODERATE", cwe_ids: ["CWE-1333"] },
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L" }],
  affected: [
    { package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "4.0.0" }, { fixed: "4.17.21" }] }] },
    { package: { name: "lodash-es", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "4.0.0" }, { fixed: "4.17.21" }] }] }
  ],
  references: [{ type: "ADVISORY", url: "https://nvd.nist.gov/vuln/detail/CVE-2020-28500" }, { type: "WEB", url: "javascript:alert(1)" }]
};

const LODASH_INJECTION: OsvRecord = {
  id: "GHSA-35jh-r3h4-6jhm", modified: "2025-01-01T00:00:00Z", published: "2021-05-06T00:00:00Z",
  summary: "Command Injection in lodash", aliases: ["CVE-2021-23337"],
  database_specific: { severity: "HIGH" },
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H" }],
  affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
  references: []
};

const DJANGO_GHSA: OsvRecord = {
  id: "GHSA-2gwj-7jmv-h26r", modified: "2024-01-01T00:00:00Z", published: "2022-04-12T00:00:00Z",
  summary: "SQL Injection in Django", aliases: ["CVE-2022-28346", "PYSEC-2022-190"],
  database_specific: { severity: "CRITICAL" },
  affected: [{ package: { name: "Django", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "3.2" }, { fixed: "3.2.13" }, { introduced: "4.0" }, { fixed: "4.0.4" }] }] }],
  references: [{ type: "ADVISORY", url: "https://github.com/advisories/GHSA-2gwj-7jmv-h26r" }]
};

const DJANGO_PYSEC: OsvRecord = {
  id: "PYSEC-2022-190", modified: "2023-01-01T00:00:00Z", published: "2022-04-12T00:00:00Z",
  details: "An issue was discovered in Django 2.2 before 2.2.28, 3.2 before 3.2.13, and 4.0 before 4.0.4.",
  aliases: ["CVE-2022-28346", "GHSA-2gwj-7jmv-h26r"],
  affected: [{ package: { name: "django", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "3.2" }, { fixed: "3.2.13" }] }], versions: ["3.2", "3.2.1"] }],
  references: [{ type: "WEB", url: "https://www.djangoproject.com/weblog/2022/apr/11/security-releases/" }]
};

const PKG_LOCK = JSON.stringify({
  name: "web", lockfileVersion: 3, requires: true,
  packages: {
    "": { name: "web", dependencies: { lodash: "^4.17.0", express: "^4.18.0" }, devDependencies: { jest: "^29.0.0" } },
    "node_modules/lodash": { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz" },
    "node_modules/express": { version: "4.18.2", resolved: "https://registry.npmjs.org/express/-/express-4.18.2.tgz" },
    "node_modules/jest": { version: "29.7.0", resolved: "https://registry.npmjs.org/jest/-/jest-29.7.0.tgz", dev: true },
    "node_modules/express/node_modules/qs": { version: "6.11.0", resolved: "https://registry.npmjs.org/qs/-/qs-6.11.0.tgz" },
    "node_modules/my-git-dep": { version: "1.0.0", resolved: "git+ssh://git@github.com/me/dep.git#abc" },
    "packages/ui": { name: "@acme/ui", version: "1.0.0", dependencies: { react: "^18.0.0" } },
    "node_modules/@acme/ui": { resolved: "packages/ui", link: true },
    "node_modules/react": { version: "18.2.0", resolved: "https://registry.npmjs.org/react/-/react-18.2.0.tgz" }
  }
}, null, 2);

/* ------------------------------------------------------------------ *
 * TOML
 * ------------------------------------------------------------------ */

suite("osv: TOML reader", () => {
  test("reads tables, arrays of tables, dotted and quoted keys, all string forms and inline tables", () => {
    const doc = parseToml([
      "# comment",
      "title = \"a \\\"quoted\\\" \\u00e9\" # trailing",
      "lit = 'C:\\path'",
      "multi = \"\"\"",
      "line1",
      "line2\"\"\"",
      "ml = '''x'y'''",
      "num = 1_000",
      "flt = 3.5",
      "yes = true",
      "date = 2024-01-02T03:04:05Z",
      "arr = [ 1, 2,",
      "  3, ] # trailing comma",
      "[server.\"http\".opts]",
      "inline = { version = \"1.2\", features = [\"a\", \"b\"] }",
      "a.b.c = 'dotted'",
      "[[package]]",
      "name = \"one\"",
      "[package.source]",
      "type = \"git\"",
      "",
      "[[package]]",
      "name = \"two\""
    ].join("\n")) as any;
    assert.strictEqual(doc.title, "a \"quoted\" é");
    assert.strictEqual(doc.lit, "C:\\path");
    assert.strictEqual(doc.multi, "line1\nline2");
    assert.strictEqual(doc.ml, "x'y");
    assert.strictEqual(doc.num, 1000);
    assert.strictEqual(doc.flt, 3.5);
    assert.strictEqual(doc.yes, true);
    assert.strictEqual(doc.date, "2024-01-02T03:04:05Z");
    assert.deepStrictEqual(doc.arr, [1, 2, 3]);
    assert.deepStrictEqual({ ...doc.server.http.opts.inline, features: [...doc.server.http.opts.inline.features] }, { version: "1.2", features: ["a", "b"] });
    assert.strictEqual(doc.server.http.opts.a.b.c, "dotted");
    assert.strictEqual(doc.package.length, 2);
    assert.strictEqual(doc.package[0].source.type, "git", "a sub-table attaches to the last array element");
    assert.strictEqual(lineOf(doc.package[1]), 22, "array elements remember their line");
  });

  test("rejects malformed TOML with a line number instead of guessing", () => {
    assert.throws(() => parseToml("a = \"unterminated\nb = 1"), (e: unknown) => e instanceof TomlError && e.line === 1);
    assert.throws(() => parseToml("a = 1\na = 2"), /Duplicate key/);
    assert.throws(() => parseToml("[x\ny = 1"), TomlError);
  });
});

/* ------------------------------------------------------------------ *
 * Parsers
 * ------------------------------------------------------------------ */

suite("osv: dependency file detection", () => {
  test("recognises every supported file and nothing else", () => {
    const yes = ["package-lock.json", "a/yarn.lock", "pnpm-lock.yaml", "bun.lock", "requirements.txt", "requirements-dev.txt", "reqs/test-requirements.txt",
      "requirements/base.txt", "Pipfile.lock", "poetry.lock", "uv.lock", "pdm.lock", "pyproject.toml", "pom.xml", "build.gradle.kts", "gradle.lockfile",
      "gradle/libs.versions.toml", "go.mod", "Cargo.lock", "Cargo.toml", "Gemfile.lock", "gems.locked", "packages.lock.json", "app/obj/project.assets.json",
      "App.csproj", "Lib.fsproj", "packages.config", "composer.lock", "pubspec.lock", "mix.lock", "Package.resolved", "renv.lock", "gradle/dependency-locks/compile.lockfile"];
    for (const file of yes) assert.ok(detectFileType(file), file);
    for (const file of ["readme.md", "package.json5", "project.assets.json", "notes.txt", "go.sum", "random.lockfile", "tsconfig.json"]) assert.strictEqual(detectFileType(file), undefined, file);
    assert.match(DEPENDENCY_FILE_GLOB, /^\*\*\/\{.*package-lock\.json.*\}$/);
  });

  test("project directories account for files that live below the project root", () => {
    assert.strictEqual(projectDirOf("svc/obj/project.assets.json", detectFileType("svc/obj/project.assets.json")!), "svc");
    assert.strictEqual(projectDirOf("android/gradle/libs.versions.toml", detectFileType("android/gradle/libs.versions.toml")!), "android");
    assert.strictEqual(projectDirOf("ios/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved", detectFileType("ios/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved")!), "ios");
    assert.strictEqual(projectDirOf("package-lock.json", detectFileType("package-lock.json")!), "");
  });
});

suite("osv: npm parsers", () => {
  test("package-lock v3: exact versions, transitive and dev flags, direct names, links and git sources", () => {
    const list = deps("package-lock.json", PKG_LOCK);
    const lodash = byName(list, "lodash");
    assert.deepStrictEqual([lodash.version, lodash.direct, lodash.scope, lodash.resolution], ["4.17.20", true, "production", "lockfile"]);
    assert.ok(lodash.line && lodash.line > 1, "points at the lockfile line");
    assert.strictEqual(byName(list, "jest").scope, "development");
    assert.strictEqual(byName(list, "qs").direct, false, "nested node_modules are transitive");
    assert.strictEqual(byName(list, "react").direct, true, "a workspace member's dependency is direct");
    const git = byName(list, "my-git-dep");
    assert.strictEqual(git.registry, false);
    assert.match(git.note!, /git\+ssh/);
    assert.ok(!list.some(d => d.name === "@acme/ui"), "workspace links are not registry packages");
  });

  test("package-lock v1 nests dependencies", () => {
    const list = deps("npm-shrinkwrap.json", JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: "1.0.0", dependencies: { b: { version: "2.0.0", dev: true } } }, c: { version: "github:x/y#abc" } } }));
    assert.strictEqual(byName(list, "a").version, "1.0.0");
    assert.deepStrictEqual([byName(list, "b").version, byName(list, "b").direct, byName(list, "b").scope], ["2.0.0", false, "development"]);
    assert.strictEqual(byName(list, "c").registry, false);
  });

  test("yarn.lock v1: multi-range headers, scoped names, aliases, git and file sources", () => {
    const text = [
      "# yarn lockfile v1", "",
      "\"@babel/code-frame@^7.0.0\", \"@babel/code-frame@^7.10.4\":", "  version \"7.12.13\"", "  resolved \"https://registry.yarnpkg.com/@babel/code-frame/-/code-frame-7.12.13.tgz#abc\"", "",
      "lodash@^4.17.15:", "  version \"4.17.20\"", "  resolved \"https://registry.yarnpkg.com/lodash/-/lodash-4.17.20.tgz\"", "",
      "my-lodash@npm:lodash@^4.17.0:", "  version \"4.17.19\"", "  resolved \"https://registry.yarnpkg.com/lodash/-/lodash-4.17.19.tgz\"", "",
      "\"dep@github:me/dep\":", "  version \"1.0.0\"", "  resolved \"https://codeload.github.com/me/dep/tar.gz/abc\"", "",
      "local@file:../local:", "  version \"0.0.1\"", "",
      "private@^1.0.0:", "  version \"1.0.0\"", "  resolved \"https://npm.internal.example/private/-/private-1.0.0.tgz\""
    ].join("\n");
    const list = deps("yarn.lock", text);
    assert.strictEqual(byName(list, "@babel/code-frame").version, "7.12.13");
    assert.strictEqual(list.filter(d => d.name === "lodash").map(d => d.version).sort().join(), "4.17.19,4.17.20", "the alias resolves to the real package");
    assert.strictEqual(byName(list, "dep").registry, false);
    assert.strictEqual(byName(list, "local").registry, false);
    assert.strictEqual(byName(list, "private").registry, undefined, "a private registry mirror still serves registry packages");
  });

  test("yarn.lock berry: resolutions, workspaces and patches", () => {
    const text = [
      "__metadata:", "  version: 6", "",
      "\"lodash@npm:^4.17.21\":", "  version: 4.17.21", "  resolution: \"lodash@npm:4.17.21\"", "",
      "\"web@workspace:.\":", "  version: 0.0.0-use.local", "  resolution: \"web@workspace:.\"", "",
      "\"resolve@patch:resolve@npm%3A^1.22.0#~builtin<compat/resolve>\":", "  version: 1.22.1", "  resolution: \"resolve@patch:resolve@npm%3A1.22.1#~builtin<compat/resolve>::version=1.22.1\"", "",
      "\"gitdep@https://github.com/me/x.git\":", "  version: 2.0.0", "  resolution: \"gitdep@https://github.com/me/x.git#commit=abc\""
    ].join("\n");
    const list = deps("yarn.lock", text);
    assert.strictEqual(byName(list, "lodash").version, "4.17.21");
    assert.ok(!list.some(d => d.name === "web"), "workspace members are skipped");
    assert.match(byName(list, "resolve").note!, /patch/);
    assert.strictEqual(byName(list, "resolve").registry, undefined);
    assert.strictEqual(byName(list, "gitdep").registry, false);
  });

  test("pnpm keys across lockfile versions 5, 6 and 9", () => {
    assert.deepStrictEqual(parsePnpmKey("/lodash/4.17.21"), { name: "lodash", version: "4.17.21" });
    assert.deepStrictEqual(parsePnpmKey("/@babel/core/7.0.0_supports-color@5.5.0"), { name: "@babel/core", version: "7.0.0" });
    assert.deepStrictEqual(parsePnpmKey("/foo/1.0.0_react@17.0.2"), { name: "foo", version: "1.0.0" });
    assert.deepStrictEqual(parsePnpmKey("/lodash@4.17.21"), { name: "lodash", version: "4.17.21" });
    assert.deepStrictEqual(parsePnpmKey("/@types/node@20.1.0"), { name: "@types/node", version: "20.1.0" });
    assert.deepStrictEqual(parsePnpmKey("react-dom@18.2.0(react@18.2.0)"), { name: "react-dom", version: "18.2.0" });
    assert.deepStrictEqual(parsePnpmKey("@scope/pkg@1.0.0(@types/react@18.0.0)"), { name: "@scope/pkg", version: "1.0.0" });
  });

  test("pnpm-lock.yaml v9 with importers and a git package", () => {
    const text = [
      "lockfileVersion: '9.0'", "",
      "importers:", "  .:", "    dependencies:", "      lodash:", "        specifier: ^4.17.0", "        version: 4.17.20", "    devDependencies:", "      vitest:", "        specifier: ^1.0.0", "        version: 1.0.0", "",
      "packages:", "  lodash@4.17.20:", "    resolution: {integrity: sha512-abc}", "  vitest@1.0.0:", "    resolution: {integrity: sha512-def}",
      "  tinypool@0.8.0:", "    resolution: {integrity: sha512-ghi}",
      "  mylib@https://codeload.github.com/me/mylib/tar.gz/abc:", "    resolution: {tarball: https://codeload.github.com/me/mylib/tar.gz/abc}", "    version: 1.0.0"
    ].join("\n");
    const list = deps("pnpm-lock.yaml", text);
    assert.deepStrictEqual([byName(list, "lodash").version, byName(list, "lodash").scope], ["4.17.20", "production"]);
    assert.strictEqual(byName(list, "vitest").scope, "development");
    assert.strictEqual(byName(list, "tinypool").direct, false);
    assert.strictEqual(byName(list, "mylib").registry, false);
  });

  test("bun.lock (JSONC with trailing commas)", () => {
    const text = `{
  // bun lockfile
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "app", "dependencies": { "lodash": "^4.17.0", }, "devDependencies": { "typescript": "^5" }, }, },
  "packages": {
    "lodash": ["lodash@4.17.20", "", {}, "sha512-x"],
    "typescript": ["typescript@5.4.0", "", {}, "sha512-y"],
    "app": ["app@workspace:."],
    "gitdep": ["gitdep@github:me/dep#abc", {}],
  },
}`;
    const list = deps("bun.lock", text);
    assert.strictEqual(byName(list, "lodash").version, "4.17.20");
    assert.strictEqual(byName(list, "typescript").scope, "development");
    assert.ok(!list.some(d => d.name === "app"));
    assert.strictEqual(byName(list, "gitdep").registry, false);
    const binary = parseDependencyFile("bun.lockb", "\u0000binary");
    assert.match(binary!.error!, /save-text-lockfile/);
  });

  test("package.json: exact pins are versions, ranges stay ranges, git and workspace specs are not checked", () => {
    const list = deps("package.json", JSON.stringify({ dependencies: { a: "1.2.3", b: "^1.0.0", c: "=2.0.0", d: "github:me/d", e: "workspace:*" }, devDependencies: { f: "latest" } }));
    assert.deepStrictEqual([byName(list, "a").version, byName(list, "a").resolution], ["1.2.3", "pinned"]);
    assert.deepStrictEqual([byName(list, "b").version, byName(list, "b").resolution, byName(list, "b").spec], [undefined, "range", "^1.0.0"]);
    assert.strictEqual(byName(list, "c").version, "2.0.0");
    assert.strictEqual(byName(list, "d").registry, false);
    assert.strictEqual(byName(list, "e").registry, false);
    assert.strictEqual(byName(list, "f").scope, "development");
    assert.match(parseDependencyFile("package.json", "{ not json")!.error!, /could not be parsed/);
  });
});

suite("osv: Python parsers", () => {
  test("requirements.txt: pins, ranges, hashes, markers, options and URLs", () => {
    const text = [
      "# comment", "-r base.txt", "--index-url https://pypi.org/simple", "Django==3.2.0 \\", "    --hash=sha256:abc",
      "requests>=2.20,<3 ; python_version >= '3.8'", "PyYAML===5.3", "flask", "-e git+https://github.com/me/x.git#egg=x",
      "mypkg @ https://example.com/mypkg-1.0.tar.gz", "./local/pkg", "Typing_Extensions==4.0.0", "numpy==1.*"
    ].join("\n");
    const parsed = parseDependencyFile("requirements.txt", text)!;
    const list = parsed.dependencies;
    assert.deepStrictEqual([byName(list, "django").version, byName(list, "django").resolution], ["3.2.0", "pinned"]);
    assert.deepStrictEqual([byName(list, "requests").version, byName(list, "requests").spec], [undefined, ">=2.20,<3"]);
    assert.strictEqual(byName(list, "pyyaml").version, "5.3");
    assert.strictEqual(byName(list, "flask").resolution, "range");
    assert.strictEqual(byName(list, "typing-extensions").version, "4.0.0", "names are PEP 503 normalised");
    assert.strictEqual(byName(list, "numpy").version, undefined, "wildcards are not pins");
    assert.strictEqual(byName(list, "mypkg").registry, false);
    assert.ok(byName(list, "django").line === 4);
    assert.ok(parsed.warnings.some(w => /-r/.test(w)) && parsed.warnings.some(w => /-e/.test(w)));
    assert.strictEqual(parseDependencyFile("requirements-dev.txt", "pytest==7.0.0")!.dependencies[0].scope, "development");
  });

  test("Pipfile.lock, poetry.lock, uv.lock and pdm.lock", () => {
    const pipfile = deps("Pipfile.lock", JSON.stringify({ default: { django: { version: "==3.2.0" }, mylib: { git: "https://github.com/me/x.git", ref: "abc" } }, develop: { pytest: { version: "==7.0.0" } } }));
    assert.strictEqual(byName(pipfile, "django").version, "3.2.0");
    assert.strictEqual(byName(pipfile, "mylib").registry, false);
    assert.strictEqual(byName(pipfile, "pytest").scope, "development");

    const poetry = deps("poetry.lock", [
      "[[package]]", "name = \"Django\"", "version = \"3.2.0\"", "category = \"main\"", "",
      "[[package]]", "name = \"pytest\"", "version = \"7.0.0\"", "category = \"dev\"", "",
      "[[package]]", "name = \"internal\"", "version = \"1.0.0\"", "", "[package.source]", "type = \"git\"", "url = \"https://github.com/me/internal.git\"",
      "", "[metadata]", "lock-version = \"2.0\""
    ].join("\n"));
    assert.deepStrictEqual([byName(poetry, "django").version, byName(poetry, "django").line], ["3.2.0", 1]);
    assert.strictEqual(byName(poetry, "pytest").scope, "development");
    assert.strictEqual(byName(poetry, "internal").registry, false);

    const uv = deps("uv.lock", [
      "version = 1", "", "[[package]]", "name = \"myproject\"", "version = \"0.1.0\"", "source = { editable = \".\" }", "",
      "[[package]]", "name = \"requests\"", "version = \"2.31.0\"", "source = { registry = \"https://pypi.org/simple\" }", "",
      "[[package]]", "name = \"vendored\"", "version = \"1.0\"", "source = { git = \"https://github.com/me/v?rev=abc#abc\" }"
    ].join("\n"));
    assert.ok(!uv.some(d => d.name === "myproject"));
    assert.strictEqual(byName(uv, "requests").version, "2.31.0");
    assert.strictEqual(byName(uv, "vendored").registry, false);

    const pdm = deps("pdm.lock", ["[[package]]", "name = \"black\"", "version = \"23.1.0\"", "groups = [\"dev\"]", "", "[[package]]", "name = \"attrs\"", "version = \"23.1.0\"", "groups = [\"default\"]"].join("\n"));
    assert.strictEqual(byName(pdm, "black").scope, "development");
    assert.strictEqual(byName(pdm, "attrs").scope, "production");

    assert.match(parseDependencyFile("poetry.lock", "[[package]\nname=")!.error!, /Not valid TOML/);
  });

  test("pyproject.toml (PEP 621, dependency groups, Poetry) and Pipfile", () => {
    const list = deps("pyproject.toml", [
      "[project]", "name = \"x\"", "dependencies = [", "  \"requests[socks]>=2.28\",", "  \"click==8.1.3\",", "]", "",
      "[project.optional-dependencies]", "test = [\"pytest>=7\"]", "",
      "[tool.poetry.dependencies]", "python = \"^3.10\"", "fastapi = \"^0.100.0\"", "pydantic = { version = \"2.1.0\", optional = true }", "mine = { path = \"../mine\" }"
    ].join("\n"));
    assert.strictEqual(byName(list, "requests").spec, ">=2.28");
    assert.deepStrictEqual([byName(list, "click").version, byName(list, "click").resolution], ["8.1.3", "pinned"]);
    assert.strictEqual(byName(list, "pytest").scope, "development");
    assert.strictEqual(byName(list, "fastapi").spec, ">=0.100.0,<0.101");
    assert.strictEqual(byName(list, "fastapi").line, 13);
    assert.strictEqual(byName(list, "pydantic").version, "2.1.0");
    assert.strictEqual(byName(list, "mine").registry, false);
    assert.ok(!list.some(d => d.name === "python"));

    assert.strictEqual(poetryToPep440("^1.2.3"), ">=1.2.3,<2");
    assert.strictEqual(poetryToPep440("^0.2.3"), ">=0.2.3,<0.3");
    assert.strictEqual(poetryToPep440("~1.2.3"), ">=1.2.3,<1.3");
    assert.strictEqual(poetryToPep440("1.2.3"), "==1.2.3");
    assert.strictEqual(poetryToPep440("*"), "");

    const pipfile = deps("Pipfile", ["[packages]", "django = \"==3.2.0\"", "flask = \"*\"", "lib = { git = \"https://x\" }", "", "[dev-packages]", "pytest = \">=7\""].join("\n"));
    assert.strictEqual(byName(pipfile, "django").version, "3.2.0");
    assert.strictEqual(byName(pipfile, "flask").spec, "*");
    assert.strictEqual(byName(pipfile, "lib").registry, false);
    assert.strictEqual(byName(pipfile, "pytest").scope, "development");
  });
});

suite("osv: JVM, Go, Rust, Ruby, .NET and other parsers", () => {
  test("pom.xml resolves properties, including from a parent POM; managed and snapshot versions are not guessed", () => {
    const parent = "<project><properties><jackson.version>2.9.8</jackson.version></properties></project>";
    const child = [
      "<project>", "<parent><groupId>g</groupId><artifactId>p</artifactId><version>1.0</version></parent>",
      "<properties><log4j.version>2.14.1</log4j.version></properties>",
      "<dependencies>",
      "<dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>${log4j.version}</version></dependency>",
      "<dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>${jackson.version}</version></dependency>",
      "<dependency><groupId>org.springframework</groupId><artifactId>spring-core</artifactId></dependency>",
      "<dependency><groupId>x</groupId><artifactId>snap</artifactId><version>1.0-SNAPSHOT</version></dependency>",
      "<dependency><groupId>x</groupId><artifactId>ranged</artifactId><version>[1.0,2.0)</version></dependency>",
      "<dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.12</version><scope>test</scope></dependency>",
      "</dependencies></project>"
    ].join("\n");
    const parsed = parseDependencyFile("svc/pom.xml", child, { ancestors: (name, dir) => (name === "pom.xml" && dir === "" ? [parent] : []) })!;
    const list = parsed.dependencies;
    assert.deepStrictEqual([byName(list, "org.apache.logging.log4j:log4j-core").version, byName(list, "org.apache.logging.log4j:log4j-core").resolution], ["2.14.1", "pinned"]);
    assert.strictEqual(byName(list, "com.fasterxml.jackson.core:jackson-databind").version, "2.9.8", "a parent POM's property resolves");
    assert.strictEqual(byName(list, "org.springframework:spring-core").registry, false);
    assert.strictEqual(byName(list, "x:snap").registry, false);
    assert.deepStrictEqual([byName(list, "x:ranged").resolution, byName(list, "x:ranged").spec], ["range", "[1.0,2.0)"]);
    assert.strictEqual(byName(list, "junit:junit").scope, "development");
    assert.match(parseDependencyFile("pom.xml", "<settings/>")!.error!, /Not a Maven POM/);
  });

  test("Gradle: build scripts are declared (not confirmed), lockfiles are exact", () => {
    const gradle = deps("app/build.gradle.kts", [
      "dependencies {", "  implementation(\"com.squareup.okhttp3:okhttp:4.9.0\")", "  implementation(\"com.google.guava:guava:${guavaVersion}\")",
      "  testImplementation(\"junit:junit:4.+\")", "}"
    ].join("\n"));
    assert.deepStrictEqual([byName(gradle, "com.squareup.okhttp3:okhttp").version, byName(gradle, "com.squareup.okhttp3:okhttp").resolution], ["4.9.0", "declared"]);
    assert.strictEqual(byName(gradle, "com.google.guava:guava").registry, false);
    assert.strictEqual(byName(gradle, "junit:junit").resolution, "range");
    const props = parseDependencyFile("app/build.gradle", "dependencies { implementation \"g:a:$libVersion\" }", { ancestors: name => (name === "gradle.properties" ? ["libVersion=1.2.3"] : []) })!;
    assert.strictEqual(props.dependencies[0].version, "1.2.3");
    const lock = deps("gradle.lockfile", ["# comment", "com.squareup.okhttp3:okhttp:4.9.0=compileClasspath,runtimeClasspath", "junit:junit:4.13.2=testCompileClasspath", "empty=annotationProcessor"].join("\n"));
    assert.deepStrictEqual([byName(lock, "com.squareup.okhttp3:okhttp").version, byName(lock, "com.squareup.okhttp3:okhttp").line], ["4.9.0", 2]);
    assert.strictEqual(byName(lock, "junit:junit").scope, "development");
  });

  test("go.mod: require blocks, indirect, replacements and old Go versions", () => {
    const parsed = parseDependencyFile("go.mod", [
      "module example.com/app", "", "go 1.16", "", "require (", "\tgolang.org/x/text v0.3.6", "\tgithub.com/pkg/errors v0.9.1 // indirect", "\tgithub.com/old/mod v1.0.0", "\texample.com/local v0.0.0", ")",
      "require github.com/single/mod v2.0.0+incompatible", "", "replace github.com/old/mod => github.com/new/mod v1.2.0", "replace example.com/local => ../local"
    ].join("\n"))!;
    const list = parsed.dependencies;
    assert.deepStrictEqual([byName(list, "golang.org/x/text").version, byName(list, "golang.org/x/text").direct], ["v0.3.6", true]);
    assert.strictEqual(byName(list, "github.com/pkg/errors").direct, false);
    assert.strictEqual(byName(list, "github.com/new/mod").version, "v1.2.0", "replacements are scanned as the module actually used");
    assert.strictEqual(byName(list, "example.com/local").registry, false);
    assert.strictEqual(byName(list, "github.com/single/mod").version, "v2.0.0+incompatible");
    assert.ok(parsed.warnings.some(w => /1\.17/.test(w)));
  });

  test("Cargo.lock and Cargo.toml", () => {
    const lock = deps("Cargo.lock", [
      "version = 3", "", "[[package]]", "name = \"regex\"", "version = \"1.5.4\"", "source = \"registry+https://github.com/rust-lang/crates.io-index\"", "",
      "[[package]]", "name = \"app\"", "version = \"0.1.0\"", "", "[[package]]", "name = \"forked\"", "version = \"0.2.0\"", "source = \"git+https://github.com/me/forked#abc\"",
      "", "[[package]]", "name = \"serde\"", "version = \"1.0.0\"", "source = \"sparse+https://index.crates.io/\""
    ].join("\n"));
    assert.strictEqual(byName(lock, "regex").version, "1.5.4");
    assert.strictEqual(byName(lock, "serde").version, "1.0.0");
    assert.ok(!lock.some(d => d.name === "app"), "workspace members are skipped");
    assert.strictEqual(byName(lock, "forked").registry, false);
    const manifest = deps("Cargo.toml", ["[dependencies]", "regex = \"1.5\"", "serde = { version = \"=1.0.100\", features = [\"derive\"] }", "local = { path = \"../local\" }", "", "[dev-dependencies]", "proptest = \"1\""].join("\n"));
    assert.deepStrictEqual([byName(manifest, "regex").spec, byName(manifest, "regex").resolution], ["1.5", "range"]);
    assert.strictEqual(byName(manifest, "serde").version, "1.0.100");
    assert.strictEqual(byName(manifest, "local").registry, false);
    assert.strictEqual(byName(manifest, "proptest").scope, "development");
  });

  test("Gemfile.lock (platform gems, git sources, direct gems) and Gemfile", () => {
    const lock = deps("Gemfile.lock", [
      "GIT", "  remote: https://github.com/me/gem.git", "  revision: abc", "  specs:", "    mygem (0.1.0)", "",
      "GEM", "  remote: https://rubygems.org/", "  specs:", "    nokogiri (1.13.0-x86_64-linux)", "      racc (~> 1.4)", "    nokogiri (1.13.0-arm64-darwin)", "    racc (1.6.0)", "",
      "PLATFORMS", "  x86_64-linux", "", "DEPENDENCIES", "  mygem!", "  nokogiri (~> 1.13)", "", "BUNDLED WITH", "   2.3.0"
    ].join("\n"));
    assert.strictEqual(lock.filter(d => d.name === "nokogiri").length, 1, "platform variants collapse to one version");
    assert.deepStrictEqual([byName(lock, "nokogiri").version, byName(lock, "nokogiri").direct], ["1.13.0", true]);
    assert.strictEqual(byName(lock, "racc").direct, false);
    assert.strictEqual(byName(lock, "mygem").registry, false);
    const gemfile = deps("Gemfile", ["source 'https://rubygems.org'", "gem 'rails', '~> 7.0.0'", "gem 'pg', '1.4.0'", "group :development, :test do", "  gem 'rspec', '>= 3.0', '< 4'", "end", "gem 'mine', path: '../mine'"].join("\n"));
    assert.strictEqual(byName(gemfile, "rails").spec, "~> 7.0.0");
    assert.strictEqual(byName(gemfile, "pg").version, "1.4.0");
    assert.deepStrictEqual([byName(gemfile, "rspec").scope, byName(gemfile, "rspec").spec], ["development", ">= 3.0, < 4"]);
    assert.strictEqual(byName(gemfile, "mine").registry, false);
  });

  test("NuGet: lockfile, restore output (canonical casing), csproj with central versions, packages.config", () => {
    const lock = deps("packages.lock.json", JSON.stringify({ version: 1, dependencies: { "net8.0": { "Newtonsoft.Json": { type: "Direct", requested: "[12.0.3, )", resolved: "12.0.3" }, "System.Text.Json": { type: "Transitive", resolved: "6.0.0" }, MyLib: { type: "Project" } } } }));
    assert.deepStrictEqual([byName(lock, "Newtonsoft.Json").version, byName(lock, "Newtonsoft.Json").direct], ["12.0.3", true]);
    assert.strictEqual(byName(lock, "System.Text.Json").direct, false);
    assert.ok(!lock.some(d => d.name === "MyLib"));
    const assets = deps("obj/project.assets.json", JSON.stringify({ libraries: { "Newtonsoft.Json/12.0.3": { type: "package" }, "App/1.0.0": { type: "project" } }, project: { frameworks: { "net8.0": { dependencies: { "newtonsoft.json": {} } } } } }));
    assert.deepStrictEqual([assets[0].name, assets[0].version, assets[0].direct], ["Newtonsoft.Json", "12.0.3", true]);
    const csproj = parseDependencyFile("src/App.csproj", [
      "<Project Sdk=\"Microsoft.NET.Sdk\"><ItemGroup>", "<PackageReference Include=\"Serilog\" Version=\"2.10.0\" />", "<PackageReference Include=\"Dapper\" />",
      "<PackageReference Include=\"Floaty\" Version=\"1.*\" />", "<PackageReference Include=\"Exact\" Version=\"[3.1.0]\" />", "</ItemGroup></Project>"
    ].join("\n"), { ancestors: name => (name === "Directory.Packages.props" ? ["<Project><ItemGroup><PackageVersion Include=\"Dapper\" Version=\"2.0.123\" /></ItemGroup></Project>"] : []) })!;
    const list = csproj.dependencies;
    assert.strictEqual(byName(list, "Serilog").version, "2.10.0");
    assert.strictEqual(byName(list, "Dapper").version, "2.0.123", "central package management");
    assert.strictEqual(byName(list, "Floaty").resolution, "range");
    assert.strictEqual(byName(list, "Exact").version, "3.1.0");
    const config = deps("packages.config", "<packages><package id=\"jQuery\" version=\"1.6.2\" targetFramework=\"net45\" /><package id=\"xunit\" version=\"2.4.0\" developmentDependency=\"true\" /></packages>");
    assert.strictEqual(byName(config, "jQuery").version, "1.6.2");
    assert.strictEqual(byName(config, "xunit").scope, "development");
  });

  test("composer, pub, mix, SwiftPM and renv", () => {
    const composer = deps("composer.lock", JSON.stringify({ packages: [{ name: "guzzlehttp/guzzle", version: "v7.4.4" }, { name: "me/branch", version: "dev-main" }], "packages-dev": [{ name: "phpunit/phpunit", version: "9.5.0" }] }));
    assert.strictEqual(byName(composer, "guzzlehttp/guzzle").version, "7.4.4");
    assert.strictEqual(byName(composer, "me/branch").registry, false);
    assert.strictEqual(byName(composer, "phpunit/phpunit").scope, "development");
    const composerJson = deps("composer.json", JSON.stringify({ require: { php: ">=8.1", "ext-json": "*", "monolog/monolog": "^2.0", "symfony/yaml": "5.4.0" } }));
    assert.deepStrictEqual(composerJson.map(d => d.name).sort(), ["monolog/monolog", "symfony/yaml"]);
    assert.strictEqual(byName(composerJson, "symfony/yaml").version, "5.4.0");

    const pubLock = deps("pubspec.lock", [
      "packages:", "  http:", "    dependency: \"direct main\"", "    description:", "      name: http", "      url: \"https://pub.dev\"", "    source: hosted", "    version: \"0.13.0\"",
      "  flutter:", "    dependency: \"direct main\"", "    description: flutter", "    source: sdk", "    version: \"0.0.0\"",
      "  mylib:", "    dependency: transitive", "    description:", "      path: \"../mylib\"", "    source: path", "    version: \"1.0.0\"",
      "sdks:", "  dart: \">=3.0.0 <4.0.0\""
    ].join("\n"));
    assert.deepStrictEqual([byName(pubLock, "http").version, byName(pubLock, "http").direct], ["0.13.0", true]);
    assert.ok(!pubLock.some(d => d.name === "flutter"));
    assert.strictEqual(byName(pubLock, "mylib").registry, false);

    const mix = deps("mix.lock", [
      "%{", "  \"plug\": {:hex, :plug, \"1.14.0\", \"abc\", [:mix], [], \"hexpm\", \"def\"},", "  \"my_dep\": {:git, \"https://github.com/me/dep.git\", \"abc\", []},", "}"
    ].join("\n"));
    assert.strictEqual(byName(mix, "plug").version, "1.14.0");
    assert.strictEqual(byName(mix, "my_dep").registry, false);

    assert.strictEqual(swiftUrlName("https://github.com/apple/swift-nio.git"), "github.com/apple/swift-nio");
    assert.strictEqual(swiftUrlName("git@github.com:apple/swift-nio.git"), "github.com/apple/swift-nio");
    const swift = deps("Package.resolved", JSON.stringify({ pins: [
      { identity: "swift-nio", kind: "remoteSourceControl", location: "https://github.com/apple/swift-nio.git", state: { revision: "abc", version: "2.29.0" } },
      { identity: "branchy", kind: "remoteSourceControl", location: "https://github.com/me/branchy", state: { revision: "abc", branch: "main" } }
    ], version: 2 }));
    assert.deepStrictEqual([byName(swift, "github.com/apple/swift-nio").version], ["2.29.0"]);
    assert.strictEqual(byName(swift, "github.com/me/branchy").registry, false);
    const swiftV1 = deps("Package.resolved", JSON.stringify({ object: { pins: [{ package: "NIO", repositoryURL: "https://github.com/apple/swift-nio.git", state: { version: "2.0.0" } }] }, version: 1 }));
    assert.strictEqual(swiftV1[0].version, "2.0.0");

    const renv = deps("renv.lock", JSON.stringify({ Packages: { commonmark: { Package: "commonmark", Version: "0.2", Source: "Repository", Repository: "CRAN" }, Biobase: { Package: "Biobase", Version: "2.0", Source: "Bioconductor" } } }));
    assert.strictEqual(byName(renv, "commonmark").version, "0.2");
    assert.strictEqual(byName(renv, "Biobase").registry, false);
  });

  test("malformed files report an error instead of throwing", () => {
    for (const [file, text] of [["package-lock.json", "{"], ["Pipfile.lock", "nope"], ["pnpm-lock.yaml", "a: [unclosed"], ["Cargo.lock", "[[package]\n"], ["composer.lock", ""], ["renv.lock", "{]"]]) {
      const parsed = parseDependencyFile(file, text);
      assert.ok(parsed?.error, `${file} reports an error`);
      assert.deepStrictEqual(parsed!.dependencies, []);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

suite("osv: versions and ranges", () => {
  test("ecosystem comparators", () => {
    const semver = comparatorFor("npm");
    assert.ok(semver("1.0.0-beta.2", "1.0.0") < 0 && semver("4.17.21", "4.17.20") > 0);
    assert.ok(comparatorFor("Go")("v0.3.8", "0.3.6") > 0, "Go's v prefix is ignored");
    assert.ok(comparatorFor("PyPI")("3.2.13", "3.2.2") > 0 && comparatorFor("PyPI")("4.0a1", "4.0") < 0);
    assert.ok(comparatorFor("Maven")("2.15.0", "2.14.1") > 0 && comparatorFor("Maven")("2.0-beta9", "2.0") < 0);
    assert.ok(comparatorFor("NuGet")("13.0.1", "12.0.3") > 0);
    assert.ok(compareRubyGems("1.13.0", "1.13.0.rc1") > 0 && compareRubyGems("1.10", "1.9") > 0 && compareRubyGems("1.0", "1.0.0") === 0);
    assert.ok(compareGeneric("v7.4.5", "7.4.4") > 0 && compareGeneric("1.0.0-RC1", "1.0.0") < 0 && compareGeneric("1.0.0-p1", "1.0.0") > 0);
    assert.ok(isComparable("npm", "1.2.3") && !isComparable("npm", "1.2") && isComparable("PyPI", "1.2") && !isComparable("Maven", "latest"));
  });

  test("OSV events become intervals, sorted the way OSV evaluates them", () => {
    const cmp = comparatorFor("PyPI");
    const intervals = intervalsOf({ type: "ECOSYSTEM", events: [{ introduced: "4.0" }, { fixed: "4.0.4" }, { introduced: "3.2" }, { fixed: "3.2.13" }, { introduced: "0" }, { last_affected: "2.2.27" }] }, cmp);
    assert.deepStrictEqual(intervals, [{ introduced: "0", lastAffected: "2.2.27" }, { introduced: "3.2", fixed: "3.2.13" }, { introduced: "4.0", fixed: "4.0.4" }]);
    const comparable = (v: string) => isComparable("PyPI", v);
    assert.strictEqual(inInterval("3.2.12", intervals[1], cmp, comparable), true);
    assert.strictEqual(inInterval("3.2.13", intervals[1], cmp, comparable), false);
    assert.strictEqual(inInterval("2.2.27", intervals[0], cmp, comparable), true);
    assert.strictEqual(inInterval("not-a-version!", intervals[0], cmp, comparable), undefined);
    assert.strictEqual(describeInterval(intervals[1]), ">= 3.2, < 3.2.13");
    assert.strictEqual(describeInterval({ introduced: "0" }), "all versions (no fix released)");
    const open = intervalsOf({ type: "SEMVER", events: [{ introduced: "1.0.0" }] }, comparatorFor("npm"));
    assert.deepStrictEqual(open, [{ introduced: "1.0.0" }]);
  });

  test("declared ranges per ecosystem", () => {
    assert.deepStrictEqual(declaredSpans("npm", "^4.17.0"), [{ lower: { version: "4.17.0", inclusive: true }, upper: { version: "5.0.0-0", inclusive: false } }]);
    assert.deepStrictEqual(declaredSpans("npm", "*"), [{}]);
    assert.strictEqual(declaredSpans("npm", "1.x || >=2.5.0")!.length, 2);
    assert.deepStrictEqual(declaredSpans("crates.io", "1.5")![0].lower, { version: "1.5.0", inclusive: true }, "Cargo treats a bare version as a caret");
    assert.deepStrictEqual(declaredSpans("PyPI", ">=2.20,<3"), [{ lower: { version: "2.20", inclusive: true }, upper: { version: "3", inclusive: false } }]);
    assert.deepStrictEqual(declaredSpans("PyPI", "~=1.4.2"), [{ lower: { version: "1.4.2", inclusive: true }, upper: { version: "1.5", inclusive: false } }]);
    assert.deepStrictEqual(declaredSpans("PyPI", "==1.2.*"), [{ lower: { version: "1.2", inclusive: true }, upper: { version: "1.3", inclusive: false } }]);
    assert.deepStrictEqual(declaredSpans("RubyGems", "~> 7.0.0"), [{ lower: { version: "7.0.0", inclusive: true }, upper: { version: "7.1", inclusive: false } }]);
    assert.deepStrictEqual(declaredSpans("Hex", "~> 1.2"), [{ lower: { version: "1.2.0", inclusive: true }, upper: { version: "2.0.0", inclusive: false } }]);
    assert.deepStrictEqual(spansFromInterval("[1.0,2.0)"), [{ lower: { version: "1.0", inclusive: true }, upper: { version: "2.0", inclusive: false } }]);
    assert.deepStrictEqual(spansFromInterval("(,1.0],[1.2,)"), [{ upper: { version: "1.0", inclusive: true } }, { lower: { version: "1.2", inclusive: true } }]);
    assert.deepStrictEqual(spansFromInterval("[3.1.0]"), [{ lower: { version: "3.1.0", inclusive: true }, upper: { version: "3.1.0", inclusive: true } }]);
    assert.strictEqual(spansFromInterval("nonsense"), undefined);
    assert.strictEqual(declaredSpans("Packagist", "~1.2 || dev-main"), undefined, "an unreadable range is unknown, not empty");
  });

  test("a declared range overlaps an affected interval only when versions prove it can", () => {
    const cmp = comparatorFor("npm");
    const ok = (v: string) => isComparable("npm", v);
    const caret = declaredSpans("npm", "^4.17.21")![0];
    assert.strictEqual(spanOverlaps(caret, { introduced: "4.0.0", fixed: "4.17.21" }, cmp, ok), false, "fixed at the lower bound");
    assert.strictEqual(spanOverlaps(caret, { introduced: "0", fixed: "4.18.0" }, cmp, ok), true);
    assert.strictEqual(spanOverlaps(caret, { introduced: "5.0.0", fixed: "5.1.0" }, cmp, ok), false, "introduced above the range");
    assert.strictEqual(spanOverlaps(caret, { introduced: "4.0.0", lastAffected: "4.17.21" }, cmp, ok), true, "last_affected is inclusive");
    assert.strictEqual(spanOverlaps(caret, { introduced: "4.0.0", fixed: "weird" }, cmp, ok), true, "unknown comparisons stay conservative");
  });
});

/* ------------------------------------------------------------------ *
 * Severity
 * ------------------------------------------------------------------ */

suite("osv: severity", () => {
  test("CVSS v3.x base scores match the FIRST calculator", () => {
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10);
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"), 5.3);
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H"), 7.2);
    assert.strictEqual(cvss3BaseScore("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N"), 6.5);
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N"), 3.1);
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0);
    assert.strictEqual(cvss3BaseScore("CVSS:3.1/AV:N/AC:L"), undefined, "incomplete vectors are not scored");
    assert.strictEqual(cvss3BaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"), undefined);
    // The specification's own examples: Roundup(4.02) = 4.1, Roundup(4.00) = 4.0, and float noise does not round up.
    assert.strictEqual(roundUp(4.02), 4.1);
    assert.strictEqual(roundUp(4.0), 4);
    assert.strictEqual(roundUp(4.000001), 4);
  });

  test("CVSS v2 base scores", () => {
    assert.strictEqual(cvss2BaseScore("AV:N/AC:L/Au:N/C:P/I:P/A:P"), 7.5);
    assert.strictEqual(cvss2BaseScore("AV:N/AC:L/Au:N/C:C/I:C/A:C"), 10);
    assert.strictEqual(cvss2BaseScore("AV:N/AC:M/Au:N/C:N/I:P/A:N"), 4.3);
    assert.strictEqual(cvss2BaseScore("AV:L/AC:L/Au:N/C:N/I:N/A:N"), 0);
  });

  test("severity comes from the advisory, in a fixed order, and is never invented", () => {
    assert.strictEqual(labelSeverity("MODERATE"), "medium");
    assert.strictEqual(ratingV3(9.0), "critical");
    const ghsa = resolveSeverity([{ id: "GHSA-x", database_specific: { severity: "HIGH" }, severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }]);
    assert.deepStrictEqual([ghsa.severity, ghsa.cvssScore], ["high", 9.8], "GitHub's reviewed label wins, the score is still shown");
    const merged = resolveSeverity([{ id: "PYSEC-1" }, { id: "GHSA-y", database_specific: { severity: "CRITICAL" } }]);
    assert.strictEqual(merged.severity, "critical", "an alias supplies the severity a record lacks");
    const cvss = resolveSeverity([{ id: "GO-1", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L" }] }]);
    assert.deepStrictEqual([cvss.severity, cvss.cvssScore], ["medium", 5.3]);
    assert.match(cvss.source!, /base score 5\.3/);
    const v2 = resolveSeverity([{ id: "OLD-1", severity: [{ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:P/I:P/A:P" }] }]);
    assert.strictEqual(v2.severity, "high");
    const v4 = resolveSeverity([{ id: "NEW-1", severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N" }] }]);
    assert.deepStrictEqual([v4.severity, v4.cvssScore], ["unknown", undefined]);
    assert.ok(v4.cvssV4Vector);
    const ecosystem = resolveSeverity([{ id: "X-1", affected: [{ ecosystem_specific: { severity: "LOW" } }] }]);
    assert.strictEqual(ecosystem.severity, "low");
    assert.strictEqual(resolveSeverity([{ id: "NONE-1" }]).severity, "unknown");
  });
});

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

suite("osv: API client", () => {
  const query = { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.20" };

  test("posts batches and follows per-query page tokens", async () => {
    const { fetch, calls } = scriptedFetch({
      "/v1/querybatch": [
        { status: 200, body: { results: [{ vulns: [{ id: "A", modified: "m1" }], next_page_token: "t1" }, {}] } },
        { status: 200, body: { results: [{ vulns: [{ id: "B", modified: "m2" }] }] } }
      ]
    });
    const c = new OsvClient({ fetch, sleep: noSleep });
    const result = await c.queryBatch([query, { package: { name: "x", ecosystem: "npm" }, version: "1.0.0" }]);
    assert.deepStrictEqual(result, [[{ id: "A", modified: "m1" }, { id: "B", modified: "m2" }], []]);
    assert.deepStrictEqual(calls[1].body, { queries: [{ ...query, page_token: "t1" }] }, "only unfinished queries are re-sent, with their token");
    assert.ok(calls.every(call => call.url === "https://api.osv.dev/v1/querybatch"));
  });

  test("retries 429 (honouring Retry-After), 5xx and network errors, then succeeds", async () => {
    const waits: number[] = [];
    const { fetch, calls } = scriptedFetch({
      "/v1/querybatch": [
        { status: 429, body: { message: "slow down" }, headers: { "retry-after": "7" } },
        { status: 503, body: {} },
        new TypeError("fetch failed"),
        { status: 200, body: { results: [{}] } }
      ]
    });
    const c = new OsvClient({ fetch, sleep: async ms => { waits.push(ms); }, retries: 3, random: () => 0.5 });
    assert.deepStrictEqual(await c.queryBatch([query]), [[]]);
    assert.strictEqual(calls.length, 4);
    assert.strictEqual(waits[0], 7000, "Retry-After seconds");
    assert.deepStrictEqual(waits.slice(1), [1000, 2000], "exponential backoff");
    assert.strictEqual(c.stats.retries, 3);
  });

  test("gives up after the retry budget with a clear error kind", async () => {
    const { fetch } = scriptedFetch({}, () => ({ status: 503, body: { message: "maintenance" } }));
    const c = new OsvClient({ fetch, sleep: noSleep, retries: 2 });
    await assert.rejects(c.queryBatch([query]), (e: unknown) => e instanceof OsvError && e.kind === "http" && e.status === 503 && /maintenance/.test(e.message));
    const rate = scriptedFetch({}, () => ({ status: 429, body: {} }));
    await assert.rejects(new OsvClient({ fetch: rate.fetch, sleep: noSleep, retries: 1 }).queryBatch([query]), (e: unknown) => e instanceof OsvError && e.kind === "rate-limit");
    const offline = scriptedFetch({}, () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }));
    await assert.rejects(new OsvClient({ fetch: offline.fetch, sleep: noSleep, retries: 0 }).queryBatch([query]), (e: unknown) => e instanceof OsvError && e.kind === "network" && /offline/.test(e.message));
  });

  test("does not retry a 400, and rejects bodies that are not JSON or do not match the request", async () => {
    const bad = scriptedFetch({ "/v1/querybatch": [{ status: 400, body: { message: "Invalid query" } }] });
    await assert.rejects(new OsvClient({ fetch: bad.fetch, sleep: noSleep }).queryBatch([query]), /HTTP 400: Invalid query/);
    assert.strictEqual(bad.calls.length, 1);
    const html = scriptedFetch({ "/v1/querybatch": [{ status: 200, body: "<html>proxy login</html>" }] });
    await assert.rejects(new OsvClient({ fetch: html.fetch, sleep: noSleep }).queryBatch([query]), (e: unknown) => e instanceof OsvError && e.kind === "invalid-response");
    const short = scriptedFetch({ "/v1/querybatch": [{ status: 200, body: { results: [] } }] });
    await assert.rejects(new OsvClient({ fetch: short.fetch, sleep: noSleep }).queryBatch([query]), /OSV returned 0 results for 1 queries/);
    await assert.rejects(new OsvClient({ fetch: short.fetch }).queryBatch(new Array(MAX_BATCH + 1).fill(query)), /At most 1000/);
  });

  test("times out a request that never answers", async () => {
    const { fetch } = scriptedFetch({ "/v1/vulns/GHSA-1": ["hang"] });
    const c = new OsvClient({ fetch, sleep: noSleep, retries: 0, timeoutMs: 20 });
    await assert.rejects(c.getVulnerability("GHSA-1"), (e: unknown) => e instanceof OsvError && e.kind === "timeout");
  });

  test("cancellation stops a request and any pending backoff", async () => {
    const controller = new AbortController();
    const { fetch } = scriptedFetch({}, () => "hang");
    const c = new OsvClient({ fetch, retries: 3, timeoutMs: 10000 });
    const pending = c.queryBatch([query], controller.signal);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, (e: unknown) => e instanceof OsvError && e.kind === "cancelled");
    const before = new AbortController();
    before.abort();
    await assert.rejects(c.getVulnerability("X", before.signal), (e: unknown) => e instanceof OsvError && e.kind === "cancelled");
  });

  test("a missing record is undefined; ids are URL-encoded", async () => {
    const { fetch, calls } = scriptedFetch({ "/v1/vulns/a%2Fb": [{ status: 404, body: { code: 5 } }] });
    assert.strictEqual(await new OsvClient({ fetch, sleep: noSleep }).getVulnerability("a/b"), undefined);
    assert.strictEqual(calls[0].url, "https://api.osv.dev/v1/vulns/a%2Fb");
  });

  test("Retry-After parsing, concurrency limiting and the record cache", async () => {
    assert.strictEqual(retryAfterMs("3"), 3000);
    const fromDate = retryAfterMs(new Date(Date.now() + 5000).toUTCString(), Date.now());
    assert.ok(fromDate !== undefined && fromDate > 3000 && fromDate <= 5000, "an HTTP date");
    assert.strictEqual(retryAfterMs("soon"), undefined);
    let active = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 2)); active--; return n * 2; });
    assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14]);
    assert.strictEqual(peak, 3);

    let now = 0;
    const cache = new OsvCache(2, 1000, () => now);
    cache.putRecord({ id: "A", modified: "1" });
    assert.ok(cache.getRecord("A", "1"));
    assert.strictEqual(cache.getRecord("A", "2"), undefined, "an advisory modified upstream is fetched again");
    now = 5; cache.putRecord({ id: "B", modified: "1" });
    now = 6; cache.getRecord("A", "1");
    now = 7; cache.putRecord({ id: "C", modified: "1" });
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.getRecord("B", "1"), undefined, "the least recently used record is evicted");
    cache.putQuery("q", [{ id: "A", modified: "1" }]);
    assert.ok(cache.getQuery("q"));
    now = 2000;
    assert.strictEqual(cache.getQuery("q"), undefined, "query answers expire");
    const copy = new OsvCache();
    copy.load(JSON.parse(JSON.stringify(cache.toJSON())));
    assert.ok(copy.getRecord("C", "1"));
    copy.load({ version: 99, records: [{ record: { id: "Z" } }] });
    assert.strictEqual(copy.getRecord("Z", ""), undefined, "an unknown cache format is ignored");
  });
});

/* ------------------------------------------------------------------ *
 * Scan
 * ------------------------------------------------------------------ */

function standardDb(): FakeOsv {
  return new FakeOsv()
    .add(LODASH_REDOS, [{ ecosystem: "npm", name: "lodash", versions: ["4.17.19", "4.17.20"] }])
    .add(LODASH_INJECTION, [{ ecosystem: "npm", name: "lodash", versions: ["4.17.19", "4.17.20"] }])
    .add(DJANGO_GHSA, [{ ecosystem: "PyPI", name: "django", versions: ["3.2.0", "3.2.12"] }])
    .add(DJANGO_PYSEC, [{ ecosystem: "PyPI", name: "django", versions: ["3.2.0", "3.2.12"] }]);
}

suite("osv: scan", () => {
  test("confirmed findings from a lockfile: severity, aliases merged, fix, links, locations and a verified upgrade", async () => {
    const fake = standardDb();
    const result = await scan([{ path: "web/package-lock.json", text: PKG_LOCK }, { path: "web/package.json", text: JSON.stringify({ dependencies: { lodash: "^4.17.0" } }) }], fake);
    assert.strictEqual(result.summary.vulnerablePackages, 1);
    const ids = result.findings.map(f => f.id);
    assert.deepStrictEqual(ids, ["GHSA-35jh-r3h4-6jhm", "GHSA-29mw-wpgm-hmr9"], "high before medium");
    const redos = result.findings[1];
    assert.strictEqual(redos.severity, "medium");
    assert.strictEqual(redos.cvssScore, 5.3);
    assert.strictEqual(redos.confidence, "confirmed");
    assert.strictEqual(redos.installedVersion, "4.17.20");
    assert.strictEqual(redos.fixedIn, "4.17.21");
    assert.deepStrictEqual(redos.affectedRanges, [">= 4.0.0, < 4.17.21"], "only this package's ranges, not lodash-es");
    assert.strictEqual(redos.osvUrl, "https://osv.dev/vulnerability/GHSA-29mw-wpgm-hmr9");
    assert.deepStrictEqual(redos.aliases, ["CVE-2020-28500"]);
    assert.ok(!redos.references.some(r => r.url.startsWith("javascript:")), "only http(s) references survive");
    const lodash = result.packages.find(p => p.name === "lodash")!;
    assert.strictEqual(lodash.occurrences.length, 1, "the manifest entry is covered by the lockfile, not listed twice");
    assert.strictEqual(lodash.occurrences[0].direct, true);
    const fix = result.remediations.find(r => r.packageName === "lodash")!;
    assert.strictEqual(fix.targetVersion, "4.17.21");
    assert.deepStrictEqual(fix.targetCheck, { status: "clean", remaining: [] });
    assert.deepStrictEqual(fix.commands, [{ label: "Upgrade with npm", command: "npm install lodash@4.17.21", cwd: "web" }]);
    assert.strictEqual(result.packages.find(p => p.name === "express")!.status, "clean", "a patched version is not flagged");
    assert.strictEqual(result.packages.find(p => p.name === "my-git-dep")!.status, "unanalyzed");
    assert.ok(!result.partial && !result.cancelled && result.errors.length === 0);
  });

  test("aliased records from different databases become one finding", async () => {
    const fake = standardDb();
    const result = await scan([{ path: "requirements.txt", text: "Django==3.2.0\n" }], fake);
    assert.strictEqual(result.findings.length, 1);
    const finding = result.findings[0];
    assert.strictEqual(finding.id, "GHSA-2gwj-7jmv-h26r", "the GitHub id leads");
    assert.deepStrictEqual(finding.aliases, ["CVE-2022-28346", "PYSEC-2022-190"], "CVE ids first, then other databases");
    assert.strictEqual(finding.severity, "critical");
    assert.strictEqual(finding.fixedIn, "3.2.13");
    assert.ok(finding.references.length === 2, "references from both records");
    const fix = result.remediations[0];
    assert.match(fix.commands[0].command, /python -m pip install "django>=3\.2\.13"/);
    assert.ok(fix.guidance.some(g => /requirements\.txt/.test(g)));
  });

  test("a range without a lockfile gives potential findings, and drops advisories the range cannot reach", async () => {
    const fake = standardDb();
    const result = await scan([
      { path: "a/package.json", text: JSON.stringify({ dependencies: { lodash: "^4.17.0" } }) },
      { path: "b/package.json", text: JSON.stringify({ dependencies: { lodash: "^4.17.21" } }) },
      { path: "c/requirements.txt", text: "django>=4.1\n" }
    ], fake);
    const potentials = result.findings.filter(f => f.confidence === "potential");
    assert.strictEqual(potentials.length, 2, "^4.17.0 can install 4.17.20; ^4.17.21 cannot; django>=4.1 is past every fix");
    assert.ok(potentials.every(f => f.packageName === "lodash" && /\^4\.17\.0/.test(f.confidenceNote!)));
    const django = result.packages.find(p => p.name === "django")!;
    assert.strictEqual(django.status, "clean");
    assert.match(django.note!, /outside the declared range/);
    assert.ok(result.limitations.some(l => /no lockfile entry/.test(l)));
    assert.ok(result.summary.potentialFindings === 2 && result.summary.confirmedFindings === 0);
  });

  test("an unbounded range only reports advisories still open at the newest version", async () => {
    const fake = standardDb().add({
      id: "GHSA-open-0000-0000", modified: "1", summary: "Unfixed", database_specific: { severity: "LOW" },
      affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }]
    }, [{ ecosystem: "npm", name: "lodash" }]);
    const result = await scan([{ path: "package.json", text: JSON.stringify({ dependencies: { lodash: "*" } }) }], fake);
    assert.deepStrictEqual(result.findings.map(f => f.id), ["GHSA-open-0000-0000"]);
    assert.strictEqual(result.findings[0].noFix, true);
    assert.ok(result.remediations[0].guidance.some(g => /No fixed version/.test(g)));
  });

  test("a monorepo: one lockfile at the root covers nested workspaces; nested projects keep their own lockfiles", async () => {
    const fake = standardDb();
    const result = await scan([
      { path: "package-lock.json", text: PKG_LOCK },
      { path: "packages/ui/package.json", text: JSON.stringify({ dependencies: { react: "^18.0.0", lodash: "^4.17.0" } }) },
      { path: "services/api/requirements.txt", text: "django==3.2.0" }
    ], fake);
    assert.ok(!result.packages.some(p => p.name === "react" && p.resolution === "range"), "covered by the root lockfile");
    assert.strictEqual(result.summary.vulnerablePackages, 2);
    const django = result.remediations.find(r => r.packageName === "django")!;
    assert.strictEqual(django.commands[0].cwd, "services/api");
  });

  test("a batch that keeps failing is split until only the bad package is left unanalysed", async () => {
    const fake = standardDb();
    const big = { lockfileVersion: 3, packages: { "": {} } as Record<string, unknown> };
    for (let i = 0; i < 2100; i++) big.packages[`node_modules/pkg-${i}`] = { version: "1.0.0", resolved: "https://registry.npmjs.org/x.tgz" };
    big.packages["node_modules/lodash"] = { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash.tgz" };
    fake.failWhen = queries => queries.some(q => q.package.name === "pkg-0"); // any batch with pkg-0 fails
    fake.failQuery = name => name === "pkg-0"; // and so does its single query
    const result = await scan([{ path: "package-lock.json", text: JSON.stringify(big) }], fake);
    assert.ok(fake.batches.slice(0, 2).every(n => n === 1000), "batches of at most 1000");
    assert.strictEqual(result.summary.packages, 2101);
    assert.strictEqual(result.summary.failedPackages, 1, "only the package OSV cannot answer for");
    assert.strictEqual(result.summary.analyzedPackages, 2100);
    assert.strictEqual(result.packages.find(p => p.name === "pkg-0")!.skipReason, "failed");
    assert.match(result.packages.find(p => p.name === "pkg-0")!.note!, /OSV could not be queried/);
    assert.strictEqual(result.status, "incomplete", "a failed query is never reported as a complete, clean scan");
    assert.ok(result.diagnostics.fallbackQueries > 0 && result.diagnostics.queriesFailed === 1);
    assert.ok(result.findings.some(f => f.packageName === "lodash"), "findings from the other packages survive");
  });

  test("advisory details that cannot be fetched still list the finding by id", async () => {
    const fake = standardDb();
    fake.failVulns.add("GHSA-35jh-r3h4-6jhm");
    const result = await scan([{ path: "package-lock.json", text: PKG_LOCK }], fake);
    const broken = result.findings.find(f => f.id === "GHSA-35jh-r3h4-6jhm")!;
    assert.strictEqual(broken.detailsAvailable, false);
    assert.strictEqual(broken.severity, "unknown");
    assert.match(broken.summary!, /could not be loaded/);
    assert.ok(result.partial && result.errors.some(e => /Details for 1 advisory/.test(e)));
    assert.ok(result.remediations[0].guidance.some(g => /could not be loaded/.test(g)));
  });

  test("withdrawn advisories are dropped; informational ones are labelled", async () => {
    const fake = new FakeOsv()
      .add({ id: "GHSA-gone-0000-0000", modified: "1", withdrawn: "2024-01-01T00:00:00Z", affected: [{ package: { name: "regex", ecosystem: "crates.io" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.0.0" }] }] }] }, [{ ecosystem: "crates.io", name: "regex" }])
      .add({ id: "RUSTSEC-2020-0001", modified: "1", summary: "unmaintained", database_specific: { informational: "unmaintained" }, affected: [{ package: { name: "regex", ecosystem: "crates.io" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0.0.0-0" }] }] }] }, [{ ecosystem: "crates.io", name: "regex" }]);
    const result = await scan([{ path: "Cargo.lock", text: "[[package]]\nname = \"regex\"\nversion = \"1.5.4\"\nsource = \"registry+https://github.com/rust-lang/crates.io-index\"\n" }], fake);
    assert.deepStrictEqual(result.findings.map(f => [f.id, f.informational]), [["RUSTSEC-2020-0001", "unmaintained"]]);
  });

  test("an upgrade target still affected by another advisory is raised to the next fix", async () => {
    const fake = new FakeOsv()
      .add({ id: "GHSA-aaaa-aaaa-aaaa", modified: "1", database_specific: { severity: "HIGH" }, affected: [{ package: { name: "pkg", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.1.0" }] }] }] }, [{ ecosystem: "npm", name: "pkg", versions: ["1.0.0"] }])
      .add({ id: "GHSA-bbbb-bbbb-bbbb", modified: "1", database_specific: { severity: "LOW" }, affected: [{ package: { name: "pkg", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "1.1.0" }, { fixed: "1.2.0" }] }] }] }, [{ ecosystem: "npm", name: "pkg", versions: ["1.1.0"] }]);
    const result = await scan([{ path: "package-lock.json", text: JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { pkg: "^1.0.0" } }, "node_modules/pkg": { version: "1.0.0", resolved: "https://registry.npmjs.org/pkg.tgz" } } }) }], fake);
    const fix = result.remediations[0];
    assert.strictEqual(fix.targetVersion, "1.2.0");
    assert.deepStrictEqual(fix.targetCheck, { status: "clean", remaining: [] });
    assert.strictEqual(fix.commands[0].command, "npm install pkg@1.2.0");
  });

  test("a record without severity borrows it from an alias record, and says so", async () => {
    const fake = new FakeOsv()
      .add({ id: "PYSEC-2024-250", modified: "1", aliases: ["CVE-2024-31584", "BIT-x"], affected: [{ package: { name: "torch", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.2.0" }] }] }] }, [{ ecosystem: "PyPI", name: "torch", versions: ["2.1.0"] }])
      .add({ id: "CVE-2024-31584", modified: "1", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:L/A:L" }] }, []);
    const result = await scan([{ path: "requirements.txt", text: "torch==2.1.0" }], fake);
    const finding = result.findings[0];
    assert.deepStrictEqual([finding.id, finding.severity, finding.cvssScore, finding.fixedIn], ["PYSEC-2024-250", "medium", 5.5, "2.2.0"]);
    assert.match(finding.severitySource!, /CVE-2024-31584.*alias/);
    assert.ok(!result.partial, "an alias that cannot be fetched (BIT-x is never asked for) is not an error");
  });

  test("cancellation returns a partial, clearly marked result", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await scan([{ path: "package-lock.json", text: PKG_LOCK }], standardDb(), { signal: controller.signal });
    assert.ok(result.cancelled && result.partial);
    assert.ok(result.limitations.some(l => /cancelled/.test(l)));
  });

  test("an empty workspace, unsupported files and malformed manifests do not break the scan", async () => {
    const fake = standardDb();
    const empty = await scan([], fake);
    assert.deepStrictEqual([empty.summary.files, empty.summary.packages, empty.findings.length], [0, 0, 0]);
    assert.strictEqual(fake.requests, 0, "nothing is sent when there is nothing to check");
    const mixed = await scan([
      { path: "notes.txt", text: "hello" },
      { path: "broken/package-lock.json", text: "{ nope" },
      { path: "big/package-lock.json", error: "Larger than 64 MB, so it was skipped." },
      { path: "requirements.txt", text: "django==3.2.0" }
    ], fake);
    assert.strictEqual(mixed.summary.files, 3);
    assert.strictEqual(mixed.findings.length, 1);
    assert.ok(mixed.files.find(f => f.path === "broken/package-lock.json")!.error);
    assert.ok(mixed.limitations.some(l => /could not be read: broken\/package-lock\.json, big\/package-lock\.json/.test(l)));
  });

  test("only ecosystem, name and version are sent; nothing from the files themselves", async () => {
    const seen: string[] = [];
    const fake = standardDb();
    const inner = fake.fetch;
    fake.fetch = async (url, init) => { seen.push(url + (init.body ?? "")); return inner(url, init); };
    await scan([{ path: "secret-dir/package-lock.json", text: PKG_LOCK.replace("\"web\"", "\"TOKEN=abc123\"") }], fake);
    const sent = seen.join("\n");
    assert.ok(!/secret-dir|TOKEN|abc123|registry\.npmjs\.org/.test(sent), "no paths, project names or URLs leave the machine");
    for (const call of seen.filter(s => s.includes("querybatch"))) {
      const body = JSON.parse(call.slice(call.indexOf("{")));
      for (const q of body.queries) assert.deepStrictEqual(Object.keys(q).sort(), q.version ? ["package", "version"] : ["package"]);
    }
  });

  test("cached query answers and records avoid repeat requests until a scan asks for fresh data", async () => {
    const fake = standardDb();
    const cache = new OsvCache();
    const files = [{ path: "package-lock.json", text: PKG_LOCK }];
    await scan(files, fake, { cache });
    const first = fake.requests;
    const second = await scan(files, fake, { cache });
    assert.strictEqual(fake.requests, first + 1, "only the fix verification is asked again");
    assert.ok(second.api.cachedRecords >= 2);
    await scan(files, fake, { cache, fresh: true });
    assert.ok(fake.requests > first + 2, "a fresh scan queries OSV again");
  });
});

/* ------------------------------------------------------------------ *
 * Remediation, report, page and navigation
 * ------------------------------------------------------------------ */

suite("osv: remediation, reports and integration", () => {
  const occurrence = (partial: Partial<Occurrence>): Occurrence => ({ file: "package-lock.json", project: "", manager: "npm", scope: "production", resolution: "lockfile", ...partial });

  test("commands per package manager, direct and transitive", () => {
    assert.deepStrictEqual(remediationFor("npm", "qs", "6.11.1", [occurrence({ direct: false })]).commands.map(c => c.command), ["npm update qs"]);
    assert.ok(remediationFor("npm", "qs", "6.11.1", [occurrence({ direct: false })]).guidance[0].includes("overrides"));
    assert.strictEqual(remediationFor("npm", "jest", "29.7.1", [occurrence({ direct: true, scope: "development" })]).commands[0].command, "npm install jest@29.7.1 --save-dev");
    assert.strictEqual(remediationFor("Go", "golang.org/x/text", "0.3.8", [occurrence({ manager: "go", direct: true })]).commands[0].command, "go get golang.org/x/text@v0.3.8");
    assert.strictEqual(remediationFor("crates.io", "regex", "1.5.5", [occurrence({ manager: "cargo" })]).commands[0].command, "cargo update -p regex --precise 1.5.5");
    assert.strictEqual(remediationFor("NuGet", "Newtonsoft.Json", "13.0.1", [occurrence({ manager: "nuget", direct: true, file: "App.csproj" })]).commands[0].command, "dotnet add package Newtonsoft.Json --version 13.0.1");
    assert.deepStrictEqual(remediationFor("Maven", "g:a", "2.0", [occurrence({ manager: "maven", direct: true, file: "pom.xml" })]).commands, [], "Maven gets guidance, not a command");
    const both = remediationFor("npm", "lodash", "4.17.21", [occurrence({ direct: true, project: "a" }), occurrence({ direct: true, project: "a", file: "a/x" }), occurrence({ direct: true, project: "b" })]);
    assert.strictEqual(both.commands.length, 2, "one command per directory");
    assert.ok(!isSafeToken("lodash; rm -rf /", "name") && !isSafeToken("1.0.0 && x", "version") && isSafeToken("@scope/pkg", "name"));
    assert.deepStrictEqual(remediationFor("npm", "evil$(x)", "1.0.0", [occurrence({ direct: true })]).commands, [], "unusual names never reach a command");
  });

  test("HTML report escapes advisory text and links only http(s); JSON is the full result", async () => {
    const fake = new FakeOsv().add({ ...LODASH_REDOS, summary: "<script>alert(1)</script> & \"quotes\"", details: "<img src=x onerror=alert(1)>" }, [{ ecosystem: "npm", name: "lodash", versions: ["4.17.20"] }]);
    const result = await scan([{ path: "package-lock.json", text: PKG_LOCK }], fake);
    const html = reportHtml(result);
    assert.ok(!html.includes("<script>") && !html.includes("<img"), "no markup from advisories");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;"));
    assert.ok(!html.includes("href=\"javascript:"));
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
    assert.match(html, /<h2>Limitations<\/h2>/);
    assert.match(html, /href="https:\/\/osv\.dev\/vulnerability\/GHSA-29mw-wpgm-hmr9"/);
    const json = JSON.parse(reportJson(result));
    assert.deepStrictEqual(Object.keys(json).sort(), ["api", "cancelled", "diagnostics", "durationMs", "errors", "files", "findings", "finishedAt", "incompleteReasons", "limitations", "packages", "partial", "remediations", "schemaVersion", "source", "startedAt", "status", "summary", "tool", "toolVersion", "workspace"]);
    assert.match(html, /<b>Status:<\/b> <span class="ok">complete/);
  });

  test("the page loads only its own script and the codicons, with a nonce CSP", () => {
    const html = renderOsvPage({ cspSource: "vscode-resource:", scriptUri: "vscode-resource:/media/osv-scanner.js", codiconsUri: "c.css" });
    assert.match(html, /script-src 'nonce-[^']+'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
    assert.ok(!/ style="/.test(html), "no inline style attributes (the CSP would block them)");
    const script = fs.readFileSync(path.resolve(__dirname, "../../../media/osv-scanner.js"), "utf8");
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/.test(script), "advisory text is never parsed as HTML");
    assert.ok(!/setAttribute\(\s*["']style/.test(script));
    assert.doesNotThrow(() => new Function(script), "the page script parses");
  });

  test("the scanner is in the Security section with commands contributed in package.json", () => {
    const security = NAV.find(s => s.id === "security")!;
    const entry = security.entries.find(e => e.command === "osvScanner");
    assert.ok(entry && entry.description.length <= 110);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const commands = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const id of ["osvScanner", "osvScanWorkspace", "osvScanFile"]) assert.ok(commands.has(`sayaib.hue-console.${id}`), id);
    const explorer = pkg.contributes.menus["explorer/context"].find((m: { command: string; when: string }) => m.command.endsWith("osvScanFile") && m.when.includes("resourceFilename"));
    assert.ok(pkg.contributes.menus["explorer/context"].some((m: { command: string; when: string }) => m.command.endsWith("osvScanFile") && m.when.includes("explorerResourceIsFolder") && m.when.includes("!isWeb")), "folders (projects) can be scanned too");
    const pattern = new RegExp(/\/(.+)\//.exec(explorer.when)![1]);
    for (const name of ["package-lock.json", "yarn.lock", "requirements-dev.txt", "Cargo.lock", "App.csproj", "go.mod", "Package.resolved"]) {
      assert.ok(pattern.test(name), `${name} shows the explorer action`);
      assert.ok(detectFileType(name), `${name} is scannable`);
    }
    assert.ok(!pattern.test("README.md"));
    const extension = fs.readFileSync(path.resolve(__dirname, "../../../src/extention.ts"), "utf8");
    assert.match(extension, /registerLazyCommands\(context\.subscriptions, OSV_COMMANDS/, "the scanner loads on first use");
  });
});

/* ------------------------------------------------------------------ *
 * Audit regressions: ecosystems, coverage, conflicts, validation
 * ------------------------------------------------------------------ */

suite("osv: audit regressions", () => {
  test("every adapter has a unique id and recognises its files", () => {
    const ids = FILE_ADAPTERS.map(a => a.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    const samples: Record<string, string> = {
      "conda-lock": "conda-lock.yml", "conda-env": "environment.yml", "swift-package": "Package.swift", "gradle-catalog": "gradle/deps.versions.toml",
      "nuget-assets": "obj/project.assets.json", "requirements": "requirements/prod.txt"
    };
    for (const [id, file] of Object.entries(samples)) assert.strictEqual(detectFileType(file)?.id, id, file);
    for (const adapter of FILE_ADAPTERS) assert.deepStrictEqual(fileTypeById(adapter.id), { id: adapter.id, ecosystem: adapter.ecosystem, kind: adapter.kind, manager: adapter.manager });
    assert.ok(DEPENDENCY_FILE_GLOB.includes("conda-lock.yml") && DEPENDENCY_FILE_GLOB.includes("Package.swift") && DEPENDENCY_FILE_GLOB.includes("settings.gradle"));
  });

  test("Poetry 2 lockfiles: the main group is production; uv and PDM dev dependencies are development", () => {
    const poetry2 = deps("poetry.lock", ["[[package]]", "name = \"django\"", "version = \"4.2.0\"", "groups = [\"main\"]", "", "[[package]]", "name = \"pytest\"", "version = \"8.0.0\"", "groups = [\"dev\"]"].join("\n"));
    assert.strictEqual(byName(poetry2, "django").scope, "production");
    assert.strictEqual(byName(poetry2, "pytest").scope, "development");
    const pyproject = deps("pyproject.toml", ["[project]", "dependencies = [\"httpx==0.27.0\"]", "[tool.uv]", "dev-dependencies = [\"ruff==0.4.0\"]", "[tool.pdm.dev-dependencies]", "test = [\"pytest>=8\"]"].join("\n"));
    assert.deepStrictEqual(pyproject.map(d => `${d.name}:${d.scope}`).sort(), ["httpx:production", "pytest:development", "ruff:development"]);
  });

  test("Conda: pip packages are PyPI; conda channel packages are reported as outside OSV's coverage", () => {
    const lock = parseDependencyFile("conda-lock.yml", [
      "version: 1", "package:",
      "- name: numpy", "  version: 1.24.0", "  manager: conda", "  platform: linux-64",
      "- name: numpy", "  version: 1.24.0", "  manager: conda", "  platform: osx-arm64",
      "- name: Requests", "  version: 2.31.0", "  manager: pip", "  platform: linux-64",
      "- name: Requests", "  version: 2.31.0", "  manager: pip", "  platform: osx-arm64"
    ].join("\n"))!;
    assert.deepStrictEqual(lock.dependencies.map(d => [d.name, d.version, d.skip]), [["numpy", undefined, "source"], ["requests", "2.31.0", undefined]], "one entry per package, not per platform");
    assert.ok(lock.warnings.some(w => /conda package/.test(w)));
    const env = deps("environment.yml", ["name: app", "dependencies:", "  - python=3.11", "  - numpy=1.24", "  - pip", "  - pip:", "    - flask==2.0.0", "    - requests>=2.20"].join("\n"));
    assert.deepStrictEqual(env.map(d => [d.name, d.version ?? d.spec, d.skip]), [["numpy", "numpy=1.24", "source"], ["flask", "2.0.0", undefined], ["requests", ">=2.20", undefined]]);
  });

  test("Package.swift requirements become SwiftPM ranges; exact versions are pinned", () => {
    assert.deepStrictEqual(swiftRequirement('url: "x", from: "0.3.0"'), { spec: ">=0.3.0 <1.0.0" }, "from: means up to the next major, even for 0.x");
    assert.deepStrictEqual(swiftRequirement('url: "x", .upToNextMinor(from: "1.2.0")'), { spec: ">=1.2.0 <1.3.0" });
    assert.deepStrictEqual(swiftRequirement('url: "x", "1.0.0"..<"2.0.0"'), { spec: ">=1.0.0 <2.0.0" });
    assert.deepStrictEqual(swiftRequirement('url: "x", exact: "2.29.0"'), { exact: "2.29.0" });
    const list = deps("Package.swift", [
      "let package = Package(name: \"App\", dependencies: [",
      "  .package(url: \"https://github.com/apple/swift-nio.git\", from: \"2.29.0\"),",
      "  .package(url: \"https://github.com/vapor/vapor.git\", exact: \"4.0.0\"),",
      "  .package(url: \"https://github.com/me/lib.git\", branch: \"main\"),",
      "  .package(path: \"../Local\")",
      "])"
    ].join("\n"));
    assert.deepStrictEqual(list.map(d => [d.name, d.version ?? d.spec ?? null, d.skip ?? null]), [
      ["github.com/apple/swift-nio", ">=2.29.0 <3.0.0", null], ["github.com/vapor/vapor", "4.0.0", null], ["github.com/me/lib", null, "source"]
    ]);
  });

  test("requirements files included with -r are followed, even with names discovery does not match", async () => {
    assert.deepStrictEqual(requirementIncludes("-r base.txt\n--requirement=common/shared.txt\n-c constraints.txt\n-r https://example.com/r.txt\nflask"), ["base.txt", "common/shared.txt"]);
    const fake = standardDb();
    const result = await scan([{ path: "requirements.txt", text: "-r common.txt\nflask==2.0.0\n" }, { path: "common.txt", text: "Django==3.2.0\n", hint: "requirements" }], fake);
    assert.ok(result.findings.some(f => f.packageName === "django"), "the included file's packages are scanned");
    assert.ok(result.files.some(f => f.path === "common.txt"));
  });

  test("a root lockfile covers its workspace members, not an unrelated nested project", async () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: {
      "": { workspaces: ["packages/ui"] }, "packages/ui": { name: "ui", dependencies: { lodash: "^4.17.0" } },
      "node_modules/ui": { resolved: "packages/ui", link: true },
      "node_modules/lodash": { version: "4.17.21", resolved: "https://registry.npmjs.org/lodash.tgz" }
    } });
    const result = await scan([
      { path: "package-lock.json", text: lock },
      { path: "packages/ui/package.json", text: JSON.stringify({ dependencies: { lodash: "^4.17.0" } }) },
      { path: "tools/legacy/package.json", text: JSON.stringify({ dependencies: { lodash: "4.17.20" } }) }
    ], standardDb());
    const versions = result.packages.filter(p => p.name === "lodash").map(p => p.version).sort();
    assert.deepStrictEqual(versions, ["4.17.20", "4.17.21"], "the standalone project keeps its own pinned version");
    assert.ok(result.findings.some(f => f.installedVersion === "4.17.20"));
  });

  test("a lockfile that does not satisfy its manifest is reported; the lockfile version is what gets scanned", async () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { lodash: "^4.17.21" } }, "node_modules/lodash": { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash.tgz" } } });
    const result = await scan([{ path: "package-lock.json", text: lock }, { path: "package.json", text: JSON.stringify({ dependencies: { lodash: "^4.17.21" } }) }], standardDb());
    assert.ok(result.files.find(f => f.path === "package.json")!.warnings.some(w => /asks for "\^4\.17\.21", but package-lock\.json has 4\.17\.20/.test(w)));
    assert.ok(result.limitations.some(l => /out-of-date lockfile/.test(l)));
    assert.strictEqual(result.packages.find(p => p.name === "lodash")!.version, "4.17.20");
    const nested = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { lodash: "^4.17.21" } }, "node_modules/lodash": { version: "4.17.21", resolved: "https://r/x.tgz" }, "node_modules/x/node_modules/lodash": { version: "3.10.1", resolved: "https://r/y.tgz" } } });
    const ok = await scan([{ path: "package-lock.json", text: nested }, { path: "package.json", text: JSON.stringify({ dependencies: { lodash: "^4.17.21" } }) }], standardDb());
    assert.strictEqual(ok.files.find(f => f.path === "package.json")!.warnings.length, 0, "a nested older copy is not a conflict");
  });

  test("malformed advisory records and invalid coordinates never crash the scan or reach OSV", async () => {
    assert.strictEqual(sanitizeRecord({ id: 5 }), undefined);
    const cleaned = sanitizeRecord({ id: "X-1", modified: 3, affected: { not: "an array" }, aliases: ["A", 7], references: [{ url: "https://x" }, "bad"], severity: "HIGH" })!;
    assert.deepStrictEqual([cleaned.affected, cleaned.aliases, cleaned.references, cleaned.severity, cleaned.modified], [[], ["A"], [{ type: undefined, url: "https://x" }], [], ""]);
    assert.ok(validateQuery({ package: { name: "ok", ecosystem: "npm" }, version: "1.0.0" }) === undefined);
    assert.match(validateQuery({ package: { name: "bad\u0000name", ecosystem: "npm" }, version: "1.0.0" })!, /control characters/);
    assert.match(validateQuery({ package: { name: "ok", ecosystem: "npm" }, version: "1.0 beta" })!, /spaces/);

    const fake = new FakeOsv().add({ id: "GHSA-weird-0000-0001", modified: "1", summary: "Odd record", affected: "nope" as never }, [{ ecosystem: "npm", name: "lodash", versions: ["4.17.20"] }]);
    const result = await scan([{ path: "package-lock.json", text: PKG_LOCK }], fake);
    const finding = result.findings.find(f => f.id === "GHSA-weird-0000-0001")!;
    assert.ok(finding, "the finding is kept");
    assert.deepStrictEqual([finding.noFix, finding.fixedIn, finding.severity], [false, undefined, "unknown"], "unknown metadata stays unknown");
  });

  test("dependencies from git or private sources are out of scope, not a reason to call the scan incomplete", async () => {
    const result = await scan([{ path: "package-lock.json", text: PKG_LOCK }], standardDb());
    const git = result.packages.find(p => p.name === "my-git-dep")!;
    assert.deepStrictEqual([git.status, git.skipReason], ["unanalyzed", "source"]);
    assert.strictEqual(result.summary.outOfScopePackages, 1);
    assert.strictEqual(result.status, "complete");
  });
});
