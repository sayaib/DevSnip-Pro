# DevSnip Pro

A full-stack, AI/ML, security, DevOps, MLOps, and observability toolkit for VS Code. 50+ tools across 6 specialized hubs, available from the Activity Bar, the Command Palette, and the editor context menu.

- Publisher: `sayaib`
- Marketplace: https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console
- Repository: https://github.com/sayaib/DevSnip-Pro
- Documentation: https://sayaibsarkar.net/#/dev-snip-pro/document/en

## Quick Start

| Method | Action | Description |
| :----- | :----- | :---------- |
| **1. Activity Bar** | Click the **DevSnip Pro** icon | Opens the tool tree grouped by workflow |
| **2. Command Palette** | `Ctrl+Shift+P` / `Cmd+Shift+P`, then type `DevSnip Pro` | Access all commands |
| **3. Context Menu** | Right-click in the editor | Quick tools for the selected code |

## Core and Developer Utilities

| Feature | Command / Trigger | Description |
| :------ | :---------------- | :---------- |
| **REST API Client** | `sayaib.hue-console.openGUI` | Full HTTP/GraphQL client with headers, auth, cookies and history |
| **OpenCode Integration** | `sayaib.hue-console.openCodeIntegration` | Check, install/repair, and launch the OpenCode CLI (see below) |
| **Console Log Cleanup** | `sayaib.hue-console.listAndRemoveConsoleLogs` | Scan and remove `console.log` statements project-wide |
| **Unused Imports Remover** | `sayaib.hue-console.removeUnusedImports` | Automatically strip unused import statements |
| **README Viewer and Manager** | `sayaib.hue-console.readmeManager` | View, edit, create, and manage workspace README.md files |
| **Regex Builder and Tester** | `sayaib.hue-console.regexBuilder` | Live pattern matching and component explanations |
| **JSON/XML Formatter** | `sayaib.hue-console.jsonFormatter` | Format, minify, validate, and syntax highlight |
| **Hash Generator** | `sayaib.hue-console.hashGenerator` | Generate SHA-1, SHA-256, SHA-384, SHA-512 hashes |
| **Base64 Encoder/Decoder** | `sayaib.hue-console.base64Encoder` | Encode/decode strings with UTF-8 support |
| **URL Encoder/Decoder** | `sayaib.hue-console.urlEncoder` | Encode/decode components and full URLs |
| **Timestamp Converter** | `sayaib.hue-console.timestampConverter` | Convert between Unix timestamps and human dates |
| **JSON to TOON Converter** | `sayaib.hue-console.jsonToToon` | Tree Outline notation for fast data reviews |
| **Color Palette Manager** | `sayaib.hue-console.colorPalette` | Color picker, shade generator and WCAG contrast checker |
| **Lorem Ipsum Generator** | `sayaib.hue-console.loremGenerator` | Generate placeholder text with custom lengths |
| **Milestone Tracker** | `sayaib.hue-console.milestoneTracker` | Track development milestones and activity |

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

| Feature | Command / Trigger | Description |
| :------ | :---------------- | :---------- |
| **Custom Snippet Manager** | `sayaib.hue-console.createCustomSnippet` | Create, save, and reuse custom code snippets |
| **Pre-built Snippet Library** | `sayaib.hue-console.showSnippets` | 500+ snippets across 30+ languages (React, Python, Java, Go, and more) |

## AI and ML Tools Hub (`sayaib.hue-console.aiMlHub`)

| Feature | Command / Trigger | Description |
| :------ | :---------------- | :---------- |
| **Token Counter and Cost** | `sayaib.hue-console.tokenCounter` | Count LLM tokens and estimate API costs |
| **Prompt Template Manager** | `sayaib.hue-console.promptTemplate` | Manage templates with `{{variable}}` substitution |
| **Python ML Code Generator** | `sayaib.hue-console.mlCodeGen` | PyTorch, TensorFlow, HuggingFace and LangChain boilerplate |
| **LLM API Tester** | `sayaib.hue-console.llmApiTester` | Test OpenAI, Anthropic, Gemini and Ollama endpoints |
| **Dataset Split Calculator** | `sayaib.hue-console.datasetSplit` | Train/val/test splits with stratification |
| **GPU VRAM Calculator** | `sayaib.hue-console.gpuVram` | Estimate VRAM by model size and precision |
| **Experiment Logger** | `sayaib.hue-console.experimentLogger` | Log hyperparameters/metrics with Markdown export |
| **Model Card Generator** | `sayaib.hue-console.modelCard` | Generate HuggingFace-format model docs |
| **JSONL Viewer** | `sayaib.hue-console.jsonlViewer` | Parse and inspect training data in table format |
| **Markdown Table Generator** | `sayaib.hue-console.mdTableGen` | Generate clean markdown tables |
| **Dataset Profiler** | `sayaib.hue-console.datasetProfiler` | Inspect dataset columns and distributions |
| **Model Metrics Calculator** | `sayaib.hue-console.metricsCalculator` | Calculate accuracy, F1, precision, recall |
| **Prompt Playground** | `sayaib.hue-console.promptPlayground` | Interactive prompt experimentation |
| **LR Scheduler Visualizer** | `sayaib.hue-console.lrScheduler` | Visualize learning rate schedules |
| **Inference Estimator** | `sayaib.hue-console.inferenceEstimator` | LLM inference speed and memory estimator |

## Big Data Tools Hub (`sayaib.hue-console.bigDataHub`)

| Feature | Command / Trigger | Description |
| :------ | :---------------- | :---------- |
| **Schema Viewer** | `sayaib.hue-console.schemaViewer` | Interactive tree for Parquet, Avro and JSON schemas |
| **Spark SQL Formatter** | `sayaib.hue-console.sparkSqlFormatter` | Format Spark SQL, Presto, and Trino queries |
| **Data Quality Checker** | `sayaib.hue-console.dataQualityChecker` | Scan datasets for missing values and duplicates |
| **Schema Diff Tool** | `sayaib.hue-console.schemaDiff` | Compare two JSON schemas side-by-side |
| **Partition Calculator** | `sayaib.hue-console.partitionCalc` | Optimize Hadoop/Hive partitions and Spark configs |
| **Delta Lake Analyzer** | `sayaib.hue-console.deltaLakeAnalyzer` | Inspect Delta Lake transaction logs |
| **Spark Cost Estimator** | `sayaib.hue-console.sparkCostEstimator` | Estimate Spark cluster execution costs |

## RAG and Vector Search Hub (`sayaib.hue-console.ragHub`)

| Feature | Command / Trigger | Description |
| :------ | :---------------- | :---------- |
| **Chunking Strategy Tester** | `sayaib.hue-console.chunkingTester` | Compare fixed, sentence, recursive and overlap chunking |
| **Embedding Cost Calculator** | `sayaib.hue-console.embeddingCost` | Calculate embedding costs (OpenAI, Cohere, and others) |
| **Context Window Calculator** | `sayaib.hue-console.contextWindow` | Visual utilization bars and token budgeting |
| **Semantic Dedup Checker** | `sayaib.hue-console.semanticDedup` | Find near-duplicate lines using n-gram similarity |
| **RAG Eval Calculator** | `sayaib.hue-console.ragEvalScores` | Precision, recall, MRR, and faithfulness metrics |
| **Hybrid Search RRF** | `sayaib.hue-console.hybridSearchRrf` | Reciprocal Rank Fusion simulation |
| **Hallucination Analyzer** | `sayaib.hue-console.ragHallucinationAnalyzer` | Analyze RAG response grounding |

## Production Security, DevOps and Observability

| Feature | Command / Trigger | Description |
| :------ | :---------------- | :---------- |
| **Security Audit** | `sayaib.hue-console.securityAudit` | Bounded scan for hardcoded secrets, keys and unsafe code |
| **Cloud Security Audit** | `sayaib.hue-console.cloudSecurityAudit` | Scan Terraform, Kubernetes, Docker and IAM for public exposure |
| **DevOps Generator** | `sayaib.hue-console.devopsGenerator` | Generate Dockerfiles, Compose files and GitHub Actions |
| **AI/ML DevOps Generator** | `sayaib.hue-console.mlopsGenerator` | CPU/GPU containers and Kubernetes serving manifests |
| **Log Analyzer** | `sayaib.hue-console.observabilityAnalyze` | Inspect log levels, JSON structure and recommendations |
| **Observability Starter** | `sayaib.hue-console.observabilityStarter` | OpenTelemetry starters for Node.js / Python |

## Supported Languages and Technologies

- **Frontend and Mobile:** JavaScript, TypeScript, React, Vue.js, HTML, CSS, Tailwind, Flutter, Swift, Kotlin
- **Backend and Database:** Node.js, Python, PHP, Java, C#, Go, Ruby, SQL, MongoDB, Spark, Delta Lake
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

Customize behavior in your VS Code `settings.json`:

```json
{
  "devsnip.autoSuggest": true,
  "devsnip.snippetPreview": true,
  "devsnip.apiTimeout": 30000,
  "devsnip.consoleLogCleanup.confirmBeforeDelete": true
}
```

## Contributing and Support

- Documentation and guides: https://sayaibsarkar.net/#/dev-snip-pro/document/en
- Report bugs and requests: https://github.com/sayaib/DevSnip-Pro/issues
- Marketplace reviews: https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console

Made by Sayaib Sarkar (https://www.linkedin.com/in/sayaib/).
