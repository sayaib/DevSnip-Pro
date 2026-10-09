# DevSnip Pro analytics

DevSnip Pro sends a small amount of **anonymous** usage data to [PostHog](https://posthog.com) to answer five questions: where users are, how many there are and how many come back, which tools each user relies on, which tools are most used overall, and how usage changes day to day and month to month.

It is opt-out, follows VS Code's telemetry setting, and is limited to three events.

## What is collected, and what never is

| Event | When | Properties |
| :--- | :--- | :--- |
| `extension_active` | At most once per local day per user, when DevSnip Pro starts (or on the first tool event of a new day) | – |
| `tool_opened` | A tool's command runs successfully, from any surface (sidebar, palette, hub, context menu, keybinding). The same tool opened twice within 2 seconds counts once. | `tool`, `section` |
| `tool_used` | A tool produced a result: a toolkit run, a REST request, a database connection, a security or dependency scan, a saved snippet or README, an OpenCode launch. At most once per tool every 5 minutes, so live results and repeated runs are not counted per keystroke. | `tool`, `section` |

Every event also carries:

| Property | Example | Purpose |
| :--- | :--- | :--- |
| `distinct_id` | `3f1c…` | An anonymous id, one per computer, so a user counts once however many VS Code profiles, user-data folders or reinstalls they have. It is a SHA-256 hash of VS Code's anonymous machine id with a DevSnip Pro-specific salt, so it can't be reversed or matched with VS Code's or any other extension's telemetry. Where VS Code has no machine id, a random UUID kept in the extension's storage is used instead. A user on two computers still counts twice. |
| `extension_version` | `11.76.3` | Compare releases. |
| `environment` | `production` | Keep test builds off the dashboard (see below). |
| `tool` | `jsonFormatter` | The tool's command id, without the extension prefix. Only ids matching a strict pattern are sent. |
| `section` | `text` | The Tools sidebar section the tool lives in (`api`, `frontend`, `mobile`, `code`, `text`, `convert`, `database`, `testing`, `git`, `devops`, `security`, `ai`, `data`). |

**Never collected:** source code, file contents or names, paths, keystrokes, anything typed into a tool, tool output, URLs, request or response data, database connection strings, credentials, search queries, snippet contents, error messages, VS Code's machine id itself (only the salted hash above), or any account information. Commands that are not tools (hubs, search, Milestones & Points, settings, onboarding) are not reported at all.

**Geography** comes from PostHog's built-in GeoIP lookup of the request, which gives a country and region. DevSnip Pro asks for no location permission and sends no location of its own. See [IP addresses](#ip-addresses) for how to avoid storing the IP itself.

## Turning it off

Nothing is sent unless **all** of these hold. They are re-checked whenever settings change:

- VS Code's `telemetry.telemetryLevel` is `all`.
- `devsnip.analytics.enabled` is `true` (the default). Set it to `false` to switch DevSnip Pro analytics off on its own.
- A PostHog project key was built into the package. Forks and source builds have none.
- The extension is installed normally, not run from source or in tests.

Turning analytics off also discards anything queued or saved for later. `devsnip.analytics.debug` logs every event, exactly as sent, to the **DevSnip Pro: Analytics** output channel.

## How it works

- `src/analytics/client.ts`: the three events, de-duplication, the once-a-day rule, batching and retries. It has no VS Code dependency and is unit-tested.
- `src/analytics/index.ts`: consent checks, the anonymous id, the PostHog key, and two entry points:
  - `trackCommand`, installed on the command registry, reports `tool_opened` for every tool command that runs successfully. Which commands are tools, and their sections, comes from `src/toolkits/layout.ts` (the Tools sidebar), so analytics and the sidebar always agree.
  - `trackToolUsed(commandId)` reports `tool_used`. It is called where a tool produces a result.
- Events are sent in batches to PostHog's `/batch/` endpoint every minute, or sooner when 20 are queued. A failed delivery backs off up to 10 minutes. The queue holds at most 200 events, and each event has a unique id, so PostHog never counts a resent event twice.
- When VS Code closes, undelivered events are written to a small file in the extension's storage and sent on the next start, so restarts lose nothing.
- Person profiles are on (PostHog's default), keyed only by the anonymous id, so PostHog can count unique, new and returning users.
- Versions before 11.76.5 used a random id per VS Code profile, so one person could appear as several users. On the first start of 11.76.5 or later, DevSnip Pro sends PostHog's own `$identify` event once, with the old id as `$anon_distinct_id`. PostHog then merges the old and new ids into one person, and earlier data is counted under that person too. A brand-new install has no old id and sends no `$identify`.

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
2. **Fresh install:** install the first into a brand-new, isolated VS Code profile, exactly like a Marketplace install, with telemetry set to `all`. A driver extension opens 15 DevSnip Pro commands (tools, hubs and pages), waits for delivery, and quits VS Code normally.
3. **Update:** install the higher version into the same profile and repeat.
4. **Restart:** run a third short launch, which delivers anything saved at the previous shutdown.
5. **Check the extension's logs** for failed PostHog requests and errors.
6. **Query PostHog** and check:
   - only `extension_active`, `tool_opened` and `tool_used` arrived;
   - one `extension_active` for the day, across install, update and restart;
   - one `tool_opened` per tool that ran (hubs and pages are not tools);
   - one anonymous UUID throughout;
   - no property other than the ones listed below, and no username, home path, hostname or email;
   - PostHog added a country (GeoIP).

It exits non-zero if any check fails, and writes `results.json` to a temporary folder. It needs `POSTHOG_PERSONAL_API_KEY` with the `query:read` scope. Afterwards the production `analytics.config.json` is restored.

## Deployment checklist

1. `.env.posthog` holds the production `POSTHOG_PROJECT_API_KEY` and the right `POSTHOG_HOST`. In CI, use secrets with the same names.
2. `node scripts/verify-analytics.js` passes.
3. `npm run package`: the output must say `analytics: wrote analytics.config.json for … (environment: production)`. Do not set `POSTHOG_ENVIRONMENT` for Marketplace builds.
4. Publish the `.vsix`.
5. In PostHog, check the two settings under [IP addresses](#ip-addresses).
6. After release, `extension_active` and `tool_opened` events with the new `extension_version` and `environment = production` appear on the dashboard within minutes.

## IP addresses

PostHog sees the IP address of each request, like any web service. Two project settings decide what happens to it:

- **GeoIP** must stay enabled (it is by default) for the country insights.
- **Project settings → Discard client IP data** should be **on**. The IP is then not stored with events, but PostHog's GeoIP step still uses it to add the country and region before it is discarded ([PostHog docs](https://posthog.com/docs/privacy/data-storage)).

## The dashboard

`scripts/posthog-dashboard.js` creates (or updates) the **DevSnip Pro - Usage** dashboard:

| Question | Insights |
| :--- | :--- |
| Unique and returning users | Unique users (30 days, one number); unique users (DAU / WAU / MAU); new vs returning users (weekly lifecycle); weekly retention |
| Geography | Users by country, as a world map and as a table; each user counts once, in their latest country |
| Most-used tools | Opens per tool; unique users per tool; a ranking of every tool with opens, uses, users and opens per user |
| Per-user tool usage | One row per user: country, first and last seen, active days, tools used, opens, favourite tool and top ten tools |
| Usage frequency and trends | Daily and monthly opens, uses and users; the top ten tools over time; usage by section |

```bash
node scripts/posthog-dashboard.js
```

It reads `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` and `POSTHOG_APP_HOST` from `.env.posthog` (or the environment). The personal key is used only on your machine. Running it again updates the insights to match the script and retires (soft-deletes, restorable) insights it no longer defines, including those for events earlier versions sent. `--dry-run` prints every insight without contacting PostHog.

Tools that never appear in the ranking were **not used** in the period.

Every table counts **people** (`person_id`), not raw ids, so ids merged by `$identify` count once, and every insight applies the project's test account filter (test, staging and development builds, and internal users).

## Changing what is collected

Keep it minimal. A new `tool_used` call site only needs `trackToolUsed("<command id>")` where the tool produces a result; the id must be a tool in `src/toolkits/layout.ts` (a unit test checks the existing call sites). A new event or property needs a change to `client.ts`, this document, the property allow-list in `scripts/verify-analytics.js`, and a privacy review: no free text, ever.
