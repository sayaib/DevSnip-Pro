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
exports.runDependencyTree = exports.sanitizeOutput = exports.treeArguments = exports.findMavenExecutable = exports.DEPENDENCY_PLUGIN = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const tree_1 = require("./tree");
/**
 * Runs Maven's own resolver: `mvn dependency:tree`, read-only.
 *
 * - Only the dependency plugin's `tree` goal runs (pinned to a known version):
 *   nothing is compiled, tested, installed or deployed, and no project file is
 *   written. The tree goes to a temporary file that is deleted afterwards.
 * - The Maven Wrapper (`mvnw`) is preferred, then `mvn` on PATH.
 * - The process has a time limit and is killed (with its children) on
 *   cancellation or timeout.
 * - Maven does load the build's extensions and may download artifacts, so the
 *   panel only calls this in a trusted workspace, with the user's consent.
 */
exports.DEPENDENCY_PLUGIN = "org.apache.maven.plugins:maven-dependency-plugin:3.6.1:tree";
function findMavenExecutable(projectDir, stopAt, platform = process.platform, env = process.env, exists = (file) => fs.existsSync(file)) {
    const windows = platform === "win32";
    let dir = path.resolve(projectDir);
    const top = path.resolve(stopAt);
    const inside = (candidate) => { const rel = path.relative(top, candidate); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
    for (;;) {
        const wrapper = path.join(dir, windows ? "mvnw.cmd" : "mvnw");
        if (exists(wrapper))
            return { command: wrapper, kind: "wrapper", label: windows ? "mvnw.cmd" : "./mvnw" };
        const parent = path.dirname(dir);
        if (dir === top || parent === dir || !inside(parent))
            break;
        dir = parent;
    }
    const names = windows ? ["mvn.cmd", "mvn.bat", "mvn.exe"] : ["mvn"];
    for (const entry of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
        for (const name of names) {
            const candidate = path.join(entry, name);
            if (exists(candidate))
                return { command: candidate, kind: "path", label: "mvn" };
        }
    }
    return undefined;
}
exports.findMavenExecutable = findMavenExecutable;
function treeArguments(outputFile) {
    return ["-B", "-q", "-Dstyle.color=never", exports.DEPENDENCY_PLUGIN, "-DoutputType=text", `-DoutputFile=${outputFile}`, "-DappendOutput=true"];
}
exports.treeArguments = treeArguments;
/** Masks `user:password@` in URLs and long token-like values before Maven's output is shown or logged. */
function sanitizeOutput(text) {
    return text
        .replace(/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1***:***@")
        .replace(/((?:password|passwd|token|secret|apikey|api_key)\s*[=:]\s*)\S+/gi, "$1***");
}
exports.sanitizeOutput = sanitizeOutput;
function quoteForCmd(arg) {
    return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}
async function runDependencyTree(executable, cwd, options = {}) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "devsnip-osv-"));
    const outputFile = path.join(dir, "tree.txt");
    const args = treeArguments(outputFile);
    const windows = process.platform === "win32";
    let output = "";
    let timedOut = false;
    let cancelled = false;
    try {
        const exitCode = await new Promise((resolve, reject) => {
            // .cmd scripts need a shell on Windows; every argument is quoted for cmd.exe.
            const child = windows
                ? (0, child_process_1.spawn)([quoteForCmd(executable.command), ...args.map(quoteForCmd)].join(" "), { cwd, shell: true, windowsHide: true, env: process.env })
                : (0, child_process_1.spawn)(executable.command, args, { cwd, detached: true, env: process.env });
            const append = (chunk) => { output = (output + chunk.toString("utf8")).slice(-20000); };
            child.stdout?.on("data", append);
            child.stderr?.on("data", append);
            const kill = () => {
                try {
                    if (windows && child.pid)
                        (0, child_process_1.spawn)("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
                    else if (child.pid)
                        process.kill(-child.pid, "SIGTERM");
                }
                catch { /* already gone */ }
            };
            const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs ?? 5 * 60 * 1000);
            const onAbort = () => { cancelled = true; kill(); };
            options.signal?.addEventListener("abort", onAbort, { once: true });
            if (options.signal?.aborted)
                onAbort();
            child.on("error", error => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); reject(error); });
            child.on("close", code => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); resolve(code); });
        });
        let text = "";
        try {
            text = await fs.promises.readFile(outputFile, "utf8");
        }
        catch { /* Maven failed before writing */ }
        const tail = sanitizeOutput(output.split(/\r?\n/).filter(line => line.trim()).slice(-25).join("\n"));
        return { trees: (0, tree_1.parseDependencyTree)(text), exitCode, output: tail, timedOut, cancelled };
    }
    finally {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
exports.runDependencyTree = runDependencyTree;
//# sourceMappingURL=cli.js.map