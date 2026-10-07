/**
 * Things points and progress unlock: appearance themes and frames for the
 * rank badge. Every tool stays available at every rank - rewards are cosmetic.
 *
 * Every theme except System Default is unlocked with points. A few can also be
 * earned by rank or a milestone. A theme someone was already using when themes
 * became paid stays theirs for free (see grantReward in milestoneTracker).
 *
 * Pure: no vscode import, so it is unit tested directly.
 */

export type RewardUnlock = { level: number } | { milestone: string };

export interface RewardDefinition {
  id: string;
  kind: "theme" | "frame";
  name: string;
  description: string;
  icon: string;
  /** For themes: the THEMES id it unlocks. */
  themeId?: string;
  /** For frames: the CSS frame name the rank badge wears. */
  frame?: string;
  /** How it is earned without points; absent when points are the only way. */
  unlock?: RewardUnlock;
  /** Points to unlock it. Frames can only be earned. */
  cost?: number;
}

export const REWARDS: RewardDefinition[] = [
  { id: "theme_dark", kind: "theme", name: "Dark", description: "Neutral graphite with a clear blue accent.", icon: "🌑", themeId: "dark", cost: 25 },
  { id: "theme_light", kind: "theme", name: "Light", description: "Crisp white with GitHub-style blue.", icon: "☀️", themeId: "light", cost: 25 },
  { id: "theme_high_contrast", kind: "theme", name: "High Contrast", description: "Pure black, bold outlines, maximum legibility.", icon: "🔲", themeId: "high-contrast", cost: 25 },
  { id: "theme_midnight", kind: "theme", name: "Midnight", description: "Deep navy with soft periwinkle highlights.", icon: "🌃", themeId: "midnight", cost: 100 },
  { id: "theme_nord", kind: "theme", name: "Nord", description: "Arctic slate with frosty blues.", icon: "🧊", themeId: "nord", cost: 100 },
  { id: "theme_monokai", kind: "theme", name: "Monokai", description: "Warm charcoal with lime, cyan and orange.", icon: "🍋", themeId: "monokai", cost: 150 },
  { id: "theme_dracula", kind: "theme", name: "Dracula", description: "The classic purple-and-pink night palette.", icon: "🧛", themeId: "dracula", cost: 150 },
  { id: "theme_cyberpunk", kind: "theme", name: "Cyberpunk", description: "Neon cyan and magenta on near-black.", icon: "🌐", themeId: "cyberpunk", cost: 200 },
  { id: "theme_solarized", kind: "theme", name: "Solarized", description: "The calm teal-and-amber classic.", icon: "🌅", themeId: "solarized", unlock: { level: 1 }, cost: 250 },
  { id: "theme_ember", kind: "theme", name: "Ember", description: "Warm coal and glowing orange, for the streak keepers.", icon: "🔥", themeId: "ember", unlock: { milestone: "streak_14" }, cost: 400 },
  { id: "theme_synthwave", kind: "theme", name: "Synthwave", description: "Retro sunset purples with hot-pink neon.", icon: "🌆", themeId: "synthwave", unlock: { level: 2 }, cost: 500 },
  { id: "theme_aurora", kind: "theme", name: "Aurora", description: "Polar night with green and violet light.", icon: "🌌", themeId: "aurora", unlock: { level: 3 }, cost: 900 },
  { id: "frame_glow", kind: "frame", name: "Quest glow", description: "A soft golden glow around your rank badge.", icon: "✨", frame: "glow", unlock: { milestone: "quest_master" } },
  { id: "frame_flame", kind: "frame", name: "Flame ring", description: "A ring of fire around your rank badge.", icon: "🔥", frame: "flame", unlock: { milestone: "streak_30" } }
];

export function findReward(id: string): RewardDefinition | undefined {
  return REWARDS.find(reward => reward.id === id);
}

export function rewardForTheme(themeId: string): RewardDefinition | undefined {
  return REWARDS.find(reward => reward.kind === "theme" && reward.themeId === themeId);
}

/** Rewards earned through progress alone (not bought). */
export function earnedRewardIds(levelIndex: number, completedMilestones: readonly string[]): string[] {
  return REWARDS.filter(reward => {
    const unlock = reward.unlock;
    if (!unlock) return false;
    return "level" in unlock ? levelIndex >= unlock.level : completedMilestones.includes(unlock.milestone);
  }).map(reward => reward.id);
}

/** "Reach Gold" / "Complete Weekly Warrior", or null when points are the only way. */
export function unlockLabel(reward: RewardDefinition, levelName: (index: number) => string, milestoneTitle: (id: string) => string): string | null {
  if (!reward.unlock) return null;
  return "level" in reward.unlock ? `Reach ${levelName(reward.unlock.level)}` : `Complete ${milestoneTitle(reward.unlock.milestone)}`;
}

/** The frame the rank badge wears: the most recently listed unlocked one. */
export function activeFrame(unlocked: readonly string[]): string | null {
  const frames = REWARDS.filter(reward => reward.kind === "frame" && unlocked.includes(reward.id));
  return frames.length ? (frames[frames.length - 1].frame as string) : null;
}
