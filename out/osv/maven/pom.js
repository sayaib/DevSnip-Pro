"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePomXml = exports.PomError = void 0;
const xml_parse_1 = require("../../toolkits/engines/xml-parse");
class PomError extends Error {
    constructor(message) {
        super(message);
        this.name = "PomError";
    }
}
exports.PomError = PomError;
const localName = (name) => name.slice(name.indexOf(":") + 1);
function children(element, name) {
    if (!element)
        return [];
    return element.children.filter((n) => n.type === "element" && (!name || localName(n.name) === name));
}
function child(element, name) {
    return children(element, name)[0];
}
function text(element) {
    if (!element)
        return undefined;
    const value = element.children.map(n => (n.type === "text" || n.type === "cdata" ? n.value : "")).join("").trim();
    return value;
}
function textOf(element, name) {
    const value = text(child(element, name));
    return value === undefined || value === "" ? undefined : value;
}
function readDependencies(container) {
    return children(child(container, "dependencies"), "dependency").map(dep => ({
        groupId: textOf(dep, "groupId") ?? "",
        artifactId: textOf(dep, "artifactId") ?? "",
        version: textOf(dep, "version"),
        type: textOf(dep, "type") ?? "jar",
        classifier: textOf(dep, "classifier"),
        scope: textOf(dep, "scope"),
        optional: (textOf(dep, "optional") ?? "").toLowerCase() === "true",
        exclusions: children(child(dep, "exclusions"), "exclusion").map(ex => ({ groupId: textOf(ex, "groupId") ?? "*", artifactId: textOf(ex, "artifactId") ?? "*" }))
    })).filter(dep => dep.groupId && dep.artifactId);
}
function readProperties(container) {
    const properties = {};
    for (const property of children(child(container, "properties")))
        properties[localName(property.name)] = text(property) ?? "";
    return properties;
}
function readModules(container) {
    return children(child(container, "modules"), "module").map(m => text(m) ?? "").filter(Boolean);
}
/** Parses a POM. Throws PomError for XML that is not well-formed or is not a Maven project. */
function parsePomXml(source) {
    let root;
    try {
        root = (0, xml_parse_1.parseXml)(source.replace(/^﻿/, "")).document.root;
    }
    catch (error) {
        throw new PomError(`Not well-formed XML: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (localName(root.name) !== "project")
        throw new PomError(`The root element is <${root.name}>, not <project>.`);
    const parentElement = child(root, "parent");
    let parent;
    if (parentElement) {
        const relative = child(parentElement, "relativePath");
        parent = {
            groupId: textOf(parentElement, "groupId") ?? "",
            artifactId: textOf(parentElement, "artifactId") ?? "",
            version: textOf(parentElement, "version") ?? "",
            relativePath: relative ? text(relative) ?? "" : undefined
        };
        if (!parent.groupId || !parent.artifactId || !parent.version)
            throw new PomError("The <parent> element needs groupId, artifactId and version.");
    }
    const artifactId = textOf(root, "artifactId");
    if (!artifactId)
        throw new PomError("The project has no <artifactId>.");
    const relocationElement = child(child(root, "distributionManagement"), "relocation");
    return {
        groupId: textOf(root, "groupId"),
        artifactId,
        version: textOf(root, "version"),
        packaging: textOf(root, "packaging") ?? "jar",
        parent,
        properties: readProperties(root),
        dependencies: readDependencies(root),
        managed: readDependencies(child(root, "dependencyManagement")),
        modules: readModules(root),
        repositories: children(child(root, "repositories"), "repository").map(r => textOf(r, "url") ?? "").filter(Boolean),
        profiles: children(child(root, "profiles"), "profile").map(profile => ({
            id: textOf(profile, "id") ?? "",
            activeByDefault: (textOf(child(profile, "activation"), "activeByDefault") ?? "").toLowerCase() === "true",
            properties: readProperties(profile),
            dependencies: readDependencies(profile),
            managed: readDependencies(child(profile, "dependencyManagement")),
            modules: readModules(profile)
        })),
        ...(relocationElement ? { relocation: { groupId: textOf(relocationElement, "groupId"), artifactId: textOf(relocationElement, "artifactId"), version: textOf(relocationElement, "version") } } : {})
    };
}
exports.parsePomXml = parsePomXml;
//# sourceMappingURL=pom.js.map