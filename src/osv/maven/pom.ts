import { parseXml, XmlElement, XmlNode } from "../../toolkits/engines/xml-parse";

/**
 * A Maven POM as written: coordinates, parent, properties, dependencies,
 * dependency management, modules, repositories, profiles and relocation.
 * Nothing is inherited or interpolated here; `model.ts` builds the effective
 * model from these raw parts the way Maven does.
 */

export interface PomExclusion { groupId: string; artifactId: string }

export interface PomDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  type: string;
  classifier?: string;
  scope?: string;
  optional: boolean;
  exclusions: PomExclusion[];
}

export interface PomParent {
  groupId: string;
  artifactId: string;
  version: string;
  /** `undefined`: Maven's default `../pom.xml`; empty string: look up in repositories only. */
  relativePath?: string;
}

export interface PomProfile {
  id: string;
  activeByDefault: boolean;
  properties: Record<string, string>;
  dependencies: PomDependency[];
  managed: PomDependency[];
  modules: string[];
}

export interface RawPom {
  groupId?: string;
  artifactId: string;
  version?: string;
  packaging: string;
  parent?: PomParent;
  properties: Record<string, string>;
  dependencies: PomDependency[];
  managed: PomDependency[];
  modules: string[];
  repositories: string[];
  profiles: PomProfile[];
  relocation?: { groupId?: string; artifactId?: string; version?: string };
}

export class PomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PomError";
  }
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

function children(element: XmlElement | undefined, name?: string): XmlElement[] {
  if (!element) return [];
  return element.children.filter((n: XmlNode): n is XmlElement => n.type === "element" && (!name || localName(n.name) === name));
}

function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return children(element, name)[0];
}

function text(element: XmlElement | undefined): string | undefined {
  if (!element) return undefined;
  const value = element.children.map(n => (n.type === "text" || n.type === "cdata" ? n.value : "")).join("").trim();
  return value;
}

function textOf(element: XmlElement | undefined, name: string): string | undefined {
  const value = text(child(element, name));
  return value === undefined || value === "" ? undefined : value;
}

function readDependencies(container: XmlElement | undefined): PomDependency[] {
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

function readProperties(container: XmlElement | undefined): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const property of children(child(container, "properties"))) properties[localName(property.name)] = text(property) ?? "";
  return properties;
}

function readModules(container: XmlElement | undefined): string[] {
  return children(child(container, "modules"), "module").map(m => text(m) ?? "").filter(Boolean);
}

/** Parses a POM. Throws PomError for XML that is not well-formed or is not a Maven project. */
export function parsePomXml(source: string): RawPom {
  let root: XmlElement;
  try {
    root = parseXml(source.replace(/^﻿/, "")).document.root;
  } catch (error) {
    throw new PomError(`Not well-formed XML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (localName(root.name) !== "project") throw new PomError(`The root element is <${root.name}>, not <project>.`);
  const parentElement = child(root, "parent");
  let parent: PomParent | undefined;
  if (parentElement) {
    const relative = child(parentElement, "relativePath");
    parent = {
      groupId: textOf(parentElement, "groupId") ?? "",
      artifactId: textOf(parentElement, "artifactId") ?? "",
      version: textOf(parentElement, "version") ?? "",
      relativePath: relative ? text(relative) ?? "" : undefined
    };
    if (!parent.groupId || !parent.artifactId || !parent.version) throw new PomError("The <parent> element needs groupId, artifactId and version.");
  }
  const artifactId = textOf(root, "artifactId");
  if (!artifactId) throw new PomError("The project has no <artifactId>.");
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
