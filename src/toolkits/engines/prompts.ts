import { estimateTokens } from "./models";

/**
 * Prompt templates and rendering. Templates use {{variable}} placeholders; a
 * placeholder may carry a default: {{language|TypeScript}}.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  category: "Coding" | "Writing" | "Extraction" | "RAG" | "Agents" | "Custom";
  description: string;
  system: string;
  user: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "code-review", name: "Code review", category: "Coding",
    description: "Review a change for bugs, security issues and maintainability.",
    system: "You are a senior {{language|TypeScript}} engineer doing a code review. Be specific and concise. Only report real problems; do not restate what the code does.",
    user: "Review the following code. For each issue give: severity (high/medium/low), the line or snippet, why it is a problem, and a concrete fix.\n\n```{{language|TypeScript}}\n{{code}}\n```"
  },
  {
    id: "explain-error", name: "Explain an error", category: "Coding",
    description: "Diagnose an error message or stack trace.",
    system: "You are a debugging assistant. Explain root causes, not symptoms.",
    user: "I got this error while {{context|running the app}}:\n\n```\n{{error}}\n```\n\nRelevant code:\n\n```\n{{code}}\n```\n\nExplain the most likely cause, how to confirm it, and the fix."
  },
  {
    id: "unit-tests", name: "Write unit tests", category: "Coding",
    description: "Generate tests including edge cases.",
    system: "You write thorough, idiomatic {{framework|Jest}} tests. Cover edge cases and failure paths. Do not test implementation details.",
    user: "Write unit tests for this code:\n\n```\n{{code}}\n```\n\nInclude: normal cases, boundary values, invalid input and error handling. Return only the test file."
  },
  {
    id: "commit-message", name: "Commit message", category: "Coding",
    description: "Conventional commit message from a diff.",
    system: "You write commit messages in the Conventional Commits format: type(scope): summary in the imperative, max 72 characters, then a short body explaining why.",
    user: "Write a commit message for this diff:\n\n```diff\n{{diff}}\n```"
  },
  {
    id: "sql-from-question", name: "SQL from a question", category: "Coding",
    description: "Turn a question into SQL for a given schema.",
    system: "You translate questions into correct {{dialect|PostgreSQL}} SQL. Use only tables and columns from the schema. If the question cannot be answered from the schema, say so instead of guessing.",
    user: "Schema:\n```sql\n{{schema}}\n```\n\nQuestion: {{question}}\n\nReturn only the SQL query."
  },
  {
    id: "summarize", name: "Summarize", category: "Writing",
    description: "Summary with a target length and audience.",
    system: "You summarize documents faithfully. Never add information that is not in the source.",
    user: "Summarize the text below for {{audience|a technical reader}} in at most {{length|5 bullet points}}.\n\n<document>\n{{text}}\n</document>"
  },
  {
    id: "extract-json", name: "Structured extraction (JSON)", category: "Extraction",
    description: "Extract fields as JSON matching a schema.",
    system: "You extract information into JSON. Output only valid JSON that matches the schema exactly. Use null for values that are not present; never invent values.",
    user: "JSON schema:\n```json\n{{schema}}\n```\n\nText:\n<text>\n{{text}}\n</text>"
  },
  {
    id: "classify", name: "Classification", category: "Extraction",
    description: "Classify text into fixed labels with a reason.",
    system: "You are a classifier. Choose exactly one label from: {{labels|bug, feature request, question, other}}. Respond as JSON: {\"label\": string, \"confidence\": number between 0 and 1, \"reason\": string}.",
    user: "Classify:\n<text>\n{{text}}\n</text>"
  },
  {
    id: "rag-answer", name: "Grounded answer with citations", category: "RAG",
    description: "Answer only from retrieved context, cite sources, refuse when unsupported.",
    system: "You answer questions using only the provided context. Cite the source id in square brackets after each claim, e.g. [doc-2]. If the context does not contain the answer, reply exactly: \"I don't know based on the provided documents.\" Do not use outside knowledge.",
    user: "Context:\n{{context}}\n\nQuestion: {{question}}"
  },
  {
    id: "rag-condense", name: "Condense follow-up question", category: "RAG",
    description: "Rewrite a follow-up into a standalone search query (chat RAG).",
    system: "You rewrite follow-up questions into standalone questions for a search engine. Keep all constraints and entities. Output only the rewritten question.",
    user: "Conversation so far:\n{{history}}\n\nFollow-up question: {{question}}\n\nStandalone question:"
  },
  {
    id: "rag-multi-query", name: "Query expansion (multi-query)", category: "RAG",
    description: "Generate alternative phrasings to improve retrieval recall.",
    system: "You generate search queries. Produce {{count|3}} different phrasings of the user's question that could retrieve relevant documents, one per line, no numbering.",
    user: "{{question}}"
  },
  {
    id: "rag-hyde", name: "HyDE hypothetical document", category: "RAG",
    description: "Write a hypothetical answer passage to embed for retrieval.",
    system: "Write a short, factual-sounding passage (about {{words|120}} words) that would answer the question, in the style of {{source|technical documentation}}. It is used only for retrieval, so specificity matters more than accuracy.",
    user: "{{question}}"
  },
  {
    id: "agent-tools", name: "Tool-using agent system prompt", category: "Agents",
    description: "System prompt for an agent that calls tools safely.",
    system: "You are {{role|a support agent for Acme}}. You can call tools to look up information and take actions.\n\nRules:\n- Use a tool whenever the answer depends on live data; never guess values a tool could return.\n- Before any action that changes data ({{destructive_actions|refunds, cancellations}}), confirm with the user.\n- If a tool fails, explain what happened and what the user can do next.\n- Keep answers short and in plain language.",
    user: "{{message}}"
  }
];

const VARIABLE = /\{\{\s*([A-Za-z_][\w-]*)\s*(?:\|([^}]*))?\}\}/g;

export interface TemplateVariable {
  name: string;
  defaultValue?: string;
}

export function templateVariables(...texts: string[]): TemplateVariable[] {
  const found = new Map<string, TemplateVariable>();
  for (const text of texts) {
    let match: RegExpExecArray | null;
    VARIABLE.lastIndex = 0;
    while ((match = VARIABLE.exec(text)) !== null) {
      const existing = found.get(match[1]);
      if (!existing) found.set(match[1], { name: match[1], defaultValue: match[2]?.trim() });
      else if (existing.defaultValue === undefined && match[2] !== undefined) existing.defaultValue = match[2].trim();
    }
  }
  return [...found.values()];
}

/**
 * Parses variable values: JSON object, or `name: value` / `name = value`
 * lines. A value may span lines until the next `name:` line.
 */
export function parseVariableValues(raw: string): Record<string, string> {
  const text = raw.trim();
  if (!text) return {};
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Variables JSON must be an object.");
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
  }
  const values: Record<string, string> = {};
  let current: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*)\s*[:=]\s?(.*)$/.exec(line);
    if (match) {
      current = match[1];
      values[current] = match[2];
    } else if (current) {
      values[current] += `\n${line}`;
    }
  }
  for (const key of Object.keys(values)) values[key] = values[key].replace(/\s+$/, "");
  return values;
}

export interface RenderedPrompt {
  system: string;
  user: string;
  missing: string[];
  usedDefaults: string[];
}

export function renderPrompt(system: string, user: string, values: Record<string, string>): RenderedPrompt {
  const missing = new Set<string>();
  const usedDefaults = new Set<string>();
  const fill = (text: string) => text.replace(VARIABLE, (whole, name: string, fallback: string | undefined) => {
    const value = values[name];
    if (value !== undefined && value !== "") return value;
    if (fallback !== undefined) {
      usedDefaults.add(name);
      return fallback.trim();
    }
    missing.add(name);
    return whole;
  });
  return { system: fill(system), user: fill(user), missing: [...missing], usedDefaults: [...usedDefaults] };
}

export type PromptFormat = "text" | "openai" | "anthropic" | "gemini";

export function formatPrompt(prompt: { system: string; user: string }, format: PromptFormat, model: string): { language: string; content: string } {
  const system = prompt.system.trim();
  const user = prompt.user;
  switch (format) {
    case "openai":
      return { language: "json", content: JSON.stringify({ model, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }] }, null, 2) };
    case "anthropic":
      return { language: "json", content: JSON.stringify({ model, max_tokens: 1024, ...(system ? { system } : {}), messages: [{ role: "user", content: user }] }, null, 2) };
    case "gemini":
      return { language: "json", content: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: [{ role: "user", parts: [{ text: user }] }] }, null, 2) };
    default:
      return { language: "markdown", content: system ? `## System\n\n${system}\n\n## User\n\n${user}` : user };
  }
}

export function promptTokens(prompt: { system: string; user: string }): number {
  return estimateTokens(prompt.system) + estimateTokens(prompt.user) + 8; // message framing overhead
}

/** Quick quality checks developers usually miss. */
export function lintPrompt(prompt: { system: string; user: string }): string[] {
  const notes: string[] = [];
  const all = `${prompt.system}\n${prompt.user}`;
  if (!prompt.system.trim()) notes.push("No system prompt: put stable instructions (role, rules, output format) in the system message so they are cached and harder to override.");
  if (/json/i.test(all) && !/schema|\{\s*"/.test(all)) notes.push("Asks for JSON without showing the shape: include a schema or example object, or use the provider's structured-output mode.");
  if (all.length > 400 && !/<[a-z_]+>|```|"""/i.test(prompt.user)) notes.push("Long user content without delimiters: wrap inserted documents in tags such as <document>…</document> so instructions and data are not confused.");
  if (/\b(always|never)\b/i.test(all) && (all.match(/\b(always|never)\b/gi) || []).length > 4) notes.push("Many absolute rules (always/never): models follow a few clear priorities better than many competing absolutes.");
  if (/\{\{[^}]+\}\}/.test(all)) notes.push("Unfilled placeholders remain in the prompt.");
  return notes;
}
