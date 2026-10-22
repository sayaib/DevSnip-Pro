import type { Finding, PackageRecord, Remediation, ScanResult, Severity } from "./types";
import { SEVERITY_ORDER } from "./types";

/**
 * Exported reports: the scan result as JSON (the same shape the panel uses,
 * documented in docs/OSV-SCANNER.md) and as a self-contained HTML page with
 * no scripts and no external resources, safe to attach to a ticket or open
 * offline. Every value from a dependency file or an advisory is escaped.
 */

export function reportJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

/** Only http(s) links become anchors. */
function link(url: string, text?: string): string {
  return /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(text ?? url)}</a>` : esc(text ?? url);
}

const LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", unknown: "Unknown" };

function date(value?: string): string {
  return value ? esc(value.slice(0, 10)) : "—";
}

function findingBlock(finding: Finding, pkg: PackageRecord | undefined): string {
  const locations = (pkg?.occurrences ?? []).map(o => `<li><code>${esc(o.file)}${o.line ? `:${o.line}` : ""}</code>${o.direct === true ? " · direct" : o.direct === false ? " · transitive" : ""}${o.scope !== "production" ? ` · ${esc(o.scope)}` : ""}${o.via?.length ? `<br><span class="muted">via ${esc(o.via.join(" → "))}</span>` : ""}</li>`).join("");
  const refs = finding.references.slice(0, 12).map(r => `<li><span class="muted">${esc(r.type)}</span> ${link(r.url)}</li>`).join("");
  return `<details class="finding sev-${finding.severity}">
<summary><span class="pill ${finding.severity}">${LABEL[finding.severity]}</span>${finding.confidence === "potential" ? `<span class="pill potential">Potential</span>` : ""}
<b>${esc(finding.packageName)}</b> <code>${esc(finding.installedVersion ?? "version unknown")}</code> · ${link(finding.osvUrl, finding.id)}${finding.aliases.length ? ` <span class="muted">(${esc(finding.aliases.slice(0, 4).join(", "))}${finding.aliases.length > 4 ? ", …" : ""})</span>` : ""}
<span class="summary-text">${esc(finding.summary ?? "")}</span></summary>
<table class="kv">
<tr><th>Ecosystem</th><td>${esc(finding.ecosystem)}</td></tr>
<tr><th>Installed</th><td>${esc(finding.installedVersion ?? "unknown (range only)")}</td></tr>
<tr><th>Fixed in</th><td>${finding.fixedIn ? `<b>${esc(finding.fixedIn)}</b>` : finding.noFix ? "No fixed version published" : "Unknown"}${finding.fixedVersions.length > 1 ? ` <span class="muted">(fixes: ${esc(finding.fixedVersions.join(", "))})</span>` : ""}</td></tr>
<tr><th>Affected</th><td>${esc(finding.affectedRanges.join("; ") || "—")}</td></tr>
<tr><th>Severity</th><td>${LABEL[finding.severity]}${finding.cvssScore !== undefined ? ` · CVSS ${finding.cvssScore.toFixed(1)}` : ""}${finding.severitySource ? ` <span class="muted">(${esc(finding.severitySource)})</span>` : ""}${finding.cvssVector ? `<br><code>${esc(finding.cvssVector)}</code>` : ""}${finding.cvssV4Vector ? `<br><code>${esc(finding.cvssV4Vector)}</code>` : ""}</td></tr>
<tr><th>Published</th><td>${date(finding.published)} <span class="muted">· modified ${date(finding.modified)}</span></td></tr>
${finding.cwes.length ? `<tr><th>CWE</th><td>${esc(finding.cwes.join(", "))}</td></tr>` : ""}
${finding.confidenceNote ? `<tr><th>Confidence</th><td>${esc(finding.confidenceNote)}</td></tr>` : ""}
${finding.informational ? `<tr><th>Type</th><td>Informational: ${esc(finding.informational)}</td></tr>` : ""}
</table>
${finding.details ? `<div class="details">${esc(finding.details)}</div>` : ""}
${locations ? `<h4>Found in</h4><ul>${locations}</ul>` : ""}
${refs ? `<h4>References</h4><ul class="refs">${refs}</ul>` : ""}
</details>`;
}

function remediationBlock(r: Remediation): string {
  const check = r.targetCheck?.status === "clean" ? `<span class="ok">verified: no known OSV advisories at ${esc(r.targetVersion)}</span>`
    : r.targetCheck?.status === "vulnerable" ? `<span class="warn">${esc(r.targetVersion)} is still affected by ${esc(r.targetCheck.remaining.join(", "))}</span>`
      : r.targetVersion ? `<span class="muted">not verified</span>` : "";
  return `<li><b>${esc(r.packageName)}</b> <code>${esc(r.installedVersion ?? "range")}</code> → ${r.targetVersion ? `<code>${esc(r.targetVersion)}</code>` : "<i>no fixed version</i>"} ${check}
${r.commands.length ? `<ul>${r.commands.map(c => `<li><code>${esc(c.cwd || ".")}$ ${esc(c.command)}</code></li>`).join("")}</ul>` : ""}
${r.guidance.length ? `<ul class="muted">${r.guidance.map(g => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}</li>`;
}

export function reportHtml(result: ScanResult): string {
  const s = result.summary;
  const packages = new Map(result.packages.map(p => [p.key, p]));
  const bySeverity = SEVERITY_ORDER.map(level => ({ level, items: result.findings.filter(f => f.severity === level) })).filter(g => g.items.length);
  const unanalyzed = result.packages.filter(p => p.status === "unanalyzed");
  const title = `OSV vulnerability report · ${result.workspace.name}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; --bg:#fff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --panel:#f6f8fa;
  --critical:#8b1a1a; --high:#cf222e; --medium:#9a6700; --low:#0969da; --unknown:#59636e; --ok:#1a7f37; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --line:#30363d; --panel:#161b22;
  --critical:#ff7b72; --high:#f85149; --medium:#d29922; --low:#58a6ff; --unknown:#9198a1; --ok:#3fb950; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 28px 20px 60px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 28px 0 10px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
h4 { margin: 12px 0 4px; font-size: 13px; }
.muted { color: var(--muted); } code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
a { color: var(--low); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 16px 0; }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--panel); border-top: 3px solid var(--unknown); }
.card b { display: block; font-size: 22px; } .card span { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.card.critical { border-top-color: var(--critical); } .card.high { border-top-color: var(--high); } .card.medium { border-top-color: var(--medium); } .card.low { border-top-color: var(--low); }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 18px; font-size: 13px; }
.finding { border: 1px solid var(--line); border-left: 4px solid var(--unknown); border-radius: 6px; margin: 8px 0; padding: 0 12px; background: var(--bg); }
.finding.sev-critical { border-left-color: var(--critical); } .finding.sev-high { border-left-color: var(--high); } .finding.sev-medium { border-left-color: var(--medium); } .finding.sev-low { border-left-color: var(--low); }
.finding summary { cursor: pointer; padding: 10px 0; }
.summary-text { display: block; color: var(--muted); margin-top: 2px; }
.pill { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 1px 7px; border-radius: 4px; margin-right: 6px; border: 1px solid currentColor; }
.pill.critical { color: var(--critical); } .pill.high { color: var(--high); } .pill.medium { color: var(--medium); } .pill.low { color: var(--low); } .pill.unknown, .pill.potential { color: var(--muted); }
table.kv { border-collapse: collapse; font-size: 13px; margin: 4px 0 8px; } table.kv th { text-align: left; color: var(--muted); font-weight: 600; padding: 3px 14px 3px 0; vertical-align: top; white-space: nowrap; } table.kv td { padding: 3px 0; }
.details { white-space: pre-wrap; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px; font-size: 13px; max-height: 420px; overflow: auto; }
table.list { border-collapse: collapse; width: 100%; font-size: 13px; } table.list th, table.list td { border-bottom: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
.ok { color: var(--ok); } .warn { color: var(--medium); }
ul { padding-left: 20px; } li { margin: 3px 0; }
@media print { details { break-inside: avoid; } details:not([open]) > *:not(summary) { display: block; } }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<div class="muted">Generated by ${esc(result.tool)} ${esc(result.toolVersion)} from <a href="https://osv.dev">OSV.dev</a> data.</div>
<h2>Scan</h2>
<div class="meta">
<div><b>Scanned:</b> ${esc(result.finishedAt.replace("T", " ").slice(0, 19))} UTC</div>
<div><b>Duration:</b> ${(result.durationMs / 1000).toFixed(1)} s</div>
<div><b>Source:</b> ${result.source === "workspace" ? `workspace ${esc(result.workspace.name)}` : "selected files"}</div>
<div><b>Ecosystems:</b> ${esc(s.ecosystems.join(", ") || "—")}</div>
<div><b>Dependency files:</b> ${s.files}</div>
<div><b>Status:</b> ${result.status === "complete" ? `<span class="ok">complete: every dependency in scope was resolved and checked</span>` : result.status === "cancelled" ? `<span class="warn">cancelled: results are incomplete</span>` : `<span class="warn">incomplete: some dependencies were not checked (see below)</span>`}</div>
<div><b>Dependencies:</b> ${s.packages} discovered, ${s.analyzedPackages} analysed, ${s.unresolvedPackages} unresolved, ${s.failedPackages} failed, ${s.outOfScopePackages} outside OSV's coverage</div>
<div><b>Results:</b> ${s.vulnerablePackages} vulnerable, ${s.potentialPackages} potentially affected, ${s.cleanPackages} with no known advisories; ${s.uniqueVulnerabilities} unique vulnerabilities</div>
</div>
<div class="cards">
${SEVERITY_ORDER.map(level => `<div class="card ${level}"><b>${s[level]}</b><span>${LABEL[level]}</span></div>`).join("")}
<div class="card"><b>${s.confirmedFindings}</b><span>Confirmed</span></div>
<div class="card"><b>${s.potentialFindings}</b><span>Potential</span></div>
</div>
${result.errors.length ? `<h2>Errors</h2><ul>${result.errors.map(e => `<li class="warn">${esc(e)}</li>`).join("")}</ul>` : ""}
<h2>Limitations</h2>
<ul>${result.limitations.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
<h2>Findings (${result.findings.length})</h2>
${result.findings.length ? bySeverity.map(g => `<h3>${LABEL[g.level]} (${g.items.length})</h3>${g.items.map(f => findingBlock(f, packages.get(f.packageKey))).join("\n")}`).join("\n") : `<p class="ok">No known vulnerabilities were found in the analysed packages.</p>`}
${result.remediations.length ? `<h2>Recommended upgrades</h2><ul>${result.remediations.map(remediationBlock).join("\n")}</ul>` : ""}
${unanalyzed.length ? `<h2>Not analysed (${unanalyzed.length})</h2><table class="list"><tr><th>Package</th><th>Ecosystem</th><th>Reason</th><th>Found in</th></tr>${unanalyzed.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.ecosystem)}</td><td>${esc([p.skipReason === "unresolved" ? "Version unknown." : p.skipReason === "failed" ? "OSV query failed." : p.skipReason === "source" ? "Outside OSV's coverage." : "", p.note ?? ""].filter(Boolean).join(" "))}</td><td><code>${esc(p.occurrences[0]?.file ?? "")}</code></td></tr>`).join("")}</table>` : ""}
<h2>Dependency files (${result.files.length})</h2>
<table class="list"><tr><th>File</th><th>Ecosystem</th><th>Type</th><th>Packages</th><th>Notes</th></tr>
${result.files.map(f => `<tr><td><code>${esc(f.path)}</code></td><td>${esc(f.ecosystem)}</td><td>${esc(f.kind)}</td><td>${f.packages}</td><td>${esc([f.resolvedBy ? `Resolved by ${f.resolvedBy}.` : "", f.error, ...f.warnings.slice(0, 10)].filter(Boolean).join(" "))}</td></tr>`).join("")}
</table>
<details><summary><h2 style="display:inline">All packages (${result.packages.length})</h2></summary>
<table class="list"><tr><th>Package</th><th>Version</th><th>Ecosystem</th><th>Status</th><th>Advisories</th></tr>
${result.packages.map(p => `<tr><td>${esc(p.name)}</td><td><code>${esc(p.version ?? (p.specs.join(" / ") || "unknown"))}</code></td><td>${esc(p.ecosystem)}</td><td>${esc(p.status)}</td><td>${esc(p.findingIds.join(", "))}</td></tr>`).join("")}
</table></details>
</main>
</body>
</html>`;
}
