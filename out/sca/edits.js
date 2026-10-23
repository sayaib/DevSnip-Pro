"use strict";
/**
 * Proposed manifest changes for remediation, as pure text edits.
 *
 * Each edit is computed from the file's current text when it is previewed or
 * applied, touches only what it must (one version, one property, one entry),
 * and refuses with a reason when the file does not look as expected; nothing
 * is ever guessed. The host shows the result as a diff and applies it only
 * after the user confirms; lockfiles are never edited (the package manager
 * regenerates them).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeEdit = exports.applyEdit = exports.pomProperty = void 0;
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SAFE = /^[A-Za-z0-9@/._:+~-]+$/;
/** Keeps a range operator the user chose (^, ~, >=, ~=) when moving to a new version. */
function withOperator(previous, version) {
    const op = /^\s*(\^|~>|~=|~|>=|==|=)?\s*/.exec(previous)?.[1] ?? "";
    return `${op}${version}`;
}
function indentOf(text, at) {
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    return /^[ \t]*/.exec(text.slice(lineStart))[0];
}
function detectIndent(text) {
    return /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
}
/* ---------- npm ---------- */
function npmDependency(text, name, version) {
    let doc;
    try {
        doc = JSON.parse(text);
    }
    catch {
        return { error: "package.json is not valid JSON." };
    }
    const sections = ["dependencies", "devDependencies", "optionalDependencies"].filter(s => typeof doc[s]?.[name] === "string");
    if (!sections.length)
        return { error: `${name} is not a direct dependency in package.json.` };
    let out = text;
    for (const section of sections) {
        const sectionAt = out.search(new RegExp(`"${section}"\\s*:\\s*\\{`));
        if (sectionAt < 0)
            return { error: `Could not find the ${section} section.` };
        const entry = new RegExp(`("${esc(name)}"\\s*:\\s*")([^"]*)(")`, "g");
        entry.lastIndex = sectionAt;
        const match = entry.exec(out);
        if (!match)
            return { error: `Could not find ${name} in ${section}.` };
        if (/^(?:file|link|workspace|git|github|https?|npm):|\//.test(match[2]))
            return { error: `${name} is not installed from the registry ("${match[2]}").` };
        out = out.slice(0, match.index) + match[1] + withOperator(match[2], version) + match[3] + out.slice(match.index + match[0].length);
    }
    return { text: out };
}
function npmOverride(text, manager, name, version) {
    let doc; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
        doc = JSON.parse(text);
    }
    catch {
        return { error: "package.json is not valid JSON." };
    }
    if (manager === "npm")
        doc.overrides = { ...(doc.overrides ?? {}), [name]: version };
    else if (manager === "yarn")
        doc.resolutions = { ...(doc.resolutions ?? {}), [name]: version };
    else
        doc.pnpm = { ...(doc.pnpm ?? {}), overrides: { ...(doc.pnpm?.overrides ?? {}), [name]: version } };
    return { text: JSON.stringify(doc, null, detectIndent(text)) + (text.endsWith("\n") ? "\n" : "") };
}
/* ---------- Python ---------- */
function pipRequirement(text, name, version) {
    const flexible = name.split(/[-_.]+/).map(esc).join("[-_.]+");
    const line = new RegExp(`^(\\s*${flexible}(?:\\[[^\\]]*\\])?\\s*)((?:===?|>=|~=|<=|!=|<|>)\\s*[^;#\\s,]+(?:\\s*,\\s*(?:===?|>=|~=|<=|!=|<|>)\\s*[^;#\\s,]+)*)?`, "im");
    const match = line.exec(text);
    if (!match)
        return { error: `${name} is not listed in this requirements file.` };
    const spec = match[2] ?? "";
    const next = /^===?/.test(spec) ? `==${version}` : `>=${version}`;
    return { text: text.slice(0, match.index) + match[1].replace(/\s+$/, "") + next + text.slice(match.index + match[0].length) };
}
/* ---------- Maven ---------- */
function dependencyBlocks(text, groupId, artifactId, within) {
    const out = [];
    const pattern = /<dependency>([\s\S]*?)<\/dependency>/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        if (within && (match.index < within[0] || match.index > within[1]))
            continue;
        const body = match[1];
        if (new RegExp(`<groupId>\\s*${esc(groupId)}\\s*</groupId>`).test(body) && new RegExp(`<artifactId>\\s*${esc(artifactId)}\\s*</artifactId>`).test(body)) {
            out.push({ start: match.index, end: match.index + match[0].length, body });
        }
    }
    return out;
}
function sectionRange(text, tag) {
    const open = text.search(new RegExp(`<${tag}>`));
    if (open < 0)
        return undefined;
    const close = text.indexOf(`</${tag}>`, open);
    return close < 0 ? undefined : [open, close];
}
function setVersionInBlock(text, block, version) {
    const raw = /<version>\s*([^<]*?)\s*<\/version>/.exec(block.body);
    if (!raw)
        return { error: "The dependency declares no <version> here (it is managed elsewhere)." };
    const property = /^\$\{([^}]+)\}$/.exec(raw[1]);
    if (property) {
        if (new RegExp(`<${esc(property[1])}>`).test(text))
            return pomProperty(text, property[1], version);
        return { error: `The version comes from \${${property[1]}}, which is not defined in this file.` };
    }
    const blockText = text.slice(block.start, block.end).replace(/<version>\s*[^<]*?\s*<\/version>/, `<version>${version}</version>`);
    return { text: text.slice(0, block.start) + blockText + text.slice(block.end) };
}
function pomVersion(text, groupId, artifactId, version) {
    const management = sectionRange(text, "dependencyManagement");
    const blocks = dependencyBlocks(text, groupId, artifactId).filter(b => !management || b.start < management[0] || b.start > management[1]);
    if (!blocks.length)
        return { error: `${groupId}:${artifactId} is not declared in this POM.` };
    return setVersionInBlock(text, blocks[0], version);
}
function pomProperty(text, property, value) {
    if (!/^[\w.-]+$/.test(property))
        return { error: "Not a valid property name." };
    const existing = new RegExp(`(<${esc(property)}>)\\s*[^<]*?\\s*(</${esc(property)}>)`);
    const properties = sectionRange(text, "properties");
    if (properties && existing.test(text.slice(properties[0], properties[1]))) {
        const inner = text.slice(properties[0], properties[1]).replace(existing, `$1${value}$2`);
        return { text: text.slice(0, properties[0]) + inner + text.slice(properties[1]) };
    }
    if (properties) {
        const close = properties[1];
        const lineStart = text.lastIndexOf("\n", close - 1) + 1;
        if (text.slice(lineStart, close).trim() === "") {
            const line = `${indentOf(text, close)}${detectIndent(text)}<${property}>${value}</${property}>\n`;
            return { text: text.slice(0, lineStart) + line + text.slice(lineStart) };
        }
        return { text: `${text.slice(0, close)}<${property}>${value}</${property}>${text.slice(close)}` };
    }
    // No <properties> yet: add one after </parent>, else after the project's own <version>.
    const anchor = /<\/parent>/.exec(text) ?? /<\/version>/.exec(text);
    if (!anchor)
        return { error: "Could not find where to add a <properties> section." };
    const at = anchor.index + anchor[0].length;
    const indent = indentOf(text, anchor.index) || "  ";
    const step = detectIndent(text);
    return { text: `${text.slice(0, at)}\n${indent}<properties>\n${indent}${step}<${property}>${value}</${property}>\n${indent}</properties>${text.slice(at)}` };
}
exports.pomProperty = pomProperty;
function pomManaged(text, groupId, artifactId, version) {
    const management = sectionRange(text, "dependencyManagement");
    const step = detectIndent(text);
    const entry = (indent) => `${indent}<dependency>\n${indent}${step}<groupId>${groupId}</groupId>\n${indent}${step}<artifactId>${artifactId}</artifactId>\n${indent}${step}<version>${version}</version>\n${indent}</dependency>\n`;
    if (management) {
        const existing = dependencyBlocks(text, groupId, artifactId, management);
        if (existing.length)
            return setVersionInBlock(text, existing[0], version);
        const deps = /<dependencies>\s*\n?/.exec(text.slice(management[0], management[1]));
        if (!deps)
            return { error: "The <dependencyManagement> section has no <dependencies>." };
        // First in the list: explicit entries win over imported BOMs whatever their order, but first reads clearly.
        const insertAt = management[0] + deps.index + deps[0].length;
        const indent = indentOf(text, text.indexOf("<dependencies>", management[0])) + step;
        return { text: text.slice(0, insertAt) + entry(indent) + text.slice(insertAt) };
    }
    const anchor = /<dependencies>/.exec(text);
    if (!anchor)
        return { error: "Could not find where to add <dependencyManagement>." };
    const indent = indentOf(text, anchor.index);
    const block = `<dependencyManagement>\n${indent}${step}<dependencies>\n${entry(indent + step + step)}${indent}${step}</dependencies>\n${indent}</dependencyManagement>\n${indent}`;
    return { text: text.slice(0, anchor.index) + block + text.slice(anchor.index) };
}
function pomParent(text, version) {
    const parent = /<parent>([\s\S]*?)<\/parent>/.exec(text);
    if (!parent)
        return { error: "This POM has no <parent>." };
    const updated = parent[0].replace(/<version>\s*[^<]*?\s*<\/version>/, `<version>${version}</version>`);
    if (updated === parent[0])
        return { error: "The parent has no <version>." };
    return { text: text.slice(0, parent.index) + updated + text.slice(parent.index + parent[0].length) };
}
function pomBom(text, groupId, artifactId, version) {
    const management = sectionRange(text, "dependencyManagement");
    if (!management)
        return { error: "This POM imports no BOM." };
    const blocks = dependencyBlocks(text, groupId, artifactId, management).filter(b => /<scope>\s*import\s*<\/scope>/.test(b.body));
    if (!blocks.length)
        return { error: `${groupId}:${artifactId} is not imported in this POM.` };
    return setVersionInBlock(text, blocks[0], version);
}
/* ---------- Gradle ---------- */
function gradleVersion(text, groupId, artifactId, version) {
    const pattern = new RegExp(`(["'])${esc(groupId)}:${esc(artifactId)}:([^"':@\\s]+)((?::[^"'\\s]+)?(?:@\\w+)?\\1)`);
    const match = pattern.exec(text);
    if (!match)
        return { error: `${groupId}:${artifactId} is not declared with a literal version in this build script.` };
    if (/^\$/.test(match[2]))
        return { error: `The version comes from ${match[2]}; change that property instead.` };
    return { text: text.slice(0, match.index) + `${match[1]}${groupId}:${artifactId}:${version}${match[3]}` + text.slice(match.index + match[0].length) };
}
function gradleExt(text, file, property, value) {
    const kotlin = file.endsWith(".kts");
    const existing = kotlin
        ? new RegExp(`(extra\\[\\s*"${esc(property)}"\\s*\\]\\s*=\\s*")([^"]*)(")`)
        : new RegExp(`(ext\\s*\\[\\s*['"]${esc(property)}['"]\\s*\\]\\s*=\\s*['"])([^'"]*)(['"])`);
    if (existing.test(text))
        return { text: text.replace(existing, `$1${value}$3`) };
    const line = kotlin ? `extra["${property}"] = "${value}"` : `ext['${property}'] = '${value}'`;
    // After the plugins block, where Spring's dependency-management plugin reads it.
    const plugins = /plugins\s*\{[\s\S]*?\n\}[ \t]*\n/.exec(text);
    const at = plugins ? plugins.index + plugins[0].length : 0;
    return { text: `${text.slice(0, at)}${at ? "\n" : ""}${line}\n${at ? "" : "\n"}${text.slice(at)}` };
}
function gradlePlugin(text, pluginId, version) {
    const pattern = new RegExp(`(id\\s*\\(?\\s*["']${esc(pluginId)}["']\\s*\\)?\\s*version\\s*\\(?\\s*["'])([^"']+)(["'])`);
    if (!pattern.test(text))
        return { error: `The ${pluginId} plugin version is not declared in this build script.` };
    return { text: text.replace(pattern, `$1${version}$3`) };
}
/* ---------- .NET, PHP, Rust ---------- */
function csprojVersion(text, id, version) {
    const element = new RegExp(`(<PackageReference\\b[^>]*\\bInclude\\s*=\\s*"${esc(id)}"[^>]*?\\bVersion\\s*=\\s*")([^"]*)(")`, "i");
    if (element.test(text))
        return { text: text.replace(element, `$1${version}$3`) };
    return { error: `${id} has no Version attribute in this project file (it may come from Directory.Packages.props).` };
}
function composerRequire(text, name, version) {
    const entry = new RegExp(`("${esc(name)}"\\s*:\\s*")([^"]*)(")`);
    const match = entry.exec(text);
    if (!match)
        return { error: `${name} is not required in composer.json.` };
    return { text: text.slice(0, match.index) + match[1] + `^${version}` + match[3] + text.slice(match.index + match[0].length) };
}
function cargoVersion(text, name, version) {
    const simple = new RegExp(`^(\\s*${esc(name)}\\s*=\\s*")([^"]*)(")`, "m");
    if (simple.test(text))
        return { text: text.replace(simple, (_m, a, old, c) => `${a}${old.startsWith("=") ? "=" : ""}${version}${c}`) };
    const table = new RegExp(`^(\\s*${esc(name)}\\s*=\\s*\\{[^}\\n]*\\bversion\\s*=\\s*")([^"]*)(")`, "m");
    if (table.test(text))
        return { text: text.replace(table, (_m, a, old, c) => `${a}${old.startsWith("=") ? "=" : ""}${version}${c}`) };
    return { error: `${name} is not declared with a version in Cargo.toml.` };
}
/** Applies an edit to the file's current text. */
function applyEdit(spec, text) {
    const values = Object.entries(spec).filter(([key]) => key !== "op" && key !== "file").map(([, v]) => String(v));
    if (values.some(v => !SAFE.test(v)))
        return { error: "The change contains characters that are not safe to write." };
    switch (spec.op) {
        case "npm-dependency": return npmDependency(text, spec.name, spec.version);
        case "npm-override": return npmOverride(text, spec.manager, spec.name, spec.version);
        case "pip-requirement": return pipRequirement(text, spec.name, spec.version);
        case "pom-version": return pomVersion(text, spec.groupId, spec.artifactId, spec.version);
        case "pom-property": return pomProperty(text, spec.property, spec.value);
        case "pom-managed": return pomManaged(text, spec.groupId, spec.artifactId, spec.version);
        case "pom-parent": return pomParent(text, spec.version);
        case "pom-bom": return pomBom(text, spec.groupId, spec.artifactId, spec.version);
        case "gradle-version": return gradleVersion(text, spec.groupId, spec.artifactId, spec.version);
        case "gradle-ext": return gradleExt(text, spec.file, spec.property, spec.value);
        case "gradle-plugin": return gradlePlugin(text, spec.pluginId, spec.version);
        case "csproj-version": return csprojVersion(text, spec.id, spec.version);
        case "composer-require": return composerRequire(text, spec.name, spec.version);
        case "cargo-version": return cargoVersion(text, spec.name, spec.version);
    }
}
exports.applyEdit = applyEdit;
/** A one-line description of an edit, for the confirmation dialog. */
function describeEdit(spec) {
    switch (spec.op) {
        case "npm-dependency": return `Set ${spec.name} to ${spec.version} in ${spec.file}`;
        case "npm-override": return `Force ${spec.name} ${spec.version} for every copy (${spec.manager === "npm" ? "overrides" : spec.manager === "yarn" ? "resolutions" : "pnpm.overrides"}) in ${spec.file}`;
        case "pip-requirement": return `Require ${spec.name} ${spec.version} in ${spec.file}`;
        case "pom-version": return `Set ${spec.groupId}:${spec.artifactId} to ${spec.version} in ${spec.file}`;
        case "pom-property": return `Set the property ${spec.property} to ${spec.value} in ${spec.file}`;
        case "pom-managed": return `Manage ${spec.groupId}:${spec.artifactId} at ${spec.version} in the <dependencyManagement> of ${spec.file}`;
        case "pom-parent": return `Set the parent version to ${spec.version} in ${spec.file}`;
        case "pom-bom": return `Import ${spec.groupId}:${spec.artifactId} ${spec.version} in ${spec.file}`;
        case "gradle-version": return `Set ${spec.groupId}:${spec.artifactId} to ${spec.version} in ${spec.file}`;
        case "gradle-ext": return `Set ${spec.property} = ${spec.value} in ${spec.file} (read by Spring's dependency-management plugin)`;
        case "gradle-plugin": return `Set the ${spec.pluginId} plugin to ${spec.version} in ${spec.file}`;
        case "csproj-version": return `Set ${spec.id} to ${spec.version} in ${spec.file}`;
        case "composer-require": return `Require ${spec.name} ^${spec.version} in ${spec.file}`;
        case "cargo-version": return `Set ${spec.name} to ${spec.version} in ${spec.file}`;
    }
}
exports.describeEdit = describeEdit;
//# sourceMappingURL=edits.js.map