/* DevSnip Pro - OSV Vulnerability Scanner webview.
 *
 * The host scans; this page shows the result as a security dashboard:
 * severity cards, filterable findings with expandable details, packages,
 * upgrade plans, scanned files and scan notes. Everything is built with DOM
 * nodes and textContent - advisory text is untrusted and never parsed as HTML.
 * Links, file opening, clipboard and commands go through the host.
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();
  var app = document.getElementById("app");
  var SEVERITIES = ["critical", "high", "medium", "low", "unknown"];
  var SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", unknown: "Unknown" };
  var STATUS_LABEL = { vulnerable: "Vulnerable", potential: "Potentially affected", clean: "No known issues", unanalyzed: "Not analysed" };
  var SKIP_LABEL = { unresolved: "version unknown", source: "outside OSV's coverage", failed: "OSV query failed", cancelled: "scan cancelled" };
  var STATUS_ICON = { vulnerable: "error", potential: "warning", clean: "pass", unanalyzed: "circle-slash" };
  // Every result is rendered: lists are filled in chunks so even thousands of rows never freeze the page.
  var CHUNK = 150;
  var renderJobs = {};
  function inChunks(key, items, each) {
    var job = (renderJobs[key] = {});
    var i = 0;
    function step() {
      if (renderJobs[key] !== job) return; // a newer render replaced this one
      var end = Math.min(items.length, i + CHUNK);
      for (; i < end; i++) each(items[i], i);
      if (i < items.length) setTimeout(step, 0);
    }
    step();
  }

  var saved = vscode.getState() || {};
  var ui = {
    tab: saved.tab || "findings",
    sev: Array.isArray(saved.sev) ? saved.sev : [],
    eco: saved.eco || "all",
    confidence: saved.confidence || "all",
    scope: saved.scope || "all",
    sort: saved.sort || "severity",
    group: saved.group || "severity",
    q: saved.q || "",
    pkgStatus: saved.pkgStatus || "all",
    pkgQ: saved.pkgQ || "",
    pkgEco: saved.pkgEco || "all"
  };
  var openKeys = {};
  var model = { workspace: { name: "", hasWorkspace: false }, ecosystems: [], files: [], result: null, running: null, progress: null, error: null, cancelled: false };
  var index = { packages: {}, remediations: {} };

  function persist() {
    vscode.setState({ tab: ui.tab, sev: ui.sev, eco: ui.eco, confidence: ui.confidence, scope: ui.scope, sort: ui.sort, group: ui.group, q: ui.q, pkgStatus: ui.pkgStatus, pkgQ: ui.pkgQ, pkgEco: ui.pkgEco });
  }

  // ------------------------------------------------------------------ DOM helpers
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var value = attrs[key];
        if (value === undefined || value === null || value === false) continue;
        if (key === "class") el.className = value;
        // The page's CSP blocks style attributes; the CSSOM is allowed.
        else if (key === "style") String(value).split(";").forEach(function (rule) { var at = rule.indexOf(":"); if (at > 0) el.style.setProperty(rule.slice(0, at).trim(), rule.slice(at + 1).trim()); });
        else if (key === "text") el.textContent = value;
        else if (key.slice(0, 2) === "on" && typeof value === "function") el.addEventListener(key.slice(2), value);
        else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, String(value));
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(parent, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  function icon(name, extra) { return h("span", { class: "codicon codicon-" + name + (extra ? " " + extra : ""), "aria-hidden": "true" }); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function button(label, opts) {
    opts = opts || {};
    return h("button", { type: "button", class: "btn" + (opts.kind ? " " + opts.kind : ""), title: opts.title, disabled: opts.disabled, "aria-label": opts.aria, onclick: opts.onclick, id: opts.id },
      opts.icon ? icon(opts.icon) : null, label);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function post(message) { vscode.postMessage(message); }
  function external(url, text) {
    return h("a", { href: url, title: url, onclick: function (e) { e.preventDefault(); post({ type: "openExternal", url: url }); } }, text || url);
  }

  var toastRoot = document.getElementById("toasts");
  function toast(message, kind) {
    var t = h("div", { class: "toast" + (kind ? " " + kind : "") }, message);
    toastRoot.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
  }

  function relativeTime(iso) {
    var then = Date.parse(iso);
    if (!isFinite(then)) return "";
    var s = Math.round((Date.now() - then) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return new Date(then).toLocaleString();
  }
  function day(iso) { return iso ? String(iso).slice(0, 10) : "—"; }

  // ------------------------------------------------------------------ indexing
  function buildIndex() {
    index = { packages: {}, remediations: {}, worst: {} };
    if (!model.result) return;
    model.result.packages.forEach(function (p) { index.packages[p.key] = p; });
    model.result.remediations.forEach(function (r) { index.remediations[r.packageKey] = r; });
    model.result.findings.forEach(function (f) {
      var current = index.worst[f.packageKey];
      if (current === undefined || SEVERITIES.indexOf(f.severity) < current) index.worst[f.packageKey] = SEVERITIES.indexOf(f.severity);
    });
  }

  // ------------------------------------------------------------------ frame
  var slots = {};
  function renderAll() {
    clear(app);
    app.removeAttribute("aria-busy");
    slots.header = h("header", { class: "top" });
    slots.status = h("div", { class: "status-area", "aria-live": "polite" });
    slots.content = h("main", { class: "content" });
    append(app, [slots.header, slots.status, slots.content]);
    renderHeader();
    renderStatus();
    renderContent();
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".menu"), function (m) { m.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll("[aria-haspopup]"), function (b) { b.setAttribute("aria-expanded", "false"); });
  }
  function menuButton(label, iconName, items, opts) {
    var menu = h("div", { class: "menu", role: "menu", hidden: true });
    var trigger = h("button", { type: "button", class: "btn ghost", "aria-haspopup": "menu", "aria-expanded": "false", disabled: opts && opts.disabled, title: opts && opts.title,
      onclick: function (e) {
        e.stopPropagation();
        var willOpen = menu.hidden;
        closeMenus();
        menu.hidden = !willOpen;
        trigger.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) { var first = menu.querySelector("button"); if (first) first.focus(); }
      } }, icon(iconName), label, label ? icon("chevron-down") : null);
    items.forEach(function (item) {
      menu.appendChild(h("button", { type: "button", role: "menuitem", onclick: function () { closeMenus(); item.run(); } }, icon(item.icon), item.label));
    });
    menu.addEventListener("keydown", function (e) {
      var buttons = Array.prototype.slice.call(menu.querySelectorAll("button"));
      var at = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); buttons[(at + 1) % buttons.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenus(); trigger.focus(); }
    });
    return h("div", { class: "menu-wrap" }, trigger, menu);
  }

  function renderHeader() {
    clear(slots.header);
    var r = model.result;
    var meta = [];
    if (model.workspace.hasWorkspace) meta.push(model.workspace.name);
    if (r) meta.push("Scanned " + relativeTime(r.finishedAt) + " · " + (r.durationMs / 1000).toFixed(1) + " s" + (r.source === "files" ? " · selected files" : ""));
    var running = !!model.running;
    var primary;
    if (running) primary = button("Cancel", { kind: "ghost", icon: "debug-stop", onclick: function () { post({ type: "cancel" }); }, id: "cancelBtn" });
    else if (model.workspace.hasWorkspace) primary = button(r ? "Scan Again" : "Scan Workspace", { kind: "primary", icon: r ? "refresh" : "play", onclick: function () { post({ type: "scan" }); }, id: "scanBtn" });
    else primary = button("Open Folder…", { kind: "primary", icon: "folder-opened", onclick: function () { post({ type: "openFolder" }); } });
    append(slots.header, [
      h("div", { class: "title" },
        h("h1", null, icon("shield"), "OSV Vulnerability Scanner"),
        h("div", { class: "meta" }, meta.join(" · ") || "Known vulnerabilities in your dependencies, from OSV.dev")),
      h("div", { class: "toolbar" },
        primary,
        button("Scan Files…", { kind: "ghost", icon: "files", disabled: running, title: "Choose lockfiles or manifests to scan", onclick: function () { post({ type: "scanFiles" }); } }),
        menuButton("Export", "export", [
          { label: "HTML report", icon: "file-code", run: function () { post({ type: "export", format: "html" }); } },
          { label: "JSON (machine-readable)", icon: "json", run: function () { post({ type: "export", format: "json" }); } }
        ], { disabled: !r, title: r ? "Export the results" : "Run a scan first" }),
        menuButton("", "ellipsis", [
          { label: "Scan again, ignoring cached answers", icon: "sync", run: function () { if (!model.running && model.workspace.hasWorkspace) post({ type: "scan", fresh: true }); else toast(model.running ? "A scan is already running." : "Open a folder first."); } },
          { label: "Clear cached advisories", icon: "clear-all", run: function () { post({ type: "clearCache" }); } }
        ], { title: "More actions" }))
    ]);
    slots.header.appendChild(h("p", { class: "privacy" }, icon("lock"),
      h("span", null, "Only package names, versions and ecosystems are sent to api.osv.dev. Source code, file contents, paths and credentials never leave VS Code, and nothing is changed without your confirmation.")));
  }

  function renderStatus() {
    clear(slots.status);
    if (model.running) {
      var p = model.progress || { message: "Starting…", fraction: 0 };
      var pct = Math.round((p.fraction || 0) * 100);
      append(slots.status, h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "aria-label": "Scan progress" },
        h("div", { class: "row" },
          h("div", { class: "label" }, icon("loading", "codicon-modifier-spin"), h("span", { id: "progressText" }, p.message)),
          h("span", { class: "note" }, pct + "%")),
        h("div", { class: "bar" }, h("i", { style: "width:" + pct + "%" }))));
      return;
    }
    if (model.error) {
      var actions = [];
      if (model.error.kind === "no-workspace") {
        actions.push(button("Open Folder…", { kind: "primary", icon: "folder-opened", onclick: function () { post({ type: "openFolder" }); } }));
        actions.push(button("Scan Files…", { kind: "ghost", icon: "files", onclick: function () { post({ type: "scanFiles" }); } }));
      } else {
        actions.push(button("Try Again", { kind: "primary", icon: "refresh", onclick: function () { post({ type: "scan" }); } }));
      }
      append(slots.status, banner("error", "error", model.error.kind === "no-workspace" ? "No folder is open" : "The scan could not finish", model.error.message, actions));
      return;
    }
    if (model.cancelled && !model.result) {
      append(slots.status, banner("warn", "warning", "Scan cancelled", "Nothing was changed. Start a new scan when you are ready."));
      return;
    }
    var r = model.result;
    if (!r) return;
    var su = r.summary;
    // Results from before coverage counts existed: derive what is missing instead of showing "undefined".
    if (su.analyzedPackages === undefined) su.analyzedPackages = su.packages - su.unanalyzedPackages;
    if (su.unresolvedPackages === undefined) su.unresolvedPackages = 0;
    if (su.failedPackages === undefined) su.failedPackages = 0;
    if (su.outOfScopePackages === undefined) su.outOfScopePackages = su.unanalyzedPackages;
    if (!r.status) r.status = r.cancelled ? "cancelled" : r.partial ? "incomplete" : "complete";
    var logButton = button("Show Log", { kind: "ghost small", icon: "output", onclick: function () { post({ type: "showLog" }); } });
    if (r.status === "cancelled" || r.cancelled) {
      append(slots.status, banner("warn", "warning", "Scan cancelled: results are incomplete", "Packages that were not checked are listed as Not analysed.", [logButton]));
      return;
    }
    if (su.files === 0) return;
    if (r.status === "incomplete") {
      var gaps = r.incompleteReasons && r.incompleteReasons.length ? r.incompleteReasons.slice() : [];
      if (!gaps.length && su.unresolvedPackages) gaps.push(plural(su.unresolvedPackages, "dependency", "dependencies") + " with a version that could not be determined");
      if (!(r.incompleteReasons && r.incompleteReasons.length) && su.failedPackages) gaps.push(plural(su.failedPackages, "dependency", "dependencies") + " OSV could not be queried for");
      if (!(r.incompleteReasons && r.incompleteReasons.length) && r.diagnostics && r.diagnostics.recordsFailed) gaps.push(plural(r.diagnostics.recordsFailed, "advisory", "advisories") + " whose details could not be loaded");
      if (!(r.incompleteReasons && r.incompleteReasons.length) && r.diagnostics && r.diagnostics.filesFailed) gaps.push(plural(r.diagnostics.filesFailed, "file") + " that could not be read");
      var actions = [
        su.unresolvedPackages || su.failedPackages ? button("Show Unchecked Packages", { kind: "ghost small", icon: "list-flat", onclick: function () { ui.pkgStatus = "unanalyzed"; persist(); renderPackagesPanel(); selectTab("packages"); } }) : null,
        r.diagnostics && r.diagnostics.buildTools && r.diagnostics.buildTools.length ? button("Build Tool Settings", { kind: "ghost small", icon: "settings-gear", onclick: function () { post({ type: "mavenSettings" }); } }) : null,
        button("Scan Again", { kind: "ghost small", icon: "refresh", onclick: function () { post({ type: "scan" }); } }),
        logButton
      ].filter(Boolean);
      var lead = su.findings === 0
        ? "No vulnerabilities were found in the " + plural(su.analyzedPackages, "analysed dependency", "analysed dependencies") + ", but the scan is incomplete, so this is not a clean result. "
        : "";
      append(slots.status, banner("warn", "warning", "Scan incomplete", lead + "Not fully checked: " + gaps.join("; ") + "." + (r.errors.length ? " " + r.errors.join(" ") : ""), actions));
      return;
    }
    if (su.findings === 0) {
      append(slots.status, banner("ok", "pass-filled", "Scan complete: no known vulnerabilities",
        "OSV has no advisories for any of the " + plural(su.analyzedPackages, "analysed dependency", "analysed dependencies") + "." +
        (su.outOfScopePackages ? " " + plural(su.outOfScopePackages, "dependency", "dependencies") + " from git, local paths or private sources " + (su.outOfScopePackages === 1 ? "is" : "are") + " outside what OSV covers." : ""), [logButton]));
      return;
    }
    append(slots.status, banner("ok", "pass", "Scan complete",
      "Every one of the " + plural(su.analyzedPackages, "dependency", "dependencies") + " found was checked against OSV." +
      (su.outOfScopePackages ? " " + plural(su.outOfScopePackages, "dependency", "dependencies") + " from git, local paths or private sources " + (su.outOfScopePackages === 1 ? "is" : "are") + " outside what OSV covers." : ""), [logButton]));
  }

  function banner(kind, iconName, title, text, actions) {
    return h("div", { class: "banner " + kind, role: kind === "error" ? "alert" : "status" }, icon(iconName),
      h("div", { class: "body" }, h("b", null, title), text ? h("div", null, text) : null, actions && actions.length ? h("div", { class: "actions" }, actions) : null));
  }

  // ------------------------------------------------------------------ content
  function renderContent() {
    clear(slots.content);
    var r = model.result;
    if (!r) { renderEmpty(); return; }
    if (r.summary.files === 0) {
      append(slots.content, h("div", { class: "empty" }, icon("search", "big"),
        h("h2", null, r.source === "files" ? "None of the selected files can be scanned" : "No dependency files found"),
        h("p", null, r.source === "files" ? "Choose lockfiles or manifests from the list below." : "This workspace has no lockfile or manifest the scanner understands outside installed-package and build folders."),
        supportedList(),
        h("div", { class: "actions", style: "margin-top:16px" }, button("Scan Files…", { kind: "ghost", icon: "files", onclick: function () { post({ type: "scanFiles" }); } }))));
      return;
    }
    append(slots.content, summaryCards(r));
    var tabs = [
      { id: "findings", label: "Findings", count: r.findings.length },
      { id: "packages", label: "Packages", count: r.packages.length },
      { id: "fixes", label: "Fixes", count: r.remediations.length },
      { id: "files", label: "Files", count: r.files.length },
      { id: "notes", label: "Scan notes", count: r.limitations.length + r.errors.length }
    ];
    var tablist = h("div", { class: "tabs", role: "tablist", "aria-label": "Scan results" });
    var panels = {};
    tabs.forEach(function (t) {
      var selected = ui.tab === t.id;
      var tab = h("button", { type: "button", class: "tab", role: "tab", id: "tab-" + t.id, "aria-selected": String(selected), "aria-controls": "panel-" + t.id, tabindex: selected ? "0" : "-1",
        onclick: function () { selectTab(t.id); } }, t.label, h("span", { class: "count" }, fmt(t.count)));
      tablist.appendChild(tab);
      panels[t.id] = h("section", { class: "panel", role: "tabpanel", id: "panel-" + t.id, "aria-labelledby": "tab-" + t.id, hidden: !selected });
    });
    tablist.addEventListener("keydown", function (e) {
      var ids = tabs.map(function (t) { return t.id; });
      var at = ids.indexOf(ui.tab);
      var next = e.key === "ArrowRight" ? ids[(at + 1) % ids.length] : e.key === "ArrowLeft" ? ids[(at - 1 + ids.length) % ids.length] : e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : null;
      if (!next) return;
      e.preventDefault();
      selectTab(next);
      document.getElementById("tab-" + next).focus();
    });
    append(slots.content, tablist);
    tabs.forEach(function (t) { slots.content.appendChild(panels[t.id]); });
    slots.panels = panels;
    renderFindingsPanel();
    renderPackagesPanel();
    renderFixesPanel();
    renderFilesPanel();
    renderNotesPanel();
  }

  function selectTab(id) {
    ui.tab = id;
    persist();
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      var on = t.id === "tab-" + id;
      t.setAttribute("aria-selected", String(on));
      t.setAttribute("tabindex", on ? "0" : "-1");
    });
    for (var key in slots.panels) slots.panels[key].hidden = key !== id;
  }

  function supportedList() {
    return h("div", { class: "eco-list", "aria-label": "Supported files" }, (model.files || []).map(function (group) {
      return h("span", { title: group.files.join(", ") }, group.ecosystem + ": " + group.files.slice(0, 3).join(", ") + (group.files.length > 3 ? ", …" : ""));
    }));
  }

  function renderEmpty() {
    if (model.running) {
      append(slots.content, h("div", { class: "empty" }, icon("loading", "big codicon-modifier-spin"), h("h2", null, "Scanning " + (model.running.label || "") + "…"),
        h("p", null, "Reading lockfiles and manifests, then asking OSV.dev about each package. Large workspaces can take a minute.")));
      return;
    }
    if (!model.workspace.hasWorkspace) {
      append(slots.content, h("div", { class: "empty" }, icon("folder", "big"), h("h2", null, "Open a folder to scan its dependencies"),
        h("p", null, "The scanner reads lockfiles and manifests in the open workspace. Without one, you can still choose dependency files to scan."),
        h("div", { class: "actions" },
          button("Open Folder…", { kind: "primary", icon: "folder-opened", onclick: function () { post({ type: "openFolder" }); } }),
          button("Scan Files…", { kind: "ghost", icon: "files", onclick: function () { post({ type: "scanFiles" }); } })),
        supportedList()));
      return;
    }
    append(slots.content, h("div", { class: "empty" }, icon("shield", "big"), h("h2", null, "Check your dependencies for known vulnerabilities"),
      h("p", null, "Finds every lockfile and manifest in " + model.workspace.name + ", including nested projects and transitive dependencies from lockfiles, and checks each package version against the OSV.dev database (GitHub, PyPA, Go, RustSec and more)."),
      h("div", { class: "actions" },
        button("Scan Workspace", { kind: "primary", icon: "play", onclick: function () { post({ type: "scan" }); }, id: "emptyScanBtn" }),
        button("Scan Files…", { kind: "ghost", icon: "files", onclick: function () { post({ type: "scanFiles" }); } })),
      supportedList()));
  }

  function summaryCards(r) {
    var s = r.summary;
    var wrap = h("div", null);
    var cards = h("div", { class: "cards", role: "group", "aria-label": "Findings by severity" });
    SEVERITIES.forEach(function (level) {
      var pressed = ui.sev.length === 1 && ui.sev[0] === level;
      cards.appendChild(h("button", { type: "button", class: "card " + level + (s[level] ? "" : " zero"), "aria-pressed": String(pressed),
        title: pressed ? "Show all severities" : "Show only " + SEV_LABEL[level] + " findings",
        onclick: function () { ui.sev = pressed ? [] : [level]; persist(); renderContent(); selectTab("findings"); } },
        h("b", null, fmt(s[level])), h("span", null, SEV_LABEL[level])));
    });
    wrap.appendChild(cards);
    function stat(label, value, onclick) {
      return h("span", { class: onclick ? "clickable" : "", onclick: onclick, role: onclick ? "button" : null, tabindex: onclick ? "0" : null,
        onkeydown: onclick ? function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onclick(); } } : null }, h("b", null, fmt(value)), " " + label);
    }
    function showPackages(status) { return function () { ui.pkgStatus = status; persist(); renderPackagesPanel(); selectTab("packages"); }; }
    wrap.appendChild(h("div", { class: "stats", "aria-label": "Coverage" },
      stat("dependencies discovered", s.packages, showPackages("all")),
      stat("analysed", s.analyzedPackages !== undefined ? s.analyzedPackages : s.packages - s.unanalyzedPackages, null),
      s.unresolvedPackages ? stat("unresolved", s.unresolvedPackages, showPackages("unanalyzed")) : null,
      s.failedPackages ? stat("failed", s.failedPackages, showPackages("unanalyzed")) : null,
      s.outOfScopePackages ? stat("out of scope", s.outOfScopePackages, showPackages("unanalyzed")) : null,
      stat("vulnerable", s.vulnerablePackages, showPackages("vulnerable")),
      s.potentialPackages ? stat("potentially affected", s.potentialPackages, showPackages("potential")) : null,
      stat("unique vulnerabilities", s.uniqueVulnerabilities !== undefined ? s.uniqueVulnerabilities : s.findings, function () { selectTab("findings"); }),
      stat("dependency files", s.files, function () { selectTab("files"); }),
      h("span", null, s.ecosystems.join(", "))));
    return wrap;
  }

  // ------------------------------------------------------------------ findings
  function findingText(f) {
    return [f.id, f.aliases.join(" "), f.packageName, f.installedVersion || "", f.summary || "", f.ecosystem, (f.cwes || []).join(" ")].join(" ").toLowerCase();
  }
  var SORTS = {
    severity: function (a, b) { return 0; },
    package: function (a, b) { return a.packageName.localeCompare(b.packageName) || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id); },
    id: function (a, b) { return a.id.localeCompare(b.id); },
    published: function (a, b) { return String(b.published || "").localeCompare(String(a.published || "")) || a.id.localeCompare(b.id); },
    cvss: function (a, b) { return (b.cvssScore === undefined ? -1 : b.cvssScore) - (a.cvssScore === undefined ? -1 : a.cvssScore) || SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity); }
  };
  function filteredFindings() {
    var q = ui.q.trim().toLowerCase();
    var list = model.result.findings.filter(function (f) {
      if (ui.sev.length && ui.sev.indexOf(f.severity) < 0) return false;
      if (ui.eco !== "all" && f.ecosystem !== ui.eco) return false;
      if (ui.confidence !== "all" && f.confidence !== ui.confidence) return false;
      if (ui.scope === "dev" && !f.devOnly) return false;
      if (ui.scope === "prod" && f.devOnly) return false;
      if (q && findingText(f).indexOf(q) < 0) return false;
      return true;
    });
    // The host already sends findings in severity order; other orders are applied here.
    if (ui.sort !== "severity") list = list.slice().sort(SORTS[ui.sort] || SORTS.severity);
    return list;
  }

  function select(label, value, options, onchange) {
    var el = h("select", { class: "control", "aria-label": label, title: label, onchange: function () { onchange(el.value); } });
    options.forEach(function (o) { el.appendChild(h("option", { value: o[0], selected: o[0] === value }, o[1])); });
    return el;
  }
  function searchBox(value, placeholder, onchange, id) {
    var input = h("input", { type: "search", id: id, placeholder: placeholder, value: value, "aria-label": placeholder, spellcheck: "false", autocomplete: "off" });
    var timer;
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { onchange(input.value); }, 120); });
    input.addEventListener("keydown", function (e) { if (e.key === "Escape" && input.value) { e.stopPropagation(); input.value = ""; onchange(""); } });
    return h("div", { class: "search" }, icon("search"), input);
  }

  function renderFindingsPanel() {
    var panel = slots.panels.findings;
    clear(panel);
    var r = model.result;
    if (!r.findings.length) {
      var incomplete = r.status === "incomplete" || r.status === "cancelled";
      panel.appendChild(h("div", { class: "empty" }, icon(incomplete ? "warning" : "pass", "big"), h("h2", null, incomplete ? "No findings in the analysed dependencies" : "No findings"),
        h("p", null, incomplete
          ? "The scan is incomplete, so this is not a clean result: some dependencies could not be resolved or checked. The Packages tab says why for each one."
          : r.summary.unanalyzedPackages ? plural(r.summary.unanalyzedPackages, "package") + " from git, local paths or private sources " + (r.summary.unanalyzedPackages === 1 ? "is" : "are") + " outside OSV's coverage. OSV has no advisory for any analysed package version." : "OSV has no advisory for any analysed package version.")));
      return;
    }
    var ecos = {};
    r.findings.forEach(function (f) { ecos[f.ecosystem] = true; });
    var chips = h("div", { class: "chips", role: "group", "aria-label": "Severity filter" });
    SEVERITIES.forEach(function (level) {
      var on = ui.sev.indexOf(level) >= 0;
      chips.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: function () {
        var i = ui.sev.indexOf(level);
        if (i >= 0) ui.sev.splice(i, 1); else ui.sev.push(level);
        persist(); renderFindingsPanel(); refreshCards();
      } }, SEV_LABEL[level] + " " + r.summary[level]));
    });
    var count = h("span", { class: "result-count", "aria-live": "polite" });
    var list = h("div", { class: "finding-list" });
    var refresh = function () { persist(); renderFindingList(list, count); };
    panel.appendChild(h("div", { class: "filters" },
      searchBox(ui.q, "Search package, ID or CVE  (/)", function (v) { ui.q = v; refresh(); }, "findingSearch"),
      chips,
      select("Ecosystem", ui.eco, [["all", "All ecosystems"]].concat(Object.keys(ecos).sort().map(function (e) { return [e, e]; })), function (v) { ui.eco = v; refresh(); }),
      select("Confidence", ui.confidence, [["all", "Confirmed & potential"], ["confirmed", "Confirmed only"], ["potential", "Potential only"]], function (v) { ui.confidence = v; refresh(); }),
      select("Dependency scope", ui.scope, [["all", "All scopes"], ["prod", "Production"], ["dev", "Development only"]], function (v) { ui.scope = v; refresh(); }),
      h("span", { class: "spacer" }),
      select("Group by", ui.group, [["severity", "Group: severity"], ["package", "Group: package"], ["none", "No grouping"]], function (v) { ui.group = v; refresh(); }),
      select("Sort by", ui.sort, [["severity", "Sort: severity"], ["cvss", "Sort: CVSS score"], ["package", "Sort: package"], ["published", "Sort: newest"], ["id", "Sort: ID"]], function (v) { ui.sort = v; refresh(); }),
      count));
    panel.appendChild(list);
    renderFindingList(list, count);
  }

  function refreshCards() {
    var cards = document.querySelectorAll(".card");
    Array.prototype.forEach.call(cards, function (card, i) {
      var level = SEVERITIES[i];
      card.setAttribute("aria-pressed", String(ui.sev.length === 1 && ui.sev[0] === level));
    });
  }

  function renderFindingList(list, count) {
    clear(list);
    var all = filteredFindings();
    count.textContent = all.length === model.result.findings.length ? plural(all.length, "finding") : all.length + " of " + plural(model.result.findings.length, "finding");
    if (!all.length) {
      renderJobs.findings = null;
      list.appendChild(h("div", { class: "empty" }, icon("filter", "big"), h("h2", null, "No findings match these filters"),
        h("div", { class: "actions" }, button("Clear Filters", { kind: "ghost", icon: "clear-all", onclick: function () {
          ui.q = ""; ui.sev = []; ui.eco = "all"; ui.confidence = "all"; ui.scope = "all"; persist(); renderFindingsPanel(); refreshCards();
        } }))));
      return;
    }
    var rows = [];
    if (ui.group === "none") {
      all.forEach(function (f) { rows.push({ into: list, finding: f }); });
    } else {
      var groups = [];
      var byKey = {};
      all.forEach(function (f) {
        var key = ui.group === "severity" ? f.severity : f.packageKey;
        if (!byKey[key]) {
          var pkg = index.packages[f.packageKey];
          byKey[key] = { key: key, items: [], title: ui.group === "severity" ? SEV_LABEL[f.severity] : f.packageName + " " + (f.installedVersion || (pkg && pkg.specs.join(" / ")) || ""), severity: f.severity };
          groups.push(byKey[key]);
        }
        byKey[key].items.push(f);
      });
      if (ui.group === "severity") groups.sort(function (a, b) { return SEVERITIES.indexOf(a.key) - SEVERITIES.indexOf(b.key); });
      groups.forEach(function (g) {
        var section = h("section", { class: "group", "aria-label": g.title },
          h("h3", null, ui.group === "severity" ? h("span", { class: "pill " + g.key }, g.title) : h("span", null, g.title), h("span", null, plural(g.items.length, "finding"))));
        list.appendChild(section);
        g.items.forEach(function (f) { rows.push({ into: section, finding: f }); });
      });
    }
    inChunks("findings", rows, function (row) { row.into.appendChild(findingRow(row.finding)); });
  }

  function findingRow(f) {
    var details = h("details", { class: "finding " + f.severity, open: !!openKeys[f.key] });
    var cve = f.aliases.filter(function (a) { return /^CVE-/.test(a); })[0];
    var right = h("span", { class: "right" },
      f.confidence === "potential" ? h("span", { class: "badge potential", title: f.confidenceNote || "" }, "Potential") : null,
      f.informational ? h("span", { class: "badge" }, f.informational) : null,
      relationBadge(f),
      f.devOnly ? h("span", { class: "badge dev", title: "Only used as a development or test dependency" }, "dev") : null,
      f.fixedIn ? h("span", { class: "badge fix", title: "Fixed in " + f.fixedIn }, icon("arrow-up"), " " + f.fixedIn)
        : f.noFix ? h("span", { class: "badge nofix" }, "No fix yet") : null,
      icon("chevron-right", "chev"));
    var summary = h("summary", null,
      h("span", { class: "pill " + f.severity }, SEV_LABEL[f.severity] + (f.cvssScore !== undefined ? " " + f.cvssScore.toFixed(1) : "")),
      h("span", { class: "line1" },
        h("span", { class: "pkg" }, f.packageName),
        h("span", { class: "ver" }, f.installedVersion || "version unknown"),
        h("span", { class: "id" }, f.id + (cve && cve !== f.id ? " · " + cve : ""))),
      right,
      h("span", { class: "sum" }, f.summary || (f.detailsAvailable ? "" : "Details could not be loaded.")));
    details.appendChild(summary);
    var bodyBuilt = false;
    function build() {
      if (bodyBuilt) return;
      bodyBuilt = true;
      details.appendChild(findingBody(f));
    }
    if (openKeys[f.key]) build();
    details.addEventListener("toggle", function () {
      if (details.open) { openKeys[f.key] = true; build(); } else delete openKeys[f.key];
    });
    return details;
  }

  function relationBadge(f) {
    var pkg = index.packages[f.packageKey];
    if (!pkg) return null;
    if (pkg.direct === true) return h("span", { class: "badge", title: "Declared directly by your project" }, "direct");
    if (pkg.direct === false) {
      var path = (pkg.occurrences.filter(function (o) { return o.via && o.via.length; })[0] || {}).via;
      return h("span", { class: "badge", title: path ? "Brought in by " + path.join(" → ") : "Brought in by another dependency" }, "transitive");
    }
    return null;
  }

  function kv(rows) {
    var dl = h("dl", { class: "kv" });
    rows.forEach(function (row) {
      if (!row || row[1] === undefined || row[1] === null || row[1] === "") return;
      dl.appendChild(h("dt", null, row[0]));
      dl.appendChild(h("dd", null, row[1]));
    });
    return dl;
  }

  function advisoryUrl(f) {
    var ghsa = [f.id].concat(f.aliases).filter(function (a) { return /^GHSA-/.test(a); })[0];
    if (ghsa) return "https://github.com/advisories/" + ghsa;
    var advisory = f.references.filter(function (r) { return r.type === "ADVISORY"; })[0];
    return advisory ? advisory.url : null;
  }

  function aliasNode(alias) {
    var url = /^CVE-\d+-\d+$/.test(alias) ? "https://nvd.nist.gov/vuln/detail/" + alias
      : /^GHSA-/.test(alias) ? "https://github.com/advisories/" + alias
        : "https://osv.dev/vulnerability/" + encodeURIComponent(alias);
    return external(url, alias);
  }

  function findingBody(f) {
    var body = h("div", { class: "fbody" });
    if (f.confidence === "potential" && f.confidenceNote) body.appendChild(banner("warn", "warning", "Potential finding", f.confidenceNote));
    if (f.summary) body.appendChild(h("p", { class: "lead" }, f.summary));
    var pkg = index.packages[f.packageKey];
    var aliases = h("span", null);
    f.aliases.forEach(function (a, i) { if (i) aliases.appendChild(document.createTextNode(", ")); aliases.appendChild(aliasNode(a)); });
    var severity = h("span", null, SEV_LABEL[f.severity] + (f.cvssScore !== undefined ? " · CVSS " + f.cvssScore.toFixed(1) : ""),
      f.severitySource ? h("span", { class: "note" }, " (" + f.severitySource + ")") : null,
      f.cvssVector ? h("div", { class: "mono" }, f.cvssVector) : null,
      f.cvssV4Vector ? h("div", { class: "mono" }, f.cvssV4Vector) : null);
    body.appendChild(kv([
      ["Package", f.packageName + " (" + f.ecosystem + ")"],
      ["Installed", f.installedVersion ? h("span", { class: "mono" }, f.installedVersion) : "Unknown: only " + ((pkg && pkg.specs.join(" / ")) || "a range") + " is declared"],
      ["Fixed in", f.fixedIn ? h("span", { class: "mono" }, f.fixedIn) : f.noFix ? "No fixed version has been published" : "Unknown"],
      ["Affected versions", f.affectedRanges.join("; ")],
      ["All fixed versions", f.fixedVersions.length > 1 ? f.fixedVersions.join(", ") : ""],
      ["Severity", severity],
      ["Aliases", f.aliases.length ? aliases : ""],
      ["Published", f.published ? day(f.published) + (f.modified ? " · updated " + day(f.modified) : "") : ""],
      ["Weakness", (f.cwes || []).join(", ")],
      ["Type", f.informational ? "Informational (" + f.informational + "), not a vulnerability in the usual sense" : ""]
    ]));
    if (f.details && f.details !== f.summary) {
      var desc = h("div", { class: "desc", tabindex: "0", "aria-label": "Advisory description" }, f.details);
      body.appendChild(desc);
      if (f.details.length > 900) {
        var toggle = button("Show full description", { kind: "ghost small", onclick: function () {
          var full = desc.classList.toggle("full");
          toggle.lastChild.textContent = full ? "Show less" : "Show full description";
        } });
        body.appendChild(toggle);
      }
    }
    if (pkg && pkg.occurrences.length) {
      body.appendChild(h("div", { class: "section-title" }, pkg.direct === false ? "Found in (transitive: dependency path below)" : "Found in"));
      pkg.occurrences.slice(0, 12).forEach(function (o) { body.appendChild(locationRow(o)); });
      if (pkg.occurrences.length > 12) body.appendChild(h("div", { class: "note" }, "…and " + (pkg.occurrences.length - 12) + " more places."));
    }
    var fix = index.remediations[f.packageKey];
    if (fix) {
      body.appendChild(h("div", { class: "section-title" }, "Remediation"));
      body.appendChild(remediationBlock(fix, true));
    }
    if (f.references.length) {
      body.appendChild(h("div", { class: "section-title" }, "References"));
      var refs = h("ul", { class: "refs" });
      var renderRefs = function (all) {
        clear(refs);
        (all ? f.references : f.references.slice(0, 8)).forEach(function (ref) {
          refs.appendChild(h("li", null, h("span", { class: "type" }, ref.type), external(ref.url)));
        });
        if (!all && f.references.length > 8) refs.appendChild(h("li", null, h("a", { href: "#", onclick: function (e) { e.preventDefault(); renderRefs(true); } }, "Show all " + f.references.length + " references")));
      };
      renderRefs(false);
      body.appendChild(refs);
    }
    var advisory = advisoryUrl(f);
    body.appendChild(h("div", { class: "factions" },
      button("View on OSV.dev", { kind: "primary small", icon: "link-external", onclick: function () { post({ type: "openExternal", url: f.osvUrl }); } }),
      advisory ? button("Open Advisory", { kind: "ghost small", icon: "link-external", onclick: function () { post({ type: "openExternal", url: advisory }); } }) : null,
      button("Copy ID", { kind: "ghost small", icon: "copy", onclick: function () { post({ type: "copy", text: f.id, label: f.id }); } })));
    return body;
  }

  function locationRow(o) {
    var tags = [];
    if (o.direct === true) tags.push("direct"); else if (o.direct === false) tags.push("transitive");
    if (o.scope && o.scope !== "production") tags.push(o.scope);
    if (o.spec) tags.push("declared " + o.spec);
    var label = o.file + (o.line ? ":" + o.line : "");
    var via = o.via && o.via.length ? h("div", { class: "note via", title: o.via.join(" → ") }, "via " + o.via.map(function (c) { var p = c.split(":"); return p.length > 2 ? p[1] + " " + p[2] : c; }).join(" → ")) : null;
    return h("div", { class: "loc-wrap" }, h("div", { class: "loc" }, icon(o.resolution === "lockfile" ? "lock" : "file"),
      model.result.source === "workspace"
        ? h("a", { href: "#", title: "Open " + label, onclick: function (e) { e.preventDefault(); post({ type: "openFile", file: o.file, line: o.line || 1 }); } }, label)
        : h("span", { class: "mono" }, label),
      tags.length ? h("span", { class: "note" }, tags.join(" · ")) : null), via);
  }

  function remediationBlock(fix, compact) {
    var wrap = h("div", null);
    if (fix.targetVersion) {
      var check = fix.targetCheck || { status: "unchecked", remaining: [] };
      wrap.appendChild(h("div", { class: "head" },
        compact ? null : h("b", null, fix.packageName),
        h("span", { class: "mono" }, fix.installedVersion || "range"), h("span", { class: "arrow" }, " → "), h("b", { class: "mono" }, fix.targetVersion), " ",
        check.status === "clean" ? h("span", { class: "verified", title: "OSV lists no advisory for this version" }, icon("verified"), "No known advisories at " + fix.targetVersion)
          : check.status === "vulnerable" ? h("span", { class: "unverified" }, icon("warning"), "Still affected by " + check.remaining.join(", "))
            : h("span", { class: "note" }, "(not verified)")));
    } else {
      wrap.appendChild(h("div", { class: "head" }, compact ? null : h("b", null, fix.packageName), h("span", { class: "badge nofix" }, "No fixed version available")));
    }
    fix.commands.forEach(function (c) {
      wrap.appendChild(h("div", { class: "cmd" },
        h("code", null, h("span", { class: "cwd" }, (c.cwd || ".") + " $ "), c.command),
        button("Copy", { kind: "ghost small", icon: "copy", onclick: function () { post({ type: "copy", text: c.command, label: "the command" }); } }),
        model.result.source === "workspace" ? button("Run…", { kind: "ghost small", icon: "terminal", title: "Asks for confirmation, then runs it in a terminal", onclick: function () { post({ type: "runCommand", command: c.command, cwd: c.cwd }); } }) : null));
    });
    if (fix.guidance.length) wrap.appendChild(h("ul", { class: "guidance" }, fix.guidance.map(function (g) { return h("li", null, g); })));
    return wrap;
  }

  // ------------------------------------------------------------------ packages
  function renderPackagesPanel() {
    var panel = slots.panels && slots.panels.packages;
    if (!panel) return;
    clear(panel);
    var r = model.result;
    var ecos = {};
    r.packages.forEach(function (p) { ecos[p.ecosystem] = true; });
    var counts = { all: r.packages.length, vulnerable: r.summary.vulnerablePackages, potential: r.summary.potentialPackages, unanalyzed: r.summary.unanalyzedPackages, clean: r.summary.cleanPackages };
    var chips = h("div", { class: "chips", role: "group", "aria-label": "Status filter" });
    ["all", "vulnerable", "potential", "unanalyzed", "clean"].forEach(function (s) {
      chips.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(ui.pkgStatus === s), onclick: function () { ui.pkgStatus = s; persist(); renderPackagesPanel(); } },
        (s === "all" ? "All" : STATUS_LABEL[s]) + " " + counts[s]));
    });
    var tbodyHolder = h("div", { class: "table-wrap" });
    var count = h("span", { class: "result-count" });
    var refresh = function () { persist(); renderPackageTable(tbodyHolder, count); };
    panel.appendChild(h("div", { class: "filters" },
      searchBox(ui.pkgQ, "Search packages", function (v) { ui.pkgQ = v; refresh(); }, "packageSearch"),
      chips,
      select("Ecosystem", ui.pkgEco, [["all", "All ecosystems"]].concat(Object.keys(ecos).sort().map(function (e) { return [e, e]; })), function (v) { ui.pkgEco = v; refresh(); }),
      h("span", { class: "spacer" }), count));
    panel.appendChild(tbodyHolder);
    renderPackageTable(tbodyHolder, count);
  }

  function renderPackageTable(holder, count) {
    clear(holder);
    var q = ui.pkgQ.trim().toLowerCase();
    var all = model.result.packages.filter(function (p) {
      if (ui.pkgStatus !== "all" && p.status !== ui.pkgStatus) return false;
      if (ui.pkgEco !== "all" && p.ecosystem !== ui.pkgEco) return false;
      if (q && (p.name + " " + (p.version || "") + " " + p.specs.join(" ") + " " + p.ecosystem).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    count.textContent = plural(all.length, "package");
    if (!all.length) { holder.appendChild(h("div", { class: "empty", style: "border:0;margin:0" }, h("p", null, "No packages match."))); return; }
    var table = h("table", { class: "grid" }, h("thead", null, h("tr", null,
      h("th", { scope: "col" }, "Status"), h("th", { scope: "col" }, "Package"), h("th", { scope: "col" }, "Version"), h("th", { scope: "col" }, "Ecosystem"),
      h("th", { scope: "col" }, "Relation"), h("th", { scope: "col" }, "Advisories"), h("th", { scope: "col" }, "Found in"))));
    var tbody = h("tbody", null);
    inChunks("packages", all, function (p) {
      var relation = p.direct === true ? "direct" : p.direct === false ? "transitive" : "—";
      if (p.devOnly) relation += " · dev";
      var first = p.occurrences[0];
      tbody.appendChild(h("tr", null,
        h("td", null, h("span", { class: "status " + p.status, title: p.note || STATUS_LABEL[p.status] }, icon(STATUS_ICON[p.status]), STATUS_LABEL[p.status]),
          p.skipReason ? h("div", { class: "note" }, SKIP_LABEL[p.skipReason] || p.skipReason) : null),
        h("td", null, h("b", null, p.name), p.note ? h("div", { class: "note" }, p.note) : null),
        h("td", { class: "mono" }, p.version || (p.specs.join(" / ") || "unknown")),
        h("td", null, p.ecosystem),
        h("td", null, relation),
        h("td", null, p.findingIds.length ? h("a", { href: "#", onclick: function (e) {
          e.preventDefault(); ui.q = p.name; ui.sev = []; ui.eco = "all"; ui.confidence = "all"; ui.scope = "all"; persist(); renderFindingsPanel(); refreshCards(); selectTab("findings");
        } }, plural(p.findingIds.length, "advisory", "advisories")) : "—"),
        h("td", null, first ? (model.result.source === "workspace"
          ? h("a", { href: "#", onclick: function (e) { e.preventDefault(); post({ type: "openFile", file: first.file, line: first.line || 1 }); } }, first.file + (first.line ? ":" + first.line : ""))
          : h("span", { class: "mono" }, first.file)) : "", p.occurrences.length > 1 ? h("span", { class: "note" }, " +" + (p.occurrences.length - 1)) : null)));
    });
    table.appendChild(tbody);
    holder.appendChild(table);

  }

  // ------------------------------------------------------------------ fixes
  function renderFixesPanel() {
    var panel = slots.panels.fixes;
    clear(panel);
    var r = model.result;
    if (!r.remediations.length) { panel.appendChild(h("div", { class: "empty" }, icon("pass", "big"), h("h2", null, "Nothing to upgrade"))); return; }
    var list = r.remediations.slice().sort(function (a, b) {
      return (index.worst[a.packageKey] - index.worst[b.packageKey]) || a.packageName.localeCompare(b.packageName);
    });
    var commands = [];
    list.forEach(function (fix) { fix.commands.forEach(function (c) { commands.push((c.cwd ? "(cd " + c.cwd + " && " + c.command + ")" : c.command)); }); });
    var fixable = list.filter(function (f) { return f.targetVersion; }).length;
    panel.appendChild(h("div", { class: "filters" },
      h("span", null, plural(fixable, "package") + " can be upgraded to a fixed version" + (list.length - fixable ? "; " + (list.length - fixable) + " have no published fix" : "") + "."),
      h("span", { class: "spacer" }),
      commands.length ? button("Copy All Commands", { kind: "ghost", icon: "copy", onclick: function () { post({ type: "copy", text: commands.join("\n"), label: plural(commands.length, "command") }); } }) : null));
    panel.appendChild(h("p", { class: "note" }, "Nothing runs automatically. Run… asks for confirmation first; review each change, run your tests, then scan again."));
    var holder = h("div", null);
    var render = function () {
      clear(holder);
      inChunks("fixes", list, function (fix) {
        var findings = model.result.findings.filter(function (f) { return f.packageKey === fix.packageKey; });
        var bySev = {};
        findings.forEach(function (f) { bySev[f.severity] = (bySev[f.severity] || 0) + 1; });
        holder.appendChild(h("div", { class: "fix-card" },
          h("div", { class: "head" }, h("b", null, fix.packageName), h("span", { class: "note" }, fix.ecosystem),
            SEVERITIES.filter(function (s) { return bySev[s]; }).map(function (s) { return h("span", { class: "pill " + s }, bySev[s] + " " + SEV_LABEL[s]); })),
          remediationBlock(fix, true)));
      });

    };
    render();
    panel.appendChild(holder);
  }

  // ------------------------------------------------------------------ files and notes
  function renderFilesPanel() {
    var panel = slots.panels.files;
    clear(panel);
    var r = model.result;
    var table = h("table", { class: "grid" }, h("thead", null, h("tr", null,
      h("th", { scope: "col" }, "File"), h("th", { scope: "col" }, "Ecosystem"), h("th", { scope: "col" }, "Type"), h("th", { scope: "col" }, "Tool"),
      h("th", { scope: "col" }, "Packages"), h("th", { scope: "col" }, "Notes"))));
    var tbody = h("tbody", null);
    inChunks("files", r.files, function (f) {
      tbody.appendChild(h("tr", null,
        h("td", null, r.source === "workspace" ? h("a", { href: "#", onclick: function (e) { e.preventDefault(); post({ type: "openFile", file: f.path, line: 1 }); } }, f.path) : h("span", { class: "mono" }, f.path)),
        h("td", null, f.ecosystem), h("td", null, f.resolvedBy ? "resolved tree" : f.kind), h("td", null, f.manager), h("td", null, fmt(f.packages)),
        h("td", null, f.resolvedBy ? h("div", null, icon("type-hierarchy"), " " + f.resolvedBy) : null,
          f.error ? h("span", { class: "status vulnerable" }, icon("error"), f.error) : null,
          f.warnings.slice(0, 6).map(function (w) { return h("div", { class: "note" }, w); }),
          f.warnings.length > 6 ? h("div", { class: "note" }, "…and " + (f.warnings.length - 6) + " more in the log.") : null)));
    });
    table.appendChild(tbody);
    panel.appendChild(h("div", { class: "table-wrap", style: "margin-top:14px" }, table));
    // Recognised dependency files the scanner cannot read: listed, so a gap is never silent.
    (r.unsupportedFiles || []).forEach(function (u) {
      tbody.appendChild(h("tr", null,
        h("td", null, r.source === "workspace" ? h("a", { href: "#", onclick: function (e) { e.preventDefault(); post({ type: "openFile", file: u.path, line: 1 }); } }, u.path) : h("span", { class: "mono" }, u.path)),
        h("td", null, "—"), h("td", null, "unsupported"), h("td", null, "—"), h("td", null, "—"),
        h("td", null, h("span", { class: "status unanalyzed" }, icon("circle-slash"), u.format + " is not supported, so its dependencies were not checked."))));
    });
  }

  function renderNotesPanel() {
    var panel = slots.panels.notes;
    clear(panel);
    var r = model.result;
    if (r.errors.length) {
      panel.appendChild(h("div", { class: "section-title" }, "Errors"));
      panel.appendChild(h("ul", { class: "notes" }, r.errors.map(function (e) { return h("li", null, e); })));
    }
    panel.appendChild(h("div", { class: "section-title" }, "Limitations of this scan"));
    panel.appendChild(h("ul", { class: "notes" }, r.limitations.map(function (l) { return h("li", null, l); })));
    var d = r.diagnostics;
    if (d) {
      if (d.buildTools && d.buildTools.length) {
        panel.appendChild(h("div", { class: "section-title" }, "Maven and Gradle resolution"));
        panel.appendChild(h("ul", { class: "notes" }, d.buildTools.map(function (m) {
          return h("li", null, h("b", null, m.tool + " " + m.project), " · " + (m.method === "build-tool" ? "resolved by " + m.tool + " itself" : m.tool === "Maven" ? "resolved by DevSnip Pro's Maven resolver" : "read from build scripts (Gradle not run)") + " · " + plural(m.modules, m.tool === "Maven" ? "module" : "project") + ", " + plural(m.dependencies, "dependency", "dependencies") + (m.unresolved ? ", " + m.unresolved + " unresolved" : ""),
            m.detail ? h("div", { class: "note" }, m.detail) : null);
        })));
      }
      panel.appendChild(h("div", { class: "section-title" }, "Pipeline"));
      panel.appendChild(kv([
        ["Files", d.filesRead + " read" + (d.filesFailed ? ", " + d.filesFailed + " failed" : "") + " · " + fmt(d.dependenciesParsed) + " dependency entries"],
        ["Packages", fmt(d.packagesDiscovered) + " unique · " + fmt(d.packagesQueried) + " answered by OSV" + (d.packagesFromCache ? " (" + d.packagesFromCache + " from cache)" : "") + (d.queriesFailed ? " · " + d.queriesFailed + " failed" : "")],
        ["Requests", d.batches + " batch" + (d.batches === 1 ? "" : "es") + " · " + d.pagesFollowed + " extra pages · " + d.fallbackQueries + " single-package fallbacks"],
        ["Advisories", fmt(d.advisoryReferences) + " references to " + fmt(d.uniqueAdvisoryIds) + " ids · " + d.recordsFetched + " fetched, " + d.recordsFromCache + " cached" + (d.recordsFailed ? ", " + d.recordsFailed + " failed" : "")],
        ["Merged or dropped", d.aliasesMerged + " alias ids merged · " + d.withdrawnDropped + " withdrawn · " + d.outOfRangeDropped + " outside declared ranges"],
        ["Findings", fmt(d.findings) + " shown"]
      ]));
      panel.appendChild(button("Show Log", { kind: "ghost small", icon: "output", onclick: function () { post({ type: "showLog" }); } }));
    }
    panel.appendChild(h("div", { class: "section-title" }, "About this scan"));
    panel.appendChild(kv([
      ["Started", new Date(r.startedAt).toLocaleString()],
      ["Duration", (r.durationMs / 1000).toFixed(1) + " s"],
      ["Source", r.source === "workspace" ? "Workspace " + r.workspace.name : "Selected files"],
      ["Data", h("span", null, external("https://osv.dev", "OSV.dev"), " via " + r.api.baseUrl)],
      ["Requests", fmt(r.api.requests) + " (" + fmt(r.api.fetchedRecords) + " advisories fetched, " + fmt(r.api.cachedRecords) + " from cache)"],
      ["Severity", "From the advisory: GitHub's reviewed severity first, otherwise the CVSS v3/v2 base score computed from the published vector. Nothing is estimated."],
      ["Confirmed vs potential", "Confirmed: the exact installed version (from a lockfile or an exact pin) is affected. Potential: only a version range is known, and it allows affected versions."]
    ]));
  }

  // ------------------------------------------------------------------ messages
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || typeof m !== "object") return;
    switch (m.type) {
      case "init":
        model.workspace = m.workspace || model.workspace;
        model.ecosystems = m.ecosystems || [];
        model.files = m.files || [];
        model.result = m.result || null;
        model.running = m.running || null;
        model.progress = m.progress || null;
        model.error = m.error || null;
        buildIndex();
        renderAll();
        return;
      case "started":
        model.running = { label: m.label };
        model.progress = m.progress;
        model.error = null;
        model.cancelled = false;
        renderHeader(); renderStatus();
        if (!model.result) renderContent();
        return;
      case "progress":
        model.progress = m.progress;
        var text = document.getElementById("progressText");
        var bar = document.querySelector(".progress .bar > i");
        var region = document.querySelector(".progress");
        if (text && bar && region) {
          var pct = Math.round((m.progress.fraction || 0) * 100);
          text.textContent = m.progress.message;
          bar.style.width = pct + "%";
          region.setAttribute("aria-valuenow", String(pct));
          region.querySelector(".row > .note").textContent = pct + "%";
        } else renderStatus();
        return;
      case "result":
        model.result = m.result;
        model.running = null;
        model.progress = null;
        model.error = null;
        buildIndex();
        renderAll();
        var s = m.result.summary;
        if (m.result.cancelled) toast("Scan cancelled; showing partial results.");
        else if (s.files === 0) toast("No dependency files found.");
        else toast(s.findings ? "Found " + plural(s.findings, "advisory", "advisories") + " in " + plural(s.vulnerablePackages + s.potentialPackages, "package") + "." : "No known vulnerabilities in " + plural(s.packages, "package") + ".", s.findings ? "" : "ok");
        return;
      case "cancelled":
        model.running = null;
        model.progress = null;
        model.cancelled = true;
        renderAll();
        toast("Scan cancelled.");
        return;
      case "error":
        model.running = null;
        model.progress = null;
        model.error = { message: m.message, kind: m.kind };
        renderAll();
        return;
      case "toast":
        toast(m.message, m.kind);
        return;
    }
  });

  document.addEventListener("click", function (e) {
    if (!(e.target instanceof Element) || !e.target.closest(".menu-wrap")) closeMenus();
  });
  document.addEventListener("keydown", function (e) {
    var tag = e.target && e.target.tagName;
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var target = document.getElementById(ui.tab === "packages" ? "packageSearch" : "findingSearch");
      if (target) { e.preventDefault(); if (ui.tab !== "packages") selectTab("findings"); target.focus(); target.select(); }
    }
  });

  post({ type: "ready" });
})();
