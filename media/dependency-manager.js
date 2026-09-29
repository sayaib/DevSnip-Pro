// Webview script for "Dependencies & Installation".
//
// Package names, versions and paths come from workspace files, so every value
// is written with textContent / attributes - never through innerHTML. The page
// only ever sends ids and action names to the extension; the extension builds,
// validates and confirms every command itself.
(function () {
    'use strict';

    var vscode = acquireVsCodeApi();
    var saved = vscode.getState() || {};

    var state = {
        projects: [],
        busy: false,
        trusted: true,
        phase: 'loading',
        expanded: {},
        search: saved.search || '',
        status: saved.status || 'all',
        scope: saved.scope || 'all',
        includeProd: false,
        job: null,
        log: ''
    };

    var STATUS_LABEL = {
        'up-to-date': 'Up to date',
        outdated: 'Update available',
        major: 'Newer major',
        missing: 'Missing',
        mismatch: 'Wrong version',
        unknown: 'Unknown',
        checking: 'Checking'
    };
    var ECOSYSTEM_LABEL = { node: 'Node.js', python: 'Python', maven: 'Maven', gradle: 'Gradle' };
    var KIND_LABEL = { install: 'Install', update: 'Update', upgrade: 'Upgrade', add: 'Add' };

    var el = {
        rescan: document.getElementById('rescan'),
        installAll: document.getElementById('installAll'),
        updateAll: document.getElementById('updateAll'),
        includeProd: document.getElementById('includeProd'),
        search: document.getElementById('search'),
        statusFilter: document.getElementById('statusFilter'),
        scopeFilter: document.getElementById('scopeFilter'),
        banner: document.getElementById('banner'),
        job: document.getElementById('job'),
        stats: document.getElementById('stats'),
        projects: document.getElementById('projects'),
        subtitle: document.getElementById('subtitle'),
        showLog: document.getElementById('showLog')
    };

    // ------------------------------------------------------------------
    // DOM helpers
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
                else if (value === true) node.setAttribute(key, '');
                else node.setAttribute(key, String(value));
            });
        }
        (children || []).forEach(function (child) {
            if (child === null || child === undefined || child === false) return;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    /** Renders `code` spans in trusted-shape text by splitting on backticks, still via text nodes. */
    function richText(text) {
        var span = h('span');
        String(text || '').split('`').forEach(function (part, index) {
            span.appendChild(index % 2 ? h('code', { text: part }) : document.createTextNode(part));
        });
        return span;
    }

    function button(label, className, onClick, extra) {
        var attrs = { type: 'button', className: 'btn ' + (className || ''), text: label, onclick: onClick };
        Object.keys(extra || {}).forEach(function (key) { attrs[key] = extra[key]; });
        return h('button', attrs);
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
        }, 2800);
    }

    // `kind` says what was copied (e.g. install_command); only it, never the text, is used for analytics.
    function copy(text, kind) {
        vscode.postMessage({ type: 'copy', text: text, kind: kind || 'command' });
    }

    function persist() {
        vscode.setState({ search: state.search, status: state.status, scope: state.scope });
    }

    // ------------------------------------------------------------------
    // Filtering
    // ------------------------------------------------------------------

    function matchesStatus(dep) {
        switch (state.status) {
            case 'all': return true;
            case 'attention': return ['missing', 'mismatch', 'outdated', 'major'].indexOf(dep.status) >= 0;
            case 'missing': return dep.status === 'missing' || dep.status === 'mismatch';
            case 'unknown': return dep.status === 'unknown' || dep.status === 'checking';
            default: return dep.status === state.status;
        }
    }

    function visibleDeps(project) {
        var needle = state.search.trim().toLowerCase();
        return project.dependencies.filter(function (dep) {
            if (needle && dep.name.toLowerCase().indexOf(needle) < 0) return false;
            if (state.scope !== 'all' && dep.scope !== state.scope) return false;
            return matchesStatus(dep);
        });
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    function totals() {
        var sum = { total: 0, 'up-to-date': 0, outdated: 0, major: 0, missing: 0, mismatch: 0, unknown: 0, checking: 0 };
        state.projects.forEach(function (project) {
            Object.keys(sum).forEach(function (key) { sum[key] += project.counts[key] || 0; });
        });
        return sum;
    }

    function renderStats() {
        if (!state.projects.length) {
            el.stats.classList.add('hidden');
            return;
        }
        var sum = totals();
        var tiles = [
            { key: 'all', label: 'Dependencies', value: sum.total, cls: '' },
            { key: 'up-to-date', label: 'Up to date', value: sum['up-to-date'], cls: 'ok' },
            { key: 'outdated', label: 'Update available', value: sum.outdated, cls: 'warn' },
            { key: 'major', label: 'Newer major', value: sum.major, cls: 'major' },
            { key: 'missing', label: 'Missing', value: sum.missing + sum.mismatch, cls: 'bad' },
            { key: 'unknown', label: sum.checking ? 'Checking / unknown' : 'Unknown', value: sum.unknown + sum.checking, cls: '' }
        ];
        el.stats.textContent = '';
        tiles.forEach(function (tile) {
            el.stats.appendChild(h('button', {
                type: 'button',
                className: 'stat ' + tile.cls + (state.status === tile.key ? ' active' : ''),
                'aria-pressed': state.status === tile.key ? 'true' : 'false',
                title: 'Show ' + tile.label.toLowerCase(),
                onclick: function () {
                    state.status = tile.key;
                    el.statusFilter.value = tile.key;
                    persist();
                    render();
                }
            }, [h('span', { className: 'num', text: tile.value }), h('span', { className: 'lbl', text: tile.label })]));
        });
        el.stats.classList.remove('hidden');
    }

    function renderToolbar() {
        var anyInstall = state.projects.some(function (p) { return p.canInstall; });
        var anyUpdate = state.projects.some(function (p) { return p.canUpdate; });
        el.installAll.disabled = state.busy || !anyInstall || !state.trusted;
        el.updateAll.disabled = state.busy || !anyUpdate || !state.trusted;
        el.rescan.disabled = state.busy;
        var sum = totals();
        el.subtitle.textContent = state.projects.length
            ? state.projects.length + ' project' + (state.projects.length === 1 ? '' : 's') + ', ' + sum.total + ' dependencies' + (sum.checking ? ' - checking registries...' : '')
            : 'Detect, check, install and update project dependencies';
    }

    function versionCell(value, reference, pending, label) {
        var td = h('td', { className: 'c-ver', 'data-label': label });
        if (pending && !value) {
            td.appendChild(h('span', { className: 'spinner', 'aria-label': 'checking', title: 'Checking the registry' }));
            return td;
        }
        var cls = 'ver' + (!value ? ' muted' : value && reference && value !== reference ? ' newer' : '');
        td.appendChild(h('span', { className: cls, text: value || '-' }));
        return td;
    }

    function primaryCopy(dep) {
        var order = dep.status === 'missing' || dep.status === 'mismatch' ? ['install', 'add']
            : dep.status === 'outdated' ? ['update', 'upgrade']
            : dep.status === 'major' ? ['upgrade', 'update']
            : ['add', 'install'];
        for (var i = 0; i < order.length; i++) {
            for (var j = 0; j < dep.commands.length; j++) {
                if (dep.commands[j].kind === order[i]) return dep.commands[j];
            }
        }
        return dep.commands[0];
    }

    function runButton(dep, command, small) {
        var label = KIND_LABEL[command.kind] || command.label;
        return button(label, (command.kind === 'upgrade' ? 'btn-secondary ' : '') + (small ? 'btn-sm' : 'btn-sm'), function () {
            vscode.postMessage({ type: 'run', depId: dep.id, kind: command.kind });
        }, {
            disabled: state.busy || !state.trusted,
            title: command.label + ': ' + command.line,
            'aria-label': label + ' ' + dep.name
        });
    }

    function commandsRow(dep) {
        var box = h('div');
        dep.commands.forEach(function (command) {
            box.appendChild(h('div', { className: 'cmd' }, [
                h('span', { className: 'cmd-label', text: command.label }),
                h('span', { className: 'cmd-line', text: command.line }),
                button('Copy', 'btn-ghost btn-sm', function () { copy(command.line, command.kind + '_command'); }, { 'aria-label': 'Copy: ' + command.line }),
                command.runnable ? runButton(dep, command, true) : h('span', { className: 'chip', text: 'copy-only', title: command.note || '' }),
                command.note ? h('span', { className: 'cmd-note', text: command.note }) : null
            ]));
        });
        if (dep.manual) {
            box.appendChild(h('div', { className: 'cmd' }, [
                h('span', { className: 'cmd-label', text: 'Manual edit' }),
                h('span', { className: 'cmd-line', text: dep.manual }),
                button('Copy', 'btn-ghost btn-sm', function () { copy(dep.manual, 'manual_edit'); }),
                h('span', { className: 'chip', text: 'copy-only' }),
                h('span', { className: 'cmd-note', text: 'Gradle has no command that edits a build file, so change the version by hand and run the resolve command.' })
            ]));
        }
        if (!box.childNodes.length) {
            box.appendChild(h('div', { className: 'cmd-note', text: 'No command applies: this dependency does not come from a package registry.' }));
        }
        return h('tr', { className: 'cmds' }, [h('td', { colspan: '7' }, [box])]);
    }

    function dependencyRows(dep, tbody) {
        var expanded = Boolean(state.expanded[dep.id]);
        var runnable = dep.commands.filter(function (c) { return c.runnable; });
        var quick = primaryCopy(dep);
        var actions = h('div', { className: 'row-actions' });
        runnable.forEach(function (command) { actions.appendChild(runButton(dep, command)); });
        if (quick) {
            actions.appendChild(button('Copy', 'btn-ghost btn-sm', function () { copy(quick.line, quick.kind + '_command'); }, {
                title: 'Copy: ' + quick.line, 'aria-label': 'Copy ' + quick.label + ' command for ' + dep.name
            }));
        }
        if (dep.commands.length || dep.manual) {
            actions.appendChild(button(expanded ? 'Hide commands' : 'Commands', 'btn-ghost btn-sm', function () {
                state.expanded[dep.id] = !expanded;
                render();
            }, { 'aria-expanded': expanded ? 'true' : 'false' }));
        }

        var reference = dep.installed;
        tbody.appendChild(h('tr', { className: 'dep' }, [
            h('td', { className: 'c-name' }, [
                h('div', { className: 'pkg', text: dep.name }),
                h('div', { className: 'scope', text: dep.scope + ' - ' + dep.source })
            ]),
            h('td', { className: 'c-ver', 'data-label': 'Declared' }, [h('span', { className: 'ver' + (dep.spec ? '' : ' muted'), text: dep.spec || 'any' })]),
            versionCell(dep.installed, null, false, 'Installed'),
            versionCell(dep.compatible, reference, dep.latestPending, 'Latest compatible'),
            versionCell(dep.latest, reference, dep.latestPending, 'Latest'),
            h('td', { className: 'c-status', 'data-label': 'Status' }, [
                h('span', { className: 'status s-' + dep.status, text: STATUS_LABEL[dep.status] || dep.status }),
                h('div', { className: 'detail' }, [richText(dep.detail)])
            ]),
            h('td', { className: 'c-actions' }, [actions])
        ]));
        if (expanded) tbody.appendChild(commandsRow(dep));
    }

    function projectCard(project) {
        var deps = visibleDeps(project);
        var title = (project.folder ? project.folder + ' / ' : '') + (project.relDir === '.' ? '(workspace root)' : project.relDir);
        var toolChip = project.tool.found
            ? h('span', { className: 'chip ok', text: project.tool.name + (project.tool.version ? ' ' + project.tool.version : ''), title: project.tool.location })
            : h('span', { className: 'chip bad', text: project.tool.name + ' not found' });

        var manifestLinks = h('span');
        project.manifests.forEach(function (file, index) {
            if (index) manifestLinks.appendChild(document.createTextNode(', '));
            manifestLinks.appendChild(h('button', {
                type: 'button', className: 'link', text: file, title: 'Open ' + file,
                onclick: function () { vscode.postMessage({ type: 'openManifest', projectId: project.id, file: file }); }
            }));
        });

        var missingCount = (project.counts.missing || 0) + (project.counts.mismatch || 0);
        var actions = h('div', { className: 'project-actions' }, [
            project.canInstall ? button('Install missing (' + missingCount + ')', 'btn-sm', function () {
                vscode.postMessage({ type: 'installMissing', projectId: project.id });
            }, { disabled: state.busy || !state.trusted }) : null,
            project.canUpdate ? button('Update outdated (' + project.counts.outdated + ')', 'btn-secondary btn-sm', function () {
                vscode.postMessage({ type: 'updateOutdated', projectId: project.id, includeProduction: state.includeProd });
            }, { disabled: state.busy || !state.trusted }) : null,
            project.installLines.length ? button('Copy install', 'btn-ghost btn-sm', function () {
                copy(project.installLines.join('\n'), 'project_install_command');
            }, { title: project.installLines.join('\n') }) : null,
            project.updateLine ? button('Copy update', 'btn-ghost btn-sm', function () { copy(project.updateLine, 'project_update_command'); }, { title: project.updateLine }) : null
        ]);

        var card = h('section', { className: 'project', 'aria-label': title }, [
            h('div', { className: 'project-head' }, [
                h('div', { className: 'project-id' }, [
                    h('div', { className: 'project-name' }, [
                        h('span', { text: title }),
                        h('span', { className: 'chip eco', text: ECOSYSTEM_LABEL[project.ecosystem] || project.ecosystem }),
                        h('span', { className: 'chip', text: project.manager }),
                        toolChip
                    ]),
                    h('div', { className: 'project-meta' }, [
                        'Detected by ' + project.detectedBy + ' - Manifests: ',
                        manifestLinks
                    ])
                ]),
                actions
            ])
        ]);

        if (!project.tool.found && project.tool.hint) {
            card.appendChild(h('div', { className: 'notice bad' }, [richText(project.tool.hint)]));
        }
        project.warnings.forEach(function (warning) {
            card.appendChild(h('div', { className: 'notice' }, [richText(warning)]));
        });
        if (project.manualUpdates && (project.counts.outdated || project.counts.major)) {
            card.appendChild(h('div', { className: 'notice' }, [richText(
                'Upgrading ' + (ECOSYSTEM_LABEL[project.ecosystem] || project.ecosystem) + ' dependencies means editing the build file, so those commands are copy-only and never run automatically.'
            )]));
        }

        if (!project.dependencies.length) {
            card.appendChild(h('div', { className: 'empty', text: 'No dependencies are declared in this project.' }));
            return card;
        }
        if (!deps.length) {
            card.appendChild(h('div', { className: 'empty', text: 'No dependencies match the current filters.' }));
            return card;
        }

        var tbody = h('tbody');
        deps.forEach(function (dep) { dependencyRows(dep, tbody); });
        card.appendChild(h('table', {}, [
            h('thead', {}, [h('tr', {}, ['Package', 'Declared', 'Installed', 'Latest compatible', 'Latest', 'Status', ''].map(function (name) {
                return h('th', { scope: 'col', text: name });
            }))]),
            tbody
        ]));
        return card;
    }

    function renderProjects() {
        var fragment = document.createDocumentFragment();
        state.projects.forEach(function (project) { fragment.appendChild(projectCard(project)); });
        el.projects.textContent = '';
        el.projects.appendChild(fragment);
    }

    function renderJob() {
        var job = state.job;
        if (!job) {
            el.job.classList.add('hidden');
            return;
        }
        el.job.className = 'job ' + job.state;
        el.job.textContent = '';
        var running = job.state === 'running';
        var head = h('div', { className: 'job-head' }, [
            running ? h('span', { className: 'spinner', 'aria-hidden': 'true' }) : null,
            h('span', { className: 'job-title', text: job.title + (running && job.steps > 1 ? ' - step ' + job.step + ' of ' + job.steps : '') }),
            running
                ? button('Cancel', 'btn-danger btn-sm', function () { vscode.postMessage({ type: 'cancel' }); })
                : h('span', { className: 'chip ' + (job.state === 'success' ? 'ok' : 'bad'), text: job.state === 'success' ? 'Succeeded' : job.state === 'cancelled' ? 'Cancelled' : 'Failed' }),
            button('Output log', 'btn-ghost btn-sm', function () { vscode.postMessage({ type: 'showLog' }); }),
            running ? null : button('Dismiss', 'btn-ghost btn-sm', function () { state.job = null; state.log = ''; renderJob(); })
        ]);
        el.job.appendChild(head);
        if (job.command) el.job.appendChild(h('div', { className: 'job-cmd', text: '$ ' + job.command }));
        if (running) el.job.appendChild(h('div', { className: 'progress', role: 'progressbar', 'aria-label': 'Running' }));
        if (job.message) el.job.appendChild(h('div', { className: 'job-msg' }, [richText(job.message)]));
        if (state.log) {
            var log = h('pre', { className: 'job-log', text: state.log });
            el.job.appendChild(log);
            log.scrollTop = log.scrollHeight;
        }
        el.job.classList.remove('hidden');
    }

    function render() {
        renderToolbar();
        renderStats();
        if (state.phase === 'local' || state.phase === 'done') renderProjects();
        renderJob();
    }

    function showBanner(message, kind) {
        el.banner.className = 'banner ' + (kind || '');
        el.banner.textContent = '';
        el.banner.appendChild(h('span', { className: 'text' }, [richText(message)]));
        el.banner.appendChild(button('Dismiss', 'btn-ghost btn-sm', function () { el.banner.classList.add('hidden'); }));
    }

    function showLoading(message) {
        el.projects.textContent = '';
        el.projects.appendChild(h('div', { className: 'loading' }, [h('span', { className: 'spinner' }), h('span', { text: message })]));
    }

    // ------------------------------------------------------------------
    // Host messages
    // ------------------------------------------------------------------

    window.addEventListener('message', function (event) {
        var message = event.data || {};
        switch (message.type) {
            case 'scanning':
                if (!state.projects.length) showLoading(message.message);
                else el.subtitle.textContent = message.message;
                break;
            case 'empty':
                state.projects = [];
                state.phase = 'empty';
                el.projects.textContent = '';
                el.projects.appendChild(h('div', { className: 'empty', text: message.message }));
                render();
                break;
            case 'error':
                showBanner(message.message, 'error');
                if (!state.projects.length) el.projects.textContent = '';
                break;
            case 'projects':
                state.projects = message.projects || [];
                state.phase = message.phase;
                state.busy = Boolean(message.busy);
                state.trusted = message.trusted !== false;
                if (!state.trusted) showBanner('This workspace is not trusted, so installs and updates are disabled. Commands can still be copied.', 'error');
                render();
                break;
            case 'busy':
                state.busy = Boolean(message.busy);
                render();
                break;
            case 'job':
                if (message.state === 'running' && (!state.job || state.job.state !== 'running' || state.job.step !== message.step)) state.log = '';
                state.job = message;
                renderJob();
                break;
            case 'log':
                state.log = (state.log + message.text).slice(-20000);
                renderJob();
                break;
            case 'toast':
                toast(message.message, message.kind);
                break;
            case 'banner':
                showBanner(message.message, message.kind);
                break;
        }
    });

    // ------------------------------------------------------------------
    // Controls
    // ------------------------------------------------------------------

    el.search.value = state.search;
    el.statusFilter.value = state.status;
    el.scopeFilter.value = state.scope;

    el.rescan.addEventListener('click', function () {
        el.banner.classList.add('hidden');
        vscode.postMessage({ type: 'rescan', refresh: true });
    });
    el.installAll.addEventListener('click', function () { vscode.postMessage({ type: 'installMissing' }); });
    el.updateAll.addEventListener('click', function () {
        vscode.postMessage({ type: 'updateOutdated', includeProduction: state.includeProd });
    });
    el.includeProd.addEventListener('change', function () { state.includeProd = el.includeProd.checked; });
    el.showLog.addEventListener('click', function () { vscode.postMessage({ type: 'showLog' }); });

    var searchTimer;
    el.search.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            state.search = el.search.value;
            persist();
            render();
        }, 120);
    });
    el.statusFilter.addEventListener('change', function () { state.status = el.statusFilter.value; persist(); render(); });
    el.scopeFilter.addEventListener('change', function () { state.scope = el.scopeFilter.value; persist(); render(); });

    vscode.postMessage({ type: 'ready' });
})();
