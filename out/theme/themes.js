"use strict";
/**
 * DevSnip Pro appearance themes.
 *
 * Every webview already styles itself from VS Code's theme variables
 * (`--vscode-editor-background`, `--vscode-button-background`...). A theme is
 * therefore a small semantic palette that is expanded into overrides for those
 * variables, so one palette restyles every panel - sidebar, REST client,
 * toolkits, hubs, security, database - without touching their stylesheets.
 *
 * To add a theme: add a palette to THEMES. The unit tests check every theme
 * for readable contrast and a complete set of colours.
 *
 * Pure: no vscode import, so it is unit tested directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contrast = exports.luminance = exports.TRANSITION_RULES = exports.themeRules = exports.DESIGN_TOKENS = exports.themeVariables = exports.swatches = exports.validThemeId = exports.findTheme = exports.THEMES = exports.SYSTEM_THEME_ID = void 0;
exports.SYSTEM_THEME_ID = "system";
exports.THEMES = [
    {
        id: "dark",
        label: "Dark",
        description: "Neutral graphite with a clear blue accent.",
        palette: {
            kind: "dark",
            bg: "#1e1f23", sidebar: "#18191c", surface: "#26282d", surface2: "#2f3238", surface3: "#3a3d44",
            border: "#2f3237", borderStrong: "#45484f",
            fg: "#e4e6eb", muted: "#a3a9b4", disabled: "#6f747e",
            accent: "#2f6fe0", accentFg: "#ffffff", accentHover: "#2a62c9", link: "#6ea8ff", focus: "#4c8dff",
            selection: "#203a63", selectionFg: "#ffffff",
            success: "#4ade80", warning: "#f5b748", danger: "#ff7a7a", info: "#6ea8ff",
            ansi: { red: "#ff7a7a", green: "#4ade80", yellow: "#f5c451", blue: "#6ea8ff", magenta: "#c792ea", cyan: "#4dd0e1", white: "#e4e6eb" },
            syntax: { string: "#e7a87a", number: "#b5cea8", boolean: "#6ea8ff", name: "#9cdcfe" },
            shadow: "rgba(0, 0, 0, 0.45)"
        }
    },
    {
        id: "midnight",
        label: "Midnight",
        description: "Deep navy with soft periwinkle highlights.",
        palette: {
            kind: "dark",
            bg: "#0d1322", sidebar: "#0a0f1b", surface: "#141c30", surface2: "#1b2540", surface3: "#24304f",
            border: "#1c2640", borderStrong: "#2e3b5c",
            fg: "#dbe5f5", muted: "#93a2c0", disabled: "#5a6785",
            accent: "#7aa2f7", accentFg: "#0b1020", accentHover: "#93b4fa", link: "#89b4fa", focus: "#7aa2f7",
            selection: "#22345e", selectionFg: "#eef3fd",
            success: "#9ece6a", warning: "#e0af68", danger: "#f7768e", info: "#7dcfff",
            ansi: { red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#c0caf5" },
            syntax: { string: "#9ece6a", number: "#ff9e64", boolean: "#ff9e64", name: "#7dcfff" },
            shadow: "rgba(0, 0, 0, 0.55)"
        }
    },
    {
        id: "dracula",
        label: "Dracula",
        description: "The classic purple-and-pink night palette.",
        palette: {
            kind: "dark",
            bg: "#282a36", sidebar: "#21222c", surface: "#313343", surface2: "#3a3d50", surface3: "#44475a",
            border: "#363849", borderStrong: "#4d5068",
            fg: "#f8f8f2", muted: "#b6bcd8", disabled: "#6f7aa8",
            accent: "#bd93f9", accentFg: "#1e1f29", accentHover: "#caa7fb", link: "#8be9fd", focus: "#ff79c6",
            selection: "#44475a", selectionFg: "#ffffff",
            success: "#50fa7b", warning: "#ffb86c", danger: "#ff6e6e", info: "#8be9fd",
            ansi: { red: "#ff6e6e", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2" },
            syntax: { string: "#f1fa8c", number: "#bd93f9", boolean: "#bd93f9", name: "#50fa7b" },
            shadow: "rgba(0, 0, 0, 0.5)"
        }
    },
    {
        id: "monokai",
        label: "Monokai",
        description: "Warm charcoal with lime, cyan and orange.",
        palette: {
            kind: "dark",
            bg: "#272822", sidebar: "#1e1f1c", surface: "#31322b", surface2: "#3e3d32", surface3: "#49483e",
            border: "#38392f", borderStrong: "#55564a",
            fg: "#f8f8f2", muted: "#bcb8a0", disabled: "#7c7865",
            accent: "#a6e22e", accentFg: "#1e1f1c", accentHover: "#b7ec50", link: "#66d9ef", focus: "#fd971f",
            selection: "#49483e", selectionFg: "#ffffff",
            success: "#a6e22e", warning: "#fd971f", danger: "#ff5c8a", info: "#66d9ef",
            ansi: { red: "#ff5c8a", green: "#a6e22e", yellow: "#e6db74", blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2" },
            syntax: { string: "#e6db74", number: "#ae81ff", boolean: "#ae81ff", name: "#a6e22e" },
            shadow: "rgba(0, 0, 0, 0.5)"
        }
    },
    {
        id: "nord",
        label: "Nord",
        description: "Arctic slate with frosty blues.",
        palette: {
            kind: "dark",
            bg: "#2e3440", sidebar: "#2a2f3a", surface: "#3b4252", surface2: "#434c5e", surface3: "#4c566a",
            border: "#3b4252", borderStrong: "#566078",
            fg: "#eceff4", muted: "#b9c2d3", disabled: "#77829a",
            accent: "#88c0d0", accentFg: "#242933", accentHover: "#9dcddb", link: "#88c0d0", focus: "#88c0d0",
            selection: "#4c566a", selectionFg: "#ffffff",
            success: "#a3be8c", warning: "#ebcb8b", danger: "#e48891", info: "#81a1c1",
            ansi: { red: "#e48891", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0" },
            syntax: { string: "#a3be8c", number: "#c6a5c0", boolean: "#81a1c1", name: "#88c0d0" },
            shadow: "rgba(0, 0, 0, 0.4)"
        }
    },
    {
        id: "cyberpunk",
        label: "Cyberpunk",
        description: "Neon cyan and magenta on near-black.",
        palette: {
            kind: "dark",
            bg: "#0a0b14", sidebar: "#07080f", surface: "#12142a", surface2: "#1b1e3b", surface3: "#262a50",
            border: "#1d2042", borderStrong: "#363b72",
            fg: "#e6f6ff", muted: "#9aa8d6", disabled: "#555f8f",
            accent: "#00e5ff", accentFg: "#05060d", accentHover: "#5cefff", link: "#00e5ff", focus: "#ff2a6d",
            selection: "#3a1f5c", selectionFg: "#ffffff",
            success: "#2dff9a", warning: "#fcee0a", danger: "#ff4d7e", info: "#00e5ff",
            ansi: { red: "#ff4d7e", green: "#2dff9a", yellow: "#fcee0a", blue: "#6f8cff", magenta: "#ff5cf0", cyan: "#00e5ff", white: "#e6f6ff" },
            syntax: { string: "#fcee0a", number: "#ff5cf0", boolean: "#00e5ff", name: "#2dff9a" },
            shadow: "rgba(0, 0, 0, 0.6)"
        }
    },
    // Unlockable themes (see src/services/rewards.ts). Every theme above is free.
    {
        id: "solarized",
        label: "Solarized",
        description: "Calm deep teal with amber and cyan.",
        palette: {
            kind: "dark",
            bg: "#002b36", sidebar: "#00232c", surface: "#073642", surface2: "#0d4250", surface3: "#15505f",
            border: "#0a3c48", borderStrong: "#2a5f6c",
            fg: "#f2ecd9", muted: "#a7b8ba", disabled: "#5f7a80",
            accent: "#2aa198", accentFg: "#001f27", accentHover: "#3db5ab", link: "#5cb8f2", focus: "#d9a400",
            selection: "#0f4b5c", selectionFg: "#ffffff",
            success: "#a3b800", warning: "#d9a400", danger: "#f4736d", info: "#5cb8f2",
            ansi: { red: "#f4736d", green: "#a3b800", yellow: "#d9a400", blue: "#5cb8f2", magenta: "#e07bb0", cyan: "#2aa198", white: "#eee8d5" },
            syntax: { string: "#3cc0b5", number: "#e98bbb", boolean: "#f28a5c", name: "#5cb8f2" },
            shadow: "rgba(0, 0, 0, 0.5)"
        }
    },
    {
        id: "ember",
        label: "Ember",
        description: "Warm coal with glowing orange.",
        palette: {
            kind: "dark",
            bg: "#1a1210", sidebar: "#140e0c", surface: "#241917", surface2: "#2f211e", surface3: "#3b2a26",
            border: "#2e211d", borderStrong: "#4a3530",
            fg: "#f5e9e2", muted: "#c2aca2", disabled: "#7d665d",
            accent: "#ff7a2f", accentFg: "#1a1210", accentHover: "#ff9152", link: "#ffb070", focus: "#ffb347",
            selection: "#4a2a1c", selectionFg: "#ffffff",
            success: "#8fd16a", warning: "#ffc25c", danger: "#ff6b6b", info: "#7cc4ff",
            ansi: { red: "#ff6b6b", green: "#8fd16a", yellow: "#ffc25c", blue: "#7cc4ff", magenta: "#e48ad6", cyan: "#6fd6c9", white: "#f5e9e2" },
            syntax: { string: "#ffc25c", number: "#ff9e64", boolean: "#ff8a45", name: "#f5b78a" },
            shadow: "rgba(0, 0, 0, 0.55)"
        }
    },
    {
        id: "synthwave",
        label: "Synthwave",
        description: "Retro sunset purple with hot-pink neon.",
        palette: {
            kind: "dark",
            bg: "#241b2f", sidebar: "#1d1526", surface: "#2d2240", surface2: "#372a4e", surface3: "#44345e",
            border: "#34284a", borderStrong: "#4f3f6b",
            fg: "#f4eefc", muted: "#bcaed6", disabled: "#7c6e98",
            accent: "#ff7edb", accentFg: "#241b2f", accentHover: "#ff9be3", link: "#72f1b8", focus: "#fede5d",
            selection: "#4d2f6b", selectionFg: "#ffffff",
            success: "#72f1b8", warning: "#fede5d", danger: "#fe6b8b", info: "#36f9f6",
            ansi: { red: "#fe6b8b", green: "#72f1b8", yellow: "#fede5d", blue: "#6fb2ff", magenta: "#ff7edb", cyan: "#36f9f6", white: "#f4eefc" },
            syntax: { string: "#ff8b39", number: "#f97e72", boolean: "#fede5d", name: "#72f1b8" },
            shadow: "rgba(0, 0, 0, 0.55)"
        }
    },
    {
        id: "aurora",
        label: "Aurora",
        description: "Polar night with green and violet light.",
        palette: {
            kind: "dark",
            bg: "#0b1420", sidebar: "#08101a", surface: "#122030", surface2: "#1a2b3e", surface3: "#23374d",
            border: "#172636", borderStrong: "#2c4560",
            fg: "#e6f1f7", muted: "#9fb6c8", disabled: "#5b7085",
            accent: "#5af2a6", accentFg: "#08101a", accentHover: "#7ff5b9", link: "#7fd8ff", focus: "#b48cff",
            selection: "#23395a", selectionFg: "#ffffff",
            success: "#5af2a6", warning: "#f7d774", danger: "#ff7a93", info: "#7fd8ff",
            ansi: { red: "#ff7a93", green: "#5af2a6", yellow: "#f7d774", blue: "#7fb2ff", magenta: "#c79bff", cyan: "#7fd8ff", white: "#e6f1f7" },
            syntax: { string: "#a6f0c6", number: "#c79bff", boolean: "#7fb2ff", name: "#7fd8ff" },
            shadow: "rgba(0, 0, 0, 0.55)"
        }
    },
    {
        id: "light",
        label: "Light",
        description: "Crisp white with GitHub-style blue.",
        palette: {
            kind: "light",
            bg: "#ffffff", sidebar: "#f6f8fa", surface: "#ffffff", surface2: "#eff2f5", surface3: "#e1e6ec",
            border: "#e3e8ee", borderStrong: "#c4ccd5",
            fg: "#1f2328", muted: "#57606a", disabled: "#8c959f",
            accent: "#0969da", accentFg: "#ffffff", accentHover: "#0860c7", link: "#0969da", focus: "#0969da",
            selection: "#dbeafe", selectionFg: "#0b2350",
            success: "#1a7f37", warning: "#9a6700", danger: "#cf222e", info: "#0969da",
            ansi: { red: "#cf222e", green: "#1a7f37", yellow: "#9a6700", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#424a53" },
            syntax: { string: "#0a3069", number: "#0550ae", boolean: "#cf222e", name: "#116329" },
            shadow: "rgba(31, 35, 40, 0.15)"
        }
    },
    {
        id: "high-contrast",
        label: "High Contrast",
        description: "Pure black, bold outlines, maximum legibility.",
        palette: {
            kind: "hc",
            bg: "#000000", sidebar: "#000000", surface: "#000000", surface2: "#161616", surface3: "#262626",
            border: "#6fc3df", borderStrong: "#6fc3df",
            fg: "#ffffff", muted: "#d8d8d8", disabled: "#a6a6a6",
            accent: "#ffd60a", accentFg: "#000000", accentHover: "#ffe14d", link: "#3ff2ff", focus: "#f38518",
            selection: "#0a3d6b", selectionFg: "#ffffff",
            success: "#89d185", warning: "#ffd60a", danger: "#ff8080", info: "#3ff2ff",
            ansi: { red: "#ff8080", green: "#89d185", yellow: "#ffd60a", blue: "#7ab8ff", magenta: "#ff8cf5", cyan: "#3ff2ff", white: "#ffffff" },
            syntax: { string: "#ffd68f", number: "#b5e8a0", boolean: "#7ab8ff", name: "#9cf0ff" },
            shadow: "rgba(0, 0, 0, 0)"
        }
    }
];
function findTheme(id) {
    return exports.THEMES.find(theme => theme.id === id);
}
exports.findTheme = findTheme;
/** A stored theme id that still exists, else "system". */
function validThemeId(id) {
    return typeof id === "string" && (id === exports.SYSTEM_THEME_ID || !!findTheme(id)) ? id : exports.SYSTEM_THEME_ID;
}
exports.validThemeId = validThemeId;
/** Four colours that summarise a theme in the picker: background, surface, accent, second accent. */
function swatches(theme) {
    const p = theme.palette;
    return [p.bg, p.surface2, p.accent, p.ansi.magenta];
}
exports.swatches = swatches;
const alpha = (hex, a) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
/**
 * The VS Code theme variables a palette overrides. These are the variables
 * DevSnip Pro's webviews read; anything not listed keeps VS Code's value.
 */
function themeVariables(p) {
    const hc = p.kind === "hc";
    const v = {
        "editor-background": p.bg,
        "editor-foreground": p.fg,
        "foreground": p.fg,
        "sideBar-background": p.sidebar,
        "sideBar-foreground": p.fg,
        "sideBarTitle-foreground": p.fg,
        "sideBarSectionHeader-background": p.sidebar,
        "editorGroupHeader-tabsBackground": p.sidebar,
        "tab-activeBackground": p.bg,
        "tab-inactiveBackground": p.sidebar,
        "panel-background": p.bg,
        "panel-border": p.border,
        "focusBorder": p.focus,
        "descriptionForeground": p.muted,
        "disabledForeground": p.disabled,
        "icon-foreground": p.fg,
        "textLink-foreground": p.link,
        "textLink-activeForeground": p.link,
        "errorForeground": p.danger,
        "editorError-foreground": p.danger,
        "editorWarning-foreground": p.warning,
        "editorInfo-foreground": p.info,
        "testing-iconPassed": p.success,
        "testing-iconFailed": p.danger,
        "input-background": p.surface,
        "input-foreground": p.fg,
        "input-border": p.borderStrong,
        "input-placeholderForeground": p.muted,
        "inputOption-activeBorder": p.focus,
        "dropdown-background": p.surface,
        "dropdown-listBackground": p.surface,
        "dropdown-foreground": p.fg,
        "dropdown-border": p.borderStrong,
        "checkbox-background": p.surface,
        "checkbox-foreground": p.fg,
        "checkbox-border": p.borderStrong,
        "button-background": p.accent,
        "button-foreground": p.accentFg,
        "button-hoverBackground": p.accentHover,
        "button-border": hc ? p.border : "transparent",
        "button-secondaryBackground": p.surface2,
        "button-secondaryForeground": p.fg,
        "button-secondaryHoverBackground": p.surface3,
        "badge-background": p.accent,
        "badge-foreground": p.accentFg,
        "progressBar-background": p.accent,
        "textCodeBlock-background": p.kind === "light" ? p.surface2 : p.surface,
        "textPreformat-foreground": p.fg,
        "textBlockQuote-background": p.surface,
        "textBlockQuote-border": p.borderStrong,
        "notifications-background": p.surface,
        "notifications-foreground": p.fg,
        "notifications-border": p.borderStrong,
        "menu-background": p.surface,
        "menu-foreground": p.fg,
        "menu-border": p.borderStrong,
        "menu-selectionBackground": p.selection,
        "menu-selectionForeground": p.selectionFg,
        "menu-separatorBackground": p.border,
        "list-hoverBackground": p.surface2,
        "list-hoverForeground": p.fg,
        "list-activeSelectionBackground": p.selection,
        "list-activeSelectionForeground": p.selectionFg,
        "list-inactiveSelectionBackground": p.surface2,
        "list-focusOutline": p.focus,
        "list-highlightForeground": p.link,
        "editorWidget-background": p.surface,
        "editorWidget-foreground": p.fg,
        "editorWidget-border": p.borderStrong,
        "editorHoverWidget-background": p.surface,
        "editorHoverWidget-foreground": p.fg,
        "editorHoverWidget-border": p.borderStrong,
        "toolbar-hoverBackground": p.surface2,
        "widget-shadow": p.shadow,
        "tree-indentGuidesStroke": p.borderStrong,
        "scrollbarSlider-background": alpha(p.muted, 0.28),
        "scrollbarSlider-hoverBackground": alpha(p.muted, 0.45),
        "scrollbarSlider-activeBackground": alpha(p.muted, 0.6),
        "editor-selectionBackground": p.selection,
        "editor-findMatchBackground": alpha(p.warning, 0.55),
        "editor-findMatchHighlightBackground": alpha(p.warning, 0.3),
        "debugTokenExpression-string": p.syntax.string,
        "debugTokenExpression-number": p.syntax.number,
        "debugTokenExpression-boolean": p.syntax.boolean,
        "debugTokenExpression-name": p.syntax.name,
        "symbolIcon-propertyForeground": p.link,
        "charts-foreground": p.fg,
        "charts-red": p.ansi.red,
        "charts-green": p.ansi.green,
        "charts-yellow": p.ansi.yellow,
        "charts-blue": p.ansi.blue,
        "charts-orange": p.warning,
        "charts-purple": p.ansi.magenta
    };
    for (const [name, value] of Object.entries(p.ansi)) {
        const key = name.charAt(0).toUpperCase() + name.slice(1);
        v[`terminal-ansi${key}`] = value;
        v[`terminal-ansiBright${key}`] = value;
    }
    // High-contrast outlines exist only in the High Contrast theme; elsewhere the
    // variable is reset so each stylesheet's own fallback applies.
    v["contrastBorder"] = hc ? p.border : "initial";
    v["contrastActiveBorder"] = hc ? p.focus : "initial";
    return v;
}
exports.themeVariables = themeVariables;
/** DevSnip design tokens. Always defined, so stylesheets use them in every theme, including System Default. */
exports.DESIGN_TOKENS = `:root {
  --ds-bg: var(--vscode-editor-background, #1e1e1e);
  --ds-sidebar: var(--vscode-sideBar-background, var(--ds-bg));
  --ds-surface: var(--vscode-editorWidget-background, var(--vscode-input-background, var(--ds-bg)));
  --ds-fg: var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc));
  --ds-muted: var(--vscode-descriptionForeground, #9d9d9d);
  --ds-border: var(--vscode-panel-border, var(--vscode-input-border, rgba(127, 127, 127, 0.35)));
  --ds-accent: var(--vscode-button-background, #0e639c);
  --ds-accent-fg: var(--vscode-button-foreground, #ffffff);
  --ds-focus: var(--vscode-focusBorder, #007fd4);
  --ds-success: var(--vscode-testing-iconPassed, #3fb950);
  --ds-warning: var(--vscode-editorWarning-foreground, #cca700);
  --ds-danger: var(--vscode-errorForeground, #f14c4c);
  --ds-info: var(--vscode-editorInfo-foreground, #3794ff);
  --ds-purple: var(--vscode-charts-purple, #b180d7);
  /* Text on a success/danger/warning fill: status colours are chosen to contrast with the background. */
  --ds-on-status: var(--ds-bg);
  --ds-shadow: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
}`;
/** The CSS rules for a theme. Each rule is separate so the webview can swap them through the CSSOM. */
function themeRules(themeId, surface = "panel") {
    const rules = [exports.DESIGN_TOKENS];
    const theme = findTheme(themeId);
    if (!theme)
        return rules;
    const p = theme.palette;
    const vars = Object.entries(themeVariables(p)).map(([name, value]) => `--vscode-${name}: ${value} !important;`).join(" ");
    rules.push(`:root { ${vars} }`);
    // Native controls (scrollbars, selects, date pickers) follow the theme, not the OS; pages set it on body too.
    rules.push(`:root, body { color-scheme: ${p.kind === "light" ? "light" : "dark"} !important; }`);
    // The page paints its own background: VS Code's chrome around a webview keeps the VS Code theme.
    rules.push(`html, body { background-color: ${surface === "sidebar" ? p.sidebar : p.bg} !important; color: ${p.fg}; }`);
    rules.push(`::selection { background-color: ${alpha(p.accent, 0.35)}; }`);
    return rules;
}
exports.themeRules = themeRules;
/** A short-lived class that animates colours only while the theme changes, so it costs nothing otherwise. */
exports.TRANSITION_RULES = [
    "html.ds-theme-switching, html.ds-theme-switching *, html.ds-theme-switching *::before, html.ds-theme-switching *::after { transition: background-color .22s ease, color .22s ease, border-color .22s ease, fill .22s ease, box-shadow .22s ease !important; }",
    "@media (prefers-reduced-motion: reduce) { html.ds-theme-switching, html.ds-theme-switching * { transition: none !important; } }"
];
// ---------------------------------------------------------------------------
// Contrast (WCAG 2.x), used by the tests and available to future theme tooling.
// ---------------------------------------------------------------------------
function channel(c) {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m)
        throw new Error(`Not a #rrggbb colour: ${hex}`);
    const n = parseInt(m[1], 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
exports.luminance = luminance;
function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
exports.contrast = contrast;
//# sourceMappingURL=themes.js.map