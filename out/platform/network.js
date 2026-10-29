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
exports.toolNetwork = exports.isPortFree = void 0;
const net = __importStar(require("net"));
/** A port is in use when something accepts a connection on it (IPv4 or IPv6 loopback). */
async function isPortFree(port) {
    const listening = (host) => new Promise(resolve => {
        const socket = net.connect({ port, host });
        const done = (value) => { socket.destroy(); resolve(value); };
        socket.setTimeout(400, () => done(false));
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
    });
    const [v4, v6] = await Promise.all([listening("127.0.0.1"), listening("::1")]);
    return !v4 && !v6;
}
exports.isPortFree = isPortFree;
exports.toolNetwork = { isPortFree };
//# sourceMappingURL=network.js.map