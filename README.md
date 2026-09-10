<div align="center">

# DevSnip Pro

### The Ultimate Developer Productivity Extension for VS Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/sayaib.hue-console?style=for-the-badge&label=VS%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/sayaib.hue-console?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
[![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/sayaib.hue-console?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
[![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/sayaib.hue-console?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console&ssr=false#review-details)

**41 built-in tools** across API testing, code snippets, developer utilities, AI/ML, Big Data, RAG, Security, DevOps, MLOps, and Observability — all inside VS Code.

The extension also includes production-focused Security, DevOps, and Observability tools for workspace audits, deployment artifact generation, and log analysis.

[Installation](#installation) | [Features](#features) | [Configuration](#configuration) | [Contributing](#contributing)

</div>

---

## How to Access

> **After installing, there are 3 ways to open DevSnip Pro:**

### Option 1 — Activity Bar (Easiest)

Click the **DevSnip Pro** icon in the **left sidebar** of VS Code. This opens a clean, searchable tree with tools grouped by workflow.

### Option 2 — Command Palette

1. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Mac)
2. Type `DevSnip Pro`
3. Pick any command from the list

### Option 3 — Editor Context Menu

Select code in the editor, **right-click**, and choose an available DevSnip Pro option from the context menu.

### Current tool groups

- Core — API testing, console cleanup, and import cleanup
- Snippets — create and browse reusable snippets
- AI & ML — model, prompt, dataset, and LLM utilities
- Data & RAG — schemas, data quality, partitioning, chunking, and RAG evaluation
- Security — local code security and local cloud-configuration audits
- DevOps & Observability — Docker, Kubernetes, Terraform, MLOps, log analysis, and telemetry starters
- Utilities — formatting, encoding, regex, colors, hashes, and other developer helpers

---

## Features

### Index

| #   | Feature                                                               | Description                                                                                           |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | [REST API Client](#1-rest-api-client)                                 | Full-featured HTTP/GraphQL client with environments, auth, cookies, and history                       |
| 2   | [Custom Snippet Management](#2-custom-snippet-management)             | Create, save, and reuse your own code snippets                                                        |
| 3   | [Pre-built Snippet Library](#3-pre-built-snippet-library)             | 500+ snippets across 30+ languages and frameworks                                                     |
| 4   | [Console Log Cleanup](#4-console-log-cleanup)                         | Detect and remove console.log statements project-wide                                                 |
| 5   | [Unused Imports Remover](#5-unused-imports-remover)                   | Clean up unused import statements automatically                                                       |
| 6   | [Regex Builder & Tester](#6-regex-builder--tester)                    | Build and test regular expressions with real-time matching                                            |
| 7   | [JSON/XML Formatter](#7-xmlformatter)                                 | Format, minify, validate, and syntax-highlight JSON and XML                                           |
| 8   | [Hash Generator](#8-hash-generator)                                   | Generate SHA-1, SHA-256, SHA-384, and SHA-512 hashes                                                  |
| 9   | [Base64 Encoder/Decoder](#9-base64-encoderdecoder)                   | Encode and decode Base64 strings with UTF-8 support                                                   |
| 10  | [URL Encoder/Decoder](#10-url-encoderdecoder)                         | Encode and decode URL components and full URLs                                                        |
| 11  | [Timestamp Converter](#11-timestamp-converter)                        | Convert between Unix timestamps and human-readable dates                                              |
| 12  | [JSON to TOON Converter](#12-json-to-toon-converter)                  | Convert JSON to Tree Outline notation for quick reviews                                               |
| 13  | [Color Palette](#13-color-palette)                                    | Pick colors, generate palettes, and check WCAG contrast ratios                                        |
| 14  | [Lorem Ipsum Generator](#14-lorem-ipsum-generator)                    | Generate placeholder text with configurable length                                                    |
| 15  | [Token Counter & Cost Calculator](#15-token-counter--cost-calculator) | Count tokens for LLM models and estimate API costs                                                    |
| 16  | [Prompt Template Manager](#16-prompt-template-manager)                | Create, save, and manage prompt templates with variables                                              |
| 17  | [Python ML Code Generator](#17-python-ml-code-generator)              | Generate PyTorch, TensorFlow, HuggingFace, and LangChain boilerplate                                  |
| 18  | [LLM API Tester](#18-llm-api-tester)                                  | Test OpenAI, Anthropic, Gemini, and Ollama API endpoints                                              |
| 19  | [Dataset Split Calculator](#19-dataset-split-calculator)              | Calculate train/val/test splits with stratification                                                   |
| 20  | [GPU VRAM Calculator](#20-gpu-vram-calculator)                        | Estimate VRAM requirements by model size and precision                                                |
| 21  | [Experiment Logger](#21-experiment-logger)                            | Log hyperparameters, metrics, and results with Markdown export                                        |
| 22  | [Model Card Generator](#22-model-card-generator)                      | Generate standardized HuggingFace-format model documentation                                          |
| 23  | [JSONL Viewer](#23-jsonl-viewer)                                      | Parse and inspect JSONL training data in a readable table                                             |
| 24  | [Markdown Table Generator](#24-markdown-table-generator)              | Generate markdown tables for documentation and reports                                                |
| 25  | [Schema Viewer](#25-schema-viewer)                                    | Visualize Parquet, Avro, and JSON schemas as an interactive tree                                      |
| 26  | [Spark SQL Formatter](#26-spark-sql-formatter)                        | Format Spark SQL, Presto, and Trino queries                                                           |
| 27  | [Data Quality Checker](#27-data-quality-checker)                      | Analyze CSV/JSON datasets for missing values, duplicates, and stats                                   |
| 28  | [Schema Diff Tool](#28-schema-diff-tool)                              | Compare two JSON schemas side-by-side                                                                 |
| 29  | [Partition Calculator](#29-partition-calculator)                      | Calculate optimal Hadoop/Hive partitions and Spark config                                             |
| 30  | [Chunking Strategy Tester](#30-chunking-strategy-tester)              | Compare fixed, sentence, recursive, and overlap chunking                                              |
| 31  | [Embedding Cost Calculator](#31-embedding-cost-calculator)            | Calculate embedding costs across OpenAI, Cohere, and HuggingFace                                      |
| 32  | [Context Window Calculator](#32-context-window-calculator)            | Plan context window usage with visual utilization bars                                                |
| 33  | [Semantic Dedup Checker](#33-semantic-dedup-checker)                  | Find near-duplicate lines using n-gram similarity                                                     |
| 34  | [RAG Eval Calculator](#34-rag-eval-calculator)                        | Evaluate RAG quality with precision, recall, MRR, and faithfulness                                    |
| 35  | Security Audit                                                        | Bounded workspace scan for secrets and high-risk code patterns with redacted evidence                 |
| 36  | Local Cloud Security Audit                                            | Scan Terraform, Kubernetes, Docker, IAM, and cloud config for risky permissions and exposure          |
| 37  | DevOps Artifact Generator                                             | Generate stack-aware Docker, Compose, and GitHub Actions starter files                                |
| 38  | AI/ML DevOps Generator                                                | Generate CPU/GPU containers, Kubernetes GPU serving, ML CI, and model contracts                       |
| 39  | Observability Log Analyzer                                            | Inspect selected or open logs for levels, JSON structure, timestamps, and reliability recommendations |
| 40  | Observability Starter Generator                                       | Generate structured-log schema and Node.js/Python OpenTelemetry starter files                         |

---

## Production Engineering Tools

### Security Audit

Runs a bounded, local-only scan across supported text files. It skips dependency/build directories, ignores binary files and files larger than 1 MB, redacts evidence in the report, and detects private keys, common cloud tokens, hard-coded credentials, database URLs, unsafe dynamic execution, shell interpolation, and non-local HTTP URLs. Findings are written to the `DevSnip Pro Security` output channel. This is a fast developer check, not a replacement for dependency auditing, SAST, or CI secret scanning.

### Local Cloud Security Audit

The separate Security Center cloud audit scans local Terraform, Kubernetes, Docker, IAM, and cloud configuration files. It checks for public network ingress (`0.0.0.0/0`), wildcard IAM permissions, public storage, privileged or host-network containers, embedded cloud credentials, disabled encryption/TLS, and mutable `:latest` images. It is read-only and never connects to a cloud account. Live AWS, Azure, or GCP account auditing requires an explicitly configured provider integration and is intentionally not assumed.

### DevOps Artifact Generator

Generates one reviewed-at-open artifact at a time: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, GitHub Actions CI, Kubernetes Deployment/Service manifests, Terraform Docker infrastructure, or a secure CodeQL/Gitleaks workflow. The generator detects Node.js and Python projects, uses non-root containers where supported, adds restart and healthcheck settings, uses pinned major action versions, and asks before overwriting an existing file.

### AI/ML DevOps Generator

The dedicated MLOps generator creates a non-root CPU model-serving container, a CUDA/GPU container, a Kubernetes GPU deployment with probes and resource requests, an ML CI workflow, and a model-serving contract. Templates include model versioning, readiness checks, request IDs, latency metadata, checksum guidance, and feature-schema validation requirements.

### Observability Log Analyzer

Analyzes the current editor or selected log text without uploading it anywhere. It reports detected error/warning/info/debug levels, valid JSON lines, timestamp coverage, and practical recommendations for structured logs, UTC timestamps, request IDs, and secret-safe error logging.

### Observability Starter Generator

Creates an OpenTelemetry starter for Node.js or Python and a JSON Schema for structured logs. The generated files are intentionally reviewable templates: install the matching OpenTelemetry packages, configure an exporter, and start telemetry once during application bootstrap.

### 1. REST API Client

A full-featured API client built directly into VS Code — no need to switch to Postman or Insomnia.

**Capabilities:**

- All HTTP methods: `GET` `POST` `PUT` `DELETE` `PATCH` `HEAD` `OPTIONS`
- GraphQL support with query editor, variables, and operation name
- Request headers and body (JSON, text, form data)
- Bearer Token and Basic Auth authentication
- Query parameter builder
- Environment variables with `{{variable}}` syntax
- Cookie management (view, copy, clear per domain)
- Request history with status, response time, and size
- JSON syntax highlighting in responses
- Configurable timeout (1–300 seconds)
- Cancel in-flight requests
- cURL paste support

**How to Use:**

1. Open the API Client from the Activity Bar or Command Palette
2. Select the HTTP method from the dropdown
3. Enter the request URL
4. Configure headers, auth, body, or GraphQL query as needed
5. Click **Send**
6. View the response with syntax highlighting and timing info

---

### 2. Custom Snippet Management

Create, organize, and reuse your own code snippets.

**How to Create:**

1. Select code in the editor
2. Right-click and choose **"DevSnip Pro: Create Custom Snippet"**
3. Fill in the prefix, name, and description
4. Save — your snippet is now available via autocomplete

**Using Snippets:**

1. Type your snippet prefix in any file
2. Select from autocomplete suggestions
3. Press `Tab` to insert

---

### 3. Pre-built Snippet Library

Access **500+** carefully crafted snippets across **30+** technologies:

| Category         | Languages/Frameworks                             |
| ---------------- | ------------------------------------------------ |
| Frontend         | JavaScript, TypeScript, React, Vue.js, HTML, CSS |
| CSS Frameworks   | Bootstrap, Tailwind CSS                          |
| Backend          | Node.js, Python, PHP, Java, C#, Go, Ruby         |
| Mobile           | Flutter/Dart, Swift, Kotlin                      |
| Database         | MongoDB, SQL                                     |
| State Management | Redux, React Query, React Router                 |
| Other            | JSON, YAML, Markdown, Shell Scripts              |

Browse snippets via Command Palette: `DevSnip Pro: Show Custom Snippets`

---

### 4. Console Log Cleanup

Detect and remove `console.log` statements across your entire project.

- Project-wide scan for all `console.log` statements
- Preview before deletion
- Selective or bulk removal
- Multiline log support
- Preserves `console.error`, `console.warn`, etc. (configurable)

---

### 5. Unused Imports Remover

Automatically detect and remove unused import statements from the current file.

Run via Command Palette: `DevSnip Pro: Remove Unused Imports`

---

### 6. Regex Builder & Tester

Build, test, and debug regular expressions with real-time match visualization.

- Pattern input with live matching
- Match highlighting on test strings
- Explanation of regex components
- Common pattern library

---

### 7. JSON/XML Formatter

Format, minify, validate, and syntax-highlight JSON and XML documents.

- One-click formatting
- Minification option
- Syntax validation
- Error location highlighting

---

### 8. Hash Generator

Generate cryptographic hashes from any input string.

- SHA-1, SHA-256, SHA-384, SHA-512
- One-click copy for each hash
- Case-sensitive and case-insensitive options

---

### 9. Base64 Encoder/Decoder

Encode and decode Base64 strings with full UTF-8 Unicode support.

- Text and file encoding
- Full UTF-8 support
- One-click copy

---

### 10. URL Encoder/Decoder

Encode and decode URL components and full URLs.

- Component and full URL encoding
- Query parameter handling
- Special character reference guide

---

### 11. Timestamp Converter

Convert between Unix timestamps and human-readable dates.

- Auto-detects seconds vs milliseconds
- Supports current timestamp
- Human-readable format output

---

### 12. JSON to TOON Converter

Convert JSON into Tree Outline notation for quick, readable data reviews.

- Visual tree structure
- Collapsible nodes
- Quick copy/export

---

### 13. Color Palette

Pick colors, generate shade palettes, and check WCAG contrast accessibility ratios.

- Color picker with hex/RGB/HSL
- Shade and tint generator
- WCAG AA/AAA contrast checker

---

### 14. Lorem Ipsum Generator

Generate placeholder text with configurable words, sentences, and paragraphs.

- Customizable word count
- Sentence and paragraph modes
- Copy to clipboard

---

### 15. Token Counter & Cost Calculator

Count tokens in text for LLM context window management and estimate API costs.

- Supports GPT-4o, Claude, Gemini, Llama, Mistral
- Cost estimation per model
- Context window utilization percentage

---

### 16. Prompt Template Manager

Create, save, and manage prompt templates with `{{variable}}` substitution.

- Template storage and organization
- Variable placeholders
- Quick test execution

---

### 17. Python ML Code Generator

Generate boilerplate code for popular ML frameworks.

- PyTorch training loops
- TensorFlow/Keras models
- HuggingFace pipelines
- LangChain chains

---

### 18. LLM API Tester

Test OpenAI, Anthropic, Gemini, and Ollama API endpoints with streaming support.

- Multi-provider support
- Streaming response display
- Parameter customization
- Response timing

---

### 19. Dataset Split Calculator

Calculate train/validation/test splits with stratification and random seed control.

- Stratified splitting
- Custom split ratios
- Random seed for reproducibility

---

### 20. GPU VRAM Calculator

Estimate VRAM requirements based on model parameters and precision format.

- FP32, FP16, BF16, INT8, INT4 support
- Batch size impact estimation
- Multi-GPU recommendations

---

### 21. Experiment Logger

Log hyperparameters, metrics, and results in structured format with Markdown export.

- Structured logging format
- Markdown export
- Experiment comparison

---

### 22. Model Card Generator

Generate standardized HuggingFace-format model documentation.

- Auto-populated fields
- Model details, usage, and limitations
- Export as Markdown

---

### 23. JSONL Viewer

Parse and inspect JSONL training data files in a readable table format.

- Line-by-line parsing
- Column detection
- Sortable table view

---

### 24. Markdown Table Generator

Generate markdown tables for experiment results and documentation.

- Customizable columns
- Auto-alignment
- Copy to clipboard

---

### 25. Schema Viewer

Parse and visualize Parquet, Avro, and JSON schemas as an interactive tree.

- Nested schema display
- Type information
- Field descriptions

---

### 26. Spark SQL Formatter

Format Spark SQL, Presto, and Trino queries with proper indentation and keywords.

- Keyword capitalization
- Indentation formatting
- Alias alignment

---

### 27. Data Quality Checker

Analyze CSV and JSON datasets for missing values, duplicates, types, and statistics.

- Missing value detection
- Duplicate identification
- Type inference
- Summary statistics

---

### 28. Schema Diff Tool

Compare two JSON schemas side-by-side and highlight added, removed, and changed fields.

- Side-by-side comparison
- Color-coded diffs
- Field-level detail

---

### 29. Partition Calculator

Calculate optimal Hadoop/Hive partitions, Spark config, and partition key strategies.

- File size estimation
- Partition count optimization
- Spark configuration generation

---

### 30. Chunking Strategy Tester

Compare different text chunking strategies (fixed, sentence, recursive, overlap) with visual previews.

- Multiple strategy support
- Chunk size visualization
- Overlap detection

---

### 31. Embedding Cost Calculator

Calculate embedding costs across OpenAI, Cohere, and HuggingFace models.

- Multi-model pricing
- Batch size optimization
- Total cost estimation

---

### 32. Context Window Calculator

Plan context window usage with visual utilization bars and max chunk limits.

- Visual progress bars
- Token budget planning
- Chunk limit warnings

---

### 33. Semantic Dedup Checker

Find near-duplicate lines using character-level n-gram similarity.

- N-gram similarity scoring
- Configurable threshold
- Duplicate group highlighting

---

### 34. RAG Eval Calculator

Evaluate RAG quality with precision, recall, MRR, and faithfulness scores.

- Multiple evaluation metrics
- Score breakdown
- Improvement suggestions

---

## Supported Technologies

**Frontend:** JavaScript, TypeScript, React, Vue.js, HTML, CSS

**CSS Frameworks:** Bootstrap, Tailwind CSS

**Backend:** Node.js, Python, PHP, Java, C#, Go, Ruby

**Mobile:** Flutter/Dart, Swift, Kotlin

**Database:** MongoDB, SQL

**State Management:** Redux, React Query, React Router

**Other:** JSON, YAML, Markdown, Shell Scripts, and more

---

## Keyboard Shortcuts

Add custom shortcuts in your VS Code `keybindings.json`:

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

---

## Configuration

DevSnip Pro works out of the box. Optionally customize via VS Code `settings.json`:

```json
{
  "devsnip.autoSuggest": true,
  "devsnip.snippetPreview": true,
  "devsnip.apiTimeout": 30000,
  "devsnip.mongoConnectionTimeout": 10000,
  "devsnip.consoleLogCleanup.confirmBeforeDelete": true
}
```

---

## Contributing

Contributions are welcome! Here's how:

### Report Bugs

Found an issue? [Open a bug report](https://github.com/sayaib/DevSnip-Pro/issues)

### Suggest Features

Have an idea? [Submit a feature request](https://github.com/sayaib/DevSnip-Pro/issues)

### Development Setup

```bash
git clone https://github.com/sayaib/DevSnip-Pro.git
cd DevSnip-Pro
npm install
code .
npm run watch
```

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License — see [LICENSE.txt](LICENSE.txt) for details.

- Free for personal and commercial use
- Modify and distribute as needed
- Attribution appreciated but not required

---

## Support

### Resources

- [Documentation](https://sayaibsarkar.net/#/dev-snip-pro/document/en)
- [Video Tutorials](https://sayaibsarkar.net/#/dev-snip-pro/document/en)
- [GitHub Repository](https://github.com/sayaib/DevSnip-Pro)

### Found a Bug?

1. Check [existing issues](https://github.com/sayaib/DevSnip-Pro/issues)
2. Search the [documentation](https://sayaibsarkar.net/#/dev-snip-pro/document/en)
3. [Create a new issue](https://github.com/sayaib/DevSnip-Pro/issues/new) with:
   - VS Code version
   - DevSnip Pro version
   - OS and steps to reproduce
   - Screenshots if helpful

### Stay Updated

- Star the repo to get notified of updates
- Watch releases for new features
- Rate and review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console&ssr=false#review-details)

---

<div align="center">

### Show Your Support

[![Star on GitHub](https://img.shields.io/static/v1?label=Star&message=on%20GitHub&style=for-the-badge&color=yellow)](https://github.com/sayaib/DevSnip-Pro)
[![Sponsor](https://img.shields.io/static/v1?label=Sponsor&style=for-the-badge&color=red)](https://github.com/sponsors/sayaib)
[![Write a Review](https://img.shields.io/static/v1?label=Review&style=for-the-badge&color=blue)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console&ssr=false#review-details)

**Made with heart by [Sayaib Sarkar](https://www.linkedin.com/in/sayaib/)**

</div>
