"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolNamesFromManifest = exports.buildTrackerView = exports.buildPlayView = exports.levelIndexFor = void 0;
const quests_1 = require("./quests");
const activities_1 = require("./activities");
function levelIndexFor(points, levels) {
    let index = 0;
    for (let i = 0; i < levels.length; i++) {
        if (points >= levels[i].minPoints)
            index = i;
        else
            break;
    }
    return index;
}
exports.levelIndexFor = levelIndexFor;
function levelView(levels, index, currentIndex) {
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
function plural(count, one, many = `${one}s`) {
    return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}
/** What is still needed for a milestone, in the unit its target is counted in. */
function remainingLabel(milestone, remaining) {
    if (remaining <= 0)
        return "Completed";
    if (milestone.id.startsWith("streak"))
        return `${plural(remaining, "more day")} in a row`;
    if (milestone.id === "points_5000")
        return `${plural(remaining, "more point")} to earn`;
    if (milestone.id === "snippet_creator")
        return `${plural(remaining, "more snippet")}`;
    if (milestone.id === "security_audit")
        return `${plural(remaining, "more audit")}`;
    if (milestone.id === "ai_explorer")
        return `${plural(remaining, "more AI tool run")}`;
    if (milestone.id === "feature_explorer")
        return `${plural(remaining, "more feature")} to try`;
    if (milestone.id === "quest_master")
        return `${plural(remaining, "more day")} with every quest done`;
    if (milestone.id === "quiz_10")
        return `${plural(remaining, "more correct answer")} in the daily challenge`;
    if (milestone.id === "events_3")
        return `${plural(remaining, "more weekly event")} to complete`;
    return `${plural(remaining, "more tool run")}`;
}
function activityKind(entry) {
    if (entry.category === "Milestone")
        return "milestone";
    if (entry.category === "Redemption")
        return entry.points < 0 ? "spend" : "refund";
    if (entry.id === "daily_login" || entry.id === "daily_bonus")
        return "bonus";
    if (entry.category === "Quest")
        return "quest";
    if (entry.id.startsWith("streak_freeze"))
        return "freeze";
    if (entry.category === "Play" || entry.category === "Event" || entry.id === "lucky_find")
        return "play";
    if (entry.id.startsWith("sayaib."))
        return "tool";
    return "other";
}
function activityTitle(entry, toolNames) {
    if (entry.id.startsWith("sayaib.")) {
        return toolNames[entry.id] || entry.title.replace(/^Tool Use:\s*/, "");
    }
    // Stored titles repeat the amount ("(+50 pts)"); the feed shows it in its own column.
    return entry.title.replace(/\s*\([+-]?\d+ pts\)\s*$/, "").replace(/^Milestone Unlocked:\s*/, "Milestone unlocked: ");
}
/** Days from a local YYYY-MM-DD date to another. */
function dayGap(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) || 0;
}
/** Today's activities, with nothing given away early (the challenge's answer stays on the extension side). */
function buildPlayView(stats, today, findReward) {
    // Older callers may pass stats saved before activities existed.
    const play = stats.play ?? { date: today, spinsUsed: 0, bonusSpins: 0, lastSpin: null, quizChoice: null, tipTried: false, sprintScore: null, lucky: false };
    if (!stats.event) {
        const [year, month, day] = today.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const weekStart = date.toISOString().slice(0, 10);
        stats = { ...stats, event: { weekStart, id: (0, activities_1.eventForWeek)(weekStart).id, progress: 0, done: false } };
    }
    const totalWeight = activities_1.WHEEL.reduce((sum, segment) => sum + segment.weight, 0);
    const spinsLeft = Math.max(0, 1 + play.bonusSpins - play.spinsUsed);
    const question = (0, activities_1.quizForDate)(play.date || today);
    const answered = play.quizChoice !== null;
    const tip = (0, activities_1.tipForDate)(play.date || today);
    const event = (0, activities_1.eventForWeek)(stats.event.weekStart);
    const prize = findReward?.(event.rewardId);
    const waiting = spinsLeft + (answered ? 0 : 1) + (play.sprintScore === null ? 1 : 0) + (play.tipTried ? 0 : 1);
    return {
        waiting,
        wheel: {
            segments: activities_1.WHEEL.map(segment => ({
                label: segment.label, icon: segment.icon, color: segment.color, chance: Math.round((segment.weight / totalWeight) * 100),
                kind: "freeze" in segment.prize ? "freeze" : "item" in segment.prize ? "item" : "points"
            })),
            spinsLeft,
            bonusSpins: play.bonusSpins,
            lastSpin: play.lastSpin,
            prize: play.prize ? { text: play.prize.text, points: play.prize.points, rewardId: play.prize.rewardId ?? null } : null,
            fallbackPoints: activities_1.WHEEL_FALLBACK_POINTS
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
            correctPoints: activities_1.QUIZ_CORRECT_POINTS,
            tryPoints: activities_1.QUIZ_TRY_POINTS,
            correctTotal: stats.quizCorrect ?? 0,
            streak: stats.quizLastCorrect && dayGap(stats.quizLastCorrect, today) <= 1 ? stats.quizStreak : 0
        },
        sprint: { played: play.sprintScore !== null, score: play.sprintScore, best: stats.sprintBest ?? 0, maxPoints: activities_1.SPRINT_MAX_POINTS, seconds: activities_1.SPRINT_SECONDS },
        tip: { id: tip.id, title: tip.title, text: tip.text, action: tip.action, tried: play.tipTried, points: activities_1.TIP_POINTS },
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
        checkin: { day: ((Math.max(1, stats.streakDays) - 1) % activities_1.CHECKIN_CHEST_EVERY) + 1, every: activities_1.CHECKIN_CHEST_EVERY, streak: stats.streakDays },
        lucky: { found: play.lucky, points: activities_1.LUCKY_POINTS }
    };
}
exports.buildPlayView = buildPlayView;
function buildTrackerView(input) {
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
    const milestoneViews = milestones.map(milestone => {
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
    const quests = [];
    for (const item of stats.quests?.items ?? []) {
        const quest = (0, quests_1.findQuest)(item.id);
        if (!quest)
            continue;
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
    const worn = (reward) => {
        if (reward.kind === "theme")
            return rewardInput.currentTheme === reward.themeId;
        if (loadout)
            return loadout[reward.kind]?.id === reward.id;
        return reward.kind === "frame" && rewardInput.activeFrame === reward.frame;
    };
    const rewards = (rewardInput?.list ?? []).map(reward => {
        const unlocked = rewardInput.unlocked.includes(reward.id);
        return {
            id: reward.id,
            kind: reward.kind,
            name: reward.name,
            description: reward.description,
            icon: reward.icon,
            unlocked,
            hint: rewardInput.hint(reward),
            cost: reward.cost ?? null,
            affordable: reward.cost !== undefined && stats.totalPoints >= reward.cost,
            active: unlocked && worn(reward),
            glyph: reward.glyph ?? null,
            style: reward.frame ?? reward.banner ?? reward.effect ?? null,
            previewing: !unlocked && reward.kind === "theme" && !!reward.themeId && rewardInput.previewTheme === reward.themeId,
            themeId: reward.themeId ?? null,
            swatches: reward.themeId ? rewardInput.swatches[reward.themeId] ?? [] : []
        };
    });
    const item = (reward) => reward ? { id: reward.id, name: reward.name, icon: reward.icon, value: reward.glyph ?? reward.frame ?? reward.banner ?? reward.effect ?? null } : null;
    const frameFallback = !loadout && rewardInput?.activeFrame
        ? item((rewardInput.list ?? []).find(reward => reward.kind === "frame" && reward.frame === rewardInput.activeFrame))
        : null;
    const profile = {
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
    const weekOf = (week) => ({ points: week.points, runs: week.runs, tools: week.tools.length });
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
            chestPoints: quests_1.QUEST_CHEST_POINTS,
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
exports.buildTrackerView = buildTrackerView;
/** Readable names from contributed command titles ("🔐 DevSnip Pro: Hash Generator" -> "Hash Generator"). */
function toolNamesFromManifest(commands) {
    const names = {};
    if (!Array.isArray(commands))
        return names;
    for (const entry of commands) {
        if (!entry || typeof entry.command !== "string" || typeof entry.title !== "string")
            continue;
        const title = entry.title.replace(/^[^A-Za-z0-9]*DevSnip Pro:\s*/, "").trim();
        if (title)
            names[entry.command] = title;
    }
    return names;
}
exports.toolNamesFromManifest = toolNamesFromManifest;
//# sourceMappingURL=milestone-view.js.map