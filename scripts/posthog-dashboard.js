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
    ...(extra.breakdown ? { breakdownFilter: { breakdown: extra.breakdown, breakdown_type: extra.breakdownType || "event", breakdown_limit: extra.limit || 25 } } : {}),
    ...(extra.properties ? { properties: extra.properties } : {}),
    // Excludes test / staging / development builds via the project's test account filter.
    filterTestAccounts: true,
    trendsFilter: { display: extra.display || "ActionsLineGraph", ...(extra.formula ? { formula: extra.formula } : {}) }
  }
});

/**
 * HogQL tables. `{filters}` applies the dashboard's date range and the project's
 * test account filter (environment test / staging / development, internal users),
 * the same exclusions the charts use.
 *
 * Users are counted by person_id, not distinct_id: PostHog merges every id one
 * person reported under (one per VS Code profile in versions before 11.76.5) into
 * one person, so nobody is counted, or listed, twice.
 */
const hogql = (query, display = "ActionsTable", from = DAYS) => ({
  kind: "DataVisualizationNode",
  source: { kind: "HogQLQuery", query, filters: { filterTestAccounts: true, dateRange: { date_from: from } } },
  display
});

const EVENTS = "event IN ('extension_active', 'tool_opened', 'tool_used')";

/** [name, description, query] - the order is the dashboard layout order. */
const INSIGHTS = [
  // 1. Unique and returning users -----------------------------------------
  ["Unique users (30d)", "People who used DevSnip Pro in the last 30 days, each counted once however many VS Code profiles they use.",
    hogql(`SELECT count(DISTINCT person_id) AS unique_users FROM events WHERE ${EVENTS} AND {filters}`, "BoldNumber")],
  ["Unique users - DAU / WAU / MAU", "Unique people active per day, week and month.",
    trend([["extension_active", "dau", "Daily users"], ["extension_active", "weekly_active", "Weekly users"], ["extension_active", "monthly_active", "Monthly users"]], { from: "-90d" })],
  ["New vs returning users (weekly)", "PostHog lifecycle: new, returning, resurrecting and dormant users each week.",
    { kind: "InsightVizNode", source: { kind: "LifecycleQuery", filterTestAccounts: true, interval: "week", dateRange: { date_from: "-90d" },
      series: [{ kind: "EventsNode", event: "extension_active", name: "extension_active" }] } }],
  ["Weekly retention", "Of users first active in a week, how many came back in the following weeks.",
    { kind: "InsightVizNode", source: { kind: "RetentionQuery", filterTestAccounts: true, dateRange: { date_from: "-56d" }, retentionFilter: {
      period: "Week", totalIntervals: 8, retentionType: "retention_first_time",
      targetEntity: { id: "extension_active", name: "extension_active", type: "events" },
      returningEntity: { id: "extension_active", name: "extension_active", type: "events" } } } }],

  // 2. Geography ----------------------------------------------------------
  ["Users by country (map, 30d)", "Unique users per country, each user in their latest country only (PostHog GeoIP; no location permission is asked for).",
    trend([["extension_active", "dau", "Users"]], { breakdown: "$geoip_country_code", breakdownType: "person", display: "WorldMap", limit: 250 })],
  ["Users by country (30d)", "Unique users per country, most first. Each user is counted once, in the country they were last seen in.",
    hogql(`SELECT country, count() AS users
FROM (SELECT person_id, argMax(properties.$geoip_country_name, timestamp) AS country FROM events WHERE ${EVENTS} AND {filters} GROUP BY person_id)
GROUP BY country ORDER BY users DESC LIMIT 250`)],

  // 3. Most-used tools across all users -----------------------------------
  ["Most-used tools (opens, 30d)", "Times each tool was opened, most used first.",
    trend([["tool_opened", "total", "Opens"]], { breakdown: "tool", display: "ActionsBarValue", limit: 30 })],
  ["Tools by unique users (30d)", "How many unique users opened each tool.",
    trend([["tool_opened", "dau", "Users"]], { breakdown: "tool", display: "ActionsBarValue", limit: 30 })],
  ["Tool ranking (30d)", "Every tool used in the last 30 days: opens, uses (it produced a result), unique users and opens per user.",
    hogql(`SELECT properties.tool AS tool, any(properties.section) AS section,
  countIf(event = 'tool_opened') AS opens, countIf(event = 'tool_used') AS uses,
  count(DISTINCT person_id) AS users, round(countIf(event = 'tool_opened') / count(DISTINCT person_id), 1) AS opens_per_user
FROM events WHERE event IN ('tool_opened', 'tool_used') AND {filters}
GROUP BY tool ORDER BY opens DESC`)],

  // 4. Per-user tool usage: one row per user ------------------------------
  ["Users (one row each, 30d)", "Every user once: country, first and last seen, active days, how many tools they use, their favourite tool and their top ten tools with open counts.",
    hogql(`SELECT a.user AS user, a.country AS country, a.first_seen AS first_seen, a.last_seen AS last_seen, a.active_days AS active_days,
  ifNull(t.tools_used, 0) AS tools_used, ifNull(t.opens, 0) AS opens, t.favourite_tool AS favourite_tool, t.top_tools AS top_tools
FROM (
  SELECT person_id AS user, argMax(properties.$geoip_country_name, timestamp) AS country,
    min(timestamp) AS first_seen, max(timestamp) AS last_seen, count(DISTINCT toDate(timestamp)) AS active_days
  FROM events WHERE ${EVENTS} AND {filters} GROUP BY user
) AS a
LEFT JOIN (
  SELECT user, count() AS tools_used, sum(n) AS opens, argMax(tool, n) AS favourite_tool,
    arrayStringConcat(arraySlice(arrayMap(x -> concat(x.1, ' (', toString(x.2), ')'), arrayReverseSort(x -> x.2, groupArray(tuple(tool, n)))), 1, 10), ', ') AS top_tools
  FROM (SELECT person_id AS user, properties.tool AS tool, count() AS n FROM events WHERE event = 'tool_opened' AND {filters} GROUP BY user, tool)
  GROUP BY user
) AS t ON a.user = t.user
ORDER BY opens DESC, last_seen DESC LIMIT 1000`)],

  // 5. Usage frequency and trends -----------------------------------------
  ["Daily tool usage", "Tool opens and uses per day, with the number of unique users.",
    trend([["tool_opened", "total", "Opens"], ["tool_used", "total", "Uses"], ["tool_opened", "dau", "Users"]])],
  ["Monthly tool usage", "Tool opens and uses per month, with unique users per month.",
    trend([["tool_opened", "total", "Opens"], ["tool_used", "total", "Uses"], ["tool_opened", "dau", "Users"]], { interval: "month", from: "-365d" })],
  ["Top tools over time (daily)", "Daily opens of the ten most-used tools.",
    trend([["tool_opened", "total", "Opens"]], { breakdown: "tool", limit: 10 })],
  ["Usage by section (30d)", "Tool opens per section of the Tools sidebar.",
    trend([["tool_opened", "total", "Opens"]], { breakdown: "section", limit: 13 })]
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
      description: "Users, countries and tool usage for the DevSnip Pro VS Code extension. Created by scripts/posthog-dashboard.js; event definitions in docs/ANALYTICS.md.",
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
  // Insights on the dashboard that this file no longer defines, such as the ones
  // for events DevSnip Pro stopped sending (soft delete; restorable in PostHog).
  const wanted = new Set(INSIGHTS.map(([name]) => name));
  for (const [name, id] of present) {
    if (wanted.has(name)) continue;
    await api("PATCH", `/insights/${id}/`, { deleted: true });
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
