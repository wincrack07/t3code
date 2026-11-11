import { openQuestionLabel, runOpenQuestions } from "@t3tools/client-runtime/state/open-questions";
import {
  AuthOrchestrationOperateScope,
  type OpenQuestion,
  type RunId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { CheckIcon, CircleDotIcon, MinusIcon } from "lucide-react";
import { use } from "react";

import { showOpenQuestion } from "../../openQuestionDeckStore";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { TimelineRowCtx } from "./timelineRowContext";
import { useSetOpenQuestionStatus } from "./useSetOpenQuestionStatus";

/**
 * The questions this run left for the user, as a quiet record under its final reply.
 * They are answered in the card above the composer; an open one brings itself up there.
 */
export function OpenQuestionCards({ runId }: { readonly runId: RunId }) {
  const ctx = use(TimelineRowCtx);
  const questions = runOpenQuestions(useThreadShell(ctx.threadRef)?.openQuestions, runId);
  if (questions.length === 0 || ctx.threadRef === null) return null;
  return <OpenQuestionList threadRef={ctx.threadRef} questions={questions} />;
}

const STATUS_LABEL: Record<Exclude<OpenQuestion["status"], "open">, string> = {
  answered: "Answered",
  dismissed: "Dismissed",
  resolved: "Resolved",
};

function OpenQuestionList(props: {
  readonly threadRef: ScopedThreadRef;
  readonly questions: ReadonlyArray<OpenQuestion>;
}) {
  const { threadRef } = props;
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const setStatus = useSetOpenQuestionStatus();

  return (
    <ul aria-label="Open questions" className="mt-2 flex flex-col gap-0.5 text-sm">
      {props.questions.map((question) => {
        const open = question.status === "open";
        const label = openQuestionLabel(question.text);
        return (
          <li
            key={question.id}
            data-open-question={question.id}
            data-status={question.status}
            className="flex min-w-0 items-center gap-2 text-muted-foreground"
          >
            {open ? (
              <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-info-foreground" />
            ) : question.status === "answered" ? (
              <CheckIcon aria-hidden className="size-3.5 shrink-0 text-success" />
            ) : (
              <MinusIcon aria-hidden className="size-3.5 shrink-0" />
            )}
            {open && canOperate ? (
              <Button
                size="xs"
                variant="ghost"
                className="-ms-2 min-w-0"
                onClick={() => showOpenQuestion(threadRef, question.id)}
              >
                <span className="truncate">{label}</span>
              </Button>
            ) : (
              <span className="min-w-0 truncate" data-thread-find-text="true">
                {label}
              </span>
            )}
            <span className="min-w-0 shrink truncate text-xs">
              {open
                ? "Open"
                : question.status === "answered" && question.answer
                  ? `→ ${question.answer}`
                  : STATUS_LABEL[question.status]}
            </span>
            {!open && canOperate ? (
              <Button
                size="xs"
                variant="ghost-muted"
                className="ms-auto shrink-0"
                onClick={() =>
                  void setStatus(
                    threadRef,
                    { action: "set_status", updates: [{ id: question.id, status: "open" }] },
                    "Could not reopen the question",
                  )
                }
              >
                Reopen
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
