"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onSidebarUpdate = exports.publishSidebarUpdate = exports.sidebarUpdate = void 0;
let current;
const listeners = new Set();
function sidebarUpdate() { return current; }
exports.sidebarUpdate = sidebarUpdate;
function publishSidebarUpdate(update) {
    current = update;
    for (const listener of listeners)
        listener();
}
exports.publishSidebarUpdate = publishSidebarUpdate;
function onSidebarUpdate(listener) {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
}
exports.onSidebarUpdate = onSidebarUpdate;
//# sourceMappingURL=sidebar.js.map