import { GeneratedFile, ToolInputError } from "../types";

/**
 * Server and infrastructure configuration: nginx, PM2, Terraform and
 * health-check endpoints.
 */

// ---------------------------------------------------------------------------
// nginx
// ---------------------------------------------------------------------------

export interface NginxOptions {
  mode: "reverse-proxy" | "spa" | "static" | "load-balancer";
  serverName: string;
  /** host:port, one per line for load-balancer. */
  upstreams: string;
  root: string;
  tls: boolean;
  websockets: boolean;
  gzip: boolean;
  rateLimit: number;
  maxBodyMb: number;
  securityHeaders: boolean;
}

export function generateNginx(o: NginxOptions): string {
  const server = o.serverName.trim() || "_";
  if (!/^[\w.*\s-]+$/.test(server)) throw new ToolInputError("Server name may only contain host names separated by spaces.");
  const upstreams = o.upstreams.split(/[\s,]+/).map(u => u.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")).filter(Boolean);
  const proxied = o.mode === "reverse-proxy" || o.mode === "load-balancer";
  if (proxied && !upstreams.length) throw new ToolInputError("Add at least one upstream (host:port).");
  for (const u of upstreams) if (!/^[\w.-]+(:\d{1,5})?$/.test(u)) throw new ToolInputError(`Upstream "${u}" must look like host:port.`);
  const root = o.root.trim() || "/usr/share/nginx/html";
  const top: string[] = [];
  if (o.rateLimit > 0) top.push(`limit_req_zone $binary_remote_addr zone=perip:10m rate=${o.rateLimit}r/s;`);
  if (proxied) {
    top.push(`upstream app_backend {\n${o.mode === "load-balancer" ? "    least_conn;\n" : ""}${upstreams.map(u => `    server ${u}${o.mode === "load-balancer" ? " max_fails=3 fail_timeout=10s" : ""};`).join("\n")}\n    keepalive 32;\n}`);
  }
  if (o.websockets && proxied) top.push("map $http_upgrade $connection_upgrade {\n    default upgrade;\n    ''      close;\n}");
  const headers = o.securityHeaders ? [
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "SAMEORIGIN" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    ...(o.tls ? ['add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'] : [])
  ] : [];
  const gzip = o.gzip ? [
    "gzip on;",
    "gzip_vary on;",
    "gzip_min_length 1024;",
    "gzip_proxied any;",
    "gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;"
  ] : [];
  const body: string[] = [
    `server_name ${server};`,
    "server_tokens off;",
    `client_max_body_size ${o.maxBodyMb}m;`,
    ...gzip,
    ...headers
  ];
  if (o.tls) {
    body.unshift(
      "listen 443 ssl;",
      "listen [::]:443 ssl;",
      "http2 on;",
      `ssl_certificate /etc/letsencrypt/live/${server.split(/\s+/)[0]}/fullchain.pem;`,
      `ssl_certificate_key /etc/letsencrypt/live/${server.split(/\s+/)[0]}/privkey.pem;`,
      "ssl_protocols TLSv1.2 TLSv1.3;",
      "ssl_session_cache shared:SSL:10m;",
      "ssl_session_timeout 1d;"
    );
  } else {
    body.unshift("listen 80;", "listen [::]:80;");
  }
  const limit = o.rateLimit > 0 ? `\n        limit_req zone=perip burst=${Math.max(o.rateLimit * 2, 10)} nodelay;\n        limit_req_status 429;` : "";
  const locations: string[] = [];
  if (proxied) {
    locations.push(`location / {${limit}
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
${o.websockets ? "        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $connection_upgrade;\n        proxy_read_timeout 3600s;" : "        proxy_set_header Connection \"\";\n        proxy_read_timeout 60s;"}
        proxy_connect_timeout 5s;
    }`);
  } else {
    body.push(`root ${root};`, "index index.html;");
    locations.push(`location ~* \\.(?:js|css|woff2?|png|jpe?g|gif|svg|ico|webp|avif)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
        try_files $uri =404;
    }`);
    locations.push(`location / {${limit}
        ${o.mode === "spa" ? "try_files $uri $uri/ /index.html;" : "try_files $uri $uri/ =404;"}
        add_header Cache-Control "no-cache";${o.securityHeaders ? "\n        # add_header in a location replaces the server-level headers, so repeat them.\n        " + headers.join("\n        ") : ""}
    }`);
  }
  locations.push("location ~ /\\.(?!well-known) {\n        deny all;\n    }");
  const main = `server {\n${body.map(l => `    ${l}`).join("\n")}\n\n    ${locations.join("\n\n    ")}\n}`;
  const redirect = o.tls ? `server {\n    listen 80;\n    listen [::]:80;\n    server_name ${server};\n\n    location /.well-known/acme-challenge/ {\n        root /var/www/certbot;\n    }\n\n    location / {\n        return 301 https://$host$request_uri;\n    }\n}\n\n` : "";
  return `${top.length ? top.join("\n\n") + "\n\n" : ""}${redirect}${main}\n`;
}

// ---------------------------------------------------------------------------
// PM2
// ---------------------------------------------------------------------------

export interface Pm2App {
  name: string;
  script: string;
  args: string;
  interpreter: "node" | "python3" | "none";
  instances: string;
  maxMemory: string;
  port: number;
  cron: string;
}

export function generatePm2(apps: Pm2App[], deploy: { host: string; user: string; repo: string; path: string } | undefined): string {
  if (!apps.length) throw new ToolInputError("Add at least one app.");
  const out = apps.map(a => {
    if (!a.name.trim() || !a.script.trim()) throw new ToolInputError("Each app needs a name and a script.");
    const instances = a.instances.trim() || "1";
    if (!/^(max|-?\d+)$/.test(instances)) throw new ToolInputError(`Instances for ${a.name} must be a number or "max".`);
    const cluster = a.interpreter === "node" && instances !== "1";
    const fields: string[] = [
      `name: ${JSON.stringify(a.name.trim())}`,
      `script: ${JSON.stringify(a.script.trim())}`,
      ...(a.args.trim() ? [`args: ${JSON.stringify(a.args.trim())}`] : []),
      ...(a.interpreter === "python3" ? ['interpreter: "python3"'] : a.interpreter === "none" ? ['interpreter: "none"'] : []),
      `instances: ${instances === "max" ? '"max"' : Number(instances)}`,
      `exec_mode: "${cluster ? "cluster" : "fork"}"`,
      ...(a.maxMemory.trim() ? [`max_memory_restart: ${JSON.stringify(a.maxMemory.trim())}`] : []),
      ...(a.cron.trim() ? [`cron_restart: ${JSON.stringify(a.cron.trim())}`, "autorestart: false"] : ["autorestart: true"]),
      "watch: false",
      "time: true",
      "merge_logs: true",
      "kill_timeout: 5000",
      ...(cluster ? ["wait_ready: true", "listen_timeout: 10000"] : []),
      "exp_backoff_restart_delay: 200",
      `env: {\n        NODE_ENV: "development"${a.port ? `,\n        PORT: ${a.port}` : ""}\n      }`,
      `env_production: {\n        NODE_ENV: "production"${a.port ? `,\n        PORT: ${a.port}` : ""}\n      }`
    ];
    return `    {\n      ${fields.join(",\n      ")}\n    }`;
  });
  const deployBlock = deploy && deploy.host.trim() ? `,
  deploy: {
    production: {
      user: ${JSON.stringify(deploy.user.trim() || "deploy")},
      host: [${JSON.stringify(deploy.host.trim())}],
      ref: "origin/main",
      repo: ${JSON.stringify(deploy.repo.trim() || "git@github.com:your-org/your-app.git")},
      path: ${JSON.stringify(deploy.path.trim() || "/var/www/app")},
      "post-deploy": "npm ci --omit=dev && pm2 reload ecosystem.config.js --env production"
    }
  }` : "";
  return `// Start:   pm2 start ecosystem.config.js --env production
// Reload:  pm2 reload ecosystem.config.js --env production   (zero downtime in cluster mode)
// Boot:    pm2 startup && pm2 save
module.exports = {
  apps: [
${out.join(",\n")}
  ]${deployBlock}
};
`;
}

// ---------------------------------------------------------------------------
// Terraform
// ---------------------------------------------------------------------------

export type TerraformTemplate = "aws-s3" | "aws-ec2" | "aws-ecr" | "azure-webapp" | "docker-local";

export interface TerraformOptions {
  template: TerraformTemplate;
  name: string;
  region: string;
  environment: string;
  remoteState: boolean;
  stateBucket: string;
}

export function generateTerraform(o: TerraformOptions): GeneratedFile[] {
  const name = o.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "app";
  const env = o.environment.trim() || "dev";
  const aws = o.template.startsWith("aws");
  const azure = o.template.startsWith("azure");
  const providers = aws
    ? `    aws = {\n      source  = "hashicorp/aws"\n      version = "~> 5.0"\n    }`
    : azure
      ? `    azurerm = {\n      source  = "hashicorp/azurerm"\n      version = "~> 4.0"\n    }`
      : `    docker = {\n      source  = "kreuzwerker/docker"\n      version = "~> 3.0"\n    }`;
  const backend = o.remoteState
    ? aws
      ? `\n\n  backend "s3" {\n    bucket       = "${o.stateBucket.trim() || `${name}-terraform-state`}"\n    key          = "${name}/${env}/terraform.tfstate"\n    region       = "${o.region}"\n    encrypt      = true\n    use_lockfile = true\n  }`
      : azure
        ? `\n\n  backend "azurerm" {\n    resource_group_name  = "tfstate"\n    storage_account_name = "${(o.stateBucket.trim() || `${name}tfstate`).replace(/[^a-z0-9]/g, "").slice(0, 24)}"\n    container_name       = "tfstate"\n    key                  = "${name}/${env}.tfstate"\n  }`
        : ""
    : "";
  const versions = `terraform {\n  required_version = ">= 1.10.0"\n\n  required_providers {\n${providers}\n  }${backend}\n}\n\n${aws
    ? `provider "aws" {\n  region = var.region\n\n  default_tags {\n    tags = {\n      Project     = var.name\n      Environment = var.environment\n      ManagedBy   = "terraform"\n    }\n  }\n}\n`
    : azure ? `provider "azurerm" {\n  features {}\n}\n` : `provider "docker" {}\n`}`;
  const baseVars = `variable "name" {\n  description = "Name prefix for every resource."\n  type        = string\n  default     = "${name}"\n}\n\nvariable "environment" {\n  description = "Deployment environment (dev, staging, prod)."\n  type        = string\n  default     = "${env}"\n\n  validation {\n    condition     = contains(["dev", "staging", "prod"], var.environment)\n    error_message = "environment must be dev, staging or prod."\n  }\n}\n`;
  const regionVar = aws || azure ? `\nvariable "region" {\n  description = "${aws ? "AWS region" : "Azure location"}."\n  type        = string\n  default     = "${o.region}"\n}\n` : "";
  let main = "";
  let vars = "";
  let outputs = "";
  switch (o.template) {
    case "aws-s3":
      main = `resource "aws_s3_bucket" "this" {
  bucket = "\${var.name}-\${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }
  }
}
`;
      vars = `\nvariable "noncurrent_version_days" {\n  description = "Days to keep old object versions."\n  type        = number\n  default     = 30\n}\n`;
      outputs = `output "bucket_name" {\n  value = aws_s3_bucket.this.bucket\n}\n\noutput "bucket_arn" {\n  value = aws_s3_bucket.this.arn\n}\n`;
      break;
    case "aws-ecr":
      main = `resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last \${var.keep_images} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.keep_images
      }
      action = { type = "expire" }
    }]
  })
}
`;
      vars = `\nvariable "keep_images" {\n  description = "How many images to keep."\n  type        = number\n  default     = 30\n}\n`;
      outputs = `output "repository_url" {\n  value = aws_ecr_repository.this.repository_url\n}\n`;
      break;
    case "aws-ec2":
      main = `data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

data "aws_vpc" "default" {
  default = true
}

resource "aws_security_group" "this" {
  name        = "\${var.name}-\${var.environment}"
  description = "HTTP(S) in, all out. No SSH: use SSM Session Manager."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "ssm" {
  name = "\${var.name}-\${var.environment}-ssm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "this" {
  name = "\${var.name}-\${var.environment}"
  role = aws_iam_role.ssm.name
}

resource "aws_instance" "this" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.this.id]
  iam_instance_profile   = aws_iam_instance_profile.this.name

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "\${var.name}-\${var.environment}"
  }
}
`;
      vars = `\nvariable "instance_type" {\n  description = "EC2 instance type."\n  type        = string\n  default     = "t3.small"\n}\n`;
      outputs = `output "instance_id" {\n  value = aws_instance.this.id\n}\n\noutput "public_ip" {\n  value = aws_instance.this.public_ip\n}\n`;
      break;
    case "azure-webapp":
      main = `resource "azurerm_resource_group" "this" {
  name     = "rg-\${var.name}-\${var.environment}"
  location = var.region
}

resource "azurerm_service_plan" "this" {
  name                = "plan-\${var.name}-\${var.environment}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  os_type             = "Linux"
  sku_name            = var.sku
}

resource "azurerm_linux_web_app" "this" {
  name                = "app-\${var.name}-\${var.environment}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_service_plan.this.location
  service_plan_id     = azurerm_service_plan.this.id
  https_only          = true

  site_config {
    always_on           = var.sku != "F1"
    minimum_tls_version = "1.2"
    health_check_path   = "/health"
    health_check_eviction_time_in_min = 5

    application_stack {
      node_version = "22-lts"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  app_settings = {
    NODE_ENV = "production"
  }
}
`;
      vars = `\nvariable "sku" {\n  description = "App Service plan SKU (F1, B1, P0v3, ...)."\n  type        = string\n  default     = "B1"\n}\n`;
      outputs = `output "url" {\n  value = "https://\${azurerm_linux_web_app.this.default_hostname}"\n}\n`;
      break;
    case "docker-local":
      main = `resource "docker_image" "app" {
  name         = var.image
  keep_locally = true
}

resource "docker_container" "app" {
  name    = "\${var.name}-\${var.environment}"
  image   = docker_image.app.image_id
  restart = "unless-stopped"

  ports {
    internal = var.port
    external = var.port
  }

  env = ["PORT=\${var.port}"]
}
`;
      vars = `\nvariable "image" {\n  description = "Container image with a pinned tag."\n  type        = string\n  default     = "nginx:1.27-alpine"\n}\n\nvariable "port" {\n  type    = number\n  default = 8080\n}\n`;
      outputs = `output "container_id" {\n  value = docker_container.app.id\n}\n`;
      break;
  }
  const dir = `terraform/${name}`;
  return [
    { path: `${dir}/versions.tf`, language: "terraform", content: versions },
    { path: `${dir}/variables.tf`, language: "terraform", content: baseVars + regionVar + vars },
    { path: `${dir}/main.tf`, language: "terraform", content: main },
    { path: `${dir}/outputs.tf`, language: "terraform", content: outputs },
    { path: `${dir}/${env}.tfvars`, language: "terraform", content: `environment = "${env}"\n` },
    { path: `${dir}/.gitignore`, language: "ignore", content: ".terraform/\n*.tfstate\n*.tfstate.*\ncrash.log\n*.tfplan\n" }
  ];
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

export type HealthFramework = "express" | "fastify" | "fastapi" | "flask" | "spring" | "go";

export interface HealthOptions {
  framework: HealthFramework;
  port: number;
  checks: Array<"database" | "redis" | "http">;
  timeoutMs: number;
}

export function generateHealth(o: HealthOptions): { code: GeneratedFile; probes: { dockerfile: string; compose: string; kubernetes: string } } {
  const t = o.timeoutMs;
  const has = (c: HealthOptions["checks"][number]) => o.checks.includes(c);
  let code: GeneratedFile;
  switch (o.framework) {
    case "express":
    case "fastify": {
      const checks = [
        ...(has("database") ? ["  database: () => db.query(\"SELECT 1\"),               // your pg/mysql pool"] : []),
        ...(has("redis") ? ["  redis: () => redis.ping(),                              // your redis client"] : []),
        ...(has("http") ? ["  upstream: () => fetch(process.env.UPSTREAM_HEALTH_URL!, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }),"] : [])
      ];
      const express = o.framework === "express";
      code = { path: "src/health.ts", language: "typescript", content: `${express ? 'import { Router } from "express";' : 'import type { FastifyInstance } from "fastify";'}

const TIMEOUT_MS = ${t};
const startedAt = Date.now();
let shuttingDown = false;
process.once("SIGTERM", () => { shuttingDown = true; });

/** Dependencies the app cannot serve traffic without. */
const checks: Record<string, () => Promise<unknown>> = {
${checks.join("\n") || "  // database: () => db.query(\"SELECT 1\"),"}
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(\`timed out after \${ms}ms\`)), ms))]);
}

async function readiness() {
  const results = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
    const start = Date.now();
    try {
      await withTimeout(check(), TIMEOUT_MS);
      return [name, { status: "up", latencyMs: Date.now() - start }] as const;
    } catch (error) {
      return [name, { status: "down", latencyMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) }] as const;
    }
  }));
  const ok = !shuttingDown && results.every(([, r]) => r.status === "up");
  return { ok, body: { status: ok ? "ready" : "unavailable", checks: Object.fromEntries(results) } };
}

${express ? `export const health = Router();

/** Liveness: the process is running. Never check dependencies here, or one slow database restarts every pod. */
health.get("/health", (_req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
});

/** Readiness: dependencies are reachable, so this instance may receive traffic. */
health.get("/ready", async (_req, res) => {
  const { ok, body } = await readiness();
  res.status(ok ? 200 : 503).set("Cache-Control", "no-store").json(body);
});

// app.use(health);` : `export async function healthRoutes(app: FastifyInstance) {
  /** Liveness: the process is running. Never check dependencies here. */
  app.get("/health", async () => ({ status: "ok", uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }));

  /** Readiness: dependencies are reachable, so this instance may receive traffic. */
  app.get("/ready", async (_req, reply) => {
    const { ok, body } = await readiness();
    return reply.code(ok ? 200 : 503).header("Cache-Control", "no-store").send(body);
  });
}

// await app.register(healthRoutes);`}
` };
      break;
    }
    case "fastapi":
    case "flask": {
      const fast = o.framework === "fastapi";
      const checks = [
        ...(has("database") ? ['    "database": lambda: engine.connect().execute(text("SELECT 1")),  # your SQLAlchemy engine'] : []),
        ...(has("redis") ? ['    "redis": lambda: redis_client.ping(),  # your redis client'] : []),
        ...(has("http") ? ['    "upstream": lambda: urllib.request.urlopen(os.environ["UPSTREAM_HEALTH_URL"], timeout=TIMEOUT_S),'] : [])
      ];
      code = { path: fast ? "app/health.py" : "health.py", language: "python", content: `${has("http") ? "import os\n" : ""}import time
${has("http") ? "import urllib.request\n" : ""}from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Callable

${fast ? "from fastapi import APIRouter\nfrom fastapi.responses import JSONResponse" : "from flask import Blueprint, jsonify"}

TIMEOUT_S = ${(t / 1000).toFixed(1)}
STARTED_AT = time.time()
_pool = ThreadPoolExecutor(max_workers=4)

# Dependencies the app cannot serve traffic without.
CHECKS: dict[str, Callable[[], object]] = {
${checks.join("\n") || '    # "database": lambda: engine.connect().execute(text("SELECT 1")),'}
}


def _run(name: str, check: Callable[[], object]) -> tuple[str, dict]:
    start = time.perf_counter()
    try:
        _pool.submit(check).result(timeout=TIMEOUT_S)
        return name, {"status": "up", "latencyMs": round((time.perf_counter() - start) * 1000)}
    except FutureTimeout:
        return name, {"status": "down", "error": f"timed out after {TIMEOUT_S}s"}
    except Exception as exc:  # noqa: BLE001 - report any dependency failure
        return name, {"status": "down", "error": str(exc)}


def readiness() -> tuple[bool, dict]:
    results = dict(_run(name, check) for name, check in CHECKS.items())
    ok = all(r["status"] == "up" for r in results.values())
    return ok, {"status": "ready" if ok else "unavailable", "checks": results}


${fast ? `router = APIRouter()


@router.get("/health")
def health() -> dict:
    """Liveness: the process is running. Never check dependencies here."""
    return {"status": "ok", "uptimeSeconds": round(time.time() - STARTED_AT)}


@router.get("/ready")
def ready() -> JSONResponse:
    """Readiness: dependencies are reachable, so this instance may receive traffic."""
    ok, body = readiness()
    return JSONResponse(body, status_code=200 if ok else 503, headers={"Cache-Control": "no-store"})


# app.include_router(router)` : `health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    """Liveness: the process is running. Never check dependencies here."""
    return jsonify(status="ok", uptimeSeconds=round(time.time() - STARTED_AT))


@health_bp.get("/ready")
def ready():
    """Readiness: dependencies are reachable, so this instance may receive traffic."""
    ok, body = readiness()
    return jsonify(body), (200 if ok else 503), {"Cache-Control": "no-store"}


# app.register_blueprint(health_bp)`}
` };
      break;
    }
    case "spring":
      code = { path: "src/main/resources/application.yml", language: "yaml", content: `# Spring Boot Actuator (add spring-boot-starter-actuator).
# Liveness:  /actuator/health/liveness   Readiness: /actuator/health/readiness
management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never
      group:
        readiness:
          include: readinessState${has("database") ? ",db" : ""}${has("redis") ? ",redis" : ""}
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
server:
  port: ${o.port}
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 20s
` };
      break;
    case "go":
      code = { path: "health.go", language: "go", content: `package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync/atomic"
	"time"
)

var shuttingDown atomic.Bool

// checks are the dependencies the app cannot serve traffic without.
var checks = map[string]func(ctx context.Context) error{
${has("database") ? "\t\"database\": func(ctx context.Context) error { return db.PingContext(ctx) }, // your *sql.DB\n" : ""}${has("redis") ? "\t\"redis\": func(ctx context.Context) error { return rdb.Ping(ctx).Err() }, // your redis client\n" : ""}${has("http") ? "\t\"upstream\": func(ctx context.Context) error {\n\t\treq, _ := http.NewRequestWithContext(ctx, http.MethodGet, upstreamHealthURL, nil)\n\t\tres, err := http.DefaultClient.Do(req)\n\t\tif err == nil {\n\t\t\tres.Body.Close()\n\t\t}\n\t\treturn err\n\t},\n" : ""}}

// healthHandler is liveness: the process is running. Never check dependencies here.
func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(\`{"status":"ok"}\`))
}

// readyHandler is readiness: dependencies are reachable, so this instance may receive traffic.
func readyHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), ${t}*time.Millisecond)
	defer cancel()
	results := map[string]string{}
	ok := !shuttingDown.Load()
	for name, check := range checks {
		if err := check(ctx); err != nil {
			results[name] = "down: " + err.Error()
			ok = false
		} else {
			results[name] = "up"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if !ok {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ready": ok, "checks": results})
}

// Register: mux.HandleFunc("GET /health", healthHandler); mux.HandleFunc("GET /ready", readyHandler)
` };
      break;
  }
  const spring = o.framework === "spring";
  const live = spring ? "/actuator/health/liveness" : "/health";
  const ready = spring ? "/actuator/health/readiness" : "/ready";
  const seconds = Math.max(1, Math.ceil(t / 1000) + 1);
  const probes = {
    dockerfile: `# Alpine/Debian slim images need wget or curl installed.
HEALTHCHECK --interval=30s --timeout=${seconds}s --start-period=20s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:${o.port}${ready} || exit 1
`,
    compose: `healthcheck:
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1:${o.port}${ready}"]
  interval: 30s
  timeout: ${seconds}s
  retries: 3
  start_period: 20s
`,
    kubernetes: `# In the container spec
startupProbe:
  httpGet: { path: ${live}, port: ${o.port} }
  periodSeconds: 5
  failureThreshold: 30
livenessProbe:
  httpGet: { path: ${live}, port: ${o.port} }
  periodSeconds: 10
  timeoutSeconds: ${seconds}
  failureThreshold: 3
readinessProbe:
  httpGet: { path: ${ready}, port: ${o.port} }
  periodSeconds: 10
  timeoutSeconds: ${seconds}
  failureThreshold: 3
`
  };
  return { code, probes };
}
