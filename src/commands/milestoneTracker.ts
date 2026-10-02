import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import { executeQueuedCommand } from "../utils/command-dispatch";
import { UTILITY_CSS, confirmAction, openToolPanel, safePostMessage } from "../utils/webview-ui";
import { DEVELOPER_FEATURES } from "../premium/feature-registry";
import { TrackerView, buildTrackerView, levelIndexFor, toolNamesFromManifest } from "../services/milestone-view";
import { track } from "../analytics";
import { setWebviewHtml } from "../theme/service";

export interface UserStats {
    /** Spendable balance. Premium tools deduct from it, so it can go down. */
    totalPoints: number;
    /**
     * Every point ever earned. Spending never lowers it, so levels and the
     * "Point Tycoon" milestone are based on it: a premium run must not demote
     * the user a level.
     */
    lifetimePoints: number;
    dailyPoints: number;
    lastActiveDate: string; // YYYY-MM-DD
    streakDays: number;
    activities: { id: string; title: string; points: number; timestamp: number; category: string }[];
    completedMilestones: string[];
    claimedRewards: string[];
    dailyClaims: { [date: string]: boolean };
    dailyToolUsage: { [toolKey: string]: number };
    /**
     * Points earned today from repeatable actions. The daily cap is applied to
     * this value only, so one-time milestone bonuses are never swallowed by it.
     */
    dailyEarnedPoints: number;
    /**
     * Lifetime run counters. Milestone progress is derived from these rather
     * than from the (capped) activity log, so long-term achievements stay
     * reachable and cannot regress when old activities are trimmed.
     */
    counters: {
        toolRuns: number;
        snippetRuns: number;
        securityRuns: number;
        aiRuns: number;
    };
    /**
     * Core features this user has actually used (DISCOVERIES ids), e.g. a
     * request sent from the REST API Client or a database connected - not just
     * a panel opened. Drives the Feature Explorer milestone.
     */
    discovered: string[];
}

/** The core features the Feature Explorer milestone counts, each recorded once when first really used. */
export const DISCOVERIES = ["api_request", "ai_tool", "security_scan", "database_connection", "snippet", "opencode"] as const;
export type Discovery = typeof DISCOVERIES[number];

export interface LevelInfo {
    name: string;
    minPoints: number;
    color: string;
    badge: string;
    rank: string;
    reward: string;
}

/**
 * Levels are recognition only: every DevSnip Pro tool is available at every
 * level (premium REST client tools are paid for with points, not unlocked by
 * level), so `reward` describes the recognition, never a feature unlock.
 */
export const LEVELS: LevelInfo[] = [
    { name: "Bronze", minPoints: 0, color: "#CD7F32", badge: "🥉", rank: "Novice Developer", reward: "Bronze badge and title in the Tools view" },
    { name: "Silver", minPoints: 150, color: "#C0C0C0", badge: "🥈", rank: "Skilled Coder", reward: "Silver badge and title in the Tools view" },
    { name: "Gold", minPoints: 600, color: "#FFD700", badge: "🥇", rank: "Senior Engineer", reward: "Gold badge and title in the Tools view" },
    { name: "Platinum", minPoints: 1800, color: "#E5E4E2", badge: "💎", rank: "Principal Architect", reward: "Platinum badge and title in the Tools view" },
    { name: "Diamond", minPoints: 4500, color: "#B9F2FF", badge: "👑", rank: "Elite Innovator", reward: "Diamond badge and title in the Tools view" },
    { name: "Master", minPoints: 10000, color: "#9c27b0", badge: "🔮", rank: "Grand Master", reward: "Master badge and title in the Tools view" },
    { name: "Grandmaster", minPoints: 25000, color: "#ff5722", badge: "⚡", rank: "Global Legend", reward: "Grandmaster badge and title in the Tools view" }
];

export interface Milestone {
    id: string;
    title: string;
    description: string;
    target: number;
    points: number;
    category: string;
    icon: string;
}

export const MILESTONES: Milestone[] = [
    { id: "first_tool", title: "First Tool Execution", description: "Run any DevSnip Pro tool", target: 1, points: 10, category: "Core", icon: "🚀" },
    { id: "tool_explorer", title: "Tool Explorer", description: "Execute tools 25 times", target: 25, points: 50, category: "Core", icon: "🛠️" },
    { id: "power_user", title: "Power Developer", description: "Execute tools 100 times", target: 100, points: 200, category: "Core", icon: "⚡" },
    { id: "snippet_creator", title: "Snippet Creator", description: "Create 10 custom code snippets", target: 10, points: 75, category: "Snippets", icon: "📝" },
    { id: "streak_5", title: "Consistent Coder", description: "Maintain active usage for 5 consecutive days", target: 5, points: 60, category: "Activity", icon: "🔥" },
    { id: "streak_14", title: "Weekly Warrior", description: "Maintain active usage for 14 consecutive days", target: 14, points: 200, category: "Activity", icon: "🌟" },
    { id: "security_audit", title: "Security Sentinel", description: "Run 5 Security or Cloud Audits", target: 5, points: 80, category: "Security", icon: "🛡️" },
    { id: "ai_explorer", title: "AI/ML Enthusiast", description: "Use AI/ML or RAG tools 10 times", target: 10, points: 90, category: "AI", icon: "🤖" },
    { id: "points_5000", title: "Point Tycoon", description: "Earn 5,000 points in total", target: 5000, points: 500, category: "Milestone", icon: "💰" },
    { id: "feature_explorer", title: "Feature Explorer", description: "Try 5 of: an API request, an AI tool, a security scan, a database, a snippet, OpenCode", target: 5, points: 60, category: "Discovery", icon: "🧭" }
];
let globalContext: vscode.ExtensionContext | undefined;
let refreshCallback: (() => void) | undefined;

/**
 * Fires whenever the stored points change.
 *
 * Premium REST API Client tools are unlocked by spending points, so anything
 * showing a balance or an affordability state needs to know the moment it moves.
 */
const pointsChangeEmitter = new vscode.EventEmitter<number>();
export const onDidChangePoints: vscode.Event<number> = pointsChangeEmitter.event;

/** Every mutation runs through this queue so concurrent tool runs cannot lose points. */
let stateQueue: Promise<unknown> = Promise.resolve();

/** Points a single day can produce, so levels stay a long-term signal. */
const DAILY_POINT_CAP = 120;
/** After this many runs of the same tool in a day, further runs are worth 1 point. */
const RATE_LIMIT_AFTER = 5;
/** Daily-claim keys older than this are pruned so global state cannot grow forever. */
const DAILY_CLAIM_HISTORY_DAYS = 60;
const MAX_ACTIVITIES = 100;
const STATE_KEY = 'devsnip_user_stats';
/** Points for the automatic once-a-day login bonus and the claimable daily boost. */
export const DAILY_LOGIN_POINTS = 5;
export const DAILY_BONUS_POINTS = 10;

export function setMilestoneContext(context: vscode.ExtensionContext) {
    globalContext = context;
}

export function setTreeRefreshCallback(cb: () => void) {
    refreshCallback = cb;
}

/** Local calendar date (YYYY-MM-DD). Using UTC here would roll the day over at the wrong time. */
function getTodayString(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number | undefined {
    const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
    const to = Date.parse(`${toIsoDate}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
    return Math.round((to - from) / 86400000);
}

function createDefaultStats(): UserStats {
    return {
        totalPoints: 0,
        lifetimePoints: 0,
        dailyPoints: 0,
        lastActiveDate: getTodayString(),
        streakDays: 1,
        activities: [],
        completedMilestones: [],
        claimedRewards: [],
        dailyClaims: {},
        dailyToolUsage: {},
        dailyEarnedPoints: 0,
        counters: { toolRuns: 0, snippetRuns: 0, securityRuns: 0, aiRuns: 0 },
        discovered: []
    };
}

function toFiniteNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function toStringMap<T>(value: unknown, coerce: (entry: unknown) => T | undefined): { [key: string]: T } {
    const result: { [key: string]: T } = {};
    if (!value || typeof value !== 'object') return result;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const coerced = coerce(entry);
        if (coerced !== undefined) result[key] = coerced;
    }
    return result;
}

/**
 * Rebuilds a usable stats object from whatever is in global state. Data written
 * by an older version, hand-edited state, or a partially written object must
 * never throw or wipe a user's progress - unknown fields are repaired in place.
 */
function sanitizeStats(raw: unknown): UserStats {
    const defaults = createDefaultStats();
    if (!raw || typeof raw !== 'object') return defaults;
    const source = raw as Partial<UserStats> & { counters?: Partial<UserStats['counters']> };

    const activities = Array.isArray(source.activities)
        ? source.activities
              .filter((entry): entry is UserStats['activities'][number] => !!entry && typeof entry === 'object')
              .map(entry => ({
                  id: typeof entry.id === 'string' ? entry.id : 'activity',
                  title: typeof entry.title === 'string' ? entry.title : 'Activity',
                  points: toFiniteNumber(entry.points, 0),
                  timestamp: toFiniteNumber(entry.timestamp, Date.now()),
                  category: typeof entry.category === 'string' ? entry.category : 'Core'
              }))
              .slice(0, MAX_ACTIVITIES)
        : [];

    const lastActiveDate = typeof source.lastActiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.lastActiveDate)
        ? source.lastActiveDate
        : getTodayString();

    const counters = source.counters && typeof source.counters === 'object'
        ? {
              toolRuns: Math.max(0, Math.trunc(toFiniteNumber(source.counters.toolRuns, 0))),
              snippetRuns: Math.max(0, Math.trunc(toFiniteNumber(source.counters.snippetRuns, 0))),
              securityRuns: Math.max(0, Math.trunc(toFiniteNumber(source.counters.securityRuns, 0))),
              aiRuns: Math.max(0, Math.trunc(toFiniteNumber(source.counters.aiRuns, 0)))
          }
        : {
              // Migration from versions that derived progress from the capped
              // activity log: seed the counters from whatever history exists.
              toolRuns: activities.filter(a => a.category !== 'Milestone' && a.category !== 'Redemption').length,
              snippetRuns: activities.filter(a => a.category === 'Snippets').length,
              securityRuns: activities.filter(a => a.category === 'Security').length,
              aiRuns: activities.filter(a => a.category === 'AI').length
          };

    const totalPoints = Math.max(0, Math.trunc(toFiniteNumber(source.totalPoints, 0)));
    // Versions before lifetime tracking only stored the balance. Points spent
    // since then are recovered from the redemption entries still in the log.
    const netSpent = -activities
        .filter(a => a.category === 'Redemption')
        .reduce((sum, a) => sum + a.points, 0);
    const storedLifetime = Math.trunc(toFiniteNumber(source.lifetimePoints, NaN));
    const lifetimePoints = Number.isFinite(storedLifetime)
        ? Math.max(storedLifetime, totalPoints)
        : totalPoints + Math.max(0, netSpent);

    return {
        totalPoints,
        lifetimePoints,
        dailyPoints: Math.max(0, Math.trunc(toFiniteNumber(source.dailyPoints, 0))),
        lastActiveDate,
        streakDays: Math.max(1, Math.trunc(toFiniteNumber(source.streakDays, 1))),
        activities,
        completedMilestones: toStringArray(source.completedMilestones),
        claimedRewards: toStringArray(source.claimedRewards),
        dailyClaims: toStringMap(source.dailyClaims, entry => (entry === true ? true : undefined)),
        dailyToolUsage: toStringMap(source.dailyToolUsage, entry => {
            const count = toFiniteNumber(entry, NaN);
            return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : undefined;
        }),
        dailyEarnedPoints: Math.max(0, Math.trunc(toFiniteNumber(source.dailyEarnedPoints, 0))),
        counters,
        discovered: [...new Set(toStringArray(source.discovered).filter(id => (DISCOVERIES as readonly string[]).includes(id)))]
    };
}

/** Applies the day rollover (streak, daily counters, claim pruning). */
function applyDayRollover(stats: UserStats): boolean {
    const today = getTodayString();
    if (stats.lastActiveDate === today) return false;

    const gap = daysBetween(stats.lastActiveDate, today);
    if (gap === 1) stats.streakDays += 1;
    else if (gap === undefined || gap > 1) stats.streakDays = 1;

    stats.dailyPoints = 0;
    stats.dailyEarnedPoints = 0;
    stats.lastActiveDate = today;
    stats.dailyToolUsage = {};

    const cutoff = getTodayString(new Date(Date.now() - DAILY_CLAIM_HISTORY_DAYS * 86400000));
    for (const key of Object.keys(stats.dailyClaims)) {
        if (key.slice(0, 10) < cutoff) delete stats.dailyClaims[key];
    }
    return true;
}

/** Reads a consistent, repaired snapshot of the user's progress. Never throws. */
export function getUserStats(context: vscode.ExtensionContext): UserStats {
    let stored: unknown;
    try {
        stored = context.globalState.get<unknown>(STATE_KEY);
    } catch (error) {
        console.error('DevSnip Pro: unable to read milestone state.', error);
        stored = undefined;
    }
    const stats = sanitizeStats(stored);
    applyDayRollover(stats);
    return stats;
}

/** Current points balance. Never negative, and never throws. */
export function getPointsBalance(context: vscode.ExtensionContext): number {
    try {
        return Math.max(0, Math.trunc(getUserStats(context).totalPoints));
    } catch (error) {
        console.error('DevSnip Pro: could not read the points balance.', error);
        return 0;
    }
}

export async function saveUserStats(context: vscode.ExtensionContext, stats: UserStats): Promise<void> {
    try {
        await context.globalState.update(STATE_KEY, stats);
    } catch (error) {
        console.error('DevSnip Pro: unable to save milestone state.', error);
    }
}

/**
 * Serialised read-modify-write. Two tools finishing at the same moment would
 * otherwise both read the same snapshot and one update would be lost.
 */
function mutateStats<T>(
    context: vscode.ExtensionContext,
    mutate: (stats: UserStats) => T
): Promise<{ stats: UserStats; result: T }> {
    const next = stateQueue.then(async () => {
        const stats = getUserStats(context);
        const levelBefore = levelIndexFor(stats.lifetimePoints, LEVELS);
        const milestonesBefore = new Set(stats.completedMilestones);
        const result = mutate(stats);
        await saveUserStats(context, stats);
        // Every earning path goes through here, so this is the one place progress events are sent.
        for (const id of stats.completedMilestones) {
            if (!milestonesBefore.has(id)) track('milestone_unlocked', { milestone: id });
        }
        const levelAfter = levelIndexFor(stats.lifetimePoints, LEVELS);
        if (levelAfter > levelBefore) track('level_reached', { level: LEVELS[levelAfter].name, level_index: levelAfter });
        if (refreshCallback) refreshCallback();
        pointsChangeEmitter.fire(stats.totalPoints);
        return { stats, result };
    });
    stateQueue = next.catch(() => undefined);
    return next;
}

export async function redeemPoints(context: vscode.ExtensionContext, cost: number, reason: string): Promise<boolean> {
    const amount = Math.max(0, Math.trunc(toFiniteNumber(cost, 0)));
    const { result } = await mutateStats(context, stats => {
        if (stats.totalPoints < amount) return false;
        stats.totalPoints -= amount;
        if (amount > 0) track('points_spent', { amount });
        pushActivity(stats, {
            id: `redeem_${Date.now()}`,
            title: `Redeemed Points: ${reason} (-${amount} pts)`,
            points: -amount,
            timestamp: Date.now(),
            category: 'Redemption'
        });
        return true;
    });
    return result;
}

/** Returns points that were spent but whose work failed, so nothing is silently lost. */
export async function refundPoints(context: vscode.ExtensionContext, amount: number, reason: string): Promise<void> {
    const points = Math.max(0, Math.trunc(toFiniteNumber(amount, 0)));
    if (!points) return;
    await mutateStats(context, stats => {
        stats.totalPoints += points;
        pushActivity(stats, {
            id: `refund_${Date.now()}`,
            title: `Refunded Points: ${reason} (+${points} pts)`,
            points,
            timestamp: Date.now(),
            category: 'Redemption'
        });
    });
}

function pushActivity(stats: UserStats, activity: UserStats['activities'][number]): void {
    stats.activities.unshift(activity);
    if (stats.activities.length > MAX_ACTIVITIES) {
        stats.activities = stats.activities.slice(0, MAX_ACTIVITIES);
    }
}

function milestoneProgress(stats: UserStats, milestoneId: string): number {
    switch (milestoneId) {
        case 'first_tool': return Math.min(stats.counters.toolRuns, 1);
        case 'tool_explorer':
        case 'power_user': return stats.counters.toolRuns;
        case 'snippet_creator': return stats.counters.snippetRuns;
        case 'streak_5':
        case 'streak_14': return stats.streakDays;
        case 'security_audit': return stats.counters.securityRuns;
        case 'ai_explorer': return stats.counters.aiRuns;
        case 'points_5000': return stats.lifetimePoints;
        case 'feature_explorer': return stats.discovered.length;
        default: return 0;
    }
}

/** Awards any milestone whose target is now met. Returns the newly unlocked titles. */
function awardMilestones(stats: UserStats): string[] {
    const unlocked: string[] = [];
    for (const milestone of MILESTONES) {
        if (stats.completedMilestones.includes(milestone.id)) continue;
        if (milestoneProgress(stats, milestone.id) < milestone.target) continue;
        stats.completedMilestones.push(milestone.id);
        stats.totalPoints += milestone.points;
        stats.lifetimePoints += milestone.points;
        stats.dailyPoints += milestone.points;
        unlocked.push(milestone.title);
        pushActivity(stats, {
            id: `milestone_${milestone.id}`,
            title: `Milestone Unlocked: ${milestone.title} (+${milestone.points} pts)`,
            points: milestone.points,
            timestamp: Date.now(),
            category: 'Milestone'
        });
    }
    return unlocked;
}

export async function recordActivity(
    context: vscode.ExtensionContext,
    activityId: string,
    title: string,
    points: number,
    category: string
): Promise<{ stats: UserStats; newMilestones: string[]; levelUp: boolean }> {
    const { stats, result } = await mutateStats(context, current => {
        const before = getCurrentLevelName(current.lifetimePoints);
        const allowance = Math.max(0, DAILY_POINT_CAP - current.dailyEarnedPoints);
        const awarded = Math.min(Math.max(0, Math.trunc(toFiniteNumber(points, 0))), allowance);

        current.totalPoints += awarded;
        current.lifetimePoints += awarded;
        current.dailyPoints += awarded;
        current.dailyEarnedPoints += awarded;
        current.lastActiveDate = getTodayString();
        pushActivity(current, {
            id: activityId,
            title,
            points: awarded,
            timestamp: Date.now(),
            category
        });

        const newMilestones = awardMilestones(current);
        return { newMilestones, levelUp: before !== getCurrentLevelName(current.lifetimePoints) };
    });
    return { stats, newMilestones: result.newMilestones, levelUp: result.levelUp };
}

/**
 * Records the first real use of a core feature (once each). It earns nothing
 * by itself; it counts towards the Feature Explorer milestone.
 */
export async function recordDiscovery(context: vscode.ExtensionContext, discovery: Discovery): Promise<void> {
    if (!(DISCOVERIES as readonly string[]).includes(discovery)) return;
    if (getUserStats(context).discovered.includes(discovery)) return;
    await mutateStats(context, stats => {
        if (stats.discovered.includes(discovery)) return;
        stats.discovered.push(discovery);
        awardMilestones(stats);
    });
}

/** Maps a command id to its points category. */
function categoryForCommand(commandId: string): { category: string; points: number } {
    const name = commandId.replace(COMMAND_PREFIX, '');
    if (/snippet/i.test(name)) return { category: 'Snippets', points: 10 };
    if (/security|audit/i.test(name)) return { category: 'Security', points: 8 };
    if (/^(ai|ml|rag)|prompt|model|llm|token|embedding|dataset|inference|gpu|chunking|semantic|hallucination/i.test(name)) {
        return { category: 'AI', points: 5 };
    }
    return { category: 'Core', points: 3 };
}

/**
 * Records one tool run. Called exactly once per command invocation by
 * registerTrackedCommand, so the same run can never be counted twice.
 */
export async function autoRecordToolUsage(command: string): Promise<void> {
    if (!globalContext) return;
    if (command === `${COMMAND_PREFIX}milestoneTracker`) return;

    const { category, points } = categoryForCommand(command);
    const label = command.replace(COMMAND_PREFIX, '');

    await mutateStats(globalContext, stats => {
        const usedToday = stats.dailyToolUsage[command] || 0;
        stats.dailyToolUsage[command] = usedToday + 1;

        stats.counters.toolRuns += 1;
        if (category === 'Snippets') stats.counters.snippetRuns += 1;
        if (category === 'Security') stats.counters.securityRuns += 1;
        if (category === 'AI') stats.counters.aiRuns += 1;

        const basePoints = usedToday >= RATE_LIMIT_AFTER ? 1 : points;
        const allowance = Math.max(0, DAILY_POINT_CAP - stats.dailyEarnedPoints);
        const awarded = Math.min(basePoints, allowance);

        stats.totalPoints += awarded;
        stats.lifetimePoints += awarded;
        stats.dailyPoints += awarded;
        stats.dailyEarnedPoints += awarded;
        stats.lastActiveDate = getTodayString();
        pushActivity(stats, {
            id: command,
            title: `Tool Use: ${label}`,
            points: awarded,
            timestamp: Date.now(),
            category
        });
        awardMilestones(stats);
    });
}

/** Resets all progress. Used by the tracker's reset button. */
export async function resetUserStats(context: vscode.ExtensionContext): Promise<void> {
    await mutateStats(context, stats => {
        Object.assign(stats, createDefaultStats());
    });
}

export { milestoneProgress, DAILY_POINT_CAP, RATE_LIMIT_AFTER, sanitizeStats, createDefaultStats };

export function getCurrentLevel(totalPoints: number): LevelInfo {
    let current = LEVELS[0];
    for (const lvl of LEVELS) {
        if (totalPoints >= lvl.minPoints) {
            current = lvl;
        } else {
            break;
        }
    }
    return current;
}

function getCurrentLevelName(totalPoints: number): string {
    return getCurrentLevel(totalPoints).name;
}

export function getNextLevel(totalPoints: number): LevelInfo | null {
    for (let i = 0; i < LEVELS.length; i++) {
        if (totalPoints < LEVELS[i].minPoints) {
            return LEVELS[i];
        }
    }
    return null;
}


/**
 * Awards today's login bonus once. Called on activation and whenever the
 * tracker is shown, so a window left open past midnight still gets the new
 * day's bonus. The persisted claim key makes repeat calls (reloads, several
 * windows) harmless.
 */
export async function claimDailyLogin(context: vscode.ExtensionContext): Promise<boolean> {
    const today = getTodayString();
    const { result } = await mutateStats(context, stats => {
        if (stats.dailyClaims[today]) return false;
        stats.dailyClaims[today] = true;
        return true;
    });
    if (result) await recordActivity(context, 'daily_login', 'Daily Login Bonus', DAILY_LOGIN_POINTS, 'Activity');
    return result;
}

/** Claims the once-a-day activity boost. Returns false if it was already claimed today. */
export async function claimDailyBonus(context: vscode.ExtensionContext): Promise<boolean> {
    const key = `${getTodayString()}_bonus`;
    const { result } = await mutateStats(context, stats => {
        if (stats.dailyClaims[key]) return false;
        stats.dailyClaims[key] = true;
        return true;
    });
    if (result) {
        track('daily_bonus_claimed', {});
        await recordActivity(context, 'daily_bonus', 'Claimed Daily Activity Bonus', DAILY_BONUS_POINTS, 'Activity');
    }
    return result;
}

export function buildMilestoneView(context: vscode.ExtensionContext): TrackerView {
    let toolNames: Record<string, string> = {};
    try {
        toolNames = toolNamesFromManifest(context.extension?.packageJSON?.contributes?.commands);
    } catch {
        toolNames = {};
    }
    return buildTrackerView({
        stats: getUserStats(context),
        levels: LEVELS,
        milestones: MILESTONES,
        progress: milestoneProgress,
        today: getTodayString(),
        dailyCap: DAILY_POINT_CAP,
        rateLimitAfter: RATE_LIMIT_AFTER,
        loginPoints: DAILY_LOGIN_POINTS,
        bonusPoints: DAILY_BONUS_POINTS,
        premium: DEVELOPER_FEATURES
            .filter(feature => feature.enabled && feature.tier === 'premium' && (feature.pointCost ?? 0) > 0)
            .map(feature => ({ name: feature.name, pointCost: feature.pointCost as number })),
        toolNames
    });
}

export function registerMilestoneTrackerCommand(context: vscode.ExtensionContext) {
    setMilestoneContext(context);

    void claimDailyLogin(context).catch(error => console.error('DevSnip Pro: daily login bonus failed.', error));

    const command = registerTrackedCommand('sayaib.hue-console.milestoneTracker', () => {
        const { panel, created } = openToolPanel('milestoneTracker', 'DevSnip Pro - Milestones & Points', {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
        });
        if (!created) return;

        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'milestone-tracker.js')));
        setWebviewHtml(panel.webview, getMilestoneTrackerHtml(panel.webview.cspSource, String(scriptUri)));

        let ready = false;
        let pending: NodeJS.Timeout | undefined;
        const post = (message: unknown) => safePostMessage(panel, message);
        const pushState = () => {
            if (!ready) return;
            try {
                post({ type: 'state', view: buildMilestoneView(context) });
            } catch (error) {
                post({ type: 'error', message: `Could not load your progress: ${error instanceof Error ? error.message : String(error)}` });
            }
        };
        // Tools earn points while the panel is open; coalesce bursts into one update.
        const scheduleState = () => {
            if (pending) clearTimeout(pending);
            pending = setTimeout(() => {
                pending = undefined;
                if (panel.visible) pushState();
            }, 150);
        };

        const subscriptions: vscode.Disposable[] = [
            onDidChangePoints(scheduleState),
            panel.onDidChangeViewState(event => {
                if (event.webviewPanel.visible) scheduleState();
            }),
            panel.webview.onDidReceiveMessage(async message => {
                const action = typeof message?.command === 'string' ? message.command : '';
                try {
                    switch (action) {
                        case 'ready':
                            ready = true;
                            // A day may have started since activation.
                            await claimDailyLogin(context);
                            pushState();
                            break;
                        case 'claimBonus': {
                            const claimed = await claimDailyBonus(context);
                            pushState();
                            post({
                                type: 'result', action,
                                ok: claimed,
                                message: claimed ? `+${DAILY_BONUS_POINTS} points added to your balance.` : 'Today\'s bonus is already claimed. Come back tomorrow.'
                            });
                            break;
                        }
                        case 'resetData': {
                            // Webview modals are blocked by the sandbox, so confirmation is a native dialog.
                            const confirmed = await confirmAction(
                                'Reset all DevSnip Pro points, streaks and milestones? This cannot be undone.',
                                'Reset everything'
                            );
                            if (confirmed) await resetUserStats(context);
                            pushState();
                            post({ type: 'result', action, ok: confirmed, message: confirmed ? 'Progress reset.' : 'Nothing was reset.' });
                            break;
                        }
                        case 'openSpend':
                            await executeQueuedCommand(`${COMMAND_PREFIX}premiumStatus`);
                            break;
                        case 'openSearch':
                            await executeQueuedCommand(`${COMMAND_PREFIX}searchTools`);
                            break;
                        case 'refresh':
                            pushState();
                            break;
                    }
                } catch (error) {
                    post({ type: 'result', action, ok: false, message: `That did not work: ${error instanceof Error ? error.message : String(error)}` });
                }
            })
        ];

        panel.onDidDispose(() => {
            if (pending) clearTimeout(pending);
            subscriptions.forEach(subscription => subscription.dispose());
        });
    });

    context.subscriptions.push(command);
}

export function getMilestoneTrackerHtml(cspSource: string, scriptSrc: string): string {
    const icon = (d: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Milestones &amp; Points</title>
    <style>
        ${UTILITY_CSS}
        ${MILESTONE_CSS}
    </style>
</head>
<body>
    <header class="top">
        <div class="top-title">
            <span class="top-icon">${icon("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3")}</span>
            <div class="top-text">
                <h1>Milestones &amp; Points</h1>
                <p>Earn points as you use DevSnip Pro, climb the ranks, and spend them on premium tools.</p>
            </div>
        </div>
        <div class="top-actions">
            <button class="xbtn primary" id="spendBtn" type="button">${icon("M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zM16 14h.01")}<span>Spend points</span></button>
            <div class="more-wrap">
                <button class="xbtn icon" id="moreBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="moreMenu" aria-label="More actions" title="More actions">${icon("M5 12h.01M12 12h.01M19 12h.01").replace('class="ico"', 'class="ico dots-ico"')}</button>
                <div class="menu" id="moreMenu" role="menu" hidden>
                    <button type="button" role="menuitem" class="menu-item" id="howBtn">${icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01")}<span>How points work</span></button>
                    <div class="menu-sep" role="separator"></div>
                    <button type="button" role="menuitem" class="menu-item danger" id="resetBtn">${icon("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5")}<span>Reset progress…</span></button>
                </div>
            </div>
        </div>
    </header>
    <main class="page" id="app" aria-busy="true">
        <div class="skeleton" style="height:188px" aria-hidden="true"></div>
        <div class="daily" aria-hidden="true"><div class="skeleton" style="height:112px"></div><div class="skeleton" style="height:112px"></div></div>
        <div class="skeleton" style="height:240px" aria-hidden="true"></div>
        <p class="sr-only" role="status">Loading your progress...</p>
    </main>
    <div class="celebrate" id="celebrate" role="status" aria-live="polite"><span class="celebrate-badge" id="celebrateBadge"></span><span id="celebrateText"></span></div>
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}

/**
 * Styles for the Milestones & Points page. Every colour comes from the theme
 * tokens (UTILITY_CSS and the --ds-* design tokens), so the page follows the
 * DevSnip Pro appearance theme; rank colours are blended with the text colour
 * so near-white ranks (Platinum, Diamond) stay legible in light themes.
 */
const MILESTONE_CSS = `
:root {
    --gold: #e2b33c;
    --gold-text: color-mix(in srgb, var(--gold) 62%, var(--fg-0));
    --streak: #ff8a3d;
    --streak-text: color-mix(in srgb, var(--streak) 70%, var(--fg-0));
    --purple: var(--ds-purple, #b180d7);
    --info: var(--ds-info, #3794ff);
    --danger: var(--ds-danger, #f14c4c);
    --card: var(--bg-1);
    --card-2: color-mix(in srgb, var(--fg-0) 4%, var(--bg-1));
    --line: var(--border);
    --soft: color-mix(in srgb, var(--fg-0) 7%, transparent);
    --r: 12px;
    --ease: cubic-bezier(.2, .8, .2, 1);
}
* { box-sizing: border-box; }
body { overflow-y: auto; margin: 0; }
.ico { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.dots-ico { stroke-width: 3.4; }
.num { font-variant-numeric: tabular-nums; }
.muted { color: var(--fg-1); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
button { font: inherit; }
:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }

/* Buttons */
.xbtn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 32px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg-0); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s, border-color .15s, transform .1s; }
.xbtn:hover { background: var(--card-2); border-color: color-mix(in srgb, var(--fg-0) 22%, transparent); }
.xbtn:active { transform: translateY(1px); }
.xbtn.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.xbtn.primary:hover { background: var(--vscode-button-hoverBackground, var(--accent)); }
.xbtn.gold { background: var(--gold); color: #1d1606; border-color: transparent; }
.xbtn.gold:hover { background: color-mix(in srgb, var(--gold) 88%, #fff); }
.xbtn.icon { width: 32px; padding: 0; }
.xbtn.sm { height: 28px; padding: 0 11px; font-size: 12px; }
.xbtn[disabled] { opacity: .55; cursor: default; transform: none; }
.link { background: none; border: 0; padding: 0; color: var(--vscode-textLink-foreground, var(--info)); font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.link:hover { text-decoration: underline; }
.link .ico { width: 13px; height: 13px; }

/* Header */
.top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 28px; background: color-mix(in srgb, var(--bg-0) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.top-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.top-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: var(--gold-text); background: color-mix(in srgb, var(--gold) 14%, transparent); border: 1px solid color-mix(in srgb, var(--gold) 28%, transparent); flex: none; }
.top-icon .ico { width: 18px; height: 18px; }
.top h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
.top p { margin: 2px 0 0; font-size: 12px; color: var(--fg-1); }
.top-actions { display: flex; gap: 8px; align-items: center; }
.more-wrap { position: relative; }
.menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 200px; padding: 5px; border-radius: 10px; background: var(--vscode-menu-background, var(--card)); color: var(--vscode-menu-foreground, var(--fg-0)); border: 1px solid var(--vscode-menu-border, var(--line)); box-shadow: 0 12px 32px var(--ds-shadow, rgba(0,0,0,.35)); z-index: 30; animation: pop .12s var(--ease); }
.menu-item { display: flex; align-items: center; gap: 9px; width: 100%; height: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 12.5px; cursor: pointer; text-align: left; }
.menu-item:hover, .menu-item:focus-visible { outline: none; background: var(--vscode-menu-selectionBackground, var(--soft)); color: var(--vscode-menu-selectionForeground, inherit); }
.menu-item.danger { color: var(--danger); }
.menu-sep { height: 1px; margin: 4px 2px; background: var(--line); }
@keyframes pop { from { opacity: 0; transform: translateY(-3px); } }

/* Page */
.page { max-width: 1120px; margin: 0 auto; padding: 22px 28px 48px; display: flex; flex-direction: column; gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-1); }
.skeleton { background: linear-gradient(90deg, var(--card), var(--card-2), var(--card)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; border-radius: var(--r); }
@keyframes shimmer { to { background-position: -200% 0; } }

/* Hero */
.hero { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
.hero::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--level-color, var(--gold)) 10%, transparent), transparent 50%); }
.rank { position: relative; display: flex; gap: 24px; align-items: center; padding: 24px; min-width: 0; }
.ring { position: relative; width: 132px; height: 132px; flex: none; }
.ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring-track { stroke: var(--soft); }
.ring-fill { stroke: var(--level-ink); stroke-linecap: round; transition: stroke-dashoffset 1s var(--ease); }
.ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
.ring-badge { font-size: 38px; line-height: 1; filter: drop-shadow(0 3px 6px rgba(0,0,0,.25)); }
.ring-pct { font-size: 12px; font-weight: 700; color: var(--fg-1); font-variant-numeric: tabular-nums; }
.rank-info { min-width: 0; flex: 1; }
.rank-name { margin: 4px 0 2px; font-size: 30px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; color: var(--level-ink); }
.rank-next { font-size: 13px; color: var(--fg-1); }
.rank-next strong { color: var(--fg-0); font-weight: 700; }
.journey { position: relative; display: flex; justify-content: space-between; align-items: center; margin: 18px 4px 6px; height: 18px; }
.journey::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 3px; transform: translateY(-50%); border-radius: 3px; background: var(--soft); }
.journey-fill { position: absolute; left: 0; top: 50%; height: 3px; transform: translateY(-50%); border-radius: 3px; background: linear-gradient(90deg, color-mix(in srgb, var(--level-ink) 55%, transparent), var(--level-ink)); width: 0; transition: width 1s var(--ease); }
.stop { position: relative; z-index: 1; width: 12px; height: 12px; border-radius: 50%; background: var(--card); border: 2px solid var(--soft); }
.stop.achieved { background: var(--level-ink); border-color: var(--level-ink); }
.stop.current { width: 18px; height: 18px; background: var(--card); border: 3px solid var(--level-ink); box-shadow: 0 0 0 4px color-mix(in srgb, var(--level-ink) 22%, transparent); }
.journey-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--fg-1); }
.rank-next .muted { font-variant-numeric: tabular-nums; }
.rank-foot { margin-top: 10px; font-size: 12px; color: var(--fg-1); }

.kpis { position: relative; display: grid; grid-template-rows: repeat(3, auto); border-left: 1px solid var(--line); }
.kpi { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 20px; min-width: 0; }
.kpi + .kpi { border-top: 1px solid var(--line); }
.kpi-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-text, var(--tint)); }
.kpi-icon .ico { width: 18px; height: 18px; }
.kpi-label { font-size: 11.5px; font-weight: 600; color: var(--fg-1); }
.kpi-value { font-size: 22px; font-weight: 800; letter-spacing: -.01em; line-height: 1.15; font-variant-numeric: tabular-nums; }
.kpi-value small { font-size: 12px; font-weight: 600; color: var(--fg-1); margin-left: 3px; }
.kpi-sub { font-size: 12px; color: var(--fg-1); line-height: 1.4; margin-top: 2px; }
.kpi-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.dots { display: flex; gap: 4px; }
.dots i { width: 9px; height: 9px; border-radius: 3px; background: var(--soft); }
.dots i.on { background: var(--streak); }
.dots i.today { box-shadow: 0 0 0 2px color-mix(in srgb, var(--streak) 35%, transparent); }
.bar { height: 6px; background: var(--soft); border-radius: 999px; overflow: hidden; }
.bar > span { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--gold); transition: width .8s var(--ease); }
.bar.success > span { background: var(--success); }
.bar.accent > span { background: var(--accent); }
.kpi .bar { width: 96px; }

/* Daily */
.daily { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.boost { display: flex; align-items: center; gap: 16px; padding: 18px 20px; position: relative; overflow: hidden; }
.boost.ready { border-color: color-mix(in srgb, var(--gold) 45%, var(--line)); background: linear-gradient(120deg, color-mix(in srgb, var(--gold) 13%, var(--card)), var(--card) 70%); }
.boost-icon { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--gold) 16%, transparent); color: var(--gold-text); }
.boost-icon .ico { width: 22px; height: 22px; }
.boost.claimed .boost-icon { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.boost-body { flex: 1; min-width: 0; }
.boost-title { font-size: 14px; font-weight: 700; }
.boost-sub { font-size: 12.5px; color: var(--fg-1); margin-top: 2px; line-height: 1.45; }
.checklist { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 12px; color: var(--fg-1); }
.checklist span { display: inline-flex; align-items: center; gap: 5px; }
.checklist .ico { width: 13px; height: 13px; }
.checklist .ok { color: var(--success); }
.next { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 16px; align-items: center; padding: 18px 20px; }
.next-icon { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: color-mix(in srgb, var(--tint, var(--info)) 14%, transparent); }
.next-title { font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.next-sub { font-size: 12.5px; color: var(--fg-1); margin: 2px 0 10px; }
.next-row { display: flex; align-items: center; gap: 12px; }
.next-row .bar { flex: 1; }

/* Chips */
.chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; background: var(--soft); color: var(--fg-1); font-variant-numeric: tabular-nums; }
.chip.pts { background: color-mix(in srgb, var(--gold) 16%, transparent); color: var(--gold-text); }
.chip.ok { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.chip.accent { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--vscode-textLink-foreground, var(--accent)); }
.chip .ico { width: 12px; height: 12px; stroke-width: 2.4; }

/* Tabs */
.tabs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 8px; scroll-margin-top: 84px; }
.tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; max-width: 100%; }
.tabs::-webkit-scrollbar { display: none; }
.tab { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 13px; border: 0; border-radius: 7px; background: transparent; color: var(--fg-1); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s, color .15s; }
.tab:hover { color: var(--fg-0); }
.tab[aria-selected="true"] { background: var(--card-2); color: var(--fg-0); box-shadow: 0 1px 2px var(--ds-shadow, rgba(0,0,0,.2)), inset 0 0 0 1px var(--line); }
.tab .count { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--soft); color: var(--fg-1); }
.tab[aria-selected="true"] .count { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg-0); }
.panel { padding-top: 4px; }
.panel[hidden] { display: none; }
.filters { display: inline-flex; gap: 4px; }
.filter { height: 28px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--fg-1); font-size: 12px; font-weight: 600; cursor: pointer; }
.filter[aria-pressed="true"] { background: var(--fg-0); color: var(--bg-0); border-color: transparent; }
.summary { font-size: 12px; color: var(--fg-1); margin: 12px 0; display: flex; gap: 14px; flex-wrap: wrap; }
.summary b { color: var(--fg-0); }

/* Milestones */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.ms { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px; transition: border-color .2s, transform .2s, box-shadow .2s; }
.ms:hover { border-color: color-mix(in srgb, var(--fg-0) 22%, var(--line)); transform: translateY(-1px); }
.ms.closest { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.ms-head { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.ms-icon { position: relative; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: color-mix(in srgb, var(--tint) 14%, transparent); }
.ms-check { position: absolute; right: -5px; bottom: -5px; width: 19px; height: 19px; border-radius: 50%; display: grid; place-items: center; background: var(--success); color: var(--ds-on-status, #fff); border: 2px solid var(--card); }
.ms-check .ico { width: 11px; height: 11px; stroke-width: 3; }
.ms-cat { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--tint-text, var(--tint)); }
.ms-title { font-size: 14px; font-weight: 700; margin-top: 1px; }
.ms-desc { font-size: 12.5px; color: var(--fg-1); line-height: 1.45; }
.ms-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--fg-1); }
.ms-foot b { color: var(--fg-0); font-weight: 600; }
.ms .tag { position: absolute; top: -9px; left: 14px; }
.empty { text-align: center; color: var(--fg-1); padding: 40px 16px; font-size: 13px; line-height: 1.6; }
.empty .ico { width: 28px; height: 28px; opacity: .6; display: block; margin: 0 auto 10px; }

/* Levels timeline */
.timeline { padding: 8px 20px; }
.tl { position: relative; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 14px 0; }
.tl::before { content: ""; position: absolute; left: 23px; top: 0; bottom: 0; width: 2px; background: var(--soft); }
.tl:first-child::before { top: 50%; }
.tl:last-child::before { bottom: 50%; }
.tl.achieved::before { background: color-mix(in srgb, var(--success) 55%, transparent); }
.tl-node { position: relative; z-index: 1; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; background: var(--card); border: 2px solid var(--soft); }
.tl.achieved .tl-node { border-color: color-mix(in srgb, var(--success) 70%, transparent); }
.tl.current .tl-node { border: 3px solid var(--lv-ink); box-shadow: 0 0 0 5px color-mix(in srgb, var(--lv-ink) 18%, transparent); }
.tl.locked .tl-node { filter: grayscale(1); opacity: .5; }
.tl-name { font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tl.current .tl-name { color: var(--lv-ink); }
.tl-sub { font-size: 12px; color: var(--fg-1); margin-top: 2px; }
.tl .bar { margin-top: 8px; max-width: 360px; }
.tl-req { text-align: right; font-size: 13px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tl-req small { display: block; font-size: 11.5px; font-weight: 500; color: var(--fg-1); }
.note { font-size: 12.5px; color: var(--fg-1); line-height: 1.55; margin: 0 0 12px; display: flex; gap: 8px; align-items: flex-start; }
.note .ico { margin-top: 2px; color: var(--info); }

/* Activity */
.feed { padding: 6px 20px 14px; }
.day { display: flex; justify-content: space-between; align-items: baseline; margin: 16px 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-1); }
.day:first-child { margin-top: 8px; }
.day span:last-child { letter-spacing: 0; text-transform: none; font-size: 12px; color: var(--gold-text); }
.act { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line); }
.act:last-child { border-bottom: 0; }
.act-icon { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-text, var(--tint)); }
.act-icon .ico { width: 15px; height: 15px; }
.act-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.act-meta { font-size: 11.5px; color: var(--fg-1); }
.act-pts { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.act-pts.plus { color: var(--success); } .act-pts.minus { color: var(--danger); } .act-pts.zero { color: var(--fg-2); }
.more { margin-top: 12px; }

/* Earn */
.rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.rule { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; padding: 14px 16px; }
.rule-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-text, var(--tint)); }
.rule-icon .ico { width: 17px; height: 17px; }
.rule-title { font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.rule-text { font-size: 12px; color: var(--fg-1); line-height: 1.45; margin-top: 3px; }

.error-box { border: 1px solid var(--error); background: var(--error-bg); border-radius: var(--r); padding: 12px 14px; font-size: 13px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }

/* Feedback */
.celebrate { position: fixed; left: 50%; top: 18px; transform: translate(-50%, -200%); opacity: 0; visibility: hidden; z-index: 100; background: var(--card); border: 1px solid var(--gold); border-radius: 999px; padding: 10px 18px 10px 12px; display: flex; align-items: center; gap: 10px; box-shadow: 0 10px 30px var(--ds-shadow, rgba(0,0,0,.35)); font-size: 13px; font-weight: 700; transition: transform .45s cubic-bezier(.2,1.2,.3,1), opacity .3s, visibility .45s; max-width: calc(100vw - 32px); }
.celebrate.show { transform: translate(-50%, 0); opacity: 1; visibility: visible; }
.celebrate-badge { font-size: 22px; }
.pulse { animation: pulse 1.4s ease-out 2; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gold) 55%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
.bump { animation: bump .5s ease-out; }
@keyframes bump { 40% { transform: scale(1.06); } }

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
@media (max-width: 860px) {
    .hero { grid-template-columns: 1fr; }
    .kpis { border-left: 0; border-top: 1px solid var(--line); grid-template-rows: none; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .kpi { grid-template-columns: 1fr; gap: 6px; padding: 14px 16px; }
    .kpi + .kpi { border-top: 0; border-left: 1px solid var(--line); }
    .kpi-side { align-items: flex-start; }
    .daily { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
    .top { padding: 12px 16px; position: static; }
    .top p { display: none; }
    .page { padding: 14px 16px 32px; }
    .rank { flex-direction: column; text-align: center; padding: 20px 16px; }
    .rank-info { width: 100%; }
    .kpis { grid-template-columns: 1fr; }
    .kpi { grid-template-columns: 36px minmax(0, 1fr) auto; }
    .kpi + .kpi { border-left: 0; border-top: 1px solid var(--line); }
    .kpi-side { align-items: flex-end; }
    .boost { flex-wrap: wrap; }
    .boost .xbtn { width: 100%; }
    .grid { grid-template-columns: 1fr; }
    .tl { grid-template-columns: 48px minmax(0, 1fr); }
    .tl-req { grid-column: 2; text-align: left; }
}
`;
