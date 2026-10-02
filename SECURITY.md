# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub's **[Report a vulnerability](https://github.com/sayaib/DevSnip-Pro/security/advisories/new)** form.

Include the DevSnip Pro version, what an attacker could do, and steps to reproduce. Never include real credentials; use placeholders.

You will get an acknowledgement, and the fix will be credited in the changelog unless you prefer otherwise.

## Supported versions

Fixes are made in the latest release on the Visual Studio Marketplace. Please update before reporting.

## Scope

In scope:

- **Credential exposure.** Connection strings, API keys or tokens appearing in the UI, logs, history, error messages or analytics.
- **Webview escapes.** Script injection into a webview, or bypassing its Content-Security-Policy.
- **Unauthorised commands.** A webview or workspace file causing a command, shell command or network request the user did not ask for.
- **Unexpected writes.** A database change made without the confirmation or read-only protection the UI promises.

Findings that the **security tools themselves** report about *your* project are the expected output, not vulnerabilities in DevSnip Pro.
