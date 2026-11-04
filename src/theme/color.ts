/**
 * Colour maths for themes: WCAG contrast, mixing, and nudging a colour until
 * it is readable. Used by the palettes' tests and by custom accents and
 * backgrounds, so a colour the user picks can never make text unreadable.
 *
 * Pure: no vscode import.
 */

const HEX = /^#([0-9a-f]{6})$/i;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function rgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(color: string): number {
  const [r, g, b] = rgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** `a` moved `amount` (0-1) of the way towards `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((c, i) => c + (y[i] - c) * amount));
}

export function isLight(color: string): boolean {
  return luminance(color) > 0.4;
}

/** White or near-black, whichever reads better on `fill` (always at least 4.5:1). */
export function textOn(fill: string): string {
  return contrast("#ffffff", fill) >= contrast("#0b0b0f", fill) ? "#ffffff" : "#0b0b0f";
}

/**
 * `color`, or the closest tint or shade of it that reaches `min` contrast on
 * every background. It keeps the hue as long as it can, moving towards white
 * on dark backgrounds and towards black on light ones.
 */
export function readable(color: string, backgrounds: string[], min: number): string {
  const worst = (c: string) => Math.min(...backgrounds.map(bg => contrast(c, bg)));
  if (worst(color) >= min) return color;
  const darkBackgrounds = backgrounds.filter(bg => !isLight(bg)).length >= backgrounds.length / 2;
  const target = darkBackgrounds ? "#ffffff" : "#000000";
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(color, target, step / 20);
    if (worst(candidate) >= min) return candidate;
  }
  return target;
}

/** `#rrggbb` plus an alpha byte. */
export function alpha(color: string, a: number): string {
  return `${color}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}
