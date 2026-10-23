"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const run_unit_tests_1 = require("./run-unit-tests");
const discovery_rules_1 = require("../../osv/discovery-rules");
const builtin_1 = require("../../osv/gradle/builtin");
const index_1 = require("../../osv/gradle/index");
const resolver_1 = require("../../osv/maven/resolver");
const index_2 = require("../../osv/maven/index");
const parsers_1 = require("../../osv/parsers");
const scan_1 = require("../../osv/scan");
const engine_1 = require("../../sca/engine");
const projects_1 = require("../../sca/projects");
const osv_maven_unit_1 = require("./osv-maven.unit");
/**
 * Regression tests for the defects found by scanning a polyglot monorepo
 * (Spring Boot Maven and Gradle, npm/Yarn/pnpm workspaces, pip/Poetry/uv/
 * Pipenv, NuGet, Composer, Bundler, Go, Cargo, unsupported and malformed
 * files) and comparing with each package manager's own tree and with OSV.
 */
const npmAdvisory = (id, name, introduced, fixed, versions) => ({
    record: { id, modified: "1", summary: `${name} issue`, database_specific: { severity: "HIGH" }, affected: [{ package: { name, ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced }, { fixed }] }] }] },
    hits: [{ name, versions }]
});
const pypiAdvisory = (id, name, versions) => ({
    record: { id, modified: "1", summary: `${name} issue`, database_specific: { severity: "HIGH" }, affected: [{ package: { name, ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "99" }] }] }] },
    hits: [{ name, versions }]
});
async function scan(files, advisories = [], extra = {}) {
    const { repository } = (0, osv_maven_unit_1.fixtureRepository)();
    return (0, scan_1.runScan)(files, (0, osv_maven_unit_1.scanOptions)((0, osv_maven_unit_1.fakeOsv)(advisories).fetch, { repository, repositoryLabel: "fixture" }, extra));
}
(0, run_unit_tests_1.suite)("sca audit: discovery", () => {
    const has = (files) => async (p) => files.includes(p);
    (0, run_unit_tests_1.test)("output and vendor folders are skipped only when they belong to the project beside them", async () => {
        const present = ["php/shop/composer.json", "api/pom.xml", "web/package.json", "go/svc/go.mod", "lib/mix.exs"];
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("php/shop/vendor/guzzle/guzzle/composer.json", has(present)), "php/shop/vendor");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("api/target/classes/META-INF/pom.xml", has(present)), "api/target");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("web/dist/package.json", has(present)), "web/dist");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("go/svc/vendor/golang.org/x/text/go.mod", has(present)), "go/svc/vendor");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("lib/deps/plug/mix.lock", has(present)), "lib/deps");
        // Real projects in folders that only happen to have these names.
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("node/deps/shared/package.json", has([...present, "node/package.json"])), undefined, "deps beside a package.json is not Elixir's deps folder");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("tools/build/requirements.txt", has(present)), undefined, "a build folder with no project beside it");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("build/package.json", has(present)), undefined, "a top-level build folder");
        assert.strictEqual(await (0, discovery_rules_1.generatedFolderOf)("web/src/package.json", has(present)), undefined);
    });
    (0, run_unit_tests_1.test)("recognised but unsupported formats are named; covered ones are not", () => {
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("scala/build.sbt", ["build.sbt"]), "sbt (Scala)");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("ios/Podfile.lock", []), "CocoaPods");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("hs/app.cabal", []), "Haskell (Stack / Cabal)");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("cpp/vcpkg.json", []), "vcpkg (C/C++)");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("py/setup.py", ["setup.py"]), "Python setup.py / setup.cfg (install_requires is not read)");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("py/setup.py", ["setup.py", "requirements.txt"]), undefined, "a requirements file beside it is scanned instead");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("ex/mix.exs", ["mix.exs", "mix.lock"]), undefined, "mix.lock is supported");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("ex/mix.exs", ["mix.exs"]), "Elixir mix.exs without mix.lock");
        assert.strictEqual((0, discovery_rules_1.unsupportedFormatOf)("web/package.json", []), undefined);
    });
    (0, run_unit_tests_1.test)("unsupported files make the scan incomplete, with the reason and the files named", async () => {
        const result = await scan([{ path: "app/requirements.txt", text: "requests==2.31.0\n" }], [], {
            unsupported: [{ path: "scala/build.sbt", format: "sbt (Scala)" }, { path: "ios/Podfile.lock", format: "CocoaPods" }]
        });
        assert.strictEqual(result.status, "incomplete");
        assert.deepStrictEqual(result.incompleteReasons, ["2 dependency files are in an unsupported format"]);
        assert.deepStrictEqual(result.unsupportedFiles?.map(u => u.path), ["scala/build.sbt", "ios/Podfile.lock"]);
        assert.strictEqual(result.diagnostics.filesUnsupported, 2);
        assert.ok(result.limitations.some(l => /sbt \(Scala\), CocoaPods/.test(l)));
        const clean = await scan([{ path: "app/requirements.txt", text: "requests==2.31.0\n" }]);
        assert.deepStrictEqual([clean.status, clean.incompleteReasons], ["complete", []]);
        assert.ok(clean.diagnostics.timings && "query" in clean.diagnostics.timings, "stage timings are recorded");
    });
});
(0, run_unit_tests_1.suite)("sca audit: parsing and inventory", () => {
    (0, run_unit_tests_1.test)("a malformed pom.xml is reported unreadable (with or without Maven resolution), never as 0 dependencies", async () => {
        const broken = "<project><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>broken</artifactId><version>1</version><dependencies><dependency>";
        assert.match((0, parsers_1.parseDependencyFile)("broken/pom.xml", broken).error, /Not a readable POM: .*never closed/);
        assert.ok(!(0, parsers_1.parseDependencyFile)("svc/pom.xml", "<project><parent><groupId>g</groupId><artifactId>p</artifactId><version>1</version></parent><dependencies/></project>").error, "a module POM without its own artifactId is still read");
        const { repository } = (0, osv_maven_unit_1.fixtureRepository)();
        const outcome = await (0, index_2.resolveMavenProjects)([{ path: "broken/pom.xml", text: broken }], { repository, repositoryLabel: "fixture" });
        assert.match(outcome.files.get("broken/pom.xml").error, /Not a readable POM/);
        const result = await scan([{ path: "broken/pom.xml", text: broken }], [], { resolveMaven: (poms, signal) => (0, index_2.resolveMavenProjects)(poms, { repository, repositoryLabel: "fixture" }, { signal }) });
        assert.strictEqual(result.status, "incomplete");
        assert.match(result.incompleteReasons[0], /1 dependency file could not be read \(broken\/pom\.xml\)/);
        assert.ok(!result.limitations.some(l => /read for declared dependencies only/.test(l)), "not described as a resolution fallback");
    });
    (0, run_unit_tests_1.test)("npm workspaces: aliases resolve to the real package, workspace packages are never sent to OSV, hoisted transitives are transitive", async () => {
        const lock = {
            name: "mono", lockfileVersion: 3,
            packages: {
                "": { workspaces: ["packages/*"], devDependencies: { minimist: "0.0.8" } },
                "packages/api": { name: "@mono/api", dependencies: { express: "4.17.1", "old-lodash": "npm:lodash@4.17.4", "@mono/ui": "1.0.0" } },
                "packages/ui": { name: "@mono/ui", version: "1.0.0" },
                "node_modules/@mono/api": { resolved: "packages/api", link: true },
                "node_modules/@mono/ui": { resolved: "packages/ui", link: true },
                "node_modules/express": { version: "4.17.1", dependencies: { qs: "6.7.0" } },
                "node_modules/qs": { version: "6.7.0" },
                "node_modules/old-lodash": { name: "lodash", version: "4.17.4" },
                "node_modules/minimist": { version: "0.0.8", dev: true }
            }
        };
        const files = [
            { path: "package.json", text: JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"], devDependencies: { minimist: "0.0.8" } }) },
            { path: "package-lock.json", text: JSON.stringify(lock, null, 2) },
            { path: "packages/api/package.json", text: JSON.stringify({ name: "@mono/api", dependencies: { express: "4.17.1", "old-lodash": "npm:lodash@4.17.4", "@mono/ui": "1.0.0" } }) },
            { path: "packages/ui/package.json", text: JSON.stringify({ name: "@mono/ui", version: "1.0.0" }) }
        ];
        const uiAdvisory = npmAdvisory("GHSA-conf-used-0001", "@mono/ui", "0", "2.0.0", ["1.0.0"]);
        const result = await scan(files, [npmAdvisory("GHSA-lod4-0000-0001", "lodash", "0", "4.17.21", ["4.17.4"]), uiAdvisory]);
        const keys = result.packages.map(p => p.key).sort();
        assert.deepStrictEqual(keys, ["npm|express|4.17.1", "npm|lodash|4.17.4", "npm|minimist|0.0.8", "npm|qs|6.7.0"], "no 'old-lodash' and no workspace package");
        assert.ok(!result.findings.some(f => f.id === "GHSA-conf-used-0001"), "a public package's advisory is never matched to a workspace package of the same name");
        const by = Object.fromEntries(result.packages.map(p => [p.name, p]));
        assert.deepStrictEqual([by.lodash.direct, by.express.direct, by.qs.direct, by.minimist.direct], [true, true, false, true]);
        assert.deepStrictEqual(by.qs.occurrences[0].via, ["express@4.17.1"]);
        assert.ok(result.findings.some(f => f.packageName === "lodash" && f.installedVersion === "4.17.4"));
    });
    (0, run_unit_tests_1.test)("an npm alias without a lockfile is checked as the real package and version", () => {
        const parsed = (0, parsers_1.parseDependencyFile)("web/package.json", JSON.stringify({ dependencies: { "lodash-old": "npm:lodash@4.17.10", scoped: "npm:@babel/traverse@^7.22.0", git: "github:user/repo" } }));
        const d = Object.fromEntries(parsed.dependencies.map(x => [x.name, x]));
        assert.deepStrictEqual([d.lodash?.version, d.lodash?.resolution], ["4.17.10", "pinned"]);
        assert.deepStrictEqual([d["@babel/traverse"]?.spec, d["@babel/traverse"]?.resolution], ["^7.22.0", "range"]);
        assert.strictEqual(d["github"]?.registry ?? d["git"]?.registry, false, "other non-registry specs stay out of OSV");
        assert.strictEqual(parsed.selfName, undefined);
    });
    (0, run_unit_tests_1.test)("lockfile entries the project's own manifest does not declare are transitive (Yarn 1, Poetry, Composer, Cargo)", async () => {
        const yarn = `# yarn lockfile v1\n\nhandlebars@4.0.11:\n  version "4.0.11"\n  dependencies:\n    optimist "^0.6.1"\n\noptimist@^0.6.1:\n  version "0.6.1"\n\n"lodash-old@npm:lodash@4.17.10":\n  version "4.17.10"\n`;
        const poetry = `[[package]]\nname = "django"\nversion = "3.2.0"\noptional = false\npython-versions = ">=3.6"\ngroups = ["main"]\nfiles = []\n\n[[package]]\nname = "sqlparse"\nversion = "0.4.1"\noptional = false\npython-versions = ">=3.5"\ngroups = ["main"]\nfiles = []\n\n[metadata]\nlock-version = "2.1"\npython-versions = "^3.9"\ncontent-hash = "0"\n`;
        const composerLock = JSON.stringify({ packages: [{ name: "guzzlehttp/guzzle", version: "7.4.0" }, { name: "guzzlehttp/psr7", version: "2.1.0" }], "packages-dev": [] });
        const cargoLock = `version = 3\n\n[[package]]\nname = "core-lib"\nversion = "0.1.0"\ndependencies = ["time"]\n\n[[package]]\nname = "time"\nversion = "0.1.43"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\ndependencies = ["libc"]\n\n[[package]]\nname = "libc"\nversion = "0.2.98"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
        const result = await scan([
            { path: "y/package.json", text: JSON.stringify({ dependencies: { handlebars: "4.0.11", "lodash-old": "npm:lodash@4.17.10" } }) },
            { path: "y/yarn.lock", text: yarn },
            { path: "p/pyproject.toml", text: `[tool.poetry]\nname = "p"\n[tool.poetry.dependencies]\npython = "^3.9"\ndjango = "3.2.0"\n` },
            { path: "p/poetry.lock", text: poetry },
            { path: "c/composer.json", text: JSON.stringify({ require: { "guzzlehttp/guzzle": "7.4.0" } }) },
            { path: "c/composer.lock", text: composerLock },
            { path: "r/Cargo.toml", text: `[workspace]\nmembers = ["crates/core"]\n` },
            { path: "r/crates/core/Cargo.toml", text: `[package]\nname = "core-lib"\nversion = "0.1.0"\n[dependencies]\ntime = "0.1.43"\n` },
            { path: "r/Cargo.lock", text: cargoLock }
        ]);
        const relation = Object.fromEntries(result.packages.map(p => [`${p.name}@${p.version}`, p.direct]));
        assert.deepStrictEqual(relation, {
            "handlebars@4.0.11": true, "optimist@0.6.1": false, "lodash@4.17.10": true,
            "django@3.2.0": true, "sqlparse@0.4.1": false,
            "guzzlehttp/guzzle@7.4.0": true, "guzzlehttp/psr7@2.1.0": false,
            "time@0.1.43": true, "libc@0.2.98": false
        });
        assert.strictEqual(result.packages.filter(p => p.direct === undefined).length, 0);
    });
    (0, run_unit_tests_1.test)("a Cargo workspace crate used through a path dependency is local code, not an out-of-scope dependency", async () => {
        const result = await scan([
            { path: "ws/Cargo.toml", text: `[workspace]\nmembers = ["crates/core", "crates/cli"]\n` },
            { path: "ws/crates/core/Cargo.toml", text: `[package]\nname = "core-lib"\nversion = "0.1.0"\n[dependencies]\nsmallvec = "=1.6.0"\n` },
            { path: "ws/crates/cli/Cargo.toml", text: `[package]\nname = "cli"\nversion = "0.1.0"\n[dependencies]\ncore-lib = { path = "../core" }\n` },
            { path: "ws/Cargo.lock", text: `version = 3\n\n[[package]]\nname = "cli"\nversion = "0.1.0"\ndependencies = ["core-lib"]\n\n[[package]]\nname = "core-lib"\nversion = "0.1.0"\ndependencies = ["smallvec"]\n\n[[package]]\nname = "smallvec"\nversion = "1.6.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n` }
        ]);
        assert.deepStrictEqual(result.packages.map(p => `${p.key}:${p.direct}`), ["crates.io|smallvec|1.6.0:true"]);
        assert.strictEqual(result.summary.outOfScopePackages ?? 0, 0);
    });
    (0, run_unit_tests_1.test)("pip -c constraint files pin the versions a requirements file installs", async () => {
        const files = [
            { path: "app/requirements.txt", text: "-c constraints.txt\n-c missing.txt\nflask>=1.0,<2\njinja2<3\nrequests\n" },
            { path: "app/constraints.txt", text: "flask==1.1.1\njinja2==3.1.0  # outside the range\nrequests==2.25.0\n", context: true, hint: "requirements" }
        ];
        const result = await scan(files, [pypiAdvisory("PYSEC-flask-1", "flask", ["1.1.1"]), pypiAdvisory("PYSEC-req-1", "requests", ["2.25.0"])]);
        const by = Object.fromEntries(result.packages.map(p => [p.name, p]));
        assert.deepStrictEqual([by.flask.version, by.flask.resolution, by.flask.status], ["1.1.1", "pinned", "vulnerable"]);
        assert.match(by.flask.note, /Pinned to 1\.1\.1 by app\/constraints\.txt/);
        assert.deepStrictEqual([by.requests.version, by.requests.status], ["2.25.0", "vulnerable"]);
        assert.strictEqual(by.jinja2.version, undefined, "a pin the declared range does not allow is not used");
        const warnings = result.files.find(f => f.path === "app/requirements.txt").warnings;
        assert.ok(warnings.some(w => /jinja2: app\/constraints\.txt pins 3\.1\.0/.test(w)));
        assert.ok(warnings.some(w => /missing\.txt is not in the workspace/.test(w)));
        assert.ok(!result.files.some(f => f.path === "app/constraints.txt"), "a constraints file is context, not a list of installs");
    });
    (0, run_unit_tests_1.test)("a version catalog is not scanned separately once the Gradle build that uses it is resolved", async () => {
        const catalog = { path: "g/gradle/libs.versions.toml", text: `[libraries]\nlang = "org.apache.commons:commons-lang3:3.11"\n` };
        const alone = await scan([catalog]);
        assert.deepStrictEqual(alone.packages.map(p => p.key), ["Maven|org.apache.commons:commons-lang3|3.11"], "without a build, the catalog is all there is");
        const { repository } = (0, osv_maven_unit_1.fixtureRepository)();
        const withBuild = await scan([catalog, { path: "g/settings.gradle", text: "rootProject.name = 'g'" }, { path: "g/build.gradle", text: "dependencies { implementation libs.lang }" }], [], {
            resolveGradle: (files, signal) => (0, index_1.resolveGradleProjects)(files, { repository, repositoryLabel: "fixture", relativeDir: () => undefined }, { signal })
        });
        assert.deepStrictEqual(withBuild.packages.filter(p => p.occurrences.some(o => o.file.endsWith(".toml"))), [], "no duplicate from the declared catalog version");
    });
});
(0, run_unit_tests_1.suite)("sca audit: Gradle without Gradle", () => {
    const catalogText = `[versions]
spring-boot = "2.6.6"
lang = "3.11"

[libraries]
commons-lang = { module = "org.apache.commons:commons-lang3", version.ref = "lang" }
yaml = { group = "org.yaml", name = "snakeyaml", version = "1.33" }
h2 = "com.h2database:h2:1.4.200"
web = { module = "org.springframework.boot:spring-boot-starter-web" }

[bundles]
data = ["yaml", "h2"]

[plugins]
spring-boot = { id = "org.springframework.boot", version.ref = "spring-boot" }
dm = "io.spring.dependency-management:1.0.11.RELEASE"
`;
    (0, run_unit_tests_1.test)("version catalogs: libraries, bundles and plugins by accessor", () => {
        const catalog = (0, builtin_1.readVersionCatalog)(catalogText);
        assert.deepStrictEqual(catalog.libraries.get("commons.lang"), { group: "org.apache.commons", name: "commons-lang3", version: "3.11" });
        assert.deepStrictEqual(catalog.libraries.get("yaml"), { group: "org.yaml", name: "snakeyaml", version: "1.33" });
        assert.deepStrictEqual(catalog.libraries.get("web"), { group: "org.springframework.boot", name: "spring-boot-starter-web" });
        assert.deepStrictEqual(catalog.bundles.get("data"), ["yaml", "h2"]);
        assert.deepStrictEqual(catalog.plugins.get("spring.boot"), { id: "org.springframework.boot", version: "2.6.6" });
        assert.deepStrictEqual(catalog.plugins.get("dm"), { id: "io.spring.dependency-management", version: "1.0.11.RELEASE" });
    });
    (0, run_unit_tests_1.test)("catalog aliases, plugin aliases, SpringBootPlugin.BOM_COORDINATES and dotted ext/extra overrides are read", () => {
        const catalog = (0, builtin_1.readVersionCatalog)(catalogText);
        const root = `plugins {\n    alias(libs.plugins.spring.boot) apply false\n    alias(libs.plugins.dm) apply false\n}\n`;
        const defaults = (0, builtin_1.buildDefaults)([root], {}, catalog);
        assert.strictEqual(defaults.springBootVersion, "2.6.6", "the Boot version from the catalog plugin alias");
        const app = (0, builtin_1.readGradleBuild)(`plugins {\n    id("org.springframework.boot")\n    alias(libs.plugins.dm)\n}\nextra["tomcat.version"] = "9.0.62"\ndependencies {\n    implementation(libs.web)\n    implementation(libs.bundles.data)\n    implementation(libs.commons.lang)\n    implementation(libs.not.there)\n}\n`, {}, defaults);
        assert.deepStrictEqual(app.boms.map(b => `${b.name}:${b.version}`), ["spring-boot-dependencies:2.6.6"]);
        assert.deepStrictEqual(app.dependencies.map(d => `${d.group}:${d.name}:${d.version ?? ""}`).sort(), [
            "com.h2database:h2:1.4.200", "org.apache.commons:commons-lang3:3.11", "org.springframework.boot:spring-boot-starter-web:", "org.yaml:snakeyaml:1.33"
        ]);
        assert.deepStrictEqual(app.unreadable, ["implementation(libs.not.there)"], "an alias missing from the catalog is reported, not guessed");
        assert.strictEqual(app.properties["tomcat.version"], "9.0.62");
        assert.match((0, builtin_1.gradleBuildToPom)(app, { group: "g", name: "app" }), /<properties><tomcat\.version>9\.0\.62<\/tomcat\.version><\/properties>/);
        const lib = (0, builtin_1.readGradleBuild)(`plugins { id("io.spring.dependency-management") }\ndependencyManagement { imports { mavenBom(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES) } }\next['snakeyaml.version'] = '1.33'\n`, {}, defaults);
        assert.deepStrictEqual(lib.boms.map(b => `${b.name}:${b.version}`), ["spring-boot-dependencies:2.6.6"], "the Boot BOM without the Boot plugin");
        assert.strictEqual(lib.properties["snakeyaml.version"], "1.33");
    });
    (0, run_unit_tests_1.test)("Gradle builds override Boot's managed versions with project properties; Maven builds never do", async () => {
        const { repository } = (0, osv_maven_unit_1.fixtureRepository)();
        const files = [
            { path: "settings.gradle.kts", text: `rootProject.name = "orders"\ninclude(":app")\n` },
            { path: "gradle/libs.versions.toml", text: catalogText },
            { path: "build.gradle.kts", text: `plugins {\n    alias(libs.plugins.spring.boot) apply false\n}\n` },
            { path: "app/build.gradle.kts", text: `plugins {\n    id("org.springframework.boot")\n    id("io.spring.dependency-management")\n}\nextra["tomcat.version"] = "9.0.62"\ndependencies {\n    implementation(libs.web)\n}\n` }
        ];
        const outcome = await (0, index_1.resolveGradleProjects)(files, { repository, repositoryLabel: "fixture", relativeDir: () => undefined });
        const versions = Object.fromEntries(outcome.files.get("app/build.gradle.kts").dependencies.filter(d => d.version).map(d => [d.name, d.version]));
        assert.strictEqual(versions["org.apache.tomcat.embed:tomcat-embed-core"], "9.0.62", "extra[\"tomcat.version\"] wins over Boot's 9.0.60");
        assert.strictEqual(versions["org.springframework.boot:spring-boot-starter-web"], "2.6.6", "the starter's version from Boot's BOM, through the catalog plugin alias");
        // Maven: a property in the importing POM does not change an imported BOM.
        const maven = new resolver_1.MavenResolver([{ path: "pom.xml", text: (0, osv_maven_unit_1.pom)({ g: "x", a: "app", v: "1", props: { "tomcat.version": "9.0.62" }, managed: [{ g: osv_maven_unit_1.BOOT, a: "spring-boot-dependencies", v: "2.6.6", type: "pom", scope: "import" }], deps: [{ g: "org.apache.tomcat.embed", a: "tomcat-embed-core" }] }) }], repository);
        const resolved = await maven.resolveModule("pom.xml");
        assert.strictEqual(resolved.dependencies.find(d => d.artifactId === "tomcat-embed-core")?.version, "9.0.60");
    });
});
(0, run_unit_tests_1.suite)("sca audit: projects and analysis", () => {
    (0, run_unit_tests_1.test)("a Cargo workspace member belongs to the workspace project", () => {
        const projects = (0, projects_1.detectProjects)([
            { path: "rust/ws/Cargo.toml", text: "[workspace]\nmembers = [\"crates/core\"]\n" },
            { path: "rust/ws/Cargo.lock", text: "version = 3\n" },
            { path: "rust/ws/crates/core/Cargo.toml", text: "[package]\nname = \"core-lib\"\n" },
            { path: "rust/other/Cargo.toml", text: "[package]\nname = \"other\"\n" }
        ]);
        assert.deepStrictEqual(projects.map(p => [p.dir, p.files.length]), [["rust/other", 1], ["rust/ws", 3]]);
    });
    (0, run_unit_tests_1.test)("providers run side by side, each is timed, and the diagnostics explain an incomplete result", async () => {
        const result = await scan([{ path: "requirements.txt", text: "flask==1.1.1\n" }], [pypiAdvisory("PYSEC-flask-1", "flask", ["1.1.1"])]);
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const started = Date.now();
        const sca = await (0, engine_1.analyseScan)(result, {
            healthScope: "direct",
            kev: async () => { await wait(150); return { status: "unavailable", message: "offline" }; },
            nvd: async () => { await wait(150); return { scores: new Map(), looked: 0, fromCache: 0, skipped: [], errors: [] }; },
            health: async () => { await wait(150); return { results: new Map(), checked: 1, fromCache: 0, unsupported: 0, errors: [] }; }
        }, { projects: [], texts: new Map(), toolVersion: "t", startedAt: started, discovery: { durationMs: 12, leftOutAsBuildOutput: 3 } });
        assert.ok(Date.now() - started < 400, "three 150 ms providers in parallel, not 450 ms in a row");
        const dg = sca.diagnostics;
        assert.strictEqual(sca.status, "incomplete");
        assert.deepStrictEqual(dg.incompleteReasons, ["CISA Known Exploited Vulnerabilities was unavailable"]);
        for (const stage of ["discover", "query", "kev", "nvd", "registries", "remediation", "total"])
            assert.ok(typeof dg.timings[stage] === "number", stage);
        assert.deepStrictEqual([dg.files.leftOutAsBuildOutput, dg.dependencies.discovered, dg.dependencies.direct, dg.advisories.findings], [3, 1, 1, 1]);
        assert.deepStrictEqual(sca.providers.map(p => p.id), ["osv", "kev", "nvd", "registries"], "a stable order whatever finishes first");
        const controller = new AbortController();
        controller.abort();
        const cancelled = await (0, engine_1.analyseScan)(result, { healthScope: "direct", kev: async () => { throw new Error("must not run"); } }, { projects: [], texts: new Map(), toolVersion: "t", startedAt: Date.now(), signal: controller.signal });
        assert.deepStrictEqual(cancelled.providers.find(p => p.id === "kev"), { id: "kev", name: "CISA Known Exploited Vulnerabilities", status: "skipped", message: "Not run: the scan was cancelled." });
    });
});
//# sourceMappingURL=sca-audit.unit.js.map