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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const run_unit_tests_1 = require("./run-unit-tests");
const client_1 = require("../../osv/client");
const cli_1 = require("../../osv/maven/cli");
const host_1 = require("../../osv/maven/host");
const index_1 = require("../../osv/maven/index");
const pom_1 = require("../../osv/maven/pom");
const resolver_1 = require("../../osv/maven/resolver");
const tree_1 = require("../../osv/maven/tree");
const scan_1 = require("../../osv/scan");
const cli_2 = require("../../osv/gradle/cli");
const builtin_1 = require("../../osv/gradle/builtin");
const index_2 = require("../../osv/gradle/index");
function deps(list, tag = "dependencies") {
    if (!list || !list.length)
        return "";
    return `<${tag}>${list.map(d => `<dependency><groupId>${d.g}</groupId><artifactId>${d.a}</artifactId>${d.v ? `<version>${d.v}</version>` : ""}${d.type ? `<type>${d.type}</type>` : ""}${d.classifier ? `<classifier>${d.classifier}</classifier>` : ""}${d.scope ? `<scope>${d.scope}</scope>` : ""}${d.optional ? "<optional>true</optional>" : ""}${d.exclusions ? `<exclusions>${d.exclusions.map(e => { const [g, a] = e.split(":"); return `<exclusion><groupId>${g}</groupId><artifactId>${a}</artifactId></exclusion>`; }).join("")}</exclusions>` : ""}</dependency>`).join("")}</${tag}>`;
}
function pom(o) {
    const [pg, pa, pv] = o.parent ? o.parent.split(":") : [];
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  ${o.parent ? `<parent><groupId>${pg}</groupId><artifactId>${pa}</artifactId><version>${pv}</version>${o.relativePath !== undefined ? `<relativePath>${o.relativePath}</relativePath>` : ""}</parent>` : ""}
  ${o.g ? `<groupId>${o.g}</groupId>` : ""}<artifactId>${o.a}</artifactId>${o.v ? `<version>${o.v}</version>` : ""}
  ${o.packaging ? `<packaging>${o.packaging}</packaging>` : ""}
  ${o.props ? `<properties>${Object.entries(o.props).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</properties>` : ""}
  ${o.modules ? `<modules>${o.modules.map(m => `<module>${m}</module>`).join("")}</modules>` : ""}
  ${o.managed ? `<dependencyManagement>${deps(o.managed)}</dependencyManagement>` : ""}
  ${deps(o.deps)}
  ${o.relocation ? `<distributionManagement><relocation>${o.relocation.split(":").map((v, i) => (v ? `<${["groupId", "artifactId", "version"][i]}>${v}</${["groupId", "artifactId", "version"][i]}>` : "")).join("")}</relocation></distributionManagement>` : ""}
</project>`;
}
const BOOT = "org.springframework.boot";
const SPRING = "org.springframework";
/** The miniature repository: coordinates → POM text, plus maven-metadata version lists. */
function springRepository() {
    const poms = new Map();
    const put = (gav, text) => poms.set(gav, text);
    put(`${BOOT}:spring-boot-dependencies:2.6.6`, pom({
        g: BOOT, a: "spring-boot-dependencies", v: "2.6.6", packaging: "pom",
        props: { "tomcat.version": "9.0.60", "snakeyaml.version": "1.29", "jackson-bom.version": "2.13.2.20220328", "spring-framework.version": "5.3.18", "commons-text.version": "1.9" },
        managed: [
            { g: BOOT, a: "spring-boot-starter", v: "2.6.6" }, { g: BOOT, a: "spring-boot-starter-web", v: "2.6.6" },
            { g: BOOT, a: "spring-boot-starter-tomcat", v: "2.6.6" }, { g: BOOT, a: "spring-boot-starter-test", v: "2.6.6" },
            { g: "org.apache.tomcat.embed", a: "tomcat-embed-core", v: "${tomcat.version}" },
            { g: "org.yaml", a: "snakeyaml", v: "${snakeyaml.version}" },
            { g: "org.apache.commons", a: "commons-text", v: "${commons-text.version}" },
            { g: "com.h2database", a: "h2", v: "1.4.200" },
            { g: "com.fasterxml.jackson", a: "jackson-bom", v: "${jackson-bom.version}", type: "pom", scope: "import" },
            { g: SPRING, a: "spring-framework-bom", v: "${spring-framework.version}", type: "pom", scope: "import" }
        ]
    }));
    put(`${BOOT}:spring-boot-starter-parent:2.6.6`, pom({ parent: `${BOOT}:spring-boot-dependencies:2.6.6`, a: "spring-boot-starter-parent", packaging: "pom", props: { "java.version": "1.8" } }));
    put("com.fasterxml.jackson:jackson-bom:2.13.2.20220328", pom({ g: "com.fasterxml.jackson", a: "jackson-bom", v: "2.13.2.20220328", packaging: "pom", managed: [{ g: "com.fasterxml.jackson.core", a: "jackson-databind", v: "2.13.2.2" }, { g: "com.fasterxml.jackson.core", a: "jackson-core", v: "2.13.2" }] }));
    put(`${SPRING}:spring-framework-bom:5.3.18`, pom({ g: SPRING, a: "spring-framework-bom", v: "5.3.18", packaging: "pom", managed: ["spring-core", "spring-web", "spring-webmvc", "spring-jcl", "spring-test"].map(a => ({ g: SPRING, a, v: "5.3.18" })) }));
    put(`${BOOT}:spring-boot-starter-web:2.6.6`, pom({ g: BOOT, a: "spring-boot-starter-web", v: "2.6.6", deps: [
            { g: BOOT, a: "spring-boot-starter", v: "2.6.6" }, { g: BOOT, a: "spring-boot-starter-tomcat", v: "2.6.6" },
            { g: SPRING, a: "spring-webmvc", v: "5.3.18" }, { g: "com.fasterxml.jackson.core", a: "jackson-databind", v: "2.13.2.2" }
        ] }));
    put(`${BOOT}:spring-boot-starter:2.6.6`, pom({ g: BOOT, a: "spring-boot-starter", v: "2.6.6", deps: [{ g: SPRING, a: "spring-core", v: "5.3.18" }, { g: "org.yaml", a: "snakeyaml", v: "1.29", scope: "runtime" }] }));
    put(`${BOOT}:spring-boot-starter-tomcat:2.6.6`, pom({ g: BOOT, a: "spring-boot-starter-tomcat", v: "2.6.6", deps: [{ g: "org.apache.tomcat.embed", a: "tomcat-embed-core", v: "9.0.60" }] }));
    put(`${BOOT}:spring-boot-starter-test:2.6.6`, pom({ g: BOOT, a: "spring-boot-starter-test", v: "2.6.6", deps: [{ g: SPRING, a: "spring-core", v: "5.3.18" }, { g: "junit", a: "junit", v: "4.13.2" }, { g: SPRING, a: "spring-test", v: "5.3.18" }] }));
    put(`${SPRING}:spring-webmvc:5.3.18`, pom({ g: SPRING, a: "spring-webmvc", v: "5.3.18", deps: [{ g: SPRING, a: "spring-web", v: "5.3.18" }, { g: SPRING, a: "spring-core", v: "5.3.18" }, { g: "com.example.opt", a: "optional-thing", v: "1.0", optional: true }, { g: "javax.servlet", a: "servlet-api", v: "2.5", scope: "provided" }] }));
    put(`${SPRING}:spring-web:5.3.18`, pom({ g: SPRING, a: "spring-web", v: "5.3.18", deps: [{ g: SPRING, a: "spring-core", v: "5.3.18" }] }));
    put(`${SPRING}:spring-core:5.3.18`, pom({ g: SPRING, a: "spring-core", v: "5.3.18", deps: [{ g: SPRING, a: "spring-jcl", v: "5.3.18" }] }));
    put(`${SPRING}:spring-jcl:5.3.18`, pom({ g: SPRING, a: "spring-jcl", v: "5.3.18" }));
    put(`${SPRING}:spring-test:5.3.18`, pom({ g: SPRING, a: "spring-test", v: "5.3.18" }));
    put("junit:junit:4.13.2", pom({ g: "junit", a: "junit", v: "4.13.2", deps: [{ g: "org.hamcrest", a: "hamcrest-core", v: "1.3" }] }));
    put("org.hamcrest:hamcrest-core:1.3", pom({ g: "org.hamcrest", a: "hamcrest-core", v: "1.3" }));
    put("com.fasterxml.jackson.core:jackson-databind:2.13.2.2", pom({ g: "com.fasterxml.jackson.core", a: "jackson-databind", v: "2.13.2.2", deps: [{ g: "com.fasterxml.jackson.core", a: "jackson-core", v: "2.13.2" }] }));
    put("com.fasterxml.jackson.core:jackson-core:2.13.2", pom({ g: "com.fasterxml.jackson.core", a: "jackson-core", v: "2.13.2" }));
    for (const v of ["9.0.60", "9.0.62"])
        put(`org.apache.tomcat.embed:tomcat-embed-core:${v}`, pom({ g: "org.apache.tomcat.embed", a: "tomcat-embed-core", v }));
    for (const v of ["1.29", "1.33"])
        put(`org.yaml:snakeyaml:${v}`, pom({ g: "org.yaml", a: "snakeyaml", v }));
    put("org.apache.commons:commons-text:1.9", pom({ g: "org.apache.commons", a: "commons-text", v: "1.9", deps: [{ g: "org.apache.commons", a: "commons-lang3", v: "3.12.0" }] }));
    put("org.apache.commons:commons-lang3:3.12.0", pom({ g: "org.apache.commons", a: "commons-lang3", v: "3.12.0" }));
    put("com.h2database:h2:1.4.200", pom({ g: "com.h2database", a: "h2", v: "1.4.200" }));
    put("mysql:mysql-connector-java:8.0.33", pom({ g: "mysql", a: "mysql-connector-java", v: "8.0.33", relocation: "com.mysql:mysql-connector-j:" }));
    put("com.mysql:mysql-connector-j:8.0.33", pom({ g: "com.mysql", a: "mysql-connector-j", v: "8.0.33" }));
    for (const v of ["3.2.1", "3.2.2"])
        put(`commons-collections:commons-collections:${v}`, pom({ g: "commons-collections", a: "commons-collections", v }));
    const metadata = new Map([["commons-collections:commons-collections", ["3.1", "3.2", "3.2.1", "3.2.2", "20040616"]]]);
    return { poms, metadata };
}
/** A repository over the fixture: everything "remote", with request accounting. */
function fixtureRepository(fixture = springRepository(), options = {}) {
    const requests = [];
    const byPath = new Map([...fixture.poms].map(([gav, text]) => { const [g, a, v] = gav.split(":"); return [(0, resolver_1.pomPath)({ groupId: g, artifactId: a, version: v }), text]; }));
    const repository = (0, resolver_1.createPomRepository)({
        fetchText: async (url) => {
            requests.push(url);
            if (options.delayMs)
                await new Promise(r => setTimeout(r, options.delayMs));
            if (options.failRemote)
                throw new Error("getaddrinfo ENOTFOUND repo.maven.apache.org");
            const rel = url.replace(/^https:\/\/[^/]+\/maven2\//, "").replace(/^https:\/\/[^/]+\//, "");
            if (rel.endsWith("maven-metadata.xml")) {
                const [, g, a] = /^(.+)\/([^/]+)\/maven-metadata\.xml$/.exec(rel);
                const versions = fixture.metadata.get(`${g.replace(/\//g, ".")}:${a}`);
                return versions ? { status: 200, text: `<metadata><versioning><versions>${versions.map(v => `<version>${v}</version>`).join("")}</versions></versioning></metadata>` } : { status: 404, text: "" };
            }
            const text = byPath.get(rel);
            return text ? { status: 200, text } : { status: 404, text: "" };
        }
    });
    return { repository, requests };
}
/** The Spring Boot multi-module workspace the regression tests scan. */
function springWorkspace(extra = {}) {
    return [
        { path: "pom.xml", text: pom({ parent: `${BOOT}:spring-boot-starter-parent:2.6.6`, relativePath: "", g: "com.example", a: "shop", v: "1.0.0", packaging: "pom", modules: ["common", "app"], props: { "java.version": "11", ...(extra.rootProps ?? {}) } }) },
        { path: "common/pom.xml", text: pom({ parent: "com.example:shop:1.0.0", a: "common", deps: [{ g: "org.apache.commons", a: "commons-text" }, { g: "org.yaml", a: "snakeyaml" }] }) },
        { path: "app/pom.xml", text: pom({ parent: "com.example:shop:1.0.0", a: "app", deps: [
                    { g: "com.example", a: "common", v: "${project.version}" },
                    { g: BOOT, a: "spring-boot-starter-web" },
                    { g: "com.h2database", a: "h2", scope: "runtime" },
                    { g: BOOT, a: "spring-boot-starter-test", scope: "test" },
                    ...(extra.appDeps ?? [])
                ] }) }
    ];
}
const coordinates = (list) => Object.fromEntries(list.map(d => [`${d.groupId}:${d.artifactId}`, `${d.version}${d.scope ? `:${d.scope}` : ""}`]));
/* ------------------------------------------------------------------ *
 * POMs and the resolver
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("osv maven: POM model", () => {
    (0, run_unit_tests_1.test)("parses coordinates, parent, properties, dependencies, management, modules, profiles and relocation", () => {
        const raw = (0, pom_1.parsePomXml)(`<?xml version="1.0"?><project xmlns="http://maven.apache.org/POM/4.0.0">
      <parent><groupId>p</groupId><artifactId>parent</artifactId><version>1</version><relativePath/></parent>
      <artifactId>x</artifactId><packaging>jar</packaging>
      <properties><a.version>2.0</a.version></properties>
      <modules><module>m1</module></modules>
      <dependencyManagement><dependencies><dependency><groupId>g</groupId><artifactId>bom</artifactId><version>1</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>
      <dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>\${a.version}</version><classifier>jdk15</classifier><optional>true</optional>
        <exclusions><exclusion><groupId>*</groupId><artifactId>*</artifactId></exclusion></exclusions></dependency></dependencies>
      <profiles><profile><id>p1</id><activation><activeByDefault>true</activeByDefault></activation><properties><b>1</b></properties></profile></profiles>
      <distributionManagement><relocation><groupId>new.g</groupId></relocation></distributionManagement>
    </project>`);
        assert.deepStrictEqual(raw.parent, { groupId: "p", artifactId: "parent", version: "1", relativePath: "" });
        assert.strictEqual(raw.groupId, undefined, "inherited later from the parent");
        assert.deepStrictEqual(raw.dependencies[0], { groupId: "g", artifactId: "a", version: "${a.version}", type: "jar", classifier: "jdk15", scope: undefined, optional: true, exclusions: [{ groupId: "*", artifactId: "*" }] });
        assert.strictEqual(raw.managed[0].scope, "import");
        assert.deepStrictEqual([raw.modules, raw.profiles[0].activeByDefault, raw.relocation?.groupId], [["m1"], true, "new.g"]);
        assert.throws(() => (0, pom_1.parsePomXml)("<project><artifactId>x</artifactId>"), pom_1.PomError, "malformed XML");
        assert.throws(() => (0, pom_1.parsePomXml)("<settings/>"), /not <project>/);
        assert.throws(() => (0, pom_1.parsePomXml)("<project><parent><groupId>g</groupId></parent><artifactId>x</artifactId></project>"), /parent/);
    });
    (0, run_unit_tests_1.test)("interpolation, ranges and Maven's scope table", () => {
        assert.strictEqual((0, resolver_1.interpolate)("${a}-${b}", { a: "${b}.x", b: "1" }), "1.x-1");
        assert.strictEqual((0, resolver_1.interpolate)("${missing}", {}), "${missing}", "undefined properties stay visible, never guessed");
        assert.ok((0, resolver_1.isVersionRange)("[1.0,2.0)") && (0, resolver_1.isVersionRange)("(,1.0]") && !(0, resolver_1.isVersionRange)("1.0.0"));
        assert.strictEqual((0, resolver_1.transitiveScope)("compile", "compile"), "compile");
        assert.strictEqual((0, resolver_1.transitiveScope)("compile", "runtime"), "runtime");
        assert.strictEqual((0, resolver_1.transitiveScope)("runtime", "compile"), "runtime");
        assert.strictEqual((0, resolver_1.transitiveScope)("test", "compile"), "test");
        assert.strictEqual((0, resolver_1.transitiveScope)("provided", "runtime"), "provided");
        for (const scope of ["test", "provided", "system"])
            assert.strictEqual((0, resolver_1.transitiveScope)("compile", scope), undefined, `${scope} is not transitive`);
    });
});
(0, run_unit_tests_1.suite)("osv maven: built-in resolver (Spring Boot)", () => {
    (0, run_unit_tests_1.test)("a Spring Boot multi-module project resolves starters, BOM-managed and transitive dependencies", async () => {
        const { repository } = fixtureRepository();
        const resolver = new resolver_1.MavenResolver(springWorkspace(), repository);
        assert.deepStrictEqual(resolver.reactorRoots(), ["pom.xml"]);
        assert.deepStrictEqual(resolver.reactorModules("pom.xml"), ["pom.xml", "common/pom.xml", "app/pom.xml"]);
        const app = await resolver.resolveModule("app/pom.xml");
        assert.deepStrictEqual(app.unresolved, []);
        const external = app.dependencies.filter(d => !d.internal);
        assert.deepStrictEqual(coordinates(external), {
            "org.apache.commons:commons-text": "1.9:compile",
            "org.yaml:snakeyaml": "1.29:compile",
            "org.springframework.boot:spring-boot-starter-web": "2.6.6:compile",
            "com.h2database:h2": "1.4.200:runtime",
            "org.springframework.boot:spring-boot-starter-test": "2.6.6:test",
            "org.apache.commons:commons-lang3": "3.12.0:compile",
            "org.springframework.boot:spring-boot-starter": "2.6.6:compile",
            "org.springframework.boot:spring-boot-starter-tomcat": "2.6.6:compile",
            "org.springframework:spring-webmvc": "5.3.18:compile",
            "com.fasterxml.jackson.core:jackson-databind": "2.13.2.2:compile",
            "org.springframework:spring-core": "5.3.18:compile",
            "junit:junit": "4.13.2:test",
            "org.springframework:spring-test": "5.3.18:test",
            "org.apache.tomcat.embed:tomcat-embed-core": "9.0.60:compile",
            "org.springframework:spring-web": "5.3.18:compile",
            "com.fasterxml.jackson.core:jackson-core": "2.13.2:compile",
            "org.springframework:spring-jcl": "5.3.18:compile",
            "org.hamcrest:hamcrest-core": "1.3:test"
        });
        assert.ok(!external.some(d => d.artifactId === "optional-thing"), "optional dependencies of dependencies are left out");
        assert.ok(!external.some(d => d.artifactId === "servlet-api"), "provided dependencies of dependencies are not transitive");
        assert.ok(app.dependencies.find(d => d.artifactId === "common").internal, "the reactor module is your own code");
        const tomcat = external.find(d => d.artifactId === "tomcat-embed-core");
        assert.deepStrictEqual([tomcat.depth, tomcat.via], [3, ["org.springframework.boot:spring-boot-starter-web:2.6.6", "org.springframework.boot:spring-boot-starter-tomcat:2.6.6"]]);
        const jcl = external.find(d => d.artifactId === "spring-jcl");
        assert.strictEqual(jcl.scope, "compile", "spring-core reached first through the test starter is widened to compile, and so are its dependencies");
    });
    (0, run_unit_tests_1.test)("property overrides in your POM change versions the Spring Boot BOM manages, transitively too", async () => {
        const { repository } = fixtureRepository();
        const resolver = new resolver_1.MavenResolver(springWorkspace({ rootProps: { "tomcat.version": "9.0.62", "snakeyaml.version": "1.33" } }), repository);
        const app = await resolver.resolveModule("app/pom.xml");
        const found = coordinates(app.dependencies);
        assert.strictEqual(found["org.apache.tomcat.embed:tomcat-embed-core"], "9.0.62:compile", "the root's dependency management overrides spring-boot-starter-tomcat's 9.0.60");
        assert.strictEqual(found["org.yaml:snakeyaml"], "1.33:compile");
    });
    (0, run_unit_tests_1.test)("exclusions, relocations, classifiers and version ranges", async () => {
        const { repository } = fixtureRepository();
        const resolver = new resolver_1.MavenResolver(springWorkspace({ appDeps: [
                { g: "mysql", a: "mysql-connector-java", v: "8.0.33" },
                { g: "commons-collections", a: "commons-collections", v: "[3.2,3.2.2]" }
            ] }).map(file => (file.path === "app/pom.xml" ? { ...file, text: file.text.replace("<artifactId>spring-boot-starter-web</artifactId>", "<artifactId>spring-boot-starter-web</artifactId><exclusions><exclusion><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-tomcat</artifactId></exclusion></exclusions>") } : file)), repository);
        const app = await resolver.resolveModule("app/pom.xml");
        const found = coordinates(app.dependencies);
        assert.strictEqual(found["org.apache.tomcat.embed:tomcat-embed-core"], undefined, "the excluded starter and everything below it are gone");
        assert.strictEqual(found["com.mysql:mysql-connector-j"], "8.0.33:compile", "relocated to the artifact that is actually used");
        assert.strictEqual(found["commons-collections:commons-collections"], "3.2.2:compile", "a range resolves to the highest published version inside it");
        assert.ok(app.problems.some(p => /relocated/.test(p)) && app.problems.some(p => /highest published version/.test(p)));
    });
    (0, run_unit_tests_1.test)("unresolvable versions and missing POMs are reported, never guessed", async () => {
        const { repository } = fixtureRepository();
        const workspace = springWorkspace({ appDeps: [
                { g: "com.acme.private", a: "internal-sdk", v: "2.0" },
                { g: "org.unmanaged", a: "nothing-manages-me" },
                { g: "org.prop", a: "needs-prop", v: "${undefined.version}" }
            ] });
        const resolver = new resolver_1.MavenResolver(workspace, repository);
        const app = await resolver.resolveModule("app/pom.xml");
        const reasons = Object.fromEntries(app.unresolved.map(u => [u.artifactId, u.reason]));
        assert.match(reasons["nothing-manages-me"], /No version is declared or managed/);
        assert.match(reasons["needs-prop"], /\$\{undefined\.version\} uses a property that is not defined/);
        assert.ok(app.dependencies.some(d => d.artifactId === "internal-sdk" && d.version === "2.0"), "a private artifact's version is still known and checked");
        assert.ok(app.problems.some(p => /internal-sdk:2\.0 are unknown/.test(p)), "but its own dependencies are reported as unknown");
    });
    (0, run_unit_tests_1.test)("a parent POM that cannot be found is a reported problem, and the scan continues", async () => {
        const { repository } = fixtureRepository(springRepository(), { failRemote: true });
        const resolver = new resolver_1.MavenResolver(springWorkspace(), repository);
        const app = await resolver.resolveModule("app/pom.xml");
        assert.ok(app.problems.some(p => /spring-boot-starter-parent:2\.6\.6 could not be loaded: It could not be downloaded \(.*ENOTFOUND/.test(p)));
        assert.ok(app.unresolved.some(u => u.artifactId === "spring-boot-starter-web"), "without the parent, managed versions are unknown, and say so");
    });
    (0, run_unit_tests_1.test)("CI-friendly ${revision} versions and inter-module dependencies", async () => {
        const { repository } = fixtureRepository();
        const resolver = new resolver_1.MavenResolver([
            { path: "pom.xml", text: pom({ g: "org.acme", a: "platform", v: "${revision}", packaging: "pom", modules: ["model", "service"], props: { revision: "2.4.0" } }) },
            { path: "model/pom.xml", text: pom({ parent: "org.acme:platform:${revision}", a: "model", deps: [{ g: "org.apache.commons", a: "commons-text", v: "1.9" }] }) },
            { path: "service/pom.xml", text: pom({ parent: "org.acme:platform:${revision}", a: "service", deps: [{ g: "org.acme", a: "model", v: "${project.version}" }] }) }
        ], repository);
        assert.deepStrictEqual(resolver.workspaceGav("model/pom.xml"), { groupId: "org.acme", artifactId: "model", version: "2.4.0" });
        const service = await resolver.resolveModule("service/pom.xml");
        assert.deepStrictEqual(coordinates(service.dependencies.filter(d => !d.internal)), { "org.apache.commons:commons-text": "1.9:compile", "org.apache.commons:commons-lang3": "3.12.0:compile" }, "the sibling module's dependencies are transitive");
    });
    (0, run_unit_tests_1.test)("POMs are fetched once, local repository first, with bounded concurrency", async () => {
        const fixture = springRepository();
        let active = 0, peak = 0;
        const fetched = [];
        const local = new Map([[(0, resolver_1.pomPath)({ groupId: "junit", artifactId: "junit", version: "4.13.2" }), fixture.poms.get("junit:junit:4.13.2")]]);
        const repository = (0, resolver_1.createPomRepository)({
            readLocal: async (rel) => local.get(rel),
            fetchText: async (url) => {
                active++;
                peak = Math.max(peak, active);
                fetched.push(url);
                await new Promise(r => setTimeout(r, 3));
                active--;
                const rel = url.replace("https://repo.maven.apache.org/maven2/", "");
                const entry = [...fixture.poms].find(([gav]) => { const [g, a, v] = gav.split(":"); return (0, resolver_1.pomPath)({ groupId: g, artifactId: a, version: v }) === rel; });
                return entry ? { status: 200, text: entry[1] } : { status: 404, text: "" };
            },
            concurrency: 3
        });
        const resolver = new resolver_1.MavenResolver(springWorkspace(), repository);
        for (const module of resolver.reactorModules("pom.xml"))
            await resolver.resolveModule(module);
        assert.ok(peak <= 3, `at most 3 downloads at once (saw ${peak})`);
        assert.strictEqual(new Set(fetched).size, fetched.length, "no POM is downloaded twice");
        assert.ok(!fetched.some(url => url.includes("junit/junit/4.13.2")), "the local repository wins");
        const bad = await repository.fetch({ groupId: "../../etc", artifactId: "passwd", version: "1" }, ["https://repo.maven.apache.org/maven2"]);
        assert.ok("error" in bad, "coordinates that are not plain names never become paths or URLs");
    });
    (0, run_unit_tests_1.test)("a large dependency graph resolves quickly", async () => {
        const poms = new Map();
        const width = 40, depth = 25; // 1,000 artifacts, each depending on the next layer
        for (let layer = 0; layer < depth; layer++) {
            for (let i = 0; i < width; i++) {
                poms.set(`big:l${layer}a${i}:1.0`, pom({ g: "big", a: `l${layer}a${i}`, v: "1.0", deps: layer + 1 < depth ? [{ g: "big", a: `l${layer + 1}a${i}`, v: "1.0" }, { g: "big", a: `l${layer + 1}a${(i + 1) % width}`, v: "1.0" }] : [] }));
            }
        }
        const repository = (0, resolver_1.createPomRepository)({ readLocal: async (rel) => { const [, a] = /big\/([^/]+)\//.exec(rel) ?? []; return a ? poms.get(`big:${a}:1.0`) : undefined; } });
        const resolver = new resolver_1.MavenResolver([{ path: "pom.xml", text: pom({ g: "x", a: "root", v: "1", deps: Array.from({ length: width }, (_, i) => ({ g: "big", a: `l0a${i}`, v: "1.0" })) }) }], repository);
        const started = Date.now();
        const result = await resolver.resolveModule("pom.xml");
        assert.strictEqual(result.dependencies.length, width * depth);
        assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
    });
});
/* ------------------------------------------------------------------ *
 * The Maven CLI
 * ------------------------------------------------------------------ */
/** Real `mvn dependency:tree -DoutputType=text -DappendOutput=true` output (Maven 3.8.8, plugin 3.6.1). */
const REAL_TREE = `com.example:shop:pom:1.0.0
com.example:common:jar:1.0.0
+- org.apache.commons:commons-text:jar:1.9:compile
|  \\- org.apache.commons:commons-lang3:jar:3.12.0:compile
+- com.fasterxml.jackson.core:jackson-databind:jar:2.13.2.2:compile
|  +- com.fasterxml.jackson.core:jackson-annotations:jar:2.13.2:compile
|  \\- com.fasterxml.jackson.core:jackson-core:jar:2.13.2:compile
\\- org.yaml:snakeyaml:jar:1.29:compile
com.example:app:jar:1.0.0
+- com.example:common:jar:1.0.0:compile
|  +- org.apache.commons:commons-text:jar:1.9:compile
|  |  \\- org.apache.commons:commons-lang3:jar:3.12.0:compile
|  \\- org.yaml:snakeyaml:jar:1.29:compile
+- org.springframework.boot:spring-boot-starter-web:jar:2.6.6:compile
|  +- org.springframework.boot:spring-boot-starter-tomcat:jar:2.6.6:compile
|  |  \\- org.apache.tomcat.embed:tomcat-embed-core:jar:9.0.60:compile
|  \\- org.springframework:spring-webmvc:jar:5.3.18:compile
+- com.h2database:h2:jar:1.4.200:runtime
+- net.sf.json-lib:json-lib:jar:jdk15:2.4:compile
+- org.postgresql:postgresql:jar:42.3.3:compile (optional)
\\- org.springframework.boot:spring-boot-starter-test:jar:2.6.6:test
`;
(0, run_unit_tests_1.suite)("osv maven: Maven CLI", () => {
    (0, run_unit_tests_1.test)("dependency:tree output: modules, depth, paths, scopes, classifiers and annotations", () => {
        const modules = (0, tree_1.parseDependencyTree)(REAL_TREE);
        assert.deepStrictEqual(modules.map(m => `${m.artifactId}:${m.packaging}:${m.nodes.length}`), ["shop:pom:0", "common:jar:6", "app:jar:12"]);
        const app = modules[2];
        const tomcat = app.nodes.find(n => n.artifactId === "tomcat-embed-core");
        assert.deepStrictEqual([tomcat.depth, tomcat.version, tomcat.scope, tomcat.via], [3, "9.0.60", "compile", ["org.springframework.boot:spring-boot-starter-web:2.6.6", "org.springframework.boot:spring-boot-starter-tomcat:2.6.6"]]);
        const jsonLib = app.nodes.find(n => n.artifactId === "json-lib");
        assert.deepStrictEqual([jsonLib.classifier, jsonLib.version, jsonLib.depth], ["jdk15", "2.4", 1]);
        assert.strictEqual(app.nodes.find(n => n.artifactId === "postgresql").optional, true);
        assert.strictEqual(app.nodes.find(n => n.artifactId === "spring-webmvc").via.length, 1, "a sibling after a deeper branch has the right parent");
        assert.deepStrictEqual((0, tree_1.parseCoordinate)("g:a:jar:1.0:compile (version managed from 0.9)"), { groupId: "g", artifactId: "a", type: "jar", version: "1.0", scope: "compile", optional: false });
        assert.strictEqual((0, tree_1.parseCoordinate)("not a coordinate"), undefined);
        assert.strictEqual((0, tree_1.parseDependencyTree)("[INFO] g:a:jar:1\n[INFO] \\- x:y:jar:2:compile")[0].nodes[0].artifactId, "y", "log prefixes are tolerated");
    });
    (0, run_unit_tests_1.test)("Maven is run read-only through the pinned dependency plugin, wrapper first", () => {
        const args = (0, cli_1.treeArguments)("/tmp/out.txt");
        assert.ok(args.includes(cli_1.DEPENDENCY_PLUGIN) && cli_1.DEPENDENCY_PLUGIN.endsWith(":3.6.1:tree"));
        assert.ok(args.includes("-DoutputFile=/tmp/out.txt") && args.includes("-B"));
        assert.ok(!args.some(a => /install|deploy|package|compile|clean/.test(a)), "no lifecycle phase that builds or writes");
        const files = new Set(["/ws/mvnw", "/usr/bin/mvn"]);
        assert.deepStrictEqual((0, cli_1.findMavenExecutable)("/ws/app", "/ws", "linux", { PATH: "/usr/bin" }, f => files.has(f)), { command: "/ws/mvnw", kind: "wrapper", label: "./mvnw" });
        files.delete("/ws/mvnw");
        assert.deepStrictEqual((0, cli_1.findMavenExecutable)("/ws/app", "/ws", "linux", { PATH: "/usr/bin" }, f => files.has(f)), { command: "/usr/bin/mvn", kind: "path", label: "mvn" });
        assert.strictEqual((0, cli_1.findMavenExecutable)("/ws/app", "/ws", "linux", { PATH: "" }, () => false), undefined, "Maven unavailable");
        assert.ok(!(0, cli_1.findMavenExecutable)("/ws/app", "/ws", "linux", { PATH: "" }, f => f === "/mvnw"), "a wrapper outside the workspace is never used");
        assert.strictEqual((0, cli_1.sanitizeOutput)("Could not transfer from https://bob:hunter2@repo.example/x token=abc123"), "Could not transfer from https://***:***@repo.example/x token=***");
    });
    (0, run_unit_tests_1.test)("the local repository follows settings.xml", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-m2-"));
        try {
            assert.strictEqual((0, host_1.localRepository)(home), path.join(home, ".m2", "repository"));
            fs.mkdirSync(path.join(home, ".m2"));
            fs.writeFileSync(path.join(home, ".m2", "settings.xml"), "<settings><!-- <localRepository>/wrong</localRepository> --><localRepository>${user.home}/repo</localRepository></settings>");
            assert.strictEqual((0, host_1.localRepository)(home), `${home}/repo`);
        }
        finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
/** A fake OSV with querybatch pagination, /v1/query, /v1/vulns and switchable failures. */
function fakeOsv(advisories, options = {}) {
    const stats = { batches: 0, singles: 0, pages: 0 };
    const respond = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    const answer = (q) => {
        const hits = advisories.filter(a => a.hits.some(h => h.name === q.package.name && (q.version === undefined || h.versions.includes(q.version))));
        const size = options.pageSize ?? Infinity;
        const start = q.page_token ? Number(q.page_token) : 0;
        if (start)
            stats.pages++;
        const page = hits.slice(start, start + size);
        return { ...(page.length ? { vulns: page.map(h => ({ id: h.record.id, modified: h.record.modified })) } : {}), ...(start + size < hits.length ? { next_page_token: String(start + size) } : {}) };
    };
    const fetch = async (url, init) => {
        if (url.endsWith("/v1/querybatch")) {
            stats.batches++;
            const { queries } = JSON.parse(init.body);
            if (options.failBatchesWith && queries.some((q) => q.package.name === options.failBatchesWith))
                return respond(500, { message: "internal error" });
            return respond(200, { results: queries.map(answer) });
        }
        if (url.endsWith("/v1/query")) {
            stats.singles++;
            return respond(200, answer(JSON.parse(init.body)));
        }
        const id = decodeURIComponent(url.split("/v1/vulns/")[1] ?? "");
        if (options.failRecords?.includes(id))
            return respond(503, { message: "busy" });
        const found = advisories.find(a => a.record.id === id);
        return found ? respond(200, found.record) : respond(404, { code: 5 });
    };
    return { fetch, stats };
}
const range = (name, introduced, fixed) => ({ package: { name, ecosystem: "Maven" }, ranges: [{ type: "ECOSYSTEM", events: (fixed ? [{ introduced }, { fixed }] : [{ introduced }]) }] });
const ADVISORIES = [
    // Two different advisories for the same transitive package (Tomcat via spring-boot-starter-web).
    { record: { id: "GHSA-tom1-0000-0001", modified: "1", summary: "Tomcat request smuggling", aliases: ["CVE-2022-0001"], database_specific: { severity: "HIGH" }, affected: [range("org.apache.tomcat.embed:tomcat-embed-core", "9.0.0", "9.0.62")] }, hits: [{ name: "org.apache.tomcat.embed:tomcat-embed-core", versions: ["9.0.60"] }] },
    { record: { id: "GHSA-tom2-0000-0002", modified: "1", summary: "Tomcat DoS", aliases: ["CVE-2022-0002"], severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" }], affected: [range("org.apache.tomcat.embed:tomcat-embed-core", "9.0.0", "9.0.69")] }, hits: [{ name: "org.apache.tomcat.embed:tomcat-embed-core", versions: ["9.0.60", "9.0.62"] }] },
    // One advisory affecting two packages (Spring4Shell-style): two findings, one unique vulnerability.
    { record: { id: "GHSA-sp4s-0000-0003", modified: "1", summary: "RCE via data binding", aliases: ["CVE-2022-22965"], database_specific: { severity: "CRITICAL" }, affected: [range("org.springframework:spring-webmvc", "5.3.0", "5.3.19"), range("org.springframework:spring-core", "5.3.0", "5.3.19")] }, hits: [{ name: "org.springframework:spring-webmvc", versions: ["5.3.18"] }, { name: "org.springframework:spring-core", versions: ["5.3.18"] }] },
    // Unknown severity and no fixed version (direct dependency, BOM-managed version).
    { record: { id: "OSV-h2-0000-0004", modified: "1", summary: "H2 console issue", affected: [range("com.h2database:h2", "0")] }, hits: [{ name: "com.h2database:h2", versions: ["1.4.200"] }] },
    // A vulnerability in a property-managed version, in a different module.
    { record: { id: "GHSA-snak-0000-0005", modified: "1", summary: "SnakeYAML DoS", database_specific: { severity: "MODERATE" }, affected: [range("org.yaml:snakeyaml", "0", "1.31")] }, hits: [{ name: "org.yaml:snakeyaml", versions: ["1.29"] }] }
];
function scanOptions(fetch, strategy, extra = {}) {
    return {
        client: new client_1.OsvClient({ fetch, sleep: async () => undefined, retries: 1 }),
        cache: new client_1.OsvCache(), workspace: { name: "shop", folders: ["shop"] }, source: "workspace", toolVersion: "test",
        resolveMaven: (poms, signal) => (0, index_1.resolveMavenProjects)(poms, strategy, { signal }),
        ...extra
    };
}
(0, run_unit_tests_1.suite)("osv maven: scanning Spring Boot projects", () => {
    const files = () => springWorkspace();
    (0, run_unit_tests_1.test)("transitive, BOM-managed and multi-module dependencies are all checked, with paths", async () => {
        const { repository } = fixtureRepository();
        const osv = fakeOsv(ADVISORIES);
        const logs = [];
        const result = await (0, scan_1.runScan)(files(), scanOptions(osv.fetch, { repository, repositoryLabel: "fixture" }, { onLog: m => logs.push(m) }));
        assert.strictEqual(result.status, "complete");
        const found = result.findings.map(f => `${f.packageName.split(":")[1]}@${f.installedVersion} ${f.id}`).sort();
        assert.deepStrictEqual(found, [
            "h2@1.4.200 OSV-h2-0000-0004",
            "snakeyaml@1.29 GHSA-snak-0000-0005",
            "spring-core@5.3.18 GHSA-sp4s-0000-0003",
            "spring-webmvc@5.3.18 GHSA-sp4s-0000-0003",
            "tomcat-embed-core@9.0.60 GHSA-tom1-0000-0001",
            "tomcat-embed-core@9.0.60 GHSA-tom2-0000-0002"
        ], "every applicable advisory, including two for one package and one shared by two packages");
        const s = result.summary;
        assert.deepStrictEqual([s.findings, s.uniqueVulnerabilities, s.packages, s.analyzedPackages, s.unresolvedPackages, s.failedPackages], [6, 5, 18, 18, 0, 0]);
        assert.strictEqual(s.critical + s.high + s.medium + s.low + s.unknown, s.findings, "severity counts add up to the findings shown");
        const tomcat = result.packages.find(p => p.name.endsWith("tomcat-embed-core"));
        assert.strictEqual(tomcat.direct, false);
        assert.deepStrictEqual(tomcat.occurrences.map(o => [o.file, o.via?.map(v => v.split(":")[1])]), [["app/pom.xml", ["spring-boot-starter-web", "spring-boot-starter-tomcat"]]]);
        const h2 = result.findings.find(f => f.id === "OSV-h2-0000-0004");
        assert.deepStrictEqual([h2.severity, h2.noFix, h2.fixedIn], ["unknown", true, undefined], "unknown severity and no fix are shown, not filtered");
        assert.ok(result.packages.find(p => p.name === "com.h2database:h2").direct, "a direct dependency whose version comes from the BOM");
        const snake = result.packages.find(p => p.name === "org.yaml:snakeyaml");
        assert.deepStrictEqual(snake.occurrences.map(o => o.file).sort(), ["app/pom.xml", "common/pom.xml"], "one package, found through two modules");
        assert.ok(result.files.every(f => /DevSnip Pro's Maven resolver/.test(f.resolvedBy ?? "")));
        assert.deepStrictEqual(result.diagnostics.buildTools.map(m => [m.project, m.method, m.modules, m.unresolved]), [["pom.xml", "builtin", 3, 0]]);
        assert.ok(logs.some(l => /Packages: 18 discovered, 18 analysed/.test(l)) && logs.some(l => /Findings: 6 \(5 unique advisories\)/.test(l)));
    });
    (0, run_unit_tests_1.test)("Maven's own tree is used when Maven runs, and the built-in resolver takes over when it fails", async () => {
        const { repository } = fixtureRepository();
        const osv = fakeOsv(ADVISORIES);
        const cliRuns = [];
        const viaMaven = await (0, scan_1.runScan)(files(), scanOptions(osv.fetch, {
            repository, repositoryLabel: "fixture", cliLabel: "./mvnw",
            runCli: async (root) => { cliRuns.push(root); return { trees: (0, tree_1.parseDependencyTree)(REAL_TREE), exitCode: 0, output: "", timedOut: false, cancelled: false }; }
        }));
        assert.deepStrictEqual(cliRuns, ["pom.xml"], "one Maven run per reactor");
        assert.ok(viaMaven.files.filter(f => f.path !== "pom.xml").every(f => f.resolvedBy === "Maven (./mvnw dependency:tree)"));
        assert.ok(viaMaven.packages.some(p => p.name === "net.sf.json-lib:json-lib" && p.version === "2.4"), "Maven's tree is authoritative");
        assert.ok(viaMaven.packages.some(p => p.name === "org.postgresql:postgresql" && p.occurrences[0].scope === "optional"));
        assert.ok(!viaMaven.packages.some(p => p.name === "com.example:common"), "reactor modules are not scanned as dependencies");
        const failed = await (0, scan_1.runScan)(files(), scanOptions(osv.fetch, {
            repository, repositoryLabel: "fixture", cliLabel: "mvn",
            runCli: async () => ({ trees: [], exitCode: 1, output: "[ERROR] Could not resolve dependencies for project com.example:app", timedOut: false, cancelled: false })
        }));
        assert.deepStrictEqual(failed.diagnostics.buildTools.map(m => m.method), ["builtin"]);
        assert.match(failed.diagnostics.buildTools[0].detail, /mvn exited with code 1; 3 modules were resolved by the built-in resolver instead\.\n\[ERROR\] Could not resolve/);
        assert.ok(failed.errors.some(e => /Maven project pom\.xml: mvn exited with code 1/.test(e)), "the Maven failure is reported");
        assert.strictEqual(failed.findings.length, 6, "and no finding is lost");
        const missing = await (0, scan_1.runScan)(files(), scanOptions(osv.fetch, { repository, repositoryLabel: "fixture", cliLabel: "mvn", runCli: async () => ({ error: "spawn mvn ENOENT" }) }));
        assert.strictEqual(missing.findings.length, 6, "Maven not installed: the built-in resolver still finds everything");
    });
    (0, run_unit_tests_1.test)("an unresolved version makes the scan incomplete instead of clean", async () => {
        const { repository } = fixtureRepository();
        const osv = fakeOsv([]);
        const result = await (0, scan_1.runScan)(springWorkspace({ appDeps: [{ g: "org.unmanaged", a: "nothing-manages-me" }] }), scanOptions(osv.fetch, { repository, repositoryLabel: "fixture" }));
        assert.strictEqual(result.findings.length, 0);
        assert.strictEqual(result.status, "incomplete", "no findings, but not a clean bill of health");
        assert.strictEqual(result.summary.unresolvedPackages, 1);
        const pkg = result.packages.find(p => p.name === "org.unmanaged:nothing-manages-me");
        assert.deepStrictEqual([pkg.status, pkg.skipReason], ["unanalyzed", "unresolved"]);
        assert.match(pkg.note, /No version is declared or managed/);
        assert.ok(result.limitations.some(l => /1 dependency's version could not be determined/.test(l)));
    });
    (0, run_unit_tests_1.test)("Maven Central unreachable: managed versions are unresolved and say why; nothing is silently empty", async () => {
        const { repository } = fixtureRepository(springRepository(), { failRemote: true });
        const result = await (0, scan_1.runScan)(files(), scanOptions(fakeOsv(ADVISORIES).fetch, { repository, repositoryLabel: "fixture" }));
        assert.strictEqual(result.status, "incomplete");
        assert.ok(result.summary.unresolvedPackages >= 4);
        assert.ok(result.files.some(f => f.warnings.some(w => /spring-boot-starter-parent:2\.6\.6 could not be loaded/.test(w))));
    });
    (0, run_unit_tests_1.test)("OSV pagination, partial batch failures and failed record lookups lose nothing", async () => {
        const { repository } = fixtureRepository();
        const osv = fakeOsv(ADVISORIES, { pageSize: 1, failBatchesWith: "org.yaml:snakeyaml", failRecords: ["GHSA-tom2-0000-0002"] });
        const result = await (0, scan_1.runScan)(files(), scanOptions(osv.fetch, { repository, repositoryLabel: "fixture" }));
        assert.ok(osv.stats.pages > 0, "page tokens were followed");
        assert.ok(osv.stats.singles > 0, "the failing batch fell back to single queries");
        assert.strictEqual(result.findings.length, 6, "every finding is still there");
        const lost = result.findings.find(f => f.id === "GHSA-tom2-0000-0002");
        assert.deepStrictEqual([lost.detailsAvailable, lost.severity, lost.noFix], [false, "unknown", false], "a failed lookup is unknown, not 'no fix'");
        assert.strictEqual(result.status, "incomplete", "a record that could not be loaded is reported");
        assert.ok(result.diagnostics.recordsFailed === 1 && result.diagnostics.pagesFollowed > 0 && result.diagnostics.fallbackQueries > 0);
    });
    (0, run_unit_tests_1.test)("network errors and slow responses: everything fails at once or recovers, never an empty 'clean' result", async () => {
        const { repository } = fixtureRepository();
        const offline = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
        let calls = 0;
        const counting = (url, init) => { calls++; return offline(url, init); };
        const result = await (0, scan_1.runScan)(files(), scanOptions(counting, { repository, repositoryLabel: "fixture" }));
        assert.strictEqual(result.summary.failedPackages, result.summary.packages);
        assert.strictEqual(result.summary.analyzedPackages, 0);
        assert.strictEqual(result.status, "incomplete");
        assert.ok(calls <= 4, `an unreachable OSV is not asked once per package (${calls} calls)`);
        const advisories = fakeOsv(ADVISORIES);
        let first = true;
        const slowOnce = (url, init) => {
            if (first && url.endsWith("/v1/querybatch")) {
                first = false;
                return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
            }
            return advisories.fetch(url, init);
        };
        const recovered = await (0, scan_1.runScan)(files(), { ...scanOptions(slowOnce, { repository, repositoryLabel: "fixture" }), client: new client_1.OsvClient({ fetch: slowOnce, sleep: async () => undefined, retries: 0, timeoutMs: 30 }) });
        assert.strictEqual(recovered.findings.length, 6, "a batch that timed out is retried as smaller requests");
    });
    (0, run_unit_tests_1.test)("the upgrade for a Guava-style flavoured version keeps its flavour", () => {
        assert.strictEqual((0, scan_1.alignFlavour)("30.1-jre", "32.0.0-android"), "32.0.0-jre");
        assert.strictEqual((0, scan_1.alignFlavour)("31.0-android", "32.0.0-android"), "32.0.0-android");
        assert.strictEqual((0, scan_1.alignFlavour)("9.4.47.v20220610", "9.4.48.v20220622"), "9.4.48.v20220622", "Jetty build stamps are part of the version");
    });
});
/* ------------------------------------------------------------------ *
 * The real OSV API (opt-in: DEVSNIP_TEST_OSV_LIVE=1)
 * ------------------------------------------------------------------ */
(0, run_unit_tests_1.suite)("osv maven: live OSV.dev (opt-in)", () => {
    (0, run_unit_tests_1.test)("documented advisories are returned for known vulnerable Maven versions", async () => {
        if (process.env.DEVSNIP_TEST_OSV_LIVE !== "1")
            return; // network test, run on demand
        const client = new client_1.OsvClient();
        const outcomes = await client.queryAll([
            { package: { name: "org.apache.logging.log4j:log4j-core", ecosystem: "Maven" }, version: "2.14.1" },
            { package: { name: "org.springframework:spring-beans", ecosystem: "Maven" }, version: "5.3.17" },
            { package: { name: "org.apache.logging.log4j:log4j-core", ecosystem: "Maven" }, version: "2.17.1" }
        ]);
        const ids = outcomes.map(o => (Array.isArray(o) ? o.map(v => v.id) : []));
        assert.ok(ids[0].includes("GHSA-jfh8-c2jp-5v3q"), "Log4Shell (CVE-2021-44228) for log4j-core 2.14.1");
        assert.ok(ids[1].includes("GHSA-36p3-wjmg-h94x"), "Spring4Shell (CVE-2022-22965) for spring-beans 5.3.17");
        assert.ok(!ids[2].includes("GHSA-jfh8-c2jp-5v3q"), "the fixed version is not flagged for it");
        const record = await client.getVulnerability("GHSA-jfh8-c2jp-5v3q");
        assert.ok(record?.aliases?.includes("CVE-2021-44228"));
    });
});
/* ------------------------------------------------------------------ *
 * Gradle
 * ------------------------------------------------------------------ */
/** Lines printed by the init-script task in a real Gradle 8.10.2 run (Spring Boot 2.7.0 multi-project build), shortened. */
const REAL_GRADLE_OUTPUT = [
    "> Task :app:devsnipOsvDependencies",
    'DEVSNIP-OSV {"project": ":app", "dir": "/ws/app", "configuration": "runtimeClasspath", "nodes": [{"group": "org.springframework.boot", "name": "spring-boot-starter-web", "version": "2.7.0", "depth": 1, "via": []}, {"group": "com.google.guava", "name": "guava", "version": "30.1-jre", "depth": 1, "via": []}, {"group": "com.h2database", "name": "h2", "version": "2.1.212", "depth": 1, "via": []}, {"group": "org.yaml", "name": "snakeyaml", "version": "1.30", "depth": 2, "via": [":lib"]}, {"group": "org.springframework.boot", "name": "spring-boot-starter", "version": "2.7.0", "depth": 2, "via": ["org.springframework.boot:spring-boot-starter-web:2.7.0"]}, {"group": "org.apache.tomcat.embed", "name": "tomcat-embed-core", "version": "9.0.63", "depth": 3, "via": ["org.springframework.boot:spring-boot-starter-web:2.7.0", "org.springframework.boot:spring-boot-starter-tomcat:2.7.0"]}], "unresolved": [{"requested": "org.apache.commons:commons-text", "reason": "Could not find org.apache.commons:commons-text:.", "depth": 2, "via": [":lib"]}]}',
    'DEVSNIP-OSV {"project": ":app", "dir": "/ws/app", "configuration": "testRuntimeClasspath", "nodes": [{"group": "org.junit.jupiter", "name": "junit-jupiter", "version": "5.8.2", "depth": 2, "via": ["org.springframework.boot:spring-boot-starter-test:2.7.0"]}, {"group": "org.yaml", "name": "snakeyaml", "version": "1.30", "depth": 2, "via": [":lib"]}], "unresolved": []}',
    'DEVSNIP-OSV {"project": ":lib", "dir": "/ws/lib", "configuration": "compileClasspath", "nodes": [{"group": "org.yaml", "name": "snakeyaml", "version": "1.26", "depth": 1, "via": []}], "unresolved": [{"requested": "org.apache.commons:commons-text", "reason": "Could not find org.apache.commons:commons-text:.", "depth": 1, "via": []}]}',
    "BUILD SUCCESSFUL in 12s"
].join("\n");
const gradleFiles = () => [
    { path: "settings.gradle", text: "rootProject.name = 'shop'\ninclude 'app', 'lib'\n" },
    { path: "build.gradle", text: "plugins {\n  id 'org.springframework.boot' version '2.6.6' apply false\n  id 'io.spring.dependency-management' version '1.0.11.RELEASE' apply false\n}\n" },
    { path: "app/build.gradle", text: "plugins {\n  id 'java'\n  id 'org.springframework.boot'\n  id 'io.spring.dependency-management'\n}\ndependencies {\n  implementation project(':lib')\n  implementation 'org.springframework.boot:spring-boot-starter-web'\n  runtimeOnly 'com.h2database:h2'\n  testImplementation 'org.springframework.boot:spring-boot-starter-test'\n  implementation libs.some.alias\n}\n" },
    { path: "lib/build.gradle", text: "plugins { id 'java-library'; id 'io.spring.dependency-management' }\ndependencyManagement { imports { mavenBom \"org.springframework.boot:spring-boot-dependencies:${bootVersion}\" } }\ndependencies {\n  api 'org.apache.commons:commons-text'\n  implementation \"org.yaml:snakeyaml:1.26\"\n}\n" },
    { path: "gradle.properties", text: "bootVersion=2.6.6\n" }
];
(0, run_unit_tests_1.suite)("osv gradle: build tool and build scripts", () => {
    (0, run_unit_tests_1.test)("the init-script output is read per project and configuration", () => {
        const configurations = (0, cli_2.parseGradleOutput)(REAL_GRADLE_OUTPUT);
        assert.deepStrictEqual(configurations.map(c => `${c.project}:${c.configuration}:${c.nodes.length}`), [":app:runtimeClasspath:6", ":app:testRuntimeClasspath:2", ":lib:compileClasspath:1"]);
        assert.deepStrictEqual(configurations[0].nodes[5].via, ["org.springframework.boot:spring-boot-starter-web:2.7.0", "org.springframework.boot:spring-boot-starter-tomcat:2.7.0"]);
        assert.strictEqual(configurations[2].unresolved[0].requested, "org.apache.commons:commons-text");
        assert.deepStrictEqual((0, cli_2.parseGradleOutput)("DEVSNIP-OSV {not json\nDEVSNIP-OSV {\"project\":1}"), [], "malformed lines are ignored");
        assert.ok(cli_2.INIT_SCRIPT.includes("canBeResolved") && !/\$\{/.test(cli_2.INIT_SCRIPT), "the Groovy script has no unintended interpolation");
        assert.ok((0, cli_2.gradleArguments)("/tmp/x.gradle").includes("--no-daemon") && (0, cli_2.gradleArguments)("/tmp/x.gradle").includes(cli_2.GRADLE_TASK));
        assert.ok(!(0, cli_2.gradleArguments)("/tmp/x.gradle").some(a => /^(build|assemble|publish|test|clean)$/.test(a)), "no task that builds or writes");
    });
    (0, run_unit_tests_1.test)("settings includes, wrapper discovery and build-wide plugin versions", () => {
        assert.deepStrictEqual((0, index_2.includedProjects)("include 'app', ':lib'\ninclude(\":services:api\")\nproject(':lib').projectDir = file('modules/lib')"), ["app", "modules/lib", "services/api"]);
        const files = new Set(["/ws/gradlew"]);
        assert.deepStrictEqual((0, cli_2.findGradleExecutable)("/ws/app", "/ws", "linux", { PATH: "" }, f => files.has(f)), { command: "/ws/gradlew", kind: "wrapper", label: "./gradlew" });
        assert.strictEqual((0, cli_2.findGradleExecutable)("/ws/app", "/ws", "linux", { PATH: "" }, () => false), undefined, "Gradle unavailable");
        const defaults = (0, builtin_1.buildDefaults)(["plugins { id 'org.springframework.boot' version \"${bootVersion}\" apply false }"], { bootVersion: "3.1.0" });
        assert.deepStrictEqual(defaults, { springBootVersion: "3.1.0" });
        const model = (0, builtin_1.readGradleBuild)("plugins { id 'org.springframework.boot'; id 'io.spring.dependency-management' }\ndependencies {\n implementation 'org.springframework.boot:spring-boot-starter-web'\n implementation(platform(\"org.springframework.cloud:spring-cloud-dependencies:2022.0.1\"))\n compileOnly 'org.projectlombok:lombok'\n implementation group: 'g', name: 'a', version: '1.0'\n}", {}, defaults);
        assert.deepStrictEqual(model.boms.map(b => `${b.name}:${b.version}`), ["spring-boot-dependencies:3.1.0", "spring-cloud-dependencies:2022.0.1"]);
        assert.deepStrictEqual(model.dependencies.map(d => `${d.name}:${d.version ?? "-"}:${d.scope}`), ["spring-boot-starter-web:-:compile", "lombok:-:provided", "a:1.0:compile"]);
        const kotlin = (0, builtin_1.readGradleBuild)('plugins { id("org.springframework.boot") version "3.2.0"; id("io.spring.dependency-management") version "1.1.4" }\ndependencies { testImplementation("org.springframework.boot:spring-boot-starter-test") }');
        assert.deepStrictEqual([kotlin.springBootVersion, kotlin.boms[0]?.name, kotlin.dependencies[0].scope], ["3.2.0", "spring-boot-dependencies", "test"]);
    });
    (0, run_unit_tests_1.test)("Gradle's own result is used when it runs: transitive, test-only and unresolved dependencies", async () => {
        const { repository } = fixtureRepository();
        const configurations = (0, cli_2.parseGradleOutput)(REAL_GRADLE_OUTPUT);
        const outcome = await (0, index_2.resolveGradleProjects)(gradleFiles(), {
            repository, repositoryLabel: "fixture", cliLabel: "./gradlew",
            runCli: async () => ({ configurations, exitCode: 0, output: "", timedOut: false, cancelled: false }),
            relativeDir: abs => abs.replace(/^\/ws\/?/, "")
        });
        assert.deepStrictEqual(outcome.projects.map(p => [p.tool, p.method, p.modules, p.unresolved]), [["Gradle", "build-tool", 3, 1]]);
        const app = outcome.files.get("app/build.gradle");
        assert.strictEqual(app.resolvedBy, "Gradle (./gradlew, resolved classpaths)");
        const by = Object.fromEntries(app.dependencies.map(d => [`${d.name}@${d.version ?? ""}`, d]));
        assert.deepStrictEqual([by["org.apache.tomcat.embed:tomcat-embed-core@9.0.63"].direct, by["org.apache.tomcat.embed:tomcat-embed-core@9.0.63"].scope], [false, "production"]);
        assert.strictEqual(by["org.junit.jupiter:junit-jupiter@5.8.2"].scope, "development", "only on a test classpath");
        assert.strictEqual(by["org.apache.commons:commons-text@"].skip, "unresolved");
        assert.strictEqual(outcome.files.get("lib/build.gradle").dependencies.find(d => d.name === "org.yaml:snakeyaml").version, "1.26", "each project keeps its own resolution");
        assert.deepStrictEqual(outcome.files.get("build.gradle").dependencies, [], "a root without classpaths has no dependencies (not a fallback)");
    });
    (0, run_unit_tests_1.test)("without Gradle, Spring Boot builds are read through Boot's BOM with highest-version-wins, as potential findings", async () => {
        const { repository } = fixtureRepository();
        const failed = await (0, index_2.resolveGradleProjects)(gradleFiles(), {
            repository, repositoryLabel: "fixture", cliLabel: "./gradlew",
            runCli: async () => ({ error: "spawn ./gradlew EACCES" }),
            relativeDir: () => undefined
        });
        assert.match(failed.projects[0].detail, /could not run: spawn \.\/gradlew EACCES/);
        const app = failed.files.get("app/build.gradle");
        assert.match(app.resolvedBy, /Gradle reader/);
        const versions = Object.fromEntries(app.dependencies.filter(d => d.version).map(d => [d.name, d.version]));
        assert.strictEqual(versions["org.apache.tomcat.embed:tomcat-embed-core"], "9.0.60", "transitive through the Boot starter, version from Boot's BOM");
        assert.strictEqual(versions["org.yaml:snakeyaml"], "1.29", "lib's 1.26 meets app's BOM-managed 1.29: the managed version wins in app");
        assert.strictEqual(versions["com.h2database:h2"], "1.4.200");
        assert.strictEqual(versions["org.apache.commons:commons-text"], "1.9", "lib's commons-text comes through project(':lib') with lib's BOM");
        assert.ok(app.dependencies.filter(d => d.version).every(d => d.resolution === "declared"), "Gradle did not run, so these are potential");
        assert.ok(app.warnings.some(w => /libs\.some\.alias/.test(w)), "what cannot be read is reported");
        assert.strictEqual(failed.files.get("lib/build.gradle").dependencies.find(d => d.name === "org.yaml:snakeyaml").version, "1.26", "an explicit version in lib beats nothing it inherits");
    });
    (0, run_unit_tests_1.test)("Gradle's conflict rule: the highest requested version wins unless dependency management enforces one", async () => {
        const fixture = springRepository();
        fixture.poms.set("x:old-user:1.0", pom({ g: "x", a: "old-user", v: "1.0", deps: [{ g: "org.apache.commons", a: "commons-lang3", v: "3.12.0" }] }));
        fixture.poms.set("x:new-user:1.0", pom({ g: "x", a: "new-user", v: "1.0", deps: [{ g: "x", a: "mid", v: "1.0" }] }));
        fixture.poms.set("x:mid:1.0", pom({ g: "x", a: "mid", v: "1.0", deps: [{ g: "org.apache.commons", a: "commons-lang3", v: "3.13.0" }] }));
        fixture.poms.set("org.apache.commons:commons-lang3:3.13.0", pom({ g: "org.apache.commons", a: "commons-lang3", v: "3.13.0" }));
        const { repository } = fixtureRepository(fixture);
        const project = [{ path: "pom.xml", text: pom({ g: "p", a: "p", v: "1", deps: [{ g: "x", a: "old-user", v: "1.0" }, { g: "x", a: "new-user", v: "1.0" }] }) }];
        const nearest = await new resolver_1.MavenResolver(project, repository).resolveModule("pom.xml");
        const highest = await new resolver_1.MavenResolver(project, repository).resolveModule("pom.xml", { conflict: "highest" });
        assert.strictEqual(nearest.dependencies.find(d => d.artifactId === "commons-lang3").version, "3.12.0", "Maven: nearest wins");
        assert.strictEqual(highest.dependencies.find(d => d.artifactId === "commons-lang3").version, "3.13.0", "Gradle: highest wins");
    });
    (0, run_unit_tests_1.test)("a scan of a Spring Boot Gradle build reports transitive findings with their paths", async () => {
        const { repository } = fixtureRepository();
        const osv = fakeOsv(ADVISORIES);
        const result = await (0, scan_1.runScan)(gradleFiles(), {
            client: new client_1.OsvClient({ fetch: osv.fetch, sleep: async () => undefined, retries: 1 }), cache: new client_1.OsvCache(),
            workspace: { name: "shop", folders: ["shop"] }, source: "workspace", toolVersion: "test",
            resolveGradle: (files, signal) => (0, index_2.resolveGradleProjects)(files, { repository, repositoryLabel: "fixture", relativeDir: () => undefined }, { signal })
        });
        const tomcat = result.findings.filter(f => f.packageName.endsWith("tomcat-embed-core")).map(f => [f.id, f.confidence]).sort();
        assert.deepStrictEqual(tomcat, [["GHSA-tom1-0000-0001", "potential"], ["GHSA-tom2-0000-0002", "potential"]]);
        assert.ok(result.findings.find(f => f.packageName.endsWith("tomcat-embed-core")).confidenceNote.includes("declared"));
        assert.ok(result.limitations.some(l => /read from build scripts without running Gradle/.test(l)));
        assert.deepStrictEqual(result.diagnostics.buildTools.map(b => [b.tool, b.method]), [["Gradle", "builtin"]]);
        assert.ok(!result.packages.some(p => p.name.startsWith("gradle-project:")), "your own projects are never scanned as packages");
    });
});
//# sourceMappingURL=osv-maven.unit.js.map