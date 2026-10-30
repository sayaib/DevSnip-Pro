/* DevSnip Pro - Database Client webview.
 *
 * Talks to the extension host only through call(method, params), which
 * resolves with the host's result or rejects with { message, hint }. The host
 * validates every request again and owns all confirmations for destructive
 * actions, so nothing here is a security boundary.
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();
  var root = document.getElementById("app");
  var MAC = document.body.getAttribute("data-platform") === "darwin";
  var MOD = MAC ? "⌘" : "Ctrl+";

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
        err.position = m.error && m.error.position;
        err.code = m.error && m.error.code;
        p.reject(err);
      }
    } else if (m.type === "connections") {
      onConnections(m.connections || []);
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
        else if (key === "checked" || key === "disabled" || key === "selected" || key === "readOnly") el[key] = !!v;
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
  function compact(n) {
    if (typeof n !== "number" || n < 0) return "";
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "k";
    if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, "") + "M";
    return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  }
  function plural(n, word) { return fmtNum(n) + " " + word + (n === 1 ? "" : "s"); }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ------------------------------------------------------------------ Toasts
  var toastsEl = document.getElementById("toasts");
  function toast(kind, message, hint) {
    var el = h("div", { class: "toast " + kind },
      icon(kind === "success" ? "pass-filled" : kind === "error" ? "error" : "info"),
      h("div", null, message, hint ? h("span", { class: "hint", text: hint }) : null));
    toastsEl.appendChild(el);
    setTimeout(function () { el.classList.add("out"); setTimeout(function () { el.remove(); }, 220); }, kind === "error" ? 7000 : 3200);
  }
  function fail(err) { toast("error", err.message || String(err), err.hint); }

  // ------------------------------------------------------------------ State
  var saved = vscode.getState() || {};
  var S = {
    ready: false,
    connections: [],
    kinds: {},
    filterOps: [],
    limits: { maxPageSize: 500, maxQueryRows: 1000 },
    tree: {},
    tabs: [],
    active: null,
    sideWidth: saved.sideWidth || 280,
    sideFilter: "",
    history: saved.history || {},
    queryCounter: saved.queryCounter || 0,
    connMode: saved.connMode || "form"
  };

  var OPS = {
    eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
    contains: "contains", starts: "starts with", ends: "ends with", null: "is null", notnull: "is not null", in: "in list"
  };
  var KIND_ABBR = { postgres: "PG", cockroachdb: "CR", mysql: "MY", mariadb: "MA", sqlserver: "MS", oracle: "OR", sqlite: "SL", clickhouse: "CH", mongodb: "MG", redis: "RD" };
  var KIND_COLOR = { postgres: "#336791", cockroachdb: "#6933ff", mysql: "#00758f", mariadb: "#a5563b", sqlserver: "#a91d22", oracle: "#c74634", sqlite: "#0f80cc", clickhouse: "#8a7a00", mongodb: "#13aa52", redis: "#d82c20" };
  var FEATURE_LABELS = [["editRows", "Edit rows"], ["indexes", "Indexes"], ["cancel", "Cancel queries"], ["serverReadOnly", "Server read-only"]];
  var COLORS = ["blue", "green", "orange", "red", "purple", "teal", "gray"];
  var REDIS_TYPES = ["string", "hash", "list", "set", "zset"];
  var HIDDEN_COLS = { __rowid: 1, __ctid: 1 };

  function conn(id) { return S.connections.find(function (c) { return c.id === id; }); }
  function colorVar(c) { return c && c.color ? "var(--c-" + c.color + ")" : "var(--c-blue)"; }
  function family(c) { return c ? c.family : "sql"; }
  function tabById(id) { return S.tabs.find(function (t) { return t.id === id; }); }

  function persist() {
    try {
      vscode.setState({
        sideWidth: S.sideWidth,
        history: S.history,
        queryCounter: S.queryCounter,
        connMode: S.connMode,
        active: S.active,
        tabs: S.tabs.map(function (t) {
          if (t.type === "query") return { id: t.id, type: t.type, connId: t.connId, database: t.database, schema: t.schema, text: t.editor ? t.editor.value : t.text, title: t.title, editorH: t.editorH };
          return { id: t.id, type: t.type, connId: t.connId, target: t.target, objectType: t.objectType, title: t.title, mode: t.mode, pageSize: t.pageSize, sort: t.sort, filters: t.filters, search: t.search, query: t.query, keyType: t.keyType, colWidths: t.colWidths };
        })
      });
    } catch (e) { /* state is a convenience only */ }
  }
  var persistSoon = debounce(persist, 400);

  // ------------------------------------------------------------------ Menus
  var openMenuEl = null;
  function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
  function showMenu(items, at) {
    closeMenu();
    var menu = h("div", { class: "menu", role: "menu" });
    items.forEach(function (item) {
      if (!item) return;
      if (item === "-") { menu.appendChild(h("hr")); return; }
      var b = h("button", { type: "button", role: "menuitem", class: item.danger ? "danger" : "", disabled: item.disabled }, icon(item.icon || "blank"), h("span", { class: "grow", text: item.label }));
      b.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(); item.run(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var rect = at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = Math.min(rect.left, window.innerWidth - mw - 6);
    var y = rect.bottom + 2;
    if (y + mh > window.innerHeight - 6) y = Math.max(6, rect.top - mh - 2);
    menu.style.left = Math.max(6, x) + "px";
    menu.style.top = y + "px";
    openMenuEl = menu;
    var first = menu.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }
  document.addEventListener("mousedown", function (e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); });
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);

  // ------------------------------------------------------------------ Overlays (modal / drawer)
  var overlays = [];
  function openOverlay(el, onClose) {
    var entry = { el: el, onClose: onClose };
    overlays.push(entry);
    document.body.appendChild(el);
    return function close() {
      var i = overlays.indexOf(entry);
      if (i >= 0) overlays.splice(i, 1);
      el.remove();
    };
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (openMenuEl) { closeMenu(); e.preventDefault(); return; }
      var top = overlays[overlays.length - 1];
      if (top && top.onClose) { top.onClose(); e.preventDefault(); return; }
      if (root.classList.contains("side-open")) { root.classList.remove("side-open"); e.preventDefault(); }
    }
  });

  // ------------------------------------------------------------------ Layout
  var els = {};
  function layout() {
    clear(root);
    root.removeAttribute("aria-busy");
    root.style.setProperty("--side-w", S.sideWidth + "px");
    els.side = h("aside", { class: "side", "aria-label": "Connections" });
    els.resizer = h("div", { class: "resizer", role: "separator", "aria-orientation": "vertical", title: "Drag to resize" });
    els.main = h("main", { class: "main" });
    els.tabbar = h("div", { class: "tabbar", role: "tablist" });
    els.views = h("div", { class: "views" });
    els.main.append(els.tabbar, els.views);
    var scrim = h("div", { class: "scrim", onclick: function () { root.classList.remove("side-open"); } });
    root.append(els.side, els.resizer, els.main, scrim);
    wireResizer();
    renderSide();
    renderTabs();
    showActiveView();
  }

  function wireResizer() {
    var startX = 0, startW = 0;
    function move(e) {
      S.sideWidth = Math.max(200, Math.min(520, startW + e.clientX - startX));
      root.style.setProperty("--side-w", S.sideWidth + "px");
    }
    function up() {
      els.resizer.classList.remove("dragging");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      persist();
    }
    els.resizer.addEventListener("mousedown", function (e) {
      startX = e.clientX; startW = S.sideWidth;
      els.resizer.classList.add("dragging");
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      e.preventDefault();
    });
  }

  // ------------------------------------------------------------------ Sidebar tree
  function treeOf(id) {
    if (!S.tree[id]) S.tree[id] = { open: false, loading: false, error: null, dbs: null };
    return S.tree[id];
  }

  function renderSide() {
    if (!els.side) return;
    var scroll = els.tree ? els.tree.scrollTop : 0;
    clear(els.side);
    var head = h("div", { class: "side-head" },
      h("h2", { text: "Connections" }),
      iconBtn("add", "New connection", function () { openConnectionModal(null); }),
      iconBtn("collapse-all", "Collapse all", function () {
        Object.keys(S.tree).forEach(function (k) { S.tree[k].open = false; });
        renderSide();
      }));
    var filterInput = h("input", { class: "input", type: "search", placeholder: "Filter tables and collections…", value: S.sideFilter, "aria-label": "Filter tables" });
    filterInput.addEventListener("input", debounce(function () { S.sideFilter = filterInput.value.trim().toLowerCase(); renderTree(); }, 120));
    els.tree = h("div", { class: "tree", role: "tree" });
    els.side.append(head);
    if (S.connections.length) els.side.append(h("div", { class: "side-filter" }, h("div", { class: "search" }, icon("filter"), filterInput)));
    els.side.append(els.tree, h("div", { class: "side-foot" }, icon("lock"), h("span", { text: "Credentials stay in your OS keychain." })));
    renderTree();
    els.tree.scrollTop = scroll;
  }

  function renderTree() {
    if (!els.tree) return;
    var scroll = els.tree.scrollTop;
    clear(els.tree);
    if (!S.connections.length) {
      els.tree.append(h("div", { class: "empty-side" },
        h("div", { text: "No saved connections yet." }),
        h("div", { text: "Connect to PostgreSQL, CockroachDB, MySQL, MariaDB, SQL Server, Oracle, SQLite, ClickHouse, MongoDB or Redis." }),
        btn("New connection", "add", function () { openConnectionModal(null); }, "primary")));
      return;
    }
    S.connections.forEach(function (c) { els.tree.append(connNode(c)); });
    els.tree.scrollTop = scroll;
  }

  function nodeEl(depth, opts) {
    var el = h("div", { class: "node " + (opts.cls || ""), role: "treeitem", tabindex: "0", "aria-expanded": opts.expandable ? String(!!opts.open) : null, title: opts.title || null, style: { paddingLeft: (6 + depth * 14) + "px" } });
    el.append(h("span", { class: "twistie" }, opts.expandable ? icon(opts.loading ? "loading" : opts.open ? "chevron-down" : "chevron-right", opts.loading ? "codicon-modifier-spin" : "") : null));
    if (opts.lead) el.append(opts.lead);
    el.append(opts.label);
    if (opts.trail) append(el, opts.trail);
    if (opts.acts && opts.acts.length) el.append(h("span", { class: "acts" }, opts.acts));
    el.addEventListener("click", function () { opts.onClick && opts.onClick(); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onClick && opts.onClick(); }
      if (e.key === "ArrowRight" && opts.expandable && !opts.open) { e.preventDefault(); opts.onClick && opts.onClick(); }
      if (e.key === "ArrowLeft" && opts.expandable && opts.open) { e.preventDefault(); opts.onClick && opts.onClick(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var all = Array.prototype.slice.call(els.tree.querySelectorAll(".node"));
        var next = all[all.indexOf(el) + (e.key === "ArrowDown" ? 1 : -1)];
        if (next) next.focus();
      }
    });
    if (opts.menu) el.addEventListener("contextmenu", function (e) { e.preventDefault(); showMenu(opts.menu(), { x: e.clientX, y: e.clientY }); });
    return el;
  }

  function statusText(c) {
    if (c.status === "connecting") return "Connecting…";
    if (c.status === "connected") return c.version || "Connected";
    if (c.status === "error") return "Connection failed";
    return c.kindLabel;
  }

  function connMenu(c) {
    var connected = c.status === "connected";
    return [
      connected ? { label: "Disconnect", icon: "debug-disconnect", run: function () { disconnect(c.id); } } : { label: "Connect", icon: "plug", run: function () { expandConn(c, true); } },
      { label: "Reconnect", icon: "debug-restart", run: function () { reconnect(c.id); }, disabled: c.status === "connecting" },
      "-",
      { label: "New query", icon: "terminal", run: function () { openQueryTab(c.id); } },
      { label: "Refresh", icon: "refresh", run: function () { refreshConn(c.id); }, disabled: !connected },
      "-",
      { label: "Edit connection…", icon: "edit", run: function () { openConnectionModal(c.id); } },
      { label: "Remove connection…", icon: "trash", danger: true, run: function () { removeConnection(c.id); } }
    ];
  }

  function connNode(c) {
    var t = treeOf(c.id);
    var wrap = h("div", { role: "group" });
    var lead = h("span", { class: "kind-icon", title: c.kindLabel, style: { "--conn-color": KIND_COLOR[c.kind] } }, KIND_ABBR[c.kind] || "DB");
    var label = h("span", { class: "label" }, h("div", { text: c.name }), h("div", { class: "sub", text: statusText(c) }));
    var trail = [
      c.readOnly ? h("span", { title: "Read-only connection" }, icon("lock", "lock")) : null,
      h("span", { class: "dot " + c.status, title: c.status === "error" && c.error ? c.error.message : c.status, role: "img", "aria-label": c.status })
    ];
    var node = nodeEl(0, {
      cls: "conn", expandable: true, open: t.open, loading: c.status === "connecting" || t.loading, lead: lead, label: label, trail: trail,
      title: c.display,
      acts: [
        iconBtn("terminal", "New query", function () { openQueryTab(c.id); }),
        c.status === "connected" ? iconBtn("refresh", "Refresh", function () { refreshConn(c.id); }) : null,
        iconBtn("ellipsis", "More actions", function (e) { showMenu(connMenu(c), e.currentTarget); })
      ],
      menu: function () { return connMenu(c); },
      onClick: function () {
        if (t.open) { t.open = false; renderTree(); }
        else expandConn(c, false);
      }
    });
    node.style.setProperty("--conn-color", colorVar(c));
    node.style.boxShadow = "inset 2px 0 0 " + colorVar(c);
    wrap.append(node);
    if (c.status === "error" && c.error) {
      wrap.append(h("div", { class: "node-msg error" },
        h("div", { text: c.error.message }), c.error.hint ? h("div", { class: "muted", text: c.error.hint }) : null,
        h("div", null, btn("Reconnect", "debug-restart", function () { reconnect(c.id); }), " ", btn("Edit", "edit", function () { openConnectionModal(c.id); }, "ghost"))));
    }
    if (t.open && c.status === "connected") {
      if (t.error) wrap.append(h("div", { class: "node-msg error" }, h("div", { text: t.error.message }), h("div", null, btn("Retry", "refresh", function () { loadDatabases(c.id); }))));
      else if (t.dbs) t.dbs.forEach(function (db) { wrap.append(dbNode(c, db)); });
    }
    return wrap;
  }

  function dbLabel(c, name) { return c.kind === "redis" ? "db" + name : name; }

  function dbNode(c, db) {
    var wrap = h("div", { role: "group" });
    var isRedis = c.kind === "redis";
    var isDefault = c.defaultDatabase === db.name;
    var acts = [iconBtn("terminal", "New query in " + dbLabel(c, db.name), function () { openQueryTab(c.id, { database: db.name }); })];
    if (c.kind === "mongodb" && !c.readOnly) acts.push(iconBtn("add", "New collection", function () { promptNewCollection(c, db); }));
    if (!isRedis) acts.push(iconBtn("refresh", "Refresh", function () { db.objects = null; db.schemas = null; db.open = true; loadDbChildren(c, db); }));
    var activeTab = tabById(S.active);
    var isActive = isRedis && activeTab && activeTab.connId === c.id && activeTab.target && activeTab.target.database === db.name;
    var node = nodeEl(1, {
      cls: isActive ? "active" : "",
      expandable: !isRedis, open: db.open, loading: db.loading,
      lead: icon("database", "obj-icon"),
      label: h("span", { class: "label" }, dbLabel(c, db.name), isDefault && !isRedis && c.kind !== "sqlite" ? h("span", { class: "muted", text: "  default" }) : null),
      trail: isRedis && typeof db.keys === "number" ? h("span", { class: "badge", text: compact(db.keys) }) : null,
      acts: acts,
      menu: function () {
        return [
          isRedis ? { label: "Browse keys", icon: "key", run: function () { openDataTab(c.id, { database: db.name, object: "keys" }, "keys"); } } : null,
          { label: "New query", icon: "terminal", run: function () { openQueryTab(c.id, { database: db.name }); } },
          c.kind === "mongodb" && !c.readOnly ? { label: "New collection…", icon: "add", run: function () { promptNewCollection(c, db); } } : null,
          isRedis && !c.readOnly ? "-" : null,
          isRedis && !c.readOnly ? { label: "Empty database (FLUSHDB)…", icon: "trash", danger: true, run: function () { destructive(c.id, { database: db.name, object: "keys" }, "dropObject"); } } : null
        ];
      },
      onClick: function () {
        if (isRedis) { openDataTab(c.id, { database: db.name, object: "keys" }, "keys"); return; }
        db.open = !db.open;
        if (db.open && !db.objects && !db.schemas) loadDbChildren(c, db);
        else renderTree();
      }
    });
    wrap.append(node);
    if (!db.open || isRedis) return wrap;
    if (db.error) wrap.append(h("div", { class: "node-msg error" }, h("div", { text: db.error.message }), h("div", null, btn("Retry", "refresh", function () { loadDbChildren(c, db); }))));
    if (c.schemas && db.schemas) {
      db.schemas.forEach(function (schema) { wrap.append(schemaNode(c, db, schema)); });
      if (!db.schemas.length && !db.loading) wrap.append(h("div", { class: "node-msg info", text: "No schemas you can read." }));
    } else if (db.objects) {
      appendObjects(wrap, c, db, null, db.objects, 2);
    }
    return wrap;
  }

  function schemaNode(c, db, schema) {
    var wrap = h("div", { role: "group" });
    wrap.append(nodeEl(2, {
      expandable: true, open: schema.open, loading: schema.loading,
      lead: icon("symbol-namespace", "obj-icon"),
      label: h("span", { class: "label", text: schema.name }),
      acts: [iconBtn("refresh", "Refresh", function () { schema.objects = null; schema.open = true; loadSchemaObjects(c, db, schema); })],
      onClick: function () {
        schema.open = !schema.open;
        if (schema.open && !schema.objects) loadSchemaObjects(c, db, schema);
        else renderTree();
      }
    }));
    if (schema.open) {
      if (schema.error) wrap.append(h("div", { class: "node-msg error" }, h("div", { text: schema.error.message }), h("div", null, btn("Retry", "refresh", function () { loadSchemaObjects(c, db, schema); }))));
      if (schema.objects) appendObjects(wrap, c, db, schema, schema.objects, 3);
    }
    return wrap;
  }

  function appendObjects(wrap, c, db, schema, objects, depth) {
    var f = S.sideFilter;
    var list = f ? objects.filter(function (o) { return o.name.toLowerCase().indexOf(f) >= 0; }) : objects;
    if (!objects.length) { wrap.append(h("div", { class: "node-msg info", style: { marginLeft: (20 + depth * 14) + "px" }, text: c.kind === "mongodb" ? "No collections." : "No tables." })); return; }
    if (!list.length) { wrap.append(h("div", { class: "node-msg info", style: { marginLeft: (20 + depth * 14) + "px" }, text: "No match for “" + f + "”." })); return; }
    var activeTab = tabById(S.active);
    list.slice(0, 2000).forEach(function (o) {
      var target = { database: db.name, schema: schema ? schema.name : undefined, object: o.name };
      var isActive = activeTab && activeTab.type === "data" && activeTab.connId === c.id && sameTarget(activeTab.target, target);
      var iconName = o.type === "view" ? "eye" : o.type === "collection" ? "symbol-array" : "table";
      wrap.append(nodeEl(depth, {
        cls: isActive ? "active" : "",
        lead: icon(iconName, "obj-icon obj-" + o.type),
        label: h("span", { class: "label", text: o.name }),
        trail: typeof o.rows === "number" ? h("span", { class: "badge", title: "About " + fmtNum(o.rows) + (c.kind === "mongodb" ? " documents" : " rows"), text: compact(o.rows) }) : null,
        acts: [iconBtn("terminal", "Query " + o.name, function () { openQueryTab(c.id, { database: db.name, schema: target.schema, text: starterQuery(c, target) }); }),
          iconBtn("ellipsis", "More actions", function (e) { showMenu(objectMenu(c, target, o), e.currentTarget); })],
        menu: function () { return objectMenu(c, target, o); },
        onClick: function () { openDataTab(c.id, target, o.type); }
      }));
    });
  }

  function objectMenu(c, target, o) {
    var writable = !c.readOnly && o.type !== "view";
    var noun = c.kind === "mongodb" ? "collection" : o.type === "view" ? "view" : "table";
    return [
      { label: "Open data", icon: "table", run: function () { openDataTab(c.id, target, o.type); } },
      { label: "View structure", icon: "symbol-structure", run: function () { openDataTab(c.id, target, o.type, "structure"); } },
      { label: "New query", icon: "terminal", run: function () { openQueryTab(c.id, { database: target.database, schema: target.schema, text: starterQuery(c, target) }); } },
      { label: "Copy name", icon: "copy", run: function () { copy(qualify(c, target)); } },
      "-",
      { label: "Empty " + noun + "…", icon: "clear-all", danger: true, disabled: !writable, run: function () { destructive(c.id, target, "truncateObject"); } },
      { label: "Drop " + noun + "…", icon: "trash", danger: true, disabled: c.readOnly, run: function () { destructive(c.id, target, "dropObject"); } }
    ];
  }

  function sameTarget(a, b) { return a && b && a.object === b.object && (a.database || "") === (b.database || "") && (a.schema || "") === (b.schema || ""); }

  function quoteIdent(kind, name) {
    if (kind === "mysql") return "`" + name.replace(/`/g, "``") + "`";
    if (kind === "sqlserver") return "[" + name.replace(/]/g, "]]") + "]";
    return /^[a-z_][a-z0-9_]*$/.test(name) ? name : '"' + name.replace(/"/g, '""') + '"';
  }
  function qualify(c, t) {
    if (c.kind === "mongodb" || c.kind === "redis") return t.object;
    var parts = [];
    if (t.schema && (c.kind === "postgres" ? t.schema !== "public" : c.kind === "sqlserver")) parts.push(quoteIdent(c.kind, t.schema));
    parts.push(quoteIdent(c.kind, t.object));
    return parts.join(".");
  }
  function starterQuery(c, t) {
    if (c.kind === "mongodb") return (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t.object) ? "db." + t.object : "db.getCollection(" + JSON.stringify(t.object) + ")") + ".find({}).limit(20)";
    if (c.kind === "redis") return "SCAN 0 MATCH * COUNT 100";
    if (c.kind === "sqlserver") return "SELECT TOP 100 * FROM " + qualify(c, t) + ";";
    return "SELECT * FROM " + qualify(c, t) + " LIMIT 100;";
  }

  // ------------------------------------------------------------------ Tree loading
  function expandConn(c, force) {
    var t = treeOf(c.id);
    t.open = true;
    renderTree();
    if (c.status === "connected" && !force) { if (!t.dbs) loadDatabases(c.id); return; }
    call("connect", { id: c.id }).then(function () { loadDatabases(c.id); }).catch(function () { /* status + error render in the tree */ });
  }

  function loadDatabases(id) {
    var c = conn(id);
    if (!c) return;
    var t = treeOf(id);
    t.loading = true; t.error = null;
    renderTree();
    call("listDatabases", { id: id }).then(function (res) {
      var previous = {};
      (t.dbs || []).forEach(function (d) { previous[d.name] = d; });
      t.dbs = res.databases.map(function (name) { return previous[name] || { name: name, open: false, loading: false, error: null, schemas: null, objects: null }; });
      t.loading = false;
      var c2 = conn(id);
      if (res.sizes) t.dbs.forEach(function (d) { d.keys = res.sizes[d.name] || 0; });
      // Open the database the connection string points at (or the only one).
      var auto = t.dbs.length === 1 ? t.dbs[0] : t.dbs.find(function (d) { return d.name === res.defaultDatabase; });
      if (auto && c2 && c2.kind !== "redis" && !auto.open && !auto.objects && !auto.schemas) { auto.open = true; loadDbChildren(c2, auto); }
      else renderTree();
    }).catch(function (err) { t.loading = false; t.error = err; renderTree(); });
  }

  /** Redis key counts for every database, from one INFO call on the host. */
  function loadRedisCounts(c, t) {
    call("listDatabases", { id: c.id }).then(function (res) {
      if (!res.sizes || !t.dbs) return;
      t.dbs.forEach(function (d) { d.keys = res.sizes[d.name] || 0; });
      renderTree();
    }).catch(function () { /* counts are decoration */ });
  }

  function loadDbChildren(c, db) {
    db.loading = true; db.error = null;
    renderTree();
    var req = c.schemas ? call("listSchemas", { id: c.id, database: db.name }) : call("listObjects", { id: c.id, database: db.name });
    req.then(function (list) {
      db.loading = false;
      if (c.schemas) {
        db.schemas = list.map(function (name) { return { name: name, open: false, loading: false, error: null, objects: null }; });
        var first = db.schemas[0];
        if (first) { first.open = true; loadSchemaObjects(c, db, first); return; }
      } else db.objects = list;
      renderTree();
    }).catch(function (err) { db.loading = false; db.error = err; renderTree(); });
  }

  function loadSchemaObjects(c, db, schema) {
    schema.loading = true; schema.error = null;
    renderTree();
    call("listObjects", { id: c.id, database: db.name, schema: schema.name }).then(function (list) {
      schema.loading = false; schema.objects = list; renderTree();
    }).catch(function (err) { schema.loading = false; schema.error = err; renderTree(); });
  }

  function refreshConn(id) {
    var t = treeOf(id);
    call("refresh", { id: id }).catch(function () { /* reconnects on demand */ });
    t.open = true;
    (t.dbs || []).forEach(function (db) { db.objects = null; db.schemas = db.open ? null : db.schemas; });
    loadDatabases(id);
    S.tabs.forEach(function (tab) { if (tab.connId === id && tab.type === "data" && tab.id === S.active) loadTab(tab); });
  }

  /** Re-reads the objects of one database after a structural change. */
  function refreshDb(id, database) {
    var t = treeOf(id);
    var c = conn(id);
    var db = (t.dbs || []).find(function (d) { return d.name === database; });
    if (!c || !db) return;
    if (c.schemas && db.schemas) db.schemas.forEach(function (s) { if (s.open) loadSchemaObjects(c, db, s); else s.objects = null; });
    else if (db.open) loadDbChildren(c, db);
    else db.objects = null;
  }

  function reconnect(id) {
    var t = treeOf(id);
    t.open = true; t.dbs = null; t.error = null;
    renderTree();
    call("connect", { id: id }).then(function () { loadDatabases(id); toast("success", "Reconnected to " + (conn(id) || {}).name + "."); }).catch(function () { /* shown on the node */ });
  }

  function disconnect(id) {
    call("disconnect", { id: id }).then(function () {
      var t = treeOf(id);
      t.open = false; t.dbs = null;
      renderTree();
    }).catch(fail);
  }

  function removeConnection(id) {
    call("removeConnection", { id: id }).then(function (res) {
      if (!res || !res.removed) return;
      delete S.tree[id];
      S.tabs.filter(function (t) { return t.connId === id; }).forEach(function (t) { closeTab(t.id, true); });
      toast("success", "Connection removed.");
    }).catch(fail);
  }

  function promptNewCollection(c, db) {
    var input = h("input", { class: "input", placeholder: "collection_name", "aria-label": "Collection name" });
    var error = h("div");
    var close;
    function submit() {
      var name = input.value.trim();
      if (!name) { input.classList.add("invalid"); return; }
      createBtn.disabled = true;
      call("createCollection", { id: c.id, database: db.name, name: name }).then(function () {
        close();
        toast("success", "Created collection " + name + ".");
        db.objects = null; db.open = true; loadDbChildren(c, db);
        openDataTab(c.id, { database: db.name, object: name }, "collection");
      }).catch(function (err) { createBtn.disabled = false; clear(error).append(formError(err)); });
    }
    var createBtn = btn("Create", "add", submit, "primary");
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    var overlay = h("div", { class: "overlay", onclick: function (e) { if (e.target === overlay) close(); } },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": "New collection", style: { width: "min(420px, calc(100vw - 32px))" } },
        h("div", { class: "mhead" }, h("h3", { text: "New collection in " + db.name }), iconBtn("close", "Close", function () { close(); })),
        h("div", { class: "mbody" }, h("div", { class: "field" }, h("label", { text: "Name" }), input), error),
        h("div", { class: "mfoot" }, h("span", { class: "spacer" }), btn("Cancel", null, function () { close(); }), createBtn)));
    close = openOverlay(overlay, function () { close(); });
    input.focus();
  }

  function destructive(id, target, method) {
    call(method, { id: id, target: target }).then(function (res) {
      if (!res || res.cancelled) return;
      var c = conn(id);
      toast("success", method === "dropObject" ? (c && c.kind === "redis" ? "Database emptied." : "Dropped " + target.object + ".") : "Emptied " + target.object + ".");
      if (method === "dropObject" && c && c.kind !== "redis") {
        S.tabs.filter(function (t) { return t.type === "data" && t.connId === id && sameTarget(t.target, target); }).forEach(function (t) { closeTab(t.id, true); });
      } else {
        S.tabs.filter(function (t) { return t.type === "data" && t.connId === id && sameTarget(t.target, target); }).forEach(function (t) { t.page = 1; loadTab(t); });
      }
      if (c && c.kind === "redis") { var tr = treeOf(id); if (tr.dbs) loadRedisCounts(c, tr); }
      else refreshDb(id, target.database);
    }).catch(fail);
  }

  function copy(text) {
    call("copyText", { text: text }).then(function () { toast("success", "Copied to the clipboard."); }).catch(fail);
  }

  // ------------------------------------------------------------------ Connections from the host
  function onConnections(list) {
    var before = {};
    S.connections.forEach(function (c) { before[c.id] = c.status; });
    S.connections = list;
    Object.keys(S.tree).forEach(function (id) {
      var c = conn(id);
      if (!c) { delete S.tree[id]; return; }
      if (c.status !== "connected" && before[id] === "connected") { S.tree[id].dbs = null; }
    });
    S.tabs.filter(function (t) { return !conn(t.connId); }).forEach(function (t) { closeTab(t.id, true); });
    renderTree();
    renderTabs();
    S.tabs.forEach(function (t) { if (t.type === "query" && t.ui) updateQueryBar(t); if (t.type === "data" && t.ui) updateDataChrome(t); });
    if (!S.tabs.length) showActiveView();
  }

  // ------------------------------------------------------------------ Tabs
  function renderTabs() {
    if (!els.tabbar) return;
    clear(els.tabbar);
    els.tabbar.append(iconBtn("menu", "Show connections", function () { root.classList.toggle("side-open"); }, { class: "icon-btn menu-toggle" }));
    var list = h("div", { class: "tabs" });
    S.tabs.forEach(function (t) {
      var c = conn(t.connId);
      var tabIcon = t.type === "query" ? "terminal" : t.objectType === "view" ? "eye" : t.objectType === "collection" ? "symbol-array" : t.objectType === "keys" ? "key" : "table";
      var el = h("div", { class: "tab" + (t.id === S.active ? " active" : ""), role: "tab", tabindex: "0", "aria-selected": String(t.id === S.active), title: (c ? c.name + " • " : "") + tabTitle(t) },
        icon(tabIcon), h("span", { class: "t-label", text: tabTitle(t) }),
        iconBtn("close", "Close tab", function () { closeTab(t.id); }));
      el.style.setProperty("--tab-color", colorVar(c));
      el.addEventListener("click", function () { activate(t.id); });
      el.addEventListener("auxclick", function (e) { if (e.button === 1) closeTab(t.id); });
      el.addEventListener("keydown", function (e) { if (e.key === "Enter") activate(t.id); });
      list.append(el);
    });
    els.tabbar.append(list);
    if (S.connections.length) els.tabbar.append(iconBtn("add", "New query", function () {
      var cur = tabById(S.active);
      var target = cur ? conn(cur.connId) : S.connections.find(function (c) { return c.status === "connected"; }) || S.connections[0];
      openQueryTab(target.id, cur ? { database: cur.type === "query" ? cur.database : cur.target.database, schema: cur.type === "query" ? cur.schema : cur.target.schema } : {});
    }, { class: "icon-btn new-query" }));
    var active = list.querySelector(".tab.active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function tabTitle(t) {
    if (t.type === "query") return t.title;
    var c = conn(t.connId);
    if (c && c.kind === "redis") return "db" + (t.target.database || "0") + " keys";
    return t.target.object;
  }

  function activate(id) {
    S.active = id;
    root.classList.remove("side-open");
    renderTabs();
    showActiveView();
    renderTree();
    persistSoon();
  }

  function closeTab(id, silent) {
    var i = S.tabs.findIndex(function (t) { return t.id === id; });
    if (i < 0) return;
    var t = S.tabs[i];
    if (t.el) t.el.remove();
    S.tabs.splice(i, 1);
    if (S.active === id) S.active = S.tabs.length ? S.tabs[Math.min(i, S.tabs.length - 1)].id : null;
    renderTabs();
    showActiveView();
    if (!silent) renderTree();
    persistSoon();
  }

  function showActiveView() {
    if (!els.views) return;
    var welcome = els.views.querySelector(".view.welcome-view");
    if (!S.tabs.length) {
      Array.prototype.forEach.call(els.views.children, function (v) { v.style.display = "none"; });
      if (welcome) welcome.remove();
      els.views.append(welcomeView());
      return;
    }
    if (welcome) welcome.remove();
    S.tabs.forEach(function (t) {
      if (!t.el) buildView(t);
      t.el.style.display = t.id === S.active ? "flex" : "none";
    });
    var tab = tabById(S.active);
    if (tab && tab.type === "data" && tab.needsLoad) loadTab(tab);
    if (tab && tab.type === "query" && tab.editor) setTimeout(function () { tab.editor.focus(); }, 0);
  }

  function buildView(t) {
    t.el = t.type === "query" ? buildQueryView(t) : buildDataView(t);
    els.views.append(t.el);
  }

  function openDataTab(connId, target, objectType, mode) {
    var existing = S.tabs.find(function (t) { return t.type === "data" && t.connId === connId && sameTarget(t.target, target); });
    if (existing) {
      if (mode && existing.mode !== mode) { existing.mode = mode; updateDataChrome(existing); loadTab(existing); }
      activate(existing.id);
      return;
    }
    var c = conn(connId);
    var t = {
      id: uid(), type: "data", connId: connId, target: { database: target.database, schema: target.schema, object: target.object }, objectType: objectType || (c && c.kind === "mongodb" ? "collection" : "table"),
      mode: mode || "data", page: 1, pageSize: c && c.kind === "redis" ? 100 : 50, sort: null, filters: [], search: "", query: "", keyType: "", needsLoad: true, selected: new Set()
    };
    S.tabs.push(t);
    activate(t.id);
  }

  function openQueryTab(connId, opts) {
    opts = opts || {};
    var c = conn(connId);
    if (!c) return;
    S.queryCounter += 1;
    var t = { id: uid(), type: "query", connId: connId, database: opts.database || c.defaultDatabase || "", schema: opts.schema || "", text: opts.text || "", title: "Query " + S.queryCounter, editorH: 200 };
    S.tabs.push(t);
    activate(t.id);
  }

  // ------------------------------------------------------------------ Welcome
  function welcomeView() {
    var view = h("div", { class: "view welcome-view" });
    var inner = h("div", { class: "welcome-inner" },
      h("h1", null, icon("database"), "Database Client"),
      h("p", { class: "lead", text: "Connect with a connection string, browse databases, schemas and tables, and read, insert, edit and delete data — for SQL, document and key-value stores." }),
      btn("New connection", "add", function () { openConnectionModal(null); }, "primary"));
    var kinds = h("div", { class: "kinds" });
    Object.keys(S.kinds).forEach(function (k) {
      var meta = S.kinds[k];
      var b = h("button", { class: "kind-card", type: "button", title: "New " + meta.label + " connection\n" + meta.example + (meta.notes ? "\n\n" + meta.notes : "") },
        h("span", { class: "kind-icon", style: { background: KIND_COLOR[k] } }, KIND_ABBR[k]),
        h("span", null, meta.label, h("small", { text: meta.family === "sql" ? "SQL" : meta.family === "document" ? "Documents" : "Key-value" })));
      b.addEventListener("click", function () { openConnectionModal(null, { kind: k }); });
      kinds.append(b);
    });
    inner.append(kinds, capabilityTable());
    if (S.connections.length) {
      var recent = S.connections.slice().sort(function (a, b) { return (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0); }).slice(0, 6);
      inner.append(h("div", { class: "section-title", text: "Your connections" }));
      var list = h("div", { class: "recent" });
      recent.forEach(function (c) {
        var b = h("button", { type: "button" },
          h("span", { class: "kind-icon", style: { background: KIND_COLOR[c.kind], width: "22px", height: "22px", borderRadius: "5px", display: "grid", placeItems: "center", color: "#fff", fontSize: "9px", fontWeight: "800" } }, KIND_ABBR[c.kind]),
          h("span", { class: "grow" }, h("div", { text: c.name }), h("div", { class: "muted", style: { fontSize: "11.5px" }, text: c.display })),
          h("span", { class: "dot " + c.status }));
        b.addEventListener("click", function () { expandConn(c, false); });
        list.append(b);
      });
      inner.append(list);
    }
    inner.append(h("div", { class: "section-title", text: "Good to know" }),
      h("div", { class: "tips" },
        h("div", { class: "tip" }, h("b", null, icon("lock"), "Secure by default"), "Connection strings live in your OS keychain. Passwords are never shown again or logged."),
        h("div", { class: "tip" }, h("b", null, icon("shield"), "Read-only mode"), "Mark a connection read-only to block every write, including from the query console."),
        h("div", { class: "tip" }, h("b", null, icon("terminal"), "Query console"), "SQL, mongosh-style commands or Redis commands. " + MOD + "Enter runs the selection or everything; long queries can be cancelled."),
        h("div", { class: "tip" }, h("b", null, icon("warning"), "Safe deletes"), "Deleting rows, dropping tables and destructive statements always ask first.")));
    view.append(h("div", { class: "welcome" }, inner));
    return view;
  }

  /** What works with each kind of database, from the host's own capability list. */
  function capabilityTable() {
    var table = h("table");
    table.append(h("thead", null, h("tr", null, h("th", { text: "Database" }), FEATURE_LABELS.map(function (f) { return h("th", { class: "feat", text: f[1] }); }))));
    var body = h("tbody");
    Object.keys(S.kinds).forEach(function (k) {
      var meta = S.kinds[k];
      var f = meta.features || {};
      body.append(h("tr", null,
        h("td", { class: "db" }, h("b", { text: meta.label }), h("span", { class: "muted", text: " · " + (meta.driver || "") }), meta.notes ? h("div", { class: "note", text: meta.notes }) : null),
        FEATURE_LABELS.map(function (x) { return h("td", { class: "feat " + (f[x[0]] ? "yes" : "no"), title: x[1] + ": " + (f[x[0]] ? "supported" : "not available") }, icon(f[x[0]] ? "check" : "dash"), h("span", { class: "sr-only", text: f[x[0]] ? "yes" : "no" })); })));
    });
    table.append(body);
    return h("details", { class: "caps" }, h("summary", null, icon("checklist"), "What works with each database"), h("div", { class: "caps-scroll" }, table));
  }

  // ------------------------------------------------------------------ Value formatting
  function isMarker(v) { return v && typeof v === "object" && typeof v.__dbv === "string"; }
  function ejsonScalar(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    var keys = Object.keys(v);
    if (keys.length !== 1) return undefined;
    var k = keys[0];
    if (k === "$oid") return { text: v.$oid, cls: "v-str", tag: "ObjectId" };
    if (k === "$date") return { text: typeof v.$date === "string" ? v.$date : typeof v.$date === "object" && v.$date.$numberLong ? new Date(Number(v.$date.$numberLong)).toISOString() : String(v.$date), cls: "v-str" };
    if (k === "$numberLong" || k === "$numberDecimal" || k === "$numberInt" || k === "$numberDouble") return { text: String(v[k]), cls: "v-num" };
    if (k === "$binary") return { tag: "binary", text: "" };
    if (k === "$uuid") return { text: v.$uuid, cls: "v-str", tag: "UUID" };
    return undefined;
  }
  function shortJson(v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  }
  function cellContent(v, missing) {
    if (missing) return h("span", { class: "v-null", text: "—" });
    if (v === null || v === undefined) return h("span", { class: "v-null", text: "NULL" });
    if (isMarker(v)) {
      if (v.__dbv === "binary") return h("span", { class: "v-tag" }, icon("file-binary"), "binary · " + fmtBytes(v.size));
      if (v.__dbv === "truncated") return h("span", null, h("span", { class: "v-tag", text: fmtNum(v.length) + " chars" }), " ", (v.preview || "").slice(0, 200));
    }
    if (typeof v === "boolean") return h("span", { class: "v-bool", text: String(v) });
    if (typeof v === "number") return h("span", { class: "v-num", text: String(v) });
    if (typeof v === "object") {
      var ej = ejsonScalar(v);
      if (ej) return h("span", { class: ej.cls || "" }, ej.tag && !ej.text ? h("span", { class: "v-tag", text: ej.tag }) : null, ej.text || "");
      return h("span", { class: "v-json", text: shortJson(v) });
    }
    var s = String(v);
    return document.createTextNode(s.length > 300 ? s.slice(0, 300) + "…" : s);
  }
  function plainText(v) {
    if (v === null || v === undefined) return "";
    if (isMarker(v)) return v.__dbv === "binary" ? "<binary " + v.size + " bytes>" : v.preview;
    if (typeof v === "object") { var ej = ejsonScalar(v); if (ej && ej.text) return ej.text; return JSON.stringify(v); }
    return String(v);
  }
  function fmtBytes(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function fmtTtl(sec) {
    if (sec === null || sec === undefined) return "∞";
    if (sec < 60) return sec + "s";
    if (sec < 3600) return Math.round(sec / 60) + "m";
    if (sec < 86400) return (sec / 3600).toFixed(1).replace(/\.0$/, "") + "h";
    return (sec / 86400).toFixed(1).replace(/\.0$/, "") + "d";
  }

  function toCsv(columns, rows) {
    function esc(v) { var s = plainText(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    return [columns.map(esc).join(",")].concat(rows.map(function (r) { return columns.map(function (c) { return esc(r[c]); }).join(","); })).join("\n");
  }
  function toJson(rows) {
    return JSON.stringify(rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { if (!HIDDEN_COLS[k]) o[k] = r[k]; }); return o; }), null, 2);
  }
  function sqlLiteral(v) {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "object") return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }
  function toInserts(c, t, columns, rows) {
    var cols = columns.map(function (n) { return quoteIdent(c.kind, n); }).join(", ");
    return rows.map(function (r) {
      return "INSERT INTO " + qualify(c, t) + " (" + cols + ") VALUES (" + columns.map(function (n) { return isMarker(r[n]) ? "NULL /* not exported */" : sqlLiteral(r[n]); }).join(", ") + ");";
    }).join("\n");
  }

  // ------------------------------------------------------------------ Data view
  function buildDataView(t) {
    var view = h("div", { class: "view" });
    t.ui = {};
    t.selected = t.selected || new Set();
    t.ui.head = h("div", { class: "vhead" });
    t.ui.toolbar = h("div", { class: "toolbar" });
    t.ui.filters = h("div", { class: "filters hidden" });
    t.ui.banners = h("div");
    t.ui.gridWrap = h("div", { class: "grid-wrap" });
    t.ui.foot = h("div", { class: "vfoot" });
    view.append(t.ui.head, t.ui.toolbar, t.ui.filters, t.ui.banners, t.ui.gridWrap, t.ui.foot);
    updateDataChrome(t);
    return view;
  }

  /** Rows can be inserted: a writable connection and a table (views refuse inserts). */
  function canInsertTab(t) {
    var c = conn(t.connId);
    return !!c && !c.readOnly && t.objectType !== "view" && !(t.result && t.result.canInsert === false);
  }
  /** Existing rows can be edited and deleted: they also need a key that identifies them. */
  function writableTab(t) {
    return canInsertTab(t) && !!t.result && !t.result.readOnly && t.result.keyStrategy !== "none";
  }

  // ------------------------------------------------------------------ Column resizing
  /** Lets each named column be dragged wider or narrower; a double-click resets it. */
  function enableColumnResize(table, widths, onChange) {
    if (!table.tHead) return;
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th, index) {
      var name = th.getAttribute("data-col");
      if (!name) return;
      if (widths[name]) applyWidth(table, index, widths[name]);
      var grip = h("span", { class: "col-resize", title: "Drag to resize. Double-click to reset.", "aria-hidden": "true" });
      grip.addEventListener("click", function (e) { e.stopPropagation(); });
      grip.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        delete widths[name];
        applyWidth(table, index, null);
        if (onChange) onChange();
      });
      grip.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var startX = e.clientX, startW = th.getBoundingClientRect().width, w = startW, frame = 0;
        grip.classList.add("dragging");
        document.body.classList.add("col-resizing");
        function move(ev) {
          w = Math.max(48, Math.min(1200, Math.round(startW + ev.clientX - startX)));
          if (!frame) frame = requestAnimationFrame(function () { frame = 0; applyWidth(table, index, w); });
        }
        function up() {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          grip.classList.remove("dragging");
          document.body.classList.remove("col-resizing");
          widths[name] = w;
          applyWidth(table, index, w);
          if (onChange) onChange();
        }
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      });
      th.append(grip);
    });
  }
  function applyWidth(table, index, w) {
    var v = w ? w + "px" : "";
    Array.prototype.forEach.call(table.rows, function (row) {
      var cell = row.cells[index];
      if (cell) { cell.style.width = v; cell.style.minWidth = v; cell.style.maxWidth = v; }
    });
  }

  function updateDataChrome(t) {
    var c = conn(t.connId);
    if (!c || !t.ui) return;
    var fam = family(c);
    // Header: breadcrumb + mode switch
    clear(t.ui.head);
    var crumbs = h("div", { class: "crumbs" },
      h("span", { class: "dot " + c.status, title: c.status }),
      h("span", { class: "crumb", text: c.name }), h("span", { class: "sep" }, icon("chevron-right")));
    if (c.kind !== "sqlite") crumbs.append(h("span", { class: "crumb", text: dbLabel(c, t.target.database || "") }), h("span", { class: "sep" }, icon("chevron-right")));
    if (t.target.schema) crumbs.append(h("span", { class: "crumb", text: t.target.schema }), h("span", { class: "sep" }, icon("chevron-right")));
    crumbs.append(h("b", { class: "crumb", text: c.kind === "redis" ? "Keys" : t.target.object }));
    if (t.objectType === "view") crumbs.append(h("span", { class: "chip" }, icon("eye"), "view"));
    if (c.readOnly) crumbs.append(h("span", { class: "chip warn" }, icon("lock"), "read-only"));
    t.ui.head.append(crumbs);
    if (c.kind !== "redis") {
      var seg = h("div", { class: "seg", role: "tablist" });
      [["data", "table", "Data"], ["structure", "symbol-structure", "Structure"]].forEach(function (m) {
        var b = h("button", { type: "button", class: t.mode === m[0] ? "on" : "", role: "tab", "aria-selected": String(t.mode === m[0]) }, icon(m[1]), m[2]);
        b.addEventListener("click", function () { if (t.mode === m[0]) return; t.mode = m[0]; persistSoon(); updateDataChrome(t); loadTab(t); });
        seg.append(b);
      });
      t.ui.head.append(seg);
    }

    // Toolbar
    clear(t.ui.toolbar);
    if (t.mode === "structure") {
      t.ui.toolbar.append(btn("Refresh", "refresh", function () { call("refresh", { id: t.connId }).finally(function () { loadTab(t); }); }));
      t.ui.filters.classList.add("hidden");
      t.ui.foot.classList.add("hidden");
      return;
    }
    t.ui.foot.classList.remove("hidden");
    var search = h("input", { class: "input", type: "search", value: t.search, placeholder: fam === "keyvalue" ? "Search key names…" : fam === "document" ? "Search text fields…" : "Search all columns…", "aria-label": "Search" });
    var runSearch = debounce(function () { if (search.value === t.search) return; t.search = search.value; t.page = 1; persistSoon(); loadTab(t); }, 400);
    search.addEventListener("input", runSearch);
    search.addEventListener("keydown", function (e) { if (e.key === "Enter") { t.search = search.value; t.page = 1; loadTab(t); } });
    t.ui.toolbar.append(h("div", { class: "search" }, icon("search"), search));

    if (fam === "document") {
      var q = h("input", { class: "input query-input", value: t.query, placeholder: "Filter: { status: \"active\", age: { $gt: 21 } }", spellcheck: "false", "aria-label": "MongoDB filter" });
      q.addEventListener("keydown", function (e) { if (e.key === "Enter") { t.query = q.value; t.page = 1; persistSoon(); loadTab(t); } });
      q.addEventListener("blur", function () { if (q.value !== t.query) { t.query = q.value; t.page = 1; persistSoon(); loadTab(t); } });
      t.ui.toolbar.append(q);
    }
    if (fam === "keyvalue") {
      var pattern = h("input", { class: "input mono", value: t.query, placeholder: "Pattern, e.g. user:*", style: { width: "180px" }, spellcheck: "false", "aria-label": "Key pattern" });
      pattern.addEventListener("keydown", function (e) { if (e.key === "Enter") { t.query = pattern.value; t.page = 1; persistSoon(); loadTab(t); } });
      var type = h("select", { class: "select", "aria-label": "Key type" }, h("option", { value: "", text: "All types" }), REDIS_TYPES.concat(["stream"]).map(function (ty) { return h("option", { value: ty, text: ty, selected: t.keyType === ty }); }));
      type.addEventListener("change", function () { t.keyType = type.value; t.page = 1; persistSoon(); loadTab(t); });
      t.ui.toolbar.append(pattern, type);
    }
    if (fam !== "keyvalue") {
      var count = (t.filters || []).length;
      var fbtn = btn("Filter", "filter", function () { t.showFilters = !t.showFilters; if (t.showFilters && !t.filters.length) t.draftFilters = [newRule(t)]; renderFilters(t); }, t.showFilters ? "" : "ghost");
      if (count) fbtn.append(h("span", { class: "count-badge", text: String(count) }));
      t.ui.toolbar.append(fbtn);
    }
    t.ui.toolbar.append(h("span", { class: "divider" }), btn("Refresh", "refresh", function () { loadTab(t); }, "ghost", { title: "Reload rows" }));
    if (canInsertTab(t)) t.ui.toolbar.append(btn(fam === "document" ? "Insert document" : fam === "keyvalue" ? "Add key" : "Insert row", "add", function () { openEditor(t, null); }, "primary"));
    if (writableTab(t)) {
      var n = t.selected.size;
      var del = btn(n ? "Delete (" + n + ")" : "Delete", "trash", function () { deleteSelected(t); }, "danger", { disabled: !n, title: n ? "Delete the selected " + (fam === "keyvalue" ? "keys" : fam === "document" ? "documents" : "rows") : "Select rows to delete" });
      t.ui.toolbar.append(del);
    }
    t.ui.toolbar.append(iconBtn("ellipsis", "More actions", function (e) { showMenu(dataMenu(t), e.currentTarget); }));
    renderFilters(t);
  }

  function dataMenu(t) {
    var c = conn(t.connId);
    var rows = (t.result && t.result.rows) || [];
    var cols = t.result ? t.result.columns.map(function (x) { return x.name; }) : [];
    var noun = c.kind === "mongodb" ? "collection" : t.objectType === "view" ? "view" : "table";
    var sel = selectedRows(t);
    var subset = sel.length ? sel : rows;
    var which = sel.length ? "selected" : "page";
    return [
      { label: "Copy " + which + " as JSON", icon: "json", disabled: !rows.length, run: function () { copy(toJson(subset)); } },
      c.kind !== "redis" ? { label: "Copy " + which + " as CSV", icon: "table", disabled: !rows.length, run: function () { copy(toCsv(cols, subset)); } } : null,
      c.family === "sql" ? { label: "Copy " + which + " as INSERT statements", icon: "code", disabled: !rows.length, run: function () { copy(toInserts(c, t.target, cols.filter(function (n) { return !HIDDEN_COLS[n]; }), subset)); } } : null,
      { label: "Open " + which + " in editor", icon: "go-to-file", disabled: !rows.length, run: function () { call("openInEditor", { content: toJson(subset), language: "json" }).catch(fail); } },
      "-",
      { label: "New query", icon: "terminal", run: function () { openQueryTab(t.connId, { database: t.target.database, schema: t.target.schema, text: starterQuery(c, t.target) }); } },
      c.kind !== "redis" ? { label: "View structure", icon: "symbol-structure", run: function () { t.mode = "structure"; updateDataChrome(t); loadTab(t); } } : null,
      "-",
      c.kind === "redis"
        ? { label: "Empty database (FLUSHDB)…", icon: "trash", danger: true, disabled: c.readOnly, run: function () { destructive(t.connId, t.target, "dropObject"); } }
        : { label: "Empty " + noun + "…", icon: "clear-all", danger: true, disabled: c.readOnly || t.objectType === "view", run: function () { destructive(t.connId, t.target, "truncateObject"); } },
      c.kind !== "redis" ? { label: "Drop " + noun + "…", icon: "trash", danger: true, disabled: c.readOnly, run: function () { destructive(t.connId, t.target, "dropObject"); } } : null
    ];
  }

  function newRule(t) {
    var cols = t.result ? t.result.columns : [];
    return { column: cols[0] ? cols[0].name : "", op: "eq", value: "" };
  }

  function renderFilters(t) {
    var box = t.ui.filters;
    clear(box);
    if (!t.showFilters) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    if (!t.draftFilters) t.draftFilters = (t.filters || []).map(function (f) { return Object.assign({}, f); });
    if (!t.draftFilters.length) t.draftFilters.push(newRule(t));
    var cols = t.result ? t.result.columns : [];
    t.draftFilters.forEach(function (rule, i) {
      var colSel = h("select", { class: "select", "aria-label": "Column" }, cols.map(function (c) { return h("option", { value: c.name, text: c.name, selected: c.name === rule.column }); }));
      if (rule.column && !cols.some(function (c) { return c.name === rule.column; })) colSel.append(h("option", { value: rule.column, text: rule.column, selected: true }));
      colSel.addEventListener("change", function () { rule.column = colSel.value; });
      var opSel = h("select", { class: "select", "aria-label": "Operator" }, S.filterOps.map(function (op) { return h("option", { value: op, text: OPS[op] || op, selected: op === rule.op }); }));
      var val = h("input", { class: "input mono", value: rule.value || "", placeholder: rule.op === "in" ? "a, b, c" : "value", "aria-label": "Value" });
      function syncVal() { val.classList.toggle("hidden", rule.op === "null" || rule.op === "notnull"); }
      opSel.addEventListener("change", function () { rule.op = opSel.value; syncVal(); });
      val.addEventListener("input", function () { rule.value = val.value; });
      val.addEventListener("keydown", function (e) { if (e.key === "Enter") applyFilters(t); });
      syncVal();
      box.append(h("div", { class: "frule" }, h("span", { class: "join", text: i === 0 ? "where" : "and" }), colSel, opSel, val,
        iconBtn("close", "Remove condition", function () { t.draftFilters.splice(i, 1); renderFilters(t); })));
    });
    box.append(h("div", { class: "row-actions" },
      btn("Add condition", "add", function () { t.draftFilters.push(newRule(t)); renderFilters(t); }, "ghost"),
      h("span", { class: "grow" }),
      btn("Clear", null, function () { t.draftFilters = []; t.filters = []; t.showFilters = false; t.page = 1; persistSoon(); updateDataChrome(t); loadTab(t); }, "ghost"),
      btn("Apply", "check", function () { applyFilters(t); }, "primary")));
  }

  function applyFilters(t) {
    t.filters = (t.draftFilters || []).filter(function (r) { return r.column && (r.op === "null" || r.op === "notnull" || String(r.value || "").length); }).map(function (r) { return { column: r.column, op: r.op, value: r.value }; });
    t.page = 1;
    persistSoon();
    updateDataChrome(t);
    loadTab(t);
  }

  function setBanner(t, kind, message, hint, action) {
    clear(t.ui.banners);
    if (!message) return;
    t.ui.banners.append(h("div", { class: "banner " + kind }, icon(kind === "error" ? "error" : kind === "warn" ? "warning" : "info"),
      h("div", { class: "grow" }, message, hint ? h("span", { class: "hint", text: hint }) : null), action || null));
  }

  function loadTab(t) {
    t.needsLoad = false;
    if (!t.ui) return;
    var token = (t.loadToken || 0) + 1;
    t.loadToken = token;
    t.loading = true;
    showLoading(t, true);
    var c = conn(t.connId);
    if (t.mode === "structure" && c && c.kind !== "redis") {
      var wantIndexes = c.features && c.features.indexes;
      Promise.all([
        call("describe", { id: t.connId, target: t.target }),
        // Index listing is a bonus: a failure (missing privileges) must not hide the columns.
        wantIndexes ? call("indexes", { id: t.connId, target: t.target }).catch(function (err) { return { error: err }; }) : Promise.resolve(null)
      ]).then(function (res) {
        if (t.loadToken !== token) return;
        t.loading = false; t.structure = res[0]; t.indexes = res[1];
        clear(t.ui.banners);
        renderStructure(t);
      }).catch(function (err) { if (t.loadToken !== token) return; t.loading = false; showError(t, err); });
      return;
    }
    var request = { target: t.target, page: t.page, pageSize: t.pageSize, sort: t.sort, filters: t.filters, search: t.search, query: t.query, keyType: t.keyType };
    call("fetchPage", { id: t.connId, request: request }).then(function (result) {
      if (t.loadToken !== token) return;
      t.loading = false;
      var hadResult = !!t.result;
      t.result = result;
      t.selected = new Set();
      var conn2 = conn(t.connId);
      if (result.readOnly && !(conn2 && conn2.readOnly)) setBanner(t, "info", result.readOnly);
      else clear(t.ui.banners);
      if (!hadResult || t.showFilters) updateDataChrome(t); else refreshToolbarCounts(t);
      renderGrid(t);
      renderFoot(t);
      // Past the last page after a delete or a new filter: go back to the last real page.
      if (!result.rows.length && t.page > 1 && typeof result.total === "number" && result.total > 0) { t.page = Math.max(1, Math.ceil(result.total / t.pageSize)); loadTab(t); }
    }).catch(function (err) {
      if (t.loadToken !== token) return;
      t.loading = false;
      showError(t, err);
    });
  }

  function showError(t, err) {
    showLoading(t, false);
    var retry = btn("Retry", "refresh", function () { loadTab(t); });
    setBanner(t, "error", err.message, err.hint, retry);
    if (!t.result) { clear(t.ui.gridWrap).append(h("div", { class: "grid-empty" }, icon("debug-disconnect"), "Could not load data.")); clear(t.ui.foot); }
  }

  function showLoading(t, on) {
    var bar = t.ui.gridWrap.querySelector(".loading-bar");
    var veil = t.ui.gridWrap.querySelector(".busy-veil");
    if (on) {
      if (!t.ui.gridWrap.querySelector("table") && !t.ui.gridWrap.querySelector(".struct")) {
        clear(t.ui.gridWrap).append(skeleton());
      }
      if (!bar) t.ui.gridWrap.prepend(h("div", { class: "loading-bar" }));
      if (!veil && t.ui.gridWrap.querySelector("table")) t.ui.gridWrap.append(h("div", { class: "busy-veil" }));
    } else {
      if (bar) bar.remove();
      if (veil) veil.remove();
    }
  }

  function skeleton() {
    var table = h("table", { class: "grid skeleton" });
    var body = h("tbody");
    for (var r = 0; r < 8; r++) {
      var tr = h("tr");
      for (var c = 0; c < 5; c++) tr.append(h("td", { style: { width: "160px" } }, h("span", { style: { width: (40 + ((r * 7 + c * 13) % 50)) + "%" } })));
      body.append(tr);
    }
    table.append(body);
    return table;
  }

  function refreshToolbarCounts(t) { updateDataChrome(t); }

  function rowKey(t, row) {
    var res = t.result;
    var key = {};
    res.keyColumns.forEach(function (k) { key[k] = row[k]; });
    return key;
  }
  function keyId(key) { return JSON.stringify(key); }
  function selectedRows(t) {
    if (!t.result) return [];
    return t.result.rows.filter(function (r) { return t.selected.has(keyId(rowKey(t, r))); });
  }

  function renderGrid(t) {
    var res = t.result;
    var wrap = t.ui.gridWrap;
    var scrollTop = wrap.scrollTop, scrollLeft = wrap.scrollLeft;
    clear(wrap);
    var c = conn(t.connId);
    var columns = res.columns.filter(function (col) { return !HIDDEN_COLS[col.name]; });
    var canEdit = writableTab(t);
    var isRedis = c && c.kind === "redis";
    if (!res.rows.length) {
      var filtered = (t.filters && t.filters.length) || t.search || t.query || t.keyType;
      wrap.append(h("div", { class: "grid-empty" }, icon(filtered ? "search" : "inbox"),
        h("div", { text: filtered ? "No matching " + (isRedis ? "keys" : c.kind === "mongodb" ? "documents" : "rows") + "." : isRedis ? "This database has no keys." : c.kind === "mongodb" ? "This collection is empty." : "This table is empty." }),
        canInsertTab(t) && !filtered ? h("div", { style: { marginTop: "12px" } }, btn(isRedis ? "Add key" : c.kind === "mongodb" ? "Insert document" : "Insert row", "add", function () { openEditor(t, null); }, "primary")) : null));
      return;
    }
    var table = h("table", { class: "grid", role: "grid", "aria-rowcount": String(res.rows.length) });
    var thead = h("thead");
    var hr = h("tr");
    if (canEdit) {
      var all = h("input", { type: "checkbox", "aria-label": "Select all rows on this page" });
      all.checked = res.rows.length > 0 && res.rows.every(function (r) { return t.selected.has(keyId(rowKey(t, r))); });
      all.addEventListener("change", function () {
        res.rows.forEach(function (r) { var k = keyId(rowKey(t, r)); if (all.checked) t.selected.add(k); else t.selected.delete(k); });
        renderGrid(t); updateDataChrome(t);
      });
      hr.append(h("th", { class: "ck" }, all));
    } else {
      hr.append(h("th", { class: "rn", text: "#" }));
    }
    hr.append(h("th", { class: "ra" }));
    columns.forEach(function (col) {
      var sortable = col.sortable !== false;
      var sorted = t.sort && t.sort.column === col.name ? t.sort.dir : null;
      var th = h("th", { class: sortable ? "sortable" : "", "data-col": col.name, title: col.name + " • " + col.dataType + (col.primaryKey ? " • primary key" : "") + (col.presence !== undefined ? " • in " + Math.round(col.presence * 100) + "% of sampled documents" : ""), "aria-sort": sorted ? (sorted === "asc" ? "ascending" : "descending") : null },
        h("div", { class: "h" }, col.primaryKey ? icon("key", "pk") : null, h("span", { class: "name", text: col.name }), sorted ? icon(sorted === "asc" ? "arrow-up" : "arrow-down", "sort") : null),
        isRedis ? null : h("div", { class: "type", text: col.dataType }));
      if (sortable) th.addEventListener("click", function () {
        if (!t.sort || t.sort.column !== col.name) t.sort = { column: col.name, dir: "asc" };
        else if (t.sort.dir === "asc") t.sort = { column: col.name, dir: "desc" };
        else t.sort = null;
        t.page = 1; persistSoon(); loadTab(t);
      });
      hr.append(th);
    });
    thead.append(hr);
    table.append(thead);
    var body = h("tbody");
    var offset = (t.page - 1) * t.pageSize;
    res.rows.forEach(function (row, i) {
      var key = canEdit || res.keyColumns.length ? keyId(rowKey(t, row)) : String(i);
      var tr = h("tr", { class: t.selected.has(key) ? "sel" : "", "aria-rowindex": String(offset + i + 1) });
      if (canEdit) {
        var ck = h("input", { type: "checkbox", checked: t.selected.has(key), "aria-label": "Select row " + (offset + i + 1) });
        ck.addEventListener("click", function (e) { e.stopPropagation(); });
        ck.addEventListener("change", function () { if (ck.checked) t.selected.add(key); else t.selected.delete(key); tr.classList.toggle("sel", ck.checked); updateDataChrome(t); });
        tr.append(h("td", { class: "ck" }, ck));
      } else {
        tr.append(h("td", { class: "rn", text: String(offset + i + 1) }));
      }
      tr.append(h("td", { class: "ra" }, iconBtn(canEdit ? "edit" : "eye", canEdit ? "Edit" : "View", function () { openEditor(t, row); })));
      columns.forEach(function (col) {
        var missing = !(col.name in row);
        var v = row[col.name];
        var td;
        if (isRedis && col.name === "type") td = h("td", null, h("span", { class: "v-type t-" + (REDIS_TYPES.indexOf(v) >= 0 || v === "stream" ? v : "other"), text: v }));
        else if (isRedis && col.name === "ttl") td = h("td", { class: v === null ? "muted" : "" }, fmtTtl(v));
        else td = h("td", null, cellContent(v, missing && c.kind === "mongodb"));
        var full = plainText(v);
        if (full.length > 40) td.title = full.length > 2000 ? full.slice(0, 2000) + "…" : full;
        td.addEventListener("contextmenu", function (e) { e.preventDefault(); showMenu(cellMenu(t, row, col, canEdit), { x: e.clientX, y: e.clientY }); });
        tr.append(td);
      });
      tr.addEventListener("dblclick", function () { openEditor(t, row); });
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    t.colWidths = t.colWidths || {};
    enableColumnResize(table, t.colWidths, persistSoon);
    wrap.scrollTop = scrollTop;
    wrap.scrollLeft = scrollLeft;
  }

  function cellMenu(t, row, col, canEdit) {
    var c = conn(t.connId);
    var v = row[col.name];
    var filterable = c.kind !== "redis" && !isMarker(v) && (v === null || typeof v !== "object" || ejsonScalar(v));
    return [
      { label: "Copy value", icon: "copy", run: function () { copy(plainText(v)); } },
      { label: "Copy row as JSON", icon: "json", run: function () { copy(toJson([row])); } },
      "-",
      filterable ? { label: v === null ? "Filter: " + col.name + " is null" : "Filter: " + col.name + " = " + plainText(v).slice(0, 30), icon: "filter", run: function () {
        var rule = v === null ? { column: col.name, op: "null" } : { column: col.name, op: "eq", value: c.kind === "mongodb" && ejsonScalar(v) && v.$oid ? 'ObjectId("' + v.$oid + '")' : c.kind === "mongodb" && typeof v === "string" ? JSON.stringify(v) : plainText(v) };
        t.filters = (t.filters || []).concat([rule]); t.draftFilters = null; t.page = 1; persistSoon(); updateDataChrome(t); loadTab(t);
      } } : null,
      { label: canEdit ? "Edit row" : "View row", icon: canEdit ? "edit" : "eye", run: function () { openEditor(t, row); } },
      canInsertTab(t) && c.kind !== "redis" ? { label: c.kind === "mongodb" ? "Duplicate document" : "Duplicate row", icon: "files", run: function () { openEditor(t, row, { duplicate: true }); } } : null,
      canEdit ? { label: "Delete row", icon: "trash", danger: true, run: function () { deleteRows(t, [row]); } } : null
    ];
  }

  function renderFoot(t) {
    var res = t.result;
    var foot = t.ui.foot;
    clear(foot);
    if (!res) return;
    var c = conn(t.connId);
    var noun = c.kind === "redis" ? "key" : c.kind === "mongodb" ? "document" : "row";
    var start = res.rows.length ? (t.page - 1) * t.pageSize + 1 : 0;
    var end = (t.page - 1) * t.pageSize + res.rows.length;
    var totalText = typeof res.total === "number" ? fmtNum(res.total) + (res.totalCapped ? "+" : "") : null;
    // "1 row", never "1 rows".
    var plural = res.total === 1 && !res.totalCapped ? noun : noun + "s";
    foot.append(h("span", null, res.rows.length ? (totalText ? fmtNum(start) + "–" + fmtNum(end) + " of " + totalText + " " + plural : noun.charAt(0).toUpperCase() + noun.slice(1) + "s " + fmtNum(start) + "–" + fmtNum(end)) : "0 " + noun + "s"));
    foot.append(h("span", { title: "Server round trip" }, icon("watch"), " " + res.elapsedMs + " ms"));
    if (res.totalCapped) foot.append(h("span", { class: "chip warn", title: "SCAN stopped after this many keys. Narrow the pattern to see the rest." }, icon("warning"), "first " + fmtNum(res.total) + " keys scanned"));
    if (t.selected.size) foot.append(h("span", { class: "chip" }, fmtNum(t.selected.size) + " selected"));
    var pages = typeof res.total === "number" ? Math.max(1, Math.ceil(res.total / t.pageSize)) : null;
    var sizeSel = h("select", { class: "select", "aria-label": "Rows per page" }, [25, 50, 100, 200, 500].map(function (n) { return h("option", { value: String(n), text: n + " / page", selected: n === t.pageSize }); }));
    sizeSel.addEventListener("change", function () { t.pageSize = Number(sizeSel.value); t.page = 1; persistSoon(); loadTab(t); });
    var pageInput = h("input", { class: "input", value: String(t.page), "aria-label": "Page" });
    pageInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var n = Math.max(1, Math.floor(Number(pageInput.value) || 1));
      if (pages) n = Math.min(n, pages);
      go(n);
    });
    function go(n) { if (n === t.page) return; t.page = n; loadTab(t); }
    var hasNext = pages ? t.page < pages : res.rows.length === t.pageSize;
    foot.append(h("div", { class: "pager" }, sizeSel,
      iconBtn("chevron-left", "Previous page", function () { go(Math.max(1, t.page - 1)); }, { disabled: t.page <= 1 }),
      h("span", null, "Page "), pageInput, pages ? h("span", { text: " of " + fmtNum(pages) }) : null,
      iconBtn("chevron-right", "Next page", function () { go(t.page + 1); }, { disabled: !hasNext })));
  }

  function renderStructure(t) {
    var wrap = t.ui.gridWrap;
    clear(wrap);
    var c = conn(t.connId);
    var cols = t.structure || [];
    var box = h("div", { class: "struct" });
    var table = h("table", { class: "grid" });
    var isDoc = c.kind === "mongodb";
    table.append(h("thead", null, h("tr", null, h("th", { class: "rn", text: "#" }), h("th", { text: isDoc ? "Field" : "Column" }), h("th", { text: isDoc ? "Types seen" : "Type" }),
      isDoc ? h("th", { text: "Present in" }) : h("th", { text: "Nullable" }), isDoc ? null : h("th", { text: "Default" }), h("th", { text: "Notes" }))));
    var body = h("tbody");
    cols.forEach(function (col, i) {
      var notes = h("td", null,
        col.primaryKey ? h("span", { class: "flag pk" }, icon("key"), isDoc ? "_id" : "primary key") : null,
        col.autoIncrement ? h("span", { class: "flag" }, icon("symbol-numeric"), "auto") : null,
        !col.editable && !col.primaryKey ? h("span", { class: "flag" }, icon("lock"), "read-only") : null);
      body.append(h("tr", null, h("td", { class: "rn", text: String(i + 1) }), h("td", null, h("b", { text: col.name })), h("td", { class: "mono", text: col.dataType }),
        isDoc ? h("td", null, h("span", { class: "bar" }, h("i", { style: { width: Math.round((col.presence || 0) * 100) + "%" } })), Math.round((col.presence || 0) * 100) + "%") : h("td", { text: col.nullable ? "yes" : "no", class: col.nullable ? "muted" : "" }),
        isDoc ? null : h("td", { class: "mono", text: col.defaultValue === null || col.defaultValue === undefined ? "" : col.defaultValue }),
        notes));
    });
    table.append(body);
    box.append(h("h4", { class: "struct-title" }, icon("symbol-field"), isDoc ? "Fields" : "Columns", h("span", { class: "muted", text: isDoc ? " · inferred from a random sample of up to 200 documents" : " · " + cols.length })), table);
    if (t.indexes) box.append(renderIndexes(t.indexes, isDoc));
    wrap.append(box);
  }

  function renderIndexes(list, isDoc) {
    var section = h("div", { class: "struct-section" });
    if (list.error) {
      section.append(h("h4", { class: "struct-title" }, icon("list-tree"), "Indexes"), h("div", { class: "banner warn", style: { margin: 0 } }, icon("warning"), h("div", null, "Indexes could not be read: " + list.error.message)));
      return section;
    }
    section.append(h("h4", { class: "struct-title" }, icon("list-tree"), "Indexes", h("span", { class: "muted", text: " · " + list.length })));
    if (!list.length) { section.append(h("div", { class: "muted", style: { fontSize: "12px" }, text: isDoc ? "No indexes." : "No indexes. Lookups on this table scan every row." })); return section; }
    var table = h("table", { class: "grid" });
    table.append(h("thead", null, h("tr", null, h("th", { text: "Name" }), h("th", { text: isDoc ? "Keys" : "Columns" }), h("th", { text: "Type" }), h("th", { text: "Notes" }))));
    var body = h("tbody");
    list.forEach(function (ix) {
      body.append(h("tr", null,
        h("td", null, h("b", { text: ix.name })),
        h("td", { class: "mono", text: ix.columns.join(", ") }),
        h("td", { class: "mono muted", text: ix.type || "" }),
        h("td", null,
          ix.primary ? h("span", { class: "flag pk" }, icon("key"), "primary") : null,
          ix.unique && !ix.primary ? h("span", { class: "flag" }, icon("lock"), "unique") : null,
          ix.detail ? h("span", { class: "flag", text: ix.detail }) : null)));
    });
    table.append(body);
    section.append(table);
    return section;
  }

  function deleteSelected(t) { deleteRows(t, selectedRows(t)); }

  function deleteRows(t, rows) {
    if (!rows.length) return;
    var keys = rows.map(function (r) { return rowKey(t, r); });
    call("deleteRows", { id: t.connId, target: t.target, keys: keys }).then(function (res) {
      if (!res || res.cancelled) return;
      var c = conn(t.connId);
      toast("success", "Deleted " + plural(res.affected, c.kind === "redis" ? "key" : c.kind === "mongodb" ? "document" : "row") + ".");
      t.selected = new Set();
      loadTab(t);
      if (c.kind === "redis") { var tr = treeOf(t.connId); if (tr.dbs) loadRedisCounts(c, tr); }
    }).catch(fail);
  }

  // ------------------------------------------------------------------ Row / document / key editor
  function formError(err) {
    return h("div", { class: "ferror" }, icon("error"), h("div", null, err.message, err.hint ? h("span", { class: "hint", text: err.hint }) : null));
  }

  function valueToText(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  }

  function autoGrow(ta, max) {
    function fit() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, max || 240) + "px"; }
    ta.addEventListener("input", fit);
    setTimeout(fit, 0);
  }

  function openEditor(t, row, opts) {
    opts = opts || {};
    var c = conn(t.connId);
    if (!c || !t.result) return;
    var fam = family(c);
    var canEdit = row && !opts.duplicate ? writableTab(t) : canInsertTab(t);
    var isNew = !row || opts.duplicate;
    var readOnlyView = !canEdit;
    var title = readOnlyView ? "View " + (fam === "keyvalue" ? "key" : fam === "document" ? "document" : "row")
      : isNew ? (opts.duplicate ? "Duplicate " : "New ") + (fam === "keyvalue" ? "key" : fam === "document" ? "document" : "row")
        : "Edit " + (fam === "keyvalue" ? "key" : fam === "document" ? "document" : "row");
    var body = h("div", { class: "dbody" });
    var errorBox = h("div");
    var saveBtn = btn(isNew ? "Insert" : "Save", "save", function () { save(); }, "primary", { title: MOD + "Enter" });
    saveBtn.append(h("kbd", { text: MOD + "↵" }));
    var dirty = false;
    var pendingClose = false;
    var collect;
    var close;

    function requestClose() {
      if (dirty && !pendingClose) { pendingClose = true; toast("info", "You have unsaved changes. Press Esc again to discard them."); setTimeout(function () { pendingClose = false; }, 3000); return; }
      close();
    }
    var drawer = h("div", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "mhead" }, h("h3", { text: title }), h("span", { class: "chip", text: t.target.object === "keys" && c.kind === "redis" ? "db" + (t.target.database || "0") : t.target.object }), iconBtn("close", "Close", requestClose)),
      body,
      h("div", { class: "mfoot" }, errorBox, h("span", { class: "spacer" }), btn(readOnlyView ? "Close" : "Cancel", null, requestClose), readOnlyView ? null : saveBtn));
    var overlay = h("div", { class: "overlay drawer-overlay", onmousedown: function (e) { if (e.target === overlay) requestClose(); } }, drawer);
    close = openOverlay(overlay, requestClose);
    drawer.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !readOnlyView) { e.preventDefault(); save(); } });
    function markDirty() { dirty = true; }

    function save() {
      clear(errorBox);
      var payload;
      try { payload = collect(); } catch (err) { errorBox.append(formError(err)); return; }
      if (!payload) return;
      saveBtn.disabled = true;
      var method = isNew ? "insertRow" : "updateRow";
      var params = { id: t.connId, target: t.target, values: payload };
      if (!isNew) params.key = rowKey(t, row);
      call(method, params).then(function () {
        close();
        toast("success", isNew ? (fam === "keyvalue" ? "Key added." : fam === "document" ? "Document inserted." : "Row inserted.") : "Saved.");
        loadTab(t);
        if (fam === "keyvalue") { var tr = treeOf(t.connId); if (tr.dbs) loadRedisCounts(c, tr); }
      }).catch(function (err) { saveBtn.disabled = false; clear(errorBox); body.prepend(formError(err)); body.scrollTop = 0; var old = body.querySelectorAll(".ferror"); if (old.length > 1) old[1].remove(); });
    }

    if (fam === "document") collect = documentEditor(body, t, row, opts, isNew, readOnlyView, markDirty);
    else if (fam === "keyvalue") collect = keyEditor(body, t, row, isNew, readOnlyView, markDirty, saveBtn);
    else collect = rowEditor(body, t, row, opts, isNew, readOnlyView, markDirty);
    var first = body.querySelector(".efield:not(.pk-field) textarea:not([readonly]), .efield:not(.pk-field) input:not([readonly]), .efield:not(.pk-field) select") || body.querySelector("textarea:not([readonly]), input:not([readonly]):not([type=checkbox]), select");
    if (first) setTimeout(function () { first.focus(); }, 30);
  }

  function rowEditor(body, t, row, opts, isNew, readOnlyView, markDirty) {
    var columns = t.result.columns.filter(function (col) { return !HIDDEN_COLS[col.name]; });
    var fields = [];
    if (readOnlyView && t.result.readOnly) body.append(h("div", { class: "banner info", style: { margin: 0 } }, icon("info"), h("div", { text: t.result.readOnly })));
    columns.forEach(function (col) {
      var original = row ? row[col.name] : undefined;
      var marker = isMarker(original);
      var mode;
      if (!row) mode = col.autoIncrement || (col.defaultValue !== null && col.defaultValue !== undefined) ? "default" : col.nullable ? "null" : "value";
      else if (opts.duplicate && (col.autoIncrement || (col.primaryKey && col.defaultValue))) mode = "default";
      else mode = original === null || original === undefined ? "null" : "value";
      var text = row && !marker ? valueToText(original) : "";
      var editable = !readOnlyView && col.editable && !marker;
      var field = { col: col, mode: mode, original: { mode: row && !opts.duplicate ? mode : null, text: text } };
      var wrap = h("div", { class: "efield" + (col.primaryKey ? " pk-field" : "") });
      var modes = h("span", { class: "modes" });
      var holder = h("div");
      var input;
      function renderInput() {
        clear(holder);
        if (!editable) {
          holder.append(h("div", { class: "placeholder-box", text: marker ? (original.__dbv === "binary" ? "Binary data (" + fmtBytes(original.size) + ") cannot be edited here." : "Value too large to edit here (" + fmtNum(original.length) + " characters).") : field.mode === "null" ? "NULL" : field.mode === "default" ? "DEFAULT" : (text.length > 400 ? text.slice(0, 400) + "…" : text) || "(empty)" }));
          return;
        }
        if (field.mode === "null") { holder.append(h("div", { class: "placeholder-box", text: "NULL" })); return; }
        if (field.mode === "default") { holder.append(h("div", { class: "placeholder-box", text: col.defaultValue ? "DEFAULT  " + col.defaultValue : col.autoIncrement ? "Generated by the database" : "DEFAULT" })); return; }
        if (col.category === "boolean") {
          var cur = /^(true|t|1|yes)$/i.test(text) ? "true" : /^(false|f|0|no)$/i.test(text) ? "false" : text;
          input = h("select", { class: "select" }, h("option", { value: "true", text: "true", selected: cur === "true" }), h("option", { value: "false", text: "false", selected: cur === "false" }));
          if (cur !== "true" && cur !== "false") { input.value = "true"; text = "true"; }
          input.addEventListener("change", function () { text = input.value; changed(); });
        } else if (col.category === "number" || col.category === "date") {
          input = h("input", { class: "input mono", value: text, inputmode: col.category === "number" ? "decimal" : null, placeholder: col.category === "date" ? dateHint(col.dataType) : "0" });
          input.addEventListener("input", function () { text = input.value; validate(); changed(); });
        } else {
          input = h("textarea", { class: "textarea", rows: col.category === "json" ? "4" : "1", spellcheck: "false" });
          input.value = text;
          autoGrow(input, col.category === "json" ? 360 : 220);
          input.addEventListener("input", function () { text = input.value; validate(); changed(); });
        }
        holder.append(input);
        validate();
      }
      var err = h("div", { class: "err" });
      function validate() {
        err.textContent = "";
        if (input) input.classList.remove("invalid");
        if (field.mode !== "value") return true;
        var msg = "";
        if (col.category === "number" && !/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(text.trim())) msg = "Enter a number.";
        if (col.category === "json") { try { JSON.parse(text); } catch (e) { msg = "Invalid JSON: " + e.message; } }
        if (msg) { err.textContent = msg; if (input) input.classList.add("invalid"); return false; }
        return true;
      }
      function changed() {
        var isChanged = field.original.mode !== null && (field.mode !== field.original.mode || (field.mode === "value" && text !== field.original.text));
        wrap.classList.toggle("changed", isChanged);
        markDirty();
      }
      function setMode(m) { field.mode = m; Array.prototype.forEach.call(modes.children, function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === m); }); renderInput(); changed(); }
      if (editable) {
        // DEFAULT on an existing row would re-number a key or reset a value, so it is only offered for plain defaults.
        var offerDefault = isNew ? true : !!col.defaultValue && !col.primaryKey && !col.autoIncrement && conn(t.connId).kind !== "sqlite";
        [["value", "Value"], col.nullable ? ["null", "NULL"] : null, offerDefault ? ["default", "Default"] : null].forEach(function (m) {
          if (!m) return;
          var b = h("button", { type: "button", "data-mode": m[0], class: field.mode === m[0] ? "on" : "", text: m[1] });
          b.addEventListener("click", function () { setMode(m[0]); });
          modes.append(b);
        });
      }
      wrap.append(h("div", { class: "ehead" },
        col.primaryKey ? icon("key", "pk") : null, h("b", { text: col.name }), h("span", { class: "type", text: col.dataType + (col.nullable ? "" : " • required") }),
        editable && modes.children.length > 1 ? modes : null), holder, err);
      renderInput();
      field.getText = function () { return text; };
      field.validate = validate;
      field.editable = editable;
      fields.push(field);
      body.append(wrap);
    });
    return function collect() {
      var values = {};
      var invalid = false;
      fields.forEach(function (f) {
        if (!f.editable) return;
        if (!f.validate()) invalid = true;
        var changed = f.original.mode === null || f.mode !== f.original.mode || (f.mode === "value" && f.getText() !== f.original.text);
        if (!changed) return;
        values[f.col.name] = f.mode === "value" ? { mode: "value", value: f.getText() } : { mode: f.mode };
      });
      if (invalid) throw Object.assign(new Error("Fix the highlighted fields first."), {});
      if (!isNew && !Object.keys(values).length) { toast("info", "Nothing changed."); return null; }
      return values;
    };
  }

  function dateHint(type) {
    var t = String(type).toLowerCase();
    if (/^date$/.test(t)) return "YYYY-MM-DD";
    if (/^time/.test(t)) return "HH:MM:SS";
    if (/interval/.test(t)) return "1 day 02:00:00";
    return "YYYY-MM-DD HH:MM:SS";
  }

  function documentEditor(body, t, row, opts, isNew, readOnlyView, markDirty) {
    var doc = row ? JSON.parse(JSON.stringify(row)) : null;
    if (doc && opts.duplicate) delete doc._id;
    var text = doc ? JSON.stringify(doc, null, 2) : "{\n  \n}";
    var ta = h("textarea", { class: "textarea doc-editor", spellcheck: "false", readOnly: readOnlyView, "aria-label": "Document (Extended JSON)" });
    ta.value = text;
    var status = h("div", { class: "muted", style: { fontSize: "11.5px" } });
    function check() {
      try { JSON.parse(ta.value); ta.classList.remove("invalid"); status.textContent = "Valid JSON. Use {\"$oid\": …} or ObjectId(\"…\"), {\"$date\": …} or ISODate(\"…\") for BSON types."; }
      catch (e) { status.textContent = "Not strict JSON — shell syntax such as ObjectId(\"…\") or unquoted keys is fine; the server checks it on save."; }
    }
    ta.addEventListener("input", function () { check(); markDirty(); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !readOnlyView) { e.preventDefault(); insertAtCursor(ta, "  "); }
    });
    check();
    var tools = h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
      readOnlyView ? null : btn("Format", "list-flat", function () {
        try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 2); check(); } catch (e) { toast("info", "Format needs strict JSON.", "Shell helpers like ObjectId() are kept as typed."); }
      }, "ghost"),
      btn("Copy", "copy", function () { copy(ta.value); }, "ghost"),
      !isNew && row && row._id ? h("span", { class: "chip", title: "_id cannot be changed" }, icon("key"), plainText(row._id)) : null);
    body.append(tools, ta, status);
    return function collect() {
      var value = ta.value.trim();
      if (!value) throw new Error("Enter a document.");
      if (!isNew && value === text.trim()) { toast("info", "Nothing changed."); return null; }
      return { $document: { mode: "value", value: value } };
    };
  }

  var TEMPLATES = {
    string: "",
    hash: "{\n  \"field\": \"value\"\n}",
    list: "[\n  \"first\",\n  \"second\"\n]",
    set: "[\n  \"a\",\n  \"b\"\n]",
    zset: "[\n  { \"member\": \"a\", \"score\": 1 }\n]"
  };

  function keyEditor(body, t, row, isNew, readOnlyView, markDirty, saveBtn) {
    var keyInput = h("input", { class: "input mono", placeholder: "user:42", readOnly: !isNew, value: row ? row.key : "" });
    var typeSel = h("select", { class: "select", disabled: !isNew }, REDIS_TYPES.map(function (ty) { return h("option", { value: ty, text: ty, selected: row ? row.type === ty : ty === "string" }); }));
    var ttlInput = h("input", { class: "input mono", placeholder: isNew ? "No expiry" : "Keep current", inputmode: "numeric" });
    var valueTa = h("textarea", { class: "textarea doc-editor", spellcheck: "false", readOnly: readOnlyView });
    var info = h("div");
    var original = { value: null, ttl: "" };
    var loaded = isNew;
    body.append(
      h("div", { class: "field" }, h("label", { text: "Key" }), keyInput),
      h("div", { style: { display: "flex", gap: "10px" } },
        h("div", { class: "field grow" }, h("label", { text: "Type" }), typeSel),
        h("div", { class: "field grow" }, h("label", { text: "TTL (seconds)" }), ttlInput, h("div", { class: "help", text: isNew ? "Leave empty for no expiry." : "Empty keeps the current expiry; -1 removes it." }))),
      info,
      h("div", { class: "field", style: { flex: "1" } }, h("label", { text: "Value" }), valueTa));
    keyInput.addEventListener("input", markDirty);
    ttlInput.addEventListener("input", markDirty);
    valueTa.addEventListener("input", markDirty);
    valueTa.addEventListener("keydown", function (e) { if (e.key === "Tab" && !readOnlyView) { e.preventDefault(); insertAtCursor(valueTa, "  "); } });
    typeSel.addEventListener("change", function () { if (isNew) valueTa.value = TEMPLATES[typeSel.value] || ""; });
    if (isNew) valueTa.value = TEMPLATES.string;
    else {
      valueTa.value = "Loading…";
      valueTa.readOnly = true;
      saveBtn.disabled = true;
      call("readKey", { id: t.connId, database: t.target.database || "0", key: row.key }).then(function (kv) {
        loaded = true;
        if (kv.type !== "string" && REDIS_TYPES.indexOf(kv.type) < 0) typeSel.append(h("option", { value: kv.type, text: kv.type, selected: true }));
        typeSel.value = kv.type;
        original.value = kv.type === "string" ? String(kv.value === null ? "" : kv.value) : JSON.stringify(kv.value, null, 2);
        valueTa.value = original.value;
        var editableType = REDIS_TYPES.indexOf(kv.type) >= 0 || kv.type === "ReJSON-RL";
        ttlInput.placeholder = kv.ttlMs > 0 ? "Keep current (" + fmtTtl(Math.ceil(kv.ttlMs / 1000)) + ")" : "Keep current (no expiry)";
        if (kv.truncated) info.append(h("div", { class: "banner warn", style: { margin: 0 } }, icon("warning"), h("div", { text: "This value is large, so only part of it is shown. Editing the value is disabled to avoid losing data; the TTL can still be changed." })));
        if (!editableType) info.append(h("div", { class: "banner info", style: { margin: 0 } }, icon("info"), h("div", { text: kv.type + " keys are read-only here. Use the query console to change them." })));
        valueTa.readOnly = readOnlyView || kv.truncated || !editableType;
        saveBtn.disabled = readOnlyView || !editableType && !kv.truncated;
      }).catch(function (err) { valueTa.value = ""; info.append(formError(err)); });
    }
    return function collect() {
      if (!loaded) throw new Error("The value is still loading.");
      var values = {};
      var ttl = ttlInput.value.trim();
      if (ttl && !/^-?\d+$/.test(ttl)) throw new Error("TTL must be a whole number of seconds.");
      if (isNew) {
        if (!keyInput.value) throw new Error("Enter a key name.");
        values.key = { mode: "value", value: keyInput.value };
        values.type = { mode: "value", value: typeSel.value };
        values.value = { mode: "value", value: valueTa.value };
        if (ttl) values.ttl = { mode: "value", value: ttl };
        return values;
      }
      if (!valueTa.readOnly && valueTa.value !== original.value) values.value = { mode: "value", value: valueTa.value };
      if (ttl) values.ttl = { mode: "value", value: ttl };
      if (!Object.keys(values).length) { toast("info", "Nothing changed."); return null; }
      return values;
    };
  }

  /** Replaces the selection, keeping the editor's undo history when the browser allows it. */
  function insertAtCursor(ta, text) {
    ta.focus();
    var ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
    if (!ok) {
      var s = ta.selectionStart, e2 = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e2);
      ta.selectionStart = ta.selectionEnd = s + text.length;
      ta.dispatchEvent(new Event("input"));
    }
  }
  function replaceRange(ta, start, end, text) {
    ta.focus();
    ta.setSelectionRange(start, end);
    insertAtCursor(ta, text);
  }

  // ------------------------------------------------------------------ Query view
  var PLACEHOLDERS = {
    sql: "SELECT *\nFROM users\nWHERE created_at > now() - interval '7 days'\nORDER BY id DESC\nLIMIT 100;",
    oracle: "SELECT *\nFROM employees\nWHERE hire_date > SYSDATE - 7\nORDER BY employee_id DESC\nFETCH FIRST 100 ROWS ONLY;\n\n-- PL/SQL blocks run as one unit; end them with a line holding only /",
    sqlserver: "SELECT TOP 100 *\nFROM dbo.users\nWHERE created_at > DATEADD(day, -7, SYSUTCDATETIME())\nORDER BY id DESC;",
    clickhouse: "SELECT toStartOfDay(ts) AS day, count() AS events\nFROM events\nWHERE ts > now() - INTERVAL 7 DAY\nGROUP BY day\nORDER BY day;",
    document: "db.users.find({ active: true }).sort({ createdAt: -1 }).limit(20)\n\n// Also: aggregate([...]), countDocuments({}), insertOne({...}),\n// updateMany({...}, { $set: {...} }), deleteOne({ _id: ObjectId(\"...\") }), show collections",
    keyvalue: "SCAN 0 MATCH user:* COUNT 100\n\n# One command per line, e.g. HGETALL user:42, TTL session:abc, SET greeting \"hello world\""
  };

  // ---- Syntax highlighting: tokens become spans under a transparent textarea.
  function wordSet(text) { var o = {}; text.split(" ").forEach(function (w) { o[w] = 1; }); return o; }
  var SQL_KEYWORDS = wordSet("select from where and or not in is null like ilike between exists as on join inner left right full outer cross natural using group by order having limit offset fetch first next rows row only union all intersect except minus distinct case when then else end with recursive insert into values update set delete merge matched create table view index drop alter add column primary key foreign references default unique check constraint if returning asc desc nulls over partition window lateral true false interval explain analyze materialized temporary temp truncate grant revoke begin commit rollback transaction declare cursor for procedure function trigger return returns language replace schema database use show describe top go exec execute call do loop while elsif raise exception sequence identity auto_increment engine format settings prewhere final sample collate cascade restrict vacuum pragma attach detach tablespace comment cluster to of by");
  var SQL_TYPES = wordSet("int integer bigint smallint tinyint mediumint serial bigserial smallserial numeric decimal number real double precision float boolean bool bit char character varchar varchar2 nchar nvarchar nvarchar2 text clob nclob blob bytea json jsonb xml date time timestamp timestamptz datetime datetime2 datetime64 uuid string uint8 uint16 uint32 uint64 int8 int16 int32 int64 float32 float64 nullable lowcardinality array map tuple enum raw money");
  var MONGO_WORDS = wordSet("db true false null new ObjectId ISODate Date NumberLong NumberInt NumberDecimal UUID Timestamp RegExp BinData MinKey MaxKey undefined show dbs collections");
  var SQL_RE = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`[^`]*`?)|(\$\d+|(?<!:):[A-Za-z_]\w*|@[A-Za-z_]\w*|\?)|(\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b|\.\d+\b)|([A-Za-z_][\w$#]*)/g;
  var MONGO_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\$[A-Za-z_]\w*)|(-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

  function tokenize(text, mode) {
    var out = [];
    var last = 0;
    function push(cls, value) { if (value) out.push({ c: cls, v: value }); }
    if (mode === "keyvalue") {
      text.split(/(\n)/).forEach(function (line) {
        if (line === "\n") { push("", "\n"); return; }
        if (/^\s*(#|\/\/)/.test(line)) { push("tk-com", line); return; }
        var re = /("(?:[^"\\]|\\.)*"?|'[^']*'?)|(-?\b\d+(?:\.\d+)?\b)|(\S+)/g, m, first = true, at = 0;
        while ((m = re.exec(line))) {
          push("", line.slice(at, m.index));
          push(m[1] ? "tk-str" : m[2] && !first ? "tk-num" : first ? "tk-kw" : "", m[0]);
          first = false;
          at = re.lastIndex;
        }
        push("", line.slice(at));
      });
      return out;
    }
    var re = mode === "document" ? MONGO_RE : SQL_RE;
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text))) {
      push("", text.slice(last, m.index));
      var v = m[0], cls = "";
      var next = text.slice(re.lastIndex, re.lastIndex + 40);
      if (mode === "document") {
        if (m[1]) cls = "tk-com";
        else if (m[2]) cls = "tk-str";
        else if (m[3]) cls = "tk-op";
        else if (m[4]) cls = "tk-num";
        else cls = MONGO_WORDS[v] ? "tk-kw" : text.charAt(m.index - 1) === "." ? "tk-fn" : /^\s*:/.test(next) ? "tk-key" : "";
      } else {
        if (m[1]) cls = "tk-com";
        else if (m[2]) cls = "tk-str";
        else if (m[3]) cls = "tk-id";
        else if (m[4]) cls = "tk-param";
        else if (m[5]) cls = "tk-num";
        else {
          var lower = v.toLowerCase();
          cls = SQL_KEYWORDS[lower] ? "tk-kw" : SQL_TYPES[lower] ? "tk-type" : /^\s*\(/.test(next) ? "tk-fn" : "";
        }
      }
      push(cls, v);
      last = re.lastIndex;
      if (v === "") re.lastIndex++;
    }
    push("", text.slice(last));
    return out;
  }

  function editorMode(c) {
    if (!c) return "sql";
    return c.family === "document" ? "document" : c.family === "keyvalue" ? "keyvalue" : "sql";
  }

  /** Repaints the highlight layer and the line numbers; marks the error range, if any. */
  function paintEditor(t) {
    if (!t.ui || !t.ui.hl) return;
    var text = t.editor.value;
    var c = conn(t.connId);
    var hl = clear(t.ui.hl);
    var mark = t.errMark;
    if (text.length > 120000) hl.append(document.createTextNode(text));
    else {
      var at = 0;
      tokenize(text, editorMode(c)).forEach(function (tok) {
        var start = at, end = at + tok.v.length;
        at = end;
        if (mark && mark.start < end && mark.end > start) {
          var a = Math.max(mark.start, start) - start, b = Math.min(mark.end, end) - start;
          if (a > 0) hl.append(span(tok.c, tok.v.slice(0, a)));
          hl.append(span((tok.c ? tok.c + " " : "") + "err-mark", tok.v.slice(a, b)));
          if (b < tok.v.length) hl.append(span(tok.c, tok.v.slice(b)));
        } else hl.append(span(tok.c, tok.v));
      });
      if (mark && mark.start >= text.length) hl.append(span("err-mark", " "));
    }
    // A trailing newline needs a line of its own, or the layers drift apart at the end.
    hl.append(document.createTextNode("\n "));
    var lines = text.split("\n").length;
    if (t.ui.gutterLines !== lines || t.ui.gutterMark !== (mark ? mark.line : 0)) {
      t.ui.gutterLines = lines;
      t.ui.gutterMark = mark ? mark.line : 0;
      var g = clear(t.ui.gutter);
      for (var i = 1; i <= lines; i++) g.append(h("div", { class: mark && mark.line === i ? "err" : "", text: String(i) }));
    }
    syncScroll(t);
  }
  function span(cls, text) { return cls ? h("span", { class: cls, text: text }) : document.createTextNode(text); }
  function syncScroll(t) {
    t.ui.hl.scrollTop = t.editor.scrollTop;
    t.ui.hl.scrollLeft = t.editor.scrollLeft;
    t.ui.gutter.scrollTop = t.editor.scrollTop;
  }

  function buildQueryView(t) {
    var view = h("div", { class: "view" });
    t.ui = {};
    t.ui.bar = h("div", { class: "qbar" });
    var editor = h("textarea", { class: "editor", spellcheck: "false", "aria-label": "Query editor", autocomplete: "off", autocapitalize: "off", wrap: "off" });
    editor.value = t.text || "";
    t.editor = editor;
    t.ui.hl = h("pre", { class: "hl", "aria-hidden": "true" });
    t.ui.gutter = h("div", { class: "gutter", "aria-hidden": "true" });
    var frame = 0;
    editor.addEventListener("input", function () {
      t.text = editor.value;
      persistSoon();
      if (t.errMark) { t.errMark = null; }
      if (!frame) frame = requestAnimationFrame(function () { frame = 0; paintEditor(t); });
    });
    editor.addEventListener("scroll", function () { syncScroll(t); });
    editor.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); insertAtCursor(editor, "  "); }
    });
    // Shortcuts work anywhere in the tab, not only while the editor has focus.
    view.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runQuery(t); }
      else if (e.shiftKey && e.altKey && e.code === "KeyF") { e.preventDefault(); formatQuery(t); }
    });
    var editorWrap = h("div", { class: "editor-wrap", style: { "--editor-h": (t.editorH || 200) + "px" } }, t.ui.gutter, h("div", { class: "code" }, t.ui.hl, editor));
    var split = h("div", { class: "hsplit", role: "separator", "aria-orientation": "horizontal", title: "Drag to resize" });
    t.ui.result = h("div", { class: "qresult" });
    view.append(t.ui.bar, h("div", { class: "qsplit" }, editorWrap, split, t.ui.result));
    var startY = 0, startH = 0;
    function move(e) { t.editorH = Math.max(80, Math.min(window.innerHeight - 160, startH + e.clientY - startY)); editorWrap.style.setProperty("--editor-h", t.editorH + "px"); }
    function up() { split.classList.remove("dragging"); document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); persistSoon(); }
    split.addEventListener("mousedown", function (e) { startY = e.clientY; startH = editorWrap.offsetHeight; split.classList.add("dragging"); document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); e.preventDefault(); });
    updateQueryBar(t);
    paintEditor(t);
    renderQueryResult(t);
    return view;
  }

  function updateQueryBar(t) {
    var c = conn(t.connId);
    if (!c || !t.ui) return;
    t.editor.placeholder = PLACEHOLDERS[c.kind] || PLACEHOLDERS[family(c)] || "";
    var bar = t.ui.bar;
    clear(bar);
    var connSel = h("select", { class: "select", "aria-label": "Connection" }, S.connections.map(function (x) { return h("option", { value: x.id, text: x.name, selected: x.id === t.connId }); }));
    connSel.addEventListener("change", function () {
      t.connId = connSel.value; t.database = ""; t.schema = ""; t.databases = null; t.schemasList = null; t.errMark = null;
      var nc = conn(t.connId);
      if (nc) t.database = nc.defaultDatabase || "";
      persistSoon(); renderTabs(); updateQueryBar(t); paintEditor(t);
    });
    bar.append(h("span", { class: "dot " + c.status, title: c.status }), connSel);
    if (c.kind !== "sqlite") {
      var dbSel = h("select", { class: "select", "aria-label": "Database" });
      var dbs = t.databases || (t.database ? [t.database] : []);
      if (!dbs.length) dbSel.append(h("option", { value: "", text: "Default database" }));
      dbs.forEach(function (d) { dbSel.append(h("option", { value: d, text: dbLabel(c, d), selected: d === t.database })); });
      dbSel.addEventListener("change", function () { t.database = dbSel.value; t.schema = ""; t.schemasList = null; persistSoon(); updateQueryBar(t); });
      bar.append(dbSel);
      if (!t.databases && !t.loadingDbs) {
        t.loadingDbs = true;
        call("listDatabases", { id: t.connId }).then(function (res) {
          t.loadingDbs = false; t.databases = res.databases;
          if (!t.database) t.database = res.defaultDatabase || res.databases[0] || "";
          updateQueryBar(t);
        }).catch(function () { t.loadingDbs = false; t.databases = t.database ? [t.database] : []; });
      }
      // The console can switch schema on PostgreSQL, CockroachDB and Oracle; SQL Server uses the login's default.
      if (c.schemas && t.database && c.kind !== "sqlserver") {
        var schSel = h("select", { class: "select", "aria-label": "Schema" }, h("option", { value: "", text: "Default schema" }));
        (t.schemasList || (t.schema ? [t.schema] : [])).forEach(function (s) { schSel.append(h("option", { value: s, text: s, selected: s === t.schema })); });
        schSel.addEventListener("change", function () { t.schema = schSel.value; persistSoon(); });
        bar.append(schSel);
        if (!t.schemasList && !t.loadingSchemas) {
          t.loadingSchemas = true;
          call("listSchemas", { id: t.connId, database: t.database }).then(function (list) { t.loadingSchemas = false; t.schemasList = list; updateQueryBar(t); }).catch(function () { t.loadingSchemas = false; t.schemasList = []; });
        }
      }
    }
    t.ui.runBtn = btn(t.running ? "Running…" : "Run", t.running ? "loading" : "play", function () { runQuery(t); }, "primary", { disabled: t.running, title: "Run (" + MOD + "Enter). Runs the selection if there is one." });
    if (t.running) t.ui.runBtn.querySelector(".codicon").classList.add("codicon-modifier-spin");
    bar.append(t.ui.runBtn);
    if (t.running && c.features && c.features.cancel) {
      bar.append(btn(t.cancelling ? "Cancelling…" : "Cancel", "debug-stop", function () { cancelQuery(t); }, "danger", { disabled: t.cancelling, title: "Stop the running query on the server" }));
    }
    if (c.family === "sql") bar.append(btn("Format", "list-flat", function () { formatQuery(t); }, "ghost", { title: "Format SQL (Shift+Alt+F). Formats the selection if there is one.", disabled: t.running }));
    bar.append(
      btn("History", "history", function (e) { showHistory(t, e.currentTarget); }, "ghost"),
      iconBtn("clear-all", "Clear editor", function () { replaceRange(t.editor, 0, t.editor.value.length, ""); t.editor.focus(); }));
    if (c.readOnly) bar.append(h("span", { class: "chip warn", title: "Writes are blocked on this connection" }, icon("lock"), "read-only"));
    bar.append(h("span", { class: "grow" }), h("span", { class: "muted kbd-hint" }, h("span", { class: "hint-kbd", text: MOD + "Enter" }), " to run"));
  }

  function showHistory(t, anchor) {
    var list = S.history[t.connId] || [];
    if (!list.length) { showMenu([{ label: "No queries yet", icon: "history", disabled: true, run: function () {} }], anchor); return; }
    showMenu(list.slice(0, 20).map(function (q) {
      var line = q.replace(/\s+/g, " ").trim();
      return { label: line.length > 70 ? line.slice(0, 70) + "…" : line, icon: "history", run: function () { replaceRange(t.editor, 0, t.editor.value.length, q); t.editor.focus(); } };
    }).concat(["-", { label: "Clear history", icon: "clear-all", run: function () { S.history[t.connId] = []; persist(); } }]), anchor);
  }

  /** What would run: the selection, or everything, and where it starts in the editor. */
  function queryScope(ed) {
    var hasSel = ed.selectionEnd > ed.selectionStart;
    var raw = hasSel ? ed.value.slice(ed.selectionStart, ed.selectionEnd) : ed.value;
    if (!raw.trim()) return null;
    var lead = raw.length - raw.replace(/^\s+/, "").length;
    return { text: raw.trim(), start: (hasSel ? ed.selectionStart : 0) + lead, selection: hasSel };
  }

  function formatQuery(t) {
    var ed = t.editor;
    var scope = queryScope(ed);
    if (!scope) { toast("info", "Type a query first."); return; }
    call("formatQuery", { id: t.connId, text: scope.text }).then(function (res) {
      if (!res || typeof res.text !== "string") return;
      replaceRange(ed, scope.start, scope.start + scope.text.length, res.text);
      if (scope.selection) ed.setSelectionRange(scope.start, scope.start + res.text.length);
    }).catch(fail);
  }

  function cancelQuery(t) {
    if (!t.running || !t.runId || t.cancelling) return;
    t.cancelling = true;
    updateQueryBar(t);
    call("cancelQuery", { runId: t.runId }).catch(fail);
  }

  /** Line and column (1-based) of an offset in the editor. */
  function lineCol(text, offset) {
    var before = text.slice(0, offset).split("\n");
    return { line: before.length, col: before[before.length - 1].length + 1 };
  }

  function runQuery(t) {
    if (t.running) return;
    var ed = t.editor;
    var scope = queryScope(ed);
    if (!scope) { toast("info", "Type a query first."); ed.focus(); return; }
    var text = scope.text;
    t.running = true;
    t.cancelling = false;
    t.runStarted = Date.now();
    t.runId = uid() + uid();
    t.error = null;
    t.errMark = null;
    paintEditor(t);
    updateQueryBar(t);
    renderQueryResult(t);
    var timer = setInterval(function () { var el = t.ui.result.querySelector(".run-elapsed"); if (el) el.textContent = fmtElapsed(Date.now() - t.runStarted); }, 100);
    call("runQuery", { id: t.connId, database: t.database || undefined, schema: t.schema || undefined, text: text, runId: t.runId }).then(function (res) {
      if (res && res.cancelled) { t.cancelled = { message: "Cancelled. Nothing was run." }; t.result = null; return; }
      t.cancelled = null;
      t.result = res;
      t.resView = { sort: null, filter: "" };
      t.resWidths = {};
      var hist = S.history[t.connId] = (S.history[t.connId] || []).filter(function (q) { return q !== text; });
      hist.unshift(text);
      if (hist.length > 30) hist.length = 30;
      persistSoon();
      if (res.writes) {
        if (/\b(create|drop|alter|rename|createCollection|drop\(|renameCollection)\b/i.test(text)) refreshDb(t.connId, t.database);
        S.tabs.forEach(function (o) { if (o.type === "data" && o.connId === t.connId && o.result) o.needsLoad = true; });
      }
    }).catch(function (err) {
      t.result = null;
      if (err.code === "CANCELLED") { t.cancelled = { message: err.message, hint: err.hint }; return; }
      t.cancelled = null;
      t.error = err;
      if (typeof err.position === "number" && err.position >= 0 && err.position <= text.length) {
        var at = scope.start + err.position;
        var word = /^[\w$#.:"`]+/.exec(ed.value.slice(at, at + 200));
        var lc = lineCol(ed.value, at);
        t.errMark = { start: at, end: at + (word ? word[0].length : 1), line: lc.line, col: lc.col };
      }
    }).then(function () {
      clearInterval(timer);
      t.running = false;
      t.cancelling = false;
      t.lastElapsed = Date.now() - t.runStarted;
      t.finishedAt = Date.now();
      paintEditor(t);
      updateQueryBar(t);
      renderQueryResult(t);
    });
  }

  function fmtElapsed(ms) { return ms < 1000 ? ms + " ms" : ms < 60000 ? (ms / 1000).toFixed(1) + " s" : Math.floor(ms / 60000) + " min " + Math.round((ms % 60000) / 1000) + " s"; }

  function goToError(t) {
    if (!t.errMark) return;
    t.editor.focus();
    t.editor.setSelectionRange(t.errMark.start, t.errMark.end);
    // Scroll the marked line into view.
    var lineH = parseFloat(getComputedStyle(t.editor).lineHeight) || 20;
    t.editor.scrollTop = Math.max(0, (t.errMark.line - 3) * lineH);
    syncScroll(t);
  }

  function compareValues(a, b) {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    var x = plainText(a), y = plainText(b);
    var nx = Number(x), ny = Number(y);
    if (x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny)) return nx - ny;
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  }

  function renderQueryResult(t) {
    var box = t.ui.result;
    clear(box);
    box.setAttribute("aria-busy", String(!!t.running));
    if (t.finishedAt && !t.running) window.DevSnipExecution(box, t.error ? "failed" : t.cancelled ? "cancelled" : "completed", t.error ? "Failed · no new result" : t.cancelled ? "Cancelled" : "Completed · query result", t.finishedAt);
    var c = conn(t.connId);
    if (t.running) {
      box.append(h("div", { class: "qstatus" }, icon("loading", "codicon-modifier-spin"), t.cancelling ? "Cancelling…" : "Running…", h("span", { class: "run-elapsed", text: fmtElapsed(Date.now() - t.runStarted) }),
        c && c.features && c.features.cancel ? btn(t.cancelling ? "Cancelling…" : "Cancel", "debug-stop", function () { cancelQuery(t); }, "ghost", { disabled: t.cancelling }) : null), h("div", { class: "qplaceholder" }));
      return;
    }
    if (t.error) {
      var where = t.errMark ? "Line " + t.errMark.line + ", column " + t.errMark.col : null;
      box.append(h("div", { class: "banner error", style: { marginTop: "10px" } }, icon("error"),
        h("div", { class: "grow" }, t.error.message, t.error.hint ? h("span", { class: "hint", text: t.error.hint }) : null, where ? h("span", { class: "hint", text: where + " is underlined in the editor." }) : null),
        where ? btn("Go to error", "go-to-file", function () { goToError(t); }, "", { title: where }) : null));
      return;
    }
    if (t.cancelled) {
      box.append(h("div", { class: "banner info", style: { marginTop: "10px" } }, icon("circle-slash"), h("div", { class: "grow" }, t.cancelled.message, t.cancelled.hint ? h("span", { class: "hint", text: t.cancelled.hint }) : null)));
      return;
    }
    var res = t.result;
    if (!res) {
      box.append(h("div", { class: "qplaceholder" }, h("div", null,
        h("div", { style: { marginBottom: "6px" } }, "Write a ", c && c.family === "document" ? "mongosh command" : c && c.family === "keyvalue" ? "Redis command" : "SQL query", " and press ", h("kbd", { text: MOD + "Enter" }), "."),
        h("div", { text: "Destructive statements ask for confirmation first." + (c && c.features && c.features.cancel ? " Long-running queries can be cancelled." : "") }))));
      return;
    }
    var view = t.resView || (t.resView = { sort: null, filter: "" });
    var status = h("div", { class: "qstatus" }, icon("pass-filled", "ok"));
    var countEl = h("span");
    status.append(countEl);
    status.append(h("span", { title: "Server round trip" }, icon("watch"), " " + fmtElapsed(res.elapsedMs)));
    if (res.columns.length && res.rows.length) {
      var filterInput = h("input", { class: "input", type: "search", placeholder: "Filter results…", value: view.filter, "aria-label": "Filter results" });
      filterInput.addEventListener("input", debounce(function () { view.filter = filterInput.value; paintRows(); }, 120));
      status.append(h("span", { class: "acts" },
        h("div", { class: "search result-filter" }, icon("filter"), filterInput),
        btn("JSON", "copy", function () { copy(toJson(visibleRows())); }, "ghost", { title: "Copy the shown rows as JSON" }),
        btn("CSV", "copy", function () { copy(toCsv(res.columns, visibleRows())); }, "ghost", { title: "Copy the shown rows as CSV" }),
        iconBtn("go-to-file", "Open the shown rows in an editor", function () { call("openInEditor", { content: toJson(visibleRows()), language: "json" }).catch(fail); })));
    }
    box.append(status);
    if (res.message) box.append(h("div", { class: "qmessage", text: res.message }));
    if (res.truncated) box.append(h("div", { class: "banner warn" }, icon("warning"), h("div", { text: "Only the first " + fmtNum(res.rows.length) + " rows are shown. Add a LIMIT (or .limit()) to fetch less." })));
    var body = h("tbody");
    function visibleRows() {
      var f = (view.filter || "").trim().toLowerCase();
      var rows = f ? res.rows.filter(function (row) { return res.columns.some(function (col) { return plainText(row[col]).toLowerCase().indexOf(f) >= 0; }); }) : res.rows.slice();
      if (view.sort) {
        var col = view.sort.column, dir = view.sort.dir === "desc" ? -1 : 1;
        rows.sort(function (a, b) { return compareValues(a[col], b[col]) * dir; });
      }
      return rows;
    }
    function paintRows() {
      var rows = visibleRows();
      clear(countEl);
      if (res.columns.length) countEl.append(plural(res.rows.length, "row") + (res.truncated ? " (first " + fmtNum(res.rows.length) + " shown)" : "") + (rows.length !== res.rows.length ? " · " + fmtNum(rows.length) + " match" : ""));
      else if (typeof res.affected === "number") countEl.append(plural(res.affected, "row") + " affected");
      else countEl.append("Done");
      clear(body);
      rows.forEach(function (row, i) {
        var tr = h("tr", null, h("td", { class: "rn", text: String(i + 1) }));
        res.columns.forEach(function (col) {
          var v = row[col];
          var td = h("td", null, cellContent(v, !(col in row)));
          var full = plainText(v);
          if (full.length > 40) td.title = full.slice(0, 2000);
          td.addEventListener("contextmenu", function (e) { e.preventDefault(); showMenu([{ label: "Copy value", icon: "copy", run: function () { copy(full); } }, { label: "Copy row as JSON", icon: "json", run: function () { copy(toJson([row])); } }], { x: e.clientX, y: e.clientY }); });
          tr.append(td);
        });
        body.append(tr);
      });
      if (table) applyAllWidths();
    }
    var table = null;
    function applyAllWidths() {
      Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th, index) { var n = th.getAttribute("data-col"); if (n && t.resWidths[n]) applyWidth(table, index, t.resWidths[n]); });
    }
    if (res.columns.length) {
      var wrap = h("div", { class: "grid-wrap" });
      if (!res.rows.length) wrap.append(h("div", { class: "grid-empty" }, icon("inbox"), "No rows."));
      else {
        table = h("table", { class: "grid" });
        var hr = h("tr", null, h("th", { class: "rn", text: "#" }));
        res.columns.forEach(function (col) {
          var sorted = view.sort && view.sort.column === col ? view.sort.dir : null;
          var th = h("th", { class: "sortable", "data-col": col, title: col + " — click to sort the shown rows", "aria-sort": sorted ? (sorted === "asc" ? "ascending" : "descending") : null },
            h("div", { class: "h" }, h("span", { class: "name", text: col }), sorted ? icon(sorted === "asc" ? "arrow-up" : "arrow-down", "sort") : null));
          th.addEventListener("click", function () {
            if (!view.sort || view.sort.column !== col) view.sort = { column: col, dir: "asc" };
            else if (view.sort.dir === "asc") view.sort = { column: col, dir: "desc" };
            else view.sort = null;
            renderQueryResult(t);
          });
          hr.append(th);
        });
        table.append(h("thead", null, hr), body);
        wrap.append(table);
        t.resWidths = t.resWidths || {};
        enableColumnResize(table, t.resWidths, null);
      }
      box.append(wrap);
    }
    paintRows();
  }

  // ------------------------------------------------------------------ Connection modal
  /** The host's stand-in for a saved password; saving it back keeps the stored one. */
  var MASK = "********";
  var TLS_CHOICES = {
    postgres: [["", "Off"], ["require", "On, no certificate check"], ["verify-full", "On, verify certificate"]],
    mysql: [["", "Off"], ["REQUIRED", "On, no certificate check"], ["VERIFY_IDENTITY", "On, verify certificate"]],
    sqlserver: [["false", "Off"], ["true", "Encrypt, verify certificate"], ["trust", "Encrypt, trust server certificate"]],
    oracle: [["", "Off (TCP)"], ["tcps", "On (TCPS)"]],
    clickhouse: [["", "Off (HTTP)"], ["https", "On (HTTPS)"]],
    mongodb: [["", "Off"], ["tls", "On"], ["insecure", "On, allow invalid certificates"]],
    redis: [["", "Off"], ["tls", "On (rediss://)"]]
  };
  TLS_CHOICES.cockroachdb = TLS_CHOICES.postgres;
  TLS_CHOICES.mariadb = TLS_CHOICES.mysql;
  var USER_HINT = { postgres: "postgres", cockroachdb: "root", mysql: "root", mariadb: "root", sqlserver: "sa", oracle: "app", clickhouse: "default", mongodb: "optional", redis: "optional (ACL user)" };
  var DB_HINT = { postgres: "app", cockroachdb: "defaultdb", mysql: "app", mariadb: "app", sqlserver: "app", oracle: "FREEPDB1", clickhouse: "default", mongodb: "app", redis: "0" };
  var KNOWN_OPTIONS = ["ssl", "tls", "sslmode", "ssl-mode", "secure", "encrypt", "trustservercertificate", "tlsallowinvalidcertificates", "user id", "uid", "user", "username", "database", "initial catalog", "databasename", "port"];

  function truthyText(v) { return /^(true|yes|1)$/i.test(String(v || "").trim()); }
  function enc(v) { return encodeURIComponent(v); }
  function adoValue(v) { return /[;{}=\s'"]/.test(v) ? "{" + v.replace(/}/g, "}}") + "}" : v; }

  function emptyForm(kind) {
    return { kind: kind || "postgres", host: "localhost", port: "", user: "", password: "", savedPassword: false, database: "", tls: kind === "sqlserver" ? "false" : "", srv: false, file: "", extra: "" };
  }

  /** Builds the connection string the host parses, from the form fields. */
  function composeConnection(f) {
    var kind = f.kind;
    var pw = f.password || (f.savedPassword ? MASK : "");
    if (kind === "sqlite") {
      var file = f.file.trim();
      if (!file) return "";
      if (/^[A-Za-z]:[\\/]/.test(file)) return "sqlite:///" + file.replace(/\\/g, "/");
      return "sqlite://" + (file.charAt(0) === "/" || file.charAt(0) === "~" ? "" : "./") + file.replace(/^\.\//, "");
    }
    var host = f.host.trim() || "localhost";
    if (kind === "sqlserver") {
      var parts = ["Server=" + host + (f.port ? "," + f.port : "")];
      if (f.database) parts.push("Database=" + adoValue(f.database));
      if (f.user) parts.push("User Id=" + adoValue(f.user));
      if (pw) parts.push("Password=" + (pw === MASK ? MASK : adoValue(pw)));
      parts.push("Encrypt=" + (f.tls && f.tls !== "false" ? "true" : "false"));
      if (f.tls === "trust") parts.push("TrustServerCertificate=true");
      var extraKv = f.extra.trim().replace(/^;+|;+$/g, "");
      if (extraKv) parts.push(extraKv);
      return parts.join(";");
    }
    var scheme = { postgres: "postgresql", cockroachdb: "cockroachdb", mysql: "mysql", mariadb: "mariadb", oracle: "oracle", clickhouse: "clickhouse", mongodb: f.srv ? "mongodb+srv" : "mongodb", redis: f.tls ? "rediss" : "redis" }[kind] || kind;
    var auth = f.user || pw ? enc(f.user) + (pw ? ":" + (pw === MASK ? MASK : enc(pw)) : "") + "@" : "";
    if (host.indexOf(":") >= 0 && host.indexOf(",") < 0 && host.charAt(0) !== "[") host = "[" + host + "]";
    var port = f.port && !(kind === "mongodb" && f.srv) && host.indexOf(",") < 0 ? ":" + f.port : "";
    var path = f.database ? "/" + enc(f.database) : "";
    var q = [];
    if ((kind === "postgres" || kind === "cockroachdb") && f.tls) q.push("sslmode=" + f.tls);
    if (kind === "cockroachdb" && !f.tls) q.push("sslmode=disable");
    if ((kind === "mysql" || kind === "mariadb") && f.tls) q.push("ssl-mode=" + f.tls);
    if (kind === "oracle" && f.tls) q.push("ssl=true");
    if (kind === "clickhouse" && f.tls) q.push("secure=true");
    if (kind === "mongodb" && f.tls && !f.srv) q.push("tls=true");
    if (kind === "mongodb" && f.tls === "insecure") q.push("tlsAllowInvalidCertificates=true");
    var extra = f.extra.trim().replace(/^[?&]+/, "");
    if (extra) q.push(extra);
    return scheme + "://" + auth + host + port + path + (q.length ? "?" + q.join("&") : "");
  }

  /** The password as typed in a connection string, so switching to the form keeps it (it never leaves this page). */
  function typedPassword(raw) {
    var text = String(raw || "").trim();
    var kv = /(?:^|;)\s*(?:password|pwd)\s*=\s*(\{(?:[^}]|\}\})*\}|"[^"]*"|'[^']*'|[^;]*)/i.exec(text);
    if (kv && !/^[a-z][a-z0-9+]*:\/\/[^;]*@/i.test(text)) {
      var v = kv[1].trim();
      if (v.charAt(0) === "{") return v.slice(1, -1).replace(/}}/g, "}");
      if (/^["']/.test(v)) return v.slice(1, -1);
      return v;
    }
    var m = /^[a-z][a-z0-9+]*:\/\/([^?]*)/i.exec(text);
    if (!m) return "";
    var head = m[1];
    var at = head.lastIndexOf("@");
    if (at < 0) return "";
    var auth = head.slice(0, at);
    var colon = auth.indexOf(":");
    if (colon < 0) return "";
    try { return decodeURIComponent(auth.slice(colon + 1)); } catch (e) { return auth.slice(colon + 1); }
  }

  /** Fills the form from what the host detected in a connection string. */
  function formFromDetect(res, raw) {
    var s = res.summary || {}, o = res.options || {};
    var f = emptyForm(res.kind);
    if (res.kind === "sqlite") { f.file = s.file || ""; return f; }
    f.host = s.host || "";
    f.port = s.port && s.port !== (S.kinds[res.kind] || {}).defaultPort ? String(s.port) : "";
    f.user = s.user || "";
    f.database = s.database || "";
    f.srv = /^mongodb\+srv:/i.test(String(raw).trim());
    var pw = typedPassword(raw);
    if (pw === MASK) f.savedPassword = true; else f.password = pw;
    var k = res.kind;
    if (k === "postgres" || k === "cockroachdb") f.tls = o.sslmode && o.sslmode !== "disable" ? (/verify/.test(o.sslmode) ? "verify-full" : "require") : s.ssl ? "require" : "";
    else if (k === "mysql" || k === "mariadb") { var mode = String(o["ssl-mode"] || o.sslmode || "").toUpperCase(); f.tls = /VERIFY/.test(mode) ? "VERIFY_IDENTITY" : s.ssl ? "REQUIRED" : ""; }
    else if (k === "sqlserver") f.tls = s.ssl ? (truthyText(o.trustservercertificate) ? "trust" : "true") : "false";
    else if (k === "oracle") f.tls = s.ssl ? "tcps" : "";
    else if (k === "clickhouse") f.tls = s.ssl ? "https" : "";
    else if (k === "mongodb") f.tls = s.ssl && !f.srv ? (truthyText(o.tlsallowinvalidcertificates) ? "insecure" : "tls") : "";
    else if (k === "redis") f.tls = s.ssl ? "tls" : "";
    if (k === "oracle" && o.sid) { f.database = ""; }
    var extras = Object.keys(o).filter(function (key) { return KNOWN_OPTIONS.indexOf(key) < 0 && !(k === "sqlserver" && /^(server|data source|address|addr|network address)$/.test(key)); });
    f.extra = k === "sqlserver"
      ? extras.map(function (key) { return key + "=" + adoValue(o[key]); }).join(";")
      : extras.map(function (key) { return enc(key) + "=" + enc(o[key]); }).join("&");
    return f;
  }

  function openConnectionModal(id, preset) {
    preset = preset || {};
    var editing = !!id;
    var state = {
      mode: preset.kind ? "form" : (S.connMode || "form"),
      form: emptyForm(preset.kind || "postgres"),
      readOnly: false,
      color: COLORS[S.connections.length % COLORS.length],
      detected: null
    };
    var nameInput = h("input", { class: "input", placeholder: "e.g. Local Postgres", maxlength: "60", "aria-label": "Name" });
    var csInput = h("input", { class: "input mono", type: "password", placeholder: "postgresql://user:password@localhost:5432/app", spellcheck: "false", autocomplete: "off", "aria-label": "Connection string" });
    var reveal = iconBtn("eye", "Show connection string", function () {
      var hidden = csInput.type === "password";
      csInput.type = hidden ? "text" : "password";
      clear(reveal).append(icon(hidden ? "eye-closed" : "eye"));
      reveal.title = hidden ? "Hide connection string" : "Show connection string";
    });
    function pickFile() {
      call("pickSqliteFile").then(function (res) {
        if (!res || !res.connectionString) return;
        state.form.kind = "sqlite";
        state.form.file = res.connectionString.replace(/^sqlite:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");
        csInput.value = res.connectionString;
        if (!nameInput.value) nameInput.value = res.connectionString.split("/").pop();
        if (state.mode === "form") renderForm();
        detect();
      }).catch(fail);
    }
    var browse = btn("Browse…", "folder-opened", pickFile, "", { title: "Pick a SQLite file" });
    function detectPrompt() { return state.mode === "form" ? "Fill in the connection details." : "Paste a connection string to detect the database type."; }
    var detectBox = h("div", { class: "detect" }, icon("info"), h("div", { class: "muted", text: detectPrompt() }));
    var testResult = h("div", { class: "test-result" });
    var errorBox = h("div");
    var readOnlyCk = h("input", { type: "checkbox" });
    var colors = h("div", { class: "colors", role: "radiogroup", "aria-label": "Color" });
    function renderColors() {
      clear(colors);
      COLORS.forEach(function (name) {
        var b = h("button", { type: "button", class: state.color === name ? "on" : "", title: name, role: "radio", "aria-checked": String(state.color === name), "aria-label": name, style: { background: "var(--c-" + name + ")" } });
        b.addEventListener("click", function () { state.color = name; renderColors(); });
        colors.append(b);
      });
    }
    renderColors();
    var examples = h("div", { class: "examples" });
    Object.keys(S.kinds).forEach(function (k) {
      var b = h("button", { type: "button", text: S.kinds[k].label, title: S.kinds[k].example });
      b.addEventListener("click", function () { csInput.value = S.kinds[k].example; csInput.type = "text"; detect(); csInput.focus(); });
      examples.append(b);
    });

    // ---- Mode switch: form fields or a raw connection string, always kept in sync.
    var formBox = h("div", { class: "form-grid" });
    var stringBox = h("div", { class: "field" }, h("label", { text: "Connection string" }), h("div", { class: "with-btn" }, csInput, reveal, browse), examples,
      h("div", { class: "help", text: editing ? "The saved password is shown as ******** — leave it to keep it, or type a new one." : "Also accepts DATABASE_URL=… lines, JDBC URLs (jdbc:postgresql://, jdbc:oracle:thin:@…) and SQL Server key=value strings." }));
    var seg = h("div", { class: "seg mode-switch", role: "tablist", "aria-label": "How to enter the connection" });
    function renderSeg() {
      clear(seg);
      [["form", "list-unordered", "Form"], ["string", "link", "Connection string"]].forEach(function (m) {
        var b = h("button", { type: "button", role: "tab", class: state.mode === m[0] ? "on" : "", "aria-selected": String(state.mode === m[0]) }, icon(m[1]), m[2]);
        b.addEventListener("click", function () { switchMode(m[0]); });
        seg.append(b);
      });
    }
    function switchMode(mode) {
      if (mode === state.mode) return;
      if (mode === "form" && csInput.value.trim()) {
        // Parse what was typed so nothing is lost; a string the host cannot parse stays where it is.
        call("detect", { connectionString: csInput.value, id: id || undefined }).then(function (res) {
          if (!res.ok) { toast("error", "Fix the connection string first.", res.error && res.error.message); return; }
          state.form = formFromDetect(res, csInput.value);
          state.mode = "form"; S.connMode = "form"; persistSoon();
          renderSeg(); renderForm(); showMode();
        }).catch(fail);
        return;
      }
      state.mode = mode; S.connMode = mode; persistSoon();
      renderSeg();
      if (mode === "form") { renderForm(); syncFromForm(); }
      showMode();
    }
    function showMode() {
      formBox.classList.toggle("hidden", state.mode !== "form");
      stringBox.classList.toggle("hidden", state.mode !== "string");
      browse.classList.toggle("hidden", !(state.form.kind === "sqlite" || /^(sqlite|file):/i.test(csInput.value) || (state.detected && state.detected.kind === "sqlite")));
    }
    function syncFromForm() {
      csInput.value = composeConnection(state.form);
      testResult.className = "test-result"; clear(testResult);
      detectSoon();
    }
    function field(label, input, cls, help) {
      return h("div", { class: "field " + (cls || "") }, h("label", null, label), input, help ? h("div", { class: "help", text: help }) : null);
    }
    function textInput(key, attrs) {
      var input = h("input", Object.assign({ class: "input", value: state.form[key] || "", spellcheck: "false", autocomplete: "off" }, attrs || {}));
      input.addEventListener("input", function () { state.form[key] = input.value; syncFromForm(); });
      return input;
    }
    function renderForm() {
      var f = state.form;
      var meta = S.kinds[f.kind] || {};
      clear(formBox);
      var kindSel = h("select", { class: "select", "aria-label": "Database type" }, Object.keys(S.kinds).map(function (k) { return h("option", { value: k, text: S.kinds[k].label, selected: k === f.kind }); }));
      kindSel.addEventListener("change", function () {
        var next = emptyForm(kindSel.value);
        // Keep what still applies when switching type.
        ["host", "user", "password", "savedPassword", "database"].forEach(function (k) { if (kindSel.value !== "sqlite" && f.kind !== "sqlite") next[k] = f[k]; });
        state.form = next;
        renderForm(); showMode(); syncFromForm();
      });
      formBox.append(field("Database type", kindSel, "span2", meta.notes || null));
      if (f.kind === "sqlite") {
        formBox.append(field("Database file", h("div", { class: "with-btn" }, textInput("file", { class: "input mono", placeholder: "/Users/me/project/dev.db", "aria-label": "Database file" }), btn("Browse…", "folder-opened", pickFile)), "span2", "Relative paths resolve against the first workspace folder."));
        return;
      }
      formBox.append(
        field(f.kind === "mongodb" && f.srv ? "Cluster host" : "Host", textInput("host", { placeholder: f.kind === "mongodb" && f.srv ? "cluster0.abcde.mongodb.net" : "localhost", "aria-label": "Host" })),
        f.kind === "mongodb" && f.srv ? h("div") : field("Port", textInput("port", { placeholder: meta.defaultPort ? String(meta.defaultPort) : "", inputmode: "numeric", "aria-label": "Port" })));
      if (f.kind === "mongodb") {
        var srv = h("input", { type: "checkbox", checked: f.srv });
        srv.addEventListener("change", function () { f.srv = srv.checked; if (f.srv) f.port = ""; renderForm(); syncFromForm(); });
        formBox.append(h("label", { class: "inline-check span2" }, srv, "DNS seed list (mongodb+srv://), as used by MongoDB Atlas"));
      }
      var pass = h("input", { class: "input", type: "password", value: f.password, autocomplete: "new-password", placeholder: f.savedPassword ? "Saved password (unchanged)" : "", "aria-label": "Password" });
      pass.addEventListener("input", function () { f.password = pass.value; syncFromForm(); });
      var passReveal = iconBtn("eye", "Show password", function () { pass.type = pass.type === "password" ? "text" : "password"; });
      formBox.append(
        h("div", { class: "pair span2" },
          field("User", textInput("user", { placeholder: USER_HINT[f.kind] || "", "aria-label": "User" })),
          field("Password", h("div", { class: "with-btn" }, pass, passReveal), null, f.savedPassword ? "Leave empty to keep the saved password." : null)),
        field(f.kind === "oracle" ? "Service name" : f.kind === "redis" ? "Database number" : "Database", textInput("database", { placeholder: DB_HINT[f.kind] || "", "aria-label": "Database" }), "span2",
          f.kind === "oracle" ? "The PDB or service, e.g. FREEPDB1 or ORCLPDB1. For a SID, add sid=XE under Options." : f.kind === "postgres" || f.kind === "cockroachdb" ? "Other databases on the server appear in the explorer too." : null));
      var tlsSel = h("select", { class: "select", "aria-label": "TLS" }, (TLS_CHOICES[f.kind] || [["", "Off"]]).map(function (c) { return h("option", { value: c[0], text: c[1], selected: c[0] === f.tls }); }));
      tlsSel.addEventListener("change", function () { f.tls = tlsSel.value; syncFromForm(); });
      formBox.append(field("TLS / SSL", tlsSel, "span2", f.kind === "mongodb" && f.srv ? "mongodb+srv connections always use TLS." : null));
      formBox.append(field("Options", textInput("extra", { class: "input mono", placeholder: f.kind === "sqlserver" ? "ApplicationIntent=ReadOnly;MultiSubnetFailover=true" : f.kind === "mongodb" ? "authSource=admin&replicaSet=rs0" : f.kind === "postgres" ? "sslrootcert=/path/ca.pem&application_name=me" : "key=value&key2=value2", "aria-label": "Extra options" }), "span2",
        "Driver options, " + (f.kind === "sqlserver" ? "as key=value pairs separated by ;" : "as a query string") + ". Optional."));
    }

    var detectToken = 0;
    function detect() {
      var value = csInput.value;
      showMode();
      if (!value.trim()) {
        state.detected = null;
        clear(detectBox).append(icon("info"), h("div", { class: "muted", text: detectPrompt() }));
        detectBox.className = "detect";
        return;
      }
      var token = ++detectToken;
      call("detect", { connectionString: value, id: id || undefined }).then(function (res) {
        if (token !== detectToken) return;
        state.detected = res.ok ? res : null;
        clear(detectBox);
        if (!res.ok) {
          detectBox.className = "detect bad";
          detectBox.append(icon("error"), h("div", null, res.error.message, res.error.hint ? h("div", { class: "muted", text: res.error.hint }) : null));
          return;
        }
        detectBox.className = "detect ok";
        var s = res.summary;
        var facts = h("div", { class: "facts" });
        function fact(label, value) { if (value !== undefined && value !== null && value !== "") facts.append(h("span", null, label + " ", h("b", { text: String(value) }))); }
        if (s.file) fact("File", s.file);
        else {
          fact("Host", s.host + (s.port ? ":" + s.port : ""));
          fact(res.kind === "redis" ? "DB" : res.kind === "oracle" ? "Service" : "Database", s.database);
          fact("User", s.user);
          fact("Password", s.hasPassword ? "set" : "none");
          fact("TLS", s.ssl ? "on" : "off");
        }
        detectBox.append(icon("pass-filled"), h("div", { class: "grow" }, h("b", { text: res.label + (state.mode === "string" ? " detected" : "") }), facts, res.warnings.length ? h("ul", null, res.warnings.map(function (w) { return h("li", { text: w }); })) : null));
        nameInput.placeholder = suggestName(res);
        showMode();
      }).catch(function () { /* detection is advisory */ });
    }
    var detectSoon = debounce(detect, 250);
    csInput.addEventListener("input", function () { testResult.className = "test-result"; clear(testResult); csInput.classList.remove("invalid"); detectSoon(); });

    var testBtn = btn("Test connection", "plug", test);
    var saveBtn = btn("Save", null, function () { save(false); });
    var saveConnectBtn = btn("Save & connect", "plug", function () { save(true); }, "primary");

    function test() {
      clear(errorBox);
      if (!csInput.value.trim()) { errorBox.append(formError({ message: state.mode === "form" ? "Fill in the host first." : "Enter a connection string." })); return; }
      testBtn.disabled = true;
      testResult.className = "test-result";
      clear(testResult).append(icon("loading", "codicon-modifier-spin"), h("span", { text: "Testing…" }));
      call("testConnection", { id: id || undefined, connectionString: csInput.value }).then(function (res) {
        testBtn.disabled = false;
        testResult.className = "test-result ok";
        clear(testResult).append(icon("pass-filled"), h("div", null, "Connected • " + res.version + " • " + res.latencyMs + " ms", res.warnings && res.warnings.length ? h("span", { class: "hint", text: res.warnings.join(" ") }) : null));
      }).catch(function (err) {
        testBtn.disabled = false;
        testResult.className = "test-result bad";
        clear(testResult).append(icon("error"), h("div", null, err.message, err.hint ? h("span", { class: "hint", text: err.hint }) : null));
      });
    }

    function save(andConnect) {
      clear(errorBox);
      if (!csInput.value.trim()) {
        csInput.classList.add("invalid");
        errorBox.append(formError({ message: state.mode === "form" ? "Fill in the connection details first." : "Enter a connection string." }));
        return;
      }
      // An unnamed connection takes the name suggested from what was detected, never a stale example.
      var name = nameInput.value.trim() || (state.detected ? suggestName(state.detected) : "");
      if (!name) { nameInput.classList.add("invalid"); errorBox.append(formError({ message: "Give the connection a name." })); nameInput.focus(); return; }
      saveBtn.disabled = saveConnectBtn.disabled = true;
      call("saveConnection", { id: id || undefined, name: name, connectionString: csInput.value, readOnly: readOnlyCk.checked, color: state.color }).then(function (view) {
        close();
        toast("success", editing ? "Connection updated." : "Connection saved.");
        if (view) {
          var t = treeOf(view.id);
          if (editing) { t.dbs = null; }
          if (andConnect) expandConn(view, true);
        }
      }).catch(function (err) {
        saveBtn.disabled = saveConnectBtn.disabled = false;
        errorBox.append(formError(err));
      });
    }
    nameInput.addEventListener("input", function () { nameInput.classList.remove("invalid"); });

    var modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": editing ? "Edit connection" : "New connection" },
      h("div", { class: "mhead" }, icon("database"), h("h3", { text: editing ? "Edit connection" : "New connection" }), iconBtn("close", "Close", function () { close(); })),
      h("div", { class: "mbody" },
        seg,
        formBox,
        stringBox,
        detectBox,
        testResult,
        h("div", { class: "field" }, h("label", { text: "Name" }), nameInput),
        h("div", { class: "field" }, h("span", { class: "flabel", text: "Color" }), colors),
        h("label", { class: "check" }, readOnlyCk, h("span", null, "Read-only", h("small", { text: "Block inserts, updates, deletes and writing statements on this connection." }))),
        h("div", { class: "secure-note" }, icon("lock"), h("span", { text: "The connection string is stored in your operating system's keychain through VS Code SecretStorage. It is never written to settings, logs or error messages." })),
        errorBox),
      h("div", { class: "mfoot" }, testBtn, h("span", { class: "spacer" }), btn("Cancel", null, function () { close(); }, "ghost"), saveBtn, saveConnectBtn));
    var overlay = h("div", { class: "overlay", onmousedown: function (e) { if (e.target === overlay) close(); } }, modal);
    var close = openOverlay(overlay, function () { close(); });
    modal.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(true); } });

    function focusFirst() {
      setTimeout(function () {
        var first = state.mode === "form" ? formBox.querySelector("input:not([type=checkbox])") : csInput;
        if (first) first.focus();
      }, 30);
    }
    renderSeg();
    if (editing) {
      call("editConnection", { id: id }).then(function (data) {
        nameInput.value = data.name;
        csInput.value = data.connectionString;
        readOnlyCk.checked = !!data.readOnly;
        state.color = data.color || state.color;
        renderColors();
        return call("detect", { connectionString: data.connectionString, id: id });
      }).then(function (res) {
        if (res && res.ok) state.form = formFromDetect(res, csInput.value);
        else state.mode = "string";
        renderSeg(); renderForm(); showMode(); detect(); focusFirst();
      }).catch(function (err) { errorBox.append(formError(err)); });
    } else {
      renderForm();
      if (state.mode === "form") syncFromForm();
      else detect();
      showMode();
      focusFirst();
    }
  }

  function suggestName(res) {
    var s = res.summary;
    if (s.file) return s.file.split(/[\\/]/).pop();
    var host = String(s.host || "").split(",")[0];
    if (/^(localhost|127\.0\.0\.1)$/.test(host)) host = "local";
    return (host ? host : res.label) + (s.database ? "/" + s.database : "");
  }

  // ------------------------------------------------------------------ Boot
  call("init").then(function (data) {
    S.kinds = data.kinds || {};
    S.filterOps = data.filterOps || [];
    S.limits = data.limits || S.limits;
    S.connections = data.connections || [];
    // Restore tabs from the last session; their data loads when they are shown.
    (saved.tabs || []).forEach(function (t) {
      if (!conn(t.connId)) return;
      if (t.type === "query") S.tabs.push({ id: t.id, type: "query", connId: t.connId, database: t.database, schema: t.schema, text: t.text || "", title: t.title || "Query", editorH: t.editorH || 200 });
      else if (t.target && t.target.object) S.tabs.push({ id: t.id, type: "data", connId: t.connId, target: t.target, objectType: t.objectType, mode: t.mode || "data", page: 1, pageSize: t.pageSize || 50, sort: t.sort || null, filters: t.filters || [], search: t.search || "", query: t.query || "", keyType: t.keyType || "", colWidths: t.colWidths || {}, needsLoad: true, selected: new Set() });
    });
    S.active = S.tabs.some(function (t) { return t.id === saved.active; }) ? saved.active : (S.tabs[0] ? S.tabs[0].id : null);
    S.ready = true;
    layout();
  }).catch(function (err) {
    clear(root).append(h("div", { class: "boot" }, icon("error"), "The Database Client could not start: " + err.message));
  });
})();
