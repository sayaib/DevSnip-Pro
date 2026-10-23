"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMavenProjects = void 0;
const resolver_1 = require("./resolver");
function scopeOf(scope, optional) {
    if (scope === "test")
        return "development";
    return optional ? "optional" : "production";
}
function lineFinder(text) {
    if (!text)
        return () => undefined;
    return artifactId => {
        const index = text.indexOf(`<artifactId>${artifactId}</artifactId>`);
        return index < 0 ? undefined : text.slice(0, index).split("\n").length;
    };
}
function fromTree(file, tree, internal, text, label, management = new Map()) {
    const line = lineFinder(text);
    const dependencies = tree.nodes
        .filter(node => !internal.has(`${node.groupId}:${node.artifactId}`))
        .map(node => ({
        name: `${node.groupId}:${node.artifactId}`,
        version: node.version,
        resolution: "lockfile",
        scope: scopeOf(node.scope, node.optional),
        direct: node.depth === 1,
        via: node.via,
        ...(management.get(`${node.groupId}:${node.artifactId}`)?.version === node.version ? { managedBy: management.get(`${node.groupId}:${node.artifactId}`) } : {}),
        ...(node.depth === 1 ? { line: line(node.artifactId) } : {}),
        ...(node.classifier ? { note: `Classifier ${node.classifier}.` } : {})
    }));
    return { path: file, ecosystem: "Maven", kind: "lockfile", manager: "maven", dependencies, warnings: [], resolvedBy: `Maven (${label} dependency:tree)` };
}
function fromResolution(resolution, text, label) {
    const line = lineFinder(text);
    const dependencies = [
        ...resolution.dependencies.filter(d => !d.internal).map(d => ({
            name: `${d.groupId}:${d.artifactId}`,
            version: d.version,
            resolution: "lockfile",
            scope: scopeOf(d.scope, d.optional),
            direct: d.depth === 1,
            via: d.via,
            ...(d.managed ? { managedBy: d.managed } : {}),
            ...(d.depth === 1 ? { line: line(d.artifactId) } : {})
        })),
        ...resolution.unresolved.map(u => ({
            name: `${u.groupId}:${u.artifactId}`,
            resolution: "range",
            scope: "production",
            direct: u.depth === 1,
            via: u.via,
            registry: false,
            skip: "unresolved",
            note: u.reason,
            ...(u.declared ? { spec: u.declared } : {}),
            ...(u.depth === 1 ? { line: line(u.artifactId) } : {})
        }))
    ];
    return {
        path: resolution.path, ecosystem: "Maven", kind: "lockfile", manager: "maven", dependencies,
        warnings: resolution.problems.slice(0, 25),
        resolvedBy: `DevSnip Pro's Maven resolver (${label})`
    };
}
async function resolveMavenProjects(poms, strategy, options = {}) {
    const log = options.onLog ?? (() => undefined);
    const texts = new Map(poms.filter(p => p.text !== undefined).map(p => [p.path, p.text]));
    const resolver = new resolver_1.MavenResolver([...texts].map(([path, text]) => ({ path, text })), strategy.repository, options.signal);
    for (const [file, reason] of resolver.invalid)
        log(`Maven: ${file} is not a readable POM: ${reason}`);
    const files = new Map();
    const projects = [];
    const internal = new Set();
    for (const file of texts.keys()) {
        const gav = resolver.workspaceGav(file);
        if (gav)
            internal.add(`${gav.groupId}:${gav.artifactId}`);
    }
    // POMs marked as context (a parent above a chosen file) are resolved through, never reported.
    const targets = new Set(poms.filter(p => !p.context && p.text !== undefined).map(p => p.path));
    for (const root of resolver.reactorRoots()) {
        if (options.signal?.aborted)
            break;
        const modules = resolver.reactorModules(root).filter(module => targets.has(module));
        if (!modules.length)
            continue;
        const pending = new Set(modules);
        let detail;
        let method = "builtin";
        if (strategy.runCli) {
            options.onProgress?.(`Resolving ${root} with ${strategy.cliLabel ?? "Maven"}`);
            log(`Maven: running ${strategy.cliLabel ?? "mvn"} dependency:tree for ${root} (${modules.length} module${modules.length === 1 ? "" : "s"})`);
            const started = Date.now();
            const run = await strategy.runCli(root, options.signal);
            if ("error" in run) {
                detail = `${strategy.cliLabel ?? "Maven"} could not run: ${run.error}`;
            }
            else if (run.cancelled) {
                detail = "Maven was cancelled.";
            }
            else {
                for (const module of modules) {
                    const gav = resolver.workspaceGav(module);
                    const tree = gav && run.trees.find(t => t.groupId === gav.groupId && t.artifactId === gav.artifactId);
                    if (!tree)
                        continue;
                    // What manages each version (Spring Boot's BOM, a property, your POM), from the POMs; best effort.
                    const management = await resolver.managementOf(module).catch(() => new Map());
                    files.set(module, fromTree(module, tree, internal, texts.get(module), strategy.cliLabel ?? "mvn", management));
                    pending.delete(module);
                }
                if (pending.size === 0)
                    method = "build-tool";
                if (run.exitCode !== 0 || run.timedOut) {
                    detail = `${strategy.cliLabel ?? "Maven"} ${run.timedOut ? "timed out" : `exited with code ${run.exitCode}`}${pending.size ? `; ${pending.size} module${pending.size === 1 ? " was" : "s were"} resolved by the built-in resolver instead` : ""}.${run.output ? `\n${run.output}` : ""}`;
                }
                log(`Maven: ${modules.length - pending.size}/${modules.length} module trees from Maven in ${Date.now() - started} ms${run.exitCode ? ` (exit code ${run.exitCode})` : ""}`);
            }
            if (detail)
                log(`Maven: ${detail}`);
        }
        if (pending.size) {
            options.onProgress?.(`Resolving ${root} with the built-in Maven resolver`);
            for (const module of modules) {
                if (!pending.has(module) || options.signal?.aborted)
                    continue;
                const started = Date.now();
                const resolution = await resolver.resolveModule(module);
                files.set(module, fromResolution(resolution, texts.get(module), strategy.repositoryLabel));
                log(`Maven: ${module} (${(0, resolver_1.gavString)(resolution.gav)}) resolved by the built-in resolver: ${resolution.dependencies.filter(d => !d.internal).length} dependencies, ${resolution.unresolved.length} unresolved, ${resolution.problems.length} notes, ${Date.now() - started} ms`);
                for (const problem of resolution.problems.slice(0, 10))
                    log(`Maven:   ${problem}`);
            }
        }
        const moduleFiles = modules.map(m => files.get(m)).filter((f) => Boolean(f));
        projects.push({
            tool: "Maven",
            project: root,
            method,
            modules: modules.length,
            dependencies: new Set(moduleFiles.flatMap(f => f.dependencies.filter(d => d.version).map(d => `${d.name}@${d.version}`))).size,
            unresolved: new Set(moduleFiles.flatMap(f => f.dependencies.filter(d => d.skip === "unresolved").map(d => d.name))).size,
            ...(detail ? { detail } : {})
        });
    }
    // A POM that is not valid XML cannot be resolved or read: report it as unreadable, never as "0 dependencies".
    for (const [file, reason] of resolver.invalid) {
        if (!targets.has(file) || files.has(file))
            continue;
        files.set(file, { path: file, ecosystem: "Maven", kind: "manifest", manager: "maven", dependencies: [], warnings: [], error: `Not a readable POM: ${reason}` });
    }
    log(`Maven: POMs from the workspace ${resolver.stats.pomsFromWorkspace}, from repositories ${resolver.stats.pomsFetched}, not found ${resolver.stats.pomsMissing}`);
    return { files, projects };
}
exports.resolveMavenProjects = resolveMavenProjects;
//# sourceMappingURL=index.js.map