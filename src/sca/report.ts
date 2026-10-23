import type { ScaResult } from "./types";

/**
 * SCA exports. JSON is the full result (the panel's own data, documented in
 * docs/SCA-SCANNER.md). CSV has one row per vulnerability and one per
 * dependency-health finding, for spreadsheets and ticket imports. Cells that
 * a spreadsheet would run as a formula are prefixed with an apostrophe.
 */

export function scaJson(result: ScaResult): string {
  return JSON.stringify(result, null, 2);
}

export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export const CSV_COLUMNS = [
  "Type", "Severity", "Class", "CVSS", "Known exploited", "Package", "Ecosystem", "Installed", "Fixed in", "Latest",
  "Advisory", "CVEs", "GHSAs", "Relation", "Development only", "Projects", "Files", "Dependency path", "Summary", "Link"
];

export function scaCsv(result: ScaResult): string {
  const rows: unknown[][] = [CSV_COLUMNS];
  const latest = new Map(result.health.filter(h => h.latest).map(h => [h.packageKey, h.latest]));
  for (const v of result.vulnerabilities) {
    const f = v.finding;
    rows.push([
      "vulnerability", v.severity, v.class, v.cvssScore !== undefined ? v.cvssScore.toFixed(1) : "", v.kev ? `yes (added ${v.kev.dateAdded})` : "no",
      f.packageName, f.ecosystem, f.installedVersion ?? "", f.fixedIn ?? (f.noFix ? "no fix published" : ""), latest.get(f.packageKey) ?? "",
      f.id, v.cves.join(" "), v.ghsas.join(" "), v.relation, v.devOnly ? "yes" : "no", v.projects.join(" "),
      v.locations.map(l => (l.line ? `${l.file}:${l.line}` : l.file)).join(" "), v.paths[0]?.join(" > ") ?? "", f.summary ?? "", f.osvUrl
    ]);
  }
  for (const h of result.health) {
    rows.push([
      `health:${h.kind}`, h.class === "risk" ? "maintenance risk" : "informational", h.class, "", "",
      h.packageName, h.ecosystem, h.installedVersion, "", h.latest ?? "",
      "", "", "", h.relation, "", "", h.locations.map(l => (l.line ? `${l.file}:${l.line}` : l.file)).join(" "), "", h.message, h.page
    ]);
  }
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
