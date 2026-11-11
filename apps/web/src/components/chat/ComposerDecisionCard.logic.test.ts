import { describe, expect, it } from "vite-plus/test";

import { isDecisionShortcut } from "./ComposerDecisionCard.logic";

const key = (overrides: Partial<Parameters<typeof isDecisionShortcut>[0]> = {}) => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  ...overrides,
});
const draft = (prompt: string, images: never[] = []) => ({
  prompt,
  images,
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  threadContexts: [],
  environmentContexts: [],
});

describe("isDecisionShortcut", () => {
  it("picks the primary answer with the platform's mod+Enter only while the composer is empty", () => {
    expect(isDecisionShortcut(key({ metaKey: true }), { mac: true, draft: null })).toBe(true);
    expect(isDecisionShortcut(key({ ctrlKey: true }), { mac: false, draft: draft("  ") })).toBe(
      true,
    );
    // A draft, even attachments alone, means mod+Enter is the composer's own send.
    expect(isDecisionShortcut(key({ metaKey: true }), { mac: true, draft: draft("hi") })).toBe(
      false,
    );
    expect(
      isDecisionShortcut(key({ metaKey: true }), {
        mac: true,
        draft: draft("", [{} as never]),
      }),
    ).toBe(false);
    expect(isDecisionShortcut(key(), { mac: true, draft: null })).toBe(false);
    expect(isDecisionShortcut(key({ ctrlKey: true }), { mac: true, draft: null })).toBe(false);
    expect(
      isDecisionShortcut(key({ metaKey: true, shiftKey: true }), { mac: true, draft: null }),
    ).toBe(false);
    expect(
      isDecisionShortcut(key({ metaKey: true, isComposing: true }), { mac: true, draft: null }),
    ).toBe(false);
  });
});
