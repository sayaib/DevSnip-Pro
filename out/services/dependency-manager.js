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
exports.STATUS_ORDER = exports.venvInterpreter = exports.explainFailure = exports.toolInstallHint = exports.mavenLocalRepository = exports.gradleArtifactDir = exports.mavenArtifactDir = exports.parsePipList = exports.nodeModuleManifestCandidates = exports.withSearchPath = exports.formatCommandLine = exports.planSpawn = exports.resolveExecutable = exports.validateCommandSpec = exports.gradleEditHint = exports.dependencyCommands = exports.projectUpdateCommand = exports.projectInstallCommand = exports.wrapperDisplay = exports.evaluateDependency = exports.parseMavenMetadata = exports.parsePypiDocument = exports.parseNpmPackument = exports.mavenMetadataUrls = exports.pypiUrl = exports.npmRegistryUrl = exports.detectProjects = exports.isInside = exports.detectNodeManager = exports.parseVersionCatalog = exports.parseGradle = exports.parseProperties = exports.parsePom = exports.parsePyproject = exports.parseRequirements = exports.isDevRequirementsFile = exports.parsePep508 = exports.parsePackageJson = exports.isRegistryNpmSpec = exports.normalizePipName = exports.isValidMavenVersion = exports.isValidMavenCoordinate = exports.isValidPipName = exports.isValidNpmName = void 0;
const path = __importStar(require("path"));
const dependency_versions_1 = require("./dependency-versions");
// ---------------------------------------------------------------------------
// Names and specs
// ---------------------------------------------------------------------------
const NPM_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/i;
const PIP_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const MAVEN_PART = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAVEN_VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
function isValidNpmName(name) {
    return typeof name === "string" && name.length <= 214 && NPM_NAME.test(name);
}
exports.isValidNpmName = isValidNpmName;
function isValidPipName(name) {
    return typeof name === "string" && name.length <= 200 && PIP_NAME.test(name);
}
exports.isValidPipName = isValidPipName;
function isValidMavenCoordinate(coordinate) {
    const parts = coordinate.split(":");
    return parts.length === 2 && parts.every(part => part.length <= 200 && MAVEN_PART.test(part));
}
exports.isValidMavenCoordinate = isValidMavenCoordinate;
function isValidMavenVersion(version) {
    return version.length <= 100 && MAVEN_VERSION.test(version);
}
exports.isValidMavenVersion = isValidMavenVersion;
/** PEP 503 normalisation: case-insensitive, and `-`, `_`, `.` runs are equivalent. */
function normalizePipName(name) {
    return name.toLowerCase().replace(/[-_.]+/g, "-");
}
exports.normalizePipName = normalizePipName;
/** An npm dist-tag such as `latest` or `next`. */
function isNpmTag(spec) {
    return /^[A-Za-z][\w.-]*$/.test(spec) && !/^[xX]$/.test(spec);
}
/** True when an npm spec resolves from the registry (a range or a dist-tag). */
function isRegistryNpmSpec(spec) {
    const value = spec.trim();
    if (!value)
        return true;
    if (/^(?:file|link|workspace|portal|patch|git|git\+\w+|github|gitlab|bitbucket|http|https|npm):/i.test(value))
        return false;
    if (value.includes("/") && !value.startsWith("@"))
        return false; // GitHub shorthand or a path
    return Boolean((0, dependency_versions_1.parseSemverRange)(value)) || isNpmTag(value);
}
exports.isRegistryNpmSpec = isRegistryNpmSpec;
function parsePackageJson(text, source = "package.json") {
    let manifest;
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { dependencies: [], error: `${source} is not a JSON object.` };
        }
        manifest = parsed;
    }
    catch (error) {
        return { dependencies: [], error: `${source} could not be parsed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const sections = [
        ["dependencies", "production"],
        ["devDependencies", "development"],
        ["optionalDependencies", "optional"],
        ["peerDependencies", "peer"]
    ];
    const byName = new Map();
    for (const [key, scope] of sections) {
        const section = manifest[key];
        if (!section || typeof section !== "object" || Array.isArray(section))
            continue;
        for (const [name, rawSpec] of Object.entries(section)) {
            if (typeof rawSpec !== "string")
                continue;
            // npm lists an optional dependency in both sections; a peer that is also
            // a regular dependency is managed through the regular entry.
            const existing = byName.get(name);
            if (existing && (scope === "peer" || (scope === "optional" && existing.scope === "production"))) {
                if (scope === "optional")
                    existing.scope = "optional";
                continue;
            }
            const spec = rawSpec.trim();
            const validName = isValidNpmName(name);
            const registry = validName && isRegistryNpmSpec(spec);
            byName.set(name, {
                name,
                displayName: name,
                spec,
                scope,
                source,
                registry,
                note: !validName
                    ? "The package name is not a valid npm name, so it is never installed automatically."
                    : registry ? undefined : "Installed from git, a URL, a path, a workspace or an alias, so it is not checked against the registry."
            });
        }
    }
    const packageManager = typeof manifest.packageManager === "string" ? manifest.packageManager : undefined;
    return { dependencies: [...byName.values()], packageManager };
}
exports.parsePackageJson = parsePackageJson;
/** Parses one PEP 508 requirement string (the part pip and pyproject share). */
function parsePep508(requirement) {
    const text = requirement.trim();
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(text);
    if (!match)
        return undefined;
    let rest = match[3];
    let marker;
    const semicolon = rest.indexOf(";");
    if (semicolon >= 0) {
        marker = rest.slice(semicolon + 1).trim();
        rest = rest.slice(0, semicolon);
    }
    rest = rest.trim();
    if (rest.startsWith("@")) {
        return { name: match[1], extras: match[2]?.replace(/\s+/g, ""), spec: rest.slice(1).trim(), marker, direct: true };
    }
    if (rest.startsWith("(") && rest.endsWith(")"))
        rest = rest.slice(1, -1).trim();
    return { name: match[1], extras: match[2]?.replace(/\s+/g, ""), spec: rest.replace(/\s+/g, ""), marker, direct: false };
}
exports.parsePep508 = parsePep508;
function pythonDependency(requirement, scope, source) {
    const validSpec = !requirement.direct && (requirement.spec === "" || (0, dependency_versions_1.isValidPep440Specifier)(requirement.spec));
    const registry = validSpec && isValidPipName(requirement.name);
    return {
        name: normalizePipName(requirement.name),
        displayName: requirement.name,
        spec: requirement.direct ? `@ ${requirement.spec}` : requirement.spec,
        scope,
        source,
        extras: requirement.extras || undefined,
        registry,
        note: requirement.direct
            ? "Installed from a direct URL, so it is not checked against PyPI."
            : !validSpec
                ? "The version specifier could not be read, so it is not checked against PyPI."
                : requirement.marker
                    ? `Only installed when \`${requirement.marker}\` holds.`
                    : undefined
    };
}
/** A requirements file name that holds development-only tools. */
function isDevRequirementsFile(file) {
    return /(?:^|[/_.-])(dev|develop|development|test|tests|testing|lint|docs?|ci|local|tox|typing)(?:[/_.-]|$)/i.test(file.replace(/\\/g, "/"));
}
exports.isDevRequirementsFile = isDevRequirementsFile;
function parseRequirements(text, source, scope) {
    const dependencies = [];
    const joined = text.replace(/\\\r?\n/g, " ");
    for (const rawLine of joined.split(/\r?\n/)) {
        const line = rawLine.replace(/(?:^|\s)#.*$/, "").replace(/\s--hash[=\s]\S+/g, "").trim();
        if (!line || line.startsWith("-"))
            continue; // -r, -c, -e, --index-url and other options
        if (/^(?:\.{0,2}\/|[A-Za-z]:[\\/]|\w+(?:\+\w+)?:\/\/)/.test(line))
            continue; // paths and bare URLs
        const requirement = parsePep508(line);
        if (requirement)
            dependencies.push(pythonDependency(requirement, scope, source));
    }
    return dependencies;
}
exports.parseRequirements = parseRequirements;
/**
 * Reads a TOML array of strings starting at `index` (the position of `[`).
 * Strings may contain `]` (extras), so the scan is quote-aware. Non-string
 * elements such as inline tables are skipped.
 */
function readTomlStringArray(text, index) {
    const values = [];
    let depth = 0;
    let i = index;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (ch === "#") {
            while (i < text.length && text[i] !== "\n")
                i++;
            continue;
        }
        if (ch === "\"" || ch === "'") {
            const triple = text.startsWith(ch.repeat(3), i);
            const quote = triple ? ch.repeat(3) : ch;
            let j = i + quote.length;
            let value = "";
            while (j < text.length && !text.startsWith(quote, j)) {
                if (ch === "\"" && text[j] === "\\" && j + 1 < text.length) {
                    value += text[j + 1];
                    j += 2;
                    continue;
                }
                value += text[j++];
            }
            if (depth === 1)
                values.push(value);
            i = j + quote.length - 1;
            continue;
        }
        if (ch === "[" || ch === "{")
            depth++;
        else if (ch === "]" || ch === "}") {
            depth--;
            if (depth === 0)
                break;
        }
    }
    return { values, end: i };
}
/** Splits a TOML document into `[table]` sections (header -> body). */
function tomlTables(text) {
    const tables = [];
    const pattern = /^[ \t]*\[([^\[\]\n]+)\][ \t]*(?:#.*)?$/gm;
    const headers = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        headers.push({ header: match[1].trim(), start: match.index, end: match.index + match[0].length });
    }
    headers.forEach((entry, i) => {
        tables.push({ header: entry.header, body: text.slice(entry.end, i + 1 < headers.length ? headers[i + 1].start : text.length) });
    });
    return tables;
}
/** `key = [ ... ]` string arrays inside one TOML table body. */
function tomlArrays(body) {
    const result = [];
    const pattern = /^[ \t]*("?[\w.-]+"?)[ \t]*=[ \t]*\[/gm;
    let match;
    while ((match = pattern.exec(body)) !== null) {
        const { values, end } = readTomlStringArray(body, match.index + match[0].length - 1);
        result.push({ key: match[1].replace(/"/g, ""), values });
        pattern.lastIndex = end;
    }
    return result;
}
const DEV_GROUP = /^(dev|develop|development|test|tests|testing|lint|linting|docs?|typing|types|ci|format|style|qa)$/i;
function parsePyproject(text, source = "pyproject.toml") {
    const dependencies = [];
    const tables = tomlTables(text);
    const push = (value, scope) => {
        const requirement = parsePep508(value);
        if (requirement)
            dependencies.push(pythonDependency(requirement, scope, source));
    };
    let hasProjectDeps = false;
    for (const { header, body } of tables) {
        if (header === "project") {
            for (const { key, values } of tomlArrays(body)) {
                if (key !== "dependencies")
                    continue;
                hasProjectDeps = true;
                values.forEach(value => push(value, "production"));
            }
        }
        else if (header === "project.optional-dependencies") {
            for (const { key, values } of tomlArrays(body)) {
                values.forEach(value => push(value, DEV_GROUP.test(key) ? "development" : "optional"));
            }
        }
        else if (header === "dependency-groups") {
            for (const { values } of tomlArrays(body))
                values.forEach(value => push(value, "development"));
        }
    }
    const poetryOnly = !hasProjectDeps && tables.some(t => t.header === "tool.poetry.dependencies");
    return { dependencies, poetryOnly };
}
exports.parsePyproject = parsePyproject;
function stripXmlComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, "");
}
function xmlValue(block, tag) {
    const match = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`).exec(block);
    return match ? match[1] : undefined;
}
function removeXmlBlocks(text, tag) {
    return text.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
}
function resolveProperty(value, properties) {
    if (value === undefined)
        return {};
    const match = /^\$\{([\w.-]+)\}$/.exec(value.trim());
    if (!match)
        return { value: value.trim() };
    const resolved = properties[match[1]];
    return { value: resolved && !resolved.includes("${") ? resolved : undefined, ref: match[1] };
}
function isDynamicJvmVersion(version) {
    return /[\[\](),+]|^latest\.|SNAPSHOT$/i.test(version);
}
function jvmDependency(group, artifact, rawVersion, versionRef, scope, source) {
    const name = `${group}:${artifact}`;
    const version = rawVersion ?? "";
    const valid = isValidMavenCoordinate(name);
    let note;
    if (!valid)
        note = "The coordinate is not a plain group:artifact, so it is not checked.";
    else if (!version && versionRef)
        note = `The version comes from \`${versionRef}\`, which could not be resolved from this project's files.`;
    else if (!version)
        note = "No version is declared here; it is managed by a parent POM, BOM or platform.";
    else if (isDynamicJvmVersion(version))
        note = "The version is a range, snapshot or dynamic selector, so no single upgrade target applies.";
    else if (!isValidMavenVersion(version))
        note = "The version could not be read.";
    return {
        name,
        displayName: name,
        spec: version,
        scope,
        source,
        registry: !note,
        note,
        versionRef
    };
}
function parsePom(text, source = "pom.xml") {
    const clean = stripXmlComments(text);
    const properties = {};
    const propertiesBlock = /<properties>([\s\S]*?)<\/properties>/.exec(clean);
    if (propertiesBlock) {
        const pattern = /<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g;
        let match;
        while ((match = pattern.exec(propertiesBlock[1])) !== null)
            properties[match[1]] = match[2];
    }
    // `${project.version}` is the project's own version, declared outside <parent>.
    const ownVersion = xmlValue(["parent", "dependencies", "dependencyManagement", "build", "profiles", "reporting", "properties", "plugins"]
        .reduce((acc, tag) => removeXmlBlocks(acc, tag), clean), "version");
    if (ownVersion) {
        properties["project.version"] = ownVersion;
        properties["pom.version"] = ownVersion;
    }
    // Managed versions, plugin dependencies and profile-only dependencies are
    // not the project's direct dependencies.
    const body = ["dependencyManagement", "build", "profiles", "reporting", "pluginRepositories"]
        .reduce((acc, tag) => removeXmlBlocks(acc, tag), clean);
    const dependencies = [];
    const pattern = /<dependency>([\s\S]*?)<\/dependency>/g;
    let match;
    while ((match = pattern.exec(body)) !== null) {
        const block = match[1];
        const group = resolveProperty(xmlValue(block, "groupId"), properties).value;
        const artifact = resolveProperty(xmlValue(block, "artifactId"), properties).value;
        if (!group || !artifact)
            continue;
        const scopeText = (xmlValue(block, "scope") || "compile").toLowerCase();
        if (scopeText === "import")
            continue;
        const version = resolveProperty(xmlValue(block, "version"), properties);
        const scope = scopeText === "test" ? "development" : xmlValue(block, "optional") === "true" ? "optional" : "production";
        dependencies.push(jvmDependency(group, artifact, version.value, version.ref, scope, source));
    }
    return dependencies;
}
exports.parsePom = parsePom;
/** `key=value` pairs from gradle.properties. */
function parseProperties(text) {
    const properties = {};
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([\w.-]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
        if (match && !line.trim().startsWith("#") && !line.trim().startsWith("!"))
            properties[match[1]] = match[2];
    }
    return properties;
}
exports.parseProperties = parseProperties;
const GRADLE_CONFIGURATION = "([a-zA-Z]*(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly|[Rr]untimeOnly|[Cc]ompile|kapt|ksp|[Aa]nnotationProcessor))";
function gradleScope(configuration) {
    return /^(test|androidTest|testFixtures|kapt|ksp|annotationProcessor|lint)/i.test(configuration) ? "development" : "production";
}
function resolveGradleVersion(raw, properties) {
    const match = /^\$\{?([\w.]+)\}?$/.exec(raw);
    if (!match)
        return { value: raw };
    const key = match[1].replace(/^(?:project|rootProject|ext)\./, "");
    return { value: properties[key], ref: key };
}
function parseGradle(text, source, inherited = {}) {
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const properties = { ...inherited };
    const propertyPattern = /(?:\b(?:def|val|var)\s+|\bext\.|\bset\(\s*["'])(\w+)["']?\s*[=,]\s*["']([^"'$\s]+)["']/g;
    let match;
    while ((match = propertyPattern.exec(clean)) !== null)
        properties[match[1]] = match[2];
    const extBlock = /\bext\s*\{([\s\S]*?)\}/.exec(clean);
    if (extBlock) {
        const pattern = /(\w+)\s*=\s*["']([^"'$\s]+)["']/g;
        while ((match = pattern.exec(extBlock[1])) !== null)
            properties[match[1]] = match[2];
    }
    const dependencies = [];
    const seen = new Set();
    const add = (configuration, group, artifact, rawVersion) => {
        const version = resolveGradleVersion(rawVersion, properties);
        const dependency = jvmDependency(group, artifact, version.value, version.ref, gradleScope(configuration), source);
        const key = `${dependency.name}|${dependency.scope}`;
        if (seen.has(key))
            return;
        seen.add(key);
        dependencies.push(dependency);
    };
    const stringNotation = new RegExp(`\\b${GRADLE_CONFIGURATION}\\s*\\(?\\s*["']([^"':\\s]+):([^"':\\s]+):([^"':\\s@]+)(?::[^"'\\s]+)?(?:@\\w+)?["']`, "g");
    while ((match = stringNotation.exec(clean)) !== null)
        add(match[1], match[2], match[3], match[4]);
    const mapNotation = new RegExp(`\\b${GRADLE_CONFIGURATION}\\s*\\(?\\s*group\\s*[:=]\\s*["']([^"']+)["']\\s*,\\s*name\\s*[:=]\\s*["']([^"']+)["']\\s*,\\s*version\\s*[:=]\\s*["']([^"']+)["']`, "g");
    while ((match = mapNotation.exec(clean)) !== null)
        add(match[1], match[2], match[3], match[4]);
    return dependencies;
}
exports.parseGradle = parseGradle;
/** Libraries declared in a Gradle version catalog (`gradle/libs.versions.toml`). */
function parseVersionCatalog(text, source = "gradle/libs.versions.toml") {
    const versions = {};
    const dependencies = [];
    const unquote = (value) => value.trim().replace(/^["']|["']$/g, "");
    for (const { header, body } of tomlTables(text)) {
        for (const line of body.split(/\r?\n/)) {
            const entry = /^\s*([\w.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line);
            if (!entry)
                continue;
            const [, key, value] = entry;
            if (header === "versions") {
                if (/^["']/.test(value))
                    versions[key] = unquote(value);
                continue;
            }
            if (header !== "libraries")
                continue;
            let group;
            let artifact;
            let version;
            let ref;
            if (/^["']/.test(value)) {
                const parts = unquote(value).split(":");
                [group, artifact, version] = parts;
            }
            else {
                const field = (name) => {
                    const found = new RegExp(`(?:^|[\\s{,])${name.replace(".", "\\.")}\\s*=\\s*["']([^"']+)["']`).exec(value);
                    return found ? found[1] : undefined;
                };
                const module = field("module");
                if (module)
                    [group, artifact] = module.split(":");
                else {
                    group = field("group");
                    artifact = field("name");
                }
                ref = field("version.ref") ?? (/version\s*=\s*\{\s*ref\s*=\s*["']([^"']+)["']/.exec(value)?.[1]);
                version = ref ? versions[ref] : field("version");
            }
            if (!group || !artifact)
                continue;
            dependencies.push(jvmDependency(group, artifact, version, ref ? `versions.${ref}` : undefined, "production", source));
        }
    }
    return dependencies;
}
exports.parseVersionCatalog = parseVersionCatalog;
// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------
function toPosix(value) {
    return value.replace(/\\/g, "/");
}
/**
 * Picks the Node package manager a project actually uses.
 *
 * Corepack's `packageManager` field is authoritative; otherwise the nearest
 * lockfile decides, searching up to the workspace root so a package inside a
 * monorepo uses the root's manager. With no signal at all npm is assumed.
 */
function detectNodeManager(dir, packageManagerField, exists, stopAt) {
    const field = packageManagerField ? /^(npm|yarn|pnpm)@(\d+)/.exec(packageManagerField) : null;
    if (field) {
        const manager = field[1];
        return { manager, yarnBerry: manager === "yarn" && Number(field[2]) >= 2, detectedBy: `"packageManager": "${packageManagerField}" in package.json` };
    }
    const root = path.resolve(stopAt);
    let current = path.resolve(dir);
    for (;;) {
        const has = (name) => exists(path.join(current, name));
        const where = toPosix(path.relative(root, current)) || ".";
        if (has("pnpm-lock.yaml"))
            return { manager: "pnpm", yarnBerry: false, detectedBy: `pnpm-lock.yaml in ${where}` };
        if (has("yarn.lock"))
            return { manager: "yarn", yarnBerry: has(".yarnrc.yml"), detectedBy: `yarn.lock in ${where}` };
        if (has("package-lock.json"))
            return { manager: "npm", yarnBerry: false, detectedBy: `package-lock.json in ${where}` };
        if (has("npm-shrinkwrap.json"))
            return { manager: "npm", yarnBerry: false, detectedBy: `npm-shrinkwrap.json in ${where}` };
        const parent = path.dirname(current);
        if (current === root || parent === current || !isInside(parent, root))
            break;
        current = parent;
    }
    return { manager: "npm", yarnBerry: false, detectedBy: "no lockfile found, so npm is assumed" };
}
exports.detectNodeManager = detectNodeManager;
/** True when `child` is `parent` or inside it. */
function isInside(child, parent) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
exports.isInside = isInside;
function findUp(dir, names, exists, stopAt) {
    let current = path.resolve(dir);
    for (;;) {
        for (const name of names) {
            const candidate = path.join(current, name);
            if (exists(candidate))
                return candidate;
        }
        const parent = path.dirname(current);
        if (current === path.resolve(stopAt) || parent === current || !isInside(parent, stopAt))
            return undefined;
        current = parent;
    }
}
/**
 * Groups workspace files into projects, one per directory and ecosystem.
 * `root` bounds lockfile and wrapper searches to the workspace folder.
 */
function detectProjects(files, root, platform) {
    const known = new Map();
    for (const file of files)
        known.set(path.resolve(file.path), file);
    const exists = (file) => known.has(path.resolve(file));
    const text = (file) => known.get(path.resolve(file))?.text;
    const projects = [];
    const byKey = new Map();
    const project = (dir, ecosystem, init) => {
        const key = `${ecosystem}|${path.resolve(dir)}`;
        let existing = byKey.get(key);
        if (!existing) {
            existing = { id: `p${projects.length}`, dir: path.resolve(dir), ecosystem, manifests: [], dependencies: [], warnings: [], ...init() };
            byKey.set(key, existing);
            projects.push(existing);
        }
        return existing;
    };
    const relative = (dir, file) => toPosix(path.relative(dir, file));
    const sorted = [...known.values()].filter(file => file.text !== undefined).sort((a, b) => a.path.localeCompare(b.path));
    const gradleProperties = (dir) => {
        const found = findUp(dir, ["gradle.properties"], exists, root);
        return found ? parseProperties(text(found) || "") : {};
    };
    for (const file of sorted) {
        const base = path.basename(file.path);
        const dir = path.dirname(file.path);
        const body = file.text || "";
        if (base === "package.json") {
            const parsed = parsePackageJson(body);
            const detected = detectNodeManager(dir, parsed.packageManager, exists, root);
            const entry = project(dir, "node", () => ({
                manager: detected.manager, tool: detected.manager, yarnBerry: detected.yarnBerry, detectedBy: detected.detectedBy
            }));
            entry.manifests.push(relative(dir, file.path));
            entry.dependencies.push(...parsed.dependencies);
            if (parsed.error)
                entry.warnings.push(parsed.error);
        }
        else if (/^requirements.*\.txt$/i.test(base) || (path.basename(dir) === "requirements" && base.endsWith(".txt"))) {
            const projectDir = path.basename(dir) === "requirements" ? path.dirname(dir) : dir;
            const entry = project(projectDir, "python", () => ({ manager: "pip", tool: "python", detectedBy: "requirements file" }));
            const source = relative(projectDir, file.path);
            entry.manifests.push(source);
            entry.dependencies.push(...parseRequirements(body, source, isDevRequirementsFile(source) ? "development" : "production"));
        }
        else if (base === "pyproject.toml") {
            const parsed = parsePyproject(body);
            if (!parsed.dependencies.length && !parsed.poetryOnly)
                continue;
            const entry = project(dir, "python", () => ({ manager: "pip", tool: "python", detectedBy: "pyproject.toml" }));
            entry.manifests.push("pyproject.toml");
            entry.dependencies.push(...parsed.dependencies);
            if (parsed.poetryOnly) {
                entry.warnings.push("pyproject.toml declares its dependencies for Poetry only. Manage them with `poetry install` / `poetry update`; they are not listed here.");
            }
        }
        else if (base === "pom.xml") {
            const wrapper = findUp(dir, platform === "win32" ? ["mvnw.cmd"] : ["mvnw"], exists, root);
            const entry = project(dir, "maven", () => ({
                manager: "maven", tool: wrapper ? "mvnw" : "mvn", wrapperPath: wrapper,
                detectedBy: wrapper ? `pom.xml with the Maven Wrapper (${relative(dir, wrapper) || path.basename(wrapper)})` : "pom.xml"
            }));
            entry.manifests.push("pom.xml");
            entry.dependencies.push(...parsePom(body));
        }
        else if (base === "build.gradle" || base === "build.gradle.kts") {
            const wrapper = findUp(dir, platform === "win32" ? ["gradlew.bat"] : ["gradlew"], exists, root);
            const entry = project(dir, "gradle", () => ({
                manager: "gradle", tool: wrapper ? "gradlew" : "gradle", wrapperPath: wrapper,
                detectedBy: wrapper ? `${base} with the Gradle Wrapper (${relative(dir, wrapper) || path.basename(wrapper)})` : base
            }));
            entry.manifests.push(base);
            entry.dependencies.push(...parseGradle(body, base, gradleProperties(dir)));
        }
        else if (base === "libs.versions.toml" && path.basename(dir) === "gradle") {
            const projectDir = path.dirname(dir);
            const wrapper = findUp(projectDir, platform === "win32" ? ["gradlew.bat"] : ["gradlew"], exists, root);
            const entry = project(projectDir, "gradle", () => ({
                manager: "gradle", tool: wrapper ? "gradlew" : "gradle", wrapperPath: wrapper,
                detectedBy: wrapper ? "Gradle version catalog with the Gradle Wrapper" : "Gradle version catalog"
            }));
            const source = relative(projectDir, file.path);
            entry.manifests.push(source);
            const existing = new Set(entry.dependencies.map(dep => dep.name));
            entry.dependencies.push(...parseVersionCatalog(body, source).filter(dep => !existing.has(dep.name)));
        }
    }
    // The same Python package can be listed in several requirement files.
    for (const entry of projects) {
        if (entry.ecosystem !== "python")
            continue;
        const seen = new Map();
        for (const dep of entry.dependencies) {
            const previous = seen.get(dep.name);
            if (!previous || (previous.scope !== "production" && dep.scope === "production"))
                seen.set(dep.name, dep);
        }
        entry.dependencies = [...seen.values()];
    }
    return projects.filter(entry => entry.dependencies.length > 0 || entry.warnings.length > 0);
}
exports.detectProjects = detectProjects;
function npmRegistryUrl(name) {
    const encoded = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
    return `https://registry.npmjs.org/${encoded}`;
}
exports.npmRegistryUrl = npmRegistryUrl;
function pypiUrl(name) {
    return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
}
exports.pypiUrl = pypiUrl;
function mavenMetadataUrls(coordinate) {
    const [group, artifact] = coordinate.split(":");
    const suffix = `${group.split(".").map(encodeURIComponent).join("/")}/${encodeURIComponent(artifact)}/maven-metadata.xml`;
    const urls = [`https://repo1.maven.org/maven2/${suffix}`];
    if (/^(androidx|com\.android|com\.google\.(android|firebase|gms|mlkit|ar)|android\.arch)\b/.test(group)) {
        urls.unshift(`https://dl.google.com/dl/android/maven2/${suffix}`);
    }
    return urls;
}
exports.mavenMetadataUrls = mavenMetadataUrls;
function parseNpmPackument(data) {
    const doc = data;
    const versions = doc && doc.versions && typeof doc.versions === "object" ? Object.keys(doc.versions) : [];
    const tagged = doc?.["dist-tags"]?.latest;
    const latest = typeof tagged === "string" && (0, dependency_versions_1.parseSemver)(tagged)
        ? tagged
        : versions.filter(dependency_versions_1.isStableSemver).sort(dependency_versions_1.compareSemver).pop();
    return { versions, latest };
}
exports.parseNpmPackument = parseNpmPackument;
function parsePypiDocument(data) {
    const doc = data;
    const releases = doc?.releases && typeof doc.releases === "object" ? doc.releases : {};
    // A release with no files, or only yanked files, cannot be installed.
    const versions = Object.entries(releases)
        .filter(([, files]) => Array.isArray(files) && files.length > 0 && files.some(file => !file?.yanked))
        .map(([version]) => version);
    const stable = versions.filter(dependency_versions_1.isStablePep440).sort(dependency_versions_1.comparePep440);
    const latest = stable.length ? stable[stable.length - 1] : doc?.info?.version;
    return { versions, latest };
}
exports.parsePypiDocument = parsePypiDocument;
function parseMavenMetadata(xml) {
    const versions = [];
    const pattern = /<version>\s*([^<\s]+)\s*<\/version>/g;
    let match;
    while ((match = pattern.exec(xml)) !== null)
        versions.push(match[1]);
    const stable = versions.filter(dependency_versions_1.isStableMaven).sort(dependency_versions_1.compareMaven);
    return { versions, latest: stable[stable.length - 1] };
}
exports.parseMavenMetadata = parseMavenMetadata;
function newer(ecosystem, a, b) {
    if (!a || !b)
        return false;
    if (ecosystem === "node")
        return (0, dependency_versions_1.compareSemver)(a, b) > 0;
    if (ecosystem === "python")
        return (0, dependency_versions_1.comparePep440)(a, b) > 0;
    return (0, dependency_versions_1.compareMaven)(a, b) > 0;
}
/**
 * Decides what a developer needs to do about one dependency.
 *
 * `installed` is the version on disk (for Maven/Gradle, the declared version
 * when it is in the local repository). `info` is the registry's answer, or
 * undefined when it was not fetched.
 */
function evaluateDependency(ecosystem, dependency, installed, info) {
    if (!dependency.registry) {
        return { status: "unknown", installed, detail: dependency.note || "Not a registry dependency." };
    }
    let compatible;
    let latest = info?.latest;
    const versions = info?.versions ?? [];
    if (ecosystem === "node") {
        compatible = (0, dependency_versions_1.parseSemverRange)(dependency.spec || "*")
            ? (0, dependency_versions_1.maxSatisfyingSemver)(versions, dependency.spec || "*")
            : latest; // a dist-tag follows the tag, which is what `latest` reports
    }
    else if (ecosystem === "python") {
        compatible = (0, dependency_versions_1.maxSatisfyingPep440)(versions, dependency.spec);
    }
    else {
        const current = dependency.spec;
        const flavour = (0, dependency_versions_1.mavenFlavour)(current);
        const major = (0, dependency_versions_1.mavenMajor)(current);
        const stable = versions.filter(v => (0, dependency_versions_1.isStableMaven)(v) && (!flavour || (0, dependency_versions_1.mavenFlavour)(v) === flavour)).sort(dependency_versions_1.compareMaven);
        latest = stable.length ? stable[stable.length - 1] : latest;
        const sameMajor = stable.filter(v => (0, dependency_versions_1.mavenMajor)(v) === major);
        compatible = sameMajor.length ? sameMajor[sameMajor.length - 1] : undefined;
    }
    const base = { installed, compatible, latest };
    if (!installed) {
        const where = ecosystem === "maven" ? "the local Maven repository" : ecosystem === "gradle" ? "the Gradle cache" : "this environment";
        // Say so when the registry does not know the package either: installing will fail.
        const registryNote = info?.error && !versions.length ? ` ${info.error}` : "";
        return { ...base, status: "missing", detail: `Not installed in ${where}.${registryNote}` };
    }
    if (ecosystem === "node" && dependency.spec && (0, dependency_versions_1.parseSemverRange)(dependency.spec) && !(0, dependency_versions_1.satisfiesSemver)(installed, dependency.spec)) {
        return { ...base, status: "mismatch", detail: `Installed ${installed} does not satisfy the declared range ${dependency.spec}. Reinstall to match the manifest.` };
    }
    if (ecosystem === "python" && dependency.spec && !(0, dependency_versions_1.satisfiesPep440)(installed, dependency.spec)) {
        return { ...base, status: "mismatch", detail: `Installed ${installed} does not satisfy ${dependency.spec}. Reinstall to match the requirement.` };
    }
    if (!info) {
        return { ...base, status: "unknown", detail: "The latest version has not been checked." };
    }
    if (info.error && !versions.length) {
        return { ...base, status: "unknown", detail: info.error };
    }
    if (newer(ecosystem, compatible, installed)) {
        const how = ecosystem === "node" || ecosystem === "python"
            ? "within the declared range, so updating does not change the manifest."
            : "in the same major version.";
        return { ...base, status: "outdated", detail: `${compatible} is available ${how}` };
    }
    if (newer(ecosystem, latest, installed)) {
        return {
            ...base,
            status: "major",
            detail: ecosystem === "node" || ecosystem === "python"
                ? `${latest} is outside the declared range; upgrading changes the manifest. Review its changelog first.`
                : `${latest} is a new major version; review its migration notes before upgrading.`
        };
    }
    if (!latest && !versions.length) {
        return { ...base, status: "unknown", detail: "The registry returned no versions." };
    }
    return { ...base, status: "up-to-date", detail: "Installed version is the newest stable release allowed." };
}
exports.evaluateDependency = evaluateDependency;
function npmArg(name, spec) {
    return spec ? `${name}@${spec}` : name;
}
function pipArg(dependency, spec = dependency.spec) {
    return `${dependency.displayName}${dependency.extras || ""}${spec}`;
}
function upgradeRange(spec, target) {
    const trimmed = spec.trim();
    if (trimmed.startsWith("~"))
        return `~${target}`;
    if ((0, dependency_versions_1.parseSemver)(trimmed))
        return target; // an exact pin stays exact
    return `^${target}`;
}
/** Relative path to a wrapper, as a developer would type it. */
function wrapperDisplay(project, platform) {
    if (!project.wrapperPath)
        return "";
    const relative = path.relative(project.dir, project.wrapperPath) || path.basename(project.wrapperPath);
    if (platform === "win32")
        return relative.replace(/\//g, "\\");
    return relative.includes("/") ? toPosix(relative) : `./${relative}`;
}
exports.wrapperDisplay = wrapperDisplay;
/** Project-wide "install everything the manifest declares". */
function projectInstallCommand(project, missing = []) {
    switch (project.manager) {
        case "npm": return [{ tool: "npm", args: ["install", "--no-audit", "--no-fund"] }];
        case "yarn": return [{ tool: "yarn", args: ["install"] }];
        case "pnpm": return [{ tool: "pnpm", args: ["install"] }];
        case "maven": return [{ tool: project.tool, args: ["-B", "dependency:resolve"] }];
        case "gradle": return [{ tool: project.tool, args: ["dependencies", "--console=plain"] }];
        case "pip": {
            const targets = missing.length ? missing : project.dependencies;
            const files = [...new Set(targets.filter(d => d.registry && d.source !== "pyproject.toml").map(d => d.source))];
            const commands = files.map(file => ({ tool: "python", args: ["-m", "pip", "install", "--disable-pip-version-check", "-r", file] }));
            const fromPyproject = targets.filter(d => d.registry && d.source === "pyproject.toml").map(d => pipArg(d));
            if (fromPyproject.length)
                commands.push({ tool: "python", args: ["-m", "pip", "install", "--disable-pip-version-check", ...fromPyproject] });
            return commands;
        }
    }
}
exports.projectInstallCommand = projectInstallCommand;
/** Bulk in-range update. Never rewrites a manifest (pnpm may raise a range floor; see the note in the panel). */
function projectUpdateCommand(project, dependencies) {
    const targets = dependencies.filter(d => d.registry);
    if (!targets.length)
        return undefined;
    switch (project.manager) {
        case "npm": return { tool: "npm", args: ["update", "--no-audit", "--no-fund", ...targets.map(d => d.name)] };
        case "yarn": return project.yarnBerry
            ? { tool: "yarn", args: ["up", ...targets.map(d => npmArg(d.name, d.spec))] }
            : { tool: "yarn", args: ["upgrade", ...targets.map(d => d.name)] };
        case "pnpm": return { tool: "pnpm", args: ["update", ...targets.map(d => d.name)] };
        case "pip": return { tool: "python", args: ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", ...targets.map(d => pipArg(d))] };
        default: return undefined;
    }
}
exports.projectUpdateCommand = projectUpdateCommand;
/**
 * Every command that applies to one dependency, with whether the panel may
 * run it. The rules that keep production safe live here:
 *
 * - Installing what the manifest already declares is always allowed.
 * - An in-range update changes the lockfile or environment, never the manifest.
 * - An upgrade past the declared range rewrites the manifest, so it only runs
 *   for development dependencies; for everything else it is copy-only.
 * - Maven and Gradle upgrades are manifest edits, so they are always copy-only.
 */
function dependencyCommands(project, dependency, verdict) {
    const options = [];
    if (!dependency.registry)
        return options;
    const isDev = dependency.scope === "development";
    const target = verdict.latest;
    const needsInstall = verdict.status === "missing" || verdict.status === "mismatch";
    switch (project.ecosystem) {
        case "node": {
            const manager = project.manager;
            const install = projectInstallCommand(project)[0];
            options.push({ kind: "install", label: `${manager} install`, spec: install, runnable: needsInstall, note: "Installs everything the manifest declares; the manifest is not changed." });
            const devFlag = manager === "yarn" ? "--dev" : "--save-dev";
            const optionalFlag = manager === "yarn" ? "--optional" : "--save-optional";
            const flags = isDev ? [devFlag] : dependency.scope === "optional" ? [optionalFlag] : [];
            if (dependency.scope !== "peer") {
                const addArgs = manager === "npm" ? ["install", npmArg(dependency.name, dependency.spec), ...flags] : ["add", npmArg(dependency.name, dependency.spec), ...flags];
                options.push({ kind: "add", label: "Add this package", spec: { tool: manager, args: addArgs }, runnable: false, note: "Use in a fresh project; it writes the entry to package.json." });
            }
            const update = projectUpdateCommand(project, [dependency]);
            if (update && dependency.scope !== "peer") {
                options.push({ kind: "update", label: "Update within range", spec: update, runnable: verdict.status === "outdated",
                    note: manager === "pnpm" ? "pnpm may raise the range's lower bound in package.json to the installed version." : "Updates the lockfile and node_modules only." });
            }
            if (target && dependency.scope !== "peer") {
                const range = upgradeRange(dependency.spec, target);
                const args = manager === "npm"
                    ? ["install", npmArg(dependency.name, range), ...flags]
                    : manager === "yarn" && project.yarnBerry
                        ? ["up", npmArg(dependency.name, range)]
                        : ["add", npmArg(dependency.name, range), ...flags];
                options.push({
                    kind: "upgrade", label: `Upgrade to ${target}`, spec: { tool: manager, args },
                    runnable: verdict.status === "major" && isDev,
                    note: isDev ? "Rewrites this devDependency's range in package.json." : "Copy-only: production dependencies are never rewritten automatically."
                });
            }
            break;
        }
        case "python": {
            const single = { tool: "python", args: ["-m", "pip", "install", "--disable-pip-version-check", pipArg(dependency)] };
            options.push({ kind: "install", label: "pip install", spec: single, runnable: needsInstall, note: "Installs the declared requirement into the selected interpreter; no file is changed." });
            const update = { tool: "python", args: ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", pipArg(dependency)] };
            options.push({ kind: "update", label: "Upgrade within specifier", spec: update, runnable: verdict.status === "outdated", note: "Stays inside the declared specifier; no file is changed." });
            if (target) {
                options.push({
                    kind: "upgrade", label: `Upgrade to ${target}`,
                    spec: { tool: "python", args: ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", pipArg(dependency, `==${target}`)] },
                    runnable: false,
                    note: `Copy-only: this goes past the declared specifier. Update ${dependency.source} to allow ${target} so the manifest and environment agree.`
                });
            }
            break;
        }
        case "maven": {
            const [group, artifact] = dependency.name.split(":");
            options.push({
                kind: "install", label: "Download to local repository",
                spec: { tool: project.tool, args: ["-B", "dependency:get", `-Dartifact=${group}:${artifact}:${dependency.spec}`] },
                runnable: needsInstall, note: "Downloads the declared version into ~/.m2; pom.xml is not changed."
            });
            for (const [kind, version] of [["update", verdict.compatible], ["upgrade", target]]) {
                if (!version || !newer("maven", version, dependency.spec))
                    continue;
                if (kind === "upgrade" && version === verdict.compatible)
                    continue;
                options.push({
                    kind, label: `Set version ${version}`,
                    spec: { tool: project.tool, args: ["versions:use-dep-version", `-Dincludes=${group}:${artifact}`, `-DdepVersion=${version}`, "-DforceVersion=true", "-DgenerateBackupPoms=false"] },
                    runnable: false,
                    note: dependency.versionRef
                        ? `Copy-only: edits pom.xml. The version comes from the \`${dependency.versionRef}\` property; changing the property updates every artifact that uses it.`
                        : "Copy-only: edits pom.xml through the Versions Maven Plugin. Review the diff before committing."
                });
            }
            break;
        }
        case "gradle": {
            options.push({
                kind: "install", label: "Resolve dependencies",
                spec: { tool: project.tool, args: ["dependencies", "--console=plain"] },
                runnable: needsInstall, note: "Resolves and downloads the project's declared dependencies; no build file is changed."
            });
            break;
        }
    }
    return options;
}
exports.dependencyCommands = dependencyCommands;
/** The line to write into a Gradle build or catalog for a new version. */
function gradleEditHint(dependency, version) {
    if (dependency.versionRef)
        return `${dependency.versionRef.replace(/^versions\./, "")} = "${version}"`;
    return `"${dependency.name}:${version}"`;
}
exports.gradleEditHint = gradleEditHint;
// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------
/** Flags the panel itself generates. Any other `-` argument is rejected. */
const ALLOWED_FLAGS = new Set([
    "-m", "-r", "-B", "--upgrade", "--no-audit", "--no-fund", "--save-dev", "--save-optional", "--dev", "--optional",
    "--disable-pip-version-check", "--console=plain", "-DforceVersion=true", "-DgenerateBackupPoms=false"
]);
const ALLOWED_FLAG_PATTERNS = [/^-Dartifact=[\w.-]+:[\w.-]+:[\w.+-]+$/, /^-Dincludes=[\w.-]+:[\w.-]+$/, /^-DdepVersion=[\w.+-]+$/];
/** Maven goals and Gradle tasks the panel may run. */
const ALLOWED_GOALS = {
    mvn: ["dependency:resolve", "dependency:get", "versions:use-dep-version"],
    mvnw: ["dependency:resolve", "dependency:get", "versions:use-dep-version"],
    gradle: ["dependencies"],
    gradlew: ["dependencies"]
};
/** A package argument must never point the manager at code outside the registry. */
const NON_REGISTRY_ARGUMENT = /:\/\/|(?:^|@)(?:file|link|portal|patch|workspace|git(?:\+\w+)?|github|gitlab|bitbucket|https?|npm):/i;
const ALLOWED_SUBCOMMANDS = {
    npm: ["install", "update"],
    yarn: ["install", "upgrade", "up", "add"],
    pnpm: ["install", "update", "add"],
    python: ["-m"],
    mvn: ["-B", "versions:use-dep-version"],
    mvnw: ["-B", "versions:use-dep-version"],
    gradle: ["dependencies"],
    gradlew: ["dependencies"]
};
/**
 * Characters an argument may contain. Everything a shell or `cmd.exe` would
 * interpret specially (quotes, `%`, `$`, backticks, `;`, `&`, newlines) is
 * excluded, so even the Windows `.cmd` path, which has to go through
 * `cmd.exe`, cannot be made to run a second command.
 */
const SAFE_ARGUMENT = /^[A-Za-z0-9@/._\-^~<>=!*:,+|[\] ]+$/;
/** Defence in depth: validates a command right before it runs. */
function validateCommandSpec(spec) {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_SUBCOMMANDS, spec.tool)) {
        return { ok: false, reason: `\`${spec.tool}\` is not a package manager this panel runs.` };
    }
    if (!spec.args.length || spec.args.length > 400)
        return { ok: false, reason: "The command has no arguments or too many." };
    if (!ALLOWED_SUBCOMMANDS[spec.tool].includes(spec.args[0])) {
        return { ok: false, reason: `\`${spec.tool} ${spec.args[0]}\` is not an allowed operation.` };
    }
    if (spec.tool === "python" && (spec.args[1] !== "pip" || spec.args[2] !== "install")) {
        return { ok: false, reason: "Only `python -m pip install` may run." };
    }
    for (let i = 0; i < spec.args.length; i++) {
        const arg = spec.args[i];
        if (!arg || arg.length > 512 || !SAFE_ARGUMENT.test(arg)) {
            return { ok: false, reason: `Argument ${JSON.stringify(arg)} contains characters that are never passed to a package manager.` };
        }
        if (arg.startsWith("-") && !ALLOWED_FLAGS.has(arg) && !ALLOWED_FLAG_PATTERNS.some(pattern => pattern.test(arg))) {
            return { ok: false, reason: `Option ${JSON.stringify(arg)} is not one the panel generates.` };
        }
        const goals = ALLOWED_GOALS[spec.tool];
        if (goals && !arg.startsWith("-") && !goals.includes(arg)) {
            return { ok: false, reason: `\`${arg}\` is not a goal or task this panel runs.` };
        }
        if (!goals && NON_REGISTRY_ARGUMENT.test(arg)) {
            return { ok: false, reason: `${JSON.stringify(arg)} points outside the package registry, so it is never installed automatically.` };
        }
        if (arg === "-r") {
            const file = spec.args[i + 1] || "";
            if (!/^(?:[\w.-]+\/)*requirements[\w.-]*\.txt$|^requirements\/[\w.-]+\.txt$/.test(file) || file.split("/").includes("..")) {
                return { ok: false, reason: `\`-r ${file}\` must name a requirements file inside the project.` };
            }
            i++;
        }
    }
    return { ok: true };
}
exports.validateCommandSpec = validateCommandSpec;
// ---------------------------------------------------------------------------
// Cross-platform process planning
// ---------------------------------------------------------------------------
/**
 * Finds an executable on PATH without asking a shell.
 *
 * Relative PATH entries and entries inside `excluded` directories are skipped:
 * `cmd.exe` searches the working directory first, so a repository that ships
 * its own `npm.cmd` could otherwise hijack the command. Wrappers and virtual
 * environments are resolved separately and shown to the user before they run.
 */
function resolveExecutable(name, pathValue, platform, isExecutable, excluded = [], pathExt = ".COM;.EXE;.BAT;.CMD") {
    const pathApi = platform === "win32" ? path.win32 : path.posix;
    const separator = platform === "win32" ? ";" : ":";
    const extensions = platform === "win32" ? pathExt.split(";").filter(Boolean).map(ext => ext.toLowerCase()) : [""];
    for (const rawDir of pathValue.split(separator)) {
        const dir = rawDir.trim().replace(/^"(.*)"$/, "$1");
        if (!dir || !pathApi.isAbsolute(dir))
            continue;
        if (excluded.some(root => {
            const relative = pathApi.relative(root, dir);
            return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
        }))
            continue;
        for (const ext of extensions) {
            const candidate = pathApi.join(dir, name + ext);
            if (isExecutable(candidate))
                return candidate;
        }
    }
    return undefined;
}
exports.resolveExecutable = resolveExecutable;
/**
 * How to start an executable safely on each platform.
 *
 * POSIX and Windows `.exe` files are spawned directly with an argument array,
 * so no shell ever parses them. Windows `.cmd`/`.bat` shims (npm, yarn, pnpm,
 * mvn, gradle and their wrappers) cannot be spawned without `cmd.exe`; for
 * those every argument is double-quoted, AutoRun and delayed expansion are
 * disabled, and `validateCommandSpec` has already rejected `"` and `%`, the
 * only characters that can escape a quoted `cmd.exe` argument.
 */
function planSpawn(executable, args, platform, comSpec = "cmd.exe") {
    if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
        for (const value of [executable, ...args]) {
            if (/["%\r\n]/.test(value))
                throw new Error(`Refusing to pass ${JSON.stringify(value)} through cmd.exe.`);
        }
        const line = [executable, ...args].map(value => `"${value}"`).join(" ");
        return { file: comSpec, args: ["/d", "/s", "/v:off", "/c", `"${line}"`], windowsVerbatimArguments: true };
    }
    return { file: executable, args, windowsVerbatimArguments: false };
}
exports.planSpawn = planSpawn;
/** Formats a command for display and copying, quoted for the platform's usual shell. */
function formatCommandLine(spec, platform, displayTool) {
    const quote = (value) => {
        if (platform === "win32") {
            // PowerShell treats a leading `@` as splatting, `,` as an array and
            // splits `-Dkey=1.0` at the dot, so those are quoted too.
            const plain = /^[A-Za-z0-9/._\-:=+\\]+$/.test(value) && !value.startsWith("@") && !value.startsWith("-D");
            return plain ? value : `"${value}"`;
        }
        return /^[A-Za-z0-9@/._\-:=+,]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
    };
    const tool = displayTool || spec.tool;
    const shownTool = /[\s]/.test(tool) ? (platform === "win32" ? `& "${tool}"` : quote(tool)) : tool;
    return [shownTool, ...spec.args.map(quote)].join(" ");
}
exports.formatCommandLine = formatCommandLine;
/** Sets PATH on an environment object, respecting Windows' case-insensitive `Path` key. */
function withSearchPath(env, searchPath, platform) {
    const next = { ...env };
    const key = platform === "win32" ? Object.keys(next).find(k => k.toUpperCase() === "PATH") || "Path" : "PATH";
    next[key] = searchPath;
    return next;
}
exports.withSearchPath = withSearchPath;
// ---------------------------------------------------------------------------
// Installed versions
// ---------------------------------------------------------------------------
/** Where Node would load `name` from, nearest first, bounded by the workspace root. */
function nodeModuleManifestCandidates(projectDir, name, stopAt) {
    const candidates = [];
    let current = path.resolve(projectDir);
    for (;;) {
        candidates.push(path.join(current, "node_modules", ...name.split("/"), "package.json"));
        const parent = path.dirname(current);
        if (current === path.resolve(stopAt) || parent === current || !isInside(parent, stopAt))
            break;
        current = parent;
    }
    return candidates;
}
exports.nodeModuleManifestCandidates = nodeModuleManifestCandidates;
/** `pip list --format=json` output keyed by normalised name. */
function parsePipList(output) {
    const installed = new Map();
    const start = output.indexOf("[");
    if (start < 0)
        return installed;
    try {
        const rows = JSON.parse(output.slice(start));
        for (const row of rows) {
            if (row && typeof row.name === "string" && typeof row.version === "string")
                installed.set(normalizePipName(row.name), row.version);
        }
    }
    catch {
        /* unparseable output: treat nothing as installed */
    }
    return installed;
}
exports.parsePipList = parsePipList;
function mavenArtifactDir(repository, coordinate, version) {
    const [group, artifact] = coordinate.split(":");
    return path.join(repository, ...group.split("."), artifact, version);
}
exports.mavenArtifactDir = mavenArtifactDir;
function gradleArtifactDir(gradleHome, coordinate, version) {
    const [group, artifact] = coordinate.split(":");
    return path.join(gradleHome, "caches", "modules-2", "files-2.1", group, artifact, version);
}
exports.gradleArtifactDir = gradleArtifactDir;
/** `<localRepository>` from a Maven settings.xml, when set. */
function mavenLocalRepository(settingsXml, home) {
    const configured = settingsXml ? /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(stripXmlComments(settingsXml))?.[1] : undefined;
    if (configured && !configured.includes("${"))
        return configured.replace(/^~(?=[/\\])/, home);
    return path.join(home, ".m2", "repository");
}
exports.mavenLocalRepository = mavenLocalRepository;
// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
function toolInstallHint(tool, platform) {
    switch (tool) {
        case "npm": return "Install Node.js (it includes npm) from https://nodejs.org, then reopen VS Code so it picks up the new PATH.";
        case "yarn": return "Run `corepack enable` (bundled with Node.js 16.10+) or `npm install -g yarn`, then Rescan.";
        case "pnpm": return "Run `corepack enable pnpm` (bundled with Node.js 16.10+) or `npm install -g pnpm`, then Rescan.";
        case "python": return platform === "win32"
            ? "Install Python 3 from https://www.python.org (tick \"Add python.exe to PATH\"), or select an interpreter with the Python extension."
            : "Install Python 3 with your package manager or from https://www.python.org, or create a virtual environment with `python3 -m venv .venv`.";
        case "mvn": return "Install Maven (https://maven.apache.org/install.html) or add the Maven Wrapper to the project with `mvn wrapper:wrapper`.";
        case "mvnw": return "The Maven Wrapper script is missing or not executable. On macOS/Linux run `chmod +x mvnw`.";
        case "gradle": return "Install Gradle (https://gradle.org/install/) or generate the Gradle Wrapper with `gradle wrapper`.";
        case "gradlew": return "The Gradle Wrapper script is missing or not executable. On macOS/Linux run `chmod +x gradlew`.";
    }
}
exports.toolInstallHint = toolInstallHint;
const FAILURE_RULES = [
    { pattern: /externally-managed-environment/i,
        message: "This Python is managed by the operating system (PEP 668), so pip refuses to install into it. Create a virtual environment with `python3 -m venv .venv`, select it in VS Code, and press Rescan." },
    { pattern: /ERESOLVE|unable to resolve dependency tree|conflicting peer dependency|ERR_PNPM_PEER_DEP|YN0060/i,
        message: "The package manager could not satisfy peer dependency ranges. Align the conflicting versions shown in the log, or run the install manually with `--legacy-peer-deps` if you accept the risk." },
    { pattern: /ETARGET|No matching version found|No matching distribution found|Could not find a version that satisfies|ERR_PNPM_NO_MATCHING_VERSION/i,
        message: "No published version matches the requested range. Check the version in the manifest; for Python, the package may not support this interpreter version." },
    { pattern: /E404|404 Not Found|is not in (?:the npm|this) registry|Couldn't find package|ERR_PNPM_FETCH_404|YN0035/i,
        message: "The registry does not have this package. If it is private, configure its registry and credentials in `.npmrc` (or pip's index settings) and try again." },
    { pattern: /EINTEGRITY|integrity checksum failed|DO NOT MATCH THE HASHES|Checksum validation failed|YN0018/i,
        message: "A downloaded file failed its integrity check. Do not bypass it: clear the cache (`npm cache verify`, `pip cache purge`) and retry; if it persists, the lockfile or registry mirror may be compromised." },
    { pattern: /ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile|lockfile would have been modified|YN0028|npm ci can only install/i,
        message: "The lockfile is out of sync with the manifest. Run a normal install locally, review the lockfile diff, and commit it." },
    { pattern: /EBADENGINE|Unsupported engine|engine "node" is incompatible|requires-python|Requires-Python/i,
        message: "A package does not support the installed runtime version. Switch to the Node.js or Python version the project documents and retry." },
    { pattern: /gyp ERR!|node-gyp|Failed building wheel|subprocess-exited-with-error|Microsoft Visual C\+\+ \d|error: command '.*(?:gcc|clang|cl\.exe)' failed/i,
        message: "A package needs to compile native code and the build tools are missing. Install them (Xcode Command Line Tools on macOS, build-essential on Linux, Visual Studio Build Tools on Windows) and retry." },
    { pattern: /ENOSPC|No space left on device/i,
        message: "The disk is full. Free some space (package caches are a good start) and retry." },
    { pattern: /EACCES|EPERM|permission denied|Access is denied|PermissionError|Operation not permitted/i,
        message: "The package manager was not allowed to write a file. Do not re-run with sudo inside a project; fix the ownership of the project and cache folders instead. On Windows, close programs that may be locking node_modules (editors, dev servers, antivirus scans) and retry." },
    { pattern: /ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|getaddrinfo|socket hang up|Could not transfer artifact|Connection timed out|Read timed out|ProxyError|NewConnectionError|network (?:error|request)|Could not GET/i,
        message: "The registry could not be reached. Check your internet connection and, behind a corporate proxy, configure it for the package manager (HTTPS_PROXY, npm `proxy`, pip `--proxy`, Maven/Gradle proxy settings)." },
    { pattern: /SSLError|CERT_|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|self[- ]signed certificate|PKIX path building failed/i,
        message: "The registry's TLS certificate was not trusted, usually because a proxy re-signs traffic. Add your organisation's CA certificate to the tool's trust store (NODE_EXTRA_CA_CERTS, pip `cert`, the JDK truststore); do not disable verification." },
    { pattern: /Unsupported class file major version|release version \d+ not supported|JAVA_HOME|requires Java|No compiler is provided/i,
        message: "The build needs a different JDK. Install the Java version the project targets and point JAVA_HOME at it." },
    { pattern: /Could not resolve dependencies for project|Failed to collect dependencies|Could not find artifact|Could not resolve all (?:files|dependencies|artifacts)|Could not find [\w.-]+:[\w.-]+:/i,
        message: "Maven/Gradle could not resolve a dependency. Check the coordinates and version, and that the repository hosting it is declared in the build (and reachable)." },
    { pattern: /ELIFECYCLE|install script|postinstall|lifecycle script/i,
        message: "A package's install script failed. The log above shows which package and why; it usually needs a missing system tool or a newer runtime." }
];
/** Lines every failing npm/pip run prints that say nothing about the cause. */
const BOILERPLATE_LINE = /complete log of this run|_logs[\\/].*debug|^npm (?:error|ERR!)\s*$|^npm (?:error|ERR!) (?:code|errno|syscall|path) |A new release of pip|\[notice\]|Re-run Maven using|For more information about the errors|Run with --(?:stacktrace|info|debug|scan)|Get more help at|^\*\s*(?:What went wrong|Try):?$|^BUILD FAILED/i;
function meaningfulLines(output) {
    return output.split(/\r?\n/).map(line => line.trim()).filter(line => line && !BOILERPLATE_LINE.test(line));
}
/** The line that best explains a failure: the one a rule matched, else the last error-looking line. */
function errorLine(output, pattern) {
    const lines = meaningfulLines(output);
    if (pattern) {
        const matched = lines.find(line => pattern.test(line));
        if (matched)
            return matched.slice(0, 300);
    }
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/\b(error|err!|fatal|failed|exception)\b/i.test(lines[i]))
            return lines[i].slice(0, 300);
    }
    return lines.length ? lines[lines.length - 1].slice(0, 300) : undefined;
}
/** Turns a failed run into a message that says what went wrong and what to do. */
function explainFailure(context) {
    if (context.cancelled) {
        return "Cancelled. The package manager was stopped part-way, so run the install again before relying on the project.";
    }
    if (context.timedOut) {
        return `Stopped after ${context.timeoutMinutes ?? 10} minutes without finishing. Large installs on slow connections can take longer: run the command in a terminal to let it complete.`;
    }
    if (context.errorCode === "ENOENT") {
        return `\`${context.tool}\` was not found. ${toolInstallHint(context.tool, context.platform)}`;
    }
    if (context.errorCode === "EACCES" && (context.tool === "gradlew" || context.tool === "mvnw")) {
        return toolInstallHint(context.tool, context.platform);
    }
    const rule = FAILURE_RULES.find(entry => entry.pattern.test(context.output));
    const line = errorLine(context.output, rule?.pattern);
    const code = context.exitCode === undefined || context.exitCode === null ? "" : ` (exit code ${context.exitCode})`;
    if (rule)
        return `${rule.message}${line ? `\n\nDetails: ${line}` : ""}`;
    return `\`${context.tool}\` failed${code}.${line ? ` Last error: ${line}` : ""} The full log is in the "DevSnip Pro: Dependencies" output channel.`;
}
exports.explainFailure = explainFailure;
/** Python interpreter paths inside a virtual environment folder. */
function venvInterpreter(venvDir, platform) {
    return platform === "win32" ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
}
exports.venvInterpreter = venvInterpreter;
exports.STATUS_ORDER = {
    missing: 0, mismatch: 1, outdated: 2, major: 3, unknown: 4, "up-to-date": 5
};
//# sourceMappingURL=dependency-manager.js.map