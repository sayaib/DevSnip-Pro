"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanLocalCloudConfiguration = exports.scanWorkspaceForSecurity = void 0;
/**
 * The security audits live in `securityTools`, where they share the rule
 * engine with the endpoint scanner. They are re-exported here so existing
 * importers keep working against the single implementation.
 *
 * The DevOps, MLOps and observability generators that used to live here were
 * replaced by the DevOps toolkit (src/toolkits/sections/devops.ts).
 */
var securityTools_1 = require("./securityTools");
Object.defineProperty(exports, "scanWorkspaceForSecurity", { enumerable: true, get: function () { return securityTools_1.scanWorkspaceForSecurity; } });
Object.defineProperty(exports, "scanLocalCloudConfiguration", { enumerable: true, get: function () { return securityTools_1.scanLocalCloudConfiguration; } });
//# sourceMappingURL=platformTools.js.map