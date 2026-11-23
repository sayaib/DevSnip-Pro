"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformMarks = exports.platformMark = void 0;
/**
 * Small inline platform marks (24×24), so neither the sidebar nor the
 * ecosystem page loads an image or touches the network to draw them. They
 * use presentation attributes only: the pages' CSP blocks inline styles.
 * `currentColor` parts follow the theme's text colour.
 */
const MARKS = {
    chrome: `<path d="M12 12 2.47 6.5A11 11 0 0 1 21.53 6.5Z" fill="#EA4335"/>` +
        `<path d="M12 12 21.53 6.5A11 11 0 0 1 12 23Z" fill="#FBBC04"/>` +
        `<path d="M12 12 12 23A11 11 0 0 1 2.47 6.5Z" fill="#34A853"/>` +
        `<circle cx="12" cy="12" r="5.2" fill="#fff"/><circle cx="12" cy="12" r="4.1" fill="#4285F4"/>`,
    jetbrains: `<rect x="2" y="2" width="20" height="20" rx="2.5" fill="#000"/>` +
        `<text x="5" y="13.6" font-family="Arial, Helvetica, sans-serif" font-size="8.4" font-weight="700" fill="#fff">JB</text>` +
        `<rect x="5" y="16.6" width="7.5" height="1.7" fill="#fff"/>`,
    msstore: `<path d="M8.25 7.5V6a3.75 3.75 0 0 1 7.5 0v1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>` +
        `<rect x="2.75" y="7.25" width="18.5" height="14.5" rx="2.25" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
        `<rect x="7.25" y="10.25" width="4.5" height="4.5" fill="#F25022"/><rect x="12.25" y="10.25" width="4.5" height="4.5" fill="#7FBA00"/>` +
        `<rect x="7.25" y="15.25" width="4.5" height="4.5" fill="#00A4EF"/><rect x="12.25" y="15.25" width="4.5" height="4.5" fill="#FFB900"/>`,
    vscode: `<path fill-rule="evenodd" d="M16.9 2.1 21.4 4.3c.4.2.6.6.6 1v13.4c0 .4-.2.8-.6 1l-4.5 2.2-9.3-8.5-3.8 2.9L2 15.4V8.6l1.8-.9 3.8 2.9ZM17 7.3 11.4 12l5.6 4.7Z" fill="#0A7ACC"/>`,
    /** The DevSnip Pro hexagon and cube, for when the logo image is unavailable. */
    brand: `<path d="M12 2.2 20.5 7.1v9.8L12 21.8 3.5 16.9V7.1Z" fill="none" stroke="#3FD9D3" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M12 7.4 16 9.7 12 12 8 9.7Z" fill="#7CF6EF"/>` +
        `<path d="M8 9.7 12 12v4.6L8 14.3Z" fill="#2FCFC8"/><path d="M16 9.7 12 12v4.6l4-2.3Z" fill="#1AA9A4"/>`
};
function platformMark(mark, size = 20, className = "mark") {
    return `<svg class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${MARKS[mark]}</svg>`;
}
exports.platformMark = platformMark;
/** Every mark as raw SVG markup, for the sidebar page to place. */
function platformMarks() {
    return { ...MARKS };
}
exports.platformMarks = platformMarks;
//# sourceMappingURL=marks.js.map