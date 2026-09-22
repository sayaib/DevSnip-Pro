"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installVscodeStub = exports.createExtensionContext = exports.createMemento = exports.shownMessages = exports.registeredCommands = void 0;
/**
 * Test helpers for running extension logic without launching VS Code.
 */
const vscode_shim_1 = require("./vscode-shim");
Object.defineProperty(exports, "registeredCommands", { enumerable: true, get: function () { return vscode_shim_1.registeredCommands; } });
Object.defineProperty(exports, "shownMessages", { enumerable: true, get: function () { return vscode_shim_1.shownMessages; } });
/** In-memory Memento that round-trips through JSON, like the real global state. */
function createMemento(seed = {}) {
    const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
    return {
        get(key, defaultValue) {
            const raw = store.get(key);
            return raw === undefined ? defaultValue : JSON.parse(raw);
        },
        async update(key, value) {
            if (value === undefined)
                store.delete(key);
            else
                store.set(key, JSON.stringify(value));
        },
        keys() {
            return [...store.keys()];
        }
    };
}
exports.createMemento = createMemento;
function createExtensionContext(seed = {}) {
    return {
        subscriptions: [],
        globalState: createMemento(seed),
        workspaceState: createMemento(),
        extensionPath: process.cwd()
    };
}
exports.createExtensionContext = createExtensionContext;
/** Points `require("vscode")` at the shim for the rest of the process. */
function installVscodeStub() {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const Module = require("module");
    /* eslint-enable @typescript-eslint/no-var-requires */
    const shimPath = require.resolve("./vscode-shim");
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        if (request === "vscode")
            return shimPath;
        return originalResolve.call(this, request, ...rest);
    };
}
exports.installVscodeStub = installVscodeStub;
//# sourceMappingURL=vscode-stub.js.map