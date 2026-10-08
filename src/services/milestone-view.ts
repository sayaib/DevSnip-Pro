import type { LevelInfo, Milestone, UserStats } from "../commands/milestoneTracker";
import { QUEST_CHEST_POINTS, findQuest } from "./quests";
import type { CosmeticSlot, RewardDefinition, RewardKind } from "./rewards";
import {
  CHECKIN_CHEST_EVERY, LUCKY_POINTS, QUIZ_CORRECT_POINTS, QUIZ_TRY_POINTS, SPRINT_MAX_POINTS, SPRINT_SECONDS, TIP_POINTS, WHEEL,
  eventForWeek, quizForDate, tipForDate
} from "./activities";

/**
 * Turns stored milestone stats into exactly what the tracker page shows.
 *
 * Kept free of VS Code and of the webview so every number the user sees -
 * level progress, what the balance buys, the next milestone - is computed in
 * one place and unit-tested, and the page only has to draw it.
 */

export interface TrackerInputs {
  stats: UserStats;
  levels: LevelInfo[];
  milestones: Milestone[];
  progress: (stats: UserStats, milestoneId: string) => number;
  /** Local calendar date, YYYY-MM-DD. */
  today: string;
  dailyCap: number;
  rateLimitAfter: number;
  loginPoints: number;
  bonusPoints: number;
  /** Premium tools and their per-run price, for "what can I spend on". */
  premium: Array<{ name: string; pointCost: number }>;
  /** Command id -> readable tool name, for the activity feed. */
  toolNames: Record<string, string>;
  /** Optional so older callers keep working; the tracker always passes them. */
  rewards?: {
    list: RewardDefinition[];
    /** Unlocked reward ids, including ones earned by progress but not yet recorded. */
    unlocked: string[];
    /** How it is earned without points, or null when points are the only way. */
    hint: (reward: RewardDefinition) => string | null;
    currentTheme: string;
    /** A locked theme being tried right now, if any. */
    previewTheme?: string | null;
    activeFrame: string | null;
    /** The reward worn in each profile slot. Optional: without it only the frame is known. */
    loadout?: Record<CosmeticSlot, RewardDefinition | null>;
    /** themeId -> four preview colours. */
    swatches: Record<string, string[]>;
  };
  /** Prices and limits for the mystery box and quest swaps. */
  shop?: { boxCost: number; boxLeft: number; rerollCost: number; rerollsLeft: number; maxRerolls: number };
  freezes?: { max: number; cost: number; every: number };
  /** Most extra login points a streak can add. */
  loginBonusMax?: number;
  /** Rewards by id, for naming a weekly event's prize. */
  findReward?: (id: string) => RewardDefinition | undefined;
}

export interface PlayView {
  /** Daily activities still waiting today (spins, challenge, Bit Sprint, tip). */
  waiting: number;
  wheel: {
    segments: Array<{ label: string; icon: string; color: string; chance: number }>;
    spinsLeft: number;
    bonusSpins: number;
    lastSpin: number | null;
  };
  quiz: {
    id: string;
    category: string;
    question: string;
    code: string | null;
    options: string[];
    /** The pick, the right answer and the explanation are only sent once answered. */
    choice: number | null;
    answer: number | null;
    explain: string | null;
    correctPoints: number;
    tryPoints: number;
    correctTotal: number;
    streak: number;
  };
  sprint: { played: boolean; score: number | null; best: number; maxPoints: number; seconds: number };
  tip: { id: string; title: string; text: string; action: string; tried: boolean; points: number };
  event: {
    id: string;
    title: string;
    icon: string;
    description: string;
    target: number;
    progress: number;
    percent: number;
    done: boolean;
    points: number;
    reward: { id: string; name: string; icon: string; kind: RewardKind; owned: boolean } | null;
    daysLeft: number;
    won: number;
  };
  checkin: { day: number; every: number; streak: number };
  lucky: { found: boolean; points: number };
}

export interface QuestView {
  id: string;
  title: string;
  hint: string;
  icon: string;
  target: number;
  progress: number;
  percent: number;
  points: number;
  done: boolean;
  /** Can be swapped for another quest right now (not done, swaps left, enough points). */
  canReroll: boolean;
}

export interface RewardView {
  id: string;
  kind: RewardKind;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  /** "Reach Gold" / "Complete Weekly Warrior", or null when it is unlocked with points only. */
  hint: string | null;
  cost: number | null;
  affordable: boolean;
  /** The theme in use, or the profile reward being worn. */
  active: boolean;
  /** For avatars: the emoji shown on the rank card. */
  glyph: string | null;
  /** For frames, banners and effects: the style name the pages draw. */
  style: string | null;
  /** A locked theme being tried right now. */
  previewing: boolean;
  themeId: string | null;
  swatches: string[];
}

/** One worn profile slot. */
export interface ProfileItem {
  id: string;
  name: string;
  icon: string;
  /** Avatar glyph, or the frame, banner or effect style name. */
  value: string | null;
}

export interface ProfileView {
  /** The rank medal, shown when no avatar is worn. */
  badge: string;
  avatar: ProfileItem | null;
  title: ProfileItem | null;
  frame: ProfileItem | null;
  banner: ProfileItem | null;
  effect: ProfileItem | null;
}

export interface ShopView {
  balance: number;
  box: { cost: number; left: number; affordable: boolean };
  reroll: { cost: number; left: number; max: number; affordable: boolean };
  /** Owned and total profile rewards (themes excluded). */
  collected: number;
  collectible: number;
}

export interface WeekView {
  points: number;
  runs: number;
  tools: number;
}

export type LevelState = "achieved" | "current" | "locked";
export type ActivityKind = "tool" | "milestone" | "bonus" | "quest" | "freeze" | "spend" | "refund" | "play" | "other";

export interface LevelView {
  index: number;
  name: string;
  title: string;
  badge: string;
  color: string;
  minPoints: number;
  reward: string;
  state: LevelState;
}

export interface MilestoneView {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  target: number;
  current: number;
  percent: number;
  points: number;
  completed: boolean;
  /** "3 more runs", "2 more days" ... */
  remainingLabel: string;
}

export interface ActivityView {
  title: string;
  points: number;
  timestamp: number;
  category: string;
  kind: ActivityKind;
}

export interface TrackerView {
  balance: number;
  lifetime: number;
  level: LevelView;
  nextLevel: LevelView | null;
  /** 0-100 through the current level towards the next one. */
  levelPercent: number;
  pointsToNext: number;
  today: {
    earned: number;
    cap: number;
    percent: number;
    capReached: boolean;
    loginClaimed: boolean;
    loginPoints: number;
    bonusClaimed: boolean;
    bonusPoints: number;
  };
  streak: {
    days: number;
    next: { title: string; target: number; remaining: number } | null;
    best: number;
    freezes: number;
    maxFreezes: number;
    freezeCost: number;
    canBuyFreeze: boolean;
  };
  quests: {
    items: QuestView[];
    done: number;
    total: number;
    chestPoints: number;
    chestClaimed: boolean;
    perfectDays: number;
  };
  rewards: RewardView[];
  play: PlayView;
  profile: ProfileView;
  shop: ShopView;
  week: {
    current: WeekView;
    last: (WeekView & { previousPoints: number }) | null;
  };
  milestones: MilestoneView[];
  milestoneSummary: { completed: number; total: number; earned: number; available: number };
  /** The incomplete milestone closest to done, to suggest what to do next. */
  focus: MilestoneView | null;
  levels: LevelView[];
  activities: ActivityView[];
  spend: {
    affordable: number;
    total: number;
    cheapest: number | null;
    next: { name: string; cost: number; short: number } | null;
  };
  rules: { dailyCap: number; rateLimitAfter: number; freezeEvery: number; loginBonusMax: number };
}

export function levelIndexFor(points: number, levels: LevelInfo[]): number {
  let index = 0;
  for (let i = 0; i < levels.length; i++) {
    if (points >= levels[i].minPoints) index = i;
    else break;
  }
  return index;
}

function levelView(levels: LevelInfo[], index: number, currentIndex: number): LevelView {
  const level = levels[index];
  return {
    index,
    name: level.name,
    title: level.rank,
    badge: level.badge,
    color: level.color,
    minPoints: level.minPoints,
    reward: level.reward,
    state: index < currentIndex ? "achieved" : index === currentIndex ? "current" : "locked"
  };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** What is still needed for a milestone, in the unit its target is counted in. */
function remainingLabel(milestone: Milestone, remaining: number): string {
  if (remaining <= 0) return "Completed";
  if (milestone.id.startsWith("streak")) return `${plural(remaining, "more day")} in a row`;
  if (milestone.id === "points_5000") return `${plural(remaining, "more point")} to earn`;
  if (milestone.id === "snippet_creator") return `${plural(remaining, "more snippet")}`;
  if (milestone.id === "security_audit") return `${plural(remaining, "more audit")}`;
  if (milestone.id === "ai_explorer") return `${plural(remaining, "more AI tool run")}`;
  if (milestone.id === "feature_explorer") return `${plural(remaining, "more feature")} to try`;
  if (milestone.id === "quest_master") return `${plural(remaining, "more day")} with every quest done`;
  if (milestone.id === "quiz_10") return `${plural(remaining, "more correct answer")} in the daily challenge`;
  if (milestone.id === "events_3") return `${plural(remaining, "more weekly event")} to complete`;
  return `${plural(remaining, "more tool run")}`;
}

function activityKind(entry: UserStats["activities"][number]): ActivityKind {
  if (entry.category === "Milestone") return "milestone";
  if (entry.category === "Redemption") return entry.points < 0 ? "spend" : "refund";
  if (entry.id === "daily_login" || entry.id === "daily_bonus") return "bonus";
  if (entry.category === "Quest") return "quest";
  if (entry.id.startsWith("streak_freeze")) return "freeze";
  if (entry.category === "Play" || entry.category === "Event" || entry.id === "lucky_find") return "play";
  if (entry.id.startsWith("sayaib.")) return "tool";
  return "other";
}

function activityTitle(entry: UserStats["activities"][number], toolNames: Record<string, string>): string {
  if (entry.id.startsWith("sayaib.")) {
    return toolNames[entry.id] || entry.title.replace(/^Tool Use:\s*/, "");
  }
  // Stored titles repeat the amount ("(+50 pts)"); the feed shows it in its own column.
  return entry.title.replace(/\s*\([+-]?\d+ pts\)\s*$/, "").replace(/^Milestone Unlocked:\s*/, "Milestone unlocked: ");
}

/** Days from a local YYYY-MM-DD date to another. */
function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) || 0;
}

/** Today's activities, with nothing given away early (the challenge's answer stays on the extension side). */
export function buildPlayView(stats: UserStats, today: string, findReward?: (id: string) => RewardDefinition | undefined): PlayView {
  // Older callers may pass stats saved before activities existed.
  const play = stats.play ?? { date: today, spinsUsed: 0, bonusSpins: 0, lastSpin: null, quizChoice: null, tipTried: false, sprintScore: null, lucky: false };
  if (!stats.event) {
    const [year, month, day] = today.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const weekStart = date.toISOString().slice(0, 10);
    stats = { ...stats, event: { weekStart, id: eventForWeek(weekStart).id, progress: 0, done: false } };
  }
  const totalWeight = WHEEL.reduce((sum, segment) => sum + segment.weight, 0);
  const spinsLeft = Math.max(0, 1 + play.bonusSpins - play.spinsUsed);
  const question = quizForDate(play.date || today);
  const answered = play.quizChoice !== null;
  const tip = tipForDate(play.date || today);
  const event = eventForWeek(stats.event.weekStart);
  const prize = findReward?.(event.rewardId);
  const waiting = spinsLeft + (answered ? 0 : 1) + (play.sprintScore === null ? 1 : 0) + (play.tipTried ? 0 : 1);
  return {
    waiting,
    wheel: {
      segments: WHEEL.map(segment => ({ label: segment.label, icon: segment.icon, color: segment.color, chance: Math.round((segment.weight / totalWeight) * 100) })),
      spinsLeft,
      bonusSpins: play.bonusSpins,
      lastSpin: play.lastSpin
    },
    quiz: {
      id: question.id,
      category: question.category,
      question: question.question,
      code: question.code ?? null,
      options: question.options,
      choice: play.quizChoice,
      answer: answered ? question.answer : null,
      explain: answered ? question.explain : null,
      correctPoints: QUIZ_CORRECT_POINTS,
      tryPoints: QUIZ_TRY_POINTS,
      correctTotal: stats.quizCorrect ?? 0,
      streak: stats.quizLastCorrect && dayGap(stats.quizLastCorrect, today) <= 1 ? stats.quizStreak : 0
    },
    sprint: { played: play.sprintScore !== null, score: play.sprintScore, best: stats.sprintBest ?? 0, maxPoints: SPRINT_MAX_POINTS, seconds: SPRINT_SECONDS },
    tip: { id: tip.id, title: tip.title, text: tip.text, action: tip.action, tried: play.tipTried, points: TIP_POINTS },
    event: {
      id: event.id,
      title: event.title,
      icon: event.icon,
      description: event.description,
      target: event.target,
      progress: stats.event.progress,
      percent: Math.min(100, Math.floor((stats.event.progress / event.target) * 100)),
      done: stats.event.done,
      points: event.points,
      reward: prize ? { id: prize.id, name: prize.name, icon: prize.icon, kind: prize.kind, owned: stats.unlocked.includes(prize.id) } : null,
      daysLeft: Math.max(1, 7 - dayGap(stats.event.weekStart, today)),
      won: stats.eventsWon ?? 0
    },
    checkin: { day: ((Math.max(1, stats.streakDays) - 1) % CHECKIN_CHEST_EVERY) + 1, every: CHECKIN_CHEST_EVERY, streak: stats.streakDays },
    lucky: { found: play.lucky, points: LUCKY_POINTS }
  };
}

export function buildTrackerView(input: TrackerInputs): TrackerView {
  const { stats, levels, milestones } = input;
  const currentIndex = levelIndexFor(stats.lifetimePoints, levels);
  const level = levelView(levels, currentIndex, currentIndex);
  const nextLevel = currentIndex + 1 < levels.length ? levelView(levels, currentIndex + 1, currentIndex) : null;

  let levelPercent = 100;
  let pointsToNext = 0;
  if (nextLevel) {
    const span = nextLevel.minPoints - level.minPoints;
    const into = stats.lifetimePoints - level.minPoints;
    levelPercent = span > 0 ? Math.min(100, Math.max(0, Math.floor((into / span) * 100))) : 0;
    pointsToNext = Math.max(0, nextLevel.minPoints - stats.lifetimePoints);
  }

  const milestoneViews: MilestoneView[] = milestones.map(milestone => {
    const completed = stats.completedMilestones.includes(milestone.id);
    const current = completed ? milestone.target : Math.max(0, Math.min(milestone.target, input.progress(stats, milestone.id)));
    const percent = completed ? 100 : Math.min(99, Math.floor((current / milestone.target) * 100));
    return {
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      icon: milestone.icon,
      category: milestone.category,
      target: milestone.target,
      current,
      percent,
      points: milestone.points,
      completed,
      remainingLabel: remainingLabel(milestone, milestone.target - current)
    };
  });
  const open = milestoneViews.filter(m => !m.completed);
  const focus = open.length ? [...open].sort((a, b) => b.percent - a.percent || a.target - b.target)[0] : null;

  const streakTargets = milestoneViews
    .filter(m => m.id.startsWith("streak") && !m.completed)
    .sort((a, b) => a.target - b.target);
  const streakNext = streakTargets[0]
    ? { title: streakTargets[0].title, target: streakTargets[0].target, remaining: Math.max(0, streakTargets[0].target - stats.streakDays) }
    : null;

  const premium = input.premium.filter(tool => tool.pointCost > 0);
  const affordable = premium.filter(tool => tool.pointCost <= stats.totalPoints).length;
  const nextBuy = premium
    .filter(tool => tool.pointCost > stats.totalPoints)
    .sort((a, b) => a.pointCost - b.pointCost)[0];
  const cheapest = premium.length ? Math.min(...premium.map(tool => tool.pointCost)) : null;

  const earned = Math.min(stats.dailyEarnedPoints, input.dailyCap);

  const shop = input.shop ?? { boxCost: 0, boxLeft: 0, rerollCost: 0, rerollsLeft: 0, maxRerolls: 0 };
  const canReroll = shop.maxRerolls > 0 && shop.rerollsLeft > 0 && stats.totalPoints >= shop.rerollCost;
  const quests: QuestView[] = [];
  for (const item of stats.quests?.items ?? []) {
    const quest = findQuest(item.id);
    if (!quest) continue;
    quests.push({
      id: quest.id,
      title: quest.title,
      hint: quest.hint,
      icon: quest.icon,
      target: quest.target,
      progress: item.progress,
      percent: item.done ? 100 : Math.min(99, Math.floor((item.progress / quest.target) * 100)),
      points: quest.points,
      done: item.done,
      canReroll: canReroll && !item.done
    });
  }

  const rewardInput = input.rewards;
  const loadout = rewardInput?.loadout;
  const worn = (reward: RewardDefinition): boolean => {
    if (reward.kind === "theme") return rewardInput!.currentTheme === reward.themeId;
    if (loadout) return loadout[reward.kind]?.id === reward.id;
    return reward.kind === "frame" && rewardInput!.activeFrame === reward.frame;
  };
  const rewards: RewardView[] = (rewardInput?.list ?? []).map(reward => {
    const unlocked = rewardInput!.unlocked.includes(reward.id);
    return {
      id: reward.id,
      kind: reward.kind,
      name: reward.name,
      description: reward.description,
      icon: reward.icon,
      unlocked,
      hint: rewardInput!.hint(reward),
      cost: reward.cost ?? null,
      affordable: reward.cost !== undefined && stats.totalPoints >= reward.cost,
      active: unlocked && worn(reward),
      glyph: reward.glyph ?? null,
      style: reward.frame ?? reward.banner ?? reward.effect ?? null,
      previewing: !unlocked && reward.kind === "theme" && !!reward.themeId && rewardInput!.previewTheme === reward.themeId,
      themeId: reward.themeId ?? null,
      swatches: reward.themeId ? rewardInput!.swatches[reward.themeId] ?? [] : []
    };
  });

  const item = (reward: RewardDefinition | null | undefined): ProfileItem | null =>
    reward ? { id: reward.id, name: reward.name, icon: reward.icon, value: reward.glyph ?? reward.frame ?? reward.banner ?? reward.effect ?? null } : null;
  const frameFallback = !loadout && rewardInput?.activeFrame
    ? item((rewardInput.list ?? []).find(reward => reward.kind === "frame" && reward.frame === rewardInput.activeFrame))
    : null;
  const profile: ProfileView = {
    badge: level.badge,
    avatar: item(loadout?.avatar),
    title: item(loadout?.title),
    frame: loadout ? item(loadout.frame) : frameFallback,
    banner: item(loadout?.banner),
    effect: item(loadout?.effect)
  };
  const cosmetics = rewards.filter(reward => reward.kind !== "theme");

  const maxFreezes = input.freezes?.max ?? 0;
  const freezeCost = input.freezes?.cost ?? 0;
  const freezes = stats.streakFreezes ?? 0;
  const weekOf = (week: UserStats["weekly"]): WeekView => ({ points: week.points, runs: week.runs, tools: week.tools.length });

  return {
    balance: stats.totalPoints,
    lifetime: stats.lifetimePoints,
    level,
    nextLevel,
    levelPercent,
    pointsToNext,
    today: {
      earned,
      cap: input.dailyCap,
      percent: input.dailyCap > 0 ? Math.min(100, Math.floor((earned / input.dailyCap) * 100)) : 0,
      capReached: earned >= input.dailyCap,
      loginClaimed: Boolean(stats.dailyClaims[input.today]),
      loginPoints: input.loginPoints,
      bonusClaimed: Boolean(stats.dailyClaims[`${input.today}_bonus`]),
      bonusPoints: input.bonusPoints
    },
    streak: {
      days: stats.streakDays,
      next: streakNext,
      best: Math.max(stats.bestStreak ?? 1, stats.streakDays),
      freezes,
      maxFreezes,
      freezeCost,
      canBuyFreeze: maxFreezes > 0 && freezes < maxFreezes && stats.totalPoints >= freezeCost
    },
    quests: {
      items: quests,
      done: quests.filter(quest => quest.done).length,
      total: quests.length,
      chestPoints: QUEST_CHEST_POINTS,
      chestClaimed: Boolean(stats.quests?.chestClaimed),
      perfectDays: stats.perfectQuestDays ?? 0
    },
    rewards,
    play: buildPlayView(stats, input.today, input.findReward),
    profile,
    shop: {
      balance: stats.totalPoints,
      box: { cost: shop.boxCost, left: shop.boxLeft, affordable: shop.boxLeft > 0 && stats.totalPoints >= shop.boxCost },
      reroll: { cost: shop.rerollCost, left: shop.rerollsLeft, max: shop.maxRerolls, affordable: canReroll },
      collected: cosmetics.filter(reward => reward.unlocked).length,
      collectible: cosmetics.length
    },
    week: {
      current: stats.weekly ? weekOf(stats.weekly) : { points: 0, runs: 0, tools: 0 },
      last: stats.lastWeek ? { ...weekOf(stats.lastWeek), previousPoints: stats.lastWeek.previousPoints ?? 0 } : null
    },
    milestones: [
      // Closest to done first, completed ones last, so what to do next is on top.
      ...open.sort((a, b) => b.percent - a.percent || a.target - b.target),
      ...milestoneViews.filter(m => m.completed)
    ],
    milestoneSummary: {
      completed: milestoneViews.filter(m => m.completed).length,
      total: milestoneViews.length,
      earned: milestoneViews.filter(m => m.completed).reduce((sum, m) => sum + m.points, 0),
      available: open.reduce((sum, m) => sum + m.points, 0)
    },
    focus,
    levels: levels.map((_, index) => levelView(levels, index, currentIndex)),
    activities: stats.activities.map(entry => ({
      title: activityTitle(entry, input.toolNames),
      points: entry.points,
      timestamp: entry.timestamp,
      category: entry.category,
      kind: activityKind(entry)
    })),
    spend: {
      affordable,
      total: premium.length,
      cheapest,
      next: nextBuy ? { name: nextBuy.name, cost: nextBuy.pointCost, short: nextBuy.pointCost - stats.totalPoints } : null
    },
    rules: { dailyCap: input.dailyCap, rateLimitAfter: input.rateLimitAfter, freezeEvery: input.freezes?.every ?? 0, loginBonusMax: input.loginBonusMax ?? 0 }
  };
}

/** Readable names from contributed command titles ("🔐 DevSnip Pro: Hash Generator" -> "Hash Generator"). */
export function toolNamesFromManifest(commands: unknown): Record<string, string> {
  const names: Record<string, string> = {};
  if (!Array.isArray(commands)) return names;
  for (const entry of commands) {
    if (!entry || typeof entry.command !== "string" || typeof entry.title !== "string") continue;
    const title = entry.title.replace(/^[^A-Za-z0-9]*DevSnip Pro:\s*/, "").trim();
    if (title) names[entry.command] = title;
  }
  return names;
}
