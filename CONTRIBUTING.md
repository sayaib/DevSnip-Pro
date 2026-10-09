# Contributing to DevSnip Pro

Thanks for helping. Bug reports, tool ideas, documentation fixes and pull requests are all welcome.

## Reporting a bug or asking for a feature

Use [GitHub issues](https://github.com/sayaib/DevSnip-Pro/issues/new/choose). The templates ask for what helps most: your DevSnip Pro and VS Code versions, your OS, the steps to reproduce, and any message shown.

Please never paste connection strings, API keys or tokens into an issue. If you find a security problem, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

You need Node.js 18 or newer and VS Code 1.93 or newer.

```bash
git clone https://github.com/sayaib/DevSnip-Pro.git
cd DevSnip-Pro
npm install
npm run compile
```

Press <kbd>F5</kbd> in VS Code to start an Extension Development Host with your build. `npm run watch` recompiles as you edit.

| Script | What it does |
| :--- | :--- |
| `npm run compile` | Clean build of `src/` into `out/` |
| `npm run lint` | ESLint over `src/` |
| `npm run test:unit` | Fast unit suite in plain Node, with no VS Code download |
| `npm test` | Compile, lint, then the integration suite inside a real VS Code |

Do not run `vsce package` or `vsce publish` for a contribution. The prepublish step writes the release analytics configuration.

## Where things live

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full map. The short version:

- `src/extention.ts`: activation and command registration.
- `src/toolkits/layout.ts`: every section and tool, in order. It is the single source for the sidebar, the Browse All Tools hub, search and analytics areas.
- `src/toolkits/sections/*` and `src/toolkits/engines/*`: toolkit tools (form specs and the pure functions that do the work).
- `src/commands/*`, `src/services/*`: the REST client, security, dependencies, snippets, milestones and other panels.
- `src/database/*`: the Database Client and its adapters.
- `media/*`: webview scripts.

## Adding a toolkit tool

1. Write the logic as a pure function in `src/toolkits/engines/` and its form in a `src/toolkits/sections/` module as a `ToolSpec`.
2. Place it in `src/toolkits/layout.ts`. Choose a codicon that exists, and a one-line description of 110 characters or less.
3. Contribute its command in `package.json` (title `"<section emoji> DevSnip Pro: <Tool title>"`) and in `src/toolkits/commands.ts`.
4. Add unit tests next to similar ones in `src/test/unit/`. The suite already checks that every tool appears exactly once and that every sidebar entry has a contributed command.

## Pull request checklist

- `npm run compile`, `npm run lint` and `npm run test:unit` pass.
- New behaviour has tests; user-visible changes have a line in `CHANGELOG.md`.
- Webviews keep their Content-Security-Policy (scripts by nonce only) and send commands through `isKnownCommand`.
- Credentials never reach logs, error messages, history or analytics.
- Analytics stays minimal: three events (`extension_active`, `tool_opened`, `tool_used`), described in `docs/ANALYTICS.md`. To count a tool as used, call `trackToolUsed("<command id>")` where it produces a result. Events never contain code, inputs, URLs, file names or anything personal.
- Nothing heavy is imported during activation. Large modules load on first use (see `registerLazyCommands`).
- UI text is plain and accurate, and does not promise features that do not exist.

## Code style

TypeScript, strict mode, two-space indentation. Match the surrounding code: small functions, comments that explain *why*, and no new dependencies without a good reason.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE.txt).
