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
exports.markRecapShown = exports.pendingWeeklyRecap = exports.themeLockHints = exports.themeLockFor = exports.grantKeptTheme = exports.lockLabel = exports.tryDailyTip = exports.finishBitSprint = exports.answerDailyQuiz = exports.spinDailyWheel = exports.activitiesWaiting = exports.spinsLeft = exports.rerollDailyQuest = exports.openMysteryBox = exports.equipReward = exports.buyReward = exports.buyStreakFreeze = exports.loginPointsFor = exports.weekStartOf = exports.applyDayRollover = exports.createDefaultStats = exports.sanitizeStats = exports.RATE_LIMIT_AFTER = exports.DAILY_POINT_CAP = exports.milestoneProgress = exports.resetUserStats = exports.autoRecordToolUsage = exports.recordDiscovery = exports.recordActivity = exports.refundPoints = exports.redeemPoints = exports.effectiveUnlocked = exports.setActivityRandom = exports.saveUserStats = exports.getPointsBalance = exports.getUserStats = exports.setTreeRefreshCallback = exports.setMilestoneContext = exports.setCelebrationHandler = exports.REWARD_KIND_LABEL = exports.STREAK_FREEZE_COST = exports.FREEZE_EVERY_DAYS = exports.MAX_STREAK_FREEZES = exports.STREAK_LOGIN_BONUS_MAX = exports.DAILY_BONUS_POINTS = exports.DAILY_LOGIN_POINTS = exports.onDidChangePoints = exports.MILESTONES = exports.LEVELS = exports.DISCOVERIES = void 0;
exports.getMilestoneTrackerHtml = exports.registerMilestoneTrackerCommand = exports.maybeShowWeeklyRecap = exports.showCelebrations = exports.openRedeem = exports.SUPPORT_URL = exports.buildMilestoneView = exports.claimDailyBonus = exports.claimDailyLogin = exports.getNextLevel = exports.getCurrentLevel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const command_registry_1 = require("../utils/command-registry");
const command_dispatch_1 = require("../utils/command-dispatch");
const webview_ui_1 = require("../utils/webview-ui");
const feature_registry_1 = require("../premium/feature-registry");
const milestone_view_1 = require("../services/milestone-view");
const analytics_1 = require("../analytics");
const service_1 = require("../theme/service");
const themes_1 = require("../theme/themes");
const profile_style_1 = require("../services/profile-style");
const activities_1 = require("../services/activities");
const quests_1 = require("../services/quests");
const rewards_1 = require("../services/rewards");
/** The core features the Feature Explorer milestone counts, each recorded once when first really used. */
exports.DISCOVERIES = ["api_request", "ai_tool", "security_scan", "database_connection", "snippet", "opencode"];
/**
 * Every DevSnip Pro tool is available at every level (premium REST client
 * tools are paid for with points, not unlocked by level). Levels unlock
 * cosmetic rewards only - see src/services/rewards.ts - so `reward` names
 * the badge and any theme that comes with it, never a feature.
 */
exports.LEVELS = [
    { name: "Bronze", minPoints: 0, color: "#CD7F32", badge: "🥉", rank: "Novice Developer", reward: "Bronze badge and title in the Tools view" },
    { name: "Silver", minPoints: 150, color: "#C0C0C0", badge: "🥈", rank: "Skilled Coder", reward: "Silver badge and the Solarized theme" },
    { name: "Gold", minPoints: 600, color: "#FFD700", badge: "🥇", rank: "Senior Engineer", reward: "Gold badge and the Synthwave theme" },
    { name: "Platinum", minPoints: 1800, color: "#E5E4E2", badge: "💎", rank: "Principal Architect", reward: "Platinum badge and the Aurora theme" },
    { name: "Diamond", minPoints: 4500, color: "#B9F2FF", badge: "👑", rank: "Elite Innovator", reward: "Diamond badge and title in the Tools view" },
    { name: "Master", minPoints: 10000, color: "#9c27b0", badge: "🔮", rank: "Grand Master", reward: "Master badge and title in the Tools view" },
    { name: "Grandmaster", minPoints: 25000, color: "#ff5722", badge: "⚡", rank: "Global Legend", reward: "Grandmaster badge and title in the Tools view" }
];
exports.MILESTONES = [
    { id: "first_tool", title: "First Tool Execution", description: "Run any DevSnip Pro tool", target: 1, points: 10, category: "Core", icon: "🚀" },
    { id: "tool_explorer", title: "Tool Explorer", description: "Execute tools 25 times", target: 25, points: 50, category: "Core", icon: "🛠️" },
    { id: "power_user", title: "Power Developer", description: "Execute tools 100 times", target: 100, points: 200, category: "Core", icon: "⚡" },
    { id: "snippet_creator", title: "Snippet Creator", description: "Create 10 custom code snippets", target: 10, points: 75, category: "Snippets", icon: "📝" },
    { id: "streak_5", title: "Consistent Coder", description: "Maintain active usage for 5 consecutive days", target: 5, points: 60, category: "Activity", icon: "🔥" },
    { id: "streak_14", title: "Weekly Warrior", description: "Maintain active usage for 14 consecutive days", target: 14, points: 200, category: "Activity", icon: "🌟" },
    { id: "streak_30", title: "Monthly Marathon", description: "Keep a 30-day streak going", target: 30, points: 400, category: "Activity", icon: "🏃" },
    { id: "streak_100", title: "Century Streak", description: "Keep a 100-day streak going", target: 100, points: 1500, category: "Activity", icon: "💯" },
    { id: "quest_master", title: "Quest Master", description: "Finish all of the day's quests on 7 days", target: 7, points: 150, category: "Quests", icon: "🎯" },
    { id: "security_audit", title: "Security Sentinel", description: "Run 5 Security or Cloud Audits", target: 5, points: 80, category: "Security", icon: "🛡️" },
    { id: "ai_explorer", title: "AI/ML Enthusiast", description: "Use AI/ML or RAG tools 10 times", target: 10, points: 90, category: "AI", icon: "🤖" },
    { id: "points_5000", title: "Point Tycoon", description: "Earn 5,000 points in total", target: 5000, points: 500, category: "Milestone", icon: "💰" },
    { id: "feature_explorer", title: "Feature Explorer", description: "Try 5 of: an API request, an AI tool, a security scan, a database, a snippet, OpenCode", target: 5, points: 60, category: "Discovery", icon: "🧭" },
    { id: "quiz_10", title: "Sharp Mind", description: "Answer 10 daily challenges correctly", target: 10, points: 120, category: "Learning", icon: "🧠" },
    { id: "events_3", title: "Event Regular", description: "Complete 3 weekly events", target: 3, points: 150, category: "Events", icon: "🎪" }
];
let globalContext;
let refreshCallback;
/**
 * Fires whenever the stored points change.
 *
 * Premium REST API Client tools are unlocked by spending points, so anything
 * showing a balance or an affordability state needs to know the moment it moves.
 */
const pointsChangeEmitter = new vscode.EventEmitter();
exports.onDidChangePoints = pointsChangeEmitter.event;
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
/** Points for the automatic once-a-day login bonus and the claimable daily boost. */
exports.DAILY_LOGIN_POINTS = 5;
exports.DAILY_BONUS_POINTS = 10;
/** The login bonus grows by a point per streak day, up to this much extra. */
exports.STREAK_LOGIN_BONUS_MAX = 10;
exports.MAX_STREAK_FREEZES = 2;
/** A freeze is earned every this many streak days. */
exports.FREEZE_EVERY_DAYS = 7;
exports.STREAK_FREEZE_COST = 50;
const MAX_TOOLS_TRACKED = 500;
/** How each kind of reward is named in messages. */
exports.REWARD_KIND_LABEL = {
    theme: 'theme', avatar: 'avatar', title: 'title', frame: 'badge frame', banner: 'banner', effect: 'celebration effect'
};
let celebrationHandler;
/** Receives every batch of wins as it is saved. The tracker command installs the notification handler. */
function setCelebrationHandler(handler) {
    celebrationHandler = handler;
}
exports.setCelebrationHandler = setCelebrationHandler;
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
/** The Monday that starts the week of a YYYY-MM-DD date. */
function weekStartOf(isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return getTodayString(date);
}
exports.weekStartOf = weekStartOf;
function addDays(isoDate, days) {
    const [year, month, day] = isoDate.split('-').map(Number);
    return getTodayString(new Date(year, month - 1, day + days));
}
function emptyWeek(weekStart) {
    return { weekStart, points: 0, runs: 0, tools: [] };
}
function sanitizeWeek(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const source = raw;
    if (typeof source.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.weekStart))
        return null;
    const week = {
        weekStart: source.weekStart,
        points: Math.max(0, Math.trunc(toFiniteNumber(source.points, 0))),
        runs: Math.max(0, Math.trunc(toFiniteNumber(source.runs, 0))),
        tools: [...new Set(toStringArray(source.tools))].slice(0, MAX_TOOLS_TRACKED)
    };
    const previous = Math.trunc(toFiniteNumber(source.previousPoints, NaN));
    if (Number.isFinite(previous))
        week.previousPoints = Math.max(0, previous);
    return week;
}
function createPlay(date) {
    return { date, spinsUsed: 0, bonusSpins: 0, lastSpin: null, quizChoice: null, tipTried: false, sprintScore: null, lucky: false };
}
function createEvent(weekStart) {
    return { weekStart, id: (0, activities_1.eventForWeek)(weekStart).id, progress: 0, done: false };
}
function sanitizePlay(raw, today) {
    const fresh = createPlay(today);
    if (!raw || typeof raw !== 'object')
        return fresh;
    const source = raw;
    if (source.date !== today)
        return fresh;
    const count = (value, max) => Math.max(0, Math.min(max, Math.trunc(toFiniteNumber(value, 0))));
    // null means "not yet"; Number(null) would turn it into 0.
    const optional = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : NaN);
    const quizChoice = optional(source.quizChoice);
    const sprintScore = optional(source.sprintScore);
    const lastSpin = optional(source.lastSpin);
    const prize = source.prize && typeof source.prize === 'object' && typeof source.prize.text === 'string' ? source.prize : null;
    return {
        date: today,
        spinsUsed: count(source.spinsUsed, 10),
        bonusSpins: count(source.bonusSpins, 5),
        lastSpin: lastSpin >= 0 && lastSpin < activities_1.WHEEL.length ? lastSpin : null,
        prize: prize ? {
            text: prize.text.slice(0, 80),
            points: count(prize.points, 100),
            ...(typeof prize.rewardId === 'string' && (0, rewards_1.findReward)(prize.rewardId) ? { rewardId: prize.rewardId } : {})
        } : null,
        quizChoice: quizChoice >= 0 && quizChoice < 4 ? quizChoice : null,
        tipTried: source.tipTried === true,
        sprintScore: Number.isFinite(sprintScore) ? Math.max(0, Math.min(activities_1.SPRINT_MAX_SCORE, sprintScore)) : null,
        lucky: source.lucky === true
    };
}
function sanitizeEvent(raw, weekStart) {
    const fresh = createEvent(weekStart);
    if (!raw || typeof raw !== 'object')
        return fresh;
    const source = raw;
    if (source.weekStart !== weekStart || source.id !== fresh.id)
        return fresh;
    const event = (0, activities_1.eventForWeek)(weekStart);
    const progress = Math.max(0, Math.min(event.target, Math.trunc(toFiniteNumber(source.progress, 0))));
    return { weekStart, id: fresh.id, progress, done: source.done === true };
}
function createDefaultStats() {
    const today = getTodayString();
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
        discovered: [],
        quests: (0, quests_1.createDailyQuests)(today),
        perfectQuestDays: 0,
        streakFreezes: 0,
        bestStreak: 1,
        unlocked: [],
        toolsUsed: [],
        weekly: emptyWeek(weekStartOf(today)),
        lastWeek: null,
        lastRecapWeek: '',
        equipped: {},
        play: createPlay(today),
        event: createEvent(weekStartOf(today)),
        quizCorrect: 0,
        quizStreak: 0,
        quizLastCorrect: '',
        eventsWon: 0,
        sprintBest: 0
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
    const streakDays = Math.max(1, Math.trunc(toFiniteNumber(source.streakDays, 1)));
    const today = getTodayString();
    // Versions before quests did not record which tools were used; the log is the best guess.
    const toolsUsed = Array.isArray(source.toolsUsed)
        ? toStringArray(source.toolsUsed)
        : activities.filter(a => a.id.startsWith(command_registry_1.COMMAND_PREFIX)).map(a => a.id);
    return {
        totalPoints,
        lifetimePoints,
        dailyPoints: Math.max(0, Math.trunc(toFiniteNumber(source.dailyPoints, 0))),
        lastActiveDate,
        streakDays,
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
        discovered: [...new Set(toStringArray(source.discovered).filter(id => exports.DISCOVERIES.includes(id)))],
        quests: (0, quests_1.sanitizeQuests)(source.quests, today),
        perfectQuestDays: Math.max(0, Math.trunc(toFiniteNumber(source.perfectQuestDays, 0))),
        streakFreezes: Math.min(exports.MAX_STREAK_FREEZES, Math.max(0, Math.trunc(toFiniteNumber(source.streakFreezes, 0)))),
        bestStreak: Math.max(streakDays, Math.trunc(toFiniteNumber(source.bestStreak, 1))),
        unlocked: [...new Set(toStringArray(source.unlocked).filter(id => !!(0, rewards_1.findReward)(id)))],
        toolsUsed: [...new Set(toolsUsed)].slice(0, MAX_TOOLS_TRACKED),
        weekly: sanitizeWeek(source.weekly) ?? emptyWeek(weekStartOf(today)),
        lastWeek: sanitizeWeek(source.lastWeek),
        lastRecapWeek: typeof source.lastRecapWeek === 'string' ? source.lastRecapWeek : '',
        equipped: (0, rewards_1.sanitizeLoadout)(source.equipped),
        play: sanitizePlay(source.play, today),
        event: sanitizeEvent(source.event, weekStartOf(today)),
        quizCorrect: Math.max(0, Math.trunc(toFiniteNumber(source.quizCorrect, 0))),
        quizStreak: Math.max(0, Math.trunc(toFiniteNumber(source.quizStreak, 0))),
        quizLastCorrect: typeof source.quizLastCorrect === 'string' ? source.quizLastCorrect : '',
        eventsWon: Math.max(0, Math.trunc(toFiniteNumber(source.eventsWon, 0))),
        sprintBest: Math.max(0, Math.min(activities_1.SPRINT_MAX_SCORE, Math.trunc(toFiniteNumber(source.sprintBest, 0))))
    };
}
exports.sanitizeStats = sanitizeStats;
/**
 * Applies the day rollover (streak, freezes, daily counters, quests, the
 * weekly summary, claim pruning). Deterministic from the stored date, so a
 * read that is never saved and the next saved write agree.
 */
function applyDayRollover(stats, today = getTodayString()) {
    const outcome = { rolled: false, freezesUsed: 0, freezeEarned: false };
    if (stats.quests.date !== today)
        stats.quests = (0, quests_1.createDailyQuests)(today);
    if (stats.play.date !== today)
        stats.play = createPlay(today);
    const thisWeek = weekStartOf(today);
    if (stats.event.weekStart !== thisWeek)
        stats.event = createEvent(thisWeek);
    if (stats.lastActiveDate === today)
        return outcome;
    outcome.rolled = true;
    const gap = daysBetween(stats.lastActiveDate, today);
    const missed = gap === undefined ? Infinity : gap - 1;
    if (gap !== undefined && gap >= 1 && missed <= stats.streakFreezes) {
        // Yesterday counted, or every missed day is covered by a freeze.
        if (missed > 0) {
            stats.streakFreezes -= missed;
            outcome.freezesUsed = missed;
            pushActivity(stats, {
                id: 'streak_freeze_used',
                title: missed === 1 ? 'Streak freeze used: your streak survived a missed day' : `${missed} streak freezes used: your streak survived ${missed} missed days`,
                points: 0,
                timestamp: Date.now(),
                category: 'Activity'
            });
        }
        stats.streakDays += 1;
        if (stats.streakDays % exports.FREEZE_EVERY_DAYS === 0 && stats.streakFreezes < exports.MAX_STREAK_FREEZES) {
            stats.streakFreezes += 1;
            outcome.freezeEarned = true;
            pushActivity(stats, {
                id: 'streak_freeze_earned',
                title: `Earned a streak freeze for a ${stats.streakDays}-day streak`,
                points: 0,
                timestamp: Date.now(),
                category: 'Activity'
            });
        }
    }
    else if (gap === undefined || gap > 1) {
        stats.streakDays = 1;
    }
    stats.bestStreak = Math.max(stats.bestStreak, stats.streakDays);
    const week = weekStartOf(today);
    if (stats.weekly.weekStart !== week) {
        const previousWeek = addDays(week, -7);
        if (stats.weekly.weekStart === previousWeek) {
            const before = stats.lastWeek && stats.lastWeek.weekStart === addDays(previousWeek, -7) ? stats.lastWeek.points : 0;
            stats.lastWeek = { ...stats.weekly, previousPoints: before };
        }
        else {
            stats.lastWeek = null;
        }
        stats.weekly = emptyWeek(week);
    }
    stats.dailyPoints = 0;
    stats.dailyEarnedPoints = 0;
    stats.lastActiveDate = today;
    stats.dailyToolUsage = {};
    const cutoff = getTodayString(new Date(Date.now() - DAILY_CLAIM_HISTORY_DAYS * 86400000));
    for (const key of Object.keys(stats.dailyClaims)) {
        if (key.slice(0, 10) < cutoff)
            delete stats.dailyClaims[key];
    }
    return outcome;
}
exports.applyDayRollover = applyDayRollover;
function readStoredStats(context) {
    let stored;
    try {
        stored = context.globalState.get(STATE_KEY);
    }
    catch (error) {
        console.error('DevSnip Pro: unable to read milestone state.', error);
        stored = undefined;
    }
    return sanitizeStats(stored);
}
/** Reads a consistent, repaired snapshot of the user's progress. Never throws. */
function getUserStats(context) {
    const stats = readStoredStats(context);
    applyDayRollover(stats);
    return stats;
}
exports.getUserStats = getUserStats;
/** Current points balance. Never negative, and never throws. */
function getPointsBalance(context) {
    try {
        return Math.max(0, Math.trunc(getUserStats(context).totalPoints));
    }
    catch (error) {
        console.error('DevSnip Pro: could not read the points balance.', error);
        return 0;
    }
}
exports.getPointsBalance = getPointsBalance;
async function saveUserStats(context, stats) {
    try {
        await context.globalState.update(STATE_KEY, stats);
    }
    catch (error) {
        console.error('DevSnip Pro: unable to save milestone state.', error);
    }
}
exports.saveUserStats = saveUserStats;
/** Rewards granted free by grantKeptTheme, announced differently from ones bought or earned. */
const keptRewards = new Set();
const giftSources = new Map();
const GIFT_PREFIX = { box: 'Mystery box: ', chest: 'Weekly chest: ', wheel: 'Lucky spin: ', event: 'Event reward: ' };
/** Random numbers for chance-based rewards (lucky finds). Tests replace it. */
let activityRandom = Math.random;
function setActivityRandom(random) {
    activityRandom = random ?? Math.random;
}
exports.setActivityRandom = setActivityRandom;
/** Rewards the user has, counting ones their progress has earned but no write has recorded yet. */
function effectiveUnlocked(stats) {
    const earned = (0, rewards_1.earnedRewardIds)((0, milestone_view_1.levelIndexFor)(stats.lifetimePoints, exports.LEVELS), stats.completedMilestones);
    return [...new Set([...stats.unlocked, ...earned])];
}
exports.effectiveUnlocked = effectiveUnlocked;
/** Records rewards that progress has earned. */
function syncUnlocks(stats) {
    for (const id of (0, rewards_1.earnedRewardIds)((0, milestone_view_1.levelIndexFor)(stats.lifetimePoints, exports.LEVELS), stats.completedMilestones)) {
        if (!stats.unlocked.includes(id))
            stats.unlocked.push(id);
    }
}
/**
 * Serialised read-modify-write. Two tools finishing at the same moment would
 * otherwise both read the same snapshot and one update would be lost.
 *
 * Every earning path goes through here, so this is also the one place that
 * records unlocks, sends progress events and announces wins.
 */
function mutateStats(context, mutate) {
    const next = stateQueue.then(async () => {
        const stats = readStoredStats(context);
        const rollover = applyDayRollover(stats);
        const levelBefore = (0, milestone_view_1.levelIndexFor)(stats.lifetimePoints, exports.LEVELS);
        const lifetimeBefore = stats.lifetimePoints;
        const milestonesBefore = new Set(stats.completedMilestones);
        const questsBefore = new Set(stats.quests.items.filter(item => item.done).map(item => item.id));
        const chestBefore = stats.quests.chestClaimed;
        const unlockedBefore = new Set(stats.unlocked);
        const eventBefore = stats.event.done;
        const luckyBefore = stats.play.lucky;
        const result = mutate(stats);
        syncUnlocks(stats);
        stats.weekly.points += Math.max(0, stats.lifetimePoints - lifetimeBefore);
        stats.bestStreak = Math.max(stats.bestStreak, stats.streakDays);
        await saveUserStats(context, stats);
        const celebrations = [];
        const levelAfter = (0, milestone_view_1.levelIndexFor)(stats.lifetimePoints, exports.LEVELS);
        if (levelAfter > levelBefore) {
            const level = exports.LEVELS[levelAfter];
            (0, analytics_1.track)('level_reached', { level: level.name, level_index: levelAfter });
            celebrations.push({ kind: 'level', icon: level.badge, text: `Rank up! You are now ${level.name}: ${level.rank}` });
        }
        for (const id of stats.completedMilestones) {
            if (milestonesBefore.has(id))
                continue;
            (0, analytics_1.track)('milestone_unlocked', { milestone: id });
            const milestone = exports.MILESTONES.find(m => m.id === id);
            if (milestone)
                celebrations.push({ kind: 'milestone', icon: milestone.icon, text: `Milestone unlocked: ${milestone.title} (+${milestone.points} pts)` });
        }
        for (const item of stats.quests.items) {
            if (!item.done || questsBefore.has(item.id))
                continue;
            (0, analytics_1.track)('quest_completed', { quest: item.id });
            const quest = (0, quests_1.findQuest)(item.id);
            if (quest)
                celebrations.push({ kind: 'quest', icon: quest.icon, text: `Quest complete: ${quest.title} (+${quest.points} pts)` });
        }
        if (!chestBefore && stats.quests.chestClaimed) {
            (0, analytics_1.track)('quests_all_done', {});
            celebrations.push({ kind: 'chest', icon: '🎁', text: `All of today's quests done: +${quests_1.QUEST_CHEST_POINTS} bonus pts` });
        }
        const earnedNow = new Set((0, rewards_1.earnedRewardIds)(levelAfter, stats.completedMilestones));
        for (const id of stats.unlocked) {
            if (unlockedBefore.has(id))
                continue;
            const reward = (0, rewards_1.findReward)(id);
            if (!reward)
                continue;
            if (keptRewards.delete(id)) {
                // A theme in use when themes became paid: kept free, and already applied.
                (0, analytics_1.track)('reward_unlocked', { reward: id, via: 'kept' });
                celebrations.push({ kind: 'reward', icon: reward.icon, text: `Themes now unlock with points. You keep ${reward.name} for free` });
                continue;
            }
            const gift = giftSources.get(id);
            giftSources.delete(id);
            const via = gift ?? (!earnedNow.has(id) || !reward.unlock ? 'points' : 'level' in reward.unlock ? 'level' : 'milestone');
            (0, analytics_1.track)('reward_unlocked', { reward: id, via });
            celebrations.push({
                kind: 'reward',
                icon: reward.icon,
                text: `${gift ? GIFT_PREFIX[gift] : 'New '}${exports.REWARD_KIND_LABEL[reward.kind]} unlocked: ${reward.name}`,
                themeId: reward.themeId,
                rewardId: (0, rewards_1.isCosmetic)(reward) ? reward.id : undefined
            });
        }
        if (!eventBefore && stats.event.done) {
            const event = (0, activities_1.findEvent)(stats.event.id);
            (0, analytics_1.track)('activity_played', { activity: 'event', points: event?.points ?? 0 });
            if (event)
                celebrations.push({ kind: 'event', icon: event.icon, text: `${event.title} complete! +${event.points} pts` });
        }
        if (!luckyBefore && stats.play.lucky) {
            (0, analytics_1.track)('activity_played', { activity: 'lucky', points: activities_1.LUCKY_POINTS });
            celebrations.push({ kind: 'lucky', icon: '🍀', text: `Lucky find! +${activities_1.LUCKY_POINTS} bonus pts` });
        }
        if (rollover.freezesUsed > 0) {
            (0, analytics_1.track)('streak_freeze', { action: 'used', count: rollover.freezesUsed });
            celebrations.push({ kind: 'freeze', icon: '❄️', text: `A streak freeze saved your ${stats.streakDays - 1}-day streak` });
        }
        if (rollover.freezeEarned) {
            (0, analytics_1.track)('streak_freeze', { action: 'earned', count: 1 });
            celebrations.push({ kind: 'freeze', icon: '❄️', text: `${stats.streakDays}-day streak! You earned a streak freeze` });
        }
        if (refreshCallback)
            refreshCallback();
        pointsChangeEmitter.fire(stats.totalPoints);
        if (celebrations.length && celebrationHandler) {
            try {
                celebrationHandler(celebrations);
            }
            catch (error) {
                console.error('DevSnip Pro: could not announce progress.', error);
            }
        }
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
        if (amount > 0)
            (0, analytics_1.track)('points_spent', { amount });
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
        case 'streak_14':
        case 'streak_30':
        case 'streak_100': return stats.streakDays;
        case 'quest_master': return stats.perfectQuestDays;
        case 'security_audit': return stats.counters.securityRuns;
        case 'ai_explorer': return stats.counters.aiRuns;
        case 'points_5000': return stats.lifetimePoints;
        case 'feature_explorer': return stats.discovered.length;
        case 'quiz_10': return stats.quizCorrect;
        case 'events_3': return stats.eventsWon;
        default: return 0;
    }
}
exports.milestoneProgress = milestoneProgress;
/** Milestone, quest and chest points: one-time rewards the daily cap never swallows. */
function addUncappedPoints(stats, points) {
    stats.totalPoints += points;
    stats.lifetimePoints += points;
    stats.dailyPoints += points;
}
/** Moves today's quests for a tool run and pays for any it completes, plus the all-done chest. */
function awardQuests(stats, run) {
    for (const quest of (0, quests_1.advanceQuests)(stats.quests, run)) {
        addUncappedPoints(stats, quest.points);
        pushActivity(stats, {
            id: `quest_${quest.id}`,
            title: `Quest complete: ${quest.title} (+${quest.points} pts)`,
            points: quest.points,
            timestamp: Date.now(),
            category: 'Quest'
        });
    }
    if (!stats.quests.chestClaimed && (0, quests_1.allQuestsDone)(stats.quests)) {
        stats.quests.chestClaimed = true;
        stats.perfectQuestDays += 1;
        // Finishing every quest also earns a bonus spin of the wheel.
        stats.play.bonusSpins += 1;
        addUncappedPoints(stats, quests_1.QUEST_CHEST_POINTS);
        pushActivity(stats, {
            id: 'quest_chest',
            title: `All quests done today (+${quests_1.QUEST_CHEST_POINTS} pts)`,
            points: quests_1.QUEST_CHEST_POINTS,
            timestamp: Date.now(),
            category: 'Quest'
        });
    }
}
/** Moves this week's event for a tool run and pays out when it is done. */
function advanceEvent(stats, run) {
    if (stats.event.done)
        return;
    const event = (0, activities_1.findEvent)(stats.event.id);
    if (!event)
        return;
    const step = event.step(run);
    if (step <= 0)
        return;
    stats.event.progress = Math.min(event.target, stats.event.progress + step);
    if (stats.event.progress < event.target)
        return;
    stats.event.done = true;
    stats.eventsWon += 1;
    addUncappedPoints(stats, event.points);
    if (!stats.unlocked.includes(event.rewardId) && (0, rewards_1.findReward)(event.rewardId)) {
        stats.unlocked.push(event.rewardId);
        giftSources.set(event.rewardId, 'event');
    }
    pushActivity(stats, {
        id: `event_${event.id}`,
        title: `${event.title} complete (+${event.points} pts)`,
        points: event.points,
        timestamp: Date.now(),
        category: 'Event'
    });
}
/**
 * Gives a random profile reward the user does not own yet, filling an empty
 * slot. Returns undefined when there is nothing left to give.
 */
function grantRandomItem(stats, source, random) {
    const reward = (0, rewards_1.pickMysteryReward)((0, rewards_1.mysteryBoxPool)(effectiveUnlocked(stats)), random);
    if (!reward)
        return undefined;
    stats.unlocked.push(reward.id);
    giftSources.set(reward.id, source);
    if ((0, rewards_1.isCosmetic)(reward) && !stats.equipped[reward.kind])
        stats.equipped[reward.kind] = reward.id;
    return reward;
}
/** Awards any milestone whose target is now met. Returns the newly unlocked titles. */
function awardMilestones(stats) {
    const unlocked = [];
    for (const milestone of exports.MILESTONES) {
        if (stats.completedMilestones.includes(milestone.id))
            continue;
        if (milestoneProgress(stats, milestone.id) < milestone.target)
            continue;
        stats.completedMilestones.push(milestone.id);
        addUncappedPoints(stats, milestone.points);
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
exports.recordActivity = recordActivity;
/**
 * Records the first real use of a core feature (once each). It earns nothing
 * by itself; it counts towards the Feature Explorer milestone.
 */
async function recordDiscovery(context, discovery) {
    if (!exports.DISCOVERIES.includes(discovery))
        return;
    if (getUserStats(context).discovered.includes(discovery))
        return;
    await mutateStats(context, stats => {
        if (stats.discovered.includes(discovery))
            return;
        stats.discovered.push(discovery);
        awardMilestones(stats);
    });
}
exports.recordDiscovery = recordDiscovery;
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
        const firstEver = !stats.toolsUsed.includes(command);
        if (firstEver && stats.toolsUsed.length < MAX_TOOLS_TRACKED)
            stats.toolsUsed.push(command);
        stats.weekly.runs += 1;
        const newThisWeek = !stats.weekly.tools.includes(command);
        if (newThisWeek && stats.weekly.tools.length < MAX_TOOLS_TRACKED)
            stats.weekly.tools.push(command);
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
        const run = { command, category, newToday: usedToday === 0, firstEver, newThisWeek };
        awardQuests(stats, run);
        advanceEvent(stats, run);
        // Now and then a run is a lucky find: a small surprise bonus, at most once a day.
        if (!stats.play.lucky && activityRandom() < activities_1.LUCKY_CHANCE) {
            stats.play.lucky = true;
            addUncappedPoints(stats, activities_1.LUCKY_POINTS);
            pushActivity(stats, { id: 'lucky_find', title: `Lucky find (+${activities_1.LUCKY_POINTS} pts)`, points: activities_1.LUCKY_POINTS, timestamp: Date.now(), category: 'Activity' });
        }
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
/** Today's login bonus: the base plus a point per streak day, capped. */
function loginPointsFor(streakDays) {
    return exports.DAILY_LOGIN_POINTS + Math.min(exports.STREAK_LOGIN_BONUS_MAX, Math.max(0, Math.trunc(streakDays) - 1));
}
exports.loginPointsFor = loginPointsFor;
/** Buys one streak freeze with points. */
async function buyStreakFreeze(context) {
    const { result } = await mutateStats(context, stats => {
        if (stats.streakFreezes >= exports.MAX_STREAK_FREEZES)
            return 'full';
        if (stats.totalPoints < exports.STREAK_FREEZE_COST)
            return 'short';
        stats.totalPoints -= exports.STREAK_FREEZE_COST;
        stats.streakFreezes += 1;
        (0, analytics_1.track)('points_spent', { amount: exports.STREAK_FREEZE_COST });
        (0, analytics_1.track)('streak_freeze', { action: 'bought', count: 1 });
        pushActivity(stats, {
            id: `redeem_freeze_${Date.now()}`,
            title: `Bought a streak freeze (-${exports.STREAK_FREEZE_COST} pts)`,
            points: -exports.STREAK_FREEZE_COST,
            timestamp: Date.now(),
            category: 'Redemption'
        });
        return 'ok';
    });
    return result;
}
exports.buyStreakFreeze = buyStreakFreeze;
/** Unlocks a reward early with points. Rewards without a price can only be earned. */
async function buyReward(context, rewardId) {
    const reward = (0, rewards_1.findReward)(rewardId);
    if (!reward || reward.cost === undefined)
        return 'unknown';
    const cost = reward.cost;
    const { result } = await mutateStats(context, stats => {
        if (effectiveUnlocked(stats).includes(reward.id))
            return 'owned';
        if (stats.totalPoints < cost)
            return 'short';
        stats.totalPoints -= cost;
        stats.unlocked.push(reward.id);
        // Something bought is something the user wants to see straight away.
        if ((0, rewards_1.isCosmetic)(reward))
            stats.equipped[reward.kind] = reward.id;
        (0, analytics_1.track)('points_spent', { amount: cost });
        pushActivity(stats, {
            id: `redeem_reward_${Date.now()}`,
            title: `Unlocked the ${reward.name} ${exports.REWARD_KIND_LABEL[reward.kind]} (-${cost} pts)`,
            points: -cost,
            timestamp: Date.now(),
            category: 'Redemption'
        });
        return 'ok';
    });
    return result;
}
exports.buyReward = buyReward;
/** Wears an owned profile reward in its slot, or clears the slot when `rewardId` is null. */
async function equipReward(context, slot, rewardId) {
    if (!rewards_1.SLOTS.includes(slot))
        return 'unknown';
    const reward = rewardId === null ? null : (0, rewards_1.findReward)(rewardId);
    if (reward === undefined || (reward && reward.kind !== slot))
        return 'unknown';
    const { result } = await mutateStats(context, stats => {
        if (reward && !effectiveUnlocked(stats).includes(reward.id))
            return 'locked';
        stats.equipped[slot] = reward ? reward.id : null;
        (0, analytics_1.track)('reward_equipped', { slot, reward: reward ? reward.id : 'none' });
        return 'ok';
    });
    return result;
}
exports.equipReward = equipReward;
/** Spends points on a random profile reward the user does not own yet. */
async function openMysteryBox(context, random = Math.random) {
    const { result } = await mutateStats(context, stats => {
        const pool = (0, rewards_1.mysteryBoxPool)(effectiveUnlocked(stats));
        if (!pool.length)
            return { outcome: 'empty' };
        if (stats.totalPoints < rewards_1.MYSTERY_BOX_COST)
            return { outcome: 'short' };
        const reward = (0, rewards_1.pickMysteryReward)(pool, random);
        stats.totalPoints -= rewards_1.MYSTERY_BOX_COST;
        stats.unlocked.push(reward.id);
        giftSources.set(reward.id, 'box');
        // Fill an empty slot, but never replace something the user chose.
        if ((0, rewards_1.isCosmetic)(reward) && !stats.equipped[reward.kind])
            stats.equipped[reward.kind] = reward.id;
        (0, analytics_1.track)('points_spent', { amount: rewards_1.MYSTERY_BOX_COST });
        pushActivity(stats, {
            id: `redeem_box_${Date.now()}`,
            title: `Mystery box: the ${reward.name} ${exports.REWARD_KIND_LABEL[reward.kind]} (-${rewards_1.MYSTERY_BOX_COST} pts)`,
            points: -rewards_1.MYSTERY_BOX_COST,
            timestamp: Date.now(),
            category: 'Redemption'
        });
        return { outcome: 'ok', reward };
    });
    return result;
}
exports.openMysteryBox = openMysteryBox;
/** Spends points to swap one of today's unfinished quests for a different one. */
async function rerollDailyQuest(context, questId, random = Math.random) {
    const { result } = await mutateStats(context, stats => {
        const item = stats.quests.items.find(entry => entry.id === questId);
        if (!item)
            return { outcome: 'unknown' };
        if (item.done)
            return { outcome: 'done' };
        if ((stats.quests.rerolls ?? 0) >= quests_1.MAX_REROLLS_PER_DAY)
            return { outcome: 'limit' };
        if (stats.totalPoints < quests_1.QUEST_REROLL_COST)
            return { outcome: 'short' };
        const next = (0, quests_1.rerollQuest)(stats.quests, questId, random);
        if (!next)
            return { outcome: 'unknown' };
        stats.totalPoints -= quests_1.QUEST_REROLL_COST;
        (0, analytics_1.track)('points_spent', { amount: quests_1.QUEST_REROLL_COST });
        (0, analytics_1.track)('quest_rerolled', { quest: next.id });
        pushActivity(stats, {
            id: `redeem_reroll_${Date.now()}`,
            title: `Swapped a quest for ${next.title} (-${quests_1.QUEST_REROLL_COST} pts)`,
            points: -quests_1.QUEST_REROLL_COST,
            timestamp: Date.now(),
            category: 'Redemption'
        });
        return { outcome: 'ok', title: next.title };
    });
    return result;
}
exports.rerollDailyQuest = rerollDailyQuest;
// ---------------------------------------------------------------- daily activities
/** Spins left today: one free spin, plus any bonus spins earned. */
function spinsLeft(stats) {
    return Math.max(0, 1 + stats.play.bonusSpins - stats.play.spinsUsed);
}
exports.spinsLeft = spinsLeft;
/** How many of today's activities are still waiting: spins, challenge, Bit Sprint and tip. */
function activitiesWaiting(stats) {
    return spinsLeft(stats) + (stats.play.quizChoice === null ? 1 : 0) + (stats.play.sprintScore === null ? 1 : 0) + (stats.play.tipTried ? 0 : 1);
}
exports.activitiesWaiting = activitiesWaiting;
/** Spins the daily wheel. The prize is paid at once; a freeze or item that cannot be given pays points instead. */
async function spinDailyWheel(context, random = Math.random) {
    const { result } = await mutateStats(context, stats => {
        if (spinsLeft(stats) <= 0)
            return { outcome: 'used' };
        const index = (0, activities_1.spinWheel)(random);
        const segment = activities_1.WHEEL[index];
        stats.play.spinsUsed += 1;
        stats.play.lastSpin = index;
        let text;
        let points = 0;
        let rewardId;
        if ('points' in segment.prize) {
            points = segment.prize.points;
            text = `+${points} points`;
        }
        else if ('freeze' in segment.prize && stats.streakFreezes < exports.MAX_STREAK_FREEZES) {
            stats.streakFreezes += 1;
            text = 'a streak freeze';
        }
        else if ('item' in segment.prize) {
            const reward = grantRandomItem(stats, 'wheel', random);
            if (reward) {
                text = `the ${reward.name} ${exports.REWARD_KIND_LABEL[reward.kind]}`;
                rewardId = reward.id;
            }
            else {
                points = activities_1.WHEEL_FALLBACK_POINTS;
                text = `+${points} points`;
            }
        }
        else {
            points = activities_1.WHEEL_FALLBACK_POINTS;
            text = `+${points} points (your freezes are full)`;
        }
        if (points)
            addUncappedPoints(stats, points);
        stats.play.prize = { text, points, ...(rewardId ? { rewardId } : {}) };
        (0, analytics_1.track)('activity_played', { activity: 'spin', points });
        pushActivity(stats, { id: 'play_spin', title: `Daily spin: ${text}`, points, timestamp: Date.now(), category: 'Play' });
        return { outcome: 'ok', index, segment, text };
    });
    return result;
}
exports.spinDailyWheel = spinDailyWheel;
/** Answers today's dev challenge, once. A right answer pays more, but trying always pays something. */
async function answerDailyQuiz(context, choice) {
    const picked = Math.trunc(Number(choice));
    const { result } = await mutateStats(context, stats => {
        const question = (0, activities_1.quizForDate)(stats.play.date);
        if (!(picked >= 0 && picked < question.options.length))
            return { outcome: 'invalid' };
        if (stats.play.quizChoice !== null)
            return { outcome: 'answered' };
        stats.play.quizChoice = picked;
        const correct = picked === question.answer;
        const points = correct ? activities_1.QUIZ_CORRECT_POINTS : activities_1.QUIZ_TRY_POINTS;
        addUncappedPoints(stats, points);
        if (correct) {
            stats.quizCorrect += 1;
            stats.quizStreak = stats.quizLastCorrect === addDays(stats.play.date, -1) ? stats.quizStreak + 1 : 1;
            stats.quizLastCorrect = stats.play.date;
        }
        else {
            stats.quizStreak = 0;
        }
        (0, analytics_1.track)('activity_played', { activity: 'quiz', points });
        pushActivity(stats, {
            id: 'play_quiz',
            title: `Daily challenge (${question.category}): ${correct ? 'correct' : 'tried'} (+${points} pts)`,
            points, timestamp: Date.now(), category: 'Play'
        });
        awardMilestones(stats);
        return { outcome: 'ok', correct, points, answer: question.answer, explain: question.explain, streak: stats.quizStreak };
    });
    return result;
}
exports.answerDailyQuiz = answerDailyQuiz;
/** Records a finished Bit Sprint. Only the day's first game pays; later ones are practice for a better best. */
async function finishBitSprint(context, rawScore) {
    const score = Math.max(0, Math.min(activities_1.SPRINT_MAX_SCORE, Math.trunc(Number(rawScore) || 0)));
    const { result } = await mutateStats(context, stats => {
        const paid = stats.play.sprintScore === null;
        const points = paid ? (0, activities_1.sprintPoints)(score) : 0;
        const newBest = score > stats.sprintBest;
        if (newBest)
            stats.sprintBest = score;
        if (paid) {
            stats.play.sprintScore = score;
            if (points)
                addUncappedPoints(stats, points);
            (0, analytics_1.track)('activity_played', { activity: 'sprint', points });
            pushActivity(stats, { id: 'play_sprint', title: `Bit Sprint: ${score} correct (+${points} pts)`, points, timestamp: Date.now(), category: 'Play' });
        }
        return { outcome: 'ok', points, score, best: stats.sprintBest, newBest, paid };
    });
    return result;
}
exports.finishBitSprint = finishBitSprint;
/** Pays the tip-of-the-day bonus once and returns the tip, so its tool can be opened. */
async function tryDailyTip(context) {
    const { result } = await mutateStats(context, stats => {
        const tip = (0, activities_1.tipForDate)(stats.play.date);
        if (stats.play.tipTried)
            return { command: tip.command, points: 0 };
        stats.play.tipTried = true;
        addUncappedPoints(stats, activities_1.TIP_POINTS);
        (0, analytics_1.track)('activity_played', { activity: 'tip', points: activities_1.TIP_POINTS });
        pushActivity(stats, { id: 'play_tip', title: `Tip of the day: ${tip.title} (+${activities_1.TIP_POINTS} pts)`, points: activities_1.TIP_POINTS, timestamp: Date.now(), category: 'Play' });
        return { command: tip.command, points: activities_1.TIP_POINTS };
    });
    return result;
}
exports.tryDailyTip = tryDailyTip;
/** Short text for a locked theme: "150 pts" or "Reach Gold or 500 pts". */
function lockLabel(lock) {
    const price = lock.cost !== undefined ? `${lock.cost.toLocaleString('en-US')} pts` : '';
    return lock.hint ? (price ? `${lock.hint} or ${price}` : lock.hint) : price || 'Locked';
}
exports.lockLabel = lockLabel;
/**
 * Gives a theme for free. Used once, when themes became paid, so a theme the
 * user had already chosen is not taken away.
 */
async function grantKeptTheme(context, themeId) {
    const reward = (0, rewards_1.rewardForTheme)(themeId);
    if (!reward)
        return;
    await mutateStats(context, stats => {
        if (effectiveUnlocked(stats).includes(reward.id))
            return;
        keptRewards.add(reward.id);
        stats.unlocked.push(reward.id);
        pushActivity(stats, {
            id: `kept_${reward.id}`,
            title: `Kept the ${reward.name} theme for free`,
            points: 0,
            timestamp: Date.now(),
            category: 'Activity'
        });
    });
}
exports.grantKeptTheme = grantKeptTheme;
function rewardHint(reward) {
    return (0, rewards_1.unlockLabel)(reward, index => exports.LEVELS[index]?.name ?? `level ${index + 1}`, id => exports.MILESTONES.find(m => m.id === id)?.title ?? id, id => (0, activities_1.findEvent)(id)?.title ?? id);
}
/** Why a theme is locked, or undefined when it can be used. */
function themeLockFor(stats, themeId) {
    const reward = (0, rewards_1.rewardForTheme)(themeId);
    if (!reward || effectiveUnlocked(stats).includes(reward.id))
        return undefined;
    return { rewardId: reward.id, name: reward.name, hint: rewardHint(reward) ?? undefined, cost: reward.cost, balance: stats.totalPoints };
}
exports.themeLockFor = themeLockFor;
/** themeId -> how to unlock it ("150 pts", "Reach Gold or 500 pts"), for every theme still locked. */
function themeLockHints(stats) {
    const hints = {};
    for (const reward of rewards_1.REWARDS) {
        if (reward.kind !== 'theme' || !reward.themeId)
            continue;
        const lock = themeLockFor(stats, reward.themeId);
        if (lock)
            hints[reward.themeId] = lockLabel(lock);
    }
    return hints;
}
exports.themeLockHints = themeLockHints;
/** Last week's summary when it has not been shown yet and there is something to show. */
function pendingWeeklyRecap(stats) {
    const last = stats.lastWeek;
    if (!last || last.runs === 0 || stats.lastRecapWeek === last.weekStart)
        return null;
    return last;
}
exports.pendingWeeklyRecap = pendingWeeklyRecap;
async function markRecapShown(context, weekStart) {
    await mutateStats(context, stats => { stats.lastRecapWeek = weekStart; });
}
exports.markRecapShown = markRecapShown;
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
/**
 * Awards today's login bonus once. Called on activation and whenever the
 * tracker is shown, so a window left open past midnight still gets the new
 * day's bonus. The persisted claim key makes repeat calls (reloads, several
 * windows) harmless.
 */
async function claimDailyLogin(context) {
    const today = getTodayString();
    const { result } = await mutateStats(context, stats => {
        if (stats.dailyClaims[today])
            return 0;
        stats.dailyClaims[today] = true;
        return stats.streakDays;
    });
    if (!result)
        return false;
    const title = result > 1 ? `Daily Login Bonus · ${result}-day streak` : 'Daily Login Bonus';
    await recordActivity(context, 'daily_login', title, loginPointsFor(result), 'Activity');
    if (result % activities_1.CHECKIN_CHEST_EVERY === 0)
        await openCheckinChest(context, result);
    return true;
}
exports.claimDailyLogin = claimDailyLogin;
/** Every 7th day of a streak: a random profile reward, or points when there is nothing left to give. */
async function openCheckinChest(context, streak) {
    await mutateStats(context, stats => {
        const reward = grantRandomItem(stats, 'chest', activityRandom);
        const points = reward ? 0 : activities_1.CHECKIN_CHEST_POINTS;
        if (points)
            addUncappedPoints(stats, points);
        (0, analytics_1.track)('activity_played', { activity: 'checkin', points });
        pushActivity(stats, {
            id: 'play_checkin',
            title: `Weekly check-in chest (${streak}-day streak): ${reward ? reward.name : `+${points} pts`}`,
            points, timestamp: Date.now(), category: 'Play'
        });
    });
}
/** Claims the once-a-day activity boost. Returns false if it was already claimed today. */
async function claimDailyBonus(context) {
    const key = `${getTodayString()}_bonus`;
    const { result } = await mutateStats(context, stats => {
        if (stats.dailyClaims[key])
            return false;
        stats.dailyClaims[key] = true;
        return true;
    });
    if (result) {
        (0, analytics_1.track)('daily_bonus_claimed', {});
        await recordActivity(context, 'daily_bonus', 'Claimed Daily Activity Bonus', exports.DAILY_BONUS_POINTS, 'Activity');
    }
    return result;
}
exports.claimDailyBonus = claimDailyBonus;
function buildMilestoneView(context) {
    let toolNames = {};
    try {
        toolNames = (0, milestone_view_1.toolNamesFromManifest)(context.extension?.packageJSON?.contributes?.commands);
    }
    catch {
        toolNames = {};
    }
    const stats = getUserStats(context);
    const unlocked = effectiveUnlocked(stats);
    const loadout = (0, rewards_1.resolveLoadout)(stats.equipped, unlocked);
    return (0, milestone_view_1.buildTrackerView)({
        stats,
        levels: exports.LEVELS,
        milestones: exports.MILESTONES,
        progress: milestoneProgress,
        today: getTodayString(),
        dailyCap: DAILY_POINT_CAP,
        rateLimitAfter: RATE_LIMIT_AFTER,
        loginPoints: loginPointsFor(stats.streakDays),
        bonusPoints: exports.DAILY_BONUS_POINTS,
        premium: feature_registry_1.DEVELOPER_FEATURES
            .filter(feature => feature.enabled && feature.tier === 'premium' && (feature.pointCost ?? 0) > 0)
            .map(feature => ({ name: feature.name, pointCost: feature.pointCost })),
        toolNames,
        rewards: {
            list: rewards_1.REWARDS,
            unlocked,
            hint: rewardHint,
            currentTheme: (0, service_1.currentThemeId)(),
            previewTheme: (0, service_1.lockedPreviewTheme)(),
            activeFrame: loadout.frame?.frame ?? null,
            loadout,
            swatches: Object.fromEntries(themes_1.THEMES.map(theme => [theme.id, (0, themes_1.swatches)(theme)]))
        },
        shop: {
            boxCost: rewards_1.MYSTERY_BOX_COST,
            boxLeft: (0, rewards_1.mysteryBoxPool)(unlocked).length,
            rerollCost: quests_1.QUEST_REROLL_COST,
            rerollsLeft: Math.max(0, quests_1.MAX_REROLLS_PER_DAY - (stats.quests.rerolls ?? 0)),
            maxRerolls: quests_1.MAX_REROLLS_PER_DAY
        },
        freezes: { max: exports.MAX_STREAK_FREEZES, cost: exports.STREAK_FREEZE_COST, every: exports.FREEZE_EVERY_DAYS },
        loginBonusMax: exports.STREAK_LOGIN_BONUS_MAX,
        findReward: rewards_1.findReward
    });
}
exports.buildMilestoneView = buildMilestoneView;
const MILESTONE_COMMAND = `${command_registry_1.COMMAND_PREFIX}milestoneTracker`;
/** The project's Buy Me a Coffee page, the same link as in the README. */
exports.SUPPORT_URL = "https://www.buymeacoffee.com/ssayaibj";
let trackerPanel;
/** Set when the page should open Redeem as soon as it is ready. */
let redeemRequested = false;
let trackerReady = false;
/** Opens Milestones & Points with the Redeem sheet showing (used by the Tools view). */
async function openRedeem() {
    redeemRequested = true;
    await (0, command_dispatch_1.executeQueuedCommand)(MILESTONE_COMMAND);
    if (trackerPanel && trackerReady) {
        redeemRequested = false;
        trackerPanel.reveal();
        (0, webview_ui_1.safePostMessage)(trackerPanel, { type: 'openRedeem' });
    }
}
exports.openRedeem = openRedeem;
function notificationLevel() {
    const value = vscode.workspace.getConfiguration('devsnip').get('rewards.notifications', 'all');
    return value === 'off' || value === 'levelsOnly' ? value : 'all';
}
/**
 * Announces wins with a VS Code notification, so progress is visible wherever
 * the user is working. Skipped while the tracker is in view - it shows its own
 * banner - and governed by the devsnip.rewards.notifications setting.
 */
function showCelebrations(items) {
    const level = notificationLevel();
    if (level === 'off' || trackerPanel?.visible)
        return;
    const shown = level === 'levelsOnly' ? items.filter(item => item.kind === 'level' || item.kind === 'reward') : items;
    if (!shown.length)
        return;
    const [first, ...rest] = shown;
    const message = `${first.icon} ${first.text}${rest.length ? `  ·  ${rest.slice(0, 2).map(item => `${item.icon} ${item.text}`).join('  ·  ')}` : ''}${rest.length > 2 ? `  ·  +${rest.length - 2} more` : ''}`;
    const theme = shown.find(item => item.themeId)?.themeId;
    const wearable = theme ? undefined : shown.map(item => item.rewardId && (0, rewards_1.findReward)(item.rewardId)).find(Boolean) || undefined;
    const actions = theme ? ['Try theme', 'View progress'] : wearable ? ['Equip', 'View progress'] : ['View progress'];
    void vscode.window.showInformationMessage(message, ...actions).then(async (choice) => {
        if (choice === 'Try theme' && theme)
            await (0, service_1.setTheme)(theme);
        else if (choice === 'Equip' && wearable && globalContext && (0, rewards_1.isCosmetic)(wearable))
            await equipReward(globalContext, wearable.kind, wearable.id);
        else if (choice === 'View progress')
            await (0, command_dispatch_1.executeQueuedCommand)(MILESTONE_COMMAND);
    }).then(undefined, error => console.error('DevSnip Pro: progress notification action failed.', error));
}
exports.showCelebrations = showCelebrations;
/** Shows last week's recap once, on the first activation of a new week. */
async function maybeShowWeeklyRecap(context) {
    if (notificationLevel() !== 'all')
        return;
    const recap = pendingWeeklyRecap(getUserStats(context));
    if (!recap)
        return;
    await markRecapShown(context, recap.weekStart);
    (0, analytics_1.track)('weekly_recap', { action: 'shown' });
    const streak = getUserStats(context).streakDays;
    const parts = [
        `${recap.points.toLocaleString('en-US')} pts`,
        `${recap.runs.toLocaleString('en-US')} tool ${recap.runs === 1 ? 'run' : 'runs'}`,
        `${recap.tools.length} different ${recap.tools.length === 1 ? 'tool' : 'tools'}`
    ];
    if (streak > 1)
        parts.push(`🔥 ${streak}-day streak`);
    const trend = recap.previousPoints ? (recap.points >= recap.previousPoints ? ' 📈' : '') : '';
    const choice = await vscode.window.showInformationMessage(`📊 Your week in DevSnip Pro: ${parts.join(' · ')}${trend}`, 'See progress');
    if (choice === 'See progress') {
        (0, analytics_1.track)('weekly_recap', { action: 'opened' });
        await (0, command_dispatch_1.executeQueuedCommand)(MILESTONE_COMMAND);
    }
}
exports.maybeShowWeeklyRecap = maybeShowWeeklyRecap;
function registerMilestoneTrackerCommand(context) {
    setMilestoneContext(context);
    setCelebrationHandler(showCelebrations);
    void claimDailyLogin(context)
        .then(() => maybeShowWeeklyRecap(context))
        .catch(error => console.error('DevSnip Pro: daily login bonus failed.', error));
    const command = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.milestoneTracker', () => {
        const { panel, created } = (0, webview_ui_1.openToolPanel)('milestoneTracker', 'DevSnip Pro - Milestones & Points', {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
        });
        if (!created)
            return;
        trackerPanel = panel;
        trackerReady = false;
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'milestone-tracker.js')));
        const coffeeUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'bmc-button.png')));
        const effectsUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'reward-effects.js')));
        (0, service_1.setWebviewHtml)(panel.webview, getMilestoneTrackerHtml(panel.webview.cspSource, String(scriptUri), String(coffeeUri), String(effectsUri)));
        let ready = false;
        let pending;
        const post = (message) => (0, webview_ui_1.safePostMessage)(panel, message);
        const pushState = () => {
            if (!ready)
                return;
            try {
                post({ type: 'state', view: buildMilestoneView(context) });
            }
            catch (error) {
                post({ type: 'error', message: `Could not load your progress: ${error instanceof Error ? error.message : String(error)}` });
            }
        };
        // Tools earn points while the panel is open; coalesce bursts into one update.
        const scheduleState = () => {
            if (pending)
                clearTimeout(pending);
            pending = setTimeout(() => {
                pending = undefined;
                if (panel.visible)
                    pushState();
            }, 150);
        };
        const subscriptions = [
            (0, exports.onDidChangePoints)(scheduleState),
            // Redeem shows which theme is in use or being previewed.
            (0, service_1.onDidChangeTheme)(scheduleState),
            (0, service_1.onDidChangeLockedPreview)(scheduleState),
            panel.onDidChangeViewState(event => {
                if (event.webviewPanel.visible)
                    scheduleState();
            }),
            panel.webview.onDidReceiveMessage(async (message) => {
                const action = typeof message?.command === 'string' ? message.command : '';
                try {
                    switch (action) {
                        case 'ready':
                            ready = true;
                            trackerReady = true;
                            // A day may have started since activation.
                            await claimDailyLogin(context);
                            pushState();
                            if (redeemRequested) {
                                redeemRequested = false;
                                post({ type: 'openRedeem' });
                            }
                            break;
                        case 'spinWheel': {
                            const spin = await spinDailyWheel(context);
                            pushState();
                            post(spin.outcome === 'ok'
                                ? { type: 'result', action, ok: true, index: spin.index, icon: spin.segment.icon, message: `You won ${spin.text}!` }
                                : { type: 'result', action, ok: false, message: 'No spins left today. Finish all of today\'s quests for a bonus spin, or come back tomorrow.' });
                            break;
                        }
                        case 'answerQuiz': {
                            const quiz = await answerDailyQuiz(context, Number(message.choice));
                            pushState();
                            post(quiz.outcome === 'ok'
                                ? { type: 'result', action, ok: true, correct: quiz.correct, message: quiz.correct ? `Correct! +${quiz.points} pts${quiz.streak > 1 ? ` · ${quiz.streak}-day streak` : ''}` : `Not quite, but +${quiz.points} pts for trying. Read why below.` }
                                : { type: 'result', action, ok: false, message: quiz.outcome === 'answered' ? 'You already answered today\'s challenge. A new one arrives tomorrow.' : 'Pick one of the answers.' });
                            break;
                        }
                        case 'sprintDone': {
                            const sprint = await finishBitSprint(context, Number(message.score));
                            pushState();
                            post({
                                type: 'result', action, ok: true, score: sprint.score, newBest: sprint.newBest,
                                message: sprint.paid
                                    ? `${sprint.score} correct: +${sprint.points} pts${sprint.newBest ? ' and a new best!' : ''}`
                                    : `${sprint.score} correct${sprint.newBest ? ': a new best!' : ''} (practice: today's points are already in)`
                            });
                            break;
                        }
                        case 'tryTip': {
                            const tip = await tryDailyTip(context);
                            pushState();
                            if (tip.points)
                                post({ type: 'result', action, ok: true, message: `+${tip.points} pts for trying something new.` });
                            await (0, command_dispatch_1.executeQueuedCommand)(tip.command);
                            break;
                        }
                        case 'claimBonus': {
                            const claimed = await claimDailyBonus(context);
                            pushState();
                            post({
                                type: 'result', action,
                                ok: claimed,
                                message: claimed ? `+${exports.DAILY_BONUS_POINTS} points added to your balance.` : 'Today\'s bonus is already claimed. Come back tomorrow.'
                            });
                            break;
                        }
                        case 'resetData': {
                            // Webview modals are blocked by the sandbox, so confirmation is a native dialog.
                            const confirmed = await (0, webview_ui_1.confirmAction)('Reset all DevSnip Pro points, streaks and milestones? This cannot be undone.', 'Reset everything');
                            if (confirmed) {
                                await resetUserStats(context);
                                // A reward theme in use is locked again; fall back to the default look.
                                if (themeLockFor(getUserStats(context), (0, service_1.currentThemeId)()))
                                    await (0, service_1.setTheme)('system');
                            }
                            pushState();
                            post({ type: 'result', action, ok: confirmed, message: confirmed ? 'Progress reset.' : 'Nothing was reset.' });
                            break;
                        }
                        case 'buyFreeze': {
                            const outcome = await buyStreakFreeze(context);
                            pushState();
                            post({
                                type: 'result', action,
                                ok: outcome === 'ok',
                                message: outcome === 'ok' ? 'Streak freeze added. A missed day will not break your streak.'
                                    : outcome === 'full' ? `You already hold the maximum of ${exports.MAX_STREAK_FREEZES} freezes.`
                                        : `A freeze costs ${exports.STREAK_FREEZE_COST} points.`
                            });
                            break;
                        }
                        case 'buyReward': {
                            const id = typeof message.id === 'string' ? message.id : '';
                            const reward = (0, rewards_1.findReward)(id);
                            const outcome = await buyReward(context, id);
                            if (outcome === 'ok' && reward?.themeId)
                                await (0, service_1.setTheme)(reward.themeId);
                            pushState();
                            post({
                                type: 'result', action,
                                ok: outcome === 'ok',
                                message: outcome === 'ok' ? `${reward?.name ?? 'Reward'} unlocked${reward?.themeId ? ' and applied' : ''}.`
                                    : outcome === 'owned' ? 'You already have this reward.'
                                        : outcome === 'short' ? `You need ${reward?.cost ?? 0} points for this.`
                                            : 'This reward can only be earned.'
                            });
                            break;
                        }
                        case 'equipReward': {
                            const reward = typeof message.id === 'string' ? (0, rewards_1.findReward)(message.id) : undefined;
                            const slot = typeof message.slot === 'string' ? message.slot : reward?.kind;
                            if (!slot || slot === 'theme')
                                break;
                            const outcome = await equipReward(context, slot, message.id === null ? null : reward?.id ?? '');
                            pushState();
                            post({
                                type: 'result', action,
                                ok: outcome === 'ok',
                                message: outcome !== 'ok' ? 'Unlock it first to wear it.'
                                    : reward ? `${reward.name} equipped.` : `Your ${exports.REWARD_KIND_LABEL[slot]} was removed.`
                            });
                            break;
                        }
                        case 'openBox': {
                            const box = await openMysteryBox(context);
                            pushState();
                            post({
                                type: 'result', action,
                                ok: box.outcome === 'ok',
                                reward: box.outcome === 'ok' ? { id: box.reward.id, name: box.reward.name, icon: box.reward.icon, kind: box.reward.kind } : undefined,
                                message: box.outcome === 'ok' ? `You got the ${box.reward.name} ${exports.REWARD_KIND_LABEL[box.reward.kind]}!`
                                    : box.outcome === 'empty' ? 'You already own everything a mystery box can hold.'
                                        : `A mystery box costs ${rewards_1.MYSTERY_BOX_COST} points.`
                            });
                            break;
                        }
                        case 'rerollQuest': {
                            const id = typeof message.id === 'string' ? message.id : '';
                            const reroll = await rerollDailyQuest(context, id);
                            pushState();
                            post({
                                type: 'result', action,
                                ok: reroll.outcome === 'ok',
                                message: reroll.outcome === 'ok' ? `New quest: ${reroll.title}.`
                                    : reroll.outcome === 'limit' ? `You can swap ${quests_1.MAX_REROLLS_PER_DAY} quests a day. New quests arrive at midnight.`
                                        : reroll.outcome === 'short' ? `Swapping a quest costs ${quests_1.QUEST_REROLL_COST} points.`
                                            : reroll.outcome === 'done' ? 'That quest is already done.'
                                                : 'That quest could not be swapped.'
                            });
                            break;
                        }
                        case 'useTheme': {
                            const themeId = typeof message.themeId === 'string' ? message.themeId : '';
                            const reward = (0, rewards_1.rewardForTheme)(themeId);
                            if (reward && effectiveUnlocked(getUserStats(context)).includes(reward.id)) {
                                await (0, service_1.setTheme)(themeId);
                                pushState();
                                post({ type: 'result', action, ok: true, message: `${reward.name} theme applied.` });
                            }
                            break;
                        }
                        case 'previewTheme': {
                            const themeId = typeof message.themeId === 'string' ? message.themeId : '';
                            if ((0, rewards_1.rewardForTheme)(themeId))
                                await (0, service_1.previewLockedTheme)(themeId);
                            break;
                        }
                        case 'endPreview':
                            await (0, service_1.endLockedPreview)('ended');
                            break;
                        case 'openSpend':
                            await (0, command_dispatch_1.executeQueuedCommand)(`${command_registry_1.COMMAND_PREFIX}premiumStatus`);
                            break;
                        case 'openSupport':
                            // Webviews cannot open web pages themselves; the browser opens through VS Code.
                            await vscode.env.openExternal(vscode.Uri.parse(exports.SUPPORT_URL));
                            break;
                        case 'openSearch':
                            await (0, command_dispatch_1.executeQueuedCommand)(`${command_registry_1.COMMAND_PREFIX}searchTools`);
                            break;
                        case 'refresh':
                            pushState();
                            break;
                    }
                }
                catch (error) {
                    post({ type: 'result', action, ok: false, message: `That did not work: ${error instanceof Error ? error.message : String(error)}` });
                }
            })
        ];
        panel.onDidDispose(() => {
            if (trackerPanel === panel) {
                trackerPanel = undefined;
                trackerReady = false;
            }
            if (pending)
                clearTimeout(pending);
            subscriptions.forEach(subscription => subscription.dispose());
        });
    });
    context.subscriptions.push(command);
}
exports.registerMilestoneTrackerCommand = registerMilestoneTrackerCommand;
/**
 * `coffeeSrc` is the bundled Buy Me a Coffee button (the same image as in the README);
 * `effectsSrc` is the shared celebration effects script.
 */
function getMilestoneTrackerHtml(cspSource, scriptSrc, coffeeSrc, effectsSrc) {
    const icon = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Milestones &amp; Points</title>
    <style>
        ${webview_ui_1.UTILITY_CSS}
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
            <button class="coffee" id="coffeeBtn" type="button" title="Support DevSnip Pro on Buy Me a Coffee (opens in your browser)"><img src="${coffeeSrc}" alt="Buy Me a Coffee" width="128" height="36"></button>
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
        <div class="skeleton" style="height:236px" aria-hidden="true"></div>
        <div class="today" aria-hidden="true"><div class="skeleton" style="height:300px"></div><div class="today-side"><div class="skeleton" style="height:140px"></div><div class="skeleton" style="height:140px"></div></div></div>
        <div class="skeleton" style="height:240px" aria-hidden="true"></div>
        <p class="sr-only" role="status">Loading your progress...</p>
    </main>
    <div class="celebrate" id="celebrate" role="status" aria-live="polite"><span class="celebrate-badge" id="celebrateBadge"></span><span id="celebrateText"></span></div>
    ${effectsSrc ? `<script src="${effectsSrc}"></script>` : ''}
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}
exports.getMilestoneTrackerHtml = getMilestoneTrackerHtml;
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
    --r: 14px;
    --ease: cubic-bezier(.2, .8, .2, 1);
    --shadow-sm: 0 1px 2px var(--ds-shadow, rgba(0,0,0,.14));
    --shadow-md: 0 8px 24px color-mix(in srgb, var(--ds-shadow, rgba(0,0,0,.35)) 60%, transparent);
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
/* The official Buy Me a Coffee button image, as in the README, scaled to the header's height. */
.coffee { display: inline-flex; padding: 0; border: 0; border-radius: 8px; background: none; cursor: pointer; line-height: 0; transition: transform .1s, filter .15s; }
.coffee img { display: block; height: 36px; width: auto; border-radius: 8px; }
.coffee:hover { filter: brightness(1.04); }
.coffee:active { transform: translateY(1px); }
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
.page { max-width: 1120px; margin: 0 auto; padding: 22px 28px 56px; display: flex; flex-direction: column; gap: 26px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow-sm); }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-1); }
.skeleton { background: linear-gradient(90deg, var(--card), var(--card-2), var(--card)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; border-radius: var(--r); }
@keyframes shimmer { to { background-position: -200% 0; } }
/* Sections fade up once, one after another, when the page first draws. */
.page > * { animation: rise .45s var(--ease) both; }
.page > :nth-child(2) { animation-delay: .06s; }
.page > :nth-child(3) { animation-delay: .12s; }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
.block { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 0 2px; }
.section-head h2 { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
.section-head p { margin: 2px 0 0; font-size: 12px; color: var(--fg-1); }
.card-label { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-1); }
.card-label .ico { width: 14px; height: 14px; }
.card-label .chip { margin-left: auto; letter-spacing: 0; text-transform: none; }

/* Hero */
.hero { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); box-shadow: var(--shadow-md); }
.hero::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(110% 130% at 0% 0%, color-mix(in srgb, var(--level-color, var(--gold)) 14%, transparent), transparent 55%); }
.rank { position: relative; display: flex; gap: 26px; align-items: center; padding: 26px 26px 22px; min-width: 0; }
.ring { position: relative; width: 144px; height: 144px; flex: none; }
.ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring-track { stroke: var(--soft); }
.ring-fill { stroke: url(#ringGradient); stroke-linecap: round; transition: stroke-dashoffset 1.1s var(--ease); filter: drop-shadow(0 0 6px color-mix(in srgb, var(--level-ink) 35%, transparent)); }
.ring-stop-a { stop-color: var(--level-ink); }
.ring-stop-b { stop-color: var(--next-ink, var(--level-ink)); }
.ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.ring-pct { font-size: 12px; font-weight: 800; color: var(--fg-1); font-variant-numeric: tabular-nums; }
.rank-info { min-width: 0; flex: 1; }
.rank-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 2px; }
.rank-name { font-size: 32px; font-weight: 800; letter-spacing: -.025em; line-height: 1.05; color: var(--level-ink); }
.rank-name-row .rank-title-line { margin: 0; }
.next-rank { margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: color-mix(in srgb, var(--card) 70%, transparent); border: 1px solid var(--line); backdrop-filter: blur(4px); }
.next-rank-line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 13px; flex-wrap: wrap; }
.next-rank-line strong { font-weight: 800; }
.next-rank-togo { color: var(--fg-1); }
.next-rank-togo strong { color: var(--fg-0); }
.next-rank .bar { height: 10px; margin: 9px 0 7px; }
.next-rank-meta { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; color: var(--fg-1); }
.journey { position: relative; display: flex; justify-content: space-between; align-items: center; margin: 16px 2px 4px; height: 30px; }
.journey::before { content: ""; position: absolute; left: 12px; right: 12px; top: 50%; height: 3px; transform: translateY(-50%); border-radius: 3px; background: var(--soft); }
.journey-fill { position: absolute; left: 12px; top: 50%; height: 3px; max-width: calc(100% - 24px); transform: translateY(-50%); border-radius: 3px; background: linear-gradient(90deg, color-mix(in srgb, var(--level-ink) 45%, transparent), var(--level-ink)); width: 0; transition: width 1s var(--ease); }
.rung { position: relative; z-index: 1; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--card); border: 2px solid var(--soft); transition: transform .2s var(--ease); }
.rung-badge { font-size: 13px; line-height: 1; }
.rung.achieved { border-color: color-mix(in srgb, var(--lv-ink) 70%, transparent); }
.rung.current { width: 32px; height: 32px; border: 3px solid var(--level-ink); box-shadow: 0 0 0 4px color-mix(in srgb, var(--level-ink) 20%, transparent); }
.rung.current .rung-badge { font-size: 16px; }
.rung.locked .rung-badge { filter: grayscale(1); opacity: .45; }
.rung:hover { transform: translateY(-2px); }
.rank-foot { margin-top: 8px; font-size: 11.5px; color: var(--fg-1); }

.kpis { position: relative; display: grid; grid-template-rows: repeat(3, 1fr); border-left: 1px solid var(--line); background: color-mix(in srgb, var(--card) 55%, transparent); }
.kpi { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 20px; min-width: 0; transition: background-color .15s; }
.kpi:hover { background: color-mix(in srgb, var(--fg-0) 3%, transparent); }
.kpi + .kpi { border-top: 1px solid var(--line); }
.kpi-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: color-mix(in srgb, var(--tint) 15%, transparent); color: var(--tint-text, var(--tint)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 22%, transparent); }
.kpi-icon .ico { width: 18px; height: 18px; }
.kpi-label { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-1); }
.kpi-value { font-size: 24px; font-weight: 800; letter-spacing: -.015em; line-height: 1.15; font-variant-numeric: tabular-nums; }
.kpi-value small { font-size: 12px; font-weight: 600; color: var(--fg-1); margin-left: 3px; }
.kpi-sub { font-size: 12px; color: var(--fg-1); line-height: 1.4; margin-top: 1px; }
.kpi-side { display: flex; flex-direction: column; align-items: flex-end; gap: 7px; }
.dots { display: flex; gap: 4px; }
.dots i { width: 9px; height: 9px; border-radius: 3px; background: var(--soft); }
.dots i.on { background: var(--streak); }
.dots i.today { box-shadow: 0 0 0 2px color-mix(in srgb, var(--streak) 35%, transparent); }
.bar { height: 6px; background: var(--soft); border-radius: 999px; overflow: hidden; }
.bar > span { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--gold); transition: width .8s var(--ease); }
.bar.success > span { background: var(--success); }
.bar.accent > span { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, var(--card)), var(--accent)); }
.bar.tint > span { background: linear-gradient(90deg, color-mix(in srgb, var(--tint) 60%, var(--card)), var(--tint)); }
.bar.rankbar > span { background: linear-gradient(90deg, var(--level-ink), var(--next-ink, var(--level-ink))); box-shadow: 0 0 10px color-mix(in srgb, var(--level-ink) 40%, transparent); }
.kpi .bar { width: 96px; }

/* Today: quests on the left; next milestone, boost and this week on the right */
.today { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.today-side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.daily { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.daily > .card, .today-side > .card { min-width: 0; }
.boost { display: flex; align-items: center; gap: 14px; padding: 14px 16px; position: relative; overflow: hidden; }
.boost.ready { border-color: color-mix(in srgb, var(--gold) 45%, var(--line)); background: linear-gradient(120deg, color-mix(in srgb, var(--gold) 13%, var(--card)), var(--card) 75%); }
.boost-icon { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--gold) 16%, transparent); color: var(--gold-text); }
.boost-icon .ico { width: 20px; height: 20px; }
.boost.claimed .boost-icon { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.boost-body { flex: 1; min-width: 0; }
.boost-title { font-size: 13.5px; font-weight: 800; }
.boost-sub { font-size: 12px; color: var(--fg-1); margin-top: 2px; line-height: 1.45; }
.checklist { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; font-size: 11.5px; color: var(--fg-1); }
.checklist span { display: inline-flex; align-items: center; gap: 4px; }
.checklist .ico { width: 12px; height: 12px; }
.checklist .ok { color: var(--success); }
.next { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-color: color-mix(in srgb, var(--tint) 35%, var(--line)); background: linear-gradient(150deg, color-mix(in srgb, var(--tint) 9%, var(--card)), var(--card) 65%); }
.next-main { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
.next-icon { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: color-mix(in srgb, var(--tint, var(--info)) 15%, transparent); }
.next-title { font-size: 15px; font-weight: 800; }
.next-sub { font-size: 12.5px; color: var(--fg-1); margin-top: 1px; }
.next-pct { font-size: 20px; font-weight: 800; color: var(--tint-text, var(--fg-0)); }
.next .bar { height: 8px; }
.next-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; }
.next-row .num { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.next-row .link { flex: none; white-space: nowrap; }
.next.done .next-main { grid-template-columns: 44px minmax(0, 1fr); }

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
.ms-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.stat-pill { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); box-shadow: var(--shadow-sm); }
.stat-pill-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-text, var(--tint)); }
.stat-pill-value { font-size: 18px; font-weight: 800; line-height: 1.1; }
.stat-pill-label { font-size: 11.5px; color: var(--fg-1); }
.ms-toolbar { margin-top: 14px; }
.ms-overall { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; }
.ms-overall .bar { width: 160px; }
.ms-group { margin-top: 18px; }
.group-head { display: flex; align-items: center; gap: 8px; margin: 0 2px 10px; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-1); }
.group-head::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.group-head .count { font-size: 11px; letter-spacing: 0; padding: 1px 8px; border-radius: 999px; background: var(--soft); color: var(--fg-1); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
.grid.compact { grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.grid.animate > .ms { animation: rise .35s var(--ease) both; animation-delay: calc(var(--i, 0) * 28ms); }
.ms { position: relative; display: flex; flex-direction: column; gap: 11px; padding: 16px; transition: border-color .2s, transform .2s, box-shadow .2s; }
.ms:hover { border-color: color-mix(in srgb, var(--tint) 45%, var(--line)); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.ms.closest { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent), var(--shadow-sm); background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 7%, var(--card)), var(--card) 60%); }
.ms-head { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.ms-icon { position: relative; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-size: 22px; background: color-mix(in srgb, var(--tint) 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 20%, transparent); }
.ms-check { position: absolute; right: -5px; bottom: -5px; width: 19px; height: 19px; border-radius: 50%; display: grid; place-items: center; background: var(--success); color: var(--ds-on-status, #fff); border: 2px solid var(--card); }
.ms-check .ico { width: 11px; height: 11px; stroke-width: 3; }
.ms-cat { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--tint-text, var(--tint)); }
.ms-title { font-size: 14px; font-weight: 700; margin-top: 1px; }
.ms-desc { font-size: 12.5px; color: var(--fg-1); line-height: 1.45; }
.ms-progress { display: flex; align-items: center; gap: 10px; margin-top: auto; }
.ms-progress .bar { flex: 1; height: 7px; }
.ms-pct { font-size: 12px; font-weight: 800; min-width: 34px; text-align: right; color: var(--tint-text, var(--fg-0)); }
.ms-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--fg-1); }
.ms-foot b { color: var(--fg-0); font-weight: 700; }
.ms .tag { position: absolute; top: -9px; left: 14px; }
.ms.completed { flex-direction: row; align-items: center; gap: 12px; padding: 11px 14px; background: linear-gradient(120deg, color-mix(in srgb, var(--success) 6%, var(--card)), var(--card) 70%); }
.ms.completed .ms-icon { width: 38px; height: 38px; font-size: 19px; flex: none; }
.ms-done-body { flex: 1; min-width: 0; }
.ms.completed .ms-title { font-size: 13px; line-height: 1.3; }
.ms.completed .ms-cat { text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 11.5px; color: var(--fg-1); }
.empty { text-align: center; color: var(--fg-1); padding: 40px 16px; font-size: 13px; line-height: 1.6; }
.empty .ico { width: 28px; height: 28px; opacity: .6; display: block; margin: 0 auto 10px; }
.empty-art { display: block; font-size: 34px; line-height: 1; margin-bottom: 10px; }
.empty-title { font-size: 14px; font-weight: 800; color: var(--fg-0); margin-bottom: 2px; }

/* Levels timeline */
.timeline { padding: 8px 24px; }
.tl { position: relative; display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 14px 0; }
.tl::before { content: ""; position: absolute; left: 23px; top: 0; bottom: 0; width: 2px; background: var(--soft); }
.tl:first-child::before { top: 50%; }
.tl:last-child::before { bottom: 50%; }
.tl.achieved::before { background: color-mix(in srgb, var(--success) 55%, transparent); }
.tl-node { position: relative; z-index: 1; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; background: var(--card); border: 2px solid var(--soft); }
.tl.achieved .tl-node { border-color: color-mix(in srgb, var(--success) 70%, transparent); }
.tl.current .tl-node { border: 3px solid var(--lv-ink); box-shadow: 0 0 0 5px color-mix(in srgb, var(--lv-ink) 18%, transparent); }
/* The current rank sits on a soft highlight so it reads as "you are here". */
.tl.current::after { content: ""; position: absolute; inset: 4px -12px; border-radius: 12px; background: color-mix(in srgb, var(--lv-ink) 8%, transparent); border: 1px solid color-mix(in srgb, var(--lv-ink) 25%, transparent); z-index: 0; }
.tl > * { position: relative; z-index: 1; }
.tl.locked .tl-name, .tl.locked .tl-sub { opacity: .75; }
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
.feed { padding: 6px 16px 14px; }
.day { display: flex; justify-content: space-between; align-items: baseline; margin: 18px 4px 6px; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-1); }
.day:first-child { margin-top: 10px; }
.day span:last-child { letter-spacing: 0; text-transform: none; font-size: 12px; color: var(--gold-text); }
.act { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 8px 6px; border-radius: 9px; transition: background-color .15s; }
.act:hover { background: var(--soft); }
.act-icon { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-text, var(--tint)); }
.act-icon .ico { width: 15px; height: 15px; }
.act-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.act-meta { font-size: 11.5px; color: var(--fg-1); }
.act-pts { min-width: 44px; text-align: center; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.act-pts.plus { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
.act-pts.minus { color: var(--danger); background: color-mix(in srgb, var(--danger) 11%, transparent); }
.act-pts.zero { color: var(--fg-2, var(--fg-1)); background: var(--soft); }
.more { margin-top: 12px; text-align: center; }

/* Earn */
.rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.rule { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; padding: 14px 16px; transition: border-color .2s, transform .2s; }
.rule:hover { border-color: color-mix(in srgb, var(--tint) 40%, var(--line)); transform: translateY(-1px); }
.rule-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-text, var(--tint)); }
.rule-icon .ico { width: 17px; height: 17px; }
.rule-title { font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.rule-text { font-size: 12px; color: var(--fg-1); line-height: 1.45; margin-top: 3px; }

/* Quests and this week */
.quests { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.quests[hidden] { display: none; }
.q-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.q-title { font-size: 18px; font-weight: 800; margin-top: 4px; }
.q-title .muted { font-size: 13px; font-weight: 600; }
.q-list { display: flex; flex-direction: column; gap: 8px; }
.quest { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--card-2); transition: border-color .2s, background-color .2s; }
.quest:hover { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
.quest.done { border-color: color-mix(in srgb, var(--success) 35%, var(--line)); background: color-mix(in srgb, var(--success) 6%, var(--card)); }
.q-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; font-size: 18px; background: color-mix(in srgb, var(--accent) 13%, transparent); }
.quest.done .q-icon { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
.q-body { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.q-line { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.q-name { font-size: 13.5px; font-weight: 700; }
.q-count { font-size: 11.5px; font-weight: 700; color: var(--fg-1); white-space: nowrap; }
.quest.done .q-count { color: var(--success); }
.q-hint { font-size: 12px; color: var(--fg-1); line-height: 1.4; }
.q-body .bar { height: 5px; margin-top: 4px; }
.quest.done .q-name { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--fg-0) 35%, transparent); }
.q-chest { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--fg-1); padding: 10px 12px; border-radius: 11px; border: 1px dashed color-mix(in srgb, var(--gold) 45%, var(--line)); }
.q-chest strong { color: var(--fg-0); }
.q-chest.open { border-style: solid; color: var(--fg-0); background: color-mix(in srgb, var(--gold) 9%, transparent); }
.q-chest-icon { font-size: 20px; }
.q-chest-text { flex: 1; min-width: 0; }
.q-pips { display: inline-flex; gap: 4px; }
.q-pips i { width: 18px; height: 6px; border-radius: 3px; background: var(--soft); }
.q-pips i.on { background: var(--gold); }
.q-perfect { font-size: 12px; white-space: nowrap; }
.week { padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.week-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.week-stat { padding: 10px; border-radius: 10px; background: var(--card-2); border: 1px solid var(--line); }
.week-value { font-size: 20px; font-weight: 800; letter-spacing: -.01em; line-height: 1.1; }
.week-label { font-size: 11px; color: var(--fg-1); margin-top: 2px; }
.week-sub { font-size: 12px; color: var(--fg-1); margin-top: 6px; }
.week-sub .up { color: var(--success); }
.week-compare .bar { margin-top: 2px; }

/* Streak freezes */
.freezes { display: inline-flex; align-items: center; gap: 3px; }
.freezes i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 5px; color: var(--fg-2, var(--fg-1)); background: var(--soft); opacity: .6; }
.freezes i.on { color: var(--info); background: color-mix(in srgb, var(--info) 16%, transparent); opacity: 1; }
.freezes i .ico { width: 12px; height: 12px; stroke-width: 2.2; }
.freezes .link { margin-left: 3px; font-size: 11.5px; }
.freezes .link[disabled] { opacity: .5; cursor: default; text-decoration: none; }

/* Rewards */
.rw { display: flex; flex-direction: column; overflow: hidden; transition: border-color .2s, transform .2s; }
.rw:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--fg-0) 22%, var(--line)); box-shadow: var(--shadow-md); }
.rw.active { border-color: color-mix(in srgb, var(--success) 55%, var(--line)); }
.rw-preview { display: flex; height: 54px; }
.rw-preview > span { flex: 1; background: var(--sw); }
.rw.locked .rw-preview { filter: saturate(.5) brightness(.85); }
.rw-preview.stage { position: relative; height: auto; min-height: 76px; align-items: center; justify-content: center; padding: 14px 16px; background: var(--card-2); border-bottom: 1px solid var(--line); }
.rw.locked .rw-preview.stage { filter: none; }
.rw-preview.stage > span { flex: none; }
.rw { position: relative; }
.rw-preview.medal-stage { min-height: 92px; background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--gold) 10%, var(--card-2)), var(--card-2) 70%); }
.pv-medal.big { width: 58px; height: 58px; font-size: 30px; }
.pv-medal.big .medal-rank { font-size: 14px; }
.rw-preview.title-stage { min-height: 76px; }
.title-sample { padding: 7px 14px; border-radius: 999px; font-size: 13.5px; background: var(--card); border: 1px solid var(--line); box-shadow: var(--shadow-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.title-sample strong { font-weight: 800; }
.rw-need { display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--fg-1); font-weight: 600; }
.rw-need .bar { flex: 1; height: 5px; }
.rw-ribbon { position: absolute; top: 8px; right: 8px; z-index: 2; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 11px; font-weight: 800; color: var(--ds-on-status, #fff); background: var(--success); box-shadow: var(--shadow-sm); }
.rw-ribbon .ico { width: 11px; height: 11px; stroke-width: 3; }
.rw-ribbon.earn { background: color-mix(in srgb, var(--purple) 85%, #000); color: #fff; }
.rw.earn-only .rw-preview { filter: grayscale(.35); }
.rw.locked:not(.earn-only) .rw-foot .rw-state { color: var(--fg-1); }
.rw-effect { font-size: 30px; line-height: 1; }
.rw-play { position: absolute; right: 10px; bottom: 10px; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--line); background: var(--card); color: var(--fg-0); display: grid; place-items: center; cursor: pointer; }
.rw-play:hover { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.rw-play .ico { width: 12px; height: 12px; fill: currentColor; }
.rw.active:not(.previewing) .rw-preview.stage { background: color-mix(in srgb, var(--success) 6%, var(--card-2)); }

/* Profile rewards: frames, banners, medals and a copy of the Tools view rank card */
${(0, profile_style_1.profileCss)({ medal: [".ring-medal", ".pv-medal"], banner: [".hero", ".pv-card"], base: "var(--card)", ink: "var(--fg-0)" })}
.ring-medal, .pv-medal { position: relative; display: grid; place-items: center; border-radius: 50%; line-height: 1; background: color-mix(in srgb, var(--level-ink, var(--gold)) 12%, var(--card)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 30%, transparent); --frame-inner: var(--card); }
.ring-medal { width: 64px; height: 64px; font-size: 34px; }
.medal-rank { position: absolute; right: -6px; bottom: -5px; font-size: 40%; padding: 2px; border-radius: 50%; background: var(--card); line-height: 1; }
.rank-title-line { display: inline-flex; align-items: center; gap: 6px; margin: 2px 0 4px; padding: 2px 10px 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--fg-0); background: color-mix(in srgb, var(--level-ink) 14%, transparent); border: 1px solid color-mix(in srgb, var(--level-ink) 30%, transparent); }
.pv-card { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 300px; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); text-align: left; }
.pv-card.compact { max-width: 100%; padding: 7px 10px; }
.pv-medal { flex: none; width: 34px; height: 34px; font-size: 18px; }
.pv-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pv-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.pv-name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-title { font-weight: 500; color: var(--fg-1); }
.pv-pts { flex: none; font-size: 11.5px; font-weight: 700; color: var(--gold-text); }
.pv-meter { height: 4px; border-radius: 999px; background: var(--soft); overflow: hidden; }
.pv-meter > span { display: block; height: 100%; border-radius: inherit; background: var(--gold); }

/* Redeem: the button on the rank card and the sheet it opens */
.rank-redeem { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
.rank-redeem .xbtn { height: 36px; padding: 0 18px; font-size: 13.5px; box-shadow: 0 4px 14px color-mix(in srgb, var(--gold) 30%, transparent); }
.rank-redeem .xbtn .ico { width: 17px; height: 17px; }
.rank-redeem-sub { font-size: 12px; color: var(--fg-1); }
.rank-redeem-sub strong { color: var(--gold-text); font-weight: 700; }
.redeem { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: center; align-items: flex-start; padding: 28px 20px; overflow-y: auto; background: color-mix(in srgb, var(--bg-0) 55%, rgba(0,0,0,.5)); backdrop-filter: blur(3px); animation: fade .16s ease-out; }
.redeem[hidden] { display: none; }
.redeem-sheet { width: 100%; max-width: 1080px; border-radius: 16px; border: 1px solid var(--line); background: var(--bg-0); box-shadow: 0 24px 60px var(--ds-shadow, rgba(0,0,0,.45)); animation: rise .22s var(--ease); }
.redeem-head { position: sticky; top: -28px; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line); border-radius: 16px 16px 0 0; background: color-mix(in srgb, var(--bg-0) 92%, transparent); backdrop-filter: blur(8px); }
.redeem-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex: none; color: var(--gold-text); background: color-mix(in srgb, var(--gold) 15%, transparent); border: 1px solid color-mix(in srgb, var(--gold) 30%, transparent); }
.redeem-icon .ico { width: 19px; height: 19px; }
.redeem-heading { flex: 1; min-width: 0; }
.redeem-heading h2 { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
.redeem-heading p { margin: 2px 0 0; font-size: 12px; color: var(--fg-1); }
.redeem-balance { height: 28px; padding: 0 12px; font-size: 13px; }
.redeem-body { padding: 4px 20px 22px; }
.redeem-body .studio { margin-top: 16px; }
body.redeem-open { overflow: hidden; }
@keyframes fade { from { opacity: 0; } }

/* Redeem navigation */
.redeem-nav { display: flex; gap: 4px; margin: 16px 0 4px; padding: 4px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.redeem-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 14px; border: 0; border-radius: 9px; background: transparent; color: var(--fg-1); font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: background-color .15s, color .15s; }
.redeem-tab:hover { color: var(--fg-0); }
.redeem-tab[aria-selected="true"] { background: var(--card-2); color: var(--fg-0); box-shadow: 0 1px 2px var(--ds-shadow, rgba(0,0,0,.2)), inset 0 0 0 1px var(--line); }
.redeem-tab .ico { width: 15px; height: 15px; }
.redeem-tab [class="ico"] path[d^="M7 4.5"] { fill: currentColor; }
.redeem-badge { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; font-size: 11px; font-weight: 800; background: var(--danger); color: #fff; font-variant-numeric: tabular-nums; }
.rank-redeem .redeem-badge { margin-left: 2px; background: #1d1606; color: var(--gold); }
.redeem-count { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--soft); color: var(--fg-1); }
.redeem-tab[aria-selected="true"] .redeem-count { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg-0); }

/* Play: today's activities at a glance */
.play-summary { margin-top: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 9%, var(--card)), var(--card) 70%); }
.play-summary.all-done { background: linear-gradient(120deg, color-mix(in srgb, var(--success) 9%, var(--card)), var(--card) 70%); border-color: color-mix(in srgb, var(--success) 35%, var(--line)); }
.ps-head { display: flex; align-items: center; gap: 14px; }
.ps-progress { position: relative; width: 56px; height: 56px; flex: none; display: grid; place-items: center; }
.ps-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.ps-ring circle { fill: none; stroke-width: 5; }
.ps-ring-track { stroke: var(--soft); }
.ps-ring-fill { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset .6s var(--ease); }
.all-done .ps-ring-fill { stroke: var(--success); }
.ps-count { position: relative; font-size: 14px; font-weight: 800; }
.ps-copy { flex: 1; min-width: 0; }
.ps-title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
.ps-sub { font-size: 12.5px; color: var(--fg-1); margin-top: 2px; }
.ps-sub strong { color: var(--gold-text); font-weight: 800; }
.ps-next { flex: none; height: 34px; padding: 0 14px; }
.ps-next .ico { width: 14px; height: 14px; }
.ps-items { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.ps-item { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--fg-0); text-align: left; cursor: pointer; transition: border-color .15s, transform .15s, opacity .15s; min-width: 0; }
.ps-item:hover { border-color: var(--accent); transform: translateY(-1px); }
.ps-item.done { background: transparent; }
.ps-item.done .ps-label { color: var(--fg-1); }
.ps-icon { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex: none; font-size: 15px; background: var(--soft); }
.ps-item.done .ps-icon { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
.ps-item.done .ps-icon .ico { width: 14px; height: 14px; stroke-width: 2.6; }
.ps-text { display: flex; flex-direction: column; min-width: 0; }
.ps-label { font-size: 12.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ps-text small { font-size: 11px; color: var(--gold-text); font-weight: 700; }
.ps-item.done .ps-text small { color: var(--success); }
.play-section { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 22px 2px 0; }
.play-section + .event-card { margin-top: 10px; }

/* Play: activity cards */
.act-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.act-card { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 0; transition: border-color .2s, box-shadow .2s; }
.act-card:hover { box-shadow: var(--shadow-md); }
/* Done for today: a quiet green edge, so what is left stands out. */
.act-card.done { border-color: color-mix(in srgb, var(--success) 32%, var(--line)); }
.act-card.done .act-emoji { background: color-mix(in srgb, var(--success) 13%, transparent); }
.act-card > :last-child { margin-bottom: 0; }
.tip-card .act-foot { margin-top: auto; }
.odds { font-size: 11.5px; color: var(--fg-1); text-align: center; }
.odds summary { cursor: pointer; display: inline-block; padding: 2px 8px; border-radius: 6px; list-style: none; }
.odds summary::-webkit-details-marker { display: none; }
.odds summary::after { content: " ▾"; }
.odds[open] summary::after { content: " ▴"; }
.odds summary:hover { color: var(--fg-0); background: var(--soft); }
.act-head { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
.act-emoji { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; font-size: 21px; background: var(--soft); }
.act-name { font-size: 14px; font-weight: 800; }
.act-sub { font-size: 12px; color: var(--fg-1); margin-top: 1px; line-height: 1.4; }
.act-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: auto; }
.act-note { font-size: 11.5px; color: var(--fg-1); line-height: 1.45; }
.act-card .xbtn .ico path[d^="M7 4.5"] { fill: currentColor; }

/* Weekly event */
.event-card { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); margin-top: 16px; overflow: hidden; border-color: color-mix(in srgb, var(--streak) 40%, var(--line)); background: linear-gradient(115deg, color-mix(in srgb, var(--streak) 14%, var(--card)), color-mix(in srgb, var(--purple) 8%, var(--card)) 60%, var(--card)); }
.event-card.done { border-color: color-mix(in srgb, var(--success) 45%, var(--line)); }
.event-main { padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.event-tags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.event-live { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--streak-text); }
.event-live i { width: 8px; height: 8px; border-radius: 50%; background: var(--streak); box-shadow: 0 0 0 0 color-mix(in srgb, var(--streak) 60%, transparent); animation: live 1.8s ease-out infinite; }
@keyframes live { 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
.event-title { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 800; letter-spacing: -.01em; }
.event-desc { font-size: 13px; color: var(--fg-1); }
.event-progress { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; margin-top: 4px; }
.event-progress .bar { flex: 1; height: 8px; }
.event-prize { padding: 18px 20px; border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; align-items: flex-start; justify-content: center; background: color-mix(in srgb, var(--card) 60%, transparent); }
.event-reward { display: flex; align-items: center; gap: 12px; }
.event-reward-icon { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font-size: 24px; background: color-mix(in srgb, var(--gold) 15%, var(--card)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--gold) 35%, transparent), 0 0 18px color-mix(in srgb, var(--gold) 30%, transparent); }
.event-reward-name { font-size: 14px; font-weight: 800; }

/* Daily spin */
.spin-card.featured { margin-top: 12px; padding: 18px 20px; background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--gold) 9%, var(--card)), var(--card) 60%); }
/* An odd card out at the end of the grid takes the full row. */
.act-grid > :last-child:nth-child(odd) { grid-column: 1 / -1; }
.spin-layout { display: grid; grid-template-columns: minmax(220px, 290px) minmax(0, 1fr); gap: 24px; align-items: center; }
.spin-stage { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.spin-side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.wheel { position: relative; width: min(270px, 100%); aspect-ratio: 1; margin: 6px auto 0; }
.wheel.can-spin { cursor: pointer; }
.wheel-svg { width: 100%; height: 100%; display: block; overflow: visible; filter: drop-shadow(0 8px 18px var(--ds-shadow, rgba(0,0,0,.3))); transition: transform .2s var(--ease); }
.wheel.can-spin:hover .wheel-svg { transform: scale(1.02); }
.wheel-rim { fill: color-mix(in srgb, var(--gold) 28%, var(--card)); stroke: color-mix(in srgb, var(--gold) 70%, transparent); stroke-width: 1.5; }
.wheel-slice { stroke: color-mix(in srgb, var(--card) 70%, transparent); stroke-width: 1.5; transition: opacity .35s; }
.wheel-slice.dim { opacity: .38; }
.wheel-slice.win { stroke: #fff; stroke-width: 3; }
.wheel-peg { fill: #fff; opacity: .9; }
.wheel-icon { font-size: 16px; text-anchor: middle; dominant-baseline: middle; }
.wheel-label { font-size: 12.5px; font-weight: 900; text-anchor: middle; dominant-baseline: middle; fill: #1b1b1f; }
.wheel-label.long { font-size: 10px; }
.wheel-hub { fill: var(--card); stroke: var(--gold); stroke-width: 3; }
.wheel-hub-text { font-size: 8.5px; font-weight: 900; letter-spacing: .06em; text-anchor: middle; dominant-baseline: central; fill: var(--gold-text); }
.wheel-pointer { position: absolute; left: 50%; top: -8px; z-index: 1; width: 0; height: 0; transform: translateX(-50%); transform-origin: 50% 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-top: 22px solid var(--gold); filter: drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
.wheel.spinning .wheel-pointer { animation: tick .14s ease-in-out infinite alternate; }
@keyframes tick { to { transform: translateX(-50%) rotate(-16deg); } }
.spin-btn { min-width: 170px; justify-content: center; height: 36px; font-size: 13.5px; }
.prize-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.prize-row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 9px; transition: background-color .2s; }
.prize-row.won { background: color-mix(in srgb, var(--gold) 13%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 45%, transparent); }
.prize-icon { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 15px; background: color-mix(in srgb, var(--tint) 24%, var(--card)); }
.prize-name { display: flex; flex-direction: column; min-width: 0; font-size: 13px; font-weight: 700; }
.prize-name small { font-size: 11.5px; font-weight: 500; color: var(--fg-1); line-height: 1.35; }
.prize-odds { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; }
.prize-odds b { min-width: 30px; text-align: right; }
.prize-bar { width: 52px; height: 5px; border-radius: 3px; background: var(--soft); overflow: hidden; }
.prize-bar i { display: block; height: 100%; border-radius: 3px; background: var(--tint); }
.spin-result { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 12px; background: var(--card-2); border: 1px solid var(--line); }
.spin-result.landed { margin-bottom: 6px; border-color: color-mix(in srgb, var(--gold) 50%, var(--line)); background: color-mix(in srgb, var(--gold) 9%, var(--card-2)); animation: pop .45s var(--ease); }
@keyframes pop { from { opacity: 0; transform: scale(.95); } }
.spin-prize { width: 52px; height: 52px; flex: none; border-radius: 50%; display: grid; place-items: center; font-size: 26px; background: color-mix(in srgb, var(--tint, var(--gold)) 22%, var(--card)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint, var(--gold)) 45%, transparent); }
.spin-result-text { min-width: 0; }
.spin-prize-name { font-size: 17px; font-weight: 800; margin: 1px 0 2px; }
.spin-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.spin-bonus { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px dashed var(--line); background: transparent; color: var(--fg-1); font-size: 12.5px; text-align: left; cursor: pointer; transition: border-color .15s, color .15s; }
.spin-bonus:hover { border-color: var(--accent); color: var(--fg-0); }
.spin-bonus strong { color: var(--fg-0); }
.spin-bonus-label { flex: 1; min-width: 0; }
.spin-bonus-pips { display: inline-flex; gap: 4px; }
.spin-bonus-pips i { width: 18px; height: 6px; border-radius: 3px; background: var(--soft); }
.spin-bonus-pips i.on { background: var(--success); }
.spin-bonus-count { font-weight: 800; color: var(--fg-0); }
.spin-bonus.earned { cursor: default; border-style: solid; border-color: color-mix(in srgb, var(--success) 40%, var(--line)); background: color-mix(in srgb, var(--success) 8%, transparent); color: var(--fg-0); }
.spin-bonus.earned .ico { width: 14px; height: 14px; color: var(--success); stroke-width: 2.6; }
.odds .prize-list { margin-top: 8px; text-align: left; }

/* Daily challenge */
.quiz-q { font-size: 14px; font-weight: 700; line-height: 1.4; }
.quiz-code { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--vscode-textCodeBlock-background, var(--card-2)); border: 1px solid var(--line); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.quiz-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.quiz-opt { display: flex; align-items: center; gap: 9px; min-height: 40px; padding: 7px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--card-2); color: var(--fg-0); font-size: 12.5px; text-align: left; cursor: pointer; transition: border-color .15s, background-color .15s, transform .1s; }
.quiz-opt:hover:not([disabled]) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--card-2)); }
.quiz-opt:active:not([disabled]) { transform: translateY(1px); }
.quiz-opt[disabled] { cursor: default; }
.quiz-letter { flex: none; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; font-size: 11px; font-weight: 800; background: var(--soft); color: var(--fg-1); }
.quiz-text { min-width: 0; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.quiz-opt.picked { border-color: var(--accent); }
.quiz-opt.right { border-color: var(--success); background: color-mix(in srgb, var(--success) 12%, var(--card-2)); }
.quiz-opt.right .quiz-letter { background: var(--success); color: var(--ds-on-status, #fff); }
.quiz-opt.wrong { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--card-2)); }
.quiz-opt.wrong .quiz-letter { background: var(--danger); color: #fff; }
.quiz-opt.dim { opacity: .55; }
.quiz-explain { font-size: 12.5px; line-height: 1.5; padding: 10px 12px; border-radius: 9px; border-left: 3px solid var(--success); background: color-mix(in srgb, var(--success) 8%, transparent); }
.quiz-explain.wrong { border-left-color: var(--streak); background: color-mix(in srgb, var(--streak) 8%, transparent); }

/* Bit Sprint */
.sprint-demo { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 14px; border-radius: 12px; background: var(--card-2); border: 1px dashed var(--line); font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 22px; font-weight: 800; }
.sprint-arrow { color: var(--fg-1); font-size: 16px; }
.sprint-intro { display: flex; flex-wrap: wrap; gap: 6px; }
.sprint-stat { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; background: var(--soft); font-size: 12px; color: var(--fg-1); }
.sprint-stat b { color: var(--fg-0); font-weight: 800; }
.sprint-stat .ico { width: 13px; height: 13px; }
.sprint-top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; }
.sprint-time { color: var(--streak-text); }
.sprint-bar { height: 6px; }
.sprint-bar > span { transition: width .1s linear; }
.sprint-prompt { text-align: center; padding: 6px 0; }
.sprint-prompt span { font-size: 30px; font-weight: 800; letter-spacing: .02em; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.sprint-prompt small { font-size: 13px; color: var(--fg-1); font-weight: 600; }
.sprint-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.sprint-card.playing { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
.flash-right { animation: flash-right .35s ease-out; }
.flash-wrong { animation: flash-wrong .35s ease-out; }
@keyframes flash-right { 30% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 45%, transparent); } }
@keyframes flash-wrong { 25% { transform: translateX(-3px); } 50% { transform: translateX(3px); } 75% { transform: translateX(-2px); } }

/* Tip of the day */
.tip-title { font-size: 15px; font-weight: 800; }
.tip-text { margin: 0; font-size: 13px; line-height: 1.55; color: var(--fg-1); }

/* Check-in week */
.checkin-card { margin-top: 12px; }
.ci-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.ci-day { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 9px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--card-2); }
.ci-day small { font-size: 10.5px; color: var(--fg-1); font-weight: 600; }
.ci-icon { font-size: 15px; font-weight: 800; line-height: 1.2; color: var(--fg-1); }
.ci-day.past { background: color-mix(in srgb, var(--success) 10%, var(--card-2)); border-color: color-mix(in srgb, var(--success) 35%, var(--line)); }
.ci-day.past .ci-icon { color: var(--success); }
.ci-day.today { border-color: var(--gold); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gold) 18%, transparent); }
.ci-day.today .ci-icon { color: var(--gold-text); }
.ci-day.chest { background: color-mix(in srgb, var(--gold) 10%, var(--card-2)); }
.lucky { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--fg-1); padding: 8px 12px; border-radius: 9px; border: 1px dashed var(--line); }
.lucky.found { color: var(--fg-0); border-style: solid; border-color: color-mix(in srgb, var(--success) 45%, var(--line)); background: color-mix(in srgb, var(--success) 8%, transparent); }

@media (max-width: 860px) {
    .act-grid { grid-template-columns: 1fr; }
    .spin-layout { grid-template-columns: 1fr; gap: 16px; }
    .event-card { grid-template-columns: 1fr; }
    .event-prize { border-left: 0; border-top: 1px solid var(--line); }
}
@media (max-width: 640px) {
    .ps-items { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ps-head { flex-wrap: wrap; }
    .ps-next { width: 100%; justify-content: center; }
    .redeem-count { display: none; }
}
@media (max-width: 420px) {
    .quiz-options, .sprint-options { grid-template-columns: 1fr; }
    .redeem-tab { padding: 0 8px; font-size: 12px; }
    .ci-row { gap: 3px; }
}

/* Profile studio */
.studio { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); margin-top: 14px; overflow: hidden; }
.studio-show { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 8%, var(--card)), var(--card) 70%); }
.studio-sub { font-size: 12.5px; color: var(--fg-1); margin-top: -4px; }
.studio .pv-card { max-width: none; padding: 12px 14px; box-shadow: 0 6px 20px var(--ds-shadow, rgba(0,0,0,.18)); }
.studio .pv-medal { width: 50px; height: 50px; font-size: 27px; }
.studio .pv-name { font-size: 14px; }
.studio-collection { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.coll-list { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.coll-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) 40px; gap: 10px; align-items: center; padding: 5px 6px; border: 0; border-radius: 7px; background: transparent; color: var(--fg-0); font-size: 12px; cursor: pointer; text-align: left; }
.coll-row:hover { background: var(--soft); }
.coll-label { font-weight: 600; }
.coll-count { text-align: right; color: var(--fg-1); font-weight: 700; }
.coll-row .bar { height: 5px; }
.slots-label { padding: 10px 18px 6px; }
.studio-collection-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--fg-1); font-weight: 600; }
.studio-slots { border-left: 1px solid var(--line); padding: 6px 0; }
.slot { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 9px 18px; }
.slot + .slot { border-top: 1px solid var(--line); }
.slot-icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 17px; background: color-mix(in srgb, var(--tint) 13%, transparent); color: var(--tint-text, var(--tint)); }
.slot-label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-1); }
.slot-value { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slot-actions { display: inline-flex; gap: 6px; align-items: center; }
.slot-actions .xbtn.icon.sm { width: 28px; }
.slot-actions .ico, .q-swap .ico { width: 13px; height: 13px; }
.slot-actions [aria-label^="Play"] .ico { fill: currentColor; }

/* Power-ups */
.powers { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-top: 16px; }
.power { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 12px; padding: 14px 16px; transition: border-color .2s, transform .2s; }
.power:hover { border-color: color-mix(in srgb, var(--tint) 45%, var(--line)); transform: translateY(-1px); }
.power-icon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; font-size: 21px; background: color-mix(in srgb, var(--tint) 14%, transparent); }
.power-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.power-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; font-weight: 700; }
.power-text { font-size: 12px; color: var(--fg-1); line-height: 1.45; flex: 1; }
.power .xbtn { align-self: flex-start; margin-top: auto; }
.power-body { height: 100%; }
.power-text { margin-bottom: 8px; }
.shake { animation: shake .5s ease-in-out infinite; }
@keyframes shake { 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }

/* Shop */
.shop-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 22px 0 10px; scroll-margin-top: 84px; }
.shop-balance { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 15px; font-weight: 800; color: var(--gold-text); }
.shop-kinds { margin-bottom: 12px; }
.shop-kinds .tab .ico { width: 14px; height: 14px; }
.shop-kinds .tab[aria-pressed="true"] { background: var(--card-2); color: var(--fg-0); box-shadow: 0 1px 2px var(--ds-shadow, rgba(0,0,0,.2)), inset 0 0 0 1px var(--line); }
.shop-kinds .tab[aria-pressed="true"] .count { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg-0); }
.q-side { display: inline-flex; align-items: center; gap: 6px; }
.q-swap { width: 28px !important; height: 28px; }
.rw-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.rw-foot { margin-top: auto; padding-top: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rw-state { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--fg-1); }
.rw-state .ico { width: 13px; height: 13px; }
.rw-state.ok { color: var(--success); }
.rw-state.preview { color: var(--gold-text); font-weight: 600; }
.rw.previewing { border-color: color-mix(in srgb, var(--gold) 60%, var(--line)); border-style: dashed; }
.rw-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }

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
@media (max-width: 960px) {
    .today { grid-template-columns: 1fr; }
    .today-side { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
}
@media (max-width: 860px) {
    .hero { grid-template-columns: 1fr; }
    .kpis { border-left: 0; border-top: 1px solid var(--line); grid-template-rows: none; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .kpi { grid-template-columns: 1fr; gap: 6px; padding: 14px 16px; }
    .kpi + .kpi { border-top: 0; border-left: 1px solid var(--line); }
    .kpi-side { align-items: flex-start; }
    .studio { grid-template-columns: 1fr; }
    .studio-slots { border-left: 0; border-top: 1px solid var(--line); }
}
@media (max-width: 640px) {
    .today-side { display: flex; align-items: stretch; }
    .ms-summary { grid-template-columns: 1fr; }
    .ms-overall .bar { width: 100px; }
    .q-chest { flex-wrap: wrap; }
}
@media (max-width: 560px) {
    .top { padding: 12px 16px; position: static; }
    .redeem { padding: 0; }
    .redeem-sheet { border-radius: 0; min-height: 100%; border: 0; }
    .redeem-head { top: 0; border-radius: 0; padding: 12px 16px; }
    .redeem-heading p { display: none; }
    .redeem-body { padding: 4px 16px 20px; }
    .top p { display: none; }
    .coffee img { height: 32px; }
    .page { padding: 14px 16px 32px; }
    .rank { flex-direction: column; text-align: center; padding: 20px 16px; }
    .rank-info { width: 100%; }
    .rank-name-row, .rank-redeem { justify-content: center; }
    .next-rank { text-align: left; }
    .section-head { flex-wrap: wrap; }
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
//# sourceMappingURL=milestoneTracker.js.map