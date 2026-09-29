import { ToolInputError } from "../types";

// ---------------------------------------------------------------------------
// Dataset split
// ---------------------------------------------------------------------------

/** Splits `total` by percentages so the parts always add up exactly (largest remainder). */
export function allocate(total: number, percents: number[]): number[] {
  const raw = percents.map(p => (total * p) / 100);
  const floors = raw.map(Math.floor);
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac);
  for (const { index } of order) {
    if (remaining <= 0) break;
    floors[index]++;
    remaining--;
  }
  return floors;
}

export interface SplitResult {
  counts: { train: number; val: number; test: number };
  perClass: Array<{ label: string; total: number; train: number; val: number; test: number }>;
  warnings: string[];
}

export function parseClassCounts(text: string): Array<{ label: string; count: number }> {
  const entries = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  return entries.map(entry => {
    const match = /^(.+?)\s*[:=]\s*([\d_,.]+)$/.exec(entry);
    if (!match) throw new ToolInputError(`Could not read "${entry}". Use label: count, e.g. cat: 1200`);
    const count = Number(match[2].replace(/[_,]/g, ""));
    if (!Number.isInteger(count) || count < 0) throw new ToolInputError(`"${entry}" needs a whole, non-negative count.`);
    return { label: match[1].trim(), count };
  });
}

export function splitDataset(total: number, train: number, val: number, classes: Array<{ label: string; count: number }>): SplitResult {
  if (train < 0 || val < 0 || train + val > 100) throw new ToolInputError("Train + validation must be between 0% and 100%.");
  const test = 100 - train - val;
  const warnings: string[] = [];
  const perClass = classes.map(({ label, count }) => {
    const [a, b, c] = allocate(count, [train, val, test]);
    if ((val > 0 && b === 0) || (test > 0 && c === 0)) warnings.push(`Class "${label}" has too few samples (${count}) to appear in every split.`);
    return { label, total: count, train: a, val: b, test: c };
  });
  const effectiveTotal = classes.length ? classes.reduce((sum, c) => sum + c.count, 0) : total;
  const [tr, va, te] = classes.length
    ? [perClass.reduce((s, c) => s + c.train, 0), perClass.reduce((s, c) => s + c.val, 0), perClass.reduce((s, c) => s + c.test, 0)]
    : allocate(effectiveTotal, [train, val, test]);
  if (classes.length > 1) {
    const counts = classes.map(c => c.count);
    const ratio = Math.max(...counts) / Math.max(1, Math.min(...counts));
    if (ratio >= 5) warnings.push(`Classes are imbalanced (${ratio.toFixed(1)}:1). Stratify the split, and prefer F1 / PR-AUC over accuracy.`);
  }
  if (va > 0 && va < 100) warnings.push(`Validation has only ${va} samples; metric noise will be high (±${(100 / Math.sqrt(va)).toFixed(0)}% relative). Consider k-fold cross-validation.`);
  if (te > 0 && te < 100) warnings.push(`Test has only ${te} samples; reported scores will be unreliable.`);
  return { counts: { train: tr, val: va, test: te }, perClass, warnings };
}

export function splitCode(train: number, val: number, stratify: boolean, seed: number): string {
  const test = 100 - train - val;
  const tempShare = (val + test) / 100;
  const valShareOfTemp = val + test > 0 ? val / (val + test) : 0;
  return `from sklearn.model_selection import train_test_split

# X: features, y: labels
X_train, X_temp, y_train, y_temp = train_test_split(
    X, y, test_size=${tempShare.toFixed(4)}, random_state=${seed}${stratify ? ", stratify=y" : ""}
)
X_val, X_test, y_val, y_test = train_test_split(
    X_temp, y_temp, test_size=${(1 - valShareOfTemp).toFixed(4)}, random_state=${seed}${stratify ? ", stratify=y_temp" : ""}
)
print(len(X_train), len(X_val), len(X_test))  # ~${train}% / ${val}% / ${test}%
`;
}

// ---------------------------------------------------------------------------
// Learning-rate schedules
// ---------------------------------------------------------------------------

export type Schedule = "constant" | "step" | "exponential" | "cosine" | "warmup-cosine" | "warmup-linear" | "one-cycle";

export interface ScheduleInput {
  schedule: Schedule;
  baseLr: number;
  minLr: number;
  steps: number;
  warmupSteps: number;
  stepSize: number;
  gamma: number;
}

export function lrAt(step: number, s: ScheduleInput): number {
  const { baseLr, minLr, steps, warmupSteps } = s;
  switch (s.schedule) {
    case "constant": return baseLr;
    case "step": return baseLr * Math.pow(s.gamma, Math.floor(step / Math.max(1, s.stepSize)));
    case "exponential": return baseLr * Math.pow(s.gamma, step);
    case "cosine": return minLr + 0.5 * (baseLr - minLr) * (1 + Math.cos(Math.PI * Math.min(step, steps) / Math.max(1, steps)));
    case "warmup-cosine": {
      if (step < warmupSteps) return baseLr * (step + 1) / Math.max(1, warmupSteps);
      const progress = (step - warmupSteps) / Math.max(1, steps - warmupSteps);
      return minLr + 0.5 * (baseLr - minLr) * (1 + Math.cos(Math.PI * Math.min(1, progress)));
    }
    case "warmup-linear": {
      if (step < warmupSteps) return baseLr * (step + 1) / Math.max(1, warmupSteps);
      return Math.max(minLr, baseLr * (1 - (step - warmupSteps) / Math.max(1, steps - warmupSteps)));
    }
    case "one-cycle": {
      const peak = Math.max(1, Math.round(steps * 0.3));
      if (step <= peak) return baseLr / 25 + (baseLr - baseLr / 25) * (0.5 - 0.5 * Math.cos(Math.PI * step / peak));
      const progress = (step - peak) / Math.max(1, steps - peak);
      const end = baseLr / 25 / 1e4;
      return end + (baseLr - end) * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, progress)));
    }
  }
}

export function scheduleSeries(s: ScheduleInput): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const stride = Math.max(1, Math.floor(s.steps / 200));
  for (let step = 0; step <= s.steps; step += stride) points.push([step, lrAt(step, s)]);
  if (points[points.length - 1][0] !== s.steps) points.push([s.steps, lrAt(s.steps, s)]);
  return points;
}

export function scheduleCode(s: ScheduleInput): string {
  const header = `import math\nimport torch\n\n# model = ...\noptimizer = torch.optim.AdamW(model.parameters(), lr=${s.baseLr})\n`;
  switch (s.schedule) {
    case "constant": return `${header}scheduler = torch.optim.lr_scheduler.ConstantLR(optimizer, factor=1.0, total_iters=0)\n`;
    case "step": return `${header}scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=${s.stepSize}, gamma=${s.gamma})\n`;
    case "exponential": return `${header}scheduler = torch.optim.lr_scheduler.ExponentialLR(optimizer, gamma=${s.gamma})\n`;
    case "cosine": return `${header}scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=${s.steps}, eta_min=${s.minLr})\n`;
    case "one-cycle": return `${header}scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=${s.baseLr}, total_steps=${s.steps + 1}, pct_start=0.3)\n`;
    case "warmup-linear":
    case "warmup-cosine": {
      const decay = s.schedule === "warmup-cosine"
        ? `    progress = min(1.0, (step - WARMUP) / max(1, TOTAL - WARMUP))\n    return MIN_RATIO + 0.5 * (1 - MIN_RATIO) * (1 + math.cos(math.pi * progress))`
        : `    return max(MIN_RATIO, 1 - (step - WARMUP) / max(1, TOTAL - WARMUP))`;
      return `${header}WARMUP, TOTAL, MIN_RATIO = ${s.warmupSteps}, ${s.steps}, ${(s.minLr / s.baseLr).toPrecision(3)}\n\n\ndef lr_lambda(step: int) -> float:\n    if step < WARMUP:\n        return (step + 1) / max(1, WARMUP)\n${decay}\n\n\nscheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)\n# Call scheduler.step() after every optimizer.step().\n`;
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation metrics
// ---------------------------------------------------------------------------

export function parseNumbers(text: string): number[] {
  const values = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (values.some(v => !Number.isFinite(v))) throw new ToolInputError("Only numbers separated by commas, spaces or new lines are allowed.");
  return values;
}

export interface ClassificationMetrics {
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  weightedF1: number;
  total: number;
  perClass: Array<{ label: string; precision: number; recall: number; f1: number; support: number }>;
}

export function classificationMetrics(matrixText: string, labelsText: string): ClassificationMetrics {
  const matrix = matrixText.trim().split(/\r?\n/).filter(line => line.trim()).map(parseNumbers);
  const n = matrix.length;
  if (!n || matrix.some(row => row.length !== n)) throw new ToolInputError("The confusion matrix must be square: one row per actual class, one column per predicted class.");
  if (matrix.some(row => row.some(v => v < 0 || !Number.isInteger(v)))) throw new ToolInputError("Confusion-matrix cells must be non-negative whole numbers.");
  const labels = labelsText.trim() ? labelsText.split(",").map(s => s.trim()) : [];
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  if (!total) throw new ToolInputError("The confusion matrix is all zeros.");
  let correct = 0;
  const perClass = matrix.map((row, i) => {
    const tp = row[i];
    correct += tp;
    const support = row.reduce((a, b) => a + b, 0);
    const predicted = matrix.reduce((sum, r) => sum + r[i], 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label: labels[i] || `class ${i}`, precision, recall, f1, support };
  });
  const mean = (key: "precision" | "recall" | "f1") => perClass.reduce((s, c) => s + c[key], 0) / n;
  return {
    accuracy: correct / total,
    macroPrecision: mean("precision"),
    macroRecall: mean("recall"),
    macroF1: mean("f1"),
    weightedF1: perClass.reduce((s, c) => s + c.f1 * c.support, 0) / total,
    total,
    perClass
  };
}

export function regressionMetrics(actualText: string, predictedText: string): { mae: number; rmse: number; r2: number; mape?: number; n: number } {
  const actual = parseNumbers(actualText);
  const predicted = parseNumbers(predictedText);
  if (!actual.length) throw new ToolInputError("Enter the actual values.");
  if (actual.length !== predicted.length) throw new ToolInputError(`Actual has ${actual.length} values but predicted has ${predicted.length}.`);
  const n = actual.length;
  const mean = actual.reduce((a, b) => a + b, 0) / n;
  let ae = 0, se = 0, ss = 0, ape = 0, apeCount = 0;
  for (let i = 0; i < n; i++) {
    const error = actual[i] - predicted[i];
    ae += Math.abs(error);
    se += error * error;
    ss += (actual[i] - mean) ** 2;
    if (actual[i] !== 0) { ape += Math.abs(error / actual[i]); apeCount++; }
  }
  return { mae: ae / n, rmse: Math.sqrt(se / n), r2: ss ? 1 - se / ss : se === 0 ? 1 : 0, mape: apeCount ? (ape / apeCount) * 100 : undefined, n };
}

// ---------------------------------------------------------------------------
// Model card and experiment log
// ---------------------------------------------------------------------------

export interface ModelCardInput {
  name: string;
  baseModel: string;
  task: string;
  license: string;
  language: string;
  datasets: string;
  metrics: string;
  intendedUse: string;
  limitations: string;
  author: string;
}

export function modelCard(c: ModelCardInput): string {
  const list = (text: string) => text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const metricRows = list(c.metrics).map(entry => {
    const [name, value] = entry.split(/[:=]/).map(s => s.trim());
    return `| ${name} | ${value ?? ""} |`;
  });
  const yamlList = (key: string, items: string[]) => items.length ? `${key}:\n${items.map(i => `  - ${JSON.stringify(i)}`).join("\n")}\n` : "";
  return `---
${c.license ? `license: ${c.license}\n` : ""}${yamlList("language", list(c.language))}${c.baseModel ? `base_model: ${JSON.stringify(c.baseModel)}\n` : ""}${c.task ? `pipeline_tag: ${c.task}\n` : ""}${yamlList("datasets", list(c.datasets))}---

# ${c.name || "Model name"}

${c.baseModel ? `Fine-tuned from [${c.baseModel}](https://huggingface.co/${c.baseModel}) for **${c.task || "your task"}**.` : `A model for **${c.task || "your task"}**.`}

## Intended use

${c.intendedUse || "Describe who should use the model and for what."}

### Out-of-scope use

Describe uses the model was not designed or evaluated for.

## Training data

${list(c.datasets).map(d => `- ${d}`).join("\n") || "- Describe the datasets, their size and how they were split."}

## Evaluation

| Metric | Value |
| --- | --- |
${metricRows.join("\n") || "| - | - |"}

## Limitations and bias

${c.limitations || "Describe known failure modes, biases in the data, and groups the model was not evaluated on."}

## How to use

\`\`\`python
from transformers import pipeline

pipe = pipeline(${JSON.stringify(c.task || "text-classification")}, model=${JSON.stringify(c.name || "your-org/your-model")})
print(pipe("Example input"))
\`\`\`

## Authors

${c.author || "Your name / team"}
`;
}

export function experimentRecord(input: { name: string; model: string; params: string; metrics: string; notes: string; tags: string }, now: Date): Record<string, unknown> {
  const parsePairs = (text: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const entry of text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)) {
      const match = /^([^:=]+)[:=]\s*(.*)$/.exec(entry);
      if (!match) throw new ToolInputError(`Could not read "${entry}". Use key: value, e.g. lr: 3e-4`);
      const raw = match[2].trim();
      const number = Number(raw);
      out[match[1].trim()] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(number) ? number : raw;
    }
    return out;
  };
  return {
    id: `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${(input.name || "run").replace(/[^\w-]+/g, "-").toLowerCase()}`,
    timestamp: now.toISOString(),
    name: input.name,
    model: input.model || undefined,
    params: parsePairs(input.params),
    metrics: parsePairs(input.metrics),
    tags: input.tags.split(",").map(t => t.trim()).filter(Boolean),
    notes: input.notes || undefined
  };
}
