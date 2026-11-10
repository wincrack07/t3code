import { useSyncExternalStore } from "react";

import { observeResize } from "../lib/observeResize";
import {
  CHAT_MIN_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY,
} from "../rightPanelLayout";
import { useMediaQuery } from "./useMediaQuery";

export function useRightPanelSheet(container: HTMLElement | null) {
  const viewportSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  // React compares this boolean snapshot; resizing within a presentation never re-renders the chat.
  return useSyncExternalStore(
    (notify) => (container ? observeResize(container, notify) : () => {}),
    () =>
      container ? container.clientWidth < CHAT_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH : viewportSheet,
    () => true,
  );
}
