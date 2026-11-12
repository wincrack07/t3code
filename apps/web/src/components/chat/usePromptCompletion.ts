import { promptContinuation } from "@t3tools/shared/promptContinuation";
import {
  makePromptCompletionScheduler,
  promptCompletionKey,
  resolvePromptCompletionMode,
  type PromptCompletionComposerState,
} from "@t3tools/client-runtime/state/prompt-completion";
import {
  DEFAULT_PROMPT_COMPLETION_DELAY_MS,
  type EnvironmentId,
  type PromptCompletionInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useState } from "react";

import { isLatestRunSettled } from "../../session-logic";
import type { Thread } from "../../types";
import { useServerConfigs } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const NO_SUGGESTIONS: ReadonlyArray<string> = [];

interface CompletionRequest {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly input: PromptCompletionInput;
}

/**
 * Model-written prompt suggestions on the environment's prompt suggestion model: a continuation
 * of the typed draft, or up to three next prompts for an empty composer.
 */
export function usePromptCompletion(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: Thread | undefined;
  readonly draft: string;
  readonly caretAtEnd: boolean;
  readonly menuOpen: boolean;
  readonly busy: boolean;
  /** The composer is in the state where its placeholder would show. */
  readonly nextAllowed: boolean;
  /** The provider's own predicted prompt, offered first among the empty-composer suggestions. */
  readonly providerSuggestion: string | null;
}) {
  const settings = useServerConfigs().get(input.environmentId)?.settings;
  const available = useAtomValue(
    serverEnvironment.completePrompt.permissionAtom(input.environmentId),
  );
  const complete = useAtomCommand(serverEnvironment.completePrompt, { reportFailure: false });
  const [shown, setShown] = useState<{ key: string; suggestions: ReadonlyArray<string> } | null>(
    null,
  );
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [cycle, setCycle] = useState<{ key: string; index: number } | null>(null);
  const [paste, setPaste] = useState<{ armedFor: string | null; pastedDraft: string | null }>({
    armedFor: null,
    pastedDraft: null,
  });
  // A paste lands as the next draft change; suggestions wait until the user types after it.
  if (paste.armedFor !== null && paste.armedFor !== input.draft) {
    setPaste({ armedFor: null, pastedDraft: input.draft });
  }

  const thread = input.thread;
  const latest = thread?.source.latestVisibleMessage ?? null;
  const latestRunId = thread?.latestRun?.runId ?? null;
  const state: PromptCompletionComposerState = {
    inlineEnabled: available && settings?.promptCompletionInlineEnabled === true,
    nextEnabled: available && input.nextAllowed && settings?.promptCompletionNextEnabled === true,
    draft: input.draft,
    caretAtEnd: input.caretAtEnd,
    menuOpen: input.menuOpen,
    // The editor hides the ghost while an IME composes; see ComposerGhostTextExtension.
    composing: false,
    justPasted: paste.pastedDraft !== null && paste.pastedDraft === input.draft,
    busy: input.busy || thread === undefined || thread.latestRun === null,
    agentRunning: !isLatestRunSettled(thread?.latestRun ?? null, thread?.runtime ?? null),
    lastReplyFinished: latest?.role === "assistant",
    questionCardsOpen:
      latestRunId !== null &&
      (thread?.openQuestions ?? []).some(
        (question) => question.runId === latestRunId && question.status === "open",
      ),
  };
  const mode = resolvePromptCompletionMode(state);
  const threadVersion = latest ? `${latest.id}:${DateTime.toEpochMillis(latest.updatedAt)}` : "";
  const key =
    mode === null || thread === undefined
      ? null
      : promptCompletionKey({
          environmentId: input.environmentId,
          threadId: thread.id,
          threadVersion,
          mode: mode.mode,
          draft: mode.draft,
        });

  const delayMs = settings?.promptCompletionDelayMs ?? DEFAULT_PROMPT_COMPLETION_DELAY_MS;
  const readDelay = useEffectEvent(() => delayMs);
  const fetchSuggestions = useEffectEvent(async (request: CompletionRequest) => {
    const result = await complete({ environmentId: request.environmentId, input: request.input });
    return result._tag === "Success" ? result.value.suggestions : NO_SUGGESTIONS;
  });
  const [scheduler] = useState(() =>
    makePromptCompletionScheduler<CompletionRequest>({
      delayMs: () => readDelay(),
      fetch: (request) => fetchSuggestions(request),
      onSuggestions: (resultKey, suggestions) => setShown({ key: resultKey, suggestions }),
      timers: {
        set: (callback, delay) => window.setTimeout(callback, delay),
        clear: (handle) => window.clearTimeout(handle as number),
      },
    }),
  );
  const currentRequest = (): CompletionRequest | null =>
    key === null || mode === null || thread === undefined
      ? null
      : {
          key,
          environmentId: input.environmentId,
          input: { threadId: thread.id, mode: mode.mode, draft: mode.draft },
        };
  const schedule = useEffectEvent((nextKey: string | null) => {
    const request = currentRequest();
    scheduler.update(request?.key === nextKey ? request : null);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands each new request key to the debounced scheduler, which owns timers and the cache
  useEffect(() => schedule(key), [key]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the scheduler's pending timer when the composer unmounts
  useEffect(() => () => scheduler.dispose(), [scheduler]);

  // A key already answered, such as an earlier draft, shows from the cache without waiting.
  const generated =
    key === null || dismissedKey === key
      ? NO_SUGGESTIONS
      : shown?.key === key
        ? shown.suggestions
        : (scheduler.peek(key) ?? NO_SUGGESTIONS);
  const inline =
    mode?.mode === "continue" && generated[0] !== undefined
      ? promptContinuation(input.draft, generated[0])
      : null;
  const nextCandidates =
    input.draft.length === 0
      ? dedupe([
          ...(input.providerSuggestion === null || state.questionCardsOpen
            ? []
            : [input.providerSuggestion]),
          ...(mode?.mode === "next" ? generated : []),
        ]).slice(0, 3)
      : NO_SUGGESTIONS;
  const cycleKey = `${key ?? ""}\u0000${input.providerSuggestion ?? ""}`;
  const index = cycle?.key === cycleKey ? cycle.index % Math.max(1, nextCandidates.length) : 0;

  return {
    inline,
    next: nextCandidates[index] ?? null,
    nextPosition: nextCandidates.length > 1 ? { index, count: nextCandidates.length } : null,
    cycleNext: (direction: 1 | -1) => {
      if (nextCandidates.length < 2) return false;
      setCycle({
        key: cycleKey,
        index: (index + direction + nextCandidates.length) % nextCandidates.length,
      });
      return true;
    },
    takeInlineWord: () => {
      if (inline === null || thread === undefined) return null;
      const word = /^\s*\S+/u.exec(inline)?.[0] ?? inline;
      const rest = inline.slice(word.length);
      if (rest.trim().length > 0) {
        scheduler.seed(
          promptCompletionKey({
            environmentId: input.environmentId,
            threadId: thread.id,
            threadVersion,
            mode: "continue",
            draft: input.draft + word,
          }),
          [rest],
        );
      }
      return word;
    },
    dismiss: () => setDismissedKey(key),
    notePaste: () => setPaste({ armedFor: input.draft, pastedDraft: null }),
  };
}

function dedupe(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
