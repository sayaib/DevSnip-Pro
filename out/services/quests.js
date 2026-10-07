"use strict";
/**
 * Daily quests: three small goals that change every day.
 *
 * The same three quests are picked for a date on every machine and in every
 * window, so a quest never changes under the user mid-day. Progress comes from
 * tool runs only, which every DevSnip Pro command already reports exactly once.
 *
 * Pure: no vscode import, so it is unit tested directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.allQuestsDone = exports.advanceQuests = exports.sanitizeQuests = exports.createDailyQuests = exports.pickDailyQuestIds = exports.findQuest = exports.QUEST_POOL = exports.QUEST_CHEST_POINTS = exports.QUESTS_PER_DAY = void 0;
exports.QUESTS_PER_DAY = 3;
/** Paid once a day when every quest is done. */
exports.QUEST_CHEST_POINTS = 15;
const PREFIX = "sayaib.hue-console.";
const any = () => 1;
exports.QUEST_POOL = [
    { id: "run_5", title: "Warm up", hint: "Run any 5 tools", icon: "⚡", target: 5, points: 10, easy: true, step: any },
    { id: "distinct_3", title: "Mix it up", hint: "Use 3 different tools", icon: "🎛️", target: 3, points: 10, easy: true, step: run => (run.newToday ? 1 : 0) },
    { id: "new_tool", title: "Explorer", hint: "Try a tool you have never used", icon: "🧭", target: 1, points: 20, step: run => (run.firstEver ? 1 : 0) },
    { id: "ai_2", title: "AI assist", hint: "Run 2 AI, ML or prompt tools", icon: "🤖", target: 2, points: 15, step: run => (run.category === "AI" ? 1 : 0) },
    { id: "security_1", title: "Lock it down", hint: "Run a security scan or audit", icon: "🛡️", target: 1, points: 15, step: run => (run.category === "Security" ? 1 : 0) },
    { id: "snippet_1", title: "Snippet time", hint: "Create or insert a code snippet", icon: "📝", target: 1, points: 15, step: run => (run.category === "Snippets" ? 1 : 0) },
    { id: "run_10", title: "In the zone", hint: "Run any 10 tools", icon: "🔥", target: 10, points: 15, step: any },
    { id: "distinct_5", title: "Toolbox tour", hint: "Use 5 different tools", icon: "🧰", target: 5, points: 20, step: run => (run.newToday ? 1 : 0) },
    { id: "api_client", title: "Ping an API", hint: "Open the REST API Client", icon: "🌐", target: 1, points: 15, step: run => (run.command === `${PREFIX}openGUI` ? 1 : 0) },
    { id: "database", title: "Query time", hint: "Open the Database Client", icon: "🗄️", target: 1, points: 15, step: run => (run.command === `${PREFIX}databaseClient` ? 1 : 0) }
];
function findQuest(id) {
    return exports.QUEST_POOL.find(quest => quest.id === id);
}
exports.findQuest = findQuest;
/** A small deterministic PRNG (mulberry32) seeded from the date string. */
function seededRandom(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let state = h >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** The quest ids for a date: one easy quest first, then two others, never repeating. */
function pickDailyQuestIds(date) {
    const random = seededRandom(`devsnip-quests-${date}`);
    const easy = exports.QUEST_POOL.filter(quest => quest.easy);
    const rest = exports.QUEST_POOL.filter(quest => !quest.easy);
    const picked = [easy[Math.floor(random() * easy.length)].id];
    const pool = [...rest];
    while (picked.length < exports.QUESTS_PER_DAY && pool.length) {
        picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0].id);
    }
    return picked;
}
exports.pickDailyQuestIds = pickDailyQuestIds;
function createDailyQuests(date) {
    return { date, items: pickDailyQuestIds(date).map(id => ({ id, progress: 0, done: false })), chestClaimed: false };
}
exports.createDailyQuests = createDailyQuests;
/** Repairs stored quests; anything unusable becomes a fresh set for `today`. */
function sanitizeQuests(raw, today) {
    if (!raw || typeof raw !== "object")
        return createDailyQuests(today);
    const source = raw;
    if (source.date !== today || !Array.isArray(source.items))
        return createDailyQuests(today);
    const expected = pickDailyQuestIds(today);
    const stored = new Map(source.items
        .filter((item) => !!item && typeof item === "object" && typeof item.id === "string")
        .map(item => [item.id, item]));
    return {
        date: today,
        items: expected.map(id => {
            const quest = findQuest(id);
            const item = stored.get(id);
            const progress = Math.max(0, Math.min(quest.target, Math.trunc(Number(item?.progress) || 0)));
            return { id, progress, done: item?.done === true || progress >= quest.target };
        }),
        chestClaimed: source.chestClaimed === true
    };
}
exports.sanitizeQuests = sanitizeQuests;
/** Moves today's quests for one tool run. Returns the quests this run completed. */
function advanceQuests(quests, run) {
    const completed = [];
    for (const item of quests.items) {
        if (item.done)
            continue;
        const quest = findQuest(item.id);
        if (!quest)
            continue;
        const step = quest.step(run);
        if (step <= 0)
            continue;
        item.progress = Math.min(quest.target, item.progress + step);
        if (item.progress >= quest.target) {
            item.done = true;
            completed.push(quest);
        }
    }
    return completed;
}
exports.advanceQuests = advanceQuests;
function allQuestsDone(quests) {
    return quests.items.length > 0 && quests.items.every(item => item.done);
}
exports.allQuestsDone = allQuestsDone;
//# sourceMappingURL=quests.js.map