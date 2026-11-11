import {
  assembleOpenQuestionAnswers,
  openQuestionAnswer,
  runOpenQuestions,
  type OpenQuestionDraft,
  type OpenQuestionDrafts,
} from "@t3tools/client-runtime/state/open-questions";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type OpenQuestion,
  type OpenQuestionsUpdate,
  type RunId,
} from "@t3tools/contracts";
import { CheckIcon, XIcon } from "lucide-react";
import { use, useState } from "react";

import { cn } from "~/lib/utils";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { TimelineRowCtx } from "./timelineRowContext";

/** Questions the agent declared for this run, answered in place under its final reply. */
export function OpenQuestionCards({ runId }: { readonly runId: RunId }) {
  const ctx = use(TimelineRowCtx);
  const questions = runOpenQuestions(useThreadShell(ctx.threadRef)?.openQuestions, runId);
  if (questions.length === 0 || ctx.threadRef === null) return null;
  return <OpenQuestionCardList questions={questions} />;
}

function OpenQuestionCardList({ questions }: { readonly questions: ReadonlyArray<OpenQuestion> }) {
  const ctx = use(TimelineRowCtx);
  const threadRef = ctx.threadRef!;
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [drafts, setDrafts] = useState<OpenQuestionDrafts>({});
  const [sending, setSending] = useState(false);
  const interactive = canOperate && ctx.onSendAppMessage !== undefined;

  const setDraft = (id: string, next: OpenQuestionDraft) =>
    setDrafts((current) => ({ ...current, [id]: next }));

  const setStatus = async (openQuestions: OpenQuestionsUpdate, failureTitle: string) => {
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

  const openQuestions = questions.filter((question) => question.status === "open");
  const assembled = assembleOpenQuestionAnswers(questions, drafts);
  const answeredCount = assembled?.update.updates.length ?? 0;

  const send = async () => {
    if (assembled === null || ctx.onSendAppMessage === undefined) return;
    setSending(true);
    const sent = await ctx.onSendAppMessage(assembled.text).then(
      () => true,
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not send your answers",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return false;
      },
    );
    if (sent && (await setStatus(assembled.update, "Answers sent, but the cards did not update"))) {
      setDrafts({});
    }
    setSending(false);
  };

  return (
    <section aria-label="Open questions" className="mt-2 flex flex-col gap-1.5">
      {questions.map((question, index) => (
        <OpenQuestionCard
          key={question.id}
          number={index + 1}
          question={question}
          draft={drafts[question.id]}
          interactive={interactive && !sending}
          onDraftChange={(next) => setDraft(question.id, next)}
          onDismiss={() =>
            void setStatus(
              { action: "set_status", updates: [{ id: question.id, status: "dismissed" }] },
              "Could not dismiss the question",
            )
          }
          onReopen={() =>
            void setStatus(
              { action: "set_status", updates: [{ id: question.id, status: "open" }] },
              "Could not reopen the question",
            )
          }
        />
      ))}
      {interactive && openQuestions.length > 0 ? (
        <div className="flex items-center justify-end gap-3 pt-0.5">
          <span className="text-muted-foreground text-xs tabular-nums">
            {answeredCount} of {openQuestions.length} answered
            {answeredCount > 0 && answeredCount < openQuestions.length
              ? " · the rest stay pending"
              : ""}
          </span>
          <Button size="xs" disabled={answeredCount === 0 || sending} onClick={() => void send()}>
            {answeredCount === 1 ? "Send 1 answer" : `Send ${answeredCount} answers`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function OpenQuestionCard(props: {
  readonly number: number;
  readonly question: OpenQuestion;
  readonly draft: OpenQuestionDraft | undefined;
  readonly interactive: boolean;
  readonly onDraftChange: (draft: OpenQuestionDraft) => void;
  readonly onDismiss: () => void;
  readonly onReopen: () => void;
}) {
  const ctx = use(TimelineRowCtx);
  const { question, draft } = props;
  const open = question.status === "open";
  const answeredLocally = open && openQuestionAnswer(draft) !== null;
  const settled = !open;

  return (
    <div
      data-open-question={question.id}
      data-status={question.status}
      className={cn(
        "rounded-lg border bg-card/40 px-3 py-2",
        answeredLocally || question.status === "answered"
          ? "border-success/40"
          : "border-border/70",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px font-mono text-muted-foreground text-xs tabular-nums">
          {props.number}
        </span>
        <div
          className={cn("min-w-0 flex-1 text-sm", settled && "text-muted-foreground")}
          data-thread-find-text="true"
        >
          <ChatMarkdown
            text={question.text}
            cwd={ctx.markdownCwd}
            threadRef={ctx.threadRef ?? undefined}
            isStreaming={false}
          />
        </div>
        {answeredLocally ? (
          <CheckIcon aria-label="Answered" className="mt-0.5 size-3.5 shrink-0 text-success" />
        ) : null}
        {settled ? (
          <span className="shrink-0 text-muted-foreground text-xs">
            {question.status === "answered"
              ? "Answered"
              : question.status === "dismissed"
                ? "Dismissed"
                : "Resolved"}
          </span>
        ) : null}
        {props.interactive && open ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss question"
            onClick={props.onDismiss}
          >
            <XIcon />
          </Button>
        ) : null}
        {props.interactive && settled ? (
          <Button size="xs" variant="ghost" onClick={props.onReopen}>
            Reopen
          </Button>
        ) : null}
      </div>
      {question.status === "answered" && question.answer ? (
        <p className="mt-1 pl-5 text-muted-foreground text-xs">→ {question.answer}</p>
      ) : null}
      {props.interactive && open ? (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-5">
          <div className="flex flex-wrap gap-1">
            {question.suggestions.map((suggestion) => (
              <Toggle
                key={suggestion}
                size="compact"
                variant="outline"
                pressed={!draft?.later && draft?.choice === suggestion}
                onPressedChange={(pressed) =>
                  props.onDraftChange({
                    ...draft,
                    later: false,
                    choice: pressed ? suggestion : undefined,
                  })
                }
              >
                {suggestion}
              </Toggle>
            ))}
            <Toggle
              size="compact"
              variant="outline"
              pressed={draft?.later === true}
              onPressedChange={(pressed) => props.onDraftChange({ ...draft, later: pressed })}
            >
              Later
            </Toggle>
          </div>
          <Input
            size="compact"
            aria-label={`Detail or custom answer for question ${props.number}`}
            placeholder="Add a detail or your own answer"
            value={draft?.detail ?? ""}
            disabled={draft?.later === true}
            onChange={(event) =>
              props.onDraftChange({ ...draft, detail: event.currentTarget.value })
            }
          />
        </div>
      ) : null}
    </div>
  );
}
