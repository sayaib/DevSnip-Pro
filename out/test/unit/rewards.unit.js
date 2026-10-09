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
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const milestoneTracker_1 = require("../../commands/milestoneTracker");
const quests_1 = require("../../services/quests");
const rewards_1 = require("../../services/rewards");
const profile_style_1 = require("../../services/profile-style");
const tools_sidebar_1 = require("../../sidebar/tools-sidebar");
const fs = __importStar(require("fs"));
const activities_1 = require("../../services/activities");
const path = __importStar(require("path"));
const service_1 = require("../../theme/service");
const themes_1 = require("../../theme/themes");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
function freshContext(seed = {}) {
    const context = (0, vscode_stub_1.createExtensionContext)(seed);
    (0, milestoneTracker_1.setMilestoneContext)(context);
    return context;
}
function localDate(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}
function seeded(stats) {
    return freshContext({ devsnip_user_stats: { ...(0, milestoneTracker_1.createDefaultStats)(), ...stats } });
}
/** Commands that between them finish any quest the pool can pick. */
const EVERY_QUEST_COMMANDS = [
    "sayaib.hue-console.openGUI",
    "sayaib.hue-console.databaseClient",
    "sayaib.hue-console.securityAudit",
    "sayaib.hue-console.createSnippet",
    "sayaib.hue-console.aiTokenCounter",
    "sayaib.hue-console.promptOptimizer",
    ...Array.from({ length: 6 }, (_, i) => `sayaib.hue-console.extraTool${i}`)
];
(0, run_unit_tests_1.suite)("daily quests", () => {
    (0, run_unit_tests_1.test)("every date gets the same three different quests, led by an easy one", () => {
        const sets = new Set();
        for (let day = 1; day <= 60; day++) {
            const date = `2026-${`${Math.ceil(day / 30)}`.padStart(2, "0")}-${`${((day - 1) % 28) + 1}`.padStart(2, "0")}`;
            const ids = (0, quests_1.pickDailyQuestIds)(date);
            assert.deepStrictEqual((0, quests_1.pickDailyQuestIds)(date), ids, "deterministic per date");
            assert.strictEqual(ids.length, 3);
            assert.strictEqual(new Set(ids).size, 3, "no repeats in a day");
            assert.ok((0, quests_1.findQuest)(ids[0])?.easy, "the first quest is always an easy one");
            assert.ok(ids.every(id => (0, quests_1.findQuest)(id)), "every picked quest exists");
            sets.add(ids.join(","));
        }
        assert.ok(sets.size >= 10, `quests vary from day to day (${sets.size} distinct sets)`);
    });
    (0, run_unit_tests_1.test)("each quest only counts the runs it describes", () => {
        const quests = { date: "2026-10-07", items: ["distinct_3", "new_tool", "security_1"].map(id => ({ id, progress: 0, done: false })), chestClaimed: false };
        const run = (over) => (0, quests_1.advanceQuests)(quests, { command: "sayaib.hue-console.x", category: "Core", newToday: false, firstEver: false, ...over });
        assert.deepStrictEqual(run({}), [], "a repeat run of a known tool moves nothing");
        run({ newToday: true });
        assert.strictEqual(quests.items[0].progress, 1);
        assert.deepStrictEqual(run({ firstEver: true }).map(q => q.id), ["new_tool"]);
        assert.deepStrictEqual(run({ firstEver: true }), [], "a finished quest is not paid twice");
        assert.deepStrictEqual(run({ category: "Security" }).map(q => q.id), ["security_1"]);
    });
    (0, run_unit_tests_1.test)("stored quests are repaired, and another day's quests are replaced", () => {
        const today = "2026-10-07";
        assert.deepStrictEqual((0, quests_1.sanitizeQuests)(null, today), (0, quests_1.createDailyQuests)(today));
        assert.deepStrictEqual((0, quests_1.sanitizeQuests)({ date: "2026-10-06", items: [], chestClaimed: true }, today), (0, quests_1.createDailyQuests)(today));
        const ids = (0, quests_1.pickDailyQuestIds)(today);
        const repaired = (0, quests_1.sanitizeQuests)({ date: today, items: [{ id: ids[0], progress: 999, done: false }, { id: "removed", progress: 1 }], chestClaimed: "yes" }, today);
        assert.deepStrictEqual(repaired.items.map(i => i.id), ids);
        assert.strictEqual(repaired.items[0].progress, (0, quests_1.findQuest)(ids[0]).target, "progress is clamped to the target");
        assert.strictEqual(repaired.items[0].done, true);
        assert.strictEqual(repaired.chestClaimed, false);
        assert.ok(quests_1.QUEST_POOL.every(q => q.target > 0 && q.points > 0));
    });
    (0, run_unit_tests_1.test)("tool runs finish today's quests, which pay past the daily cap, plus the chest once", async () => {
        const context = seeded({ dailyEarnedPoints: milestoneTracker_1.DAILY_POINT_CAP });
        const before = (0, milestoneTracker_1.getUserStats)(context);
        for (const command of EVERY_QUEST_COMMANDS)
            await (0, milestoneTracker_1.autoRecordToolUsage)(command);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.quests.items.every(item => item.done), `every quest done: ${JSON.stringify(stats.quests.items)}`);
        assert.strictEqual(stats.quests.chestClaimed, true);
        assert.strictEqual(stats.perfectQuestDays, 1);
        assert.strictEqual(stats.dailyEarnedPoints, milestoneTracker_1.DAILY_POINT_CAP, "tool runs earned nothing past the cap");
        const questPoints = stats.quests.items.reduce((sum, item) => sum + (0, quests_1.findQuest)(item.id).points, 0) + quests_1.QUEST_CHEST_POINTS;
        const milestonePoints = stats.activities.filter(a => a.category === "Milestone").reduce((sum, a) => sum + a.points, 0);
        assert.strictEqual(stats.lifetimePoints - before.lifetimePoints, questPoints + milestonePoints);
        await (0, milestoneTracker_1.autoRecordToolUsage)(EVERY_QUEST_COMMANDS[0]);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).perfectQuestDays, 1, "the chest pays once a day");
    });
    (0, run_unit_tests_1.test)("seven perfect days complete Quest Master and unlock the glow frame", async () => {
        const context = seeded({ perfectQuestDays: 6 });
        for (const command of EVERY_QUEST_COMMANDS)
            await (0, milestoneTracker_1.autoRecordToolUsage)(command);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.completedMilestones.includes("quest_master"));
        assert.ok(stats.unlocked.includes("frame_glow"));
        assert.strictEqual((0, rewards_1.activeFrame)(stats.unlocked), "glow");
    });
    (0, run_unit_tests_1.test)("older saved progress gains the new fields without losing anything", () => {
        const legacy = {
            totalPoints: 80, lifetimePoints: 120, streakDays: 3, lastActiveDate: localDate(),
            activities: [{ id: "sayaib.hue-console.jsonFormatter", title: "Tool Use: jsonFormatter", points: 3, timestamp: Date.now(), category: "Core" }]
        };
        const stats = (0, milestoneTracker_1.sanitizeStats)(legacy);
        assert.strictEqual(stats.totalPoints, 80);
        assert.strictEqual(stats.quests.date, localDate());
        assert.strictEqual(stats.quests.items.length, 3);
        assert.strictEqual(stats.streakFreezes, 0);
        assert.strictEqual(stats.bestStreak, 3);
        assert.deepStrictEqual(stats.unlocked, []);
        assert.deepStrictEqual(stats.toolsUsed, ["sayaib.hue-console.jsonFormatter"], "tools already used are not 'new'");
        assert.strictEqual(stats.weekly.weekStart, (0, milestoneTracker_1.weekStartOf)(localDate()));
        assert.strictEqual(stats.lastWeek, null);
    });
});
(0, run_unit_tests_1.suite)("streaks and freezes", () => {
    (0, run_unit_tests_1.test)("a freeze covers one missed day; without one the streak resets", () => {
        const covered = (0, milestoneTracker_1.getUserStats)(seeded({ streakDays: 4, streakFreezes: 1, lastActiveDate: localDate(-2) }));
        assert.strictEqual(covered.streakDays, 5);
        assert.strictEqual(covered.streakFreezes, 0);
        assert.ok(covered.activities.some(a => a.id === "streak_freeze_used"));
        const broken = (0, milestoneTracker_1.getUserStats)(seeded({ streakDays: 4, streakFreezes: 0, lastActiveDate: localDate(-2) }));
        assert.strictEqual(broken.streakDays, 1);
        assert.strictEqual(broken.bestStreak, 4, "the best streak is remembered");
    });
    (0, run_unit_tests_1.test)("two freezes cover two missed days, but not three", () => {
        const two = (0, milestoneTracker_1.getUserStats)(seeded({ streakDays: 10, streakFreezes: 2, lastActiveDate: localDate(-3) }));
        assert.strictEqual(two.streakDays, 11);
        assert.strictEqual(two.streakFreezes, 0);
        const three = (0, milestoneTracker_1.getUserStats)(seeded({ streakDays: 10, streakFreezes: 2, lastActiveDate: localDate(-4) }));
        assert.strictEqual(three.streakDays, 1);
        assert.strictEqual(three.streakFreezes, 2, "freezes are not wasted on a streak they cannot save");
    });
    (0, run_unit_tests_1.test)("a freeze is earned every 7 days, up to the maximum", () => {
        const earned = (0, milestoneTracker_1.getUserStats)(seeded({ streakDays: 6, streakFreezes: 0, lastActiveDate: localDate(-1) }));
        assert.strictEqual(earned.streakDays, 7);
        assert.strictEqual(earned.streakFreezes, 1);
        const capped = (0, milestoneTracker_1.getUserStats)(seeded({ streakDays: 13, streakFreezes: milestoneTracker_1.MAX_STREAK_FREEZES, lastActiveDate: localDate(-1) }));
        assert.strictEqual(capped.streakFreezes, milestoneTracker_1.MAX_STREAK_FREEZES);
        assert.strictEqual((0, milestoneTracker_1.sanitizeStats)({ streakFreezes: 99 }).streakFreezes, milestoneTracker_1.MAX_STREAK_FREEZES);
    });
    (0, run_unit_tests_1.test)("freezes can be bought with points, up to the maximum", async () => {
        assert.strictEqual(await (0, milestoneTracker_1.buyStreakFreeze)(seeded({ totalPoints: milestoneTracker_1.STREAK_FREEZE_COST - 1 })), "short");
        const context = seeded({ totalPoints: milestoneTracker_1.STREAK_FREEZE_COST * 3, lifetimePoints: milestoneTracker_1.STREAK_FREEZE_COST * 3 });
        assert.strictEqual(await (0, milestoneTracker_1.buyStreakFreeze)(context), "ok");
        assert.strictEqual(await (0, milestoneTracker_1.buyStreakFreeze)(context), "ok");
        assert.strictEqual(await (0, milestoneTracker_1.buyStreakFreeze)(context), "full");
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.streakFreezes, 2);
        assert.strictEqual(stats.totalPoints, milestoneTracker_1.STREAK_FREEZE_COST);
        assert.strictEqual(stats.lifetimePoints, milestoneTracker_1.STREAK_FREEZE_COST * 3, "spending never lowers lifetime points");
    });
    (0, run_unit_tests_1.test)("the login bonus grows with the streak, up to a cap", () => {
        assert.strictEqual((0, milestoneTracker_1.loginPointsFor)(1), 5);
        assert.strictEqual((0, milestoneTracker_1.loginPointsFor)(4), 8);
        assert.strictEqual((0, milestoneTracker_1.loginPointsFor)(11), 15);
        assert.strictEqual((0, milestoneTracker_1.loginPointsFor)(300), 15);
    });
});
(0, run_unit_tests_1.suite)("rewards", () => {
    (0, run_unit_tests_1.test)("every theme is a points reward; ranks and milestones earn only some", () => {
        assert.deepStrictEqual((0, rewards_1.earnedRewardIds)(0, []), []);
        assert.deepStrictEqual((0, rewards_1.earnedRewardIds)(6, []).filter(id => id.startsWith("theme_")), ["theme_solarized", "theme_synthwave", "theme_aurora"], "points-only themes are never earned");
        assert.ok((0, rewards_1.earnedRewardIds)(0, ["streak_14"]).includes("theme_ember"));
        const themeRewards = rewards_1.REWARDS.filter(r => r.kind === "theme");
        assert.deepStrictEqual(themeRewards.map(r => r.themeId).sort(), themes_1.THEMES.map(t => t.id).sort(), "one reward per theme");
        assert.ok(themeRewards.every(r => (r.cost ?? 0) > 0), "every theme has a price");
        assert.strictEqual(new Set(rewards_1.REWARDS.map(r => r.id)).size, rewards_1.REWARDS.length);
    });
    (0, run_unit_tests_1.test)("a new user starts with System Default only, and the cheapest theme is within a first session", () => {
        const fresh = (0, milestoneTracker_1.getUserStats)(seeded({}));
        for (const theme of themes_1.THEMES)
            assert.ok((0, milestoneTracker_1.themeLockFor)(fresh, theme.id), `${theme.id} is locked`);
        assert.strictEqual((0, milestoneTracker_1.themeLockFor)(fresh, "system"), undefined);
        assert.strictEqual((0, milestoneTracker_1.lockLabel)((0, milestoneTracker_1.themeLockFor)(fresh, "dracula")), "150 pts");
        assert.strictEqual((0, milestoneTracker_1.lockLabel)((0, milestoneTracker_1.themeLockFor)(fresh, "synthwave")), "Reach Gold or 500 pts");
        assert.ok(Math.min(...rewards_1.REWARDS.filter(r => r.kind === "theme").map(r => r.cost)) <= 25);
    });
    (0, run_unit_tests_1.test)("a theme is locked until earned, even before a write records the unlock", () => {
        const bronze = (0, milestoneTracker_1.getUserStats)(seeded({ lifetimePoints: 0 }));
        assert.match((0, milestoneTracker_1.themeLockFor)(bronze, "solarized").hint, /Reach Silver/);
        const silver = (0, milestoneTracker_1.getUserStats)(seeded({ lifetimePoints: 150 }));
        assert.deepStrictEqual(silver.unlocked, [], "nothing was written yet");
        assert.ok((0, milestoneTracker_1.effectiveUnlocked)(silver).includes("theme_solarized"));
        assert.strictEqual((0, milestoneTracker_1.themeLockFor)(silver, "solarized"), undefined);
    });
    (0, run_unit_tests_1.test)("themes can be unlocked early with points; frames only by earning them", async () => {
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(seeded({ totalPoints: 10 }), "theme_aurora"), "short");
        // Gold: Aurora is a Platinum reward, so it has to be bought.
        const context = seeded({ totalPoints: 1000, lifetimePoints: 1000 });
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(context, "theme_synthwave"), "owned", "Gold has already earned Synthwave");
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(context, "theme_aurora"), "ok");
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(context, "theme_aurora"), "owned");
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(context, "frame_flame"), "unknown");
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.unlocked.includes("theme_aurora"));
        assert.strictEqual(stats.totalPoints, 100);
    });
    (0, run_unit_tests_1.test)("a rank-up records its reward and announces both", async () => {
        const seen = [];
        (0, milestoneTracker_1.setCelebrationHandler)(items => seen.push(items));
        try {
            const context = seeded({ totalPoints: 148, lifetimePoints: 148 });
            await (0, milestoneTracker_1.recordActivity)(context, "test", "Test", 5, "Core");
            const stats = (0, milestoneTracker_1.getUserStats)(context);
            assert.ok(stats.unlocked.includes("theme_solarized"));
            const batch = seen[seen.length - 1];
            assert.ok(batch.some(c => c.kind === "level" && /Silver/.test(c.text)));
            assert.ok(batch.some(c => c.kind === "reward" && c.themeId === "solarized"));
        }
        finally {
            (0, milestoneTracker_1.setCelebrationHandler)(undefined);
        }
    });
    (0, run_unit_tests_1.test)("notifications follow the devsnip.rewards.notifications setting", () => {
        const config = vscode.workspace.configurationValues;
        const items = [
            { kind: "quest", icon: "⚡", text: "Quest complete: Warm up (+10 pts)" },
            { kind: "level", icon: "🥈", text: "Rank up! You are now Silver: Skilled Coder" }
        ];
        try {
            config["devsnip.rewards.notifications"] = "off";
            let count = vscode_stub_1.shownMessages.length;
            (0, milestoneTracker_1.showCelebrations)(items);
            assert.strictEqual(vscode_stub_1.shownMessages.length, count, "off shows nothing");
            config["devsnip.rewards.notifications"] = "levelsOnly";
            (0, milestoneTracker_1.showCelebrations)([items[0]]);
            assert.strictEqual(vscode_stub_1.shownMessages.length, count, "levelsOnly skips quests");
            (0, milestoneTracker_1.showCelebrations)(items);
            assert.strictEqual(vscode_stub_1.shownMessages.length, count + 1);
            assert.match(vscode_stub_1.shownMessages[vscode_stub_1.shownMessages.length - 1].message, /Silver/);
            assert.doesNotMatch(vscode_stub_1.shownMessages[vscode_stub_1.shownMessages.length - 1].message, /Warm up/);
            config["devsnip.rewards.notifications"] = "all";
            count = vscode_stub_1.shownMessages.length;
            (0, milestoneTracker_1.showCelebrations)(items);
            assert.strictEqual(vscode_stub_1.shownMessages.length, count + 1, "several wins share one notification");
            assert.match(vscode_stub_1.shownMessages[vscode_stub_1.shownMessages.length - 1].message, /Warm up.*Silver/);
        }
        finally {
            delete config["devsnip.rewards.notifications"];
        }
    });
    (0, run_unit_tests_1.test)("the theme service refuses a locked theme but lets it be previewed", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)({ "devsnip.appearance.theme": "synthwave" });
        (0, service_1.setThemeAccess)({ lock: id => (id === "synthwave" ? { hint: "Reach Gold", cost: 500, balance: 0 } : undefined), unlock: async () => false });
        try {
            (0, service_1.initThemes)(context);
            assert.strictEqual((0, service_1.currentThemeId)(), "system", "a stored theme that is locked again falls back");
            await assert.rejects((0, service_1.setTheme)("synthwave"), /locked/);
            await (0, service_1.setTheme)("synthwave", { preview: true });
            assert.strictEqual((0, service_1.currentThemeId)(), "synthwave");
            const choice = (0, service_1.themeChoices)().find(c => c.id === "synthwave");
            assert.strictEqual(choice.locked, true);
            assert.strictEqual(choice.lockHint, "Reach Gold or 500 pts");
            assert.ok(!(0, service_1.themeChoices)().find(c => c.id === "dracula").locked);
            await (0, service_1.setTheme)("system");
        }
        finally {
            (0, service_1.setThemeAccess)(undefined);
        }
    });
});
(0, run_unit_tests_1.suite)("themes become paid", () => {
    (0, run_unit_tests_1.test)("a theme already in use is kept free, once, with a notice", async () => {
        const context = freshContext({ "devsnip.appearance.theme": "dracula" });
        const seen = [];
        (0, milestoneTracker_1.setCelebrationHandler)(items => seen.push(items));
        let granted;
        (0, service_1.setThemeAccess)({
            lock: id => (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), id),
            unlock: async () => false,
            grant: id => (granted = (0, milestoneTracker_1.grantKeptTheme)(context, id))
        });
        try {
            (0, service_1.initThemes)(context);
            assert.strictEqual((0, service_1.currentThemeId)(), "dracula", "the theme in use stays");
            await granted;
            const stats = (0, milestoneTracker_1.getUserStats)(context);
            assert.ok(stats.unlocked.includes("theme_dracula"));
            assert.strictEqual(stats.totalPoints, 0, "it cost nothing");
            assert.ok(seen.flat().some(c => /keep Dracula for free/.test(c.text)));
            assert.strictEqual(context.globalState.get("devsnip.appearance.keptThemeGranted"), true);
            // Only once: a theme stored later (or after a reset) is not handed out again.
            await context.globalState.update("devsnip.appearance.theme", "cyberpunk");
            granted = undefined;
            (0, service_1.initThemes)(context);
            assert.strictEqual(granted, undefined);
            assert.strictEqual((0, service_1.currentThemeId)(), "system", "a locked stored theme falls back");
        }
        finally {
            (0, service_1.setThemeAccess)(undefined);
            (0, milestoneTracker_1.setCelebrationHandler)(undefined);
        }
    });
    (0, run_unit_tests_1.test)("previewing a locked theme never stores it", async () => {
        const context = freshContext({ "devsnip.appearance.keptThemeGranted": true });
        (0, service_1.setThemeAccess)({ lock: id => (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), id), unlock: async () => false });
        try {
            (0, service_1.initThemes)(context);
            await (0, service_1.setTheme)("nord", { preview: true });
            assert.strictEqual((0, service_1.currentThemeId)(), "nord");
            assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), undefined);
            await assert.rejects((0, service_1.setTheme)("nord"), /locked/);
            await (0, service_1.setTheme)("system");
        }
        finally {
            (0, service_1.setThemeAccess)(undefined);
        }
    });
});
(0, run_unit_tests_1.suite)("locked theme preview", () => {
    function setup(stats = {}) {
        const context = freshContext({
            devsnip_user_stats: { ...(0, milestoneTracker_1.createDefaultStats)(), ...stats },
            "devsnip.appearance.theme": "dark",
            "devsnip.appearance.keptThemeGranted": true
        });
        (0, service_1.setThemeAccess)({
            lock: id => (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), id),
            unlock: async (id) => (await (0, milestoneTracker_1.buyReward)(context, (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), id).rewardId)) === "ok"
        });
        (0, service_1.initThemes)(context);
        return context;
    }
    (0, run_unit_tests_1.test)("a locked theme is tried on every panel without being stored, then switched back", async () => {
        const context = setup({ unlocked: ["theme_dark"] });
        try {
            assert.strictEqual((0, service_1.currentThemeId)(), "dark");
            assert.strictEqual(await (0, service_1.previewLockedTheme)("dracula"), true);
            assert.strictEqual((0, service_1.currentThemeId)(), "dracula");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), "dracula");
            assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "dark", "nothing is stored");
            const status = vscode_stub_1.statusBarItems[vscode_stub_1.statusBarItems.length - 1];
            assert.ok(status.visible && /Dracula preview · 30s/.test(status.text), status.text);
            assert.match(vscode_stub_1.shownMessages[vscode_stub_1.shownMessages.length - 1].message, /Previewing Dracula.*150 points/);
            assert.match((0, service_1.themeChoices)().find(c => c.id === "dracula").lockHint, /150 pts/, "still locked while previewed");
            await (0, service_1.endLockedPreview)();
            assert.strictEqual((0, service_1.currentThemeId)(), "dark", "back to the theme the user chose");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), null);
            assert.strictEqual(status.visible, false, "the status bar item goes away");
        }
        finally {
            await (0, service_1.endLockedPreview)();
            (0, service_1.setThemeAccess)(undefined);
        }
    });
    (0, run_unit_tests_1.test)("the preview ends by itself and offers to unlock", async () => {
        setup({ unlocked: ["theme_dark"], totalPoints: 500, lifetimePoints: 500 });
        try {
            await (0, service_1.previewLockedTheme)("nord", 0.05);
            assert.strictEqual((0, service_1.currentThemeId)(), "nord");
            await new Promise(resolve => setTimeout(resolve, 150));
            assert.strictEqual((0, service_1.currentThemeId)(), "dark");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), null);
            assert.match(vscode_stub_1.shownMessages[vscode_stub_1.shownMessages.length - 1].message, /Nord preview ended\. Unlock it to keep it/);
        }
        finally {
            (0, service_1.setThemeAccess)(undefined);
        }
    });
    (0, run_unit_tests_1.test)("unlocking during a preview keeps the theme; picking another one ends it", async () => {
        const context = setup({ unlocked: ["theme_dark"], totalPoints: 500, lifetimePoints: 500 });
        try {
            await (0, service_1.previewLockedTheme)("monokai");
            await (0, service_1.previewLockedTheme)("cyberpunk");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), "cyberpunk", "a second preview replaces the first");
            await (0, service_1.setTheme)("dark");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), null, "choosing a theme for real ends the preview");
            await (0, service_1.previewLockedTheme)("monokai");
            assert.ok(await (async () => { const lock = (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), "monokai"); return (await (0, milestoneTracker_1.buyReward)(context, lock.rewardId)) === "ok"; })());
            await (0, service_1.setTheme)("monokai");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), null);
            assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "monokai", "now stored for good");
            assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, 350);
            assert.strictEqual(await (0, service_1.previewLockedTheme)("dark"), true, "an unlocked theme is simply applied");
            assert.strictEqual((0, service_1.lockedPreviewTheme)(), null);
            assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "dark");
        }
        finally {
            await (0, service_1.endLockedPreview)();
            (0, service_1.setThemeAccess)(undefined);
        }
    });
    (0, run_unit_tests_1.test)("the Rewards tab knows which locked theme is being previewed", async () => {
        const context = setup({ unlocked: ["theme_dark"] });
        try {
            await (0, service_1.previewLockedTheme)("dracula");
            const view = (0, milestoneTracker_1.buildMilestoneView)(context);
            const dracula = view.rewards.find(r => r.id === "theme_dracula");
            assert.strictEqual(dracula.previewing, true);
            assert.strictEqual(dracula.active, false, "a previewed theme is not 'in use'");
            assert.strictEqual(view.rewards.find(r => r.id === "theme_dark").previewing, false);
        }
        finally {
            await (0, service_1.endLockedPreview)();
            (0, service_1.setThemeAccess)(undefined);
        }
    });
});
(0, run_unit_tests_1.suite)("weekly recap", () => {
    (0, run_unit_tests_1.test)("a new week moves this week's numbers to last week, and the recap shows once", async () => {
        const lastMonday = (0, milestoneTracker_1.weekStartOf)(localDate(-7));
        const context = seeded({
            lastActiveDate: localDate(-7),
            weekly: { weekStart: lastMonday, points: 340, runs: 18, tools: ["a", "b", "c"] },
            lastWeek: { weekStart: (0, milestoneTracker_1.weekStartOf)(localDate(-14)), points: 200, runs: 9, tools: ["a"] }
        });
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.weekly.weekStart, (0, milestoneTracker_1.weekStartOf)(localDate()));
        assert.strictEqual(stats.weekly.points, 0);
        assert.deepStrictEqual(stats.lastWeek, { weekStart: lastMonday, points: 340, runs: 18, tools: ["a", "b", "c"], previousPoints: 200 });
        assert.strictEqual((0, milestoneTracker_1.pendingWeeklyRecap)(stats)?.weekStart, lastMonday);
        await (0, milestoneTracker_1.markRecapShown)(context, lastMonday);
        assert.strictEqual((0, milestoneTracker_1.pendingWeeklyRecap)((0, milestoneTracker_1.getUserStats)(context)), null);
    });
    (0, run_unit_tests_1.test)("a week with no activity has no recap; an older week is not called last week", () => {
        const quiet = (0, milestoneTracker_1.getUserStats)(seeded({ lastActiveDate: localDate(-7), weekly: { weekStart: (0, milestoneTracker_1.weekStartOf)(localDate(-7)), points: 0, runs: 0, tools: [] } }));
        assert.strictEqual((0, milestoneTracker_1.pendingWeeklyRecap)(quiet), null);
        const stale = (0, milestoneTracker_1.getUserStats)(seeded({ lastActiveDate: localDate(-21), weekly: { weekStart: (0, milestoneTracker_1.weekStartOf)(localDate(-21)), points: 50, runs: 5, tools: [] } }));
        assert.strictEqual(stale.lastWeek, null);
    });
    (0, run_unit_tests_1.test)("tool runs count towards this week", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.jsonFormatter");
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.jsonFormatter");
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.hashGenerator");
        const week = (0, milestoneTracker_1.getUserStats)(context).weekly;
        assert.strictEqual(week.runs, 3);
        assert.deepStrictEqual(week.tools, ["sayaib.hue-console.jsonFormatter", "sayaib.hue-console.hashGenerator"]);
        assert.strictEqual(week.points, (0, milestoneTracker_1.getUserStats)(context).lifetimePoints);
    });
});
(0, run_unit_tests_1.suite)("tracker view", () => {
    (0, run_unit_tests_1.test)("the page gets quests, rewards with unlock hints, freezes and this week", () => {
        const view = (0, milestoneTracker_1.buildMilestoneView)(seeded({ totalPoints: 300, lifetimePoints: 160, streakDays: 3, streakFreezes: 1 }));
        assert.strictEqual(view.quests.items.length, 3);
        assert.strictEqual(view.quests.done, 0);
        assert.strictEqual(view.rewards.length, rewards_1.REWARDS.length);
        const solarized = view.rewards.find(r => r.id === "theme_solarized");
        assert.strictEqual(solarized.unlocked, true, "Silver has earned it");
        assert.strictEqual(solarized.swatches.length, 4);
        const synthwave = view.rewards.find(r => r.id === "theme_synthwave");
        assert.strictEqual(synthwave.unlocked, false);
        assert.strictEqual(synthwave.hint, "Reach Gold");
        assert.strictEqual(synthwave.affordable, false);
        assert.strictEqual(view.streak.freezes, 1);
        assert.strictEqual(view.streak.canBuyFreeze, true);
        assert.strictEqual(view.today.loginPoints, (0, milestoneTracker_1.loginPointsFor)(3));
        assert.deepStrictEqual(view.week.current, { points: 0, runs: 0, tools: 0 });
        assert.ok(view.milestones.some(m => m.id === "quest_master" && /perfect|quest/i.test(m.remainingLabel)));
    });
});
(0, run_unit_tests_1.suite)("profile rewards", () => {
    const cosmetics = rewards_1.REWARDS.filter(r => r.kind !== "theme");
    (0, run_unit_tests_1.test)("every slot has rewards to buy and to earn, and each one names what it draws", () => {
        const effectsJs = fs.readFileSync(path.resolve(__dirname, "../../../media/reward-effects.js"), "utf8");
        for (const slot of rewards_1.SLOTS) {
            const inSlot = cosmetics.filter(r => r.kind === slot);
            assert.ok(inSlot.filter(r => r.cost !== undefined).length >= 4, `${slot} has at least four rewards to buy`);
            assert.ok(inSlot.every(r => r.cost === undefined || r.cost > 0), `${slot} prices are positive`);
        }
        for (const reward of cosmetics) {
            assert.ok(reward.cost !== undefined || reward.unlock, `${reward.id} can be bought or earned`);
            if (reward.kind === "avatar")
                assert.ok(reward.glyph, `${reward.id} has a glyph`);
            if (reward.kind === "frame")
                assert.ok(profile_style_1.FRAME_STYLES.includes(reward.frame), `${reward.id} has frame CSS`);
            if (reward.kind === "banner")
                assert.ok(profile_style_1.BANNER_STYLES.includes(reward.banner), `${reward.id} has banner CSS`);
            if (reward.kind === "effect")
                assert.ok(effectsJs.includes(`'${reward.effect}'`), `${reward.id} is drawn by reward-effects.js`);
        }
        assert.ok((0, rewards_1.earnedRewardIds)(6, []).includes("avatar_eagle"), "Grandmaster earns an exclusive avatar");
        assert.ok((0, rewards_1.earnedRewardIds)(0, ["feature_explorer"]).includes("title_pathfinder"));
        const css = (0, profile_style_1.profileCss)({ medal: [".m"], banner: [".b"], base: "var(--x)", ink: "var(--y)" });
        for (const name of profile_style_1.FRAME_STYLES)
            assert.ok(css.includes(`.m.frame-${name}`));
        for (const name of profile_style_1.BANNER_STYLES)
            assert.ok(css.includes(`.b.banner-${name}`));
    });
    (0, run_unit_tests_1.test)("stored loadouts are repaired: wrong kinds and unknown ids are dropped", () => {
        assert.deepStrictEqual((0, rewards_1.sanitizeLoadout)({ avatar: "avatar_fox", title: "avatar_fox", frame: null, banner: "nope", effect: 3 }), { avatar: "avatar_fox", frame: null });
        assert.deepStrictEqual((0, rewards_1.sanitizeLoadout)("junk"), {});
        const stats = (0, milestoneTracker_1.sanitizeStats)({ ...(0, milestoneTracker_1.createDefaultStats)(), equipped: { avatar: "avatar_fox", effect: "theme_dark" } });
        assert.deepStrictEqual(stats.equipped, { avatar: "avatar_fox" });
    });
    (0, run_unit_tests_1.test)("only owned rewards are worn; an earned frame shows until the slot is cleared", () => {
        const worn = (0, rewards_1.resolveLoadout)({ avatar: "avatar_fox" }, []);
        assert.strictEqual(worn.avatar, null, "not owned, so not worn");
        assert.strictEqual((0, rewards_1.resolveLoadout)({ avatar: "avatar_fox" }, ["avatar_fox"]).avatar?.glyph, "🦊");
        assert.strictEqual((0, rewards_1.activeFrame)(["frame_glow"]), "glow", "never chosen: the earned frame shows");
        assert.strictEqual((0, rewards_1.activeFrame)(["frame_glow"], { frame: null }), null, "cleared on purpose");
        assert.strictEqual((0, rewards_1.activeFrame)(["frame_glow", "frame_neon"], { frame: "frame_neon" }), "neon");
    });
    (0, run_unit_tests_1.test)("buying a profile reward equips it; equipping needs ownership; a reset takes it all off", async () => {
        const context = seeded({ totalPoints: 500, lifetimePoints: 500 });
        assert.strictEqual(await (0, milestoneTracker_1.equipReward)(context, "avatar", "avatar_fox"), "locked");
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(context, "avatar_fox"), "ok");
        assert.strictEqual(await (0, milestoneTracker_1.buyReward)(context, "title_regex"), "ok");
        let stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.totalPoints, 500 - 60 - 80);
        assert.deepStrictEqual(stats.equipped, { avatar: "avatar_fox", title: "title_regex" });
        assert.match(stats.activities[0].title, /Regex Wizard title/);
        assert.strictEqual(await (0, milestoneTracker_1.equipReward)(context, "avatar", "title_regex"), "unknown", "a title is not an avatar");
        assert.strictEqual(await (0, milestoneTracker_1.equipReward)(context, "title", null), "ok");
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).equipped.title, null);
        const status = (0, tools_sidebar_1.sidebarStatus)(context);
        assert.strictEqual(status.avatar, "🦊");
        assert.strictEqual(status.title, null);
        await (0, milestoneTracker_1.resetUserStats)(context);
        stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.deepStrictEqual(stats.equipped, {});
        assert.strictEqual((0, tools_sidebar_1.sidebarStatus)(context).avatar, null);
    });
    (0, run_unit_tests_1.test)("a mystery box gives a random profile reward not owned yet, and never replaces a chosen one", async () => {
        assert.deepStrictEqual(await (0, milestoneTracker_1.openMysteryBox)(seeded({ totalPoints: rewards_1.MYSTERY_BOX_COST - 1 })), { outcome: "short" });
        const context = seeded({ totalPoints: 1000, lifetimePoints: 1000, unlocked: ["avatar_cat"], equipped: { avatar: "avatar_cat" } });
        const pool = (0, rewards_1.mysteryBoxPool)(["avatar_cat"]);
        assert.ok(pool.every(r => r.kind !== "theme" && r.cost <= rewards_1.MYSTERY_BOX_MAX_VALUE && r.id !== "avatar_cat"));
        const box = await (0, milestoneTracker_1.openMysteryBox)(context, () => 0);
        assert.strictEqual(box.outcome, "ok");
        const reward = box.outcome === "ok" ? box.reward : undefined;
        assert.strictEqual(reward?.id, pool[0].id);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.unlocked.includes(reward.id));
        assert.strictEqual(stats.totalPoints, 1000 - rewards_1.MYSTERY_BOX_COST);
        if (reward.kind === "avatar")
            assert.strictEqual(stats.equipped.avatar, "avatar_cat", "the chosen avatar stays");
        else
            assert.strictEqual(stats.equipped[reward.kind], reward.id, "an empty slot is filled");
        const everything = (0, rewards_1.mysteryBoxPool)([]).map(r => r.id);
        assert.deepStrictEqual(await (0, milestoneTracker_1.openMysteryBox)(seeded({ totalPoints: 1000, unlocked: everything })), { outcome: "empty" });
        assert.strictEqual((0, rewards_1.pickMysteryReward)([], () => 0.5), undefined);
        assert.strictEqual((0, rewards_1.pickMysteryReward)(pool, () => 0.9999)?.id, pool[pool.length - 1].id);
    });
    (0, run_unit_tests_1.test)("a quest can be swapped for points, twice a day, and the swap survives a reload", async () => {
        const today = (0, quests_1.createDailyQuests)(localDate());
        const first = today.items[1].id;
        const context = seeded({ totalPoints: 100, quests: today });
        const swap = await (0, milestoneTracker_1.rerollDailyQuest)(context, first, () => 0);
        assert.strictEqual(swap.outcome, "ok");
        let stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(!stats.quests.items.some(item => item.id === first), "the old quest is gone");
        assert.strictEqual(new Set(stats.quests.items.map(item => item.id)).size, 3);
        assert.strictEqual(stats.quests.rerolls, 1);
        assert.strictEqual(stats.totalPoints, 100 - quests_1.QUEST_REROLL_COST);
        assert.strictEqual((await (0, milestoneTracker_1.rerollDailyQuest)(context, stats.quests.items[2].id)).outcome, "ok");
        assert.strictEqual((await (0, milestoneTracker_1.rerollDailyQuest)(context, stats.quests.items[0].id)).outcome, "limit", `only ${quests_1.MAX_REROLLS_PER_DAY} a day`);
        stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.totalPoints, 100 - 2 * quests_1.QUEST_REROLL_COST);
        const done = (0, quests_1.createDailyQuests)(localDate());
        done.items[0].done = true;
        done.items[0].progress = (0, quests_1.findQuest)(done.items[0].id).target;
        assert.strictEqual((await (0, milestoneTracker_1.rerollDailyQuest)(seeded({ totalPoints: 100, quests: done }), done.items[0].id)).outcome, "done");
        assert.strictEqual((await (0, milestoneTracker_1.rerollDailyQuest)(seeded({ totalPoints: 0 }), (0, quests_1.createDailyQuests)(localDate()).items[0].id)).outcome, "short");
        // A tampered set (duplicates) falls back to the day's pick.
        const bad = { ...(0, quests_1.createDailyQuests)(localDate()), rerolls: 1 };
        bad.items = [bad.items[0], bad.items[0], bad.items[1]];
        assert.deepStrictEqual((0, quests_1.sanitizeQuests)(bad, localDate()).items.map(item => item.id), (0, quests_1.pickDailyQuestIds)(localDate()));
        assert.strictEqual((0, quests_1.rerollQuest)((0, quests_1.createDailyQuests)(localDate()), "missing"), undefined);
    });
    (0, run_unit_tests_1.test)("the page gets the profile, the shop and which quests can be swapped", async () => {
        const context = seeded({ totalPoints: 400, lifetimePoints: 700 });
        await (0, milestoneTracker_1.buyReward)(context, "banner_ocean");
        await (0, milestoneTracker_1.buyReward)(context, "effect_confetti");
        const view = (0, milestoneTracker_1.buildMilestoneView)(context);
        assert.strictEqual(view.profile.badge, "🥇");
        assert.strictEqual(view.profile.banner?.value, "ocean");
        assert.strictEqual(view.profile.effect?.value, "confetti");
        assert.strictEqual(view.profile.avatar, null);
        assert.ok(view.rewards.find(r => r.id === "banner_ocean").active);
        assert.strictEqual(view.rewards.find(r => r.id === "avatar_fox").glyph, "🦊");
        assert.strictEqual(view.shop.reroll.left, quests_1.MAX_REROLLS_PER_DAY);
        assert.strictEqual(view.shop.box.cost, rewards_1.MYSTERY_BOX_COST);
        assert.strictEqual(view.shop.collected, 2);
        assert.strictEqual(view.shop.collectible, rewards_1.REWARDS.filter(r => r.kind !== "theme").length);
        assert.ok(view.quests.items.every(q => q.canReroll), "enough points and swaps left");
    });
    (0, run_unit_tests_1.test)("both pages load the shared effects script", () => {
        assert.match((0, milestoneTracker_1.getMilestoneTrackerHtml)("csp", "s.js", "c.png", "fx.js"), /<script src="fx.js"><\/script>/);
        const html = (0, tools_sidebar_1.renderToolsSidebar)({ cspSource: "x", scriptUri: "s.js", effectsUri: "fx.js", codiconsUri: "c.css", status: (0, tools_sidebar_1.sidebarStatus)(seeded({})), expanded: [] });
        assert.match(html, /<script nonce="[^"]+" src="fx.js"><\/script>/);
        assert.ok(html.indexOf("fx.js") < html.indexOf('src="s.js"'), "effects load before the sidebar script");
    });
});
(0, run_unit_tests_1.suite)("daily activities", () => {
    const today = localDate();
    const pointsOnly = activities_1.WHEEL.findIndex(segment => "points" in segment.prize);
    /** A random() that lands the wheel on segment `index`. */
    const landOn = (index) => {
        const total = activities_1.WHEEL.reduce((sum, segment) => sum + segment.weight, 0);
        const before = activities_1.WHEEL.slice(0, index).reduce((sum, segment) => sum + segment.weight, 0);
        return () => (before + activities_1.WHEEL[index].weight / 2) / total;
    };
    (0, run_unit_tests_1.test)("the challenge bank is well formed and every question comes up before any repeats", () => {
        assert.ok(activities_1.QUIZ_BANK.length >= 30);
        assert.strictEqual(new Set(activities_1.QUIZ_BANK.map(q => q.id)).size, activities_1.QUIZ_BANK.length);
        for (const q of activities_1.QUIZ_BANK) {
            assert.strictEqual(q.options.length, 4, `${q.id} has four answers`);
            assert.strictEqual(new Set(q.options).size, 4, `${q.id} answers are different`);
            assert.ok(q.answer >= 0 && q.answer < 4, `${q.id} answer index`);
            assert.ok(q.explain.length > 20, `${q.id} explains the answer`);
        }
        assert.strictEqual((0, activities_1.quizForDate)("2026-10-08").id, (0, activities_1.quizForDate)("2026-10-08").id, "same question all day");
        const start = Date.parse("2026-03-02T00:00:00Z");
        const firstDayOfCycle = Math.ceil(start / 86400000 / activities_1.QUIZ_BANK.length) * activities_1.QUIZ_BANK.length;
        const seen = new Set();
        for (let i = 0; i < activities_1.QUIZ_BANK.length; i++)
            seen.add((0, activities_1.quizForDate)(new Date((firstDayOfCycle + i) * 86400000).toISOString().slice(0, 10)).id);
        assert.strictEqual(seen.size, activities_1.QUIZ_BANK.length, "a full cycle shows every question once");
    });
    (0, run_unit_tests_1.test)("every tip opens a real DevSnip Pro command", () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
        const commands = new Set(pkg.contributes.commands.map((c) => c.command));
        for (const tip of activities_1.TIPS)
            assert.ok(commands.has(tip.command), `${tip.id} → ${tip.command}`);
        assert.ok(activities_1.TIPS.some(tip => tip.id === (0, activities_1.tipForDate)(today).id));
    });
    (0, run_unit_tests_1.test)("the wheel follows its weights", () => {
        assert.strictEqual((0, activities_1.spinWheel)(() => 0), 0);
        assert.strictEqual((0, activities_1.spinWheel)(() => 0.999999), activities_1.WHEEL.length - 1);
        for (let i = 0; i < activities_1.WHEEL.length; i++)
            assert.strictEqual((0, activities_1.spinWheel)(landOn(i)), i);
    });
    (0, run_unit_tests_1.test)("one free spin a day, plus a bonus spin for finishing every quest", async () => {
        const context = seeded({ totalPoints: 0, lifetimePoints: 0 });
        assert.strictEqual((0, milestoneTracker_1.activitiesWaiting)((0, milestoneTracker_1.getUserStats)(context)), 4, "spin, challenge, Bit Sprint and tip");
        const spin = await (0, milestoneTracker_1.spinDailyWheel)(context, landOn(pointsOnly));
        assert.strictEqual(spin.outcome, "ok");
        const won = activities_1.WHEEL[pointsOnly].prize.points;
        let stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.totalPoints, won);
        assert.strictEqual(stats.play.lastSpin, pointsOnly);
        assert.deepStrictEqual(await (0, milestoneTracker_1.spinDailyWheel)(context), { outcome: "used" });
        for (const command of EVERY_QUEST_COMMANDS) {
            for (let i = 0; i < 2; i++)
                await (0, milestoneTracker_1.autoRecordToolUsage)(command);
        }
        stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.quests.chestClaimed);
        assert.strictEqual(stats.play.bonusSpins, 1);
        assert.strictEqual((await (0, milestoneTracker_1.spinDailyWheel)(context, landOn(pointsOnly))).outcome, "ok", "the bonus spin");
        assert.deepStrictEqual(await (0, milestoneTracker_1.spinDailyWheel)(context), { outcome: "used" });
    });
    (0, run_unit_tests_1.test)("a freeze prize falls back to points when freezes are full; an item prize gives a profile reward", async () => {
        const freeze = activities_1.WHEEL.findIndex(segment => "freeze" in segment.prize);
        const item = activities_1.WHEEL.findIndex(segment => "item" in segment.prize);
        const empty = seeded({});
        await (0, milestoneTracker_1.spinDailyWheel)(empty, landOn(freeze));
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(empty).streakFreezes, 1);
        const full = seeded({ streakFreezes: milestoneTracker_1.MAX_STREAK_FREEZES });
        await (0, milestoneTracker_1.spinDailyWheel)(full, landOn(freeze));
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(full).totalPoints, activities_1.WHEEL_FALLBACK_POINTS);
        const lucky = seeded({});
        const spin = await (0, milestoneTracker_1.spinDailyWheel)(lucky, landOn(item));
        assert.ok(spin.outcome === "ok" && /the .+ (avatar|title|badge frame|banner|celebration effect)/.test(spin.text), spin.outcome === "ok" ? spin.text : "");
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(lucky).unlocked.length, 1);
    });
    (0, run_unit_tests_1.test)("the page shows what a spin really paid, not just the slice it stopped on", async () => {
        const freeze = activities_1.WHEEL.findIndex(segment => "freeze" in segment.prize);
        const item = activities_1.WHEEL.findIndex(segment => "item" in segment.prize);
        const full = seeded({ streakFreezes: milestoneTracker_1.MAX_STREAK_FREEZES });
        await (0, milestoneTracker_1.spinDailyWheel)(full, landOn(freeze));
        const paid = (0, milestoneTracker_1.buildMilestoneView)(full).play.wheel;
        assert.strictEqual(paid.lastSpin, freeze);
        assert.deepStrictEqual(paid.prize, { text: `+${activities_1.WHEEL_FALLBACK_POINTS} points (your freezes are full)`, points: activities_1.WHEEL_FALLBACK_POINTS, rewardId: null });
        assert.strictEqual(paid.segments[freeze].kind, "freeze");
        assert.strictEqual(paid.fallbackPoints, activities_1.WHEEL_FALLBACK_POINTS);
        const lucky = seeded({});
        await (0, milestoneTracker_1.spinDailyWheel)(lucky, landOn(item));
        const won = (0, milestoneTracker_1.getUserStats)(lucky).unlocked[0];
        assert.strictEqual((0, milestoneTracker_1.buildMilestoneView)(lucky).play.wheel.prize?.rewardId, won, "an item prize names the reward, so it can be worn");
        // A stored prize survives a reload but loses anything it should not have.
        const tampered = seeded({ play: { ...(0, milestoneTracker_1.getUserStats)(lucky).play, prize: { text: "x".repeat(200), points: 9999, rewardId: "not_a_reward" } } });
        assert.deepStrictEqual((0, milestoneTracker_1.getUserStats)(tampered).play.prize, { text: "x".repeat(80), points: 100 });
        assert.strictEqual((0, milestoneTracker_1.buildMilestoneView)(seeded({})).play.wheel.prize, null, "nothing before the first spin");
    });
    (0, run_unit_tests_1.test)("the daily challenge pays once, more when right, and keeps its answer secret until then", async () => {
        const question = (0, activities_1.quizForDate)(today);
        const context = seeded({});
        const before = (0, milestoneTracker_1.buildMilestoneView)(context).play.quiz;
        assert.strictEqual(before.answer, null, "the answer is not sent before answering");
        assert.strictEqual(before.explain, null);
        const result = await (0, milestoneTracker_1.answerDailyQuiz)(context, question.answer);
        assert.ok(result.outcome === "ok" && result.correct && result.points === activities_1.QUIZ_CORRECT_POINTS);
        assert.deepStrictEqual(await (0, milestoneTracker_1.answerDailyQuiz)(context, 0), { outcome: "answered" });
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.totalPoints, activities_1.QUIZ_CORRECT_POINTS);
        assert.strictEqual(stats.quizCorrect, 1);
        assert.strictEqual(stats.quizStreak, 1);
        assert.strictEqual((0, milestoneTracker_1.buildMilestoneView)(context).play.quiz.answer, question.answer);
        const wrong = seeded({ quizStreak: 4, quizLastCorrect: localDate(-1) });
        const miss = await (0, milestoneTracker_1.answerDailyQuiz)(wrong, (question.answer + 1) % 4);
        assert.ok(miss.outcome === "ok" && !miss.correct && miss.points === activities_1.QUIZ_TRY_POINTS);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(wrong).quizStreak, 0);
        const streak = seeded({ quizStreak: 4, quizLastCorrect: localDate(-1) });
        await (0, milestoneTracker_1.answerDailyQuiz)(streak, question.answer);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(streak).quizStreak, 5, "yesterday's streak continues");
        assert.deepStrictEqual(await (0, milestoneTracker_1.answerDailyQuiz)(seeded({}), 9), { outcome: "invalid" });
    });
    (0, run_unit_tests_1.test)("ten correct answers complete Sharp Mind and unlock its title", async () => {
        const context = seeded({ quizCorrect: 9 });
        await (0, milestoneTracker_1.answerDailyQuiz)(context, (0, activities_1.quizForDate)(today).answer);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.completedMilestones.includes("quiz_10"));
        assert.ok((0, milestoneTracker_1.effectiveUnlocked)(stats).includes("title_sharp_mind"));
    });
    (0, run_unit_tests_1.test)("Bit Sprint pays the day's first game, capped, and later games only chase the best", async () => {
        const context = seeded({});
        const first = await (0, milestoneTracker_1.finishBitSprint)(context, 14);
        assert.deepStrictEqual(first, { outcome: "ok", points: activities_1.SPRINT_MAX_POINTS, score: 14, best: 14, newBest: true, paid: true });
        const second = await (0, milestoneTracker_1.finishBitSprint)(context, 999);
        assert.strictEqual(second.points, 0);
        assert.strictEqual(second.score, activities_1.SPRINT_MAX_SCORE, "impossible scores are clamped");
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, activities_1.SPRINT_MAX_POINTS);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).sprintBest, activities_1.SPRINT_MAX_SCORE);
    });
    (0, run_unit_tests_1.test)("the tip of the day pays once and names the tool to open", async () => {
        const context = seeded({});
        assert.deepStrictEqual(await (0, milestoneTracker_1.tryDailyTip)(context), { command: (0, activities_1.tipForDate)(today).command, points: activities_1.TIP_POINTS });
        assert.deepStrictEqual(await (0, milestoneTracker_1.tryDailyTip)(context), { command: (0, activities_1.tipForDate)(today).command, points: 0 });
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, activities_1.TIP_POINTS);
        assert.strictEqual((0, milestoneTracker_1.activitiesWaiting)((0, milestoneTracker_1.getUserStats)(context)), 3);
    });
    (0, run_unit_tests_1.test)("weekly events rotate, and each has an exclusive reward only it can give", () => {
        const ids = new Set();
        for (let week = 0; week < activities_1.WEEKLY_EVENTS.length; week++)
            ids.add((0, activities_1.eventForWeek)(addDaysIso("2026-10-05", week * 7)).id);
        assert.strictEqual(ids.size, activities_1.WEEKLY_EVENTS.length, "six weeks show all six events");
        for (const event of activities_1.WEEKLY_EVENTS) {
            const reward = rewards_1.REWARDS.find(r => r.id === event.rewardId);
            assert.ok(reward, `${event.id} prize exists`);
            assert.deepStrictEqual(reward.unlock, { event: event.id });
            assert.strictEqual(reward.cost, undefined, "event prizes cannot be bought");
            assert.ok(!(0, rewards_1.mysteryBoxPool)([]).some(r => r.id === reward.id), "or won in a box");
        }
    });
    (0, run_unit_tests_1.test)("tool runs move the week's event, which pays once and unlocks its prize", async () => {
        const context = seeded({});
        const event = (0, activities_1.eventForWeek)((0, milestoneTracker_1.weekStartOf)(today));
        const stats0 = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats0.event.id, event.id);
        const commands = {
            security_week: "sayaib.hue-console.securityAudit",
            ai_week: "sayaib.hue-console.aiTokenCounter",
            snippet_week: "sayaib.hue-console.createSnippet",
            api_week: "sayaib.hue-console.openGUI"
        };
        for (let i = 0; i < event.target + 2; i++) {
            await (0, milestoneTracker_1.autoRecordToolUsage)(commands[event.id] ?? `sayaib.hue-console.eventTool${i}`);
        }
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.event.done, `${event.id} done`);
        assert.strictEqual(stats.eventsWon, 1, "paid once");
        assert.ok(stats.unlocked.includes(event.rewardId));
        assert.ok(stats.activities.filter(a => a.id === `event_${event.id}`).length === 1);
        assert.match((0, milestoneTracker_1.buildMilestoneView)(context).rewards.find(r => r.id === event.rewardId).hint, new RegExp(`Win ${event.title}`));
    });
    (0, run_unit_tests_1.test)("every 7th check-in day opens a chest with a profile reward", async () => {
        const context = seeded({ streakDays: 7, lastActiveDate: today, dailyClaims: {} });
        await (0, milestoneTracker_1.claimDailyLogin)(context);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.unlocked.length, 1, "one reward from the chest");
        assert.ok(stats.activities.some(a => a.id === "play_checkin"));
        const day3 = seeded({ streakDays: 3, lastActiveDate: today, dailyClaims: {} });
        await (0, milestoneTracker_1.claimDailyLogin)(day3);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(day3).unlocked.length, 0);
        assert.strictEqual((0, milestoneTracker_1.buildMilestoneView)(day3).play.checkin.day, 3);
    });
    (0, run_unit_tests_1.test)("a lucky find happens at most once a day", async () => {
        try {
            (0, milestoneTracker_1.setActivityRandom)(() => 0);
            const context = seeded({ dailyEarnedPoints: milestoneTracker_1.DAILY_POINT_CAP });
            await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.jsonFormatter");
            await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.hashGenerator");
            const stats = (0, milestoneTracker_1.getUserStats)(context);
            assert.ok(stats.play.lucky);
            assert.strictEqual(stats.activities.filter(a => a.id === "lucky_find").length, 1);
            assert.ok(stats.totalPoints >= activities_1.LUCKY_POINTS, "paid past the daily cap");
        }
        finally {
            (0, milestoneTracker_1.setActivityRandom)(() => 1);
        }
    });
    (0, run_unit_tests_1.test)("activities reset with the day, and the Tools view shows how many wait", async () => {
        const context = seeded({ play: { date: localDate(-1), spinsUsed: 1, bonusSpins: 0, lastSpin: 0, quizChoice: 2, tipTried: true, sprintScore: 5, lucky: true } });
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.play.date, today);
        assert.strictEqual(stats.play.quizChoice, null);
        assert.strictEqual((0, tools_sidebar_1.sidebarStatus)(context).play, 4);
        const html = (0, tools_sidebar_1.renderToolsSidebar)({ cspSource: "x", scriptUri: "s.js", codiconsUri: "c.css", status: (0, tools_sidebar_1.sidebarStatus)(context), expanded: [] });
        assert.match(html, /id="playChip"/);
    });
});
function addDaysIso(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
//# sourceMappingURL=rewards.unit.js.map