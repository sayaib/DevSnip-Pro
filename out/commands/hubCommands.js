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
/**
 * The tool hubs. Hub definitions are built from the toolkit registry, which is
 * loaded on first open so activation stays light.
 */
function registerHubCommands(context) {
    const hubs = [
        ["advancedToolsHub", "DEVELOPER_TOOLS_HUB"],
        ["aiMlHub", "AI_ML_HUB"],
        ["ragHub", "RAG_HUB"],
        ["bigDataHub", "DATA_HUB"],
        ["devopsGenerator", "DEVOPS_HUB"]
    ];
    for (const [command, key] of hubs) {
        context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(`sayaib.hue-console.${command}`, async () => {
            const definitions = await Promise.resolve().then(() => __importStar(require("./hubs")));
            (0, tool_hub_1.openToolHub)(context, definitions[key]);
        }));
    }
}
exports.registerHubCommands = registerHubCommands;
//# sourceMappingURL=hubCommands.js.map