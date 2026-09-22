import * as assert from "assert";
import {
  DAILY_POINT_CAP,
  RATE_LIMIT_AFTER,
  MILESTONES,
  autoRecordToolUsage,
  createDefaultStats,
  getCurrentLevel,
  getNextLevel,
  getUserStats,
  recordActivity,
  redeemPoints,
  refundPoints,
  resetUserStats,
  sanitizeStats,
  setMilestoneContext
} from "../../commands/milestoneTracker";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

function freshContext(seed: Record<string, unknown> = {}): any {
  const context = createExtensionContext(seed);
  setMilestoneContext(context);
  return context;
}

suite("milestone state", () => {
  test("starts from clean defaults", () => {
    const stats = getUserStats(freshContext());
    assert.strictEqual(stats.totalPoints, 0);
    assert.strictEqual(stats.streakDays, 1);
    assert.deepStrictEqual(stats.activities, []);
    assert.deepStrictEqual(stats.counters, { toolRuns: 0, snippetRuns: 0, securityRuns: 0, aiRuns: 0 });
  });

  test("repairs corrupted global state instead of throwing", () => {
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
    const stats = getUserStats(freshContext(corrupted));
    assert.strictEqual(stats.totalPoints, 0);
    assert.deepStrictEqual(stats.activities, []);
    assert.deepStrictEqual(stats.completedMilestones, ["first_tool"]);
    assert.deepStrictEqual(stats.dailyClaims, {});
    assert.deepStrictEqual(stats.dailyToolUsage, {});
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(stats.lastActiveDate));
  });

  test("handles a completely unusable payload", () => {
    for (const payload of [null, 42, "string", []]) {
      const stats = sanitizeStats(payload);
      assert.strictEqual(stats.totalPoints, 0);
      assert.ok(Array.isArray(stats.activities));
    }
  });

  test("migrates older state by seeding counters from the activity log", () => {
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
    const stats = getUserStats(freshContext(legacy));
    assert.strictEqual(stats.counters.toolRuns, 3);
    assert.strictEqual(stats.counters.securityRuns, 1);
    assert.strictEqual(stats.counters.aiRuns, 1);
    assert.strictEqual(stats.totalPoints, 40, "migrating must not lose points");
  });

  test("a tool run is counted once and persists", async () => {
    const context = freshContext();
    await autoRecordToolUsage("sayaib.hue-console.openGUI");
    const stats = getUserStats(context);
    assert.strictEqual(stats.counters.toolRuns, 1);
    assert.strictEqual(stats.activities.length, 2, "tool run plus the first_tool milestone");
    assert.ok(stats.totalPoints >= 3);
  });

  test("concurrent tool runs do not lose points", async () => {
    const context = freshContext();
    await Promise.all([
      autoRecordToolUsage("sayaib.hue-console.openGUI"),
      autoRecordToolUsage("sayaib.hue-console.jsonFormatter"),
      autoRecordToolUsage("sayaib.hue-console.base64Encoder"),
      autoRecordToolUsage("sayaib.hue-console.urlEncoder"),
      autoRecordToolUsage("sayaib.hue-console.hashGenerator")
    ]);
    assert.strictEqual(getUserStats(context).counters.toolRuns, 5);
  });

  test("repeated use of one tool is rate limited the same day", async () => {
    const context = freshContext();
    for (let i = 0; i < RATE_LIMIT_AFTER + 3; i++) {
      await autoRecordToolUsage("sayaib.hue-console.base64Encoder");
    }
    const stats = getUserStats(context);
    const runs = stats.activities.filter(activity => activity.id === "sayaib.hue-console.base64Encoder");
    const lateRuns = runs.slice(0, 3);
    assert.ok(lateRuns.every(activity => activity.points === 1), "runs past the daily limit are worth 1 point");
  });

  test("the daily cap bounds how fast points can be farmed", async () => {
    const context = freshContext();
    for (let i = 0; i < 120; i++) {
      await autoRecordToolUsage(`sayaib.hue-console.tool${i}`);
    }
    const stats = getUserStats(context);
    assert.ok(
      stats.dailyEarnedPoints <= DAILY_POINT_CAP,
      `grindable points ${stats.dailyEarnedPoints} exceeded the cap`
    );
    // One-time milestone bonuses are exempt from the cap but are finite, so the
    // day's total still cannot run away. (Derived from the milestone table, not
    // the activity log, which is deliberately trimmed.)
    const milestoneBonus = stats.completedMilestones
      .map(id => MILESTONES.find(milestone => milestone.id === id)?.points ?? 0)
      .reduce((sum, points) => sum + points, 0);
    assert.strictEqual(stats.dailyPoints, stats.dailyEarnedPoints + milestoneBonus);
    assert.ok(stats.dailyPoints < 500, "a single day cannot produce an unbounded score");
  });

  test("milestones unlock once and only once", async () => {
    const context = freshContext();
    await autoRecordToolUsage("sayaib.hue-console.openGUI");
    await autoRecordToolUsage("sayaib.hue-console.openGUI");
    const stats = getUserStats(context);
    const unlocked = stats.activities.filter(activity => activity.id === "milestone_first_tool");
    assert.strictEqual(unlocked.length, 1);
    assert.strictEqual(stats.completedMilestones.filter(id => id === "first_tool").length, 1);
  });

  test("long-term milestones stay reachable after the activity log is trimmed", async () => {
    const context = freshContext();
    for (let i = 0; i < 30; i++) {
      await autoRecordToolUsage(`sayaib.hue-console.tool${i}`);
    }
    const stats = getUserStats(context);
    assert.strictEqual(stats.counters.toolRuns, 30);
    assert.ok(stats.completedMilestones.includes("tool_explorer"), "25-run milestone must unlock from counters");
    assert.ok(stats.activities.length <= 100, "the activity log stays bounded");
  });

  test("redeeming points requires a sufficient balance and refunds restore it", async () => {
    const context = freshContext();
    await recordActivity(context, "seed", "Seed", 50, "Core");

    assert.strictEqual(await redeemPoints(context, 500, "too expensive"), false);
    assert.strictEqual(getUserStats(context).totalPoints, 50);

    assert.strictEqual(await redeemPoints(context, 20, "premium tool"), true);
    assert.strictEqual(getUserStats(context).totalPoints, 30);

    await refundPoints(context, 20, "premium tool failed");
    assert.strictEqual(getUserStats(context).totalPoints, 50);
  });

  test("a day rollover resets daily counters and extends the streak", () => {
    const yesterday = new Date(Date.now() - 86400000);
    const stamp = `${yesterday.getFullYear()}-${`${yesterday.getMonth() + 1}`.padStart(2, "0")}-${`${yesterday.getDate()}`.padStart(2, "0")}`;
    const context = freshContext({
      devsnip_user_stats: {
        ...createDefaultStats(),
        totalPoints: 100,
        dailyPoints: 90,
        streakDays: 4,
        lastActiveDate: stamp,
        dailyToolUsage: { "sayaib.hue-console.openGUI": 9 }
      }
    });
    const stats = getUserStats(context);
    assert.strictEqual(stats.streakDays, 5);
    assert.strictEqual(stats.dailyPoints, 0);
    assert.deepStrictEqual(stats.dailyToolUsage, {});
    assert.strictEqual(stats.totalPoints, 100, "lifetime points survive the rollover");
  });

  test("a gap of several days breaks the streak", () => {
    const context = freshContext({
      devsnip_user_stats: { ...createDefaultStats(), streakDays: 9, lastActiveDate: "2020-01-01" }
    });
    assert.strictEqual(getUserStats(context).streakDays, 1);
  });

  test("reading stats twice never advances the streak on its own", () => {
    const yesterday = new Date(Date.now() - 86400000);
    const stamp = `${yesterday.getFullYear()}-${`${yesterday.getMonth() + 1}`.padStart(2, "0")}-${`${yesterday.getDate()}`.padStart(2, "0")}`;
    const context = freshContext({
      devsnip_user_stats: { ...createDefaultStats(), streakDays: 3, lastActiveDate: stamp }
    });
    assert.strictEqual(getUserStats(context).streakDays, 4);
    assert.strictEqual(getUserStats(context).streakDays, 4, "repeated reads must be idempotent");
  });

  test("reset clears progress", async () => {
    const context = freshContext();
    await recordActivity(context, "seed", "Seed", 30, "Core");
    await resetUserStats(context);
    const stats = getUserStats(context);
    assert.strictEqual(stats.totalPoints, 0);
    assert.deepStrictEqual(stats.completedMilestones, []);
    assert.deepStrictEqual(stats.activities, []);
  });

  test("levels are ordered and resolve correctly at their boundaries", () => {
    assert.strictEqual(getCurrentLevel(0).name, "Bronze");
    assert.strictEqual(getCurrentLevel(149).name, "Bronze");
    assert.strictEqual(getCurrentLevel(150).name, "Silver");
    assert.strictEqual(getCurrentLevel(999999).name, "Grandmaster");
    assert.strictEqual(getNextLevel(0)?.name, "Silver");
    assert.strictEqual(getNextLevel(999999), null);
  });

  test("every milestone has a positive target and reward", () => {
    for (const milestone of MILESTONES) {
      assert.ok(milestone.target > 0, `${milestone.id} needs a target`);
      assert.ok(milestone.points > 0, `${milestone.id} needs a reward`);
    }
    assert.strictEqual(new Set(MILESTONES.map(m => m.id)).size, MILESTONES.length, "milestone ids must be unique");
  });
});
