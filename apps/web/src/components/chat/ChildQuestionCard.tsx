import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  derivePendingThreadRequests,
  seedUserInputDraftAnswers,
} from "@t3tools/client-runtime/state/thread-requests";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { derivePendingUserInputProgress } from "../../pendingUserInput";
import { derivePendingUserInputs, type PendingUserInput } from "../../session-logic";
import { useQuietThreadProjection } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

/** A subagent's question, answered from its parent so the subagent continues without opening it. */
export function ChildQuestionCard({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  // Loaded only while the card is open, so a waiting subagent costs nothing until asked.
  const projection = useQuietThreadProjection(threadRef)?.projection ?? null;
  const prompt =
    projection === null
      ? null
      : (derivePendingUserInputs(derivePendingThreadRequests(projection).userInputs)[0] ?? null);
  if (prompt === null) return null;
  return <ChildQuestionForm key={prompt.requestId} threadRef={threadRef} prompt={prompt} />;
}

function ChildQuestionForm({
  threadRef,
  prompt,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly prompt: PendingUserInput;
}) {
  const respond = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismiss = useAtomCommand(threadEnvironment.dismissUserInput, { reportFailure: false });
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [responding, setResponding] = useState(false);
  const answers = seedUserInputDraftAnswers(prompt.questions, drafts);
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const question = progress.activeQuestion;
  const canRespond = prompt.responseCapability !== "not_resumable";

  const reportFailure = (result: Awaited<ReturnType<typeof respond>>, title: string) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      ...(error instanceof Error ? { description: error.message } : {}),
    });
  };

  // On success the request resolves and this card unmounts, so only a failure re-enables it.
  const submit = async () => {
    const resolved = buildPendingUserInputAnswers(prompt.questions, answers);
    if (resolved === null || responding) return;
    setResponding(true);
    const result = await respond({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId: prompt.requestId, answers: resolved },
    });
    if (result._tag === "Failure") setResponding(false);
    reportFailure(result, "Could not send your answer");
  };

  const advance = () => {
    if (!canRespond || !progress.canAdvance) return;
    if (progress.isLastQuestion) void submit();
    else setQuestionIndex(progress.questionIndex + 1);
  };

  const onDismiss = async () => {
    if (responding) return;
    setResponding(true);
    const result = await dismiss({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, requestId: prompt.requestId },
    });
    if (result._tag === "Failure") setResponding(false);
    reportFailure(result, "Could not dismiss the question");
  };

  const updateDraft = (
    questionId: string,
    update: (
      draft: PendingUserInputDraftAnswer | undefined,
      target: PendingUserInput["questions"][number],
    ) => PendingUserInputDraftAnswer,
  ) => {
    const target = prompt.questions.find((entry) => entry.id === questionId);
    if (!target) return;
    setDrafts((existing) => ({ ...existing, [questionId]: update(answers[questionId], target) }));
  };

  const disabled = !canRespond || responding;
  return (
    <ComposerBanner.Root detached variant="info">
      <ComposerPendingUserInputPanel
        pendingUserInputs={[prompt]}
        cwd={undefined}
        threadRef={threadRef}
        disabled={!canRespond}
        respondingRequestIds={responding ? [prompt.requestId] : []}
        answers={answers}
        questionIndex={progress.questionIndex}
        onToggleOption={(questionId, optionValue) =>
          updateDraft(questionId, (draft, target) =>
            togglePendingUserInputOptionSelection(target, draft, optionValue),
          )
        }
        onAdvance={advance}
        onDismiss={() => void onDismiss()}
      />
      {question ? (
        <form
          className="flex items-center gap-2 px-4 pt-1 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            advance();
          }}
        >
          {question.allowCustomAnswer === false ? (
            <span className="flex-1" />
          ) : (
            <div className="min-w-0 flex-1">
              <Input
                size="sm"
                aria-label="Your answer"
                placeholder="Or type your answer"
                value={progress.customAnswer}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.target.value;
                  updateDraft(question.id, (draft, target) =>
                    setPendingUserInputCustomAnswer(target, draft, value),
                  );
                }}
              />
            </div>
          )}
          <Button type="submit" size="xs" disabled={disabled || !progress.canAdvance}>
            {responding ? "Sending..." : progress.isLastQuestion ? "Send" : "Next"}
          </Button>
        </form>
      ) : null}
    </ComposerBanner.Root>
  );
}
