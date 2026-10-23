import * as assert from "assert";
import * as vscode from "vscode";
import { scaMessageForTests, scaSessionForTests } from "../sca/panel";

/**
 * The SCA Scanner end to end inside VS Code: commands, project detection and
 * selection, the shared engine resolving a Spring Boot-shaped Maven reactor
 * from a fake Maven Central, KEV / NVD / registry enrichment, BOM-aware
 * remediation, diff previews, the confirmation gate on edits, cancellation and
 * offline behaviour. fetch is replaced, so nothing touches the network.
 */

const EXTENSION_ID = "sayaib.hue-console";
const DIR = "devsnip-sca-fixture";
const GROUP = "org.devsnip.scafixture";
type FetchFn = (url: string, init?: { body?: string; signal?: AbortSignal; headers?: Record<string, string> }) => Promise<unknown>;

function pom(artifactId: string, version: string, inner: string, parent?: string): string {
  return `<project><modelVersion>4.0.0</modelVersion>${parent ? `<parent><groupId>${GROUP}</groupId><artifactId>${parent}</artifactId><version>${version}</version></parent>` : `<groupId>${GROUP}</groupId>`}<artifactId>${artifactId}</artifactId><version>${version}</version>${inner}</project>`;
}
const deps = (tomcat: string) => `<packaging>pom</packaging><properties><tomcat.version>${tomcat}</tomcat.version></properties><dependencyManagement><dependencies>
  <dependency><groupId>${GROUP}</groupId><artifactId>boot-starter-web</artifactId><version>2.0.0</version></dependency>
  <dependency><groupId>${GROUP}</groupId><artifactId>tomcat-core</artifactId><version>\${tomcat.version}</version></dependency>
</dependencies></dependencyManagement>`;

const CENTRAL: Record<string, string> = {
  "boot-dependencies/2.0.0": pom("boot-dependencies", "2.0.0", deps("9.0.60")),
  "boot-dependencies/2.0.1": pom("boot-dependencies", "2.0.1", deps("9.0.62")),
  "boot-starter-parent/2.0.0": pom("boot-starter-parent", "2.0.0", "<packaging>pom</packaging>", "boot-dependencies"),
  "boot-starter-web/2.0.0": pom("boot-starter-web", "2.0.0", `<dependencies><dependency><groupId>${GROUP}</groupId><artifactId>tomcat-core</artifactId><version>9.0.60</version></dependency></dependencies>`),
  "tomcat-core/9.0.60": pom("tomcat-core", "9.0.60", "")
};
const METADATA: Record<string, string[]> = { "boot-dependencies": ["1.9.0", "2.0.0", "2.0.1", "2.1.0-RC1"], "boot-starter-web": ["2.0.0", "2.0.1"] };

const TOMCAT = { id: "GHSA-scaf-ixtu-re01", modified: "2025-01-01T00:00:00Z", summary: "Fixture Tomcat request smuggling", aliases: ["CVE-2099-0001"], database_specific: { severity: "CRITICAL" },
  affected: [{ package: { name: `${GROUP}:tomcat-core`, ecosystem: "Maven" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "9.0.0" }, { fixed: "9.0.62" }] }] }] };
const LODASH = { id: "GHSA-29mw-wpgm-hmr9", modified: "2025-01-01T00:00:00Z", summary: "ReDoS in lodash", aliases: ["CVE-2020-28500"],
  affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "4.0.0" }, { fixed: "4.17.21" }] }] }] };

interface Seen { url: string; body?: string }

function fakeInternet(seen: Seen[], options: { hangOsv?: boolean; offline?: boolean } = {}): FetchFn {
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body });
  return async (url, init) => {
    seen.push({ url, body: init?.body });
    if (options.offline) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    if (options.hangOsv && url.includes("api.osv.dev")) {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    const central = /maven2\/org\/devsnip\/scafixture\/([^/]+)\/([^/]+)\/[^/]+\.pom$/.exec(url);
    if (central) return CENTRAL[`${central[1]}/${central[2]}`] ? reply(200, CENTRAL[`${central[1]}/${central[2]}`]) : reply(404, "");
    const metadata = /maven2\/org\/devsnip\/scafixture\/([^/]+)\/maven-metadata\.xml$/.exec(url);
    if (metadata) return METADATA[metadata[1]] ? reply(200, `<metadata><versioning><versions>${METADATA[metadata[1]].map(v => `<version>${v}</version>`).join("")}</versions></versioning></metadata>`) : reply(404, "");
    if (url.includes("repo.maven.apache.org")) return reply(404, "");
    if (url.endsWith("/v1/querybatch")) {
      const { queries } = JSON.parse(init!.body!);
      return reply(200, { results: queries.map((q: { package: { name: string }; version?: string }) =>
        q.package.name === `${GROUP}:tomcat-core` && q.version === "9.0.60" ? { vulns: [{ id: TOMCAT.id, modified: TOMCAT.modified }] }
          : q.package.name === "lodash" && q.version === "4.17.20" ? { vulns: [{ id: LODASH.id, modified: LODASH.modified }] } : {}) });
    }
    if (url.endsWith(`/v1/vulns/${TOMCAT.id}`)) return reply(200, TOMCAT);
    if (url.endsWith(`/v1/vulns/${LODASH.id}`)) return reply(200, LODASH);
    if (url.startsWith("https://www.cisa.gov/")) return reply(200, { catalogVersion: "fixture", vulnerabilities: [{ cveID: "CVE-2099-0001", vendorProject: "Fixture", product: "Tomcat", vulnerabilityName: "Fixture Tomcat smuggling", dateAdded: "2099-01-01" }] });
    if (url.startsWith("https://services.nvd.nist.gov/")) {
      return reply(200, { vulnerabilities: [{ cve: { id: "CVE-2020-28500", metrics: { cvssMetricV31: [{ source: "nvd@nist.gov", type: "Primary", cvssData: { baseScore: 5.3, baseSeverity: "MEDIUM", vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L" } }] } } }] });
    }
    if (url === "https://registry.npmjs.org/lodash") return reply(200, { "dist-tags": { latest: "4.17.21" }, versions: { "4.17.20": {} } });
    return reply(404, {});
  };
}

async function waitFor<T>(read: () => T | undefined, ms = 30000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > until) throw new Error("timed out");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

suite("SCA Scanner", function () {
  this.timeout(120000);
  const realFetch = (globalThis as { fetch?: FetchFn }).fetch;
  const build = () => vscode.workspace.getConfiguration("devsnip.osvScanner");
  let root: vscode.Uri | undefined;
  const rootPom = `<project><modelVersion>4.0.0</modelVersion>
    <parent><groupId>${GROUP}</groupId><artifactId>boot-starter-parent</artifactId><version>2.0.0</version><relativePath/></parent>
    <groupId>com.example</groupId><artifactId>shop</artifactId><version>1.0.0</version><packaging>pom</packaging>
    <properties><java.version>17</java.version></properties>
    <modules><module>web</module></modules>
</project>
`;

  suiteSetup(async function () {
    root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) { this.skip(); return; }
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    await build().update("buildToolResolution", "never", vscode.ConfigurationTarget.Global);
    await build().update("downloadPoms", true, vscode.ConfigurationTarget.Global);
    const write = async (relative: string, text: string) => {
      const uri = vscode.Uri.joinPath(root!, DIR, relative);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
      await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
    };
    await write("api/pom.xml", rootPom);
    await write("api/web/pom.xml", `<project><modelVersion>4.0.0</modelVersion><parent><groupId>com.example</groupId><artifactId>shop</artifactId><version>1.0.0</version></parent>
      <artifactId>web</artifactId><dependencies><dependency><groupId>${GROUP}</groupId><artifactId>boot-starter-web</artifactId></dependency></dependencies></project>`);
    await write("ui/package.json", JSON.stringify({ name: "ui", dependencies: { lodash: "^4.17.0" } }, null, 2) + "\n");
    // Discovery: a vendored folder beside composer.json is left out; a project in a folder named "deps" is not; build.sbt is unsupported.
    await write("php/composer.json", JSON.stringify({ require: { "guzzlehttp/guzzle": "7.4.0" } }));
    await write("php/composer.lock", JSON.stringify({ packages: [{ name: "guzzlehttp/guzzle", version: "7.4.0" }], "packages-dev": [] }));
    await write("php/vendor/guzzlehttp/guzzle/composer.json", JSON.stringify({ name: "guzzlehttp/guzzle", require: { "psr/http-message": "1.0" } }));
    await write("deps/shared/package.json", JSON.stringify({ name: "shared", dependencies: { qs: "6.5.1" } }));
    await write("scala/build.sbt", 'libraryDependencies += "com.typesafe.akka" %% "akka-http" % "10.1.0"\n');
    await write("ui/package-lock.json", JSON.stringify({ name: "ui", lockfileVersion: 3, packages: { "": { dependencies: { lodash: "^4.17.0" } }, "node_modules/lodash": { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz" } } }));
  });

  suiteTeardown(async () => {
    (globalThis as { fetch?: FetchFn }).fetch = realFetch;
    await build().update("buildToolResolution", undefined, vscode.ConfigurationTarget.Global);
    await build().update("downloadPoms", undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (root) await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, DIR), { recursive: true, useTrash: false });
  });

  test("the commands are registered and the dashboard opens", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["scaScanner", "scaScanWorkspace"]) assert.ok(commands.includes(`${EXTENSION_ID}.${id}`), id);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.scaScanner`);
    const tab = await waitFor(() => vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.label === "SCA Scanner"));
    assert.ok(tab.input instanceof vscode.TabInputWebview);
  });

  test("a workspace scan resolves the Spring Boot-style reactor, enriches findings and proposes a BOM-safe fix", async () => {
    const seen: Seen[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = fakeInternet(seen);
    const session = scaSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.scaScanWorkspace`);
    const result = await waitFor(() => session.result);
    const projects = result.projects.filter(p => p.dir.startsWith(DIR)).map(p => [p.dir, p.name, p.springBoot ?? ""]);
    assert.deepStrictEqual(projects, [[`${DIR}/api`, "shop", ""], [`${DIR}/deps/shared`, "shared", ""], [`${DIR}/php`, "php", ""], [`${DIR}/ui`, "ui", ""]]);
    const tomcat = result.vulnerabilities.find(v => v.finding.packageName === `${GROUP}:tomcat-core`)!;
    assert.ok(tomcat, "the starter's transitive dependency is found");
    assert.deepStrictEqual([tomcat.relation, tomcat.kev?.cveId, tomcat.severity], ["transitive", "CVE-2099-0001", "critical"]);
    assert.deepStrictEqual(tomcat.paths, [[`${GROUP}:boot-starter-web:2.0.0`]]);
    const lodash = result.vulnerabilities.find(v => v.finding.packageName === "lodash")!;
    assert.deepStrictEqual([lodash.severity, lodash.cvssScore], ["medium", 5.3], "NVD scored the advisory OSV had no severity for");
    assert.ok(result.health.some(h => h.packageName === "lodash" && h.kind === "outdated" && h.class === "informational"));
    const advice = result.advice.find(a => a.packageName === `${GROUP}:tomcat-core`)!;
    assert.deepStrictEqual(advice.options.map(o => [o.title, o.risk, o.edit?.op, o.edit?.file]), [
      ["Upgrade boot-dependencies 2.0.0 → 2.0.1", "low", "pom-parent", `${DIR}/api/pom.xml`],
      ["Override tomcat.version to 9.0.62", "medium", "pom-property", `${DIR}/api/pom.xml`]
    ]);
    // Privacy: OSV gets package coordinates, NVD a CVE id, registries a package name; no file content anywhere.
    for (const request of seen) {
      assert.ok(!request.body?.includes("java.version") && !request.body?.includes("<project"), `no manifest content in ${request.url}`);
    }
    const nvd = seen.filter(r => r.url.startsWith("https://services.nvd.nist.gov/"));
    assert.deepStrictEqual(nvd.map(r => r.url), ["https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2020-28500"]);
    const osvBodies = seen.filter(r => r.url.endsWith("/v1/querybatch")).flatMap(r => JSON.parse(r.body!).queries);
    assert.ok(osvBodies.every((q: Record<string, unknown>) => Object.keys(q).every(k => ["package", "version", "page_token"].includes(k))));
  });

  test("discovery skips vendored output, keeps real projects in output-named folders, and reports unsupported files", async () => {
    const session = scaSessionForTests();
    const result = session.result!;
    const files = result.scan.files.map(f => f.path).filter(f => f.startsWith(DIR));
    assert.ok(files.includes(`${DIR}/php/composer.lock`) && files.includes(`${DIR}/deps/shared/package.json`), files.join(", "));
    assert.ok(!files.some(f => f.includes("/vendor/")), "the vendored package's composer.json is not a project");
    assert.ok(result.scan.packages.some(p => p.name === "qs" && p.version === "6.5.1"), "the project in deps/ is scanned");
    assert.deepStrictEqual(result.scan.unsupportedFiles?.filter(u => u.path.startsWith(DIR)), [{ path: `${DIR}/scala/build.sbt`, format: "sbt (Scala)" }]);
    assert.strictEqual(result.status, "incomplete");
    assert.ok(result.diagnostics.incompleteReasons.some(r => /unsupported format/.test(r)));
    assert.ok(result.diagnostics.files.leftOutAsBuildOutput >= 1);
  });

  test("a preview opens a diff, and nothing is written without confirmation", async () => {
    const session = scaSessionForTests();
    const option = session.result!.advice.find(a => a.packageName === `${GROUP}:tomcat-core`)!.options[1];
    await scaMessageForTests({ type: "preview", option: option.id });
    const diff = await waitFor(() => vscode.window.tabGroups.all.flatMap(g => g.tabs).find(t => t.input instanceof vscode.TabInputTextDiff));
    const input = diff.input as vscode.TabInputTextDiff;
    assert.strictEqual(input.modified.scheme, "devsnip-sca-preview");
    const proposed = (await vscode.workspace.openTextDocument(input.modified)).getText();
    assert.ok(proposed.includes("<tomcat.version>9.0.62</tomcat.version>") && proposed.includes("<java.version>17</java.version>"));
    // The test host cannot show modal dialogs, which confirmAction treats as "not confirmed".
    await scaMessageForTests({ type: "apply", option: option.id });
    const onDisk = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root!, DIR, "api", "pom.xml"))).toString("utf8");
    assert.strictEqual(onDisk, rootPom, "unchanged without the user's confirmation");
    await scaMessageForTests({ type: "apply", option: "made-up::option" });
    assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root!, DIR, "api", "pom.xml"))).toString("utf8"), rootPom, "edits not proposed by the scan are refused");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("scanning selected projects scans only those", async () => {
    const seen: Seen[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = fakeInternet(seen);
    const session = scaSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.scaScanner`);
    await scaMessageForTests({ type: "scan", projects: [`${DIR}/ui`] });
    const result = await waitFor(() => session.result);
    assert.deepStrictEqual(result.projects.map(p => p.dir), [`${DIR}/ui`]);
    assert.deepStrictEqual(result.scan.packages.map(p => p.name), ["lodash"]);
    assert.ok(!seen.some(r => r.url.includes("repo.maven.apache.org")), "the Maven project was not resolved");
  });

  test("a scan can be cancelled", async () => {
    const seen: Seen[] = [];
    (globalThis as { fetch?: FetchFn }).fetch = fakeInternet(seen, { hangOsv: true });
    const session = scaSessionForTests(true);
    const done = vscode.commands.executeCommand(`${EXTENSION_ID}.scaScanWorkspace`);
    await waitFor(() => (seen.some(r => r.url.includes("api.osv.dev")) ? true : undefined));
    session.running!.controller.abort();
    await done;
    await waitFor(() => (session.running ? undefined : true));
    assert.ok(!session.result || session.result.status === "cancelled");
    assert.ok(!seen.some(r => r.url.startsWith("https://www.cisa.gov/")), "no enrichment after cancelling");
  });

  test("offline: the result is incomplete and says why, instead of looking clean", async () => {
    (globalThis as { fetch?: FetchFn }).fetch = fakeInternet([], { offline: true });
    const session = scaSessionForTests(true);
    await vscode.commands.executeCommand(`${EXTENSION_ID}.scaScanner`);
    await scaMessageForTests({ type: "scan", projects: [`${DIR}/ui`] });
    const result = await waitFor(() => session.result);
    assert.strictEqual(result.status, "incomplete");
    assert.strictEqual(result.vulnerabilities.length, 0);
    assert.ok(result.scan.packages.every(p => p.status === "unanalyzed"));
    assert.strictEqual(result.providers.find(p => p.id === "kev")?.status, "unavailable");
  });
});
