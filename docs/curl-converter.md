# cURL Converter

Open **DevSnip Pro: cURL Converter** from the command palette or Web tools. The existing `curlConverter` command, `parseCurl()`, `tokenizeShell()`, `generateFromCurl()` and `toCurl()` exports remain available.

## Supported workflows

Choose a searchable target, paste a browser “Copy as cURL” command or use the active editor, and convert. Live preview, syntax highlighting, copy, open and workspace export use the shared workbench. Input edits are debounced and older results cannot replace newer runs.

There are 17 output targets: browser JavaScript Fetch, browser TypeScript Fetch, Node.js 22+ Fetch, browser Axios, Node.js 22+ Axios, Python Requests, asynchronous Python HTTPX, Go net/http, PHP cURL, Java HttpClient, C# HttpClient for .NET 8+, Dart http, Dart Dio, Kotlin OkHttp, Swift URLSession, raw HTTP and HTTPie. Existing target identifiers remain valid.

Fetch outputs can use automatic Content-Type response detection, explicit JSON/text/binary response reading, and reusable functions. Browser multipart Fetch functions accept user-selected `File` objects in file-part order. Node/Python/C# file references become file reads in the generated program; conversion itself never opens them. External client packages must already be installed in the consuming project (`axios`, `requests`, `httpx`, Dart `http`/`dio`, or OkHttp, as applicable).

Select a shell dialect for Bash/zsh, Windows cmd or PowerShell. Automatic mode covers typical browser Bash/cmd copies, including caret-wrapped Chrome cmd arguments; PowerShell users should explicitly select PowerShell and use `curl.exe`, rather than the `Invoke-WebRequest` alias. Variables, substitutions, environment expressions and config files are never evaluated.

The parser understands combined/attached short flags, `--option=value`, `--` option termination, quoted multiline and empty values, `--json`, `--data-*`, URL-encoded data, repeated parameters, basic/bearer auth, cookies, `-G`, `--url-query`, timeouts, redirects, file uploads and common multipart metadata. Inline body text is retained, including large JSON integers and whitespace. Repeated `--json` pieces are concatenated. Query data for `-G` produces GET rather than POST unless the method is explicitly overridden.

## Batches and exports

Enable **Convert multiple requests** for separate cURL commands joined by newlines, `;` or `&&`, or transfers separated by `--next`. Windows cmd batches may also use `&`. Each transfer has its own request options. Multiple URLs within a single transfer are rejected: separate them explicitly. Batch/all-target output filenames include request and target directories to avoid overwrites.

Exports include normalized Bash cURL, Postman collection v2.1, and HAR v1.2. HAR contains request data; its response and timing fields are marked as unexecuted placeholders. Postman resolves upload filenames from local files; review custom multipart filenames after import. File contents are not embedded in either export.

**Save redacted preset** retains up to 20 configurations. Give it a name or use the generated request label; a matching label replaces the previous preset. Presets always redact supported credential fields regardless of the current redaction toggle. Replace `REDACTED` placeholders before using a saved request. **Clear saved presets** removes the stored configurations.

## Fidelity and security

Conversion is local and never sends requests or executes generated commands. Credential-bearing cURL input is excluded from persisted webview state, including previously saved input. Generated output contains original credentials by default to preserve existing behavior. Enable **Redact credentials and sensitive fields** before sharing: it masks known authentication/cookie/API-key headers, URL query keys, nested JSON/form secrets and raw bodies. Non-secret JSON source text and integers remain unchanged. Application-specific headers, path tokens, opaque file contents and unusual secret names still need review.

Generated clients retain TLS verification even when the source uses `-k`. Normalized cURL preserves `-k` and displays a warning. Proxy/config/cookie files are never read; unsupported options and proxy settings are reported. Connect and total timeouts differ between clients, and generated Requests/HTTPX/Node Axios/C# snippets use a 30-second default when no total timeout is specified. Browser restrictions and CORS still apply. Dart Future.timeout stops waiting without canceling its underlying request.

Unsupported combinations produce actionable diagnostics rather than incomplete code. Examples include GET/HEAD bodies in Fetch, Java multipart requests, duplicate multipart names in PHP/Dart http, and custom multipart metadata in clients without equivalent generation support. Browser Axios currently supports a single selected upload file; browser Fetch and Node Axios support multiple files. Native FormData cannot set a custom Content-Type on a text-only part; use Python, C# or raw HTTP for that case. Header suppression may require checking the consuming client's defaults.

Shell pipes, redirection and non-cURL command chains are rejected. Quote shell metacharacters in URLs and data. Header-file input, `--data @file` newline-stripping semantics, file-based URL encoding, stdin uploads, multipart text-file reads and complex multi-file/quoted modifier syntax require explicit inline data or simpler file options. These limitations are reported before misleading output is generated.

Input is limited to 256 KiB, batches to 50 requests, and generated code to 5 MiB. Size checks occur while accumulating output. Large input should be split into smaller batches or converted to one target at a time.

## Implementation and validation

The API facade and existing targets live in `src/toolkits/engines/web-curl.ts`. Shell lexing, parsing, extra target generators and exports are separated into `curl-shell.ts`, `curl-parser.ts`, `curl-targets.ts` and `curl-exports.ts`. The workbench definition lives in `src/toolkits/sections/curl.ts`.

`src/test/unit/curl-converter.unit.ts` covers parser edge cases, shell dialects, batch isolation, exact Fetch request bytes, response handling, target diagnostics, normalization, Python syntax, redaction, exports and saved presets. Run `npm run compile:dev`, `npm run lint`, `npm run test:unit`, `npm run compile:web` and `npm run test:web:smoke`.

References: [cURL option semantics](https://curl.se/docs/manpage.html), [Node.js Fetch](https://nodejs.org/api/globals.html#fetch), [HTTPX requests and multipart](https://www.python-httpx.org/quickstart/) and [Chrome DevTools command encoding](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/panels/network/NetworkLogView.ts) and [Postman collection schema](https://schema.getpostman.com/json/collection/v2.1.0/docs/index.html).
