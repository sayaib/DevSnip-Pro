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
exports.generatedFolderOf = exports.unsupportedFormatOf = exports.UNSUPPORTED_FILE_GLOB = exports.UNSUPPORTED_FORMATS = exports.OUTPUT_DIRS = exports.HARD_EXCLUDE_GLOB = exports.HARD_EXCLUDED_DIRS = void 0;
const path = __importStar(require("path"));
/**
 * Which folders discovery skips, and which dependency formats it recognises
 * without being able to read them. Pure (no VS Code), so it is unit-tested.
 *
 * Installed packages and tool caches are always skipped. Folders that are
 * build output or vendored dependencies by convention (build, dist, out,
 * target, vendor, deps, …) are skipped only when they belong to the project
 * next to them: `php/shop/vendor` beside `composer.json`, `api/target`
 * beside `pom.xml`. A real project kept in a folder that happens to be named
 * `build` or `deps` is scanned.
 */
/** Never project manifests: installed packages, virtual environments, VCS and tool caches. */
exports.HARD_EXCLUDED_DIRS = [
    "node_modules", ".git", ".hg", ".svn", "bower_components", "jspm_packages", ".venv", "venv", ".tox", ".nox", "__pycache__", "site-packages",
    ".gradle", ".idea", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage", ".terraform", "Pods", "Carthage", ".dart_tool", ".pub-cache",
    ".vscode-test", ".yarn", ".m2"
];
exports.HARD_EXCLUDE_GLOB = `**/{${exports.HARD_EXCLUDED_DIRS.join(",")}}/**`;
/**
 * Output or vendor folders, with the files that make their parent folder the project producing them.
 * Owner names that are not dependency files themselves (tsconfig.json, mix.exs, …) are checked on disk.
 */
exports.OUTPUT_DIRS = {
    target: ["pom.xml", "Cargo.toml", "build.sbt", "project.clj"],
    build: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "package.json", "setup.py", "pyproject.toml", "CMakeLists.txt", "pubspec.yaml"],
    dist: ["package.json", "pyproject.toml", "setup.py", "tsconfig.json", "angular.json"],
    out: ["package.json", "tsconfig.json", "build.gradle", "build.gradle.kts", "pom.xml"],
    vendor: ["composer.json", "composer.lock", "go.mod", "Gemfile", "Gemfile.lock"],
    deps: ["mix.exs", "mix.lock"],
    _build: ["mix.exs", "mix.lock"],
    ".build": ["Package.swift", "Package.resolved"]
};
exports.UNSUPPORTED_FORMATS = [
    { label: "sbt (Scala)", names: ["build.sbt"] },
    { label: "Deno", names: ["deno.json", "deno.jsonc", "deno.lock"] },
    { label: "CocoaPods", names: ["Podfile", "Podfile.lock"] },
    { label: "Carthage", names: ["Cartfile", "Cartfile.resolved"] },
    { label: "Conan (C/C++)", names: ["conanfile.txt", "conanfile.py", "conan.lock"] },
    { label: "vcpkg (C/C++)", names: ["vcpkg.json"] },
    { label: "Haskell (Stack / Cabal)", names: ["stack.yaml", "cabal.project", "*.cabal"] },
    { label: "Crystal shards", names: ["shard.yml", "shard.lock"] },
    { label: "Erlang rebar3", names: ["rebar.config", "rebar.lock"] },
    { label: "Julia", names: ["Manifest.toml"] },
    { label: "Elm", names: ["elm.json"] },
    { label: "Clojure", names: ["project.clj", "deps.edn"] },
    { label: "Bower", names: ["bower.json"] },
    { label: "Bazel", names: ["MODULE.bazel", "maven_install.json"] },
    { label: "Go dep / Glide", names: ["Gopkg.lock", "glide.lock"] },
    { label: "Paket (.NET)", names: ["paket.lock", "paket.dependencies"] },
    { label: "Apache Ivy", names: ["ivy.xml"] },
    { label: "pixi", names: ["pixi.toml", "pixi.lock"] },
    { label: "Elixir mix.exs without mix.lock", names: ["mix.exs"], unlessBeside: /^mix\.lock$/ },
    {
        label: "Python setup.py / setup.cfg (install_requires is not read)", names: ["setup.py", "setup.cfg"],
        unlessBeside: /^(?:requirements.*\.txt|.*[-_]requirements\.txt|pyproject\.toml|Pipfile(?:\.lock)?|poetry\.lock|uv\.lock|pdm\.lock)$/
    }
];
exports.UNSUPPORTED_FILE_GLOB = `**/{${[...new Set(exports.UNSUPPORTED_FORMATS.flatMap(f => f.names))].join(",")}}`;
const globToRegExp = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
const matchers = exports.UNSUPPORTED_FORMATS.map(f => ({ format: f, patterns: f.names.map(globToRegExp) }));
/** The unsupported format of a file, when it is one; `siblings` are the names of files in the same folder. */
function unsupportedFormatOf(file, siblings) {
    const name = path.posix.basename(file);
    const hit = matchers.find(m => m.patterns.some(p => p.test(name)));
    if (!hit)
        return undefined;
    if (hit.format.unlessBeside && siblings.some(s => hit.format.unlessBeside.test(s)))
        return undefined;
    return hit.format.label;
}
exports.unsupportedFormatOf = unsupportedFormatOf;
/**
 * The output/vendor folder a file sits in when that folder belongs to the project next to it, else undefined.
 * `has(relativePath)` says whether a file exists (answered from discovery first, then from disk).
 */
async function generatedFolderOf(file, has) {
    const parts = file.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
        const owners = exports.OUTPUT_DIRS[parts[i]];
        if (!owners)
            continue;
        const parent = parts.slice(0, i).join("/");
        for (const owner of owners) {
            if (await has(parent ? `${parent}/${owner}` : owner))
                return parts.slice(0, i + 1).join("/");
        }
    }
    return undefined;
}
exports.generatedFolderOf = generatedFolderOf;
//# sourceMappingURL=discovery-rules.js.map