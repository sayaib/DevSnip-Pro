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
import { QUEST_CHEST_POINTS, QUEST_POOL, advanceQuests, createDailyQuests, findQuest, pickDailyQuestIds, sanitizeQuests } from "../../services/quests";
import { REWARDS, activeFrame, earnedRewardIds } from "../../services/rewards";
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
    assert.deepStrictEqual(earnedRewardIds(6, []), ["theme_solarized", "theme_synthwave", "theme_aurora"], "points-only themes are never earned");
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
