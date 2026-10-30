#!/usr/bin/env node
/**
 * Writes feedback.config.json into the package at build time, so the Feedback
 * form in Milestones & Points knows where to save.
 *
 * SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY come from `.env.posthog` or from
 * environment variables, which take precedence. Without them the file is
 * removed and the form says feedback is unavailable in this build.
 *
 * Only a publishable key (sb_publishable_) is accepted. A secret key bypasses
 * row level security and must never ship inside an extension.
 */
const fs = require("fs");
const path = require("path");
const { loadPostHogEnv } = require("./load-env");

loadPostHogEnv();

const target = path.join(__dirname, "..", "feedback.config.json");
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();

if (!url || !key) {
  fs.rmSync(target, { force: true });
  console.log("feedback: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set; building without the Feedback backend.");
  process.exit(0);
}
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
  console.error("feedback: SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...). Never use a secret key here.");
  process.exit(1);
}
if (!/^https:\/\/[^\s/]+$/.test(url)) {
  console.error("feedback: SUPABASE_URL must be an https URL, e.g. https://your-project.supabase.co.");
  process.exit(1);
}
fs.writeFileSync(target, JSON.stringify({ supabaseUrl: url, supabaseKey: key }, null, 2) + "\n");
console.log(`feedback: wrote feedback.config.json for ${url}.`);
