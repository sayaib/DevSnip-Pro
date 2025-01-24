import * as vscode from "vscode";

interface ConsoleLog {
  filePath: string;
  lineNumber: number;
  text: string;
}

export function registerListAndRemoveConsoleLogsCommand(
  context: vscode.ExtensionContext
) {
  const command = vscode.commands.registerCommand(
    "sayaib.hue-console.listAndRemoveConsoleLogs",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace is open.");
        return;
      }

      const allConsoleLogs: ConsoleLog[] = [];
      const panel = vscode.window.createWebviewPanel(
        "listConsoleLogs",
        "List Console Logs",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = generateWebviewContentConsoleLoading(
        "Analyzing your project to retrieve all console logs. Please wait..."
      );

      for (const folder of workspaceFolders) {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, "**/*.{ts,tsx,js,jsx}"),
          "**/node_modules/**"
        );

        for (const file of files) {
          const document = await vscode.workspace.openTextDocument(file);
          const text = document.getText();
          const regex = /console\.log\(([\s\S]*?)\);/g;

          let match;

          while ((match = regex.exec(text)) !== null) {
            const lineNumber = document.positionAt(match.index).line;
            allConsoleLogs.push({
              filePath: file.fsPath,
              lineNumber,
              text: match[0],
            });
          }
        }
      }

      if (allConsoleLogs.length === 0) {
        panel.webview.html = generateWebviewContentConsoleLoading(
          "Great job! No `console.log` statements were found in your project. You've successfully optimized your project's performance!"
        );
        vscode.window.showInformationMessage(
          "No console.log statements found."
        );
        return;
      }

      panel.webview.html = generateWebviewContentConsole(allConsoleLogs);

      panel.webview.onDidReceiveMessage(
        async (message) => {
          console.log(message);
          if (message.command === "removeSelectedLogs") {
            await removeSelectedLogs(message.selectedLogs);
          } else if (message.command === "removeAllLogs") {
            console.log(allConsoleLogs);
            await removeSelectedLogs(allConsoleLogs);
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(command);
}

async function removeSelectedLogs(selectedLogs: ConsoleLog[]) {
  for (const log of selectedLogs) {
    try {
      const document = await vscode.workspace.openTextDocument(log.filePath);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });

      // Fetch the line text and range
      const actualLineText = document.lineAt(log.lineNumber).text;
      const actualLineRange = document.lineAt(log.lineNumber).range;

      console.log(`Processing file: ${log.filePath}`);
      console.log(`Expected log text: "${log.text.trim()}"`);
      console.log(`Actual line text: "${actualLineText.trim()}"`);

      // Match the expected text with the actual line text
      if (actualLineText.includes(log.text.trim())) {
        await editor.edit((editBuilder) => {
          editBuilder.delete(actualLineRange);
        });
        console.log(`Removed log at line ${log.lineNumber + 1}`);
      } else {
        console.log(`No match for log at line ${log.lineNumber + 1}`);
      }
    } catch (error) {
      console.error(`Error processing log in file ${log.filePath}:`, error);
    }
  }

  vscode.window.showInformationMessage(
    `Removed ${selectedLogs.length} console.log statements.`
  );
}
function generateWebviewContentConsoleLoading(message: string): string {
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
  mainContent.style.display = "none";
};

const showMain = () => {
 
};

//Random "Lines of Code" Width
var spans = document.getElementsByTagName("span");
var l = spans.length;
for (var i = 0; i < l; i++) {
  var spanClass = spans[i].getAttribute("class");
  if (spanClass === "coding-ide-ui-line") {
    var randomW = Math.floor(Math.random() * 50) + 15;
    spans[i].style.width = randomW + "%";
    spans[i].style.animation = "load 3.5s infinite ease-in-out";
    var waitTime = Math.floor(Math.random() * 10) + 5;
    setTimeout(() => {
      showMain();
    }, waitTime * 1000);
  }
}

    </script>
</body>
</html>

  `;
}

function generateWebviewContentConsole(consoleLogs: ConsoleLog[]): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Log Viewer</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            background-color: #0C1118;
            color: #FFFFFF;
            text-align: center;
        }
        h1 {
            margin-top: 30px;
            font-size: 2rem;
            color: #FFFFFF;
        }
        h1 span {
            color: #19C8D9;
        }
        #searchInput {
            margin: 20px auto;
            width: 80%;
            padding: 10px;
            border-radius: 5px;
            border: none;
            font-size: 1rem;
            color: #0C1118;
        }
        table {
            width: 90%;
            margin: 30px auto;
            border-collapse: collapse;
            background-color: #1C2630;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
        }
        thead {
            background-color: #273341;
            font-weight: bold;
        }
        th, td {
            padding: 15px;
            text-align: center;
            border-bottom: 1px solid #2F3D4A;
        }
        tbody tr:hover {
            background-color: #303A45;
        }
        button {
            background-color: #D62828;
            color: white;
            font-weight: bold;
            padding: 8px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: background-color 0.3s;
        }
        button:hover {
            background-color: #A61E1E;
        }
        tbody tr:last-child td {
            border-bottom: none;
        }
    </style>
</head>
<body>
    <h1>Console Log Viewer <span>Dashboard</span></h1>
    <input type="text" id="searchInput" placeholder="Search logs..." oninput="filterTable()"/>

    <div class="container">
        <table id="consoleTable">
          <thead>
              <tr>
                  <th>Select</th>
                  <th>File Path</th>
                  <th>Line Number</th>
                  <th>Log Text</th>
              </tr>
          </thead>
          <tbody>
              ${consoleLogs
                .map(
                  (log) => `
              <tr>
                  <td><input type="checkbox" name="log" value="${
                    log.lineNumber
                  }" data-log='${JSON.stringify(log)}' /></td>
                  <td>${log.filePath}</td>
                  <td>${log.lineNumber + 1}</td>
                  <td>${log.text}</td>
              </tr>`
                )
                .join("")}
          </tbody>
      </table>

      <div class="actions">
          <button type="button" onclick="removeSelectedLogs()">Remove Selected Logs</button>
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
      function removeSelectedLogs() {
          const selectedCheckboxes = document.querySelectorAll('input[name="log"]:checked');
          const selectedLogs = Array.from(selectedCheckboxes).map(cb => {
              return JSON.parse(cb.getAttribute("data-log"));
          });
          
          vscode.postMessage({ command: "removeSelectedLogs", selectedLogs });
      }

      function removeAllLogs() {
          vscode.postMessage({ command: "removeAllLogs" });
      }
    </script>
</body>
</html>

  `;
}
