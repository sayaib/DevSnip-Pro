<div align="center">

# DevSnip Pro

### The Ultimate Developer Productivity Extension for VS Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/sayaib.hue-console?style=for-the-badge&label=VS%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/sayaib.hue-console?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
[![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/sayaib.hue-console?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
[![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/sayaib.hue-console?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console&ssr=false#review-details)

**39 built-in tools** across API testing, code snippets, developer utilities, AI/ML tools, Big Data tools, and RAG tools — all inside VS Code.

[Installation](#installation) | [Features](#features) | [Configuration](#configuration) | [Contributing](#contributing)

</div>

---

## How to Access

> **After installing, there are 3 ways to open DevSnip Pro:**

### Option 1 — Activity Bar (Easiest)

Click the **DevSnip Pro** icon in the **left sidebar** of VS Code. This opens a panel with all tools listed as clickable cards.

### Option 2 — Command Palette

1. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Mac)
2. Type `DevSnip Pro`
3. Pick any command from the list

### Option 3 — Right-Click Menu

Select code in the editor, **right-click**, and choose one of the DevSnip Pro options from the context menu.

---

## Features

### Index

| # | Feature | Description |
|---|---------|-------------|
| 1 | [REST API Client](#1-rest-api-client) | Full-featured HTTP/GraphQL client with environments, auth, cookies, and history |
| 2 | [Custom Snippet Management](#2-custom-snippet-management) | Create, save, and reuse your own code snippets |
| 3 | [Pre-built Snippet Library](#3-pre-built-snippet-library) | 500+ snippets across 30+ languages and frameworks |
| 4 | [Console Log Cleanup](#4-console-log-cleanup) | Detect and remove console.log statements project-wide |
| 5 | [Unused Imports Remover](#5-unused-imports-remover) | Clean up unused import statements automatically |
| 6 | [Code Snapshots](#6-code-snapshots) | Generate beautiful, shareable code images |
| 7 | [Regex Builder & Tester](#7-regex-builder--tester) | Build and test regular expressions with real-time matching |
| 8 | [JSON/XML Formatter](#8-xmlformatter) | Format, minify, validate, and syntax-highlight JSON and XML |
| 9 | [Hash Generator](#9-hash-generator) | Generate SHA-1, SHA-256, SHA-384, and SHA-512 hashes |
| 10 | [Base64 Encoder/Decoder](#10-base64-encoderdecoder) | Encode and decode Base64 strings with UTF-8 support |
| 11 | [URL Encoder/Decoder](#11-url-encoderdecoder) | Encode and decode URL components and full URLs |
| 12 | [Timestamp Converter](#12-timestamp-converter) | Convert between Unix timestamps and human-readable dates |
| 13 | [JSON to TOON Converter](#13-json-to-toon-converter) | Convert JSON to Tree Outline notation for quick reviews |
| 14 | [Color Palette](#14-color-palette) | Pick colors, generate palettes, and check WCAG contrast ratios |
| 15 | [Lorem Ipsum Generator](#15-lorem-ipsum-generator) | Generate placeholder text with configurable length |
| 16 | [Token Counter & Cost Calculator](#16-token-counter--cost-calculator) | Count tokens for LLM models and estimate API costs |
| 17 | [Prompt Template Manager](#17-prompt-template-manager) | Create, save, and manage prompt templates with variables |
| 18 | [Python ML Code Generator](#18-python-ml-code-generator) | Generate PyTorch, TensorFlow, HuggingFace, and LangChain boilerplate |
| 19 | [LLM API Tester](#19-llm-api-tester) | Test OpenAI, Anthropic, Gemini, and Ollama API endpoints |
| 20 | [Dataset Split Calculator](#20-dataset-split-calculator) | Calculate train/val/test splits with stratification |
| 21 | [GPU VRAM Calculator](#21-gpu-vram-calculator) | Estimate VRAM requirements by model size and precision |
| 22 | [Experiment Logger](#22-experiment-logger) | Log hyperparameters, metrics, and results with Markdown export |
| 23 | [Model Card Generator](#23-model-card-generator) | Generate standardized HuggingFace-format model documentation |
| 24 | [JSONL Viewer](#24-jsonl-viewer) | Parse and inspect JSONL training data in a readable table |
| 25 | [Markdown Table Generator](#25-markdown-table-generator) | Generate markdown tables for documentation and reports |
| 26 | [Schema Viewer](#26-schema-viewer) | Visualize Parquet, Avro, and JSON schemas as an interactive tree |
| 27 | [Spark SQL Formatter](#27-spark-sql-formatter) | Format Spark SQL, Presto, and Trino queries |
| 28 | [Data Quality Checker](#28-data-quality-checker) | Analyze CSV/JSON datasets for missing values, duplicates, and stats |
| 29 | [Schema Diff Tool](#29-schema-diff-tool) | Compare two JSON schemas side-by-side |
| 30 | [Partition Calculator](#30-partition-calculator) | Calculate optimal Hadoop/Hive partitions and Spark config |
| 31 | [Chunking Strategy Tester](#31-chunking-strategy-tester) | Compare fixed, sentence, recursive, and overlap chunking |
| 32 | [Embedding Cost Calculator](#32-embedding-cost-calculator) | Calculate embedding costs across OpenAI, Cohere, and HuggingFace |
| 33 | [Context Window Calculator](#33-context-window-calculator) | Plan context window usage with visual utilization bars |
| 34 | [Semantic Dedup Checker](#34-semantic-dedup-checker) | Find near-duplicate lines using n-gram similarity |
| 35 | [RAG Eval Calculator](#35-rag-eval-calculator) | Evaluate RAG quality with precision, recall, MRR, and faithfulness |

---

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

| Category | Languages/Frameworks |
|----------|---------------------|
| Frontend | JavaScript, TypeScript, React, Vue.js, HTML, CSS |
| CSS Frameworks | Bootstrap, Tailwind CSS |
| Backend | Node.js, Python, PHP, Java, C#, Go, Ruby |
| Mobile | Flutter/Dart, Swift, Kotlin |
| Database | MongoDB, SQL |
| State Management | Redux, React Query, React Router |
| Other | JSON, YAML, Markdown, Shell Scripts |

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

### 6. Code Snapshots

Generate beautiful, shareable images of your code with customizable styling.

- Multiple theme options (dark, light, custom)
- Customizable background, padding, and border
- Syntax highlighting preservation
- Export as PNG
- Perfect for documentation, social media, and presentations

---

### 7. Regex Builder & Tester

Build, test, and debug regular expressions with real-time match visualization.

- Pattern input with live matching
- Match highlighting on test strings
- Explanation of regex components
- Common pattern library

---

### 8. JSON/XML Formatter

Format, minify, validate, and syntax-highlight JSON and XML documents.

- One-click formatting
- Minification option
- Syntax validation
- Error location highlighting

---

### 9. Hash Generator

Generate cryptographic hashes from any input string.

- SHA-1, SHA-256, SHA-384, SHA-512
- One-click copy for each hash
- Case-sensitive and case-insensitive options

---

### 10. Base64 Encoder/Decoder

Encode and decode Base64 strings with full UTF-8 Unicode support.

- Text and file encoding
- Full UTF-8 support
- One-click copy

---

### 11. URL Encoder/Decoder

Encode and decode URL components and full URLs.

- Component and full URL encoding
- Query parameter handling
- Special character reference guide

---

### 12. Timestamp Converter

Convert between Unix timestamps and human-readable dates.

- Auto-detects seconds vs milliseconds
- Supports current timestamp
- Human-readable format output

---

### 13. JSON to TOON Converter

Convert JSON into Tree Outline notation for quick, readable data reviews.

- Visual tree structure
- Collapsible nodes
- Quick copy/export

---

### 14. Color Palette

Pick colors, generate shade palettes, and check WCAG contrast accessibility ratios.

- Color picker with hex/RGB/HSL
- Shade and tint generator
- WCAG AA/AAA contrast checker

---

### 15. Lorem Ipsum Generator

Generate placeholder text with configurable words, sentences, and paragraphs.

- Customizable word count
- Sentence and paragraph modes
- Copy to clipboard

---

### 16. Token Counter & Cost Calculator

Count tokens in text for LLM context window management and estimate API costs.

- Supports GPT-4o, Claude, Gemini, Llama, Mistral
- Cost estimation per model
- Context window utilization percentage

---

### 17. Prompt Template Manager

Create, save, and manage prompt templates with `{{variable}}` substitution.

- Template storage and organization
- Variable placeholders
- Quick test execution

---

### 18. Python ML Code Generator

Generate boilerplate code for popular ML frameworks.

- PyTorch training loops
- TensorFlow/Keras models
- HuggingFace pipelines
- LangChain chains

---

### 19. LLM API Tester

Test OpenAI, Anthropic, Gemini, and Ollama API endpoints with streaming support.

- Multi-provider support
- Streaming response display
- Parameter customization
- Response timing

---

### 20. Dataset Split Calculator

Calculate train/validation/test splits with stratification and random seed control.

- Stratified splitting
- Custom split ratios
- Random seed for reproducibility

---

### 21. GPU VRAM Calculator

Estimate VRAM requirements based on model parameters and precision format.

- FP32, FP16, BF16, INT8, INT4 support
- Batch size impact estimation
- Multi-GPU recommendations

---

### 22. Experiment Logger

Log hyperparameters, metrics, and results in structured format with Markdown export.

- Structured logging format
- Markdown export
- Experiment comparison

---

### 23. Model Card Generator

Generate standardized HuggingFace-format model documentation.

- Auto-populated fields
- Model details, usage, and limitations
- Export as Markdown

---

### 24. JSONL Viewer

Parse and inspect JSONL training data files in a readable table format.

- Line-by-line parsing
- Column detection
- Sortable table view

---

### 25. Markdown Table Generator

Generate markdown tables for experiment results and documentation.

- Customizable columns
- Auto-alignment
- Copy to clipboard

---

### 26. Schema Viewer

Parse and visualize Parquet, Avro, and JSON schemas as an interactive tree.

- Nested schema display
- Type information
- Field descriptions

---

### 27. Spark SQL Formatter

Format Spark SQL, Presto, and Trino queries with proper indentation and keywords.

- Keyword capitalization
- Indentation formatting
- Alias alignment

---

### 28. Data Quality Checker

Analyze CSV and JSON datasets for missing values, duplicates, types, and statistics.

- Missing value detection
- Duplicate identification
- Type inference
- Summary statistics

---

### 29. Schema Diff Tool

Compare two JSON schemas side-by-side and highlight added, removed, and changed fields.

- Side-by-side comparison
- Color-coded diffs
- Field-level detail

---

### 30. Partition Calculator

Calculate optimal Hadoop/Hive partitions, Spark config, and partition key strategies.

- File size estimation
- Partition count optimization
- Spark configuration generation

---

### 31. Chunking Strategy Tester

Compare different text chunking strategies (fixed, sentence, recursive, overlap) with visual previews.

- Multiple strategy support
- Chunk size visualization
- Overlap detection

---

### 32. Embedding Cost Calculator

Calculate embedding costs across OpenAI, Cohere, and HuggingFace models.

- Multi-model pricing
- Batch size optimization
- Total cost estimation

---

### 33. Context Window Calculator

Plan context window usage with visual utilization bars and max chunk limits.

- Visual progress bars
- Token budget planning
- Chunk limit warnings

---

### 34. Semantic Dedup Checker

Find near-duplicate lines using character-level n-gram similarity.

- N-gram similarity scoring
- Configurable threshold
- Duplicate group highlighting

---

### 35. RAG Eval Calculator

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
  "devsnip.codeSnapshotTheme": "dark",
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

**Made with heart by [Sayaib Sarkar](https://github.com/sayaib)**

</div>
