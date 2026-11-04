import { escapeHtml, embedJson, getNonce } from "../utils/webview-ui";
import { FONT_PRESETS, MONO_PRESETS, ThemeCustomization } from "./custom";
import type { ThemeChoice, ThemeSync } from "./service";

/**
 * Theme Studio: every theme, the light/dark pairing with VS Code and the
 * personal tweaks, with a live preview. The page itself is themed like every
 * other DevSnip Pro page, so its preview is simply the page: what you see is
 * what every panel gets. media/theme-studio.js builds the controls from state.
 */

export interface StudioState {
  /** The theme the user chose ("system" for VS Code Adaptive). */
  current: string;
  /** The theme drawn right now, which differs under a light/dark pairing. */
  effective: string;
  vscodeKind: "light" | "dark" | "hc";
  choices: ThemeChoice[];
  custom: ThemeCustomization;
  sync: ThemeSync | null;
  previewing: string | null;
  previewSeconds: number;
}

export function studioPresets() {
  return { fonts: FONT_PRESETS, monos: MONO_PRESETS };
}

export function renderThemeStudio(o: { cspSource: string; scriptUri: string; codiconsUri: string; state: StudioState }): string {
  const nonce = getNonce();
  const data = { state: o.state, ...studioPresets() };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${o.cspSource}; style-src ${o.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Theme Studio</title>
<link rel="stylesheet" href="${escapeHtml(o.codiconsUri)}">
<style nonce="${nonce}">${STUDIO_CSS}</style>
</head>
<body>
<header class="hero">
  <div>
    <h1><span class="codicon codicon-symbol-color" aria-hidden="true"></span> Theme Studio</h1>
    <p>Pick a theme and make it yours. Every change applies at once to every DevSnip Pro panel and is remembered across restarts.</p>
  </div>
  <button type="button" class="btn ghost" id="resetAll"><span class="codicon codicon-discard" aria-hidden="true"></span> Reset customizations</button>
</header>
<main class="layout">
  <div class="controls">
    <section class="card" aria-labelledby="themesTitle">
      <div class="card-head"><h2 id="themesTitle">Themes</h2><span class="hint" id="themeHint"></span></div>
      <div class="theme-grid" id="themeGrid" role="radiogroup" aria-labelledby="themesTitle"></div>
    </section>

    <section class="card" aria-labelledby="syncTitle">
      <div class="card-head"><h2 id="syncTitle">Follow VS Code</h2><span class="hint" id="vsKind"></span></div>
      <label class="switch-row">
        <input type="checkbox" id="syncOn" role="switch">
        <span class="switch" aria-hidden="true"></span>
        <span><b>Match VS Code light and dark</b><small>Use one DevSnip theme while VS Code is dark and another while it is light. High-contrast VS Code themes always stay in charge.</small></span>
      </label>
      <div class="pair" id="syncPair">
        <label>While VS Code is dark<select id="syncDark"></select></label>
        <label>While VS Code is light<select id="syncLight"></select></label>
      </div>
    </section>

    <section class="card" aria-labelledby="colourTitle">
      <div class="card-head"><h2 id="colourTitle">Colours</h2></div>
      <div class="field">
        <div class="field-head"><span id="accentLabel">Accent</span><button type="button" class="link" data-reset="accent">Theme default</button></div>
        <div class="swatches" id="accentSwatches" role="radiogroup" aria-labelledby="accentLabel"></div>
      </div>
      <div class="field" id="bgField">
        <div class="field-head"><label for="bgInput">Background</label><button type="button" class="link" data-reset="background">Theme default</button></div>
        <div class="color-row"><input type="color" id="bgInput"><span class="hint" id="bgHint"></span></div>
      </div>
      <p class="note"><span class="codicon codicon-pass" aria-hidden="true"></span> Colours you pick are adjusted when needed so text keeps WCAG AA contrast.</p>
    </section>

    <section class="card" aria-labelledby="shapeTitle">
      <div class="card-head"><h2 id="shapeTitle">Shape</h2></div>
      <div class="field"><span class="field-label" id="radiusLabel">Corners</span><div class="seg" data-key="radius" role="radiogroup" aria-labelledby="radiusLabel"></div></div>
      <div class="field"><span class="field-label" id="bordersLabel">Borders</span><div class="seg" data-key="borders" role="radiogroup" aria-labelledby="bordersLabel"></div></div>
      <div class="field"><span class="field-label" id="shadowsLabel">Shadows</span><div class="seg" data-key="shadows" role="radiogroup" aria-labelledby="shadowsLabel"></div></div>
    </section>

    <section class="card" aria-labelledby="typeTitle">
      <div class="card-head"><h2 id="typeTitle">Typography</h2></div>
      <div class="pair">
        <label>Interface font<select id="fontSelect"></select></label>
        <label>Code font<select id="monoSelect"></select></label>
      </div>
      <div class="pair" id="customFonts">
        <label>Custom interface font<input type="text" id="fontText" placeholder="e.g. &quot;IBM Plex Sans&quot;, sans-serif" spellcheck="false"></label>
        <label>Custom code font<input type="text" id="monoText" placeholder="e.g. &quot;Iosevka&quot;, monospace" spellcheck="false"></label>
      </div>
      <p class="note">Fonts must be installed on this computer. Leave a font on VS Code to keep your editor settings.</p>
    </section>

    <section class="card" aria-labelledby="motionTitle">
      <div class="card-head"><h2 id="motionTitle">Motion</h2></div>
      <label class="switch-row">
        <input type="checkbox" id="motionOn" role="switch">
        <span class="switch" aria-hidden="true"></span>
        <span><b>Fade between themes</b><small>A short colour fade when the theme changes. Turned off automatically when your system asks for reduced motion.</small></span>
      </label>
    </section>
  </div>

  <aside class="preview" aria-label="Live preview">
    <div class="card sticky">
      <div class="card-head"><h2>Live preview</h2><span class="badge" id="previewName"></span></div>
      <div class="pv-toolbar">
        <button type="button" class="btn primary" tabindex="-1">Run request</button>
        <button type="button" class="btn secondary" tabindex="-1">Save</button>
        <span class="chip ok">200 OK</span>
      </div>
      <div class="pv-form">
        <input type="text" value="https://api.example.com/users" aria-label="Sample input" tabindex="-1" readonly>
        <select aria-label="Sample select" tabindex="-1"><option>GET</option></select>
      </div>
      <div class="pv-stats">
        <div class="stat"><span class="v">128</span><span class="l">rows</span></div>
        <div class="stat"><span class="v">42 ms</span><span class="l">latency</span></div>
        <div class="stat"><span class="v">3</span><span class="l">warnings</span></div>
      </div>
      <table class="pv-table">
        <thead><tr><th>Name</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>users</td><td><span class="chip ok">passed</span></td></tr>
          <tr class="sel"><td>orders</td><td><span class="chip warn">slow</span></td></tr>
          <tr><td>payments</td><td><span class="chip bad">failed</span></td></tr>
        </tbody>
      </table>
      <pre class="pv-code"><span class="k">const</span> user = <span class="s">"devsnip"</span>; <span class="n">// 42</span></pre>
      <p class="pv-text">Body text, <span class="muted">muted text</span> and <a href="#" tabindex="-1">a link</a>.</p>
      <ul class="checks" id="checks" aria-label="Contrast checks"></ul>
    </div>
  </aside>
</main>
<div class="live" id="live" role="status" aria-live="polite"></div>
<script nonce="${nonce}">window.__STUDIO__ = ${embedJson(data)};</script>
<script nonce="${nonce}" src="${escapeHtml(o.scriptUri)}"></script>
</body>
</html>`;
}

export const STUDIO_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--ds-bg); color: var(--ds-fg); font-family: var(--ds-font-sans); font-size: var(--ds-text-md);
  line-height: 1.5; -webkit-font-smoothing: antialiased; padding: clamp(16px, 3vw, 32px);
}
h1 { margin: 0 0 4px; font-size: var(--ds-text-xl); letter-spacing: -.02em; display: flex; align-items: center; gap: 10px; }
h1 .codicon { font-size: 22px !important; color: var(--ds-accent); }
h2 { margin: 0; font-size: var(--ds-text-sm); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ds-muted); }
p { margin: 0; }
.hero { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--ds-space-4); max-width: 1180px; margin: 0 auto var(--ds-space-5); }
.hero p { color: var(--ds-muted); max-width: 62ch; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 380px); gap: var(--ds-space-5); max-width: 1180px; margin: 0 auto; align-items: start; }
.controls { display: grid; gap: var(--ds-space-4); min-width: 0; }
.card {
  background: var(--ds-surface); border: var(--ds-border-width) solid var(--ds-border); border-radius: var(--ds-radius-lg);
  padding: var(--ds-space-4); box-shadow: var(--ds-shadow-sm);
}
.card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-2); margin-bottom: var(--ds-space-3); }
.hint, .note, small { color: var(--ds-muted); font-size: var(--ds-text-xs); }
.note { display: flex; align-items: center; gap: 6px; margin-top: var(--ds-space-3); }
.note .codicon { color: var(--ds-success); }
.sticky { position: sticky; top: 16px; display: grid; gap: var(--ds-space-3); }
.sticky .card-head { margin-bottom: 0; }

.btn {
  display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 14px; border-radius: var(--ds-radius-md);
  border: 1px solid transparent; font: inherit; font-weight: 600; cursor: pointer;
  transition: background-color var(--ds-duration) var(--ds-ease), border-color var(--ds-duration) var(--ds-ease);
}
.btn.primary { background: var(--ds-accent); color: var(--ds-accent-fg); }
.btn.primary:hover { background: var(--ds-accent-hover); }
.btn.secondary { background: var(--vscode-button-secondaryBackground, var(--ds-surface-2)); color: var(--vscode-button-secondaryForeground, var(--ds-fg)); }
.btn.ghost { background: transparent; color: var(--ds-fg); border-color: var(--ds-border-strong); }
.btn.ghost:hover { background: var(--ds-surface-2); }
.link { background: none; border: 0; padding: 0; color: var(--ds-link); font: inherit; font-size: var(--ds-text-xs); cursor: pointer; }
.link:hover { text-decoration: underline; }
.link:disabled { color: var(--ds-muted); cursor: default; text-decoration: none; opacity: .6; }

.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--ds-space-3); }
.group-label { grid-column: 1 / -1; font-size: var(--ds-text-xs); font-weight: 600; color: var(--ds-muted); margin-top: var(--ds-space-1); }
.theme-card {
  position: relative; display: grid; gap: 8px; padding: 8px; text-align: left; cursor: pointer; color: var(--ds-fg); font: inherit;
  background: var(--ds-bg); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-lg);
  transition: border-color var(--ds-duration) var(--ds-ease), transform var(--ds-duration) var(--ds-ease), box-shadow var(--ds-duration) var(--ds-ease);
}
.theme-card:hover { border-color: var(--ds-border-strong); transform: translateY(-1px); box-shadow: var(--ds-shadow-md); }
.theme-card[aria-checked="true"] { border-color: var(--ds-accent); box-shadow: 0 0 0 1px var(--ds-accent); }
.theme-card.effective:not([aria-checked="true"]) { border-style: dashed; border-color: var(--ds-accent); }
.theme-card .name { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-weight: 600; font-size: var(--ds-text-sm); }
.theme-card .name .codicon { color: var(--ds-accent); visibility: hidden; }
.theme-card[aria-checked="true"] .name .codicon { visibility: visible; }
.theme-card .desc { font-size: var(--ds-text-xs); color: var(--ds-muted); line-height: 1.35; }
.theme-card .lock { font-size: 10.5px; color: var(--ds-warning); display: flex; align-items: center; gap: 4px; }
.mini { height: 64px; border-radius: calc(var(--ds-radius-lg) - 4px); overflow: hidden; display: grid; grid-template-columns: 26% 1fr; border: 1px solid rgba(127, 127, 127, .25); }
.mini .side { display: grid; align-content: start; gap: 4px; padding: 7px 5px; }
.mini .side i, .mini .main i { display: block; height: 4px; border-radius: 2px; }
.mini .main { display: grid; align-content: start; gap: 5px; padding: 7px 8px; }
.mini .main .row { display: flex; gap: 4px; align-items: center; }
.mini .main b { display: block; width: 26px; height: 9px; border-radius: 3px; }
.mini.system { grid-template-columns: 1fr 1fr; }
.mini.system span { display: grid; place-items: center; font-size: 10px; font-weight: 700; }

.switch-row { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; cursor: pointer; }
.switch-row input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.switch-row small { display: block; margin-top: 2px; }
.switch { position: relative; width: 34px; height: 20px; border-radius: 999px; background: var(--ds-border-strong); margin-top: 1px; transition: background-color var(--ds-duration) var(--ds-ease); }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--ds-bg); transition: transform var(--ds-duration) var(--ds-ease); }
.switch-row input:checked + .switch { background: var(--ds-accent); }
.switch-row input:checked + .switch::after { transform: translateX(14px); background: var(--ds-accent-fg); }
.switch-row input:focus-visible + .switch { outline: 2px solid var(--ds-focus); outline-offset: 2px; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--ds-space-3); margin-top: var(--ds-space-3); }
.pair[hidden] { display: none; }
label { display: grid; gap: 4px; font-size: var(--ds-text-xs); color: var(--ds-muted); font-weight: 600; }
select, input[type="text"] {
  width: 100%; min-height: 30px; padding: 4px 8px; font: inherit; font-size: var(--ds-text-md); font-weight: 400;
  color: var(--vscode-input-foreground, var(--ds-fg)); background: var(--vscode-input-background, var(--ds-bg));
  border: 1px solid var(--ds-border-strong); border-radius: var(--ds-radius-md);
}
select:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
.field { display: grid; gap: 8px; }
.field + .field { margin-top: var(--ds-space-4); }
.field-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--ds-text-sm); font-weight: 600; }
.field-label { font-size: var(--ds-text-sm); font-weight: 600; }
.field.disabled { opacity: .55; }
.swatches { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sw {
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--ds-surface); box-shadow: 0 0 0 1px var(--ds-border-strong);
  cursor: pointer; padding: 0; transition: transform var(--ds-duration) var(--ds-ease);
}
.sw:hover { transform: scale(1.08); }
.sw[aria-checked="true"] { box-shadow: 0 0 0 2px var(--ds-fg); }
.sw.custom { display: grid; place-items: center; overflow: hidden; position: relative; background: conic-gradient(#ff5c5c, #ffd25c, #5cff8a, #5cd2ff, #a35cff, #ff5cc8, #ff5c5c); }
.sw.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: 0; padding: 0; }
.color-row { display: flex; align-items: center; gap: 10px; }
input[type="color"] { width: 44px; height: 30px; padding: 2px; border: 1px solid var(--ds-border-strong); border-radius: var(--ds-radius-md); background: var(--ds-bg); cursor: pointer; }
input[type="color"]:disabled { cursor: not-allowed; }
.seg { display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 3px; border-radius: var(--ds-radius-md); background: var(--ds-bg); border: 1px solid var(--ds-border); width: fit-content; max-width: 100%; }
.seg button {
  border: 0; background: transparent; color: var(--ds-muted); font: inherit; font-size: var(--ds-text-sm); font-weight: 600;
  padding: 4px 12px; border-radius: calc(var(--ds-radius-md) - 2px); cursor: pointer;
  transition: background-color var(--ds-duration) var(--ds-ease), color var(--ds-duration) var(--ds-ease);
}
.seg button:hover { color: var(--ds-fg); }
.seg button[aria-checked="true"] { background: var(--ds-surface-2); color: var(--ds-fg); box-shadow: var(--ds-shadow-sm); }

.badge { font-size: var(--ds-text-xs); font-weight: 700; padding: 2px 8px; border-radius: var(--ds-radius-pill); background: var(--ds-accent); color: var(--ds-accent-fg); }
.chip { display: inline-block; font-size: var(--ds-text-xs); font-weight: 700; padding: 1px 8px; border-radius: var(--ds-radius-pill); color: var(--ds-on-status); }
.chip.ok { background: var(--ds-success); }
.chip.warn { background: var(--ds-warning); }
.chip.bad { background: var(--ds-danger); }
.pv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pv-form { display: grid; grid-template-columns: 1fr 76px; gap: 8px; }
.pv-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stat { display: grid; padding: 8px 10px; border-radius: var(--ds-radius-md); background: var(--ds-bg); border: 1px solid var(--ds-border); }
.stat .v { font-weight: 700; font-size: var(--ds-text-lg); font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.stat .l { font-size: var(--ds-text-xs); color: var(--ds-muted); }
.pv-table { width: 100%; border-collapse: collapse; font-size: var(--ds-text-sm); }
.pv-table th { text-align: left; color: var(--ds-muted); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--ds-border); }
.pv-table td { padding: 5px 8px; border-bottom: 1px solid var(--ds-border); }
.pv-table tr.sel td { background: var(--ds-selection); color: var(--vscode-list-activeSelectionForeground, var(--ds-fg)); }
.pv-code {
  margin: 0; padding: 8px 10px; border-radius: var(--ds-radius-md); font-family: var(--ds-font-mono); font-size: 12px; overflow-x: auto;
  background: var(--vscode-textCodeBlock-background, var(--ds-bg)); border: 1px solid var(--ds-border);
}
.pv-code .k { color: var(--vscode-debugTokenExpression-boolean, var(--ds-info)); }
.pv-code .s { color: var(--vscode-debugTokenExpression-string, var(--ds-warning)); }
.pv-code .n { color: var(--ds-muted); }
.pv-text { font-size: var(--ds-text-sm); }
.muted { color: var(--ds-muted); }
a { color: var(--ds-link); }
.checks { list-style: none; margin: 0; padding: var(--ds-space-3) 0 0; border-top: 1px solid var(--ds-border); display: grid; gap: 4px; font-size: var(--ds-text-xs); }
.checks li { display: flex; justify-content: space-between; gap: 8px; }
.checks .pass { color: var(--ds-success); font-weight: 700; }
.checks .fail { color: var(--ds-danger); font-weight: 700; }
.live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

@media (max-width: 820px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .sticky { position: static; }
}
@media (prefers-reduced-motion: reduce) {
  .theme-card:hover { transform: none; }
}
`;
