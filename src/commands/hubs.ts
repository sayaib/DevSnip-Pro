import { HubConfig, HubIcon, HubTool } from "../utils/tool-hub";
import { COMMAND_PREFIX, NAV } from "../toolkits/layout";
import { findTool } from "../toolkits/registry";

/**
 * The "Browse all tools" hub, generated from the navigation layout so it can
 * never list a tool that does not exist, miss one that does, or show one
 * twice. Sections become the hub's filters; the old per-section hub commands
 * open it on their section (see layout.ts HUB_COMMANDS).
 */

function hubTools(): HubTool[] {
  return NAV.flatMap(section => section.entries.map(entry => {
    const tool = entry.tool ? findTool(entry.tool) : undefined;
    return {
      command: COMMAND_PREFIX + entry.command,
      title: tool?.title ?? entry.label,
      description: tool?.summary ?? entry.description,
      category: section.title,
      icon: (tool?.icon ?? entry.hubIcon ?? "code") as HubIcon,
      // Large sections show their sub-group on the card.
      tag: entry.category ?? (tool?.network ? "Uses network" : undefined),
      keywords: [...(tool?.keywords ?? entry.keywords ?? []), section.title]
    };
  }));
}

export const ALL_TOOLS_HUB: HubConfig = {
  viewType: "advancedToolsHub",
  panelTitle: "DevSnip Pro - All Tools",
  heading: "All Tools",
  subtitle: "Every DevSnip Pro tool by section, most-used first. Search with / and pin the ones you use most.",
  searchPlaceholder: "Search all tools",
  categories: NAV.map(s => s.title),
  tools: hubTools(),
  journeys: Object.fromEntries(NAV.filter(s => s.journey?.length).map(s => [s.title, s.journey!.map(step => ({ ...step, command: COMMAND_PREFIX + step.command }))]))
};

export const ALL_HUBS: HubConfig[] = [ALL_TOOLS_HUB];
