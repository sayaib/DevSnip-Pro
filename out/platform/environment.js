"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resourceName = exports.hostPlatform = exports.isWebHost = void 0;
/** Detect the execution host, including a web worker hosted by Desktop. */
const isWebHost = () => typeof process === "undefined" || !process.versions?.node;
exports.isWebHost = isWebHost;
const hostPlatform = () => (0, exports.isWebHost)() ? "web" : process.platform;
exports.hostPlatform = hostPlatform;
const resourceName = (uri) => uri.path.split("/").pop() || "file";
exports.resourceName = resourceName;
//# sourceMappingURL=environment.js.map