/**
 * Test helpers for running extension logic without launching VS Code.
 */
import { registeredCommands, shownMessages } from "./vscode-shim";

export { registeredCommands, shownMessages };

export interface MemoryState {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

/** In-memory Memento that round-trips through JSON, like the real global state. */
export function createMemento(seed: Record<string, unknown> = {}): MemoryState {
  const store = new Map<string, string>(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      const raw = store.get(key);
      return raw === undefined ? defaultValue : (JSON.parse(raw) as T);
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) store.delete(key);
      else store.set(key, JSON.stringify(value));
    },
    keys(): readonly string[] {
      return [...store.keys()];
    }
  };
}

export function createExtensionContext(seed: Record<string, unknown> = {}): any {
  return {
    subscriptions: [] as { dispose(): void }[],
    globalState: createMemento(seed),
    workspaceState: createMemento(),
    extensionPath: process.cwd()
  };
}

/** Points `require("vscode")` at the shim for the rest of the process. */
export function installVscodeStub(): void {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const Module = require("module");
  /* eslint-enable @typescript-eslint/no-var-requires */
  const shimPath = require.resolve("./vscode-shim");
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: any[]) {
    if (request === "vscode") return shimPath;
    return originalResolve.call(this, request, ...rest);
  };
}
