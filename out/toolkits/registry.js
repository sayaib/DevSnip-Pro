"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRegistry = exports.toolsIn = exports.findTool = exports.ALL_TOOLS = exports.SECTIONS = void 0;
const layout_1 = require("./layout");
const dev_1 = require("./sections/dev");
const text_1 = require("./sections/text");
const web_1 = require("./sections/web");
const mobile_1 = require("./sections/mobile");
const ai_1 = require("./sections/ai");
const rag_1 = require("./sections/rag");
const data_1 = require("./sections/data");
const devops_1 = require("./sections/devops");
/** Every tool as its module defines it; where it is shown comes from layout.ts. */
const SPECS = [...dev_1.DEV_TOOLS, ...text_1.TEXT_TOOLS, ...web_1.WEB_TOOLS, ...mobile_1.MOBILE_TOOLS, ...ai_1.AI_TOOLS, ...rag_1.RAG_TOOLS, ...data_1.DATA_TOOLS, ...devops_1.DEVOPS_TOOLS];
exports.SECTIONS = layout_1.NAV;
/** Every toolkit tool in navigation order, with `section` and `category` from the layout. */
exports.ALL_TOOLS = layout_1.NAV.flatMap(section => section.entries.filter(e => e.tool).map(entry => {
    const spec = SPECS.find(s => s.id === entry.tool);
    if (!spec)
        throw new Error(`layout.ts refers to unknown tool ${entry.tool}`);
    return { ...spec, section: section.id, category: entry.category ?? "" };
}));
function findTool(id) {
    return exports.ALL_TOOLS.find(t => t.id === id);
}
exports.findTool = findTool;
function toolsIn(section) {
    return exports.ALL_TOOLS.filter(t => t.section === section);
}
exports.toolsIn = toolsIn;
/**
 * Structural checks on every definition and on the layout. A mistake here
 * (a tool shown twice or nowhere, a showIf pointing at a missing field, a
 * default that is not one of the options) would silently break navigation or
 * a form, so the unit tests run this.
 */
function validateRegistry(specs = SPECS, nav = layout_1.NAV) {
    const problems = [];
    const ids = new Set();
    const commands = new Set();
    const placed = new Map();
    const navCommands = new Map();
    for (const section of nav) {
        for (const entry of section.entries) {
            if (navCommands.has(entry.command))
                problems.push(`${entry.command}: shown in both ${navCommands.get(entry.command)} and ${section.title}`);
            navCommands.set(entry.command, section.title);
            if (entry.tool)
                placed.set(entry.tool, (placed.get(entry.tool) ?? 0) + 1);
            if (section.categories && (!entry.category || !section.categories.includes(entry.category)))
                problems.push(`${entry.command}: category "${entry.category}" is not in ${section.title}`);
            if (!section.categories && entry.category)
                problems.push(`${entry.command}: ${section.title} has no sub-categories`);
            if (!entry.tool && !entry.hubIcon)
                problems.push(`${entry.command}: entries that are not toolkit tools need a hub icon`);
            if (entry.description.length > 110)
                problems.push(`${entry.command}: sidebar description is longer than a hover card line`);
        }
        for (const category of section.categories ?? [])
            if (!section.entries.some(e => e.category === category))
                problems.push(`${section.title}: category "${category}" has no tools`);
        for (const step of section.journey ?? [])
            if (!section.entries.some(e => e.command === step.command))
                problems.push(`${section.title}: journey step "${step.title}" is not in the section`);
    }
    for (const tool of specs) {
        const where = tool.id;
        if (ids.has(tool.id))
            problems.push(`${where}: duplicate id`);
        ids.add(tool.id);
        const shown = placed.get(tool.id) ?? 0;
        if (shown !== 1)
            problems.push(`${where}: shown ${shown} times in layout.ts (every tool has exactly one home)`);
        const entry = nav.flatMap(s => s.entries).find(e => e.tool === tool.id);
        if (entry && entry.command !== tool.command)
            problems.push(`${where}: layout opens ${entry.command} but the tool's command is ${tool.command}`);
        for (const command of [tool.command, ...(tool.aliases ?? []).map(a => a.command)]) {
            if (!/^[a-z][A-Za-z0-9]+$/.test(command))
                problems.push(`${where}: command "${command}" must be camelCase`);
            if (commands.has(command))
                problems.push(`${where}: duplicate command ${command}`);
            commands.add(command);
        }
        const fieldIds = new Set();
        for (const field of tool.fields) {
            if (fieldIds.has(field.id))
                problems.push(`${where}: duplicate field ${field.id}`);
            fieldIds.add(field.id);
        }
        for (const field of tool.fields) {
            if (field.showIf && !fieldIds.has(field.showIf.field))
                problems.push(`${where}.${field.id}: showIf refers to missing field ${field.showIf.field}`);
            if (field.kind === "select") {
                if (!field.options?.length)
                    problems.push(`${where}.${field.id}: select without options`);
                else if (field.default !== undefined && !field.options.some(o => o.value === String(field.default)))
                    problems.push(`${where}.${field.id}: default "${field.default}" is not an option`);
            }
        }
        for (const example of [...(tool.examples ?? []), ...(tool.aliases ?? [])]) {
            for (const key of Object.keys(example.values))
                if (!fieldIds.has(key))
                    problems.push(`${where}: preset sets unknown field ${key}`);
        }
        if (tool.summary.length > 260)
            problems.push(`${where}: summary is too long for a card`);
    }
    for (const id of placed.keys())
        if (!ids.has(id))
            problems.push(`layout.ts: unknown tool ${id}`);
    return problems;
}
exports.validateRegistry = validateRegistry;
//# sourceMappingURL=registry.js.map