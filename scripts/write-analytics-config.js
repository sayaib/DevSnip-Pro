#!/usr/bin/env node
/**
 * Writes analytics.config.json into the package at build time.
 *
 * Credentials come from `.env.posthog` (copy `.env.posthog.example`) or from
 * environment variables, which take precedence.
 *
 * The PostHog project key comes from the environment, never from the
 * repository, so forks and local builds do not send events to the official
 * project:
 *
 *   POSTHOG_PROJECT_API_KEY=phc_... POSTHOG_HOST=https://eu.i.posthog.com npm run package
 *
 * Without the variable the file is removed and the built extension has
 * analytics switched off entirely. Only a *project* key (phc_, write-only
 * ingestion) is accepted: a personal API key (phx_) can read your data and
 * must never ship inside an extension.
 */
const fs = require("fs");
const path = require("path");
const { loadPostHogEnv } = require("./load-env");

loadPostHogEnv();

const target = path.join(__dirname, "..", "analytics.config.json");
const key = (process.env.POSTHOG_PROJECT_API_KEY || "").trim();
const host = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").trim().replace(/\/+$/, "");
// production (default) for Marketplace builds; test / staging for builds used in verification,
// so their events can be filtered out of production dashboards.
const environment = (process.env.POSTHOG_ENVIRONMENT || "production").trim();

if (!key) {
  fs.rmSync(target, { force: true });
  console.log("analytics: POSTHOG_PROJECT_API_KEY is not set (in .env.posthog or the environment); building without analytics.");
  process.exit(0);
}
if (/^phx_/.test(key)) {
  console.error("analytics: POSTHOG_PROJECT_API_KEY is a personal API key (phx_). Use the project key (phc_) from Project settings.");
  process.exit(1);
}
if (!/^phc_[A-Za-z0-9]{20,80}$/.test(key)) {
  console.error("analytics: POSTHOG_PROJECT_API_KEY does not look like a PostHog project key (phc_ followed by about 40 letters and digits). Copy it from PostHog > Project settings > Project API key.");
  process.exit(1);
}
if (!/^https:\/\/[^\s/]+/.test(host)) {
  console.error("analytics: POSTHOG_HOST must be an https URL, e.g. https://us.i.posthog.com or https://eu.i.posthog.com.");
  process.exit(1);
}
if (!["production", "staging", "test"].includes(environment)) {
  console.error("analytics: POSTHOG_ENVIRONMENT must be production, staging or test.");
  process.exit(1);
}
fs.writeFileSync(target, JSON.stringify({ posthogKey: key, posthogHost: host, environment }, null, 2) + "\n");
console.log(`analytics: wrote analytics.config.json for ${host} (environment: ${environment}).`);
