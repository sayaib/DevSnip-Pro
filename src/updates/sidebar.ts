/** Live update state shared with the Tools sidebar, including the browser build. */
export interface SidebarUpdate { version: string; preview?: boolean }
let current: SidebarUpdate | undefined;
const listeners = new Set<() => void>();
export function sidebarUpdate(): SidebarUpdate | undefined { return current; }
export function publishSidebarUpdate(update: SidebarUpdate | undefined): void {
  current = update;
  for (const listener of listeners) listener();
}
export function onSidebarUpdate(listener: () => void): { dispose(): void } {
  listeners.add(listener);
  return { dispose: () => { listeners.delete(listener); } };
}
