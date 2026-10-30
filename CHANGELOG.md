# Development Changelog of DevSnip Pro

## 11.84.0 - Interactive tools and predictable results (2026-10-30)

- Add an expandable category explorer, recently opened tools, collapsible tool groups and a persistent compact view to tool hubs.
- Refine shared panel spacing, controls, keyboard focus states and responsive layouts while respecting VS Code appearance themes.
- Start toolkit pages with empty results. Defaults, presets, editor imports and incoming input values no longer trigger execution automatically; supported tools offer an explicit Live preview option.
- Stop restoring saved API responses and previous scanner results into newly opened pages. Keep explicit Run actions and execution shortcuts available.
- Show execution status and completion timestamps across toolkit tools, API and database clients, security scanners and dependency management. Mark results stale when toolkit inputs change and ignore superseded replies, including replies received after Reset.
- Add Run again and Clear results actions to toolkit output panels while preserving existing Copy, Open and Save actions.
- Animate fresh output with lightweight fade and slide transitions, a subtle success highlight and smoother toolkit panel resizing. Prevent repeat renders and stale output from replaying freshness animations; honor reduced-motion preferences.
- Add browser regression checks for manual execution, live-preview opt-in, execution states, stale replies, result animations and mobile layout.

## 11.83.3 - VS Code guideline and webview hardening (2026-10-29)

- Deny local resource access by default in tool webviews. Preserve explicit media/font allow-lists and restrict the REST client, README preview and saved-snippet panels to their required capabilities.
- Remove the donation promotion from the milestones page while preserving points, rewards and existing tool functionality.
- Add the recommended `usesOnlineServices` analytics setting tag; continue respecting VS Code telemetry preferences.
- Localize workspace trust and virtual workspace descriptions through `package.nls.json`.
- Verify compilation, lint, 858 unit cases, 82 desktop integration tests, browser integration and VSIX packaging. See the [guideline review](docs/audits/VSCODE_GUIDELINES_2026-10-29.md) for scope and remaining recommendations.
- The previously documented five high-severity Azure/MSAL dependency findings remain unresolved; this release does not claim a clean dependency security audit.

## 11.83.2 - Tool organization, security navigation and reliability (2026-10-29)

- Show the DevSnip Pro logo on all tool editor tabs, including database, security scanners and spreadsheet custom editors.
- Organize all 118 tools into purpose-based subsections shared by the sidebar, tool browser and search. Move HTTP caching to Backend & API and network utilities to DevOps & Cloud.
- Use consistent tool names across navigation, panels and the Command Palette; hide seven duplicate legacy mode aliases from the palette while keeping their commands and functionality available. See the [tool organization guide](docs/TOOL_ORGANIZATION.md).

- Click a workspace or cloud security finding to open its source file, select the reported line and center it in the editor. The existing Open button remains available; selecting evidence text does not trigger navigation.
- Preserve exact scanned resource URIs when navigating, including remote and multi-folder workspaces.
- Prevent database connections from reopening after disconnect or panel disposal; handle asynchronous webview delivery failures, generate CSP nonces with cryptographic randomness, and index tool registry lookups.
- Fix lazy command loading races, retry recovery after partial or synchronous failures, and cleanup when commands are disposed during loading.
- Apply compatible dependency security updates. Five high-severity npm findings remain in the Azure/MSAL dependency chain; see the [audit report](docs/audits/2026-10-29.md) for details.
- Add regression coverage for finding clicks, source-line selection and command lifecycle handling; keep generated Python test artifacts in temporary storage.

## 11.83.1 - github1s and gitlab1s compatibility (2026-10-29)

- Detect read-only filesystem providers automatically. Tool panels hide workspace writes and unavailable browser save destinations while retaining Copy and Open output actions.
- Debug-log actions create editable scratch copies for read-only repository files; remote source files remain unchanged.
- Added an Open VSX packaging/publishing command and installation guidance. github1s and gitlab1s use Open VSX; Microsoft Marketplace publication alone does not make the extension discoverable there.
- The release must be published under `sayaib.hue-console` on Open VSX before it appears in either site's extension search.

## 11.83.0 - VS Code Desktop and Web support (2026-10-29)

DevSnip Pro now supports VS Code Desktop and the browser extension host used by vscode.dev and github.dev through one extension package and Marketplace listing. Platform detection is automatic; Desktop retains the complete toolkit, while Web shows 94 browser-compatible tools.

### Added

- A bundled browser extension entry point alongside the existing Desktop entry point.
- Shared capability detection for the sidebar, navigation, categories, tool hub, search, onboarding, daily activities and milestone dashboard. Unsupported Web tools and empty categories are hidden.
- Browser support for formatters, converters, code/configuration generators, AI and RAG planners, OAuth PKCE and editor debug-log actions, with the same responsive UI and themes.
- Browser bundle dependency checks, 855 tool-variant checks and integration tests using the official VS Code web test runner.

### Changed

- Resource loading and toolkit file operations use VS Code URIs and the virtual filesystem API, preserving remote workspace schemes.
- Browser random ID generation and OAuth PKCE use Web Crypto. Node-only drivers, networking and process dependencies are excluded from the browser runtime.
- Browser and Desktop bundles use separate output paths so development compilation cannot overwrite the packaged browser entry point.
- Existing Desktop tools, settings, snippet backups and stored user data are preserved. Hidden sidebar favorites and usage history are retained.

### Platform availability

- **Desktop:** the full toolkit, including REST/API clients, database connections, security scanners, dependency installation, spreadsheet viewers and custom snippet management.
- **Web:** browser-compatible tools only. Features requiring unrestricted networking, Node cryptography, database drivers, local processes or local network inspection remain Desktop-only. No proxy or partially functional replacement is exposed.
- See the [platform compatibility inventory](docs/WEB_COMPATIBILITY.md) for tool-by-tool availability and validation details.

## 11.82.1 - OpenCode Integration removed

The OpenCode Integration hub has been removed, so DevSnip Pro no longer installs, repairs or launches the OpenCode CLI. Nothing else changes. If you already installed OpenCode through it, OpenCode stays installed: run `opencode` in a terminal, or `npm uninstall -g opencode-ai` to remove it.

### Removed

- **OpenCode Integration:** the **⚡ DevSnip Pro: OpenCode Integration** command, its panel, and its entry in the Tools sidebar's Code & Productivity section and hub. The sidebar now has 118 tools in 14 sections.
- **Feature Explorer** now counts five features (an API request, an AI tool, a security scan, a database and a snippet), and you complete it by trying all five. An OpenCode launch you already recorded no longer counts; milestones you already completed stay completed.
- The OpenCode guide and every OpenCode mention in the README, docs and bug report template.

## 11.81.1 - SCA Scanner: exploited CVEs, dependency health and Spring Boot-aware fixes

A new **SCA Scanner** (software composition analysis) in the Security & Auth section. It builds on the OSV Vulnerability Scanner's engine, so both tools agree on every dependency and advisory. It adds which vulnerabilities are being exploited, which packages are deprecated or abandoned, and the safest fix for each, worked out from what actually controls the version. No npm dependency is added, and the scanner loads the first time you use it.

### Added

#### SCA Scanner

- **Where to find it:** **SCA Scanner** in the Tools sidebar's Security & Auth section, **🛡️ DevSnip Pro: SCA Scanner** and **🛡️ DevSnip Pro: Scan Dependencies (SCA…)** in the Command Palette.
- **Projects:**
  - Maven reactors, Gradle builds, npm/Yarn/pnpm/Bun workspaces and other project folders are detected and listed, with their ecosystems and Spring Boot version.
  - Scan all of them, or tick the ones you want. Parent POMs outside the selection are still read.
- **Known exploited vulnerabilities:**
  - Findings whose CVE is in CISA's Known Exploited Vulnerabilities catalog are marked **Exploited** and sorted first, with CISA's description, the date added, the required action and ransomware use.
  - The catalog is downloaded once a day and matched locally.
- **CVSS from NVD, only where OSV has none:** advisories without a published severity are scored from NVD's CVE API, preferring NVD's own CVSS 3.x analysis, and the source is named. No score is ever invented. A free NVD API key is optional and kept in VS Code's secret storage.
- **Dependency health, kept apart from vulnerabilities:**
  - **Deprecated, yanked, abandoned or inactive** packages are maintenance risks.
  - **Outdated** packages (major, minor or patch behind) are informational.
  - The data comes from npm, PyPI, Maven Central, NuGet, crates.io, RubyGems, Packagist, the Go module proxy, pub.dev and Hex.
  - **A package is never called vulnerable because it is old.**
- **Confirmed, potential and informational** findings are told apart.
- **Spring Boot-aware remediation.** Each managed version records where it comes from: your POM, a parent (such as `spring-boot-starter-parent`), a BOM Boot imports (`spring-framework-bom`, `jackson-bom`, `log4j-bom` …) or a BOM you import. The fixes follow from that:
  - **Upgrade Spring Boot** to the lowest release whose BOM manages a fixed version of that library. This is found by reading the real BOMs of published releases, and every release line is checked against OSV, so Tomcat 10.1 is not mistaken for a fix of a 9.0 advisory. Patch releases come first (low risk), then minor releases, then majors (high risk, with the Java 17 and `jakarta.*` note for Boot 3). Each card also names the Boot release that fixes every vulnerable library it manages.
  - **Override the Boot property** (`tomcat.version`, `snakeyaml.version`) or the nested BOM's property (`spring-framework.version`), so a library family moves together. Libraries that share a property get one value, the highest any of them needs, at the risk of the biggest jump.
  - **Pin it in your own `<dependencyManagement>`** when an imported BOM sets it.
  - **Gradle:** upgrade the Spring Boot plugin, or set `ext['…']`.
  - **Direct dependencies:** a version edit in `pom.xml`, `build.gradle`, `package.json`, `requirements.txt`, `.csproj`, `composer.json` or `Cargo.toml`.
  - **Transitive npm dependencies:** `overrides`, `resolutions` or `pnpm.overrides`.
- **Edits are previewed and confirmed.**
  - **Preview Change** opens a diff.
  - **Apply…** asks in a modal dialog, then changes and saves only that file. You can undo it in the editor.
  - Edits keep the file's formatting and range operators. They refuse, with a reason, rather than guess.
  - Only edits the current result proposed can be applied, and never in an untrusted workspace.
  - Lockfiles are never edited, and nothing is installed or built.
- **Dashboard:**
  - **Cards:** critical, high, medium, low, informational and known exploited, plus totals for dependencies, vulnerable, direct and transitive.
  - **Filters:** severity, ecosystem, direct/transitive, classification, exploited, scope and project. Search covers package, CVE, GHSA and text.
  - **Sorting and grouping.**
  - **Expandable findings** show affected and fixed versions, every dependency path, real file locations, and clickable CVE, GHSA, OSV and CWE links.
  - **Tabs:** Remediation, Dependency health, Dependencies, and Sources & notes, which shows each advisory source's status.
  - It is keyboard accessible and works at narrow widths.
- **Export:** JSON (the full result) and CSV (one row per vulnerability or health finding, with spreadsheet formulas neutralised).
- **Settings:** `devsnip.sca.healthChecks` (direct, all or off), `devsnip.sca.knownExploited`, `devsnip.sca.nvdEnrichment` and `devsnip.sca.bomUpgradeSearch`. Maven and Gradle settings are shared with the OSV Scanner.

#### Scan diagnostics

- **Every scan explains itself.** The **Sources & notes** tab and the log show:
  - the projects found;
  - the files scanned, unreadable, unsupported or left out as build output;
  - dependencies discovered, resolved, direct and transitive;
  - how Maven and Gradle resolved each build;
  - packages checked, advisories and findings;
  - errors, and the time spent in each stage.
- **"Scan incomplete" always lists its reasons,** for example *2 dependency files could not be read; 6 dependency files are in an unsupported format*, with a button that jumps to them.

### Fixed

These fixes are in the shared engine, so the **OSV Vulnerability Scanner** gets them too. They were found by scanning a mixed repository and comparing the results with each package manager's own dependency list and with OSV.

- **Projects in folders named `build`, `deps`, `dist`, `out`, `target` or `vendor` were never scanned.** These folders are now skipped only when they hold the build output or vendored packages of the project beside them (`vendor` beside `composer.json`, `target` beside `pom.xml`). A real project such as `tools/build/requirements.txt` is scanned, which found vulnerable packages that were missed before.
- **Unsupported dependency files were skipped silently.** sbt, Deno, CocoaPods, Carthage, Conan, vcpkg, Stack/Cabal, Bazel, Clojure, Elm, Bower, Paket and other recognised files are now listed by name. The scan is marked incomplete, because their dependencies were not checked.
- **A malformed `pom.xml` showed "0 dependencies".** It is now reported as unreadable, with the XML error.
- **npm aliases** (`"old-lodash": "npm:lodash@4.17.4"`) were left unchecked. They are now checked as the package actually installed.
- **Workspace packages could be looked up in the public registry.** npm and pnpm workspace members, linked `file:` packages and Cargo workspace crates are this project's own code, and are no longer sent to OSV. A public package of the same name could have produced false findings.
- **pip `-c` constraint files were ignored.** A range such as `flask>=1.0,<2` is now checked at the version the constraints file pins.
- **Many dependencies showed "relation unknown".** The project's own manifest now decides which lockfile entries are direct and which are transitive for npm, Yarn, pnpm, Poetry, uv, Pipenv, Composer and Cargo. On the test repository the count went from 103 to 0.
- **Gradle builds read without running Gradle missed most dependencies when they used a version catalog.** The reader now understands:
  - catalog libraries, bundles and plugin aliases (including the Spring Boot version they set);
  - `mavenBom(SpringBootPlugin.BOM_COORDINATES)`;
  - property overrides such as `extra["tomcat.version"]`, which Spring's dependency-management plugin applies.

  On a Kotlin-script Spring Boot 3.4 build, it went from 5 to 76 of the 78 dependencies Gradle resolves. The two it skips are BOM-only POMs.
- **Version catalog entries were counted twice** once Gradle had resolved the build. A declared version could differ from the one Gradle actually uses.
- **The "Scan incomplete" banner** of the OSV Scanner now lists every reason, and the Files tab lists unsupported files.

### Improved

- **OSV Vulnerability Scanner:**
  - **npm dependency paths:** `package-lock.json` v2/v3 dependencies now show the path that brings them in. It is rebuilt from the lockfile's edges the way Node resolves them.
  - **One engine for both scanners.** The scan host moved to a shared engine (`src/osv/engine.ts`) that both scanners use.
- **Maven and Gradle resolution records where every managed version comes from**, including the property and the BOM import behind it. Built-in properties such as `${project.version}` are never offered as overrides.
- **SCA Scanner speed:** the exploitation, NVD, registry and Spring Boot upgrade checks run side by side. A scan of the test repository took 47 s instead of 168 s, with identical results.
- **Cargo workspaces** are shown as one project, with their member crates.

### Reliability

- **Providers report their own status** (ok, partial, stale, unavailable, off). A provider that is unavailable makes the result **incomplete** instead of quietly clean. A provider you turned off does not.
- **Rate limits:**
  - NVD lookups are spaced for its public limit, capped per scan, cached for a week, and stop at the first rate-limit answer.
  - Registry checks run 8 at a time and are cached for 6 hours. Failures are summed up per host.
  - The BOM search shares loaded BOMs and its OSV answers across the scan, within a budget.
- **Cancellation** stops the scan and every provider. Nothing more is requested after **Cancel**.

### Privacy

- **What is sent:**

  | Service | Receives |
  |---|---|
  | OSV.dev, as before | Package names and versions |
  | Registries | Package names |
  | NVD | CVE ids |
  | Maven Central | BOM coordinates |
  | CISA | Nothing: the public catalog is downloaded |

- **Never sent:** source code, file contents, paths and credentials. An integration test checks every request body.

### Docs

- New [docs/SCA-SCANNER.md](docs/SCA-SCANNER.md): usage, discovery, how results and fixes are decided, settings, privacy, diagnostics, limitations, verification, the report format and the code layout.
- [docs/OSV-SCANNER.md](docs/OSV-SCANNER.md) describes the new folder rules and the unsupported-file reporting.

### Tests

- **Unit:** 847 tests, 42 of them new. They cover:
  - KEV, NVD and registry parsing, caching and rate limits;
  - all 14 edit operations;
  - the BOM search, including release-line checks;
  - project detection;
  - npm paths;
  - the Spring Boot analysis end to end against a mocked OSV, KEV, NVD, registries and Maven repository;
  - the dashboard's filters and sorting, CSV escaping and the page's CSP;
  - a regression test for every fix above.
- **Integration:** 81 tests in VS Code. The SCA Scanner is tested against a fake network:
  - its commands;
  - a Spring Boot-style reactor from a fake Maven Central;
  - enrichment and BOM-aware edits;
  - the diff preview and the confirmation gate;
  - discovery through VS Code's file search;
  - project selection, cancellation and offline results.
- **Verified against each package manager's own dependency list** on real projects. Every package found was also queried directly at OSV: no advisory was missing and none was extra.

  | Ecosystem | Package manager's own list | Result |
  |---|---|---|
  | Maven | `mvn dependency:tree` | 114 of 114 |
  | Gradle | `gradle dependencies` | 78 of 78 |
  | npm | `npm ls` | 78 of 78 |
  | pnpm | `pnpm list` | 57 of 57 |
  | uv | `uv export` | 18 of 18 |
  | Pipenv | `pipenv requirements` | 15 of 15 |
  | Cargo | `cargo metadata` | 30 of 30 |
  | NuGet | `dotnet list package` | 74 of 74 and 71 of 71; all 10 advisories NuGet's own audit reports |
  | Poetry | `poetry show` | all, plus 3 platform-only lock entries |
  | Go | `go list -deps -test` | all 13 built modules |

  Bundler and Yarn match their generated lockfiles. Composer was checked only against a lockfile written in its format.
- **Spring Boot, checked live:** a Spring Boot 2.6.6 reactor with `log4j-core` 2.14.1. All 96 dependencies were checked: 249 findings, 6 known exploited (Log4Shell CVE-2021-44228 and CVE-2021-45046, Tomcat CVE-2023-44487 and CVE-2025-24813). Maven's `dependency:tree` and the built-in resolver gave identical results.

## 11.80.1 - OSV Vulnerability Scanner: known CVEs in your dependencies, including Spring Boot, Maven and Gradle projects

DevSnip Pro now finds dependencies with known vulnerabilities. It reads your lockfiles, manifests and Maven or Gradle builds, and checks every resolved package version against [OSV.dev](https://osv.dev), which includes the GitHub Advisory Database, PyPA, Go, RustSec and more. No npm dependency is added, and activation is unchanged: the scanner loads the first time you use it.

### Added

#### OSV Vulnerability Scanner

- **Where to find it:** the Security & Auth section of the Tools sidebar, **Scan Workspace Dependencies for Vulnerabilities (OSV)** in the Command Palette, or **Scan for Vulnerabilities (OSV)** when you right-click a lockfile or manifest in the Explorer. Without an open folder, **Scan Files…** lets you pick files.
- **Spring Boot and other Maven and Gradle projects are resolved to their full dependency tree**, so transitive libraries are checked, along with the versions that parents and BOMs manage. A starter brings in Tomcat, Spring Framework, Jackson, SnakeYAML, Logback and more.
  - **Maven's own `dependency:tree`, or Gradle's resolved classpaths**, when you allow it once per trusted workspace. These run read-only: nothing is compiled, installed or changed.
  - **Otherwise, a built-in Maven resolver** follows Maven's rules: parents, BOM imports, dependency management, property overrides, `${revision}`, nearest wins, scopes, optional dependencies, exclusions, relocations and version ranges. On two Spring Boot test projects it matched `mvn dependency:tree` exactly (84/84 and 99/99 dependencies).
  - **A Gradle build-script reader** handles the Spring Boot plugin, `mavenBom`, `platform` and `project()` dependencies, with Gradle's highest-version-wins rule. It matched Gradle 8.10 on all 68 libraries of a Spring Boot test build; its findings are marked Potential.
  - **Multi-module reactors and multi-project builds resolve as one build.** Your own modules are never queried as packages.
  - **Right-click a folder** to scan one project of a monorepo.
- **12 ecosystems, transitive dependencies included:**
  - npm (`package-lock.json`, `yarn.lock` v1 and Berry, `pnpm-lock.yaml` v5–v9, `bun.lock`, `package.json`);
  - PyPI (`poetry.lock` 1 and 2, `uv.lock`, `pdm.lock`, `Pipfile.lock`, the pip packages of `conda-lock.yml`, `requirements*.txt` and the files they include with `-r`, `pyproject.toml`, `Pipfile`, the pip section of `environment.yml`);
  - Maven (`pom.xml`, `build.gradle(.kts)`, `gradle.lockfile`, version catalogs);
  - Go (`go.mod`, with `replace`);
  - crates.io (`Cargo.lock`, `Cargo.toml`);
  - RubyGems (`Gemfile.lock`, `Gemfile`);
  - NuGet (`packages.lock.json`, `obj/project.assets.json`, `.csproj` with central package versions, `packages.config`);
  - Packagist (`composer.lock`, `composer.json`);
  - Pub (`pubspec.lock`, `pubspec.yaml`);
  - Hex (`mix.lock`);
  - SwiftURL (`Package.resolved`, `Package.swift`);
  - CRAN (`renv.lock`).
- **Monorepos and nested projects:**
  - A workspace lockfile covers the members it records (npm, pnpm, Yarn Berry and Bun). A standalone nested project keeps its own versions.
  - A lockfile that no longer satisfies its manifest is reported. The lockfile version is scanned, because it is what gets installed.
  - Every project keeps its own folder for commands.
- **Versions are never guessed:**
  - A lockfile or an exact pin gives a **Confirmed** finding.
  - A range gives a **Potential** finding, and only for advisories the range can actually reach.
  - A dependency that cannot be checked is listed as **Not analysed**, with the reason: version unknown, query failed, or outside OSV's coverage (git, paths, private sources).
  - **Scan complete** and **Scan incomplete** are always told apart. An incomplete scan with no findings is never shown as clean.
- **Severity comes from the advisory:** GitHub's reviewed rating, then a CVSS v3/v2 base score computed from the published vector. A record with no severity, such as many PYSEC and GO records, takes it from a GHSA or CVE alias, which is named as the source. Otherwise the severity is **Unknown**. CVSS v4 vectors are shown but not scored.
- **Aliases are merged:** records for the same vulnerability (GHSA, PYSEC, GO, RUSTSEC, CVE) become one finding. Withdrawn advisories are dropped.
- **Security dashboard:**
  - severity cards that filter;
  - search (<kbd>/</kbd>), and filters for ecosystem, confidence and scope;
  - grouping and sorting;
  - coverage counts: dependencies discovered, analysed, unresolved, failed and out of scope, and unique vulnerabilities;
  - every finding and package listed, with no hidden pages; long lists are drawn in chunks;
  - expandable findings with the description, affected and fixed versions, the CVSS vector, CWE, aliases linked to NVD, GitHub and OSV, and every file and line where the package appears;
  - for transitive dependencies, a direct/transitive badge and the dependency path (for example via `spring-boot-starter-web` → `spring-boot-starter-tomcat`);
  - **Packages**, **Fixes**, **Files** and **Scan notes** tabs.
  - It follows the appearance theme, works at narrow widths and is fully keyboard accessible.
- **Remediation:**
  - **The target is checked:** each package's upgrade target is asked about at OSV, and raised if it is still affected.
  - **Commands match the tool that wrote the lockfile:** npm, Yarn, pnpm, Bun, pip, Poetry, uv, PDM, Pipenv, Go, Cargo, Bundler, dotnet, Composer and pub.
  - **Guidance for transitive dependencies** (overrides, resolutions, dependency management).
  - **When no fix exists, the dashboard says so.**
  - **Nothing changes automatically:** **Run…** asks for confirmation in a modal, and runs only commands the scan suggested.
- **Reports:** export a self-contained HTML report (no scripts, everything escaped) or the full JSON result. Both include the scan time, workspace, files, versions, advisory IDs, severity, links, fixes and the scan's limitations.

#### Security Hub

- The **Dependencies & config** tab links to the OSV scanner for known CVEs.

### Reliability

- **Batching and pagination:**
  - Up to 1,000 packages go in each request, with at most 2 batches and 8 record requests at once.
  - Every `next_page_token` is followed, per query and per batch.
- **Timeouts and retries:** requests time out after 30 seconds. They are retried with exponential backoff and jitter on network errors, timeouts, HTTP 429 and 5xx, honouring `Retry-After`.
- **Failed batches are split.** A batch that keeps failing is halved, then sent as single `POST /v1/query` requests, so only the package OSV cannot answer for is left unchecked. When OSV cannot be reached at all, the scan reports it at once instead of retrying each package.
- **Malformed data never stops the scan.** Records and queries are checked against the OSV schema, so a malformed record or an invalid coordinate never crashes the scan or reaches OSV.
- **Missing data stays unknown.** Missing metadata is never turned into "no vulnerabilities" or "no fix", and a scan with gaps is reported as incomplete.
- **Cancellation:**
  - **Cancel** stops requests and any Maven or Gradle run at once, and keeps what finished.
  - Only one scan runs at a time, and an older scan can never overwrite a newer result.
- **The advisory cache** is kept in global storage. A record is reused only while its `modified` time matches OSV's, so an advisory updated upstream is fetched again. Downloaded release POMs are cached too, and both caches can be cleared from the dashboard.
- **A diagnostic log:** the Output panel's **DevSnip Pro: OSV Scanner** channel, and the Scan notes tab, count every stage of the scan, so a missing finding can be traced to where it was lost.

### Settings

- `devsnip.osvScanner.buildToolResolution` (`ask`, `always` or `never`; default `ask`): whether Maven and Gradle may run to resolve exact dependency trees. They never run in untrusted workspaces.
- `devsnip.osvScanner.downloadPoms` (default on): whether the built-in Maven resolver may download POM files from Maven Central.
- `devsnip.osvScanner.buildToolTimeoutSeconds` (default 300): the time limit for one Maven or Gradle run.

### Privacy and security

- Only the ecosystem, package name and version are sent to `api.osv.dev`. Source code, file contents, paths, project names, registry URLs and credentials are never sent, and a test checks this.
- The built-in Maven resolver requests POM files from Maven Central by coordinates. Turn it off with `devsnip.osvScanner.downloadPoms`.
- **Build tools.** Maven and Gradle run only in trusted workspaces, after you allow them once per workspace (`devsnip.osvScanner.buildToolResolution`).
  - They run with a time limit, and cancelling stops them along with their child processes.
  - Their output is shown with credentials masked.

### Packaging

- No new npm dependencies.
- The VSIX adds:
  - `media/osv-scanner.js` and two panel icons;
  - the compiled scanner under `out/osv/` (including `maven/` and `gradle/`).

### Docs

- New [docs/OSV-SCANNER.md](docs/OSV-SCANNER.md): installation, usage, supported files, Maven and Gradle resolution, precedence rules, settings, privacy, troubleshooting, limitations, report format and testing. Also updated: the README, the security guide, the architecture overview and the tool counts (118 tools).

### Tests

805 unit tests and 74 VS Code integration tests pass.

- **Spring Boot and Maven regression suite (`osv-maven.unit.ts`):** a miniature repository with Spring Boot's real shape, real `mvn dependency:tree` and Gradle output, Gradle builds, and end-to-end scans. An opt-in live test (`DEVSNIP_TEST_OSV_LIVE=1`) checks documented advisories against the real OSV API.
- **Unit tests:** the main suite covers:
  - every parser, and TOML;
  - version ranges;
  - CVSS against the FIRST calculator;
  - the API client against a scripted fetch: pagination, 429 with `Retry-After`, 5xx, network errors, timeouts, cancellation and malformed responses;
  - the scan against a fake OSV: monorepos, 2,100-package trees, failed batches and records, and verified fixes;
  - HTML escaping, and navigation.
- **Integration tests** run in VS Code with a fake OSV and Maven Central: commands and the panel, workspace, folder and single-file scans, cancellation, the offline path, a Spring Boot-shaped Maven project, and POM downloads off. Opt-in live tests run real Maven and Gradle on Spring Boot projects (`DEVSNIP_TEST_MAVEN_LIVE=1`, `DEVSNIP_TEST_GRADLE_LIVE=1`).
- **Milestone tests:** two tests no longer fail on days when the date-seeded daily quest or the weekly event completes during the test.

## 11.79.1 - Debug logs for 8 languages, framework snippets, and Spring Boot, ASP.NET Core and Flutter support

DevSnip Pro now helps with day-to-day debugging and cleanup in **JavaScript, TypeScript, Python, Java, Kotlin, C#, Dart and Swift**. It also adds framework snippets, Run & Debug setup, and dependency support for .NET and Flutter projects. No dependency is added, and activation is unchanged: every new feature loads the first time you use it.

### Added

#### Debugging

- **Insert Debug Log** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, the editor's right-click menu, or the Testing & Debugging section) logs the variable or expression under the cursor, labelled with the file and line.
  - The log goes where the value exists: after the statement that assigns it, at the top of the function for a parameter, at the top of the loop for a loop variable, and before a `return` or `throw`.
  - It never goes inside a multi-line string, between a decorator and its target, between a header and an Allman-style `{`, or in a class body.
  - When there is nowhere valid, the log is declined instead of written. This covers C# `out` parameters, discards (`_`), declarations without a value, a parameter of an expression-bodied Kotlin function, and the variable of a loop whose body has no braces.
  - It uses the logger the file already has: Python `logging`, SLF4J or Lombok `log` in Spring Boot, `ILogger` in ASP.NET Core (with a message template), `android.util.Log`, `debugPrint` in Flutter and `os.Logger` in Swift. Otherwise it falls back to `console.log`, `print`, `System.out.println`, `println` or `Console.WriteLine`.
  - It matches the file's quotes and semicolons, and works with several cursors.
- **Clean Debug Logs** (formerly Clean Console Logs) scans the workspace for `console.log`, `print`, `pprint`, `breakpoint()`, `System.out.println`, `Log.d`, `Console.WriteLine`, `Debug.WriteLine`, `debugPrint`, `NSLog`, `dump` and more, including `<script>` blocks in HTML, Vue, Svelte and PHP.
  - Calls inside comments and strings are ignored.
  - Only statements that stand alone on their lines are removed. A statement that shares a line, continues an expression or is the body of an `if` without braces is listed for review instead.
  - A Python block left empty gets `pass`, and a Swift or Dart `case` left empty gets `break`. CRLF line endings are kept.
  - Logs written by Insert Debug Log through a project logger (for example `_logger.LogDebug("[Orders.cs:12] …")`) are removed too. They are recognised by their label, so your own logging is never touched.
- **Remove Debug Logs in This File** does the same for the open editor, with one confirmation and Undo.
- **Run & Debug Configurations** detects the projects in your workspace, including monorepos: Next.js, Vite, Create React App, Angular, NestJS, Node.js, React Native, Expo, FastAPI, Django, Flask, Python, Spring Boot, Java, Android, ASP.NET Core, .NET, Flutter and Dart. For each one it writes `.vscode/launch.json`, `tasks.json` and `extensions.json` for the language's official debugger, and lists the run, test and build commands. Existing configurations are kept, and only new names are added.

#### Framework snippets

- **56 `ds-` snippets** for Spring Boot (Boot 4 and 3), ASP.NET Core (.NET 8+), FastAPI, Flask, Django, pytest, React, Next.js (App Router), Express, zod, Vitest and Testing Library, Flutter and Dart, and SwiftUI. Type `ds-` in a file, or run **Framework Snippets** to pick one from a list. See the README for the full list.
- The logger snippets (`ds-logger`) create the logger that Insert Debug Log then uses.

#### Frameworks and languages

- **API Resource Scaffolder** generates a validated CRUD API with pagination, `400`/`404`/`409` responses and unique fields for **Spring Boot** (JPA), **ASP.NET Core Web API** (EF Core) and **FastAPI** (SQLAlchemy and Pydantic), with PostgreSQL, MySQL, SQL Server or SQLite. Express, NestJS, Next.js and Fastify are still there too.
- **Dockerfile**, **CI Pipeline** (GitHub Actions, GitLab CI, CodeQL) and **Health Check Endpoints** support .NET and ASP.NET Core. The Dockerfile is multi-stage, runs as a non-root user and builds from the `.csproj` you name.
- **Unused Dependencies** lists npm, Python and Flutter/Dart packages that no code, script or config file uses, with the command that removes them. It never lists plugins (ESLint, Babel, pytest, tox), CLIs run from scripts, peer dependencies, frameworks' implicit packages, code generators or database drivers. pip-compile output is read by its `# via` notes, and a `pip freeze` dump is skipped with an explanation.
- **Dependencies & Installation** supports **.NET (NuGet)** and **Dart / Flutter (pub)**.
  - NuGet: it reads `.csproj`, `.fsproj` and `.vbproj` files, including Central Package Management (`Directory.Packages.props`), and installed versions from `obj/project.assets.json`. It offers `dotnet restore` and shows `dotnet add package` commands to copy.
  - pub: it reads `pubspec.yaml` and `pubspec.lock`, and offers `flutter pub get` / `dart pub get` and `pub upgrade`. `pub add` runs only for dev dependencies.
  - Latest versions come from nuget.org and pub.dev. As for npm and pip, every command is validated and confirmed before it runs.
- **Remove Unused Imports** supports Kotlin. It no longer lists Python `from __future__` imports, `__init__.py` re-exports or names in `__all__`, keeps `React` in classic-JSX files, and handles multi-line TypeScript imports.

### Improved

- **Testing & Debugging** now starts with Insert Debug Log, Clean Debug Logs and Run & Debug Configurations. Clean Debug Logs moved here from Code & Productivity. 117 tools in 14 sections.

### Fixed

- The README said ready-made snippets ship for 39 languages. Those 39 files hold the snippets you save yourself; the bundled snippets are the new `ds-` ones.

### Tests

- New unit tests cover the debug-log lexer (strings, interpolation, comments and regex literals in every language), placement and removal, the snippet files, Unused Dependencies, and NuGet and pub parsing, versions, commands and safety checks. 713 unit tests pass.
- New integration tests drive Insert Debug Log, Remove Debug Logs and Framework Snippets in a real editor. 67 integration tests pass, including every command run end to end and the panel memory check.
- **Debug logs on real projects:**
  - Logs were inserted for every declaration and every parameter, loop, catch and pattern variable, then each project was compiled or tested, and Clean Debug Logs had to restore every file byte for byte.
  - Projects: Express (1,261 tests pass), ky (type-checks), Flask, Spring PetClinic, Microsoft's eShopOnWeb (C#), Alamofire (Swift), dart-lang/args and TheAlgorithms/Kotlin.
  - Results, as logs inserted and then compiled or tested:
    - **C#:** 578 logs; eShopOnWeb builds.
    - **Swift:** 1,246 logs; Alamofire builds.
    - **Kotlin:** 164 logs; compiles with kotlinc 2.2.
    - **Java:** 118 logs; PetClinic compiles.
    - **TypeScript:** 266 logs; ky type-checks.
    - **JavaScript:** 179 logs; Express's 1,261 tests pass.
    - **Python:** 530 logs; Flask imports and runs.
    - **Dart:** 82 logs; args analyses cleanly.
  - The only test failures were the few Flask and args tests that assert exact console output, which the inserted logs change by design.
  - This found and fixed real placement bugs before release:
    - Allman-style `{` on its own line (usual in C#).
    - `if let` and `out var` bindings, and Swift `for … in` loops.
    - Assignments whose value is a multi-line lambda or object initializer.
    - Swift closures, implicit returns and if-expressions.
    - Combine's `print` operator.
    - C# methods returning `object`.
- **Every `ds-` snippet** was expanded by VS Code's own snippet engine and compiled:
  - Spring Boot 4 and 3 with `mvn test`, including the MockMvc test.
  - An ASP.NET Core 8 app with an xUnit integration test that calls the generated endpoints, controller, exception handler, options, `DbContext` and loggers.
  - Python 3.9 and later with pytest.
  - TypeScript with `tsc --strict`, Vitest and Testing Library.
  - `flutter analyze` and a widget test, `dart test`, and `swift build`.
  - This caught and fixed several snippet bugs before release: placeholder transforms that only apply after tabbing, a missing `import Foundation`, an unescaped `}`, and a validation attribute ASP.NET Core rejects at runtime.
- **Generated backends** (Spring Boot, ASP.NET Core, FastAPI) were built, run and exercised over HTTP: create, duplicate, invalid input, get, update, delete and missing records.
- **Dependencies & Installation** was run inside VS Code on a workspace with Maven, .NET, Flutter, Dart, npm and pip projects, against the live registries.
- **Unused Dependencies** was checked on Express, ky, Flask (including its pip-compile examples), dart-lang/args, a Flutter app and a fixture with known unused packages. Removing the reported packages left the Flutter and Dart projects analysing and passing their tests.

## 11.78.2 - Smoother CSV & Excel editing, and named columns

Editing in the CSV & Excel Viewer now behaves like a text box inside a spreadsheet: click a cell and a steady caret appears in its text. New columns are named as you add them, and CSV files with common defects open without losing rows. Nothing outside the CSV & Excel Viewer changes, and no dependency is added.

### Improved

#### Editing cells

- **Click a cell to edit it.** While editing, a click opens the cell with a blinking caret where you clicked and keeps its text, so typing inserts instead of replacing. Click again inside the cell to move the caret.
  - Dragging across cells, <kbd>Shift</kbd>-click and <kbd>Ctrl/Cmd</kbd>-click still select without editing.
  - Selecting a cell with the arrow keys and typing still replaces its contents, as in Excel.
- **A steady caret.** The cell editor uses the cell's own font and position, so text no longer jumps when editing starts. The editor is sized to fit its text, so the text no longer scrolls inside it and the caret no longer jumps while you type. Long values widen the editor.
- **The editor stays open** when the grid scrolls a little or the panel is resized; it follows its cell, and finishes only when the cell scrolls out of sight.
- **Two editing modes, as in Excel.** After typing over a cell, the arrow keys finish it and move to the next cell. After clicking, <kbd>Enter</kbd>, <kbd>F2</kbd> or double-click, they move the caret. <kbd>F2</kbd> switches between the two, and the label above the cell shows which mode is on.
- **Keyboard shortcuts while typing in a cell:**
  - <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> and <kbd>Shift</kbd>+<kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> (and <kbd>Ctrl</kbd>+<kbd>Y</kbd> on Windows and Linux) undo and redo the typing. They used to undo the last saved cell edit instead.
  - <kbd>Ctrl/Cmd</kbd>+<kbd>A</kbd> selects the cell's text.
  - <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> saves, including the text you were typing.
  - <kbd>Enter</kbd> that confirms a Japanese, Chinese or Korean input-method candidate no longer finishes the cell.
- **Nothing typed is lost** while a new row is being added: keys pressed right after <kbd>Enter</kbd> on the last row go into the new row.

#### Column names

- **New columns are named as you add them.** **+ Column**, and **Insert column left/right** in the right-click menu, add the column with a default name such as "Column 4", in the same undo step. The name then opens for typing with the caret ready. <kbd>Enter</kbd> keeps what you typed; <kbd>Esc</kbd> or an empty name keeps the default.
- **Rename any column** by double-clicking its header, with **Rename column…** in the right-click menu, or from the keyboard: <kbd>↑</kbd> from the first row moves to the header row, where the arrow keys move between headers and <kbd>Enter</kbd> or <kbd>F2</kbd> renames. <kbd>Tab</kbd> saves a name and moves to the next column's.
- **Duplicate names are explained, not saved.** A name another column already has (ignoring case and spaces) keeps the editor open with a note naming that column, because JSON exports and column mapping need unique names. Changing only the case of a name is fine.
- In Excel workbooks only the edited sheet changes, and a name such as "2024" stays text. In CSV files the new column uses the file's separator, and every full-width row gets it too, so the file stays rectangular.

#### Clearer editing

- The current row and a focused column header are highlighted, and right-aligned numbers no longer hide under the pencil icon of the active cell.
- The edit bar shows **Unsaved changes** with a dot until you save, and the **Save** tooltip says how many cells changed.
- In narrow sidebars the edit bar wraps instead of overflowing, and the editor's label is shortened.

### Fixed

- **A quote that is never closed no longer swallows the rest of a CSV file into one cell.** It is kept as a literal `"` character, the rows after it are read normally, and a banner names the line and row.
- Excel's `sep=;` first line now sets the separator instead of showing as a row, and it is kept when saving.
- UTF-16 CSV files without a byte-order mark are read correctly (they showed as garbage) and saved in the same encoding.
- A binary file opened as CSV gets a clear message instead of a grid of garbage.
- Saving large Windows-1252 CSV files is faster.

### Tests

- `media/spreadsheet-editing.js` holds the editing rules (keys in each mode, default names, duplicate checks, caret placement), and `spreadsheet.unit.ts` tests them as the page runs them.
- New unit tests cover named column inserts for CSV and Excel (undo, separators, other sheets byte for byte) and the CSV repairs above. 670 unit tests pass.
- A new integration test in `spreadsheet.test.ts` adds and names a column through VS Code's undo stack and save; all 63 integration tests pass.
- A 41-step browser test of the real page and host drove clicking, typing, both modes, undo, header naming and renaming, duplicate names, type-ahead, saving and export, on CSV and `.xlsx` files at 360, 900 and 1280 pixels wide. Saved workbooks were checked with openpyxl.

## 11.78.1 - CSV & Excel Viewer and editor, and an XML → JSON Converter

A new **Spreadsheets & CSV** section opens `.csv`, `.tsv` and `.xlsx` files as a fast grid you can search, sort and export, and, after pressing **Edit**, change and save. **Text & Formatters** gains an **XML → JSON Converter** with strict validation, a lossless mode and conversion of large files. Neither adds a dependency.

### Added

#### CSV & Excel Viewer and editor

- **Excel Viewer (.xlsx, .xlsm).** Workbooks open in the viewer when you click them in the Explorer.
  - Every worksheet is a tab at the bottom; hidden sheets are listed in italics, chart sheets are skipped.
  - Values show the way Excel shows them: dates and times as ISO dates, percentages, fixed decimals, thousands separators, currencies and accounting negatives. Errors such as `#DIV/0!` are marked.
  - Formula cells have a corner mark, the status bar shows the formula, and the **Formulas** switch shows them in the grid. Nothing is recalculated and no macro runs.
  - Old binary `.xls` and password-protected workbooks get a clear message on how to open them.
- **CSV / TSV Viewer.** CSV files still open as text. Open them in the viewer from the Explorer's right-click menu (**Open in CSV & Excel Viewer**), the table button in the editor title bar, or **Open With…**.
  - The separator (comma, semicolon, tab or pipe; switchable) and the encoding (UTF-8, UTF-16 or Windows-1252) are detected.
  - Quoted fields with separators, quotes and line breaks are read correctly, and values keep leading zeros.
  - CSV or TSV text pasted on the start page opens as a table.
- **The grid:**
  - Hundreds of thousands of rows scroll smoothly: only what is on screen is drawn.
  - Search all columns or one, with matches highlighted. Click a header to sort (numbers numerically, empty cells last).
  - The first row becomes the column names when it looks like a header; one click switches it.
  - Select cells with the mouse or keyboard and copy them as tab-separated text that pastes straight into Excel.
  - The status bar shows the cell's address and value, column stats (filled, empty, distinct, min, max, sum, average), and count, sum and average for a selection.
  - Right-click a cell to copy its row or column, filter by its value, or sort. Double-click shows a long value in full.
  - Drag a column edge to resize it, or double-click it to fit.
  - **Export** the rows you see (after search and sort) as CSV or JSON files, open them as JSON, CSV or a Markdown table, or copy them.
  - The viewer reloads when the file changes on disk, and the start page lists recent files.
- **Editing.** Files open read-only; **Edit** turns editing on for that file.
  - Type over a cell, or press <kbd>Enter</kbd>, <kbd>F2</kbd> or double-click to change it. <kbd>Enter</kbd> and <kbd>Tab</kbd> confirm and move on, <kbd>Esc</kbd> cancels, <kbd>Alt</kbd>+<kbd>Enter</kbd> adds a line break, and <kbd>Enter</kbd> on the last row adds a row.
  - <kbd>Delete</kbd> clears the selection and <kbd>Ctrl/Cmd</kbd>+<kbd>X</kbd> cuts. Pasting from Excel or Google Sheets fills cells; one value pasted into a range fills the range.
  - Insert rows above or below and columns left or right, delete rows or columns, or add them at the end, from the right-click menu or the edit bar. Double-click a column name to rename it.
  - It works like any VS Code editor: the tab shows unsaved changes, <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> saves, <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> undoes, **Revert File** discards, and unsaved edits survive a restart. Saving asks first if the file changed on disk in the meantime.
- **It is always clear what can be edited.**
  - While editing, the cell under the pointer is highlighted with a pencil and a text cursor. Cells that can't be changed are hatched and greyed, with a lock and a "not allowed" cursor. The active cell is outlined solid when editable and dashed when it isn't.
  - The status bar says what the active cell allows: **Editable**, **Locked** or **Read-only** (click it to start editing). The grid's corner shows a lock in the read-only view and a pencil while editing.
  - An edit that isn't allowed (typing, <kbd>Enter</kbd>, <kbd>F2</kbd>, <kbd>Delete</kbd> or double-click) is explained next to the cell. In the read-only view it offers **Edit cell**, which turns editing on and opens that cell.
  - Cells changed since the last save have a yellow bar, explained by a legend in the edit bar. The cell being edited is labelled with its address and the keys that finish it, and renamable column names show a pencil on hover.
- **Protected Excel sheets are respected.** Only cells formatted as unlocked can be changed, as in Excel. Locked cells are marked, skipped by paste and Delete (with a count), and refused by the host as well. Rows and columns can't be added or deleted on a protected sheet, and the protection is kept when saving.
- **Saving CSV** rewrites only the rows you edited. Every other line keeps its exact quoting, spacing, line endings and encoding (UTF-8, UTF-8 with BOM, UTF-16 or Windows-1252), so diffs stay small.
- **Saving Excel workbooks** rewrites only the edited cells.
  - Typed values become numbers, percentages, dates, TRUE/FALSE or text the way Excel reads them, and `=…` enters a formula.
  - An edited cell keeps its style, and a new cell takes its row's or column's style, as in Excel.
  - Shared strings, styles, other sheets, charts, pivot tables and macros are copied unchanged, and Excel recalculates formulas when it opens the file.
  - Rows and columns can't be inserted or deleted in the middle of workbooks with formulas, merged cells, tables, charts, named ranges or validation, because those refer to cells by address. The edit bar says why; cells can still be edited, and rows and columns added at the end.

#### XML → JSON Converter

- **Converts XML to JSON** from pasted text, the active editor (or the editor's right-click menu on XML files), or a file of up to 200 MB with **Convert a file…**, which saves the JSON next to it.
- **Compact JSON** by default:
  - An element with only text becomes a string; otherwise an object of `"@attribute"` keys, child elements and `"#text"`.
  - Repeated elements become arrays, in order. Empty and self-closing elements become `""`.
  - The XML declaration (`"?xml"`), doctype, processing instructions and comments (`"#comment"`) are kept. Namespace prefixes and `xmlns` declarations are kept as written.
- **Lossless mode** keeps every node in order (text around child elements, CDATA, comments, instructions) with each element's namespace URI, so the XML can be rebuilt exactly.
- **Options:**
  - formatted (2 spaces, 4 spaces or tab) or minified output;
  - attribute prefix `@`, `-` or `$`;
  - arrays everywhere, for a stable shape;
  - numbers and booleans, only when they print back identically (so `007`, `1.50` and huge IDs stay text);
  - trim whitespace (never inside CDATA or `xml:space="preserve"`);
  - CDATA as `"#cdata"`;
  - drop comments, the prolog or namespace prefixes.
- **Strict validation.** The first problem is shown with its line and column, the lines around it, and the fix. It catches:
  - mismatched or unclosed tags and a second root element;
  - unquoted or duplicate attributes;
  - a bare `&`, undefined entities (with the numeric reference for HTML ones such as `&nbsp;`) and bad character references;
  - `--` in comments and a misplaced `<?xml`;
  - undeclared namespace prefixes, malformed DOCTYPEs and binary files.
- Entities declared in the DOCTYPE are expanded. UTF-8, UTF-16 and declared encodings such as ISO-8859-1 are read correctly.
- Deep (5,000 levels) and large documents work: about 40 MB of XML converts in a few seconds. Copy, Insert, Open and Save as… always use the full JSON, even when the preview is shortened.

### Improved

- The JSON / YAML / XML Formatter's **Convert to JSON** and **Convert to YAML** now work for XML instead of saying it isn't supported.
- Toolkit tools can now ask for a file to read and where to save their result, for inputs too large to paste.

### Security

- No macro ever runs, and nothing is recalculated or fetched: the viewer reads values Excel already calculated, and the converter never reads external DTDs.
- Size guards: files up to 150 MB open in the viewer, a workbook part may expand to at most 256 MB (against ZIP bombs), and a sheet loads up to 3 million cells. The converter stops entity-expansion ("billion laughs") attacks and nesting deeper than 5,000 levels.
- Element names such as `__proto__` stay ordinary JSON keys and can't change object prototypes.
- The viewer never overwrites a file that changed on disk without asking, and **Export** refuses to replace the file being viewed.

### Packaging

- No new dependency: workbooks are read and written with Node's own zlib, and XML is parsed by DevSnip Pro's own parser.
- Both features load on first use; activation only registers their commands and the two custom editors.

### Docs

- README: a new "CSV and Excel viewer" section, the converter in the tools overview, and 113 tools in 14 sections.
- The architecture overview lists `src/spreadsheet`.

### Tests

- `spreadsheet.unit.ts` covers CSV and XLSX reading and writing, number formats, dates, encodings, editing and undo, sheet protection, and saving that keeps untouched rows and cells byte for byte.
- `spreadsheet.test.ts` runs in VS Code: opening each file type, dirty state, save, undo past the save point, revert and hot-exit backups.
- Saved workbooks were checked with openpyxl, an independent Excel reader.
- `xml-json.unit.ts` covers both mappings, every option, 25 malformed documents with their exact line and column, entity attacks, encodings, deep nesting and a 10 MB document.
- The XML parser was checked against 500 real files (SVG, plists, Office documents, schemas, project files). It accepted and rejected exactly what the expat parser did, and the lossless JSON rebuilt every file to identical canonical XML. 90,000 randomly corrupted documents found four parser bugs, all fixed before release.

## 11.77.1 - Database Client: Oracle, MariaDB, CockroachDB, ClickHouse and a better query editor

The Database Client now connects to ten kinds of databases, has a form for connecting, and its query editor highlights, formats and cancels queries. Every database listed is tested end to end against a real server. Nothing outside the Database Client changes.

### Added

- **Oracle Database** (12.1 or later) through node-oracledb Thin mode, so no Oracle Client install is needed.
  - Connect with `oracle://user:pass@host:1521/SERVICE`, a SID (`?sid=XE`), TCPS (`?ssl=true`), or any `jdbc:oracle:thin:` URL, including connect descriptors.
  - Schemas are the users that own tables; Oracle's own schemas are hidden.
  - Tables without a primary key are edited through `ROWID`.
  - PL/SQL blocks run whole (end them with a `/` line, as in SQL*Plus), and `DBMS_OUTPUT` lines are shown under the result.
  - NUMBER values stay exact, and dates show and save in local wall-clock time.
- **MariaDB** gets its own entry. `mariadb://` connections saved as "MySQL" by earlier versions are relabelled the next time they connect.
- **CockroachDB**, through the PostgreSQL driver, also when you connect with a `postgresql://` URL. Tables without a primary key are edited through CockroachDB's hidden `rowid`.
- **ClickHouse**, over its HTTP interface, with no new dependency. You can browse, filter, insert and query. Rows can't be edited or deleted from the grid because they have no unique key, and the grid says so; use `ALTER TABLE … UPDATE/DELETE` in a query tab.
- **Connect with a form.** Pick the database, then fill in host, port, user, password, database (or Oracle service name), TLS and options. The form and the connection-string field stay in sync, and editing a connection keeps the saved password without showing it.
- **Cancel a running query** on the server (PostgreSQL, CockroachDB, MySQL, MariaDB, SQL Server, Oracle, ClickHouse, and MongoDB `find`/`aggregate`). A timer shows how long it has run. The connection stays usable afterwards.
- **Query editor:**
  - syntax highlighting for SQL, mongosh and Redis commands, and line numbers;
  - **Format** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>);
  - errors underlined at the position the server reports, with **Go to error**.
  - <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> now works anywhere in the query tab.
- **Query results:** sort by clicking a header, filter the rows, resize columns. Copying as JSON or CSV copies what is shown.
- **Indexes** in the Structure view, for every SQL database and MongoDB.
- **Resizable columns** in the data grid, remembered per tab.
- **"What works with each database"** on the welcome page: edit rows, indexes, cancel, and server-side read-only, per database.
- PostgreSQL and CockroachDB accept `sslrootcert`, `sslcert` and `sslkey` for a private CA and for client-certificate login.
- `valkey://` and `valkeys://` URLs open Redis connections.

### Improved

- **Large results:** a console `SELECT` on MySQL, MariaDB and SQL Server now streams and stops at the 1,000-row limit, instead of loading the whole result first. PostgreSQL already used a cursor; Oracle and ClickHouse stop at the limit too.
- **MySQL and MariaDB run multi-statement scripts**, one statement after another on the same session, instead of refusing them.
- **Tables without a primary key** can still be inserted into on MySQL, MariaDB and SQL Server, and duplicated. Only editing and deleting existing rows needs a key.
- **Error messages:** Oracle and ClickHouse errors are mapped to clear messages without their boilerplate. A user's cancel no longer reads as a timeout, and unknown-column errors get a matching hint.
- The connection dialog never names an unnamed connection after a stale example; it uses the detected host and database, or asks for a name.
- Connection rows in the explorer are taller, so the name and the version line no longer touch.

### Fixed

- **View icons covered their row in the explorer.** The icon's class collided with the tab panel's layout class.
- **A PostgreSQL connection kept an idle pool** for the configured database name when the server reported a different current database.
- **A failing status update could fail the action that caused it** (for example, while the panel was closing).
- The Delete button no longer flashes up before a table's data has loaded.
- CockroachDB tables no longer show a misleading row estimate of 0 before statistics exist.

### Security

- Read-only connections are now also enforced by the server on CockroachDB, MariaDB, Oracle (console statements run in a read-only transaction) and ClickHouse (`readonly=2`), in addition to PostgreSQL, MySQL and SQLite. Tests check each of them against a real server.
- The connection form's option field never receives options that could hold a secret, such as `sslpassword`. ClickHouse credentials travel in HTTP headers, never in the URL.

### Packaging

- New dependency: `oracledb`. Only its JavaScript ships; its native Thick-mode binaries, examples and plugins are excluded in `.vscodeignore`, and a test checks that it loads with native modules blocked.

### Docs

- New [docs/DATABASE-CLIENT.md](docs/DATABASE-CLIENT.md) covers:
  - supported databases and what works with each;
  - connection examples, authentication and TLS for every database;
  - how CRUD and the query console work, with examples;
  - security and least-privilege users;
  - limits and troubleshooting;
  - how to run the live tests with Docker, and how to add a database.
- README: the database table now lists all ten databases, with what you can do in each.

### Tests

- New `database-engines.unit.ts` covers:
  - Oracle, ClickHouse and CockroachDB parsing and SQL generation;
  - the Oracle script splitter;
  - error positions and cancellation;
  - the new service requests and the MariaDB relabelling;
  - SQLite indexes and packaging.
- The live suite now covers PostgreSQL, CockroachDB, MySQL, MariaDB, SQL Server, Oracle, ClickHouse, MongoDB and Redis. It checks CRUD, tables without keys, indexes, error positions, cancel, the 1,000-row cap and server-side read-only.
  - SQL Server is now live-tested too; it wasn't before.

## 11.76.6 - Every user counted once, with their country

An analytics fix, plus a Buy me a coffee button in the README. No tools, UI or features change.

### Fixed

- **Users stay merged.** The one-time `$identify` that merges an older anonymous id into the per-machine id (11.76.5) was recorded as done as soon as it was queued. If analytics or telemetry was turned off before the first delivery, the merge was discarded and never sent again, so that person kept counting as two users. It now counts as done only once PostHog has received it. Otherwise it is sent again on the next start, and only once, even if a copy was saved at shutdown.
- **No pointless merge on new installs.** A new install creates a local id for onboarding that is never sent, but on its second start 11.76.5 treated that id as an old one and sent an unneeded `$identify`. New installs now send none.

### Privacy and analytics

- Nothing new is collected: the same three events, the same properties and the same opt-outs.

### Dashboard

- `scripts/posthog-dashboard.js`: the user, retention and geography insights now count users on **every version**, including older ones that sent `session_started`, `feature_used` and similar events. Country and city come from each person's current profile, so users of older versions show where they are too.
- **Users by city (30d)** is a new table. **Users (one row each, 30d)** adds each user's city and extension version.
- **New script:** `scripts/posthog-backfill-geo.js` gives users of versions before 11.76.4 a location. Those versions disabled GeoIP and had no person profile. The script sends one `$set` per user with the IP of their latest event. It is a dry run unless you pass `--send`, and re-running it skips users already done. See [docs/ANALYTICS.md](docs/ANALYTICS.md).

### Docs

- The README has a **Buy me a coffee** button at the top.

## 11.76.5 - Each user counted once in analytics

Anonymous analytics now count each person once. No tools, UI or features change.

### Privacy and analytics

- **One anonymous id per computer.** Earlier versions created a random id for every VS Code profile, user-data folder and reinstall, so one person could look like several users. The id is now a salted SHA-256 hash of VS Code's anonymous machine id, so every profile on a computer is the same user.
  - VS Code's machine id itself is never sent, and the salted hash can't be matched with VS Code's or any other extension's telemetry.
  - If VS Code has no machine id, the extension keeps using its stored random id.
- **Existing users aren't counted twice.** On the first start after updating, DevSnip Pro sends PostHog's `$identify` event once, so PostHog merges the old id and the new one into one person. A new install has nothing to merge.
- Everything else is unchanged: the same three events, no new properties, and the same opt-outs.

### Dashboard

- `scripts/posthog-dashboard.js` counts **people** (`person_id`) instead of raw ids, and every table applies the project's test account filter.
- **Unique users (30d)** is a new single-number tile.
- **Users (one row each, 30d)** replaces the two per-user tables, which listed the same user on many rows. It shows each user's country, first and last seen, active days, tools used, opens, favourite tool and top ten tools.
- **Users by country** counts each user once, in the country they were last seen in.

## 11.76.4 - Simpler, more private analytics

DevSnip Pro's anonymous usage analytics now collect much less. No tools, UI or features change.

### Privacy

- **Three events instead of about thirty.** DevSnip Pro now sends only:
  - a once-a-day "active" ping;
  - which tool you opened;
  - which tool produced a result (a run, a request, a scan).
- They are used to count users, returning users and countries, and to rank the tools.
- **What is gone:** session tracking, plus the onboarding, points and quests, search, snippet, theme and dependency events, and the platform and VS Code version data.
- **Repeats are trimmed:** a tool opened twice in a moment counts once, and a tool counts as used at most once every 5 minutes, so live results are not counted per keystroke.
- **Nothing else changes:** you keep your existing anonymous id. Analytics still only runs when VS Code's telemetry level is `all` and `devsnip.analytics.enabled` is on, and turning it off also deletes anything not yet sent.
- **Never sent:** code, file contents or names, paths, keystrokes, tool input or output, URLs and credentials.
- **Countries** come from PostHog's lookup of the connection. DevSnip Pro asks for no location permission.

### Docs

- [docs/ANALYTICS.md](docs/ANALYTICS.md) is rewritten. It lists the three events and every property, explains how to keep IP addresses out of PostHog, and describes the new dashboard (users, countries, returning users, most-used tools, each user's favourite tool, and daily and monthly trends).
- The README privacy section and the `devsnip.analytics.enabled` setting description describe the new, smaller data set.

## 11.76.3 - A better daily spin and a smoother Play & earn

Redeem's **Play & earn** shows what is left today and what each game can pay, and the daily spin shows every prize with its real odds. Points, prizes and odds are unchanged.

### Improved

- **Redeem → Play & earn:**
  - The summary at the top now shows a progress ring, how many points today's games can still pay, and a **Next** button that jumps straight to the next unfinished game and focuses it.
  - Unfinished games come first. Cards keep their place while the sheet is open, so nothing moves after you play.
  - **Daily spin:**
    - While you have a spin, the wheel gets a full-width card. Next to it, every prize is listed with its real odds.
    - The Freeze and Mystery item rows say what they give. When your freezes are full, or you own every item, they say they pay +25 pts instead.
    - Click the wheel or the button to spin. The pointer ticks while it turns, the winning slice lights up and the others fade.
    - Labels that would stop upside down are turned the right way up.
    - A "You won" panel shows what you actually got. An item can be worn straight away with **Wear it**.
    - Afterwards the card shrinks to "Today's prize", which remembers the real prize, such as "+25 points (your freezes are full)" or "Code Cat avatar", instead of just the slice name.
    - A bonus-spin row shows your progress on today's quests and takes you to them.
  - Bit Sprint shows a quick example and small stat pills instead of empty boxes.
  - The weekly event and check-in week now sit together under "This week", below today's games.
  - The sheet's subtitle matches the open tab.
- Redeem is only drawn while it is open, so the Milestones & Points page updates with less work in the background.

### Docs

- A cleaner, easier-to-scan README: a "What's inside" table, shorter feature sections, a plain comparison with Postman and Thunder Client, and a tidier FAQ.
- README screenshots are about half the size and load directly from GitHub without a redirect, so they appear with the text.

## 11.76.2 - A cleaner, more rewarding Milestones & Points page and Redeem

The same points, milestones, ranks, rewards and data, presented more clearly. Nothing about how points are earned or spent has changed.

### Improved

- **Milestones & Points:**
  - **Your rank:** a gradient progress ring, and a "Next rank" panel with a large progress bar and how many points to go. The rank journey is now a row of every rank's badge, so you can see what you have reached and what is next.
  - **Today:** your quests, the next milestone, the daily boost and this week are grouped in one section. Quests show progress inline, and the bonus chest shows how many quests are left.
  - **Next milestone:** shown prominently with its percentage and what is left to do.
  - **Milestones:** summary tiles for completed milestones, points earned and points still to collect. Milestones are grouped into "In progress" and "Completed", with completed ones as compact trophies so open goals stand out.
  - **Ranks:** your current rank is highlighted in the timeline. **Activity:** points show as coloured pills.
- **Redeem:**
  - **Play & earn:** a "Today's activities" summary at the top shows which of the spin, challenge, Bit Sprint and tip are done, with a progress bar and the points still waiting; click one to jump to it. Finished activities are marked done, and the wheel's odds sit behind a "See the odds" toggle.
  - **Profile:** a larger preview of your rank card, plus how much of each type (avatars, titles, frames, banners, effects) you have collected, next to what you are wearing now.
  - **Shop:** cleaner previews (a big medal for avatars and frames, the title itself for titles), an "Equipped" or "Earned only" ribbon on each card, and "N pts to go" with a progress bar on items you are saving up for. The Profile and Shop tabs show your collection and how many items you can afford.
- Friendlier empty states, subtle entrance animations (off with "reduce motion"), and layouts that adapt from wide editors down to narrow panels.

### Fixed

- Rank colours such as Platinum and Diamond are now readable in light themes.
- On narrow panels, the next-milestone and "This week" cards no longer come out wider or narrower than the cards around them.

## 11.76.1 - Redeem: daily games, weekly events and a profile to make your own

Points are now worth coming back for. A new **Redeem** button on your rank card in Milestones & Points opens three pages: **Play & earn** (something new every day), **Profile** (dress up your rank card) and **Shop** (power-ups and every reward). Everything is cosmetic: every tool still works at every rank.

### Added

- **Play & earn:** daily activities that pay points and teach something. Each one resets at midnight (the event every Monday), and none of them count against the daily tool-use limit.
  - **Daily spin:** one free spin of a prize wheel a day, for points, a streak freeze or a profile item. Finishing all of the day's quests earns a bonus spin. The odds are shown under the wheel.
  - **Daily dev challenge:** one question a day on JavaScript, TypeScript, Git, HTTP, regex, SQL, shell, security, CSS, Python, Docker or VS Code. A right answer pays +15 and trying pays +3; either way you see why the answer is right.
  - **Bit Sprint:** a 30-second mini-game converting between decimal, hex and binary, with the mouse or keys 1–4. The first game of the day pays up to +10; later games are practice for a new best.
  - **Tip of the day:** a DevSnip Pro tool worth knowing, such as the JWT Decoder, the cURL Converter or the .env Checker, with a button that opens it (+5 the first time).
  - **Weekly event:** a different event each week, such as Security Week, AI Week or Explorer Week. Completing it pays up to +100 points and an exclusive avatar, title, frame or banner you can only win that week.
  - **Check-in week:** every 7th day of your streak opens a chest with a free profile item.
  - **Lucky finds:** now and then a tool run pays a surprise +10, at most once a day.
- **Your profile:** 54 items to personalise your rank card in the Tools view, from 40 points. Each one is previewed on your own card before you buy it.
  - **Avatars** replace the rank medal, which moves to the avatar's corner.
  - **Titles** show beside your rank, e.g. "Platinum · Regex Wizard".
  - **Badge frames**, including Frost, Neon pulse, Rainbow halo and Orbit.
  - **Banners** for the rank card background, such as Sunset, Synth grid and Starfield.
  - **Celebration effects** (sparkles, confetti, coin shower, avatar rain or fireworks) play when you finish a quest or a milestone, or rank up.
  - Wear one item per slot, swap it any time, or take it off with one click. Rewards you earn are announced with an **Equip** button.
- **Exclusive rewards:** Diamond, Master and Grandmaster each unlock an avatar, and Grandmaster a title. Milestones such as Feature Explorer, Security Sentinel, Quest Master, a 100-day streak and Point Tycoon unlock titles and a banner. Weekly events have their own prizes that cannot be bought.
- **New milestones:** **Sharp Mind** (answer 10 daily challenges correctly) and **Event Regular** (complete 3 weekly events), each with its own reward.
- **Power-ups:** swap one of today's quests for another (25 points, twice a day) from the ↻ button on the quest, or open a **mystery box** (100 points) for a random profile item you do not own yet.
- **Tools view:** a 🎁 chip on the rank card shows how many daily activities are waiting and opens Play & earn directly. The Redeem button shows the same count.

### Changed

- The **Rewards** tab of Milestones & Points has moved into **Redeem**. Themes are now in the Shop alongside profile items and power-ups, with filters for each type and for what you own or can afford.
- Effects respect "reduce motion" and are drawn locally, without loading anything external.

## 11.75.3 - The official Buy Me a Coffee button

### Improved

- **Buy me a coffee:** the button next to **Spend points** in Milestones & Points is now the official Buy Me a Coffee button, the same one as in the README. The image ships with the extension, so it works offline and the panel never loads anything from Buy Me a Coffee's servers; clicking it still opens the page in your browser.

## 11.75.2 - Sturdier REST client, lower memory use, and a full QA pass

A bug-fix release from an end-to-end check of every command, tool and panel: the REST client's batch tests and large responses, a memory leak in long sessions, and a set of smaller fixes across the toolkit, security scans and snippets.

### Fixed

- **Memory:** every panel you closed stayed in memory (with its whole page) until you next changed the theme, so a long session kept growing. Closed panels are now released straight away.
- **REST API Client:**
  - **Batch test** no longer cancels its own requests: with a concurrency above 1, most requests used to fail. Its success rate now counts every 5xx and network error, not only HTTP 500, and batch and load runs no longer push your real requests out of History.
  - Responses over 2 MB are now truncated for display whatever their format; a large JSON response used to be sent to the panel whole and could freeze it.
  - Images, PDFs and other binary responses are recognised and described with their type and size instead of being shown as garbled text.
  - Basic auth works with an empty password, for APIs that use the key as the user name (Stripe-style `-u sk_test_…:`).
- **Toolkit tools:**
  - A tool no longer fails when a saved choice is no longer one of its options (for example after an update); it falls back to the default. This affected the CI Pipeline Generator and LLM Client Setup.
  - SQL tools report an unterminated string or quoted identifier as a clear input error with its position, instead of "Something went wrong".
  - The App Signing CI snippet is now valid YAML, the AI App Starter escapes the model name in the code it generates, and the Azure Web App Terraform template is `terraform fmt` clean.
- **Console Log Cleaner** removes the whole line when a `console.log` is alone on it, instead of leaving blank lines behind.
- **Security Hub:** an action that fails (such as opening a file that has moved) now shows a message instead of being lost, and template connection strings in files such as `.env.example` (`postgres://user:password@localhost/db`, `${DB_PASSWORD}`) are no longer reported as leaked credentials. Real passwords still are.
- **Snippets:** saving a snippet with a prefix another snippet already uses now asks whether to replace it or keep both, instead of silently creating two suggestions for the same prefix.
- **Database Client:** the row count reads "1 row" instead of "1 rows".

### Improved

- **Buy me a coffee:** a button next to **Spend points** in Milestones & Points, and a link in the README, for anyone who wants to support the project. It opens the Buy Me a Coffee page in your browser. DevSnip Pro stays free.
- **Tests:** a new integration test runs every command in a real VS Code and fails on any error, unhandled rejection, missing panel or memory growth across repeated open/close cycles.

## 11.75.1 - Daily quests, themes to unlock, and a more reliable extension

Points now give you something new to do every day and something to work towards, and this release fixes snippets being lost on update, speeds up startup and makes several panels sturdier.

### Added

- **Daily quests.** Three new goals every day at the top of **Milestones & Points**, such as "Try a tool you have never used", "Run 2 AI tools" or "Open the Database Client". Each pays +10 to +20 points, and finishing all three opens a +15 bonus chest. Quest points are never limited by the daily cap. The Tools sidebar shows today's progress (for example "2/3") on the rank card.
- **Streak freezes.** Earn one every 7 streak days (hold up to 2), or buy one for 50 points. A freeze is used up automatically so one missed day no longer resets your streak.
- **A bigger login bonus for streaks:** +1 point for every day of your streak, up to +15 a day.
- **Four new themes:** **Solarized**, **Ember**, **Synthwave** and **Aurora**.
- **Themes now unlock with points.** Every theme except System Default has a price, from 25 points (Dark, Light, High Contrast) to 900 (Aurora). Solarized, Synthwave and Aurora also unlock free at Silver, Gold and Platinum, and Ember after a 14-day streak. Locked themes show a lock in the theme picker; click one to unlock it, or use the new **Rewards** tab in Milestones & Points. **If you already use a theme, you keep it for free.**
- **Preview locked themes.** Click a locked theme in the sidebar picker, or **Preview** on the Rewards tab, to try it on every DevSnip Pro panel for 30 seconds. A status bar countdown lets you unlock it or end the preview, and DevSnip Pro switches back to your theme when time is up. The theme picker in the Command Palette previews locked themes as you browse too. Every tool still works at every rank.
- **Badge frames:** **Quest glow** and **Flame ring** light up your rank badge in the sidebar.
- **New milestones:** Monthly Marathon (30-day streak), Century Streak (100 days) and Quest Master (finish every quest on 7 days).
- **Progress notifications.** Rank-ups, unlocked rewards, milestones and finished quests now show a short VS Code notification wherever you are working, with a button to try a new theme or open your progress. A weekly recap of points, tool runs and your streak appears once at the start of each week. Choose `all`, `levelsOnly` or `off` with the new `devsnip.rewards.notifications` setting.
- **This week** on the Milestones & Points page: points, tool runs and tools used so far, compared with last week.

### Fixed

- **Custom snippets are no longer lost when DevSnip Pro updates.** VS Code replaces the extension's folder on every update, and that is where snippets were saved, so each update quietly deleted them. Every snippet you save is now also kept in DevSnip Pro's own storage and put back automatically after an update. If you update from 11.74.3 while its folder is still on disk, your existing snippets are recovered from it too, and you are told when snippets were restored.
- Toolkit actions that insert into the editor, open a new document or save files now show an error in the tool panel if they fail (for example, a read-only file), instead of failing silently.
- A failed action in the Tools sidebar, such as choosing or previewing a theme, now shows an error instead of being swallowed.
- Clicking a button in a progress or theme-preview notification can no longer leave an unhandled error behind in the extension host.

### Improved

- **Faster startup.** Snippets, the README manager, the console.log and unused-import cleaners, and the OpenCode integration now load the first time you use them instead of when DevSnip Pro starts. Activation loads 31 modules instead of 38 and is about 20% quicker.
- The README manager's live preview now updates once you pause typing instead of on every keystroke, so large READMEs stay responsive while you edit.
- Removed unused code from the REST API Client.

## 11.74.1 - REST API Client: a first response in one click, and clearer docs

### Added

- **Send a sample request** in the REST API Client. A new, empty request shows a button that sends `GET https://jsonplaceholder.typicode.com/todos/1`, a free public test API, so you see a real response, headers and timing in one click. It only appears while the URL bar is empty, so it never replaces a URL you typed. The Get started walkthrough mentions it too.

### Improved

- **Marketplace listing:** the name is now **REST API Client & Database Client – DevSnip Pro**, so the extension is easier to find by what it does. The description now says up front that it is free and needs no account, and the description, keywords and categories describe the REST API client, database client, LLM token and cost tools and the secret scanner more precisely. The extension ID (`sayaib.hue-console`) is unchanged, so updates and settings carry over.
- **README:** a "Get started in 60 seconds" section, one section per job (REST API client, database client, LLM tools, security scan, utilities), an honest comparison with Postman and Thunder Client that lists what DevSnip Pro does not do, and an FAQ that answers common questions such as testing GraphQL in VS Code.
- **Guides** (`docs/guides`), rewritten as one guide per task, each with a screenshot:
  - How to test REST APIs in VS Code;
  - How to test a GraphQL API in VS Code (new);
  - Free Postman alternative in VS Code;
  - How to connect to PostgreSQL, MySQL, MongoDB and Redis in VS Code;
  - How to count LLM tokens and estimate cost in VS Code;
  - How to install and use OpenCode in VS Code;
  - How to find hard-coded secrets and security issues in VS Code;
  - Format JSON and YAML, decode JWTs and other quick tools in VS Code.
- Removed a README link to an online documentation page that no longer loads.

## 11.73.1 - Getting started, What's new and a faster startup

Easier first steps for new users, a short summary of what changed for everyone who updates, and an extension that starts noticeably faster.

### Added

- **Get started card** at the top of the Tools sidebar, with five first steps:
  - send an API request;
  - try an AI tool;
  - run a security scan;
  - connect a database;
  - pick a theme.
  - Each step ticks itself off only when you actually do it: a request that returns, a scan that finishes, a connection that succeeds. Opening a panel does not count.
  - The card shows "2 of 5" (or "2/5" in narrow sidebars), can be collapsed, and hides itself when every step is done or when you dismiss it.
  - Existing users do not see it; it is for new installs.
- **Get started walkthrough** in VS Code's Welcome page, also available as **DevSnip Pro: Get Started**. It has seven short steps: tools, API client, AI, security, database, themes and points.
- **What's new card** after an update. It lists the highlights since the version you updated from, links straight to each feature, and appears once. **DevSnip Pro: What's New** opens the full release notes any time.
- **Feature Explorer milestone (+60 points):** try five of the following: an API request, an AI tool, a security scan, a database connection, a snippet and OpenCode.
- Two anonymous analytics events, both documented in [docs/ANALYTICS.md](docs/ANALYTICS.md):
  - `activation_milestone` records the first time each core feature is used;
  - `onboarding_action` records use of the guide, walkthrough and What's new card.
  - Like every other event, they contain no code, inputs, URLs or personal data, and follow VS Code's telemetry setting.

### Improved

- **Faster startup:** the REST API Client, security analysers and dependency manager now load the first time you use them, not when VS Code starts. In our measurements activation went from about 105 ms to about 14 ms. Every command works exactly as before.
- **Marketplace listing and README:** a clearer name and description, accurate keywords and categories, real screenshots and an appearance GIF, a quick start, and an FAQ.
- **Documentation:** nine practical guides (`docs/guides`), an architecture overview, a roadmap, a contributing guide, a security policy, and issue and pull request templates on GitHub.
- **Smaller package:** the icon is now 256 px and 44 KB (it was 906 px and 312 KB), and documentation and test files of bundled dependencies are no longer shipped.

### Fixed

- VS Code no longer logs "Unknown language" warnings for the Vue, TOML and Gradle snippets. Vue and TOML are now declared, and the Gradle snippets use VS Code's Groovy language, so `.gradle` files get them.
- Saving a snippet from a `.gradle` or `.groovy` file now files it under Groovy.

## 11.72.1 - Appearance themes for the whole extension

Pick how DevSnip Pro looks from a new **Theme** selector at the top of the Tools sidebar. One click restyles every DevSnip Pro panel at once, with no reload, and the choice is remembered after restarting VS Code.

### Added

- **Nine appearances:**
  - System Default, which follows your VS Code color theme;
  - Dark, Midnight, Dracula, Monokai, Nord and Cyberpunk;
  - Light;
  - High Contrast.
- **Theme selector:** a compact bar above the tool navigation shows the current theme and its colour swatches.
  - It opens a grid of miniature previews: sidebar, text, button and accent colours.
  - It is fully keyboard operable: arrows, Home and End to move, Enter to choose, Esc to close.
  - In narrow sidebars it drops the label, and the grid becomes one column.
- **Command palette:** **DevSnip Pro: Choose Theme** previews each theme as you move through the list, applies the one you accept, and restores the previous theme if you cancel.
- **Everywhere at once:** the sidebar, REST API Client, toolkit tools, Browse All Tools, AI/ML and data tools, Security, Database Client, snippets, Dependencies, Milestones, README manager, console-log and import cleaners, and OpenCode. This includes buttons, inputs, dropdowns, modals, menus, toasts, and empty, loading and error states.
- **Subtle transitions:** colours fade for about 0.2 s while a theme changes, and only then. Nothing animates otherwise, and reduced-motion settings are respected.

### Improved

- **Rank card:** it now shows that it opens the Milestone & Points Tracker. The card was already clickable, but only a faint hover and a tooltip said so.
  - A labelled action strip at the bottom of the card has **How ranks work** and **Milestones & rewards →**.
  - Hovering anywhere on the card tints its border and highlights the action, the arrow slides, and the card has a pressed state.
  - The card shows **+N** when points arrive, highlights "Only 313 to Platinum" near the next rank, and announces rank-ups to screen readers.
  - In narrow sidebars the strip shortens to "ⓘ" and "Milestones →".

- **Milestones & Points, redesigned:**
  - **Rank card:** one card with the level ring and a journey through all seven ranks. It sits beside three focused numbers: balance, with plain wording about what it covers; streak, with the last seven days as dots; and points earned today.
  - **Daily card:** when the boost is unclaimed, it is a prominent **Claim** card. Once claimed, it settles into "You are all set for today". A **Next up** card shows the milestone closest to done and has a **Find a tool** button.
  - **Milestones** list the ones in progress first, closest to done first, and the nearest is marked **Closest**. Each category has a tinted icon.
  - **Ranks** are a connected timeline that shows how many points each locked rank still needs.
  - **Activity** shows a points total for each day.
  - **Reset progress** moved from a red header button into a ⋯ menu, next to **How points work**.
  - Clean line icons replace emoji labels. Every colour follows the appearance theme, and the layout adapts down to narrow panels.

### How it works

- **One theme system:** each theme is one palette of semantic colours (background, surfaces, text, accent, status, syntax). It is expanded into overrides for the VS Code colour variables every DevSnip Pro page already uses, so all panels follow it without per-panel colour code.
- **Design tokens:** shared `--ds-*` tokens (success, warning, danger, info, text on status fills, shadows) are defined on every page and follow the active theme. The remaining hard-coded status colours were replaced with them: tool-panel toasts, success and danger buttons, and the dependency manager's badges.
- **Applied live:** themes are applied through the CSSOM, so pages keep their state when the theme changes. Each page's Content-Security-Policy gains only one extra nonce.
- **Contrast is tested:** every theme is checked for WCAG contrast:
  - 7:1 for body text;
  - 4.5:1 for secondary text, links, button labels and status text;
  - 3:1 for icons and focus rings.
- **Coverage is tested:** a test fails if any stylesheet starts using a VS Code colour that the themes do not set.
- **High Contrast** turns on the outlines pages already draw for VS Code's own high-contrast themes. The other themes switch them off.
- **System Default** hands everything back to VS Code. If VS Code's theme changes while a DevSnip Pro theme is active, DevSnip Pro keeps its theme, and returning to System Default follows VS Code's new one.

## 11.71.1 - Database Client: connect, browse and edit your databases

A lightweight database client inside DevSnip Pro. Paste a connection string for PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, MongoDB or Redis; it is detected and checked, and you can browse the database's structure and read, insert, edit and delete its data from one panel. Open it from **Database → Database Client** in the sidebar, or run **DevSnip Pro: Database Client**.

### Added

- **Connections:**
  - Save, edit, test, connect, reconnect and remove connections, each with a colour.
  - Live detection as you type: the database type, host, database, user, whether a password and TLS are set, and warnings such as TLS being off for a remote host.
  - A status indicator per connection (connecting, connected, failed), with the server version, and **Reconnect** when a connection drops.
- **Explorer:** databases, schemas, tables, views, collections and Redis databases with row, document and key counts, filterable by name. The database named in the connection string opens automatically.
- **Data grid:**
  - Pagination with page sizes up to 500, sorting by any column, and search across all text-like columns.
  - Filter conditions, plus MongoDB filter documents and Redis key patterns and type filters.
  - Typed column headers, NULL, JSON, binary and date values shown distinctly, and right-click actions: copy a value, copy a row as JSON, filter by a value, duplicate a row.
  - Copy a page or the selection as JSON, CSV or INSERT statements, or open it in an editor.
- **Editing:**
  - **Insert, edit and delete** rows, documents and keys. The row editor knows each column's type, required fields, NULL and DEFAULT, and only sends the fields you changed.
  - The MongoDB document editor accepts Extended JSON and shell helpers such as `ObjectId()`, `ISODate()` and `NumberLong()`.
  - The Redis key editor handles strings, hashes, lists, sets and sorted sets, and keeps or changes a key's TTL.
- **Structure view:** columns with types, primary keys, auto-increment, defaults and nullability. For MongoDB, the fields found in a sample of documents and how often each appears.
- **Query console:**
  - SQL for the relational databases, mongosh-style commands for MongoDB (`find`, `aggregate`, `insertOne`, `updateMany`, `deleteOne`, `countDocuments`, `distinct`, indexes and more), and Redis commands, one per line.
  - <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs the selection, or everything.
  - Per-connection query history, and a database and schema picker.
- **Layout:** tabs for tables and queries that survive switching editors, a resizable sidebar and editor, keyboard navigation, and a layout that adapts to narrow panels.

### Safety

- Connection strings are stored in the OS keychain through VS Code SecretStorage, never in settings, state or logs.
- The webview never receives a password: an edited connection shows `********`, and saving it back keeps the stored one.
- Passwords are removed from every error message, and driver errors are turned into plain explanations with a hint, for example "connection refused", "authentication failed", "duplicate key" or "foreign key".
- Destructive actions need a native confirmation:
  - deleting rows, documents or keys;
  - destructive console statements: `DROP`, `TRUNCATE`, `DELETE`, `UPDATE` or `updateMany({})` without a filter, `deleteMany`, `drop()`, `FLUSHDB` and similar.
- Dropping or emptying a table, a collection or a Redis database also asks you to type its name.
- **Read-only connections** refuse every write, including from the console. On PostgreSQL and MySQL the database session is read-only as well, so a write hidden in a function call still fails.
- Every request from the panel is validated again on the extension side:
  - table and column names must exist in the live schema before they are quoted into SQL;
  - every value is a bound parameter;
  - row keys are always recomputed from the table's metadata.
- Rows are identified by primary key, or by `rowid` (SQLite) or `ctid` (PostgreSQL). Views, and MySQL and SQL Server tables without a primary key, are read-only rather than risk changing the wrong row.
- Connections and queries time out (10 s to connect, 30 s per query); console results are capped at 1,000 rows, and PostgreSQL streams them through a cursor.
- The console refuses Redis commands that block or change the connection itself (`SUBSCRIBE`, `MONITOR`, `SELECT`, `BLPOP` …), and the MongoDB console parses commands as data and never evaluates them.

### Under the hood

- Drivers: `pg`, `mysql2`, `mssql`, `mongodb`, `ioredis`. SQLite uses Node's built-in `node:sqlite` when VS Code provides it, and otherwise `sql.js`, which re-reads the file when it changes and writes back atomically.
- The drivers load on first use, so activation stays as fast as before.
- The package ships only what Node loads at runtime: no source maps, type declarations or browser builds.
- Tests:
  - unit tests for connection-string parsing and masking, SQL generation for every dialect, statement classification, the mongosh parser, Redis command safety and the service's safety rules;
  - SQLite end-to-end tests on both engines;
  - opt-in live tests that run full CRUD against real PostgreSQL, MySQL, SQL Server, MongoDB and Redis servers (`DEVSNIP_TEST_*_URL`).

## 11.70.1 - Web and Mobile toolkits, and every tool in one clear place

This release adds 32 tools for full-stack web and mobile development. It also reorganises all 109 tools into 13 focused sections, and merges the tools that overlapped. Every existing command id still works, so keybindings, favorites and usage history carry over. Everything runs locally; nothing you paste (tokens, keys, certificates, logs) leaves VS Code.

### New navigation

- **13 sections, most-used first:**
  - Backend & API
  - Web & Frontend
  - Mobile Development
  - Code & Productivity
  - Text & Formatters
  - Encoders & Converters
  - Database
  - Testing & Debugging
  - Git & Version Control
  - DevOps & Cloud
  - Security & Auth
  - AI & ML
  - Data & RAG
- **One home per tool:** every tool appears in exactly one section, ordered by how often developers use it.
- **Browse All Tools:** one searchable hub with a filter per section replaces the seven separate hubs. The old hub commands open it on their section, and the RAG guided path is kept.
- **One source:** the sidebar, hub, tool search and command palette titles all come from one layout, so they always agree. Palette titles use one emoji per section.

### Added

- **Backend & API:**
  - cURL Converter, with 13 targets including Dart, Kotlin/OkHttp and Swift.
  - URL & Query String Tool.
  - CORS Builder & Debugger: config, a browser-accurate header check, and explanations for console errors.
  - OpenAPI / Swagger Toolkit: lint, TypeScript types, a typed fetch client, cURL examples, and a spec from sample JSON.
  - GraphQL Formatter & Types.
  - API Resource Scaffolder: Express, NestJS, Next.js or Fastify, on Prisma, Mongoose or an in-memory store.
- **Web & Frontend:**
  - React / Next.js / React Native Generator.
  - HTML → JSX.
  - CSS Units & Fluid Type.
  - SEO & Social Meta Tags.
  - Cache-Control Builder.
- **Mobile Development:**
  - adb & simctl Commands.
  - Deep Links & Universal Links.
  - App Permissions.
  - Local API Access from Devices.
  - Environments & Build Flavors.
  - Signing, Keystores & Fingerprints.
  - SDK & Build Compatibility.
  - Mobile CI Workflow, with Play and TestFlight upload.
  - dp / px / pt Converter & Asset Sizes.
- **Database:** Database Connection Strings (they fix password encoding) and SQL → MongoDB.
- **Testing & Debugging:** Build Error Explainer, covering more than 50 Gradle, Xcode, CocoaPods, Metro, Flutter, npm and Next.js errors.
- **Git & Version Control:**
  - Git Command Recipes with Conventional Commit messages.
  - .gitignore Generator, which detects your stack.
  - Semver & App Version Calculator.
- **Security & Auth:**
  - OAuth 2.0 & PKCE Helper.
  - CSP & Security Headers.
  - Cookie Inspector & Builder.
  - Certificate & SSL Pinning Inspector.
  - Hash, HMAC & Webhook Signatures (GitHub, Stripe, Shopify, Slack).
- **Text & Formatters:** Regex Tester & Library, with tested patterns and code for 9 languages.
- **Encoders & Converters:** Timestamp Converter, with time zones and date math.
- **DevOps & Cloud:** docker run → Compose.
- **Improved existing tools:**
  - JSON to Types now generates Dart, Kotlin and Swift models.
  - The JWT tool verifies RS/PS/ES/EdDSA tokens with a PEM key, certificate or JWK, and signs test tokens.
  - The ID generator creates MongoDB ObjectIds and decodes ObjectId and snowflake timestamps.
- **Every tool:** a Save as… button on code, text and table outputs.

### Merged

- **JSON/XML Formatter + YAML / JSON Validator** → **JSON / YAML / XML Formatter**. It formats, minifies, validates and converts all three, and reports the exact line of every JSON error.
- **Color Palette + Color Converter** → **Color Converter & Palette**, covering CSS, Tailwind, Android, Compose, Flutter and SwiftUI, with WCAG contrast and a 50-950 shade palette.
- **Token & Cost Estimator + Model Comparison** → **LLM Models, Tokens & Cost**.
- **LLM JSON Extractor + Response Formatter** → **LLM Output Cleaner & JSON Validator**.
- **Schema Viewer + Schema Diff** → **Schema Viewer & Diff**.
- **Standalone panels:** Regex Builder, Hash Generator and Timestamp Converter were rebuilt as full tools under their old commands.
- **Security Hub shortcuts:** they were five sidebar entries for one panel; the sidebar now lists the four scans.

### Removed

- **Experiment Log:** it only formatted one JSON line; use MLflow, Weights & Biases or a plain `experiments.jsonl`.
- **URL mode of the Port & Network Toolkit:** replaced by the URL & Query String Tool and Database Connection Strings.

### Fixed

- **Regex tester:** flags without `g` (for example `i`) threw an error and showed no matches.
- **Timestamp converter:** the date picker showed UTC time as if it were local time.
- **Narrow drop-downs:** long option labels were cut off.
- **Editor context menu:** a command opened from the right-click menu now also receives the selected text.

## 11.69.1 - Tools sidebar: search, filters, favorites and rank card

The Tools sidebar was redesigned again, to read like a polished navigation panel rather than a basic tree. Every tool, category, icon and command is unchanged.

### Added

- **Rank card:**
  - A compact card showing your rank, your points and how far you are from the next rank, with a progress bar and percentage.
  - An info popover explains how ranks work and lists every rank's threshold.
- **Search:**
  - <kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd> or <kbd>/</kbd> focuses the search box.
  - Search matches tool descriptions as well as names, and highlights the matches.
- **Filter menu:** All tools, Favorites, Recently used, Most used, or a single category. When a filter is active, the button shows a dot and a "Show all" bar appears.
- **Favorites:**
  - Star a tool on hover, or press <kbd>F</kbd> on a focused tool.
  - Favorites are pinned at the top of the sidebar.
- **Recently used and Most used:** tools opened from anywhere (sidebar, hubs or the command palette) are counted.
- **Hover cards:** each tool shows a one-line description, its category and how often you have used it.
- **Empty states:** they offer to search every DevSnip Pro tool, clear the search, or show all tools.

### Changed

- **One category open at a time:** opening a category in All tools closes the others. While searching, every category with a match stays open.
- **Animation:** categories expand and collapse smoothly.
- **Selection:** the selected tool is marked with a tinted background and an accent icon instead of a side bar. A collapsed category that holds the selected tool shows a small dot.
- **Security:** the category has its own subtle red tint.
- **Design system:** a consistent 8px spacing system, corner radii and icon sizes, with layered surfaces taken from the VS Code theme.
- **Narrow sidebars:** they keep more of each tool's name visible.

## 11.68.1 - Tools sidebar redesign: cleaner categories and spacing

Redesigned the left navigation panel for a cleaner, more compact, and highly scannable VS Code-style experience. Improved category hierarchy, spacing, active/hover states, and icon alignment, while keeping all existing tools and functionality completely intact.

## 11.67.1 - REST API Client redesign: clearer requests and responses

Enhanced the REST API Client with an improved UI/UX, simplified navigation, clearer request/response sections, better button placement, and an easier workflow for creating, testing, and managing API requests.

## 11.66.1 - Toolboxes rebuilt for everyday work

Every tool section was reviewed. Low-value tools were removed or merged, rarely-right calculators were replaced by accurate ones, and the most common daily tasks got new tools. All toolbox tools share one panel design and one set of output actions.

### New tools

- **Developer Tools:**
  - JWT Decoder, with HMAC signature verification.
  - UUID & ID Generator: v4, v7, ULID, Nano ID and passwords, plus timestamp decoding.
  - Diff Checker: text, or structural JSON.
  - Case Converter & Text Tools.
  - Cron Expression Helper: plain-English explanation and next runs.
- **AI & ML:**
  - Model Comparison.
  - LLM Client Setup: production-ready client code for six providers.
  - LLM JSON Extractor & Validator: repair plus JSON Schema validation.
  - Response Formatter.
  - Vector Similarity.
  - AI App Starter.
- **RAG:**
  - Embedding Model Guide.
  - Vector Store Setup.
  - Retrieval Configuration.
  - Grounded Prompt Assembler.
  - RAG Pipeline Generator, with presets for popular stacks.
  - Chunk Metadata Validator.
  - A guided "Start here" path in the RAG hub.
- **Data:**
  - Data Converter: CSV, TSV, JSON, JSON Lines, YAML, Markdown and SQL.
  - JSON to Types: TypeScript, Zod, Pydantic, dataclasses, Java, Go and JSON Schema.
  - Mock Data Generator.
  - Data Transformer.
  - SQL Query Helper: parameterised CRUD, upsert and pagination per dialect.
  - JSON Schema Validator.
  - API Response Inspector.
- **DevOps (new hub):**
  - Dockerfile Generator & Linter.
  - Docker Compose Generator & Validator.
  - Kubernetes & Helm Generator / Validator.
  - CI Pipeline Generator.
  - Cloud Deploy Workflow (OIDC).
  - `.env` Checker & Generator, which finds variables used in code but never declared.
  - YAML / JSON Validator & Converter.
  - Nginx, PM2 and Terraform generators.
  - Port & Network Toolkit.
  - Health Check Generator.

### Replaced (same commands, rebuilt tools)

- **Kept command ids:** replaced tools keep their command ids, so keybindings and points history carry over. The replacements, by previous name:
  - Token Counter → Token & Cost Estimator.
  - Prompt Template Manager → Prompt Builder.
  - GPU VRAM Calculator → GPU Memory & Speed Estimator (it also absorbs the Inference Estimator).
  - Chunking Strategy Tester, Context Window Calculator, RAG Eval Calculator, Hallucination Analyzer, Hybrid Search RRF and Semantic Dedup → accurate, testable versions.
  - Spark SQL Formatter → SQL Formatter & Linter.
  - Data Quality Checker → Data Profiler.
  - JSONL Viewer → JSON Lines Inspector.
  - Base64 Encoder → Encode / Decode (URL Encoder opens it in URL mode).
  - Observability Log Analyzer → Log Analyzer & Formatter.
  - AI/ML DevOps Generator → Model Serving Starter.
  - Observability Starter → an OpenTelemetry starter with an exporter and trace-aware logs.
- **JSON → TOON now produces real TOON.** The old output was an outline that dropped TOON's table form and left strings ambiguous. The new encoder uses tables for uniform records and reports token counts before and after.
- **DevOps Artifact Generator** now opens the DevOps hub instead of a quick pick.
  - Its generated files no longer use unpinned `latest` images.
  - It no longer reports success after you declined to overwrite a file.

### Removed

- **Prompt Playground:** use Prompt Builder.
- **LLM Inference Estimator:** merged into GPU Memory & Speed Estimator.
- **Dataset Profiler:** use Data Profiler & Quality Check.
- **Markdown Table Generator:** Data Converter writes Markdown tables.
- **Lorem Ipsum Generator:** VS Code's built-in Emmet `lorem` abbreviation does this.

### How the tools work

- **Presets:** every tool has presets or sample data, and cheap tools update live as you type.
- **Right-click entries:** tools that act on the open file appear in the editor's right-click menu, only where relevant (for example, SQL formatting in `.sql` files and the `.env` checker on `.env` files).
- **Output actions:** Copy, Insert at cursor, Open in editor, Save, and Write all to workspace.
  - Generated files can only be written inside the workspace.
  - Existing files are never overwritten without confirmation.
  - Logs append instead of overwriting.
- **Startup cost:** the tool definitions load only when a tool, hub or search is first opened, so activation is not slowed down.
- **Analytics:** two new anonymous events, `tool_run_completed` and `tool_output_used`, carry the tool id, outcome and duration only, never inputs or outputs.
- **Tests:** a new test suite runs every tool with its defaults, every preset and every option (about 480 runs). Generated JSON and YAML are parsed, TypeScript and JavaScript are compiled, and Python is byte-compiled.

### Redesigned tool hubs

- **One consistent tool grid.** The Developer Tools, AI & ML, RAG, Data and DevOps hubs share a single design:
  - Every card has a line icon (the same on every OS and theme, instead of emoji), a colour per category, the title, a short description, a tag and an Open cue.
  - Hover and keyboard focus are clearly visible.
- **Find tools faster:**
  - A search box (press `/`) matches titles, descriptions, tags and extra keywords, ranks the best matches first and highlights them. Enter opens the top result.
  - Category chips show how many tools each category holds.
  - An empty state offers to clear the search or search every DevSnip Pro tool.
- **Pin favourites:** the star on a card pins it to the top of its hub. Pins are remembered.
- **Keyboard and accessibility:**
  - Cards are real buttons, and arrow keys move between them as laid out on screen.
  - Result counts are announced to screen readers.
  - High-contrast themes, narrow panels and reduced motion are supported.
- **Fixed:** clicking a second card in any hub did nothing, because each click requested the VS Code webview API again, which VS Code refuses after the first time. Tool counts in hub headers were hard-coded and wrong (the AI hub said 15 while listing 12).
- **Hubs are generated from the tool registry**, so a hub can no longer miss a tool or list one that does not exist.

## 11.65.1 - Anonymous usage analytics (PostHog)

- **What it measures:**
  - Every DevSnip Pro command reports which feature ran, its area, success or error, duration, and whether it was the installation's first use of that feature.
  - Feature events cover snippets created and deleted, tool search (query length and match count only), copies, REST requests saved and deleted, README saves and deletes, Dependencies panel scans and jobs, milestones, levels and points spent.
  - Sessions record duration and engaged time.
- **Privacy by construction:**
  - Every property is validated against a typed event catalog, and there is no free-text property type, so code, paths, queries, URLs and names cannot be sent.
  - Identity is a random per-install UUID.
  - Events are anonymous in PostHog (no person profiles, no GeoIP).
- **Consent:** sent only when VS Code's `telemetry.telemetryLevel` is `all`, `devsnip.analytics.enabled` is on, and the extension is an installed build. `devsnip.analytics.debug` shows every event in an output channel.
- **Performance:** `track()` only queues. Delivery is batched in the background, with backoff and a bounded queue, and never blocks or breaks a feature.
- **Key handling:** the PostHog project key is written into the package at build time from `POSTHOG_PROJECT_API_KEY` and never committed. Builds without it have analytics off. Personal keys are refused.
- **Dashboard:** `scripts/posthog-dashboard.js` creates a 24-insight dashboard covering real-time and DAU/WAU/MAU users, most and least used features, adoption, errors, sessions, engagement, retention and feature-specific activity.
- **Documentation:** `docs/ANALYTICS.md` documents every event and property, and a unit test keeps it in sync with the catalog.
- **Install lifecycle:** `extension_activated.install_type` is `new`, `updated` or `returning`, and a new `extension_updated` event carries `previous_version`. Users who had DevSnip Pro before analytics are not counted as new installs.
- **No lost events at shutdown or after a crash:** undelivered events and the open session are checkpointed to a local file and delivered on the next start. A session left open by a crash is closed with `reason: interrupted`. Every event has a `uuid`, so PostHog de-duplicates resends, and batches include `sent_at` for clock-skew correction.
- **Test data separation:** every event carries `environment` (`production` for Marketplace builds; `test`, `staging` or `development` otherwise). The dashboard script sets the project's test-account filter and applies it to every insight.
- **`scripts/verify-analytics.js`** runs a production-like end-to-end test before each release. It checks a fresh install, an update and a restart in an isolated VS Code, then verifies in PostHog that every event arrived, sessions close, identity is anonymous and consistent, and no unexpected data was stored.

## Version 10.65.0 - 2026-09-28

- **New layout.** A level ring shows progress to the next level, next to four at-a-glance stats: balance (and how many premium tools it covers), points earned in total, streak (and days to the next streak milestone), and today's points against the daily cap. A "Today" strip holds the daily login, the daily boost and the milestone closest to completion. Tabs cover Milestones (filterable, closest-to-done first), Levels, Activity (grouped by day, with readable tool names) and How to earn.
- **Live and flicker-free.** The panel updates in place when points change anywhere in DevSnip Pro. It previously rebuilt the whole page on every action and showed stale numbers until reopened. Only sections whose data changed are redrawn.
- **Feedback.** Level-ups and unlocked milestones are announced, the milestone card pulses, and the balance counts up. All motion respects _reduce motion_.
- **Accessibility.** The tabs are real buttons with arrow-key navigation, progress bars expose their values, and focus is visible. Colours come from the VS Code theme; level colours are blended with the text colour so Platinum and Diamond stay legible in light themes.
- **Layout.** Works from phone width to wide editors.

### Fixed

- **Spending points no longer lowers your level.** Levels and the Point Tycoon milestone now use points earned in total, which spending never reduces. Previously one premium run at 160 points dropped a user from Silver to Bronze. Existing data is migrated from the balance plus the spending still in the activity log.
- **Level cards no longer say tools are locked.** Levels are recognition only; no tool is gated by level, but the cards read "Locked: AI/ML Hub…". The inconsistent rank labels ("Rank #0.5", "Rank #1" twice) are replaced by titles.
- **The daily login bonus is awarded after midnight** when VS Code stays open. It is claimed when the tracker is shown, not only at activation, and the "Claimed" state reflects what actually happened instead of always showing ✓.
- **Claiming the daily boost reports in the panel**, rather than as a separate notification.

### Added - Dependencies & Installation

- **`DevSnip Pro: Dependencies & Installation`**, a new Developer Code tool (Developer Utilities hub, Utilities tree group, tool search). It detects every Node.js, Python, Maven and Gradle project in the workspace and lists each dependency with its declared range, installed version, latest compatible version and latest stable release, plus a status: up to date, update available, newer major, missing, wrong version or unknown.
- **Package managers:** npm, yarn 1, yarn 2+ (berry), pnpm, pip, Maven (with or without `mvnw`) and Gradle (with or without `gradlew`, including version catalogs). Detection uses Corepack's `packageManager` field, the nearest lockfile (so monorepo packages use the root's manager), `.yarnrc.yml`, wrappers, and Python virtual environments or the interpreter selected in VS Code.
- **Manifests read:** `package.json`, `requirements*.txt` and `requirements/*.txt`, `pyproject.toml` (PEP 621, optional dependencies and PEP 735 groups), `pom.xml` (with property resolution), `build.gradle`, `build.gradle.kts`, `gradle.properties` and `gradle/libs.versions.toml`.
- **Latest versions** come from registry.npmjs.org, pypi.org, Maven Central and Google's Maven repository. The range matching follows npm semver and PEP 440 exactly, and Maven's version ordering (including flavours such as Guava's `-jre`).
- **One-click Install missing and Update outdated**, per project and workspace-wide, with streamed progress, cancellation (the whole process tree is stopped), a 15-minute timeout, a full log in the "DevSnip Pro: Dependencies" output channel, and failure messages that name the cause and the fix.
- **Copyable commands** for every dependency (install, add, update within range, upgrade), quoted for POSIX shells or PowerShell/cmd.
- The panel rescans when a manifest is saved.

### Safety

- Nothing runs without a native confirmation listing the exact command lines, the working directory and what will change. Installs are refused in an untrusted workspace.
- Production is never changed implicitly: bulk updates stay inside declared ranges (lockfile and installed packages only) and skip production dependencies unless _Include production dependencies_ is ticked. Upgrading a production dependency past its range, upgrading pip past a specifier, and every Maven/Gradle version change are copy-only.
- Commands are generated by the extension from an allow-list of operations and flags and re-validated before they run; the webview can only send ids. Package names and ranges are validated, and git, URL, path and workspace sources are never installed automatically.
- Processes are spawned without a shell. On Windows, `.cmd` shims go through `cmd.exe /d /s /v:off` with every argument quoted, and `"` and `%` are rejected. Executables are resolved from absolute PATH entries outside the workspace, so a repository cannot shadow `npm` or `mvn` with its own script.

## Version 10.64.0 - 2026-09-23

The Security section is rebuilt. It was two static file scanners and a five-header check inside the API client; it is now a scanner with one rule engine, one result model and one panel.

### Added - Security Hub

- **`DevSnip Pro: Security Hub`** hosts four scans in one panel: endpoint, workspace, cloud and container, and dependencies and configuration. Each produces the same result shape, so a finding looks the same however it was found: status, severity, affected area, what was observed, and the change that fixes it. Results are filterable by status and full text, and exportable as Markdown or JSON.
- **`DevSnip Pro: Endpoint Security Scan`** performs real requests against a URL and grades what comes back. It covers HTTPS and TLS (certificate trust, hostname match, expiry, protocol, cipher and key strength, and whether plain HTTP redirects), HSTS, the security header set, Content Security Policy, CORS, cookie flags, authentication and authorization, API security, information exposure, rate limiting and input reflection.
- **`DevSnip Pro: Dependency & Security Config Check`** reads the workspace manifests and reports on lockfiles, unbounded version ranges, abandoned or compromised packages, registry credentials in `.npmrc`, `.env` hygiene, automated dependency updates, whether CI runs a security scan, and whether workflows narrow their token permissions. It reports passes as well as problems.
- Two opt-in active probes, both read-only: a **reflected-input probe** that checks whether a marker string is encoded on the way out, and requests for **well-known sensitive paths** (`.env`, `.git`, `actuator`, backups, debug endpoints), each confirmed by a content signature.
- Two settings: `devsnip.security.endpointTimeout` and `devsnip.security.activeChecks`.

### Changed

- **The API client's Security Header Scan now runs the same engine** instead of its own weaker copy. It previously checked four header names and reported a list of strings; it now returns the full graded report with severities, evidence and remediation, rendered as a report rather than a JSON dump.
- **The workspace and cloud audits share the engine too.** Both keep their command ids and now open in the Security Hub on the matching tab and start immediately.
- The Security group in the tool tree lists all five entries instead of two.

### Correctness - fewer false positives

- **An endpoint that was never reached no longer produces findings.** The previous behaviour would have reported every header as missing for a host that did not answer; the scan now says the endpoint was unreachable and grades nothing.
- **Certificate key strength is judged per key type.** A fixed 2048-bit floor reported every modern ECDSA certificate as weak, since a P-256 key is 256 bits.
- **Private-address detection uses real octet bounds.** A loose pattern matched SVG path data such as `10.669.606.225` as an internal IP.
- **Secret keyword rules are filtered by placeholder form, value shape and Shannon entropy.** In source, a credential is only reported when it is a quoted string literal: `password: resolvedPassword`, `apiKey: options.apiKey` and `auth?: { password: string }` are references and declarations, not secrets. Unquoted values are still read in `.env`, `.ini`, YAML and similar files, where that is how a secret is written. On this repository the rule went from 34 findings to 2. The keyword match also recognises prefixed names such as `POSTGRES_PASSWORD`.
- **Documented vendor example credentials are ignored** in both the file scan and the response scan. `AKIAIOSFODNN7EXAMPLE` appears in AWS's own guides and in every tutorial copied from them; reporting it as a leaked key is a false positive by construction. The audit test fixtures were changed to a non-placeholder key of the same format so they still assert that the rule fires.
- **`innerHTML` assigned a constant string is no longer an injection finding** - only concatenation or interpolation is.
- **The SQL rule requires SQL clause shape** (a `FROM`, a `SET`, an `INTO`), so the English word "select" in a UI string no longer looks like a query.
- **The cookie-flag rule requires cookie or session context**, instead of matching any object literal with a `secure: false` field.
- **The plain-HTTP rule requires a real host**, so prose ending in `http://` is not reported as an insecure endpoint.
- **`eval` no longer fires on a method named `eval`** (`model.eval()` in PyTorch was the common case), and the plain-HTTP rule ignores XML namespaces, schema locations, licence URLs and loopback addresses.
- **A wildcard CORS origin without credentials is no longer reported as exposed write access**, because a cross-origin caller is anonymous in that configuration.
- A cookie without `Secure` on a loopback address is a low warning rather than a high failure, and a cookie being cleared is not graded on its flags at all.
- A response over 512 KB no longer aborts the scan: the transfer cap is now separate from the analysis sample, which is what made a large homepage report nothing at all.
- A rule that throws is contained to its own group; the rest of the report still runs.

### Fixed

- **A command that opened the panel and started a scan in one step did nothing.** The scan request was posted before the webview script had parsed, so it was dropped. The host now queues until the page reports ready.
- Duplicate check ids are made unique, so filtering and rendering cannot collide.
- Reverse-tabnabbing and subresource-integrity checks apply to any HTML document, not only ones served over HTTPS.
- Cookie values are discarded at parse time and never reach a report; matched credentials are masked in every evidence line.

### Tests

- 115 new unit tests covering the parsers, every analyzer, the scoring model, the static rules and the posture checks, including explicit regression tests for each false positive listed above. The suite is 263 tests and runs in a plain Node process.

## Version 10.63.2 - 2026-09-23

### Documentation

- **Rewrote the README for people rather than for the command list.** It now opens with what you can actually do - test APIs, work with LLM and vector endpoints, clean up a codebase, generate infrastructure files - instead of tables of internal command identifiers. Tools are grouped by the job you came to do, and commands are reached the way people reach them, by typing "DevSnip Pro" in the Command Palette.
- Cut from 247 lines to 151 (28.6 KB to 9.2 KB) by dropping six command-id tables that duplicated the Command Palette, and trimming the troubleshooting entries to the symptom and the fix.
- Every remaining fact is checked against the source: the command count, the snippet language count, the minimum VS Code version, the points prices and daily caps, the three settings, and every command id referenced.
- Documented the points system as it now works, with no mention of licences or subscriptions.
- Corrected the keyboard-shortcuts section, which presented three bindings as though they shipped; the extension contributes none, so they are now shown as an example to add.
- Added a Privacy section: no backend, no telemetry, no account, and credential-looking values redacted before a request enters history.
- Contains no images or badges.

## Version 10.63.1 - 2026-09-23

### Fixed

- **Tool action buttons were stacked and ragged instead of sitting in a row.** Each button was wrapped in its own container, and that container's class had no CSS rule left after an earlier UI change - so every button became an unstyled block sized to its own label. Consecutive buttons now share one flex row with a common minimum width, while a button that follows other fields still starts a new row beside the fields it acts on (Prompt Versioning's "Diff versions" stays with its compare inputs rather than jumping to the top).

## Version 10.63.0 - 2026-09-23

The licence-key system is gone. Premium REST API Client features are unlocked purely by spending DevSnip Pro points.

### Removed - licence system

- **The licence key entry, storage and verification are deleted**, along with the commands that managed them (`activatePremium`, `deactivatePremium`, `setDevelopmentTier`), the licence portal setting, the subscription state, the offline verification cache and its grace period, and the development tier override. `src/premium/entitlement.ts` no longer exists.
- **The duplicate Points Hub is gone.** It hand-rolled four tools that are already priced registry features, charging points with its own bespoke redeem-and-refund code (149 lines). Those tools now run through the same access service as everything else.
- Points Hub has been replaced by a real **Your points** view listing what the current balance unlocks, what it does not and by how much, and how points are earned.

### Changed - points are the only entitlement

- `FeatureAccessService` takes a points ledger instead of an entitlement store. A premium feature is available when the balance covers its price and unavailable when it does not.
- The header shows the live balance; every premium tool shows its price in the navigation, in the accent colour when affordable and the warning colour when short.
- **Saved requests are now unlimited for everyone.** The 15-request cap existed only to differentiate a paid tier; with no tier to sell, keeping it would have removed capability. Collection import and export remains the premium half, priced in points.
- Daily caps on AI requests, prompt runs and streamed responses apply to everyone; a large balance does not bypass them.

### Correctness

- Points are charged only after the work succeeds, so a failed request costs nothing.
- The charge is atomic: if the balance moves between the check and the charge, the run is refused rather than given away.
- A negative, NaN or infinite balance reads as zero and unlocks nothing; a ledger that throws leaves free features working.
- Verified end to end through the real host code: fresh install locked, earning by tool use unlocks, running deducts exactly the price, draining locks again with the correct shortfall, a denied run neither executes nor moves the balance, an overdraw attempt leaves the balance at zero, and the balance persists across service instances.

### Fixed

- A stray closing brace left by removing the development tier controls would have broken the whole inline script. The parse guard caught it before it shipped.

## Version 10.62.0 - 2026-09-22

Premium REST API Client features are now unlocked with DevSnip Pro points. Every premium tool has a price, running it deducts that price from your balance, and when the balance is too low the tool explains what it costs and how to earn more.

### Changed - points are the unlock path

- **All 21 premium REST API Client features are priced in points** and charged per run. Prices reflect the work involved: 8 points for a local check such as assertions or response comparison, 10-20 for tools that make network calls, 25-35 for multi-model comparison, benchmarking, RAG and agent runs.
- **The price lives on the feature in the registry**, so a cost is defined in exactly one place and the navigation, the tool panel and the access check all read the same number.
- **The balance is the gate.** A feature is available when the balance covers its price and unavailable when it does not; the denial names the price, the balance and the shortfall.
- **Points are charged only after the work succeeds**, so a failed request, a bad API key or a network error never costs anything.
- **The charge is atomic.** If the balance changes between the check and the charge the run is reported as unaffordable rather than being given away.
- A DevSnip Pro Premium subscription still covers every premium feature and is never charged points.

### Added - user interface

- The points balance sits in the client header and updates the moment a charge lands; selecting it opens the Points Hub.
- Every premium tool in the navigation shows its price, in the accent colour when affordable and in the warning colour when the balance is short.
- An affordable tool opens with a bar stating what the run costs and the current balance.
- A tool that cannot be afforded shows its price, the balance, how many more points are needed, and a **How to earn points** explainer covering the whole economy, instead of a dead end.
- Each run reports its deduction and the new balance.

### Tests

- New coverage: points unlock premium features, a successful run deducts exactly the price, a failed run costs nothing, spending down the balance closes access again with the correct shortfall, a subscriber is never charged, and every premium feature carries a price so none is unreachable.
- Markup assertions for the header balance, the price tags and the earn-points explainer.

## Version 10.61.3 - 2026-09-22

REST API Client accessibility, performance and polish pass. The layout, navigation, collections, history and response panels were already in place; this release fixes what an audit of that UI turned up.

### Fixed - performance

- **A large JSON response built a DOM of tens of thousands of nodes.** Syntax highlighting wraps every token in an element, so a 900 KB payload produced over 60,000 of them and left the panel slow to scroll, search and select. Rendering is now capped, with a one-click option to highlight the whole payload: the same response now renders 478 nodes in 30 ms instead of 60,475 in 156 ms. Copy and Save still operate on the complete payload, and the in-response search reports matches found beyond the rendered portion.

### Fixed - accessibility

- **Two tab groups never updated `aria-selected`**, so a screen reader always announced the first tab as the active one no matter which panel was showing. The visual and accessible states are now set together.
- **Tab groups could not be driven from the keyboard.** Left/Right/Up/Down, Home and End now move between tabs, and a roving tabindex means Tab steps past the group rather than through every tab in it.
- **URL validity was conveyed only by colour and a hint.** The field now sets `aria-invalid` and points at its message with `aria-describedby`, and the message is a polite live region.
- **Five authentication inputs had visible labels that were not associated with their fields** (bearer token, basic username and password, API key name and value), so their accessible name was missing.

### Fixed - theming

- The in-response search highlight was the one colour in the sheet that ignored the VS Code theme; it now uses the editor's own find-match colours with a themed outline.

### Tests

- New suite asserting the client's markup invariants: every tab exposes a selected state, every tab list is labelled, every input has an accessible name, status uses a glyph as well as colour, the palette resolves through VS Code variables, the response render budget is present, and the WebSocket allowance still tracks entitlement.
- The inline-script scanner now models template-literal escape handling correctly, including unrecognised escapes, so it no longer reports valid regular expressions as broken.
- `workspace tools complete without throwing` no longer waits on a QuickPick that a headless run can never answer; the suite went from one 30-second timeout to green in 7 seconds.

## Version 10.61.1 - 2026-09-22

### Fixed

- **Every button in the REST API Client stopped working.** Introduced in 10.61.0. The webview script is written inside a TypeScript template literal, where `\n` is an escape the compiler consumes - so what reached the browser was a real newline in the middle of a JavaScript string literal. That single unterminated string made the whole inline script fail to parse, which disables every control in the panel at once, not just the new ones. The compiler could not see it, because to TypeScript the script is only a string. All 33 affected escape sequences are now written as `\\n` so the browser receives `\n`.

### Added - regression guard

- The unit suite now renders the REST API Client exactly as the extension host does and parses the resulting script, in both CSP modes. It also scans every inline webview script in the codebase and parses each one, so this class of bug fails the build instead of reaching a panel.
- `getWebviewContent` is exported so the rendered page can be asserted on directly.

## Version 10.61.0 - 2026-09-22

Adds a Free/Premium feature system to the REST API Client, organised around AI/ML and software-development workflows. Every feature listed is implemented and works end to end; nothing is a badge over an empty code path.

### Added - feature access architecture

- **Central feature registry** (`src/premium/feature-registry.ts`): one definition per feature with its category, group, tier, description and limits. Nothing else in the codebase defines a tier, so changing one is a single edit.
- **Entitlement store** (`src/premium/entitlement.ts`): subscription state behind a pluggable `LicenseVerifier`, so a licensing backend can be connected later without touching callers. No payment provider is referenced anywhere.
- **Feature access service** (`src/premium/feature-access.ts`): the single decision point. Every operation runs through `access.run(featureId, ...)`, which checks entitlement immediately before the work and records usage only after it succeeds.
- **Usage limits** are declared in the registry, never inline. Free allowances: 25 AI requests, 25 prompt runs, 10 streamed responses and 15 saved requests per day.
- **Licence keys are stored in VS Code SecretStorage**, never in settings, global state or a webview. Tests assert the key cannot be found in global state.

### Added - Software Developer tools

- Free: client code generation for JavaScript (fetch and axios), Python, Go, Java and C#; JSON format, minify, validate and path query; JWT decoding with expiry and unsafe-algorithm warnings; request collections.
- Premium: WebSocket testing; OAuth 2.0 helper (client-credentials, password and refresh-token grants) with the token held in secret storage and only a masked preview shown; declarative assertions on status, latency, headers and JSON paths; request chaining with value extraction between steps; batch performance testing with p50/p90/p99; structural response comparison; unlimited collections with import and export.

### Added - AI/ML Developer tools

- Provider adapters for OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint, each with the correct request shape, auth header, response parsing and streaming format.
- Free: single LLM requests, prompt testing, token and cost estimation, basic streaming, and JSON Schema validation of model output.
- Premium: multi-model comparison, LLM benchmarking with latency percentiles and tokens/second, streaming diagnostics (time to first token, inter-chunk latency), embeddings testing with cosine similarity, vector database testing (Qdrant, Pinecone, Weaviate, Chroma), RAG pipeline testing with a grounding score, agent tool-calling traces, prompt evaluation against declarative criteria, prompt versioning with diffs, and AI request analytics.

### Security

- Entitlement is enforced in the extension host at the operation layer. Hiding a control is presentation only; a locked feature cannot be reached through an alternate command or a crafted webview message.
- Assertions and prompt criteria are declarative data, not scripts. Nothing from a saved collection is ever evaluated as code.
- The agent tester returns caller-supplied canned tool results; the extension never executes what a model asks for.
- Every webview payload is coerced and bounded before it reaches a service.
- The development tier override is read only in a development or test host and is ignored by an installed extension, so it cannot bypass licensing in production.

### Offline behaviour

- A successful licence check is cached for 24 hours; the licence server is not contacted on every feature call.
- If verification is unreachable, a previously valid licence keeps working for up to 14 days rather than revoking a paying user's access. After that the tier drops to free with a clear explanation.

### Compatibility

- Every existing REST API Client capability is unchanged and still free.
- The four points-unlocked tools (security header scan, load test, SDK export, mock generator) remain unlockable with DevSnip Pro points for free users, with the points refunded if the tool fails.

### Tests

- Unit suite grows to 139 tests, covering tier decisions, expiry, invalid licences, offline grace and its expiry, cache TTL, the development override being ignored in production, daily limits (including that a failed call does not consume allowance), collection caps, and every provider adapter, assertion operator, JSON tool and code generator.
- Integration suite grows to 51 tests, covering command registration, licence round-trip through real secret storage, and a sweep proving no premium feature is reachable for a free user and no free feature is blocked.

## Version 10.60.0 - 2026-09-22

Stabilisation release. Every feature was audited end to end; the fixes below are behavioural, not cosmetic.

### Fixed - correctness

- **Removing a `console.log` left `);` behind.** The scanner reported a range that excluded the closing parenthesis and the semicolon, so cleanup corrupted the edited line. Ranges are now exact, and a removal is skipped (with a warning) when the file changed since the scan.
- **"Remove all" buttons did nothing.** Console-log cleanup, unused-import cleanup and the Milestone Tracker reset all asked for confirmation with `confirm()`, which the VS Code webview sandbox blocks. Confirmation now happens in the extension host through a guarded dialog helper that treats an unavailable prompt as "not confirmed".
- **Errors in the Dataset Profiler, Metrics Calculator and Prompt Playground were invisible** - they used `alert()`, also blocked in webviews. They now render an inline status banner, and copy actions report success or failure.
- **Tool usage was counted twice** for any tool opened from a hub: the global `registerCommand` monkey-patch and the hub dispatcher both awarded points. Points are now awarded in exactly one place.
- **Concurrent tool runs lost points.** Every read-modify-write of the points store is serialised through a queue.
- **The daily streak could advance just by reading stats**, because the day rollover mutated state that was not always persisted. The rollover is now idempotent, and uses the local calendar date instead of UTC.
- **Long-term milestones were unreachable.** Progress was derived from an activity log capped at 100 entries, so the 100-run milestone could never complete. Progress now comes from lifetime counters, migrated from existing history.
- **The JSON/XML Formatter never received the editor selection** - the prefill message was posted before the webview script existed. The webview now signals readiness first.
- **Missing snippet files.** 35 of the 40 snippet files declared in `package.json` did not exist, so VS Code logged a load error for each at startup. All declared files are present.
- **Creating a snippet for an unsupported language silently did nothing.** The language is validated against the contributed set, with a picker when it does not match.
- **Stale compiled output shipped in the VSIX**, including JavaScript for features deleted from source. Builds now start from a clean `out/`.
- **The integration test suite never ran.** The deprecated `vscode-test` package looked for an `Electron` binary that current VS Code builds do not ship; migrated to `@vscode/test-electron`.

### Fixed - security

- **The README preview loaded `marked` from a public CDN and rendered README content through `innerHTML` under `script-src 'unsafe-inline'`** - remote code plus HTML injection from any file in the workspace. Markdown is now rendered by a dependency-free renderer that escapes the source first, under a nonce CSP, with no network access. `javascript:` and `data:` links are dropped.
- **A webview could ask the extension to run any VS Code command.** Hub dispatch now validates the id against the commands this extension registered.
- **Workspace content could break out of an inline `<script>`.** Console-log data embedded in the cleaner page is now escaped so a `</script>` sequence in a source file cannot inject markup.
- **The extension trusted file offsets sent from a webview** when deleting code. Selections are matched against the scan results and re-verified against the file before any edit.
- **API keys passed in a query string were persisted and exportable in plain text.** Credential-like query values are redacted before request history is stored.
- **Shell-string command execution** in the OpenCode hub was replaced with argument-array `execFile` calls. cURL export quoting is verified against a real shell in the test suite.

### Fixed - reliability and platform support

- The OpenCode hub rendered a blank panel for up to 18 seconds while detection ran; it now renders immediately with a loading state and streams results in. Failures report the actual reason instead of being swallowed, repeat clicks are ignored while work is in flight, and posting to a closed panel no longer throws.
- OpenCode detection searches the locations a desktop-launched VS Code misses (`/opt/homebrew/bin`, `~/.opencode/bin`, `~/.local/bin`, `~/.bun/bin`, the npm prefix, Scoop shims on Windows).
- `terminal.shellIntegration` (VS Code 1.93+) is feature-checked before use; the manifest now declares `^1.93.0` instead of `^1.86.0`, which it silently required.
- The generated Terraform artifact was not valid HCL (commas inside blocks).
- Directory creation and stack detection use URI-based filesystem APIs, so generators work in remote and virtual workspaces.
- Security audits used a `**/*` glob against a 500-file cap, so binaries consumed the budget and real findings were missed. Scans are now extension-targeted with a configurable 2000-file budget.
- One output channel is reused instead of leaking a new one per run; every webview message listener is disposed with its panel; running a tool twice reveals the open panel instead of stacking another.
- A failure in one command group no longer prevents the rest of the extension from registering.

### Changed

- Removed the global monkey-patch of `vscode.commands.registerCommand` in favour of an explicit tracked-registration helper.
- All panels follow the active VS Code theme; the hard-coded dark palettes (which were unreadable in light and high-contrast themes) are gone, and borrowed theme colours have fallbacks.
- The README Manager is now a real manager: create, open, save, insert section templates, reset to template, and delete, with live preview and word counts.
- Points economy: a per-day cap on repeatable points, with one-time milestone bonuses exempt, so levels reflect sustained use.
- Corrupted or partial points data is repaired on read instead of throwing or resetting progress.
- Deduplicated ~830 lines of copied CSS and helpers into `src/utils/webview-ui.ts`; deleted ~700 lines of dead code (unused legacy webviews, an orphaned snippet generator, commented-out implementations).
- `devsnip.apiTimeout`, `devsnip.consoleLogCleanup.confirmBeforeDelete` and `devsnip.securityAudit.maxFiles` are now real contributed settings - they were documented but never existed.
- Added the editor context submenu the README described but the manifest never contributed.
- `mongodb` (unused) and `@vscode/vsce` (a build tool) were removed from runtime dependencies, and `.vscodeignore` was corrected. The VSIX went from 13,822 files / 35.5 MB to 477 files / 1.6 MB.
- Declared workspace-trust and virtual-workspace capabilities, and removed the `browser` entry point the extension could never satisfy.

### Tests

- New unit suite (63 tests) covering points/state handling, the markdown renderer, webview escaping, command validation, the console-log scanner and the unused-import analyser. Runs in plain Node via `npm run test:unit`.
- Integration suite extended to 43 tests: activation, registration of all 57 commands, opening all 45 webview tools, panel reuse, settings and menu wiring, and the security rules against real fixture files.

## Version 10.59.2 - 2026-09-21

### Fixes

- Fixed Windows PowerShell execution-policy prompt swallowing the OpenCode launch command. The hub now waits for shell readiness via the Terminal Shell Integration API before running `opencode`, with a Command Prompt fallback and a one-command policy fix (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).

## Version 10.59.1 - 2026-09-22

(Note: The REST API Client received a major feature upgrade:

### New Features

- **API Key authentication** — add a custom header or query-parameter key to requests (Auth tab)
- **Body type selector** — choose JSON (default), plain text, or `application/x-www-form-urlencoded` (Body tab)
- **Automatic retries with exponential backoff** — configurable `retries` (max 5), `retryDelay`, and `retryStatusCodes` (defaults: 429/502/503/504). Also retries on network/timeout failures. Backward-compatible (`retries` defaults to 0).
- **Redirect & SSL controls** — `followRedirects`, `maxRedirects`, and `rejectUnauthorized` toggle for self-signed certs
- **Proxy support** — explicit host/port/auth, or `false` to disable entirely
- **cURL import & export** — paste a `curl` command to auto-populate method, URL, headers, body, and basic auth; copy the current request as a `curl` command from the topbar
- **History export** — export full request history as JSON or CSV
- **Response truncation** — responses over 2MB are silently truncated in the UI with a `truncated` flag; `attempts` reported in history and response metadata

### Improvements

- Auth tab now supports API Key (header or query) alongside Bearer and Basic
- Body tab has a type selector (JSON / Text / Form URL Encoded)
- New Advanced tab: retries, retry delay/status codes, redirect/SSL toggles, proxy config
- Topbar buttons: 📋 cURL (copies request as cURL) and ⬇ Export (saves history to file)
- Pasting a `curl ...` command into the URL bar now imports it as a live request
- Response panel shows retry attempt count and truncation warnings
- History now records `attempts` per request and a per-request attempt count

### Fixes

- Invalid JSON with explicit `Content-Type: application/json` now throws a clear error instead of silently sending malformed data
- Cookie jar now properly deduplicates cookies across requests
- GraphQL body parsing and error messages improved for malformed variables/operation names

### Integration Tests

- Added comprehensive test suite (`src/test/api-test.test.ts`) exercising cURL generation/parsing, body type encoding, retry logic, auth header delivery, redirect handling, and `makeRequest` against a local test server — all without external network calls.

## Version 10.58.0 - 2026-09-21

### New Features

- **OpenCode Integration Hub** -- new Core tool (`sayaib.hue-console.openCodeIntegration`) that checks for Node.js and the OpenCode CLI, installs or repairs OpenCode via the official `opencode-ai` npm package, rechecks system status, and launches OpenCode in a terminal rooted at the current workspace folder.
- **Cross-platform support** -- detection, installation, terminal launching, and workspace handling work on Windows, macOS, and Linux, with per-OS guidance (npm, Homebrew, install script, Chocolatey, Scoop, WSL).
- **Broken-install detection** -- an npm listing alone no longer reports as installed. Partial installs (package listed but the `opencode` binary does not run) are flagged with a repair flow that removes the stale package and reinstalls cleanly.
- **REST API Client webview pattern** -- single-render hub with direct element-id event bindings and `postMessage({ command })` messaging; install success is only reported after `opencode --version` is verified to run.

### Fixes

- Fixed OpenCode hub buttons not responding (replaced CSP-blocked inline handlers and fragile full-page re-renders with persistent bindings).
- Fixed Install/Recheck appearing stuck (removed `sudo` via exec, which hangs without a TTY; added timeouts to all dependency checks).
- Fixed wrong npm package for OpenCode (`opencode` does not exist on npm; corrected to `opencode-ai`).

## Version 10.57.0 - 2026-09-21

### New Features & Improvements

- **Milestone Tracker & Points System** -- added user activity tracking, streaks, level progression (Bronze to Grandmaster tiers), and real-time sidebar widget badge.
- **README Viewer & CRUD Manager** -- added a dedicated core tool to view, edit, scaffold, and preview markdown documentation with GitHub-style live preview.
- **AI/ML Tool Enhancements** -- added LR Scheduler Visualizer and LLM Inference & VRAM Estimator tools.
- **Big Data Tool Enhancements** -- added Delta Lake Log Analyzer and Spark Cluster & Cost Estimator tools.
- **RAG Tool Enhancements** -- added Hybrid Search RRF Simulator and RAG Hallucination Analyzer tools.

## Version 10.56.0 - 2026-09-17

### New Features & Security

- **Supply Chain 2-Year Monitoring & Quarantine** -- added automated security audit checks to monitor open-source components with a history of security lapses/malware incidents, flagging any package versions published within the mandatory 2-year post-incident monitoring window with security warnings and provenance verification guidance.
- **Vulnerability Remediation** -- resolved all 29 known high and critical severity software composition vulnerabilities, including actively exploited components and CVSS-scored critical issues across dependencies.

## Version 10.55.0 - 2026-09-17

### New Features & Improvements

- **Live Functional Premium API Tools** -- upgraded all 4 REST API Client Premium Tools (Security SecScan, Multi-Region Load Test, Type-Safe SDK Exporter, and AI Response Mock Server & Schema Generator) to execute real live requests, parallel load batches, and dynamic code generation instead of dummy data.
- **Instant Result Visibility** -- repositioned the Premium Feature Output box to the top of the Premium Hub tab with smooth auto-scroll into view upon tool execution.
- **CSP-Compliant Button Handlers** -- wired premium action buttons using robust script event listeners to guarantee flawless interaction in VS Code webviews.

## Version 10.53.0 - 2026-09-15

### Improvements

- **Enhanced README & Visual Showcase** -- completely revamped the README.md with professional banners, visual GIF demos, side-by-side screenshots, badge styling, and cleaner typography for maximum user engagement.

## Version 10.52.0 - 2026-09-15

### New Features

- **README Viewer & CRUD Manager** -- added a dedicated Core tool to view, edit, create, and manage workspace `README.md` and markdown documentation files with interactive webview previews and default scaffolding templates.

### Improvements

- **Optimized README.md** -- restructured and shortened for clean visual understanding, making all 50+ features immediately visible via categorized feature matrices with direct command triggers.

## Version 10.51.0 - 2026-09-10

### New Features

- **Milestone Tracker & User Points System** -- track daily usage, completed activities, streaks, and local points.
- **Level Progression & Leaderboard Ranks** -- automatic advancement from Bronze through Silver, Gold, Platinum, Diamond, Master, and Grandmaster tiers.
- **Real-time Sidebar Widget** -- displays current level badge and accumulated points in real-time right at the top of the Activity Bar tree view.
- **Delta Lake Log Analyzer & Spark Cost Estimator** -- new Big Data developer tools for lakehouse logs and cloud cluster cost sizing.
- **Hybrid Search RRF Simulator & Hallucination Analyzer** -- new RAG tools for Reciprocal Rank Fusion and source attribution scoring.
- **LR Scheduler Visualizer & Inference Latency Estimator** -- new AI/ML developer tools for learning rate curves and GPU VRAM/throughput sizing.
- **Interactive Cloud Security Audit Webview** -- upgraded Cloud Security Audit to open a rich interactive webview panel with clickable source code line jumps, matching Local Security Audit.

### Improvements

- Balanced point progression and anti-farm rate limiting for all tool executions.
- Left-aligned text alignment across all Milestone Tracker UI components.

## Version 10.50.0 - 2026-09-09

### Removed

- Removed the Code Snapshot feature entirely (command `sayaib.hue-console.captureCode`, webview, and all related assets).
- Removed `dom-to-image` and `file-saver` npm dependencies.
- Removed `devsnip.codeSnapshotTheme` configuration setting.
- Removed Code Snapshot from Core tool group, universal search, and Activity Bar tree.

## Version 10.49.140 - 2026-09-09

### Improvements

- Redesigned the Code Snapshot webview with a cleaner dark UI, smoother transitions, and better visual hierarchy.
- Replaced the complex export SVG logo with a minimal camera icon.
- Added clipboard and refresh icons to the Copy and Use Current Selection toolbar buttons.
- Added an empty-state placeholder inside the snapshot container when no code is selected.
- Replaced the inline SVG terminal dots with styled `<span>` elements for lighter markup.
- Added a loading spinner on the Export button during snapshot generation.
- Added success/error color feedback on the export status message.
- Added a "Copied!" confirmation on the Copy Code button after copying.
- Moved PNG to the default export format in the dropdown.

### Fixes

- Fixed SVG export failing because the download link was not appended to the DOM before triggering click.
- Fixed "Use current selection" button returning stale code from the original editor selection instead of the current active editor.
- Fixed `computeEdeditorLineNumberWidth` typo renamed to `computeEditorLineNumberWidth`.
- Added null guards for DOM elements in the snapshot export path to prevent runtime errors.
- Improved export error messages to show the actual failure reason instead of a generic message.
- Added safe initialization check for `colorPicker` to prevent crashes if the script has not loaded.

## Version 10.49.139 - 2026-09-08

### Improvements

- Replaced the Security Audit terminal output with a styled VS Code webview.
- Added severity summary cards for critical, high, medium, and low findings.
- Added redacted evidence, remediation guidance, and a clearer finding layout.
- Added an `Open at line` action that jumps directly to the scanned source location for fixing.
- Added exact resource tracking for reliable navigation in multi-root workspaces.

### Fixes

- Security Audit no longer requires users to search the terminal for findings.
- Security finding navigation now opens the correct file and line instead of relying only on relative workspace paths.

## Version 10.49.138 - 2026-09-08

### New Features

- Added a dedicated Security Center with local code security and local cloud-configuration audits.
- Added cloud/IaC checks for public ingress, wildcard IAM permissions, public storage, privileged containers, embedded credentials, disabled encryption/TLS, and mutable container tags.
- Added an AI/ML DevOps generator for CPU/GPU containers, Kubernetes GPU serving, ML CI, and model-serving contracts.
- Added DevOps generators for Docker, Compose, Kubernetes, Terraform, secure CI, and observability starter files.
- Added structured log analysis and Node.js/Python OpenTelemetry starter templates.

### Improvements

- Simplified the Activity Bar navigation with shorter labels and workflow-focused groups.
- Reduced visual noise by using neutral child icons and color accents only for category headers.
- Removed the custom maximize/minimize controls from the Tools view to keep the interface clean and consistent with VS Code.
- Added safe overwrite confirmation for generated deployment and observability files.
- Added bounded, local-only scanning with binary-file filtering, size limits, skipped dependency/build directories, and redacted evidence.

### Deployment Notes

- Run `npm run compile` before packaging.
- Review generated Docker, Kubernetes, Terraform, CI, and OpenTelemetry templates before deploying them.
- The cloud security audit scans local configuration only; it does not access AWS, Azure, or GCP accounts.

## Version 10.49.136 - 2026-09-07

### New Features

- Added universal regex tool search across all DevSnip Pro commands.
- Added Dataset Profiler, Model Metrics Calculator, and Prompt Playground tools.
- Added nested JSON and JSONL path support for deeply structured datasets, including arrays and MongoDB-style date values.

### Improvements

- Reorganized the activity-bar navigation into Core Workflow, Snippets, AI/ML/LLM, Data Engineering, and Advanced Utilities sections.
- Reorganized every inner tool hub into workflow-based groups with a consistent responsive card layout.
- Updated Schema Viewer to infer schemas from ordinary JSON documents and render deeply nested objects and arrays.
- Updated Schema Diff Tool to compare inferred data shapes and formal JSON Schemas using stable nested paths.

### Fixes

- Serialized webview-triggered command launches to prevent overlapping Extension Host flush calls.
- Added a deterministic first-debug workflow that compiles before launch and starts a clean Extension Host window.

## Version 10.47.135 - 2026-09-07

### Improvements

- **README completely rewritten** -- removed all screenshots and images, replaced with a clickable indexed feature list (35 features) with anchor links for easy navigation
- Added "How to Access" section at the top with 3 clear access methods (Activity Bar, Command Palette, Right-Click Menu)
- Added quick reference table mapping user goals to exact menu paths
- Expanded each tool from grouped tables into individual documented sections
- Cleaned up supported technologies section (text list instead of icon images)

## Version 10.47.134 - 2026-09-07

### New Features

- **AI/ML & LLM Tools Hub** -- 10 new tools for AI/ML workflows:
  - Token Counter & Cost Calculator (GPT-4o, Claude, Gemini, Llama, Mistral)
  - Prompt Template Manager with variable substitution
  - Python ML Code Generator (PyTorch, TensorFlow, HuggingFace, LangChain)
  - LLM API Tester with streaming support
  - Dataset Split Calculator with stratification
  - GPU VRAM Calculator (FP32/FP16/BF16/INT8/INT4)
  - Experiment Logger with Markdown export
  - Model Card Generator (HuggingFace format)
  - JSONL Viewer for training data
  - Markdown Table Generator

- **Big Data Tools Hub** -- 5 new tools for data engineering:
  - Schema Viewer (Parquet, Avro, JSON)
  - Spark SQL / Presto / Trino Query Formatter
  - Data Quality Checker (CSV, JSON)
  - Schema Diff Tool (side-by-side comparison)
  - Partition Calculator (Hadoop/Hive/Spark)

- **RAG Tools Hub** -- 5 new tools for Retrieval-Augmented Generation:
  - Chunking Strategy Tester (fixed, sentence, recursive, overlap)
  - Embedding Cost Calculator (OpenAI, Cohere, HuggingFace)
  - Context Window Calculator with visual utilization bars
  - Semantic Dedup Checker (n-gram similarity)
  - RAG Eval Calculator (precision, recall, MRR, faithfulness)

- **GraphQL support** in REST API Client -- dedicated query editor, variables, and operation name
- **Environment variables** in REST API Client -- create, manage, and resolve `{{variable}}` placeholders across requests

### Improvements

- **REST API Client** -- complete UI redesign with professional layout, method color coding, config tabs, request history, cancel button, and responsive design
- **Advanced Developer Tools Hub** -- added Color Palette and Lorem Ipsum Generator (now 9 tools), unified theme system with toast notifications
- **Activity Bar** -- added AI/ML, Big Data, and RAG tool hubs to the sidebar tree view
- **README** -- completely rewritten with comprehensive feature documentation

### Removed

- Removed legacy `snippets/` directory (replaced by `custom/` snippet system)

## Version 10.46.133 - 2025-12-03

- Added JSON to TOON converter and readme updated

## Version 10.43.119 - 2025-04-03

- Rest API status code issue fixed in test REST API section

## Version 10.42.118 - 10.42.119 - 2025-04-03

- Solved Snippets visibility error to jsx components in react

## Version 10.42.116 - 10.42.117 - 2025-03-26

- Update readme and fixed bugs of activity bar (added all features there)

## Version 10.41.107 - 10.41.116 - 2025-03-24

- Update readme and fixed bugs of activity bar (added all features there)

## Version 10.41.107 - 2025-03-21

- Added DevSnip pro in activity bar for easy access

## Version 10.40.101 - 10.40.103 - 2025-02-20

- Added code capture snapshot in right menu bar.

## Version 9.40.101 - 2025-02-18

- fixed minor bugs

## Version 9.40.100 - 2025-02-17

- Replace the selected console.log with a direct removal of the console.log in the row, accompanied by a remove button.

## Version 9.39.99 - 9.39.100 - 2025-02-05

- Added multiline console log search and update readme features section.

## Version 9.39.98 - 2025-02-04

- Optimized code for large project (faster console log searching)

## Version 9.38.97 - 9.38.98 - 2025-02-04

- Logo changed

## Version 9.38.95 - 9.38.96 - 2025-02-03

- Added Tailwind CSS v4 and Bootstrap v5
- fixed language bugs and activation errors

## Version 8.38.93 - 8.38.95 - 2025-01-30

- Exclude all the temps file while searching.

## Version 8.37.93 - 2025-01 -28

- Updated user manual index

## Version 8.37.92 - 2025-01-24

- Optimized code performance by removing unnessary line any apply reusable component and changed description.

## Version 8.36.89 - 9.36.92 - 2025-01-24

- Optimized code performance by removing unnessary line any apply reusable component.

## Version 8.35.80 - 2025-01-24

- Added Loading screen "Analyzing your project to retrieve all console logs. Please wait....""

## Version 8.34.89 - 8.34.91 - 2025-01-22

- Added Console Log Hunt and delete.

## Version 7.34.89 - 2024-12-31

- Apply global search in custom snippets view table.
- Grouped table content by programming language.

## Version 7.33.88 && 7.33.89 - 2024-12-31

- add new documentation links

## Version 7.33.86 && 7.33.87 - 2024-12-23

- Updated the reactJS , MongoDB and MongoDB aggregation snippets with more snippets example.

## Version 7.32.86 - 2024-12-19

- Updated the snippets table link in README with the actual documentation link.

## Version 7.31.86 - 2024-12-18

- Added a "View Custom Snippets" user manual to the documentation with screenshots.

## Version 7.30.86 - 2024-12-18

- Added visualization for all custom snippets created by users.

## Version 6.30.85 && 6.30.86 - 2024-12-16

- Changed gallery banner theme and color.

## Versions 6.30.81, 6.30.82, 6.30.83, 6.30.84 - 2024-12-16

- Added full document URL for DevSnip Pro.

## Version 6.29.81 - 2024-11-29

- Added keywords.
- Updated README with a user manual for custom snippets creation.

## Version 6.28.81 - 2024-11-29

- Updated README with a user manual for custom snippets creation.

## Version 6.28.80 - 2024-11-27

- Updated README with a new screenshot showing how to use custom snippets.

## Version 6.28.79 - 2024-11-26

- Changed description.

## Version 6.27.79 - 2024-11-25

### Features

- **HTML5 Boilerplate Update**: Enhanced the structure and compatibility with modern browsers.

### Improvements

- **Performance Optimizations**: Improved load times and reduced file sizes for better user experience.

### Security Updates

- Applied security patches for known vulnerabilities.

### Cross-Browser Compatibility

- Improved compatibility with the latest browser versions.

### Fixes

- **Minor Bug Fixes**: Resolved issues related to element positioning and responsiveness.

### Notes

- Ensure to clear browser cache after updating the boilerplate to apply all optimizations effectively.

## Version 5.27.62 - 2024-11-22

- Updated the HTML5 boilerplate.

## Version 5.27.61 - 2024-11-22

- Changed description and keywords.

## Version 5.26.61 - 2024-11-22

- Changed description.

## Versions 5.26.60 to 5.26.55 - 2024-08-07

- Modified README file.
- Changed screenshot sizes in tables.
- Linked href changes.
- Added developer profile and images in README.
- Fixed minor bugs.
- Added smaller supported languages icons.
- Added supported code snippets list.

## Versions 5.26.54 & 5.26.53 - 2024-08-06

- Redesigned README with structured icons for supported code snippets languages and frameworks.
- Added NodeJS snippets with screenshots and instructions.

## Versions 5.24.52 & 5.24.51 - 2024-08-06

- Displayed screenshots in tabular format in README file.
- Updated README with document manual link.

## Version 4.23.50 - 2024-08-05

- Fixed minor bugs in Flutter code snippets.

## Version 4.23.49 - 2024-08-05

- Fixed minor bugs in Flutter code snippets.

## Version 4.23.48 - 2024-08-05

- Added Flutter snippets screenshot in README file.

## Version 4.22.48 - 2024-08-05

- Added Flutter snippets.

## Version 3.22.48 - 2024-08-05

- Removed extra tag in README.

## Version 3.22.47 - 2024-08-05

- Removed extra "Code Snippets Collection" tag.

## Version 3.22.46 - 2024-08-05

- Updated GIF link.

## Version 3.22.45 - 2024-08-05

- Updated README.

## Version 3.22.44 - 2024-08-05

- Beautified the README.

## Version 3.22.43 - 2024-08-05

- Adjusted logo aspect ratio.

## Version 3.21.42 - 2024-08-05

- Updated README with an external link to the user manual.

## Version 3.20.42 - 2024-08-05

- Minor changes in README file.

## Version 3.20.41 - 2024-07-29

- Changed extension name from "Prism Snippets and Logger" to "DevSnip Pro."

## Versions 3.19.41 & 3.19.40 - 2024-07-29

- Adjusted logo aspect ratio.
- Updated logo.

## Versions 3.18.40 & 3.17.40 - 2024-06-06

- Updated logo (R1 & R2).

## Version 3.16.40 - 2024-06-06

- Added TypeScript snippets reference to README.

## Version 3.15.40 - 2024-06-06

- **Big Update!** Added TypeScript snippets.

## Version 2.15.40 - 2024-06-06

- Updated extension description.

## Version 2.14.40 & 2.14.39 - 2024-06-06

- Tested for better visibility of the manual.

## Version 2.14.38 - 2024-05-24

- Updated sponsor information.

## Version 2.13.38 - 2024-05-20

- Fixed minor bugs in printing tables.

## Version 2.13.37 - 2024-05-20

- Added table printing in the logger section.

## Version 2.12.37 - 2024-05-08

- Updated copyright information.

## Versions 2.12.34, 2.11.34 & 2.10.34 - 2024-04-30

- Added MIT License.
- Added identifiers.
- Fixed minor bugs and added language support.
