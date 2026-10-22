import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ModuleTree, parseDependencyTree } from "./tree";

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

export const DEPENDENCY_PLUGIN = "org.apache.maven.plugins:maven-dependency-plugin:3.6.1:tree";

export interface MavenExecutable {
  command: string;
  kind: "wrapper" | "path";
  /** For messages: "./mvnw" or "mvn". */
  label: string;
}

export function findMavenExecutable(projectDir: string, stopAt: string, platform = process.platform, env = process.env, exists = (file: string) => fs.existsSync(file)): MavenExecutable | undefined {
  const windows = platform === "win32";
  let dir = path.resolve(projectDir);
  const top = path.resolve(stopAt);
  const inside = (candidate: string) => { const rel = path.relative(top, candidate); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
  for (;;) {
    const wrapper = path.join(dir, windows ? "mvnw.cmd" : "mvnw");
    if (exists(wrapper)) return { command: wrapper, kind: "wrapper", label: windows ? "mvnw.cmd" : "./mvnw" };
    const parent = path.dirname(dir);
    if (dir === top || parent === dir || !inside(parent)) break;
    dir = parent;
  }
  const names = windows ? ["mvn.cmd", "mvn.bat", "mvn.exe"] : ["mvn"];
  for (const entry of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (exists(candidate)) return { command: candidate, kind: "path", label: "mvn" };
    }
  }
  return undefined;
}

export function treeArguments(outputFile: string): string[] {
  return ["-B", "-q", "-Dstyle.color=never", DEPENDENCY_PLUGIN, "-DoutputType=text", `-DoutputFile=${outputFile}`, "-DappendOutput=true"];
}

export interface MavenRunResult {
  trees: ModuleTree[];
  exitCode: number | null;
  /** The last lines Maven printed, with credentials in URLs masked. */
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

/** Masks `user:password@` in URLs and long token-like values before Maven's output is shown or logged. */
export function sanitizeOutput(text: string): string {
  return text
    .replace(/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1***:***@")
    .replace(/((?:password|passwd|token|secret|apikey|api_key)\s*[=:]\s*)\S+/gi, "$1***");
}

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

export async function runDependencyTree(executable: MavenExecutable, cwd: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<MavenRunResult> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "devsnip-osv-"));
  const outputFile = path.join(dir, "tree.txt");
  const args = treeArguments(outputFile);
  const windows = process.platform === "win32";
  let output = "";
  let timedOut = false;
  let cancelled = false;
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      // .cmd scripts need a shell on Windows; every argument is quoted for cmd.exe.
      const child = windows
        ? spawn([quoteForCmd(executable.command), ...args.map(quoteForCmd)].join(" "), { cwd, shell: true, windowsHide: true, env: process.env })
        : spawn(executable.command, args, { cwd, detached: true, env: process.env });
      const append = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-20000); };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      const kill = () => {
        try {
          if (windows && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
          else if (child.pid) process.kill(-child.pid, "SIGTERM");
        } catch { /* already gone */ }
      };
      const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs ?? 5 * 60 * 1000);
      const onAbort = () => { cancelled = true; kill(); };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      child.on("error", error => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); reject(error); });
      child.on("close", code => { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); resolve(code); });
    });
    let text = "";
    try { text = await fs.promises.readFile(outputFile, "utf8"); } catch { /* Maven failed before writing */ }
    const tail = sanitizeOutput(output.split(/\r?\n/).filter(line => line.trim()).slice(-25).join("\n"));
    return { trees: parseDependencyTree(text), exitCode, output: tail, timedOut, cancelled };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
