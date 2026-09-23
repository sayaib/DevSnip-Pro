import * as vscode from "vscode";
import * as path from "path";
import { registerTrackedCommand } from "../utils/command-registry";
import { escapeHtml, getNonce, openToolPanel, safePostMessage, THEME_TOKENS } from "../utils/webview-ui";
import {
  CATEGORY_LABELS,
  SecurityCheck,
  SecurityReport,
  sortChecks,
  summarize
} from "../services/security-analysis";
import {
  PostureCheck,
  StaticFinding,
  WorkspaceFiles,
  analyzeWorkspacePosture,
  scanCloudText,
  scanSourceText
} from "../services/security-static";
import { runEndpointScan } from "../services/security-probe";

/**
 * The Security section.
 *
 * Four scans share one panel and one result model:
 *
 *  - endpoint   - live HTTP/TLS probing of a URL
 *  - workspace  - secrets, injection and unsafe-code rules over source files
 *  - cloud      - infrastructure-as-code and container rules
 *  - posture    - dependency and security-configuration checks
 *
 * Every one produces `SecurityCheck[]`, so the webview has a single renderer
 * and a finding looks the same however it was found. Scans run in the
 * extension host; the webview never performs a request or reads a file.
 */

export type ScanScope = "endpoint" | "workspace" | "cloud" | "posture";

const DEFAULT_MAX_FILES = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const SKIP_GLOB = "**/{node_modules,.git,dist,build,out,coverage,.next,.nuxt,.venv,venv,__pycache__,vendor,target,.gradle,.terraform,.vscode-test,Pods}/**";

const SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,kt,rb,php,cs,rs,swift,scala,sh,bash,ps1,sql,html,vue,svelte,json,yaml,yml,toml,ini,conf,config,xml,properties,gradle,tf,hcl}";
const CLOUD_GLOB = "**/*.{tf,tfvars,hcl,yaml,yml,json,toml,conf,ini}";
const EXTRA_GLOB = "**/{Dockerfile,dockerfile,Dockerfile.*,.env,.env.*,.npmrc,.dockerignore,Makefile}";
const MANIFEST_GLOB = "**/{package.json,package-lock.json,yarn.lock,pnpm-lock.yaml,npm-shrinkwrap.json,bun.lockb,requirements*.txt,Pipfile,pyproject.toml,go.mod,Gemfile,Gemfile.lock,composer.json,SECURITY.md,.gitignore,.npmrc,dependabot.yml,dependabot.yaml,renovate.json}";

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "java", "kt", "rb", "php", "cs", "rs",
  "swift", "scala", "sh", "bash", "ps1", "sql", "html", "vue", "svelte", "json", "yaml", "yml",
  "toml", "ini", "conf", "config", "xml", "properties", "gradle", "tf", "hcl", "env", "dockerfile", "md", "txt"
]);
const CLOUD_EXTENSIONS = new Set(["tf", "tfvars", "hcl", "yaml", "yml", "json", "toml", "conf", "ini", "dockerfile", "env"]);

/** File budget for a scan, from `devsnip.securityAudit.maxFiles`. */
function maxScanFiles(): number {
  const configured = vscode.workspace.getConfiguration("devsnip").get<number>("securityAudit.maxFiles", DEFAULT_MAX_FILES);
  return Number.isFinite(configured) && (configured as number) > 0
    ? Math.min(Math.trunc(configured as number), 20000)
    : DEFAULT_MAX_FILES;
}

function extensionOf(uri: vscode.Uri): string {
  const name = path.basename(uri.fsPath).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name.startsWith(".env")) return "env";
  return path.extname(name).replace(".", "");
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_FILE_BYTES) return undefined;
    // A NUL byte in the first block means binary; decoding it as UTF-8 would
    // produce noise that every regular expression then matches.
    const sample = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 4096))).toString("utf8");
    if (sample.includes("\u0000")) return undefined;
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Collects the files a scan should read, de-duplicated across globs. */
async function collectScanFiles(globs: string[]): Promise<vscode.Uri[]> {
  const budget = maxScanFiles();
  const seen = new Map<string, vscode.Uri>();
  for (const glob of globs) {
    if (seen.size >= budget) break;
    const found = await vscode.workspace.findFiles(glob, SKIP_GLOB, budget);
    for (const uri of found) {
      if (seen.size >= budget) break;
      seen.set(uri.toString(), uri);
    }
  }
  return [...seen.values()];
}

/** The shape the audit panels and the existing tests consume. */
export interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  file: string;
  line: number;
  message: string;
  evidence: string;
  resource?: string;
  title?: string;
  remediation?: string;
  reference?: string;
}

function toFinding(finding: StaticFinding, resource: string): SecurityFinding {
  return {
    severity: finding.severity,
    rule: finding.rule,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    evidence: finding.evidence,
    resource,
    title: finding.title,
    remediation: finding.remediation,
    reference: finding.reference
  };
}

async function scanWith(
  globs: string[],
  accept: (uri: vscode.Uri) => boolean,
  rules: (file: string, text: string) => StaticFinding[],
  token?: vscode.CancellationToken
): Promise<SecurityFinding[]> {
  const files = (await collectScanFiles(globs)).filter(accept);
  const findings: SecurityFinding[] = [];
  // Reading files one at a time made a large workspace feel hung. Reading them
  // all at once exhausts file handles, so the scan works in fixed batches.
  const BATCH = 16;
  for (let index = 0; index < files.length; index += BATCH) {
    if (token?.isCancellationRequested) break;
    const batch = files.slice(index, index + BATCH);
    const texts = await Promise.all(batch.map(readText));
    for (let offset = 0; offset < batch.length; offset++) {
      const text = texts[offset];
      if (text === undefined) continue;
      const relative = vscode.workspace.asRelativePath(batch[offset]);
      for (const finding of rules(relative, text)) {
        findings.push(toFinding(finding, batch[offset].toString()));
      }
    }
  }
  // Ordering must be stable so re-running a scan does not reshuffle the list.
  findings.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

/** Secrets, injection and unsafe-code rules over the workspace's source. */
export async function scanWorkspaceForSecurity(token?: vscode.CancellationToken): Promise<SecurityFinding[]> {
  return scanWith(
    [SOURCE_GLOB, EXTRA_GLOB],
    uri => SOURCE_EXTENSIONS.has(extensionOf(uri)),
    scanSourceText,
    token
  );
}

/** Infrastructure-as-code and container rules over the workspace. */
export async function scanLocalCloudConfiguration(token?: vscode.CancellationToken): Promise<SecurityFinding[]> {
  return scanWith(
    [CLOUD_GLOB, EXTRA_GLOB],
    uri => CLOUD_EXTENSIONS.has(extensionOf(uri)),
    scanCloudText,
    token
  );
}

/** Reads the manifests the posture checks need. */
export async function collectManifestFiles(): Promise<WorkspaceFiles> {
  const files: WorkspaceFiles = new Map();
  const uris = await collectScanFiles([MANIFEST_GLOB, "**/.github/workflows/*.{yml,yaml}", "**/.github/dependabot.{yml,yaml}"]);
  for (const uri of uris) {
    const text = await readText(uri);
    if (text === undefined) continue;
    files.set(vscode.workspace.asRelativePath(uri).replace(/\\/g, "/"), text);
  }
  return files;
}

export async function scanWorkspacePosture(): Promise<PostureCheck[]> {
  return analyzeWorkspacePosture(await collectManifestFiles());
}

/* ------------------------------------------------------------------ *
 * Report assembly
 * ------------------------------------------------------------------ */

/** Findings from the file scanners, in the shared check shape. */
function findingsToChecks(findings: SecurityFinding[]): SecurityCheck[] {
  return findings.map((finding, index) => ({
    id: `${finding.rule}.${index}`,
    title: finding.title || finding.rule,
    category: "configuration" as const,
    status: (finding.severity === "critical" || finding.severity === "high" ? "fail" : "warn") as SecurityCheck["status"],
    severity: finding.severity,
    detail: finding.message,
    evidence: finding.evidence,
    remediation: finding.remediation,
    reference: finding.reference,
    target: `${finding.file}:${finding.line}`,
    location: { file: finding.file, line: finding.line }
  }));
}

function postureToChecks(posture: PostureCheck[]): SecurityCheck[] {
  return posture.map(check => ({
    id: check.id,
    title: check.title,
    category: check.category,
    status: check.status,
    severity: check.status === "pass" || check.status === "info" ? "none" : check.severity,
    detail: check.detail,
    evidence: check.evidence,
    remediation: check.remediation,
    reference: check.reference,
    target: check.file,
    ...(check.file ? { location: { file: check.file, line: 1 } } : {})
  } as SecurityCheck));
}

function buildReport(target: string, checks: SecurityCheck[], startedMs: number, notes: string[] = []): SecurityReport {
  const sorted = sortChecks(checks);
  return {
    target,
    startedAt: new Date(startedMs).toISOString(),
    durationMs: Date.now() - startedMs,
    checks: sorted,
    summary: summarize(sorted),
    notes
  };
}

/** A pass entry so an empty file scan is reported as a result, not a blank. */
function cleanScanCheck(id: string, title: string, detail: string): SecurityCheck {
  return { id, title, category: "configuration", status: "pass", severity: "none", detail };
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

const STATUS_LABEL: Record<SecurityCheck["status"], string> = {
  pass: "PASS", warn: "WARNING", fail: "FAILED", info: "INFO", skipped: "SKIPPED"
};

export function reportToMarkdown(scope: ScanScope, report: SecurityReport): string {
  const { summary } = report;
  const lines: string[] = [
    `# DevSnip Pro security report`,
    "",
    `- **Scan:** ${scope}`,
    `- **Target:** ${report.target}`,
    `- **Run at:** ${report.startedAt}`,
    `- **Duration:** ${report.durationMs} ms`,
    `- **Score:** ${summary.score}/100 (grade ${summary.grade})`,
    `- **Results:** ${summary.failed} failed · ${summary.warnings} warning · ${summary.passed} passed · ${summary.info} informational · ${summary.skipped} skipped`,
    `- **Severity:** ${summary.critical} critical · ${summary.high} high · ${summary.medium} medium · ${summary.low} low`,
    ""
  ];
  if (report.notes.length) {
    lines.push("## Scan notes", "", ...report.notes.map(note => `- ${note}`), "");
  }
  for (const check of report.checks) {
    lines.push(`## ${STATUS_LABEL[check.status]}${check.severity !== "none" ? ` · ${check.severity.toUpperCase()}` : ""} — ${check.title}`);
    lines.push("");
    lines.push(`- **Area:** ${CATEGORY_LABELS[check.category] || check.category}`);
    if (check.target) lines.push(`- **Affected:** \`${check.target}\``);
    lines.push("");
    lines.push(check.detail);
    if (check.evidence) lines.push("", "```", check.evidence, "```");
    if (check.remediation) lines.push("", `**Remediation:** ${check.remediation}`);
    if (check.reference) lines.push("", `**Reference:** ${check.reference}`);
    lines.push("");
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Webview
 * ------------------------------------------------------------------ */

const HUB_CSS = `
${THEME_TOKENS}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 22px 24px 60px; }
header.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; }
header.top h1 { margin: 0 0 4px; font-size: 21px; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 12.5px; max-width: 62ch; line-height: 1.5; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 18px; overflow-x: auto; }
.tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted);
  padding: 9px 14px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; border-radius: 4px 4px 0 0; }
.tab:hover { color: var(--text); background: var(--panel-2); }
.tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.tab:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.pane[hidden] { display: none !important; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin-bottom: 16px; }
.card h2 { margin: 0 0 6px; font-size: 14px; }
.card .hint { color: var(--muted); font-size: 12px; line-height: 1.55; margin: 0 0 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
label.field { display: block; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin-bottom: 5px; }
input[type="text"], input[type="number"], select, textarea {
  width: 100%; padding: 8px 10px; background: var(--panel-2); color: var(--text);
  border: 1px solid var(--line); border-radius: 6px; font: 12.5px var(--mono); outline: none; }
input:focus, select:focus, textarea:focus { border-color: var(--focus); }
textarea { resize: vertical; min-height: 72px; line-height: 1.5; }
.toggles { display: flex; flex-wrap: wrap; gap: 16px; margin: 14px 0 0; }
.toggle { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: var(--text); cursor: pointer; max-width: 330px; }
.toggle input { margin: 2px 0 0; cursor: pointer; }
.toggle span small { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.45; margin-top: 2px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
button.btn { appearance: none; border: 1px solid transparent; border-radius: 6px; padding: 8px 15px;
  font: 600 12.5px var(--font); cursor: pointer; background: var(--accent-strong); color: var(--accent-fg); }
button.btn:hover:not(:disabled) { filter: brightness(1.1); }
button.btn:disabled { opacity: .55; cursor: not-allowed; }
button.btn.ghost { background: transparent; color: var(--text); border-color: var(--line); }
button.btn.ghost:hover:not(:disabled) { background: var(--panel-2); }
button.btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.progress { display: none; align-items: center; gap: 10px; margin-top: 14px; color: var(--muted); font-size: 12.5px; }
.progress.on { display: flex; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
.bar { height: 4px; background: var(--panel-2); border-radius: 2px; overflow: hidden; margin-top: 10px; }
.bar > i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .25s ease; }
.banner { border-radius: 8px; padding: 11px 13px; font-size: 12.5px; line-height: 1.5; margin-top: 14px; border: 1px solid var(--line); }
.banner.error { border-color: var(--danger); color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.banner.note { color: var(--muted); }
.score { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.grade { width: 74px; height: 74px; border-radius: 50%; display: grid; place-items: center; font-size: 25px; font-weight: 800;
  border: 3px solid var(--accent); color: var(--text); flex: none; }
.grade.good { border-color: var(--success); color: var(--success); }
.grade.mid { border-color: var(--warning); color: var(--warning); }
.grade.bad { border-color: var(--danger); color: var(--danger); }
.score-meta { font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.score-meta strong { color: var(--text); }
.counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 9px; margin-top: 15px; }
.count { background: var(--panel-2); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 7px; padding: 9px 11px; }
.count b { display: block; font-size: 19px; line-height: 1.3; }
.count span { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.count.fail { border-left-color: var(--danger); } .count.warn { border-left-color: var(--warning); }
.count.pass { border-left-color: var(--success); } .count.info, .count.skip { border-left-color: var(--muted); }
.filters { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; margin: 16px 0 12px; }
.chip { appearance: none; border: 1px solid var(--line); background: transparent; color: var(--muted);
  border-radius: 999px; padding: 5px 12px; font: 600 11.5px var(--font); cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--accent-strong); border-color: var(--accent-strong); color: var(--accent-fg); }
.chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.filters input.search { flex: 1 1 180px; min-width: 150px; max-width: 280px; padding: 6px 10px; border-radius: 999px; font-family: var(--font); }
.result { border: 1px solid var(--line); border-left: 4px solid var(--muted); border-radius: 9px; background: var(--panel);
  margin-bottom: 9px; overflow: hidden; }
.result.fail { border-left-color: var(--danger); } .result.warn { border-left-color: var(--warning); }
.result.pass { border-left-color: var(--success); } .result.info { border-left-color: var(--accent); }
.result > summary { list-style: none; cursor: pointer; padding: 12px 14px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.result > summary::-webkit-details-marker { display: none; }
.result > summary:hover { background: var(--panel-2); }
.result > summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.pill { font: 800 9.5px var(--font); letter-spacing: .07em; padding: 3px 7px; border-radius: 4px; flex: none; }
.pill.fail { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }
.pill.warn { background: color-mix(in srgb, var(--warning) 22%, transparent); color: var(--warning); }
.pill.pass { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
.pill.info { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
.pill.skip { background: var(--panel-2); color: var(--muted); }
.sev { font: 700 10px var(--font); letter-spacing: .05em; color: var(--muted); text-transform: uppercase; }
.result-title { font-weight: 600; font-size: 13px; flex: 1 1 260px; }
.area { color: var(--muted); font-size: 11.5px; }
.result-body { padding: 0 14px 14px 14px; border-top: 1px solid var(--line); margin-top: -1px; }
.result-body p { margin: 12px 0 0; line-height: 1.6; font-size: 12.5px; }
.kv { margin-top: 11px; font-size: 12px; color: var(--muted); word-break: break-word; }
.kv b { color: var(--text); font-weight: 600; }
pre.evidence { margin: 11px 0 0; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px;
  padding: 9px 11px; font: 11.5px/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; overflow-x: auto; color: var(--muted); }
.fix { margin-top: 11px; padding: 10px 12px; border-radius: 6px; background: var(--panel-2); border: 1px solid var(--line);
  font-size: 12.5px; line-height: 1.6; }
.fix b { color: var(--text); }
button.link { appearance: none; background: none; border: 0; padding: 0; margin-top: 10px; color: var(--accent);
  font: 600 12px var(--font); cursor: pointer; text-align: left; }
button.link:hover { text-decoration: underline; }
.empty { text-align: center; padding: 42px 18px; color: var(--muted); border: 1px dashed var(--line); border-radius: 9px; }
.empty b { display: block; color: var(--text); font-size: 14px; margin-bottom: 5px; }
.toast { position: fixed; right: 16px; bottom: 16px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 10px 14px; font-size: 12.5px; box-shadow: 0 6px 20px rgba(0,0,0,.28); opacity: 0;
  transform: translateY(10px); transition: opacity .2s, transform .2s; pointer-events: none; max-width: 340px; }
.toast.on { opacity: 1; transform: translateY(0); }
@media (max-width: 620px) { .wrap { padding: 16px; } .grid { grid-template-columns: 1fr; } }
`;

function securityHubHtml(nonce: string, initial: { url: string; timeoutMs: number; activeChecks: boolean }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DevSnip Pro Security</title>
<style>${HUB_CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>🛡️ Security</h1>
      <div class="sub">Live endpoint scanning plus static analysis of this workspace. Every check is performed for real
        against the target you choose &mdash; nothing here is a sample result &mdash; and each finding carries the evidence it was based on
        and the change that resolves it.</div>
    </div>
  </header>

  <div class="tabs" role="tablist">
    <button class="tab" role="tab" id="tab-endpoint" aria-controls="pane-endpoint" aria-selected="true" data-scope="endpoint">Endpoint scan</button>
    <button class="tab" role="tab" id="tab-workspace" aria-controls="pane-workspace" aria-selected="false" data-scope="workspace">Workspace audit</button>
    <button class="tab" role="tab" id="tab-cloud" aria-controls="pane-cloud" aria-selected="false" data-scope="cloud">Cloud &amp; container</button>
    <button class="tab" role="tab" id="tab-posture" aria-controls="pane-posture" aria-selected="false" data-scope="posture">Dependencies &amp; config</button>
  </div>

  <section class="pane" id="pane-endpoint" role="tabpanel" aria-labelledby="tab-endpoint">
    <div class="card">
      <h2>Scan a live endpoint</h2>
      <p class="hint">Sends real requests to the URL below and grades what comes back: TLS and certificate state, HSTS,
        security headers, CSP, CORS, cookie flags, authorization enforcement, information exposure and rate limiting.
        Only scan hosts you are authorised to test.</p>
      <div class="grid">
        <div>
          <label class="field" for="epUrl">Target URL</label>
          <input type="text" id="epUrl" placeholder="https://api.example.com/v1/users" value="${escapeHtml(initial.url)}" spellcheck="false">
        </div>
        <div>
          <label class="field" for="epMethod">Method</label>
          <select id="epMethod">
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option>
          </select>
        </div>
        <div>
          <label class="field" for="epTimeout">Timeout (ms)</label>
          <input type="number" id="epTimeout" value="${initial.timeoutMs}" min="1000" max="120000" step="1000">
        </div>
      </div>
      <div class="grid" style="margin-top:12px">
        <div>
          <label class="field" for="epHeaders">Request headers (one per line, <code>Name: value</code>)</label>
          <textarea id="epHeaders" spellcheck="false" placeholder="Authorization: Bearer ...&#10;Content-Type: application/json"></textarea>
        </div>
        <div>
          <label class="field" for="epBody">Request body (used for POST, PUT and PATCH)</label>
          <textarea id="epBody" spellcheck="false" placeholder='{ "example": true }'></textarea>
        </div>
      </div>
      <div class="toggles">
        <label class="toggle"><input type="checkbox" id="epActive"${initial.activeChecks ? " checked" : ""}><span>Active checks
          <small>Adds a harmless reflected-input probe and requests well-known sensitive paths (.env, .git, actuator, backups). Read-only, but it generates traffic the target did not ask for.</small></span></label>
        <label class="toggle"><input type="checkbox" id="epBurst"><span>Rate-limit burst
          <small>Sends 10 concurrent copies of the request to see whether the endpoint throttles. Skip it on production systems you do not own.</small></span></label>
      </div>
      <div class="actions">
        <button class="btn" id="epRun">Run endpoint scan</button>
        <button class="btn ghost" id="epCancel" disabled>Cancel</button>
      </div>
      <div class="progress" id="epProgress"><span class="spinner"></span><span id="epProgressText">Starting…</span></div>
      <div class="bar" id="epBar" hidden><i></i></div>
      <div id="epBanner"></div>
    </div>
    <div id="epResults"></div>
  </section>

  <section class="pane" id="pane-workspace" role="tabpanel" aria-labelledby="tab-workspace" hidden>
    <div class="card">
      <h2>Audit this workspace's source</h2>
      <p class="hint">Reads the source, configuration and script files in the open workspace and applies the secret,
        injection, cryptography and unsafe-configuration rules. Everything stays on this machine and matched values are masked
        before they are shown.</p>
      <div class="actions">
        <button class="btn" id="wsRun">Run workspace audit</button>
      </div>
      <div class="progress" id="wsProgress"><span class="spinner"></span><span id="wsProgressText">Scanning…</span></div>
      <div id="wsBanner"></div>
    </div>
    <div id="wsResults"></div>
  </section>

  <section class="pane" id="pane-cloud" role="tabpanel" aria-labelledby="tab-cloud" hidden>
    <div class="card">
      <h2>Audit infrastructure and container configuration</h2>
      <p class="hint">Applies infrastructure-as-code rules to Terraform, Kubernetes, Compose, Dockerfiles and CI workflows in
        this workspace: open network rules, wildcard IAM, public storage, privileged containers, mutable image tags and
        embedded credentials.</p>
      <div class="actions">
        <button class="btn" id="clRun">Run cloud &amp; container audit</button>
      </div>
      <div class="progress" id="clProgress"><span class="spinner"></span><span id="clProgressText">Scanning…</span></div>
      <div id="clBanner"></div>
    </div>
    <div id="clResults"></div>
  </section>

  <section class="pane" id="pane-posture" role="tabpanel" aria-labelledby="tab-posture" hidden>
    <div class="card">
      <h2>Check dependency and security configuration</h2>
      <p class="hint">Reads the manifests in this workspace and reports on lockfiles, unbounded version ranges, abandoned or
        compromised packages, registry credentials, environment-file hygiene, automated dependency updates and whether CI
        runs a security scan. This check reports passes as well as problems.</p>
      <div class="actions">
        <button class="btn" id="poRun">Run dependency &amp; config check</button>
      </div>
      <div class="progress" id="poProgress"><span class="spinner"></span><span id="poProgressText">Reading manifests…</span></div>
      <div id="poBanner"></div>
    </div>
    <div id="poResults"></div>
  </section>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
${hubScript()}
</script>
</body>
</html>`;
}

/**
 * The webview script.
 *
 * Kept free of template literals so the extension-host template that embeds it
 * cannot accidentally interpolate part of it, and written against the same
 * check shape for every scan so there is exactly one renderer to maintain.
 */
function hubScript(): string {
  return `
const vscode = acquireVsCodeApi();

var SCOPES = {
  endpoint: { run: 'epRun', cancel: 'epCancel', progress: 'epProgress', text: 'epProgressText', bar: 'epBar', banner: 'epBanner', results: 'epResults', label: 'Endpoint scan' },
  workspace: { run: 'wsRun', progress: 'wsProgress', text: 'wsProgressText', banner: 'wsBanner', results: 'wsResults', label: 'Workspace audit' },
  cloud: { run: 'clRun', progress: 'clProgress', text: 'clProgressText', banner: 'clBanner', results: 'clResults', label: 'Cloud & container audit' },
  posture: { run: 'poRun', progress: 'poProgress', text: 'poProgressText', banner: 'poBanner', results: 'poResults', label: 'Dependency & config check' }
};

var state = {};
Object.keys(SCOPES).forEach(function (scope) {
  state[scope] = { report: null, filter: 'all', query: '', busy: false };
});

function el(id) { return document.getElementById(id); }

function toast(message) {
  var node = el('toast');
  node.textContent = message;
  node.classList.add('on');
  clearTimeout(node._timer);
  node._timer = setTimeout(function () { node.classList.remove('on'); }, 2600);
}

/* ---- tabs ---- */
Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
  tab.addEventListener('click', function () { selectTab(tab.dataset.scope); });
  tab.addEventListener('keydown', function (event) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') { tabs[(index + 1) % tabs.length].focus(); tabs[(index + 1) % tabs.length].click(); }
    if (event.key === 'ArrowLeft') { tabs[(index - 1 + tabs.length) % tabs.length].focus(); tabs[(index - 1 + tabs.length) % tabs.length].click(); }
  });
});

function selectTab(scope) {
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    var active = tab.dataset.scope === scope;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (pane) {
    pane.hidden = pane.id !== 'pane-' + scope;
  });
}

/* ---- running a scan ---- */
function setBusy(scope, busy, message) {
  var config = SCOPES[scope];
  state[scope].busy = busy;
  var runButton = el(config.run);
  if (runButton) runButton.disabled = busy;
  if (config.cancel) { var cancelButton = el(config.cancel); if (cancelButton) cancelButton.disabled = !busy; }
  var progress = el(config.progress);
  if (progress) progress.classList.toggle('on', busy);
  if (message) { var text = el(config.text); if (text) text.textContent = message; }
  if (config.bar) {
    var bar = el(config.bar);
    if (bar) { bar.hidden = !busy; if (!busy) bar.firstElementChild.style.width = '0'; }
  }
}

function showBanner(scope, kind, message) {
  var node = el(SCOPES[scope].banner);
  if (!node) return;
  if (!message) { node.innerHTML = ''; return; }
  var div = document.createElement('div');
  div.className = 'banner ' + kind;
  div.textContent = message;
  node.innerHTML = '';
  node.appendChild(div);
}

function parseHeaders(text) {
  var headers = {};
  String(text || '').split(/\\r?\\n/).forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') return;
    var separator = trimmed.indexOf(':');
    if (separator <= 0) return;
    var name = trimmed.slice(0, separator).trim();
    var value = trimmed.slice(separator + 1).trim();
    if (name) headers[name] = value;
  });
  return headers;
}

el('epRun').addEventListener('click', function () {
  var url = el('epUrl').value.trim();
  if (!url) { showBanner('endpoint', 'error', 'Enter a URL to scan.'); el('epUrl').focus(); return; }
  if (!/^https?:\\/\\//i.test(url)) { showBanner('endpoint', 'error', 'The URL needs a scheme, for example https://api.example.com/health'); el('epUrl').focus(); return; }
  showBanner('endpoint', '', '');
  setBusy('endpoint', true, 'Starting the scan…');
  vscode.postMessage({
    type: 'scanEndpoint',
    url: url,
    method: el('epMethod').value,
    headers: parseHeaders(el('epHeaders').value),
    body: el('epBody').value,
    timeoutMs: Number(el('epTimeout').value) || 15000,
    activeChecks: el('epActive').checked,
    burst: el('epBurst').checked
  });
});

el('epCancel').addEventListener('click', function () {
  vscode.postMessage({ type: 'cancel', scope: 'endpoint' });
  el('epCancel').disabled = true;
  el('epProgressText').textContent = 'Cancelling after the current probe…';
});

[['wsRun', 'workspace', 'scanWorkspace'], ['clRun', 'cloud', 'scanCloud'], ['poRun', 'posture', 'scanPosture']]
  .forEach(function (entry) {
    el(entry[0]).addEventListener('click', function () {
      showBanner(entry[1], '', '');
      setBusy(entry[1], true, 'Reading workspace files…');
      vscode.postMessage({ type: entry[2] });
    });
  });

/* ---- rendering ---- */
var STATUS_META = {
  fail: { label: 'FAILED', klass: 'fail' },
  warn: { label: 'WARNING', klass: 'warn' },
  pass: { label: 'PASS', klass: 'pass' },
  info: { label: 'INFO', klass: 'info' },
  skipped: { label: 'SKIPPED', klass: 'skip' }
};

var FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'fail', label: 'Failed' },
  { id: 'warn', label: 'Warnings' },
  { id: 'pass', label: 'Passed' },
  { id: 'info', label: 'Info' },
  { id: 'skipped', label: 'Skipped' }
];

function gradeClass(summary) {
  if (summary.critical > 0 || summary.score < 55) return 'bad';
  if (summary.score < 85) return 'mid';
  return 'good';
}

function countNode(klass, value, label) {
  var node = document.createElement('div');
  node.className = 'count ' + klass;
  var strong = document.createElement('b');
  strong.textContent = String(value);
  var span = document.createElement('span');
  span.textContent = label;
  node.appendChild(strong);
  node.appendChild(span);
  return node;
}

function render(scope) {
  var container = el(SCOPES[scope].results);
  var current = state[scope];
  container.innerHTML = '';
  if (!current.report) return;

  var report = current.report;
  var summary = report.summary;

  var card = document.createElement('div');
  card.className = 'card';

  var score = document.createElement('div');
  score.className = 'score';
  var grade = document.createElement('div');
  grade.className = 'grade ' + gradeClass(summary);
  grade.textContent = summary.grade;
  score.appendChild(grade);

  var meta = document.createElement('div');
  meta.className = 'score-meta';
  var line1 = document.createElement('div');
  line1.innerHTML = '<strong>' + summary.score + '/100</strong> · ' + escapeText(report.target);
  var line2 = document.createElement('div');
  line2.textContent = summary.total + ' checks in ' + report.durationMs + ' ms · ' +
    summary.critical + ' critical, ' + summary.high + ' high, ' + summary.medium + ' medium, ' + summary.low + ' low';
  meta.appendChild(line1);
  meta.appendChild(line2);
  score.appendChild(meta);
  card.appendChild(score);

  var counts = document.createElement('div');
  counts.className = 'counts';
  counts.appendChild(countNode('fail', summary.failed, 'Failed'));
  counts.appendChild(countNode('warn', summary.warnings, 'Warnings'));
  counts.appendChild(countNode('pass', summary.passed, 'Passed'));
  counts.appendChild(countNode('info', summary.info, 'Info'));
  counts.appendChild(countNode('skip', summary.skipped, 'Skipped'));
  card.appendChild(counts);

  if (report.notes && report.notes.length) {
    var notes = document.createElement('div');
    notes.className = 'banner note';
    notes.textContent = 'Scan notes: ' + report.notes.join(' · ');
    card.appendChild(notes);
  }

  var exportRow = document.createElement('div');
  exportRow.className = 'actions';
  var markdownButton = document.createElement('button');
  markdownButton.className = 'btn ghost';
  markdownButton.textContent = 'Save report as Markdown';
  markdownButton.addEventListener('click', function () { vscode.postMessage({ type: 'export', scope: scope, format: 'markdown' }); });
  var jsonButton = document.createElement('button');
  jsonButton.className = 'btn ghost';
  jsonButton.textContent = 'Save report as JSON';
  jsonButton.addEventListener('click', function () { vscode.postMessage({ type: 'export', scope: scope, format: 'json' }); });
  exportRow.appendChild(markdownButton);
  exportRow.appendChild(jsonButton);
  card.appendChild(exportRow);
  container.appendChild(card);

  var filters = document.createElement('div');
  filters.className = 'filters';
  FILTERS.forEach(function (filter) {
    var count = filter.id === 'all' ? report.checks.length : report.checks.filter(function (check) { return check.status === filter.id; }).length;
    if (filter.id !== 'all' && count === 0) return;
    var chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = filter.label + ' (' + count + ')';
    chip.setAttribute('aria-pressed', current.filter === filter.id ? 'true' : 'false');
    chip.addEventListener('click', function () { current.filter = filter.id; render(scope); });
    filters.appendChild(chip);
  });
  var search = document.createElement('input');
  search.type = 'text';
  search.className = 'search';
  search.placeholder = 'Filter results…';
  search.value = current.query;
  search.addEventListener('input', function () {
    current.query = search.value;
    renderList(scope, list);
  });
  filters.appendChild(search);
  container.appendChild(filters);

  var list = document.createElement('div');
  container.appendChild(list);
  renderList(scope, list);
}

function renderList(scope, list) {
  var current = state[scope];
  var report = current.report;
  var query = current.query.trim().toLowerCase();
  list.innerHTML = '';

  var visible = report.checks.filter(function (check) {
    if (current.filter !== 'all' && check.status !== current.filter) return false;
    if (!query) return true;
    return (check.title + ' ' + check.detail + ' ' + (check.target || '') + ' ' + (check.evidence || '') + ' ' + check.id)
      .toLowerCase().indexOf(query) !== -1;
  });

  if (!visible.length) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    var bold = document.createElement('b');
    bold.textContent = 'Nothing matches this filter';
    var text = document.createElement('div');
    text.textContent = 'Clear the search box or choose another filter to see the rest of the results.';
    empty.appendChild(bold);
    empty.appendChild(text);
    list.appendChild(empty);
    return;
  }

  visible.forEach(function (check) {
    list.appendChild(resultNode(scope, check));
  });
}

function escapeText(value) {
  var div = document.createElement('div');
  div.textContent = String(value == null ? '' : value);
  return div.innerHTML;
}

function resultNode(scope, check) {
  var meta = STATUS_META[check.status] || STATUS_META.info;
  var details = document.createElement('details');
  details.className = 'result ' + meta.klass;
  // Anything that needs action is open by default; passes stay collapsed.
  details.open = check.status === 'fail' || check.status === 'warn';

  var summary = document.createElement('summary');
  var pill = document.createElement('span');
  pill.className = 'pill ' + meta.klass;
  pill.textContent = meta.label;
  summary.appendChild(pill);

  if (check.severity && check.severity !== 'none') {
    var sev = document.createElement('span');
    sev.className = 'sev';
    sev.textContent = check.severity;
    summary.appendChild(sev);
  }

  var title = document.createElement('span');
  title.className = 'result-title';
  title.textContent = check.title;
  summary.appendChild(title);

  var area = document.createElement('span');
  area.className = 'area';
  area.textContent = check.categoryLabel || check.category;
  summary.appendChild(area);
  details.appendChild(summary);

  var body = document.createElement('div');
  body.className = 'result-body';

  var detail = document.createElement('p');
  detail.textContent = check.detail;
  body.appendChild(detail);

  if (check.target) {
    var target = document.createElement('div');
    target.className = 'kv';
    target.innerHTML = '<b>Affected:</b> ' + escapeText(check.target);
    body.appendChild(target);
  }

  if (check.evidence) {
    var evidence = document.createElement('pre');
    evidence.className = 'evidence';
    evidence.textContent = check.evidence;
    body.appendChild(evidence);
  }

  if (check.remediation) {
    var fix = document.createElement('div');
    fix.className = 'fix';
    fix.innerHTML = '<b>How to fix:</b> ' + escapeText(check.remediation);
    body.appendChild(fix);
  }

  if (check.reference) {
    var reference = document.createElement('div');
    reference.className = 'kv';
    reference.innerHTML = '<b>Reference:</b> ' + escapeText(check.reference);
    body.appendChild(reference);
  }

  if (check.location) {
    var open = document.createElement('button');
    open.className = 'link';
    open.type = 'button';
    open.textContent = 'Open ' + check.location.file + ':' + check.location.line + ' →';
    open.addEventListener('click', function () {
      vscode.postMessage({ type: 'openLocation', file: check.location.file, line: check.location.line, resource: check.resource });
    });
    body.appendChild(open);
  }

  details.appendChild(body);
  return details;
}

/* ---- host messages ---- */
var SCAN_TRIGGERS = {
  endpoint: function () { el('epRun').click(); },
  workspace: function () { el('wsRun').click(); },
  cloud: function () { el('clRun').click(); },
  posture: function () { el('poRun').click(); }
};

window.addEventListener('message', function (event) {
  var message = event.data || {};
  var scope = message.scope;
  if (message.type === 'command') {
    if (scope && SCOPES[scope]) selectTab(scope);
    if (message.run && SCAN_TRIGGERS[scope] && !state[scope].busy) SCAN_TRIGGERS[scope]();
    return;
  }
  if (message.type === 'progress' && SCOPES[scope]) {
    var text = el(SCOPES[scope].text);
    if (text) text.textContent = message.label + ' (' + message.index + '/' + message.total + ')';
    if (SCOPES[scope].bar) {
      var bar = el(SCOPES[scope].bar);
      if (bar && bar.firstElementChild) bar.firstElementChild.style.width = Math.round((message.index / message.total) * 100) + '%';
    }
    return;
  }
  if (message.type === 'result' && SCOPES[scope]) {
    state[scope].report = message.report;
    state[scope].filter = 'all';
    setBusy(scope, false);
    showBanner(scope, '', '');
    render(scope);
    var summary = message.report.summary;
    toast(SCOPES[scope].label + ': ' + summary.failed + ' failed, ' + summary.warnings + ' warning, ' + summary.passed + ' passed.');
    return;
  }
  if (message.type === 'error' && SCOPES[scope]) {
    setBusy(scope, false);
    showBanner(scope, 'error', message.message);
    return;
  }
  if (message.type === 'toast') { toast(message.message); }
});

// The host holds any scan requested before the page was parsed and replays it
// once this fires, so opening a panel straight into a scan is not a race.
vscode.postMessage({ type: 'ready' });
`;
}

/* ------------------------------------------------------------------ *
 * Panel wiring
 * ------------------------------------------------------------------ */

/** A check as the webview receives it: label and resource resolved by the host. */
type WireCheck = SecurityCheck & { categoryLabel: string; resource?: string };

function toWire(checks: SecurityCheck[], resources?: Map<string, string>): WireCheck[] {
  return checks.map(check => ({
    ...check,
    categoryLabel: CATEGORY_LABELS[check.category] || check.category,
    ...(check.location && resources?.has(`${check.location.file}:${check.location.line}`)
      ? { resource: resources.get(`${check.location.file}:${check.location.line}`) }
      : {})
  }));
}

interface ScanState {
  report?: SecurityReport;
  cancel?: vscode.CancellationTokenSource;
}

async function openLocation(file: string, line: number, resource?: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  try {
    const uri = resource ? vscode.Uri.parse(resource) : root ? vscode.Uri.joinPath(root.uri, file) : vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    const target = Math.max(0, Math.min(line - 1, document.lineCount - 1));
    const position = new vscode.Position(target, 0);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      selection: new vscode.Range(position, position)
    });
  } catch (error) {
    vscode.window.showErrorMessage(`DevSnip Pro could not open ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveReport(scope: ScanScope, report: SecurityReport, format: "markdown" | "json"): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const extension = format === "markdown" ? "md" : "json";
  const root = vscode.workspace.workspaceFolders?.[0];
  const defaultUri = root
    ? vscode.Uri.joinPath(root.uri, `devsnip-security-${scope}-${stamp}.${extension}`)
    : vscode.Uri.file(`devsnip-security-${scope}-${stamp}.${extension}`);
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: format === "markdown" ? { Markdown: ["md"] } : { JSON: ["json"] },
    saveLabel: "Save security report"
  });
  if (!target) return;
  const content = format === "markdown"
    ? reportToMarkdown(scope, report)
    : JSON.stringify({ scope, ...report }, null, 2);
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
  const open = await vscode.window.showInformationMessage(`Security report saved to ${path.basename(target.fsPath)}.`, "Open");
  if (open === "Open") {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
  }
}

/** Panel defaults: the last URL scanned plus the user's security settings. */
function hubDefaults(context: vscode.ExtensionContext): { url: string; timeoutMs: number; activeChecks: boolean } {
  const settings = vscode.workspace.getConfiguration("devsnip");
  const remembered = context.globalState.get<string>("devsnip.security.lastUrl");
  const timeout = settings.get<number>("security.endpointTimeout", 15000);
  return {
    url: typeof remembered === "string" ? remembered : "",
    timeoutMs: Number.isFinite(timeout) ? Math.min(120000, Math.max(1000, Math.trunc(timeout as number))) : 15000,
    activeChecks: settings.get<boolean>("security.activeChecks", false) === true
  };
}

export function registerSecurityToolsCommands(context: vscode.ExtensionContext): void {
  const scans = new Map<ScanScope, ScanState>();
  // A panel is only ready once its script has parsed and said so. Anything
  // posted before that is dropped by the webview, which is what would make a
  // command that opens the panel and starts a scan in one step do nothing.
  const ready = new Set<vscode.WebviewPanel>();
  const pending = new Map<vscode.WebviewPanel, Array<Record<string, unknown>>>();

  const send = (panel: vscode.WebviewPanel, message: Record<string, unknown>): void => {
    if (ready.has(panel)) { safePostMessage(panel, message); return; }
    const queue = pending.get(panel) || [];
    queue.push(message);
    pending.set(panel, queue);
  };

  const openHub = (focusScope?: ScanScope, run = false): vscode.WebviewPanel => {
    const { panel, created } = openToolPanel("devsnipSecurityHub", "DevSnip Pro · Security", {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    if (created) {
      panel.webview.html = securityHubHtml(getNonce(), hubDefaults(context));
      const subscription = panel.webview.onDidReceiveMessage(message => {
        if (message?.type === "ready") {
          ready.add(panel);
          for (const queued of pending.get(panel) || []) safePostMessage(panel, queued);
          pending.delete(panel);
          return;
        }
        void handleMessage(panel, message);
      });
      panel.onDidDispose(() => {
        subscription.dispose();
        for (const state of scans.values()) state.cancel?.cancel();
        scans.clear();
        ready.delete(panel);
        pending.delete(panel);
      });
    }
    if (focusScope) send(panel, { type: "command", scope: focusScope, run });
    return panel;
  };

  async function handleMessage(panel: vscode.WebviewPanel, message: any): Promise<void> {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "openLocation") {
      await openLocation(String(message.file || ""), Number(message.line) || 1, typeof message.resource === "string" ? message.resource : undefined);
      return;
    }

    if (message.type === "cancel") {
      const state = scans.get(message.scope as ScanScope);
      state?.cancel?.cancel();
      return;
    }

    if (message.type === "export") {
      const scope = message.scope as ScanScope;
      const report = scans.get(scope)?.report;
      if (!report) {
        send(panel, { type: "toast", message: "Run the scan first - there is no report to export yet." });
        return;
      }
      try {
        await saveReport(scope, report, message.format === "json" ? "json" : "markdown");
      } catch (error) {
        send(panel, { type: "toast", message: `Could not save the report: ${error instanceof Error ? error.message : String(error)}` });
      }
      return;
    }

    if (message.type === "scanEndpoint") { await runEndpoint(panel, message); return; }
    if (message.type === "scanWorkspace") { await runFileScan(panel, "workspace"); return; }
    if (message.type === "scanCloud") { await runFileScan(panel, "cloud"); return; }
    if (message.type === "scanPosture") { await runPosture(panel); return; }
  }

  async function runEndpoint(panel: vscode.WebviewPanel, message: any): Promise<void> {
    const url = String(message.url || "").trim();
    const cancellation = new vscode.CancellationTokenSource();
    scans.set("endpoint", { ...scans.get("endpoint"), cancel: cancellation });

    try {
      await context.globalState.update("devsnip.security.lastUrl", url);
      const headers: Record<string, string> = {};
      if (message.headers && typeof message.headers === "object") {
        for (const [name, value] of Object.entries(message.headers as Record<string, unknown>)) {
          if (typeof value === "string") headers[String(name)] = value;
        }
      }
      const report = await runEndpointScan({
        url,
        method: String(message.method || "GET"),
        headers,
        body: typeof message.body === "string" ? message.body : undefined,
        timeoutMs: Math.min(120000, Math.max(1000, Number(message.timeoutMs) || 15000)),
        activeChecks: !!message.activeChecks,
        burstRequests: message.burst ? 10 : 0,
        onProgress: (label, index, total) => send(panel, { type: "progress", scope: "endpoint", label, index, total }),
        isCancelled: () => cancellation.token.isCancellationRequested
      });
      scans.set("endpoint", { report, cancel: undefined });
      send(panel, {
        type: "result",
        scope: "endpoint",
        report: { ...report, checks: toWire(report.checks) }
      });
    } catch (error) {
      send(panel, {
        type: "error",
        scope: "endpoint",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      cancellation.dispose();
    }
  }

  async function runFileScan(panel: vscode.WebviewPanel, scope: "workspace" | "cloud"): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      send(panel, { type: "error", scope, message: "Open a folder or workspace first - there are no files to scan." });
      return;
    }
    const cancellation = new vscode.CancellationTokenSource();
    scans.set(scope, { ...scans.get(scope), cancel: cancellation });
    const started = Date.now();
    try {
      const findings = scope === "workspace"
        ? await scanWorkspaceForSecurity(cancellation.token)
        : await scanLocalCloudConfiguration(cancellation.token);
      const resources = new Map<string, string>();
      for (const finding of findings) {
        if (finding.resource) resources.set(`${finding.file}:${finding.line}`, finding.resource);
      }
      const checks = findingsToChecks(findings);
      if (!checks.length) {
        checks.push(cleanScanCheck(
          `${scope}.clean`,
          scope === "workspace" ? "No matching risk found in workspace source" : "No matching risk found in infrastructure files",
          scope === "workspace"
            ? "Every source, configuration and script file in the workspace was matched against the secret, injection, cryptography and unsafe-configuration rules with no hit. This is a fast local check - keep dependency scanning, SAST and secret scanning in CI as well."
            : "Every Terraform, Kubernetes, Compose, Dockerfile and workflow file in the workspace was matched against the infrastructure rules with no hit."
        ));
      }
      const folder = vscode.workspace.workspaceFolders[0].name;
      const report = buildReport(folder, checks, started);
      scans.set(scope, { report, cancel: undefined });
      send(panel, { type: "result", scope, report: { ...report, checks: toWire(report.checks, resources) } });
    } catch (error) {
      send(panel, { type: "error", scope, message: error instanceof Error ? error.message : String(error) });
    } finally {
      cancellation.dispose();
    }
  }

  async function runPosture(panel: vscode.WebviewPanel): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      send(panel, { type: "error", scope: "posture", message: "Open a folder or workspace first - there are no manifests to read." });
      return;
    }
    const started = Date.now();
    try {
      const posture = await scanWorkspacePosture();
      const checks = postureToChecks(posture);
      if (!checks.length) {
        checks.push(cleanScanCheck("posture.none", "No dependency manifest found",
          "No package.json, requirements.txt or equivalent manifest was found in this workspace, so there was nothing for the dependency checks to read."));
      }
      const report = buildReport(vscode.workspace.workspaceFolders[0].name, checks, started);
      scans.set("posture", { report });
      send(panel, { type: "result", scope: "posture", report: { ...report, checks: toWire(report.checks) } });
    } catch (error) {
      send(panel, { type: "error", scope: "posture", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const hub = registerTrackedCommand("sayaib.hue-console.securityHub", () => { openHub(); });
  const endpoint = registerTrackedCommand("sayaib.hue-console.endpointSecurityScan", () => { openHub("endpoint"); });
  const audit = registerTrackedCommand("sayaib.hue-console.securityAudit", () => { openHub("workspace", true); });
  const cloudAudit = registerTrackedCommand("sayaib.hue-console.cloudSecurityAudit", () => { openHub("cloud", true); });
  const dependencyAudit = registerTrackedCommand("sayaib.hue-console.dependencyAudit", () => { openHub("posture", true); });

  context.subscriptions.push(hub, endpoint, audit, cloudAudit, dependencyAudit);
}
