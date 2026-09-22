import * as vscode from "vscode";
import * as path from "path";
import { registerTrackedCommand } from "../utils/command-registry";
import { renderMarkdown } from "../utils/markdown";
import { THEME_TOKENS, confirmAction, escapeHtml, getNonce, safePostMessage } from "../utils/webview-ui";

const README_TEMPLATE = `# Project Title

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

const SECTION_TEMPLATES: Record<string, string> = {
  Features: "\n## Features\n- Feature 1\n- Feature 2\n",
  Installation: "\n## Installation\n```bash\nnpm install\n```\n",
  Usage: "\n## Usage\n```bash\nnpm start\n```\n",
  Configuration: "\n## Configuration\n| Setting | Default | Description |\n| --- | --- | --- |\n| `example` | `true` | What it does |\n",
  Contributing: "\n## Contributing\nPull requests are welcome. Please open an issue first to discuss any large change.\n",
  License: "\n## License\nMIT License\n"
};

/** Finds the README files in the workspace, shallowest (usually the root) first. */
async function findReadmeFiles(): Promise<vscode.Uri[]> {
  const found = await vscode.workspace.findFiles(
    "**/{README,readme,Readme}.{md,markdown,MD}",
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**}",
    50
  );
  return found.sort((a, b) => a.fsPath.split(path.sep).length - b.fsPath.split(path.sep).length);
}

function documentStats(text: string): { words: number; characters: number } {
  const trimmed = text.trim();
  return { words: trimmed ? trimmed.split(/\s+/).length : 0, characters: text.length };
}

export function registerReadmeManagerCommand(context: vscode.ExtensionContext): void {
  let activePanel: vscode.WebviewPanel | undefined;

  const command = registerTrackedCommand("sayaib.hue-console.readmeManager", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("Open a workspace folder to manage README files.");
      return;
    }

    let target: vscode.Uri;
    const existing = await findReadmeFiles();
    if (existing.length === 0) {
      if (!(await confirmAction("No README was found in this workspace. Create one now?", "Create README.md", "information"))) return;
      target = vscode.Uri.joinPath(workspaceFolders[0].uri, "README.md");
      await vscode.workspace.fs.writeFile(target, Buffer.from(README_TEMPLATE, "utf8"));
    } else if (existing.length === 1) {
      target = existing[0];
    } else {
      const picked = await vscode.window.showQuickPick(
        existing.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })),
        { title: "Which README do you want to manage?" }
      );
      if (!picked) return;
      target = picked.uri;
    }

    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });

    // Only one preview at a time, so switching READMEs does not stack panels.
    activePanel?.dispose();

    const panel = vscode.window.createWebviewPanel(
      "readmePreview",
      `README Preview - ${path.basename(target.fsPath)}`,
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    activePanel = panel;
    panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, "logo.png"));

    const readCurrentText = async (): Promise<string> => {
      // Prefer the open document so unsaved edits appear in the preview.
      const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === target.toString());
      if (open) return open.getText();
      const bytes = await vscode.workspace.fs.readFile(target);
      return Buffer.from(bytes).toString("utf8");
    };

    const render = async (status?: { ok: boolean; message: string }) => {
      try {
        const text = await readCurrentText();
        safePostMessage(panel, { command: "update", html: renderMarkdown(text), ...documentStats(text), status });
      } catch (error) {
        safePostMessage(panel, {
          command: "update",
          html: "<p>Unable to read this README.</p>",
          words: 0,
          characters: 0,
          status: { ok: false, message: error instanceof Error ? error.message : String(error) }
        });
      }
    };

    panel.webview.html = getPreviewHtml(vscode.workspace.asRelativePath(target), Object.keys(SECTION_TEMPLATES));
    await render();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== target.toString()) return;
      const text = event.document.getText();
      safePostMessage(panel, { command: "update", html: renderMarkdown(text), ...documentStats(text) });
    });

    const messageSubscription = panel.webview.onDidReceiveMessage(async (message: { command?: string; section?: string }) => {
      try {
        switch (message?.command) {
          case "refresh":
            await render({ ok: true, message: "Preview refreshed." });
            break;

          case "edit": {
            const doc = await vscode.workspace.openTextDocument(target);
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
            break;
          }

          case "save": {
            const doc = vscode.workspace.textDocuments.find(item => item.uri.toString() === target.toString());
            if (!doc) {
              await render({ ok: false, message: "The README is not open in an editor." });
              break;
            }
            if (!doc.isDirty) {
              await render({ ok: true, message: "No unsaved changes." });
              break;
            }
            const saved = await doc.save();
            await render({ ok: saved, message: saved ? "README saved." : "VS Code could not save the README." });
            break;
          }

          case "addSection": {
            const template = message.section ? SECTION_TEMPLATES[message.section] : undefined;
            if (!template) {
              await render({ ok: false, message: "Unknown section template." });
              break;
            }
            const doc = await vscode.workspace.openTextDocument(target);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(target, doc.lineAt(doc.lineCount - 1).range.end, `\n${template}`);
            const applied = await vscode.workspace.applyEdit(edit);
            await render({
              ok: applied,
              message: applied
                ? `Added the ${message.section} section. Review it, then press Save.`
                : "VS Code could not insert the section."
            });
            break;
          }

          case "delete": {
            const confirmed = await confirmAction(
              `Delete ${vscode.workspace.asRelativePath(target)}? It is moved to the trash and can be restored from there.`,
              "Delete README"
            );
            if (!confirmed) break;
            await vscode.workspace.fs.delete(target, { useTrash: true });
            vscode.window.showInformationMessage("README deleted (moved to trash).");
            panel.dispose();
            break;
          }

          case "reset": {
            const confirmed = await confirmAction(
              "Replace the README contents with the starter template? The current contents will be overwritten.",
              "Replace contents"
            );
            if (!confirmed) break;
            await vscode.workspace.fs.writeFile(target, Buffer.from(README_TEMPLATE, "utf8"));
            await render({ ok: true, message: "README replaced with the starter template." });
            break;
          }
        }
      } catch (error) {
        await render({ ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
      messageSubscription.dispose();
      if (activePanel === panel) activePanel = undefined;
    });
  });

  context.subscriptions.push(command);
}

/**
 * Static shell. Markdown is rendered in the extension host by our own escaping
 * renderer and delivered through postMessage, so the page needs no remote
 * script and never evaluates README content as markup.
 */
function getPreviewHtml(relativePath: string, sections: string[]): string {
  const nonce = getNonce();
  const sectionOptions = sections.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
  <title>README Preview</title>
  <style>
    ${THEME_TOKENS}
    * { box-sizing: border-box; }
    body { font-family: var(--font); font-size: 14px; line-height: 1.6; background: var(--bg); color: var(--text); margin: 0; padding: clamp(14px, 3vw, 28px); word-wrap: break-word; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .toolbar .path { color: var(--muted); font-family: var(--mono); font-size: 12px; margin-right: auto; overflow-wrap: anywhere; }
    button, select { font-family: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel-2); color: var(--text); cursor: pointer; }
    button:hover, select:hover { border-color: var(--focus); }
    button:focus-visible, select:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    button.danger { color: var(--danger); }
    .status { display: none; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--line); margin-bottom: 14px; font-size: 12px; }
    .status.ok { display: block; border-color: var(--success); }
    .status.fail { display: block; border-color: var(--danger); }
    .meta { color: var(--muted); font-size: 11px; margin-bottom: 10px; }
    .markdown-body { max-width: 900px; margin: 0 auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: clamp(18px, 4vw, 36px); }
    .markdown-body h1, .markdown-body h2 { border-bottom: 1px solid var(--line); padding-bottom: .3em; margin-top: 24px; }
    .markdown-body h1:first-child { margin-top: 0; }
    .markdown-body h1 { font-size: 1.9em; } .markdown-body h2 { font-size: 1.45em; } .markdown-body h3 { font-size: 1.2em; }
    .markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table { margin: 0 0 16px; }
    .markdown-body ul, .markdown-body ol { padding-left: 2em; }
    .markdown-body li.task { list-style: none; margin-left: -1.4em; }
    .markdown-body code { background: var(--panel-2); padding: .2em .4em; border-radius: 4px; font-family: var(--mono); font-size: 85%; }
    .markdown-body pre { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 14px; overflow-x: auto; }
    .markdown-body pre code { background: transparent; padding: 0; font-size: 12px; }
    .markdown-body blockquote { border-left: 3px solid var(--line); padding: 0 1em; color: var(--muted); }
    .markdown-body a { color: var(--accent); }
    .markdown-body table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
    .markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid var(--line); }
    .markdown-body img { max-width: 100%; }
    .markdown-body hr { border: 0; border-top: 1px solid var(--line); }
    .empty { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="path">${escapeHtml(relativePath)}</span>
    <button id="btnEdit" type="button">Open in editor</button>
    <button id="btnSave" type="button">Save</button>
    <select id="sectionSelect" aria-label="Section to add"><option value="">Add section...</option>${sectionOptions}</select>
    <button id="btnAdd" type="button">Add</button>
    <button id="btnRefresh" type="button">Refresh</button>
    <button id="btnReset" class="danger" type="button">Reset to template</button>
    <button id="btnDelete" class="danger" type="button">Delete</button>
  </div>
  <div id="status" class="status" role="status"></div>
  <div id="meta" class="meta"></div>
  <div class="markdown-body"><div id="content" class="empty">Loading README...</div></div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const content = document.getElementById('content');
      const status = document.getElementById('status');
      const meta = document.getElementById('meta');

      function send(command, extra) { vscode.postMessage(Object.assign({ command: command }, extra || {})); }

      document.getElementById('btnEdit').addEventListener('click', function () { send('edit'); });
      document.getElementById('btnSave').addEventListener('click', function () { send('save'); });
      document.getElementById('btnRefresh').addEventListener('click', function () { send('refresh'); });
      document.getElementById('btnReset').addEventListener('click', function () { send('reset'); });
      document.getElementById('btnDelete').addEventListener('click', function () { send('delete'); });
      document.getElementById('btnAdd').addEventListener('click', function () {
        const select = document.getElementById('sectionSelect');
        if (!select.value) {
          status.className = 'status fail';
          status.textContent = 'Choose a section to add first.';
          return;
        }
        send('addSection', { section: select.value });
      });

      window.addEventListener('message', function (event) {
        const message = event.data;
        if (!message || message.command !== 'update') return;
        // This HTML comes from the extension's own renderer, which escapes the
        // whole source document before emitting any markup.
        content.innerHTML = message.html || '<p class="empty">This README is empty.</p>';
        content.classList.remove('empty');
        meta.textContent = message.words + ' words | ' + message.characters + ' characters';
        if (message.status) {
          status.className = 'status ' + (message.status.ok ? 'ok' : 'fail');
          status.textContent = message.status.message;
        }
      });
    })();
  </script>
</body>
</html>`;
}
