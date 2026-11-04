// Theme Studio. Builds the controls from the state the extension sends and
// posts every change back; the extension stores it and re-themes every
// DevSnip Pro page, this one included, so the preview is the page itself.
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const boot = window.__STUDIO__ || {};
  let state = boot.state;
  const fonts = boot.fonts || [];
  const monos = boot.monos || [];
  const $ = id => document.getElementById(id);

  const ACCENTS = ["#3b82f6", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1"];
  const SEGMENTS = {
    radius: [["sharp", "Sharp"], ["default", "Default"], ["rounded", "Rounded"], ["round", "Round"]],
    borders: [["subtle", "Subtle"], ["default", "Default"], ["strong", "Strong"]],
    shadows: [["flat", "Flat"], ["default", "Default"], ["elevated", "Elevated"]]
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function say(text) { $("live").textContent = text; }
  function choice(id) { return state.choices.find(c => c.id === id); }

  /* ------------------------------------------------------------ customization */

  // Colour inputs fire continuously while dragging: send at most one live update per frame, then a final one.
  let pending = null;
  let frame = 0;
  // True between a colour input's first "input" event and its "change": state pushes then leave the controls alone.
  let dragging = false;
  function sendCustom(patch, instant) {
    dragging = Boolean(instant);
    state.custom = Object.assign({}, state.custom, patch);
    Object.keys(state.custom).forEach(key => { if (state.custom[key] === undefined || state.custom[key] === "") delete state.custom[key]; });
    pending = { type: "custom", value: state.custom, instant: Boolean(instant) };
    if (!instant) { cancelAnimationFrame(frame); frame = 0; flush(); return; }
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; flush(); });
  }
  function flush() {
    if (!pending) return;
    vscode.postMessage(pending);
    pending = null;
  }

  /* ------------------------------------------------------------ themes */

  function mini(c) {
    const box = el("span", "mini" + (c.kind === "system" ? " system" : ""));
    box.setAttribute("aria-hidden", "true");
    if (c.kind === "system") {
      const dark = el("span", "", "Dark");
      dark.style.background = "#1f1f1f"; dark.style.color = "#e8e8e8";
      const light = el("span", "", "Light");
      light.style.background = "#f6f6f6"; light.style.color = "#1f1f1f";
      box.append(dark, light);
      return box;
    }
    const p = c.preview;
    const side = el("span", "side");
    side.style.background = p.sidebar;
    [p.accent, p.muted, p.muted].forEach((colour, i) => { const line = el("i"); line.style.background = colour; line.style.width = (90 - i * 20) + "%"; line.style.opacity = i ? ".45" : "1"; side.appendChild(line); });
    const main = el("span", "main");
    main.style.background = p.bg;
    const title = el("i"); title.style.background = p.fg; title.style.width = "60%";
    const text = el("i"); text.style.background = p.muted; text.style.width = "85%"; text.style.opacity = ".6";
    const row = el("span", "row");
    const button = el("b"); button.style.background = p.accent;
    const button2 = el("b"); button2.style.background = p.surface; button2.style.width = "20px";
    const dot = el("i"); dot.style.background = p.accent2; dot.style.width = "8px"; dot.style.height = "8px"; dot.style.borderRadius = "50%";
    row.append(button, button2, dot);
    main.append(title, text, row);
    box.append(side, main);
    return box;
  }

  function renderThemes() {
    const grid = $("themeGrid");
    grid.textContent = "";
    const groups = [
      ["", state.choices.filter(c => c.kind === "system")],
      ["Dark", state.choices.filter(c => c.kind === "dark")],
      ["Light & high contrast", state.choices.filter(c => c.kind === "light" || c.kind === "hc")]
    ];
    groups.forEach(([label, list]) => {
      if (!list.length) return;
      if (label) grid.appendChild(el("div", "group-label", label));
      list.forEach(c => {
        const card = el("button", "theme-card");
        card.type = "button";
        card.setAttribute("role", "radio");
        card.setAttribute("aria-checked", String(c.id === state.current));
        if (c.id === state.effective && c.id !== state.current) card.classList.add("effective");
        card.dataset.theme = c.id;
        card.title = c.locked ? c.label + " is locked: " + c.lockHint + ". Click to preview or unlock it." : c.description;
        card.appendChild(mini(c));
        const name = el("span", "name");
        name.appendChild(el("span", "", c.label));
        const check = el("span", "codicon codicon-check");
        check.setAttribute("aria-hidden", "true");
        name.appendChild(check);
        card.appendChild(name);
        card.appendChild(el("span", "desc", c.description));
        if (c.locked) {
          const lock = el("span", "lock");
          const icon = el("span", "codicon codicon-lock");
          icon.setAttribute("aria-hidden", "true");
          lock.append(icon, document.createTextNode(c.lockHint));
          card.appendChild(lock);
        }
        card.addEventListener("click", () => {
          if (c.id === state.current && !state.previewing) return;
          vscode.postMessage({ type: "setTheme", id: c.id });
          if (!c.locked) {
            state.current = c.id;
            renderThemes();
            say("Theme set to " + c.label);
          }
        });
        grid.appendChild(card);
      });
    });
    const effective = choice(state.effective);
    $("themeHint").textContent = state.previewing ? "Previewing " + (choice(state.previewing) || {}).label + " for " + state.previewSeconds + "s"
      : state.current !== state.effective && effective ? "Showing " + effective.label + " to match VS Code" : "";
    $("previewName").textContent = (effective || choice(state.current) || { label: "" }).label;
  }

  /* ------------------------------------------------------------ follow VS Code */

  function fillPairSelect(select, kinds, selected) {
    select.textContent = "";
    state.choices.filter(c => kinds.indexOf(c.kind) >= 0).forEach(c => {
      const option = el("option", "", c.label + (c.locked ? " (locked)" : ""));
      option.value = c.id;
      option.disabled = Boolean(c.locked);
      option.selected = c.id === selected;
      select.appendChild(option);
    });
  }

  function firstUnlocked(kinds, preferred) {
    const list = state.choices.filter(c => kinds.indexOf(c.kind) >= 0 && !c.locked);
    return (list.find(c => c.id === preferred) || list[0] || {}).id;
  }

  function renderSync() {
    const on = Boolean(state.sync) && state.current === "system";
    $("syncOn").checked = on;
    $("syncPair").hidden = !on;
    $("vsKind").textContent = "VS Code is " + (state.vscodeKind === "hc" ? "high contrast" : state.vscodeKind);
    const pair = state.sync || {};
    fillPairSelect($("syncDark"), ["dark"], pair.dark);
    fillPairSelect($("syncLight"), ["light"], pair.light);
  }

  function sendSync() {
    const dark = $("syncDark").value;
    const light = $("syncLight").value;
    if (!dark || !light) { say("Unlock a dark and a light theme to pair them with VS Code"); renderSync(); return; }
    state.sync = { dark, light };
    vscode.postMessage({ type: "sync", value: state.sync });
  }

  $("syncOn").addEventListener("change", event => {
    if (event.target.checked) {
      const dark = firstUnlocked(["dark"], (state.sync || {}).dark || "dark");
      const light = firstUnlocked(["light"], (state.sync || {}).light || "light");
      if (!dark || !light) {
        event.target.checked = false;
        say("Unlock a dark and a light theme first, then pair them with VS Code");
        vscode.postMessage({ type: "setTheme", id: !dark ? "dark" : "light" });
        return;
      }
      state.sync = { dark, light };
      state.current = "system";
      vscode.postMessage({ type: "sync", value: state.sync });
      say("DevSnip Pro now follows VS Code light and dark");
    } else {
      state.sync = null;
      vscode.postMessage({ type: "sync", value: null });
      say("Light and dark pairing turned off");
    }
    renderSync();
    renderThemes();
  });
  $("syncDark").addEventListener("change", sendSync);
  $("syncLight").addEventListener("change", sendSync);

  /* ------------------------------------------------------------ colours */

  function renderAccent() {
    const box = $("accentSwatches");
    box.textContent = "";
    const accent = state.custom.accent;
    ACCENTS.forEach(colour => {
      const sw = el("button", "sw");
      sw.type = "button";
      sw.style.background = colour;
      sw.setAttribute("role", "radio");
      sw.setAttribute("aria-checked", String(accent === colour));
      sw.setAttribute("aria-label", "Accent " + colour);
      sw.addEventListener("click", () => { sendCustom({ accent: colour }); renderAccent(); say("Accent set to " + colour); });
      box.appendChild(sw);
    });
    const custom = el("span", "sw custom");
    custom.title = "Any colour";
    const picker = el("input");
    picker.type = "color";
    picker.value = accent || "#3b82f6";
    picker.setAttribute("aria-label", "Custom accent colour");
    custom.setAttribute("role", "radio");
    custom.setAttribute("aria-checked", String(Boolean(accent) && ACCENTS.indexOf(accent) < 0));
    picker.addEventListener("input", () => sendCustom({ accent: picker.value }, true));
    picker.addEventListener("change", () => { sendCustom({ accent: picker.value }); renderAccent(); });
    custom.appendChild(picker);
    box.appendChild(custom);
    document.querySelector('[data-reset="accent"]').disabled = !accent;
  }

  function renderBackground() {
    const named = state.effective !== "system";
    const field = $("bgField");
    const input = $("bgInput");
    field.classList.toggle("disabled", !named);
    input.disabled = !named;
    const effective = choice(state.effective);
    input.value = state.custom.background || (effective && effective.preview ? effective.preview.bg : "#1e1e1e");
    $("bgHint").textContent = named ? (state.custom.background ? "Surfaces and borders follow your colour" : "Using the theme's background") : "Pick a DevSnip theme to change the background; VS Code Adaptive keeps VS Code's.";
    document.querySelector('[data-reset="background"]').disabled = !state.custom.background;
  }
  $("bgInput").addEventListener("input", event => sendCustom({ background: event.target.value }, true));
  $("bgInput").addEventListener("change", event => { sendCustom({ background: event.target.value }); renderBackground(); });

  document.querySelectorAll("[data-reset]").forEach(button => {
    button.addEventListener("click", () => {
      const patch = {};
      patch[button.dataset.reset] = undefined;
      sendCustom(patch);
      renderAll();
      say("Using the theme's " + button.dataset.reset);
    });
  });

  /* ------------------------------------------------------------ shape */

  function renderSegments() {
    document.querySelectorAll(".seg").forEach(seg => {
      const key = seg.dataset.key;
      const value = state.custom[key] || "default";
      seg.textContent = "";
      SEGMENTS[key].forEach(([id, label]) => {
        const button = el("button", "", label);
        button.type = "button";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", String(id === value));
        button.tabIndex = id === value ? 0 : -1;
        button.addEventListener("click", () => {
          const patch = {};
          patch[key] = id === "default" ? undefined : id;
          sendCustom(patch);
          renderSegments();
          seg.querySelector('[aria-checked="true"]').focus();
          say(key + ": " + label);
        });
        seg.appendChild(button);
      });
      // Arrow keys move between options, as in any radio group.
      seg.onkeydown = event => {
        const buttons = Array.from(seg.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        buttons[(index + step + buttons.length) % buttons.length].click();
      };
    });
  }

  /* ------------------------------------------------------------ typography */

  const CUSTOM_FONT = "__custom__";
  function fillFonts(select, presets, value) {
    select.textContent = "";
    let matched = false;
    presets.forEach(preset => {
      const option = el("option", "", preset.label);
      option.value = preset.value;
      if (preset.value === (value || "")) { option.selected = true; matched = true; }
      select.appendChild(option);
    });
    const other = el("option", "", "Custom…");
    other.value = CUSTOM_FONT;
    if (!matched) other.selected = true;
    select.appendChild(other);
    return !matched;
  }

  function renderFonts() {
    const customUi = fillFonts($("fontSelect"), fonts, state.custom.font);
    const customMono = fillFonts($("monoSelect"), monos, state.custom.monoFont);
    $("fontText").parentElement.hidden = !customUi;
    $("monoText").parentElement.hidden = !customMono;
    $("customFonts").hidden = !customUi && !customMono;
    if (customUi) $("fontText").value = state.custom.font || "";
    if (customMono) $("monoText").value = state.custom.monoFont || "";
  }

  function bindFont(selectId, textId, key) {
    $(selectId).addEventListener("change", event => {
      const value = event.target.value;
      if (value === CUSTOM_FONT) {
        $("customFonts").hidden = false;
        $(textId).parentElement.hidden = false;
        $(textId).focus();
        return;
      }
      const patch = {};
      patch[key] = value || undefined;
      sendCustom(patch);
      renderFonts();
    });
    let timer = 0;
    $(textId).addEventListener("input", event => {
      clearTimeout(timer);
      timer = setTimeout(() => { const patch = {}; patch[key] = event.target.value.trim() || undefined; sendCustom(patch); }, 350);
    });
  }
  bindFont("fontSelect", "fontText", "font");
  bindFont("monoSelect", "monoText", "monoFont");

  /* ------------------------------------------------------------ motion */

  $("motionOn").addEventListener("change", event => {
    sendCustom({ motion: event.target.checked ? undefined : false });
    say(event.target.checked ? "Theme fade on" : "Theme fade off");
  });

  $("resetAll").addEventListener("click", () => {
    state.custom = {};
    vscode.postMessage({ type: "reset" });
    renderAll();
    say("Customizations reset; the theme's own look is back");
  });

  /* ------------------------------------------------------------ contrast checks */

  function parse(colour) {
    const m = /rgba?\(([^)]+)\)/.exec(colour || "");
    if (!m) return null;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return parts.length >= 3 && (parts[3] === undefined || parts[3] > 0.5) ? parts.slice(0, 3) : null;
  }
  function lum(rgb) {
    const c = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  /** Measures the colours the preview actually renders, so the numbers match what every page shows. */
  function renderChecks() {
    const list = $("checks");
    list.textContent = "";
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
    const card = document.querySelector(".preview .card");
    const surface = parse(getComputedStyle(card).backgroundColor) || bodyBg;
    const primary = document.querySelector(".pv-toolbar .btn.primary");
    const checks = [
      ["Body text", parse(getComputedStyle(document.querySelector(".pv-text")).color), surface, 4.5],
      ["Muted text", parse(getComputedStyle(document.querySelector(".pv-text .muted")).color), surface, 4.5],
      ["Links", parse(getComputedStyle(document.querySelector(".pv-text a")).color), surface, 4.5],
      ["Primary button", parse(getComputedStyle(primary).color), parse(getComputedStyle(primary).backgroundColor), 4.5]
    ];
    checks.forEach(([label, fg, bg, min]) => {
      if (!fg || !bg) return;
      const value = ratio(fg, bg);
      const row = el("li");
      row.appendChild(el("span", "", label));
      row.appendChild(el("span", value >= min ? "pass" : "fail", value.toFixed(1) + ":1 " + (value >= 7 ? "AAA" : value >= min ? "AA" : "low")));
      list.appendChild(row);
    });
  }

  /* ------------------------------------------------------------ wiring */

  function renderAll() {
    renderThemes();
    renderSync();
    renderAccent();
    renderBackground();
    renderSegments();
    renderFonts();
    $("motionOn").checked = state.custom.motion !== false;
    // After the theme rules have been swapped in, so the measured colours are the new ones.
    requestAnimationFrame(() => setTimeout(renderChecks, 340));
  }

  window.addEventListener("message", event => {
    const data = event.data;
    if (!data) return;
    if (data.type === "studio:state" && data.state) {
      // Keep a colour that is still being dragged, so the swatch does not jump back.
      state = data.state;
      if (dragging) { renderThemes(); requestAnimationFrame(() => setTimeout(renderChecks, 60)); return; }
      const focusedTheme = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.theme;
      renderAll();
      if (focusedTheme) { const again = document.querySelector('[data-theme="' + focusedTheme + '"]'); if (again) again.focus(); }
    } else if (data.type === "devsnip:theme") {
      requestAnimationFrame(() => setTimeout(renderChecks, data.instant ? 30 : 340));
    }
  });

  renderAll();
})();
