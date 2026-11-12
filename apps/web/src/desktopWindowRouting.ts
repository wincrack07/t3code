import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { AppRouter } from "./router";
import { useThreadColumnsStore } from "./threadColumnsStore";

const leasePrefix = "t3code:preview-owner:";
const leaseChanged = "t3code:preview-owner-changed";
export function previewOwner(key: string): string | null {
  try {
    return localStorage.getItem(leasePrefix + key);
  } catch {
    return null;
  }
}
export function claimPreview(key: string): void {
  const id = window.desktopBridge?.windowId;
  if (!id) return;
  localStorage.setItem(leasePrefix + key, id);
  window.dispatchEvent(new Event(leaseChanged));
}
export function subscribePreviewOwner(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(leaseChanged, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(leaseChanged, listener);
  };
}

export function startDesktopWindowRouting(router: AppRouter): void {
  const bridge = window.desktopBridge;
  if (!bridge?.reportWindowThreads) return;
  const routeRef = (path: string) => {
    const parts = path.split(/[?#]/, 1)[0]?.split("/");
    if (parts?.length !== 3) return null;
    return parseScopedThreadKey(
      `${decodeURIComponent(parts[1]!)}:${decodeURIComponent(parts[2]!)}`,
    );
  };
  const report = () => {
    const current = routeRef(router.state.location.pathname);
    const keys = useThreadColumnsStore
      .getState()
      .columns.map((column) => scopedThreadKey(column.threadRef));
    if (current) {
      keys.push(scopedThreadKey(current));
      if (document.hasFocus()) claimPreview(scopedThreadKey(current));
    }
    void bridge.reportWindowThreads?.([...new Set(keys)]);
  };
  router.history.block({
    enableBeforeUnload: false,
    blockerFn: async ({ nextLocation }) => {
      const ref = routeRef(nextLocation.pathname);
      return ref ? ((await bridge.focusThread?.(scopedThreadKey(ref))) ?? false) : false;
    },
  });
  bridge.onMenuAction((action) => {
    if (!action.startsWith("focus-thread:")) return;
    const ref = parseScopedThreadKey(action.slice("focus-thread:".length));
    if (!ref) return;
    useThreadColumnsStore.getState().navigate(ref);
    router.history.push(
      `/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`,
      undefined,
      { ignoreBlocker: true },
    );
  });
  router.subscribe("onResolved", report);
  useThreadColumnsStore.subscribe(report);
  window.addEventListener("focus", report);
  window.addEventListener("beforeunload", () => {
    const id = bridge.windowId;
    for (const column of useThreadColumnsStore.getState().columns) {
      const key = scopedThreadKey(column.threadRef);
      if (previewOwner(key) === id) localStorage.removeItem(leasePrefix + key);
    }
  });
  report();
}
