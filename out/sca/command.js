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
exports.registerScaScannerCommands = exports.SCA_COMMANDS = exports.SCA_SCAN_WORKSPACE_COMMAND = exports.SCA_SCANNER_COMMAND = void 0;
const command_registry_1 = require("../utils/command-registry");
/** The SCA dashboard: opens with the last result and the detected projects. */
exports.SCA_SCANNER_COMMAND = `${command_registry_1.COMMAND_PREFIX}scaScanner`;
/** Opens the dashboard and scans every project in the workspace. */
exports.SCA_SCAN_WORKSPACE_COMMAND = `${command_registry_1.COMMAND_PREFIX}scaScanWorkspace`;
exports.SCA_COMMANDS = [exports.SCA_SCANNER_COMMAND, exports.SCA_SCAN_WORKSPACE_COMMAND];
/** Registers the SCA Scanner's commands; the scanner loads on first use. */
function registerScaScannerCommands(context) {
    const panel = () => Promise.resolve().then(() => __importStar(require("./panel")));
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.SCA_SCANNER_COMMAND, async () => (await panel()).openScaScanner(context)), (0, command_registry_1.registerTrackedCommand)(exports.SCA_SCAN_WORKSPACE_COMMAND, async () => (await panel()).openScaScanner(context, { run: true })));
}
exports.registerScaScannerCommands = registerScaScannerCommands;
//# sourceMappingURL=command.js.map