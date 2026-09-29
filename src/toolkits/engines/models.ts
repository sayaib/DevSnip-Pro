import { MODEL_PRICING } from "../../services/llm-providers";

/**
 * Model facts used by the AI and RAG tools: context window, output limit and
 * price. Prices come from MODEL_PRICING (the table the REST client uses too),
 * so there is one place to update them.
 */

export const PRICES_AS_OF = "2025";

export interface ModelInfo {
  id: string;
  provider: "OpenAI" | "Anthropic" | "Google" | "Open weights";
  label: string;
  contextWindow: number;
  maxOutput: number;
  /** USD per million tokens; undefined for self-hosted models. */
  input?: number;
  output?: number;
  notes?: string;
}

const CHAT_MODELS: Array<Omit<ModelInfo, "input" | "output">> = [
  { id: "gpt-5", provider: "OpenAI", label: "GPT-5", contextWindow: 400_000, maxOutput: 128_000, notes: "Reasoning model; reasoning tokens are billed as output." },
  { id: "gpt-5-mini", provider: "OpenAI", label: "GPT-5 mini", contextWindow: 400_000, maxOutput: 128_000 },
  { id: "gpt-5-nano", provider: "OpenAI", label: "GPT-5 nano", contextWindow: 400_000, maxOutput: 128_000 },
  { id: "gpt-4.1", provider: "OpenAI", label: "GPT-4.1", contextWindow: 1_047_576, maxOutput: 32_768 },
  { id: "gpt-4.1-mini", provider: "OpenAI", label: "GPT-4.1 mini", contextWindow: 1_047_576, maxOutput: 32_768 },
  { id: "gpt-4o", provider: "OpenAI", label: "GPT-4o", contextWindow: 128_000, maxOutput: 16_384 },
  { id: "gpt-4o-mini", provider: "OpenAI", label: "GPT-4o mini", contextWindow: 128_000, maxOutput: 16_384 },
  { id: "o3-mini", provider: "OpenAI", label: "o3-mini", contextWindow: 200_000, maxOutput: 100_000, notes: "Reasoning tokens are billed as output." },
  { id: "claude-opus-4-5", provider: "Anthropic", label: "Claude Opus 4.5", contextWindow: 200_000, maxOutput: 64_000 },
  { id: "claude-opus-4-1", provider: "Anthropic", label: "Claude Opus 4.1", contextWindow: 200_000, maxOutput: 32_000 },
  { id: "claude-sonnet-4-5", provider: "Anthropic", label: "Claude Sonnet 4.5", contextWindow: 200_000, maxOutput: 64_000 },
  { id: "claude-haiku-4-5", provider: "Anthropic", label: "Claude Haiku 4.5", contextWindow: 200_000, maxOutput: 64_000 },
  { id: "gemini-2.5-pro", provider: "Google", label: "Gemini 2.5 Pro", contextWindow: 1_048_576, maxOutput: 65_536, notes: "Higher price above 200K prompt tokens." },
  { id: "gemini-2.5-flash", provider: "Google", label: "Gemini 2.5 Flash", contextWindow: 1_048_576, maxOutput: 65_536 },
  { id: "gemini-2.0-flash", provider: "Google", label: "Gemini 2.0 Flash", contextWindow: 1_048_576, maxOutput: 8_192 },
  { id: "llama-3.1-8b", provider: "Open weights", label: "Llama 3.1 8B (self-hosted)", contextWindow: 131_072, maxOutput: 131_072, notes: "Cost is your hardware, not tokens." },
  { id: "llama-3.3-70b", provider: "Open weights", label: "Llama 3.3 70B (self-hosted)", contextWindow: 131_072, maxOutput: 131_072, notes: "Cost is your hardware, not tokens." },
  { id: "qwen2.5-7b", provider: "Open weights", label: "Qwen2.5 7B (self-hosted)", contextWindow: 131_072, maxOutput: 8_192, notes: "Cost is your hardware, not tokens." }
];

export const CHAT_MODEL_CATALOG: ModelInfo[] = CHAT_MODELS.map(model => ({
  ...model,
  input: MODEL_PRICING[model.id]?.input,
  output: MODEL_PRICING[model.id]?.output
}));

export interface EmbeddingModelInfo {
  id: string;
  provider: string;
  label: string;
  dimensions: number;
  maxInputTokens: number;
  /** USD per million tokens; undefined when self-hosted. */
  price?: number;
  normalized: boolean;
  notes?: string;
}

export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  { id: "text-embedding-3-small", provider: "OpenAI", label: "OpenAI text-embedding-3-small", dimensions: 1536, maxInputTokens: 8191, price: MODEL_PRICING["text-embedding-3-small"]?.input, normalized: true, notes: "Supports shortening with the dimensions parameter." },
  { id: "text-embedding-3-large", provider: "OpenAI", label: "OpenAI text-embedding-3-large", dimensions: 3072, maxInputTokens: 8191, price: MODEL_PRICING["text-embedding-3-large"]?.input, normalized: true, notes: "Supports shortening with the dimensions parameter." },
  { id: "embed-v4.0", provider: "Cohere", label: "Cohere embed-v4.0", dimensions: 1536, maxInputTokens: 128_000, price: 0.12, normalized: true, notes: "Set input_type to search_document / search_query." },
  { id: "gemini-embedding-001", provider: "Google", label: "Google gemini-embedding-001", dimensions: 3072, maxInputTokens: 2048, price: 0.15, normalized: false, notes: "Normalise vectors yourself when using fewer dimensions." },
  { id: "voyage-3.5", provider: "Voyage AI", label: "Voyage voyage-3.5", dimensions: 1024, maxInputTokens: 32_000, price: 0.06, normalized: true },
  { id: "nomic-embed-text", provider: "Open weights", label: "nomic-embed-text (Ollama)", dimensions: 768, maxInputTokens: 8192, normalized: false, notes: "Local via Ollama; prefix inputs with search_document: / search_query:." },
  { id: "bge-m3", provider: "Open weights", label: "BAAI bge-m3 (self-hosted)", dimensions: 1024, maxInputTokens: 8192, normalized: true },
  { id: "all-MiniLM-L6-v2", provider: "Open weights", label: "all-MiniLM-L6-v2 (sentence-transformers)", dimensions: 384, maxInputTokens: 256, normalized: true, notes: "Fast and small; inputs over 256 word pieces are truncated." }
];

export function findChatModel(id: string): ModelInfo | undefined {
  return CHAT_MODEL_CATALOG.find(model => model.id === id);
}

export function findEmbeddingModel(id: string): EmbeddingModelInfo | undefined {
  return EMBEDDING_MODELS.find(model => model.id === id);
}

export function chatModelOptions(): Array<{ value: string; label: string }> {
  return CHAT_MODEL_CATALOG.map(model => ({ value: model.id, label: `${model.label} - ${formatContext(model.contextWindow)} context` }));
}

export function embeddingModelOptions(): Array<{ value: string; label: string }> {
  return EMBEDDING_MODELS.map(model => ({ value: model.id, label: `${model.label} (${model.dimensions} dims)` }));
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

/**
 * Token estimate that tracks real BPE tokenizers (cl100k/o200k style) far
 * better than characters / 4, especially for code, numbers and non-Latin text:
 *  - a common word is usually one token; long or rare words split every ~6 letters;
 *  - digits are grouped in threes;
 *  - punctuation and symbols are mostly one token each;
 *  - CJK characters are roughly one token each; other non-Latin scripts ~2 characters per token.
 * Typically within 10-15% for English prose and code. Exact counts need the
 * provider's tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  const pieces = text.match(/ ?[A-Za-z]+|\d{1,3}|[぀-ヿ㐀-鿿가-힯]|[^\sA-Za-z\d぀-ヿ㐀-鿿가-힯]+|\s+/g) || [];
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) {
      // Runs of whitespace (indentation, blank lines) merge into few tokens.
      tokens += piece.includes("\n") ? Math.ceil(piece.length / 8) : piece.length > 1 ? 1 : 0;
      continue;
    }
    const word = piece.trim();
    if (/^[A-Za-z]+$/.test(word)) tokens += word.length <= 7 ? 1 : Math.ceil(word.length / 6);
    else if (/^\d+$/.test(word)) tokens += 1;
    else if (/^[぀-ヿ㐀-鿿가-힯]$/.test(word)) tokens += 1;
    else if (/^[\x21-\x7e]+$/.test(word)) tokens += Math.max(1, Math.ceil(word.length / 2));
    else tokens += Math.max(1, Math.ceil(word.length / 2));
  }
  return Math.max(1, tokens);
}
