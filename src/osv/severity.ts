import type { Severity } from "./types";

/**
 * Severity of an OSV advisory, taken only from what the advisory provides.
 *
 * Order of preference:
 *  1. the GitHub Advisory Database's reviewed severity (database_specific.severity on GHSA records);
 *  2. another database's own severity label;
 *  3. a CVSS v3.x base score computed from the advisory's vector (FIRST CVSS 3.1 specification, section 7);
 *  4. a CVSS v2 base score computed from its vector;
 *  5. an ecosystem-specific label (e.g. Ubuntu priority).
 * Otherwise the severity is "unknown". CVSS v4 vectors are shown to the user
 * but not scored: a v4 score needs the specification's full lookup table,
 * and an approximated number would look more precise than it is.
 */

// ---------------------------------------------------------------------------
// CVSS v3.0 / v3.1
// ---------------------------------------------------------------------------

const V3 = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 }
} as const;

/** CVSS 3.1 "Roundup": the smallest one-decimal number >= the input, robust to float error. */
export function roundUp(value: number): number {
  const integer = Math.round(value * 100000);
  return integer % 10000 === 0 ? integer / 100000 : (Math.floor(integer / 10000) + 1) / 10;
}

export function parseVector(vector: string): Record<string, string> {
  const metrics: Record<string, string> = {};
  for (const part of vector.trim().split("/")) {
    const [key, value] = part.split(":");
    if (key && value !== undefined) metrics[key] = value;
  }
  return metrics;
}

/** Base score of a CVSS v3.x vector, or undefined when the vector is incomplete or invalid. */
export function cvss3BaseScore(vector: string): number | undefined {
  if (!/^CVSS:3\.[01]\//.test(vector.trim())) return undefined;
  const m = parseVector(vector);
  const av = V3.AV[m.AV as keyof typeof V3.AV];
  const ac = V3.AC[m.AC as keyof typeof V3.AC];
  const ui = V3.UI[m.UI as keyof typeof V3.UI];
  const scope = m.S;
  const c = V3.CIA[m.C as keyof typeof V3.CIA];
  const i = V3.CIA[m.I as keyof typeof V3.CIA];
  const a = V3.CIA[m.A as keyof typeof V3.CIA];
  if ([av, ac, ui, c, i, a].some(v => v === undefined) || (scope !== "U" && scope !== "C")) return undefined;
  const changed = scope === "C";
  const pr = m.PR === "N" ? 0.85 : m.PR === "L" ? (changed ? 0.68 : 0.62) : m.PR === "H" ? (changed ? 0.5 : 0.27) : undefined;
  if (pr === undefined) return undefined;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  return changed ? roundUp(Math.min(1.08 * (impact + exploitability), 10)) : roundUp(Math.min(impact + exploitability, 10));
}

// ---------------------------------------------------------------------------
// CVSS v2
// ---------------------------------------------------------------------------

const V2 = {
  AV: { L: 0.395, A: 0.646, N: 1.0 },
  AC: { H: 0.35, M: 0.61, L: 0.71 },
  Au: { M: 0.45, S: 0.56, N: 0.704 },
  CIA: { N: 0, P: 0.275, C: 0.66 }
} as const;

/** Base score of a CVSS v2 vector (`AV:N/AC:L/Au:N/C:P/I:P/A:P`), or undefined. */
export function cvss2BaseScore(vector: string): number | undefined {
  const m = parseVector(vector.replace(/^\(|\)$/g, "").replace(/^CVSS:2\.0\//, ""));
  const av = V2.AV[m.AV as keyof typeof V2.AV];
  const ac = V2.AC[m.AC as keyof typeof V2.AC];
  const au = V2.Au[m.Au as keyof typeof V2.Au];
  const c = V2.CIA[m.C as keyof typeof V2.CIA];
  const i = V2.CIA[m.I as keyof typeof V2.CIA];
  const a = V2.CIA[m.A as keyof typeof V2.CIA];
  if ([av, ac, au, c, i, a].some(v => v === undefined)) return undefined;
  const impact = 10.41 * (1 - (1 - c) * (1 - i) * (1 - a));
  const exploitability = 20 * av * ac * au;
  const f = impact === 0 ? 0 : 1.176;
  return Math.round(((0.6 * impact) + (0.4 * exploitability) - 1.5) * f * 10) / 10;
}

/** CVSS v3 qualitative rating. A score of 0.0 is "None", which has no bucket here, so it maps to low. */
export function ratingV3(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

/** NVD's CVSS v2 rating (v2 has no "critical"). */
export function ratingV2(score: number): Severity {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

/** A database's own label: GHSA's MODERATE is medium; Ubuntu's "negligible" and "untriaged" are not ratings. */
export function labelSeverity(label: unknown): Severity | undefined {
  if (typeof label !== "string") return undefined;
  switch (label.trim().toLowerCase()) {
    case "critical": return "critical";
    case "high": case "important": return "high";
    case "moderate": case "medium": return "medium";
    case "low": case "minor": return "low";
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Resolving one advisory group
// ---------------------------------------------------------------------------

/** The parts of an OSV record severity looks at. */
export interface SeverityInput {
  id: string;
  severity?: Array<{ type?: string; score?: string; source?: string }>;
  database_specific?: Record<string, unknown>;
  affected?: Array<{ ecosystem_specific?: Record<string, unknown>; database_specific?: Record<string, unknown> }>;
}

export interface SeverityResult {
  severity: Severity;
  source?: string;
  cvssScore?: number;
  cvssVector?: string;
  cvssV4Vector?: string;
}

/**
 * The severity of a vulnerability described by one or more aliased records
 * (for example GHSA-..., PYSEC-... and GO-... for the same issue).
 */
export function resolveSeverity(records: SeverityInput[], affectedFor: (record: SeverityInput) => Array<{ ecosystem_specific?: Record<string, unknown>; database_specific?: Record<string, unknown> }> = r => r.affected ?? []): SeverityResult {
  let bestV3: { score: number; vector: string; source: string } | undefined;
  let bestV2: { score: number; vector: string; source: string } | undefined;
  let v4: string | undefined;
  for (const record of records) {
    for (const entry of record.severity ?? []) {
      const vector = String(entry.score ?? "");
      const origin = entry.source ? ` (${entry.source})` : ` (${record.id})`;
      if (entry.type === "CVSS_V3") {
        const score = cvss3BaseScore(vector);
        if (score !== undefined && (!bestV3 || score > bestV3.score)) bestV3 = { score, vector, source: `CVSS ${vector.slice(5, 8)} vector${origin}` };
      } else if (entry.type === "CVSS_V2") {
        const score = cvss2BaseScore(vector);
        if (score !== undefined && (!bestV2 || score > bestV2.score)) bestV2 = { score, vector, source: `CVSS 2.0 vector${origin}` };
      } else if (entry.type === "CVSS_V4" && !v4) {
        v4 = vector;
      }
    }
  }
  const cvss = bestV3 ?? bestV2;
  const extras = { ...(cvss ? { cvssScore: cvss.score, cvssVector: cvss.vector } : {}), ...(v4 ? { cvssV4Vector: v4 } : {}) };

  const ghsa = records.find(r => r.id.startsWith("GHSA-") && labelSeverity(r.database_specific?.severity));
  if (ghsa) return { severity: labelSeverity(ghsa.database_specific!.severity)!, source: `GitHub Advisory Database (${ghsa.id})`, ...extras };
  const labelled = records.find(r => labelSeverity(r.database_specific?.severity));
  if (labelled) return { severity: labelSeverity(labelled.database_specific!.severity)!, source: `${labelled.id} database severity`, ...extras };
  if (bestV3) return { severity: ratingV3(bestV3.score), source: `${bestV3.source}, base score ${bestV3.score.toFixed(1)}`, ...extras };
  if (bestV2) return { severity: ratingV2(bestV2.score), source: `${bestV2.source}, base score ${bestV2.score.toFixed(1)}`, ...extras };
  for (const record of records) {
    for (const entry of record.severity ?? []) {
      if (entry.type === "Ubuntu" && labelSeverity(entry.score)) return { severity: labelSeverity(entry.score)!, source: `Ubuntu priority (${record.id})`, ...extras };
    }
    for (const affected of affectedFor(record)) {
      const label = labelSeverity(affected.ecosystem_specific?.severity) ?? labelSeverity(affected.database_specific?.severity);
      if (label) return { severity: label, source: `${record.id} ecosystem severity`, ...extras };
    }
  }
  return { severity: "unknown", ...(v4 ? { source: "Only a CVSS v4 vector is published; it is shown but not scored." } : {}), ...extras };
}
