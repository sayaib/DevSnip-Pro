// Webview script for "Milestones & Points".
//
// The extension sends a complete, pre-computed view model ({ type: 'state' })
// whenever points change; this script only draws it. Each section is redrawn
// only when its own data changed, so a tool run in the background updates one
// number instead of rebuilding the page. Every value is written with
// textContent - never innerHTML.
(function () {
    'use strict';

    var vscode = acquireVsCodeApi();
    var saved = vscode.getState() || {};
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var TABS = [
        { id: 'milestones', label: 'Milestones' },
        { id: 'levels', label: 'Levels' },
        { id: 'activity', label: 'Activity' },
        { id: 'earn', label: 'How to earn' }
    ];
    var KIND_ICON = { tool: '🛠️', milestone: '🏆', bonus: '🎁', spend: '💳', refund: '↩️', other: '•' };
    var PAGE = 40;

    var ui = {
        tab: TABS.some(function (t) { return t.id === saved.tab; }) ? saved.tab : 'milestones',
        filter: saved.filter || 'all',
        shown: PAGE,
        view: null,
        keys: {},
        built: false,
        celebrations: [],
        celebrating: false,
        displayedBalance: null
    };

    var app = document.getElementById('app');
    var els = {};

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function h(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (key) {
                var value = attrs[key];
                if (value === undefined || value === null || value === false) return;
                if (key === 'text') node.textContent = String(value);
                else if (key === 'className') node.className = value;
                else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
                else node.setAttribute(key, value === true ? '' : String(value));
            });
        }
        (children || []).forEach(function (child) {
            if (child === null || child === undefined || child === false) return;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function fmt(n) { return Number(n || 0).toLocaleString(); }
    function plural(n, one, many) { return fmt(n) + ' ' + (n === 1 ? one : (many || one + 's')); }

    function bar(percent, variant, label) {
        var fill = h('span');
        var node = h('div', {
            className: 'bar ' + (variant || ''), role: 'progressbar',
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent), 'aria-label': label
        }, [fill]);
        // Set after insertion so the width transition animates from the old value.
        requestAnimationFrame(function () { fill.style.width = percent + '%'; });
        return node;
    }

    function replace(container, children) {
        container.textContent = '';
        children.forEach(function (child) { if (child) container.appendChild(child); });
    }

    /** Runs `draw` only when `data` differs from what was last drawn for `key`. */
    function changed(key, data) {
        var json = JSON.stringify(data);
        if (ui.keys[key] === json) return false;
        ui.keys[key] = json;
        return true;
    }

    function persist() {
        vscode.setState({ tab: ui.tab, filter: ui.filter });
    }

    function toast(message, kind) {
        var container = document.querySelector('.toast-container');
        if (!container) {
            container = h('div', { className: 'toast-container', role: 'status', 'aria-live': 'polite' });
            document.body.appendChild(container);
        }
        var node = h('div', { className: 'toast ' + (kind || 'success'), text: message });
        container.appendChild(node);
        requestAnimationFrame(function () { requestAnimationFrame(function () { node.classList.add('show'); }); });
        setTimeout(function () {
            node.classList.remove('show');
            setTimeout(function () { node.remove(); }, 400);
        }, 3000);
    }

    // ------------------------------------------------------------------
    // Skeleton (built once)
    // ------------------------------------------------------------------

    function build() {
        els.hero = h('section', { className: 'hero', 'aria-label': 'Level and points' });
        els.today = h('section', { className: 'card', 'aria-label': 'Today' });
        els.tabs = h('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Progress sections' });
        els.panels = {};
        TABS.forEach(function (tab) {
            var button = h('button', {
                type: 'button', className: 'tab', role: 'tab', id: 'tab-' + tab.id,
                'aria-controls': 'panel-' + tab.id, onclick: function () { selectTab(tab.id, true); }
            }, [h('span', { text: tab.label }), h('span', { className: 'count', 'data-count': tab.id })]);
            els.tabs.appendChild(button);
            els.panels[tab.id] = h('section', { className: 'panel', role: 'tabpanel', id: 'panel-' + tab.id, 'aria-labelledby': 'tab-' + tab.id, tabindex: '0' });
        });
        els.tabs.addEventListener('keydown', function (event) {
            var index = TABS.findIndex(function (t) { return t.id === ui.tab; });
            var next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
                : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            selectTab(TABS[(next + TABS.length) % TABS.length].id, true, true);
        });
        replace(app, [els.hero, els.today, h('div', {}, [els.tabs].concat(TABS.map(function (t) { return els.panels[t.id]; })))]);
        app.removeAttribute('aria-busy');
        ui.built = true;
        selectTab(ui.tab, false);
    }

    function selectTab(id, save, focus) {
        ui.tab = id;
        TABS.forEach(function (tab) {
            var button = document.getElementById('tab-' + tab.id);
            var active = tab.id === id;
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            button.tabIndex = active ? 0 : -1;
            els.panels[tab.id].hidden = !active;
            if (active && focus) button.focus();
        });
        if (save) persist();
    }

    // ------------------------------------------------------------------
    // Sections
    // ------------------------------------------------------------------

    function renderHero(v) {
        if (!changed('hero', [v.level, v.nextLevel, v.levelPercent, v.pointsToNext, v.balance, v.lifetime, v.streak, v.today.earned, v.today.cap, v.spend])) return;
        var R = 54;
        var C = 2 * Math.PI * R;
        var fill = h('circle');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 128 128');
        svg.setAttribute('aria-hidden', 'true');
        [['ring-track', 0], ['ring-fill', 1]].forEach(function (spec) {
            var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '64'); circle.setAttribute('cy', '64'); circle.setAttribute('r', String(R));
            circle.setAttribute('fill', 'none'); circle.setAttribute('stroke-width', '10');
            circle.setAttribute('class', spec[0]);
            if (spec[1]) {
                circle.setAttribute('stroke-dasharray', String(C));
                circle.setAttribute('stroke-dashoffset', String(C));
                fill = circle;
            }
            svg.appendChild(circle);
        });
        requestAnimationFrame(function () { fill.setAttribute('stroke-dashoffset', String(C * (1 - v.levelPercent / 100))); });

        var next = v.nextLevel
            ? h('div', { className: 'level-next' }, [
                h('strong', { text: plural(v.pointsToNext, 'point') }), ' to ',
                h('strong', { text: v.nextLevel.badge + ' ' + v.nextLevel.name }),
                h('div', { className: 'muted', text: fmt(v.lifetime) + ' of ' + fmt(v.nextLevel.minPoints) + ' points earned' })
            ])
            : h('div', { className: 'level-next' }, [h('strong', { text: 'Highest level reached.' }), h('div', { className: 'muted', text: fmt(v.lifetime) + ' points earned in total' })]);

        var levelCard = h('div', { className: 'card level-card' }, [
            h('div', {
                className: 'ring', role: 'img',
                'aria-label': v.level.name + ' level, ' + (v.nextLevel ? v.levelPercent + '% of the way to ' + v.nextLevel.name : 'highest level')
            }, [svg, h('div', { className: 'ring-center' }, [
                h('span', { className: 'ring-badge', text: v.level.badge }),
                h('span', { className: 'ring-pct', text: v.nextLevel ? v.levelPercent + '%' : 'MAX' })
            ])]),
            h('div', { className: 'level-info' }, [
                h('div', { className: 'level-kicker', text: 'Level ' + (v.level.index + 1) + ' of ' + v.levels.length }),
                h('div', { className: 'level-name', text: v.level.name }),
                h('div', { className: 'level-title', text: v.level.title }),
                next
            ])
        ]);
        levelCard.style.setProperty('--level-color', v.level.color);
        levelCard.style.setProperty('--level-glow', v.level.color);

        var balanceValue = h('span', { className: 'num', id: 'balanceValue', text: fmt(ui.displayedBalance === null ? v.balance : ui.displayedBalance) });
        var spendText = v.spend.total
            ? (v.spend.affordable + ' of ' + v.spend.total + ' premium tools affordable' + (v.spend.next && v.spend.affordable < v.spend.total ? ' · ' + v.spend.next.short + ' more for ' + v.spend.next.name : ''))
            : 'Available to spend';
        var streakText = v.streak.next
            ? (v.streak.next.remaining > 0 ? plural(v.streak.next.remaining, 'more day') + ' to ' + v.streak.next.title : v.streak.next.title + ' reached')
            : 'Every streak milestone completed';

        var stats = h('div', { className: 'stats' }, [
            h('div', { className: 'stat', id: 'balanceStat' }, [
                h('span', { className: 'stat-label', text: '💰 Balance' }),
                h('span', { className: 'stat-value' }, [balanceValue, ' ', h('small', { text: 'pts' })]),
                h('span', { className: 'stat-sub', text: spendText }),
                h('button', { type: 'button', className: 'link-btn', text: 'What can I spend on?', onclick: function () { vscode.postMessage({ command: 'openSpend' }); } })
            ]),
            h('div', { className: 'stat' }, [
                h('span', { className: 'stat-label', text: '⭐ Earned in total' }),
                h('span', { className: 'stat-value' }, [h('span', { className: 'num', text: fmt(v.lifetime) }), ' ', h('small', { text: 'pts' })]),
                h('span', { className: 'stat-sub', text: 'Sets your level. Spending never lowers it.' })
            ]),
            h('div', { className: 'stat' }, [
                h('span', { className: 'stat-label', text: '🔥 Streak' }),
                h('span', { className: 'stat-value' }, [h('span', { className: 'num', text: fmt(v.streak.days) }), ' ', h('small', { text: v.streak.days === 1 ? 'day' : 'days' })]),
                h('span', { className: 'stat-sub', text: streakText })
            ]),
            h('div', { className: 'stat' }, [
                h('span', { className: 'stat-label', text: '📅 Today' }),
                h('span', { className: 'stat-value' }, [h('span', { className: 'num', text: fmt(v.today.earned) }), ' ', h('small', { text: '/ ' + fmt(v.today.cap) + ' pts' })]),
                bar(v.today.percent, v.today.capReached ? 'success' : 'gold', 'Points earned today from tool use'),
                h('span', { className: 'stat-sub', text: v.today.capReached ? 'Daily limit reached. Milestone bonuses still count.' : fmt(v.today.cap - v.today.earned) + ' more can be earned today' })
            ])
        ]);
        replace(els.hero, [levelCard, stats]);
    }

    function renderToday(v) {
        if (!changed('today', [v.today, v.focus])) return;
        var login = h('div', { className: 'quest' + (v.today.loginClaimed ? ' done' : '') }, [
            h('span', { className: 'quest-icon', text: '👋', 'aria-hidden': 'true' }),
            h('div', { className: 'quest-body' }, [
                h('div', { className: 'quest-title', text: 'Daily login' }),
                h('div', { className: 'quest-sub', text: 'Added automatically the first time you use DevSnip Pro each day.' })
            ]),
            v.today.loginClaimed ? h('span', { className: 'pill ok', text: '✓ +' + v.today.loginPoints }) : h('span', { className: 'pill pts', text: '+' + v.today.loginPoints })
        ]);

        var claim = v.today.bonusClaimed
            ? h('span', { className: 'pill ok', text: '✓ +' + v.today.bonusPoints })
            : h('button', {
                type: 'button', className: 'btn btn-sm', id: 'claimBtn', text: 'Claim +' + v.today.bonusPoints,
                onclick: function (event) {
                    var button = event.currentTarget;
                    button.disabled = true;
                    button.textContent = 'Claiming...';
                    vscode.postMessage({ command: 'claimBonus' });
                }
            });
        var bonus = h('div', { className: 'quest' + (v.today.bonusClaimed ? ' done' : '') }, [
            h('span', { className: 'quest-icon', text: '🎁', 'aria-hidden': 'true' }),
            h('div', { className: 'quest-body' }, [
                h('div', { className: 'quest-title', text: 'Daily boost' }),
                h('div', { className: 'quest-sub', text: v.today.bonusClaimed ? 'Claimed today. It resets at midnight.' : 'Claim once a day for coming back.' })
            ]),
            claim
        ]);

        var focus = v.focus
            ? h('div', { className: 'quest' }, [
                h('span', { className: 'quest-icon', text: v.focus.icon, 'aria-hidden': 'true' }),
                h('div', { className: 'quest-body' }, [
                    h('div', { className: 'quest-title', text: 'Next up: ' + v.focus.title }),
                    h('div', { className: 'quest-sub', text: v.focus.remainingLabel + ' · ' + v.focus.current + '/' + v.focus.target }),
                    bar(v.focus.percent, 'thin gold', v.focus.title + ' progress')
                ]),
                h('span', { className: 'pill pts', text: '+' + v.focus.points })
            ])
            : h('div', { className: 'quest done' }, [
                h('span', { className: 'quest-icon', text: '🎉', 'aria-hidden': 'true' }),
                h('div', { className: 'quest-body' }, [h('div', { className: 'quest-title', text: 'Every milestone complete' }), h('div', { className: 'quest-sub', text: 'Keep your streak going to climb the levels.' })])
            ]);

        replace(els.today, [h('div', { className: 'card-title' }, [h('span', { text: 'Today' })]), h('div', { className: 'today' }, [login, bonus, focus])]);
    }

    function renderCounts(v) {
        var counts = {
            milestones: v.milestoneSummary.completed + '/' + v.milestoneSummary.total,
            levels: (v.level.index + 1) + '/' + v.levels.length,
            activity: v.activities.length ? String(v.activities.length) : '',
            earn: ''
        };
        Object.keys(counts).forEach(function (id) {
            var node = els.tabs.querySelector('[data-count="' + id + '"]');
            node.textContent = counts[id];
            node.hidden = !counts[id];
        });
    }

    function renderMilestones(v) {
        if (!changed('milestones', [v.milestones, v.focus && v.focus.id, ui.filter])) return;
        var s = v.milestoneSummary;
        var filters = [['all', 'All'], ['open', 'In progress'], ['done', 'Completed']];
        var toolbar = h('div', { className: 'toolbar', role: 'group', 'aria-label': 'Filter milestones' }, filters.map(function (f) {
            return h('button', {
                type: 'button', className: 'chip-btn', text: f[1], 'aria-pressed': ui.filter === f[0] ? 'true' : 'false',
                onclick: function () { ui.filter = f[0]; persist(); renderMilestones(ui.view); }
            });
        }).concat([h('span', { className: 'muted', style: 'font-size:12px;margin-left:auto', text: fmt(s.earned) + ' pts earned · ' + fmt(s.available) + ' pts still available' })]));

        var list = v.milestones.filter(function (m) {
            return ui.filter === 'all' || (ui.filter === 'done' ? m.completed : !m.completed);
        });
        var grid = list.length
            ? h('div', { className: 'grid' }, list.map(function (m) {
                return h('article', { className: 'ms' + (m.completed ? ' completed' : '') + (v.focus && v.focus.id === m.id ? ' focus' : ''), 'data-ms': m.id }, [
                    h('div', { className: 'ms-icon', text: m.icon, 'aria-hidden': 'true' }),
                    h('div', { className: 'ms-body' }, [
                        h('div', { className: 'ms-head' }, [
                            h('div', {}, [h('div', { className: 'tag', text: m.category }), h('div', { className: 'ms-title', text: m.title })]),
                            h('span', { className: 'pill ' + (m.completed ? 'ok' : 'pts'), text: (m.completed ? '✓ ' : '') + '+' + m.points })
                        ]),
                        h('div', { className: 'ms-desc', text: m.description }),
                        bar(m.percent, m.completed ? 'success' : 'gold', m.title + ' progress'),
                        h('div', { className: 'ms-foot' }, [
                            h('span', { className: 'num', text: fmt(m.current) + ' / ' + fmt(m.target) }),
                            h('span', { text: m.completed ? 'Completed' : m.remainingLabel })
                        ])
                    ])
                ]);
            }))
            : h('div', { className: 'empty', text: ui.filter === 'done' ? 'No milestones completed yet. Your first one is a single tool run away.' : 'Every milestone is complete.' });
        replace(els.panels.milestones, [toolbar, grid]);
    }

    function renderLevels(v) {
        if (!changed('levels', [v.levels, v.levelPercent, v.lifetime])) return;
        var rows = v.levels.map(function (lv) {
            var row = h('div', { className: 'lv ' + lv.state, 'aria-current': lv.state === 'current' ? 'step' : null }, [
                h('div', { className: 'lv-badge', text: lv.badge, 'aria-hidden': 'true' }),
                h('div', {}, [
                    h('div', { className: 'lv-name' }, [
                        lv.name,
                        lv.state === 'current' ? h('span', { className: 'pill pts', text: 'Current' }) : null,
                        lv.state === 'achieved' ? h('span', { className: 'pill ok', text: '✓ Reached' }) : null
                    ]),
                    h('div', { className: 'lv-sub', text: lv.title + ' · ' + lv.reward }),
                    lv.state === 'current' && v.nextLevel ? bar(v.levelPercent, 'gold', 'Progress to ' + v.nextLevel.name) : null
                ]),
                h('div', { className: 'lv-req' }, [
                    h('div', { className: 'num', text: fmt(lv.minPoints) + ' pts' }),
                    lv.state === 'locked' ? h('div', { className: 'muted', style: 'font-weight:500', text: fmt(lv.minPoints - v.lifetime) + ' to go' }) : null
                ])
            ]);
            row.style.setProperty('--lv-color', lv.color);
            return row;
        });
        replace(els.panels.levels, [
            h('p', { className: 'note', style: 'margin:0 0 12px', text: 'Levels are based on the points you have earned in total, so spending points never lowers your level. They are recognition only: every tool is available at every level.' }),
            h('div', { className: 'card', style: 'padding:6px 14px' }, [h('div', { className: 'levels', role: 'list' }, rows.map(function (row) { row.setAttribute('role', 'listitem'); return row; }))])
        ]);
    }

    function dayLabel(timestamp) {
        var date = new Date(timestamp);
        var start = new Date(); start.setHours(0, 0, 0, 0);
        var diff = Math.round((start.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);
        if (diff <= 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }

    function renderActivity(v) {
        if (!changed('activity', [v.activities, ui.shown])) return;
        if (!v.activities.length) {
            replace(els.panels.activity, [h('div', { className: 'empty' }, [
                'No activity yet. Run any DevSnip Pro tool to earn your first points.',
                h('div', { style: 'margin-top:12px' }, [h('button', { type: 'button', className: 'btn btn-sm', text: 'Find a tool', onclick: function () { vscode.postMessage({ command: 'openSearch' }); } })])
            ])]);
            return;
        }
        var nodes = [];
        var lastDay = null;
        v.activities.slice(0, ui.shown).forEach(function (a) {
            var day = dayLabel(a.timestamp);
            if (day !== lastDay) { nodes.push(h('div', { className: 'day', text: day })); lastDay = day; }
            var sign = a.points > 0 ? 'plus' : a.points < 0 ? 'minus' : 'zero';
            nodes.push(h('div', { className: 'act' }, [
                h('span', { className: 'act-icon', text: KIND_ICON[a.kind] || '•', 'aria-hidden': 'true' }),
                h('div', { style: 'min-width:0' }, [
                    h('div', { className: 'act-title', text: a.title, title: a.title }),
                    h('div', { className: 'act-meta', text: new Date(a.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + ' · ' + a.category })
                ]),
                h('span', {
                    className: 'act-pts ' + sign,
                    text: (a.points > 0 ? '+' : '') + fmt(a.points),
                    title: a.points === 0 ? 'No points: the daily limit was reached' : null
                })
            ]));
        });
        if (v.activities.length > ui.shown) {
            nodes.push(h('div', { className: 'more' }, [h('button', {
                type: 'button', className: 'btn btn-secondary btn-sm',
                text: 'Show ' + Math.min(PAGE, v.activities.length - ui.shown) + ' more',
                onclick: function () { ui.shown += PAGE; renderActivity(ui.view); }
            })]));
        }
        replace(els.panels.activity, [h('div', { className: 'card', style: 'padding:10px 16px 14px' }, nodes)]);
    }

    function renderEarn(v) {
        if (!changed('earn', [v.rules, v.today.loginPoints, v.today.bonusPoints, v.spend.cheapest])) return;
        var rules = [
            ['🛠️', 'Any tool run', '+3', 'Every DevSnip Pro command counts. After ' + v.rules.rateLimitAfter + ' runs of the same tool in a day, further runs give 1 point.'],
            ['📝', 'Create a snippet', '+10', 'Saving your own code snippet.'],
            ['🛡️', 'Security audit', '+8', 'Workspace, cloud, dependency or endpoint scans.'],
            ['🤖', 'AI, ML and RAG tools', '+5', 'Token counter, prompt tools, RAG calculators and more.'],
            ['👋', 'Daily login', '+' + v.today.loginPoints, 'Added automatically once a day.'],
            ['🎁', 'Daily boost', '+' + v.today.bonusPoints, 'Claim it once a day from this page.'],
            ['🏆', 'Milestones', '+10 to +500', 'One-time bonuses. They are never limited by the daily cap.']
        ];
        replace(els.panels.earn, [
            h('div', { className: 'rules' }, rules.map(function (r) {
                return h('div', { className: 'rule' }, [
                    h('span', { className: 'rule-icon', text: r[0], 'aria-hidden': 'true' }),
                    h('div', {}, [h('div', { className: 'rule-title' }, [h('span', { text: r[1] }), h('span', { className: 'pill pts', text: r[2] })]), h('div', { className: 'rule-text', text: r[3] })])
                ]);
            })),
            h('p', { className: 'note', text: 'Tool use can earn up to ' + v.rules.dailyCap + ' points a day, so levels reflect steady use rather than repetition. ' +
                (v.spend.cheapest ? 'Points are spent on premium REST API Client tools, from ' + v.spend.cheapest + ' points per run, and only after a run succeeds.' : '') })
        ]);
    }

    // ------------------------------------------------------------------
    // Feedback
    // ------------------------------------------------------------------

    function celebrate(badge, text) {
        ui.celebrations.push([badge, text]);
        if (!ui.celebrating) nextCelebration();
    }

    function nextCelebration() {
        var item = ui.celebrations.shift();
        var box = document.getElementById('celebrate');
        if (!item) { ui.celebrating = false; return; }
        ui.celebrating = true;
        document.getElementById('celebrateBadge').textContent = item[0];
        document.getElementById('celebrateText').textContent = item[1];
        box.classList.add('show');
        setTimeout(function () {
            box.classList.remove('show');
            setTimeout(nextCelebration, 500);
        }, 3200);
    }

    function animateBalance(from, to) {
        var node = document.getElementById('balanceValue');
        var stat = document.getElementById('balanceStat');
        ui.displayedBalance = null;
        if (!node) return;
        if (stat && to > from) {
            stat.classList.remove('bump');
            void stat.offsetWidth;
            stat.classList.add('bump');
        }
        if (reduceMotion || Math.abs(to - from) < 2) { node.textContent = fmt(to); return; }
        var start = performance.now();
        var duration = 650;
        ui.displayedBalance = from;
        function step(now) {
            var t = Math.min(1, (now - start) / duration);
            var eased = 1 - Math.pow(1 - t, 3);
            var value = Math.round(from + (to - from) * eased);
            node.textContent = fmt(value);
            if (t < 1) requestAnimationFrame(step);
            else ui.displayedBalance = null;
        }
        requestAnimationFrame(step);
    }

    function feedback(previous, v) {
        if (!previous) return;
        if (v.level.index > previous.level.index) {
            celebrate(v.level.badge, 'Level up! You are now ' + v.level.name + ' - ' + v.level.title);
        }
        var before = {};
        previous.milestones.forEach(function (m) { before[m.id] = m.completed; });
        v.milestones.forEach(function (m) {
            if (m.completed && before[m.id] === false) {
                celebrate(m.icon, 'Milestone unlocked: ' + m.title + ' (+' + m.points + ' pts)');
                var card = document.querySelector('[data-ms="' + m.id + '"]');
                if (card) card.classList.add('pulse');
            }
        });
        if (v.balance !== previous.balance) animateBalance(previous.balance, v.balance);
    }

    // ------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------

    function render(v) {
        var previous = ui.view;
        ui.view = v;
        if (!ui.built) build();
        renderHero(v);
        renderToday(v);
        renderCounts(v);
        renderMilestones(v);
        renderLevels(v);
        renderActivity(v);
        renderEarn(v);
        feedback(previous, v);
    }

    function showError(message) {
        var box = h('div', { className: 'error-box', role: 'alert' }, [
            h('span', { text: message }),
            h('button', { type: 'button', className: 'btn btn-secondary btn-sm', text: 'Try again', onclick: function () { vscode.postMessage({ command: 'refresh' }); } })
        ]);
        if (!ui.built) { replace(app, [box]); app.removeAttribute('aria-busy'); }
        else app.insertBefore(box, app.firstChild);
    }

    window.addEventListener('message', function (event) {
        var message = event.data || {};
        if (message.type === 'state' && message.view) {
            render(message.view);
        } else if (message.type === 'result') {
            if (message.action === 'resetData') {
                document.getElementById('resetBtn').disabled = false;
                if (message.ok) ui.shown = PAGE;
            }
            if (message.action === 'claimBonus' && !message.ok) {
                // The state update already redrew the button if it was claimed elsewhere.
                var claim = document.getElementById('claimBtn');
                if (claim) { claim.disabled = false; claim.textContent = 'Claim +' + (ui.view ? ui.view.today.bonusPoints : ''); }
            }
            if (message.message) toast(message.message, message.ok ? 'success' : 'info');
        } else if (message.type === 'error') {
            showError(message.message);
        }
    });

    document.getElementById('spendBtn').addEventListener('click', function () { vscode.postMessage({ command: 'openSpend' }); });
    document.getElementById('resetBtn').addEventListener('click', function (event) {
        event.currentTarget.disabled = true;
        vscode.postMessage({ command: 'resetData' });
    });

    vscode.postMessage({ command: 'ready' });
})();
