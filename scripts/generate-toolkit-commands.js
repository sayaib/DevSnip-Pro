#!/usr/bin/env node
/**
 * Regenerates src/toolkits/commands.ts and the package.json command titles
 * from the navigation (src/toolkits/layout.ts) and the toolkit registry.
 * Run after adding, renaming or moving a tool:
 *
 *   npm run compile && node scripts/generate-toolkit-commands.js
 *
 * Titles follow "<section emoji> DevSnip Pro: <title>". Alias commands keep
 * the title they already have; new commands are added after the last command
 * of their section.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
require(path.join(ROOT, "out/test/unit/vscode-stub")).installVscodeStub();
const { NAV, COMMAND_PREFIX } = require(path.join(ROOT, "out/toolkits/layout"));
const { ALL_TOOLS, findTool } = require(path.join(ROOT, "out/toolkits/registry"));

// 1. src/toolkits/commands.ts
const rows = ALL_TOOLS.flatMap(t => [
  { command: t.command, tool: t.id, section: t.section, title: t.title },
  ...(t.aliases || []).map(a => ({ command: a.command, tool: t.id, section: t.section, title: t.title, values: a.values }))
]);
const file = path.join(ROOT, "src/toolkits/commands.ts");
const source = fs.readFileSync(file, "utf8");
const start = source.indexOf("export const TOOLKIT_COMMANDS: ToolkitCommand[] = [");
const end = source.indexOf("];", start);
const body = rows.map(r => `  { command: ${JSON.stringify(r.command)}, tool: ${JSON.stringify(r.tool)}, section: ${JSON.stringify(r.section)}, title: ${JSON.stringify(r.title)}${r.values ? `, values: ${JSON.stringify(r.values)}` : ""} },`).join("\n");
fs.writeFileSync(file, `${source.slice(0, start)}export const TOOLKIT_COMMANDS: ToolkitCommand[] = [\n${body}\n${source.slice(end)}`);

// 2. package.json titles
const manifestPath = path.join(ROOT, "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const commands = manifest.contributes.commands;
const sectionOf = new Map();
for (const section of NAV) for (const entry of section.entries) sectionOf.set(COMMAND_PREFIX + entry.command, section);
let added = 0, renamed = 0;
const upsert = (id, title, keepTitle) => {
  const existing = commands.find(c => c.command === id);
  if (existing) {
    if (!keepTitle && existing.title !== title) { existing.title = title; renamed++; }
    return;
  }
  const section = sectionOf.get(id);
  let at = -1;
  commands.forEach((c, i) => { if (sectionOf.get(c.command) === section) at = i; });
  commands.splice(at < 0 ? commands.length : at + 1, 0, { command: id, title });
  sectionOf.set(id, section);
  added++;
};
for (const section of NAV) {
  for (const entry of section.entries) {
    const tool = entry.tool ? findTool(entry.tool) : undefined;
    upsert(COMMAND_PREFIX + entry.command, `${section.emoji} DevSnip Pro: ${entry.label}`, false);
    for (const alias of (tool && tool.aliases) || []) {
      sectionOf.set(COMMAND_PREFIX + alias.command, section);
      upsert(COMMAND_PREFIX + alias.command, `${section.emoji} DevSnip Pro: ${tool.title}`, true);
    }
  }
}
// Legacy mode aliases stay callable by shortcuts and saved links, but each tool
// has one discoverable palette entry. Its mode selector exposes the same actions.
const palette = manifest.contributes.menus.commandPalette;
for (const tool of ALL_TOOLS) for (const alias of tool.aliases || []) {
  const command = COMMAND_PREFIX + alias.command;
  const existing = palette.find(entry => entry.command === command);
  if (existing) existing.when = "false";
  else palette.push({ command, when: "false" });
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`commands.ts: ${rows.length} commands. package.json: ${added} added, ${renamed} retitled.`);
