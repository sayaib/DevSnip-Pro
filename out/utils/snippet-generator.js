"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnippetGenerator = void 0;
class SnippetGenerator {
    static createSnippet(code, prefix, description, scope) {
        const lines = code.split("\n").map((line) => line.replace(/\t/g, "    "));
        while (lines.length > 0 && lines[0].trim() === "")
            lines.shift();
        while (lines.length > 0 && lines[lines.length - 1].trim() === "")
            lines.pop();
        const snippet = {
            prefix,
            description,
            body: lines,
        };
        if (scope) {
            snippet.scope = scope;
        }
        return snippet;
    }
    static saveSnippet(snippetName, snippet) {
        const vsCodeSnippet = {
            [snippetName]: {
                prefix: snippet.prefix,
                body: snippet.body,
                description: snippet.description,
                scope: snippet.scope,
            },
        };
        return JSON.stringify(vsCodeSnippet, null, 2);
    }
}
exports.SnippetGenerator = SnippetGenerator;
//# sourceMappingURL=snippet-generator.js.map