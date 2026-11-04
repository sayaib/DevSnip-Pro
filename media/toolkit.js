// Toolkit tool panel: renders the form from the tool definition, sends runs to
// the extension host and renders results. Data comes from #tool-data
// (src/toolkits/page.ts); the host side lives in src/toolkits/runner.ts.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi(); // may only be called once per page
  const data = JSON.parse(document.getElementById("tool-data").textContent);
  const tool = data.tool;
  const capabilities = Object.assign({ writeWorkspace: true, insert: true, saveAs: true }, data.outputCapabilities);
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
  const secretIds = new Set(tool.fields.filter(f => (f.kind === "secret" || f.sensitive)).map(f => f.id));
  const restorable = pickKnown(saved.values);
  for (const id of secretIds) delete restorable[id];
  let values = Object.assign({}, defaults, restorable, pickKnown(data.initial));
  let examples = data.examples || [];
  let seq = 0;
  let running = false;
  let hasResult = false;
  let inputRevision = 0;
  let runRevision = 0;
  let lastAction;
  let liveTimer;
  let liveEnabled = false;
  let tabTrap = true;
  let wrapCode = saved.wrap === true;
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
    vscode.setState({ values: keep, wrap: wrapCode });
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
    inputRevision++;
    if (hasResult || running) execution(running ? "running" : "stale", running ? "Running for earlier inputs… Run again after completion to use your changes." : "Inputs changed · previous result. Run again to update.");
    setValue(id, value, true);
    updateVisibility();
    persist();
    if (liveEnabled) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => runIfReady("live"), 350);
    }
  }

  function buildField(f) {
    const id = "f_" + f.id;
    let search;
    let control;
    if (f.kind === "select") {
      control = h("select", { id }, (f.options || []).map(o => h("option", { value: o.value, text: o.label })));
      control.value = String(values[f.id]);
      control.addEventListener("change", () => onChange(f.id, control.value));
      if (f.searchable) {
        search = h("input", { type: "search", placeholder: "Search templates…", "aria-label": `Search ${f.label.toLowerCase()}`, "aria-controls": id });
        search.addEventListener("input", () => {
          const query = search.value.trim().toLowerCase();
          for (const option of control.options) option.hidden = option.value !== control.value && !option.textContent.toLowerCase().includes(query);
        });
      }
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
    return h("div", { class: "field" + (f.width === "narrow" ? " narrow" : "") + (longOptions ? " span2" : "") }, labelRow, search, control, f.help ? h("div", { class: "help", text: f.help }) : null);
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
      ++inputRevision;
      for (const f of tool.fields) setValue(f.id, Object.prototype.hasOwnProperty.call(example.values, f.id) ? example.values[f.id] : defaults[f.id], false);
      updateVisibility();
      persist();
      if (hasResult || running) execution(running ? "running" : "stale", "Inputs changed · results belong to earlier inputs.");
      if (liveEnabled) runIfReady("live");
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
    if (running && !liveEnabled) return;
    clearTimeout(liveTimer);
    lastAction = action;
    runRevision = inputRevision;
    const requestId = ++seq;
    setRunning(true);
    execution("running", tool.network ? (hasResult ? "Running · waiting for response… Results below are from the previous run." : "Running · waiting for response…") : (hasResult ? "Running… Results below are from the previous run." : "Running…"));
    vscode.postMessage({ type: "run", requestId, values: visibleValues(), trigger, action });
  }

  function execution(state, text, at) {
    window.DevSnipExecution(document.getElementById("results"), state, text, at);
  }

  function setRunning(on) {
    running = on;
    const results = document.getElementById("results");
    if (results) {
      results.classList.toggle("stale", on && hasResult);
      for (const b of results.querySelectorAll("button")) b.disabled = on;
    }
    if (runButton) {
      runButton.disabled = on && !liveEnabled;
      runButton.replaceChildren(on ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("play"), h("span", { text: on ? (tool.network ? "Waiting for response…" : "Running…") : (tool.runLabel || "Run") }));
    }
    for (const b of actionButtons) b.disabled = on;
    document.getElementById("app").setAttribute("aria-busy", String(on));
  }

  // ---- Results ------------------------------------------------------------

  function renderEmpty(missing) {
    const results = document.getElementById("results");
    const needs = missing && missing.length ? missing.map(f => f.label).join(", ") : "";
    results.classList.remove("stale");
    results.style.minHeight = "";
    delete results.dataset.dsReserved;
    delete results.dataset.dsHeight;
    results.setAttribute("aria-busy", "false");
    results.replaceChildren(h("div", { class: "empty" },
      icon("spark"),
      h("div", { class: "t", text: needs ? `Add ${needs} to get started` : liveEnabled ? "Live preview enabled · edit an input to preview" : `Press ${tool.runLabel || "Run"} to see results` }),
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
      hasResult = true;
      execution("failed", "Failed · no new result generated.", Date.now());
      resultActions(results);
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
    const changed = inputRevision !== runRevision;
    results.classList.toggle("stale", changed);
    execution(changed ? "stale" : "completed", changed ? "Completed for earlier inputs · run again to update." : "Completed · new result", Date.now());
    resultActions(results);
  }

  function resultActions(results) {
    results.append(h("div", { class: "run-row" },
      button("Run again", "play", () => runIfReady("run", lastAction), "secondary"),
      button("Clear results", "reset", () => {
        ++seq; clearTimeout(liveTimer); setRunning(false); hasResult = false;
        renderEmpty(missingRequired());
      }, "ghost")));
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
      capabilities.insert ? button("Insert", "insert", () => vscode.postMessage({ type: "insert", text: content, language }), "ghost", "Insert at the cursor in your editor") : null,
      button("Open", "open", () => vscode.postMessage({ type: "open", text: content, language }), "ghost", "Open in a new editor tab"),
      fileName && capabilities.writeWorkspace ? button("Save", "save", () => vscode.postMessage({ type: "save", files: [{ path: fileName, content, language }] }), "ghost", `Save as ${fileName} in the workspace`) : null,
      capabilities.saveAs ? button("", "download", () => vscode.postMessage({ type: "download", text: content, language, fileName: fileName || title || "" }), "ghost", "Save as… (choose where to save the file)") : null
    ];
  }

  // ---- Code viewer ----------------------------------------------------------

  // Small bounded lexers, one rule list per language family. Rules are tried in
  // order at each position; "word" tokens are classified afterwards. All source
  // is inserted as text nodes, never HTML.
  const END = "(?![\\s\\S])";
  const words = s => new Set(s.split(" "));
  const DQ = '"(?:\\\\.|[^"\\\\\\n])*"', SQ = "'(?:\\\\.|[^'\\\\\\n])*'";
  const BT = "`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|" + END + ")";
  const SLASH = "\\/\\/[^\\n]*", BLOCK = "\\/\\*[\\s\\S]*?(?:\\*\\/|" + END + ")", HASH = "(?<![^\\s])#[^\\n]*";
  const NUM = "\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b";
  const WORD = "@?[A-Za-z_$][\\w$]*";
  const C_KEYWORDS = "abstract as assert async await break case catch class const continue default defer delete do dynamic else enum export extends extension final finally for foreach from fun func function get go goto guard if implements import in init instanceof interface internal is late lateinit let mixin module namespace new object of open operator out override package private protected public readonly record required return sealed select set static struct super suspend switch synchronized this throw throws try type typealias typeof using val var void volatile when where while with yield satisfies declare keyof protocol self mut impl pub use fn match loop crate trait echo elseif endforeach";
  const C_TYPES = "int long float double boolean bool char byte short string str number any unknown never object void uint int32 int64 float64 i32 i64 u8 u32 u64 f32 f64 usize";
  const LIT = "true false null undefined nil None True False NaN Infinity";
  const LIT_SET = words(LIT);
  const LANGS = {
    c: { rules: [[SLASH + "|" + BLOCK, "com"], [BT + "|" + DQ + "|" + SQ, "str"], ["@[A-Za-z_][\\w.]*", "attr"], [NUM, "num"], [WORD, "word"]], kw: words(C_KEYWORDS + " " + C_TYPES), calls: true, types: true },
    json: { rules: [[SLASH + "|" + BLOCK, "com"], [DQ + "(?=\\s*:)", "key"], [DQ, "str"], ["-?" + NUM, "num"], [WORD, "word"]], kw: words("") },
    python: { rules: [[HASH, "com"], ['[rRbBfFuU]{0,2}(?:"""[\\s\\S]*?(?:"""|' + END + ")|'''[\\s\\S]*?(?:'''|" + END + "))", "str"], ["[rRbBfFuU]{0,2}(?:" + DQ + "|" + SQ + ")", "str"], ["@[A-Za-z_][\\w.]*", "attr"], [NUM, "num"], [WORD, "word"]], kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return self cls try while with yield int str float bool list dict set tuple bytes"), calls: true, types: true },
    yaml: { rules: [[HASH, "com"], ["\\{\\{[\\s\\S]*?(?:\\}\\}|" + END + ")", "fn"], ["(?<=^[ \\t]*(?:- )*)[^\\s:#'\"{}\\[\\],&*!|>-][^:#\\n]*?(?=:(?:[ \\t]|$))", "key"], ["(?<=^[ \\t]*(?:- )*)(?:" + DQ + "|" + SQ + ")(?=:(?:[ \\t]|$))", "key"], [DQ + "|" + SQ, "str"], ["^---$|^\\.\\.\\.$|[&*][\\w-]+|![\\w!/.-]+", "attr"], ["-?" + NUM, "num"], [WORD, "word"]], lit: words(LIT + " yes no on off ~") },
    sh: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], ["\\$\\{[^}\\n]*\\}|\\$[\\w@#?$!*-]", "key"], ["(?<=\\s|^)--?[\\w-]+", "attr"], [NUM, "num"], ["[A-Za-z_][\\w-]*", "word"]], kw: words("if then else elif fi for while until do done case esac in function return export local readonly set unset echo exit source alias sudo cd break continue shift trap eval exec") },
    docker: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], ["\\$\\{[^}\\n]*\\}|\\$\\w+", "key"], ["(?<=^[ \\t]*)[A-Za-z]+(?=[ \\t])", "kw"], ["(?<=\\s)--[\\w-]+", "attr"], [NUM, "num"]] },
    ini: { rules: [[HASH + "|(?<=^[ \\t]*);[^\\n]*", "com"], ["(?<=^[ \\t]*)\\[[^\\]\\n]*\\]", "type"], ["(?<=^[ \\t]*(?:export[ \\t]+)?)[\\w.\\-\\/]+(?=[ \\t]*[=:])", "key"], ['"""[\\s\\S]*?(?:"""|' + END + ")", "str"], [DQ + "|" + SQ, "str"], ["\\$\\{[^}\\n]*\\}", "attr"], ["(?<=^[ \\t]*)[\\w.\\-\\[\\]]+(?=[ \\t]*(?:[=<>~!]=|[<>]|$))", "key"], [NUM, "num"], [WORD, "word"]], lit: words(LIT) },
    hcl: { rules: [[HASH + "|" + SLASH + "|" + BLOCK, "com"], ["<<-?EO[FT][\\s\\S]*?^[ \\t]*EO[FT]$", "str"], [DQ, "str"], ["[\\w-]+(?=[ \\t]*=(?!=))", "key"], [NUM, "num"], [WORD, "word"]], kw: words("resource data variable output provider module locals terraform backend required_providers for_each count depends_on dynamic content lifecycle for in if moved import check"), calls: true },
    sql: { rules: [["--[^\\n]*|" + BLOCK, "com"], [SQ, "str"], ['"(?:[^"\\n])*"|`[^`\\n]*`', "key"], [NUM, "num"], [WORD, "word"]], kw: words("select from where insert into values update set delete create table alter drop index primary key foreign references not null and or join left right inner outer full cross on group by order having limit offset as distinct union all case when then else end default unique constraint if exists in is like ilike between returning with view begin commit rollback grant revoke cascade asc desc count sum avg min max integer int bigint text varchar boolean timestamp serial"), ci: true, calls: true },
    markup: { rules: [["<!--[\\s\\S]*?(?:-->|" + END + ")", "com"], ["<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|" + END + ")", "str"], ["<[?!][\\w-]*", "kw"], ["(?<=<\\/?)[\\w:.-]+", "tag"], ["(?<=<[^<>]*\\s)[\\w:.@-]+(?=\\s*=)", "attr"], ["(?<=<[^<>]*=\\s*)(?:" + DQ + "|" + SQ + ")", "str"], ["&#?\\w+;", "num"]] },
    css: { rules: [[BLOCK, "com"], [DQ + "|" + SQ, "str"], ["@[\\w-]+", "kw"], ["--[\\w-]+|[\\w-]+(?=\\s*:[^;{]*[;}\\n])", "key"], ["#[\\da-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:%|[a-z]+)?", "num"], ["[.#][\\w-]+", "type"], ["[\\w-]+(?=\\()", "fn"]] },
    markdown: { rules: [["^```[\\s\\S]*?(?:^```|" + END + ")", "str"], ["^#{1,6}[ \\t].*", "kw"], ["`[^`\\n]+`", "str"], ["\\[[^\\]\\n]*\\]\\([^)\\n]*\\)", "fn"], ["\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__", "type"], ["^[ \\t]*(?:[-*+]|\\d+\\.)(?=[ \\t])|^>.*|^\\|.*", "attr"]] },
    http: { rules: [["^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\b|^HTTP\\/[\\d.]+", "kw"], ["^[\\w-]+(?=:)", "key"], [DQ, "str"], [NUM, "num"]] },
    nginx: { rules: [[HASH, "com"], [DQ + "|" + SQ, "str"], ["\\$\\w+", "key"], ["(?<=^[ \\t]*)[a-z_]+(?=[ \\t;{])", "kw"], [NUM, "num"]] },
    ignore: { rules: [[HASH, "com"], ["^!", "kw"], ["\\*\\*?|\\?", "attr"]] }
  };
  const ALIASES = {
    typescript: "c", javascript: "c", tsx: "c", jsx: "c", typescriptreact: "c", javascriptreact: "c", java: "c", kotlin: "c", csharp: "c", dart: "c", swift: "c", go: "c", groovy: "c", php: "c", prisma: "c", rust: "c", cpp: "c", c: "c", scala: "c", graphql: "c", protobuf: "c",
    json: "json", jsonl: "json", jsonc: "json", python: "python", ruby: "python", yaml: "yaml", yml: "yaml", helm: "yaml",
    shell: "sh", shellscript: "sh", bash: "sh", sh: "sh", zsh: "sh", powershell: "sh", makefile: "sh", dockerfile: "docker",
    ini: "ini", properties: "ini", dotenv: "ini", toml: "ini", "pip-requirements": "ini", terraform: "hcl", hcl: "hcl",
    sql: "sql", xml: "markup", html: "markup", svg: "markup", vue: "markup", css: "css", scss: "css", less: "css",
    markdown: "markdown", http: "http", nginx: "nginx", ignore: "ignore"
  };
  const LANGUAGE_NAMES = { typescript: "TypeScript", javascript: "JavaScript", tsx: "TSX", jsx: "JSX", json: "JSON", jsonl: "JSON Lines", yaml: "YAML", xml: "XML", csharp: "C#", php: "PHP", css: "CSS", html: "HTML", sql: "SQL", http: "HTTP", toml: "TOML", hcl: "HCL", dotenv: ".env", ignore: "Ignore file", shellscript: "Shell", "pip-requirements": "Requirements", text: "Text", plaintext: "Text" };
  const compiled = {};

  function languageName(language) {
    if (!language) return "";
    return LANGUAGE_NAMES[language] || language.charAt(0).toUpperCase() + language.slice(1);
  }

  function lexer(language) {
    const id = ALIASES[String(language || "").toLowerCase()];
    if (!id) return null;
    if (!compiled[id]) {
      const spec = LANGS[id];
      compiled[id] = Object.assign({}, spec, { re: new RegExp(spec.rules.map(r => "(" + r[0].replace(/(?<!\\)\((?!\?)/g, "(?:") + ")").join("|"), "gm") });
    }
    return compiled[id];
  }

  function classify(lex, token, source, end) {
    const key = lex.ci ? token.toLowerCase() : token;
    if (lex.lit && lex.lit.has(token)) return "lit";
    if (!lex.lit && LIT_SET.has(token)) return "lit";
    if (lex.kw && lex.kw.has(key)) return "kw";
    if (lex.calls && /^\s*\(/.test(source.slice(end, end + 40))) return "fn";
    if (lex.types && /^[A-Z][a-z0-9]\w*$/.test(token)) return "type";
    return "";
  }

  // Fills `pre` with highlighted source; stops highlighting after many tokens.
  function highlight(pre, source, language) {
    const lex = lexer(language);
    if (!lex) { pre.textContent = source; return; }
    const re = lex.re;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let offset = 0, plain = "", match, count = 0;
    const flush = () => { if (plain) { frag.append(document.createTextNode(plain)); plain = ""; } };
    while (count++ < 40000 && (match = re.exec(source))) {
      if (!match[0]) { re.lastIndex++; continue; }
      plain += source.slice(offset, match.index);
      offset = re.lastIndex;
      let group = 1;
      while (match[group] === undefined) group++;
      let cls = lex.rules[group - 1][1];
      if (cls === "word") cls = classify(lex, match[0], source, re.lastIndex);
      if (!cls) { plain += match[0]; continue; }
      flush();
      const span = document.createElement("span");
      span.className = "tk-" + cls;
      span.textContent = match[0];
      frag.append(span);
    }
    plain += source.slice(offset);
    flush();
    pre.append(frag);
  }

  function lineCount(text) {
    if (!text) return 0;
    let n = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
    return text.endsWith("\n") ? n - 1 : n;
  }

  // A scrollable code block with a sticky line-number gutter. Wrap applies to
  // every block on the page and is remembered across reloads.
  function codePreview(content, language) {
    const source = shown(content);
    const lines = lineCount(source);
    const pre = h("pre", { class: "code" });
    highlight(pre, source, language);
    const gutter = lines > 1 ? h("div", { class: "gutter", "aria-hidden": "true", text: Array.from({ length: lines }, (_, i) => i + 1).join("\n") }) : null;
    const view = h("div", { class: "codeview" + (wrapCode ? " wrap" : ""), tabindex: "0", role: "region", "aria-label": `${languageName(language) || "Code"} preview, ${lines} line${lines === 1 ? "" : "s"}` }, h("div", { class: "code-body" }, gutter, pre));
    if (gutter) view.style.setProperty("--gutter", String(lines).length + 1.6 + "ch");
    view.addEventListener("keydown", event => {
      // Select-all inside a focused block selects just that code.
      if (event.key === "a" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
    return view;
  }

  function setWrap(on) {
    wrapCode = on;
    for (const v of document.querySelectorAll(".codeview")) v.classList.toggle("wrap", on);
    for (const b of document.querySelectorAll(".wrap-toggle")) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    persist();
  }

  function wrapButton() {
    const b = button("Wrap", "wrap", () => setWrap(!wrapCode), "ghost wrap-toggle" + (wrapCode ? " on" : ""), "Wrap long lines");
    b.setAttribute("aria-pressed", String(wrapCode));
    return b;
  }

  function expandButton(view) {
    const b = button("Expand", "expand", () => {
      const on = view.classList.toggle("expanded");
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.querySelector("span").textContent = on ? "Collapse" : "Expand";
      if (!on) view.scrollTop = 0;
    }, "ghost", "Show the whole output without an inner scroll area");
    b.setAttribute("aria-pressed", "false");
    return b;
  }

  function codeSub(fileName, title, language, content) {
    const lines = lineCount(content);
    return [fileName && fileName !== title ? fileName : "", languageName(language), lines > 1 ? `${lines.toLocaleString()} lines` : ""].filter(Boolean).join(" · ");
  }

  function renderOutput(o) {
    if (o.kind === "code") {
      const view = codePreview(o.content, o.language);
      const tall = lineCount(shown(o.content)) > 24;
      return h("section", { class: "panel out" }, outHead(o.title, codeSub(o.fileName, o.title, o.language, o.content), [wrapButton(), tall ? expandButton(view) : null, h("span", { class: "sep", "aria-hidden": "true" }), ...codeActions(o.content, o.language, o.fileName, o.title)]), view, truncatedNote(o.content));
    }
    if (o.kind === "text") {
      return h("section", { class: "panel out" }, outHead(o.title, null, [button("Copy", "copy", () => vscode.postMessage({ type: "copy", text: o.content }), "ghost"), capabilities.saveAs ? button("", "download", () => vscode.postMessage({ type: "download", text: o.content, language: "text", fileName: o.title }), "ghost", "Save as…") : null]), h("div", { class: "textout", text: shown(o.content) }), truncatedNote(o.content));
    }
    if (o.kind === "table") {
      const csv = [o.columns, ...o.rows].map(r => r.map(c => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
      const md = [`| ${o.columns.join(" | ")} |`, `| ${o.columns.map(() => "---").join(" | ")} |`, ...o.rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`)].join("\n");
      const body = o.rows.slice(0, 2000).map(r => h("tr", null, r.map(c => h("td", { class: typeof c === "number" ? "num" : "", text: typeof c === "number" ? c.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(c) }))));
      return h("section", { class: "panel out" },
        outHead(o.title, `${o.rows.length} row${o.rows.length === 1 ? "" : "s"}`, [button("CSV", "copy", () => vscode.postMessage({ type: "copy", text: csv }), "ghost", "Copy as CSV"), button("Markdown", "copy", () => vscode.postMessage({ type: "copy", text: md }), "ghost", "Copy as a Markdown table"), capabilities.saveAs ? button("", "download", () => vscode.postMessage({ type: "download", text: csv, language: "csv", fileName: `${o.title}.csv` }), "ghost", "Save as CSV…") : null]),
        h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, o.columns.map(c => h("th", { scope: "col", text: c })))), h("tbody", null, body))),
        o.rows.length > 2000 ? h("div", { class: "truncated", text: `Showing 2,000 of ${o.rows.length.toLocaleString()} rows; copy to get all of them.` }) : null);
    }
    if (o.kind === "files") {
      const list = h("div", { class: "files" }, o.files.map((file, i) => {
        const size = new Blob([file.content]).size;
        const details = h("details", { class: "file" },
          h("summary", null, icon("chevron", "chev"), icon("file"), h("span", { class: "path", text: file.path }), h("span", { class: "meta", text: `${file.mode === "append" ? "append · " : ""}${lineCount(file.content).toLocaleString()} lines · ${size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB"}` }),
            h("span", { class: "out-actions", onclick: e => e.preventDefault() }, codeActions(file.content, file.language, null).slice(0, 1).concat([button("", "open", () => vscode.postMessage({ type: "open", text: file.content, language: file.language }), "ghost", `Open ${file.path} in a new tab`), capabilities.writeWorkspace ? button("", "save", () => vscode.postMessage({ type: "save", files: [file] }), "ghost", `Save ${file.path} to the workspace`) : null]))),
          h("div", { class: "file-preview" }));
        details.addEventListener("toggle", () => {
          const preview = details.querySelector(".file-preview");
          if (details.open && !preview.childNodes.length) preview.append(codePreview(file.content, file.language), truncatedNote(file.content) || document.createTextNode(""));
        });
        if (i === 0 && o.files.length <= 3) details.open = true;
        return details;
      }));
      return h("section", { class: "panel out" }, outHead(o.title, `${o.files.length} file${o.files.length === 1 ? "" : "s"}`, [wrapButton(), capabilities.writeWorkspace ? button(o.files.length > 1 ? `Write all ${o.files.length}` : "Write to workspace", "save", () => vscode.postMessage({ type: "writeAll", files: o.files }), "ghost", "Write the files into the workspace (asks before overwriting)") : null]), list);
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
          tool.live ? h("span", { class: "badge" }, icon("spark"), "Live preview available") : null)));
    const guide = tool.guide ? h("details", { class: "guide" }, h("summary", null, icon("chevron"), "How it works"), h("p", { text: tool.guide })) : null;

    runButton = h("button", { type: "button", class: "btn", onclick: () => runIfReady("run") });
    actionButtons = (tool.actions || []).map(a => button(a.label, null, () => runIfReady("action", a.id), "secondary"));
    const mod = data.mac ? "⌘" : "Ctrl";
    const form = h("section", { class: "panel form", "aria-label": "Inputs" },
      h("div", { class: "toolbar" }, presetsSelect(), h("span", { class: "grow" }), button("Reset", "reset", () => {
        ++seq; ++inputRevision; clearTimeout(liveTimer); setRunning(false);
        for (const f of tool.fields) setValue(f.id, defaults[f.id], false);
        updateVisibility(); persist(); hasResult = false; renderEmpty(missingRequired());
        // Reset leaves the output empty, including in live preview mode.
      }, "ghost", "Reset every field to its default")),
      h("div", { class: "fields" }, tool.fields.flatMap(f => {
        const row = (rows[f.id] = buildField(f));
        if (!f.group) return [row];
        const heading = (groupHeadings[f.id] = h("div", { class: "group-heading", role: "heading", "aria-level": "3", text: f.group }));
        return [heading, row];
      })),
      h("div", { class: "run-row" }, runButton, actionButtons, h("span", { class: "hint" }, h("kbd", { text: mod }), " ", h("kbd", { text: "Enter" }), tool.live ? h("label", { class: "hint" }, h("input", { type: "checkbox", "aria-label": "Live preview", onchange: event => {
        liveEnabled = event.target.checked;
        clearTimeout(liveTimer);
        if (!liveEnabled && running) { ++seq; setRunning(false); hasResult = false; renderEmpty(missingRequired()); }
        if (!hasResult && !running) renderEmpty(missingRequired());
      } }), " Live preview (updates on input changes)") : "")));
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
        if (!running || msg.requestId !== seq) return; // an older run finished late
        setRunning(false);
        renderResult(msg);
        break;
      case "editorText":
        if (!controls[msg.field]) return;
        setValue(msg.field, msg.text, false);
        onChange(msg.field, msg.text);
        toast("success", `Loaded ${msg.source}.`);

        break;
      case "setValues":
        ++inputRevision;
        if (hasResult || running) execution(running ? "running" : "stale", running ? "Running for earlier inputs… Run again after completion to use your changes." : "Inputs changed · previous result. Run again to update.");
        for (const [k, v] of Object.entries(pickKnown(msg.values))) setValue(k, v, false);
        updateVisibility();
        persist();
        // Incoming values populate inputs; only Run or opted-in live edits execute.
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
  // Always start empty, even when defaults or editor input are provided.
})();
