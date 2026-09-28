import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import { executeQueuedCommand } from "../utils/command-dispatch";
import { UTILITY_CSS, confirmAction, openToolPanel, safePostMessage } from "../utils/webview-ui";
import { DEVELOPER_FEATURES } from "../premium/feature-registry";
import { TrackerView, buildTrackerView, toolNamesFromManifest } from "../services/milestone-view";

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
}

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
    { id: "points_5000", title: "Point Tycoon", description: "Earn 5,000 points in total", target: 5000, points: 500, category: "Milestone", icon: "💰" }
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
        counters: { toolRuns: 0, snippetRuns: 0, securityRuns: 0, aiRuns: 0 }
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
        counters
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
        const result = mutate(stats);
        await saveUserStats(context, stats);
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
    if (result) await recordActivity(context, 'daily_bonus', 'Claimed Daily Activity Bonus', DAILY_BONUS_POINTS, 'Activity');
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
        panel.webview.html = getMilestoneTrackerHtml(panel.webview.cspSource, String(scriptUri));

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
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Milestones &amp; Points</title>
    <style>
        ${UTILITY_CSS}
        :root { --gold: #e2b33c; --streak: #ff8a3d; --purple: #b180d7; --danger: var(--vscode-errorForeground, #f14c4c); --ring: 132px; }
        body { overflow-y: auto; }
        .tool-header { flex-wrap: wrap; row-gap: 8px; }
        .tool-header .spacer { flex: 1; }
        .tool-body { max-width: 1160px; display: flex; flex-direction: column; gap: 16px; }
        .btn:focus-visible, .tab:focus-visible, .chip-btn:focus-visible, .link-btn:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
        .btn[disabled] { opacity: .5; cursor: default; transform: none; }
        .btn-danger-ghost { background: transparent; color: var(--danger); border: 1px solid var(--border); }
        .btn-danger-ghost:hover { background: var(--error-bg); }
        .card { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; }
        .card-title { font-size: 11px; font-weight: 700; color: var(--fg-1); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .muted { color: var(--fg-1); }
        .num { font-variant-numeric: tabular-nums; }

        /* Hero */
        .hero { display: grid; grid-template-columns: minmax(300px, 1.1fr) minmax(0, 1.4fr); gap: 16px; }
        .level-card { display: flex; gap: 20px; align-items: center; position: relative; overflow: hidden; }
        .level-card::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 18% 50%, var(--level-glow, transparent), transparent 60%); opacity: .22; pointer-events: none; }
        .ring { position: relative; width: var(--ring); height: var(--ring); flex: none; }
        .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
        .ring-track { stroke: var(--bg-3); }
        .ring-fill { stroke: color-mix(in srgb, var(--level-color, var(--accent)) 82%, var(--fg-0)); stroke-linecap: round; transition: stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1); }
        .ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
        .ring-badge { font-size: 34px; line-height: 1; }
        .ring-pct { font-size: 12px; font-weight: 700; color: var(--fg-1); }
        .level-info { min-width: 0; position: relative; }
        .level-kicker { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--fg-1); }
        /* Level colours include near-white Platinum/Diamond, so they are blended with the theme text colour to stay legible in light themes. */
        .level-name { font-size: 24px; font-weight: 800; line-height: 1.2; color: color-mix(in srgb, var(--level-color, var(--fg-0)) 72%, var(--fg-0)); }
        .level-title { font-size: 13px; color: var(--fg-1); margin-bottom: 10px; }
        .level-next { font-size: 13px; line-height: 1.5; }
        .level-next strong { color: var(--fg-0); }
        .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .stat { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .stat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--fg-1); display: flex; align-items: center; gap: 6px; }
        .stat-value { font-size: 24px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
        .stat-value small { font-size: 13px; font-weight: 600; color: var(--fg-1); }
        .stat-sub { font-size: 12px; color: var(--fg-1); line-height: 1.45; }
        .stat .link-btn { align-self: flex-start; margin-top: 2px; }
        .bar { height: 8px; background: var(--bg-3); border-radius: 999px; overflow: hidden; }
        .bar.thin { height: 6px; }
        .bar > span { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--accent); transition: width .6s cubic-bezier(.2,.8,.2,1); }
        .bar.gold > span { background: linear-gradient(90deg, var(--gold), #f5d27a); }
        .bar.success > span { background: var(--success); }
        .bar.streak > span { background: var(--streak); }
        .link-btn { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground, #3794ff); font: inherit; font-size: 12px; cursor: pointer; }
        .link-btn:hover { text-decoration: underline; }

        /* Today */
        .today { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .quest { display: flex; gap: 12px; align-items: center; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px; min-width: 0; }
        .quest.done { border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
        .quest-icon { font-size: 20px; width: 36px; height: 36px; flex: none; display: grid; place-items: center; background: var(--bg-3); border-radius: 50%; }
        .quest-body { flex: 1; min-width: 0; }
        .quest-title { font-size: 13px; font-weight: 700; }
        .quest-sub { font-size: 12px; color: var(--fg-1); line-height: 1.4; }
        .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; background: var(--bg-3); color: var(--fg-1); }
        .pill.ok { background: var(--success-bg); color: var(--success); }
        .pill.pts { background: rgba(226,179,60,.16); color: color-mix(in srgb, var(--gold) 68%, var(--fg-0)); }

        /* Tabs */
        .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
        .tabs::-webkit-scrollbar { display: none; }
        .tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--fg-1); font: inherit; font-size: 13px; font-weight: 600; padding: 10px 14px; cursor: pointer; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
        .tab:hover { color: var(--fg-0); }
        .tab[aria-selected="true"] { color: var(--fg-0); border-bottom-color: var(--accent); }
        .tab .count { font-size: 11px; background: var(--bg-3); border-radius: 999px; padding: 1px 7px; color: var(--fg-1); }
        .panel { padding-top: 16px; }
        .panel[hidden] { display: none; }
        .toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; align-items: center; }
        .chip-btn { background: var(--bg-2); color: var(--fg-1); border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
        .chip-btn[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); border-color: transparent; }

        /* Milestones */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
        .ms { position: relative; display: flex; gap: 14px; background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; transition: border-color .2s, box-shadow .2s; }
        .ms:hover { border-color: color-mix(in srgb, var(--border-focus) 60%, var(--border)); }
        .ms.completed { border-color: color-mix(in srgb, var(--success) 50%, var(--border)); }
        .ms.focus { border-color: var(--border-focus); }
        .ms-icon { font-size: 24px; width: 46px; height: 46px; flex: none; display: grid; place-items: center; background: var(--bg-3); border-radius: 12px; }
        .ms.completed .ms-icon { background: var(--success-bg); }
        .ms:not(.completed) .ms-icon { filter: grayscale(.35); }
        .ms-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
        .ms-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
        .ms-title { font-size: 14px; font-weight: 700; }
        .ms-desc { font-size: 12px; color: var(--fg-1); line-height: 1.45; }
        .ms-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--fg-1); }
        .tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--fg-2); }

        /* Levels */
        .levels { display: flex; flex-direction: column; gap: 0; position: relative; }
        .lv { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 12px 4px; position: relative; }
        .lv + .lv { border-top: 1px solid var(--border); }
        .lv-badge { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; background: var(--bg-3); border: 2px solid transparent; }
        .lv.achieved .lv-badge { border-color: var(--success); }
        .lv.current .lv-badge { border-color: var(--lv-color, var(--accent)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--lv-color, var(--accent)) 22%, transparent); }
        .lv.locked .lv-badge { filter: grayscale(1); opacity: .55; }
        .lv-name { font-weight: 700; font-size: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .lv-sub { font-size: 12px; color: var(--fg-1); }
        .lv-req { font-size: 12px; font-weight: 700; text-align: right; white-space: nowrap; }
        .lv.current { background: color-mix(in srgb, var(--lv-color, var(--accent)) 7%, transparent); border-radius: var(--radius-md); }
        .lv .bar { margin-top: 6px; max-width: 420px; }

        /* Activity */
        .day { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--fg-2); margin: 14px 0 6px; }
        .day:first-child { margin-top: 0; }
        .act { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 8px 4px; border-bottom: 1px solid var(--border); }
        .act-icon { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--bg-3); font-size: 14px; }
        .act-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .act-meta { font-size: 11.5px; color: var(--fg-1); }
        .act-pts { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .act-pts.plus { color: var(--success); } .act-pts.minus { color: var(--danger); } .act-pts.zero { color: var(--fg-2); }
        .more { margin-top: 12px; }

        /* Earn */
        .rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
        .rule { display: flex; gap: 12px; background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; }
        .rule-icon { font-size: 20px; }
        .rule-title { font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; gap: 8px; }
        .rule-text { font-size: 12px; color: var(--fg-1); line-height: 1.45; margin-top: 2px; }
        .note { font-size: 12.5px; color: var(--fg-1); line-height: 1.55; margin-top: 14px; }

        .empty { text-align: center; color: var(--fg-1); padding: 32px 16px; font-size: 13px; line-height: 1.6; }
        .skeleton { background: linear-gradient(90deg, var(--bg-2), var(--bg-3), var(--bg-2)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; border-radius: var(--radius-lg); }
        @keyframes shimmer { to { background-position: -200% 0; } }
        .error-box { border: 1px solid var(--error); background: var(--error-bg); border-radius: var(--radius-md); padding: 12px 14px; font-size: 13px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }

        /* Feedback */
        .celebrate { position: fixed; left: 50%; top: 18px; transform: translate(-50%, -200%); opacity: 0; visibility: hidden; z-index: 100; background: var(--bg-1); border: 1px solid var(--gold); border-radius: 999px; padding: 10px 18px 10px 12px; display: flex; align-items: center; gap: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.35); font-size: 13px; font-weight: 700; transition: transform .45s cubic-bezier(.2,1.2,.3,1), opacity .3s, visibility .45s; max-width: calc(100vw - 32px); }
        .celebrate.show { transform: translate(-50%, 0); opacity: 1; visibility: visible; }
        .celebrate-badge { font-size: 22px; }
        .pulse { animation: pulse 1.4s ease-out 2; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gold) 55%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
        .bump { animation: bump .5s ease-out; }
        @keyframes bump { 40% { transform: scale(1.08); } }
        .toast.info { background: var(--accent); color: var(--accent-fg); }
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
        }
        @media (max-width: 900px) {
            .hero { grid-template-columns: 1fr; }
            .today { grid-template-columns: 1fr; }
        }
        @media (max-width: 520px) {
            :root { --ring: 104px; }
            .tool-header { padding: 12px 16px; position: static; }
            .tool-body { padding: 14px 16px; }
            .stats { grid-template-columns: 1fr 1fr; gap: 8px; }
            .stat { padding: 12px; }
            .stat-value { font-size: 20px; }
            .level-card { gap: 14px; }
            .level-name { font-size: 20px; }
            .grid { grid-template-columns: 1fr; }
            .lv { grid-template-columns: 40px minmax(0, 1fr); }
            .lv-req { grid-column: 2; text-align: left; }
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>🏆 Milestones &amp; Points</h1>
        <span class="subtitle">Earn points by using DevSnip Pro, level up, and spend them on premium tools</span>
        <span class="spacer"></span>
        <button class="btn btn-secondary btn-sm" id="spendBtn" type="button">Spend points</button>
        <button class="btn btn-danger-ghost btn-sm" id="resetBtn" type="button">Reset progress</button>
    </div>
    <main class="tool-body" id="app" aria-busy="true">
        <div class="hero" aria-hidden="true"><div class="skeleton" style="height:170px"></div><div class="skeleton" style="height:170px"></div></div>
        <div class="skeleton" style="height:90px" aria-hidden="true"></div>
        <p class="sr-only" role="status">Loading your progress...</p>
    </main>
    <div class="celebrate" id="celebrate" role="status" aria-live="polite"><span class="celebrate-badge" id="celebrateBadge"></span><span id="celebrateText"></span></div>
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}
