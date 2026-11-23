import type { SectionId } from "../toolkits/layout";

/**
 * The DevSnip Pro family of apps, shown by "Explore DevSnip Pro Ecosystem"
 * (src/ecosystem/page.ts) and the "Available on multiple platforms" strip at
 * the foot of the Tools sidebar.
 *
 * Pure data with no vscode import: the sidebar reads it during activation and
 * the unit tests read it directly. Links are the official store pages, checked
 * on 2026-11-23; pages only ever open a URL from this list, by product id.
 */

export type ProductId = "vscode" | "jetbrains" | "chrome" | "studio";

/** Which inline platform mark to draw (src/ecosystem/marks.ts). */
export type PlatformMark = "vscode" | "jetbrains" | "chrome" | "msstore" | "brand";

export interface EcosystemProduct {
  id: ProductId;
  /** Full product name, as on its store page. */
  name: string;
  /** Short name for tight spaces (the sidebar list). */
  short: string;
  /** The platform in one word: "Chrome", "Windows"... */
  platform: string;
  /** Where it runs: "Chrome extension", "Windows app"... */
  kind: string;
  /** The store or site the link goes to. */
  store: string;
  mark: PlatformMark;
  /** One line. */
  tagline: string;
  description: string;
  features: string[];
  /** Price and requirements, e.g. "Free · Windows 10/11". */
  meta: string;
  url: string;
  /** Button label for the store link. */
  cta: string;
  /** True for the app the user is in right now. */
  current?: boolean;
  /** Tool sections whose users this product suits best; drives the contextual suggestion. */
  sections: SectionId[];
  /** A few words on what it adds, for the sidebar list. */
  blurb: string;
  /** Why it is suggested, e.g. "Working with databases?". */
  pitch?: string;
  /** The sidebar's line while it is suggested. */
  nudge?: string;
}

export const ECOSYSTEM_PRODUCTS: readonly EcosystemProduct[] = [
  {
    id: "studio",
    name: "DevSnip Pro: Database Studio",
    short: "Database Studio",
    platform: "Windows",
    kind: "Windows app",
    store: "Microsoft Store",
    mark: "msstore",
    tagline: "The Database Client as a standalone Windows app.",
    description: "Connect, browse, edit and query PostgreSQL, MySQL, MongoDB, Redis and more from one modern workspace, with no editor needed.",
    features: [
      "SQL query editor with a fast, sortable results grid",
      "Browse tables and collections, edit rows in place, manage schemas",
      "Read-only connections; destructive statements ask first",
      "Passwords kept in the Windows keychain"
    ],
    meta: "Free · Windows 10/11",
    url: "https://apps.microsoft.com/detail/9n1dx0bjcxdx?cid=DevShareMCLPCS",
    cta: "Get it from Microsoft Store",
    sections: ["database", "spreadsheets", "data"],
    blurb: "Windows app for your databases",
    pitch: "Working with databases?",
    nudge: "Working with databases? Try the desktop app"
  },
  {
    id: "chrome",
    name: "DevSnip Pro for Chrome",
    short: "Chrome extension",
    platform: "Chrome",
    kind: "Chrome extension",
    store: "Chrome Web Store",
    mark: "chrome",
    tagline: "The developer toolkit in your browser's side panel.",
    description: "Debug CSS visually, score a site's health, inspect network traffic and audit performance, security and accessibility. Plus 25+ utilities.",
    features: [
      "Visual CSS debugger: box model, flex and grid overlays, live edits",
      "Website health score for SEO, accessibility, performance and security",
      "Network inspector with GraphQL detection and HAR export",
      "Web Vitals (LCP, CLS, INP), security headers and WCAG 2.2 checks"
    ],
    meta: "Free · Chrome 116 or later",
    url: "https://chromewebstore.google.com/detail/bjblnmonkaddjfdnnjhjgconniffjncm",
    cta: "Add to Chrome",
    sections: ["frontend", "testing", "mobile"],
    blurb: "CSS debugger, site audits, network",
    pitch: "Building for the web?",
    nudge: "Building for the web? Debug pages in Chrome"
  },
  {
    id: "jetbrains",
    name: "DevSnip Pro: API Client & Developer Toolkit",
    short: "JetBrains plugin",
    platform: "JetBrains",
    kind: "JetBrains plugin",
    store: "JetBrains Marketplace",
    mark: "jetbrains",
    tagline: "The same toolkit in IntelliJ-based JetBrains IDEs.",
    description: "Take your REST API client, security scanners and developer tools to IntelliJ-based IDEs, so switching editors doesn't mean switching tools.",
    features: [
      "REST API client for requests, environments and debugging",
      "OSV vulnerability scanner and software composition analysis",
      "AI, RAG and developer productivity tools",
      "Works across IntelliJ-based IDEs"
    ],
    meta: "Free · IntelliJ-based IDEs 2024.1+",
    url: "https://plugins.jetbrains.com/plugin/35453-devsnip-pro-api-client--developer-toolkit",
    cta: "Get from JetBrains Marketplace",
    sections: ["api", "security", "ai"],
    blurb: "API client & toolkit for IntelliJ IDEs",
    pitch: "Also use a JetBrains IDE?",
    nudge: "Also on IntelliJ? Bring this toolkit along"
  },
  {
    id: "vscode",
    name: "DevSnip Pro for VS Code",
    short: "VS Code",
    platform: "VS Code",
    kind: "VS Code extension",
    store: "Visual Studio Marketplace",
    mark: "vscode",
    tagline: "API client, database client and 100+ developer tools in your sidebar.",
    description: "You're using it now. A rating or review on the Marketplace helps other developers find DevSnip Pro.",
    features: [
      "REST, GraphQL and WebSocket client",
      "Database client for SQL, document and key-value stores",
      "LLM token and cost tools, Security Hub, CSV and Excel viewer"
    ],
    meta: "Free · VS Code 1.93 or later",
    url: "https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console",
    cta: "Rate on the Marketplace",
    blurb: "This extension",
    current: true,
    sections: []
  }
];

const BY_ID = new Map<string, EcosystemProduct>(ECOSYSTEM_PRODUCTS.map(product => [product.id, product]));

export function findProduct(id: unknown): EcosystemProduct | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

/** The product that suits users of a tool section best, if any. */
export function productForSection(section: unknown): EcosystemProduct | undefined {
  if (typeof section !== "string") return undefined;
  return ECOSYSTEM_PRODUCTS.find(product => !product.current && product.sections.includes(section as SectionId));
}

/**
 * What "Explore DevSnip Pro Ecosystem" should put first: a product id, or a
 * tool section id (database → Database Studio). Anything else means no focus.
 */
export function resolveFocus(focus: unknown): EcosystemProduct | undefined {
  const product = findProduct(focus);
  if (product && !product.current) return product;
  return productForSection(focus);
}
