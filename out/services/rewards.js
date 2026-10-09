"use strict";
/**
 * Things points and progress unlock. Every tool stays available at every rank -
 * rewards are cosmetic: appearance themes, plus a personal profile made of an
 * avatar, a title, a badge frame, a banner and a celebration effect, shown on
 * the rank card in the Tools view and on the Milestones page.
 *
 * Every theme except System Default is unlocked with points. A few rewards can
 * also be earned by rank or a milestone, and some can only be earned. A theme
 * someone was already using when themes became paid stays theirs for free (see
 * grantKeptTheme in milestoneTracker).
 *
 * Pure: no vscode import, so it is unit tested directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickMysteryReward = exports.mysteryBoxPool = exports.activeFrame = exports.resolveLoadout = exports.sanitizeLoadout = exports.unlockLabel = exports.earnedRewardIds = exports.isCosmetic = exports.rewardForTheme = exports.findReward = exports.MYSTERY_BOX_MAX_VALUE = exports.MYSTERY_BOX_COST = exports.REWARDS = exports.SLOTS = void 0;
/** The profile slots a cosmetic reward is equipped in. Themes are applied, not equipped. */
exports.SLOTS = ["avatar", "title", "frame", "banner", "effect"];
exports.REWARDS = [
    // Themes
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
    // Avatars: shown on your rank card in place of the rank medal
    { id: "avatar_cat", kind: "avatar", name: "Code Cat", description: "Sits on your keyboard, judges your variable names.", icon: "🐱", glyph: "🐱", cost: 40 },
    { id: "avatar_fox", kind: "avatar", name: "Clever Fox", description: "Quick, curious and always one shortcut ahead.", icon: "🦊", glyph: "🦊", cost: 60 },
    { id: "avatar_owl", kind: "avatar", name: "Night Owl", description: "For the ones who ship after midnight.", icon: "🦉", glyph: "🦉", cost: 60 },
    { id: "avatar_robot", kind: "avatar", name: "Robot", description: "Beep boop. Fully automated.", icon: "🤖", glyph: "🤖", cost: 80 },
    { id: "avatar_octopus", kind: "avatar", name: "Octocoder", description: "Eight arms, eight terminals.", icon: "🐙", glyph: "🐙", cost: 100 },
    { id: "avatar_rocket", kind: "avatar", name: "Rocket", description: "Deploys at escape velocity.", icon: "🚀", glyph: "🚀", cost: 120 },
    { id: "avatar_invader", kind: "avatar", name: "Pixel Invader", description: "A retro arcade classic.", icon: "👾", glyph: "👾", cost: 150 },
    { id: "avatar_ninja", kind: "avatar", name: "Ninja", description: "Silent refactors, no trace left behind.", icon: "🥷", glyph: "🥷", cost: 200 },
    { id: "avatar_wizard", kind: "avatar", name: "Wizard", description: "Any sufficiently clever code is magic.", icon: "🧙", glyph: "🧙", cost: 250 },
    { id: "avatar_dragon", kind: "avatar", name: "Dragon", description: "Guards the main branch fiercely.", icon: "🐉", glyph: "🐉", cost: 400 },
    { id: "avatar_unicorn", kind: "avatar", name: "Unicorn", description: "Rare, legendary, zero bugs in production.", icon: "🦄", glyph: "🦄", cost: 600 },
    { id: "avatar_gem", kind: "avatar", name: "Diamond Mind", description: "Only for those who reach Diamond.", icon: "💠", glyph: "💠", unlock: { level: 4 } },
    { id: "avatar_seer", kind: "avatar", name: "Seer", description: "Only for those who reach Master.", icon: "🔮", glyph: "🔮", unlock: { level: 5 } },
    { id: "avatar_eagle", kind: "avatar", name: "Legend", description: "Only for those who reach Grandmaster.", icon: "🦅", glyph: "🦅", unlock: { level: 6 } },
    { id: "avatar_champion", kind: "avatar", name: "Champion", description: "Earned by completing 3 weekly events.", icon: "🏅", glyph: "🏅", unlock: { milestone: "events_3" } },
    { id: "avatar_astronaut", kind: "avatar", name: "Astronaut", description: "Exclusive to Explorer Week.", icon: "🧑‍🚀", glyph: "🧑‍🚀", unlock: { event: "explorer_week" } },
    { id: "avatar_satellite", kind: "avatar", name: "Satellite", description: "Exclusive to API Week.", icon: "🛰️", glyph: "🛰️", unlock: { event: "api_week" } },
    // Titles: shown under your rank
    { id: "title_bug", kind: "title", name: "Bug Squasher", description: "A title for the one who fixes it.", icon: "🐛", cost: 50 },
    { id: "title_coffee", kind: "title", name: "Coffee-Driven Dev", description: "Runs on espresso and good intentions.", icon: "☕", cost: 50 },
    { id: "title_regex", kind: "title", name: "Regex Wizard", description: "Speaks fluent ^(?:[a-z]+)$.", icon: "🪄", cost: 80 },
    { id: "title_api", kind: "title", name: "API Whisperer", description: "Every endpoint answers you.", icon: "🌐", cost: 80 },
    { id: "title_ship", kind: "title", name: "Ship-It Captain", description: "Merges with confidence.", icon: "🚢", cost: 100 },
    { id: "title_night", kind: "title", name: "Midnight Committer", description: "Your best commits have timestamps after 00:00.", icon: "🌙", cost: 120 },
    { id: "title_refactor", kind: "title", name: "Refactor Royalty", description: "Leaves every file better than they found it.", icon: "👑", cost: 150 },
    { id: "title_10x", kind: "title", name: "10x Developer", description: "The title everyone jokes about, now officially yours.", icon: "💥", cost: 500 },
    { id: "title_pathfinder", kind: "title", name: "Pathfinder", description: "Earned by completing Feature Explorer.", icon: "🧭", unlock: { milestone: "feature_explorer" } },
    { id: "title_sentinel", kind: "title", name: "Security Sentinel", description: "Earned by completing Security Sentinel.", icon: "🛡️", unlock: { milestone: "security_audit" } },
    { id: "title_quest", kind: "title", name: "Quest Master", description: "Earned by finishing every quest on 7 days.", icon: "🎯", unlock: { milestone: "quest_master" } },
    { id: "title_unstoppable", kind: "title", name: "Unstoppable", description: "Earned with a 100-day streak.", icon: "💯", unlock: { milestone: "streak_100" } },
    { id: "title_legend", kind: "title", name: "Global Legend", description: "Earned by reaching Grandmaster.", icon: "⚡", unlock: { level: 6 } },
    { id: "title_sharp_mind", kind: "title", name: "Sharp Mind", description: "Earned by answering 10 daily challenges correctly.", icon: "🧠", unlock: { milestone: "quiz_10" } },
    { id: "title_snippet_smith", kind: "title", name: "Snippet Smith", description: "Exclusive to Snippet Week.", icon: "🔨", unlock: { event: "snippet_week" } },
    { id: "title_marathoner", kind: "title", name: "Marathoner", description: "Exclusive to Marathon Week.", icon: "🏃", unlock: { event: "marathon_week" } },
    // Badge frames: a ring around your avatar or rank medal
    { id: "frame_frost", kind: "frame", name: "Frost ring", description: "An icy blue ring around your badge.", icon: "❄️", frame: "frost", cost: 120 },
    { id: "frame_pixel", kind: "frame", name: "Pixel border", description: "A chunky 8-bit outline.", icon: "🟩", frame: "pixel", cost: 150 },
    { id: "frame_neon", kind: "frame", name: "Neon pulse", description: "A magenta neon ring that gently pulses.", icon: "💡", frame: "neon", cost: 180 },
    { id: "frame_rainbow", kind: "frame", name: "Rainbow halo", description: "Every colour at once.", icon: "🌈", frame: "rainbow", cost: 300 },
    { id: "frame_orbit", kind: "frame", name: "Orbit", description: "A little moon circles your badge.", icon: "🪐", frame: "orbit", cost: 400 },
    { id: "frame_glow", kind: "frame", name: "Quest glow", description: "A soft golden glow around your rank badge.", icon: "✨", frame: "glow", unlock: { milestone: "quest_master" } },
    { id: "frame_flame", kind: "frame", name: "Flame ring", description: "A ring of fire around your rank badge.", icon: "🔥", frame: "flame", unlock: { milestone: "streak_30" } },
    { id: "frame_shield", kind: "frame", name: "Shield ring", description: "Exclusive to Security Week.", icon: "🛡️", frame: "shield", unlock: { event: "security_week" } },
    // Banners: the background of your rank card
    { id: "banner_sunset", kind: "banner", name: "Sunset", description: "Warm orange fading into rose.", icon: "🌇", banner: "sunset", cost: 80 },
    { id: "banner_ocean", kind: "banner", name: "Deep ocean", description: "Cool teal into deep blue.", icon: "🌊", banner: "ocean", cost: 80 },
    { id: "banner_forest", kind: "banner", name: "Forest", description: "Moss and pine greens.", icon: "🌲", banner: "forest", cost: 100 },
    { id: "banner_grid", kind: "banner", name: "Synth grid", description: "A retro neon grid on the horizon.", icon: "🟪", banner: "grid", cost: 150 },
    { id: "banner_stars", kind: "banner", name: "Starfield", description: "Tiny stars scattered across the night.", icon: "✨", banner: "stars", cost: 200 },
    { id: "banner_circuit", kind: "banner", name: "Circuit board", description: "Traces and pads, for hardware hearts.", icon: "🔌", banner: "circuit", cost: 250 },
    { id: "banner_gold", kind: "banner", name: "Gold rush", description: "Earned by collecting 5,000 points in total.", icon: "💰", banner: "gold", unlock: { milestone: "points_5000" } },
    { id: "banner_neural", kind: "banner", name: "Neural net", description: "Exclusive to AI Week.", icon: "🧠", banner: "neural", unlock: { event: "ai_week" } },
    // Celebration effects: play when you complete a quest, a milestone or rank up
    { id: "effect_sparkles", kind: "effect", name: "Sparkles", description: "A little shimmer for every win.", icon: "✨", effect: "sparkles", cost: 40 },
    { id: "effect_confetti", kind: "effect", name: "Confetti", description: "A burst of colourful confetti.", icon: "🎊", effect: "confetti", cost: 60 },
    { id: "effect_coins", kind: "effect", name: "Coin shower", description: "Gold coins rain down when you earn big.", icon: "🪙", effect: "coins", cost: 100 },
    { id: "effect_avatar", kind: "effect", name: "Avatar rain", description: "Your avatar or rank medal rains down.", icon: "🌧️", effect: "avatar", cost: 120 },
    { id: "effect_fireworks", kind: "effect", name: "Fireworks", description: "A full fireworks show for each win.", icon: "🎆", effect: "fireworks", cost: 150 }
];
/** Points for one mystery box: a random cosmetic you do not own yet. */
exports.MYSTERY_BOX_COST = 100;
/** The box only holds cosmetics priced up to this, so it stays a fair gamble. */
exports.MYSTERY_BOX_MAX_VALUE = 300;
function findReward(id) {
    return exports.REWARDS.find(reward => reward.id === id);
}
exports.findReward = findReward;
function rewardForTheme(themeId) {
    return exports.REWARDS.find(reward => reward.kind === "theme" && reward.themeId === themeId);
}
exports.rewardForTheme = rewardForTheme;
function isCosmetic(reward) {
    return reward.kind !== "theme";
}
exports.isCosmetic = isCosmetic;
/** Rewards earned through progress alone (not bought). */
function earnedRewardIds(levelIndex, completedMilestones) {
    return exports.REWARDS.filter(reward => {
        const unlock = reward.unlock;
        if (!unlock)
            return false;
        if ("level" in unlock)
            return levelIndex >= unlock.level;
        // Event rewards are recorded when the event is won; they cannot be derived from progress.
        return "milestone" in unlock && completedMilestones.includes(unlock.milestone);
    }).map(reward => reward.id);
}
exports.earnedRewardIds = earnedRewardIds;
/** "Reach Gold" / "Complete Weekly Warrior" / "Win Security Week", or null when points are the only way. */
function unlockLabel(reward, levelName, milestoneTitle, eventTitle = id => id) {
    const unlock = reward.unlock;
    if (!unlock)
        return null;
    if ("level" in unlock)
        return `Reach ${levelName(unlock.level)}`;
    if ("milestone" in unlock)
        return `Complete ${milestoneTitle(unlock.milestone)}`;
    return `Win ${eventTitle(unlock.event)}`;
}
exports.unlockLabel = unlockLabel;
/** Keeps only slot entries that name a reward of that slot's kind (or null). */
function sanitizeLoadout(raw) {
    const loadout = {};
    if (!raw || typeof raw !== "object")
        return loadout;
    const source = raw;
    for (const slot of exports.SLOTS) {
        const value = source[slot];
        if (value === null)
            loadout[slot] = null;
        else if (typeof value === "string" && findReward(value)?.kind === slot)
            loadout[slot] = value;
    }
    return loadout;
}
exports.sanitizeLoadout = sanitizeLoadout;
/**
 * The reward worn in each slot. Only owned rewards are worn. A frame that was
 * never chosen falls back to the most recently listed one owned, so frames
 * earned before the profile existed keep showing.
 */
function resolveLoadout(loadout, unlocked) {
    const resolved = {};
    for (const slot of exports.SLOTS) {
        const chosen = loadout[slot];
        if (typeof chosen === "string" && unlocked.includes(chosen)) {
            resolved[slot] = findReward(chosen) ?? null;
        }
        else if (chosen === undefined && slot === "frame") {
            const frames = exports.REWARDS.filter(reward => reward.kind === "frame" && unlocked.includes(reward.id));
            resolved[slot] = frames.length ? frames[frames.length - 1] : null;
        }
        else {
            resolved[slot] = null;
        }
    }
    return resolved;
}
exports.resolveLoadout = resolveLoadout;
/** The frame the rank badge wears. */
function activeFrame(unlocked, loadout = {}) {
    return resolveLoadout(loadout, unlocked).frame?.frame ?? null;
}
exports.activeFrame = activeFrame;
/** Cosmetics a mystery box can hold: priced, affordable-tier, and not owned yet. */
function mysteryBoxPool(unlocked) {
    return exports.REWARDS.filter(reward => isCosmetic(reward) && reward.cost !== undefined && reward.cost <= exports.MYSTERY_BOX_MAX_VALUE && !unlocked.includes(reward.id));
}
exports.mysteryBoxPool = mysteryBoxPool;
/** Picks one reward from the pool; `random` returns [0, 1). */
function pickMysteryReward(pool, random = Math.random) {
    if (!pool.length)
        return undefined;
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
    return pool[index];
}
exports.pickMysteryReward = pickMysteryReward;
//# sourceMappingURL=rewards.js.map