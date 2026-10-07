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
        assert.deepStrictEqual((0, rewards_1.earnedRewardIds)(6, []), ["theme_solarized", "theme_synthwave", "theme_aurora"], "points-only themes are never earned");
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
//# sourceMappingURL=rewards.unit.js.map