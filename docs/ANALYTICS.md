# DevSnip Pro analytics

DevSnip Pro sends **anonymous usage analytics** to [PostHog](https://posthog.com) to learn which features people actually use, how often, and for how long. The data drives decisions about what to improve, what to make easier to find, and what to retire.

This document covers what is collected, how to switch it off, how it is built and configured, the complete event reference, and the PostHog dashboard.

## What is collected, and what never is

**Collected:** which DevSnip Pro commands run, and whether they succeeded and how long they took. Also feature-specific counts (a snippet was created in `typescript` with 12 lines, a search matched 4 tools), session length, and coarse environment facts: extension version, VS Code version, OS family (`darwin`/`win32`/`linux`), CPU architecture, desktop or web, remote window or not, and display language.

**Never collected:** source code, snippet names/prefixes/bodies, file names or paths, workspace or folder names, search queries, URLs, request bodies or headers, API keys, package names, error messages, usernames, emails, machine IDs, or IP-derived location.

This is enforced in code, not by convention:

- **Allow-listed properties only.** Every property must be declared in [`src/analytics/events.ts`](../src/analytics/events.ts) with a type. Anything else is dropped before it is queued.
- **No free-text property type exists.** Strings must be short identifiers (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`) or one of an enum's listed values. A path, sentence, URL or email fails validation and is dropped.
- **Anonymous identity.** The only identifier is a random UUID generated on first run and stored in VS Code's extension storage. It is not derived from the machine, the user or VS Code's machine ID. Events are sent with `$process_person_profile: false` (no person profiles) and `$geoip_disable: true` (no GeoIP enrichment).

Recommended PostHog project settings: enable **Discard client IP data**, and set a data retention period that suits you.

## Turning it off

Analytics is sent only when **all** of these are true, and they are re-checked live:

1. VS Code's **`telemetry.telemetryLevel`** is `all`. Setting it to `error`, `crash` or `off` stops DevSnip Pro analytics too.
2. **`devsnip.analytics.enabled`** is `true` (the default). Set it to `false` to switch off only DevSnip Pro's analytics.
3. The extension is an installed build. Running from source (F5) or in tests never sends anything.
4. The package was built with a PostHog key (see below). Builds without one have analytics off entirely.

When analytics is switched off, anything still queued is discarded, not sent.

To see exactly what is sent, enable **`devsnip.analytics.debug`**. Every event, with every property as transmitted, is written to the **DevSnip Pro: Analytics** output channel, along with anything validation dropped.

## Architecture

```
command / feature code ──track(event, props)──▶ AnalyticsClient ──batch──▶ PostHog /batch/
          │                                    │  validate against catalog
  registerTrackedCommand ──observer──▶ trackCommand   │  session + engagement bookkeeping
  (every command: feature_used)                │  in-memory queue (max 500)
                                               └─ flush: every 30s, at 20 events, on shutdown
```

| File | Role |
| :--- | :--- |
| `src/analytics/events.ts` | **The event catalog.** Every event, property, type and description. `track()` is typed from it. |
| `src/analytics/client.ts` | VS Code-free core: validation, sessions, batching, retry with backoff. Fully unit-tested. |
| `src/analytics/index.ts` | VS Code wiring: consent gate, anonymous id, config loading, PostHog transport, debug channel, `track()`. |
| `src/utils/command-registry.ts` | Reports every command's outcome and duration through an observer, which becomes `feature_used`. |
| `scripts/write-analytics-config.js` | Writes the PostHog key into the package at build time. |
| `scripts/posthog-dashboard.js` | Creates the PostHog dashboard. |

**Performance.** `track()` is synchronous: it validates and appends to an in-memory array (about 4 µs per call). Nothing waits on the network. Starting analytics adds about 0.6 ms to activation. Delivery happens in the background in batches of up to 100, with a 10-second request timeout. Failed deliveries back off exponentially (30s up to 10 minutes), and the queue is capped at 500 events, so an offline machine never grows memory or keeps retrying. Analytics errors are caught and never reach a feature.

**Nothing is lost at shutdown or after a crash.** When VS Code quits, it closes the extension host's channels (network proxy and extension storage) while `deactivate()` is still running, so a last-moment request or `globalState` write cannot be relied on. Undelivered events and the open session are therefore checkpointed to a small local file (`analytics-checkpoint.json` in the extension's global storage folder), using plain synchronous file I/O:

- **Continuously:** the checkpoint is written every 15 seconds, only when something changed.
- **At shutdown:** the session is ended and saved first, then one delivery attempt of up to 1 second is made.

On the next start, the file is read, deleted and delivered. A session left open by a crash or force-quit is closed with `reason: interrupted`, stamped at its last interaction. Every event carries a unique `uuid`, so PostHog de-duplicates anything that is resent.

**Sessions.** A session starts on activation, or on the first interaction after 30 minutes of inactivity. It ends after 30 idle minutes (reported on the next interaction), when VS Code closes, or, after a crash, on the next start. Session ids are UUIDv7, which PostHog needs to build its sessions table. `engaged_s` adds up the gaps of 5 minutes or less between DevSnip Pro interactions, so it measures time actually spent using the extension, not time the window was open.

**Feature coverage.** Every DevSnip Pro command is registered through `registerTrackedCommand`, so every command produces exactly one `feature_used`, whether it came from the palette, the tool tree, a hub card, a context menu or a keybinding. Feature-specific events (snippets, search, copy, save, delete, dependencies, milestones) add detail on top.

## Configuring the PostHog key

Credentials live in **`.env.posthog`** in the repository root. It is git-ignored and never included in the packaged extension.

1. Copy the example file:

   ```bash
   cp .env.posthog.example .env.posthog
   ```

2. Fill in `.env.posthog`:

   | Variable | Where to find it | Used for |
   | :--- | :--- | :--- |
   | `POSTHOG_PROJECT_API_KEY` | PostHog → **Project settings** → Project API key (`phc_…`) | Built into the extension to send events |
   | `POSTHOG_HOST` | `https://eu.i.posthog.com` (EU cloud) or `https://us.i.posthog.com` (US, the default) | Where events are sent |
   | `POSTHOG_PERSONAL_API_KEY` | PostHog → **Account settings** → Personal API keys, with the `dashboard:write` and `insight:write` scopes (`phx_…`) | Dashboard script only; never shipped |
   | `POSTHOG_PROJECT_ID` | The number in the PostHog URL: `…/project/<ID>/…` | Dashboard script only |
   | `POSTHOG_APP_HOST` | `https://eu.posthog.com` or `https://us.posthog.com` | Dashboard script only |

3. Build as usual. The key is picked up automatically:

   ```bash
   npm run package
   ```

   The build prints `analytics: wrote analytics.config.json`, and only the project key and host go into the package. If no key is set, it prints that it is building without analytics.

The project key only allows *sending* events, which is why PostHog designs it to be embedded in clients. A **personal** key (`phx_…`) can read your data: the build script refuses one as `POSTHOG_PROJECT_API_KEY` and never copies it into the package.

Environment variables with the same names override `.env.posthog`. In CI, store the key as a secret (for example a GitHub Actions secret) and expose it as `POSTHOG_PROJECT_API_KEY` to the packaging step. A one-off override also works:

```bash
POSTHOG_PROJECT_API_KEY=phc_... POSTHOG_HOST=https://eu.i.posthog.com npm run package
```

For local testing of a source build, set `DEVSNIP_POSTHOG_KEY` (and optionally `DEVSNIP_POSTHOG_HOST`) plus `DEVSNIP_ANALYTICS_IN_DEV=1` in the environment VS Code is launched from. Use a separate PostHog project for testing.

## Test and production data

Every event carries an `environment` property:

| `environment` | Produced by |
| :--- | :--- |
| `production` | Builds packaged normally (`npm run package`), i.e. what is published to the Marketplace. |
| `test` / `staging` | Builds packaged with `POSTHOG_ENVIRONMENT=test` or `staging`, e.g. by `scripts/verify-analytics.js`. |
| `development` | Running from source with `DEVSNIP_ANALYTICS_IN_DEV=1`. |

`scripts/posthog-dashboard.js` sets the project's **test account filter** to `environment is not test / staging / development`. It also turns the filter on in every insight, and the HogQL tiles filter to production explicitly. Test data therefore never appears on the dashboard, and ad-hoc analysis with **Filter out internal and test users** switched on excludes it too. To look at test data, query `properties.environment = 'test'`.

## Verifying before a release

```bash
node scripts/verify-analytics.js
```

This runs a production-like end-to-end test against your PostHog project. It takes about 7 minutes:

1. **Build** two `environment=test` packages: the current version and a higher test version.
2. **Fresh install:** install the first into a brand-new, isolated VS Code profile, exactly like a Marketplace install. The extension runs in production mode, with its own user-data and extensions folders and telemetry set to `all`. A driver extension uses 15 DevSnip Pro features, waits past the 30-second flush, and quits VS Code normally.
3. **Update:** install the higher version into the same profile and repeat.
4. **Restart:** run a third short launch, which delivers anything checkpointed at the previous shutdown.
5. **Check the extension's logs** for failed PostHog requests, dropped properties and errors.
6. **Query PostHog** and check:
   - every command reached PostHog;
   - three activations, one update;
   - every earlier session has exactly one start and one end;
   - one anonymous UUID throughout;
   - install types new → updated → returning;
   - no property outside the catalog;
   - no username, home path, hostname or email;
   - no GeoIP data.

It exits non-zero if any check fails, and writes `results.json` to a temporary folder. It needs `POSTHOG_PERSONAL_API_KEY` with the `query:read` scope. Afterwards the production `analytics.config.json` is restored.

## Deployment checklist

1. `.env.posthog` holds the production `POSTHOG_PROJECT_API_KEY` and the right `POSTHOG_HOST`. In CI, use secrets with the same names.
2. `node scripts/verify-analytics.js` passes.
3. `npm run package`: the output must say `analytics: wrote analytics.config.json for … (environment: production)`. Do not set `POSTHOG_ENVIRONMENT` for Marketplace builds.
4. Publish the `.vsix`.
5. In PostHog, **Project settings → Discard client IP data** is on. The verification showed PostHog otherwise stores the request IP.
6. After release, `extension_activated` events with the new `extension_version` and `environment = production` appear on the dashboard within minutes of the first installs and updates.

## The dashboard

`scripts/posthog-dashboard.js` creates a **DevSnip Pro - Usage** dashboard with 27 insights:

- **Active users:** users active right now (last 5 minutes) and in the last hour; DAU / WAU / MAU; active users by hour; DAU/MAU stickiness; new installs versus activations; active users by extension version; platform split.
- **Feature usage:** most used features by runs and by unique users; a table of every feature with runs, users, runs per user, error rate and average duration; the 15 least used features; usage by feature area over time; first-time adoption per feature; command errors by feature.
- **Sessions and engagement:** sessions per day; average session length and engaged time; median and p90 distribution; weekly retention (activated, then used a feature).
- **Activation and onboarding:** how many installations reach each first (API request, AI tool, security scan, database connection, snippet, OpenCode) and how many days after install; Get started and What's new card actions.
- **Feature-specific:** snippets, search, copy, save and delete over time; snippets by language; how well tool search works (searches, empty results, tools opened); dependency jobs by outcome; milestones, levels and points spent.

```bash
node scripts/posthog-dashboard.js
```

It reads `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and `POSTHOG_APP_HOST` from `.env.posthog` (or the environment). The personal key is used only on your machine. Running the script again adds any missing insights and skips existing ones. `--dry-run` prints every insight definition without contacting PostHog.

Features that never appear in the feature usage table were **not used at all** in the period. Compare the table with the command list in `package.json` to find them.

## Measuring growth honestly

Each question below has one source of truth. Numbers are never mixed across sources, and nothing is done to inflate any of them: no automated or scripted installs, no review requests in exchange for points, no prompts designed to generate activity. Points reward real tool use and are capped per day for the same reason.

| Question | Source | Where to look | Notes |
| :--- | :--- | :--- | :--- |
| How many people installed it? | Visual Studio Marketplace | Publisher portal → DevSnip Pro → **Acquisition** (page views, installs, uninstalls) | Installs count downloads, not use. Updates are not installs. |
| How many installs actually started? | `extension_activated` with `install_type = new` | Dashboard: *Installs, updates and activations* | Only installs whose users allow telemetry are counted, so this is always lower than Marketplace installs. Compare trends, not absolute numbers. |
| How many are active? | Any event, distinct installations | *Active users - DAU / WAU / MAU*, *Stickiness - DAU / MAU* | An installation is a random ID per machine, not a person. |
| Do new users reach value? | `activation_milestone` | *Activation: first use of core features* | Each first fires once, on a real result: a request returned, a scan finished, a connection succeeded. Opening a panel does not count. |
| Which features are used? | `feature_used`, `tool_run_completed` | *Most used features*, *Least used features*, *Feature adoption - first uses* | `first_use` separates trying a feature from returning to it. |
| Do people come back? | `extension_activated` then `feature_used` | *Weekly retention*; `session_started` with `reason = resumed` | Retention is measured as using a feature, not just opening VS Code. |
| Does onboarding help? | `onboarding_action` | *Onboarding cards* | Compare activation rates for weeks before and after an onboarding change. |
| Who finds the GitHub repository? | GitHub | Repository → **Insights → Traffic** (views, unique visitors, referrers, popular content) | GitHub keeps 14 days; export it regularly if you need history. |
| Who reads the documentation? | The documentation site's own analytics | Page views and referrers per guide in `docs/guides/` | Not collected by the extension. |
| Do readers become users? | Marketplace acquisition referrers | Publisher portal → Acquisition, by referring source | Link to the Marketplace from guides with UTM parameters, e.g. `https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console&utm_source=github&utm_medium=readme`. The Marketplace reports the referrer; nothing about the reader is collected by DevSnip Pro. |

**Reading the numbers.** Marketplace installs, activations and active users measure different things and will never match. Track the ratios over time:

- **Activation rate:** installations with `first_tool` ÷ new installs.
- **Feature activation:** for example installations with `first_api_request` ÷ new installs.
- **Week-4 retention.**

If a change raises installs but not activation or retention, it attracted the wrong audience or set the wrong expectation.

## Adding an event

1. Add an entry to `EVENT_CATALOG` in `src/analytics/events.ts`, with a `description` and typed `properties`. Name events `object_past_tense_verb` (`report_exported`) and properties in `snake_case`.
2. Call `track("report_exported", { format: "json" })` where it happens. TypeScript rejects unknown events, unknown properties and wrongly typed values.
3. Add the event to the reference below (a unit test fails if an event is missing from this file), and add an insight to `scripts/posthog-dashboard.js` if it deserves one.

Never add a property that could carry user content. If a value is not a number, boolean, enum or short identifier, it does not belong in analytics.

## Common properties

Sent with every event.

| Property | Description |
| :--- | :--- |
| `distinct_id` | Random per-installation UUID. |
| `$session_id` | UUIDv7 of the current session. |
| `extension_version` | DevSnip Pro version. |
| `vscode_version` | VS Code version. |
| `platform` | `darwin`, `win32`, `linux` or `other`. |
| `arch` | CPU architecture, e.g. `arm64`. |
| `environment` | `production` for Marketplace builds; `test` / `staging` for verification builds, `development` for source builds. Dashboards exclude everything but `production`. |
| `$process_person_profile` | Always `false`: events are anonymous. |
| `$geoip_disable` | Always `true`: no IP-based location. |
| `$lib` | `devsnip-pro-vscode`. |

## Event reference

### `extension_activated`

The extension started in a VS Code window.

| Property | Type | Description |
| :--- | :--- | :--- |
| `first_run` | bool | First activation for a brand-new installation. False for users who had DevSnip Pro before analytics existed. |
| `install_type` | enum:new \| updated \| returning | new: first ever activation; updated: first activation after a version change (including the first version with analytics); returning: same version as last time. |
| `activation_ms` | ms | Time activate() took. |
| `ui_kind` | enum:desktop \| web | VS Code desktop or VS Code for the web. |
| `remote` | bool | Running in a remote (SSH, WSL, container, Codespaces) window. |
| `locale` | id | VS Code display language, e.g. en or de. |

### `extension_updated`

First activation after DevSnip Pro was updated to a new version.

| Property | Type | Description |
| :--- | :--- | :--- |
| `previous_version` | version | Version used before the update. Absent when updating from a version that predates analytics. |

### `session_started`

A usage session began: on activation, or on the first interaction after 30 minutes idle.

| Property | Type | Description |
| :--- | :--- | :--- |
| `reason` | enum:activation \| resumed | Why the session started. |

### `session_ended`

A usage session ended: after 30 minutes without interaction, when VS Code closed, or (reported on the next start) after a crash.

| Property | Type | Description |
| :--- | :--- | :--- |
| `reason` | enum:idle \| shutdown \| interrupted | idle: 30 minutes without interaction; shutdown: VS Code closed; interrupted: VS Code crashed or was force-quit (reported on the next start). |
| `duration_s` | seconds | From session start to the last interaction. |
| `engaged_s` | seconds | Sum of gaps of 5 minutes or less between DevSnip Pro interactions. |
| `interaction_count` | count | Tracked interactions in the session. |
| `feature_count` | count | Distinct features used in the session. |

### `feature_used`

A DevSnip Pro command ran, from any surface (palette, tool tree, hub card, context menu, keybinding).

| Property | Type | Description |
| :--- | :--- | :--- |
| `feature` | id | Command id without the extension prefix, e.g. jsonFormatter. |
| `category` | id | Feature area: the navigation section (api, frontend, mobile, code, text, convert, database, testing, git, devops, security, ai, data), or navigation, progress, core. |
| `outcome` | enum:success \| error | Whether the command handler completed without throwing. |
| `duration_ms` | ms | Time the command handler took (opening a panel, running a scan...). |
| `first_use` | bool | First time this installation used this feature. |

### `tool_search_performed`

The user searched the tool list. The query itself is never sent.

| Property | Type | Description |
| :--- | :--- | :--- |
| `query_length` | count | Length of the search pattern in characters. |
| `match_count` | count | Tools matched. |
| `invalid_pattern` | bool | The pattern was not a valid regular expression. |

### `tool_search_selected`

A tool was opened from search results.

| Property | Type | Description |
| :--- | :--- | :--- |
| `feature` | id | Command id of the chosen tool, without prefix. |
| `rank` | count | 1-based position in the results. |

### `snippet_created`

A custom snippet was saved. Its name, prefix and code are never sent.

| Property | Type | Description |
| :--- | :--- | :--- |
| `language` | id | VS Code language id, e.g. typescript. |
| `line_count` | count | Lines in the snippet body. |
| `overwrote` | bool | It replaced a snippet with the same name. |

### `snippet_deleted`

A custom snippet was deleted.

| Property | Type | Description |
| :--- | :--- | :--- |
| `language` | id | VS Code language id. |

### `request_saved`

A REST client request was saved to a collection. The URL and body are never sent.

| Property | Type | Description |
| :--- | :--- | :--- |
| `updated` | bool | It updated an existing saved request rather than adding one. |
| `collection_size` | count | Saved requests after the save. |

### `request_deleted`

A saved REST client request was deleted.

| Property | Type | Description |
| :--- | :--- | :--- |
| `collection_size` | count | Saved requests after the delete. |

### `readme_saved`

A README was saved from the README manager.

_No event-specific properties._

### `readme_deleted`

A README was deleted from the README manager.

_No event-specific properties._

### `content_copied`

The user copied generated content (a command, code...) to the clipboard. The content is never sent.

| Property | Type | Description |
| :--- | :--- | :--- |
| `feature` | id | Feature the copy came from. |
| `kind` | id | What was copied, e.g. install_command, update_command. |

### `tool_run_completed`

A toolkit tool produced a result or an error. Inputs and outputs are never sent.

| Property | Type | Description |
| :--- | :--- | :--- |
| `feature` | id | Command id of the tool, without prefix, e.g. dockerfileHelper. |
| `section` | enum:api \| frontend \| mobile \| code \| text \| convert \| database \| testing \| git \| devops \| security \| ai \| data | Navigation section of the tool (layout.ts). |
| `outcome` | enum:success \| input_error \| error \| timeout | success: a result; input_error: the tool asked for different input; error: an unexpected failure; timeout: no result within 90 seconds. |
| `trigger` | enum:run \| live \| preset \| action | run: the Run button or Ctrl/Cmd+Enter; live: automatic re-run while typing (only the first per panel is sent); preset: a preset was applied; action: a tool-specific button such as Detect from workspace. |
| `duration_ms` | ms | Time the tool took. |

### `tool_output_used`

The user did something with a toolkit tool's output. The output itself is never sent.

| Property | Type | Description |
| :--- | :--- | :--- |
| `feature` | id | Command id of the tool, without prefix. |
| `action` | enum:copy \| insert \| open \| save \| write_all | copy: to clipboard; insert: at the editor cursor; open: as a new editor; save: one file to the workspace; write_all: every generated file. |
| `file_count` | count | Files written (save and write_all only). |

### `dependency_scan_completed`

The Dependencies & Installation panel finished a scan.

| Property | Type | Description |
| :--- | :--- | :--- |
| `project_count` | count | Projects detected. |
| `dependency_count` | count | Dependencies listed. |
| `ecosystems` | id_list | Ecosystems present: node, python, maven, gradle. |
| `managers` | id_list | Package managers present: npm, yarn, pnpm, pip, maven, gradle. |
| `missing_count` | count | Missing or wrong-version dependencies. |
| `outdated_count` | count | Dependencies with an in-range update. |
| `major_count` | count | Dependencies with a newer major / out-of-range version. |
| `duration_ms` | ms | Scan time including registry lookups. |

### `dependency_job_finished`

An install or update run from the Dependencies panel finished, failed, or was declined.

| Property | Type | Description |
| :--- | :--- | :--- |
| `action` | enum:install_missing \| update_outdated \| install \| update \| upgrade | What was run. |
| `outcome` | enum:success \| error \| cancelled \| declined \| blocked | How it ended. |
| `ecosystems` | id_list | Ecosystems involved. |
| `step_count` | count | Commands in the job. |
| `duration_ms` | ms | Run time, excluding the confirmation dialog. |

### `milestone_unlocked`

The user reached a milestone.

| Property | Type | Description |
| :--- | :--- | :--- |
| `milestone` | id | Milestone id, e.g. tool_explorer. |

### `level_reached`

The user reached a new level.

| Property | Type | Description |
| :--- | :--- | :--- |
| `level` | id | Level name, e.g. Silver. |
| `level_index` | count | 0-based level index. |

### `daily_bonus_claimed`

The daily boost was claimed in the Milestones & Points panel.

_No event-specific properties._

### `points_spent`

Points were spent on a premium REST client tool.

| Property | Type | Description |
| :--- | :--- | :--- |
| `amount` | count | Points spent. |

### `activation_milestone`

A core first-time action happened. Sent once per installation per milestone, to learn which first steps lead to lasting use.

| Property | Type | Description |
| :--- | :--- | :--- |
| `milestone` | enum:first_launch \| first_tool \| first_api_request \| first_snippet \| first_ai_tool \| first_security_scan \| first_database_connection \| first_opencode | Which first: a request actually sent, a scan completed, a database connected - not just a panel opened. |
| `days_since_install` | count | Whole days between the first launch and this milestone. |

### `onboarding_action`

The user interacted with the in-product onboarding (the sidebar Getting started card, the walkthrough or What's new).

| Property | Type | Description |
| :--- | :--- | :--- |
| `action` | enum:step_opened \| guide_dismissed \| walkthrough_opened \| whats_new_opened \| whats_new_dismissed | What was done. |
| `step` | id | For step_opened: the checklist step, e.g. first_api_request. |
