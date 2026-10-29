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
exports.pkcePair = exports.randomToken = exports.parseCallback = exports.OAUTH_PROVIDERS = void 0;
const types_1 = require("../toolkits/types");
const random_1 = require("./random");
var oauth_data_1 = require("../toolkits/engines/oauth-data");
Object.defineProperty(exports, "OAUTH_PROVIDERS", { enumerable: true, get: function () { return oauth_data_1.OAUTH_PROVIDERS; } });
Object.defineProperty(exports, "parseCallback", { enumerable: true, get: function () { return oauth_data_1.parseCallback; } });
const randomToken = (bytes = 16) => (0, random_1.randomBytes)(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
exports.randomToken = randomToken;
async function pkcePair(verifier) {
    const value = verifier?.trim() || (0, exports.randomToken)(32);
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(value))
        throw new types_1.ToolInputError("A code_verifier must be 43-128 unreserved characters (RFC 7636).");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return { verifier: value, challenge: (await Promise.resolve().then(() => __importStar(require("buffer")))).Buffer.from(hash).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
}
exports.pkcePair = pkcePair;
//# sourceMappingURL=oauth.js.map