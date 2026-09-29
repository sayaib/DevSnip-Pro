"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_HUBS = exports.DEVOPS_HUB = exports.DATA_HUB = exports.RAG_HUB = exports.AI_ML_HUB = exports.DEVELOPER_TOOLS_HUB = void 0;
const registry_1 = require("../toolkits/registry");
/**
 * The tools each hub shows. The AI, RAG, Data and DevOps hubs are generated
 * from the toolkit registry, so a hub can never list a tool that does not
 * exist or miss one that does. Developer Tools mixes toolkit tools with the
 * long-standing standalone panels (regex, JSON/XML, hashes, colours...).
 */
const cmd = (id) => `sayaib.hue-console.${id}`;
function toHubTool(tool, category = tool.category) {
    return {
        command: cmd(tool.command),
        title: tool.title,
        description: tool.summary,
        category,
        icon: tool.icon,
        tag: tool.network ? "Uses network" : tool.live ? "Live" : undefined,
        keywords: tool.keywords
    };
}
function sectionHub(section, viewType, panelTitle, heading, subtitle) {
    const tools = (0, registry_1.toolsIn)(section.id);
    return {
        viewType,
        panelTitle,
        heading,
        subtitle,
        searchPlaceholder: `Search ${section.title} tools`,
        categories: section.categories,
        tools: tools.map(t => toHubTool(t)),
        journey: section.journey?.map(step => ({ command: cmd(tools.find(t => t.id === step.tool).command), title: step.title, text: step.text }))
    };
}
const section = (id) => registry_1.SECTIONS.find(s => s.id === id);
const devTool = (id, category) => toHubTool((0, registry_1.toolsIn)("dev").find(t => t.id === id), category);
exports.DEVELOPER_TOOLS_HUB = {
    viewType: "advancedToolsHub",
    panelTitle: "DevSnip Pro - Developer Tools",
    heading: "Developer Tools",
    subtitle: "Everyday utilities: formatting, encoding, tokens, IDs, diffs, text and schedules.",
    searchPlaceholder: "Search developer tools",
    categories: ["Code & Data", "Encode & Inspect", "Time & Design"],
    tools: [
        { command: cmd("dependencyManager"), title: "Dependencies & Installation", description: "Find every npm, yarn, pnpm, pip, Maven and Gradle dependency, compare installed and latest versions, and install or update in one click.", category: "Code & Data", icon: "package", tag: "Packages", keywords: ["npm", "pip", "maven", "gradle", "outdated", "upgrade"] },
        { command: cmd("jsonFormatter"), title: "JSON/XML Formatter", description: "Format, minify and validate JSON and XML with syntax highlighting.", category: "Code & Data", icon: "braces", keywords: ["prettify", "beautify", "validate", "minify"] },
        { command: cmd("regexBuilder"), title: "Regex Builder & Tester", description: "Build and debug regular expressions with live match and group highlighting.", category: "Code & Data", icon: "regex", keywords: ["regular expression", "match"] },
        devTool("dev.diff", "Code & Data"),
        devTool("dev.text", "Code & Data"),
        toHubTool((0, registry_1.toolsIn)("ai").find(t => t.id === "ai.toon"), "Code & Data"),
        devTool("dev.encode", "Encode & Inspect"),
        devTool("dev.jwt", "Encode & Inspect"),
        { command: cmd("hashGenerator"), title: "Hash Generator", description: "Generate SHA-1, SHA-256, SHA-384 and SHA-512 hashes of text.", category: "Encode & Inspect", icon: "hash", keywords: ["sha", "checksum", "digest"] },
        devTool("dev.ids", "Encode & Inspect"),
        { command: cmd("timestampConverter"), title: "Timestamp Converter", description: "Convert between Unix timestamps and readable dates; detects seconds vs milliseconds.", category: "Time & Design", icon: "clock", keywords: ["epoch", "unix", "date", "iso"] },
        devTool("dev.cron", "Time & Design"),
        { command: cmd("colorPalette"), title: "Color Palette", description: "Pick colours, generate shades and check WCAG contrast ratios.", category: "Time & Design", icon: "palette", keywords: ["colour", "hex", "rgb", "contrast", "accessibility"] }
    ]
};
exports.AI_ML_HUB = sectionHub(section("ai"), "aiMlHub", "DevSnip Pro - AI & ML Tools", "AI & ML Tools", "Prompts, model costs, LLM clients, output handling, GPU sizing and training helpers.");
exports.RAG_HUB = sectionHub(section("rag"), "ragHub", "DevSnip Pro - RAG Tools", "RAG Tools", "Chunking, embeddings, vector stores, retrieval, prompts and evaluation for retrieval-augmented generation.");
exports.DATA_HUB = sectionHub(section("data"), "bigDataHub", "DevSnip Pro - Data Tools", "Data Tools", "Convert, type, query, generate, validate and profile data - from a JSON payload to a Spark cluster.");
exports.DEVOPS_HUB = sectionHub(section("devops"), "devopsHub", "DevSnip Pro - DevOps Tools", "DevOps Tools", "Containers, Kubernetes, CI/CD, cloud deploys, server config, environment files, networking and logs.");
exports.ALL_HUBS = [exports.DEVELOPER_TOOLS_HUB, exports.AI_ML_HUB, exports.RAG_HUB, exports.DATA_HUB, exports.DEVOPS_HUB];
//# sourceMappingURL=hubs.js.map