# API Response Inspector

Open **DevSnip Pro: API Response Inspector** from the command palette or the API tools section. The existing `apiResponseInspector` command and `inspectApiResponse(raw)` entry point in `data-inspect.ts` remain available. Inspection runs locally without sending requests, opening external links or executing body content.

## Inspect a capture

Paste raw HTTP, a response body or a HAR v1.2 document. Use **Load response / HAR file** for UTF-8 files up to 2 MiB, or **Use editor** for the current selection/file. Select an input format when automatic detection would be ambiguous. The HAR entry index starts at zero; automatic mode selects its first entry. Select HAR explicitly to inspect a different entry.

HTTP/1.0, HTTP/1.1, HTTP/2 and HTTP/3 status lines are supported. Consecutive informational, proxy CONNECT and redirect header blocks are recognized; the final block supplies the inspected headers/body. Duplicate headers, including separate Set-Cookie fields, remain separate. Header-only captures are supported with the HTTP input mode. Arbitrary concatenated responses containing intermediate bodies need separate captures or HAR entries.

Body text retains its captured whitespace and line endings. JSON pretty/compact previews preserve original number tokens and duplicate object keys. Parsed views flag large/unsafe JavaScript numbers and duplicate keys, which can make comparisons and inferred types inconclusive. JSON Pointer selections and field examples use parsed values; select the original body preview when source fidelity matters.

JSON scalars, arrays and objects are supported, alongside plain text, XML/HTML source, form-encoded bodies, NDJSON/JSON Lines and server-sent event snapshots. Use a body-format override for headerless streams. NDJSON reports invalid line numbers while retaining valid records and the full original source. SSE joins multiline data, tracks IDs/event types/retry fields, ignores comments and reports incomplete final events rather than dispatching them without a blank separator. These are snapshots; the inspector does not connect to a live stream.

Base64 HAR content is decoded when it is UTF-8 text. Binary content that cannot be decoded remains a base64 view. Missing HAR content is reported. Compression and HTTP chunk framing are not decoded from pasted text. Displayed bytes measure captured UTF-8 text (or decoded HAR bytes), not necessarily compressed wire size.

## Explore and diagnose

Use **JSON Pointer** to select a structured subtree, for example `/data/0/id`. Escape `/` in a property name as `~1`, and `~` as `~0`. Property lookup uses own properties and cannot traverse inherited prototype members. **Search fields / headers** is a literal case-insensitive filter; it does not alter body text or reports.

Field exploration includes container types, examples and JSON Pointers, sampling up to 50 elements per array. Limits are displayed explicitly. A field absent from the displayed sample might still exist elsewhere in the source.

Findings cover HTTP status meaning, missing/invalid JSON, content-type mismatches, captured Content-Length discrepancies, conflicting framing headers, Retry-After seconds/HTTP dates, rate-limit declarations, Cache-Control/validators, pagination/Location links, cookie attributes, correlation headers, conditional CORS issues, GraphQL-style errors under HTTP 200 and RFC 9457 Problem Details status mismatches. Errors and warnings appear before informational findings.

Content-Length mismatch checks are skipped for HEAD, bodyless statuses, HAR captures and encoded/transfer-coded bodies where captured bytes cannot establish wire length. Rate-limit reset fields are shown as declared because APIs use different units and conventions. Cache and cookie explanations reuse the existing HTTP toolkit. Findings describe evidence in the supplied capture; they do not establish complete server behavior or replace API documentation.

## Compare responses

Choose **Compare two responses** and paste a baseline. Status, case-insensitive header names, repeated header values and structured-body changes are compared. Date, Age and Server-Timing are ignored by default; configure the comma-separated ignore list as needed. Object key order is ignored; array order is significant. Text and unstructured bodies are compared as captured source text.

Changes distinguish additions, removals, value changes and type changes. Comparison is bounded to 50,000 visited nodes, 500 changes and safe path lengths. Truncated comparisons never claim complete equality. Numeric precision and duplicate-key diagnostics remain relevant when parsed JSON appears equal but source text differs.

## Exports and presets

Exports use the workbench's copy, open and save controls:

- JSON or Markdown inspection reports, including findings, headers and body source. Markdown body excerpts are capped at 16,000 characters; JSON reports retain the full captured text.
- Reconstructed HTTP captures. These omit stale Content-Length, Content-Encoding and Transfer-Encoding fields because the body may already be decoded or edited. They are readable captures rather than exact wire replays.
- TypeScript aliases and JSON Schema inferred from structured samples or a selected JSON Pointer. Inference samples at most 50 array items and is limited to 3,000 nodes, 16 levels and 200 properties per object. Schemas allow additional properties. Review required fields, numeric precision and formats against the API contract.
- Jest/Vitest assertion helpers that accept a `Response` supplied by your test harness. They check observed status, Content-Type and basic body shape. They do not send requests; add domain assertions from the documented API contract.

**Save redacted preset** stores up to 20 configurations and redacts both inputs in comparison mode. A matching preset label replaces the previous entry. Named presets are available through the shared Presets selector; **Clear saved presets** removes them.

## Privacy and limits

Response and baseline text are excluded from persisted webview state, including previously saved values. Known credential headers are masked in the header table. Original body and report exports preserve data by default for compatibility: enable **Redact known secrets in outputs** before sharing. Redaction masks known credential headers, cookie values, sensitive URL query keys and JSON/form fields. Non-secret JSON text and large integers remain unchanged. Opaque bodies are replaced; stream redaction can replace incomplete JSON fragments. Review custom secret names, path tokens, cookie attributes and personal data separately.

Inputs are capped at 2 MiB each; HTTP chains at 50 blocks; headers at 1,000 per response; JSON at 64 levels and 50,000 lexical tokens; NDJSON/SSE at 10,000 lines; displayed fields at 1,000. Oversized field names/paths are omitted with a truncation finding. Link details are limited to 100 relationships and 64 KiB per Link field; detailed cookie parsing skips fields over 16 KiB. Total code exports are bounded to 8 MiB. Choose fewer exports, a smaller capture or a JSON Pointer subtree when limits apply.

## Implementation and verification

Response parsing, bounded JSON utilities, diagnostics and tools are separated into `api-response-parser.ts`, `api-response-json.ts`, `api-response-analysis.ts`, `api-response.ts` and `api-response-tools.ts`. The workbench definition is `src/toolkits/sections/api-response.ts`; `data-inspect.ts` re-exports the original public API. Type inference reuses the shared shape/schema engine. Shared fixes preserve `__proto__` schema properties safely and parse quoted commas in Cache-Control lists.

Regression tests are in `src/test/unit/api-response-inspector.unit.ts`. Run `npm run compile:dev`, `npm run lint`, `npm run test:unit`, `npm run compile:web` and `npm run test:web:smoke`.

References: [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html), [HTTP caching](https://www.rfc-editor.org/rfc/rfc9111.html), [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html), [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901.html), and [server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html).
