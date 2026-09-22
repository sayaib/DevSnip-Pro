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
        assert.strictEqual(stats.activities.length, 2, "tool run plus the first_tool milestone");
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
        assert.strictEqual(stats.dailyPoints, stats.dailyEarnedPoints + milestoneBonus);
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
//# sourceMappingURL=milestone.unit.js.map