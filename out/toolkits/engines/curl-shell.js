"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCmdEnvelope = exports.tokenizeShell = void 0;
const types_1 = require("../types");
/** Bounded shell lexer shared with Docker conversion; values are never expanded or executed. */
function tokenizeShell(input, shell = "auto", comments = false) {
    const tokens = [];
    let value = "", active = false;
    const flush = () => { if (active)
        tokens.push(value); value = ""; active = false; };
    const continuation = (i) => input[i + 1] === "\n" ? 2 : input[i + 1] === "\r" && input[i + 2] === "\n" ? 3 : 0;
    for (let i = 0; i < input.length;) {
        const c = input[i];
        if ((c === "\\" && shell !== "cmd" && shell !== "powershell" || c === "^" && (shell === "auto" || shell === "cmd") || c === "`" && (shell === "auto" || shell === "powershell")) && continuation(i)) {
            i += continuation(i);
            continue;
        }
        if (/\s/.test(c)) {
            flush();
            i++;
            continue;
        }
        // A # that starts a word begins a comment in Bash and PowerShell (never inside a word, so URL fragments stay).
        if (comments && !active && c === "#" && shell !== "cmd") {
            while (i < input.length && input[i] !== "\n")
                i++;
            continue;
        }
        // Windows programs (including curl.exe) read \" as a literal quote: 2n backslashes + " = n backslashes and a quote toggle.
        if (shell === "cmd" && c === "\\") {
            const run = backslashRun(input, i);
            if (input[run.end] === '"') {
                active = true;
                value += "\\".repeat(Math.floor(run.count / 2)) + (run.count % 2 ? '"' : "");
                i = run.end + (run.count % 2);
                continue;
            }
        }
        active = true;
        if (c === "^" && input[i + 1] === '"' && (shell === "auto" || shell === "cmd")) {
            const decoded = readCmdEnvelope(input, i);
            value += decoded.value;
            i = decoded.end;
            continue;
        }
        if (c === "'" || c === "$" && input[i + 1] === "'" && shell !== "cmd" && shell !== "powershell") {
            const ansi = c === "$";
            i += ansi ? 2 : 1;
            let closed = false;
            while (i < input.length) {
                if (input[i] === "'") {
                    if (shell === "powershell" && input[i + 1] === "'") {
                        value += "'";
                        i += 2;
                        continue;
                    }
                    i++;
                    closed = true;
                    break;
                }
                if (ansi && input[i] === "\\" && i + 1 < input.length) {
                    const escape = input[++i], map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", e: "\x1b", "0": "\0", "\\": "\\", "'": "'", '"': '"' };
                    const digits = escape === "x" ? 2 : escape === "u" ? 4 : 0;
                    const code = input.slice(i + 1, i + 1 + digits);
                    if (digits && new RegExp(`^[a-fA-F0-9]{${digits}}$`).test(code)) {
                        value += String.fromCharCode(parseInt(code, 16));
                        i += digits + 1;
                    }
                    else {
                        value += map[escape] ?? "\\" + escape;
                        i++;
                    }
                }
                else
                    value += input[i++];
            }
            if (!closed)
                throw new types_1.ToolInputError("Unclosed single quote in the command.");
        }
        else if (c === '"') {
            i++;
            let closed = false;
            while (i < input.length) {
                if (shell === "cmd" && input[i] === "\\") {
                    const run = backslashRun(input, i);
                    if (input[run.end] === '"') {
                        value += "\\".repeat(Math.floor(run.count / 2));
                        i = run.end;
                        if (run.count % 2) {
                            value += '"';
                            i++;
                            continue;
                        }
                        continue;
                    }
                    value += input.slice(i, run.end);
                    i = run.end;
                    continue;
                }
                if (input[i] === '"') {
                    i++;
                    closed = true;
                    break;
                }
                if (input[i] === "\\" && shell !== "cmd" && shell !== "powershell" && /["\\$`\r\n]/.test(input[i + 1] ?? "")) {
                    if (continuation(i))
                        i += continuation(i);
                    else {
                        value += input[i + 1];
                        i += 2;
                    }
                }
                else if (input[i] === "^" && input[i + 1] === '"' && (shell === "cmd" || shell === "auto")) {
                    value += '"';
                    i += 2;
                }
                else if (input[i] === "`" && shell === "powershell" && i + 1 < input.length) {
                    const escapes = { n: "\n", r: "\r", t: "\t", "0": "\0" };
                    value += escapes[input[i + 1]] ?? input[i + 1];
                    i += 2;
                }
                else
                    value += input[i++];
            }
            if (!closed)
                throw new types_1.ToolInputError("Unclosed double quote in the command.");
        }
        else if (c === "\\" && shell !== "cmd" && shell !== "powershell" && i + 1 < input.length || c === "^" && (shell === "auto" || shell === "cmd") && /[\^&|<>"]/.test(input[i + 1] ?? "") || c === "`" && shell === "powershell" && i + 1 < input.length) {
            value += input[i + 1];
            i += 2;
        }
        else {
            value += c;
            i++;
        }
    }
    flush();
    return tokens;
}
exports.tokenizeShell = tokenizeShell;
function backslashRun(input, start) {
    let end = start;
    while (input[end] === "\\")
        end++;
    return { count: end - start, end };
}
/** Decode the caret-wrapped argv tokens emitted by browser Copy as cURL (cmd). */
function readCmdEnvelope(input, start) {
    let encoded = "", i = start + 2;
    for (; i < input.length;) {
        if (input[i] === "^" && input[i + 1] === '"') {
            let slashes = 0;
            for (let j = encoded.length - 1; j >= 0 && encoded[j] === "\\"; j--)
                slashes++;
            if (slashes % 2 === 0) {
                let value = "";
                for (let k = 0; k < encoded.length; k++) {
                    if (encoded[k] === "\\" && /[\\"]/.test(encoded[k + 1] ?? ""))
                        value += encoded[++k];
                    else
                        value += encoded[k];
                }
                return { value, end: i + 2 };
            }
        }
        if (input[i] === "^") {
            if (input[i + 1] === "\n") {
                i += 2;
                continue;
            }
            if (input[i + 1] === "\r" && input[i + 2] === "\n") {
                i += 3;
                continue;
            }
            if (i + 1 < input.length) {
                encoded += input[i + 1];
                i += 2;
                continue;
            }
        }
        encoded += input[i++];
    }
    throw new types_1.ToolInputError("Unclosed browser cURL cmd quote (^\").");
}
exports.readCmdEnvelope = readCmdEnvelope;
//# sourceMappingURL=curl-shell.js.map