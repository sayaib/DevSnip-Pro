interface SnippetDefinition {
  prefix: string;
  description: string;
  body: string[];
  scope?: string;
}

export class SnippetGenerator {
  static createSnippet(
    code: string,
    prefix: string,
    description: string,
    scope?: string
  ): SnippetDefinition {
    // Split code into lines and handle indentation
    const lines = code.split("\n").map((line) => line.replace(/\t/g, "    "));

    // Remove empty lines from start and end
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === "")
      lines.pop();

    // Create the snippet definition
    const snippet: SnippetDefinition = {
      prefix,
      description,
      body: lines,
    };

    if (scope) {
      snippet.scope = scope;
    }

    return snippet;
  }

  static saveSnippet(snippetName: string, snippet: SnippetDefinition): string {
    // Convert to VS Code snippet format
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
