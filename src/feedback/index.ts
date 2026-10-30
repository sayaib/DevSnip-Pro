import * as vscode from "vscode";
import { FEEDBACK_CATEGORIES, FEEDBACK_LIMITS, FeedbackConfig, parseFeedbackConfig, sendFeedback, validateFeedback } from "./client";

const CONFIG_FILE = "feedback.config.json";

/** What the page needs to draw the form, so the options and limits live in one place. */
export const FEEDBACK_FORM = { categories: FEEDBACK_CATEGORIES, limits: FEEDBACK_LIMITS };

export interface FeedbackResult {
  ok: boolean;
  field?: string;
  message: string;
}

async function readConfigFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    // Browser hosts can serve extension files over https with no file system behind them.
    if (vscode.env.uiKind !== vscode.UIKind.Web) throw error;
    const response = await fetch(uri.toString(true));
    return response.ok ? response.text() : undefined;
  }
}

async function loadConfig(context: vscode.ExtensionContext): Promise<FeedbackConfig | undefined> {
  try {
    return parseFeedbackConfig(await readConfigFile(vscode.Uri.joinPath(context.extensionUri, CONFIG_FILE)));
  } catch {
    return undefined;
  }
}

function platformName(): string {
  if (vscode.env.uiKind === vscode.UIKind.Web) return "web";
  return typeof process !== "undefined" ? process.platform : "unknown";
}

export async function submitFeedback(context: vscode.ExtensionContext, raw: unknown): Promise<FeedbackResult> {
  const checked = validateFeedback(raw);
  if (!checked.ok) return checked;

  const config = await loadConfig(context);
  if (!config) return { ok: false, message: "Feedback is not available in this build. Please open an issue on GitHub instead." };

  const outcome = await sendFeedback(config, checked.form, {
    extensionVersion: String(context.extension.packageJSON.version ?? ""),
    vscodeVersion: vscode.version,
    platform: platformName()
  });
  if (outcome === "ok") return { ok: true, message: "Thanks! We received your message and will get back to you shortly." };
  return {
    ok: false,
    message: outcome === "network"
      ? "Could not reach the server. Check your connection and try again."
      : "The server did not accept this. Please try again later."
  };
}
