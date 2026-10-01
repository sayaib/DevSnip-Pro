"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVOPS_TOOLS = void 0;
const types_1 = require("../types");
const devops_docker_1 = require("../engines/devops-docker");
const devops_k8s_1 = require("../engines/devops-k8s");
const devops_ci_1 = require("../engines/devops-ci");
const devops_config_1 = require("../engines/devops-config");
const devops_utils_1 = require("../engines/devops-utils");
const devops_mlops_1 = require("../engines/devops-mlops");
const helpers_1 = require("./helpers");
const STACKS = (0, helpers_1.opts)(["node", "Node.js"], ["python", "Python"], ["go", "Go"], ["java-maven", "Java (Maven)"], ["java-gradle", "Java (Gradle)"], ["static", "Static site (nginx)"]);
// ---------------------------------------------------------------------------
// Containers & Kubernetes
// ---------------------------------------------------------------------------
const dockerfile = {
    id: "devops.dockerfile",
    command: "dockerfileHelper",
    title: "Dockerfile Generator & Linter",
    summary: "Generate a small, secure multi-stage Dockerfile for your stack (detected from the workspace), or check an existing Dockerfile for common mistakes.",
    guide: "Generated images build dependencies in a separate stage, run as a non-root user, use exec-form CMD so signals reach your app, and add a health check when you give a path. The linter follows hadolint's most useful rules plus secret and cache checks.",
    keywords: ["docker", "dockerfile", "container", "image", "multi-stage", "hadolint", "lint", ".dockerignore"],
    icon: "container",
    actions: [{ id: "detect", label: "Detect from workspace" }],
    fields: [
        helpers_1.f.select("mode", "Mode", (0, helpers_1.opts)(["generate", "Generate"], ["check", "Check an existing Dockerfile"])),
        helpers_1.f.code("dockerfile", "Dockerfile", "dockerfile", { rows: 14, fromEditor: true, showIf: { field: "mode", equals: ["check"] }, placeholder: "FROM node:latest\nCOPY . .\nRUN npm install\nCMD npm start" }),
        helpers_1.f.select("stack", "Stack", STACKS, { showIf: { field: "mode", equals: ["generate"] } }),
        helpers_1.f.text("version", "Runtime version", { width: "narrow", default: "22", showIf: { field: "mode", equals: ["generate"] } }),
        helpers_1.f.num("port", "Port", 3000, { min: 1, max: 65535, showIf: { field: "mode", equals: ["generate"] } }),
        helpers_1.f.select("packageManager", "Package manager", (0, helpers_1.opts)("npm", "pnpm", "yarn"), { showIf: { field: "stack", equals: ["node", "static"] } }),
        helpers_1.f.text("buildCommand", "Build command", { width: "narrow", default: "npm run build", showIf: { field: "stack", equals: ["node", "static"] } }),
        helpers_1.f.text("startCommand", "Start command", { width: "narrow", default: "node dist/index.js", showIf: { field: "stack", equals: ["node"] } }),
        helpers_1.f.select("pythonServer", "Python server", (0, helpers_1.opts)(["uvicorn", "uvicorn (FastAPI / ASGI)"], ["gunicorn", "gunicorn (Django / Flask)"], ["python", "python <file>"]), { showIf: { field: "stack", equals: ["python"] } }),
        helpers_1.f.text("appModule", "App module", { width: "narrow", default: "main:app", showIf: { field: "stack", equals: ["python"] } }),
        helpers_1.f.select("pythonDeps", "Dependencies from", (0, helpers_1.opts)(["requirements", "requirements.txt"], ["pyproject", "pyproject.toml"]), { showIf: { field: "stack", equals: ["python"] } }),
        helpers_1.f.text("healthPath", "Health check path", { width: "narrow", default: "/health", showIf: { field: "mode", equals: ["generate"] }, help: "Leave empty for no HEALTHCHECK." })
    ],
    async run(values, ctx, action) {
        if (action === "detect") {
            const d = await (0, devops_docker_1.detectStack)(ctx);
            const detected = { mode: "generate", stack: d.stack };
            for (const [k, v] of Object.entries(d.options))
                if (v !== undefined)
                    detected[k] = v;
            const result = await dockerfile.run({ ...values, ...detected }, ctx);
            return { ...result, setValues: detected, messages: [{ kind: "success", text: `Detected ${d.evidence.join("; ")}.` }, ...(result.messages ?? [])] };
        }
        if ((0, types_1.str)(values, "mode", "generate") === "check") {
            const text = (0, types_1.str)(values, "dockerfile");
            if (!text.trim())
                throw new types_1.ToolInputError("Paste a Dockerfile, or use the active editor.");
            const findings = (0, devops_docker_1.lintDockerfile)(text);
            return {
                stats: (0, helpers_1.counts)(findings),
                messages: (0, helpers_1.severityMessages)(findings.map(x => ({ severity: x.severity, line: x.line, message: `${x.message} (${x.rule})` })), "No problems found.")
            };
        }
        const stack = (0, types_1.str)(values, "stack", "node");
        const o = {
            stack,
            version: (0, types_1.str)(values, "version").trim() || (stack === "python" ? "3.12" : stack === "go" ? "1.23" : stack.startsWith("java") ? "21" : "22"),
            port: (0, types_1.num)(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }),
            packageManager: (0, types_1.str)(values, "packageManager", "npm"),
            buildCommand: (0, types_1.str)(values, "buildCommand"),
            startCommand: (0, types_1.str)(values, "startCommand"),
            healthPath: (0, types_1.str)(values, "healthPath"),
            pythonServer: (0, types_1.str)(values, "pythonServer", "uvicorn"),
            appModule: (0, types_1.str)(values, "appModule", "main:app"),
            pythonDeps: (0, types_1.str)(values, "pythonDeps", "requirements")
        };
        const text = (0, devops_docker_1.generateDockerfile)(o);
        const findings = (0, devops_docker_1.lintDockerfile)(text).filter(x => x.severity !== "info");
        return {
            messages: findings.length ? findings.map(x => ({ kind: "warning", text: `Line ${x.line}: ${x.message}` })) : [{ kind: "success", text: "Build with: docker build -t my-app . && docker run -p " + `${o.port}:${o.port} my-app` }],
            outputs: [{ kind: "files", title: "Files", files: [{ path: "Dockerfile", content: text, language: "dockerfile" }, { path: ".dockerignore", content: (0, devops_docker_1.dockerignore)(stack), language: "ignore" }] }]
        };
    }
};
const COMPOSE_SERVICES = ["postgres", "mysql", "redis", "mongo", "rabbitmq", "nginx", "minio", "mailpit"];
const SERVICE_LABELS = { postgres: "PostgreSQL", mysql: "MySQL", redis: "Redis", mongo: "MongoDB", rabbitmq: "RabbitMQ", nginx: "Nginx (reverse proxy)", minio: "MinIO (S3 storage)", mailpit: "Mailpit (test email)" };
const compose = {
    id: "devops.compose",
    command: "composeHelper",
    title: "Docker Compose Generator & Validator",
    summary: "A local stack for your app with databases, caches, queues and mail - health checks, volumes and secrets from .env included - or validate an existing compose file.",
    guide: "Data stores are bound to 127.0.0.1 so they are not exposed on your network, and the app waits for them to be healthy before it starts. Secrets are read from .env (the generated .env.example lists them).",
    keywords: ["docker compose", "docker-compose.yml", "compose.yaml", "local environment", "postgres", "redis", "services"],
    icon: "layers",
    fields: [
        helpers_1.f.select("mode", "Mode", (0, helpers_1.opts)(["generate", "Generate"], ["check", "Validate an existing file"])),
        helpers_1.f.code("yaml", "compose.yaml", "yaml", { rows: 14, fromEditor: true, showIf: { field: "mode", equals: ["check"] } }),
        helpers_1.f.num("appPort", "App port", 3000, { min: 1, max: 65535, showIf: { field: "mode", equals: ["generate"] } }),
        helpers_1.f.toggle("build", "Build the app from the Dockerfile", true, { showIf: { field: "mode", equals: ["generate"] } }),
        helpers_1.f.text("image", "App image", { width: "narrow", placeholder: "ghcr.io/org/app:1.0.0", showIf: { field: "build", equals: [false] } }),
        helpers_1.f.text("healthPath", "App health path", { width: "narrow", default: "/health", showIf: { field: "mode", equals: ["generate"] } }),
        helpers_1.f.select("healthTool", "Health check uses", (0, helpers_1.opts)(["wget", "wget (Alpine / Debian)"], ["curl", "curl"], ["python", "python (slim Python images)"], ["none", "No health check"]), { showIf: { field: "mode", equals: ["generate"] } }),
        ...COMPOSE_SERVICES.map((s, i) => helpers_1.f.toggle(`svc_${s}`, SERVICE_LABELS[s], s === "postgres" || s === "redis", { showIf: { field: "mode", equals: ["generate"] }, group: i === 0 ? "Services" : undefined }))
    ],
    run(values) {
        if ((0, types_1.str)(values, "mode", "generate") === "check") {
            const text = (0, types_1.str)(values, "yaml");
            if (!text.trim())
                throw new types_1.ToolInputError("Paste a compose file, or use the active editor.");
            const issues = (0, devops_k8s_1.validateCompose)(text);
            return { stats: (0, helpers_1.counts)(issues), messages: (0, helpers_1.severityMessages)(issues, "The compose file looks good.") };
        }
        const services = COMPOSE_SERVICES.filter(s => (0, types_1.bool)(values, `svc_${s}`, s === "postgres" || s === "redis"));
        const r = (0, devops_k8s_1.generateCompose)({ appPort: (0, types_1.num)(values, "appPort", 3000, { min: 1, max: 65535, integer: true, label: "App port" }), build: (0, types_1.bool)(values, "build", true), image: (0, types_1.str)(values, "image"), healthPath: (0, types_1.str)(values, "healthPath"), healthTool: (0, types_1.str)(values, "healthTool", "wget"), services });
        const files = [{ path: "compose.yaml", content: r.compose, language: "yaml" }, { path: ".env.example", content: r.env, language: "dotenv" }];
        if (services.includes("nginx"))
            files.push({ path: "nginx.conf", content: (0, devops_config_1.generateNginx)({ mode: "reverse-proxy", serverName: "localhost", upstreams: `app:${(0, types_1.num)(values, "appPort", 3000)}`, root: "", tls: false, websockets: true, gzip: true, rateLimit: 0, maxBodyMb: 10, securityHeaders: true }), language: "nginx" });
        return {
            messages: [{ kind: "info", text: "cp .env.example .env, set the passwords, then: docker compose up -d && docker compose ps" }],
            outputs: [{ kind: "files", title: "Files", files }]
        };
    }
};
const k8s = {
    id: "devops.k8s",
    command: "kubernetesHelper",
    title: "Kubernetes & Helm Generator / Validator",
    summary: "Production-ready Deployment, Service, Ingress, HPA and PodDisruptionBudget - or a Helm chart - from a few settings; or validate existing manifests.",
    guide: "Generated workloads have resource requests and limits, startup/liveness/readiness probes, a non-root read-only security context and zero-downtime rolling updates. The validator catches removed API versions, selector mismatches, missing probes and limits, and literal secrets.",
    keywords: ["kubernetes", "k8s", "deployment", "service", "ingress", "hpa", "helm", "chart", "manifest", "kubectl", "yaml"],
    icon: "wheel",
    fields: [
        helpers_1.f.select("mode", "Mode", (0, helpers_1.opts)(["manifests", "Generate manifests"], ["helm", "Generate a Helm chart"], ["check", "Validate manifests"])),
        helpers_1.f.code("yaml", "Manifests", "yaml", { rows: 14, fromEditor: true, showIf: { field: "mode", equals: ["check"] } }),
        helpers_1.f.text("name", "App name", { width: "narrow", default: "my-app", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.text("namespace", "Namespace", { width: "narrow", default: "default", showIf: { field: "mode", equals: ["manifests"] } }),
        helpers_1.f.text("image", "Image", { default: "ghcr.io/my-org/my-app:1.0.0", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.num("port", "Container port", 8080, { min: 1, max: 65535, showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.num("replicas", "Replicas", 2, { min: 1, max: 100, showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.text("cpuRequest", "CPU request", { group: "Resources", width: "narrow", default: "100m", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.text("memoryRequest", "Memory request", { width: "narrow", default: "128Mi", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.text("cpuLimit", "CPU limit", { width: "narrow", default: "", placeholder: "none (recommended)", showIf: { field: "mode", equals: ["manifests"] } }),
        helpers_1.f.text("memoryLimit", "Memory limit", { width: "narrow", default: "256Mi", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.text("healthPath", "Health path", { group: "Health", width: "narrow", default: "/health", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.text("readinessPath", "Readiness path", { width: "narrow", default: "/ready", showIf: { field: "mode", equals: ["manifests"] } }),
        helpers_1.f.text("ingressHost", "Ingress host", { group: "Networking", width: "narrow", placeholder: "app.example.com", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.toggle("tls", "TLS via cert-manager", true, { showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.toggle("hpa", "Autoscale (HPA)", false, { group: "Scaling", showIf: { field: "mode", equals: ["manifests", "helm"] } }),
        helpers_1.f.num("minReplicas", "Min replicas", 2, { min: 1, showIf: { field: "hpa", equals: [true] } }),
        helpers_1.f.num("maxReplicas", "Max replicas", 10, { min: 1, showIf: { field: "hpa", equals: [true] } }),
        helpers_1.f.num("targetCpu", "Target CPU %", 70, { min: 10, max: 100, showIf: { field: "hpa", equals: [true] } }),
        helpers_1.f.area("configMap", "Config (KEY=value)", { group: "Configuration", rows: 3, placeholder: "LOG_LEVEL=info", showIf: { field: "mode", equals: ["manifests"] } }),
        helpers_1.f.text("secretName", "Secret with env vars", { width: "narrow", placeholder: "my-app-secrets", showIf: { field: "mode", equals: ["manifests"] } }),
        helpers_1.f.toggle("pdb", "PodDisruptionBudget", true, { showIf: { field: "mode", equals: ["manifests"] } })
    ],
    run(values) {
        const mode = (0, types_1.str)(values, "mode", "manifests");
        if (mode === "check") {
            const text = (0, types_1.str)(values, "yaml");
            if (!text.trim())
                throw new types_1.ToolInputError("Paste Kubernetes YAML, or use the active editor.");
            const issues = (0, devops_k8s_1.validateK8s)(text);
            return { stats: (0, helpers_1.counts)(issues), messages: (0, helpers_1.severityMessages)(issues.map(i => ({ ...i, message: i.message })), "No problems found. Run kubectl apply --dry-run=server against a cluster for full schema validation.") };
        }
        const o = {
            name: (0, types_1.str)(values, "name", "my-app"), namespace: (0, types_1.str)(values, "namespace", "default") === "default" ? "" : (0, types_1.str)(values, "namespace"),
            image: (0, types_1.str)(values, "image").trim() || "ghcr.io/my-org/my-app:1.0.0", port: (0, types_1.num)(values, "port", 8080, { min: 1, max: 65535, integer: true, label: "Port" }),
            replicas: (0, types_1.num)(values, "replicas", 2, { min: 1, max: 100, integer: true, label: "Replicas" }),
            cpuRequest: (0, types_1.str)(values, "cpuRequest", "100m"), memoryRequest: (0, types_1.str)(values, "memoryRequest", "128Mi"), cpuLimit: (0, types_1.str)(values, "cpuLimit"), memoryLimit: (0, types_1.str)(values, "memoryLimit", "256Mi"),
            healthPath: (0, types_1.str)(values, "healthPath"), readinessPath: (0, types_1.str)(values, "readinessPath"), ingressHost: (0, types_1.str)(values, "ingressHost"), tls: (0, types_1.bool)(values, "tls", true),
            hpa: (0, types_1.bool)(values, "hpa"), minReplicas: (0, types_1.num)(values, "minReplicas", 2, { min: 1, integer: true, label: "Min replicas" }), maxReplicas: (0, types_1.num)(values, "maxReplicas", 10, { min: 1, integer: true, label: "Max replicas" }), targetCpu: (0, types_1.num)(values, "targetCpu", 70, { min: 10, max: 100, integer: true, label: "Target CPU" }),
            configMap: (0, types_1.str)(values, "configMap"), secretName: (0, types_1.str)(values, "secretName"), pdb: (0, types_1.bool)(values, "pdb", true)
        };
        if (!/:[\w.-]+$|@sha256:/.test(o.image) || /:latest$/.test(o.image))
            throw new types_1.ToolInputError("Pin the image to a version tag or digest (not :latest) so rollouts and rollbacks are predictable.");
        if (mode === "helm") {
            const files = (0, devops_k8s_1.generateHelmChart)(o);
            return { messages: [{ kind: "info", text: `helm lint ${files[0].path.replace(/\/Chart\.yaml$/, "")} && helm upgrade --install ${o.name} ${files[0].path.replace(/\/Chart\.yaml$/, "")}` }], outputs: [{ kind: "files", title: "Helm chart", files }] };
        }
        const yaml = (0, devops_k8s_1.generateK8s)(o);
        const issues = (0, devops_k8s_1.validateK8s)(yaml).filter(i => i.severity !== "info");
        return {
            messages: issues.length ? issues.map(i => ({ kind: "warning", text: i.message })) : [{ kind: "success", text: "kubectl apply --dry-run=server -f k8s/ to validate against your cluster, then kubectl apply -f k8s/." }],
            outputs: [(0, helpers_1.code)("Manifests", "yaml", yaml, `k8s/${o.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.yaml`)]
        };
    }
};
// ---------------------------------------------------------------------------
// CI/CD & cloud
// ---------------------------------------------------------------------------
const ci = {
    id: "devops.ci",
    command: "ciPipelineGenerator",
    title: "CI Pipeline Generator",
    summary: "Install, lint, test and build pipelines for GitHub Actions, GitLab CI or Jenkins with caching, version matrices and least-privilege permissions; plus a security scanning workflow.",
    keywords: ["ci", "github actions", "workflow", "gitlab ci", "jenkinsfile", "pipeline", "codeql", "matrix", "continuous integration"],
    icon: "workflow",
    actions: [{ id: "detect", label: "Detect stack from workspace" }],
    fields: [
        helpers_1.f.select("platform", "Platform", (0, helpers_1.opts)(["github", "GitHub Actions"], ["gitlab", "GitLab CI"], ["jenkins", "Jenkins"], ["security", "GitHub security scanning (CodeQL, dependency review, secrets)"])),
        helpers_1.f.select("stack", "Stack", STACKS),
        helpers_1.f.text("version", "Version", { width: "narrow", placeholder: "22 / 3.12 / 1.23 / 21" }),
        helpers_1.f.text("matrix", "Also test versions", { width: "narrow", placeholder: "20, 24", showIf: { field: "platform", equals: ["github", "gitlab"] } }),
        helpers_1.f.select("packageManager", "Package manager", (0, helpers_1.opts)("npm", "pnpm", "yarn"), { showIf: { field: "stack", equals: ["node", "static"] } }),
        helpers_1.f.toggle("lint", "Lint", true, { showIf: { field: "platform", equals: ["github", "gitlab", "jenkins"] } }),
        helpers_1.f.toggle("test", "Test", true, { showIf: { field: "platform", equals: ["github", "gitlab", "jenkins"] } }),
        helpers_1.f.toggle("build", "Build", true, { showIf: { field: "platform", equals: ["github", "gitlab", "jenkins"] } }),
        helpers_1.f.text("branch", "Main branch", { width: "narrow", default: "main" })
    ],
    async run(values, ctx, action) {
        if (action === "detect") {
            const d = await (0, devops_docker_1.detectStack)(ctx);
            const setValues = { stack: d.stack, ...(d.options.version ? { version: d.options.version } : {}), ...(d.options.packageManager ? { packageManager: d.options.packageManager } : {}) };
            const result = await ci.run({ ...values, ...setValues }, ctx);
            return { ...result, setValues, messages: [{ kind: "success", text: `Detected ${d.evidence.join("; ")}.` }, ...(result.messages ?? [])] };
        }
        const o = {
            stack: (0, types_1.str)(values, "stack", "node"), version: (0, types_1.str)(values, "version").trim(), matrix: (0, types_1.str)(values, "matrix"),
            packageManager: (0, types_1.str)(values, "packageManager", "npm"),
            lint: (0, types_1.bool)(values, "lint", true), test: (0, types_1.bool)(values, "test", true), build: (0, types_1.bool)(values, "build", true), branch: (0, types_1.str)(values, "branch", "main")
        };
        switch ((0, types_1.str)(values, "platform", "github")) {
            case "gitlab": return { outputs: [(0, helpers_1.code)(".gitlab-ci.yml", "yaml", (0, devops_ci_1.gitlabCi)(o), ".gitlab-ci.yml")] };
            case "jenkins": return { outputs: [(0, helpers_1.code)("Jenkinsfile", "groovy", (0, devops_ci_1.jenkinsfile)(o), "Jenkinsfile")] };
            case "security": return { messages: [{ kind: "info", text: "CodeQL is free for public repositories; private repositories need GitHub Advanced Security." }], outputs: [(0, helpers_1.code)("security.yml", "yaml", (0, devops_ci_1.securityWorkflow)(o.stack), ".github/workflows/security.yml")] };
            default: return { outputs: [(0, helpers_1.code)("ci.yml", "yaml", (0, devops_ci_1.githubActionsCi)(o), ".github/workflows/ci.yml")] };
        }
    }
};
const deploy = {
    id: "devops.deploy",
    command: "cloudDeployGenerator",
    title: "Cloud Deploy Workflow",
    summary: "GitHub Actions workflows that publish images (GHCR, Docker Hub) or deploy to AWS ECS Fargate, S3 + CloudFront, Azure Container Apps or Azure Web App - using OIDC, not stored cloud keys.",
    guide: "Each workflow comes with the one-time setup steps: which roles, secrets and variables to create. OIDC lets GitHub assume a cloud role per run, so no long-lived access keys are stored in the repository.",
    keywords: ["deploy", "aws", "ecs", "fargate", "s3", "cloudfront", "azure", "container apps", "web app", "ghcr", "docker hub", "oidc", "cd"],
    icon: "cloud",
    fields: [
        helpers_1.f.select("target", "Target", (0, helpers_1.opts)(["ghcr", "Publish image to GitHub Container Registry"], ["dockerhub", "Publish image to Docker Hub"], ["aws-ecs", "AWS ECS Fargate"], ["aws-s3-static", "AWS S3 + CloudFront (static site)"], ["azure-container-apps", "Azure Container Apps"], ["azure-webapp", "Azure Web App (code)"])),
        helpers_1.f.text("appName", "App name", { width: "narrow", default: "my-app" }),
        helpers_1.f.text("branch", "Deploy branch", { width: "narrow", default: "main" }),
        helpers_1.f.text("region", "Region", { width: "narrow", default: "us-east-1", showIf: { field: "target", equals: ["aws-ecs", "aws-s3-static"] } }),
        helpers_1.f.num("port", "Container port", 3000, { min: 1, max: 65535, showIf: { field: "target", equals: ["aws-ecs", "azure-container-apps"] } }),
        helpers_1.f.select("cpu", "Fargate CPU", (0, helpers_1.opts)(["256", "0.25 vCPU"], ["512", "0.5 vCPU"], ["1024", "1 vCPU"], ["2048", "2 vCPU"], ["4096", "4 vCPU"]), { default: "512", showIf: { field: "target", equals: ["aws-ecs"] } }),
        helpers_1.f.num("memory", "Fargate memory (MiB)", 1024, { min: 512, step: 512, showIf: { field: "target", equals: ["aws-ecs"] } }),
        helpers_1.f.text("healthPath", "Health path", { width: "narrow", default: "/health", showIf: { field: "target", equals: ["aws-ecs"] } }),
        helpers_1.f.select("stack", "Runtime", (0, helpers_1.opts)(["node", "Node.js"], ["python", "Python"]), { showIf: { field: "target", equals: ["azure-webapp"] } }),
        helpers_1.f.text("version", "Runtime version", { width: "narrow", default: "22", showIf: { field: "target", equals: ["azure-webapp", "aws-s3-static"] } })
    ],
    run(values) {
        const r = (0, devops_ci_1.deployWorkflow)({
            target: (0, types_1.str)(values, "target", "ghcr"), appName: (0, types_1.str)(values, "appName", "my-app"), branch: (0, types_1.str)(values, "branch", "main"), region: (0, types_1.str)(values, "region", "us-east-1"),
            port: (0, types_1.num)(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }), cpu: Number((0, types_1.str)(values, "cpu", "512")), memory: (0, types_1.num)(values, "memory", 1024, { min: 512, integer: true, label: "Memory" }),
            stack: (0, types_1.str)(values, "stack", "node"), version: (0, types_1.str)(values, "version"), healthPath: (0, types_1.str)(values, "healthPath")
        });
        return { outputs: [{ kind: "files", title: "Workflow", files: r.files }, { kind: "text", title: "One-time setup", content: r.setup.map((s, i) => `${i + 1}. ${s}`).join("\n") }] };
    }
};
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const env = {
    id: "devops.env",
    command: "envChecker",
    title: ".env Checker & Generator",
    summary: "Check a .env file for syntax errors, duplicates, placeholders and invalid ports/URLs; compare it with .env.example; find variables your code reads but never declares; and generate .env.example and typed config.",
    guide: "\"Scan workspace\" reads .env, .env.example and your source code (process.env, os.environ, os.Getenv, System.getenv, import.meta.env…). Values never leave your machine, and secret values are blanked in the generated .env.example.",
    keywords: ["env", "dotenv", ".env", "environment variables", "secrets", ".env.example", "zod", "pydantic settings", "config"],
    icon: "key",
    actions: [{ id: "scan", label: "Scan workspace" }],
    fields: [
        helpers_1.f.code("env", ".env", "dotenv", { rows: 10, fromEditor: true, default: "# App\nNODE_ENV=development\nPORT=3000\nDATABASE_URL=postgres://app:secret@localhost:5432/app\nOPENAI_API_KEY=changeme\nLOG_LEVEL=info\nFEATURE_FLAGS=beta search" }),
        helpers_1.f.code("example", ".env.example (optional)", "dotenv", { rows: 5, placeholder: "Compare against the variables the app expects" }),
        helpers_1.f.select("typed", "Also generate", (0, helpers_1.opts)(["none", "Nothing"], ["zod", "TypeScript config (zod)"], ["pydantic", "Python settings (pydantic-settings)"]))
    ],
    async run(values, ctx, action) {
        let envText = (0, types_1.str)(values, "env");
        let exampleText = (0, types_1.str)(values, "example");
        const messages = [];
        const outputs = [];
        let setValues;
        if (action === "scan") {
            const ws = ctx.workspace;
            if (!ws)
                throw new types_1.ToolInputError("Open a workspace folder to scan it.");
            const fileEnv = await ws.readFile(".env");
            const fileExample = (await ws.readFile(".env.example")) ?? (await ws.readFile(".env.sample")) ?? (await ws.readFile(".env.template"));
            if (fileEnv !== undefined)
                envText = fileEnv;
            if (fileExample !== undefined)
                exampleText = fileExample;
            setValues = { env: envText, example: exampleText };
            const usage = await (0, devops_utils_1.scanEnvUsage)(ctx);
            const declared = new Set([...(0, devops_utils_1.checkEnv)(envText).entries.map(e => e.key), ...(0, devops_utils_1.checkEnv)(exampleText).entries.map(e => e.key)]);
            const undeclared = usage.filter(u => !declared.has(u.key));
            messages.push({ kind: "info", text: `Read ${fileEnv !== undefined ? ".env" : "no .env"} and ${fileExample !== undefined ? ".env.example" : "no .env.example"}; ${usage.length} variable(s) are used in code.` });
            if (undeclared.length)
                messages.push({ kind: "warning", text: `${undeclared.length} variable(s) are read by the code but not declared in .env or .env.example: ${undeclared.map(u => u.key).join(", ")}.` });
            outputs.push((0, helpers_1.table)("Variables used in code", ["Variable", "Declared", "Files"], usage.map(u => [u.key, declared.has(u.key) ? "yes" : "no", u.files.slice(0, 3).join(", ") + (u.files.length > 3 ? ` +${u.files.length - 3}` : "")])));
        }
        if (!envText.trim())
            throw new types_1.ToolInputError("Paste a .env file, or scan the workspace.");
        const r = (0, devops_utils_1.checkEnv)(envText, exampleText.trim() ? exampleText : undefined);
        if (r.missing.length)
            messages.push({ kind: "error", text: `Missing from .env (listed in .env.example): ${r.missing.join(", ")}.` });
        if (r.extra.length && exampleText.trim())
            messages.push({ kind: "info", text: `Not in .env.example (document them for teammates): ${r.extra.join(", ")}.` });
        if (r.empty.length)
            messages.push({ kind: "warning", text: `Empty values: ${r.empty.join(", ")}.` });
        const typed = (0, types_1.str)(values, "typed", "none");
        return {
            setValues,
            stats: [{ label: "Variables", value: String(r.entries.length) }, ...((0, helpers_1.counts)(r.issues) ?? [])],
            messages: [...messages, ...(0, helpers_1.severityMessages)(r.issues, "No syntax problems.")],
            outputs: [
                ...outputs,
                (0, helpers_1.code)(".env.example", "dotenv", (0, devops_utils_1.envExample)(envText), ".env.example"),
                ...(typed === "zod" ? [(0, helpers_1.code)("env.ts", "typescript", (0, devops_utils_1.envSchema)(exampleText.trim() || envText, "zod"), "src/env.ts")] : []),
                ...(typed === "pydantic" ? [(0, helpers_1.code)("settings.py", "python", (0, devops_utils_1.envSchema)(exampleText.trim() || envText, "pydantic"), "settings.py")] : [])
            ]
        };
    }
};
const nginx = {
    id: "devops.nginx",
    command: "nginxConfig",
    title: "Nginx Config Generator",
    summary: "Reverse proxy, load balancer, SPA or static site configs with HTTPS redirect, HTTP/2, gzip, security headers, rate limiting and WebSocket support.",
    keywords: ["nginx", "reverse proxy", "load balancer", "spa", "https", "ssl", "letsencrypt", "websocket", "server block"],
    icon: "server",
    live: true,
    fields: [
        helpers_1.f.select("mode", "Serve", (0, helpers_1.opts)(["reverse-proxy", "Reverse proxy to an app"], ["load-balancer", "Load balance several app servers"], ["spa", "Single-page app (React, Vue, Angular)"], ["static", "Static site"])),
        helpers_1.f.text("serverName", "Domain(s)", { default: "example.com www.example.com" }),
        helpers_1.f.area("upstreams", "Upstream servers (host:port)", { rows: 3, default: "127.0.0.1:3000", showIf: { field: "mode", equals: ["reverse-proxy", "load-balancer"] } }),
        helpers_1.f.text("root", "Web root", { width: "narrow", default: "/usr/share/nginx/html", showIf: { field: "mode", equals: ["spa", "static"] } }),
        helpers_1.f.toggle("tls", "HTTPS (Let's Encrypt paths)", true),
        helpers_1.f.toggle("websockets", "WebSockets", false, { showIf: { field: "mode", equals: ["reverse-proxy", "load-balancer"] } }),
        helpers_1.f.toggle("gzip", "gzip", true),
        helpers_1.f.toggle("securityHeaders", "Security headers", true),
        helpers_1.f.num("rateLimit", "Rate limit (req/s per IP, 0 = off)", 0, { min: 0, max: 10000 }),
        helpers_1.f.num("maxBodyMb", "Max upload (MB)", 10, { min: 1, max: 10240 })
    ],
    run(values) {
        const conf = (0, devops_config_1.generateNginx)({ mode: (0, types_1.str)(values, "mode", "reverse-proxy"), serverName: (0, types_1.str)(values, "serverName"), upstreams: (0, types_1.str)(values, "upstreams"), root: (0, types_1.str)(values, "root"), tls: (0, types_1.bool)(values, "tls", true), websockets: (0, types_1.bool)(values, "websockets"), gzip: (0, types_1.bool)(values, "gzip", true), rateLimit: (0, types_1.num)(values, "rateLimit", 0, { min: 0, max: 10000, integer: true, label: "Rate limit" }), maxBodyMb: (0, types_1.num)(values, "maxBodyMb", 10, { min: 1, max: 10240, integer: true, label: "Max upload" }), securityHeaders: (0, types_1.bool)(values, "securityHeaders", true) });
        return {
            messages: [{ kind: "info", text: `Test and reload: sudo nginx -t && sudo systemctl reload nginx${(0, types_1.bool)(values, "tls", true) ? ". Get certificates first: sudo certbot certonly --webroot -w /var/www/certbot -d " + (0, types_1.str)(values, "serverName").trim().split(/\s+/).join(" -d ") : ""}` }],
            outputs: [(0, helpers_1.code)("nginx.conf", "nginx", conf, "nginx/app.conf")]
        };
    }
};
const pm2 = {
    id: "devops.pm2",
    command: "pm2Config",
    title: "PM2 Ecosystem Generator",
    summary: "ecosystem.config.js for Node (cluster mode, zero-downtime reload) and Python/other processes, with memory limits, restarts, cron restarts and an optional deploy section.",
    keywords: ["pm2", "ecosystem.config.js", "process manager", "node", "cluster", "zero downtime", "vps"],
    icon: "activity",
    live: true,
    fields: [
        helpers_1.f.text("name", "App name", { width: "narrow", default: "api" }),
        helpers_1.f.text("script", "Script", { width: "narrow", default: "dist/index.js" }),
        helpers_1.f.select("interpreter", "Runs with", (0, helpers_1.opts)(["node", "Node.js"], ["python3", "Python 3"], ["none", "Binary / shell"])),
        helpers_1.f.text("instances", "Instances", { width: "narrow", default: "max", help: "A number, or max for one per CPU (Node cluster mode)." }),
        helpers_1.f.text("maxMemory", "Restart above memory", { width: "narrow", default: "500M" }),
        helpers_1.f.num("port", "PORT env", 3000, { min: 0, max: 65535 }),
        helpers_1.f.text("args", "Arguments", { width: "narrow" }),
        helpers_1.f.text("cron", "Cron restart", { width: "narrow", placeholder: "0 3 * * *" }),
        helpers_1.f.text("workerScript", "Worker script (optional)", { width: "narrow", placeholder: "dist/worker.js" }),
        helpers_1.f.text("deployHost", "Deploy host (optional)", { width: "narrow", placeholder: "203.0.113.10" }),
        helpers_1.f.text("deployRepo", "Git repo (for deploy)", { width: "narrow", placeholder: "git@github.com:org/app.git" })
    ],
    run(values) {
        const apps = [{ name: (0, types_1.str)(values, "name", "api"), script: (0, types_1.str)(values, "script", "dist/index.js"), args: (0, types_1.str)(values, "args"), interpreter: (0, types_1.str)(values, "interpreter", "node"), instances: (0, types_1.str)(values, "instances", "max"), maxMemory: (0, types_1.str)(values, "maxMemory"), port: (0, types_1.num)(values, "port", 3000, { min: 0, max: 65535, integer: true, label: "Port" }), cron: (0, types_1.str)(values, "cron") }];
        if ((0, types_1.str)(values, "workerScript").trim())
            apps.push({ name: `${apps[0].name}-worker`, script: (0, types_1.str)(values, "workerScript").trim(), args: "", interpreter: apps[0].interpreter, instances: "1", maxMemory: apps[0].maxMemory, port: 0, cron: "" });
        const host = (0, types_1.str)(values, "deployHost").trim();
        return { outputs: [(0, helpers_1.code)("ecosystem.config.js", "javascript", (0, devops_config_1.generatePm2)(apps, host ? { host, user: "deploy", repo: (0, types_1.str)(values, "deployRepo"), path: `/var/www/${apps[0].name}` } : undefined), "ecosystem.config.js")] };
    }
};
const terraform = {
    id: "devops.terraform",
    command: "terraformGenerator",
    title: "Terraform Starter",
    summary: "A clean Terraform module (versions, variables with validation, main, outputs, tfvars, .gitignore) for common resources, with optional remote state and locking.",
    keywords: ["terraform", "iac", "infrastructure as code", "aws", "azure", "s3", "ec2", "ecr", "remote state", "opentofu"],
    icon: "grid",
    fields: [
        helpers_1.f.select("template", "Resource", (0, helpers_1.opts)(["aws-s3", "AWS S3 bucket (private, versioned, encrypted)"], ["aws-ecr", "AWS ECR repository"], ["aws-ec2", "AWS EC2 instance (SSM, no SSH)"], ["azure-webapp", "Azure Linux Web App"], ["docker-local", "Local Docker container"])),
        helpers_1.f.text("name", "Name", { width: "narrow", default: "my-app" }),
        helpers_1.f.select("environment", "Environment", (0, helpers_1.opts)("dev", "staging", "prod")),
        helpers_1.f.text("region", "Region / location", { width: "narrow", default: "us-east-1" }),
        helpers_1.f.toggle("remoteState", "Remote state backend", true, { showIf: { field: "template", equals: ["aws-s3", "aws-ecr", "aws-ec2", "azure-webapp"] } }),
        helpers_1.f.text("stateBucket", "State bucket / account", { width: "narrow", placeholder: "my-app-terraform-state", showIf: { field: "remoteState", equals: [true] } })
    ],
    run(values) {
        const template = (0, types_1.str)(values, "template", "aws-s3");
        const files = (0, devops_config_1.generateTerraform)({ template, name: (0, types_1.str)(values, "name", "my-app"), region: (0, types_1.str)(values, "region").trim() || (template.startsWith("azure") ? "westeurope" : "us-east-1"), environment: (0, types_1.str)(values, "environment", "dev"), remoteState: (0, types_1.bool)(values, "remoteState", true) && template !== "docker-local", stateBucket: (0, types_1.str)(values, "stateBucket") });
        const dir = files[0].path.replace(/\/versions\.tf$/, "");
        return { messages: [{ kind: "info", text: `cd ${dir} && terraform init && terraform fmt && terraform validate && terraform plan -var-file=${(0, types_1.str)(values, "environment", "dev")}.tfvars` }], outputs: [{ kind: "files", title: "Module", files }] };
    }
};
// ---------------------------------------------------------------------------
// Troubleshoot
// ---------------------------------------------------------------------------
const network = {
    id: "devops.network",
    command: "networkTools",
    title: "Port & Network Toolkit",
    summary: "Check which local ports are free, look up what a port is usually used for, and calculate CIDR ranges, subnets and overlaps.",
    keywords: ["port", "port in use", "EADDRINUSE", "cidr", "subnet", "ip range", "vpc", "localhost"],
    icon: "network",
    fields: [
        helpers_1.f.select("mode", "Tool", (0, helpers_1.opts)(["ports", "Are these ports free?"], ["cidr", "CIDR / subnet calculator"], ["reference", "Common ports reference"])),
        helpers_1.f.text("ports", "Ports", { default: "3000, 5432, 6379, 8000-8003", showIf: { field: "mode", equals: ["ports"] } }),
        helpers_1.f.text("cidr", "CIDR", { default: "10.0.0.0/16", showIf: { field: "mode", equals: ["cidr"] } }),
        helpers_1.f.num("subnetPrefix", "Split into /", 20, { min: 0, max: 32, showIf: { field: "mode", equals: ["cidr"] } }),
        helpers_1.f.text("check", "Contains IP or overlaps CIDR", { width: "narrow", placeholder: "10.0.3.7 or 10.0.128.0/17", showIf: { field: "mode", equals: ["cidr"] } })
    ],
    async run(values, ctx) {
        const mode = (0, types_1.str)(values, "mode", "ports");
        if (mode === "reference")
            return { outputs: [(0, helpers_1.table)("Common ports", ["Port", "Usually"], Object.entries(devops_utils_1.WELL_KNOWN_PORTS).map(([p, n]) => [Number(p), n]))] };
        if (mode === "cidr") {
            const cidr = (0, types_1.str)(values, "cidr");
            const info = (0, devops_utils_1.cidrInfo)(cidr);
            const prefix = (0, types_1.num)(values, "subnetPrefix", 20, { min: 0, max: 32, integer: true, label: "Prefix" });
            const outputs = [(0, helpers_1.table)("Range", ["Field", "Value"], [["Network", info.cidr], ["Netmask", info.netmask], ["Wildcard", info.wildcard], ["First host", info.firstHost], ["Last host", info.lastHost], ["Broadcast", info.broadcast], ["Addresses", info.totalAddresses.toLocaleString("en-US")], ["Usable hosts", info.usableHosts.toLocaleString("en-US")], ["Private (RFC 1918 / CGNAT)", info.private ? "yes" : "no"]])];
            const messages = [];
            if (prefix >= Number(info.cidr.split("/")[1])) {
                const subnets = (0, devops_utils_1.splitCidr)(cidr, prefix, 256);
                outputs.push((0, helpers_1.code)(`Subnets /${prefix} (${subnets.length}${2 ** (prefix - Number(info.cidr.split("/")[1])) > 256 ? " of " + (2 ** (prefix - Number(info.cidr.split("/")[1]))).toLocaleString("en-US") : ""})`, "text", subnets.join("\n")));
            }
            const check = (0, types_1.str)(values, "check").trim();
            if (check) {
                const inside = check.includes("/") ? (0, devops_utils_1.cidrOverlap)(cidr, check) : (0, devops_utils_1.cidrContains)(cidr, check);
                messages.push({ kind: inside ? "warning" : "success", text: check.includes("/") ? `${check} ${inside ? "overlaps" : "does not overlap"} ${info.cidr}.` : `${check} is ${inside ? "inside" : "outside"} ${info.cidr}.` });
            }
            return { messages, outputs };
        }
        const ports = (0, devops_utils_1.parsePorts)((0, types_1.str)(values, "ports"));
        if (!ctx.network)
            throw new types_1.ToolInputError("Port checks are not available here.");
        const rows = await Promise.all(ports.map(async (p) => {
            const free = await ctx.network.isPortFree(p);
            return [p, free ? "free" : "IN USE", devops_utils_1.WELL_KNOWN_PORTS[p] ?? ""];
        }));
        const busy = rows.filter(r => r[1] !== "free");
        return {
            stats: [{ label: "Checked", value: String(rows.length) }, { label: "In use", value: String(busy.length), tone: busy.length ? "warn" : "good" }],
            messages: busy.length ? [{ kind: "info", text: `Find the process: macOS/Linux "lsof -nP -iTCP:${busy[0][0]} -sTCP:LISTEN", Windows "netstat -ano | findstr :${busy[0][0]}".` }] : [],
            outputs: [(0, helpers_1.table)("Ports on this machine", ["Port", "Status", "Usually"], rows)]
        };
    }
};
const logs = {
    id: "devops.logs",
    command: "observabilityAnalyze",
    title: "Log Analyzer & Formatter",
    summary: "Make sense of application, JSON (pino, winston, bunyan, structlog) or access logs: level counts, time range, top error patterns, status codes, slow requests - or pretty-print and filter them.",
    guide: "Open a log file and use the editor contents, or paste lines. Similar error messages are grouped by replacing ids, numbers and quoted values, so the top patterns show what actually breaks.",
    keywords: ["logs", "log file", "errors", "stack trace", "json logs", "nginx access log", "pretty print", "observability", "pino"],
    icon: "activity",
    live: true,
    fields: [
        helpers_1.f.select("mode", "Mode", (0, helpers_1.opts)(["analyze", "Analyze"], ["format", "Pretty-print & filter"])),
        helpers_1.f.code("log", "Log lines", "log", { rows: 14, required: true, fromEditor: true, default: '{"level":30,"time":1759140000000,"msg":"request completed","responseTime":42,"req":{"method":"GET","url":"/api/orders"}}\n{"level":50,"time":1759140003000,"msg":"db timeout after 5000ms","requestId":"r-81"}\n{"level":50,"time":1759140007000,"msg":"db timeout after 5000ms","requestId":"r-82"}\n2025-09-29T10:00:09Z WARN cache miss ratio 0.62\n127.0.0.1 - - [29/Sep/2025:10:00:12 +0000] "GET /api/users HTTP/1.1" 502 157 "-" "curl/8.5"\n2025-09-29 10:00:15,221 ERROR [worker-3] Unhandled exception\n    at OrderService.save (order.ts:88)\n    at processTicksAndRejections (node:internal/process)' }),
        helpers_1.f.select("minLevel", "Minimum level", (0, helpers_1.opts)(["all", "All"], ["debug", "Debug"], ["info", "Info"], ["warn", "Warning"], ["error", "Error"]), { showIf: { field: "mode", equals: ["format"] } }),
        helpers_1.f.text("search", "Contains", { width: "narrow", showIf: { field: "mode", equals: ["format"] } }),
        helpers_1.f.toggle("showFields", "Show extra fields", true, { showIf: { field: "mode", equals: ["format"] } })
    ],
    run(values) {
        const text = (0, types_1.str)(values, "log");
        if (!text.trim())
            throw new types_1.ToolInputError("Paste log lines, or open a log file and use the editor.");
        if ((0, types_1.str)(values, "mode", "analyze") === "format") {
            const r = (0, devops_utils_1.formatLogs)(text, { minLevel: (0, types_1.str)(values, "minLevel", "all"), search: (0, types_1.str)(values, "search"), showFields: (0, types_1.bool)(values, "showFields", true) });
            return { stats: [{ label: "Shown", value: `${r.shown} of ${r.total}` }], outputs: [(0, helpers_1.code)("Logs", "log", r.text || "(no matching lines)")] };
        }
        const a = (0, devops_utils_1.analyzeLogs)(text);
        const errors = a.levels.error + a.levels.fatal;
        return {
            stats: [
                { label: "Lines", value: String(a.total) },
                { label: "Errors", value: String(errors), tone: errors ? "bad" : "good" },
                { label: "Warnings", value: String(a.levels.warn), tone: a.levels.warn ? "warn" : "good" },
                ...(a.first ? [{ label: "Time range", value: a.first === a.last ? a.first : `${a.first} → ${a.last}` }] : []),
                ...Object.entries(a.statuses).map(([k, v]) => ({ label: `HTTP ${k}`, value: String(v), tone: (k.startsWith("5") ? "bad" : k.startsWith("4") ? "warn" : "neutral") }))
            ],
            messages: a.recommendations.map(t => ({ kind: "info", text: t })),
            outputs: [
                ...(a.topErrors.length ? [(0, helpers_1.table)("Top error patterns", ["Count", "First line", "Example"], a.topErrors.map(e => [e.count, e.firstLine, e.example]))] : []),
                (0, helpers_1.table)("Levels", ["Level", "Lines"], Object.entries(a.levels).filter(([, n]) => n).map(([l, n]) => [l, n])),
                ...(a.slowest.length ? [(0, helpers_1.table)("Slowest", ["Line", "ms", "Message"], a.slowest.map(s => [s.line, s.ms, s.message]))] : [])
            ]
        };
    }
};
const health = {
    id: "devops.health",
    command: "healthCheckGenerator",
    title: "Health Check Generator",
    summary: "Liveness and readiness endpoints for Express, Fastify, FastAPI, Flask, Spring Boot or Go - with dependency checks and timeouts - plus matching Docker, Compose and Kubernetes probes.",
    guide: "Liveness says the process is alive and must not check dependencies, or one slow database restarts every pod. Readiness checks dependencies and takes the instance out of the load balancer while they are down.",
    keywords: ["health check", "healthz", "readiness", "liveness", "probe", "express", "fastapi", "spring actuator"],
    icon: "heart",
    live: true,
    fields: [
        helpers_1.f.select("framework", "Framework", (0, helpers_1.opts)(["express", "Express"], ["fastify", "Fastify"], ["fastapi", "FastAPI"], ["flask", "Flask"], ["spring", "Spring Boot"], ["go", "Go (net/http)"])),
        helpers_1.f.num("port", "Port", 3000, { min: 1, max: 65535 }),
        helpers_1.f.toggle("database", "Check database", true),
        helpers_1.f.toggle("redis", "Check Redis", false),
        helpers_1.f.toggle("http", "Check an upstream HTTP service", false),
        helpers_1.f.num("timeoutMs", "Check timeout (ms)", 2000, { min: 100, max: 30000 })
    ],
    run(values) {
        const checks = ["database", "redis", "http"].filter(c => (0, types_1.bool)(values, c, c === "database"));
        const r = (0, devops_config_1.generateHealth)({ framework: (0, types_1.str)(values, "framework", "express"), port: (0, types_1.num)(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }), checks, timeoutMs: (0, types_1.num)(values, "timeoutMs", 2000, { min: 100, max: 30000, integer: true, label: "Timeout" }) });
        return { outputs: [(0, helpers_1.code)(r.code.path, r.code.language ?? "text", r.code.content, r.code.path), (0, helpers_1.code)("Dockerfile HEALTHCHECK", "dockerfile", r.probes.dockerfile), (0, helpers_1.code)("Docker Compose", "yaml", r.probes.compose), (0, helpers_1.code)("Kubernetes probes", "yaml", r.probes.kubernetes)] };
    }
};
// ---------------------------------------------------------------------------
// Observability & MLOps
// ---------------------------------------------------------------------------
const observability = {
    id: "devops.observability",
    command: "observabilityStarter",
    title: "Observability Starter",
    summary: "OpenTelemetry tracing, structured JSON logging with trace ids and redaction, a log schema, and a local Jaeger to see traces - for Node.js or Python.",
    keywords: ["opentelemetry", "otel", "tracing", "structured logging", "pino", "jaeger", "observability"],
    icon: "eye",
    fields: [helpers_1.f.select("stack", "Stack", (0, helpers_1.opts)(["node", "Node.js / TypeScript"], ["python", "Python (FastAPI)"])), helpers_1.f.text("service", "Service name", { width: "narrow", default: "orders-api" })],
    run(values) {
        const files = (0, devops_mlops_1.observabilityFiles)((0, types_1.str)(values, "stack", "node"), (0, types_1.str)(values, "service", "orders-api"));
        return { messages: [{ kind: "info", text: "docker compose -f observability/otel-compose.yaml up -d, run the app with observability/otel.env, then open http://localhost:16686." }], outputs: [{ kind: "files", title: "Files", files }] };
    }
};
const serving = {
    id: "devops.serving",
    command: "mlopsGenerator",
    title: "Model Serving Starter",
    summary: "Serve an ML model behind FastAPI with health/readiness, a versioned predict schema and structured logs - Dockerfile (CPU or CUDA), Kubernetes with GPU scheduling, CI with a smoke test.",
    keywords: ["mlops", "model serving", "inference api", "fastapi", "gpu", "cuda", "kubernetes gpu"],
    icon: "cpu",
    fields: [
        helpers_1.f.text("name", "Model / service name", { width: "narrow", default: "churn-model" }),
        helpers_1.f.num("port", "Port", 8000, { min: 1, max: 65535 }),
        helpers_1.f.toggle("gpu", "GPU (CUDA)", false),
        helpers_1.f.text("cudaVersion", "CUDA version", { width: "narrow", default: "12.4.1", showIf: { field: "gpu", equals: [true] } }),
        helpers_1.f.text("pythonVersion", "Python", { width: "narrow", default: "3.12", showIf: { field: "gpu", equals: [false] } }),
        helpers_1.f.text("image", "Image", { width: "narrow", placeholder: "registry/churn-model:0.1.0" }),
        helpers_1.f.num("memoryGi", "Memory request (GiB)", 4, { min: 1, max: 512 })
    ],
    run(values) {
        const files = (0, devops_mlops_1.modelServingFiles)({ name: (0, types_1.str)(values, "name", "churn-model"), port: (0, types_1.num)(values, "port", 8000, { min: 1, max: 65535, integer: true, label: "Port" }), gpu: (0, types_1.bool)(values, "gpu"), cudaVersion: (0, types_1.str)(values, "cudaVersion"), pythonVersion: (0, types_1.str)(values, "pythonVersion"), image: (0, types_1.str)(values, "image"), memoryGi: (0, types_1.num)(values, "memoryGi", 4, { min: 1, max: 512, integer: true, label: "Memory" }) });
        return { outputs: [{ kind: "files", title: "Files", files }] };
    }
};
const dockerRun = {
    id: "devops.docker-run",
    command: "dockerRunToCompose",
    title: "docker run → Compose",
    summary: "Convert one or more docker run commands (from READMEs and docs) into a compose.yaml: ports, env, volumes, networks, restart policy, health checks, resources, GPUs and more.",
    keywords: ["docker run", "docker compose", "composerize", "compose.yaml", "convert docker run", "docker-compose.yml"],
    icon: "container",
    live: true,
    fields: [helpers_1.f.code("commands", "docker run commands", "shell", { rows: 10, required: true, fromEditor: true, default: "docker run -d --name db -p 5432:5432 \\\n  -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=app \\\n  -v pgdata:/var/lib/postgresql/data \\\n  --restart unless-stopped \\\n  --health-cmd \"pg_isready -U postgres\" --health-interval 10s \\\n  postgres:16-alpine\n\ndocker run -d --name cache -p 6379:6379 redis:7-alpine redis-server --appendonly yes" })],
    run(values) {
        const r = (0, devops_docker_1.dockerRunToCompose)((0, types_1.str)(values, "commands"));
        return {
            stats: [{ label: "Services", value: String(r.services.length) }],
            messages: [...r.notes.map(t => ({ kind: "warning", text: t })), { kind: "info", text: "Start it with docker compose up -d; services reach each other by service name (e.g. postgres://db:5432)." }],
            outputs: [(0, helpers_1.code)("compose.yaml", "yaml", r.yaml, "compose.yaml")]
        };
    }
};
exports.DEVOPS_TOOLS = [
    dockerfile, dockerRun, compose, k8s,
    ci, deploy,
    env, nginx, pm2, terraform,
    network, logs, health,
    observability, serving
];
//# sourceMappingURL=devops.js.map