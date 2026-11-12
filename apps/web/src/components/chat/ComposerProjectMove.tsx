import { FolderInputIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** A move requested while the thread works waits for the turn to end; cancel withdraws it. */
export function pendingProjectMoveBannerItem(input: {
  readonly targetTitle: string;
  readonly onCancel: () => void;
}): ComposerBannerStackItem {
  return {
    id: "project-move-pending",
    variant: "info",
    icon: <FolderInputIcon />,
    title: `Moves to ${input.targetTitle} when this turn finishes`,
    actions: (
      <Button size="xs" variant="ghost" onClick={input.onCancel}>
        Cancel
      </Button>
    ),
  };
}
