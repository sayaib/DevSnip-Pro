/**
 * Finds the projects in a workspace and what they are built with, from their
 * manifests: package.json, pyproject.toml / requirements.txt / manage.py,
 * pom.xml / build.gradle, *.csproj, pubspec.yaml and Xcode projects. Looks at
 * the root and up to two folders down, so monorepos and "frontend + backend"
 * layouts are found too.
 */
import type { ToolContext } from "../types";

export type ProjectKind =
  | "nextjs" | "vite" | "cra" | "angular" | "nestjs" | "node" | "react-native" | "expo"
  | "fastapi" | "django" | "flask" | "python"
  | "spring-boot" | "java" | "android"
  | "aspnet" | "dotnet"
  | "flutter" | "dart" | "ios";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface DetectedProject {
  kind: ProjectKind;
  /** Workspace-relative folder ("" for the root). */
  dir: string;
  name: string;
  language: string;
  framework: string;
  evidence: string[];
  packageManager?: PackageManager;
  scripts?: Record<string, string>;
  testRunner?: string;
  port?: number;
  /** Node or Dart entry file, or a Python script, relative to `dir`. */
  entry?: string;
  /** How a TypeScript entry runs under Node without a build. */
  tsRunner?: "tsx" | "ts-node";
  /** Python ASGI/WSGI target (main:app) or Flask app file. */
  appModule?: string;
  mainClass?: string;
  buildTool?: "maven" | "gradle";
  wrapper?: boolean;
  /** .NET project file, relative to `dir`, and its build output. */
  csproj?: string;
  targetFramework?: string;
  assemblyName?: string;
  /** .NET and Python test projects. */
  isTest?: boolean;
}

type Workspace = NonNullable<ToolContext["workspace"]>;

export const KIND_LABELS: Record<ProjectKind, string> = {
  nextjs: "Next.js", vite: "Vite (React / Vue / Svelte)", cra: "Create React App", angular: "Angular", nestjs: "NestJS", node: "Node.js",
  "react-native": "React Native", expo: "Expo (React Native)",
  fastapi: "FastAPI", django: "Django", flask: "Flask", python: "Python",
  "spring-boot": "Spring Boot", java: "Java", android: "Android (Gradle)",
  aspnet: "ASP.NET Core", dotnet: ".NET",
  flutter: "Flutter", dart: "Dart", ios: "iOS (Xcode)"
};

const join = (dir: string, file: string) => (dir ? `${dir}/${file}` : file);
const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const baseName = (file: string) => file.slice(file.lastIndexOf("/") + 1);
const SHALLOW = (pattern: string) => `{${pattern},*/${pattern},*/*/${pattern}}`;

export async function detectProjects(ws: Workspace): Promise<DetectedProject[]> {
  const projects: DetectedProject[] = [];
  const find = (pattern: string, limit = 40) => ws.findFiles(pattern, limit).then(files => files.filter(file => !/(?:^|\/)(?:node_modules|\.dart_tool|Pods|bin|obj|build|\.gradle)\//.test(file)));

  for (const file of (await find(SHALLOW("package.json"))).sort()) {
    const project = await nodeProject(ws, file);
    if (project) projects.push(project);
  }
  for (const file of (await find(SHALLOW("pubspec.yaml"))).sort()) {
    const project = await dartProject(ws, file);
    if (project) projects.push(project);
  }
  const pythonDirs = new Set((await find(SHALLOW("{pyproject.toml,requirements.txt,manage.py,setup.py}"))).map(dirOf));
  for (const dir of [...pythonDirs].sort()) {
    const project = await pythonProject(ws, dir);
    if (project) projects.push(project);
  }
  for (const file of (await find(SHALLOW("{pom.xml,build.gradle,build.gradle.kts}"))).sort()) {
    if (projects.some(p => p.dir === dirOf(file) && (p.kind === "spring-boot" || p.kind === "java" || p.kind === "android"))) continue;
    const project = await jvmProject(ws, file);
    if (project) projects.push(project);
  }
  for (const file of (await find("**/*.csproj", 30)).sort()) {
    const project = await dotnetProject(ws, file);
    if (project) projects.push(project);
  }
  for (const file of (await find(SHALLOW("*.xcodeproj/project.pbxproj"), 10)).sort()) {
    const dir = dirOf(dirOf(file));
    projects.push({ kind: "ios", dir, name: baseName(dirOf(file)).replace(/\.xcodeproj$/, ""), language: "Swift", framework: KIND_LABELS.ios, evidence: [dirOf(file)] });
  }

  // The android/ and ios/ folders of a React Native or Flutter app are part of that app.
  const crossPlatform = projects.filter(p => p.kind === "flutter" || p.kind === "react-native" || p.kind === "expo").map(p => p.dir);
  return projects.filter(p => !((p.kind === "android" || p.kind === "ios" || p.kind === "java") && crossPlatform.some(dir => p.dir === join(dir, "android") || p.dir === join(dir, "ios") || (dir && p.dir.startsWith(`${dir}/`)))));
}

async function readJson(ws: Workspace, file: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse((await ws.readFile(file)) ?? ""); } catch { return undefined; }
}

async function packageManager(ws: Workspace, dir: string): Promise<PackageManager> {
  for (const d of dir ? [dir, ""] : [""]) {
    if (await ws.exists(join(d, "pnpm-lock.yaml"))) return "pnpm";
    if (await ws.exists(join(d, "yarn.lock"))) return "yarn";
    if ((await ws.exists(join(d, "bun.lockb"))) || (await ws.exists(join(d, "bun.lock")))) return "bun";
    if (await ws.exists(join(d, "package-lock.json"))) return "npm";
  }
  return "npm";
}

async function nodeProject(ws: Workspace, file: string): Promise<DetectedProject | undefined> {
  const pkg = await readJson(ws, file);
  if (!pkg) return undefined;
  const dir = dirOf(file);
  const deps: Record<string, string> = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) };
  const has = (name: string) => name in deps;
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  // A workspace root that only orchestrates packages (turbo, nx, lerna) is not a project of its own.
  if (pkg.workspaces && !["next", "react-native", "expo", "@nestjs/core", "@angular/core", "vite", "react-scripts", "express", "fastify"].some(has)) return undefined;
  const kind: ProjectKind = has("expo") ? "expo" : has("react-native") ? "react-native" : has("next") ? "nextjs" : has("@nestjs/core") ? "nestjs"
    : has("@angular/core") ? "angular" : has("vite") ? "vite" : has("react-scripts") ? "cra" : "node";
  const typescript = has("typescript") || (await ws.exists(join(dir, "tsconfig.json")));
  const marker: Partial<Record<ProjectKind, string>> = { nextjs: "next", nestjs: "@nestjs/core", angular: "@angular/core", cra: "react-scripts", vite: "vite", expo: "expo", "react-native": "react-native" };
  const evidence = [marker[kind] ? `${file} (${marker[kind]})` : file];
  const testRunner = has("vitest") ? "vitest" : has("jest") || has("ts-jest") || has("jest-expo") ? "jest" : has("@playwright/test") ? "playwright" : has("mocha") ? "mocha" : undefined;
  const ports: Partial<Record<ProjectKind, number>> = { nextjs: 3000, vite: 5173, cra: 3000, angular: 4200, nestjs: 3000, node: 3000, expo: 8081, "react-native": 8081 };
  let entry: string | undefined;
  if (kind === "node") {
    const main = typeof pkg.main === "string" ? pkg.main.replace(/^\.\//, "") : undefined;
    const candidates = [main, "src/index.ts", "src/server.ts", "src/main.ts", "src/app.ts", "index.ts", "server.ts", "src/index.js", "index.js", "server.js", "app.js", "src/server.js", "src/app.js"].filter((c): c is string => !!c);
    for (const candidate of candidates) if (await ws.exists(join(dir, candidate))) { entry = candidate; break; }
  }
  return {
    kind, dir, name: String(pkg.name ?? (baseName(dir) || "app")), language: typescript ? "TypeScript" : "JavaScript", framework: KIND_LABELS[kind],
    evidence, packageManager: await packageManager(ws, dir), scripts, testRunner, port: ports[kind], entry,
    tsRunner: has("tsx") ? "tsx" : has("ts-node") ? "ts-node" : undefined
  };
}

async function dartProject(ws: Workspace, file: string): Promise<DetectedProject | undefined> {
  const text = (await ws.readFile(file)) ?? "";
  const dir = dirOf(file);
  const name = /^name:\s*([\w-]+)/m.exec(text)?.[1] ?? (baseName(dir) || "app");
  const flutter = /^\s+flutter:\s*\n\s+sdk:\s*flutter/m.test(text) || /sdk:\s*flutter/.test(text);
  if (flutter) return { kind: "flutter", dir, name, language: "Dart", framework: "Flutter", evidence: [`${file} (sdk: flutter)`], entry: "lib/main.dart", testRunner: "flutter_test" };
  const entry = (await ws.exists(join(dir, `bin/${name}.dart`))) ? `bin/${name}.dart` : (await ws.exists(join(dir, "bin/main.dart"))) ? "bin/main.dart" : undefined;
  return { kind: "dart", dir, name, language: "Dart", framework: "Dart", evidence: [file], entry, testRunner: /\btest:/.test(text) ? "test" : undefined };
}

const FASTAPI_FILES = ["main.py", "app/main.py", "src/main.py", "app.py", "api/main.py", "src/app/main.py", "server.py", "application.py"];
const FLASK_FILES = ["app.py", "wsgi.py", "main.py", "app/__init__.py", "src/app.py", "application.py"];

async function pythonProject(ws: Workspace, dir: string): Promise<DetectedProject | undefined> {
  const read = async (file: string) => (await ws.readFile(join(dir, file))) ?? "";
  const requirements = (await read("requirements.txt")) + "\n" + (await read("requirements-dev.txt")) + "\n" + (await read("requirements/base.txt"));
  const pyproject = await read("pyproject.toml");
  const deps = `${requirements}\n${pyproject}\n${await read("setup.py")}`.toLowerCase();
  const name = /^name\s*=\s*["']([^"']+)/m.exec(pyproject)?.[1] ?? (baseName(dir) || "app");
  const pytest = /\bpytest\b/.test(deps) || (await ws.exists(join(dir, "conftest.py"))) || (await ws.exists(join(dir, "pytest.ini")));
  const evidence = [join(dir, pyproject ? "pyproject.toml" : requirements.trim() ? "requirements.txt" : "manage.py")];
  const base = { dir, name, language: "Python", testRunner: pytest ? "pytest" : undefined };
  if (await ws.exists(join(dir, "manage.py"))) {
    return { ...base, kind: "django", framework: "Django", evidence: [...evidence, join(dir, "manage.py")], port: 8000, entry: "manage.py" };
  }
  if (/\bfastapi\b|\bstarlette\b/.test(deps)) {
    for (const file of FASTAPI_FILES) {
      const source = await read(file);
      const variable = /^([A-Za-z_]\w*)\s*(?::\s*FastAPI\s*)?=\s*FastAPI\s*\(/m.exec(source)?.[1];
      if (variable) return { ...base, kind: "fastapi", framework: "FastAPI", evidence: [...evidence, `${join(dir, file)} (${variable} = FastAPI())`], port: 8000, appModule: `${file.replace(/\.py$/, "").replace(/\//g, ".").replace(/\.__init__$/, "")}:${variable}` };
    }
    return { ...base, kind: "fastapi", framework: "FastAPI", evidence, port: 8000, appModule: "main:app" };
  }
  if (/\bflask\b/.test(deps)) {
    for (const file of FLASK_FILES) {
      const source = await read(file);
      if (/=\s*Flask\s*\(|def\s+create_app\s*\(/.test(source)) return { ...base, kind: "flask", framework: "Flask", evidence: [...evidence, join(dir, file)], port: 5000, appModule: file };
    }
    return { ...base, kind: "flask", framework: "Flask", evidence, port: 5000, appModule: "app.py" };
  }
  if (!deps.trim()) return undefined;
  let entry: string | undefined;
  for (const file of ["main.py", "app.py", "src/main.py", "__main__.py", "run.py"]) if (await ws.exists(join(dir, file))) { entry = file; break; }
  return { ...base, kind: "python", framework: "Python", evidence, entry };
}

async function jvmProject(ws: Workspace, file: string): Promise<DetectedProject | undefined> {
  const text = (await ws.readFile(file)) ?? "";
  const dir = dirOf(file);
  const maven = file.endsWith("pom.xml");
  if (!maven && /com\.android\.(application|library)/.test(text)) {
    if (!/com\.android\.application/.test(text)) return undefined;
    return { kind: "android", dir, name: baseName(dir) || "app", language: /kotlin/.test(text) ? "Kotlin" : "Java", framework: KIND_LABELS.android, evidence: [`${file} (com.android.application)`], buildTool: "gradle", wrapper: await hasWrapper(ws, dir, "gradle") };
  }
  const spring = maven ? /spring-boot/.test(text) : /org\.springframework\.boot/.test(text);
  const name = maven ? mavenArtifact(text) ?? (baseName(dir) || "app") : await gradleName(ws, dir);
  const sources = (await ws.findFiles(`${dir ? `${dir}/` : ""}src/main/{java,kotlin}/**/*.{java,kt}`, 400));
  const kotlin = sources.some(source => source.endsWith(".kt"));
  // Spring Initializr names the entry class <Name>Application; look there first.
  const ordered = [...sources.filter(source => /Application\.(java|kt)$/.test(source)), ...sources.filter(source => !/Application\.(java|kt)$/.test(source))].slice(0, 60);
  let mainClass: string | undefined;
  for (const source of ordered) {
    const code = (await ws.readFile(source)) ?? "";
    if (spring ? /@SpringBootApplication/.test(code) : /static\s+void\s+main\s*\(|^fun\s+main\s*\(/m.test(code)) {
      const pkg = /^\s*package\s+([\w.]+)/m.exec(code)?.[1];
      const cls = baseName(source).replace(/\.(java|kt)$/, "") + (source.endsWith(".kt") && !spring ? "Kt" : "");
      mainClass = pkg ? `${pkg}.${cls}` : cls;
      break;
    }
  }
  if (!spring && !mainClass && !sources.length) return undefined;
  return {
    kind: spring ? "spring-boot" : "java", dir, name, language: kotlin ? "Kotlin" : "Java", framework: spring ? "Spring Boot" : "Java",
    evidence: [`${file}${spring ? " (spring-boot)" : ""}`], buildTool: maven ? "maven" : "gradle", wrapper: await hasWrapper(ws, dir, maven ? "maven" : "gradle"),
    mainClass, port: spring ? 8080 : undefined, testRunner: "junit"
  };
}

function mavenArtifact(pom: string): string | undefined {
  const own = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencies>[\s\S]*<\/dependencies>/, "").replace(/<build>[\s\S]*<\/build>/, "");
  return /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(own)?.[1];
}

async function gradleName(ws: Workspace, dir: string): Promise<string> {
  const settings = (await ws.readFile(join(dir, "settings.gradle"))) ?? (await ws.readFile(join(dir, "settings.gradle.kts"))) ?? "";
  return /rootProject\.name\s*=\s*["']([^"']+)/.exec(settings)?.[1] ?? (baseName(dir) || "app");
}

async function hasWrapper(ws: Workspace, dir: string, tool: "maven" | "gradle"): Promise<boolean> {
  return ws.exists(join(dir, tool === "maven" ? "mvnw" : "gradlew"));
}

async function dotnetProject(ws: Workspace, file: string): Promise<DetectedProject | undefined> {
  const text = (await ws.readFile(file)) ?? "";
  const dir = dirOf(file);
  const csproj = baseName(file);
  const name = csproj.replace(/\.csproj$/i, "");
  const targetFramework = /<TargetFrameworks?>\s*([^<;\s]+)/.exec(text)?.[1] ?? "net8.0";
  const assemblyName = /<AssemblyName>\s*([^<\s]+)/.exec(text)?.[1] ?? name;
  const isTest = /Microsoft\.NET\.Test\.Sdk|<IsTestProject>\s*true/i.test(text);
  const web = /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.(Web|BlazorWebAssembly|Razor)"/i.test(text);
  const exe = /<OutputType>\s*(Exe|WinExe)\s*<\/OutputType>/i.test(text);
  if (/<UseMaui>\s*true/i.test(text)) return undefined;
  if (!web && !exe && !isTest) return undefined;
  const port = launchSettingsPort(await ws.readFile(join(dir, "Properties/launchSettings.json")));
  return {
    kind: web ? "aspnet" : "dotnet", dir, name, language: "C#", framework: isTest ? ".NET test project" : web ? "ASP.NET Core" : ".NET console",
    evidence: [`${file}${web ? " (Microsoft.NET.Sdk.Web)" : ""}`], csproj, targetFramework, assemblyName, isTest, port: web ? port ?? 5000 : undefined
  };
}

/** The http port of the first "Project" profile in launchSettings.json (dotnet run uses it; IIS Express settings do not apply). */
export function launchSettingsPort(text: string | undefined): number | undefined {
  if (!text) return undefined;
  try {
    const settings = JSON.parse(text.replace(/^\uFEFF/, "")) as { profiles?: Record<string, { commandName?: string; applicationUrl?: string }> };
    const urls = Object.values(settings.profiles ?? {}).filter(p => p.commandName === "Project" && p.applicationUrl).flatMap(p => p.applicationUrl!.split(";"));
    const url = urls.find(u => u.startsWith("http://")) ?? urls[0];
    const port = url ? Number(/:(\d+)\/?$/.exec(url.trim())?.[1]) : NaN;
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}
