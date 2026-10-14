/* DevSnip Pro - CSV & Excel Viewer webview.
 *
 * A virtualised grid: only the rows and columns on screen are in the DOM, so
 * sheets with hundreds of thousands of rows scroll smoothly. It is read-only
 * until Edit is pressed. The host parses files, owns the edits (VS Code's
 * save, undo and dirty state run through it) and the clipboard, file dialogs
 * and new editors; this page asks for them through call(method, params) and
 * applies the patches the host sends back.
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();
  var root = document.getElementById("app");
  var MAC = document.body.getAttribute("data-platform") === "darwin";
  var MOD = MAC ? "⌘" : "Ctrl+";
  // Key handling and column naming rules (media/spreadsheet-editing.js).
  var E = window.SheetEditing;
  var ROW_H = 24;
  var HEAD_H_NAMES = 44;
  var HEAD_H_LETTERS = 26;
  var OVERSCAN_ROWS = 8;
  var OVERSCAN_PX = 240;
  var DELIMITER_NAMES = { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" };

  // ------------------------------------------------------------------ RPC
  var seq = 0;
  var pending = new Map();
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      vscode.postMessage({ type: "rpc", id: id, method: method, params: params || {} });
    });
  }
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "rpc") {
      var p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else {
        var err = new Error((m.error && m.error.message) || "Request failed.");
        err.hint = m.error && m.error.hint;
        p.reject(err);
      }
    } else if (m.type === "changed") {
      toast("info", "Reloaded: the file changed on disk.");
    } else if (m.type === "reset") {
      onReset();
    } else if (m.type === "patch") {
      applyPatch(m.patch);
    } else if (m.type === "dirty") {
      state.dirty = !!m.dirty;
      if (!state.dirty && state.changed.size) { state.changed.clear(); scheduleRender(true); }
      renderEditState();
    } else if (m.type === "changedOnDisk") {
      toast("info", "The file changed on disk.", "Your unsaved edits are kept. Saving asks before overwriting; Reload from disk discards your edits.");
    }
  });

  // ------------------------------------------------------------------ DOM helpers
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      for (var key in props) {
        var v = props[key];
        if (v === undefined || v === null || v === false) continue;
        if (key === "class") el.className = v;
        else if (key === "text") el.textContent = v;
        else if (key === "style") { for (var s in v) { if (s.indexOf("--") === 0) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; } }
        else if (key.indexOf("on") === 0 && typeof v === "function") el.addEventListener(key.slice(2).toLowerCase(), v);
        else if (key === "value") el.value = v;
        else if (key === "checked" || key === "disabled" || key === "selected") el[key] = !!v;
        else el.setAttribute(key, v === true ? "" : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  function icon(name, cls) { return h("span", { class: "codicon codicon-" + name + (cls ? " " + cls : ""), "aria-hidden": "true" }); }
  function iconBtn(name, title, onClick, extra) {
    var b = h("button", Object.assign({ class: "icon-btn", title: title, "aria-label": title, type: "button" }, extra || {}), icon(name));
    b.addEventListener("click", function (e) { e.stopPropagation(); onClick(e); });
    return b;
  }
  function btn(label, iconName, onClick, cls, extra) {
    var b = h("button", Object.assign({ class: "btn " + (cls || ""), type: "button" }, extra || {}), iconName ? icon(iconName) : null, label);
    if (onClick) b.addEventListener("click", function (e) { e.stopPropagation(); onClick(e); });
    return b;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function fmtNum(n) { return typeof n === "number" ? n.toLocaleString() : String(n); }
  function plural(n, word) { return fmtNum(n) + " " + word + (n === 1 ? "" : "s"); }
  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function fmtStat(n) {
    if (typeof n !== "number" || !isFinite(n)) return "–";
    var abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return n.toExponential(4);
    return Number(n.toPrecision(12)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  function timeAgo(at) {
    var s = Math.max(0, (Date.now() - at) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    var d = Math.floor(s / 86400);
    return d === 1 ? "yesterday" : d + " days ago";
  }
  function columnName(index) {
    var name = "";
    for (var n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  }

  function toast(kind, message, hint) {
    var box = document.getElementById("toasts");
    var t = h("div", { class: "toast " + kind, role: kind === "error" ? "alert" : "status" },
      icon(kind === "error" ? "error" : kind === "info" ? "info" : "check"),
      h("div", null, message, hint ? h("span", { class: "hint", text: hint }) : null));
    box.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 220); }, kind === "error" ? 6000 : 2600);
  }
  function fail(error) { toast("error", error.message || String(error), error.hint); }

  // ------------------------------------------------------------------ state
  var saved = vscode.getState() || {};
  var state = {
    source: "file",
    file: null,
    sheetIndex: 0,
    sheet: null,
    header: true,
    headerChosen: false,
    showFormulas: false,
    query: "",
    queryCol: -1,
    sort: null,
    widths: {},
    view: [],
    viewVersion: 0,
    sel: { r: 0, c: 0, ar: 0, ac: 0 },
    kinds: [],
    pastedText: "",
    recent: [],
    editing: false,
    dirty: false,
    // Why rows and columns can't be inserted or deleted (null: they can; undefined: not asked yet).
    lock: undefined,
    afterReload: null,
    // "row:col" of cells changed since the last save, marked in the grid.
    changed: new Set(),
    // Column whose header cell has keyboard focus (-1: a data cell has it).
    headFocus: -1,
    // A row or column edit is on its way; keys typed meanwhile wait in typeAhead instead of being lost.
    structurePending: false,
    typeAhead: ""
  };
  ["sheetIndex", "header", "headerChosen", "showFormulas", "query", "queryCol", "sort", "editing", "toldEditing"].forEach(function (k) { if (saved[k] !== undefined) state[k] = saved[k]; });
  function persist() {
    vscode.setState({ sheetIndex: state.sheetIndex, header: state.header, headerChosen: state.headerChosen, showFormulas: state.showFormulas, query: state.query, queryCol: state.queryCol, sort: state.sort, editing: state.editing, toldEditing: state.toldEditing });
  }

  // Elements of the grid screen, rebuilt by renderViewer().
  var ui = {};

  // ------------------------------------------------------------------ boot
  function boot() {
    call("init").then(function (result) {
      state.source = result.source;
      state.recent = result.recent || [];
      if (result.file) openSummary(result.file, true);
      else renderWelcome();
    }, function (error) {
      renderError(error);
    });
  }

  function openSummary(summary, restore) {
    state.file = summary;
    state.dirty = !!summary.dirty;
    if (!summary.editable) state.editing = false;
    if (!restore || state.sheetIndex >= summary.sheets.length) state.sheetIndex = firstVisibleSheet(summary);
    renderViewer();
    return loadSheet(state.sheetIndex, restore);
  }

  function firstVisibleSheet(summary) {
    for (var i = 0; i < summary.sheets.length; i++) if (!summary.sheets[i].hidden) return i;
    return 0;
  }

  /** quiet: a reload after a row or column edit, which keeps the grid usable instead of greying it out. */
  function loadSheet(index, keepPosition, quiet) {
    state.sheetIndex = index;
    persist();
    if (!quiet) showLoading("Reading " + (state.file.sheets[index] ? state.file.sheets[index].name : "sheet") + "…");
    renderTabs();
    return call("sheet", { index: index }).then(function (sheet) {
      var scroll = keepPosition && ui.scroller ? { top: ui.scroller.scrollTop, left: ui.scroller.scrollLeft } : null;
      setSheet(sheet, keepPosition);
      hideLoading();
      if (scroll) { ui.scroller.scrollTop = scroll.top; ui.scroller.scrollLeft = scroll.left; scheduleRender(true); }
      var after = state.afterReload;
      state.afterReload = null;
      if (after) after();
      finishStructure();
    }, function (error) {
      hideLoading();
      finishStructure();
      renderGridError(error);
    });
  }

  /** Reload from disk (asks first when there are unsaved edits); the host then sends "reset". */
  function reloadFromDisk() {
    if (state.source !== "file" || !state.file) return;
    call("revert").catch(fail);
  }

  /** The host re-read the file (revert, or a change on disk): show it again, keeping the place. */
  function onReset() {
    if (state.source !== "file" || !state.file) return;
    cancelEdit();
    state.changed.clear();
    call("reload").then(function (summary) {
      var sameSheet = state.file.sheets[state.sheetIndex] && summary.sheets[state.sheetIndex] && state.file.sheets[state.sheetIndex].name === summary.sheets[state.sheetIndex].name;
      state.file = summary;
      state.dirty = !!summary.dirty;
      state.lock = undefined;
      if (!summary.editable) state.editing = false;
      if (!sameSheet) state.sheetIndex = firstVisibleSheet(summary);
      renderMeta();
      renderEditState();
      return loadSheet(state.sheetIndex, true);
    }, fail);
  }

  // ------------------------------------------------------------------ sheet model
  function setSheet(sheet, keepPosition) {
    state.sheet = sheet;
    if (!state.headerChosen) state.header = looksLikeHeader(sheet);
    if (!state.widths[state.sheetIndex]) state.widths[state.sheetIndex] = [];
    if (state.sort && state.sort.col >= columnCount()) state.sort = null;
    if (state.queryCol >= columnCount()) state.queryCol = -1;
    state.kinds = inferKinds();
    rebuildView();
    autoSizeColumns(false);
    if (!keepPosition) {
      state.sel = { r: 0, c: 0, ar: 0, ac: 0 };
      if (ui.scroller) { ui.scroller.scrollTop = 0; ui.scroller.scrollLeft = 0; }
    } else clampSelection();
    renderToolbarState();
    renderBanner();
    renderEditState();
    layoutGrid();
    renderStatus();
  }

  function columnCount() { return state.sheet ? Math.max(1, state.sheet.columnCount) : 1; }
  function dataStart() { return state.header && state.sheet && state.sheet.rows.length > 0 ? 1 : 0; }

  function looksLikeHeader(sheet) {
    var first = sheet.rows[0];
    if (!first || !first.length || sheet.rows.length < 2) return false;
    var filled = 0, texts = 0;
    for (var i = 0; i < first.length; i++) {
      var v = first[i];
      if (v === null || v === undefined || v === "") continue;
      filled++;
      if (typeof v === "string" && numOf(v) === null && !/^\d{4}-\d{2}-\d{2}/.test(v)) texts++;
    }
    return filled > 0 && texts === filled && filled >= Math.min(first.length, sheet.columnCount) * 0.5;
  }

  function rawAt(row, col) {
    var r = state.sheet.rows[row];
    if (!r) return null;
    var v = r[col];
    return v === undefined ? null : v;
  }

  /** What a cell shows: its formula when formulas are on (unless valueOnly), else its formatted value. */
  function cellText(row, col, valueOnly) {
    var sheet = state.sheet;
    var key = row + ":" + col;
    if (state.showFormulas && !valueOnly && sheet.formulas && sheet.formulas[key] !== undefined) return "=" + sheet.formulas[key];
    if (sheet.display && sheet.display[key] !== undefined) return sheet.display[key];
    var v = rawAt(row, col);
    // A formula nobody has calculated yet (typed here, or never opened in Excel) shows itself.
    if (v === null) return sheet.formulas && sheet.formulas[key] !== undefined ? "=" + sheet.formulas[key] : "";
    if (v === true) return "TRUE";
    if (v === false) return "FALSE";
    return String(v);
  }

  var NUMERIC = /^\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?\s*$/;
  function numOf(v) {
    if (typeof v === "number") return v;
    if (typeof v !== "string" || !v || !/\d/.test(v) || !NUMERIC.test(v)) return null;
    var n = parseFloat(v.replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  function inferKinds() {
    var kinds = [];
    var n = columnCount();
    var rows = state.sheet.rows;
    var start = dataStart();
    var end = Math.min(rows.length, start + 3000);
    for (var c = 0; c < n; c++) {
      var counts = { number: 0, date: 0, bool: 0, text: 0 }, filled = 0;
      for (var r = start; r < end; r++) {
        var v = rows[r] ? rows[r][c] : null;
        if (v === null || v === undefined || v === "") continue;
        filled++;
        if (typeof v === "boolean" || (typeof v === "string" && /^(true|false)$/i.test(v))) counts.bool++;
        else if (numOf(v) !== null) counts.number++;
        else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?|^\d{1,2}:\d{2}(?::\d{2})?$/.test(v)) counts.date++;
        else counts.text++;
      }
      var kind = "empty";
      if (filled) {
        kind = "mixed";
        for (var k in counts) if (counts[k] / filled >= 0.8) kind = k;
      }
      kinds.push(kind);
    }
    return kinds;
  }

  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  function rebuildView() {
    var rows = state.sheet.rows;
    var start = dataStart();
    var q = state.query.trim().toLowerCase();
    var n = columnCount();
    var view = [];
    for (var r = start; r < rows.length; r++) {
      if (q) {
        var hit = false;
        if (state.queryCol >= 0) hit = cellText(r, state.queryCol).toLowerCase().indexOf(q) !== -1;
        else for (var c = 0; c < n && !hit; c++) hit = cellText(r, c).toLowerCase().indexOf(q) !== -1;
        if (!hit) continue;
      }
      view.push(r);
    }
    if (state.sort) {
      var col = state.sort.col;
      var dir = state.sort.dir === "desc" ? -1 : 1;
      var keys = new Map();
      view.forEach(function (r) {
        var v = rawAt(r, col);
        var num = numOf(v);
        keys.set(r, v === null || v === "" ? { empty: true } : num !== null ? { num: num } : { text: typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v) });
      });
      view.sort(function (a, b) {
        var ka = keys.get(a), kb = keys.get(b);
        // Empty cells always sink to the bottom, whichever way the column is sorted.
        if (ka.empty || kb.empty) return ka.empty && kb.empty ? a - b : ka.empty ? 1 : -1;
        var d;
        if (ka.num !== undefined && kb.num !== undefined) d = ka.num - kb.num;
        else if (ka.num !== undefined) d = -1;
        else if (kb.num !== undefined) d = 1;
        else d = collator.compare(ka.text, kb.text);
        return d ? d * dir : a - b;
      });
    }
    state.view = view;
    state.viewVersion++;
    statsCache = {};
  }

  // ------------------------------------------------------------------ column geometry
  var measureCtx = null;
  function measure(text) {
    if (!measureCtx) {
      measureCtx = document.createElement("canvas").getContext("2d");
      var cs = getComputedStyle(document.body);
      measureCtx.font = "12.5px " + cs.fontFamily;
    }
    return measureCtx.measureText(text).width;
  }

  function widths() { return state.widths[state.sheetIndex] || (state.widths[state.sheetIndex] = []); }

  function autoSizeColumns(force, onlyCol) {
    var w = widths();
    var n = columnCount();
    var sample = state.view.slice(0, onlyCol === undefined ? 300 : 2000);
    for (var c = 0; c < n; c++) {
      if (onlyCol !== undefined && c !== onlyCol) continue;
      if (w[c] && !force) continue;
      var best = measure(headerLabel(c)) + 46;
      for (var i = 0; i < sample.length; i++) {
        var t = cellText(sample[i], c);
        if (t.length > 80) t = t.slice(0, 80);
        var width = measure(t) + 22;
        if (width > best) best = width;
      }
      w[c] = Math.round(Math.max(64, Math.min(onlyCol === undefined ? 360 : 640, best)));
    }
  }

  function headerLabel(c) {
    if (!state.header || !state.sheet || !state.sheet.rows[0]) return "";
    return cellText(0, c);
  }

  var geo = { lefts: [], total: 0, rn: 48, head: HEAD_H_NAMES };
  function computeGeometry() {
    var w = widths();
    var n = columnCount();
    var lefts = new Array(n + 1);
    var x = 0;
    for (var c = 0; c < n; c++) { lefts[c] = x; x += w[c] || 120; }
    lefts[n] = x;
    var maxRow = state.sheet ? state.sheet.rows.length : 1;
    geo = { lefts: lefts, total: x, rn: Math.max(44, String(maxRow).length * 8 + 22), head: state.header ? HEAD_H_NAMES : HEAD_H_LETTERS };
  }

  function colAt(x) {
    var lefts = geo.lefts, lo = 0, hi = lefts.length - 2;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (lefts[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  // ------------------------------------------------------------------ welcome
  function renderWelcome() {
    state.file = null;
    state.sheet = null;
    ui = {};
    clear(root).removeAttribute("aria-busy");
    var recent = state.recent.length
      ? h("section", { class: "card" },
        h("h2", null, icon("history"), "Recent files"),
        h("ul", { class: "recent" }, state.recent.map(function (r) {
          var item = h("li", null,
            h("button", { class: "recent-open", type: "button", title: r.uri, onClick: function () { call("openRecent", { uri: r.uri }).catch(function (e) { fail(e); refreshRecent(); }); } },
              icon(r.format === "xlsx" ? "table" : "file"),
              h("span", { class: "grow" }, h("span", { class: "recent-name", text: r.name }), h("span", { class: "muted small", text: r.folder })),
              h("span", { class: "muted small", text: timeAgo(r.at) })),
            iconBtn("close", "Remove from recent", function () { call("forgetRecent", { uri: r.uri }).then(function (list) { state.recent = list; renderWelcome(); }, fail); }));
          return item;
        })))
      : null;
    var area = h("textarea", { class: "paste-area mono", placeholder: "name,email,plan\nAda,ada@example.com,pro\nLinus,linus@example.com,free", spellcheck: "false", "aria-label": "CSV or TSV text" });
    area.value = state.pastedText;
    function viewPasted() {
      state.pastedText = area.value;
      call("paste", { text: area.value }).then(function (summary) {
        state.headerChosen = false; state.sort = null; state.query = ""; state.queryCol = -1; state.widths = {};
        openSummary(summary, false);
      }, fail);
    }
    area.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); viewPasted(); } });
    root.appendChild(h("div", { class: "welcome" },
      h("div", { class: "hero" },
        h("div", { class: "hero-icon" }, icon("table")),
        h("h1", null, "CSV & Excel Viewer"),
        h("p", { class: "muted" }, "Open .csv, .tsv and .xlsx files as a fast grid you can search, sort and export. Press Edit to change cells, rows and columns and save; macros never run."),
        h("div", { class: "hero-actions" },
          btn("Open CSV / TSV…", "file", function () { call("open", { format: "csv" }).catch(fail); }, "primary"),
          btn("Open Excel workbook…", "table", function () { call("open", { format: "xlsx" }).catch(fail); }))),
      recent,
      h("section", { class: "card" },
        h("h2", null, icon("clippy"), "Paste CSV or TSV"),
        area,
        h("div", { class: "row-actions" }, h("span", { class: "muted small", text: "Separator is detected. " + MOD + "Enter to view." }), btn("View as table", "play", viewPasted, "primary"))),
      h("section", { class: "tips muted" },
        h("div", null, icon("lightbulb"), h("span", null, "Right-click a .csv, .tsv or .xlsx file in the Explorer and choose ", h("b", null, "Open in CSV & Excel Viewer"), ".")),
        h("div", null, icon("lightbulb"), h("span", null, "Excel workbooks open here when you click them. For CSV files use ", h("b", null, "Open With…"), " or the table button in the editor title bar.")))));
  }

  function refreshRecent() {
    call("init").then(function (result) { state.recent = result.recent || []; if (!state.file) renderWelcome(); }, function () {});
  }

  function renderError(error) {
    clear(root).removeAttribute("aria-busy");
    root.appendChild(h("div", { class: "welcome" }, h("section", { class: "card error-card" },
      h("h2", null, icon("error"), error.message || "The file couldn't be opened."),
      error.hint ? h("p", { class: "muted", text: error.hint }) : null,
      h("div", { class: "row-actions" },
        btn("Try again", "refresh", function () { clear(root); boot(); }, "primary"),
        btn("Open as text", "go-to-file", function () { call("reopenAsText").catch(fail); }),
        btn("Open another file…", "folder-opened", function () { call("open", {}).catch(fail); })))));
  }

  // ------------------------------------------------------------------ viewer screen
  function renderViewer() {
    clear(root).removeAttribute("aria-busy");
    var file = state.file;
    var search = h("input", { class: "search-input", type: "search", placeholder: "Search rows", value: state.query, "aria-label": "Search rows", spellcheck: "false" });
    var scope = h("select", { class: "select scope", "aria-label": "Search in", title: "Search in" });
    var count = h("span", { class: "match-count muted small" });
    var applySearch = debounce(function () {
      state.query = search.value;
      persist();
      rebuildView();
      clampSelection();
      layoutGrid();
      renderStatus();
    }, 140);
    search.addEventListener("input", applySearch);
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && search.value) { e.preventDefault(); search.value = ""; applySearch(); }
      else if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); ui.scroller.focus(); }
    });
    scope.addEventListener("change", function () { state.queryCol = Number(scope.value); persist(); if (state.query) { rebuildView(); clampSelection(); layoutGrid(); renderStatus(); } });

    var headerToggle = h("label", { class: "toggle", title: "Use the first row as column names" }, h("input", { type: "checkbox", checked: state.header }), h("span", null, "Header row"));
    headerToggle.firstChild.addEventListener("change", function (e) {
      state.header = e.target.checked;
      state.headerChosen = true;
      persist();
      setSheet(state.sheet, true);
    });
    var formulaToggle = h("label", { class: "toggle", title: "Show formulas instead of their values" }, h("input", { type: "checkbox", checked: state.showFormulas }), h("span", null, "Formulas"));
    formulaToggle.firstChild.addEventListener("change", function (e) { setFormulas(e.target.checked); });

    var delimiter = h("select", { class: "select", "aria-label": "Separator", title: "Separator" },
      [",", ";", "\t", "|"].map(function (d) { return h("option", { value: d, text: DELIMITER_NAMES[d], selected: file.delimiter === d }); }));
    delimiter.addEventListener("change", function () {
      showLoading("Re-reading with " + DELIMITER_NAMES[delimiter.value].toLowerCase() + " separators…");
      call("setDelimiter", { delimiter: delimiter.value, text: state.source === "welcome" ? state.pastedText : undefined }).then(function (summary) {
        state.file = summary; state.widths = {}; state.sort = null;
        renderMeta();
        return loadSheet(0, false);
      }).catch(function (e) { hideLoading(); fail(e); });
    });

    var exportBtn = btn("Export", "export", function (e) { openMenu(e.currentTarget, exportItems()); }, "", { "aria-haspopup": "menu" });
    var editBtn = state.source === "file" ? btn("Edit", "edit", function () { setEditing(!state.editing); }, "edit-toggle") : null;
    var closeBtn = state.source === "welcome"
      ? iconBtn("close", "Close the pasted data", function () { call("clearPaste").then(function () { refreshRecent(); renderWelcome(); }, fail); })
      : null;

    var tools = h("div", { class: "tools" },
      h("div", { class: "search" }, icon("search"), search, count, scope),
      headerToggle,
      file.format === "xlsx" ? formulaToggle : null,
      file.format !== "xlsx" ? delimiter : null,
      editBtn,
      exportBtn,
      iconBtn("kebab-vertical", "More actions", function (e) { openMenu(e.currentTarget, moreItems()); }, { "aria-haspopup": "menu" }),
      closeBtn);

    var meta = h("div", { class: "file-meta" });
    var bar = h("header", { class: "toolbar" }, meta, tools);

    var sizer = h("div", { class: "sizer" });
    var head = h("div", { class: "head", role: "row" });
    var body = h("div", { class: "body", role: "rowgroup" });
    sizer.appendChild(head);
    sizer.appendChild(body);
    var scroller = h("div", { class: "scroller", tabindex: "0", role: "grid", "aria-label": file.name, "aria-readonly": "true" }, sizer);
    var banner = h("div", { class: "banner hidden", role: "note" });
    var grid = h("div", { class: "grid" }, scroller);
    var empty = h("div", { class: "grid-empty hidden" });
    grid.appendChild(empty);
    var loading = h("div", { class: "loading hidden" }, icon("loading", "codicon-modifier-spin"), h("span"));
    grid.appendChild(loading);
    var tabs = h("nav", { class: "tabs", "aria-label": "Sheets" });
    var status = h("footer", { class: "status" });
    var live = h("div", { class: "sr-only", "aria-live": "polite" });

    var editbar = renderEditBar();
    root.appendChild(h("div", { class: "viewer" }, bar, editbar.el, banner, grid, tabs, status, live));
    ui = { editBtn: editBtn, editbar: editbar, search: search, scope: scope, count: count, headerToggle: headerToggle.firstChild, formulaToggle: formulaToggle.firstChild, delimiter: delimiter, meta: meta, scroller: scroller, sizer: sizer, head: head, body: body, banner: banner, empty: empty, loading: loading, tabs: tabs, status: status, live: live };

    // The editor follows its cell while the grid scrolls; it finishes only when the cell scrolls out of sight.
    scroller.addEventListener("scroll", function () { scheduleRender(false); closeMenu(); }, { passive: true });
    scroller.addEventListener("keydown", onGridKey);
    scroller.addEventListener("mousedown", onGridMouseDown);
    scroller.addEventListener("dblclick", onGridDblClick);
    scroller.addEventListener("contextmenu", onGridContextMenu);
    new ResizeObserver(function () { scheduleRender(true); }).observe(scroller);
    renderMeta();
    renderTabs();
    renderEditState();
  }

  function renderMeta() {
    if (!ui.meta || !state.file) return;
    var f = state.file;
    var bits = [f.format.toUpperCase(), fmtBytes(f.size)];
    if (f.encoding) bits.push(f.encoding);
    clear(ui.meta).appendChild(h("div", { class: "file-title" },
      icon(f.format === "xlsx" ? "table" : "file", "file-icon"),
      h("span", { class: "file-name", text: f.name, title: f.name }),
      h("span", { class: "muted small", text: bits.join(" · ") })));
    if (ui.delimiter) ui.delimiter.value = f.delimiter || ",";
  }

  function renderToolbarState() {
    if (!ui.scope) return;
    clear(ui.scope).appendChild(h("option", { value: "-1", text: "All columns" }));
    for (var c = 0; c < columnCount(); c++) {
      var label = headerLabel(c);
      ui.scope.appendChild(h("option", { value: String(c), text: columnName(c) + (label ? " · " + (label.length > 28 ? label.slice(0, 27) + "…" : label) : ""), selected: state.queryCol === c }));
    }
    ui.scope.value = String(state.queryCol);
    ui.headerToggle.checked = state.header;
    ui.formulaToggle.checked = state.showFormulas;
    ui.formulaToggle.closest("label").classList.toggle("hidden", !(state.sheet && state.sheet.formulas));
  }

  function renderBanner() {
    var sheet = state.sheet;
    var notes = [];
    if (sheet.truncatedRows) notes.push(plural(sheet.truncatedRows, "more row") + " left out: the viewer loads up to 3 million cells so VS Code stays responsive.");
    // Quotes the CSV opens and never closes: read as literal characters so no rows vanish, and listed here.
    var issues = sheet.issues || [];
    issues.slice(0, 3).forEach(function (issue) { notes.push("Line " + fmtNum(issue.line) + " (row " + fmtNum(issue.row + 1) + "): " + issue.message); });
    if (issues.length > 3) notes.push(plural(issues.length - 3, "more line") + " with the same problem.");
    ui.banner.classList.toggle("hidden", !notes.length);
    clear(ui.banner);
    notes.forEach(function (n) { ui.banner.appendChild(h("div", null, icon("warning"), n)); });
  }

  function renderTabs() {
    if (!ui.tabs || !state.file) return;
    var sheets = state.file.sheets;
    clear(ui.tabs);
    ui.tabs.classList.toggle("hidden", state.file.format !== "xlsx");
    sheets.forEach(function (s, i) {
      var tab = h("button", { class: "tab" + (i === state.sheetIndex ? " active" : "") + (s.hidden ? " hidden-sheet" : ""), type: "button", role: "tab", "aria-selected": i === state.sheetIndex ? "true" : "false", title: s.hidden ? s.name + " (hidden in Excel)" : s.name },
        s.hidden ? icon("eye-closed") : null, s.name);
      tab.addEventListener("click", function () { if (i !== state.sheetIndex) { state.sort = null; state.query = ""; if (ui.search) ui.search.value = ""; state.queryCol = -1; state.headerChosen = false; loadSheet(i, false); } });
      ui.tabs.appendChild(tab);
    });
  }

  function showLoading(text) {
    if (!ui.loading) return;
    ui.loading.lastChild.textContent = text;
    ui.loading.classList.remove("hidden");
    // The old sheet stays visible underneath but can't be clicked or sorted until the new one arrives.
    ui.scroller.classList.add("busy");
  }
  function hideLoading() {
    if (!ui.loading) return;
    ui.loading.classList.add("hidden");
    ui.scroller.classList.remove("busy");
  }

  function renderGridError(error) {
    state.sheet = null;
    clear(ui.head); clear(ui.body);
    ui.empty.classList.remove("hidden");
    clear(ui.empty).appendChild(h("div", { class: "card error-card" },
      h("h2", null, icon("error"), error.message),
      error.hint ? h("p", { class: "muted", text: error.hint }) : null,
      h("div", { class: "row-actions" }, btn("Try again", "refresh", function () { loadSheet(state.sheetIndex, false); }, "primary"))));
    clear(ui.status);
  }

  // ------------------------------------------------------------------ grid rendering
  var rendered = { key: "" };
  var frame = 0;
  function scheduleRender(force) {
    if (force) rendered.key = "";
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = 0; renderGrid(); if (editor) repositionEditor(); });
  }

  function layoutGrid() {
    if (!state.sheet || !ui.sizer) return;
    computeGeometry();
    ui.sizer.style.width = geo.rn + geo.total + "px";
    ui.sizer.style.height = geo.head + state.view.length * ROW_H + "px";
    ui.head.style.height = geo.head + "px";
    ui.body.style.top = geo.head + "px";
    ui.body.style.height = state.view.length * ROW_H + "px";
    ui.scroller.setAttribute("aria-rowcount", String(state.view.length + 1));
    ui.scroller.setAttribute("aria-colcount", String(columnCount()));
    var empty = state.view.length === 0;
    ui.empty.classList.toggle("hidden", !empty);
    if (empty) {
      clear(ui.empty).appendChild(h("div", { class: "empty-note muted" },
        icon(state.query ? "search" : "table"),
        state.query ? "No rows contain “" + state.query + "”." : state.sheet.rows.length ? "Only the header row; there are no data rows." : "This sheet is empty."));
    }
    var count = state.view.length;
    ui.count.textContent = state.query ? fmtNum(count) + " match" + (count === 1 ? "" : "es") : "";
    scheduleRender(true);
  }

  function renderGrid() {
    if (!state.sheet || !ui.scroller) return;
    var sc = ui.scroller;
    var top = sc.scrollTop, left = sc.scrollLeft;
    var viewH = sc.clientHeight - geo.head, viewW = sc.clientWidth - geo.rn;
    var r0 = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN_ROWS);
    var r1 = Math.min(state.view.length, Math.ceil((top + viewH) / ROW_H) + OVERSCAN_ROWS);
    var c0 = colAt(Math.max(0, left - OVERSCAN_PX));
    var c1 = Math.min(columnCount() - 1, colAt(left + viewW + OVERSCAN_PX));
    var key = [r0, r1, c0, c1, state.viewVersion].join(",");
    if (key === rendered.key) return;
    rendered.key = key;

    var sel = selection();
    var w = widths();
    var q = state.query.trim().toLowerCase();
    var kinds = state.kinds;
    var editingSheet = state.editing;

    // Header.
    var head = clear(ui.head);
    head.appendChild(h("div", { class: "corner", style: { width: geo.rn + "px", height: geo.head + "px" }, title: "Select all (" + MOD + "A)" }));
    for (var c = c0; c <= c1; c++) {
      var name = headerLabel(c);
      var sorted = state.sort && state.sort.col === c ? state.sort.dir : "";
      var colSelected = c >= sel.c0 && c <= sel.c1;
      var nameAccess = state.header && state.sheet.rows.length ? access(0, c) : null;
      var renamable = !!(state.editing && nameAccess && nameAccess.editable);
      var headHint = state.editing
        ? (renamable ? "\nClick to select the column · double-click the name to rename it" : "\nClick to select the column" + (nameAccess && nameAccess.kind === "locked" ? " · the name is locked" : ""))
        : "\nClick to sort";
      var cell = h("div", { class: "hcell" + (colSelected ? " sel" : "") + (state.headFocus === c ? " active" : "") + (kinds[c] === "number" ? " num" : "") + (renamable ? " renamable" : "") + (state.editing && nameAccess && !nameAccess.editable ? " ro" : "") + (state.changed.has("0:" + c) && state.header ? " changed" : ""), role: "columnheader", "aria-colindex": String(c + 1), "aria-sort": sorted ? (sorted === "asc" ? "ascending" : "descending") : "none", "data-col": String(c), title: (name ? name + " · " : "") + "Column " + columnName(c) + " · " + kindLabel(kinds[c]) + headHint,
        style: { left: geo.rn + geo.lefts[c] + "px", width: (w[c] || 120) + "px", height: geo.head + "px" } },
        h("span", { class: "letter" }, columnName(c), kinds[c] && kinds[c] !== "empty" ? h("span", { class: "kind kind-" + kinds[c], text: kindBadge(kinds[c]) }) : null),
        state.header ? h("span", { class: "name", text: name || "—" }) : null,
        sorted ? icon(sorted === "asc" ? "arrow-up" : "arrow-down", "sort") : null,
        h("span", { class: "grip", "data-grip": String(c), title: "Drag to resize, double-click to fit" }));
      head.appendChild(cell);
    }

    // Rows.
    var body = clear(ui.body);
    var frag = document.createDocumentFragment();
    for (var vr = r0; vr < r1; vr++) {
      var src = state.view[vr];
      var rowSelected = vr >= sel.r0 && vr <= sel.r1;
      var row = h("div", { class: "row" + (vr % 2 ? " odd" : "") + (vr === state.sel.r && state.headFocus < 0 ? " current" : ""), role: "row", "aria-rowindex": String(vr + 2), style: { top: vr * ROW_H + "px", width: geo.rn + geo.total + "px" } },
        h("div", { class: "rn" + (rowSelected ? " sel" : ""), style: { width: geo.rn + "px" }, "data-row": String(vr), text: String(src + 1) }));
      for (var col = c0; col <= c1; col++) {
        var text = cellText(src, col);
        var key2 = src + ":" + col;
        var cls = "cell";
        var v = rawAt(src, col);
        var showsFormula = state.showFormulas && state.sheet.formulas && state.sheet.formulas[key2] !== undefined;
        // Real numbers always align right; numeric-looking text only in a column of numbers.
        if (!showsFormula && (typeof v === "number" || (kinds[col] === "number" && numOf(v) !== null))) cls += " num";
        if (state.sheet.formulas && state.sheet.formulas[key2] !== undefined) cls += v === null ? " formula pending" : " formula";
        if (state.sheet.display && state.sheet.display[key2] !== undefined && /^#[A-Z/0!?]+[!?]?$|^#N\/A$/.test(state.sheet.display[key2])) cls += " err";
        if (typeof v === "boolean") cls += " bool";
        if (vr >= sel.r0 && vr <= sel.r1 && col >= sel.c0 && col <= sel.c1) cls += " in-sel";
        if (vr === state.sel.r && col === state.sel.c) cls += " active";
        if (editingSheet && !access(src, col).editable) cls += " ro";
        if (state.changed.has(key2)) cls += " changed";
        var el = h("div", { class: cls, role: "gridcell", "aria-readonly": editingSheet && cls.indexOf(" ro") !== -1 ? "true" : null, "aria-colindex": String(col + 1), "data-row": String(vr), "data-col": String(col), style: { left: geo.rn + geo.lefts[col] + "px", width: (w[col] || 120) + "px" } });
        if (q && text && text.toLowerCase().indexOf(q) !== -1 && (state.queryCol < 0 || state.queryCol === col)) appendHighlighted(el, text, q);
        else if (text) el.textContent = oneLine(text.length > 500 ? text.slice(0, 500) + "…" : text);
        if (text.length > 40 || /\n/.test(text)) el.title = text.length > 2000 ? text.slice(0, 2000) + "…" : text;
        if (v === null && cls.indexOf("pending") !== -1) el.title = "Excel calculates this formula when the file is opened.";
        row.appendChild(el);
      }
      frag.appendChild(row);
    }
    body.appendChild(frag);
  }

  /** Line breaks inside a cell show as ↵, so every row stays one line high. */
  function oneLine(text) { return text.indexOf("\n") === -1 && text.indexOf("\r") === -1 ? text : text.replace(/\r?\n|\r/g, " ↵ "); }

  function appendHighlighted(el, text, q) {
    var lower = text.toLowerCase();
    var at = 0, i, budget = 500;
    while ((i = lower.indexOf(q, at)) !== -1 && at < budget) {
      if (i > at) el.appendChild(document.createTextNode(oneLine(text.slice(at, i))));
      el.appendChild(h("mark", { text: text.slice(i, i + q.length) }));
      at = i + q.length;
    }
    if (at < text.length) el.appendChild(document.createTextNode(oneLine(text.slice(at, Math.max(at, budget)))));
  }

  function kindLabel(kind) { return { number: "Numbers", date: "Dates", bool: "TRUE / FALSE", text: "Text", mixed: "Mixed", empty: "Empty" }[kind] || "Text"; }
  function kindBadge(kind) { return { number: "123", date: "date", bool: "bool", text: "abc", mixed: "mix" }[kind] || ""; }

  // ------------------------------------------------------------------ selection
  function selection() {
    var s = state.sel;
    return { r0: Math.min(s.r, s.ar), r1: Math.max(s.r, s.ar), c0: Math.min(s.c, s.ac), c1: Math.max(s.c, s.ac) };
  }

  function clampSelection() {
    var maxR = Math.max(0, state.view.length - 1), maxC = columnCount() - 1;
    var s = state.sel;
    s.r = Math.min(Math.max(0, s.r), maxR); s.ar = Math.min(Math.max(0, s.ar), maxR);
    s.c = Math.min(Math.max(0, s.c), maxC); s.ac = Math.min(Math.max(0, s.ac), maxC);
  }

  function select(r, c, extend) {
    state.headFocus = -1;
    state.sel.r = r; state.sel.c = c;
    if (!extend) { state.sel.ar = r; state.sel.ac = c; }
    clampSelection();
    scheduleRender(true);
    renderStatus();
  }

  function scrollIntoView(r, c) {
    var sc = ui.scroller;
    var y = r * ROW_H, viewH = sc.clientHeight - geo.head;
    if (y < sc.scrollTop) sc.scrollTop = y;
    else if (y + ROW_H > sc.scrollTop + viewH) sc.scrollTop = y + ROW_H - viewH;
    scrollColumnIntoView(c);
  }

  function scrollColumnIntoView(c) {
    var sc = ui.scroller;
    if (!sc || geo.lefts[c] === undefined) return;
    var x = geo.lefts[c], cw = geo.lefts[c + 1] - x, viewW = sc.clientWidth - geo.rn;
    if (x < sc.scrollLeft) sc.scrollLeft = x;
    else if (x + cw > sc.scrollLeft + viewW) sc.scrollLeft = Math.min(x, x + cw - viewW);
  }

  function cellFromEvent(e) {
    var t = e.target;
    while (t && t !== ui.scroller) {
      if (t.dataset && t.dataset.grip !== undefined) return { grip: Number(t.dataset.grip) };
      if (t.classList && t.classList.contains("hcell")) return { header: Number(t.dataset.col) };
      if (t.classList && t.classList.contains("corner")) return { corner: true };
      if (t.classList && t.classList.contains("rn")) return { rowHeader: Number(t.dataset.row) };
      if (t.classList && t.classList.contains("cell")) return { r: Number(t.dataset.row), c: Number(t.dataset.col) };
      t = t.parentNode;
    }
    return null;
  }

  function onGridMouseDown(e) {
    if (e.button !== 0) return;
    var hit = cellFromEvent(e);
    if (!hit) return;
    if (hit.grip !== undefined) { startResize(e, hit.grip); return; }
    ui.scroller.focus({ preventScroll: true });
    if (hit.corner) { state.headFocus = -1; selectAll(); return; }
    if (hit.header !== undefined) {
      // While editing, a header click selects the column (Excel-style); sorting is in the right-click menu.
      if (state.editing) { state.sel = { r: Math.max(0, state.view.length - 1), c: hit.header, ar: 0, ac: e.shiftKey ? state.sel.ac : hit.header }; state.headFocus = state.header && !e.shiftKey ? hit.header : -1; scheduleRender(true); renderStatus(); }
      else { cycleSort(hit.header); if (state.header) { state.headFocus = hit.header; scheduleRender(true); } }
      return;
    }
    if (hit.rowHeader !== undefined) {
      if (e.shiftKey) select(hit.rowHeader, 0, true);
      else { state.headFocus = -1; state.sel = { r: hit.rowHeader, c: 0, ar: hit.rowHeader, ac: columnCount() - 1 }; scheduleRender(true); renderStatus(); }
      return;
    }
    select(hit.r, hit.c, e.shiftKey);
    var dragged = false;
    var move = function (ev) {
      var over = cellFromEvent(ev);
      if (over && over.r !== undefined && (over.r !== state.sel.r || over.c !== state.sel.c)) { dragged = true; select(over.r, over.c, true); }
    };
    var up = function (ev) {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      // While editing, a plain click on a cell opens it with a caret where you clicked, keeping its text;
      // dragging, Shift-click and ⌘/Ctrl-click still select. Opened on release, so a drag never starts an edit.
      if (!state.editing || dragged || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || ev.button !== 0) return;
      var over = cellFromEvent(ev);
      if (!over || over.r !== hit.r || over.c !== hit.c) return;
      var src = state.view[hit.r];
      if (src === undefined || !access(src, hit.c).editable) return;
      beginEdit(null, caretFromClick(ev, hit));
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function startResize(e, col) {
    e.preventDefault();
    var w = widths();
    var startX = e.clientX, start = w[col] || 120;
    var grip = e.target;
    grip.classList.add("dragging");
    var move = function (ev) { w[col] = Math.max(40, Math.round(start + ev.clientX - startX)); layoutGrid(); };
    var up = function () { grip.classList.remove("dragging"); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function onGridDblClick(e) {
    var hit = cellFromEvent(e);
    if (!hit) return;
    if (hit.grip !== undefined) { autoSizeColumns(true, hit.grip); layoutGrid(); return; }
    if (state.editing && hit.header !== undefined && state.header) { beginHeaderEdit(hit.header); return; }
    if (hit.header !== undefined) return;
    if (hit.r !== undefined) tryEdit(null, true, caretFromClick(e, hit));
  }

  /** The character a double-click landed on, so editing starts with the caret there. */
  function caretFromClick(e, hit) {
    var el = cellEl(hit.r, hit.c);
    var src = state.view[hit.r];
    if (!el || src === undefined) return undefined;
    var text = editText(src, hit.c);
    if (text !== cellText(src, hit.c)) return text.length;
    var rect = el.getBoundingClientRect();
    var width = measureEditor(text);
    // Numbers are right-aligned in the cell; the editor shows them from the left.
    var start = el.classList.contains("num") ? rect.right - 7 - width : rect.left + 7;
    return E.caretIndexAt(text, e.clientX - start, measureEditor);
  }

  function selectAll() {
    state.sel = { r: Math.max(0, state.view.length - 1), c: columnCount() - 1, ar: 0, ac: 0 };
    scheduleRender(true);
    renderStatus();
  }

  function cycleSort(col) {
    var s = state.sort;
    state.sort = !s || s.col !== col ? { col: col, dir: "asc" } : s.dir === "asc" ? { col: col, dir: "desc" } : null;
    persist();
    rebuildView();
    state.sel = { r: 0, c: col, ar: 0, ac: col };
    layoutGrid();
    renderStatus();
    announce(state.sort ? "Sorted by " + (headerLabel(col) || "column " + columnName(col)) + (state.sort.dir === "asc" ? ", ascending" : ", descending") : "Sort cleared");
  }

  function setFormulas(on) {
    state.showFormulas = on;
    if (ui.formulaToggle) ui.formulaToggle.checked = on;
    persist();
    scheduleRender(true);
    renderStatus();
  }

  function onGridKey(e) {
    if (ui.scroller.classList.contains("busy")) return;
    var mod = e.metaKey || e.ctrlKey;
    if (state.structurePending && state.editing && !mod && !e.altKey && e.key.length === 1) {
      // The new row or column is on its way; what is typed goes into it once it arrives.
      e.preventDefault();
      state.typeAhead += e.key;
      return;
    }
    if (state.headFocus >= 0 && onHeadKey(e)) return;
    if (e.key === "ArrowUp" && !mod && !e.shiftKey && state.sel.r === 0 && state.header && state.sheet && state.sheet.rows.length) {
      e.preventDefault();
      focusHeader(state.sel.c);
      return;
    }
    if (state.editing && onEditKey(e)) return;
    var s = state.sel;
    var maxR = state.view.length - 1, maxC = columnCount() - 1;
    var page = Math.max(1, Math.floor((ui.scroller.clientHeight - geo.head) / ROW_H) - 1);
    var r = s.r, c = s.c, handled = true;
    switch (e.key) {
      case "ArrowDown": r = mod ? maxR : r + 1; break;
      case "ArrowUp": r = mod ? 0 : r - 1; break;
      case "ArrowRight": c = mod ? maxC : c + 1; break;
      case "ArrowLeft": c = mod ? 0 : c - 1; break;
      case "PageDown": r += page; break;
      case "PageUp": r -= page; break;
      case "Home": c = 0; if (mod) r = 0; break;
      case "End": c = maxC; if (mod) r = maxR; break;
      case "Enter": if (e.shiftKey) r--; else r++; break;
      case "Tab": if (e.shiftKey) c--; else c++; break;
      case " ": openInspector(); e.preventDefault(); return;
      case "F2": case "Delete": case "Backspace": e.preventDefault(); tryEdit(null, false); return;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (maxR < 0) return;
      var extend = e.shiftKey && e.key !== "Enter" && e.key !== "Tab";
      select(Math.max(0, Math.min(maxR, r)), Math.max(0, Math.min(maxC, c)), extend);
      scrollIntoView(state.sel.r, state.sel.c);
      announceCell();
      return;
    }
    if (mod && (e.key === "a" || e.key === "A")) { e.preventDefault(); selectAll(); }
    else if (!mod && !e.altKey && e.key.length === 1) { e.preventDefault(); tryEdit(e.key, false); }
  }

  document.addEventListener("keydown", function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "f" || e.key === "F") && ui.search) { e.preventDefault(); ui.search.focus(); ui.search.select(); }
    else if (e.key === "Escape") closeMenu();
  });

  // Copy (keyboard or VS Code's Copy) copies the selected cells as tab-separated text, ready to paste into Excel.
  document.addEventListener("copy", function (e) {
    if (!state.sheet || !ui.scroller || document.activeElement !== ui.scroller) return;
    e.preventDefault();
    var text = selectionTsv();
    if (e.clipboardData) e.clipboardData.setData("text/plain", text);
    else call("copy", { text: text });
    var sel = selection();
    toast("success", "Copied " + plural((sel.r1 - sel.r0 + 1) * (sel.c1 - sel.c0 + 1), "cell") + ".");
  });

  function announce(text) { if (ui.live) ui.live.textContent = text; }
  function announceCell() {
    var src = state.view[state.sel.r];
    if (src === undefined) return;
    announce(columnName(state.sel.c) + (src + 1) + ": " + (cellText(src, state.sel.c) || "empty"));
  }

  // ------------------------------------------------------------------ status bar and stats
  var statsCache = {};
  function columnStats(col) {
    var key = col + ":" + state.viewVersion + ":" + state.showFormulas;
    if (statsCache[key]) return statsCache[key];
    var filled = 0, empty = 0, nums = 0, sum = 0, min = Infinity, max = -Infinity, distinct = new Set(), capped = false;
    for (var i = 0; i < state.view.length; i++) {
      var v = rawAt(state.view[i], col);
      if (v === null || v === "") { empty++; continue; }
      filled++;
      if (!capped) { distinct.add(typeof v === "string" ? v : String(v)); if (distinct.size > 100000) capped = true; }
      var n = numOf(v);
      if (n !== null) { nums++; sum += n; if (n < min) min = n; if (n > max) max = n; }
    }
    var result = { filled: filled, empty: empty, nums: nums, sum: sum, min: min, max: max, distinct: distinct.size, capped: capped };
    statsCache[key] = result;
    return result;
  }

  function rangeStats(sel) {
    var count = 0, nums = 0, sum = 0, min = Infinity, max = -Infinity;
    var cells = (sel.r1 - sel.r0 + 1) * (sel.c1 - sel.c0 + 1);
    if (cells > 2000000) return null;
    for (var r = sel.r0; r <= sel.r1; r++) {
      var src = state.view[r];
      for (var c = sel.c0; c <= sel.c1; c++) {
        var v = rawAt(src, c);
        if (v === null || v === "") continue;
        count++;
        var n = numOf(v);
        if (n !== null) { nums++; sum += n; if (n < min) min = n; if (n > max) max = n; }
      }
    }
    return { count: count, nums: nums, sum: sum, min: min, max: max };
  }

  function renderStatus() {
    if (!ui.status || !state.sheet) return;
    var status = clear(ui.status);
    var sel = selection();
    var src = state.view[state.sel.r];
    var multi = sel.r1 > sel.r0 || sel.c1 > sel.c0;
    var left = h("div", { class: "status-cell" });
    if (src !== undefined) {
      var key = src + ":" + state.sel.c;
      var formula = state.sheet.formulas && state.sheet.formulas[key];
      left.appendChild(h("span", { class: "addr mono", text: multi ? columnName(sel.c0) + (state.view[sel.r0] + 1) + ":" + columnName(sel.c1) + (state.view[sel.r1] + 1) : columnName(state.sel.c) + (src + 1) }));
      left.appendChild(accessChip(access(src, state.sel.c)));
      if (!multi) {
        if (formula) left.appendChild(h("span", { class: "fx mono", title: "=" + formula }, h("i", { text: "fx" }), " =" + formula));
        var value = cellText(src, state.sel.c, true);
        left.appendChild(h("span", { class: "value", title: value, text: value ? (value.length > 120 ? value.slice(0, 120) + "…" : value) : "empty" }));
        if (!value) left.lastChild.classList.add("muted");
      }
    }
    var mid = h("div", { class: "status-stats" });
    if (multi) {
      var rs = rangeStats(sel);
      if (rs) {
        mid.appendChild(stat("Count", fmtNum(rs.count)));
        if (rs.nums) { mid.appendChild(stat("Sum", fmtStat(rs.sum))); mid.appendChild(stat("Average", fmtStat(rs.sum / rs.nums))); mid.appendChild(stat("Min", fmtStat(rs.min))); mid.appendChild(stat("Max", fmtStat(rs.max))); }
      }
    } else if (state.view.length) {
      var cs = columnStats(state.sel.c);
      var label = headerLabel(state.sel.c) || "Column " + columnName(state.sel.c);
      mid.appendChild(h("span", { class: "stat-col", title: label, text: label.length > 24 ? label.slice(0, 23) + "…" : label }));
      mid.appendChild(stat(kindLabel(state.kinds[state.sel.c]), ""));
      mid.appendChild(stat("Filled", fmtNum(cs.filled)));
      if (cs.empty) mid.appendChild(stat("Empty", fmtNum(cs.empty)));
      mid.appendChild(stat("Distinct", (cs.capped ? "> " : "") + fmtNum(cs.distinct)));
      if (cs.nums && cs.nums >= cs.filled * 0.8) {
        mid.appendChild(stat("Min", fmtStat(cs.min)));
        mid.appendChild(stat("Max", fmtStat(cs.max)));
        mid.appendChild(stat("Sum", fmtStat(cs.sum)));
        mid.appendChild(stat("Avg", fmtStat(cs.sum / cs.nums)));
      }
    }
    var total = Math.max(0, state.sheet.rows.length - dataStart());
    var right = h("div", { class: "status-size muted" },
      state.query ? fmtNum(state.view.length) + " of " + plural(total, "row") : plural(total, "row"),
      " × " + plural(columnCount(), "column"));
    status.appendChild(left);
    status.appendChild(mid);
    status.appendChild(right);
  }

  /** Editable / Read-only / Locked, for the active cell; in the read-only view it also turns editing on. */
  function accessChip(a) {
    var iconName = a.editable ? "edit" : a.kind === "locked" ? "lock" : a.kind === "view" ? "eye" : "circle-slash";
    var title = a.editable ? "Editable: click the cell, or select it and type, press Enter or F2" : a.reason;
    if (a.kind === "view") {
      var b = h("button", { class: "access view", type: "button", title: title + " (click to start editing)" }, icon(iconName), "Read-only", h("span", { class: "access-action" }, "· Edit"));
      b.addEventListener("click", function () { setEditing(true); });
      return b;
    }
    return h("span", { class: "access " + (a.editable ? "ok" : a.kind), title: title }, icon(iconName), a.label);
  }

  function stat(label, value) {
    return h("span", { class: "stat" }, h("span", { class: "muted", text: label }), value ? " " + value : null);
  }

  // ------------------------------------------------------------------ inspector
  function openInspector() {
    var src = state.view[state.sel.r];
    if (src === undefined) return;
    var c = state.sel.c;
    var key = src + ":" + c;
    var raw = rawAt(src, c);
    var shown = state.sheet.display && state.sheet.display[key];
    var formula = state.sheet.formulas && state.sheet.formulas[key];
    var text = raw === null ? "" : typeof raw === "boolean" ? (raw ? "TRUE" : "FALSE") : String(raw);
    closeMenu();
    var close = function () { overlay.remove(); ui.scroller.focus({ preventScroll: true }); };
    var overlay = h("div", { class: "overlay", onClick: function (e) { if (e.target === overlay) close(); } },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Cell " + columnName(c) + (src + 1) },
        h("div", { class: "dialog-head" },
          h("span", { class: "addr mono", text: columnName(c) + (src + 1) }),
          h("span", { class: "muted grow", text: headerLabel(c) || "" }),
          iconBtn("close", "Close (Esc)", close)),
        formula ? h("div", { class: "dialog-row" }, h("span", { class: "muted", text: "Formula" }), h("code", { class: "mono", text: "=" + formula })) : null,
        shown !== undefined && shown !== text ? h("div", { class: "dialog-row" }, h("span", { class: "muted", text: "Shown as" }), h("code", { class: "mono", text: shown })) : null,
        h("div", { class: "dialog-row" }, h("span", { class: "muted", text: "Type" }), h("span", { text: raw === null ? "Empty" : typeof raw === "number" ? "Number" : typeof raw === "boolean" ? "Boolean" : numOf(raw) !== null ? "Text (looks like a number)" : "Text · " + plural(text.length, "character") })),
        h("pre", { class: "dialog-value mono", text: text || "(empty)" }),
        h("div", { class: "row-actions" },
          btn("Copy value", "copy", function () { call("copy", { text: text }).then(function () { toast("success", "Copied."); }, fail); }, "primary"),
          formula ? btn("Copy formula", "symbol-operator", function () { call("copy", { text: "=" + formula }).then(function () { toast("success", "Copied."); }, fail); }) : null,
          btn("Filter by this value", "filter", function () { close(); filterBy(c, text); }))));
    overlay.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.body.appendChild(overlay);
    overlay.querySelector(".btn").focus();
  }

  function filterBy(col, text) {
    state.query = text;
    state.queryCol = col;
    ui.search.value = text;
    ui.scope.value = String(col);
    persist();
    rebuildView();
    state.sel = { r: 0, c: col, ar: 0, ac: col };
    layoutGrid();
    renderStatus();
  }

  // ------------------------------------------------------------------ menus
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(anchor, items, point) {
    closeMenu();
    var menu = h("div", { class: "menu", role: "menu" });
    items.forEach(function (item) {
      if (!item) return;
      if (item === "-") { menu.appendChild(h("div", { class: "menu-sep", role: "separator" })); return; }
      var b = h("button", { class: "menu-item", role: "menuitem", type: "button", disabled: item.disabled }, icon(item.icon || "blank"), h("span", { class: "grow", text: item.label }), item.hint ? h("span", { class: "muted small", text: item.hint }) : null);
      b.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(); item.run(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var rect = point ? { left: point.x, bottom: point.y, right: point.x } : anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = point ? rect.left : rect.right - mw;
    var y = rect.bottom + (point ? 0 : 4);
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, (point ? rect.bottom : rect.top) - mh - 4);
    menu.style.left = Math.max(8, x) + "px";
    menu.style.top = y + "px";
    menuEl = menu;
    var first = menu.querySelector(".menu-item:not([disabled])");
    if (first) first.focus();
    menu.addEventListener("keydown", function (e) {
      var list = Array.prototype.slice.call(menu.querySelectorAll(".menu-item:not([disabled])"));
      var i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor && anchor.focus && anchor.focus(); }
    });
  }
  document.addEventListener("mousedown", function (e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });

  function onGridContextMenu(e) {
    var hit = cellFromEvent(e);
    if (!hit) return;
    e.preventDefault();
    if (hit.r !== undefined) {
      var sel = selection();
      if (hit.r < sel.r0 || hit.r > sel.r1 || hit.c < sel.c0 || hit.c > sel.c1) select(hit.r, hit.c, false);
    } else if (hit.header !== undefined) select(state.sel.r, hit.header, false);
    var c = state.sel.c;
    var src = state.view[state.sel.r];
    var value = src === undefined ? "" : cellText(src, c);
    var sel2 = selection();
    var rowsLabel = sel2.r1 > sel2.r0 ? (sel2.r1 - sel2.r0 + 1) + " rows" : "row";
    var colsLabel = sel2.c1 > sel2.c0 ? (sel2.c1 - sel2.c0 + 1) + " columns" : "column";
    var blocked = state.sheet && state.sheet.protection ? "the sheet is protected" : state.lock;
    var structure = blocked ? "Locked: " + blocked : "";
    var named = state.header && state.sheet && state.sheet.rows.length > 0;
    var renameItem = named && state.file && state.file.editable ? {
      label: "Rename column" + (headerLabel(c) ? " “" + (headerLabel(c).length > 24 ? headerLabel(c).slice(0, 23) + "…" : headerLabel(c)) + "”" : "") + "…",
      icon: "edit", hint: "F2 on the header",
      disabled: cellLocked(0, c),
      run: function () { if (!state.editing) setEditing(true); beginHeaderEdit(c); }
    } : null;
    var editItems = state.editing ? [
      { label: "Edit cell", icon: "edit", hint: "Enter", run: function () { tryEdit(null, false); }, disabled: src === undefined || !access(src, c).editable },
      { label: "Cut", icon: "clippy", hint: MOD + "X", run: cutSelection },
      { label: "Clear", icon: "clear-all", hint: "Delete", run: clearSelection },
      "-",
      { label: "Insert " + rowsLabel + " above", icon: "arrow-up", hint: structure, run: function () { insertRows(false); }, disabled: !!blocked || src === undefined },
      { label: "Insert " + rowsLabel + " below", icon: "arrow-down", hint: structure, run: function () { insertRows(true); }, disabled: !!blocked || src === undefined },
      { label: "Delete " + rowsLabel, icon: "trash", run: deleteRows, disabled: !!blocked || src === undefined },
      "-",
      { label: "Insert " + colsLabel + " left", icon: "arrow-left", run: function () { insertColumns(false); }, disabled: !!blocked },
      { label: "Insert " + colsLabel + " right", icon: "arrow-right", run: function () { insertColumns(true); }, disabled: !!blocked },
      { label: "Delete " + colsLabel, icon: "trash", run: deleteColumns, disabled: !!blocked },
      "-"
    ] : state.file && state.file.editable && src !== undefined && !cellLocked(src, c) ? [
      { label: "Edit cell", icon: "edit", hint: "turns on editing", run: function () { setEditing(true); tryEdit(null, false); } },
      "-"
    ] : [];
    // On a column header, renaming comes first.
    if (hit.header !== undefined && renameItem) editItems = [renameItem, "-"].concat(editItems.filter(function (item, i) { return !(i === 0 && item && item.label === "Edit cell"); }));
    else if (renameItem && state.editing) editItems = editItems.concat([renameItem, "-"]);
    openMenu(null, editItems.concat([
      { label: "Copy", icon: "copy", hint: MOD + "C", run: function () { copyText(selectionTsv(), "Copied.") } },
      { label: "Copy row", icon: "list-flat", run: function () { copyText(state.view.slice(selection().r0, selection().r1 + 1).map(function (r) { return rowTexts(r).join("\t"); }).join("\n"), "Copied.") } },
      { label: "Copy column", icon: "list-selection", run: function () { copyText(state.view.map(function (r) { return cellText(r, c); }).join("\n"), "Copied the column.") } },
      "-",
      { label: "Inspect cell", icon: "eye", hint: "F2", run: openInspector, disabled: src === undefined },
      { label: "Filter by this value", icon: "filter", run: function () { filterBy(c, value); }, disabled: src === undefined },
      "-",
      { label: "Sort ascending", icon: "arrow-up", run: function () { setSort(c, "asc"); } },
      { label: "Sort descending", icon: "arrow-down", run: function () { setSort(c, "desc"); } },
      state.sort ? { label: "Clear sort", icon: "close", run: function () { setSort(c, null); } } : null,
      { label: "Fit column width", icon: "arrow-both", run: function () { autoSizeColumns(true, c); layoutGrid(); } }
    ]), { x: e.clientX, y: e.clientY });
  }

  function setSort(col, dir) {
    state.sort = dir ? { col: col, dir: dir } : null;
    persist();
    rebuildView();
    layoutGrid();
    renderStatus();
  }

  // ------------------------------------------------------------------ editing
  /*
   * Edits go to the host, which applies them, puts them on VS Code's undo
   * stack and sends back a patch; the grid only changes when a patch arrives,
   * so it always shows what will be saved.
   */
  function renderEditBar() {
    var undo = iconBtn("discard", "Undo (" + MOD + "Z)", function () { call("undo").catch(fail); });
    var redo = iconBtn("redo", "Redo (" + (MAC ? "⇧⌘Z" : "Ctrl+Y") + ")", function () { call("redo").catch(fail); });
    var addRow = btn("Row", "add", addRowAtEnd, "", { title: "Add a row at the end", "data-title": "Add a row at the end" });
    var addCol = btn("Column", "add", addColumnAtEnd, "", { title: "Add a column at the end and name it", "data-title": "Add a column at the end and name it" });
    var delRow = btn("Delete rows", "trash", deleteRows, "", { title: "Delete the selected rows", "data-title": "Delete the selected rows" });
    var delCol = btn("Delete columns", "trash", deleteColumns, "", { title: "Delete the selected columns", "data-title": "Delete the selected columns" });
    var hint = h("span", { class: "edit-hint muted small" },
      h("span", { class: "legend legend-edit", title: "Cells you can change: click one to edit its text, or select it and type to replace it" }, icon("edit"), "Editable"),
      h("span", { class: "legend legend-locked hidden", title: "Locked by the sheet's protection in Excel" }, icon("lock"), "Locked"),
      h("span", { class: "legend legend-changed", title: "Changed since the last save" }, h("i"), "Unsaved"),
      h("span", { class: "legend-keys" }, "Click a cell to edit · Esc cancels · right-click for more"));
    var save = btn("Save", "save", function () { commitEdit(null); call("saveFile").catch(fail); }, "primary", { title: "Save (" + MOD + "S)" });
    var badge = h("span", { class: "edit-badge", role: "status" }, icon("edit"), h("span", { text: "Editing" }));
    var el = h("div", { class: "editbar hidden", role: "toolbar", "aria-label": "Editing" },
      badge, undo, redo, h("span", { class: "sep" }), addRow, addCol, delRow, delCol, hint, save);
    return { el: el, save: save, badge: badge, delRow: delRow, delCol: delCol, addRow: addRow, addCol: addCol, hint: hint };
  }

  function renderEditState() {
    if (!ui.editbar || !state.file) return;
    var editable = !!state.file.editable;
    if (ui.editBtn) {
      clear(ui.editBtn);
      append(ui.editBtn, [icon(state.editing ? "check" : "edit"), state.editing ? "Done" : "Edit"]);
      ui.editBtn.disabled = !editable;
      ui.editBtn.classList.toggle("primary", state.editing);
      ui.editBtn.title = editable ? (state.editing ? "Stop editing (edits stay until you save or undo them)" : "Edit cells, rows and columns") : state.file.readOnlyReason || "This file can't be edited.";
    }
    ui.editbar.el.classList.toggle("hidden", !state.editing);
    clear(ui.editbar.save);
    append(ui.editbar.save, [icon(state.dirty ? "save" : "check"), state.dirty ? "Save" : "Saved"]);
    ui.editbar.save.disabled = !state.dirty;
    var changedCount = state.changed.size;
    ui.editbar.save.title = state.dirty ? "Save " + (changedCount ? plural(changedCount, "changed cell") + " " : "your changes ") + "(" + MOD + "S)" : "Everything is saved";
    ui.editbar.badge.classList.toggle("dirty", state.dirty);
    ui.editbar.badge.lastChild.textContent = state.dirty ? "Unsaved changes" : "Editing";
    ui.editbar.badge.title = state.dirty ? "Changed cells have a yellow mark. Save with " + MOD + "S, or undo with " + MOD + "Z." : "Every change is saved";
    var protectedSheet = !!(state.sheet && state.sheet.protection);
    var locked = protectedSheet ? "Rows and columns can't be added or deleted: this sheet is protected in Excel."
      : state.lock ? "Rows and columns can't be inserted or deleted here: " + state.lock + ". You can still edit cells and add rows or columns at the end." : "";
    [ui.editbar.delRow, ui.editbar.delCol].forEach(function (b) { b.disabled = !!locked; b.title = locked || b.dataset.title; });
    [ui.editbar.addRow, ui.editbar.addCol].forEach(function (b) { b.disabled = protectedSheet; b.title = protectedSheet ? locked : b.dataset.title; });
    var legendLocked = ui.editbar.hint.querySelector(".legend-locked");
    if (legendLocked) legendLocked.classList.toggle("hidden", !protectedSheet);
    if (ui.scroller) {
      ui.scroller.classList.toggle("editing", state.editing);
      ui.scroller.setAttribute("aria-readonly", state.editing ? "false" : "true");
    }
    document.body.classList.toggle("editing", state.editing);
  }

  function setEditing(on) {
    if (on && (!state.file || !state.file.editable)) return;
    if (!on) commitEdit(null);
    state.editing = on;
    persist();
    if (on && state.lock === undefined) {
      call("structureLock").then(function (lock) { state.lock = lock || null; renderEditState(); }, function () { state.lock = null; });
    }
    closeCellHint();
    renderEditState();
    // Cell marks and the status chip depend on the mode.
    scheduleRender(true);
    renderStatus();
    if (on) {
      // The edit bar and the cell marks show the mode; the save and undo keys are worth saying once.
      if (!state.toldEditing) { state.toldEditing = true; persist(); toast("info", "Editing " + state.file.name + ".", "Click a cell to edit its text. Save with " + MOD + "S, undo with " + MOD + "Z. Locked and read-only cells are hatched."); }
      ui.scroller.focus({ preventScroll: true });
    }
  }

  /** Sends an edit to the host; resolves true when it was applied, false (after saying why) when not. */
  function edit(params) {
    params.sheet = state.sheetIndex;
    return call("edit", params).then(function () { return true; }, function (error) { fail(error); return false; });
  }

  /** A row or column edit: keys typed until the sheet reloads are kept, and nothing waits forever if it fails. */
  function structuralEdit(params, after) {
    state.structurePending = true;
    state.afterReload = after || null;
    return edit(params).then(function (ok) {
      if (!ok) { state.afterReload = null; finishStructure(); }
      return ok;
    });
  }

  function finishStructure() {
    if (!state.structurePending) return;
    state.structurePending = false;
    var typed = state.typeAhead;
    state.typeAhead = "";
    if (!typed || !state.editing || editor) return;
    if (state.headFocus >= 0) beginHeaderEdit(state.headFocus, { initial: typed });
    else tryEdit(typed, false);
  }

  /** The text a cell is edited as: its formula, or its value as typed (not as formatted). */
  function editText(src, c) {
    var key = src + ":" + c;
    if (state.sheet.formulas && state.sheet.formulas[key] !== undefined) return "=" + state.sheet.formulas[key];
    var v = rawAt(src, c);
    if (v === null) return "";
    if (v === true) return "TRUE";
    if (v === false) return "FALSE";
    return String(v);
  }

  /*
   * The cell editor is one textarea laid over the cell. It is created when
   * editing starts and removed when it ends; re-rendering the grid never
   * touches it (it lives outside the grid), so the caret, the selection and
   * the native undo history stay put while patches and redraws come in.
   */
  var editor = null;

  function cellEl(vr, c) { return ui.body ? ui.body.querySelector('.cell[data-row="' + vr + '"][data-col="' + c + '"]') : null; }
  function headEl(c) { return ui.head ? ui.head.querySelector('.hcell[data-col="' + c + '"]') : null; }

  /** The column names as typed (the header row's raw text), "" where there is no header row. */
  function headerNames() {
    var out = [];
    var named = state.header && state.sheet && state.sheet.rows.length;
    for (var c = 0; c < columnCount(); c++) out.push(named ? editText(0, c) : "");
    return out;
  }

  /**
   * Opens the editor on the active cell. initial is text typed over the cell
   * (Excel's Enter mode: arrows finish the cell); without it the cell's own
   * text is edited (Edit mode: arrows move the caret), with the caret at
   * caretAt or at the end.
   */
  function beginEdit(initial, caretAt) {
    var src = state.view[state.sel.r];
    if (src === undefined || !state.editing) return;
    var r = state.sel.r, c = state.sel.c;
    state.sel.ar = r; state.sel.ac = c;
    state.headFocus = -1;
    scrollIntoView(r, c);
    rendered.key = "";
    renderGrid();
    var cell = cellEl(r, c);
    if (!cell) return;
    var typed = initial !== null && initial !== undefined;
    openEditor({ el: cell, vr: r, src: src, c: c, initial: initial, caretAt: caretAt, label: columnName(c) + (src + 1), mode: typed ? "enter" : "edit" });
  }

  /** Renames a column in its header cell. isNew: the column was just added and already has its default name. */
  function beginHeaderEdit(c, opts) {
    opts = opts || {};
    if (!state.sheet || !state.sheet.rows.length || !state.header || !state.editing) return;
    var a = access(0, c);
    if (!a.editable) { if (!opts.quiet) toast("info", "This column name can't be changed.", a.reason); return; }
    state.headFocus = c;
    scrollColumnIntoView(c);
    rendered.key = "";
    renderGrid();
    var cell = headEl(c);
    if (!cell) return;
    var typed = opts.initial !== null && opts.initial !== undefined;
    openEditor({ el: cell, src: 0, c: c, initial: opts.initial, header: true, isNew: !!opts.isNew, selectAll: !typed, label: (opts.isNew ? "New column " : "Column ") + columnName(c), mode: typed ? "enter" : "edit" });
  }

  function openEditor(o) {
    commitEdit(null);
    // A column name that clashes keeps its editor open until it is fixed.
    if (editor) return;
    var original = editText(o.src, o.c);
    var area = h("textarea", { class: "cell-editor" + (o.header ? " head-editor" : ""), spellcheck: "false", autocomplete: "off", rows: "1", "aria-label": o.header ? "Name of column " + columnName(o.c) : "Edit cell " + o.label });
    area.value = original;
    if (o.header) area.placeholder = E.defaultColumnName(headerNames(), o.c);
    var chip = h("div", { class: "editor-chip" }, icon("edit"), h("b", { text: o.label }), h("span", { class: "chip-mode" }), h("span", { class: "chip-keys" }));
    var error = h("div", { class: "editor-error hidden", role: "alert", id: "editor-error" });
    document.body.appendChild(area);
    document.body.appendChild(chip);
    document.body.appendChild(error);
    editor = { area: area, chip: chip, error: error, vr: o.vr, src: o.src, c: o.c, original: original, header: !!o.header, isNew: !!o.isNew, mode: o.mode, rectH: 24, maxW: 480 };
    area.addEventListener("input", function () { growEditor(); if (editor && editor.area === area && editor.header) showEditorError(""); });
    area.addEventListener("keydown", onEditorKey);
    area.addEventListener("blur", function () { if (editor && editor.area === area) commitEdit(null, true); });
    positionEditor(o.el.getBoundingClientRect());
    area.focus({ preventScroll: true });
    if (o.initial !== null && o.initial !== undefined) {
      // Typing over a cell replaces it. Inserted as typing, so the editor's own undo can take it back.
      area.select();
      insertText(o.initial);
    } else if (o.selectAll) {
      area.select();
    } else {
      var at = o.caretAt !== undefined && o.caretAt !== null ? Math.max(0, Math.min(original.length, o.caretAt)) : original.length;
      area.setSelectionRange(at, at);
    }
    renderEditorChip();
    growEditor();
  }

  /** Puts text at the caret the way typing would, keeping the text box's undo history. */
  function insertText(text) {
    var area = editor && editor.area;
    if (!area) return;
    var ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
    if (!ok) {
      var at = area.selectionStart;
      area.value = area.value.slice(0, at) + text + area.value.slice(area.selectionEnd);
      area.selectionStart = area.selectionEnd = at + text.length;
    }
    growEditor();
  }

  /** Lays the editor over the cell (rect), with its label above and any error below. */
  function positionEditor(rect) {
    var e = editor;
    if (!e) return;
    var area = e.area;
    e.rectH = Math.round(rect.height);
    e.minW = Math.max(Math.round(rect.width), e.header ? 160 : 90);
    var left = Math.max(0, Math.min(rect.left, window.innerWidth - e.minW - 4));
    e.maxW = Math.max(e.minW, Math.min(480, window.innerWidth - left - 6));
    area.style.left = left + "px";
    area.style.top = rect.top + "px";
    // Text sits where the cell showed it: centred in a tall header, on the row in a cell.
    var pad = Math.max(0, Math.floor((e.rectH - 4 - 20) / 2));
    area.style.paddingTop = area.style.paddingBottom = pad + "px";
    growEditor();
    placeEditorChrome();
  }

  function placeEditorChrome() {
    var e = editor;
    if (!e) return;
    var box = e.area.getBoundingClientRect();
    e.chip.style.left = box.left + "px";
    var above = box.top - e.chip.offsetHeight - 2;
    e.chip.style.top = (above >= 0 ? above : box.bottom + 2) + "px";
    e.error.style.left = box.left + "px";
    e.error.style.top = box.bottom + (above >= 0 ? 0 : e.chip.offsetHeight + 4) + "px";
    e.error.style.maxWidth = Math.max(220, Math.min(380, window.innerWidth - box.left - 8)) + "px";
  }

  /**
   * Sizes the editor to its text: wider up to a limit, then taller. The
   * height includes the borders, so the text never scrolls inside the box
   * (a box one pixel too short scrolls, and the caret jumps as you type).
   */
  function growEditor() {
    var e = editor;
    if (!e) return;
    var area = e.area;
    var lines = area.value.slice(0, 4000).split("\n");
    var widest = 0;
    for (var i = 0; i < lines.length && i < 200; i++) widest = Math.max(widest, measureEditor(lines[i]));
    area.style.width = Math.max(e.minW || 90, Math.min(e.maxW || 480, Math.ceil(widest) + 18)) + "px";
    area.style.height = "auto";
    var border = area.offsetHeight - area.clientHeight;
    var want = area.scrollHeight + border;
    var max = Math.max(e.rectH, 220);
    area.style.height = Math.max(e.rectH, Math.min(want, max)) + "px";
    area.style.overflowY = want > max ? "auto" : "hidden";
  }

  var editorMeasure = null;
  function measureEditor(text) {
    if (!editorMeasure) {
      editorMeasure = document.createElement("canvas").getContext("2d");
      var cs = getComputedStyle(editor ? editor.area : document.body);
      editorMeasure.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    }
    return editorMeasure.measureText(text).width;
  }

  /** Follows the cell when the grid scrolls or resizes; finishes editing once the cell scrolls out of sight. */
  function repositionEditor() {
    var e = editor;
    if (!e || !ui.scroller) return;
    var el = e.header ? headEl(e.c) : cellEl(e.vr, e.c);
    var view = ui.scroller.getBoundingClientRect();
    var rect = el ? el.getBoundingClientRect() : null;
    if (!rect || rect.right <= view.left + geo.rn || rect.left >= view.right || rect.bottom <= view.top + (e.header ? 0 : geo.head) || rect.top >= view.bottom) { commitEdit(null, true); return; }
    positionEditor(rect);
  }
  window.addEventListener("resize", function () { if (editor) repositionEditor(); });

  function renderEditorChip() {
    var e = editor;
    if (!e) return;
    var mode = e.chip.querySelector(".chip-mode");
    var keys = e.chip.querySelector(".chip-keys");
    mode.textContent = e.header ? "" : e.mode === "enter" ? "Typing" : "Editing";
    mode.title = e.header ? "" : e.mode === "enter" ? "Arrow keys finish the cell and move. F2 switches to moving the caret." : "Arrow keys move the caret. F2 switches to moving between cells.";
    mode.classList.toggle("hidden", e.header);
    keys.textContent = e.header
      ? "Enter saves · Tab next column · Esc " + (e.isNew ? "keeps the default" : "cancels")
      : "Enter saves · Esc cancels · " + (MAC ? "⌥" : "Alt+") + "Enter new line · F2 mode";
  }

  /** Shows (or with "" hides) why a column name was refused, under the editor; the editor stays open. */
  function showEditorError(text) {
    var e = editor;
    if (!e) return;
    e.error.textContent = text;
    e.error.classList.toggle("hidden", !text);
    e.area.classList.toggle("invalid", !!text);
    if (text) { e.area.setAttribute("aria-invalid", "true"); e.area.setAttribute("aria-describedby", "editor-error"); }
    else { e.area.removeAttribute("aria-invalid"); e.area.removeAttribute("aria-describedby"); }
    placeEditorChrome();
    if (text) announce(text);
  }

  function onEditorKey(e) {
    var cur = editor;
    if (!cur || e.target !== cur.area) return;
    var action = E.editorKeyAction(e, { mac: MAC, mode: cur.mode, header: cur.header });
    // Characters, Backspace, clipboard keys and the like belong to the text box (and to VS Code for copy and paste).
    if (!action) return;
    // Keys the editor handles go no further: VS Code's own undo would otherwise undo the last saved edit instead of the typing.
    e.preventDefault();
    e.stopPropagation();
    switch (action.type) {
      case "cancel": cancelEdit(); break;
      case "newline": insertText("\n"); break;
      case "commit": commitEdit(action.move); break;
      case "toggleMode": cur.mode = cur.mode === "enter" ? "edit" : "enter"; renderEditorChip(); announce(cur.mode === "enter" ? "Arrow keys move between cells" : "Arrow keys move the caret"); break;
      case "undo":
      case "redo":
        try { document.execCommand(action.type); } catch (err) { /* nothing to undo */ }
        growEditor();
        break;
      case "selectAll": cur.area.select(); break;
      case "save": {
        // Saved once the cell's edit has reached the host, so the file holds what was just typed.
        var done = commitEdit(null);
        done.then(function () { return call("saveFile"); }).catch(fail);
        break;
      }
    }
  }

  function closeEditor(cur) {
    // Clear it first: removing the focused textarea fires blur, which would commit it again.
    if (editor === cur) editor = null;
    cur.chip.remove();
    cur.error.remove();
    cur.area.remove();
  }

  /**
   * Finishes editing: sends the text to the host (which applies it and
   * patches the grid) and moves the active cell. A column name another
   * column already has is refused and the editor stays open, unless focus
   * left it (fromBlur), which keeps the old name and says why.
   */
  function commitEdit(move, fromBlur) {
    if (!editor) return Promise.resolve(true);
    var cur = editor;
    var text = cur.area.value;
    if (cur.header) {
      var check = E.checkColumnName(headerNames(), cur.c, text);
      if (!check.ok) {
        var message = "“" + check.name.trim() + "” is already the name of column " + columnName(check.clash) + ". Column names must be unique, so exports and column mapping can tell them apart.";
        if (!fromBlur) { showEditorError(message + " Type another name, or press Esc."); return Promise.resolve(false); }
        closeEditor(cur);
        toast("error", "Column " + columnName(cur.c) + " was not renamed.", message);
        state.headFocus = -1;
        return Promise.resolve(false);
      }
      text = check.name;
    }
    closeEditor(cur);
    var pending = text !== cur.original ? edit({ kind: "set", cells: [{ r: cur.src, c: cur.c, text: text }] }) : Promise.resolve(true);
    if (cur.header) {
      if (!fromBlur) headerMove(cur.c, move);
      return pending;
    }
    if (move) {
      var r = state.sel.r + (move === "down" ? 1 : move === "up" ? -1 : 0);
      var c = state.sel.c + (move === "right" ? 1 : move === "left" ? -1 : 0);
      if (move === "down" && r >= state.view.length) {
        // Enter on the last row adds one, so a table can be typed in row by row.
        addRowAtEnd();
        return pending;
      }
      if (move === "up" && r < 0 && state.header && state.sheet && state.sheet.rows.length) {
        if (!fromBlur) focusHeader(state.sel.c);
        return pending;
      }
      select(Math.max(0, Math.min(state.view.length - 1, r)), Math.max(0, Math.min(columnCount() - 1, c)), false);
      scrollIntoView(state.sel.r, state.sel.c);
    }
    if (ui.scroller && !fromBlur) ui.scroller.focus({ preventScroll: true });
    return pending;
  }

  /** After a column name is saved: Tab goes on to the next column's name, Enter down into the column. */
  function headerMove(c, move) {
    if (move === "right" || move === "left") {
      var next = c + (move === "right" ? 1 : -1);
      if (next >= 0 && next < columnCount()) { beginHeaderEdit(next, { quiet: true }); if (editor) return; }
      focusHeader(Math.max(0, Math.min(columnCount() - 1, next)));
      return;
    }
    if (move === "down" && state.view.length) {
      state.headFocus = -1;
      select(0, c, false);
      scrollIntoView(0, c);
      ui.scroller.focus({ preventScroll: true });
      return;
    }
    focusHeader(c);
  }

  function cancelEdit() {
    if (!editor) return;
    var cur = editor;
    closeEditor(cur);
    if (cur.header) {
      if (cur.isNew) announce("Column " + columnName(cur.c) + " keeps the name " + cur.original);
      focusHeader(cur.c);
    } else if (ui.scroller) ui.scroller.focus({ preventScroll: true });
  }

  /** Moves keyboard focus to a column's header cell, where Enter or F2 renames it (or sorts, when not editing). */
  function focusHeader(c) {
    if (!state.header || !state.sheet || !state.sheet.rows.length) return;
    state.headFocus = Math.max(0, Math.min(columnCount() - 1, c));
    state.sel.c = state.sel.ac = state.headFocus;
    scrollColumnIntoView(state.headFocus);
    scheduleRender(true);
    renderStatus();
    if (ui.scroller) ui.scroller.focus({ preventScroll: true });
    var name = headerLabel(state.headFocus);
    announce("Column " + columnName(state.headFocus) + " header" + (name ? ", " + name : "") + (state.editing ? ". Enter or F2 renames it." : ". Enter sorts by it."));
  }

  /** Keys while a header cell has focus; true when handled. */
  function onHeadKey(e) {
    var c = state.headFocus;
    var mod = e.metaKey || e.ctrlKey;
    var last = columnCount() - 1;
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); focusHeader(mod ? 0 : c - 1); return true;
      case "ArrowRight": e.preventDefault(); focusHeader(mod ? last : c + 1); return true;
      case "Tab": e.preventDefault(); focusHeader(e.shiftKey ? c - 1 : c + 1); return true;
      case "ArrowUp": e.preventDefault(); return true;
      case "ArrowDown":
      case "Escape":
        e.preventDefault();
        state.headFocus = -1;
        if (state.view.length) { select(0, c, false); scrollIntoView(0, c); announceCell(); } else scheduleRender(true);
        return true;
      case "Enter":
      case "F2":
        e.preventDefault();
        if (state.editing) beginHeaderEdit(c);
        else if (e.key === "Enter") cycleSort(c);
        return true;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return true;
    }
    if (!mod && !e.altKey && e.key.length === 1 && state.editing) { e.preventDefault(); beginHeaderEdit(c, { initial: e.key }); return true; }
    return false;
  }

  /** Keys in the grid while editing; true when handled. */
  function onEditKey(e) {
    var mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); tryEdit(null, false); return true; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearSelection(); return true; }
    if (mod && (e.key === "x" || e.key === "X")) { e.preventDefault(); cutSelection(); return true; }
    if (!mod && !e.altKey && e.key.length === 1) { e.preventDefault(); tryEdit(e.key, false); return true; }
    return false;
  }

  // ------------------------------------------------------------------ editable or read-only
  /*
   * One answer to "can this cell be changed, and if not, why": used by the
   * grid's styling, the status bar, the hint shown on a refused edit, and
   * every action that changes cells.
   */
  function cellLocked(r, c) {
    var p = state.sheet && state.sheet.protection;
    if (!p) return false;
    var own = p.cells[r + ":" + c];
    if (own !== undefined) return own;
    if (p.rows[r] !== undefined) return p.rows[r];
    for (var i = 0; i < p.cols.length; i++) if (c >= p.cols[i][0] && c <= p.cols[i][1]) return p.cols[i][2];
    return p.fallback;
  }

  function access(src, c) {
    if (!state.file || !state.file.editable) return { editable: false, kind: "file", label: "Read-only", reason: (state.file && state.file.readOnlyReason) || "This file can't be edited." };
    if (state.sheet && state.sheet.truncatedRows) return { editable: false, kind: "sheet", label: "Read-only", reason: "Only part of this sheet was loaded, so it can't be edited." };
    if (src !== undefined && cellLocked(src, c)) return { editable: false, kind: "locked", label: "Locked", reason: "This cell is locked: the sheet is protected in Excel. Unprotect it in Excel (Review → Unprotect Sheet) to change it." };
    if (!state.editing) return { editable: false, kind: "view", label: "Read-only", reason: "The file is open read-only. Press Edit to change cells." };
    return { editable: true, kind: "ok", label: "Editable", reason: "" };
  }

  /** Starts editing the active cell, or explains (next to the cell) why it can't be edited. */
  function tryEdit(initial, fromDoubleClick, caretAt) {
    var src = state.view[state.sel.r];
    if (src === undefined) return;
    var a = access(src, state.sel.c);
    if (a.editable) { beginEdit(initial, caretAt); return; }
    var actions = [];
    if (a.kind === "view") actions.push({ label: "Edit cell", icon: "edit", primary: true, run: function () { setEditing(true); beginEdit(initial, caretAt); } });
    if (fromDoubleClick || a.kind !== "view") actions.push({ label: "Inspect", icon: "eye", run: openInspector });
    showCellHint(a.kind === "locked" ? "lock" : a.kind === "view" ? "eye" : "circle-slash", a.kind === "view" ? "Read-only view" : a.label, a.reason, actions);
  }

  var hintEl = null;
  function closeCellHint() { if (hintEl) { hintEl.remove(); hintEl = null; } }

  /** A small card under the active cell; it closes on the next click or key. */
  function showCellHint(iconName, title, text, actions) {
    closeCellHint();
    var cell = ui.body.querySelector('.cell[data-row="' + state.sel.r + '"][data-col="' + state.sel.c + '"]');
    if (cell) { cell.classList.remove("refused"); void cell.offsetWidth; cell.classList.add("refused"); }
    var card = h("div", { class: "cell-hint", role: "alert" },
      h("div", { class: "cell-hint-head" }, icon(iconName), h("b", { text: title })),
      h("div", { class: "cell-hint-text", text: text }),
      actions.length ? h("div", { class: "cell-hint-actions" }, actions.map(function (a) {
        return btn(a.label, a.icon, function () { closeCellHint(); a.run(); }, a.primary ? "primary" : "");
      })) : null);
    document.body.appendChild(card);
    var rect = cell ? cell.getBoundingClientRect() : ui.scroller.getBoundingClientRect();
    var x = Math.max(8, Math.min(rect.left, window.innerWidth - card.offsetWidth - 8));
    var y = rect.bottom + 6;
    if (y + card.offsetHeight > window.innerHeight - 8) y = Math.max(8, rect.top - card.offsetHeight - 6);
    card.style.left = x + "px";
    card.style.top = y + "px";
    hintEl = card;
    var primary = card.querySelector(".btn.primary");
    if (primary) primary.focus();
    announce(title + ". " + text);
  }
  document.addEventListener("mousedown", function (e) { if (hintEl && !hintEl.contains(e.target)) closeCellHint(); }, true);
  document.addEventListener("keydown", function (e) {
    if (!hintEl) return;
    if (e.key === "Escape") { e.preventDefault(); closeCellHint(); if (ui.scroller) ui.scroller.focus({ preventScroll: true }); }
    else if (!hintEl.contains(document.activeElement)) closeCellHint();
  }, true);

  /** Keeps only cells that can be changed; says how many locked ones were left alone. */
  function editableOnly(cells) {
    var kept = cells.filter(function (cell) { return !cellLocked(cell.r, cell.c); });
    var skipped = cells.length - kept.length;
    if (skipped && kept.length) toast("info", "Skipped " + plural(skipped, "locked cell") + ".", "The sheet is protected in Excel; only unlocked cells can be changed.");
    if (skipped && !kept.length) tryEdit(null, false);
    return kept;
  }

  function selectedCells(text) {
    var sel = selection(), cells = [];
    for (var r = sel.r0; r <= sel.r1; r++) {
      var src = state.view[r];
      if (src === undefined) continue;
      for (var c = sel.c0; c <= sel.c1; c++) cells.push({ r: src, c: c, text: text });
    }
    return cells;
  }

  function clearSelection() {
    var cells = editableOnly(selectedCells(""));
    if (cells.length) edit({ kind: "set", cells: cells });
  }

  function cutSelection() {
    var text = selectionTsv();
    call("copy", { text: text }).then(clearSelection, fail);
  }

  /** Splits pasted text into rows of cells: tab-separated (Excel, Sheets) with quoted multi-line cells. */
  function parseTsv(text) {
    var rows = [], row = [], field = "", quoted = false;
    text = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"' && field === "") quoted = true;
      else if (ch === "\t") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
    row.push(field);
    rows.push(row);
    return rows;
  }

  document.addEventListener("paste", function (e) {
    if (!state.editing || !state.sheet || !ui.scroller || document.activeElement !== ui.scroller) return;
    var text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    if (!text) return;
    e.preventDefault();
    var data = parseTsv(text);
    var sel = selection();
    var cells = [];
    if (data.length === 1 && data[0].length === 1 && (sel.r1 > sel.r0 || sel.c1 > sel.c0)) {
      // One value into a selected range fills the range.
      cells = selectedCells(data[0][0]);
    } else {
      var extra = 0;
      for (var i = 0; i < data.length; i++) {
        var vr = sel.r0 + i;
        // Rows past the end are added after the last row.
        var src = vr < state.view.length ? state.view[vr] : state.sheet.rows.length + extra++;
        for (var j = 0; j < data[i].length; j++) cells.push({ r: src, c: sel.c0 + j, text: data[i][j] });
      }
    }
    cells = editableOnly(cells);
    if (cells.length) edit({ kind: "set", cells: cells }).then(function () {
      toast("success", "Pasted " + plural(cells.length, "cell") + ".");
    });
  });

  function selectedSourceRows() {
    var sel = selection(), rows = [];
    for (var r = sel.r0; r <= sel.r1; r++) if (state.view[r] !== undefined) rows.push(state.view[r]);
    return rows;
  }

  function insertRows(below) {
    var rows = selectedSourceRows();
    if (!rows.length) return;
    var at = below ? Math.max.apply(null, rows) + 1 : Math.min.apply(null, rows);
    var count = rows.length;
    structuralEdit({ kind: "insertRows", at: at, count: count }, function () { var vr = state.view.indexOf(at); if (vr !== -1) { select(vr, state.sel.c, false); scrollIntoView(vr, state.sel.c); } });
  }

  function addRowAtEnd() {
    if (!state.sheet) return;
    var at = state.sheet.rows.length;
    var c = state.sel.c;
    structuralEdit({ kind: "insertRows", at: at, count: 1 }, function () {
      var vr = state.view.indexOf(at);
      if (vr === -1) return;
      select(vr, c, false);
      scrollIntoView(vr, c);
      ui.scroller.focus({ preventScroll: true });
    });
  }

  function deleteRows() {
    var rows = selectedSourceRows();
    if (rows.length) structuralEdit({ kind: "deleteRows", rows: rows });
  }

  function insertColumns(right) {
    var sel = selection();
    addColumns(right ? sel.c1 + 1 : sel.c0, sel.c1 - sel.c0 + 1);
  }

  function addColumnAtEnd() {
    if (!state.sheet) return;
    addColumns(columnCount(), 1);
  }

  /** Default names for new columns, when the sheet has a header row whose cells there can be written. */
  function newColumnNames(at, count) {
    if (!state.header || !state.sheet || !state.sheet.rows.length || cellLocked(0, at)) return undefined;
    var names = headerNames();
    names.splice.apply(names, [at, 0].concat(new Array(count).join(",").split(",")));
    return E.defaultColumnNames(names, at, count);
  }

  /**
   * Inserts columns. With a header row they arrive already named ("Column 4"),
   * in the same undo step, and the first one's name opens for typing: Enter
   * keeps what was typed, Esc or an empty name keeps the default.
   */
  function addColumns(at, count) {
    var names = newColumnNames(at, count);
    var row = state.sel.r;
    structuralEdit({ kind: "insertColumns", at: at, count: count, names: names }, function () {
      select(Math.max(0, Math.min(row, state.view.length - 1)), Math.min(at, columnCount() - 1), false);
      scrollIntoView(state.sel.r, state.sel.c);
      if (names) beginHeaderEdit(at, { isNew: true, quiet: true });
      if (!editor) ui.scroller.focus({ preventScroll: true });
    }).then(function (ok) {
      // Widths belong to columns, so they move with them.
      if (ok) { var w = widths(); w.splice.apply(w, [Math.min(at, w.length), 0].concat(new Array(count))); }
    });
  }

  function deleteColumns() {
    var sel = selection(), cols = [];
    for (var c = sel.c0; c <= sel.c1; c++) cols.push(c);
    structuralEdit({ kind: "deleteColumns", cols: cols }).then(function (ok) {
      if (ok) { var w = widths(); for (var i = cols.length - 1; i >= 0; i--) if (cols[i] < w.length) w.splice(cols[i], 1); }
    });
  }

  /** Applies a patch from the host: changed cells in place, or a reload after rows or columns moved. */
  function applyPatch(patch) {
    if (!patch || !state.sheet || patch.sheet !== state.sheetIndex) return;
    // Moved rows and columns change every address, so the unsaved-change marks start over.
    if (patch.kind === "structure") { state.changed.clear(); loadSheet(state.sheetIndex, true, true); return; }
    var sheet = state.sheet;
    var headerChanged = false;
    patch.cells.forEach(function (cell) {
      var key = cell.r + ":" + cell.c;
      while (sheet.rows.length <= cell.r) sheet.rows.push([]);
      var row = sheet.rows[cell.r];
      if (cell.v !== null || cell.c < row.length) {
        while (row.length < cell.c) row.push(null);
        row[cell.c] = cell.v;
      }
      while (row.length && (row[row.length - 1] === null || row[row.length - 1] === undefined)) row.pop();
      if (cell.f !== undefined) (sheet.formulas = sheet.formulas || {})[key] = cell.f; else if (sheet.formulas) delete sheet.formulas[key];
      if (cell.d !== undefined) (sheet.display = sheet.display || {})[key] = cell.d; else if (sheet.display) delete sheet.display[key];
      if (cell.r === 0 && state.header) headerChanged = true;
      state.changed.add(key);
    });
    sheet.rows.length = Math.min(sheet.rows.length, patch.rowCount);
    var countChanged = sheet.columnCount !== patch.columnCount;
    sheet.columnCount = patch.columnCount;
    // Rows added past the end join the view; rows an undo took away leave it.
    var start = dataStart();
    var inView = new Set(state.view);
    state.view = state.view.filter(function (r) { return r < sheet.rows.length; });
    for (var r = start; r < sheet.rows.length; r++) if (!inView.has(r)) state.view.push(r);
    state.kinds = inferKinds();
    state.viewVersion++;
    statsCache = {};
    if (headerChanged || countChanged) { autoSizeColumns(false); renderToolbarState(); }
    clampSelection();
    layoutGrid();
    renderStatus();
  }

  // ------------------------------------------------------------------ export
  function rowTexts(src) {
    var out = [];
    for (var c = 0; c < columnCount(); c++) out.push(cellText(src, c));
    return out;
  }

  function selectionTsv() {
    var sel = selection();
    var lines = [];
    for (var r = sel.r0; r <= sel.r1; r++) {
      var src = state.view[r];
      var cells = [];
      for (var c = sel.c0; c <= sel.c1; c++) {
        var t = cellText(src, c);
        cells.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
      }
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  }

  function copyText(text, message) { call("copy", { text: text }).then(function () { toast("success", message); }, fail); }

  /** Column names for exports: the header row, or column letters, made unique. */
  function exportNames() {
    var seen = {};
    var names = [];
    for (var c = 0; c < columnCount(); c++) {
      var base = (headerLabel(c) || "").trim() || columnName(c);
      var name = base, i = 2;
      while (seen[name]) name = base + "_" + i++;
      seen[name] = true;
      names.push(name);
    }
    return names;
  }

  /** Values as exported: numbers and booleans stay typed; dates and text are strings. */
  function exportValue(src, c) {
    var v = rawAt(src, c);
    var key = src + ":" + c;
    if (state.sheet.display && state.sheet.display[key] !== undefined && typeof v === "string") return state.sheet.display[key];
    return v;
  }

  /** CSV text that is exactly a number becomes a JSON number; "02134" or "1e3" stay text. */
  function jsonValue(v) {
    return typeof v === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) && String(Number(v)) === v ? Number(v) : v;
  }

  function csvField(v, d) {
    var t = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
    return t.indexOf(d) !== -1 || /["\r\n]/.test(t) || /^\s|\s$/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function buildExport(format) {
    var names = exportNames();
    var n = columnCount();
    var view = state.view;
    var lines = [];
    if (format === "csv" || format === "tsv") {
      var d = format === "tsv" ? "\t" : ",";
      if (state.header) lines.push(names.map(function (x) { return csvField(x, d); }).join(d));
      view.forEach(function (src) {
        var cells = [];
        for (var c = 0; c < n; c++) cells.push(csvField(exportValue(src, c), d));
        lines.push(cells.join(d));
      });
      return lines.join("\r\n") + "\r\n";
    }
    if (format === "json") {
      var records = view.map(function (src) {
        var o = {};
        for (var c = 0; c < n; c++) o[names[c]] = jsonValue(exportValue(src, c));
        return o;
      });
      return JSON.stringify(records, null, 2) + "\n";
    }
    // Markdown
    var esc = function (t) { return String(t === null || t === undefined ? "" : t).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>"); };
    lines.push("| " + names.map(esc).join(" | ") + " |");
    lines.push("|" + names.map(function (_x, c) { return state.kinds[c] === "number" ? " ---: " : " --- "; }).join("|") + "|");
    view.forEach(function (src) { lines.push("| " + rowTexts(src).map(esc).join(" | ") + " |"); });
    return lines.join("\n") + "\n";
  }

  function exportName(ext) {
    var base = state.file.name.replace(/\.[^.]+$/, "");
    if (state.file.format === "xlsx") base += " - " + state.file.sheets[state.sheetIndex].name;
    return base + "." + ext;
  }

  function exportItems() {
    var rows = state.view.length;
    var what = state.query ? plural(rows, "matching row") : plural(rows, "row");
    var big = rows > 200000;
    return [
      { label: "Save as CSV…", icon: "save", hint: what, run: function () { saveAs("csv"); } },
      { label: "Save as JSON…", icon: "json", run: function () { saveAs("json"); } },
      "-",
      { label: "Open as JSON", icon: "json", run: function () { openAs("json", "json"); }, disabled: big },
      { label: "Open as CSV", icon: "file", run: function () { openAs("csv", "csv"); }, disabled: big },
      { label: "Open as Markdown table", icon: "markdown", run: function () { openAs("md", "markdown"); }, disabled: big || rows > 5000 },
      "-",
      { label: "Copy as CSV", icon: "copy", run: function () { copyText(buildExport("csv"), "Copied " + what + " as CSV."); } },
      { label: "Copy as TSV (paste into Excel)", icon: "copy", run: function () { copyText(buildExport("tsv"), "Copied " + what + " as TSV."); } },
      { label: "Copy as JSON", icon: "copy", run: function () { copyText(buildExport("json"), "Copied " + what + " as JSON."); } },
      { label: "Copy as Markdown", icon: "copy", run: function () { copyText(buildExport("md"), "Copied " + what + " as Markdown."); }, disabled: rows > 5000 }
    ];
  }

  function moreItems() {
    var items = [];
    if (state.source === "file") {
      items.push({ label: "Reload from disk", icon: "refresh", run: reloadFromDisk });
      if (state.file.format !== "xlsx") items.push({ label: "Open as text", icon: "go-to-file", run: function () { call("reopenAsText").catch(fail); } });
    }
    items.push({ label: "Fit all columns", icon: "arrow-both", run: function () { autoSizeColumns(true); layoutGrid(); } });
    if (state.sort) items.push({ label: "Clear sort", icon: "close", run: function () { setSort(0, null); } });
    items.push("-");
    items.push({ label: "Open another file…", icon: "folder-opened", run: function () { call("open", { format: state.file.format }).catch(fail); } });
    return items;
  }

  function saveAs(format) {
    call("save", { content: buildExport(format), name: exportName(format) }).then(function (r) {
      if (r && r.saved) toast("success", "Saved " + r.name + ".");
    }, fail);
  }

  function openAs(format, language) {
    call("openDocument", { content: buildExport(format), language: language }).catch(fail);
  }

  boot();
})();
