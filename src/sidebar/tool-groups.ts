import { COMMAND_PREFIX, NAV } from "../toolkits/layout";

/**
 * The Tools sidebar's groups and tools, derived from the navigation layout
 * (src/toolkits/layout.ts) so the sidebar, the All Tools hub and search
 * always agree. Icons are codicon ids; colours are VS Code theme colour ids.
 */

export interface SidebarTool {
  label: string;
  /** Full command id, e.g. sayaib.hue-console.openGUI. */
  command: string;
  /** Codicon id. */
  icon: string;
  /** One line shown in the hover card. */
  description: string;
}

export interface SidebarGroup {
  name: string;
  /** Codicon id. */
  icon: string;
  /** Theme colour id used for the category icon, e.g. terminal.ansiBrightYellow. */
  color: string;
  tools: SidebarTool[];
}

export const MILESTONE_COMMAND = `${COMMAND_PREFIX}milestoneTracker`;
export const SEARCH_COMMAND = `${COMMAND_PREFIX}searchTools`;

export const SIDEBAR_GROUPS: SidebarGroup[] = NAV.map(section => ({
  name: section.title,
  icon: section.codicon,
  color: section.color,
  tools: section.entries.map(entry => ({ label: entry.label, command: COMMAND_PREFIX + entry.command, icon: entry.codicon, description: entry.description }))
}));

/** Every command the sidebar can run; anything else posted by the page is ignored. */
export function sidebarCommands(): Set<string> {
  return new Set([MILESTONE_COMMAND, SEARCH_COMMAND, ...SIDEBAR_GROUPS.flatMap(group => group.tools.map(t => t.command))]);
}
