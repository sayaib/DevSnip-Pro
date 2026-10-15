import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  compareMaven, comparePep440, compareSemver, isStableMaven, mavenFlavour, maxSatisfyingPep440, maxSatisfyingSemver,
  satisfiesPep440, satisfiesSemver
} from "../../services/dependency-versions";
import {
  DeclaredDependency, DetectedProject, ProjectFile, dependencyCommands, detectNodeManager, detectProjects,
  evaluateDependency, explainFailure, formatCommandLine, isRegistryNpmSpec, mavenLocalRepository, mavenMetadataUrls,
  nodeModuleManifestCandidates, npmRegistryUrl, parseGradle, parseMavenMetadata, parseNpmPackument, parsePackageJson,
  parsePipList, parsePom, parsePypiDocument, parsePyproject, parseRequirements, parseVersionCatalog, planSpawn,
  compareNuget, parseCentralPackageVersions, parseCsproj, parseNugetAssets, parseNugetIndex, parsePubLock, parsePubPackage, parsePubspec,
  projectInstallCommand, projectUpdateCommand, resolveExecutable, validateCommandSpec, withSearchPath
} from "../../services/dependency-manager";
import { directRequirements, findUnusedDependencies, importedPackages, packageOfSpecifier, pubDependencies } from "../../toolkits/engines/dev-unused-deps";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve("/work/repo");

function nodeProject(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: "p0", dir: ROOT, ecosystem: "node", manager: "npm", tool: "npm", detectedBy: "test",
    manifests: ["package.json"], dependencies: [], warnings: [], ...overrides
  };
}

function dep(overrides: Partial<DeclaredDependency>): DeclaredDependency {
  return { name: "left-pad", displayName: "left-pad", spec: "^1.0.0", scope: "production", source: "package.json", registry: true, ...overrides };
}

suite("dependency versions: npm semver", () => {
  test("caret, tilde, x-ranges, hyphens and unions follow npm's rules", () => {
    assert.ok(satisfiesSemver("1.9.9", "^1.2.3"));
    assert.ok(!satisfiesSemver("2.0.0", "^1.2.3"));
    assert.ok(!satisfiesSemver("1.2.2", "^1.2.3"));
    assert.ok(satisfiesSemver("0.2.9", "^0.2.3") && !satisfiesSemver("0.3.0", "^0.2.3"));
    assert.ok(satisfiesSemver("0.0.3", "^0.0.3") && !satisfiesSemver("0.0.4", "^0.0.3"));
    assert.ok(satisfiesSemver("1.2.9", "~1.2.3") && !satisfiesSemver("1.3.0", "~1.2.3"));
    assert.ok(satisfiesSemver("1.7.0", "1.x") && !satisfiesSemver("2.0.0", "1.x"));
    assert.ok(satisfiesSemver("5.0.0", "*"));
    assert.ok(satisfiesSemver("1.5.0", ">= 1.2 < 2") && !satisfiesSemver("2.0.0", ">=1.2 <2"));
    assert.ok(satisfiesSemver("1.5.0", "1.0.0 - 1.9.0") && !satisfiesSemver("2.0.0", "1.0.0 - 1.9.0"));
    assert.ok(satisfiesSemver("3.1.0", "^1.0.0 || ^3.0.0") && !satisfiesSemver("2.1.0", "^1.0.0 || ^3.0.0"));
    assert.ok(satisfiesSemver("1.2.3", "v1.2.3") && satisfiesSemver("1.2.3", "=1.2.3"));
  });

  test("a pre-release only matches a range that names that pre-release version", () => {
    assert.ok(!satisfiesSemver("2.0.0-beta.1", "^1.0.0"));
    assert.ok(!satisfiesSemver("1.3.0-rc.1", "^1.2.0"));
    assert.ok(satisfiesSemver("1.2.3-beta.4", ">=1.2.3-beta.2 <1.3.0"));
  });

  test("ordering puts a release above its pre-releases and compares numerically", () => {
    assert.strictEqual(compareSemver("1.10.0", "1.9.0"), 1);
    assert.strictEqual(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
    assert.strictEqual(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
    assert.strictEqual(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  });

  test("maxSatisfying picks npm's 'wanted' version and skips pre-releases", () => {
    const versions = ["1.0.0", "1.4.2", "1.5.0-beta.1", "2.0.0", "2.1.0"];
    assert.strictEqual(maxSatisfyingSemver(versions, "^1.0.0"), "1.4.2");
    assert.strictEqual(maxSatisfyingSemver(versions, "~2.0.0"), "2.0.0");
    assert.strictEqual(maxSatisfyingSemver(versions, "^3.0.0"), undefined);
  });

  test("non-registry specs are recognised", () => {
    for (const spec of ["^1.0.0", "latest", "next", "", "1.x", ">=2 <3"]) assert.ok(isRegistryNpmSpec(spec), spec);
    for (const spec of ["file:../lib", "workspace:*", "git+https://github.com/a/b.git", "github:a/b", "a/b", "https://x.test/a.tgz", "npm:other@^1", "link:./x"]) {
      assert.ok(!isRegistryNpmSpec(spec), spec);
    }
  });
});

suite("dependency versions: PEP 440 and Maven", () => {
  test("PEP 440 orders dev, pre, final and post releases correctly", () => {
    const ordered = ["1.0.dev1", "1.0a1", "1.0b2", "1.0rc1", "1.0", "1.0.post1", "1.1"];
    for (let i = 1; i < ordered.length; i++) {
      assert.strictEqual(comparePep440(ordered[i - 1], ordered[i]), -1, `${ordered[i - 1]} < ${ordered[i]}`);
    }
    assert.strictEqual(comparePep440("1.0", "1.0.0"), 0);
    assert.strictEqual(comparePep440("2!1.0", "3.0"), 1);
  });

  test("PEP 440 specifiers, including compatible-release and wildcards", () => {
    assert.ok(satisfiesPep440("2.5", "~=2.2") && !satisfiesPep440("3.0", "~=2.2"));
    assert.ok(satisfiesPep440("1.4.9", "~=1.4.5") && !satisfiesPep440("1.5.0", "~=1.4.5"));
    assert.ok(satisfiesPep440("1.4.2", "==1.4.*") && !satisfiesPep440("1.5", "==1.4.*"));
    assert.ok(satisfiesPep440("2.1", ">=2,<3,!=2.0") && !satisfiesPep440("2.0", ">=2,<3,!=2.0"));
    assert.ok(satisfiesPep440("9.9", ""));
    assert.strictEqual(maxSatisfyingPep440(["1.0", "1.9", "2.0rc1", "2.0"], "<2"), "1.9");
  });

  test("Maven ordering handles qualifiers, trailing zeros and release markers", () => {
    assert.strictEqual(compareMaven("1.0-rc1", "1.0"), -1);
    assert.strictEqual(compareMaven("1.0", "1.0.1"), -1);
    assert.strictEqual(compareMaven("1.0.0.Final", "1.0"), 0);
    assert.strictEqual(compareMaven("2.0.0-M1", "2.0.0-RC1"), -1);
    assert.strictEqual(compareMaven("1.10", "1.9"), 1);
    assert.strictEqual(compareMaven("1.0-SNAPSHOT", "1.0"), -1);
  });

  test("Maven stability and flavours", () => {
    for (const version of ["32.1.3-jre", "5.3.20.RELEASE", "2.0.0.Final", "4.13.2", "1.9.22"]) assert.ok(isStableMaven(version), version);
    for (const version of ["2.0.0-M1", "1.0-SNAPSHOT", "6.0.0-RC2", "1.0.0-beta-3", "3.0.0-alpha1", "1.0RC1"]) assert.ok(!isStableMaven(version), version);
    assert.strictEqual(mavenFlavour("32.1.3-jre"), "jre");
    assert.strictEqual(mavenFlavour("32.1.3-android"), "android");
    assert.strictEqual(mavenFlavour("5.3.20.RELEASE"), "");
  });
});

suite("dependency manifests", () => {
  test("package.json sections map to scopes, and optional wins over production", () => {
    const result = parsePackageJson(JSON.stringify({
      packageManager: "pnpm@9.1.0",
      dependencies: { axios: "^1.8.3", fsevents: "^2.3.0", local: "file:../local", "../evil": "^1.0.0" },
      devDependencies: { typescript: "^5.4.0" },
      optionalDependencies: { fsevents: "^2.3.0" },
      peerDependencies: { react: ">=18", axios: "^1.0.0" }
    }));
    const byName = new Map(result.dependencies.map(entry => [entry.name, entry]));
    assert.strictEqual(result.packageManager, "pnpm@9.1.0");
    assert.strictEqual(byName.get("axios")!.scope, "production");
    assert.strictEqual(byName.get("axios")!.spec, "^1.8.3");
    assert.strictEqual(byName.get("typescript")!.scope, "development");
    assert.strictEqual(byName.get("fsevents")!.scope, "optional");
    assert.strictEqual(byName.get("react")!.scope, "peer");
    assert.strictEqual(byName.get("local")!.registry, false);
    assert.strictEqual(byName.get("../evil")!.registry, false, "an invalid package name is never installable");
  });

  test("a malformed package.json reports an error instead of throwing", () => {
    const result = parsePackageJson("{ nope");
    assert.deepStrictEqual(result.dependencies, []);
    assert.ok(result.error && /could not be parsed/.test(result.error));
  });

  test("requirements files skip options, paths and comments and keep extras and markers", () => {
    const text = [
      "# base requirements",
      "-r common.txt",
      "--index-url https://pypi.org/simple",
      "requests[socks] >=2.31,<3  # http",
      "Django==4.2.11 \\",
      "    --hash=sha256:abc",
      "tomli>=2; python_version < \"3.11\"",
      "./local-package",
      "-e git+https://github.com/a/b.git#egg=b",
      "private @ https://example.test/private.whl",
      "numpy"
    ].join("\n");
    const deps = parseRequirements(text, "requirements.txt", "production");
    const byName = new Map(deps.map(entry => [entry.name, entry]));
    assert.deepStrictEqual([...byName.keys()], ["requests", "django", "tomli", "private", "numpy"]);
    assert.strictEqual(byName.get("requests")!.spec, ">=2.31,<3");
    assert.strictEqual(byName.get("requests")!.extras, "[socks]");
    assert.strictEqual(byName.get("django")!.spec, "==4.2.11");
    assert.strictEqual(byName.get("django")!.displayName, "Django");
    assert.ok(/python_version/.test(byName.get("tomli")!.note || ""));
    assert.strictEqual(byName.get("private")!.registry, false);
    assert.strictEqual(byName.get("numpy")!.spec, "");
  });

  test("pyproject dependencies, optional groups and dependency groups", () => {
    const text = `
[project]
name = "demo"
dependencies = [
  "httpx[http2]>=0.27",   # extras contain a bracket
  'pydantic ~= 2.6',
]

[project.optional-dependencies]
dev = ["pytest>=8"]
postgres = ["psycopg[binary]>=3.1"]

[dependency-groups]
lint = ["ruff", { include-group = "dev" }]
`;
    const { dependencies, poetryOnly } = parsePyproject(text);
    const byName = new Map(dependencies.map(entry => [entry.name, entry]));
    assert.strictEqual(poetryOnly, false);
    assert.strictEqual(byName.get("httpx")!.extras, "[http2]");
    assert.strictEqual(byName.get("httpx")!.spec, ">=0.27");
    assert.strictEqual(byName.get("pydantic")!.spec, "~=2.6");
    assert.strictEqual(byName.get("pytest")!.scope, "development");
    assert.strictEqual(byName.get("psycopg")!.scope, "optional");
    assert.strictEqual(byName.get("ruff")!.scope, "development");
    assert.strictEqual(dependencies.length, 5);
  });

  test("a Poetry-only pyproject is flagged rather than silently empty", () => {
    const result = parsePyproject("[tool.poetry.dependencies]\npython = \"^3.11\"\nrequests = \"^2.31\"\n");
    assert.strictEqual(result.poetryOnly, true);
    assert.strictEqual(result.dependencies.length, 0);
  });

  test("pom.xml resolves properties and ignores managed, plugin and import-scoped entries", () => {
    const pom = `<project>
  <groupId>com.example</groupId><artifactId>app</artifactId><version>1.4.0</version>
  <properties><jackson.version>2.15.2</jackson.version></properties>
  <dependencyManagement><dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>3.2.0</version><type>pom</type><scope>import</scope></dependency>
  </dependencies></dependencyManagement>
  <dependencies>
    <!-- <dependency><groupId>commented</groupId><artifactId>out</artifactId><version>1</version></dependency> -->
    <dependency><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId><version>\${jackson.version}</version></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>com.example</groupId><artifactId>shared</artifactId><version>\${project.version}</version></dependency>
    <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency>
  </dependencies>
  <build><plugins><plugin><dependencies>
    <dependency><groupId>plugin</groupId><artifactId>only</artifactId><version>1.0</version></dependency>
  </dependencies></plugin></plugins></build>
</project>`;
    const deps = parsePom(pom);
    const byName = new Map(deps.map(entry => [entry.name, entry]));
    assert.deepStrictEqual([...byName.keys()].sort(), [
      "com.example:shared", "com.fasterxml.jackson.core:jackson-databind", "junit:junit", "org.springframework.boot:spring-boot-starter-web"
    ]);
    assert.strictEqual(byName.get("com.fasterxml.jackson.core:jackson-databind")!.spec, "2.15.2");
    assert.strictEqual(byName.get("com.fasterxml.jackson.core:jackson-databind")!.versionRef, "jackson.version");
    assert.strictEqual(byName.get("com.example:shared")!.spec, "1.4.0");
    assert.strictEqual(byName.get("junit:junit")!.scope, "development");
    assert.strictEqual(byName.get("org.springframework.boot:spring-boot-starter-web")!.registry, false);
  });

  test("Gradle string, map and variable notation in Groovy and Kotlin DSL", () => {
    const groovy = `
ext { okhttpVersion = '4.12.0' }
def junitVersion = "5.10.1"
dependencies {
    implementation 'com.google.guava:guava:32.1.3-jre'
    implementation "com.squareup.okhttp3:okhttp:$okhttpVersion"
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.2.0"))
    testImplementation "org.junit.jupiter:junit-jupiter:\${junitVersion}"
    compileOnly group: 'org.projectlombok', name: 'lombok', version: '1.18.30'
    // implementation 'commented:out:1.0'
    runtimeOnly "com.h2database:h2:$fromProperties"
}`;
    const deps = parseGradle(groovy, "build.gradle", { fromProperties: "2.2.224" });
    const byName = new Map(deps.map(entry => [entry.name, entry]));
    assert.deepStrictEqual([...byName.keys()].sort(), [
      "com.google.guava:guava", "com.h2database:h2", "com.squareup.okhttp3:okhttp", "org.junit.jupiter:junit-jupiter", "org.projectlombok:lombok"
    ]);
    assert.strictEqual(byName.get("com.squareup.okhttp3:okhttp")!.spec, "4.12.0");
    assert.strictEqual(byName.get("org.junit.jupiter:junit-jupiter")!.spec, "5.10.1");
    assert.strictEqual(byName.get("org.junit.jupiter:junit-jupiter")!.scope, "development");
    assert.strictEqual(byName.get("com.h2database:h2")!.spec, "2.2.224");

    const kotlin = parseGradle(`dependencies {\n  implementation("io.ktor:ktor-client-core:2.3.7")\n  androidTestImplementation("androidx.test:runner:1.5.2")\n}`, "build.gradle.kts");
    assert.strictEqual(kotlin.length, 2);
    assert.strictEqual(kotlin[1].scope, "development");
  });

  test("an unresolvable Gradle variable is reported, not guessed", () => {
    const [entry] = parseGradle(`dependencies { implementation "a.b:c:$missing" }`, "build.gradle");
    assert.strictEqual(entry.registry, false);
    assert.ok(/missing/.test(entry.note || ""));
  });

  test("Gradle version catalogs resolve version references", () => {
    const deps = parseVersionCatalog(`
[versions]
kotlin = "1.9.22"
[libraries]
kotlin-stdlib = { module = "org.jetbrains.kotlin:kotlin-stdlib", version.ref = "kotlin" }
okio = { group = "com.squareup.okio", name = "okio", version = "3.7.0" }
gson = "com.google.code.gson:gson:2.10.1"
[plugins]
android = { id = "com.android.application", version = "8.2.0" }
`);
    const byName = new Map(deps.map(entry => [entry.name, entry]));
    assert.strictEqual(deps.length, 3);
    assert.strictEqual(byName.get("org.jetbrains.kotlin:kotlin-stdlib")!.spec, "1.9.22");
    assert.strictEqual(byName.get("org.jetbrains.kotlin:kotlin-stdlib")!.versionRef, "versions.kotlin");
    assert.strictEqual(byName.get("com.squareup.okio:okio")!.spec, "3.7.0");
    assert.strictEqual(byName.get("com.google.code.gson:gson")!.spec, "2.10.1");
  });
});

suite("dependency project detection", () => {
  const file = (relative: string, text?: string): ProjectFile => ({ path: path.join(ROOT, relative), text });

  test("the lockfile, packageManager field and .yarnrc.yml choose the Node manager", () => {
    const has = (names: string[]) => (candidate: string) => names.map(name => path.join(ROOT, name)).includes(candidate);
    assert.strictEqual(detectNodeManager(ROOT, undefined, has(["pnpm-lock.yaml"]), ROOT).manager, "pnpm");
    assert.strictEqual(detectNodeManager(ROOT, undefined, has(["package-lock.json"]), ROOT).manager, "npm");
    const berry = detectNodeManager(ROOT, undefined, has(["yarn.lock", ".yarnrc.yml"]), ROOT);
    assert.deepStrictEqual([berry.manager, berry.yarnBerry], ["yarn", true]);
    const classic = detectNodeManager(ROOT, undefined, has(["yarn.lock"]), ROOT);
    assert.deepStrictEqual([classic.manager, classic.yarnBerry], ["yarn", false]);
    assert.strictEqual(detectNodeManager(ROOT, "yarn@4.1.0", has(["package-lock.json"]), ROOT).yarnBerry, true);
    assert.strictEqual(detectNodeManager(ROOT, undefined, has([]), ROOT).manager, "npm");
  });

  test("a monorepo package uses the root lockfile's manager", () => {
    const projects = detectProjects([
      file("package.json", JSON.stringify({ devDependencies: { turbo: "^2.0.0" } })),
      file("pnpm-lock.yaml"),
      file("packages/web/package.json", JSON.stringify({ dependencies: { react: "^18.2.0" } }))
    ], ROOT, "linux");
    assert.strictEqual(projects.length, 2);
    assert.ok(projects.every(project => project.manager === "pnpm"));
    assert.ok(/pnpm-lock\.yaml in \./.test(projects[1].detectedBy));
  });

  test("Python, Maven and Gradle projects, with platform-specific wrappers", () => {
    const files = [
      file("api/requirements.txt", "fastapi>=0.110\n"),
      file("api/requirements-dev.txt", "pytest\nfastapi>=0.110\n"),
      file("svc/pom.xml", "<project><dependencies><dependency><groupId>a.b</groupId><artifactId>c</artifactId><version>1.0</version></dependency></dependencies></project>"),
      file("svc/mvnw"),
      file("svc/mvnw.cmd"),
      file("android/build.gradle.kts", `dependencies { implementation("androidx.core:core-ktx:1.12.0") }`),
      file("android/gradle/libs.versions.toml", `[libraries]\nokio = "com.squareup.okio:okio:3.7.0"\n`)
    ];
    const linux = detectProjects(files, ROOT, "linux");
    const python = linux.find(project => project.ecosystem === "python")!;
    assert.strictEqual(python.dependencies.length, 2, "a package listed in two files appears once");
    assert.strictEqual(python.dependencies.find(entry => entry.name === "fastapi")!.scope, "production");
    assert.strictEqual(python.dependencies.find(entry => entry.name === "pytest")!.scope, "development");
    const maven = linux.find(project => project.ecosystem === "maven")!;
    assert.strictEqual(maven.tool, "mvnw");
    assert.strictEqual(path.basename(maven.wrapperPath!), "mvnw");
    assert.strictEqual(path.basename(detectProjects(files, ROOT, "win32").find(project => project.ecosystem === "maven")!.wrapperPath!), "mvnw.cmd");
    const gradle = linux.find(project => project.ecosystem === "gradle")!;
    assert.strictEqual(gradle.tool, "gradle");
    assert.strictEqual(gradle.dependencies.length, 2);
  });

  test("this repository is detected as an npm project with its real dependencies", () => {
    const repo = path.resolve(__dirname, "../../..");
    const projects = detectProjects([
      { path: path.join(repo, "package.json"), text: fs.readFileSync(path.join(repo, "package.json"), "utf8") },
      { path: path.join(repo, "package-lock.json") }
    ], repo, process.platform);
    assert.strictEqual(projects.length, 1);
    assert.strictEqual(projects[0].manager, "npm");
    assert.ok(projects[0].dependencies.some(entry => entry.name === "axios" && entry.scope === "production"));
    assert.ok(projects[0].dependencies.some(entry => entry.name === "typescript" && entry.scope === "development"));
  });
});

suite("dependency verdicts", () => {
  const info = { versions: ["1.0.0", "1.2.0", "1.3.0", "2.0.0", "2.1.0-beta.1"], latest: "2.0.0" };

  test("npm: missing, mismatch, outdated, newer major and up to date", () => {
    assert.strictEqual(evaluateDependency("node", dep({}), undefined, info).status, "missing");
    assert.strictEqual(evaluateDependency("node", dep({ spec: "^2.0.0" }), "1.3.0", info).status, "mismatch");
    const outdated = evaluateDependency("node", dep({}), "1.2.0", info);
    assert.deepStrictEqual([outdated.status, outdated.compatible, outdated.latest], ["outdated", "1.3.0", "2.0.0"]);
    const major = evaluateDependency("node", dep({}), "1.3.0", info);
    assert.deepStrictEqual([major.status, major.compatible], ["major", "1.3.0"]);
    assert.strictEqual(evaluateDependency("node", dep({ spec: "^2.0.0" }), "2.0.0", info).status, "up-to-date");
    assert.strictEqual(evaluateDependency("node", dep({ spec: "latest" }), "1.0.0", info).status, "outdated");
  });

  test("unknown when the registry failed or the dependency is not from a registry", () => {
    const failed = evaluateDependency("node", dep({}), "1.2.0", { versions: [], error: "registry.npmjs.org could not be reached." });
    assert.strictEqual(failed.status, "unknown");
    assert.ok(/could not be reached/.test(failed.detail));
    assert.strictEqual(evaluateDependency("node", dep({}), "1.2.0", undefined).status, "unknown");
    assert.strictEqual(evaluateDependency("node", dep({ registry: false, note: "git" }), "1.2.0", info).status, "unknown");
    // A missing package is reported as missing even while offline.
    assert.strictEqual(evaluateDependency("node", dep({}), undefined, { versions: [], error: "offline" }).status, "missing");
  });

  test("pip: a pinned requirement with a newer release needs a manifest change", () => {
    const pypi = { versions: ["2.30.0", "2.31.0", "2.32.3", "3.0.0b1"], latest: "2.32.3" };
    const pinned = evaluateDependency("python", dep({ name: "requests", spec: "==2.31.0" }), "2.31.0", pypi);
    assert.deepStrictEqual([pinned.status, pinned.compatible, pinned.latest], ["major", "2.31.0", "2.32.3"]);
    assert.strictEqual(evaluateDependency("python", dep({ name: "requests", spec: ">=2.30" }), "2.31.0", pypi).status, "outdated");
  });

  test("Maven: same-major update, new major, and the -jre flavour is kept", () => {
    const central = { versions: ["31.1-jre", "31.1-android", "32.1.3-jre", "32.1.3-android", "33.0.0-jre", "33.1.0-jre", "34.0.0-rc1"] };
    const verdict = evaluateDependency("maven", dep({ name: "com.google.guava:guava", spec: "32.0.0-jre" }), "32.0.0-jre", central);
    assert.deepStrictEqual([verdict.status, verdict.compatible, verdict.latest], ["outdated", "32.1.3-jre", "33.1.0-jre"]);
    const latestMajor = evaluateDependency("maven", dep({ name: "com.google.guava:guava", spec: "32.1.3-jre" }), "32.1.3-jre", central);
    assert.strictEqual(latestMajor.status, "major");
    assert.strictEqual(evaluateDependency("maven", dep({ name: "a:b", spec: "1.0" }), undefined, central).status, "missing");
  });
});

suite("dependency commands and production safety", () => {
  const verdict = (status: string, latest = "2.0.0") => ({ status, latest, compatible: "1.3.0", installed: "1.2.0", detail: "" }) as any;

  test("a production major upgrade is copy-only; a development one may run", () => {
    const project = nodeProject();
    const prod = dependencyCommands(project, dep({}), verdict("major"));
    assert.strictEqual(prod.find(option => option.kind === "upgrade")!.runnable, false);
    const dev = dependencyCommands(project, dep({ scope: "development" }), verdict("major"));
    const upgrade = dev.find(option => option.kind === "upgrade")!;
    assert.strictEqual(upgrade.runnable, true);
    assert.deepStrictEqual(upgrade.spec.args, ["install", "left-pad@^2.0.0", "--save-dev"]);
  });

  test("in-range updates and installs never pass a manifest-writing flag", () => {
    const project = nodeProject();
    const options = dependencyCommands(project, dep({}), verdict("outdated"));
    assert.deepStrictEqual(options.find(option => option.kind === "update")!.spec.args, ["update", "--no-audit", "--no-fund", "left-pad"]);
    assert.deepStrictEqual(projectInstallCommand(project)[0].args, ["install", "--no-audit", "--no-fund"]);
    const berry = projectUpdateCommand(nodeProject({ manager: "yarn", tool: "yarn", yarnBerry: true }), [dep({})])!;
    assert.deepStrictEqual(berry.args, ["up", "left-pad@^1.0.0"], "yarn berry keeps the declared range");
    assert.deepStrictEqual(projectUpdateCommand(nodeProject({ manager: "yarn", tool: "yarn" }), [dep({})])!.args, ["upgrade", "left-pad"]);
  });

  test("pip and Maven upgrades beyond the declared version are copy-only", () => {
    const python = nodeProject({ ecosystem: "python", manager: "pip", tool: "python" });
    const pipOptions = dependencyCommands(python, dep({ name: "requests", displayName: "requests", spec: "==2.31.0", source: "requirements.txt" }), verdict("major", "2.32.3"));
    assert.strictEqual(pipOptions.find(option => option.kind === "upgrade")!.runnable, false);
    assert.strictEqual(pipOptions.find(option => option.kind === "install")!.runnable, false, "not missing, so nothing to install");

    const maven = nodeProject({ ecosystem: "maven", manager: "maven", tool: "mvn" });
    const mavenOptions = dependencyCommands(maven, dep({ name: "a.b:c", spec: "1.0" }), { status: "outdated", compatible: "1.2", latest: "2.0", installed: "1.0", detail: "" });
    assert.ok(mavenOptions.filter(option => option.kind !== "install").every(option => !option.runnable));
    assert.strictEqual(mavenOptions.length, 3);
  });

  test("pip installs of missing requirements use the requirements files", () => {
    const python = nodeProject({ ecosystem: "python", manager: "pip", tool: "python" });
    const missing = [
      dep({ name: "a", displayName: "a", spec: "", source: "requirements.txt" }),
      dep({ name: "b", displayName: "B", spec: ">=1", source: "pyproject.toml", extras: "[x]" })
    ];
    const commands = projectInstallCommand(python, missing);
    assert.deepStrictEqual(commands.map(command => command.args), [
      ["-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"],
      ["-m", "pip", "install", "--disable-pip-version-check", "B[x]>=1"]
    ]);
  });

  test("every command the panel generates passes validation", () => {
    const projects: DetectedProject[] = [
      nodeProject(),
      nodeProject({ manager: "pnpm", tool: "pnpm" }),
      nodeProject({ manager: "yarn", tool: "yarn" }),
      nodeProject({ manager: "yarn", tool: "yarn", yarnBerry: true }),
      nodeProject({ ecosystem: "python", manager: "pip", tool: "python" }),
      nodeProject({ ecosystem: "maven", manager: "maven", tool: "mvnw" }),
      nodeProject({ ecosystem: "gradle", manager: "gradle", tool: "gradlew" })
    ];
    const samples: Record<string, DeclaredDependency> = {
      node: dep({ name: "@types/node", spec: ">=18 <21 || ^22.0.0", scope: "development" }),
      python: dep({ name: "requests", displayName: "requests", spec: ">=2,!=2.30.*", extras: "[socks]", source: "requirements/dev.txt" }),
      maven: dep({ name: "org.example:lib", spec: "1.2.3" }),
      gradle: dep({ name: "org.example:lib", spec: "1.2.3" })
    };
    for (const project of projects) {
      const sample = samples[project.ecosystem];
      for (const status of ["missing", "outdated", "major"]) {
        for (const option of dependencyCommands(project, sample, { status: status as any, compatible: "1.4.0", latest: "2.0.0", installed: "1.2.3", detail: "" })) {
          if (!option.runnable) continue;
          const result = validateCommandSpec(option.spec);
          assert.ok(result.ok, `${project.manager} ${option.kind}: ${result.reason}`);
        }
      }
      for (const spec of projectInstallCommand(project, [sample])) assert.ok(validateCommandSpec(spec).ok, `${project.manager} install`);
      const update = projectUpdateCommand(project, [sample]);
      if (update) assert.ok(validateCommandSpec(update).ok, `${project.manager} update: ${validateCommandSpec(update).reason}`);
    }
  });

  test("validation rejects injection, foreign options, other operations and non-registry sources", () => {
    const rejected: Array<[string, string[]]> = [
      ["npm", ["install", "left-pad; rm -rf ~"]],
      ["npm", ["install", "a && calc"]],
      ["npm", ["install", "\"quoted\""]],
      ["npm", ["install", "%COMSPEC%"]],
      ["npm", ["install", "$(whoami)"]],
      ["npm", ["install", "`id`"]],
      ["npm", ["install", "line\nbreak"]],
      ["npm", ["install", "--registry=https://evil.test"]],
      ["npm", ["install", "evil@git+https://github.com/x/y.git"]],
      ["npm", ["install", "https://evil.test/x.tgz"]],
      ["npm", ["install", "a@file:../../etc"]],
      ["npm", ["run", "postinstall"]],
      ["npm", ["exec", "evil"]],
      ["pnpm", ["dlx", "evil"]],
      ["python", ["-c", "import os"]],
      ["python", ["-m", "http.server"]],
      ["python", ["-m", "pip", "uninstall", "requests"]],
      ["python", ["-m", "pip", "install", "-r", "../../secrets.txt"]],
      ["python", ["-m", "pip", "install", "--index-url", "https://evil.test"]],
      ["mvn", ["-B", "exec:exec"]],
      ["gradle", ["build"]],
      ["gradlew", ["dependencies", "--init-script", "evil.gradle"]]
    ];
    for (const [tool, args] of rejected) {
      assert.strictEqual(validateCommandSpec({ tool: tool as any, args }).ok, false, `${tool} ${args.join(" ")} must be rejected`);
    }
    assert.strictEqual(validateCommandSpec({ tool: "bash" as any, args: ["-c", "id"] }).ok, false);
  });
});

suite("dependency processes across platforms", () => {
  test("Windows .cmd shims run through cmd.exe with every argument quoted", () => {
    const plan = planSpawn("C:\\Program Files\\nodejs\\npm.cmd", ["install", "a@>=1.2 <2 || ^3"], "win32", "C:\\Windows\\System32\\cmd.exe");
    assert.strictEqual(plan.file, "C:\\Windows\\System32\\cmd.exe");
    assert.strictEqual(plan.windowsVerbatimArguments, true);
    assert.deepStrictEqual(plan.args.slice(0, 4), ["/d", "/s", "/v:off", "/c"]);
    assert.strictEqual(plan.args[4], "\"\"C:\\Program Files\\nodejs\\npm.cmd\" \"install\" \"a@>=1.2 <2 || ^3\"\"");
    assert.throws(() => planSpawn("C:\\npm.cmd", ["%PATH%"], "win32"));
    assert.throws(() => planSpawn("C:\\npm.cmd", ["a\" & calc"], "win32"));
  });

  test("POSIX and Windows .exe files are spawned directly without a shell", () => {
    assert.deepStrictEqual(planSpawn("/usr/local/bin/npm", ["install"], "darwin"), { file: "/usr/local/bin/npm", args: ["install"], windowsVerbatimArguments: false });
    assert.strictEqual(planSpawn("C:\\Python312\\python.exe", ["-m", "pip"], "win32").file, "C:\\Python312\\python.exe");
  });

  test("executables are found on PATH, skipping relative and workspace entries", () => {
    const present = new Set(["/usr/local/bin/npm", "/work/repo/node_modules/.bin/npm", "/opt/homebrew/bin/npm"]);
    const found = resolveExecutable("npm", ".:/work/repo/node_modules/.bin:/usr/local/bin:/opt/homebrew/bin", "darwin", file => present.has(file), ["/work/repo"]);
    assert.strictEqual(found, "/usr/local/bin/npm");
    const windows = new Set(["C:\\nodejs\\npm.cmd", "C:\\repo\\npm.cmd"]);
    assert.strictEqual(
      resolveExecutable("npm", "C:\\repo;\"C:\\nodejs\";relative", "win32", file => windows.has(file), ["C:\\repo"], ".EXE;.CMD"),
      "C:\\nodejs\\npm.cmd"
    );
    assert.strictEqual(resolveExecutable("pnpm", "/usr/bin", "linux", () => false), undefined);
  });

  test("displayed commands are quoted for the platform's shell", () => {
    const spec = { tool: "npm" as const, args: ["install", "@types/node@^20.0.0", "--save-dev"] };
    assert.strictEqual(formatCommandLine(spec, "darwin"), "npm install '@types/node@^20.0.0' --save-dev");
    assert.strictEqual(formatCommandLine(spec, "win32"), "npm install \"@types/node@^20.0.0\" --save-dev");
    assert.strictEqual(formatCommandLine({ tool: "npm", args: ["install", "@scope/pkg"] }, "win32"), "npm install \"@scope/pkg\"");
    assert.strictEqual(formatCommandLine({ tool: "mvn", args: ["-B", "dependency:get", "-Dartifact=a:b:1.0"] }, "win32"), "mvn -B dependency:get \"-Dartifact=a:b:1.0\"");
    assert.strictEqual(formatCommandLine({ tool: "python", args: ["-m", "pip", "install", "requests>=2"] }, "linux", "./.venv/bin/python"), "./.venv/bin/python -m pip install 'requests>=2'");
  });

  test("PATH is replaced under Windows' existing case-insensitive key", () => {
    const env = withSearchPath({ Path: "C:\\old", Other: "1" }, "C:\\new", "win32");
    assert.strictEqual(env.Path, "C:\\new");
    assert.ok(!("PATH" in env));
    assert.strictEqual(withSearchPath({ PATH: "/old" }, "/new", "linux").PATH, "/new");
  });

  test("node_modules lookup walks up to, and not past, the workspace root", () => {
    const candidates = nodeModuleManifestCandidates(path.join(ROOT, "packages", "web"), "@types/node", ROOT);
    assert.deepStrictEqual(candidates, [
      path.join(ROOT, "packages", "web", "node_modules", "@types", "node", "package.json"),
      path.join(ROOT, "packages", "node_modules", "@types", "node", "package.json"),
      path.join(ROOT, "node_modules", "@types", "node", "package.json")
    ]);
  });
});

suite("dependency registries and failures", () => {
  test("registry URLs encode scoped names and route Android artifacts to Google", () => {
    assert.strictEqual(npmRegistryUrl("@types/node"), "https://registry.npmjs.org/@types%2Fnode");
    assert.strictEqual(npmRegistryUrl("axios"), "https://registry.npmjs.org/axios");
    assert.ok(mavenMetadataUrls("androidx.core:core-ktx")[0].startsWith("https://dl.google.com/"));
    assert.strictEqual(mavenMetadataUrls("com.google.guava:guava")[0], "https://repo1.maven.org/maven2/com/google/guava/guava/maven-metadata.xml");
  });

  test("registry documents are parsed, skipping yanked and pre-release versions for latest", () => {
    const npm = parseNpmPackument({ "dist-tags": { latest: "1.8.3", next: "2.0.0-rc.1" }, versions: { "1.8.3": {}, "2.0.0-rc.1": {} } });
    assert.strictEqual(npm.latest, "1.8.3");
    const pypi = parsePypiDocument({
      info: { version: "2.32.3" },
      releases: { "2.31.0": [{ yanked: false }], "2.32.0": [{ yanked: true }], "2.32.3": [{}], "3.0.0b1": [{}], "0.0.1": [] }
    });
    assert.deepStrictEqual(pypi.versions.sort(), ["2.31.0", "2.32.3", "3.0.0b1"]);
    assert.strictEqual(pypi.latest, "2.32.3");
    const maven = parseMavenMetadata("<metadata><versioning><versions><version>1.0</version><version>1.1</version><version>2.0-M1</version></versions></versioning></metadata>");
    assert.strictEqual(maven.latest, "1.1");
    assert.strictEqual(maven.versions.length, 3);
  });

  test("pip list output is read by normalised name, ignoring a leading warning", () => {
    const installed = parsePipList("WARNING: something\n[{\"name\": \"Django\", \"version\": \"4.2.11\"}, {\"name\": \"typing_extensions\", \"version\": \"4.9.0\"}]");
    assert.strictEqual(installed.get("django"), "4.2.11");
    assert.strictEqual(installed.get("typing-extensions"), "4.9.0");
    assert.strictEqual(parsePipList("not json").size, 0);
  });

  test("Maven's local repository honours settings.xml", () => {
    assert.strictEqual(mavenLocalRepository("<settings><localRepository>~/m2repo</localRepository></settings>", "/home/dev"), "/home/dev/m2repo");
    assert.strictEqual(mavenLocalRepository(undefined, "/home/dev"), path.join("/home/dev", ".m2", "repository"));
  });

  test("failures are explained with a concrete next step", () => {
    const explain = (output: string, extra: object = {}) => explainFailure({ tool: "npm", output, exitCode: 1, platform: "darwin", ...extra });
    assert.ok(/venv/.test(explainFailure({ tool: "python", output: "error: externally-managed-environment", exitCode: 1, platform: "linux" })));
    assert.ok(/peer dependency/.test(explain("npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree")));
    assert.ok(/registry could not be reached/.test(explain("npm ERR! code ENOTFOUND")));
    assert.ok(/does not have this package/.test(explain("npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope")));
    assert.ok(/sudo/.test(explain("npm ERR! code EACCES")));
    assert.ok(/build tools/.test(explain("gyp ERR! stack Error: not found: make")));
    assert.ok(/nodejs\.org/.test(explain("", { errorCode: "ENOENT" })));
    assert.ok(/Cancelled/.test(explain("", { cancelled: true })));
    assert.ok(/15 minutes/.test(explain("", { timedOut: true, timeoutMinutes: 15 })));
    const generic = explain("resolving...\nFATAL: something odd happened\n", { exitCode: 7 });
    assert.ok(/exit code 7/.test(generic) && /something odd happened/.test(generic));
  });

  test("the quoted detail is the line that caused the failure, not npm's log-file boilerplate", () => {
    const npmOutput = [
      "npm error code E404",
      "npm error 404 Not Found - GET https://registry.npmjs.org/devsnip-nonexistent - Not found",
      "npm error 404",
      "npm error A complete log of this run can be found in: /Users/x/.npm/_logs/2026-09-28T08_15_46_688Z-debug-0.log"
    ].join("\n");
    const message = explainFailure({ tool: "npm", output: npmOutput, exitCode: 1, platform: "darwin" });
    assert.ok(/Details: npm error 404 Not Found - GET/.test(message), message);
    assert.ok(!/complete log/.test(message));
  });

  test("a missing package the registry does not know says so", () => {
    const verdict = evaluateDependency("node", dep({ name: "nope-zz" }), undefined, { versions: [], error: "Not found on registry.npmjs.org." });
    assert.strictEqual(verdict.status, "missing");
    assert.ok(/Not found on registry\.npmjs\.org/.test(verdict.detail));
  });
});

suite("dependency panel page", () => {
  test("the page loads its script from the extension only and the script parses", () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { getDependencyManagerHtml } = require("../../commands/dependencyManager");
    /* eslint-enable @typescript-eslint/no-var-requires */
    const html = getDependencyManagerHtml("vscode-resource:", "vscode-resource:/media/dependency-manager.js") as string;
    assert.ok(/script-src vscode-resource:;/.test(html));
    assert.ok(!/script-src[^;]*unsafe-inline/.test(html));
    assert.ok(html.includes("<script src=\"vscode-resource:/media/dependency-manager.js\"></script>"));

    const script = fs.readFileSync(path.resolve(__dirname, "../../../media/dependency-manager.js"), "utf8");
    assert.doesNotThrow(() => new Function(script));
    assert.ok(!/\.innerHTML\s*=/.test(script), "workspace values must never be written as HTML");
    for (const id of ["rescan", "installAll", "updateAll", "includeProd", "search", "statusFilter", "scopeFilter", "banner", "job", "stats", "projects", "subtitle", "showLog"]) {
      assert.ok(html.includes(`id="${id}"`), `the page is missing #${id}, which the script uses`);
    }
  });
});

suite("unused dependencies", () => {
  /** A workspace backed by a file map; globs follow VS Code's (braces, ** and *). */
  const memory = (files: Record<string, string>) => ({
    name: "ws",
    exists: async (file: string) => file in files,
    readFile: async (file: string) => files[file],
    findFiles: async (glob: string, limit: number) => Object.keys(files).filter(file => path.matchesGlob(file, glob)).slice(0, limit)
  });
  const unusedNames = async (files: Record<string, string>, options = {}) =>
    (await findUnusedDependencies(memory(files), options)).flatMap(scan => scan.unused.map(u => `${scan.ecosystem}:${u.name}`)).sort();

  test("npm: imports, requires, scripts, config files, peers and loaded-by-name packages count as used", async () => {
    const files = {
      "package.json": JSON.stringify({
        scripts: { build: "tsc && vite build", lint: "eslint ." },
        dependencies: { react: "^19", "react-dom": "^19", lodash: "^4", dayjs: "^1", hbs: "^4", "@scope/ui": "^1" },
        devDependencies: { vite: "^6", eslint: "^9", "eslint-plugin-react": "^7", "@types/lodash": "^4", "@types/node": "^22", "left-pad": "^1", typescript: "^5", "@testing-library/dom": "^10", "@testing-library/react": "^16" }
      }),
      "tsconfig.json": "{}",
      "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport "@scope/ui/styles.css";\nconst d = require("dayjs");\napp.set("view engine", "hbs");\n',
      "eslint.config.js": 'import react from "eslint-plugin-react";\nexport default [react];\n',
      "node_modules/@testing-library/react/package.json": JSON.stringify({ peerDependencies: { "@testing-library/dom": "^10" } })
    };
    assert.deepStrictEqual(await unusedNames(files), ["npm:@testing-library/react", "npm:@types/lodash", "npm:left-pad", "npm:lodash"]);
    assert.deepStrictEqual(await unusedNames(files, { includeDev: false }), ["npm:lodash"]);
    const [scan] = await findUnusedDependencies(memory({ ...files, "yarn.lock": "" }), { includeDev: false });
    assert.strictEqual(scan.removeCommand, "yarn remove lodash");
  });

  test("npm: specifiers are reduced to package names", () => {
    assert.deepStrictEqual([...importedPackages('import a from "@a/b/c";\nexport * from "d/e";\nimport("./local");\nrequire("node:fs");\nimport x from "#internal";\n/// <reference types="vite/client" />\n')].sort(), ["@a/b", "d", "vite"]);
    assert.strictEqual(packageOfSpecifier("~bootstrap/scss/x"), "bootstrap");
  });

  test("Python: module names, plugins, settings and pip-compile annotations", async () => {
    const files = {
      "requirements.txt": "fastapi\nuvicorn[standard]\nPillow\nrequests\nscikit-learn\ndjango-cors-headers\npsycopg2-binary\nsphinxcontrib-log-cabinet\n",
      "requirements-dev.txt": "pytest\npytest-cov\ntox\ntox-uv\nfaker\n",
      "app/main.py": "from fastapi import FastAPI\nfrom PIL import Image\nimport sklearn.linear_model as lm\nINSTALLED_APPS = ['corsheaders']\n",
      "docs/conf.py": 'extensions = ["sphinxcontrib.log_cabinet"]\n'
    };
    assert.deepStrictEqual(await unusedNames(files), ["python:faker", "python:requests"]);
    const compiled = "#\n# autogenerated by pip-compile\n#\namqp==5.1.1\n    # via kombu\ncelery==5.2.7\n    # via app (pyproject.toml)\nclick==8.1.3\n    # via\n    #   celery\n    #   -r requirements.in\nvine==5.0.0\n    # via amqp\n";
    assert.deepStrictEqual([...(directRequirements(compiled) ?? [])].sort(), ["celery", "click"]);
    assert.strictEqual(directRequirements("flask\n"), undefined);
  });

  test("Python: a pip freeze dump is skipped with a note, not reported package by package", async () => {
    const frozen = Array.from({ length: 20 }, (_, i) => `pkg${i}==1.0.${i}`).join("\n");
    const [scan] = await findUnusedDependencies(memory({ "requirements.txt": frozen, "x.py": "import os\n" }));
    assert.deepStrictEqual([scan.checked, scan.unused.length], [0, 0]);
    assert.match(scan.notes[0], /pip freeze/);
  });

  test("Dart / Flutter: package: imports, tool config and CupertinoIcons", async () => {
    const pubspec = "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0\n  provider: ^6.0.0\n  cupertino_icons: ^1.0.8\ndev_dependencies:\n  flutter_lints: ^4.0.0\n  build_runner: ^2.4.0\n  mocktail: ^1.0.0\nflutter_launcher_icons:\n  android: true\n";
    const files = { "pubspec.yaml": pubspec + "", "lib/main.dart": "import 'package:provider/provider.dart';\n" };
    assert.deepStrictEqual(await unusedNames({ ...files, "pubspec.yaml": pubspec.replace("  mocktail: ^1.0.0\n", "  mocktail: ^1.0.0\n  flutter_launcher_icons: ^0.14.0\n") }), ["pub:cupertino_icons", "pub:http", "pub:mocktail"]);
    assert.deepStrictEqual(await unusedNames({ ...files, "lib/icons.dart": "final i = CupertinoIcons.add;\n" }), ["pub:http", "pub:mocktail"]);
    const [scan] = await findUnusedDependencies(memory(files));
    assert.strictEqual(scan.removeCommand, "flutter pub remove http cupertino_icons mocktail");
    assert.deepStrictEqual(pubDependencies(pubspec).filter(d => d.sdk).map(d => d.name), ["flutter"]);
  });
});

suite(".NET (NuGet) and Dart / Flutter (pub) dependencies", () => {
  const csproj = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="8.0.11" />
    <PackageReference Include="Serilog.AspNetCore">
      <Version>8.0.3</Version>
    </PackageReference>
    <PackageReference Include="StyleCop.Analyzers" Version="1.1.118" PrivateAssets="all" />
    <PackageReference Include="Swashbuckle.AspNetCore" />
    <PackageReference Include="Floating" Version="8.*" />
    <PackageReference Include="FromProp" Version="$(EfVersion)" />
    <!-- <PackageReference Include="Commented" Version="1.0.0" /> -->
  </ItemGroup>
</Project>`;

  test("csproj PackageReferences, Central Package Management and PrivateAssets", () => {
    const central = parseCentralPackageVersions('<Project><ItemGroup><PackageVersion Include="Swashbuckle.AspNetCore" Version="6.6.2" /></ItemGroup></Project>');
    const deps = parseCsproj(csproj, "Api.csproj", central);
    assert.deepStrictEqual(deps.map(d => [d.displayName, d.spec, d.scope, d.registry]), [
      ["Microsoft.EntityFrameworkCore.Sqlite", "8.0.11", "production", true],
      ["Serilog.AspNetCore", "8.0.3", "production", true],
      ["StyleCop.Analyzers", "1.1.118", "development", true],
      ["Swashbuckle.AspNetCore", "6.6.2", "production", true],
      ["Floating", "8.*", "production", false],
      ["FromProp", "$(EfVersion)", "production", false]
    ]);
    assert.strictEqual(deps[3].versionRef, "Directory.Packages.props");
    assert.strictEqual(deps[0].name, "microsoft.entityframeworkcore.sqlite");
    const tests = parseCsproj('<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup><ItemGroup><PackageReference Include="xunit" Version="2.9.3" /></ItemGroup></Project>', "Api.Tests.csproj");
    assert.strictEqual(tests[0].scope, "development");
  });

  test("NuGet versions order like NuGet does", () => {
    const sorted = ["8.0.11", "8.0.2", "9.0.0-preview.1", "9.0.0-rc.2", "9.0.0", "8.0.11.1", "10.0.0-alpha"].sort(compareNuget);
    assert.deepStrictEqual(sorted, ["8.0.2", "8.0.11", "8.0.11.1", "9.0.0-preview.1", "9.0.0-rc.2", "9.0.0", "10.0.0-alpha"]);
    assert.deepStrictEqual(parseNugetIndex({ versions: ["8.0.0", "8.0.11", "9.0.0", "10.0.0-rc.1"] }).latest, "9.0.0");
    assert.deepStrictEqual(parseNugetAssets(JSON.stringify({ libraries: { "Serilog/4.0.0": { type: "package" }, "Api/1.0.0": { type: "project" } } })), new Map([["serilog", "4.0.0"]]));
  });

  test("a NuGet verdict: same-major update and copy-only csproj edits", () => {
    const [dep] = parseCsproj(csproj, "Api.csproj");
    const project = { id: "p0", dir: "/w", ecosystem: "nuget", manager: "dotnet", tool: "dotnet", detectedBy: "Api.csproj", manifests: ["Api.csproj"], dependencies: [dep], warnings: [] } as DetectedProject;
    const verdict = evaluateDependency("nuget", dep, "8.0.11", { versions: ["8.0.11", "8.0.20", "9.0.9", "10.0.0-rc.1"], latest: "9.0.9" });
    assert.deepStrictEqual([verdict.status, verdict.compatible, verdict.latest], ["outdated", "8.0.20", "9.0.9"]);
    assert.strictEqual(evaluateDependency("nuget", dep, undefined, undefined).status, "missing");
    const options = dependencyCommands(project, dep, verdict);
    assert.deepStrictEqual(options.map(o => [o.kind, formatCommandLine(o.spec, "linux"), o.runnable]), [
      ["install", "dotnet restore", false],
      ["update", "dotnet add package Microsoft.EntityFrameworkCore.Sqlite --version 8.0.20", false],
      ["upgrade", "dotnet add package Microsoft.EntityFrameworkCore.Sqlite --version 9.0.9", false]
    ]);
    for (const option of options) assert.ok(validateCommandSpec(option.spec).ok, formatCommandLine(option.spec, "linux"));
    assert.strictEqual(validateCommandSpec({ tool: "dotnet", args: ["add", "reference", "../x.csproj", "--version", "1"] }).ok, false);
    assert.strictEqual(validateCommandSpec({ tool: "dotnet", args: ["restore", "--source", "http://evil"] }).ok, false);
    assert.strictEqual(validateCommandSpec({ tool: "dotnet", args: ["run"] }).ok, false);
  });

  const pubspec = `name: app
environment:
  sdk: ^3.5.0
dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.0
  intl: any
  provider:
  local_pkg:
    path: ../local_pkg
  from_git:
    git: https://github.com/x/y
  private_pkg:
    hosted: https://pub.example.com
    version: ^1.0.0
dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ">=4.0.0 <6.0.0"
`;

  test("pubspec dependencies, SDK / path / git / private packages", () => {
    const parsed = parsePubspec(pubspec);
    assert.strictEqual(parsed.flutter, true);
    assert.deepStrictEqual(parsed.dependencies.map(d => [d.name, d.spec, d.scope, d.registry]), [
      ["flutter", "any", "production", false], ["http", "^1.2.0", "production", true], ["intl", "any", "production", true],
      ["provider", "any", "production", true], ["local_pkg", "any", "production", false], ["from_git", "any", "production", false],
      ["private_pkg", "^1.0.0", "production", false], ["flutter_test", "any", "development", false], ["flutter_lints", ">=4.0.0 <6.0.0", "development", true]
    ]);
    assert.deepStrictEqual(parsePubLock('packages:\n  http:\n    dependency: "direct main"\n    version: "1.2.2"\n'), new Map([["http", "1.2.2"]]));
    assert.deepStrictEqual(parsePubPackage({ latest: { version: "1.3.0" }, versions: [{ version: "1.2.2" }, { version: "1.3.0" }, { version: "1.4.0", retracted: true }, { version: "2.0.0-dev.1" }] }), { versions: ["1.2.2", "1.3.0", "2.0.0-dev.1"], latest: "1.3.0" });
    const projects = detectProjects([{ path: "/w/app/pubspec.yaml", text: pubspec }, { path: "/w/cli/pubspec.yaml", text: "name: cli\ndependencies:\n  args: ^2.5.0\n" }], "/w", "linux");
    assert.deepStrictEqual(projects.map(p => [p.ecosystem, p.manager, p.tool]), [["pub", "pub", "flutter"], ["pub", "pub", "dart"]]);
  });

  test("a pub verdict: in-range upgrade runs, a past-range one only for dev dependencies", () => {
    const deps = parsePubspec(pubspec).dependencies;
    const http = deps.find(d => d.name === "http")!, lints = deps.find(d => d.name === "flutter_lints")!;
    const project = { id: "p0", dir: "/w", ecosystem: "pub", manager: "pub", tool: "flutter", detectedBy: "pubspec.yaml", manifests: ["pubspec.yaml"], dependencies: deps, warnings: [] } as DetectedProject;
    const outdated = evaluateDependency("pub", http, "1.2.0", { versions: ["1.2.0", "1.2.2", "2.0.0"], latest: "2.0.0" });
    assert.deepStrictEqual([outdated.status, outdated.compatible], ["outdated", "1.2.2"]);
    assert.strictEqual(evaluateDependency("pub", http, "0.13.0", undefined).status, "mismatch");
    const options = dependencyCommands(project, http, outdated);
    assert.deepStrictEqual(options.map(o => [formatCommandLine(o.spec, "linux"), o.runnable]), [["flutter pub get", false], ["flutter pub upgrade http", true], ["flutter pub add 'http:^2.0.0'", false]]);
    const major = evaluateDependency("pub", lints, "5.0.0", { versions: ["5.0.0", "6.0.0"], latest: "6.0.0" });
    const upgrade = dependencyCommands(project, lints, major).find(o => o.kind === "upgrade")!;
    assert.deepStrictEqual([formatCommandLine(upgrade.spec, "linux"), upgrade.runnable], ["flutter pub add 'dev:flutter_lints:^6.0.0'", true]);
    for (const option of [...options, upgrade]) assert.ok(validateCommandSpec(option.spec).ok);
    assert.strictEqual(validateCommandSpec({ tool: "flutter", args: ["pub", "publish"] }).ok, false);
    assert.strictEqual(validateCommandSpec({ tool: "flutter", args: ["pub", "add", "evil:{path: ../x}"] }).ok, false);
    assert.strictEqual(validateCommandSpec({ tool: "dart", args: ["pub", "upgrade", "--major-versions"] }).ok, false);
    assert.strictEqual(validateCommandSpec({ tool: "dart", args: ["run", "x"] }).ok, false);
  });

  test("csproj projects pick up Directory.Packages.props from a parent folder", () => {
    const projects = detectProjects([
      { path: "/w/Directory.Packages.props", text: '<Project><ItemGroup><PackageVersion Include="Serilog" Version="4.0.0" /></ItemGroup></Project>' },
      { path: "/w/src/Api/Api.csproj", text: '<Project><ItemGroup><PackageReference Include="Serilog" /></ItemGroup></Project>' }
    ], "/w", "linux");
    assert.deepStrictEqual(projects.map(p => [p.ecosystem, p.tool, p.manifests, p.dependencies.map(d => d.spec)]), [["nuget", "dotnet", ["Api.csproj", "../../Directory.Packages.props"], ["4.0.0"]]]);
  });
});
