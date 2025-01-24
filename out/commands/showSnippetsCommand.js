"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerShowSnippetsCommand = void 0;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
function registerShowSnippetsCommand(context, snippetsFolderPath) {
    const loadSnippets = () => fs
        .readdirSync(snippetsFolderPath)
        .filter((file) => file.endsWith(".json"))
        .map((file) => {
        const language = file.replace("custom_", "").replace(".json", "");
        const content = JSON.parse(fs.readFileSync(path.join(snippetsFolderPath, file), "utf-8"));
        return { language, snippets: content };
    });
    const command = vscode.commands.registerCommand("sayaib.hue-console.showSnippets", () => {
        const snippetsData = loadSnippets();
        const panel = vscode.window.createWebviewPanel("showSnippets", "Custom Snippets", vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = generateWebviewContent(snippetsData);
        panel.webview.onDidReceiveMessage((message) => {
            if (message.command === "deleteSnippet") {
                const { language, snippetKey } = message;
                const snippetFile = snippetsData.find((data) => data.language === language);
                if (snippetFile && snippetFile.snippets[snippetKey]) {
                    delete snippetFile.snippets[snippetKey];
                    fs.writeFileSync(path.join(snippetsFolderPath, `custom_${language}.json`), JSON.stringify(snippetFile.snippets, null, 4));
                    vscode.window.showInformationMessage(`Deleted snippet: ${snippetKey}`);
                    panel.webview.html = generateWebviewContent(snippetsData);
                }
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(command);
}
exports.registerShowSnippetsCommand = registerShowSnippetsCommand;
function generateWebviewContent(snippetsData) {
    const nonEmptyGroups = snippetsData.filter((file) => Object.keys(file.snippets).length > 0);
    if (nonEmptyGroups.length === 0) {
        return `
      <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>How to Create and Use Custom Snippets with DevSnip Pro</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 0;
            background-color: #101D26;
        }
        .container {
            max-width: 800px;
            margin: 20px auto;
            padding: 20px;
            background-color: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 8px;
        }
          h2 {
                  margin-top: 50px;
                  font-size: 2rem;
                  color: #FFFFFF;
                  text-align: center;
              }
        h1 {
            color: #333;
            font-size: 24px;
            margin-bottom: 20px;
        }
        ol {
            margin: 10px 0;
            padding-left: 20px;
        }
        li {
          color: black;
            margin-bottom: 10px;
        }
        strong {
            color: #0073e6;
        }
             td{
            color:black;
            }
            th{
            color:black;
            }
            a {
             color: #0073e6;
            }
    </style>
</head>
<body>
    <h2>No Custom Snippets Found.</h1>
    <div class="container">
        <h1>How to Create and Use Custom Snippets with DevSnip Pro</h1>
        <ol>
            <li><strong>Select Your Code:</strong> Highlight the code snippet you want to save in the VS Code editor.</li>
            <li><strong>Right-Click on the Editor:</strong> Open the context menu by right-clicking on the selected code.</li>
            <li><strong>Choose "🚀 DevSnip Pro: Create Your Own Perfect Code Snippet":</strong> Select this option from the context menu.</li>
            <li><strong>Enter Snippet Details:</strong> Provide the following information:
                <ul>
                    <li><strong>Snippet Prefix:</strong> A unique identifier for your snippet.</li>
                    <li><strong>Snippet Name:</strong> A descriptive name for the snippet.</li>
                    <li><strong>Snippet Description (optional):</strong> Add a brief explanation of the snippet.</li>
                </ul>
            </li>
            <li><strong>Call Your Snippets:</strong> Use the given prefix name to quickly insert your saved snippet in the editor.</li>
        </ol>

        <h1>Use Preloaded Snippets</h1>
        <table border="1" cellpadding="10" cellspacing="0" style="width: 100%; text-align: center;">
  <tr>
    <th>Language</th>
    <th>Link</th>
  </tr>
  <tr>
    <td>✅ HTML</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/html">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ Javascript</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/javascript">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ TypeScript</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/typescript">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ React</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/react">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ React Router</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/react-router">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ React Redux</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/react-redux">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ React Query</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/react-query">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ Python</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/python">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ PHP</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/php">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ Flutter</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/flutter">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ Node.js</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/nodejs">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ ES6</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/ES6">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ MongoDB</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/mongodb">Click Here</a></td>
  </tr>
  <tr>
    <td>✅ Mongo Aggregation</td>
    <td><a href="https://sayaibsarkar.net/#/dev-snip-pro/document/en/code-snippets/mongo-aggregation">Click Here</a></td>
  </tr>
</table>

    </div>
</body>
</html>

    `;
    }
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
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
        <h1>Custom Snippets in <span style="color:#48FFF1;">DevSnip Pro</span></h1>
        <input
            id="searchInput"
            type="text"
            placeholder="Search across all the snippet fields in the table."
            oninput="filterTable()"
        />
        ${nonEmptyGroups
        .map((group) => `
            <h3>${group.language}</h3>
            <table id="snippetsTable">
                <thead>
                    <tr>
                        <th>Prefix</th>
                        <th>Snippet Key</th>
                        <th>Description</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(group.snippets)
        .map(([key, snippet]) => `
                        <tr>
                        
                            <td>${snippet.prefix}</td>
                            <td>${key}</td>
                            <td>${snippet.description || ""}</td>
                            <td>
                                <button onclick="deleteSnippet('${group.language}', '${key}')">
                                    Delete
                                </button>
                            </td>
                        </tr>`)
        .join("")}
                </tbody>
            </table>
          `)
        .join("")}
        <script>
            const vscode = acquireVsCodeApi();

            function filterTable() {
                const searchInput = document.getElementById("searchInput").value.trim();
                const rows = document.querySelectorAll("#snippetsTable tbody tr");
                const regex = new RegExp(searchInput, "i");

                rows.forEach((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    const matches = cells.some((cell) => regex.test(cell.textContent));
                    row.style.display = matches ? "" : "none";
                });
            }

            function deleteSnippet(language, snippetKey) {
                vscode.postMessage({ command: 'deleteSnippet', language, snippetKey });
            }
        </script>
    </body>
    </html>
  `;
}
//# sourceMappingURL=showSnippetsCommand.js.map