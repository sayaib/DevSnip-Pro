import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { sanitizeOutput } from "../maven/cli";

/**
 * Gradle's own resolution, read-only.
 *
 * An init script (written to a temporary directory, never into the project)
 * registers one task in every project. The task resolves the project's
 * compile, runtime and test classpaths and prints each resolved module with
 * its depth and dependency path as a JSON line. Nothing is compiled, tested,
 * published or written to the project. Gradle does evaluate the build scripts
 * (that is how Gradle works), so this only runs in trusted workspaces with the
 * user's consent; see maven/host.ts.
 */

export const GRADLE_TASK = "devsnipOsvDependencies";
export const OUTPUT_MARKER = "DEVSNIP-OSV ";

export const INIT_SCRIPT = `// DevSnip Pro OSV scanner: lists resolved dependencies. Read-only; deleted after the run.
import groovy.json.JsonOutput
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import org.gradle.api.artifacts.component.ProjectComponentIdentifier
import org.gradle.api.artifacts.result.ResolvedDependencyResult
import org.gradle.api.artifacts.result.UnresolvedDependencyResult

allprojects { p ->
  p.tasks.register("${GRADLE_TASK}") {
    doLast {
      def wanted = ["compileClasspath", "runtimeClasspath", "testCompileClasspath", "testRuntimeClasspath"]
      p.configurations.findAll { it.canBeResolved && wanted.contains(it.name) }.each { conf ->
        def nodes = []
        def unresolved = []
        def seen = [] as Set
        def queue = [[conf.incoming.resolutionResult.root, 0, []]]
        while (!queue.isEmpty()) {
          def item = queue.remove(0)
          def component = item[0]
          def depth = item[1]
          def via = item[2]
          component.dependencies.each { dep ->
            if (dep.hasProperty("constraint") && dep.constraint) return
            if (dep instanceof UnresolvedDependencyResult) {
              def message = dep.failure?.message ?: "could not be resolved"
              unresolved << [requested: dep.requested.displayName, reason: message.readLines()[0], depth: depth + 1, via: via]
              return
            }
            if (!(dep instanceof ResolvedDependencyResult)) return
            def selected = dep.selected
            def id = selected.id
            def key = id.displayName
            if (seen.contains(key)) return
            seen << key
            if (id instanceof ModuleComponentIdentifier) {
              nodes << [group: id.group, name: id.module, version: id.version, depth: depth + 1, via: via]
              queue << [selected, depth + 1, via + [id.group + ":" + id.module + ":" + id.version]]
            } else if (id instanceof ProjectComponentIdentifier) {
              queue << [selected, depth + 1, via + [id.projectPath]]
            }
          }
        }
        println "${OUTPUT_MARKER}" + JsonOutput.toJson([project: p.path, dir: p.projectDir.absolutePath, configuration: conf.name, nodes: nodes, unresolved: unresolved])
      }
    }
  }
}
`;

export interface GradleNode { group: string; name: string; version: string; depth: number; via: string[] }
export interface GradleConfiguration {
  project: string;
  dir: string;
  configuration: string;
  nodes: GradleNode[];
  unresolved: Array<{ requested: string; reason: string; depth: number; via: string[] }>;
}

/** The JSON lines the init script printed; other output is ignored. */
export function parseGradleOutput(text: string): GradleConfiguration[] {
  const out: GradleConfiguration[] = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(OUTPUT_MARKER);
    if (at < 0) continue;
    try {
      const value = JSON.parse(line.slice(at + OUTPUT_MARKER.length)) as GradleConfiguration;
      if (value && typeof value.project === "string" && Array.isArray(value.nodes)) {
        out.push({
          project: value.project, dir: String(value.dir ?? ""), configuration: String(value.configuration ?? ""),
          nodes: value.nodes.filter(n => n && typeof n.group === "string" && typeof n.name === "string" && typeof n.version === "string")
            .map(n => ({ group: n.group, name: n.name, version: n.version, depth: Number(n.depth) || 1, via: Array.isArray(n.via) ? n.via.map(String) : [] })),
          unresolved: Array.isArray(value.unresolved) ? value.unresolved.map(u => ({ requested: String(u.requested), reason: String(u.reason), depth: Number(u.depth) || 1, via: Array.isArray(u.via) ? u.via.map(String) : [] })) : []
        });
      }
    } catch { /* a line that only looked like ours */ }
  }
  return out;
}

export interface GradleExecutable { command: string; kind: "wrapper" | "path"; label: string }

export function findGradleExecutable(projectDir: string, stopAt: string, platform = process.platform, env = process.env, exists = (file: string) => fs.existsSync(file)): GradleExecutable | undefined {
  const windows = platform === "win32";
  let dir = path.resolve(projectDir);
  const top = path.resolve(stopAt);
  const inside = (candidate: string) => { const rel = path.relative(top, candidate); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
  for (;;) {
    const wrapper = path.join(dir, windows ? "gradlew.bat" : "gradlew");
    if (exists(wrapper)) return { command: wrapper, kind: "wrapper", label: windows ? "gradlew.bat" : "./gradlew" };
    const parent = path.dirname(dir);
    if (dir === top || parent === dir || !inside(parent)) break;
    dir = parent;
  }
  for (const entry of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of windows ? ["gradle.bat", "gradle.cmd", "gradle.exe"] : ["gradle"]) {
      const candidate = path.join(entry, name);
      if (exists(candidate)) return { command: candidate, kind: "path", label: "gradle" };
    }
  }
  return undefined;
}

export function gradleArguments(initScript: string, configurationCacheFlag = true): string[] {
  return ["--init-script", initScript, "-q", "--console=plain", "--no-daemon", "--continue", ...(configurationCacheFlag ? ["--no-configuration-cache"] : []), GRADLE_TASK];
}

export interface GradleRunResult {
  configurations: GradleConfiguration[];
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
}

function quoteForCmd(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

async function runOnce(executable: GradleExecutable, cwd: string, args: string[], options: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ stdout: string; output: string; exitCode: number | null; timedOut: boolean; cancelled: boolean }> {
  const windows = process.platform === "win32";
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let cancelled = false;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = windows
      ? spawn([quoteForCmd(executable.command), ...args.map(quoteForCmd)].join(" "), { cwd, shell: true, windowsHide: true, env: process.env })
      : spawn(executable.command, args, { cwd, detached: true, env: process.env });
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-20000); });
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
  // Gradle's own messages: stderr plus any stdout line that is not one of ours.
  const output = [...stdout.split(/\r?\n/).filter(line => line.trim() && !line.includes(OUTPUT_MARKER)), ...stderr.split(/\r?\n/)].join("\n");
  return { stdout, output, exitCode, timedOut, cancelled };
}

export async function runGradleDependencies(executable: GradleExecutable, cwd: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<GradleRunResult> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "devsnip-osv-gradle-"));
  const script = path.join(dir, "devsnip-osv.init.gradle");
  try {
    await fs.promises.writeFile(script, INIT_SCRIPT, "utf8");
    let run = await runOnce(executable, cwd, gradleArguments(script), options);
    // Gradle before 6.6 has no --no-configuration-cache option.
    if (run.exitCode !== 0 && /Unknown command-line option '--no-configuration-cache'/.test(run.output)) run = await runOnce(executable, cwd, gradleArguments(script, false), options);
    const tail = sanitizeOutput(run.output.split(/\r?\n/).filter(line => line.trim() && !line.includes(OUTPUT_MARKER)).slice(-25).join("\n"));
    return { configurations: parseGradleOutput(run.stdout), exitCode: run.exitCode, output: tail, timedOut: run.timedOut, cancelled: run.cancelled };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
