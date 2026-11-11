import {
  prefersReducedMotion,
  subscribeReducedMotion,
} from "@t3tools/client-runtime/reduced-motion";
import { useSyncExternalStore } from "react";

/** Appearance -> Motion resolved against the OS; see @t3tools/client-runtime/reduced-motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}
