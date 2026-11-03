import { GeneratedFile, ToolInputError } from "../types";
import { kebabOf, pascalOf } from "./scaffold-names";
import { legacyReactScaffold, LegacyReactKind } from "./react-templates";

/** Pure, bounded generation. No network, shell execution or workspace mutation. */
export const REACT_TEMPLATES = [
  ["component", "Reusable component"], ["layout", "Layout"], ["form", "Accessible form"],
  ["modal", "Modal dialog"], ["table", "Data table"], ["dashboard", "Dashboard"], ["navigation", "Navigation"],
  ["next-page", "Next.js page + loading/error"], ["next-route", "Next.js API route"],
  ["server-action", "Server action + form"], ["middleware", "Middleware / Proxy"],
  ["hook", "Data-fetching hook"], ["context", "Context provider"], ["store", "Zustand store"],
  ["redux", "Redux Toolkit"], ["query", "TanStack Query"], ["api-client", "REST API client"],
  ["auth", "Authentication (Auth.js)"], ["project", "Complete project"], ["rn-screen", "React Native screen"]
] as const;
export type ReactKind = typeof REACT_TEMPLATES[number][0];
export interface ReactOptions {
  kind: ReactKind; name: string; typescript: boolean; styling: "css-module" | "tailwind" | "none";
  tests: boolean; story: boolean; route: string;
  framework?: "react" | "next-app" | "next-pages";
  nextVersion?: "15" | "16";
  ui?: "none" | "mui" | "shadcn" | "chakra";
  state?: "none" | "context" | "zustand" | "redux" | "query";
  testRunner?: "vitest" | "jest";
  client?: "fetch" | "axios";
  rendering?: "auto" | "client" | "server";
  naming?: "pascal" | "kebab";
  sourceDirectory?: boolean;
  lazy?: boolean;
  memo?: boolean;
}
export interface ReactGeneration { files: GeneratedFile[]; dependencies: Record<string, string>; devDependencies: Record<string, string>; steps: string[] }
const LEGACY = new Set(["component", "hook", "context", "store", "rn-screen", "server-action"]);
const UI_KINDS = new Set(["component", "layout", "form", "modal", "table", "dashboard", "navigation"]);
const CLIENT_KINDS = new Set(["component", "hook", "context", "store", "redux", "query", "form", "modal", "server-action"]);
const choice = (value: string, allowed: string[], label: string) => {
  if (!allowed.includes(value)) throw new ToolInputError(`Unsupported ${label}: ${value}.`);
};

/** Accept only portable route segments; reject traversal, code injection and malformed catch-alls. */
export function validateReactRoute(input: string): string {
  if (input.length > 240) throw new ToolInputError("Route must be at most 240 characters.");
  const route = input.replace(/^\/+|\/+$/g, "");
  const names = new Set<string>();
  if (!route) return "";
  route.split("/").forEach((part, index, all) => {
    const dynamic = /^(?:\[([A-Za-z_][\w]*)\]|\[\.\.\.([A-Za-z_][\w]*)\]|\[\[\.\.\.([A-Za-z_][\w]*)\]\])$/.exec(part);
    if (!dynamic && !/^[A-Za-z0-9_-]+$/.test(part) && !/^\([A-Za-z0-9_-]+\)$/.test(part)) throw new ToolInputError(`Invalid route segment: ${part}. Use users/[id] or docs/[...slug].`);
    if (dynamic) {
      const name = dynamic[1] || dynamic[2] || dynamic[3];
      if (["__proto__", "constructor", "prototype"].includes(name) || names.has(name)) throw new ToolInputError("Dynamic parameter names must be unique and safe.");
      names.add(name);
      if ((dynamic[2] || dynamic[3]) && index !== all.length - 1) throw new ToolInputError("Catch-all segments must be last.");
    }
  });
  return route;
}

export function generateReact(input: ReactOptions): ReactGeneration {
  const o = { framework: "next-app", nextVersion: "16", ui: "none", state: "none", testRunner: "vitest", client: "fetch", rendering: "auto", naming: "pascal", sourceDirectory: true, ...input } as Required<ReactOptions>;
  choice(o.kind, REACT_TEMPLATES.map(t => t[0]), "template");
  choice(o.framework, ["react", "next-app", "next-pages"], "framework");
  choice(o.nextVersion, ["15", "16"], "Next.js version");
  choice(o.ui, ["none", "mui", "shadcn", "chakra"], "UI library");
  choice(o.state, ["none", "context", "zustand", "redux", "query"], "state manager");
  choice(o.styling, ["none", "tailwind", "css-module"], "styling");
  choice(o.testRunner, ["vitest", "jest"], "test runner");
  choice(o.client, ["fetch", "axios"], "HTTP client");
  choice(o.rendering, ["auto", "server", "client"], "rendering mode");
  choice(o.naming, ["pascal", "kebab"], "file naming");
  if (!/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(o.name.trim())) throw new ToolInputError("Use a name starting with a letter, up to 80 characters (UserCard or user-card).");
  if (o.framework === "react" && ["next-page", "next-route", "server-action", "middleware", "auth"].includes(o.kind)) throw new ToolInputError("Select a Next.js framework for this template.");
  if (o.framework !== "next-app" && o.kind === "server-action") throw new ToolInputError("Server Actions require the App Router.");
  if (o.framework !== "next-app" && o.rendering === "server") throw new ToolInputError("Server Components require the App Router.");
  if (o.rendering === "server" && (CLIENT_KINDS.has(o.kind) || o.ui !== "none")) throw new ToolInputError("This template uses client interactivity. Select Auto or Client rendering.");
  if (o.kind === "next-page" && o.rendering === "client") throw new ToolInputError("Pages use server metadata. Generate a Client Component separately and import it into the page.");
  if (o.ui === "shadcn" && o.styling !== "tailwind") throw new ToolInputError("Shadcn requires Tailwind styling.");
  if ((o.lazy || o.memo) && o.kind !== "component") throw new ToolInputError("Lazy loading and memoization are available for reusable components.");
  if (o.kind === "rn-screen" && (o.ui !== "none" || o.state !== "none")) throw new ToolInputError("Web UI and state integrations are not applied to React Native screens.");
  const route = validateReactRoute(o.route);
  if (o.framework === "next-pages" && /\([^)]+\)/.test(route)) throw new ToolInputError("Route groups require the App Router.");
  const N = pascalOf(o.name), stem = o.naming === "kebab" ? kebabOf(o.name) : N;
  const x = o.typescript ? "tsx" : "jsx", e = o.typescript ? "ts" : "js";
  const t = (s: string) => o.typescript ? s : "";
  const files: GeneratedFile[] = [], dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {};
  const steps: string[] = [];
  const add = (path: string, content: string) => {
    if (files.some(f => f.path === path)) throw new ToolInputError(`Duplicate generated path: ${path}`);
    files.push({ path, content: content.trimEnd() + "\n", language: /\.tsx$/.test(path) ? "tsx" : /\.jsx$/.test(path) ? "jsx" : /\.ts$/.test(path) ? "typescript" : /\.js$|\.mjs$/.test(path) ? "javascript" : /\.json$/.test(path) ? "json" : /\.css$/.test(path) ? "css" : "text" });
  };
  const client = o.framework === "next-app" ? '"use client";\n\n' : "";
  const app = `app${route ? "/" + route : ""}`;
  const childType = t('import type { ReactNode } from "react";\n');
  const children = t(": { children: ReactNode }");

  function uiProvider(): { imports: string; open: string; close: string } {
    if (o.ui === "mui") {
      dependencies["@mui/material"] = "^7.0.0"; dependencies["@emotion/react"] = "^11.14.0"; dependencies["@emotion/styled"] = "^11.14.0";
      if (o.framework === "next-app") {
        dependencies["@mui/material-nextjs"] = "^7.0.0"; dependencies["@emotion/cache"] = "^11.14.0";
        return { imports: 'import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";\n', open: "<AppRouterCacheProvider>", close: "</AppRouterCacheProvider>" };
      }
      if (o.framework === "next-pages") {
        dependencies["@mui/material-nextjs"] = "^7.0.0"; dependencies["@emotion/cache"] = "^11.14.0"; dependencies["@emotion/server"] = "^11.11.0";
        steps.push("Pages Router SSR: mount AppCacheProvider in _app and DocumentHeadTags/documentGetInitialProps in _document, as included in complete projects.");
      }
      return { imports: 'import { ThemeProvider, createTheme } from "@mui/material/styles";\nconst theme = createTheme();\n', open: "<ThemeProvider theme={theme}>", close: "</ThemeProvider>" };
    }
    if (o.ui === "chakra") {
      dependencies["@chakra-ui/react"] = "^3.0.0"; dependencies["@emotion/react"] = "^11.14.0";
      return { imports: 'import { ChakraProvider, defaultSystem } from "@chakra-ui/react";\n', open: "<ChakraProvider value={defaultSystem}>", close: "</ChakraProvider>" };
    }
    if (o.ui === "shadcn") steps.push("Run npx shadcn@latest init, then npx shadcn@latest add button. Use the configured @/components/ui alias.");
    return { imports: "", open: "<>", close: "</>" };
  }
  function providers() {
    const ui = uiProvider();
    let imports = ui.imports, open = ui.open, close = ui.close, setup = "";
    if (o.state === "query" || o.kind === "query") {
      dependencies["@tanstack/react-query"] = "^5.0.0";
      imports += 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";\nimport { useState } from "react";\n';
      setup = "  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60000, retry: 1 } } }));\n";
      open += "<QueryClientProvider client={queryClient}>"; close = "</QueryClientProvider>" + close;
    }
    if (o.state === "redux" || o.kind === "redux") {
      dependencies["@reduxjs/toolkit"] = "^2.0.0"; dependencies["react-redux"] = "^9.0.0";
      add(`src/stores/store.${e}`, `import { configureStore, createSlice } from "@reduxjs/toolkit";\n\nconst counter = createSlice({ name: "counter", initialState: { value: 0 }, reducers: { increment: state => { state.value += 1; } } });\nexport const { increment } = counter.actions;\n// Create one store per provider instance; never share server request state.\nexport const makeStore = () => configureStore({ reducer: { counter: counter.reducer } });\n${t('export type AppStore = ReturnType<typeof makeStore>;\nexport type RootState = ReturnType<AppStore["getState"]>;\nexport type AppDispatch = AppStore["dispatch"];')}`);
      imports += 'import { Provider } from "react-redux";\nimport { useRef } from "react";\nimport { makeStore } from "./stores/store";\n';
      setup += `  const store = useRef${t('<ReturnType<typeof makeStore> | null>')}(null);\n  if (!store.current) store.current = makeStore();\n`;
      open += "<Provider store={store.current}>"; close = "</Provider>" + close;
    }
    if (o.state === "context" || o.state === "zustand") {
      const kind = o.state === "context" ? "context" : "store";
      for (const f of legacyReactScaffold({ ...o, kind })) files.push({ ...f, content: client + f.content });
      if (kind === "context") { imports += `import { ${N}Provider } from "./context/${N}Context";\n`; open += `<${N}Provider>`; close = `</${N}Provider>` + close; }
      else { dependencies.zustand = "^5.0.0"; steps.push("Select store slices in Client Components; initialize persisted state after hydration. Never store credentials in browser storage."); }
    }
    add(`src/providers.${x}`, `${client}${childType}${imports}\nexport function Providers({ children }${children}) {\n${setup}  return ${open}{children}${close};\n}`);
  }

  function apiClient() {
    if (o.client === "axios") {
      dependencies.axios = "^1.8.3";
      add(`src/lib/api.${e}`, `import axios from "axios";\n\n// Same-origin requests; pass AbortSignal for cancellation. Do not persist bearer tokens in localStorage.\nexport const api = axios.create({ baseURL: "/api", timeout: 15000, headers: { Accept: "application/json" } });\nexport async function request${t("<T = unknown>")}(path${t(": string")}, signal${t("?: AbortSignal")}) {\n  const response = await api.get${t("<T>")}(path, { signal });\n  return response.data;\n}`);
    } else add(`src/lib/api.${e}`, `export async function request${t("<T = unknown>")}(path${t(": string")}, options${t(": RequestInit")} = {})${t(": Promise<T>")} {\n  // Keep paths same-origin; external URLs require an explicit trust decision.\n  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\\\")) throw new Error("Expected a same-origin path");\n  const response = await fetch(path, { ...options, headers: { Accept: "application/json", ...Object.fromEntries(new Headers(options.headers)) } });\n  if (!response.ok) throw new Error(\`Request failed (\${response.status})\`);\n  if (response.status === 204) return undefined${t(" as T")};\n  return response.json();\n}`);
  }

  function page() {
    const params = route.split("/").flatMap(part => {
      const m = /^\[([^\]]+)\]$|^\[\[([^\]]+)\]\]$/.exec(part);
      if (!m) return [];
      const raw = m[1] || m[2], catchAll = raw.startsWith("...");
      return [{ name: raw.replace(/^\.\.\./, ""), type: catchAll ? "string[]" : "string", optional: !!m[2] }];
    });
    const shape = params.map(p => `${p.name}${p.optional ? "?" : ""}: ${p.type}`).join("; ");
    if (o.framework === "next-pages") {
      add(`pages/${route || "index"}.${x}`, `import { useRouter } from "next/router";\nimport Head from "next/head";\n\nexport default function ${N}Page() {\n  const router = useRouter();\n  if (!router.isReady) return <p role="status">Loading…</p>;\n  return <main><Head><title>${N}</title></Head><h1>${N}</h1><pre>{JSON.stringify(router.query, null, 2)}</pre></main>;\n}`);
    } else {
      add(`${app}/page.${x}`, `${t('import type { Metadata } from "next";\n')}\nexport const metadata${t(": Metadata")} = { title: "${N}" };\n\nexport default ${params.length ? "async " : ""}function ${N}Page(${params.length ? `{ params }${t(`: { params: Promise<{ ${shape} }> }`)}` : ""}) {\n${params.length ? "  const routeParams = await params;\n" : ""}  return <main><h1>${N}</h1>${params.length ? '<pre>{JSON.stringify(routeParams, null, 2)}</pre>' : "<p>Your page is ready.</p>"}</main>;\n}`);
      add(`${app}/loading.${x}`, 'export default function Loading() { return <p role="status" aria-busy="true">Loading…</p>; }');
      add(`${app}/error.${x}`, `"use client";\n\nexport default function ErrorBoundary({ reset }${t(": { error: Error & { digest?: string }; reset: () => void }")}) {\n  return <div role="alert"><h2>Something went wrong</h2><button type="button" onClick={reset}>Try again</button></div>;\n}`);
    }
  }

  if (o.kind === "project") {
    dependencies.react = "^19.0.0"; dependencies["react-dom"] = "^19.0.0";
    devDependencies.prettier = "^3.0.0";
    if (o.typescript) Object.assign(devDependencies, { typescript: "^5.7.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@types/node": "^22.0.0" });
    providers(); apiClient();
    if (o.framework === "react") {
      Object.assign(devDependencies, { vite: "^6.0.0", "@vitejs/plugin-react": "^4.3.0" });
      add("index.html", `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${N}</title></head><body><div id="root"></div><script type="module" src="/src/main.${x}"></script></body></html>`);
      add(`src/main.${x}`, `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport { Providers } from "./providers";\nimport App from "./App";\nimport "./styles.css";\n\nconst root = document.getElementById("root");\nif (!root) throw new Error("Missing root element");\ncreateRoot(root).render(<StrictMode><Providers><App /></Providers></StrictMode>);`);
      add(`src/App.${x}`, `export default function App() { return <main><h1>${N}</h1><p>Ready to build.</p></main>; }`);
      add(`vite.config.${e}`, `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n${o.styling === "tailwind" ? 'import tailwindcss from "@tailwindcss/vite";\n' : ""}import { fileURLToPath, URL } from "node:url";\nexport default defineConfig({ plugins: [react()${o.styling === "tailwind" ? ", tailwindcss()" : ""}], resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } } });`);
      if (o.styling === "tailwind") devDependencies["@tailwindcss/vite"] = "^4.0.0";
      if (o.typescript) add("src/vite-env.d.ts", '/// <reference types="vite/client" />');
    } else {
      dependencies.next = `^${o.nextVersion}.0.0`;
      add("next.config.mjs", "export default { poweredByHeader: false }; ");
      if (o.framework === "next-app") {
        add(`app/layout.${x}`, `${childType}import { Providers } from "../src/providers";\nimport "../src/styles.css";\n\nexport default function RootLayout({ children }${children}) {\n  return <html lang="en"><body><Providers>{children}</Providers></body></html>;\n}`);
        add(`app/page.${x}`, `export default function Home() { return <main><h1>${N}</h1><p>Ready to build.</p></main>; }`);
      } else {
        add(`pages/_app.${x}`, `${t('import type { AppProps } from "next/app";\n')}import { Providers } from "../src/providers";\nimport "../src/styles.css";\nexport default function App({ Component, pageProps }${t(": AppProps")}) { return <Providers><Component {...pageProps} /></Providers>; }`);
        add(`pages/index.${x}`, `export default function Home() { return <main><h1>${N}</h1></main>; }`);
        if (o.ui === "mui") {
          const appFile = files.find(f => f.path === `pages/_app.${x}`)!;
          appFile.content = `${t('import type { AppProps } from "next/app";\n')}import { AppCacheProvider } from "@mui/material-nextjs/v15-pagesRouter";\nimport { Providers } from "../src/providers";\nimport "../src/styles.css";\nexport default function App(props${t(": AppProps")}) {\n  const { Component, pageProps } = props;\n  return <AppCacheProvider {...props}><Providers><Component {...pageProps} /></Providers></AppCacheProvider>;\n}\n`;
          add(`pages/_document.${x}`, `import { Html, Head, Main, NextScript } from "next/document";\n${t('import type { DocumentContext, DocumentProps } from "next/document";\nimport type { DocumentHeadTagsProps } from "@mui/material-nextjs/v15-pagesRouter";\n')}import { DocumentHeadTags, documentGetInitialProps } from "@mui/material-nextjs/v15-pagesRouter";\n\nexport default function Document(props${t(": DocumentProps & DocumentHeadTagsProps")}) {\n  return <Html lang="en"><Head><DocumentHeadTags {...props} /></Head><body><Main /><NextScript /></body></Html>;\n}\nDocument.getInitialProps = (context${t(": DocumentContext")}) => documentGetInitialProps(context);`);
        }
      }
      if (o.styling === "tailwind") { devDependencies["@tailwindcss/postcss"] = "^4.0.0"; add("postcss.config.mjs", 'export default { plugins: { "@tailwindcss/postcss": {} } };'); }
      if (o.typescript) add("next-env.d.ts", '/// <reference types="next" />\n/// <reference types="next/image-types/global" />');
    }
    if (o.styling === "tailwind") devDependencies.tailwindcss = "^4.0.0";
    add("src/styles.css", `${o.styling === "tailwind" ? '@import "tailwindcss";\n' : ""}body { margin: 0; font-family: system-ui, sans-serif; }\nmain { max-width: 72rem; margin: auto; padding: 2rem; }\nbutton, input { font: inherit; }\n:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }`);
    add(".env.example", o.framework === "react" ? "# VITE_ values are public. Keep secrets on your server.\nVITE_API_BASE_URL=/api" : "# Server-only. Never prefix secrets with NEXT_PUBLIC_.\nAPI_URL=https://api.example.com");
    add(".gitignore", "node_modules/\n.next/\ndist/\ncoverage/\n.env*\n!.env.example\n*.tsbuildinfo");
    add(".prettierrc.json", JSON.stringify({ semi: true, singleQuote: false, trailingComma: "all" }, null, 2));
    add(o.typescript ? "tsconfig.json" : "jsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: o.framework === "react" ? "react-jsx" : "preserve", paths: { "@/*": ["./src/*"] }, ...(o.framework !== "react" ? { plugins: [{ name: "next" }] } : {}) }, include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2));
    steps.push("Install dependencies with npm install, copy .env.example to .env.local, then npm run dev. Commit the resulting lockfile. No commands are run by the generator.");
  } else if (o.kind === "next-page") page();
  else if (o.kind === "next-route" && o.framework === "next-pages") {
    add(`pages/api/${route || "index"}.${e}`, `${t('import type { NextApiRequest, NextApiResponse } from "next";\n')}import { z } from "zod";\n\nconst schema = z.object({ name: z.string().trim().min(1).max(120) });\nexport default function handler(req${t(": NextApiRequest")}, res${t(": NextApiResponse")}) {\n  if (req.method === "GET") return res.status(200).json({ items: [] });\n  if (req.method === "POST") {\n    const result = schema.safeParse(req.body);\n    if (!result.success) return res.status(400).json({ error: "Invalid input" });\n    return res.status(201).json(result.data);\n  }\n  res.setHeader("Allow", ["GET", "POST"]);\n  return res.status(405).json({ error: "Method not allowed" });\n}`);
    dependencies.zod = "^3.24.0";
  } else if (o.kind === "next-route") {
    files.push(...legacyReactScaffold({ ...o, route, kind: "next-route" }));
    if (!route) files[0].path = `app/api/route.${e}`;
    dependencies.zod = "^3.24.0";
  } else if (o.kind === "middleware") {
    const fn = o.nextVersion === "16" ? "proxy" : "middleware";
    add(`${fn}.${e}`, `import { NextResponse } from "next/server";\n${t('import type { NextRequest } from "next/server";\n')}\n// Request-level headers only. Authenticate and authorize in each protected handler/action.\nexport function ${fn}(request${t(": NextRequest")}) {\n  const response = NextResponse.next();\n  response.headers.set("X-Content-Type-Options", "nosniff");\n  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");\n  return response;\n}\nexport const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };`);
  } else if (o.kind === "layout") {
    add(o.framework === "next-app" ? `${app}/layout.${x}` : `src/components/${stem}.${x}`, `${o.rendering === "client" ? client : ""}${childType}\nexport default function ${N}Layout({ children }${children}) {\n  return <div><header><a href="/">Home</a></header><main>{children}</main><footer>All rights reserved.</footer></div>;\n}`);
  } else if (["form", "modal", "table", "dashboard", "navigation"].includes(o.kind)) {
    let imports = "", body = "", setup = "";
    if (o.kind === "form") {
      imports = 'import { useId, useState } from "react";\n';
      setup = '  const id = useId();\n  const [message, setMessage] = useState("");\n';
      body = `<form onSubmit={event => { event.preventDefault(); setMessage("Validated. Connect your submission service."); }}><label htmlFor={id}>Email</label><input id={id} name="email" type="email" autoComplete="email" required maxLength={254} /><button type="submit">Submit</button><p role="status">{message}</p></form>`;
    } else if (o.kind === "modal") {
      imports = 'import { useId, useRef } from "react";\n';
      setup = `  const id = useId();\n  const dialog = useRef${t("<HTMLDialogElement | null>")}(null);\n`;
      body = '<><button type="button" onClick={() => dialog.current?.showModal()}>Open dialog</button><dialog ref={dialog} aria-labelledby={id}><h2 id={id}>Details</h2><p>Dialog content</p><form method="dialog"><button>Close</button></form></dialog></>';
    } else if (o.kind === "table") {
      setup = '  const rows = [{ id: "1", name: "Example" }];\n';
      body = '<table><caption>Records</caption><thead><tr><th scope="col">Name</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td></tr>)}</tbody></table>';
    } else if (o.kind === "navigation") body = '<nav aria-label="Main"><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>';
    else body = '<main><h1>Dashboard</h1><section aria-label="Overview"><h2>Activity</h2><dl><dt>Total records</dt><dd>0</dd></dl></section></main>';
    add(`src/components/${stem}.${x}`, `${["form", "modal"].includes(o.kind) || o.rendering === "client" ? client : ""}${imports}\nexport default function ${N}() {\n${setup}  return (${body});\n}`);
  } else if (o.kind === "api-client") apiClient();
  else if (o.kind === "query") {
    providers(); apiClient();
    add(`src/hooks/use${N}.${e}`, `${client}import { useQuery } from "@tanstack/react-query";\nimport { request } from "../lib/api";\n\nexport function use${N}(id${t(": string")}) {\n  return useQuery({ queryKey: ["${kebabOf(o.name)}", id], enabled: Boolean(id), queryFn: ({ signal }) => request(\`/api/items/\${encodeURIComponent(id)}\`, ${o.client === "axios" ? "signal" : "{ signal }"}) });\n}`);
  } else if (o.kind === "redux") providers();
  else if (o.kind === "auth") {
    if (o.framework !== "next-app") throw new ToolInputError("Auth.js template currently requires the App Router.");
    dependencies["next-auth"] = "^5.0.0-beta.30";
    add(`src/auth.${e}`, 'import NextAuth from "next-auth";\nimport GitHub from "next-auth/providers/github";\n\nexport const { handlers, auth, signIn, signOut } = NextAuth({ providers: [GitHub] });');
    add(`app/api/auth/[...nextauth]/route.${e}`, 'import { handlers } from "../../../../src/auth";\nexport const { GET, POST } = handlers;');
    add(`app/account/page.${x}`, 'import { auth, signIn, signOut } from "../../src/auth";\n\nexport default async function Account() {\n  const session = await auth();\n  return <main><h1>Account</h1>{session?.user ? <><p>{session.user.name}</p><form action={async () => { "use server"; await signOut(); }}><button>Sign out</button></form></> : <form action={async () => { "use server"; await signIn("github"); }}><button>Sign in with GitHub</button></form>}</main>;\n}');
    add(".env.example", "# Server-only. Generate AUTH_SECRET and register your OAuth callback.\nAUTH_SECRET=\nAUTH_GITHUB_ID=\nAUTH_GITHUB_SECRET=");
    steps.push("Auth.js v5 is a beta integration. Configure GitHub OAuth callback /api/auth/callback/github and AUTH_SECRET. Check auth() and resource ownership in every protected endpoint/action.");
  } else if (LEGACY.has(o.kind)) {
    files.push(...legacyReactScaffold({ ...o, route, kind: o.kind as LegacyReactKind }));
    if (["component", "hook", "context", "store"].includes(o.kind)) for (const f of files) if (!/\.(test|stories)\./.test(f.path) && !/index\.|\.css$/.test(f.path)) f.content = client + f.content;
    if (o.kind === "store") { dependencies.zustand = "^5.0.0"; steps.push("Persisted stores skip automatic hydration. Call use" + N + "Store.persist.rehydrate() from a client effect after mount; never store secrets in browser storage."); }
    if (o.kind === "server-action" && !route) {
      for (const f of files) f.path = f.path.replace(`app/${kebabOf(o.name)}/`, "app/");
    }
    if (o.kind === "server-action") { dependencies.zod = "^3.24.0"; steps.push("The action is a validation example. Add authentication, authorization and persistence before using it to save data."); }
    if (o.kind === "rn-screen") Object.assign(dependencies, { "react-native": ">=0.78", "react-native-safe-area-context": "^5.0.0" });
    if (o.kind === "component") {
      if (o.memo) {
        const f = files[0]; f.content = f.content.replace("export default " + N + ";", `export default memo(${N});`);
        f.content = f.content.replace(/^("use client";\n\n)?/, `$1import { memo } from "react";\n`);
        steps.push("The default export is memoized. Use it when profiling shows repeated renders with stable props.");
      }
      if (o.lazy) add(`src/components/${N}/${N}Lazy.${x}`, `${client}import { lazy, Suspense } from "react";\nconst Lazy = lazy(() => import("./${N}"));\nexport default function ${N}Lazy(props${t(`: import("./${N}").${N}Props`)}) {\n  return <Suspense fallback={<p role="status">Loading…</p>}><Lazy {...props} /></Suspense>;\n}`);
    }
  }

  if (o.kind === "component" || o.kind === "hook" || o.kind === "context" || o.kind === "store" || UI_KINDS.has(o.kind)) steps.push("Requires React 19. Install snippets into an existing configured project, or generate a complete project first.");
  // Library integration is explicit and includes provider wiring/instructions.
  if (UI_KINDS.has(o.kind) && o.ui !== "none") {
    providers();
    const component = files.find(f => /\.(tsx|jsx)$/.test(f.path) && !/test|stories|providers/.test(f.path));
    if (component && o.kind === "component") {
      const spec = o.ui === "mui" ? 'import Button from "@mui/material/Button";' : o.ui === "chakra" ? 'import { Button } from "@chakra-ui/react";' : 'import { Button } from "@/components/ui/button";';
      component.content = component.content.replace(/^("use client";\n\n)?/, `$1${spec}\n`).replace(/<button /g, "<Button ").replace(/<\/button>/g, "</Button>");
    }
    if (o.kind === "component" && o.tests) {
      const testFile = files.find(f => /\.test\./.test(f.path))!;
      testFile.content = testFile.content.replace('import { render, screen }', 'import { render as renderWithLibrary, screen }');
      const helper = `import { Providers } from "../../providers";\n\nfunction render(ui${t(': import("react").ReactElement')}) { return renderWithLibrary(<Providers>{ui}</Providers>); }\n\n`;
      testFile.content = helper + testFile.content;
    }
    steps.push("Wrap your application with the generated Providers component before rendering library components.");
  }
  if (o.story && o.kind === "component") { devDependencies["@storybook/react"] = "^8.6.0"; steps.push("Initialize Storybook with npx storybook init to select the correct framework builder."); }
  if (o.tests && (o.kind === "project" || files.some(f => /\.test\./.test(f.path)) || UI_KINDS.has(o.kind))) {
    Object.assign(devDependencies, { "@testing-library/react": "^16.0.0", "@testing-library/user-event": "^14.0.0", "@testing-library/jest-dom": "^6.0.0" });
    if (o.kind === "project") add(`src/App.test.${x}`, `import { render, screen } from "@testing-library/react";\nimport { describe, it, expect } from "${o.testRunner === "jest" ? "@jest/globals" : "vitest"}";\n${o.framework === "react" ? 'import Home from "./App";' : `import Home from "../${o.framework === "next-app" ? "app/page" : "pages/index"}";`}\ndescribe("Home", () => { it("renders the project heading", () => { render(<Home />); expect(screen.getByRole("heading", { name: "${N}" })).toBeTruthy(); }); });`);
    if (UI_KINDS.has(o.kind) && o.kind !== "component") {
      const target = files.find(f => /\.(tsx|jsx)$/.test(f.path));
      if (target && o.kind !== "layout") add(target.path.replace(`.${x}`, `.test.${x}`), `import { render, screen } from "@testing-library/react";\nimport { describe, it, expect } from "${o.testRunner === "jest" ? "@jest/globals" : "vitest"}";\nimport ${N} from "./${stem}";\ndescribe("${N}", () => { it("renders accessible content", () => { render(<${N} />); expect(screen.getByRole("${({ form: "button", modal: "button", table: "table", navigation: "navigation", dashboard: "main" } as Record<string, string>)[o.kind]}")).toBeTruthy(); }); });`);
    }
    if (o.testRunner === "jest") {
      Object.assign(devDependencies, { jest: "^29.7.0", "@jest/globals": "^29.7.0", "jest-environment-jsdom": "^29.7.0", "babel-jest": "^29.7.0", "@babel/core": "^7.0.0", "@babel/preset-env": "^7.0.0", "@babel/preset-react": "^7.0.0", "@babel/preset-typescript": "^7.0.0" });
      add("jest.config.cjs", 'module.exports = { testEnvironment: "jsdom", setupFilesAfterEnv: ["<rootDir>/test/setup.js"], moduleNameMapper: { "\\\\.css$": "<rootDir>/test/style-mock.cjs" } };');
      if (o.framework === "react") add("babel.config.cjs", 'module.exports = { presets: [["@babel/preset-env", { targets: { node: "current" } }], ["@babel/preset-react", { runtime: "automatic" }], "@babel/preset-typescript"] };');
      if (o.framework !== "react") {
        const config = files.find(f => f.path === "jest.config.cjs")!;
        config.content = 'const nextJest = require("next/jest");\nmodule.exports = nextJest({ dir: "./" })({ testEnvironment: "jsdom", setupFilesAfterEnv: ["<rootDir>/test/setup.js"] });\n';
      }
      add("test/setup.js", 'import "@testing-library/jest-dom";');
      add("test/style-mock.cjs", "module.exports = {};");
      for (const f of files) if (/\.test\./.test(f.path)) f.content = f.content.replace(/\bvi\b/g, "jest").replace(/from "vitest"/g, 'from "@jest/globals"');
    } else {
      Object.assign(devDependencies, { vitest: "^3.0.0", jsdom: "^26.0.0", "@vitejs/plugin-react": "^4.3.0" });
      add(`vitest.config.${e}`, 'import { defineConfig } from "vitest/config";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()], test: { environment: "jsdom", setupFiles: ["./test/setup.js"] } });');
      add("test/setup.js", 'import "@testing-library/jest-dom/vitest";\nimport { cleanup } from "@testing-library/react";\nimport { afterEach } from "vitest";\nafterEach(cleanup);');
    }
    steps.push(`Run ${o.testRunner === "jest" ? "npx jest" : "npx vitest run"}. Test async Server Components with end-to-end tests; unit tests target synchronous components and hooks.`);
  }
  if (o.naming === "kebab" && o.kind === "component") {
    for (const f of files) { f.path = f.path.replace(new RegExp(N, "g"), stem); f.content = f.content.replace(new RegExp(`\\./${N}`, "g"), `./${stem}`); }
  }
  if (o.kind === "project") {
    const scripts: Record<string, string> = o.framework === "react" ? { dev: "vite", build: "vite build", preview: "vite preview" } : { dev: "next dev", build: "next build", start: "next start" };
    scripts.format = "prettier --write .";
    if (o.typescript) scripts.typecheck = "tsc --noEmit";
    if (o.tests) scripts.test = o.testRunner === "jest" ? "jest" : "vitest run";
    add("package.json", JSON.stringify({ name: kebabOf(o.name), version: "0.1.0", private: true, type: "module", engines: { node: ">=22.0.0" }, scripts, dependencies, devDependencies }, null, 2));
  }
  if (o.kind === "project" && !o.sourceDirectory) {
    for (const f of files) { f.path = f.path.replace(/^src\//, ""); f.content = f.content.replace(/from "\.\.\/(app\/page|pages\/index)"/g, 'from "./$1"').replace(/\.\.\/src\//g, "../").replace(/\.\/src\//g, "./").replace(/\/src\/main/g, "/main"); }
  }
  if (files.length > 100 || files.reduce((n, f) => n + f.content.length, 0) > 1_000_000) throw new ToolInputError("Generated output exceeds the safety limit.");
  return { files, dependencies, devDependencies, steps };
}

/** Backward-compatible files-only entry point. */
export function reactScaffold(options: ReactOptions): GeneratedFile[] { return generateReact(options).files; }
