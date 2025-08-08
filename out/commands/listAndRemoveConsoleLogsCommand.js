"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerListAndRemoveConsoleLogsCommand = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
function registerListAndRemoveConsoleLogsCommand(context) {
    const command = vscode.commands.registerCommand("sayaib.hue-console.listAndRemoveConsoleLogs", async () => {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage("No workspace is open.");
            return;
        }
        const panel = vscode.window.createWebviewPanel("listConsoleLogs", "List Console Logs", vscode.ViewColumn.One, { enableScripts: true });
        const iconPath = path.resolve(context.extensionPath, "logo.png");
        panel.iconPath = vscode.Uri.file(iconPath);
        panel.webview.html = generateWebviewContentConsoleLoading("Searching for console logs. Please wait...");
        const allConsoleLogs = [];
        const searchPattern = "**/*.{ts,tsx,js,jsx,php,html}";
        const excludePattern = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/temp/**,**/.next/**}";
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], searchPattern), excludePattern);
        const batchSize = 20;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            await Promise.all(batch.map(async (file) => {
                try {
                    const content = await fs.readFile(file.fsPath, "utf8");
                    const regex = /console\.(log|warn|error|info|debug)\s*\(\s*([\s\S]*?)\s*\);?/g;
                    let match;
                    while ((match = regex.exec(content)) !== null) {
                        const beforeMatch = content.substring(0, match.index);
                        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
                        allConsoleLogs.push({
                            filePath: file.fsPath,
                            lineNumber: lineNumber,
                            text: match[0],
                        });
                    }
                }
                catch (error) {
                    vscode.window.showErrorMessage(`Error reading file ${file.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }));
        }
        if (allConsoleLogs.length === 0) {
            panel.webview.html = generateWebviewContentConsoleLoading("No `console.log` statements found.");
            vscode.window.showInformationMessage("No console.log statements found.");
            return;
        }
        panel.webview.html = generateWebviewContentConsole(allConsoleLogs);
        panel.webview.onDidReceiveMessage(async (message) => {
            console.log(message);
            if (message.command === "removeSelectedLogs") {
                await removeSelectedLogs(message.selectedLogs, panel);
            }
            else if (message.command === "removeAllLogs") {
                await removeSelectedLogs(allConsoleLogs, panel);
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(command);
}
exports.registerListAndRemoveConsoleLogsCommand = registerListAndRemoveConsoleLogsCommand;
async function removeSelectedLogs(selectedLogs, panel) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const modifiedFiles = new Set();
    for (const log of selectedLogs) {
        try {
            const uri = vscode.Uri.file(log.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const line = document.lineAt(log.lineNumber - 1);
            workspaceEdit.delete(uri, line.range);
            modifiedFiles.add(log.filePath);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error processing log in file ${log.filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    await vscode.workspace.applyEdit(workspaceEdit);
    for (const filePath of modifiedFiles) {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        await document.save();
    }
    vscode.window.showInformationMessage(`Removed ${selectedLogs.length} console.log statements.`);
    const updatedConsoleLogs = await fetchConsoleLogs();
    panel.webview.html = generateWebviewContentConsole(updatedConsoleLogs);
}
async function fetchConsoleLogs() {
    const allConsoleLogs = [];
    if (!vscode.workspace.workspaceFolders) {
        return allConsoleLogs;
    }
    const searchPattern = "**/*.{ts,tsx,js,jsx,php,html}";
    const excludePattern = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/temp/**,**/.next/**}";
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], searchPattern), excludePattern);
    const batchSize = 20;
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(batch.map(async (file) => {
            try {
                const content = await fs.readFile(file.fsPath, "utf8");
                const regex = /console\.(log|warn|error|info|debug)\s*\(\s*([\s\S]*?)\s*\);?/g;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    const beforeMatch = content.substring(0, match.index);
                    const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
                    allConsoleLogs.push({
                        filePath: file.fsPath,
                        lineNumber: lineNumber,
                        text: match[0],
                    });
                }
            }
            catch (error) {
                vscode.window.showErrorMessage(`Error reading file ${file.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }));
    }
    return allConsoleLogs;
}
function generateWebviewContentConsoleLoading(message) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Log Viewer</title>
    <style>
    @import url("https://fonts.googleapis.com/css?family=Raleway:400,400i,700");

* {
  padding: 0;
  margin: 0 auto;
  font-family: Raleway, sans-serif;
  color: white;
}

html {
  cursor: none;
  width: 100%;
  height: 100%;
}

body {
  background-color: #0C1118;
}

.container {
  display: flex;
  justify-content: center;
  align-items: center;
}

.coding-ide-ui {
  margin-top: 30vh;
  background-color: #303030;
  width: 50%;
  height: 250px;
  border-top-right-radius: 10px;
  border-top-left-radius: 10px;
  border-bottom-right-radius: 6px;
  border-bottom-left-radius: 6px;
  user-select: none;
}

.top-coding-ide-ui {
  background-color: #202020;
  width: 100%;
  height: 30px;
  border-top-right-radius: 10px;
  border-top-left-radius: 10px;
}

.top-coding-ide-ui span {
  display: flex;
  background-color: red;
  border-radius: 50%;
  width: 15px;
  height: 15px;
  content: "X";
  margin: 5px;
  margin-top: 8px;
  float: right;
}

.coding-ide-ui-lines span {
  background: rgba(189, 195, 199, 0.2);
  width: 30%;
  height: 15px;
  float: left;
  margin-left: 8px;
  margin-top: 8px;
  border-radius: 15px;
  animation: test 3s infinite ease;
}
h3{
margin-top:10px;
  font-size:0.9rem;
  text-align:center;
  color:#758694;
 
}
main h2 {
 
  display: flex;
  justify-content: center;
}

@keyframes load {
  0% {
    width: 0%;
    opacity: 0%;
    transform: translateX(-20px);
  }
  50% {
    transform: translateX(0px);
  }
  100% {
    width 100%;
    opacity: 100%;
  }
}


    </style>
</head>
<body>
  <div id="loader">
  <div class="container">
    <div class="coding-ide-ui">
      <div class="top-coding-ide-ui">
        <span style="background: red;"></span>
        <span style="background: orange;"></span>
        <span style="background: green;"></span>
      </div>
      <div class="coding-ide-ui-lines">
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <h3>${message}</h3>
          <br>
      </div>
    </div>
  </div>
  <br>
 
</div>




    <script>
  //Loader
const loader = document.querySelector("#loader");


window.onload = () => {
  loader.style.display = "block";
};

// No need for showMain function as this is just a loading screen
// that will be replaced with the actual content

//Random "Lines of Code" Width
var spans = document.getElementsByTagName("span");
var l = spans.length;
for (var i = 0; i < l; i++) {
  var spanClass = spans[i].getAttribute("class");
  if (spanClass === "coding-ide-ui-line") {
    var randomW = Math.floor(Math.random() * 50) + 15;
    spans[i].style.width = randomW + "%";
    spans[i].style.animation = "load 3.5s infinite ease-in-out";
    // No need for setTimeout as this is just a loading screen
    // that will be replaced with the actual content
  }
}

    </script>
</body>
</html>

  `;
}
function generateWebviewContentConsole(consoleLogs) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Log Viewer</title>
    <style>
        /* General Styles */
        body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            background-color: #0C1118;
            color: #FFFFFF;
            text-align: center;
        }

        h1 {
            margin-top: 30px;
            font-size: 2rem;
            color: #FFFFFF;
            font-weight: 600;
        }

        h1 span {
            color: #19C8D9;
        }

        /* Search Input */
        #searchInput {
            margin: 20px auto;
            width: 80%;
            max-width: 600px;
            padding: 12px;
            border-radius: 8px;
            border: 2px solid #273341;
            background-color: #1C2630;
            color: #FFFFFF;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.3s;
        }

        #searchInput:focus {
            border-color: #19C8D9;
        }

        /* Table Styles */
        table {
            width: 95%;
            max-width: 1200px;
            margin: 30px auto;
            border-collapse: collapse;
            background-color: #1C2630;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }

        thead {
            background-color: #273341;
        }

        th, td {
            padding: 15px;
            text-align: center;
            border-bottom: 1px solid #303A45;
        }

        th {
            font-weight: 600;
            color: #19C8D9;
        }

        tbody tr:hover {
            background-color: #303A45;
            transition: background-color 0.3s;
        }

        tbody tr:last-child td {
            border-bottom: none;
        }

        /* Button Styles */
        button {
            background-color: #A61E1E;
            color: white;
            font-weight: bold;
            padding: 10px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background-color 0.3s;
        }

        button:hover {
            background-color: #8A1A1A;
        }

        .remove-log-btn {
            background-color: #273341;
            color: #FFFFFF;
            padding: 8px 15px;
            border-radius: 5px;
            border: 1px solid #19C8D9;
            transition: background-color 0.3s;
        }

        .remove-log-btn:hover {
            background-color: #19C8D9;
            color: #0C1118;
        }




        /* Container for Actions */
        .actions {
            margin-top: 20px;
            margin-bottom: 40px;
        }
    </style>
</head>
<body>
    <h1>Active <span>Console Log Statements</span> in the Project</h1>
    <input type="text" id="searchInput" placeholder="Search logs..." oninput="filterTable()"/>

    <div class="container">
        <table id="consoleTable">
            <thead>
                <tr>
                    <th>Sr. No.</th>
                    <th>Action</th>
                    <th>File Path</th>
                    <th>Line Number</th>
                    <th>Log Text</th>
                </tr>
            </thead>
            <tbody>
                ${consoleLogs
        .map((log, key) => `
                        <tr>
                            <td>${key + 1}</td>
                            <td><button class="remove-log-btn" data-log='${JSON.stringify(log)}'>Remove</button></td>
                            <td>${log.filePath}</td>
                            <td>${log.lineNumber}</td>
                            <td><pre>${log.text}</pre></td>
                        </tr>`)
        .join("")}
            </tbody>
        </table>

        <div class="actions">
            <button type="button" onclick="removeAllLogs()">Remove All Logs</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function filterTable() {
            const searchInput = document.getElementById("searchInput").value.trim();
            const rows = document.querySelectorAll("#consoleTable tbody tr");
            const regex = new RegExp(searchInput, "i");

            rows.forEach((row) => {
                const cells = Array.from(row.querySelectorAll("td"));
                const matches = cells.some((cell) => regex.test(cell.textContent));
                row.style.display = matches ? "" : "none";
            });
        }

        document.querySelectorAll('.remove-log-btn').forEach(button => {
            button.addEventListener('click', function() {
                const log = JSON.parse(this.getAttribute('data-log'));
                const selectedLogs = [{
                    lineNumber: log.lineNumber,
                    text: log.text,
                    filePath: log.filePath
                }];
                vscode.postMessage({ command: "removeSelectedLogs", selectedLogs });
            });
        });

        function removeAllLogs() {
            vscode.postMessage({ command: "removeAllLogs" });
        }
    </script>
</body>
</html>

  `;
}
//# sourceMappingURL=listAndRemoveConsoleLogsCommand.js.map