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
const milestoneTracker_1 = require("../../commands/milestoneTracker");
const milestone_view_1 = require("../../services/milestone-view");
const quests_1 = require("../../services/quests");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
function freshContext(seed = {}) {
    const context = (0, vscode_stub_1.createExtensionContext)(seed);
    (0, milestoneTracker_1.setMilestoneContext)(context);
    return context;
}
(0, run_unit_tests_1.suite)("milestone state", () => {
    (0, run_unit_tests_1.test)("starts from clean defaults", () => {
        const stats = (0, milestoneTracker_1.getUserStats)(freshContext());
        assert.strictEqual(stats.totalPoints, 0);
        assert.strictEqual(stats.streakDays, 1);
        assert.deepStrictEqual(stats.activities, []);
        assert.deepStrictEqual(stats.counters, { toolRuns: 0, snippetRuns: 0, securityRuns: 0, aiRuns: 0 });
    });
    (0, run_unit_tests_1.test)("repairs corrupted global state instead of throwing", () => {
        const corrupted = {
            devsnip_user_stats: {
                totalPoints: "not a number",
                activities: "definitely not an array",
                completedMilestones: [1, "first_tool", null],
                dailyClaims: { "2026-09-01": "yes" },
                dailyToolUsage: { tool: "many" },
                lastActiveDate: "garbage"
            }
        };
        const stats = (0, milestoneTracker_1.getUserStats)(freshContext(corrupted));
        assert.strictEqual(stats.totalPoints, 0);
        assert.deepStrictEqual(stats.activities, []);
        assert.deepStrictEqual(stats.completedMilestones, ["first_tool"]);
        assert.deepStrictEqual(stats.dailyClaims, {});
        assert.deepStrictEqual(stats.dailyToolUsage, {});
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(stats.lastActiveDate));
    });
    (0, run_unit_tests_1.test)("handles a completely unusable payload", () => {
        for (const payload of [null, 42, "string", []]) {
            const stats = (0, milestoneTracker_1.sanitizeStats)(payload);
            assert.strictEqual(stats.totalPoints, 0);
            assert.ok(Array.isArray(stats.activities));
        }
    });
    (0, run_unit_tests_1.test)("migrates older state by seeding counters from the activity log", () => {
        const legacy = {
            devsnip_user_stats: {
                totalPoints: 40,
                lastActiveDate: new Date().toISOString().slice(0, 10),
                activities: [
                    { id: "a", title: "Tool Use: x", points: 3, timestamp: Date.now(), category: "Core" },
                    { id: "b", title: "Tool Use: y", points: 8, timestamp: Date.now(), category: "Security" },
                    { id: "c", title: "Tool Use: z", points: 5, timestamp: Date.now(), category: "AI" }
                ]
            }
        };
        const stats = (0, milestoneTracker_1.getUserStats)(freshContext(legacy));
        assert.strictEqual(stats.counters.toolRuns, 3);
        assert.strictEqual(stats.counters.securityRuns, 1);
        assert.strictEqual(stats.counters.aiRuns, 1);
        assert.strictEqual(stats.totalPoints, 40, "migrating must not lose points");
    });
    (0, run_unit_tests_1.test)("a tool run is counted once and persists", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.openGUI");
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.counters.toolRuns, 1);
        // A quest the run happens to finish adds its own entry.
        assert.strictEqual(stats.activities.filter(a => a.category !== "Quest").length, 2, "tool run plus the first_tool milestone");
        assert.ok(stats.totalPoints >= 3);
    });
    (0, run_unit_tests_1.test)("concurrent tool runs do not lose points", async () => {
        const context = freshContext();
        await Promise.all([
            (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.openGUI"),
            (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.jsonFormatter"),
            (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.base64Encoder"),
            (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.urlEncoder"),
            (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.hashGenerator")
        ]);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).counters.toolRuns, 5);
    });
    (0, run_unit_tests_1.test)("repeated use of one tool is rate limited the same day", async () => {
        const context = freshContext();
        for (let i = 0; i < milestoneTracker_1.RATE_LIMIT_AFTER + 3; i++) {
            await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.base64Encoder");
        }
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        const runs = stats.activities.filter(activity => activity.id === "sayaib.hue-console.base64Encoder");
        const lateRuns = runs.slice(0, 3);
        assert.ok(lateRuns.every(activity => activity.points === 1), "runs past the daily limit are worth 1 point");
    });
    (0, run_unit_tests_1.test)("the daily cap bounds how fast points can be farmed", async () => {
        const context = freshContext();
        for (let i = 0; i < 120; i++) {
            await (0, milestoneTracker_1.autoRecordToolUsage)(`sayaib.hue-console.tool${i}`);
        }
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.ok(stats.dailyEarnedPoints <= milestoneTracker_1.DAILY_POINT_CAP, `grindable points ${stats.dailyEarnedPoints} exceeded the cap`);
        // One-time milestone bonuses are exempt from the cap but are finite, so the
        // day's total still cannot run away. (Derived from the milestone table, not
        // the activity log, which is deliberately trimmed.)
        const milestoneBonus = stats.completedMilestones
            .map(id => milestoneTracker_1.MILESTONES.find(milestone => milestone.id === id)?.points ?? 0)
            .reduce((sum, points) => sum + points, 0);
        // Quests and the all-done chest are one-time per day too.
        const questBonus = stats.quests.items
            .filter(item => item.done)
            .map(item => (0, quests_1.findQuest)(item.id)?.points ?? 0)
            .reduce((sum, points) => sum + points, 0) + (stats.quests.chestClaimed ? quests_1.QUEST_CHEST_POINTS : 0);
        assert.strictEqual(stats.dailyPoints, stats.dailyEarnedPoints + milestoneBonus + questBonus);
        assert.ok(stats.dailyPoints < 500, "a single day cannot produce an unbounded score");
    });
    (0, run_unit_tests_1.test)("milestones unlock once and only once", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.openGUI");
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.openGUI");
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        const unlocked = stats.activities.filter(activity => activity.id === "milestone_first_tool");
        assert.strictEqual(unlocked.length, 1);
        assert.strictEqual(stats.completedMilestones.filter(id => id === "first_tool").length, 1);
    });
    (0, run_unit_tests_1.test)("long-term milestones stay reachable after the activity log is trimmed", async () => {
        const context = freshContext();
        for (let i = 0; i < 30; i++) {
            await (0, milestoneTracker_1.autoRecordToolUsage)(`sayaib.hue-console.tool${i}`);
        }
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.counters.toolRuns, 30);
        assert.ok(stats.completedMilestones.includes("tool_explorer"), "25-run milestone must unlock from counters");
        assert.ok(stats.activities.length <= 100, "the activity log stays bounded");
    });
    (0, run_unit_tests_1.test)("redeeming points requires a sufficient balance and refunds restore it", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.recordActivity)(context, "seed", "Seed", 50, "Core");
        assert.strictEqual(await (0, milestoneTracker_1.redeemPoints)(context, 500, "too expensive"), false);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, 50);
        assert.strictEqual(await (0, milestoneTracker_1.redeemPoints)(context, 20, "premium tool"), true);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, 30);
        await (0, milestoneTracker_1.refundPoints)(context, 20, "premium tool failed");
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, 50);
    });
    (0, run_unit_tests_1.test)("a day rollover resets daily counters and extends the streak", () => {
        const yesterday = new Date(Date.now() - 86400000);
        const stamp = `${yesterday.getFullYear()}-${`${yesterday.getMonth() + 1}`.padStart(2, "0")}-${`${yesterday.getDate()}`.padStart(2, "0")}`;
        const context = freshContext({
            devsnip_user_stats: {
                ...(0, milestoneTracker_1.createDefaultStats)(),
                totalPoints: 100,
                dailyPoints: 90,
                streakDays: 4,
                lastActiveDate: stamp,
                dailyToolUsage: { "sayaib.hue-console.openGUI": 9 }
            }
        });
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.streakDays, 5);
        assert.strictEqual(stats.dailyPoints, 0);
        assert.deepStrictEqual(stats.dailyToolUsage, {});
        assert.strictEqual(stats.totalPoints, 100, "lifetime points survive the rollover");
    });
    (0, run_unit_tests_1.test)("a gap of several days breaks the streak", () => {
        const context = freshContext({
            devsnip_user_stats: { ...(0, milestoneTracker_1.createDefaultStats)(), streakDays: 9, lastActiveDate: "2020-01-01" }
        });
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).streakDays, 1);
    });
    (0, run_unit_tests_1.test)("reading stats twice never advances the streak on its own", () => {
        const yesterday = new Date(Date.now() - 86400000);
        const stamp = `${yesterday.getFullYear()}-${`${yesterday.getMonth() + 1}`.padStart(2, "0")}-${`${yesterday.getDate()}`.padStart(2, "0")}`;
        const context = freshContext({
            devsnip_user_stats: { ...(0, milestoneTracker_1.createDefaultStats)(), streakDays: 3, lastActiveDate: stamp }
        });
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).streakDays, 4);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).streakDays, 4, "repeated reads must be idempotent");
    });
    (0, run_unit_tests_1.test)("reset clears progress", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.recordActivity)(context, "seed", "Seed", 30, "Core");
        await (0, milestoneTracker_1.resetUserStats)(context);
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(stats.totalPoints, 0);
        assert.deepStrictEqual(stats.completedMilestones, []);
        assert.deepStrictEqual(stats.activities, []);
    });
    (0, run_unit_tests_1.test)("levels are ordered and resolve correctly at their boundaries", () => {
        assert.strictEqual((0, milestoneTracker_1.getCurrentLevel)(0).name, "Bronze");
        assert.strictEqual((0, milestoneTracker_1.getCurrentLevel)(149).name, "Bronze");
        assert.strictEqual((0, milestoneTracker_1.getCurrentLevel)(150).name, "Silver");
        assert.strictEqual((0, milestoneTracker_1.getCurrentLevel)(999999).name, "Grandmaster");
        assert.strictEqual((0, milestoneTracker_1.getNextLevel)(0)?.name, "Silver");
        assert.strictEqual((0, milestoneTracker_1.getNextLevel)(999999), null);
    });
    (0, run_unit_tests_1.test)("every milestone has a positive target and reward", () => {
        for (const milestone of milestoneTracker_1.MILESTONES) {
            assert.ok(milestone.target > 0, `${milestone.id} needs a target`);
            assert.ok(milestone.points > 0, `${milestone.id} needs a reward`);
        }
        assert.strictEqual(new Set(milestoneTracker_1.MILESTONES.map(m => m.id)).size, milestoneTracker_1.MILESTONES.length, "milestone ids must be unique");
    });
});
function viewFor(stats, extra = {}) {
    return (0, milestone_view_1.buildTrackerView)({
        stats: (0, milestoneTracker_1.sanitizeStats)(stats),
        levels: milestoneTracker_1.LEVELS,
        milestones: milestoneTracker_1.MILESTONES,
        progress: milestoneTracker_1.milestoneProgress,
        today: "2026-09-28",
        dailyCap: milestoneTracker_1.DAILY_POINT_CAP,
        rateLimitAfter: milestoneTracker_1.RATE_LIMIT_AFTER,
        loginPoints: 5,
        bonusPoints: 10,
        premium: [{ name: "Cheap tool", pointCost: 8 }, { name: "Mid tool", pointCost: 20 }, { name: "Big tool", pointCost: 35 }],
        toolNames: { "sayaib.hue-console.jsonFormatter": "JSON/XML Formatter" },
        ...extra
    });
}
(0, run_unit_tests_1.suite)("milestone lifetime points", () => {
    (0, run_unit_tests_1.test)("spending points lowers the balance but never the level", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.recordActivity)(context, "seed", "Seed", 100, "Core");
        await (0, milestoneTracker_1.recordActivity)(context, "seed2", "Seed", 20, "Core");
        await (0, milestoneTracker_1.recordActivity)(context, "seed3", "Seed", 0, "Core");
        const seeded = (0, milestoneTracker_1.getUserStats)(context);
        // Push the account past Silver without the daily cap getting in the way.
        await context.globalState.update("devsnip_user_stats", { ...seeded, totalPoints: 160, lifetimePoints: 160 });
        assert.strictEqual(await (0, milestoneTracker_1.redeemPoints)(context, 30, "premium tool"), true);
        const after = (0, milestoneTracker_1.getUserStats)(context);
        assert.strictEqual(after.totalPoints, 130);
        assert.strictEqual(after.lifetimePoints, 160, "spending must not reduce lifetime points");
        assert.strictEqual((0, milestoneTracker_1.getCurrentLevel)(after.lifetimePoints).name, "Silver", "a premium run must not demote the user");
        await (0, milestoneTracker_1.refundPoints)(context, 30, "premium tool failed");
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).lifetimePoints, 160, "a refund returns spent points; it is not new earning");
    });
    (0, run_unit_tests_1.test)("every earning path adds to lifetime points", async () => {
        const context = freshContext();
        await (0, milestoneTracker_1.autoRecordToolUsage)("sayaib.hue-console.jsonFormatter");
        const stats = (0, milestoneTracker_1.getUserStats)(context);
        // One tool run (+3) plus the First Tool milestone (+10).
        assert.strictEqual(stats.totalPoints, 13);
        assert.strictEqual(stats.lifetimePoints, 13);
    });
    (0, run_unit_tests_1.test)("older data without lifetime points is migrated from balance plus spending in the log", () => {
        const stats = (0, milestoneTracker_1.sanitizeStats)({
            totalPoints: 100,
            activities: [
                { id: "redeem_1", title: "Redeemed", points: -30, timestamp: 1, category: "Redemption" },
                { id: "refund_1", title: "Refunded", points: 10, timestamp: 2, category: "Redemption" },
                { id: "x", title: "Tool", points: 3, timestamp: 3, category: "Core" }
            ]
        });
        assert.strictEqual(stats.lifetimePoints, 120, "100 balance + 30 spent - 10 refunded");
        assert.strictEqual((0, milestoneTracker_1.sanitizeStats)({ totalPoints: 50, lifetimePoints: 20 }).lifetimePoints, 50, "lifetime can never be below the balance");
        assert.strictEqual((0, milestoneTracker_1.sanitizeStats)({ totalPoints: 50, lifetimePoints: "x" }).lifetimePoints, 50);
    });
    (0, run_unit_tests_1.test)("the daily login and daily boost are each claimed once per day", async () => {
        const context = freshContext();
        assert.strictEqual(await (0, milestoneTracker_1.claimDailyLogin)(context), true);
        assert.strictEqual(await (0, milestoneTracker_1.claimDailyLogin)(context), false);
        assert.strictEqual(await (0, milestoneTracker_1.claimDailyBonus)(context), true);
        assert.strictEqual(await (0, milestoneTracker_1.claimDailyBonus)(context), false);
        assert.strictEqual((0, milestoneTracker_1.getUserStats)(context).totalPoints, 15);
    });
});
(0, run_unit_tests_1.suite)("milestone tracker view", () => {
    (0, run_unit_tests_1.test)("level progress, points to next level and the ring percentage use lifetime points", () => {
        const view = viewFor({ totalPoints: 40, lifetimePoints: 375 });
        assert.strictEqual(view.level.name, "Silver");
        assert.strictEqual(view.nextLevel?.name, "Gold");
        assert.strictEqual(view.pointsToNext, 225);
        assert.strictEqual(view.levelPercent, 50, "(375 - 150) / (600 - 150)");
        assert.strictEqual(view.balance, 40);
        assert.deepStrictEqual(view.levels.map(l => l.state), ["achieved", "current", "locked", "locked", "locked", "locked", "locked"]);
    });
    (0, run_unit_tests_1.test)("the highest level reports 100% and no next level", () => {
        const view = viewFor({ totalPoints: 30000, lifetimePoints: 30000 });
        assert.strictEqual(view.nextLevel, null);
        assert.strictEqual(view.levelPercent, 100);
        assert.strictEqual(view.pointsToNext, 0);
        assert.strictEqual((0, milestone_view_1.levelIndexFor)(30000, milestoneTracker_1.LEVELS), milestoneTracker_1.LEVELS.length - 1);
    });
    (0, run_unit_tests_1.test)("milestones are ordered by closeness, with the closest as the focus and completed ones last", () => {
        const view = viewFor({
            counters: { toolRuns: 20, snippetRuns: 1, securityRuns: 4, aiRuns: 0 },
            completedMilestones: ["first_tool"],
            streakDays: 2
        });
        assert.strictEqual(view.focus?.id, "security_audit", "4 of 5 audits is the closest");
        assert.strictEqual(view.milestones[0].id, "security_audit");
        assert.strictEqual(view.milestones[view.milestones.length - 1].id, "first_tool");
        const explorer = view.milestones.find(m => m.id === "tool_explorer");
        assert.deepStrictEqual([explorer.current, explorer.percent, explorer.remainingLabel], [20, 80, "5 more tool runs"]);
        assert.strictEqual(view.milestoneSummary.completed, 1);
        assert.strictEqual(view.streak.next?.remaining, 3);
        assert.strictEqual(view.streak.next?.title, "Consistent Coder");
    });
    (0, run_unit_tests_1.test)("an unfinished milestone never shows 100%", () => {
        const view = viewFor({ totalPoints: 4999, lifetimePoints: 4999 });
        const tycoon = view.milestones.find(m => m.id === "points_5000");
        assert.strictEqual(tycoon.percent, 99);
        assert.strictEqual(tycoon.remainingLabel, "1 more point to earn");
    });
    (0, run_unit_tests_1.test)("today's progress, claims and what the balance can buy", () => {
        const view = viewFor({
            totalPoints: 25,
            lifetimePoints: 25,
            dailyEarnedPoints: 130,
            lastActiveDate: "2026-09-28",
            dailyClaims: { "2026-09-28": true }
        });
        assert.deepStrictEqual([view.today.earned, view.today.percent, view.today.capReached], [120, 100, true]);
        assert.strictEqual(view.today.loginClaimed, true);
        assert.strictEqual(view.today.bonusClaimed, false);
        assert.deepStrictEqual(view.spend, { affordable: 2, total: 3, cheapest: 8, next: { name: "Big tool", cost: 35, short: 10 } });
    });
    (0, run_unit_tests_1.test)("activity entries get readable titles and a kind", () => {
        const view = viewFor({
            activities: [
                { id: "sayaib.hue-console.jsonFormatter", title: "Tool Use: jsonFormatter", points: 3, timestamp: 3, category: "Core" },
                { id: "sayaib.hue-console.unknownTool", title: "Tool Use: unknownTool", points: 3, timestamp: 2, category: "Core" },
                { id: "milestone_first_tool", title: "Milestone Unlocked: First Tool Execution (+10 pts)", points: 10, timestamp: 1, category: "Milestone" },
                { id: "redeem_1", title: "Redeemed Points: Mock server (-12 pts)", points: -12, timestamp: 0, category: "Redemption" }
            ]
        });
        assert.deepStrictEqual(view.activities.map(a => [a.title, a.kind]), [
            ["JSON/XML Formatter", "tool"],
            ["unknownTool", "tool"],
            ["Milestone unlocked: First Tool Execution", "milestone"],
            ["Redeemed Points: Mock server", "spend"]
        ]);
    });
    (0, run_unit_tests_1.test)("tool names are read from the contributed command titles", () => {
        const names = (0, milestone_view_1.toolNamesFromManifest)([
            { command: "sayaib.hue-console.hashGenerator", title: "\ud83d\udd10 DevSnip Pro: Hash Generator" },
            { command: "sayaib.hue-console.openGUI", title: "\ud83d\udee2 DevSnip Pro: Rest API Client " },
            { command: 42, title: "broken" }
        ]);
        assert.deepStrictEqual(names, { "sayaib.hue-console.hashGenerator": "Hash Generator", "sayaib.hue-console.openGUI": "Rest API Client" });
        assert.deepStrictEqual((0, milestone_view_1.toolNamesFromManifest)(undefined), {});
    });
    (0, run_unit_tests_1.test)("the level list never claims a tool is locked behind a level", () => {
        for (const level of milestoneTracker_1.LEVELS) {
            assert.ok(!/unlock|locked|access/i.test(level.reward), `${level.name} reward text must not promise feature access`);
            assert.ok(!/#/.test(level.rank), `${level.name} rank must not carry a stray rank number`);
        }
    });
    (0, run_unit_tests_1.test)("the page loads its script only from the extension and the script parses", () => {
        const html = (0, milestoneTracker_1.getMilestoneTrackerHtml)("vscode-resource:", "vscode-resource:/media/milestone-tracker.js");
        assert.ok(/script-src vscode-resource:;/.test(html));
        assert.ok(!/script-src[^;]*unsafe-inline/.test(html));
        assert.ok(html.includes('<script src="vscode-resource:/media/milestone-tracker.js"></script>'));
        const script = fs.readFileSync(path.resolve(__dirname, "../../../media/milestone-tracker.js"), "utf8");
        assert.doesNotThrow(() => new Function(script));
        assert.ok(!/\.innerHTML\s*=/.test(script), "stored titles must never be written as HTML");
        for (const id of ["app", "spendBtn", "resetBtn", "celebrate", "celebrateBadge", "celebrateText"]) {
            assert.ok(html.includes(`id="${id}"`), `the page is missing #${id}, which the script uses`);
        }
    });
});
//# sourceMappingURL=milestone.unit.js.map