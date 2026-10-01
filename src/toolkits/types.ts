/**
 * The contract every toolkit tool implements.
 *
 * A tool is declarative: metadata, input fields and a `run` function. The
 * workbench webview renders the form, the host runs the tool, and the result
 * is rendered with the same actions everywhere (copy, insert at cursor, save
 * to workspace). Tools never touch VS Code directly - anything they need from
 * the environment comes through `ToolContext`, so every tool is unit-testable.
 */

import type { HubIcon } from "../utils/tool-hub";
import type { SectionId } from "./layout";

export type { SectionId };

/** `secret` renders as a password box and is never kept in the webview's saved state. */
export type FieldKind = "text" | "textarea" | "code" | "number" | "select" | "toggle" | "secret";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldSpec {
  id: string;
  label: string;
  kind: FieldKind;
  default?: string | number | boolean;
  placeholder?: string;
  /** One line under the field. */
  help?: string;
  options?: FieldOption[];
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Editor language for `code` fields (json, yaml, sql, ...). */
  language?: string;
  required?: boolean;
  /** Only shown (and only passed to run) when another field has one of these values. */
  showIf?: { field: string; equals: Array<string | boolean> };
  /** Offer "Use active editor" to fill this field from the current selection or file. */
  fromEditor?: boolean;
  /** Starts a titled group of fields (e.g. "Services", "Scaling") in long forms. */
  group?: string;
  /** Narrow fields sit side by side on wide screens. */
  width?: "narrow" | "wide";
}

export type Values = Record<string, string | number | boolean>;

export interface GeneratedFile {
  /** Workspace-relative path, forward slashes. */
  path: string;
  content: string;
  language?: string;
  /** "append" adds to the end of an existing file (logs, JSONL) instead of replacing it. */
  mode?: "create" | "append";
}

export type Output =
  | { kind: "code"; title: string; language: string; content: string; fileName?: string }
  | { kind: "text"; title: string; content: string }
  | { kind: "table"; title: string; columns: string[]; rows: Array<Array<string | number>> }
  | { kind: "files"; title: string; files: GeneratedFile[] }
  | { kind: "chart"; title: string; xLabel: string; yLabel: string; series: Array<{ name: string; points: Array<[number, number]> }> };

export type Tone = "good" | "warn" | "bad" | "neutral";

export interface ToolResult {
  /** Small headline numbers ("42 chunks", "3 errors"). */
  stats?: Array<{ label: string; value: string; tone?: Tone }>;
  /** Findings, warnings and explanations, shown above the outputs. */
  messages?: Array<{ kind: "info" | "success" | "warning" | "error"; text: string }>;
  outputs?: Output[];
  /** Field values to write back into the form (e.g. settings detected from the workspace). */
  setValues?: Values;
}

/** Environment access for tools that need it (all optional, all mockable). */
export interface ToolContext {
  workspace?: {
    name: string;
    exists(relativePath: string): Promise<boolean>;
    readFile(relativePath: string): Promise<string | undefined>;
    findFiles(glob: string, limit: number): Promise<string[]>;
  };
  /** Persistent per-user storage (VS Code global state). */
  storage?: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): Promise<void>;
  };
  network?: {
    isPortFree(port: number, host?: string): Promise<boolean>;
  };
  now?: () => Date;
}

export interface ToolExample {
  label: string;
  values: Values;
}

export interface ToolAction {
  id: string;
  label: string;
}

export interface ToolDefinition {
  /** Stable key. Its prefix names the module that defines the tool; where it is shown comes from layout.ts. */
  id: string;
  /**
   * Command id without the extension prefix. Replacements keep the id of the
   * tool they replace, so keybindings, points history and analytics carry over.
   */
  command: string;
  /** Stamped by the registry from layout.ts. */
  section: SectionId;
  /** Sub-group inside the section, stamped from layout.ts (empty for small sections). */
  category: string;
  title: string;
  /** One sentence shown in the list and at the top of the tool. */
  summary: string;
  /** Longer guidance shown collapsed under the title (plain text). */
  guide?: string;
  keywords?: string[];
  icon: HubIcon;
  fields: FieldSpec[];
  examples?: ToolExample[];
  /** Presets computed when the workbench opens (e.g. the user's saved templates). */
  dynamicExamples?(context: ToolContext): ToolExample[] | Promise<ToolExample[]>;
  /** Extra commands that open this tool with some fields preset (e.g. URL mode of the encoder). */
  aliases?: Array<{ command: string; values: Values }>;
  /** Talks to the network; shown with a badge so users know data leaves the machine. */
  network?: boolean;
  /** Label of the main button. */
  runLabel?: string;
  /** Re-run automatically (debounced) as inputs change; for cheap, pure tools. */
  live?: boolean;
  /** Extra buttons next to the main one; `run` receives the action id. */
  actions?: ToolAction[];
  run(values: Values, context: ToolContext, action?: string): Promise<ToolResult> | ToolResult;
}

/** What the webview receives: everything except the function. */
export type ToolDescriptor = Omit<ToolDefinition, "run" | "dynamicExamples">;

/** A tool as its module defines it; the registry adds `section` and `category` from layout.ts. */
export type ToolSpec = Omit<ToolDefinition, "section" | "category">;

export class ToolInputError extends Error {}

export function describe(tool: ToolDefinition): ToolDescriptor {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { run, dynamicExamples, ...rest } = tool;
  return rest;
}

// ---------------------------------------------------------------------------
// Value helpers: read form values without the `parseInt(x) || default` bug,
// which turned a deliberate 0 into the default.
// ---------------------------------------------------------------------------

export function str(values: Values, key: string, fallback = ""): string {
  const value = values[key];
  return value === undefined || value === null ? fallback : String(value);
}

export function num(values: Values, key: string, fallback: number, bounds: { min?: number; max?: number; integer?: boolean; label?: string } = {}): number {
  const raw = values[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[_,\s]/g, ""));
  const label = bounds.label ?? key;
  if (!Number.isFinite(value)) throw new ToolInputError(`${label} must be a number.`);
  if (bounds.integer && !Number.isInteger(value)) throw new ToolInputError(`${label} must be a whole number.`);
  if (bounds.min !== undefined && value < bounds.min) throw new ToolInputError(`${label} must be at least ${bounds.min}.`);
  if (bounds.max !== undefined && value > bounds.max) throw new ToolInputError(`${label} must be at most ${bounds.max}.`);
  return value;
}

export function bool(values: Values, key: string, fallback = false): boolean {
  const value = values[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function required(values: Values, key: string, label: string): string {
  const value = str(values, key).trim();
  if (!value) throw new ToolInputError(`${label} is required.`);
  return value;
}

export function fmtNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function fmtUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
