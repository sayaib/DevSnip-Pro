import * as assert from "assert";
import * as vscode from "vscode";
import { osvSessionForTests } from "../osv/panel";

/**
 * The OSV Vulnerability Scanner end to end inside VS Code: commands, workspace
 * discovery through the real file system API, the panel, and a scan against a
 * fake OSV.dev (fetch is replaced, so the suite needs no network and is
 * deterministic). The panel module is the same instance the extension loads.
 */

const EXTENSION_ID = "sayaib.hue-console";
const FIXTURE_DIR = "devsnip-osv-fixture";

const LOCK = JSON.stringify({
  name: "fixture", lockfileVersion: 3,
  packages: {
    "": { dependencies: { lodash: "^4.17.0" } },
    "node_modules/lodash": { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz" },
    "node_modules/express": { version: "4.21.2", resolved: "https://registry.npmjs.org/express/-/express-4.21.2.tgz" }
  }
});

const RECORDS: Record<string, unknown> = {
  "GHSA-29mw-wpgm-hmr9": {
    id: "GHSA-29mw-wpgm-hmr9", modified: "2025-01-01T00:00:00Z", summary: "ReDoS in lodash", aliases: ["CVE-2020-28500"],
    database_specific: { severity: "MODERATE" },
    affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "4.0.0" }, { fixed: "4.17.21" }] }] }]
  },
  "GHSA-2gwj-7jmv-h26r": {
    id: "GHSA-2gwj-7jmv-h26r", modified: "2025-01-01T00:00:00Z", summary: "SQL Injection in Django", aliases: ["CVE-2022-28346"],
    database_specific: { severity: "CRITICAL" },
    affected: [{ package: { name: "django", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "3.2" }, { fixed: "3.2.13" }] }] }]
  }
};

type FetchFn = (url: string, init?: { body?: string; signal?: AbortSignal }) => Promise<unknown>;

function fakeOsv(requests: string[], options: { hang?: boolean } = {}): FetchFn {
  const json = (status: number, body: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  return async (url, init) => {
    requests.push(url);
    if (options.hang) {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if (url.endsWith("/v1/querybatch")) {
      const { queries } = JSON.parse(init!.body!);
      return json(200, {
        results: queries.map((q: { package: { name: string }; version?: string }) => {
          if (q.package.name === "lodash" && q.version === "4.17.20") return { vulns: [{ id: "GHSA-29mw-wpgm-hmr9", modified: "2025-01-01T00:00:00Z" }] };
          if (q.package.name === "django" && q.version === "3.2.0") return { vulns: [{ id: "GHSA-2gwj-7jmv-h26r", modified: "2025-01-01T00:00:00Z" }] };
          return {};
        })
      });
    }
    const id = decodeURIComponent(url.split("/v1/vulns/")[1] ?? "");
    return RECORDS[id] ? json(200, RECORDS[id]) : json(404, { code: 5 });
  };
}

async function waitFor<T>(read: () => T | undefined, ms = 20000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > until) throw new Error("timed out");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

suite("OSV Vulnerability Scanner", function () {
  this.timeout(60000);
  const realFetch = (globalThis as { fetch?: FetchFn }).fetch;
  let root: vscode.Uri | undefined;

  suiteSetup(async function () {
    root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) { this.skip(); return; }
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    const write = (relative: string, text: string) => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root!, FIXTURE_DIR, relative), Buffer.from(text, "utf8"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, FIXTURE_DIR, "web"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, FIXTURE_DIR, "api"));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, FIXTURE_DIR, "web", "node_modules", "dep"));
    await write("web/package-lock.json", LOCK);
    await write("web/package.json", JSON.stringify({ dependencies: { lodash: "^4.17.0" } }));
    await write("web/node_modules/dep/package.json", JSON.stringify({ dependencies: { lodash: "1.0.0" } }));
    await write("api/requirements.txt", "Django==3.2.0\nrequests==2.32.3\n");
  });

  suiteTeardown(async () => {
    (globalThis as { fetch?: FetchFn }).fetch = realFetch;
    if (root) await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, FIXTURE_DIR), { recursive: true, useTrash: false });
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("the commands are registered and the dashboard opens", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["osvScanner", "osvScanWorkspace", "osvScanFile"]) assert.ok(commands.includes(`${EXTENSION_ID}.${id}`), id);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanner`);
    const tab = await waitFor(() => vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.label === "OSV Vulnerability Scanner"));
    assert.ok(tab.input instanceof vscode.TabInputWebview);
  });

  test("scanning the workspace finds the vulnerable lockfile and pinned packages, and nothing else", async () => {
    const requests: string[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = fakeOsv(requests);
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanWorkspace`);
    const result = await waitFor(() => session.result);
    const mine = result.packages.filter(p => p.occurrences.some(o => o.file.startsWith(FIXTURE_DIR)));
    const status = Object.fromEntries(mine.map(p => [`${p.name}@${p.version ?? "?"}`, p.status]));
    assert.strictEqual(status["lodash@4.17.20"], "vulnerable");
    assert.strictEqual(status["django@3.2.0"], "vulnerable");
    assert.strictEqual(status["express@4.21.2"], "clean");
    assert.strictEqual(status["requests@2.32.3"], "clean");
    assert.ok(!mine.some(p => p.occurrences.some(o => o.file.includes("node_modules"))), "installed packages' manifests are skipped");
    const lodash = result.findings.find(f => f.packageName === "lodash")!;
    assert.deepStrictEqual([lodash.id, lodash.severity, lodash.fixedIn, lodash.confidence], ["GHSA-29mw-wpgm-hmr9", "medium", "4.17.21", "confirmed"]);
    const fix = result.remediations.find(r => r.packageName === "lodash")!;
    assert.deepStrictEqual(fix.commands.map(c => [c.cwd, c.command]), [[`${FIXTURE_DIR}/web`, "npm install lodash@4.17.21"]]);
    assert.ok(requests.length > 0 && requests.every(url => url.startsWith("https://api.osv.dev/v1/")), "only the OSV API is contacted");
    assert.ok(!result.partial);
  });

  test("scanning a single file from the explorer", async () => {
    const requests: string[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = fakeOsv(requests);
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanFile`, vscode.Uri.joinPath(root!, FIXTURE_DIR, "api", "requirements.txt"));
    const result = await waitFor(() => session.result);
    assert.strictEqual(result.source, "workspace", "files inside the workspace keep workspace paths, so they can be opened and fixed");
    assert.strictEqual(result.workspace.name, "requirements.txt");
    assert.deepStrictEqual(result.files.map(f => f.path), [`${FIXTURE_DIR}/api/requirements.txt`]);
    assert.deepStrictEqual(result.findings.map(f => f.id), ["GHSA-2gwj-7jmv-h26r"]);
  });

  test("a scan can be cancelled, and the result says so", async () => {
    const requests: string[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = fakeOsv(requests, { hang: true });
    const session = osvSessionForTests(true);
    const done = vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanWorkspace`);
    await waitFor(() => (requests.length ? true : undefined));
    session.running!.controller.abort();
    await done;
    assert.strictEqual(session.running, undefined);
    assert.ok(session.result?.cancelled, "the cancelled scan still reports what it knows");
  });

  test("OSV being unreachable gives a partial result with an explanation, not a crash", async () => {
    (globalThis as { fetch?: FetchFn }).fetch = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanFile`, vscode.Uri.joinPath(root!, FIXTURE_DIR, "api", "requirements.txt"));
    const result = await waitFor(() => session.result);
    assert.ok(result.partial);
    assert.match(result.errors[0], /could not be resolved \(are you offline\?\)/);
    assert.ok(result.packages.every(p => p.status === "unanalyzed"));
  });
});

/* ------------------------------------------------------------------ *
 * Spring Boot / Maven projects through the real host code
 * ------------------------------------------------------------------ */

const MAVEN_DIR = "devsnip-osv-maven-fixture";
const FIXTURE_GROUP = "org.devsnip.fixture";

/** POM text for the fake Maven Central (a Spring Boot-shaped parent, BOM and starter). */
function centralPom(artifactId: string, version: string, inner: string, parent?: string): string {
  return `<project><modelVersion>4.0.0</modelVersion>${parent ? `<parent><groupId>${FIXTURE_GROUP}</groupId><artifactId>${parent}</artifactId><version>${version}</version></parent>` : `<groupId>${FIXTURE_GROUP}</groupId>`}<artifactId>${artifactId}</artifactId><version>${version}</version>${inner}</project>`;
}

const CENTRAL: Record<string, string> = {
  [`fixture-dependencies/2.0.0`]: centralPom("fixture-dependencies", "2.0.0", `<packaging>pom</packaging><properties><tomcat.version>9.0.60</tomcat.version></properties><dependencyManagement><dependencies>
    <dependency><groupId>${FIXTURE_GROUP}</groupId><artifactId>fixture-starter-web</artifactId><version>2.0.0</version></dependency>
    <dependency><groupId>${FIXTURE_GROUP}</groupId><artifactId>fixture-tomcat</artifactId><version>\${tomcat.version}</version></dependency>
  </dependencies></dependencyManagement>`),
  [`fixture-starter-parent/2.0.0`]: centralPom("fixture-starter-parent", "2.0.0", "<packaging>pom</packaging>", "fixture-dependencies"),
  [`fixture-starter-web/2.0.0`]: centralPom("fixture-starter-web", "2.0.0", `<dependencies><dependency><groupId>${FIXTURE_GROUP}</groupId><artifactId>fixture-tomcat</artifactId><version>9.0.60</version></dependency></dependencies>`),
  [`fixture-tomcat/9.0.60`]: centralPom("fixture-tomcat", "9.0.60", "")
};

function mavenAndOsv(requests: string[]): FetchFn {
  const json = (status: number, body: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const record = { id: "GHSA-fixt-ure0-0001", modified: "2025-01-01T00:00:00Z", summary: "Fixture Tomcat issue", database_specific: { severity: "HIGH" },
    affected: [{ package: { name: `${FIXTURE_GROUP}:fixture-tomcat`, ecosystem: "Maven" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "9.0.0" }, { fixed: "9.0.62" }] }] }] };
  return async (url, init) => {
    requests.push(url);
    const central = /maven2\/org\/devsnip\/fixture\/([^/]+)\/([^/]+)\/[^/]+\.pom$/.exec(url);
    if (central) return CENTRAL[`${central[1]}/${central[2]}`] ? json(200, CENTRAL[`${central[1]}/${central[2]}`]) : json(404, "");
    if (url.includes("repo.maven.apache.org")) return json(404, "");
    if (url.endsWith("/v1/querybatch")) {
      const { queries } = JSON.parse(init!.body!);
      return json(200, { results: queries.map((q: { package: { name: string }; version?: string }) => (q.package.name.endsWith(":fixture-tomcat") && q.version === "9.0.60" ? { vulns: [{ id: record.id, modified: record.modified }] } : {})) });
    }
    if (url.endsWith(`/v1/vulns/${record.id}`)) return json(200, record);
    return json(404, { code: 5 });
  };
}

suite("OSV Vulnerability Scanner: Maven projects", function () {
  this.timeout(120000);
  const realFetch = (globalThis as { fetch?: FetchFn }).fetch;
  const config = () => vscode.workspace.getConfiguration("devsnip.osvScanner");
  let root: vscode.Uri | undefined;

  suiteSetup(async function () {
    root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) { this.skip(); return; }
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    const write = async (relative: string, text: string) => {
      const uri = vscode.Uri.joinPath(root!, MAVEN_DIR, relative);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
      await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
    };
    await write("pom.xml", `<project><modelVersion>4.0.0</modelVersion><parent><groupId>${FIXTURE_GROUP}</groupId><artifactId>fixture-starter-parent</artifactId><version>2.0.0</version><relativePath/></parent>
      <groupId>com.example</groupId><artifactId>boot-app</artifactId><version>1.0.0</version><packaging>pom</packaging><modules><module>web</module></modules></project>`);
    await write("web/pom.xml", `<project><modelVersion>4.0.0</modelVersion><parent><groupId>com.example</groupId><artifactId>boot-app</artifactId><version>1.0.0</version></parent>
      <artifactId>web</artifactId><dependencies>
        <dependency><groupId>${FIXTURE_GROUP}</groupId><artifactId>fixture-starter-web</artifactId></dependency>
        <dependency><groupId>${FIXTURE_GROUP}</groupId><artifactId>not-managed</artifactId></dependency>
      </dependencies></project>`);
  });

  suiteTeardown(async () => {
    (globalThis as { fetch?: FetchFn }).fetch = realFetch;
    await config().update("buildToolResolution", undefined, vscode.ConfigurationTarget.Global);
    await config().update("downloadPoms", undefined, vscode.ConfigurationTarget.Global);
    if (root) await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, MAVEN_DIR), { recursive: true, useTrash: false });
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("a Spring Boot-style project: the starter's transitive dependency is found, and the unmanaged one is reported", async () => {
    await config().update("buildToolResolution", "never", vscode.ConfigurationTarget.Global);
    await config().update("downloadPoms", true, vscode.ConfigurationTarget.Global);
    const requests: string[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = mavenAndOsv(requests);
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanFile`, vscode.Uri.joinPath(root!, MAVEN_DIR, "web", "pom.xml"));
    const result = await waitFor(() => session.result);
    const tomcat = result.packages.find(p => p.name === `${FIXTURE_GROUP}:fixture-tomcat`);
    assert.ok(tomcat, "the transitive dependency of the starter is scanned");
    assert.deepStrictEqual([tomcat!.version, tomcat!.status, tomcat!.direct], ["9.0.60", "vulnerable", false]);
    assert.deepStrictEqual(tomcat!.occurrences[0].via, [`${FIXTURE_GROUP}:fixture-starter-web:2.0.0`]);
    assert.deepStrictEqual(result.findings.map(f => f.id), ["GHSA-fixt-ure0-0001"]);
    const unmanaged = result.packages.find(p => p.name === `${FIXTURE_GROUP}:not-managed`)!;
    assert.deepStrictEqual([unmanaged.status, unmanaged.skipReason], ["unanalyzed", "unresolved"]);
    assert.strictEqual(result.status, "incomplete");
    assert.ok(requests.some(url => url.startsWith("https://repo.maven.apache.org/maven2/org/devsnip/fixture/fixture-starter-parent/2.0.0/")), "the parent POM comes from Maven Central");
    assert.deepStrictEqual(result.diagnostics.buildTools.map(m => m.method), ["builtin"]);
  });

  test("POM downloads off: nothing is downloaded: versions from a parent that is not available locally are unresolved", async () => {
    await config().update("buildToolResolution", "never", vscode.ConfigurationTarget.Global);
    await config().update("downloadPoms", false, vscode.ConfigurationTarget.Global);
    const requests: string[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = mavenAndOsv(requests);
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanFile`, vscode.Uri.joinPath(root!, MAVEN_DIR, "web", "pom.xml"));
    const result = await waitFor(() => session.result);
    assert.ok(!requests.some(url => url.includes("repo.maven.apache.org")), "nothing is downloaded");
    assert.strictEqual(result.status, "incomplete");
    assert.ok(result.packages.some(p => p.name === `${FIXTURE_GROUP}:fixture-starter-web` && p.skipReason === "unresolved"));
  });

  test("with Maven installed (opt-in: DEVSNIP_TEST_MAVEN_LIVE=1), Maven's own tree is used", async function () {
    if (process.env.DEVSNIP_TEST_MAVEN_LIVE !== "1") { this.skip(); return; }
    await config().update("buildToolResolution", "always", vscode.ConfigurationTarget.Global);
    await config().update("downloadPoms", true, vscode.ConfigurationTarget.Global);
    (globalThis as { fetch?: FetchFn }).fetch = realFetch;
    const dir = vscode.Uri.joinPath(root!, MAVEN_DIR, "live");
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, "pom.xml"), Buffer.from(`<project><modelVersion>4.0.0</modelVersion>
      <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>2.6.6</version><relativePath/></parent>
      <groupId>com.example</groupId><artifactId>live</artifactId><version>1.0.0</version>
      <dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`, "utf8"));
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanFile`, vscode.Uri.joinPath(dir, "pom.xml"));
    const result = await waitFor(() => session.result, 600000);
    assert.deepStrictEqual(result.diagnostics.buildTools.map(m => m.method), ["build-tool"]);
    assert.ok(result.files.some(f => /^Maven \(.*dependency:tree\)$/.test(f.resolvedBy ?? "")));
    const tomcat = result.packages.find(p => p.name === "org.apache.tomcat.embed:tomcat-embed-core");
    assert.strictEqual(tomcat?.version, "9.0.60");
    assert.strictEqual(tomcat?.status, "vulnerable");
    // Spring Boot 2.6.6 ships Spring Framework 5.3.18, the release that fixed Spring4Shell: patched, so not flagged.
    assert.strictEqual(result.packages.find(p => p.name === "org.springframework:spring-beans")?.version, "5.3.18");
    assert.ok(!result.findings.some(f => [f.id, ...f.aliases].includes("CVE-2022-22965")), "a patched version is not reported");
    // SnakeYAML 1.29 arrives through spring-boot-starter and has the documented CVE-2022-1471 (GHSA-mjmj-j48q-9wg2).
    const yaml = result.findings.find(f => f.packageName === "org.yaml:snakeyaml" && [f.id, ...f.aliases].includes("CVE-2022-1471"));
    assert.ok(yaml, "a documented advisory in a transitive dependency is reported");
    assert.strictEqual(result.packages.find(p => p.name === "org.yaml:snakeyaml")?.direct, false);
  });

  test("with Gradle installed (opt-in: DEVSNIP_TEST_GRADLE_LIVE=1, gradle on PATH), Gradle's own resolution is used", async function () {
    if (process.env.DEVSNIP_TEST_GRADLE_LIVE !== "1") { this.skip(); return; }
    await config().update("buildToolResolution", "always", vscode.ConfigurationTarget.Global);
    (globalThis as { fetch?: FetchFn }).fetch = realFetch;
    const dir = vscode.Uri.joinPath(root!, MAVEN_DIR, "gradle-live");
    const write = (rel: string, text: string) => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, rel), Buffer.from(text, "utf8"));
    await vscode.workspace.fs.createDirectory(dir);
    await write("settings.gradle", "rootProject.name = 'live'\n");
    await write("build.gradle", "plugins {\n  id 'java'\n  id 'org.springframework.boot' version '2.7.0'\n  id 'io.spring.dependency-management' version '1.0.11.RELEASE'\n}\nrepositories { mavenCentral() }\ndependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }\n");
    const session = osvSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.osvScanFile`, dir);
    const result = await waitFor(() => session.result, 900000);
    assert.deepStrictEqual(result.diagnostics.buildTools.map(m => [m.tool, m.method]), [["Gradle", "build-tool"]]);
    const tomcat = result.packages.find(p => p.name === "org.apache.tomcat.embed:tomcat-embed-core");
    assert.deepStrictEqual([tomcat?.version, tomcat?.direct, tomcat?.status], ["9.0.63", false, "vulnerable"]);
    assert.ok(result.findings.some(f => f.packageName === "org.yaml:snakeyaml" && [f.id, ...f.aliases].includes("CVE-2022-1471")), "SnakeYAML's documented advisory, through the starter");
  });
});
