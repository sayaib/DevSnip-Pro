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

import { randomBytes } from "crypto";
import { findTheme, ThemeKind, themeRules, TRANSITION_RULES, validThemeId } from "./themes";

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
    `<script nonce="${n}">${RUNTIME.replace("__STATE__", () => state)}</script>`;
  // Function replacements, so a "$" in the injected text is never read as a replacement pattern.
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, () => `${block}</head>`);
  else if (/<body[\s>]/i.test(out)) out = out.replace(/<body([\s>])/i, (_m, after: string) => `${block}<body${after}`);
  else out = block + out;
  return out;
}
