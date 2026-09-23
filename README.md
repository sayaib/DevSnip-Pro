# DevSnip Pro

A developer toolkit for VS Code: a full REST and AI API client, code snippets, workspace cleanup, security audits, and generators for DevOps, MLOps and observability. 59 commands, all local, no account needed.

## Getting started

Install the extension, then open any tool one of three ways:

- **Activity Bar** — click the DevSnip Pro icon for the tool tree, grouped by workflow.
- **Command Palette** — `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS), then type `DevSnip Pro`.
- **Editor right-click** — the **DevSnip Pro** submenu, for tools that act on the file you are in.

Most people start with the **REST API Client** (`DevSnip Pro: Rest API Client`).

## What you can do

### Test APIs

The REST API Client handles the whole request cycle: pick a method, enter a URL, set headers, query parameters, a body and authentication, then send and inspect the response.

- All HTTP methods, plus GraphQL and WebSocket
- Bearer, Basic and API-key authentication, and an OAuth 2.0 token helper
- Named environments with `{{variable}}` substitution
- Saved collections, organised in folders, with request history
- Import and export cURL commands, and generate client code in JavaScript, Python, Go, Java or C#
- Response viewer with formatting, search, copy and save
- Automated assertions, request chaining and batch performance testing

### Work with AI and LLM APIs

The same client speaks to OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint — each with the correct request shape and response parsing.

- Send prompts, stream replies, estimate tokens and cost before you send
- Validate a model's JSON output against a schema
- Compare several models side by side, and benchmark latency and throughput
- Test embeddings, vector databases (Qdrant, Pinecone, Weaviate, Chroma) and full RAG pipelines
- Trace an agent's tool-calling loop, and score prompt variants against your own criteria

### Clean up a codebase

- Find and remove `console.log` statements across the workspace
- Find and remove unused imports in JavaScript, TypeScript, Python and Java
- Audit for hard-coded secrets, unsafe code and insecure cloud configuration
- View, edit and manage README files with a live preview

### Generate what you would otherwise write by hand

- Dockerfiles, Compose files, Kubernetes manifests, Terraform, GitHub Actions
- GPU containers, model-serving manifests and ML CI pipelines
- OpenTelemetry starters and structured log schemas

### Everyday utilities

Regex builder, JSON/XML formatter, JSON→TOON converter, hash generator, Base64 and URL encoders, timestamp converter, colour palette with contrast checking, and a Lorem Ipsum generator. Plus calculators for tokens, GPU VRAM, dataset splits, Spark partitions and cluster cost.

### Save your own snippets

Select code, run **Create Your Own Perfect Code Snippet**, and give it a prefix. Snippets are contributed for 40 languages and appear in IntelliSense after a window reload. Browse and delete them under **Show Custom Snippets**.

## Points and premium tools

Most of DevSnip Pro is free and always available. A set of advanced REST API Client tools is unlocked with **points**, which you earn by using the extension — there is no licence key, subscription or account.

**How points work**

- Using DevSnip Pro earns points: any tool run (+3), creating a snippet (+10), running an audit (+8), using an AI tool (+5), a daily login (+5) and bonus (+10), plus milestones (+10 to +500). Up to 120 points a day come from tool use, plus one-time milestone bonuses.
- Each premium tool has a price from 8 to 35 points, shown next to it in the navigation and charged per run.
- Points are deducted **only after a run succeeds**. A bad key, a network error or a failing endpoint costs nothing.
- When your balance is short, the tool tells you the price, your balance and how many more points you need.

Your balance sits in the client header. The **Your points** view lists what your balance unlocks, what it does not, and how to earn more. Points are stored on your machine and work offline.

Free tools include the full REST and GraphQL workflow, response inspection, history, environments, unlimited saved collections, cURL import/export, code generation, JWT decoding, JSON tools, and single AI requests with prompt testing, token costing, streaming and schema validation. Free AI use is capped per day at 25 requests, 25 prompt runs and 10 streamed responses.

## OpenCode integration

**DevSnip Pro: OpenCode Integration** manages the OpenCode CLI from inside VS Code on Windows, macOS and Linux. It checks for Node.js and the `opencode` binary, installs or repairs it via npm, and launches it in a terminal rooted at your workspace.

Install is only reported as successful once `opencode --version` actually runs, so a partial install shows as broken rather than green. Per-OS alternatives are shown in the panel: npm, Homebrew, the install script, and Chocolatey or Scoop on Windows.

## Settings

| Setting | Default | What it does |
| :--- | :--- | :--- |
| `devsnip.apiTimeout` | `30000` | Request timeout in milliseconds for the REST API Client. A per-request timeout overrides it. |
| `devsnip.consoleLogCleanup.confirmBeforeDelete` | `true` | Ask before removing `console.log` statements. |
| `devsnip.securityAudit.maxFiles` | `2000` | How many files each security or cloud audit reads. |

## Keyboard shortcuts

None are set by default, so nothing conflicts with your existing bindings. To add your own, open **Preferences: Open Keyboard Shortcuts (JSON)**:

```json
[
  { "key": "ctrl+shift+a", "command": "sayaib.hue-console.openGUI" },
  { "key": "ctrl+shift+s", "command": "sayaib.hue-console.createCustomSnippet" },
  { "key": "ctrl+shift+l", "command": "sayaib.hue-console.listAndRemoveConsoleLogs" }
]
```

## Requirements

- **VS Code 1.93 or newer.**
- **A trusted workspace** for anything that reads your files or runs a command. DevSnip Pro does not run in Restricted Mode.
- **An open folder** for audits, cleanup tools, the README manager and the generators. They tell you to open one rather than failing quietly.
- **Node.js and npm** only for the OpenCode integration. Everything else runs without them.
- **Network access** only for the API clients and the OpenCode install. Every other tool works offline.

Works on Windows, macOS and Linux. Desktop VS Code only — several tools use Node APIs, so it does not run in browser-only environments such as vscode.dev. In a remote or virtual workspace everything works except the OpenCode hub, which needs a local process.

## Troubleshooting

**A new snippet does not appear in IntelliSense.** VS Code loads snippets at startup. Reload the window — the extension offers this after you save one.

**OpenCode is installed but not detected.** A VS Code window launched from the Dock or a desktop shortcut inherits a minimal `PATH`. The hub also searches the usual install locations; if yours is elsewhere, start VS Code from a terminal or add the directory to `PATH`, then press **Recheck System**.

**The OpenCode install fails.** Usually a permissions problem with the global npm prefix. The hub opens a terminal with the command ready — run it there (with `sudo` if your prefix needs it) and press **Recheck System**.

**On Windows, OpenCode does not start when launched.** PowerShell may show a script security prompt. Answer it in the terminal, use the **Launch in Command Prompt** fallback, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**A security audit finds nothing in a large repository.** It reads up to `devsnip.securityAudit.maxFiles` files and skips dependency, build and cache folders. Raise the setting for very large repositories.

**A request never finishes.** Requests time out after `devsnip.apiTimeout`. Use **Cancel** to stop one that is running.

**Saving a snippet reports it cannot write.** Snippets live in the extension folder, which must be writable. This can fail if the extension was installed somewhere read-only.

**Points look wrong.** Progress is stored per machine. Corrupted data is repaired automatically when read, and **Reset Data** in the Milestone Tracker clears it.

## Privacy

Everything runs locally. DevSnip Pro has no backend, no telemetry and no account. Requests go only to the URLs you enter, and API keys you type are used for that request and are not written to history or to disk. Credential-looking values in a URL are redacted before a request is stored in history.

## Development

```bash
npm install          # install dependencies
npm run compile      # clean build to out/
npm run lint         # ESLint over src/
npm run test:unit    # fast unit suite, plain Node, no VS Code needed
npm test             # compile, lint, then the VS Code integration suite
npm run package      # produce the .vsix
```

## Links and support

- Marketplace: https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console
- Source and issues: https://github.com/sayaib/DevSnip-Pro
- Documentation: https://sayaibsarkar.net/#/dev-snip-pro/document/en

Made by Sayaib Sarkar — https://www.linkedin.com/in/sayaib/
