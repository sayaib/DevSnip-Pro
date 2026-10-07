#!/usr/bin/env node
/*
 * Prints DevSnip Pro's position in Visual Studio Marketplace search (the same
 * relevance query the VS Code Extensions view uses) for each search phrase,
 * plus the listing's install and rating counts. Read-only; publishes nothing.
 *
 *   node scripts/marketplace-rank.mjs                 # default phrases
 *   node scripts/marketplace-rank.mjs "graphql client" "sql client"
 *   node scripts/marketplace-rank.mjs --csv > ranks-2026-10-19.csv
 */
const ID = { publisher: "sayaib", name: "hue-console" };
const API = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const HEADERS = { "Content-Type": "application/json", Accept: "application/json;api-version=3.0-preview.1" };
const DEFAULT_PHRASES = [
  "rest api client", "api client", "http client", "api testing", "graphql client", "postman alternative",
  "database client", "sql client", "postgresql", "mongodb", "redis",
  "llm", "token counter", "ai tools", "security scanner", "secret scanner",
  "jwt decoder", "json formatter", "curl", "websocket", "code snippets", "opencode", "devsnip"
];

async function query(criteria, extra = {}) {
  const body = { filters: [{ criteria, pageNumber: 1, pageSize: 100, sortBy: 0, sortOrder: 0 }], assetTypes: [], flags: 914, ...extra };
  const response = await fetch(API, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Marketplace returned ${response.status}`);
  return (await response.json()).results[0].extensions;
}

async function rank(phrase) {
  const results = await query([
    { filterType: 8, value: "Microsoft.VisualStudio.Code" },
    { filterType: 10, value: phrase },
    { filterType: 12, value: "4096" }
  ]);
  const index = results.findIndex(e => e.publisher.publisherName === ID.publisher && e.extensionName === ID.name);
  return { phrase, rank: index < 0 ? ">100" : String(index + 1), leader: results[0]?.displayName ?? "" };
}

const args = process.argv.slice(2);
const csv = args.includes("--csv");
const phrases = args.filter(a => a !== "--csv");
const [self] = await query([{ filterType: 7, value: `${ID.publisher}.${ID.name}` }]);
const stats = Object.fromEntries((self?.statistics ?? []).map(s => [s.statisticName, s.value]));
const date = new Date().toISOString().slice(0, 10);

if (csv) console.log("date,phrase,rank,leader");
else {
  console.log(`${date}  ${self?.displayName}  v${self?.versions?.[0]?.version}`);
  console.log(`installs ${Math.round(stats.install ?? 0)} · rating ${(stats.averagerating ?? 0).toFixed(2)} from ${stats.ratingcount ?? 0} · weekly trend ${(stats.trendingweekly ?? 0).toFixed(2)}\n`);
}
for (const phrase of phrases.length ? phrases : DEFAULT_PHRASES) {
  const r = await rank(phrase);
  console.log(csv ? `${date},"${r.phrase}",${r.rank},"${r.leader.replace(/"/g, "'")}"` : `${r.rank.padStart(4)}  ${r.phrase}   (#1: ${r.leader})`);
}
