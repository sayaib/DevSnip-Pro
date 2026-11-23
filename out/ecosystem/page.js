"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEcosystemPage = exports.cardOrder = void 0;
const webview_ui_1 = require("../utils/webview-ui");
const marks_1 = require("./marks");
const products_1 = require("./products");
/** The order cards appear in: the suggestion first, the app the user is in near the end. */
function cardOrder(focus) {
    const rank = (product) => (product === focus ? 0 : product.current ? 2 : 1);
    return [...products_1.ECOSYSTEM_PRODUCTS].sort((a, b) => rank(a) - rank(b));
}
exports.cardOrder = cardOrder;
function ctaLabel(product, platform) {
    if (product.id === "studio" && platform && platform !== "win32")
        return "View on Microsoft Store";
    return product.cta;
}
function card(product, options) {
    const featured = product === options.focus;
    const e = webview_ui_1.escapeHtml;
    const logo = options.logoUri
        ? `<img class="logo-img" src="${e(options.logoUri)}" alt="" width="40" height="40">`
        : (0, marks_1.platformMark)("brand", 40, "logo-img");
    const pill = featured
        ? `<span class="pill pill-accent"><span class="codicon codicon-sparkle" aria-hidden="true"></span>Suggested</span>`
        : product.current ? `<span class="pill"><span class="codicon codicon-check" aria-hidden="true"></span>Installed</span>` : "";
    const label = ctaLabel(product, options.platform);
    return `<article class="card${featured ? " featured" : ""}${product.current ? " current" : ""}" id="p-${product.id}" aria-labelledby="t-${product.id}">
  <div class="card-head">
    <span class="logo">${logo}<span class="logo-badge">${(0, marks_1.platformMark)(product.mark, 16)}</span></span>
    <div class="titles">
      <h3 id="t-${product.id}">${e(product.name)}</h3>
      <p class="kind">${e(product.kind)} · ${e(product.store)}</p>
    </div>
    ${pill}
  </div>
  ${featured && product.pitch ? `<p class="pitch">${e(product.pitch)} ${e(product.tagline)}</p>` : `<p class="tagline">${e(product.tagline)}</p>`}
  <p class="desc">${e(product.description)}</p>
  <ul class="features">${product.features.map(feature => `<li><span class="codicon codicon-check" aria-hidden="true"></span><span>${e(feature)}</span></li>`).join("")}</ul>
  <div class="card-foot">
    <span class="meta">${e(product.meta)}</span>
    <a class="cta${product.current ? " secondary" : ""}" href="${e(product.url)}" title="${e(product.url)}" aria-label="${e(`${label}: ${product.name} (opens ${product.store} in your browser)`)}">${(0, marks_1.platformMark)(product.mark, 16, "cta-mark")}<span>${e(label)}</span><span class="codicon codicon-link-external" aria-hidden="true"></span></a>
  </div>
</article>`;
}
function chip(product) {
    return `<li><a class="chip" href="#p-${product.id}">${(0, marks_1.platformMark)(product.mark, 18)}<span>${(0, webview_ui_1.escapeHtml)(product.platform)}</span>${product.current ? `<small>You're here</small>` : ""}</a></li>`;
}
function renderEcosystemPage(options) {
    const nonce = (0, webview_ui_1.getNonce)();
    const ordered = cardOrder(options.focus);
    // Chips list every platform in a fixed order so they read as a set.
    const chips = ["vscode", "jetbrains", "chrome", "studio"].map(id => products_1.ECOSYSTEM_PRODUCTS.find(p => p.id === id)).map(chip).join("");
    const heroLogo = options.logoUri
        ? `<img class="hero-logo" src="${(0, webview_ui_1.escapeHtml)(options.logoUri)}" alt="DevSnip Pro logo" width="56" height="56">`
        : (0, marks_1.platformMark)("brand", 56, "hero-logo");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource}; font-src ${options.cspSource}; style-src ${options.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DevSnip Pro Ecosystem</title>
<link rel="stylesheet" href="${(0, webview_ui_1.escapeHtml)(options.codiconsUri)}">
<style nonce="${nonce}">${ECOSYSTEM_CSS}</style>
</head>
<body>
<main class="eco">
  <header class="hero">
    ${heroLogo}
    <div class="hero-text">
      <p class="eyebrow">DevSnip Pro ecosystem</p>
      <h1>One toolkit, wherever you work</h1>
      <p class="lead">DevSnip Pro runs in your editor, your browser and on your desktop. Every app is free, with no account to create.</p>
    </div>
  </header>

  <section class="platforms" aria-labelledby="platformsTitle">
    <h2 id="platformsTitle"><span class="codicon codicon-layers" aria-hidden="true"></span>Available on multiple platforms</h2>
    <ul class="chips">${chips}</ul>
  </section>

  <section aria-labelledby="appsTitle">
    <h2 id="appsTitle" class="sr-only">DevSnip Pro apps</h2>
    <div class="grid">
${ordered.map(product => card(product, options)).join("\n")}
    </div>
  </section>

  <p class="foot"><span class="codicon codicon-info" aria-hidden="true"></span>Links open each app's official store page in your browser.</p>
</main>
</body>
</html>`;
}
exports.renderEcosystemPage = renderEcosystemPage;
const ECOSYSTEM_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { color: var(--ds-fg); background: var(--ds-bg); font-family: var(--ds-font-sans); font-size: var(--ds-text-md); line-height: 1.5; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.codicon { line-height: 1; }
.eco { max-width: 1120px; margin: 0 auto; padding: clamp(16px, 3vw, 32px); }

.hero {
  display: flex; align-items: center; gap: var(--ds-space-4); margin-bottom: var(--ds-space-4); padding: var(--ds-space-5);
  border-radius: var(--ds-radius-lg); border: var(--ds-border-width) solid var(--ds-border);
  background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--ds-accent) 16%, transparent), transparent 60%), var(--ds-surface);
}
.hero-logo { flex: none; width: 56px; height: 56px; border-radius: var(--ds-radius-lg); }
.hero-text { min-width: 0; }
.eyebrow { margin: 0; font-size: var(--ds-text-xs); font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ds-link); }
.hero h1 { margin: 2px 0 4px; font-size: 22px; line-height: 1.25; letter-spacing: -.02em; }
.lead { margin: 0; color: var(--ds-muted); max-width: 62ch; }

h2 { display: flex; align-items: center; gap: var(--ds-space-2); margin: 0 0 var(--ds-space-3); font-size: var(--ds-text-sm); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--ds-muted); }
.platforms { margin: var(--ds-space-2) 0 var(--ds-space-5); padding: var(--ds-space-4); border: var(--ds-border-width) solid var(--ds-border); border-radius: var(--ds-radius-lg); background: color-mix(in srgb, var(--ds-surface) 70%, transparent); }
.chips { display: flex; flex-wrap: wrap; gap: var(--ds-space-2); margin: 0; padding: 0; list-style: none; }
.chip {
  display: inline-flex; align-items: center; gap: var(--ds-space-2); height: 34px; padding: 0 var(--ds-space-3);
  border: var(--ds-border-width) solid var(--ds-border); border-radius: var(--ds-radius-pill); background: var(--ds-bg);
  color: var(--ds-fg); text-decoration: none; font-weight: 500;
  transition: border-color var(--ds-duration) var(--ds-ease), transform var(--ds-duration) var(--ds-ease), background-color var(--ds-duration) var(--ds-ease);
}
.chip small { font-size: var(--ds-text-xs); color: var(--ds-muted); }
.chip:hover { border-color: var(--ds-focus); background: var(--ds-surface-2); transform: translateY(-1px); }
.mark { flex: none; display: block; }

.grid { padding-top: 10px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: var(--ds-space-4); }
.card {
  position: relative; display: flex; flex-direction: column; gap: var(--ds-space-2); min-width: 0;
  padding: var(--ds-space-4); border: var(--ds-border-width) solid var(--ds-border); border-radius: var(--ds-radius-lg);
  background: var(--ds-surface); box-shadow: var(--ds-shadow-sm);
  animation: eco-rise .32s var(--ds-ease) both;
  transition: border-color var(--ds-duration) var(--ds-ease), box-shadow var(--ds-duration) var(--ds-ease), transform var(--ds-duration) var(--ds-ease);
}
.card:nth-child(2) { animation-delay: 40ms; }
.card:nth-child(3) { animation-delay: 80ms; }
.card:nth-child(4) { animation-delay: 120ms; }
.card:hover { border-color: var(--ds-border-strong); box-shadow: var(--ds-shadow-md); transform: translateY(-2px); }
.card:target { border-color: var(--ds-focus); }
.card.featured { border-color: color-mix(in srgb, var(--ds-focus) 70%, var(--ds-border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ds-focus) 35%, transparent), var(--ds-shadow-sm); }
@keyframes eco-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.card-head { display: flex; align-items: flex-start; gap: var(--ds-space-3); }
.logo { position: relative; flex: none; width: 40px; height: 40px; }
.logo-img { width: 40px; height: 40px; border-radius: var(--ds-radius-md); display: block; }
.logo-badge { position: absolute; right: -5px; bottom: -5px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--ds-bg); border: var(--ds-border-width) solid var(--ds-border); color: var(--ds-fg); }
.titles { flex: 1 1 auto; min-width: 0; }
.titles h3 { margin: 0; font-size: var(--ds-text-lg); line-height: 1.3; font-weight: 650; overflow-wrap: anywhere; }
.kind { margin: 2px 0 0; font-size: var(--ds-text-xs); color: var(--ds-muted); }
.pill { position: absolute; top: -10px; right: var(--ds-space-4); display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--ds-radius-pill); border: var(--ds-border-width) solid var(--ds-border); font-size: var(--ds-text-xs); font-weight: 600; line-height: 16px; color: var(--ds-muted); background: var(--ds-surface); white-space: nowrap; }
.pill .codicon { font-size: 12px; }
.pill-accent { border-color: transparent; background: var(--ds-accent); color: var(--ds-accent-fg); box-shadow: var(--ds-shadow-sm); }

.tagline, .pitch { margin: var(--ds-space-1) 0 0; font-weight: 600; }
.pitch { color: var(--ds-link); }
.desc { margin: 0; color: var(--ds-muted); }
.features { margin: var(--ds-space-1) 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.features li { display: flex; align-items: flex-start; gap: var(--ds-space-2); font-size: var(--ds-text-sm); }
.features .codicon { flex: none; margin-top: 2px; font-size: 14px; color: var(--ds-success); }

.card-foot { margin-top: auto; padding-top: var(--ds-space-3); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--ds-space-2); border-top: var(--ds-border-width) solid var(--ds-border); }
.meta { font-size: var(--ds-text-xs); color: var(--ds-muted); }
.cta {
  display: inline-flex; align-items: center; gap: var(--ds-space-2); min-height: 32px; padding: 0 var(--ds-space-3);
  border-radius: var(--ds-radius-md); border: var(--ds-border-width) solid transparent;
  background: var(--ds-accent); color: var(--ds-accent-fg); text-decoration: none; font-weight: 600; font-size: var(--ds-text-sm);
  transition: background-color var(--ds-duration) var(--ds-ease), transform var(--ds-duration) var(--ds-ease);
}
.cta:hover { background: var(--ds-accent-hover); }
.cta:active { transform: translateY(1px); }
.cta.secondary { background: transparent; color: var(--ds-fg); border-color: var(--ds-border-strong); }
.cta.secondary:hover { background: var(--ds-surface-2); }
.cta-mark { flex: none; padding: 1px; border-radius: 4px; background: #fff; color: #1f1f1f; }
.cta .codicon { font-size: 13px; opacity: .8; }

.foot { display: flex; align-items: center; gap: var(--ds-space-2); margin: var(--ds-space-5) 0 0; font-size: var(--ds-text-xs); color: var(--ds-muted); }
@media (max-width: 520px) {
  .hero { align-items: flex-start; padding: var(--ds-space-4); }
  .hero-logo { width: 44px; height: 44px; }
  .hero h1 { font-size: 19px; }
}
@media (prefers-reduced-motion: reduce) {
  .card, .chip, .cta { animation: none; transition: none; }
  .card:hover, .chip:hover { transform: none; }
}
@media (forced-colors: active) {
  .card, .chip, .platforms { border: 1px solid CanvasText; }
}
`;
//# sourceMappingURL=page.js.map