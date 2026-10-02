# DevSnip Pro architecture

DevSnip Pro is a single VS Code extension written in TypeScript. It has no backend: every feature runs in the extension host or in a webview, and network traffic goes only to endpoints the user enters, to the AI provider they choose, and to the opt-out analytics described in [ANALYTICS.md](ANALYTICS.md).

```
src/
├── extention.ts            activation: registers commands, sidebar, themes, analytics, onboarding
├── toolkits/               110 tools in 13 sections
│   ├── layout.ts           single source of truth: sections, order, labels, descriptions
│   ├── sections/*.ts       ToolSpec forms (fields, presets, actions)
│   ├── engines/*.ts        pure functions that do the work (unit-tested)
│   ├── registry.ts         stamps section/category from layout.ts, validates every tool appears once
│   ├── runner.ts, page.ts  generic toolkit panel: form → engine → Copy / Insert / Save
├── commands/               larger panels: REST API Client, security, snippets, dependencies,
│                           README manager, OpenCode, milestones, hubs
├── services/               logic behind those panels (HTTP, assertions, LLM providers,
│                           vector DBs, security analysers, dependency versions)
├── database/               Database Client: connection strings, adapters, SQL builder, panel
│   └── adapters/           PostgreSQL, MySQL, SQL Server, SQLite, MongoDB, Redis
├── sidebar/                Tools sidebar webview (search, favorites, rank card, onboarding cards)
├── onboarding/             first-use tracking, Get started guide, What's new
├── theme/                  appearance themes injected into every webview
├── premium/                points-priced features of the REST API Client
├── analytics/              anonymous, allow-listed usage events (PostHog)
└── utils/                  command registry, webview helpers, markdown, snippets
media/                      webview scripts and walkthrough pages
custom/                     snippet files contributed per language
```

## Commands

Every command is registered through `registerTrackedCommand` (`src/utils/command-registry.ts`). It is the one place that:

- records usage for points and the sidebar's *Recent* list;
- reports the outcome and duration to analytics;
- marks the id as known.

Webviews never run arbitrary commands: they post a command id, and the host runs it only if `isKnownCommand` says the extension registered it.

## Startup

Activation is kept small, around 14 ms in local measurements. The REST API Client (with axios), the security analysers and the dependency manager are registered with `registerLazyCommands`:

1. A light placeholder holds each command id.
2. On the first call, the placeholder disposes itself, imports the real module and replays the call with its arguments.
3. If loading fails, the placeholders are put back so the next call retries.

The Database Client loads a driver only when you connect, and analytics loads its HTTP client only when it sends.

## Webviews

Each panel is a webview with a strict Content-Security-Policy. Scripts load only with a per-page nonce, and data is embedded as JSON that cannot break out of its `<script type="application/json">` block.

`setWebviewHtml` adds the appearance theme. Each palette in `src/theme/themes.ts` is expanded into overrides for the `--vscode-*` colour variables the pages already use, plus shared `--ds-*` tokens. A theme change is applied live through the CSSOM, so panels keep their state.

## Data and secrets

| Data | Where it is stored |
| :--- | :--- |
| Database connection strings | VS Code SecretStorage (OS keychain). The connection list holds only a redacted summary. |
| Saved requests, collections, environments | Extension global state. Credential-looking URL values are redacted from history. |
| Snippets | The extension's `custom/` snippet files. |
| Points, milestones, onboarding progress, sidebar favorites and recents | Extension global state, per machine. |
| Appearance theme | Extension global state. |

Errors from database drivers are rewritten in `src/database/connection-string.ts`, which strips the password and other secrets before they reach the UI. Destructive SQL, Mongo and Redis statements ask for confirmation, and read-only connections refuse writes in the adapter (and, for PostgreSQL and MySQL, in the database session).

## Onboarding and activation

`src/onboarding/activation.ts` records the first time each core action really happens:

- a request returns;
- a scan finishes;
- a database connects;
- an AI tool succeeds;
- a snippet is saved;
- OpenCode launches.

It also keeps the days the extension was used. The sidebar's **Get started** and **What's new** cards and the **Feature Explorer** milestone are built from it, and each first sends one anonymous `activation_milestone` event. New users are told apart from existing ones by the analytics install snapshot, so people who update never see the beginner guide.

The native walkthrough (`contributes.walkthroughs`, pages in `media/walkthrough/`) covers the same steps on VS Code's Welcome page.

## Tests

- `npm run test:unit`: about 500 tests in plain Node with a VS Code stub. It covers engines, the security rules, the database SQL builder and redaction, analytics allow-listing, theme contrast, webview script parsing, the sidebar, onboarding and lazy loading. Live database tests run when local servers are available.
- `npm test`: the integration suite inside a real VS Code. It checks that commands are registered, panels open, points are charged correctly, and security audits run against a fixture workspace.
