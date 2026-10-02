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
        { id: 'levels', label: 'Ranks' },
        { id: 'activity', label: 'Activity' },
        { id: 'earn', label: 'How to earn' }
    ];
    var PAGE = 40;

    // Stroke icons (24x24). Drawn as SVG paths, so they follow the text colour of any theme.
    var ICON = {
        wallet: 'M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zM16 14h.01',
        flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z',
        bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
        gift: 'M4 12v8h16v-8M2 8h20v4H2zM12 8v12M12 8c-2-4-5-4-5.5-2.5S9 8 12 8zm0 0c2-4 5-4 5.5-2.5S15 8 12 8z',
        check: 'M5 12.5l4.5 4.5L19 7.5',
        search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
        arrow: 'M5 12h14M13 6l6 6-6 6',
        trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
        sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        tool: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.4-.4-2.6z',
        card: 'M3 6h18v12H3zM3 10h18M7 15h3',
        undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-2',
        dot: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
        snippet: 'M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14',
        shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
        sparkle: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
        star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
        info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
        inbox: 'M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 2h6l1-2h5'
    };
    // Category colours, all from theme tokens.
    var TINT = { Core: 'var(--info)', Snippets: 'var(--purple)', Activity: 'var(--streak)', Security: 'var(--success)', AI: 'var(--purple)', Milestone: 'var(--gold)', Discovery: 'var(--accent)' };
    var KIND = {
        tool: ['tool', 'var(--info)'], milestone: ['trophy', 'var(--gold)'], bonus: ['gift', 'var(--gold)'],
        spend: ['card', 'var(--purple)'], refund: ['undo', 'var(--success)'], other: ['dot', 'var(--fg-1)']
    };

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
                else if (key === 'vars') Object.keys(value).forEach(function (name) { node.style.setProperty(name, value[name]); });
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

    function icon(name) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ico');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', ICON[name] || ICON.dot);
        svg.appendChild(path);
        return svg;
    }

    /** A colour for text drawn in a category colour: blended with the text colour so it stays readable in light themes. */
    function tintVars(tint) {
        return { '--tint': tint, '--tint-text': 'color-mix(in srgb, ' + tint + ' 70%, var(--fg-0))' };
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

    /** True when `data` differs from what was last drawn for `key`. */
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

    function chip(text, kind, iconName) {
        return h('span', { className: 'chip ' + (kind || '') }, [iconName ? icon(iconName) : null, text]);
    }

    // ------------------------------------------------------------------
    // Skeleton (built once)
    // ------------------------------------------------------------------

    function build() {
        els.hero = h('section', { className: 'card hero', 'aria-label': 'Your rank and points' });
        els.daily = h('section', { className: 'daily', 'aria-label': 'Today' });
        els.tabs = h('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Progress sections' });
        els.panels = {};
        TABS.forEach(function (tab) {
            var button = h('button', {
                type: 'button', className: 'tab', role: 'tab', id: 'tab-' + tab.id,
                'aria-controls': 'panel-' + tab.id, onclick: function () { selectTab(tab.id, true); }
            }, [h('span', { text: tab.label }), h('span', { className: 'count', 'data-count': tab.id })]);
            els.tabs.appendChild(button);
            els.panels[tab.id] = h('section', { className: 'panel', role: 'tabpanel', id: 'panel-' + tab.id, 'aria-labelledby': 'tab-' + tab.id, tabindex: '-1' });
        });
        els.tabs.addEventListener('keydown', function (event) {
            var index = TABS.findIndex(function (t) { return t.id === ui.tab; });
            var next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
                : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            selectTab(TABS[(next + TABS.length) % TABS.length].id, true, true);
        });
        els.tabsRow = h('div', { className: 'tabs-row' }, [els.tabs]);
        replace(app, [els.hero, els.daily, h('div', {}, [els.tabsRow].concat(TABS.map(function (t) { return els.panels[t.id]; })))]);
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
    // Hero: rank, journey and the three numbers that matter
    // ------------------------------------------------------------------

    function spendCopy(spend) {
        if (!spend.total) return 'Ready to spend';
        if (spend.affordable >= spend.total) return 'Enough for any premium tool';
        if (!spend.affordable && spend.next) return fmt(spend.next.short) + ' more for ' + spend.next.name;
        return 'Covers ' + spend.affordable + ' of ' + spend.total + ' premium tools';
    }

    function renderHero(v) {
        if (!changed('hero', [v.level, v.nextLevel, v.levelPercent, v.pointsToNext, v.balance, v.lifetime, v.streak, v.today, v.spend, v.levels.length])) return;
        var R = 54;
        var C = 2 * Math.PI * R;
        var fill;
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 128 128');
        svg.setAttribute('aria-hidden', 'true');
        ['ring-track', 'ring-fill'].forEach(function (cls) {
            var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '64'); circle.setAttribute('cy', '64'); circle.setAttribute('r', String(R));
            circle.setAttribute('fill', 'none'); circle.setAttribute('stroke-width', '9');
            circle.setAttribute('class', cls);
            if (cls === 'ring-fill') {
                circle.setAttribute('stroke-dasharray', String(C));
                circle.setAttribute('stroke-dashoffset', String(C));
                fill = circle;
            }
            svg.appendChild(circle);
        });
        var ringPercent = v.nextLevel ? v.levelPercent : 100;
        requestAnimationFrame(function () { fill.setAttribute('stroke-dashoffset', String(C * (1 - ringPercent / 100))); });

        // The rank journey: one stop per rank, filled up to where you are now.
        var stops = v.levels.map(function (lv) {
            return h('span', { className: 'stop ' + lv.state, title: lv.badge + ' ' + lv.name + ' · ' + fmt(lv.minPoints) + ' pts' });
        });
        var journeyFill = h('span', { className: 'journey-fill' });
        var span = Math.max(1, v.levels.length - 1);
        var journeyPercent = Math.min(100, ((v.level.index + (v.nextLevel ? v.levelPercent / 100 : 0)) / span) * 100);
        requestAnimationFrame(function () { journeyFill.style.width = journeyPercent + '%'; });

        var rank = h('div', { className: 'rank' }, [
            h('div', {
                className: 'ring', role: 'img',
                'aria-label': v.level.name + ' rank, ' + (v.nextLevel ? v.levelPercent + '% of the way to ' + v.nextLevel.name : 'highest rank')
            }, [svg, h('div', { className: 'ring-center' }, [
                h('span', { className: 'ring-badge', text: v.level.badge }),
                h('span', { className: 'ring-pct', text: v.nextLevel ? v.levelPercent + '%' : 'MAX' })
            ])]),
            h('div', { className: 'rank-info' }, [
                h('div', { className: 'eyebrow', text: 'Rank ' + (v.level.index + 1) + ' of ' + v.levels.length + ' · ' + v.level.title }),
                h('div', { className: 'rank-name', text: v.level.name }),
                v.nextLevel
                    ? h('div', { className: 'rank-next' }, [h('strong', { text: fmt(v.pointsToNext) + ' pts' }), ' to ', h('strong', { text: v.nextLevel.badge + ' ' + v.nextLevel.name }), h('span', { className: 'muted', text: '  ·  ' + fmt(v.lifetime) + ' / ' + fmt(v.nextLevel.minPoints) })])
                    : h('div', { className: 'rank-next' }, [h('strong', { text: 'Highest rank reached' }), ' · every point still counts toward milestones']),
                h('div', { className: 'journey', role: 'img', 'aria-label': 'Rank ' + (v.level.index + 1) + ' of ' + v.levels.length }, [journeyFill].concat(stops)),
                // The journey spans every rank, so its labels name the two ends; each stop names itself on hover.
                h('div', { className: 'journey-labels', 'aria-hidden': 'true' }, [
                    h('span', { text: v.levels[0].name }),
                    h('span', { text: v.levels[v.levels.length - 1].name })
                ]),
                h('div', { className: 'rank-foot', text: fmt(v.lifetime) + ' points earned in total · spending never lowers your rank' })
            ])
        ]);

        var streakNext = v.streak.next
            ? (v.streak.next.remaining > 0 ? plural(v.streak.next.remaining, 'more day') + ' → ' + v.streak.next.title : v.streak.next.title + ' reached')
            : 'Every streak milestone done';
        var dots = h('span', { className: 'dots', 'aria-hidden': 'true' });
        var filled = Math.min(7, v.streak.days);
        for (var i = 0; i < 7; i++) {
            var on = i >= 7 - filled;
            dots.appendChild(h('i', { className: (on ? 'on' : '') + (i === 6 && on && v.today.loginClaimed ? ' today' : '') }));
        }

        var balanceValue = h('span', { className: 'num', id: 'balanceValue', text: fmt(ui.displayedBalance === null ? v.balance : ui.displayedBalance) });
        var kpis = h('div', { className: 'kpis' }, [
            h('div', { className: 'kpi', id: 'balanceStat' }, [
                h('span', { className: 'kpi-icon', vars: { '--tint': 'var(--gold)', '--tint-text': 'var(--gold-text)' } }, [icon('wallet')]),
                h('div', {}, [
                    h('div', { className: 'kpi-label', text: 'Balance' }),
                    h('div', { className: 'kpi-value' }, [balanceValue, h('small', { text: 'pts' })]),
                    h('div', { className: 'kpi-sub', text: spendCopy(v.spend) })
                ]),
                h('div', { className: 'kpi-side' }, [h('button', { type: 'button', className: 'link', onclick: function () { vscode.postMessage({ command: 'openSpend' }); } }, ['Spend', icon('arrow')])])
            ]),
            h('div', { className: 'kpi' }, [
                h('span', { className: 'kpi-icon', vars: { '--tint': 'var(--streak)', '--tint-text': 'var(--streak-text)' } }, [icon('flame')]),
                h('div', {}, [
                    h('div', { className: 'kpi-label', text: 'Streak' }),
                    h('div', { className: 'kpi-value' }, [h('span', { className: 'num', text: fmt(v.streak.days) }), h('small', { text: v.streak.days === 1 ? 'day' : 'days' })]),
                    h('div', { className: 'kpi-sub', text: streakNext })
                ]),
                h('div', { className: 'kpi-side', title: 'Last 7 days' }, [dots])
            ]),
            h('div', { className: 'kpi' }, [
                h('span', { className: 'kpi-icon', vars: { '--tint': 'var(--info)' } }, [icon('bolt')]),
                h('div', {}, [
                    h('div', { className: 'kpi-label', text: 'Earned today' }),
                    h('div', { className: 'kpi-value' }, [h('span', { className: 'num', text: fmt(v.today.earned) }), h('small', { text: '/ ' + fmt(v.today.cap) })]),
                    h('div', { className: 'kpi-sub', text: v.today.capReached ? 'Daily limit reached · milestones still pay' : fmt(v.today.cap - v.today.earned) + ' more available today' })
                ]),
                h('div', { className: 'kpi-side' }, [bar(v.today.percent, v.today.capReached ? 'success' : 'accent', 'Points earned today from tool use')])
            ])
        ]);
        els.hero.style.setProperty('--level-color', v.level.color);
        // Rank colours include near-white Platinum and Diamond: blend with the text colour so they read in every theme.
        els.hero.style.setProperty('--level-ink', 'color-mix(in srgb, ' + v.level.color + ' 72%, var(--fg-0))');
        replace(els.hero, [rank, kpis]);
    }

    // ------------------------------------------------------------------
    // Today: the one action on this page, and what to do next
    // ------------------------------------------------------------------

    function renderDaily(v) {
        if (!changed('daily', [v.today, v.focus])) return;
        var t = v.today;
        var checklist = h('div', { className: 'checklist' }, [
            h('span', { className: t.loginClaimed ? 'ok' : '' }, [icon(t.loginClaimed ? 'check' : 'sun'), t.loginClaimed ? 'Daily login +' + t.loginPoints : 'Daily login +' + t.loginPoints + ' on your first tool run']),
            h('span', { className: t.bonusClaimed ? 'ok' : '' }, [icon(t.bonusClaimed ? 'check' : 'gift'), 'Daily boost +' + t.bonusPoints])
        ]);
        var boost = t.bonusClaimed
            ? h('div', { className: 'card boost claimed' }, [
                h('span', { className: 'boost-icon' }, [icon('check')]),
                h('div', { className: 'boost-body' }, [
                    h('div', { className: 'boost-title', text: 'You are all set for today' }),
                    h('div', { className: 'boost-sub', text: 'Come back tomorrow for another +' + (t.loginPoints + t.bonusPoints) + ' pts. The boost resets at midnight.' }),
                    checklist
                ])
            ])
            : h('div', { className: 'card boost ready' }, [
                h('span', { className: 'boost-icon' }, [icon('gift')]),
                h('div', { className: 'boost-body' }, [
                    h('div', { className: 'boost-title', text: 'Your daily boost is ready' }),
                    h('div', { className: 'boost-sub', text: 'Claim +' + t.bonusPoints + ' pts for coming back today.' }),
                    checklist
                ]),
                h('button', {
                    type: 'button', className: 'xbtn gold', id: 'claimBtn',
                    onclick: function (event) {
                        var button = event.currentTarget;
                        button.disabled = true;
                        button.lastChild.textContent = 'Claiming…';
                        vscode.postMessage({ command: 'claimBonus' });
                    }
                }, [icon('gift'), h('span', { text: 'Claim +' + t.bonusPoints })])
            ]);

        var f = v.focus;
        var next = f
            ? h('div', { className: 'card next', vars: { '--tint': TINT[f.category] || 'var(--info)' } }, [
                h('span', { className: 'next-icon', text: f.icon, 'aria-hidden': 'true' }),
                h('div', { style: 'min-width:0' }, [
                    h('div', { className: 'next-title' }, [h('span', { text: 'Next up: ' + f.title }), chip('+' + fmt(f.points), 'pts')]),
                    h('div', { className: 'next-sub', text: f.remainingLabel + ' · ' + f.description }),
                    h('div', { className: 'next-row' }, [
                        bar(f.percent, '', f.title + ' progress'),
                        h('span', { className: 'num muted', style: 'font-size:12px', text: fmt(f.current) + ' / ' + fmt(f.target) }),
                        h('button', { type: 'button', className: 'xbtn sm', onclick: function () { vscode.postMessage({ command: 'openSearch' }); } }, [icon('search'), h('span', { text: 'Find a tool' })])
                    ])
                ])
            ])
            : h('div', { className: 'card next', vars: { '--tint': 'var(--success)' } }, [
                h('span', { className: 'next-icon', text: '🎉', 'aria-hidden': 'true' }),
                h('div', {}, [
                    h('div', { className: 'next-title', text: 'Every milestone complete' }),
                    h('div', { className: 'next-sub', style: 'margin-bottom:0', text: 'Keep your streak going to climb the ranks.' })
                ])
            ]);
        replace(els.daily, [boost, next]);
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

    // ------------------------------------------------------------------
    // Milestones: closest first
    // ------------------------------------------------------------------

    function milestoneCard(m, closest) {
        var tint = TINT[m.category] || 'var(--info)';
        var card = h('article', { className: 'card ms' + (m.completed ? ' completed' : '') + (closest ? ' closest' : ''), 'data-ms': m.id, vars: tintVars(m.completed ? 'var(--success)' : tint) }, [
            closest ? h('span', { className: 'tag' }, [chip('Closest', 'accent', 'star')]) : null,
            h('div', { className: 'ms-head' }, [
                h('div', { className: 'ms-icon' }, [
                    h('span', { text: m.icon, 'aria-hidden': 'true' }),
                    m.completed ? h('span', { className: 'ms-check' }, [icon('check')]) : null
                ]),
                h('div', { style: 'min-width:0' }, [h('div', { className: 'ms-cat', text: m.category }), h('div', { className: 'ms-title', text: m.title })]),
                m.completed ? chip('+' + fmt(m.points), 'ok', 'check') : chip('+' + fmt(m.points), 'pts')
            ]),
            h('div', { className: 'ms-desc', text: m.description }),
            bar(m.percent, m.completed ? 'success' : '', m.title + ' progress'),
            h('div', { className: 'ms-foot' }, [
                h('span', { className: 'num' }, [h('b', { text: fmt(m.current) }), ' / ' + fmt(m.target)]),
                h('span', { text: m.completed ? 'Completed' : m.remainingLabel })
            ])
        ]);
        return card;
    }

    function renderMilestones(v) {
        if (!changed('milestones', [v.milestones, v.focus && v.focus.id, ui.filter, v.milestoneSummary])) return;
        var s = v.milestoneSummary;
        var filters = [['all', 'All'], ['open', 'In progress'], ['done', 'Completed']];
        var head = h('div', { className: 'tabs-row', style: 'margin-top:12px' }, [
            h('div', { className: 'filters', role: 'group', 'aria-label': 'Filter milestones' }, filters.map(function (f) {
                return h('button', {
                    type: 'button', className: 'filter', text: f[1], 'aria-pressed': ui.filter === f[0] ? 'true' : 'false',
                    onclick: function () { ui.filter = f[0]; persist(); renderMilestones(ui.view); }
                });
            })),
            h('div', { className: 'summary', style: 'margin:0' }, [
                h('span', {}, [h('b', { text: s.completed + ' of ' + s.total }), ' complete']),
                h('span', {}, [h('b', { text: fmt(s.earned) }), ' pts earned']),
                h('span', {}, [h('b', { text: fmt(s.available) }), ' pts to collect'])
            ])
        ]);
        // In progress first, closest to done first; completed ones last.
        var list = v.milestones.filter(function (m) {
            return ui.filter === 'all' || (ui.filter === 'done' ? m.completed : !m.completed);
        }).slice().sort(function (a, b) {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return a.completed ? 0 : b.percent - a.percent;
        });
        var body = list.length
            ? h('div', { className: 'grid', style: 'margin-top:14px' }, list.map(function (m) { return milestoneCard(m, !m.completed && v.focus && v.focus.id === m.id); }))
            : h('div', { className: 'card empty' }, [icon(ui.filter === 'done' ? 'trophy' : 'sparkle'), ui.filter === 'done' ? 'No milestones completed yet. Your first one is a single tool run away.' : 'Every milestone is complete. Nicely done.']);
        replace(els.panels.milestones, [head, body]);
    }

    // ------------------------------------------------------------------
    // Ranks: a timeline
    // ------------------------------------------------------------------

    function renderLevels(v) {
        if (!changed('levels', [v.levels, v.levelPercent, v.lifetime])) return;
        var rows = v.levels.map(function (lv) {
            var row = h('div', { className: 'tl ' + lv.state, role: 'listitem', 'aria-current': lv.state === 'current' ? 'step' : null, vars: { '--lv-ink': 'color-mix(in srgb, ' + lv.color + ' 72%, var(--fg-0))' } }, [
                h('div', { className: 'tl-node', text: lv.badge, 'aria-hidden': 'true' }),
                h('div', { style: 'min-width:0' }, [
                    h('div', { className: 'tl-name' }, [
                        lv.name,
                        lv.state === 'current' ? chip('You are here', 'pts') : null,
                        lv.state === 'achieved' ? chip('Reached', 'ok', 'check') : null
                    ]),
                    h('div', { className: 'tl-sub', text: lv.title + ' · ' + lv.reward }),
                    lv.state === 'current' && v.nextLevel ? bar(v.levelPercent, '', 'Progress to ' + v.nextLevel.name) : null
                ]),
                h('div', { className: 'tl-req' }, [
                    fmt(lv.minPoints) + ' pts',
                    lv.state === 'locked' ? h('small', { text: fmt(lv.minPoints - v.lifetime) + ' to go' }) : null,
                    lv.state === 'current' && v.nextLevel ? h('small', { text: fmt(v.pointsToNext) + ' to ' + v.nextLevel.name }) : null
                ])
            ]);
            return row;
        });
        replace(els.panels.levels, [
            h('p', { className: 'note', style: 'margin-top:14px' }, [icon('info'), h('span', { text: 'Ranks follow the points you have earned in total, so spending never lowers them. They are recognition only: every tool is available at every rank.' })]),
            h('div', { className: 'card timeline', role: 'list' }, rows)
        ]);
    }

    // ------------------------------------------------------------------
    // Activity: grouped by day, with each day's total
    // ------------------------------------------------------------------

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
            replace(els.panels.activity, [h('div', { className: 'card empty', style: 'margin-top:14px' }, [
                icon('inbox'),
                'No activity yet. Run any DevSnip Pro tool to earn your first points.',
                h('div', { style: 'margin-top:14px' }, [h('button', { type: 'button', className: 'xbtn primary sm', onclick: function () { vscode.postMessage({ command: 'openSearch' }); } }, [icon('search'), h('span', { text: 'Find a tool' })])])
            ])]);
            return;
        }
        var shown = v.activities.slice(0, ui.shown);
        var totals = {};
        shown.forEach(function (a) { var d = dayLabel(a.timestamp); totals[d] = (totals[d] || 0) + a.points; });
        var nodes = [];
        var lastDay = null;
        shown.forEach(function (a) {
            var day = dayLabel(a.timestamp);
            if (day !== lastDay) {
                var total = totals[day];
                nodes.push(h('div', { className: 'day' }, [h('span', { text: day }), h('span', { className: 'num', text: (total > 0 ? '+' : '') + fmt(total) + ' pts' })]));
                lastDay = day;
            }
            var kind = KIND[a.kind] || KIND.other;
            var sign = a.points > 0 ? 'plus' : a.points < 0 ? 'minus' : 'zero';
            nodes.push(h('div', { className: 'act' }, [
                h('span', { className: 'act-icon', vars: tintVars(kind[1]) }, [icon(kind[0])]),
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
                type: 'button', className: 'xbtn sm',
                text: 'Show ' + Math.min(PAGE, v.activities.length - ui.shown) + ' more',
                onclick: function () { ui.shown += PAGE; renderActivity(ui.view); }
            })]));
        }
        replace(els.panels.activity, [h('div', { className: 'card feed', style: 'margin-top:14px' }, nodes)]);
    }

    // ------------------------------------------------------------------
    // How to earn
    // ------------------------------------------------------------------

    function renderEarn(v) {
        if (!changed('earn', [v.rules, v.today.loginPoints, v.today.bonusPoints, v.spend.cheapest])) return;
        var rules = [
            ['tool', 'var(--info)', 'Any tool run', '+3', 'Every DevSnip Pro command counts. After ' + v.rules.rateLimitAfter + ' runs of the same tool in a day, further runs give 1 point.'],
            ['snippet', 'var(--purple)', 'Create a snippet', '+10', 'Saving your own code snippet.'],
            ['shield', 'var(--success)', 'Security audit', '+8', 'Workspace, cloud, dependency or endpoint scans.'],
            ['sparkle', 'var(--purple)', 'AI, ML and RAG tools', '+5', 'Token counter, prompt tools, RAG calculators and more.'],
            ['sun', 'var(--streak)', 'Daily login', '+' + v.today.loginPoints, 'Added automatically once a day.'],
            ['gift', 'var(--gold)', 'Daily boost', '+' + v.today.bonusPoints, 'Claim it once a day from this page.'],
            ['trophy', 'var(--gold)', 'Milestones', '+10 to +500', 'One-time bonuses. They are never limited by the daily cap.']
        ];
        replace(els.panels.earn, [
            h('div', { className: 'rules', style: 'margin-top:14px' }, rules.map(function (r) {
                return h('div', { className: 'card rule' }, [
                    h('span', { className: 'rule-icon', vars: tintVars(r[1]) }, [icon(r[0])]),
                    h('div', {}, [h('div', { className: 'rule-title' }, [h('span', { text: r[2] }), chip(r[3], 'pts')]), h('div', { className: 'rule-text', text: r[4] })])
                ]);
            })),
            h('p', { className: 'note', style: 'margin-top:14px' }, [icon('info'), h('span', { text: 'Tool use can earn up to ' + v.rules.dailyCap + ' points a day, so ranks reflect steady use rather than repetition. ' +
                (v.spend.cheapest ? 'Points are spent on premium REST API Client tools, from ' + v.spend.cheapest + ' points per run, and only after a run succeeds.' : '') })])
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
            node.textContent = fmt(Math.round(from + (to - from) * eased));
            if (t < 1) requestAnimationFrame(step);
            else ui.displayedBalance = null;
        }
        requestAnimationFrame(step);
    }

    function feedback(previous, v) {
        if (!previous) return;
        if (v.level.index > previous.level.index) {
            celebrate(v.level.badge, 'Rank up! You are now ' + v.level.name + ' - ' + v.level.title);
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
    // Header menu
    // ------------------------------------------------------------------

    var moreBtn = document.getElementById('moreBtn');
    var moreMenu = document.getElementById('moreMenu');
    function menuItems() { return Array.prototype.slice.call(moreMenu.querySelectorAll('.menu-item')); }
    function openMenu() {
        moreMenu.hidden = false;
        moreBtn.setAttribute('aria-expanded', 'true');
        menuItems()[0].focus();
    }
    function closeMenu(restore) {
        if (moreMenu.hidden) return;
        moreMenu.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
        if (restore) moreBtn.focus();
    }
    moreBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (moreMenu.hidden) openMenu(); else closeMenu(false);
    });
    moreMenu.addEventListener('keydown', function (event) {
        var items = menuItems();
        var index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
        else if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
        else if (event.key === 'Tab') closeMenu(false);
    });
    document.addEventListener('click', function (event) { if (!moreMenu.contains(event.target)) closeMenu(false); });

    document.getElementById('howBtn').addEventListener('click', function () {
        closeMenu(false);
        if (!ui.built) return;
        selectTab('earn', true);
        els.tabsRow.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    document.getElementById('spendBtn').addEventListener('click', function () { vscode.postMessage({ command: 'openSpend' }); });
    document.getElementById('resetBtn').addEventListener('click', function (event) {
        closeMenu(false);
        event.currentTarget.disabled = true;
        vscode.postMessage({ command: 'resetData' });
    });

    // ------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------

    function render(v) {
        var previous = ui.view;
        ui.view = v;
        if (!ui.built) build();
        renderHero(v);
        renderDaily(v);
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
            h('button', { type: 'button', className: 'xbtn sm', text: 'Try again', onclick: function () { vscode.postMessage({ command: 'refresh' }); } })
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
                if (claim) { claim.disabled = false; claim.lastChild.textContent = 'Claim +' + (ui.view ? ui.view.today.bonusPoints : ''); }
            }
            if (message.message) toast(message.message, message.ok ? 'success' : 'info');
        } else if (message.type === 'error') {
            showError(message.message);
        }
    });

    vscode.postMessage({ command: 'ready' });
})();
