"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_HUBS = exports.ALL_TOOLS_HUB = void 0;
const layout_1 = require("../toolkits/layout");
const registry_1 = require("../toolkits/registry");
/**
 * The "Browse all tools" hub, generated from the navigation layout so it can
 * never list a tool that does not exist, miss one that does, or show one
 * twice. Sections become the hub's filters; the old per-section hub commands
 * open it on their section (see layout.ts HUB_COMMANDS).
 */
function hubTools() {
    return layout_1.NAV.flatMap(section => section.entries.map(entry => {
        const tool = entry.tool ? (0, registry_1.findTool)(entry.tool) : undefined;
        return {
            command: layout_1.COMMAND_PREFIX + entry.command,
            title: tool?.title ?? entry.label,
            description: tool?.summary ?? entry.description,
            category: section.title,
            icon: (tool?.icon ?? entry.hubIcon ?? "code"),
            // Large sections show their sub-group on the card.
            tag: entry.category ?? (tool?.network ? "Uses network" : undefined),
            keywords: [...(tool?.keywords ?? entry.keywords ?? []), section.title]
        };
    }));
}
exports.ALL_TOOLS_HUB = {
    viewType: "advancedToolsHub",
    panelTitle: "DevSnip Pro - All Tools",
    heading: "All Tools",
    subtitle: "Every DevSnip Pro tool by section, most-used first. Search with / and pin the ones you use most.",
    searchPlaceholder: "Search all tools",
    categories: layout_1.NAV.map(s => s.title),
    tools: hubTools(),
    journeys: Object.fromEntries(layout_1.NAV.filter(s => s.journey?.length).map(s => [s.title, s.journey.map(step => ({ ...step, command: layout_1.COMMAND_PREFIX + step.command }))]))
};
exports.ALL_HUBS = [exports.ALL_TOOLS_HUB];
//# sourceMappingURL=hubs.js.map