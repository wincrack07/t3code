import type { BrowserLinkTarget } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveLinkTarget } from "./browserLinkTarget";

const settings = vi.hoisted(() => ({ browserLinkTarget: "system" as BrowserLinkTarget }));

vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  getClientSettings: () => settings,
}));

const click = { metaKey: false, ctrlKey: false };

describe("resolveLinkTarget", () => {
  it("leaves non-web schemes to the shell", () => {
    for (const url of ["mailto:someone@example.com", "vscode://file/x", "not a url"]) {
      expect(resolveLinkTarget({ url, event: click, preference: "app", canOpenInApp: true })).toBe(
        "system",
      );
    }
  });

  it("opens Claude artifacts in the panel whatever the link preference, unless asked otherwise", () => {
    const artifact = "https://claude.ai/code/artifact/0f8b6c2e-1d2a-4c3b-9e4f-5a6b7c8d9e0f";
    const decide = (
      input: Partial<Parameters<typeof resolveLinkTarget>[0]> & { url: string },
    ): BrowserLinkTarget =>
      resolveLinkTarget({ event: click, preference: "system", canOpenInApp: true, ...input });

    expect(decide({ url: artifact })).toBe("app");
    // Plain web client or mobile: no panel to open in.
    expect(decide({ url: artifact, canOpenInApp: false })).toBe("system");
    expect(decide({ url: artifact, event: { metaKey: true, ctrlKey: false } })).toBe("system");
    expect(decide({ url: artifact, event: { metaKey: false, ctrlKey: true } })).toBe("system");
    expect(decide({ url: artifact, event: { ...click, button: 1 } })).toBe("system");
    // Other links still follow the "Open links in" setting.
    expect(decide({ url: "https://example.com/" })).toBe("system");
    expect(decide({ url: "https://claude.ai/chat/1" })).toBe("system");
    expect(decide({ url: "https://example.com/", preference: "app" })).toBe("app");
  });
});
