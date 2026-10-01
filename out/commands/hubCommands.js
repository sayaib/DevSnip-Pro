"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHubCommands = void 0;
const command_registry_1 = require("../utils/command-registry");
const tool_hub_1 = require("../utils/tool-hub");
const layout_1 = require("../toolkits/layout");
/**
 * "Browse all tools" and the older per-section hub commands, which keep
 * working (keybindings, muscle memory) and open the hub on their section.
 * The hub definition is built from the registry on first open, so
 * activation stays light.
 */
function registerHubCommands(context) {
    for (const [command, section] of Object.entries(layout_1.HUB_COMMANDS)) {
        context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(`sayaib.hue-console.${command}`, async () => {
            const { ALL_TOOLS_HUB } = await Promise.resolve().then(() => __importStar(require("./hubs")));
            (0, tool_hub_1.openToolHub)(context, ALL_TOOLS_HUB, section === "all" ? undefined : layout_1.NAV.find(s => s.id === section)?.title);
        }));
    }
}
exports.registerHubCommands = registerHubCommands;
//# sourceMappingURL=hubCommands.js.map