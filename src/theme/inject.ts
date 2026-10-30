/**
 * Adds the appearance theme to a webview's HTML.
 *
 * Every DevSnip Pro page goes through `injectTheme` (via setWebviewHtml), which
 * adds two style blocks and a tiny runtime script, and extends the page's CSP
 * with one nonce so they are allowed. Later theme changes arrive as a message
 * and are applied through the CSSOM (no reload, no lost state, and nothing
 * that a nonce-based style-src would block).
 *
 * Pure (no vscode import), so it is unit tested directly.
 */

import { EXECUTION_CSS, EXECUTION_RUNTIME } from "./execution";
import { randomBytes } from "../platform/random";
import { findTheme, ThemeKind, themeRules, TRANSITION_RULES, validThemeId } from "./themes";

/** Shared interaction and layout treatment, scoped to existing panel components. */
const EXPERIENCE_CSS = `
:root { --ds-control-radius: 8px; }
:where(button, a, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 3px;
}
:where(button, input, select, textarea) { font: inherit; }
:where(button):disabled { cursor: not-allowed; opacity: .5; }
body .tool-body { width: 100%; padding: clamp(16px, 3vw, 32px); }
body .section { border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.04); }
body .tool-header { flex-wrap: wrap; row-gap: 6px; }
body .tool-header h1 { letter-spacing: -.025em; white-space: normal; }
body .btn { min-height: 32px; border-radius: var(--ds-control-radius); }
:where(.input, textarea, select, input[type="text"], input[type="number"]) { border-radius: var(--ds-control-radius); }
body .panels { grid-template-columns: repeat(2, minmax(0, 1fr)); }
:where(.panels > *, .layout > *) { min-width: 0; }
:where(.stat) { border-radius: 12px; font-variant-numeric: tabular-nums; }
:where(.stat .v) { letter-spacing: -.035em; }
body .result-block { overflow-wrap: anywhere; word-break: normal; }
:where(.out, .section) { transition: border-color .18s ease; }
:where(.out, .section):focus-within { border-color: var(--vscode-focusBorder, #007fd4); }
@media (hover: hover) {
  :where(.btn:not(:disabled)):hover { filter: brightness(1.08); }
  :where(.btn:not(:disabled)):active { transform: translateY(1px); }
}
@media (max-width: 600px) {
  body .panels { grid-template-columns: minmax(0, 1fr); }
  body .tool-header { padding: 14px 16px; }
  :where(.btn-row) { gap: 8px; }
  :where(.toast-container) { max-width: calc(100vw - 24px); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
@media (forced-colors: active) {
  :where(.card, .section, .stat, .category-preview) { border: 1px solid CanvasText; }
}
`;

export const THEME_MESSAGE = "devsnip:theme";

export type ThemeSurface = "panel" | "sidebar";

export interface ThemeMessage {
  type: typeof THEME_MESSAGE;
  id: string;
  /** null for System Default: VS Code's own theme kind stays in charge. */
  kind: ThemeKind | null;
  rules: string[];
}

export function themeMessage(themeId: string, surface: ThemeSurface): ThemeMessage {
  const id = validThemeId(themeId);
  return { type: THEME_MESSAGE, id, kind: findTheme(id)?.palette.kind ?? null, rules: themeRules(id, surface) };
}

/**
 * Applies theme updates inside the webview. Plain ES5 so it runs in any page.
 * It also mirrors the theme's light/dark/high-contrast kind onto the body's
 * `vscode-*` classes, which some stylesheets key off, and restores VS Code's
 * own classes for System Default.
 */
const RUNTIME = `(function () {
  var MANAGED = ["vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light"];
  var KIND_CLASS = { dark: "vscode-dark", light: "vscode-light", hc: "vscode-high-contrast" };
  var state = __STATE__;
  var vsClasses = null;
  var timer = 0;
  function present() {
    var b = document.body;
    return MANAGED.filter(function (c) { return b.classList.contains(c); });
  }
  function target() { return state.kind ? [KIND_CLASS[state.kind]] : (vsClasses || []); }
  function same(a, b) { return a.length === b.length && a.every(function (c) { return b.indexOf(c) >= 0; }); }
  function syncBody() {
    var b = document.body;
    if (!b) return;
    if (vsClasses === null) vsClasses = present();
    var want = target();
    MANAGED.forEach(function (c) {
      var on = want.indexOf(c) >= 0;
      if (b.classList.contains(c) !== on) b.classList.toggle(c, on);
    });
    document.documentElement.setAttribute("data-devsnip-theme", state.id);
  }
  function watch() {
    syncBody();
    if (!window.MutationObserver || !document.body) return;
    // VS Code rewrites the body classes when its own theme changes: remember them, then re-apply ours.
    new MutationObserver(function () {
      var now = present();
      if (same(now, target())) return;
      vsClasses = now;
      syncBody();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "${THEME_MESSAGE}" || !data.rules) return;
    var el = document.getElementById("devsnip-theme");
    var sheet = el && el.sheet;
    if (!sheet) return;
    var root = document.documentElement;
    // Only a page someone is looking at fades; hidden panels switch at once instead of animating unseen.
    var fade = !document.hidden;
    if (fade) root.classList.add("ds-theme-switching");
    while (sheet.cssRules.length) sheet.deleteRule(0);
    data.rules.forEach(function (rule) { try { sheet.insertRule(rule, sheet.cssRules.length); } catch (e) { /* skip a rule the engine rejects */ } });
    state = { id: data.id, kind: data.kind };
    syncBody();
    clearTimeout(timer);
    if (fade) timer = setTimeout(function () { root.classList.remove("ds-theme-switching"); }, 320);
  });
})();`;

function nonce(): string {
  return randomBytes(16).toString("base64").replace(/[^A-Za-z0-9]/g, "");
}

/** Allows `nonceValue` for scripts, and for styles unless the policy already allows inline styles. */
export function extendCsp(policy: string, nonceValue: string): string {
  const directives = policy.split(";").map(d => d.trim()).filter(Boolean);
  const token = `'nonce-${nonceValue}'`;
  const find = (name: string) => directives.findIndex(d => d.toLowerCase().split(/\s+/)[0] === name);
  for (const name of ["script-src", "style-src"]) {
    const i = find(name);
    if (i < 0) {
      directives.push(`${name} ${token}`);
      continue;
    }
    // A nonce disables 'unsafe-inline', so a policy that already allows inline styles is left alone.
    if (name === "style-src" && /'unsafe-inline'/i.test(directives[i])) continue;
    directives[i] = `${directives[i]} ${token}`;
  }
  return directives.join("; ") + ";";
}

/** Returns `html` with the current theme applied and live theme switching wired in. */
export function injectTheme(html: string, themeId: string, surface: ThemeSurface = "panel"): string {
  const n = nonce();
  const message = themeMessage(themeId, surface);
  let out = html.replace(
    /(<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=")([^"]*)(")/i,
    (_m, open: string, policy: string, close: string) => open + extendCsp(policy, n) + close
  );
  const state = JSON.stringify({ id: message.id, kind: message.kind }).replace(/</g, "\\u003c");
  const block =
    `<style id="devsnip-theme" nonce="${n}">${message.rules.join("\n")}</style>` +
    `<style id="devsnip-theme-motion" nonce="${n}">${TRANSITION_RULES.join("\n")}</style>` +
    `<style id="devsnip-experience" nonce="${n}">${EXPERIENCE_CSS}${EXECUTION_CSS}</style>` +
    `<script nonce="${n}">${EXECUTION_RUNTIME}${RUNTIME.replace("__STATE__", () => state)}</script>`;
  // Function replacements, so a "$" in the injected text is never read as a replacement pattern.
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, () => `${block}</head>`);
  else if (/<body[\s>]/i.test(out)) out = out.replace(/<body([\s>])/i, (_m, after: string) => `${block}<body${after}`);
  else out = block + out;
  return out;
}
