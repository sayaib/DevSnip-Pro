"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sidebarCommands = exports.SIDEBAR_GROUPS = exports.SEARCH_COMMAND = exports.MILESTONE_COMMAND = void 0;
const layout_1 = require("../toolkits/layout");
exports.MILESTONE_COMMAND = `${layout_1.COMMAND_PREFIX}milestoneTracker`;
exports.SEARCH_COMMAND = `${layout_1.COMMAND_PREFIX}searchTools`;
exports.SIDEBAR_GROUPS = layout_1.NAV.map(section => ({
    name: section.title,
    icon: section.codicon,
    color: section.color,
    tools: section.entries.map(entry => ({ label: entry.label, command: layout_1.COMMAND_PREFIX + entry.command, icon: entry.codicon, description: entry.description }))
}));
/** Every command the sidebar can run; anything else posted by the page is ignored. */
function sidebarCommands() {
    return new Set([exports.MILESTONE_COMMAND, exports.SEARCH_COMMAND, ...exports.SIDEBAR_GROUPS.flatMap(group => group.tools.map(t => t.command))]);
}
exports.sidebarCommands = sidebarCommands;
//# sourceMappingURL=tool-groups.js.map