import { msg, T } from "gt-react";
import { FolderInputIcon } from "lucide-react";

import { m, type MessageResolver } from "~/i18n/messages";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** A move requested while the thread works waits for the turn to end; cancel withdraws it. */
export function pendingProjectMoveBannerItem(
  input: {
    readonly targetTitle: string;
    readonly onCancel: () => void;
  },
  resolve: MessageResolver = m,
): ComposerBannerStackItem {
  return {
    id: "project-move-pending",
    variant: "info",
    icon: <FolderInputIcon />,
    title: resolve(msg("Moves to {targetTitle} when this turn finishes"), {
      targetTitle: input.targetTitle,
    }),
    actions: (
      <Button size="xs" variant="ghost" onClick={input.onCancel}>
        <T>Cancel</T>
      </Button>
    ),
  };
}
