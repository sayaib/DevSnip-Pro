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
exports.filesForProjects = exports.detectProjects = exports.springBootVersion = exports.projectKeyOf = void 0;
const path = __importStar(require("path"));
const parsers_1 = require("../osv/parsers");
const builtin_1 = require("../osv/gradle/builtin");
/**
 * Projects as a developer sees them, from the files discovery found:
 *  - a Maven reactor (root POM and its <modules>) is one project;
 *  - a Gradle build (settings.gradle and its projects) is one project;
 *  - an npm / Yarn / pnpm / Bun workspace belongs to the folder of its lockfile;
 *  - everything else is grouped by its project folder.
 * Selecting projects selects their files; context files (parent POMs,
 * settings.gradle, gradle.properties, Directory.Packages.props) always come along.
 */
const dirOf = (file) => { const d = path.posix.dirname(file); return d === "." ? "" : d; };
const JS_LOCKS = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
const isAncestor = (dir, of) => dir === "" || of === dir || of.startsWith(`${dir}/`);
function pomModules(text) {
    const block = /<modules>([\s\S]*?)<\/modules>/.exec(text.replace(/<!--[\s\S]*?-->/g, ""));
    return block ? [...block[1].matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map(m => m[1]) : [];
}
/** The directory of the project each scannable file belongs to. */
function projectKeyOf(files) {
    const texts = new Map(files.map(f => [f.path, f.text ?? ""]));
    const paths = files.filter(f => !f.context).map(f => f.path);
    const key = new Map();
    // Maven: a module's project is the topmost POM that lists it (transitively) in <modules>.
    const moduleParent = new Map();
    for (const file of [...texts.keys()].filter(f => path.posix.basename(f) === "pom.xml")) {
        for (const module of pomModules(texts.get(file) ?? "")) {
            const child = path.posix.normalize(path.posix.join(dirOf(file) || ".", module)).replace(/\/pom\.xml$/, "").replace(/^\.$/, "");
            moduleParent.set(child, dirOf(file));
        }
    }
    const settingsDirs = [...texts.keys()].filter(f => /(^|\/)settings\.gradle(\.kts)?$/.test(f)).map(dirOf);
    const jsLockDirs = paths.filter(f => JS_LOCKS.includes(path.posix.basename(f))).map(dirOf);
    const cargoLockDirs = paths.filter(f => path.posix.basename(f) === "Cargo.lock").map(dirOf);
    for (const file of paths) {
        const type = (0, parsers_1.detectFileType)(file);
        if (!type || parsers_1.AUXILIARY_FILES.includes(path.posix.basename(file)))
            continue;
        let dir = (0, parsers_1.projectDirOf)(file, type);
        if (type.id === "pom") {
            let current = dirOf(file);
            for (let i = 0; i < 20 && moduleParent.has(current); i++)
                current = moduleParent.get(current);
            dir = current;
        }
        else if (type.id === "gradle" || type.id === "gradle-lock" || type.id === "gradle-catalog") {
            dir = settingsDirs.filter(s => isAncestor(s, dir)).sort((a, b) => b.length - a.length)[0] ?? dir;
        }
        else if (type.ecosystem === "npm") {
            dir = jsLockDirs.filter(d => isAncestor(d, dir)).sort((a, b) => a.length - b.length)[0] ?? dir;
        }
        else if (type.ecosystem === "crates.io") {
            // A Cargo workspace member belongs to the workspace whose Cargo.lock covers it.
            dir = cargoLockDirs.filter(d => isAncestor(d, dir)).sort((a, b) => a.length - b.length)[0] ?? dir;
        }
        key.set(file, dir);
    }
    return key;
}
exports.projectKeyOf = projectKeyOf;
function nameOf(dir, files, texts, fallback) {
    const at = (name) => texts.get(dir ? `${dir}/${name}` : name);
    const json = (name) => { try {
        return JSON.parse(at(name) ?? "");
    }
    catch {
        return undefined;
    } };
    return json("package.json")?.name
        ?? /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec((at("pom.xml") ?? "").replace(/<parent>[\s\S]*?<\/parent>/, ""))?.[1]
        ?? /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(at("settings.gradle") ?? at("settings.gradle.kts") ?? "")?.[1]
        ?? /^\s*name\s*=\s*"([^"]+)"/m.exec(at("pyproject.toml") ?? at("Cargo.toml") ?? "")?.[1]
        ?? json("composer.json")?.name
        ?? /^module\s+(\S+)/m.exec(at("go.mod") ?? "")?.[1]?.split("/").pop()
        ?? (files.find(f => /\.(cs|fs|vb)proj$/.test(f)) ? path.posix.basename(files.find(f => /\.(cs|fs|vb)proj$/.test(f))).replace(/\.\w+proj$/, "") : undefined)
        ?? (dir ? path.posix.basename(dir) : fallback);
}
/** The Spring Boot version a project builds with, when its POM or Gradle build says so. */
function springBootVersion(files, texts) {
    for (const file of files) {
        const text = texts.get(file) ?? "";
        if (file.endsWith("pom.xml")) {
            const parent = /<parent>([\s\S]*?)<\/parent>/.exec(text)?.[1] ?? "";
            if (/<artifactId>\s*spring-boot-starter-parent\s*<\/artifactId>/.test(parent)) {
                const version = /<version>\s*([^<]+?)\s*<\/version>/.exec(parent)?.[1];
                if (version && !version.includes("${"))
                    return version;
            }
            const bom = /<dependency>(?:(?!<\/dependency>)[\s\S])*?<artifactId>\s*spring-boot-dependencies\s*<\/artifactId>(?:(?!<\/dependency>)[\s\S])*?<version>\s*([^<]+?)\s*<\/version>/.exec(text)?.[1];
            if (bom) {
                const prop = /^\$\{([^}]+)\}$/.exec(bom)?.[1];
                const value = prop ? new RegExp(`<${prop.replace(/\./g, "\\.")}>\\s*([^<]+?)\\s*</`).exec(text)?.[1] : bom;
                if (value && !value.includes("${"))
                    return value;
            }
        }
        else if (/build\.gradle(\.kts)?$/.test(file)) {
            const version = (0, builtin_1.buildDefaults)([text]).springBootVersion;
            if (version && !version.includes("$"))
                return version;
        }
    }
    return undefined;
}
exports.springBootVersion = springBootVersion;
function detectProjects(files, workspaceName = "workspace") {
    const keys = projectKeyOf(files);
    const texts = new Map(files.map(f => [f.path, f.text ?? ""]));
    const byDir = new Map();
    for (const [file, dir] of keys)
        byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
    const projects = [];
    for (const [dir, list] of byDir) {
        const types = list.map(f => (0, parsers_1.detectFileType)(f)).filter(Boolean);
        const all = [...list, ...files.filter(f => f.context || parsers_1.AUXILIARY_FILES.includes(path.posix.basename(f.path))).map(f => f.path).filter(f => isAncestor(dir, dirOf(f)) || isAncestor(dirOf(f), dir))];
        projects.push({
            dir,
            name: nameOf(dir, list, texts, workspaceName),
            ecosystems: [...new Set(types.map(t => t.ecosystem))].sort(),
            managers: [...new Set(types.map(t => t.manager))].sort(),
            files: list.sort(),
            ...(springBootVersion(all, texts) ? { springBoot: springBootVersion(all, texts) } : {}),
            modules: list.filter(f => /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/.test(f)).length
        });
    }
    return projects.sort((a, b) => a.dir.localeCompare(b.dir));
}
exports.detectProjects = detectProjects;
/** The files to scan for the chosen projects: their own files plus every context file. */
function filesForProjects(files, dirs) {
    const keys = projectKeyOf(files);
    const chosen = new Set(dirs);
    const projectDirs = [...new Set(keys.values())];
    const out = [];
    for (const f of files) {
        const dir = keys.get(f.path);
        if (dir === undefined) {
            // Context files (settings.gradle, gradle.properties, Directory.Packages.props) come along with the projects they sit in or above.
            const at = dirOf(f.path);
            const owner = projectDirs.filter(p => isAncestor(p, at)).sort((a, b) => b.length - a.length)[0];
            if ((owner !== undefined && chosen.has(owner)) || dirs.some(d => isAncestor(at, d)))
                out.push(f);
            else if (f.path.endsWith("pom.xml"))
                out.push({ ...f, context: true });
        }
        else if (chosen.has(dir))
            out.push(f);
        // A POM outside the selection may still be the parent of a selected one: keep it as context, unscanned.
        else if (f.path.endsWith("pom.xml"))
            out.push({ ...f, context: true });
    }
    return out;
}
exports.filesForProjects = filesForProjects;
//# sourceMappingURL=projects.js.map