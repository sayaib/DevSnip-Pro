# How to find hard-coded secrets and security issues in VS Code

**Short answer:** run a secret scan over your workspace before you commit or release. In VS Code, run **DevSnip Pro: Workspace Security Audit** from [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console): it finds hard-coded API keys, tokens, private keys and passwords, plus injection risks and weak cryptography, with the file, line, severity and fix for each, and masks the matched values in the report.

![Workspace security audit in VS Code finding a hard-coded API key, with severity and fix](../images/security.jpg)

Most security problems that reach production are not exotic: an API key committed to the repo, a container running as root, a missing `Strict-Transport-Security` header, or a dependency nobody updated. They are cheap to catch while you are still in the editor. All the checks below are in the free **Security Hub**, and everything runs locally except the endpoint scan, which contacts only the URL you enter.

## 1. Secrets and risky code in your workspace

Run **DevSnip Pro: Workspace Security Audit**. It reads your source files (skipping `node_modules`, build and cache folders) and reports:

- **hard-coded secrets:** API keys, tokens, private keys, passwords in connection strings. Matched values are masked in the report;
- **injection risks:** string-built SQL, `eval`, shell commands built from input;
- **weak cryptography and unsafe configuration.**

Each finding has a file and line, the evidence, a severity and a fix. If you find a real secret, **rotate it**: removing it from the code does not remove it from git history.

## 2. Infrastructure as code

**DevSnip Pro: Cloud & Container Audit** checks Terraform, Kubernetes manifests, Docker Compose files, Dockerfiles and GitHub Actions workflows for the common mistakes:

- containers running as root, or privileged;
- `latest` image tags;
- storage open to the public;
- security groups open to `0.0.0.0/0`;
- secrets in plain environment variables;
- workflow steps that trust untrusted input.

## 3. Dependencies and configuration

**DevSnip Pro: Dependency & Config Check** looks at:

- **lockfiles:** missing lockfiles and unbounded version ranges;
- **packages:** abandoned or known-compromised packages;
- **credentials:** registry credentials committed to the repository;
- **`.env` hygiene:** whether `.env` is ignored;
- **CI:** whether CI runs any security scanning.

It complements your package manager's own `npm audit` / `pip-audit`; it does not replace them.

## 4. A live endpoint

**DevSnip Pro: Endpoint Security Scan** checks a URL you are authorised to test:

- **transport:** TLS version and certificate;
- **headers:** HSTS, the security headers, Content-Security-Policy, and CORS (including the dangerous `null` and reflected origins);
- **cookies:** their flags;
- **behaviour:** how unauthenticated requests are handled, information disclosed in headers and errors, and rate limiting.

Two active checks, a reflected-input probe and well-known sensitive paths, are off by default: they send extra, read-only requests, so turn them on only for systems you own.

## 5. Tokens and auth flows

- **JWT Decoder & Signer:** read a token's claims and expiry, and verify its signature.
- **OAuth 2.0 & PKCE Helper:** build authorization URLs and PKCE pairs correctly.
- **Hash, HMAC & Webhook Signatures:** check that a webhook signature is computed the way the provider documents.
- **CSP & Security Headers:** build a policy and see what it allows before you deploy it.

## A pre-release checklist

1. Workspace audit: no secrets, no high-severity findings.
2. Cloud & container audit on any infrastructure changes.
3. Dependency check, plus your package manager's audit.
4. Endpoint scan against staging.
5. Export the report (Markdown or JSON) and attach it to the release PR.

Automated checks find the common problems quickly; they do not replace a review or a penetration test of systems that handle sensitive data.

---

**Try it:** [Install DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) (free, no account) or run `code --install-extension sayaib.hue-console`.

Related: [How to test REST APIs in VS Code](test-rest-apis-in-vscode.md) · [How to install and use OpenCode in VS Code](opencode-in-vscode.md) · [All guides](README.md)
