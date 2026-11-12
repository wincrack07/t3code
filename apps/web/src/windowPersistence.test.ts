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
});
