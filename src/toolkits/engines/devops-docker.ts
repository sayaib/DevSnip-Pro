import { ToolContext, ToolInputError } from "../types";

/**
 * Dockerfile generation (from the workspace's real stack) and linting.
 */

export type Stack = "node" | "python" | "go" | "java-maven" | "java-gradle" | "static";

export interface DockerOptions {
  stack: Stack;
  version: string;
  port: number;
  packageManager: "npm" | "pnpm" | "yarn";
  buildCommand: string;
  startCommand: string;
  healthPath: string;
  pythonServer: "uvicorn" | "gunicorn" | "python";
  appModule: string;
  pythonDeps: "requirements" | "pyproject";
}

export interface DetectedStack {
  stack: Stack;
  evidence: string[];
  options: Partial<DockerOptions>;
}

/** Reads the workspace to fill in real commands instead of guessing. */
export async function detectStack(ctx: ToolContext): Promise<DetectedStack> {
  const ws = ctx.workspace;
  if (!ws) throw new ToolInputError("Open a workspace folder to detect its stack, or choose the stack manually.");
  const evidence: string[] = [];
  if (await ws.exists("package.json")) {
    const pkg = JSON.parse((await ws.readFile("package.json")) || "{}");
    const scripts = pkg.scripts ?? {};
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const pm: DockerOptions["packageManager"] = (await ws.exists("pnpm-lock.yaml")) ? "pnpm" : (await ws.exists("yarn.lock")) ? "yarn" : "npm";
    evidence.push(`package.json (${pm})`);
    const isStatic = !scripts.start && (deps.vite || deps["react-scripts"] || deps["@angular/core"]) && !deps.express && !deps.next;
    const engines = String(pkg.engines?.node ?? "").match(/\d+/)?.[0];
    if (isStatic) {
      evidence.push("front-end build without a server: served by nginx");
      return { stack: "static", evidence, options: { packageManager: pm, buildCommand: scripts.build ? `${pm} run build` : "", port: 8080, version: engines ?? "22" } };
    }
    const start = scripts.start ? `${pm === "npm" ? "npm" : pm} start` : pkg.main ? `node ${pkg.main}` : "node index.js";
    if (deps.next) evidence.push("Next.js: consider output: \"standalone\" in next.config for a smaller image");
    return { stack: "node", evidence, options: { packageManager: pm, buildCommand: scripts.build ? `${pm} run build` : "", startCommand: start, version: engines ?? "22", port: deps.next ? 3000 : 3000 } };
  }
  const requirements = (await ws.readFile("requirements.txt")) ?? "";
  const pyproject = (await ws.readFile("pyproject.toml")) ?? "";
  if (requirements || pyproject) {
    evidence.push(requirements ? "requirements.txt" : "pyproject.toml");
    const pythonDeps: DockerOptions["pythonDeps"] = requirements ? "requirements" : "pyproject";
    const all = `${requirements}\n${pyproject}`.toLowerCase();
    const candidates = ["main.py", "app.py", "app/main.py", "src/main.py", "manage.py", "wsgi.py"];
    let entry = "";
    for (const c of candidates) if (await ws.exists(c)) { entry = c; break; }
    if (/django/.test(all)) {
      const settings = (await ws.findFiles("**/wsgi.py", 5)).find(p => !p.includes("site-packages"));
      const module = settings ? settings.replace(/\.py$/, "").replace(/\//g, ".") : "project.wsgi";
      evidence.push(`Django (${module})`);
      return { stack: "python", evidence, options: { pythonServer: "gunicorn", appModule: `${module}:application`, port: 8000, version: "3.12", pythonDeps } };
    }
    if (/fastapi|starlette/.test(all)) {
      const module = entry ? entry.replace(/\.py$/, "").replace(/\//g, ".") : "main";
      evidence.push(`FastAPI (${module}:app)`);
      return { stack: "python", evidence, options: { pythonServer: "uvicorn", appModule: `${module}:app`, port: 8000, version: "3.12", pythonDeps } };
    }
    if (/flask/.test(all)) {
      const module = entry ? entry.replace(/\.py$/, "").replace(/\//g, ".") : "app";
      evidence.push(`Flask (${module}:app)`);
      return { stack: "python", evidence, options: { pythonServer: "gunicorn", appModule: `${module}:app`, port: 8000, version: "3.12", pythonDeps } };
    }
    return { stack: "python", evidence, options: { pythonServer: "python", appModule: entry || "main.py", port: 8000, version: "3.12", pythonDeps } };
  }
  if (await ws.exists("go.mod")) {
    const mod = (await ws.readFile("go.mod")) ?? "";
    evidence.push("go.mod");
    return { stack: "go", evidence, options: { version: /^go (\d+\.\d+)/m.exec(mod)?.[1] ?? "1.23", port: 8080 } };
  }
  if (await ws.exists("pom.xml")) { evidence.push("pom.xml (Maven)"); return { stack: "java-maven", evidence, options: { version: "21", port: 8080 } }; }
  if ((await ws.exists("build.gradle")) || (await ws.exists("build.gradle.kts"))) { evidence.push("build.gradle (Gradle)"); return { stack: "java-gradle", evidence, options: { version: "21", port: 8080 } }; }
  if (await ws.exists("index.html")) { evidence.push("index.html (static site)"); return { stack: "static", evidence, options: { port: 8080 } }; }
  throw new ToolInputError("Could not detect the stack (no package.json, requirements.txt, pyproject.toml, go.mod, pom.xml, build.gradle or index.html at the workspace root). Choose it manually.");
}

const shellToExec = (command: string) => JSON.stringify(command.trim().split(/\s+/));

export function generateDockerfile(o: DockerOptions): string {
  const health = o.healthPath.trim();
  switch (o.stack) {
    case "node": {
      const lock = o.packageManager === "pnpm" ? "pnpm-lock.yaml" : o.packageManager === "yarn" ? "yarn.lock" : "package-lock.json";
      const install = o.packageManager === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile" : o.packageManager === "yarn" ? "corepack enable && yarn install --frozen-lockfile" : "npm ci";
      const prodInstall = o.packageManager === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile --prod" : o.packageManager === "yarn" ? "corepack enable && yarn install --frozen-lockfile --production" : "npm ci --omit=dev";
      const build = o.buildCommand.trim();
      return `# syntax=docker/dockerfile:1
FROM node:${o.version}-alpine AS deps
WORKDIR /app
COPY package.json ${lock} ./
RUN ${prodInstall} && npm cache clean --force

${build ? `FROM node:${o.version}-alpine AS build
WORKDIR /app
COPY package.json ${lock} ./
RUN ${install}
COPY . .
RUN ${build}

` : ""}FROM node:${o.version}-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
${build ? "COPY --from=build --chown=node:node /app ./" : "COPY --chown=node:node . ."}
USER node
EXPOSE ${o.port}
${health ? `HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:${o.port}${health} >/dev/null || exit 1
` : ""}CMD ${shellToExec(o.startCommand || "node index.js")}
`;
    }
    case "python": {
      const cmd = o.pythonServer === "uvicorn"
        ? `["uvicorn", "${o.appModule}", "--host", "0.0.0.0", "--port", "${o.port}", "--proxy-headers"]`
        : o.pythonServer === "gunicorn"
          ? `["gunicorn", "${o.appModule}", "--bind", "0.0.0.0:${o.port}", "--workers", "2", "--access-logfile", "-"]`
          : `["python", "${o.appModule}"]`;
      const deps = o.pythonDeps === "pyproject"
        ? `COPY pyproject.toml ./\nCOPY . .\nRUN pip install .`
        : `COPY requirements*.txt ./\nRUN pip install -r requirements.txt`;
      const server = o.pythonServer === "python" ? "" : `\nRUN pip install ${o.pythonServer}`;
      return `# syntax=docker/dockerfile:1
FROM python:${o.version}-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
${deps}${server}

FROM python:${o.version}-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
WORKDIR /app
RUN useradd --create-home --uid 10001 app
COPY --from=build /opt/venv /opt/venv
COPY --chown=app:app . .
USER app
EXPOSE ${o.port}
${health ? `HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \\
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${o.port}${health}', timeout=4).status < 400 else 1)"
` : ""}CMD ${cmd}
`;
    }
    case "go":
      return `# syntax=docker/dockerfile:1
FROM golang:${o.version}-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/app .

# Distroless: no shell or package manager; runs as a non-root user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
EXPOSE ${o.port}
USER nonroot:nonroot
ENTRYPOINT ["/app"]
${health ? `# Distroless images have no shell or curl: use Kubernetes/Compose probes, or add a "healthcheck" subcommand to your binary.\n` : ""}`;
    case "java-maven":
    case "java-gradle": {
      const build = o.stack === "java-maven"
        ? `COPY mvnw pom.xml ./\nCOPY .mvn .mvn\nRUN ./mvnw -B dependency:go-offline\nCOPY src src\nRUN ./mvnw -B package -DskipTests && cp target/*.jar /app.jar`
        : `COPY gradlew settings.gradle* build.gradle* ./\nCOPY gradle gradle\nRUN ./gradlew --no-daemon dependencies > /dev/null\nCOPY src src\nRUN ./gradlew --no-daemon bootJar -x test && cp build/libs/*[!plain].jar /app.jar`;
      return `# syntax=docker/dockerfile:1
FROM eclipse-temurin:${o.version}-jdk AS build
WORKDIR /workspace
${build}

FROM eclipse-temurin:${o.version}-jre
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /app.jar app.jar
USER app
EXPOSE ${o.port}
${health ? `HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:${o.port}${health} >/dev/null || exit 1
` : ""}ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
`;
    }
    case "static": {
      const build = o.buildCommand.trim();
      const lock = o.packageManager === "pnpm" ? "pnpm-lock.yaml" : o.packageManager === "yarn" ? "yarn.lock" : "package-lock.json";
      const install = o.packageManager === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile" : o.packageManager === "yarn" ? "corepack enable && yarn install --frozen-lockfile" : "npm ci";
      return `# syntax=docker/dockerfile:1
${build ? `FROM node:${o.version || "22"}-alpine AS build
WORKDIR /app
COPY package.json ${lock} ./
RUN ${install}
COPY . .
RUN ${build}

` : ""}FROM nginxinc/nginx-unprivileged:1.27-alpine
${build ? "COPY --from=build /app/dist /usr/share/nginx/html" : "COPY . /usr/share/nginx/html"}
# SPA routing: serve index.html for unknown paths.
RUN printf 'server {\\n  listen ${o.port};\\n  root /usr/share/nginx/html;\\n  location / { try_files $uri $uri/ /index.html; }\\n}\\n' > /etc/nginx/conf.d/default.conf
EXPOSE ${o.port}
`;
    }
  }
}

export function dockerignore(stack: Stack): string {
  const common = [".git", ".gitignore", ".env", ".env.*", "!.env.example", "Dockerfile*", "docker-compose*.yml", "*.log", ".vscode", ".idea", "coverage", "README.md"];
  const extra: Record<Stack, string[]> = {
    node: ["node_modules", "dist", ".next", ".turbo", "npm-debug.log*"],
    static: ["node_modules", "dist", ".cache"],
    python: ["__pycache__", "*.pyc", ".venv", "venv", ".pytest_cache", ".mypy_cache", "*.egg-info"],
    go: ["bin", "*.test"],
    "java-maven": ["target"],
    "java-gradle": ["build", ".gradle"]
  };
  return [...extra[stack], ...common].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Linting
// ---------------------------------------------------------------------------

export interface LintFinding { severity: "error" | "warning" | "info"; line: number; rule: string; message: string }

export function lintDockerfile(text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  // Join continuation lines but remember where each instruction starts.
  const instructions: Array<{ line: number; keyword: string; args: string }> = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const startLine = i + 1;
    let current = lines[i];
    if (/^\s*(#|$)/.test(current)) continue;
    while (/\\\s*$/.test(current) && i + 1 < lines.length) current = current.replace(/\\\s*$/, " ") + lines[++i].replace(/^\s*#.*$/, "");
    const match = /^\s*([A-Za-z]+)\s*(.*)$/.exec(current);
    if (match) instructions.push({ line: startLine, keyword: match[1].toUpperCase(), args: match[2].trim() });
  }
  if (!instructions.length) return [{ severity: "error", line: 1, rule: "empty", message: "The Dockerfile has no instructions." }];
  const add = (severity: LintFinding["severity"], line: number, rule: string, message: string) => findings.push({ severity, line, rule, message });
  if (instructions[0].keyword !== "FROM" && instructions[0].keyword !== "ARG") add("error", instructions[0].line, "first-from", "A Dockerfile must start with FROM (or ARG before FROM).");
  const stages = instructions.filter(i => i.keyword === "FROM");
  const stageNames = new Set(stages.map(s => /\bAS\s+(\S+)/i.exec(s.args)?.[1]?.toLowerCase()).filter(Boolean) as string[]);
  const lastStageIndex = instructions.lastIndexOf(stages[stages.length - 1]);
  let lastUser: string | undefined;
  let copiedAllBeforeInstall = false;
  const cmds = { CMD: 0, ENTRYPOINT: 0, HEALTHCHECK: 0 };
  instructions.forEach((ins, index) => {
    const { keyword, args, line } = ins;
    const inFinal = index >= lastStageIndex;
    switch (keyword) {
      case "FROM": {
        const image = args.replace(/--platform=\S+\s+/, "").split(/\s+/)[0];
        if (stageNames.has(image.toLowerCase()) || image === "scratch" || image.startsWith("$")) break;
        if (!/[:@]/.test(image.split("/").pop() ?? "")) add("warning", line, "DL3006", `Pin the base image version: "${image}" resolves to :latest and can change under you.`);
        else if (/:latest$/.test(image)) add("warning", line, "DL3007", `"${image}" uses :latest; pin a version (and ideally a digest).`);
        if (index > lastStageIndex - 1 || index === lastStageIndex) lastUser = undefined;
        break;
      }
      case "RUN": {
        if (/apt-get\s+install/.test(args) && !/--no-install-recommends/.test(args)) add("info", line, "DL3015", "apt-get install without --no-install-recommends pulls in extra packages.");
        if (/apt-get\s+install/.test(args) && !/rm -rf \/var\/lib\/apt\/lists/.test(args)) add("info", line, "DL3009", "Remove /var/lib/apt/lists/* in the same RUN to keep the layer small.");
        if (/apt-get\s+update/.test(args) && !/apt-get\s+(-\S+\s+)*install/.test(args)) add("warning", line, "DL3009", "apt-get update in its own RUN is cached separately: later installs may use stale package lists. Combine update and install in one RUN.");
        if (/\bapk\s+add\b/.test(args) && !/--no-cache/.test(args)) add("info", line, "DL3019", "Use apk add --no-cache.");
        if (/\bpip3?\s+install\b/.test(args) && !/--no-cache-dir/.test(args) && !/PIP_NO_CACHE_DIR/.test(text)) add("info", line, "DL3042", "pip install without --no-cache-dir keeps the download cache in the image.");
        if (/\bnpm\s+install\b/.test(args) && !/-g\b|--global/.test(args)) add("info", line, "npm-ci", "Use npm ci for reproducible installs from the lockfile.");
        if (/curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh/.test(args)) add("warning", line, "DL4006", "Piping a download into a shell runs unverified code; download, verify the checksum, then run.");
        if (/\bsudo\b/.test(args)) add("warning", line, "DL3004", "Do not use sudo in a Dockerfile; switch USER instead.");
        if (/(^|&&|;)\s*cd\s+/.test(args)) add("info", line, "DL3003", "Use WORKDIR instead of cd.");
        if (/(npm ci|npm install|pip install|go mod download|mvn|gradle)/.test(args) && copiedAllBeforeInstall) add("info", line, "cache", "Dependencies are installed after COPY . . - any source change reinstalls them. Copy the manifest/lockfile first, install, then copy the rest.");
        break;
      }
      case "ADD":
        if (!/^(https?:|--)/.test(args) && !/\.(tar|tar\.gz|tgz|tar\.xz)\b/.test(args)) add("info", line, "DL3020", "Use COPY for local files; ADD also extracts archives and fetches URLs.");
        break;
      case "COPY":
        if (/^(--chown=\S+\s+)?\.\s+\.?\/?\S*$/.test(args) || /^(--chown=\S+\s+)?\.\s/.test(args)) copiedAllBeforeInstall = true;
        break;
      case "ENV":
      case "ARG":
        if (/(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY)\s*[= ]\s*\S/i.test(args)) add("error", line, "secrets", `${keyword} with a secret value is stored in the image layers and history. Use build secrets (RUN --mount=type=secret) or runtime environment variables.`);
        break;
      case "USER":
        lastUser = args;
        break;
      case "EXPOSE":
        for (const port of args.split(/\s+/)) {
          const n = Number(port.split("/")[0]);
          if (!Number.isInteger(n) || n < 1 || n > 65535) add("error", line, "DL3011", `Invalid port "${port}".`);
        }
        break;
      case "WORKDIR":
        if (!args.startsWith("/") && !args.startsWith("$")) add("warning", line, "DL3000", "Use an absolute WORKDIR.");
        break;
      case "MAINTAINER":
        add("info", line, "DL4000", "MAINTAINER is deprecated; use LABEL org.opencontainers.image.authors=...");
        break;
      case "CMD":
      case "ENTRYPOINT":
        if (inFinal) cmds[keyword]++;
        if (!args.startsWith("[")) add("warning", line, "DL3025", `Use the JSON form: ${keyword} ["executable", "arg"]. The shell form runs under /bin/sh, which does not forward SIGTERM, so containers are killed instead of shutting down gracefully.`);
        break;
      case "HEALTHCHECK":
        if (inFinal) cmds.HEALTHCHECK++;
        break;
    }
  });
  if (cmds.CMD > 1) add("warning", instructions[lastStageIndex].line, "DL4003", "Multiple CMD instructions in the final stage; only the last one applies.");
  if (cmds.ENTRYPOINT > 1) add("warning", instructions[lastStageIndex].line, "DL4004", "Multiple ENTRYPOINT instructions in the final stage; only the last one applies.");
  const finalFrom = stages[stages.length - 1]?.args ?? "";
  const distrolessNonRoot = /distroless.*nonroot|nginx-unprivileged/.test(finalFrom);
  if (!distrolessNonRoot && (!lastUser || /^(root|0)(:|$)/.test(lastUser))) add("warning", instructions[lastStageIndex].line, "DL3002", "The final stage runs as root. Add a non-root USER.");
  if (!cmds.HEALTHCHECK && !/distroless|scratch/.test(finalFrom)) add("info", instructions[instructions.length - 1].line, "healthcheck", "No HEALTHCHECK: Docker and Compose cannot tell a hung container from a healthy one (Kubernetes uses probes instead).");
  return findings.sort((a, b) => a.line - b.line);
}
