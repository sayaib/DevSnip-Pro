/**
 * Run and debug set-up for a detected project: VS Code launch configurations
 * (using each language's official debugger), the tasks they need, the
 * extensions that provide those debuggers, and the everyday run / test /
 * build commands. Merges into an existing launch.json instead of replacing it.
 */
import { DetectedProject, KIND_LABELS, PackageManager } from "./project-detect";

export interface LaunchConfig { name: string; type: string; request: string; [key: string]: unknown }
export interface TaskConfig { label: string; [key: string]: unknown }

export interface ProjectSetup {
  configurations: LaunchConfig[];
  tasks: TaskConfig[];
  extensions: string[];
  /** [what, command] pairs. */
  commands: Array<[string, string]>;
  notes: string[];
}

export const EXTENSION_NAMES: Record<string, string> = {
  "ms-python.python": "Python",
  "ms-python.debugpy": "Python Debugger",
  "vscjava.vscode-java-pack": "Extension Pack for Java",
  "vmware.vscode-boot-dev-pack": "Spring Boot Extension Pack",
  "ms-dotnettools.csdevkit": "C# Dev Kit",
  "Dart-Code.dart-code": "Dart",
  "Dart-Code.flutter": "Flutter",
  "msjsdiag.vscode-react-native": "React Native Tools"
};

const run = (pm: PackageManager | undefined, script: string) => `${pm ?? "npm"} run ${script}`;

export function setupFor(p: DetectedProject, prefixNames: boolean): ProjectSetup {
  const root = p.dir ? `\${workspaceFolder}/${p.dir}` : "${workspaceFolder}";
  const label = (name: string) => (prefixNames ? `${p.dir || p.name}: ${name}` : name);
  const s: ProjectSetup = { configurations: [], tasks: [], extensions: [], commands: [], notes: [] };
  const scripts = p.scripts ?? {};
  const cd = p.dir ? `cd ${p.dir} && ` : "";
  const nodeInspect = { name: label("Attach to Node (port 9229)"), type: "node", request: "attach", port: 9229, skipFiles: ["<node_internals>/**"] };

  switch (p.kind) {
    case "nextjs":
      s.configurations.push(
        { name: label("Next.js: debug server-side"), type: "node-terminal", request: "launch", command: run(p.packageManager, scripts.dev ? "dev" : "start"), cwd: root },
        { name: label("Next.js: debug client-side"), type: "chrome", request: "launch", url: `http://localhost:${p.port ?? 3000}`, webRoot: root },
        {
          name: label("Next.js: debug full stack"), type: "node", request: "launch", program: `${root}/node_modules/next/dist/bin/next`, args: ["dev"], cwd: root,
          runtimeArgs: ["--inspect"], skipFiles: ["<node_internals>/**"],
          serverReadyAction: { action: "debugWithChrome", killOnServerStop: true, pattern: "- Local:.+(https?://.+)", uriFormat: "%s", webRoot: root }
        }
      );
      break;
    case "vite": case "cra": case "angular": {
      const devScript = scripts.dev ? "dev" : scripts.start ? "start" : "dev";
      s.configurations.push(
        { name: label(`Start dev server (${run(p.packageManager, devScript)})`), type: "node-terminal", request: "launch", command: run(p.packageManager, devScript), cwd: root },
        { name: label(`Debug in Chrome (localhost:${p.port})`), type: "chrome", request: "launch", url: `http://localhost:${p.port}`, webRoot: root }
      );
      s.notes.push(`${KIND_LABELS[p.kind]}: start the dev server first, then run "Debug in Chrome" to hit breakpoints in your components.`);
      break;
    }
    case "nestjs": {
      const script = scripts["start:debug"] ? "start:debug" : scripts["start:dev"] ? "start:dev" : "start";
      s.configurations.push({ name: label(`NestJS: ${run(p.packageManager, script)}`), type: "node-terminal", request: "launch", command: run(p.packageManager, script), cwd: root }, nodeInspect);
      break;
    }
    case "node": {
      const devScript = scripts.dev ? "dev" : scripts.start ? "start" : undefined;
      if (p.entry && /\.[cm]?js$/.test(p.entry)) {
        s.configurations.push({ name: label(`Launch ${p.entry}`), type: "node", request: "launch", program: `${root}/${p.entry}`, cwd: root, skipFiles: ["<node_internals>/**"], console: "integratedTerminal" });
      } else if (p.entry && p.tsRunner) {
        s.configurations.push({
          name: label(`Launch ${p.entry} (${p.tsRunner})`), type: "node", request: "launch", program: `${root}/${p.entry}`, cwd: root,
          runtimeArgs: p.tsRunner === "tsx" ? ["--import", "tsx"] : ["-r", "ts-node/register"], skipFiles: ["<node_internals>/**"], console: "integratedTerminal"
        });
      }
      if (devScript) s.configurations.push({ name: label(`Debug ${run(p.packageManager, devScript)}`), type: "node-terminal", request: "launch", command: run(p.packageManager, devScript), cwd: root });
      if (p.entry && !/\.[cm]?js$/.test(p.entry) && !p.tsRunner && !devScript) s.notes.push(`${p.entry} is TypeScript: add tsx (npm i -D tsx) or a "dev" script so it can be launched under the debugger.`);
      s.configurations.push(nodeInspect);
      break;
    }
    case "react-native": case "expo":
      if (p.kind === "expo") {
        s.configurations.push({ name: label("Expo: debug app"), type: "reactnative", request: "launch", platform: "exponent", expoHostType: "lan", cwd: root });
      } else {
        s.configurations.push(
          { name: label("React Native: debug Android"), type: "reactnative", request: "launch", platform: "android", cwd: root },
          { name: label("React Native: debug iOS"), type: "reactnative", request: "launch", platform: "ios", cwd: root }
        );
      }
      s.configurations.push({ name: label("React Native: attach to packager"), type: "reactnative", request: "attach", cwd: root });
      s.extensions.push("msjsdiag.vscode-react-native");
      s.notes.push("React Native 0.76 and later also ship React Native DevTools: press j in the Metro terminal to open it.");
      break;
    case "fastapi": {
      const args = [p.appModule ?? "main:app", "--reload", "--port", String(p.port ?? 8000)];
      s.configurations.push({ name: label("FastAPI (uvicorn)"), type: "debugpy", request: "launch", module: "uvicorn", args, cwd: root, jinja: true });
      s.commands.push(["Run (reload)", `${cd}uvicorn ${args.join(" ")}`]);
      break;
    }
    case "django":
      s.configurations.push({ name: label("Django: runserver"), type: "debugpy", request: "launch", program: `${root}/manage.py`, args: ["runserver"], cwd: root, django: true });
      s.commands.push(["Run", `${cd}python manage.py runserver`], ["Migrations", `${cd}python manage.py makemigrations && python manage.py migrate`]);
      break;
    case "flask":
      s.configurations.push({
        name: label("Flask"), type: "debugpy", request: "launch", module: "flask", cwd: root,
        env: { FLASK_APP: p.appModule ?? "app.py", FLASK_DEBUG: "1" }, args: ["run", "--no-debugger", "--no-reload", "--port", String(p.port ?? 5000)], jinja: true
      });
      s.commands.push(["Run (reload)", `${cd}flask --app ${p.appModule ?? "app.py"} run --debug`]);
      break;
    case "python":
      if (p.entry) s.configurations.push({ name: label(`Python: ${p.entry}`), type: "debugpy", request: "launch", program: `${root}/${p.entry}`, cwd: root, console: "integratedTerminal" });
      s.commands.push(["Run", `${cd}python ${p.entry ?? "main.py"}`]);
      break;
    case "spring-boot": case "java": {
      const tool = p.buildTool === "gradle" ? (p.wrapper ? "./gradlew" : "gradle") : (p.wrapper ? "./mvnw" : "mvn");
      s.configurations.push({
        name: label(`${p.kind === "spring-boot" ? "Spring Boot" : "Java"}: ${p.mainClass?.split(".").pop() ?? "current file"}`), type: "java", request: "launch",
        mainClass: p.mainClass ?? "${file}", ...(p.mainClass ? { projectName: p.name } : {}), cwd: root
      });
      s.configurations.push({ name: label("Java: attach (port 5005)"), type: "java", request: "attach", hostName: "localhost", port: 5005 });
      s.extensions.push("vscjava.vscode-java-pack");
      if (p.kind === "spring-boot") {
        s.extensions.push("vmware.vscode-boot-dev-pack");
        if (p.buildTool === "gradle") s.commands.push(["Run", `${cd}${tool} bootRun`], ["Run, waiting for the debugger on 5005", `${cd}${tool} bootRun --debug-jvm`]);
        else s.commands.push(["Run", `${cd}${tool} spring-boot:run`], ["Run with the debugger on 5005", `${cd}${tool} spring-boot:run -Dspring-boot.run.jvmArguments="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005"`]);
      }
      if (!p.mainClass) s.notes.push("No main class was found, so the launch configuration runs the file open in the editor.");
      s.commands.push(["Test", `${cd}${tool} test`], ["Build", `${cd}${tool} ${p.buildTool === "gradle" ? "build" : "package"}`]);
      break;
    }
    case "android": {
      const tool = p.wrapper ? "./gradlew" : "gradle";
      s.commands.push(["Build debug APK", `${cd}${tool} assembleDebug`], ["Install on device", `${cd}${tool} installDebug`], ["Unit tests", `${cd}${tool} test`], ["Logs", "adb logcat"]);
      s.notes.push("Native Android apps are debugged in Android Studio; VS Code has no Android (ART) debugger. Use the adb & simctl Command Builder for device commands.");
      break;
    }
    case "aspnet": case "dotnet": {
      if (p.isTest) {
        s.commands.push(["Test", `dotnet test ${p.dir ? `${p.dir}/` : ""}${p.csproj}`]);
        break;
      }
      const task = `build ${p.name}`;
      s.tasks.push({ label: task, command: "dotnet", type: "process", args: ["build", `${root}/${p.csproj}`, "/property:GenerateFullPaths=true", "/consoleloggerparameters:NoSummary"], problemMatcher: "$msCompile" });
      s.configurations.push({
        name: label(`.NET: launch ${p.name}`), type: "coreclr", request: "launch", preLaunchTask: task,
        program: `${root}/bin/Debug/${p.targetFramework}/${p.assemblyName}.dll`, args: [], cwd: root, stopAtEntry: false,
        ...(p.kind === "aspnet"
          // Launching the DLL skips Properties/launchSettings.json, so its URL is passed explicitly.
          ? { env: { ASPNETCORE_ENVIRONMENT: "Development", ...(p.port ? { ASPNETCORE_URLS: `http://localhost:${p.port}` } : {}) }, serverReadyAction: { action: "openExternally", pattern: "\\bNow listening on:\\s+(https?://\\S+)" } }
          : { console: "integratedTerminal" })
      });
      s.configurations.push({ name: label(".NET: attach to process"), type: "coreclr", request: "attach" });
      s.extensions.push("ms-dotnettools.csdevkit");
      s.commands.push(["Run (hot reload)", `${cd}dotnet watch run`], ["Build", `${cd}dotnet build`], ["Publish", `${cd}dotnet publish -c Release`]);
      break;
    }
    case "flutter":
      s.configurations.push(
        { name: label("Flutter: debug"), type: "dart", request: "launch", program: `${root}/lib/main.dart`, cwd: root },
        { name: label("Flutter: profile"), type: "dart", request: "launch", program: `${root}/lib/main.dart`, cwd: root, flutterMode: "profile" }
      );
      s.extensions.push("Dart-Code.flutter");
      s.commands.push(["Run", `${cd}flutter run`], ["Test", `${cd}flutter test`], ["Analyze", `${cd}flutter analyze`], ["Build Android", `${cd}flutter build apk --release`], ["Build iOS", `${cd}flutter build ipa`]);
      break;
    case "dart":
      if (p.entry) s.configurations.push({ name: label(`Dart: ${p.entry}`), type: "dart", request: "launch", program: `${root}/${p.entry}`, cwd: root });
      s.extensions.push("Dart-Code.dart-code");
      s.commands.push(["Run", `${cd}dart run`], ["Test", `${cd}dart test`], ["Analyze", `${cd}dart analyze`]);
      break;
    case "ios":
      s.commands.push(["Build for the simulator", `${cd}xcodebuild -scheme ${p.name} -destination 'platform=iOS Simulator,name=iPhone 16' build`], ["Test", `${cd}xcodebuild test -scheme ${p.name} -destination 'platform=iOS Simulator,name=iPhone 16'`]);
      s.notes.push("Native iOS apps are debugged in Xcode; VS Code has no iOS debugger.");
      break;
  }

  if (["nextjs", "vite", "cra", "angular", "nestjs", "node", "react-native", "expo"].includes(p.kind)) {
    if (p.testRunner === "vitest") s.configurations.push({ name: label("Vitest: debug current file"), type: "node", request: "launch", program: `${root}/node_modules/vitest/vitest.mjs`, args: ["run", "${file}"], cwd: root, autoAttachChildProcesses: true, smartStep: true, skipFiles: ["<node_internals>/**"], console: "integratedTerminal" });
    if (p.testRunner === "jest") s.configurations.push({ name: label("Jest: debug current file"), type: "node", request: "launch", program: `${root}/node_modules/jest/bin/jest.js`, args: ["--runInBand", "--runTestsByPath", "${file}"], cwd: root, skipFiles: ["<node_internals>/**"], console: "integratedTerminal" });
    for (const script of ["dev", "start", "test", "lint", "build"]) if (scripts[script]) s.commands.push([script[0].toUpperCase() + script.slice(1), `${cd}${run(p.packageManager, script)}`]);
    if (p.kind === "expo") s.commands.push(["Start Metro", `${cd}npx expo start`]);
    if (p.kind === "react-native") s.commands.push(["Run Android", `${cd}npx react-native run-android`], ["Run iOS", `${cd}npx react-native run-ios`]);
  }
  if (["fastapi", "django", "flask", "python"].includes(p.kind)) {
    if (p.testRunner === "pytest") {
      s.configurations.push({ name: label("pytest: debug current file"), type: "debugpy", request: "launch", module: "pytest", args: ["${file}", "-q"], cwd: root, console: "integratedTerminal", justMyCode: false });
      s.commands.push(["Test", `${cd}pytest`]);
    }
    s.extensions.push("ms-python.python", "ms-python.debugpy");
  }
  return s;
}

/** Removes line and block comments outside strings. */
function stripComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Parses JSON with comments and trailing commas, as VS Code writes its config files. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripComments(text).replace(/,(\s*[}\]])/g, "$1"));
}

const hasComments = (text: string) => stripComments(text) !== text;

export interface Merged<T> { content: string; added: T[]; kept: number; warning?: string }

/** Adds configurations whose names are not already in an existing launch.json. */
export function mergeLaunch(existing: string | undefined, configurations: LaunchConfig[]): Merged<LaunchConfig> {
  return mergeList(existing, "configurations", "name", configurations, { version: "0.2.0" }, "launch.json");
}

export function mergeTasks(existing: string | undefined, tasks: TaskConfig[]): Merged<TaskConfig> {
  return mergeList(existing, "tasks", "label", tasks, { version: "2.0.0" }, "tasks.json");
}

export function mergeExtensions(existing: string | undefined, ids: string[]): Merged<string> {
  let current: string[] = [];
  let doc: Record<string, unknown> = {};
  let warning: string | undefined;
  if (existing?.trim()) {
    try { doc = parseJsonc(existing) as Record<string, unknown>; current = Array.isArray(doc.recommendations) ? doc.recommendations.map(String) : []; }
    catch { warning = "Your .vscode/extensions.json could not be read, so it is shown without your existing recommendations."; doc = {}; }
  }
  const added = [...new Set(ids)].filter(id => !current.some(c => c.toLowerCase() === id.toLowerCase()));
  return { content: JSON.stringify({ ...doc, recommendations: [...current, ...added] }, null, 2) + "\n", added, kept: current.length, warning };
}

function mergeList<T extends Record<string, unknown>>(existing: string | undefined, key: string, id: string, items: T[], defaults: Record<string, unknown>, file: string): Merged<T> {
  let doc: Record<string, unknown> = { ...defaults };
  let current: T[] = [];
  let warning: string | undefined;
  if (existing?.trim()) {
    try {
      doc = parseJsonc(existing) as Record<string, unknown>;
      current = Array.isArray(doc[key]) ? doc[key] as T[] : [];
      if (hasComments(existing)) warning = `Your .vscode/${file} has comments; saving this merged version drops them.`;
    } catch {
      warning = `Your .vscode/${file} could not be parsed, so this file holds only the new entries: merge them by hand.`;
      doc = { ...defaults };
    }
  }
  const names = new Set(current.map(item => String(item[id])));
  const added = items.filter(item => !names.has(String(item[id])));
  const ordered: Record<string, unknown> = { ...defaults, ...doc, [key]: [...current, ...added] };
  return { content: JSON.stringify(ordered, null, 2) + "\n", added, kept: current.length, warning };
}
