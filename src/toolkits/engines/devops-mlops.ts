import { GeneratedFile } from "../types";

/**
 * Model-serving (MLOps) and observability starters. These replace the old
 * quick-pick generators and fix their gaps: unpinned `latest` images, no GPU
 * tolerations, and an OpenTelemetry setup without an exporter.
 */

export interface ServingOptions {
  name: string;
  port: number;
  gpu: boolean;
  cudaVersion: string;
  pythonVersion: string;
  image: string;
  memoryGi: number;
}

export function modelServingFiles(o: ServingOptions): GeneratedFile[] {
  const name = o.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "model-serving";
  const py = o.pythonVersion || "3.12";
  const dockerfile = o.gpu
    ? `# CUDA runtime only (no compiler toolchain): much smaller than the -devel images.
FROM nvidia/cuda:${o.cudaVersion || "12.4.1"}-cudnn-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python3 -m pip install -r requirements.txt
COPY . .
RUN useradd --create-home --uid 10001 appuser
USER 10001
EXPOSE ${o.port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${o.port}/health', timeout=4)"
CMD ["python3", "-m", "uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "${o.port}"]
`
    : `FROM python:${py}-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY . .
RUN useradd --create-home --uid 10001 appuser
USER 10001
EXPOSE ${o.port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${o.port}/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "${o.port}"]
`;
  const serve = `"""Minimal model server: /health (alive), /ready (model loaded), /predict (versioned schema)."""
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_NAME = os.environ.get("MODEL_NAME", "${name}")
MODEL_VERSION = os.environ.get("MODEL_VERSION", "0.1.0")
log = logging.getLogger("serve")
logging.basicConfig(level=logging.INFO, format="%(message)s")
state: dict = {"model": None}


def load_model():
    # Load from a pinned, checksummed artifact - never an unpinned download at startup.
    return lambda features: sum(features)  # placeholder model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state["model"] = load_model()
    yield
    state["model"] = None


app = FastAPI(title=MODEL_NAME, lifespan=lifespan)


class PredictRequest(BaseModel):
    schema_version: str = Field(default="1", pattern="^1$")
    features: list[float] = Field(min_length=1, max_length=1024)


class PredictResponse(BaseModel):
    prediction: float
    model_name: str
    model_version: str
    request_id: str
    latency_ms: float


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict:
    if state["model"] is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    return {"status": "ready", "model_version": MODEL_VERSION}


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    if state["model"] is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    request_id = str(uuid.uuid4())
    start = time.perf_counter()
    prediction = float(state["model"](request.features))
    latency = (time.perf_counter() - start) * 1000
    log.info('{"event": "prediction", "request_id": "%s", "model_version": "%s", "latency_ms": %.2f}', request_id, MODEL_VERSION, latency)
    return PredictResponse(prediction=prediction, model_name=MODEL_NAME, model_version=MODEL_VERSION, request_id=request_id, latency_ms=round(latency, 2))
`;
  const k8s = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: ${name}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
${o.gpu ? `      # Schedule onto GPU nodes (taint/label names vary by cluster; these match GKE/EKS defaults).
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
` : ""}      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: ${name}
          image: ${o.image || `your-registry/${name}:0.1.0`}
          ports:
            - name: http
              containerPort: ${o.port}
          env:
            - name: MODEL_VERSION
              valueFrom:
                configMapKeyRef:
                  name: ${name}-config
                  key: MODEL_VERSION
          resources:
            requests:
              cpu: "1"
              memory: ${o.memoryGi}Gi${o.gpu ? "\n              nvidia.com/gpu: 1" : ""}
            limits:
              memory: ${o.memoryGi * 2}Gi${o.gpu ? "\n              nvidia.com/gpu: 1" : ""}
          startupProbe:
            httpGet:
              path: /ready
              port: http
            periodSeconds: 10
            failureThreshold: 60   # allow up to 10 minutes to load the model
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: http
            periodSeconds: 20
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-config
data:
  MODEL_VERSION: "0.1.0"
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - name: http
      port: 80
      targetPort: http
`;
  const ci = `name: ML CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "${py}"
          cache: pip
      - run: pip install -r requirements.txt pytest httpx
      - run: python -m compileall -q .
      - run: pytest -q
      - name: Smoke-test the server
        run: |
          python -m uvicorn serve:app --port ${o.port} &
          for i in $(seq 1 30); do curl -fsS http://127.0.0.1:${o.port}/ready && break; sleep 1; done
          curl -fsS -X POST http://127.0.0.1:${o.port}/predict -H 'content-type: application/json' -d '{"features": [1, 2, 3]}'
`;
  const contract = `# ${name} serving contract

| Endpoint | Purpose | Success |
| --- | --- | --- |
| GET /health | Process is alive (liveness) | 200 |
| GET /ready | Model is loaded (readiness) | 200, else 503 |
| POST /predict | Versioned request schema | 200 with model_name, model_version, request_id, latency_ms |

## Rules

- Never download an unpinned model at container start. Pin the artifact version and verify its checksum.
- Keep large artifacts outside the image (object storage or a volume) and cache them.
- Reject incompatible feature schemas with 422 before inference.
- Log model version, request ID, latency and status as JSON on every prediction.
- Readiness stays false until the model has loaded; the startup probe allows slow loads without restarts.
`;
  return [
    { path: "Dockerfile", language: "dockerfile", content: dockerfile },
    { path: "serve.py", language: "python", content: serve },
    { path: "requirements.txt", language: "text", content: "fastapi>=0.115\nuvicorn[standard]>=0.30\npydantic>=2.7\n" },
    { path: `k8s/${name}.yaml`, language: "yaml", content: k8s },
    { path: ".github/workflows/ml-ci.yml", language: "yaml", content: ci },
    { path: "docs/serving-contract.md", language: "markdown", content: contract }
  ];
}

export function observabilityFiles(stack: "node" | "python", service: string): GeneratedFile[] {
  const name = service.trim() || "my-service";
  const logSchema = JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Log event",
    type: "object",
    required: ["timestamp", "level", "service", "message"],
    properties: {
      timestamp: { type: "string", format: "date-time" },
      level: { enum: ["trace", "debug", "info", "warn", "error", "fatal"] },
      service: { type: "string", minLength: 1 },
      message: { type: "string" },
      requestId: { type: "string" },
      traceId: { type: "string" },
      spanId: { type: "string" },
      durationMs: { type: "number", minimum: 0 },
      error: { type: "object", properties: { type: { type: "string" }, message: { type: "string" }, stack: { type: "string" } } }
    },
    additionalProperties: true
  }, null, 2) + "\n";
  const env = `# OpenTelemetry (read by the SDK automatically)
OTEL_SERVICE_NAME=${name}
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
`;
  const collector = `# Local collector + Jaeger UI (http://localhost:16686): docker compose -f otel-compose.yaml up
services:
  jaeger:
    image: jaegertracing/all-in-one:1.62.0
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "127.0.0.1:16686:16686"
      - "127.0.0.1:4317:4317"
      - "127.0.0.1:4318:4318"
`;
  if (stack === "node") {
    return [
      { path: "src/telemetry.ts", language: "typescript", content: `// Load before anything else: node --import ./dist/telemetry.js dist/index.js
// npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(), // endpoint from OTEL_EXPORTER_OTLP_ENDPOINT
  instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })]
});

sdk.start();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    sdk.shutdown().catch(error => console.error("telemetry shutdown failed", error)).finally(() => process.exit(0));
  });
}
` },
      { path: "src/logger.ts", language: "typescript", content: `// npm i pino
import pino from "pino";
import { trace } from "@opentelemetry/api";

/** JSON logs that match observability/log-schema.json and carry the active trace id. */
export const logger = pino({
  base: { service: process.env.OTEL_SERVICE_NAME ?? ${JSON.stringify(name)} },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: "message",
  formatters: { level: label => ({ level: label }) },
  redact: ["password", "token", "authorization", "*.password", "*.token", "req.headers.authorization", "req.headers.cookie"],
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    return span ? { traceId: span.traceId, spanId: span.spanId } : {};
  }
});
` },
      { path: "observability/log-schema.json", language: "json", content: logSchema },
      { path: "observability/otel.env", language: "dotenv", content: env },
      { path: "observability/otel-compose.yaml", language: "yaml", content: collector }
    ];
  }
  return [
    { path: "app/telemetry.py", language: "python", content: `"""OpenTelemetry setup.

pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http \\
    opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-requests
"""
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def configure_telemetry(app) -> None:
    """Call once at startup, before serving requests. Endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT."""
    provider = TracerProvider(resource=Resource.create())  # service name from OTEL_SERVICE_NAME
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    RequestsInstrumentor().instrument()
` },
    { path: "app/logging_config.py", language: "python", content: `"""JSON logs that match observability/log-schema.json and carry the active trace id."""
import json
import logging
import os
from datetime import datetime, timezone

from opentelemetry import trace

SERVICE = os.environ.get("OTEL_SERVICE_NAME", ${JSON.stringify(name)})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname.lower().replace("warning", "warn").replace("critical", "fatal"),
            "service": SERVICE,
            "message": record.getMessage(),
            "logger": record.name,
        }
        ctx = trace.get_current_span().get_span_context()
        if ctx.is_valid:
            event["traceId"] = format(ctx.trace_id, "032x")
            event["spanId"] = format(ctx.span_id, "016x")
        if record.exc_info:
            event["error"] = {"type": record.exc_info[0].__name__, "message": str(record.exc_info[1]), "stack": self.formatException(record.exc_info)}
        return json.dumps(event, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
` },
    { path: "observability/log-schema.json", language: "json", content: logSchema },
    { path: "observability/otel.env", language: "dotenv", content: env },
    { path: "observability/otel-compose.yaml", language: "yaml", content: collector }
  ];
}
