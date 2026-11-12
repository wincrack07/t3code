import { describe, expect, it } from "vite-plus/test";
import { mergeStoredChanges, windowStorageKey } from "./windowPersistence";

describe("window persistence", () => {
  it("preserves legacy layout keys for the first window and browser tabs", () => {
    expect(windowStorageKey("t3code:thread-columns:v1", "main")).toBe("t3code:thread-columns:v1");
    expect(windowStorageKey("t3code:thread-columns:v1", "second")).toBe(
      "t3code:thread-columns:v1:window:second",
    );
    expect(windowStorageKey("t3code:client-settings:v1", "second")).toBe(
      "t3code:client-settings:v1",
    );
    expect(windowStorageKey("t3code:composer-drafts:v1", "second")).toBe(
      "t3code:composer-drafts:v1",
    );
  });
  it("keeps concurrent draft edits and deletions on different threads", () => {
    const before = { state: { drafts: { first: "a", second: "b" } } };
    const next = { state: { drafts: { first: "edited", second: "b" } } };
    const current = { state: { drafts: { first: "a", second: "elsewhere", third: "new" } } };
    expect(mergeStoredChanges(before, next, current)).toEqual({
      state: { drafts: { first: "edited", second: "elsewhere", third: "new" } },
    });
    expect(mergeStoredChanges(before, { state: { drafts: { second: "b" } } }, current)).toEqual({
      state: { drafts: { second: "elsewhere", third: "new" } },
    });
  });
  it("does not restore sent content when a stale window changes draft settings", () => {
    const draft = {
      prompt: "Send this prompt",
      attachments: [{ id: "image" }],
      files: [{ id: "file" }],
      threadContexts: [{ threadId: "mentioned" }],
      activeProvider: "codex",
    };
    const before = { state: { draftsByThreadKey: { thread: draft } } };
    const cleared = { state: { draftsByThreadKey: {} } };
    expect(mergeStoredChanges(before, cleared, before)).toEqual(cleared);
    const staleWindow = {
      state: { draftsByThreadKey: { thread: { ...draft, activeProvider: "claude" } } },
    };
    expect(mergeStoredChanges(before, staleWindow, cleared)).toEqual({
      state: { draftsByThreadKey: { thread: { activeProvider: "claude" } } },
    });
    const newText = {
      state: { draftsByThreadKey: { thread: { ...draft, prompt: "Typed after send" } } },
    };
    expect(mergeStoredChanges(before, newText, cleared)).toEqual({
      state: { draftsByThreadKey: { thread: { prompt: "Typed after send" } } },
    });
    expect(mergeStoredChanges(before, before, cleared)).toEqual(cleared);
    const emptyDraft = {
      ...draft,
      prompt: "",
      attachments: [],
      files: [],
      threadContexts: [],
    };
    const retained = { state: { draftsByThreadKey: { thread: emptyDraft } } };
    expect(mergeStoredChanges(before, staleWindow, retained)).toEqual({
      state: { draftsByThreadKey: { thread: { ...emptyDraft, activeProvider: "claude" } } },
    });
    expect(mergeStoredChanges(before, newText, retained)).toEqual({
      state: { draftsByThreadKey: { thread: { ...emptyDraft, prompt: "Typed after send" } } },
    });
  });
});
