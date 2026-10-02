#!/usr/bin/env node
/**
 * Creates (or completes) the "DevSnip Pro - Usage" dashboard in PostHog.
 *
 * Credentials come from `.env.posthog` (copy `.env.posthog.example`) or from
 * environment variables, which take precedence.
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_... POSTHOG_PROJECT_ID=12345 \
 *   POSTHOG_APP_HOST=https://us.posthog.com node scripts/posthog-dashboard.js
 *
 *   node scripts/posthog-dashboard.js --dry-run     # print the definitions only
 *
 * The personal API key needs the dashboard:write and insight:write scopes. It
 * is only used on your machine to call the PostHog API; it is never part of
 * the extension. Re-running is safe: insights that already exist on the
 * dashboard (matched by name) are updated to match this file.
 */

require("./load-env").loadPostHogEnv();

const DASHBOARD = "DevSnip Pro - Usage";
const DAYS = "-30d";

const trend = (series, extra = {}) => ({
  kind: "InsightVizNode",
  source: {
    kind: "TrendsQuery",
    series: series.map(([event, math, name, extraSeries]) => ({ kind: "EventsNode", event, name: name || event || "All events", math, ...(extraSeries || {}) })),
    interval: extra.interval || "day",
    dateRange: { date_from: extra.from || DAYS },
    ...(extra.breakdown ? { breakdownFilter: { breakdown: extra.breakdown, breakdown_type: "event", breakdown_limit: extra.limit || 25 } } : {}),
    ...(extra.properties ? { properties: extra.properties } : {}),
    // Excludes test / staging / development builds via the project's test account filter.
    filterTestAccounts: true,
    trendsFilter: { display: extra.display || "ActionsLineGraph", ...(extra.formula ? { formula: extra.formula } : {}) }
  }
});

/** Production events only: builds made for verification are tagged environment=test/staging/development. */
const PROD = "ifNull(properties.environment, 'production') = 'production'";

const hogql = (query, display = "ActionsTable") => ({
  kind: "DataVisualizationNode",
  source: { kind: "HogQLQuery", query: query.replace(/\bWHERE\b/, `WHERE ${PROD} AND`) },
  display
});

const eq = (key, value) => [{ type: "event", key, operator: "exact", value }];

/** [name, description, query] - the order is the dashboard layout order. */
const INSIGHTS = [
  ["Users active right now (last 5 min)", "Distinct installations with any DevSnip Pro event in the last 5 minutes.",
    hogql("SELECT count(DISTINCT distinct_id) AS active_now FROM events WHERE timestamp > now() - INTERVAL 5 MINUTE", "BoldNumber")],
  ["Users active in the last hour", "Distinct installations with any event in the last 60 minutes.",
    hogql("SELECT count(DISTINCT distinct_id) AS active_last_hour FROM events WHERE timestamp > now() - INTERVAL 1 HOUR", "BoldNumber")],
  ["Active users - DAU / WAU / MAU", "Daily, weekly and monthly active installations (any event).",
    trend([[null, "dau", "DAU"], [null, "weekly_active", "WAU"], [null, "monthly_active", "MAU"]], { from: "-90d" })],
  ["Active users by hour (last 48h)", "Distinct installations per hour - the real-time activity pattern.",
    trend([[null, "dau", "Active users"]], { interval: "hour", from: "-48h" })],
  ["Stickiness - DAU / MAU", "Share of monthly users who use DevSnip Pro on a given day.",
    trend([[null, "dau", "DAU"], [null, "monthly_active", "MAU"]], { formula: "A / B", from: "-90d" })],
  ["Installs, updates and activations", "New installations, updates to a new version, and all activations per day.",
    trend([["extension_activated", "total", "Activations"],
      ["extension_activated", "total", "New installs", { properties: eq("install_type", ["new"]) }],
      ["extension_updated", "total", "Updates"]])],
  ["Updates by version", "Installations moving to each new version.",
    trend([["extension_updated", "total", "Updates"]], { breakdown: "extension_version", limit: 10 })],
  ["Most used features (runs, 30d)", "Command runs per feature, most used first.",
    trend([["feature_used", "total", "Runs"]], { breakdown: "feature", display: "ActionsBarValue" })],
  ["Features by unique users (30d)", "How many installations used each feature - the breadth of value.",
    trend([["feature_used", "dau", "Users"]], { breakdown: "feature", display: "ActionsBarValue" })],
  ["Feature usage table - most and least used (30d)", "Runs, users, runs per user and error rate for every feature that was used. Features missing here were not used at all.",
    hogql(`SELECT properties.feature AS feature, properties.category AS category, count() AS runs, count(DISTINCT distinct_id) AS users,
  round(count() / count(DISTINCT distinct_id), 1) AS runs_per_user,
  round(countIf(properties.outcome = 'error') * 100 / count(), 1) AS error_pct,
  round(avg(toFloat(properties.duration_ms))) AS avg_ms
FROM events WHERE event = 'feature_used' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY feature, category ORDER BY runs DESC`)],
  ["Least used features (30d)", "Bottom 15 features by runs - candidates for better discovery or removal.",
    hogql(`SELECT properties.feature AS feature, count() AS runs, count(DISTINCT distinct_id) AS users
FROM events WHERE event = 'feature_used' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY feature ORDER BY runs ASC LIMIT 15`)],
  ["Usage by feature area over time", "Command runs per category (snippets, api, ai, security...).",
    trend([["feature_used", "total", "Runs"]], { breakdown: "category", limit: 12 })],
  ["Feature adoption - first uses (30d)", "Installations using a feature for the first time.",
    trend([["feature_used", "total", "First uses", { properties: eq("first_use", ["true"]) }]], { breakdown: "feature", display: "ActionsBarValue" })],
  ["Feature errors", "Command runs that threw, by feature.",
    trend([["feature_used", "total", "Errors", { properties: eq("outcome", ["error"]) }]], { breakdown: "feature" })],
  ["Sessions per day", "Usage sessions started (a session ends after 30 minutes idle).",
    trend([["session_started", "total", "Sessions"], ["session_started", "dau", "Users with a session"]])],
  ["Session length and engaged time (avg, seconds)", "Average session duration and time actively using DevSnip Pro features.",
    trend([["session_ended", "avg", "Avg duration (s)", { math_property: "duration_s" }], ["session_ended", "avg", "Avg engaged time (s)", { math_property: "engaged_s" }]])],
  ["Session engagement distribution (30d)", "Median and 90th percentile session duration, engaged time and features per session.",
    hogql(`SELECT round(quantile(0.5)(toFloat(properties.duration_s))) AS median_duration_s,
  round(quantile(0.9)(toFloat(properties.duration_s))) AS p90_duration_s,
  round(quantile(0.5)(toFloat(properties.engaged_s))) AS median_engaged_s,
  round(avg(toFloat(properties.feature_count)), 1) AS avg_features_per_session,
  count() AS sessions
FROM events WHERE event = 'session_ended' AND timestamp > now() - INTERVAL 30 DAY`)],
  ["Weekly retention", "Of installations first activated in a week, how many used a feature in following weeks.",
    { kind: "InsightVizNode", source: { kind: "RetentionQuery", filterTestAccounts: true, dateRange: { date_from: "-56d" }, retentionFilter: {
      period: "Week", totalIntervals: 8, retentionType: "retention_first_time",
      targetEntity: { id: "extension_activated", name: "extension_activated", type: "events" },
      returningEntity: { id: "feature_used", name: "feature_used", type: "events" } } } }],
  ["Activation: first use of core features (30d)", "Installations reaching each first (request sent, scan finished, database connected...) and the median days after install it took.",
    hogql(`SELECT properties.milestone AS milestone,
  count(DISTINCT distinct_id) AS installations,
  round(quantile(0.5)(toFloat(properties.days_since_install)), 1) AS median_days_since_install
FROM events WHERE event = 'activation_milestone' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY milestone ORDER BY installations DESC`)],
  ["Onboarding cards", "Get started steps opened, guide dismissed, walkthrough opened, What's new opened or dismissed.",
    trend([["onboarding_action", "total", "Actions"]], { breakdown: "action", display: "ActionsBarValue" })],
  ["Snippets, search, copy, save and delete", "Feature-specific actions over time.",
    trend([["snippet_created", "total"], ["snippet_deleted", "total"], ["tool_search_performed", "total"], ["tool_search_selected", "total"],
      ["content_copied", "total"], ["request_saved", "total"], ["request_deleted", "total"], ["readme_saved", "total"]])],
  ["Snippets created by language", "Which languages people build snippets for.",
    trend([["snippet_created", "total", "Snippets"]], { breakdown: "language", display: "ActionsBarValue" })],
  ["Tool search effectiveness", "Searches, searches with no match, and searches that led to opening a tool.",
    trend([["tool_search_performed", "total", "Searches"], ["tool_search_performed", "total", "No results", { properties: eq("match_count", ["0"]) }], ["tool_search_selected", "total", "Opened a tool"]])],
  ["Dependency jobs by outcome", "Install / update runs from the Dependencies panel and how they ended.",
    trend([["dependency_job_finished", "total", "Jobs"]], { breakdown: "outcome" })],
  ["Milestones and levels", "Milestones unlocked and levels reached.",
    trend([["milestone_unlocked", "total"], ["level_reached", "total"], ["points_spent", "sum", "Points spent", { math_property: "amount" }]])],
  ["Active users by extension version", "Adoption of new releases.",
    trend([[null, "dau", "Active users"]], { breakdown: "extension_version", limit: 10 })],
  ["Platform and VS Code flavour (30d)", "Operating system and desktop / web split.",
    trend([["extension_activated", "dau", "Users"]], { breakdown: "platform", display: "ActionsPie" })]
];

async function main() {
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ dashboard: DASHBOARD, insights: INSIGHTS.map(([name, description, query]) => ({ name, description, query })) }, null, 2));
    return;
  }
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  const host = (process.env.POSTHOG_APP_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  if (!key || !project) {
    console.error("Set POSTHOG_PERSONAL_API_KEY (phx_..., scopes dashboard:write and insight:write) and POSTHOG_PROJECT_ID in .env.posthog or the environment. Use --dry-run to preview.");
    process.exit(1);
  }
  const api = async (method, path, body) => {
    const response = await fetch(`${host}/api/projects/${encodeURIComponent(project)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  };

  // Mark non-production traffic as "test accounts" so every insight (and ad-hoc analysis
  // with the "Filter out internal and test users" toggle) excludes it.
  try {
    const projectInfo = await api("GET", "/");
    const filters = (projectInfo.test_account_filters || []).filter(filter => filter.key !== "environment");
    filters.push({ key: "environment", type: "event", operator: "is_not", value: ["test", "staging", "development"] });
    await api("PATCH", "/", { test_account_filters: filters, test_account_filters_default_checked: true });
    console.log("Test account filter set: environment is not test / staging / development.");
  } catch (error) {
    console.warn(`Could not set the test account filter automatically (${error.message.split(":")[0]}). ` +
      "Add it in Project settings > Product analytics > Filter out internal and test users: event property environment, is not, test / staging / development. " +
      "(The personal key needs the project:write scope to do this automatically.)");
  }

  const existing = await api("GET", `/dashboards/?search=${encodeURIComponent(DASHBOARD)}`);
  let dashboard = (existing.results || []).find(entry => entry.name === DASHBOARD && !entry.deleted);
  if (!dashboard) {
    dashboard = await api("POST", "/dashboards/", {
      name: DASHBOARD,
      description: "Active users, real-time activity, feature usage, sessions and engagement for the DevSnip Pro VS Code extension. Created by scripts/posthog-dashboard.js; event definitions in docs/ANALYTICS.md.",
      pinned: true
    });
    console.log(`Created dashboard "${DASHBOARD}" (id ${dashboard.id}).`);
  } else {
    dashboard = await api("GET", `/dashboards/${dashboard.id}/`);
    console.log(`Updating dashboard "${DASHBOARD}" (id ${dashboard.id}).`);
  }
  const present = new Map((dashboard.tiles || []).filter(tile => tile.insight && tile.insight.name).map(tile => [tile.insight.name, tile.insight.id]));

  let created = 0;
  let updated = 0;
  for (const [name, description, query] of INSIGHTS) {
    if (present.has(name)) {
      // Re-running keeps existing insights in sync with this file.
      await api("PATCH", `/insights/${present.get(name)}/`, { description, query });
      updated++;
      console.log(`  ~ updated: ${name}`);
      continue;
    }
    await api("POST", "/insights/", { name, description, query, dashboards: [dashboard.id], saved: true });
    created++;
    console.log(`  + created: ${name}`);
  }
  // Insights this script used to create under a name it no longer uses (soft delete; restorable in PostHog).
  const RETIRED = ["New installs vs activations"];
  for (const name of RETIRED) {
    if (!present.has(name)) continue;
    await api("PATCH", `/insights/${present.get(name)}/`, { deleted: true });
    console.log(`  - retired: ${name}`);
  }
  // The API also answers on the ingestion host (us.i.posthog.com); the web app lives on us.posthog.com.
  const appUrl = host.replace("://us.i.posthog.com", "://us.posthog.com").replace("://eu.i.posthog.com", "://eu.posthog.com");
  console.log(`Done. ${created} insight(s) added, ${updated} updated. Open ${appUrl}/project/${project}/dashboard/${dashboard.id}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
