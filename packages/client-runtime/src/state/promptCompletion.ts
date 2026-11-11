import type { PromptCompletionMode } from "@t3tools/contracts";

/** What the composer shows right now; any field that blocks a suggestion wins. */
export interface PromptCompletionComposerState {
  readonly inlineEnabled: boolean;
  readonly nextEnabled: boolean;
  readonly draft: string;
  readonly caretAtEnd: boolean;
  /** `@` files, `$` skills, `/` commands, or any other composer menu. */
  readonly menuOpen: boolean;
  readonly composing: boolean;
  /** The last edit was a paste; wait for the user's own typing. */
  readonly justPasted: boolean;
  /** Approvals, pending questions, sends in flight, or anything else that owns the composer. */
  readonly busy: boolean;
  readonly agentRunning: boolean;
  readonly lastReplyFinished: boolean;
  /** The last reply's open-question cards are showing; they are the suggested answers. */
  readonly questionCardsOpen: boolean;
}

const MIN_CONTINUE_DRAFT_LENGTH = 3;

/** The request this composer state warrants, or null when no suggestion should show. */
export function resolvePromptCompletionMode(
  state: PromptCompletionComposerState,
): { readonly mode: PromptCompletionMode; readonly draft: string } | null {
  if (state.menuOpen || state.composing || state.justPasted || state.busy) return null;
  if (state.draft.length === 0) {
    return state.nextEnabled &&
      !state.agentRunning &&
      state.lastReplyFinished &&
      !state.questionCardsOpen
      ? { mode: "next", draft: "" }
      : null;
  }
  return state.inlineEnabled &&
    state.caretAtEnd &&
    state.draft.trim().length >= MIN_CONTINUE_DRAFT_LENGTH &&
    !state.draft.endsWith("\n")
    ? { mode: "continue", draft: state.draft }
    : null;
}

/** Thread state plus draft: a new reply or any edit makes a new key. */
export function promptCompletionKey(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadVersion: string;
  readonly mode: PromptCompletionMode;
  readonly draft: string;
}): string {
  return [input.environmentId, input.threadId, input.threadVersion, input.mode, input.draft].join(
    "\u0000",
  );
}

export interface PromptCompletionTimers {
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const CACHE_SIZE = 64;

/**
 * One request per pause: a change clears the pending timer, and a result whose key is no longer
 * current is cached but never shown. Failures cache as empty, so a key is asked at most once.
 */
export function makePromptCompletionScheduler<Request extends { readonly key: string }>(options: {
  /** Read on every pause, so a settings change applies at once. */
  readonly delayMs: () => number;
  readonly fetch: (request: Request) => Promise<ReadonlyArray<string>>;
  readonly onSuggestions: (key: string, suggestions: ReadonlyArray<string>) => void;
  /** The platform's timers; injected so tests drive the pause. */
  readonly timers: PromptCompletionTimers;
}) {
  const { timers } = options;
  const cache = new Map<string, ReadonlyArray<string>>();
  const inFlight = new Set<string>();
  let currentKey: string | null = null;
  let timer: unknown = null;

  const remember = (key: string, suggestions: ReadonlyArray<string>) => {
    cache.delete(key);
    cache.set(key, suggestions);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  };
  const clearTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  return {
    /** Returns cached suggestions at once; otherwise schedules one request after the pause. */
    update(request: Request | null) {
      if (request?.key === currentKey) return cache.get(request.key) ?? null;
      clearTimer();
      currentKey = request?.key ?? null;
      if (request === null) return null;
      const cached = cache.get(request.key);
      if (cached !== undefined) return cached;
      if (inFlight.has(request.key)) return null;
      timer = timers.set(() => {
        timer = null;
        inFlight.add(request.key);
        void options.fetch(request).then(
          (suggestions) => settle(request.key, suggestions),
          () => settle(request.key, []),
        );
      }, options.delayMs());
      return null;
    },
    /** Suggestions already known for a key, without scheduling anything. */
    peek(key: string) {
      return cache.get(key) ?? null;
    },
    /** Records suggestions already known for a key, such as the rest of a half-taken one. */
    seed(key: string, suggestions: ReadonlyArray<string>) {
      remember(key, suggestions);
    },
    dispose() {
      clearTimer();
      currentKey = null;
    },
  };

  function settle(key: string, suggestions: ReadonlyArray<string>) {
    inFlight.delete(key);
    remember(key, suggestions);
    if (key === currentKey) options.onSuggestions(key, suggestions);
  }
}
