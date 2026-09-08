import * as vscode from "vscode";
import * as path from "path";

type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface SecurityFinding {
  severity: FindingSeverity;
  rule: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
}

const CLOUD_FILE_EXTENSIONS = new Set(["tf", "hcl", "yaml", "yml", "json", "toml", "conf", "ini"]);

const CLOUD_RULES: Array<{ rule: string; severity: FindingSeverity; pattern: RegExp; message: string }> = [
  { rule: "public-network-ingress", severity: "high", pattern: /0\.0\.0\.0\/0|::\/0/, message: "A cloud firewall, security group, or network rule allows traffic from anywhere." },
  { rule: "wildcard-iam-permission", severity: "high", pattern: /(?:actions?|resources?|not_actions?)\s*[:=][\s\S]{0,80}["']?\*["']?/i, message: "A cloud permission contains a wildcard action or resource." },
  { rule: "public-cloud-storage", severity: "high", pattern: /(?:public[_-]?access|acl|access[_-]?control)\s*[:=]\s*["']?(?:public-read|public-read-write|true)/i, message: "Cloud storage appears to allow public access." },
  { rule: "privileged-container", severity: "high", pattern: /(?:privileged|allowPrivilegeEscalation)\s*[:=]\s*(?:true|["']true["'])/i, message: "A container is configured with elevated privileges." },
  { rule: "host-networking", severity: "high", pattern: /hostNetwork\s*:\s*true|network_mode\s*[:=]\s*["']host["']/i, message: "A workload shares the host network namespace." },
  { rule: "cloud-secret-value", severity: "critical", pattern: /(?:access_key|secret_key|client_secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/i, message: "A cloud credential-like value is embedded in configuration." },
  { rule: "unencrypted-storage", severity: "medium", pattern: /(?:encrypted|encryption|server_side_encryption)\s*[:=]\s*(?:false|["']false["'])/i, message: "Storage encryption is explicitly disabled." },
  { rule: "latest-container-tag", severity: "medium", pattern: /image\s*:\s*[^\s"']+:latest\b|image\s*=\s*["'][^"']+:latest["']/i, message: "A deployment uses a mutable :latest image tag." },
  { rule: "missing-tls", severity: "medium", pattern: /(?:tls|ssl|https|enable_https)\s*[:=]\s*(?:false|["']false["'])/i, message: "TLS/HTTPS is explicitly disabled in cloud configuration." }
];

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_GLOB = "**/{node_modules,.git,dist,build,out,coverage,.next,.venv,venv,__pycache__}/**";
const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb", "php", "cs", "rs",
  "json", "yaml", "yml", "toml", "ini", "env", "conf", "config", "xml", "html", "css", "scss",
  "sql", "sh", "bash", "dockerfile", "md", "txt"
]);

const SECRET_RULES: Array<{ rule: string; severity: FindingSeverity; pattern: RegExp; message: string }> = [
  { rule: "private-key", severity: "critical", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i, message: "Private key material appears in source." },
  { rule: "aws-access-key", severity: "critical", pattern: /\bAKIA[0-9A-Z]{16}\b/, message: "AWS access key identifier appears in source." },
  { rule: "github-token", severity: "high", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, message: "GitHub token appears in source." },
  { rule: "generic-secret", severity: "high", pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*(?:"[^"\n]{8,}"|'[^'\n]{8,}'|[^\s#]{8,})/i, message: "A credential-like value is hard-coded." },
  { rule: "database-url", severity: "high", pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s"']+/i, message: "A database connection string appears in source." },
  { rule: "unsafe-eval", severity: "medium", pattern: /\beval\s*\(|new\s+Function\s*\(/, message: "Dynamic code execution can enable code injection." },
  { rule: "shell-injection", severity: "high", pattern: /\b(?:child_process\.)?(?:exec|execSync)\s*\(\s*`[^`]*\$\{|\bos\.system\s*\(\s*[^)]*\+/, message: "Shell command is built from interpolated input." },
  { rule: "insecure-http", severity: "low", pattern: /\bhttp:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i, message: "Non-local traffic uses HTTP instead of HTTPS." }
];

function isTextFile(uri: vscode.Uri): boolean {
  const name = path.basename(uri.fsPath).toLowerCase();
  if (name === "dockerfile" || name.startsWith(".env")) return true;
  const ext = path.extname(name).replace(".", "");
  return TEXT_EXTENSIONS.has(ext);
}

function isCloudConfigFile(uri: vscode.Uri): boolean {
  const name = path.basename(uri.fsPath).toLowerCase();
  if (name === "dockerfile" || name.startsWith(".env")) return true;
  return CLOUD_FILE_EXTENSIONS.has(path.extname(name).replace(".", ""));
}

function redactEvidence(line: string): string {
  return line.replace(/([:=]\s*["']?)([^\s"']{8,})(["']?)/g, "$1••••••$3").slice(0, 180);
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_FILE_BYTES) return undefined;
    const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString("utf8");
    if (sample.includes("\u0000")) return undefined;
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

export async function scanWorkspaceForSecurity(): Promise<SecurityFinding[]> {
  const files = await vscode.workspace.findFiles("**/*", SKIP_GLOB, MAX_FILES);
  const findings: SecurityFinding[] = [];
  for (const uri of files) {
    if (!isTextFile(uri)) continue;
    const text = await readText(uri);
    if (text === undefined) continue;
    const lines = text.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex].trim();
      if (!lineText || lineText.startsWith("//") || lineText.startsWith("#")) continue;
      for (const rule of SECRET_RULES) {
        if (!rule.pattern.test(lineText)) continue;
        findings.push({
          severity: rule.severity,
          rule: rule.rule,
          file: vscode.workspace.asRelativePath(uri),
          line: lineIndex + 1,
          message: rule.message,
          evidence: redactEvidence(lineText)
        });
      }
    }
  }
  return findings;
}

export async function scanLocalCloudConfiguration(): Promise<SecurityFinding[]> {
  const files = await vscode.workspace.findFiles("**/*", SKIP_GLOB, MAX_FILES);
  const findings: SecurityFinding[] = [];
  for (const uri of files) {
    if (!isCloudConfigFile(uri)) continue;
    const text = await readText(uri);
    if (text === undefined) continue;
    const lines = text.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex].trim();
      if (!lineText || lineText.startsWith("#") || lineText.startsWith("//")) continue;
      for (const rule of CLOUD_RULES) {
        if (!rule.pattern.test(lineText)) continue;
        findings.push({
          severity: rule.severity,
          rule: rule.rule,
          file: vscode.workspace.asRelativePath(uri),
          line: lineIndex + 1,
          message: rule.message,
          evidence: redactEvidence(lineText)
        });
      }
    }
  }
  return findings;
}

function reportFindings(findings: SecurityFinding[]): string {
  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] || 0) + 1;
    return acc;
  }, {});
  const header = `DevSnip Pro Security Audit\n${"=".repeat(24)}\nFindings: ${findings.length} | Critical: ${counts.critical || 0} | High: ${counts.high || 0} | Medium: ${counts.medium || 0} | Low: ${counts.low || 0}\n`;
  if (!findings.length) return `${header}\nNo matching security risks were found by the built-in static rules. Run your normal SAST, dependency, and secret-scanning CI checks as well.`;
  return `${header}\n${findings.map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.rule}\n   ${f.file}:${f.line} — ${f.message}\n   ${f.evidence}`).join("\n")}`;
}

function reportCloudFindings(findings: SecurityFinding[]): string {
  const header = reportFindings(findings).replace("DevSnip Pro Security Audit", "DevSnip Pro Local Cloud Configuration Audit");
  return `${header}\n\nScope: local Terraform, Kubernetes, Docker, IAM, and cloud configuration files.\nThis audit does not query or modify a live cloud account.`;
}

function detectStack(root: string): "node" | "python" | "generic" {
  try {
    const fs = require("fs") as typeof import("fs");
    if (fs.existsSync(path.join(root, "package.json"))) return "node";
    if (fs.existsSync(path.join(root, "pyproject.toml")) || fs.existsSync(path.join(root, "requirements.txt"))) return "python";
  } catch { /* workspace may be virtual */ }
  return "generic";
}

function artifact(name: string, stack: "node" | "python" | "generic"): string {
  if (name === "mlops/Dockerfile") return `FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
`;
  if (name === "mlops/Dockerfile.gpu") return `FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
`;
  if (name === "mlops/k8s-gpu-deployment.yml") return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: model-serving
spec:
  replicas: 1
  selector:
    matchLabels: { app: model-serving }
  template:
    metadata:
      labels: { app: model-serving }
    spec:
      containers:
        - name: model-serving
          image: your-registry/model-serving:latest
          ports: [{ containerPort: 8000 }]
          resources:
            requests: { cpu: "500m", memory: "2Gi", nvidia.com/gpu: "1" }
            limits: { cpu: "2", memory: "8Gi", nvidia.com/gpu: "1" }
          env:
            - name: MODEL_VERSION
              valueFrom:
                configMapKeyRef: { name: model-config, key: MODEL_VERSION }
          readinessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 20
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /health, port: 8000 }
            initialDelaySeconds: 60
            periodSeconds: 20
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: model-serving
spec:
  selector: { app: model-serving }
  ports: [{ port: 80, targetPort: 8000 }]
`;
  if (name === "mlops/ml-ci.yml") return `name: ML CI

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: python -m pip install --upgrade pip
      - run: pip install -r requirements.txt
      - run: python -m compileall .
      - run: pytest -q
      - name: Validate model artifact metadata
        run: python scripts/validate_model.py
`;
  if (name === "mlops/model-serving-contract.md") return `# Model Serving Contract

## Required endpoints

- GET /health — process is alive
- GET /ready — model is loaded and ready for traffic
- POST /predict — accepts a versioned request schema

## Required response metadata

- modelName
- modelVersion
- requestId
- latencyMs

## Deployment requirements

- Never download an unpinned model at container startup.
- Store model artifacts outside the image when they are large, with checksum verification.
- Reject incompatible feature schemas before inference.
- Emit model version, request ID, latency, and prediction status in structured logs.
- Keep readiness false until the model has loaded successfully.
`;
  if (name === "k8s/deployment.yml") return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: app
  template:
    metadata:
      labels:
        app: app
    spec:
      containers:
        - name: app
          image: your-registry/app:latest
          ports:
            - containerPort: ${stack === "python" ? "8000" : "3000"}
          envFrom:
            - secretRef:
                name: app-secrets
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
          readinessProbe:
            httpGet: { path: /health, port: ${stack === "python" ? "8000" : "3000"} }
          livenessProbe:
            httpGet: { path: /health, port: ${stack === "python" ? "8000" : "3000"} }
---
apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  selector: { app: app }
  ports:
    - port: 80
      targetPort: ${stack === "python" ? "8000" : "3000"}
`;
  if (name === "k8s/service.yml") return `apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  type: ClusterIP
  selector:
    app: app
  ports:
    - port: 80
      targetPort: ${stack === "python" ? "8000" : "3000"}
`;
  if (name === "terraform/main.tf") return `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    docker = { source = "kreuzwerker/docker", version = "~> 3.0" }
  }
}

provider "docker" {}

variable "image" { type = string, default = "your-registry/app:latest" }

resource "docker_container" "app" {
  name  = "app"
  image = var.image
  env   = ["NODE_ENV=production"]
  ports { internal = ${stack === "python" ? "8000" : "3000"}, external = ${stack === "python" ? "8000" : "3000"} }
  restart = "unless-stopped"
}
`;
  if (name === "secure-ci.yml") return `name: Secure CI

on:
  push:
  pull_request:

permissions:
  contents: read
  security-events: write

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: javascript }
      - uses: github/codeql-action/analyze@v3
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: "\${{ secrets.GITHUB_TOKEN }}" }
`;
  if (name === "observability/otel-node.ts") return `import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

export const telemetry = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

// Start once during application bootstrap and shut down during graceful shutdown.
telemetry.start();
process.once("SIGTERM", async () => { await telemetry.shutdown(); process.exit(0); });
`;
  if (name === "observability/otel-python.py") return `from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor

def configure_observability(app):
    FastAPIInstrumentor.instrument_app(app)
    RequestsInstrumentor().instrument()
    return app
`;
  if (name === "observability/log-schema.json") return `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["timestamp", "level", "service", "message"],
  "properties": {
    "timestamp": { "type": "string", "format": "date-time" },
    "level": { "enum": ["trace", "debug", "info", "warn", "error", "fatal"] },
    "service": { "type": "string", "minLength": 1 },
    "message": { "type": "string" },
    "requestId": { "type": "string" },
    "traceId": { "type": "string" },
    "durationMs": { "type": "number", "minimum": 0 }
  },
  "additionalProperties": true
}
`;
  if (name === "Dockerfile") {
    if (stack === "node") return `FROM node:22-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:22-alpine\nENV NODE_ENV=production\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev && npm cache clean --force\nCOPY --from=build /app/dist ./dist\nUSER node\nEXPOSE 3000\nCMD ["node", "dist/index.js"]\n`;
    if (stack === "python") return `FROM python:3.12-slim\nENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\nWORKDIR /app\nCOPY requirements*.txt ./\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nRUN useradd --create-home appuser\nUSER appuser\nEXPOSE 8000\nCMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]\n`;
    return `FROM alpine:3.20\nWORKDIR /app\nCOPY . .\nRUN adduser -D appuser\nUSER appuser\nCMD ["sh"]\n`;
  }
  if (name === ".dockerignore") return `node_modules\n.venv\nvenv\n.git\n.env\n.env.*\n!.env.example\ndist\nbuild\ncoverage\n*.log\n`;
  if (name === "docker-compose.yml") {
    const port = stack === "python" ? "8000" : "3000";
    return `services:\n  app:\n    build: .\n    ports:\n      - "${port}:${port}"\n    env_file:\n      - .env\n    restart: unless-stopped\n    healthcheck:\n      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${port}/health"]\n      interval: 30s\n      timeout: 5s\n      retries: 3\n`;
  }
  if (stack === "python") return `name: CI\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: "3.12"\n          cache: pip\n      - run: python -m pip install --upgrade pip\n      - run: pip install -r requirements.txt\n      - run: python -m compileall .\n      - run: pytest -q\n`;
  return `name: CI\n\non:\n  push:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci\n      - run: npm run compile --if-present\n      - run: npm test --if-present\n`;
}

async function writeArtifact(relativePath: string, content: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) throw new Error("Open a workspace folder first.");
  const target = vscode.Uri.joinPath(root.uri, relativePath);
  try {
    await vscode.workspace.fs.stat(target);
    const overwrite = await vscode.window.showWarningMessage(`${relativePath} already exists. Overwrite it?`, { modal: true }, "Overwrite");
    if (overwrite !== "Overwrite") return;
  } catch { /* file does not exist */ }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document, { preview: false });
}

function analyzeLogText(text: string): string {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const levels = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };
  let jsonLines = 0;
  let timestamped = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/\b(error|fatal|exception|panic)\b/.test(lower)) levels.error++;
    else if (/\b(warn|warning)\b/.test(lower)) levels.warn++;
    else if (/\b(info|notice)\b/.test(lower)) levels.info++;
    else if (/\b(debug|trace)\b/.test(lower)) levels.debug++;
    else levels.unknown++;
    try { if (line.trim().startsWith("{")) { JSON.parse(line); jsonLines++; } } catch { /* not JSON */ }
    if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(line)) timestamped++;
  }
  const recommendations = [
    levels.unknown ? "Use structured JSON logs with a level, timestamp, service, requestId, and message." : "Log levels are consistently detectable.",
    jsonLines === 0 ? "Emit one JSON object per line to make ingestion reliable." : "JSON log lines detected; validate them in CI.",
    timestamped < lines.length / 2 ? "Use ISO-8601 UTC timestamps on every event." : "Timestamp coverage looks healthy.",
    levels.error ? "Add request and trace IDs to error events and avoid logging secrets or tokens." : "No error-level events were detected in this sample."
  ];
  return `DevSnip Pro Observability Report\n${"=".repeat(31)}\nLines: ${lines.length}\nError: ${levels.error} | Warn: ${levels.warn} | Info: ${levels.info} | Debug: ${levels.debug} | Unknown: ${levels.unknown}\nValid JSON lines: ${jsonLines}\nTimestamped lines: ${timestamped}\n\nRecommendations:\n${recommendations.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}

export function registerPlatformToolsCommands(context: vscode.ExtensionContext): void {
  const security = vscode.commands.registerCommand("sayaib.hue-console.securityAudit", async () => {
    if (!vscode.workspace.workspaceFolders?.length) { vscode.window.showErrorMessage("Open a workspace before running the security audit."); return; }
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DevSnip Pro: Scanning workspace security" }, async () => {
        const findings = await scanWorkspaceForSecurity();
        const channel = vscode.window.createOutputChannel("DevSnip Pro Security");
        channel.clear(); channel.appendLine(reportFindings(findings)); channel.show(true);
        if (findings.some(f => f.severity === "critical" || f.severity === "high")) vscode.window.showWarningMessage(`Security audit found ${findings.length} potential issue(s). Review the Security output.`);
        else vscode.window.showInformationMessage(`Security audit complete: ${findings.length} finding(s).`);
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Security audit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const cloudSecurity = vscode.commands.registerCommand("sayaib.hue-console.cloudSecurityAudit", async () => {
    if (!vscode.workspace.workspaceFolders?.length) { vscode.window.showErrorMessage("Open a workspace before running the cloud security audit."); return; }
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "DevSnip Pro: Auditing local cloud configuration" }, async () => {
        const findings = await scanLocalCloudConfiguration();
        const channel = vscode.window.createOutputChannel("DevSnip Pro Cloud Security");
        channel.clear(); channel.appendLine(reportCloudFindings(findings)); channel.show(true);
        if (findings.some(f => f.severity === "critical" || f.severity === "high")) vscode.window.showWarningMessage(`Cloud configuration audit found ${findings.length} potential issue(s). Review the Cloud Security output.`);
        else vscode.window.showInformationMessage(`Cloud configuration audit complete: ${findings.length} finding(s).`);
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Cloud security audit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const devops = vscode.commands.registerCommand("sayaib.hue-console.devopsGenerator", async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) { vscode.window.showErrorMessage("Open a workspace before generating DevOps files."); return; }
    const choice = await vscode.window.showQuickPick([
      "Dockerfile", ".dockerignore", "docker-compose.yml", ".github/workflows/ci.yml",
      "k8s/deployment.yml", "k8s/service.yml", "terraform/main.tf", ".github/workflows/secure-ci.yml"
    ], { title: "Generate production starter artifact" });
    if (!choice) return;
    try {
      const templateName = choice === ".github/workflows/ci.yml"
        ? "ci.yml"
        : choice === ".github/workflows/secure-ci.yml"
          ? "secure-ci.yml"
          : choice;
      await writeArtifact(choice, artifact(templateName, detectStack(root.uri.fsPath)));
      vscode.window.showInformationMessage(`${choice} generated. Review it before deploying.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Artifact generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const mlops = vscode.commands.registerCommand("sayaib.hue-console.mlopsGenerator", async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) { vscode.window.showErrorMessage("Open a workspace before generating MLOps files."); return; }
    const choice = await vscode.window.showQuickPick([
      "mlops/Dockerfile", "mlops/Dockerfile.gpu", "mlops/k8s-gpu-deployment.yml",
      ".github/workflows/ml-ci.yml", "mlops/model-serving-contract.md"
    ], { title: "Generate AI/ML DevOps artifact" });
    if (!choice) return;
    const templateName = choice === ".github/workflows/ml-ci.yml" ? "mlops/ml-ci.yml" : choice;
    try {
      await writeArtifact(choice, artifact(templateName, "python"));
      vscode.window.showInformationMessage(`${choice} generated. Review model, image, and registry settings before deployment.`);
    } catch (error) {
      vscode.window.showErrorMessage(`MLOps artifact generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const observability = vscode.commands.registerCommand("sayaib.hue-console.observabilityAnalyze", async () => {
    const editor = vscode.window.activeTextEditor;
    let text = editor?.document.getText(editor.selection);
    if (!text) text = editor?.document.getText();
    if (!text) { vscode.window.showErrorMessage("Open a log file or select log text first."); return; }
    const channel = vscode.window.createOutputChannel("DevSnip Pro Observability");
    channel.clear(); channel.appendLine(analyzeLogText(text)); channel.show(true);
  });
  const observabilityStarter = vscode.commands.registerCommand("sayaib.hue-console.observabilityStarter", async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) { vscode.window.showErrorMessage("Open a workspace before generating observability files."); return; }
    const choice = await vscode.window.showQuickPick([
      "observability/log-schema.json", "observability/otel-node.ts", "observability/otel-python.py"
    ], { title: "Generate observability starter" });
    if (!choice) return;
    try {
      await writeArtifact(choice, artifact(choice, detectStack(root.uri.fsPath)));
      vscode.window.showInformationMessage(`${choice} generated. Install the matching OpenTelemetry packages before running it.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Observability starter failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  context.subscriptions.push(security, cloudSecurity, devops, mlops, observability, observabilityStarter);
}
