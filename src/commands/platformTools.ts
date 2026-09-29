/**
 * The security audits live in `securityTools`, where they share the rule
 * engine with the endpoint scanner. They are re-exported here so existing
 * importers keep working against the single implementation.
 *
 * The DevOps, MLOps and observability generators that used to live here were
 * replaced by the DevOps toolkit (src/toolkits/sections/devops.ts).
 */
export { scanWorkspaceForSecurity, scanLocalCloudConfiguration } from "./securityTools";
export type { SecurityFinding } from "./securityTools";
