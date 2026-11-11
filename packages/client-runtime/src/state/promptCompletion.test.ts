import { ThreadId, type PromptCompletionInput } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  makePromptCompletionScheduler,
  resolvePromptCompletionMode,
  type PromptCompletionComposerState,
} from "./promptCompletion.ts";

const idle: PromptCompletionComposerState = {
  inlineEnabled: true,
  nextEnabled: true,
  draft: "",
  caretAtEnd: true,
  menuOpen: false,
  composing: false,
  justPasted: false,
  busy: false,
  agentRunning: false,
  lastReplyFinished: true,
  questionCardsOpen: false,
};

describe("resolvePromptCompletionMode", () => {
  it("never suggests over a composer menu, IME composition, paste, or open question cards", () => {
    expect(resolvePromptCompletionMode(idle)).toEqual({ mode: "next", draft: "" });
    expect(resolvePromptCompletionMode({ ...idle, draft: "Run the" })).toEqual({
      mode: "continue",
      draft: "Run the",
    });
    for (const blocked of [
      { menuOpen: true },
      { composing: true },
      { justPasted: true },
      { busy: true },
    ]) {
      expect(resolvePromptCompletionMode({ ...idle, ...blocked })).toBeNull();
      expect(resolvePromptCompletionMode({ ...idle, ...blocked, draft: "@src/app" })).toBeNull();
    }
    expect(resolvePromptCompletionMode({ ...idle, questionCardsOpen: true })).toBeNull();
    expect(resolvePromptCompletionMode({ ...idle, agentRunning: true })).toBeNull();
    expect(
      resolvePromptCompletionMode({ ...idle, draft: "Run the", caretAtEnd: false }),
    ).toBeNull();
    expect(
      resolvePromptCompletionMode({ ...idle, draft: "Run the", inlineEnabled: false }),
    ).toBeNull();
  });
});

interface CompletionRequest {
  readonly key: string;
  readonly input: PromptCompletionInput;
}

function harness() {
  let pending: Array<{ callback: () => void; cleared: boolean }> = [];
  const resolvers: Array<(value: ReadonlyArray<string>) => void> = [];
  const fetched: Array<string> = [];
  const shown: Array<[string, ReadonlyArray<string>]> = [];
  const scheduler = makePromptCompletionScheduler({
    delayMs: () => 700,
    fetch: (pending: CompletionRequest) => {
      fetched.push(pending.input.draft);
      return new Promise((resolve) => resolvers.push(resolve));
    },
    onSuggestions: (key, suggestions) => shown.push([key, suggestions]),
    timers: {
      set: (callback) => {
        const entry = { callback, cleared: false };
        pending.push(entry);
        return entry;
      },
      clear: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
  });
  const fireTimers = () => {
    const due = pending.filter((entry) => !entry.cleared);
    pending = [];
    for (const entry of due) entry.callback();
  };
  const request = (draft: string): CompletionRequest => ({
    key: draft,
    input: {
      threadId: ThreadId.make("thread:1"),
      mode: "continue",
      draft,
    } as PromptCompletionInput,
  });
  return { scheduler, fireTimers, resolvers, fetched, shown, request };
}

describe("makePromptCompletionScheduler", () => {
  it("sends one request per pause and never shows a result for an older draft", async () => {
    const { scheduler, fireTimers, resolvers, fetched, shown, request } = harness();
    scheduler.update(request("Ru"));
    scheduler.update(request("Run"));
    scheduler.update(request("Run the"));
    fireTimers();
    expect(fetched).toEqual(["Run the"]);

    scheduler.update(request("Run the t"));
    resolvers[0]!([" tests"]);
    await Promise.resolve();
    expect(shown).toEqual([]);

    // Back to the earlier draft: the late result was cached, so it shows without a request.
    expect(scheduler.update(request("Run the"))).toEqual([" tests"]);
    fireTimers();
    expect(fetched).toEqual(["Run the"]);
  });

  it("caches a failure as empty and stops on null", async () => {
    const { scheduler, fireTimers, fetched, request } = harness();
    const failing = makePromptCompletionScheduler({
      delayMs: () => 1,
      fetch: () => Promise.reject(new Error("timeout")),
      onSuggestions: () => {},
      timers: { set: (callback) => (callback(), null), clear: () => {} },
    });
    failing.update(request("Run the"));
    await Promise.resolve();
    await Promise.resolve();
    failing.update(null);
    expect(failing.update(request("Run the"))).toEqual([]);

    scheduler.update(request("Run the"));
    scheduler.update(null);
    fireTimers();
    expect(fetched).toEqual([]);
  });
});
