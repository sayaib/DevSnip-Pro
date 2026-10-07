# Discoverability and growth plan

How DevSnip Pro gets found for what it does, and how we measure it honestly. This file is not shipped in the VSIX (`docs/**` is excluded).

**Rules:** no keyword stuffing, fake reviews, interrupting rating prompts or metric manipulation. Every claim must map to code. Points-priced features stay marked †. `name` and `publisher` in package.json never change (they form the extension ID `sayaib.hue-console`).

## Positioning

- **Primary job:** REST API client in VS Code. It has the highest search volume, and apart from Thunder Client the competition is weak: places 2–5 for "rest api client" had 41k, 204k, 0 and 1k installs on 2026-10-05. It is also our most mature and fully free feature.
- **Secondary jobs:**
  - database client (PostgreSQL, MySQL, MongoDB, Redis);
  - LLM token and cost tools;
  - security scan for hard-coded secrets;
  - JSON/YAML, JWT and cURL utilities.
- **Marketplace name:** `REST API Client & Database Client – DevSnip Pro`, from 11.74.1.
- **Why the name matters:** Marketplace relevance appears to be dominated by the query phrase sitting at the start of the displayName, or making up most of it. In the old name, "API Client" came after the brand, and we ranked only #38 for "api client". This is inferred from results, not documented, so the rename is an experiment. Check it at week 2.

## Competitor listings (2026-10-05)

| Extension | Installs · rating | Name strategy | Tags | What we learn |
| :--- | :--- | :--- | :--- | :--- |
| REST Client (humao) | 7.6M · 4.9★/388 | Exact phrase "REST Client" | 5 | A short exact-match name wins its phrase |
| Thunder Client | 7.6M · 2.4★/753 | Brand; description "Lightweight Rest API Client" | 10, incl. postman, insomnia | Its low rating suggests "free, no account" is a real differentiator |
| Postman | 2.7M · 3.0★/93 | Brand | 7, incl. rest client, http client | Needs a Postman account |
| SQLTools | 7.1M · 3.5★/145 | Brand | 28 database names | Ranks by database-name tags |
| Database Client (cweijan) | 1.3M · 4.1★/142 | Exact phrase "Database Client" | 66 | Owns "database client" by name |
| DBCode | 219k · 4.8★/82 | Long name: "SQL & Database Client for Postgres, MySQL, MongoDB & more" | 36 | A long, descriptive name still ranks #3; categories Data Science, Visualization, AI |
| MongoDB for VS Code | 3.2M · 4.4★/43 | Official brand | 10 | Uses the Data Science category |
| RapidAPI Client | 533k · 4.0★/35 | "… Client" | 6 | — |
| Snyk Security | 465k · 3.0★/39 | Brand | 15 | Uses the Linters category; we don't, because our scans do not emit diagnostics |
| Fetch Client | 18k · 4.8★/14 | Stuffed name and 54 tags | 54 | Stuffing has not bought rank or installs; don't copy it |

**What our listing does in response:**
- **Name:** the two exact intent phrases come first ("REST API Client", "Database Client") and the brand last.
- **Description:** opens with the differentiators the leaders lack ("Free … no account needed"), then the intents.
- **Tags:** 30 honest phrases. We name only one competitor ("postman alternative"), which the README FAQ and comparison back with what we do and don't do.
- **Categories:** Testing, Data Science (the database client and the Data & RAG tools), AI, Machine Learning, Snippets, Formatters. We avoid "Programming Languages": we contribute no language support beyond snippet scopes, so it would mislead. We also avoid "Other".

## Feature → evidence

Every claim in the README and guides maps to one of these rows.

| Claim | Evidence in source |
| :--- | :--- |
| REST client: methods, headers, params, body, auth, environments, collections, history | `src/commands/api-test.ts`, `src/commands/api-client-webview.ts`, `src/services/collections.ts` (VS Code `globalState`) |
| GraphQL: query, variables (validated), operation name, POST warning | `api-client-webview.ts` (`graphqlQuery`, `validateGraphqlVariables`, `graphqlWarn`) |
| cURL import (paste into the URL bar) and export | `api-client-webview.ts` (paste handler, `importCurl`), `api-test.ts` (cURL parser) |
| Code generation: JS fetch and Axios, Python, Go, Java, C# | `src/services/dev-operations.ts` (`CodeLanguage`) |
| WebSocket, OAuth helper, assertions, chaining, batch, mock servers † | `src/premium/feature-registry.ts` |
| AI provider request shapes (OpenAI, Anthropic, Gemini, Azure OpenAI, Ollama, OpenAI-compatible) | `src/services/llm-providers.ts` |
| Send a sample request | `api-client-webview.ts` (`sendSampleRequest`), test in `api-client-ui.unit.ts` |
| Database client: PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, MongoDB, Redis | `src/database/*`; `pg`, `mysql2`, `mssql`, `sql.js`, `mongodb`, `ioredis` |
| Keychain storage, read-only connections, destructive-statement confirmations | `src/database/store.ts` (SecretStorage), `service.ts`, `sql-builder.ts`, `adapters/sql-base.ts`, `adapters/redis.ts` |
| Security Hub: workspace, cloud/container, dependency, endpoint scans | commands `securityAudit`, `cloudSecurityAudit`, `dependencyAudit`, `endpointSecurityScan`, `securityHub` |
| LLM tokens and cost across 18 chat models (estimates) | `src/toolkits/sections/ai.ts`, `src/toolkits/engines/models.ts` |
| 110 tools in 13 sections | `src/toolkits/layout.ts` (`validateRegistry`) |
| Snippets in 39 languages; Create and Saved Snippets | `custom/*.json`, commands `createCustomSnippet`, `showSnippets` |
| OpenCode install via `npm install -g opencode-ai`, verified with `opencode --version` | `src/commands/openCodeIntegration.ts` |
| Walkthrough, Get started card, What's new | `contributes.walkthroughs`, `src/onboarding/activation.ts` |

**Not supported, so never claim it:**
- `.http` / `.rest` files;
- Postman or Insomnia collection import;
- a CLI or CI runner;
- gRPC and SOAP;
- team sync;
- GraphQL schema introspection or autocomplete;
- SQL Server Windows authentication;
- vscode.dev.

## Commands for you to run

### 1. Publish 11.74.1 to the Marketplace and Open VSX from one VSIX

Package once so the prepublish step (which rewrites `analytics.config.json`) runs once and both registries get identical bits.

```bash
npx vsce package
```

```bash
npx vsce publish --packagePath hue-console-11.74.1.vsix
```

```bash
npx ovsx publish hue-console-11.74.1.vsix -p "$OVSX_PAT"
```

### 2. One-time Open VSX setup (before the first `ovsx publish`)

1. Sign in at [open-vsx.org](https://open-vsx.org) with GitHub. Link an Eclipse account and sign the Publisher Agreement when the profile page asks.
2. Create an access token under **Settings → Access Tokens**, then `export OVSX_PAT=…` in your shell.
3. Create the namespace:

   ```bash
   npx ovsx create-namespace sayaib -p "$OVSX_PAT"
   ```

4. Optionally, request namespace verification (the "verified" shield) by opening an issue at [EclipseFdn/open-vsx.org](https://github.com/EclipseFdn/open-vsx.org/issues) and following their template.
5. After the first publish, add `· [Open VSX](https://open-vsx.org/extension/sayaib/hue-console)` to the README install line, so Cursor, Windsurf and VSCodium users can find it.

**Keep versions in sync:** every release, run the package → `vsce publish --packagePath` → `ovsx publish` sequence above with the same VSIX. Never publish to just one registry.

### 3. GitHub About, homepage and topics

`gh` is not installed yet:

```bash
brew install gh
```

```bash
gh auth login
```

```bash
gh repo edit sayaib/DevSnip-Pro --description "REST API client & database client for VS Code: HTTP and GraphQL requests, PostgreSQL, MySQL, MongoDB and Redis, LLM token tools and secret scanning. Free, no account." --homepage "https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console" --add-topic vscode-extension --add-topic visual-studio-code --add-topic rest-api-client --add-topic api-client --add-topic http-client --add-topic api-testing --add-topic graphql --add-topic postman-alternative --add-topic database-client --add-topic postgresql --add-topic mysql --add-topic mongodb --add-topic redis --add-topic sqlite --add-topic llm --add-topic token-counter --add-topic security-scanner --add-topic secret-scanning --add-topic developer-tools --add-topic typescript
```

That is 20 topics, GitHub's limit.

### 4. Check ranks (read-only)

```bash
node scripts/marketplace-rank.mjs
```

## Social preview image (GitHub → Settings → Social preview)

- **Size:** 1280 × 640 PNG, under 1 MB. Keep the important content inside the central 1200 × 600, because some sites crop the edges.
- **Background:** solid `#101D26`, the same as the Marketplace `galleryBanner`.
- **Left 45%:**
  - the logo (cube) at about 160 px;
  - below it, "DevSnip Pro" in 64 px semibold white;
  - then "REST API Client & Database Client for VS Code" in 34 px, `#7FE7F2`;
  - then "Free · No account · Runs locally" in 24 px, 70% white.
- **Right 55%:** a crop of `docs/images/rest-api-client.jpg` (request + JSON response) with 12 px rounded corners and a subtle shadow. No other text.
- **Save as:** `docs/images/social-preview.png`, then upload it in the repository settings. GitHub does not read it from the repo automatically.

## Proposals awaiting your approval (not implemented)

### A. One-time review request

- **When it appears:** at most once per installation, ever. All of these must be true:
  - `activation.ts` has recorded **three different** firsts (for example a request, a DB connection and a scan);
  - the install is at least 7 days old;
  - DevSnip Pro was used on at least 3 distinct days (`activeDays`);
  - the success that triggers it is happening right now;
  - at least 5 minutes have passed in the current session;
  - it is not the first run after an update.
- **What it looks like:** a non-modal `showInformationMessage`: "DevSnip Pro has helped with 3 kinds of work so far. If it's useful, a Marketplace review helps other developers find it." Buttons: **Leave a review** (opens the Marketplace review page) and **No thanks**.
- **What it remembers:** `reviewAsked: <timestamp>` is stored *when the message is shown*, so closing it, ignoring it or either button all count as asked. No reminder, no "later". It is suppressed when `telemetry.telemetryLevel` is `off`, out of respect for quiet setups.
- **Measurement:** one `onboarding_action` value, `review_prompt_shown` / `review_prompt_clicked`, with no other data.
- **Size:** about 40 lines in `src/onboarding/activation.ts`, plus a unit test that it never fires twice.

### B. Icon legible at 32 px

The current `logo.png` is transparent with thin cyan circuit lines. At 32 px only the cube reads, and on the Marketplace's light theme the lines are faint.

Proposal:
- a solid rounded-square `#101D26` background;
- the cube enlarged to about 60% of the tile, with a brighter top face;
- the circuit lines cut to 4 thick strokes;
- exported at 256 px.

Check it at 16, 32 and 128 px on light and dark backgrounds before replacing the icon.

### C. Hero GIF of the primary job

A 12–15 s GIF, at most 1200 px wide and about 3 MB:
1. the empty REST client;
2. click **Send a sample request**;
3. the response appears;
4. switch the environment to `{{baseUrl}}`;
5. **Generate code** → Python.

Record it with the existing puppeteer pipeline against the cached VS Code test build, save it as `docs/images/rest-api-client.gif`, and use it as the README hero, keeping the JPG as a fallback in the guides.

### D. Docs site on GitHub Pages

This is only warranted if we want Google search impressions measured in Search Console.

- **Source:** serve `docs/` with a minimal Jekyll theme.
- **Pages:** one page per guide plus a home page.
- **Required pieces:**
  - `sitemap.xml` (jekyll-sitemap) and canonical URLs;
  - Open Graph and Twitter card tags using the social preview image;
  - JSON-LD `SoftwareApplication` with `applicationCategory: DeveloperApplication`, `operatingSystem: Windows, macOS, Linux`, `offers.price: 0` and the Marketplace URL;
  - Search Console verification.
- **Rating data:** leave `aggregateRating` out unless it is copied from the live Marketplace numbers and kept current.
- **Effort:** about half a day.

## Launch drafts (you post them; nothing here is posted)

Post each one once, from your own account, and answer comments yourself.

### dev.to / Hashnode: one post per guide

Cross-post each guide with `canonical_url` pointing to the guide on GitHub (or the docs site if D ships), so search engines credit the original.

| Post title | Source guide | Tags |
| :--- | :--- | :--- |
| How to test REST APIs in VS Code (without leaving the editor) | test-rest-apis-in-vscode.md | vscode, api, webdev, testing |
| Testing a GraphQL API from VS Code: query, variables and auth | test-graphql-api-in-vscode.md | graphql, vscode, api |
| A free Postman alternative in VS Code: what it can and can't do | postman-alternative-in-vscode.md | vscode, postman, api, productivity |
| Connect to PostgreSQL, MySQL, MongoDB and Redis inside VS Code | connect-to-postgresql-mysql-mongodb-redis-in-vscode.md | database, postgres, vscode |
| Count LLM tokens and estimate API cost before you ship | count-llm-tokens-and-cost-in-vscode.md | ai, llm, openai, vscode |
| Find hard-coded secrets in your repo before they reach git history | find-hardcoded-secrets-in-vscode.md | security, vscode, devops |

**Spacing:** one post per week, not all at once.

**Wording:** each post opens with the task, and DevSnip Pro appears where it is used, with a single install link at the end.

### Show HN

> **Show HN: A free REST API client and database client inside VS Code (no account)**
>
> I build DevSnip Pro, a VS Code extension. Its main job is a REST/GraphQL client with environments, collections, cURL import and code generation (JS, Python, Go, Java, C#). It also has a database client for Postgres, MySQL, SQL Server, SQLite, MongoDB and Redis that stores connection strings in the OS keychain and has read-only connections.
>
> There's no account or backend. Analytics are anonymous, follow VS Code's telemetry setting, and are documented event by event.
>
> What it doesn't do: import Postman collections, .http files, a CLI runner, gRPC or team sync. A few advanced testing tools (assertions, chaining, WebSocket) are unlocked with points you earn by using it; there's nothing to buy.
>
> Source: https://github.com/sayaib/DevSnip-Pro. I'd like feedback on the request workflow and on what's missing.

### r/vscode

> **Title:** I made a free REST API client + database client extension. Here's what it does and doesn't do
>
> Body: two short paragraphs as in Show HN, a screenshot (`rest-api-client.jpg`), the honest "doesn't do" list, the Marketplace link, and "happy to answer questions". Check the subreddit's self-promotion rules first, and post once.

### awesome-vscode pull request

Proposed line for [viatsko/awesome-vscode](https://github.com/viatsko/awesome-vscode), in the existing API/HTTP section. Follow its CONTRIBUTING rules: alphabetical order, a screenshot or GIF, and no duplicate categories.

```markdown
### [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)

A REST and GraphQL API client with environments, collections, cURL import and code generation, plus a database client for PostgreSQL, MySQL, SQL Server, SQLite, MongoDB and Redis.

![DevSnip Pro REST API Client](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/rest-api-client.jpg)
```

## 90-day measurement plan

**Day 0** is the day 11.74.1 is published. Checkpoints are weeks 2, 6 and 12. Record each checkpoint in the table below.

| Metric | Source | Baseline (2026-10-05, before 11.74.1) |
| :--- | :--- | :--- |
| Total installs | Marketplace publisher hub (or `node scripts/marketplace-rank.mjs`) | 56,141 |
| New installs / week and page views / week | Publisher hub → Reports → Acquisition | read from the hub on Day 0 |
| Page view → install conversion | Publisher hub | read on Day 0 |
| Uninstalls / week | Publisher hub → Reports | read on Day 0 |
| Rating | Marketplace | 4.62 from 61 |
| Rank "rest api client" | rank script | #21 |
| Rank "api client" | rank script | #38 |
| Rank "api testing" | rank script | #16 |
| Rank "database client" | rank script | #47 |
| Rank "sql client" | rank script | #46 |
| Rank "graphql client" | rank script | #44 |
| Rank "redis" / "mongodb" | rank script | #33 / #49 |
| Rank "jwt decoder" / "curl" / "websocket" | rank script | #60 / #36 / #45 |
| Rank "ai tools" | rank script | #22 |
| Rank "devsnip" (brand must not drop) | rank script | #2 |
| Open VSX downloads | open-vsx.org extension page | not listed |
| GitHub stars / forks / unique visitors / referrers | GitHub → Insights → Traffic (keeps only 14 days, so record it every 2 weeks) | 0 stars, 1 fork |
| Activation: share of new installs with `activation_milestone` `first_api_request` within 7 days | PostHog | read on Day 0 |
| Activation: share reaching 3+ distinct milestones within 14 days | PostHog | read on Day 0 |
| Week-4 retention (active on any day in week 4) | PostHog | read on Day 0 |
| Search impressions and clicks | Google Search Console (only if the docs site ships) | n/a |

**What to do at each checkpoint**

| Week | Action |
| :--- | :--- |
| 2 | Re-run the rank script. If "rest api client" has not moved into the top 10 and "devsnip" is still top 3, keep the name. If "rest api client" is still around #21, try one variant (for example `REST API Client – DevSnip Pro`) and re-check two weeks later. Check activation for the sample-request button. |
| 6 | Compare new installs/week and page-view conversion with Day 0. Decide on proposals A–D using the numbers. Publish the second and third launch posts. |
| 12 | Full table refresh. Keep what moved installs or activation, revert what didn't, and write the result into this file. |

**Honest reading:**
- Install counts are noisy week to week, so compare four-week averages.
- A rank change only matters if page views follow.
- Don't attribute a change to one action when several shipped in the same window.
