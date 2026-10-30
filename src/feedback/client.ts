/**
 * Validates the Feedback form and saves it to Supabase through its REST API.
 * No vscode dependency, so the rules stay unit-testable and the browser build
 * can use them too.
 */

export const FEEDBACK_CATEGORIES = [
  { id: "bug_report", label: "Bug report", titleHint: "What went wrong?", messageHint: "Steps to reproduce, what you expected and what happened instead." },
  { id: "feature_addition", label: "Feature addition", titleHint: "What should DevSnip Pro add?", messageHint: "What you want to do and how this would help." },
  { id: "feedback", label: "Feedback", titleHint: "What's on your mind?", messageHint: "Tell us what works well and what could be better." }
] as const;

/** Keep in step with the check constraints in supabase/migrations. */
export const FEEDBACK_LIMITS = { titleMin: 3, titleMax: 120, messageMin: 10, messageMax: 4000, emailMax: 254, metaMax: 40 };

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["id"];

export interface FeedbackForm {
  category: FeedbackCategory;
  title: string;
  message: string;
  email: string | null;
}

export interface FeedbackMeta {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
}

export interface FeedbackConfig {
  url: string;
  key: string;
}

export type FeedbackValidation =
  | { ok: true; form: FeedbackForm }
  | { ok: false; field: "category" | "title" | "message" | "email"; message: string };

export type FeedbackSendOutcome = "ok" | "network" | "rejected";

const SEND_TIMEOUT_MS = 15_000;

/** Postgres text cannot hold NUL or half an emoji, and the other control characters are only noise here. */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .trim();
}

/** Counts characters the way Postgres does, so an emoji is one and not two. */
function length(value: string): number {
  return Array.from(value).length;
}

export function validateFeedback(raw: unknown): FeedbackValidation {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const category = FEEDBACK_CATEGORIES.find(item => item.id === input.category)?.id;
  if (!category) return { ok: false, field: "category", message: "Choose a type." };

  const title = clean(input.title);
  if (length(title) < FEEDBACK_LIMITS.titleMin) return { ok: false, field: "title", message: "Add a short title." };
  if (length(title) > FEEDBACK_LIMITS.titleMax) return { ok: false, field: "title", message: `Keep the title to ${FEEDBACK_LIMITS.titleMax} characters.` };

  const message = clean(input.message);
  if (length(message) < FEEDBACK_LIMITS.messageMin) return { ok: false, field: "message", message: `Add a few more details (at least ${FEEDBACK_LIMITS.messageMin} characters).` };
  if (length(message) > FEEDBACK_LIMITS.messageMax) return { ok: false, field: "message", message: `Keep the details to ${FEEDBACK_LIMITS.messageMax} characters.` };

  const email = clean(input.email);
  if (email && (length(email) > FEEDBACK_LIMITS.emailMax || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, field: "email", message: "Enter a valid email, or leave it empty." };
  }
  return { ok: true, form: { category, title, message, email: email || null } };
}

/**
 * Reads feedback.config.json, written at package time. Only a publishable key
 * is accepted: a secret key bypasses row level security and must never ship.
 */
export function parseFeedbackConfig(raw: string | undefined): FeedbackConfig | undefined {
  if (!raw) return undefined;
  let parsed: { supabaseUrl?: unknown; supabaseKey?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const url = typeof parsed.supabaseUrl === "string" ? parsed.supabaseUrl.replace(/\/+$/, "") : "";
  const key = typeof parsed.supabaseKey === "string" ? parsed.supabaseKey : "";
  return /^https:\/\/[^\s/]+$/.test(url) && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) ? { url, key } : undefined;
}

export async function sendFeedback(
  config: FeedbackConfig,
  form: FeedbackForm,
  meta: FeedbackMeta,
  send: typeof fetch = fetch,
  timeoutMs = SEND_TIMEOUT_MS
): Promise<FeedbackSendOutcome> {
  const short = (value: string) => Array.from(value).slice(0, FEEDBACK_LIMITS.metaMax).join("");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(`${config.url}/rest/v1/feedback`, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        category: form.category,
        title: form.title,
        message: form.message,
        email: form.email,
        extension_version: short(meta.extensionVersion),
        vscode_version: short(meta.vscodeVersion),
        platform: short(meta.platform)
      }),
      signal: controller.signal
    });
    if (response.ok) return "ok";
    console.error(`DevSnip Pro: feedback was rejected (HTTP ${response.status}).`);
    return "rejected";
  } catch (error) {
    console.error("DevSnip Pro: feedback could not be sent.", error);
    return "network";
  } finally {
    clearTimeout(timer);
  }
}
