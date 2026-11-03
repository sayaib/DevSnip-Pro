# React / Next.js Generator

Open **DevSnip Pro: React / Next.js Generator** from the command palette or the Web tools section. The existing `reactGenerator` command and `reactScaffold()` files-only API remain available.

## Targets and templates

- React 19 with Vite, or Next.js 15/16 with the App Router or Pages Router.
- JavaScript/JSX or TypeScript/TSX; CSS modules, Tailwind CSS v4 or native styling.
- Reusable components, hooks, layouts, forms, native modal dialogs, tables, dashboards and navigation.
- Nested pages, dynamic parameters, required/optional catch-all routes and App Router route groups. App pages include loading and error boundaries. Pages Router uses its own page and API conventions.
- App Router Server Actions, Auth.js GitHub OAuth, and Next.js 15 middleware / Next.js 16 Proxy.
- Context, Zustand, Redux Toolkit and TanStack Query; same-origin Fetch or Axios clients.
- Material UI v7, Chakra UI v3, or Shadcn UI setup instructions. Providers and dependency commands accompany integrations. Shadcn requires its CLI initialization and `button` installation before importing generated components.
- Complete project manifests, entry points, providers, configuration, styles, environment examples, ignore rules and formatting scripts. Project folder organization can include or omit `src`.
- Vitest or Jest with React Testing Library; optional Storybook component stories, lazy wrappers and memoized default exports.
- The original React Native screen template remains available for an existing React Native project.

## Workflow

Search the template selector, configure your target, then generate. Enable **Live preview** to update results after edits. File previews expand on demand and highlight code locally. Copy or open an individual file, save selected files, or write all files using the existing workspace export controls. Existing files require overwrite confirmation.

Use built-in presets or **Save preset** to retain the current configuration. Saved presets are local to the extension, limited to the latest 20, and replaced when the name/template match. **Clear saved presets** removes those saved configurations.

**Check workspace dependencies** compares required packages with the root `package.json`. It reports missing packages and recognizable incompatible version declarations. It does not resolve lockfiles, install packages, inspect remote registries or change your workspace. Open the application folder when working in a monorepo.

Generated projects include `npm run dev`, `npm run build`, `npm run format`, and optionally `npm test` and `npm run typecheck`. Install dependencies and commit the resulting lockfile. The generator does not execute generated commands. Use Node.js 22 or newer for generated projects.

## Integration boundaries

Generated forms and Server Actions are starting points: connect your authentication, resource authorization and persistence service. The generated action validates input; its example persistence call is intentionally left for application integration. Auth.js v5 is explicitly a beta integration and requires server-side OAuth credentials and an `AUTH_SECRET`. Environment examples contain no credentials.

Interactive App Router templates declare client boundaries. Server Components remain the default for pages and layouts; incompatible selections produce validation errors. Async Server Components need end-to-end tests; generated unit tests cover synchronous components and hooks.

Mount the generated `Providers` component around library-backed components. Zustand persistence skips automatic hydration: rehydrate from a client effect after mounting to avoid server/client mismatches. Do not put credentials in browser stores. Redux and Query providers create instance-local stores/caches.

Lazy and memo options apply to reusable components. The memo option changes the default export; named exports remain available. Enable memoization based on profiling rather than assuming every render benefits.

The supported matrix is intentionally bounded. Arbitrary framework versions and UI libraries are rejected rather than emitted with unverified APIs. Styling options configure reusable component styles and complete-project tooling; standalone semantic UI templates provide native markup for application-specific styling.

## Implementation and verification

The pure engine is in `src/toolkits/engines/react-generator.ts`, original templates in `react-templates.ts`, shared naming in `scaffold-names.ts`, and the workbench definition in `src/toolkits/sections/react.ts`. No VS Code, network or filesystem calls occur in the generation engine.

Route segments, names, enum selections and framework compatibility are validated before generation. Generated output has file/size limits. The workbench debounces live runs, ignores stale replies, bounds displayed code and defers preview rendering until expansion.

`src/test/unit/react-generator.unit.ts` covers the original API, template syntax, relative imports, router/language/state/test-runner/folder matrices, invalid routes, dependency checks and saved presets. Run `npm run compile:dev`, `npm run lint`, and `npm run test:unit`. The existing web build and smoke checks exercise browser-host integration.

Official references: [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components), [Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [Vitest limitations](https://nextjs.org/docs/app/guides/testing/vitest), [Material UI integration](https://mui.com/material-ui/integrations/nextjs/), [Chakra migration](https://chakra-ui.com/docs/get-started/migration), [Auth.js installation](https://authjs.dev/getting-started/installation), and [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite).
