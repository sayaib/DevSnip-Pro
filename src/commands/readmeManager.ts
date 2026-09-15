import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";

export function registerReadmeManagerCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand("sayaib.hue-console.readmeManager", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("Please open a workspace folder to manage README files.");
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const readmePath = path.join(rootPath, "README.md");

    try {
      await fs.access(readmePath);
    } catch {
      await createDefaultReadme(readmePath);
    }

    const uri = vscode.Uri.file(readmePath);
    
    // 1. Open README.md in the editor on the left (ViewColumn.One)
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });

    // 2. Open rendered Webview preview in the right column (ViewColumn.Two) (GitHub style)
    const panel = vscode.window.createWebviewPanel(
      "readmePreview",
      "README Preview (GitHub Style)",
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.iconPath = vscode.Uri.file(path.resolve(context.extensionPath, "logo.png"));

    const updatePreview = async () => {
      try {
        const content = await fs.readFile(readmePath, "utf8");
        panel.webview.html = getGithubStyleHtml(content, "README.md");
      } catch (err) {
        panel.webview.html = getGithubStyleHtml("# Error loading README", "README.md");
      }
    };

    await updatePreview();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.fsPath === uri.fsPath) {
        panel.webview.postMessage({ command: "update", markdown: e.document.getText() });
      }
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
    }, null, context.subscriptions);

    context.subscriptions.push(panel);
  });

  context.subscriptions.push(command);
}

async function createDefaultReadme(filePath: string): Promise<void> {
  const template = `# Project Title

### Description
A brief description of your project and what it does.

## Features
- Feature 1
- Feature 2
- Feature 3

## Installation
\`\`\`bash
npm install
\`\`\`

## Usage
\`\`\`bash
npm start
\`\`\`

## License
MIT License
`;
  await fs.writeFile(filePath, template, "utf8");
}

function getGithubStyleHtml(markdown: string, title: string): string {
  const jsonMarkdown = JSON.stringify(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src https: data: http:;">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      background: #0d1117;
      color: #e6edf3;
      padding: 32px;
      margin: 0;
    }
    .markdown-body {
      max-width: 900px;
      margin: 0 auto;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #21262d;
      padding-bottom: 12px;
      margin-bottom: 24px;
      font-size: 11px;
      font-weight: 700;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .badge {
      background: #238636;
      color: #ffffff;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 10px;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: #58a6ff;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #21262d; padding-bottom: .3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #21262d; padding-bottom: .3em; }
    h3 { font-size: 1.25em; }
    p { margin-top: 0; margin-bottom: 16px; }
    a { color: #2f81f7; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      padding: 0.2em 0.4em;
      margin: 0;
      font-size: 85%;
      background-color: rgba(110,118,129,0.4);
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    }
    pre {
      padding: 16px;
      overflow: auto;
      font-size: 85% !important;
      line-height: 1.45;
      background-color: #0d1117;
      border-radius: 6px;
      border: 1px solid #30363d;
      margin-top: 0;
      margin-bottom: 16px;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      margin: 0;
      border: 0;
      word-break: normal;
      white-space: pre;
      color: #e6edf3;
    }
    ul, ol {
      padding-left: 2em;
      margin-top: 0;
      margin-bottom: 16px;
    }
    li {
      margin-top: 0.25em;
    }
    blockquote {
      padding: 0 1em;
      color: #8b949e;
      border-left: 0.25em solid #30363d;
      margin: 0 0 16px 0;
    }
    hr {
      height: 0.25em;
      padding: 0;
      margin: 24px 0;
      background-color: #30363d;
      border: 0;
    }
    table {
      border-spacing: 0;
      border-collapse: collapse;
      margin-top: 0;
      margin-bottom: 16px;
      width: 100%;
      overflow: auto;
    }
    table th, table td {
      padding: 6px 13px;
      border: 1px solid #30363d;
    }
    table tr {
      background-color: #161b22;
      border-top: 1px solid #21262d;
    }
    table tr:nth-child(2n) {
      background-color: #0d1117;
    }
    img {
      max-width: 100%;
      box-sizing: content-box;
    }
    div[align="center"] {
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="markdown-body">
    <div class="preview-header">
      <span>GitHub Style Preview &bull; ${title}</span>
      <span class="badge">Live Sync</span>
    </div>
    <div id="content"></div>
  </div>
  <script>
    marked.setOptions({
      gfm: true,
      breaks: true
    });
    
    const initialMarkdown = ${jsonMarkdown};
    document.getElementById('content').innerHTML = marked.parse(initialMarkdown);

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'update') {
        document.getElementById('content').innerHTML = marked.parse(message.markdown);
      }
    });
  </script>
</body>
</html>`;
}
