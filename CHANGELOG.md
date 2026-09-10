# Development Changelog of DevSnip Pro

## Version 10.50.0 - 2026-09-09

### Removed

- Removed the Code Snapshot feature entirely (command `sayaib.hue-console.captureCode`, webview, and all related assets).
- Removed `dom-to-image` and `file-saver` npm dependencies.
- Removed `devsnip.codeSnapshotTheme` configuration setting.
- Removed Code Snapshot from Core tool group, universal search, and Activity Bar tree.

## Version 10.49.140 - 2026-09-09

### Improvements

- Redesigned the Code Snapshot webview with a cleaner dark UI, smoother transitions, and better visual hierarchy.
- Replaced the complex export SVG logo with a minimal camera icon.
- Added clipboard and refresh icons to the Copy and Use Current Selection toolbar buttons.
- Added an empty-state placeholder inside the snapshot container when no code is selected.
- Replaced the inline SVG terminal dots with styled `<span>` elements for lighter markup.
- Added a loading spinner on the Export button during snapshot generation.
- Added success/error color feedback on the export status message.
- Added a "Copied!" confirmation on the Copy Code button after copying.
- Moved PNG to the default export format in the dropdown.

### Fixes

- Fixed SVG export failing because the download link was not appended to the DOM before triggering click.
- Fixed "Use current selection" button returning stale code from the original editor selection instead of the current active editor.
- Fixed `computeEdeditorLineNumberWidth` typo renamed to `computeEditorLineNumberWidth`.
- Added null guards for DOM elements in the snapshot export path to prevent runtime errors.
- Improved export error messages to show the actual failure reason instead of a generic message.
- Added safe initialization check for `colorPicker` to prevent crashes if the script has not loaded.

## Version 10.49.139 - 2026-09-08

### Improvements

- Replaced the Security Audit terminal output with a styled VS Code webview.
- Added severity summary cards for critical, high, medium, and low findings.
- Added redacted evidence, remediation guidance, and a clearer finding layout.
- Added an `Open at line` action that jumps directly to the scanned source location for fixing.
- Added exact resource tracking for reliable navigation in multi-root workspaces.

### Fixes

- Security Audit no longer requires users to search the terminal for findings.
- Security finding navigation now opens the correct file and line instead of relying only on relative workspace paths.

## Version 10.49.138 - 2026-09-08

### New Features

- Added a dedicated Security Center with local code security and local cloud-configuration audits.
- Added cloud/IaC checks for public ingress, wildcard IAM permissions, public storage, privileged containers, embedded credentials, disabled encryption/TLS, and mutable container tags.
- Added an AI/ML DevOps generator for CPU/GPU containers, Kubernetes GPU serving, ML CI, and model-serving contracts.
- Added DevOps generators for Docker, Compose, Kubernetes, Terraform, secure CI, and observability starter files.
- Added structured log analysis and Node.js/Python OpenTelemetry starter templates.

### Improvements

- Simplified the Activity Bar navigation with shorter labels and workflow-focused groups.
- Reduced visual noise by using neutral child icons and color accents only for category headers.
- Removed the custom maximize/minimize controls from the Tools view to keep the interface clean and consistent with VS Code.
- Added safe overwrite confirmation for generated deployment and observability files.
- Added bounded, local-only scanning with binary-file filtering, size limits, skipped dependency/build directories, and redacted evidence.

### Deployment Notes

- Run `npm run compile` before packaging.
- Review generated Docker, Kubernetes, Terraform, CI, and OpenTelemetry templates before deploying them.
- The cloud security audit scans local configuration only; it does not access AWS, Azure, or GCP accounts.

## Version 10.49.136 - 2026-09-07

### New Features

- Added universal regex tool search across all DevSnip Pro commands.
- Added Dataset Profiler, Model Metrics Calculator, and Prompt Playground tools.
- Added nested JSON and JSONL path support for deeply structured datasets, including arrays and MongoDB-style date values.

### Improvements

- Reorganized the activity-bar navigation into Core Workflow, Snippets, AI/ML/LLM, Data Engineering, and Advanced Utilities sections.
- Reorganized every inner tool hub into workflow-based groups with a consistent responsive card layout.
- Updated Schema Viewer to infer schemas from ordinary JSON documents and render deeply nested objects and arrays.
- Updated Schema Diff Tool to compare inferred data shapes and formal JSON Schemas using stable nested paths.

### Fixes

- Serialized webview-triggered command launches to prevent overlapping Extension Host flush calls.
- Added a deterministic first-debug workflow that compiles before launch and starts a clean Extension Host window.

## Version 10.47.135 - 2026-09-07

### Improvements

- **README completely rewritten** -- removed all screenshots and images, replaced with a clickable indexed feature list (35 features) with anchor links for easy navigation
- Added "How to Access" section at the top with 3 clear access methods (Activity Bar, Command Palette, Right-Click Menu)
- Added quick reference table mapping user goals to exact menu paths
- Expanded each tool from grouped tables into individual documented sections
- Cleaned up supported technologies section (text list instead of icon images)

## Version 10.47.134 - 2026-09-07

### New Features

- **AI/ML & LLM Tools Hub** -- 10 new tools for AI/ML workflows:
  - Token Counter & Cost Calculator (GPT-4o, Claude, Gemini, Llama, Mistral)
  - Prompt Template Manager with variable substitution
  - Python ML Code Generator (PyTorch, TensorFlow, HuggingFace, LangChain)
  - LLM API Tester with streaming support
  - Dataset Split Calculator with stratification
  - GPU VRAM Calculator (FP32/FP16/BF16/INT8/INT4)
  - Experiment Logger with Markdown export
  - Model Card Generator (HuggingFace format)
  - JSONL Viewer for training data
  - Markdown Table Generator

- **Big Data Tools Hub** -- 5 new tools for data engineering:
  - Schema Viewer (Parquet, Avro, JSON)
  - Spark SQL / Presto / Trino Query Formatter
  - Data Quality Checker (CSV, JSON)
  - Schema Diff Tool (side-by-side comparison)
  - Partition Calculator (Hadoop/Hive/Spark)

- **RAG Tools Hub** -- 5 new tools for Retrieval-Augmented Generation:
  - Chunking Strategy Tester (fixed, sentence, recursive, overlap)
  - Embedding Cost Calculator (OpenAI, Cohere, HuggingFace)
  - Context Window Calculator with visual utilization bars
  - Semantic Dedup Checker (n-gram similarity)
  - RAG Eval Calculator (precision, recall, MRR, faithfulness)

- **GraphQL support** in REST API Client -- dedicated query editor, variables, and operation name
- **Environment variables** in REST API Client -- create, manage, and resolve `{{variable}}` placeholders across requests

### Improvements

- **REST API Client** -- complete UI redesign with professional layout, method color coding, config tabs, request history, cancel button, and responsive design
- **Advanced Developer Tools Hub** -- added Color Palette and Lorem Ipsum Generator (now 9 tools), unified theme system with toast notifications
- **Activity Bar** -- added AI/ML, Big Data, and RAG tool hubs to the sidebar tree view
- **README** -- completely rewritten with comprehensive feature documentation

### Removed

- Removed legacy `snippets/` directory (replaced by `custom/` snippet system)

## Version 10.46.133 - 2025-12-03

- Added JSON to TOON converter and readme updated

## Version 10.43.119 - 2025-04-03

- Rest API status code issue fixed in test REST API section

## Version 10.42.118 - 10.42.119 - 2025-04-03

- Solved Snippets visibility error to jsx components in react

## Version 10.42.116 - 10.42.117 - 2025-03-26

- Update readme and fixed bugs of activity bar (added all features there)

## Version 10.41.107 - 10.41.116 - 2025-03-24

- Update readme and fixed bugs of activity bar (added all features there)

## Version 10.41.107 - 2025-03-21

- Added DevSnip pro in activity bar for easy access

## Version 10.40.101 - 10.40.103 - 2025-02-20

- Added code capture snapshot in right menu bar.

## Version 9.40.101 - 2025-02-18

- fixed minor bugs

## Version 9.40.100 - 2025-02-17

- Replace the selected console.log with a direct removal of the console.log in the row, accompanied by a remove button.

## Version 9.39.99 - 9.39.100 - 2025-02-05

- Added multiline console log search and update readme features section.

## Version 9.39.98 - 2025-02-04

- Optimized code for large project (faster console log searching)

## Version 9.38.97 - 9.38.98 - 2025-02-04

- Logo changed

## Version 9.38.95 - 9.38.96 - 2025-02-03

- Added Tailwind CSS v4 and Bootstrap v5
- fixed language bugs and activation errors

## Version 8.38.93 - 8.38.95 - 2025-01-30

- Exclude all the temps file while searching.

## Version 8.37.93 - 2025-01 -28

- Updated user manual index

## Version 8.37.92 - 2025-01-24

- Optimized code performance by removing unnessary line any apply reusable component and changed description.

## Version 8.36.89 - 9.36.92 - 2025-01-24

- Optimized code performance by removing unnessary line any apply reusable component.

## Version 8.35.80 - 2025-01-24

- Added Loading screen "Analyzing your project to retrieve all console logs. Please wait....""

## Version 8.34.89 - 8.34.91 - 2025-01-22

- Added Console Log Hunt and delete.

## Version 7.34.89 - 2024-12-31

- Apply global search in custom snippets view table.
- Grouped table content by programming language.

## Version 7.33.88 && 7.33.89 - 2024-12-31

- add new documentation links

## Version 7.33.86 && 7.33.87 - 2024-12-23

- Updated the reactJS , MongoDB and MongoDB aggregation snippets with more snippets example.

## Version 7.32.86 - 2024-12-19

- Updated the snippets table link in README with the actual documentation link.

## Version 7.31.86 - 2024-12-18

- Added a "View Custom Snippets" user manual to the documentation with screenshots.

## Version 7.30.86 - 2024-12-18

- Added visualization for all custom snippets created by users.

## Version 6.30.85 && 6.30.86 - 2024-12-16

- Changed gallery banner theme and color.

## Versions 6.30.81, 6.30.82, 6.30.83, 6.30.84 - 2024-12-16

- Added full document URL for DevSnip Pro.

## Version 6.29.81 - 2024-11-29

- Added keywords.
- Updated README with a user manual for custom snippets creation.

## Version 6.28.81 - 2024-11-29

- Updated README with a user manual for custom snippets creation.

## Version 6.28.80 - 2024-11-27

- Updated README with a new screenshot showing how to use custom snippets.

## Version 6.28.79 - 2024-11-26

- Changed description.

## Version 6.27.79 - 2024-11-25

### Features

- **HTML5 Boilerplate Update**: Enhanced the structure and compatibility with modern browsers.

### Improvements

- **Performance Optimizations**: Improved load times and reduced file sizes for better user experience.

### Security Updates

- Applied security patches for known vulnerabilities.

### Cross-Browser Compatibility

- Improved compatibility with the latest browser versions.

### Fixes

- **Minor Bug Fixes**: Resolved issues related to element positioning and responsiveness.

### Notes

- Ensure to clear browser cache after updating the boilerplate to apply all optimizations effectively.

## Version 5.27.62 - 2024-11-22

- Updated the HTML5 boilerplate.

## Version 5.27.61 - 2024-11-22

- Changed description and keywords.

## Version 5.26.61 - 2024-11-22

- Changed description.

## Versions 5.26.60 to 5.26.55 - 2024-08-07

- Modified README file.
- Changed screenshot sizes in tables.
- Linked href changes.
- Added developer profile and images in README.
- Fixed minor bugs.
- Added smaller supported languages icons.
- Added supported code snippets list.

## Versions 5.26.54 & 5.26.53 - 2024-08-06

- Redesigned README with structured icons for supported code snippets languages and frameworks.
- Added NodeJS snippets with screenshots and instructions.

## Versions 5.24.52 & 5.24.51 - 2024-08-06

- Displayed screenshots in tabular format in README file.
- Updated README with document manual link.

## Version 4.23.50 - 2024-08-05

- Fixed minor bugs in Flutter code snippets.

## Version 4.23.49 - 2024-08-05

- Fixed minor bugs in Flutter code snippets.

## Version 4.23.48 - 2024-08-05

- Added Flutter snippets screenshot in README file.

## Version 4.22.48 - 2024-08-05

- Added Flutter snippets.

## Version 3.22.48 - 2024-08-05

- Removed extra tag in README.

## Version 3.22.47 - 2024-08-05

- Removed extra "Code Snippets Collection" tag.

## Version 3.22.46 - 2024-08-05

- Updated GIF link.

## Version 3.22.45 - 2024-08-05

- Updated README.

## Version 3.22.44 - 2024-08-05

- Beautified the README.

## Version 3.22.43 - 2024-08-05

- Adjusted logo aspect ratio.

## Version 3.21.42 - 2024-08-05

- Updated README with an external link to the user manual.

## Version 3.20.42 - 2024-08-05

- Minor changes in README file.

## Version 3.20.41 - 2024-07-29

- Changed extension name from "Prism Snippets and Logger" to "DevSnip Pro."

## Versions 3.19.41 & 3.19.40 - 2024-07-29

- Adjusted logo aspect ratio.
- Updated logo.

## Versions 3.18.40 & 3.17.40 - 2024-06-06

- Updated logo (R1 & R2).

## Version 3.16.40 - 2024-06-06

- Added TypeScript snippets reference to README.

## Version 3.15.40 - 2024-06-06

- **Big Update!** Added TypeScript snippets.

## Version 2.15.40 - 2024-06-06

- Updated extension description.

## Version 2.14.40 & 2.14.39 - 2024-06-06

- Tested for better visibility of the manual.

## Version 2.14.38 - 2024-05-24

- Updated sponsor information.

## Version 2.13.38 - 2024-05-20

- Fixed minor bugs in printing tables.

## Version 2.13.37 - 2024-05-20

- Added table printing in the logger section.

## Version 2.12.37 - 2024-05-08

- Updated copyright information.

## Versions 2.12.34, 2.11.34 & 2.10.34 - 2024-04-30

- Added MIT License.
- Added identifiers.
- Fixed minor bugs and added language support.
