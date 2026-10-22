# OSV Vulnerability Scanner

The OSV Vulnerability Scanner finds dependencies with known vulnerabilities. It reads the lockfiles and manifests in your workspace, asks [OSV.dev](https://osv.dev) about every package version, and shows the results as a security dashboard with fixes. OSV.dev aggregates the GitHub Advisory Database, PyPA, the Go vulnerability database, RustSec and others.

It is part of DevSnip Pro (since 11.80.1). It is in the **Security & Auth** section of the Tools sidebar and in Browse All Tools.

## Install

1. Install DevSnip Pro from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console), or run `code --install-extension sayaib.hue-console`.
2. Open the folder or workspace you want to check.

Nothing else is needed: no account, no API key, no CLI. The scanner talks to the public OSV API over HTTPS.

## Use

| To… | Do this |
| --- | --- |
| Open the dashboard | Tools sidebar → Security & Auth → **OSV Vulnerability Scanner**, or run **DevSnip Pro: OSV Vulnerability Scanner** |
| Scan the workspace straight away | Run **DevSnip Pro: Scan Workspace Dependencies for Vulnerabilities (OSV)** |
| Scan one lockfile or manifest | Right-click it in the Explorer → **Scan for Vulnerabilities (OSV)** (multi-select works), or run the command with the file open |
| Scan one project of a monorepo | Right-click its folder in the Explorer → **Scan for Vulnerabilities (OSV)** |
| Scan files without opening a folder | **Scan Files…** in the dashboard |
| Scan again | **Scan Again**. Use ⋯ → *Scan again, ignoring cached answers* to re-ask OSV about every package |
| Export | **Export** → *HTML report* (self-contained, printable) or *JSON* (machine-readable) |

Above the tabs, the dashboard shows the scan's status and coverage:

- **Status.** One of three:
  - *Scan complete*: every dependency in scope was resolved and checked.
  - *Scan incomplete*: some dependencies could not be resolved, OSV could not be queried for some, an advisory's details failed to load, or a file could not be read. The banner lists what was not checked, with buttons to show those packages, open the build-tool settings and show the log.
  - *Scan cancelled.*

  An incomplete scan with no findings is never shown as a clean result.
- **Coverage.** The numbers of dependencies:
  - discovered;
  - analysed;
  - unresolved (version unknown);
  - failed (OSV could not be queried);
  - out of scope (git, local paths, private sources).

  It also shows the numbers of vulnerable packages and of unique vulnerabilities.
- **Severity cards.** They count exactly the findings listed below them.

The dashboard has five tabs:

- **Findings.** The severity cards are clickable filters. You can also:
  - search by package, advisory ID, CVE or text (<kbd>/</kbd> focuses the search box);
  - filter by severity, ecosystem, confidence (confirmed or potential) and scope (production or development);
  - group by severity or package, and sort by severity, CVSS score, package, date or ID.

  Expand a finding to see:
  - the summary and full description;
  - the installed version, the fixed version, the affected ranges and every fixed version;
  - the severity and where it came from, with the CVSS vector;
  - the aliases (CVE, GHSA, PYSEC, GO, RUSTSEC…), with links;
  - the dates and CWE;
  - every file and line where the package appears (click to open), whether it is direct or transitive, and its dependency path (for example *via spring-boot-starter-web 2.6.6 → spring-boot-starter-tomcat 2.6.6*);
  - the remediation, the references, and links to the OSV record and the advisory.
- **Packages.** Every unique package and version, with its status:
  - *Vulnerable*;
  - *Potentially affected*;
  - *Not analysed*, with the reason;
  - *No known issues*.

  It also shows whether the package is direct or transitive, and dev-only packages.
- **Fixes.** One upgrade plan per package:
  - the target version, and whether OSV lists any advisory for that version;
  - the commands for the package manager that wrote the lockfile;
  - guidance for transitive dependencies (overrides, resolutions, dependency management).

  *Copy All Commands* copies every command at once.
- **Files.** Every dependency file that was read, with:
  - its ecosystem and its type (lockfile, manifest, or *resolved tree* for Maven and Gradle projects);
  - its package manager and its package count;
  - how it was resolved;
  - any warnings, such as a lockfile that does not satisfy its manifest.
- **Scan notes.** What this scan could not cover, any errors, how each Maven and Gradle build was resolved, and pipeline counters for each stage (see [Troubleshooting](#troubleshooting)).

Every finding and package is listed, with no hidden pages. Long lists are drawn in chunks, so thousands of rows do not freeze the panel.

### Fixing

Nothing is changed automatically:

- **Copy** puts a command on the clipboard.
- **Run…** shows the exact command and folder in a modal dialog. It sends the command to a new terminal only after you confirm. It only runs commands the current scan suggested.

Scan again afterwards to confirm the fix.

## Supported ecosystems and files

| Ecosystem (OSV name) | Resolved (exact versions, transitive dependencies) | Manifests (declared dependencies) |
| --- | --- | --- |
| npm | `package-lock.json` (v1–v3), `npm-shrinkwrap.json`, `yarn.lock` (Yarn 1 and Berry), `pnpm-lock.yaml` (v5–v9), `bun.lock` | `package.json` |
| PyPI | `poetry.lock` (Poetry 1 and 2), `uv.lock`, `pdm.lock`, `Pipfile.lock`, the pip packages in `conda-lock.yml` | `requirements*.txt`, `*-requirements.txt`, `requirements/*.txt` and any file they include with `-r`; `pyproject.toml` (PEP 621, dependency groups, Poetry, uv and PDM dev dependencies); `Pipfile`; the `pip:` section of `environment.yml` |
| Maven (Java, Kotlin, Spring Boot) | `pom.xml` resolved to its full tree ([how](#resolving-maven-and-gradle-projects)); `build.gradle(.kts)` resolved by Gradle; `gradle.lockfile`, `gradle/dependency-locks/*.lockfile` | `build.gradle(.kts)` read without Gradle (Spring Boot BOM, `mavenBom`, `platform`); `*.versions.toml` version catalogs |
| Go | `go.mod` (every module compiled into the build, at its selected version, since Go 1.17; `replace` is applied) | — |
| crates.io | `Cargo.lock` | `Cargo.toml` |
| RubyGems | `Gemfile.lock`, `gems.locked` | `Gemfile`, `gems.rb` |
| NuGet | `packages.lock.json`, `obj/project.assets.json` | `*.csproj`, `*.fsproj`, `*.vbproj` (with `Directory.Packages.props`), `packages.config` |
| Packagist | `composer.lock` | `composer.json` |
| Pub | `pubspec.lock` | `pubspec.yaml` |
| Hex | `mix.lock` | — |
| SwiftURL | `Package.resolved` (v1–v3, including inside `.xcodeproj` / `.xcworkspace`) | `Package.swift` (`from:`, `exact:`, `.upToNextMinor`, ranges) |
| CRAN | `renv.lock` | — |

Each format is one adapter in `src/osv/parsers.ts` (`FILE_ADAPTERS`): a file-name matcher and a parser. Adding an OSV ecosystem means adding an adapter and its unit tests.

**Not used, by design:**
- `go.sum` records the hashes of every module version Go has considered, not the versions it selected. Scanning it would report versions your build does not use. This was checked with Go 1.23: `go.mod` held every compiled module at its selected version, while `go list -m all` added 10 graph-only modules that were never compiled.
- Conda channel packages are listed as out of scope, because OSV has no conda ecosystem.

**Monorepos, nested projects and multiple package managers:**

- **Every file is found.** Discovery covers the whole workspace, including every folder of a multi-root workspace. It skips `node_modules`, `vendor`, virtual environments, `target`, `dist`, `build`, `.gradle`, `Pods`, `.dart_tool` and similar folders. Those hold installed dependencies or build output, not projects of their own.
- **Workspace lockfiles cover their members only.** A lockfile covers manifests in its own folder and in the member folders it records:
  - npm v2/v3 package paths;
  - pnpm importers;
  - Yarn Berry and Bun workspaces.

  A standalone project nested inside, with its own pinned versions, is scanned on its own. Formats that do not record members (Yarn 1, Cargo) cover the folders below them by package name.
- **Maven reactors and Gradle multi-project builds are resolved as one build.** Module-to-module dependencies count as transitive, and your own modules are never queried as packages.
- **Commands run in the right folder.** The Fixes tab gives each project its own working directory.

## Resolving Maven and Gradle projects

A Spring Boot project usually declares only starters, without versions, and gets most of its libraries transitively. Reading `pom.xml` or `build.gradle` alone would miss nearly all of them. Each build is therefore resolved to its full dependency tree, in this order of preference.

**Maven (`pom.xml`)**

1. **Maven itself**, when allowed (see [Settings](#settings)). The command is `./mvnw` (or `mvn` on PATH), running `org.apache.maven.plugins:maven-dependency-plugin:3.6.1:tree` once per reactor.
   - Nothing is compiled, installed or written to the project. The tree goes to a temporary file, which is then deleted.
   - This is Maven's own result: exact versions, scopes, exclusions and profiles.
2. **DevSnip Pro's Maven resolver.** It reads POMs from the workspace, then your local Maven repository (`~/.m2/repository`, or `<localRepository>` in `settings.xml`), then Maven Central (when downloads are on). It applies Maven 3's rules:
   - parent inheritance (workspace `relativePath` first);
   - properties interpolated in the child's context, so `<snakeyaml.version>` in your POM overrides Spring Boot's;
   - CI-friendly `${revision}` versions;
   - explicit dependency management before imported BOMs, with imports in declaration order;
   - nearest definition wins, and the root's dependency management overrides transitive versions and scopes;
   - Maven's scope table, with scope widening;
   - optional and `test`/`provided` dependencies of dependencies left out;
   - exclusions, including wildcards;
   - relocations followed;
   - version ranges resolved to the highest published version, from `maven-metadata.xml`.

   On two Spring Boot fixtures it matched `mvn dependency:tree` on every version and scope: 84/84 dependencies (a multi-module Boot 2.6 project) and 99/99 (Boot 3 imported as a BOM, with the Spring Cloud BOM, `${revision}`, a relocation, a classifier, a range and wildcard exclusions). Profiles activated by JDK, OS or property are not applied.

**Gradle (`build.gradle`, `build.gradle.kts`)**

1. **Gradle itself**, when allowed. The command is `./gradlew` (or `gradle` on PATH) with an init script written to a temporary folder.
   - The script adds one read-only task to every project. The task lists the resolved `compileClasspath`, `runtimeClasspath`, `testCompileClasspath` and `testRuntimeClasspath`, with each module's depth and path.
   - Nothing is built or published.
   - Dependencies Gradle cannot resolve are reported as unresolved, with Gradle's reason.
2. **DevSnip Pro's build-script reader.** Without Gradle, build scripts are read for:
   - string and map dependency notation;
   - the Spring Boot plugin version (including one declared once in the root with `apply false`);
   - Spring's dependency-management plugin;
   - `mavenBom` imports, `platform()` / `enforcedPlatform()` and `project(':x')` dependencies;
   - `gradle.properties` and `ext` values.

   The result is resolved with Gradle's conflict rule (highest requested version wins; BOM-managed versions are enforced). On a Spring Boot 2.7 multi-project fixture it matched Gradle 8.10 on all 68 libraries. Gradle was not run, so these findings are **Potential**. Version-catalog aliases (`libs.x`) and dependencies added by plugins or code cannot be read this way; they are listed in the file's notes. `gradle.lockfile` remains exact either way.

**Precedence rules**

- **The resolved tree beats declarations.** A build tool's tree, or a lockfile, wins over a manifest's declared range. The manifest only marks which dependencies are direct.
- **The lockfile is scanned when they disagree.** When a lockfile does not satisfy the range in its manifest (an out-of-date lockfile), the lockfile version is scanned, because it is what gets installed. The conflict is listed in the Files tab and in the scan notes. A nested older copy of a package is not a conflict.
- **A Maven run that fails is not the end.** When Maven or Gradle fails (exit code, timeout, missing tool), the affected modules fall back to the built-in resolver, and the failure, with the build tool's last output lines (credentials masked), is shown in Scan notes.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `devsnip.osvScanner.buildToolResolution` | `ask` | `ask`: run Maven and Gradle in trusted workspaces after you allow it once per workspace. `always`: run them in trusted workspaces without asking. `never`: do not run them and use the built-in resolvers. Build tools execute the build's own code (Maven extensions, Gradle scripts), so they never run in an untrusted workspace. |
| `devsnip.osvScanner.downloadPoms` | `true` | Let the built-in Maven resolver download POMs from Maven Central (only coordinates are requested; downloaded release POMs are cached in VS Code's global storage). Off: workspace and local Maven repository only. |
| `devsnip.osvScanner.buildToolTimeoutSeconds` | `300` | Time limit for one Maven or Gradle run; projects not finished in time use the built-in resolver. |

## How results are decided

**Versions are never guessed.**

| Where the version comes from | Treated as |
| --- | --- |
| A lockfile | **Confirmed**: the exact installed version |
| An exact pin the package manager installs as written (`"1.2.3"` in package.json, `==1.2.3`, a Maven `<version>`, a NuGet `Version`) | **Confirmed** |
| Only a range (`^1.2.0`, `>=2.20,<3`, `~> 7.0`, `[1.0,2.0)`) | **Potential** |
| Maven's tree, Gradle's resolved classpaths, or DevSnip Pro's Maven resolver | **Confirmed** |
| A Gradle build script read without running Gradle | **Potential**: Gradle may resolve differently. Allow build tools, or enable dependency locking, for exact results |

For a range, OSV is asked about every advisory for the package. An advisory is kept only if the range can include an affected version:

- **A range with a lower bound** keeps advisories that overlap the range.
- **A range with no lower bound** (`*`, `<2`) keeps advisories that are still open at its newest allowed version. Package managers install the newest allowed version.

A dependency that is not checked is listed as **Not analysed**, with one of these reasons. It is never counted as clean.

| Reason | Examples | Effect on the scan |
| --- | --- | --- |
| **Version unknown** | no version declared or managed, an undefined property, a parent POM that cannot be found, a SNAPSHOT | makes the scan **incomplete** |
| **Query failed** | OSV unreachable, a request that kept failing after retries and the per-package fallback | makes the scan **incomplete** |
| **Outside OSV's coverage** | installed from git, a local path, a tarball URL or a private registry; conda channel packages | reported, but the scan can still be complete |

**Severity comes only from the advisory**, in this order:

1. GitHub's reviewed severity (`database_specific.severity` on GHSA records). MODERATE is shown as Medium.
2. Another database's own label.
3. The CVSS v3.x base score, computed from the published vector with the FIRST CVSS 3.1 formulas. The ratings are Critical ≥ 9.0, High ≥ 7.0, Medium ≥ 4.0 and Low otherwise.
4. The CVSS v2 base score (NVD ratings).
5. An ecosystem-specific label, such as Ubuntu priority.

**Records with no severity of their own.** PYSEC and GO records often have none. Such a finding takes its severity, by the same rules, from an alias record (GHSA or CVE) that has one. Aliases are the same vulnerability by OSV's definition, and the source names the alias.

Otherwise the severity is **Unknown**. CVSS v4 vectors are shown but not scored.

**Aliases are merged.** Records from different databases that describe the same vulnerability become one finding. For example, `GHSA-…`, `PYSEC-…`, `GO-…` and `RUSTSEC-…` records are merged through their shared CVE. GitHub's ID leads, and the other IDs are listed as aliases. Withdrawn advisories are dropped. RustSec informational notices (unmaintained, unsound) are labelled as such.

**Fixes come from the advisory's affected ranges:**

- **Fixed in** is the fix of the range that contains your installed version.
- **The upgrade target** for a package is the lowest version that fixes all of its findings that have a fix.
- **The target is checked.** The scanner asks OSV about that version. If another advisory still affects it, the target is raised to the next fix (up to three times). The Fixes tab shows the outcome: *No known advisories at X*, or *Still affected by …*.
- **No fix published.** When OSV lists no fixed version, the dashboard says so.

## Privacy and network use

- **What is sent.**
  - **To OSV.** Only the ecosystem, the package name and the version go to `https://api.osv.dev/v1/querybatch`. A version is omitted for range-only dependencies. A package whose batch fails is re-asked through `POST /v1/query`. Advisory records are fetched by ID from `/v1/vulns/{id}`.
  - **To Maven Central.** With `downloadPoms` on, the built-in Maven resolver requests POM files and `maven-metadata.xml` from `https://repo.maven.apache.org/maven2/` by coordinates, plus any `https` repositories your POMs declare.
  - **Coordinates are checked first.** Coordinates that are not plain names are never put into a URL or a path, and coordinates OSV cannot accept are reported instead of sent.
- **What is not sent.** Source code, file contents, file paths, project names, registry URLs, credentials and environment variables never leave VS Code. A unit test checks this.
- **Batching.** Packages go in batches of 1,000, the API's limit. At most 2 batches and 8 record requests run at once.
- **Retries.** Requests time out after 30 seconds. They are retried up to 3 times with exponential backoff and jitter. Retries cover network errors, timeouts, HTTP 408/429/5xx and `Retry-After`.
- **Pagination.** Every `next_page_token` is followed, for each query in a batch separately and for single queries, up to 50 pages.
- **Partial results.**
  - **A failed batch is split.** A batch that still fails after its retries is split in half, then down to one `/v1/query` per package, so only a package OSV truly cannot answer for is marked *Not analysed (query failed)*.
  - **An unreachable OSV fails at once.** When OSV cannot be reached at all, every query fails immediately rather than retrying each package.
  - **A malformed record never stops the scan.** Records are checked against the OSV schema; the well-formed parts are still used.
  - **Results are never empty by mistake.** A failed request or a missing record is never turned into "no vulnerabilities".
- **The cache.**
  - **Advisory records** are kept in VS Code's global storage (`osv-cache.json`, up to 2,000 records). A record is reused only while its `modified` time matches what OSV reports, so an advisory updated upstream is always fetched again.
  - **Query answers** are kept in memory for 10 minutes.
  - **Clearing it.** ⋯ → *Clear cached advisories* clears both.
- **Cancellation.** **Cancel** stops in-flight requests, and Maven or Gradle (with its child processes), at once. It returns what was finished, marked as cancelled. Only one scan runs at a time, and a newer scan's result can never be overwritten by an older one.

## Troubleshooting

**The log.** **Show Log** (in the status banner and Scan notes), or the Output panel's **DevSnip Pro: OSV Scanner** channel, lists each stage of the last scan:
- files found and how each was read or resolved;
- the Maven and Gradle runs, with their exit codes and last output lines;
- packages queried, batches, extra pages and single-package fallbacks;
- advisories fetched, cached and failed;
- alias IDs merged, withdrawn advisories and out-of-range advisories dropped;
- findings by severity.

The log contains coordinates and workspace-relative paths only, never file contents, environment variables or credentials. Scan notes show the same counters, so a missing finding can be traced to the stage where it was lost.

| You see | Do this |
| --- | --- |
| Spring Boot starters listed as *Not analysed (version unknown)* | The Spring Boot parent or BOM could not be loaded. Turn `downloadPoms` on, check network access to Maven Central, or allow build tools. Scan notes name the POM that could not be loaded. |
| "Maven exited with code 1" in Scan notes | Maven could not resolve the build (often a private repository or offline mode). Those modules fell back to the built-in resolver. Fix the build, or set `buildToolResolution` to `never` to skip Maven. |
| Gradle findings marked *Potential* | Gradle was not run. Allow build tools, or commit `gradle.lockfile` (`./gradlew dependencies --write-locks`). |
| "lockfile entries do not satisfy the range in the manifest" | Your lockfile is out of date. Run your package manager's install, then scan again. |
| *Scan incomplete: N dependencies OSV could not be queried for* | A network or OSV problem. **Scan Again**; ⋯ → *Scan again, ignoring cached answers* re-asks everything. |
| A finding you expected is missing | Check the Packages tab for the package and version. If it is listed and clean, OSV has no advisory for that version. If it is not listed, check the Files tab and the log for how its project was resolved. |

## Limitations

- **Coverage.** OSV.dev aggregates many databases (GitHub, PyPA, Go, RustSec and more), but it does not hold every vulnerability published anywhere. Only advisories published in OSV at scan time are reported. Vendored, copied or patched code and private packages are not covered.
- **Range-only dependencies.** Without a lockfile, only ranges are known, and findings are Potential. Commit your lockfiles.
- **Maven.** Without Maven itself, profiles activated by JDK, OS or property are not applied. Artifacts only in a private repository can be scanned only if their POMs are in your local repository; otherwise their own dependencies are reported as unknown.
- **Gradle.** Without Gradle itself, version-catalog aliases, convention plugins and dependencies added by code or plugins cannot be read. Findings from the build-script reader are Potential.
- **Go.**
  - The standard library and toolchain are not checked: the `go` line in go.mod is a minimum, not the toolchain you build with.
  - For call-graph-aware results, use `govulncheck`.
  - Before Go 1.17, go.mod may not list every indirect module.
- **Reachability.** The scanner reports affected versions. It does not check whether your code calls the vulnerable function.
- **NuGet casing.** OSV matches NuGet ids case-sensitively. `obj/project.assets.json` and `packages.lock.json` carry the canonical casing. A `.csproj` reference with different casing may not match unless restore output is present.
- **Unsupported files.**
  - `bun.lockb` is binary; write a text `bun.lock` with `bun install --save-text-lockfile`.
  - Only CRAN packages are checked in `renv.lock`, not Bioconductor.
  - Conda channel packages have no OSV ecosystem.
- **Size limits.** Files over 64 MB and dependency files after the first 5,000 are skipped, and the scan notes say so.

## Report format

**JSON.** The JSON export is the scan result (`schemaVersion: 1`):

- `tool`, `toolVersion`, `startedAt`, `finishedAt`, `durationMs`
- `workspace`, and `source` (`workspace` or `files`)
- `status` (`complete`, `incomplete` or `cancelled`) and `diagnostics` (the pipeline counters, and how each Maven and Gradle build was resolved)
- `files[]`: `path`, `ecosystem`, `kind`, `manager`, `packages`, `warnings`, `error`, `resolvedBy`
- `packages[]`: `ecosystem`, `name`, `version` or `specs`, `status`, `skipReason`, `note`, `occurrences[]` (file, line, project, manager, scope, direct, via), `findingIds`
- `findings[]`:
  - `id`, `aliases`, `packageName`, `installedVersion`
  - `confidence`, `confidenceNote`
  - `severity`, `severitySource`, `cvssScore`, `cvssVector`, `cvssV4Vector`
  - `summary`, `details`, `published`, `modified`, `cwes`
  - `affectedRanges`, `fixedVersions`, `fixedIn`, `noFix`
  - `references`, `osvUrl`, `detailsAvailable`, `informational`
- `remediations[]`: `targetVersion`, `targetCheck`, `unfixed`, `commands[]` (label, command, cwd), `guidance[]`
- `summary`: counts by severity; discovered, analysed, unresolved, failed and out-of-scope packages; unique vulnerabilities
- `errors`, `limitations`, `partial`, `cancelled`, and `api` (request and cache counts)

**HTML.** The HTML report is one self-contained file. It has no scripts, a restrictive Content-Security-Policy and light and dark styles. It contains:

- the scan details and the severity summary;
- the errors and limitations;
- the findings grouped by severity, with details and references;
- the recommended upgrades;
- the packages that were not analysed;
- the scanned files and the full package list.

All advisory text is escaped, and only http(s) links become anchors.

## Code layout

`src/osv/`:

| File | What it does |
| --- | --- |
| `types.ts` | Shared, serialisable data shapes |
| `parsers.ts` | One adapter per file format (`FILE_ADAPTERS`): detection and parsing |
| `toml.ts` | A TOML 1.0 reader |
| `versions.ts` | Version ordering per ecosystem, OSV range evaluation, declared-range spans |
| `severity.ts` | CVSS v3/v2 scoring and severity resolution |
| `client.ts` | OSV API client and cache |
| `scan.ts` | The scan pipeline |
| `remediation.ts` | Upgrade commands |
| `report.ts` | JSON and HTML export |
| `workspace.ts` | Discovery through VS Code (including `-r` includes and parent POMs of chosen files) |
| `maven/pom.ts`, `maven/resolver.ts` | POM model and the built-in Maven resolver (also used for Gradle builds read from scripts) |
| `maven/tree.ts`, `maven/cli.ts` | Running `mvn dependency:tree` and reading its output |
| `maven/index.ts` | Per-reactor orchestration: Maven, then the built-in resolver |
| `maven/host.ts` | Settings, workspace trust, consent, the POM repository and cache |
| `gradle/cli.ts`, `gradle/builtin.ts`, `gradle/index.ts` | The Gradle init-script task and its output, the build-script reader, per-build orchestration |
| `panel.ts`, `page.ts`, `command.ts` | The webview and commands, loaded on first use |

The page script is `media/osv-scanner.js`. It builds the page with DOM nodes and `textContent` only, so advisory text is never parsed as HTML.

## Testing

```bash
npm run compile
```

```bash
npm run test:unit
```

The unit tests in `src/test/unit/osv.unit.ts` and `src/test/unit/osv-maven.unit.ts` cover:

- **Parsers.** Every adapter, with realistic fixtures (including malformed files), and TOML.
- **Versions and severity.**
  - Version ordering and ranges for each ecosystem, including Maven and Guava flavours.
  - CVSS scoring against the FIRST calculator.
- **The OSV client.**
  - Batch and single-query pagination.
  - 429 with `Retry-After`, 5xx, network errors and timeouts.
  - Cancellation, bad JSON, 400 and 404.
  - Schema checks on records and queries.
  - Batch splitting and single-package fallback.
- **Maven.**
  - The POM model and the resolver, against a miniature repository with Spring Boot's real shape: parent, BOM, imported BOMs, starters and transitive libraries.
  - Property overrides, exclusions, relocations, classifiers, ranges, `${revision}`, missing POMs, unmanaged dependencies and a 1,000-artifact graph.
  - Real `mvn dependency:tree` output.
- **Gradle.**
  - Real init-script output from Gradle 8.10.
  - Settings includes and Boot plugin versions declared in the root.
  - The build-script reader, and highest-version-wins.
- **The scan, against a fake OSV.**
  - Results: confirmed, patched and potential findings; several advisories on one package; one advisory on several packages; unknown severity and missing fixes; merged aliases and withdrawn records.
  - Project shapes: monorepos and workspace membership, lockfile/manifest conflicts, `-r` includes, Conda and `Package.swift`.
  - Failures: failed batches and records, an unreachable OSV, slow responses and cancellation.
  - The cache, and a privacy check on what is sent.
- **Reports and integration.** HTML escaping, the commands, the menus and the navigation entry.

```bash
npm test
```

The integration tests in `src/test/osv.test.ts` run inside VS Code against fixture files and a fake OSV and Maven Central (no network):

- the commands and the panel;
- a workspace scan, a single-file scan and cancellation;
- the offline error path;
- a Spring Boot-shaped Maven project resolved with the built-in resolver;
- POM downloads turned off.

**Opt-in live tests** use the real tools and the real OSV API, and check documented advisories rather than counts.

- `DEVSNIP_TEST_OSV_LIVE=1 npm run test:unit` checks Log4Shell for `log4j-core` 2.14.1, Spring4Shell for `spring-beans` 5.3.17, and that the fixed `log4j-core` 2.17.1 is not flagged for Log4Shell.
- `DEVSNIP_TEST_MAVEN_LIVE=1` (with `mvn` installed) scans a real Spring Boot 2.6.6 project through `mvn dependency:tree`. It expects:
  - Tomcat 9.0.60 to be flagged, as a transitive dependency;
  - SnakeYAML's CVE-2022-1471 to be reported;
  - the patched Spring 5.3.18 not to be flagged for Spring4Shell.
- `DEVSNIP_TEST_GRADLE_LIVE=1` (with `gradle` on PATH) does the same for a Spring Boot 2.7.0 Gradle build.

**Cross-checks used during development.** For each test project, the scanner's package set was compared with Maven's or Gradle's own resolved tree, and every advisory that an independent OSV `querybatch` returned for those exact versions was confirmed to appear as a finding or an alias:

| Project | Package versions | Advisory pairs accounted for |
| --- | --- | --- |
| Spring Boot 2.6 multi-module (Maven) | 84/84 matched Maven | 132/132 |
| Spring Boot 3 with BOMs (Maven) | 99/99 matched Maven | 78/78 |
| Spring Boot 2.7 multi-project (Gradle) | — | 126/126 |
| npm | — | 113/113 |
| PyPI | — | 28/28 |
| NuGet | — | 1/1 |
| Go | — | 62/62 |
| Mixed seven-ecosystem fixture | — | 122/122 |

**A manual live check.** Create a folder with a lockfile you know is vulnerable, for example a `package-lock.json` with `lodash` 4.17.20, `requirements.txt` with `Django==3.2.0`, or a Spring Boot `pom.xml` with parent `spring-boot-starter-parent` 2.6.6 and `spring-boot-starter-web`. Run **Scan Workspace**. Expect:

- GHSA-29mw-wpgm-hmr9 for lodash;
- the Django SQL injection advisories, such as GHSA-2gwj-7jmv-h26r;
- for the Spring Boot project, transitive findings for `tomcat-embed-core` 9.0.60 and `snakeyaml` 1.29, each with its dependency path.

Upgrading to the suggested versions and scanning again should clear them.
