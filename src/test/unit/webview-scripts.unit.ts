import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { suite, test } from "./run-unit-tests";

/**
 * Guards against a whole class of bug that is invisible to the compiler.
 *
 * Webview scripts are written inside TypeScript template literals. An escape
 * such as `\n` is consumed by TypeScript, so what reaches the browser is a real
 * newline - and if that newline lands inside a JavaScript string literal, the
 * whole inline script fails to parse and every control in the panel stops
 * working at once. The compiler sees nothing wrong, because to it the script is
 * just a string.
 *
 * These tests parse what the browser will actually receive.
 */

const SOURCE_ROOT = path.resolve(__dirname, "../../../src");

/** Replaces `${...}` with a harmless literal, matching braces as it goes. */
function stripInterpolations(source: string): string {
  let out = "";
  for (let index = 0; index < source.length; index++) {
    // `\${` is an escaped dollar in a template literal, not an interpolation;
    // treating it as one would swallow the rest of a regular expression.
    const escaped = index > 0 && source[index - 1] === "\\";
    if (source[index] === "$" && source[index + 1] === "{" && !escaped) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "{") depth++;
        else if (source[index] === "}") depth--;
        index++;
      }
      index--;
      out += '"x"';
    } else {
      out += source[index];
    }
  }
  return out;
}

/** Applies the escape handling TypeScript performs on a template literal. */
function applyTemplateEscapes(source: string): string {
  const PLACEHOLDER = "@@DEVSNIP_BACKSLASH@@";
  return source
    .replace(/\\\\/g, PLACEHOLDER)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\`/g, "`")
    .replace(/\\\$/g, "$")
    // Any remaining escape is one the language does not recognise, and a
    // template literal simply drops its backslash.
    .replace(/\\(.)/g, "$1")
    .split(PLACEHOLDER)
    .join("\\");
}

function listSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : listSourceFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
  });
}

interface ScriptBlock {
  file: string;
  index: number;
  code: string;
}

/** Every inline webview script the extension embeds in a template literal. */
function collectScriptBlocks(): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  for (const file of listSourceFiles(SOURCE_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    const pattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = pattern.exec(source)) !== null) {
      const body = match[1];
      if (!body.trim()) continue;

      const code = applyTemplateEscapes(stripInterpolations(body));

      // Skip blocks that are not actually inline code in this file: a script
      // element whose body is entirely interpolated (the code lives in another
      // constant), and prose in a doc comment that happens to mention a script
      // tag. Both would otherwise be reported as broken when they are fine.
      const withoutPlaceholders = code.replace(/"x"/g, "").trim();
      if (!withoutPlaceholders) continue;
      if (!/function|=>|addEventListener|document\.|window\./.test(withoutPlaceholders)) continue;

      blocks.push({ file: path.relative(SOURCE_ROOT, file), index: index++, code });
    }
  }
  return blocks;
}

suite("webview inline scripts", () => {
  test("at least one inline script is found, so the scan is really running", () => {
    const blocks = collectScriptBlocks();
    assert.ok(blocks.length >= 5, `expected several inline scripts, found ${blocks.length}`);
  });

  test("every inline webview script parses as valid JavaScript", () => {
    const failures: string[] = [];
    for (const block of collectScriptBlocks()) {
      try {
        // Parse only. The script is never executed here.
        new Function(block.code);
      } catch (error) {
        failures.push(`${block.file} (script #${block.index + 1}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    assert.deepStrictEqual(
      failures,
      [],
      `these webview scripts would fail to parse in the browser, disabling every control in the panel:\n${failures.join("\n")}`
    );
  });

  test("the REST API Client renders a parseable script in both CSP modes", () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { getWebviewContent } = require("../../commands/api-test");
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The real page with real interpolated values, not a static approximation.
    for (const allowWebSockets of [false, true]) {
      const html = getWebviewContent([], allowWebSockets) as string;
      const match = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
      assert.ok(match, "no inline script found in the rendered client");
      assert.doesNotThrow(
        () => new Function(match![1]),
        `the API client script would not parse (allowWebSockets=${allowWebSockets}), which disables every button in the panel`
      );
    }
  });

  test("the WebSocket connect-src allowance appears only when it is granted", () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { getWebviewContent } = require("../../commands/api-test");
    /* eslint-enable @typescript-eslint/no-var-requires */

    const locked = getWebviewContent([], false) as string;
    const unlocked = getWebviewContent([], true) as string;
    assert.ok(!/connect-src/.test(locked), "a free user's page must not be allowed to open a socket");
    assert.ok(/connect-src ws: wss:/.test(unlocked), "an entitled user's page needs the allowance");
  });
});
