"use strict";
/**
 * Shared shapes of the OSV Vulnerability Scanner.
 *
 * Everything in this file is plain data: it crosses from the parsers to the
 * scan, from the scan to the webview, and into exported JSON reports, so it
 * must stay serialisable (no Maps, no class instances, no functions).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_ORDER = exports.SUPPORTED_ECOSYSTEMS = void 0;
exports.SUPPORTED_ECOSYSTEMS = [
    "npm", "PyPI", "Maven", "Go", "crates.io", "RubyGems", "NuGet", "Packagist", "Pub", "Hex", "SwiftURL", "CRAN"
];
exports.SEVERITY_ORDER = ["critical", "high", "medium", "low", "unknown"];
//# sourceMappingURL=types.js.map