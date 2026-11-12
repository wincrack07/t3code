export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 980px)";

export const RIGHT_PANEL_MIN_WIDTH = 360;
/** The narrowest chat that stays readable; panes give way before the chat goes under it. */
export const CHAT_MIN_WIDTH = 480;
/** A split column whose panel is open inline, so the panel never turns into a window-wide sheet. */
export const PANEL_COLUMN_MIN_WIDTH = CHAT_MIN_WIDTH + RIGHT_PANEL_MIN_WIDTH;

export type ThreadPanelPresentation = "inline" | "popover";
