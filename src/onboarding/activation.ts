import * as vscode from "vscode";
import { track } from "../analytics";
import { COMMAND_PREFIX } from "../utils/command-registry";

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

export const ACTIVATION_MILESTONES = [
  "first_launch", "first_tool", "first_api_request", "first_snippet", "first_ai_tool",
  "first_security_scan", "first_database_connection", "first_opencode"
] as const;
export type ActivationMilestone = typeof ACTIVATION_MILESTONES[number];

/** Firsts that are also Feature Explorer discoveries. */
const DISCOVERY: Partial<Record<ActivationMilestone, string>> = {
  first_api_request: "api_request",
  first_ai_tool: "ai_tool",
  first_security_scan: "security_scan",
  first_database_connection: "database_connection",
  first_snippet: "snippet",
  first_opencode: "opencode"
};

export interface GuideStep {
  id: ActivationMilestone | "theme_chosen";
  title: string;
  description: string;
  command: string;
  done: boolean;
}

/** The Getting started checklist: five high-value first steps, in a sensible order. */
const GUIDE: Array<Omit<GuideStep, "done">> = [
  { id: "first_api_request", title: "Send an API request", description: "Call any endpoint from the REST API Client.", command: "openGUI" },
  { id: "first_ai_tool", title: "Try an AI tool", description: "Count tokens, compare models or build a prompt.", command: "aiMlHub" },
  { id: "first_security_scan", title: "Run a security scan", description: "Audit this workspace or scan an endpoint.", command: "securityHub" },
  { id: "first_database_connection", title: "Connect a database", description: "Browse and edit Postgres, MySQL, MongoDB, Redis and more.", command: "databaseClient" },
  { id: "theme_chosen", title: "Pick a theme", description: "Preview the themes for every panel; your first 25 points unlock one.", command: "chooseTheme" }
];

/** Highlights per release, newest first. Shown once to users who updated past them. */
export const RELEASE_HIGHLIGHTS: Array<{ version: string; items: Array<{ title: string; command?: string }> }> = [
  {
    version: "11.76.3",
    items: [{ title: "A better daily spin: real odds, the prize you actually won, and one click to wear it", command: "milestoneTracker" }]
  },
  {
    version: "11.76.2",
    items: [{ title: "A cleaner Milestones & Points page: your next rank, today's goals and Redeem at a glance", command: "milestoneTracker" }]
  },
  {
    version: "11.76.1",
    items: [
      { title: "Redeem: a daily spin, dev challenge, Bit Sprint and weekly events", command: "milestoneTracker" },
      { title: "Make your rank card yours: avatars, titles, frames, banners and effects", command: "milestoneTracker" }
    ]
  },
  // A cosmetic patch: no items, so updating from 11.75.2 shows no What's New card.
  { version: "11.75.3", items: [] },
  {
    version: "11.75.2",
    items: [{ title: "REST API Client: reliable batch tests, and large or binary responses shown safely", command: "openGUI" }]
  },
  {
    version: "11.75.1",
    items: [
      { title: "Daily quests, streak freezes and a weekly recap", command: "milestoneTracker" },
      { title: "Themes unlock with points; preview any theme for 30 seconds first", command: "chooseTheme" },
      { title: "Your custom snippets now survive extension updates", command: "showSnippets" }
    ]
  },
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

interface ActivationState {
  installedAt: number;
  reached: Partial<Record<ActivationMilestone, number>>;
  /** Local dates (YYYY-MM-DD) DevSnip Pro was used on, most recent last, at most 90. */
  activeDays: string[];
  lastVersion?: string;
  /** Version whose What's new card was opened or dismissed. */
  whatsNewSeen?: string;
  /** The version DevSnip Pro was updated from in this run, if it was updated. */
  updatedFrom?: string;
  guideDismissed?: boolean;
  themeChosen?: boolean;
}

const STATE_KEY = "devsnip.activation";
/** Commands that are navigation, not a tool, so they do not count as "first tool". */
const NOT_A_TOOL = new Set(["milestoneTracker", "searchTools", "chooseTheme", "getStarted", "whatsNew", "advancedToolsHub", "premiumStatus", "resetFeatureUsage"]);

let context: vscode.ExtensionContext | undefined;
let discover: ((id: string) => Promise<void>) | undefined;
const changed = new vscode.EventEmitter<void>();
export const onDidChangeActivation = changed.event;

function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function read(): ActivationState {
  const raw = context?.globalState.get<Partial<ActivationState>>(STATE_KEY);
  const reached: ActivationState["reached"] = {};
  if (raw?.reached && typeof raw.reached === "object") {
    for (const id of ACTIVATION_MILESTONES) {
      const at = (raw.reached as Record<string, unknown>)[id];
      if (typeof at === "number" && Number.isFinite(at)) reached[id] = at;
    }
  }
  return {
    installedAt: typeof raw?.installedAt === "number" ? raw.installedAt : Date.now(),
    reached,
    activeDays: Array.isArray(raw?.activeDays) ? raw!.activeDays.filter(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-90) : [],
    lastVersion: typeof raw?.lastVersion === "string" ? raw.lastVersion : undefined,
    whatsNewSeen: typeof raw?.whatsNewSeen === "string" ? raw.whatsNewSeen : undefined,
    updatedFrom: typeof raw?.updatedFrom === "string" ? raw.updatedFrom : undefined,
    guideDismissed: raw?.guideDismissed === true,
    themeChosen: raw?.themeChosen === true
  };
}

async function write(state: ActivationState): Promise<void> {
  await context?.globalState.update(STATE_KEY, state);
  changed.fire();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0);
  const pb = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Called once on activation. `isNewInstall` comes from the analytics install
 * snapshot, so existing users are never mistaken for new ones.
 */
export async function initActivation(
  ctx: vscode.ExtensionContext,
  version: string,
  options: { isNewInstall: boolean; previousVersion?: string; recordDiscovery?: (id: string) => Promise<void> }
): Promise<void> {
  context = ctx;
  discover = options.recordDiscovery;
  const state = read();
  const today = localDate();
  if (state.activeDays[state.activeDays.length - 1] !== today) state.activeDays = [...state.activeDays.filter(d => d !== today), today].slice(-90);
  if (state.lastVersion && state.lastVersion !== version) state.updatedFrom = state.lastVersion;
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

/** Records a first. Safe to call often: only the first call per milestone does anything. */
export async function reach(milestone: ActivationMilestone): Promise<void> {
  if (!context) return;
  const state = read();
  if (state.reached[milestone]) return;
  state.reached[milestone] = Date.now();
  await write(state);
  track("activation_milestone", { milestone, days_since_install: Math.max(0, Math.floor((Date.now() - state.installedAt) / 86_400_000)) });
  const discovery = DISCOVERY[milestone];
  if (discovery && discover) await discover(discovery).catch(() => undefined);
}

/** Maps a command run to the firsts it represents. Commands that only open a panel count as "first tool". */
export function noteCommand(commandId: string): void {
  if (!commandId.startsWith(COMMAND_PREFIX)) return;
  const bare = commandId.slice(COMMAND_PREFIX.length);
  if (NOT_A_TOOL.has(bare)) return;
  void reach("first_tool");
}

/** Called when a toolkit tool actually produced a result (not just opened). */
export function noteToolRun(section: string | undefined, outcome: string): void {
  if (section === "ai" && outcome === "success") void reach("first_ai_tool");
}

export async function noteThemeChosen(): Promise<void> {
  const state = read();
  if (state.themeChosen) return;
  state.themeChosen = true;
  await write(state);
}

export function guideSteps(): GuideStep[] {
  const state = read();
  return GUIDE.map(step => ({
    ...step,
    command: COMMAND_PREFIX + step.command,
    done: step.id === "theme_chosen" ? !!state.themeChosen : !!state.reached[step.id]
  }));
}

/** The Getting started card is shown until it is dismissed or every step is done. */
export function guideVisible(): boolean {
  const state = read();
  return !state.guideDismissed && guideSteps().some(step => !step.done);
}

export async function dismissGuide(): Promise<void> {
  const state = read();
  state.guideDismissed = true;
  await write(state);
  track("onboarding_action", { action: "guide_dismissed" });
}

/** Highlights from releases newer than the version this user updated from; empty for new installs. */
export function whatsNew(currentVersion: string): { version: string; items: Array<{ title: string; command?: string }> } | null {
  const state = read();
  if (!state.updatedFrom || state.whatsNewSeen === currentVersion) return null;
  const items = RELEASE_HIGHLIGHTS
    .filter(release => compareVersions(release.version, state.updatedFrom!) > 0 && compareVersions(release.version, currentVersion) <= 0)
    .flatMap(release => release.items)
    .slice(0, 4)
    .map(item => ({ ...item, command: item.command ? COMMAND_PREFIX + item.command : undefined }));
  return items.length ? { version: currentVersion, items } : null;
}

export async function dismissWhatsNew(currentVersion: string, opened: boolean): Promise<void> {
  const state = read();
  state.whatsNewSeen = currentVersion;
  await write(state);
  track("onboarding_action", { action: opened ? "whats_new_opened" : "whats_new_dismissed" });
}

/** Local engagement summary (for diagnostics and tests). */
export function activationSummary(): { activeDays: number; reached: ActivationMilestone[]; returning: boolean } {
  const state = read();
  return { activeDays: state.activeDays.length, reached: ACTIVATION_MILESTONES.filter(id => state.reached[id]), returning: state.activeDays.length > 1 };
}

export function disposeActivation(): void {
  changed.dispose();
}
