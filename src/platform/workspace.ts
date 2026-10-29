import * as vscode from "vscode";
import { isWebHost } from "./environment";

export interface OutputCapabilities {
  writeWorkspace: boolean;
  insert: boolean;
  saveAs: boolean;
}

/** Ask the provider, rather than guessing from names such as github1s/gitlab1s. */
export function canWriteResource(uri: vscode.Uri): boolean {
  return vscode.workspace.fs?.isWritableFileSystem?.(uri.scheme) !== false;
}

export function outputCapabilities(editor?: vscode.TextEditor, root = vscode.workspace.workspaceFolders?.[0]?.uri): OutputCapabilities {
  const writeWorkspace = !!root && canWriteResource(root);
  return {
    writeWorkspace,
    insert: !editor || canWriteResource(editor.document.uri),
    // Browser save dialogs use the workspace provider; Desktop can choose a local folder.
    saveAs: !isWebHost() || writeWorkspace
  };
}
