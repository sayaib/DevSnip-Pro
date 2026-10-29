import { TOOLKIT_COMMANDS } from "../toolkits/commands";
import { isWebHost } from "./environment";

/** Full tools stay desktop-only when even one advertised mode needs Node. */
export const DESKTOP_TOOL_REASONS: Readonly<Record<string, string>> = {
  "dev.jwt": "Node cryptography for PEM/JWK signing and verification",
  "dev.hash": "Node hash algorithms and webhook verification",
  "mobile.certificates": "Node X.509 certificate inspection",
  "mobile.local-api": "Local network interface discovery",
  "devops.network": "Local TCP port inspection",
  "ai.llm-tester": "Provider requests and environment secrets require an unrestricted host"
};
const browserCommands = new Set([
  ...TOOLKIT_COMMANDS.filter(e => !DESKTOP_TOOL_REASONS[e.tool]).map(e => e.command),
  "advancedToolsHub", "webDevHub", "mobileDevHub", "aiMlHub", "ragHub", "bigDataHub", "devopsGenerator",
  "chooseTheme", "milestoneTracker", "searchTools", "getStarted", "whatsNew",
  "insertDebugLog", "removeDebugLogsInFile"
]);
export function isCommandSupported(command: string, web = isWebHost()): boolean {
  return !web || browserCommands.has(command.replace(/^sayaib\.hue-console\./, ""));
}
export function supportedCommands(): string[] { return [...browserCommands]; }
