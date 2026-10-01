import { ToolDefinition, ToolSpec } from "./types";
import { NAV, NavSection, SectionId } from "./layout";
import { DEV_TOOLS } from "./sections/dev";
import { TEXT_TOOLS } from "./sections/text";
import { WEB_TOOLS } from "./sections/web";
import { MOBILE_TOOLS } from "./sections/mobile";
import { AI_TOOLS } from "./sections/ai";
import { RAG_TOOLS } from "./sections/rag";
import { DATA_TOOLS } from "./sections/data";
import { DEVOPS_TOOLS } from "./sections/devops";

/** Every tool as its module defines it; where it is shown comes from layout.ts. */
const SPECS: ToolSpec[] = [...DEV_TOOLS, ...TEXT_TOOLS, ...WEB_TOOLS, ...MOBILE_TOOLS, ...AI_TOOLS, ...RAG_TOOLS, ...DATA_TOOLS, ...DEVOPS_TOOLS];

export const SECTIONS: NavSection[] = NAV;

/** Every toolkit tool in navigation order, with `section` and `category` from the layout. */
export const ALL_TOOLS: ToolDefinition[] = NAV.flatMap(section => section.entries.filter(e => e.tool).map(entry => {
  const spec = SPECS.find(s => s.id === entry.tool);
  if (!spec) throw new Error(`layout.ts refers to unknown tool ${entry.tool}`);
  return { ...spec, section: section.id, category: entry.category ?? "" } as ToolDefinition;
}));

export function findTool(id: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.id === id);
}

export function toolsIn(section: SectionId): ToolDefinition[] {
  return ALL_TOOLS.filter(t => t.section === section);
}

/**
 * Structural checks on every definition and on the layout. A mistake here
 * (a tool shown twice or nowhere, a showIf pointing at a missing field, a
 * default that is not one of the options) would silently break navigation or
 * a form, so the unit tests run this.
 */
export function validateRegistry(specs: ToolSpec[] = SPECS, nav: NavSection[] = NAV): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const commands = new Set<string>();
  const placed = new Map<string, number>();
  const navCommands = new Map<string, string>();
  for (const section of nav) {
    for (const entry of section.entries) {
      if (navCommands.has(entry.command)) problems.push(`${entry.command}: shown in both ${navCommands.get(entry.command)} and ${section.title}`);
      navCommands.set(entry.command, section.title);
      if (entry.tool) placed.set(entry.tool, (placed.get(entry.tool) ?? 0) + 1);
      if (section.categories && (!entry.category || !section.categories.includes(entry.category))) problems.push(`${entry.command}: category "${entry.category}" is not in ${section.title}`);
      if (!section.categories && entry.category) problems.push(`${entry.command}: ${section.title} has no sub-categories`);
      if (!entry.tool && !entry.hubIcon) problems.push(`${entry.command}: entries that are not toolkit tools need a hub icon`);
      if (entry.description.length > 110) problems.push(`${entry.command}: sidebar description is longer than a hover card line`);
    }
    for (const category of section.categories ?? []) if (!section.entries.some(e => e.category === category)) problems.push(`${section.title}: category "${category}" has no tools`);
    for (const step of section.journey ?? []) if (!section.entries.some(e => e.command === step.command)) problems.push(`${section.title}: journey step "${step.title}" is not in the section`);
  }
  for (const tool of specs) {
    const where = tool.id;
    if (ids.has(tool.id)) problems.push(`${where}: duplicate id`);
    ids.add(tool.id);
    const shown = placed.get(tool.id) ?? 0;
    if (shown !== 1) problems.push(`${where}: shown ${shown} times in layout.ts (every tool has exactly one home)`);
    const entry = nav.flatMap(s => s.entries).find(e => e.tool === tool.id);
    if (entry && entry.command !== tool.command) problems.push(`${where}: layout opens ${entry.command} but the tool's command is ${tool.command}`);
    for (const command of [tool.command, ...(tool.aliases ?? []).map(a => a.command)]) {
      if (!/^[a-z][A-Za-z0-9]+$/.test(command)) problems.push(`${where}: command "${command}" must be camelCase`);
      if (commands.has(command)) problems.push(`${where}: duplicate command ${command}`);
      commands.add(command);
    }
    const fieldIds = new Set<string>();
    for (const field of tool.fields) {
      if (fieldIds.has(field.id)) problems.push(`${where}: duplicate field ${field.id}`);
      fieldIds.add(field.id);
    }
    for (const field of tool.fields) {
      if (field.showIf && !fieldIds.has(field.showIf.field)) problems.push(`${where}.${field.id}: showIf refers to missing field ${field.showIf.field}`);
      if (field.kind === "select") {
        if (!field.options?.length) problems.push(`${where}.${field.id}: select without options`);
        else if (field.default !== undefined && !field.options.some(o => o.value === String(field.default))) problems.push(`${where}.${field.id}: default "${field.default}" is not an option`);
      }
    }
    for (const example of [...(tool.examples ?? []), ...(tool.aliases ?? [])]) {
      for (const key of Object.keys(example.values)) if (!fieldIds.has(key)) problems.push(`${where}: preset sets unknown field ${key}`);
    }
    if (tool.summary.length > 260) problems.push(`${where}: summary is too long for a card`);
  }
  for (const id of placed.keys()) if (!ids.has(id)) problems.push(`layout.ts: unknown tool ${id}`);
  return problems;
}
