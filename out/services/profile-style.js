"use strict";
/**
 * Styles for profile rewards: badge frames and rank card banners. The Tools
 * sidebar and the Milestones page both draw them, so they come from here.
 *
 * Frames and banners use a few fixed reward colours by design, blended into the
 * theme's own surface colour so text on the card stays readable in light, dark
 * and high-contrast themes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileCss = exports.BANNER_STYLES = exports.FRAME_STYLES = void 0;
const FRAMES = {
    glow: "box-shadow: inset 0 0 0 1px color-mix(in srgb, #e5c07b 60%, transparent), 0 0 0 2px color-mix(in srgb, #e5c07b 22%, transparent), 0 0 10px color-mix(in srgb, #e5c07b 45%, transparent);",
    flame: "box-shadow: inset 0 0 0 1.5px #ff8a3d, 0 0 0 2px color-mix(in srgb, #ff5722 30%, transparent), 0 0 12px color-mix(in srgb, #ff8a3d 55%, transparent);",
    frost: "box-shadow: inset 0 0 0 1.5px #7dd3fc, 0 0 0 2px color-mix(in srgb, #38bdf8 30%, transparent), 0 0 12px color-mix(in srgb, #38bdf8 50%, transparent);",
    pixel: "border-radius: 5px !important; box-shadow: 0 0 0 2px #22c55e, 3px 3px 0 2px #15803d;",
    neon: "box-shadow: inset 0 0 0 1.5px #ff4fd8, 0 0 0 2px color-mix(in srgb, #ff4fd8 35%, transparent), 0 0 14px color-mix(in srgb, #ff4fd8 70%, transparent);",
    rainbow: "box-shadow: 0 0 10px color-mix(in srgb, #c77dff 45%, transparent); background: radial-gradient(circle, var(--frame-inner) 0 61%, transparent 63%), conic-gradient(#ff4d4d, #ffb84d, #ffe84d, #4dff88, #4dc3ff, #9b4dff, #ff4d4d) !important;",
    shield: "box-shadow: inset 0 0 0 2px #22d3ee, 0 0 0 3px color-mix(in srgb, #0e7490 55%, transparent), 0 0 12px color-mix(in srgb, #22d3ee 45%, transparent);",
    orbit: "position: relative; box-shadow: inset 0 0 0 1px color-mix(in srgb, #c77dff 45%, transparent), 0 0 0 2px color-mix(in srgb, #c77dff 18%, transparent);"
};
const BANNERS = {
    sunset: base => `linear-gradient(115deg, color-mix(in srgb, #ff7e5f 36%, ${base}), color-mix(in srgb, #e1306c 20%, ${base}) 55%, ${base})`,
    ocean: base => `linear-gradient(115deg, color-mix(in srgb, #00b4d8 34%, ${base}), color-mix(in srgb, #0353a4 22%, ${base}) 55%, ${base})`,
    forest: base => `linear-gradient(115deg, color-mix(in srgb, #2d6a4f 40%, ${base}), color-mix(in srgb, #95d5b2 16%, ${base}) 60%, ${base})`,
    grid: base => `linear-gradient(color-mix(in srgb, #ff4fd8 16%, transparent) 1px, transparent 1px) 0 0 / 100% 12px, ` +
        `linear-gradient(90deg, color-mix(in srgb, #ff4fd8 16%, transparent) 1px, transparent 1px) 0 0 / 12px 100%, ` +
        `linear-gradient(160deg, color-mix(in srgb, #7b2ff7 26%, ${base}), ${base} 70%)`,
    stars: (base, ink) => [[12, 30], [28, 72], [44, 22], [61, 58], [77, 34], [90, 76], [36, 48], [70, 12], [84, 52], [20, 86]]
        .map(([x, y], i) => `radial-gradient(${i % 3 === 0 ? 1.5 : 1}px ${i % 3 === 0 ? 1.5 : 1}px at ${x}% ${y}%, color-mix(in srgb, ${ink} 80%, transparent) 99%, transparent)`)
        .join(", ") + `, linear-gradient(160deg, color-mix(in srgb, #1e1b4b 30%, ${base}), ${base} 75%)`,
    circuit: base => `repeating-linear-gradient(90deg, color-mix(in srgb, #10b981 14%, transparent) 0 1px, transparent 1px 18px), ` +
        `repeating-linear-gradient(0deg, color-mix(in srgb, #10b981 10%, transparent) 0 1px, transparent 1px 22px), ` +
        `linear-gradient(130deg, color-mix(in srgb, #065f46 24%, ${base}), ${base} 70%)`,
    neural: base => `radial-gradient(circle at 18% 30%, color-mix(in srgb, #a78bfa 40%, transparent) 0 2px, transparent 3px), ` +
        `radial-gradient(circle at 46% 70%, color-mix(in srgb, #a78bfa 40%, transparent) 0 2px, transparent 3px), ` +
        `radial-gradient(circle at 74% 34%, color-mix(in srgb, #22d3ee 40%, transparent) 0 2px, transparent 3px), ` +
        `linear-gradient(28deg, transparent 45%, color-mix(in srgb, #a78bfa 18%, transparent) 46% 47%, transparent 48%), ` +
        `linear-gradient(150deg, transparent 52%, color-mix(in srgb, #22d3ee 16%, transparent) 53% 54%, transparent 55%), ` +
        `linear-gradient(120deg, color-mix(in srgb, #4c1d95 26%, ${base}), ${base} 72%)`,
    gold: base => `linear-gradient(115deg, color-mix(in srgb, #f9d423 36%, ${base}), color-mix(in srgb, #e65c00 20%, ${base}) 60%, ${base})`
};
exports.FRAME_STYLES = Object.keys(FRAMES);
exports.BANNER_STYLES = Object.keys(BANNERS);
function profileCss(options) {
    const rules = [];
    for (const [name, css] of Object.entries(FRAMES)) {
        rules.push(`${options.medal.map(sel => `${sel}.frame-${name}`).join(", ")} { ${css} }`);
    }
    const orbit = options.medal.map(sel => `${sel}.frame-orbit::after`).join(", ");
    rules.push(`${orbit} { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent; border-top-color: #c77dff; border-right-color: color-mix(in srgb, #c77dff 40%, transparent); pointer-events: none; }`);
    for (const [name, background] of Object.entries(BANNERS)) {
        rules.push(`${options.banner.map(sel => `${sel}.banner-${name}`).join(", ")} { background: ${background(options.base, options.ink)}; }`);
    }
    const animated = (name) => options.medal.map(sel => `${sel}.frame-${name}`).join(", ");
    rules.push(`@media (prefers-reduced-motion: no-preference) {
  ${animated("glow")}, ${animated("flame")}, ${animated("neon")} { animation: frame-pulse 3.2s ease-in-out infinite; }
  ${orbit} { animation: frame-orbit 2.6s linear infinite; }
}
@keyframes frame-pulse { 50% { filter: brightness(1.18); } }
@keyframes frame-orbit { to { transform: rotate(360deg); } }`);
    return rules.join("\n");
}
exports.profileCss = profileCss;
//# sourceMappingURL=profile-style.js.map