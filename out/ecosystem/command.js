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
exports.openProductPage = exports.registerEcosystemCommand = exports.ECOSYSTEM_COMMAND = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
const products_1 = require("./products");
exports.ECOSYSTEM_COMMAND = `${command_registry_1.COMMAND_PREFIX}ecosystem`;
/**
 * Registers "Explore DevSnip Pro Ecosystem". Nothing runs at activation; the
 * page loads on first use.
 *
 * The command takes an optional focus: a product id ("studio") or a tool
 * section id ("database"), which puts the matching app first.
 */
function registerEcosystemCommand(context) {
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.ECOSYSTEM_COMMAND, async (focus) => {
        (await Promise.resolve().then(() => __importStar(require("./panel")))).openEcosystem(context, focus);
    }));
}
exports.registerEcosystemCommand = registerEcosystemCommand;
/** Opens one DevSnip Pro app's official page. Only ids from the product list are accepted. */
async function openProductPage(id) {
    const product = (0, products_1.findProduct)(id);
    if (!product)
        return false;
    return vscode.env.openExternal(vscode.Uri.parse(product.url, true));
}
exports.openProductPage = openProductPage;
//# sourceMappingURL=command.js.map