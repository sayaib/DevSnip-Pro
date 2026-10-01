import { ToolInputError } from "../types";

/**
 * Frontend helpers: HTML/SVG → JSX, SEO / social meta tags, and CSS units
 * (px ↔ rem, fluid clamp(), type scales).
 */

// ---------------------------------------------------------------------------
// HTML → JSX
// ---------------------------------------------------------------------------

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const ATTR_MAP: Record<string, string> = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", maxlength: "maxLength", minlength: "minLength",
  colspan: "colSpan", rowspan: "rowSpan", cellpadding: "cellPadding", cellspacing: "cellSpacing", crossorigin: "crossOrigin",
  autocomplete: "autoComplete", autofocus: "autoFocus", autoplay: "autoPlay", enctype: "encType", contenteditable: "contentEditable",
  spellcheck: "spellCheck", srcset: "srcSet", srcdoc: "srcDoc", usemap: "useMap", frameborder: "frameBorder", allowfullscreen: "allowFullScreen",
  novalidate: "noValidate", datetime: "dateTime", "accept-charset": "acceptCharset", "http-equiv": "httpEquiv", charset: "charSet",
  playsinline: "playsInline", formaction: "formAction", formmethod: "formMethod", formnovalidate: "formNoValidate", formtarget: "formTarget",
  hreflang: "hrefLang", inputmode: "inputMode", accesskey: "accessKey", referrerpolicy: "referrerPolicy", enterkeyhint: "enterKeyHint",
  marginwidth: "marginWidth", marginheight: "marginHeight", "xlink:href": "xlinkHref", "xml:lang": "xmlLang", "xml:space": "xmlSpace",
  "xmlns:xlink": "xmlnsXlink", viewbox: "viewBox", preserveaspectratio: "preserveAspectRatio", fetchpriority: "fetchPriority",
  nomodule: "noModule", itemprop: "itemProp", itemscope: "itemScope", itemtype: "itemType", popovertarget: "popoverTarget"
};

/** SVG presentation attributes are written in kebab-case in HTML and camelCase in React. */
const KEEP_HYPHEN = /^(data-|aria-)/;

const EVENT_MAP: Record<string, string> = { ondblclick: "onDoubleClick", onkeydown: "onKeyDown", onkeyup: "onKeyUp", onkeypress: "onKeyPress", onmouseenter: "onMouseEnter", onmouseleave: "onMouseLeave", onmousedown: "onMouseDown", onmouseup: "onMouseUp", onmouseover: "onMouseOver", onmouseout: "onMouseOut", onmousemove: "onMouseMove", ontouchstart: "onTouchStart", ontouchend: "onTouchEnd", ontouchmove: "onTouchMove", oncontextmenu: "onContextMenu", onpointerdown: "onPointerDown", onpointerup: "onPointerUp" };

function jsxAttrName(name: string): string {
  const lower = name.toLowerCase();
  if (ATTR_MAP[lower]) return ATTR_MAP[lower];
  if (KEEP_HYPHEN.test(lower)) return lower;
  if (/^on[a-z]+$/.test(lower)) return EVENT_MAP[lower] ?? `on${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
  if (name.includes("-") || name.includes(":")) return name.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
  return name;
}

export function styleToObject(style: string): string {
  const entries = style.split(";").map(s => s.trim()).filter(Boolean).map(decl => {
    const colon = decl.indexOf(":");
    if (colon < 0) return undefined;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    const key = prop.startsWith("--") ? JSON.stringify(prop) : prop.toLowerCase().replace(/^-ms-/, "ms-").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const literal = /^-?\d+(\.\d+)?$/.test(value) ? value : JSON.stringify(value);
    return `${key}: ${literal}`;
  }).filter(Boolean);
  return `{{ ${entries.join(", ")} }}`;
}

type Node = { type: "text"; value: string } | { type: "comment"; value: string } | { type: "element"; tag: string; attrs: Array<[string, string | true]>; children: Node[] };

function parseHtml(html: string, warnings: Set<string>): Node[] {
  const root: Node[] = [];
  const stack: Array<{ tag: string; children: Node[] }> = [{ tag: "#root", children: root }];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      const stop = end < 0 ? html.length : end;
      top().children.push({ type: "comment", value: html.slice(i + 4, stop).trim() });
      i = stop + 3;
      continue;
    }
    if (/^<!doctype/i.test(html.slice(i, i + 9)) || html.startsWith("<?", i)) {
      i = html.indexOf(">", i) + 1 || html.length;
      continue;
    }
    if (html.startsWith("</", i)) {
      const end = html.indexOf(">", i);
      const tag = html.slice(i + 2, end < 0 ? html.length : end).trim().toLowerCase();
      i = end < 0 ? html.length : end + 1;
      const idx = stack.map(s => s.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      else warnings.add(`Ignored a stray closing tag </${tag}>.`);
      continue;
    }
    if (html[i] === "<" && /[A-Za-z]/.test(html[i + 1] ?? "")) {
      const m = /^<([A-Za-z][\w:.-]*)/.exec(html.slice(i))!;
      const tagRaw = m[1];
      const tag = /[A-Z]/.test(tagRaw.slice(1)) && !/^(foreignObject|clipPath|linearGradient|radialGradient|textPath|feGaussianBlur|feOffset|feBlend|feColorMatrix|feComposite|feFlood|feMerge|feMergeNode|animateTransform)$/.test(tagRaw) ? tagRaw.toLowerCase() : tagRaw;
      let j = i + m[0].length;
      const attrs: Array<[string, string | true]> = [];
      let selfClosing = false;
      while (j < html.length) {
        while (/\s/.test(html[j] ?? "")) j++;
        if (html[j] === ">") { j++; break; }
        if (html.startsWith("/>", j)) { selfClosing = true; j += 2; break; }
        const an = /^[^\s=>/]+/.exec(html.slice(j));
        if (!an) { j++; continue; }
        const name = an[0];
        j += name.length;
        while (/\s/.test(html[j] ?? "")) j++;
        if (html[j] === "=") {
          j++;
          while (/\s/.test(html[j] ?? "")) j++;
          const q = html[j];
          let value: string;
          if (q === '"' || q === "'") {
            const end = html.indexOf(q, j + 1);
            value = html.slice(j + 1, end < 0 ? html.length : end);
            j = end < 0 ? html.length : end + 1;
          } else {
            const vm = /^[^\s>]+/.exec(html.slice(j));
            value = vm ? vm[0] : "";
            j += value.length;
          }
          attrs.push([name, value]);
        } else attrs.push([name, true]);
      }
      const el: Node = { type: "element", tag, attrs, children: [] };
      top().children.push(el);
      i = j;
      const lower = tag.toLowerCase();
      if (lower === "script" || lower === "style" || lower === "textarea" || lower === "pre") {
        const close = html.toLowerCase().indexOf(`</${lower}`, i);
        const content = html.slice(i, close < 0 ? html.length : close);
        if (content) el.children.push({ type: "text", value: content });
        i = close < 0 ? html.length : html.indexOf(">", close) + 1;
        continue;
      }
      if (!selfClosing && !VOID.has(lower)) stack.push({ tag: lower === tag.toLowerCase() ? tag.toLowerCase() : tag, children: el.children });
      continue;
    }
    const next = html.indexOf("<", i + 1);
    const stop = next < 0 ? html.length : next;
    top().children.push({ type: "text", value: html.slice(i, stop) });
    i = stop;
  }
  if (stack.length > 1) warnings.add(`Unclosed tag${stack.length > 2 ? "s" : ""}: ${stack.slice(1).map(s => `<${s.tag}>`).join(", ")} (closed automatically).`);
  return root;
}

function escapeJsxText(text: string): string {
  return text.replace(/[{}<>]/g, c => `{${JSON.stringify(c)}}`);
}

export interface JsxOptions { wrap: "none" | "component"; name: string; typescript: boolean; reactNativeHint?: boolean }

export function htmlToJsx(html: string, o: JsxOptions): { code: string; warnings: string[] } {
  if (!html.trim()) throw new ToolInputError("Paste some HTML or SVG.");
  const warnings = new Set<string>();
  let nodes = parseHtml(html, warnings);
  // Unwrap html/head/body: a component renders inside <body>.
  const unwrap = (list: Node[]): Node[] => list.flatMap(n => n.type === "element" && ["html", "body"].includes(n.tag.toLowerCase()) ? (warnings.add(`Removed <${n.tag}>: a React component renders inside <body>.`), unwrap(n.children)) : n.type === "element" && n.tag.toLowerCase() === "head" ? (warnings.add("Removed <head>: use next/head, the Next.js Metadata API or react-helmet for title and meta tags."), []) : [n]);
  nodes = unwrap(nodes);
  const meaningful = nodes.filter(n => !(n.type === "text" && !n.value.trim()));
  const render = (n: Node, depth: number): string => {
    const pad = "  ".repeat(depth);
    if (n.type === "comment") return n.value ? `${pad}{/* ${n.value.replace(/\*\//g, "* /")} */}` : "";
    if (n.type === "text") {
      const t = n.value.replace(/\s+/g, " ");
      if (!t.trim()) return "";
      return `${pad}${escapeJsxText(t.trim())}`;
    }
    const tagLower = n.tag.toLowerCase();
    const attrs: string[] = [];
    for (const [rawName, value] of n.attrs) {
      let name = jsxAttrName(rawName);
      if (/^on[A-Z]/.test(name)) {
        const handler = value === true ? "" : value.trim().replace(/;$/, "");
        if (/\b(this|event)\b/.test(handler) || !handler) {
          attrs.push(`${name}={() => { /* ${handler.replace(/\*\//g, "* /")} */ }}`);
          warnings.add(`Inline handlers that use this/event were commented out (${rawName}); rewrite them as functions.`);
        } else {
          attrs.push(`${name}={() => { ${handler}; }}`);
          warnings.add("Inline event handlers were converted to arrow functions - move the logic into the component.");
        }
        continue;
      }
      if (name === "style" && typeof value === "string") { attrs.push(`style=${styleToObject(value)}`); continue; }
      if (tagLower === "input" || tagLower === "select") {
        if (name === "value") { name = "defaultValue"; warnings.add("value → defaultValue on inputs (an uncontrolled input; use value + onChange for a controlled one)."); }
        if (name === "checked") { name = "defaultChecked"; warnings.add("checked → defaultChecked (use checked + onChange for a controlled checkbox)."); }
      }
      if (tagLower === "option" && name === "selected") { warnings.add("Removed selected on <option>: set defaultValue (or value) on the <select> instead."); continue; }
      if (value === true) attrs.push(name);
      else if (/^(tabIndex|colSpan|rowSpan|maxLength|minLength|rows|cols|size)$/.test(name) && /^\d+$/.test(value)) attrs.push(`${name}={${value}}`);
      else attrs.push(`${name}=${/["\\]/.test(value) || /\n/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`}`);
    }
    const open = `<${n.tag}${attrs.length ? " " + attrs.join(" ") : ""}`;
    if (tagLower === "script") { warnings.add("Script tags do not run when rendered by React; load scripts with next/script or useEffect."); return `${pad}{/* script removed: ${(n.children[0] as { value?: string })?.value?.trim().slice(0, 60).replace(/\*\//g, "") ?? ""} */}`; }
    if (tagLower === "style") {
      const css = n.children.map(c => (c.type === "text" ? c.value : "")).join("").trim();
      warnings.add("<style> was kept as a template literal; prefer a CSS module or global stylesheet.");
      return `${pad}${open}>{\`${css.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`}</${n.tag}>`;
    }
    if (tagLower === "textarea") {
      const t = n.children.map(c => (c.type === "text" ? c.value : "")).join("");
      return `${pad}${open}${t ? ` defaultValue={${JSON.stringify(t)}}` : ""} />`;
    }
    if (tagLower === "pre") {
      const t = n.children.map(c => (c.type === "text" ? c.value : "")).join("");
      return `${pad}${open}>{${JSON.stringify(t)}}</${n.tag}>`;
    }
    const children = n.children.map(c => render(c, depth + 1)).filter(Boolean);
    if (!children.length) return `${pad}${open} />`;
    const inlineText = children.length === 1 && n.children.every(c => c.type === "text") && children[0].trim().length < 60;
    if (inlineText) return `${pad}${open}>${children[0].trim()}</${n.tag}>`;
    return `${pad}${open}>\n${children.join("\n")}\n${pad}</${n.tag}>`;
  };
  const multiple = meaningful.filter(n => n.type !== "comment").length > 1 || meaningful.some(n => n.type === "text");
  const depth = o.wrap === "component" ? 2 : 0;
  let body = meaningful.map(n => render(n, multiple ? depth + 1 : depth)).filter(Boolean).join("\n");
  if (multiple) body = `${"  ".repeat(depth)}<>\n${body}\n${"  ".repeat(depth)}</>`;
  if (o.wrap === "none") return { code: body + "\n", warnings: [...warnings] };
  const name = (o.name.trim() || "Component").replace(/[^A-Za-z0-9_]/g, "").replace(/^[a-z]/, c => c.toUpperCase()) || "Component";
  const code = `export default function ${name}() {\n  return (\n${body}\n  );\n}\n`;
  return { code, warnings: [...warnings] };
}

// ---------------------------------------------------------------------------
// Meta tags
// ---------------------------------------------------------------------------

export interface MetaOptions {
  title: string;
  description: string;
  url: string;
  image: string;
  siteName: string;
  twitter: string;
  locale: string;
  themeColor: string;
  type: "website" | "article" | "product";
  index: boolean;
  author?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function metaTags(o: MetaOptions): { html: string; next: string; jsonLd: string; robots: string; manifest: string; warnings: string[] } {
  const warnings: string[] = [];
  if (o.title.length > 60) warnings.push(`The title is ${o.title.length} characters; search results cut it around 60.`);
  if (o.title.length < 15) warnings.push("The title is very short; aim for 30-60 characters with the main keyword first.");
  if (o.description.length > 160) warnings.push(`The description is ${o.description.length} characters; Google trims around 155-160.`);
  if (o.description.length < 70) warnings.push("The description is short; 120-160 characters makes a better snippet.");
  const abs = (u: string) => /^https?:\/\//.test(u);
  if (o.image && !abs(o.image)) warnings.push("og:image must be an absolute https URL, or Facebook, LinkedIn, Slack and X will not show it.");
  if (o.url && !abs(o.url)) warnings.push("The canonical URL must be absolute (https://...).");
  warnings.push("Social images: 1200×630 px (1.91:1), under 5 MB, PNG or JPG. X large cards use the same size.");
  const t = `@${o.twitter.replace(/^@/, "")}`;
  const lines = [
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.description)}">`,
    ...(o.author ? [`<meta name="author" content="${esc(o.author)}">`] : []),
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="robots" content="${o.index ? "index, follow" : "noindex, nofollow"}">`,
    ...(o.url ? [`<link rel="canonical" href="${esc(o.url)}">`] : []),
    `<meta name="theme-color" content="${esc(o.themeColor)}">`,
    "",
    "<!-- Open Graph (Facebook, LinkedIn, Slack, WhatsApp, iMessage) -->",
    `<meta property="og:type" content="${o.type}">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    ...(o.url ? [`<meta property="og:url" content="${esc(o.url)}">`] : []),
    ...(o.image ? [`<meta property="og:image" content="${esc(o.image)}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta property="og:image:alt" content="${esc(o.title)}">`] : []),
    `<meta property="og:site_name" content="${esc(o.siteName)}">`,
    `<meta property="og:locale" content="${esc(o.locale)}">`,
    "",
    "<!-- X / Twitter -->",
    `<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}">`,
    ...(o.twitter ? [`<meta name="twitter:site" content="${esc(t)}">`] : []),
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
    ...(o.image ? [`<meta name="twitter:image" content="${esc(o.image)}">`] : []),
    "",
    "<!-- Icons and PWA -->",
    `<link rel="icon" href="/favicon.ico" sizes="32x32">`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `<link rel="manifest" href="/site.webmanifest">`
  ];
  const origin = abs(o.url) ? new URL(o.url).origin : "https://example.com";
  const js = JSON.stringify;
  const next = `import type { Metadata, Viewport } from "next";\n\nexport const metadata: Metadata = {\n  metadataBase: new URL(${js(origin)}),\n  title: ${js(o.title)},\n  description: ${js(o.description)},\n${o.author ? `  authors: [{ name: ${js(o.author)} }],\n` : ""}  alternates: { canonical: ${js(abs(o.url) ? new URL(o.url).pathname : "/")} },\n  robots: { index: ${o.index}, follow: ${o.index} },\n  openGraph: {\n    type: ${js(o.type === "product" ? "website" : o.type)},\n    title: ${js(o.title)},\n    description: ${js(o.description)},\n    url: ${js(o.url || "/")},\n    siteName: ${js(o.siteName)},\n    locale: ${js(o.locale)},\n${o.image ? `    images: [{ url: ${js(o.image)}, width: 1200, height: 630, alt: ${js(o.title)} }],\n` : ""}  },\n  twitter: {\n    card: ${js(o.image ? "summary_large_image" : "summary")},\n${o.twitter ? `    site: ${js(t)},\n` : ""}    title: ${js(o.title)},\n    description: ${js(o.description)},\n${o.image ? `    images: [${js(o.image)}],\n` : ""}  },\n};\n\nexport const viewport: Viewport = {\n  themeColor: ${js(o.themeColor)},\n};\n`;
  const ld: Record<string, unknown> = o.type === "article"
    ? { "@context": "https://schema.org", "@type": "Article", headline: o.title, description: o.description, image: o.image ? [o.image] : undefined, author: o.author ? { "@type": "Person", name: o.author } : undefined, publisher: { "@type": "Organization", name: o.siteName }, mainEntityOfPage: o.url || undefined, datePublished: new Date().toISOString().slice(0, 10) }
    : o.type === "product"
      ? { "@context": "https://schema.org", "@type": "Product", name: o.title, description: o.description, image: o.image ? [o.image] : undefined, brand: { "@type": "Brand", name: o.siteName }, offers: { "@type": "Offer", price: "0.00", priceCurrency: "USD", availability: "https://schema.org/InStock", url: o.url || undefined } }
      : { "@context": "https://schema.org", "@type": "WebSite", name: o.siteName, url: o.url || origin, description: o.description };
  const jsonLd = JSON.stringify(ld, null, 2);
  const robots = `User-agent: *\n${o.index ? "Allow: /\nDisallow: /api/\n" : "Disallow: /\n"}\nSitemap: ${origin}/sitemap.xml\n`;
  const manifest = JSON.stringify({ name: o.siteName, short_name: o.siteName.slice(0, 12), description: o.description, start_url: "/", display: "standalone", background_color: "#ffffff", theme_color: o.themeColor, icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] }, null, 2);
  return { html: lines.join("\n") + "\n", next, jsonLd: `<script type="application/ld+json">\n${jsonLd}\n</script>\n`, robots, manifest, warnings };
}

// ---------------------------------------------------------------------------
// CSS units
// ---------------------------------------------------------------------------

export function parseCssValues(input: string): Array<{ value: number; unit: string; raw: string }> {
  return input.split(/[\s,;]+/).filter(Boolean).map(raw => {
    const m = /^(-?\d*\.?\d+)(px|rem|em|pt|%|vw|vh)?$/i.exec(raw.trim());
    if (!m) throw new ToolInputError(`"${raw}" is not a CSS length (e.g. 16px, 1.5rem, 12pt).`);
    return { value: Number(m[1]), unit: (m[2] ?? "px").toLowerCase(), raw };
  });
}

const round = (n: number, d = 4) => Number(n.toFixed(d)).toString();

export function convertUnits(input: string, rootPx: number, parentPx: number, viewportPx: number): Array<Array<string | number>> {
  return parseCssValues(input).map(v => {
    const px = v.unit === "px" ? v.value : v.unit === "rem" ? v.value * rootPx : v.unit === "em" ? v.value * parentPx : v.unit === "pt" ? v.value * 4 / 3 : v.unit === "%" ? v.value / 100 * parentPx : v.value / 100 * viewportPx;
    return [v.raw, `${round(px, 2)}px`, `${round(px / rootPx)}rem`, `${round(px / parentPx)}em`, `${round(px * 0.75, 2)}pt`, `${round(px / viewportPx * 100, 3)}vw`];
  });
}

/** clamp() that is minSize at minViewport and maxSize at maxViewport, linear in between. */
export function fluidClamp(minPx: number, maxPx: number, minVw: number, maxVw: number, rootPx: number): { css: string; slope: number; intercept: number } {
  if (maxVw <= minVw) throw new ToolInputError("The maximum viewport must be larger than the minimum viewport.");
  const slope = (maxPx - minPx) / (maxVw - minVw);
  const intercept = minPx - slope * minVw;
  const lo = Math.min(minPx, maxPx) / rootPx;
  const hi = Math.max(minPx, maxPx) / rootPx;
  const css = `clamp(${round(lo)}rem, ${round(intercept / rootPx)}rem + ${round(slope * 100)}vw, ${round(hi)}rem)`;
  return { css, slope, intercept };
}

export const TYPE_RATIOS: Array<[string, number, string]> = [["1.067", 1.067, "Minor second"], ["1.125", 1.125, "Major second"], ["1.2", 1.2, "Minor third"], ["1.25", 1.25, "Major third"], ["1.333", 1.333, "Perfect fourth"], ["1.414", 1.414, "Augmented fourth"], ["1.5", 1.5, "Perfect fifth"], ["1.618", 1.618, "Golden ratio"]];

export function typeScale(basePx: number, ratio: number, rootPx: number, fluid: { minVw: number; maxVw: number; minRatio: number } | undefined): { rows: Array<Array<string | number>>; css: string; tailwind: string } {
  const names = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
  const steps = [-2, -1, 0, 1, 2, 3, 4, 5, 6];
  const rows: Array<Array<string | number>> = [];
  const vars: string[] = [];
  const tw: string[] = [];
  steps.forEach((s, i) => {
    const px = basePx * ratio ** s;
    let value = `${round(px / rootPx)}rem`;
    if (fluid) {
      const minPx = basePx * fluid.minRatio ** s;
      value = fluidClamp(minPx, px, fluid.minVw, fluid.maxVw, rootPx).css;
      rows.push([names[i], `${round(minPx, 1)}px → ${round(px, 1)}px`, value]);
    } else rows.push([names[i], `${round(px, 1)}px`, value]);
    vars.push(`  --text-${names[i]}: ${value};`);
    tw.push(`        ${JSON.stringify(names[i])}: ${JSON.stringify(value)},`);
  });
  return { rows, css: `:root {\n${vars.join("\n")}\n}\n`, tailwind: `// tailwind.config.js (v3). In Tailwind v4 put the CSS variables above in @theme instead.\nmodule.exports = {\n  theme: {\n    extend: {\n      fontSize: {\n${tw.join("\n")}\n      },\n    },\n  },\n};\n` };
}
