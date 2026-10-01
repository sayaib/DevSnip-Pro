import { ToolSpec, ToolInputError, ToolResult, Values, bool, num, str } from "../types";
import { DockerOptions, Stack, detectStack, dockerRunToCompose, dockerignore, generateDockerfile, lintDockerfile } from "../engines/devops-docker";
import { ComposeService, K8sOptions, generateCompose, generateHelmChart, generateK8s, validateCompose, validateK8s } from "../engines/devops-k8s";
import { CiOptions, DeployTarget, deployWorkflow, githubActionsCi, gitlabCi, jenkinsfile, securityWorkflow } from "../engines/devops-ci";
import { HealthFramework, TerraformTemplate, generateHealth, generateNginx, generatePm2, generateTerraform } from "../engines/devops-config";
import { Level, WELL_KNOWN_PORTS, analyzeLogs, checkEnv, cidrContains, cidrInfo, cidrOverlap, envExample, envSchema, formatLogs, parsePorts, scanEnvUsage, splitCidr } from "../engines/devops-utils";
import { modelServingFiles, observabilityFiles } from "../engines/devops-mlops";
import { code, counts, f, opts, severityMessages, table } from "./helpers";

const STACKS = opts(["node", "Node.js"], ["python", "Python"], ["go", "Go"], ["java-maven", "Java (Maven)"], ["java-gradle", "Java (Gradle)"], ["static", "Static site (nginx)"]);

// ---------------------------------------------------------------------------
// Containers & Kubernetes
// ---------------------------------------------------------------------------

const dockerfile: ToolSpec = {
  id: "devops.dockerfile",
  command: "dockerfileHelper",
  title: "Dockerfile Generator & Linter",
  summary: "Generate a small, secure multi-stage Dockerfile for your stack (detected from the workspace), or check an existing Dockerfile for common mistakes.",
  guide: "Generated images build dependencies in a separate stage, run as a non-root user, use exec-form CMD so signals reach your app, and add a health check when you give a path. The linter follows hadolint's most useful rules plus secret and cache checks.",
  keywords: ["docker", "dockerfile", "container", "image", "multi-stage", "hadolint", "lint", ".dockerignore"],
  icon: "container",
  actions: [{ id: "detect", label: "Detect from workspace" }],
  fields: [
    f.select("mode", "Mode", opts(["generate", "Generate"], ["check", "Check an existing Dockerfile"])),
    f.code("dockerfile", "Dockerfile", "dockerfile", { rows: 14, fromEditor: true, showIf: { field: "mode", equals: ["check"] }, placeholder: "FROM node:latest\nCOPY . .\nRUN npm install\nCMD npm start" }),
    f.select("stack", "Stack", STACKS, { showIf: { field: "mode", equals: ["generate"] } }),
    f.text("version", "Runtime version", { width: "narrow", default: "22", showIf: { field: "mode", equals: ["generate"] } }),
    f.num("port", "Port", 3000, { min: 1, max: 65535, showIf: { field: "mode", equals: ["generate"] } }),
    f.select("packageManager", "Package manager", opts("npm", "pnpm", "yarn"), { showIf: { field: "stack", equals: ["node", "static"] } }),
    f.text("buildCommand", "Build command", { width: "narrow", default: "npm run build", showIf: { field: "stack", equals: ["node", "static"] } }),
    f.text("startCommand", "Start command", { width: "narrow", default: "node dist/index.js", showIf: { field: "stack", equals: ["node"] } }),
    f.select("pythonServer", "Python server", opts(["uvicorn", "uvicorn (FastAPI / ASGI)"], ["gunicorn", "gunicorn (Django / Flask)"], ["python", "python <file>"]), { showIf: { field: "stack", equals: ["python"] } }),
    f.text("appModule", "App module", { width: "narrow", default: "main:app", showIf: { field: "stack", equals: ["python"] } }),
    f.select("pythonDeps", "Dependencies from", opts(["requirements", "requirements.txt"], ["pyproject", "pyproject.toml"]), { showIf: { field: "stack", equals: ["python"] } }),
    f.text("healthPath", "Health check path", { width: "narrow", default: "/health", showIf: { field: "mode", equals: ["generate"] }, help: "Leave empty for no HEALTHCHECK." })
  ],
  async run(values, ctx, action) {
    if (action === "detect") {
      const d = await detectStack(ctx);
      const detected: Values = { mode: "generate", stack: d.stack };
      for (const [k, v] of Object.entries(d.options)) if (v !== undefined) detected[k] = v as string | number;
      const result = await dockerfile.run({ ...values, ...detected }, ctx);
      return { ...result, setValues: detected, messages: [{ kind: "success", text: `Detected ${d.evidence.join("; ")}.` }, ...(result.messages ?? [])] };
    }
    if (str(values, "mode", "generate") === "check") {
      const text = str(values, "dockerfile");
      if (!text.trim()) throw new ToolInputError("Paste a Dockerfile, or use the active editor.");
      const findings = lintDockerfile(text);
      return {
        stats: counts(findings),
        messages: severityMessages(findings.map(x => ({ severity: x.severity, line: x.line, message: `${x.message} (${x.rule})` })), "No problems found.")
      };
    }
    const stack = str(values, "stack", "node") as Stack;
    const o: DockerOptions = {
      stack,
      version: str(values, "version").trim() || (stack === "python" ? "3.12" : stack === "go" ? "1.23" : stack.startsWith("java") ? "21" : "22"),
      port: num(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }),
      packageManager: str(values, "packageManager", "npm") as DockerOptions["packageManager"],
      buildCommand: str(values, "buildCommand"),
      startCommand: str(values, "startCommand"),
      healthPath: str(values, "healthPath"),
      pythonServer: str(values, "pythonServer", "uvicorn") as DockerOptions["pythonServer"],
      appModule: str(values, "appModule", "main:app"),
      pythonDeps: str(values, "pythonDeps", "requirements") as DockerOptions["pythonDeps"]
    };
    const text = generateDockerfile(o);
    const findings = lintDockerfile(text).filter(x => x.severity !== "info");
    return {
      messages: findings.length ? findings.map(x => ({ kind: "warning" as const, text: `Line ${x.line}: ${x.message}` })) : [{ kind: "success", text: "Build with: docker build -t my-app . && docker run -p " + `${o.port}:${o.port} my-app` }],
      outputs: [{ kind: "files", title: "Files", files: [{ path: "Dockerfile", content: text, language: "dockerfile" }, { path: ".dockerignore", content: dockerignore(stack), language: "ignore" }] }]
    };
  }
};

const COMPOSE_SERVICES: ComposeService[] = ["postgres", "mysql", "redis", "mongo", "rabbitmq", "nginx", "minio", "mailpit"];
const SERVICE_LABELS: Record<ComposeService, string> = { postgres: "PostgreSQL", mysql: "MySQL", redis: "Redis", mongo: "MongoDB", rabbitmq: "RabbitMQ", nginx: "Nginx (reverse proxy)", minio: "MinIO (S3 storage)", mailpit: "Mailpit (test email)" };

const compose: ToolSpec = {
  id: "devops.compose",
  command: "composeHelper",
  title: "Docker Compose Generator & Validator",
  summary: "A local stack for your app with databases, caches, queues and mail - health checks, volumes and secrets from .env included - or validate an existing compose file.",
  guide: "Data stores are bound to 127.0.0.1 so they are not exposed on your network, and the app waits for them to be healthy before it starts. Secrets are read from .env (the generated .env.example lists them).",
  keywords: ["docker compose", "docker-compose.yml", "compose.yaml", "local environment", "postgres", "redis", "services"],
  icon: "layers",
  fields: [
    f.select("mode", "Mode", opts(["generate", "Generate"], ["check", "Validate an existing file"])),
    f.code("yaml", "compose.yaml", "yaml", { rows: 14, fromEditor: true, showIf: { field: "mode", equals: ["check"] } }),
    f.num("appPort", "App port", 3000, { min: 1, max: 65535, showIf: { field: "mode", equals: ["generate"] } }),
    f.toggle("build", "Build the app from the Dockerfile", true, { showIf: { field: "mode", equals: ["generate"] } }),
    f.text("image", "App image", { width: "narrow", placeholder: "ghcr.io/org/app:1.0.0", showIf: { field: "build", equals: [false] } }),
    f.text("healthPath", "App health path", { width: "narrow", default: "/health", showIf: { field: "mode", equals: ["generate"] } }),
    f.select("healthTool", "Health check uses", opts(["wget", "wget (Alpine / Debian)"], ["curl", "curl"], ["python", "python (slim Python images)"], ["none", "No health check"]), { showIf: { field: "mode", equals: ["generate"] } }),
    ...COMPOSE_SERVICES.map((s, i) => f.toggle(`svc_${s}`, SERVICE_LABELS[s], s === "postgres" || s === "redis", { showIf: { field: "mode", equals: ["generate"] }, group: i === 0 ? "Services" : undefined }))
  ],
  run(values) {
    if (str(values, "mode", "generate") === "check") {
      const text = str(values, "yaml");
      if (!text.trim()) throw new ToolInputError("Paste a compose file, or use the active editor.");
      const issues = validateCompose(text);
      return { stats: counts(issues), messages: severityMessages(issues, "The compose file looks good.") };
    }
    const services = COMPOSE_SERVICES.filter(s => bool(values, `svc_${s}`, s === "postgres" || s === "redis"));
    const r = generateCompose({ appPort: num(values, "appPort", 3000, { min: 1, max: 65535, integer: true, label: "App port" }), build: bool(values, "build", true), image: str(values, "image"), healthPath: str(values, "healthPath"), healthTool: str(values, "healthTool", "wget") as "wget" | "curl" | "python" | "none", services });
    const files = [{ path: "compose.yaml", content: r.compose, language: "yaml" }, { path: ".env.example", content: r.env, language: "dotenv" }];
    if (services.includes("nginx")) files.push({ path: "nginx.conf", content: generateNginx({ mode: "reverse-proxy", serverName: "localhost", upstreams: `app:${num(values, "appPort", 3000)}`, root: "", tls: false, websockets: true, gzip: true, rateLimit: 0, maxBodyMb: 10, securityHeaders: true }), language: "nginx" });
    return {
      messages: [{ kind: "info", text: "cp .env.example .env, set the passwords, then: docker compose up -d && docker compose ps" }],
      outputs: [{ kind: "files", title: "Files", files }]
    };
  }
};

const k8s: ToolSpec = {
  id: "devops.k8s",
  command: "kubernetesHelper",
  title: "Kubernetes & Helm Generator / Validator",
  summary: "Production-ready Deployment, Service, Ingress, HPA and PodDisruptionBudget - or a Helm chart - from a few settings; or validate existing manifests.",
  guide: "Generated workloads have resource requests and limits, startup/liveness/readiness probes, a non-root read-only security context and zero-downtime rolling updates. The validator catches removed API versions, selector mismatches, missing probes and limits, and literal secrets.",
  keywords: ["kubernetes", "k8s", "deployment", "service", "ingress", "hpa", "helm", "chart", "manifest", "kubectl", "yaml"],
  icon: "wheel",
  fields: [
    f.select("mode", "Mode", opts(["manifests", "Generate manifests"], ["helm", "Generate a Helm chart"], ["check", "Validate manifests"])),
    f.code("yaml", "Manifests", "yaml", { rows: 14, fromEditor: true, showIf: { field: "mode", equals: ["check"] } }),
    f.text("name", "App name", { width: "narrow", default: "my-app", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.text("namespace", "Namespace", { width: "narrow", default: "default", showIf: { field: "mode", equals: ["manifests"] } }),
    f.text("image", "Image", { default: "ghcr.io/my-org/my-app:1.0.0", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.num("port", "Container port", 8080, { min: 1, max: 65535, showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.num("replicas", "Replicas", 2, { min: 1, max: 100, showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.text("cpuRequest", "CPU request", { group: "Resources", width: "narrow", default: "100m", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.text("memoryRequest", "Memory request", { width: "narrow", default: "128Mi", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.text("cpuLimit", "CPU limit", { width: "narrow", default: "", placeholder: "none (recommended)", showIf: { field: "mode", equals: ["manifests"] } }),
    f.text("memoryLimit", "Memory limit", { width: "narrow", default: "256Mi", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.text("healthPath", "Health path", { group: "Health", width: "narrow", default: "/health", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.text("readinessPath", "Readiness path", { width: "narrow", default: "/ready", showIf: { field: "mode", equals: ["manifests"] } }),
    f.text("ingressHost", "Ingress host", { group: "Networking", width: "narrow", placeholder: "app.example.com", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.toggle("tls", "TLS via cert-manager", true, { showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.toggle("hpa", "Autoscale (HPA)", false, { group: "Scaling", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
    f.num("minReplicas", "Min replicas", 2, { min: 1, showIf: { field: "hpa", equals: [true] } }),
    f.num("maxReplicas", "Max replicas", 10, { min: 1, showIf: { field: "hpa", equals: [true] } }),
    f.num("targetCpu", "Target CPU %", 70, { min: 10, max: 100, showIf: { field: "hpa", equals: [true] } }),
    f.area("configMap", "Config (KEY=value)", { group: "Configuration", rows: 3, placeholder: "LOG_LEVEL=info", showIf: { field: "mode", equals: ["manifests"] } }),
    f.text("secretName", "Secret with env vars", { width: "narrow", placeholder: "my-app-secrets", showIf: { field: "mode", equals: ["manifests"] } }),
    f.toggle("pdb", "PodDisruptionBudget", true, { showIf: { field: "mode", equals: ["manifests"] } })
  ],
  run(values) {
    const mode = str(values, "mode", "manifests");
    if (mode === "check") {
      const text = str(values, "yaml");
      if (!text.trim()) throw new ToolInputError("Paste Kubernetes YAML, or use the active editor.");
      const issues = validateK8s(text);
      return { stats: counts(issues), messages: severityMessages(issues.map(i => ({ ...i, message: i.message })), "No problems found. Run kubectl apply --dry-run=server against a cluster for full schema validation.") };
    }
    const o: K8sOptions = {
      name: str(values, "name", "my-app"), namespace: str(values, "namespace", "default") === "default" ? "" : str(values, "namespace"),
      image: str(values, "image").trim() || "ghcr.io/my-org/my-app:1.0.0", port: num(values, "port", 8080, { min: 1, max: 65535, integer: true, label: "Port" }),
      replicas: num(values, "replicas", 2, { min: 1, max: 100, integer: true, label: "Replicas" }),
      cpuRequest: str(values, "cpuRequest", "100m"), memoryRequest: str(values, "memoryRequest", "128Mi"), cpuLimit: str(values, "cpuLimit"), memoryLimit: str(values, "memoryLimit", "256Mi"),
      healthPath: str(values, "healthPath"), readinessPath: str(values, "readinessPath"), ingressHost: str(values, "ingressHost"), tls: bool(values, "tls", true),
      hpa: bool(values, "hpa"), minReplicas: num(values, "minReplicas", 2, { min: 1, integer: true, label: "Min replicas" }), maxReplicas: num(values, "maxReplicas", 10, { min: 1, integer: true, label: "Max replicas" }), targetCpu: num(values, "targetCpu", 70, { min: 10, max: 100, integer: true, label: "Target CPU" }),
      configMap: str(values, "configMap"), secretName: str(values, "secretName"), pdb: bool(values, "pdb", true)
    };
    if (!/:[\w.-]+$|@sha256:/.test(o.image) || /:latest$/.test(o.image)) throw new ToolInputError("Pin the image to a version tag or digest (not :latest) so rollouts and rollbacks are predictable.");
    if (mode === "helm") {
      const files = generateHelmChart(o);
      return { messages: [{ kind: "info", text: `helm lint ${files[0].path.replace(/\/Chart\.yaml$/, "")} && helm upgrade --install ${o.name} ${files[0].path.replace(/\/Chart\.yaml$/, "")}` }], outputs: [{ kind: "files", title: "Helm chart", files }] };
    }
    const yaml = generateK8s(o);
    const issues = validateK8s(yaml).filter(i => i.severity !== "info");
    return {
      messages: issues.length ? issues.map(i => ({ kind: "warning" as const, text: i.message })) : [{ kind: "success", text: "kubectl apply --dry-run=server -f k8s/ to validate against your cluster, then kubectl apply -f k8s/." }],
      outputs: [code("Manifests", "yaml", yaml, `k8s/${o.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.yaml`)]
    };
  }
};

// ---------------------------------------------------------------------------
// CI/CD & cloud
// ---------------------------------------------------------------------------

const ci: ToolSpec = {
  id: "devops.ci",
  command: "ciPipelineGenerator",
  title: "CI Pipeline Generator",
  summary: "Install, lint, test and build pipelines for GitHub Actions, GitLab CI or Jenkins with caching, version matrices and least-privilege permissions; plus a security scanning workflow.",
  keywords: ["ci", "github actions", "workflow", "gitlab ci", "jenkinsfile", "pipeline", "codeql", "matrix", "continuous integration"],
  icon: "workflow",
  actions: [{ id: "detect", label: "Detect stack from workspace" }],
  fields: [
    f.select("platform", "Platform", opts(["github", "GitHub Actions"], ["gitlab", "GitLab CI"], ["jenkins", "Jenkins"], ["security", "GitHub security scanning (CodeQL, dependency review, secrets)"])),
    f.select("stack", "Stack", STACKS),
    f.text("version", "Version", { width: "narrow", placeholder: "22 / 3.12 / 1.23 / 21" }),
    f.text("matrix", "Also test versions", { width: "narrow", placeholder: "20, 24", showIf: { field: "platform", equals: ["github", "gitlab"] } }),
    f.select("packageManager", "Package manager", opts("npm", "pnpm", "yarn"), { showIf: { field: "stack", equals: ["node", "static"] } }),
    f.toggle("lint", "Lint", true, { showIf: { field: "platform", equals: ["github", "gitlab", "jenkins"] } }),
    f.toggle("test", "Test", true, { showIf: { field: "platform", equals: ["github", "gitlab", "jenkins"] } }),
    f.toggle("build", "Build", true, { showIf: { field: "platform", equals: ["github", "gitlab", "jenkins"] } }),
    f.text("branch", "Main branch", { width: "narrow", default: "main" })
  ],
  async run(values, ctx, action) {
    if (action === "detect") {
      const d = await detectStack(ctx);
      const setValues: Values = { stack: d.stack, ...(d.options.version ? { version: d.options.version } : {}), ...(d.options.packageManager ? { packageManager: d.options.packageManager } : {}) };
      const result = await ci.run({ ...values, ...setValues }, ctx);
      return { ...result, setValues, messages: [{ kind: "success", text: `Detected ${d.evidence.join("; ")}.` }, ...(result.messages ?? [])] };
    }
    const o: CiOptions = {
      stack: str(values, "stack", "node") as Stack, version: str(values, "version").trim(), matrix: str(values, "matrix"),
      packageManager: str(values, "packageManager", "npm") as CiOptions["packageManager"],
      lint: bool(values, "lint", true), test: bool(values, "test", true), build: bool(values, "build", true), branch: str(values, "branch", "main")
    };
    switch (str(values, "platform", "github")) {
      case "gitlab": return { outputs: [code(".gitlab-ci.yml", "yaml", gitlabCi(o), ".gitlab-ci.yml")] };
      case "jenkins": return { outputs: [code("Jenkinsfile", "groovy", jenkinsfile(o), "Jenkinsfile")] };
      case "security": return { messages: [{ kind: "info", text: "CodeQL is free for public repositories; private repositories need GitHub Advanced Security." }], outputs: [code("security.yml", "yaml", securityWorkflow(o.stack), ".github/workflows/security.yml")] };
      default: return { outputs: [code("ci.yml", "yaml", githubActionsCi(o), ".github/workflows/ci.yml")] };
    }
  }
};

const deploy: ToolSpec = {
  id: "devops.deploy",
  command: "cloudDeployGenerator",
  title: "Cloud Deploy Workflow",
  summary: "GitHub Actions workflows that publish images (GHCR, Docker Hub) or deploy to AWS ECS Fargate, S3 + CloudFront, Azure Container Apps or Azure Web App - using OIDC, not stored cloud keys.",
  guide: "Each workflow comes with the one-time setup steps: which roles, secrets and variables to create. OIDC lets GitHub assume a cloud role per run, so no long-lived access keys are stored in the repository.",
  keywords: ["deploy", "aws", "ecs", "fargate", "s3", "cloudfront", "azure", "container apps", "web app", "ghcr", "docker hub", "oidc", "cd"],
  icon: "cloud",
  fields: [
    f.select("target", "Target", opts(["ghcr", "Publish image to GitHub Container Registry"], ["dockerhub", "Publish image to Docker Hub"], ["aws-ecs", "AWS ECS Fargate"], ["aws-s3-static", "AWS S3 + CloudFront (static site)"], ["azure-container-apps", "Azure Container Apps"], ["azure-webapp", "Azure Web App (code)"])),
    f.text("appName", "App name", { width: "narrow", default: "my-app" }),
    f.text("branch", "Deploy branch", { width: "narrow", default: "main" }),
    f.text("region", "Region", { width: "narrow", default: "us-east-1", showIf: { field: "target", equals: ["aws-ecs", "aws-s3-static"] } }),
    f.num("port", "Container port", 3000, { min: 1, max: 65535, showIf: { field: "target", equals: ["aws-ecs", "azure-container-apps"] } }),
    f.select("cpu", "Fargate CPU", opts(["256", "0.25 vCPU"], ["512", "0.5 vCPU"], ["1024", "1 vCPU"], ["2048", "2 vCPU"], ["4096", "4 vCPU"]), { default: "512", showIf: { field: "target", equals: ["aws-ecs"] } }),
    f.num("memory", "Fargate memory (MiB)", 1024, { min: 512, step: 512, showIf: { field: "target", equals: ["aws-ecs"] } }),
    f.text("healthPath", "Health path", { width: "narrow", default: "/health", showIf: { field: "target", equals: ["aws-ecs"] } }),
    f.select("stack", "Runtime", opts(["node", "Node.js"], ["python", "Python"]), { showIf: { field: "target", equals: ["azure-webapp"] } }),
    f.text("version", "Runtime version", { width: "narrow", default: "22", showIf: { field: "target", equals: ["azure-webapp", "aws-s3-static"] } })
  ],
  run(values) {
    const r = deployWorkflow({
      target: str(values, "target", "ghcr") as DeployTarget, appName: str(values, "appName", "my-app"), branch: str(values, "branch", "main"), region: str(values, "region", "us-east-1"),
      port: num(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }), cpu: Number(str(values, "cpu", "512")), memory: num(values, "memory", 1024, { min: 512, integer: true, label: "Memory" }),
      stack: str(values, "stack", "node") as Stack, version: str(values, "version"), healthPath: str(values, "healthPath")
    });
    return { outputs: [{ kind: "files", title: "Workflow", files: r.files }, { kind: "text", title: "One-time setup", content: r.setup.map((s, i) => `${i + 1}. ${s}`).join("\n") }] };
  }
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const env: ToolSpec = {
  id: "devops.env",
  command: "envChecker",
  title: ".env Checker & Generator",
  summary: "Check a .env file for syntax errors, duplicates, placeholders and invalid ports/URLs; compare it with .env.example; find variables your code reads but never declares; and generate .env.example and typed config.",
  guide: "\"Scan workspace\" reads .env, .env.example and your source code (process.env, os.environ, os.Getenv, System.getenv, import.meta.env…). Values never leave your machine, and secret values are blanked in the generated .env.example.",
  keywords: ["env", "dotenv", ".env", "environment variables", "secrets", ".env.example", "zod", "pydantic settings", "config"],
  icon: "key",
  actions: [{ id: "scan", label: "Scan workspace" }],
  fields: [
    f.code("env", ".env", "dotenv", { rows: 10, fromEditor: true, default: "# App\nNODE_ENV=development\nPORT=3000\nDATABASE_URL=postgres://app:secret@localhost:5432/app\nOPENAI_API_KEY=changeme\nLOG_LEVEL=info\nFEATURE_FLAGS=beta search" }),
    f.code("example", ".env.example (optional)", "dotenv", { rows: 5, placeholder: "Compare against the variables the app expects" }),
    f.select("typed", "Also generate", opts(["none", "Nothing"], ["zod", "TypeScript config (zod)"], ["pydantic", "Python settings (pydantic-settings)"]))
  ],
  async run(values, ctx, action) {
    let envText = str(values, "env");
    let exampleText = str(values, "example");
    const messages: NonNullable<ToolResult["messages"]> = [];
    const outputs: NonNullable<ToolResult["outputs"]> = [];
    let setValues: Values | undefined;
    if (action === "scan") {
      const ws = ctx.workspace;
      if (!ws) throw new ToolInputError("Open a workspace folder to scan it.");
      const fileEnv = await ws.readFile(".env");
      const fileExample = (await ws.readFile(".env.example")) ?? (await ws.readFile(".env.sample")) ?? (await ws.readFile(".env.template"));
      if (fileEnv !== undefined) envText = fileEnv;
      if (fileExample !== undefined) exampleText = fileExample;
      setValues = { env: envText, example: exampleText };
      const usage = await scanEnvUsage(ctx);
      const declared = new Set([...checkEnv(envText).entries.map(e => e.key), ...checkEnv(exampleText).entries.map(e => e.key)]);
      const undeclared = usage.filter(u => !declared.has(u.key));
      messages.push({ kind: "info", text: `Read ${fileEnv !== undefined ? ".env" : "no .env"} and ${fileExample !== undefined ? ".env.example" : "no .env.example"}; ${usage.length} variable(s) are used in code.` });
      if (undeclared.length) messages.push({ kind: "warning", text: `${undeclared.length} variable(s) are read by the code but not declared in .env or .env.example: ${undeclared.map(u => u.key).join(", ")}.` });
      outputs.push(table("Variables used in code", ["Variable", "Declared", "Files"], usage.map(u => [u.key, declared.has(u.key) ? "yes" : "no", u.files.slice(0, 3).join(", ") + (u.files.length > 3 ? ` +${u.files.length - 3}` : "")])));
    }
    if (!envText.trim()) throw new ToolInputError("Paste a .env file, or scan the workspace.");
    const r = checkEnv(envText, exampleText.trim() ? exampleText : undefined);
    if (r.missing.length) messages.push({ kind: "error", text: `Missing from .env (listed in .env.example): ${r.missing.join(", ")}.` });
    if (r.extra.length && exampleText.trim()) messages.push({ kind: "info", text: `Not in .env.example (document them for teammates): ${r.extra.join(", ")}.` });
    if (r.empty.length) messages.push({ kind: "warning", text: `Empty values: ${r.empty.join(", ")}.` });
    const typed = str(values, "typed", "none");
    return {
      setValues,
      stats: [{ label: "Variables", value: String(r.entries.length) }, ...(counts(r.issues) ?? [])],
      messages: [...messages, ...severityMessages(r.issues, "No syntax problems.")],
      outputs: [
        ...outputs,
        code(".env.example", "dotenv", envExample(envText), ".env.example"),
        ...(typed === "zod" ? [code("env.ts", "typescript", envSchema(exampleText.trim() || envText, "zod"), "src/env.ts")] : []),
        ...(typed === "pydantic" ? [code("settings.py", "python", envSchema(exampleText.trim() || envText, "pydantic"), "settings.py")] : [])
      ]
    };
  }
};

const nginx: ToolSpec = {
  id: "devops.nginx",
  command: "nginxConfig",
  title: "Nginx Config Generator",
  summary: "Reverse proxy, load balancer, SPA or static site configs with HTTPS redirect, HTTP/2, gzip, security headers, rate limiting and WebSocket support.",
  keywords: ["nginx", "reverse proxy", "load balancer", "spa", "https", "ssl", "letsencrypt", "websocket", "server block"],
  icon: "server",
  live: true,
  fields: [
    f.select("mode", "Serve", opts(["reverse-proxy", "Reverse proxy to an app"], ["load-balancer", "Load balance several app servers"], ["spa", "Single-page app (React, Vue, Angular)"], ["static", "Static site"])),
    f.text("serverName", "Domain(s)", { default: "example.com www.example.com" }),
    f.area("upstreams", "Upstream servers (host:port)", { rows: 3, default: "127.0.0.1:3000", showIf: { field: "mode", equals: ["reverse-proxy", "load-balancer"] } }),
    f.text("root", "Web root", { width: "narrow", default: "/usr/share/nginx/html", showIf: { field: "mode", equals: ["spa", "static"] } }),
    f.toggle("tls", "HTTPS (Let's Encrypt paths)", true),
    f.toggle("websockets", "WebSockets", false, { showIf: { field: "mode", equals: ["reverse-proxy", "load-balancer"] } }),
    f.toggle("gzip", "gzip", true),
    f.toggle("securityHeaders", "Security headers", true),
    f.num("rateLimit", "Rate limit (req/s per IP, 0 = off)", 0, { min: 0, max: 10000 }),
    f.num("maxBodyMb", "Max upload (MB)", 10, { min: 1, max: 10240 })
  ],
  run(values) {
    const conf = generateNginx({ mode: str(values, "mode", "reverse-proxy") as "reverse-proxy", serverName: str(values, "serverName"), upstreams: str(values, "upstreams"), root: str(values, "root"), tls: bool(values, "tls", true), websockets: bool(values, "websockets"), gzip: bool(values, "gzip", true), rateLimit: num(values, "rateLimit", 0, { min: 0, max: 10000, integer: true, label: "Rate limit" }), maxBodyMb: num(values, "maxBodyMb", 10, { min: 1, max: 10240, integer: true, label: "Max upload" }), securityHeaders: bool(values, "securityHeaders", true) });
    return {
      messages: [{ kind: "info", text: `Test and reload: sudo nginx -t && sudo systemctl reload nginx${bool(values, "tls", true) ? ". Get certificates first: sudo certbot certonly --webroot -w /var/www/certbot -d " + str(values, "serverName").trim().split(/\s+/).join(" -d ") : ""}` }],
      outputs: [code("nginx.conf", "nginx", conf, "nginx/app.conf")]
    };
  }
};

const pm2: ToolSpec = {
  id: "devops.pm2",
  command: "pm2Config",
  title: "PM2 Ecosystem Generator",
  summary: "ecosystem.config.js for Node (cluster mode, zero-downtime reload) and Python/other processes, with memory limits, restarts, cron restarts and an optional deploy section.",
  keywords: ["pm2", "ecosystem.config.js", "process manager", "node", "cluster", "zero downtime", "vps"],
  icon: "activity",
  live: true,
  fields: [
    f.text("name", "App name", { width: "narrow", default: "api" }),
    f.text("script", "Script", { width: "narrow", default: "dist/index.js" }),
    f.select("interpreter", "Runs with", opts(["node", "Node.js"], ["python3", "Python 3"], ["none", "Binary / shell"])),
    f.text("instances", "Instances", { width: "narrow", default: "max", help: "A number, or max for one per CPU (Node cluster mode)." }),
    f.text("maxMemory", "Restart above memory", { width: "narrow", default: "500M" }),
    f.num("port", "PORT env", 3000, { min: 0, max: 65535 }),
    f.text("args", "Arguments", { width: "narrow" }),
    f.text("cron", "Cron restart", { width: "narrow", placeholder: "0 3 * * *" }),
    f.text("workerScript", "Worker script (optional)", { width: "narrow", placeholder: "dist/worker.js" }),
    f.text("deployHost", "Deploy host (optional)", { width: "narrow", placeholder: "203.0.113.10" }),
    f.text("deployRepo", "Git repo (for deploy)", { width: "narrow", placeholder: "git@github.com:org/app.git" })
  ],
  run(values) {
    const apps = [{ name: str(values, "name", "api"), script: str(values, "script", "dist/index.js"), args: str(values, "args"), interpreter: str(values, "interpreter", "node") as "node" | "python3" | "none", instances: str(values, "instances", "max"), maxMemory: str(values, "maxMemory"), port: num(values, "port", 3000, { min: 0, max: 65535, integer: true, label: "Port" }), cron: str(values, "cron") }];
    if (str(values, "workerScript").trim()) apps.push({ name: `${apps[0].name}-worker`, script: str(values, "workerScript").trim(), args: "", interpreter: apps[0].interpreter, instances: "1", maxMemory: apps[0].maxMemory, port: 0, cron: "" });
    const host = str(values, "deployHost").trim();
    return { outputs: [code("ecosystem.config.js", "javascript", generatePm2(apps, host ? { host, user: "deploy", repo: str(values, "deployRepo"), path: `/var/www/${apps[0].name}` } : undefined), "ecosystem.config.js")] };
  }
};

const terraform: ToolSpec = {
  id: "devops.terraform",
  command: "terraformGenerator",
  title: "Terraform Starter",
  summary: "A clean Terraform module (versions, variables with validation, main, outputs, tfvars, .gitignore) for common resources, with optional remote state and locking.",
  keywords: ["terraform", "iac", "infrastructure as code", "aws", "azure", "s3", "ec2", "ecr", "remote state", "opentofu"],
  icon: "grid",
  fields: [
    f.select("template", "Resource", opts(["aws-s3", "AWS S3 bucket (private, versioned, encrypted)"], ["aws-ecr", "AWS ECR repository"], ["aws-ec2", "AWS EC2 instance (SSM, no SSH)"], ["azure-webapp", "Azure Linux Web App"], ["docker-local", "Local Docker container"])),
    f.text("name", "Name", { width: "narrow", default: "my-app" }),
    f.select("environment", "Environment", opts("dev", "staging", "prod")),
    f.text("region", "Region / location", { width: "narrow", default: "us-east-1" }),
    f.toggle("remoteState", "Remote state backend", true, { showIf: { field: "template", equals: ["aws-s3", "aws-ecr", "aws-ec2", "azure-webapp"] } }),
    f.text("stateBucket", "State bucket / account", { width: "narrow", placeholder: "my-app-terraform-state", showIf: { field: "remoteState", equals: [true] } })
  ],
  run(values) {
    const template = str(values, "template", "aws-s3") as TerraformTemplate;
    const files = generateTerraform({ template, name: str(values, "name", "my-app"), region: str(values, "region").trim() || (template.startsWith("azure") ? "westeurope" : "us-east-1"), environment: str(values, "environment", "dev"), remoteState: bool(values, "remoteState", true) && template !== "docker-local", stateBucket: str(values, "stateBucket") });
    const dir = files[0].path.replace(/\/versions\.tf$/, "");
    return { messages: [{ kind: "info", text: `cd ${dir} && terraform init && terraform fmt && terraform validate && terraform plan -var-file=${str(values, "environment", "dev")}.tfvars` }], outputs: [{ kind: "files", title: "Module", files }] };
  }
};

// ---------------------------------------------------------------------------
// Troubleshoot
// ---------------------------------------------------------------------------

const network: ToolSpec = {
  id: "devops.network",
  command: "networkTools",
  title: "Port & Network Toolkit",
  summary: "Check which local ports are free, look up what a port is usually used for, and calculate CIDR ranges, subnets and overlaps.",
  keywords: ["port", "port in use", "EADDRINUSE", "cidr", "subnet", "ip range", "vpc", "localhost"],
  icon: "network",
  fields: [
    f.select("mode", "Tool", opts(["ports", "Are these ports free?"], ["cidr", "CIDR / subnet calculator"], ["reference", "Common ports reference"])),
    f.text("ports", "Ports", { default: "3000, 5432, 6379, 8000-8003", showIf: { field: "mode", equals: ["ports"] } }),
    f.text("cidr", "CIDR", { default: "10.0.0.0/16", showIf: { field: "mode", equals: ["cidr"] } }),
    f.num("subnetPrefix", "Split into /", 20, { min: 0, max: 32, showIf: { field: "mode", equals: ["cidr"] } }),
    f.text("check", "Contains IP or overlaps CIDR", { width: "narrow", placeholder: "10.0.3.7 or 10.0.128.0/17", showIf: { field: "mode", equals: ["cidr"] } })
  ],
  async run(values, ctx) {
    const mode = str(values, "mode", "ports");
    if (mode === "reference") return { outputs: [table("Common ports", ["Port", "Usually"], Object.entries(WELL_KNOWN_PORTS).map(([p, n]) => [Number(p), n]))] };
    if (mode === "cidr") {
      const cidr = str(values, "cidr");
      const info = cidrInfo(cidr);
      const prefix = num(values, "subnetPrefix", 20, { min: 0, max: 32, integer: true, label: "Prefix" });
      const outputs: NonNullable<ToolResult["outputs"]> = [table("Range", ["Field", "Value"], [["Network", info.cidr], ["Netmask", info.netmask], ["Wildcard", info.wildcard], ["First host", info.firstHost], ["Last host", info.lastHost], ["Broadcast", info.broadcast], ["Addresses", info.totalAddresses.toLocaleString("en-US")], ["Usable hosts", info.usableHosts.toLocaleString("en-US")], ["Private (RFC 1918 / CGNAT)", info.private ? "yes" : "no"]])];
      const messages: NonNullable<ToolResult["messages"]> = [];
      if (prefix >= Number(info.cidr.split("/")[1])) {
        const subnets = splitCidr(cidr, prefix, 256);
        outputs.push(code(`Subnets /${prefix} (${subnets.length}${2 ** (prefix - Number(info.cidr.split("/")[1])) > 256 ? " of " + (2 ** (prefix - Number(info.cidr.split("/")[1]))).toLocaleString("en-US") : ""})`, "text", subnets.join("\n")));
      }
      const check = str(values, "check").trim();
      if (check) {
        const inside = check.includes("/") ? cidrOverlap(cidr, check) : cidrContains(cidr, check);
        messages.push({ kind: inside ? "warning" : "success", text: check.includes("/") ? `${check} ${inside ? "overlaps" : "does not overlap"} ${info.cidr}.` : `${check} is ${inside ? "inside" : "outside"} ${info.cidr}.` });
      }
      return { messages, outputs };
    }
    const ports = parsePorts(str(values, "ports"));
    if (!ctx.network) throw new ToolInputError("Port checks are not available here.");
    const rows = await Promise.all(ports.map(async p => {
      const free = await ctx.network!.isPortFree(p);
      return [p, free ? "free" : "IN USE", WELL_KNOWN_PORTS[p] ?? ""];
    }));
    const busy = rows.filter(r => r[1] !== "free");
    return {
      stats: [{ label: "Checked", value: String(rows.length) }, { label: "In use", value: String(busy.length), tone: busy.length ? "warn" : "good" }],
      messages: busy.length ? [{ kind: "info", text: `Find the process: macOS/Linux "lsof -nP -iTCP:${busy[0][0]} -sTCP:LISTEN", Windows "netstat -ano | findstr :${busy[0][0]}".` }] : [],
      outputs: [table("Ports on this machine", ["Port", "Status", "Usually"], rows)]
    };
  }
};

const logs: ToolSpec = {
  id: "devops.logs",
  command: "observabilityAnalyze",
  title: "Log Analyzer & Formatter",
  summary: "Make sense of application, JSON (pino, winston, bunyan, structlog) or access logs: level counts, time range, top error patterns, status codes, slow requests - or pretty-print and filter them.",
  guide: "Open a log file and use the editor contents, or paste lines. Similar error messages are grouped by replacing ids, numbers and quoted values, so the top patterns show what actually breaks.",
  keywords: ["logs", "log file", "errors", "stack trace", "json logs", "nginx access log", "pretty print", "observability", "pino"],
  icon: "activity",
  live: true,
  fields: [
    f.select("mode", "Mode", opts(["analyze", "Analyze"], ["format", "Pretty-print & filter"])),
    f.code("log", "Log lines", "log", { rows: 14, required: true, fromEditor: true, default: '{"level":30,"time":1759140000000,"msg":"request completed","responseTime":42,"req":{"method":"GET","url":"/api/orders"}}\n{"level":50,"time":1759140003000,"msg":"db timeout after 5000ms","requestId":"r-81"}\n{"level":50,"time":1759140007000,"msg":"db timeout after 5000ms","requestId":"r-82"}\n2025-09-29T10:00:09Z WARN cache miss ratio 0.62\n127.0.0.1 - - [29/Sep/2025:10:00:12 +0000] "GET /api/users HTTP/1.1" 502 157 "-" "curl/8.5"\n2025-09-29 10:00:15,221 ERROR [worker-3] Unhandled exception\n    at OrderService.save (order.ts:88)\n    at processTicksAndRejections (node:internal/process)' }),
    f.select("minLevel", "Minimum level", opts(["all", "All"], ["debug", "Debug"], ["info", "Info"], ["warn", "Warning"], ["error", "Error"]), { showIf: { field: "mode", equals: ["format"] } }),
    f.text("search", "Contains", { width: "narrow", showIf: { field: "mode", equals: ["format"] } }),
    f.toggle("showFields", "Show extra fields", true, { showIf: { field: "mode", equals: ["format"] } })
  ],
  run(values) {
    const text = str(values, "log");
    if (!text.trim()) throw new ToolInputError("Paste log lines, or open a log file and use the editor.");
    if (str(values, "mode", "analyze") === "format") {
      const r = formatLogs(text, { minLevel: str(values, "minLevel", "all") as Level | "all", search: str(values, "search"), showFields: bool(values, "showFields", true) });
      return { stats: [{ label: "Shown", value: `${r.shown} of ${r.total}` }], outputs: [code("Logs", "log", r.text || "(no matching lines)")] };
    }
    const a = analyzeLogs(text);
    const errors = a.levels.error + a.levels.fatal;
    return {
      stats: [
        { label: "Lines", value: String(a.total) },
        { label: "Errors", value: String(errors), tone: errors ? "bad" : "good" },
        { label: "Warnings", value: String(a.levels.warn), tone: a.levels.warn ? "warn" : "good" },
        ...(a.first ? [{ label: "Time range", value: a.first === a.last ? a.first : `${a.first} → ${a.last}` }] : []),
        ...Object.entries(a.statuses).map(([k, v]) => ({ label: `HTTP ${k}`, value: String(v), tone: (k.startsWith("5") ? "bad" : k.startsWith("4") ? "warn" : "neutral") as "bad" | "warn" | "neutral" }))
      ],
      messages: a.recommendations.map(t => ({ kind: "info" as const, text: t })),
      outputs: [
        ...(a.topErrors.length ? [table("Top error patterns", ["Count", "First line", "Example"], a.topErrors.map(e => [e.count, e.firstLine, e.example]))] : []),
        table("Levels", ["Level", "Lines"], Object.entries(a.levels).filter(([, n]) => n).map(([l, n]) => [l, n])),
        ...(a.slowest.length ? [table("Slowest", ["Line", "ms", "Message"], a.slowest.map(s => [s.line, s.ms, s.message]))] : [])
      ]
    };
  }
};

const health: ToolSpec = {
  id: "devops.health",
  command: "healthCheckGenerator",
  title: "Health Check Generator",
  summary: "Liveness and readiness endpoints for Express, Fastify, FastAPI, Flask, Spring Boot or Go - with dependency checks and timeouts - plus matching Docker, Compose and Kubernetes probes.",
  guide: "Liveness says the process is alive and must not check dependencies, or one slow database restarts every pod. Readiness checks dependencies and takes the instance out of the load balancer while they are down.",
  keywords: ["health check", "healthz", "readiness", "liveness", "probe", "express", "fastapi", "spring actuator"],
  icon: "heart",
  live: true,
  fields: [
    f.select("framework", "Framework", opts(["express", "Express"], ["fastify", "Fastify"], ["fastapi", "FastAPI"], ["flask", "Flask"], ["spring", "Spring Boot"], ["go", "Go (net/http)"])),
    f.num("port", "Port", 3000, { min: 1, max: 65535 }),
    f.toggle("database", "Check database", true),
    f.toggle("redis", "Check Redis", false),
    f.toggle("http", "Check an upstream HTTP service", false),
    f.num("timeoutMs", "Check timeout (ms)", 2000, { min: 100, max: 30000 })
  ],
  run(values) {
    const checks = (["database", "redis", "http"] as const).filter(c => bool(values, c, c === "database"));
    const r = generateHealth({ framework: str(values, "framework", "express") as HealthFramework, port: num(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }), checks, timeoutMs: num(values, "timeoutMs", 2000, { min: 100, max: 30000, integer: true, label: "Timeout" }) });
    return { outputs: [code(r.code.path, r.code.language ?? "text", r.code.content, r.code.path), code("Dockerfile HEALTHCHECK", "dockerfile", r.probes.dockerfile), code("Docker Compose", "yaml", r.probes.compose), code("Kubernetes probes", "yaml", r.probes.kubernetes)] };
  }
};

// ---------------------------------------------------------------------------
// Observability & MLOps
// ---------------------------------------------------------------------------

const observability: ToolSpec = {
  id: "devops.observability",
  command: "observabilityStarter",
  title: "Observability Starter",
  summary: "OpenTelemetry tracing, structured JSON logging with trace ids and redaction, a log schema, and a local Jaeger to see traces - for Node.js or Python.",
  keywords: ["opentelemetry", "otel", "tracing", "structured logging", "pino", "jaeger", "observability"],
  icon: "eye",
  fields: [f.select("stack", "Stack", opts(["node", "Node.js / TypeScript"], ["python", "Python (FastAPI)"])), f.text("service", "Service name", { width: "narrow", default: "orders-api" })],
  run(values) {
    const files = observabilityFiles(str(values, "stack", "node") as "node" | "python", str(values, "service", "orders-api"));
    return { messages: [{ kind: "info", text: "docker compose -f observability/otel-compose.yaml up -d, run the app with observability/otel.env, then open http://localhost:16686." }], outputs: [{ kind: "files", title: "Files", files }] };
  }
};

const serving: ToolSpec = {
  id: "devops.serving",
  command: "mlopsGenerator",
  title: "Model Serving Starter",
  summary: "Serve an ML model behind FastAPI with health/readiness, a versioned predict schema and structured logs - Dockerfile (CPU or CUDA), Kubernetes with GPU scheduling, CI with a smoke test.",
  keywords: ["mlops", "model serving", "inference api", "fastapi", "gpu", "cuda", "kubernetes gpu"],
  icon: "cpu",
  fields: [
    f.text("name", "Model / service name", { width: "narrow", default: "churn-model" }),
    f.num("port", "Port", 8000, { min: 1, max: 65535 }),
    f.toggle("gpu", "GPU (CUDA)", false),
    f.text("cudaVersion", "CUDA version", { width: "narrow", default: "12.4.1", showIf: { field: "gpu", equals: [true] } }),
    f.text("pythonVersion", "Python", { width: "narrow", default: "3.12", showIf: { field: "gpu", equals: [false] } }),
    f.text("image", "Image", { width: "narrow", placeholder: "registry/churn-model:0.1.0" }),
    f.num("memoryGi", "Memory request (GiB)", 4, { min: 1, max: 512 })
  ],
  run(values) {
    const files = modelServingFiles({ name: str(values, "name", "churn-model"), port: num(values, "port", 8000, { min: 1, max: 65535, integer: true, label: "Port" }), gpu: bool(values, "gpu"), cudaVersion: str(values, "cudaVersion"), pythonVersion: str(values, "pythonVersion"), image: str(values, "image"), memoryGi: num(values, "memoryGi", 4, { min: 1, max: 512, integer: true, label: "Memory" }) });
    return { outputs: [{ kind: "files", title: "Files", files }] };
  }
};

const dockerRun: ToolSpec = {
  id: "devops.docker-run",
  command: "dockerRunToCompose",
  title: "docker run → Compose",
  summary: "Convert one or more docker run commands (from READMEs and docs) into a compose.yaml: ports, env, volumes, networks, restart policy, health checks, resources, GPUs and more.",
  keywords: ["docker run", "docker compose", "composerize", "compose.yaml", "convert docker run", "docker-compose.yml"],
  icon: "container",
  live: true,
  fields: [f.code("commands", "docker run commands", "shell", { rows: 10, required: true, fromEditor: true, default: "docker run -d --name db -p 5432:5432 \\\n  -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=app \\\n  -v pgdata:/var/lib/postgresql/data \\\n  --restart unless-stopped \\\n  --health-cmd \"pg_isready -U postgres\" --health-interval 10s \\\n  postgres:16-alpine\n\ndocker run -d --name cache -p 6379:6379 redis:7-alpine redis-server --appendonly yes" })],
  run(values) {
    const r = dockerRunToCompose(str(values, "commands"));
    return {
      stats: [{ label: "Services", value: String(r.services.length) }],
      messages: [...r.notes.map(t => ({ kind: "warning" as const, text: t })), { kind: "info", text: "Start it with docker compose up -d; services reach each other by service name (e.g. postgres://db:5432)." }],
      outputs: [code("compose.yaml", "yaml", r.yaml, "compose.yaml")]
    };
  }
};

export const DEVOPS_TOOLS: ToolSpec[] = [
  dockerfile, dockerRun, compose, k8s,
  ci, deploy,
  env, nginx, pm2, terraform,
  network, logs, health,
  observability, serving
];
