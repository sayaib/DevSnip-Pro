# DevSnip Pro

A full-stack, AI/ML, security, DevOps, MLOps, and observability toolkit for VS Code. 57 commands across 6 specialised hubs, available from the Activity Bar, the Command Palette, and an editor context submenu.

- Publisher: `sayaib`
- Marketplace: https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console
- Repository: https://github.com/sayaib/DevSnip-Pro

## Quick Start

| Method                 | Action                                                  | Description                                                                                                 |
| :--------------------- | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------- |
| **1. Activity Bar**    | Click the **DevSnip Pro** icon                          | Opens the tool tree grouped by workflow                                                                     |
| **2. Command Palette** | `Ctrl+Shift+P` / `Cmd+Shift+P`, then type `DevSnip Pro` | Access all commands                                                                                         |
| **3. Context Menu**    | Right-click in the editor, then **DevSnip Pro**         | Snippet creation, JSON/XML formatting, console-log and unused-import cleanup, log analysis, and tool search |

## Core and Developer Utilities

| Feature                       | Command / Trigger                             | Description                                                                                                                                                                                                                  |
| :---------------------------- | :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Developer Tools Hub** | `sayaib.hue-console.advancedToolsHub` | Landing page for the utilities below; each card opens its tool |
| **Search All Tools** | `sayaib.hue-console.searchTools` | Find any tool by name, category or command with a regular expression |
| **REST API Client**           | `sayaib.hue-console.openGUI`                  | Full HTTP/GraphQL client with headers, auth (Bearer/Basic/API Key), body types (JSON/Text/Form URL Encoded), auto-retry with backoff, redirect/SSL/proxy controls, cURL import & export, history export, cookies and history |
| **OpenCode Integration**      | `sayaib.hue-console.openCodeIntegration`      | Check, install/repair, and launch the OpenCode CLI (see below)                                                                                                                                                               |
| **Console Log Cleanup**       | `sayaib.hue-console.listAndRemoveConsoleLogs` | Scan and remove `console.log` statements project-wide                                                                                                                                                                        |
| **Unused Imports Remover**    | `sayaib.hue-console.removeUnusedImports`      | Automatically strip unused import statements                                                                                                                                                                                 |
| **README Viewer and Manager** | `sayaib.hue-console.readmeManager`            | View, edit, create, and manage workspace README.md files                                                                                                                                                                     |
| **Regex Builder and Tester**  | `sayaib.hue-console.regexBuilder`             | Live pattern matching and component explanations                                                                                                                                                                             |
| **JSON/XML Formatter**        | `sayaib.hue-console.jsonFormatter`            | Format, minify, validate, and syntax highlight                                                                                                                                                                               |
| **Hash Generator**            | `sayaib.hue-console.hashGenerator`            | Generate SHA-1, SHA-256, SHA-384, SHA-512 hashes                                                                                                                                                                             |
| **Base64 Encoder/Decoder**    | `sayaib.hue-console.base64Encoder`            | Encode/decode strings with UTF-8 support                                                                                                                                                                                     |
| **URL Encoder/Decoder**       | `sayaib.hue-console.urlEncoder`               | Encode/decode components and full URLs                                                                                                                                                                                       |
| **Timestamp Converter**       | `sayaib.hue-console.timestampConverter`       | Convert between Unix timestamps and human dates                                                                                                                                                                              |
| **JSON to TOON Converter**    | `sayaib.hue-console.jsonToToon`               | Tree Outline notation for fast data reviews                                                                                                                                                                                  |
| **Color Palette Manager**     | `sayaib.hue-console.colorPalette`             | Color picker, shade generator and WCAG contrast checker                                                                                                                                                                      |
| **Lorem Ipsum Generator**     | `sayaib.hue-console.loremGenerator`           | Generate placeholder text with custom lengths                                                                                                                                                                                |
| **Milestone Tracker**         | `sayaib.hue-console.milestoneTracker`         | Track development milestones and activity                                                                                                                                                                                    |

### OpenCode Integration

The OpenCode Integration Hub (`sayaib.hue-console.openCodeIntegration`) manages the OpenCode CLI from inside VS Code. It works on Windows, macOS, and Linux.

How it works:

1. **System check** -- verifies Node.js (`node -v`) and the `opencode` binary (`opencode --version`, with PATH and global npm fallbacks).
2. **Install / Repair** -- installs the official `opencode-ai` npm package globally. If a partial install is detected (npm lists the package but the binary does not run), it removes the stale package and reinstalls cleanly. If automated install fails (for example a permissions issue), it opens a terminal with the install command ready to run.
3. **Recheck System** -- re-runs detection and updates the status badges and available actions.
4. **Launch** -- opens OpenCode in an integrated terminal rooted at the current workspace folder.

Install success is only reported after `opencode --version` is verified to run. Per-OS alternatives are shown in the hub: npm, Homebrew (`brew install anomalyco/tap/opencode`), the install script (`curl -fsSL https://opencode.ai/install | bash`), Chocolatey/Scoop on Windows, and WSL guidance.

Windows note: PowerShell may show a script security prompt for VS Code's shell integration when launching. The hub waits for the shell to be ready before running `opencode`. If the prompt blocks the launch, answer it in the terminal, use the offered Command Prompt fallback, or permanently allow local scripts by running `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` in PowerShell.

## Snippets and Templates

| Feature                   | Command / Trigger                        | Description                                                                                                                                                                 |
| :------------------------ | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Custom Snippet** | `sayaib.hue-console.createCustomSnippet` | Turn the current selection into a reusable snippet. Prompts for a prefix, name and description, warns before overwriting, and offers a window reload so VS Code picks it up |
| **Saved Snippets**        | `sayaib.hue-console.showSnippets`        | Browse, filter and delete the snippets you have created, grouped by language                                                                                                |

Snippets are stored as `custom/custom_<language>.json` inside the extension folder and are contributed for **40 languages** (JavaScript, TypeScript, React, Python, Java, Go, Rust, C/C++, C#, PHP, Ruby, Swift, Dart, SQL, YAML, Dockerfile and more). The extension ships those files empty: the library is the one you build. VS Code reads contributed snippet files at startup, so a new snippet becomes available after a window reload.

> Snippets live inside the extension directory, which means a marketplace update replaces them. Export anything you want to keep, or store long-lived snippets in a VS Code user snippet file (`Preferences: Configure User Snippets`).

## AI and ML Tools Hub (`sayaib.hue-console.aiMlHub`)

| Feature                      | Command / Trigger                       | Description                                                |
| :--------------------------- | :-------------------------------------- | :--------------------------------------------------------- |
| **Token Counter and Cost**   | `sayaib.hue-console.tokenCounter`       | Count LLM tokens and estimate API costs                    |
| **Prompt Template Manager**  | `sayaib.hue-console.promptTemplate`     | Manage templates with `{{variable}}` substitution          |
| **Python ML Code Generator** | `sayaib.hue-console.mlCodeGen`          | PyTorch, TensorFlow, HuggingFace and LangChain boilerplate |
| **LLM API Tester**           | `sayaib.hue-console.llmApiTester`       | Test OpenAI, Anthropic, Gemini and Ollama endpoints        |
| **Dataset Split Calculator** | `sayaib.hue-console.datasetSplit`       | Train/val/test splits with stratification                  |
| **GPU VRAM Calculator**      | `sayaib.hue-console.gpuVram`            | Estimate VRAM by model size and precision                  |
| **Experiment Logger**        | `sayaib.hue-console.experimentLogger`   | Log hyperparameters/metrics with Markdown export           |
| **Model Card Generator**     | `sayaib.hue-console.modelCard`          | Generate HuggingFace-format model docs                     |
| **JSONL Viewer**             | `sayaib.hue-console.jsonlViewer`        | Parse and inspect training data in table format            |
| **Markdown Table Generator** | `sayaib.hue-console.mdTableGen`         | Generate clean markdown tables                             |
| **Dataset Profiler**         | `sayaib.hue-console.datasetProfiler`    | Inspect dataset columns and distributions                  |
| **Model Metrics Calculator** | `sayaib.hue-console.metricsCalculator`  | Calculate accuracy, F1, precision, recall                  |
| **Prompt Playground**        | `sayaib.hue-console.promptPlayground`   | Interactive prompt experimentation                         |
| **LR Scheduler Visualizer**  | `sayaib.hue-console.lrScheduler`        | Visualize learning rate schedules                          |
| **Inference Estimator**      | `sayaib.hue-console.inferenceEstimator` | LLM inference speed and memory estimator                   |

## Big Data Tools Hub (`sayaib.hue-console.bigDataHub`)

| Feature                  | Command / Trigger                       | Description                                         |
| :----------------------- | :-------------------------------------- | :-------------------------------------------------- |
| **Schema Viewer**        | `sayaib.hue-console.schemaViewer`       | Interactive tree for Parquet, Avro and JSON schemas |
| **Spark SQL Formatter**  | `sayaib.hue-console.sparkSqlFormatter`  | Format Spark SQL, Presto, and Trino queries         |
| **Data Quality Checker** | `sayaib.hue-console.dataQualityChecker` | Scan datasets for missing values and duplicates     |
| **Schema Diff Tool**     | `sayaib.hue-console.schemaDiff`         | Compare two JSON schemas side-by-side               |
| **Partition Calculator** | `sayaib.hue-console.partitionCalc`      | Optimize Hadoop/Hive partitions and Spark configs   |
| **Delta Lake Analyzer**  | `sayaib.hue-console.deltaLakeAnalyzer`  | Inspect Delta Lake transaction logs                 |
| **Spark Cost Estimator** | `sayaib.hue-console.sparkCostEstimator` | Estimate Spark cluster execution costs              |

## RAG and Vector Search Hub (`sayaib.hue-console.ragHub`)

| Feature                       | Command / Trigger                             | Description                                             |
| :---------------------------- | :-------------------------------------------- | :------------------------------------------------------ |
| **Chunking Strategy Tester**  | `sayaib.hue-console.chunkingTester`           | Compare fixed, sentence, recursive and overlap chunking |
| **Embedding Cost Calculator** | `sayaib.hue-console.embeddingCost`            | Calculate embedding costs (OpenAI, Cohere, and others)  |
| **Context Window Calculator** | `sayaib.hue-console.contextWindow`            | Visual utilization bars and token budgeting             |
| **Semantic Dedup Checker**    | `sayaib.hue-console.semanticDedup`            | Find near-duplicate lines using n-gram similarity       |
| **RAG Eval Calculator**       | `sayaib.hue-console.ragEvalScores`            | Precision, recall, MRR, and faithfulness metrics        |
| **Hybrid Search RRF**         | `sayaib.hue-console.hybridSearchRrf`          | Reciprocal Rank Fusion simulation                       |
| **Hallucination Analyzer**    | `sayaib.hue-console.ragHallucinationAnalyzer` | Analyze RAG response grounding                          |

## Production Security, DevOps and Observability

| Feature                    | Command / Trigger                         | Description                                                    |
| :------------------------- | :---------------------------------------- | :------------------------------------------------------------- |
| **Security Audit**         | `sayaib.hue-console.securityAudit`        | Bounded scan for hardcoded secrets, keys and unsafe code       |
| **Cloud Security Audit**   | `sayaib.hue-console.cloudSecurityAudit`   | Scan Terraform, Kubernetes, Docker and IAM for public exposure |
| **DevOps Generator**       | `sayaib.hue-console.devopsGenerator`      | Generate Dockerfiles, Compose files and GitHub Actions         |
| **AI/ML DevOps Generator** | `sayaib.hue-console.mlopsGenerator`       | CPU/GPU containers and Kubernetes serving manifests            |
| **Log Analyzer**           | `sayaib.hue-console.observabilityAnalyze` | Inspect log levels, JSON structure and recommendations         |
| **Observability Starter**  | `sayaib.hue-console.observabilityStarter` | OpenTelemetry starters for Node.js / Python                    |

## Supported Languages and Technologies

- **Frontend and Mobile:** JavaScript, TypeScript, React, Vue.js, HTML, CSS, Tailwind, Flutter, Swift, Kotlin
- **Backend and Database:** Node.js, Python, PHP, Java, C#, Go, Ruby, SQL, Spark, Delta Lake
- **DevOps and Cloud:** Docker, Kubernetes, Terraform, GitHub Actions, OpenTelemetry

## Keyboard Shortcuts

Add these to your VS Code `keybindings.json`:

```json
[
  {
    "key": "ctrl+shift+a",
    "command": "sayaib.hue-console.openGUI",
    "when": "editorTextFocus"
  },
  {
    "key": "ctrl+shift+s",
    "command": "sayaib.hue-console.createCustomSnippet",
    "when": "editorTextFocus"
  },
  {
    "key": "ctrl+shift+l",
    "command": "sayaib.hue-console.listAndRemoveConsoleLogs",
    "when": "editorTextFocus"
  }
]
```

## Configuration

| Setting                                         | Default | Description                                                                                                 |
| :---------------------------------------------- | :------ | :---------------------------------------------------------------------------------------------------------- |
| `devsnip.apiTimeout`                            | `30000` | Default request timeout (ms) for the REST API Client. A per-request timeout set in the client overrides it. |
| `devsnip.consoleLogCleanup.confirmBeforeDelete` | `true`  | Ask before removing console.log statements. Set to `false` to remove them immediately.                      |
| `devsnip.securityAudit.maxFiles`                | `2000`  | Maximum number of files each security or cloud audit reads.                                                 |

```json
{
  "devsnip.apiTimeout": 30000,
  "devsnip.consoleLogCleanup.confirmBeforeDelete": true,
  "devsnip.securityAudit.maxFiles": 2000
}
```

## Requirements and Platform Support

| Requirement           | Needed for                                                                            | Notes                                                                                        |
| :-------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| VS Code 1.93 or newer | Everything                                                                            | Terminal shell integration is used to launch OpenCode reliably                               |
| A trusted workspace   | Workspace scans, generators, OpenCode                                                 | The extension reads workspace files and can run `npm`, so it does not run in Restricted Mode |
| An open folder        | Security audits, cleanup tools, README manager, DevOps/MLOps/observability generators | These tools tell you to open a folder rather than failing silently                           |
| Node.js and npm       | OpenCode Integration only                                                             | Detected automatically; every other tool runs without them                                   |
| Network access        | REST API Client, LLM API Tester, OpenCode install                                     | All other tools run fully offline                                                            |

Tested and supported on **Windows, macOS and Linux**. Paths, executable names (`npm` vs `npm.cmd`), process spawning and shell behaviour are handled per platform, and no platform-specific path is hard-coded. Desktop VS Code only: several tools use Node APIs (`child_process`, `fs`), so the extension does not run in a browser-only environment such as vscode.dev. In a virtual (remote filesystem) workspace everything works except the OpenCode Integration Hub, which needs a local process.

## Troubleshooting

| Symptom                                                | Cause and fix                                                                                                                                                                                                                                                                                                                                      |
| :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new snippet does not appear in IntelliSense          | VS Code loads contributed snippets at startup. Reload the window (the extension offers this after saving).                                                                                                                                                                                                                                         |
| "OpenCode is not detected" although it is installed    | A VS Code window launched from the Dock or a desktop entry inherits a minimal `PATH`. The hub also searches `/usr/local/bin`, `/opt/homebrew/bin`, `~/.opencode/bin`, `~/.local/bin`, `~/.bun/bin` and the npm prefix. If your install is elsewhere, launch VS Code from a terminal or add the directory to `PATH`, then press **Recheck System**. |
| "Broken install" reported for OpenCode                 | The package is present but `opencode --version` does not run. Press **Repair OpenCode Now**, which removes and reinstalls it cleanly.                                                                                                                                                                                                              |
| The automated OpenCode install fails                   | Usually a permissions problem with the global npm prefix. The hub opens a terminal with the command ready; run it there (with `sudo` on macOS/Linux if your prefix needs it), then press **Recheck System**.                                                                                                                                       |
| Windows: OpenCode does not start after clicking Launch | PowerShell may show a script security prompt. Answer it in the terminal, use the offered **Launch in Command Prompt** fallback, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.                                                                                                                                                      |
| A security audit reports nothing in a large repository | The audit reads up to `devsnip.securityAudit.maxFiles` files (default 2000) and skips dependency, build and cache directories. Raise the setting for very large repositories.                                                                                                                                                                      |
| A REST request never completes                         | Requests time out after `devsnip.apiTimeout` (default 30s). Use **Cancel** to abort a running request.                                                                                                                                                                                                                                             |
| Snippet creation reports it cannot write               | Snippets are written into the extension folder, which must be writable. This can fail if the extension was installed to a read-only location.                                                                                                                                                                                                      |
| Points or milestones look wrong                        | Progress is stored per machine in VS Code global state. Corrupted data is repaired automatically on read; **Reset Data** in the Milestone Tracker clears it.                                                                                                                                                                                       |

## Development

```bash
npm install          # install dependencies
npm run compile      # clean build to out/
npm run lint         # ESLint over src/
npm run test:unit    # fast unit suite (plain Node, no VS Code needed)
npm test             # compile + lint + VS Code integration suite
npm run package      # produce the .vsix
```

## Contributing and Support

- Documentation and guides: https://sayaibsarkar.net/#/dev-snip-pro/document/en
- Report bugs and requests: https://github.com/sayaib/DevSnip-Pro/issues
- Marketplace reviews: https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console

Made by Sayaib Sarkar (https://www.linkedin.com/in/sayaib/).
