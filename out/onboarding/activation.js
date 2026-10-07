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
exports.disposeActivation = exports.activationSummary = exports.dismissWhatsNew = exports.whatsNew = exports.dismissGuide = exports.guideVisible = exports.guideSteps = exports.noteThemeChosen = exports.noteToolRun = exports.noteCommand = exports.reach = exports.initActivation = exports.onDidChangeActivation = exports.RELEASE_HIGHLIGHTS = exports.ACTIVATION_MILESTONES = void 0;
const vscode = __importStar(require("vscode"));
const analytics_1 = require("../analytics");
const command_registry_1 = require("../utils/command-registry");
/**
 * Activation and onboarding state, kept locally in globalState.
 *
 * It records the first time each core action really happens (a request sent,
 * a scan completed, a database connected - not just a panel opened), the days
 * DevSnip Pro was used, and what the user dismissed. That drives the sidebar's
 * Getting started checklist and What's new card, counts towards the Feature
 * Explorer milestone, and sends one anonymous `activation_milestone` event per
 * first (only when analytics is allowed).
 */
exports.ACTIVATION_MILESTONES = [
    "first_launch", "first_tool", "first_api_request", "first_snippet", "first_ai_tool",
    "first_security_scan", "first_database_connection", "first_opencode"
];
/** Firsts that are also Feature Explorer discoveries. */
const DISCOVERY = {
    first_api_request: "api_request",
    first_ai_tool: "ai_tool",
    first_security_scan: "security_scan",
    first_database_connection: "database_connection",
    first_snippet: "snippet",
    first_opencode: "opencode"
};
/** The Getting started checklist: five high-value first steps, in a sensible order. */
const GUIDE = [
    { id: "first_api_request", title: "Send an API request", description: "Call any endpoint from the REST API Client.", command: "openGUI" },
    { id: "first_ai_tool", title: "Try an AI tool", description: "Count tokens, compare models or build a prompt.", command: "aiMlHub" },
    { id: "first_security_scan", title: "Run a security scan", description: "Audit this workspace or scan an endpoint.", command: "securityHub" },
    { id: "first_database_connection", title: "Connect a database", description: "Browse and edit Postgres, MySQL, MongoDB, Redis and more.", command: "databaseClient" },
    { id: "theme_chosen", title: "Pick a theme", description: "Preview the themes for every panel; your first 25 points unlock one.", command: "chooseTheme" }
];
/** Highlights per release, newest first. Shown once to users who updated past them. */
exports.RELEASE_HIGHLIGHTS = [
    {
        version: "11.74.1",
        items: [{ title: "REST API Client: send a sample request in one click", command: "openGUI" }]
    },
    {
        version: "11.73.1",
        items: [
            { title: "Getting started guide and a 7x faster startup", command: "getStarted" },
            { title: "Milestones & Points redesigned, with a Feature Explorer milestone", command: "milestoneTracker" }
        ]
    },
    {
        version: "11.72.1",
        items: [{ title: "Nine appearance themes for every DevSnip Pro panel", command: "chooseTheme" }]
    },
    {
        version: "11.71.1",
        items: [{ title: "Database Client for Postgres, MySQL, SQL Server, SQLite, MongoDB and Redis", command: "databaseClient" }]
    }
];
const STATE_KEY = "devsnip.activation";
/** Commands that are navigation, not a tool, so they do not count as "first tool". */
const NOT_A_TOOL = new Set(["milestoneTracker", "searchTools", "chooseTheme", "getStarted", "whatsNew", "advancedToolsHub", "premiumStatus", "resetFeatureUsage"]);
let context;
let discover;
const changed = new vscode.EventEmitter();
exports.onDidChangeActivation = changed.event;
function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function read() {
    const raw = context?.globalState.get(STATE_KEY);
    const reached = {};
    if (raw?.reached && typeof raw.reached === "object") {
        for (const id of exports.ACTIVATION_MILESTONES) {
            const at = raw.reached[id];
            if (typeof at === "number" && Number.isFinite(at))
                reached[id] = at;
        }
    }
    return {
        installedAt: typeof raw?.installedAt === "number" ? raw.installedAt : Date.now(),
        reached,
        activeDays: Array.isArray(raw?.activeDays) ? raw.activeDays.filter(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-90) : [],
        lastVersion: typeof raw?.lastVersion === "string" ? raw.lastVersion : undefined,
        whatsNewSeen: typeof raw?.whatsNewSeen === "string" ? raw.whatsNewSeen : undefined,
        updatedFrom: typeof raw?.updatedFrom === "string" ? raw.updatedFrom : undefined,
        guideDismissed: raw?.guideDismissed === true,
        themeChosen: raw?.themeChosen === true
    };
}
async function write(state) {
    await context?.globalState.update(STATE_KEY, state);
    changed.fire();
}
function compareVersions(a, b) {
    const pa = a.split(".").map(n => parseInt(n, 10) || 0);
    const pb = b.split(".").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0))
            return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
}
/**
 * Called once on activation. `isNewInstall` comes from the analytics install
 * snapshot, so existing users are never mistaken for new ones.
 */
async function initActivation(ctx, version, options) {
    context = ctx;
    discover = options.recordDiscovery;
    const state = read();
    const today = localDate();
    if (state.activeDays[state.activeDays.length - 1] !== today)
        state.activeDays = [...state.activeDays.filter(d => d !== today), today].slice(-90);
    if (state.lastVersion && state.lastVersion !== version)
        state.updatedFrom = state.lastVersion;
    if (!state.lastVersion && !options.isNewInstall) {
        // Users who had DevSnip Pro before this guide existed already know their way around,
        // but have not seen what changed since their previous version.
        state.guideDismissed = true;
        state.updatedFrom = options.previousVersion && options.previousVersion !== version ? options.previousVersion : "0.0.0";
    }
    state.lastVersion = version;
    await write(state);
    await reach("first_launch");
}
exports.initActivation = initActivation;
/** Records a first. Safe to call often: only the first call per milestone does anything. */
async function reach(milestone) {
    if (!context)
        return;
    const state = read();
    if (state.reached[milestone])
        return;
    state.reached[milestone] = Date.now();
    await write(state);
    (0, analytics_1.track)("activation_milestone", { milestone, days_since_install: Math.max(0, Math.floor((Date.now() - state.installedAt) / 86400000)) });
    const discovery = DISCOVERY[milestone];
    if (discovery && discover)
        await discover(discovery).catch(() => undefined);
}
exports.reach = reach;
/** Maps a command run to the firsts it represents. Commands that only open a panel count as "first tool". */
function noteCommand(commandId) {
    if (!commandId.startsWith(command_registry_1.COMMAND_PREFIX))
        return;
    const bare = commandId.slice(command_registry_1.COMMAND_PREFIX.length);
    if (NOT_A_TOOL.has(bare))
        return;
    void reach("first_tool");
}
exports.noteCommand = noteCommand;
/** Called when a toolkit tool actually produced a result (not just opened). */
function noteToolRun(section, outcome) {
    if (section === "ai" && outcome === "success")
        void reach("first_ai_tool");
}
exports.noteToolRun = noteToolRun;
async function noteThemeChosen() {
    const state = read();
    if (state.themeChosen)
        return;
    state.themeChosen = true;
    await write(state);
}
exports.noteThemeChosen = noteThemeChosen;
function guideSteps() {
    const state = read();
    return GUIDE.map(step => ({
        ...step,
        command: command_registry_1.COMMAND_PREFIX + step.command,
        done: step.id === "theme_chosen" ? !!state.themeChosen : !!state.reached[step.id]
    }));
}
exports.guideSteps = guideSteps;
/** The Getting started card is shown until it is dismissed or every step is done. */
function guideVisible() {
    const state = read();
    return !state.guideDismissed && guideSteps().some(step => !step.done);
}
exports.guideVisible = guideVisible;
async function dismissGuide() {
    const state = read();
    state.guideDismissed = true;
    await write(state);
    (0, analytics_1.track)("onboarding_action", { action: "guide_dismissed" });
}
exports.dismissGuide = dismissGuide;
/** Highlights from releases newer than the version this user updated from; empty for new installs. */
function whatsNew(currentVersion) {
    const state = read();
    if (!state.updatedFrom || state.whatsNewSeen === currentVersion)
        return null;
    const items = exports.RELEASE_HIGHLIGHTS
        .filter(release => compareVersions(release.version, state.updatedFrom) > 0 && compareVersions(release.version, currentVersion) <= 0)
        .flatMap(release => release.items)
        .slice(0, 4)
        .map(item => ({ ...item, command: item.command ? command_registry_1.COMMAND_PREFIX + item.command : undefined }));
    return items.length ? { version: currentVersion, items } : null;
}
exports.whatsNew = whatsNew;
async function dismissWhatsNew(currentVersion, opened) {
    const state = read();
    state.whatsNewSeen = currentVersion;
    await write(state);
    (0, analytics_1.track)("onboarding_action", { action: opened ? "whats_new_opened" : "whats_new_dismissed" });
}
exports.dismissWhatsNew = dismissWhatsNew;
/** Local engagement summary (for diagnostics and tests). */
function activationSummary() {
    const state = read();
    return { activeDays: state.activeDays.length, reached: exports.ACTIVATION_MILESTONES.filter(id => state.reached[id]), returning: state.activeDays.length > 1 };
}
exports.activationSummary = activationSummary;
function disposeActivation() {
    changed.dispose();
}
exports.disposeActivation = disposeActivation;
//# sourceMappingURL=activation.js.map