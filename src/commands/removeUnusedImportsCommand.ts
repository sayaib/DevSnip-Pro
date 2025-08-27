import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

interface UnusedImport {
  filePath: string;
  lineNumber: number;
  importStatement: string;
  importedSymbols: string[];
}

export function registerRemoveUnusedImportsCommand(
  context: vscode.ExtensionContext
) {
  const command = vscode.commands.registerCommand(
    "sayaib.hue-console.removeUnusedImports",
    async () => {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage("No workspace is open.");
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "removeUnusedImports",
        "Remove Unused Imports",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      
      const iconPath = path.resolve(context.extensionPath, "logo.png");
      panel.iconPath = vscode.Uri.file(iconPath);

      panel.webview.html = generateLoadingContent(
        "Analyzing imports... Please wait..."
      );

      const unusedImports: UnusedImport[] = [];

      // Define file search pattern for TypeScript/JavaScript files
      const searchPattern = "**/*.{ts,tsx,js,jsx}";
      const excludePattern =
        "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/temp/**,**/.next/**,**/out/**}";

      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(
          vscode.workspace.workspaceFolders[0],
          searchPattern
        ),
        excludePattern
      );

      // Analyze each file for unused imports
      await Promise.all(
        files.map(async (file) => {
          try {
            const content = await fs.readFile(file.fsPath, "utf8");
            const fileUnusedImports = analyzeFileImports(content, file.fsPath);
            unusedImports.push(...fileUnusedImports);
          } catch (error) {
            console.error(`Error reading file ${file.fsPath}:`, error);
          }
        })
      );

      if (unusedImports.length === 0) {
        panel.webview.html = generateLoadingContent(
          "No unused imports found. Your code is clean! 🎉"
        );
        vscode.window.showInformationMessage("No unused imports found.");
        return;
      }

      panel.webview.html = generateWebviewContent(unusedImports);

      panel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === "removeSelectedImports") {
            await removeSelectedImports(message.selectedImports, panel);
          } else if (message.command === "removeAllImports") {
            await removeSelectedImports(unusedImports, panel);
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(command);
}

function analyzeFileImports(content: string, filePath: string): UnusedImport[] {
  const unusedImports: UnusedImport[] = [];
  const lines = content.split('\n');
  
  // Import patterns
  const importPatterns = [
    // Named imports: import { a, b } from 'module'
    /^\s*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/,
    // Default imports: import React from 'react'
    /^\s*import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*from\s*['"]([^'"]+)['"];?/,
    // Namespace imports: import * as React from 'react'
    /^\s*import\s*\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*from\s*['"]([^'"]+)['"];?/,
    // Mixed imports: import React, { useState } from 'react'
    /^\s*import\s+([a-zA-Z_$][a-zA-Z0-9_$]*),\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/
  ];

  lines.forEach((line, index) => {
    for (const pattern of importPatterns) {
      const match = line.match(pattern);
      if (match) {
        const importedSymbols = extractImportedSymbols(match, pattern);
        const unusedSymbols = importedSymbols.filter(symbol => 
          !isSymbolUsed(symbol, content, line)
        );
        
        if (unusedSymbols.length > 0) {
          // Check if all symbols in the import are unused
          if (unusedSymbols.length === importedSymbols.length) {
            unusedImports.push({
              filePath,
              lineNumber: index + 1,
              importStatement: line.trim(),
              importedSymbols: unusedSymbols
            });
          }
        }
        break;
      }
    }
  });

  return unusedImports;
}

function extractImportedSymbols(match: RegExpMatchArray, pattern: RegExp): string[] {
  const symbols: string[] = [];
  
  if (pattern.source.includes('\\{([^}]+)\\}')) {
    // Named imports
    const namedImports = match[1] || match[2];
    if (namedImports) {
      symbols.push(...namedImports.split(',').map(s => s.trim().split(' as ')[0]));
    }
  }
  
  if (pattern.source.includes('([a-zA-Z_$][a-zA-Z0-9_$]*)')) {
    // Default or namespace imports
    const defaultImport = match[1];
    if (defaultImport && !defaultImport.includes('{')) {
      symbols.push(defaultImport);
    }
  }
  
  return symbols.filter(s => s && s.length > 0);
}

function isSymbolUsed(symbol: string, content: string, importLine: string): boolean {
  // Remove the import line from content to avoid false positives
  const contentWithoutImport = content.replace(importLine, '');
  
  // Check various usage patterns
  const usagePatterns = [
    new RegExp(`\\b${symbol}\\b`, 'g'),           // Direct usage
    new RegExp(`${symbol}\\.`, 'g'),              // Property access
    new RegExp(`<${symbol}[\\s>]`, 'g'),          // JSX component
    new RegExp(`<${symbol}/`, 'g'),               // Self-closing JSX
    new RegExp(`typeof\\s+${symbol}\\b`, 'g'),    // typeof usage
    new RegExp(`instanceof\\s+${symbol}\\b`, 'g') // instanceof usage
  ];
  
  return usagePatterns.some(pattern => pattern.test(contentWithoutImport));
}

async function removeSelectedImports(
  selectedImports: UnusedImport[],
  panel: vscode.WebviewPanel
) {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const modifiedFiles = new Set<string>();

  for (const importItem of selectedImports) {
    try {
      const uri = vscode.Uri.file(importItem.filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const line = document.lineAt(importItem.lineNumber - 1);
      workspaceEdit.delete(uri, line.rangeIncludingLineBreak);
      modifiedFiles.add(importItem.filePath);
    } catch (error) {
      console.error(`Error processing import in file ${importItem.filePath}:`, error);
    }
  }

  await vscode.workspace.applyEdit(workspaceEdit);

  // Save all modified files
  for (const filePath of modifiedFiles) {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    await document.save();
  }

  vscode.window.showInformationMessage(
    `Removed ${selectedImports.length} unused import statements.`
  );

  panel.webview.html = generateLoadingContent(
    "Unused imports removed successfully! 🎉"
  );
}

function generateLoadingContent(message: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                padding: 20px;
                background: #1e1e1e;
                color: #d4d4d4;
                text-align: center;
            }
            .loading {
                font-size: 18px;
                margin-top: 50px;
            }
        </style>
    </head>
    <body>
        <div class="loading">${message}</div>
    </body>
    </html>
  `;
}

function generateWebviewContent(unusedImports: UnusedImport[]): string {
  const importsList = unusedImports.map((item, index) => `
    <div class="import-item">
      <input type="checkbox" id="import-${index}" checked>
      <label for="import-${index}">
        <strong>${path.basename(item.filePath)}</strong> (Line ${item.lineNumber})<br>
        <code>${item.importStatement}</code><br>
        <small>Unused symbols: ${item.importedSymbols.join(', ')}</small>
      </label>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                padding: 20px;
                background: #1e1e1e;
                color: #d4d4d4;
            }
            .header {
                text-align: center;
                margin-bottom: 20px;
                color: #569cd6;
            }
            .import-item {
                margin: 10px 0;
                padding: 10px;
                border: 1px solid #3c3c3c;
                border-radius: 5px;
                background: #252526;
            }
            .import-item code {
                background: #1e1e1e;
                padding: 2px 4px;
                border-radius: 3px;
                color: #ce9178;
            }
            .buttons {
                text-align: center;
                margin-top: 20px;
            }
            button {
                background: #0e639c;
                color: white;
                border: none;
                padding: 10px 20px;
                margin: 0 10px;
                border-radius: 5px;
                cursor: pointer;
            }
            button:hover {
                background: #1177bb;
            }
            .danger {
                background: #d73a49;
            }
            .danger:hover {
                background: #e53e3e;
            }
        </style>
    </head>
    <body>
        <h2 class="header">🧹 Unused Imports Found (${unusedImports.length})</h2>
        <div id="imports-list">
            ${importsList}
        </div>
        <div class="buttons">
            <button onclick="removeSelected()">Remove Selected</button>
            <button onclick="removeAll()" class="danger">Remove All</button>
        </div>
        
        <script>
            const vscode = acquireVsCodeApi();
            
            function removeSelected() {
                const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
                const selectedImports = Array.from(checkboxes).map((cb, index) => {
                    return ${JSON.stringify(unusedImports)}[parseInt(cb.id.split('-')[1])];
                });
                
                vscode.postMessage({
                    command: 'removeSelectedImports',
                    selectedImports: selectedImports
                });
            }
            
            function removeAll() {
                vscode.postMessage({
                    command: 'removeAllImports'
                });
            }
        </script>
    </body>
    </html>
  `;
}