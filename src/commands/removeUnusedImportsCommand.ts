import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

interface UnusedImport {
  filePath: string;
  lineNumber: number;
  importStatement: string;
  importedSymbols: string[];
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
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
  
  lines.forEach((line, index) => {
    if (!/^\s*import\s+/.test(line) || !/\sfrom\s*['"]/.test(line)) return;
    const importedSymbols = extractImportedSymbols(line);
    const unusedSymbols = importedSymbols.filter(symbol =>
      !isSymbolUsed(symbol, content, line)
    );

    if (unusedSymbols.length === importedSymbols.length && unusedSymbols.length > 0) {
      unusedImports.push({
        filePath,
        lineNumber: index + 1,
        importStatement: line.trim(),
        importedSymbols: unusedSymbols
      });
    }
  });

  return unusedImports;
}

function extractImportedSymbols(importLine: string): string[] {
  const clause = importLine
    .replace(/^\s*import\s+/, '')
    .replace(/\sfrom\s*['"][^'"]+['"];?\s*$/, '')
    .trim();
  const symbols: string[] = [];

  const addNamed = (named: string) => {
    named.split(',').forEach(part => {
      const symbol = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(symbol)) symbols.push(symbol);
    });
  };

  if (clause.startsWith('{')) {
    addNamed(clause.slice(1, clause.lastIndexOf('}')));
  } else if (clause.startsWith('*')) {
    const namespace = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (namespace) symbols.push(namespace[1]);
  } else {
    const comma = clause.indexOf(',');
    const defaultImport = (comma === -1 ? clause : clause.slice(0, comma)).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(defaultImport)) symbols.push(defaultImport);
    if (comma !== -1) {
      const remainder = clause.slice(comma + 1).trim();
      if (remainder.startsWith('{')) addNamed(remainder.slice(1, remainder.lastIndexOf('}')));
      else if (remainder.startsWith('*')) {
        const namespace = remainder.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
        if (namespace) symbols.push(namespace[1]);
      }
    }
  }

  return Array.from(new Set(symbols));
}

function isSymbolUsed(symbol: string, content: string, importLine: string): boolean {
  // Remove the import line from content to avoid false positives
  const contentWithoutImport = content.replace(importLine, '');
  
  // Check various usage patterns
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const usagePatterns = [
    new RegExp(`\\b${escaped}\\b`, 'g'),
    new RegExp(`${escaped}\\.`, 'g'),
    new RegExp(`<${escaped}[\\s>]`, 'g'),
    new RegExp(`<${escaped}/`, 'g'),
    new RegExp(`typeof\\s+${escaped}\\b`, 'g'),
    new RegExp(`instanceof\\s+${escaped}\\b`, 'g')
  ];
  
  return usagePatterns.some(pattern => pattern.test(contentWithoutImport));
}

async function removeSelectedImports(
  selectedImports: UnusedImport[],
  panel: vscode.WebviewPanel
) {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const modifiedFiles = new Set<string>();

  // Sort by line number descending so removing higher lines first doesn't shift lower line numbers
  const sorted = [...selectedImports].sort((a, b) => b.lineNumber - a.lineNumber);

  for (const importItem of sorted) {
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
  const nonce = getNonce();
  const importsList = unusedImports.map((item, index) => `
    <div class="import-item">
      <input type="checkbox" id="import-${index}" checked>
      <label for="import-${index}">
        <strong>${path.basename(item.filePath)}</strong> (Line ${item.lineNumber})<br>
        <code>${item.importStatement.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code><br>
        <small>Unused symbols: ${item.importedSymbols.map(s => s.replace(/</g, '&lt;').replace(/>/g, '&gt;')).join(', ')}</small>
      </label>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
        <h2 class="header">Unused Imports Found (${unusedImports.length})</h2>
        <div id="imports-list">
            ${importsList}
        </div>
        <div class="buttons">
            <button id="removeSelectedBtn">Remove Selected</button>
            <button id="removeAllBtn" class="danger">Remove All</button>
        </div>
        
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let unusedImportsData = ${JSON.stringify(unusedImports).replace(/</g, '\\u003c')};
            
            document.getElementById('removeSelectedBtn').addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
                const selectedImports = Array.from(checkboxes).map((cb) => {
                    const index = parseInt(cb.id.split('-')[1]);
                    return unusedImportsData[index];
                }).filter(Boolean);
                
                vscode.postMessage({
                    command: 'removeSelectedImports',
                    selectedImports: selectedImports
                });
            });
            
            document.getElementById('removeAllBtn').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'removeAllImports'
                });
            });
        </script>
    </body>
    </html>
  `;
}
