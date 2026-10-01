/**
 * Turns driver values into JSON the webview can show and send back.
 *
 * Binary data and oversized text are replaced by a tagged marker
 * (`{ __dbv: ... }`) so the grid can label them and the editor can refuse to
 * overwrite a value it never received in full.
 */

import { LIMITS, Row } from "./types";

export const MARKER = "__dbv";

export type EncodedMarker =
  | { __dbv: "binary"; size: number; hex: string }
  | { __dbv: "truncated"; length: number; preview: string };

function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(value));
}

export function encodeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
      return value.length > LIMITS.maxCellChars ? { [MARKER]: "truncated", length: value.length, preview: value.slice(0, 2000) } : value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    case "object":
      break;
    default:
      return String(value);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (isBinary(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return { [MARKER]: "binary", size: bytes.length, hex: bytes.subarray(0, 32).toString("hex") };
  }
  if (depth > 20) return "[nested too deep]";
  if (Array.isArray(value)) return value.map(item => encodeValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = encodeValue(item, depth + 1);
  return out;
}

export function encodeRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[key] = encodeValue(value);
  return out;
}

/** Elapsed milliseconds since `start`, rounded for display. */
export function since(start: number): number {
  return Math.round(Date.now() - start);
}
