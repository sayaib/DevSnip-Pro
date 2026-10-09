"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateHelmChart = exports.validateK8s = exports.generateK8s = exports.validateCompose = exports.generateCompose = exports.parseYamlDocuments = void 0;
const yaml_1 = __importDefault(require("yaml"));
const types_1 = require("../types");
function parseYamlDocuments(text) {
    const docs = yaml_1.default.parseAllDocuments(text, { uniqueKeys: true, prettyErrors: true });
    const issues = [];
    for (const doc of docs) {
        for (const error of doc.errors)
            issues.push({ severity: "error", message: error.message.split("\n")[0].replace(/:$/, ""), line: error.linePos?.[0]?.line });
        for (const warning of doc.warnings)
            issues.push({ severity: "warning", message: warning.message.split("\n")[0].replace(/:$/, ""), line: warning.linePos?.[0]?.line });
    }
    return { docs, issues };
}
exports.parseYamlDocuments = parseYamlDocuments;
const SERVICE_DEFS = {
    postgres: { image: "postgres:17-alpine", port: "5432:5432", env: { POSTGRES_USER: "app", POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?set in .env}", POSTGRES_DB: "app" }, volume: "/var/lib/postgresql/data", health: ["CMD-SHELL", "pg_isready -U app"], url: "DATABASE_URL=postgresql://app:${POSTGRES_PASSWORD}@postgres:5432/app" },
    mysql: { image: "mysql:8.4", port: "3306:3306", env: { MYSQL_DATABASE: "app", MYSQL_USER: "app", MYSQL_PASSWORD: "${MYSQL_PASSWORD:?set in .env}", MYSQL_ROOT_PASSWORD: "${MYSQL_ROOT_PASSWORD:?set in .env}" }, volume: "/var/lib/mysql", health: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1"], url: "DATABASE_URL=mysql://app:${MYSQL_PASSWORD}@mysql:3306/app" },
    redis: { image: "redis:7.4-alpine", port: "6379:6379", volume: "/data", health: ["CMD", "redis-cli", "ping"], url: "REDIS_URL=redis://redis:6379" },
    mongo: { image: "mongo:8.0", port: "27017:27017", env: { MONGO_INITDB_ROOT_USERNAME: "app", MONGO_INITDB_ROOT_PASSWORD: "${MONGO_PASSWORD:?set in .env}" }, volume: "/data/db", health: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"], url: "MONGO_URL=mongodb://app:${MONGO_PASSWORD}@mongo:27017" },
    rabbitmq: { image: "rabbitmq:4.0-management-alpine", port: "15672:15672", volume: "/var/lib/rabbitmq", health: ["CMD", "rabbitmq-diagnostics", "-q", "ping"], url: "AMQP_URL=amqp://guest:guest@rabbitmq:5672" },
    nginx: { image: "nginx:1.27-alpine", port: "80:80" },
    minio: { image: "minio/minio:RELEASE.2024-12-18T13-15-44Z", port: "9001:9001", env: { MINIO_ROOT_USER: "minio", MINIO_ROOT_PASSWORD: "${MINIO_ROOT_PASSWORD:?set in .env}" }, volume: "/data", health: ["CMD", "mc", "ready", "local"], url: "S3_ENDPOINT=http://minio:9000" },
    mailpit: { image: "axllent/mailpit:v1.21", port: "8025:8025", url: "SMTP_URL=smtp://mailpit:1025" }
};
function generateCompose(o) {
    const doc = { services: {} };
    const app = {};
    if (o.build)
        app.build = { context: "." };
    else
        app.image = o.image || "ghcr.io/your-org/your-app:1.0.0";
    app.ports = [`${o.appPort}:${o.appPort}`];
    app.env_file = [".env"];
    app.restart = "unless-stopped";
    if (o.healthPath.trim() && o.healthTool !== "none") {
        const url = `http://127.0.0.1:${o.appPort}${o.healthPath.trim()}`;
        app.healthcheck = {
            test: o.healthTool === "curl" ? ["CMD", "curl", "-fsS", url] : o.healthTool === "python" ? ["CMD", "python", "-c", `import urllib.request; urllib.request.urlopen('${url}', timeout=4)`] : ["CMD", "wget", "-qO-", url],
            interval: "30s", timeout: "5s", retries: 3, start_period: "20s"
        };
    }
    const dependsOn = {};
    const volumes = {};
    const envLines = ["# Copy to .env and change the secrets. .env must not be committed."];
    for (const name of o.services) {
        const def = SERVICE_DEFS[name];
        const svc = { image: def.image };
        if (name === "minio")
            svc.command = ["server", "/data", "--console-address", ":9001"];
        if (def.env)
            svc.environment = def.env;
        // Bind data stores to localhost only: reachable from your machine, not from the network.
        svc.ports = [name === "nginx" ? def.port : `127.0.0.1:${def.port}`];
        if (def.volume) {
            svc.volumes = [`${name}-data:${def.volume}`];
            volumes[`${name}-data`] = null;
        }
        if (def.health)
            svc.healthcheck = { test: def.health, interval: "10s", timeout: "5s", retries: 5 };
        svc.restart = "unless-stopped";
        if (name === "nginx") {
            svc.volumes = ["./nginx.conf:/etc/nginx/conf.d/default.conf:ro"];
            svc.depends_on = { app: { condition: app.healthcheck ? "service_healthy" : "service_started" } };
        }
        else {
            dependsOn[name] = { condition: def.health ? "service_healthy" : "service_started" };
        }
        doc.services[name] = svc;
        for (const value of Object.values(def.env ?? {})) {
            const secret = /\$\{(\w+):\?/.exec(value)?.[1];
            if (secret)
                envLines.push(`${secret}=change-me`);
        }
        // Two SQL databases cannot both own DATABASE_URL.
        if (def.url)
            envLines.push(name === "mysql" && o.services.includes("postgres") ? def.url.replace("DATABASE_URL", "MYSQL_URL") : def.url);
    }
    if (Object.keys(dependsOn).length)
        app.depends_on = dependsOn;
    doc.services = { app, ...doc.services };
    if (Object.keys(volumes).length)
        doc.volumes = volumes;
    const compose = yaml_1.default.stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false }).replace(/: null$/gm, ":");
    return { compose, env: [...new Set(envLines)].join("\n") + "\n" };
}
exports.generateCompose = generateCompose;
function validateCompose(text) {
    const { docs, issues } = parseYamlDocuments(text);
    if (issues.some(i => i.severity === "error"))
        return issues;
    const doc = docs[0]?.toJS();
    if (!doc || typeof doc !== "object")
        return [{ severity: "error", message: "The file is empty or not a mapping." }];
    if ("version" in doc)
        issues.push({ severity: "info", message: "The top-level \"version\" key is obsolete in Compose v2 and ignored; remove it." });
    const services = doc.services;
    if (!services || typeof services !== "object")
        return [...issues, { severity: "error", message: "No \"services\" section." }];
    const names = new Set(Object.keys(services));
    const hostPorts = new Map();
    for (const [name, svc] of Object.entries(services)) {
        const p = `services.${name}`;
        if (!svc || typeof svc !== "object") {
            issues.push({ severity: "error", message: `${p} must be a mapping.`, path: p });
            continue;
        }
        if (!svc.image && !svc.build)
            issues.push({ severity: "error", message: `${p} needs an image or a build section.`, path: p });
        if (typeof svc.image === "string" && (!/:[^/]+$/.test(svc.image) || /:latest$/.test(svc.image)))
            issues.push({ severity: "warning", message: `${p}.image "${svc.image}" is not pinned to a version.`, path: p });
        const deps = Array.isArray(svc.depends_on) ? svc.depends_on : Object.keys(svc.depends_on ?? {});
        for (const d of deps)
            if (!names.has(d))
                issues.push({ severity: "error", message: `${p}.depends_on references unknown service "${d}".`, path: p });
        for (const [dep, cfg] of Object.entries(Array.isArray(svc.depends_on) ? {} : svc.depends_on ?? {})) {
            if (cfg?.condition === "service_healthy" && !services[dep]?.healthcheck)
                issues.push({ severity: "error", message: `${p} waits for "${dep}" to be healthy, but "${dep}" has no healthcheck - it will never start.`, path: p });
        }
        for (const port of svc.ports ?? []) {
            const spec = typeof port === "object" ? `${port.published ?? ""}:${port.target}` : String(port);
            const parts = spec.split(":");
            if (parts.length >= 2) {
                const host = parts.length === 3 ? `${parts[0]}:${parts[1]}` : parts[0];
                if (hostPorts.has(host))
                    issues.push({ severity: "error", message: `Host port ${host} is published by both "${hostPorts.get(host)}" and "${name}".`, path: p });
                hostPorts.set(host, name);
                if (parts.length === 2 && /postgres|mysql|redis|mongo|rabbitmq|minio/i.test(String(svc.image ?? name)))
                    issues.push({ severity: "info", message: `${p} publishes a data store on all interfaces; bind it to 127.0.0.1:${parts[0]} unless other machines need it.`, path: p });
            }
        }
        const env = Array.isArray(svc.environment) ? Object.fromEntries(svc.environment.map((e) => e.split("="))) : svc.environment ?? {};
        for (const [key, value] of Object.entries(env)) {
            if (/PASSWORD|SECRET|TOKEN|API_?KEY/i.test(key) && value && !/^\$\{/.test(String(value)))
                issues.push({ severity: "warning", message: `${p}.environment.${key} is hard-coded; reference a variable (\${${key}}) and keep the value in .env.`, path: p });
        }
        if (svc.privileged)
            issues.push({ severity: "warning", message: `${p} runs privileged: it has full access to the host.`, path: p });
        if (svc.network_mode === "host")
            issues.push({ severity: "info", message: `${p} uses host networking; published ports are ignored.`, path: p });
        if (!svc.restart && !svc.deploy?.restart_policy)
            issues.push({ severity: "info", message: `${p} has no restart policy.`, path: p });
        if (svc.volumes?.some((v) => typeof v === "string" && /^\/var\/run\/docker\.sock/.test(v)))
            issues.push({ severity: "warning", message: `${p} mounts the Docker socket: equivalent to root on the host.`, path: p });
    }
    return issues;
}
exports.validateCompose = validateCompose;
function generateK8s(o) {
    const name = o.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") || "app";
    const labels = { "app.kubernetes.io/name": name };
    const metadata = (kind) => ({ name, ...(o.namespace.trim() ? { namespace: o.namespace.trim() } : {}), labels: { ...labels, ...(kind === "Deployment" ? { "app.kubernetes.io/version": o.image.split(":")[1] ?? "unknown" } : {}) } });
    const configEntries = o.configMap.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
        const idx = l.indexOf("=");
        if (idx < 1)
            throw new types_1.ToolInputError(`ConfigMap line "${l}" must be KEY=value.`);
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    });
    const docs = [];
    if (configEntries.length)
        docs.push({ apiVersion: "v1", kind: "ConfigMap", metadata: metadata("ConfigMap"), data: Object.fromEntries(configEntries) });
    const envFrom = [];
    if (configEntries.length)
        envFrom.push({ configMapRef: { name } });
    if (o.secretName.trim())
        envFrom.push({ secretRef: { name: o.secretName.trim() } });
    const probe = (path, initial) => path.trim()
        ? { httpGet: { path: path.trim(), port: "http" }, initialDelaySeconds: initial, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 3 }
        : { tcpSocket: { port: "http" }, initialDelaySeconds: initial, periodSeconds: 10 };
    docs.push({
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: metadata("Deployment"),
        spec: {
            ...(o.hpa ? {} : { replicas: o.replicas }),
            revisionHistoryLimit: 5,
            selector: { matchLabels: labels },
            strategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
            template: {
                metadata: { labels },
                spec: {
                    automountServiceAccountToken: false,
                    securityContext: { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
                    terminationGracePeriodSeconds: 30,
                    containers: [{
                            name,
                            image: o.image,
                            imagePullPolicy: "IfNotPresent",
                            ports: [{ name: "http", containerPort: o.port }],
                            ...(envFrom.length ? { envFrom } : {}),
                            resources: { requests: { cpu: o.cpuRequest, memory: o.memoryRequest }, limits: { ...(o.cpuLimit.trim() ? { cpu: o.cpuLimit } : {}), memory: o.memoryLimit } },
                            startupProbe: { ...probe(o.healthPath, 0), failureThreshold: 30, periodSeconds: 5 },
                            livenessProbe: probe(o.healthPath, 0),
                            readinessProbe: probe(o.readinessPath || o.healthPath, 0),
                            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } },
                            volumeMounts: [{ name: "tmp", mountPath: "/tmp" }]
                        }],
                    volumes: [{ name: "tmp", emptyDir: {} }]
                }
            }
        }
    });
    docs.push({ apiVersion: "v1", kind: "Service", metadata: metadata("Service"), spec: { type: "ClusterIP", selector: labels, ports: [{ name: "http", port: 80, targetPort: "http" }] } });
    if (o.ingressHost.trim()) {
        docs.push({
            apiVersion: "networking.k8s.io/v1",
            kind: "Ingress",
            metadata: { ...metadata("Ingress"), ...(o.tls ? { annotations: { "cert-manager.io/cluster-issuer": "letsencrypt" } } : {}) },
            spec: {
                ingressClassName: "nginx",
                ...(o.tls ? { tls: [{ hosts: [o.ingressHost.trim()], secretName: `${name}-tls` }] } : {}),
                rules: [{ host: o.ingressHost.trim(), http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name, port: { name: "http" } } } }] } }]
            }
        });
    }
    if (o.hpa) {
        if (o.minReplicas > o.maxReplicas)
            throw new types_1.ToolInputError("Minimum replicas cannot exceed maximum replicas.");
        docs.push({
            apiVersion: "autoscaling/v2",
            kind: "HorizontalPodAutoscaler",
            metadata: metadata("HPA"),
            spec: {
                scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name },
                minReplicas: o.minReplicas, maxReplicas: o.maxReplicas,
                metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: o.targetCpu } } }]
            }
        });
    }
    if (o.pdb)
        docs.push({ apiVersion: "policy/v1", kind: "PodDisruptionBudget", metadata: metadata("PDB"), spec: { minAvailable: 1, selector: { matchLabels: labels } } });
    return docs.map(d => yaml_1.default.stringify(d, { lineWidth: 0, aliasDuplicateObjects: false })).join("---\n");
}
exports.generateK8s = generateK8s;
const DEPRECATED_APIS = {
    "extensions/v1beta1": "apps/v1 (Deployment) or networking.k8s.io/v1 (Ingress)",
    "apps/v1beta1": "apps/v1", "apps/v1beta2": "apps/v1",
    "networking.k8s.io/v1beta1": "networking.k8s.io/v1",
    "policy/v1beta1": "policy/v1",
    "autoscaling/v2beta1": "autoscaling/v2", "autoscaling/v2beta2": "autoscaling/v2",
    "batch/v1beta1": "batch/v1"
};
function validateK8s(text) {
    const { docs, issues } = parseYamlDocuments(text);
    if (issues.some(i => i.severity === "error"))
        return issues;
    const objects = docs.map(d => d.toJS()).filter(Boolean);
    if (!objects.length)
        return [{ severity: "error", message: "No Kubernetes objects found." }];
    const workloads = [];
    const services = new Set();
    objects.forEach((obj, index) => {
        const id = `${obj?.kind ?? "object"}/${obj?.metadata?.name ?? `#${index + 1}`}`;
        if (!obj.apiVersion)
            issues.push({ severity: "error", message: `${id}: missing apiVersion`, path: id });
        if (!obj.kind)
            issues.push({ severity: "error", message: `${id}: missing kind`, path: id });
        if (!obj.metadata?.name)
            issues.push({ severity: "error", message: `${id}: missing metadata.name`, path: id });
        else if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(obj.metadata.name))
            issues.push({ severity: "error", message: `${id}: metadata.name must be lowercase alphanumerics, '-' or '.'`, path: id });
        if (DEPRECATED_APIS[obj.apiVersion])
            issues.push({ severity: "error", message: `${id}: apiVersion ${obj.apiVersion} was removed; use ${DEPRECATED_APIS[obj.apiVersion]}`, path: id });
        if (obj.kind === "Service")
            services.add(obj.metadata?.name);
        const podSpec = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"].includes(obj.kind) ? obj.spec?.template?.spec : obj.kind === "Pod" ? obj.spec : obj.kind === "Job" ? obj.spec?.template?.spec : obj.kind === "CronJob" ? obj.spec?.jobTemplate?.spec?.template?.spec : undefined;
        if (["Deployment", "StatefulSet", "DaemonSet"].includes(obj.kind)) {
            const selector = obj.spec?.selector?.matchLabels ?? {};
            const templateLabels = obj.spec?.template?.metadata?.labels ?? {};
            if (!Object.keys(selector).length)
                issues.push({ severity: "error", message: `${id}: spec.selector.matchLabels is required`, path: id });
            for (const [k, v] of Object.entries(selector))
                if (templateLabels[k] !== v)
                    issues.push({ severity: "error", message: `${id}: selector ${k}=${v} does not match the pod template labels - the ${obj.kind} will never find its pods`, path: id });
            workloads.push({ name: obj.metadata?.name, labels: templateLabels });
            if (obj.kind === "Deployment" && obj.spec?.replicas === 1)
                issues.push({ severity: "info", message: `${id}: a single replica means downtime during node maintenance`, path: id });
        }
        if (podSpec) {
            const containers = [...(podSpec.containers ?? []), ...(podSpec.initContainers ?? [])];
            if (!podSpec.containers?.length)
                issues.push({ severity: "error", message: `${id}: no containers`, path: id });
            if (podSpec.hostNetwork)
                issues.push({ severity: "warning", message: `${id}: hostNetwork exposes the node's network namespace`, path: id });
            if (podSpec.hostPID || podSpec.hostIPC)
                issues.push({ severity: "warning", message: `${id}: hostPID/hostIPC shares host namespaces`, path: id });
            for (const c of containers) {
                const cid = `${id} container "${c.name ?? "?"}"`;
                if (!c.image)
                    issues.push({ severity: "error", message: `${cid}: missing image`, path: id });
                else if (!/[:@]/.test(c.image.split("/").pop()) || /:latest$/.test(c.image))
                    issues.push({ severity: "warning", message: `${cid}: image "${c.image}" is not pinned; rollbacks and cache behaviour become unpredictable`, path: id });
                if (!c.resources?.requests)
                    issues.push({ severity: "warning", message: `${cid}: no resource requests - the scheduler cannot place it sensibly`, path: id });
                if (!c.resources?.limits?.memory)
                    issues.push({ severity: "warning", message: `${cid}: no memory limit - a leak can take down the node`, path: id });
                if (!c.livenessProbe && !(podSpec.initContainers ?? []).includes(c) && obj.kind !== "Job" && obj.kind !== "CronJob")
                    issues.push({ severity: "info", message: `${cid}: no livenessProbe`, path: id });
                if (!c.readinessProbe && !(podSpec.initContainers ?? []).includes(c) && obj.kind !== "Job" && obj.kind !== "CronJob")
                    issues.push({ severity: "warning", message: `${cid}: no readinessProbe - traffic is sent before the app is ready`, path: id });
                if (c.securityContext?.privileged)
                    issues.push({ severity: "error", message: `${cid}: privileged container`, path: id });
                if (c.securityContext?.allowPrivilegeEscalation !== false)
                    issues.push({ severity: "info", message: `${cid}: set securityContext.allowPrivilegeEscalation: false`, path: id });
                if (!(c.securityContext?.runAsNonRoot || podSpec.securityContext?.runAsNonRoot))
                    issues.push({ severity: "info", message: `${cid}: set runAsNonRoot: true`, path: id });
                for (const env of c.env ?? []) {
                    if (/PASSWORD|SECRET|TOKEN|API_?KEY/i.test(env.name ?? "") && env.value)
                        issues.push({ severity: "warning", message: `${cid}: env ${env.name} has a literal value; use valueFrom.secretKeyRef`, path: id });
                }
            }
        }
    });
    for (const obj of objects) {
        if (obj?.kind === "Service" && obj.spec?.selector && workloads.length) {
            const selector = obj.spec.selector;
            const matches = workloads.some(w => Object.entries(selector).every(([k, v]) => w.labels[k] === v));
            if (!matches)
                issues.push({ severity: "warning", message: `Service/${obj.metadata?.name}: selector matches no workload in this file`, path: `Service/${obj.metadata?.name}` });
        }
        if (obj?.kind === "Ingress") {
            for (const rule of obj.spec?.rules ?? [])
                for (const p of rule.http?.paths ?? []) {
                    const svc = p.backend?.service?.name;
                    if (svc && services.size && !services.has(svc))
                        issues.push({ severity: "warning", message: `Ingress/${obj.metadata?.name}: backend service "${svc}" is not defined in this file`, path: `Ingress/${obj.metadata?.name}` });
                }
        }
    }
    return issues;
}
exports.validateK8s = validateK8s;
// ---------------------------------------------------------------------------
// Helm
// ---------------------------------------------------------------------------
function generateHelmChart(o) {
    const name = o.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") || "app";
    const [repository, tag] = o.image.includes(":") ? [o.image.slice(0, o.image.lastIndexOf(":")), o.image.slice(o.image.lastIndexOf(":") + 1)] : [o.image, "1.0.0"];
    const dir = `charts/${name}`;
    const values = {
        replicaCount: o.replicas,
        image: { repository, tag, pullPolicy: "IfNotPresent" },
        service: { type: "ClusterIP", port: 80 },
        containerPort: o.port,
        healthPath: o.healthPath || "/health",
        resources: { requests: { cpu: o.cpuRequest, memory: o.memoryRequest }, limits: { memory: o.memoryLimit } },
        ingress: { enabled: Boolean(o.ingressHost.trim()), className: "nginx", host: o.ingressHost.trim() || "app.example.com", tls: o.tls },
        autoscaling: { enabled: o.hpa, minReplicas: o.minReplicas, maxReplicas: o.maxReplicas, targetCPUUtilizationPercentage: o.targetCpu },
        env: {}
    };
    return [
        { path: `${dir}/Chart.yaml`, language: "yaml", content: `apiVersion: v2\nname: ${name}\ndescription: A Helm chart for ${name}\ntype: application\nversion: 0.1.0\nappVersion: "${tag}"\n` },
        { path: `${dir}/values.yaml`, language: "yaml", content: yaml_1.default.stringify(values, { lineWidth: 0, aliasDuplicateObjects: false }) },
        { path: `${dir}/templates/_helpers.tpl`, language: "helm", content: `{{- define "${name}.fullname" -}}
{{- if contains .Chart.Name .Release.Name }}{{ .Release.Name | trunc 63 | trimSuffix "-" }}{{- else }}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}{{- end }}
{{- end }}

{{- define "${name}.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "${name}.labels" -}}
{{ include "${name}.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}
` },
        { path: `${dir}/templates/deployment.yaml`, language: "helm", content: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "${name}.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "${name}.selectorLabels" . | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.containerPort }}
          {{- with .Values.env }}
          env:
            {{- range $key, $value := . }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
          {{- end }}
          livenessProbe:
            httpGet:
              path: {{ .Values.healthPath }}
              port: http
          readinessProbe:
            httpGet:
              path: {{ .Values.healthPath }}
              port: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
` },
        { path: `${dir}/templates/service.yaml`, language: "helm", content: `apiVersion: v1
kind: Service
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  selector:
    {{- include "${name}.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: http
` },
        { path: `${dir}/templates/ingress.yaml`, language: "helm", content: `{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.ingress.tls }}
  tls:
    - hosts: [{{ .Values.ingress.host | quote }}]
      secretName: {{ include "${name}.fullname" . }}-tls
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "${name}.fullname" . }}
                port:
                  name: http
{{- end }}
` },
        { path: `${dir}/templates/hpa.yaml`, language: "helm", content: `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "${name}.fullname" . }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "${name}.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
` },
        { path: `${dir}/templates/NOTES.txt`, language: "text", content: `{{ .Chart.Name }} is deployed.\n{{- if .Values.ingress.enabled }}\nURL: http{{ if .Values.ingress.tls }}s{{ end }}://{{ .Values.ingress.host }}\n{{- else }}\nkubectl port-forward svc/{{ include "${name}.fullname" . }} 8080:{{ .Values.service.port }}\n{{- end }}\n` },
        { path: `${dir}/.helmignore`, language: "ignore", content: ".git/\n*.swp\n*.bak\n.DS_Store\n" }
    ];
}
exports.generateHelmChart = generateHelmChart;
//# sourceMappingURL=devops-k8s.js.map