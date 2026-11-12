import type { StateStorage } from "./lib/storage";

const viewKeys = new Set([
  "t3code:sidebar:nested-expanded",
  "t3code:ui-view-state",
  "t3code:thread-columns:v1",
  "t3code:right-panel-state:v2",
  "t3code:diff-panel-state:v1",
  "t3code:terminal-state:v1",
  "t3code:closed-views:v2",
  "chat_thread_sidebar_open",
  "chat_thread_sidebar_width",
  "t3code:window-route",
  "t3code:sidebar-scroll",
]);

export function windowStorageKey(
  key: string,
  windowId = typeof window === "undefined" ? undefined : window.desktopBridge?.windowId,
): string {
  return windowId && windowId !== "main" && viewKeys.has(key) ? `${key}:window:${windowId}` : key;
}

export function windowStorage(storage: StateStorage): StateStorage {
  return {
    getItem: (key) => storage.getItem(windowStorageKey(key)),
    setItem: (key, value) => storage.setItem(windowStorageKey(key), value),
    removeItem: (key) => storage.removeItem(windowStorageKey(key)),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function mergeStoredChanges(previous: unknown, next: unknown, current: unknown): unknown {
  if (JSON.stringify(previous) === JSON.stringify(next)) return current;
  if (!record(next) || (!record(current) && !record(previous))) return next;
  const prior = record(previous) ? previous : {};
  // A deleted record still needs a field-level merge so stale fields cannot resurrect it.
  const latest = record(current) ? current : {};
  const result = { ...latest };
  for (const key of new Set([...Object.keys(prior), ...Object.keys(next)])) {
    if (!(key in next)) {
      delete result[key];
      continue;
    }
    result[key] = mergeStoredChanges(prior[key], next[key], latest[key]);
  }
  return result;
}

export function mergingStorage(storage: Storage): Storage {
  const snapshots = new Map<string, unknown>();
  return {
    get length() {
      return storage.length;
    },
    key: (index) => storage.key(index),
    clear: () => storage.clear(),
    getItem: (key) => {
      const raw = storage.getItem(key);
      snapshots.set(key, raw === null ? {} : JSON.parse(raw));
      return raw;
    },
    removeItem: (key) => {
      snapshots.delete(key);
      storage.removeItem(key);
    },
    setItem: (key, raw) => {
      const next: unknown = JSON.parse(raw);
      const current = storage.getItem(key);
      const merged = mergeStoredChanges(
        snapshots.get(key) ?? {},
        next,
        current === null ? {} : JSON.parse(current),
      );
      storage.setItem(key, JSON.stringify(merged));
      snapshots.set(key, next);
    },
  };
}
