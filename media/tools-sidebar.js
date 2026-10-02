// DevSnip Pro Tools sidebar.
//
// Renders the rank card and the tool navigation from #sidebar-data, handles
// search, filters, favorites and keyboard navigation, and runs a tool by
// posting its command id to the extension (which only accepts ids from the
// sidebar's own list).
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const data = JSON.parse(document.getElementById("sidebar-data").textContent);
  const saved = vscode.getState() || {};

  const $ = id => document.getElementById(id);
  const tree = $("tree");
  const search = $("search");
  const searchBox = $("searchBox");
  const clearSearch = $("clearSearch");
  const filterBtn = $("filterBtn");
  const filterMenu = $("filterMenu");
  const hovercard = $("hovercard");
  const rankTip = $("rankTip");
  const rankInfo = $("rankInfo");
  const announce = $("announce");

  const RECENT_IN_OVERVIEW = 3;
  const RECENT_LIMIT = 15;
  const HOVER_DELAY = 450;
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

  /** command -> { tool, group } */
  const toolIndex = new Map();
  data.groups.forEach(group => group.tools.forEach(tool => toolIndex.set(tool.command, { tool, group })));

  // Only one category is open at a time; older saved state may list several, so keep the most recent.
  const expanded = new Set(data.expanded.slice(-1));
  let favorites = data.favorites.filter(command => toolIndex.has(command));
  let usage = data.usage || {};
  let status = data.status;
  let selected = typeof saved.selected === "string" && toolIndex.has(saved.selected) ? saved.selected : null;
  let query = typeof saved.query === "string" ? saved.query : "";
  let filter = validFilter(saved.filter);
  let focusedKey = null;
  /** Categories collapsed by hand while a search is showing every match. */
  let searchCollapsed = new Set();

  function validFilter(value) {
    if (!value || typeof value !== "object") return { kind: "all" };
    if (["all", "favorites", "recent", "most"].includes(value.kind)) return { kind: value.kind };
    if (value.kind === "category" && data.groups.some(g => g.name === value.category)) return { kind: "category", category: value.category };
    return { kind: "all" };
  }

  function persist() {
    // Merge, so state kept by other parts of the page (the Get started card) survives.
    vscode.setState(Object.assign({}, vscode.getState() || {}, { selected, query, filter }));
  }

  /* ------------------------------------------------------------ helpers */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
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

  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + "m";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + "h";
    const days = Math.round(hours / 24);
    if (days < 30) return days + "d";
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function say(message) {
    announce.textContent = "";
    // A fresh node change makes screen readers announce repeated messages too.
    requestAnimationFrame(() => { announce.textContent = message; });
  }

  /* ------------------------------------------------------------ rank card */
  /** Below this share of a level left, the next rank is close enough to call out. */
  const CLOSE_CALL = 0.85;

  function renderStatus(next) {
    const previous = status;
    status = next;
    const percent = Math.round(status.progress * 100);
    $("statusBadge").textContent = status.badge;
    $("statusLevel").textContent = status.level;
    $("statusPoints").textContent = status.points.toLocaleString() + " pts";
    const nextLine = $("statusNext");
    nextLine.textContent = "";
    if (!status.nextLevel) nextLine.textContent = "Top rank reached";
    else if (status.progress >= CLOSE_CALL) nextLine.appendChild(el("span", "close-call", "Only " + status.toNext.toLocaleString() + " to " + status.nextLevel));
    else nextLine.textContent = status.toNext.toLocaleString() + " to " + status.nextLevel;
    $("statusPct").textContent = status.nextLevel ? percent + "%" : "";
    const meter = $("meter");
    meter.setAttribute("aria-valuenow", String(percent));
    meter.setAttribute("aria-valuetext", status.nextLevel
      ? percent + "% of the way to " + status.nextLevel + ", " + status.toNext.toLocaleString() + " points to go"
      : "Top rank reached");
    // Set after a frame so the bar grows into place on first paint.
    requestAnimationFrame(() => { $("statusFill").style.width = percent + "%"; });
    const summary = status.level + " rank, " + status.points.toLocaleString() + " points to spend";
    $("status").setAttribute("aria-label", summary + ". Open Milestones & rewards");
    $("status").title = summary + ".\nClick to see milestones, rewards and how to earn points.";
    $("rankCta").title = "Open Milestones & rewards";
    // Live feedback when points arrive, so the card feels connected to what you do.
    if (previous && previous !== next && status.lifetimePoints > previous.lifetimePoints) {
      const gain = $("statusGain");
      gain.textContent = "+" + (status.lifetimePoints - previous.lifetimePoints).toLocaleString();
      gain.classList.remove("show");
      void gain.offsetWidth;
      gain.classList.add("show");
      if (status.level !== previous.level) say("Rank up: you reached " + status.level + ".");
    }
    if (!rankTip.hidden) fillRankTip();
  }

  function fillRankTip() {
    rankTip.innerHTML = "";
    rankTip.appendChild(el("p", "pop-title", "How ranks work"));
    rankTip.appendChild(el("p", "pop-text",
      "Every point you earn moves you up, and spending points on premium tools never lowers your rank. " +
      "You have earned " + status.lifetimePoints.toLocaleString() + " points and have " +
      status.points.toLocaleString() + " to spend."));
    const list = el("ul", "levels");
    data.levels.forEach(level => {
      const item = el("li", (status.lifetimePoints >= level.minPoints ? "reached" : "") + (level.name === status.level ? " current" : ""));
      item.appendChild(el("span", "", level.badge));
      item.appendChild(el("span", "", level.name));
      item.appendChild(el("span", "pts", level.minPoints.toLocaleString()));
      list.appendChild(item);
    });
    rankTip.appendChild(list);
  }

  let rankTipPinned = false;
  function showRankTip(pin) {
    if (pin !== undefined) rankTipPinned = pin;
    fillRankTip();
    rankTip.hidden = false;
    rankInfo.setAttribute("aria-expanded", "true");
    const anchor = rankInfo.getBoundingClientRect();
    const width = rankTip.offsetWidth;
    rankTip.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) + "px";
    rankTip.style.top = anchor.bottom + 6 + "px";
  }
  function hideRankTip(force) {
    if (rankTipPinned && !force) return;
    rankTipPinned = false;
    rankTip.hidden = true;
    rankInfo.setAttribute("aria-expanded", "false");
  }
  rankInfo.addEventListener("mouseenter", () => showRankTip());
  rankInfo.addEventListener("mouseleave", () => hideRankTip());
  rankInfo.addEventListener("focus", () => showRankTip());
  rankInfo.addEventListener("blur", () => hideRankTip(true));
  rankInfo.addEventListener("click", () => {
    if (rankTipPinned) hideRankTip(true);
    else showRankTip(true);
  });
  const openMilestones = () => vscode.postMessage({ type: "run", command: data.milestoneCommand });
  $("status").addEventListener("click", openMilestones);
  $("rankCta").addEventListener("click", openMilestones);

  /* ------------------------------------------------------------ hover card */
  let hoverTimer = null;
  function hideHovercard() {
    clearTimeout(hoverTimer);
    hovercard.hidden = true;
  }
  function scheduleHovercard(row) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showHovercard(row), HOVER_DELAY);
  }
  function showHovercard(row) {
    const entry = toolIndex.get(row.dataset.command);
    if (!entry || !row.isConnected) return;
    hovercard.innerHTML = "";
    hovercard.appendChild(el("p", "hc-title", entry.tool.label));
    hovercard.appendChild(el("p", "hc-text", entry.tool.description));
    const meta = el("p", "hc-meta");
    meta.appendChild(el("span", "", entry.group.name));
    const used = usage[entry.tool.command];
    if (used) meta.appendChild(el("span", "", "Opened " + used.count + (used.count === 1 ? " time" : " times") + ", last " + relativeTime(used.last) + (relativeTime(used.last) === "now" ? "" : " ago")));
    meta.appendChild(el("span", "", favorites.includes(entry.tool.command) ? "★ Favorite" : "F to favorite"));
    hovercard.appendChild(meta);
    hovercard.hidden = false;

    const rect = row.getBoundingClientRect();
    const width = hovercard.offsetWidth;
    const height = hovercard.offsetHeight;
    const left = Math.max(8, Math.min(rect.left + 20, window.innerWidth - width - 8));
    const below = rect.bottom + 4;
    hovercard.style.left = left + "px";
    hovercard.style.top = (below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below) + "px";
  }
  document.addEventListener("scroll", hideHovercard, true);

  /* ------------------------------------------------------------ rows */
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
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function visibleRows() {
    return Array.prototype.filter.call(tree.querySelectorAll(".row"), row => !row.closest(".group:not(.open) > .children"));
  }

  function toolRow(tool, group, options) {
    const isFavorite = favorites.includes(tool.command);
    const row = el("div", "row tool" + (tool.command === selected ? " selected" : "") + (isFavorite ? " fav" : ""));
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(options.level));
    row.setAttribute("aria-selected", tool.command === selected ? "true" : "false");
    row.setAttribute("aria-description", tool.description + (isFavorite ? " Favorite." : ""));
    row.dataset.key = options.section + ":" + tool.command;
    row.dataset.command = tool.command;
    row.dataset.group = group.name;
    row.style.setProperty("--cat", "var(" + group.colorVar + ", currentColor)");

    row.appendChild(codicon(tool.icon, "tool-icon"));
    const label = el("span", "label");
    appendHighlighted(label, tool.label, options.term || "");
    row.appendChild(label);
    if (options.meta) {
      row.classList.add("has-meta");
      row.appendChild(el("span", "meta", options.meta));
    }

    const star = el("span", "star" + (isFavorite ? " on" : ""));
    star.setAttribute("aria-hidden", "true");
    star.title = isFavorite ? "Remove from favorites (F)" : "Add to favorites (F)";
    star.appendChild(codicon(isFavorite ? "star-full" : "star-empty"));
    star.addEventListener("click", event => {
      event.stopPropagation();
      toggleFavorite(tool.command);
    });
    row.appendChild(star);

    row.addEventListener("click", () => {
      hideHovercard();
      setFocus(row, false);
      runTool(tool.command);
    });
    row.addEventListener("mouseenter", () => scheduleHovercard(row));
    row.addEventListener("mouseleave", hideHovercard);
    return row;
  }

  function sectionLabel(text) {
    const label = el("div", "section-label", text);
    label.setAttribute("aria-hidden", "true");
    return label;
  }

  function flatGroup(name, rows) {
    const wrap = el("div", "flat");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", name);
    rows.forEach(row => wrap.appendChild(row));
    return wrap;
  }

  function groupBlock(group, groupIndex, tools, term, groupMatched) {
    const searching = Boolean(term);
    const open = searching ? !searchCollapsed.has(group.name) : (filter.kind === "category" || expanded.has(group.name));
    const holdsSelection = group.tools.some(tool => tool.command === selected);

    const wrap = el("div", "group" + (open ? " open" : "") + (holdsSelection ? " current" : "") + (group.name === "Security" ? " security" : ""));
    wrap.dataset.group = group.name;
    wrap.style.setProperty("--cat", "var(" + group.colorVar + ", var(--vscode-icon-foreground, currentColor))");

    const head = el("div", "row cat");
    head.setAttribute("role", "treeitem");
    head.setAttribute("aria-level", "1");
    head.setAttribute("aria-expanded", open ? "true" : "false");
    head.setAttribute("aria-setsize", String(data.groups.length));
    head.setAttribute("aria-posinset", String(groupIndex + 1));
    head.dataset.key = "group:" + group.name;
    head.dataset.group = group.name;
    head.title = group.name + ": " + group.tools.length + " tools";
    head.appendChild(codicon("chevron-right", "twistie"));
    head.appendChild(codicon(group.icon, "cat-icon"));
    const label = el("span", "label");
    appendHighlighted(label, group.name, groupMatched ? term : "");
    head.appendChild(label);
    const holds = el("span", "holds");
    holds.title = "Contains the selected tool";
    head.appendChild(holds);
    const narrowed = searching && !groupMatched;
    const count = el("span", "count" + (narrowed ? " matched" : ""), narrowed ? tools.length + "/" + group.tools.length : String(group.tools.length));
    count.setAttribute("aria-hidden", "true");
    head.appendChild(count);
    head.addEventListener("click", () => {
      setFocus(head, false);
      toggleGroup(group.name);
    });
    wrap.appendChild(head);

    const children = el("div", "children");
    const inner = el("div", "children-inner");
    inner.setAttribute("role", "group");
    tools.forEach(tool => inner.appendChild(toolRow(tool, group, { level: 2, section: "tree", term: groupMatched ? "" : term })));
    children.appendChild(inner);
    wrap.appendChild(children);
    return wrap;
  }

  /* ------------------------------------------------------------ views */
  const FILTERS = [
    { kind: "all", label: "All tools", icon: "list-tree" },
    { kind: "favorites", label: "Favorites", icon: "star-empty" },
    { kind: "recent", label: "Recently used", icon: "history" },
    { kind: "most", label: "Most used", icon: "graph" }
  ];

  function filterLabel() {
    if (filter.kind === "category") return filter.category;
    return FILTERS.find(f => f.kind === filter.kind).label;
  }

  function recentTools(limit) {
    return Object.keys(usage)
      .filter(command => toolIndex.has(command))
      .sort((a, b) => usage[b].last - usage[a].last)
      .slice(0, limit);
  }

  function mostUsedTools() {
    return Object.keys(usage)
      .filter(command => toolIndex.has(command))
      .sort((a, b) => usage[b].count - usage[a].count || usage[b].last - usage[a].last);
  }

  /** Names match first; descriptions widen the net so "kubernetes" finds the manifest tools. */
  function toolMatches(tool, term) {
    return tool.label.toLowerCase().includes(term) || tool.description.toLowerCase().includes(term);
  }

  function matchesTerm(entry, term) {
    return !term || toolMatches(entry.tool, term) || entry.group.name.toLowerCase().includes(term);
  }

  function render() {
    hideHovercard();
    const term = query.trim().toLowerCase();
    tree.innerHTML = "";
    let shown = 0;

    if (filter.kind === "favorites" || filter.kind === "recent" || filter.kind === "most") {
      const commands = filter.kind === "favorites" ? favorites : filter.kind === "recent" ? recentTools(RECENT_LIMIT) : mostUsedTools();
      const rows = commands
        .map(command => toolIndex.get(command))
        .filter(entry => matchesTerm(entry, term))
        .map(entry => {
          const used = usage[entry.tool.command];
          const meta = filter.kind === "recent" && used ? relativeTime(used.last)
            : filter.kind === "most" && used ? used.count + "×"
            : entry.group.name;
          return toolRow(entry.tool, entry.group, { level: 1, section: filter.kind, term, meta });
        });
      shown = rows.length;
      if (rows.length) tree.appendChild(flatGroup(filterLabel(), rows));
    } else {
      // The overview (no search, no filter) leads with favorites and recent tools.
      const overview = filter.kind === "all" && !term;
      const recent = overview ? recentTools(RECENT_IN_OVERVIEW) : [];
      if (overview && favorites.length) {
        tree.appendChild(sectionLabel("Favorites"));
        tree.appendChild(flatGroup("Favorites", favorites.map(command => {
          const entry = toolIndex.get(command);
          return toolRow(entry.tool, entry.group, { level: 1, section: "fav" });
        })));
      }
      if (recent.length) {
        tree.appendChild(sectionLabel("Recent"));
        tree.appendChild(flatGroup("Recently used", recent.map(command => {
          const entry = toolIndex.get(command);
          return toolRow(entry.tool, entry.group, { level: 1, section: "recent", meta: relativeTime(usage[command].last) });
        })));
      }
      if (overview && (favorites.length || recent.length)) tree.appendChild(sectionLabel("All tools"));

      data.groups.forEach((group, index) => {
        if (filter.kind === "category" && group.name !== filter.category) return;
        const groupMatched = Boolean(term) && group.name.toLowerCase().includes(term);
        const tools = term && !groupMatched ? group.tools.filter(tool => toolMatches(tool, term)) : group.tools;
        if (term && !tools.length) return;
        shown += tools.length;
        tree.appendChild(groupBlock(group, index, tools, term, groupMatched));
      });
    }

    renderEmpty(shown, term);
    renderFilterState();
    searchBox.classList.toggle("has-value", Boolean(query));
    clearSearch.hidden = !query;

    // Keep exactly one row in the tab order, preferring the one that had it.
    const rows = visibleRows();
    setFocus(rows.find(row => row.dataset.key === focusedKey)
      || rows.find(row => row.classList.contains("selected"))
      || rows[0], false);
  }

  function renderEmpty(shown, term) {
    const empty = $("empty");
    const actions = $("emptyActions");
    actions.innerHTML = "";
    if (shown) {
      empty.hidden = true;
      return;
    }
    empty.hidden = false;
    const icon = $("emptyIcon");
    if (term) {
      icon.className = "codicon codicon-search empty-icon";
      $("emptyTitle").textContent = "No tools match “" + query.trim() + "”";
      $("emptyText").textContent = filter.kind === "all"
        ? "Try a shorter word, or search every DevSnip Pro tool, including the ones not listed here."
        : "Nothing in " + filterLabel() + " matches. Try all tools, or search every DevSnip Pro tool.";
      const all = el("button", "btn", "Search all DevSnip Pro tools");
      all.type = "button";
      all.addEventListener("click", () => vscode.postMessage({ type: "searchAll" }));
      actions.appendChild(all);
      if (filter.kind !== "all") {
        const reset = el("button", "link", "Show all tools");
        reset.type = "button";
        reset.addEventListener("click", () => setFilter({ kind: "all" }));
        actions.appendChild(reset);
      }
      const clear = el("button", "link", "Clear search");
      clear.type = "button";
      clear.addEventListener("click", resetSearch);
      actions.appendChild(clear);
      say("No tools match " + query.trim());
    } else if (filter.kind === "favorites") {
      icon.className = "codicon codicon-star-empty empty-icon";
      $("emptyTitle").textContent = "No favorites yet";
      $("emptyText").textContent = "Hover a tool and select its star, or press F on a focused tool, to keep it at the top.";
    } else {
      icon.className = "codicon codicon-history empty-icon";
      $("emptyTitle").textContent = "Nothing used yet";
      $("emptyText").textContent = "Tools you open from anywhere in DevSnip Pro show up here.";
    }
  }

  function renderFilterState() {
    const active = filter.kind !== "all";
    filterBtn.classList.toggle("active", active);
    filterBtn.title = active ? "Filter: " + filterLabel() : "Filter tools";
    filterBtn.setAttribute("aria-label", active ? "Filter tools, showing " + filterLabel() : "Filter tools");
    $("filterBar").hidden = !active;
    $("filterLabel").textContent = "Showing " + filterLabel();
  }

  /* ------------------------------------------------------------ actions */
  function toggleGroup(name, force) {
    const wrap = tree.querySelector('.group[data-group="' + CSS.escape(name) + '"]');
    if (!wrap) return;
    const open = force === undefined ? !wrap.classList.contains("open") : force;
    if (open === wrap.classList.contains("open")) return;
    // Classes change in place, so the row keeps focus and the height animates.
    wrap.classList.toggle("open", open);
    wrap.querySelector(".cat").setAttribute("aria-expanded", open ? "true" : "false");
    if (query.trim()) {
      if (open) searchCollapsed.delete(name); else searchCollapsed.add(name);
    } else if (filter.kind === "all") {
      // Accordion: opening a category closes the others. Searches keep every
      // matching category open so no result is hidden.
      if (open) {
        tree.querySelectorAll(".group.open").forEach(other => {
          if (other === wrap) return;
          other.classList.remove("open");
          other.querySelector(".cat").setAttribute("aria-expanded", "false");
          if (other.querySelector(".children .row.focused")) setFocus(wrap.querySelector(".cat"), true);
        });
        expanded.clear();
        expanded.add(name);
        // Closing categories above shifts this one up; bring it back into view once they settle.
        setTimeout(() => wrap.querySelector(".cat").scrollIntoView({ block: "nearest" }), 200);
      } else {
        expanded.delete(name);
      }
      vscode.postMessage({ type: "expanded", groups: Array.from(expanded) });
    }
    if (!open) {
      const focusedInside = wrap.querySelector(".children .row.focused");
      if (focusedInside) setFocus(wrap.querySelector(".cat"), true);
    }
  }

  function runTool(command) {
    selected = command;
    persist();
    tree.querySelectorAll(".tool").forEach(row => {
      const on = row.dataset.command === command;
      row.classList.toggle("selected", on);
      row.setAttribute("aria-selected", on ? "true" : "false");
    });
    const owner = toolIndex.get(command).group.name;
    tree.querySelectorAll(".group").forEach(group => group.classList.toggle("current", group.dataset.group === owner));
    vscode.postMessage({ type: "run", command });
  }

  function toggleFavorite(command) {
    const entry = toolIndex.get(command);
    const was = favorites.includes(command);
    favorites = was ? favorites.filter(c => c !== command) : favorites.concat(command);
    vscode.postMessage({ type: "favorites", favorites });
    say(entry.tool.label + (was ? " removed from favorites" : " added to favorites"));
    render();
  }

  function setFilter(next) {
    filter = validFilter(next);
    searchCollapsed = new Set();
    focusedKey = null;
    persist();
    render();
    say("Showing " + filterLabel());
  }

  function resetSearch() {
    search.value = "";
    query = "";
    searchCollapsed = new Set();
    persist();
    render();
    search.focus();
  }

  /* ------------------------------------------------------------ filter menu */
  function buildMenu() {
    filterMenu.innerHTML = "";
    const item = (label, icon, checked, onSelect, count) => {
      const button = el("button", "menu-item");
      button.type = "button";
      button.setAttribute("role", checked === null ? "menuitem" : "menuitemradio");
      if (checked !== null) button.setAttribute("aria-checked", checked ? "true" : "false");
      if (checked !== null) button.appendChild(codicon("check", "check"));
      button.appendChild(codicon(icon, "item-icon"));
      button.appendChild(el("span", "", label));
      if (count !== undefined) button.appendChild(el("span", "menu-count", String(count)));
      button.addEventListener("click", () => {
        closeMenu(true);
        onSelect();
      });
      filterMenu.appendChild(button);
    };
    const counts = { all: toolIndex.size, favorites: favorites.length, recent: recentTools(RECENT_LIMIT).length, most: mostUsedTools().length };
    FILTERS.forEach(f => item(f.label, f.icon, filter.kind === f.kind, () => setFilter({ kind: f.kind }), counts[f.kind]));
    filterMenu.appendChild(el("div", "menu-sep"));
    filterMenu.appendChild(el("div", "menu-label", "Category"));
    data.groups.forEach(group => item(group.name, group.icon, filter.kind === "category" && filter.category === group.name,
      () => setFilter({ kind: "category", category: group.name }), group.tools.length));
    filterMenu.appendChild(el("div", "menu-sep"));
    item("Search every DevSnip Pro tool…", "search", null, () => vscode.postMessage({ type: "searchAll" }));
  }

  function openMenu() {
    buildMenu();
    filterMenu.hidden = false;
    filterBtn.setAttribute("aria-expanded", "true");
    const checked = filterMenu.querySelector('[aria-checked="true"]') || filterMenu.querySelector(".menu-item");
    if (checked) checked.focus();
  }
  function closeMenu(restoreFocus) {
    if (filterMenu.hidden) return;
    filterMenu.hidden = true;
    filterBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) filterBtn.focus();
  }
  filterBtn.addEventListener("click", event => {
    event.stopPropagation();
    if (filterMenu.hidden) openMenu(); else closeMenu(false);
  });
  filterMenu.addEventListener("keydown", event => {
    const items = Array.prototype.slice.call(filterMenu.querySelectorAll(".menu-item"));
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    else if (event.key === "Home") { event.preventDefault(); items[0].focus(); }
    else if (event.key === "End") { event.preventDefault(); items[items.length - 1].focus(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === "Tab") closeMenu(false);
  });
  document.addEventListener("click", event => {
    if (!filterMenu.hidden && !event.target.closest(".menu-wrap")) closeMenu(false);
    if (rankTipPinned && !event.target.closest("#rankInfo")) hideRankTip(true);
  });
  $("filterReset").addEventListener("click", () => setFilter({ kind: "all" }));

  /* ------------------------------------------------------------ keyboard */
  tree.addEventListener("keydown", event => {
    const current = document.activeElement && document.activeElement.classList.contains("row") ? document.activeElement : null;
    if (!current) return;
    hideHovercard();
    const rows = visibleRows();
    const index = rows.indexOf(current);
    const isGroup = current.classList.contains("cat");
    const wrap = current.closest(".group");

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setFocus(rows[Math.min(rows.length - 1, index + 1)], true);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (index <= 0) search.focus();
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
        if (isGroup && !wrap.classList.contains("open")) toggleGroup(wrap.dataset.group, true);
        else if (isGroup && rows[index + 1] && rows[index + 1].classList.contains("tool")) setFocus(rows[index + 1], true);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (isGroup && wrap.classList.contains("open")) toggleGroup(wrap.dataset.group, false);
        else if (!isGroup && wrap) setFocus(wrap.querySelector(".cat"), true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isGroup) toggleGroup(wrap.dataset.group);
        else runTool(current.dataset.command);
        break;
      case "f":
      case "F":
        if (!isGroup && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          focusedKey = current.dataset.key;
          toggleFavorite(current.dataset.command);
          const again = tree.querySelector('.row[data-key="' + CSS.escape(focusedKey) + '"]');
          if (again) setFocus(again, true);
        }
        break;
    }
  });

  /* ------------------------------------------------------------ search */
  $("searchKbd").textContent = isMac ? "⌘K" : "Ctrl+K";
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    focusedKey = null;
    searchCollapsed = new Set();
    persist();
    render();
    const term = query.trim();
    if (term) {
      const count = tree.querySelectorAll(".tool").length;
      if (count) say(count + (count === 1 ? " tool matches" : " tools match"));
    }
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
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (search.value) resetSearch();
      else search.blur();
    }
  });
  clearSearch.addEventListener("click", resetSearch);

  document.addEventListener("keydown", event => {
    const mod = event.metaKey || event.ctrlKey;
    if ((mod && event.key.toLowerCase() === "k") || (event.key === "/" && document.activeElement !== search)) {
      event.preventDefault();
      closeMenu(false);
      search.focus();
      search.select();
    } else if (event.key === "Escape") {
      hideHovercard();
      hideRankTip(true);
    }
  });

  /* ------------------------------------------------------------ appearance */
  // The theme picker. Choosing a theme posts it to the extension, which stores
  // it and restyles every DevSnip Pro webview at once (this one included, via
  // the injected theme runtime). The "devsnip:theme" message keeps the picker in
  // sync when the theme changes from elsewhere, such as the command palette.
  const themeBtn = $("themeBtn");
  const themePanel = $("themePanel");
  const themeChoices = (data.theme && data.theme.choices) || [];
  let currentTheme = (data.theme && data.theme.current) || "system";

  function choiceById(id) {
    return themeChoices.find(choice => choice.id === id) || themeChoices[0];
  }

  function themePreview(choice) {
    if (!choice.preview) {
      const box = el("span", "tp system");
      box.appendChild(codicon("color-mode"));
      return box;
    }
    const p = choice.preview;
    const box = el("span", "tp");
    box.style.background = p.bg;
    const side = el("span", "tp-side");
    side.style.background = p.sidebar;
    for (let i = 0; i < 3; i++) {
      const line = el("i");
      line.style.background = p.muted;
      side.appendChild(line);
    }
    const main = el("span", "tp-main");
    const title = el("span", "tp-line");
    title.style.background = p.fg;
    title.style.width = "70%";
    const sub = el("span", "tp-line");
    sub.style.background = p.muted;
    sub.style.width = "48%";
    const row = el("span", "tp-row");
    const button = el("span", "tp-btn");
    button.style.background = p.accent;
    const chip = el("span", "tp-chip");
    chip.style.background = p.accent2;
    const card = el("span", "tp-chip");
    card.style.background = p.surface;
    row.append(button, chip, card);
    main.append(title, sub, row);
    box.append(side, main);
    return box;
  }

  function renderThemeButton() {
    const choice = choiceById(currentTheme);
    if (!choice) return;
    $("themeName").textContent = choice.label;
    const dots = $("themeDots");
    dots.innerHTML = "";
    if (!choice.swatches.length) dots.appendChild(el("i", "system"));
    choice.swatches.forEach(color => {
      const dot = el("i");
      dot.style.background = color;
      dots.appendChild(dot);
    });
    themeBtn.setAttribute("aria-label", "Theme: " + choice.label + ". Change how DevSnip Pro looks");
  }

  function renderThemePanel() {
    themePanel.innerHTML = "";
    const head = el("div", "theme-head");
    head.appendChild(el("b", "", "Appearance"));
    themePanel.appendChild(head);
    themeChoices.forEach(choice => {
      const option = el("button", "theme-opt");
      option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", choice.id === currentTheme ? "true" : "false");
      option.dataset.theme = choice.id;
      option.title = choice.label + " — " + choice.description;
      option.tabIndex = choice.id === currentTheme ? 0 : -1;
      const name = el("span", "opt-name");
      name.appendChild(el("span", "", choice.shortLabel || choice.label));
      name.appendChild(codicon("check"));
      option.append(themePreview(choice), name);
      option.addEventListener("click", () => chooseTheme(choice.id));
      themePanel.appendChild(option);
    });
  }

  function chooseTheme(id) {
    if (id === currentTheme) return;
    currentTheme = id;
    renderThemeButton();
    themePanel.querySelectorAll(".theme-opt").forEach(option => {
      const on = option.dataset.theme === id;
      option.setAttribute("aria-selected", on ? "true" : "false");
      option.tabIndex = on ? 0 : -1;
    });
    vscode.postMessage({ type: "setTheme", id });
    say("Theme set to " + choiceById(id).label);
  }

  function openThemePanel() {
    hideHovercard();
    hideRankTip(true);
    closeMenu(false);
    renderThemePanel();
    themePanel.hidden = false;
    themeBtn.setAttribute("aria-expanded", "true");
    const selectedOption = themePanel.querySelector('[aria-selected="true"]') || themePanel.querySelector(".theme-opt");
    if (selectedOption) selectedOption.focus();
  }

  function closeThemePanel(restoreFocus) {
    if (themePanel.hidden) return;
    themePanel.hidden = true;
    themeBtn.setAttribute("aria-expanded", "false");
    if (restoreFocus) themeBtn.focus();
  }

  themeBtn.addEventListener("click", event => {
    event.stopPropagation();
    if (themePanel.hidden) openThemePanel(); else closeThemePanel(false);
  });
  themePanel.addEventListener("click", event => event.stopPropagation());
  themePanel.addEventListener("keydown", event => {
    const options = Array.prototype.slice.call(themePanel.querySelectorAll(".theme-opt"));
    const index = options.indexOf(document.activeElement);
    // Arrow keys move through the grid; Up/Down jump a whole row.
    const columns = Math.max(1, Math.round(themePanel.clientWidth / (options[0] ? options[0].offsetWidth + 4 : 100)));
    let next = -1;
    if (event.key === "ArrowRight") next = Math.min(options.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") next = Math.min(options.length - 1, index + columns);
    else if (event.key === "ArrowUp") next = Math.max(0, index - columns);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      closeThemePanel(event.key === "Escape");
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      options[next].focus();
    }
  });
  document.addEventListener("click", () => closeThemePanel(false));
  renderThemeButton();

  /* ------------------------------------------------------------ onboarding */
  // The Getting started checklist (new users) and What's new card (after an
  // update). Both sit quietly at the top of the sidebar and can be dismissed;
  // nothing pops up.
  const onboardingRoot = $("onboarding");
  let onboarding = data.onboarding || { guide: null, whatsNew: null };
  let guideCollapsed = saved.guideCollapsed === true;

  function onboardingHead(iconName, title, count, extraButtons) {
    const head = el("div", "ob-head");
    head.appendChild(codicon(iconName, "ob-icon"));
    head.appendChild(el("span", "ob-title", title));
    if (count) {
      // "2 of 5" normally, "2/5" in narrow sidebars so the title keeps its room.
      const counter = el("span", "ob-count");
      counter.appendChild(el("span", "ob-count-full", count.replace("/", " of ")));
      counter.appendChild(el("span", "ob-count-short", count));
      head.appendChild(counter);
    }
    extraButtons.forEach(button => head.appendChild(button));
    return head;
  }

  function smallButton(iconName, label, onClick, extraClass) {
    const button = el("button", "icon-btn" + (extraClass ? " " + extraClass : ""));
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(codicon(iconName));
    button.addEventListener("click", event => { event.stopPropagation(); onClick(button); });
    return button;
  }

  function renderOnboarding() {
    onboardingRoot.innerHTML = "";
    const news = onboarding.whatsNew;
    if (news && news.items.length) {
      const card = el("section", "ob news");
      card.setAttribute("aria-label", "What's new");
      card.appendChild(onboardingHead("sparkle", "What's new in " + news.version, "", [
        smallButton("close", "Dismiss", () => { onboarding.whatsNew = null; renderOnboarding(); vscode.postMessage({ type: "dismissWhatsNew" }); })
      ]));
      const body = el("div", "ob-body");
      news.items.forEach(item => {
        const row = el("button", "ob-step ob-item");
        row.type = "button";
        row.appendChild(el("span", "ob-dot"));
        row.appendChild(el("span", "ob-label", item.title));
        row.appendChild(codicon("arrow-right", "ob-go"));
        row.title = item.title;
        row.addEventListener("click", () => vscode.postMessage({ type: "whatsNewOpen", command: item.command }));
        body.appendChild(row);
      });
      const foot = el("div", "ob-foot");
      const notes = el("button", "link", "Release notes");
      notes.type = "button";
      notes.addEventListener("click", () => vscode.postMessage({ type: "whatsNewOpen" }));
      foot.appendChild(notes);
      body.appendChild(foot);
      card.appendChild(body);
      onboardingRoot.appendChild(card);
    }

    const steps = onboarding.guide;
    if (steps && steps.length) {
      const done = steps.filter(step => step.done).length;
      const card = el("section", "ob" + (guideCollapsed ? " collapsed" : ""));
      card.setAttribute("aria-label", "Get started with DevSnip Pro");
      const toggle = smallButton("chevron-down", guideCollapsed ? "Expand" : "Collapse", button => {
        guideCollapsed = !guideCollapsed;
        card.classList.toggle("collapsed", guideCollapsed);
        button.title = guideCollapsed ? "Expand" : "Collapse";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-expanded", String(!guideCollapsed));
        persistOnboarding();
      }, "ob-toggle");
      toggle.setAttribute("aria-expanded", String(!guideCollapsed));
      const head = onboardingHead("rocket", "Get started", done + "/" + steps.length, [
        toggle,
        smallButton("close", "Hide the Get started guide", () => { onboarding.guide = null; renderOnboarding(); vscode.postMessage({ type: "dismissGuide" }); say("Get started guide hidden. Run DevSnip Pro: Get Started to see it again."); })
      ]);
      head.style.cursor = "pointer";
      head.addEventListener("click", () => toggle.click());
      card.appendChild(head);
      const progress = el("div", "ob-progress");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(steps.length));
      progress.setAttribute("aria-valuenow", String(done));
      progress.setAttribute("aria-label", done + " of " + steps.length + " first steps done");
      const fill = el("span");
      fill.style.width = Math.round((done / steps.length) * 100) + "%";
      progress.appendChild(fill);
      card.appendChild(progress);
      const body = el("div", "ob-body");
      steps.forEach(step => {
        const row = el("button", "ob-step" + (step.done ? " done" : ""));
        row.type = "button";
        row.title = step.description;
        row.appendChild(el("span", "ob-check"));
        row.appendChild(el("span", "ob-label", step.title));
        row.appendChild(codicon("arrow-right", "ob-go"));
        row.setAttribute("aria-label", step.title + (step.done ? ", done" : ". " + step.description));
        row.addEventListener("click", () => vscode.postMessage({ type: "guideStep", command: step.command, step: step.id }));
        body.appendChild(row);
      });
      const foot = el("div", "ob-foot");
      const tour = el("button", "link", "Open the guided tour");
      tour.type = "button";
      tour.addEventListener("click", () => vscode.postMessage({ type: "openWalkthrough" }));
      foot.appendChild(tour);
      body.appendChild(foot);
      card.appendChild(body);
      onboardingRoot.appendChild(card);
    }
  }

  function persistOnboarding() {
    const state = vscode.getState() || {};
    state.guideCollapsed = guideCollapsed;
    vscode.setState(state);
  }

  renderOnboarding();

  /* ------------------------------------------------------------ messages */
  window.addEventListener("message", event => {
    const message = event.data || {};
    if (message.type === "onboarding" && message.onboarding) {
      onboarding = message.onboarding;
      renderOnboarding();
    }
    if (message.type === "devsnip:theme" && typeof message.id === "string" && message.id !== currentTheme) {
      currentTheme = message.id;
      renderThemeButton();
      if (!themePanel.hidden) renderThemePanel();
    }
    if (message.type === "status" && message.status) renderStatus(message.status);
    if (message.type === "usage" && message.usage) {
      usage = message.usage;
      // Only views that show usage need to change.
      if (filter.kind === "recent" || filter.kind === "most" || (filter.kind === "all" && !query.trim())) render();
    }
  });

  renderStatus(status);
  render();
})();
