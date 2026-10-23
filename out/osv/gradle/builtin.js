"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gradleProperties = exports.gradleBuildToPom = exports.readGradleBuild = exports.buildDefaults = exports.readVersionCatalog = void 0;
const dependency_manager_1 = require("../../services/dependency-manager");
function scopeOf(configuration) {
    if (/^test/i.test(configuration) || /^androidTest/i.test(configuration))
        return "test";
    if (/compileOnly$/i.test(configuration))
        return "provided";
    if (/runtimeOnly$|^runtime$/i.test(configuration))
        return "runtime";
    return "compile";
}
const accessor = (key) => key.replace(/[-_.]+/g, ".").toLowerCase();
function readVersionCatalog(text) {
    const catalog = { libraries: new Map(), plugins: new Map(), bundles: new Map() };
    const versions = {};
    let section = "";
    const unquote = (v) => v.trim().replace(/^["']|["']$/g, "");
    const field = (value, name) => new RegExp(`(?:^|[\\s{,])${name.replace(".", "\\.")}\\s*=\\s*["']([^"']+)["']`).exec(value)?.[1];
    const versionOf = (value) => {
        const ref = field(value, "version.ref") ?? /version\s*=\s*\{[^}]*\bref\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
        if (ref)
            return versions[ref];
        return field(value, "version") ?? /version\s*=\s*\{[^}]*\b(?:strictly|require|prefer)\s*=\s*["']([^"']+)["']/.exec(value)?.[1];
    };
    const lines = text.split(/\r?\n/);
    // Versions first: libraries may refer to versions declared below them.
    for (const pass of [0, 1]) {
        section = "";
        for (const raw of lines) {
            const line = raw.replace(/\s+#.*$/, "");
            const header = /^\s*\[([\w.-]+)\]\s*$/.exec(line);
            if (header) {
                section = header[1];
                continue;
            }
            const entry = /^\s*([\w.-]+)\s*=\s*(.+?)\s*$/.exec(line);
            if (!entry)
                continue;
            const [, key, value] = entry;
            if (pass === 0) {
                if (section === "versions" && /^["']/.test(value))
                    versions[key] = unquote(value);
                continue;
            }
            if (section === "libraries") {
                let group, name, version;
                if (/^["']/.test(value))
                    [group, name, version] = unquote(value).split(":");
                else {
                    const module = field(value, "module");
                    if (module)
                        [group, name] = module.split(":");
                    else {
                        group = field(value, "group");
                        name = field(value, "name");
                    }
                    version = versionOf(value);
                }
                if (group && name)
                    catalog.libraries.set(accessor(key), { group, name, ...(version ? { version } : {}) });
            }
            else if (section === "plugins") {
                const id = /^["']/.test(value) ? unquote(value).split(":")[0] : field(value, "id");
                const version = /^["']/.test(value) ? unquote(value).split(":")[1] : versionOf(value);
                if (id)
                    catalog.plugins.set(accessor(key), { id, ...(version ? { version } : {}) });
            }
            else if (section === "bundles") {
                catalog.bundles.set(accessor(key), [...value.matchAll(/["']([\w.-]+)["']/g)].map(m => accessor(m[1])));
            }
        }
    }
    return catalog;
}
exports.readVersionCatalog = readVersionCatalog;
/** `alias(libs.plugins.spring.boot)` → the plugin it names, from the catalog. */
function catalogPlugins(text, catalog) {
    if (!catalog)
        return [];
    return [...text.matchAll(/\balias\s*\(\s*libs\.plugins\.([\w.]+?)(?:\.get\(\))?\s*\)/g)].map(m => catalog.plugins.get(m[1].toLowerCase())).filter((p) => Boolean(p));
}
/** Plugin versions and plugins applied to all projects, from every script of the build. */
function buildDefaults(scripts, inherited = {}, catalog) {
    const defaults = catalog ? { catalog } : {};
    for (const text of scripts) {
        const version = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(text)?.[1]
            ?? /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"']+)["']/.exec(text)?.[1]
            ?? catalogPlugins(text, catalog).find(p => p.id === "org.springframework.boot")?.version;
        if (version && !defaults.springBootVersion)
            defaults.springBootVersion = version.replace(/\$\{?(\w+)\}?/g, (m, k) => inherited[k] ?? m);
        for (const block of text.matchAll(/\b(?:subprojects|allprojects)\s*\{([\s\S]*?)\n\}/g)) {
            if (/io\.spring\.dependency-management|org\.springframework\.boot/.test(block[1]))
                defaults.managedEverywhere = true;
        }
    }
    return defaults;
}
exports.buildDefaults = buildDefaults;
function readGradleBuild(text, inherited = {}, defaults = {}) {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const properties = { ...inherited };
    for (const m of clean.matchAll(/(?:\b(?:def|val|var)\s+|\bext\.)(\w+)\s*=\s*["']([^"'$\s]+)["']/g))
        properties[m[1]] = m[2];
    // Dotted names (tomcat.version) are how Spring Boot's BOM properties are overridden: set("…"), ext['…'], extra["…"], ext { set(…) }.
    for (const m of clean.matchAll(/\bset\(\s*["']([\w.-]+)["']\s*,\s*["']([^"'$\s]+)["']/g))
        properties[m[1]] = m[2];
    for (const block of clean.matchAll(/\bext\s*\{([\s\S]*?)\}/g))
        for (const m of block[1].matchAll(/(\w+)\s*=\s*["']([^"'$\s]+)["']/g))
            properties[m[1]] = m[2];
    for (const m of clean.matchAll(/\b(?:extra|ext)\s*\[\s*["']([\w.-]+)["']\s*\]\s*=\s*["']([^"'$\s]+)["']/g))
        properties[m[1]] = m[2];
    const expand = (value) => value.replace(/\$\{?(?:project\.|rootProject\.|ext\.)?([\w.]+)\}?/g, (match, key) => properties[key] ?? match);
    const model = { dependencies: [], boms: [], unreadable: [], properties: {} };
    const catalog = defaults.catalog;
    // Plugins applied through catalog aliases (`alias(libs.plugins.spring.boot)`), unless only declared (`apply false`).
    const aliased = [...clean.matchAll(/\balias\s*\(\s*libs\.plugins\.([\w.]+?)(?:\.get\(\))?\s*\)(\s*apply\s*\(?\s*false)?/g)]
        .map(m => ({ plugin: catalog?.plugins.get(m[1].toLowerCase()), applied: !m[2] }))
        .filter((p) => Boolean(p.plugin));
    const bootAlias = aliased.find(p => p.plugin.id === "org.springframework.boot");
    const boot = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(clean)?.[1]
        ?? /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"']+)["']/.exec(clean)?.[1]
        ?? bootAlias?.plugin.version;
    if (boot)
        model.springBootVersion = expand(boot);
    // A subproject usually applies the Boot plugin without a version; the root build declares it (`apply false`).
    const appliesBoot = /id\s*\(?\s*["']org\.springframework\.boot["']|apply\s*\(?\s*plugin\s*[:=]\s*["']org\.springframework\.boot["']/.test(clean) || Boolean(bootAlias?.applied);
    const usesBootBom = /SpringBootPlugin\.BOM_COORDINATES/.test(clean);
    if (!model.springBootVersion && (appliesBoot || defaults.managedEverywhere || usesBootBom))
        model.springBootVersion = defaults.springBootVersion;
    const dependencyManagement = /io\.spring\.dependency-management/.test(clean) || aliased.some(p => p.applied && p.plugin.id === "io.spring.dependency-management") || Boolean(defaults.managedEverywhere);
    // Boot's BOM: imported by the Boot plugin with dependency management, or by `mavenBom(SpringBootPlugin.BOM_COORDINATES)`.
    if (model.springBootVersion && (((appliesBoot || defaults.managedEverywhere) && dependencyManagement) || usesBootBom)) {
        model.boms.push({ group: "org.springframework.boot", name: "spring-boot-dependencies", version: model.springBootVersion });
    }
    // Spring's dependency-management plugin lets project properties override the imported BOMs' version properties.
    if (dependencyManagement)
        model.properties = { ...properties };
    for (const m of clean.matchAll(/mavenBom\s*\(?\s*["']([^"':]+):([^"':]+):([^"']+)["']/g))
        model.boms.push({ group: m[1], name: m[2], version: expand(m[3]) });
    for (const m of clean.matchAll(/(?:enforcedPlatform|platform)\s*\(\s*libs\.([\w.]+?)(?:\.get\(\))?\s*\)/g)) {
        const library = catalog?.libraries.get(m[1].toLowerCase());
        if (library?.version)
            model.boms.push({ group: library.group, name: library.name, version: expand(library.version) });
    }
    for (const m of clean.matchAll(/(?:enforcedPlatform|platform)\s*\(\s*["']([^"':]+):([^"':]+):([^"']+)["']\s*\)/g))
        model.boms.push({ group: m[1], name: m[2], version: expand(m[3]) });
    // Every `configuration(...)` / `configuration '...'` declaration, wherever it sits (one per line or several on one line).
    const lineAt = (index) => clean.slice(0, index).split("\n").length;
    for (const m of clean.matchAll(/(?:^|[\s{;(])([a-zA-Z]*(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly|[Rr]untimeOnly|[Cc]ompile|[Rr]untime))\s*(\(\s*)?(platform\s*\(|enforcedPlatform\s*\(|project\s*\(|files\s*\(|fileTree\s*\(|libs\.[\w.]+|["'][^"'\n]*["']|group\s*[:=][^\n)]*)/g)) {
        const configuration = m[1];
        const target = m[3];
        if (/^(?:platform|enforcedPlatform|project|files|fileTree)\s*\(/.test(target))
            continue; // BOMs above; projects and files are not packages
        if (target.startsWith("libs.")) {
            // Version catalog accessors: a library, or a bundle of libraries.
            const key = target.slice(5).replace(/\.get\(\)$/, "").toLowerCase();
            const bundle = key.startsWith("bundles.") ? catalog?.bundles.get(key.slice(8)) : undefined;
            const libraries = (bundle ?? [key]).map(k => catalog?.libraries.get(k));
            if (!libraries.length || libraries.some(l => !l)) {
                model.unreadable.push(`${configuration}(${target})`);
                continue;
            }
            for (const library of libraries) {
                model.dependencies.push({ group: library.group, name: library.name, ...(library.version ? { version: expand(library.version) } : {}), scope: scopeOf(configuration), line: lineAt(m.index + m[0].indexOf(configuration)) });
            }
            continue;
        }
        const string = /^["']([^"':\s]+):([^"':\s]+)(?::([^"'\s@]+))?(?::[^"'\s]+)?(?:@\w+)?["']$/.exec(target);
        const map = /group\s*[:=]\s*["']([^"']+)["']\s*,\s*name\s*[:=]\s*["']([^"']+)["'](?:\s*,\s*version\s*[:=]\s*["']([^"']+)["'])?/.exec(target);
        const parts = string ?? map;
        if (!parts)
            continue;
        const version = parts[3] ? expand(parts[3]) : undefined;
        model.dependencies.push({ group: parts[1], name: parts[2], ...(version ? { version } : {}), scope: scopeOf(configuration), line: lineAt(m.index + m[0].indexOf(configuration)) });
    }
    return model;
}
exports.readGradleBuild = readGradleBuild;
function xml(value) {
    return value.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
}
/** The build as a POM the Maven resolver can read (BOMs become imports, configurations become scopes). */
function gradleBuildToPom(model, coordinates) {
    const dep = (g, a, v, scope, extra = "") => `<dependency><groupId>${xml(g)}</groupId><artifactId>${xml(a)}</artifactId>${v ? `<version>${xml(v)}</version>` : ""}${extra}${scope && scope !== "compile" ? `<scope>${scope}</scope>` : ""}</dependency>`;
    const properties = Object.entries(model.properties ?? {}).filter(([key]) => /^[A-Za-z_][\w.-]*$/.test(key));
    return `<project><modelVersion>4.0.0</modelVersion><groupId>${xml(coordinates.group)}</groupId><artifactId>${xml(coordinates.name)}</artifactId><version>0</version>
${properties.length ? `<properties>${properties.map(([k, v]) => `<${k}>${xml(v)}</${k}>`).join("")}</properties>` : ""}
<dependencyManagement><dependencies>${model.boms.map(b => dep(b.group, b.name, b.version, "import", "<type>pom</type>")).join("")}</dependencies></dependencyManagement>
<dependencies>${model.dependencies.map(d => dep(d.group, d.name, d.version, d.scope)).join("")}</dependencies></project>`;
}
exports.gradleBuildToPom = gradleBuildToPom;
function gradleProperties(texts) {
    return Object.assign({}, ...texts.map(dependency_manager_1.parseProperties));
}
exports.gradleProperties = gradleProperties;
//# sourceMappingURL=builtin.js.map