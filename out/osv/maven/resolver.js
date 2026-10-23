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
exports.createPomRepository = exports.pomPath = exports.MavenResolver = exports.transitiveScope = exports.isVersionRange = exports.interpolate = exports.MAVEN_CENTRAL = exports.gavString = void 0;
const path = __importStar(require("path"));
const dependency_versions_1 = require("../../services/dependency-versions");
const versions_1 = require("../versions");
const pom_1 = require("./pom");
const gavString = (g) => `${g.groupId}:${g.artifactId}:${g.version}`;
exports.gavString = gavString;
exports.MAVEN_CENTRAL = "https://repo.maven.apache.org/maven2";
const managementKey = (d) => `${d.groupId}:${d.artifactId}:${d.type ?? "jar"}:${d.classifier ?? ""}`;
const conflictKey = (d) => `${d.groupId}:${d.artifactId}:${d.classifier ?? ""}`;
const hasExpression = (value) => value !== undefined && value.includes("${");
function interpolate(value, properties, depth = 0) {
    if (!value.includes("${") || depth > 12)
        return value;
    return value.replace(/\$\{([^}]+)\}/g, (match, key) => {
        const resolved = properties[key];
        return resolved === undefined ? match : interpolate(resolved, properties, depth + 1);
    });
}
exports.interpolate = interpolate;
/** A version Maven would treat as a range (resolved from repository metadata, which is not read here). */
function isVersionRange(version) {
    return /^[[(]/.test(version.trim()) || /,/.test(version);
}
exports.isVersionRange = isVersionRange;
const SCOPE_RANK = { compile: 4, runtime: 3, provided: 2, system: 2, test: 1 };
/** Maven's scope of a transitive dependency, or undefined when it is not transitive. */
function transitiveScope(parent, child) {
    if (child === "test" || child === "provided" || child === "system" || child === "import")
        return undefined;
    switch (parent) {
        case "compile": return child === "runtime" ? "runtime" : "compile";
        case "runtime": return "runtime";
        case "provided": return "provided";
        case "test": return "test";
        default: return undefined;
    }
}
exports.transitiveScope = transitiveScope;
function excluded(dep, exclusions) {
    return exclusions.some(ex => (ex.groupId === "*" || ex.groupId === dep.groupId) && (ex.artifactId === "*" || ex.artifactId === dep.artifactId));
}
class MavenResolver {
    /**
     * `importOverrides` gives Gradle semantics: a project's properties override the same-named properties of the
     * BOMs it imports (and of the BOMs those import), as Spring's dependency-management plugin does. Maven never does this.
     */
    constructor(workspacePoms, repository, signal, options = {}) {
        this.repository = repository;
        this.signal = signal;
        this.options = options;
        this.workspace = new Map();
        this.workspaceErrors = new Map();
        this.workspaceByGav = new Map();
        this.models = new Map();
        this.effectives = new Map();
        this.repositories = new Set([exports.MAVEN_CENTRAL]);
        this.stats = { pomsFromWorkspace: 0, pomsFetched: 0, pomsMissing: 0 };
        for (const pom of workspacePoms) {
            try {
                this.workspace.set(pom.path, (0, pom_1.parsePomXml)(pom.text));
            }
            catch (error) {
                this.workspaceErrors.set(pom.path, error instanceof Error ? error.message : String(error));
            }
        }
        for (const [file, raw] of this.workspace) {
            const gav = this.rawGav(raw, file);
            if (gav)
                this.workspaceByGav.set((0, exports.gavString)(gav), file);
        }
    }
    /** Workspace POMs that could not be read, with the reason. */
    get invalid() { return this.workspaceErrors; }
    /** Workspace modules that are not a `<module>` of another workspace POM: the reactor roots. */
    reactorRoots() {
        const children = new Set();
        for (const [file, raw] of this.workspace) {
            const dir = path.posix.dirname(file);
            for (const module of [...raw.modules, ...raw.profiles.flatMap(p => p.modules)]) {
                const target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, module));
                children.add(target.endsWith(".xml") ? target : `${target}/pom.xml`.replace(/^\.\//, ""));
            }
        }
        return [...this.workspace.keys()].filter(file => !children.has(file));
    }
    /** Every module of the reactor rooted at `root` (including the root). */
    reactorModules(root) {
        const out = [];
        const visit = (file) => {
            if (out.includes(file) || !this.workspace.has(file))
                return;
            out.push(file);
            const raw = this.workspace.get(file);
            const dir = path.posix.dirname(file);
            for (const module of [...raw.modules, ...raw.profiles.filter(p => p.activeByDefault).flatMap(p => p.modules)]) {
                const target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, module));
                visit(target.endsWith(".xml") ? target : `${target}/pom.xml`);
            }
        };
        visit(root);
        return out;
    }
    /** The workspace parent a POM's `<parent>` points at through `relativePath`, if it is there. */
    workspaceParent(file, raw) {
        const p = raw.parent;
        if (!p || p.relativePath === "")
            return undefined;
        const dir = path.posix.dirname(file);
        let candidate = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, p.relativePath ?? "../pom.xml"));
        if (!candidate.endsWith(".xml"))
            candidate = `${candidate}/pom.xml`;
        candidate = candidate.replace(/^\.\//, "");
        const local = this.workspace.get(candidate);
        return local && local.artifactId === p.artifactId && (local.groupId ?? local.parent?.groupId) === p.groupId ? candidate : undefined;
    }
    /** Properties along the workspace parent chain (CI-friendly `${revision}` lives in the root POM). */
    workspaceProperties(file, seen = []) {
        const raw = this.workspace.get(file);
        if (!raw || seen.includes(file))
            return {};
        const parent = this.workspaceParent(file, raw);
        return { ...(parent ? this.workspaceProperties(parent, [...seen, file]) : {}), ...raw.properties };
    }
    /** Coordinates of a workspace POM, inheriting groupId/version from its parent element. */
    rawGav(raw, file) {
        const groupId = raw.groupId ?? raw.parent?.groupId;
        const version = raw.version ?? raw.parent?.version;
        if (!groupId || !version)
            return undefined;
        const props = file ? this.workspaceProperties(file) : { ...raw.properties };
        return { groupId: interpolate(groupId, props), artifactId: raw.artifactId, version: interpolate(version, props) };
    }
    workspaceGav(file) {
        const raw = this.workspace.get(file);
        return raw ? this.rawGav(raw, file) : undefined;
    }
    async loadModel(source, chain) {
        const id = "path" in source ? `ws:${source.path}` : (0, exports.gavString)(source.gav);
        if (chain.includes(id))
            return { error: `Parent cycle: ${[...chain, id].join(" → ")}` };
        let promise = this.models.get(id);
        if (!promise) {
            promise = this.buildModel(source, id, chain);
            this.models.set(id, promise);
        }
        return promise;
    }
    async rawFor(source) {
        if ("path" in source) {
            const raw = this.workspace.get(source.path);
            if (raw) {
                this.stats.pomsFromWorkspace++;
                return { raw, path: source.path };
            }
            return { error: this.workspaceErrors.get(source.path) ?? `${source.path} is not in the workspace.` };
        }
        const local = this.workspaceByGav.get((0, exports.gavString)(source.gav));
        if (local) {
            this.stats.pomsFromWorkspace++;
            return { raw: this.workspace.get(local), path: local };
        }
        const found = await this.repository.fetch(source.gav, [...this.repositories], this.signal);
        if ("error" in found) {
            this.stats.pomsMissing++;
            return found;
        }
        this.stats.pomsFetched++;
        try {
            return { raw: (0, pom_1.parsePomXml)(found.text) };
        }
        catch (error) {
            return { error: `The POM of ${(0, exports.gavString)(source.gav)} from ${found.origin} could not be read: ${error instanceof pom_1.PomError ? error.message : String(error)}` };
        }
    }
    async buildModel(source, id, chain) {
        const loaded = await this.rawFor(source);
        if ("error" in loaded)
            return loaded;
        const { raw } = loaded;
        const problems = [];
        let parent;
        if (raw.parent) {
            const p = raw.parent;
            const parentVersion = interpolate(p.version, loaded.path ? this.workspaceProperties(loaded.path) : raw.properties);
            let parentSource;
            const workspaceParent = loaded.path ? this.workspaceParent(loaded.path, raw) : undefined;
            if (workspaceParent)
                parentSource = { path: workspaceParent };
            parentSource ?? (parentSource = { gav: { groupId: p.groupId, artifactId: p.artifactId, version: parentVersion } });
            if ("gav" in parentSource && hasExpression(parentVersion)) {
                problems.push(`The parent version ${p.version} uses a property that is not defined where Maven reads it.`);
            }
            else {
                const loadedParent = await this.loadModel(parentSource, [...chain, id]);
                if ("error" in loadedParent)
                    problems.push(`Parent POM ${p.groupId}:${p.artifactId}:${parentVersion} could not be loaded: ${loadedParent.error}`);
                else
                    parent = loadedParent;
            }
        }
        const active = raw.profiles.filter(profile => profile.activeByDefault);
        const groupId = raw.groupId ?? raw.parent?.groupId ?? "";
        const version = raw.version ?? raw.parent?.version ?? "";
        const properties = { ...(parent?.properties ?? {}) };
        for (const profile of active)
            Object.assign(properties, profile.properties);
        Object.assign(properties, raw.properties);
        const gav = { groupId: interpolate(groupId, properties), artifactId: raw.artifactId, version: interpolate(version, properties) };
        const builtins = {
            "project.groupId": gav.groupId, "project.artifactId": gav.artifactId, "project.version": gav.version, "project.packaging": raw.packaging,
            "pom.groupId": gav.groupId, "pom.artifactId": gav.artifactId, "pom.version": gav.version,
            groupId: gav.groupId, artifactId: gav.artifactId, version: gav.version
        };
        if (raw.parent) {
            Object.assign(builtins, {
                "project.parent.groupId": raw.parent.groupId, "project.parent.artifactId": raw.parent.artifactId,
                "project.parent.version": interpolate(raw.parent.version, properties), "parent.version": interpolate(raw.parent.version, properties)
            });
        }
        Object.assign(properties, builtins);
        // Only user-settable properties: ${project.version} and other built-ins cannot be overridden by a build.
        const property = (version) => {
            const name = /^\$\{([^}]+)\}$/.exec(version?.trim() ?? "")?.[1];
            return name && !/^(?:project|pom|parent|env|settings|session)\.|^(?:version|groupId|artifactId|basedir)$/.test(name) ? name : undefined;
        };
        const ownManaged = [...raw.managed, ...active.flatMap(p => p.managed)].map(d => ({
            ...d,
            origin: { kind: loaded.path ? "workspace" : "parent", source: (0, exports.gavString)(gav), ...(loaded.path ? { path: loaded.path } : {}), ...(property(d.version) ? { property: property(d.version) } : {}) }
        }));
        const isImport = (d) => d.scope === "import" && d.type === "pom";
        for (const repo of raw.repositories)
            if (/^https:\/\//i.test(repo))
                this.repositories.add(repo.replace(/\/+$/, ""));
        return {
            id, path: loaded.path, raw, gav, packaging: raw.packaging, properties,
            dependencies: [...raw.dependencies, ...active.flatMap(p => p.dependencies), ...(parent?.dependencies ?? [])],
            explicitManaged: [...ownManaged.filter(d => !isImport(d)), ...(parent?.explicitManaged ?? [])],
            imports: [...ownManaged.filter(isImport), ...(parent?.imports ?? [])],
            repositories: [...raw.repositories, ...(parent?.repositories ?? [])],
            problems: [...problems, ...(parent?.problems ?? [])],
            relocation: raw.relocation
        };
    }
    interpolated(dep, properties) {
        return {
            ...dep,
            groupId: interpolate(dep.groupId, properties),
            artifactId: interpolate(dep.artifactId, properties),
            version: dep.version === undefined ? undefined : interpolate(dep.version, properties),
            type: interpolate(dep.type, properties),
            classifier: dep.classifier === undefined ? undefined : interpolate(dep.classifier, properties),
            scope: dep.scope === undefined ? undefined : interpolate(dep.scope, properties)
        };
    }
    effective(model, chain = []) {
        let promise = this.effectives.get(model.id);
        if (!promise) {
            promise = this.buildEffective(model, chain);
            this.effectives.set(model.id, promise);
        }
        return promise;
    }
    /** The BOM as the importing model sees it: with Gradle-style property overrides applied (a distinct model id, so it is cached apart). */
    overridden(bom, importer) {
        if (!this.options.importOverrides)
            return bom;
        const source = importer.overrides ?? importer.raw.properties ?? {};
        const entries = Object.entries(source);
        if (!entries.length)
            return bom;
        const applied = entries.filter(([key, value]) => key in bom.properties && bom.properties[key] !== value);
        return {
            ...bom,
            // The override set is part of the id: nested BOMs see the same overrides, and results are cached per set.
            id: `${bom.id}#${entries.map(([k, v]) => `${k}=${v}`).sort().join("&")}`,
            properties: { ...bom.properties, ...Object.fromEntries(applied) },
            overrides: { ...source }
        };
    }
    async buildEffective(model, chain) {
        const managed = new Map();
        for (const dep of model.explicitManaged) {
            const d = this.interpolated(dep, model.properties);
            const key = managementKey(d);
            if (!managed.has(key))
                managed.set(key, d);
        }
        // Imported BOMs: fetched together, applied in declaration order, never overriding explicit entries.
        const imports = model.imports.map(dep => this.interpolated(dep, model.properties));
        const boms = await Promise.all(imports.map(async (imp) => {
            if (!imp.version || hasExpression(imp.version))
                return { error: `The BOM ${imp.groupId}:${imp.artifactId} has an unresolved version (${imp.version ?? "none"}).` };
            const gav = { groupId: imp.groupId, artifactId: imp.artifactId, version: imp.version };
            if (chain.includes((0, exports.gavString)(gav)))
                return { error: `BOM import cycle at ${(0, exports.gavString)(gav)}` };
            const bomModel = await this.loadModel({ gav }, []);
            if ("error" in bomModel)
                return { error: `BOM ${(0, exports.gavString)(gav)} could not be loaded: ${bomModel.error}` };
            return { effective: await this.effective(this.overridden(bomModel, model), [...chain, model.id, (0, exports.gavString)(gav)]), gav };
        }));
        for (const bom of boms) {
            if ("error" in bom) {
                if (!model.problems.includes(bom.error))
                    model.problems.push(bom.error);
                continue;
            }
            for (const [key, entry] of bom.effective.managed) {
                if (managed.has(key))
                    continue;
                // Seen from this model, everything a BOM brings is "import", named after the BOM imported here.
                const declared = imports[boms.indexOf(bom)];
                const via = declared.origin && declared.origin.kind !== "import"
                    ? { kind: declared.origin.kind, source: declared.origin.source, ...(declared.origin.path ? { path: declared.origin.path } : {}), ...(declared.origin.property ? { property: declared.origin.property } : {}) }
                    : undefined;
                const nested = entry.origin?.kind === "import";
                managed.set(key, {
                    ...entry,
                    origin: {
                        ...(entry.origin ?? { source: (0, exports.gavString)(bom.gav) }),
                        kind: "import",
                        bom: (0, exports.gavString)(bom.gav),
                        ...(via ? { importedBy: via } : {}),
                        // The innermost BOM keeps its own name and the property its import reads.
                        ...(nested ? {} : { directBom: (0, exports.gavString)(bom.gav), ...(via?.property ? { directBomProperty: via.property } : {}) })
                    }
                });
            }
        }
        const seen = new Set();
        const dependencies = [];
        for (const raw of model.dependencies) {
            const d = this.interpolated(raw, model.properties);
            const key = managementKey(d);
            if (seen.has(key))
                continue; // the child's declaration wins over an inherited one
            seen.add(key);
            const m = managed.get(key);
            dependencies.push({
                ...d,
                version: d.version ?? m?.version,
                scope: d.scope ?? m?.scope,
                exclusions: [...d.exclusions, ...(m?.exclusions ?? [])]
            });
        }
        return { model, dependencies, managed };
    }
    /** The effective model of a published artifact, following relocations. */
    async artifact(gav) {
        let current = gav;
        for (let hop = 0; hop < 4; hop++) {
            const model = await this.loadModel({ gav: current }, []);
            if ("error" in model)
                return model;
            const relocation = model.relocation;
            if (relocation && (relocation.groupId || relocation.artifactId || relocation.version)) {
                const next = { groupId: relocation.groupId ?? current.groupId, artifactId: relocation.artifactId ?? current.artifactId, version: relocation.version ?? current.version };
                if ((0, exports.gavString)(next) === (0, exports.gavString)(current))
                    break;
                current = next;
                continue;
            }
            return { effective: await this.effective(model), gav: current };
        }
        return { error: `Too many relocations from ${(0, exports.gavString)(gav)}.` };
    }
    /** Maven's choice for a version range: the highest published version inside it. */
    async highestInRange(groupId, artifactId, range) {
        const spans = (0, versions_1.spansFromInterval)(range);
        if (!spans)
            return { error: "the range could not be read." };
        if (!this.repository.versions)
            return { error: "repository metadata is not available to pick a version." };
        const versions = await this.repository.versions(groupId, artifactId, [...this.repositories], this.signal);
        if (!Array.isArray(versions))
            return { error: `its published versions could not be read (${versions.error})` };
        const matching = versions.filter(v => !/-SNAPSHOT$/i.test(v) && spans.some(span => (0, versions_1.spanContains)(span, v, dependency_versions_1.compareMaven)));
        if (!matching.length)
            return { error: "no published version is inside it." };
        return { version: matching.reduce((best, v) => ((0, dependency_versions_1.compareMaven)(v, best) > 0 ? v : best)) };
    }
    /**
     * The version a published BOM (or parent) manages for one artifact, loading
     * only what is needed: the BOM with its parents, then, when the artifact is
     * not managed there directly, the imported BOM named by `via` (or each import
     * in order). A full effective model would load every nested BOM, which is
     * dozens of POMs for spring-boot-dependencies.
     */
    async managedVersion(bom, groupId, artifactId, via, depth = 0) {
        if (depth > 4)
            return undefined;
        const model = await this.loadModel({ gav: bom }, []);
        if ("error" in model)
            return undefined;
        for (const entry of model.explicitManaged) {
            const d = this.interpolated(entry, model.properties);
            if (d.groupId === groupId && d.artifactId === artifactId && d.version && !hasExpression(d.version))
                return d.version;
        }
        const imports = model.imports.map(dep => this.interpolated(dep, model.properties)).filter(d => d.version && !hasExpression(d.version));
        const ordered = via ? [...imports.filter(d => d.groupId === via.groupId && d.artifactId === via.artifactId), ...imports.filter(d => !(d.groupId === via.groupId && d.artifactId === via.artifactId))] : imports;
        for (const imp of ordered) {
            const found = await this.managedVersion({ groupId: imp.groupId, artifactId: imp.artifactId, version: imp.version }, groupId, artifactId, undefined, depth + 1);
            if (found)
                return found;
            if (via)
                break; // the BOM that managed it before does not any more: do not load every other import to look for it
        }
        return undefined;
    }
    /**
     * Where each version managed for a workspace module comes from, keyed "group:artifact".
     * Used to explain what controls a vulnerable version (Spring Boot's BOM, a property, your own POM).
     */
    async managementOf(file) {
        const out = new Map();
        const model = await this.loadModel({ path: file }, []);
        if ("error" in model)
            return out;
        const root = await this.effective(model);
        for (const entry of root.managed.values()) {
            const key = `${entry.groupId}:${entry.artifactId}`;
            if (!entry.version || hasExpression(entry.version) || out.has(key) || !entry.origin)
                continue;
            out.set(key, { ...entry.origin, version: entry.version });
        }
        return out;
    }
    /**
     * Resolves the dependency graph of one workspace module.
     * conflict "nearest" is Maven's rule; "highest" is Gradle's (the highest
     * requested version wins), applied until no request is higher than its
     * selection. Versions the root's dependency management sets are enforced
     * either way (Maven's dependencyManagement, Spring's dependency-management plugin).
     */
    async resolveModule(file, options = {}) {
        if (options.conflict !== "highest")
            return (await this.resolveGraph(file, new Map())).resolution;
        const forced = new Map();
        for (let round = 0; round < 10; round++) {
            const { resolution, requested, managed } = await this.resolveGraph(file, forced);
            let raised = false;
            for (const [key, versions] of requested) {
                if (managed.has(key))
                    continue;
                const highest = versions.reduce((best, v) => ((0, dependency_versions_1.compareMaven)(v, best) > 0 ? v : best));
                const selected = forced.get(key) ?? resolution.dependencies.find(d => conflictKey(d) === key)?.version;
                if (selected && (0, dependency_versions_1.compareMaven)(highest, selected) > 0) {
                    forced.set(key, highest);
                    raised = true;
                }
            }
            if (!raised)
                return resolution;
        }
        return (await this.resolveGraph(file, forced)).resolution;
    }
    async resolveGraph(file, forced) {
        const requested = new Map();
        const managedKeys = new Set();
        const model = await this.loadModel({ path: file }, []);
        if ("error" in model) {
            return { resolution: { path: file, gav: { groupId: "", artifactId: "", version: "" }, packaging: "jar", dependencies: [], unresolved: [], problems: [model.error] }, requested, managed: managedKeys };
        }
        const root = await this.effective(model);
        const internal = new Set([...this.workspaceByGav.keys()].map(key => key.split(":").slice(0, 2).join(":")));
        const resolved = new Map();
        const unresolved = [];
        let level = root.dependencies
            .filter(d => d.scope !== "import")
            .map(d => ({ dep: d, depth: 1, via: [], exclusions: d.exclusions, scope: d.scope ?? "compile" }));
        const problems = [...model.problems];
        /** Edges from a resolved node to the nodes it brought in, with the scope each was declared with. */
        const edges = new Map();
        const widen = (key, scope) => {
            const node = resolved.get(key);
            if (!node || (SCOPE_RANK[scope] ?? 0) <= (SCOPE_RANK[node.scope] ?? 0))
                return;
            node.scope = scope;
            for (const edge of edges.get(key) ?? []) {
                const childScope = transitiveScope(scope, edge.declared);
                if (childScope)
                    widen(edge.key, childScope);
            }
        };
        for (let depth = 1; level.length && depth <= 60; depth++) {
            if (this.signal?.aborted)
                break;
            const winners = [];
            for (const item of level) {
                const dep = item.dep;
                const key = conflictKey(dep);
                let version = dep.version;
                let scope = item.scope;
                if (item.parentKey) {
                    const parent = resolved.get(item.parentKey);
                    const current = parent ? transitiveScope(parent.scope, item.declared ?? "compile") : undefined;
                    if (current && (SCOPE_RANK[current] ?? 0) > (SCOPE_RANK[scope] ?? 0))
                        scope = current;
                }
                if (depth > 1) {
                    // The root's dependency management overrides transitive versions and scopes.
                    const managed = root.managed.get(managementKey(dep));
                    if (managed?.version) {
                        version = managed.version;
                        managedKeys.add(key);
                    }
                    if (managed?.scope && managed.scope !== "import")
                        scope = managed.scope;
                }
                else if (!dep.version && root.managed.get(managementKey(dep))?.version) {
                    managedKeys.add(key);
                }
                if (version && !hasExpression(version) && !isVersionRange(version))
                    requested.set(key, [...(requested.get(key) ?? []), version]);
                if (forced.has(key) && !managedKeys.has(key))
                    version = forced.get(key);
                const existing = resolved.get(key);
                if (existing) {
                    // Nearest wins; a later path only widens the scope (Maven's scope update), down through its dependencies.
                    widen(key, scope);
                    continue;
                }
                if (unresolved.some(u => u.groupId === dep.groupId && u.artifactId === dep.artifactId))
                    continue;
                if (!version) {
                    unresolved.push({ groupId: dep.groupId, artifactId: dep.artifactId, depth, via: item.via, reason: depth === 1 ? "No version is declared or managed for it (by this POM, its parents or imported BOMs)." : "Its version is not declared or managed anywhere Maven would look." });
                    continue;
                }
                if (hasExpression(version)) {
                    unresolved.push({ groupId: dep.groupId, artifactId: dep.artifactId, depth, via: item.via, declared: version, reason: `Its version ${version} uses a property that is not defined.` });
                    continue;
                }
                if (isVersionRange(version)) {
                    const picked = await this.highestInRange(dep.groupId, dep.artifactId, version);
                    if ("error" in picked) {
                        unresolved.push({ groupId: dep.groupId, artifactId: dep.artifactId, depth, via: item.via, declared: version, reason: `Its version is the range ${version}, and ${picked.error}` });
                        continue;
                    }
                    problems.push(`${dep.groupId}:${dep.artifactId} ${version} resolves to ${picked.version}, the highest published version in the range.`);
                    version = picked.version;
                }
                const managedEntry = managedKeys.has(key) ? root.managed.get(managementKey(dep)) : undefined;
                const node = {
                    groupId: dep.groupId, artifactId: dep.artifactId, version, classifier: dep.classifier, type: dep.type,
                    scope, optional: dep.optional, depth, via: item.via,
                    internal: internal.has(`${dep.groupId}:${dep.artifactId}`),
                    ...(managedEntry?.origin && managedEntry.version === version ? { managed: { ...managedEntry.origin, version } } : {})
                };
                resolved.set(key, node);
                winners.push({ ...item, node });
            }
            // Load every winner's POM at once (the repository limits concurrency), then expand in order.
            const loaded = await Promise.all(winners.map(w => w.node.scope === "system" ? Promise.resolve(undefined) : this.artifact({ groupId: w.node.groupId, artifactId: w.node.artifactId, version: w.node.version })));
            const next = [];
            winners.forEach((winner, index) => {
                const found = loaded[index];
                if (!found)
                    return;
                if ("error" in found) {
                    problems.push(`The transitive dependencies of ${(0, exports.gavString)(winner.node)} are unknown: ${found.error}`);
                    return;
                }
                const relocated = found.gav;
                if ((0, exports.gavString)(relocated) !== (0, exports.gavString)(winner.node)) {
                    problems.push(`${(0, exports.gavString)(winner.node)} is relocated to ${(0, exports.gavString)(relocated)}.`);
                    winner.node.groupId = relocated.groupId;
                    winner.node.artifactId = relocated.artifactId;
                    winner.node.version = relocated.version;
                }
                const via = [...winner.via, (0, exports.gavString)(winner.node)];
                for (const child of found.effective.dependencies) {
                    if (child.optional)
                        continue;
                    if (excluded(child, winner.exclusions))
                        continue;
                    const scope = transitiveScope(winner.node.scope, child.scope ?? "compile");
                    if (!scope)
                        continue;
                    const parentKey = conflictKey(winner.dep);
                    next.push({ dep: child, depth: depth + 1, via, exclusions: [...winner.exclusions, ...child.exclusions], scope, parentKey, declared: child.scope ?? "compile" });
                    edges.set(parentKey, [...(edges.get(parentKey) ?? []), { key: conflictKey(child), declared: child.scope ?? "compile" }]);
                }
            });
            level = next;
        }
        return {
            resolution: {
                path: file, gav: model.gav, packaging: model.packaging,
                dependencies: [...resolved.values()],
                unresolved,
                problems: [...new Set(problems)]
            },
            requested,
            managed: managedKeys
        };
    }
}
exports.MavenResolver = MavenResolver;
function pomPath(gav) {
    return `${gav.groupId.replace(/\./g, "/")}/${gav.artifactId}/${gav.version}/${gav.artifactId}-${gav.version}.pom`;
}
exports.pomPath = pomPath;
const SAFE_COORDINATE = /^[A-Za-z0-9_.\-]+$/;
/** Local repository first, then each remote repository, with de-duplicated in-flight requests and bounded concurrency. */
function createPomRepository(options) {
    const inFlight = new Map();
    const limit = Math.max(1, options.concurrency ?? 8);
    let active = 0;
    const waiting = [];
    const acquire = () => new Promise(resolve => { if (active < limit) {
        active++;
        resolve();
    }
    else
        waiting.push(() => { active++; resolve(); }); });
    const release = () => { active--; waiting.shift()?.(); };
    const lookup = async (gav, repositories, signal) => {
        if (![gav.groupId, gav.artifactId, gav.version].every(part => SAFE_COORDINATE.test(part))) {
            return { error: `${(0, exports.gavString)(gav)} is not a valid Maven coordinate.` };
        }
        const relative = pomPath(gav);
        const local = await options.readLocal?.(relative);
        if (local !== undefined)
            return { text: local, origin: "the local Maven repository" };
        const cached = await options.cache?.get(relative);
        if (cached !== undefined)
            return { text: cached, origin: "the POM cache" };
        if (!options.fetchText)
            return { error: "It is not in the local Maven repository, and downloading POMs is turned off." };
        const errors = [];
        for (const repo of repositories) {
            if (signal?.aborted)
                return { error: "Cancelled." };
            const url = `${repo.replace(/\/+$/, "")}/${relative}`;
            await acquire();
            try {
                const response = await options.fetchText(url, signal);
                if (response.status === 200) {
                    options.onFetch?.(url, "ok");
                    if (!/-SNAPSHOT$/i.test(gav.version))
                        await options.cache?.set(relative, response.text);
                    return { text: response.text, origin: repo };
                }
                options.onFetch?.(url, response.status === 404 ? "missing" : "error");
                if (response.status !== 404)
                    errors.push(`${repo} answered HTTP ${response.status}`);
            }
            catch (error) {
                options.onFetch?.(url, "error");
                errors.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
                release();
            }
        }
        return { error: errors.length ? `It could not be downloaded (${errors.join("; ")}).` : "It is not in the local Maven repository or in any configured repository (private artifact?)." };
    };
    const metadata = async (groupId, artifactId, repositories, signal) => {
        if (![groupId, artifactId].every(part => SAFE_COORDINATE.test(part)))
            return { error: "not a valid coordinate" };
        const dir = `${groupId.replace(/\./g, "/")}/${artifactId}`;
        const versions = new Set();
        const collect = (xml) => { for (const m of xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g))
            versions.add(m[1]); };
        for (const name of ["maven-metadata-central.xml", "maven-metadata.xml"]) {
            const local = await options.readLocal?.(`${dir}/${name}`);
            if (local)
                collect(local);
        }
        if (options.fetchText) {
            for (const repo of repositories) {
                if (signal?.aborted)
                    break;
                await acquire();
                try {
                    const response = await options.fetchText(`${repo.replace(/\/+$/, "")}/${dir}/maven-metadata.xml`, signal);
                    if (response.status === 200)
                        collect(response.text);
                }
                catch { /* try the next repository */ }
                finally {
                    release();
                }
            }
        }
        return versions.size ? [...versions] : { error: "no maven-metadata.xml was found" };
    };
    return {
        versions: metadata,
        fetch(gav, repositories, signal) {
            const key = (0, exports.gavString)(gav);
            let promise = inFlight.get(key);
            if (!promise) {
                promise = lookup(gav, repositories, signal);
                inFlight.set(key, promise);
            }
            return promise;
        }
    };
}
exports.createPomRepository = createPomRepository;
//# sourceMappingURL=resolver.js.map