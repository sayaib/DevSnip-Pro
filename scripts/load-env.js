/**
 * Loads PostHog credentials from `.env.posthog` in the repository root, if it
 * exists. The file is git-ignored and excluded from the packaged extension.
 *
 * Variables already set in the environment win, so CI secrets and one-off
 * overrides on the command line keep working. No dependency: the format is
 * plain `KEY=value` lines, with `#` comments and optional quotes.
 */
const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", ".env.posthog");

function loadPostHogEnv(file = ENV_FILE, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim(); // trailing comment on an unquoted value
    if (env[match[1]] === undefined || env[match[1]] === "") env[match[1]] = value;
  }
  return true;
}

module.exports = { loadPostHogEnv, ENV_FILE };
