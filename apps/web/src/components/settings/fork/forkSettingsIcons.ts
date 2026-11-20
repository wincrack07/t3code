import type { ComponentType } from "react";
import {
  DatabaseBackupIcon,
  GaugeIcon,
  LaptopIcon,
  PlugIcon,
  TextCursorInputIcon,
  ToggleRightIcon,
} from "lucide-react";

import { PullRequestGlyph } from "../../pullRequest/pullRequestIcons";
import type { ForkSettingsPath } from "./forkSettings";

export const FORK_SETTINGS_SECTION_ICONS: Readonly<
  Record<ForkSettingsPath, ComponentType<{ className?: string }>>
> = {
  "/settings/fork/features": ToggleRightIcon,
  "/settings/fork/composer": TextCursorInputIcon,
  "/settings/fork/chats": DatabaseBackupIcon,
  "/settings/fork/pr-reviews": PullRequestGlyph.pullRequest,
  "/settings/fork/machine": LaptopIcon,
  "/settings/fork/monitor": GaugeIcon,
  "/settings/fork/mcp": PlugIcon,
};
