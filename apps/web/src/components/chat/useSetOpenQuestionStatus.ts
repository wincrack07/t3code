import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { OpenQuestionsUpdate, ScopedThreadRef } from "@t3tools/contracts";

import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** Records answered, dismissed, or reopened questions; toasts and returns false on failure. */
export function useSetOpenQuestionStatus() {
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  return async (
    threadRef: ScopedThreadRef,
    openQuestions: OpenQuestionsUpdate,
    failureTitle: string,
  ): Promise<boolean> => {
    const result = await updateMetadata({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, openQuestions },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failureTitle,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return false;
    }
    return true;
  };
}
