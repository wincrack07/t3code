import type { MotionPreference } from "@t3tools/contracts/settings";

/**
 * The root element's `data-motion` holds the resolved choice, "reduce" or "full". CSS and JS
 * read it instead of `prefers-reduced-motion`, so Appearance -> Motion can override the OS.
 * index.html sets it before first paint from MOTION_PREFERENCE_STORAGE_KEY.
 */
export const MOTION_PREFERENCE_STORAGE_KEY = "t3code:motion-preference";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function resolveReducedMotion(
  preference: MotionPreference,
  systemPrefersReduced: boolean,
): boolean {
  if (preference === "reduced") return true;
  if (preference === "full") return false;
  return systemPrefersReduced;
}

function systemPrefersReducedMotion(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

export function prefersReducedMotion(): boolean {
  const resolved = globalThis.document?.documentElement?.dataset?.motion;
  if (resolved === "reduce") return true;
  if (resolved === "full") return false;
  return systemPrefersReducedMotion();
}

const listeners = new Set<() => void>();

export function subscribeReducedMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let stopFollowingSystem: (() => void) | null = null;

/** Writes the resolved preference onto the root and, for "system", follows OS changes. */
export function applyMotionPreference(preference: MotionPreference): void {
  const root = document.documentElement;
  stopFollowingSystem?.();
  stopFollowingSystem = null;
  const write = () => {
    const next = resolveReducedMotion(preference, systemPrefersReducedMotion()) ? "reduce" : "full";
    if (root.dataset.motion === next) return;
    root.dataset.motion = next;
    for (const listener of listeners) listener();
  };
  if (preference === "system") {
    const media = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
    media?.addEventListener("change", write);
    stopFollowingSystem = () => media?.removeEventListener("change", write);
  }
  write();
}
