# SCA Scanner

Software composition analysis for the projects in your workspace. It answers four questions for every dependency, direct and transitive:

1. **Is this exact version affected by a known vulnerability?** (OSV.dev, which includes the GitHub Advisory Database.)
2. **Is that vulnerability being exploited?** (CISA's Known Exploited Vulnerabilities catalog.)
3. **Is the package still healthy?** (Deprecated, yanked, abandoned or outdated, from each package registry.)
4. **What is the safest fix, and what controls the version?** (Your manifest, a parent POM, Spring Boot's BOM, or another dependency.)

It is built for Spring Boot first: Maven and Gradle projects are resolved with their parent POMs, BOM imports, properties, `dependencyManagement`, exclusions and conflict rules. A fix is proposed where it belongs. Often that is a newer Spring Boot release or an overridden Boot property, not a lone pin that splits a library family.

The SCA Scanner and the [OSV Vulnerability Scanner](OSV-SCANNER.md) share one engine (`src/osv/engine.ts`), so they always agree on the dependency inventory and on which advisories apply. The SCA Scanner adds exploitation data, CVSS from NVD, dependency health, project selection, BOM-aware remediation with edit previews, and CSV export.

## Use

- **Open it.** Use **🛡️ DevSnip Pro: SCA Scanner** from the Command Palette, or *SCA Scanner* in the Security section of the Tools sidebar. **🛡️ DevSnip Pro: Scan Dependencies (SCA…)** opens it and scans straight away.
- **Projects.** The scanner lists the projects it finds:
  - a Maven reactor (the root POM and its `<modules>`);
  - a Gradle build (`settings.gradle` and its projects);
  - an npm, Yarn, pnpm or Bun workspace (the folder of its lockfile);
  - any other project folder.

  Each project shows its ecosystems and, when one is used, the Spring Boot version. Tick the ones to scan, or leave them all ticked. Parent POMs outside the selection are still read as context.
- **Scan Dependencies.** Progress is shown step by step. **Cancel** stops network requests and Maven or Gradle at once, and shows what was finished, marked *cancelled*.
- **Cards.** Critical, High, Medium, Low, Informational and **Known exploited**. Below them are the totals: dependencies, vulnerable dependencies, direct and transitive. Clicking a card or total filters the list.
- **Vulnerabilities tab.**
  - **Filters:** severity, ecosystem, direct/transitive, classification (confirmed / potential / informational), exploited only, production or development, and project.
  - **Search:** by package, CVE, GHSA or text. Press <kbd>/</kbd> to jump to it.
  - **Sort and group:** sort by exploitation then severity, CVSS, package, newest or ecosystem. Group by severity, package or ecosystem.
  - **Expanding a finding** shows:
    - the affected and fixed versions;
    - the classification and severity source;
    - the CVSS vector;
    - what controls the version;
    - clickable CVE, GHSA, OSV and CWE links;
    - the manifest it is declared in, which opens at the line when the parser knows the line;
    - every dependency path;
    - the advisory text and references.
- **Remediation tab.** One card per vulnerable dependency:
  - the target version, and whether OSV confirms that version is clean;
  - what decides the version;
  - one or more options, each with a breaking-change risk (low / medium / high / check).

  Options with a manifest edit have **Preview Change**, which opens a diff, and **Apply…**, which confirms first. Options with package-manager commands have **Copy** and **Run…**, which also confirms first.
- **Dependency health tab.** Deprecated, yanked, abandoned and inactive packages are *maintenance risks*; outdated packages are *informational*. Neither is a vulnerability.
- **Dependencies tab.** Every dependency with its version, ecosystem, relation and status, including the ones that could not be checked and why.
- **Sources & notes tab.**
  - each advisory source's status (OK, partial, stale, unavailable, off) and what it did;
  - how Maven and Gradle projects were resolved;
  - the scan's limitations and errors;
  - every file scanned.
- **Export.** **JSON** is the full result. **CSV** has one row per vulnerability and one per health finding. Cells that start with `=`, `+`, `-` or `@` are prefixed so spreadsheets do not run them.

The page is keyboard accessible:

- tabs use the arrow keys, <kbd>Home</kbd> and <kbd>End</kbd>;
- menus use the arrow keys and <kbd>Escape</kbd>;
- cards are toggle buttons;
- findings are native disclosure widgets.

It adapts to narrow editors.

## How results are decided

### Discovery

- **Always skipped:** installed packages and tool caches (`node_modules`, `.venv`, `venv`, `site-packages`, `.git`, `.gradle`, `.next`, `Pods`, `.dart_tool` and similar). Their manifests belong to dependencies, not to your project.
- **Skipped only when they are output:** `build`, `dist`, `out`, `target`, `vendor`, `deps`, `_build` and `.build`. They are left out only when they belong to the project beside them:

  | Folder | Left out beside |
  |---|---|
  | `vendor` | `composer.json`, `go.mod`, `Gemfile` |
  | `target` | `pom.xml`, `Cargo.toml` |
  | `build` | `build.gradle`, `package.json` |
  | `deps` | `mix.exs` |

  A real project kept in a folder that only happens to have one of these names (`tools/build/requirements.txt`, `node/deps/shared/package.json`) is scanned. The number of files left out is shown in the diagnostics.
- **Unsupported formats are reported, never ignored.** These dependency files are recognised but cannot be read:

  | Format | Files |
  |---|---|
  | sbt | `build.sbt` |
  | Deno | `deno.json`, `deno.lock` |
  | CocoaPods | `Podfile`, `Podfile.lock` |
  | Carthage | `Cartfile` |
  | Conan | `conanfile.txt`, `conan.lock` |
  | vcpkg | `vcpkg.json` |
  | Haskell Stack / Cabal | `stack.yaml`, `*.cabal` |
  | Crystal shards | `shard.yml` |
  | Erlang rebar3 | `rebar.config` |
  | Julia | `Manifest.toml` |
  | Elm | `elm.json` |
  | Clojure | `project.clj`, `deps.edn` |
  | Bower | `bower.json` |
  | Bazel | `MODULE.bazel`, `maven_install.json` |
  | Go dep / Glide | `Gopkg.lock`, `glide.lock` |
  | Paket | `paket.lock` |
  | Ivy | `ivy.xml` |
  | pixi | `pixi.toml` |
  | Elixir without `mix.lock` | `mix.exs` |
  | Python with no other dependency file beside it | `setup.py`, `setup.cfg` |

  They are listed under **Sources & notes** and in the OSV Scanner's Files tab, and the scan is **incomplete**: their dependencies were not checked.
- **Unreadable files are reported.** A malformed lockfile or `pom.xml` is shown with its parse error, never as "0 dependencies", and makes the scan incomplete.

### Resolution, in layers

1. **Native tooling, when allowed.**
   - **Maven:** `dependency:tree`. **Gradle:** a read-only init-script task.
   - **When it runs:** in a trusted workspace, with your consent or `devsnip.osvScanner.buildToolResolution: "always"`.
   - **Why it is first:** this is the exact tree your build uses.
2. **Lockfiles.** These cover npm, Yarn, pnpm, Bun, Poetry, Pipenv, uv, PDM, Conda, Go, Cargo, Composer, Bundler, NuGet, pub, Mix, SwiftPM and Gradle lockfiles. They are exact and include transitive dependencies.
   - **npm paths:** for `package-lock.json` v2/v3, dependency paths are rebuilt from the lockfile's own edges, the way Node resolves them (nearest `node_modules` first).
3. **The built-in Maven resolver.** It applies:
   - parent POMs and imported BOMs;
   - properties, interpolated in the child's context;
   - nearest-wins conflict resolution, exclusions and optional/scope rules;
   - version ranges, resolved through `maven-metadata.xml`;
   - relocations.

   For Gradle it is the build-script reader. It follows:
   - Spring's dependency-management plugin, `mavenBom(...)` (including `SpringBootPlugin.BOM_COORDINATES`) and `platform()`;
   - the default version catalog (`gradle/libs.versions.toml`): `libs.…` libraries and bundles, and `alias(libs.plugins.…)` plugins, including the Spring Boot version they set;
   - project properties that override BOM versions, as Spring's plugin applies them (`extra["tomcat.version"]`, `ext['tomcat.version']`, `set("…")`, `gradle.properties`).

   Maven never lets a property override an imported BOM, and the resolver keeps that difference.
4. **Manifests with exact versions.** A version range alone is reported as **Potential**, never as confirmed.

Inventory rules that prevent false results:

- **npm aliases.** `"old-lodash": "npm:lodash@4.17.4"` is checked as `lodash` 4.17.4, the package actually installed.
- **Workspace packages are never looked up in a registry.** These are npm/pnpm workspace members, linked `file:` packages, and other `package.json` names in the same workspace. A public package of the same name could otherwise produce false findings.
- **pip constraint files.** `-c constraints.txt` pins what the including requirements file installs: `flask>=1.0,<2` with `flask==1.1.1` in the constraints file is checked as 1.1.1. A pin the range does not allow is reported, not used.
- **Direct or transitive.** The project's own manifest decides which lockfile entries are direct (npm, Yarn, pnpm, Poetry, uv, Pipenv, Composer, Cargo, Bundler). Entries it does not declare are transitive.
- **Version catalogs are not counted twice.** Once the Gradle build that uses `libs.versions.toml` is resolved, the catalog's declared versions are not scanned again, because Gradle may resolve different ones.

Every resolved version is compared with the ecosystem's own rules: Maven ComparableVersion, PEP 440, SemVer, RubyGems, NuGet, Go, Debian and others. Findings are de-duplicated across aliases (CVE, GHSA, PYSEC, RUSTSEC, GO). A dependency that could not be resolved is listed as **Not analysed** with the reason, and the scan says **Scan incomplete**.

### Classification

| Class | Meaning |
|---|---|
| **Confirmed** | The resolved, exact version is inside the advisory's affected range. |
| **Potential** | Only a range is known, or the version is what the build script declares and Gradle was not run to confirm it. |
| **Informational** | Advisories that are notices rather than vulnerabilities (RustSec *unmaintained* or *unsound*). Dependency health findings are also informational. |

A package is **never** labelled vulnerable because it is outdated, deprecated or abandoned.

### Severity

- **From the advisory first.** The severity comes from OSV: GitHub's reviewed rating, or the highest CVSS 3.x base score computed from the advisory's own vector.
- **NVD only fills gaps.** When OSV publishes no severity and the advisory has a CVE id, the scanner asks NVD's CVE API 2.0. It prefers NVD's own (Primary) CVSS 3.x score, then a CNA's 3.x score, then CVSS 4.0, then CVSS 2.0. The source is named on the finding, for example *NVD, CVSS 3.1 base score 9.8 (NVD's own analysis); OSV published no severity*.
- **No score is invented.** If NVD is off, rate-limited or has no score, the severity stays **Unknown**.

### Known exploitation

The CISA KEV catalog (about 1,800 CVEs) is downloaded once a day and matched **locally** against each finding's CVE ids. Exploited findings sort first and carry:

- CISA's vulnerability name;
- the date the CVE was added to the catalog;
- CISA's required action;
- whether it has been used in ransomware.

If the catalog cannot be downloaded, the last good copy is used and marked **stale**. With no copy, the provider is **unavailable**, the result is **incomplete**, and no finding is marked exploited.

### Advisory sources

| Source | Used for | Notes |
|---|---|---|
| [OSV.dev](https://osv.dev) | Which advisories affect each version; affected and fixed ranges; references | Includes the GitHub Advisory Database (GHSA), PyPA, Go, RustSec, RubyGems and others. GHSA data reaches the scan through OSV, so no GitHub token is needed. |
| [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | Known exploitation | Matched locally. |
| [NVD](https://nvd.nist.gov/developers/vulnerabilities) | CVSS where OSV has none | Optional free API key. |
| Package registries | Latest release, deprecation, yanks, abandonment | npm, PyPI, Maven Central, NuGet, crates.io, RubyGems, Packagist, Go module proxy, pub.dev, Hex. |

Providers are separate modules (`src/sca/providers/`) behind small interfaces, injected into the analysis. Adding a source means one module and one line in `src/sca/host.ts`.

## Spring Boot remediation

For Maven and Gradle the scanner records where each managed version comes from (`ManagedOrigin` in `src/osv/types.ts`).

| What sets the version | Options offered (safest first) |
|---|---|
| **Boot's parent, through a property** (`spring-boot-starter-parent` → `spring-boot-dependencies`, e.g. `tomcat.version`) | 1. **Upgrade Spring Boot** to the lowest release whose BOM manages fixed versions of *every* vulnerable artifact it controls (edit: `<parent><version>`). 2. **Override the property** (`<tomcat.version>`) in the POM that declares the parent. |
| **A BOM imported by Boot's BOM** (`spring-framework-bom` via `${spring-framework.version}`, `jackson-bom` …) | 1. Upgrade Spring Boot. 2. **Override the BOM's property** with the lowest BOM release that fixes it (e.g. `<spring-framework.version>5.3.19</spring-framework.version>`). The whole family moves together, and no lone pin splits Spring Framework or Jackson versions. |
| **A BOM you import** in `<dependencyManagement>` | 1. **Upgrade that BOM import** (edits its version or the property it reads). 2. **Pin the artifact** in your own `<dependencyManagement>`, since explicit entries win over imports. |
| **Your own `<dependencyManagement>`** | Change the managed version, or the property it reads, in that POM. |
| **Gradle with the Boot plugin** | 1. Upgrade the `org.springframework.boot` plugin. 2. `ext['tomcat.version'] = '…'` (Kotlin: `extra["…"]`), which Spring's dependency-management plugin honours. |
| **A direct dependency with its own version** | Change that version (`<version>`, the property it reads, or the Gradle coordinate). |

**The BOM search.** It reads the BOM's published versions from `maven-metadata.xml`, ignoring milestones, release candidates and snapshots. For each candidate it loads the real BOM, including the BOMs it imports in turn, and reads what it manages. The order of search is:

1. patch releases of your current line (risk **low**);
2. later minor lines (**medium**);
3. a new major version (**high**).

Moving from Spring Boot 2 to 3 is flagged as a migration: Java 17, and `javax.*` → `jakarta.*`. The search loads at most 14 BOM versions and binary-searches within a line. If no release fixes everything, it says so and the property or pin options remain.

**Other ecosystems:**

- **A direct dependency** gets a version edit in `package.json`, `requirements*.txt`, `*.csproj`, `composer.json` or `Cargo.toml`.
- **A transitive npm dependency** gets an override: npm `overrides`, Yarn `resolutions` or `pnpm.overrides`. The package that brings it in is named.
- **A transitive dependency nothing manages** is explained through its path.
- **Package-manager commands** are always offered, for example `npm install lodash@4.17.21`.

### Edits are previewed and confirmed

- **Every edit is minimal.** It is computed from the file's current text at preview or apply time, and touches one version, property or entry, keeping the file's indentation and range operators (`^`, `~`, `>=`).
- **It refuses rather than guesses.** An edit stops with a reason instead of guessing, for example when the version comes from a property defined elsewhere, the dependency is from git or a path, or a `PackageReference` has its version in `Directory.Packages.props`.
- **It only applies when proposed.** An edit applies only if the current result proposed it, so a webview message cannot invent one.
- **Preview** opens VS Code's diff editor.
- **Apply** asks in a modal dialog. It then changes and saves only that file, and you can undo in the editor. It is disabled in untrusted workspaces.
- **Lockfiles are never edited.** Your package manager regenerates them.
- **Nothing is installed or built.** A suggested command runs in a terminal only after its own confirmation.

## Settings

| Setting | Default | |
|---|---|---|
| `devsnip.sca.healthChecks` | `direct` | Registry health for `direct` dependencies, `all` dependencies, or `off`. |
| `devsnip.sca.knownExploited` | `true` | Match findings against CISA KEV. |
| `devsnip.sca.nvdEnrichment` | `true` | Ask NVD for CVSS where OSV has no severity. |
| `devsnip.sca.bomUpgradeSearch` | `true` | Search parent/BOM releases for a fixing version. |
| `devsnip.osvScanner.buildToolResolution` | `ask` | Shared with the OSV Scanner: run Maven/Gradle (`ask`, `always`, `never`). |
| `devsnip.osvScanner.downloadPoms` | `true` | Shared: let the built-in resolver and the BOM search read POMs from Maven Central. |
| `devsnip.osvScanner.buildToolTimeoutSeconds` | `300` | Shared: time limit for one Maven or Gradle run. |

**NVD API key (optional).** ⋯ → *Add a free NVD API key*. Without a key NVD allows 5 requests per 30 seconds, so a scan makes at most 12 NVD lookups, 6.5 s apart. With a key the limit is 50 per 30 seconds, and a scan makes up to 60 lookups, 0.7 s apart. The key is kept in VS Code's secret storage and sent only to NVD, in the `apiKey` header. No paid key is needed for anything.

## Privacy, network use and limits

- **What is sent, and where.**

  | Destination | What it receives |
  |---|---|
  | OSV.dev | Ecosystem, package name and version, exactly as in the [OSV Scanner](OSV-SCANNER.md#privacy-and-network-use). |
  | Package registries | The package name. For Go, the module path and the latest version's `.mod` file are requested. |
  | NVD | A CVE id. |
  | CISA | Nothing about your project: the public catalog is downloaded. |
  | Maven Central | POM and `maven-metadata.xml` requests by coordinates, as for the built-in resolver. |

  Every request carries a `User-Agent` naming DevSnip Pro.
- **What is never sent.** Source code, file contents, paths, project names, credentials and environment files. An integration test checks request bodies for manifest content.
- **Caches** are in VS Code's global storage:

  | Data | Kept for |
  |---|---|
  | KEV catalog | 1 day |
  | NVD answers, including "no score" | 7 days, up to 5,000 |
  | Registry answers | 6 hours, up to 20,000 |
  | OSV records and POMs | Shared with the OSV Scanner |

  ⋯ → *Clear all caches* removes them all.
- **Rate limits and failures.**
  - **Registries.** Registry checks run 8 at a time. A 404 means a private package: nothing is reported. Other failures are summed up per host, for example "3 packages could not be checked (pypi.org: HTTP 502)".
  - **NVD.** After a rate-limit answer (HTTP 403 or 429) NVD is not asked again in that scan.
  - **Requests.** Every request has a timeout and up to 3 attempts with backoff on network errors and 5xx.
- **Partial results.** Each provider reports `ok`, `partial`, `stale`, `unavailable`, `skipped` or `off`.
  - **When the result is incomplete:** if the dependency inventory or OSV is incomplete, or a provider you rely on is unavailable.
  - **Settings never degrade it.** A provider turned off by a setting does not make the result incomplete.
- **Large repositories.**
  - **What is skipped:** installed packages and caches, and the build output or vendored dependencies of a project (see [Discovery](#discovery)).
  - **Limits:** up to 5,000 dependency files, and registry checks for up to 1,500 dependencies per scan.
  - **The page stays responsive:** it renders long lists in chunks.

## Limitations

- **Gradle without Gradle.** Without running Gradle, versions come from the build scripts (*Potential* where Gradle could change them). Convention plugins, custom catalogs other than `libs`, and dependencies added by code cannot be read this way and are listed as not read. Allow the build tool for exact results. On a Kotlin-script Spring Boot 3.4 build with a version catalog, the reader matched 76 of real Gradle's 78 dependencies; the two not listed were BOM-only POMs.
- **Paths are recorded for:** Maven, Gradle and `package-lock.json` v2/v3 dependencies.
  - **Not recorded:** Yarn, pnpm and other lockfiles show the relation (direct or transitive) without the path.
  - **Relation unknown:** only when a lockfile has no manifest of its own beside it (Yarn 1 and Cargo lockfiles do not record which dependencies are direct).
- **Go:** the modules in `go.mod` are checked: every module the build and its tests compile. Modules that appear only in dependencies' own test graphs (`go list -m all`) are not built and are not checked. Use `govulncheck` for call-graph-aware Go results.
- **Lockfile entries for other platforms** (Windows-only or Python-version-only packages in `poetry.lock`, `uv.lock` or `Pipfile.lock`) are scanned too, because the lockfile can install them.
- **`go.sum` is not used for versions.** It lists every module version ever considered, not the ones built. `go.mod` (with its `// indirect` requirements) is used instead.
- **Health checks** cover direct dependencies by default. Registries without a public API (SwiftPM URLs, CRAN, Conda channels) are not checked and are counted as unsupported.
- **The BOM search** reads Maven Central (or your local `~/.m2`). BOMs only in a private repository are reported as not searchable, and the property or pin options remain.
- **Verified fixes.** A fixed version is verified against OSV for the package itself. Whether an upgrade breaks your code cannot be known; the risk level and notes say what kind of upgrade it is.

## Report format

`ScaResult` (`src/sca/types.ts`), `schemaVersion: 1`:

| Field | Contents |
|---|---|
| `status` | `complete`, `incomplete` or `cancelled` |
| `projects` | The scanned projects: directory, name, ecosystems, managers, files, Spring Boot version, module count |
| `scan` | The shared engine's full `ScanResult`: files, packages with occurrences and paths, findings, remediations, diagnostics. See [OSV Scanner → Report format](OSV-SCANNER.md#report-format). |
| `vulnerabilities[]` | `class`, `cves`, `ghsas`, `severity`, `severitySource`, `cvssScore`, `cvssVector`, `nvd`, `kev`, `relation`, `paths`, `locations` (real files and lines only), `projects`, `managedBy`, `devOnly`, and the underlying `finding` |
| `health[]` | `kind` (deprecated, yanked, abandoned, inactive, outdated), `class` (risk or informational), `installedVersion`, `latest`, `level`, `message`, `page` |
| `advice[]` | Per vulnerable package: `target`, `targetVerified`, `controlledBy`, `options[]` (`title`, `detail`, `risk`, `edit`, `editSummary`, `commands`), `notes` |
| `providers[]` | `id`, `name`, `status`, `message` |
| `summary` | Severity counts, `informational`, `exploited`, `dependencies`, `vulnerableDependencies`, `direct`, `transitive`, `unknownRelation`, `unresolved`, `failed`, `outdated`, `maintenanceRisks` |
| `limitations[]` | What the scan could not cover |
| `diagnostics` | `status`, `incompleteReasons[]`, `projects[]`, `files` (scanned, failed, unsupported, left out as build output), `dependencies` (discovered, with an exact version, range only, unresolved, out of scope, failed, direct, transitive, relation unknown), `buildTools[]`, `advisories` (packages checked, references, unique, aliases merged, withdrawn, out of range, findings, records failed), `errors[]`, `timings` (ms per stage: discover, resolve, parse, inventory, query, records, verify, kev, nvd, registries, remediation, total) |

`scan.incompleteReasons[]` and `scan.unsupportedFiles[]` are in the shared engine's result too, so the OSV Scanner reports them the same way.

### Diagnostics

Every scan writes a one-line summary to the **DevSnip Pro: OSV Scanner** output channel (status and reasons, projects, file counts, dependency and relation counts, advisories, timings). **Sources & notes → Scan diagnostics** shows the same facts. They contain paths, counts and error messages only: no file contents, credentials or environment variables.

## Code layout

| File | Role |
|---|---|
| `src/osv/engine.ts` | The shared engine host: cache, log, Maven/Gradle strategies behind the consent gate, `runScan`. Used by both scanners. |
| `src/osv/discovery-rules.ts` | Which folders are skipped, which output folders belong to a project, and the unsupported formats (pure, unit-tested). |
| `src/osv/gradle/builtin.ts` | The Gradle build-script reader, including version catalogs and BOM property overrides. |
| `src/osv/maven/resolver.ts` | Records `ManagedOrigin` for every managed version (workspace, parent, import, with `importedBy`, `directBom`, `directBomProperty`). |
| `src/osv/parsers.ts` | Lockfile adapters. npm v2/v3 now records dependency paths. |
| `src/sca/engine.ts` | Pure analysis: KEV, NVD, health, classification, summary, remediation advice and BOM-search scheduling. |
| `src/sca/providers/kev.ts`, `nvd.ts`, `registry.ts` | Advisory and registry providers: parsing, caching, rate limits. |
| `src/sca/bom.ts` | Lowest fixing BOM release, by loading real BOMs. |
| `src/sca/edits.ts` | Minimal, formatting-preserving manifest edits that refuse with a reason. |
| `src/sca/projects.ts` | Project detection, Spring Boot version, project selection. |
| `src/sca/report.ts` | JSON and CSV export. |
| `src/sca/host.ts` | HTTP, caches, settings and the secret NVD key for the extension host. |
| `src/sca/panel.ts`, `page.ts`, `command.ts` | The webview panel, its HTML shell and the commands. |
| `media/sca-model.js` | Pure filter, sort and group functions (UMD, unit-tested). |
| `media/sca-scanner.js` | The UI: DOM nodes and `textContent` only. |

## Testing

```bash
npm run compile && node out/test/unit/run-unit-tests.js
```

`src/test/unit/sca.unit.ts` covers:

- KEV parsing, caching and offline fallback;
- NVD score ranking, rate-limit spacing, caps, caching and stopping on 403/429;
- every registry format and the health batch (private packages, per-host errors, NuGet external pages, Go deprecation);
- all 14 edit operations and their refusals;
- the BOM search (patch, minor and major lines; milestones skipped; budget; offline);
- project detection and selection;
- npm dependency paths;
- the full Spring Boot analysis against a mocked OSV, KEV, NVD, registries and Maven repository: findings preserved, KEV and NVD enrichment, health separation, BOM-aware advice whose edits all apply, and incomplete or cancelled results;
- the webview model's filters, sorting and grouping;
- the CSV and its formula escaping;
- the page's CSP.

`src/test/unit/sca-audit.unit.ts` has a regression test for each defect found by scanning a polyglot monorepo:

- output folders, unsupported formats and malformed POMs;
- npm aliases, workspace packages and hoisted transitives;
- relations for Yarn, Poetry, Composer and Cargo;
- pip constraints;
- version catalog de-duplication;
- the Gradle reader's catalogs, plugin aliases, `BOM_COORDINATES` and property overrides (and Maven's opposite rule);
- Cargo workspace grouping;
- concurrent providers and diagnostics.

### Verified against package managers

The inventory was compared with each package manager's own resolution on real projects (2026-10-23). The vulnerability findings were compared with direct OSV queries for every package found, and none were missing or extra.

| Ecosystem | Package manager's own list | Result |
|---|---|---|
| Maven (Spring Boot 2.7 reactor, profiles, BOM import, exclusions) | `mvn dependency:tree` | 114 / 114, with the build tool and with the built-in resolver |
| Gradle (Kotlin DSL, Boot 3.4, version catalog) | `gradle dependencies` (Gradle 9.1) | 78 / 78 with Gradle; 76 / 78 without it (the two left out are BOM-only POMs) |
| npm workspaces (alias, `file:` package) | `npm ls --all` | 78 / 78 (the alias reported as the real package) |
| pnpm workspaces (alias, `workspace:`) | `pnpm list -r --depth Infinity` | 57 / 57 |
| Yarn 1 | `yarn.lock` from `yarn install` | all entries |
| Poetry 2 | `poetry show` | 13 / 13, plus 3 Windows- or Python-version-only entries in `poetry.lock`, which are also scanned |
| uv | `uv export --all-groups` | 18 / 18 |
| Pipenv | `pipenv requirements --dev` | 15 / 15 |
| NuGet (lockfile, central package versions, `project.assets.json`) | `dotnet list package --include-transitive` | 74 / 74 and 71 / 71; NuGet's own audit (`--vulnerable`) found 10 advisories, all reported |
| Bundler | `Gemfile.lock` from `bundle lock` | all entries |
| Go modules (`replace`, indirect requirements) | `go list -deps -test` | all 13 built modules. `go list -m all` also lists 9 test-only modules of dependencies that are not built and are not in `go.mod`; none has an advisory. |
| Cargo workspace | `cargo metadata` | 30 / 30 |

Composer was checked only against a lockfile written in Composer's format; PHP was not available to run Composer itself.

`src/test/sca.test.ts` runs inside VS Code against a fake network. It covers:

- the commands and the dashboard;
- a Spring Boot-style reactor resolved from a fake Maven Central, with KEV, NVD and health;
- the BOM upgrade and property-override edits;
- the diff preview;
- the confirmation gate, so nothing is written without it;
- discovery through VS Code's file search (vendored output skipped, a project in `deps/` scanned, `build.sbt` reported);
- project selection;
- cancellation;
- offline results;
- the privacy checks on request bodies.
