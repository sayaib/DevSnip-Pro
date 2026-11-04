import { ToolInputError } from "../types";

/** Bounded shell lexer shared with Docker conversion; values are never expanded or executed. */
export function tokenizeShell(input: string, shell: "auto" | "bash" | "cmd" | "powershell" = "auto"): string[] {
  const tokens: string[] = [];
  let value = "", active = false;
  const flush = () => { if (active) tokens.push(value); value = ""; active = false; };
  const continuation = (i: number) => input[i + 1] === "\n" ? 2 : input[i + 1] === "\r" && input[i + 2] === "\n" ? 3 : 0;
  for (let i = 0; i < input.length;) {
    const c = input[i];
    if ((c === "\\" && shell !== "cmd" && shell !== "powershell" || c === "^" && (shell === "auto" || shell === "cmd") || c === "`" && (shell === "auto" || shell === "powershell")) && continuation(i)) { i += continuation(i); continue; }
    if (/\s/.test(c)) { flush(); i++; continue; }
    active = true;
    if (c === "^" && input[i + 1] === '"' && (shell === "auto" || shell === "cmd")) {
      const decoded = readCmdEnvelope(input, i); value += decoded.value; i = decoded.end; continue;
    }
    if (c === "'" || c === "$" && input[i + 1] === "'" && shell !== "cmd" && shell !== "powershell") {
      const ansi = c === "$";
      i += ansi ? 2 : 1;
      let closed = false;
      while (i < input.length) {
        if (input[i] === "'") {
          if (shell === "powershell" && input[i + 1] === "'") { value += "'"; i += 2; continue; }
          i++; closed = true; break;
        }
        if (ansi && input[i] === "\\" && i + 1 < input.length) {
          const escape = input[++i], map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", e: "\x1b", "0": "\0", "\\": "\\", "'": "'", '"': '"' };
          const digits = escape === "x" ? 2 : escape === "u" ? 4 : 0;
          const code = input.slice(i + 1, i + 1 + digits);
          if (digits && new RegExp(`^[a-fA-F0-9]{${digits}}$`).test(code)) { value += String.fromCharCode(parseInt(code, 16)); i += digits + 1; }
          else { value += map[escape] ?? "\\" + escape; i++; }
        } else value += input[i++];
      }
      if (!closed) throw new ToolInputError("Unclosed single quote in the command.");
    } else if (c === '"') {
      i++; let closed = false;
      while (i < input.length) {
        if (input[i] === '"') { i++; closed = true; break; }
        if (input[i] === "\\" && shell !== "cmd" && shell !== "powershell" && /["\\$`\r\n]/.test(input[i + 1] ?? "")) {
          if (continuation(i)) i += continuation(i); else { value += input[i + 1]; i += 2; }
        } else if (input[i] === "^" && input[i + 1] === '"' && (shell === "cmd" || shell === "auto")) { value += '"'; i += 2; }
        else if (input[i] === "`" && shell === "powershell" && i + 1 < input.length) { const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0" }; value += escapes[input[i + 1]] ?? input[i + 1]; i += 2; }
        else value += input[i++];
      }
      if (!closed) throw new ToolInputError("Unclosed double quote in the command.");
    } else if (c === "\\" && shell !== "cmd" && shell !== "powershell" && i + 1 < input.length || c === "^" && (shell === "auto" || shell === "cmd") && /[\^&|<>"]/.test(input[i + 1] ?? "") || c === "`" && shell === "powershell" && i + 1 < input.length) { value += input[i + 1]; i += 2; }
    else { value += c; i++; }
  }
  flush();
  return tokens;
}

/** Decode the caret-wrapped argv tokens emitted by browser Copy as cURL (cmd). */
export function readCmdEnvelope(input: string, start: number): { value: string; end: number } {
  let encoded = "", i = start + 2;
  for (; i < input.length;) {
    if (input[i] === "^" && input[i + 1] === '"') {
      let slashes = 0;
      for (let j = encoded.length - 1; j >= 0 && encoded[j] === "\\"; j--) slashes++;
      if (slashes % 2 === 0) {
        let value = "";
        for (let k = 0; k < encoded.length; k++) {
          if (encoded[k] === "\\" && /[\\"]/.test(encoded[k + 1] ?? "")) value += encoded[++k];
          else value += encoded[k];
        }
        return { value, end: i + 2 };
      }
    }
    if (input[i] === "^") {
      if (input[i + 1] === "\n") { i += 2; continue; }
      if (input[i + 1] === "\r" && input[i + 2] === "\n") { i += 3; continue; }
      if (i + 1 < input.length) { encoded += input[i + 1]; i += 2; continue; }
    }
    encoded += input[i++];
  }
  throw new ToolInputError("Unclosed browser cURL cmd quote (^\").");
}
