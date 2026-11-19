/*
 * Code Diff Checker page. The engine (media/code-diff-engine.js) compares in a
 * Web Worker built from its own source; this file owns the inputs, the
 * virtualised diff viewer (split and unified), navigation and actions.
 * Everything that touches VS Code (files, clipboard, saving) goes to the host.
 */
(function () {
  "use strict";
  var vscode = acquireVsCodeApi();
  var E = window.CodeDiffEngine;
  var BOOT = window.__CODE_DIFF__ || {};
  var $ = function (id) { return document.getElementById(id); };
  var MAX_STATE_CHARS = 3000000;
  var BLOCK = 40;
  var OVERSCAN = 600;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  var saved = vscode.getState() || {};
  var S = {
    prefs: Object.assign({}, BOOT.prefs || {}, saved.prefs || {}),
    sides: {
      left: { name: "", language: "" },
      right: { name: "", language: "" }
    },
    model: null,          // last result from the engine
    snap: null,           // { left, right, language } the model was computed from
    display: null,        // rows currently shown
    expanded: new Set(),  // folds opened by the user, keyed by left line index
    current: -1,          // current change (navigation)
    reqId: 0,
    busy: false,
    narrow: false,
    error: "",
    json: null,
    workerNote: ""
  };

  var els = {
    app: $("app"), inputs: $("inputs"), collapsed: $("inputsCollapsed"), collapsedNames: $("collapsedNames"),
    viewer: $("viewer"), canvas: $("canvas"), hbar: $("hbar"), hbarInner: $("hbarInner"), wrap: $("viewerWrap"),
    empty: $("empty"), progress: $("progress"), summary: $("summary"), notices: $("notices"), navPos: $("navPos"),
    prev: $("prevBtn"), next: $("nextBtn"), jsonView: $("jsonView"), toast: $("toast"), langSel: $("langSel")
  };
  var text = { left: $("leftText"), right: $("rightText") };
  var names = { left: $("leftName"), right: $("rightName") };

  // ---------------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------------

  var worker = null, workerUrl = "", workerBusy = false;

  function startWorker() {
    try {
      var src = "var E=(" + E.factorySource + ")();\n" +
        "self.onmessage=function(e){var d=e.data;try{var r=E.compute(d.left,d.right,d.options);" +
        "var t=[r.kind.buffer,r.ai.buffer,r.bi.buffer,r.pair.buffer,r.changes.buffer,r.left.starts.buffer,r.left.ends.buffer,r.right.starts.buffer,r.right.ends.buffer];" +
        "if(r.leftTokens)t.push(r.leftTokens.buffer);if(r.rightTokens&&r.rightTokens.buffer!==(r.leftTokens&&r.leftTokens.buffer))t.push(r.rightTokens.buffer);" +
        "self.postMessage({id:d.id,result:r},t);}catch(err){self.postMessage({id:d.id,error:String(err&&err.message||err)});}};";
      workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = function (e) { workerBusy = false; onResult(e.data); };
      worker.onerror = function (e) {
        // A worker that cannot start (blocked by policy) falls back to this thread.
        if (e && e.preventDefault) e.preventDefault();
        stopWorker();
        worker = null;
        S.workerNote = "Comparing on the page thread; very large inputs may pause the panel briefly.";
        if (workerBusy) { workerBusy = false; compareNow(); }
      };
    } catch (err) {
      worker = null;
      S.workerNote = "Comparing on the page thread; very large inputs may pause the panel briefly.";
    }
  }
  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } }
    if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = ""; }
  }

  // ---------------------------------------------------------------------------
  // Comparing
  // ---------------------------------------------------------------------------

  var timer = 0;
  function scheduleCompare(delay) {
    clearTimeout(timer);
    var size = text.left.value.length + text.right.value.length;
    timer = setTimeout(compareNow, delay != null ? delay : size > 400000 ? 700 : size > 50000 ? 300 : 150);
  }

  function resolvedLanguage() {
    var choice = els.langSel.value || "auto";
    if (choice !== "auto") return choice;
    return detected();
  }
  function detected() {
    var l = S.sides.left, r = S.sides.right;
    var fromEditor = mapEditorLanguage(r.language) || mapEditorLanguage(l.language);
    if (fromEditor) return fromEditor;
    var byName = E.detectLanguage(names.right.value || names.left.value, "");
    if (byName !== "plaintext") return byName;
    return E.detectLanguage("", text.left.value || text.right.value);
  }
  var EDITOR_LANGS = { javascriptreact: "jsx", typescriptreact: "jsx", shellscript: "shell", c: "cpp", "objective-c": "cpp", jsonc: "json", jsonl: "json", dotenv: "toml", ini: "toml", properties: "toml", scss: "css", less: "css", vue: "html", svelte: "html", hcl: "terraform", groovy: "java", plaintext: "plaintext" };
  function mapEditorLanguage(id) {
    if (!id) return "";
    if (EDITOR_LANGS[id]) return EDITOR_LANGS[id];
    return E.LANGUAGES.some(function (l) { return l[0] === id; }) ? id : "";
  }

  function compareNow() {
    clearTimeout(timer);
    persist();
    if (S.prefs.mode === "json") { compareJson(); return; }
    var left = text.left.value, right = text.right.value;
    var language = S.prefs.syntax ? resolvedLanguage() : "";
    updateLangLabel();
    if (!left && !right) {
      S.model = null; S.snap = null; S.display = null; S.error = "";
      setBusy(false);
      render(true);
      return;
    }
    var id = ++S.reqId;
    var options = { ignoreWhitespace: !!S.prefs.ignoreWhitespace, ignoreCase: !!S.prefs.ignoreCase, language: language === "plaintext" ? "" : language, timeoutMs: 6000 };
    S.pending = { id: id, left: left, right: right, language: options.language };
    setBusy(true);
    if (!worker && !S.workerNote) startWorker();
    if (worker) {
      // A newer request replaces one still running: restart rather than queue.
      if (workerBusy) { stopWorker(); startWorker(); }
      workerBusy = true;
      worker.postMessage({ id: id, left: left, right: right, options: options });
    } else {
      setTimeout(function () {
        if (id !== S.reqId) return;
        try { onResult({ id: id, result: E.compute(left, right, options) }); }
        catch (err) { onResult({ id: id, error: String(err && err.message || err) }); }
      }, 16);
    }
  }

  var lastTracked = "";
  function onResult(msg) {
    if (!S.pending || msg.id !== S.pending.id) return;
    var p = S.pending;
    S.pending = null;
    setBusy(false);
    if (msg.error) {
      S.error = "The comparison failed: " + msg.error;
      S.model = null;
      render(true);
      return;
    }
    S.error = "";
    var keepPosition = S.snap && S.snap.left === p.left && S.snap.right === p.right;
    S.model = msg.result;
    S.snap = { left: p.left, right: p.right, language: p.language };
    S.inline = new Map();
    if (!keepPosition) { S.expanded = new Set(); S.current = -1; }
    render(!keepPosition);
    var key = p.left.length + ":" + p.right.length;
    if (p.left && p.right && key !== lastTracked) { lastTracked = key; vscode.postMessage({ type: "compared" }); }
  }

  var busyTimer = 0;
  function setBusy(on) {
    S.busy = on;
    clearTimeout(busyTimer);
    // Only show the indicator for slow comparisons, so typing does not flicker.
    if (on) busyTimer = setTimeout(function () { els.progress.hidden = false; renderSummary(); }, 180);
    else { els.progress.hidden = true; }
  }

  // ---------------------------------------------------------------------------
  // Display rows (split / unified, with folds)
  // ---------------------------------------------------------------------------

  function viewMode() { return S.narrow ? "unified" : S.prefs.view; }

  /**
   * Builds the rows to show: in split view deleted and inserted lines of a
   * change sit side by side (edits of each other on the same row); unchanged
   * stretches away from changes fold into a single expandable row.
   */
  function buildDisplay() {
    var m = S.model;
    if (!m) return null;
    var split = viewMode() === "split";
    var A = [], B = [], C = [];
    var chg = new Int32Array(m.rows).fill(-1), c, r;
    for (c = 0; c < m.changes.length / 2; c++) for (r = m.changes[2 * c]; r < m.changes[2 * c + 1]; r++) chg[r] = c;
    if (!split) {
      for (r = 0; r < m.rows; r++) { A.push(r); B.push(r); C.push(chg[r]); }
    } else {
      r = 0;
      for (c = 0; c <= m.changes.length / 2; c++) {
        var cs = c < m.changes.length / 2 ? m.changes[2 * c] : m.rows;
        for (; r < cs; r++) { A.push(r); B.push(r); C.push(-1); }
        if (c === m.changes.length / 2) break;
        var ce = m.changes[2 * c + 1];
        var insStart = cs;
        while (insStart < ce && m.kind[insStart] === E.KIND_DELETE) insStart++;
        var i = cs, j = insStart;
        while (i < insStart || j < ce) {
          var pd = i;
          while (pd < insStart && m.pair[pd] < 0) pd++;
          var pa = pd < insStart ? m.pair[pd] : ce;
          var n1 = pd - i, n2 = pa - j, n = Math.max(n1, n2);
          for (var k = 0; k < n; k++) { A.push(k < n1 ? i + k : -1); B.push(k < n2 ? j + k : -1); C.push(c); }
          i = pd; j = pa;
          if (pd < insStart) { A.push(pd); B.push(pa); C.push(c); i = pd + 1; j = pa + 1; }
        }
        r = ce;
      }
    }

    // Folds over long unchanged stretches.
    var rows = { type: [], a: [], b: [], c: [] }, folds = [];
    var ctx = S.prefs.collapse ? Number(S.prefs.context) || 0 : -1;
    var total = A.length, idx = 0;
    while (idx < total) {
      if (C[idx] >= 0 || ctx < 0) { pushRow(idx); idx++; continue; }
      var end = idx;
      while (end < total && C[end] < 0) end++;
      var head = idx === 0 ? 0 : ctx, tail = end === total ? 0 : ctx;
      var hidden = (end - idx) - head - tail;
      var key = m.ai[A[idx + head]];
      if (hidden >= 4 && !S.expanded.has(key)) {
        for (var h = idx; h < idx + head; h++) pushRow(h);
        var fs = idx + head, fe = end - tail;
        folds.push({ key: key, count: fe - fs, a: m.ai[A[fs]], b: m.bi[B[fs]], aEnd: m.ai[A[fe - 1]], bEnd: m.bi[B[fe - 1]], atEnd: end === total, atStart: idx === 0 });
        rows.type.push(1); rows.a.push(folds.length - 1); rows.b.push(-1); rows.c.push(-1);
        for (h = fe; h < end; h++) pushRow(h);
      } else {
        for (h = idx; h < end; h++) pushRow(h);
      }
      idx = end;
    }
    function pushRow(x) { rows.type.push(0); rows.a.push(A[x]); rows.b.push(B[x]); rows.c.push(C[x]); }

    var changeRows = [];
    for (r = 0; r < rows.c.length; r++) if (rows.c[r] >= 0 && (r === 0 || rows.c[r - 1] !== rows.c[r])) changeRows.push(r);
    return { split: split, count: rows.type.length, type: rows.type, a: rows.a, b: rows.b, c: rows.c, folds: folds, changeRows: changeRows };
  }

  // ---------------------------------------------------------------------------
  // Virtualised viewer
  // ---------------------------------------------------------------------------

  var V = { rowH: 20, foldH: 30, charW: 7.5, heights: null, offsets: null, measured: null, blocks: new Map(), maxCols: 0, top: null, bottom: null, cols: 0 };

  function measureFont() {
    var probe = document.createElement("div");
    probe.className = "u";
    probe.style.position = "absolute"; probe.style.visibility = "hidden"; probe.style.left = "-9999px"; probe.style.width = "2000px";
    probe.style.setProperty("--lnw", "40px");
    probe.innerHTML = '<div class="r"><span class="ln">1</span><span class="ln">1</span><span class="mk"> </span><span class="cd"><span class="t" id="probeT">' + "0".repeat(100) + "</span></span></div>";
    document.body.appendChild(probe);
    var row = probe.firstChild;
    V.rowH = row.getBoundingClientRect().height || parseFloat(getComputedStyle(row).lineHeight) || 20;
    V.charW = (document.getElementById("probeT").getBoundingClientRect().width / 100) || 7.5;
    document.body.removeChild(probe);
    V.foldH = Math.round(V.rowH + 10);
    els.viewer.style.setProperty("--fh", V.foldH + "px");
  }

  function lineLen(side, idx) {
    var s = side === "a" ? S.model.left : S.model.right;
    return s.ends[idx] - s.starts[idx];
  }

  function rowEstimate(d, r) {
    if (d.type[r] === 1) return V.foldH;
    if (!S.prefs.wrap || !V.cols) return V.rowH;
    var m = S.model, len = 0;
    if (d.a[r] >= 0 && m.ai[d.a[r]] >= 0) len = lineLen("a", m.ai[d.a[r]]);
    if (d.b[r] >= 0 && m.bi[d.b[r]] >= 0) len = Math.max(len, lineLen("b", m.bi[d.b[r]]));
    return V.rowH * Math.max(1, Math.ceil(len / V.cols));
  }

  function layout() {
    var d = S.display;
    var nb = Math.ceil(d.count / BLOCK);
    V.heights = new Float64Array(nb);
    V.measured = new Uint8Array(nb);
    for (var b = 0; b < nb; b++) {
      var h = 0;
      for (var r = b * BLOCK, e = Math.min(d.count, r + BLOCK); r < e; r++) h += rowEstimate(d, r);
      V.heights[b] = h;
    }
    recomputeOffsets();
  }
  function recomputeOffsets() {
    var nb = V.heights.length;
    V.offsets = new Float64Array(nb + 1);
    for (var b = 0; b < nb; b++) V.offsets[b + 1] = V.offsets[b] + V.heights[b];
  }
  function blockAt(y) {
    var lo = 0, hi = V.heights.length - 1;
    if (hi < 0) return 0;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (V.offsets[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }

  /** Re-creates the viewer from scratch (new model, view or options). */
  function resetViewer(scrollTop) {
    V.blocks.forEach(function (el) { el.remove(); });
    V.blocks.clear();
    els.canvas.textContent = "";
    var d = S.display;
    if (!d || !d.count) { els.canvas.style.height = "0px"; return; }
    els.canvas.className = "canvas " + (d.split ? "s" : "u") + (S.prefs.wrap ? " wrap" : "");
    els.viewer.className = "viewer" + (d.split ? " s" : " u") + (S.prefs.wrap ? " wrap" : "");
    var m = S.model;
    var maxLine = Math.max(m.left.count, m.right.count, 1);
    var lnw = Math.max(3, String(maxLine).length) * V.charW + 16;
    els.viewer.style.setProperty("--lnw", Math.ceil(lnw) + "px");
    els.viewer.style.setProperty("--tab", String(S.prefs.tabSize || 4));
    // Columns that fit one code cell, for wrapped height estimates.
    var width = els.viewer.clientWidth - (d.split ? 2 * (lnw + 20) : 2 * lnw + 20) - 16;
    if (d.split) width = width / 2;
    V.cols = Math.max(10, Math.floor(width / V.charW));
    V.checked = false;
    V.top = document.createElement("div");
    V.bottom = document.createElement("div");
    els.canvas.appendChild(V.top);
    els.canvas.appendChild(V.bottom);
    layout();
    updateHScroll();
    els.viewer.scrollTop = scrollTop || 0;
    paint();
  }

  var paintQueued = false;
  function queuePaint() {
    if (paintQueued) return;
    paintQueued = true;
    (window.requestAnimationFrame || setTimeout)(function () { paintQueued = false; paint(); });
  }

  /** Renders the blocks around the viewport and drops the rest. */
  function paint() {
    var d = S.display;
    if (!d || !d.count || !V.offsets) return;
    var st = els.viewer.scrollTop, vh = els.viewer.clientHeight || 600;
    var first = blockAt(Math.max(0, st - OVERSCAN)), last = blockAt(st + vh + OVERSCAN);
    V.blocks.forEach(function (el, b) { if (b < first || b > last) { el.remove(); V.blocks.delete(b); } });
    var anchorShift = 0, after = V.bottom;
    for (var b = last; b >= first; b--) {
      var el = V.blocks.get(b);
      if (!el) {
        el = document.createElement("div");
        el.className = "blk";
        el.innerHTML = blockHtml(d, b);
        V.blocks.set(b, el);
      }
      if (el.nextSibling !== after) els.canvas.insertBefore(el, after);
      after = el;
    }
    // Unwrapped rows have a fixed height: if the first rendered block disagrees
    // (fonts or zoom changed), recalibrate and lay out again.
    if (!S.prefs.wrap && !V.checked) {
      V.checked = true;
      var probeBlock = V.blocks.get(first), rowsIn = Math.min(BLOCK, d.count - first * BLOCK);
      var plain = 0;
      for (var x = first * BLOCK; x < first * BLOCK + rowsIn; x++) if (d.type[x] === 0) plain++;
      var real = probeBlock ? probeBlock.offsetHeight : 0;
      if (plain && real && Math.abs(real - V.heights[first]) > 1) {
        V.rowH = (real - (rowsIn - plain) * V.foldH) / plain;
        layout();
        return paint();
      }
    }
    // Wrapped rows: measure what was rendered, keeping the visible content in place.
    if (S.prefs.wrap) {
      var changed = false;
      for (b = first; b <= last; b++) {
        if (V.measured[b]) continue;
        var h = V.blocks.get(b).offsetHeight;
        V.measured[b] = 1;
        if (Math.abs(h - V.heights[b]) > 0.5) {
          if (V.offsets[b] + V.heights[b] <= st) anchorShift += h - V.heights[b];
          V.heights[b] = h; changed = true;
        }
      }
      if (changed) recomputeOffsets();
    }
    V.top.style.height = V.offsets[first] + "px";
    V.bottom.style.height = Math.max(0, V.offsets[V.offsets.length - 1] - V.offsets[last + 1]) + "px";
    if (anchorShift) els.viewer.scrollTop = st + anchorShift;
  }

  function blockHtml(d, b) {
    var html = "", start = b * BLOCK, end = Math.min(d.count, start + BLOCK);
    for (var r = start; r < end; r++) html += d.type[r] === 1 ? foldHtml(d, r) : (d.split ? splitRowHtml(d, r) : unifiedRowHtml(d, r));
    return html;
  }

  function foldHtml(d, r) {
    var f = d.folds[d.a[r]];
    var label = "Show " + f.count.toLocaleString() + " unchanged line" + (f.count === 1 ? "" : "s");
    var where = f.atStart ? "above" : f.atEnd ? "below" : "";
    var hunk = f.a === f.b ? "Lines " + (f.a + 1) + "–" + (f.aEnd + 1) : "Original " + (f.a + 1) + "–" + (f.aEnd + 1) + " · Modified " + (f.b + 1) + "–" + (f.bEnd + 1);
    return '<div class="r fold" data-row="' + r + '"><button type="button" data-fold="' + f.key + '" aria-label="' + label + (where ? " " + where : "") + '">' +
      '<span class="codicon codicon-unfold" aria-hidden="true"></span><span>' + label + "</span>" +
      '<span class="hunk" aria-hidden="true">' + hunk + "</span></button></div>";
  }

  function kindClass(k) { return k === E.KIND_DELETE ? "del" : k === E.KIND_INSERT ? "add" : "ctx"; }

  /** HTML for one side of a model row: [lineNumber, marker, code, class]. */
  function cell(mr, side) {
    var m = S.model;
    if (mr < 0) return null;
    var k = m.kind[mr];
    var idx = side === "a" ? m.ai[mr] : m.bi[mr];
    if (idx < 0) return null;
    var s = side === "a" ? m.left : m.right;
    var src = side === "a" ? S.snap.left : S.snap.right;
    var tokens = S.prefs.syntax ? (side === "a" ? m.leftTokens : m.rightTokens) : null;
    var ranges = null;
    if (k !== E.KIND_EQUAL && m.pair[mr] >= 0) {
      var inl = inlineFor(mr);
      if (inl) ranges = k === E.KIND_DELETE ? inl.a : inl.b;
    }
    var code = E.lineHtml(src, s.starts[idx], s.ends[idx], tokens || null, ranges);
    if (idx === s.count - 1 && !s.finalNewline && k !== E.KIND_EQUAL) code += '<span class="noeol codicon codicon-circle-slash" title="No newline at end of file" aria-label="No newline at end of file"></span>';
    return { n: idx + 1, mk: k === E.KIND_DELETE ? "−" : k === E.KIND_INSERT ? "+" : " ", code: code, cls: kindClass(k) };
  }

  function inlineFor(mr) {
    var m = S.model, del = m.kind[mr] === E.KIND_DELETE ? mr : m.pair[mr], ins = m.pair[del];
    if (S.inline.has(del)) return S.inline.get(del);
    var a = S.snap.left.slice(m.left.starts[m.ai[del]], m.left.ends[m.ai[del]]);
    var b = S.snap.right.slice(m.right.starts[m.bi[ins]], m.right.ends[m.bi[ins]]);
    var res = E.inlineDiff(a, b, { ignoreWhitespace: S.prefs.ignoreWhitespace, ignoreCase: S.prefs.ignoreCase });
    S.inline.set(del, res);
    return res;
  }

  function curClass(d, r) { return d.c[r] >= 0 && d.c[r] === S.current ? " cur" : ""; }

  function splitRowHtml(d, r) {
    var L = cell(d.a[r], "a"), R = cell(d.b[r], "b");
    // An unchanged row shows the same model row on both sides.
    return '<div class="r' + curClass(d, r) + '" data-row="' + r + '">' + half(L, "side-l") + half(R, "side-r") + "</div>";
  }
  function half(x, side) {
    if (!x) return '<span class="ln emp ' + side + '"></span><span class="mk emp ' + side + '"></span><span class="cd emp ' + side + '"></span>';
    return '<span class="ln ' + x.cls + " " + side + '">' + x.n + '</span><span class="mk ' + x.cls + " " + side + '">' + x.mk +
      '</span><span class="cd ' + x.cls + " " + side + '"><span class="t">' + x.code + "</span></span>";
  }
  function unifiedRowHtml(d, r) {
    var m = S.model, mr = d.a[r], k = m.kind[mr];
    var x = cell(mr, k === E.KIND_INSERT ? "b" : "a");
    var an = m.ai[mr] >= 0 ? m.ai[mr] + 1 : "", bn = m.bi[mr] >= 0 ? m.bi[mr] + 1 : "";
    return '<div class="r' + curClass(d, r) + '" data-row="' + r + '"><span class="ln ' + x.cls + '">' + an + '</span><span class="ln ' + x.cls + '">' + bn +
      '</span><span class="mk ' + x.cls + '">' + x.mk + '</span><span class="cd ' + x.cls + '"><span class="t">' + x.code + "</span></span></div>";
  }

  // Horizontal scrolling without wrap: one shared offset keeps both sides aligned.
  function updateHScroll() {
    if (!S.model || S.prefs.wrap || !S.display) { els.viewer.style.setProperty("--hbar-h", "0px"); els.wrap.style.setProperty("--hbar-h", "0px"); els.viewer.style.setProperty("--sx", "0"); return; }
    var m = S.model, tab = Number(S.prefs.tabSize) || 4;
    var maxCols = 0;
    [[S.snap.left, m.left], [S.snap.right, m.right]].forEach(function (pair) {
      var src = pair[0], s = pair[1];
      for (var i = 0; i < s.count; i++) {
        var len = s.ends[i] - s.starts[i];
        if (len + (tab - 1) * 8 < maxCols) continue;
        var tabs = 0, at = s.starts[i];
        while ((at = src.indexOf("\t", at)) !== -1 && at < s.ends[i]) { tabs++; at++; }
        maxCols = Math.max(maxCols, Math.min(len, 20000) + tabs * (tab - 1));
      }
    });
    var lnw = parseFloat(els.viewer.style.getPropertyValue("--lnw")) || 40;
    var codeW = S.display.split ? (els.viewer.clientWidth - 2 * (lnw + 20)) / 2 : els.viewer.clientWidth - 2 * lnw - 20;
    var range = Math.max(0, Math.ceil(maxCols * V.charW + 40 - codeW));
    var h = range > 0 ? 12 : 0;
    els.wrap.style.setProperty("--hbar-h", h + "px");
    els.viewer.style.setProperty("--hbar-h", h + "px");
    els.hbarInner.style.width = (els.hbar.clientWidth + range) + "px";
    if (els.hbar.scrollLeft > range) els.hbar.scrollLeft = range;
    els.viewer.style.setProperty("--sx", String(els.hbar.scrollLeft));
  }

  // ---------------------------------------------------------------------------
  // Rendering the whole results area
  // ---------------------------------------------------------------------------

  function render(resetScroll) {
    els.app.dataset.mode = S.prefs.mode;
    syncControls();
    if (S.prefs.mode === "json") { renderJson(); return; }
    els.jsonView.hidden = true;
    var hasInput = !!(text.left.value || text.right.value);
    S.display = S.model ? buildDisplay() : null;
    if (S.display && S.current >= S.display.changeRows.length) S.current = -1;
    renderSummary();
    renderNotices();
    if (S.error) { showEmpty("error"); resetViewer(0); return; }
    if (!hasInput) { showEmpty("start"); resetViewer(0); return; }
    if (!S.model) { showEmpty(""); return; }
    showEmpty("");
    resetViewer(resetScroll ? 0 : els.viewer.scrollTop);
    updateNav();
  }

  function showEmpty(kind) {
    var e = els.empty;
    els.viewer.hidden = kind === "start" || kind === "error" || S.prefs.mode === "json";
    els.hbar.hidden = els.viewer.hidden;
    if (!kind) { e.hidden = true; e.textContent = ""; return; }
    e.hidden = false;
    e.className = "empty " + kind;
    if (kind === "start") {
      e.innerHTML = '<div class="card"><span class="codicon codicon-diff big-icon" aria-hidden="true"></span><h2>Compare two versions</h2>' +
        "<p>Paste code into both sides, open files, or drop them onto the editors. Differences appear here as you type.</p>" +
        '<div class="row"><button type="button" class="btn primary sm" data-act="upload" data-side="left"><span class="codicon codicon-folder-opened" aria-hidden="true"></span> Open original…</button>' +
        '<button type="button" class="btn ghost sm" data-act="upload" data-side="right"><span class="codicon codicon-folder-opened" aria-hidden="true"></span> Open modified…</button>' +
        '<button type="button" class="btn ghost sm" id="tryExample"><span class="codicon codicon-sparkle" aria-hidden="true"></span> Try an example</button></div></div>';
    } else if (kind === "error") {
      e.innerHTML = '<div class="card"><span class="codicon codicon-error big-icon" aria-hidden="true"></span><h2>Something went wrong</h2><p></p>' +
        '<div class="row"><button type="button" class="btn ghost sm" id="retryBtn"><span class="codicon codicon-refresh" aria-hidden="true"></span> Try again</button></div></div>';
      e.querySelector("p").textContent = S.error;
    }
  }

  function renderSummary() {
    var el = els.summary;
    if (S.prefs.mode === "json") return renderJsonSummary();
    if (S.busy && !els.progress.hidden) { el.innerHTML = '<span class="busy"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span> Comparing…</span>'; return; }
    var m = S.model;
    if (!m || !(text.left.value || text.right.value)) { el.innerHTML = '<span>No comparison yet</span>'; return; }
    var st = m.stats;
    if (m.identical) {
      el.innerHTML = '<span class="ok"><span class="codicon codicon-pass-filled" aria-hidden="true"></span> No differences</span><span class="badge"><span class="dot same"></span>' + fmt(st.unchanged) + " lines</span>";
      return;
    }
    var total = st.additions + st.deletions, boxes = "";
    var adds = total ? Math.round(5 * st.additions / total) : 0;
    if (st.additions && !adds) adds = 1;
    if (st.deletions && adds === 5) adds = 4;
    for (var i = 0; i < 5; i++) boxes += '<i class="' + (i < adds ? "a" : i < (total ? 5 : 0) ? "d" : "") + '"></i>';
    el.innerHTML =
      '<span class="big plus" title="Lines added or changed in the modified version">+' + fmt(st.additions) + '</span>' +
      '<span class="big minus" title="Lines removed or changed from the original">−' + fmt(st.deletions) + '</span>' +
      '<span class="diffstat" aria-hidden="true">' + boxes + "</span>" +
      '<span class="badge" title="Groups of consecutive changed lines">' + fmt(st.changes) + " change" + (st.changes === 1 ? "" : "s") + "</span>" +
      '<span class="badge"><span class="dot mod"></span>' + fmt(st.modified) + " modified</span>" +
      '<span class="badge"><span class="dot add"></span>' + fmt(st.added) + " added</span>" +
      '<span class="badge"><span class="dot del"></span>' + fmt(st.removed) + " removed</span>" +
      '<span class="badge"><span class="dot same"></span>' + fmt(st.unchanged) + " unchanged</span>";
  }

  function renderNotices() {
    var list = [];
    var m = S.model;
    if (S.workerNote) list.push(["info", S.workerNote]);
    if (m && S.snap) {
      if (m.approximate) list.push(["warning", "These versions are very different, so the comparison was simplified to finish quickly. Every difference is shown, but some may be grouped more coarsely than necessary."]);
      var le = S.sides.left.eol, re = S.sides.right.eol;
      var eolDiffers = le !== re && le && re && le !== "none" && re !== "none";
      if (eolDiffers) list.push(["info", "Line endings differ (original " + le + ", modified " + re + "). They are not shown as changes, and the patch uses LF."]);
      if (m.identical && (!m.exact || eolDiffers)) {
        var ignored = [];
        if (S.prefs.ignoreWhitespace) ignored.push("whitespace");
        if (S.prefs.ignoreCase) ignored.push("case");
        list.push(["success", ignored.length ? "The versions match when " + ignored.join(" and ") + " differences are ignored." : "The versions match apart from their line endings."]);
      } else if (m.identical && S.snap.left) list.push(["success", "Both versions are identical."]);
      if (!S.snap.left && S.snap.right) list.push(["info", "The original is empty, so every line shows as added."]);
      if (S.snap.left && !S.snap.right) list.push(["info", "The modified version is empty, so every line shows as removed."]);
      if (S.prefs.syntax && S.snap.language && !m.leftTokens && !m.rightTokens && (S.snap.left.length + S.snap.right.length) > 6000000) list.push(["info", "Syntax highlighting is off for inputs this large."]);
    }
    var icons = { info: "info", success: "pass", warning: "warning", error: "error" };
    els.notices.textContent = "";
    list.forEach(function (n) {
      var div = document.createElement("div");
      div.className = "notice " + n[0];
      div.setAttribute("role", n[0] === "error" || n[0] === "warning" ? "alert" : "status");
      var icon = document.createElement("span");
      icon.className = "codicon codicon-" + icons[n[0]];
      icon.setAttribute("aria-hidden", "true");
      var span = document.createElement("span");
      span.textContent = n[1];
      div.append(icon, span);
      els.notices.appendChild(div);
    });
  }

  function fmt(n) { return Number(n).toLocaleString(); }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function updateNav() {
    var d = S.display, n = d ? d.changeRows.length : 0;
    els.prev.disabled = els.next.disabled = n === 0;
    els.navPos.textContent = n === 0 ? "No changes" : S.current < 0 ? n + " change" + (n === 1 ? "" : "s") : (S.current + 1) + " of " + n;
  }

  function topRow() {
    var d = S.display, st = els.viewer.scrollTop;
    var b = blockAt(st), y = V.offsets[b];
    for (var r = b * BLOCK; r < Math.min(d.count, (b + 1) * BLOCK); r++) {
      var h = rowEstimate(d, r);
      if (y + h > st + 1) return r;
      y += h;
    }
    return b * BLOCK;
  }

  function go(delta) {
    var d = S.display;
    if (S.prefs.mode !== "code" || !d || !d.changeRows.length) return;
    var n = d.changeRows.length, target;
    if (S.current < 0) {
      // Start from what is on screen.
      var top = topRow();
      target = delta > 0 ? 0 : n - 1;
      for (var i = 0; i < n; i++) if (d.changeRows[i] > top + 1) { target = delta > 0 ? i : Math.max(0, i - 1); break; }
    } else target = (S.current + delta + n) % n;
    var wrapped = S.current >= 0 && ((delta > 0 && target < S.current) || (delta < 0 && target > S.current));
    setCurrent(target);
    scrollToRow(d.changeRows[target]);
    announce("Change " + (target + 1) + " of " + n + (wrapped ? (delta > 0 ? ", back at the first change" : ", jumped to the last change") : "") + ". " + describeChange(target));
  }

  function describeChange(c) {
    var m = S.model, s = m.changes[2 * c], e = m.changes[2 * c + 1], del = 0, ins = 0, firstA = -1, firstB = -1;
    for (var r = s; r < e; r++) {
      if (m.kind[r] === E.KIND_DELETE) { del++; if (firstA < 0) firstA = m.ai[r]; }
      else { ins++; if (firstB < 0) firstB = m.bi[r]; }
    }
    var parts = [];
    if (del) parts.push(del + " removed from line " + (firstA + 1));
    if (ins) parts.push(ins + " added at line " + (firstB + 1));
    return parts.join(", ");
  }

  function setCurrent(c) {
    S.current = c;
    V.blocks.forEach(function (el) {
      el.querySelectorAll(".r.cur").forEach(function (x) { x.classList.remove("cur"); });
    });
    var d = S.display;
    if (c >= 0) els.canvas.querySelectorAll(".r[data-row]").forEach(function (x) {
      var r = Number(x.getAttribute("data-row"));
      if (d.c[r] === c) x.classList.add("cur");
    });
    updateNav();
  }

  function rowOffset(r) {
    var d = S.display, b = Math.floor(r / BLOCK), y = V.offsets[b];
    for (var x = b * BLOCK; x < r; x++) y += rowEstimate(d, x);
    return y;
  }

  function scrollToRow(r) {
    if (els.viewer.getBoundingClientRect().bottom > window.innerHeight || els.viewer.getBoundingClientRect().top < 0) els.viewer.scrollIntoView({ block: "nearest" });
    var vh = els.viewer.clientHeight;
    els.viewer.scrollTop = Math.max(0, rowOffset(r) - vh * 0.25);
    paint();
    // Wrapped rows are measured as they render; settle on the real position.
    var el = els.canvas.querySelector('.r[data-row="' + r + '"]');
    if (el) {
      var delta = el.getBoundingClientRect().top - els.viewer.getBoundingClientRect().top - vh * 0.25;
      if (Math.abs(delta) > 2) { els.viewer.scrollTop += delta; paint(); }
    }
  }

  function announce(message) {
    var live = $("live");
    live.textContent = "";
    // A fresh text node, so repeating the same message is announced again.
    setTimeout(function () { live.textContent = message; }, 30);
  }

  // ---------------------------------------------------------------------------
  // JSON structure mode
  // ---------------------------------------------------------------------------

  var jsonReq = 0;
  function compareJson() {
    var left = text.left.value, right = text.right.value;
    els.viewer.hidden = true; els.hbar.hidden = true;
    els.wrap.style.setProperty("--hbar-h", "0px");
    if (!left.trim() && !right.trim()) { S.json = null; render(true); return; }
    jsonReq++;
    setBusy(true);
    vscode.postMessage({ type: "jsonDiff", requestId: jsonReq, left: left, right: right, ignoreArrayOrder: !!S.prefs.ignoreArrayOrder, arrayKey: S.prefs.arrayKey || "" });
  }

  function renderJsonSummary() {
    var el = els.summary, j = S.json;
    if (S.busy && !els.progress.hidden) { el.innerHTML = '<span class="busy"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span> Comparing…</span>'; return; }
    if (!j || j.error) { el.innerHTML = "<span>" + (j && j.error ? "Could not compare" : "No comparison yet") + "</span>"; return; }
    var c = j.counts, n = c.added + c.removed + c.changed + c.type;
    if (!n) { el.innerHTML = '<span class="ok"><span class="codicon codicon-pass-filled" aria-hidden="true"></span> The documents are equivalent</span>'; return; }
    el.innerHTML = '<span class="badge">' + fmt(n) + " difference" + (n === 1 ? "" : "s") + "</span>" +
      '<span class="badge"><span class="dot mod"></span>' + fmt(c.changed) + " changed</span>" +
      '<span class="badge"><span class="dot add"></span>' + fmt(c.added) + " added</span>" +
      '<span class="badge"><span class="dot del"></span>' + fmt(c.removed) + " removed</span>" +
      (c.type ? '<span class="badge" title="A value changed type, for example from number to string"><span class="dot mod"></span>' + fmt(c.type) + " type changes</span>" : "");
  }

  function renderJson() {
    els.viewer.hidden = true; els.hbar.hidden = true;
    renderSummary();
    els.notices.textContent = "";
    var j = S.json;
    var hasInput = !!(text.left.value.trim() || text.right.value.trim());
    if (!hasInput) { els.jsonView.hidden = true; showEmpty("start"); updateNavJson(); return; }
    showEmpty("");
    updateNavJson();
    if (!j) { els.jsonView.hidden = true; return; }
    if (j.error) {
      els.jsonView.hidden = true;
      addNotice("error", j.error);
      return;
    }
    if (j.truncated) addNotice("info", "Showing the first 5,000 differences.");
    var types = j.entries.filter(function (e) { return e.kind === "type"; });
    if (types.length) addNotice("warning", types.length + " value" + (types.length === 1 ? " changed" : "s changed") + " type (for example a number became a string), a common source of client bugs.");
    els.jsonView.hidden = false;
    if (!j.entries.length) {
      els.jsonView.innerHTML = '<div class="empty same"><div class="card"><span class="codicon codicon-pass-filled big-icon" aria-hidden="true"></span><h2>The documents are equivalent</h2><p>Key order and formatting are ignored in this mode.</p></div></div>';
      return;
    }
    var table = document.createElement("table");
    table.className = "jt";
    table.innerHTML = "<thead><tr><th scope=\"col\">Change</th><th scope=\"col\">Path</th><th scope=\"col\">Original</th><th scope=\"col\">Modified</th></tr></thead>";
    var body = document.createElement("tbody");
    j.entries.forEach(function (e) {
      var tr = document.createElement("tr");
      var k = document.createElement("td"); var badge = document.createElement("span"); badge.className = "kind " + e.kind; badge.textContent = e.kind === "type" ? "type changed" : e.kind; k.appendChild(badge);
      var p = document.createElement("td"); p.className = "path"; p.textContent = e.path;
      var b = document.createElement("td"); b.className = "val before"; b.textContent = e.before;
      var a = document.createElement("td"); a.className = "val after"; a.textContent = e.after;
      tr.append(k, p, b, a);
      body.appendChild(tr);
    });
    table.appendChild(body);
    els.jsonView.textContent = "";
    els.jsonView.appendChild(table);
  }
  function updateNavJson() { els.prev.disabled = els.next.disabled = true; els.navPos.textContent = ""; }
  function addNotice(kind, message) {
    var div = document.createElement("div");
    div.className = "notice " + kind;
    div.setAttribute("role", kind === "error" ? "alert" : "status");
    var icon = document.createElement("span");
    icon.className = "codicon codicon-" + ({ info: "info", warning: "warning", error: "error", success: "pass" })[kind];
    icon.setAttribute("aria-hidden", "true");
    var span = document.createElement("span"); span.textContent = message;
    div.append(icon, span);
    els.notices.appendChild(div);
  }

  // ---------------------------------------------------------------------------
  // Results: copy, download, open
  // ---------------------------------------------------------------------------

  function baseName(name) { return String(name || "").replace(/^.*[\\/]/, "") || ""; }

  function patchText() {
    if (!S.model || !S.snap) return "";
    var ln = baseName(names.left.value) || "original", rn = baseName(names.right.value) || "modified";
    return E.unifiedPatch(S.model, S.snap.left, S.snap.right, { context: 3, leftName: ln, rightName: rn });
  }

  function jsonReportText() {
    var j = S.json;
    if (!j || !j.entries) return "";
    if (!j.entries.length) return "The documents are equivalent.\n";
    return j.entries.map(function (e) {
      var tag = e.kind === "type" ? "type" : e.kind;
      return tag + "\t" + e.path + (e.before ? "\t" + e.before : "\t") + (e.after ? "\t→ " + e.after : "");
    }).join("\n") + "\n";
  }

  function resultReady() {
    if (S.prefs.mode === "json") { if (S.json && S.json.entries) return true; }
    else if (S.model && S.snap && !S.busy) return true;
    toast("warning", S.busy ? "Still comparing…" : "There is nothing to copy yet. Add both versions first.");
    return false;
  }

  function copyResult() {
    if (!resultReady()) return;
    if (S.prefs.mode === "json") { vscode.postMessage({ type: "copy", text: jsonReportText(), label: "Copied the differences." }); return; }
    if (S.model.identical) { toast("info", "The versions match, so the diff is empty."); return; }
    var patch = patchText();
    vscode.postMessage({ type: "copy", text: patch, label: "Copied the unified diff (" + fmt(patch.split("\n").length - 1) + " lines)." });
  }
  function saveResult() {
    if (!resultReady()) return;
    if (S.prefs.mode === "json") { vscode.postMessage({ type: "save", text: jsonReportText(), name: "json-differences.txt" }); return; }
    var stem = (baseName(names.right.value) || baseName(names.left.value) || "changes").replace(/\.[^.]+$/, "");
    vscode.postMessage({ type: "save", text: patchText(), name: stem + ".diff" });
  }
  function openPatch() {
    if (!resultReady()) return;
    vscode.postMessage({ type: "openPatch", text: patchText() });
  }

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------

  function setSide(side, value, name, language) {
    // Textareas turn every line break into LF, so remember the file's own style.
    S.sides[side].eol = value ? E.splitLines(value.slice(0, 200000)).eol : "none";
    text[side].value = value;
    if (name != null) { names[side].value = name; }
    S.sides[side].language = language || "";
    S.sides[side].name = names[side].value;
    updateEditor(side);
  }

  function updateEditor(side) {
    var ta = text[side], v = ta.value;
    var lines = v ? countLines(v) : 0;
    var bytes = v.length;
    var eol = S.sides[side].eol;
    $(side + "Meta").textContent = v ? fmt(lines) + " line" + (lines === 1 ? "" : "s") + (bytes > 1024 ? " · " + humanSize(bytes) : "") + (eol === "CRLF" || eol === "CR" || eol === "mixed" ? " · " + eol : "") : "Empty";
    var digits = Math.max(2, String(Math.max(lines, 1)).length);
    $(side + "Editor").style.setProperty("--gw", Math.ceil(digits * V.charW + 18) + "px");
    S.sides[side].lines = lines;
    paintGutter(side);
  }
  function countLines(v) {
    var n = 1, i = -1;
    while ((i = v.indexOf("\n", i + 1)) !== -1) n++;
    return v.endsWith("\n") ? n - 1 : n;
  }
  function humanSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; }

  /** Line numbers for the visible part of a textarea only, so huge inputs stay fast. */
  function paintGutter(side) {
    var ta = text[side], g = $(side + "Gutter");
    var lines = Math.max(1, S.sides[side].lines || 1);
    var first = Math.max(0, Math.floor((ta.scrollTop - 8) / V.rowH));
    var visible = Math.ceil(ta.clientHeight / V.rowH) + 2;
    var last = Math.min(lines, first + visible);
    var out = [];
    for (var i = first + 1; i <= last; i++) out.push(i);
    g.textContent = out.join("\n");
    g.style.transform = "translateY(" + (first * V.rowH - ta.scrollTop) + "px)";
  }

  function onInput(side) {
    updateEditor(side);
    scheduleCompare();
  }

  var lastCleared = null;
  function act(name, side) {
    switch (name) {
      case "upload": vscode.postMessage({ type: "pickFile", side: side }); break;
      case "editor": vscode.postMessage({ type: "readEditor", side: side }); break;
      case "paste": vscode.postMessage({ type: "paste", side: side }); break;
      case "copy":
        if (!text[side].value) { toast("info", "That side is empty."); break; }
        vscode.postMessage({ type: "copy", text: text[side].value, label: "Copied the " + (side === "left" ? "original" : "modified") + " text." });
        break;
      case "clear":
        if (!text[side].value && !names[side].value) break;
        lastCleared = { side: side, text: text[side].value, name: names[side].value, language: S.sides[side].language };
        setSide(side, "", "", "");
        compareNow();
        toast("info", "Cleared the " + (side === "left" ? "original" : "modified") + " text.", "Undo", function () {
          if (!lastCleared) return;
          setSide(lastCleared.side, lastCleared.text, lastCleared.name, lastCleared.language);
          lastCleared = null;
          compareNow();
        });
        text[side].focus();
        break;
    }
  }

  function swap() {
    var lt = text.left.value, ln = names.left.value, ll = S.sides.left.language;
    setSide("left", text.right.value, names.right.value, S.sides.right.language);
    setSide("right", lt, ln, ll);
    compareNow();
    toast("success", "Swapped the original and modified versions.");
  }

  function readDroppedFile(side, file) {
    if (file.size > 25 * 1024 * 1024) { toast("error", file.name + " is larger than 25 MB."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var v = String(reader.result || "");
      if (v.slice(0, 8000).indexOf("\u0000") !== -1) { toast("error", file.name + " looks like a binary file. The Code Diff Checker compares text."); return; }
      setSide(side, v.replace(/^﻿/, ""), file.name, "");
      compareNow();
    };
    reader.onerror = function () { toast("error", "Could not read " + file.name + "."); };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  function syncControls() {
    var p = S.prefs;
    document.querySelectorAll("#modeSeg button").forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.mode === p.mode)); });
    document.querySelectorAll("#viewSeg button").forEach(function (b) {
      b.setAttribute("aria-checked", String(b.dataset.view === viewMode()));
      b.disabled = S.narrow && b.dataset.view === "split";
      if (b.dataset.view === "split") b.title = S.narrow ? "Split view needs a wider panel" : "Side by side (V)";
    });
    press("optWs", p.ignoreWhitespace); press("optCase", p.ignoreCase); press("optWrap", p.wrap); press("optCollapse", p.collapse); press("optArrayOrder", p.ignoreArrayOrder);
    $("contextSel").value = String(p.context);
    $("tabSel").value = String(p.tabSize);
    $("optSyntax").checked = !!p.syntax;
    els.langSel.disabled = !p.syntax;
    $("arrayKey").value = p.arrayKey || "";
    $("saveDiff").hidden = !BOOT.canSave;
  }
  function press(id, on) { $(id).setAttribute("aria-pressed", String(!!on)); }

  function setPref(key, value, how) {
    S.prefs[key] = value;
    vscode.postMessage({ type: "prefs", prefs: S.prefs });
    persist();
    if (how === "compare") compareNow();
    else render(false);
  }

  function updateLangLabel() {
    var auto = els.langSel.options[0];
    if (auto) auto.textContent = "Auto (" + E.languageLabel(detected()) + ")";
  }

  function fillLanguages() {
    var auto = document.createElement("option");
    auto.value = "auto";
    els.langSel.appendChild(auto);
    E.LANGUAGES.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l[0]; o.textContent = l[1];
      els.langSel.appendChild(o);
    });
    els.langSel.value = saved.language || "auto";
  }

  function setInputsVisible(visible) {
    els.inputs.hidden = !visible;
    els.collapsed.hidden = visible;
    var btn = $("toggleInputs");
    btn.setAttribute("aria-pressed", String(!visible));
    btn.querySelector(".codicon").className = "codicon codicon-chevron-" + (visible ? "up" : "down");
    btn.querySelector(".lbl").textContent = visible ? "Hide inputs" : "Show inputs";
    els.collapsedNames.textContent = (names.left.value || "Original") + "  →  " + (names.right.value || "Modified");
    S.inputsHidden = !visible;
    persist();
    queueResize();
  }

  var toastTimer = 0;
  function toast(kind, message, actionLabel, action) {
    var t = els.toast;
    t.textContent = "";
    var icon = document.createElement("span");
    icon.className = "codicon codicon-" + ({ success: "pass", info: "info", warning: "warning", error: "error" })[kind];
    icon.setAttribute("aria-hidden", "true");
    var span = document.createElement("span"); span.textContent = message;
    t.append(icon, span);
    if (actionLabel) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "link"; b.textContent = actionLabel;
      b.addEventListener("click", function () { t.hidden = true; action(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 6000 : 2600);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  var persistTimer = 0;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      var l = text.left.value, r = text.right.value;
      var keepText = l.length + r.length <= MAX_STATE_CHARS;
      vscode.setState({
        prefs: S.prefs, language: els.langSel.value, inputsHidden: !!S.inputsHidden,
        left: keepText ? { text: l, name: names.left.value, language: S.sides.left.language } : null,
        right: keepText ? { text: r, name: names.right.value, language: S.sides.right.language } : null
      });
    }, 400);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  ["left", "right"].forEach(function (side) {
    var ta = text[side];
    ta.addEventListener("input", function () { onInput(side); });
    ta.addEventListener("scroll", function () { paintGutter(side); }, { passive: true });
    names[side].addEventListener("input", function () { S.sides[side].name = names[side].value; updateLangLabel(); persist(); });
    names[side].addEventListener("change", function () { if (els.langSel.value === "auto") compareNow(); });
    // Tab inserts a tab in the editors; Esc then Tab leaves them (VS Code's convention).
    var escaped = false;
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { escaped = true; return; }
      if (e.key === "Tab" && !escaped && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!document.execCommand || !document.execCommand("insertText", false, "\t")) {
          var s = ta.selectionStart, en = ta.selectionEnd;
          ta.setRangeText("\t", s, en, "end");
          onInput(side);
        }
      }
      escaped = false;
    });
    var editor = $(side + "Editor");
    editor.addEventListener("dragover", function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) { e.preventDefault(); editor.classList.add("dragging"); }
    });
    editor.addEventListener("dragleave", function () { editor.classList.remove("dragging"); });
    editor.addEventListener("drop", function (e) {
      editor.classList.remove("dragging");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      readDroppedFile(side, files[0]);
      if (files[1]) readDroppedFile(side === "left" ? "right" : "left", files[1]);
    });
    new ResizeObserver(function () { paintGutter(side); }).observe(ta);
  });

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.dataset.act) { act(t.dataset.act, t.dataset.side); return; }
    if (t.dataset.fold != null) {
      S.expanded.add(Number(t.dataset.fold));
      var st = els.viewer.scrollTop;
      S.display = buildDisplay();
      resetViewer(st);
      updateNav();
      return;
    }
    if (t.dataset.mode) { if (S.prefs.mode !== t.dataset.mode) { S.json = null; S.prefs.mode = t.dataset.mode; setPref("mode", t.dataset.mode, "compare"); } return; }
    if (t.dataset.view) { if (!t.disabled) setPref("view", t.dataset.view); return; }
    switch (t.id) {
      case "swapBtn": swap(); break;
      case "optWs": setPref("ignoreWhitespace", !S.prefs.ignoreWhitespace, "compare"); break;
      case "optCase": setPref("ignoreCase", !S.prefs.ignoreCase, "compare"); break;
      case "optWrap": setPref("wrap", !S.prefs.wrap); break;
      case "optCollapse": setPref("collapse", !S.prefs.collapse); break;
      case "optArrayOrder": setPref("ignoreArrayOrder", !S.prefs.ignoreArrayOrder, "compare"); break;
      case "prevBtn": go(-1); break;
      case "nextBtn": go(1); break;
      case "copyDiff": copyResult(); break;
      case "saveDiff": saveResult(); break;
      case "openPatch": openPatch(); break;
      case "toggleInputs": setInputsVisible(els.inputs.hidden); break;
      case "showInputs": setInputsVisible(true); text.left.focus(); break;
      case "helpBtn": openHelp(); break;
      case "tryExample": loadExample(0); break;
      case "retryBtn": S.error = ""; stopWorker(); worker = null; compareNow(); break;
    }
  });

  $("exampleSel").addEventListener("change", function (e) {
    var v = e.target.value;
    e.target.value = "";
    if (v !== "") loadExample(Number(v));
  });
  function loadExample(i) {
    var ex = (BOOT.examples || [])[i];
    if (!ex) return;
    setSide("left", ex.left.text, ex.left.name, "");
    setSide("right", ex.right.text, ex.right.name, "");
    if (S.prefs.mode !== ex.mode) { S.prefs.mode = ex.mode; S.json = null; vscode.postMessage({ type: "prefs", prefs: S.prefs }); }
    compareNow();
  }

  els.langSel.addEventListener("change", function () { persist(); compareNow(); });
  $("contextSel").addEventListener("change", function (e) { setPref("context", Number(e.target.value)); });
  $("tabSel").addEventListener("change", function (e) {
    setPref("tabSize", Number(e.target.value));
    document.querySelectorAll(".editor").forEach(function (ed) { ed.style.setProperty("--tab", e.target.value); });
  });
  $("optSyntax").addEventListener("change", function (e) { setPref("syntax", e.target.checked, "compare"); });
  var keyTimer = 0;
  $("arrayKey").addEventListener("input", function (e) {
    clearTimeout(keyTimer);
    var v = e.target.value;
    keyTimer = setTimeout(function () { setPref("arrayKey", v.trim(), "compare"); }, 300);
  });
  document.addEventListener("click", function (e) {
    var menu = $("moreMenu");
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  els.viewer.addEventListener("scroll", queuePaint, { passive: true });
  els.hbar.addEventListener("scroll", function () { els.viewer.style.setProperty("--sx", String(els.hbar.scrollLeft)); }, { passive: true });
  els.viewer.addEventListener("wheel", function (e) {
    if (S.prefs.wrap) return;
    var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!dx) return;
    e.preventDefault();
    els.hbar.scrollLeft += dx;
  }, { passive: false });
  // Selecting text in split view stays on one side, so copied code is never interleaved.
  els.viewer.addEventListener("mousedown", function (e) {
    var cellEl = e.target.closest ? e.target.closest(".side-l, .side-r") : null;
    if (cellEl) els.viewer.dataset.sel = cellEl.classList.contains("side-l") ? "left" : "right";
    else delete els.viewer.dataset.sel;
  });

  function isTyping(t) { return t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable); }
  document.addEventListener("keydown", function (e) {
    var mod = BOOT.mac ? e.metaKey : e.ctrlKey;
    if (e.altKey && !mod && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); go(e.key === "ArrowDown" ? 1 : -1); return; }
    if (mod && e.key === "Enter") { e.preventDefault(); compareNow(); return; }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "n": case "j": go(1); break;
      case "p": case "k": go(-1); break;
      case "v": if (!S.narrow && S.prefs.mode === "code") setPref("view", S.prefs.view === "split" ? "unified" : "split"); break;
      case "w": if (S.prefs.mode === "code") setPref("wrap", !S.prefs.wrap); break;
      case "c": if (S.prefs.mode === "code") setPref("collapse", !S.prefs.collapse); break;
      case "i": setInputsVisible(els.inputs.hidden); break;
      case "s": swap(); break;
      case "?": openHelp(); break;
      case "ArrowLeft": case "ArrowRight":
        if (e.target === els.viewer && !S.prefs.wrap) { e.preventDefault(); els.hbar.scrollLeft += e.key === "ArrowRight" ? 60 : -60; }
        return;
      default: return;
    }
    e.preventDefault();
  });

  function openHelp() {
    var mod = BOOT.mac ? "⌘" : "Ctrl";
    var keys = [
      [["Alt", "↓"], "Next change (also N or J)"], [["Alt", "↑"], "Previous change (also P or K)"],
      [[mod, "Enter"], "Compare now"], [["V"], "Switch split and unified view"], [["W"], "Wrap long lines"],
      [["C"], "Collapse or expand unchanged lines"], [["I"], "Hide or show the inputs"], [["S"], "Swap original and modified"],
      [["← →"], "Scroll the diff sideways (when it has focus)"], [["Esc", "Tab"], "Leave an editor (Tab alone inserts a tab)"], [["?"], "Show this list"]
    ];
    var dl = $("helpKeys");
    dl.textContent = "";
    keys.forEach(function (k) {
      var dt = document.createElement("dt");
      k[0].forEach(function (key, i) {
        if (i) dt.appendChild(document.createTextNode(" "));
        var kbd = document.createElement("kbd"); kbd.textContent = key; dt.appendChild(kbd);
      });
      var dd = document.createElement("dd"); dd.textContent = k[1];
      dl.append(dt, dd);
    });
    var dialog = $("helpDialog");
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  }

  var resizeQueued = false, lastWidth = 0;
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    setTimeout(function () {
      resizeQueued = false;
      var narrow = window.innerWidth < 760;
      var width = els.viewer.clientWidth;
      if (narrow !== S.narrow) { S.narrow = narrow; render(false); lastWidth = width; return; }
      if (S.display && width !== lastWidth) { lastWidth = width; resetViewer(els.viewer.scrollTop); }
      else if (S.display) paint();
      ["left", "right"].forEach(paintGutter);
    }, 60);
  }
  new ResizeObserver(queueResize).observe(els.wrap);
  window.addEventListener("resize", queueResize);

  window.addEventListener("message", function (event) {
    var msg = event.data || {};
    switch (msg.type) {
      case "file":
        setSide(msg.side, String(msg.text || ""), msg.keepName ? null : String(msg.name || ""), msg.language || "");
        if (msg.note === "selection") toast("info", "Using the selection from " + (msg.name || "the editor") + ".");
        compareNow();
        break;
      case "setInputs":
        if (msg.left) setSide("left", msg.left.text, msg.left.name, msg.left.language);
        if (msg.right) setSide("right", msg.right.text, msg.right.name, msg.right.language);
        compareNow();
        break;
      case "notice":
        toast(msg.kind || "info", String(msg.text || ""));
        break;
      case "jsonResult":
        if (msg.requestId !== jsonReq) return;
        setBusy(false);
        S.json = msg;
        render(true);
        break;
    }
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  measureFont();
  fillLanguages();
  S.narrow = window.innerWidth < 760;
  var init = BOOT.initial || {};
  var hasInitial = !!(init.left || init.right);
  var restore = hasInitial ? init : { left: saved.left, right: saved.right };
  ["left", "right"].forEach(function (side) {
    var v = restore[side];
    setSide(side, v ? String(v.text || "") : "", v ? String(v.name || "") : "", v ? v.language || "" : "");
  });
  (BOOT.examples || []).forEach(function (ex, i) {
    var o = document.createElement("option");
    o.value = String(i); o.textContent = ex.label;
    $("exampleSel").appendChild(o);
  });
  document.querySelectorAll(".editor").forEach(function (ed) { ed.style.setProperty("--tab", String(S.prefs.tabSize || 4)); });
  setInputsVisible(!saved.inputsHidden);
  syncControls();
  compareNow();
  if (!text.left.value) text.left.focus();
})();
