/* DevSnip Pro - SCA Scanner webview.
 *
 * The host scans (through the same engine as the OSV Vulnerability Scanner)
 * and analyses; this page shows the ScaResult: project selection, severity
 * cards and totals, filterable vulnerabilities with dependency paths and
 * remediation, dependency health, every dependency, and provider status.
 * Built with DOM nodes and textContent only: advisory and registry text is
 * untrusted. Files, links, previews and edits go through the host, which
 * applies an edit only after a modal confirmation.
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();
  var M = window.ScaModel;
  var app = document.getElementById("app");
  var SEVERITIES = M.SEVERITIES;
  var SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low", unknown: "Unknown" };
  var CLASS_LABEL = { confirmed: "Confirmed", potential: "Potential", informational: "Informational" };
  var KIND_LABEL = { deprecated: "Deprecated", yanked: "Yanked / retracted", abandoned: "Abandoned", inactive: "Inactive", outdated: "Outdated" };
  var STATUS_LABEL = { vulnerable: "Vulnerable", potential: "Potentially affected", clean: "No known issues", unanalyzed: "Not analysed" };
  var SKIP_LABEL = { unresolved: "version unknown", source: "outside advisory coverage", failed: "query failed", cancelled: "scan cancelled" };
  var PROVIDER_ICON = { ok: "pass-filled", partial: "warning", stale: "history", unavailable: "error", skipped: "circle-slash", off: "circle-slash" };
  var CHUNK = 120;
  var renderJobs = {};
  function inChunks(key, items, each, done) {
    var job = (renderJobs[key] = {});
    var i = 0;
    function step() {
      if (renderJobs[key] !== job) return;
      var end = Math.min(items.length, i + CHUNK);
      for (; i < end; i++) each(items[i], i);
      if (i < items.length) setTimeout(step, 0);
      else if (done) done();
    }
    step();
  }

  var saved = vscode.getState() || {};
  var ui = {
    tab: saved.tab || "vulns",
    filters: Object.assign({}, M.DEFAULT_FILTERS, saved.filters || {}),
    sort: saved.sort || "severity",
    group: saved.group || "severity",
    health: Object.assign({}, M.DEFAULT_HEALTH_FILTERS, saved.health || {}),
    deps: Object.assign({ q: "", status: "all", relation: "all", eco: "all" }, saved.deps || {}),
    fixQ: saved.fixQ || "",
    selected: Array.isArray(saved.selected) ? saved.selected : null,
    projectsOpen: saved.projectsOpen === true
  };
  var openKeys = {};
  var model = { workspace: { name: "", hasWorkspace: false, trusted: true }, settings: {}, projects: null, detecting: false, result: null, running: null, progress: null, error: null, cancelled: false, applied: {} };
  var index = { packages: {}, advice: {}, worst: {} };

  function persist() {
    vscode.setState({ tab: ui.tab, filters: ui.filters, sort: ui.sort, group: ui.group, health: ui.health, deps: ui.deps, fixQ: ui.fixQ, selected: ui.selected, projectsOpen: ui.projectsOpen });
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
  function plural(n, one, many) { return fmt(n) + " " + (n === 1 ? one : (many || one + "s")); }
  function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
  function post(message) { vscode.postMessage(message); }
  function external(url, text) {
    return h("a", { href: url, title: url, onclick: function (e) { e.preventDefault(); post({ type: "openExternal", url: url }); } }, text || url);
  }
  function fileLink(loc) {
    var label = loc.line ? loc.file + ":" + loc.line : loc.file;
    return h("a", { href: "#", class: "mono", title: "Open " + label, onclick: function (e) { e.preventDefault(); post({ type: "openFile", file: loc.file, line: loc.line || 0 }); } }, label);
  }
  function idLink(id) {
    if (/^CVE-\d{4}-\d+$/i.test(id)) return external("https://nvd.nist.gov/vuln/detail/" + id.toUpperCase(), id);
    if (/^GHSA-/i.test(id)) return external("https://github.com/advisories/" + id, id);
    return external("https://osv.dev/vulnerability/" + encodeURIComponent(id), id);
  }
  function select(id, label, value, options, onchange) {
    var el = h("select", { class: "control", id: id, "aria-label": label, onchange: function () { onchange(el.value); } });
    options.forEach(function (o) { var opt = h("option", { value: o[0] }, o[1]); if (o[0] === value) opt.selected = true; el.appendChild(opt); });
    return el;
  }
  function searchBox(id, placeholder, value, oninput) {
    var timer;
    var input = h("input", { type: "search", id: id, placeholder: placeholder, "aria-label": placeholder, value: value,
      oninput: function () { clearTimeout(timer); timer = setTimeout(function () { oninput(input.value); }, 120); } });
    return h("div", { class: "search" }, icon("search"), input);
  }

  var toastRoot = document.getElementById("toasts");
  function toast(message, kind) {
    var t = h("div", { class: "toast" + (kind ? " " + kind : "") }, message);
    toastRoot.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4600);
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

  function buildIndex() {
    index = { packages: {}, advice: {}, worst: {} };
    var r = model.result;
    if (!r) return;
    r.scan.packages.forEach(function (p) { index.packages[p.key] = p; });
    r.advice.forEach(function (a) { index.advice[a.packageKey] = a; });
    r.vulnerabilities.forEach(function (v) {
      var k = v.finding.packageKey;
      var rank = SEVERITIES.indexOf(v.severity) - (v.kev ? 10 : 0);
      if (index.worst[k] === undefined || rank < index.worst[k]) index.worst[k] = rank;
    });
  }

  // ------------------------------------------------------------------ frame
  var slots = {};
  function renderAll() {
    clear(app);
    app.removeAttribute("aria-busy");
    slots.header = h("header", { class: "top" });
    slots.projects = h("div", { class: "projects-slot" });
    slots.status = h("div", { class: "status-area", "aria-live": "polite" });
    slots.content = h("main", { class: "content" });
    append(app, [slots.header, slots.projects, slots.status, slots.content]);
    renderHeader();
    renderProjects();
    renderStatus();
    renderContent();
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".menu"), function (m) { m.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll("[aria-haspopup]"), function (b) { b.setAttribute("aria-expanded", "false"); });
  }
  function menuButton(label, iconName, items, opts) {
    var menu = h("div", { class: "menu", role: "menu", hidden: true });
    var trigger = h("button", { type: "button", class: "btn ghost", "aria-haspopup": "menu", "aria-expanded": "false", disabled: opts && opts.disabled, title: opts && opts.title, "aria-label": label || (opts && opts.title),
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

  function selectedDirs() {
    var projects = model.projects || [];
    if (!ui.selected) return projects.map(function (p) { return p.dir; });
    return ui.selected.filter(function (d) { return projects.some(function (p) { return p.dir === d; }); });
  }
  function startScan(fresh) {
    if (model.running) { toast("A scan is already running."); return; }
    if (!model.workspace.hasWorkspace) { post({ type: "openFolder" }); return; }
    var dirs = selectedDirs();
    var all = !model.projects || dirs.length === model.projects.length;
    if (model.projects && model.projects.length && !dirs.length) { toast("Select at least one project to scan.", "error"); return; }
    post({ type: "scan", fresh: !!fresh, projects: all ? undefined : dirs });
  }

  function renderHeader() {
    clear(slots.header);
    var r = model.result;
    var meta = [];
    if (model.workspace.hasWorkspace) meta.push(r ? r.scan.workspace.name : model.workspace.name);
    if (r) meta.push("Scanned " + relativeTime(r.finishedAt) + " · " + (r.durationMs / 1000).toFixed(1) + " s");
    var running = !!model.running;
    var primary;
    if (running) primary = button("Cancel", { kind: "ghost", icon: "debug-stop", onclick: function () { post({ type: "cancel" }); }, id: "cancelBtn" });
    else if (model.workspace.hasWorkspace) primary = button(r ? "Scan Again" : "Scan Dependencies", { kind: "primary", icon: r ? "refresh" : "play", onclick: function () { startScan(false); }, id: "scanBtn" });
    else primary = button("Open Folder…", { kind: "primary", icon: "folder-opened", onclick: function () { post({ type: "openFolder" }); } });
    append(slots.header, [
      h("div", { class: "title" },
        h("h1", null, icon("shield"), "SCA Scanner"),
        h("div", { class: "meta" }, meta.join(" · ") || "Software composition analysis: vulnerabilities, exploitation, dependency health and fixes")),
      h("div", { class: "toolbar" },
        primary,
        menuButton("Export", "export", [
          { label: "JSON (full result)", icon: "json", run: function () { post({ type: "export", format: "json" }); } },
          { label: "CSV (vulnerabilities and health)", icon: "table", run: function () { post({ type: "export", format: "csv" }); } }
        ], { disabled: !r, title: r ? "Export the results" : "Run a scan first" }),
        menuButton("", "ellipsis", [
          { label: "Scan again, ignoring cached answers", icon: "sync", run: function () { startScan(true); } },
          { label: "Detect projects again", icon: "search", run: function () { post({ type: "detect" }); } },
          { label: model.settings.hasNvdKey ? "Change or remove the NVD API key" : "Add a free NVD API key (optional)", icon: "key", run: function () { post({ type: "nvdKey" }); } },
          { label: "SCA settings", icon: "settings-gear", run: function () { post({ type: "settings" }); } },
          { label: "Maven and Gradle settings", icon: "tools", run: function () { post({ type: "settings", section: "build" }); } },
          { label: "Show scan log", icon: "output", run: function () { post({ type: "showLog" }); } },
          { label: "Clear all caches", icon: "clear-all", run: function () { post({ type: "clearCache" }); } }
        ], { title: "More actions" }))
    ]);
    slots.header.appendChild(h("p", { class: "privacy" }, icon("lock"),
      h("span", null, "Sent: package names and versions (OSV.dev and package registries) and CVE ids (NVD). The CISA KEV catalog is downloaded and matched locally. Source code, file contents and credentials never leave VS Code, and no file changes without your confirmation.")));
  }

  // ------------------------------------------------------------------ projects
  function renderProjects() {
    clear(slots.projects);
    if (!model.workspace.hasWorkspace) return;
    var projects = model.projects;
    var dirs = selectedDirs();
    var summaryText = model.detecting && !projects ? "Detecting projects…"
      : !projects ? "Projects"
        : projects.length === 0 ? "No projects with dependency files detected"
          : (dirs.length === projects.length ? "All " + plural(projects.length, "project") : dirs.length + " of " + plural(projects.length, "project")) + " selected";
    var details = h("details", { class: "projects", open: ui.projectsOpen && projects && projects.length ? true : null,
      ontoggle: function () { ui.projectsOpen = details.open; persist(); } },
      h("summary", null, icon("chevron-right", "chev"), icon(model.detecting ? "loading" : "folder-library", model.detecting ? "codicon-modifier-spin" : ""), summaryText));
    if (projects && projects.length) {
      var list = h("div", { class: "project-list", role: "group", "aria-label": "Projects to scan" });
      projects.forEach(function (p) {
        var id = "project-" + p.dir.replace(/[^\w-]/g, "_");
        var box = h("input", { type: "checkbox", id: id, checked: dirs.indexOf(p.dir) !== -1, disabled: !!model.running,
          onchange: function () {
            var current = selectedDirs();
            if (box.checked && current.indexOf(p.dir) === -1) current.push(p.dir);
            if (!box.checked) current = current.filter(function (d) { return d !== p.dir; });
            ui.selected = current.length === projects.length ? null : current;
            persist();
            renderProjects();
          } });
        list.appendChild(h("label", { class: "project-row", for: id }, box,
          h("b", null, p.name), h("span", { class: "dir" }, p.dir || "(workspace root)"),
          p.ecosystems.map(function (e) { return h("span", { class: "badge" }, e); }),
          p.managers.length ? h("span", { class: "note" }, p.managers.join(", ")) : null,
          p.springBoot ? h("span", { class: "badge boot", title: "Spring Boot version from the parent POM, BOM import or Gradle plugin" }, "Spring Boot " + p.springBoot) : null,
          p.modules > 1 ? h("span", { class: "note" }, plural(p.modules, "module")) : null));
      });
      details.appendChild(list);
      details.appendChild(h("div", { class: "project-actions" },
        button("Select All", { kind: "ghost small", disabled: !!model.running, onclick: function () { ui.selected = null; persist(); renderProjects(); } }),
        button("Select None", { kind: "ghost small", disabled: !!model.running, onclick: function () { ui.selected = []; persist(); renderProjects(); } }),
        button("Scan Selected", { kind: "small", icon: "play", disabled: !!model.running || !dirs.length, onclick: function () { startScan(false); } })));
    }
    slots.projects.appendChild(details);
  }

  // ------------------------------------------------------------------ status
  function banner(kind, iconName, title, text, actions) {
    return h("div", { class: "banner " + kind, role: kind === "error" ? "alert" : "status" }, icon(iconName),
      h("div", { class: "body" }, h("b", null, title), text ? h("div", null, text) : null, actions && actions.length ? h("div", { class: "actions" }, actions) : null));
  }
  function renderStatus() {
    clear(slots.status);
    var logButton = button("Show Log", { kind: "ghost small", icon: "output", onclick: function () { post({ type: "showLog" }); } });
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
      var actions = model.error.kind === "no-workspace"
        ? [button("Open Folder…", { kind: "primary", icon: "folder-opened", onclick: function () { post({ type: "openFolder" }); } })]
        : [button("Try Again", { kind: "primary", icon: "refresh", onclick: function () { startScan(false); } }), logButton];
      var stale = model.result && model.error.kind !== "no-workspace" ? " The results below are from the previous scan (" + relativeTime(model.result.finishedAt) + ")." : "";
      append(slots.status, banner("error", "error", model.error.kind === "no-workspace" ? "No folder is open" : "The scan could not finish", model.error.message + stale, actions));
      return;
    }
    if (model.cancelled && !model.result) { append(slots.status, banner("warn", "warning", "Scan cancelled", "Nothing was changed.")); return; }
    if (model.cancelled && model.result && model.result.status !== "cancelled") { append(slots.status, banner("warn", "warning", "Scan cancelled", "The results below are from the previous scan (" + relativeTime(model.result.finishedAt) + ").")); return; }
    var r = model.result;
    if (!r || r.scan.summary.files === 0) return;
    var su = r.summary;
    if (r.status === "cancelled") { append(slots.status, banner("warn", "warning", "Scan cancelled: results are partial", "Dependencies that were not checked are listed as Not analysed.", [logButton])); return; }
    var unavailable = r.providers.filter(function (p) { return p.status === "unavailable"; });
    var degraded = r.providers.filter(function (p) { return p.status === "partial" || p.status === "stale"; });
    var showSources = button("Show Sources", { kind: "ghost small", icon: "info", onclick: function () { selectTab("notes"); } });
    if (r.status === "incomplete") {
      var gaps = [];
      if (r.diagnostics && r.diagnostics.incompleteReasons && r.diagnostics.incompleteReasons.length) {
        gaps = r.diagnostics.incompleteReasons.slice();
      } else {
        if (su.unresolved) gaps.push(plural(su.unresolved, "dependency", "dependencies") + " whose version could not be determined");
        if (su.failed) gaps.push(plural(su.failed, "dependency", "dependencies") + " the advisory database could not be queried for");
        if (r.scan.diagnostics.recordsFailed) gaps.push(plural(r.scan.diagnostics.recordsFailed, "advisory", "advisories") + " whose details could not be loaded");
        if (r.scan.diagnostics.filesFailed) gaps.push(plural(r.scan.diagnostics.filesFailed, "file") + " that could not be read");
        unavailable.forEach(function (p) { gaps.push(p.name + " (" + p.message + ")"); });
      }
      var lead = su.vulnerableDependencies === 0 ? "No vulnerabilities were found in what was checked, but the scan is incomplete, so this is not a clean result. " : "";
      append(slots.status, banner("warn", "warning", "Scan incomplete", lead + "Not fully checked: " + gaps.join("; ") + ".",
        [r.scan.unsupportedFiles && r.scan.unsupportedFiles.length ? button("Show Unsupported Files", { kind: "ghost small", icon: "question", onclick: function () { selectTab("notes"); var el = document.getElementById("unsupportedFiles"); if (el) el.scrollIntoView({ block: "start" }); } }) : null,
          su.unresolved || su.failed ? button("Show Unchecked", { kind: "ghost small", icon: "list-flat", onclick: function () { ui.deps.status = "unanalyzed"; persist(); renderDepsPanel(); selectTab("deps"); } }) : null, showSources, logButton].filter(Boolean)));
      return;
    }
    var detail = "Every one of the " + plural(su.dependencies, "dependency", "dependencies") + " found was checked." + (degraded.length ? " Partly available: " + degraded.map(function (p) { return p.name.split(" (")[0]; }).join(", ") + "." : "");
    if (su.vulnerableDependencies === 0) append(slots.status, banner("ok", "pass-filled", "Scan complete: no known vulnerabilities", detail, [showSources, logButton]));
    else append(slots.status, banner(degraded.length ? "warn" : "ok", degraded.length ? "warning" : "pass", "Scan complete", detail, [showSources, logButton]));
  }

  // ------------------------------------------------------------------ content
  function renderEmpty() {
    if (model.running) return;
    append(slots.content, h("div", { class: "empty" }, icon("shield", "big"),
      h("h2", null, model.workspace.hasWorkspace ? "Scan your dependencies" : "Open a folder to scan"),
      h("p", null, "Resolves every direct and transitive dependency (Maven and Gradle with your BOMs and parents, lockfiles for npm, Yarn, pnpm, Python, .NET, PHP, Ruby, Go, Rust, Dart and more), checks them against OSV.dev, marks vulnerabilities CISA knows are exploited, and works out the safest fix."),
      h("div", { class: "actions" }, model.workspace.hasWorkspace
        ? button("Scan Dependencies", { kind: "primary", icon: "play", onclick: function () { startScan(false); } })
        : button("Open Folder…", { kind: "primary", icon: "folder-opened", onclick: function () { post({ type: "openFolder" }); } }))));
  }

  function renderContent() {
    clear(slots.content);
    var r = model.result;
    if (!r) { renderEmpty(); return; }
    if (r.scan.summary.files === 0) {
      append(slots.content, h("div", { class: "empty" }, icon("search", "big"), h("h2", null, "No dependency files found"),
        h("p", null, "The selected projects have no lockfile or manifest the scanner understands outside installed-package and build folders.")));
      return;
    }
    append(slots.content, summaryCards(r));
    var tabs = [
      { id: "vulns", label: "Vulnerabilities", count: r.vulnerabilities.length },
      { id: "fixes", label: "Remediation", count: r.advice.length },
      { id: "health", label: "Dependency health", count: r.health.length },
      { id: "deps", label: "Dependencies", count: r.scan.packages.length },
      { id: "notes", label: "Sources & notes", count: r.providers.filter(function (p) { return p.status !== "ok" && p.status !== "off" && p.status !== "skipped"; }).length + r.limitations.length }
    ];
    if (!tabs.some(function (t) { return t.id === ui.tab; })) ui.tab = "vulns";
    var tablist = h("div", { class: "tabs", role: "tablist", "aria-label": "Scan results" });
    var panels = {};
    tabs.forEach(function (t) {
      var on = ui.tab === t.id;
      tablist.appendChild(h("button", { type: "button", class: "tab", role: "tab", id: "tab-" + t.id, "aria-selected": String(on), "aria-controls": "panel-" + t.id, tabindex: on ? "0" : "-1",
        onclick: function () { selectTab(t.id); } }, t.label, h("span", { class: "count" }, fmt(t.count))));
      panels[t.id] = h("section", { class: "panel", role: "tabpanel", id: "panel-" + t.id, "aria-labelledby": "tab-" + t.id, hidden: !on });
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
    renderVulnsPanel();
    renderFixesPanel();
    renderHealthPanel();
    renderDepsPanel();
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
    if (slots.panels) for (var key in slots.panels) slots.panels[key].hidden = key !== id;
  }

  function summaryCards(r) {
    var s = r.summary;
    var wrap = h("div");
    var cards = h("div", { class: "cards six", role: "group", "aria-label": "Findings by severity" });
    SEVERITIES.slice(0, 4).forEach(function (sev) {
      var on = ui.filters.sev.length === 1 && ui.filters.sev[0] === sev;
      cards.appendChild(h("button", { type: "button", class: "card " + sev + (s[sev] ? "" : " zero"), "aria-pressed": String(on), title: "Show " + SEV_LABEL[sev].toLowerCase() + " vulnerabilities",
        onclick: function () { ui.filters.sev = on ? [] : [sev]; ui.filters.cls = "all"; persist(); selectTab("vulns"); refreshCardsAndVulns(); } },
        h("b", null, fmt(s[sev])), h("span", null, SEV_LABEL[sev])));
    });
    var infoOn = ui.filters.cls === "informational";
    cards.appendChild(h("button", { type: "button", class: "card info" + (s.informational ? "" : " zero"), "aria-pressed": String(infoOn), title: "Informational: notice advisories, outdated packages and other health findings (never counted as vulnerabilities)",
      onclick: function () {
        if (r.vulnerabilities.some(function (v) { return v.class === "informational"; }) && !infoOn) { ui.filters.cls = "informational"; ui.filters.sev = []; persist(); selectTab("vulns"); refreshCardsAndVulns(); }
        else if (infoOn) { ui.filters.cls = "all"; persist(); refreshCardsAndVulns(); }
        else selectTab("health");
      } }, h("b", null, fmt(s.informational)), h("span", null, "Informational")));
    var kevOn = !!ui.filters.kev;
    cards.appendChild(h("button", { type: "button", class: "card kev" + (s.exploited ? "" : " zero"), "aria-pressed": String(kevOn), title: "Listed in CISA's Known Exploited Vulnerabilities catalog",
      onclick: function () { ui.filters.kev = !kevOn; persist(); selectTab("vulns"); refreshCardsAndVulns(); } },
      h("b", null, fmt(s.exploited)), h("span", null, "Known exploited")));
    wrap.appendChild(cards);
    var totals = h("div", { class: "totals", role: "group", "aria-label": "Dependency totals" });
    [
      { label: "Total dependencies", value: s.dependencies, run: function () { ui.deps = { q: "", status: "all", relation: "all", eco: "all" }; } },
      { label: "Vulnerable dependencies", value: s.vulnerableDependencies, run: function () { ui.deps = { q: "", status: "vulnerable", relation: "all", eco: "all" }; } },
      { label: "Direct", value: s.direct, run: function () { ui.deps = { q: "", status: "all", relation: "direct", eco: "all" }; } },
      { label: "Transitive", value: s.transitive, run: function () { ui.deps = { q: "", status: "all", relation: "transitive", eco: "all" }; } }
    ].forEach(function (t) {
      totals.appendChild(h("button", { type: "button", class: "total", onclick: function () { t.run(); persist(); renderDepsPanel(); selectTab("deps"); } }, h("b", null, fmt(t.value)), h("span", null, t.label)));
    });
    wrap.appendChild(totals);
    var stats = [];
    if (s.unknown) stats.push(h("span", { class: "clickable", title: "Vulnerabilities with no published severity", onclick: function () { ui.filters.sev = ["unknown"]; ui.filters.cls = "all"; persist(); selectTab("vulns"); refreshCardsAndVulns(); } }, h("b", null, fmt(s.unknown)), " unknown severity"));
    if (s.unknownRelation) stats.push(h("span", null, h("b", null, fmt(s.unknownRelation)), " relation unknown"));
    if (s.unresolved) stats.push(h("span", { class: "clickable", onclick: function () { ui.deps.status = "unanalyzed"; persist(); renderDepsPanel(); selectTab("deps"); } }, h("b", null, fmt(s.unresolved)), " unresolved"));
    if (s.maintenanceRisks) stats.push(h("span", { class: "clickable", onclick: function () { ui.health.kind = "risks"; persist(); renderHealthPanel(); selectTab("health"); } }, h("b", null, fmt(s.maintenanceRisks)), " maintenance risks"));
    if (s.outdated) stats.push(h("span", { class: "clickable", onclick: function () { ui.health.kind = "outdated"; persist(); renderHealthPanel(); selectTab("health"); } }, h("b", null, fmt(s.outdated)), " outdated"));
    stats.push(h("span", null, h("b", null, fmt(r.scan.summary.files)), " files · ", h("b", null, fmt(r.projects.length)), " project" + (r.projects.length === 1 ? "" : "s")));
    wrap.appendChild(h("div", { class: "stats" }, stats));
    return wrap;
  }

  function refreshCardsAndVulns() {
    var r = model.result;
    if (!r) return;
    var old = slots.content.firstChild;
    var fresh = summaryCards(r);
    slots.content.replaceChild(fresh, old);
    renderVulnsPanel();
  }

  // ------------------------------------------------------------------ vulnerabilities
  function renderVulnsPanel() {
    var panel = slots.panels && slots.panels.vulns;
    if (!panel) return;
    clear(panel);
    var r = model.result;
    var f = ui.filters;
    var facets = M.facets(r);
    var sevChips = h("div", { class: "chips", role: "group", "aria-label": "Severity" });
    SEVERITIES.forEach(function (sev) {
      var on = f.sev.indexOf(sev) !== -1;
      sevChips.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: function () {
        f.sev = on ? f.sev.filter(function (x) { return x !== sev; }) : f.sev.concat([sev]);
        persist(); refreshCardsAndVulns();
      } }, SEV_LABEL[sev]));
    });
    sevChips.appendChild(h("button", { type: "button", class: "chip", "aria-pressed": String(!!f.kev), title: "Only vulnerabilities in CISA's KEV catalog", onclick: function () { f.kev = !f.kev; persist(); refreshCardsAndVulns(); } }, icon("flame"), " Exploited"));
    var update = function (key) { return function (value) { f[key] = value; persist(); renderVulnsPanel(); }; };
    var filters = h("div", { class: "filters" },
      searchBox("vulnSearch", "Package, CVE, GHSA or text  ( / )", f.q, function (v) { f.q = v; persist(); renderVulnList(); }),
      sevChips,
      select("vulnEco", "Ecosystem", f.eco, [["all", "All ecosystems"]].concat(facets.ecosystems.map(function (e) { return [e, e]; })), update("eco")),
      select("vulnRelation", "Direct or transitive", f.relation, [["all", "Direct and transitive"], ["direct", "Direct only"], ["transitive", "Transitive only"], ["unknown", "Relation unknown"]], update("relation")),
      select("vulnClass", "Classification", f.cls, [["all", "All classifications"], ["confirmed", "Confirmed"], ["potential", "Potential"], ["informational", "Informational"]], update("cls")),
      select("vulnDev", "Scope", f.dev, [["all", "Production and development"], ["production", "Production only"], ["development", "Development only"]], update("dev")),
      facets.projects.length > 1 ? select("vulnProject", "Project", f.project, [["all", "All projects"]].concat(facets.projects.map(function (p) { return [p, p || "(root)"]; })), update("project")) : null,
      h("span", { class: "spacer" }),
      select("vulnSort", "Sort", ui.sort, [["severity", "Sort: exploited, then severity"], ["cvss", "Sort: CVSS score"], ["package", "Sort: package"], ["published", "Sort: newest"], ["ecosystem", "Sort: ecosystem"]], function (v) { ui.sort = v; persist(); renderVulnList(); }),
      select("vulnGroup", "Group", ui.group, [["severity", "Group by severity"], ["package", "Group by package"], ["ecosystem", "Group by ecosystem"], ["none", "No grouping"]], function (v) { ui.group = v; persist(); renderVulnList(); }));
    panel.appendChild(filters);
    slots.vulnCount = h("div", { class: "result-count", "aria-live": "polite" });
    slots.vulnList = h("div", { class: "vuln-list" });
    append(panel, [slots.vulnCount, slots.vulnList]);
    renderVulnList();
  }

  function renderVulnList() {
    var r = model.result;
    if (!r || !slots.vulnList) return;
    clear(slots.vulnList);
    var list = M.sortVulnerabilities(M.filterVulnerabilities(r.vulnerabilities, ui.filters), ui.sort);
    slots.vulnCount.textContent = list.length === r.vulnerabilities.length ? plural(list.length, "vulnerability", "vulnerabilities") : fmt(list.length) + " of " + plural(r.vulnerabilities.length, "vulnerability", "vulnerabilities") + " match the filters";
    if (!r.vulnerabilities.length) {
      slots.vulnList.appendChild(h("div", { class: "empty" }, icon(r.status === "complete" ? "pass-filled" : "warning", "big"),
        h("h2", null, r.status === "complete" ? "No known vulnerabilities" : "No vulnerabilities in what was checked"),
        h("p", null, r.status === "complete" ? "No advisory in OSV.dev affects the resolved versions of your dependencies." : "The scan is incomplete; see the banner above for what was not checked.")));
      return;
    }
    if (!list.length) {
      slots.vulnList.appendChild(h("div", { class: "empty" }, icon("filter", "big"), h("h2", null, "Nothing matches the filters"),
        h("div", { class: "actions" }, button("Clear Filters", { kind: "ghost", icon: "clear-all", onclick: function () { ui.filters = Object.assign({}, M.DEFAULT_FILTERS); persist(); refreshCardsAndVulns(); } }))));
      return;
    }
    var groups = M.groupVulnerabilities(list, ui.group);
    var items = [];
    groups.forEach(function (g) {
      if (ui.group !== "none") items.push({ heading: g, count: g.items.length });
      g.items.forEach(function (v) { items.push({ v: v }); });
    });
    inChunks("vulns", items, function (item) {
      if (item.heading) {
        var label = ui.group === "severity" ? SEV_LABEL[item.heading.key] || item.heading.label : item.heading.label;
        slots.vulnList.appendChild(h("h3", { class: "group-title", style: "font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:14px 0 6px" }, label + " · " + item.count));
      } else slots.vulnList.appendChild(vulnRow(item.v));
    });
  }

  function vulnRow(v) {
    var f = v.finding;
    var details = h("details", { class: "finding " + v.severity, "data-key": v.key, open: openKeys[v.key] ? true : null });
    var summary = h("summary", null,
      icon("chevron-right", "chev"),
      h("div", { class: "line1" },
        h("span", { class: "pill " + v.severity }, SEV_LABEL[v.severity]),
        v.kev ? h("span", { class: "badge kev", title: "CISA lists this as exploited in the wild" }, icon("flame"), " Exploited") : null,
        h("span", { class: "pkg" }, f.packageName),
        h("span", { class: "ver" }, f.installedVersion || "version unknown"),
        h("span", { class: "id" }, (v.cves[0] || f.id) + (v.cves.length > 1 ? " +" + (v.cves.length - 1) : ""))),
      h("div", { class: "right" },
        typeof v.cvssScore === "number" ? h("span", { class: "badge", title: v.cvssVector || "" }, "CVSS " + v.cvssScore.toFixed(1)) : null,
        v.class !== "confirmed" ? h("span", { class: "badge " + (v.class === "potential" ? "potential" : ""), title: f.confidenceNote || "" }, CLASS_LABEL[v.class]) : null,
        h("span", { class: "badge" }, v.relation === "unknown" ? "relation unknown" : v.relation),
        v.devOnly ? h("span", { class: "badge dev" }, "dev") : null,
        f.fixedIn ? h("span", { class: "badge fix" }, "fix " + f.fixedIn) : f.noFix ? h("span", { class: "badge nofix" }, "no fix") : null),
      h("div", { class: "sum" }, f.summary || (f.detailsAvailable ? "" : "Advisory details could not be loaded; open it on OSV.dev.")));
    details.appendChild(summary);
    var body = null;
    details.addEventListener("toggle", function () {
      openKeys[v.key] = details.open;
      if (details.open && !body) { body = vulnBody(v); details.appendChild(body); }
    });
    if (details.open) { body = vulnBody(v); details.appendChild(body); }
    return details;
  }

  function managedText(m) {
    if (!m) return null;
    if (m.kind === "workspace") return "Your <dependencyManagement> in " + (m.path || m.source) + (m.property ? " (property " + m.property + ")" : "") + " sets " + m.version + ".";
    if (m.kind === "parent") return "The parent POM " + m.source + (m.property ? " sets it through the property " + m.property : " manages it") + " (" + m.version + ").";
    return "The imported BOM " + (m.bom || m.source) + " manages it at " + m.version + (m.property ? " (property " + m.property + ")" : "") + ".";
  }

  function vulnBody(v) {
    var f = v.finding;
    var body = h("div", { class: "fbody" });
    if (f.summary) body.appendChild(h("p", { class: "lead" }, f.summary));
    if (v.kev) {
      body.appendChild(h("div", { class: "kev-box", role: "note" }, h("b", null, icon("flame"), " Known exploited (CISA KEV)"),
        h("div", null, (v.kev.vulnerabilityName || v.kev.cveId) + ". Added " + v.kev.dateAdded + (v.kev.knownRansomwareCampaignUse === "Known" ? "; used in ransomware campaigns." : ".")),
        v.kev.requiredAction ? h("div", { class: "note" }, "CISA's required action: " + v.kev.requiredAction) : null,
        h("div", null, external("https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=" + encodeURIComponent(v.kev.cveId), "View in the KEV catalog"))));
    }
    var kv = h("dl", { class: "kv" });
    function row(label, value) { if (value === null || value === undefined || value === "") return; kv.appendChild(h("dt", null, label)); kv.appendChild(h("dd", null, value)); }
    row("Package", [h("b", null, f.packageName), " · " + f.ecosystem]);
    row("Installed", f.installedVersion || "Unknown (only a range is declared)");
    row("Classification", CLASS_LABEL[v.class] + (v.class === "confirmed" ? ": the resolved version is affected." : v.class === "potential" ? (f.confidenceNote ? ": " + f.confidenceNote : ": the exact version is not known.") : f.informational ? ": " + f.informational + " notice." : ""));
    row("Severity", SEV_LABEL[v.severity] + (typeof v.cvssScore === "number" ? " · CVSS " + v.cvssScore.toFixed(1) : "") + (v.severitySource ? " (" + v.severitySource + ")" : v.severity === "unknown" ? " (no published severity)" : ""));
    if (v.cvssVector) row("CVSS vector", h("span", { class: "mono" }, v.cvssVector));
    row("Affected versions", f.affectedRanges.length ? f.affectedRanges.join("; ") : "Not stated as ranges; see the advisory");
    row("Fixed in", f.fixedIn ? [h("b", null, f.fixedIn), f.fixedVersions.length > 1 ? " (fixed releases: " + f.fixedVersions.join(", ") + ")" : ""] : f.noFix ? "No fixed version has been published" : "Not stated");
    row("Relation", v.relation === "direct" ? "Direct dependency" : v.relation === "transitive" ? "Transitive dependency" : "Not recorded by the lockfile");
    row("Version controlled by", managedText(v.managedBy));
    row("Published", f.published ? day(f.published) + (f.modified ? " · updated " + day(f.modified) : "") : null);
    if (f.cwes && f.cwes.length) row("Weakness", f.cwes.map(function (c) { return external("https://cwe.mitre.org/data/definitions/" + c.replace(/^CWE-/i, "") + ".html", c); }).reduce(function (a, b) { return a.length ? a.concat([", ", b]) : [b]; }, []));
    if (v.projects.length > 1 || (v.projects[0] && v.projects[0] !== "")) row("Projects", v.projects.map(function (p) { return p || "(root)"; }).join(", "));
    body.appendChild(kv);

    var ids = [f.id].concat(f.aliases.filter(function (a) { return a !== f.id; }));
    body.appendChild(h("div", { class: "section-title" }, "Identifiers"));
    var idWrap = h("div", { class: "loc" });
    ids.forEach(function (id, i) { if (i) idWrap.appendChild(document.createTextNode(" · ")); idWrap.appendChild(idLink(id)); });
    idWrap.appendChild(h("span", { class: "note" }, " · "));
    idWrap.appendChild(external(f.osvUrl, "OSV.dev record"));
    body.appendChild(idWrap);

    if (v.locations.length) {
      body.appendChild(h("div", { class: "section-title" }, "Declared or locked in"));
      v.locations.forEach(function (loc) { body.appendChild(h("div", { class: "loc" }, icon("file"), fileLink(loc))); });
    }
    if (v.paths.length) {
      body.appendChild(h("div", { class: "section-title" }, "Dependency path" + (v.paths.length > 1 ? "s" : "")));
      v.paths.forEach(function (p) {
        var line = h("div", { class: "path" });
        p.concat([f.packageName + (f.installedVersion ? ":" + f.installedVersion : "")]).forEach(function (step, i) {
          if (i) line.appendChild(h("span", { class: "sep", "aria-hidden": "true" }, "→"));
          line.appendChild(h(i === p.length ? "b" : "span", null, step));
        });
        body.appendChild(line);
      });
    } else if (v.relation === "transitive") {
      body.appendChild(h("p", { class: "note" }, "The lockfile does not record which dependency brings this in."));
    }
    if (f.details && f.details !== f.summary) {
      body.appendChild(h("div", { class: "section-title" }, "Details"));
      var desc = h("div", { class: "desc", tabindex: "0" }, f.details);
      body.appendChild(desc);
    }
    if (f.references.length) {
      body.appendChild(h("div", { class: "section-title" }, "References"));
      var refs = h("ul", { class: "refs" });
      f.references.slice(0, 20).forEach(function (ref) { refs.appendChild(h("li", null, h("span", { class: "type" }, ref.type), external(ref.url))); });
      body.appendChild(refs);
    }
    var advice = index.advice[f.packageKey];
    body.appendChild(h("div", { class: "factions" },
      advice ? button("Show Remediation", { kind: "small", icon: "wrench", onclick: function () { showAdvice(f.packageKey); } }) : null,
      button("Copy ID", { kind: "ghost small", icon: "copy", onclick: function () { post({ type: "copy", text: v.cves[0] || f.id, label: v.cves[0] || f.id }); } }),
      v.locations[0] ? button("Open Manifest", { kind: "ghost small", icon: "go-to-file", onclick: function () { post({ type: "openFile", file: v.locations[0].file, line: v.locations[0].line || 0 }); } }) : null));
    return body;
  }

  function showAdvice(packageKey) {
    ui.fixQ = "";
    persist();
    renderFixesPanel();
    selectTab("fixes");
    var card = document.querySelector('.fix-card[data-key="' + cssEscape(packageKey) + '"]');
    if (card) { card.scrollIntoView({ block: "start" }); var focusable = card.querySelector("button"); if (focusable) focusable.focus(); }
  }
  function cssEscape(value) { return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"); }

  // ------------------------------------------------------------------ remediation
  function renderFixesPanel() {
    var panel = slots.panels && slots.panels.fixes;
    if (!panel) return;
    clear(panel);
    var r = model.result;
    var list = r.advice.slice().sort(function (a, b) { return (index.worst[a.packageKey] || 0) - (index.worst[b.packageKey] || 0) || a.packageName.localeCompare(b.packageName); });
    panel.appendChild(h("div", { class: "filters" },
      searchBox("fixSearch", "Filter by package  ( / )", ui.fixQ, function (v) { ui.fixQ = v; persist(); renderFixList(list); }),
      h("span", { class: "spacer" }),
      h("span", { class: "note" }, "Edits are previewed as a diff and applied only after you confirm. Lockfiles are left to your package manager.")));
    slots.fixList = h("div");
    panel.appendChild(slots.fixList);
    renderFixList(list);
  }

  function renderFixList(list) {
    clear(slots.fixList);
    var q = ui.fixQ.toLowerCase().trim();
    var shown = list.filter(function (a) { return !q || a.packageName.toLowerCase().indexOf(q) !== -1; });
    if (!list.length) {
      slots.fixList.appendChild(h("div", { class: "empty" }, icon("pass-filled", "big"), h("h2", null, "Nothing to fix"), h("p", null, "No dependency has a vulnerability with remediation to suggest.")));
      return;
    }
    inChunks("fixes", shown, function (a) { slots.fixList.appendChild(adviceCard(a)); });
  }

  function adviceCard(a) {
    var pkg = index.packages[a.packageKey];
    var vulns = model.result.vulnerabilities.filter(function (v) { return v.finding.packageKey === a.packageKey; });
    var worst = vulns.reduce(function (w, v) { return SEVERITIES.indexOf(v.severity) < SEVERITIES.indexOf(w) ? v.severity : w; }, "unknown");
    var card = h("div", { class: "fix-card", "data-key": a.packageKey });
    card.appendChild(h("div", { class: "head" },
      h("span", { class: "pill " + worst }, SEV_LABEL[worst]),
      vulns.some(function (v) { return v.kev; }) ? h("span", { class: "badge kev" }, icon("flame"), " Exploited") : null,
      h("b", null, a.packageName), h("span", { class: "mono" }, a.installedVersion || "?"),
      a.target ? [h("span", { class: "arrow", "aria-hidden": "true" }, "→"), h("b", { class: "mono" }, a.target)] : h("span", { class: "badge nofix" }, "no fixed version"),
      a.targetVerified === "clean" ? h("span", { class: "verified", title: "OSV has no advisory for this version" }, icon("verified"), "verified clean") : null,
      a.targetVerified === "vulnerable" ? h("span", { class: "unverified", title: "OSV still lists advisories for this version" }, icon("warning"), "still has advisories") : null,
      h("span", { class: "note" }, plural(vulns.length, "advisory", "advisories") + " · " + a.ecosystem + (pkg && pkg.direct === false ? " · transitive" : pkg && pkg.direct ? " · direct" : ""))));
    card.appendChild(h("p", { class: "note", style: "margin:6px 0 0" }, a.controlledBy));
    a.options.forEach(function (o) { card.appendChild(optionBlock(o)); });
    if (a.notes.length) {
      var notes = h("ul", { class: "guidance" });
      a.notes.forEach(function (n) { notes.appendChild(h("li", null, n)); });
      card.appendChild(notes);
    }
    return card;
  }

  function optionBlock(o) {
    var applied = model.applied[o.id];
    var block = h("div", { class: "option" },
      h("div", { class: "head" }, h("span", { class: "risk " + o.risk, title: "Breaking-change risk" }, o.risk === "unknown" ? "risk: check" : o.risk + " risk"), o.title),
      h("p", null, o.detail));
    if (o.edit) {
      block.appendChild(h("div", { class: "edit" }, icon("edit"), " ", o.editSummary || o.edit.file));
      block.appendChild(h("div", { class: "factions" },
        button("Preview Change", { kind: "ghost small", icon: "diff", onclick: function () { post({ type: "preview", option: o.id }); } }),
        button(applied ? "Applied" : "Apply…", { kind: "small", icon: applied ? "check" : "tools", disabled: applied || !model.workspace.trusted, title: model.workspace.trusted ? "Asks for confirmation, then changes and saves only this file" : "Trust the workspace to apply changes", onclick: function () { post({ type: "apply", option: o.id }); } }),
        button("Open File", { kind: "ghost small", icon: "go-to-file", onclick: function () { post({ type: "openFile", file: o.edit.file, line: 0 }); } })));
    }
    (o.commands || []).forEach(function (c) {
      block.appendChild(h("div", { class: "cmd" }, h("code", null, c.command), c.cwd ? h("span", { class: "cwd" }, "in " + c.cwd) : null,
        button("Copy", { kind: "ghost small", icon: "copy", onclick: function () { post({ type: "copy", text: c.command, label: "the command" }); } }),
        button("Run…", { kind: "ghost small", icon: "terminal", title: "Asks for confirmation, then runs it in a terminal", onclick: function () { post({ type: "runCommand", command: c.command, cwd: c.cwd }); } })));
    });
    return block;
  }

  // ------------------------------------------------------------------ health
  function renderHealthPanel() {
    var panel = slots.panels && slots.panels.health;
    if (!panel) return;
    clear(panel);
    var r = model.result;
    var hf = ui.health;
    var facets = M.facets(r);
    var update = function (key) { return function (value) { hf[key] = value; persist(); renderHealthPanel(); }; };
    var registries = r.providers.filter(function (p) { return p.id === "registries"; })[0];
    panel.appendChild(h("p", { class: "note", style: "margin:12px 0 0" }, "Deprecated, yanked, abandoned and inactive packages are maintenance risks; outdated packages are informational. None of these is a vulnerability by itself. " + (registries ? registries.message : "")));
    panel.appendChild(h("div", { class: "filters" },
      searchBox("healthSearch", "Filter by package  ( / )", hf.q, function (v) { hf.q = v; persist(); renderHealthTable(); }),
      select("healthKind", "Kind", hf.kind, [["all", "All findings"], ["risks", "Maintenance risks"], ["deprecated", "Deprecated"], ["yanked", "Yanked / retracted"], ["abandoned", "Abandoned"], ["inactive", "Inactive"], ["outdated", "Outdated"]], update("kind")),
      select("healthEco", "Ecosystem", hf.eco, [["all", "All ecosystems"]].concat(facets.ecosystems.map(function (e) { return [e, e]; })), update("eco")),
      select("healthRelation", "Direct or transitive", hf.relation, [["all", "Direct and transitive"], ["direct", "Direct only"], ["transitive", "Transitive only"]], update("relation"))));
    slots.healthTable = h("div");
    panel.appendChild(slots.healthTable);
    renderHealthTable();
  }

  function renderHealthTable() {
    clear(slots.healthTable);
    var r = model.result;
    var rows = M.filterHealth(r.health, ui.health);
    if (!r.health.length) {
      var off = r.providers.some(function (p) { return p.id === "registries" && p.status === "off"; });
      slots.healthTable.appendChild(h("div", { class: "empty" }, icon(off ? "circle-slash" : "pass-filled", "big"), h("h2", null, off ? "Health checks are off" : "No health findings"),
        h("p", null, off ? "Turn on devsnip.sca.healthChecks to check for deprecated, yanked and outdated packages." : "Every checked dependency is on its latest release and none is deprecated, yanked or abandoned."),
        off ? h("div", { class: "actions" }, button("Open Settings", { kind: "ghost", icon: "settings-gear", onclick: function () { post({ type: "settings" }); } })) : null));
      return;
    }
    var table = h("table", { class: "grid" }, h("thead", null, h("tr", null, ["Package", "Installed", "Latest", "Finding", "Details", "Relation"].map(function (c) { return h("th", { scope: "col" }, c); }))));
    var tbody = h("tbody");
    table.appendChild(tbody);
    slots.healthTable.appendChild(h("div", { class: "result-count" }, fmt(rows.length) + " of " + plural(r.health.length, "finding")));
    slots.healthTable.appendChild(h("div", { class: "table-wrap" }, table));
    inChunks("health", rows, function (x) {
      tbody.appendChild(h("tr", null,
        h("td", null, external(x.page, x.packageName), h("div", { class: "note" }, x.ecosystem)),
        h("td", { class: "mono" }, x.installedVersion),
        h("td", { class: "mono" }, x.latest || "—"),
        h("td", null, h("span", { class: "badge " + (x.class === "risk" ? "risk" : "") }, KIND_LABEL[x.kind] + (x.level ? " · " + x.level : ""))),
        h("td", null, x.message, x.locations[0] ? h("div", null, fileLink(x.locations[0])) : null),
        h("td", null, x.relation)));
    });
  }

  // ------------------------------------------------------------------ dependencies
  function renderDepsPanel() {
    var panel = slots.panels && slots.panels.deps;
    if (!panel) return;
    clear(panel);
    var r = model.result;
    var d = ui.deps;
    var facets = M.facets(r);
    var update = function (key) { return function (value) { d[key] = value; persist(); renderDepsPanel(); }; };
    panel.appendChild(h("div", { class: "filters" },
      searchBox("depSearch", "Filter by package or version  ( / )", d.q, function (v) { d.q = v; persist(); renderDepsTable(); }),
      select("depStatus", "Status", d.status, [["all", "All statuses"], ["vulnerable", "Vulnerable"], ["potential", "Potentially affected"], ["clean", "No known issues"], ["unanalyzed", "Not analysed"]], update("status")),
      select("depRelation", "Direct or transitive", d.relation, [["all", "Direct and transitive"], ["direct", "Direct only"], ["transitive", "Transitive only"], ["unknown", "Relation unknown"]], update("relation")),
      select("depEco", "Ecosystem", d.eco, [["all", "All ecosystems"]].concat(facets.ecosystems.map(function (e) { return [e, e]; })), update("eco"))));
    slots.depsTable = h("div");
    panel.appendChild(slots.depsTable);
    renderDepsTable();
  }

  function renderDepsTable() {
    clear(slots.depsTable);
    var r = model.result;
    var rows = M.filterPackages(r.scan.packages, ui.deps);
    slots.depsTable.appendChild(h("div", { class: "result-count" }, fmt(rows.length) + " of " + plural(r.scan.packages.length, "dependency", "dependencies")));
    if (!rows.length) { slots.depsTable.appendChild(h("div", { class: "empty" }, icon("filter", "big"), h("h2", null, "Nothing matches the filters"))); return; }
    var table = h("table", { class: "grid" }, h("thead", null, h("tr", null, ["Package", "Version", "Ecosystem", "Relation", "Status", "Where"].map(function (c) { return h("th", { scope: "col" }, c); }))));
    var tbody = h("tbody");
    table.appendChild(tbody);
    slots.depsTable.appendChild(h("div", { class: "table-wrap" }, table));
    inChunks("deps", rows, function (p) {
      var occ = p.occurrences[0];
      var via = p.occurrences.filter(function (o) { return o.via && o.via.length; })[0];
      tbody.appendChild(h("tr", null,
        h("td", null, h("b", null, p.name), p.devOnly ? h("span", { class: "badge dev", style: "margin-left:6px" }, "dev") : null,
          via ? h("div", { class: "note", style: "overflow-wrap:anywhere" }, "via " + via.via.join(" → ")) : null),
        h("td", { class: "mono" }, p.version || (p.specs.length ? p.specs.join(", ") : "unknown")),
        h("td", null, p.ecosystem),
        h("td", null, p.direct === true ? "direct" : p.direct === false ? "transitive" : "unknown"),
        h("td", null, h("span", { class: "status " + p.status }, STATUS_LABEL[p.status] || p.status),
          p.status === "unanalyzed" && p.skipReason ? h("div", { class: "note" }, SKIP_LABEL[p.skipReason] || p.skipReason) : null,
          p.note ? h("div", { class: "note" }, p.note) : null,
          p.findingIds.length ? h("div", null, h("a", { href: "#", onclick: function (e) { e.preventDefault(); ui.filters = Object.assign({}, M.DEFAULT_FILTERS, { q: p.name }); persist(); refreshCardsAndVulns(); selectTab("vulns"); } }, plural(p.findingIds.length, "advisory", "advisories"))) : null),
        h("td", null, occ ? fileLink({ file: occ.file, line: occ.line }) : "—", p.occurrences.length > 1 ? h("span", { class: "note" }, " +" + (p.occurrences.length - 1)) : null)));
    });
  }

  // ------------------------------------------------------------------ sources & notes
  function renderNotesPanel() {
    var panel = slots.panels && slots.panels.notes;
    if (!panel) return;
    clear(panel);
    var r = model.result;
    panel.appendChild(h("div", { class: "section-title" }, "Advisory sources and resolvers"));
    var providers = h("div");
    r.providers.forEach(function (p) {
      providers.appendChild(h("div", { class: "provider" }, h("span", { class: "codicon codicon-" + (PROVIDER_ICON[p.status] || "info") + " " + p.status, "aria-hidden": "true" }),
        h("b", null, p.name + " · " + p.status), h("div", { class: "msg" }, p.message)));
    });
    panel.appendChild(providers);
    panel.appendChild(h("p", { class: "note" }, "GitHub Security Advisories (GHSA) reach the scan through OSV.dev, which imports the GitHub Advisory Database; NVD is used only to score CVEs OSV publishes no severity for."));
    var unsupported = r.scan.unsupportedFiles || [];
    if (unsupported.length) {
      panel.appendChild(h("div", { class: "section-title", id: "unsupportedFiles" }, "Unsupported dependency files (not checked)"));
      var un = h("ul", { class: "notes" });
      unsupported.forEach(function (u) { un.appendChild(h("li", null, fileLink({ file: u.path }), " · " + u.format)); });
      panel.appendChild(un);
    }
    if (r.diagnostics) panel.appendChild(diagnosticsBlock(r.diagnostics));
    if (r.limitations.length) {
      panel.appendChild(h("div", { class: "section-title" }, "Limitations of this scan"));
      var ul = h("ul", { class: "notes" });
      r.limitations.forEach(function (l) { ul.appendChild(h("li", null, l)); });
      panel.appendChild(ul);
    }
    if (r.scan.errors.length) {
      panel.appendChild(h("div", { class: "section-title" }, "Errors"));
      var errs = h("ul", { class: "notes" });
      r.scan.errors.forEach(function (e) { errs.appendChild(h("li", null, e)); });
      panel.appendChild(errs);
    }
    var builds = r.scan.diagnostics.buildTools || [];
    if (builds.length) {
      panel.appendChild(h("div", { class: "section-title" }, "Maven and Gradle resolution"));
      var bt = h("ul", { class: "notes" });
      builds.forEach(function (b) { bt.appendChild(h("li", null, b.tool + " · " + (b.project || "(root)") + ": " + (b.method === "build-tool" ? "resolved by " + b.tool : b.tool === "Maven" ? "built-in resolver" : "read from build scripts") + ", " + plural(b.dependencies, "dependency", "dependencies") + (b.unresolved ? ", " + b.unresolved + " unresolved" : "") + (b.detail ? ". " + b.detail : ""))); });
      panel.appendChild(bt);
    }
    panel.appendChild(h("div", { class: "section-title" }, "Files scanned"));
    var files = h("ul", { class: "notes" });
    r.scan.files.forEach(function (f) {
      files.appendChild(h("li", null, fileLink({ file: f.path }), " · " + f.ecosystem + " " + (f.kind || "") + (f.resolvedBy ? " (" + f.resolvedBy + ")" : "") + (f.packages !== undefined ? " · " + plural(f.packages, "dependency", "dependencies") : "") + (f.error ? " · " + f.error : "")));
    });
    panel.appendChild(files);
  }

  function diagnosticsBlock(dg) {
    var wrap = h("div");
    wrap.appendChild(h("div", { class: "section-title" }, "Scan diagnostics"));
    var kv = h("dl", { class: "kv" });
    function row(label, value) { kv.appendChild(h("dt", null, label)); kv.appendChild(h("dd", null, value)); }
    var deps = dg.dependencies, adv = dg.advisories, files = dg.files;
    row("Status", dg.status + (dg.incompleteReasons.length ? " — " + dg.incompleteReasons.join("; ") : ""));
    row("Projects", dg.projects.map(function (p) { return (p.dir || "(root)") + " (" + p.ecosystems.join(", ") + (p.managers.length ? "; " + p.managers.join(", ") : "") + (p.springBoot ? "; Spring Boot " + p.springBoot : "") + ")"; }).join(" · ") || "none");
    row("Files", fmt(files.scanned) + " scanned, " + fmt(files.failed.length) + " unreadable, " + fmt(files.unsupported.length) + " unsupported, " + fmt(files.leftOutAsBuildOutput) + " left out as build output or vendored");
    row("Dependencies", fmt(deps.discovered) + " discovered: " + fmt(deps.withVersion) + " with an exact version, " + fmt(deps.rangeOnly) + " range only, " + fmt(deps.unresolved) + " unresolved, " + fmt(deps.outOfScope) + " out of scope, " + fmt(deps.failed) + " failed");
    row("Relation", fmt(deps.direct) + " direct, " + fmt(deps.transitive) + " transitive, " + fmt(deps.relationUnknown) + " unknown");
    row("Build tools", dg.buildTools.length ? dg.buildTools.map(function (b) { return b.tool + " " + (b.project || "(root)") + ": " + (b.method === "build-tool" ? "resolved by " + b.tool : "built-in") + ", " + b.dependencies + " dependencies" + (b.unresolved ? ", " + b.unresolved + " unresolved" : "") + (b.problem ? " — " + b.problem : ""); }).join(" · ") : "none");
    row("Advisories", fmt(adv.packagesChecked) + " packages checked with OSV (" + fmt(adv.packagesFromCache) + " cached), " + fmt(adv.references) + " references, " + fmt(adv.unique) + " unique advisories, " + fmt(adv.aliasesMerged) + " aliases merged, " + fmt(adv.withdrawnDropped) + " withdrawn, " + fmt(adv.outOfRangeDropped) + " out of range, " + fmt(adv.findings) + " findings" + (adv.recordsFailed ? ", " + adv.recordsFailed + " records failed" : ""));
    if (dg.errors.length) row("Errors", dg.errors.join(" · "));
    row("Timings", Object.keys(dg.timings).map(function (k) { return k + " " + (dg.timings[k] / 1000).toFixed(1) + " s"; }).join(", "));
    wrap.appendChild(kv);
    return wrap;
  }

  // ------------------------------------------------------------------ messages
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || typeof m !== "object") return;
    switch (m.type) {
      case "init":
        model.workspace = m.workspace || model.workspace;
        model.settings = m.settings || {};
        model.projects = m.projects || null;
        model.result = m.result || null;
        model.running = m.running || null;
        model.progress = m.progress || null;
        model.error = m.error || null;
        buildIndex();
        renderAll();
        return;
      case "detecting":
        model.detecting = true;
        renderProjects();
        return;
      case "projects":
        model.detecting = false;
        model.projects = m.projects || [];
        renderProjects();
        if (m.error) toast("Projects could not be detected: " + m.error, "error");
        return;
      case "settings":
        model.settings = m.settings || model.settings;
        renderHeader();
        return;
      case "started":
        model.running = { label: m.label };
        model.progress = m.progress;
        model.error = null;
        model.cancelled = false;
        renderHeader(); renderProjects(); renderStatus();
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
        model.applied = {};
        buildIndex();
        renderAll();
        var s = m.result.summary;
        if (m.result.status === "cancelled") toast("Scan cancelled; showing partial results.");
        else if (m.result.scan.summary.files === 0) toast("No dependency files found.");
        else toast(s.vulnerableDependencies ? plural(s.vulnerableDependencies, "vulnerable dependency", "vulnerable dependencies") + (s.exploited ? ", " + s.exploited + " known exploited" : "") + "." : "No known vulnerabilities in " + plural(s.dependencies, "dependency", "dependencies") + ".", s.vulnerableDependencies ? "" : "ok");
        return;
      case "applied":
        model.applied[m.option] = true;
        if (slots.panels) renderFixesPanel();
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
      var ids = { vulns: "vulnSearch", fixes: "fixSearch", health: "healthSearch", deps: "depSearch" };
      var target = document.getElementById(ids[ui.tab] || "vulnSearch");
      if (target) { e.preventDefault(); target.focus(); target.select(); }
    }
  });

  post({ type: "ready" });
})();
