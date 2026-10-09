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
exports.registerDatabaseClientCommand = exports.DATABASE_CLIENT_COMMAND = void 0;
const command_registry_1 = require("../utils/command-registry");
exports.DATABASE_CLIENT_COMMAND = `${command_registry_1.COMMAND_PREFIX}databaseClient`;
/**
 * Registers the Database Client command. The panel, its drivers and their
 * dependencies load on first use, so activation stays light.
 */
function registerDatabaseClientCommand(context) {
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.DATABASE_CLIENT_COMMAND, async () => {
        const { openDatabaseClient } = await Promise.resolve().then(() => __importStar(require("./panel")));
        openDatabaseClient(context);
    }));
}
exports.registerDatabaseClientCommand = registerDatabaseClientCommand;
//# sourceMappingURL=command.js.map