"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportedCommands = exports.isCommandSupported = exports.DESKTOP_TOOL_REASONS = void 0;
const commands_1 = require("../toolkits/commands");
const environment_1 = require("./environment");
/** Full tools stay desktop-only when even one advertised mode needs Node. */
exports.DESKTOP_TOOL_REASONS = {
    "dev.jwt": "Node cryptography for PEM/JWK signing and verification",
    "dev.hash": "Node hash algorithms and webhook verification",
    "mobile.certificates": "Node X.509 certificate inspection",
    "mobile.local-api": "Local network interface discovery",
    "devops.network": "Local TCP port inspection",
    "ai.llm-tester": "Provider requests and environment secrets require an unrestricted host"
};
const browserCommands = new Set([
    ...commands_1.TOOLKIT_COMMANDS.filter(e => !exports.DESKTOP_TOOL_REASONS[e.tool]).map(e => e.command),
    "advancedToolsHub", "webDevHub", "mobileDevHub", "aiMlHub", "ragHub", "bigDataHub", "devopsGenerator",
    "chooseTheme", "milestoneTracker", "searchTools", "getStarted", "whatsNew",
    "insertDebugLog", "removeDebugLogsInFile"
]);
function isCommandSupported(command, web = (0, environment_1.isWebHost)()) {
    return !web || browserCommands.has(command.replace(/^sayaib\.hue-console\./, ""));
}
exports.isCommandSupported = isCommandSupported;
function supportedCommands() { return [...browserCommands]; }
exports.supportedCommands = supportedCommands;
//# sourceMappingURL=capabilities.js.map