import * as vscode from "vscode";
/** Detect the execution host, including a web worker hosted by Desktop. */
export const isWebHost = (): boolean => typeof process === "undefined" || !process.versions?.node;
export const hostPlatform = (): string => isWebHost() ? "web" : process.platform;
export const resourceName = (uri: vscode.Uri): string => uri.path.split("/").pop() || "file";
