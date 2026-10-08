import * as assert from "assert";
import * as vscode from "vscode";
import {
  Celebration,
  DAILY_POINT_CAP,
  MAX_STREAK_FREEZES,
  STREAK_FREEZE_COST,
  autoRecordToolUsage,
  buildMilestoneView,
  buyReward,
  buyStreakFreeze,
  equipReward,
  openMysteryBox,
  rerollDailyQuest,
  resetUserStats,
  getMilestoneTrackerHtml,
  activitiesWaiting,
  answerDailyQuiz,
  claimDailyLogin,
  finishBitSprint,
  setActivityRandom,
  spinDailyWheel,
  tryDailyTip,
  createDefaultStats,
  effectiveUnlocked,
  getUserStats,
  loginPointsFor,
  markRecapShown,
  pendingWeeklyRecap,
  recordActivity,
  sanitizeStats,
  setCelebrationHandler,
  setMilestoneContext,
  showCelebrations,
  grantKeptTheme,
  lockLabel,
  themeLockFor,
  weekStartOf
} from "../../commands/milestoneTracker";
import { MAX_REROLLS_PER_DAY, QUEST_CHEST_POINTS, QUEST_POOL, QUEST_REROLL_COST, advanceQuests, createDailyQuests, findQuest, pickDailyQuestIds, rerollQuest, sanitizeQuests } from "../../services/quests";
import { MYSTERY_BOX_COST, MYSTERY_BOX_MAX_VALUE, REWARDS, SLOTS, activeFrame, earnedRewardIds, mysteryBoxPool, pickMysteryReward, resolveLoadout, sanitizeLoadout } from "../../services/rewards";
import { BANNER_STYLES, FRAME_STYLES, profileCss } from "../../services/profile-style";
import { renderToolsSidebar, sidebarStatus } from "../../sidebar/tools-sidebar";
import * as fs from "fs";
import {
  QUIZ_BANK, QUIZ_CORRECT_POINTS, QUIZ_TRY_POINTS, SPRINT_MAX_POINTS, SPRINT_MAX_SCORE, TIPS, TIP_POINTS, WEEKLY_EVENTS, WHEEL, WHEEL_FALLBACK_POINTS,
  LUCKY_POINTS, eventForWeek, quizForDate, spinWheel, tipForDate
} from "../../services/activities";
import * as path from "path";
import { currentThemeId, endLockedPreview, initThemes, lockedPreviewTheme, previewLockedTheme, setTheme, setThemeAccess, themeChoices } from "../../theme/service";
import { THEMES } from "../../theme/themes";
import { createExtensionContext, shownMessages, statusBarItems } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

function freshContext(seed: Record<string, unknown> = {}): any {
  const context = createExtensionContext(seed);
  setMilestoneContext(context);
  return context;
}

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function seeded(stats: Record<string, unknown>): any {
  return freshContext({ devsnip_user_stats: { ...createDefaultStats(), ...stats } });
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

suite("daily quests", () => {
  test("every date gets the same three different quests, led by an easy one", () => {
    const sets = new Set<string>();
    for (let day = 1; day <= 60; day++) {
      const date = `2026-${`${Math.ceil(day / 30)}`.padStart(2, "0")}-${`${((day - 1) % 28) + 1}`.padStart(2, "0")}`;
      const ids = pickDailyQuestIds(date);
      assert.deepStrictEqual(pickDailyQuestIds(date), ids, "deterministic per date");
      assert.strictEqual(ids.length, 3);
      assert.strictEqual(new Set(ids).size, 3, "no repeats in a day");
      assert.ok(findQuest(ids[0])?.easy, "the first quest is always an easy one");
      assert.ok(ids.every(id => findQuest(id)), "every picked quest exists");
      sets.add(ids.join(","));
    }
    assert.ok(sets.size >= 10, `quests vary from day to day (${sets.size} distinct sets)`);
  });

  test("each quest only counts the runs it describes", () => {
    const quests = { date: "2026-10-07", items: ["distinct_3", "new_tool", "security_1"].map(id => ({ id, progress: 0, done: false })), chestClaimed: false };
    const run = (over: Partial<Parameters<typeof advanceQuests>[1]>) => advanceQuests(quests, { command: "sayaib.hue-console.x", category: "Core", newToday: false, firstEver: false, ...over });
    assert.deepStrictEqual(run({}), [], "a repeat run of a known tool moves nothing");
    run({ newToday: true });
    assert.strictEqual(quests.items[0].progress, 1);
    assert.deepStrictEqual(run({ firstEver: true }).map(q => q.id), ["new_tool"]);
    assert.deepStrictEqual(run({ firstEver: true }), [], "a finished quest is not paid twice");
    assert.deepStrictEqual(run({ category: "Security" }).map(q => q.id), ["security_1"]);
  });

  test("stored quests are repaired, and another day's quests are replaced", () => {
    const today = "2026-10-07";
    assert.deepStrictEqual(sanitizeQuests(null, today), createDailyQuests(today));
    assert.deepStrictEqual(sanitizeQuests({ date: "2026-10-06", items: [], chestClaimed: true }, today), createDailyQuests(today));
    const ids = pickDailyQuestIds(today);
    const repaired = sanitizeQuests({ date: today, items: [{ id: ids[0], progress: 999, done: false }, { id: "removed", progress: 1 }], chestClaimed: "yes" }, today);
    assert.deepStrictEqual(repaired.items.map(i => i.id), ids);
    assert.strictEqual(repaired.items[0].progress, findQuest(ids[0])!.target, "progress is clamped to the target");
    assert.strictEqual(repaired.items[0].done, true);
    assert.strictEqual(repaired.chestClaimed, false);
    assert.ok(QUEST_POOL.every(q => q.target > 0 && q.points > 0));
  });

  test("tool runs finish today's quests, which pay past the daily cap, plus the chest once", async () => {
    const context = seeded({ dailyEarnedPoints: DAILY_POINT_CAP });
    const before = getUserStats(context);
    for (const command of EVERY_QUEST_COMMANDS) await autoRecordToolUsage(command);
    const stats = getUserStats(context);
    assert.ok(stats.quests.items.every(item => item.done), `every quest done: ${JSON.stringify(stats.quests.items)}`);
    assert.strictEqual(stats.quests.chestClaimed, true);
    assert.strictEqual(stats.perfectQuestDays, 1);
    assert.strictEqual(stats.dailyEarnedPoints, DAILY_POINT_CAP, "tool runs earned nothing past the cap");
    const questPoints = stats.quests.items.reduce((sum, item) => sum + findQuest(item.id)!.points, 0) + QUEST_CHEST_POINTS;
    const milestonePoints = stats.activities.filter(a => a.category === "Milestone").reduce((sum, a) => sum + a.points, 0);
    assert.strictEqual(stats.lifetimePoints - before.lifetimePoints, questPoints + milestonePoints);

    await autoRecordToolUsage(EVERY_QUEST_COMMANDS[0]);
    assert.strictEqual(getUserStats(context).perfectQuestDays, 1, "the chest pays once a day");
  });

  test("seven perfect days complete Quest Master and unlock the glow frame", async () => {
    const context = seeded({ perfectQuestDays: 6 });
    for (const command of EVERY_QUEST_COMMANDS) await autoRecordToolUsage(command);
    const stats = getUserStats(context);
    assert.ok(stats.completedMilestones.includes("quest_master"));
    assert.ok(stats.unlocked.includes("frame_glow"));
    assert.strictEqual(activeFrame(stats.unlocked), "glow");
  });

  test("older saved progress gains the new fields without losing anything", () => {
    const legacy = {
      totalPoints: 80, lifetimePoints: 120, streakDays: 3, lastActiveDate: localDate(),
      activities: [{ id: "sayaib.hue-console.jsonFormatter", title: "Tool Use: jsonFormatter", points: 3, timestamp: Date.now(), category: "Core" }]
    };
    const stats = sanitizeStats(legacy);
    assert.strictEqual(stats.totalPoints, 80);
    assert.strictEqual(stats.quests.date, localDate());
    assert.strictEqual(stats.quests.items.length, 3);
    assert.strictEqual(stats.streakFreezes, 0);
    assert.strictEqual(stats.bestStreak, 3);
    assert.deepStrictEqual(stats.unlocked, []);
    assert.deepStrictEqual(stats.toolsUsed, ["sayaib.hue-console.jsonFormatter"], "tools already used are not 'new'");
    assert.strictEqual(stats.weekly.weekStart, weekStartOf(localDate()));
    assert.strictEqual(stats.lastWeek, null);
  });
});

suite("streaks and freezes", () => {
  test("a freeze covers one missed day; without one the streak resets", () => {
    const covered = getUserStats(seeded({ streakDays: 4, streakFreezes: 1, lastActiveDate: localDate(-2) }));
    assert.strictEqual(covered.streakDays, 5);
    assert.strictEqual(covered.streakFreezes, 0);
    assert.ok(covered.activities.some(a => a.id === "streak_freeze_used"));

    const broken = getUserStats(seeded({ streakDays: 4, streakFreezes: 0, lastActiveDate: localDate(-2) }));
    assert.strictEqual(broken.streakDays, 1);
    assert.strictEqual(broken.bestStreak, 4, "the best streak is remembered");
  });

  test("two freezes cover two missed days, but not three", () => {
    const two = getUserStats(seeded({ streakDays: 10, streakFreezes: 2, lastActiveDate: localDate(-3) }));
    assert.strictEqual(two.streakDays, 11);
    assert.strictEqual(two.streakFreezes, 0);
    const three = getUserStats(seeded({ streakDays: 10, streakFreezes: 2, lastActiveDate: localDate(-4) }));
    assert.strictEqual(three.streakDays, 1);
    assert.strictEqual(three.streakFreezes, 2, "freezes are not wasted on a streak they cannot save");
  });

  test("a freeze is earned every 7 days, up to the maximum", () => {
    const earned = getUserStats(seeded({ streakDays: 6, streakFreezes: 0, lastActiveDate: localDate(-1) }));
    assert.strictEqual(earned.streakDays, 7);
    assert.strictEqual(earned.streakFreezes, 1);
    const capped = getUserStats(seeded({ streakDays: 13, streakFreezes: MAX_STREAK_FREEZES, lastActiveDate: localDate(-1) }));
    assert.strictEqual(capped.streakFreezes, MAX_STREAK_FREEZES);
    assert.strictEqual(sanitizeStats({ streakFreezes: 99 }).streakFreezes, MAX_STREAK_FREEZES);
  });

  test("freezes can be bought with points, up to the maximum", async () => {
    assert.strictEqual(await buyStreakFreeze(seeded({ totalPoints: STREAK_FREEZE_COST - 1 })), "short");
    const context = seeded({ totalPoints: STREAK_FREEZE_COST * 3, lifetimePoints: STREAK_FREEZE_COST * 3 });
    assert.strictEqual(await buyStreakFreeze(context), "ok");
    assert.strictEqual(await buyStreakFreeze(context), "ok");
    assert.strictEqual(await buyStreakFreeze(context), "full");
    const stats = getUserStats(context);
    assert.strictEqual(stats.streakFreezes, 2);
    assert.strictEqual(stats.totalPoints, STREAK_FREEZE_COST);
    assert.strictEqual(stats.lifetimePoints, STREAK_FREEZE_COST * 3, "spending never lowers lifetime points");
  });

  test("the login bonus grows with the streak, up to a cap", () => {
    assert.strictEqual(loginPointsFor(1), 5);
    assert.strictEqual(loginPointsFor(4), 8);
    assert.strictEqual(loginPointsFor(11), 15);
    assert.strictEqual(loginPointsFor(300), 15);
  });
});

suite("rewards", () => {
  test("every theme is a points reward; ranks and milestones earn only some", () => {
    assert.deepStrictEqual(earnedRewardIds(0, []), []);
    assert.deepStrictEqual(earnedRewardIds(6, []).filter(id => id.startsWith("theme_")), ["theme_solarized", "theme_synthwave", "theme_aurora"], "points-only themes are never earned");
    assert.ok(earnedRewardIds(0, ["streak_14"]).includes("theme_ember"));
    const themeRewards = REWARDS.filter(r => r.kind === "theme");
    assert.deepStrictEqual(themeRewards.map(r => r.themeId).sort(), THEMES.map(t => t.id).sort(), "one reward per theme");
    assert.ok(themeRewards.every(r => (r.cost ?? 0) > 0), "every theme has a price");
    assert.strictEqual(new Set(REWARDS.map(r => r.id)).size, REWARDS.length);
  });

  test("a new user starts with System Default only, and the cheapest theme is within a first session", () => {
    const fresh = getUserStats(seeded({}));
    for (const theme of THEMES) assert.ok(themeLockFor(fresh, theme.id), `${theme.id} is locked`);
    assert.strictEqual(themeLockFor(fresh, "system"), undefined);
    assert.strictEqual(lockLabel(themeLockFor(fresh, "dracula")!), "150 pts");
    assert.strictEqual(lockLabel(themeLockFor(fresh, "synthwave")!), "Reach Gold or 500 pts");
    assert.ok(Math.min(...REWARDS.filter(r => r.kind === "theme").map(r => r.cost!)) <= 25);
  });

  test("a theme is locked until earned, even before a write records the unlock", () => {
    const bronze = getUserStats(seeded({ lifetimePoints: 0 }));
    assert.match(themeLockFor(bronze, "solarized")!.hint!, /Reach Silver/);
    const silver = getUserStats(seeded({ lifetimePoints: 150 }));
    assert.deepStrictEqual(silver.unlocked, [], "nothing was written yet");
    assert.ok(effectiveUnlocked(silver).includes("theme_solarized"));
    assert.strictEqual(themeLockFor(silver, "solarized"), undefined);
  });

  test("themes can be unlocked early with points; frames only by earning them", async () => {
    assert.strictEqual(await buyReward(seeded({ totalPoints: 10 }), "theme_aurora"), "short");
    // Gold: Aurora is a Platinum reward, so it has to be bought.
    const context = seeded({ totalPoints: 1000, lifetimePoints: 1000 });
    assert.strictEqual(await buyReward(context, "theme_synthwave"), "owned", "Gold has already earned Synthwave");
    assert.strictEqual(await buyReward(context, "theme_aurora"), "ok");
    assert.strictEqual(await buyReward(context, "theme_aurora"), "owned");
    assert.strictEqual(await buyReward(context, "frame_flame"), "unknown");
    const stats = getUserStats(context);
    assert.ok(stats.unlocked.includes("theme_aurora"));
    assert.strictEqual(stats.totalPoints, 100);
  });

  test("a rank-up records its reward and announces both", async () => {
    const seen: Celebration[][] = [];
    setCelebrationHandler(items => seen.push(items));
    try {
      const context = seeded({ totalPoints: 148, lifetimePoints: 148 });
      await recordActivity(context, "test", "Test", 5, "Core");
      const stats = getUserStats(context);
      assert.ok(stats.unlocked.includes("theme_solarized"));
      const batch = seen[seen.length - 1];
      assert.ok(batch.some(c => c.kind === "level" && /Silver/.test(c.text)));
      assert.ok(batch.some(c => c.kind === "reward" && c.themeId === "solarized"));
    } finally {
      setCelebrationHandler(undefined);
    }
  });

  test("notifications follow the devsnip.rewards.notifications setting", () => {
    const config = (vscode.workspace as unknown as { configurationValues: Record<string, unknown> }).configurationValues;
    const items: Celebration[] = [
      { kind: "quest", icon: "⚡", text: "Quest complete: Warm up (+10 pts)" },
      { kind: "level", icon: "🥈", text: "Rank up! You are now Silver: Skilled Coder" }
    ];
    try {
      config["devsnip.rewards.notifications"] = "off";
      let count = shownMessages.length;
      showCelebrations(items);
      assert.strictEqual(shownMessages.length, count, "off shows nothing");

      config["devsnip.rewards.notifications"] = "levelsOnly";
      showCelebrations([items[0]]);
      assert.strictEqual(shownMessages.length, count, "levelsOnly skips quests");
      showCelebrations(items);
      assert.strictEqual(shownMessages.length, count + 1);
      assert.match(shownMessages[shownMessages.length - 1].message, /Silver/);
      assert.doesNotMatch(shownMessages[shownMessages.length - 1].message, /Warm up/);

      config["devsnip.rewards.notifications"] = "all";
      count = shownMessages.length;
      showCelebrations(items);
      assert.strictEqual(shownMessages.length, count + 1, "several wins share one notification");
      assert.match(shownMessages[shownMessages.length - 1].message, /Warm up.*Silver/);
    } finally {
      delete config["devsnip.rewards.notifications"];
    }
  });

  test("the theme service refuses a locked theme but lets it be previewed", async () => {
    const context = createExtensionContext({ "devsnip.appearance.theme": "synthwave" });
    setThemeAccess({ lock: id => (id === "synthwave" ? { hint: "Reach Gold", cost: 500, balance: 0 } : undefined), unlock: async () => false });
    try {
      initThemes(context);
      assert.strictEqual(currentThemeId(), "system", "a stored theme that is locked again falls back");
      await assert.rejects(setTheme("synthwave"), /locked/);
      await setTheme("synthwave", { preview: true });
      assert.strictEqual(currentThemeId(), "synthwave");
      const choice = themeChoices().find(c => c.id === "synthwave")!;
      assert.strictEqual(choice.locked, true);
      assert.strictEqual(choice.lockHint, "Reach Gold or 500 pts");
      assert.ok(!themeChoices().find(c => c.id === "dracula")!.locked);
      await setTheme("system");
    } finally {
      setThemeAccess(undefined);
    }
  });
});

suite("themes become paid", () => {
  test("a theme already in use is kept free, once, with a notice", async () => {
    const context = freshContext({ "devsnip.appearance.theme": "dracula" });
    const seen: Celebration[][] = [];
    setCelebrationHandler(items => seen.push(items));
    let granted: Promise<void> | undefined;
    setThemeAccess({
      lock: id => themeLockFor(getUserStats(context), id),
      unlock: async () => false,
      grant: id => (granted = grantKeptTheme(context, id))
    });
    try {
      initThemes(context);
      assert.strictEqual(currentThemeId(), "dracula", "the theme in use stays");
      await granted;
      const stats = getUserStats(context);
      assert.ok(stats.unlocked.includes("theme_dracula"));
      assert.strictEqual(stats.totalPoints, 0, "it cost nothing");
      assert.ok(seen.flat().some(c => /keep Dracula for free/.test(c.text)));
      assert.strictEqual(context.globalState.get("devsnip.appearance.keptThemeGranted"), true);

      // Only once: a theme stored later (or after a reset) is not handed out again.
      await context.globalState.update("devsnip.appearance.theme", "cyberpunk");
      granted = undefined;
      initThemes(context);
      assert.strictEqual(granted, undefined);
      assert.strictEqual(currentThemeId(), "system", "a locked stored theme falls back");
    } finally {
      setThemeAccess(undefined);
      setCelebrationHandler(undefined);
    }
  });

  test("previewing a locked theme never stores it", async () => {
    const context = freshContext({ "devsnip.appearance.keptThemeGranted": true });
    setThemeAccess({ lock: id => themeLockFor(getUserStats(context), id), unlock: async () => false });
    try {
      initThemes(context);
      await setTheme("nord", { preview: true });
      assert.strictEqual(currentThemeId(), "nord");
      assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), undefined);
      await assert.rejects(setTheme("nord"), /locked/);
      await setTheme("system");
    } finally {
      setThemeAccess(undefined);
    }
  });
});

suite("locked theme preview", () => {
  function setup(stats: Record<string, unknown> = {}) {
    const context = freshContext({
      devsnip_user_stats: { ...createDefaultStats(), ...stats },
      "devsnip.appearance.theme": "dark",
      "devsnip.appearance.keptThemeGranted": true
    });
    setThemeAccess({
      lock: id => themeLockFor(getUserStats(context), id),
      unlock: async id => (await buyReward(context, themeLockFor(getUserStats(context), id)!.rewardId)) === "ok"
    });
    initThemes(context);
    return context;
  }

  test("a locked theme is tried on every panel without being stored, then switched back", async () => {
    const context = setup({ unlocked: ["theme_dark"] });
    try {
      assert.strictEqual(currentThemeId(), "dark");
      assert.strictEqual(await previewLockedTheme("dracula"), true);
      assert.strictEqual(currentThemeId(), "dracula");
      assert.strictEqual(lockedPreviewTheme(), "dracula");
      assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "dark", "nothing is stored");
      const status = statusBarItems[statusBarItems.length - 1];
      assert.ok(status.visible && /Dracula preview · 30s/.test(status.text), status.text);
      assert.match(shownMessages[shownMessages.length - 1].message, /Previewing Dracula.*150 points/);
      assert.match(themeChoices().find(c => c.id === "dracula")!.lockHint!, /150 pts/, "still locked while previewed");

      await endLockedPreview();
      assert.strictEqual(currentThemeId(), "dark", "back to the theme the user chose");
      assert.strictEqual(lockedPreviewTheme(), null);
      assert.strictEqual(status.visible, false, "the status bar item goes away");
    } finally {
      await endLockedPreview();
      setThemeAccess(undefined);
    }
  });

  test("the preview ends by itself and offers to unlock", async () => {
    setup({ unlocked: ["theme_dark"], totalPoints: 500, lifetimePoints: 500 });
    try {
      await previewLockedTheme("nord", 0.05);
      assert.strictEqual(currentThemeId(), "nord");
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.strictEqual(currentThemeId(), "dark");
      assert.strictEqual(lockedPreviewTheme(), null);
      assert.match(shownMessages[shownMessages.length - 1].message, /Nord preview ended\. Unlock it to keep it/);
    } finally {
      setThemeAccess(undefined);
    }
  });

  test("unlocking during a preview keeps the theme; picking another one ends it", async () => {
    const context = setup({ unlocked: ["theme_dark"], totalPoints: 500, lifetimePoints: 500 });
    try {
      await previewLockedTheme("monokai");
      await previewLockedTheme("cyberpunk");
      assert.strictEqual(lockedPreviewTheme(), "cyberpunk", "a second preview replaces the first");
      await setTheme("dark");
      assert.strictEqual(lockedPreviewTheme(), null, "choosing a theme for real ends the preview");

      await previewLockedTheme("monokai");
      assert.ok(await (async () => { const lock = themeLockFor(getUserStats(context), "monokai")!; return (await buyReward(context, lock.rewardId)) === "ok"; })());
      await setTheme("monokai");
      assert.strictEqual(lockedPreviewTheme(), null);
      assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "monokai", "now stored for good");
      assert.strictEqual(getUserStats(context).totalPoints, 350);

      assert.strictEqual(await previewLockedTheme("dark"), true, "an unlocked theme is simply applied");
      assert.strictEqual(lockedPreviewTheme(), null);
      assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "dark");
    } finally {
      await endLockedPreview();
      setThemeAccess(undefined);
    }
  });

  test("the Rewards tab knows which locked theme is being previewed", async () => {
    const context = setup({ unlocked: ["theme_dark"] });
    try {
      await previewLockedTheme("dracula");
      const view = buildMilestoneView(context);
      const dracula = view.rewards.find(r => r.id === "theme_dracula")!;
      assert.strictEqual(dracula.previewing, true);
      assert.strictEqual(dracula.active, false, "a previewed theme is not 'in use'");
      assert.strictEqual(view.rewards.find(r => r.id === "theme_dark")!.previewing, false);
    } finally {
      await endLockedPreview();
      setThemeAccess(undefined);
    }
  });
});

suite("weekly recap", () => {
  test("a new week moves this week's numbers to last week, and the recap shows once", async () => {
    const lastMonday = weekStartOf(localDate(-7));
    const context = seeded({
      lastActiveDate: localDate(-7),
      weekly: { weekStart: lastMonday, points: 340, runs: 18, tools: ["a", "b", "c"] },
      lastWeek: { weekStart: weekStartOf(localDate(-14)), points: 200, runs: 9, tools: ["a"] }
    });
    const stats = getUserStats(context);
    assert.strictEqual(stats.weekly.weekStart, weekStartOf(localDate()));
    assert.strictEqual(stats.weekly.points, 0);
    assert.deepStrictEqual(stats.lastWeek, { weekStart: lastMonday, points: 340, runs: 18, tools: ["a", "b", "c"], previousPoints: 200 });
    assert.strictEqual(pendingWeeklyRecap(stats)?.weekStart, lastMonday);
    await markRecapShown(context, lastMonday);
    assert.strictEqual(pendingWeeklyRecap(getUserStats(context)), null);
  });

  test("a week with no activity has no recap; an older week is not called last week", () => {
    const quiet = getUserStats(seeded({ lastActiveDate: localDate(-7), weekly: { weekStart: weekStartOf(localDate(-7)), points: 0, runs: 0, tools: [] } }));
    assert.strictEqual(pendingWeeklyRecap(quiet), null);
    const stale = getUserStats(seeded({ lastActiveDate: localDate(-21), weekly: { weekStart: weekStartOf(localDate(-21)), points: 50, runs: 5, tools: [] } }));
    assert.strictEqual(stale.lastWeek, null);
  });

  test("tool runs count towards this week", async () => {
    const context = freshContext();
    await autoRecordToolUsage("sayaib.hue-console.jsonFormatter");
    await autoRecordToolUsage("sayaib.hue-console.jsonFormatter");
    await autoRecordToolUsage("sayaib.hue-console.hashGenerator");
    const week = getUserStats(context).weekly;
    assert.strictEqual(week.runs, 3);
    assert.deepStrictEqual(week.tools, ["sayaib.hue-console.jsonFormatter", "sayaib.hue-console.hashGenerator"]);
    assert.strictEqual(week.points, getUserStats(context).lifetimePoints);
  });
});

suite("tracker view", () => {
  test("the page gets quests, rewards with unlock hints, freezes and this week", () => {
    const view = buildMilestoneView(seeded({ totalPoints: 300, lifetimePoints: 160, streakDays: 3, streakFreezes: 1 }));
    assert.strictEqual(view.quests.items.length, 3);
    assert.strictEqual(view.quests.done, 0);
    assert.strictEqual(view.rewards.length, REWARDS.length);
    const solarized = view.rewards.find(r => r.id === "theme_solarized")!;
    assert.strictEqual(solarized.unlocked, true, "Silver has earned it");
    assert.strictEqual(solarized.swatches.length, 4);
    const synthwave = view.rewards.find(r => r.id === "theme_synthwave")!;
    assert.strictEqual(synthwave.unlocked, false);
    assert.strictEqual(synthwave.hint, "Reach Gold");
    assert.strictEqual(synthwave.affordable, false);
    assert.strictEqual(view.streak.freezes, 1);
    assert.strictEqual(view.streak.canBuyFreeze, true);
    assert.strictEqual(view.today.loginPoints, loginPointsFor(3));
    assert.deepStrictEqual(view.week.current, { points: 0, runs: 0, tools: 0 });
    assert.ok(view.milestones.some(m => m.id === "quest_master" && /perfect|quest/i.test(m.remainingLabel)));
  });
});

suite("profile rewards", () => {
  const cosmetics = REWARDS.filter(r => r.kind !== "theme");

  test("every slot has rewards to buy and to earn, and each one names what it draws", () => {
    const effectsJs = fs.readFileSync(path.resolve(__dirname, "../../../media/reward-effects.js"), "utf8");
    for (const slot of SLOTS) {
      const inSlot = cosmetics.filter(r => r.kind === slot);
      assert.ok(inSlot.filter(r => r.cost !== undefined).length >= 4, `${slot} has at least four rewards to buy`);
      assert.ok(inSlot.every(r => r.cost === undefined || r.cost > 0), `${slot} prices are positive`);
    }
    for (const reward of cosmetics) {
      assert.ok(reward.cost !== undefined || reward.unlock, `${reward.id} can be bought or earned`);
      if (reward.kind === "avatar") assert.ok(reward.glyph, `${reward.id} has a glyph`);
      if (reward.kind === "frame") assert.ok(FRAME_STYLES.includes(reward.frame!), `${reward.id} has frame CSS`);
      if (reward.kind === "banner") assert.ok(BANNER_STYLES.includes(reward.banner!), `${reward.id} has banner CSS`);
      if (reward.kind === "effect") assert.ok(effectsJs.includes(`'${reward.effect}'`), `${reward.id} is drawn by reward-effects.js`);
    }
    assert.ok(earnedRewardIds(6, []).includes("avatar_eagle"), "Grandmaster earns an exclusive avatar");
    assert.ok(earnedRewardIds(0, ["feature_explorer"]).includes("title_pathfinder"));
    const css = profileCss({ medal: [".m"], banner: [".b"], base: "var(--x)", ink: "var(--y)" });
    for (const name of FRAME_STYLES) assert.ok(css.includes(`.m.frame-${name}`));
    for (const name of BANNER_STYLES) assert.ok(css.includes(`.b.banner-${name}`));
  });

  test("stored loadouts are repaired: wrong kinds and unknown ids are dropped", () => {
    assert.deepStrictEqual(sanitizeLoadout({ avatar: "avatar_fox", title: "avatar_fox", frame: null, banner: "nope", effect: 3 }), { avatar: "avatar_fox", frame: null });
    assert.deepStrictEqual(sanitizeLoadout("junk"), {});
    const stats = sanitizeStats({ ...createDefaultStats(), equipped: { avatar: "avatar_fox", effect: "theme_dark" } });
    assert.deepStrictEqual(stats.equipped, { avatar: "avatar_fox" });
  });

  test("only owned rewards are worn; an earned frame shows until the slot is cleared", () => {
    const worn = resolveLoadout({ avatar: "avatar_fox" }, []);
    assert.strictEqual(worn.avatar, null, "not owned, so not worn");
    assert.strictEqual(resolveLoadout({ avatar: "avatar_fox" }, ["avatar_fox"]).avatar?.glyph, "🦊");
    assert.strictEqual(activeFrame(["frame_glow"]), "glow", "never chosen: the earned frame shows");
    assert.strictEqual(activeFrame(["frame_glow"], { frame: null }), null, "cleared on purpose");
    assert.strictEqual(activeFrame(["frame_glow", "frame_neon"], { frame: "frame_neon" }), "neon");
  });

  test("buying a profile reward equips it; equipping needs ownership; a reset takes it all off", async () => {
    const context = seeded({ totalPoints: 500, lifetimePoints: 500 });
    assert.strictEqual(await equipReward(context, "avatar", "avatar_fox"), "locked");
    assert.strictEqual(await buyReward(context, "avatar_fox"), "ok");
    assert.strictEqual(await buyReward(context, "title_regex"), "ok");
    let stats = getUserStats(context);
    assert.strictEqual(stats.totalPoints, 500 - 60 - 80);
    assert.deepStrictEqual(stats.equipped, { avatar: "avatar_fox", title: "title_regex" });
    assert.match(stats.activities[0].title, /Regex Wizard title/);
    assert.strictEqual(await equipReward(context, "avatar", "title_regex"), "unknown", "a title is not an avatar");
    assert.strictEqual(await equipReward(context, "title", null), "ok");
    assert.strictEqual(getUserStats(context).equipped.title, null);

    const status = sidebarStatus(context);
    assert.strictEqual(status.avatar, "🦊");
    assert.strictEqual(status.title, null);

    await resetUserStats(context);
    stats = getUserStats(context);
    assert.deepStrictEqual(stats.equipped, {});
    assert.strictEqual(sidebarStatus(context).avatar, null);
  });

  test("a mystery box gives a random profile reward not owned yet, and never replaces a chosen one", async () => {
    assert.deepStrictEqual(await openMysteryBox(seeded({ totalPoints: MYSTERY_BOX_COST - 1 })), { outcome: "short" });
    const context = seeded({ totalPoints: 1000, lifetimePoints: 1000, unlocked: ["avatar_cat"], equipped: { avatar: "avatar_cat" } });
    const pool = mysteryBoxPool(["avatar_cat"]);
    assert.ok(pool.every(r => r.kind !== "theme" && r.cost! <= MYSTERY_BOX_MAX_VALUE && r.id !== "avatar_cat"));
    const box = await openMysteryBox(context, () => 0);
    assert.strictEqual(box.outcome, "ok");
    const reward = box.outcome === "ok" ? box.reward : undefined;
    assert.strictEqual(reward?.id, pool[0].id);
    const stats = getUserStats(context);
    assert.ok(stats.unlocked.includes(reward!.id));
    assert.strictEqual(stats.totalPoints, 1000 - MYSTERY_BOX_COST);
    if (reward!.kind === "avatar") assert.strictEqual(stats.equipped.avatar, "avatar_cat", "the chosen avatar stays");
    else assert.strictEqual(stats.equipped[reward!.kind as "title"], reward!.id, "an empty slot is filled");

    const everything = mysteryBoxPool([]).map(r => r.id);
    assert.deepStrictEqual(await openMysteryBox(seeded({ totalPoints: 1000, unlocked: everything })), { outcome: "empty" });
    assert.strictEqual(pickMysteryReward([], () => 0.5), undefined);
    assert.strictEqual(pickMysteryReward(pool, () => 0.9999)?.id, pool[pool.length - 1].id);
  });

  test("a quest can be swapped for points, twice a day, and the swap survives a reload", async () => {
    const today = createDailyQuests(localDate());
    const first = today.items[1].id;
    const context = seeded({ totalPoints: 100, quests: today });
    const swap = await rerollDailyQuest(context, first, () => 0);
    assert.strictEqual(swap.outcome, "ok");
    let stats = getUserStats(context);
    assert.ok(!stats.quests.items.some(item => item.id === first), "the old quest is gone");
    assert.strictEqual(new Set(stats.quests.items.map(item => item.id)).size, 3);
    assert.strictEqual(stats.quests.rerolls, 1);
    assert.strictEqual(stats.totalPoints, 100 - QUEST_REROLL_COST);

    assert.strictEqual((await rerollDailyQuest(context, stats.quests.items[2].id)).outcome, "ok");
    assert.strictEqual((await rerollDailyQuest(context, stats.quests.items[0].id)).outcome, "limit", `only ${MAX_REROLLS_PER_DAY} a day`);
    stats = getUserStats(context);
    assert.strictEqual(stats.totalPoints, 100 - 2 * QUEST_REROLL_COST);

    const done = createDailyQuests(localDate());
    done.items[0].done = true;
    done.items[0].progress = findQuest(done.items[0].id)!.target;
    assert.strictEqual((await rerollDailyQuest(seeded({ totalPoints: 100, quests: done }), done.items[0].id)).outcome, "done");
    assert.strictEqual((await rerollDailyQuest(seeded({ totalPoints: 0 }), createDailyQuests(localDate()).items[0].id)).outcome, "short");

    // A tampered set (duplicates) falls back to the day's pick.
    const bad = { ...createDailyQuests(localDate()), rerolls: 1 };
    bad.items = [bad.items[0], bad.items[0], bad.items[1]];
    assert.deepStrictEqual(sanitizeQuests(bad, localDate()).items.map(item => item.id), pickDailyQuestIds(localDate()));
    assert.strictEqual(rerollQuest(createDailyQuests(localDate()), "missing"), undefined);
  });

  test("the page gets the profile, the shop and which quests can be swapped", async () => {
    const context = seeded({ totalPoints: 400, lifetimePoints: 700 });
    await buyReward(context, "banner_ocean");
    await buyReward(context, "effect_confetti");
    const view = buildMilestoneView(context);
    assert.strictEqual(view.profile.badge, "🥇");
    assert.strictEqual(view.profile.banner?.value, "ocean");
    assert.strictEqual(view.profile.effect?.value, "confetti");
    assert.strictEqual(view.profile.avatar, null);
    assert.ok(view.rewards.find(r => r.id === "banner_ocean")!.active);
    assert.strictEqual(view.rewards.find(r => r.id === "avatar_fox")!.glyph, "🦊");
    assert.strictEqual(view.shop.reroll.left, MAX_REROLLS_PER_DAY);
    assert.strictEqual(view.shop.box.cost, MYSTERY_BOX_COST);
    assert.strictEqual(view.shop.collected, 2);
    assert.strictEqual(view.shop.collectible, REWARDS.filter(r => r.kind !== "theme").length);
    assert.ok(view.quests.items.every(q => q.canReroll), "enough points and swaps left");
  });

  test("both pages load the shared effects script", () => {
    assert.match(getMilestoneTrackerHtml("csp", "s.js", "c.png", "fx.js"), /<script src="fx.js"><\/script>/);
    const html = renderToolsSidebar({ cspSource: "x", scriptUri: "s.js", effectsUri: "fx.js", codiconsUri: "c.css", status: sidebarStatus(seeded({})), expanded: [] });
    assert.match(html, /<script nonce="[^"]+" src="fx.js"><\/script>/);
    assert.ok(html.indexOf("fx.js") < html.indexOf('src="s.js"'), "effects load before the sidebar script");
  });
});

suite("daily activities", () => {
  const today = localDate();
  const pointsOnly = WHEEL.findIndex(segment => "points" in segment.prize);
  /** A random() that lands the wheel on segment `index`. */
  const landOn = (index: number) => {
    const total = WHEEL.reduce((sum, segment) => sum + segment.weight, 0);
    const before = WHEEL.slice(0, index).reduce((sum, segment) => sum + segment.weight, 0);
    return () => (before + WHEEL[index].weight / 2) / total;
  };

  test("the challenge bank is well formed and every question comes up before any repeats", () => {
    assert.ok(QUIZ_BANK.length >= 30);
    assert.strictEqual(new Set(QUIZ_BANK.map(q => q.id)).size, QUIZ_BANK.length);
    for (const q of QUIZ_BANK) {
      assert.strictEqual(q.options.length, 4, `${q.id} has four answers`);
      assert.strictEqual(new Set(q.options).size, 4, `${q.id} answers are different`);
      assert.ok(q.answer >= 0 && q.answer < 4, `${q.id} answer index`);
      assert.ok(q.explain.length > 20, `${q.id} explains the answer`);
    }
    assert.strictEqual(quizForDate("2026-10-08").id, quizForDate("2026-10-08").id, "same question all day");
    const start = Date.parse("2026-03-02T00:00:00Z");
    const firstDayOfCycle = Math.ceil(start / 86400000 / QUIZ_BANK.length) * QUIZ_BANK.length;
    const seen = new Set<string>();
    for (let i = 0; i < QUIZ_BANK.length; i++) seen.add(quizForDate(new Date((firstDayOfCycle + i) * 86400000).toISOString().slice(0, 10)).id);
    assert.strictEqual(seen.size, QUIZ_BANK.length, "a full cycle shows every question once");
  });

  test("every tip opens a real DevSnip Pro command", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const commands = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const tip of TIPS) assert.ok(commands.has(tip.command), `${tip.id} → ${tip.command}`);
    assert.ok(TIPS.some(tip => tip.id === tipForDate(today).id));
  });

  test("the wheel follows its weights", () => {
    assert.strictEqual(spinWheel(() => 0), 0);
    assert.strictEqual(spinWheel(() => 0.999999), WHEEL.length - 1);
    for (let i = 0; i < WHEEL.length; i++) assert.strictEqual(spinWheel(landOn(i)), i);
  });

  test("one free spin a day, plus a bonus spin for finishing every quest", async () => {
    const context = seeded({ totalPoints: 0, lifetimePoints: 0 });
    assert.strictEqual(activitiesWaiting(getUserStats(context)), 4, "spin, challenge, Bit Sprint and tip");
    const spin = await spinDailyWheel(context, landOn(pointsOnly));
    assert.strictEqual(spin.outcome, "ok");
    const won = (WHEEL[pointsOnly].prize as { points: number }).points;
    let stats = getUserStats(context);
    assert.strictEqual(stats.totalPoints, won);
    assert.strictEqual(stats.play.lastSpin, pointsOnly);
    assert.deepStrictEqual(await spinDailyWheel(context), { outcome: "used" });

    for (const command of EVERY_QUEST_COMMANDS) {
      for (let i = 0; i < 2; i++) await autoRecordToolUsage(command);
    }
    stats = getUserStats(context);
    assert.ok(stats.quests.chestClaimed);
    assert.strictEqual(stats.play.bonusSpins, 1);
    assert.strictEqual((await spinDailyWheel(context, landOn(pointsOnly))).outcome, "ok", "the bonus spin");
    assert.deepStrictEqual(await spinDailyWheel(context), { outcome: "used" });
  });

  test("a freeze prize falls back to points when freezes are full; an item prize gives a profile reward", async () => {
    const freeze = WHEEL.findIndex(segment => "freeze" in segment.prize);
    const item = WHEEL.findIndex(segment => "item" in segment.prize);
    const empty = seeded({});
    await spinDailyWheel(empty, landOn(freeze));
    assert.strictEqual(getUserStats(empty).streakFreezes, 1);
    const full = seeded({ streakFreezes: MAX_STREAK_FREEZES });
    await spinDailyWheel(full, landOn(freeze));
    assert.strictEqual(getUserStats(full).totalPoints, WHEEL_FALLBACK_POINTS);
    const lucky = seeded({});
    const spin = await spinDailyWheel(lucky, landOn(item));
    assert.ok(spin.outcome === "ok" && /the .+ (avatar|title|badge frame|banner|celebration effect)/.test(spin.text), spin.outcome === "ok" ? spin.text : "");
    assert.strictEqual(getUserStats(lucky).unlocked.length, 1);
  });

  test("the daily challenge pays once, more when right, and keeps its answer secret until then", async () => {
    const question = quizForDate(today);
    const context = seeded({});
    const before = buildMilestoneView(context).play.quiz;
    assert.strictEqual(before.answer, null, "the answer is not sent before answering");
    assert.strictEqual(before.explain, null);
    const result = await answerDailyQuiz(context, question.answer);
    assert.ok(result.outcome === "ok" && result.correct && result.points === QUIZ_CORRECT_POINTS);
    assert.deepStrictEqual(await answerDailyQuiz(context, 0), { outcome: "answered" });
    const stats = getUserStats(context);
    assert.strictEqual(stats.totalPoints, QUIZ_CORRECT_POINTS);
    assert.strictEqual(stats.quizCorrect, 1);
    assert.strictEqual(stats.quizStreak, 1);
    assert.strictEqual(buildMilestoneView(context).play.quiz.answer, question.answer);

    const wrong = seeded({ quizStreak: 4, quizLastCorrect: localDate(-1) });
    const miss = await answerDailyQuiz(wrong, (question.answer + 1) % 4);
    assert.ok(miss.outcome === "ok" && !miss.correct && miss.points === QUIZ_TRY_POINTS);
    assert.strictEqual(getUserStats(wrong).quizStreak, 0);

    const streak = seeded({ quizStreak: 4, quizLastCorrect: localDate(-1) });
    await answerDailyQuiz(streak, question.answer);
    assert.strictEqual(getUserStats(streak).quizStreak, 5, "yesterday's streak continues");
    assert.deepStrictEqual(await answerDailyQuiz(seeded({}), 9), { outcome: "invalid" });
  });

  test("ten correct answers complete Sharp Mind and unlock its title", async () => {
    const context = seeded({ quizCorrect: 9 });
    await answerDailyQuiz(context, quizForDate(today).answer);
    const stats = getUserStats(context);
    assert.ok(stats.completedMilestones.includes("quiz_10"));
    assert.ok(effectiveUnlocked(stats).includes("title_sharp_mind"));
  });

  test("Bit Sprint pays the day's first game, capped, and later games only chase the best", async () => {
    const context = seeded({});
    const first = await finishBitSprint(context, 14);
    assert.deepStrictEqual(first, { outcome: "ok", points: SPRINT_MAX_POINTS, score: 14, best: 14, newBest: true, paid: true });
    const second = await finishBitSprint(context, 999);
    assert.strictEqual(second.points, 0);
    assert.strictEqual(second.score, SPRINT_MAX_SCORE, "impossible scores are clamped");
    assert.strictEqual(getUserStats(context).totalPoints, SPRINT_MAX_POINTS);
    assert.strictEqual(getUserStats(context).sprintBest, SPRINT_MAX_SCORE);
  });

  test("the tip of the day pays once and names the tool to open", async () => {
    const context = seeded({});
    assert.deepStrictEqual(await tryDailyTip(context), { command: tipForDate(today).command, points: TIP_POINTS });
    assert.deepStrictEqual(await tryDailyTip(context), { command: tipForDate(today).command, points: 0 });
    assert.strictEqual(getUserStats(context).totalPoints, TIP_POINTS);
    assert.strictEqual(activitiesWaiting(getUserStats(context)), 3);
  });

  test("weekly events rotate, and each has an exclusive reward only it can give", () => {
    const ids = new Set<string>();
    for (let week = 0; week < WEEKLY_EVENTS.length; week++) ids.add(eventForWeek(addDaysIso("2026-10-05", week * 7)).id);
    assert.strictEqual(ids.size, WEEKLY_EVENTS.length, "six weeks show all six events");
    for (const event of WEEKLY_EVENTS) {
      const reward = REWARDS.find(r => r.id === event.rewardId);
      assert.ok(reward, `${event.id} prize exists`);
      assert.deepStrictEqual(reward!.unlock, { event: event.id });
      assert.strictEqual(reward!.cost, undefined, "event prizes cannot be bought");
      assert.ok(!mysteryBoxPool([]).some(r => r.id === reward!.id), "or won in a box");
    }
  });

  test("tool runs move the week's event, which pays once and unlocks its prize", async () => {
    const context = seeded({});
    const event = eventForWeek(weekStartOf(today));
    const stats0 = getUserStats(context);
    assert.strictEqual(stats0.event.id, event.id);
    const commands: Record<string, string> = {
      security_week: "sayaib.hue-console.securityAudit",
      ai_week: "sayaib.hue-console.aiTokenCounter",
      snippet_week: "sayaib.hue-console.createSnippet",
      api_week: "sayaib.hue-console.openGUI"
    };
    for (let i = 0; i < event.target + 2; i++) {
      await autoRecordToolUsage(commands[event.id] ?? `sayaib.hue-console.eventTool${i}`);
    }
    const stats = getUserStats(context);
    assert.ok(stats.event.done, `${event.id} done`);
    assert.strictEqual(stats.eventsWon, 1, "paid once");
    assert.ok(stats.unlocked.includes(event.rewardId));
    assert.ok(stats.activities.filter(a => a.id === `event_${event.id}`).length === 1);
    assert.match(buildMilestoneView(context).rewards.find(r => r.id === event.rewardId)!.hint!, new RegExp(`Win ${event.title}`));
  });

  test("every 7th check-in day opens a chest with a profile reward", async () => {
    const context = seeded({ streakDays: 7, lastActiveDate: today, dailyClaims: {} });
    await claimDailyLogin(context);
    const stats = getUserStats(context);
    assert.strictEqual(stats.unlocked.length, 1, "one reward from the chest");
    assert.ok(stats.activities.some(a => a.id === "play_checkin"));
    const day3 = seeded({ streakDays: 3, lastActiveDate: today, dailyClaims: {} });
    await claimDailyLogin(day3);
    assert.strictEqual(getUserStats(day3).unlocked.length, 0);
    assert.strictEqual(buildMilestoneView(day3).play.checkin.day, 3);
  });

  test("a lucky find happens at most once a day", async () => {
    try {
      setActivityRandom(() => 0);
      const context = seeded({ dailyEarnedPoints: DAILY_POINT_CAP });
      await autoRecordToolUsage("sayaib.hue-console.jsonFormatter");
      await autoRecordToolUsage("sayaib.hue-console.hashGenerator");
      const stats = getUserStats(context);
      assert.ok(stats.play.lucky);
      assert.strictEqual(stats.activities.filter(a => a.id === "lucky_find").length, 1);
      assert.ok(stats.totalPoints >= LUCKY_POINTS, "paid past the daily cap");
    } finally {
      setActivityRandom(() => 1);
    }
  });

  test("activities reset with the day, and the Tools view shows how many wait", async () => {
    const context = seeded({ play: { date: localDate(-1), spinsUsed: 1, bonusSpins: 0, lastSpin: 0, quizChoice: 2, tipTried: true, sprintScore: 5, lucky: true } });
    const stats = getUserStats(context);
    assert.strictEqual(stats.play.date, today);
    assert.strictEqual(stats.play.quizChoice, null);
    assert.strictEqual(sidebarStatus(context).play, 4);
    const html = renderToolsSidebar({ cspSource: "x", scriptUri: "s.js", codiconsUri: "c.css", status: sidebarStatus(context), expanded: [] });
    assert.match(html, /id="playChip"/);
  });
});

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
