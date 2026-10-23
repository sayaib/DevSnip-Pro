/* DevSnip Pro - SCA Scanner view model.
 *
 * Pure functions over the host's ScaResult: filtering, sorting and grouping
 * for the page, with no DOM access, so they run in the webview and in unit
 * tests alike (UMD: window.ScaModel or module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ScaModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SEVERITIES = ["critical", "high", "medium", "low", "unknown"];
  var DEFAULT_FILTERS = { sev: [], eco: "all", relation: "all", cls: "all", kev: false, dev: "all", q: "", project: "all" };
  var DEFAULT_HEALTH_FILTERS = { kind: "all", eco: "all", relation: "all", q: "" };

  function lower(value) { return String(value === undefined || value === null ? "" : value).toLowerCase(); }

  /** Free-text match on package, version, advisory ids (id, CVE, GHSA, aliases) and summary. */
  function matchesQuery(v, q) {
    q = lower(q).trim();
    if (!q) return true;
    var f = v.finding || {};
    var hay = [f.packageName, f.installedVersion, f.id, f.summary, f.ecosystem].concat(f.aliases || [], v.cves || [], v.ghsas || []).map(lower).join("\n");
    return q.split(/\s+/).every(function (term) { return hay.indexOf(term) !== -1; });
  }

  function filterVulnerabilities(list, filters) {
    var o = Object.assign({}, DEFAULT_FILTERS, filters || {});
    return (list || []).filter(function (v) {
      if (o.sev.length && o.sev.indexOf(v.severity) === -1) return false;
      if (o.eco !== "all" && v.finding.ecosystem !== o.eco) return false;
      if (o.relation !== "all" && v.relation !== o.relation) return false;
      if (o.cls !== "all" && v.class !== o.cls) return false;
      if (o.kev && !v.kev) return false;
      if (o.dev === "production" && v.devOnly) return false;
      if (o.dev === "development" && !v.devOnly) return false;
      if (o.project !== "all" && (v.projects || []).indexOf(o.project) === -1) return false;
      return matchesQuery(v, o.q);
    });
  }

  function sevRank(s) { var i = SEVERITIES.indexOf(s); return i === -1 ? SEVERITIES.length : i; }
  function cmpText(a, b) { return lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0; }

  var SORTS = {
    severity: function (a, b) { return (a.kev ? 0 : 1) - (b.kev ? 0 : 1) || sevRank(a.severity) - sevRank(b.severity) || score(b) - score(a) || cmpText(a.finding.packageName, b.finding.packageName); },
    cvss: function (a, b) { return score(b) - score(a) || sevRank(a.severity) - sevRank(b.severity) || cmpText(a.finding.packageName, b.finding.packageName); },
    package: function (a, b) { return cmpText(a.finding.packageName, b.finding.packageName) || sevRank(a.severity) - sevRank(b.severity) || cmpText(a.finding.id, b.finding.id); },
    published: function (a, b) { return cmpText(b.finding.published || "", a.finding.published || "") || sevRank(a.severity) - sevRank(b.severity); },
    ecosystem: function (a, b) { return cmpText(a.finding.ecosystem, b.finding.ecosystem) || sevRank(a.severity) - sevRank(b.severity) || cmpText(a.finding.packageName, b.finding.packageName); }
  };
  function score(v) { return typeof v.cvssScore === "number" ? v.cvssScore : -1; }

  function sortVulnerabilities(list, sort) {
    var fn = SORTS[sort] || SORTS.severity;
    return (list || []).slice().sort(fn);
  }

  /** Groups for the list: by severity, package or ecosystem. Order follows the sorted input. */
  function groupVulnerabilities(list, by) {
    var groups = [];
    var at = {};
    (list || []).forEach(function (v) {
      var key = by === "package" ? v.finding.packageKey : by === "ecosystem" ? v.finding.ecosystem : by === "none" ? "all" : v.severity;
      var label = by === "package" ? v.finding.packageName + (v.finding.installedVersion ? " " + v.finding.installedVersion : "") : by === "ecosystem" ? v.finding.ecosystem : by === "none" ? "" : v.severity;
      if (!(key in at)) { at[key] = groups.length; groups.push({ key: key, label: label, items: [] }); }
      groups[at[key]].items.push(v);
    });
    if (by === "severity" || !by) groups.sort(function (a, b) { return sevRank(a.key) - sevRank(b.key); });
    return groups;
  }

  function filterHealth(list, filters) {
    var o = Object.assign({}, DEFAULT_HEALTH_FILTERS, filters || {});
    var q = lower(o.q).trim();
    return (list || []).filter(function (h) {
      if (o.kind === "risks" && h.class !== "risk") return false;
      if (o.kind !== "all" && o.kind !== "risks" && h.kind !== o.kind) return false;
      if (o.eco !== "all" && h.ecosystem !== o.eco) return false;
      if (o.relation !== "all" && h.relation !== o.relation) return false;
      if (q && (lower(h.packageName) + " " + lower(h.message)).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return (a.class === "risk" ? 0 : 1) - (b.class === "risk" ? 0 : 1) || ["major", "minor", "patch"].indexOf(a.level) - ["major", "minor", "patch"].indexOf(b.level) || cmpText(a.packageName, b.packageName);
    });
  }

  /** Severity counts of a list (informational advisories counted apart). */
  function countBySeverity(list) {
    var counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, informational: 0, exploited: 0 };
    (list || []).forEach(function (v) {
      if (v.class === "informational") counts.informational++;
      else counts[v.severity]++;
      if (v.kev) counts.exploited++;
    });
    return counts;
  }

  /** Distinct ecosystems and projects present in a result, for the filter menus. */
  function facets(result) {
    var ecos = {};
    var projects = {};
    if (result) {
      (result.vulnerabilities || []).forEach(function (v) { ecos[v.finding.ecosystem] = true; (v.projects || []).forEach(function (p) { projects[p] = true; }); });
      (result.health || []).forEach(function (h) { ecos[h.ecosystem] = true; });
      ((result.scan && result.scan.packages) || []).forEach(function (p) { ecos[p.ecosystem] = true; });
    }
    return { ecosystems: Object.keys(ecos).sort(), projects: Object.keys(projects).sort() };
  }

  /** Dependencies table rows: filtered by text, status, relation and ecosystem; vulnerable first. */
  function filterPackages(packages, filters) {
    var o = Object.assign({ q: "", status: "all", relation: "all", eco: "all" }, filters || {});
    var q = lower(o.q).trim();
    var rank = { vulnerable: 0, potential: 1, unanalyzed: 2, clean: 3 };
    return (packages || []).filter(function (p) {
      if (o.status !== "all" && p.status !== o.status) return false;
      var relation = p.direct === true ? "direct" : p.direct === false ? "transitive" : "unknown";
      if (o.relation !== "all" && relation !== o.relation) return false;
      if (o.eco !== "all" && p.ecosystem !== o.eco) return false;
      if (q && (lower(p.name) + " " + lower(p.version)).indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) { return (rank[a.status] - rank[b.status]) || cmpText(a.name, b.name); });
  }

  /** "a > b > c" with the vulnerable package last, for a dependency path. */
  function pathLabel(path, name) {
    return (path || []).concat(name ? [name] : []).join(" > ");
  }

  return {
    SEVERITIES: SEVERITIES,
    DEFAULT_FILTERS: DEFAULT_FILTERS,
    DEFAULT_HEALTH_FILTERS: DEFAULT_HEALTH_FILTERS,
    matchesQuery: matchesQuery,
    filterVulnerabilities: filterVulnerabilities,
    sortVulnerabilities: sortVulnerabilities,
    groupVulnerabilities: groupVulnerabilities,
    filterHealth: filterHealth,
    filterPackages: filterPackages,
    countBySeverity: countBySeverity,
    facets: facets,
    pathLabel: pathLabel
  };
});
