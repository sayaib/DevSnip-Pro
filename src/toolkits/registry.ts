import { SectionInfo, ToolDefinition } from "./types";
import { DEV_SECTION, DEV_TOOLS } from "./sections/dev";
import { AI_SECTION, AI_TOOLS } from "./sections/ai";
import { RAG_SECTION, RAG_TOOLS } from "./sections/rag";
import { DATA_SECTION, DATA_TOOLS } from "./sections/data";
import { DEVOPS_SECTION, DEVOPS_TOOLS } from "./sections/devops";

/** Every toolkit section and tool, in display order. */
export const SECTIONS: SectionInfo[] = [DEV_SECTION, AI_SECTION, RAG_SECTION, DATA_SECTION, DEVOPS_SECTION];

export const ALL_TOOLS: ToolDefinition[] = [...DEV_TOOLS, ...AI_TOOLS, ...RAG_TOOLS, ...DATA_TOOLS, ...DEVOPS_TOOLS];

export function findTool(id: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.id === id);
}

export function toolsIn(section: SectionInfo["id"]): ToolDefinition[] {
  return ALL_TOOLS.filter(t => t.section === section);
}

/**
 * Structural checks on every definition. A mistake here (a showIf pointing at
 * a missing field, a default that is not one of the options) would silently
 * break a form, so the unit tests run this.
 */
export function validateRegistry(tools: ToolDefinition[] = ALL_TOOLS, sections: SectionInfo[] = SECTIONS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const commands = new Set<string>();
  for (const tool of tools) {
    const where = tool.id;
    if (ids.has(tool.id)) problems.push(`${where}: duplicate id`);
    ids.add(tool.id);
    for (const command of [tool.command, ...(tool.aliases ?? []).map(a => a.command)]) {
      if (!/^[a-z][A-Za-z0-9]+$/.test(command)) problems.push(`${where}: command "${command}" must be camelCase`);
      if (commands.has(command)) problems.push(`${where}: duplicate command ${command}`);
      commands.add(command);
    }
    const section = sections.find(s => s.id === tool.section);
    if (!section) problems.push(`${where}: unknown section ${tool.section}`);
    else if (!section.categories.includes(tool.category)) problems.push(`${where}: category "${tool.category}" is not in section ${section.id}`);
    if (!tool.id.startsWith(`${tool.section}.`)) problems.push(`${where}: id must start with "${tool.section}."`);
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
  for (const section of sections) {
    for (const category of section.categories) if (!tools.some(t => t.section === section.id && t.category === category)) problems.push(`${section.id}: category "${category}" has no tools`);
    for (const step of section.journey ?? []) if (!ids.has(step.tool)) problems.push(`${section.id}: journey step refers to missing tool ${step.tool}`);
  }
  return problems;
}
