"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRegistry = exports.toolsIn = exports.findTool = exports.ALL_TOOLS = exports.SECTIONS = void 0;
const dev_1 = require("./sections/dev");
const ai_1 = require("./sections/ai");
const rag_1 = require("./sections/rag");
const data_1 = require("./sections/data");
const devops_1 = require("./sections/devops");
/** Every toolkit section and tool, in display order. */
exports.SECTIONS = [dev_1.DEV_SECTION, ai_1.AI_SECTION, rag_1.RAG_SECTION, data_1.DATA_SECTION, devops_1.DEVOPS_SECTION];
exports.ALL_TOOLS = [...dev_1.DEV_TOOLS, ...ai_1.AI_TOOLS, ...rag_1.RAG_TOOLS, ...data_1.DATA_TOOLS, ...devops_1.DEVOPS_TOOLS];
function findTool(id) {
    return exports.ALL_TOOLS.find(t => t.id === id);
}
exports.findTool = findTool;
function toolsIn(section) {
    return exports.ALL_TOOLS.filter(t => t.section === section);
}
exports.toolsIn = toolsIn;
/**
 * Structural checks on every definition. A mistake here (a showIf pointing at
 * a missing field, a default that is not one of the options) would silently
 * break a form, so the unit tests run this.
 */
function validateRegistry(tools = exports.ALL_TOOLS, sections = exports.SECTIONS) {
    const problems = [];
    const ids = new Set();
    const commands = new Set();
    for (const tool of tools) {
        const where = tool.id;
        if (ids.has(tool.id))
            problems.push(`${where}: duplicate id`);
        ids.add(tool.id);
        for (const command of [tool.command, ...(tool.aliases ?? []).map(a => a.command)]) {
            if (!/^[a-z][A-Za-z0-9]+$/.test(command))
                problems.push(`${where}: command "${command}" must be camelCase`);
            if (commands.has(command))
                problems.push(`${where}: duplicate command ${command}`);
            commands.add(command);
        }
        const section = sections.find(s => s.id === tool.section);
        if (!section)
            problems.push(`${where}: unknown section ${tool.section}`);
        else if (!section.categories.includes(tool.category))
            problems.push(`${where}: category "${tool.category}" is not in section ${section.id}`);
        if (!tool.id.startsWith(`${tool.section}.`))
            problems.push(`${where}: id must start with "${tool.section}."`);
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
    for (const section of sections) {
        for (const category of section.categories)
            if (!tools.some(t => t.section === section.id && t.category === category))
                problems.push(`${section.id}: category "${category}" has no tools`);
        for (const step of section.journey ?? [])
            if (!ids.has(step.tool))
                problems.push(`${section.id}: journey step refers to missing tool ${step.tool}`);
    }
    return problems;
}
exports.validateRegistry = validateRegistry;
//# sourceMappingURL=registry.js.map