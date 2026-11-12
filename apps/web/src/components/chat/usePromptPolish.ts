import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type RefObject, useState } from "react";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";

/** `/polish` and the composer's polish button: rewrite the draft on the environment's text model, with an undo. */
export function usePromptPolish(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly promptRef: RefObject<string>;
  /** The caller shows the rewrite for review, so success needs no toast or undo. */
  readonly reviewsResult?: boolean;
}) {
  const { environmentId, projectId, promptRef, reviewsResult = false } = input;
  const available = useAtomValue(serverEnvironment.polishPrompt.permissionAtom(environmentId));
  const run = useAtomCommand(serverEnvironment.polishPrompt, { reportFailure: false });
  const [running, setRunning] = useState(false);

  /** `replaceDraft` swaps the whole draft only while it still reads `expected`. */
  const polish = async (replaceDraft: (expected: string, next: string) => boolean) => {
    const original = promptRef.current;
    if (original.trim().length === 0) return;
    const toastId = toastManager.add({ type: "loading", title: "Polishing prompt..." });
    setRunning(true);
    const result = await run({
      environmentId,
      input: { prompt: original, ...(projectId ? { projectId } : {}) },
    });
    setRunning(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        toastManager.close(toastId);
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.update(toastId, {
        type: "error",
        title: "Could not polish the prompt",
        description: error instanceof Error ? error.message : undefined,
      });
      return;
    }
    const polished = result.value.prompt;
    // The draft may have changed, or the composer moved to another thread, while the model ran.
    if (!replaceDraft(original, polished)) {
      toastManager.update(toastId, {
        type: "warning",
        title: "Prompt not polished",
        description: "The draft changed while the rewrite was running.",
      });
      return;
    }
    if (reviewsResult) {
      toastManager.close(toastId);
      return;
    }
    toastManager.update(toastId, {
      type: "success",
      title: polished === original ? "Prompt already clear" : "Prompt polished",
      ...(polished === original
        ? {}
        : {
            actionProps: {
              children: "Undo",
              onClick: () => {
                replaceDraft(polished, original);
                toastManager.close(toastId);
              },
            },
          }),
    });
  };

  return { available, running, polish };
}
