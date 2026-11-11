import {
  assembleOpenQuestionAnswers,
  nextAfterOpenQuestionAnswer,
  openQuestionAnswer,
  openQuestionDeck,
  openQuestionOptions,
  type OpenQuestionDeck,
  type OpenQuestionDrafts,
} from "@t3tools/client-runtime/state/open-questions";
import type { OpenQuestion, ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { use, useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { isMacPlatform } from "~/lib/utils";
import { useComposerDraftStore, type ComposerThreadTarget } from "../../composerDraftStore";
import {
  clearOpenQuestionDrafts,
  setOpenQuestionDraft,
  showOpenQuestion,
  useOpenQuestionDeckState,
} from "../../openQuestionDeckStore";
import { useQuietThreadShell } from "../../state/entities";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ComposerBanner } from "./ComposerBanner";
import { HtmlRenderPromptContext } from "./HtmlRenderPromptContext";
import { isDecisionShortcut } from "./ComposerDecisionCard.logic";
import { useSetOpenQuestionStatus } from "./useSetOpenQuestionStatus";

const MAC = isMacPlatform(navigator.platform);
const SHORTCUT_LABEL = MAC ? "⌘↵" : "Ctrl+Enter";
const SHORTCUT_KEYS = MAC ? "Meta+Enter" : "Control+Enter";

/**
 * The thread's open questions, one at a time, docked above the composer. Typing in the
 * composer and sending answers the question shown here (see useComposerSend).
 */
export function ComposerDecisionCard(props: {
  readonly threadRef: ScopedThreadRef;
  readonly draftTarget: ComposerThreadTarget;
  readonly cwd: string | undefined;
}) {
  const { threadRef } = props;
  const questions = useQuietThreadShell(threadRef)?.openQuestions;
  const { shownId, drafts } = useOpenQuestionDeckState(threadRef);
  const deck = openQuestionDeck(questions, shownId);
  if (deck === null || questions === undefined) return null;
  return (
    <DecisionCard
      {...props}
      deck={deck}
      questions={questions}
      drafts={drafts}
      key={deck.question.id}
    />
  );
}

function DecisionCard(props: {
  readonly threadRef: ScopedThreadRef;
  readonly draftTarget: ComposerThreadTarget;
  readonly cwd: string | undefined;
  readonly deck: OpenQuestionDeck;
  readonly questions: ReadonlyArray<OpenQuestion>;
  readonly drafts: OpenQuestionDrafts;
}) {
  const { threadRef, deck, drafts } = props;
  const question = deck.question;
  const sendAppMessage = use(HtmlRenderPromptContext);
  const setStatus = useSetOpenQuestionStatus();
  const [sending, setSending] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const options = openQuestionOptions(question);
  const chosen = drafts[question.id]?.choice;
  const total = deck.open.length;
  const pendingCount = deck.open.filter(
    (open) => openQuestionAnswer(drafts[open.id]) !== null,
  ).length;

  const send = async (nextDrafts: OpenQuestionDrafts) => {
    const assembled = assembleOpenQuestionAnswers(props.questions, nextDrafts);
    if (assembled === null || sendAppMessage === undefined) return;
    setSending(true);
    const sent = await sendAppMessage(assembled.text).then(
      () => true,
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not send your answer",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return false;
      },
    );
    setSending(false);
    if (!sent) return;
    clearOpenQuestionDrafts(
      threadRef,
      assembled.update.updates.map((entry) => entry.id),
    );
    await setStatus(threadRef, assembled.update, "Answer sent, but the question did not update");
  };

  // One open question sends at once. Several collect answers and send together when
  // the last one is picked, as one message, so the agent gets a single turn.
  const choose = (choice: string) => {
    if (sending) return;
    const nextDrafts = { ...drafts, [question.id]: { choice } };
    setOpenQuestionDraft(threadRef, question.id, { choice });
    const next = nextAfterOpenQuestionAnswer(deck, nextDrafts);
    if (next.kind === "show") showOpenQuestion(threadRef, next.id);
    else void send(nextDrafts);
  };
  const chooseStable = useStableCallback(choose);
  const primary = options[0];
  const { draftTarget } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens on window in the capture phase so the shortcut runs before the composer editor's own Enter handling
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (primary === undefined || !(event.target instanceof Element)) return;
      const form = cardRef.current?.closest("[data-chat-composer-form]");
      if (!form || !form.contains(event.target)) return;
      if (
        !isDecisionShortcut(event, {
          mac: MAC,
          draft: useComposerDraftStore.getState().getComposerDraft(draftTarget),
        })
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseStable(primary);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [primary, draftTarget, chooseStable, cardRef]);

  const dismiss = () => {
    setOpenQuestionDraft(threadRef, question.id, undefined);
    void setStatus(
      threadRef,
      { action: "set_status", updates: [{ id: question.id, status: "dismissed" }] },
      "Could not dismiss the question",
    );
  };
  const step = (delta: number) =>
    showOpenQuestion(threadRef, deck.open[(deck.index + delta + total) % total]!.id);

  return (
    <ComposerBanner.Attachment data-composer-decision-card="true">
      <ComposerBanner.Root variant="default" density="spacious">
        <div ref={cardRef} data-open-question={question.id} className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <div
              className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
              data-thread-find-text="true"
            >
              {question.context ? <p className="text-foreground/85">{question.context}</p> : null}
              <ChatMarkdown
                text={question.text}
                cwd={props.cwd}
                threadRef={threadRef}
                isStreaming={false}
                className="font-medium text-foreground"
              />
            </div>
            <div className="-me-1.5 -mt-1 flex shrink-0 items-center">
              {total > 1 ? (
                <>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label="Previous question"
                    onClick={() => step(-1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <ComposerBanner.Count>
                    {deck.index + 1} of {total}
                  </ComposerBanner.Count>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label="Next question"
                    onClick={() => step(1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </>
              ) : null}
              <ComposerBanner.Dismiss
                type="button"
                aria-label="Dismiss question"
                onClick={dismiss}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {options.map((option, index) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={index === 0 ? "default" : "secondary"}
                disabled={sending}
                aria-keyshortcuts={index === 0 ? SHORTCUT_KEYS : undefined}
                onClick={() => choose(option)}
              >
                {chosen === option ? <CheckIcon aria-label="Picked" /> : null}
                <span>{option}</span>
                {index === 0 ? <Kbd className="-me-1">{SHORTCUT_LABEL}</Kbd> : null}
              </Button>
            ))}
            {total > 1 && pendingCount > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost-muted"
                disabled={sending}
                onClick={() => void send(drafts)}
              >
                {pendingCount === 1 ? "Send 1 answer now" : `Send ${pendingCount} answers now`}
              </Button>
            ) : null}
          </div>
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
