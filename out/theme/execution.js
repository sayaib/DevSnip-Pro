"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXECUTION_CSS = exports.EXECUTION_RUNTIME = void 0;
/** Presentation only: callers supply states from their actual execution lifecycle. */
exports.EXECUTION_RUNTIME = `(function () {
  // Remember receipts beyond DOM replacement (scanner panels rebuild their hosts).
  var seen = new Map();
  var motions = new WeakMap();
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced.addEventListener('change', function () {
    if (reduced.matches) document.getAnimations().forEach(function (animation) {
      if (animation.id === 'ds-result-motion') animation.cancel();
    });
  });
  window.DevSnipExecution = function (host, state, text, at) {
    if (!host) return;
    var old = host.querySelector(':scope > .ds-execution');
    var bar = old || document.createElement('div');
    bar.className = 'ds-execution';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.setAttribute('data-state', state);
    var date = at ? new Date(at) : null;
    var validDate = date && !isNaN(date.getTime());
    var key = validDate ? String(date.getTime()) : '';
    var identity = host.id || host.getAttribute('class') || host.tagName;
    var fresh = state === 'completed' && !!key && Number(key) > (seen.get(identity) || 0);
    bar.setAttribute('data-fresh', String(fresh));
    if (state !== 'running' && key) {
      seen.set(identity, Math.max(Number(key), seen.get(identity) || 0));
      host.dataset.dsFinished = key;
    }
    var previous = motions.get(host);
    if (previous) { previous.forEach(function (a) { a.cancel(); }); motions.delete(host); }
    // Reserve existing space while waiting; a skeleton never replaces real data.
    if (state === 'running' && !host.dataset.dsReserved && host.id === 'results') {
      host.dataset.dsReserved = 'true';
      host.dataset.dsHeight = String(host.getBoundingClientRect().height);
      host.style.minHeight = Math.min(480, Number(host.dataset.dsHeight)) + 'px';
    }
    if (state !== 'running' && host.dataset.dsReserved) {
      host.style.minHeight = '';
      delete host.dataset.dsReserved;
    }
    bar.textContent = text;
    if (validDate) {
      var time = document.createElement('time');
      time.dateTime = new Date(at).toISOString();
      time.textContent = new Date(at).toLocaleTimeString();
      time.title = new Date(at).toLocaleString();
      bar.appendChild(time);
    }
    if (!old) host.prepend(bar);
    host.setAttribute('aria-busy', String(state === 'running'));
    if (fresh && !reduced.matches && host.animate) {
      var animations = [];
      motions.set(host, animations);
      queueMicrotask(function () {
      if (reduced.matches || !host.isConnected || motions.get(host) !== animations) return;
      // Animate a bounded number of output blocks, never individual table rows.
      var targets = Array.prototype.filter.call(host.children, function (node) {
        return node !== bar && !node.hidden;
      }).slice(0, 8);
      targets.forEach(function (node) {
        var animation = node.animate([
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' });
        animation.id = 'ds-result-motion';
        animations.push(animation);
      });
      var before = Number(host.dataset.dsHeight);
      delete host.dataset.dsHeight;
      // Only content-sized toolkit panels change height; scroll panes keep their layout.
      if (host.id === 'results' && before > 0 && before < 1200) queueMicrotask(function () {
        if (reduced.matches || !host.isConnected || motions.get(host) !== animations) return;
        var after = host.getBoundingClientRect().height;
        if (after >= 1200 || Math.abs(before - after) < 2) return;
        var resize = host.animate([{ height: before + 'px', overflow: 'clip' }, { height: after + 'px', overflow: 'clip' }],
          { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' });
        resize.id = 'ds-result-motion';
        animations.push(resize);
      });
      });
    }
  };
})();`;
exports.EXECUTION_CSS = `
.ds-execution { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-bottom: 12px; border: 1px solid var(--vscode-panel-border, #8885); border-left: 3px solid var(--vscode-textLink-foreground, #3794ff); border-radius: 8px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-size: 12px; line-height: 1.5; }
.ds-execution time { margin-left: auto; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
.ds-execution[data-state="completed"] { border-left-color: var(--vscode-testing-iconPassed, #3fb950);  }
.ds-execution[data-fresh="true"] { animation: ds-result-arrive .4s ease-out; }
.ds-execution[data-fresh="true"]::before { content: "✓"; color: var(--vscode-testing-iconPassed, #3fb950); font-weight: 700; animation: ds-success .25s ease-out; }
.ds-execution[data-state="running"] { background: var(--vscode-textCodeBlock-background, transparent); }
:where(#results, #responseScroll, .content, .job) :where(button, .btn) { transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease; }
@media (hover: hover) {
  :where(#results, #responseScroll, .content, .job) button:not(:disabled):hover { box-shadow: 0 0 0 1px var(--vscode-focusBorder, #3794ff); }
}
@keyframes ds-success { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: scale(1); } }
.ds-execution[data-state="failed"] { border-left-color: var(--vscode-errorForeground, #f14c4c); }
.ds-execution[data-state="running"]::before { content: ''; width: 12px; height: 12px; flex: none; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: ds-execution-spin .8s linear infinite; }
@keyframes ds-execution-spin { to { transform: rotate(360deg); } }
@keyframes ds-result-arrive { from { opacity: .6; background: var(--vscode-editor-findMatchHighlightBackground, #3794ff22); transform: translateY(3px); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .ds-execution, .ds-execution::before { animation: none !important; } }
`;
//# sourceMappingURL=execution.js.map