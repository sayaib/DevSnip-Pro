// DevSnip Pro Tools sidebar: renders the categories from #sidebar-data,
// filters them as you type, and runs a tool by posting its command id to the
// extension (which only accepts ids from the sidebar's own list).
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const data = JSON.parse(document.getElementById("sidebar-data").textContent);
  const saved = vscode.getState() || {};

  const tree = document.getElementById("tree");
  const search = document.getElementById("search");
  const clearSearch = document.getElementById("clearSearch");
  const empty = document.getElementById("empty");
  const announce = document.getElementById("announce");

  const expanded = new Set(data.expanded);
  let selected = typeof saved.selected === "string" ? saved.selected : null;
  let focusedKey = null;
  let query = typeof saved.query === "string" ? saved.query : "";

  function persist() {
    vscode.setState({ selected, query });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function codicon(name, extra) {
    const icon = el("span", "codicon codicon-" + name + (extra ? " " + extra : ""));
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  /** Appends text to a node, wrapping the matched part in a highlight. */
  function appendHighlighted(node, text, term) {
    const index = term ? text.toLowerCase().indexOf(term) : -1;
    if (index < 0) {
      node.textContent = text;
      return;
    }
    node.appendChild(document.createTextNode(text.slice(0, index)));
    node.appendChild(el("span", "hl", text.slice(index, index + term.length)));
    node.appendChild(document.createTextNode(text.slice(index + term.length)));
  }

  /* ------------------------------------------------------------ status */
  function renderStatus(status) {
    document.getElementById("statusBadge").textContent = status.badge;
    document.getElementById("statusLevel").textContent = status.level;
    document.getElementById("statusPoints").textContent = status.points.toLocaleString() + " pts";
    document.getElementById("statusNext").textContent = status.nextLevel
      ? status.toNext.toLocaleString() + " to " + status.nextLevel
      : "Top level reached";
    document.getElementById("statusFill").style.width = Math.round(status.progress * 100) + "%";
    document.getElementById("status").title =
      status.level + " level - " + status.lifetimePoints.toLocaleString() + " points earned in total, " +
      status.points.toLocaleString() + " available to spend. Select to open the Milestone & Points Tracker.";
  }

  /* ------------------------------------------------------------ tree */
  function visibleRows() {
    return Array.prototype.filter.call(tree.querySelectorAll(".row"), row => row.offsetParent !== null);
  }

  function setFocus(row, move) {
    tree.querySelectorAll(".row").forEach(r => {
      r.tabIndex = -1;
      r.classList.remove("focused");
    });
    if (!row) return;
    row.tabIndex = 0;
    row.classList.add("focused");
    focusedKey = row.dataset.key;
    if (move) {
      row.focus();
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function render() {
    const term = query.trim().toLowerCase();
    tree.innerHTML = "";
    let matches = 0;

    data.groups.forEach((group, groupIndex) => {
      const groupMatches = term && group.name.toLowerCase().includes(term);
      const tools = term && !groupMatches
        ? group.tools.filter(tool => tool.label.toLowerCase().includes(term))
        : group.tools;
      if (term && !tools.length) return;
      matches += term ? tools.length : 0;

      // While searching every matching category is open; otherwise the saved state applies.
      const open = term ? true : expanded.has(group.name);
      const holdsSelection = group.tools.some(tool => tool.command === selected);

      const wrap = el("div", "group" + (holdsSelection ? " current" : ""));
      wrap.style.setProperty("--cat", "var(" + group.colorVar + ", var(--vscode-icon-foreground, currentColor))");

      const head = el("div", "row cat" + (holdsSelection ? " current" : ""));
      head.setAttribute("role", "treeitem");
      head.setAttribute("aria-level", "1");
      head.setAttribute("aria-expanded", open ? "true" : "false");
      head.setAttribute("aria-setsize", String(data.groups.length));
      head.setAttribute("aria-posinset", String(groupIndex + 1));
      head.dataset.key = "group:" + group.name;
      head.dataset.group = group.name;
      head.title = group.name + " - " + group.tools.length + " tools";
      head.appendChild(codicon("chevron-right", "twistie"));
      head.appendChild(codicon(group.icon, "cat-icon"));
      const headLabel = el("span", "label");
      appendHighlighted(headLabel, group.name, groupMatches ? term : "");
      head.appendChild(headLabel);
      const count = el("span", "count", term && !groupMatches ? String(tools.length) : String(group.tools.length));
      count.setAttribute("aria-hidden", "true");
      head.appendChild(count);
      head.addEventListener("click", () => {
        setFocus(head, false);
        toggleGroup(group.name);
      });
      wrap.appendChild(head);

      const children = el("div", "children");
      children.setAttribute("role", "group");
      if (!open) children.hidden = true;
      tools.forEach((tool, toolIndex) => {
        const row = el("div", "row tool" + (tool.command === selected ? " selected" : ""));
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", "2");
        row.setAttribute("aria-setsize", String(tools.length));
        row.setAttribute("aria-posinset", String(toolIndex + 1));
        row.setAttribute("aria-selected", tool.command === selected ? "true" : "false");
        row.dataset.key = "tool:" + tool.command;
        row.dataset.command = tool.command;
        row.dataset.group = group.name;
        row.title = tool.label + " (" + group.name + ")";
        row.appendChild(codicon(tool.icon));
        const label = el("span", "label");
        appendHighlighted(label, tool.label, groupMatches ? "" : term);
        row.appendChild(label);
        row.addEventListener("click", () => {
          setFocus(row, false);
          runTool(tool.command);
        });
        children.appendChild(row);
      });
      wrap.appendChild(children);
      tree.appendChild(wrap);
    });

    const nothing = Boolean(term) && !tree.children.length;
    empty.hidden = !nothing;
    document.getElementById("emptyQuery").textContent = query.trim();
    clearSearch.hidden = !query;
    if (term) announce.textContent = nothing ? "No tools match" : matches + (matches === 1 ? " tool matches" : " tools match");

    // Keep exactly one row in the tab order.
    const rows = visibleRows();
    const keep = rows.find(row => row.dataset.key === focusedKey)
      || rows.find(row => row.classList.contains("selected"))
      || rows[0];
    setFocus(keep, false);
  }

  function toggleGroup(name, force) {
    // Rendering replaces the rows, so note whether the keyboard was in the tree first.
    const hadFocus = Boolean(document.activeElement && tree.contains(document.activeElement));
    const open = force === undefined ? !expanded.has(name) : force;
    if (query.trim()) {
      // While filtering, categories are always open; collapsing one clears the filter for it.
      if (!open) {
        query = "";
        search.value = "";
        expanded.delete(name);
      } else return;
    } else if (open) expanded.add(name);
    else expanded.delete(name);
    vscode.postMessage({ type: "expanded", groups: Array.from(expanded) });
    persist();
    render();
    const head = tree.querySelector('.cat[data-group="' + CSS.escape(name) + '"]');
    if (head) setFocus(head, hadFocus);
  }

  function runTool(command) {
    selected = command;
    persist();
    tree.querySelectorAll(".tool").forEach(row => {
      const on = row.dataset.command === command;
      row.classList.toggle("selected", on);
      row.setAttribute("aria-selected", on ? "true" : "false");
    });
    tree.querySelectorAll(".group").forEach(group => {
      const head = group.querySelector(".cat");
      const on = data.groups.some(g => g.name === head.dataset.group && g.tools.some(t => t.command === command));
      group.classList.toggle("current", on);
      head.classList.toggle("current", on);
    });
    vscode.postMessage({ type: "run", command });
  }

  /* ------------------------------------------------------------ keyboard */
  tree.addEventListener("keydown", event => {
    const rows = visibleRows();
    const current = document.activeElement && document.activeElement.classList.contains("row") ? document.activeElement : null;
    if (!current) return;
    const index = rows.indexOf(current);
    const isGroup = current.classList.contains("cat");
    const groupName = current.dataset.group;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setFocus(rows[Math.min(rows.length - 1, index + 1)], true);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (index === 0) search.focus();
        else setFocus(rows[index - 1], true);
        break;
      case "Home":
        event.preventDefault();
        setFocus(rows[0], true);
        break;
      case "End":
        event.preventDefault();
        setFocus(rows[rows.length - 1], true);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (isGroup && current.getAttribute("aria-expanded") !== "true") toggleGroup(groupName, true);
        else if (isGroup && rows[index + 1] && rows[index + 1].classList.contains("tool")) setFocus(rows[index + 1], true);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (isGroup && current.getAttribute("aria-expanded") === "true") toggleGroup(groupName, false);
        else if (!isGroup) setFocus(tree.querySelector('.cat[data-group="' + CSS.escape(groupName) + '"]'), true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isGroup) toggleGroup(groupName);
        else runTool(current.dataset.command);
        break;
      default:
        // Typing a letter jumps to search, like VS Code's type-to-filter.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          search.focus();
        }
    }
  });

  /* ------------------------------------------------------------ search */
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    focusedKey = null;
    persist();
    render();
  });
  search.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocus(visibleRows()[0], true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = tree.querySelector(".tool");
      if (query.trim() && first) runTool(first.dataset.command);
      else if (query.trim()) vscode.postMessage({ type: "searchAll" });
    } else if (event.key === "Escape" && search.value) {
      event.preventDefault();
      search.value = "";
      query = "";
      persist();
      render();
    }
  });
  clearSearch.addEventListener("click", () => {
    search.value = "";
    query = "";
    persist();
    render();
    search.focus();
  });
  document.getElementById("searchAll").addEventListener("click", () => vscode.postMessage({ type: "searchAll" }));
  document.getElementById("emptySearchAll").addEventListener("click", () => vscode.postMessage({ type: "searchAll" }));
  document.getElementById("status").addEventListener("click", () => vscode.postMessage({ type: "run", command: data.milestoneCommand }));

  document.addEventListener("keydown", event => {
    if (event.key === "/" && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });

  window.addEventListener("message", event => {
    const message = event.data || {};
    if (message.type === "status" && message.status) renderStatus(message.status);
  });

  renderStatus(data.status);
  render();
})();
