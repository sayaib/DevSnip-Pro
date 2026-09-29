/**
 * AI/ML code snippets for tasks developers write by hand again and again.
 * Every snippet is complete (imports included) and syntax-checked by the
 * unit tests with the real Python and TypeScript compilers.
 */

export interface Snippet {
  id: string;
  title: string;
  category: "LLM APIs" | "Embeddings & search" | "Serving" | "Evaluation" | "Training";
  language: "python" | "typescript";
  description: string;
  install: string;
  code: string;
}

export const AI_SNIPPETS: Snippet[] = [
  {
    id: "py-structured-output", title: "Structured output with Pydantic", category: "LLM APIs", language: "python",
    description: "Get a validated Python object back instead of parsing free text.",
    install: "pip install openai pydantic",
    code: `from openai import OpenAI
from pydantic import BaseModel, Field


class Ticket(BaseModel):
    title: str = Field(description="Short summary of the issue")
    severity: str = Field(description="one of: low, medium, high")
    components: list[str]


client = OpenAI()  # reads OPENAI_API_KEY


def extract_ticket(text: str) -> Ticket:
    completion = client.beta.chat.completions.parse(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": "Extract a support ticket from the user's message."},
            {"role": "user", "content": text},
        ],
        response_format=Ticket,
    )
    message = completion.choices[0].message
    if message.refusal:
        raise ValueError(f"Model refused: {message.refusal}")
    return message.parsed


if __name__ == "__main__":
    print(extract_ticket("Checkout page crashes on Safari when applying a coupon. Blocking sales!"))
`
  },
  {
    id: "py-tool-calling", title: "Tool-calling loop (OpenAI)", category: "LLM APIs", language: "python",
    description: "Let the model call your functions until it can answer.",
    install: "pip install openai",
    code: `import json

from openai import OpenAI

client = OpenAI()


def get_weather(city: str) -> dict:
    # Replace with a real API call.
    return {"city": city, "temperature_c": 21, "conditions": "sunny"}


TOOLS = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]
HANDLERS = {"get_weather": get_weather}


def run(question: str, max_turns: int = 5) -> str:
    messages = [{"role": "user", "content": question}]
    for _ in range(max_turns):
        response = client.chat.completions.create(model="gpt-4.1-mini", messages=messages, tools=TOOLS)
        message = response.choices[0].message
        if not message.tool_calls:
            return message.content or ""
        messages.append(message)
        for call in message.tool_calls:
            args = json.loads(call.function.arguments or "{}")
            try:
                result = HANDLERS[call.function.name](**args)
            except Exception as error:  # report tool errors back to the model
                result = {"error": str(error)}
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})
    raise RuntimeError("Stopped after too many tool calls")


if __name__ == "__main__":
    print(run("Should I bring an umbrella in Lisbon today?"))
`
  },
  {
    id: "py-anthropic-tools", title: "Tool use (Anthropic)", category: "LLM APIs", language: "python",
    description: "The same agent loop for Claude's tool-use API.",
    install: "pip install anthropic",
    code: `import anthropic

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

TOOLS = [{
    "name": "lookup_order",
    "description": "Look up an order by its id",
    "input_schema": {
        "type": "object",
        "properties": {"order_id": {"type": "string"}},
        "required": ["order_id"],
    },
}]


def lookup_order(order_id: str) -> str:
    return f"Order {order_id}: shipped yesterday, arriving Friday."


def run(question: str, max_turns: int = 5) -> str:
    messages = [{"role": "user", "content": question}]
    for _ in range(max_turns):
        response = client.messages.create(
            model="claude-sonnet-4-5", max_tokens=1024, tools=TOOLS, messages=messages
        )
        if response.stop_reason != "tool_use":
            return "".join(block.text for block in response.content if block.type == "text")
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for block in response.content:
            if block.type == "tool_use":
                output = lookup_order(**block.input)
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
        messages.append({"role": "user", "content": results})
    raise RuntimeError("Stopped after too many tool calls")


if __name__ == "__main__":
    print(run("Where is order A-1042?"))
`
  },
  {
    id: "py-async-batch", title: "Concurrent requests with a rate limit", category: "LLM APIs", language: "python",
    description: "Process many prompts in parallel without hitting rate limits.",
    install: "pip install openai",
    code: `import asyncio

from openai import AsyncOpenAI

client = AsyncOpenAI(max_retries=5)  # retries 429s and 5xx with backoff
LIMIT = asyncio.Semaphore(8)  # at most 8 requests in flight


async def summarize(text: str) -> str:
    async with LIMIT:
        response = await client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[{"role": "user", "content": f"Summarize in one sentence:\\n\\n{text}"}],
        )
        return response.choices[0].message.content or ""


async def main(documents: list[str]) -> list[str]:
    tasks = [summarize(doc) for doc in documents]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r if isinstance(r, str) else f"ERROR: {r}" for r in results]


if __name__ == "__main__":
    docs = ["First document ...", "Second document ...", "Third document ..."]
    for summary in asyncio.run(main(docs)):
        print("-", summary)
`
  },
  {
    id: "py-count-tokens", title: "Count tokens exactly (tiktoken)", category: "LLM APIs", language: "python",
    description: "Exact token counts for OpenAI models, including chat message overhead.",
    install: "pip install tiktoken",
    code: `import tiktoken


def count_tokens(text: str, model: str = "gpt-4o") -> int:
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        encoding = tiktoken.get_encoding("o200k_base")
    return len(encoding.encode(text))


def count_chat_tokens(messages: list[dict], model: str = "gpt-4o") -> int:
    # ~3 tokens of framing per message plus 3 for the assistant reply prefix.
    return sum(3 + count_tokens(m["content"], model) for m in messages) + 3


def truncate(text: str, max_tokens: int, model: str = "gpt-4o") -> str:
    encoding = tiktoken.encoding_for_model(model)
    tokens = encoding.encode(text)
    return encoding.decode(tokens[:max_tokens])


if __name__ == "__main__":
    print(count_tokens("The quick brown fox jumps over the lazy dog."))
`
  },
  {
    id: "py-embeddings-search", title: "Embed documents and search", category: "Embeddings & search", language: "python",
    description: "Batch embeddings with NumPy cosine search - no vector DB needed for small corpora.",
    install: "pip install openai numpy",
    code: `import numpy as np
from openai import OpenAI

client = OpenAI()
MODEL = "text-embedding-3-small"


def embed(texts: list[str], batch_size: int = 256) -> np.ndarray:
    vectors = []
    for start in range(0, len(texts), batch_size):
        batch = [t.replace("\\n", " ") for t in texts[start:start + batch_size]]
        response = client.embeddings.create(model=MODEL, input=batch)
        vectors.extend(item.embedding for item in response.data)
    matrix = np.array(vectors, dtype=np.float32)
    return matrix / np.linalg.norm(matrix, axis=1, keepdims=True)


def search(query: str, doc_vectors: np.ndarray, docs: list[str], k: int = 3) -> list[tuple[float, str]]:
    q = embed([query])[0]
    scores = doc_vectors @ q  # cosine similarity (vectors are normalized)
    top = np.argsort(-scores)[:k]
    return [(float(scores[i]), docs[i]) for i in top]


if __name__ == "__main__":
    documents = ["Refunds are processed within 5 days.", "Our office is in Berlin.", "Shipping is free over $50."]
    vectors = embed(documents)
    for score, doc in search("How long does a refund take?", vectors, documents):
        print(f"{score:.3f}  {doc}")
`
  },
  {
    id: "py-fastapi-sse", title: "Streaming endpoint (FastAPI + SSE)", category: "Serving", language: "python",
    description: "Stream LLM tokens to a browser without exposing your API key.",
    install: "pip install fastapi uvicorn openai",
    code: `from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

app = FastAPI()
client = AsyncOpenAI()


class ChatRequest(BaseModel):
    message: str


@app.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    async def events():
        stream = await client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[{"role": "user", "content": request.message}],
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield f"data: {delta}\\n\\n"
        yield "data: [DONE]\\n\\n"

    return StreamingResponse(events(), media_type="text/event-stream")

# Run: uvicorn app:app --reload
`
  },
  {
    id: "py-eval-harness", title: "Minimal eval harness", category: "Evaluation", language: "python",
    description: "Run a prompt over a JSONL test set and score it - catch regressions before shipping.",
    install: "pip install openai",
    code: `import json
from pathlib import Path

from openai import OpenAI

client = OpenAI()
SYSTEM = "Answer with a single word."


def predict(question: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        temperature=0,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],
    )
    return (response.choices[0].message.content or "").strip()


def evaluate(path: str) -> float:
    # Each line: {"input": "...", "expected": "..."}
    cases = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    failures = []
    for case in cases:
        output = predict(case["input"])
        if output.lower() != case["expected"].lower():
            failures.append({**case, "output": output})
    accuracy = 1 - len(failures) / len(cases)
    print(f"accuracy: {accuracy:.1%} ({len(cases) - len(failures)}/{len(cases)})")
    for failure in failures[:10]:
        print("FAIL", json.dumps(failure))
    return accuracy


if __name__ == "__main__":
    assert evaluate("evals/cases.jsonl") >= 0.9, "Accuracy dropped below 90%"
`
  },
  {
    id: "py-torch-loop", title: "PyTorch training loop (AMP + accumulation)", category: "Training", language: "python",
    description: "A correct training loop: mixed precision, gradient accumulation, clipping, eval.",
    install: "pip install torch",
    code: `import torch
from torch import nn
from torch.utils.data import DataLoader


def train(model: nn.Module, train_loader: DataLoader, val_loader: DataLoader, epochs: int = 3,
          lr: float = 3e-4, accumulation_steps: int = 4) -> None:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    loss_fn = nn.CrossEntropyLoss()

    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        for step, (inputs, targets) in enumerate(train_loader):
            inputs, targets = inputs.to(device), targets.to(device)
            with torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device == "cuda"):
                loss = loss_fn(model(inputs), targets) / accumulation_steps
            scaler.scale(loss).backward()
            if (step + 1) % accumulation_steps == 0:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)

        model.eval()
        correct = total = 0
        with torch.no_grad():
            for inputs, targets in val_loader:
                predictions = model(inputs.to(device)).argmax(dim=1)
                correct += (predictions == targets.to(device)).sum().item()
                total += targets.size(0)
        print(f"epoch {epoch + 1}: val accuracy {correct / max(1, total):.3f}")
`
  },
  {
    id: "py-lora-finetune", title: "LoRA fine-tuning (PEFT + TRL)", category: "Training", language: "python",
    description: "Supervised fine-tuning of an open model with LoRA adapters.",
    install: "pip install transformers peft trl datasets accelerate",
    code: `from datasets import load_dataset
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"

# JSONL with {"messages": [{"role": "user", ...}, {"role": "assistant", ...}]} per line.
dataset = load_dataset("json", data_files={"train": "data/train.jsonl", "validation": "data/val.jsonl"})

peft_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    task_type="CAUSAL_LM",
)

args = SFTConfig(
    output_dir="outputs/lora",
    num_train_epochs=2,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    logging_steps=10,
    eval_strategy="epoch",
    bf16=True,
    gradient_checkpointing=True,
)

trainer = SFTTrainer(
    model=MODEL_ID,
    args=args,
    train_dataset=dataset["train"],
    eval_dataset=dataset["validation"],
    peft_config=peft_config,
)
trainer.train()
trainer.save_model("outputs/lora/final")
`
  },
  {
    id: "py-sklearn-cv", title: "scikit-learn pipeline + cross-validation", category: "Training", language: "python",
    description: "Preprocessing and model in one pipeline, evaluated without leakage.",
    install: "pip install scikit-learn pandas",
    code: `import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

df = pd.read_csv("data.csv")
y = df.pop("label")
numeric = df.select_dtypes("number").columns.tolist()
categorical = df.select_dtypes(exclude="number").columns.tolist()

preprocess = ColumnTransformer([
    ("num", SimpleImputer(strategy="median"), numeric),
    ("cat", Pipeline([
        ("impute", SimpleImputer(strategy="most_frequent")),
        ("encode", OneHotEncoder(handle_unknown="ignore")),
    ]), categorical),
])
model = Pipeline([("preprocess", preprocess), ("clf", HistGradientBoostingClassifier(random_state=42))])

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
scores = cross_validate(model, df, y, cv=cv, scoring=["accuracy", "f1_macro"])
print(f"accuracy {scores['test_accuracy'].mean():.3f} +/- {scores['test_accuracy'].std():.3f}")
print(f"f1_macro {scores['test_f1_macro'].mean():.3f} +/- {scores['test_f1_macro'].std():.3f}")
`
  },
  {
    id: "ts-structured-output", title: "Structured output with Zod", category: "LLM APIs", language: "typescript",
    description: "Typed, validated objects from an LLM in TypeScript.",
    install: "npm install openai zod",
    code: `import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

const Ticket = z.object({
  title: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  components: z.array(z.string()),
});

const client = new OpenAI(); // reads OPENAI_API_KEY

export async function extractTicket(text: string): Promise<z.infer<typeof Ticket>> {
  const completion = await client.beta.chat.completions.parse({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "Extract a support ticket from the user's message." },
      { role: "user", content: text },
    ],
    response_format: zodResponseFormat(Ticket, "ticket"),
  });
  const message = completion.choices[0]?.message;
  if (!message?.parsed) throw new Error(message?.refusal ?? "No structured output returned");
  return message.parsed;
}
`
  },
  {
    id: "ts-tool-calling", title: "Tool-calling loop (TypeScript)", category: "LLM APIs", language: "typescript",
    description: "Let the model call your functions until it can answer.",
    install: "npm install openai",
    code: `import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

const client = new OpenAI();

const tools: ChatCompletionTool[] = [{
  type: "function",
  function: {
    name: "getWeather",
    description: "Current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
}];

const handlers: Record<string, (args: any) => Promise<unknown>> = {
  getWeather: async ({ city }: { city: string }) => ({ city, temperatureC: 21, conditions: "sunny" }),
};

export async function run(question: string, maxTurns = 5): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [{ role: "user", content: question }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.chat.completions.create({ model: "gpt-4.1-mini", messages, tools });
    const message = response.choices[0].message;
    if (!message.tool_calls?.length) return message.content ?? "";
    messages.push(message);
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      let result: unknown;
      try {
        result = await handlers[call.function.name](JSON.parse(call.function.arguments || "{}"));
      } catch (error) {
        result = { error: String(error) };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error("Stopped after too many tool calls");
}
`
  },
  {
    id: "ts-express-sse", title: "Streaming endpoint (Express + SSE)", category: "Serving", language: "typescript",
    description: "Proxy streamed tokens to the browser; the key stays on the server.",
    install: "npm install express openai && npm install -D @types/express",
    code: `import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());
const client = new OpenAI();

app.post("/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  try {
    const stream = await client.chat.completions.create(
      { model: "gpt-4.1-mini", messages: [{ role: "user", content: String(req.body.message ?? "") }], stream: true },
      { signal: controller.signal },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) res.write(\`data: \${JSON.stringify(delta)}\\n\\n\`);
    }
    res.write("data: [DONE]\\n\\n");
  } catch (error) {
    if (!controller.signal.aborted) res.write(\`event: error\\ndata: \${JSON.stringify(String(error))}\\n\\n\`);
  } finally {
    res.end();
  }
});

app.listen(3000, () => console.log("http://localhost:3000"));
`
  },
  {
    id: "ts-embeddings-search", title: "Embed and search (TypeScript)", category: "Embeddings & search", language: "typescript",
    description: "In-memory semantic search with cosine similarity.",
    install: "npm install openai",
    code: `import OpenAI from "openai";

const client = new OpenAI();
const MODEL = "text-embedding-3-small";

export async function embed(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 256) {
    const response = await client.embeddings.create({ model: MODEL, input: texts.slice(i, i + 256) });
    vectors.push(...response.data.map(item => item.embedding));
  }
  return vectors;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function search(query: string, docs: string[], docVectors: number[][], k = 3) {
  const [q] = await embed([query]);
  return docVectors
    .map((vector, index) => ({ score: cosine(q, vector), doc: docs[index] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
`
  },
  {
    id: "ts-retry", title: "Retry with exponential backoff", category: "LLM APIs", language: "typescript",
    description: "Generic retry wrapper for any flaky API call (respects Retry-After).",
    install: "",
    code: `export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 5, baseMs = 500, maxMs = 20_000 } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status: number | undefined = error?.status ?? error?.response?.status;
      const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt >= retries) throw error;
      const retryAfter = Number(error?.headers?.["retry-after"] ?? error?.response?.headers?.["retry-after"]);
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt) * (0.5 + Math.random() / 2);
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : backoff));
    }
  }
}
`
  }
];
