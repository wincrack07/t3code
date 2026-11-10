import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import * as Dialog from "../../components/ui/Dialog";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";

/** `/polish`: rewrites the draft on the environment's text model. */
export function usePromptPolish(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly draftKey: string;
  readonly onChangeDraftMessage: (value: string) => void;
}) {
  const { environmentId, projectId, draftKey, onChangeDraftMessage } = input;
  const available = useAtomValue(serverEnvironment.polishPrompt.permissionAtom(environmentId));
  const run = useAtomCommand(serverEnvironment.polishPrompt, {
    label: "prompt polish",
    reportFailure: false,
  });

  const polish = async (original: string) => {
    if (original.trim().length === 0) return;
    const result = await run({
      environmentId,
      input: { prompt: original, ...(projectId ? { projectId } : {}) },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        "Could not polish the prompt",
        error instanceof Error ? error.message : undefined,
      );
      return;
    }
    // The draft may have changed while the model ran; the newer text wins.
    if (getComposerDraftSnapshot(draftKey).text !== original) return;
    onChangeDraftMessage(result.value.prompt);
  };

  return { available, polish };
}
