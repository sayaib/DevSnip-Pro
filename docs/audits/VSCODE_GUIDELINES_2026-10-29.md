# VS Code guidelines review — 29 October 2026

Reviewed the current desktop and browser extension against Microsoft's extension documentation. This records confirmed fixes and tested behavior; it is not Marketplace approval or certification of every guideline.

## Confirmed fixes

- **Minimum webview capabilities:** shared tool panels now default to `localResourceRoots: []`; explicit media/font allow-lists remain intact. README and saved-snippet panels explicitly deny local resources. REST Client no longer exposes the entire extension directory: its scripts/styles are inline and its requests run through the host (except explicitly enabled WebSockets). The tab logo uses the panel API and does not need webview resource permission.
- **No promotional webviews:** removed the Buy Me a Coffee button, image loading and click listener from the milestones page. Sponsor links in README/Marketplace metadata are unchanged. The renderer's positional argument and legacy fixed-URL handler remain compatible with existing callers; points, rewards and tool access remain available.
- **Telemetry discoverability:** added `usesOnlineServices` to the existing analytics setting tags. The existing implementation already gates sends on `env.isTelemetryEnabled`, listens for `onDidChangeTelemetryEnabled`, and additionally requires the global telemetry level to be `all`.
- **Capability localization:** workspace trust and virtual workspace descriptions now resolve through `package.nls.json`. The extension remains disabled in untrusted workspaces; no trust bypass was introduced.

## Other areas checked

- Contextual activation; commands and custom editors use VS Code contribution activation. No wildcard activation event was found.
- Desktop/browser entry points and build boundaries. Browser tools continue to avoid runtime Node dependencies.
- Webview CSP, input escaping, nonce-protected inline scripts, theme colors, command dispatch allow-lists, URI-based resources, and subscription/panel cleanup paths.
- Tool pages are opened on demand. Get Started and What's New commands are explicit user actions rather than update-time panel launches.

## Validation

- TypeScript desktop compile and browser production bundle: passed.
- ESLint: passed.
- Unit suite: 858/858 registered cases passed, including nine live-database cases that skip without configured servers.
- Browser sandbox: 94 tools / 855 variants passed.
- Real Chromium VS Code web host: 94 tools / 855 variants passed, exit zero.
- Regression assertions cover default resource denial, preservation of explicit resource roots, and removal of the promotional page control/listener.
- Desktop integration in VS Code 1.141.0 on macOS ARM64: 82 passed, two opt-in Maven/Gradle tests pending; exit zero.
- VSIX generated: `/tmp/hue-console-11.83.2.vsix`, 3,201 files, 8.23 MB. Packaged manifest localization references resolve correctly. VSCE retains its existing high file-count/bundling warning.

## Limits and recommendations

Some guidance expresses product preferences rather than API requirements. Existing gamified reward activities and appearance controls remain because deleting them would alter established user functionality. They still deserve a product-level review against the recommendation to keep webviews directly related to editor/workspace tasks. Complex panels retain context for in-progress requests, connections and forms; memory-sensitive panels should continue to be evaluated for state-based restoration. Inline styles remain in several pages; moving them to external stylesheets is a further hardening recommendation, not something this pass claims to have completed. This review does not establish full accessibility conformance or verify Windows, Linux, or the minimum supported VS Code 1.93 runtime. Previously recorded dependency security findings remain a separate release concern.

## Official references

- [Webview security and local resources](https://code.visualstudio.com/api/extension-guides/webview)
- [Webview UX guidance](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [Telemetry requirements and recommended setting tags](https://code.visualstudio.com/api/extension-guides/telemetry)
