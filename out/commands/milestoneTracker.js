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
exports.registerMilestoneTrackerCommand = exports.getNextLevel = exports.getCurrentLevel = exports.createDefaultStats = exports.sanitizeStats = exports.RATE_LIMIT_AFTER = exports.DAILY_POINT_CAP = exports.milestoneProgress = exports.resetUserStats = exports.autoRecordToolUsage = exports.recordActivity = exports.refundPoints = exports.redeemPoints = exports.saveUserStats = exports.getUserStats = exports.setTreeRefreshCallback = exports.setMilestoneContext = exports.MILESTONES = exports.LEVELS = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
exports.LEVELS = [
    { name: "Bronze", minPoints: 0, color: "#CD7F32", badge: "🥉", rank: "Rank #5 (Novice Developer)", reward: "Basic Snippet Library & Core Tools" },
    { name: "Silver", minPoints: 150, color: "#C0C0C0", badge: "🥈", rank: "Rank #4 (Skilled Coder)", reward: "Advanced Regex, JSON Formatter & Security Audits" },
    { name: "Gold", minPoints: 600, color: "#FFD700", badge: "🥇", rank: "Rank #3 (Senior Engineer)", reward: "AI/ML Hub, Prompt Engineer & RAG Tools" },
    { name: "Platinum", minPoints: 1800, color: "#E5E4E2", badge: "💎", rank: "Rank #2 (Principal Architect)", reward: "Big Data, DevOps Generators & Cloud Audits" },
    { name: "Diamond", minPoints: 4500, color: "#B9F2FF", badge: "👑", rank: "Rank #1 (Elite Innovator)", reward: "DevSnip Pro Master Status & Unlimited Productivity" },
    { name: "Master", minPoints: 10000, color: "#9c27b0", badge: "🔮", rank: "Rank #0.5 (Grand Master)", reward: "Exclusive Expert Utilities & AI Prompt Playground" },
    { name: "Grandmaster", minPoints: 25000, color: "#ff5722", badge: "⚡", rank: "Rank #1 (Global Legend)", reward: "Legendary DevSnip Pro Productivity Icon Status" }
];
exports.MILESTONES = [
    { id: "first_tool", title: "First Tool Execution", description: "Run any DevSnip Pro tool", target: 1, points: 10, category: "Core", icon: "🚀" },
    { id: "tool_explorer", title: "Tool Explorer", description: "Execute tools 25 times", target: 25, points: 50, category: "Core", icon: "🛠️" },
    { id: "power_user", title: "Power Developer", description: "Execute tools 100 times", target: 100, points: 200, category: "Core", icon: "⚡" },
    { id: "snippet_creator", title: "Snippet Creator", description: "Create 10 custom code snippets", target: 10, points: 75, category: "Snippets", icon: "📝" },
    { id: "streak_5", title: "Consistent Coder", description: "Maintain active usage for 5 consecutive days", target: 5, points: 60, category: "Activity", icon: "🔥" },
    { id: "streak_14", title: "Weekly Warrior", description: "Maintain active usage for 14 consecutive days", target: 14, points: 200, category: "Activity", icon: "🌟" },
    { id: "security_audit", title: "Security Sentinel", description: "Run 5 Security or Cloud Audits", target: 5, points: 80, category: "Security", icon: "🛡️" },
    { id: "ai_explorer", title: "AI/ML Enthusiast", description: "Use AI/ML or RAG tools 10 times", target: 10, points: 90, category: "AI", icon: "🤖" },
    { id: "points_5000", title: "Point Tycoon", description: "Accumulate 5,000 total points", target: 5000, points: 500, category: "Milestone", icon: "💰" }
];
let globalContext;
let refreshCallback;
/** Every mutation runs through this queue so concurrent tool runs cannot lose points. */
let stateQueue = Promise.resolve();
/** Points a single day can produce, so levels stay a long-term signal. */
const DAILY_POINT_CAP = 120;
exports.DAILY_POINT_CAP = DAILY_POINT_CAP;
/** After this many runs of the same tool in a day, further runs are worth 1 point. */
const RATE_LIMIT_AFTER = 5;
exports.RATE_LIMIT_AFTER = RATE_LIMIT_AFTER;
/** Daily-claim keys older than this are pruned so global state cannot grow forever. */
const DAILY_CLAIM_HISTORY_DAYS = 60;
const MAX_ACTIVITIES = 100;
const STATE_KEY = 'devsnip_user_stats';
function setMilestoneContext(context) {
    globalContext = context;
}
exports.setMilestoneContext = setMilestoneContext;
function setTreeRefreshCallback(cb) {
    refreshCallback = cb;
}
exports.setTreeRefreshCallback = setTreeRefreshCallback;
/** Local calendar date (YYYY-MM-DD). Using UTC here would roll the day over at the wrong time. */
function getTodayString(date = new Date()) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function daysBetween(fromIsoDate, toIsoDate) {
    const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
    const to = Date.parse(`${toIsoDate}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to))
        return undefined;
    return Math.round((to - from) / 86400000);
}
function createDefaultStats() {
    return {
        totalPoints: 0,
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
exports.createDefaultStats = createDefaultStats;
function toFiniteNumber(value, fallback) {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function toStringArray(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}
function toStringMap(value, coerce) {
    const result = {};
    if (!value || typeof value !== 'object')
        return result;
    for (const [key, entry] of Object.entries(value)) {
        const coerced = coerce(entry);
        if (coerced !== undefined)
            result[key] = coerced;
    }
    return result;
}
/**
 * Rebuilds a usable stats object from whatever is in global state. Data written
 * by an older version, hand-edited state, or a partially written object must
 * never throw or wipe a user's progress - unknown fields are repaired in place.
 */
function sanitizeStats(raw) {
    const defaults = createDefaultStats();
    if (!raw || typeof raw !== 'object')
        return defaults;
    const source = raw;
    const activities = Array.isArray(source.activities)
        ? source.activities
            .filter((entry) => !!entry && typeof entry === 'object')
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
    return {
        totalPoints: Math.max(0, Math.trunc(toFiniteNumber(source.totalPoints, 0))),
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
exports.sanitizeStats = sanitizeStats;
/** Applies the day rollover (streak, daily counters, claim pruning). */
function applyDayRollover(stats) {
    const today = getTodayString();
    if (stats.lastActiveDate === today)
        return false;
    const gap = daysBetween(stats.lastActiveDate, today);
    if (gap === 1)
        stats.streakDays += 1;
    else if (gap === undefined || gap > 1)
        stats.streakDays = 1;
    stats.dailyPoints = 0;
    stats.dailyEarnedPoints = 0;
    stats.lastActiveDate = today;
    stats.dailyToolUsage = {};
    const cutoff = getTodayString(new Date(Date.now() - DAILY_CLAIM_HISTORY_DAYS * 86400000));
    for (const key of Object.keys(stats.dailyClaims)) {
        if (key.slice(0, 10) < cutoff)
            delete stats.dailyClaims[key];
    }
    return true;
}
/** Reads a consistent, repaired snapshot of the user's progress. Never throws. */
function getUserStats(context) {
    let stored;
    try {
        stored = context.globalState.get(STATE_KEY);
    }
    catch (error) {
        console.error('DevSnip Pro: unable to read milestone state.', error);
        stored = undefined;
    }
    const stats = sanitizeStats(stored);
    applyDayRollover(stats);
    return stats;
}
exports.getUserStats = getUserStats;
async function saveUserStats(context, stats) {
    try {
        await context.globalState.update(STATE_KEY, stats);
    }
    catch (error) {
        console.error('DevSnip Pro: unable to save milestone state.', error);
    }
}
exports.saveUserStats = saveUserStats;
/**
 * Serialised read-modify-write. Two tools finishing at the same moment would
 * otherwise both read the same snapshot and one update would be lost.
 */
function mutateStats(context, mutate) {
    const next = stateQueue.then(async () => {
        const stats = getUserStats(context);
        const result = mutate(stats);
        await saveUserStats(context, stats);
        if (refreshCallback)
            refreshCallback();
        return { stats, result };
    });
    stateQueue = next.catch(() => undefined);
    return next;
}
async function redeemPoints(context, cost, reason) {
    const amount = Math.max(0, Math.trunc(toFiniteNumber(cost, 0)));
    const { result } = await mutateStats(context, stats => {
        if (stats.totalPoints < amount)
            return false;
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
exports.redeemPoints = redeemPoints;
/** Returns points that were spent but whose work failed, so nothing is silently lost. */
async function refundPoints(context, amount, reason) {
    const points = Math.max(0, Math.trunc(toFiniteNumber(amount, 0)));
    if (!points)
        return;
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
exports.refundPoints = refundPoints;
function pushActivity(stats, activity) {
    stats.activities.unshift(activity);
    if (stats.activities.length > MAX_ACTIVITIES) {
        stats.activities = stats.activities.slice(0, MAX_ACTIVITIES);
    }
}
function milestoneProgress(stats, milestoneId) {
    switch (milestoneId) {
        case 'first_tool': return Math.min(stats.counters.toolRuns, 1);
        case 'tool_explorer':
        case 'power_user': return stats.counters.toolRuns;
        case 'snippet_creator': return stats.counters.snippetRuns;
        case 'streak_5':
        case 'streak_14': return stats.streakDays;
        case 'security_audit': return stats.counters.securityRuns;
        case 'ai_explorer': return stats.counters.aiRuns;
        case 'points_5000': return stats.totalPoints;
        default: return 0;
    }
}
exports.milestoneProgress = milestoneProgress;
/** Awards any milestone whose target is now met. Returns the newly unlocked titles. */
function awardMilestones(stats) {
    const unlocked = [];
    for (const milestone of exports.MILESTONES) {
        if (stats.completedMilestones.includes(milestone.id))
            continue;
        if (milestoneProgress(stats, milestone.id) < milestone.target)
            continue;
        stats.completedMilestones.push(milestone.id);
        stats.totalPoints += milestone.points;
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
async function recordActivity(context, activityId, title, points, category) {
    const { stats, result } = await mutateStats(context, current => {
        const before = getCurrentLevelName(current.totalPoints);
        const allowance = Math.max(0, DAILY_POINT_CAP - current.dailyEarnedPoints);
        const awarded = Math.min(Math.max(0, Math.trunc(toFiniteNumber(points, 0))), allowance);
        current.totalPoints += awarded;
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
        return { newMilestones, levelUp: before !== getCurrentLevelName(current.totalPoints) };
    });
    return { stats, newMilestones: result.newMilestones, levelUp: result.levelUp };
}
exports.recordActivity = recordActivity;
/** Maps a command id to its points category. */
function categoryForCommand(commandId) {
    const name = commandId.replace(command_registry_1.COMMAND_PREFIX, '');
    if (/snippet/i.test(name))
        return { category: 'Snippets', points: 10 };
    if (/security|audit/i.test(name))
        return { category: 'Security', points: 8 };
    if (/^(ai|ml|rag)|prompt|model|llm|token|embedding|dataset|inference|gpu|chunking|semantic|hallucination/i.test(name)) {
        return { category: 'AI', points: 5 };
    }
    return { category: 'Core', points: 3 };
}
/**
 * Records one tool run. Called exactly once per command invocation by
 * registerTrackedCommand, so the same run can never be counted twice.
 */
async function autoRecordToolUsage(command) {
    if (!globalContext)
        return;
    if (command === `${command_registry_1.COMMAND_PREFIX}milestoneTracker`)
        return;
    const { category, points } = categoryForCommand(command);
    const label = command.replace(command_registry_1.COMMAND_PREFIX, '');
    await mutateStats(globalContext, stats => {
        const usedToday = stats.dailyToolUsage[command] || 0;
        stats.dailyToolUsage[command] = usedToday + 1;
        stats.counters.toolRuns += 1;
        if (category === 'Snippets')
            stats.counters.snippetRuns += 1;
        if (category === 'Security')
            stats.counters.securityRuns += 1;
        if (category === 'AI')
            stats.counters.aiRuns += 1;
        const basePoints = usedToday >= RATE_LIMIT_AFTER ? 1 : points;
        const allowance = Math.max(0, DAILY_POINT_CAP - stats.dailyEarnedPoints);
        const awarded = Math.min(basePoints, allowance);
        stats.totalPoints += awarded;
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
exports.autoRecordToolUsage = autoRecordToolUsage;
/** Resets all progress. Used by the tracker's reset button. */
async function resetUserStats(context) {
    await mutateStats(context, stats => {
        Object.assign(stats, createDefaultStats());
    });
}
exports.resetUserStats = resetUserStats;
function getCurrentLevel(totalPoints) {
    let current = exports.LEVELS[0];
    for (const lvl of exports.LEVELS) {
        if (totalPoints >= lvl.minPoints) {
            current = lvl;
        }
        else {
            break;
        }
    }
    return current;
}
exports.getCurrentLevel = getCurrentLevel;
function getCurrentLevelName(totalPoints) {
    return getCurrentLevel(totalPoints).name;
}
function getNextLevel(totalPoints) {
    for (let i = 0; i < exports.LEVELS.length; i++) {
        if (totalPoints < exports.LEVELS[i].minPoints) {
            return exports.LEVELS[i];
        }
    }
    return null;
}
exports.getNextLevel = getNextLevel;
function registerMilestoneTrackerCommand(context) {
    setMilestoneContext(context);
    // Award the once-a-day login bonus, guarded by a persisted claim key so a
    // reload (or several windows) cannot award it twice.
    void (async () => {
        try {
            const today = getTodayString();
            const { result } = await mutateStats(context, stats => {
                if (stats.dailyClaims[today])
                    return false;
                stats.dailyClaims[today] = true;
                return true;
            });
            if (result) {
                await recordActivity(context, 'daily_login', 'Daily Login Bonus', 5, 'Activity');
            }
        }
        catch (error) {
            console.error('DevSnip Pro: daily login bonus failed.', error);
        }
    })();
    let activePanel;
    const command = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.milestoneTracker', () => {
        if (activePanel) {
            activePanel.reveal(vscode.ViewColumn.One);
            activePanel.webview.html = getMilestoneTrackerHtml(context);
            return;
        }
        const panel = vscode.window.createWebviewPanel('milestoneTracker', 'DevSnip Pro - Milestone & Points Tracker', vscode.ViewColumn.One, { enableScripts: true });
        activePanel = panel;
        panel.webview.html = getMilestoneTrackerHtml(context);
        const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message?.command) {
                    case 'claimBonus': {
                        const key = `${getTodayString()}_bonus`;
                        const { result: claimed } = await mutateStats(context, stats => {
                            if (stats.dailyClaims[key])
                                return false;
                            stats.dailyClaims[key] = true;
                            return true;
                        });
                        if (!claimed) {
                            vscode.window.showWarningMessage('You have already claimed your daily bonus today.');
                        }
                        else {
                            const res = await recordActivity(context, 'daily_bonus', 'Claimed Daily Activity Bonus', 10, 'Activity');
                            vscode.window.showInformationMessage(`Claimed +10 daily bonus points. Total: ${res.stats.totalPoints} pts.`);
                        }
                        panel.webview.html = getMilestoneTrackerHtml(context);
                        break;
                    }
                    case 'resetData': {
                        // Webview modals (confirm/alert) are blocked by the VS Code
                        // webview sandbox, so the confirmation must be a native dialog.
                        const confirmed = await (0, webview_ui_1.confirmAction)('Reset all DevSnip Pro points, streaks and milestones? This cannot be undone.', 'Reset everything');
                        if (!confirmed)
                            break;
                        await resetUserStats(context);
                        panel.webview.html = getMilestoneTrackerHtml(context);
                        vscode.window.showInformationMessage('Milestone and points data reset.');
                        break;
                    }
                    case 'refresh': {
                        panel.webview.html = getMilestoneTrackerHtml(context);
                        break;
                    }
                }
            }
            catch (error) {
                vscode.window.showErrorMessage(`Milestone tracker action failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        panel.onDidDispose(() => {
            messageSubscription.dispose();
            if (activePanel === panel)
                activePanel = undefined;
        });
    });
    context.subscriptions.push(command);
}
exports.registerMilestoneTrackerCommand = registerMilestoneTrackerCommand;
function getMilestoneTrackerHtml(context) {
    const stats = getUserStats(context);
    const currentLevel = getCurrentLevel(stats.totalPoints);
    const nextLevel = getNextLevel(stats.totalPoints);
    let progressPercent = 100;
    let pointsNeeded = 0;
    if (nextLevel) {
        const prevMin = currentLevel.minPoints;
        const nextMin = nextLevel.minPoints;
        const span = nextMin - prevMin;
        const currentProgress = stats.totalPoints - prevMin;
        progressPercent = Math.min(100, Math.max(0, Math.round((currentProgress / span) * 100)));
        pointsNeeded = nextMin - stats.totalPoints;
    }
    const today = getTodayString();
    const canClaimBonus = !stats.dailyClaims[today + '_bonus'];
    const milestonesHtml = exports.MILESTONES.map(m => {
        const completed = stats.completedMilestones.includes(m.id);
        const currentCount = completed ? m.target : milestoneProgress(stats, m.id);
        const pct = Math.min(100, Math.round((currentCount / m.target) * 100));
        return `
            <div class="milestone-card ${completed ? 'completed' : ''}">
                <div class="milestone-icon">${(0, webview_ui_1.escapeHtml)(m.icon)}</div>
                <div class="milestone-info">
                    <div class="milestone-title">${(0, webview_ui_1.escapeHtml)(m.title)} ${completed ? '✓' : ''}</div>
                    <div class="milestone-desc">${(0, webview_ui_1.escapeHtml)(m.description)}</div>
                    <div class="progress-bar-container" style="margin-top: 8px;">
                        <div class="progress-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                    <div style="font-size: 11px; color: var(--fg-1); margin-top: 4px; display: flex; justify-content: space-between;">
                        <span>Progress: ${Math.min(currentCount, m.target)} / ${m.target}</span>
                        <span style="font-weight: 700; color: var(--accent);">+${m.points} pts</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    const activitiesHtml = stats.activities.length === 0 ?
        '<div style="text-align: center; color: var(--fg-1); padding: 20px;">No activities recorded yet. Start using DevSnip Pro tools to earn points!</div>' :
        stats.activities.map(a => {
            const dateStr = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
            return `
                <div class="activity-item">
                    <div>
                        <div class="activity-title">${(0, webview_ui_1.escapeHtml)(a.title)}</div>
                        <div class="activity-time">${(0, webview_ui_1.escapeHtml)(dateStr)} • <span style="color: var(--accent);">${(0, webview_ui_1.escapeHtml)(a.category)}</span></div>
                    </div>
                    <div class="activity-points">${a.points >= 0 ? '+' : ''}${a.points} pts</div>
                </div>
            `;
        }).join('');
    const rewardsHtml = exports.LEVELS.map(lvl => {
        const unlocked = stats.totalPoints >= lvl.minPoints;
        return `
            <div class="reward-card ${unlocked ? 'unlocked' : 'locked'}">
                <div style="font-size: 28px; margin-bottom: 8px;">${(0, webview_ui_1.escapeHtml)(lvl.badge)}</div>
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">${(0, webview_ui_1.escapeHtml)(lvl.name)} Level</div>
                <div style="font-size: 11px; color: var(--fg-1); margin-bottom: 4px;">${(0, webview_ui_1.escapeHtml)(lvl.rank)}</div>
                <div style="font-size: 11px; color: var(--fg-1); margin-bottom: 8px;">Requirement: ${lvl.minPoints} pts</div>
                <div style="font-size: 12px; font-weight: 600; color: ${unlocked ? 'var(--success)' : 'var(--fg-2)'};">
                    ${unlocked ? '✓ Unlocked: ' + (0, webview_ui_1.escapeHtml)(lvl.reward) : '🔒 Locked: ' + (0, webview_ui_1.escapeHtml)(lvl.reward)}
                </div>
            </div>
        `;
    }).join('');
    const nonce = (0, webview_ui_1.getNonce)();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Milestone Tracker & Points System</title>
    <style>
        :root {
            --bg-0: var(--vscode-editor-background);
            --bg-1: var(--vscode-sideBar-background);
            --bg-2: var(--vscode-input-background);
            --bg-3: var(--vscode-textCodeBlock-background);
            --fg-0: var(--vscode-editor-foreground);
            --fg-1: var(--vscode-descriptionForeground);
            --fg-2: var(--vscode-disabledForeground);
            --border: var(--vscode-input-border);
            --border-focus: var(--vscode-focusBorder);
            --accent: var(--vscode-button-background);
            --accent-fg: var(--vscode-button-foreground);
            --success: #4caf50;
            --success-bg: rgba(76, 175, 80, 0.15);
            --warning: #ff9800;
            --radius-md: 8px;
            --radius-lg: 12px;
            --shadow: 0 4px 12px rgba(0,0,0,0.3);
            --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--sans); background: var(--bg-0); color: var(--fg-0); padding: 0; }
        .header {
            background: var(--bg-1);
            border-bottom: 1px solid var(--border);
            padding: 20px 24px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .header h1 { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .stats-banner {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;
            padding: 20px 24px; max-width: 1200px; margin: 0 auto;
        }
        .stat-card {
            background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 16px; display: flex; flex-direction: column; gap: 4px; box-shadow: var(--shadow);
        }
        .stat-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--fg-1); letter-spacing: 0.5px; }
        .stat-value { font-size: 22px; font-weight: 800; color: var(--accent); }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 0 24px 30px; }
        .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
        .tab {
            padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--fg-1);
            border-bottom: 2px solid transparent; transition: all 0.2s; text-align: left;
        }
        .tab.active { color: var(--fg-0); border-bottom-color: var(--accent); background: var(--bg-1); border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .section-box { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 20px; }
        .section-title { font-size: 14px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; text-align: left; }

        .progress-bar-container { width: 100%; height: 10px; background: var(--bg-2); border-radius: 5px; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #4caf50); border-radius: 5px; transition: width 0.4s ease; }

        .milestones-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
        .milestone-card {
            background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 16px; display: flex; gap: 14px; align-items: flex-start; transition: transform 0.2s; text-align: left;
        }
        .milestone-card.completed { border-color: var(--success); background: var(--success-bg); }
        .milestone-icon { font-size: 28px; background: var(--bg-1); padding: 8px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; }
        .milestone-info { flex: 1; text-align: left; }
        .milestone-title { font-size: 13px; font-weight: 700; margin-bottom: 2px; text-align: left; }
        .milestone-desc { font-size: 11px; color: var(--fg-1); line-height: 1.4; text-align: left; }

        .activity-list { display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
        .activity-item {
            background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; text-align: left;
        }
        .activity-title { font-size: 13px; font-weight: 600; text-align: left; }
        .activity-time { font-size: 11px; color: var(--fg-1); text-align: left; }
        .activity-points { font-size: 14px; font-weight: 700; color: var(--success); text-align: left; }

        .rewards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
        .reward-card {
            background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 20px; text-align: left; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
        }
        .reward-card.unlocked { border-color: var(--success); background: var(--success-bg); }

        .btn {
            background: var(--accent); color: var(--accent-fg); border: none; padding: 8px 16px;
            font-size: 12px; font-weight: 600; border-radius: var(--radius-md); cursor: pointer; transition: opacity 0.2s;
            text-align: left; display: inline-flex; align-items: center; gap: 6px;
        }
        .btn:hover { opacity: 0.85; }
        .btn-secondary { background: var(--bg-2); color: var(--fg-0); border: 1px solid var(--border); text-align: left; }
    </style>
</head>
<body>
    <div class="header" style="text-align: left;">
        <h1 style="text-align: left;">🏆 DevSnip Pro Milestone & Points Tracker</h1>
        <button class="btn btn-secondary" id="resetDataBtn">Reset Data</button>
    </div>

    <div class="stats-banner">
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Current Level & Rank</span>
            <span class="stat-value" style="color: ${currentLevel.color}; font-size: 18px; text-align: left;">${currentLevel.badge} ${currentLevel.name}</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">${currentLevel.rank}</span>
        </div>
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Total Points</span>
            <span class="stat-value" style="text-align: left;">${stats.totalPoints} pts</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">Accumulated Score</span>
        </div>
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Next Level Target</span>
            <span class="stat-value" style="color: var(--warning); text-align: left;">${nextLevel ? pointsNeeded + ' pts' : 'Max Level'}</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">${nextLevel ? 'To reach ' + nextLevel.name : 'All Tiers Unlocked'}</span>
        </div>
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Active Streak</span>
            <span class="stat-value" style="color: #ff9800; text-align: left;">🔥 ${stats.streakDays} Days</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">Daily Usage Tracking</span>
        </div>
    </div>

    <div class="container">
        <div class="section-box" style="text-align: left;">
            <div class="section-title">
                <span style="text-align: left;">Progress toward ${nextLevel ? nextLevel.name + ' (' + nextLevel.minPoints + ' pts)' : 'Maximum Tier'}</span>
                <span style="text-align: right;">${nextLevel ? pointsNeeded + ' pts required' : '100% Completed'}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div style="font-size: 11px; color: var(--fg-1); margin-top: 6px; display: flex; justify-content: space-between; text-align: left;">
                <span>${currentLevel.name} (${currentLevel.minPoints} pts)</span>
                <span>${progressPercent}% Complete</span>
                <span>${nextLevel ? nextLevel.name + ' (' + nextLevel.minPoints + ' pts)' : 'Grandmaster (25000+ pts)'}</span>
            </div>
        </div>

        <div class="tabs" style="text-align: left;">
            <div class="tab active" data-tab="overview">Overview & Quests</div>
            <div class="tab" data-tab="milestones">Milestones (${stats.completedMilestones.length}/${exports.MILESTONES.length})</div>
            <div class="tab" data-tab="activities">Activity Feed</div>
            <div class="tab" data-tab="rewards">Tiers & Leaderboard Rank</div>
        </div>

        <div id="overview" class="tab-content active" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Daily Activity & Quests</span></div>
                <div style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
                    <div class="activity-item" style="text-align: left;">
                        <div style="text-align: left;">
                            <div class="activity-title" style="text-align: left;">Daily Login Bonus</div>
                            <div class="activity-time" style="text-align: left;">Awarded automatically upon opening DevSnip Pro today</div>
                        </div>
                        <div style="font-weight: 700; color: var(--success); text-align: right;">+5 pts Claimed ✓</div>
                    </div>
                    <div class="activity-item" style="text-align: left;">
                        <div style="text-align: left;">
                            <div class="activity-title" style="text-align: left;">Daily Activity Boost (+10 pts)</div>
                            <div class="activity-time" style="text-align: left;">Claim your daily productivity bonus for consistent usage</div>
                        </div>
                        <div style="text-align: right;">
                            ${canClaimBonus ?
        `<button class="btn" id="claimBonusBtn">Claim Bonus</button>` :
        `<span style="font-weight: 700; color: var(--success);">Claimed ✓</span>`}
                        </div>
                    </div>
                </div>
            </div>
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Balanced Points & Progression System</span></div>
                <div style="font-size: 13px; color: var(--fg-1); display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; line-height: 1.5; text-align: left;">
                    <div style="text-align: left;">🚀 <b>Core Tools:</b> +3 pts per tool usage (Rate-limited after 5x/day)</div>
                    <div style="text-align: left;">📝 <b>Custom Snippets:</b> +10 pts per snippet created</div>
                    <div style="text-align: left;">🛡️ <b>Security Audits:</b> +8 pts per security check</div>
                    <div style="text-align: left;">🤖 <b>AI/ML & RAG Tools:</b> +5 pts per AI tool run</div>
                    <div style="text-align: left;">🔥 <b>Consistent Usage:</b> Requires regular daily activity for higher tiers</div>
                    <div style="text-align: left;">🏆 <b>Milestones:</b> +10 to +500 bonus points</div>
                </div>
            </div>
        </div>

        <div id="milestones" class="tab-content" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Milestones & Achievements</span></div>
                <div class="milestones-grid">
                    ${milestonesHtml}
                </div>
            </div>
        </div>

        <div id="activities" class="tab-content" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Recent Activity Log</span></div>
                <div class="activity-list">
                    ${activitiesHtml}
                </div>
            </div>
        </div>

        <div id="rewards" class="tab-content" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Tiers, Leaderboard Ranking & Progression</span></div>
                <div class="rewards-grid">
                    ${rewardsHtml}
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        document.querySelectorAll('.tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
                document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
                e.currentTarget.classList.add('active');
                var tabId = e.currentTarget.getAttribute('data-tab');
                var content = document.getElementById(tabId);
                if (content) { content.classList.add('active'); }
            });
        });

        var claimBtn = document.getElementById('claimBonusBtn');
        if (claimBtn) {
            claimBtn.addEventListener('click', function() {
                vscode.postMessage({ command: 'claimBonus' });
            });
        }

        var resetBtn = document.getElementById('resetDataBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                // VS Code webviews are sandboxed without modals, so confirmation
                // happens in the extension host with a native dialog.
                vscode.postMessage({ command: 'resetData' });
            });
        }

        // Keep the selected tab across re-renders (claim/reset re-render the page).
        var saved = vscode.getState() || {};
        if (saved.tab) {
            var savedTab = document.querySelector('.tab[data-tab="' + saved.tab + '"]');
            if (savedTab) savedTab.click();
        }
        document.querySelectorAll('.tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                vscode.setState({ tab: e.currentTarget.getAttribute('data-tab') });
            });
        });
    </script>
</body>
</html>`;
}
//# sourceMappingURL=milestoneTracker.js.map