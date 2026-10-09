"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scaffoldAiProject = void 0;
const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ai-app";
const pyName = (name) => slug(name).replace(/-/g, "_");
function envExample(provider, model) {
    const lines = ["# Copy to .env (never commit .env)", `LLM_PROVIDER=${provider}`, `LLM_MODEL=${model}`];
    if (provider === "openai")
        lines.push("OPENAI_API_KEY=sk-...");
    if (provider === "anthropic")
        lines.push("ANTHROPIC_API_KEY=sk-ant-...");
    if (provider === "ollama")
        lines.push("OLLAMA_BASE_URL=http://localhost:11434/v1");
    lines.push("LLM_TIMEOUT_SECONDS=30", "LLM_MAX_RETRIES=3");
    return lines.join("\n") + "\n";
}
const SYSTEM_PROMPT = "You are a concise, accurate assistant.\n\nRules:\n- If you are not sure, say so.\n- Answer in plain language.\n";
const EVAL_CASES = [
    { input: "What is the capital of France? Answer with one word.", expected: "Paris" },
    { input: "What is 12 * 12? Answer with only the number.", expected: "144" }
].map(c => JSON.stringify(c)).join("\n") + "\n";
function pythonProject(o) {
    const pkg = pyName(o.name);
    const deps = [o.provider === "anthropic" ? "anthropic>=0.40" : "openai>=1.50", "python-dotenv>=1.0"];
    const clientCode = o.provider === "anthropic"
        ? `import anthropic

from .config import settings

_client = anthropic.Anthropic(timeout=settings.timeout_seconds, max_retries=settings.max_retries)


def complete(user: str, system: str = "") -> str:
    message = _client.messages.create(
        model=settings.model,
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in message.content if block.type == "text")
`
        : `from openai import OpenAI

from .config import settings

_client = OpenAI(
${o.provider === "ollama" ? `    base_url=settings.base_url,\n    api_key="ollama",  # required by the SDK, ignored by Ollama\n` : ""}    timeout=settings.timeout_seconds,
    max_retries=settings.max_retries,
)


def complete(user: str, system: str = "") -> str:
    messages = [{"role": "system", "content": system}] if system else []
    messages.append({"role": "user", "content": user})
    response = _client.chat.completions.create(model=settings.model, messages=messages, temperature=0)
    return response.choices[0].message.content or ""
`;
    const requiredKey = o.provider === "openai" ? "OPENAI_API_KEY" : o.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "";
    const files = [
        { path: "pyproject.toml", language: "toml", content: `[project]\nname = "${slug(o.name)}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\ndependencies = [\n${deps.map(d => `    "${d}",`).join("\n")}\n]\n\n[project.optional-dependencies]\ndev = ["pytest>=8"]\n\n[build-system]\nrequires = ["setuptools>=68"]\nbuild-backend = "setuptools.build_meta"\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n` },
        { path: ".env.example", language: "properties", content: envExample(o.provider, o.model) },
        { path: ".gitignore", language: "ignore", content: ".env\n.venv/\n__pycache__/\n*.pyc\n.pytest_cache/\ndist/\n" },
        { path: `src/${pkg}/__init__.py`, language: "python", content: "" },
        { path: `src/${pkg}/config.py`, language: "python", content: `"""Settings from the environment, validated once at startup."""
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}. Copy .env.example to .env and set it.")
    return value


@dataclass(frozen=True)
class Settings:
    model: str
    timeout_seconds: float
    max_retries: int
    base_url: str


def load_settings() -> Settings:
${requiredKey ? `    _require("${requiredKey}")\n` : ""}    return Settings(
        model=os.environ.get("LLM_MODEL", ${JSON.stringify(o.model)}),
        timeout_seconds=float(os.environ.get("LLM_TIMEOUT_SECONDS", "30")),
        max_retries=int(os.environ.get("LLM_MAX_RETRIES", "3")),
        base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    )


settings = load_settings()
` },
        { path: `src/${pkg}/llm.py`, language: "python", content: clientCode },
        { path: `src/${pkg}/prompts.py`, language: "python", content: `from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
` },
        { path: `src/${pkg}/main.py`, language: "python", content: `import sys

from .llm import complete
from .prompts import load_prompt


def main() -> None:
    question = " ".join(sys.argv[1:]) or "Say hello in five words."
    print(complete(question, system=load_prompt("system")))


if __name__ == "__main__":
    main()
` },
        { path: "prompts/system.md", language: "markdown", content: SYSTEM_PROMPT },
        { path: "README.md", language: "markdown", content: `# ${o.name}\n\n\`\`\`bash\npython -m venv .venv && source .venv/bin/activate\npip install -e ".[dev]"\ncp .env.example .env   # then fill it in\npython -m ${pkg}.main "Your question"\n${o.evals ? `python evals/run_evals.py\n` : ""}\`\`\`\n\nPrompts live in \`prompts/\`, so they can be reviewed and versioned like code.\n` }
    ];
    if (o.evals) {
        files.push({ path: "evals/cases.jsonl", language: "jsonl", content: EVAL_CASES }, { path: "evals/run_evals.py", language: "python", content: `"""Runs the eval set and exits non-zero if accuracy drops below the threshold (use in CI)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from ${pkg}.llm import complete  # noqa: E402
from ${pkg}.prompts import load_prompt  # noqa: E402

THRESHOLD = 0.9


def main() -> int:
    cases = [json.loads(line) for line in (Path(__file__).parent / "cases.jsonl").read_text().splitlines() if line.strip()]
    system = load_prompt("system")
    passed = 0
    for case in cases:
        output = complete(case["input"], system=system).strip()
        ok = case["expected"].lower() in output.lower()
        passed += ok
        print(("PASS" if ok else "FAIL"), case["input"], "->", output[:80])
    accuracy = passed / len(cases)
    print(f"accuracy: {accuracy:.0%}")
    return 0 if accuracy >= THRESHOLD else 1


if __name__ == "__main__":
    sys.exit(main())
` });
    }
    if (o.docker) {
        files.push({ path: "Dockerfile", language: "dockerfile", content: `FROM python:3.12-slim\nENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\nWORKDIR /app\nCOPY pyproject.toml ./\nCOPY src ./src\nCOPY prompts ./prompts\nRUN pip install --no-cache-dir .\nRUN useradd --create-home app\nUSER app\nCMD ["python", "-m", "${pkg}.main"]\n` });
    }
    return files;
}
function typescriptProject(o) {
    const sdk = o.provider === "anthropic" ? { "@anthropic-ai/sdk": "^0.30.0" } : { openai: "^4.70.0" };
    const clientCode = o.provider === "anthropic"
        ? `import Anthropic from "@anthropic-ai/sdk";
import { settings } from "./config.js";

const client = new Anthropic({ timeout: settings.timeoutMs, maxRetries: settings.maxRetries });

export async function complete(user: string, system = ""): Promise<string> {
  const message = await client.messages.create({
    model: settings.model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  return message.content.map(block => (block.type === "text" ? block.text : "")).join("");
}
`
        : `import OpenAI from "openai";
import { settings } from "./config.js";

const client = new OpenAI({
${o.provider === "ollama" ? `  baseURL: settings.baseUrl,\n  apiKey: "ollama",\n` : ""}  timeout: settings.timeoutMs,
  maxRetries: settings.maxRetries,
});

export async function complete(user: string, system = ""): Promise<string> {
  const response = await client.chat.completions.create({
    model: settings.model,
    temperature: 0,
    messages: [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user" as const, content: user }],
  });
  return response.choices[0]?.message.content ?? "";
}
`;
    const requiredKey = o.provider === "openai" ? "OPENAI_API_KEY" : o.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "";
    const files = [
        { path: "package.json", language: "json", content: JSON.stringify({
                name: slug(o.name), version: "0.1.0", private: true, type: "module",
                scripts: { dev: "tsx src/index.ts", build: "tsc -p .", start: "node dist/index.js", ...(o.evals ? { eval: "tsx evals/run.ts" } : {}) },
                dependencies: { ...sdk, dotenv: "^16.4.5" },
                devDependencies: { typescript: "^5.6.0", tsx: "^4.19.0", "@types/node": "^22.0.0" }
            }, null, 2) + "\n" },
        { path: "tsconfig.json", language: "json", content: JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, outDir: "dist", rootDir: "src", skipLibCheck: true, esModuleInterop: true }, include: ["src"] }, null, 2) + "\n" },
        { path: ".env.example", language: "properties", content: envExample(o.provider, o.model) },
        { path: ".gitignore", language: "ignore", content: ".env\nnode_modules/\ndist/\n" },
        { path: "src/config.ts", language: "typescript", content: `import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(\`Missing required environment variable \${name}. Copy .env.example to .env and set it.\`);
  return value;
}

${requiredKey ? `required("${requiredKey}");\n\n` : ""}export const settings = {
  model: process.env.LLM_MODEL ?? ${JSON.stringify(o.model)},
  timeoutMs: Number(process.env.LLM_TIMEOUT_SECONDS ?? 30) * 1000,
  maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 3),
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
} as const;
` },
        { path: "src/llm.ts", language: "typescript", content: clientCode },
        { path: "src/prompts.ts", language: "typescript", content: `import { readFile } from "node:fs/promises";

export function loadPrompt(name: string): Promise<string> {
  return readFile(new URL(\`../prompts/\${name}.md\`, import.meta.url), "utf8");
}
` },
        { path: "src/index.ts", language: "typescript", content: `import { complete } from "./llm.js";
import { loadPrompt } from "./prompts.js";

const question = process.argv.slice(2).join(" ") || "Say hello in five words.";
console.log(await complete(question, await loadPrompt("system")));
` },
        { path: "prompts/system.md", language: "markdown", content: SYSTEM_PROMPT },
        { path: "README.md", language: "markdown", content: `# ${o.name}\n\n\`\`\`bash\nnpm install\ncp .env.example .env   # then fill it in\nnpm run dev -- "Your question"\n${o.evals ? `npm run eval\n` : ""}\`\`\`\n\nPrompts live in \`prompts/\`, so they can be reviewed and versioned like code.\n` }
    ];
    if (o.evals) {
        files.push({ path: "evals/cases.jsonl", language: "jsonl", content: EVAL_CASES }, { path: "evals/run.ts", language: "typescript", content: `import { readFile } from "node:fs/promises";
import { complete } from "../src/llm.js";
import { loadPrompt } from "../src/prompts.js";

const THRESHOLD = 0.9;
const text = await readFile(new URL("./cases.jsonl", import.meta.url), "utf8");
const cases: Array<{ input: string; expected: string }> = text.split("\\n").filter(Boolean).map(line => JSON.parse(line));
const system = await loadPrompt("system");
let passed = 0;
for (const testCase of cases) {
  const output = (await complete(testCase.input, system)).trim();
  const ok = output.toLowerCase().includes(testCase.expected.toLowerCase());
  if (ok) passed++;
  console.log(ok ? "PASS" : "FAIL", testCase.input, "->", output.slice(0, 80));
}
const accuracy = passed / cases.length;
console.log(\`accuracy: \${Math.round(accuracy * 100)}%\`);
process.exitCode = accuracy >= THRESHOLD ? 0 : 1;
` });
    }
    if (o.docker) {
        files.push({ path: "Dockerfile", language: "dockerfile", content: `FROM node:22-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY tsconfig.json ./\nCOPY src ./src\nRUN npm run build\n\nFROM node:22-alpine\nENV NODE_ENV=production\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --omit=dev && npm cache clean --force\nCOPY --from=build /app/dist ./dist\nCOPY prompts ./prompts\nUSER node\nCMD ["node", "dist/index.js"]\n` });
    }
    return files;
}
function scaffoldAiProject(o) {
    return o.language === "python" ? pythonProject(o) : typescriptProject(o);
}
exports.scaffoldAiProject = scaffoldAiProject;
//# sourceMappingURL=ai-project.js.map