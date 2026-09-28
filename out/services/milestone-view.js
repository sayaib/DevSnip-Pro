"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolNamesFromManifest = exports.buildTrackerView = exports.levelIndexFor = void 0;
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
    return `${plural(remaining, "more tool run")}`;
}
function activityKind(entry) {
    if (entry.category === "Milestone")
        return "milestone";
    if (entry.category === "Redemption")
        return entry.points < 0 ? "spend" : "refund";
    if (entry.id === "daily_login" || entry.id === "daily_bonus")
        return "bonus";
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
        streak: { days: stats.streakDays, next: streakNext },
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
        rules: { dailyCap: input.dailyCap, rateLimitAfter: input.rateLimitAfter }
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