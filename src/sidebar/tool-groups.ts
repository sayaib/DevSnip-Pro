/**
 * The Tools sidebar's categories and tools.
 *
 * Icons are codicon ids and colours are VS Code theme colour ids, exactly as
 * the sidebar used when it was a native tree view, so the identity carries over.
 */

export interface SidebarTool {
  label: string;
  /** Full command id, e.g. sayaib.hue-console.openGUI. */
  command: string;
  /** Codicon id. */
  icon: string;
}

export interface SidebarGroup {
  name: string;
  /** Codicon id. */
  icon: string;
  /** Theme colour id used for the category icon, e.g. terminal.ansiBrightYellow. */
  color: string;
  tools: SidebarTool[];
}

const c = (id: string) => `sayaib.hue-console.${id}`;
const tool = (label: string, id: string, icon: string): SidebarTool => ({ label, command: c(id), icon });

export const MILESTONE_COMMAND = c("milestoneTracker");
export const SEARCH_COMMAND = c("searchTools");

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    name: "Core", icon: "rocket", color: "terminal.ansiBrightYellow", tools: [
      tool("REST API Client", "openGUI", "cloud"),
      tool("Clean Console Logs", "listAndRemoveConsoleLogs", "trash"),
      tool("Remove Unused Imports", "removeUnusedImports", "symbol-method"),
      tool("README Viewer & Manager", "readmeManager", "book"),
      tool("OpenCode Integration", "openCodeIntegration", "terminal"),
    ]
  },
  {
    name: "Snippets", icon: "book", color: "terminal.ansiBrightMagenta", tools: [
      tool("Create Snippet", "createCustomSnippet", "edit"),
      tool("Saved Snippets", "showSnippets", "file-code"),
    ]
  },
  {
    name: "Developer Tools", icon: "tools", color: "terminal.ansiBrightWhite", tools: [
      tool("All developer tools", "advancedToolsHub", "layout"),
      tool("JSON/XML Formatter", "jsonFormatter", "json"),
      tool("Encode / Decode", "base64Encoder", "symbol-string"),
      tool("JWT Decoder", "jwtDecoder", "key"),
      tool("Diff Checker", "textDiff", "diff"),
      tool("Dependencies & Installation", "dependencyManager", "package"),
    ]
  },
  {
    name: "AI & ML", icon: "hubot", color: "terminal.ansiBrightCyan", tools: [
      tool("All AI & ML tools", "aiMlHub", "layout"),
      tool("Prompt Builder", "promptTemplate", "comment-discussion"),
      tool("Token & Cost Estimator", "tokenCounter", "symbol-numeric"),
      tool("LLM Client Setup", "llmClientSetup", "plug"),
      tool("LLM JSON Validator", "llmJsonValidator", "json"),
    ]
  },
  {
    name: "RAG", icon: "search", color: "terminal.ansiBrightGreen", tools: [
      tool("All RAG tools", "ragHub", "layout"),
      tool("Chunking Tester", "chunkingTester", "list-flat"),
      tool("RAG Pipeline Generator", "ragPipeline", "rocket"),
      tool("Retrieval Evaluation", "ragEvalScores", "checklist"),
    ]
  },
  {
    name: "Data", icon: "database", color: "terminal.ansiBrightGreen", tools: [
      tool("All data tools", "bigDataHub", "layout"),
      tool("Data Converter", "dataConverter", "arrow-swap"),
      tool("JSON to Types", "jsonToTypes", "symbol-class"),
      tool("SQL Formatter & Linter", "sparkSqlFormatter", "database"),
      tool("Mock Data Generator", "mockDataGenerator", "sparkle"),
    ]
  },
  {
    name: "DevOps", icon: "server-environment", color: "terminal.ansiBrightBlue", tools: [
      tool("All DevOps tools", "devopsGenerator", "layout"),
      tool("Dockerfile", "dockerfileHelper", "package"),
      tool("Docker Compose", "composeHelper", "layers"),
      tool("Kubernetes & Helm", "kubernetesHelper", "server"),
      tool("CI Pipeline", "ciPipelineGenerator", "github-action"),
      tool(".env Checker", "envChecker", "key"),
      tool("Log Analyzer", "observabilityAnalyze", "pulse"),
    ]
  },
  {
    name: "Security", icon: "shield", color: "terminal.ansiBrightRed", tools: [
      tool("Security Hub", "securityHub", "shield"),
      tool("Endpoint Security Scan", "endpointSecurityScan", "radio-tower"),
      tool("Workspace Audit", "securityAudit", "search"),
      tool("Cloud & Container Audit", "cloudSecurityAudit", "cloud"),
      tool("Dependency & Config Check", "dependencyAudit", "package"),
    ]
  },
];

/** Every command the sidebar can run; anything else posted by the page is ignored. */
export function sidebarCommands(): Set<string> {
  return new Set([MILESTONE_COMMAND, SEARCH_COMMAND, ...SIDEBAR_GROUPS.flatMap(group => group.tools.map(t => t.command))]);
}
