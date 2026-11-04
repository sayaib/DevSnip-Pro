"use strict";
/**
 * Personal tweaks layered on top of any theme: accent colour, background,
 * corner style, border strength, shadows, fonts and the theme-change fade.
 *
 * A tweak is applied to the palette before it is expanded into VS Code
 * variables, so every page picks it up the same way it picks up a theme.
 * Colours the user chooses are checked against the palette and nudged until
 * text stays readable (WCAG AA), so no combination can hide text.
 *
 * Pure: no vscode import, so it is unit tested directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.customRules = exports.adaptiveAccentVariables = exports.applyCustomization = exports.usableBackground = exports.isCustomized = exports.validCustomization = exports.MONO_PRESETS = exports.FONT_PRESETS = exports.SHADOW_STYLES = exports.BORDER_STYLES = exports.RADIUS_STYLES = void 0;
const color_1 = require("./color");
exports.RADIUS_STYLES = ["sharp", "default", "rounded", "round"];
exports.BORDER_STYLES = ["subtle", "default", "strong"];
exports.SHADOW_STYLES = ["flat", "default", "elevated"];
/** Font choices offered by Theme Studio. Any other font list can be typed in. */
exports.FONT_PRESETS = [
    { label: "VS Code", value: "" },
    { label: "System UI", value: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` },
    { label: "Inter", value: `Inter, "Segoe UI", system-ui, sans-serif` },
    { label: "Segoe UI", value: `"Segoe UI", system-ui, sans-serif` },
    { label: "SF Pro", value: `"SF Pro Text", -apple-system, system-ui, sans-serif` },
    { label: "Roboto", value: `Roboto, "Segoe UI", system-ui, sans-serif` }
];
exports.MONO_PRESETS = [
    { label: "VS Code editor", value: "" },
    { label: "JetBrains Mono", value: `"JetBrains Mono", ui-monospace, monospace` },
    { label: "Fira Code", value: `"Fira Code", ui-monospace, monospace` },
    { label: "Cascadia Code", value: `"Cascadia Code", Consolas, monospace` },
    { label: "SF Mono", value: `"SF Mono", Menlo, ui-monospace, monospace` },
    { label: "Consolas", value: `Consolas, "Courier New", monospace` }
];
function fontList(value) {
    if (typeof value !== "string")
        return undefined;
    // Letters, digits, spaces, quotes, commas and dashes only: the value is written into a stylesheet.
    const clean = value.replace(/[^\w\s"',.-]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
    return clean || undefined;
}
function oneOf(values, value) {
    return typeof value === "string" && values.includes(value) ? value : undefined;
}
/** A stored or posted customization, with anything invalid dropped and defaults left out. */
function validCustomization(value) {
    const v = (value && typeof value === "object" ? value : {});
    const out = {};
    if ((0, color_1.isHex)(v.accent))
        out.accent = v.accent.toLowerCase();
    if ((0, color_1.isHex)(v.background))
        out.background = v.background.toLowerCase();
    const radius = oneOf(exports.RADIUS_STYLES, v.radius);
    if (radius && radius !== "default")
        out.radius = radius;
    const borders = oneOf(exports.BORDER_STYLES, v.borders);
    if (borders && borders !== "default")
        out.borders = borders;
    const shadows = oneOf(exports.SHADOW_STYLES, v.shadows);
    if (shadows && shadows !== "default")
        out.shadows = shadows;
    const font = fontList(v.font);
    if (font)
        out.font = font;
    const monoFont = fontList(v.monoFont);
    if (monoFont)
        out.monoFont = monoFont;
    if (v.motion === false)
        out.motion = false;
    return out;
}
exports.validCustomization = validCustomization;
function isCustomized(custom) {
    return Object.keys(custom).length > 0;
}
exports.isCustomized = isCustomized;
/**
 * A background that text can be readable on. Mid tones (grey, saturated
 * magenta) leave no text colour with 7:1 contrast, so they are lightened or
 * deepened, keeping their hue, until body text, muted text and status colours
 * all fit.
 */
function usableBackground(bg) {
    const light = (0, color_1.isLight)(bg);
    const target = light ? "#ffffff" : "#000000";
    for (let step = 0; step <= 20; step++) {
        const candidate = (0, color_1.mix)(bg, target, step / 20);
        const lum = (0, color_1.luminance)(candidate);
        if (light ? lum >= 0.72 : lum <= 0.03)
            return candidate;
    }
    return target;
}
exports.usableBackground = usableBackground;
/** Surfaces and borders derived from one background colour. */
function surfacesFrom(bg) {
    if ((0, color_1.isLight)(bg)) {
        return {
            kind: "light", bg,
            sidebar: (0, color_1.mix)(bg, "#000000", 0.03), surface: bg, surface2: (0, color_1.mix)(bg, "#000000", 0.05), surface3: (0, color_1.mix)(bg, "#000000", 0.1),
            border: (0, color_1.mix)(bg, "#000000", 0.1), borderStrong: (0, color_1.mix)(bg, "#000000", 0.24)
        };
    }
    return {
        kind: "dark", bg,
        sidebar: (0, color_1.mix)(bg, "#000000", 0.2), surface: (0, color_1.mix)(bg, "#ffffff", 0.05), surface2: (0, color_1.mix)(bg, "#ffffff", 0.1), surface3: (0, color_1.mix)(bg, "#ffffff", 0.16),
        border: (0, color_1.mix)(bg, "#ffffff", 0.09), borderStrong: (0, color_1.mix)(bg, "#ffffff", 0.2)
    };
}
/**
 * The palette with the customization applied. Text, links, status and code
 * colours are re-checked against the new backgrounds, so the result meets
 * the same contrast rules as the built-in themes.
 */
function applyCustomization(base, custom) {
    if (!isCustomized(custom))
        return base;
    let p = { ...base, ansi: { ...base.ansi }, syntax: { ...base.syntax } };
    const hc = base.kind === "hc";
    if (custom.background && custom.background !== base.bg) {
        const background = usableBackground(custom.background);
        const flipped = (0, color_1.isLight)(background) !== (base.kind === "light");
        const surfaces = surfacesFrom(background);
        p = { ...p, ...surfaces, kind: hc && surfaces.kind === "dark" ? "hc" : surfaces.kind };
        // A dark theme on a light background (or the reverse) starts from neutral text, then keeps it readable.
        if (flipped) {
            p.fg = p.kind === "light" ? "#1f2328" : "#e8eaee";
            p.muted = p.kind === "light" ? "#59636e" : "#a3a9b4";
            p.disabled = p.kind === "light" ? "#8c959f" : "#6f747e";
            p.shadow = p.kind === "light" ? "rgba(31, 35, 40, 0.15)" : "rgba(0, 0, 0, 0.45)";
        }
        // The gradient was drawn for the theme's own background.
        delete p.backdrop;
    }
    if (custom.accent) {
        p.accent = custom.accent;
        p.accentFg = (0, color_1.textOn)(custom.accent);
        p.accentHover = (0, color_1.mix)(custom.accent, p.accentFg === "#ffffff" ? "#000000" : "#ffffff", 0.12);
        p.focus = custom.accent;
        p.link = custom.accent;
    }
    if (custom.background || custom.accent) {
        p.selection = (0, color_1.mix)(p.bg, p.accent, p.kind === "light" ? 0.18 : 0.32);
    }
    if (!hc && custom.borders === "subtle") {
        p.border = (0, color_1.mix)(p.border, p.bg, 0.5);
        p.borderStrong = (0, color_1.mix)(p.borderStrong, p.bg, 0.35);
    }
    else if (!hc && custom.borders === "strong") {
        p.border = (0, color_1.mix)(p.border, p.fg, 0.18);
        p.borderStrong = (0, color_1.mix)(p.borderStrong, p.fg, 0.3);
    }
    if (custom.shadows === "flat")
        p.shadow = "rgba(0, 0, 0, 0)";
    else if (custom.shadows === "elevated")
        p.shadow = p.kind === "light" ? "rgba(31, 35, 40, 0.28)" : "rgba(0, 0, 0, 0.7)";
    return ensureReadable(p);
}
exports.applyCustomization = applyCustomization;
/** Re-checks every text colour against the backgrounds it is drawn on. */
function ensureReadable(p) {
    const panels = [p.bg, p.sidebar];
    p.fg = (0, color_1.readable)(p.fg, [...panels, p.surface, p.surface2], 7);
    p.muted = (0, color_1.readable)(p.muted, [...panels, p.surface], 4.5);
    p.disabled = (0, color_1.readable)(p.disabled, [p.bg], 2.5);
    p.link = (0, color_1.readable)(p.link, [p.bg, p.surface], 4.5);
    p.focus = (0, color_1.readable)(p.focus, [p.bg], 3);
    p.selectionFg = (0, color_1.readable)(p.selectionFg, [p.selection], 4.5);
    if ((0, color_1.contrast)(p.fg, p.selection) < 4.5)
        p.selection = (0, color_1.mix)(p.selection, p.bg, 0.5);
    if ((0, color_1.contrast)(p.accentFg, p.accentHover) < 4.5)
        p.accentHover = p.accent;
    for (const key of ["success", "warning", "danger", "info"])
        p[key] = (0, color_1.readable)(p[key], [p.bg], 4.5);
    for (const key of Object.keys(p.ansi))
        p.ansi[key] = (0, color_1.readable)(p.ansi[key], [p.bg], 3);
    for (const key of Object.keys(p.syntax))
        p.syntax[key] = (0, color_1.readable)(p.syntax[key], [p.bg], 4.5);
    return p;
}
/**
 * VS Code variables an accent overrides under VS Code Adaptive, where there is
 * no palette: only colours drawn on the accent itself, plus focus rings.
 */
function adaptiveAccentVariables(accent) {
    const fg = (0, color_1.textOn)(accent);
    const hover = (0, color_1.mix)(accent, fg === "#ffffff" ? "#000000" : "#ffffff", 0.12);
    return {
        "button-background": accent,
        "button-foreground": fg,
        "button-hoverBackground": (0, color_1.contrast)(fg, hover) >= 4.5 ? hover : accent,
        "badge-background": accent,
        "badge-foreground": fg,
        "progressBar-background": accent,
        "focusBorder": accent,
        "inputOption-activeBorder": accent
    };
}
exports.adaptiveAccentVariables = adaptiveAccentVariables;
const RADII = {
    sharp: [0, 2, 3],
    default: [4, 8, 12],
    rounded: [6, 12, 18],
    round: [10, 18, 24]
};
/** Extra CSS for the non-colour tweaks. Empty when nothing is customized. */
function customRules(custom) {
    const rules = [];
    const tokens = [];
    if (custom.radius) {
        const [sm, md, lg] = RADII[custom.radius];
        tokens.push(`--ds-radius-sm: ${sm}px`, `--ds-radius-md: ${md}px`, `--ds-radius-lg: ${lg}px`);
    }
    if (custom.shadows === "flat")
        tokens.push("--ds-shadow-sm: none", "--ds-shadow-md: none", "--ds-shadow-lg: none");
    if (custom.shadows === "elevated")
        tokens.push("--ds-shadow-sm: 0 2px 6px var(--ds-shadow)", "--ds-shadow-md: 0 8px 24px var(--ds-shadow)", "--ds-shadow-lg: 0 18px 48px var(--ds-shadow)");
    if (custom.font)
        tokens.push(`--vscode-font-family: ${custom.font} !important`);
    if (custom.monoFont)
        tokens.push(`--vscode-editor-font-family: ${custom.monoFont} !important`);
    if (tokens.length)
        rules.push(`:root { ${tokens.join("; ")}; }`);
    if (custom.font)
        rules.push(`body { font-family: ${custom.font}; }`);
    if (custom.radius) {
        // Pages draw their own corners, so the common components are restyled directly.
        rules.push(`body :is(.btn, .button, button:not([class*="icon"]):not([class*="dot"]):not([class*="avatar"]):not([class*="tab"]), input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), select, textarea, .input, .chip, .tag, .pill) { border-radius: var(--ds-radius-md) !important; }`);
        rules.push(`body :is(.section, .card, .panel, .stat, .modal, .dialog, .tile, .out, .result-block, .kind-card, .svc-card, .theme-opt) { border-radius: var(--ds-radius-lg) !important; }`);
    }
    if (custom.shadows === "flat")
        rules.push(`body :is(.section, .card, .stat, .modal, .dialog, .tile, .toast) { box-shadow: none !important; }`);
    return rules;
}
exports.customRules = customRules;
//# sourceMappingURL=custom.js.map