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
        inbox: 'M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 2h6l1-2h5',
        target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
        snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2',
        lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
        eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
        palette: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.7-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
        smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
        tag: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
        ring: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9h.01',
        play: 'M7 4.5v15l12-7.5z',
        refresh: 'M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4',
        x: 'M6 6l12 12M18 6 6 18'
    };
    // Category colours, all from theme tokens.
    var TINT = { Core: 'var(--info)', Snippets: 'var(--purple)', Activity: 'var(--streak)', Security: 'var(--success)', AI: 'var(--purple)', Milestone: 'var(--gold)', Discovery: 'var(--accent)', Quests: 'var(--accent)', Learning: 'var(--info)', Events: 'var(--streak)' };
    var KIND = {
        tool: ['tool', 'var(--info)'], milestone: ['trophy', 'var(--gold)'], bonus: ['gift', 'var(--gold)'],
        quest: ['target', 'var(--accent)'], freeze: ['snow', 'var(--info)'],
        spend: ['card', 'var(--purple)'], refund: ['undo', 'var(--success)'], play: ['sparkle', 'var(--streak)'], other: ['dot', 'var(--fg-1)']
    };

    var ui = {
        tab: TABS.some(function (t) { return t.id === saved.tab; }) ? saved.tab : 'milestones',
        filter: saved.filter || 'all',
        shopKind: saved.shopKind || 'all',
        shopShow: saved.shopShow || 'all',
        redeemOpen: saved.redeemOpen === true,
        redeemView: saved.redeemView || 'play',
        spinning: false,
        wheelAngle: null,
        sprint: null,
        sprintTimer: null,
        redeemReturn: null,
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
        vscode.setState({ tab: ui.tab, filter: ui.filter, shopKind: ui.shopKind, shopShow: ui.shopShow, redeemOpen: ui.redeemOpen, redeemView: ui.redeemView });
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
        els.quests = h('section', { className: 'card quests', 'aria-label': "Today's quests and this week" });
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
        // Redeem: the points shop opens as a sheet over the page, from the button on the rank card.
        els.redeemBalance = h('span', { className: 'num' });
        els.redeemBody = h('div', { className: 'redeem-body' });
        els.redeem = h('div', { className: 'redeem', id: 'redeem', hidden: true, onclick: function (event) { if (event.target === els.redeem) closeRedeem(); } }, [
            h('section', { className: 'redeem-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'redeemTitle' }, [
                h('header', { className: 'redeem-head' }, [
                    h('span', { className: 'redeem-icon', 'aria-hidden': 'true' }, [icon('gift')]),
                    h('div', { className: 'redeem-heading' }, [
                        h('h2', { id: 'redeemTitle', text: 'Redeem points' }),
                        h('p', { text: 'Avatars, titles, frames, banners, effects, themes and power-ups.' })
                    ]),
                    h('span', { className: 'chip pts redeem-balance' }, [icon('wallet'), els.redeemBalance, ' pts']),
                    h('button', { type: 'button', className: 'xbtn icon', id: 'redeemClose', 'aria-label': 'Close', title: 'Close (Esc)', onclick: function () { closeRedeem(); } }, [icon('x')])
                ]),
                els.redeemBody
            ])
        ]);
        els.redeem.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); closeRedeem(); return; }
            if (event.key !== 'Tab') return;
            // Keep keyboard focus inside the sheet while it is open.
            var focusable = Array.prototype.slice.call(els.redeem.querySelectorAll('button:not([disabled])'));
            if (!focusable.length) return;
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        document.body.appendChild(els.redeem);
        replace(app, [els.hero, els.quests, els.daily, h('div', {}, [els.tabsRow].concat(TABS.map(function (t) { return els.panels[t.id]; })))]);
        app.removeAttribute('aria-busy');
        ui.built = true;
        selectTab(ui.tab, false);
        if (ui.redeemOpen) openRedeem(false);
    }

    function openRedeem(focus) {
        if (!els.redeem) return;
        if (els.redeem.hidden && focus !== false) ui.redeemReturn = document.activeElement;
        els.redeem.hidden = false;
        document.body.classList.add('redeem-open');
        ui.redeemOpen = true;
        persist();
        if (focus !== false) document.getElementById('redeemClose').focus();
    }

    function closeRedeem() {
        if (!els.redeem || els.redeem.hidden) return;
        els.redeem.hidden = true;
        document.body.classList.remove('redeem-open');
        ui.redeemOpen = false;
        persist();
        var back = ui.redeemReturn && ui.redeemReturn !== document.body && document.contains(ui.redeemReturn) ? ui.redeemReturn : document.getElementById('redeemBtn');
        ui.redeemReturn = null;
        if (back) back.focus();
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
        if (!changed('hero', [v.level, v.nextLevel, v.levelPercent, v.pointsToNext, v.balance, v.lifetime, v.streak, v.today, v.spend, v.levels.length, v.profile, v.shop && v.shop.collected, v.play && v.play.waiting])) return;
        var profile = v.profile || {};
        var avatar = profile.avatar && profile.avatar.value;
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
                medal('ring-medal', avatar || v.level.badge, profile.frame && profile.frame.value, avatar ? v.level.badge : null),
                h('span', { className: 'ring-pct', text: v.nextLevel ? v.levelPercent + '%' : 'MAX' })
            ])]),
            h('div', { className: 'rank-info' }, [
                h('div', { className: 'eyebrow', text: 'Rank ' + (v.level.index + 1) + ' of ' + v.levels.length + ' · ' + v.level.title }),
                h('div', { className: 'rank-name', text: v.level.name }),
                profile.title ? h('div', { className: 'rank-title-line' }, [h('span', { 'aria-hidden': 'true', text: profile.title.icon }), h('span', { text: profile.title.name })]) : null,
                v.nextLevel
                    ? h('div', { className: 'rank-next' }, [h('strong', { text: fmt(v.pointsToNext) + ' pts' }), ' to ', h('strong', { text: v.nextLevel.badge + ' ' + v.nextLevel.name }), h('span', { className: 'muted', text: '  ·  ' + fmt(v.lifetime) + ' / ' + fmt(v.nextLevel.minPoints) })])
                    : h('div', { className: 'rank-next' }, [h('strong', { text: 'Highest rank reached' }), ' · every point still counts toward milestones']),
                h('div', { className: 'journey', role: 'img', 'aria-label': 'Rank ' + (v.level.index + 1) + ' of ' + v.levels.length }, [journeyFill].concat(stops)),
                // The journey spans every rank, so its labels name the two ends; each stop names itself on hover.
                h('div', { className: 'journey-labels', 'aria-hidden': 'true' }, [
                    h('span', { text: v.levels[0].name }),
                    h('span', { text: v.levels[v.levels.length - 1].name })
                ]),
                h('div', { className: 'rank-foot', text: fmt(v.lifetime) + ' points earned in total · spending never lowers your rank' }),
                h('div', { className: 'rank-redeem' }, [
                    h('button', {
                        type: 'button', className: 'xbtn gold', id: 'redeemBtn', 'aria-haspopup': 'dialog',
                        title: 'Spend your points on avatars, titles, frames, banners, effects, themes and power-ups',
                        onclick: function () { openRedeem(); }
                    }, [icon('gift'), h('span', { text: 'Redeem' }), v.play && v.play.waiting ? h('span', { className: 'redeem-badge', title: v.play.waiting + ' daily activities waiting', text: String(v.play.waiting) }) : null]),
                    h('span', { className: 'rank-redeem-sub' }, [
                        h('strong', { className: 'num', text: fmt(v.balance) + ' pts' }),
                        ' to spend' + (v.play && v.play.waiting ? ' · ' + plural(v.play.waiting, 'daily activity', 'daily activities') + ' waiting' : v.shop && v.shop.collectible ? ' · ' + fmt(v.shop.collected) + ' of ' + fmt(v.shop.collectible) + ' profile items collected' : '')
                    ])
                ])
            ])
        ]);

        var streakNext = v.streak.next
            ? (v.streak.next.remaining > 0 ? plural(v.streak.next.remaining, 'more day') + ' → ' + v.streak.next.title : v.streak.next.title + ' reached')
            : 'Every streak milestone done';
        var st = v.streak;
        var freezes = h('span', { className: 'freezes', title: plural(st.freezes, 'streak freeze') + ' ready. Each one covers a missed day.' });
        for (var f = 0; f < st.maxFreezes; f++) freezes.appendChild(h('i', { className: f < st.freezes ? 'on' : '' }, [icon('snow')]));
        if (st.maxFreezes && st.freezes < st.maxFreezes) {
            freezes.appendChild(h('button', {
                type: 'button', className: 'link', 'data-buy': 'freeze', disabled: !st.canBuyFreeze,
                title: st.canBuyFreeze ? 'Buy a streak freeze for ' + st.freezeCost + ' pts' : 'A streak freeze costs ' + st.freezeCost + ' pts',
                onclick: function (event) { event.currentTarget.disabled = true; vscode.postMessage({ command: 'buyFreeze' }); }
            }, ['Buy · ' + st.freezeCost + ' pts']));
        }
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
                    h('div', { className: 'kpi-sub', text: streakNext + (st.best > st.days ? ' · best ' + fmt(st.best) : '') })
                ]),
                h('div', { className: 'kpi-side' }, [h('span', { title: 'Last 7 days' }, [dots]), st.maxFreezes ? freezes : null])
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
        els.hero.className = 'card hero' + (profile.banner && profile.banner.value ? ' banner-' + profile.banner.value : '');
        els.hero.style.setProperty('--level-color', v.level.color);
        // Rank colours include near-white Platinum and Diamond: blend with the text colour so they read in every theme.
        els.hero.style.setProperty('--level-ink', 'color-mix(in srgb, ' + v.level.color + ' 72%, var(--fg-0))');
        replace(els.hero, [rank, kpis]);
    }

    // ------------------------------------------------------------------
    // Quests: three goals a day, and this week at a glance
    // ------------------------------------------------------------------

    function hoursToMidnight() {
        var now = new Date();
        var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 3600000));
    }

    function weekStat(label, value, sub) {
        return h('div', { className: 'week-stat' }, [
            h('div', { className: 'week-value num', text: fmt(value) }),
            h('div', { className: 'week-label', text: label }),
            sub ? h('div', { className: 'week-sub', text: sub }) : null
        ]);
    }

    function renderQuests(v) {
        var q = v.quests;
        if (!changed('quests', [q, v.week, v.shop && v.shop.reroll, new Date().getHours()])) return;
        if (!q || !q.total) { els.quests.hidden = true; return; }
        els.quests.hidden = false;
        var allDone = q.done >= q.total;
        var head = h('div', { className: 'q-head' }, [
            h('div', { style: 'min-width:0' }, [
                h('div', { className: 'eyebrow', text: "Today's quests" }),
                h('div', { className: 'q-title', text: allDone ? 'All done. New quests tomorrow.' : q.done + ' of ' + q.total + ' done' })
            ]),
            h('div', { className: 'q-head-side' }, [
                h('span', { className: 'chip', title: 'New quests every day at midnight', text: 'New in ' + hoursToMidnight() + 'h' }),
                allDone ? null : h('button', { type: 'button', className: 'xbtn sm', onclick: function () { vscode.postMessage({ command: 'openSearch' }); } }, [icon('search'), h('span', { text: 'Find a tool' })])
            ])
        ]);
        var list = h('div', { className: 'q-list' }, q.items.map(function (item) {
            return h('div', { className: 'quest' + (item.done ? ' done' : ''), 'data-quest': item.id }, [
                h('span', { className: 'q-icon', 'aria-hidden': 'true' }, [item.done ? icon('check') : item.icon]),
                h('div', { className: 'q-body' }, [
                    h('div', { className: 'q-name', text: item.title }),
                    h('div', { className: 'q-hint', text: item.hint })
                ]),
                h('div', { className: 'q-progress' }, [
                    bar(item.percent, item.done ? 'success' : 'accent', item.title + ' progress'),
                    h('span', { className: 'num muted', text: item.done ? 'Done' : fmt(item.progress) + ' / ' + fmt(item.target) })
                ]),
                h('span', { className: 'q-side' }, [
                    item.done ? chip('+' + fmt(item.points), 'ok', 'check') : chip('+' + fmt(item.points), 'pts'),
                    item.done || !v.shop || !v.shop.reroll.max ? null : h('button', {
                        type: 'button', className: 'xbtn icon sm q-swap', disabled: !item.canReroll,
                        'aria-label': 'Swap ' + item.title + ' for another quest',
                        title: !v.shop.reroll.left ? 'No swaps left today' : item.canReroll ? 'Swap for another quest · ' + v.shop.reroll.cost + ' pts (' + v.shop.reroll.left + ' left today)' : 'Swapping a quest costs ' + v.shop.reroll.cost + ' pts',
                        onclick: function (event) { event.currentTarget.disabled = true; post('rerollQuest', { id: item.id }); }
                    }, [icon('refresh')])
                ])
            ]);
        }));
        var chest = h('div', { className: 'q-chest' + (q.chestClaimed ? ' open' : '') }, [
            h('span', { className: 'q-chest-icon', 'aria-hidden': 'true', text: q.chestClaimed ? '🎉' : '🎁' }),
            h('span', { className: 'q-chest-text', text: q.chestClaimed ? 'Bonus chest opened: +' + q.chestPoints + ' pts' : 'Finish all ' + q.total + ' for a +' + q.chestPoints + ' pts bonus chest' }),
            q.perfectDays ? h('span', { className: 'muted q-perfect', text: plural(q.perfectDays, 'perfect day') }) : null
        ]);

        var w = v.week;
        var compare = null;
        if (w.last && w.last.points > 0) {
            var pct = Math.min(100, Math.round((w.current.points / w.last.points) * 100));
            compare = h('div', { className: 'week-compare' }, [
                bar(pct, w.current.points >= w.last.points ? 'success' : '', 'Points this week compared with last week'),
                h('div', { className: 'week-sub', text: w.current.points >= w.last.points
                    ? 'Ahead of last week (' + fmt(w.last.points) + ' pts)'
                    : fmt(w.last.points - w.current.points) + ' pts to beat last week' })
            ]);
        } else if (w.last) {
            compare = h('div', { className: 'week-sub', text: 'Last week: ' + plural(w.last.runs, 'tool run') });
        }
        var week = h('div', { className: 'week' }, [
            h('div', { className: 'eyebrow', text: 'This week' }),
            h('div', { className: 'week-stats' }, [
                weekStat('points', w.current.points),
                weekStat('tool runs', w.current.runs),
                weekStat(w.current.tools === 1 ? 'tool used' : 'tools used', w.current.tools)
            ]),
            compare
        ]);
        replace(els.quests, [h('div', { className: 'q-main' }, [head, list, chest]), week]);
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
            h('p', { className: 'note', style: 'margin-top:14px' }, [icon('info'), h('span', { text: 'Ranks follow the points you have earned in total, so spending never lowers them. Every tool is available at every rank; reaching Silver, Gold and Platinum also unlocks a theme each (see Redeem).' })]),
            h('div', { className: 'card timeline', role: 'list' }, rows)
        ]);
    }

    // ------------------------------------------------------------------
    // Rewards: a points shop for themes and a personal profile
    // ------------------------------------------------------------------

    var SHOP_KINDS = [
        { id: 'all', label: 'All' },
        { id: 'avatar', label: 'Avatars', icon: 'smile' },
        { id: 'title', label: 'Titles', icon: 'tag' },
        { id: 'frame', label: 'Frames', icon: 'ring' },
        { id: 'banner', label: 'Banners', icon: 'image' },
        { id: 'effect', label: 'Effects', icon: 'sparkle' },
        { id: 'theme', label: 'Themes', icon: 'palette' }
    ];
    var SHOP_SHOW = [['all', 'Everything'], ['affordable', 'Can afford'], ['owned', 'Owned'], ['locked', 'Not owned']];
    var KIND_LABEL = { theme: 'Theme', avatar: 'Avatar', title: 'Title', frame: 'Badge frame', banner: 'Banner', effect: 'Celebration effect' };
    var KIND_TINT = { theme: 'var(--purple)', avatar: 'var(--info)', title: 'var(--accent)', frame: 'var(--gold)', banner: 'var(--success)', effect: 'var(--streak)' };
    var SLOT_HELP = {
        avatar: 'Shown on your rank card instead of the rank medal.',
        title: 'Shown beside your rank in the Tools view.',
        frame: 'A ring around your avatar or medal.',
        banner: 'The background of your rank card.',
        effect: 'Plays when you finish a quest, a milestone or rank up.'
    };

    function post(command, extra) {
        var message = { command: command };
        Object.keys(extra || {}).forEach(function (key) { message[key] = extra[key]; });
        vscode.postMessage(message);
    }

    /** Plays a celebration effect, using the worn avatar (or rank medal) for avatar rain. */
    function playEffect(name, anchor) {
        if (!name || !window.DevSnipEffects || !ui.view) return;
        var p = ui.view.profile || {};
        window.DevSnipEffects.play(name, { anchor: anchor, glyph: (p.avatar && p.avatar.value) || (p.badge || '⭐') });
    }

    /** A round medal wearing an avatar (or the rank badge) and a frame, like the one in the Tools view. */
    function medal(className, glyph, frame, badge) {
        return h('span', { className: className + (frame ? ' frame-' + frame : ''), 'aria-hidden': 'true' }, [
            glyph,
            badge && badge !== glyph ? h('span', { className: 'medal-rank', text: badge }) : null
        ]);
    }

    /** What the rank card looks like with a reward swapped in: the shop previews every item on you. */
    function profileWith(v, swap) {
        var p = v.profile || {};
        var out = {
            avatar: p.avatar && p.avatar.value,
            title: p.title && p.title.name,
            frame: p.frame && p.frame.value,
            banner: p.banner && p.banner.value
        };
        if (swap) {
            if (swap.kind === 'avatar') out.avatar = swap.glyph;
            if (swap.kind === 'title') out.title = swap.name;
            if (swap.kind === 'frame') out.frame = swap.style;
            if (swap.kind === 'banner') out.banner = swap.style;
        }
        return out;
    }

    /** A small copy of the Tools view rank card. */
    function rankCardPreview(v, look, compact) {
        var badge = v.level.badge;
        return h('div', { className: 'pv-card' + (compact ? ' compact' : '') + (look.banner ? ' banner-' + look.banner : ''), 'aria-hidden': 'true' }, [
            medal('pv-medal', look.avatar || badge, look.frame, look.avatar ? badge : null),
            h('div', { className: 'pv-body' }, [
                h('div', { className: 'pv-line' }, [
                    h('span', { className: 'pv-name' }, [v.level.name, look.title ? h('span', { className: 'pv-title', text: ' · ' + look.title }) : null]),
                    h('span', { className: 'pv-pts num', text: fmt(v.balance) + ' pts' })
                ]),
                compact ? null : h('div', { className: 'pv-meter' }, [h('span', { vars: { width: (v.nextLevel ? v.levelPercent : 100) + '%' } })])
            ])
        ]);
    }

    function rewardPreview(r, v) {
        if (r.kind === 'theme') {
            return h('div', { className: 'rw-preview', 'aria-hidden': 'true' }, r.swatches.map(function (color) {
                return h('span', { vars: { '--sw': color } });
            }));
        }
        if (r.kind === 'effect') {
            return h('div', { className: 'rw-preview stage' }, [
                h('span', { className: 'rw-effect', 'aria-hidden': 'true', text: r.icon }),
                h('button', {
                    type: 'button', className: 'rw-play', title: 'Play ' + r.name, 'aria-label': 'Play the ' + r.name + ' effect',
                    onclick: function (event) { playEffect(r.style, event.currentTarget); }
                }, [icon('play')])
            ]);
        }
        return h('div', { className: 'rw-preview stage' }, [rankCardPreview(v, profileWith(v, r), true)]);
    }

    function buyButton(r) {
        return h('button', {
            type: 'button', className: 'xbtn sm' + (r.affordable ? ' gold' : ''), 'data-buy': r.id, disabled: !r.affordable,
            title: r.affordable ? 'Spend ' + fmt(r.cost) + ' pts to unlock it now' : 'You need ' + fmt(r.cost) + ' pts to unlock it',
            onclick: function (event) {
                var button = event.currentTarget;
                button.disabled = true;
                button.lastChild.textContent = 'Unlocking…';
                post('buyReward', { id: r.id });
            }
        }, [icon('wallet'), h('span', { text: fmt(r.cost) + ' pts' })]);
    }

    function rewardAction(r) {
        if (r.unlocked) {
            if (r.kind === 'theme') {
                if (r.active) return chip('In use', 'ok', 'check');
                return h('button', { type: 'button', className: 'xbtn sm primary', onclick: function () { post('useTheme', { themeId: r.themeId }); } }, [icon('palette'), h('span', { text: 'Use theme' })]);
            }
            if (r.active) {
                return h('span', { className: 'rw-actions' }, [
                    chip('Equipped', 'ok', 'check'),
                    h('button', { type: 'button', className: 'link', title: 'Take it off', onclick: function () { post('equipReward', { slot: r.kind, id: null }); } }, ['Remove'])
                ]);
            }
            return h('button', {
                type: 'button', className: 'xbtn sm primary',
                onclick: function (event) {
                    if (r.kind === 'effect') playEffect(r.style, event.currentTarget);
                    post('equipReward', { slot: r.kind, id: r.id });
                }
            }, [icon('check'), h('span', { text: 'Equip' })]);
        }
        if (r.cost === null) return null;
        var preview = r.kind === 'theme'
            ? (r.previewing
                ? h('button', { type: 'button', className: 'xbtn sm', title: 'Switch back to your theme now', onclick: function () { post('endPreview'); } }, [icon('eye'), h('span', { text: 'End preview' })])
                : h('button', { type: 'button', className: 'xbtn sm', title: 'Try it on every DevSnip Pro panel for a few seconds', onclick: function () { post('previewTheme', { themeId: r.themeId }); } }, [icon('eye'), h('span', { text: 'Preview' })]))
            : null;
        return preview ? h('span', { className: 'rw-actions' }, [preview, buyButton(r)]) : buyButton(r);
    }

    function rewardCard(r, v) {
        return h('article', { className: 'card rw' + (r.unlocked ? ' unlocked' : ' locked') + (r.active ? ' active' : '') + (r.previewing ? ' previewing' : ''), 'data-reward': r.id }, [
            rewardPreview(r, v),
            h('div', { className: 'rw-body' }, [
                h('div', { className: 'ms-cat', vars: tintVars(KIND_TINT[r.kind] || 'var(--gold)'), text: KIND_LABEL[r.kind] || r.kind }),
                h('div', { className: 'ms-title' }, [r.icon + ' ' + r.name]),
                h('div', { className: 'ms-desc', text: r.description }),
                h('div', { className: 'rw-foot' }, [
                    r.unlocked
                        ? h('span', { className: 'rw-state ok' }, [icon('check'), 'Owned'])
                        : r.previewing
                        ? h('span', { className: 'rw-state preview' }, [icon('eye'), 'Previewing now'])
                        : h('span', { className: 'rw-state' }, [icon('lock'), r.hint ? r.hint + (r.cost !== null ? ' or buy' : '') : 'Unlock with points']),
                    rewardAction(r)
                ])
            ])
        ]);
    }

    function showShop(kind) {
        ui.shopKind = kind;
        ui.redeemView = 'shop';
        persist();
        ui.keys.rewards = null;
        renderRewards(ui.view);
        var grid = document.getElementById('shopTop');
        if (grid) grid.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }

    /** Your profile as others see it in the Tools view, with one row per slot. */
    function renderStudio(v) {
        var p = v.profile || {};
        var rows = ['avatar', 'title', 'frame', 'banner', 'effect'].map(function (slot) {
            var worn = p[slot];
            var owned = v.rewards.filter(function (r) { return r.kind === slot && r.unlocked; }).length;
            return h('div', { className: 'slot' }, [
                h('span', { className: 'slot-icon', vars: tintVars(KIND_TINT[slot]) }, [worn ? worn.icon : icon(SHOP_KINDS.filter(function (k) { return k.id === slot; })[0].icon)]),
                h('div', { className: 'slot-body' }, [
                    h('div', { className: 'slot-label', text: KIND_LABEL[slot] }),
                    h('div', { className: 'slot-value' + (worn ? '' : ' muted'), text: worn ? worn.name : 'None', title: SLOT_HELP[slot] })
                ]),
                h('span', { className: 'slot-actions' }, [
                    slot === 'effect' && worn ? h('button', { type: 'button', className: 'xbtn icon sm', title: 'Play ' + worn.name, 'aria-label': 'Play ' + worn.name, onclick: function (event) { playEffect(worn.value, event.currentTarget); } }, [icon('play')]) : null,
                    worn ? h('button', { type: 'button', className: 'xbtn icon sm', title: 'Take off ' + worn.name, 'aria-label': 'Take off ' + worn.name, onclick: function () { post('equipReward', { slot: slot, id: null }); } }, [icon('x')]) : null,
                    h('button', { type: 'button', className: 'xbtn sm', title: SLOT_HELP[slot], onclick: function () { showShop(slot); } }, [h('span', { text: owned ? 'Change' : 'Browse' })])
                ])
            ]);
        });
        var collected = v.shop ? v.shop.collected : 0;
        var collectible = v.shop ? v.shop.collectible : 0;
        return h('section', { className: 'card studio', 'aria-label': 'Your profile' }, [
            h('div', { className: 'studio-show' }, [
                h('div', { className: 'eyebrow', text: 'Your profile' }),
                h('div', { className: 'studio-sub', text: 'This is your rank card in the Tools view. Dress it up with points.' }),
                rankCardPreview(v, profileWith(v, null), false),
                h('div', { className: 'studio-collection' }, [
                    h('div', { className: 'studio-collection-head' }, [h('span', { text: 'Collection' }), h('span', { className: 'num', text: fmt(collected) + ' / ' + fmt(collectible) })]),
                    bar(collectible ? Math.round((collected / collectible) * 100) : 0, 'accent', 'Profile rewards collected')
                ])
            ]),
            h('div', { className: 'studio-slots' }, rows)
        ]);
    }

    /** Things to spend points on that are not cosmetic: a mystery box, quest swaps and streak freezes. */
    function renderPowerUps(v) {
        var shop = v.shop;
        if (!shop) return null;
        var box = shop.box;
        var reroll = shop.reroll;
        var st = v.streak;
        function power(iconText, tint, title, text, side, action) {
            return h('div', { className: 'card power', vars: tintVars(tint) }, [
                h('span', { className: 'power-icon', 'aria-hidden': 'true', text: iconText }),
                h('div', { className: 'power-body' }, [
                    h('div', { className: 'power-title' }, [h('span', { text: title }), side]),
                    h('div', { className: 'power-text', text: text }),
                    action
                ])
            ]);
        }
        return h('div', { className: 'powers' }, [
            power('🎁', 'var(--gold)', 'Mystery box', box.left
                ? 'A random avatar, title, frame, banner or effect you do not own yet (' + plural(box.left, 'item') + ' left).'
                : 'You own everything a mystery box can hold. Impressive!',
                chip(fmt(box.cost) + ' pts', 'pts'),
                h('button', {
                    type: 'button', className: 'xbtn sm' + (box.affordable ? ' gold' : ''), id: 'boxBtn', disabled: !box.affordable,
                    title: box.left ? (box.affordable ? 'Open a box for ' + fmt(box.cost) + ' pts' : 'You need ' + fmt(box.cost) + ' pts') : 'Nothing left to win',
                    onclick: function (event) {
                        var button = event.currentTarget;
                        button.disabled = true;
                        button.classList.add('shake');
                        button.lastChild.textContent = 'Opening…';
                        post('openBox');
                    }
                }, [icon('gift'), h('span', { text: 'Open a box' })])),
            power('🔄', 'var(--accent)', 'Quest swap', 'Swap a quest you do not like for a different one. ' + reroll.left + ' of ' + reroll.max + ' swaps left today.',
                chip(fmt(reroll.cost) + ' pts', 'pts'),
                h('button', {
                    type: 'button', className: 'xbtn sm', disabled: !v.quests || !v.quests.total,
                    onclick: function () {
                        closeRedeem();
                        if (els.quests) els.quests.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
                    }
                }, [icon('refresh'), h('span', { text: 'Pick a quest' })])),
            power('❄️', 'var(--info)', 'Streak freeze', 'Covers one missed day so your streak survives. You hold ' + st.freezes + ' of ' + st.maxFreezes + '.',
                chip(fmt(st.freezeCost) + ' pts', 'pts'),
                h('button', {
                    type: 'button', className: 'xbtn sm' + (st.canBuyFreeze ? ' gold' : ''), disabled: !st.canBuyFreeze,
                    title: st.freezes >= st.maxFreezes ? 'You hold the maximum' : st.canBuyFreeze ? 'Buy one for ' + st.freezeCost + ' pts' : 'You need ' + st.freezeCost + ' pts',
                    onclick: function (event) { event.currentTarget.disabled = true; post('buyFreeze'); }
                }, [icon('snow'), h('span', { text: st.freezes >= st.maxFreezes ? 'Full' : 'Buy a freeze' })]))
        ]);
    }

    // ------------------------------------------------------------------
    // Play: daily activities that pay points and teach something
    // ------------------------------------------------------------------

    var REDEEM_VIEWS = [
        { id: 'play', label: 'Play & earn', icon: 'play' },
        { id: 'profile', label: 'Profile', icon: 'smile' },
        { id: 'shop', label: 'Shop', icon: 'wallet' }
    ];
    var SEG = 360 / 8;

    /** The daily wheel, drawn as SVG so the browser can rotate it smoothly. */
    function wheelSvg(segments, angle) {
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '-100 -100 200 200');
        svg.setAttribute('class', 'wheel-svg');
        svg.setAttribute('aria-hidden', 'true');
        var group = document.createElementNS(NS, 'g');
        group.setAttribute('class', 'wheel-rotor');
        group.style.transform = 'rotate(' + angle + 'deg)';
        var seg = 360 / segments.length;
        segments.forEach(function (segment, i) {
            var a0 = (i * seg - 90) * Math.PI / 180;
            var a1 = ((i + 1) * seg - 90) * Math.PI / 180;
            var path = document.createElementNS(NS, 'path');
            path.setAttribute('d', 'M0 0 L' + (96 * Math.cos(a0)).toFixed(2) + ' ' + (96 * Math.sin(a0)).toFixed(2) + ' A96 96 0 0 1 ' + (96 * Math.cos(a1)).toFixed(2) + ' ' + (96 * Math.sin(a1)).toFixed(2) + ' Z');
            path.setAttribute('fill', segment.color);
            path.setAttribute('class', 'wheel-slice');
            group.appendChild(path);
            var mid = (i + 0.5) * seg;
            var label = document.createElementNS(NS, 'g');
            label.setAttribute('transform', 'rotate(' + mid + ') translate(0 -62)');
            var emoji = document.createElementNS(NS, 'text');
            emoji.setAttribute('class', 'wheel-icon');
            emoji.setAttribute('y', '-4');
            emoji.textContent = segment.icon;
            var text = document.createElementNS(NS, 'text');
            text.setAttribute('class', 'wheel-label');
            text.setAttribute('y', '16');
            text.textContent = segment.label;
            label.appendChild(emoji);
            label.appendChild(text);
            group.appendChild(label);
        });
        var hub = document.createElementNS(NS, 'circle');
        hub.setAttribute('r', '16');
        hub.setAttribute('class', 'wheel-hub');
        svg.appendChild(group);
        svg.appendChild(hub);
        return svg;
    }

    /** Wheel angle that puts segment `index` under the pointer at the top. */
    function restAngle(index) { return index === null || index === undefined ? -SEG / 2 : -(index + 0.5) * SEG; }

    function spinCard(v) {
        var w = v.play.wheel;
        if (ui.wheelAngle === null || ui.wheelAngle === undefined) ui.wheelAngle = restAngle(w.lastSpin);
        var svg = wheelSvg(w.segments, ui.wheelAngle);
        var odds = w.segments.reduce(function (acc, seg) {
            var key = seg.icon + ' ' + seg.label;
            acc[key] = (acc[key] || 0) + seg.chance;
            return acc;
        }, {});
        var oddsText = Object.keys(odds).map(function (k) { return k + ' ' + odds[k] + '%'; }).join(' · ');
        var button = h('button', {
            type: 'button', className: 'xbtn ' + (w.spinsLeft ? 'gold' : ''), id: 'spinBtn', disabled: !w.spinsLeft || ui.spinning,
            onclick: function (event) {
                event.currentTarget.disabled = true;
                event.currentTarget.lastChild.textContent = 'Spinning…';
                ui.spinning = true;
                post('spinWheel');
            }
        }, [icon('refresh'), h('span', { text: w.spinsLeft ? (w.spinsLeft > 1 ? 'Spin (' + w.spinsLeft + ' left)' : 'Spin the wheel') : 'Spun today' })]);
        return h('article', { className: 'card act-card spin-card' }, [
            h('div', { className: 'act-head' }, [
                h('span', { className: 'act-emoji', 'aria-hidden': 'true', text: '🎡' }),
                h('div', { className: 'act-heading' }, [h('div', { className: 'act-name', text: 'Daily spin' }), h('div', { className: 'act-sub', text: 'One free spin a day. Finish all of today’s quests for a bonus spin.' })]),
                w.spinsLeft ? chip(w.spinsLeft + ' ready', 'accent') : chip('Done', 'ok', 'check')
            ]),
            h('div', { className: 'wheel', id: 'wheel' }, [h('span', { className: 'wheel-pointer', 'aria-hidden': 'true' }), svg]),
            h('div', { className: 'act-foot' }, [button, h('span', { className: 'act-note', title: 'Chances for each prize', text: oddsText })])
        ]);
    }

    function quizCard(v) {
        var q = v.play.quiz;
        var answered = q.choice !== null;
        var letters = ['A', 'B', 'C', 'D'];
        var options = h('div', { className: 'quiz-options', role: 'group', 'aria-label': 'Answers' }, q.options.map(function (text, i) {
            var state = !answered ? '' : i === q.answer ? ' right' : i === q.choice ? ' wrong' : ' dim';
            return h('button', {
                type: 'button', className: 'quiz-opt' + state, disabled: answered,
                'aria-label': letters[i] + ': ' + text + (answered && i === q.answer ? ' (correct answer)' : ''),
                onclick: function (event) {
                    Array.prototype.forEach.call(event.currentTarget.parentNode.children, function (b) { b.disabled = true; });
                    event.currentTarget.classList.add('picked');
                    post('answerQuiz', { choice: i });
                }
            }, [h('span', { className: 'quiz-letter', text: letters[i] }), h('span', { className: 'quiz-text', text: text })]);
        }));
        var right = answered && q.choice === q.answer;
        return h('article', { className: 'card act-card quiz-card' }, [
            h('div', { className: 'act-head' }, [
                h('span', { className: 'act-emoji', 'aria-hidden': 'true', text: '🧩' }),
                h('div', { className: 'act-heading' }, [h('div', { className: 'act-name', text: 'Daily dev challenge' }), h('div', { className: 'act-sub', text: q.category + ' · a new question every day' })]),
                answered ? chip(right ? '+' + q.correctPoints : '+' + q.tryPoints, right ? 'ok' : 'pts', right ? 'check' : null) : chip('+' + q.correctPoints, 'pts')
            ]),
            h('div', { className: 'quiz-q', text: q.question }),
            q.code ? h('pre', { className: 'quiz-code', text: q.code }) : null,
            options,
            answered
                ? h('div', { className: 'quiz-explain ' + (right ? 'right' : 'wrong') }, [
                    h('strong', { text: right ? 'Correct! ' : 'Not quite. ' }),
                    h('span', { text: q.explain })
                ])
                : h('div', { className: 'act-note', text: 'Right answer +' + q.correctPoints + ' pts · trying still earns +' + q.tryPoints + '. You get one answer.' }),
            h('div', { className: 'act-note' }, [plural(q.correctTotal, 'correct answer') + ' so far' + (q.streak > 1 ? ' · 🔥 ' + q.streak + '-day answer streak' : '')])
        ]);
    }

    // Bit Sprint: convert between decimal, hex and binary against the clock.
    function sprintQuestion() {
        var kinds = [['dec', 'hex'], ['hex', 'dec'], ['bin', 'dec'], ['dec', 'bin']];
        var pair = kinds[Math.floor(Math.random() * kinds.length)];
        var binary = pair[0] === 'bin' || pair[1] === 'bin';
        // Big enough to need a moment's thought, small enough to do in your head.
        var n = binary ? 5 + Math.floor(Math.random() * 59) : 17 + Math.floor(Math.random() * 239);
        function show(value, base) {
            if (base === 'hex') return '0x' + value.toString(16).toUpperCase();
            if (base === 'bin') return '0b' + value.toString(2);
            return String(value);
        }
        var choices = [n];
        var nudges = [1, -1, 2, -2, 16, -16, 4, 8, -4, -8, 32];
        for (var i = 0; choices.length < 4 && i < 40; i++) {
            var candidate = n + nudges[Math.floor(Math.random() * nudges.length)];
            var max = pair[0] === 'bin' || pair[1] === 'bin' ? 63 : 255;
            if (candidate >= 0 && candidate <= max && choices.indexOf(candidate) < 0) choices.push(candidate);
        }
        choices.sort(function () { return Math.random() - 0.5; });
        var names = { dec: 'decimal', hex: 'hex', bin: 'binary' };
        return {
            prompt: show(n, pair[0]),
            target: names[pair[1]],
            options: choices.map(function (c) { return show(c, pair[1]); }),
            answer: choices.indexOf(n)
        };
    }

    function sprintCard(v) {
        var sp = v.play.sprint;
        var body;
        if (ui.sprint) {
            var game = ui.sprint;
            var q = game.question;
            body = [
                h('div', { className: 'sprint-top' }, [
                    h('span', { className: 'sprint-score num', id: 'sprintScore', text: game.score + ' correct' }),
                    h('span', { className: 'sprint-time num', id: 'sprintTime', text: Math.ceil(game.left) + 's' })
                ]),
                h('div', { className: 'bar accent sprint-bar' }, [h('span', { id: 'sprintBar', vars: { width: (game.left / sp.seconds * 100) + '%' } })]),
                h('div', { className: 'sprint-prompt' }, [h('span', { className: 'num', text: q.prompt }), h('small', { text: ' in ' + q.target + '?' })]),
                h('div', { className: 'sprint-options' }, q.options.map(function (text, i) {
                    return h('button', { type: 'button', className: 'quiz-opt sprint-opt', 'data-key': String(i + 1), onclick: function () { sprintAnswer(i); } }, [
                        h('span', { className: 'quiz-letter', text: String(i + 1) }), h('span', { className: 'quiz-text num', text: text })
                    ]);
                }))
            ];
        } else {
            body = [
                h('div', { className: 'sprint-intro' }, [
                    h('div', { className: 'sprint-stat' }, [h('span', { className: 'num', text: sp.best ? fmt(sp.best) : '–' }), h('small', { text: 'best' })]),
                    h('div', { className: 'sprint-stat' }, [h('span', { className: 'num', text: sp.played ? fmt(sp.score) : '–' }), h('small', { text: 'today' })]),
                    h('div', { className: 'sprint-stat' }, [h('span', { className: 'num', text: sp.seconds + 's' }), h('small', { text: 'per game' })])
                ]),
                h('div', { className: 'act-foot' }, [
                    h('button', { type: 'button', className: 'xbtn ' + (sp.played ? '' : 'primary'), onclick: startSprint }, [icon('play'), h('span', { text: sp.played ? 'Practice again' : 'Start' })]),
                    h('span', { className: 'act-note', text: sp.played ? 'Today’s points are in. Practice for a new best.' : '+1 pt per correct answer, up to +' + sp.maxPoints + ' a day. Keys 1–4 work too.' })
                ])
            ];
        }
        return h('article', { className: 'card act-card sprint-card' + (ui.sprint ? ' playing' : ''), id: 'sprintCard' }, [
            h('div', { className: 'act-head' }, [
                h('span', { className: 'act-emoji', 'aria-hidden': 'true', text: '⚡' }),
                h('div', { className: 'act-heading' }, [h('div', { className: 'act-name', text: 'Bit Sprint' }), h('div', { className: 'act-sub', text: 'Convert decimal, hex and binary as fast as you can.' })]),
                sp.played ? chip('Played', 'ok', 'check') : chip('up to +' + sp.maxPoints, 'pts')
            ])
        ].concat(body));
    }

    function redrawSprint() {
        var card = document.getElementById('sprintCard');
        if (card && ui.view) card.replaceWith(sprintCard(ui.view));
    }

    function startSprint() {
        if (ui.sprint || !ui.view) return;
        var seconds = ui.view.play.sprint.seconds;
        ui.sprint = { score: 0, left: seconds, end: Date.now() + seconds * 1000, question: sprintQuestion() };
        redrawSprint();
        var first = document.querySelector('.sprint-opt');
        if (first) first.focus();
        ui.sprintTimer = setInterval(function () {
            var game = ui.sprint;
            if (!game) return;
            game.left = Math.max(0, (game.end - Date.now()) / 1000);
            var time = document.getElementById('sprintTime');
            var fill = document.getElementById('sprintBar');
            if (time) time.textContent = Math.ceil(game.left) + 's';
            if (fill) fill.style.width = (game.left / seconds * 100) + '%';
            if (game.left <= 0) endSprint();
        }, 100);
    }

    function sprintAnswer(i) {
        var game = ui.sprint;
        if (!game) return;
        var right = i === game.question.answer;
        if (right) game.score += 1;
        game.question = sprintQuestion();
        redrawSprint();
        var card = document.getElementById('sprintCard');
        if (card) {
            card.classList.add(right ? 'flash-right' : 'flash-wrong');
            var focus = card.querySelector('.sprint-opt');
            if (focus) focus.focus();
        }
    }

    function endSprint() {
        var game = ui.sprint;
        clearInterval(ui.sprintTimer);
        ui.sprint = null;
        if (!game) return;
        post('sprintDone', { score: game.score });
        ui.keys.rewards = null;
        if (ui.view) renderRewards(ui.view);
    }

    document.addEventListener('keydown', function (event) {
        if (!ui.sprint || !/^[1-4]$/.test(event.key)) return;
        event.preventDefault();
        sprintAnswer(Number(event.key) - 1);
    });

    function tipCard(v) {
        var t = v.play.tip;
        return h('article', { className: 'card act-card tip-card' }, [
            h('div', { className: 'act-head' }, [
                h('span', { className: 'act-emoji', 'aria-hidden': 'true', text: '💡' }),
                h('div', { className: 'act-heading' }, [h('div', { className: 'act-name', text: 'Tip of the day' }), h('div', { className: 'act-sub', text: 'A tool worth knowing, one a day.' })]),
                t.tried ? chip('Tried', 'ok', 'check') : chip('+' + t.points, 'pts')
            ]),
            h('div', { className: 'tip-title', text: t.title }),
            h('p', { className: 'tip-text', text: t.text }),
            h('div', { className: 'act-foot' }, [
                h('button', { type: 'button', className: 'xbtn ' + (t.tried ? '' : 'primary'), onclick: function () { post('tryTip'); } }, [icon('arrow'), h('span', { text: t.action })]),
                h('span', { className: 'act-note', text: t.tried ? 'Opens the tool again.' : 'Try it for +' + t.points + ' pts, plus the usual points for using the tool.' })
            ])
        ]);
    }

    function eventCard(v) {
        var e = v.play.event;
        var reward = e.reward;
        return h('article', { className: 'card event-card' + (e.done ? ' done' : '') }, [
            h('div', { className: 'event-main' }, [
                h('div', { className: 'event-tags' }, [
                    h('span', { className: 'event-live' }, [h('i'), 'Weekly event']),
                    h('span', { className: 'chip', text: e.daysLeft === 1 ? 'Last day!' : e.daysLeft + ' days left' })
                ]),
                h('div', { className: 'event-title' }, [h('span', { 'aria-hidden': 'true', text: e.icon }), h('span', { text: e.title })]),
                h('div', { className: 'event-desc', text: e.done ? 'Complete! A new event starts on Monday.' : e.description + ' before Sunday ends.' }),
                h('div', { className: 'event-progress' }, [
                    bar(e.percent, e.done ? 'success' : 'accent', e.title + ' progress'),
                    h('span', { className: 'num', text: fmt(e.progress) + ' / ' + fmt(e.target) })
                ])
            ]),
            h('div', { className: 'event-prize' }, [
                h('div', { className: 'eyebrow', text: 'Prize' }),
                reward ? h('div', { className: 'event-reward' }, [
                    h('span', { className: 'event-reward-icon', 'aria-hidden': 'true', text: reward.icon }),
                    h('div', {}, [
                        h('div', { className: 'event-reward-name', text: reward.name }),
                        h('div', { className: 'act-note', text: (KIND_LABEL[reward.kind] || 'Reward') + ' · only this week' })
                    ])
                ]) : null,
                chip('+' + fmt(e.points) + ' pts', e.done ? 'ok' : 'pts', e.done ? 'check' : null),
                e.won ? h('div', { className: 'act-note', text: plural(e.won, 'event') + ' completed' }) : null
            ])
        ]);
    }

    function checkinCard(v) {
        var c = v.play.checkin;
        var cells = [];
        for (var d = 1; d <= c.every; d++) {
            var state = d < c.day ? 'past' : d === c.day ? 'today' : 'future';
            cells.push(h('div', { className: 'ci-day ' + state + (d === c.every ? ' chest' : '') }, [
                h('span', { className: 'ci-icon', 'aria-hidden': 'true', text: d === c.every ? '🎁' : state === 'future' ? '·' : '✓' }),
                h('small', { text: 'Day ' + d })
            ]));
        }
        var toChest = c.every - c.day;
        var lucky = v.play.lucky;
        return h('article', { className: 'card act-card checkin-card' }, [
            h('div', { className: 'act-head' }, [
                h('span', { className: 'act-emoji', 'aria-hidden': 'true', text: '📅' }),
                h('div', { className: 'act-heading' }, [
                    h('div', { className: 'act-name', text: 'Check-in week' }),
                    h('div', { className: 'act-sub', text: toChest ? 'Come back daily: a free reward chest in ' + plural(toChest, 'day') + '.' : 'Chest day! Your reward is in.' })
                ])
            ]),
            h('div', { className: 'ci-row', role: 'img', 'aria-label': 'Day ' + c.day + ' of ' + c.every + ' of your check-in week' }, cells),
            h('div', { className: 'lucky' + (lucky.found ? ' found' : '') }, [
                h('span', { 'aria-hidden': 'true', text: '🍀' }),
                h('span', { text: lucky.found ? 'You found today’s lucky bonus (+' + lucky.points + ')!' : 'Any tool run today might be a lucky find worth +' + lucky.points + '.' })
            ])
        ]);
    }

    /** Spins the wheel to land on `index`, then calls done. The prize was already decided by the extension. */
    function animateSpin(index, done) {
        var rotor = document.querySelector('#wheel .wheel-rotor');
        var from = ui.wheelAngle || 0;
        var target = restAngle(index);
        var forward = (((target - from) % 360) + 360) % 360;
        var to = from + (reduceMotion ? forward : 360 * 5 + forward);
        var duration = reduceMotion || !rotor ? 0 : 3600;
        ui.wheelAngle = to;
        if (rotor) {
            rotor.style.transition = duration ? 'transform ' + duration + 'ms cubic-bezier(.15,.7,.15,1)' : 'none';
            requestAnimationFrame(function () { rotor.style.transform = 'rotate(' + to + 'deg)'; });
        }
        setTimeout(function () {
            ui.wheelAngle = ((to % 360) + 360) % 360;
            done();
        }, duration + 150);
    }

    function currentEffect() {
        return ui.view && ui.view.profile && ui.view.profile.effect && ui.view.profile.effect.value;
    }

    function renderPlay(v) {
        if (!v.play) return [];
        return [
            eventCard(v),
            h('div', { className: 'act-grid' }, [spinCard(v), quizCard(v), sprintCard(v), tipCard(v)]),
            checkinCard(v),
            h('p', { className: 'note', style: 'margin-top:14px' }, [icon('info'), h('span', { text: 'Each activity resets at midnight and the event every Monday, so there is something new whenever you come back. Points from activities never count against the daily tool-use limit.' })])
        ];
    }

    function renderRewards(v) {
        // Never redraw under a spinning wheel or a running game; they redraw when they finish.
        if (ui.spinning || ui.sprint) return;
        if (!changed('rewards', [v.rewards, v.balance, v.level.badge, v.level.name, v.levelPercent, v.profile, v.shop, v.streak, v.quests && v.quests.total, v.play, ui.shopKind, ui.shopShow, ui.redeemView])) return;
        var view = REDEEM_VIEWS.some(function (r) { return r.id === ui.redeemView; }) ? ui.redeemView : 'play';
        var nav = h('div', { className: 'redeem-nav', role: 'tablist', 'aria-label': 'Redeem' }, REDEEM_VIEWS.map(function (r) {
            var badge = r.id === 'play' && v.play && v.play.waiting ? v.play.waiting : null;
            return h('button', {
                type: 'button', role: 'tab', className: 'redeem-tab', 'aria-selected': view === r.id ? 'true' : 'false',
                onclick: function () { ui.redeemView = r.id; persist(); renderRewards(ui.view); els.redeem.scrollTop = 0; }
            }, [icon(r.icon), h('span', { text: r.label }), badge ? h('span', { className: 'redeem-badge', text: String(badge) }) : null]);
        }));
        els.redeemBalance.textContent = fmt(v.balance);
        if (view === 'play') { replace(els.redeemBody, [nav].concat(renderPlay(v))); return; }
        if (view === 'profile') {
            replace(els.redeemBody, [nav, renderStudio(v), h('p', { className: 'note', style: 'margin-top:14px' }, [icon('info'), h('span', { text: 'Change any slot to browse what you own and what you can buy. Everything is cosmetic: every tool works at every rank.' })])]);
            return;
        }
        var rewards = v.rewards || [];
        var kind = SHOP_KINDS.some(function (k) { return k.id === ui.shopKind; }) ? ui.shopKind : 'all';
        var show = ui.shopShow || 'all';
        var order = SHOP_KINDS.map(function (k) { return k.id; });
        var list = rewards.filter(function (r) {
            if (kind !== 'all' && r.kind !== kind) return false;
            if (show === 'owned') return r.unlocked;
            if (show === 'locked') return !r.unlocked;
            if (show === 'affordable') return !r.unlocked && r.affordable;
            return true;
        }).map(function (r, index) { return [r, index]; }).sort(function (a, b) {
            // Profile rewards first, in tab order; the catalog order (by price) within each kind.
            return order.indexOf(a[0].kind) - order.indexOf(b[0].kind) || a[1] - b[1];
        }).map(function (pair) { return pair[0]; });
        var kinds = h('div', { className: 'tabs shop-kinds', role: 'group', 'aria-label': 'Reward type' }, SHOP_KINDS.map(function (k) {
            var items = rewards.filter(function (r) { return k.id === 'all' || r.kind === k.id; });
            var owned = items.filter(function (r) { return r.unlocked; }).length;
            return h('button', {
                type: 'button', className: 'tab', 'aria-pressed': kind === k.id ? 'true' : 'false',
                onclick: function () { ui.shopKind = k.id; persist(); renderRewards(ui.view); }
            }, [k.icon ? icon(k.icon) : null, h('span', { text: k.label }), h('span', { className: 'count', text: owned + '/' + items.length })]);
        }));
        var filters = h('div', { className: 'filters', role: 'group', 'aria-label': 'Show' }, SHOP_SHOW.map(function (f) {
            return h('button', {
                type: 'button', className: 'filter', 'aria-pressed': show === f[0] ? 'true' : 'false', text: f[1],
                onclick: function () { ui.shopShow = f[0]; persist(); renderRewards(ui.view); }
            });
        }));
        replace(els.redeemBody, [
            nav,
            renderPowerUps(v),
            h('div', { className: 'shop-head', id: 'shopTop' }, [
                h('div', {}, [h('div', { className: 'eyebrow', text: 'Rewards shop' }), h('div', { className: 'shop-balance' }, [icon('wallet'), h('span', { className: 'num', text: fmt(v.balance) + ' pts to spend' })])]),
                filters
            ]),
            kinds,
            list.length
                ? h('div', { className: 'grid' }, list.map(function (r) { return rewardCard(r, v); }))
                : h('div', { className: 'card empty' }, [icon('gift'), show === 'affordable' ? 'Nothing you can afford here yet. Keep earning!' : 'Nothing to show here.']),
            h('p', { className: 'note', style: 'margin-top:14px' }, [icon('info'), h('span', { text: 'Rewards are cosmetic: every tool works at every rank. Each item is previewed on your own rank card. Some can also be earned by climbing the ranks or finishing milestones, and a few can only be earned. System Default is always free.' })])
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
        if (!changed('earn', [v.rules, v.today.loginPoints, v.today.bonusPoints, v.spend.cheapest, v.streak.maxFreezes, v.streak.freezeCost, (v.rewards || []).length, v.shop && v.shop.reroll.cost])) return;
        var themeCosts = (v.rewards || []).filter(function (r) { return r.kind === 'theme' && r.cost !== null; }).map(function (r) { return r.cost; });
        var themeFrom = themeCosts.length ? Math.min.apply(null, themeCosts) : 0;
        var rules = [
            ['tool', 'var(--info)', 'Any tool run', '+3', 'Every DevSnip Pro command counts. After ' + v.rules.rateLimitAfter + ' runs of the same tool in a day, further runs give 1 point.'],
            ['snippet', 'var(--purple)', 'Create a snippet', '+10', 'Saving your own code snippet.'],
            ['shield', 'var(--success)', 'Security audit', '+8', 'Workspace, cloud, dependency or endpoint scans.'],
            ['sparkle', 'var(--purple)', 'AI, ML and RAG tools', '+5', 'Token counter, prompt tools, RAG calculators and more.'],
            ['target', 'var(--accent)', 'Daily quests', '+10 to +20', 'Three new quests every day. Finish all of them for a +' + (v.quests ? v.quests.chestPoints : 15) + ' pts bonus chest. Never limited by the daily cap.'],
            ['sun', 'var(--streak)', 'Daily login', '+' + v.today.loginPoints + ' today', 'Added automatically once a day, plus 1 point for every day of your streak, up to +' + v.rules.loginBonusMax + '.'],
            ['snow', 'var(--info)', 'Streak freezes', 'Up to ' + v.streak.maxFreezes, 'Earn one every ' + v.rules.freezeEvery + ' streak days, or buy one for ' + v.streak.freezeCost + ' pts. One is used up automatically to cover a missed day.'],
            ['palette', 'var(--purple)', 'Themes', themeFrom ? 'From ' + fmt(themeFrom) + ' pts' : 'Points', 'Spend points to unlock themes with Redeem on your rank card. Some also unlock as you rank up.'],
            ['smile', 'var(--info)', 'Your profile', 'From 40 pts', 'Avatars, titles, badge frames, banners and celebration effects for your rank card. Ranks and milestones unlock exclusive ones.'],
            ['play', 'var(--streak)', 'Play & earn', 'Daily', 'In Redeem: a daily spin, a dev challenge, the Bit Sprint mini-game, a tip of the day, a weekly event with an exclusive prize, and a check-in chest every 7th day.'],
            ['refresh', 'var(--accent)', 'Power-ups', v.shop ? fmt(v.shop.reroll.cost) + '+ pts' : 'Points', 'Swap a quest you do not like, open a mystery box for a random profile reward, or buy a streak freeze.'],
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
                (v.spend.cheapest ? 'Points are spent on premium REST API Client tools, from ' + v.spend.cheapest + ' points per run, and only after a run succeeds, as well as on themes, profile rewards and power-ups.' : '') })])
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
        var questsBefore = {};
        ((previous.quests && previous.quests.items) || []).forEach(function (q) { questsBefore[q.id] = q.done; });
        ((v.quests && v.quests.items) || []).forEach(function (q) {
            if (q.done && questsBefore[q.id] === false) {
                celebrate(q.icon, 'Quest complete: ' + q.title + ' (+' + q.points + ' pts)');
                var row = document.querySelector('[data-quest="' + q.id + '"]');
                if (row) row.classList.add('pulse');
            }
        });
        if (v.quests && previous.quests && v.quests.chestClaimed && !previous.quests.chestClaimed) {
            celebrate('🎁', "All of today's quests done! +" + v.quests.chestPoints + ' bonus pts');
        }
        var rewardsBefore = {};
        (previous.rewards || []).forEach(function (r) { rewardsBefore[r.id] = r.unlocked; });
        (v.rewards || []).forEach(function (r) {
            if (r.unlocked && rewardsBefore[r.id] === false) {
                celebrate(r.icon, 'New ' + (KIND_LABEL[r.kind] || 'reward').toLowerCase() + ' unlocked: ' + r.name);
            }
        });
        // The worn celebration effect plays once for a batch of wins (not for purchases).
        var effect = v.profile && v.profile.effect && v.profile.effect.value;
        if (effect && ui.celebrations.length + (ui.celebrating ? 1 : 0) > 0 && v.lifetime > previous.lifetime) playEffect(effect);
        if (v.streak && previous.streak && v.streak.freezes > previous.streak.freezes) celebrate('❄️', 'Streak freeze ready');
        if (v.play && previous.play) {
            if (v.play.event.done && !previous.play.event.done && v.play.event.id === previous.play.event.id) {
                celebrate(v.play.event.icon, v.play.event.title + ' complete! +' + v.play.event.points + ' pts');
                playEffect(currentEffect() || 'fireworks');
            }
            if (v.play.lucky.found && !previous.play.lucky.found) celebrate('🍀', 'Lucky find! +' + v.play.lucky.points + ' bonus pts');
        }
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
    document.getElementById('coffeeBtn').addEventListener('click', function () { vscode.postMessage({ command: 'openSupport' }); });
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
        renderQuests(v);
        renderDaily(v);
        renderCounts(v);
        renderMilestones(v);
        renderLevels(v);
        renderRewards(v);
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
        } else if (message.type === 'openRedeem') {
            ui.redeemView = 'play';
            ui.keys.rewards = null;
            if (ui.view) renderRewards(ui.view);
            openRedeem();
        } else if (message.type === 'result' && message.action === 'spinWheel') {
            var finishSpin = function () {
                ui.spinning = false;
                ui.keys.rewards = null;
                if (ui.view) renderRewards(ui.view);
            };
            if (!message.ok) { finishSpin(); toast(message.message, 'info'); return; }
            animateSpin(message.index, function () {
                finishSpin();
                celebrate(message.icon, message.message);
                playEffect(currentEffect() || 'confetti', document.getElementById('wheel'));
            });
        } else if (message.type === 'result') {
            if (message.action === 'answerQuiz' && message.ok && message.correct) playEffect(currentEffect() || 'sparkles', document.querySelector('.quiz-card'));
            if (message.action === 'sprintDone' && message.newBest) celebrate('⚡', 'New Bit Sprint best: ' + message.score + '!');
            if (message.action === 'resetData') {
                document.getElementById('resetBtn').disabled = false;
                if (message.ok) ui.shown = PAGE;
            }
            if (message.action === 'claimBonus' && !message.ok) {
                // The state update already redrew the button if it was claimed elsewhere.
                var claim = document.getElementById('claimBtn');
                if (claim) { claim.disabled = false; claim.lastChild.textContent = 'Claim +' + (ui.view ? ui.view.today.bonusPoints : ''); }
            }
            if (/^(buyFreeze|buyReward|openBox|rerollQuest|equipReward)$/.test(message.action) && !message.ok && ui.view) {
                // Nothing changed, so redraw the buttons that were disabled while waiting.
                ui.keys.hero = null;
                ui.keys.rewards = null;
                ui.keys.quests = null;
                renderHero(ui.view);
                renderQuests(ui.view);
                renderRewards(ui.view);
            }
            if (message.action === 'openBox' && message.ok && message.reward) {
                celebrate(message.reward.icon, 'Mystery box: ' + message.reward.name + ' (' + (KIND_LABEL[message.reward.kind] || 'reward').toLowerCase() + ')');
                playEffect((ui.view && ui.view.profile && ui.view.profile.effect && ui.view.profile.effect.value) || 'confetti', document.getElementById('boxBtn'));
                var won = document.querySelector('[data-reward="' + message.reward.id + '"]');
                if (won) won.classList.add('pulse');
            }
            if (message.message) toast(message.message, message.ok ? 'success' : 'info');
        } else if (message.type === 'error') {
            showError(message.message);
        }
    });

    vscode.postMessage({ command: 'ready' });
})();
