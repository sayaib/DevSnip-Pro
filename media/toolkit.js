// Toolkit tool panel: renders the form from the tool definition, sends runs to
// the extension host and renders results. Data comes from #tool-data
// (src/toolkits/page.ts); the host side lives in src/toolkits/runner.ts.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi(); // may only be called once per page
  const data = JSON.parse(document.getElementById("tool-data").textContent);
  const tool = data.tool;
  const icons = data.icons;
  const saved = vscode.getState() || {};
  const MAX_SHOWN = 200000;

  const defaults = {};
  for (const f of tool.fields) {
    defaults[f.id] = f.default !== undefined ? f.default
      : f.kind === "toggle" ? false
        : f.kind === "select" ? (f.options && f.options[0] ? f.options[0].value : "")
          : "";
  }
  const secretIds = new Set(tool.fields.filter(f => f.kind === "secret").map(f => f.id));
  let values = Object.assign({}, defaults, pickKnown(saved.values), pickKnown(data.initial));
  let examples = data.examples || [];
  let seq = 0;
  let running = false;
  let hasResult = false;
  let liveTimer;
  let tabTrap = true;
  const controls = {};
  const rows = {};
  const groupHeadings = {};

  function pickKnown(obj) {
    const out = {};
    if (!obj || typeof obj !== "object") return out;
    for (const f of tool.fields) if (Object.prototype.hasOwnProperty.call(obj, f.id)) out[f.id] = obj[f.id];
    return out;
  }

  // ---- DOM helpers ------------------------------------------------------

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c);
    return node;
  }

  function icon(name, cls) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "i" + (cls ? " " + cls : ""));
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icons[name] || ""; // trusted: fixed strings from the extension
    return svg;
  }

  function button(label, iconName, onClick, cls, title) {
    return h("button", { type: "button", class: "btn " + (cls || ""), onclick: onClick, title: title || undefined, "aria-label": title || undefined }, iconName ? icon(iconName) : null, label ? h("span", { text: label }) : null);
  }

  let toastTimer;
  function toast(kind, text) {
    const el = document.getElementById("toast");
    el.textContent = text;
    el.className = "toast show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast " + (kind || ""); }, 2600);
  }

  // ---- Form -------------------------------------------------------------

  function isVisible(field, seen) {
    if (!field.showIf) return true;
    const parent = tool.fields.find(f => f.id === field.showIf.field);
    if (!parent) return true;
    seen = seen || new Set();
    if (seen.has(parent.id)) return true;
    seen.add(parent.id);
    if (!isVisible(parent, seen)) return false;
    const current = values[parent.id];
    return field.showIf.equals.some(v => String(v) === String(current));
  }

  function updateVisibility() {
    for (const f of tool.fields) rows[f.id].hidden = !isVisible(f);
    // A group heading shows while any field up to the next heading is visible.
    for (const [start, heading] of Object.entries(groupHeadings)) {
      const i = tool.fields.findIndex(f => f.id === start);
      let any = false;
      for (let j = i; j < tool.fields.length && (j === i || !tool.fields[j].group); j++) if (isVisible(tool.fields[j])) { any = true; break; }
      heading.hidden = !any;
    }
  }

  function visibleValues() {
    const out = {};
    for (const f of tool.fields) if (isVisible(f)) out[f.id] = values[f.id];
    return out;
  }

  function missingRequired() {
    return tool.fields.filter(f => f.required && isVisible(f) && String(values[f.id] ?? "").trim() === "");
  }

  function persist() {
    const keep = {};
    for (const [k, v] of Object.entries(values)) if (!secretIds.has(k)) keep[k] = v;
    vscode.setState({ values: keep });
  }

  function setValue(id, value, fromUser) {
    values[id] = value;
    const control = controls[id];
    if (!fromUser && control) {
      if (control.type === "checkbox") control.checked = Boolean(value);
      else control.value = value === undefined || value === null ? "" : String(value);
    }
    if (control) control.classList.remove("invalid");
  }

  function onChange(id, value) {
    setValue(id, value, true);
    updateVisibility();
    persist();
    if (tool.live) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => runIfReady("live"), 350);
    }
  }

  function buildField(f) {
    const id = "f_" + f.id;
    let control;
    if (f.kind === "select") {
      control = h("select", { id }, (f.options || []).map(o => h("option", { value: o.value, text: o.label })));
      control.value = String(values[f.id]);
      control.addEventListener("change", () => onChange(f.id, control.value));
    } else if (f.kind === "toggle") {
      control = h("input", { id, type: "checkbox" });
      control.checked = Boolean(values[f.id] === true || values[f.id] === "true");
      control.addEventListener("change", () => onChange(f.id, control.checked));
      const row = h("div", { class: "field " + (f.width === "wide" ? "" : "narrow") },
        h("label", { class: "toggle", for: id }, control, h("span", { class: "switch", "aria-hidden": "true" }), h("span", { text: f.label })),
        f.help ? h("div", { class: "help", text: f.help }) : null);
      controls[f.id] = control;
      return row;
    } else if (f.kind === "textarea" || f.kind === "code") {
      control = h("textarea", { id, rows: String(f.rows || 6), class: f.kind === "code" ? "code" : "", placeholder: f.placeholder || undefined, spellcheck: f.kind === "code" ? "false" : undefined, autocapitalize: "off" });
      control.value = values[f.id] === undefined ? "" : String(values[f.id]);
      control.addEventListener("input", () => onChange(f.id, control.value));
      if (f.kind === "code") {
        control.addEventListener("focus", () => { tabTrap = true; });
        control.addEventListener("keydown", event => {
          // Tab indents inside code; press Escape first to move focus on with Tab.
          if (event.key === "Escape") { tabTrap = false; return; }
          if (event.key === "Tab" && tabTrap && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            const start = control.selectionStart;
            control.setRangeText("  ", start, control.selectionEnd, "end");
            onChange(f.id, control.value);
          }
        });
      }
    } else {
      control = h("input", { id, type: f.kind === "number" ? "number" : f.kind === "secret" ? "password" : "text", placeholder: f.placeholder || undefined, min: f.min, max: f.max, step: f.step || (f.kind === "number" ? "any" : undefined), autocomplete: f.kind === "secret" ? "off" : undefined, spellcheck: "false" });
      control.value = values[f.id] === undefined ? "" : String(values[f.id]);
      control.addEventListener("input", () => onChange(f.id, control.value));
    }
    controls[f.id] = control;
    const labelRow = h("div", { class: "label-row" },
      h("label", { class: "lbl", for: id }, f.label, f.required ? h("span", { class: "req", "aria-hidden": "true", text: "*" }) : null),
      f.fromEditor ? button("Use editor", "editor", () => vscode.postMessage({ type: "readEditor", field: f.id }), "ghost", `Fill ${f.label} from the active editor (selection, or the whole file)`) : null);
    // A narrow select with long option labels would truncate them; give it two columns.
    const longOptions = f.kind === "select" && (f.options || []).some(o => o.label.length > 24);
    return h("div", { class: "field" + (f.width === "narrow" ? " narrow" : "") + (longOptions ? " span2" : "") }, labelRow, control, f.help ? h("div", { class: "help", text: f.help }) : null);
  }

  function presetsSelect() {
    if (!examples.length) return null;
    const select = h("select", { "aria-label": "Presets", class: "presets" },
      h("option", { value: "", text: "Presets…" }),
      examples.map((e, i) => h("option", { value: String(i), text: e.label })));
    select.addEventListener("change", () => {
      const example = examples[Number(select.value)];
      select.value = "";
      if (!example) return;
      for (const f of tool.fields) setValue(f.id, Object.prototype.hasOwnProperty.call(example.values, f.id) ? example.values[f.id] : defaults[f.id], false);
      updateVisibility();
      persist();
      runIfReady("preset");
    });
    return select;
  }

  // ---- Running ------------------------------------------------------------

  let runButton;
  let actionButtons = [];

  function runIfReady(trigger, action) {
    const missing = missingRequired();
    if (missing.length && !action) {
      if (trigger === "live" || trigger === "preset") { if (!hasResult) renderEmpty(missing); return; }
      for (const f of missing) controls[f.id]?.classList.add("invalid");
      controls[missing[0].id]?.focus();
      toast("warning", `Enter ${missing.map(f => f.label).join(", ")} first.`);
      return;
    }
    const requestId = ++seq;
    setRunning(true);
    vscode.postMessage({ type: "run", requestId, values: visibleValues(), trigger, action });
  }

  function setRunning(on) {
    running = on;
    const results = document.getElementById("results");
    if (results) results.classList.toggle("stale", on && hasResult);
    if (runButton) {
      runButton.disabled = on && !tool.live;
      runButton.replaceChildren(on ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("play"), h("span", { text: on ? (tool.network ? "Waiting for response…" : "Running…") : (tool.runLabel || "Run") }));
    }
    for (const b of actionButtons) b.disabled = on;
    document.getElementById("app").setAttribute("aria-busy", String(on));
  }

  // ---- Results ------------------------------------------------------------

  function renderEmpty(missing) {
    const results = document.getElementById("results");
    const needs = missing && missing.length ? missing.map(f => f.label).join(", ") : "";
    results.replaceChildren(h("div", { class: "empty" },
      icon("spark"),
      h("div", { class: "t", text: needs ? `Add ${needs} to get started` : tool.live ? "Results appear here as you type" : `Press ${tool.runLabel || "Run"} to see results` }),
      h("div", { text: examples.length ? "Or pick one of the Presets to try it with sample data." : "Everything runs locally in VS Code unless the tool says otherwise." })));
  }

  const toneOf = t => (t === "good" || t === "warn" || t === "bad" ? t : "");

  function renderResult(msg) {
    const results = document.getElementById("results");
    const nodes = [];
    nodes.push(h("div", { class: "status" }, msg.error ? null : icon("ok"), h("span", { text: msg.error ? "" : `Done in ${msg.durationMs < 1000 ? msg.durationMs + " ms" : (msg.durationMs / 1000).toFixed(1) + " s"}` })));
    if (msg.error) {
      nodes.push(h("div", { class: "msgs" }, h("div", { class: "msg " + (msg.outcome === "input_error" ? "warning" : "error") }, icon(msg.outcome === "input_error" ? "warn" : "error"), h("span", { text: msg.error }))));
      results.replaceChildren(...nodes);
      return;
    }
    const r = msg.result || {};
    if (r.setValues) {
      for (const [k, v] of Object.entries(pickKnown(r.setValues))) setValue(k, v, false);
      updateVisibility();
      persist();
    }
    if (r.stats && r.stats.length) nodes.push(h("div", { class: "stats" }, r.stats.map(s => h("div", { class: `stat ${toneOf(s.tone)}${String(s.value).length > 32 ? " wide" : ""}` }, h("div", { class: "v", text: s.value }), h("div", { class: "l", text: s.label })))));
    if (r.messages && r.messages.length) {
      const list = h("div", { class: "msgs" });
      const iconFor = { success: "ok", warning: "warn", error: "error", info: "info" };
      const limit = 8;
      r.messages.forEach((m, i) => {
        const row = h("div", { class: "msg " + m.kind }, icon(iconFor[m.kind] || "info"), h("span", { text: m.text }));
        if (i >= limit) row.hidden = true;
        list.append(row);
      });
      if (r.messages.length > limit) {
        const more = button(`Show ${r.messages.length - limit} more`, null, () => { for (const c of list.children) c.hidden = false; more.remove(); }, "ghost more");
        list.append(more);
      }
      nodes.push(list);
    }
    for (const o of r.outputs || []) nodes.push(renderOutput(o));
    if (nodes.length === 1) nodes.push(h("div", { class: "empty" }, h("div", { class: "t", text: "Nothing to show" })));
    results.replaceChildren(...nodes);
    hasResult = true;
  }

  function outHead(title, sub, actions) {
    return h("div", { class: "out-head" }, h("div", { class: "out-title", title }, title, sub ? h("span", { class: "sub", text: sub }) : null), h("div", { class: "out-actions" }, actions));
  }

  function shown(text) {
    return text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN) : text;
  }

  function truncatedNote(text) {
    return text.length > MAX_SHOWN ? h("div", { class: "truncated", text: `Showing the first ${MAX_SHOWN.toLocaleString()} of ${text.length.toLocaleString()} characters. Copy, Open or Save use everything.` }) : null;
  }

  function codeActions(content, language, fileName, title) {
    return [
      button("Copy", "copy", () => vscode.postMessage({ type: "copy", text: content }), "ghost"),
      button("Insert", "insert", () => vscode.postMessage({ type: "insert", text: content, language }), "ghost", "Insert at the cursor in your editor"),
      button("Open", "open", () => vscode.postMessage({ type: "open", text: content, language }), "ghost", "Open in a new editor tab"),
      fileName ? button("Save", "save", () => vscode.postMessage({ type: "save", files: [{ path: fileName, content, language }] }), "ghost", `Save as ${fileName} in the workspace`) : null,
      button("", "download", () => vscode.postMessage({ type: "download", text: content, language, fileName: fileName || title || "" }), "ghost", "Save as… (choose where to save the file)")
    ];
  }

  function renderOutput(o) {
    if (o.kind === "code") {
      return h("section", { class: "panel out" }, outHead(o.title, o.fileName && o.fileName !== o.title ? o.fileName : null, codeActions(o.content, o.language, o.fileName, o.title)), h("pre", { class: "code", tabindex: "0", text: shown(o.content) }), truncatedNote(o.content));
    }
    if (o.kind === "text") {
      return h("section", { class: "panel out" }, outHead(o.title, null, [button("Copy", "copy", () => vscode.postMessage({ type: "copy", text: o.content }), "ghost"), button("", "download", () => vscode.postMessage({ type: "download", text: o.content, language: "text", fileName: o.title }), "ghost", "Save as…")]), h("div", { class: "textout", text: shown(o.content) }), truncatedNote(o.content));
    }
    if (o.kind === "table") {
      const csv = [o.columns, ...o.rows].map(r => r.map(c => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
      const md = [`| ${o.columns.join(" | ")} |`, `| ${o.columns.map(() => "---").join(" | ")} |`, ...o.rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`)].join("\n");
      const body = o.rows.slice(0, 2000).map(r => h("tr", null, r.map(c => h("td", { class: typeof c === "number" ? "num" : "", text: typeof c === "number" ? c.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(c) }))));
      return h("section", { class: "panel out" },
        outHead(o.title, `${o.rows.length} row${o.rows.length === 1 ? "" : "s"}`, [button("CSV", "copy", () => vscode.postMessage({ type: "copy", text: csv }), "ghost", "Copy as CSV"), button("Markdown", "copy", () => vscode.postMessage({ type: "copy", text: md }), "ghost", "Copy as a Markdown table"), button("", "download", () => vscode.postMessage({ type: "download", text: csv, language: "csv", fileName: `${o.title}.csv` }), "ghost", "Save as CSV…")]),
        h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, o.columns.map(c => h("th", { scope: "col", text: c })))), h("tbody", null, body))),
        o.rows.length > 2000 ? h("div", { class: "truncated", text: `Showing 2,000 of ${o.rows.length.toLocaleString()} rows; copy to get all of them.` }) : null);
    }
    if (o.kind === "files") {
      const list = h("div", { class: "files" }, o.files.map((file, i) => {
        const size = new Blob([file.content]).size;
        const details = h("details", { class: "file" },
          h("summary", null, icon("chevron", "chev"), icon("file"), h("span", { class: "path", text: file.path }), h("span", { class: "meta", text: `${file.mode === "append" ? "append · " : ""}${size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB"}` }),
            h("span", { class: "out-actions", onclick: e => e.preventDefault() }, codeActions(file.content, file.language, null).slice(0, 1).concat([button("", "open", () => vscode.postMessage({ type: "open", text: file.content, language: file.language }), "ghost", `Open ${file.path} in a new tab`), button("", "save", () => vscode.postMessage({ type: "save", files: [file] }), "ghost", `Save ${file.path} to the workspace`)]))),
          h("pre", { class: "code", tabindex: "0", text: shown(file.content) }));
        if (i === 0 && o.files.length <= 3) details.open = true;
        return details;
      }));
      return h("section", { class: "panel out" }, outHead(o.title, `${o.files.length} file${o.files.length === 1 ? "" : "s"}`, [button(o.files.length > 1 ? `Write all ${o.files.length}` : "Write to workspace", "save", () => vscode.postMessage({ type: "writeAll", files: o.files }), "ghost", "Write the files into the workspace (asks before overwriting)")]), list);
    }
    if (o.kind === "chart") return h("section", { class: "panel out" }, outHead(o.title, null, []), chart(o));
    return h("div");
  }

  function chart(o) {
    const W = 640, H = 260, L = 64, R = 16, T = 12, B = 34;
    const points = o.series.flatMap(s => s.points);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
    if (y1 === y0) y1 = y0 + 1;
    const sx = x => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
    const sy = y => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);
    const fmt = v => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0) ? v.toExponential(1) : Number(v.toPrecision(3)).toString());
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.title.replace(/"/g, "")}" preserveAspectRatio="none">`;
    for (let i = 0; i <= 4; i++) {
      const y = y0 + ((y1 - y0) * i) / 4;
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}"/><text x="${L - 6}" y="${sy(y) + 3}" text-anchor="end">${fmt(y)}</text>`;
      const x = x0 + ((x1 - x0) * i) / 4;
      svg += `<text x="${sx(x)}" y="${H - B + 14}" text-anchor="middle">${Math.round(x).toLocaleString()}</text>`;
    }
    svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    for (const s of o.series) {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
      svg += `<path class="area" d="${d}L${sx(s.points[s.points.length - 1][0])},${sy(y0)}L${sx(s.points[0][0])},${sy(y0)}Z"/><path class="line" d="${d}"/>`;
    }
    svg += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${o.xLabel}</text></svg>`;
    const wrap = h("div", { class: "chart" });
    wrap.innerHTML = svg; // numbers and labels from the tool definition only
    return wrap;
  }

  // ---- Layout -------------------------------------------------------------

  function build() {
    const app = document.getElementById("app");
    const head = h("header", { class: "head" },
      h("div", { class: "head-icon" }, icon("tool")),
      h("div", null,
        h("div", { class: "crumb", text: data.section.title }),
        h("h1", { text: tool.title }),
        h("p", { class: "summary", text: tool.summary }),
        h("div", { class: "badges" },
          tool.network ? h("span", { class: "badge net", title: "This tool sends a request over the network when you run it" }, icon("globe"), "Uses the network") : h("span", { class: "badge", title: "Runs entirely on your machine" }, icon("lock"), "Runs locally"),
          tool.live ? h("span", { class: "badge" }, icon("spark"), "Live results") : null)));
    const guide = tool.guide ? h("details", { class: "guide" }, h("summary", null, icon("chevron"), "How it works"), h("p", { text: tool.guide })) : null;

    runButton = h("button", { type: "button", class: "btn", onclick: () => runIfReady("run") });
    actionButtons = (tool.actions || []).map(a => button(a.label, null, () => runIfReady("action", a.id), "secondary"));
    const mod = data.mac ? "⌘" : "Ctrl";
    const form = h("section", { class: "panel form", "aria-label": "Inputs" },
      h("div", { class: "toolbar" }, presetsSelect(), h("span", { class: "grow" }), button("Reset", "reset", () => {
        for (const f of tool.fields) setValue(f.id, defaults[f.id], false);
        updateVisibility(); persist(); hasResult = false; renderEmpty(missingRequired());
        if (tool.live) runIfReady("live");
      }, "ghost", "Reset every field to its default")),
      h("div", { class: "fields" }, tool.fields.flatMap(f => {
        const row = (rows[f.id] = buildField(f));
        if (!f.group) return [row];
        const heading = (groupHeadings[f.id] = h("div", { class: "group-heading", role: "heading", "aria-level": "3", text: f.group }));
        return [heading, row];
      })),
      h("div", { class: "run-row" }, runButton, actionButtons, h("span", { class: "hint" }, h("kbd", { text: mod }), " ", h("kbd", { text: "Enter" }), tool.live ? "  · updates as you type" : "")));
    const results = h("section", { class: "results", id: "results", "aria-live": "polite", "aria-label": "Results" });
    app.replaceChildren(head, guide || "", h("div", { class: "layout split" }, form, results));
    updateVisibility();
    setRunning(false);
    renderEmpty(missingRequired());
    app.setAttribute("aria-busy", "false");
  }

  // ---- Messages -----------------------------------------------------------

  window.addEventListener("message", event => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "result":
        if (msg.requestId !== seq) return; // an older run finished late
        setRunning(false);
        renderResult(msg);
        break;
      case "editorText":
        if (!controls[msg.field]) return;
        setValue(msg.field, msg.text, false);
        onChange(msg.field, msg.text);
        toast("success", `Loaded ${msg.source}.`);
        if (!tool.live) runIfReady("run");
        break;
      case "setValues":
        for (const [k, v] of Object.entries(pickKnown(msg.values))) setValue(k, v, false);
        updateVisibility();
        persist();
        if (msg.run) runIfReady(tool.live ? "live" : "run");
        break;
      case "examples": {
        examples = msg.examples || [];
        const old = document.querySelector(".presets");
        const fresh = presetsSelect();
        if (old && fresh) old.replaceWith(fresh);
        else if (old) old.remove();
        else if (fresh) document.querySelector(".toolbar").prepend(fresh);
        break;
      }
      case "notice":
        toast(msg.kind, msg.text);
        break;
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      runIfReady("run");
    }
  });

  build();
  const hasInitial = data.initial && Object.keys(data.initial).length > 0;
  if (tool.live || hasInitial) runIfReady(tool.live ? "live" : "run");
})();
