import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  assembleOpenQuestionAnswers,
  openQuestionDeck,
  type OpenQuestionDeck,
  type OpenQuestionDraft,
  type OpenQuestionDrafts,
} from "@t3tools/client-runtime/state/open-questions";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import { readThreadShell } from "./state/entities";

/** Which open question the card above the composer shows, and answers picked but not yet sent. */
interface ThreadDeckState {
  readonly shownId: string | null;
  readonly drafts: OpenQuestionDrafts;
}

const EMPTY: ThreadDeckState = { shownId: null, drafts: {} };

const useOpenQuestionDeckStore = create<{
  readonly byThread: Readonly<Record<string, ThreadDeckState>>;
}>(() => ({ byThread: {} }));

function update(threadRef: ScopedThreadRef, next: (state: ThreadDeckState) => ThreadDeckState) {
  const key = scopedThreadKey(threadRef);
  useOpenQuestionDeckStore.setState(({ byThread }) => ({
    byThread: { ...byThread, [key]: next(byThread[key] ?? EMPTY) },
  }));
}

export function useOpenQuestionDeckState(threadRef: ScopedThreadRef): ThreadDeckState {
  return useOpenQuestionDeckStore((state) => state.byThread[scopedThreadKey(threadRef)] ?? EMPTY);
}

export function showOpenQuestion(threadRef: ScopedThreadRef, id: string): void {
  update(threadRef, (state) => ({ ...state, shownId: id }));
}

export function setOpenQuestionDraft(
  threadRef: ScopedThreadRef,
  id: string,
  draft: OpenQuestionDraft | undefined,
): void {
  update(threadRef, (state) => {
    const drafts = { ...state.drafts };
    if (draft === undefined) delete drafts[id];
    else drafts[id] = draft;
    return { ...state, drafts };
  });
}

export function clearOpenQuestionDrafts(threadRef: ScopedThreadRef, ids: ReadonlyArray<string>) {
  update(threadRef, (state) => {
    const drafts = { ...state.drafts };
    for (const id of ids) delete drafts[id];
    return { ...state, drafts };
  });
}

/** The deck as the card shows it right now, for the composer's send path. */
function readOpenQuestionDeck(threadRef: ScopedThreadRef): {
  readonly deck: OpenQuestionDeck | null;
  readonly drafts: OpenQuestionDrafts;
} {
  const state = useOpenQuestionDeckStore.getState().byThread[scopedThreadKey(threadRef)] ?? EMPTY;
  const questions = readThreadShell(threadRef)?.openQuestions;
  return { deck: openQuestionDeck(questions, state.shownId), drafts: state.drafts };
}

/** A typed composer message answering the shown question, with any answers already picked. */
export function answerShownOpenQuestion(threadRef: ScopedThreadRef, text: string) {
  const { deck, drafts } = readOpenQuestionDeck(threadRef);
  if (deck === null) return null;
  const questions = readThreadShell(threadRef)?.openQuestions ?? [];
  return assembleOpenQuestionAnswers(questions, drafts, { id: deck.question.id, text });
}
