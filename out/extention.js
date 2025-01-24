"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const path = require("path");
const createSnippetCommand_1 = require("./commands/createSnippetCommand");
const showSnippetsCommand_1 = require("./commands/showSnippetsCommand");
const listAndRemoveConsoleLogsCommand_1 = require("./commands/listAndRemoveConsoleLogsCommand");
function activate(context) {
    const snippetsFolderPath = path.join(__dirname, "../custom");
    console.log("DevSnip Pro extension is now active!");
    (0, createSnippetCommand_1.registerCreateSnippetCommand)(context);
    (0, showSnippetsCommand_1.registerShowSnippetsCommand)(context, snippetsFolderPath);
    (0, listAndRemoveConsoleLogsCommand_1.registerListAndRemoveConsoleLogsCommand)(context);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extention.js.map