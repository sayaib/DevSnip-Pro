#!/usr/bin/env node
/**
 * Gives users of DevSnip Pro versions before 11.76.4 a location in PostHog.
 *
 * Those versions sent `$geoip_disable` and `$process_person_profile: false`, so
 * their users have no person profile and no country, although PostHog stored the
 * IP of each event. This script sends one `$set` event per such user, with the
 * IP of their latest event, so PostHog GeoIP creates their person profile with
 * country, region and city - the same as for users on current versions. When a
 * user updates, the `$identify` merge in 11.76.5 folds that profile into their
 * per-machine id, so they are still counted once.
 *
 * Credentials come from `.env.posthog` (see `.env.posthog.example`):
 * POSTHOG_PERSONAL_API_KEY (query:read) and POSTHOG_PROJECT_ID to find the users,
 * POSTHOG_PROJECT_API_KEY and POSTHOG_HOST to send the `$set` events.
 *
 *   node scripts/posthog-backfill-geo.js           # list who would get a location (sends nothing)
 *   node scripts/posthog-backfill-geo.js --send    # send the $set events
 *
 * Re-running is safe: users who already have a person profile or a backfill event
 * are skipped, and each event's uuid is derived from the user id.
 */

require("./load-env").loadPostHogEnv();
const crypto = require("crypto");

const SINCE_DAYS = 365;
const SEND = process.argv.includes("--send");

const appHost = (process.env.POSTHOG_APP_HOST || "https://us.posthog.com").replace(/\/+$/, "");
const ingestHost = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
const personalKey = process.env.POSTHOG_PERSONAL_API_KEY;
const projectKey = process.env.POSTHOG_PROJECT_API_KEY;
const project = process.env.POSTHOG_PROJECT_ID;

async function hogql(query) {
  const response = await fetch(`${appHost}/api/projects/${encodeURIComponent(project)}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${personalKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`query -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text).results || [];
}

/** A stable UUID per user, so a resent backfill event is de-duplicated by PostHog. */
function backfillUuid(distinctId) {
  const hex = crypto.createHash("sha256").update(`devsnip-geo-backfill:${distinctId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  if (!personalKey || !project) {
    console.error("Set POSTHOG_PERSONAL_API_KEY (phx_...) and POSTHOG_PROJECT_ID in .env.posthog or the environment.");
    process.exit(1);
  }
  if (SEND && !projectKey) {
    console.error("Set POSTHOG_PROJECT_API_KEY (phc_...) in .env.posthog or the environment to send events.");
    process.exit(1);
  }

  // Ids that only ever sent personless events (no row in person_distinct_ids, which can
  // lag behind ingestion) and were not backfilled already.
  const rows = await hogql(`SELECT distinct_id, argMax(properties.$ip, timestamp) AS ip, max(timestamp) AS last_seen,
  argMax(properties.extension_version, timestamp) AS version, argMax(properties.environment, timestamp) AS environment
FROM events
WHERE timestamp > now() - INTERVAL ${SINCE_DAYS} DAY AND properties.$geoip_disable = true
  AND distinct_id NOT IN (SELECT distinct_id FROM raw_person_distinct_ids)
  AND distinct_id NOT IN (SELECT distinct_id FROM events WHERE event = '$set' AND properties.$lib = 'devsnip-geo-backfill'
    AND timestamp > now() - INTERVAL ${SINCE_DAYS} DAY)
GROUP BY distinct_id
HAVING ip IS NOT NULL AND ip != ''
ORDER BY last_seen`);

  if (!rows.length) {
    console.log("Every user already has a person profile. Nothing to do.");
    return;
  }
  console.log(`${rows.length} user(s) without a location:`);
  for (const [id, , lastSeen, version, environment] of rows) console.log(`  ${id}  last seen ${lastSeen}  v${version}  ${environment}`);

  if (!SEND) {
    console.log("\nDry run: nothing sent. Re-run with --send to give these users a location.");
    return;
  }

  const batch = rows.map(([distinctId, ip, lastSeen, version, environment]) => ({
    uuid: backfillUuid(distinctId),
    event: "$set",
    distinct_id: distinctId,
    // At the user's last activity, so "latest country" logic matches their real last visit.
    timestamp: lastSeen,
    properties: {
      // GeoIP reads $ip, so the location comes from the user's own last event.
      $ip: ip,
      $lib: "devsnip-geo-backfill",
      extension_version: version || undefined,
      environment: environment || undefined,
      $set: {}
    }
  }));
  for (let i = 0; i < batch.length; i += 100) {
    const response = await fetch(`${ingestHost}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: projectKey, historical_migration: false, batch: batch.slice(i, i + 100) })
    });
    if (!response.ok) throw new Error(`batch -> HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  console.log(`\nSent ${batch.length} $set event(s). Locations appear in PostHog within a few minutes.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
