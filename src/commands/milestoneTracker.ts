import * as vscode from 'vscode';

export interface UserStats {
    totalPoints: number;
    dailyPoints: number;
    lastActiveDate: string; // YYYY-MM-DD
    streakDays: number;
    activities: { id: string; title: string; points: number; timestamp: number; category: string }[];
    completedMilestones: string[];
    claimedRewards: string[];
    dailyClaims: { [date: string]: boolean };
    dailyToolUsage: { [toolKey: string]: number };
}

export interface LevelInfo {
    name: string;
    minPoints: number;
    color: string;
    badge: string;
    rank: string;
    reward: string;
}

export const LEVELS: LevelInfo[] = [
    { name: "Bronze", minPoints: 0, color: "#CD7F32", badge: "🥉", rank: "Rank #5 (Novice Developer)", reward: "Basic Snippet Library & Core Tools" },
    { name: "Silver", minPoints: 150, color: "#C0C0C0", badge: "🥈", rank: "Rank #4 (Skilled Coder)", reward: "Advanced Regex, JSON Formatter & Security Audits" },
    { name: "Gold", minPoints: 600, color: "#FFD700", badge: "🥇", rank: "Rank #3 (Senior Engineer)", reward: "AI/ML Hub, Prompt Engineer & RAG Tools" },
    { name: "Platinum", minPoints: 1800, color: "#E5E4E2", badge: "💎", rank: "Rank #2 (Principal Architect)", reward: "Big Data, DevOps Generators & Cloud Audits" },
    { name: "Diamond", minPoints: 4500, color: "#B9F2FF", badge: "👑", rank: "Rank #1 (Elite Innovator)", reward: "DevSnip Pro Master Status & Unlimited Productivity" },
    { name: "Master", minPoints: 10000, color: "#9c27b0", badge: "🔮", rank: "Rank #0.5 (Grand Master)", reward: "Exclusive Expert Utilities & AI Prompt Playground" },
    { name: "Grandmaster", minPoints: 25000, color: "#ff5722", badge: "⚡", rank: "Rank #1 (Global Legend)", reward: "Legendary DevSnip Pro Productivity Icon Status" }
];

export interface Milestone {
    id: string;
    title: string;
    description: string;
    target: number;
    points: number;
    category: string;
    icon: string;
}

export const MILESTONES: Milestone[] = [
    { id: "first_tool", title: "First Tool Execution", description: "Run any DevSnip Pro tool", target: 1, points: 10, category: "Core", icon: "🚀" },
    { id: "tool_explorer", title: "Tool Explorer", description: "Execute tools 25 times", target: 25, points: 50, category: "Core", icon: "🛠️" },
    { id: "power_user", title: "Power Developer", description: "Execute tools 100 times", target: 100, points: 200, category: "Core", icon: "⚡" },
    { id: "snippet_creator", title: "Snippet Creator", description: "Create 10 custom code snippets", target: 10, points: 75, category: "Snippets", icon: "📝" },
    { id: "streak_5", title: "Consistent Coder", description: "Maintain active usage for 5 consecutive days", target: 5, points: 60, category: "Activity", icon: "🔥" },
    { id: "streak_14", title: "Weekly Warrior", description: "Maintain active usage for 14 consecutive days", target: 14, points: 200, category: "Activity", icon: "🌟" },
    { id: "security_audit", title: "Security Sentinel", description: "Run 5 Security or Cloud Audits", target: 5, points: 80, category: "Security", icon: "🛡️" },
    { id: "ai_explorer", title: "AI/ML Enthusiast", description: "Use AI/ML or RAG tools 10 times", target: 10, points: 90, category: "AI", icon: "🤖" },
    { id: "points_5000", title: "Point Tycoon", description: "Accumulate 5,000 total points", target: 5000, points: 500, category: "Milestone", icon: "💰" }
];

let globalContext: vscode.ExtensionContext | undefined;
let refreshCallback: (() => void) | undefined;

export function setMilestoneContext(context: vscode.ExtensionContext) {
    globalContext = context;
}

export function setTreeRefreshCallback(cb: () => void) {
    refreshCallback = cb;
}

function getTodayString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

export function getUserStats(context: vscode.ExtensionContext): UserStats {
    const defaultStats: UserStats = {
        totalPoints: 0,
        dailyPoints: 0,
        lastActiveDate: getTodayString(),
        streakDays: 1,
        activities: [],
        completedMilestones: [],
        claimedRewards: [],
        dailyClaims: {},
        dailyToolUsage: {}
    };

    const stats = context.globalState.get<UserStats>('devsnip_user_stats', defaultStats);
    const today = getTodayString();

    if (stats.lastActiveDate !== today) {
        const lastDate = new Date(stats.lastActiveDate);
        const currentDate = new Date(today);
        const diffTime = currentDate.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

        if (diffDays === 1) {
            stats.streakDays += 1;
        } else if (diffDays > 1) {
            stats.streakDays = 1;
        }
        stats.dailyPoints = 0;
        stats.lastActiveDate = today;
        stats.dailyToolUsage = {};
    }

    if (!stats.dailyToolUsage) {
        stats.dailyToolUsage = {};
    }

    return stats;
}

export async function saveUserStats(context: vscode.ExtensionContext, stats: UserStats): Promise<void> {
    await context.globalState.update('devsnip_user_stats', stats);
}

export async function redeemPoints(context: vscode.ExtensionContext, cost: number, reason: string): Promise<boolean> {
    const stats = getUserStats(context);
    if (stats.totalPoints < cost) {
        return false;
    }
    stats.totalPoints -= cost;
    stats.activities.unshift({
        id: `redeem_${Date.now()}`,
        title: `Redeemed Points: ${reason} (-${cost} pts)`,
        points: -cost,
        timestamp: Date.now(),
        category: 'Redemption'
    });
    await saveUserStats(context, stats);
    if (refreshCallback) {
        refreshCallback();
    }
    return true;
}

export async function recordActivity(
    context: vscode.ExtensionContext,
    activityId: string,
    title: string,
    points: number,
    category: string
): Promise<{ stats: UserStats; newMilestones: string[]; levelUp: boolean }> {
    const stats = getUserStats(context);
    const today = getTodayString();

    stats.totalPoints += points;
    stats.dailyPoints += points;
    stats.lastActiveDate = today;

    stats.activities.unshift({
        id: activityId,
        title,
        points,
        timestamp: Date.now(),
        category
    });

    if (stats.activities.length > 100) {
        stats.activities = stats.activities.slice(0, 100);
    }

    const oldLevel = getCurrentLevelName(stats.totalPoints - points);
    const newLevel = getCurrentLevelName(stats.totalPoints);
    const levelUp = oldLevel !== newLevel;

    const newMilestones: string[] = [];
    for (const m of MILESTONES) {
        if (!stats.completedMilestones.includes(m.id)) {
            let progress = 0;
            if (m.id === 'first_tool') {
                progress = stats.activities.length > 0 ? 1 : 0;
            } else if (m.id === 'tool_explorer' || m.id === 'power_user') {
                progress = stats.activities.filter(a => a.category === 'Core' || a.id.startsWith('sayaib.')).length;
            } else if (m.id === 'snippet_creator') {
                progress = stats.activities.filter(a => a.id.includes('snippet') || a.category === 'Snippets').length;
            } else if (m.id === 'streak_5') {
                progress = stats.streakDays >= 5 ? 5 : stats.streakDays;
            } else if (m.id === 'streak_14') {
                progress = stats.streakDays >= 14 ? 14 : stats.streakDays;
            } else if (m.id === 'security_audit') {
                progress = stats.activities.filter(a => a.category === 'Security').length;
            } else if (m.id === 'ai_explorer') {
                progress = stats.activities.filter(a => a.category === 'AI').length;
            } else if (m.id === 'points_5000') {
                progress = stats.totalPoints;
            }

            if (progress >= m.target) {
                stats.completedMilestones.push(m.id);
                stats.totalPoints += m.points;
                stats.dailyPoints += m.points;
                newMilestones.push(m.title);
                stats.activities.unshift({
                    id: `milestone_${m.id}`,
                    title: `Milestone Unlocked: ${m.title} (+${m.points} pts)`,
                    points: m.points,
                    timestamp: Date.now(),
                    category: 'Milestone'
                });
            }
        }
    }

    await saveUserStats(context, stats);
    if (refreshCallback) {
        refreshCallback();
    }
    return { stats, newMilestones, levelUp };
}

export async function autoRecordToolUsage(command: string) {
    if (!globalContext) return;
    if (command === 'sayaib.hue-console.milestoneTracker') return;
    const stats = getUserStats(globalContext);
    
    if (!stats.dailyToolUsage) {
        stats.dailyToolUsage = {};
    }
    const usageCount = stats.dailyToolUsage[command] || 0;
    stats.dailyToolUsage[command] = usageCount + 1;
    await saveUserStats(globalContext, stats);

    let pts = 3;
    const cleanName = command.replace('sayaib.hue-console.', '');
    let category = 'Core';
    if (cleanName.includes('Snippet') || cleanName.includes('snippet')) {
        category = 'Snippets';
        pts = 10;
    } else if (cleanName.includes('Security') || cleanName.includes('Audit')) {
        category = 'Security';
        pts = 8;
    } else if (cleanName.includes('Ai') || cleanName.includes('Rag') || cleanName.includes('Prompt') || cleanName.includes('Model')) {
        category = 'AI';
        pts = 5;
    }

    if (usageCount >= 5) {
        pts = 1;
    }

    await recordActivity(globalContext, command, `Tool Use: ${cleanName}`, pts, category);
}

export function getCurrentLevel(totalPoints: number): LevelInfo {
    let current = LEVELS[0];
    for (const lvl of LEVELS) {
        if (totalPoints >= lvl.minPoints) {
            current = lvl;
        } else {
            break;
        }
    }
    return current;
}

function getCurrentLevelName(totalPoints: number): string {
    return getCurrentLevel(totalPoints).name;
}

export function getNextLevel(totalPoints: number): LevelInfo | null {
    for (let i = 0; i < LEVELS.length; i++) {
        if (totalPoints < LEVELS[i].minPoints) {
            return LEVELS[i];
        }
    }
    return null;
}

function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function registerMilestoneTrackerCommand(context: vscode.ExtensionContext) {
    setMilestoneContext(context);
    (async () => {
        const stats = getUserStats(context);
        const today = getTodayString();
        if (!stats.dailyClaims[today]) {
            stats.dailyClaims[today] = true;
            await recordActivity(context, 'daily_login', 'Daily Login Bonus', 5, 'Activity');
        }
    })();

    const command = vscode.commands.registerCommand('sayaib.hue-console.milestoneTracker', () => {
        const panel = vscode.window.createWebviewPanel(
            'milestoneTracker',
            'DevSnip Pro - Milestone & Points Tracker',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = getMilestoneTrackerHtml(context);

        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'claimBonus': {
                        const s = getUserStats(context);
                        const td = getTodayString();
                        if (!s.dailyClaims[td + '_bonus']) {
                            s.dailyClaims[td + '_bonus'] = true;
                            const res = await recordActivity(context, 'daily_bonus', 'Claimed Daily Activity Bonus', 10, 'Activity');
                            panel.webview.html = getMilestoneTrackerHtml(context);
                            vscode.window.showInformationMessage(`Successfully claimed +10 daily bonus points! Total: ${res.stats.totalPoints}`);
                        } else {
                            vscode.window.showWarningMessage('You have already claimed your daily bonus today.');
                        }
                        break;
                    }
                    case 'resetData': {
                        const fresh: UserStats = {
                            totalPoints: 0,
                            dailyPoints: 0,
                            lastActiveDate: getTodayString(),
                            streakDays: 1,
                            activities: [],
                            completedMilestones: [],
                            claimedRewards: [],
                            dailyClaims: {},
                            dailyToolUsage: {}
                        };
                        await saveUserStats(context, fresh);
                        panel.webview.html = getMilestoneTrackerHtml(context);
                        if (refreshCallback) {
                            refreshCallback();
                        }
                        vscode.window.showInformationMessage('Milestone and points data reset.');
                        break;
                    }
                }
            },
            undefined,
            context.subscriptions
        );
    });

    context.subscriptions.push(command);
}

function getMilestoneTrackerHtml(context: vscode.ExtensionContext): string {
    const stats = getUserStats(context);
    const currentLevel = getCurrentLevel(stats.totalPoints);
    const nextLevel = getNextLevel(stats.totalPoints);

    let progressPercent = 100;
    let pointsNeeded = 0;
    if (nextLevel) {
        const prevMin = currentLevel.minPoints;
        const nextMin = nextLevel.minPoints;
        const span = nextMin - prevMin;
        const currentProgress = stats.totalPoints - prevMin;
        progressPercent = Math.min(100, Math.max(0, Math.round((currentProgress / span) * 100)));
        pointsNeeded = nextMin - stats.totalPoints;
    }

    const today = getTodayString();
    const canClaimBonus = !stats.dailyClaims[today + '_bonus'];

    const milestonesHtml = MILESTONES.map(m => {
        const completed = stats.completedMilestones.includes(m.id);
        let currentCount = 0;
        if (completed) {
            currentCount = m.target;
        } else {
            if (m.id === 'tool_explorer' || m.id === 'power_user') {
                currentCount = stats.activities.filter(a => a.category === 'Core' || a.id.startsWith('sayaib.')).length;
            } else if (m.id === 'snippet_creator') {
                currentCount = stats.activities.filter(a => a.id.includes('snippet') || a.category === 'Snippets').length;
            } else if (m.id === 'streak_5' || m.id === 'streak_14') {
                currentCount = stats.streakDays;
            } else if (m.id === 'security_audit') {
                currentCount = stats.activities.filter(a => a.category === 'Security').length;
            } else if (m.id === 'ai_explorer') {
                currentCount = stats.activities.filter(a => a.category === 'AI').length;
            } else if (m.id === 'points_5000') {
                currentCount = stats.totalPoints;
            } else if (m.id === 'first_tool') {
                currentCount = stats.activities.length > 0 ? 1 : 0;
            }
        }
        const pct = Math.min(100, Math.round((currentCount / m.target) * 100));

        return `
            <div class="milestone-card ${completed ? 'completed' : ''}">
                <div class="milestone-icon">${m.icon}</div>
                <div class="milestone-info">
                    <div class="milestone-title">${m.title} ${completed ? '✓' : ''}</div>
                    <div class="milestone-desc">${m.description}</div>
                    <div class="progress-bar-container" style="margin-top: 8px;">
                        <div class="progress-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                    <div style="font-size: 11px; color: var(--fg-1); margin-top: 4px; display: flex; justify-content: space-between;">
                        <span>Progress: ${Math.min(currentCount, m.target)} / ${m.target}</span>
                        <span style="font-weight: 700; color: var(--accent);">+${m.points} pts</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const activitiesHtml = stats.activities.length === 0 ? 
        '<div style="text-align: center; color: var(--fg-1); padding: 20px;">No activities recorded yet. Start using DevSnip Pro tools to earn points!</div>' :
        stats.activities.map(a => {
            const dateStr = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
            return `
                <div class="activity-item">
                    <div>
                        <div class="activity-title">${a.title}</div>
                        <div class="activity-time">${dateStr} • <span style="color: var(--accent);">${a.category}</span></div>
                    </div>
                    <div class="activity-points">+${a.points} pts</div>
                </div>
            `;
        }).join('');

    const rewardsHtml = LEVELS.map(lvl => {
        const unlocked = stats.totalPoints >= lvl.minPoints;
        return `
            <div class="reward-card ${unlocked ? 'unlocked' : 'locked'}">
                <div style="font-size: 28px; margin-bottom: 8px;">${lvl.badge}</div>
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">${lvl.name} Level</div>
                <div style="font-size: 11px; color: var(--fg-1); margin-bottom: 4px;">${lvl.rank}</div>
                <div style="font-size: 11px; color: var(--fg-1); margin-bottom: 8px;">Requirement: ${lvl.minPoints} pts</div>
                <div style="font-size: 12px; font-weight: 600; color: ${unlocked ? 'var(--success)' : 'var(--fg-2)'};">
                    ${unlocked ? '✓ Unlocked: ' + lvl.reward : '🔒 Locked: ' + lvl.reward}
                </div>
            </div>
        `;
    }).join('');

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Milestone Tracker & Points System</title>
    <style>
        :root {
            --bg-0: var(--vscode-editor-background);
            --bg-1: var(--vscode-sideBar-background);
            --bg-2: var(--vscode-input-background);
            --bg-3: var(--vscode-textCodeBlock-background);
            --fg-0: var(--vscode-editor-foreground);
            --fg-1: var(--vscode-descriptionForeground);
            --fg-2: var(--vscode-disabledForeground);
            --border: var(--vscode-input-border);
            --border-focus: var(--vscode-focusBorder);
            --accent: var(--vscode-button-background);
            --accent-fg: var(--vscode-button-foreground);
            --success: #4caf50;
            --success-bg: rgba(76, 175, 80, 0.15);
            --warning: #ff9800;
            --radius-md: 8px;
            --radius-lg: 12px;
            --shadow: 0 4px 12px rgba(0,0,0,0.3);
            --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--sans); background: var(--bg-0); color: var(--fg-0); padding: 0; }
        .header {
            background: var(--bg-1);
            border-bottom: 1px solid var(--border);
            padding: 20px 24px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .header h1 { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
        .stats-banner {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;
            padding: 20px 24px; max-width: 1200px; margin: 0 auto;
        }
        .stat-card {
            background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 16px; display: flex; flex-direction: column; gap: 4px; box-shadow: var(--shadow);
        }
        .stat-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--fg-1); letter-spacing: 0.5px; }
        .stat-value { font-size: 22px; font-weight: 800; color: var(--accent); }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 0 24px 30px; }
        .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
        .tab {
            padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--fg-1);
            border-bottom: 2px solid transparent; transition: all 0.2s; text-align: left;
        }
        .tab.active { color: var(--fg-0); border-bottom-color: var(--accent); background: var(--bg-1); border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        .section-box { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 20px; }
        .section-title { font-size: 14px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; text-align: left; }

        .progress-bar-container { width: 100%; height: 10px; background: var(--bg-2); border-radius: 5px; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #4caf50); border-radius: 5px; transition: width 0.4s ease; }

        .milestones-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
        .milestone-card {
            background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 16px; display: flex; gap: 14px; align-items: flex-start; transition: transform 0.2s; text-align: left;
        }
        .milestone-card.completed { border-color: var(--success); background: var(--success-bg); }
        .milestone-icon { font-size: 28px; background: var(--bg-1); padding: 8px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; }
        .milestone-info { flex: 1; text-align: left; }
        .milestone-title { font-size: 13px; font-weight: 700; margin-bottom: 2px; text-align: left; }
        .milestone-desc { font-size: 11px; color: var(--fg-1); line-height: 1.4; text-align: left; }

        .activity-list { display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; }
        .activity-item {
            background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; text-align: left;
        }
        .activity-title { font-size: 13px; font-weight: 600; text-align: left; }
        .activity-time { font-size: 11px; color: var(--fg-1); text-align: left; }
        .activity-points { font-size: 14px; font-weight: 700; color: var(--success); text-align: left; }

        .rewards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
        .reward-card {
            background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md);
            padding: 20px; text-align: left; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;
        }
        .reward-card.unlocked { border-color: var(--success); background: var(--success-bg); }

        .btn {
            background: var(--accent); color: var(--accent-fg); border: none; padding: 8px 16px;
            font-size: 12px; font-weight: 600; border-radius: var(--radius-md); cursor: pointer; transition: opacity 0.2s;
            text-align: left; display: inline-flex; align-items: center; gap: 6px;
        }
        .btn:hover { opacity: 0.85; }
        .btn-secondary { background: var(--bg-2); color: var(--fg-0); border: 1px solid var(--border); text-align: left; }
    </style>
</head>
<body>
    <div class="header" style="text-align: left;">
        <h1 style="text-align: left;">🏆 DevSnip Pro Milestone & Points Tracker</h1>
        <button class="btn btn-secondary" id="resetDataBtn">Reset Data</button>
    </div>

    <div class="stats-banner">
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Current Level & Rank</span>
            <span class="stat-value" style="color: ${currentLevel.color}; font-size: 18px; text-align: left;">${currentLevel.badge} ${currentLevel.name}</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">${currentLevel.rank}</span>
        </div>
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Total Points</span>
            <span class="stat-value" style="text-align: left;">${stats.totalPoints} pts</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">Accumulated Score</span>
        </div>
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Next Level Target</span>
            <span class="stat-value" style="color: var(--warning); text-align: left;">${nextLevel ? pointsNeeded + ' pts' : 'Max Level'}</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">${nextLevel ? 'To reach ' + nextLevel.name : 'All Tiers Unlocked'}</span>
        </div>
        <div class="stat-card" style="text-align: left;">
            <span class="stat-label">Active Streak</span>
            <span class="stat-value" style="color: #ff9800; text-align: left;">🔥 ${stats.streakDays} Days</span>
            <span style="font-size: 11px; color: var(--fg-1); margin-top: 2px; text-align: left;">Daily Usage Tracking</span>
        </div>
    </div>

    <div class="container">
        <div class="section-box" style="text-align: left;">
            <div class="section-title">
                <span style="text-align: left;">Progress toward ${nextLevel ? nextLevel.name + ' (' + nextLevel.minPoints + ' pts)' : 'Maximum Tier'}</span>
                <span style="text-align: right;">${nextLevel ? pointsNeeded + ' pts required' : '100% Completed'}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div style="font-size: 11px; color: var(--fg-1); margin-top: 6px; display: flex; justify-content: space-between; text-align: left;">
                <span>${currentLevel.name} (${currentLevel.minPoints} pts)</span>
                <span>${progressPercent}% Complete</span>
                <span>${nextLevel ? nextLevel.name + ' (' + nextLevel.minPoints + ' pts)' : 'Grandmaster (25000+ pts)'}</span>
            </div>
        </div>

        <div class="tabs" style="text-align: left;">
            <div class="tab active" data-tab="overview">Overview & Quests</div>
            <div class="tab" data-tab="milestones">Milestones (${stats.completedMilestones.length}/${MILESTONES.length})</div>
            <div class="tab" data-tab="activities">Activity Feed</div>
            <div class="tab" data-tab="rewards">Tiers & Leaderboard Rank</div>
        </div>

        <div id="overview" class="tab-content active" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Daily Activity & Quests</span></div>
                <div style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
                    <div class="activity-item" style="text-align: left;">
                        <div style="text-align: left;">
                            <div class="activity-title" style="text-align: left;">Daily Login Bonus</div>
                            <div class="activity-time" style="text-align: left;">Awarded automatically upon opening DevSnip Pro today</div>
                        </div>
                        <div style="font-weight: 700; color: var(--success); text-align: right;">+5 pts Claimed ✓</div>
                    </div>
                    <div class="activity-item" style="text-align: left;">
                        <div style="text-align: left;">
                            <div class="activity-title" style="text-align: left;">Daily Activity Boost (+10 pts)</div>
                            <div class="activity-time" style="text-align: left;">Claim your daily productivity bonus for consistent usage</div>
                        </div>
                        <div style="text-align: right;">
                            ${canClaimBonus ? 
                                `<button class="btn" id="claimBonusBtn">Claim Bonus</button>` : 
                                `<span style="font-weight: 700; color: var(--success);">Claimed ✓</span>`
                            }
                        </div>
                    </div>
                </div>
            </div>
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Balanced Points & Progression System</span></div>
                <div style="font-size: 13px; color: var(--fg-1); display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; line-height: 1.5; text-align: left;">
                    <div style="text-align: left;">🚀 <b>Core Tools:</b> +3 pts per tool usage (Rate-limited after 5x/day)</div>
                    <div style="text-align: left;">📝 <b>Custom Snippets:</b> +10 pts per snippet created</div>
                    <div style="text-align: left;">🛡️ <b>Security Audits:</b> +8 pts per security check</div>
                    <div style="text-align: left;">🤖 <b>AI/ML & RAG Tools:</b> +5 pts per AI tool run</div>
                    <div style="text-align: left;">🔥 <b>Consistent Usage:</b> Requires regular daily activity for higher tiers</div>
                    <div style="text-align: left;">🏆 <b>Milestones:</b> +10 to +500 bonus points</div>
                </div>
            </div>
        </div>

        <div id="milestones" class="tab-content" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Milestones & Achievements</span></div>
                <div class="milestones-grid">
                    ${milestonesHtml}
                </div>
            </div>
        </div>

        <div id="activities" class="tab-content" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Recent Activity Log</span></div>
                <div class="activity-list">
                    ${activitiesHtml}
                </div>
            </div>
        </div>

        <div id="rewards" class="tab-content" style="text-align: left;">
            <div class="section-box" style="text-align: left;">
                <div class="section-title" style="text-align: left;"><span>Tiers, Leaderboard Ranking & Progression</span></div>
                <div class="rewards-grid">
                    ${rewardsHtml}
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        document.querySelectorAll('.tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
                document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
                e.currentTarget.classList.add('active');
                var tabId = e.currentTarget.getAttribute('data-tab');
                var content = document.getElementById(tabId);
                if (content) { content.classList.add('active'); }
            });
        });

        var claimBtn = document.getElementById('claimBonusBtn');
        if (claimBtn) {
            claimBtn.addEventListener('click', function() {
                vscode.postMessage({ command: 'claimBonus' });
            });
        }

        var resetBtn = document.getElementById('resetDataBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function() {
                if (confirm('Are you sure you want to reset all milestone progress and points?')) {
                    vscode.postMessage({ command: 'resetData' });
                }
            });
        }
    </script>
</body>
</html>`;
}
