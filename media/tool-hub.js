// Tool hub grid: search, category filter, pinning and keyboard navigation.
// Data comes from the #hub-data JSON block rendered by src/utils/tool-hub.ts.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi(); // may only be called once per page
  const data = JSON.parse(document.getElementById("hub-data").textContent);
  const saved = vscode.getState() || {};

  const state = {
    query: typeof saved.query === "string" ? saved.query : "",
    // A section requested by the command that opened the hub wins over the last saved filter.
    category: data.initialCategory || (data.categories.includes(saved.category) || saved.category === "Pinned" ? saved.category : "All"),
    pinned: new Set(data.pinned)
  };

  const el = {
    search: document.getElementById("search"),
    chips: document.getElementById("chips"),
    results: document.getElementById("results"),
    empty: document.getElementById("empty"),
    emptyQuery: document.getElementById("emptyQuery"),
    status: document.getElementById("status"),
    count: document.getElementById("hubCount")
  };

  const ARROW = '<path d="M5 12h14M13 6l6 6-6 6"/>';
  const STAR = '<path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.6l-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z"/>';

  /** Category colour, cycling through the theme's chart colours. */
  const colorOf = category => `var(--c${Math.max(0, data.categories.indexOf(category)) % 6})`;

  function svg(paths) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("aria-hidden", "true");
    node.innerHTML = paths; // trusted: icons are fixed strings from the extension
    return node;
  }

  function normalise(text) {
    return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  }

  /** Every term must appear somewhere; title matches rank first. */
  function score(tool, terms) {
    if (!terms.length) return 1;
    const title = normalise(tool.title);
    const haystack = normalise([tool.title, tool.description, tool.tag || "", tool.category, (tool.keywords || []).join(" ")].join(" "));
    let total = 0;
    for (const term of terms) {
      if (!haystack.includes(term)) return 0;
      total += title.startsWith(term) ? 6 : title.includes(term) ? 4 : normalise(tool.tag || "").includes(term) ? 2 : 1;
    }
    return total;
  }

  /** Appends text to a node, wrapping query matches in <mark>. */
  function highlight(node, text, terms) {
    if (!terms.length) { node.textContent = text; return; }
    const lower = normalise(text);
    const marks = [];
    for (const term of terms) {
      let from = 0;
      let at;
      while (term && (at = lower.indexOf(term, from)) !== -1) { marks.push([at, at + term.length]); from = at + term.length; }
    }
    marks.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [start, end] of marks) {
      if (start < cursor) continue;
      node.append(text.slice(cursor, start));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(start, end);
      node.append(mark);
      cursor = end;
    }
    node.append(text.slice(cursor));
  }

  function card(tool, terms) {
    const wrap = document.createElement("div");
    wrap.className = "card-wrap";
    wrap.style.setProperty("--cat", colorOf(tool.category));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.dataset.command = tool.command;
    button.title = tool.description;
    button.setAttribute("aria-label", `${tool.title}. ${tool.description}`);

    const head = document.createElement("span");
    head.className = "card-head";
    const icon = document.createElement("span");
    icon.className = "card-icon";
    icon.append(svg(data.icons[tool.icon] || data.icons.code));
    const title = document.createElement("span");
    title.className = "card-title";
    highlight(title, tool.title, terms);
    head.append(icon, title);

    const desc = document.createElement("p");
    desc.className = "card-desc";
    highlight(desc, tool.description, terms);

    const foot = document.createElement("span");
    foot.className = "card-foot";
    const tag = document.createElement("span");
    tag.className = "tag" + (tool.tag === "Live" ? " live" : tool.tag === "Uses network" ? " net" : "");
    tag.textContent = tool.tag || "";
    const open = document.createElement("span");
    open.className = "open";
    open.append("Open", svg(ARROW));
    foot.append(tag, open);

    button.append(head, desc, foot);
    button.addEventListener("click", () => vscode.postMessage({ command: "openTool", toolCommand: tool.command }));

    const pinned = state.pinned.has(tool.command);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin";
    pin.setAttribute("aria-pressed", String(pinned));
    pin.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${tool.title}`);
    pin.title = pinned ? "Unpin" : "Pin to top";
    pin.append(svg(STAR));
    pin.addEventListener("click", event => {
      event.stopPropagation();
      togglePin(tool.command);
    });

    wrap.append(button, pin);
    return wrap;
  }

  function group(title, tools, terms, color) {
    const section = document.createElement("section");
    section.className = "group";
    section.style.setProperty("--cat", color);
    const heading = document.createElement("h2");
    heading.className = "group-title";
    heading.append(title + " ");
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = String(tools.length);
    heading.append(n);
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const tool of tools) grid.append(card(tool, terms));
    section.append(heading, grid);
    return section;
  }

  function renderChips() {
    const counts = new Map(data.categories.map(c => [c, 0]));
    for (const t of data.tools) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    const entries = [["All", data.tools.length]];
    if (state.pinned.size) entries.push(["Pinned", state.pinned.size]);
    for (const c of data.categories) entries.push([c, counts.get(c)]);
    if (state.category === "Pinned" && !state.pinned.size) state.category = "All";
    el.chips.replaceChildren(...entries.map(([name, count]) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("aria-pressed", String(state.category === name));
      chip.append(name + " ");
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(count);
      chip.append(n);
      chip.addEventListener("click", () => { state.category = name; update(); });
      return chip;
    }));
  }

  function render() {
    const terms = normalise(state.query).split(/\s+/).filter(Boolean);
    const matches = data.tools
      .map((tool, index) => ({ tool, index, s: score(tool, terms) }))
      .filter(m => m.s > 0)
      .filter(m => state.category === "All" || (state.category === "Pinned" ? state.pinned.has(m.tool.command) : m.tool.category === state.category));
    const sections = [];
    if (terms.length) {
      // Searching: one ranked list, best matches first.
      matches.sort((a, b) => b.s - a.s || a.index - b.index);
      if (matches.length) sections.push(group(`Results`, matches.map(m => m.tool), terms, "var(--accent)"));
    } else if (state.category === "All") {
      const pinned = data.tools.filter(t => state.pinned.has(t.command));
      if (pinned.length) sections.push(group("Pinned", pinned, terms, "var(--vscode-charts-yellow, #cca700)"));
      for (const category of data.categories) {
        const tools = matches.filter(m => m.tool.category === category).map(m => m.tool);
        if (tools.length) sections.push(group(category, tools, terms, colorOf(category)));
      }
    } else if (matches.length) {
      sections.push(group(state.category, matches.map(m => m.tool), terms, state.category === "Pinned" ? "var(--vscode-charts-yellow, #cca700)" : colorOf(state.category)));
    }
    el.results.replaceChildren(...sections);
    el.empty.hidden = matches.length > 0;
    el.emptyQuery.textContent = state.query.trim() || state.category;
    const filtered = terms.length || state.category !== "All";
    el.count.textContent = filtered
      ? `${matches.length} of ${data.tools.length} tools`
      : `${data.tools.length} tools · ${data.categories.length} categories`;
    el.status.textContent = filtered ? `${matches.length} tool${matches.length === 1 ? "" : "s"} shown` : "";
  }

  /** The "Start here" path of the selected section; hidden while searching so it never hides results. */
  let journeyFor = null;
  function renderJourney() {
    const box = document.getElementById("journey");
    const steps = (data.journeys || {})[state.category] || [];
    const show = steps.length > 0 && !state.query.trim();
    box.hidden = !show;
    if (!show || journeyFor === state.category) return;
    journeyFor = state.category;
    box.replaceChildren();
    const head = document.createElement("div");
    head.className = "journey-head";
    const title = document.createElement("h2");
    title.textContent = "New to this? Start here";
    const text = document.createElement("p");
    text.textContent = "A step-by-step path through the tools.";
    head.append(title, text);
    const list = document.createElement("ol");
    list.className = "steps";
    for (const step of steps) {
      const item = document.createElement("li");
      item.className = "step";
      const b = document.createElement("button");
      b.type = "button";
      const t = document.createElement("span");
      t.className = "step-title";
      t.textContent = step.title;
      const d = document.createElement("span");
      d.className = "step-text";
      d.textContent = step.text;
      b.append(t, d);
      b.addEventListener("click", () => vscode.postMessage({ command: "openTool", toolCommand: step.command }));
      item.append(b);
      list.append(item);
    }
    box.append(head, list);
  }

  function update() {
    vscode.setState({ query: state.query, category: state.category });
    renderChips();
    renderJourney();
    render();
  }

  function togglePin(command) {
    if (state.pinned.has(command)) state.pinned.delete(command); else state.pinned.add(command);
    // Keep the hub's own order so pinned cards do not jump around.
    const ordered = data.tools.map(t => t.command).filter(c => state.pinned.has(c));
    vscode.postMessage({ command: "setPinned", pinned: ordered });
    const focusedCommand = document.activeElement && document.activeElement.closest(".card-wrap")?.querySelector(".card")?.dataset.command;
    update();
    // Put focus back on the same card's pin so keyboard users do not lose their place.
    if (focusedCommand) {
      const again = [...document.querySelectorAll(".card")].find(c => c.dataset.command === focusedCommand);
      again?.parentElement.querySelector(".pin")?.focus();
    }
  }

  // ---- Keyboard ----------------------------------------------------------

  /** Arrow keys move between cards the way they are laid out on screen. */
  function moveFocus(from, key) {
    const cards = [...document.querySelectorAll(".card")];
    const index = cards.indexOf(from);
    if (index < 0) return;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      cards[Math.min(cards.length - 1, Math.max(0, index + (key === "ArrowRight" ? 1 : -1)))].focus();
      return;
    }
    const here = from.getBoundingClientRect();
    const down = key === "ArrowDown";
    let best = null;
    let bestScore = Infinity;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const dy = down ? r.top - here.bottom : here.top - r.bottom;
      if (dy < -1) continue;
      const scoreValue = dy * 4 + Math.abs(r.left - here.left);
      if (c !== from && scoreValue < bestScore) { best = c; bestScore = scoreValue; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: "nearest" }); }
  }

  document.addEventListener("keydown", event => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      el.search.focus();
      el.search.select();
    } else if (event.key === "Escape" && target === el.search) {
      if (el.search.value) { el.search.value = ""; state.query = ""; update(); } else el.search.blur();
    } else if (event.key === "ArrowDown" && target === el.search) {
      event.preventDefault();
      document.querySelector(".card")?.focus();
    } else if (target instanceof HTMLElement && target.classList.contains("card") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      moveFocus(target, event.key);
    }
  });

  // Enter in the search box opens the best match.
  el.search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const first = document.querySelector(".card");
      if (first) { event.preventDefault(); first.click(); }
    }
  });

  let timer;
  el.search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = el.search.value; update(); }, 60);
  });
  document.getElementById("clearSearch").addEventListener("click", () => {
    el.search.value = "";
    state.query = "";
    state.category = "All";
    update();
    el.search.focus();
  });
  document.getElementById("searchAll").addEventListener("click", () => vscode.postMessage({ command: "searchAll" }));

  // The extension asks an open hub to show a section (an older hub command was run again).
  window.addEventListener("message", event => {
    const msg = event.data;
    if (msg && msg.command === "showCategory" && data.categories.includes(msg.category)) {
      state.category = msg.category;
      state.query = "";
      el.search.value = "";
      update();
    }
  });

  el.search.value = state.query;
  update();
})();
